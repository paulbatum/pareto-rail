import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { LockOnEnemyUpdate } from '../../engine/lock-on-runner';
import { mulberry32 } from '../../engine/rng';
import type { EventBus } from '../../events';
import {
  FACE_NORMALS,
  NO_COLOR,
  applyMove,
  createSolvedState,
  cubieCoords,
  faceCenterCubie,
  faceCubies,
  faceLayerMove,
  moveCubie,
  paintFaceSolved,
  scrambleState,
  slotIndex,
  type LayerMove,
} from './cube-state';
import { FACE_ORDER } from './orbit';
import { snapClock, type SnapKind } from './snap-clock';
import {
  BEAT_SECONDS,
  CORE_SPAWN_TIME,
  EARLIEST_END_TIME,
  FACE_COUNT,
  FINALE_TIME,
  SS_DURATION,
  SS_TIME,
  faceAt,
  faceSwingStart,
  faceWindowStart,
} from './timing';

// THE CUBE FIGHT. One boss, six faces, one core. This module owns the rules:
// which stickers are wrong, when a layer snaps, when a face falls, when the
// hub underneath is exposed, when the shell blows and the core is bare. It is
// pure state plus a queue of quantized snaps; gameplay.ts feeds it enemy
// updates and visuals/index.ts reads it every frame.

export const CUBIE_PITCH = 6;
export const CUBIE_SIZE = 5.35;
export const CUBE_HALF = CUBIE_PITCH + CUBIE_SIZE / 2;
export const STICKER_INSET = 0.28;
/** How far in front of the sticker plate a sticker target hovers. */
export const STICKER_TARGET_LIFT = 0.55;
export const HUB_RECESS = 1.1;
export const CORE_RADIUS = 3;

/** Wrong stickers armed per face window. Centres are never wrong. */
export const STICKER_TARGETS_PER_FACE = [4, 5, 5, 6, 6, 6] as const;
export const HUB_HIT_POINTS = 3;
export const CORE_CAGE_HITS = 4;
export const CORE_HEART_HITS = 6;

const SNAP_ANIMATION_SECONDS = 0.19;
const SNAP_MIN_DELAY = 0.17;
const FALL_MIN_DELAY = 0.24;

export type SnapAnimation = {
  move: LayerMove;
  kind: SnapKind;
  face: number;
  start: number;
  land: number;
};

type ActiveSnap = SnapAnimation & { pending: PendingSnap };

export type CubeVisualEvent =
  | { type: 'window'; window: number; face: number }
  | { type: 'swing'; window: number }
  | { type: 'snap'; move: LayerMove; face: number; kind: 'arm' | 'solve' | 'idle'; cubie: number }
  | { type: 'lit'; face: number; cubie: number }
  | { type: 'fall'; face: number }
  | { type: 'hub'; face: number; phase: 'spawn' | 'kill' | 'miss' }
  | { type: 'shell' }
  | { type: 'core'; phase: 'spawn' | 'armor' | 'cage' | 'kill' | 'escape' };

type PendingSnap = {
  kind: SnapKind;
  face: number;
  cubie: number;
  chain: number;
  onLand: (moved: number) => void;
};

type FaceRuntime = {
  face: number;
  window: number;
  targetCount: number;
  wrongOrder: number[];
  colorOrder: number[];
  spawned: number;
  killed: number;
  stickerCubie: Map<number, number>;
  litCubies: Set<number>;
  fallen: boolean;
  fallQueued: boolean;
  fallTime: number;
  hubId: number;
  hubSpawned: boolean;
  hubKilled: boolean;
  hubKillTime: number;
  swung: boolean;
};

export type StickerSpawnData = { role: 'sticker'; window: number; index: number };
export type HubSpawnData = { role: 'hub'; face: number; window: number };
export type CoreSpawnData = { role: 'core' };
export type MechanismSpawnData = { role: 'mechanism' };

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const scratchAxis = new Vector3();
const scratchQuat = new Quaternion();
const scratchMatrix = new Matrix4();
const scratchRight = new Vector3();
const scratchUp = new Vector3();

export function createCubeFight(bus: EventBus) {
  const rng = mulberry32(0x5eed);
  let state: Uint8Array = createSolvedState();
  const kindById = new Map<number, string>();
  const faces: FaceRuntime[] = [];
  const events: CubeVisualEvent[] = [];
  const queue: PendingSnap[] = [];
  let animation: ActiveSnap | null = null;
  let runTime = 0;
  let running = false;
  let lastWindow = -1;
  let idleDir: 1 | -1 = 1;
  const ejectedCenters = new Array<boolean>(6).fill(false);
  const fallen = new Array<boolean>(6).fill(false);
  const core = {
    id: -1,
    spawned: false,
    exposed: false,
    killed: false,
    killTime: -1,
    armor: 0,
    stageIndex: 0,
    hitsTaken: 0,
    totalHits: 0,
    endAt: Infinity,
    escaped: false,
  };
  let shellOpen = false;
  let hitsTaken = 0;

  function resetFaces() {
    faces.length = 0;
    for (let window = 0; window < FACE_COUNT; window += 1) {
      const face = FACE_ORDER[window];
      const wrong = faceCubies(face).filter((_cubie, index) => index !== 4);
      shuffle(wrong, rng);
      const colors = [0, 1, 2, 3, 4, 5].filter((color) => color !== face);
      shuffle(colors, rng);
      faces.push({
        face,
        window,
        targetCount: STICKER_TARGETS_PER_FACE[window],
        wrongOrder: wrong,
        colorOrder: colors,
        spawned: 0,
        killed: 0,
        stickerCubie: new Map(),
        litCubies: new Set(),
        fallen: false,
        fallQueued: false,
        fallTime: -1,
        hubId: -1,
        hubSpawned: false,
        hubKilled: false,
        hubKillTime: -1,
        swung: false,
      });
    }
  }

  function freshScramble() {
    let next = scrambleState(createSolvedState(), 26, rng);
    // The first face arrives solved; arming scrambles it in front of the player.
    next = paintFaceSolved(next, FACE_ORDER[0]);
    return next;
  }

  function reset() {
    state = freshScramble();
    resetFaces();
    kindById.clear();
    queue.length = 0;
    animation = null;
    events.length = 0;
    runTime = 0;
    lastWindow = -1;
    ejectedCenters.fill(false);
    fallen.fill(false);
    shellOpen = false;
    hitsTaken = 0;
    Object.assign(core, {
      id: -1,
      spawned: false,
      exposed: false,
      killed: false,
      killTime: -1,
      armor: 0,
      stageIndex: 0,
      hitsTaken: 0,
      totalHits: 0,
      endAt: Infinity,
      escaped: false,
    });
    snapClock.reset();
  }

  reset();

  bus.on('runstart', () => {
    reset();
    running = true;
  });
  bus.on('runend', () => {
    running = false;
    if (core.spawned && !core.killed) {
      core.escaped = true;
      events.push({ type: 'core', phase: 'escape' });
    }
  });
  bus.on('beat', ({ beatNumber }) => {
    snapClock.observeBeat(runTime, beatNumber, BEAT_SECONDS);
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    kindById.set(enemyId, kind);
    if (kind === 'core') {
      core.id = enemyId;
      core.spawned = true;
      events.push({ type: 'core', phase: 'spawn' });
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  bus.on('kill', ({ enemyId }) => {
    const kind = kindById.get(enemyId);
    kindById.delete(enemyId);
    if (kind === 'sticker') onStickerKilled(enemyId);
    else if (kind === 'hub') onHubKilled(enemyId);
    else if (kind === 'core' && enemyId === core.id && !core.killed) {
      core.killed = true;
      core.killTime = runTime;
      const twoBarsOn = runTime + SS_TIME.bar(2);
      core.endAt = Math.max(EARLIEST_END_TIME, Math.ceil(twoBarsOn / SS_TIME.barSeconds - 1e-6) * SS_TIME.barSeconds);
      events.push({ type: 'core', phase: 'kill' });
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    const kind = kindById.get(enemyId);
    kindById.delete(enemyId);
    if (kind === 'sticker') {
      for (const face of faces) face.stickerCubie.delete(enemyId);
    } else if (kind === 'hub') {
      const face = faces.find((candidate) => candidate.hubId === enemyId);
      if (face && !face.hubKilled) events.push({ type: 'hub', face: face.face, phase: 'miss' });
    }
  });

  bus.on('stage', ({ enemyId, stageIndex, hitStageCount }) => {
    if (enemyId !== core.id) return;
    core.stageIndex = stageIndex;
    // The last stage is the naked heart; everything before it is armour or cage.
    const cageStage = hitStageCount - 2;
    if (stageIndex === cageStage) events.push({ type: 'core', phase: 'armor' });
    if (stageIndex === hitStageCount - 1) {
      core.exposed = true;
      events.push({ type: 'core', phase: 'cage' });
      bus.emit('bossphase', { phase: 'exposed' });
    }
  });

  bus.on('hit', ({ enemyId, lethal }) => {
    if (enemyId === core.id && !lethal) core.hitsTaken += 1;
  });

  // ---- snaps ---------------------------------------------------------------

  function enqueue(snap: PendingSnap) {
    queue.push(snap);
  }

  function beginNextSnap() {
    if (animation || queue.length === 0) return;
    const pending = queue.shift()!;
    const isFall = pending.kind === 'fall';
    const delay = snapClock.schedule(runTime, {
      kind: pending.kind,
      face: pending.face,
      chain: pending.chain,
      minDelay: isFall ? FALL_MIN_DELAY : SNAP_MIN_DELAY,
      gridSixteenths: isFall ? 4 : 2,
    });
    const land = runTime + Math.max(0.05, delay);
    const faceRuntime = faces.find((candidate) => candidate.face === pending.face);
    const dir: 1 | -1 = faceRuntime ? ((faceRuntime.spawned + faceRuntime.killed) % 2 === 0 ? 1 : -1) : idleDir;
    animation = {
      move: faceLayerMove(pending.face, dir),
      kind: pending.kind,
      face: pending.face,
      start: Math.max(runTime, land - SNAP_ANIMATION_SECONDS),
      land,
      pending,
    };
  }

  function landSnap() {
    if (!animation) return;
    const { move, pending } = animation;
    const isFall = animation.kind === 'fall';
    if (!isFall) {
      state = applyMove(state, move);
      for (const face of faces) {
        const remapped = new Map<number, number>();
        for (const [enemyId, cubie] of face.stickerCubie) remapped.set(enemyId, moveCubie(cubie, move));
        face.stickerCubie = remapped;
        const lit = new Set<number>();
        for (const cubie of face.litCubies) lit.add(moveCubie(cubie, move));
        face.litCubies = lit;
      }
    }
    const moved = isFall ? pending.cubie : moveCubie(pending.cubie, move);
    animation = null;
    pending.onLand(moved);
  }

  function processQueue() {
    if (animation && runTime >= animation.land) landSnap();
    if (!animation) beginNextSnap();
  }

  // ---- faces -----------------------------------------------------------------

  function faceForWindow(window: number) {
    return faces[Math.min(FACE_COUNT - 1, Math.max(0, window))];
  }

  function armSticker(enemyId: number, faceRuntime: FaceRuntime, index: number) {
    const cubie = faceRuntime.wrongOrder[index % faceRuntime.wrongOrder.length];
    const color = faceRuntime.colorOrder[index % faceRuntime.colorOrder.length];
    faceRuntime.stickerCubie.set(enemyId, cubie);
    faceRuntime.spawned += 1;
    enqueue({
      kind: 'arm',
      face: faceRuntime.face,
      cubie,
      chain: index,
      onLand(moved) {
        // Only recolour if the target is still alive; a lightning kill before
        // the arming snap lands simply leaves the sticker correct.
        if (!faceRuntime.stickerCubie.has(enemyId)) return;
        state[slotIndex(moved, faceRuntime.face)] = color;
        faceRuntime.litCubies.add(moved);
        events.push({ type: 'snap', move: faceLayerMove(faceRuntime.face, 1), face: faceRuntime.face, kind: 'arm', cubie: moved });
        events.push({ type: 'lit', face: faceRuntime.face, cubie: moved });
      },
    });
  }

  function onStickerKilled(enemyId: number) {
    const faceRuntime = faces.find((candidate) => candidate.stickerCubie.has(enemyId));
    if (!faceRuntime) return;
    const cubie = faceRuntime.stickerCubie.get(enemyId)!;
    faceRuntime.stickerCubie.delete(enemyId);
    faceRuntime.killed += 1;
    enqueue({
      kind: 'solve',
      face: faceRuntime.face,
      cubie,
      chain: faceRuntime.killed,
      onLand(moved) {
        state[slotIndex(moved, faceRuntime.face)] = faceRuntime.face;
        faceRuntime.litCubies.delete(moved);
        events.push({ type: 'snap', move: faceLayerMove(faceRuntime.face, 1), face: faceRuntime.face, kind: 'solve', cubie: moved });
        if (faceRuntime.killed >= faceRuntime.targetCount && !faceRuntime.fallQueued) queueFall(faceRuntime);
      },
    });
  }

  function queueFall(faceRuntime: FaceRuntime) {
    faceRuntime.fallQueued = true;
    enqueue({
      kind: 'fall',
      face: faceRuntime.face,
      cubie: faceCenterCubie(faceRuntime.face),
      chain: 0,
      onLand() {
        faceRuntime.fallen = true;
        faceRuntime.fallTime = runTime;
        fallen[faceRuntime.face] = true;
        ejectedCenters[faceRuntime.face] = true;
        state = paintFaceSolved(state, faceRuntime.face);
        events.push({ type: 'fall', face: faceRuntime.face });
        pendingHubFace = faceRuntime;
      },
    });
  }

  let pendingHubFace: FaceRuntime | null = null;

  function onHubKilled(enemyId: number) {
    const faceRuntime = faces.find((candidate) => candidate.hubId === enemyId);
    if (!faceRuntime || faceRuntime.hubKilled) return;
    faceRuntime.hubKilled = true;
    faceRuntime.hubKillTime = runTime;
    events.push({ type: 'hub', face: faceRuntime.face, phase: 'kill' });
  }

  // ---- enemy updates (called from gameplay.updateEnemy) ---------------------

  type Context = LockOnEnemyUpdate<string, unknown>;

  function updateMechanism(context: Context) {
    const { enemy, camera } = context;
    runTime = context.runTime;
    // The mechanism is the fight's conductor: a non-target parked behind the
    // camera so it never enters the lock frustum.
    const forward = camera.getWorldDirection(new Vector3());
    enemy.mesh.position.copy(camera.position).addScaledVector(forward, -8);

    const window = faceAt(runTime);
    if (window !== lastWindow) {
      lastWindow = window;
      if (window < FACE_COUNT) events.push({ type: 'window', window, face: FACE_ORDER[window] });
    }
    if (window < FACE_COUNT) {
      const current = faceForWindow(window);
      if (!current.swung && runTime >= faceSwingStart(window)) {
        current.swung = true;
        events.push({ type: 'swing', window });
        // The next face arrives looking solved; arming scrambles it live.
        if (window + 1 < FACE_COUNT) state = paintFaceSolved(state, FACE_ORDER[window + 1]);
      }
    }

    if (!shellOpen && runTime >= FINALE_TIME) {
      shellOpen = true;
      for (let face = 0; face < 6; face += 1) ejectedCenters[face] = true;
      events.push({ type: 'shell' });
    }
    if (shellOpen && !core.spawned && runTime >= CORE_SPAWN_TIME) {
      core.armor = fallen.filter((value) => !value).length;
      const stages = core.armor > 0 ? [core.armor, CORE_CAGE_HITS, CORE_HEART_HITS] : [CORE_CAGE_HITS, CORE_HEART_HITS];
      core.totalHits = stages.reduce((sum, value) => sum + value, 0);
      core.spawned = true;
      context.spawnEnemy({ time: runTime, kind: 'core', hitStages: stages, data: { role: 'core' } as CoreSpawnData });
    }

    processQueue();

    if (pendingHubFace) {
      const faceRuntime = pendingHubFace;
      pendingHubFace = null;
      const swingStart = faceSwingStart(faceRuntime.window);
      if (runTime < swingStart - BEAT_SECONDS * 0.75) {
        faceRuntime.hubSpawned = true;
        faceRuntime.hubId = context.spawnEnemy({
          time: runTime,
          kind: 'hub',
          hitPoints: HUB_HIT_POINTS,
          data: { role: 'hub', face: faceRuntime.face, window: faceRuntime.window } as HubSpawnData,
        });
        events.push({ type: 'hub', face: faceRuntime.face, phase: 'spawn' });
      }
    }

    if (core.killed && runTime >= core.endAt) {
      core.endAt = Infinity;
      bus.emit('runendrequest', undefined);
    }
    return false;
  }

  function updateSticker(context: Context, data: StickerSpawnData) {
    const { enemy, camera } = context;
    const faceRuntime = faceForWindow(data.window);
    if (!faceRuntime.stickerCubie.has(enemy.id)) {
      if (faceRuntime.spawned >= faceRuntime.targetCount) return true;
      armSticker(enemy.id, faceRuntime, data.index);
    }
    const cubie = faceRuntime.stickerCubie.get(enemy.id)!;
    stickerWorldPose(cubie, faceRuntime.face, STICKER_TARGET_LIFT, enemy.mesh.position, enemy.mesh.quaternion);
    enemy.mesh.userData.lit = faceRuntime.litCubies.has(cubie);
    enemy.mesh.userData.faceColor = faceRuntime.face;
    enemy.mesh.userData.wrongColor = state[slotIndex(cubie, faceRuntime.face)];
    void camera;
    // The window is over once the rail swings; anything left is missed.
    return context.runTime >= faceSwingStart(data.window);
  }

  function updateHub(context: Context, data: HubSpawnData) {
    const { enemy } = context;
    const normal = FACE_NORMALS[data.face];
    enemy.mesh.position.set(normal[0], normal[1], normal[2]).multiplyScalar(CUBE_HALF - HUB_RECESS);
    orientToNormal(enemy.mesh.quaternion, data.face, 0);
    return context.runTime >= faceSwingStart(data.window);
  }

  function updateCore(context: Context) {
    const { enemy } = context;
    enemy.mesh.position.set(0, 0, 0);
    enemy.mesh.userData.exposed = core.exposed;
    enemy.mesh.userData.stageIndex = enemy.hitStageIndex;
    enemy.mesh.userData.hitsTaken = core.hitsTaken;
    return false;
  }

  // ---- geometry helpers -----------------------------------------------------

  /** Current rotation angle of a layer under animation, in radians. */
  function layerAngle(move: LayerMove | null, cubie: number) {
    if (!animation || !move) return 0;
    const p = cubieCoords(cubie);
    if (p[animation.move.axis] !== animation.move.depth) return 0;
    const t = MathUtils.clamp((runTime - animation.start) / Math.max(0.01, animation.land - animation.start), 0, 1);
    const eased = t * t * (3 - 2 * t);
    return animation.move.dir * (Math.PI / 2) * eased;
  }

  function cubieWorldPosition(cubie: number, out: Vector3) {
    const p = cubieCoords(cubie);
    out.set(p[0], p[1], p[2]).multiplyScalar(CUBIE_PITCH);
    const angle = layerAngle(animation?.move ?? null, cubie);
    if (angle !== 0 && animation) {
      scratchAxis.set(0, 0, 0).setComponent(animation.move.axis, 1);
      out.applyAxisAngle(scratchAxis, angle);
    }
    return out;
  }

  function orientToNormal(out: Quaternion, face: number, spin: number) {
    const n = FACE_NORMALS[face];
    scratchAxis.set(n[0], n[1], n[2]);
    const up = Math.abs(scratchAxis.y) > 0.9 ? FORWARD : UP;
    scratchRight.crossVectors(up, scratchAxis).normalize();
    scratchUp.crossVectors(scratchAxis, scratchRight);
    out.setFromRotationMatrix(scratchMatrix.makeBasis(scratchRight, scratchUp, scratchAxis));
    if (spin !== 0) out.multiply(scratchQuat.setFromAxisAngle(FORWARD, spin));
    return out;
  }

  function stickerWorldPose(cubie: number, face: number, lift: number, outPosition: Vector3, outQuaternion?: Quaternion) {
    cubieWorldPosition(cubie, outPosition);
    const n = FACE_NORMALS[face];
    outPosition.addScaledVector(new Vector3(n[0], n[1], n[2]), CUBIE_SIZE / 2 + lift);
    if (outQuaternion) {
      const angle = layerAngle(animation?.move ?? null, cubie);
      orientToNormal(outQuaternion, face, angle);
    }
    return outPosition;
  }

  // ---- idle (attract) -------------------------------------------------------

  /** Attract-mode snap: visuals animate it, the state permutes on land. */
  function applyIdleMove(move: LayerMove) {
    state = applyMove(state, move);
    idleDir = idleDir === 1 ? -1 : 1;
  }

  // ---- summaries -------------------------------------------------------------

  function facesSolved() {
    return faces.filter((face) => face.hubKilled).length;
  }

  function facesFallen() {
    return faces.filter((face) => face.fallen).length;
  }

  function splits() {
    return faces.filter((face) => face.hubKilled).map((face) => face.hubKillTime - faceWindowStart(face.window));
  }

  function hubBonusSeconds(hubId: number) {
    const face = faces.find((candidate) => candidate.hubId === hubId);
    if (!face) return 0;
    return Math.max(0, faceSwingStart(face.window) - runTime);
  }

  function drainEvents() {
    const drained = events.splice(0, events.length);
    return drained;
  }

  return {
    get state() {
      return state;
    },
    get animation() {
      return animation;
    },
    get runTime() {
      return runTime;
    },
    get running() {
      return running;
    },
    get shellOpen() {
      return shellOpen;
    },
    get core() {
      return core;
    },
    get hitsTaken() {
      return hitsTaken;
    },
    fallen,
    ejectedCenters,
    faces,
    duration: SS_DURATION,
    kindOf: (enemyId: number) => kindById.get(enemyId),
    activeWindow: () => (running ? faceAt(runTime) : -1),
    activeFace: () => (running && faceAt(runTime) < FACE_COUNT ? FACE_ORDER[faceAt(runTime)] : -1),
    litCubies: (face: number) => faces.find((candidate) => candidate.face === face)?.litCubies ?? new Set<number>(),
    stickerCubieOf: (enemyId: number) => {
      for (const face of faces) {
        const cubie = face.stickerCubie.get(enemyId);
        if (cubie !== undefined) return cubie;
      }
      return undefined;
    },
    updateMechanism,
    updateSticker,
    updateHub,
    updateCore,
    cubieWorldPosition,
    stickerWorldPose,
    layerAngle,
    applyIdleMove,
    facesSolved,
    facesFallen,
    splits,
    hubBonusSeconds,
    drainEvents,
    faceColorAt: (cubie: number, face: number) => state[slotIndex(cubie, face)],
    NO_COLOR,
  };
}

export type CubeFight = ReturnType<typeof createCubeFight>;

function shuffle<T>(items: T[], rng: () => number) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

