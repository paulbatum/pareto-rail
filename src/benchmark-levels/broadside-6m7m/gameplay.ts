import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { sortTimeline } from '../../engine/spawn-patterns';
import {
  BELLY_WARSHIP,
  broadsideRunProgress,
  createBroadsideRail,
  ENEMY_FLAGSHIP,
  KEEL_FRACTION,
  railSpeedAt,
  timeWhenRailZ,
  TRENCH,
} from './rail';
import { BARS, BROADSIDE_BPM, BROADSIDE_DURATION, bar } from './timing';

// BROADSIDE — sixty seconds across a fleet engagement, in seven movements
// (see timing.ts). The swarm is the enemy: darts cross the screen in knots,
// wasps corkscrew in from ahead, hunters hold station and lob crimson bolts.
// Turrets rake past on the warship's belly. The flagship is the boss: four
// shield generators on its flank, then three power cores in its trench —
// cores are lockable at any time but a live shield swats the shots away.

export { BROADSIDE_BPM, BROADSIDE_DURATION } from './timing';
export const BROADSIDE_PLAYER_HEALTH = 4;

export type BroadsideEnemyKind = 'dart' | 'wasp' | 'hunter' | 'turret' | 'bolt' | 'generator' | 'core';

export type BroadsideSpawnData =
  | { role: 'dart'; engagement: RailLead; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'wasp'; lead: number; radius: number; phase: number; spin: number; ahead: number; tilt: number }
  | { role: 'hunter'; engagement: RailLead; x: number; y: number; seed: number }
  | { role: 'turret'; position: Vector3; passTime: number; seed: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; heavy: boolean }
  | { role: 'generator'; position: Vector3; passTime: number; index: number }
  | { role: 'core'; position: Vector3; passTime: number; index: number };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// ---- pacing -------------------------------------------------------------------

const railCurve = createBroadsideRail();
const pacer = createRailPacer({
  curve: railCurve,
  duration: BROADSIDE_DURATION,
  runProgress: broadsideRunProgress,
  spawnAheadUnits: 56,
  defaultLeadSeconds: 3.4,
});

const MISS_GRACE = 0.3;
const WORLD_UP = new Vector3(0, 1, 0);

// ---- timeline authoring ------------------------------------------------------------

type DartRun = { fromX: number; toX: number; y: number; arc?: number; delay?: number; crossTime?: number };

/** A knot of darts crossing the screen; alternate runs sweep opposite ways. */
const darts = (time: number, runs: DartRun[], lead = 3.4): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.1,
    kind: 'dart',
    data: {
      role: 'dart',
      engagement: pacer.resolve(time + index * 0.1, lead),
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc ?? 2.5,
      delay: run.delay ?? index * 0.32,
      crossTime: run.crossTime ?? 2.5,
    },
  }));

/** Darts fanned across the width: `count` runs alternating direction over a band of heights. */
const dartFan = (time: number, count: number, yFrom: number, yTo: number, leftFirst = true, lead = 3.4) =>
  darts(
    time,
    Array.from({ length: count }, (_, i) => {
      const left = (i % 2 === 0) === leftFirst;
      const y = count === 1 ? yFrom : MathUtils.lerp(yFrom, yTo, i / (count - 1));
      return { fromX: left ? -24 : 24, toX: left ? 24 : -24, y, arc: (i % 3 - 1) * 2.4 + 1.2, delay: i * 0.3 };
    }),
    lead,
  );

/** Wasps corkscrew in from ahead, one behind the other on the same thread. */
const wasps = (time: number, count: number, radius = 13, spin = 2.6, lead = 3.6, ahead = 42): BroadsideSpawnEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    time: time + i * 0.24,
    kind: 'wasp',
    data: {
      role: 'wasp',
      lead,
      radius: radius * (1 - (i % 3) * 0.12),
      phase: i * (Math.PI * 2 / Math.max(3, count)) + time,
      spin: spin * (i % 2 ? -1 : 1),
      ahead,
      tilt: (i % 2 ? 1 : -1) * 0.5,
    },
  }));

/** Hunters hold station in a formation and lob bolts. */
const hunters = (time: number, offsets: Array<[number, number]>, lead = 4.4): BroadsideSpawnEntry[] =>
  offsets.map(([x, y], index) => ({
    time: time + index * 0.22,
    kind: 'hunter',
    hitPoints: 2,
    data: { role: 'hunter', engagement: pacer.resolve(time + index * 0.22, lead), x, y, seed: index * 2.71 + time },
  }));

// Rooted targets live in world space on a hull; their timing is derived from
// where the rail actually is, so they slide past exactly on their beat.
const AHEAD_SPAWN = 76;
const CORE_AHEAD_SPAWN = 66; // cores appear once the camera is inside the trench mouth, not over its wall

function rooted(kind: 'turret' | 'generator' | 'core', position: Vector3, searchFrom: number, searchTo: number, index: number): BroadsideSpawnEntry {
  const approaching = Math.sign(railCurve.getPointAt(broadsideRunProgress(searchTo)).z - railCurve.getPointAt(broadsideRunProgress(searchFrom)).z) || -1;
  const spawnTime = timeWhenRailZ(position.z - approaching * (kind === 'core' ? CORE_AHEAD_SPAWN : AHEAD_SPAWN), searchFrom, searchTo);
  const passTime = timeWhenRailZ(position.z + approaching * 3, searchFrom, searchTo);
  if (kind === 'turret') {
    return { time: spawnTime, kind, hitPoints: 2, data: { role: 'turret', position, passTime, seed: index * 1.93 } };
  }
  if (kind === 'generator') {
    return { time: spawnTime, kind, hitPoints: 2, data: { role: 'generator', position, passTime, index } };
  }
  return { time: spawnTime, kind, hitPoints: 3, data: { role: 'core', position, passTime, index } };
}

const bellyStart = bar(BARS.belly);
const bellyEnd = bar(BARS.flagship);
const bellyY = BELLY_WARSHIP.center.y - BELLY_WARSHIP.height * KEEL_FRACTION - 2.1; // turret hangs below the keel plates
const turrets = (positions: Array<[number, number]>) =>
  positions.map(([x, z], index) => rooted('turret', new Vector3(x, bellyY, z), bellyStart, bellyEnd, index));

const flankStart = bar(BARS.flagship);
const flankEnd = bar(BARS.loop);
const flankX = ENEMY_FLAGSHIP.center.x + ENEMY_FLAGSHIP.width / 2 + 5.5;
export const GENERATOR_POSITIONS = [
  new Vector3(flankX, -20, -1626),
  new Vector3(flankX, -2, -1684),
  new Vector3(flankX, -22, -1738),
  new Vector3(flankX, -4, -1794),
];
const generators = () => GENERATOR_POSITIONS.map((position, index) => rooted('generator', position, flankStart, flankEnd, index));

const trenchStart = bar(BARS.trench) + 0.4;
const trenchEnd = bar(BARS.pullout);
export const CORE_POSITIONS = [
  new Vector3(TRENCH.x - 3.5, TRENCH.floorY + 2.6, -1732),
  new Vector3(TRENCH.x + 3.5, TRENCH.floorY + 2.6, -1684),
  new Vector3(TRENCH.x, TRENCH.floorY + 2.6, -1638),
];
const cores = () => CORE_POSITIONS.map((position, index) => rooted('core', position, trenchStart, trenchEnd, index));

export const BROADSIDE_SPAWN_TIMELINE: BroadsideSpawnEntry[] = sortTimeline([
  // --- Launch (bars 0–2): off the bow, first contact is a single knot of darts.
  ...darts(bar(1.6), [{ fromX: -22, toX: 22, y: 2.5 }, { fromX: -22, toX: 22, y: 6 }, { fromX: -22, toX: 22, y: -1 }]),

  // --- The gaps (bars 2–8): banks and the barrel roll. Knots thicken; wasps thread them.
  ...dartFan(bar(2.5), 4, -2, 7, false),
  ...wasps(bar(3.5), 4, 8, 2.4),
  ...hunters(bar(4.4), [[-13, 5], [13, 5]]),
  ...darts(bar(4.7), [{ fromX: 24, toX: -24, y: 0, arc: 3 }, { fromX: -24, toX: 24, y: 7, arc: -2 }, { fromX: 24, toX: -24, y: 3.5 }]),
  ...dartFan(bar(5.5), 6, -3, 8, true, 3.2),
  ...wasps(bar(6.1), 5, 9, 2.9, 3.4), // through the barrel roll
  ...hunters(bar(7.2), [[-12, 8], [12, 8]]),
  ...darts(bar(7.4), [{ fromX: -24, toX: 24, y: 1 }, { fromX: 24, toX: -24, y: -2.5 }, { fromX: -24, toX: 24, y: 4 }, { fromX: 24, toX: -24, y: 8 }]),

  // --- Flank run (bars 8–12): fast, under the broadside; swarm streams across the guns.
  ...dartFan(bar(8.2), 6, -4, 9, true, 3.0),
  ...wasps(bar(9.1), 6, 9.5, 3.1, 3.2, 58),
  ...hunters(bar(9.9), [[-14, 2], [0, 10], [14, 2]], 4.0),
  ...darts(bar(10.4), [{ fromX: 24, toX: -24, y: 5, arc: 3 }, { fromX: -24, toX: 24, y: -2, arc: 2 }, { fromX: 24, toX: -24, y: 1 }], 3.0),
  ...dartFan(bar(11), 6, -4, 9, false, 3.0),

  // --- The eye (bars 12–14): quiet. Two hunters drift in from the carriers; the vanguard.
  ...hunters(bar(12.8), [[-9, 6], [9, 6]], 4.6),
  ...wasps(bar(13.4), 3, 7, 1.8, 4.2, 66),

  // --- Belly run (bars 14–18): turrets slide past on the hull above; swarm below.
  ...turrets([[-14, -1290], [0, -1318], [14, -1290], [-9, -1400], [9, -1400], [-15, -1452], [0, -1478], [15, -1452]]),
  ...dartFan(bar(14.3), 4, -6, 4, true, 3.2),
  ...wasps(bar(15.2), 4, 8, 2.6, 3.4),
  ...darts(bar(16.1), [{ fromX: -24, toX: 24, y: -4, arc: 2 }, { fromX: 24, toX: -24, y: 2, arc: 3 }, { fromX: -24, toX: 24, y: 6 }, { fromX: 24, toX: -24, y: -1 }], 3.2),
  ...hunters(bar(16.7), [[-13, -3], [13, -3]], 4.0),
  ...wasps(bar(17.4), 4, 9, 2.8, 3.4),

  // --- Flagship pass (bars 18–21): generators one by one, point defense between them.
  ...generators(),
  ...darts(bar(18.6), [{ fromX: 24, toX: -24, y: 6, arc: 2 }, { fromX: 24, toX: -24, y: 1, arc: 3 }, { fromX: 24, toX: -24, y: 9 }], 3.4),
  ...darts(bar(19.9), [{ fromX: 24, toX: -24, y: 3, arc: 3 }, { fromX: 24, toX: -24, y: 8 }, { fromX: 24, toX: -24, y: -1, arc: 2 }], 3.4),

  // --- Around the bow (bars 21–23): the escorts pour in.
  ...wasps(bar(21.1), 6, 9, 3.2, 3.6, 60),
  ...wasps(bar(21.55), 5, 8, -3.0, 3.2, 40),
  ...wasps(bar(23.1), 4, 4.5, 2.8, 3.2, 40),

  // --- Trench (bars 23–25.5): the cores, with darts skimming the trench and wasps behind.
  ...cores(),
  // Trench darts cross inside the channel, wall to wall, so the trenchwork never hides them.
  ...darts(bar(23.4), [{ fromX: -11, toX: 11, y: 1, arc: 2, crossTime: 1.9 }, { fromX: 11, toX: -11, y: 5, arc: 1.5, crossTime: 1.9 }, { fromX: -11, toX: 11, y: -3, arc: 2.5, crossTime: 1.9 }], 3.0),
  ...wasps(bar(24.1), 4, 4.5, 3.0, 3.0, 40),
  ...darts(bar(24.5), [{ fromX: 11, toX: -11, y: 2, arc: 2.5, crossTime: 1.9 }, { fromX: -11, toX: 11, y: 6, crossTime: 1.9 }], 2.8),
]);

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  dart: 100,
  wasp: 140,
  hunter: 240,
  turret: 260,
  bolt: 40,
  generator: 500,
  core: 900,
};

const BOLT_MAX_AGE = 12;

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const interceptions = new Set<number>();
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();
  let generatorsDown = 0;
  let coresDown = 0;
  let shieldUp = true;
  let flagshipSpawned = false;
  let flagshipDestroyed = false;
  let hitsTaken = 0;
  let boltsIntercepted = 0;
  let fullBroadsides = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    generatorIds.clear();
    coreIds.clear();
    generatorsDown = 0;
    coresDown = 0;
    shieldUp = true;
    flagshipSpawned = false;
    flagshipDestroyed = false;
    hitsTaken = 0;
    boltsIntercepted = 0;
    fullBroadsides = 0;
  });
  bus.on('playerhit', () => { hitsTaken += 1; });
  bus.on('fire', ({ enemyId }) => interceptions.add(enemyId));
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'generator') {
      generatorIds.add(enemyId);
      if (!flagshipSpawned) {
        flagshipSpawned = true;
        bus.emit('bossphase', { phase: 'summoned' });
      }
    }
    if (kind === 'core') coreIds.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (generatorIds.delete(enemyId)) {
      generatorsDown += 1;
      if (generatorsDown >= GENERATOR_POSITIONS.length && shieldUp) {
        shieldUp = false;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
    if (coreIds.delete(enemyId)) {
      coresDown += 1;
      if (coresDown >= CORE_POSITIONS.length && !flagshipDestroyed) {
        flagshipDestroyed = true;
        bus.emit('bossphase', { phase: 'destroyed' });
      }
    }
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    generatorIds.delete(enemyId);
    coreIds.delete(enemyId);
  });

  function fireBolt(context: BroadsideUpdate, from: Vector3, heavy = false) {
    const forward = new Vector3();
    context.camera.getWorldDirection(forward);
    if (from.clone().sub(context.camera.position).dot(forward) < 14) return;
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(heavy ? 14 : 10).addScaledVector(forward, railSpeedAt(context.runTime) * 0.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {}, heavy },
    });
  }

  // ---- motion --------------------------------------------------------------------

  function updateDart(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'dart' }>) {
    const { enemy, age, runTime, curve } = context;
    const anchorU = pacer.sample(enemy.entry.time, runTime, data.engagement).anchorU;
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12 || runTime > data.engagement.passTime + MISS_GRACE) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    const z = Math.sin(age * 2.6 + enemy.id) * 0.6;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, z)));
    const aheadT = Math.min(1, clamped + 0.05);
    const aheadEase = aheadT * aheadT * (3 - 2 * aheadT);
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, aheadEase),
      data.y + Math.sin(aheadT * Math.PI) * data.arc,
      z,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(Math.sin(age * 4 + enemy.id) * 0.5 + (data.toX > data.fromX ? -0.9 : 0.9));
    return false;
  }

  function updateWasp(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'wasp' }>) {
    const { enemy, age, camera } = context;
    const t = age / data.lead;
    if (t > 1.02) return true;
    // Camera-relative helix: escorts chase the player through banks and the roll,
    // staying world-upright so the barrel roll spins them across the screen.
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const right = new Vector3().crossVectors(forward, WORLD_UP).normalize();
    if (right.lengthSq() < 0.001) right.set(1, 0, 0);
    const up = new Vector3().crossVectors(right, forward).normalize();
    const close = t * t;
    const ahead = MathUtils.lerp(data.ahead, 7, close);
    const radius = MathUtils.lerp(data.radius, data.radius * 0.4, t * t);
    const angle = data.phase + age * data.spin;
    const position = camera.position.clone()
      .addScaledVector(forward, ahead)
      .addScaledVector(right, Math.cos(angle) * radius)
      .addScaledVector(up, Math.sin(angle) * radius * 0.75 + 1.4);
    enemy.mesh.position.copy(position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(angle * 0.5 + data.tilt);
    return false;
  }

  function updateHunter(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'hunter' }>) {
    const { enemy, age, runTime, curve, camera } = context;
    const anchorU = pacer.sample(enemy.entry.time, runTime, data.engagement).anchorU;
    if (runTime > data.engagement.passTime + MISS_GRACE) return true;
    const offset = new Vector3(
      data.x + Math.sin(age * 0.9 + data.seed) * 1.6,
      data.y + Math.sin(age * 1.3 + data.seed * 1.7) * 1.1,
      0,
    );
    // Telegraphed lunge: rear back, dash in, loose a bolt.
    const fire = context.enemyState(() => ({ nextAt: 1.5 }));
    const until = fire.nextAt - age;
    if (until < 0.8 && until > 0.45) offset.z += (0.8 - until) * 9;
    else if (until <= 0.45 && until > 0) offset.z -= (0.45 - until) * 16;
    if (age >= fire.nextAt) {
      fire.nextAt = age + 2.9;
      fireBolt(context, enemy.mesh.position);
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 1.6 + data.seed) * 0.28);
    enemy.mesh.userData.stripped = enemy.hitPointsRemaining <= 1;
    return false;
  }

  function updateTurret(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'turret' }>) {
    const { enemy, age, runTime, camera } = context;
    if (runTime > data.passTime + MISS_GRACE) return true;
    enemy.mesh.position.copy(data.position);
    // Rooted to the belly, tracking the player as it slides past.
    enemy.mesh.lookAt(camera.position);
    const fire = context.enemyState(() => ({ nextAt: 1.1 + (data.seed % 0.7) }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 2.3;
      fireBolt(context, enemy.mesh.position.clone().addScaledVector(WORLD_UP, -1.2));
    }
    enemy.mesh.userData.stripped = enemy.hitPointsRemaining <= 1;
    return false;
  }

  function updateBolt(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'bolt' }>) {
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
      config: { hitDistance: 4.5, impactBrake: 0.4, damageDistance: 0.8 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    // The rail is faster than any shell: bolts run ahead of the player at about
    // half rail speed and drift onto the camera's path, so they hang in the
    // crossfire ahead and close at a rate a human can read and intercept.
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const aim = hostileShotAimPoint(camera, data.position, 3);
    const lateral = aim.sub(data.position);
    lateral.addScaledVector(forward, -lateral.dot(forward));
    const drift = lateral.lengthSq() > 0.0001 ? lateral.normalize().multiplyScalar(data.heavy ? 20 : 16) : lateral.set(0, 0, 0);
    const desired = forward.clone().multiplyScalar(railSpeedAt(context.runTime) * (data.heavy ? 0.42 : 0.52)).add(drift);
    data.velocity.lerp(desired, Math.min(1, dt * 3.5));
    data.position.addScaledVector(data.velocity, dt);
    enemy.mesh.position.copy(data.position);
    enemy.mesh.lookAt(camera.position);
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateGenerator(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'generator' }>) {
    const { enemy, age, runTime, camera } = context;
    if (runTime > data.passTime + MISS_GRACE) return true;
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 0.6 * (data.index % 2 ? -1 : 1));
    enemy.mesh.userData.stripped = enemy.hitPointsRemaining <= 1;
    // Point defense: each generator's flank battery sprays bolts while it lives.
    const fire = context.enemyState(() => ({ nextAt: 0.9 + data.index * 0.35 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 1.9;
      const muzzle = data.position.clone().add(new Vector3(-4, (data.index % 2 ? 7 : -7), (data.index % 2 ? -10 : 10)));
      fireBolt(context, muzzle, true);
    }
    return false;
  }

  function updateCore(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'core' }>) {
    const { enemy, age, runTime } = context;
    if (runTime > data.passTime + MISS_GRACE) return true;
    enemy.mesh.position.copy(data.position);
    enemy.mesh.rotation.set(0, age * 0.8, 0);
    enemy.mesh.userData.shielded = shieldUp;
    enemy.mesh.userData.damage = 1 - enemy.hitPointsRemaining / 3;
    return false;
  }

  // ---- level definition ------------------------------------------------------------

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    lockRadiusNdc: 0.1,
    timing: { shotDelay: { maxGridSeconds: 0.2 }, actionSfx: { gridThirtyseconds: 1 } },
    createRail: createBroadsideRail,
    spawnTimeline: BROADSIDE_SPAWN_TIMELINE,
    easeRunProgress: broadsideRunProgress,
    startWord: 'LAUNCH',
    replayWord: 'SORTIE',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'dart': return updateDart(context, data);
        case 'wasp': return updateWasp(context, data);
        case 'hunter': return updateHunter(context, data);
        case 'turret': return updateTurret(context, data);
        case 'bolt': return updateBolt(context, data);
        case 'generator': return updateGenerator(context, data);
        case 'core': return updateCore(context, data);
      }
    },
    // The shield: cores can be locked, but while it holds the release swats those
    // shots away (and the rest of the volley still fires).
    validateRelease(enemies) {
      if (!shieldUp) return true;
      const blocked = enemies.filter((enemy) => enemy.kind === 'core');
      if (blocked.length === 0) return true;
      bus.emit('shielded', {
        shields: blocked.map((enemy) => ({ enemyId: enemy.id, worldPosition: enemy.mesh.position.clone() })),
        blockedEnemyIds: blocked.map((enemy) => enemy.id),
      });
      return enemies.filter((enemy) => enemy.kind !== 'core');
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsIntercepted += 1;
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.2));
    },
    scoreForHit: (_volleySize, enemy) => (enemy.kind === 'generator' || enemy.kind === 'core' ? 120 : 60),
    scoreForVolley(results) {
      if (results.length === 6 && results.every((result) => result.killed)) {
        fullBroadsides += 1;
        return 600;
      }
      if (results.length >= 4 && results.every((result) => result.killed)) return results.length * 50;
      return 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (flagshipDestroyed && score >= 24000 && clear >= 0.8) return 'S';
      if (score >= 16000 && clear >= 0.62) return 'A';
      if (score >= 9500 && clear >= 0.42) return 'B';
      if (score >= 4000) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [`Hull ${Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken)}/${BROADSIDE_PLAYER_HEALTH}`];
      if (flagshipDestroyed) lines.push('Enemy flagship destroyed');
      else if (shieldUp) lines.push(`Flagship shield held (${generatorsDown}/${GENERATOR_POSITIONS.length} generators)`);
      else lines.push(`Flagship survived (${coresDown}/${CORE_POSITIONS.length} cores)`);
      if (fullBroadsides > 0) lines.push(`${fullBroadsides} full broadside${fullBroadsides === 1 ? '' : 's'}`);
      if (boltsIntercepted > 0) lines.push(`${boltsIntercepted} bolt${boltsIntercepted === 1 ? '' : 's'} shot down`);
      return lines;
    },
  };
}

export const broadside6m7mGameplay = createBroadsideGameplay;
