import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { CAP_SIZE, type SolveCube } from '../cube';
import { createCubeView, type CubeView } from './cube-view';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstCubies,
  confettiStorm,
  createEffects,
  disposeEffects,
  resetEffects,
  spawnRing,
  updateEffects,
} from './effects';
import {
  createBolt,
  createCore,
  createFacetMarker,
  createOcta,
  createPrism,
  createProjectile,
  createSolveReticle,
  createTetra,
  createWeakpoint,
} from './enemies';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { GRAPHITE, HOT_WHITE, MACHINE_DARK, SOLVE_COLORS, hdr, solveColor } from './palette';

// Spine for the look: the palette lives in `palette.ts` and construction lives in
// the leaf files; this file owns every choreography decision — which event throws
// which fragments, how a lock reads, how the pale hall answers a beat, and how the
// cube is posed while the start and replay words are up (gameplay owns the pose
// during a run, so the headless simulator sees the same target positions).

const LOCK_GRADIENT = [GRAPHITE, MACHINE_DARK, HOT_WHITE] as const;
/** Distance the cube hangs at behind the start and replay words. */
const ATTRACT_DISTANCE = 70;

type EnemyRecord = {
  mesh: Group;
  kind: string;
  accent: number;
  bornAt: number | null;
  lockPlate: Group | null;
  deniedUntil: number;
};

let environment: Environment | null = null;
let cubeView: CubeView | null = null;
let solveCube: SolveCube | null = null;
let beatEnergy = 0;
let downbeatEnergy = 0;
let elapsedNow = 0;
let charge = 0;
let letterCursor = 0;
let enemyColorCursor = 0;

const attractQuat = new Quaternion();
const attractCenter = new Vector3();
const attractForward = new Vector3();
const attractUp = new Vector3();
const cameraPosition = new Vector3();
const ATTRACT_AXIS = new Vector3(0.35, 0.9, 0.25).normalize();

const lockPlates = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockPlate,
  set: (record, plate) => {
    record.lockPlate = plate;
  },
});

// createEnemyMesh() has no enemy id, but the runner emits `spawn` synchronously
// right after calling it, so pairing a queue with spawn events links mesh to id.
type PendingEnemy = { mesh: Group; kind: string; accent: number };
const enemyRecords = createPendingVisualRecords<PendingEnemy, EnemyRecord>({
  createRecord: (pending) => ({
    mesh: pending.mesh,
    kind: pending.kind,
    accent: pending.accent,
    bornAt: null,
    lockPlate: null,
    deniedUntil: -1,
  }),
  // Enemy meshes are built per spawn, so their geometry and materials have to go
  // back with them; the runner detaches the mesh before emitting kill or miss, so
  // by the time a record is dropped the object is already out of the scene.
  disposeRecord: (record) => {
    lockPlates.detach(record);
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<Object3D, Object3D>({
  createRecord: (mesh) => mesh,
  disposeRecord: (mesh) => disposeObject3D(mesh),
});

export function createEnvironment(scene: Scene, cube: SolveCube) {
  solveCube = cube;
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  cubeView = createCubeView(cube);
  scene.add(cubeView.root);
  return environment.root;
}

export function disposeVisuals(scene: Scene) {
  cubeView?.dispose();
  cubeView = null;
  disposeEffects(scene);
  environment?.dispose();
  environment = null;
  solveCube = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemyMesh(kind, letter);
  built.mesh.userData.kind = kind;
  built.mesh.userData.accent = built.accent;
  if (kind !== 'letter') built.mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(built);
  return built.mesh;
}

function buildEnemyMesh(kind: string, letter?: string): PendingEnemy {
  if (kind === 'letter') {
    const accent = letterCursor % SOLVE_COLORS.length;
    letterCursor += 1;
    return { mesh: createLetterMesh(letter ?? 'A', accent), kind, accent };
  }
  if (kind === 'facet') {
    // The wrong square's colour travels on the spawn entry's letter field.
    const accent = Number.parseInt(letter ?? '0', 10) || 0;
    return { mesh: createFacetMarker(accent), kind, accent };
  }
  if (kind === 'weakpoint') return { mesh: createWeakpoint(), kind, accent: 4 };
  if (kind === 'core') return { mesh: createCore(), kind, accent: 0 };

  // The little polyhedra cycle the six solve colours, so a wave arrives as a set.
  const accent = enemyColorCursor % SOLVE_COLORS.length;
  enemyColorCursor += 1;
  if (kind === 'tetra') return { mesh: createTetra(accent), kind, accent };
  if (kind === 'octa') return { mesh: createOcta(accent), kind, accent };
  if (kind === 'bolt') return { mesh: createBolt(accent), kind, accent };
  return { mesh: createPrism(accent), kind, accent };
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter === true) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  if (mesh.userData.isLetter === true) setLetterDenied(mesh as Group, true);
  spawnRing(mesh.position, hdr(HOT_WHITE, 0.9), 3.2, 0.34, 6);
}

export function createProjectileMesh() {
  const mesh = createProjectile();
  projectileRecords.enqueue(mesh);
  return mesh;
}

export function createReticle() {
  return createSolveReticle();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.05 + (active ? 0.06 : 0));
  const frame = reticle.userData.reticleFrame as MeshBasicMaterial | undefined;
  if (frame) frame.color.copy(active ? hdr(HOT_WHITE, 1.4) : GRAPHITE);
  const pips = reticle.userData.reticlePipMaterials as MeshBasicMaterial[] | undefined;
  if (!pips) return;
  // Six pips, one per lock: the reticle is a solve counter.
  for (let index = 0; index < pips.length; index += 1) {
    pips[index].color.copy(index < lockCount
      ? hdr(colorForLockCount(index + 1, LOCK_GRADIENT), 1.9)
      : GRAPHITE);
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || kind === 'letter') return;
    if (kind === 'facet') {
      spawnRing(worldPosition, hdr(solveColor(record.accent), 1.5), 3.4, 0.34, 5);
      return;
    }
    if (kind === 'core' || kind === 'weakpoint') return;
    spawnRing(worldPosition, hdr(solveColor(record.accent), 0.9), 2.8, 0.4, 2);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockPlate) lockPlates.attach(record, makeLockPlate(record.kind), scene);
    spawnRing(worldPosition, hdr(HOT_WHITE, 1.1 + lockCount * 0.1), 2.2 + lockCount * 0.16, 0.24, 8);
    if (lockCount >= 6) {
      spawnRing(worldPosition, hdr(colorForLockCount(lockCount, LOCK_GRADIENT), 1.5), 5.4, 0.4, 3);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockPlates.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnRing(worldPosition, hdr(HOT_WHITE, 1), 1, 0.15, 10);
  });

  bus.on('hit', ({ enemyId, worldPosition, lethal }) => {
    const record = enemyRecords.get(enemyId);
    if (lethal) return;
    const accent = record ? solveColor(record.accent) : HOT_WHITE;
    burstCubies(worldPosition, accent.clone().multiplyScalar(0.9), 5, 9, 0.5, 0.7);
    spawnRing(worldPosition, hdr(HOT_WHITE, 1.3), 3, 0.24, 6);
    if (record) record.mesh.userData.flashUntil = elapsedNow + 0.16;
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    spawnRing(worldPosition, hdr(HOT_WHITE, 1.6), 6.4, 0.44, 4);
    burstCubies(worldPosition, (record ? solveColor(record.accent) : HOT_WHITE).clone(), 16, 15, 0.9, 1);
    if (record) record.mesh.userData.stageFlashUntil = elapsedNow + 0.4;
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const accent = solveColor(record.accent);
    if (record.kind === 'core') {
      // The core takes the last barrage and bursts into a storm of tiny cubes.
      confettiStorm(worldPosition, SOLVE_COLORS, 62);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.5), 20, 1, 1);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.4), 14, 0.7, 4);
    } else if (record.kind === 'facet') {
      // A wrong square shatters; the square underneath snaps to the solve colour.
      burstCubies(worldPosition, accent.clone(), 16, 13, 0.9, 1.05);
      spawnRing(worldPosition, hdr(accent, 1.6), 4.6, 0.38, 5);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.1), 2.4, 0.22, 9);
    } else if (record.kind === 'weakpoint') {
      burstCubies(worldPosition, HOT_WHITE.clone(), 26, 18, 1.1, 1.2);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.9), 11, 0.6, 3);
    } else {
      burstCubies(worldPosition, accent.clone(), 11, 12, 0.75, 0.95);
      spawnRing(worldPosition, hdr(accent, 1.2), 3.6, 0.32, 4);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstCubies(worldPosition, MACHINE_DARK.clone(), 5, 5, 0.7, 0.7);
  });

  bus.on('reject', ({ enemyIds }) => {
    for (const enemyId of enemyIds) {
      const record = enemyRecords.get(enemyId);
      if (record) record.deniedUntil = elapsedNow + 0.5;
    }
    beatEnergy = Math.max(beatEnergy, 0.9);
  });

  // The core housing refusing an under-committed burst: the shell rings visibly.
  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      spawnRing(shield.worldPosition, hdr(HOT_WHITE, 1.7), 13, 0.5, 5);
      spawnRing(shield.worldPosition, hdr(MACHINE_DARK, 1.4), 8, 0.34, 8);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!solveCube) return;
    if (phase === 'exposed') {
      // The face has reached one colour: its caps blow off (the shower is thrown
      // from the cube view) and the machinery underneath lights up.
      spawnRing(solveCube.center, hdr(HOT_WHITE, 1.1), 15, 0.7, 2);
      beatEnergy = Math.max(beatEnergy, 1.3);
      return;
    }
    if (phase === 'summoned') {
      spawnRing(solveCube.center, hdr(HOT_WHITE, 1.1), 22, 1, 1);
      beatEnergy = Math.max(beatEnergy, 1.6);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 0.85 : 0.34);
    if (isDownbeat) downbeatEnergy = 1;
  });

  bus.on('playerhit', () => {
    beatEnergy = 2;
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    letterCursor = 0;
    charge = 0;
  });

  void scene;
}

export type SpeedsolveVisualContext = {
  camera: Camera;
  feel: CameraFeelRig;
  dt: number;
  elapsed: number;
  runProgress: number;
  running: boolean;
};

export function updateVisuals(context: SpeedsolveVisualContext) {
  const { camera, dt, elapsed, feel, runProgress, running } = context;
  elapsedNow = elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.6);
  downbeatEnergy = Math.max(0, downbeatEnergy - dt * 3.2);

  // The lens breathes on the same grid the cube snaps on: a pulse every beat and a
  // small kick on the downbeat.
  feel.setFovOffset(beatEnergy * 0.9);
  if (downbeatEnergy > 0.985) feel.shake(0.09);

  camera.getWorldPosition(cameraPosition);

  if (solveCube) {
    if (!running) poseAttractCube(camera, dt);
    charge = running ? Math.max(charge, Math.min(1, runProgress * 1.12)) : charge * Math.max(0, 1 - dt);
    environment?.setCharge(charge);
    cubeView?.update(dt);
    for (const fallen of cubeView?.drainFallenCaps() ?? []) {
      burstCubies(fallen.position, solveColor(fallen.color).clone(), 12, 16, 1.25, 1.15);
    }
    environment?.update({ camera, dt, elapsed, cubeCenter: solveCube.center });
  }

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsed;
    if (record.kind !== 'letter') {
      let scale = easeOutBack(Math.min(1, (elapsed - record.bornAt) / 0.26));
      // An incoming shot brakes a couple of metres from the lens. Taper its
      // apparent size there so the hit reads as a candy cube arriving instead of
      // wiping the frame with one enormous additive diamond.
      if (record.kind === 'bolt') {
        scale *= Math.min(1, Math.max(0.3, record.mesh.position.distanceTo(cameraPosition) / 8));
      }
      record.mesh.scale.setScalar(scale);
    }
    updateEnemyLook(record, dt);
    if (record.lockPlate) {
      record.mesh.getWorldPosition(record.lockPlate.position);
      record.lockPlate.quaternion.copy(camera.quaternion);
      record.lockPlate.rotateZ(elapsed * 2.2);
      record.lockPlate.scale.setScalar(1 + Math.sin(elapsed * 12) * 0.05);
    }
  }

  for (const [projectileId, mesh] of projectileRecords.entries()) {
    if (!mesh.parent) projectileRecords.delete(projectileId, { dispose: true });
  }

  updateEffects(dt, camera);
}

function poseAttractCube(camera: Camera, dt: number) {
  if (!solveCube) return;
  camera.getWorldDirection(attractForward);
  camera.getWorldPosition(attractCenter);
  attractUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  attractCenter.addScaledVector(attractForward, ATTRACT_DISTANCE).addScaledVector(attractUp, -15);
  attractQuat.setFromAxisAngle(ATTRACT_AXIS, elapsedNow * 0.3);
  solveCube.openShell(0);
  solveCube.advance(dt);
  solveCube.place(attractCenter, attractQuat);
}

function updateEnemyLook(record: EnemyRecord, dt: number) {
  const userData = record.mesh.userData;
  const denied = Math.max(record.deniedUntil, (userData.deniedUntil as number | undefined) ?? -1);

  if (record.kind === 'facet') {
    const pulse = (userData.solvePulse as number | undefined) ?? 0.5;
    const ticks = userData.facetTicks as Mesh[] | undefined;
    const wash = userData.facetWash as Mesh | undefined;
    const lit = userData.locked === true ? 1 : 0.4 + pulse * 0.6;
    if (ticks) {
      for (const tick of ticks) tick.scale.setScalar(0.7 + lit * 0.6);
      (ticks[0].material as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, 1.2 + lit * 1.5));
    }
    if (wash) (wash.material as MeshBasicMaterial).opacity = 0.32 + lit * 0.42;
  }

  const gimbal = userData.gimbal as Group | undefined;
  if (gimbal) {
    gimbal.rotation.x += dt * 1.9;
    gimbal.rotation.y -= dt * 1.3;
  }

  const boltHalo = userData.boltHalo as Mesh | undefined;
  if (boltHalo) boltHalo.rotation.z += dt * 7;

  const weakGlow = userData.weakGlow as Mesh | undefined;
  const weakVent = userData.weakVent as Mesh | undefined;
  if (weakGlow && weakVent) {
    const level = (userData.charge as number | undefined) ?? 0;
    weakGlow.scale.setScalar(0.6 + level * (1 + Math.sin(elapsedNow * 11) * 0.09));
    (weakGlow.material as MeshBasicMaterial).opacity = 0.22 + level * 0.7;
    (weakVent.material as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, 1.1 + level * 2.2));
  }

  const halos = userData.coreHalos as Mesh[] | undefined;
  const cage = userData.coreCage as Group | undefined;
  if (halos && cage) {
    const spin = (userData.spinUp as number | undefined) ?? 0;
    const exposed = userData.exposed === true;
    cage.rotation.y += dt * (1.4 + spin * 5.5);
    cage.rotation.z += dt * 0.7;
    halos[0].rotation.z += dt * (1.2 + spin * 4);
    halos[1].rotation.z -= dt * (0.9 + spin * 3);
    for (const halo of halos) (halo.material as MeshBasicMaterial).opacity = exposed ? 0.55 + spin * 0.4 : 0.2;
    const heart = userData.coreHeart as Mesh | undefined;
    if (heart) {
      heart.scale.setScalar(0.72 + spin * 0.3 + Math.sin(elapsedNow * 14) * 0.05 * spin);
      (heart.material as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, 1.2 + spin * 1.2));
    }
  }

  if (denied > elapsedNow) {
    // Refused: the piece judders in place, as if the mechanism jammed.
    const flash = Math.min(1, (denied - elapsedNow) / 0.5);
    record.mesh.rotateZ(Math.sin(elapsedNow * 70) * 0.05 * flash);
  }
  const flashUntil = Math.max(
    (userData.flashUntil as number | undefined) ?? -1,
    (userData.stageFlashUntil as number | undefined) ?? -1,
  );
  if (flashUntil > elapsedNow) {
    record.mesh.scale.multiplyScalar(1 + 0.12 * Math.min(1, (flashUntil - elapsedNow) / 0.2));
  }
}

/** Four corner brackets that clamp onto a locked piece, plus a hot centre pip. */
function makeLockPlate(kind: string) {
  const group = new Group();
  const size = kind === 'facet' ? CAP_SIZE + 2.4 : 5.4;
  const material = createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 1.7), side: DoubleSide, opacity: 0.95 });
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    for (const along of [0, 1] as const) {
      const bar = new Mesh(
        new PlaneGeometry(along === 0 ? size * 0.32 : 0.16, along === 0 ? 0.16 : size * 0.32),
        material,
      );
      bar.position.set(
        (x * size) / 2 - x * (along === 0 ? size * 0.16 : 0.08),
        (y * size) / 2 - y * (along === 0 ? 0.08 : size * 0.16),
        0,
      );
      group.add(bar);
    }
  }
  group.add(new Mesh(new BoxGeometry(0.32, 0.32, 0.32), new MeshBasicMaterial({ color: hdr(HOT_WHITE, 2.4) })));
  return group;
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
