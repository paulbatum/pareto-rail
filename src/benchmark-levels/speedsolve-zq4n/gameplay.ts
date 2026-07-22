import { CatmullRomCurve3, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createSpeedProfile } from '../../engine/speed-profile';
import { section, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  MOVES_PER_FACE,
  activeFaceIndex,
  armFace,
  breakSocket,
  closeSocket,
  coreAnchor,
  coreHit,
  cubeFrame,
  dropFace,
  exposeCore,
  forceSolveFace,
  isCoreDead,
  killCore,
  resetCube,
  updateCube,
  pipAnchor,
  presentFace,
  queueFullTwist,
  solvePip,
  weakAnchor,
} from './cube';
import {
  CORE_TIME,
  FACE_ARM_BAR,
  FACE_COUNT,
  FACE_FALL_BAR,
  FACE_PIP_BARS,
  FACE_PIP_LIFE,
  FACE_SEAL_BAR,
  FACE_WEAK_BAR,
  FACE_WEAK_LIFE,
  SPEEDSOLVE_BEAT,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_DURATION,
  bar,
  faceTime,
} from './timing';

// SPEEDSOLVE — sixty seconds, one opponent.
//
// The rail is a lazy orbit around a colossal puzzle cube, and the cube turns
// to keep the face it is losing squared up to the rail. Six five-bar face
// blocks, then the naked core.
//
// Everything the level places is expressed in the cube's own frame — a
// right/up/forward basis that lags the camera by a few tenths of a second — so
// waves orbit the cube rather than the world, and every enemy stays on the
// rail's side of the shell where the player can actually see it.

export const SPEEDSOLVE_PLAYER_HEALTH = 3;
export { SPEEDSOLVE_BPM, SPEEDSOLVE_DURATION, CORE_TIME, faceTime, bar } from './timing';

// ---- the arena ---------------------------------------------------------------

export const ARENA_RADIUS = 44;
const RAIL_TURNS = 1.35;
const RAIL_SAMPLES = 72;

/** The orbit on [0,1]: azimuth sweeps a turn and a third, elevation and radius breathe. */
function railPoint(s: number, out = new Vector3()) {
  const azimuth = -0.62 + s * RAIL_TURNS * Math.PI * 2;
  const elevation = 0.29 * Math.sin(s * Math.PI * 2 * 2.1 + 0.4) - 0.05;
  const radius = ARENA_RADIUS + 3.4 * Math.sin(s * Math.PI * 2 * 1.7 + 1.1);
  return out.set(
    Math.sin(azimuth) * Math.cos(elevation) * radius,
    Math.sin(elevation) * radius,
    Math.cos(azimuth) * Math.cos(elevation) * radius,
  );
}

export function createSpeedsolveRail() {
  const points: Vector3[] = [];
  for (let i = 0; i <= RAIL_SAMPLES; i += 1) points.push(railPoint(i / RAIL_SAMPLES));
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.4);
}

// The orbit crawls while a face is being solved and lurches on every face
// change, so the swing between faces is felt in the frame as well as seen on
// the cube. Keys are generated off the face clock rather than transcribed.
function speedKeys(): Array<[number, number]> {
  const keys: Array<[number, number]> = [[0, 1.9], [bar(0.9), 0.62]];
  for (let i = 1; i < FACE_COUNT; i += 1) {
    keys.push([faceTime(i) - bar(0.35), 0.62]);
    keys.push([faceTime(i) + bar(0.2), 2.75]);
    keys.push([faceTime(i) + bar(0.95), 0.62]);
  }
  keys.push([CORE_TIME - bar(0.4), 0.7]);
  keys.push([CORE_TIME + bar(0.35), 2.9]);
  keys.push([CORE_TIME + bar(1.4), 0.85]);
  keys.push([bar(34.5), 0.5]);
  keys.push([SPEEDSOLVE_DURATION, 0.34]);
  return keys;
}

const speedProfile = createSpeedProfile(speedKeys(), SPEEDSOLVE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function speedsolveRunProgress(time: number, duration = SPEEDSOLVE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Cube-frame position: x is screen-right, y is screen-up, z is toward the rail. */
export function framePoint(x: number, y: number, z: number, out = new Vector3()) {
  const frame = cubeFrame();
  return out.set(0, 0, 0)
    .addScaledVector(frame.right, x)
    .addScaledVector(frame.up, y)
    .addScaledVector(frame.forward, z);
}

// ---- looking at the cube ---------------------------------------------------------

// The runner points the camera along the rail. An orbit needs it pointed at
// what it is orbiting, so the correction is computed as a delta from the
// orientation the runner just wrote and pre-multiplied onto it — which leaves
// the player's edge-look offset, and the camera-feel shake applied after,
// completely intact. This lives in gameplay rather than visuals because it
// decides what is on screen, and therefore what is playable.
const aimHelper = new PerspectiveCamera();
const railQuaternion = new Quaternion();
const wantQuaternion = new Quaternion();
const aimPoint = new Vector3();
const aimScratch = new Vector3();

export function aimCameraAtCube(camera: PerspectiveCamera, curve: CatmullRomCurve3, u: number, runTime: number) {
  aimHelper.up.copy(camera.up);
  aimHelper.position.copy(camera.position);
  aimHelper.lookAt(curve.getPointAt(MathUtils.clamp(u + 0.025, 0, 1), aimScratch));
  railQuaternion.copy(aimHelper.quaternion);

  // The cube never sits perfectly centered: a slow lissajous keeps it drifting
  // inside the frame so the composition breathes while the orbit crawls.
  aimPoint.set(
    Math.sin(runTime * 0.31) * 2.6,
    Math.cos(runTime * 0.23) * 1.9 - 0.5,
    Math.sin(runTime * 0.17 + 1.2) * 2.2,
  );
  aimHelper.lookAt(aimPoint);
  wantQuaternion.copy(aimHelper.quaternion).multiply(railQuaternion.invert());
  camera.quaternion.premultiply(wantQuaternion);
  camera.updateMatrixWorld();
}

/** Attract: a wider, slower orbit so the START plates hang clear of the shell. */
export function attractCameraPose(camera: PerspectiveCamera, modeTime: number) {
  const radius = ARENA_RADIUS + 13 + Math.sin(modeTime * 0.23) * 2.5;
  const azimuth = -0.62 + modeTime * 0.1;
  const elevation = 0.17 + Math.sin(modeTime * 0.31) * 0.09;
  camera.position.set(
    Math.sin(azimuth) * Math.cos(elevation) * radius,
    Math.sin(elevation) * radius,
    Math.cos(azimuth) * Math.cos(elevation) * radius,
  );
  camera.lookAt(0, 0, 0);
}

// ---- spawn data ----------------------------------------------------------------

export type SpeedsolveEnemyKind = 'pip' | 'weak' | 'core' | 'tetra' | 'octa' | 'prism' | 'bolt';

export type SpeedsolveSpawnData =
  | { role: 'pip'; face: number; index: number; hue: number }
  | { role: 'weak'; face: number }
  | { role: 'core' }
  | { role: 'tetra'; radius: number; angle: number; sweep: number; z: number; life: number; hue: number }
  | { role: 'octa'; fromX: number; fromY: number; toX: number; toY: number; fromZ: number; toZ: number; life: number; hue: number }
  | { role: 'prism'; x: number; y: number; z: number; life: number; seed: number; hue: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; hue: number; impact: HostileShotImpactState };

export type SpeedsolveSpawnEntry = LockOnSpawnEntry<SpeedsolveEnemyKind, SpeedsolveSpawnData>;
export type SpeedsolveUpdate = LockOnEnemyUpdate<SpeedsolveEnemyKind, SpeedsolveSpawnData>;

// ---- wave grammar ---------------------------------------------------------------

type Orbit = { radius: number; angle: number; sweep: number; z?: number; life?: number };
type Dive = { fromX: number; fromY: number; toX: number; toY: number; fromZ?: number; toZ?: number; life?: number };
type Post = { x: number; y: number; z?: number; life?: number };

// Escort colors walk the solve palette in order so a wave never repeats the
// hue of the face it is defending.
let hueCursor = 0;
const nextHue = () => (hueCursor = (hueCursor + 1) % 6);

/** Orbiters: tetrahedra wheeling around the face on wide elliptical arcs. */
const orbiters = (time: number, stagger: number, runs: Orbit[]): SpeedsolveSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * stagger,
    kind: 'tetra',
    data: {
      role: 'tetra',
      radius: run.radius,
      angle: run.angle,
      sweep: run.sweep,
      z: run.z ?? 15.5,
      life: run.life ?? 3.1,
      hue: nextHue(),
    },
  }));

/** Divers: octahedra that cut across the frame and close on the rail as they go. */
const divers = (time: number, stagger: number, runs: Dive[]): SpeedsolveSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * stagger,
    kind: 'octa',
    data: {
      role: 'octa',
      fromX: run.fromX,
      fromY: run.fromY,
      toX: run.toX,
      toY: run.toY,
      fromZ: run.fromZ ?? 14,
      toZ: run.toZ ?? 21.5,
      life: run.life ?? 2.7,
      hue: nextHue(),
    },
  }));

/** Gunners: two-hit prisms that plant themselves in the frame and shoot back. */
const gunners = (time: number, stagger: number, posts: Post[]): SpeedsolveSpawnEntry[] =>
  posts.map((post, index) => ({
    time: time + index * stagger,
    kind: 'prism',
    hitPoints: 2,
    data: {
      role: 'prism',
      x: post.x,
      y: post.y,
      z: post.z ?? 17,
      life: post.life ?? 4.4,
      seed: index * 2.31 + time,
      hue: nextHue(),
    },
  }));

/** The five pips and the weakpoint of one face block, relative to the block start. */
function faceBlock(index: number): SpeedsolveSpawnEntry[] {
  const entries: SpeedsolveSpawnEntry[] = FACE_PIP_BARS.map((offset, pip) => ({
    time: bar(offset),
    kind: 'pip' as const,
    data: { role: 'pip' as const, face: index, index: pip, hue: index },
  }));
  entries.push({ time: bar(FACE_WEAK_BAR), kind: 'weak', hitPoints: 3, data: { role: 'weak', face: index } });
  return entries;
}

// Escort pressure, block by block. The first face teaches the sweep on two
// targets; by the last, gunners hold the frame and divers come through the
// gaps between pips.
function escortBlock(index: number): SpeedsolveSpawnEntry[] {
  switch (index) {
    case 0:
      return orbiters(bar(1.1), 0.22, [
        { radius: 15, angle: -2.5, sweep: 2.0 },
        { radius: 11, angle: 2.4, sweep: -2.2 },
      ]);
    case 1:
      return [
        ...orbiters(bar(0.9), 0.2, [
          { radius: 16, angle: 3.5, sweep: -2.4 },
          { radius: 12.5, angle: -0.4, sweep: 2.3 },
        ]),
        ...gunners(bar(2.6), 0, [{ x: -15, y: 5.5 }]),
        ...divers(bar(3.9), 0, [{ fromX: 17, fromY: -8, toX: -9, toY: 7 }]),
      ];
    case 2:
      return [
        ...divers(bar(0.85), 0.24, [
          { fromX: -18, fromY: 8.5, toX: 12, toY: -7 },
          { fromX: 18, fromY: 7.5, toX: -12, toY: -8 },
        ]),
        ...orbiters(bar(2.05), 0.16, [
          { radius: 16.5, angle: 0.5, sweep: 2.5 },
          { radius: 16.5, angle: 0.5 + Math.PI, sweep: 2.5 },
        ]),
        ...gunners(bar(3.55), 0.3, [{ x: 15.5, y: -6.5 }, { x: -15.5, y: 6.5 }]),
      ];
    case 3:
      return [
        ...orbiters(bar(0.8), 0.18, [
          { radius: 17, angle: -1.1, sweep: 2.6 },
          { radius: 9.5, angle: 1.9, sweep: -2.6 },
        ]),
        ...divers(bar(2.1), 0.26, [
          { fromX: -19, fromY: -3, toX: 10, toY: 9 },
          { fromX: 19, fromY: 3, toX: -10, toY: -9 },
        ]),
        ...gunners(bar(3.6), 0, [{ x: 0, y: 9.5 }]),
      ];
    case 4:
      return [
        ...orbiters(bar(0.75), 0.14, [
          { radius: 17.5, angle: 0, sweep: 2.2 },
          { radius: 17.5, angle: 2.09, sweep: 2.2 },
          { radius: 17.5, angle: 4.19, sweep: 2.2 },
        ]),
        ...divers(bar(2.15), 0.22, [
          { fromX: -19, fromY: 9, toX: 13, toY: -8, life: 2.4 },
          { fromX: 19, fromY: -9, toX: -13, toY: 8, life: 2.4 },
        ]),
        ...gunners(bar(3.5), 0.28, [{ x: -14, y: -7 }, { x: 14, y: 7 }]),
      ];
    default:
      return [
        ...divers(bar(0.7), 0.2, [
          { fromX: -20, fromY: 4, toX: 11, toY: -9, life: 2.3 },
          { fromX: 20, fromY: -4, toX: -11, toY: 9, life: 2.3 },
        ]),
        ...orbiters(bar(1.9), 0.14, [
          { radius: 18, angle: 1.2, sweep: -2.7 },
          { radius: 13, angle: -1.2, sweep: 2.7 },
          { radius: 8, angle: 2.8, sweep: -2.7 },
        ]),
        ...gunners(bar(3.45), 0.26, [{ x: -15, y: 6 }, { x: 15, y: -6 }]),
      ];
  }
}

function buildTimeline(): SpeedsolveSpawnEntry[] {
  const entries: SpeedsolveSpawnEntry[] = [];
  for (let i = 0; i < FACE_COUNT; i += 1) {
    entries.push(...section(faceTime(i), faceBlock(i), escortBlock(i)));
  }
  // The core: exposed on bar 31 and never leaves. Three armor stages, and its
  // gimbal cage shuts between salvos, so the finish is four windows long.
  entries.push({ time: CORE_TIME + bar(0.5), kind: 'core', hitStages: [3, 4, 4], data: { role: 'core' } });
  // Last escorts come in close and wide, outside the unfolded shell.
  entries.push(...section(CORE_TIME,
    divers(bar(1.1), 0.24, [
      { fromX: -14, fromY: 7, toX: 9, toY: -5, fromZ: 20, toZ: 25, life: 2.1 },
      { fromX: 14, fromY: -7, toX: -9, toY: 5, fromZ: 20, toZ: 25, life: 2.1 },
    ]),
    divers(bar(2.9), 0.24, [
      { fromX: -13, fromY: -6, toX: 10, toY: 6, fromZ: 20.5, toZ: 25, life: 2.1 },
      { fromX: 13, fromY: 6, toX: -10, toY: -6, fromZ: 20.5, toZ: 25, life: 2.1 },
    ]),
  ));
  return sortTimeline(entries);
}

// ---- tuning ----------------------------------------------------------------------

const KILL_SCORE: Record<SpeedsolveEnemyKind, number> = {
  pip: 130,
  weak: 460,
  core: 3200,
  tetra: 100,
  octa: 140,
  prism: 210,
  bolt: 40,
};

const CORE_TOTAL_HP = 11;
const BOLT_MAX_AGE = 9;
/** The core's gimbal cage: open for most of every two bars, then shut. */
const CAGE_CYCLE = bar(2);
const CAGE_OPEN = 0.78;

export function coreCageOpen(runTime: number) {
  if (runTime < CORE_TIME) return false;
  return ((runTime - CORE_TIME) / CAGE_CYCLE) % 1 < CAGE_OPEN;
}

export type SpeedsolveLevel = LockOnRunnerLevel<SpeedsolveEnemyKind, SpeedsolveSpawnData> & {
  /** Advances the face clock. Driven once per frame from the camera hook. */
  tick(runTime: number): void;
  cageOpen(): boolean;
};

// ---- level ------------------------------------------------------------------------

export function createSpeedsolveGameplay(bus: EventBus): SpeedsolveLevel {
  const timeline = buildTimeline();
  const interceptions = new Set<number>();
  const scratch = new Vector3();

  let scheduleCursor = 0;
  let movesSolved = 0;
  let weakBroken = 0;
  let hitsTaken = 0;
  let boltsShot = 0;
  let coreDown = false;
  let cageOpen = true;

  // The face clock. Everything structural — the quarter turn, the scramble,
  // the seal, the drop — is a timed cue, so a run's shape never depends on how
  // well the player is doing; only how much of it they get credit for does.
  const schedule: Array<{ time: number; run: () => void }> = [];
  for (let i = 0; i < FACE_COUNT; i += 1) {
    const start = faceTime(i);
    if (i > 0) schedule.push({ time: start, run: () => presentFace(i, SPEEDSOLVE_BEAT) });
    schedule.push({ time: start + bar(FACE_ARM_BAR), run: () => armFace(i) });
    schedule.push({
      time: start + bar(FACE_SEAL_BAR),
      run: () => {
        forceSolveFace();
        queueFullTwist(i % 2 === 0 ? 1 : -1, SPEEDSOLVE_BEAT);
      },
    });
    schedule.push({
      time: start + bar(FACE_FALL_BAR),
      run: () => {
        dropFace();
        bus.emit('bossphase', { phase: 'exposed' });
      },
    });
  }
  schedule.push({
    time: CORE_TIME,
    run: () => {
      exposeCore();
      bus.emit('bossphase', { phase: 'summoned' });
    },
  });
  schedule.sort((a, b) => a.time - b.time);

  bus.on('runstart', () => {
    // Gameplay owns the cube model, so gameplay rewinds it. Visuals cannot: the
    // headless simulator and the floor gate never load the visual layer, and a
    // REPLAY would otherwise start on a half-eaten machine.
    resetCube();
    scheduleCursor = 0;
    movesSolved = 0;
    weakBroken = 0;
    hitsTaken = 0;
    boltsShot = 0;
    coreDown = false;
    cageOpen = true;
    hueCursor = 0;
    interceptions.clear();
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => interceptions.delete(enemyId));
  bus.on('miss', ({ enemyId }) => interceptions.delete(enemyId));

  function tick(runTime: number) {
    while (scheduleCursor < schedule.length && runTime >= schedule[scheduleCursor].time) {
      schedule[scheduleCursor].run();
      scheduleCursor += 1;
    }
    cageOpen = !isCoreDead() && coreCageOpen(runTime);
  }

  function fireBolt(context: SpeedsolveUpdate, from: Vector3, hue: number) {
    const velocity = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity, lastAge: 0, hue, impact: {} },
    });
  }

  // ---- motion -----------------------------------------------------------------

  function updatePip(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'pip' }>) {
    const { enemy, age, camera } = context;
    if (data.face !== activeFaceIndex() || age > FACE_PIP_LIFE) return true;
    const anchor = pipAnchor(data.index, scratch);
    if (!anchor) return true;
    enemy.mesh.position.copy(anchor);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 1.05);
    // Pips arrive with a hard mechanical pop and idle with a shallow breath.
    const pop = 1 - (1 - Math.min(1, age / 0.16)) ** 3;
    enemy.mesh.scale.setScalar(pop * (1 + Math.sin(age * 9.2) * 0.045));
    enemy.mesh.userData.expiry = MathUtils.clamp(age / FACE_PIP_LIFE, 0, 1);
    return false;
  }

  function updateWeak(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'weak' }>) {
    const { enemy, age, camera } = context;
    if (data.face !== activeFaceIndex()) return true;
    if (age > FACE_WEAK_LIFE) {
      closeSocket();
      return true;
    }
    weakAnchor(age, enemy.mesh.position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(age * 2.6);
    enemy.mesh.scale.setScalar(1 - (1 - Math.min(1, age / 0.3)) ** 3);
    enemy.mesh.userData.expiry = MathUtils.clamp(age / FACE_WEAK_LIFE, 0, 1);
    return false;
  }

  function updateCore(context: SpeedsolveUpdate) {
    const { enemy, age, runTime, camera } = context;
    coreAnchor(enemy.mesh.position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(runTime * 1.9);
    // Spins up out of the opened shell over a bar.
    enemy.mesh.scale.setScalar(1 - (1 - Math.min(1, age / 1.7)) ** 3);
    enemy.entry.lockable = cageOpen;
    enemy.mesh.userData.caged = !cageOpen;
    enemy.mesh.userData.stage = enemy.hitStageIndex;
    return false;
  }

  function updateTetra(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'tetra' }>) {
    const { enemy, age } = context;
    const t = age / data.life;
    if (t > 1) return true;
    // A wide elliptical wheel around the face, stretched to the frame's aspect.
    const angle = data.angle + data.sweep * (t * t * (3 - 2 * t));
    framePoint(
      Math.cos(angle) * data.radius * 1.25,
      Math.sin(angle) * data.radius * 0.92,
      data.z + Math.sin(t * Math.PI) * 3.4,
      enemy.mesh.position,
    );
    enemy.mesh.rotation.x += 0.05;
    enemy.mesh.rotation.y += 0.07;
    enemy.mesh.scale.setScalar(1 - (1 - Math.min(1, age / 0.22)) ** 3);
    return false;
  }

  function updateOcta(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'octa' }>) {
    const { enemy, age, camera } = context;
    const t = age / data.life;
    if (t > 1) return true;
    const eased = t * t * (3 - 2 * t);
    framePoint(
      MathUtils.lerp(data.fromX, data.toX, eased),
      MathUtils.lerp(data.fromY, data.toY, eased) + Math.sin(t * Math.PI) * 4.8,
      MathUtils.lerp(data.fromZ, data.toZ, t ** 1.7),
      enemy.mesh.position,
    );
    // Divers keep one axis square to the player and spin about it, so the
    // silhouette never flattens out on the way past.
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 2.3);
    enemy.mesh.scale.setScalar(1 - (1 - Math.min(1, age / 0.22)) ** 3);
    return false;
  }

  function updatePrism(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'prism' }>) {
    const { enemy, age, camera } = context;
    if (age > data.life) return true;
    const state = context.enemyState(() => ({ fireAt: 0.7 + (data.seed % 0.4) }));
    framePoint(
      data.x + Math.sin(age * 1.5 + data.seed) * 1.6,
      data.y + Math.cos(age * 1.9 + data.seed) * 1.2,
      data.z,
      enemy.mesh.position,
    );
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 2.4 + data.seed) * 0.4);

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.55 ? MathUtils.clamp(1 - untilShot / 0.55, 0, 1) : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 1.6;
      fireBolt(context, enemy.mesh.position, data.hue);
    }
    enemy.mesh.scale.setScalar(1 - (1 - Math.min(1, age / 0.24)) ** 3);
    return false;
  }

  function updateBolt(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'bolt' }>) {
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
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 6.5);
    if (impact.phase === 'braking') {
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 7,
      maxSpeed: 15,
      accel: 3.4,
      turnRate: 2.6,
    });
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- definition -----------------------------------------------------------------

  return {
    duration: SPEEDSOLVE_DURATION,
    bpm: SPEEDSOLVE_BPM,
    playerHealth: SPEEDSOLVE_PLAYER_HEALTH,
    createRail: createSpeedsolveRail,
    spawnTimeline: timeline,
    easeRunProgress: speedsolveRunProgress,
    startWord: 'SOLVE',
    replayWord: 'AGAIN',
    // The cube is the percussion section: 144 BPM wants a volley's impacts
    // inside the bar, not strung across it, so the coarsest grid is a half note.
    timing: { shotDelay: { maxGridSeconds: 0.84 } },
    tick,
    cageOpen: () => cageOpen,
    updateAttractCamera({ camera, modeTime, dt }) {
      attractCameraPose(camera, modeTime);
      updateCube(dt, camera, false);
    },
    // The one hook the runner calls exactly once per running frame, before any
    // enemy moves: the face clock, the cube's own animation, and the look-at.
    updateCameraEffects({ camera, curve, runTime, runProgress, dt }) {
      tick(runTime);
      updateCube(dt, camera, true);
      aimCameraAtCube(camera, curve, runProgress, runTime);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'pip':
          return updatePip(context, data);
        case 'weak':
          return updateWeak(context, data);
        case 'core':
          return updateCore(context);
        case 'tetra':
          return updateTetra(context, data);
        case 'octa':
          return updateOcta(context, data);
        case 'prism':
          return updatePrism(context, data);
        case 'bolt':
          return updateBolt(context, data);
      }
    },
    /**
     * The cage race. `lockable` stops new locks the moment the gimbal rings
     * shut; this refuses the stale ones already held, so a closed cage always
     * means a closed cage. Everything else in the volley still fires.
     */
    validateRelease(enemies) {
      if (cageOpen) return true;
      const allowed = enemies.filter((enemy) => enemy.kind !== 'core');
      return allowed.length === enemies.length ? true : allowed;
    },
    scoreForKill(volleySize, enemy) {
      const data = enemy.entry.data;
      if (data.role === 'pip') {
        solvePip(data.index, SPEEDSOLVE_BEAT);
        movesSolved += 1;
      } else if (data.role === 'weak') {
        breakSocket();
        weakBroken += 1;
      } else if (data.role === 'core') {
        coreDown = true;
        killCore();
        bus.emit('bossphase', { phase: 'destroyed' });
      } else if (data.role === 'bolt') {
        boltsShot += 1;
      }
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.2));
    },
    scoreForHit(_volleySize, enemy) {
      if (enemy.entry.data.role === 'core') coreHit(1 - enemy.hitPointsRemaining / CORE_TOTAL_HP);
      return 70;
    },
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 640 : results.length * 90;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (coreDown && score >= 17500 && clearRate >= 0.93) return 'S';
      if (coreDown && score >= 13000 && clearRate >= 0.8) return 'A';
      if (score >= 8000 && clearRate >= 0.55) return 'B';
      if (score >= 3800 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [
        `Solve moves ${movesSolved}/${FACE_COUNT * MOVES_PER_FACE}`,
        `Faces cracked ${weakBroken}/${FACE_COUNT}`,
      ];
      if (boltsShot > 0) lines.push(`${boltsShot} shot${boltsShot === 1 ? '' : 's'} knocked down`);
      lines.push(coreDown ? 'Core destroyed' : 'Core intact');
      lines.push(`Hull ${Math.max(0, SPEEDSOLVE_PLAYER_HEALTH - hitsTaken)}/${SPEEDSOLVE_PLAYER_HEALTH}`);
      return lines;
    },
  };
}
