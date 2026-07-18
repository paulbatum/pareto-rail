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
import { MASS_DRIVER_BPM, RUN_DURATION, SHOT_TIME, bar } from './timing';

// MASS DRIVER — you are the payload chambered in an orbital railgun, riding the
// bore from breech to muzzle over exactly sixty seconds. One accelerator ring
// passes on every beat, the run strictly accelerates, and on the downbeat of
// bar 28 the gun fires whether or not you are ready:
//
//   0–4   injection  Breech. A counter-rotating threader pair, a four-coil rank.
//   4–12  stage-1    Call-and-response: coil ranks alternate with threader weaves.
//   12–20 stage-2    Density and return fire; paired capacitors; then a breath.
//   20–28 interlock  Six jammed safety clamps brood over the bore on a deadline.
//   28    THE SHOT   ~3× speed surge, whiteout, muzzle exit — or detonation.
//   28–32 muzzle     Open space. Empty on purpose. The run ends at 60 s.

export { MASS_DRIVER_BPM, RUN_DURATION, SHOT_TIME, bar } from './timing';

export const PLAYER_HEALTH = 3;
export const INTERLOCK_COUNT = 6;

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

// Spawn-timeline data is immutable (the engine reuses the timeline across
// runs); per-run mutable state lives in the runner's enemyState bags. Arc bolts
// are launched dynamically and get a fresh data object per shot.
export type MassDriverSpawnData =
  | { role: 'coil'; lead: number; angle: number; drift: number; fires: boolean; firstShotAt: number }
  | {
      role: 'threader';
      lead: number;
      phase: number;
      omega: number;
      helixRadius: number;
      fromX: number;
      toX: number;
      y: number;
      arcLift: number;
      crossTime: number;
      delay: number;
    }
  | { role: 'capacitor'; lead: number; x: number; y: number; roll: number; driftPhase: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
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

// ---- speed profile → rail easing --------------------------------------------

// The gun only ever speeds up. A chambered crawl off the breech, a steady climb
// through the stages, a harder pull as the charge builds, then the bar-28
// downbeat lands a sudden ~3× surge — THE SHOT — that eases off only slightly
// in open space. The rail easing is the normalized integral of this curve, so
// ring spacing and camera speed are the same authored object.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.46],
  [bar(4), 0.6],
  [bar(12), 0.84],
  [bar(20), 1.08],
  [bar(26), 1.26],
  [bar(28), 1.48],
  [bar(28, 0.25), 4.5],
  [bar(30), 3.9],
  [bar(32), 3.5],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, RUN_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// The camera reaches the end of the barrel exactly on the shot: rings, rails,
// and barrel wall all stop at this rail parameter.
export const MUZZLE_U = massDriverRunProgress(SHOT_TIME);

export const RAIL_LENGTH = 1600;

// ---- rail -------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = MathUtils.clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic bore: a long line mostly straight down −z with a gentle weave
// so the tunnel reads and enemies get parallax without the camera clipping the
// wall (bore radius ~12). The weave tapers to zero right at the muzzle so the
// exit is clean and straight; past the muzzle the line lifts gently upward
// into the black. No randomness — the same barrel every run.
export function createMassDriverRail() {
  const SEGMENTS = 26;
  const points: Vector3[] = [];
  for (let i = 0; i <= SEGMENTS; i += 1) {
    const along = i / SEGMENTS;
    const z = -RAIL_LENGTH * along;
    const taper = 1 - smoothstep(MUZZLE_U - 0.05, MUZZLE_U + 0.1, along);
    const x = taper * (2.4 * Math.sin(along * Math.PI * 2 * 6) + 1.0 * Math.sin(along * Math.PI * 2 * 2.5 + 1.9));
    const y = taper * (1.7 * Math.sin(along * Math.PI * 2 * 4 + 0.6) + 0.5 * Math.sin(along * Math.PI * 2 * 9));
    const rise = 30 * smoothstep(MUZZLE_U, 1, along) ** 1.5;
    points.push(new Vector3(x, y + rise, z));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.4);
}

// ---- spawn timeline ---------------------------------------------------------

// The 60° FOV is wide, so modest offsets project near screen center; pushing
// coils out to the bore wall is what makes a rank sweep the whole frame rim
// instead of clustering dead-center.
const BORE_X = 10.6;
const BORE_Y = 9.6;
const BORE_Y_BIAS = 0.4;

// Clock positions around the frame rim, in radians (0 = 3 o'clock, CCW).
const CLOCK = {
  twelve: Math.PI / 2,
  two: Math.PI / 6,
  four: -Math.PI / 6,
  six: -Math.PI / 2,
  eight: (-5 * Math.PI) / 6,
  ten: (5 * Math.PI) / 6,
};

// Coil sentries clamp to the bore wall ahead of the camera and slide slowly
// around the circumference. Ranks are staggered a beat-fraction apart so the
// rank sweeps the rim rather than popping in at once.
const coilRank = (
  time: number,
  lead: number,
  entries: Array<{ angle: number; fires?: boolean }>,
): MassDriverSpawnEntry[] =>
  entries.map((entry, index) => ({
    time: time + index * 0.14,
    kind: 'coil',
    data: {
      role: 'coil',
      lead,
      angle: entry.angle,
      drift: (index % 2 === 0 ? 1 : -1) * (0.18 + 0.03 * (index % 3)),
      fires: entry.fires ?? false,
      firstShotAt: 1.4 + (index % 3) * 0.55,
    },
  }));

// Threaders cross the full frame width along a shallow vertical arc while the
// body winds a helix around that path. Alternating omega signs inside a wave
// read as counter-rotating double helices.
const threaderWeave = (
  time: number,
  lead: number,
  runs: Array<{
    fromX: number;
    toX: number;
    y: number;
    omega: number;
    helixRadius?: number;
    arcLift?: number;
    crossTime?: number;
  }>,
): MassDriverSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.11,
    kind: 'threader',
    data: {
      role: 'threader',
      lead,
      phase: index * 1.9,
      omega: run.omega,
      helixRadius: run.helixRadius ?? 3.4,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arcLift: run.arcLift ?? 1.3,
      crossTime: run.crossTime ?? 2.2,
      delay: index * 0.3,
    },
  }));

// Capacitor banks drift mid-bore: two hits shear the insulator staves off,
// then the exposed core takes two more.
const capacitors = (time: number, entries: Array<{ x: number; y: number; lead?: number }>): MassDriverSpawnEntry[] =>
  entries.map((entry, index) => ({
    time: time + index * 0.35,
    kind: 'capacitor',
    hitStages: [2, 2],
    data: {
      role: 'capacitor',
      lead: entry.lead ?? 4.4,
      x: entry.x,
      y: entry.y,
      roll: (index % 2 === 0 ? 1 : -1) * 0.45,
      driftPhase: index * 2.4,
    },
  }));

// The six jammed interlocks arrive in two ranks of three around the rim.
const interlockRank = (
  time: number,
  holdLead: number,
  entries: Array<{ angle: number; radius: number; fires?: boolean; index: number }>,
): MassDriverSpawnEntry[] =>
  entries.map((entry, index) => ({
    time: time + index * 0.2,
    kind: 'interlock',
    hitStages: [1, 2],
    data: {
      role: 'interlock',
      approachLead: holdLead + 1.6,
      holdLead,
      settleTime: 2.2,
      angle: entry.angle,
      radius: entry.radius,
      fires: entry.fires ?? false,
      index: entry.index,
    },
  }));

function buildTimeline(): MassDriverSpawnEntry[] {
  return [
    // --- injection (bars 0–4): the double-helix reveal, then a four-coil rank. ---
    ...threaderWeave(bar(1), 3.4, [
      { fromX: -10.5, toX: 10.5, y: 1.6, omega: 3.6, helixRadius: 3.2 },
      { fromX: 10.5, toX: -10.5, y: 3.2, omega: -3.6, helixRadius: 3.2 },
    ]),
    ...coilRank(bar(2.25), 3.2, [{ angle: CLOCK.ten }, { angle: CLOCK.twelve }, { angle: CLOCK.two }, { angle: CLOCK.six }]),
    ...threaderWeave(bar(3.25), 3.3, [
      { fromX: -11, toX: 11, y: -0.6, omega: 4, helixRadius: 3.6 },
      { fromX: 11, toX: -11, y: 4.2, omega: -4, helixRadius: 3.2 },
      { fromX: -11, toX: 11, y: 2, omega: 4, helixRadius: 3.8 },
    ]),

    // --- stage-1 (bars 4–12): two-bar call-and-response, first capacitor mid-section. ---
    ...coilRank(bar(4), 3.1, [
      { angle: CLOCK.eight },
      { angle: CLOCK.ten },
      { angle: CLOCK.twelve },
      { angle: CLOCK.two },
      { angle: CLOCK.four },
    ]),
    ...threaderWeave(bar(6), 3.2, [
      { fromX: -11.5, toX: 11.5, y: 0.2, omega: 4.2, helixRadius: 3.9 },
      { fromX: 11.5, toX: -11.5, y: 4.4, omega: -4.2, helixRadius: 3.4 },
      { fromX: -11.5, toX: 11.5, y: -1, omega: 4.2, helixRadius: 3.2 },
      { fromX: 11.5, toX: -11.5, y: 5.6, omega: -4.2, helixRadius: 3 },
    ]),
    ...coilRank(bar(8), 3.0, [{ angle: CLOCK.two }, { angle: CLOCK.four }, { angle: CLOCK.eight }, { angle: CLOCK.ten }]),
    ...capacitors(bar(8.5), [{ x: -4.6, y: 3.4, lead: 3.6 }]),
    ...threaderWeave(bar(10), 3.1, [
      { fromX: -11.5, toX: 11.5, y: 0.6, omega: 4.4, helixRadius: 4 },
      { fromX: 11.5, toX: -11.5, y: 3.4, omega: -4.4, helixRadius: 3.4 },
      { fromX: -11.5, toX: 11.5, y: 5.2, omega: 4.4, helixRadius: 3 },
    ]),
    ...coilRank(bar(11), 3.0, [{ angle: CLOCK.twelve }, { angle: CLOCK.six }, { angle: CLOCK.four }]),

    // --- stage-2 (bars 12–20): larger ranks, several firing; paired capacitors. ---
    ...coilRank(bar(12), 2.9, [
      { angle: CLOCK.ten, fires: true },
      { angle: CLOCK.twelve },
      { angle: CLOCK.two, fires: true },
      { angle: CLOCK.six },
      { angle: CLOCK.eight },
    ]),
    ...threaderWeave(bar(13.5), 2.9, [
      { fromX: -12, toX: 12, y: 0.2, omega: 4.7, helixRadius: 4.1 },
      { fromX: 12, toX: -12, y: 4.6, omega: -4.7, helixRadius: 3.5 },
      { fromX: -12, toX: 12, y: 2.4, omega: 4.7, helixRadius: 3.2 },
    ]),
    ...coilRank(bar(15), 2.8, [
      { angle: CLOCK.four, fires: true },
      { angle: CLOCK.six },
      { angle: CLOCK.eight, fires: true },
      { angle: CLOCK.twelve },
    ]),
    ...capacitors(bar(16), [{ x: 4.8, y: -2.6, lead: 3.4 }, { x: -5.0, y: 3.0, lead: 3.7 }]),
    ...threaderWeave(bar(17), 2.9, [
      { fromX: -12, toX: 12, y: -0.4, omega: 4.9, helixRadius: 4 },
      { fromX: 12, toX: -12, y: 5, omega: -4.9, helixRadius: 3.4 },
      { fromX: -12, toX: 12, y: 2.2, omega: 4.9, helixRadius: 3.6 },
      { fromX: 12, toX: -12, y: 3.6, omega: -4.9, helixRadius: 3.1 },
    ]),
    ...coilRank(bar(18), 2.8, [
      { angle: CLOCK.twelve, fires: true },
      { angle: CLOCK.ten },
      { angle: CLOCK.two },
      { angle: CLOCK.six, fires: true },
    ]),
    ...threaderWeave(bar(18.75), 2.7, [
      { fromX: 11.5, toX: -11.5, y: 1.2, omega: -5.1, helixRadius: 3.4, crossTime: 2 },
      { fromX: -11.5, toX: 11.5, y: 3.8, omega: 5.1, helixRadius: 3, crossTime: 2 },
    ]),
    // (bar 19.4–20: a deliberate breath of empty air before the klaxon.)

    // --- interlock (bars 20–28): two ranks of three; threader chaff between volleys. ---
    ...interlockRank(bar(20), 1.05, [
      { angle: CLOCK.ten, radius: 9.4, index: 0 },
      { angle: CLOCK.twelve, radius: 8.2, index: 1, fires: true },
      { angle: CLOCK.two, radius: 9.4, index: 2 },
    ]),
    ...interlockRank(bar(22), 0.95, [
      { angle: CLOCK.four, radius: 9.4, index: 3, fires: true },
      { angle: CLOCK.six, radius: 8, index: 4 },
      { angle: CLOCK.eight, radius: 9.4, index: 5 },
    ]),
    ...threaderWeave(bar(22.5), 2.8, [
      { fromX: -11.5, toX: 11.5, y: 1.6, omega: 5.1, helixRadius: 3.2, crossTime: 1.9 },
      { fromX: 11.5, toX: -11.5, y: 3.4, omega: -5.1, helixRadius: 2.9, crossTime: 1.9 },
    ]),
    ...threaderWeave(bar(24), 2.7, [
      { fromX: 11.5, toX: -11.5, y: 2.2, omega: -5.3, helixRadius: 3.1, crossTime: 1.8 },
      { fromX: -11.5, toX: 11.5, y: 4, omega: 5.3, helixRadius: 2.8, crossTime: 1.8 },
    ]),
    ...threaderWeave(bar(25.25), 2.5, [
      { fromX: -11, toX: 11, y: 1.2, omega: 5.4, helixRadius: 3, crossTime: 1.7 },
      { fromX: 11, toX: -11, y: 3.6, omega: -5.4, helixRadius: 2.7, crossTime: 1.7 },
    ]),
    ...threaderWeave(bar(26.25), 2.2, [
      { fromX: 11, toX: -11, y: 1.8, omega: -5.6, helixRadius: 2.8, crossTime: 1.6 },
      { fromX: -11, toX: 11, y: 3.8, omega: 5.6, helixRadius: 2.5, crossTime: 1.6 },
    ]),
    ...threaderWeave(bar(27), 1.7, [
      { fromX: -10.5, toX: 10.5, y: 2.2, omega: 5.8, helixRadius: 2.5, crossTime: 1.45 },
      { fromX: 10.5, toX: -10.5, y: 3.4, omega: -5.8, helixRadius: 2.3, crossTime: 1.45 },
    ]),
    // (bars 28–32: muzzle exit — intentionally empty. Resist the urge to fill it.)
  ];
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = buildTimeline().sort((a, b) => a.time - b.time);

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  coil: 120,
  threader: 150,
  capacitor: 350,
  arc: 60,
  interlock: 500,
};

const BOLT_MAX_AGE = 12;

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  // Bolts the player has fired on; cleared when the bolt resolves, so an arc
  // only counts as intercepted when the shot actually connects before impact.
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
    summoned = true;
    bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('playerhit', ({ damage }) => {
    hitsTaken += 1;
    // Only the interlock deadline deals a 99-point blow: the barrel going up.
    if (damage >= 90) detonated = true;
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (!interlockIds.delete(enemyId)) return;
    interlocksDown += 1;
    if (interlocksDown >= INTERLOCK_COUNT) bus.emit('bossphase', { phase: 'destroyed' });
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    interlockIds.delete(enemyId);
  });

  function fireArc(context: MassDriverUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arc',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  function faceBore(context: MassDriverUpdate, anchorU: number) {
    const center = context.curve.getPointAt(MathUtils.clamp(anchorU, 0, 1));
    context.enemy.mesh.lookAt(center);
  }

  // ---- movement -------------------------------------------------------------

  function updateCoil(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'coil' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Slide slowly around the circumference on the bore wall, facing inward.
    const angle = data.angle + age * data.drift;
    const offset = new Vector3(Math.cos(angle) * BORE_X, Math.sin(angle) * BORE_Y + BORE_Y_BIAS, 0);

    if (data.fires) {
      // Telegraph, then commit: rear back against the wall, lunge inward, and
      // loose an arc bolt at the payload.
      const state = context.enemyState(() => ({ nextAt: data.firstShotAt }));
      const untilShot = state.nextAt - age;
      if (untilShot < 1.0 && untilShot > 0.6) offset.z += (1.0 - untilShot) * 6.5;
      else if (untilShot <= 0.6 && untilShot > 0) offset.z -= (0.6 - untilShot) * 12;
      // Visuals read this to run the eye hot during the telegraph.
      enemy.mesh.userData.telegraph = untilShot < 1.0 && untilShot > 0 ? 1 - untilShot : 0;
      if (age >= state.nextAt) {
        state.nextAt = age + 3.4;
        fireArc(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    faceBore(context, anchorU);
    enemy.mesh.rotateZ(age * 0.55 + enemy.id * 0.9);
    return runProgress > anchorU + 0.013;
  }

  function updateThreader(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'threader' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    // Leaves once the crossing completes or the camera overtakes it.
    if (t > 1.2 || runProgress > anchorU + 0.013) return true;

    const sample = (tc: number, timeOffset: number) => {
      const clamped = MathUtils.clamp(tc, 0, 1);
      const eased = clamped * clamped * (3 - 2 * clamped);
      const swell = Math.sin(clamped * Math.PI);
      const helix = data.phase + (age + timeOffset) * data.omega;
      const radius = 1.5 + data.helixRadius * swell;
      return new Vector3(
        MathUtils.lerp(data.fromX, data.toX, eased) + Math.cos(helix) * radius,
        data.y + swell * data.arcLift + Math.sin(helix) * radius,
        0,
      );
    };

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, sample(t, 0)));
    // The nose points a moment ahead of its own travel.
    enemy.mesh.lookAt(offsetFromRail(curve, anchorU, sample(t + 0.05, 0.05)));
    return false;
  }

  function updateCapacitor(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'capacitor' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Lazy figure-drift mid-bore, facing the camera with a slow alternating roll.
    const offset = new Vector3(
      data.x + Math.sin(age * 0.55 + data.driftPhase) * 1.3,
      data.y + Math.sin(age * 0.42 + data.driftPhase * 1.7 + 1.1) * 0.8,
      0,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.8) * data.roll);
    // Exposed core (stage 1): brighten and shudder at high frequency.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 24) * 0.13;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.11;
    }
    return runProgress > anchorU + 0.013;
  }

  function updateBolt(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'bolt' }>) {
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
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Homes on the camera, accelerating and braking as it closes.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 13,
      accel: 3.2,
      turnRate: 2.5,
    });
    enemy.mesh.position.copy(data.position);
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, age, curve } = context;
    // The deadline: any interlock still standing when the charge peaks takes
    // the barrel — and the payload — with it.
    if (runTime >= SHOT_TIME) {
      context.damagePlayer(99);
      return true;
    }
    // Station-keeping: hold a roughly constant lead ahead of the camera so all
    // six clamps brood at the frame rim for the whole section — never swallowed
    // by fog, never overtaken before the shot.
    const settle = smoothstep(0, data.settleTime, age);
    const hold = MathUtils.lerp(data.approachLead, data.holdLead, settle);
    const anchorU = Math.min(MUZZLE_U, massDriverRunProgress(runTime + hold));
    const breathe = 1 + Math.sin(age * 2 + data.index * 1.3) * 0.03;
    const grind = Math.sin(age * 1.5 + data.index) * 0.16;
    const offset = new Vector3(
      Math.cos(data.angle) * data.radius * breathe,
      Math.sin(data.angle) * data.radius * breathe + BORE_Y_BIAS,
      grind,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    faceBore(context, anchorU);
    enemy.mesh.rotateZ(grind * 0.4 + data.index * 0.5);
    // Cowl popped: the exposed actuator core shudders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 21) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 16) * 0.1;
    }
    if (data.fires) {
      const state = context.enemyState(() => ({ nextAt: 2.6 + data.index * 0.6 }));
      if (age >= state.nextAt) {
        state.nextAt = age + 3.2;
        fireArc(context, enemy.mesh.position);
      }
    }
    return false;
  }

  // ---- level definition -----------------------------------------------------

  return {
    duration: RUN_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    // At 128 BPM the beat is 0.469 s and the pre-shot barrel cruises at rail
    // speeds the default profile was tuned for, so this level deliberately
    // inherits the engine's tempo-adaptive shot timing and 32nd-note SFX snap.
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'coil':
          return updateCoil(context, data);
        case 'threader':
          return updateThreader(context, data);
        case 'capacitor':
          return updateCapacitor(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'interlock':
          return updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'arc') arcsIntercepted += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Every non-lethal armor chip (capacitor stave, interlock cowl) pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      // A clean full volley is worth a lot — a perfect six is the level's jackpot.
      return results.length === 6 ? 520 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // S requires the gun to have actually fired — all six interlocks down
      // before bar 28 — on top of a near-total clear: the simulator's seeded
      // imperfect runs (~96% clear) land A; S is the run you replay for.
      if (interlocksDown >= INTERLOCK_COUNT && score >= 12500 && clearRate >= 0.97) return 'S';
      if (score >= 8200 && clearRate >= 0.62) return 'A';
      if (score >= 4400 && clearRate >= 0.42) return 'B';
      if (score >= 1700 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      // The detonation is a single 99-point playerhit: count it as total hull loss.
      const hull = detonated ? 0 : Math.max(0, PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${PLAYER_HEALTH}`, `Interlocks ${interlocksDown}/${INTERLOCK_COUNT}`];
      if (interlocksDown >= INTERLOCK_COUNT) lines.push('PAYLOAD AWAY — muzzle exit clean');
      else if (detonated) lines.push('CHARGE CONTAINMENT FAILED');
      if (arcsIntercepted > 0) lines.push(`${arcsIntercepted} arc${arcsIntercepted === 1 ? '' : 's'} intercepted`);
      return lines;
    },
  };
}
