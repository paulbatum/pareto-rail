import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
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
import { createStrandlineRail, speedFactorAt, strandlineRunProgress } from '../gameplay';
import { BELL_CENTER, BELL_REVEAL_TIME, CLEAN_WATER_TIME, STRANDLINE_DURATION } from '../timing';
import {
  breakWebPanel,
  createBroodlingMesh,
  createClasperMesh,
  createDrifterMesh,
  createNettleMesh,
  createPanelMesh,
  createParentMesh,
  createSkeinMesh,
  type TintPart,
} from './enemies';
import {
  beatUniform,
  bellRevealUniform,
  cleanUniform,
  createEnvironmentInternal,
  type Environment,
} from './environment';
import {
  burstMotes,
  burstShards,
  createEffects,
  dropTrail,
  resetEffects,
  spawnBeam,
  spawnGlint,
  spawnRing,
  updateEffects,
  type MoteSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { AQUA_WHITE, PEARL, STRAND_GREEN, SUNLIGHT, VIOLET, VIOLET_SICK, hdr } from './palette';
import { flashUniform, hurtUniform } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type CameraEffectsContext = {
  camera: PerspectiveCamera;
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

const DENY_RED = new Color(1.1, 0.12, 0.5);
const DENY_FILL = new Color(0.22, 0.03, 0.16);

const SHOT_COLOR = new Color(1.0, 0.97, 0.86);

let environment: Environment | null = null;
let beatEnergy = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let parentKilledAt = -1;

const STRANDLINE_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.6,
  frequency: 6.5,
  smoothing: 18,
};

const rail = createStrandlineRail();
const BELL_POSITION = new Vector3(BELL_CENTER.x, BELL_CENTER.y, BELL_CENTER.z);

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
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
      return createLetterMesh(letter ?? 'S');
    case 'clasper':
      return createClasperMesh();
    case 'drifter':
      return createDrifterMesh();
    case 'skein':
      return createSkeinMesh();
    case 'broodling':
      return createBroodlingMesh();
    case 'nettle':
      return createNettleMesh();
    case 'panel':
      return createPanelMesh();
    case 'parent':
      return createParentMesh();
    default:
      return createClasperMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RED.clone(), 2.6, 0.3);
}

// Player shot: a warm pearl dart — sunlight in a violet-infested world.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.2);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(PEARL, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.46, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(
    new Mesh(
      shellGeometry,
      createAdditiveBasicMaterial({ color: hdr(SUNLIGHT, 0.9) }),
    ),
  );
  projectileRecords.enqueue({ mesh: group, trailColor: SUNLIGHT.clone().multiplyScalar(0.8) });
  return group;
}

// ---- reticle -----------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  // A ring of kelp-thin ticks around a soft center — a tide pool sight.
  const outer = new Mesh(new RingGeometry(0.6, 0.635, 40), new MeshBasicMaterial());
  addPart(outer, hdr(PEARL, 1.1));

  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.34, 0.365, 24), new MeshBasicMaterial());
  addPart(inner, hdr(AQUA_WHITE, 0.95));
  spinner.add(inner);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.18, 0.035), new MeshBasicMaterial());
    addPart(tick, hdr(SUNLIGHT, 1.3));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle + Math.PI / 2;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(PEARL, 2.0));

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
  // Locks charge aqua-white → pearl → gold: the sixth lock is full sunlight.
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, [AQUA_WHITE, PEARL, SUNLIGHT]);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
}

// ---- event wiring ---------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'parent') {
      cameraFeel.shake(1.0, STRANDLINE_CAMERA_SHAKE);
      spawnRing(worldPosition, hdr(VIOLET_HOT_COLOR(), 1.2), 30, 1.0);
      spawnRing(worldPosition, hdr(VIOLET, 1.0), 16, 0.7);
      spawnBeam(worldPosition, hdr(VIOLET, 0.9), 40, 0.9);
    } else if (kind === 'panel') {
      spawnRing(worldPosition, hdr(VIOLET_SICK, 0.9), 7, 0.5);
    } else if (kind !== 'nettle') {
      spawnRing(worldPosition, hdr(VIOLET, 0.7), 2.4, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [AQUA_WHITE, PEARL, SUNLIGHT]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.0, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(PEARL, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstMotes(worldPosition, hdr(PEARL, 0.9), 5, 8, 2);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.32;
      spawnGlint(worldPosition, hdr(PEARL, 1.7), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'panel') {
      // The webbing tears loose: wet burst, pressure ring, sunlight through.
      breakWebPanel(record.mesh);
      const specs = record.mesh.userData.shardSpecs as MoteSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 8));
      burstMotes(worldPosition, hdr(STRAND_GREEN, 1.0), 12, 11);
      spawnRing(worldPosition, hdr(STRAND_GREEN, 1.2), 6.5, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.18);
    } else if (record.mesh.userData.isParent) {
      // The parent recoils — the water shudders.
      cameraFeel.shake(1.0, STRANDLINE_CAMERA_SHAKE);
      spawnRing(worldPosition, hdr(VIOLET, 1.3), 26, 0.9);
      burstMotes(worldPosition, hdr(VIOLET, 1.1), 24, 20, 6);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as MoteSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs);
      const accent = (record.mesh.userData.shardColor as Color | undefined) ?? VIOLET;
      burstMotes(worldPosition, hdr(accent, 1.0), 8, 11);
      spawnRing(worldPosition, hdr(accent, 0.85), 4.4, 0.4);
      spawnGlint(worldPosition, hdr(PEARL, 1.6), 1.1, 0.16);

      if (record.mesh.userData.isParent) {
        killParent(worldPosition, cameraFeel);
      } else if (record.mesh.userData.kind === 'panel') {
        cameraFeel.shake(0.5, STRANDLINE_CAMERA_SHAKE);
        spawnRing(worldPosition, hdr(STRAND_GREEN, 1.2), 9, 0.55);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstMotes(worldPosition, VIOLET_SICK.clone().multiplyScalar(0.4), 3, 3, 1);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.4);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.4;
    hurtUniform.value = Math.max(hurtUniform.value, 0.5);
    cameraFeel.shake(1.2, STRANDLINE_CAMERA_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    parentKilledAt = -1;
    lastRunTime = -1;
    cameraRoll = 0;
    cameraFovOffset = 0;
    cameraFeel.restore();
    cleanUniform.value = 0;
    bellRevealUniform.value = 0;
    flashUniform.value = 0;
    hurtUniform.value = 0;
  });

  bus.on('runend', () => {
    cameraFeel.restore();
  });
}

function VIOLET_HOT_COLOR() {
  return VIOLET.clone().lerp(new Color(1.4, 1.0, 1.8), 0.35);
}

// The kill the whole level is built around: the parent tears loose, the blight
// washes out of every strand, and the camera begins its long pull back.
function killParent(worldPosition: Vector3, cameraFeel: CameraFeelRig) {
  parentKilledAt = elapsedNow;
  cameraFeel.shake(1.4, STRANDLINE_CAMERA_SHAKE);
  flashUniform.value = Math.max(flashUniform.value, 0.9);
  spawnRing(worldPosition, hdr(PEARL, 1.5), 70, 1.5);
  spawnRing(worldPosition, hdr(STRAND_GREEN, 1.2), 44, 1.2);
  spawnRing(worldPosition, hdr(VIOLET, 1.0), 24, 0.9);
  spawnGlint(worldPosition, hdr(PEARL, 2.2), 6, 0.5);
  burstMotes(worldPosition, hdr(STRAND_GREEN, 1.2), 46, 26, 8);
}

// ---- per-frame update -------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.6);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.6;

  updateSetPieceMoments(ctx);
  updateEnvironmentFrame(dt, ctx, runTime);
  updatePostUniforms(dt);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const baseScale = (record.mesh.userData.baseScale as number | undefined) ?? 1;
    record.mesh.scale.setScalar(baseScale * easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);
    updateEnemyAnimation(record, dt);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, VIOLET.clone().multiplyScalar(0.9));
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.2 : 1.1);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.6 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

// Bell reveal / clean-water turn: detect the crossing, answer the music.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(BELL_REVEAL_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.5);
    bellRevealUniform.value = 1;
  }
  if (crossed(CLEAN_WATER_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.3);
  }
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.6;
  updateCameraFeel(dt, ctx, speed, runTime, ctx.running);
}

function updateCameraFeel(dt: number, ctx: CameraEffectsContext, speed: number, runTime: number, running: boolean) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with the beat and the swim speed.
  const targetFovOffset = (speed - 0.9) * 8 + beatEnergy * 0.9;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 5));

  if (running) {
    // Bank into the rail's turns — you are swimming, not flying a machine.
    const u = strandlineRunProgress(runTime, STRANDLINE_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.007, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 34, -0.2, 0.2);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 2.8);
    camera.rotateZ(cameraRoll);
  }

  // The serene pull-back: after the parent dies, the camera drifts backward
  // and turns to face the animal — the whole jellyfish in frame at last.
  if (parentKilledAt >= 0) {
    const since = elapsedNow - parentKilledAt;
    const weight = MathUtils.clamp(since / 3.4, 0, 1);
    const eased = weight * weight * (3 - 2 * weight);
    const u = running ? strandlineRunProgress(Math.min(STRANDLINE_DURATION, runTime), STRANDLINE_DURATION) : 1;
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    camera.position.addScaledVector(tangent, -eased * 34 * (running ? 1 : 0));
    camera.position.y -= eased * 4;

    const desired = lookAtQuaternion(camera.position, BELL_POSITION);
    camera.quaternion.slerp(desired, Math.min(1, eased * dt * 2.2 + (weight >= 1 ? dt * 1.4 : 0)));
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: STRANDLINE_CAMERA_SHAKE });
}

function lookAtQuaternion(position: Vector3, target: Vector3) {
  const matrix = new Matrix4();
  matrix.lookAt(position, target, new Vector3(0, 1, 0));
  return new Quaternion().setFromRotationMatrix(matrix);
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, runTime: number) {
  void dt;
  void ctx;
  void runTime;
  // The bell reveal surge decays; the blight cleanses after the kill.
  bellRevealUniform.value = Math.max(0, bellRevealUniform.value - dt * 0.5);
  if (parentKilledAt >= 0) {
    const since = elapsedNow - parentKilledAt;
    cleanUniform.value = MathUtils.clamp(since / 3.0, 0, 1);
  }
}

function updatePostUniforms(dt: number) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.2 : 2.2));
  hurtUniform.value = Math.max(0, hurtUniform.value - dt * 1.8);
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

  // Distance falloff keeps far additive stacks from blobbing under bloom.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 18) / (58 - 18)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(PEARL, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(VIOLET.clone().multiplyScalar(0.4));
      else part.material.color.copy(hdr(PEARL, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(PEARL, part.kind === 'fill' ? 0.6 : 1.8));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.32 + 0.68 * closeness : 0.4 + 0.6 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

// Per-kind idle animation, driven by userData fields the gameplay update
// writes each frame (gape, pulse, withered, exposed).
function updateEnemyAnimation(record: EnemyRecord, dt: number) {
  const mesh = record.mesh;
  const userData = mesh.userData;

  // Clasper: shell halves gape open as it detaches.
  if (userData.shells) {
    const gape = (userData.gape as number | undefined) ?? 0;
    const [top, bottom] = userData.shells as Mesh[];
    top.position.y = 0.42 + gape * 0.55;
    top.rotation.z = gape * 0.4;
    bottom.position.y = -0.42 - gape * 0.55;
    bottom.rotation.z = -gape * 0.4;
  }

  // Drifter / broodling: the parasitic pulse.
  if (userData.kind === 'drifter' || userData.kind === 'broodling') {
    const pulse = (userData.pulse as number | undefined) ?? 0;
    const core = (userData.coreMesh ?? mesh.children[0]) as Mesh | undefined;
    if (core) core.scale.setScalar(1 + pulse * 0.35);
    if (userData.domeMesh) (userData.domeMesh as Mesh).scale.setScalar(1 + pulse * 0.12);
  }

  // Web panel: withered panels hang grey and slack.
  if (userData.kind === 'panel' && userData.withered === true && userData.membrane) {
    const membrane = userData.membrane as Mesh;
    const material = membrane.material as MeshBasicMaterial;
    material.opacity = Math.max(0.08, material.opacity - dt * 0.5);
  }

  // Parent: the heart beats faster as it loses its armor.
  if (userData.isParent && userData.heartMesh) {
    const exposed = userData.exposed === true;
    const heart = userData.heartMesh as Mesh;
    const rate = exposed ? 9 : 4.5;
    heart.scale.setScalar(1 + Math.max(0, Math.sin(elapsedNow * rate)) * (exposed ? 0.4 : 0.2));
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // A soft ring of light closing on a parasite — no hard mechanical brackets
  // underwater; the clamp reads as a ring of bioluminescence.
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 40),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.64, 0.665, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(PEARL, 0.5), 1.3), side: DoubleSide }),
  );
  group.add(ring, innerRing);
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

function smootherstep(t: number): number {
  return t * t * (3 - 2 * t);
}
