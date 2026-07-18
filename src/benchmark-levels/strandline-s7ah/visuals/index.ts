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
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  STRANDLINE_PLAYER_HEALTH,
  createStrandlineRail,
  speedFactorAt,
  strandlineRunProgress,
} from '../gameplay';
import { BROOD_WAVE_SIZES } from '../matriarch';
import {
  createBroodMesh,
  createCystMesh,
  createLasherMesh,
  createMatriarchMesh,
  createSpitterMesh,
  createVenomMesh,
  updateMatriarchMesh,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShards,
  burstSpores,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnInk,
  spawnRing,
  spawnSinkingHusk,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  CORE_WHITE,
  DENY_VIOLET,
  JELLY_GOLD,
  JELLY_GREEN,
  LOCK_GRADIENT,
  PARASITE_BRUISE,
  PARASITE_CORE,
  PARASITE_VIOLET,
  hdr,
} from './palette';
import { cleanseUniform, flashUniform, venomUniform } from './post-fx';

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

const DENY_FILL = new Color(0.2, 0.02, 0.22);

let environment: Environment | null = null;
let beatEnergy = 0;
let surgePulse = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let elapsedNow = 0;
let hitsTaken = 0;
let venomPulse = 0;
let cleanse = 0;
let broodsKilledVisual = 0;
let matriarchDead = false;
let matriarchDeadAtRunTime = -1;
let pullback = 0;

const STRANDLINE_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.6,
  frequency: 6.5,
  smoothing: 16,
};

const rail = createStrandlineRail();

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
  disposeRecord: (record) => {
    lockRings.detach(record);
    // The engine only detaches enemy meshes from the scene; the level owns
    // their geometry, so free it here or the renderer accumulates all run.
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
  return environment.root;
}

const KIND_SCALE: Record<string, number> = {
  cyst: 1.25,
  lasher: 1.2,
  spitter: 1.3,
  venom: 1.2,
  brood: 1.35,
};

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemyMesh(kind, letter);
  // Wrap so the spawn scale-in animates the outer group while the inner
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
    case 'cyst':
      return createCystMesh();
    case 'lasher':
      return createLasherMesh();
    case 'spitter':
      return createSpitterMesh();
    case 'venom':
      return createVenomMesh();
    case 'brood':
      return createBroodMesh();
    case 'matriarch':
      return createMatriarchMesh();
    default:
      return createCystMesh();
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
  spawnRing(mesh.position, DENY_VIOLET.clone(), 2.4, 0.3);
}

// Player shot: a seed of clean light — white-gold core in a soft green husk.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.5, 0.5, 2.1);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(CORE_WHITE, 2.4) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.6, 0.6, 1.8);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.9), opacity: 0.55 })));
  projectileRecords.enqueue({ mesh: group, trailColor: JELLY_GOLD.clone().multiplyScalar(0.7) });
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

  // A diver's cleansing lamp: a thin iris ring, three swimming arc-fins that
  // spin up when tracking, and a bright focal bead.
  const iris = new Mesh(new RingGeometry(0.6, 0.64, 48), new MeshBasicMaterial());
  addPart(iris, hdr(CORE_WHITE, 1.0));

  const fins = new Group();
  for (let i = 0; i < 3; i += 1) {
    const fin = new Mesh(new RingGeometry(0.78, 0.85, 40, 1, (i / 3) * Math.PI * 2, Math.PI / 3.2), new MeshBasicMaterial());
    addPart(fin, hdr(JELLY_GREEN, 1.0));
    fins.add(fin);
  }

  const bead = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial());
  addPart(bead, hdr(CORE_WHITE, 1.8));

  group.add(iris, fins, bead);
  group.userData.parts = parts;
  group.userData.spinner = fins;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  // Charging walks the lamp white → green → gold: six locks is full burn.
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.25));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
}

// ---- event wiring ------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'matriarch') {
      // The crown comes into view and the water goes wrong around it.
      cameraFeel.shake(0.9, STRANDLINE_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.4);
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 1.2), 26, 0.9);
      spawnRing(worldPosition, hdr(PARASITE_CORE, 0.8), 14, 0.7);
    } else if (kind === 'brood') {
      spawnRing(worldPosition, hdr(PARASITE_CORE, 1.0), 3.0, 0.4);
      burstSpores(worldPosition, hdr(PARASITE_VIOLET, 0.7), 4, 5, 3);
    } else if (kind !== 'venom') {
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 0.55), 2.2, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockHalo(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.0, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(CORE_WHITE, 1.1), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSpores(worldPosition, hdr(JELLY_GOLD, 0.85), 5, 8, 6);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(CORE_WHITE, 1.6), 1.0, 0.15);
      if (record.mesh.userData.isMatriarch) {
        spawnRing(worldPosition, hdr(JELLY_GOLD, 1.0), 7, 0.4);
      }
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.isMatriarch) {
      // Half its grip torn free: convulsion, ink, a pressure wave.
      cameraFeel.shake(1.1, STRANDLINE_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.35);
      spawnRing(worldPosition, hdr(PARASITE_CORE, 1.4), 24, 0.9);
      spawnInk(worldPosition, 16, 1.4);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 8));
      burstSpores(worldPosition, hdr(CORE_WHITE, 1.1), 20, 16, 8);
    } else {
      // Spitter shell crack.
      burstSpores(worldPosition, hdr(PARASITE_VIOLET, 1.0), 10, 11, 5);
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 1.2), 4.5, 0.4);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? PARASITE_CORE;
      burstSpores(worldPosition, hdr(accent, 0.9), 7, 10, 6);
      // Every parasite death is also a release of light: the cleanse made
      // visible as gold spores floating up out of the wound.
      burstSpores(worldPosition, hdr(JELLY_GOLD, 0.8), 5, 6, 9);
      spawnRing(worldPosition, hdr(accent, 0.85), 4.2, 0.4);
      spawnGlint(worldPosition, hdr(CORE_WHITE, 1.5), 1.1, 0.16);
      spawnInk(worldPosition, 4.5, 0.9);

      if (record.mesh.userData.kind === 'brood') {
        broodsKilledVisual += 1;
        spawnRing(worldPosition, hdr(JELLY_GREEN, 1.0), 7, 0.5);
      } else if (record.mesh.userData.kind === 'spitter') {
        spawnSinkingHusk(worldPosition, 1.3, 2);
      } else if (record.mesh.userData.isMatriarch) {
        // The severance the whole run is built around: it lets go, and the
        // animal lights up from the crown down.
        matriarchDead = true;
        cameraFeel.shake(1.6, STRANDLINE_CAMERA_SHAKE);
        surgePulse = 1.0;
        flashUniform.value = Math.max(flashUniform.value, 1.0);
        spawnRing(worldPosition, hdr(CORE_WHITE, 1.5), 60, 1.5);
        spawnRing(worldPosition, hdr(JELLY_GOLD, 1.2), 38, 1.1);
        spawnRing(worldPosition, hdr(JELLY_GREEN, 1.0), 22, 0.9);
        spawnGlint(worldPosition, hdr(CORE_WHITE, 2.2), 6, 0.5);
        burstSpores(worldPosition, hdr(JELLY_GOLD, 1.2), 60, 22, 10);
        spawnInk(worldPosition, 26, 2.0);
        spawnSinkingHusk(worldPosition, 4.5, 5);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstSpores(worldPosition, PARASITE_BRUISE.clone().multiplyScalar(0.5), 3, 3, 2);
  });

  bus.on('shielded', ({ shields }) => {
    // The web sheds the volley: a violet flare and a spray of spores.
    for (const shield of shields) {
      spawnRing(shield.worldPosition, hdr(PARASITE_VIOLET, 1.3), 11, 0.5);
      burstSpores(shield.worldPosition, hdr(PARASITE_VIOLET, 0.9), 9, 10, 4);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.14);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    venomPulse = 1;
    beatEnergy = 1.3;
    cameraFeel.shake(1.2, STRANDLINE_CAMERA_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    venomUniform.value = 0;
    cleanseUniform.value = 0;
    surgePulse = 0;
    hitsTaken = 0;
    venomPulse = 0;
    cleanse = 0;
    broodsKilledVisual = 0;
    matriarchDead = false;
    matriarchDeadAtRunTime = -1;
    pullback = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame update ---------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);
  venomPulse = Math.max(0, venomPulse - dt * 1.4);

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? strandlineRunProgress(runTime) : 0;

  if (matriarchDead && matriarchDeadAtRunTime < 0) matriarchDeadAtRunTime = runTime;

  // The cleanse dial: the fight brightens the colony a little at a time, the
  // brood kills more, and the severance finishes it.
  const totalBroods = BROOD_WAVE_SIZES[0] + BROOD_WAVE_SIZES[1];
  const cleanseTarget = matriarchDead
    ? 1
    : Math.min(0.62, progress * 0.3 + (broodsKilledVisual / totalBroods) * 0.32);
  cleanse = MathUtils.lerp(cleanse, cleanseTarget, Math.min(1, dt * (matriarchDead ? 0.9 : 2.2)));
  cleanseUniform.value = cleanse * 0.5;

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    progress,
    beatEnergy,
    cleanse,
  });

  venomUniform.value = Math.min(1, venomPulse * 0.7 + Math.min(1, hitsTaken / STRANDLINE_PLAYER_HEALTH) * 0.08);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.3 : 2.4));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);
    animateEnemy(record, dt);

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 1.6;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 3.6 : 0.7);
  }

  updateEffects(dt, ctx.camera);
}

// Per-kind idle animation the movement code can't own: undulation, pulsing
// cores, thread stretch, charge lamps, and the Matriarch's body language.
function animateEnemy(record: EnemyRecord, dt: number) {
  const userData = record.mesh.userData;
  const kind = userData.kind as string | undefined;

  const segments = userData.lasherSegments as Mesh[] | undefined;
  if (segments) {
    const phase = (userData.swimPhase as number | undefined) ?? elapsedNow * 6;
    const amp = (userData.swimAmp as number | undefined) ?? 0.8;
    segments.forEach((segment, index) => {
      segment.position.x = Math.sin(phase - index * 0.72) * amp * (0.25 + index / segments.length);
    });
  }

  if (kind === 'cyst') {
    const core = userData.coreMesh as Mesh | undefined;
    const pulse = (userData.pulse as number | undefined) ?? elapsedNow;
    if (core) core.scale.setScalar(1 + Math.sin(pulse * 3.4) * 0.18);
    const thread = userData.threadMesh as Mesh | undefined;
    const threadTop = (userData.threadTop as number | undefined) ?? 4;
    if (thread) {
      thread.scale.y = threadTop;
      thread.position.y = 1.1 + threadTop / 2;
    }
  }

  if (kind === 'spitter') {
    const lamp = userData.chargeLamp as MeshBasicMaterial | undefined;
    const charge = (userData.charge as number | undefined) ?? 0;
    if (lamp && userData.locked !== true) {
      lamp.color.copy(PARASITE_CORE.clone().lerp(CORE_WHITE, charge * 0.6)).multiplyScalar(0.6 + charge * 2.4);
    }
  }

  if (kind === 'venom') {
    const wobble = (userData.wobble as number | undefined) ?? elapsedNow;
    const inner = record.mesh.children[0];
    if (inner) inner.scale.setScalar(1 + Math.sin(wobble * 11) * 0.12);
  }

  if (userData.isMatriarch) {
    updateMatriarchMesh(record.mesh, elapsedNow, dt);
  }
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with the current, kicks with the beat and the set pieces.
  const targetFovOffset = (speed - 0.95) * 6 + beatEnergy * 0.8 + surgePulse * 6;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 5));

  if (ctx.running && pullback < 0.001) {
    // Bank into the weave: roll follows the horizontal turn rate of the rail.
    const u = strandlineRunProgress(ctx.runTime);
    const t0 = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const t1 = rail.getTangentAt(MathUtils.clamp(u + 0.007, 0, 1));
    const crossY = t0.x * t1.z - t0.z * t1.x;
    const targetRoll = MathUtils.clamp(crossY * 34, -0.16, 0.16);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    camera.rotateZ(cameraRoll);
  }

  // The ending: after the severance the camera lets the rail go and drifts
  // back, and back, and back — the whole animal in frame for the first time.
  if (ctx.running && matriarchDeadAtRunTime >= 0) {
    const sinceKill = Math.max(0, ctx.runTime - matriarchDeadAtRunTime - 0.9);
    const target = MathUtils.clamp(sinceKill / 7, 0, 1);
    pullback = MathUtils.lerp(pullback, target, Math.min(1, dt * 1.2));
  }
  if (pullback > 0.001) {
    const ease = pullback * pullback * (3 - 2 * pullback);
    const radial = new Vector3(camera.position.x, 0, camera.position.z);
    if (radial.lengthSq() < 1) radial.set(1, 0, 0.4);
    radial.normalize();
    const vantage = radial.multiplyScalar(46 + 190 * ease);
    vantage.y = MathUtils.lerp(camera.position.y, 24, ease);
    camera.position.lerp(vantage, ease);
    const lookTarget = new Vector3(0, MathUtils.lerp(62, 32, ease), 0);
    camera.lookAt(lookTarget);
  }

  ctx.feel.setFovOffset(cameraFovOffset + pullback * 4);
  ctx.feel.update(dt, { shake: STRANDLINE_CAMERA_SHAKE });
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

  // Distance falloff keeps far additive stacks quiet; silhouettes carry.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 16) / (60 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_VIOLET);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(JELLY_GOLD, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(JELLY_GOLD.clone().multiplyScalar(0.24));
      else part.material.color.copy(hdr(CORE_WHITE, 1.9));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(CORE_WHITE, part.kind === 'fill' ? 0.5 : 1.7));
      continue;
    }
    const dim = part.kind === 'fill' ? 0.45 + 0.55 * closeness : 0.5 + 0.5 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockHalo(color: Color): Group {
  const group = new Group();
  // A ring of lamplight with three small orbit beads: the cleanse taking aim.
  const halo = new Mesh(
    new RingGeometry(0.8, 0.86, 40),
    createAdditiveBasicMaterial({ color: hdr(color, 1.6), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.6, 0.63, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(CORE_WHITE, 0.5), 1.2), side: DoubleSide }),
  );
  group.add(halo, inner);
  for (let i = 0; i < 3; i += 1) {
    const bead = new Mesh(
      new CircleGeometry(0.06, 10),
      createAdditiveBasicMaterial({ color: hdr(CORE_WHITE, 1.5) }),
    );
    const angle = (i / 3) * Math.PI * 2;
    bead.position.set(Math.cos(angle) * 0.83, Math.sin(angle) * 0.83, 0);
    group.add(bead);
  }
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
