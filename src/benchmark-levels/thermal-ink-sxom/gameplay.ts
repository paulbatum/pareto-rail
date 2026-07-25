import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type {
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import type { EventBus } from '../../events';
import {
  THERMAL_INK_SXOM_BPM,
  THERMAL_INK_SXOM_INK_WINDOWS,
  THERMAL_INK_SXOM_RUN_DURATION,
  THERMAL_INK_SXOM_TIME,
} from './timing';

export { THERMAL_INK_SXOM_BPM, THERMAL_INK_SXOM_RUN_DURATION, THERMAL_INK_SXOM_TIME } from './timing';

// The harbor is one arena. The player makes two tightening circuits around a
// fixed animal wrapped around the central wreck, then finishes close enough to
// see the core buckle.
export const THERMAL_INK_BOSS_CENTER = new Vector3(0, 0, -220);
export const THERMAL_INK_PLAYER_HEALTH = 5;

export type ThermalInkSxomEnemyKind =
  | 'arm'
  | 'scavenger'
  | 'cable-eel'
  | 'boiler-spawn'
  | 'ink-cloud'
  | 'core';

type ArmData = {
  role: 'arm';
  socket: number;
  phase: number;
  duration: number;
};

type ScavengerData = {
  role: 'scavenger';
  side: -1 | 1;
  y: number;
  delay: number;
  weave: number;
};

type CableEelData = {
  role: 'cable-eel';
  side: -1 | 1;
  yFrom: number;
  yTo: number;
  phase: number;
};

type BoilerSpawnData = {
  role: 'boiler-spawn';
  x: number;
  y: number;
  phase: number;
  canStrike: boolean;
};

type InkCloudData = {
  role: 'ink-cloud';
  duration: number;
  seed: number;
};

type CoreData = {
  role: 'core';
};

export type ThermalInkSxomSpawnData =
  | ArmData
  | ScavengerData
  | CableEelData
  | BoilerSpawnData
  | InkCloudData
  | CoreData;

export type ThermalInkSpawnEntry = LockOnSpawnEntry<ThermalInkSxomEnemyKind, ThermalInkSxomSpawnData>;
type ThermalInkUpdate = LockOnEnemyUpdate<ThermalInkSxomEnemyKind, ThermalInkSxomSpawnData>;

export function createThermalInkSxomRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 7, -118),
      new Vector3(30, 10, -148),
      new Vector3(58, 4, -194),
      new Vector3(46, -7, -246),
      new Vector3(8, -15, -280),
      new Vector3(-38, -9, -260),
      new Vector3(-61, 3, -218),
      new Vector3(-42, 12, -171),
      new Vector3(2, 8, -148),
      new Vector3(43, 2, -177),
      new Vector3(55, -11, -222),
      new Vector3(27, -16, -266),
      new Vector3(-21, -9, -270),
      new Vector3(-57, 5, -236),
      new Vector3(-39, 13, -184),
      new Vector3(2, 8, -153),
      new Vector3(37, 1, -179),
      new Vector3(44, -7, -222),
      new Vector3(19, -3, -260),
      new Vector3(-17, 3, -267),
      new Vector3(-37, 8, -237),
      new Vector3(-24, 7, -191),
      new Vector3(0, 4, -166),
    ],
    false,
    'catmullrom',
    0.38,
  );
}

const t = THERMAL_INK_SXOM_TIME;

const scavengers = (
  time: number,
  entries: Array<[side: -1 | 1, y: number, delay?: number, weave?: number]>,
): ThermalInkSpawnEntry[] => entries.map(([side, y, delay = 0, weave = 1], index) => ({
  time: time + index * 0.16,
  kind: 'scavenger',
  data: { role: 'scavenger', side, y, delay, weave },
}));

const cableEels = (
  time: number,
  entries: Array<[side: -1 | 1, yFrom: number, yTo: number, phase?: number]>,
): ThermalInkSpawnEntry[] => entries.map(([side, yFrom, yTo, phase = 0], index) => ({
  time: time + index * 0.22,
  kind: 'cable-eel',
  data: { role: 'cable-eel', side, yFrom, yTo, phase: phase + index * 0.8 },
}));

const boilerSpawns = (
  time: number,
  entries: Array<[x: number, y: number, phase?: number, canStrike?: boolean]>,
): ThermalInkSpawnEntry[] => entries.map(([x, y, phase = 0, canStrike = false], index) => ({
  time: time + index * 0.28,
  kind: 'boiler-spawn',
  hitStages: [2, 2],
  data: { role: 'boiler-spawn', x, y, phase: phase + index * 1.3, canStrike },
}));

const arms = (time: number, phase: number, sockets: number[]): ThermalInkSpawnEntry[] =>
  sockets.map((socket, index) => ({
    time: time + index * 0.18,
    kind: 'arm',
    hitStages: [2, 2],
    data: { role: 'arm', socket, phase, duration: 9.2 },
  }));

function buildTimeline(coreEntry: ThermalInkSpawnEntry) {
  const inkEntries: ThermalInkSpawnEntry[] = THERMAL_INK_SXOM_INK_WINDOWS.map((window, index) => ({
    time: window.start - 0.55,
    kind: 'ink-cloud',
    lockable: false,
    countsTowardTotal: false,
    data: {
      role: 'ink-cloud',
      duration: window.end - window.start + 1.8,
      seed: 19.7 + index * 31.1,
    },
  }));

  return [
    // Phase I — the animal is already on the wreck. Two arms peel free while
    // scavengers stitch a broad opening sweep across the sodium-lit water.
    ...arms(t.bar(0.45), 0, [0, 4]),
    ...scavengers(t.bar(0.8), [
      [-1, -6, 0, 1.2],
      [1, 5, 0.25, 1.1],
      [-1, 2, 0.55, 1.5],
      [1, -2, 0.8, 1.35],
    ]),
    ...cableEels(t.bar(2.15), [
      [-1, -10, 9, 0],
      [1, 10, -8, 1.6],
      [-1, 7, -4, 3.1],
    ]),
    ...boilerSpawns(t.bar(3.15), [
      [-13, 7, 0, true],
      [13, -6, 1.7, false],
    ]),

    // Phase II — the first blackout clears into the cable yard. Another pair
    // reaches down as spawn break out of opposite sides of a drowned hull.
    ...arms(t.bar(6.05), 1, [2, 6]),
    ...scavengers(t.bar(6.45), [
      [1, 8, 0, 1.6],
      [-1, -8, 0.2, 1.25],
      [1, 1, 0.45, 1.5],
      [-1, 4, 0.7, 1.1],
      [1, -4, 0.95, 1.35],
    ]),
    ...cableEels(t.bar(7.85), [
      [-1, -11, 10, 0.4],
      [1, 9, -10, 2.1],
      [1, -4, 7, 4],
      [-1, 6, -7, 5.2],
    ]),
    ...boilerSpawns(t.bar(9.0), [
      [-15, -4, 0.3, true],
      [0, 10, 2.2, false],
      [15, 2, 4.1, false],
    ]),
    ...scavengers(t.bar(10.25), [
      [-1, 9, 0, 1.7],
      [1, -9, 0.18, 1.7],
      [-1, -1, 0.36, 1.3],
      [1, 4, 0.54, 1.2],
    ]),

    // Phase III — the rail dives below the lowest arms and skims the cream
    // plates of the broken slipway. Eels knot into a helix around the sight.
    ...arms(t.bar(11.85), 2, [1, 5]),
    ...cableEels(t.bar(12.3), [
      [-1, -10, 10, 0],
      [1, -7, 8, 1.2],
      [-1, 8, -9, 2.4],
      [1, 10, -10, 3.6],
      [-1, -3, 6, 5],
    ]),
    ...scavengers(t.bar(13.7), [
      [-1, -8, 0, 1.7],
      [1, 7, 0.14, 1.7],
      [-1, 2, 0.28, 1.4],
      [1, -2, 0.42, 1.4],
      [-1, 9, 0.56, 1.1],
      [1, -9, 0.7, 1.1],
    ]),
    ...boilerSpawns(t.bar(15.3), [
      [-14, 8, 0, true],
      [14, 7, 2.1, false],
      [-10, -8, 4.2, false],
      [10, -7, 5.7, true],
    ]),
    ...cableEels(t.bar(16.75), [
      [-1, 8, -9, 0.5],
      [1, -9, 9, 2.1],
      [-1, -2, 8, 4.2],
    ]),

    // Phase IV — final arm pair. The machinery spawn attack from every edge;
    // resolving these arms exposes the core just as the last ink front lands.
    ...arms(t.bar(17.05), 3, [3, 7]),
    ...scavengers(t.bar(17.55), [
      [1, 10, 0, 1.8],
      [-1, -10, 0.13, 1.8],
      [1, 4, 0.26, 1.5],
      [-1, -4, 0.39, 1.5],
      [1, -1, 0.52, 1.25],
      [-1, 1, 0.65, 1.25],
    ]),
    ...boilerSpawns(t.bar(18.8), [
      [-16, 0, 0, true],
      [0, 11, 1.5, false],
      [16, 0, 3.2, true],
      [0, -10, 4.8, false],
    ]),
    ...cableEels(t.bar(20.0), [
      [-1, -10, 9, 0],
      [1, 10, -9, 1.5],
      [-1, 5, -7, 3],
      [1, -5, 7, 4.5],
    ]),
    coreEntry,
    ...inkEntries,
  ].sort((a, b) => a.time - b.time);
}

function createCoreEntry(): ThermalInkSpawnEntry {
  return {
    time: t.bar(20.92),
    kind: 'core',
    hitStages: [6, 6],
    lockable: false,
    data: { role: 'core' },
  };
}

// Exported for spawn tracing. A runtime uses a fresh copy so mutating the core
// gate on one replay cannot leak into the next.
export const THERMAL_INK_SXOM_SPAWN_TIMELINE = buildTimeline(createCoreEntry());

const KILL_SCORE: Record<ThermalInkSxomEnemyKind, number> = {
  arm: 550,
  scavenger: 110,
  'cable-eel': 140,
  'boiler-spawn': 260,
  'ink-cloud': 0,
  core: 2400,
};

function cameraAxes(camera: ThermalInkUpdate['camera']) {
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  return { forward, right, up };
}

function placeFromCamera(
  context: ThermalInkUpdate,
  x: number,
  y: number,
  distance: number,
) {
  const { forward, right, up } = cameraAxes(context.camera);
  context.enemy.mesh.position
    .copy(context.camera.position)
    .addScaledVector(forward, distance)
    .addScaledVector(right, x)
    .addScaledVector(up, y);
  return { forward, right, up };
}

export function createThermalInkSxomGameplay(
  bus: EventBus,
): LockOnRunnerLevel<ThermalInkSxomEnemyKind, ThermalInkSxomSpawnData> {
  const coreEntry = createCoreEntry();
  const timeline = buildTimeline(coreEntry);
  const liveArms = new Set<number>();
  const resolvedArms = new Set<number>();
  let coreId = -1;
  let coreKilled = false;
  let hitsTaken = 0;
  let bossAnnounced = false;

  bus.on('runstart', () => {
    liveArms.clear();
    resolvedArms.clear();
    coreId = -1;
    coreKilled = false;
    hitsTaken = 0;
    bossAnnounced = false;
    coreEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'arm') {
      liveArms.add(enemyId);
      if (!bossAnnounced) {
        bossAnnounced = true;
        bus.emit('bossphase', { phase: 'summoned' });
      }
    }
    if (kind === 'core') coreId = enemyId;
  });

  const resolveArm = (enemyId: number) => {
    if (!liveArms.delete(enemyId) || resolvedArms.has(enemyId)) return;
    resolvedArms.add(enemyId);
    if (resolvedArms.size >= 8) {
      coreEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    resolveArm(enemyId);
    if (enemyId === coreId) {
      coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('miss', ({ enemyId }) => resolveArm(enemyId));
  bus.on('playerhit', () => { hitsTaken += 1; });

  function updateArm(context: ThermalInkUpdate, data: ArmData) {
    const { enemy, age, camera } = context;
    const { right, up } = cameraAxes(camera);
    const socketAngle = data.socket * Math.PI / 4 + Math.sin(age * 0.42 + data.phase) * 0.13;
    const lash = Math.sin(Math.min(1, age / 1.3) * Math.PI) * 4.5
      + Math.sin(age * 1.8 + data.socket) * 1.2;
    const radiusX = 18 + Math.sin(age * 0.72 + data.socket) * 2.8;
    const radiusY = 13 + Math.cos(age * 0.58 + data.socket) * 2.1;
    const towardCamera = camera.position.clone().sub(THERMAL_INK_BOSS_CENTER).normalize();

    enemy.mesh.position
      .copy(THERMAL_INK_BOSS_CENTER)
      .addScaledVector(right, Math.cos(socketAngle) * radiusX)
      .addScaledVector(up, Math.sin(socketAngle) * radiusY)
      .addScaledVector(towardCamera, 12 + lash);
    enemy.mesh.lookAt(THERMAL_INK_BOSS_CENTER);
    enemy.mesh.rotateZ(Math.sin(age * 1.15 + data.socket) * 0.28);
    enemy.mesh.userData.flex = age;
    enemy.mesh.userData.damage = enemy.hitStageIndex;
    return age > data.duration;
  }

  function updateScavenger(context: ThermalInkUpdate, data: ScavengerData) {
    const activeAge = Math.max(0, context.age - data.delay);
    const progress = MathUtils.clamp(activeAge / 5.1, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const x = MathUtils.lerp(data.side * 20, data.side * -19, eased);
    const y = data.y
      + Math.sin(activeAge * 3.6 + context.enemy.id) * (1.2 + data.weave * 0.45)
      + Math.sin(progress * Math.PI) * 3.2 * data.weave;
    const distance = MathUtils.lerp(39, 23, progress);
    placeFromCamera(context, x, y, distance);
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(Math.sin(activeAge * 6.2) * 0.32);
    context.enemy.mesh.userData.scuttle = activeAge;
    return activeAge > 5.45;
  }

  function updateCableEel(context: ThermalInkUpdate, data: CableEelData) {
    const progress = MathUtils.clamp(context.age / 6.2, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const x = data.side * (16 - Math.sin(progress * Math.PI) * 5.5)
      + Math.sin(context.age * 3.3 + data.phase) * 2.2;
    const y = MathUtils.lerp(data.yFrom, data.yTo, eased)
      + Math.sin(context.age * 2.4 + data.phase) * 1.5;
    const distance = MathUtils.lerp(45, 25, progress);
    placeFromCamera(context, x, y, distance);
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(data.side * (0.42 + Math.sin(context.age * 2.1) * 0.24));
    context.enemy.mesh.userData.swim = context.age;
    return context.age > 6.45;
  }

  function updateBoilerSpawn(context: ThermalInkUpdate, data: BoilerSpawnData) {
    const progress = MathUtils.clamp(context.age / 6.8, 0, 1);
    const telegraph = Math.sin(MathUtils.clamp(context.age / 1.5, 0, 1) * Math.PI);
    const lunge = context.age > 4.2 ? (context.age - 4.2) ** 2 * 1.6 : 0;
    const x = data.x + Math.sin(context.age * 1.7 + data.phase) * 2.4;
    const y = data.y + Math.cos(context.age * 1.35 + data.phase) * 2.2 + telegraph * 2;
    const distance = Math.max(7, MathUtils.lerp(48, 25, progress) - lunge);
    placeFromCamera(context, x, y, distance);
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(context.age * 1.8 + data.phase);
    context.enemy.mesh.userData.pressure = telegraph;

    const strike = context.enemyState(() => ({ spent: false }));
    if (data.canStrike && !strike.spent && context.age >= 6.25) {
      strike.spent = true;
      context.damagePlayer(1);
      return true;
    }
    return context.age > 6.9;
  }

  function updateInkCloud(context: ThermalInkUpdate, data: InkCloudData) {
    const { forward, right, up } = cameraAxes(context.camera);
    const swayX = Math.sin(context.age * 0.31 + data.seed) * 2.5;
    const swayY = Math.cos(context.age * 0.27 + data.seed * 0.7) * 1.8;
    context.enemy.mesh.position
      .copy(context.camera.position)
      .addScaledVector(forward, 19)
      .addScaledVector(right, swayX)
      .addScaledVector(up, swayY);
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.userData.cloudAge = context.age;
    return context.age > data.duration;
  }

  function updateCore(context: ThermalInkUpdate) {
    const towardCamera = context.camera.position.clone().sub(THERMAL_INK_BOSS_CENTER).normalize();
    context.enemy.mesh.position
      .copy(THERMAL_INK_BOSS_CENTER)
      .addScaledVector(towardCamera, 8.4);
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(Math.sin(context.runTime * 0.8) * 0.12);
    context.enemy.mesh.userData.damage = context.enemy.hitStageIndex;
    context.enemy.mesh.userData.heartbeat = context.runTime;
    return false;
  }

  return {
    duration: THERMAL_INK_SXOM_RUN_DURATION,
    bpm: THERMAL_INK_SXOM_BPM,
    playerHealth: THERMAL_INK_PLAYER_HEALTH,
    lockRadiusNdc: 0.095,
    timing: {
      shotDelay: {
        pattern: 'grid-ramp',
        gapThirtyseconds: 1,
        releaseShare: 0.64,
        gridRampGapGrowthThirtyseconds: 1,
        maxGridSeconds: 0.2,
      },
      actionSfx: {
        enabled: true,
        gridThirtyseconds: 1,
      },
    },
    createRail: createThermalInkSxomRail,
    spawnTimeline: timeline,
    startWord: 'START',
    replayWord: 'REPLAY',
    updateAttractCamera({ camera, modeTime }) {
      camera.lookAt(THERMAL_INK_BOSS_CENTER);
      camera.rotateZ(Math.sin(modeTime * 0.35) * 0.025);
      camera.updateMatrixWorld();
    },
    updateCameraEffects({ camera, runTime }) {
      camera.lookAt(THERMAL_INK_BOSS_CENTER);
      const dive = Math.sin((runTime / THERMAL_INK_SXOM_RUN_DURATION) * Math.PI * 4);
      camera.rotateZ(Math.sin(runTime * 0.38) * 0.045 + dive * 0.018);
      camera.fov = 60 + Math.sin(runTime * 0.22) * 1.2;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'arm':
          return updateArm(context, data);
        case 'scavenger':
          return updateScavenger(context, data);
        case 'cable-eel':
          return updateCableEel(context, data);
        case 'boiler-spawn':
          return updateBoilerSpawn(context, data);
        case 'ink-cloud':
          return updateInkCloud(context, data);
        case 'core':
          return updateCore(context);
      }
    },
    validateRelease(enemies) {
      // The core is a twelve-hit finale, but it only accepts fire after the
      // eight arm entries have resolved and turned the timeline gate on.
      const allowed = enemies.filter((enemy) => enemy.kind !== 'core' || coreEntry.lockable !== false);
      return allowed.length > 0 ? allowed : false;
    },
    scoreForHit(volleySize, enemy) {
      const bossWeight = enemy.kind === 'arm' || enemy.kind === 'core' ? 75 : 38;
      return Math.round(bossWeight * (1 + Math.max(0, volleySize - 1) * 0.08));
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      const kills = results.filter((result) => result.killed).length;
      if (results.length === 6 && kills === 6) return 720;
      return kills === results.length ? results.length * 80 : 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (coreKilled && score >= 17500 && clearRate >= 0.8) return 'S';
      if (coreKilled && score >= 12000 && clearRate >= 0.6) return 'A';
      if (score >= 7600 && clearRate >= 0.42) return 'B';
      if (score >= 3400 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, THERMAL_INK_PLAYER_HEALTH - hitsTaken);
      return [
        `Hull ${hull}/${THERMAL_INK_PLAYER_HEALTH}`,
        `${Math.min(8, resolvedArms.size)}/8 arms severed`,
        coreKilled ? 'Thermal core extinguished' : 'The thing is still warm',
      ];
    },
  };
}
