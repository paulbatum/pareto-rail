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
import {
  BEAT_SECONDS,
  CHARGE_TIME,
  FIRE_BEAT,
  FIRE_TIME,
  INTERLOCK_TIME,
  MASS_DRIVER_BPM,
  MD_DURATION,
  MD_TIME,
  bar,
} from './timing';

// MASS DRIVER — riding a payload down an orbital railgun. The barrel is a
// 60-second tunnel of accelerator rings crossed exactly one per beat; the
// speed profile and the score are the same object. Sections:
//
//   Injection     (bars 0–8)    breech glow, first defense drones.
//   Acceleration  (bars 8–16)   full pulse, sentinels wake up.
//   Overdrive     (bars 16–24)  violet heat, dense drone traffic.
//   Charge        (bars 24–30)  the safety interlocks are jammed and the
//                               firing charge is already building. Blow all
//                               six clamps off the payload collar before the
//                               charge peaks at bar 30 — or ride the breach
//                               detonation.
//   Launch        (bars 30–32)  the gun fires. Muzzle exit at ~3.4× speed,
//                               open space, silence.

export { FIRE_TIME, CHARGE_TIME, INTERLOCK_TIME, MASS_DRIVER_BPM, MD_DURATION } from './timing';
export const MD_PLAYER_HEALTH = 3;
export const INTERLOCK_COUNT = 6;
export const TUNNEL_RADIUS = 8.5;
/** Interlock collar paces this many seconds ahead of the camera, parking at the muzzle. */
const COLLAR_LEAD = 1.45;
export const COLLAR_RADIUS = 6.2;

export type MdEnemyKind = 'weaver' | 'stator' | 'sentinel' | 'bolt' | 'interlock';

// Timeline data is immutable across runs; per-enemy state lives in enemyState
// bags and boss state is reset from `runstart`.
export type MdSpawnData =
  | { role: 'weaver'; lead: number; fromX: number; toX: number; yBase: number; weaveAmp: number; weavePhase: number; crossTime: number; delay: number }
  | { role: 'stator'; lead: number; angle0: number; angularSpeed: number; radius: number }
  | { role: 'sentinel'; lead: number; offset: Vector3; seed: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; socket: number };

export type MdSpawnEntry = LockOnSpawnEntry<MdEnemyKind, MdSpawnData>;
export type MdUpdate = LockOnEnemyUpdate<MdEnemyKind, MdSpawnData>;

// ---- speed profile → rail easing -------------------------------------------

// The felt arc: slow breech crawl, steady climb through the barrel, a held
// breath at the end of the charge, then the firing slam at bar 30.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.52],
  [bar(8), 0.74],
  [bar(16), 1.02],
  [bar(24), 1.34],
  [bar(29, 2), 1.5],
  [bar(30), 1.56],
  [bar(30, 0.6), 3.3],
  [bar(32), 3.55],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MD_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function mdRunProgress(time: number, duration = MD_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- rail --------------------------------------------------------------------

// A railgun barrel is nearly straight; the gentle sweep exists to parallax the
// ring lattice and give the camera a reason to bank. After the muzzle
// (~82% of the curve) the rail runs out into open space.
export function createMassDriverRail() {
  const points: Vector3[] = [];
  const SEGMENTS = 18;
  const LENGTH = 1600;
  for (let i = 0; i <= SEGMENTS; i += 1) {
    const t = i / SEGMENTS;
    const z = -t * LENGTH;
    // Sweep fades out toward the muzzle so the exit is a clean straight shot.
    const fade = t < 0.78 ? 1 : Math.max(0, 1 - (t - 0.78) / 0.1);
    const x = Math.sin(t * Math.PI * 3.1) * 13 * fade;
    const y = Math.sin(t * Math.PI * 2.3 + 1.2) * 7.5 * fade;
    points.push(new Vector3(x, y, z));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.35);
}

/** Rail parameter of accelerator ring `k` — the camera crosses it exactly on beat `k`. */
export function ringU(beatIndex: number) {
  return mdRunProgress(Math.min(MD_DURATION, beatIndex * BEAT_SECONDS));
}

/** Number of rings in the barrel; ring FIRE_BEAT is the muzzle collar. */
export const RING_COUNT = FIRE_BEAT + 1;

// ---- spawn timeline -----------------------------------------------------------

// Weaver paths are authored as full-bore sweeps and clamped to the clear
// bore here: with camera and target both inside ~7.4 units of the rail, the
// sight line can never cross the coil tube, so crossings stay unoccluded.
const clampBoreX = (x: number) => Math.sign(x) * Math.min(Math.abs(x), 6.2);
const clampBoreY = (y: number) => Math.sign(y) * Math.min(Math.abs(y), 2.8);

const weavers = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; yBase: number; weaveAmp?: number; weavePhase?: number; crossTime?: number; delay?: number }>,
): MdSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.09,
    kind: 'weaver',
    data: {
      role: 'weaver',
      lead,
      fromX: clampBoreX(run.fromX),
      toX: clampBoreX(run.toX),
      yBase: clampBoreY(run.yBase),
      weaveAmp: Math.min(run.weaveAmp ?? 2.6, 1.2),
      weavePhase: run.weavePhase ?? index * 2.1,
      crossTime: run.crossTime ?? 2.5,
      delay: run.delay ?? index * 0.38,
    },
  }));

const stators = (time: number, lead: number, angularSpeed: number, angles: number[]): MdSpawnEntry[] =>
  angles.map((angle, index) => ({
    time: time + index * 0.13,
    kind: 'stator',
    data: { role: 'stator', lead, angle0: (angle * Math.PI) / 180, angularSpeed, radius: 7.1 },
  }));

const sentinels = (time: number, lead: number, offsets: Array<[number, number]>): MdSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.25,
    kind: 'sentinel',
    hitPoints: 2,
    data: { role: 'sentinel', lead, seed: time * 1.7 + index * 2.61, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const interlocks = (time: number): MdSpawnEntry[] =>
  Array.from({ length: INTERLOCK_COUNT }, (_socket, index) => ({
    time: time + index * 0.14,
    kind: 'interlock' as const,
    hitStages: [1, 1],
    data: { role: 'interlock' as const, socket: index },
  }));

export const MD_SPAWN_TIMELINE: MdSpawnEntry[] = [
  // --- Injection: learn the sweep. Slow crossings and wall-crawlers.
  ...weavers(bar(1), 3.6, [
    { fromX: -9, toX: 9, yBase: 1.5, crossTime: 3.1, weaveAmp: 1.8 },
    { fromX: 9, toX: -9, yBase: -2.5, crossTime: 3.1, weaveAmp: 1.8 },
  ]),
  ...stators(bar(2, 2), 3.9, 0.55, [50, 90, 130]),
  ...weavers(bar(4), 3.5, [
    { fromX: -9.5, toX: 9.5, yBase: 4, weaveAmp: 2 },
    { fromX: 9.5, toX: -9.5, yBase: -4.5, weaveAmp: 2 },
  ]),
  ...stators(bar(5, 2), 3.9, -0.6, [230, 270, 310]),
  ...weavers(bar(6, 2), 3.5, [
    { fromX: -10, toX: 10, yBase: 0.5, weavePhase: 0 },
    { fromX: -10, toX: 10, yBase: 0.5, weavePhase: Math.PI },
  ]),

  // --- Acceleration: the pulse locks in on the bar-8 drop.
  ...stators(bar(8), 3.8, 0.7, [0, 90, 180, 270]),
  ...weavers(bar(9, 2), 3.5, [
    { fromX: -10, toX: 10, yBase: 3, weaveAmp: 2.4 },
    { fromX: 10, toX: -10, yBase: -1, weaveAmp: 2.8 },
    { fromX: -10, toX: 10, yBase: -4.5, weaveAmp: 2 },
  ]),
  ...sentinels(bar(11), 4.6, [[0, 4.4]]),
  ...stators(bar(11, 2), 3.7, -0.8, [140, 220]),
  ...weavers(bar(12, 2), 3.4, [
    { fromX: -10, toX: 10, yBase: 1.8, weavePhase: 0 },
    { fromX: -10, toX: 10, yBase: 1.8, weavePhase: Math.PI },
    { fromX: 10, toX: -10, yBase: -3.2, weavePhase: 0, delay: 0.9 },
    { fromX: 10, toX: -10, yBase: -3.2, weavePhase: Math.PI, delay: 1.28 },
  ]),
  ...sentinels(bar(14), 4.4, [[-5.6, -2.0]]),
  ...stators(bar(14, 2), 3.7, 0.9, [-30, 30, 90]),
  ...weavers(bar(15, 1), 3.4, [
    { fromX: 10, toX: -10, yBase: 4.4, weaveAmp: 1.6 },
    { fromX: -10, toX: 10, yBase: -5, weaveAmp: 1.6 },
  ]),

  // --- Overdrive: violet heat. Full-circle crawls, crossfire, twin sentinels.
  ...stators(bar(16), 3.7, 1.05, [0, 60, 120, 180, 240, 300]),
  ...sentinels(bar(17, 2), 4.3, [[-5.4, 2.8], [5.4, 2.8]]),
  ...weavers(bar(19), 3.3, [
    { fromX: -10, toX: 10, yBase: 0, weavePhase: 0 },
    { fromX: -10, toX: 10, yBase: 0, weavePhase: Math.PI },
    { fromX: 10, toX: -10, yBase: 3.6, weavePhase: 0.6, delay: 0.7 },
    { fromX: 10, toX: -10, yBase: 3.6, weavePhase: 0.6 + Math.PI, delay: 1.08 },
    { fromX: -10, toX: 10, yBase: -4.2, weavePhase: 1.2, delay: 1.5 },
    { fromX: 10, toX: -10, yBase: -4.2, weavePhase: 1.9, delay: 1.88 },
  ]),
  ...stators(bar(20, 2), 3.6, -1.15, [45, 135, 225, 315]),
  ...weavers(bar(21), 3.3, [{ fromX: -10, toX: 10, yBase: 5, weaveAmp: 1.4 }]),
  ...sentinels(bar(22), 4.2, [[0, -4.4]]),
  ...weavers(bar(22), 3.3, [
    { fromX: 10, toX: -10, yBase: 2.2, weaveAmp: 2.2 },
    { fromX: -10, toX: 10, yBase: -1.4, weaveAmp: 2.2 },
  ]),

  // --- The boss: six jammed safety interlocks on the payload collar.
  ...interlocks(INTERLOCK_TIME),

  // Thin weaver traffic threads the collar fight without stealing it.
  ...weavers(bar(25), 3.2, [
    { fromX: -10, toX: 10, yBase: 4.6, weaveAmp: 1.4, crossTime: 2.2 },
    { fromX: 10, toX: -10, yBase: -5, weaveAmp: 1.4, crossTime: 2.2 },
  ]),
  ...weavers(bar(27), 3.2, [
    { fromX: 10, toX: -10, yBase: 5, weaveAmp: 1.2, crossTime: 2.1 },
    { fromX: -10, toX: 10, yBase: -4.8, weaveAmp: 1.2, crossTime: 2.1 },
  ]),
  ...weavers(bar(28, 2), 3.1, [
    { fromX: -10, toX: 10, yBase: 5.2, weaveAmp: 1.1, crossTime: 2.0 },
    { fromX: 10, toX: -10, yBase: -5.2, weaveAmp: 1.1, crossTime: 2.0 },
  ]),
].sort((a, b) => a.time - b.time);

const KILL_SCORE: Record<MdEnemyKind, number> = {
  weaver: 140,
  stator: 110,
  sentinel: 300,
  bolt: 40,
  interlock: 500,
};

const BOLT_MAX_AGE = 12;

export type MassDriverGameplay = LockOnRunnerLevel<MdEnemyKind, MdSpawnData> & {
  launchCleared(): boolean;
  interlocksDown(): number;
};

export function createMassDriverGameplay(bus: EventBus): MassDriverGameplay {
  const interceptions = new Set<number>();
  const interlockIds = new Set<number>();
  let interlocksKilled = 0;
  let hitsTaken = 0;
  let cleared = false;
  let detonated = false;

  bus.on('runstart', () => {
    interceptions.clear();
    interlockIds.clear();
    interlocksKilled = 0;
    hitsTaken = 0;
    cleared = false;
    detonated = false;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (interlockIds.delete(enemyId)) {
      interlocksKilled += 1;
      if (interlocksKilled >= INTERLOCK_COUNT) cleared = true;
    }
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  function fireBolt(context: MdUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement ---------------------------------------------------------------

  function updateWeaver(context: MdUpdate, data: Extract<MdSpawnData, { role: 'weaver' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    // The braid: a sine weave in y, and a shallow z-thread so pairs slip
    // between the coil planes rather than sliding flat across them.
    const y = data.yBase + Math.sin(clamped * Math.PI * 2 + data.weavePhase) * data.weaveAmp;
    const z = Math.cos(clamped * Math.PI * 2 + data.weavePhase) * 1.6;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, z)));
    const aheadT = Math.min(1, clamped + 0.045);
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, aheadT * aheadT * (3 - 2 * aheadT)),
      data.yBase + Math.sin(aheadT * Math.PI * 2 + data.weavePhase) * data.weaveAmp,
      Math.cos(aheadT * Math.PI * 2 + data.weavePhase) * 1.6,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(Math.sin(age * 5 + data.weavePhase) * 0.6);
    return false;
  }

  function updateStator(context: MdUpdate, data: Extract<MdSpawnData, { role: 'stator' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Crawls the barrel wall circumferentially, feet out, hugging the coils.
    const angle = data.angle0 + age * data.angularSpeed;
    const wobble = 1 + Math.sin(age * 2.2 + enemy.id) * 0.035;
    const offset = new Vector3(Math.cos(angle) * data.radius * wobble, Math.sin(angle) * data.radius * wobble, 0);
    const position = offsetFromRail(curve, anchorU, offset);
    const wallCenter = offsetFromRail(curve, anchorU, new Vector3(0, 0, 0));
    enemy.mesh.position.copy(position);
    // Belly to the wall: up-vector points inward at the rail.
    enemy.mesh.up.copy(wallCenter.clone().sub(position).normalize());
    enemy.mesh.lookAt(offsetFromRail(curve, Math.min(1, anchorU + 0.004), offset));
    return runProgress > anchorU + 0.013;
  }

  function updateSentinel(context: MdUpdate, data: Extract<MdSpawnData, { role: 'sentinel' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.9 + data.seed) * 1.3;
    offset.y += Math.sin(age * 1.35 + data.seed * 2.3) * 1.0;

    // Telegraph: coil back along the barrel, snap forward, loose an arc bolt.
    const fire = context.enemyState(() => ({ nextAt: 1.5 }));
    const untilShot = fire.nextAt - age;
    if (untilShot < 0.85 && untilShot > 0.5) offset.z += (0.85 - untilShot) * 9;
    else if (untilShot <= 0.5 && untilShot > 0) offset.z -= (0.5 - untilShot) * 15;
    if (age >= fire.nextAt) {
      fire.nextAt = age + 3.1;
      fireBolt(context, enemy.mesh.position);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.6 + data.seed) * 0.35);
    return runProgress > anchorU + 0.013;
  }

  function updateBolt(context: MdUpdate, data: Extract<MdSpawnData, { role: 'bolt' }>) {
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
      enemy.mesh.rotateZ(age * 11);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 14,
      accel: 3.6,
      turnRate: 2.5,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    enemy.mesh.rotateZ(age * 9);
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateInterlock(context: MdUpdate, data: Extract<MdSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, age, curve, camera, damagePlayer } = context;

    // The collar rides ahead of the payload, parking at the muzzle so the
    // camera closes on it over the last seconds of the charge.
    const anchorU = mdRunProgress(Math.min(runTime + COLLAR_LEAD, FIRE_TIME));
    const chargeFraction = MathUtils.clamp((runTime - CHARGE_TIME) / (FIRE_TIME - CHARGE_TIME), 0, 1);
    const angle = (data.socket / INTERLOCK_COUNT) * Math.PI * 2 + Math.PI / 6;
    const reveal = Math.min(1, age / 1.1);
    const radius = COLLAR_RADIUS * (0.4 + 0.6 * reveal * reveal * (3 - 2 * reveal));
    const offset = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    // Jammed clamps shudder harder as the charge builds toward the peak.
    const shudder = 0.05 + chargeFraction * 0.22;
    offset.x += Math.sin(age * 23 + data.socket * 4.1) * shudder;
    offset.y += Math.cos(age * 19 + data.socket * 2.7) * shudder;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotation.z += angle + Math.PI / 2 + Math.sin(age * 17) * shudder * 0.16;

    // The charge peaks with clamps still jammed: the barrel goes with you.
    // Retried each frame because a recent bolt hit's invulnerability window
    // can swallow the first call.
    if (!cleared && runTime >= FIRE_TIME - 0.02) {
      detonated = true;
      damagePlayer(99);
    }
    return false;
  }

  // ---- level definition ---------------------------------------------------------

  return {
    duration: MD_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MD_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: MD_SPAWN_TIMELINE,
    easeRunProgress: mdRunProgress,
    startWord: 'LAUNCH',
    replayWord: 'RELOAD',
    timing: {
      // Half-bar cap at 128 BPM: volleys must stay snappy inside the six-bar
      // interlock deadline; the default whole-bar snap reads as hesitation there.
      shotDelay: { maxGridSeconds: MD_TIME.barSeconds / 2 },
    },
    launchCleared: () => cleared,
    interlocksDown: () => interlocksKilled,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'weaver':
          return updateWeaver(context, data);
        case 'stator':
          return updateStator(context, data);
        case 'sentinel':
          return updateSentinel(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'interlock':
          return updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (sentinel shells, interlock plates) pays a little.
    scoreForHit: () => 60,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (cleared && score >= 13500 && clearRate >= 0.8) return 'S';
      if (cleared && score >= 9000 && clearRate >= 0.6) return 'A';
      if (score >= 5200 && clearRate >= 0.4) return 'B';
      if (score >= 2200 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, MD_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${MD_PLAYER_HEALTH}`, `Interlocks blown ${interlocksKilled}/${INTERLOCK_COUNT}`];
      if (cleared) lines.push('Launched at muzzle velocity');
      else if (detonated) lines.push('Lost in the breach');
      return lines;
    },
  };
}
