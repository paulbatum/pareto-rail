import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { chargeAt } from '../breech';
import { BARREL_RADIUS, massDriverRunProgress, MUZZLE_U, RING_US, speedFactorAt } from '../gameplay';
import { MASS_DRIVER_BEAT, MASS_DRIVER_DURATION, MUZZLE_TIME, RING_COUNT } from '../timing';
import { createBarrel, type Barrel } from './barrel';
import {
  breakClampArmour,
  createClampMesh,
  createInterlockMesh,
  createLanceMesh,
  createSentryMesh,
  createWeaverMesh,
  type ShardSpec,
  type TintPart,
} from './drones';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnArc,
  spawnGlint,
  spawnShock,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  ARC_BLUE,
  ARC_CYAN,
  coilColor,
  FAULT_AMBER,
  FAULT_RED,
  hdr,
  LOCK_GRADIENT,
  MAGENTA,
  VIOLET,
  WHITE_HOT,
} from './palette';
import { chargeUniform, flashUniform, warpUniform } from './post-fx';

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

type EnemyRecord = { mesh: Group; bornAt: number | null; lockRing: Group | null };
type ProjectileRecord = { mesh: Object3D };

const DENY_EDGE = new Color(1.7, 0.14, 0.06);
const DENY_FILL = new Color(0.32, 0.02, 0.01);

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.9,
  maxTrauma: 1.8,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 10.5,
  smoothing: 22,
};

// How far ahead a coil stays lit. Past this the bore is fog, which is what gives
// the barrel depth instead of lighting the whole gun at once.
const COIL_VIEW = 300;
const COIL_FALLOFF = 118;
/** Speed of the firing wave down the barrel once the gun goes off, in units/s. */
const FIRE_WAVE_SPEED = 1400;

let barrel: Barrel | null = null;
let activeCamera: PerspectiveCamera | null = null;
let beatEnergy = 0;
let surge = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let cameraFov = 0;
let cameraRoll = 0;
let interlocksAlive = 0;
let interlocksSeen = 0;
/** Elapsed time the gun fired, or -1. Drives the white wave down the coils. */
let firedAt = -1;
/** Elapsed time the barrel burst, or -1. */
let burstAt = -1;

const scratchColor = new Color();
const scratchAxis = new Vector3();
const scratchRadial = new Vector3();
const scratchForward = new Vector3();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  barrel = createBarrel(scene);
  createEffects(scene);
  return barrel.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'L');
    case 'sentry':
      return createSentryMesh();
    case 'weaver':
      return createWeaverMesh();
    case 'clamp':
      return createClampMesh();
    case 'lance':
      return createLanceMesh();
    case 'interlock':
      return createInterlockMesh();
    default:
      return createSentryMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnShock(mesh.position, hdr(FAULT_RED, 1.4), 3.0, 0.3);
}

/** The payload's own shot: a slug of the gun's charge, thrown out ahead of it. */
export function createProjectileMesh() {
  const group = new Group();
  const core = new OctahedronGeometry(0.3, 0);
  core.scale(0.42, 0.42, 2.4);
  group.add(new Mesh(core, new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.6) })));
  const shell = new OctahedronGeometry(0.5, 0);
  shell.scale(0.6, 0.6, 2.0);
  group.add(new Mesh(shell, createAdditiveBasicMaterial({ color: hdr(ARC_CYAN, 1.1), opacity: 0.55 })));
  projectileRecords.enqueue({ mesh: group });
  return group;
}

// ---- reticle ----------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
    return mesh;
  };

  // Six-fold, like the coils: the player's sight is cut from the same gun.
  const outer = addPart(new Mesh(new RingGeometry(0.6, 0.645, 6), new MeshBasicMaterial()), hdr(ARC_CYAN, 1.2));

  const spinner = new Group();
  spinner.add(addPart(new Mesh(new RingGeometry(0.34, 0.375, 6), new MeshBasicMaterial()), hdr(ARC_BLUE, 1.4)));

  // Four jaws that close on the centre as the charge builds.
  const jaws = new Group();
  for (let i = 0; i < 4; i += 1) {
    const jaw = addPart(new Mesh(new PlaneGeometry(0.26, 0.045), new MeshBasicMaterial()), hdr(ARC_CYAN, 1.5));
    jaw.userData.angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    jaws.add(jaw);
  }

  const dot = addPart(new Mesh(new CircleGeometry(0.045, 12), new MeshBasicMaterial()), hdr(WHITE_HOT, 2.4));

  group.add(outer, spinner, jaws, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.jaws = jaws;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.06 : 0));

  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.9 : 1.4));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.4 : 1);
  }

  // Jaws close from wide open to nearly touching across the six locks.
  const jaws = reticle.userData.jaws as Group | undefined;
  if (!jaws) return;
  const radius = MathUtils.lerp(0.95, 0.5, Math.min(1, lockCount / 6));
  for (const jaw of jaws.children) {
    const angle = jaw.userData.angle as number;
    jaw.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    jaw.rotation.z = angle + Math.PI / 2;
  }
}

// ---- event wiring -----------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    enemyRecords.claim(enemyId);
    if (kind === 'interlock') {
      interlocksAlive += 1;
      interlocksSeen += 1;
      // Each safety announces itself with a fault flare and a hard shock ring.
      spawnShock(worldPosition, hdr(FAULT_AMBER, 1.5), 9, 0.55);
      spawnGlint(worldPosition, hdr(FAULT_RED, 2.0), 3.4, 0.34);
      cameraFeel.shake(0.28, SHAKE);
    } else if (kind === 'lance') {
      spawnGlint(worldPosition, hdr(FAULT_RED, 1.8), 1.5, 0.2);
    } else if (kind !== 'letter') {
      // Drones drop into the bore through a coil aperture.
      spawnShock(worldPosition, hdr(ARC_BLUE, 0.9), 2.6, 0.32);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnShock(worldPosition, hdr(lockColor, 1.5), 2.1, 0.24);
    if (lockCount >= 6) {
      // Full charge: the sight itself arcs over.
      spawnGlint(worldPosition, hdr(WHITE_HOT, 2.2), 2.4, 0.26);
      beatEnergy = Math.max(beatEnergy, 1.1);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ARC_CYAN, 1.6), 0.7, 0.13);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(ARC_CYAN, 1.1), 5, 11);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(WHITE_HOT, 1.9), 1.2, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || record.mesh.userData.kind !== 'clamp') return;
    breakClampArmour(record.mesh);
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs.slice(0, 5), 9);
    spawnShock(worldPosition, hdr(ARC_CYAN, 1.4), 5.5, 0.4);
    cameraFeel.shake(0.22, SHAKE);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? FAULT_AMBER;
    if (specs) burstShards(worldPosition, specs, 11);

    if (record.mesh.userData.isInterlock) {
      interlocksAlive = Math.max(0, interlocksAlive - 1);
      // A safety letting go dumps its whole charge into the bore.
      cameraFeel.shake(0.85, SHAKE);
      surge = Math.max(surge, 0.7);
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      spawnShock(worldPosition, hdr(WHITE_HOT, 1.6), 26, 0.85);
      spawnShock(worldPosition, hdr(VIOLET, 1.3), 15, 0.6);
      spawnGlint(worldPosition, hdr(WHITE_HOT, 2.6), 5.5, 0.4);
      throwArcToWall(worldPosition, hdr(WHITE_HOT, 2.0), 4);
    } else {
      spawnShock(worldPosition, hdr(accent, 1.0), 4.6, 0.4);
      spawnGlint(worldPosition, hdr(WHITE_HOT, 1.8), 1.4, 0.2);
      // The level's most-repeated sentence: a kill earths itself on the barrel.
      throwArcToWall(worldPosition, hdr(ARC_CYAN, 1.9), 2);
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemyRecords.delete(enemyId, { dispose: true });
    // A miss vents, it does not explode: a weak amber puff going past you.
    burstSparks(worldPosition, FAULT_AMBER.clone().multiplyScalar(0.35), 3, 3, 0.3);
  });

  bus.on('reject', () => {
    // Safety refusing the shot: the frame kicks and the sight snaps red.
    flashUniform.value = Math.max(flashUniform.value, 0.13);
    cameraFeel.shake(0.24, SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size < 5 || kills !== size) return;
    beatEnergy = Math.max(beatEnergy, 1.6);
    surge = Math.max(surge, 0.45);
    flashUniform.value = Math.max(flashUniform.value, 0.2);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    cameraFeel.shake(1.2, SHAKE);
    flashUniform.value = Math.max(flashUniform.value, 0.16);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    interlocksAlive = 0;
    interlocksSeen = 0;
    firedAt = -1;
    burstAt = -1;
    surge = 0;
    lastRunTime = -1;
    flashUniform.value = 0;
    chargeUniform.value = 0;
    warpUniform.value = 0;
    resetCameraFeel(cameraFeel);
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

/** Earth a discharge from `origin` out to the nearest point on the bore wall. */
function throwArcToWall(origin: Vector3, color: Color, count: number) {
  if (!activeCamera) return;
  activeCamera.getWorldDirection(scratchForward);
  const depth = scratchAxis.copy(origin).sub(activeCamera.position).dot(scratchForward);
  scratchAxis.copy(activeCamera.position).addScaledVector(scratchForward, depth);
  scratchRadial.copy(origin).sub(scratchAxis);
  const radius = scratchRadial.length();
  if (radius < 0.001) scratchRadial.set(1, 0, 0);
  else scratchRadial.multiplyScalar(1 / radius);
  const reach = Math.max(2.5, BARREL_RADIUS - radius);
  for (let i = 0; i < count; i += 1) {
    const jitter = scratchRadial.clone();
    jitter.x += (Math.random() - 0.5) * 0.5;
    jitter.y += (Math.random() - 0.5) * 0.5;
    jitter.z += (Math.random() - 0.5) * 0.35;
    spawnArc(origin, jitter, reach * (0.75 + Math.random() * 0.45), color, 0.16 + Math.random() * 0.12);
  }
}

// ---- per-frame --------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraFov = 0;
  cameraRoll = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  activeCamera = ctx.camera as PerspectiveCamera;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.6);
  surge = Math.max(0, surge - dt * 1.1);

  const runTime = ctx.running ? ctx.runTime : 0;
  const cameraU = ctx.running ? massDriverRunProgress(runTime, MASS_DRIVER_DURATION) : 0;
  // Past the muzzle the charge is spent, whichever way it went. Releasing it
  // here is what lets the frame fall quiet for the last three seconds.
  const charge = ctx.running && runTime < MUZZLE_TIME ? chargeAt(runTime) : 0;

  detectMuzzleMoment(ctx);
  paintBarrel(ctx, runTime, cameraU, charge);
  updateSky(dt, ctx, cameraU);
  updatePostUniforms(dt, ctx, charge);
  updateTargets(dt, ctx);
  updateEffects(dt, ctx.camera);
}

/**
 * The moment the whole level is built toward. The charge peaks at the muzzle bar
 * no matter what the player does; the only question is whether the safeties are
 * clear when it does.
 */
function detectMuzzleMoment(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = lastRunTime >= 0 && lastRunTime < MUZZLE_TIME && ctx.runTime >= MUZZLE_TIME;
  lastRunTime = ctx.runTime;
  if (!crossed || interlocksSeen === 0) return;

  if (interlocksAlive === 0) {
    // Clean fire. Everything the barrel has been holding goes out the front.
    firedAt = elapsedNow;
    flashUniform.value = 0.85;
    surge = 1.4;
    ctx.feel.shake(1.5, SHAKE);
  } else {
    // Nowhere for the charge to go, and the bore is the weakest part now.
    burstAt = elapsedNow;
    flashUniform.value = 1.15;
    surge = 1.6;
    ctx.feel.shake(1.8, SHAKE);
  }
}

/**
 * Paint the coils. Each ring reads its own position along the barrel for base
 * colour, its distance from the payload for falloff, and its beat number for the
 * pass flash: ring `n` swells through the beat and detonates exactly as the
 * camera crosses it. That is the level's whole thesis, in one loop.
 */
function paintBarrel(ctx: VisualContext, runTime: number, cameraU: number, charge: number) {
  if (!barrel) return;

  // Standing by: the gun idles its first coils on a loop instead of freezing.
  const beat = ctx.running ? runTime / MASS_DRIVER_BEAT : (elapsedNow / MASS_DRIVER_BEAT) % 26;

  const cameraArc = cameraU * barrel.railLength;
  const heat = 1 + charge * 1.35 + beatEnergy * 0.22;
  const waveArc = firedAt >= 0 ? (elapsedNow - firedAt) * FIRE_WAVE_SPEED : -1;

  for (let index = 0; index < RING_US.length; index += 1) {
    const ahead = barrel.coilArc[index] - cameraArc;
    if (ahead < -14 || ahead > COIL_VIEW) {
      scratchColor.setScalar(0);
      barrel.coilCore.setColorAt(index, scratchColor);
      barrel.coilGlow.setColorAt(index, scratchColor);
      continue;
    }

    const delta = beat - index;
    // Pre-charge swells into the beat; the crossing snaps and decays behind you.
    const energy = delta >= 0 ? Math.exp(-delta * 8.5) : Math.max(0, 1 + delta) ** 7 * 0.75;
    const dim = 1 / (1 + (Math.max(0, ahead) / COIL_FALLOFF) ** 2);
    coilColor(index / RING_COUNT, scratchColor);

    let intensity = (0.18 + energy * 1.5) * dim * heat;
    if (waveArc >= 0) {
      // The firing wave: a band of white racing out of the breech ahead of you.
      // Kept to a band rather than a global flash — a whole white frame reads as
      // a broken renderer, a moving front reads as the gun going off.
      const band = Math.abs(barrel.coilArc[index] - (cameraArc + waveArc));
      if (band < 45) {
        intensity += (1 - band / 45) * 3.5;
        scratchColor.lerp(WHITE_HOT, 0.8);
      }
    }
    if (burstAt >= 0) scratchColor.lerp(FAULT_RED, Math.min(1, (elapsedNow - burstAt) * 3));

    barrel.coilCore.setColorAt(index, scratchColor.clone().multiplyScalar(intensity * 1.5));
    barrel.coilGlow.setColorAt(index, scratchColor.multiplyScalar(intensity * 0.18));
  }
  if (barrel.coilCore.instanceColor) barrel.coilCore.instanceColor.needsUpdate = true;
  if (barrel.coilGlow.instanceColor) barrel.coilGlow.instanceColor.needsUpdate = true;

  // The conductors carry the same heat but hold a steady line — they are what
  // the eye tracks for speed, so they must not strobe along with the coils.
  for (let index = 0; index < barrel.conductorArc.length; index += 1) {
    const ahead = barrel.conductorArc[index] - cameraArc;
    if (ahead < -24 || ahead > COIL_VIEW) {
      scratchColor.setScalar(0);
    } else {
      const dim = 1 / (1 + (Math.max(0, ahead) / (COIL_FALLOFF * 1.3)) ** 2);
      // The nearest segments cover most of the frame, so they get pulled down —
      // otherwise the four rails read as a bright X painted over the tunnel
      // instead of as lines running away from you.
      const near = Math.min(1, Math.max(0, ahead) / 26);
      coilColor(index / barrel.conductorArc.length, scratchColor)
        .multiplyScalar(dim * near * (0.55 + beatEnergy * 0.35) * heat);
    }
    barrel.conductors.setColorAt(index, scratchColor);
  }
  if (barrel.conductors.instanceColor) barrel.conductors.instanceColor.needsUpdate = true;

  // The mouth of the gun: dead ahead the whole run, and it only gets brighter.
  const muzzleAhead = MUZZLE_U * barrel.railLength - cameraArc;
  const approach = muzzleAhead > 0 ? 1 / (1 + (muzzleAhead / 190) ** 2) : 1;
  const muzzleHeat = (0.6 + charge * 1.4 + (firedAt >= 0 ? 6 : 0)) * approach;
  (barrel.muzzleRing.material as MeshBasicMaterial).color.copy(hdr(WHITE_HOT, 1.2 * muzzleHeat));
  (barrel.muzzleGlow.material as MeshBasicMaterial).color.copy(hdr(ARC_BLUE, 0.8 * muzzleHeat));

  barrel.applyAtmosphere(cameraU);
}

function updateSky(dt: number, ctx: VisualContext, cameraU: number) {
  if (!barrel) return;
  barrel.sky.position.copy((ctx.camera as PerspectiveCamera).position);
  // Space only opens up once the payload actually clears the bore.
  const outside = MathUtils.clamp((cameraU - MUZZLE_U * 0.985) / Math.max(0.001, 1 - MUZZLE_U * 0.985), 0, 1);
  const target = ctx.running ? outside : 0;
  barrel.starMaterial.opacity += (target - barrel.starMaterial.opacity) * Math.min(1, dt * 3.5);
  barrel.beaconMaterial.opacity += (target * 0.9 - barrel.beaconMaterial.opacity) * Math.min(1, dt * 3.5);
}

function updatePostUniforms(dt: number, ctx: VisualContext, charge: number) {
  const chargeTarget = ctx.running ? charge * 0.5 : 0;
  chargeUniform.value += (chargeTarget - chargeUniform.value) * Math.min(1, dt * 1.6);

  const warpTarget = firedAt >= 0 ? Math.min(1, (elapsedNow - firedAt) * 2.2) : 0;
  warpUniform.value += (warpTarget - warpUniform.value) * Math.min(1, dt * 5);

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 1 ? 2.2 : 2.8));
  if (burstAt >= 0 && elapsedNow - burstAt < 0.7) {
    flashUniform.value = Math.max(flashUniform.value, 0.8 * (1 - (elapsedNow - burstAt) / 0.7));
  }
}

function updateTargets(dt: number, ctx: VisualContext) {
  const camera = ctx.camera as PerspectiveCamera;

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, (elapsedNow - record.bornAt) / 0.32)));

    tintTarget(record, camera);

    if (record.mesh.userData.isHostileShot) dropTrail(record.mesh.position, hdr(FAULT_RED, 1.1), 1.1);

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar((1 + Math.sin(elapsedNow * 11) * 0.05) * 1.85 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, hdr(ARC_CYAN, 1.3));
  }

  const spinner = findReticleSpinner(ctx.scene);
  if (!spinner) return;
  const active = spinner.parent?.userData.active === true;
  spinner.rotation.z += dt * (active ? -3.4 : -0.9);
  const jaws = spinner.parent?.userData.jaws as Group | undefined;
  if (jaws) jaws.rotation.z += dt * (active ? 1.8 : 0.5);
}

function tintTarget(record: EnemyRecord, camera: PerspectiveCamera) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff keeps far additive stacks from blobbing under bloom.
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smoothstep(1 - MathUtils.clamp((distance - 14) / 46, 0, 1));
  const locked = userData.locked === true;
  const damaged = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const charging = userData.charging === true;
  const strain = (userData.strain as number | undefined) ?? 0;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_EDGE);
      continue;
    }
    if (damaged) {
      part.material.color.copy(hdr(WHITE_HOT, part.kind === 'fill' ? 0.7 : 2.1));
      continue;
    }
    if (locked) {
      // A locked target already belongs to the gun: it goes electric.
      if (part.kind === 'edge') part.material.color.copy(hdr(WHITE_HOT, 1.8));
      else if (part.kind === 'fill') part.material.color.copy(ARC_BLUE.clone().multiplyScalar(0.4));
      else part.material.color.copy(hdr(ARC_CYAN, 2.2));
      continue;
    }
    let level = part.kind === 'edge'
      ? 0.5 + 0.5 * closeness
      : part.kind === 'fill' ? 0.34 + 0.66 * closeness : 0.4 + 0.6 * closeness;
    // A sentry winding up, or an interlock straining against the charge, burns.
    if (part.kind === 'core') {
      if (charging) level *= 1.7 + Math.sin(elapsedNow * 34) * 0.4;
      if (strain > 0) level *= 1 + strain * (1.6 + Math.sin(elapsedNow * (9 + strain * 30)) * 0.9);
    }
    part.material.color.copy(part.base).multiplyScalar(level);
  }
}

// ---- camera -----------------------------------------------------------------

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  // FOV is the accelerometer: it opens as the coils bite harder, kicks on the
  // beat, and blows wide at the muzzle.
  const target = (speed - 0.9) * 7.5 + beatEnergy * 1.1 + surge * 11;
  cameraFov = MathUtils.lerp(cameraFov, target, Math.min(1, dt * 5.5));
  ctx.feel.setFovOffset(cameraFov);

  if (ctx.running) {
    // A slow roll about the bore axis. The barrel is turning, not the payload,
    // but from inside there is no difference — and it keeps a straight tube from
    // reading as a still image. Small enough that aiming stays honest.
    const targetRoll = Math.sin(runTime * 0.21) * 0.055 + beatEnergy * 0.006;
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 2.4);
    ctx.camera.rotateZ(cameraRoll);
  }

  ctx.feel.update(dt, { shake: SHAKE });
}

// ---- helpers ----------------------------------------------------------------

function makeLockRing(color: Color): Group {
  const group = new Group();
  // Hex clamp, six-fold like the coils: the gun closing on a target.
  group.add(new Mesh(
    new RingGeometry(0.84, 0.9, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 2.0), side: DoubleSide }),
  ));
  group.add(new Mesh(
    new TorusGeometry(0.66, 0.022, 3, 6),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(MAGENTA, 0.3), 1.5), side: DoubleSide }),
  ));
  return group;
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
