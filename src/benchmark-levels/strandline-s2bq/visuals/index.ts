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
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  BELL_CENTER,
  REVEAL_TIME,
  SERENE_TIME,
  STRANDLINE_DURATION,
  STRANDLINE_PLAYER_HEALTH,
  createStrandlineRail,
  speedFactorAt,
  strandlineRunProgress,
} from '../gameplay';
import { BROOD_TOTAL } from '../matriarch';
import {
  crackCystShell,
  createBoltMesh,
  createBroodMesh,
  createCystMesh,
  createLeechMesh,
  createMatriarchMesh,
  createMiteMesh,
  createSpitterMesh,
  updateMatriarchMesh,
  type TintPart,
} from './enemies';
import {
  beatUniform,
  cleanseUniform,
  createEnvironmentInternal,
  type Environment,
} from './environment';
import {
  burstShards,
  burstSparks,
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
  BIO_GREEN,
  LOCK_GRADIENT,
  PARASITE_HOT,
  PARASITE_MURK,
  PARASITE_VIOLET,
  SUN_GOLD,
  VENOM_GREEN,
  WARM_WHITE,
  hdr,
} from './palette';
import { cleanseGradeUniform, flashUniform, venomUniform } from './post-fx';

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

const DENY_VIOLET = new Color(1.1, 0.24, 1.3);
const DENY_FILL = new Color(0.12, 0.03, 0.14);

let environment: Environment | null = null;
let beatEnergy = 0;
let surgePulse = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let elapsedNow = 0;
let hitsTaken = 0;
let venomPulse = 0;
let lastRunTime = -1;
let broodsKilled = 0;
let bossDead = false;
let pullback = 0;
const broodsAlive: boolean[] = Array.from({ length: BROOD_TOTAL }, () => true);
const broodIndexById = new Map<number, number>();
let nextBroodIndex = 0;

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
const LOOK_SCRATCH = new Object3D();

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

const KIND_SCALE: Record<string, number> = {
  leech: 1.3,
  mite: 1.35,
  spitter: 1.35,
  cyst: 1.3,
  bolt: 1.2,
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
    case 'leech':
      return createLeechMesh();
    case 'mite':
      return createMiteMesh();
    case 'spitter':
      return createSpitterMesh();
    case 'cyst':
      return createCystMesh();
    case 'bolt':
      return createBoltMesh();
    case 'brood':
      return createBroodMesh();
    case 'matriarch':
      return createMatriarchMesh();
    default:
      return createLeechMesh();
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

// Player shot: a dart of borrowed sunlight — warm white core in a gold sheath.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.2);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(WARM_WHITE, 2.4) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(SUN_GOLD, 1.0), opacity: 0.55 })));
  projectileRecords.enqueue({ mesh: group, trailColor: SUN_GOLD.clone().multiplyScalar(0.8) });
  return group;
}

// ---- reticle --------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  // A diatom sight: thin outer ring, three curved fins that spin while
  // tracking, a triangle of seed-motes, and a center point.
  const outer = new Mesh(new RingGeometry(0.62, 0.652, 48), new MeshBasicMaterial());
  addPart(outer, hdr(WARM_WHITE, 1.0));

  const fins = new Group();
  for (let i = 0; i < 3; i += 1) {
    const fin = new Mesh(new RingGeometry(0.44, 0.5, 24, 1, (i / 3) * Math.PI * 2, Math.PI * 0.42), new MeshBasicMaterial());
    addPart(fin, hdr(SUN_GOLD, 1.05));
    fins.add(fin);
  }

  const seeds = new Group();
  for (let i = 0; i < 3; i += 1) {
    const seed = new Mesh(new CircleGeometry(0.05, 10), new MeshBasicMaterial());
    addPart(seed, hdr(BIO_GREEN, 1.2));
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    seed.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    seeds.add(seed);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 14), new MeshBasicMaterial());
  addPart(dot, hdr(WARM_WHITE, 1.8));

  group.add(outer, fins, seeds, dot);
  group.userData.parts = parts;
  group.userData.spinner = fins;
  group.userData.ticks = seeds;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  // Charging walks the sight white → gold → bio-green: six locks reads as a
  // full breath of sunlight ready to be given back to the animal.
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.25));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
}

// ---- event wiring ----------------------------------------------------------------

function currentCleanse() {
  return Math.min(1, (broodsKilled / BROOD_TOTAL) * 0.45 + (bossDead ? 0.55 : 0));
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'matriarch') {
      // The crown comes into focus: the frame shudders as she digs in.
      cameraFeel.shake(1.0, STRANDLINE_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 1.2), 26, 0.9);
      spawnRing(worldPosition, hdr(PARASITE_HOT, 0.9), 14, 0.7);
    } else if (kind === 'brood') {
      broodIndexById.set(enemyId, nextBroodIndex);
      nextBroodIndex += 1;
      spawnRing(worldPosition, hdr(PARASITE_HOT, 1.0), 3.4, 0.4);
      spawnInk(worldPosition, 3.2, 1.0, 0.4);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 0.6), 2.2, 0.35);
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
    spawnGlint(worldPosition, hdr(WARM_WHITE, 1.1), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(SUN_GOLD, 0.85), 5, 8);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(WARM_WHITE, 1.6), 1.0, 0.15);
      if (record.mesh.userData.kind === 'cyst' && !record.mesh.userData.crackedShown) {
        record.mesh.userData.crackedShown = true;
        crackCystShell(record.mesh);
        burstSparks(worldPosition, hdr(PARASITE_VIOLET, 1.0), 8, 10);
        spawnInk(worldPosition, 2.6, 1.2, 0.45);
      }
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.isMatriarch) {
      // Her forward grip tears free; the water slams.
      cameraFeel.shake(1.0, STRANDLINE_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.45);
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      spawnRing(worldPosition, hdr(PARASITE_HOT, 1.4), 22, 0.8);
      burstSparks(worldPosition, hdr(WARM_WHITE, 1.1), 20, 16);
      spawnInk(worldPosition, 9, 1.8, 0.55);
      spawnSinkingHusk(worldPosition, 1.6, 4);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? PARASITE_HOT;
      burstSparks(worldPosition, hdr(accent, 0.95), 8, 10);
      spawnRing(worldPosition, hdr(accent, 0.85), 4.2, 0.4);
      spawnGlint(worldPosition, hdr(WARM_WHITE, 1.4), 1.1, 0.16);
      spawnInk(worldPosition, 3.4, 1.5, 0.5);

      const broodIndex = broodIndexById.get(enemyId);
      if (broodIndex !== undefined) {
        broodsAlive[broodIndex] = false;
        broodsKilled += 1;
        // The curtain this brood fed starves with it; a green pulse answers
        // up the strands as a little more of the animal comes back.
        spawnRing(worldPosition, hdr(BIO_GREEN, 1.1), 8, 0.6);
        flashUniform.value = Math.max(flashUniform.value, 0.12);
      }

      if (record.mesh.userData.isMatriarch) {
        // The tear-loose: the whole animal lights up at once.
        bossDead = true;
        cameraFeel.shake(1.6, STRANDLINE_CAMERA_SHAKE);
        surgePulse = 1.0;
        flashUniform.value = Math.max(flashUniform.value, 0.9);
        spawnRing(worldPosition, hdr(WARM_WHITE, 1.5), 60, 1.4);
        spawnRing(worldPosition, hdr(BIO_GREEN, 1.2), 38, 1.1);
        spawnRing(worldPosition, hdr(PARASITE_HOT, 0.9), 20, 0.8);
        spawnGlint(worldPosition, hdr(WARM_WHITE, 2.2), 6, 0.5);
        burstSparks(worldPosition, hdr(BIO_GREEN, 1.1), 46, 24, 3);
        spawnInk(worldPosition, 16, 2.4, 0.6);
        spawnSinkingHusk(worldPosition, 4.6, 6);
      } else if (record.mesh.userData.kind === 'spitter' || record.mesh.userData.kind === 'cyst') {
        spawnSinkingHusk(worldPosition, 1.2, -3);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstSparks(worldPosition, PARASITE_MURK.clone().multiplyScalar(0.9), 3, 3, -0.8);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.15);
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
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    venomUniform.value = 0;
    cleanseGradeUniform.value = 0;
    cleanseUniform.value = 0;
    surgePulse = 0;
    hitsTaken = 0;
    venomPulse = 0;
    lastRunTime = -1;
    broodsKilled = 0;
    bossDead = false;
    pullback = 0;
    broodsAlive.fill(true);
    broodIndexById.clear();
    nextBroodIndex = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame update -------------------------------------------------------------

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
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const cleanse = currentCleanse();
  cleanseUniform.value = MathUtils.lerp(cleanseUniform.value as number, cleanse, Math.min(1, dt * 1.2));

  // The reveal: crossing bar 8, the forest opens and the light swells once.
  if (ctx.running && lastRunTime >= 0 && lastRunTime < REVEAL_TIME && runTime >= REVEAL_TIME) {
    flashUniform.value = Math.max(flashUniform.value, 0.4);
    surgePulse = Math.max(surgePulse, 0.6);
  }
  if (ctx.running) lastRunTime = runTime;

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    speed: ctx.running ? speedFactorAt(runTime) : 0.5,
    beatEnergy,
    cleanse: cleanseUniform.value as number,
    broodsAlive,
    bossDead,
  });

  // Post grade: cleansing warms the frame; venom presses in when hurt.
  cleanseGradeUniform.value = (cleanseUniform.value as number) * 0.7;
  venomUniform.value = Math.min(1, venomPulse * 0.7 + Math.min(1, hitsTaken / STRANDLINE_PLAYER_HEALTH) * 0.08);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.4 : 2.2));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);

    // Spitter telegraph: glands swell venom-bright before each spit.
    if (record.mesh.userData.kind === 'spitter') {
      const gland = record.mesh.userData.chargeGland as MeshBasicMaterial | undefined;
      const lip = record.mesh.userData.siphonLip as MeshBasicMaterial | undefined;
      const charge = (record.mesh.userData.charge as number | undefined) ?? 0;
      if (gland && record.mesh.userData.locked !== true) {
        gland.color.copy(VENOM_GREEN.clone().lerp(WARM_WHITE, charge * 0.4)).multiplyScalar(0.3 + charge * 1.8);
      }
      if (lip && record.mesh.userData.locked !== true) {
        lip.color.copy(hdr(VENOM_GREEN, 0.8 + charge * 2.2));
      }
    }

    if (record.mesh.userData.isMatriarch) {
      updateMatriarchMesh(record.mesh, elapsedNow);
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

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
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 3.6 : 0.7);
    const seeds = reticleSpinner.parent?.userData.ticks as Group | undefined;
    if (seeds) seeds.rotation.z -= dt * (active ? 2.0 : 0.4);
  }

  updateEffects(dt, ctx.camera);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with the current, kicks with the set pieces; the serene
  // pull-back opens the frame wide for the whole animal.
  const targetFovOffset = (speed - 0.9) * 6 + beatEnergy * 0.8 + surgePulse * 5.5 + pullback * 9;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 5));

  if (ctx.running) {
    // Bank into the winding of the strands; the water stills near the end.
    const u = strandlineRunProgress(ctx.runTime, STRANDLINE_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.16, 0.16) * (1 - pullback);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    camera.rotateZ(cameraRoll);

    // The camera pulls back, and back — and turns to watch the freed animal.
    const pullTarget = MathUtils.clamp((ctx.runTime - SERENE_TIME) / 2.4, 0, 1);
    pullback = MathUtils.lerp(pullback, pullTarget, Math.min(1, dt * 1.6));
    if (pullback > 0.001) {
      LOOK_SCRATCH.position.copy(camera.position);
      LOOK_SCRATCH.lookAt(bellFocus());
      camera.quaternion.slerp(LOOK_SCRATCH.quaternion, pullback * 0.9);
    }
  } else {
    pullback = 0;
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: STRANDLINE_CAMERA_SHAKE });
}

const BELL_FOCUS = new Vector3();
function bellFocus() {
  // Aim between the bell and its crown so the dome and the strand roots both
  // sit in frame during the pull-away.
  return BELL_FOCUS.copy(BELL_CENTER).add(new Vector3(0, -14, 0));
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
      if (part.kind === 'edge') part.material.color.copy(hdr(SUN_GOLD, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(SUN_GOLD.clone().multiplyScalar(0.22));
      else part.material.color.copy(hdr(WARM_WHITE, 1.9));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(WARM_WHITE, part.kind === 'fill' ? 0.5 : 1.7));
      continue;
    }
    const dim = 0.5 + 0.5 * closeness;
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
  // An organic lock halo: a fine circle and a slow triangle of light.
  const ring = new Mesh(
    new RingGeometry(0.8, 0.85, 40),
    createAdditiveBasicMaterial({ color: hdr(color, 1.6), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.6, 0.63, 3),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WARM_WHITE, 0.5), 1.3), side: DoubleSide }),
  );
  group.add(ring, inner);
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
