import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  burstBubbles,
  burstShards,
  createEffects,
  disposeEffects,
  resetEffects,
  spawnBubble,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import {
  createBroodMesh,
  createLatticeMesh,
  createMiteMesh,
  createParentMesh,
  createPolypMesh,
  createSpitterMesh,
  createSporeMesh,
} from './enemies';
import { createEnvironment, type Environment } from './environment';
import { createJellyfish, type JellyfishRig } from './jellyfish';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  DENY_VIOLET_RED,
  hdr,
  HEAL_GOLD,
  JELLY_EMERALD,
  JELLY_GOLD,
  JELLY_MINT,
  LOCK_GRADIENT,
  PARASITE_CORE,
  PARASITE_DEEP,
  PARASITE_LILAC,
  PARASITE_VIOLET,
  PROJECTILE_EMERALD,
  RETICLE_AQUA,
} from './palette';
import { damageUniform, depthUniform, flashUniform } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type CameraEffectsContext = {
  camera: Camera;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

let environmentInstance: Environment | null = null;
let jellyfishInstance: JellyfishRig | null = null;

let beatEnergy = 0;
let damagePulse = 0;
let flashPulse = 0;
let cameraRoll = 0;
let isFreed = false;

// Track active enemy meshes by id
const enemyMap = new Map<number, { kind: string; mesh: Group }>();

const STRANDLINE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.5,
  pitchDegrees: 0.3,
  yawDegrees: 0.25,
  rollDegrees: 0.5,
  frequency: 7,
  smoothing: 18,
};

export function createEnvironmentInternal(scene: Scene): void {
  environmentInstance = createEnvironment(scene);
  jellyfishInstance = createJellyfish(scene);
  createEffects(scene);
}

export function installVisualEventHandlers(
  bus: EventBus,
  _scene: Scene,
  cameraFeel: CameraFeelRig,
): void {
  bus.on('runstart', () => {
    beatEnergy = 0;
    damagePulse = 0;
    flashPulse = 0;
    cameraRoll = 0;
    isFreed = false;
    enemyMap.clear();
    resetEffects();
    jellyfishInstance?.setBossInfested(true);
    jellyfishInstance?.setFreed(false);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    // Enemy mesh is linked when created
    const pending = pendingEnemyMesh;
    if (pending) {
      enemyMap.set(enemyId, { kind, mesh: pending });
      pendingEnemyMesh = null;
    }
  });

  bus.on('beat', () => {
    beatEnergy = 1.0;
  });

  bus.on('lock', () => {
    // Subtle crisp feel
  });

  bus.on('fire', ({ volleySize }) => {
    cameraFeel.shake(0.04 + volleySize * 0.02, STRANDLINE_SHAKE);
  });

  bus.on('hit', ({ worldPosition }) => {
    spawnRing(worldPosition, JELLY_MINT, 0.2, 1.8, 0.35);
    burstBubbles(worldPosition, 6, JELLY_MINT, 3.0, 0.25);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const entry = enemyMap.get(enemyId);
    const kind = entry?.kind;
    const mesh = entry?.mesh;

    if (kind === 'parent') {
      isFreed = true;
      jellyfishInstance?.setFreed(true);
      flashPulse = 1.6;
      cameraFeel.shake(0.8, STRANDLINE_SHAKE);
      spawnRing(worldPosition, HEAL_GOLD, 0.5, 24.0, 1.8);
      burstBubbles(worldPosition, 160, HEAL_GOLD, 8.0, 0.7);
      burstShards(worldPosition, 40, PARASITE_CORE);
      enemyMap.delete(enemyId);
      return;
    }

    if (kind === 'lattice') {
      spawnRing(worldPosition, PARASITE_LILAC, 0.3, 4.0, 0.45);
      burstShards(worldPosition, 16, PARASITE_VIOLET);
      burstBubbles(worldPosition, 12, JELLY_MINT, 4.0, 0.3);
      enemyMap.delete(enemyId);
      return;
    }

    const specs = (mesh?.userData.shardSpecs as ShardSpec[] | undefined) ?? 8;
    burstShards(worldPosition, specs, (mesh?.userData.accent as Color | undefined) ?? PARASITE_VIOLET);
    burstBubbles(worldPosition, 14, HEAL_GOLD, 3.8, 0.32);
    spawnRing(worldPosition, JELLY_MINT, 0.2, 3.0, 0.4);

    enemyMap.delete(enemyId);
  });

  bus.on('stage', ({ worldPosition }) => {
    spawnRing(worldPosition, PARASITE_CORE, 0.2, 3.2, 0.4);
    burstShards(worldPosition, 8, PARASITE_CORE);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    burstShards(worldPosition, 4, PARASITE_DEEP);
    enemyMap.delete(enemyId);
  });

  bus.on('playerhit', () => {
    damagePulse = 1.0;
    cameraFeel.shake(0.55, STRANDLINE_SHAKE);
  });

  bus.on('reject', () => {
    cameraFeel.shake(0.12, STRANDLINE_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      flashPulse = 0.8;
      cameraFeel.shake(0.3, STRANDLINE_SHAKE);
    }
  });
}

// --------------------------------------------------------------------------
// Visual Factories for Lock-On Runner
// --------------------------------------------------------------------------

let pendingEnemyMesh: Group | null = null;

export function createEnemyMesh(kind: string, letter?: string): Group {
  if (kind === 'letter' || letter) {
    const mesh = createLetterMesh(letter ?? 'A');
    pendingEnemyMesh = mesh;
    return mesh;
  }

  let group: Group;
  switch (kind) {
    case 'polyp':
      group = createPolypMesh();
      break;
    case 'mite':
      group = createMiteMesh();
      break;
    case 'spitter':
      group = createSpitterMesh();
      break;
    case 'spore':
      group = createSporeMesh();
      break;
    case 'lattice':
      group = createLatticeMesh();
      break;
    case 'brood':
      group = createBroodMesh();
      break;
    case 'parent':
      group = createParentMesh();
      break;
    default:
      group = createPolypMesh();
  }

  // Add lock bracket slot
  const lockBracket = createLockBracket();
  lockBracket.visible = false;
  group.add(lockBracket);
  group.userData.lockBracket = lockBracket;

  pendingEnemyMesh = group;
  return group;
}

function createLockBracket(): Group {
  const bracket = new Group();
  const ringGeo = new TorusGeometry(1.4, 0.06, 6, 24);
  const ringMat = createAdditiveBasicMaterial({
    color: hdr(JELLY_GOLD, 1.6),
    opacity: 0.9,
  });
  const ring = new Mesh(ringGeo, ringMat);
  bracket.add(ring);
  bracket.userData.ring = ring;
  bracket.userData.mat = ringMat;
  return bracket;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean): void {
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }

  const bracket = mesh.userData.lockBracket as Group | undefined;
  if (bracket) {
    bracket.visible = locked;
    if (locked) {
      bracket.scale.setScalar(1.2);
    }
  }

  const accent = mesh.userData.accent as Color | undefined;
  if (accent) {
    mesh.scale.setScalar(locked ? 1.2 : 1.0);
  }
}

export function setEnemyDenied(mesh: Object3D): void {
  if (mesh.userData.isLetter) {
    setLetterDenied(mesh as Group);
    return;
  }

  mesh.scale.setScalar(0.8);
  const bracket = mesh.userData.lockBracket as Group | undefined;
  if (bracket) {
    const mat = bracket.userData.mat as MeshBasicMaterial | undefined;
    if (mat) mat.color.copy(hdr(DENY_VIOLET_RED, 2.0));
    bracket.visible = true;
  }

  setTimeout(() => {
    mesh.scale.setScalar(1.0);
    if (bracket) {
      const mat = bracket.userData.mat as MeshBasicMaterial | undefined;
      if (mat) mat.color.copy(hdr(JELLY_GOLD, 1.6));
      bracket.visible = false;
    }
  }, 350);
}

// Projectiles: Bioluminescent emerald-gold torpedoes
export function createProjectileMesh(): Object3D {
  const group = new Group();

  const coreGeo = new SphereGeometry(0.18, 8, 6);
  const coreMat = createAdditiveBasicMaterial({
    color: hdr(PROJECTILE_EMERALD, 2.4),
  });
  const core = new Mesh(coreGeo, coreMat);
  group.add(core);

  const coneGeo = new ConeGeometry(0.14, 0.6, 6);
  const coneMat = createAdditiveBasicMaterial({
    color: hdr(JELLY_MINT, 1.6),
    opacity: 0.8,
  });
  const tail = new Mesh(coneGeo, coneMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -0.3;
  group.add(tail);

  return group;
}

// Reticle: Oceanic targeting ring
export function createReticle(): Object3D {
  const group = new Group();

  // Outer segmented bracket
  const outerGeo = new RingGeometry(0.5, 0.56, 32);
  const outerMat = createAdditiveBasicMaterial({
    color: hdr(RETICLE_AQUA, 1.3),
    side: DoubleSide,
    opacity: 0.8,
  });
  const outerRing = new Mesh(outerGeo, outerMat);
  group.add(outerRing);

  // Inner precision dot
  const dotGeo = new SphereGeometry(0.04, 8, 6);
  const dotMat = createAdditiveBasicMaterial({ color: hdr(RETICLE_AQUA, 2.0) });
  const dot = new Mesh(dotGeo, dotMat);
  group.add(dot);

  // 4 reticle ticks
  const tickGeo = new BoxGeometry(0.04, 0.16, 0.02);
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(tickGeo, outerMat);
    const ang = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(ang) * 0.62, Math.sin(ang) * 0.62, 0);
    tick.rotation.z = ang;
    group.add(tick);
  }

  group.userData.outerMat = outerMat;
  group.userData.dotMat = dotMat;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number): void {
  reticle.visible = true;

  const outerMat = reticle.userData.outerMat as MeshBasicMaterial | undefined;
  const dotMat = reticle.userData.dotMat as MeshBasicMaterial | undefined;

  const tierColor = LOCK_GRADIENT[Math.min(lockCount, LOCK_GRADIENT.length - 1)] ?? RETICLE_AQUA;

  if (outerMat) {
    outerMat.color.copy(hdr(tierColor, active ? 1.8 : 1.2));
  }
  if (dotMat) {
    dotMat.color.copy(hdr(tierColor, active ? 2.2 : 1.5));
  }

  reticle.scale.setScalar(active ? 1.05 + lockCount * 0.06 : 0.95);
  reticle.rotation.z += 0.015 * (1 + lockCount * 0.3);
}

// --------------------------------------------------------------------------
// Per-Frame Updates
// --------------------------------------------------------------------------

export function updateCameraEffects(
  dt: number,
  context: CameraEffectsContext,
): void {
  const { camera, feel, running, runTime } = context;

  // Gentle oceanic breathing roll
  const oceanRoll = Math.sin(runTime * 0.6) * 0.015;
  cameraRoll = MathUtils.lerp(cameraRoll, oceanRoll, dt * 2.0);
  camera.rotation.z += cameraRoll;

  // Grand pullback during serenity section (runTime >= 55s)
  if (running && runTime >= 55.0) {
    const pullT = Math.min(1, (runTime - 55.0) / 5.0);
    const smoothPull = MathUtils.smoothstep(pullT, 0, 1);
    feel.setFovOffset(smoothPull * 22.0);
  }

  feel.update(dt);
}

export function updateVisuals(
  dt: number,
  context: VisualContext,
): void {
  const { camera, elapsed, runTime, running } = context;

  // Beat decay
  beatEnergy = Math.max(0, beatEnergy - dt * 2.8);

  // Damage vignette decay
  damagePulse = Math.max(0, damagePulse - dt * 2.4);
  damageUniform.value = damagePulse;

  // Flash decay
  flashPulse = Math.max(0, flashPulse - dt * 1.6);
  flashUniform.value = flashPulse;

  // Depth grading progression
  const progress = running ? Math.min(1, runTime / 60.0) : 0;
  depthUniform.value = progress;

  // Update environment and giant jellyfish
  environmentInstance?.update(elapsed, dt, camera.position);
  jellyfishInstance?.update(elapsed, dt, beatEnergy);

  // Update particles and effects
  updateEffects(dt, elapsed);
}

export function disposeVisuals(): void {
  enemyMap.clear();
  pendingEnemyMesh = null;
  environmentInstance?.dispose();
  environmentInstance = null;
  jellyfishInstance?.dispose();
  jellyfishInstance = null;
  disposeEffects();
}
