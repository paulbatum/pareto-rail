import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { MASS_DRIVER_BPM, MASS_DRIVER_DURATION, SHOT_TIME, bar } from './timing';

// MASS DRIVER — a 60-second ride down the barrel of an orbital railgun, scored
// to a locked 128 BPM pulse (one bar = 1.875 s; 32 bars = exactly 60 s). The
// payload crosses one accelerator ring on every beat, so the quarter-note grid
// is the unit of distance as well as time, and the whole run accelerates:
//
//   0–4   injection  Breech. Sparse pulse. First threaders + a coil rank teach the sweep.
//   4–12  stage-1    Pulse locks. Alternating coil ranks / threader weaves; a capacitor at bar 8.
//   12–20 stage-2    Rings run violet. Density, coils lob arc bolts, two more capacitors.
//   20–28 interlock  Six jammed safety interlocks clamp the bore — clear all six before bar 28.
//   28    THE SHOT   Charge peaks: speed multiplies ~3×, whiteout, muzzle exit (or detonation).
//   28–32 muzzle     Open space, silence, no enemies. Run ends at exactly 60 s.
//
// The rail-progress easing is the normalized integral of the speed profile, so
// the barrel accelerates the entire way and the bar-28 shot lands as a genuine
// kick of acceleration on the downbeat.

export { MASS_DRIVER_BPM, MASS_DRIVER_DURATION, SHOT_TIME, bar } from './timing';

export const MASS_DRIVER_PLAYER_HEALTH = 3;
export const INTERLOCK_COUNT = 6;

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in the runner's enemyState bags; dynamically
// launched arc bolts get fresh data objects each shot.
export type MassDriverSpawnData =
  | { role: 'coil'; lead: number; angle: number; drift: number; fires: boolean; seed: number }
  | {
      role: 'threader';
      lead: number;
      angle0: number;
      omega: number;
      radius0: number;
      radiusAmp: number;
      fromX: number;
      toX: number;
      y: number;
      arc: number;
      crossTime: number;
      delay: number;
    }
  | { role: 'capacitor'; lead: number; offset: Vector3; roll: number }
  | { role: 'arc'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | {
      role: 'interlock';
      approachLead: number;
      holdLead: number;
      settleTime: number;
      angle: number;
      radius: number;
      fires: boolean;
      index: number;
    };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// ---- speed profile → rail easing ------------------------------------------

// Piecewise-linear speed factors over run time, strictly accelerating: the gun
// only ever speeds up. Cruise climbs from a chambered crawl through the two
// acceleration stages, and the bar-28 downbeat fires — a 0.25-beat jump to ~3×
// that eases back only slightly across the muzzle-exit bars.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.5],
  [bar(4), 0.62],
  [bar(12), 0.85],
  [bar(20), 1.08],
  [bar(27), 1.32],
  [bar(28), 1.42],
  [bar(28, 0.25), 4.3],
  [bar(32), 3.4],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// Rail parameter where the barrel ends and open space begins: the camera
// reaches it exactly on the shot. Rings, conductor rails, and the barrel wall
// all stop here; everything past it is the muzzle exit.
export const MUZZLE_U = massDriverRunProgress(SHOT_TIME);

// ---- rail ------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = MathUtils.clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic barrel: mostly straight down −z with a gentle in-bore weave so
// the tunnel reads and enemies get parallax without the camera clipping the
// wall (bore radius ~12). Past the muzzle the weave tapers to nothing and the
// line lifts gently into open space. No randomness — the same bore every run.
export function createMassDriverRail() {
  const LENGTH = 1600;
  const SEGMENTS = 24;
  const points: Vector3[] = [];
  for (let i = 0; i <= SEGMENTS; i += 1) {
    const along = i / SEGMENTS;
    const z = -LENGTH * along;
    // Weave lives inside the barrel and fades out around the muzzle.
    const taper = 1 - smoothstep(MUZZLE_U - 0.04, MUZZLE_U + 0.12, along);
    const x = taper * (2.6 * Math.sin(along * Math.PI * 2 * 7) + 0.7 * Math.sin(along * Math.PI * 2 * 3 + 0.7));
    const weaveY = taper * (1.9 * Math.sin(along * Math.PI * 2 * 5 + 1.3));
    // Open space beyond the muzzle drifts gently upward into the black.
    const rise = 26 * smoothstep(MUZZLE_U, 1, along) ** 1.4;
    points.push(new Vector3(x, weaveY + rise, z));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.38);
}

// ---- spawn timeline ---------------------------------------------------------

// Coils clamp to the bore wall (bore radius ~12), so the ring sits near the
// wall and reads at the full-frame rim. The 60° FOV is wide, so modest offsets
// project near the center — pushing coils out to the wall is what makes ranks
// sweep the whole viewport instead of clustering dead-center.
const BORE_RADIUS_X = 10;
const BORE_RADIUS_Y = 9;
const BORE_Y_BIAS = 0.5;

// Coil sentries clamped around the bore wall at fixed rail anchors. Angles are
// authored around the circumference; `fires` coils lob an arc bolt with a
// rear-back → lunge telegraph.
const coilRank = (
  time: number,
  lead: number,
  entries: Array<{ angle: number; fires?: boolean }>,
): MassDriverSpawnEntry[] =>
  entries.map((entry, index) => ({
    time: time + index * 0.12,
    kind: 'coil',
    data: {
      role: 'coil',
      lead,
      angle: entry.angle,
      drift: (index % 2 === 0 ? 1 : -1) * 0.22,
      fires: entry.fires ?? false,
      seed: time + index * 1.7,
    },
  }));

// Threaders: needle darts corkscrewing around the bore axis while crossing the
// full frame. `omega` sign alternates so a weave reads as counter-rotating
// helices — a double helix on downbeats.
const threaderWeave = (
  time: number,
  lead: number,
  runs: Array<{
    fromX: number;
    toX: number;
    y: number;
    omega: number;
    radius0: number;
    radiusAmp: number;
    arc?: number;
    crossTime?: number;
    delay?: number;
  }>,
): MassDriverSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.1,
    kind: 'threader',
    data: {
      role: 'threader',
      lead,
      angle0: index * 2.1,
      omega: run.omega,
      radius0: run.radius0,
      radiusAmp: run.radiusAmp,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc ?? 1.2,
      crossTime: run.crossTime ?? 2.1,
      delay: run.delay ?? index * 0.32,
    },
  }));

// Capacitor banks: fat two-stage cylinders drifting mid-bore. Staves blow off
// at stage 1, then the exposed core takes two more hits.
const capacitors = (time: number, entries: Array<{ x: number; y: number; lead?: number }>): MassDriverSpawnEntry[] =>
  entries.map((entry, index) => ({
    time: time + index * 0.3,
    kind: 'capacitor',
    hitStages: [2, 2],
    data: {
      role: 'capacitor',
      lead: entry.lead ?? 4.6,
      offset: new Vector3(entry.x, entry.y, 0),
      roll: (index % 2 === 0 ? 1 : -1) * 0.5,
    },
  }));

// The six safety interlocks, arranged like clock positions around the bore.
// A rank of three clamps in, then a second rank two bars later.
const interlockRank = (
  time: number,
  holdLead: number,
  entries: Array<{ angle: number; radius: number; fires?: boolean; index: number }>,
): MassDriverSpawnEntry[] =>
  entries.map((entry, index) => ({
    time: time + index * 0.18,
    kind: 'interlock',
    hitStages: [1, 2],
    data: {
      role: 'interlock',
      approachLead: holdLead + 1.5,
      holdLead,
      settleTime: 2.4,
      angle: entry.angle,
      radius: entry.radius,
      fires: entry.fires ?? false,
      index: entry.index,
    },
  }));

// Clock positions in radians (0 = 3 o'clock, CCW). Top rank arrives first.
const CLOCK = {
  twelve: Math.PI / 2,
  two: Math.PI / 6,
  four: -Math.PI / 6,
  six: -Math.PI / 2,
  eight: (-5 * Math.PI) / 6,
  ten: (5 * Math.PI) / 6,
};

function buildMassDriverTimeline(): MassDriverSpawnEntry[] {
  return [
    // --- injection (bars 0–4): teach the sweep. A double helix, then a coil rank. ---
    ...threaderWeave(bar(1.5), 3.2, [
      { fromX: -10.5, toX: 10.5, y: 1.2, omega: 3.6, radius0: 1.6, radiusAmp: 3.4 },
      { fromX: 10.5, toX: -10.5, y: 3.4, omega: -3.6, radius0: 1.6, radiusAmp: 3.4 },
    ]),
    ...coilRank(bar(2), 3.5, [{ angle: CLOCK.ten }, { angle: CLOCK.twelve }, { angle: CLOCK.two }, { angle: CLOCK.four }]),
    ...threaderWeave(bar(3), 3.2, [
      { fromX: -11, toX: 11, y: -0.4, omega: 4, radius0: 1.6, radiusAmp: 3.6 },
      { fromX: 11, toX: -11, y: 4, omega: -4, radius0: 1.6, radiusAmp: 3.4 },
      { fromX: -11, toX: 11, y: 2, omega: 4, radius0: 1.6, radiusAmp: 3.8 },
    ]),

    // --- stage-1 (bars 4–12): two-bar cadence, coil ranks ⟷ threader weaves. ---
    ...coilRank(bar(4), 3.4, [
      { angle: CLOCK.ten },
      { angle: CLOCK.twelve },
      { angle: CLOCK.two },
      { angle: CLOCK.four },
      { angle: CLOCK.six },
    ]),
    ...threaderWeave(bar(6), 3.1, [
      { fromX: -11.5, toX: 11.5, y: 0.4, omega: 4.2, radius0: 1.6, radiusAmp: 4 },
      { fromX: 11.5, toX: -11.5, y: 4.2, omega: -4.2, radius0: 1.6, radiusAmp: 3.6 },
      { fromX: -11.5, toX: 11.5, y: 5.4, omega: 4.2, radius0: 1.6, radiusAmp: 3.2 },
      { fromX: 11.5, toX: -11.5, y: -0.8, omega: -4.2, radius0: 1.6, radiusAmp: 3.6 },
    ]),
    ...coilRank(bar(8), 3.3, [{ angle: CLOCK.eight }, { angle: CLOCK.ten }, { angle: CLOCK.two }, { angle: CLOCK.four }]),
    ...capacitors(bar(8), [{ x: -3.5, y: 3.4, lead: 3.6 }]),
    ...threaderWeave(bar(10), 3, [
      { fromX: -11.5, toX: 11.5, y: 0.4, omega: 4.4, radius0: 1.6, radiusAmp: 4, delay: 0 },
      { fromX: 11.5, toX: -11.5, y: 3.2, omega: -4.4, radius0: 1.6, radiusAmp: 3.4, delay: 0.26 },
      { fromX: -11.5, toX: 11.5, y: 5.4, omega: 4.4, radius0: 1.6, radiusAmp: 3, delay: 0.52 },
      { fromX: 11.5, toX: -11.5, y: 1.8, omega: -4.4, radius0: 1.6, radiusAmp: 3.6, delay: 0.78 },
    ]),
    ...coilRank(bar(11), 3.3, [{ angle: CLOCK.twelve }, { angle: CLOCK.four }, { angle: CLOCK.eight }]),

    // --- stage-2 (bars 12–20): density, arc-firing coils, two capacitors, then a breath. ---
    ...coilRank(bar(12), 3.1, [
      { angle: CLOCK.ten, fires: true },
      { angle: CLOCK.twelve },
      { angle: CLOCK.two, fires: true },
      { angle: CLOCK.four },
      { angle: CLOCK.six },
    ]),
    ...threaderWeave(bar(13), 2.8, [
      { fromX: -12, toX: 12, y: 0.4, omega: 4.6, radius0: 1.6, radiusAmp: 4.2 },
      { fromX: 12, toX: -12, y: 4.6, omega: -4.6, radius0: 1.6, radiusAmp: 3.6 },
      { fromX: -12, toX: 12, y: 2.4, omega: 4.6, radius0: 1.6, radiusAmp: 3.4 },
    ]),
    ...coilRank(bar(14), 3.1, [
      { angle: CLOCK.eight, fires: true },
      { angle: CLOCK.ten },
      { angle: CLOCK.two },
      { angle: CLOCK.four, fires: true },
    ]),
    ...capacitors(bar(14), [{ x: 3.6, y: -2.4, lead: 3.5 }]),
    ...threaderWeave(bar(16), 2.8, [
      { fromX: -12, toX: 12, y: 0, omega: 4.8, radius0: 1.6, radiusAmp: 4.2, delay: 0 },
      { fromX: 12, toX: -12, y: 5, omega: -4.8, radius0: 1.6, radiusAmp: 3.6, delay: 0.24 },
      { fromX: -12, toX: 12, y: 2.2, omega: 4.8, radius0: 1.6, radiusAmp: 3.8, delay: 0.48 },
      { fromX: 12, toX: -12, y: 3.4, omega: -4.8, radius0: 1.6, radiusAmp: 3.4, delay: 0.72 },
    ]),
    ...coilRank(bar(17), 3, [
      { angle: CLOCK.twelve, fires: true },
      { angle: CLOCK.two },
      { angle: CLOCK.six, fires: true },
      { angle: CLOCK.ten },
    ]),
    ...capacitors(bar(18), [{ x: -4, y: 3, lead: 3.4 }, { x: 4, y: -1.8, lead: 3.7 }]),
    ...threaderWeave(bar(18.5), 2.7, [
      { fromX: -11.5, toX: 11.5, y: 0.8, omega: 5, radius0: 1.6, radiusAmp: 3.8 },
      { fromX: 11.5, toX: -11.5, y: 4.6, omega: -5, radius0: 1.6, radiusAmp: 3.2 },
      { fromX: -11.5, toX: 11.5, y: 2.6, omega: 5, radius0: 1.6, radiusAmp: 3.6 },
    ]),
    // (bar 19.5–20: a deliberate breath before the klaxon.)

    // --- interlock (bars 20–28): six clamps in two ranks of three, light chaff between. ---
    // Close station (≈1 s ahead) so the clamps ring the frame instead of
    // reading as distant specks against the charge glow.
    ...interlockRank(bar(20), 1.05, [
      { angle: CLOCK.ten, radius: 9.4, index: 0, fires: true },
      { angle: CLOCK.twelve, radius: 8.2, index: 1 },
      { angle: CLOCK.two, radius: 9.4, index: 2 },
    ]),
    ...interlockRank(bar(22), 0.95, [
      { angle: CLOCK.eight, radius: 9.4, index: 3 },
      { angle: CLOCK.six, radius: 8, index: 4, fires: true },
      { angle: CLOCK.four, radius: 9.4, index: 5 },
    ]),
    // Threader chaff keeps the volleys mixed while the boss is worked down.
    ...threaderWeave(bar(22), 2.8, [
      { fromX: -11.5, toX: 11.5, y: 1.4, omega: 5, radius0: 1.6, radiusAmp: 3.4, crossTime: 1.9 },
      { fromX: 11.5, toX: -11.5, y: 3.6, omega: -5, radius0: 1.6, radiusAmp: 3, crossTime: 1.9 },
    ]),
    ...threaderWeave(bar(23.5), 2.7, [
      { fromX: 11.5, toX: -11.5, y: 2, omega: -5.2, radius0: 1.6, radiusAmp: 3.2, crossTime: 1.9 },
      { fromX: -11.5, toX: 11.5, y: 4.2, omega: 5.2, radius0: 1.6, radiusAmp: 2.8, crossTime: 1.9 },
    ]),
    ...threaderWeave(bar(25), 2.6, [
      { fromX: -11.5, toX: 11.5, y: 1.2, omega: 5.4, radius0: 1.6, radiusAmp: 3, crossTime: 1.8 },
      { fromX: 11.5, toX: -11.5, y: 3.4, omega: -5.4, radius0: 1.6, radiusAmp: 2.8, crossTime: 1.8 },
    ]),
    ...threaderWeave(bar(26), 2.4, [
      { fromX: 11.5, toX: -11.5, y: 1.4, omega: -5.4, radius0: 1.6, radiusAmp: 3, crossTime: 1.7 },
      { fromX: -11.5, toX: 11.5, y: 4.2, omega: 5.4, radius0: 1.6, radiusAmp: 2.8, crossTime: 1.7 },
    ]),
    ...threaderWeave(bar(27), 1.7, [
      { fromX: -11, toX: 11, y: 2, omega: 5.6, radius0: 1.6, radiusAmp: 2.6, crossTime: 1.5 },
      { fromX: 11, toX: -11, y: 3.6, omega: -5.6, radius0: 1.6, radiusAmp: 2.4, crossTime: 1.5 },
    ]),
    // (bars 28–32: muzzle exit — intentionally empty.)
  ];
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = buildMassDriverTimeline().sort((a, b) => a.time - b.time);

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  coil: 120,
  threader: 150,
  capacitor: 350,
  arc: 50,
  interlock: 500,
};

const ARC_MAX_AGE = 12;

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  // Bolts the player has fired on; cleared when the bolt dies, so an arc only
  // counts as intercepted if the shot actually lands before impact.
  const interceptions = new Set<number>();
  const interlockIds = new Set<number>();
  let hitsTaken = 0;
  let arcsIntercepted = 0;
  let interlocksDown = 0;
  let summoned = false;
  let detonated = false;

  bus.on('runstart', () => {
    interceptions.clear();
    interlockIds.clear();
    hitsTaken = 0;
    arcsIntercepted = 0;
    interlocksDown = 0;
    summoned = false;
    detonated = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'interlock') return;
    interlockIds.add(enemyId);
    if (summoned) return;
    // First clamp locks in: the boss protocol begins.
    summoned = true;
    bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('playerhit', ({ damage }) => {
    hitsTaken += 1;
    // Only the interlock deadline deals a 99-point blow; that's the barrel going.
    if (damage >= 90) detonated = true;
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (!interlockIds.delete(enemyId)) return;
    interlocksDown += 1;
    // Sixth interlock down before the shot: the gun is committed.
    if (interlocksDown >= INTERLOCK_COUNT) bus.emit('bossphase', { phase: 'destroyed' });
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    interlockIds.delete(enemyId);
  });

  function fireArc(context: MassDriverUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arc',
      countsTowardTotal: false,
      data: { role: 'arc', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  function faceBore(context: MassDriverUpdate, anchorU: number) {
    // Orient toward the bore axis — clamped to the barrel wall, looking inward.
    const center = context.curve.getPointAt(MathUtils.clamp(anchorU, 0, 1));
    context.enemy.mesh.lookAt(center);
  }

  // ---- movement -------------------------------------------------------------

  function updateCoil(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'coil' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Slide around the circumference on the bore wall, facing inward.
    const angle = data.angle + age * data.drift;
    const offset = new Vector3(Math.cos(angle) * BORE_RADIUS_X, Math.sin(angle) * BORE_RADIUS_Y + BORE_Y_BIAS, 0);

    if (data.fires) {
      // Telegraphed lunge (Helios scorcher pattern): rear back, dash inward,
      // loose an arc bolt.
      const fire = context.enemyState(() => ({ nextAt: 1.5 }));
      const untilShot = fire.nextAt - age;
      if (untilShot < 0.9 && untilShot > 0.55) offset.z += (0.9 - untilShot) * 7;
      else if (untilShot <= 0.55 && untilShot > 0) offset.z -= (0.55 - untilShot) * 13;
      if (age >= fire.nextAt) {
        fire.nextAt = age + 3.6;
        fireArc(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    faceBore(context, anchorU);
    enemy.mesh.rotateZ(age * 0.6 + enemy.id);
    return runProgress > anchorU + 0.014;
  }

  function updateThreader(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'threader' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.2 || runProgress > anchorU + 0.014) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    // The corkscrew center drifts across the whole frame; the helix winds
    // around it with a radius that swells mid-crossing.
    const centerX = MathUtils.lerp(data.fromX, data.toX, eased);
    const centerY = data.y + Math.sin(clamped * Math.PI) * data.arc;
    const helix = data.angle0 + age * data.omega;
    const radius = data.radius0 + data.radiusAmp * Math.sin(clamped * Math.PI);
    enemy.mesh.position.copy(
      offsetFromRail(curve, anchorU, new Vector3(centerX + Math.cos(helix) * radius, centerY + Math.sin(helix) * radius, 0)),
    );
    // Nose along the corkscrew's travel a moment ahead.
    const cAhead = Math.min(1, clamped + 0.05);
    const eAhead = cAhead * cAhead * (3 - 2 * cAhead);
    const helixAhead = data.angle0 + (age + 0.05) * data.omega;
    const radiusAhead = data.radius0 + data.radiusAmp * Math.sin(cAhead * Math.PI);
    const ahead = offsetFromRail(
      curve,
      anchorU,
      new Vector3(
        MathUtils.lerp(data.fromX, data.toX, eAhead) + Math.cos(helixAhead) * radiusAhead,
        data.y + Math.sin(cAhead * Math.PI) * data.arc + Math.sin(helixAhead) * radiusAhead,
        0,
      ),
    );
    enemy.mesh.lookAt(ahead);
    return false;
  }

  function updateCapacitor(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'capacitor' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.6) * 1.2;
    offset.y += Math.sin(age * 0.5 + 1) * 0.7;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * data.roll); // slow roll of the insulated bank
    // Stage 1: staves gone, the exposed core crackles and shudders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 22) * 0.14;
      enemy.mesh.position.y += Math.cos(age * 18) * 0.12;
    }
    return runProgress > anchorU + 0.014;
  }

  function updateArc(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'arc' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: interceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5.5,
      maxSpeed: 12.5,
      accel: 3.4,
      turnRate: 2.4,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > ARC_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, age, curve } = context;
    // Detonation deadline: any interlock still standing when the charge peaks
    // takes the barrel — and the payload — with it.
    if (runTime >= SHOT_TIME) {
      context.damagePlayer(99);
      return true;
    }
    // Station-keeping brace. A true fixed rail anchor this far downbore would
    // sit hundreds of units past the fog at spawn (the barrel is long and the
    // camera is fast), so the clamp holds a roughly constant distance ahead of
    // the camera instead — a menacing idle that broods over the bore for the
    // whole section. Because it is always ahead of the camera and never
    // despawns before the shot, it is never overtaken before SHOT_TIME.
    const hold = MathUtils.lerp(data.approachLead, data.holdLead, smoothstep(0, data.settleTime, age));
    const anchorU = Math.min(MUZZLE_U, massDriverRunProgress(runTime + hold));
    const pulse = 1 + Math.sin(age * 2.2 + data.index) * 0.03; // slow charge pulse
    const grind = Math.sin(age * 1.6 + data.index) * 0.14; // heavy idle grind
    const offset = new Vector3(
      Math.cos(data.angle) * data.radius * pulse,
      Math.sin(data.angle) * data.radius * pulse + 0.5,
      grind,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    faceBore(context, anchorU);
    enemy.mesh.rotateZ(grind * 0.5);
    // Cowl popped (stage 1): the exposed actuator core shudders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 19) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 15) * 0.1;
    }
    if (data.fires) {
      const fire = context.enemyState(() => ({ nextAt: 2.4 + data.index * 0.5 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 3;
        fireArc(context, enemy.mesh.position);
      }
    }
    return false; // held on station: never a miss before the shot
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    // At 128 BPM the beat is 0.469 s and the barrel cruises slowly, so the
    // engine's tempo-adaptive shot timing and 32nd-note action-SFX snap fit the
    // level's pulse: this level deliberately inherits the default `timing`.
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'coil':
          return updateCoil(context, data);
        case 'threader':
          return updateThreader(context, data);
        case 'capacitor':
          return updateCapacitor(context, data);
        case 'arc':
          return updateArc(context, data);
        case 'interlock':
          return updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'arc') arcsIntercepted += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping capacitor staves and interlock cowls pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // S demands the gun actually fired (all six interlocks down before bar
      // 28) plus a near-total clear: the simulator's seeded imperfect runs
      // (~92% clear) land A; S is reserved for the run you replay for.
      if (interlocksDown >= INTERLOCK_COUNT && score >= 11500 && clearRate >= 0.95) return 'S';
      if (score >= 8500 && clearRate >= 0.62) return 'A';
      if (score >= 4500 && clearRate >= 0.42) return 'B';
      if (score >= 1800 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      // The detonation is one 99-point playerhit, so count it as a total loss.
      const hull = detonated ? 0 : Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`, `Interlocks ${interlocksDown}/${INTERLOCK_COUNT}`];
      if (interlocksDown >= INTERLOCK_COUNT) lines.push('PAYLOAD AWAY — muzzle exit clean');
      else if (detonated) lines.push('CHARGE CONTAINMENT FAILED');
      if (arcsIntercepted > 0) lines.push(`${arcsIntercepted} arc${arcsIntercepted === 1 ? '' : 's'} intercepted`);
      return lines;
    },
  };
}
