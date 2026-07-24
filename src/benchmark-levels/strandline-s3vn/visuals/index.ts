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
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  configureAdditiveMaterial,
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  CLEAR_TIME,
  STRANDLINE_DURATION,
  STRANDLINE_PLAYER_HEALTH,
  createStrandlineRail,
  crownPosition,
  speedFactorAt,
  strandlineRunProgress,
} from '../gameplay';
import { STRANDLINE_TIME } from '../timing';
import {
  breakChewerArmour,
  createBroodMesh,
  createChewerMesh,
  createClingMesh,
  createDrifterMesh,
  createParentMesh,
  createSporeMesh,
  createStingerMesh,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  spawnStrandFlush,
  spawnVeil,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  COLD_WHITE,
  LOCK_GRADIENT,
  LUME_GOLD,
  LUME_GREEN,
  PLAYER_CYAN,
  SICK_CORE,
  SICK_PALE,
  SICK_VIOLET,
  hdr,
} from './palette';
import { causticTime, depthUniform, flashUniform, sickUniform } from './post-fx';

// Visual spine. Every decision about what an event looks like lives here; the
// leaf files only know how to build meshes. Three ideas carry the whole level:
// violet is always something to shoot, green-gold is always the animal, and
// every parasite you cut off makes the world measurably brighter.

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
  /** Where and along what the parasite last had hold of a strand. */
  anchor: Vector3 | null;
  anchorAxis: Vector3 | null;
};

type ProjectileRecord = { mesh: Object3D };

const DENY_VIOLET = new Color(1.4, 0.1, 1.2);
const DENY_FILL = new Color(0.24, 0.02, 0.2);
const ROT_GREY = new Color(0.3, 0.12, 0.4);

/** Parasites cut off before the strands read as fully alive again. */
const LIFE_TARGET = 52;

const STRANDLINE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 6.5,
  smoothing: 18,
};

const rail = createStrandlineRail();
const BAR_SECONDS = STRANDLINE_TIME.barSeconds;
const crownWorld = new Vector3();

let environment: Environment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let surge = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let hitsTaken = 0;
let sickPulse = 0;
let lifeKills = 0;
let lifeLevel = 0;
let pulsePhase = 0;
let driftLevel = 0;
let codaHold = false;
let parentId = -1;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
// Every parasite builds its own geometry, so every parasite has to give it
// back — otherwise a sixty-second run leaks five hundred buffers.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, anchor: null, anchorAxis: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
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

// Silhouette scale per kind: everything has to read at its own working distance.
const KIND_SCALE: Record<string, number> = {
  cling: 1.25,
  drifter: 1.2,
  chewer: 1.0,
  stinger: 1.2,
  spore: 1.15,
  brood: 1.5,
  parent: 2.0,
};

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemyMesh(kind, letter);
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
    case 'drifter':
      return createDrifterMesh();
    case 'chewer':
      return createChewerMesh();
    case 'stinger':
      return createStingerMesh();
    case 'spore':
      return createSporeMesh();
    case 'brood':
      return createBroodMesh();
    case 'parent':
      return createParentMesh();
    default:
      return createDrifterMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_VIOLET.clone(), 2.6, 0.3);
}

// Player fire: a cold, clean lance. It is the only thing in the water that is
// neither the animal's green nor the infestation's violet.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.26, 0);
  coreGeometry.scale(0.45, 0.45, 2.6);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(COLD_WHITE, 2.4) })));
  const shellGeometry = new OctahedronGeometry(0.46, 0);
  shellGeometry.scale(0.6, 0.6, 2.2);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(PLAYER_CYAN, 0.9), opacity: 0.6 })));
  projectileRecords.enqueue({ mesh: group });
  return group;
}

// ---- reticle -------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
    return material;
  };

  // A medusa's radial symmetry: an outer bell ring, six tentacle ticks that
  // light one per lock, and a core that opens as you charge.
  const outer = new Mesh(new RingGeometry(0.6, 0.635, 48), new MeshBasicMaterial());
  addPart(outer, hdr(LUME_GREEN, 0.9));

  const ticks = new Group();
  const tickMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.26, 0.05), new MeshBasicMaterial());
    const material = addPart(tick, hdr(LUME_GREEN, 0.35));
    tickMaterials.push(material);
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
    tick.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }

  const bell = new Group();
  const inner = new Mesh(new RingGeometry(0.3, 0.335, 6), new MeshBasicMaterial());
  addPart(inner, hdr(LUME_GOLD, 0.8));
  bell.add(inner);

  const dot = new Mesh(new CircleGeometry(0.05, 12), new MeshBasicMaterial());
  addPart(dot, hdr(COLD_WHITE, 1.8));

  group.add(outer, ticks, bell, dot);
  group.userData.parts = parts;
  group.userData.tickMaterials = tickMaterials;
  group.userData.bell = bell;
  group.userData.ticks = ticks;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.5 : 1.15));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
  // Each tick past the lock count goes dark: the ring is a six-count gauge.
  const tickMaterials = reticle.userData.tickMaterials as MeshBasicMaterial[];
  for (const [index, material] of tickMaterials.entries()) {
    if (index >= lockCount) material.color.multiplyScalar(0.22);
  }
}

// ---- event wiring ----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'parent') {
      parentId = enemyId;
      cameraFeel.shake(0.8, STRANDLINE_SHAKE);
      surge = Math.max(surge, 0.5);
      sickPulse = Math.max(sickPulse, 0.7);
      spawnVeil(worldPosition, hdr(SICK_VIOLET, 1.1), 52, 1.3);
      spawnRing(worldPosition, hdr(SICK_PALE, 1.0), 30, 0.9);
    } else if (kind === 'brood') {
      spawnRing(worldPosition, hdr(SICK_CORE, 1.2), 5.5, 0.45);
      burstSparks(worldPosition, hdr(SICK_VIOLET, 0.9), 6, 7);
    } else if (kind === 'stinger' || kind === 'chewer') {
      spawnRing(worldPosition, hdr(SICK_VIOLET, 0.9), 3.4, 0.4);
    } else if (kind !== 'spore') {
      spawnRing(worldPosition, hdr(SICK_PALE, 0.5), 2.2, 0.32);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockBracket(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.2), 2.0, 0.24);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(PLAYER_CYAN, 1.0), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(COLD_WHITE, 0.8), 5, 7);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.28;
      spawnGlint(worldPosition, hdr(COLD_WHITE, 1.5), 0.9, 0.14);
      if (enemyId === parentId) {
        cameraFeel.shake(0.35, STRANDLINE_SHAKE);
        burstSparks(worldPosition, hdr(SICK_CORE, 1.1), 14, 12);
      }
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'chewer') {
      breakChewerArmour(record.mesh);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 6));
      burstSparks(worldPosition, hdr(SICK_VIOLET, 1.0), 14, 11);
      spawnRing(worldPosition, hdr(SICK_PALE, 1.2), 6.5, 0.45);
    } else if (record.mesh.userData.isParent) {
      cameraFeel.shake(0.9, STRANDLINE_SHAKE);
      surge = Math.max(surge, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.22);
      spawnVeil(worldPosition, hdr(SICK_CORE, 1.2), 42, 0.9);
      burstSparks(worldPosition, hdr(SICK_CORE, 1.2), 30, 18);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs);

    if (record.mesh.userData.isParent) {
      // It comes loose. The whole animal answers.
      cameraFeel.shake(1.6, STRANDLINE_SHAKE);
      surge = 1;
      flashUniform.value = Math.max(flashUniform.value, 0.65);
      sickPulse = 0;
      lifeLevel = 1;
      spawnVeil(worldPosition, hdr(LUME_GREEN, 1.0), 130, 1.8);
      spawnVeil(worldPosition, hdr(LUME_GOLD, 1.1), 78, 1.3);
      spawnRing(worldPosition, hdr(COLD_WHITE, 1.4), 64, 1.4);
      burstSparks(worldPosition, hdr(SICK_VIOLET, 1.2), 60, 22, -0.2);
      burstSparks(worldPosition, hdr(LUME_GREEN, 1.3), 60, 26, 2.2);
      spawnGlint(worldPosition, hdr(LUME_GOLD, 2.2), 8, 0.6);
    } else if (record.mesh.userData.kind !== 'spore') {
      lifeKills += 1;
      burstSparks(worldPosition, hdr(SICK_VIOLET, 0.95), 10, 10);
      spawnRing(worldPosition, hdr(SICK_PALE, 0.9), 4.0, 0.4);
      spawnGlint(worldPosition, hdr(LUME_GREEN, 1.4), 1.1, 0.16);
      // The strand it was eating floods back with light.
      if (record.anchor && record.anchorAxis) {
        spawnStrandFlush(record.anchor, record.anchorAxis, 34, 0.85);
        burstSparks(record.anchor, hdr(LUME_GREEN, 1.1), 6, 5, 1.6);
      }
    } else {
      burstSparks(worldPosition, hdr(SICK_CORE, 1.0), 8, 9);
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.get(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, hdr(ROT_GREY, 0.4), 3, 3, -0.4);
  });

  bus.on('shielded', ({ shields }) => {
    // Shots die in the webbing: it flares and holds.
    for (const shield of shields) {
      spawnRing(shield.worldPosition, hdr(SICK_VIOLET, 1.5), 28, 0.5);
      burstSparks(shield.worldPosition, hdr(SICK_PALE, 1.0), 18, 14, 0.4);
    }
    sickPulse = Math.max(sickPulse, 0.5);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      flashUniform.value = Math.max(flashUniform.value, 0.16);
      surge = Math.max(surge, 0.3);
    } else if (phase === 'summoned') {
      sickPulse = Math.max(sickPulse, 0.6);
      cameraFeel.shake(0.5, STRANDLINE_SHAKE);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.6);
      flashUniform.value = Math.max(flashUniform.value, 0.14);
      surge = Math.max(surge, 0.28);
    }
  });

  bus.on('beat', ({ beatNumber, isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
    // The animal contracts every half bar; the light runs the strands after it.
    if (beatNumber % 2 === 0) pulsePhase = 0;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    sickPulse = 1;
    beatEnergy = 1.3;
    cameraFeel.shake(1.2, STRANDLINE_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    sickUniform.value = 0;
    depthUniform.value = 0;
    hitsTaken = 0;
    sickPulse = 0;
    surge = 0;
    lifeKills = 0;
    lifeLevel = 0;
    driftLevel = 0;
    codaHold = false;
    parentId = -1;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
    codaHold = true;
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
  surge = Math.max(0, surge - dt * 0.8);
  sickPulse = Math.max(0, sickPulse - dt * 1.3);
  pulsePhase = (pulsePhase + dt / (BAR_SECONDS * 0.5)) % 1;
  causticTime.value += dt;

  const runTime = ctx.running ? ctx.runTime : 0;
  const arc = ctx.running ? MathUtils.clamp(runTime / STRANDLINE_DURATION, 0, 1) : 0;
  const railProgress = ctx.running ? strandlineRunProgress(runTime) : 0;

  // The strands come back to life as the colony comes off them. A small floor
  // rises with the run so even a bad pass sees the animal recovering.
  const floor = ctx.running ? Math.min(0.3, arc * 0.3) : 0.12;
  const earned = Math.min(1, lifeKills / LIFE_TARGET);
  lifeLevel = Math.max(lifeLevel * 0.985, Math.max(floor, earned));

  if (ctx.running) {
    driftLevel = MathUtils.clamp((runTime - CLEAR_TIME) / (STRANDLINE_DURATION - CLEAR_TIME), 0, 1);
  } else if (codaHold) {
    driftLevel = Math.min(1.5, driftLevel + dt * 0.028);
  }

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    arc,
    railU: railProgress,
    crown: crownPosition(rail, runTime, crownWorld),
    life: lifeLevel,
    pulse: pulsePhase,
    drift: driftLevel,
    beatEnergy,
  });

  // Post grade: the water darkens as you climb the bundle, then opens right out
  // for the coda; violet pressure tracks the infestation's hold on you.
  const damage = Math.min(1, hitsTaken / STRANDLINE_PLAYER_HEALTH);
  depthUniform.value = MathUtils.clamp((arc - 0.5) / 0.35, 0, 1) * (1 - driftLevel);
  sickUniform.value = Math.min(1, sickPulse * 0.55 + damage * 0.08);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.6 ? 1.3 : 2.2));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.42)));

    updateEnemyTint(record, ctx);
    updateEnemyBehaviourVisuals(record, dt);

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 1.4;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.85 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, hdr(PLAYER_CYAN, 0.8), 0.42);
  }

  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const active = reticle.userData.active === true;
    const bell = reticle.userData.bell as Group | undefined;
    const ticks = reticle.userData.ticks as Group | undefined;
    if (bell) {
      bell.rotation.z += dt * (active ? 2.6 : 0.6);
      const breathe = 1 + Math.sin(elapsedNow * (active ? 8 : 3)) * (active ? 0.12 : 0.05);
      bell.scale.setScalar(breathe);
    }
    if (ticks) ticks.rotation.z -= dt * (active ? 1.2 : 0.3);
  }

  updateEffects(dt, ctx.camera);
}

/** Per-kind animation that is about the creature's behaviour, not its state. */
function updateEnemyBehaviourVisuals(record: EnemyRecord, dt: number) {
  const userData = record.mesh.userData;

  if (userData.kind === 'cling') {
    const grip = (userData.grip as number | undefined) ?? 1;
    const stub = userData.stub as MeshBasicMaterial | undefined;
    const legs = userData.legs as Group | undefined;
    const sac = userData.sac as Mesh | undefined;
    if (grip > 0.5) {
      // While it has hold, remember the strand so the kill can flush it clean.
      (record.anchor ??= new Vector3()).copy(record.mesh.position);
      (record.anchorAxis ??= new Vector3()).set(0, 0, 1).applyQuaternion(record.mesh.quaternion);
      if (stub) stub.color.copy(LUME_GREEN).multiplyScalar(0.4 + lifeLevel * 0.2);
    } else if (stub) {
      // Let go and the stub is no longer part of the picture.
      stub.color.multiplyScalar(Math.max(0, 1 - dt * 5));
    }
    if (legs) legs.scale.setScalar(grip > 0.5 ? 1 : 1.5);
    const breathe = (userData.breathe as number | undefined) ?? 0;
    if (sac) sac.scale.setScalar(0.85 + breathe * 0.4);
  }

  if (userData.kind === 'chewer') {
    (record.anchor ??= new Vector3()).copy(record.mesh.position);
    (record.anchorAxis ??= new Vector3()).set(0, 0, 1).applyQuaternion(record.mesh.quaternion);
    const stub = userData.stub as MeshBasicMaterial | undefined;
    if (stub) stub.color.copy(LUME_GREEN).multiplyScalar(0.3 + lifeLevel * 0.15);
  }

  if (userData.kind === 'stinger') {
    const sac = userData.chargeSac as Mesh | undefined;
    const charge = (userData.charge as number | undefined) ?? 0;
    if (sac && userData.locked !== true) {
      (sac.material as MeshBasicMaterial).color.copy(SICK_CORE).multiplyScalar(0.6 + charge * 3.2);
      sac.scale.setScalar(1 + charge * 1.5);
    }
  }

  if (userData.kind === 'brood') {
    const breathe = (userData.breathe as number | undefined) ?? 0;
    record.mesh.children[0]?.scale.setScalar(KIND_SCALE.brood * (1 + breathe * 0.13));
  }

  if (userData.isParent) {
    const panels = userData.webPanelGroups as Group[] | undefined;
    const alive = (userData.webPanels as number | undefined) ?? 3;
    if (panels) {
      for (const [index, panel] of panels.entries()) {
        const intact = index < alive;
        panel.visible = intact || panel.scale.x > 0.02;
        const target = intact ? 1 : 0;
        const current = panel.scale.x;
        const next = MathUtils.lerp(current, target, Math.min(1, dt * 3.2));
        panel.scale.setScalar(Math.max(0.001, next));
        const material = panel.userData.material as MeshBasicMaterial | undefined;
        if (material) {
          const fed = (userData.broods as number | undefined) ?? 0;
          material.color.copy(SICK_VIOLET).multiplyScalar(next * (0.5 + (fed > 0 ? 0.7 : 0.15) + Math.sin(elapsedNow * 3 + index) * 0.12));
        }
      }
    }
    const heart = userData.heart as Mesh | undefined;
    if (heart) {
      const stage = (userData.stage as number | undefined) ?? 0;
      const exposed = userData.exposed === true;
      const beatGlow = 0.9 + Math.sin(elapsedNow * (2.4 + stage * 1.2)) * 0.35;
      // Capped: the heart is a big sphere, and letting it climb past ~1.3 turns
      // the whole boss into a white square once the rail closes on it.
      (heart.material as MeshBasicMaterial).color.copy(SICK_CORE)
        .multiplyScalar(Math.min(1.3, (exposed ? 0.95 : 0.45) * beatGlow * (1 + stage * 0.22)));
      heart.scale.setScalar(1 + stage * 0.12 + (exposed ? 0.1 : 0));
    }
  }

  if (userData.isHostileShot) dropTrail(record.mesh.position, hdr(SICK_CORE, 0.9), 0.35);
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

  // Distance falloff keeps far additive stacks quiet; silhouettes carry.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smoothstep(1 - clamp01((distance - 14) / (70 - 14)));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_VIOLET);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(LUME_GOLD, 1.4));
      else if (part.kind === 'fill') part.material.color.copy(LUME_GREEN).multiplyScalar(0.16);
      else part.material.color.copy(hdr(COLD_WHITE, 1.8));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(COLD_WHITE, part.kind === 'fill' ? 0.55 : 1.7));
      continue;
    }
    const dim = part.kind === 'fill' ? 0.55 + 0.45 * closeness : 0.45 + 0.55 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  // FOV breathes with the glide and opens right up when the water does.
  const targetFov = (speed - 1) * 6.5 + beatEnergy * 0.9 + surge * 5.5 + driftLevel * 6;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFov, Math.min(1, dt * 5));

  if (ctx.running) {
    // Bank into the strands. The wide swing through open water is where this
    // reads hardest — you can feel the animal on the outside of the turn.
    const u = strandlineRunProgress(runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.008, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 34, -0.24, 0.24);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 2.6);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: STRANDLINE_SHAKE });
}

/** Slow hovering drift through the strands while the start colony is up. */
export function updateAttractCamera(camera: PerspectiveCamera, modeTime: number) {
  const base = rail.getPointAt(0.012);
  const look = rail.getPointAt(0.055);
  camera.position.copy(base);
  camera.position.x += Math.sin(modeTime * 0.31) * 1.6;
  camera.position.y += Math.sin(modeTime * 0.23 + 1.3) * 1.1;
  camera.lookAt(
    look.x + Math.sin(modeTime * 0.27 + 0.6) * 1.4,
    look.y + Math.cos(modeTime * 0.19) * 0.9,
    look.z,
  );
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle') return child;
  }
  return null;
}

function makeLockBracket(color: Color): Group {
  const group = new Group();
  // A closing medusa ring: two counter-rotating arcs plus a soft inner glow.
  const outer = new Mesh(
    new RingGeometry(0.86, 0.92, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.6), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.6, 0.64, 24),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(COLD_WHITE, 0.45), 1.2), side: DoubleSide }),
  );
  const halo = new Mesh(
    new SphereGeometry(0.2, 8, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 0.9) }),
  );
  group.add(outer, inner, halo);
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
