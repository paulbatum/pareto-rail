import { MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { createTetherjack, createTetherjackEntries } from './boss';
import { RAIL_BASIS, RAIL_LENGTH, createSkyhookRail, railPoint } from './rail';
import { skyhookSignals } from './signals';
import {
  bar,
  DECK_TIME,
  DOCK_TIME,
  LATCH_TIME,
  SKYHOOK_BARS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_MARKERS,
  SKYHOOK_TIME,
  THIN_TIME,
  VACUUM_TIME,
} from './timing';

// SKYHOOK — a 60-second climb up a space-elevator tether, scored to 32 bars at
// 128 BPM. The rail is a straight line pitched 20° above the horizon: the
// climber car rides beside the tether, the camera is its turret, and speed is
// the world falling away — rain, cloud deck, debris, then the planet's limb.
//
//   Weather  (bars 0–8)   storm grey; kites ride the wind, limpets go for the hull.
//   Deck     (bar 8)      punch through the cloud deck into sunlit blue.
//   Sunlit   (bars 8–14)  squalls shoot back; the mix starts losing layers.
//   Thin     (bars 14–20) indigo; vacuum mites dash in rigid lines, sentinels hold station.
//   Latch    (bar 18.5)   the Tetherjack takes the tether far above.
//   Vacuum   (bars 20–28) black, stars; it climbs down in lurches, one per downbeat.
//   Dock     (bars 28–32) the station opens, swallows the car, everything decelerates.

export { bar, DECK_TIME, DOCK_TIME, LATCH_TIME, SKYHOOK_BARS, SKYHOOK_BPM, SKYHOOK_DURATION, SKYHOOK_MARKERS, SKYHOOK_TIME, THIN_TIME, VACUUM_TIME } from './timing';

export const SKYHOOK_PLAYER_HEALTH = 5;

export type SkyhookEnemyKind =
  | 'kite'
  | 'limpet'
  | 'squall'
  | 'mite'
  | 'sentinel'
  | 'bolt'
  | 'claw'
  | 'core'
  | 'wreck'
  | 'tether';

// Timeline data is immutable and reused across runs; per-enemy runtime state
// lives in the runner's enemyState bags, boss state in ./boss.
export type SkyhookSpawnData =
  | { role: 'kite'; lead: number; x: number; y: number; ampX: number; ampY: number; rate: number; phase: number }
  | { role: 'limpet'; lead: number; x: number; y: number; dropDelay: number; slot: number }
  | { role: 'squall'; lead: number; x: number; y: number; seed: number }
  | { role: 'mite'; lead: number; x: number; y: number; dx: number; dy: number; phase: number }
  | { role: 'sentinel'; lead: number; x: number; y: number; seed: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; dart: boolean }
  | { role: 'claw'; socket: number }
  | { role: 'core' }
  | { role: 'brain' }
  | { role: 'wreck'; x: number; y: number; z: number; vx: number; vy: number; seed: number };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

// ---- rail ------------------------------------------------------------------

// The rail itself lives in ./rail (shared with the boss and the environment
// without an import cycle): one straight line pitched 20° up.
export {
  RAIL_BASIS,
  RAIL_DIRECTION,
  RAIL_LENGTH,
  RAIL_ORIGIN,
  RAIL_RIGHT,
  RAIL_UP,
  TETHER_OFFSET,
  createSkyhookRail,
  railPoint,
  railUForPosition,
} from './rail';

// ---- speed profile → rail easing ------------------------------------------

// 1.0 ≈ cruise. The climber winds up out of the anchor station, kicks through
// the deck, runs fastest in vacuum, and brakes to a stop inside the bay.
const SPEED_KEYS: Array<[number, number]> = [
  [0, 0.5],
  [bar(1.5), 0.92],
  [bar(7.5), 1.0],
  [bar(8), 1.35],
  [bar(9), 1.05],
  [bar(14), 1.15],
  [bar(20), 1.3],
  [bar(27), 1.25],
  [bar(28.5), 0.9],
  [bar(30.5), 0.3],
  [bar(32), 0.05],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function skyhookRunProgress(time: number, duration = SKYHOOK_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => skyhookRunProgress(time);

/** Climb rate in rail units per second at run time `t`. */
export function railUnitsPerSecond(time: number) {
  const t0 = Math.max(0, time - 0.05);
  const t1 = Math.min(SKYHOOK_DURATION, time + 0.05);
  return ((railU(t1) - railU(t0)) / Math.max(0.001, t1 - t0)) * RAIL_LENGTH;
}

// Set-piece positions along the rail, derived from the speed profile so the
// environment and the score agree on where things are.
export const DECK_U = railU(DECK_TIME);
export const STATION_MOUTH_U = railU(bar(28.7));
export const STATION_STOP_U = 1;

/** Lead (seconds) that seats a spawn `distance` rail units ahead of the camera at `time`. */
export function leadForDistance(time: number, distance: number) {
  const startU = railU(time);
  let low = 0.2;
  let high = 14;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    const ahead = (railU(Math.min(SKYHOOK_DURATION, time + mid)) - startU) * RAIL_LENGTH;
    if (ahead < distance) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// ---- the climber's deck ----------------------------------------------------

// Clamp slots on the deck, rail-frame relative to the camera. Limpets home
// onto these; the visuals build the deck to match.
export const CLAMP_SLOTS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -2.4, y: -2.55, z: 5.2 },
  { x: 2.0, y: -2.55, z: 5.4 },
  { x: 3.6, y: -2.6, z: 4.5 },
  { x: -0.3, y: -2.5, z: 5.8 },
];
const CLAMP_FIRST_BITE = 1.4;
const CLAMP_BITE_PERIOD = 2.6;

// ---- spawn timeline ---------------------------------------------------------

const PASS_MARGIN_U = 6 / RAIL_LENGTH;

const kites = (time: number, distance: number, specs: Array<[number, number, number, number]>): SkyhookSpawnEntry[] =>
  specs.map(([x, y, ampX, ampY], index) => {
    const at = time + index * 0.14;
    return {
      time: at,
      kind: 'kite',
      data: { role: 'kite', lead: leadForDistance(at, distance), x, y, ampX, ampY, rate: 1.05 + (index % 3) * 0.17, phase: index * 1.9 + time },
    };
  });

const limpets = (time: number, distance: number, specs: Array<[number, number, number, number]>): SkyhookSpawnEntry[] =>
  specs.map(([x, y, dropDelay, slot], index) => {
    const at = time + index * 0.22;
    return {
      time: at,
      kind: 'limpet',
      data: { role: 'limpet', lead: leadForDistance(at, distance), x, y, dropDelay, slot },
    };
  });

const squalls = (time: number, distance: number, specs: Array<[number, number]>): SkyhookSpawnEntry[] =>
  specs.map(([x, y], index) => {
    const at = time + index * 0.2;
    return {
      time: at,
      kind: 'squall',
      data: { role: 'squall', lead: leadForDistance(at, distance), x, y, seed: index * 2.7 + time },
    };
  });

const mites = (time: number, distance: number, specs: Array<[number, number, number, number]>, stagger = 0.11): SkyhookSpawnEntry[] =>
  specs.map(([x, y, dx, dy], index) => {
    const at = time + index * stagger;
    return {
      time: at,
      kind: 'mite',
      data: { role: 'mite', lead: leadForDistance(at, distance), x, y, dx, dy, phase: index * 0.17 },
    };
  });

const sentinels = (time: number, distance: number, specs: Array<[number, number]>): SkyhookSpawnEntry[] =>
  specs.map(([x, y], index) => {
    const at = time + index * 0.25;
    return {
      time: at,
      kind: 'sentinel',
      hitStages: [2, 2],
      data: { role: 'sentinel', lead: leadForDistance(at, distance), x, y, seed: index * 3.1 + time },
    };
  });

function buildTimeline(bossEntries: SkyhookSpawnEntry[]): SkyhookSpawnEntry[] {
  return [
    // --- Weather. Kites slalom on the wind; the first limpets go for the deck.
    ...kites(bar(0.9), 62, [[-14, 6, 6, 2], [0, 13, 8, 3], [14, 6, 6, 2]]),
    ...kites(bar(2.5), 62, [[-23, 2, 5, 3], [-8, 16, 7, 2], [8, 16, 7, 2], [23, 2, 5, 3]]),
    ...limpets(bar(4), 62, [[-10, 14, 1.4, 0], [12, 12, 1.9, 1]]),
    ...kites(bar(4.2), 60, [[-25, -4, 4, 2], [25, -4, 4, 2]]),
    ...squalls(bar(5.4), 68, [[0, 17]]),
    ...kites(bar(5.6), 60, [[-19, -2, 6, 3], [0, -7, 8, 2], [19, -2, 6, 3]]),
    ...kites(bar(6.6), 62, [[-27, 0, 4, 2], [-13, 11, 5, 2], [0, 19, 6, 3], [13, 11, 5, 2], [27, 0, 4, 2]]),
    ...limpets(bar(6.8), 66, [[0, 8, 1.2, 2]]),

    // (bars 7.5–8.3: clear for the deck punch-through)

    // --- Sunlit. Squalls shoot back; kites cross in wider arcs.
    ...squalls(bar(8.4), 68, [[-17, 14], [17, 14]]),
    ...kites(bar(8.6), 60, [[-8, 4, 10, 3], [8, 4, 10, 3], [-25, 13, 5, 2], [25, 13, 5, 2]]),
    ...limpets(bar(10), 62, [[-14, 18, 1.5, 3], [14, 18, 1.8, 0]]),
    ...kites(bar(10.2), 60, [[0, 0, 15, 4], [-21, -5, 5, 3], [21, -5, 5, 3]]),
    ...squalls(bar(11.5), 70, [[0, 21]]),
    ...kites(bar(11.7), 60, [[-29, 2, 4, 2], [-14, 15, 5, 3], [0, -3, 6, 4], [14, 15, 5, 3], [29, 2, 4, 2]]),
    ...mites(bar(13), 60, [[-27, 17, 1, -0.3], [-27, 8, 1, -0.2], [-27, 0, 1, -0.1]]),
    ...limpets(bar(13.2), 62, [[8, 6, 1.0, 1]]),

    // --- Thin. Vacuum hardware: mites dash in rigid lines, sentinels hold station.
    ...mites(bar(14.3), 60, [[25, 19, -1, -0.4], [25, 11, -1, -0.3], [25, 3, -1, -0.2], [25, -5, -1, -0.1], [25, -12, -1, 0]]),
    ...sentinels(bar(15.6), 70, [[0, 14]]),
    ...mites(bar(15.8), 58, [[-21, -8, 0.8, 0.6], [0, -13, 0, 1], [21, -8, -0.8, 0.6]]),
    ...limpets(bar(17), 62, [[-18, 10, 1.3, 2], [18, 10, 1.6, 3]]),
    ...mites(bar(17.2), 60, [[-31, 21, 1, -0.6], [31, 21, -1, -0.6], [-31, -6, 1, 0.5], [31, -6, -1, 0.5]]),
    ...sentinels(bar(18.4), 68, [[-17, 8], [17, 8]]),
    ...mites(bar(18.6), 58, [[0, 25, 0, -1], [-11, 23, 0.3, -1], [11, 23, -0.3, -1]]),

    // --- Vacuum. The Tetherjack takes the tether (its brain rides behind the
    // camera for the whole act); mites drift past regardless.
    ...bossEntries,
    ...mites(bar(21), 58, [[-29, 15, 1, -0.5], [29, 15, -1, -0.5], [-29, -2, 1, 0.3], [29, -2, -1, 0.3]]),
    ...mites(bar(23.5), 58, [[-25, 21, 0.8, -0.8], [0, 27, 0, -1], [25, 21, -0.8, -0.8]]),
    ...mites(bar(25.5), 56, [[-31, 7, 1, 0], [31, 7, -1, 0]]),

    // (bars 27–32: the last stretch is clear; the station opens)
  ];
}

export function createSkyhookTimeline() {
  const boss = createTetherjackEntries(LATCH_TIME);
  return {
    timeline: buildTimeline(boss.timeline).sort((a, b) => a.time - b.time),
  };
}

export const SKYHOOK_TIMELINE: SkyhookSpawnEntry[] = createSkyhookTimeline().timeline;

const KILL_SCORE: Record<SkyhookEnemyKind, number> = {
  kite: 100,
  limpet: 160,
  squall: 180,
  mite: 120,
  sentinel: 320,
  bolt: 40,
  claw: 400,
  core: 2500,
  wreck: 80,
  tether: 0,
};

const BOLT_MAX_AGE = 12;

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> {
  const { timeline } = createSkyhookTimeline();

  const interceptions = new Set<number>();
  const clampedLimpets = new Map<number, number>();
  let hitsTaken = 0;
  let limpetsPried = 0;
  let boltsDowned = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    clampedLimpets.clear();
    hitsTaken = 0;
    limpetsPried = 0;
    boltsDowned = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    interceptions.delete(enemyId);
    const slot = clampedLimpets.get(enemyId);
    if (slot !== undefined) {
      clampedLimpets.delete(enemyId);
      limpetsPried += 1;
      skyhookSignals.emit('pry', { slot, worldPosition });
    }
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    clampedLimpets.delete(enemyId);
  });

  function fireBolt(context: SkyhookUpdate, from: Vector3, dart: boolean) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(dart ? 9 : 5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {}, dart },
    });
  }

  function spawnWreck(context: SkyhookUpdate, x: number, y: number, z: number, seed: number) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'wreck',
      countsTowardTotal: false,
      data: { role: 'wreck', x, y, z, vx: Math.sin(seed * 7.1) * 7, vy: 3 + Math.cos(seed * 3.3) * 4, seed },
    });
  }

  function spawnClaw(context: SkyhookUpdate, socket: number) {
    context.spawnEnemy({ time: context.runTime, kind: 'claw', hitPoints: 3, data: { role: 'claw', socket } });
  }

  function spawnCore(context: SkyhookUpdate) {
    context.spawnEnemy({ time: context.runTime, kind: 'core', hitStages: [3, 5], data: { role: 'core' } });
  }

  const tetherjack = createTetherjack(bus, { fireBolt, spawnWreck, spawnClaw, spawnCore });

  // ---- movement -------------------------------------------------------------

  const scratch = new Vector3();

  function faceCamera(context: SkyhookUpdate) {
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
  }

  // Wind-riders: the whole flight is a slow figure-eight on the gusts, wings
  // banking into each turn. Nothing up top moves like this.
  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'kite' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = age * data.rate + data.phase;
    const x = data.x + Math.sin(t) * data.ampX;
    const y = data.y + Math.sin(t * 2 + 0.6) * data.ampY * 0.5 + Math.sin(age * 0.7 + data.phase) * 0.6;
    enemy.mesh.position.copy(railPoint(anchorU, x, y, 0, scratch));
    faceCamera(context);
    const bank = Math.cos(t) * 0.55;
    enemy.mesh.rotateZ(bank);
    enemy.mesh.rotateX(Math.sin(t * 2 + 0.6) * 0.25);
    enemy.mesh.userData.flutter = age;
    return runProgress > anchorU + PASS_MARGIN_U;
  }

  // Hull-hunters: hover, then dive for a clamp slot on the deck and chew.
  function updateLimpet(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'limpet' }>) {
    const { enemy, runProgress, age, railAnchor, damagePlayer } = context;
    const state = context.enemyState(() => ({
      rel: new Vector3(data.x, data.y, 0),
      lastAge: 0,
      lastU: runProgress,
      clamped: false,
      nextBite: 0,
    }));
    const dt = Math.max(0, age - state.lastAge);
    state.lastAge = age;
    const anchorU = railAnchor(data.lead);
    const slot = CLAMP_SLOTS[data.slot];

    if (age < data.dropDelay) {
      // Scanning hover at the anchor; the camera closes on it.
      const wobble = Math.sin(age * 3.1 + enemy.id) * 0.5;
      state.rel.set(data.x + wobble, data.y + Math.cos(age * 2.3 + enemy.id) * 0.4, (anchorU - runProgress) * RAIL_LENGTH);
      enemy.mesh.position.copy(railPoint(runProgress, state.rel.x, state.rel.y, state.rel.z, scratch));
      faceCamera(context);
      enemy.mesh.rotateZ(age * 1.4);
      enemy.mesh.userData.legSpread = 0.2;
      state.lastU = runProgress;
      return false;
    }

    if (!state.clamped) {
      // The hover point is fixed in the world; carry it toward the camera as the
      // climber rises, then home on the slot in camera-relative rail space.
      state.rel.z -= (runProgress - state.lastU) * RAIL_LENGTH;
      state.lastU = runProgress;
      const toSlot = scratch.set(slot.x - state.rel.x, slot.y - state.rel.y, slot.z - state.rel.z);
      const distance = toSlot.length();
      if (distance < 0.5) {
        state.clamped = true;
        state.nextBite = age + CLAMP_FIRST_BITE;
        state.rel.set(slot.x, slot.y, slot.z);
        clampedLimpets.set(enemy.id, data.slot);
        enemy.mesh.userData.clamped = true;
        skyhookSignals.emit('clamp', { slot: data.slot, worldPosition: enemy.mesh.position.clone() });
      } else {
        const speed = 9 + distance * 0.75;
        state.rel.addScaledVector(toSlot.normalize(), Math.min(distance, speed * dt));
        enemy.mesh.position.copy(railPoint(runProgress, state.rel.x, state.rel.y, state.rel.z, scratch));
        // Nose into the dive; legs open as it commits.
        faceCamera(context);
        enemy.mesh.rotateX(-0.6 - Math.min(1, (data.dropDelay + 1 - age)) * 0.3);
        enemy.mesh.rotateZ(age * 2.2);
        enemy.mesh.userData.legSpread = MathUtils.clamp(1 - distance / 14, 0.2, 1);
        if (age > 40) return true;
        return false;
      }
    }

    // Clamped: sits on the deck, drilling. Jitter sells the bite.
    const drill = Math.sin(age * 31) * 0.05;
    enemy.mesh.position.copy(railPoint(runProgress, slot.x + drill, slot.y + Math.abs(Math.sin(age * 17)) * 0.05, slot.z + drill * 0.5, scratch));
    enemy.mesh.quaternion.copy(RAIL_BASIS);
    enemy.mesh.rotateX(-Math.PI / 2); // dome (local +z) turns to rail up
    enemy.mesh.rotateZ(data.slot * 1.3 + Math.sin(age * 5) * 0.08);
    enemy.mesh.userData.legSpread = 1;
    if (age >= state.nextBite) {
      state.nextBite = age + CLAMP_BITE_PERIOD;
      damagePlayer(1);
      skyhookSignals.emit('bite', { slot: data.slot, worldPosition: enemy.mesh.position.clone() });
    }
    return false;
  }

  // Storm cells: heavy, drifting on turbulence, spitting lightning at the turret.
  function updateSquall(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'squall' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const fire = context.enemyState(() => ({ nextAt: 1.5 }));
    const untilShot = fire.nextAt - age;
    let x = data.x + Math.sin(age * 0.9 + data.seed) * 2.4;
    let y = data.y + Math.sin(age * 1.3 + data.seed * 2.1) * 1.4;
    let z = 0;
    // Telegraph: it swells back, then lurches forward as it discharges.
    if (untilShot < 0.7 && untilShot > 0.25) z += (0.7 - untilShot) * 5;
    else if (untilShot <= 0.25 && untilShot > -0.2) z -= (0.25 - untilShot) * 9;
    enemy.mesh.userData.charge = MathUtils.clamp(1 - untilShot / 0.7, 0, 1);
    if (age >= fire.nextAt) {
      fire.nextAt = age + 3.4;
      fireBolt(context, enemy.mesh.position, false);
    }
    x += Math.sin(age * 5.3) * 0.12;
    y += Math.cos(age * 6.1) * 0.12;
    enemy.mesh.position.copy(railPoint(anchorU, x, y, z, scratch));
    faceCamera(context);
    enemy.mesh.rotateZ(Math.sin(age * 0.6 + data.seed) * 0.35);
    return runProgress > anchorU + PASS_MARGIN_U;
  }

  // Vacuum mites: no air, no drift. Straight vectors, dash and coast on
  // reaction-control pulses, rigidly spinning.
  function updateMite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'mite' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const period = 0.8;
    const dash = 4.2;
    const local = age + data.phase;
    const k = Math.floor(local / period);
    const frac = (local - k * period) / period;
    const pulse = MathUtils.smoothstep(Math.min(1, frac / 0.42), 0, 1);
    const travel = dash * (k + pulse);
    const length = Math.hypot(data.dx, data.dy) || 1;
    const x = data.x + (data.dx / length) * travel;
    const y = data.y + (data.dy / length) * travel;
    enemy.mesh.position.copy(railPoint(anchorU, x, y, 0, scratch));
    faceCamera(context);
    enemy.mesh.rotateZ(Math.atan2(data.dy, data.dx) + k * 0.5);
    enemy.mesh.userData.thrust = frac < 0.42 ? 1 - frac / 0.42 : 0;
    if (Math.abs(x) > 44 || Math.abs(y) > 40) return true;
    return runProgress > anchorU + PASS_MARGIN_U;
  }

  // Sentinels: armored station-keepers. Rigid RCS jolts, turret sweep, railgun darts.
  function updateSentinel(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'sentinel' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const fire = context.enemyState(() => ({ nextAt: 1.3 }));
    const cracked = enemy.hitStageIndex > 0;
    const joltPeriod = 1.1;
    const jolt = MathUtils.smoothstep((age % joltPeriod) / 0.25, 0, 1);
    const cycle = Math.floor(age / joltPeriod);
    const x = data.x + Math.sin(cycle * 2.4 + data.seed) * 1.2 * jolt + Math.sin((cycle - 1) * 2.4 + data.seed) * 1.2 * (1 - jolt);
    const y = data.y + Math.cos(cycle * 1.7 + data.seed) * 0.9 * jolt + Math.cos((cycle - 1) * 1.7 + data.seed) * 0.9 * (1 - jolt);
    const untilShot = fire.nextAt - age;
    enemy.mesh.userData.charge = MathUtils.clamp(1 - untilShot / 0.5, 0, 1);
    if (age >= fire.nextAt) {
      fire.nextAt = age + (cracked ? 2.0 : 2.7);
      fireBolt(context, enemy.mesh.position, true);
    }
    enemy.mesh.position.copy(railPoint(anchorU, x, y, 0, scratch));
    if (cracked) {
      enemy.mesh.position.x += Math.sin(age * 23) * 0.1;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.1;
    }
    faceCamera(context);
    enemy.mesh.rotateZ(cycle * 0.35 + jolt * 0.35);
    return runProgress > anchorU + PASS_MARGIN_U;
  }

  function updateBolt(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'bolt' }>) {
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
      config: data.dart ? { hitDistance: 2.6, impactBrake: 0.3, damageDistance: 0.7 } : undefined,
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      faceCamera(context);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(
      data.position,
      data.velocity,
      hostileShotAimPoint(camera, data.position),
      age,
      dt,
      data.dart ? { baseSpeed: 9, maxSpeed: 17, accel: 4, turnRate: 1.4 } : { baseSpeed: 5.5, maxSpeed: 12, accel: 3.2, turnRate: 2.4 },
    );
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(scratch.copy(data.position).add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // Shed wreckage: tumbles down the tether past the car. Harmless bonus.
  function updateWreck(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'wreck' }>) {
    const { enemy, age, runProgress } = context;
    const state = context.enemyState(() => ({ rel: new Vector3(data.x, data.y, data.z), lastAge: 0, lastU: runProgress }));
    const dt = Math.max(0, age - state.lastAge);
    state.lastAge = age;
    state.rel.z -= (runProgress - state.lastU) * RAIL_LENGTH;
    state.lastU = runProgress;
    state.rel.x += data.vx * dt;
    state.rel.y += (data.vy - age * 4) * dt;
    state.rel.z -= (6 + age * 5) * dt;
    enemy.mesh.position.copy(railPoint(runProgress, state.rel.x, state.rel.y, state.rel.z, scratch));
    enemy.mesh.rotation.set(age * (1.2 + data.seed % 1), age * 2.1, data.seed);
    return state.rel.z < -3 || age > 9;
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    playerHealth: SKYHOOK_PLAYER_HEALTH,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    startWord: 'CLIMB!',
    timing: {
      // Quick waves on a straight rail: cap the coarsest impact grid at a half bar.
      shotDelay: { maxGridSeconds: SKYHOOK_TIME.barSeconds / 2 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'kite':
          return updateKite(context, data);
        case 'limpet':
          return updateLimpet(context, data);
        case 'squall':
          return updateSquall(context, data);
        case 'mite':
          return updateMite(context, data);
        case 'sentinel':
          return updateSentinel(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'claw':
          return tetherjack.updateClaw(context, data);
        case 'core':
          return tetherjack.updateCore(context, data);
        case 'brain':
          return tetherjack.updateBrain(context, data);
        case 'wreck':
          return updateWreck(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (sentinel plates, claws, the core) pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (tetherjack.killed() && score >= 16000 && clearRate >= 0.8) return 'S';
      if (score >= 11000 && clearRate >= 0.62) return 'A';
      if (score >= 6500 && clearRate >= 0.42) return 'B';
      if (score >= 2500 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${SKYHOOK_PLAYER_HEALTH}`];
      if (limpetsPried > 0) lines.push(`${limpetsPried} limpet${limpetsPried === 1 ? '' : 's'} pried off the deck`);
      if (boltsDowned > 0) lines.push(`${boltsDowned} shot${boltsDowned === 1 ? '' : 's'} intercepted`);
      const bossLine = tetherjack.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
