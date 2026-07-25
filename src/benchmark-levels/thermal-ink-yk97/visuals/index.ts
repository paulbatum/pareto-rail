import {
  CircleGeometry,
  Color,
  DoubleSide,
  FogExp2,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createThermalRail } from '../gameplay';
import { bossCenter } from '../octopus';
import { infraredAt, inkAt } from '../timing';
import {
  applyLockSpecs,
  createDredgerMesh,
  createHarpoonMesh,
  createInkshotMesh,
  createLurkerMesh,
  createSkimmerMesh,
} from './enemies';
import {
  burstInk,
  burstSparks,
  createEffects,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import { createEnvironmentInternal, type Environment } from './environment';
import { createLetterMesh, flashLetterDenied, setLetterLocked } from './letters';
import { applyModeList, collectModed, type ModedEntry } from './moded';
import { createArmMesh, createCoreMesh, createOctopusBody, updateCoreMesh, type OctopusBody } from './octopus';
import { ATMOS, CREAM, hdr, INK_BLACK, IR_HOT, LAMP, RUST, SIGNAL_RED } from './palette';
import { blindUniform, flashUniform, irUniform } from './post-fx';

export { composeThermalOutput } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runTime: number;
  running: boolean;
  runProgress: number;
};

type EnemyRecord = {
  mesh: Group;
  moded: ModedEntry[];
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Group;
  moded: ModedEntry[];
};

let environment: Environment | null = null;
let bossBody: OctopusBody | null = null;
let railCurve: ReturnType<typeof createThermalRail> | null = null;

let elapsedNow = 0;
let beatEnergy = 0;
let pendingTrauma = 0;
let irSmooth = 0;
let blindSmooth = 0;
let lampBoost = 0;
let flashLevel = 0;
let coreKilled = false;
let lastInkLevel = 0;

const bossPosition = new Vector3();
const atmosphereBackground = new Color();
const atmosphereFog = new Color();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// Enemy geometries are shared at module scope, so disposal only releases the
// per-mesh materials (plus the few merged geometries letters own).
function disposeMeshResources(root: Object3D) {
  root.traverse((node) => {
    const mesh = node as Object3D & { geometry?: { dispose(): void }; material?: unknown };
    if (node.userData.ownsGeometry === true) mesh.geometry?.dispose();
    const materials = mesh.material === undefined
      ? []
      : Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
    for (const material of materials) (material as { dispose(): void }).dispose();
  });
}

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<{ mesh: Group; moded: ModedEntry[] }, EnemyRecord>({
  createRecord: (pending) => ({ mesh: pending.mesh, moded: pending.moded, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    disposeMeshResources(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  disposeRecord: (record) => disposeMeshResources(record.mesh),
});

// ---- ink cloud blobs --------------------------------------------------------

type InkBlob = { mesh: Mesh; material: MeshBasicMaterial; velocity: Vector3; weight: number };
const inkBlobs: InkBlob[] = [];
const inkBlobGeometry = new SphereGeometry(1, 9, 7);

function createInkBlobs(scene: Scene) {
  for (let i = 0; i < 8; i += 1) {
    const material = new MeshBasicMaterial({
      color: INK_BLACK.clone().multiplyScalar(0.5 + (i % 4) * 0.16),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(inkBlobGeometry, material);
    mesh.scale.setScalar(2.6 + (i % 5) * 1.1);
    mesh.visible = false;
    scene.add(mesh);
    inkBlobs.push({ mesh, material, velocity: new Vector3(), weight: 0.5 + ((i * 7) % 10) / 18 });
  }
}

function ejectInk(camera: Camera) {
  for (const blob of inkBlobs) {
    blob.mesh.visible = true;
    blob.mesh.position
      .copy(bossPosition)
      .add(new Vector3((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 5 - 1.5, (Math.random() - 0.5) * 5));
    blob.velocity
      .copy(camera.position)
      .sub(bossPosition)
      .normalize()
      .multiplyScalar(7 + Math.random() * 8)
      .add(new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6));
  }
}

function updateInkBlobs(dt: number, inkLevel: number, irLevel: number, camera: Camera) {
  for (const blob of inkBlobs) {
    blob.mesh.position.addScaledVector(blob.velocity, dt);
    blob.velocity.multiplyScalar(1 - dt * 0.85);
    // The cloud carries the blind beat; once the lens is up it thins to cold
    // drifting patches, and a blob parked on the camera fades instead of
    // blacking out the thermal view.
    const nearFade = MathUtils.clamp((blob.mesh.position.distanceTo(camera.position) - 4) / 9, 0, 1);
    const target = inkLevel * 0.72 * blob.weight * (1 - irLevel * 0.9) * nearFade;
    blob.material.opacity += (target - blob.material.opacity) * Math.min(1, dt * 4);
    if (blob.material.opacity < 0.01 && inkLevel < 0.02) blob.mesh.visible = false;
  }
}

// ---- environment ------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  railCurve = createThermalRail();
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  bossBody = createOctopusBody();
  bossBody.root.userData.moded = true;
  scene.add(bossBody.root);
  createInkBlobs(scene);
}

const bossModed = (): ModedEntry[] => {
  if (!bossBody) return [];
  if (!bossBody.root.userData.modedEntries) bossBody.root.userData.modedEntries = collectModed(bossBody.root);
  return bossBody.root.userData.modedEntries as ModedEntry[];
};

// ---- factories --------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue({ mesh, moded: collectModed(mesh) });
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'skimmer':
      return createSkimmerMesh();
    case 'lurker':
      return createLurkerMesh();
    case 'dredger':
      return createDredgerMesh();
    case 'inkshot':
      return createInkshotMesh();
    case 'arm':
      return createArmMesh();
    case 'core':
      return createCoreMesh();
    default:
      return createSkimmerMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  applyLockSpecs(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.getWorldPosition(new Vector3()), hdr(RUST, 1.4), 2.6, 0.32);
}

export function createProjectileMesh() {
  const mesh = createHarpoonMesh();
  projectileRecords.enqueue({ mesh, moded: collectModed(mesh) });
  return mesh;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];
  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(base);
    parts.push({ material, base, active });
  };

  const outer = new Mesh(new RingGeometry(0.58, 0.625, 44), createAdditiveBasicMaterial({ color: CREAM, side: DoubleSide }));
  addPart(outer, hdr(CREAM, 1.0), hdr(LAMP, 1.7));

  // Sonar sweep: a wedge that spins inside the ring, the level's lens language.
  const spinner = new Group();
  const wedge = new Mesh(new RingGeometry(0.36, 0.5, 14, 1, 0, Math.PI / 3), createAdditiveBasicMaterial({ color: LAMP, opacity: 0.55, side: DoubleSide }));
  addPart(wedge, hdr(LAMP, 0.8), hdr(SIGNAL_RED, 1.7));
  spinner.add(wedge);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.17, 0.04), createAdditiveBasicMaterial({ color: CREAM, side: DoubleSide }));
    addPart(tick, hdr(CREAM, 1.2), hdr(SIGNAL_RED, 2.0));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.74, Math.sin(angle) * 0.74, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 16), createAdditiveBasicMaterial({ color: CREAM }));
  addPart(dot, hdr(CREAM, 1.8), hdr(IR_HOT, 2.6));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) part.material.color.copy(active ? part.active : part.base);
}

// ---- event choreography -----------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  const accentAt = (record: EnemyRecord | undefined, fallback: Color) => {
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? fallback;
    return accent.clone().lerp(IR_HOT, irSmooth * 0.8);
  };

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    enemyRecords.claim(enemyId);
    if (kind === 'arm') {
      spawnRing(worldPosition, hdr(RUST, 1.5).lerp(hdr(IR_HOT, 1.2), irSmooth), 4.2, 0.5);
      burstInk(worldPosition, 5, 4);
      pendingTrauma += 0.12;
    } else if (kind === 'core') {
      spawnRing(worldPosition, hdr(SIGNAL_RED, 1.6), 5.5, 0.6);
      spawnGlint(worldPosition, hdr(SIGNAL_RED, 2.0), 2.2, 0.4);
      pendingTrauma += 0.2;
    } else {
      spawnRing(worldPosition, hdr(CREAM, 0.7).lerp(hdr(IR_HOT, 1.0), irSmooth), 2.6, 0.4);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [LAMP, hdr(SIGNAL_RED, 1).lerp(LAMP, 0.3), SIGNAL_RED]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.1, 0.28);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(CREAM, 1.3), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    if (lethal) return;
    const record = enemyRecords.get(enemyId);
    const kind = record?.mesh.userData.kind as string | undefined;
    burstSparks(worldPosition, hdr(CREAM, 1.0).lerp(hdr(IR_HOT, 1.6), irSmooth), 6, 9);
    if (kind === 'arm' || kind === 'core' || kind === 'dredger') {
      if (record) record.mesh.userData.damageFlashUntil = elapsedNow + 0.4;
      spawnRing(worldPosition, hdr(SIGNAL_RED, 1.3), 3.4, 0.3);
      burstInk(worldPosition, 4, 5);
      pendingTrauma += kind === 'core' ? 0.16 : 0.08;
    }
  });

  bus.on('stage', ({ worldPosition }) => {
    // The core's first stage cracking open.
    spawnRing(worldPosition, hdr(LAMP, 1.7), 6.4, 0.55);
    spawnGlint(worldPosition, hdr(IR_HOT, 2.2), 2.6, 0.3);
    burstInk(worldPosition, 12, 8);
    pendingTrauma += 0.4;
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.mesh.userData.kind as string | undefined;
    const accent = accentAt(record, LAMP);
    if (kind === 'arm') {
      burstInk(worldPosition, 16, 9);
      burstSparks(worldPosition, hdr(SIGNAL_RED, 1.5), 8, 10);
      spawnRing(worldPosition, hdr(SIGNAL_RED, 1.3), 6.2, 0.55);
      spawnRing(worldPosition, accent.clone().multiplyScalar(0.8), 3.4, 0.4);
      pendingTrauma += 0.3;
    } else if (kind === 'core') {
      burstInk(worldPosition, 26, 12);
      burstSparks(worldPosition, hdr(IR_HOT, 2.2), 18, 14);
      spawnRing(worldPosition, hdr(IR_HOT, 1.8), 11, 0.8);
      spawnRing(worldPosition, hdr(SIGNAL_RED, 1.6), 7, 0.6);
      spawnGlint(worldPosition, hdr(IR_HOT, 2.6), 4.5, 0.5);
      pendingTrauma += 0.7;
    } else {
      burstInk(worldPosition, 6, 6);
      burstSparks(worldPosition, accent, 7, 8);
      spawnRing(worldPosition, accent.clone().multiplyScalar(0.85), 3.6, 0.42);
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstInk(worldPosition, 2, 2.4);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      spawnRing(bossPosition, hdr(SIGNAL_RED, 1.8), 8, 0.7);
      spawnGlint(bossPosition, hdr(SIGNAL_RED, 2.4), 3.2, 0.4);
      pendingTrauma += 0.3;
    }
    if (phase === 'destroyed') {
      coreKilled = true;
      flashLevel = Math.max(flashLevel, 1.1);
      pendingTrauma += 0.8;
    }
  });

  bus.on('playerhit', () => {
    flashLevel = Math.max(flashLevel, 0.55);
    pendingTrauma += 0.5;
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.42;
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    coreKilled = false;
    lampBoost = 0;
    flashLevel = 0;
    irSmooth = 0;
    blindSmooth = 0;
    lastInkLevel = 0;
    for (const blob of inkBlobs) {
      blob.material.opacity = 0;
      blob.mesh.visible = false;
    }
  });
}

// ---- per-frame update -------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.8);
  flashLevel = Math.max(0, flashLevel - dt * 2.6);

  // --- the mode driver: murk → swallowed → infrared → lamps return.
  const runTime = ctx.running ? ctx.runTime : 0;
  const inkRaw = ctx.running && !coreKilled ? inkAt(runTime) : 0;
  const irRaw = ctx.running && !coreKilled ? infraredAt(runTime) : 0;
  irSmooth += (irRaw - irSmooth) * Math.min(1, dt * 10);
  const blindRaw = inkRaw * (1 - irSmooth);
  blindSmooth += (blindRaw - blindSmooth) * Math.min(1, dt * 6);
  if (coreKilled) lampBoost = Math.min(1, lampBoost + dt * 0.8);

  // Ejection moment: the cloud bursts off the boss toward the camera.
  if (inkRaw > 0.05 && lastInkLevel <= 0.05) {
    ejectInk(ctx.camera);
    pendingTrauma += 0.35;
  }
  lastInkLevel = inkRaw;
  updateInkBlobs(dt, inkRaw, irSmooth, ctx.camera);

  // --- boss body follows the rail; writhe runs on its own clock.
  if (railCurve && bossBody) {
    const swayTime = ctx.running ? ctx.runTime : ctx.elapsed * 0.6;
    bossCenter(railCurve, ctx.runProgress, swayTime, bossPosition);
    bossBody.root.position.copy(bossPosition);
    const look = new Vector3().copy(ctx.camera.position);
    bossBody.root.lookAt(look);
    bossBody.update(swayTime);
  }

  // --- atmosphere: blend fog and background through the mode states.
  atmosphereBackground
    .copy(ATMOS.murk.background)
    .lerp(ATMOS.ir.background, irSmooth)
    .lerp(ATMOS.blind.background, blindSmooth)
    .lerp(ATMOS.lamps.background, lampBoost);
  atmosphereFog
    .copy(ATMOS.murk.fog)
    .lerp(ATMOS.ir.fog, irSmooth)
    .lerp(ATMOS.blind.fog, blindSmooth)
    .lerp(ATMOS.lamps.fog, lampBoost);
  const density = MathUtils.lerp(
    MathUtils.lerp(
      MathUtils.lerp(ATMOS.murk.density, ATMOS.ir.density, irSmooth),
      ATMOS.blind.density,
      blindSmooth,
    ),
    ATMOS.lamps.density,
    lampBoost,
  );
  if (ctx.scene.background instanceof Color) ctx.scene.background.copy(atmosphereBackground);
  if (ctx.scene.fog instanceof FogExp2) {
    ctx.scene.fog.color.copy(atmosphereFog);
    ctx.scene.fog.density = density;
  }

  // --- post uniforms.
  irUniform.value = irSmooth;
  blindUniform.value = blindSmooth;
  flashUniform.value = flashLevel * 0.5 + lampBoost * Math.max(0, 0.35 - lampBoost * 0.35);

  // --- moded materials.
  if (environment) applyModeList(environment.modedEntries, irSmooth, blindSmooth);
  applyModeList(bossModed(), irSmooth, blindSmooth);
  for (const record of enemyRecords.values()) applyModeList(record.moded, irSmooth, blindSmooth);
  for (const record of projectileRecords.values()) applyModeList(record.moded, irSmooth, blindSmooth);

  environment?.update(ctx.runProgress, dt);

  // --- camera feel: downbeats push, infrared narrows the lens slightly.
  ctx.feel.setFovOffset(beatEnergy * 1.0 - irSmooth * 2.2);
  if (pendingTrauma > 0) {
    ctx.feel.shake(pendingTrauma);
    pendingTrauma = 0;
  }

  // --- per-enemy bookkeeping.
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.38)));

    if (record.mesh.userData.kind === 'core') updateCoreMesh(record.mesh, dt);

    const deniedUntil = record.mesh.userData.deniedUntil as number | undefined;
    if ((deniedUntil ?? -Infinity) > elapsedNow) {
      if (record.mesh.userData.isLetter) {
        flashLetterDenied(record.mesh, elapsedNow);
      } else {
        const flicker = 0.45 + 0.55 * Math.max(0, Math.sin(elapsedNow * 42));
        for (const entry of record.moded) entry.material.color.lerp(SIGNAL_RED, 0.5 * flicker);
      }
    } else if (record.mesh.userData.isLetter && record.mesh.userData.locked !== true) {
      setLetterLocked(record.mesh, false);
    }

    const damageFlashUntil = record.mesh.userData.damageFlashUntil as number | undefined;
    if ((damageFlashUntil ?? -Infinity) > elapsedNow) {
      const flash = ((damageFlashUntil ?? 0) - elapsedNow) / 0.4;
      for (const entry of record.moded) entry.material.color.lerp(hdr(IR_HOT, 1.4), 0.45 * flash);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = record.mesh.userData.kind === 'core' ? 2.4 : record.mesh.userData.kind === 'arm' ? 1.9 : 1.4;
      record.lockRing.scale.setScalar(pulse * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) projectileRecords.delete(projectileId, { dispose: true });
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z -= dt * (active ? 6.5 : 1.8) * (1 + irSmooth * 0.8);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z += dt * (active ? 2.6 : 0.7);
  }

  updateEffects(dt, ctx.camera);
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
    new RingGeometry(0.84, 0.9, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.66, 0.69, 30),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(CREAM, 0.5), 1.3), side: DoubleSide }),
  );
  group.add(ring, inner);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
