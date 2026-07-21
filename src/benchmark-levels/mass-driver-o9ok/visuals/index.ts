import {
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Fog,
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
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  configureAdditiveMaterial,
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  barrelBreached,
  chargeProgress,
  createMassDriverRail,
  gunFired,
  massDriverRunProgress,
  speedFactorAt,
} from '../gameplay';
import { CHARGE_TIME, FIRE_TIME, MD_BEAT, MD_DURATION, MD_MUZZLE_BEAT } from './../timing';
import {
  breakArmour,
  createBulwarkMesh,
  createDarterMesh,
  createInterlockMesh,
  createSentryMesh,
  createWeaverMesh,
  type ShardSpec,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  setEffectWash,
  spawnArc,
  spawnFlash,
  spawnRing,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  ARC_BLUE,
  BARREL_HAZE,
  CHARGE_HAZE,
  coilHeatColor,
  DRONE_AMBER,
  GUN_STEEL,
  hdr,
  INTERLOCK_WARN,
  LOCK_GRADIENT,
  VIOLET,
  VOID,
  WHITE_ARC,
} from './palette';
import { chargeUniform, flashTintUniform, flashUniform } from './post-fx';

// The whole look hangs off one rule: a coil lights when the payload crosses it,
// and the payload crosses one coil per beat. Nothing here listens for a beat
// event to do that — the strobe falls out of run time and the coil's own beat
// index, so it can never drift from the music no matter how the speed profile
// bends underneath it.

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

// ---- coil strobe tuning ---------------------------------------------------------
/** Coils held live ahead of the payload, in beats. Past this they are in fog. */
const COIL_WINDOW_AHEAD = 46;
const COIL_WINDOW_BEHIND = 3;
/** Width of the pass flash in seconds. Well under a sixteenth: a strobe, not a glow. */
const PASS_SIGMA = 0.085;
const PASS_GAIN = 2.7;
/** Resting brightness of a coil nobody is passing through. */
const IDLE_GAIN = 0.5;

const DENY_RED = new Color(1.7, 0.24, 0.08);
const DENY_FILL = new Color(0.26, 0.03, 0.01);
const LOCKED_EDGE = hdr(WHITE_ARC, 1.5);
const LOCKED_FILL = new Color(0.1, 0.12, 0.26);
const LOCKED_CORE = hdr(WHITE_ARC, 2.4);
const PROJECTILE_TRAIL = WHITE_ARC.clone().multiplyScalar(0.85);
const BACKDROP = BARREL_HAZE.clone().multiplyScalar(0.25);

const MD_SHAKE: CameraFeelShakeOptions = {
  decay: 2.9,
  maxTrauma: 1.7,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 11,
  smoothing: 24,
};

let environment: Environment | null = null;
let beatEnergy = 0;
let cameraFovOffset = 0;
let cameraRoll = 0;
let surge = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let fireFlare = 0;
let breachFlare = 0;

const coilColor = new Color();
const scratchRadial = new Vector3();
const scratchTarget = new Vector3();
const fogColor = new Color();
const backdropTarget = new Color();
const rail = createMassDriverRail();

// Projectiles and lock rings are the two things this level builds dozens of
// times a run, so their geometry is built once and shared. Only materials are
// per-instance, and only materials get disposed.
const PROJECTILE_CORE_GEOMETRY = (() => {
  const geometry = new OctahedronGeometry(0.3, 0);
  geometry.scale(0.42, 0.42, 2.6);
  return geometry;
})();
const PROJECTILE_SHELL_GEOMETRY = (() => {
  const geometry = new CylinderGeometry(0.34, 0.05, 1.9, 6, 1, true);
  geometry.rotateX(Math.PI / 2);
  return geometry;
})();
const LOCK_RING_GEOMETRY = (() => {
  // Hex clamp plus an inner bore line, merged: a lock is one draw call, and a
  // full six-target bank costs six rather than twelve.
  const outer = new RingGeometry(0.9, 0.97, 6).rotateZ(Math.PI / 6).toNonIndexed();
  const inner = new RingGeometry(0.66, 0.7, 24).toNonIndexed();
  for (const geometry of [outer, inner]) {
    geometry.deleteAttribute('uv');
    geometry.deleteAttribute('normal');
  }
  const merged = mergeGeometries([outer, inner], false);
  outer.dispose();
  inner.dispose();
  if (!merged) throw new Error('Mass Driver lock ring failed to merge');
  return merged;
})();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
  // The default disposer would take the shared ring geometry with it.
  disposeAdornment: (ring) => {
    for (const child of ring.children) ((child as Mesh).material as MeshBasicMaterial).dispose();
  },
});

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
  restCoils();
  return environment.root;
}

// ---- target meshes -----------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'O');
    case 'sentry':
      return createSentryMesh();
    case 'weaver':
      return createWeaverMesh();
    case 'bulwark':
      return createBulwarkMesh();
    case 'darter':
      return createDarterMesh();
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
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RED.clone(), 3.2, 0.32);
}

/** Player shot: a slug of the gun's own current, thrown ahead of the payload. */
export function createProjectileMesh() {
  const group = new Group();
  const coreMaterial = new MeshBasicMaterial({ color: hdr(WHITE_ARC, 2.4) });
  coreMaterial.toneMapped = false;
  group.add(new Mesh(PROJECTILE_CORE_GEOMETRY, coreMaterial));

  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(VIOLET, 0.9), opacity: 0.55, side: DoubleSide });
  shellMaterial.toneMapped = false;
  group.add(new Mesh(PROJECTILE_SHELL_GEOMETRY, shellMaterial));

  projectileRecords.enqueue({ mesh: group, trailColor: PROJECTILE_TRAIL.clone() });
  return group;
}

// ---- reticle -------------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    material.toneMapped = false;
    parts.push({ material, base });
    return mesh;
  };

  // Hex sight: the bore, seen from inside it.
  const outer = new Mesh(new RingGeometry(0.66, 0.7, 6), new MeshBasicMaterial());
  outer.rotation.z = Math.PI / 6;
  addPart(outer, hdr(ARC_BLUE, 1.1));

  // Breech jaws: four brackets that walk inward as the capacitor bank fills.
  const jaws = new Group();
  for (let index = 0; index < 4; index += 1) {
    const jaw = new Mesh(new PlaneGeometry(0.26, 0.05), new MeshBasicMaterial());
    addPart(jaw, hdr(ARC_BLUE, 1.4));
    jaw.userData.angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    jaws.add(jaw);
  }

  const spinner = new Mesh(new RingGeometry(0.4, 0.435, 3), new MeshBasicMaterial());
  addPart(spinner, hdr(VIOLET, 1.0));

  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(WHITE_ARC, 1.9));

  group.add(outer, jaws, spinner, dot);
  group.userData.parts = parts;
  group.userData.jaws = jaws;
  group.userData.spinner = spinner;
  group.userData.active = false;
  group.userData.raildReticle = true;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));

  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.8 : 1.35));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.4 : 1);
  }

  // The jaws close one notch per lock; at six they are shut on the bore.
  const jaws = reticle.userData.jaws as Group;
  const radius = MathUtils.lerp(0.98, 0.6, MathUtils.clamp(lockCount / 6, 0, 1));
  for (const jaw of jaws.children) {
    const angle = jaw.userData.angle as number;
    jaw.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    jaw.rotation.z = angle + Math.PI / 2;
  }
}

// ---- event wiring ----------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  /** Throws a discharge between a world point and the bore wall: the gun noticing. */
  const arcToBore = (worldPosition: Vector3, color: Color, count: number, life = 0.16, width = 0.42) => {
    if (!environment) return;
    const coils = environment.coils;
    const nearest = nearestCoilIndex(worldPosition);
    for (let index = 0; index < count; index += 1) {
      const coil = MathUtils.clamp(nearest + Math.round((index - (count - 1) / 2) * 2), 0, coils.count - 1);
      coils.centre(coil, scratchTarget);
      // Land the arc on the bore wall nearest the target, not on the bore axis.
      scratchRadial.copy(worldPosition).sub(scratchTarget);
      if (scratchRadial.lengthSq() > 0.001) scratchTarget.addScaledVector(scratchRadial.normalize(), 14.2);
      spawnArc(worldPosition, scratchTarget, color, life * (0.7 + Math.random() * 0.6), width);
    }
  };

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'interlock') {
      // A jammed interlock announces itself by welding to the barrel.
      cameraFeel.shake(0.5, MD_SHAKE);
      surge = Math.max(surge, 0.4);
      spawnRing(worldPosition, hdr(INTERLOCK_WARN, 1.2), 16, 0.7);
      spawnRing(worldPosition, hdr(VIOLET, 0.9), 9, 0.5);
      arcToBore(worldPosition, hdr(INTERLOCK_WARN, 1.4), 4, 0.34, 0.75);
    } else if (kind === 'darter') {
      spawnFlash(worldPosition, hdr(DRONE_AMBER, 1.4), 1.1, 0.14);
    } else if (kind !== 'letter') {
      spawnRing(worldPosition, hdr(DRONE_AMBER, 0.7), 2.6, 0.34);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.5), 2.4, 0.24);
    // Marking a target earths it to the barrel: one discharge per lock.
    arcToBore(worldPosition, hdr(lockColor, 1.1), 1, 0.13, 0.3);
    if (lockCount >= 6) {
      spawnFlash(worldPosition, hdr(WHITE_ARC, 2.0), 2.4, 0.2);
      flashUniform.value = Math.max(flashUniform.value, 0.1);
      flashTintUniform.value.set(0.9, 0.86, 1.0);
    }
  });

  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
    spawnFlash(worldPosition, hdr(ARC_BLUE, 0.5), 0.7, 0.1);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnFlash(worldPosition, hdr(WHITE_ARC, 1.4), 0.8, 0.11);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(WHITE_ARC, 0.8), 7, 13);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnFlash(worldPosition, hdr(WHITE_ARC, 1.6), 1.0, 0.14);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (record.mesh.userData.isInterlock) {
      breakArmour(record.mesh);
      cameraFeel.shake(0.55, MD_SHAKE);
      if (specs) burstShards(worldPosition, specs.slice(0, 8));
      spawnRing(worldPosition, hdr(INTERLOCK_WARN, 1.4), 10, 0.5);
      arcToBore(worldPosition, hdr(WHITE_ARC, 1.3), 5, 0.26, 0.7);
    } else {
      breakArmour(record.mesh);
      if (specs) burstShards(worldPosition, specs.slice(0, 5));
      burstSparks(worldPosition, hdr(DRONE_AMBER, 1.0), 14, 15);
      spawnRing(worldPosition, hdr(DRONE_AMBER, 1.2), 5.5, 0.42);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? DRONE_AMBER;

    if (record.mesh.userData.isInterlock) {
      // An interlock going down dumps its whole charge into the barrel.
      cameraFeel.shake(1.15, MD_SHAKE);
      surge = Math.max(surge, 0.8);
      flashUniform.value = Math.max(flashUniform.value, 0.55);
      flashTintUniform.value.set(0.85, 0.78, 1.0);
      if (specs) burstShards(worldPosition, specs);
      burstSparks(worldPosition, hdr(WHITE_ARC, 1.2), 48, 30);
      spawnRing(worldPosition, hdr(WHITE_ARC, 1.5), 34, 0.8);
      spawnRing(worldPosition, hdr(VIOLET, 1.2), 20, 0.6);
      spawnFlash(worldPosition, hdr(WHITE_ARC, 2.6), 6, 0.35);
      arcToBore(worldPosition, hdr(WHITE_ARC, 1.6), 5, 0.42, 1.1);
    } else {
      if (specs) burstShards(worldPosition, specs);
      burstSparks(worldPosition, hdr(accent, 0.9), 12, 17);
      spawnRing(worldPosition, hdr(accent, 0.9), 4.4, 0.36);
      spawnFlash(worldPosition, hdr(WHITE_ARC, 1.7), 1.3, 0.17);
      arcToBore(worldPosition, hdr(accent, 0.8), 1, 0.15, 0.45);
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemyRecords.delete(enemyId, { dispose: true });
    // A drone that gets past you does not explode; it just goes dark behind you.
    burstSparks(worldPosition, GUN_STEEL.clone().multiplyScalar(1.6), 4, 5, 44);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.6);
      surge = Math.max(surge, size >= 6 ? 0.55 : 0.35);
      flashUniform.value = Math.max(flashUniform.value, size >= 6 ? 0.3 : 0.16);
      flashTintUniform.value.set(0.9, 0.86, 1.0);
    }
  });

  bus.on('reject', ({ enemyIds }) => {
    // The breech will not seat: fault red, and the current has to go somewhere.
    flashUniform.value = Math.max(flashUniform.value, 0.18);
    flashTintUniform.value.set(1.0, 0.24, 0.1);
    cameraFeel.shake(0.3, MD_SHAKE);
    for (const enemyId of enemyIds.slice(0, 3)) {
      const record = enemyRecords.get(enemyId);
      if (record) arcToBore(record.mesh.position, DENY_RED, 2, 0.2, 0.5);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.6;
    cameraFeel.shake(1.25, MD_SHAKE);
    flashUniform.value = Math.max(flashUniform.value, 0.3);
    flashTintUniform.value.set(1.0, 0.2, 0.1);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    chargeUniform.value = 0;
    flashUniform.value = 0;
    flashTintUniform.value.set(1.0, 0.94, 1.0);
    surge = 0;
    fireFlare = 0;
    breachFlare = 0;
    lastRunTime = -1;
    restCoils();
  });

  bus.on('runend', ({ died }) => {
    resetCameraFeel(cameraFeel);
    if (died) breachFlare = 1;
  });
}

// ---- per-frame update ---------------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.4);
  surge = Math.max(0, surge - dt * 1.1);

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.46;
  const charge = ctx.running ? chargeProgress(runTime) : 0;

  updateSetPieceMoments(ctx);
  updateCoils(ctx, runTime, charge);
  updateBarrel(dt, ctx, runTime, charge);
  updatePostUniforms(dt, ctx, charge);
  updateTargets(dt, ctx);
  updateProjectiles();
  updateReticleSpin(dt, ctx.scene);

  setEffectWash(speed * 42);
  updateEffects(dt, ctx.camera);
}

/**
 * The coil strobe. Each coil's brightness is a Gaussian in *time* around the
 * beat the payload crosses it on, so the tunnel pulses exactly on the grid at
 * every speed and the strobe rate is the tempo by construction.
 */
function updateCoils(ctx: VisualContext, runTime: number, charge: number) {
  if (!environment) return;
  const coils = environment.coils;

  if (!ctx.running) {
    // Attract: the gun idles. A slow charge wave walks down the bore.
    const wave = ctx.elapsed * 5.5;
    for (let index = 0; index < Math.min(coils.count, COIL_WINDOW_AHEAD); index += 1) {
      const pulse = Math.max(0, Math.sin((index - wave) * 0.34)) ** 6;
      writeCoil(index, index / MD_MUZZLE_BEAT, IDLE_GAIN * 0.55 + pulse * 1.1, 0);
    }
    coils.commit();
    return;
  }

  const cameraBeat = runTime / MD_BEAT;
  const low = Math.max(0, Math.floor(cameraBeat) - COIL_WINDOW_BEHIND);
  const high = Math.min(coils.count - 1, Math.ceil(cameraBeat) + COIL_WINDOW_AHEAD);

  // The whole barrel runs hotter as the firing charge builds — but only up to a
  // point. A bore full of white coils is a white screen, and a white screen has
  // no targets in it; the charge is allowed to change the hue and lift the
  // resting current, not to take the frame.
  const chargeLift = charge * charge * 0.5 + fireFlare * 5;
  const chargeHeat = charge * 0.3 + fireFlare;

  for (let index = low; index <= high; index += 1) {
    const delta = runTime - index * MD_BEAT;
    const pass = Math.exp(-((delta / PASS_SIGMA) ** 2));
    // The current reaches a coil before the payload does, so a little of the
    // flash leaks forward down the barrel and never backward.
    const anticipation = delta < 0 ? Math.exp(-((delta / (PASS_SIGMA * 3.2)) ** 2)) * 0.28 : 0;
    writeCoil(index, index / MD_MUZZLE_BEAT + chargeHeat, IDLE_GAIN + chargeLift, pass * PASS_GAIN + anticipation);
  }
  coils.commit();
}

function writeCoil(index: number, heat: number, base: number, flash: number) {
  if (!environment) return;
  coilHeatColor(heat, coilColor);
  // Hue alone is not brightness: indigo reads darker than arc blue even though
  // it is further up the ramp. Carry a separate resting-current term so the
  // barrel gets visibly brighter the whole way down, not just bluer.
  const current = 0.8 + Math.min(1, Math.max(0, heat)) * 0.6;
  // The flash washes toward white: a coil at full current has no hue left.
  if (flash > 0.05) coilColor.lerp(WHITE_ARC, Math.min(0.85, flash * 0.34));
  const gain = base * current + flash;
  environment.coils.setColor(index, coilColor.r * gain, coilColor.g * gain, coilColor.b * gain);
}

/** Every coil back to its resting current — used at build and on run start. */
function restCoils() {
  if (!environment) return;
  for (let index = 0; index < environment.coils.count; index += 1) {
    writeCoil(index, index / MD_MUZZLE_BEAT, IDLE_GAIN, 0);
  }
  environment.coils.commit();
}

/** Barrel scenery, fog, the muzzle, and the open space past it. */
function updateBarrel(dt: number, ctx: VisualContext, runTime: number, charge: number) {
  if (!environment) return;
  const progress = ctx.running ? massDriverRunProgress(runTime) : 0;
  environment.conductors.update(progress, dt);
  environment.plating.update(progress, dt);
  environment.bracing.update(progress, dt);

  const escaped = fireFlare;

  // Fog: barrel haze warms into charge violet, then opens completely once the
  // payload leaves the muzzle and there is nothing left to be inside of.
  if (ctx.scene.fog instanceof Fog) {
    fogColor.copy(BARREL_HAZE).lerp(CHARGE_HAZE, charge).lerp(VOID, escaped);
    ctx.scene.fog.color.copy(fogColor);
    ctx.scene.fog.near = MathUtils.lerp(55, 220, escaped);
    ctx.scene.fog.far = MathUtils.lerp(MathUtils.lerp(330, 380, charge), 3000, escaped);
  }
  backdropTarget.copy(escaped > 0.02 ? VOID : BACKDROP);
  (ctx.scene.background as Color).lerp(backdropTarget, Math.min(1, dt * 1.6));

  // The muzzle: nearly black for most of the run, then the only thing in frame.
  const aperture = 0.05 + charge * 0.5 + escaped * 6;
  (environment.muzzleCore.material as MeshBasicMaterial).color.copy(WHITE_ARC).multiplyScalar(aperture);
  for (const [index, ring] of environment.muzzleRings.entries()) {
    const material = ring.material as MeshBasicMaterial;
    const pulse = 0.6 + Math.sin(ctx.elapsed * 3.4 - index * 0.7) * 0.2;
    material.color.copy(VIOLET)
      .lerp(WHITE_ARC, MathUtils.clamp(charge * 0.6 + escaped, 0, 1))
      .multiplyScalar((0.5 + charge * 1.6 + escaped * 4) * pulse);
    ring.scale.setScalar(1 + escaped * 0.8 + charge * 0.05);
  }

  // Stars only mean anything once you are outside; before that the fog eats them.
  environment.starMaterial.color.setRGB(0.5 + escaped * 1.4, 0.56 + escaped * 1.4, 0.72 + escaped * 1.4);
}

function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;

  if (crossed(CHARGE_TIME)) {
    // The safeties jam. The barrel starts winding up.
    ctx.feel.shake(0.7, MD_SHAKE);
    surge = Math.max(surge, 0.6);
    flashUniform.value = Math.max(flashUniform.value, 0.34);
    flashTintUniform.value.set(0.7, 0.4, 1.0);
  }

  if (crossed(FIRE_TIME)) {
    if (gunFired()) {
      // The shot. Everything in the barrel goes white, and then you are out.
      fireFlare = 1;
      ctx.feel.shake(1.7, MD_SHAKE);
      surge = 1.4;
      flashUniform.value = 1.5;
      flashTintUniform.value.set(1.0, 0.96, 1.0);
      if (environment) {
        spawnRing(environment.muzzlePosition, hdr(WHITE_ARC, 2.0), 130, 1.4);
        spawnRing(environment.muzzlePosition, hdr(VIOLET, 1.4), 80, 1.0);
      }
    } else if (barrelBreached()) {
      breachFlare = 1.6;
      ctx.feel.shake(1.8, MD_SHAKE);
      flashUniform.value = 1.3;
      flashTintUniform.value.set(1.0, 0.28, 0.08);
    }
  }

  lastRunTime = ctx.runTime;
}

function updatePostUniforms(dt: number, ctx: VisualContext, charge: number) {
  // The charge bloom is the countdown. It is deliberately capped well below a
  // whiteout: it has to read as pressure while the player is still picking
  // targets out of the bore.
  const resolved = gunFired() || barrelBreached();
  const target = ctx.running && !resolved ? charge ** 2 * 0.5 : 0;
  chargeUniform.value += (target - chargeUniform.value) * Math.min(1, dt * (resolved ? 1.2 : 2.4));

  if (fireFlare > 0) {
    // Hold the whiteout for a beat, then let the sky go black and quiet.
    fireFlare = Math.max(0, fireFlare - dt * 0.55);
    chargeUniform.value = Math.max(chargeUniform.value, fireFlare * 0.55);
  }
  if (breachFlare > 0) {
    // A breach keeps a dying red glow rather than the gun's violet: the charge
    // did go somewhere, just not out of the muzzle.
    breachFlare = Math.max(0, breachFlare - dt * 0.5);
    flashUniform.value = Math.max(flashUniform.value, breachFlare * 0.35);
    flashTintUniform.value.set(1.0, 0.26, 0.09);
  }

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.1 : 2.6));
}

function updateTargets(dt: number, ctx: VisualContext) {
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const baseScale = (record.mesh.userData.baseScale as number | undefined) ?? 1;
    record.mesh.scale.setScalar(baseScale * easeOutBack(Math.min(1, age / 0.34)));

    updateEnemyTint(record, ctx);

    const spinParts = record.mesh.userData.spinParts as Mesh[] | undefined;
    if (spinParts) {
      for (const part of spinParts) part.rotation.z += dt * (part.userData.spinSpeed as number);
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z -= dt * 3.1;
      const pulse = 1 + Math.sin(elapsedNow * 11) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.85 * fit);
    }
  }
}

function updateProjectiles() {
  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }
}

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
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
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smoothstep(1 - clamp01((distance - 18) / (120 - 18)));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const cracked = userData.cracked === true;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      // Marked by the gun: the drone stops being amber and turns gun-coloured.
      if (part.kind === 'edge') part.material.color.copy(LOCKED_EDGE);
      else if (part.kind === 'fill') part.material.color.copy(LOCKED_FILL);
      else part.material.color.copy(LOCKED_CORE);
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(WHITE_ARC, part.kind === 'fill' ? 0.4 : 1.8));
      continue;
    }
    // A cracked shell exposes its capacitor: the core lights up hard.
    const exposed = cracked && part.kind === 'core' ? 3.4 : 1;
    const dim = part.kind === 'edge'
      ? 0.5 + 0.5 * closeness
      : part.kind === 'fill'
        ? 0.34 + 0.66 * closeness
        : 0.4 + 0.6 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim * exposed);
  }
}

function updateReticleSpin(dt: number, scene: Scene) {
  for (const child of scene.children) {
    if (child.userData.raildReticle !== true) continue;
    const active = child.userData.active === true;
    const spinner = child.userData.spinner as Mesh | undefined;
    if (spinner) spinner.rotation.z += dt * (active ? 5.2 : 1.1);
    const jaws = child.userData.jaws as Group | undefined;
    if (jaws) jaws.rotation.z += dt * (active ? -1.6 : -0.4);
    return;
  }
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.46;

  // FOV is the speedometer: it opens with the speed profile, kicks on the beat,
  // and blows wide when the gun goes off.
  const targetFov = (speed - 0.8) * 7.5 + beatEnergy * 1.4 + surge * 9 + fireFlare * 14;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFov, Math.min(1, dt * 6.5));

  if (ctx.running) {
    // Bank into the barrel's long helix. Applied after the runner's lookAt, so
    // it is purely cosmetic and lock hit-testing stays honest.
    const u = massDriverRunProgress(ctx.runTime, MD_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.004, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.13, 0.13);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: MD_SHAKE });
}

// ---- helpers ---------------------------------------------------------------------------------

function nearestCoilIndex(worldPosition: Vector3) {
  if (!environment) return 0;
  const coils = environment.coils;
  let best = 0;
  let bestDistance = Infinity;
  // The bore is monotonic along the rail, so a coarse scan plus a local refine
  // is exact enough and avoids touching all 120 coils on every event.
  for (let index = 0; index < coils.count; index += 4) {
    coils.centre(index, scratchTarget);
    const distance = scratchTarget.distanceToSquared(worldPosition);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  for (let index = Math.max(0, best - 4); index <= Math.min(coils.count - 1, best + 4); index += 1) {
    coils.centre(index, scratchTarget);
    const distance = scratchTarget.distanceToSquared(worldPosition);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // Hex clamp — the same six-fold geometry as the coils that will kill it.
  const material = createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WHITE_ARC, 0.25), 1.6), side: DoubleSide });
  material.toneMapped = false;
  group.add(new Mesh(LOCK_RING_GEOMETRY, material));
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
