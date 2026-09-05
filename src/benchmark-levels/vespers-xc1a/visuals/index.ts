import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { mulberry32 } from '../../../engine/rng';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createVespersRail, ROSE_CENTER, vespersRunProgress, VESPERS_RUN_DURATION, type Pane } from '../gameplay';
import {
  applyPane,
  createCenserMesh,
  createCinderMesh,
  createEyeMesh,
  createFlameShotMesh,
  createMothMesh,
  createPetalMesh,
  createShadeMesh,
  createShardMesh,
  type TintPart,
} from './enemies';
import { beatUniform, candleUniform, createEnvironmentInternal, type Environment, type WindowRecord } from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  spawnStreak,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { BLOOD, BOTTLE, COBALT, EMBER_RED, GOLD, hdr, LOCK_GRADIENT, PANE_COLORS, VIOLET, WHITE_HOT } from './palette';
import { flashUniform, warmthUniform } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  running: boolean;
  attract: boolean;
  runProgress: number;
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

const DENY_PANE = new Color(0.55, 0.05, 0.03);
const DENY_RIM = new Color(1.4, 0.1, 0.05);
const RETICLE_PETALS = [COBALT, BLOOD, BOTTLE, GOLD, VIOLET, WHITE_HOT];

const VESPERS_SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.6,
  frequency: 7.5,
  smoothing: 18,
};

let environment: Environment | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let surge = 0; // FOV push from set pieces
let warmthTarget = 0;
let candleBase = 0;
let ignitionAt = -1;
let cameraRoll = 0;
let cameraFovOffset = 0;
// The shut eye nested in the rose. It is scenery: the real target only
// exists on screen while the eye is open.
let dormantEye: Group | null = null;
let dormantSeen = false;
const attractRng = mulberry32(7);
const rail = createVespersRail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it, so pairing this queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  environment.resetForAttract();
  createEffects(scene);
  dormantEye = createEyeMesh();
  dormantEye.position.copy(ROSE_CENTER);
  dormantEye.visible = false;
  dormantEye.userData.raildIgnoreOcclusion = true;
  scene.add(dormantEye);
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
      return createLetterMesh(letter ?? 'V');
    case 'shade':
      return createShadeMesh();
    case 'moth':
      return createMothMesh();
    case 'censer':
      return createCenserMesh();
    case 'cinder':
      return createCinderMesh();
    case 'shard':
      return createShardMesh();
    case 'petal':
      return createPetalMesh();
    case 'eye':
      return createEyeMesh();
    default:
      return createShadeMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RIM.clone(), 2.6, 0.3);
}

export function createProjectileMesh() {
  const group = createFlameShotMesh();
  projectileRecords.enqueue({ mesh: group, trailColor: GOLD.clone().multiplyScalar(0.8) });
  return group;
}

// ---- reticle: a small rose window ----------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.64, 0.68, 48), new MeshBasicMaterial());
  addPart(outer, hdr(GOLD, 1.0));
  const inner = new Mesh(new RingGeometry(0.2, 0.225, 32), new MeshBasicMaterial());
  addPart(inner, hdr(GOLD, 0.8));

  // Six petals fill with the stolen colours, one per lock.
  const petals = new Group();
  const petalMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const petal = new Mesh(new RingGeometry(0.25, 0.58, 10, 1, (i / 6) * Math.PI * 2 + 0.07, Math.PI / 3 - 0.14), new MeshBasicMaterial());
    const material = configureAdditiveMaterial(petal.material as MeshBasicMaterial, { color: hdr(GOLD, 0.08), side: DoubleSide });
    petalMaterials.push(material);
    petals.add(petal);
  }
  const spokes = new Group();
  for (let i = 0; i < 6; i += 1) {
    const spoke = new Mesh(new PlaneGeometry(0.42, 0.028), new MeshBasicMaterial());
    addPart(spoke, hdr(GOLD, 0.9));
    const angle = (i / 6) * Math.PI * 2;
    spoke.position.set(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0);
    spoke.rotation.z = angle;
    spokes.add(spoke);
  }
  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(WHITE_HOT, 1.8));

  group.add(outer, inner, petals, spokes, dot);
  group.userData.parts = parts;
  group.userData.petalMaterials = petalMaterials;
  group.userData.spinner = spokes;
  group.userData.petals = petals;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.5 : 1.2));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
  const petals = reticle.userData.petalMaterials as MeshBasicMaterial[];
  petals.forEach((material, index) => {
    const lit = index < lockCount;
    material.color.copy(lit ? hdr(RETICLE_PETALS[index], lockCount === 6 ? 1.6 : 1.1) : hdr(GOLD, active ? 0.14 : 0.08));
  });
}

// ---- event wiring ------------------------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || !environment) return;
    const pane = (record.mesh.userData.pane as Pane | undefined) ?? 'gold';
    if (kind === 'shade' || kind === 'moth' || kind === 'censer' || kind === 'petal') {
      // The enemy comes off the glass: claim a window ahead, and if that
      // window was still burning, it goes out now.
      const reach = kind === 'petal' ? { behind: 90, ahead: 12 } : { behind: 48, ahead: 8 };
      const window = environment.claimWindow(enemyId, worldPosition, reach, PANE_COLORS[pane]);
      if (window) {
        const wasLit = window.target >= 0.99;
        environment.darkenWindow(window);
        const at = window.center.clone().addScaledVector(window.normal, 0.6);
        spawnRing(at, hdr(window.color, wasLit ? 1.0 : 0.5), wasLit ? 7 : 4, 0.55);
        burstShards(at, undefined, wasLit ? 8 : 4, 0.6, attractRng);
        if (wasLit) burstSparks(at, hdr(window.color, 0.6), 10, 6, 6, attractRng);
      }
      spawnRing(worldPosition, hdr(PANE_COLORS[pane], 0.7), 2.4, 0.4);
    } else if (kind === 'eye') {
      feel.shake(0.7, VESPERS_SHAKE);
      surge = Math.max(surge, 0.6);
      spawnRing(ROSE_CENTER, hdr(BLOOD, 1.2), 26, 1.1);
      spawnRing(ROSE_CENTER, hdr(EMBER_RED, 0.8), 14, 0.8);
      burstShards(ROSE_CENTER, undefined, 24, 1.1, attractRng);
      if (dormantEye) {
        dormantEye.visible = true;
        dormantEye.userData.bornAt = elapsedNow;
      }
    } else if (kind === 'shard') {
      spawnRing(worldPosition, hdr(BLOOD, 0.9), 2.2, 0.3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.0, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(WHITE_HOT, 1.1), 0.45, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) return;
    burstSparks(worldPosition, hdr(WHITE_HOT, 0.9), 6, 9, 5);
    if (!record) return;
    record.mesh.userData.damageFlashUntil = elapsedNow + 0.32;
    spawnGlint(worldPosition, hdr(WHITE_HOT, 1.6), 1.0, 0.16);
    if (record.mesh.userData.isEye) {
      feel.shake(0.3, VESPERS_SHAKE);
      spawnRing(worldPosition, hdr(WHITE_HOT, 1.0), 6, 0.35);
      burstShards(worldPosition, undefined, 6, 0.8, attractRng);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record?.mesh.userData.isEye) return;
    feel.shake(0.9, VESPERS_SHAKE);
    surge = Math.max(surge, 0.5);
    flashUniform.value = Math.max(flashUniform.value, 0.22);
    spawnRing(worldPosition, hdr(BLOOD, 1.5), 22, 0.9);
    spawnRing(worldPosition, hdr(WHITE_HOT, 0.9), 10, 0.5);
    burstShards(worldPosition, undefined, 30, 1.2, attractRng);
    burstSparks(worldPosition, hdr(BLOOD, 1.1), 40, 16, 8);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || !environment) return;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? GOLD;
    const directions = record.mesh.userData.shardDirections as Vector3[] | undefined;
    const kind = record.mesh.userData.kind as string;

    if (record.mesh.userData.isEye) {
      ignite(worldPosition, feel);
    } else {
      // The black body breaks; the colour flies home.
      burstShards(worldPosition, directions, 8, kind === 'petal' ? 1.1 : kind === 'censer' ? 0.9 : 0.65, attractRng);
      burstSparks(worldPosition, hdr(accent, 1.1), kind === 'petal' ? 22 : 14, 10, 5);
      spawnRing(worldPosition, hdr(accent, 0.9), kind === 'petal' ? 6 : 4.2, 0.45);
      spawnGlint(worldPosition, hdr(WHITE_HOT, 1.2), 1.0, 0.16);
      const window = environment.windowFor(enemyId);
      if (window) {
        const target = window.center.clone().addScaledVector(window.normal, 0.7);
        const life = 0.42 + worldPosition.distanceTo(target) * 0.006;
        spawnStreak(worldPosition, target, hdr(window.color, 1.0), life, () => {
          environment?.igniteWindow(window, 1.1);
          spawnRing(target, hdr(window.color, 1.5), 9, 0.6);
          spawnGlint(target, hdr(WHITE_HOT, 1.8), 2.2, 0.24);
          burstSparks(target, hdr(window.color, 1.0), 18, 7, 4);
          candleBase = Math.max(candleBase, 0.25);
        });
      }
      if (kind === 'petal') feel.shake(0.35, VESPERS_SHAKE);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    const window = environment?.releaseWindow(enemyId);
    if (window) environment?.darkenWindow(window);
    burstShards(worldPosition, undefined, 4, 0.5, attractRng);
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < 4 || kills < size) return;
    feel.kickFov(2 + size * 0.5);
    flashUniform.value = Math.max(flashUniform.value, size === 6 ? 0.26 : 0.12);
    candleBase = Math.max(candleBase, size === 6 ? 0.7 : 0.35);
    beatEnergy = Math.max(beatEnergy, 1.4);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    feel.shake(1.1, VESPERS_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'exposed') return;
    for (const record of enemyRecords.values()) {
      if (!record.mesh.userData.isEye) continue;
      spawnRing(record.mesh.position, hdr(WHITE_HOT, 1.4), 12, 0.6);
      spawnGlint(record.mesh.position, hdr(WHITE_HOT, 2.2), 3.5, 0.3);
      burstSparks(record.mesh.position, hdr(WHITE_HOT, 1.0), 30, 14, 3);
    }
    surge = Math.max(surge, 0.35);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    environment?.resetForRun();
    flashUniform.value = 0;
    warmthUniform.value = 0;
    warmthTarget = 0;
    candleUniform.value = 0;
    candleBase = 0;
    surge = 0;
    ignitionAt = -1;
    cameraRoll = 0;
    cameraFovOffset = 0;
    if (dormantEye) dormantEye.visible = false;
    dormantSeen = false;
    feel.restore();
  });

  bus.on('runend', () => {
    feel.restore();
  });
}

// The biggest single event in the level: the rose ignites, the light runs
// back down the nave, the candles flare, the frame goes warm.
function ignite(position: Vector3, feel: CameraFeelRig) {
  if (!environment) return;
  ignitionAt = elapsedNow;
  if (dormantEye) dormantEye.visible = false;
  environment.igniteRose(elapsedNow);
  warmthTarget = 1;
  candleBase = 1.3;
  surge = 1.0;
  flashUniform.value = Math.max(flashUniform.value, 1.25);
  feel.shake(1.5, VESPERS_SHAKE);
  feel.kickFov(8, { decay: 1.6 });
  spawnRing(position, hdr(WHITE_HOT, 1.7), 70, 1.5);
  spawnRing(position, hdr(GOLD, 1.3), 46, 1.2);
  spawnRing(position, hdr(COBALT, 1.0), 30, 0.9);
  spawnGlint(position, hdr(WHITE_HOT, 2.6), 9, 0.6);
  for (const color of [COBALT, BLOOD, BOTTLE, GOLD, VIOLET]) burstSparks(position, hdr(color, 1.3), 40, 24, 6);
  burstShards(position, undefined, 40, 1.4, attractRng);
}

// ---- per-frame update -----------------------------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);
  surge = Math.max(0, surge - dt * 0.7);
  beatUniform.value = beatEnergy;

  const candleFloor = warmthTarget * 0.22;
  candleBase = Math.max(candleFloor, candleBase - dt * 0.9);
  candleUniform.value = candleBase + beatEnergy * 0.08;
  warmthUniform.value += (warmthTarget - warmthUniform.value) * Math.min(1, dt * 0.8);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.3 : 2.2));
  if (ignitionAt >= 0) {
    const since = elapsedNow - ignitionAt;
    if (since < 2.2) flashUniform.value = Math.max(flashUniform.value, 0.3 * (1 - since / 2.2));
  }

  if (environment) {
    environment.update(dt, elapsedNow, beatEnergy);
    if (ctx.attract) environment.attractTick(dt, attractRng);
  }

  const camera = ctx.camera as PerspectiveCamera;
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const userData = record.mesh.userData;
    const emerge = (userData.emerge as number | undefined) ?? 1;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.45)) * (0.25 + 0.75 * emerge));

    const pane = userData.pane as Pane | undefined;
    if (pane && userData.paneApplied !== pane) {
      userData.paneApplied = pane;
      applyPane(record.mesh, PANE_COLORS[pane]);
    }

    updateEnemyTint(record, camera, dt);
    updateEnemyMotionDetail(record, dt);
    if (userData.isEye) syncDormantEye(record, camera, dt);

    if (userData.isHostileShot) dropTrail(record.mesh.position, userData.trailColor as Color, 0.4);

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 1.8;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = (userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.7 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor, 0.5);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 1.6 : 0.35);
    const petals = reticleSpinner.parent?.userData.petals as Group | undefined;
    if (petals) petals.rotation.z -= dt * (active ? 0.9 : 0.2);
  }

  if (!ctx.running) idleCameraFeel(dt, ctx.feel);
  updateEffects(dt, ctx.camera);
}

function idleCameraFeel(dt: number, rig: CameraFeelRig) {
  rig.setFovOffset(surge * 5 + beatEnergy * 0.4);
  rig.update(dt, { shake: VESPERS_SHAKE });
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  // The frame breathes with the counterpoint and pushes on set pieces; the
  // camera banks a little into the nave's weave.
  const targetFov = beatEnergy * 0.55 + surge * 6;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFov, Math.min(1, dt * 6));
  if (ctx.running) {
    const u = vespersRunProgress(ctx.runTime, VESPERS_RUN_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.008, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 22, -0.12, 0.12);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    ctx.camera.rotateZ(cameraRoll);
  }
  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: VESPERS_SHAKE });
}

function updateEnemyTint(record: EnemyRecord, camera: PerspectiveCamera, dt: number) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;
  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }
  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff keeps a far pane from blobbing under bloom; danger
  // tint pulls incoming shots toward ember red as they close.
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smootherstep(1 - clamp01((distance - 14) / (62 - 14)));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const thrown = Math.max(0, 1 - (elapsedNow - ((userData.throwAt as number | undefined) ?? -Infinity)) / 0.5);
  const danger = userData.isHostileShot ? smootherstep(1 - clamp01((distance - 3) / (26 - 3))) : 0;
  const beat = 1 + beatEnergy * 0.1;

  for (const part of parts) {
    if (part.kind === 'body') continue;
    if (denied) {
      part.material.color.copy(part.kind === 'rim' ? DENY_RIM : DENY_PANE);
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(WHITE_HOT, part.kind === 'glow' ? 0.6 : 2.2));
      continue;
    }
    if (locked) {
      if (part.kind === 'pane') part.material.color.copy(part.base).lerp(hdr(WHITE_HOT, 2.4), 0.55);
      else if (part.kind === 'rim') part.material.color.copy(hdr(GOLD, 1.5));
      else part.material.color.copy(part.base).multiplyScalar(2.2);
      continue;
    }
    const dim = part.kind === 'rim' ? 0.5 + 0.5 * closeness : part.kind === 'glow' ? 0.3 + 0.7 * closeness : 0.55 + 0.45 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim * beat * (1 + thrown * 0.9));
    if (danger > 0) part.material.color.lerp(hdr(EMBER_RED, part.kind === 'glow' ? 1.0 : 2.4), danger * 0.8);
  }
  void dt;
}

// The stand-in mirrors the real eye's state while the target is parked
// behind the camera; when the eye opens the target appears in its place.
function syncDormantEye(record: EnemyRecord, camera: PerspectiveCamera, dt: number) {
  if (!dormantEye) return;
  const userData = record.mesh.userData;
  const dormant = userData.dormant !== false;
  dormantEye.visible = dormant;
  if (!dormant) {
    dormantSeen = false;
    return;
  }
  const rosePosition = userData.rosePosition as Vector3 | undefined;
  if (rosePosition) dormantEye.position.copy(rosePosition);
  dormantEye.quaternion.copy(camera.quaternion);
  dormantEye.rotateZ(Math.sin(elapsedNow * 0.3) * 0.08);
  const bornAt = (dormantEye.userData.bornAt as number | undefined) ?? elapsedNow;
  dormantEye.scale.setScalar(easeOutBack(Math.min(1, (elapsedNow - bornAt) / 0.8)));
  dormantEye.userData.exposed = false;
  dormantEye.userData.wake = userData.wake;
  dormantEye.userData.sink = userData.sink;
  updateEnemyMotionDetail({ mesh: dormantEye, bornAt, lockRing: null }, dt);
  const parts = dormantEye.userData.parts as TintPart[] | undefined;
  if (parts) for (const part of parts) if (part.kind !== 'body') part.material.color.copy(part.base);
  dormantSeen = true;
}

function updateEnemyMotionDetail(record: EnemyRecord, dt: number) {
  const userData = record.mesh.userData;
  const wings = userData.wings as Group[] | undefined;
  if (wings) {
    const flap = Math.sin(((userData.flap as number | undefined) ?? elapsedNow) * 15) * 0.95;
    wings[0].rotation.y = flap;
    wings[1].rotation.y = -flap;
  }
  const crust = userData.crust as Group | undefined;
  if (crust) crust.rotation.z += dt * 5;
  const slits = userData.slits as Mesh[] | undefined;
  if (slits) {
    const swing = (userData.swing as number | undefined) ?? 0;
    for (const slit of slits) slit.scale.y = 0.85 + 0.15 * Math.cos(swing * 2);
  }
  const eye = userData.eye as { pupil: Mesh; pupilMaterial: MeshBasicMaterial; pupilGlowMaterial: MeshBasicMaterial; iris: Mesh; irisMaterial: MeshBasicMaterial } | undefined;
  if (eye) {
    const exposed = userData.exposed === true;
    const wake = (userData.wake as number | undefined) ?? 1;
    const sink = (userData.sink as number | undefined) ?? 0;
    const teeth = userData.teeth as Group | undefined;
    const veins = userData.veins as Group | undefined;
    if (teeth) teeth.rotation.z += dt * (exposed ? 0.6 : 0.12);
    if (veins) veins.rotation.z -= dt * (exposed ? 0.4 : 0.08);
    const open = MathUtils.clamp(((userData.openness as number | undefined) ?? 0) + (exposed ? dt * 3 : -dt * 4), 0, 1);
    userData.openness = open;
    eye.pupil.scale.setScalar(1 - sink * 0.5);
    eye.pupilMaterial.color.copy(new Color(0.01, 0.01, 0.012)).lerp(hdr(WHITE_HOT, 2.8), open);
    eye.pupilGlowMaterial.color.copy(hdr(WHITE_HOT, 0.9 + Math.sin(elapsedNow * 6) * 0.15)).multiplyScalar(open);
    const irisPulse = 0.35 + wake * 0.5 + Math.sin(elapsedNow * 2.4) * 0.12 + open * 0.5;
    eye.irisMaterial.color.copy(hdr(BLOOD, irisPulse * (1 - sink * 0.6)));
    record.mesh.scale.multiplyScalar(1 - sink * 0.3);
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

// A lock is a lead frame closing on the pane: a ring with four cusps.
function makeLockRing(color: Color): Group {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.86, 0.915, 40),
    createAdditiveBasicMaterial({ color: hdr(color, 1.6), side: DoubleSide }),
  );
  group.add(ring);
  for (let i = 0; i < 4; i += 1) {
    const cusp = new Mesh(new PlaneGeometry(0.2, 0.04), createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WHITE_HOT, 0.5), 1.5), side: DoubleSide }));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    cusp.position.set(Math.cos(angle) * 0.98, Math.sin(angle) * 0.98, 0);
    cusp.rotation.z = angle;
    group.add(cusp);
  }
  return group;
}

// Debug preview: light the rose (and the wave down the nave) at run start.
export function previewIgnition(feel: CameraFeelRig) {
  ignite(ROSE_CENTER.clone(), feel);
}

export function windowRecordFor(enemyId: number): WindowRecord | undefined {
  return environment?.windowFor(enemyId);
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
