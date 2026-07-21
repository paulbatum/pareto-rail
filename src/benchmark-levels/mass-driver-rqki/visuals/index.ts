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
import { createMassDriverRail, massDriverRunProgress, ringHeat, speedFactorAt } from '../barrel';
import { chargeAt } from '../interlocks';
import { LAST_RING_BEAT, MASS_DRIVER_BEAT, MUZZLE_TIME } from '../timing';
import { createBarrelEnvironment, type Environment } from './environment';
import {
  createArcnodeMesh,
  createBoltMesh,
  createInterlockMesh,
  createSentryMesh,
  createSkimmerMesh,
  createWeaverMesh,
  crackArcnodeArmour,
  crackInterlockArmour,
  type TintPart,
} from './drones';
import {
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnArc,
  spawnGlint,
  spawnShockRing,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { ARC_BLUE, ARC_VIOLET, DANGER, HOSTILE, ICE, LOCK_GRADIENT, WHITE_HOT, hdr, ringColor } from './palette';
import { arcFlashUniform, chargeTintUniform, vacuumUniform } from './post-fx';

// The visual spine: what each gameplay event looks like, and how the frame
// answers the one thing this level is about — crossing a ring on the beat.
// Construction lives in the leaf modules; every colour, timing, and magnitude
// decision is here.

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
type ProjectileRecord = { mesh: Object3D; trailColor: Color };

const SHAKE: CameraFeelShakeOptions = {
  decay: 3.0,
  maxTrauma: 1.7,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.85,
  frequency: 11,
  smoothing: 22,
};

// Shot geometry is interned: a run fires hundreds of these and each one is
// otherwise identical, so only the material needs to be per-instance.
const SLUG_CORE = new OctahedronGeometry(0.3, 0).scale(0.4, 0.4, 2.4);
const SLUG_SHELL = new OctahedronGeometry(0.5, 0).scale(0.55, 0.55, 2.0);

const DENY_EDGE = new Color(1.7, 0.12, 0.06);
const DENY_PLATE = new Color(0.26, 0.02, 0.015);
const rail = createMassDriverRail();

let environment: Environment | null = null;
let beatEnergy = 0;
let surge = 0;
let elapsedNow = 0;
let cameraRoll = 0;
let cameraFov = 0;
let lastBeatIndex = -1;
let interlocksLive = 0;
let barrelCleared = false;
let launchedAt = -1;
let chargeLevel = 0;
let pendingEffectReset = false;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but `spawn` fires synchronously right after, so
// pairing the pending queue with the event links mesh to enemy id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createBarrelEnvironment(scene);
  createEffects(scene);
  return environment.root;
}

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
      return createLetterMesh(letter ?? 'A');
    case 'sentry':
      return createSentryMesh();
    case 'skimmer':
      return createSkimmerMesh();
    case 'weaver':
      return createWeaverMesh();
    case 'arcnode':
      return createArcnodeMesh();
    case 'interlock':
      return createInterlockMesh();
    case 'bolt':
      return createBoltMesh();
    default:
      return createSentryMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  // A refused release is a tripped breaker, not an explosion: the target's own
  // hardware flares red and the current earths out into the bore wall.
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnShockRing(mesh.position, hdr(DANGER, 1.1), 3.4, 0.28);
  arcToBarrel(mesh.position, hdr(DANGER, 1.3), 0.16);
}

/** Player ordnance: a cold ice-white slug — the only thing in the bore that is not the gun's. */
export function createProjectileMesh() {
  const group = new Group();
    group.add(new Mesh(SLUG_CORE, new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.8) })));
  group.add(new Mesh(SLUG_SHELL, createAdditiveBasicMaterial({ color: hdr(ICE, 1.0), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: ICE.clone().multiplyScalar(0.9) });
  return group;
}

// ---- reticle ---------------------------------------------------------------
// Hex, like every aperture in this barrel, with a counter-rotating inner sight.

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const add = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
    return mesh;
  };

  const outer = add(new Mesh(new RingGeometry(0.66, 0.7, 6, 1), new MeshBasicMaterial()), hdr(ICE, 1.2));
  outer.rotation.z = Math.PI / 6;

  const spinner = new Group();
  spinner.add(add(new Mesh(new RingGeometry(0.4, 0.435, 3), new MeshBasicMaterial()), hdr(WHITE_HOT, 1.1)));

  const brackets = new Group();
  for (let i = 0; i < 6; i += 1) {
    const tick = add(new Mesh(new PlaneGeometry(0.17, 0.035), new MeshBasicMaterial()), hdr(ARC_BLUE, 1.5));
    const angle = (i / 6) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.87, Math.sin(angle) * 0.87, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = add(new Mesh(new CircleGeometry(0.048, 12), new MeshBasicMaterial()), hdr(WHITE_HOT, 2.2));
  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  // Locks charge the sight along the barrel's own ramp: arc blue, violet, white.
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.9 : 1.4));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.4 : 1);
  }
}

// ---- event choreography -----------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (kind === 'interlock') interlocksLive += 1;
    if (!record || kind === 'bolt') return;
    if (kind === 'interlock') {
      // Heavy hardware arriving: it earths into the wall as it locks out.
      cameraFeel.shake(0.5, SHAKE);
      spawnShockRing(worldPosition, hdr(DANGER, 1.0), 20, 0.7);
      arcToBarrel(worldPosition, hdr(DANGER, 1.2), 0.3, 2.4);
    } else {
      // Drones drop off the coils: a small contact spark, nothing more.
      spawnGlint(worldPosition, hdr(HOSTILE, 1.2), 2.2, 0.18);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(color), scene);
    spawnShockRing(worldPosition, hdr(color, 1.5), 2.4, 0.24);
    if (lockCount >= 6) {
      // Full bank: the sight itself arcs to the barrel.
      arcToBarrel(worldPosition, hdr(WHITE_HOT, 1.6), 0.2, 1.4);
      surge = Math.max(surge, 0.35);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(WHITE_HOT, 1.6), 1.3, 0.1);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(ICE, 1.1), 5, 11, 0.32);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(WHITE_HOT, 1.9), 1.6, 0.14);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string;
    if (kind === 'arcnode') {
      crackArcnodeArmour(record.mesh);
      burstSparks(worldPosition, hdr(ARC_VIOLET, 1.2), 14, 15, 0.5);
      spawnShockRing(worldPosition, hdr(ARC_VIOLET, 1.4), 7, 0.45);
    } else if (kind === 'interlock') {
      crackInterlockArmour(record.mesh);
      cameraFeel.shake(0.55, SHAKE);
      burstSparks(worldPosition, hdr(DANGER, 1.2), 22, 20, 0.6);
      spawnShockRing(worldPosition, hdr(DANGER, 1.3), 16, 0.6);
      arcToBarrel(worldPosition, hdr(WHITE_HOT, 1.4), 0.26, 2.0);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? HOSTILE;
    const kind = record.mesh.userData.kind as string;
    const heavy = kind === 'interlock';
    burstSparks(worldPosition, hdr(accent, 1.0), heavy ? 40 : 10, heavy ? 26 : 14);
    spawnShockRing(worldPosition, hdr(accent, 1.0), heavy ? 26 : 4.6, heavy ? 0.8 : 0.36);
    spawnGlint(worldPosition, hdr(WHITE_HOT, 1.8), heavy ? 5 : 1.4, 0.2);
    // Every kill earths into the accelerator: the barrel takes the current.
    arcToBarrel(worldPosition, hdr(ARC_VIOLET, 1.5), 0.22, heavy ? 3 : 1.2);

    if (heavy) {
      interlocksLive = Math.max(0, interlocksLive - 1);
      cameraFeel.shake(1.0, SHAKE);
      surge = Math.max(surge, 0.7);
      arcFlashUniform.value = Math.max(arcFlashUniform.value, 0.3);
      spawnShockRing(worldPosition, hdr(WHITE_HOT, 1.3), 46, 1.0);
      if (interlocksLive === 0) barrelCleared = true;
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      if (record.mesh.userData.kind === 'interlock') interlocksLive = Math.max(0, interlocksLive - 1);
      enemyRecords.delete(enemyId, { dispose: true });
    }
    // A target that got past you fizzles out down the barrel behind you.
    burstSparks(worldPosition, HOSTILE.clone().multiplyScalar(0.35), 3, 4, 0.3);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.6);
      arcFlashUniform.value = Math.max(arcFlashUniform.value, 0.14);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.6;
    cameraFeel.shake(1.2, SHAKE);
    arcFlashUniform.value = Math.max(arcFlashUniform.value, 0.12);
  });

  bus.on('runstart', () => {
    // Effects need a camera to unwind their billboards; do it on the next frame.
    pendingEffectReset = true;
    resetVisualState(cameraFeel);
  });

  bus.on('runend', () => {
    cameraFeel.restore();
  });
}

function resetVisualState(cameraFeel: CameraFeelRig) {
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
  lastBeatIndex = -1;
  interlocksLive = 0;
  barrelCleared = false;
  launchedAt = -1;
  chargeLevel = 0;
  surge = 0;
  beatEnergy = 0;
  cameraRoll = 0;
  cameraFov = 0;
  arcFlashUniform.value = 0;
  chargeTintUniform.value = 0;
  vacuumUniform.value = 0;
  cameraFeel.restore();
}

/** Ground a discharge into the nearest accelerator ring — the level's kill signature. */
function arcToBarrel(from: Vector3, color: Color, life: number, jitter = 1) {
  if (!environment) return;
  let best: Group | null = null;
  let bestDistance = Infinity;
  for (const slot of environment.rings) {
    if (!slot.group.visible) continue;
    const distance = slot.group.position.distanceToSquared(from);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot.group;
    }
  }
  if (!best) return;
  const angle = Math.random() * Math.PI * 2;
  const radius = best.scale.x;
  const target = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
    .applyQuaternion(best.quaternion)
    .add(best.position);
  spawnArc(from, target, color, life, jitter);
}

// ---- per-frame --------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  if (pendingEffectReset) {
    resetEffects(ctx.camera);
    pendingEffectReset = false;
  }
  beatEnergy = Math.max(0, beatEnergy - dt * 4.6);
  surge = Math.max(0, surge - dt * 1.1);

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.42;
  const cameraU = ctx.running ? massDriverRunProgress(runTime) : 0;
  const launched = ctx.running && runTime >= MUZZLE_TIME;

  updateRingCrossings(ctx, runTime);
  updatePostUniforms(dt, ctx, runTime, launched);

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    cameraU,
    runTime,
    running: ctx.running,
    speed,
    beatEnergy,
    charge: chargeLevel,
    launched,
  });

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.32)));

    updateEnemyTint(record, ctx);

    const spinParts = record.mesh.userData.spinParts as Mesh[] | undefined;
    if (spinParts) for (const part of spinParts) part.rotation.y += dt * (part.userData.spinSpeed as number);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color, 0.16);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.6;
      const pulse = 1 + Math.sin(elapsedNow * 11) * 0.06;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor, 0.14);
  }

  const spinner = findReticleSpinner(ctx.scene);
  if (spinner) {
    const active = spinner.parent?.userData.active === true;
    spinner.rotation.z += dt * (active ? 5.2 : 1.3);
    const brackets = spinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.4 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

/**
 * One ring per beat, for the whole run. Crossing one is the level's metronome
 * made physical, so it gets a real frame response: an electric lift, a small
 * FOV kick, and on downbeats a discharge across the hoop you just went through.
 */
function updateRingCrossings(ctx: VisualContext, runTime: number) {
  if (!ctx.running) {
    lastBeatIndex = -1;
    return;
  }
  const beatIndex = Math.floor(runTime / MASS_DRIVER_BEAT);
  if (beatIndex === lastBeatIndex) return;
  const previous = lastBeatIndex;
  lastBeatIndex = beatIndex;
  if (previous < 0) return;
  if (beatIndex >= LAST_RING_BEAT) {
    fireTheGun(ctx);
    return;
  }

  const heat = ringHeat(beatIndex);
  arcFlashUniform.value = Math.max(arcFlashUniform.value, 0.018 + heat * 0.075);
  ctx.feel.kickFov(0.5 + heat * 1.6, { decay: 9 });

  if (beatIndex % 4 === 0 && environment) {
    const slot = environment.rings.find((ring) => ring.beat === beatIndex);
    if (slot) {
      const radius = slot.group.scale.x;
      const from = new Vector3(radius, 0, 0).applyQuaternion(slot.group.quaternion).add(slot.group.position);
      const to = new Vector3(-radius, 0, 0).applyQuaternion(slot.group.quaternion).add(slot.group.position);
      spawnArc(from, to, ringColor(heat).multiplyScalar(2.4), 0.16, 2.2 + heat * 3);
    }
  }
}

/** The muzzle goes past. Whatever happened to the interlocks, this is the moment. */
function fireTheGun(ctx: VisualContext) {
  if (launchedAt >= 0) return;
  launchedAt = elapsedNow;
  ctx.feel.shake(1.7, SHAKE);
  ctx.feel.kickFov(16, { decay: 1.5 });
  surge = 1;
  arcFlashUniform.value = Math.max(arcFlashUniform.value, 1.5);
  if (environment) {
    spawnShockRing(environment.muzzlePosition, hdr(WHITE_HOT, 1.6), 190, 1.6);
    spawnShockRing(environment.muzzlePosition, hdr(ARC_VIOLET, 1.2), 120, 1.2);
    spawnShockRing(environment.muzzlePosition, hdr(ARC_BLUE, 1.0), 70, 0.9);
  }
}

function updatePostUniforms(dt: number, ctx: VisualContext, runTime: number, launched: boolean) {
  chargeLevel = ctx.running && interlocksLive > 0 && !barrelCleared ? chargeAt(runTime) : 0;
  chargeTintUniform.value += (chargeLevel ** 1.6 - chargeTintUniform.value) * Math.min(1, dt * 2.4);

  // The flash decays fast so a beat reads as a strike, not a glow — except the
  // muzzle flash, which is allowed to hang for most of a second.
  const fade = arcFlashUniform.value > 0.6 ? 1.6 : 6.5;
  arcFlashUniform.value = Math.max(0, arcFlashUniform.value - dt * fade);

  vacuumUniform.value += ((launched ? 1 : 0) - vacuumUniform.value) * Math.min(1, dt * 1.6);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.42;

  // FOV is the level's speedometer: it opens as the payload accelerates and
  // slams wide when the gun fires.
  const target = MathUtils.clamp((speed - 0.6) * 6.2, -2, 22) + beatEnergy * 0.9 + surge * 8;
  cameraFov = MathUtils.lerp(cameraFov, target, Math.min(1, dt * 5));
  ctx.feel.setFovOffset(cameraFov);

  if (ctx.running) {
    const u = MathUtils.clamp(massDriverRunProgress(ctx.runTime), 0, 1);
    const here = rail.getTangentAt(u);
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.005, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - here.x) * 26, -0.14, 0.14);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    ctx.camera.rotateZ(cameraRoll);
  }

  ctx.feel.update(dt, { shake: SHAKE });
}

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
  const userData = record.mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff: stacked additive cores would otherwise blob under bloom
  // against a tunnel that is already glowing.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smoothstep(1 - clamp01((distance - 14) / 62));
  const locked = userData.locked === true;
  const damaged = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const charge = (userData.charge as number | undefined) ?? 0;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'plate' ? DENY_PLATE : DENY_EDGE);
      continue;
    }
    if (locked) {
      if (part.kind === 'plate') part.material.color.copy(ICE).multiplyScalar(0.22);
      else if (part.kind === 'edge') part.material.color.copy(hdr(ICE, 1.7));
      else part.material.color.copy(hdr(WHITE_HOT, 2.3));
      continue;
    }
    if (damaged) {
      part.material.color.copy(hdr(WHITE_HOT, part.kind === 'plate' ? 0.45 : 2.0));
      continue;
    }
    const dim = part.kind === 'plate' ? 0.42 + 0.58 * closeness : 0.4 + 0.6 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
    // Interlock seams cook toward white as the firing charge peaks.
    if (charge > 0 && part.kind === 'core') {
      part.material.color.lerp(hdr(WHITE_HOT, 2.2), charge * charge * closeness);
    }
  }
}

function makeLockRing(color: Color) {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.88, 0.95, 6, 1),
    createAdditiveBasicMaterial({ color: hdr(color, 1.9), side: DoubleSide }),
  );
  outer.rotation.z = Math.PI / 6;
  const inner = new Mesh(
    new RingGeometry(0.66, 0.69, 6, 1),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WHITE_HOT, 0.5), 1.5), side: DoubleSide }),
  );
  group.add(outer, inner);
  return group;
}

export function disposeVisuals(camera: Camera) {
  resetEffects(camera);
  environment?.dispose();
  environment = null;
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
