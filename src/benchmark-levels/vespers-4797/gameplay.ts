import { CatmullRomCurve3, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { createMusicTime } from '../../engine/music-time';

export const VESPERS_4797_BPM = 120;
export const VESPERS_4797_TIME = createMusicTime(VESPERS_4797_BPM, { stepsPerBar: 16 });
export const VESPERS_4797_RUN_DURATION = VESPERS_4797_TIME.bar(30);

export const VESPERS_4797_MARKERS = VESPERS_4797_TIME.markers({
  threshold: 0,
  processional: 2,
  gallery: 8,
  swell: 12,
  silence: 16,
  roseApproach: 24,
  roseWindow: 25,
  ignition: 27,
});

export type Vespers4797EnemyKind = 'wraith' | 'lancet' | 'bell' | 'rose';
type Vespers4797Motion = 'float' | 'ascend' | 'pendulum';

export type Vespers4797SpawnData = {
  role: 'window' | 'rose';
  lead: number;
  offset: Vector3;
  motion: Vespers4797Motion;
  window: number;
};

export type Vespers4797SpawnEntry = LockOnSpawnEntry<Vespers4797EnemyKind, Vespers4797SpawnData>;
export type Vespers4797Update = LockOnEnemyUpdate<Vespers4797EnemyKind, Vespers4797SpawnData>;

// The nave bends just enough to make the stone piers slide past the eye. The
// final point is deliberately close to the west wall, where the rose window
// becomes the horizon instead of a far-away prop.
export function createVespers4797Rail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 8),
      new Vector3(0, 1, -34),
      new Vector3(8, -1, -76),
      new Vector3(-7, 2, -120),
      new Vector3(-11, -1, -168),
      new Vector3(5, 2, -214),
      new Vector3(11, 0, -260),
      new Vector3(-8, 3, -308),
      new Vector3(-5, -2, -356),
      new Vector3(10, 1, -404),
      new Vector3(7, 0, -452),
      new Vector3(-4, 2, -500),
      new Vector3(-2, 0, -548),
      new Vector3(0, 1, -596),
      new Vector3(0, 0, -630),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

const time = VESPERS_4797_TIME;

function windowEntry(
  timeSeconds: number,
  kind: Exclude<Vespers4797EnemyKind, 'rose'>,
  lead: number,
  x: number,
  y: number,
  motion: Vespers4797Motion,
  window: number,
): Vespers4797SpawnEntry {
  return {
    time: timeSeconds,
    kind,
    data: { role: 'window', lead: Math.min(4.05, lead), offset: new Vector3(x, y, 0), motion, window },
  };
}

function roseEntry(timeSeconds: number): Vespers4797SpawnEntry {
  return {
    time: timeSeconds,
    kind: 'rose',
    hitStages: [2, 2, 3],
    data: {
      role: 'rose',
      lead: 6.2,
      // The rose is high on the west wall; keep its target in the wheel's
      // center so the thing eating the light is visibly nested in it.
      // Pull it a few metres toward the camera so the black shell is in front
      // of (rather than depth-fighting with) the static rose geometry.
      offset: new Vector3(0, 10.2, -7),
      motion: 'float',
      window: 0,
    },
  };
}

// The entries are phrase-shaped rather than metronomic. Early waves leave
// room for the player to learn the sweep; the middle fills the upper gallery;
// bars 16–24 are intentionally almost empty before the rose window arrives.
export const VESPERS_4797_SPAWN_TIMELINE: Vespers4797SpawnEntry[] = [
  // Threshold: the first stolen panes drift out of the dark.
  windowEntry(time.bar(1), 'wraith', 4.5, -8.5, 2.8, 'float', 0),
  windowEntry(time.bar(1, 0.5), 'wraith', 4.5, 8.5, -1.8, 'float', 1),
  windowEntry(time.bar(1, 1.5), 'lancet', 4.6, -1.5, 5.6, 'ascend', 2),
  windowEntry(time.bar(2), 'bell', 4.9, -10.5, -2.5, 'pendulum', 3),
  windowEntry(time.bar(2, 0.75), 'bell', 4.9, 10.5, 0.4, 'pendulum', 4),
  windowEntry(time.bar(2, 2.5), 'wraith', 4.4, 2.4, -4.7, 'float', 5),

  // Processional: paired figures answer each other across the nave.
  windowEntry(time.bar(3), 'lancet', 4.4, -8.8, 4.8, 'ascend', 6),
  windowEntry(time.bar(3, 0.5), 'lancet', 4.4, 8.8, 4.8, 'ascend', 7),
  windowEntry(time.bar(3, 2), 'wraith', 4.6, -6.5, -3.8, 'float', 8),
  windowEntry(time.bar(3, 2.5), 'wraith', 4.6, 6.5, -3.8, 'float', 9),
  windowEntry(time.bar(4), 'bell', 4.8, -11.2, 2.2, 'pendulum', 10),
  windowEntry(time.bar(4, 1), 'bell', 4.8, 0, 5.8, 'pendulum', 11),
  windowEntry(time.bar(4, 2), 'bell', 4.8, 11.2, 2.2, 'pendulum', 12),
  windowEntry(time.bar(5), 'wraith', 4.5, -9.6, 4.2, 'float', 13),
  windowEntry(time.bar(5, 0.5), 'wraith', 4.5, -3.2, 0.5, 'float', 14),
  windowEntry(time.bar(5, 1), 'wraith', 4.5, 3.2, 0.5, 'float', 15),
  windowEntry(time.bar(5, 1.5), 'wraith', 4.5, 9.6, 4.2, 'float', 16),
  windowEntry(time.bar(6), 'lancet', 4.4, -7.5, -1.8, 'ascend', 17),
  windowEntry(time.bar(6, 0.75), 'lancet', 4.4, 7.5, -1.8, 'ascend', 18),
  windowEntry(time.bar(6, 2), 'bell', 4.9, -4.6, 5.6, 'pendulum', 19),
  windowEntry(time.bar(6, 2.75), 'bell', 4.9, 4.6, 5.6, 'pendulum', 20),

  // Stained gallery: the widest fan, then a high suspended answer.
  windowEntry(time.bar(8), 'wraith', 4.6, -11.5, -1.5, 'float', 21),
  windowEntry(time.bar(8, 0.5), 'lancet', 4.6, -7.2, 4.9, 'ascend', 22),
  windowEntry(time.bar(8, 1), 'wraith', 4.6, -2.6, 2.1, 'float', 23),
  windowEntry(time.bar(8, 1.5), 'wraith', 4.6, 2.6, 2.1, 'float', 24),
  windowEntry(time.bar(8, 2), 'lancet', 4.6, 7.2, 4.9, 'ascend', 25),
  windowEntry(time.bar(8, 2.5), 'wraith', 4.6, 11.5, -1.5, 'float', 26),
  windowEntry(time.bar(9, 1), 'bell', 4.8, -8.8, -4.2, 'pendulum', 27),
  windowEntry(time.bar(9, 1.5), 'bell', 4.8, 8.8, -4.2, 'pendulum', 28),
  windowEntry(time.bar(10), 'lancet', 4.5, -10.5, 4.6, 'ascend', 29),
  windowEntry(time.bar(10, 0.5), 'lancet', 4.5, 0, 6.7, 'ascend', 30),
  windowEntry(time.bar(10, 1), 'lancet', 4.5, 10.5, 4.6, 'ascend', 31),
  windowEntry(time.bar(11), 'wraith', 4.5, -7.4, 0.3, 'float', 32),
  windowEntry(time.bar(11, 0.75), 'bell', 4.7, 0, -4.9, 'pendulum', 33),
  windowEntry(time.bar(11, 1.5), 'wraith', 4.5, 7.4, 0.3, 'float', 34),

  // Swell: a last six-voice chord in space before everything drops away.
  windowEntry(time.bar(12), 'bell', 4.9, -11.2, 3.4, 'pendulum', 35),
  windowEntry(time.bar(12, 0.5), 'wraith', 4.8, -6.5, -2.5, 'float', 36),
  windowEntry(time.bar(12, 1), 'lancet', 4.8, -2.1, 5.8, 'ascend', 37),
  windowEntry(time.bar(12, 1.5), 'lancet', 4.8, 2.1, 5.8, 'ascend', 38),
  windowEntry(time.bar(12, 2), 'wraith', 4.8, 6.5, -2.5, 'float', 39),
  windowEntry(time.bar(12, 2.5), 'bell', 4.9, 11.2, 3.4, 'pendulum', 40),
  windowEntry(time.bar(14), 'wraith', 4.3, -9.5, 1.8, 'float', 41),
  windowEntry(time.bar(14, 1), 'lancet', 4.5, 0, -5.8, 'ascend', 42),
  windowEntry(time.bar(14, 2), 'wraith', 4.3, 9.5, 1.8, 'float', 43),

  // The silence is real: no targets for eight bars, just candles and stone.

  // Rose approach: a few last panes return, then the dead west window opens.
  windowEntry(time.bar(24), 'wraith', 5.0, -9.6, 3.3, 'float', 44),
  windowEntry(time.bar(24, 1), 'bell', 5.0, 9.6, 3.3, 'pendulum', 45),
  windowEntry(time.bar(24, 2.5), 'lancet', 5.1, 0, -5.8, 'ascend', 46),
  windowEntry(time.bar(25), 'wraith', 5.0, -5.5, 0.6, 'float', 47),
  windowEntry(time.bar(25, 0.5), 'wraith', 5.0, 5.5, 0.6, 'float', 48),
  roseEntry(time.bar(25, 1.5)),
];

function updateWindow(context: Vespers4797Update, data: Vespers4797SpawnData) {
  const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
  const anchorU = railAnchor(data.lead);
  const offset = data.offset.clone();

  if (data.motion === 'float') {
    offset.x += Math.sin(age * 1.15 + enemy.id * 0.7) * 1.1;
    offset.y += Math.cos(age * 0.8 + enemy.id) * 0.65;
    offset.z += Math.sin(age * 0.9 + enemy.id * 0.25) * 0.7;
  } else if (data.motion === 'ascend') {
    offset.x += Math.sin(age * 1.55 + enemy.id) * 0.9;
    offset.y += Math.sin(age * 0.7 + enemy.id * 0.4) * 1.1 + Math.min(age, 3.8) * 0.18;
    offset.z += Math.cos(age * 1.1) * 0.45;
  } else {
    offset.x += Math.sin(age * 0.65 + enemy.id) * 2.35;
    offset.y += Math.cos(age * 1.3 + enemy.id * 0.2) * 1.25;
    offset.z += Math.sin(age * 1.05 + enemy.id) * 1.15;
  }

  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.quaternion.copy(camera.quaternion);
  if (data.motion === 'float') {
    enemy.mesh.rotateZ(Math.sin(age * 0.75 + enemy.id) * 0.32 + runTime * 0.18);
    enemy.mesh.rotateY(Math.cos(age * 0.55 + enemy.id) * 0.22);
  } else if (data.motion === 'ascend') {
    enemy.mesh.rotateZ(Math.sin(age * 1.1 + enemy.id) * 0.45);
    enemy.mesh.rotateX(Math.cos(age * 0.7) * 0.28);
  } else {
    enemy.mesh.rotateZ(Math.sin(age * 0.6 + enemy.id) * 0.18);
    enemy.mesh.rotateY(Math.sin(age * 1.5 + enemy.id) * 0.4);
  }

  return runProgress > anchorU + 0.02;
}

function updateRose(context: Vespers4797Update, data: Vespers4797SpawnData) {
  const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
  const anchorU = railAnchor(data.lead);
  const offset = data.offset.clone();
  const stage = enemy.hitStageIndex;
  offset.y += Math.sin(age * 0.55) * 0.45;
  offset.z += Math.sin(age * 0.7) * 0.5;
  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.quaternion.copy(camera.quaternion);
  enemy.mesh.rotateZ(runTime * (0.08 + stage * 0.12));
  enemy.mesh.rotateY(Math.sin(age * 0.42) * 0.18);
  enemy.mesh.userData.stage = stage;
  enemy.mesh.userData.pulse = 0.5 + stage * 0.25 + Math.sin(age * (1.4 + stage * 0.3)) * 0.12;
  return runProgress > anchorU + 0.025;
}

export function createVespers4797Gameplay(bus: EventBus): LockOnRunnerLevel<Vespers4797EnemyKind, Vespers4797SpawnData> {
  let bossId = -1;
  let bossSummoned = false;
  let bossExposed = false;

  bus.on('runstart', () => {
    bossId = -1;
    bossSummoned = false;
    bossExposed = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'rose' || bossSummoned) return;
    bossId = enemyId;
    bossSummoned = true;
    bus.emit('bossphase', { phase: 'summoned' });
  });
  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (enemyId !== bossId || bossExposed || stageIndex < 2) return;
    bossExposed = true;
    bus.emit('bossphase', { phase: 'exposed' });
  });
  bus.on('kill', ({ enemyId }) => {
    if (enemyId !== bossId) return;
    bus.emit('bossphase', { phase: 'destroyed' });
  });

  return {
    duration: VESPERS_4797_RUN_DURATION,
    bpm: VESPERS_4797_BPM,
    playerHealth: 3,
    createRail: createVespers4797Rail,
    spawnTimeline: VESPERS_4797_SPAWN_TIMELINE,
    easeRunProgress: smoothRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      return data.role === 'rose' ? updateRose(context, data) : updateWindow(context, data);
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      const base = curve.getPointAt(0.012);
      const look = curve.getPointAt(0.07);
      camera.position.copy(base).add(new Vector3(Math.sin(modeTime * 0.43) * 0.45, Math.cos(modeTime * 0.55) * 0.24, 0));
      camera.lookAt(look);
      camera.rotateZ(Math.sin(modeTime * 0.3) * 0.012);
    },
    updateCameraEffects({ camera, runTime, runProgress }) {
      camera.fov = 62 + Math.sin(runTime * 0.37) * 0.7 + runProgress * 1.4;
      camera.updateProjectionMatrix();
    },
    scoreForHit: (_volleySize, enemy) => enemy.kind === 'rose' ? 90 : 0,
    scoreForKill(volleySize, enemy) {
      const base = enemy.kind === 'rose' ? 2600 : enemy.kind === 'bell' ? 220 : enemy.kind === 'lancet' ? 180 : 140;
      return Math.round(base * (1 + Math.max(0, volleySize - 1) * 0.16));
    },
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      return kills >= 3 ? kills * 35 + (kills === results.length ? 120 : 0) : 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 11200 && clearRate >= 0.9) return 'S';
      if (score >= 8200 && clearRate >= 0.74) return 'A';
      if (score >= 5400 && clearRate >= 0.55) return 'B';
      if (score >= 2600 && clearRate >= 0.35) return 'C';
      return 'D';
    },
    detailsForRun() {
      return ['Hull 3/3', 'The west rose window remembers every light.'];
    },
  };
}

export const VESPERS_4797_RUN_SECTIONS = [
  { name: 'Threshold', time: VESPERS_4797_MARKERS.threshold },
  { name: 'Processional', time: VESPERS_4797_MARKERS.processional },
  { name: 'Stained gallery', time: VESPERS_4797_MARKERS.gallery },
  { name: 'Swell', time: VESPERS_4797_MARKERS.swell },
  { name: 'Silence', time: VESPERS_4797_MARKERS.silence },
  { name: 'Rose approach', time: VESPERS_4797_MARKERS.roseApproach },
  { name: 'Ignition', time: VESPERS_4797_MARKERS.ignition },
];

// Keep the named exports small and stable for snapshot/debug tooling.
export const VESPERS_4797_EXPECTED_ENEMY_KINDS = ['wraith', 'lancet', 'bell', 'rose'] as const;
