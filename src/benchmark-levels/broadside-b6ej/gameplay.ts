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
import type { EventBus } from '../../events';
import {
  BROADSIDE_B6EJ_BARS,
  BROADSIDE_B6EJ_BPM,
  BROADSIDE_B6EJ_RUN_DURATION,
  BROADSIDE_B6EJ_TIME,
} from './timing';

export { BROADSIDE_B6EJ_BPM, BROADSIDE_B6EJ_RUN_DURATION, BROADSIDE_B6EJ_TIME } from './timing';

export type BroadsideB6ejEnemyKind =
  | 'interceptor' | 'spiral' | 'bomber' | 'turret' | 'shield' | 'escort' | 'core' | 'flak';

type SwarmData = {
  role: 'swarm'; lead: number; x: number; y: number; motion: 'slash' | 'helix' | 'surge' | 'escort'; phase: number;
};
type TurretData = { role: 'turret'; lead: number; x: number; y: number; side: number };
type ShieldData = { role: 'shield'; anchor: number; x: number; y: number; index: number };
type CoreData = { role: 'core'; anchor: number; x: number; y: number; index: number };
type FlakData = { role: 'flak'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState };
export type BroadsideB6ejSpawnData = SwarmData | TurretData | ShieldData | CoreData | FlakData;
export type BroadsideSpawn = LockOnSpawnEntry<BroadsideB6ejEnemyKind, BroadsideB6ejSpawnData>;
type BroadsideUpdate = LockOnEnemyUpdate<BroadsideB6ejEnemyKind, BroadsideB6ejSpawnData>;

const bar = (value: number, beat = 0) => BROADSIDE_B6EJ_TIME.bar(value, beat);

export function broadsideProgress(time: number, duration = BROADSIDE_B6EJ_RUN_DURATION) {
  const x = MathUtils.clamp(time / duration, 0, 1);
  const keys: Array<[number, number]> = [
    [0, 0], [0.11, 0.075], [0.29, 0.31], [0.47, 0.56], [0.61, 0.68],
    [0.72, 0.745], [0.835, 0.83], [0.92, 0.91], [0.972, 0.955], [1, 1],
  ];
  for (let i = 1; i < keys.length; i += 1) {
    if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1]; const [x1, y1] = keys[i];
      return MathUtils.lerp(y0, y1, MathUtils.smoothstep(x, x0, x1));
    }
  }
  return 1;
}

export function createBroadsideB6ejRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 8, 80), new Vector3(0, 15, -40), new Vector3(-38, 30, -180),
    new Vector3(48, 8, -330), new Vector3(-65, 42, -490), new Vector3(30, 14, -660),
    new Vector3(74, 2, -820), new Vector3(38, 7, -1010), new Vector3(-42, -18, -1190),
    new Vector3(-74, -26, -1370), new Vector3(42, 6, -1530), new Vector3(80, 32, -1700),
    new Vector3(20, 12, -1860), new Vector3(-18, -18, -2020), new Vector3(0, -8, -2180),
    new Vector3(0, 6, -2320), new Vector3(0, 45, -2460), new Vector3(0, 125, -2580),
  ], false, 'catmullrom', 0.38);
}

const swarmWave = (
  time: number,
  kind: 'interceptor' | 'spiral' | 'bomber' | 'escort',
  motion: SwarmData['motion'],
  points: Array<[number, number]>,
  lead = 5,
): BroadsideSpawn[] => points.map(([x, y], index) => ({
  time: time + index * 0.1,
  kind,
  ...(kind === 'bomber' ? { hitStages: [2, 2] } : {}),
  data: { role: 'swarm', lead: lead * 0.62, x, y, motion, phase: index * 1.71 + time * 0.6 },
}));

const turretWave = (time: number, points: Array<[number, number]>, lead = 5.4): BroadsideSpawn[] =>
  points.map(([x, y], index) => ({
    time: time + index * 0.14, kind: 'turret', hitStages: [2, 1],
    data: { role: 'turret', lead: lead * 0.62, x, y, side: index % 2 ? -1 : 1 },
  }));

const SHIELDS: BroadsideSpawn[] = [
  [-15, 7], [-5, -5], [6, 7], [16, -5],
].map(([x, y], index) => ({
  time: bar(BROADSIDE_B6EJ_BARS.flagship) + index * 0.16,
  kind: 'shield', hitStages: [2], lockable: true,
  data: { role: 'shield', anchor: 0.86 + index * 0.012, x, y, index },
}));

const CORES: BroadsideSpawn[] = [
  [-8, -4], [0, 4], [8, -4],
].map(([x, y], index) => ({
  time: bar(BROADSIDE_B6EJ_BARS.trench) + index * 0.12,
  kind: 'core', hitStages: [2, 2], lockable: false,
  data: { role: 'core', anchor: 0.945 + index * 0.009, x, y, index },
}));

export const BROADSIDE_B6EJ_SPAWN_TIMELINE: BroadsideSpawn[] = [
  ...swarmWave(bar(1.4), 'interceptor', 'slash', [[-10, -2], [-5, 4], [0, 7], [5, 4], [10, -2]], 5.1),
  ...swarmWave(bar(3), 'spiral', 'helix', [[-9, 6], [-4, -4], [4, -4], [9, 6]], 5),
  ...swarmWave(bar(4.6), 'interceptor', 'slash', [[-16, 4], [-10, -5], [-3, 7], [4, -7], [11, 5], [17, -3]], 4.8),
  ...swarmWave(bar(6.2), 'bomber', 'surge', [[-12, -5], [0, 8], [12, -5]], 5.8),
  ...swarmWave(bar(8), 'spiral', 'helix', [[-15, 7], [-9, -7], [-3, 4], [3, -4], [9, 7], [15, -7]], 5),
  ...swarmWave(bar(10), 'interceptor', 'slash', [[-17, -4], [-11, 5], [-5, -7], [5, 7], [11, -5], [17, 4]], 4.7),
  ...swarmWave(bar(12), 'bomber', 'surge', [[-13, 7], [-5, -4], [5, -4], [13, 7]], 5.5),
  ...swarmWave(bar(14), 'spiral', 'helix', [[-17, 0], [-11, 8], [-4, -7], [4, 7], [11, -8], [17, 0]], 4.8),
  ...turretWave(bar(16), [[-14, -6], [-7, 5], [0, -7], [7, 5], [14, -6]], 5.3),
  ...swarmWave(bar(18.2), 'interceptor', 'slash', [[-18, 7], [-12, -5], [-6, 4], [6, -4], [12, 5], [18, -7]], 4.5),
  ...turretWave(bar(20), [[-15, 5], [-8, -7], [0, 6], [8, -7], [15, 5]], 4.9),
  ...swarmWave(bar(22.7), 'spiral', 'helix', [[-11, -4], [-4, 7], [4, -7], [11, 4]], 5.2),
  ...swarmWave(bar(24.3), 'bomber', 'surge', [[-12, 2], [0, -7], [12, 2]], 5.5),
  ...SHIELDS,
  ...swarmWave(bar(30), 'escort', 'escort', [[-17, 7], [-12, -7], [-6, 4], [0, -5], [6, 5], [12, -6], [17, 7]], 3.8),
  ...swarmWave(bar(31.3), 'escort', 'escort', [[-14, -6], [-8, 6], [0, -1], [8, -6], [14, 6]], 3.3),
  ...CORES,
].sort((a, b) => a.time - b.time);

const SCORE: Record<BroadsideB6ejEnemyKind, number> = {
  interceptor: 110, spiral: 135, bomber: 280, turret: 300, shield: 550, escort: 150, core: 900, flak: 60,
};

export function createBroadsideB6ejGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideB6ejEnemyKind, BroadsideB6ejSpawnData> {
  const intercepted = new Set<number>();
  const enemyKinds = new Map<number, BroadsideB6ejEnemyKind>();
  let shieldKills = 0; let coreKills = 0; let flakKills = 0; let hitsTaken = 0;

  bus.on('runstart', () => {
    intercepted.clear(); enemyKinds.clear(); shieldKills = 0; coreKills = 0; flakKills = 0; hitsTaken = 0;
    for (const core of CORES) core.lockable = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => enemyKinds.set(enemyId, kind as BroadsideB6ejEnemyKind));
  bus.on('fire', ({ enemyId }) => intercepted.add(enemyId));
  bus.on('kill', ({ enemyId }) => {
    const kind = enemyKinds.get(enemyId);
    if (kind === 'shield') { shieldKills += 1; if (shieldKills === SHIELDS.length) bus.emit('bossphase', { phase: 'exposed' }); }
    if (kind === 'core') { coreKills += 1; if (coreKills === CORES.length) bus.emit('bossphase', { phase: 'destroyed' }); }
    if (kind === 'flak') flakKills += 1;
    enemyKinds.delete(enemyId); intercepted.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => { enemyKinds.delete(enemyId); intercepted.delete(enemyId); });
  bus.on('playerhit', () => { hitsTaken += 1; });

  function launchFlak(context: BroadsideUpdate, lateral: number) {
    const from = context.enemy.mesh.position.clone().add(new Vector3(lateral, 0.6, 1.5));
    context.spawnEnemy({
      time: context.runTime, kind: 'flak', countsTowardTotal: false,
      data: {
        role: 'flak', position: from,
        velocity: hostileShotAimPoint(context.camera, from, 2.4).sub(from).normalize().multiplyScalar(9),
        lastAge: 0, impact: {},
      },
    });
  }

  function updateSwarm(context: BroadsideUpdate, data: SwarmData) {
    const anchor = context.railAnchor(data.lead);
    const enter = MathUtils.smoothstep(context.age, 0, 0.55);
    let x = data.x; let y = data.y;
    if (data.motion === 'slash') {
      x += -Math.sign(data.x || 1) * context.age * 5.2;
      y += Math.sin(context.age * 2.8 + data.phase) * 2.2;
    } else if (data.motion === 'helix') {
      x += Math.cos(context.age * 3.1 + data.phase) * 5.2;
      y += Math.sin(context.age * 3.1 + data.phase) * 5.2;
      context.enemy.mesh.rotation.z = context.age * 3.2 + data.phase;
    } else if (data.motion === 'surge') {
      x *= 0.72 + Math.sin(context.age * 1.4 + data.phase) * 0.12;
      y += Math.sin(context.age * 1.8 + data.phase) * 1.1;
    } else {
      x += Math.sin(context.age * 4.6 + data.phase) * 3.8;
      y += Math.cos(context.age * 3.7 + data.phase) * 2.8;
      context.enemy.mesh.rotation.z = Math.sin(context.age * 4 + data.phase) * 0.7;
    }
    const local = new Vector3(x * 1.32, y * 1.35, data.motion === 'surge' ? Math.sin(context.age * 2) * 4 : 0);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, local));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ((1 - enter) * Math.sign(data.x || 1) * 0.7 + Math.sin(context.age + data.phase) * 0.12);
    return context.runProgress > anchor + 0.018 || context.age > data.lead + 2;
  }

  function updateTurret(context: BroadsideUpdate, data: TurretData) {
    const anchor = context.railAnchor(data.lead);
    const rise = MathUtils.smoothstep(context.age, 0.2, 1.2);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(data.x * 1.32, data.y * 1.34 + rise * 4 - 4, 0)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    const fire = context.enemyState(() => ({ next: 1.6 + (context.enemy.id % 4) * 0.24 }));
    if (context.age >= fire.next) { fire.next += 3.1; launchFlak(context, data.side * 0.7); }
    return context.runProgress > anchor + 0.017 || context.age > 7;
  }

  function updateShield(context: BroadsideUpdate, data: ShieldData) {
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, data.anchor, new Vector3(data.x, data.y, 0)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.userData.generatorIndex = data.index;
    const fire = context.enemyState(() => ({ next: 0.9 + data.index * 0.38 }));
    if (context.age >= fire.next && context.age < 6.2) { fire.next += 2.25; launchFlak(context, data.index % 2 ? -1 : 1); }
    return false;
  }

  function updateCore(context: BroadsideUpdate, data: CoreData) {
    context.enemy.entry.lockable = shieldKills >= SHIELDS.length;
    context.enemy.mesh.userData.armed = context.enemy.entry.lockable;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, data.anchor, new Vector3(data.x, data.y, -2)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotation.z = Math.sin(context.age * 1.5 + data.index) * 0.15;
    return false;
  }

  function updateFlak(context: BroadsideUpdate, data: FlakData) {
    const dt = Math.max(0, context.age - data.lastAge); data.lastAge = context.age;
    const impact = updateHostileShotImpact({
      age: context.age, camera: context.camera, position: data.position, velocity: data.velocity,
      state: data.impact, intercepted: intercepted.delete(context.enemy.id),
    });
    if (impact.phase === 'braking') {
      context.enemy.mesh.position.copy(data.position);
      if (impact.damaged) { context.damagePlayer(1); return true; }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(context.camera, data.position, 2.2), context.age, dt, {
      baseSpeed: 9, maxSpeed: 21, accel: 6, turnRate: 1.7,
    });
    context.enemy.mesh.position.copy(data.position);
    context.enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return context.age > 8 || shotBehindCamera(context.camera, data.position);
  }

  return {
    duration: BROADSIDE_B6EJ_RUN_DURATION,
    bpm: BROADSIDE_B6EJ_BPM,
    playerHealth: 4,
    createRail: createBroadsideB6ejRail,
    spawnTimeline: BROADSIDE_B6EJ_SPAWN_TIMELINE,
    easeRunProgress: broadsideProgress,
    lockRadiusNdc: 0.205,
    startWord: 'DEPLOY',
    replayWord: 'RETURN',
    timing: { shotDelay: { maxGridSeconds: 0.135 }, actionSfx: { gridThirtyseconds: 2 } },
    updateAttractCamera({ camera, modeTime }) {
      camera.rotation.z += Math.sin(modeTime * 0.32) * 0.08;
    },
    updateCameraEffects({ camera, runTime }) {
      const bank = Math.sin(runTime * 0.72) * 0.055;
      const melee = runTime > bar(4) && runTime < bar(10) ? Math.sin(runTime * 1.5) * 0.12 : 0;
      const corkscrew = runTime > bar(18) && runTime < bar(22) ? Math.sin((runTime - bar(18)) * 2.2) * 0.18 : 0;
      const pullback = runTime > bar(35) ? Math.sin((runTime - bar(35)) * Math.PI / 1.67) * -0.08 : 0;
      camera.rotation.z += bank + melee + corkscrew + pullback;
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'swarm') return updateSwarm(context, data);
      if (data.role === 'turret') return updateTurret(context, data);
      if (data.role === 'shield') return updateShield(context, data);
      if (data.role === 'core') return updateCore(context, data);
      return updateFlak(context, data);
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.18));
    },
    scoreForHit: (_volleySize, enemy) => enemy.kind === 'core' ? 180 : 70,
    scoreForVolley: (results) => results.length === 6 ? 600 : 0,
    rankForRun(score, kills, total) {
      const ratio = total ? kills / total : 0;
      if (ratio >= 0.94 && coreKills === CORES.length && hitsTaken === 0 && score >= 14000) return 'FLEET ADMIRAL';
      if (ratio >= 0.78 && coreKills === CORES.length) return 'COMMODORE';
      if (ratio >= 0.58) return 'WING LEADER';
      return 'ENSIGN';
    },
    detailsForRun: () => [
      `HULL ${Math.max(0, 4 - hitsTaken)}/4`,
      `SHIELDS ${shieldKills}/${SHIELDS.length} • CORES ${coreKills}/${CORES.length}`,
      `FLAK INTERCEPTED ${flakKills}`,
    ],
  };
}
