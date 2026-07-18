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
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { massDriverRunState, resetMassDriverRunState } from './state';
import {
  DEADLINE_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_RUN_DURATION,
  MASS_DRIVER_TIME,
  massDriverRunProgress,
  SHOT_TIME,
} from './timing';

// You are the payload chambered in an orbital railgun, riding the bore from
// breech to muzzle over exactly sixty seconds. Five hostiles share the barrel:
// wall-riding coil sentries, corkscrewing threader drones, two-stage capacitor
// banks, interceptable arc bolts, and the six jammed safety interlocks that
// must all die before the bar-28 downbeat — the gun fires either way.

export { MASS_DRIVER_BPM, MASS_DRIVER_RUN_DURATION } from './timing';
export const MASS_DRIVER_PLAYER_HEALTH = 3;

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';
export type MassDriverTargetKind = MassDriverEnemyKind | 'letter';

// Timeline entries carry immutable config only — the engine reuses the
// timeline across runs. Per-enemy runtime state (fire cadence, arc flight)
// lives in enemyState bags or fresh data objects for dynamic spawns.
export type MassDriverSpawnData =
  | { role: 'coil'; lead: number; clock: number; slideDir: number; fires: boolean }
  | {
    role: 'threader';
    lead: number;
    fromX: number;
    toX: number;
    y: number;
    arc: number;
    cross: number;
    delay: number;
    helixSign: number;
  }
  | { role: 'capacitor'; leadStart: number; leadEnd: number; closeTime: number; x: number; y: number }
  | { role: 'arc'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; clock: number; fires: boolean };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// ---- rail -------------------------------------------------------------------

// Deterministic, no randomness: a long line running mostly straight down the
// bore with a gentle weave. The weave tapers to zero right at the muzzle so
// the exit is clean and straight, and past the muzzle the line lifts gently
// upward into the black.
const RAIL_SPAN = 1600;
const WEAVE_FULL_UNTIL = 620;
const WEAVE_ZERO_AT = 880;
const LIFT_FROM = 1100;

export function createMassDriverRail() {
  const points: Vector3[] = [];
  for (let z = 0; z <= RAIL_SPAN; z += 50) {
    const taperT = MathUtils.clamp((z - WEAVE_FULL_UNTIL) / (WEAVE_ZERO_AT - WEAVE_FULL_UNTIL), 0, 1);
    const taper = 1 - taperT * taperT * (3 - 2 * taperT);
    const x = 2.6 * Math.sin((z * Math.PI * 2) / 190) * taper;
    let y = 1.8 * Math.sin((z * Math.PI * 2) / 260 + 1.3) * taper;
    if (z > LIFT_FROM) {
      const liftT = (z - LIFT_FROM) / (RAIL_SPAN - LIFT_FROM);
      y += liftT * liftT * 46;
    }
    points.push(new Vector3(x, y, -z));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- spawn timeline ---------------------------------------------------------

const time = MASS_DRIVER_TIME;
const bar = (index: number, beat = 0) => time.bar(index, beat);

/** Clock hour (12 = straight up) to radians. */
const clockAngle = (hour: number) => Math.PI / 2 - (hour % 12) * (Math.PI / 6);

const COIL_RADIUS = 8.2;
const COIL_LEAD = 3.8;
const THREADER_LEAD = 3.7;

// Coils arrive in "ranks" at clock positions around the frame rim, staggered a
// beat-fraction apart so a rank sweeps the whole rim rather than clustering.
const coilRank = (
  at: number,
  hours: number[],
  options: { fires?: number[]; lead?: number } = {},
): MassDriverSpawnEntry[] =>
  hours.map((hour, index) => ({
    time: at + index * time.beats(0.25),
    kind: 'coil',
    data: {
      role: 'coil',
      lead: options.lead ?? COIL_LEAD,
      clock: hour,
      slideDir: index % 2 === 0 ? 1 : -1,
      fires: options.fires?.includes(hour) ?? false,
    },
  }));

// Threaders cross the full frame width along a shallow vertical arc while the
// body winds a helix around that path; sign alternates within a wave so pairs
// read as counter-rotating double helices.
const threaderWave = (
  at: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; cross?: number }>,
): MassDriverSpawnEntry[] =>
  runs.map((run, index) => ({
    time: at + index * time.beats(0.25),
    kind: 'threader',
    data: {
      role: 'threader',
      lead: THREADER_LEAD,
      // Authored spans are frame-width at ±15; keep the actual path inside
      // the bore so threaders never enter from behind the wall panels.
      fromX: run.fromX * 0.68,
      toX: run.toX * 0.68,
      y: run.y,
      arc: run.arc,
      cross: run.cross ?? 2.7,
      delay: run.delay ?? index * 0.4,
      helixSign: index % 2 === 0 ? 1 : -1,
    },
  }));

const capacitors = (at: number, spots: Array<[number, number]>): MassDriverSpawnEntry[] =>
  spots.map(([x, y], index) => ({
    time: at + index * time.beats(0.5),
    kind: 'capacitor',
    hitStages: [2, 2],
    data: { role: 'capacitor', leadStart: 5.6, leadEnd: 3.1, closeTime: 6, x, y },
  }));

// The six jammed interlocks: two ranks of three around the rim. One hit pops
// the cowl, two more kill the actuator core. Two of the six fire arc bolts.
const interlockRank = (at: number, hours: number[], firingHours: number[]): MassDriverSpawnEntry[] =>
  hours.map((hour, index) => ({
    time: at + index * time.beats(0.5),
    kind: 'interlock',
    hitStages: [1, 2],
    data: { role: 'interlock', clock: hour, fires: firingHours.includes(hour) },
  }));

function createMassDriverTimeline(): MassDriverSpawnEntry[] {
  return sortTimeline<MassDriverEnemyKind, MassDriverSpawnData>([
    // --- Injection (bars 0-4): the first drones teach the sweep. A
    // counter-rotating threader pair opens as the double-helix reveal.
    ...threaderWave(bar(0, 2), [
      { fromX: -15, toX: 15, y: 1.6, arc: 2.2, delay: 0, cross: 3.1 },
      { fromX: 15, toX: -15, y: 1.6, arc: 2.2, delay: 0, cross: 3.1 },
    ]),
    ...coilRank(bar(1, 1), [12, 3, 6, 9]),
    ...threaderWave(bar(2, 2), [
      { fromX: -15, toX: 15, y: 3.4, arc: 1.6 },
      { fromX: 15, toX: -15, y: -1.4, arc: 2.4 },
    ]),
    ...threaderWave(bar(3, 1), [{ fromX: -15, toX: 15, y: 0.6, arc: 3 }]),

    // --- Stage-1 (bars 4-12): a two-bar call-and-response between coil ranks
    // and threader weaves; the first capacitor drifts in mid-section.
    ...coilRank(bar(4), [10, 2, 6]),
    ...threaderWave(bar(6), [
      { fromX: -15, toX: 15, y: 2.6, arc: 2 },
      { fromX: 15, toX: -15, y: 0.2, arc: 2.6 },
      { fromX: -15, toX: 15, y: -2, arc: 1.8 },
    ]),
    ...coilRank(bar(8), [12, 3, 7, 9]),
    ...capacitors(bar(8, 2), [[2.4, 1.2]]),
    ...threaderWave(bar(10), [
      { fromX: 15, toX: -15, y: 3.2, arc: 1.8 },
      { fromX: -15, toX: 15, y: 1, arc: 2.4 },
      { fromX: 15, toX: -15, y: -1.6, arc: 2 },
    ]),
    ...coilRank(bar(11), [4, 6, 8]),

    // --- Stage-2 (bars 12-20): density plus return fire. Larger coil ranks
    // with several firing, threader staggers, paired capacitors — then a
    // deliberate breath of empty air just before the klaxon.
    ...coilRank(bar(12), [12, 2, 4, 6, 8, 10], { fires: [2, 8] }),
    ...threaderWave(bar(13, 2), [
      { fromX: -15, toX: 15, y: 0.4, arc: 3, delay: 0 },
      { fromX: 15, toX: -15, y: 2.8, arc: 2, delay: 0.3 },
      { fromX: -15, toX: 15, y: -2.2, arc: 2.2, delay: 0.6 },
      { fromX: 15, toX: -15, y: 4, arc: 1.4, delay: 0.9 },
    ]),
    ...capacitors(bar(15), [[-4.2, 1.8], [4.2, -1]]),
    ...coilRank(bar(16), [1, 5, 7, 11, 12], { fires: [1, 7] }),
    ...threaderWave(bar(17), [
      { fromX: 15, toX: -15, y: 1.8, arc: 2.4, delay: 0 },
      { fromX: -15, toX: 15, y: -0.8, arc: 2.6, delay: 0.35 },
      { fromX: 15, toX: -15, y: 3.6, arc: 1.6, delay: 0.7 },
    ]),
    ...coilRank(bar(17, 3), [2, 4, 8, 10], { fires: [10], lead: 4.2 }),

    // (bars 18.5-20: screen kept clear — the breath before the klaxon)

    // --- Interlock (bars 20-28): the six clamps arrive in two ranks of three
    // around the rim; threader chaff in pairs keeps the volleys mixed.
    ...interlockRank(bar(20), [12, 4, 8], [4]),
    ...interlockRank(bar(20, 2), [2, 6, 10], [10]),
    ...threaderWave(bar(23), [
      { fromX: -15, toX: 15, y: 2.2, arc: 1.8, cross: 2.3 },
      { fromX: 15, toX: -15, y: -1.2, arc: 2.2, cross: 2.3 },
    ]),
    ...threaderWave(bar(25, 2), [
      { fromX: 15, toX: -15, y: 3, arc: 1.6, cross: 2.2 },
      { fromX: -15, toX: 15, y: 0, arc: 2.4, cross: 2.2 },
    ]),

    // --- Muzzle (bars 28-32): intentionally empty. The payoff for surviving.
  ]);
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = createMassDriverTimeline();

// ---- scoring ----------------------------------------------------------------

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  coil: 100,
  threader: 130,
  capacitor: 380,
  arc: 60,
  interlock: 500,
};

const ARC_MAX_AGE = 12;

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const state = massDriverRunState;
  const interceptions = new Set<number>();
  let shotDamageApplied = false;

  bus.on('runstart', () => {
    resetMassDriverRunState();
    interceptions.clear();
    shotDamageApplied = false;
    // The module timeline is shared and reused across runs and runner
    // instances; undo the deadline lock-gate on every interlock entry.
    for (const entry of MASS_DRIVER_TIMELINE) {
      if (entry.data.role === 'interlock') entry.lockable = true;
    }
  });

  bus.on('playerhit', () => {
    state.hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('spawn', ({ kind }) => {
    if (kind === 'interlock') state.interlocksAlive += 1;
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
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

  // ---- movement -------------------------------------------------------------

  // Coil: a wall-riding sentry. Clamps to the bore wall ahead of the camera and
  // slides slowly around the circumference, always facing inward with a lazy
  // spin. Firing coils telegraph — rear back, then a fast lunge inward — before
  // loosing an arc bolt.
  function updateCoil(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'coil' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const angle = clockAngle(data.clock) + age * 0.16 * data.slideDir;
    const offset = new Vector3(Math.cos(angle) * COIL_RADIUS, Math.sin(angle) * COIL_RADIUS, 0);

    if (data.fires) {
      const fire = context.enemyState(() => ({ nextAt: 2.1, shotsLeft: 2 }));
      const untilShot = fire.nextAt - age;
      if (untilShot < 0.85 && untilShot > 0.5) offset.multiplyScalar(1 + (0.85 - untilShot) * 0.5); // rear back into the wall
      else if (untilShot <= 0.5 && untilShot > 0) offset.multiplyScalar(1 - (0.5 - untilShot) * 0.6); // fast lunge inward
      if (fire.shotsLeft > 0 && age >= fire.nextAt) {
        fire.shotsLeft -= 1;
        fire.nextAt = age + 3.6;
        fireArc(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    // Face inward, toward the bore axis, with a lazy spin around the lens.
    enemy.mesh.lookAt(offsetFromRail(curve, anchorU, new Vector3(0, 0, 0)));
    enemy.mesh.rotateZ(age * 0.7 + enemy.id);
    return runProgress > anchorU + 0.014;
  }

  function updateThreader(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'threader' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.cross;
    if (t > 1.12 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const helix = 1.15;
    const at = (tt: number) => {
      const eased = tt * tt * (3 - 2 * tt);
      const phase = tt * Math.PI * 2 * 3 * data.helixSign + enemy.id;
      return new Vector3(
        MathUtils.lerp(data.fromX, data.toX, eased) + Math.cos(phase) * helix,
        data.y + Math.sin(tt * Math.PI) * data.arc + Math.sin(phase) * helix,
        0,
      );
    };
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, at(clamped)));
    // The nose points a moment ahead of its travel.
    enemy.mesh.lookAt(offsetFromRail(curve, anchorU, at(Math.min(1, clamped + 0.05))));
    enemy.mesh.rotateZ(clamped * Math.PI * 2 * 3 * data.helixSign);
    return false;
  }

  // Capacitor: a fat two-stage insulated bank drifting mid-bore. It faces the
  // camera with a slow alternating roll and a lazy figure-drift; once the
  // staves shear off, the exposed core shudders at high frequency.
  function updateCapacitor(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'capacitor' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const close = MathUtils.clamp(age / data.closeTime, 0, 1);
    const lead = MathUtils.lerp(data.leadStart, data.leadEnd, close * close * (3 - 2 * close));
    const anchorU = railAnchor(lead);
    const offset = new Vector3(
      data.x + Math.sin(age * 0.45) * 1.7,
      data.y + Math.sin(age * 0.9 + 1.2) * 1.15,
      0,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 24) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.1;
    }
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.55) * 0.65);
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
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Ball lightning hunts the camera, accelerating and braking as it closes.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 13,
      accel: 3.2,
      turnRate: 2.3,
    });
    enemy.mesh.position.copy(data.position);
    return age > ARC_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // Interlock: station-keeping. Each clamp holds a roughly constant lead ahead
  // of the camera, so all six brood over the bore at frame-rim clock positions
  // for the whole section and can never be overtaken or missed before the
  // shot. Any interlock still standing when the gun fires is the detonation.
  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, age, curve, camera, damagePlayer } = context;

    const sectionT = MathUtils.clamp((runTime - bar(20)) / (SHOT_TIME - bar(20)), 0, 1);
    // Tightening and closing in as the gun accelerates.
    const lead = MathUtils.lerp(2.6, 1.9, sectionT);
    const radius = MathUtils.lerp(8, 6.9, sectionT);
    const anchorU = massDriverRunProgress(Math.min(MASS_DRIVER_RUN_DURATION, runTime + lead));
    const angle = clockAngle(data.clock) + Math.sin(age * 0.3 + data.clock) * 0.06;
    const bob = Math.sin(age * 1.1 + data.clock * 2) * 0.35;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius + bob,
      0,
    )));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.5 + data.clock) * 0.18);
    if (enemy.hitStageIndex > 0) {
      // Cowl popped: the exposed actuator core shudders.
      enemy.mesh.position.x += Math.sin(age * 26) * 0.09;
      enemy.mesh.position.y += Math.cos(age * 21) * 0.08;
    }

    if (data.fires) {
      const fire = context.enemyState(() => ({ nextAt: 3.4, shotsLeft: 1 }));
      if (fire.shotsLeft > 0 && age >= fire.nextAt && runTime < DEADLINE_TIME - 1.2) {
        fire.shotsLeft -= 1;
        fireArc(context, enemy.mesh.position);
      }
    }

    if (runTime >= DEADLINE_TIME) {
      enemy.entry.lockable = false;
      if (state.outcome === 'pending') state.outcome = 'detonated';
    }
    if (runTime >= SHOT_TIME && state.outcome === 'detonated' && !shotDamageApplied) {
      // The barrel detonates with the payload inside it. damagePlayer honors a
      // short invulnerability window, so keep applying until the hit lands.
      damagePlayer(MASS_DRIVER_PLAYER_HEALTH);
      if (context.playerHealth <= 0) shotDamageApplied = true;
    }
    return false;
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: MASS_DRIVER_RUN_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    // The gun is fast and the finale is on a hard deadline: cap the coarsest
    // shot grid well under the engine default so volleys resolve inside the
    // interlock window.
    timing: { shotDelay: { maxGridSeconds: 0.95 } },
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
      if (enemy.kind === 'arc') state.arcsIntercepted += 1;
      if (enemy.kind === 'interlock') {
        state.interlocksDown += 1;
        state.interlocksAlive = Math.max(0, state.interlocksAlive - 1);
        if (state.interlocksDown >= 6 && state.outcome === 'pending') state.outcome = 'fired';
      }
      // Volleys reward locking several targets at once.
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Every non-lethal armor chip pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      // A clean full volley is the signature play — a perfect six is worth a lot.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // S rank requires the gun to have actually fired.
      if (state.outcome === 'fired' && score >= 11800 && clearRate >= 0.9) return 'S';
      if (score >= 8200 && clearRate >= 0.65) return 'A';
      if (score >= 4800 && clearRate >= 0.45) return 'B';
      if (score >= 2000 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      // A detonation counts as total hull loss.
      const hull = state.outcome === 'detonated' ? 0 : Math.max(0, MASS_DRIVER_PLAYER_HEALTH - state.hitsTaken);
      const lines = [
        `Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`,
        `Interlocks cleared ${state.interlocksDown}/6`,
        `Arcs intercepted ${state.arcsIntercepted}`,
      ];
      if (state.outcome === 'fired') lines.push('PAYLOAD AWAY — muzzle exit clean');
      else if (state.outcome === 'detonated') lines.push('CHARGE CONTAINMENT FAILED');
      else lines.push('PAYLOAD LOST IN THE BORE');
      return lines;
    },
  };
}
