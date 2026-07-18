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
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_MARKERS,
  SHOT_TIME,
  bar,
} from './timing';

export { MASS_DRIVER_BPM } from './timing';

// The bore. Everything hostile lives inside this radius; the wall panels sit
// just outside it, so threaders visibly weave in front of the barrel wall.
export const BORE_RADIUS = 12;
export const MASS_DRIVER_PLAYER_HEALTH = 3;
export const INTERLOCK_COUNT = 6;

// ---- speed: the gun only ever speeds up -------------------------------------
//
// A slow start off the breech, a steady climb through the middle bars, a harder
// pull as the charge builds, then a ~3x surge on the bar-28 downbeat that hurls
// the payload out of the muzzle. Rail progress is the normalized integral of
// this curve, so the acceleration is real distance, not a visual trick: ring
// spacing widens because the payload genuinely covers more ground per beat.

const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.55],
  [bar(4), 0.76],
  [bar(12), 1.06],
  [bar(20), 1.46],
  [bar(26), 1.92],
  [SHOT_TIME - 0.02, 2.05],
  [SHOT_TIME, 6.2],
  [bar(32), 5.4],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_DURATION);

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — how rings and set pieces are placed. */
export const railU = (time: number) => massDriverRunProgress(time);

/** Where the barrel stops. Rings, rails, and wall all end here; past it is open space. */
export const MUZZLE_U = massDriverRunProgress(SHOT_TIME);

// ---- rail --------------------------------------------------------------------
//
// A long line down the bore with a gentle weave, so the tunnel reads and enemies
// get parallax without the camera ever approaching the wall. The weave tapers to
// zero before the muzzle so the exit is clean and straight, and past the muzzle
// the line lifts gently upward into the black.

const BARREL_SEGMENTS = 24;
const BARREL_SEGMENT_Z = 40;
const EXIT_SEGMENTS = 15;
const EXIT_SEGMENT_Z = 44;
const EXIT_RISE = 132;

export function createMassDriverRail() {
  const points: Vector3[] = [];
  for (let i = 0; i <= BARREL_SEGMENTS; i += 1) {
    const t = i / BARREL_SEGMENTS;
    const taper = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3) ** 1.6;
    points.push(new Vector3(
      Math.sin(t * 7.4) * 4.6 * taper,
      Math.sin(t * 5.1 + 1.15) * 3.3 * taper,
      -i * BARREL_SEGMENT_Z,
    ));
  }
  const muzzleZ = -BARREL_SEGMENTS * BARREL_SEGMENT_Z;
  for (let j = 1; j <= EXIT_SEGMENTS; j += 1) {
    const t = j / EXIT_SEGMENTS;
    points.push(new Vector3(0, t ** 1.7 * EXIT_RISE, muzzleZ - j * EXIT_SEGMENT_Z));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- enemy roster -------------------------------------------------------------

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

export type MassDriverSpawnData =
  | { role: 'coil'; lead: number; clock: number; drift: number; radius: number; fireAt?: number }
  | {
    role: 'threader';
    lead: number;
    fromX: number;
    toX: number;
    y: number;
    arc: number;
    crossTime: number;
    delay: number;
    helix: number;
    helixRadius: number;
    turns: number;
    /** Crossing axis, in radians about the bore. Rotating it per drone in a wave
     * turns a row of horizontal passes into a fan that sweeps the whole frame. */
    roll: number;
  }
  | { role: 'capacitor'; lead: number; clock: number; radius: number; seed: number }
  | { role: 'arc'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; slot: number };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// Clock positions read as hours on a watch face: 0 = 12 o'clock, 3 = 3 o'clock.
function clockOffset(hour: number, radius: number) {
  const angle = (hour / 12) * Math.PI * 2;
  return new Vector3(Math.sin(angle) * radius, Math.cos(angle) * radius, 0);
}

// ---- spawn choreography -------------------------------------------------------
//
// Authored, never random, and read as a rising cadence. Coil ranks sweep the
// frame rim; threader waves braid across the full frame width; capacitors hold
// the middle distance. Every entry time is a bar/beat, so waves arrive on the
// music rather than alongside it.

type CoilRankOptions = {
  lead: number;
  hours: number[];
  stagger?: number;
  drift?: number;
  radius?: number;
  /** Indices into `hours` whose coils rear back and loose an arc bolt. */
  firing?: number[];
};

// Leads are trimmed globally rather than per wave: the whole barrel wants its
// engagements a little closer than the authored numbers, and one knob keeps the
// authored cadence intact.
const LEAD_TRIM = 0.88;

const coilRank = (time: number, options: CoilRankOptions): MassDriverSpawnEntry[] => {
  const stagger = options.stagger ?? 0.11;
  const drift = options.drift ?? 0.34;
  const radius = options.radius ?? BORE_RADIUS - 1.7;
  return options.hours.map((hour, index) => ({
    time: time + index * stagger,
    kind: 'coil',
    data: {
      role: 'coil',
      lead: options.lead * LEAD_TRIM,
      clock: hour,
      // Alternate the slide direction across a rank so it opens like a fan.
      drift: index % 2 === 0 ? drift : -drift,
      radius,
      ...(options.firing?.includes(index) ? { fireAt: 1.15 + index * 0.14 } : {}),
    },
  }));
};

type ThreaderRun = { fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number };

// Authored crossings are written in frame-sized numbers for readability; the
// bore is only 12 units across, so they are scaled into it here. Nothing hostile
// may sit outside the barrel wall — the wall would occlude it.
const CROSS_SCALE = 0.42;
const PERP_SCALE = 0.62;
const THREADER_ROLLS = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI * 0.7, -Math.PI * 0.2];

const threaderWeave = (time: number, lead: number, runs: ThreaderRun[]): MassDriverSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.07,
    kind: 'threader',
    data: {
      role: 'threader',
      lead: lead * LEAD_TRIM,
      fromX: run.fromX * CROSS_SCALE,
      toX: run.toX * CROSS_SCALE,
      y: run.y * PERP_SCALE,
      arc: run.arc * PERP_SCALE,
      roll: THREADER_ROLLS[index % THREADER_ROLLS.length],
      crossTime: run.crossTime ?? 2.5,
      delay: run.delay ?? index * 0.2,
      // Sign alternates within a wave, so a pair reads as a counter-rotating
      // double helix rather than two drones doing the same thing.
      helix: index % 2 === 0 ? 1 : -1,
      helixRadius: 2.1 + (index % 3) * 0.5,
      turns: 2.4 + (index % 2) * 0.5,
    },
  }));

const capacitors = (time: number, lead: number, placements: Array<[hour: number, radius: number]>): MassDriverSpawnEntry[] =>
  placements.map(([hour, radius], index) => ({
    time: time + index * 0.24,
    kind: 'capacitor',
    hitStages: [2, 2],
    data: { role: 'capacitor', lead: lead * LEAD_TRIM, clock: hour, radius, seed: hour * 1.7 + index * 2.3 },
  }));

const interlockRank = (time: number, slots: number[]): MassDriverSpawnEntry[] =>
  slots.map((slot, index) => ({
    time: time + index * 0.24,
    kind: 'interlock',
    hitStages: [1, 2],
    data: { role: 'interlock', slot },
  }));

const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = sortTimeline([
  // --- Injection (bars 0–4): the breech. Teach the sweep, sparse and slow.
  ...threaderWeave(bar(0, 2), 3.1, [
    { fromX: -21, toX: 21, y: 2.6, arc: 2.2 },
    { fromX: 21, toX: -21, y: -1.4, arc: -2.2, delay: 0.14 },
  ]),
  ...coilRank(bar(1, 2), { lead: 3.0, hours: [12, 3, 6, 9], stagger: 0.13 }),
  ...threaderWeave(bar(2, 2), 3.0, [
    { fromX: -22, toX: 22, y: -2.2, arc: 3.0 },
    { fromX: 22, toX: -22, y: 3.4, arc: -2.4, delay: 0.24 },
  ]),
  ...threaderWeave(bar(3, 2), 2.9, [
    { fromX: -22, toX: 22, y: 4.0, arc: -2.0 },
    { fromX: 22, toX: -22, y: -3.4, arc: 2.6, delay: 0.2 },
    { fromX: -20, toX: 20, y: 0.6, arc: 1.4, delay: 0.4 },
  ]),

  // --- Stage 1 (bars 4–12): the four-on-floor locks in. Two-bar call and
  // response — a coil rank answered by a threader weave — with the first
  // capacitor drifting in mid-section.
  ...coilRank(bar(4), { lead: 2.8, hours: [12, 2, 4, 6] }),
  ...threaderWeave(bar(5), 2.75, [
    { fromX: -23, toX: 23, y: 1.2, arc: 2.8 },
    { fromX: 23, toX: -23, y: -2.6, arc: -2.4, delay: 0.22 },
    { fromX: -21, toX: 21, y: 4.4, arc: 1.6, delay: 0.44 },
  ]),
  ...coilRank(bar(6), { lead: 2.75, hours: [8, 10, 12, 2] }),
  ...threaderWeave(bar(7), 2.7, [
    { fromX: 23, toX: -23, y: -3.6, arc: 3.2 },
    { fromX: -23, toX: 23, y: 2.4, arc: -2.6, delay: 0.24 },
  ]),
  ...capacitors(bar(7, 2), 3.0, [[10, 7.5]]),
  ...coilRank(bar(8), { lead: 2.7, hours: [12, 2, 4, 6, 8] }),
  ...threaderWeave(bar(9), 2.65, [
    { fromX: -24, toX: 24, y: -1.0, arc: 3.4 },
    { fromX: 24, toX: -24, y: 3.2, arc: -2.2, delay: 0.2 },
    { fromX: -22, toX: 22, y: -4.2, arc: 2.0, delay: 0.4 },
  ]),
  ...coilRank(bar(10), { lead: 2.65, hours: [6, 8, 10, 12, 2], drift: 0.4 }),
  ...threaderWeave(bar(11), 2.6, [
    { fromX: 24, toX: -24, y: 0.4, arc: 3.0 },
    { fromX: -24, toX: 24, y: -3.8, arc: -2.6, delay: 0.2 },
    { fromX: 22, toX: -22, y: 4.6, arc: 1.8, delay: 0.4 },
    { fromX: -22, toX: 22, y: 2.0, arc: -1.6, delay: 0.6 },
  ]),

  // --- Stage 2 (bars 12–20): rings run violet, density rises, and the bore
  // starts shooting back. Ends on a deliberate breath of empty air.
  ...coilRank(bar(12), { lead: 2.5, hours: [12, 2, 4, 6, 8, 10], stagger: 0.09, firing: [1, 4] }),
  ...threaderWeave(bar(13), 2.45, [
    { fromX: -25, toX: 25, y: 2.2, arc: 3.0, delay: 0 },
    { fromX: 25, toX: -25, y: -2.0, arc: -3.0, delay: 0.16 },
    { fromX: -23, toX: 23, y: -4.6, arc: 2.2, delay: 0.32 },
    { fromX: 23, toX: -23, y: 4.8, arc: -2.2, delay: 0.48 },
  ]),
  ...capacitors(bar(14), 2.8, [[2, 7.8], [8, 7.8]]),
  ...coilRank(bar(15), { lead: 2.45, hours: [10, 12, 2, 4, 6, 8], stagger: 0.09, firing: [0, 3, 5] }),
  ...threaderWeave(bar(16), 2.4, [
    { fromX: 25, toX: -25, y: -1.2, arc: 3.6, delay: 0 },
    { fromX: -25, toX: 25, y: 3.0, arc: -2.8, delay: 0.18 },
    { fromX: 23, toX: -23, y: -4.8, arc: 2.4, delay: 0.36 },
    { fromX: -23, toX: 23, y: 5.0, arc: -1.8, delay: 0.54 },
  ]),
  ...coilRank(bar(17), { lead: 2.4, hours: [12, 3, 6, 9, 1, 7], stagger: 0.09, firing: [2, 5] }),
  ...capacitors(bar(17, 2), 2.7, [[11, 8.2]]),
  ...threaderWeave(bar(18), 2.35, [
    { fromX: -25, toX: 25, y: 0.6, arc: 3.4, delay: 0 },
    { fromX: 25, toX: -25, y: 4.2, arc: -2.4, delay: 0.16 },
    { fromX: -24, toX: 24, y: -3.4, arc: 2.8, delay: 0.32 },
    { fromX: 24, toX: -24, y: -5.0, arc: -1.6, delay: 0.48 },
  ]),
  ...capacitors(bar(18, 2), 2.6, [[5, 8.2]]),
  ...coilRank(bar(19), { lead: 2.3, hours: [2, 5, 8, 11], stagger: 0.1, firing: [1, 3] }),
  // (bar 19:2 – bar 20 — held empty. The klaxon needs the silence.)

  // --- Interlock (bars 20–28): six jammed safety clamps brood over the bore
  // while threader chaff keeps the volleys mixed.
  ...interlockRank(bar(20), [0, 2, 4]),
  ...threaderWeave(bar(21), 2.1, [
    { fromX: -24, toX: 24, y: 1.6, arc: 2.6 },
    { fromX: 24, toX: -24, y: -2.4, arc: -2.6, delay: 0.18 },
  ]),
  ...interlockRank(bar(22), [1, 3, 5]),
  ...threaderWeave(bar(23), 2.05, [
    { fromX: 25, toX: -25, y: -3.0, arc: 3.0 },
    { fromX: -25, toX: 25, y: 2.8, arc: -2.6, delay: 0.18 },
  ]),
  ...threaderWeave(bar(24), 2.0, [
    { fromX: -25, toX: 25, y: -1.4, arc: 3.2 },
    { fromX: 25, toX: -25, y: 3.6, arc: -2.4, delay: 0.16 },
    { fromX: -23, toX: 23, y: 4.6, arc: -1.6, delay: 0.32 },
  ]),
  ...threaderWeave(bar(25), 1.95, [
    { fromX: 24, toX: -24, y: 0.8, arc: 3.0 },
    { fromX: -24, toX: 24, y: -4.0, arc: -2.4, delay: 0.16 },
  ]),
  ...threaderWeave(bar(26), 1.85, [
    { fromX: -24, toX: 24, y: 2.4, arc: 2.8 },
    { fromX: 24, toX: -24, y: -2.8, arc: -2.8, delay: 0.14 },
    { fromX: -22, toX: 22, y: -0.4, arc: 1.8, delay: 0.28 },
  ]),
  ...threaderWeave(bar(27), 1.75, [
    { fromX: 23, toX: -23, y: 3.2, arc: -2.4 },
    { fromX: -23, toX: 23, y: -3.2, arc: 2.4, delay: 0.14 },
  ]),

  // --- Muzzle (bars 28–32): intentionally empty. This is the payoff.
]);

export const MASS_DRIVER_SPAWN_TIMELINE = MASS_DRIVER_TIMELINE;

// ---- scoring ------------------------------------------------------------------

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  coil: 130,
  threader: 155,
  capacitor: 340,
  arc: 80,
  interlock: 760,
};

const MISS_GRACE_U = 0.006;
const ARC_MAX_AGE = 6.5;

// Interlocks hold a roughly constant lead ahead of the camera rather than a
// fixed point in the barrel: at these speeds a parked clamp would be swallowed
// by the fog before the player could work it. Station-keeping means all six
// brood over the bore for the whole section and can never be overtaken.
const INTERLOCK_STAND_OFF_START = 34;
const INTERLOCK_STAND_OFF_END = 24;

// Two of the six clamps fire back, on authored beats so the volleys stay
// musically placed instead of drifting with each clamp's own spawn time.
const INTERLOCK_VOLLEY_SLOTS = [1, 4];
const INTERLOCK_VOLLEY_TIMES = [bar(21, 2), bar(23, 2), bar(25, 2), bar(26, 3)];

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const interceptions = new Set<number>();
  const arcIds = new Set<number>();
  let interlocksCleared = 0;
  let arcsIntercepted = 0;
  let hullHits = 0;
  let gunFired = false;
  let detonated = false;

  bus.on('runstart', () => {
    interceptions.clear();
    arcIds.clear();
    interlocksCleared = 0;
    arcsIntercepted = 0;
    hullHits = 0;
    gunFired = false;
    detonated = false;
  });

  bus.on('playerhit', () => {
    hullHits += 1;
  });

  // A bolt only counts as intercepted if a player shot actually connects — one
  // that expires unresolved does not.
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    arcIds.delete(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (arcIds.delete(enemyId)) arcsIntercepted += 1;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'arc') arcIds.add(enemyId);
  });

  function fireArc(context: MassDriverUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arc',
      countsTowardTotal: false,
      data: { role: 'arc', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- motion ------------------------------------------------------------------

  function updateCoil(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'coil' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const angle = (data.clock / 12) * Math.PI * 2 + age * data.drift;
    const offset = new Vector3(Math.sin(angle) * data.radius, Math.cos(angle) * data.radius, 0);

    // Firing coils telegraph: a visible rear-back into the wall, then a fast
    // lunge inward that looses the bolt at the bottom of the dive.
    if (data.fireAt !== undefined) {
      const state = context.enemyState(() => ({ fired: false }));
      const until = data.fireAt - age;
      if (until < 0.6 && until > 0.26) offset.multiplyScalar(1 + (0.6 - until) * 0.34);
      else if (until <= 0.26 && until > -0.2) offset.multiplyScalar(1 - (0.26 - until) * 0.62);
      if (!state.fired && age >= data.fireAt) {
        state.fired = true;
        fireArc(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    // Always facing inward at the bore axis, with a lazy spin about that axis.
    enemy.mesh.lookAt(offsetFromRail(curve, anchorU, new Vector3(0, 0, 0)));
    enemy.mesh.rotateZ(-angle + Math.sin(age * 1.4 + data.clock) * 0.24);
    return runProgress > anchorU + MISS_GRACE_U;
  }

  function threaderPoint(
    curve: CatmullRomCurve3,
    anchorU: number,
    data: Extract<MassDriverSpawnData, { role: 'threader' }>,
    t: number,
  ) {
    const eased = t * t * (3 - 2 * t);
    // The shallow crossing arc is the path; the helix winds the body around it.
    const cross = MathUtils.lerp(data.fromX, data.toX, eased);
    const perp = data.y + Math.sin(MathUtils.clamp(t, 0, 1) * Math.PI) * data.arc;
    const spin = t * data.turns * Math.PI * 2 * data.helix;
    const swung = perp + Math.sin(spin) * data.helixRadius;
    const offset = new Vector3(
      cross * Math.cos(data.roll) - swung * Math.sin(data.roll),
      cross * Math.sin(data.roll) + swung * Math.cos(data.roll),
      Math.cos(spin) * data.helixRadius,
    );
    // Hard-clamp inside the bore: a drone outside the wall is a drone the wall hides.
    const radial = Math.hypot(offset.x, offset.y);
    if (radial > BORE_RADIUS - 1.3) offset.multiplyScalar((BORE_RADIUS - 1.3) / radial);
    return offsetFromRail(curve, anchorU, offset);
  }

  function updateThreader(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'threader' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12 || runProgress > anchorU + MISS_GRACE_U) return true;

    enemy.mesh.position.copy(threaderPoint(curve, anchorU, data, MathUtils.clamp(t, 0, 1)));
    // The nose points a moment ahead of where the body actually is.
    enemy.mesh.lookAt(threaderPoint(curve, anchorU, data, MathUtils.clamp(t + 0.045, 0, 1.08)));
    enemy.mesh.rotateZ(age * 5.2 * data.helix);
    return false;
  }

  function updateCapacitor(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'capacitor' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Lazy figure-drift around the authored clock position.
    const offset = clockOffset(data.clock, data.radius);
    offset.x += Math.sin(age * 0.62 + data.seed) * 2.3;
    offset.y += Math.sin(age * 0.94 + data.seed * 1.4) * 1.5;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Slow alternating roll; once the staves are gone the exposed core shudders.
    enemy.mesh.rotateZ(Math.sin(age * 0.75 + data.seed) * 0.9);
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 34) * 0.11;
      enemy.mesh.position.y += Math.cos(age * 29) * 0.1;
    }
    return runProgress > anchorU + MISS_GRACE_U;
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
      config: { hitDistance: 2.5, impactBrake: 0.34, damageDistance: 0.7 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Accelerating and braking as it closes: the bolt surges, hesitates, surges.
    const surge = 1 + Math.sin(age * 4.4) * 0.32;
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, 2.5), age, dt, {
      baseSpeed: 7.5 * surge,
      maxSpeed: 17,
      accel: 3.2,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    return age > ARC_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, runProgress, age, curve, camera, damagePlayer } = context;

    // The deadline. Anything still standing when the gun fires is the detonation.
    // The clamp is kept alive and hammered rather than despawned on the first
    // attempt, because the engine's post-hit invulnerability window can swallow
    // a single damagePlayer call and the deadline must not be dodgeable by
    // having taken an arc bolt a moment earlier. It is parked behind the camera
    // so it can neither be seen nor locked while the killing blow lands.
    if (runTime >= SHOT_TIME) {
      detonated = true;
      damagePlayer(MASS_DRIVER_PLAYER_HEALTH + 1);
      const behind = new Vector3();
      camera.getWorldDirection(behind);
      enemy.mesh.position.copy(camera.position).addScaledVector(behind, -40);
      // The invulnerability window is under a second, so give up just past it:
      // a swallowed hit must not become an endless damage loop.
      return runTime > SHOT_TIME + 1.2;
    }

    const close = MathUtils.clamp(
      (runTime - MASS_DRIVER_MARKERS.interlock) / (SHOT_TIME - MASS_DRIVER_MARKERS.interlock),
      0,
      1,
    );
    const standOff = MathUtils.lerp(INTERLOCK_STAND_OFF_START, INTERLOCK_STAND_OFF_END, close * close);
    const anchorU = Math.min(1, runProgress + standOff / curve.getLength());
    // Arrival overshoot: the clamp slams into station over the first half second.
    const settle = Math.min(1, age / 0.55);
    // Slams inward off the barrel wall — but never past it, or the wall panels
    // would hide the clamp during its own arrival.
    const radius = MathUtils.lerp(BORE_RADIUS + 0.5, BORE_RADIUS - 2.4, settle * settle * (3 - 2 * settle));
    // Slots sit at 60 deg spacing, which interleaves them with the four
    // conductor rails at the diagonals; the sway is bounded so a clamp never
    // drifts behind a rail and out of the player's line on it.
    const angle = (data.slot / INTERLOCK_COUNT) * Math.PI * 2 + Math.sin(runTime * 0.22) * 0.14;
    const offset = new Vector3(Math.sin(angle) * radius, Math.cos(angle) * radius, 0);

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(-angle);
    // Once the cowl is off, the exposed actuator core rattles in its housing.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(runTime * 41 + data.slot) * 0.13;
      enemy.mesh.position.y += Math.cos(runTime * 37 + data.slot) * 0.12;
    }
    return false;
  }

  function maybeFireInterlockVolley(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    if (!INTERLOCK_VOLLEY_SLOTS.includes(data.slot)) return;
    // A second-rank clamp starts past some of the authored beats; it picks up
    // the schedule where it arrives instead of firing the backlog at once.
    const state = context.enemyState(() => ({
      next: INTERLOCK_VOLLEY_TIMES.filter((at) => at <= context.runTime).length,
    }));
    while (state.next < INTERLOCK_VOLLEY_TIMES.length && context.runTime >= INTERLOCK_VOLLEY_TIMES[state.next]) {
      state.next += 1;
      fireArc(context, context.enemy.mesh.position);
    }
  }

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    // The barrel runs fast: cap the coarsest volley grid at half a bar so a
    // six-lock release resolves inside the phrase that earned it.
    timing: { shotDelay: { maxGridSeconds: 0.94 } },

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
        case 'interlock': {
          const despawn = updateInterlock(context, data);
          if (!despawn) maybeFireInterlockVolley(context, data);
          return despawn;
        }
      }
    },

    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'interlock') {
        interlocksCleared += 1;
        if (interlocksCleared >= INTERLOCK_COUNT) gunFired = true;
      }
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },

    // Every non-lethal armor chip pays a little; interlock armor pays more.
    scoreForHit: (_volleySize, enemy) => (enemy.kind === 'interlock' ? 110 : 55),

    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 900 : results.length * 110;
    },

    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // S is reserved for a run where the gun actually fired.
      if (gunFired && score >= 17000 && clearRate >= 0.85) return 'S';
      if (score >= 12000 && clearRate >= 0.7) return 'A';
      if (score >= 7000 && clearRate >= 0.5) return 'B';
      if (score >= 3200 && clearRate >= 0.28) return 'C';
      return 'D';
    },

    detailsForRun() {
      const hull = detonated ? 0 : Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hullHits);
      return [
        `Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`,
        `Interlocks ${interlocksCleared}/${INTERLOCK_COUNT}`,
        `${arcsIntercepted} arc${arcsIntercepted === 1 ? '' : 's'} intercepted`,
        gunFired && !detonated ? 'PAYLOAD AWAY — muzzle exit clean' : 'CHARGE CONTAINMENT FAILED',
      ];
    },
  };
}
