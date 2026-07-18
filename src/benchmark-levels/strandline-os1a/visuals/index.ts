import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  ADRIFT_TIME,
  STRANDLINE_DURATION,
  STRANDLINE_PLAYER_HEALTH,
  createStrandlineRail,
  speedFactorAt,
  strandlineRunProgress,
} from '../gameplay';
import {
  createBroodMesh,
  createClingMesh,
  createLarvaMesh,
  createParentMesh,
  createSpitterMesh,
  createSporeMesh,
  updateBroodMesh,
  updateClingMesh,
  updateLarvaMesh,
  updateParentMesh,
  updateSporeMesh,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstMotes,
  burstShards,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnHusk,
  spawnRing,
  spawnStrandFlash,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, pulseLetter, setLetterDenied, setLetterLocked } from './letters';
import {
  JELLY_GOLD,
  JELLY_GREEN,
  LOCK_GRADIENT,
  PARASITE_DARK,
  PARASITE_PALE,
  PARASITE_VIOLET,
  PLAYER_GOLD,
  PLAYER_WHITE,
  hdr,
} from './palette';
import { bloomLightUniform, causticUniform, clarityUniform, infectionUniform } from './post-fx';

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

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

const DENY_VIOLET = new Color(1.4, 0.25, 1.7);
const DENY_SHELL = new Color(0.32, 0.05, 0.4);
/** Locked targets take on the animal's colour: already dealt with. */
const LOCKED_SHELL = new Color(0.1, 0.34, 0.24);

const STRANDLINE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.5,
  frequency: 6.5,
  smoothing: 16,
};

let environment: Environment | null = null;
let beatEnergy = 0;
let contraction = 0;
let surge = 0;
let flash = 0;
let elapsedNow = 0;
let hitsTaken = 0;
let damagePulse = 0;
let cleanTarget = 0;
let clean = 0;
let killCount = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;

const rail = createStrandlineRail();
const scratch = new Vector3();
const scratchB = new Vector3();
const scratchC = new Vector3();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
  // Bracket geometry is shared, so a detach may only release its materials.
  disposeAdornment: disposeMaterialsOnly,
});

function disposeMaterialsOnly(object: Group) {
  object.traverse((child) => {
    const material = (child as { material?: Material | Material[] }).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
  });
}

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

const KIND_SCALE: Record<string, number> = {
  cling: 1.3,
  larva: 1.5,
  spitter: 1.1,
  spore: 1.3,
};

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemyMesh(kind, letter);
  // Wrap so the spawn scale-in animates the outer group while the inner one
  // holds each silhouette's readability scale.
  const scale = KIND_SCALE[kind] ?? 1;
  let mesh = built;
  if (scale !== 1) {
    built.scale.setScalar(scale);
    mesh = new Group();
    mesh.add(built);
    mesh.userData = built.userData;
  }
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'cling':
      return createClingMesh();
    case 'larva':
      return createLarvaMesh();
    case 'spitter':
      return createSpitterMesh();
    case 'spore':
      return createSporeMesh();
    case 'brood':
      return createBroodMesh();
    case 'parent':
      return createParentMesh();
    default:
      return createClingMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.55;
  spawnRing(mesh.position, DENY_VIOLET.clone(), 2.6, 0.34);
}

// The player's shot is the one cold, clean thing in the water: a white-gold
// dart with no violet in it anywhere.
const shotCoreGeometry = new OctahedronGeometry(0.28, 0).scale(0.5, 0.5, 2.4);
const shotHaloGeometry = new OctahedronGeometry(0.46, 0).scale(0.6, 0.6, 2.0);

export function createProjectileMesh() {
  const group = new Group();
  group.add(new Mesh(shotCoreGeometry, new MeshBasicMaterial({ color: hdr(PLAYER_WHITE, 2.4) })));
  group.add(new Mesh(shotHaloGeometry, createAdditiveBasicMaterial({ color: hdr(PLAYER_GOLD, 0.9), opacity: 0.55 })));
  projectileRecords.enqueue({ mesh: group, trailColor: PLAYER_GOLD.clone().multiplyScalar(0.65) });
  return group;
}

// ---- reticle -------------------------------------------------------------------

const RETICLE_PETALS = 6;

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  // A photophore sight: soft outer ring, a hexagonal iris, and six petals that
  // light one at a time as the volley charges — the lock count is readable
  // without ever looking away from the target.
  const outer = new Mesh(new RingGeometry(0.58, 0.605, 40), new MeshBasicMaterial());
  addPart(outer, hdr(JELLY_GREEN, 0.9));

  const iris = new Group();
  const inner = new Mesh(new RingGeometry(0.24, 0.28, 6), new MeshBasicMaterial());
  addPart(inner, hdr(JELLY_GOLD, 0.85));
  iris.add(inner);

  const petals = new Group();
  const petalMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < RETICLE_PETALS; i += 1) {
    const petal = new Mesh(new PlaneGeometry(0.1, 0.24), new MeshBasicMaterial());
    const material = configureAdditiveMaterial(petal.material as MeshBasicMaterial, {
      color: hdr(JELLY_GREEN, 0.2),
      side: DoubleSide,
    });
    petalMaterials.push(material);
    const angle = (i / RETICLE_PETALS) * Math.PI * 2 - Math.PI / 2;
    petal.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    petal.rotation.z = angle + Math.PI / 2;
    petals.add(petal);
  }

  const bead = new Mesh(new CircleGeometry(0.04, 12), new MeshBasicMaterial());
  addPart(bead, hdr(PLAYER_WHITE, 1.8));

  group.add(outer, iris, petals, bead);
  group.userData.parts = parts;
  group.userData.iris = iris;
  group.userData.petals = petals;
  group.userData.petalMaterials = petalMaterials;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.5 : 1.2));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
  const petalMaterials = reticle.userData.petalMaterials as MeshBasicMaterial[] | undefined;
  if (!petalMaterials) return;
  for (const [index, material] of petalMaterials.entries()) {
    const lit = index < lockCount;
    const colour = lit ? colorForLockCount(index + 1, LOCK_GRADIENT) : JELLY_GREEN;
    material.color.copy(hdr(colour, lit ? 1.7 : 0.18));
  }
}

// ---- event wiring ----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'parent') {
      // Something the size of a building unfolds out of the crown.
      cameraFeel.shake(1.0, STRANDLINE_SHAKE);
      surge = Math.max(surge, 0.55);
      flash = Math.max(flash, 0.3);
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 1.1), 90, 1.1);
      spawnRing(worldPosition, hdr(PARASITE_PALE, 0.8), 46, 0.8);
    } else if (kind === 'brood') {
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 1.1), 9, 0.55);
      surge = Math.max(surge, 0.25);
    } else if (kind === 'spitter') {
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 0.9), 4.2, 0.4);
    } else if (kind !== 'spore') {
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 0.5), 2.4, 0.32);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockBracket(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.2), 2.1, 0.28);
    if (lockCount >= 6) {
      // Six: the water itself answers.
      flash = Math.max(flash, 0.14);
      spawnRing(worldPosition, hdr(PLAYER_WHITE, 1.0), 6.5, 0.4);
    }
  });

  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.lockRing) spawnGlint(worldPosition, hdr(JELLY_GREEN, 0.7), 0.5, 0.13);
    lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(PLAYER_WHITE, 1.0), 0.55, 0.13);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstMotes(worldPosition, hdr(PLAYER_GOLD, 0.7), 5, 4.5);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.28;
      spawnGlint(worldPosition, hdr(PLAYER_WHITE, 1.5), 0.9, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.isParent) {
      cameraFeel.shake(1.0, STRANDLINE_SHAKE);
      surge = Math.max(surge, 0.5);
      flash = Math.max(flash, 0.28);
      spawnRing(worldPosition, hdr(PARASITE_PALE, 1.3), 70, 0.9);
      burstMotes(worldPosition, hdr(PARASITE_VIOLET, 1.0), 34, 16, 3);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    killCount += 1;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs);
    const accent = (record.mesh.userData.accent as Color | undefined) ?? PARASITE_VIOLET;
    burstMotes(worldPosition, hdr(accent, 0.8), 8, 6);
    spawnGlint(worldPosition, hdr(PLAYER_WHITE, 1.4), 1.0, 0.16);

    if (record.mesh.userData.isParent) {
      // Severance. The whole animal answers at once.
      cameraFeel.shake(1.6, STRANDLINE_SHAKE);
      surge = 1;
      flash = Math.max(flash, 1);
      cleanTarget = 1;
      spawnRing(worldPosition, hdr(JELLY_GREEN, 1.5), 220, 1.8);
      spawnRing(worldPosition, hdr(JELLY_GOLD, 1.2), 130, 1.3);
      spawnRing(worldPosition, hdr(PARASITE_PALE, 0.9), 70, 0.9);
      spawnGlint(worldPosition, hdr(JELLY_GREEN, 2.2), 22, 0.6);
      burstMotes(worldPosition, hdr(PARASITE_VIOLET, 1.1), 70, 26, 4);
      spawnHusk(worldPosition, 5.5, new Vector3(3, -4, 6));
    } else if (record.mesh.userData.isBrood) {
      // A panel of webbing loses its supply. The clean-up is visible.
      cameraFeel.shake(0.55, STRANDLINE_SHAKE);
      cleanTarget = Math.min(0.75, cleanTarget + 0.16);
      flash = Math.max(flash, 0.2);
      spawnRing(worldPosition, hdr(JELLY_GREEN, 1.3), 26, 0.8);
      spawnRing(worldPosition, hdr(PARASITE_PALE, 1.0), 14, 0.55);
      burstMotes(worldPosition, hdr(PARASITE_PALE, 0.9), 30, 12, 3);
      spawnHusk(worldPosition, 1.6, new Vector3(1, -2, 2));
    } else if (record.mesh.userData.kind !== 'spore' && record.mesh.userData.kind !== 'letter') {
      // The signature: the strand this thing was gripping comes back on.
      spawnStrandFlash(worldPosition, hdr(JELLY_GREEN, 1.1), 22 + (enemyId % 7) * 1.8, 0.5);
      spawnRing(worldPosition, hdr(JELLY_GREEN, 0.9), 5.5, 0.42);
      cleanTarget = Math.max(cleanTarget, Math.min(0.34, killCount * 0.0055));
      if (record.mesh.userData.kind === 'spitter') spawnHusk(worldPosition, 1.1, new Vector3(0.8, -1.6, 1.4));
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    // Something got past you: a small violet stain left in the water.
    burstMotes(worldPosition, PARASITE_DARK.clone().multiplyScalar(2.2), 4, 2.4, 2.6);
  });

  bus.on('reject', () => {
    // The animal flinches: violet floods in from the frame edge for a moment.
    damagePulse = Math.max(damagePulse, 0.55);
    cameraFeel.shake(0.35, STRANDLINE_SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.6);
      flash = Math.max(flash, 0.2);
      contraction = 1;
    }
  });

  bus.on('beat', ({ beatNumber, isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
    // The bell pulses every other beat — a real jellyfish cadence sitting on
    // the transport, so the animal is visibly keeping time with the score.
    if (beatNumber % 2 === 0) contraction = 1;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    beatEnergy = 1.4;
    cameraFeel.shake(1.2, STRANDLINE_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    if (environment) for (const tether of environment.tethers) tether.visible = false;
    flash = 0;
    surge = 0;
    hitsTaken = 0;
    damagePulse = 0;
    cleanTarget = 0;
    clean = 0;
    killCount = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame update ---------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.6);
  // Jellyfish pulse: instant squeeze, long relax.
  contraction = Math.max(0, contraction - dt * 1.35);
  surge = Math.max(0, surge - dt * 0.9);
  damagePulse = Math.max(0, damagePulse - dt * 1.3);
  flash = Math.max(0, flash - dt * (flash > 0.7 ? 1.4 : 2.2));
  clean += (cleanTarget - clean) * Math.min(1, dt * 1.1);

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? strandlineRunProgress(runTime) : 0;
  const adrift = ctx.running ? MathUtils.clamp((runTime - ADRIFT_TIME) / (STRANDLINE_DURATION - ADRIFT_TIME), 0, 1) : 0;

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    progress,
    beatEnergy,
    contraction,
    clean: Math.max(clean, adrift * 0.3),
  });

  // Screen layer. Caustics never stop — this is water, not a light show.
  causticUniform.value = ctx.elapsed * 0.45;
  bloomLightUniform.value = flash;
  infectionUniform.value = Math.min(1, damagePulse * 0.75 + Math.min(1, hitsTaken / STRANDLINE_PLAYER_HEALTH) * 0.1);
  clarityUniform.value = adrift * (0.4 + clean * 0.6);

  updateEnemyRecords(dt, ctx);
  updateProjectileRecords();
  updateReticleSpin(dt, ctx.scene);
  updateEffects(dt, ctx.camera);
}

function updateEnemyRecords(dt: number, ctx: VisualContext) {
  const camera = ctx.camera as PerspectiveCamera;
  let tetherCursor = 0;
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Visuals own the scale only through the spawn-in; after that the gameplay
    // layer is free to drive it.
    if (age < 0.45) record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.45)));

    updateEnemyTint(record, camera);

    const kind = record.mesh.userData.kind as string | undefined;
    if (kind === 'cling') updateClingMesh(record.mesh, elapsedNow);
    else if (kind === 'larva') updateLarvaMesh(record.mesh, elapsedNow);
    else if (kind === 'spore') updateSporeMesh(record.mesh, elapsedNow);
    else if (kind === 'brood') updateBroodMesh(record.mesh, elapsedNow);
    else if (kind === 'parent') updateParentMesh(record.mesh, elapsedNow, dt);
    else if (kind === 'letter') pulseLetter(record.mesh, elapsedNow, enemyId);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    // Brood umbilicals: a taut violet line back into the crown, so it is never
    // a mystery which webbing panel a brood is keeping alive.
    const tetherTo = record.mesh.userData.tetherTo as Vector3 | undefined;
    if (tetherTo && environment && tetherCursor < environment.tethers.length) {
      drawTether(environment.tethers[tetherCursor], record.mesh.position, tetherTo, camera);
      tetherCursor += 1;
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 1.4;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  if (environment) {
    for (let i = tetherCursor; i < environment.tethers.length; i += 1) environment.tethers[i].visible = false;
  }
}

/** Stretches a billboarded ribbon between two world points. */
function drawTether(tether: Mesh, from: Vector3, to: Vector3, camera: PerspectiveCamera) {
  scratch.copy(to).sub(from);
  const length = scratch.length();
  if (length < 1) {
    tether.visible = false;
    return;
  }
  tether.visible = true;
  tether.position.copy(from).addScaledVector(scratch, 0.5);
  tether.quaternion.copy(camera.quaternion);
  // Roll the ribbon so its long axis lies along the screen-space line.
  scratchB.copy(to).project(camera);
  scratchC.copy(from).project(camera);
  const aspect = camera.aspect || 1;
  tether.rotateZ(Math.atan2(scratchB.y - scratchC.y, (scratchB.x - scratchC.x) * aspect) - Math.PI / 2);
  tether.scale.set(0.5, length, 1);
}

function updateProjectileRecords() {
  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }
}

function updateReticleSpin(dt: number, scene: Scene) {
  for (const child of scene.children) {
    const iris = child.userData.iris as Group | undefined;
    if (!iris) continue;
    const active = child.userData.active === true;
    iris.rotation.z += dt * (active ? 2.6 : 0.6);
    const petals = child.userData.petals as Group | undefined;
    if (petals) petals.rotation.z -= dt * (active ? 0.9 : 0.25);
    return;
  }
}

function updateEnemyTint(record: EnemyRecord, camera: PerspectiveCamera) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff keeps far additive stacks from piling into a haze.
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smoothstep(1 - clamp01((distance - 14) / (90 - 14)));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'shell' ? DENY_SHELL : DENY_VIOLET);
      continue;
    }
    if (locked) {
      if (part.kind === 'rim') part.material.color.copy(hdr(JELLY_GOLD, 1.5));
      else if (part.kind === 'shell') part.material.color.copy(LOCKED_SHELL);
      else part.material.color.copy(hdr(PLAYER_WHITE, 1.9));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(PLAYER_WHITE, part.kind === 'shell' ? 0.55 : 1.7));
      continue;
    }
    const dim = part.kind === 'shell' ? 0.6 + 0.4 * closeness : 0.42 + 0.58 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  if (ctx.running) {
    // Bank. The two lifts are hard banks by design, so the roll is generous —
    // it is most of what makes threading the strands feel like flying.
    const u = strandlineRunProgress(runTime, STRANDLINE_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.008, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 34, -0.3, 0.3);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.4);
    camera.rotateZ(cameraRoll);
    // A slow swimming drift, always present. The camera is in water.
    camera.rotateZ(Math.sin(runTime * 0.42) * 0.012);
    camera.rotateX(Math.sin(runTime * 0.31 + 1.1) * 0.008);
  }

  // The last two bars: the camera stops holding on. It falls away from the
  // animal and the lens opens, and for the first time the whole thing fits.
  const adrift = ctx.running ? MathUtils.clamp((runTime - ADRIFT_TIME) / (STRANDLINE_DURATION - ADRIFT_TIME), 0, 1) : 0;
  if (adrift > 0) {
    const pull = adrift * adrift * (3 - 2 * adrift);
    camera.getWorldDirection(scratch);
    camera.position.addScaledVector(scratch, -430 * pull);
    // Drift a little below the crown so the bell rises into the frame.
    camera.position.y -= 26 * pull;
  }

  const targetFov = (speed - 0.95) * 6.5 + beatEnergy * 0.9 + surge * 7 + adrift * 26;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFov, Math.min(1, dt * 5));
  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: STRANDLINE_SHAKE });
}

// Lock-ring geometry is identical every time; only the colour changes, so it
// is built once and shared across every bracket the run creates.
const lockRingGeometry = new TorusGeometry(0.7, 0.028, 5, 40);
const lockBeadGeometry = (() => {
  const beads: BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const bead = new SphereGeometry(0.075, 6, 5);
    bead.applyMatrix4(new Matrix4().makeTranslation(Math.cos(angle) * 0.7, Math.sin(angle) * 0.7, 0));
    beads.push(bead);
  }
  const geometry = mergeGeometries(beads);
  for (const bead of beads) bead.dispose();
  return geometry;
})();

function makeLockBracket(color: Color): Group {
  const group = new Group();
  // Not a bracket: a ring of the animal's own photophores closing around the
  // target. Locking looks like the jellyfish deciding, not like a HUD.
  group.add(new Mesh(lockRingGeometry, createAdditiveBasicMaterial({ color: hdr(color, 1.6) })));
  group.add(new Mesh(lockBeadGeometry, createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(PLAYER_WHITE, 0.45), 1.8) })));
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
