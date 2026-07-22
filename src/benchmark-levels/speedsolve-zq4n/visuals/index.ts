import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  buildCube,
  disposeCube,
  facesConquered,
  isCoreDead,
  releaseQueuedTwist,
  setCubeBeat,
  shutdownCube,
  updateCube,
} from '../cube';
import { speedFactorAt } from '../gameplay';
import {
  createBoltMesh,
  createCoreMesh,
  createOctaMesh,
  createPipMesh,
  createPrismMesh,
  createTetraMesh,
  createWeakMesh,
  setCoreCaged,
  setPrismCharge,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  createEffects,
  disposeEffects,
  resetEffects,
  spawnConfetti,
  spawnGlint,
  spawnRing,
  spawnSparks,
  spawnTrailMote,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { BONE, GRAPHITE, HOT_WHITE, INK, LOCK_GRADIENT, MACHINE_GREY, MACHINE_WHITE, SOLVE_COLORS, hdr } from './palette';
import { snapUniform, solveUniform, strainUniform } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type CameraEffectsContext = {
  camera: PerspectiveCamera;
  curve: CatmullRomCurve3;
  runTime: number;
  runProgress: number;
  dt: number;
  feel: CameraFeelRig;
};

type EnemyRecord = { mesh: Group; bornAt: number | null; lockRing: Group | null };
type ProjectileRecord = { mesh: Object3D; color: Color };

const CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 3.0,
  maxTrauma: 1.5,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.55,
  frequency: 11,
  smoothing: 26,
};

let environment: Environment | null = null;
let beatEnergy = 0;
let snapPulse = 0;
let strain = 0;
let hitsTaken = 0;
let elapsedNow = 0;
let cameraRoll = 0;
let cameraFov = 0;
let hueCursor = 0;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
// Every target and tracer builds its own geometry, so every one has to give it
// back; the runner only removes meshes from the scene.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  disposeRecord: (record) => disposeObject3D(record.mesh),
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  buildCube(scene);
  return environment.root;
}

export function disposeEnvironment() {
  environment?.dispose();
  environment = null;
  disposeEffects();
  disposeCube();
}

// ---- factories ------------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  // Escort and letter colors walk the solve palette in creation order, so the
  // frame keeps cycling hues instead of clustering on one.
  hueCursor += 1;
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A', hueCursor);
    case 'pip':
      return createPipMesh(facesConquered());
    case 'weak':
      return createWeakMesh();
    case 'core':
      return createCoreMesh();
    case 'tetra':
      return createTetraMesh(hueCursor);
    case 'octa':
      return createOctaMesh(hueCursor + 2);
    case 'prism':
      return createPrismMesh(hueCursor + 4);
    case 'bolt':
      return createBoltMesh(hueCursor + 1);
    default:
      return createTetraMesh(hueCursor);
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, hdr(INK, 1.2), 3.0, 0.32);
  spawnGlint(mesh.position, hdr(MACHINE_GREY, 0.9), 0.5, 0.14);
}

/** Player fire: a graphite dart with one white-hot face. Cold, small, precise. */
export function createProjectileMesh() {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(0.42, 0.42, 1.5), new MeshBasicMaterial({ color: hdr(GRAPHITE, 2.4) })));
  const tip = new Mesh(new BoxGeometry(0.5, 0.5, 0.26), createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 1.8) }));
  tip.position.z = 0.78;
  group.add(tip);
  projectileRecords.enqueue({ mesh: group, color: BONE.clone().multiplyScalar(0.7) });
  return group;
}

// ---- reticle ---------------------------------------------------------------------

/**
 * A caliper: an ink square with six segment lamps around it, one per lock, so
 * the charge is countable rather than merely brighter. That matters more here
 * than anywhere, because six locks is one solve move plus a full escort wave.
 */
export function createReticle() {
  const group = new Group();
  const frameParts: MeshBasicMaterial[] = [];

  for (const [w, h, x, y] of [
    [1.34, 0.07, 0, 0.63],
    [1.34, 0.07, 0, -0.63],
    [0.07, 1.34, 0.63, 0],
    [0.07, 1.34, -0.63, 0],
  ] as const) {
    const material = createAdditiveBasicMaterial({ color: hdr(INK, 1), side: DoubleSide });
    const bar = new Mesh(new BoxGeometry(w, h, 0.02), material);
    bar.position.set(x, y, 0);
    frameParts.push(material);
    group.add(bar);
  }

  const segments: MeshBasicMaterial[] = [];
  const segmentGroup = new Group();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const material = createAdditiveBasicMaterial({ color: hdr(INK, 1), side: DoubleSide });
    const lamp = new Mesh(new BoxGeometry(0.22, 0.22, 0.02), material);
    lamp.position.set(Math.cos(angle) * 0.95, Math.sin(angle) * 0.95, 0);
    lamp.rotation.z = angle;
    segments.push(material);
    segmentGroup.add(lamp);
  }
  group.add(segmentGroup);

  const dotMaterial = createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 1.4), side: DoubleSide });
  group.add(new Mesh(new BoxGeometry(0.09, 0.09, 0.02), dotMaterial));

  group.userData.frameParts = frameParts;
  group.userData.segments = segments;
  group.userData.dot = dotMaterial;
  group.userData.spinner = segmentGroup;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.06 : 0));
  const charge = colorForLockCount(Math.max(1, lockCount), LOCK_GRADIENT);
  for (const material of reticle.userData.frameParts as MeshBasicMaterial[]) {
    material.color.copy(lockCount > 0 ? hdr(charge, 1.5) : hdr(INK, active ? 1.6 : 1));
  }
  const segments = reticle.userData.segments as MeshBasicMaterial[];
  for (let i = 0; i < segments.length; i += 1) {
    segments[i].color.copy(i < lockCount ? hdr(HOT_WHITE, 2.2) : hdr(INK, active ? 1.5 : 0.9));
  }
  (reticle.userData.dot as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, active ? 2.4 : 1.2));
}

// ---- event wiring -----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? BONE;
    if (kind === 'weak') {
      spawnRing(worldPosition, hdr(MACHINE_WHITE, 1.5), 8, 0.4);
      spawnGlint(worldPosition, hdr(HOT_WHITE, 1.2), 2.0, 0.2);
    } else if (kind === 'core') {
      cameraFeel.shake(1.1, CAMERA_SHAKE);
      snapPulse = Math.max(snapPulse, 0.5);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.0), 38, 0.9);
      spawnRing(worldPosition, hdr(MACHINE_WHITE, 0.8), 22, 0.6);
    } else if (kind === 'pip') {
      spawnRing(worldPosition, hdr(accent, 1.2), 3.6, 0.26);
    } else if (kind !== 'bolt' && kind !== 'letter') {
      spawnRing(worldPosition, hdr(accent, 0.9), 3.0, 0.3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockBracket(color), scene);
    spawnRing(worldPosition, hdr(lockCount >= 4 ? HOT_WHITE : MACHINE_WHITE, 1.2), 2.4, 0.22);
    if (lockCount === 6) {
      spawnGlint(worldPosition, hdr(HOT_WHITE, 1.3), 2.4, 0.22);
      snapPulse = Math.max(snapPulse, 0.16);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(HOT_WHITE, 0.9), 0.9, 0.1);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    const record = enemyRecords.get(enemyId);
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? BONE;
    spawnSparks(worldPosition, hdr(accent, 1.1), 5, 10);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.22;
      spawnGlint(worldPosition, hdr(HOT_WHITE, 0.95), 1.2, 0.13);
    }
  });

  bus.on('stage', ({ worldPosition }) => {
    // Core armor giving way: the cage is what breaks, so the flare is white.
    spawnRing(worldPosition, hdr(HOT_WHITE, 1.0), 17, 0.55);
    spawnSparks(worldPosition, hdr(MACHINE_WHITE, 1.0), 24, 22);
    cameraFeel.shake(0.7, CAMERA_SHAKE);
    snapPulse = Math.max(snapPulse, 0.3);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const userData = record.mesh.userData;
    const accent = (userData.accent as Color | undefined) ?? BONE;

    if (userData.isCore) {
      // The finish: the machine goes to confetti.
      cameraFeel.shake(1.5, CAMERA_SHAKE);
      snapPulse = 1;
      spawnConfetti(worldPosition, 400, 26);
      for (let i = 0; i < 6; i += 1) spawnRing(worldPosition, hdr(SOLVE_COLORS[i], 0.9), 28 + i * 11, 0.8 + i * 0.1);
      spawnGlint(worldPosition, hdr(HOT_WHITE, 1.6), 9, 0.6);
    } else if (userData.isWeak) {
      cameraFeel.shake(0.75, CAMERA_SHAKE);
      snapPulse = Math.max(snapPulse, 0.42);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.0), 18, 0.55);
      spawnSparks(worldPosition, hdr(MACHINE_WHITE, 1.1), 30, 24);
      spawnConfetti(worldPosition, 26, 15);
    } else if (userData.isPip) {
      // A solve move landing: a square shock in the color the square just became.
      spawnRing(worldPosition, hdr(accent, 1.2), 8.5, 0.34);
      spawnSparks(worldPosition, hdr(accent, 1.2), 16, 15);
      spawnGlint(worldPosition, hdr(HOT_WHITE, 1.1), 2.2, 0.16);
      snapPulse = Math.max(snapPulse, 0.14);
    } else {
      spawnRing(worldPosition, hdr(accent, 1.2), 4.6, 0.34);
      spawnSparks(worldPosition, hdr(accent, 1.3), 12, 14);
      spawnConfetti(worldPosition, 5, 9);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemyRecords.delete(enemyId, { dispose: true });
    spawnSparks(worldPosition, MACHINE_GREY.clone().multiplyScalar(0.5), 3, 4);
  });

  bus.on('reject', () => {
    // The machine refuses: a hard dead thud, no color at all.
    snapPulse = Math.max(snapPulse, 0.1);
    cameraFeel.shake(0.3, CAMERA_SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      snapPulse = Math.max(snapPulse, 0.22);
    }
  });

  // The contract that makes the cube percussion: queued layer rotations are
  // released here and nowhere else, so a snap can only ever land on a beat.
  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
    if (releaseQueuedTwist()) {
      snapPulse = Math.max(snapPulse, 0.2);
      beatEnergy = Math.max(beatEnergy, 1.2);
    }
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    strain = 1;
    cameraFeel.shake(1.2, CAMERA_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') snapPulse = Math.max(snapPulse, 0.45);
    if (phase === 'summoned') snapPulse = Math.max(snapPulse, 0.55);
  });

  bus.on('runstart', () => {
    resetEffects();
    environment?.reset();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    cameraRoll = 0;
    cameraFov = 0;
    cameraFeel.restore();
    beatEnergy = 0;
    snapPulse = 0;
    strain = 0;
    hitsTaken = 0;
    snapUniform.value = 0;
    strainUniform.value = 0;
    solveUniform.value = 0;
  });

  bus.on('runend', () => {
    cameraFeel.restore();
    cameraRoll = 0;
    cameraFov = 0;
    // Whatever is left of the machine powers down so the REPLAY plates have
    // clean air to hang in.
    shutdownCube();
    if (!isCoreDead()) spawnRing(new Vector3(0, 0, 0), hdr(MACHINE_GREY, 0.9), 34, 1.1);
  });
}

// ---- per-frame ------------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.6);
  snapPulse = Math.max(0, snapPulse - dt * 3.4);
  strain = Math.max(0, strain - dt * 1.5);

  const solved = facesConquered();
  environment?.setFacesConquered(solved);
  environment?.update(dt, { elapsed: ctx.elapsed, beatEnergy, running: ctx.running });

  snapUniform.value = snapPulse * 0.16;
  strainUniform.value = Math.min(1, strain * 0.55 + hitsTaken * 0.1);
  solveUniform.value = MathUtils.clamp(solved / 6, 0, 1);

  // While the run is live the cube is driven from gameplay, ahead of enemy
  // motion; between runs nobody else is asking, so drive it here.
  setCubeBeat(beatEnergy);
  if (!ctx.running) updateCube(dt, ctx.camera, false);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    updateEnemyLook(record, ctx);
    // Enemies scale themselves in as part of their motion; the START/REPLAY
    // plates have no motion of their own, so they get their pop-in here.
    if (record.mesh.userData.isLetter) {
      const t = Math.min(1, (elapsedNow - record.bornAt) / 0.36);
      record.mesh.scale.setScalar(1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2);
    }

    const spinner = record.mesh.userData.spinner as Object3D | undefined;
    if (spinner) {
      spinner.rotation.x += dt * 1.7;
      spinner.rotation.y += dt * 2.3;
    }
    if (record.mesh.userData.isPrism) setPrismCharge(record.mesh, (record.mesh.userData.charge as number) ?? 0);
    if (record.mesh.userData.isCore) setCoreCaged(record.mesh, record.mesh.userData.caged === true, elapsedNow);
    if (record.mesh.userData.isHostileShot) spawnTrailMote(record.mesh.position, record.mesh.userData.trailColor as Color);

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 1.1;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(fit * (1.75 + Math.sin(elapsedNow * 11) * 0.06));
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    spawnTrailMote(record.mesh.position, record.color);
  }

  const spinner = findReticleSpinner(ctx.scene);
  if (spinner) spinner.rotation.z += dt * (spinner.parent?.userData.active ? 1.7 : 0.35);

  updateEffects(dt, ctx.camera);
}

/**
 * Everything the camera does on top of the look-at: bank into the orbit, let
 * the FOV breathe with the swing between faces, and carry the shake. The
 * look-at itself belongs to gameplay, which has already run this frame.
 */
export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const camera = ctx.camera;
  const u = MathUtils.clamp(ctx.runProgress, 0, 1);
  const tangent = ctx.curve.getTangentAt(u);
  const ahead = ctx.curve.getTangentAt(MathUtils.clamp(u + 0.008, 0, 1));
  const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.16, 0.16);
  cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.4);
  camera.rotateZ(cameraRoll);

  const targetFov = (speedFactorAt(ctx.runTime) - 0.9) * 3.4 + beatEnergy * 1.1 + snapPulse * 3.6;
  cameraFov += (targetFov - cameraFov) * Math.min(1, dt * 7);
  ctx.feel.setFovOffset(cameraFov);
  ctx.feel.update(dt, { shake: CAMERA_SHAKE });
  camera.updateMatrixWorld();
}

function updateEnemyLook(record: EnemyRecord, ctx: VisualContext) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else setLetterLocked(record.mesh, userData.locked === true);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  const locked = userData.locked === true;
  const flashing = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  // Distance falloff keeps the escort's saturated bodies from stacking up in
  // the wings. Cages and hot cores are exempt: those are the read.
  const distance = record.mesh.position.distanceTo(ctx.camera.position);
  const closeness = MathUtils.clamp(1 - (distance - 14) / 46, 0.4, 1);
  // A cube target running out of time strobes its cage. The escort never does
  // this, so a strobing outline always means "the machine is about to take
  // this square back".
  const expiry = (userData.expiry as number | undefined) ?? 0;
  const urgent = expiry > 0.66 ? 0.5 + Math.sin(elapsedNow * (12 + expiry * 18)) * 0.5 : 0;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'core' ? hdr(MACHINE_GREY, 0.5) : hdr(INK, 0.7));
      continue;
    }
    if (flashing) {
      part.material.color.copy(hdr(HOT_WHITE, part.kind === 'cage' ? 2.2 : 1.5));
      continue;
    }
    if (locked) {
      if (part.kind === 'cage') part.material.color.copy(hdr(HOT_WHITE, 2.0));
      else if (part.kind === 'core') part.material.color.copy(hdr(HOT_WHITE, 2.6));
      else part.material.color.copy(part.base).multiplyScalar(1.5);
      continue;
    }
    const dim = part.kind === 'body' ? 0.66 + 0.34 * closeness : 1;
    part.material.color.copy(part.base).multiplyScalar(dim + urgent * (part.kind === 'cage' ? 0.9 : 0.25));
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle' && child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

/** Lock bracket: four corner clamps, the shape of a sticker being measured. */
function makeLockBracket(color: Color): Group {
  const group = new Group();
  const material = createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(HOT_WHITE, 0.45), 1.9), side: DoubleSide });
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const arm = new Mesh(new BoxGeometry(0.5, 0.11, 0.04), material);
    arm.position.set(sx * 0.75, sy * 1.0, 0);
    group.add(arm);
    const leg = new Mesh(new BoxGeometry(0.11, 0.5, 0.04), material);
    leg.position.set(sx * 1.0, sy * 0.75, 0);
    group.add(leg);
  }
  group.userData.raildIgnoreOcclusion = true;
  return group;
}
