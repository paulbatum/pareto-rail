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
import {
  createThermalInkV1d2Rail,
  inkState,
  inkTarget,
  speedFactorAt,
  thermalInkV1d2RunProgress,
  THERMAL_INK_V1D2_DURATION,
} from '../gameplay';
import {
  breakBuoyShell,
  createBuoyMesh,
  createDrifterMesh,
  createGobMesh,
  createHatchlingMesh,
  createInkCloudMesh,
  type TintPart,
} from './enemies';
import {
  burstDebris,
  burstEmbers,
  burstInk,
  createEffects,
  dropInkTrail,
  dropTrail,
  resetEffects,
  spawnBeam,
  spawnGlint,
  spawnRing,
  updateEffects,
  type DebrisSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked, setLetterThermal } from './letters';
import { createCollapseGhost, createArmMesh, createOctopusMesh, updateArmMesh, updateOctopusMesh } from './octopus-mesh';
import { applyEnvironmentThermal, createEnvironment, updateStreaks, type HarborEnvironment } from './environment';
import { FOG_MURK, hdr, IR_BG, IR_FOG, LOCK_GRADIENT, OCHRE, SEA_GLASS, SIGNAL_RED, SODIUM, WHITE_WARM } from './palette';
import { flashUniform, hurtUniform, inkUniform, irUniform } from './post-fx';

const MURK_BG_COLOR = new Color(0.075, 0.048, 0.02);
const FOG_MURK_COLOR = new Color(0.095, 0.062, 0.026);
const OIL_RING = new Color(0.05, 0.04, 0.06);

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

type GhostRecord = { mesh: Group; age: number };

const DENY_RED = new Color(1.6, 0.1, 0.05);
const DENY_FILL = new Color(0.3, 0.02, 0.01);

let environment: HarborEnvironment | null = null;
let beatEnergy = 0;
let surgePulse = 0;
let elapsedNow = 0;
let irBlend = 0;
const ghosts: GhostRecord[] = [];

const THERMAL_INK_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.8,
  pitchDegrees: 0.36,
  yawDegrees: 0.3,
  rollDegrees: 0.75,
  frequency: 8.5,
  smoothing: 20,
};

const rail = createThermalInkV1d2Rail();

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

export function createEnvironmentInternal(scene: Scene) {
  environment = createEnvironment(scene);
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
    case 'drifter':
      return createDrifterMesh();
    case 'hatchling':
      return createHatchlingMesh();
    case 'buoy':
      return createBuoyMesh();
    case 'gob':
      return createGobMesh();
    case 'inkcloud':
      return createInkCloudMesh();
    case 'arm':
      return createArmMesh();
    case 'core':
      return createOctopusMesh();
    default:
      return createDrifterMesh();
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
  if (!mesh.userData.isInk) {
    spawnRing(mesh.position, DENY_RED.clone(), 2.6, 0.3);
  }
}

// Player shot: a sea-glass dart — the one cold-moving thing in the murk.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.2);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(WHITE_WARM, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.48, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(
    new Mesh(
      shellGeometry,
      createAdditiveBasicMaterial({ color: hdr(SEA_GLASS, 1.0), opacity: 0.5 }),
    ),
  );
  projectileRecords.enqueue({ mesh: group, trailColor: SEA_GLASS.clone().multiplyScalar(0.85) });
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

  const outer = new Mesh(new RingGeometry(0.62, 0.655, 48), new MeshBasicMaterial());
  addPart(outer, hdr(SEA_GLASS, 1.15));

  // A spinning tri-hook sight — three-fold, unlike anything hostile here.
  const spinner = new Group();
  const triangle = new Mesh(new RingGeometry(0.38, 0.415, 3), new MeshBasicMaterial());
  addPart(triangle, hdr(WHITE_WARM, 1.0));
  spinner.add(triangle);

  const brackets = new Group();
  for (let i = 0; i < 3; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.2, 0.04), new MeshBasicMaterial());
    addPart(tick, hdr(SEA_GLASS, 1.35));
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    tick.rotation.z = angle + Math.PI / 2;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 18), new MeshBasicMaterial());
  addPart(dot, hdr(WHITE_WARM, 2.1));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.075 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
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
    if (kind === 'inkcloud') {
      // Ink arrives with a deep pressure ring, not a flash.
      spawnRing(worldPosition, OIL_RING.clone(), 16, 0.8);
    } else if (kind === 'core') {
      // no fanfare at 0.5s — the creature is already there
    } else if (kind === 'arm') {
      spawnRing(worldPosition, hdr(OCHRE, 1.0), 6, 0.5);
    } else if (kind === 'hatchling') {
      spawnBeam(worldPosition.clone(), hdr(OCHRE, 0.7), 8, 0.5);
      spawnRing(worldPosition, hdr(OCHRE, 0.9), 3, 0.4);
    } else if (kind !== 'gob') {
      spawnRing(worldPosition, hdr(OCHRE, 0.8), 2.6, 0.4);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.2, 0.28);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(SEA_GLASS, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstEmbers(worldPosition, hdr(WHITE_WARM, 0.9), 5, 9, 3);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.35;
      spawnGlint(worldPosition, hdr(WHITE_WARM, 1.8), 1.1, 0.16);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'buoy') {
      breakBuoyShell(record.mesh);
      const specs = record.mesh.userData.shardSpecs as DebrisSpec[] | undefined;
      if (specs) burstDebris(worldPosition, specs.slice(0, 7));
      burstEmbers(worldPosition, hdr(SODIUM, 1.1), 12, 12);
      spawnRing(worldPosition, hdr(SODIUM, 1.3), 6, 0.5);
    } else if (record.mesh.userData.isOctopus) {
      // A core stage: the creature convulses, ink jets loose.
      cameraFeel.shake(1.0, THERMAL_INK_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      burstInk(worldPosition, 8, 6, 1.1);
      burstEmbers(worldPosition, hdr(SIGNAL_RED, 1.3), 18, 16, 6);
      spawnRing(worldPosition, hdr(SIGNAL_RED, 1.4), 22, 0.9);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as DebrisSpec[] | undefined;
      if (specs) burstDebris(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? OCHRE;
      burstEmbers(worldPosition, hdr(accent, 1.0), 8, 12);
      spawnRing(worldPosition, hdr(accent, 0.9), 4.6, 0.42);
      spawnGlint(worldPosition, hdr(WHITE_WARM, 1.6), 1.2, 0.18);

      if (record.mesh.userData.isOctopus) {
        killOctopus(worldPosition, cameraFeel);
      } else if (record.mesh.userData.isArm) {
        // An arm breaks: ink sprays from the stump, the limb's debris sinks.
        burstInk(worldPosition, 7, 2.6, 0.9);
        burstEmbers(worldPosition, hdr(OCHRE, 1.1), 10, 12);
        cameraFeel.shake(0.5, THERMAL_INK_CAMERA_SHAKE);
        surgePulse = Math.max(surgePulse, 0.4);
      } else if (record.mesh.userData.kind === 'hatchling') {
        burstInk(worldPosition, 3, 1.2, 0.4);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    if (record && record.mesh.userData.kind !== 'inkcloud' && record.mesh.userData.kind !== 'gob') {
      burstEmbers(worldPosition, OCHRE.clone().multiplyScalar(0.4), 3, 3, 2);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    hurtUniform.value = Math.max(hurtUniform.value, 0.55);
    cameraFeel.shake(1.3, THERMAL_INK_CAMERA_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      surgePulse = Math.max(surgePulse, 0.6);
      cameraFeel.shake(0.7, THERMAL_INK_CAMERA_SHAKE);
    } else if (phase === 'exposed') {
      flashUniform.value = Math.max(flashUniform.value, 0.5);
      surgePulse = Math.max(surgePulse, 0.9);
      cameraFeel.shake(1.1, THERMAL_INK_CAMERA_SHAKE);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    for (const ghost of ghosts) {
      ghost.mesh.removeFromParent();
    }
    ghosts.length = 0;
    irBlend = 0;
    inkState.level = 0;
    inkState.thermal = false;
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    hurtUniform.value = 0;
    irUniform.value = 0;
    inkUniform.value = 0;
    surgePulse = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

function killOctopus(worldPosition: Vector3, cameraFeel: CameraFeelRig) {
  inkState.bossDead = true;
  cameraFeel.shake(1.8, THERMAL_INK_CAMERA_SHAKE);
  surgePulse = 1.0;
  flashUniform.value = Math.max(flashUniform.value, 1.0);
  burstInk(worldPosition, 16, 9, 1.6);
  burstEmbers(worldPosition, hdr(SIGNAL_RED, 1.4), 40, 26, 8);
  spawnRing(worldPosition, hdr(WHITE_WARM, 1.5), 70, 1.5);
  spawnRing(worldPosition, hdr(SIGNAL_RED, 1.2), 42, 1.1);
  spawnGlint(worldPosition, hdr(WHITE_WARM, 2.2), 6, 0.5);
  // The thermal silhouette collapses and sinks while the lamps return.
  const ghost = createCollapseGhost();
  ghost.position.copy(worldPosition);
  ghosts.push({ mesh: ghost, age: 0 });
  environment?.root.parent?.add(ghost);
}

// ---- per-frame update -------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

let cameraRoll = 0;
let cameraFovOffset = 0;

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  updateInkAndThermal(dt, runTime, ctx.running);
  updateEnvironmentFrame(dt, ctx, speed, runTime);
  updatePostUniforms(dt);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    if (!record.mesh.userData.isInk) {
      record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));
    }

    updateEnemyTint(record, ctx);

    const spinParts = record.mesh.userData.spinParts as Mesh[] | undefined;
    if (spinParts) {
      for (const part of spinParts) part.rotation.z += dt * (part.userData.spinSpeed as number);
    }
    if (record.mesh.userData.isArm) {
      updateArmMesh(record.mesh, elapsedNow, record.mesh.userData.retracted === true);
    }
    if (record.mesh.userData.isOctopus) {
      updateOctopusMesh(record.mesh, elapsedNow, record.mesh.userData.exposed === true);
    }
    if (record.mesh.userData.isHostileShot && record.mesh.userData.trailInk) {
      dropInkTrail(record.mesh.position);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.4;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
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

  // Collapse ghosts sink and dissolve as the lamps return.
  for (let i = ghosts.length - 1; i >= 0; i -= 1) {
    const ghost = ghosts[i];
    ghost.age += dt;
    ghost.mesh.position.y -= dt * (7 + ghost.age * 5);
    ghost.mesh.rotation.z += dt * 0.1;
    const fade = Math.max(0, 1 - ghost.age / 4.5);
    for (const material of ghost.mesh.userData.ghostMaterials as MeshBasicMaterial[]) {
      material.opacity = fade * 0.95;
    }
    if (fade <= 0) {
      ghost.mesh.removeFromParent();
      ghosts.splice(i, 1);
    }
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.6 : 1.2);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 3 : 0.7);
  }

  updateEffects(dt, ctx.camera);
}

// The central rhythm: ink coverage drives the thermal display. Smoothed hard
// enough to snap (the fantasy is a sensor cutting in, not a fade).
function updateInkAndThermal(dt: number, runTime: number, running: boolean) {
  const target = running ? inkTarget(runTime) : 0;
  const response = target > irBlend ? 7.5 : 2.6; // snap on, relax off
  irBlend += (target - irBlend) * Math.min(1, dt * response);
  if (irBlend < 0.005 && target === 0) irBlend = 0;
  inkState.level = irBlend;
  inkState.thermal = irBlend > 0.45;
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, speed: number, runTime: number) {
  if (!environment) return;

  for (const field of environment.fields) {
    field.update(thermalInkV1d2RunProgress(ctx.running ? runTime : 0), dt);
  }
  updateStreaks(environment.streaks, ctx.camera, dt, speed);

  // Background and fog sink into the charcoal display with the ink.
  const background = ctx.scene.background as Color | null;
  if (background) {
    background.copy(MURK_BG_COLOR).lerp(IR_BG, irBlend);
  }
  if (ctx.scene.fog) {
    const fog = ctx.scene.fog as { color: Color; density: number };
    fog.color.copy(FOG_MURK_COLOR).lerp(IR_FOG, irBlend);
    fog.density = MathUtils.lerp(0.0085, 0.0115, irBlend);
  }
  applyEnvironmentThermal(irBlend);
}

function updatePostUniforms(dt: number) {
  irUniform.value = irBlend;
  inkUniform.value = Math.max(0, inkState.level * (1 - irBlend * 0.4));
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.4 : 2.4));
  hurtUniform.value = Math.max(0, hurtUniform.value - dt * 1.6);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  updateCameraFeel(dt, ctx, speed);
}

function updateCameraFeel(dt: number, ctx: CameraEffectsContext, speed: number) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with airspeed, kicks with the beat and the surge pulses; the
  // thermal display pulls in tight, like a lens refocusing.
  const thermalPull = -irBlend * 3.2;
  const targetFovOffset = (speed - 0.8) * 8 + beatEnergy * 1.0 + surgePulse * 6 + thermalPull;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the rail's turns; applied after the runner's lookAt.
    const u = thermalInkV1d2RunProgress(ctx.runTime, THERMAL_INK_V1D2_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.16, 0.16);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: THERMAL_INK_CAMERA_SHAKE });
}

// ---- tinting -----------------------------------------------------------------------

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
  const userData = record.mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) {
      setLetterDenied(record.mesh, true);
    } else if (inkState.thermal) {
      setLetterThermal(record.mesh, true);
    } else if (userData.locked !== true) {
      setLetterLocked(record.mesh, false);
    } else {
      setLetterLocked(record.mesh, true);
    }
    return;
  }

  // Ink clouds stay cold black in both displays.
  if (userData.isInk) return;

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff keeps far additive stacks from blobbing under bloom.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 16) / (54 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  // Inside ink with thermal off, normal sight is swallowed: enemies vanish
  // into the black. Thermal burns them back into view.
  const swallow = inkState.level * (1 - irBlend) * 0.94;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(WHITE_WARM, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(SEA_GLASS.clone().multiplyScalar(0.35));
      else part.material.color.copy(hdr(WHITE_WARM, 2.1));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(WHITE_WARM, part.kind === 'fill' ? 0.5 : 1.9));
      continue;
    }

    const murkColor = part.murk.clone().multiplyScalar(part.murkIntensity * dimFor(part.kind, closeness));
    const irColor = part.ir.clone().multiplyScalar(part.irIntensity * (part.kind === 'core' ? 1 : 0.55 + 0.45 * closeness));
    const color = murkColor.lerp(irColor, irBlend);
    color.multiplyScalar(1 - swallow);
    part.material.color.copy(color);
  }
}

function dimFor(kind: TintPart['kind'], closeness: number) {
  if (kind === 'edge') return 0.55 + 0.45 * closeness;
  if (kind === 'fill') return 0.3 + 0.7 * closeness;
  return 0.35 + 0.65 * closeness;
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.66, 0.69, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WHITE_WARM, 0.55), 1.4), side: DoubleSide }),
  );
  group.add(ring, innerRing);
  return group;
}

let ctx_running = false;

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
