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
  configureAdditiveMaterial,
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  BARREL_BLAST_DAMAGE,
  BORE_RADIUS,
  createMassDriverRail,
  FAULT_TIME,
  LAUNCH_TIME,
  massDriverRunProgress,
  MASS_DRIVER_RAIL_UNITS,
  MUZZLE_TIME,
  MUZZLE_U,
  RING_PASS_TIMES,
  RING_RAIL_US,
  speedFactorAt,
} from '../gameplay';
import {
  barrelFadeUniform,
  barrelGlowUniform,
  barrelPulseUniform,
  barrelVioletUniform,
  barrelWhiteUniform,
  createBarrelWall,
  createFilamentField,
  createMuzzle,
  createRingBank,
  createStarField,
  type FilamentField,
  type Muzzle,
  type RingBank,
} from './barrel';
import {
  breakInterlockArmour,
  createBoltMesh,
  createDroneMesh,
  createInterlockMesh,
  createLanceMesh,
  createSentryMesh,
  type ShardSpec,
  type TintPart,
} from './enemies';
import {
  burstDebris,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnArc,
  spawnGlint,
  spawnShock,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  ARC_BLUE,
  ARC_VIOLET,
  ARC_WHITE,
  CASING,
  COIL,
  FAULT,
  hdr,
  HOSTILE,
  LOCK_GRADIENT,
  PLASMA,
  ringHeat,
  VOID,
} from './palette';
import { arcUniform, blastUniform, chargeUniform, flashUniform } from './post-fx';

// The visuals spine: every colour decision, every event response, and the
// per-frame choreography of the barrel. Geometry construction lives in the
// leaves next door.

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

type Environment = {
  root: Group;
  rings: RingBank;
  filaments: FilamentField;
  muzzle: Muzzle;
};

// ---- how the frame is tuned ------------------------------------------------------

const RING_FADE_UNITS = 138;
const WALL_FADE_UNITS = 320;
/** Seconds of anticipation before a ring pass, and of afterglow behind it. */
const RING_FLARE_LEAD = 0.16;
const RING_FLARE_TAIL = 0.4;
const DENY_EDGE = new Color(1.7, 0.12, 0.06);
const DENY_FILL = new Color(0.26, 0.02, 0.01);

const MASS_DRIVER_SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.6,
  pitchDegrees: 0.22,
  yawDegrees: 0.2,
  rollDegrees: 0.55,
  frequency: 16,
  smoothing: 26,
};

// ---- module state ------------------------------------------------------------------

let environment: Environment | null = null;
let elapsedNow = 0;
let lastRunTime = -1;
let beatEnergy = 0;
let surge = 0;
let fovOffset = 0;
let interlocksAlive = 0;
let interlocksCleared = false;
let launchResolved = false;
let chargeLevel = 0;
let arcLevel = 0;
let reticleObject: Object3D | null = null;

const coreColor = new Color();
const coilColor = new Color();
const vaneColor = new Color();
const baseColor = new Color();
const scratchColor = new Color();
const scratchPoint = new Vector3();
const cameraPosition = new Vector3();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    // Geometry is shared per kind, so only the per-target materials go back.
    disposeMaterials(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

// ---- environment --------------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  if (environment) {
    environment.root.removeFromParent();
    disposeObject3D(environment.root);
  }

  scene.background = VOID.clone();
  const curve = createMassDriverRail();
  const root = new Group();

  const rings = createRingBank({
    curve,
    us: RING_RAIL_US,
    boreRadius: BORE_RADIUS,
    coreWidth: 1.2,
    coilRadius: BORE_RADIUS + 2.6,
    coilTube: 1.1,
    vaneRadius: BORE_RADIUS + 4.6,
    vaneCount: 6,
    vaneLength: 3.1,
    vaneThickness: 0.55,
    twistPerRing: 0.16,
  });

  const wall = createBarrelWall({
    curve,
    uEnd: MUZZLE_U,
    radius: BORE_RADIUS + 11,
    lengthSegments: 340,
    radialSegments: 18,
    conductorCount: 6,
    ribCount: 190,
    pulseDensity: 46,
    base: new Color(0.012, 0.011, 0.028),
    cool: ARC_BLUE,
    warm: ARC_VIOLET,
    hot: ARC_WHITE,
  });

  const filaments = createFilamentField({
    curve,
    count: 84,
    radiusMin: BORE_RADIUS + 6,
    radiusMax: BORE_RADIUS + 10,
    spanUnits: 520,
    behindUnits: 40,
    railUnits: MASS_DRIVER_RAIL_UNITS,
    length: 2.4,
    thickness: 0.13,
    seed: 0x5a17,
  });

  const muzzle = createMuzzle({ curve, u: MUZZLE_U, boreRadius: BORE_RADIUS, spikeCount: 12 });
  const stars = createStarField({
    center: muzzle.position.clone().add(new Vector3(0, 0, -2400)),
    radius: 2800,
    count: 820,
    size: 1.7,
    seed: 0x1f33,
  });

  root.add(rings.group, wall, filaments.mesh, muzzle.group, stars);
  scene.add(root);
  createEffects(scene);

  environment = { root, rings, filaments, muzzle };
  barrelFadeUniform.value = WALL_FADE_UNITS;
  return root;
}

// ---- factories -----------------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'drone':
      return createDroneMesh();
    case 'lance':
      return createLanceMesh();
    case 'sentry':
      return createSentryMesh();
    case 'bolt':
      return createBoltMesh();
    case 'interlock':
      return createInterlockMesh();
    default:
      return createDroneMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnShock(mesh.position, hdr(FAULT, 1.5), 3.2, 0.28);
}

// Shots are created and thrown away constantly; their geometry is built once.
const projectileCoreGeometry = new OctahedronGeometry(0.3, 0).scale(0.4, 0.4, 2.4);
const projectileShellGeometry = new OctahedronGeometry(0.46, 0).scale(0.6, 0.6, 2.0);

/** Player shot: a plasma slug. The only cyan thing that moves away from the camera. */
export function createProjectileMesh() {
  const group = new Group();
  group.add(new Mesh(projectileCoreGeometry, new MeshBasicMaterial({ color: hdr(ARC_WHITE, 2.6) })));
  group.add(new Mesh(
    projectileShellGeometry,
    createAdditiveBasicMaterial({ color: hdr(PLASMA, 1.1), opacity: 0.55 }),
  ));
  projectileRecords.enqueue({ mesh: group, trailColor: PLASMA.clone().multiplyScalar(0.85) });
  return group;
}

// ---- reticle ---------------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
    return mesh;
  };

  // Bore sight: a miniature accelerator ring with six charge sockets, one per lock.
  const outer = addPart(new Mesh(new RingGeometry(0.6, 0.65, 64), new MeshBasicMaterial()), hdr(PLASMA, 1.1));

  const sockets = new Group();
  const socketMaterials: MeshBasicMaterial[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2 + Math.PI / 2;
    const socket = new Mesh(new PlaneGeometry(0.17, 0.07), new MeshBasicMaterial());
    const material = configureAdditiveMaterial(socket.material as MeshBasicMaterial, {
      color: hdr(PLASMA, 0.5),
      side: DoubleSide,
    });
    socketMaterials.push(material);
    socket.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    socket.rotation.z = angle + Math.PI / 2;
    sockets.add(socket);
  }

  const spinner = new Group();
  spinner.add(addPart(new Mesh(new RingGeometry(0.34, 0.38, 4), new MeshBasicMaterial()), hdr(ARC_WHITE, 0.95)));
  const dot = addPart(new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial()), hdr(ARC_WHITE, 2.2));

  group.add(outer, sockets, spinner, dot);
  group.userData.parts = parts;
  group.userData.socketMaterials = socketMaterials;
  group.userData.spinner = spinner;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.05 : 0));
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  for (const part of parts) {
    if (charge) part.material.color.copy(charge).multiplyScalar(active ? 1.9 : 1.5);
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
  const sockets = reticle.userData.socketMaterials as MeshBasicMaterial[];
  for (const [index, material] of sockets.entries()) {
    if (index < lockCount && charge) material.color.copy(charge).multiplyScalar(2.4);
    else material.color.copy(PLASMA).multiplyScalar(active ? 0.5 : 0.3);
  }
}

// ---- event choreography -------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'interlock') {
      interlocksAlive += 1;
      // A clamp slams shut across the bore.
      spawnShock(worldPosition, hdr(FAULT, 1.5), 12, 0.5);
      spawnArc(worldPosition, worldPosition.clone().add(new Vector3(0, 3.4, 0)), hdr(FAULT, 1.8), 0.3, 0.8);
      cameraFeel.shake(0.45, MASS_DRIVER_SHAKE);
      arcLevel = Math.max(arcLevel, 0.34);
    } else if (kind === 'bolt') {
      spawnGlint(worldPosition, hdr(HOSTILE, 1.6), 1.2, 0.12);
    } else if (kind !== 'letter') {
      spawnShock(worldPosition, hdr(HOSTILE, 0.7), 2.8, 0.34);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    // The capacitor reaches out and grips: an arc from the sight to the target.
    if (reticleObject) {
      spawnArc(reticleObject.position, worldPosition, scratchColor.copy(lockColor).multiplyScalar(1.6), 0.16, 0.5);
    }
    spawnShock(worldPosition, scratchColor.copy(lockColor).multiplyScalar(1.5), 2.4, 0.22);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ARC_WHITE, 1.5), 0.7, 0.1);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(ARC_WHITE, 1.1), 7, 13, 0.26);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(ARC_WHITE, 2.0), 1.3, 0.14);
      spawnArc(worldPosition, worldPosition.clone().add(randomOffset(2.2)), hdr(PLASMA, 1.8), 0.14, 0.42);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || record.mesh.userData.kind !== 'interlock') return;
    // Armour blown: the fault core is bare and arcing to its own mount.
    breakInterlockArmour(record.mesh);
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstDebris(worldPosition, specs.slice(0, 5), 15);
    spawnShock(worldPosition, hdr(FAULT, 1.6), 8, 0.42);
    for (let index = 0; index < 3; index += 1) {
      spawnArc(worldPosition, worldPosition.clone().add(randomOffset(4.5)), hdr(FAULT, 2.0), 0.24, 0.7);
    }
    cameraFeel.shake(0.55, MASS_DRIVER_SHAKE);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? HOSTILE;
    if (specs) burstDebris(worldPosition, specs);
    burstSparks(worldPosition, hdr(ARC_WHITE, 1.2), 12, 17);
    spawnShock(worldPosition, scratchColor.copy(accent), 5.2, 0.36);
    spawnGlint(worldPosition, hdr(ARC_WHITE, 1.8), 1.5, 0.15);
    for (let index = 0; index < 2; index += 1) {
      spawnArc(worldPosition, worldPosition.clone().add(randomOffset(3)), hdr(PLASMA, 1.6), 0.18, 0.55);
    }

    if (record.mesh.userData.kind === 'interlock') {
      interlocksAlive = Math.max(0, interlocksAlive - 1);
      spawnShock(worldPosition, hdr(ARC_WHITE, 1.6), 26, 0.7);
      spawnShock(worldPosition, hdr(FAULT, 1.2), 15, 0.55);
      for (let index = 0; index < 4; index += 1) {
        spawnArc(worldPosition, worldPosition.clone().add(randomOffset(9)), hdr(ARC_VIOLET, 2.2), 0.3, 1.2);
      }
      cameraFeel.shake(0.9, MASS_DRIVER_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.28);
      surge = Math.max(surge, 0.45);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.get(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, scratchColor.copy(HOSTILE).multiplyScalar(0.35), 4, 5, 0.24);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size < 5 || kills < size) return;
    // A clean sweep of a whole wheel pumps the barrel.
    beatEnergy = Math.max(beatEnergy, 1.6);
    surge = Math.max(surge, 0.5);
    flashUniform.value = Math.max(flashUniform.value, 0.18);
  });

  bus.on('reject', () => {
    // The capacitor dumps into nothing: a dead red crack across the sight.
    arcLevel = Math.max(arcLevel, 0.55);
    if (!reticleObject) return;
    spawnShock(reticleObject.position, hdr(FAULT, 1.4), 5, 0.3);
    for (let index = 0; index < 2; index += 1) {
      spawnArc(reticleObject.position, reticleObject.position.clone().add(randomOffset(3.5)), hdr(FAULT, 1.8), 0.2, 0.9);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      arcLevel = Math.max(arcLevel, 0.5);
      cameraFeel.shake(0.8, MASS_DRIVER_SHAKE);
    } else if (phase === 'exposed') {
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    } else {
      interlocksCleared = true;
      flashUniform.value = Math.max(flashUniform.value, 0.5);
      surge = Math.max(surge, 0.7);
      cameraFeel.shake(1.0, MASS_DRIVER_SHAKE);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', ({ damage }) => {
    beatEnergy = 1.5;
    arcLevel = Math.max(arcLevel, 0.7);
    cameraFeel.shake(1.3, MASS_DRIVER_SHAKE);
    // Only the barrel overload deals more than a hull point, and it ends the run
    // on the same frame — so its set piece has to fire from here, not from the
    // per-frame crossing check.
    if (damage < BARREL_BLAST_DAMAGE) return;
    launchResolved = true;
    flashUniform.value = 0.42;
    blastUniform.value = 1.5;
    arcLevel = 1;
    surge = 1;
    cameraFeel.shake(1.9, MASS_DRIVER_SHAKE);
    spawnShock(cameraPosition, hdr(FAULT, 2.0), 120, 1.0);
    spawnShock(cameraPosition, hdr(HOSTILE, 1.4), 70, 0.8);
    for (let index = 0; index < 7; index += 1) {
      spawnArc(cameraPosition, cameraPosition.clone().add(randomOffset(24)), hdr(FAULT, 2.4), 0.55, 3);
    }
    burstSparks(cameraPosition, hdr(HOSTILE, 1.6), 90, 55, 0.8);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    interlocksAlive = 0;
    interlocksCleared = false;
    launchResolved = false;
    chargeLevel = 0;
    arcLevel = 0;
    surge = 0;
    lastRunTime = -1;
    fovOffset = 0;
    flashUniform.value = 0;
    blastUniform.value = 0;
    chargeUniform.value = 0;
    arcUniform.value = 0;
    cameraFeel.restore();
  });

  bus.on('runend', () => {
    cameraFeel.restore();
  });
}

// ---- per-frame ------------------------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  cameraPosition.copy((ctx.camera as PerspectiveCamera).position);
  beatEnergy = Math.max(0, beatEnergy - dt * 4.4);
  surge = Math.max(0, surge - dt * 1.1);
  reticleObject ??= findReticle(ctx.scene);

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.45;

  updateSetPieces(ctx);
  updateRings(ctx, runTime);
  updateBarrel(ctx, dt, runTime, speed);
  updatePost(dt, ctx.running, runTime);
  updateEnemyRecords(dt, ctx);

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const spinner = reticleObject?.userData.spinner as Group | undefined;
  if (spinner) spinner.rotation.z += dt * (reticleObject?.userData.active === true ? 5.2 : 1.1);

  updateEffects(dt, ctx.camera, elapsedNow);
}

/** The named moments: the fault, the charge peak, and the muzzle. */
function updateSetPieces(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (moment: number) => lastRunTime >= 0 && lastRunTime < moment && ctx.runTime >= moment;

  if (crossed(FAULT_TIME)) {
    arcLevel = Math.max(arcLevel, 0.6);
    flashUniform.value = Math.max(flashUniform.value, 0.24);
    ctx.feel.shake(0.7, MASS_DRIVER_SHAKE);
  }

  if (!launchResolved && ctx.runTime >= LAUNCH_TIME) {
    // Charge peak. Either the gun fires, or the barrel does.
    launchResolved = true;
    const clean = interlocksAlive === 0;
    flashUniform.value = clean ? 1.0 : 0.42;
    if (!clean) blastUniform.value = 1.5;
    arcLevel = clean ? 0.7 : 1.0;
    surge = 1.0;
    ctx.feel.shake(clean ? 1.5 : 1.9, MASS_DRIVER_SHAKE);
    const muzzle = environment?.muzzle.position;
    if (muzzle) {
      spawnShock(muzzle, hdr(clean ? ARC_WHITE : FAULT, 1.8), 150, 1.1);
      spawnShock(muzzle, hdr(clean ? ARC_VIOLET : HOSTILE, 1.3), 90, 0.85);
    }
    scratchPoint.copy((ctx.camera as PerspectiveCamera).position);
    for (let index = 0; index < 6; index += 1) {
      spawnArc(scratchPoint, scratchPoint.clone().add(randomOffset(26)), hdr(clean ? ARC_WHITE : FAULT, 2.4), 0.5, 3);
    }
    burstSparks(scratchPoint, hdr(clean ? PLASMA : FAULT, 1.5), 80, 55, 0.7);
  }

  if (crossed(MUZZLE_TIME)) {
    // Out of the barrel. Everything opens, then stops.
    flashUniform.value = Math.max(flashUniform.value, 1.1);
    surge = 1.0;
    ctx.feel.shake(1.2, MASS_DRIVER_SHAKE);
    const muzzle = environment?.muzzle.position;
    if (muzzle) {
      spawnShock(muzzle, hdr(ARC_WHITE, 2.2), 260, 1.4);
      spawnShock(muzzle, hdr(PLASMA, 1.4), 160, 1.0);
    }
  }

  lastRunTime = ctx.runTime;
}

/**
 * One ring per beat. Heat climbs arc blue → violet → white along the barrel, the
 * ring the payload is about to cross flares, and everything falls off with depth
 * so the tunnel reads as distance rather than a wall of light.
 */
function updateRings(ctx: VisualContext, runTime: number) {
  if (!environment) return;
  const bank = environment.rings;
  const cameraPosition = (ctx.camera as PerspectiveCamera).position;
  const beatGlow = beatEnergy * 0.14;

  for (let index = 0; index < bank.count; index += 1) {
    const passTime = RING_PASS_TIMES[index];
    const heat = passTime / MUZZLE_TIME;
    ringHeat(heat, baseColor);
    const distance = bank.positions[index].distanceTo(cameraPosition);
    const depth = 1 / (1 + (distance / RING_FADE_UNITS) ** 2.2);

    let flare = 0;
    if (ctx.running) {
      const since = runTime - passTime;
      if (since < 0 && since > -RING_FLARE_LEAD) flare = (1 + since / RING_FLARE_LEAD) * 0.7;
      else if (since >= 0 && since < RING_FLARE_TAIL) flare = (1 - since / RING_FLARE_TAIL) ** 2 * 2.7;
    } else {
      // Idle: a charge wave paces down the barrel while the payload waits.
      const wave = Math.max(0, Math.sin(elapsedNow * 4.2 - index * 0.5));
      flare = wave ** 14 * 2.0;
    }

    const heatGain = 0.6 + heat * 0.62;
    coreColor.copy(baseColor).multiplyScalar(depth * (0.32 + heat * 0.66 + beatGlow) + flare * heatGain);
    addScaled(coilColor.copy(COIL).multiplyScalar(depth * 0.5), baseColor, depth * (0.1 + heat * 0.3) + flare * 0.4);
    addScaled(vaneColor.copy(CASING).multiplyScalar(depth * 1.2), baseColor, depth * (0.05 + heat * 0.16) + flare * 0.22);
    bank.setRingColor(index, coreColor, coilColor, vaneColor);
  }
  bank.commit();
}

function updateBarrel(ctx: VisualContext, dt: number, runTime: number, speed: number) {
  if (!environment) return;
  const progress = ctx.running ? MathUtils.clamp(runTime / MUZZLE_TIME, 0, 1) : 0;
  barrelVioletUniform.value = MathUtils.clamp(progress / 0.55, 0, 1);
  barrelWhiteUniform.value = MathUtils.clamp((progress - 0.55) / 0.45, 0, 1);
  barrelGlowUniform.value = 0.24 + progress * 0.42 + chargeLevel * 0.5 + beatEnergy * 0.07;
  barrelPulseUniform.value = (barrelPulseUniform.value + dt * (3.5 + speed * 5.5)) % 100000;

  const cameraU = ctx.running ? massDriverRunProgress(runTime) : 0;
  ringHeat(progress, baseColor);
  environment.filaments.update(cameraU, elapsedNow, baseColor, 0.45 + chargeLevel * 0.8);

  // The muzzle is a distant pinprick that opens up as the payload closes on it.
  const muzzleGlow = 0.32 + progress ** 3 * 1.4 + chargeLevel * 0.55 + beatEnergy * 0.1;
  (environment.muzzle.iris.material as MeshBasicMaterial).color.copy(ARC_WHITE).multiplyScalar(muzzleGlow);
  (environment.muzzle.flare.material as MeshBasicMaterial).color.copy(ARC_VIOLET).multiplyScalar(muzzleGlow * 0.2);
  environment.muzzle.spikes.rotation.z += dt * 0.35;
  scratchColor.copy(PLASMA).multiplyScalar(0.2 + progress * 0.8);
  for (const spike of environment.muzzle.spikes.children) {
    ((spike as Mesh).material as MeshBasicMaterial).color.copy(scratchColor);
  }
}

function updatePost(dt: number, running: boolean, runTime: number) {
  // Capacitor violet floods the frame from the fault until the charge peaks.
  let chargeTarget = 0;
  if (running && runTime >= FAULT_TIME && runTime < LAUNCH_TIME) {
    const ramp = MathUtils.clamp((runTime - FAULT_TIME) / (LAUNCH_TIME - FAULT_TIME), 0, 1);
    chargeTarget = (interlocksCleared ? 0.16 : 0.34) * ramp ** 1.6;
  } else if (running && runTime >= LAUNCH_TIME && runTime < MUZZLE_TIME) {
    chargeTarget = 0.2;
  }
  chargeLevel += (chargeTarget - chargeLevel) * Math.min(1, dt * 1.6);
  chargeUniform.value = chargeLevel;

  const arcTarget = running && runTime >= FAULT_TIME && runTime < LAUNCH_TIME && !interlocksCleared
    ? 0.06 + 0.14 * MathUtils.clamp((runTime - FAULT_TIME) / (LAUNCH_TIME - FAULT_TIME), 0, 1)
    : 0;
  arcLevel = Math.max(arcTarget, arcLevel - dt * 1.5);
  arcUniform.value = arcLevel;

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.7 : 3.2));
  blastUniform.value = Math.max(0, blastUniform.value - dt * (blastUniform.value > 0.8 ? 1.5 : 2.8));
}

function updateEnemyRecords(dt: number, ctx: VisualContext) {
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.32)));

    updateEnemyTint(record, ctx);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    const aperture = record.mesh.userData.aperture as Mesh | undefined;
    if (aperture) aperture.scale.setScalar(0.75 + Math.abs(Math.sin(elapsedNow * 4.6 + record.mesh.id)) * 0.6);

    const faultCore = record.mesh.userData.faultCore as Mesh | undefined;
    if (faultCore) faultCore.rotation.z += dt * 2.4;

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z -= dt * 3;
      const pulse = 1 + Math.sin(elapsedNow * 12) * 0.06;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.85 * fit);
    }
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

  // Distance falloff keeps far additive stacks from blooming into blobs.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(clamp01(1 - (distance - 12) / 34));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_EDGE);
      continue;
    }
    if (locked) {
      if (part.kind === 'fill') part.material.color.copy(PLASMA).multiplyScalar(0.22);
      else if (part.kind === 'edge') part.material.color.copy(ARC_WHITE).multiplyScalar(1.7);
      else part.material.color.copy(ARC_WHITE).multiplyScalar(2.4);
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(ARC_WHITE).multiplyScalar(part.kind === 'fill' ? 0.55 : 2.1);
      continue;
    }
    const dim = part.kind === 'fill' ? 0.35 + 0.65 * closeness : 0.5 + 0.5 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const speed = ctx.running ? speedFactorAt(ctx.runTime) : 0.45;

  // The lens widens with airspeed; the barrel vibrates harder the faster it drives.
  const target = (speed - 0.9) * 7.2 + beatEnergy * 1.3 + surge * 10;
  fovOffset = MathUtils.lerp(fovOffset, MathUtils.clamp(target, -5, 36), Math.min(1, dt * 6.5));
  ctx.feel.setFovOffset(fovOffset);

  // The barrel vibrates harder the faster it drives; the rifling roll itself is
  // gameplay-owned, applied before this runs.
  if (ctx.running) ctx.feel.shake(dt * (0.16 + Math.max(0, speed - 1) * 0.42), MASS_DRIVER_SHAKE);

  ctx.feel.update(dt, { shake: MASS_DRIVER_SHAKE });
}

// ---- helpers ------------------------------------------------------------------------------------

function makeLockRing(color: Color): Group {
  const group = new Group();
  const clamp = new Mesh(
    new RingGeometry(0.9, 0.98, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.9), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.68, 0.71, 40),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ARC_WHITE, 0.6), 1.5), side: DoubleSide }),
  );
  group.add(clamp, inner);
  return group;
}

function disposeMaterials(object: Object3D) {
  object.traverse((child) => {
    const material = (child as Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
  });
}

function addScaled(target: Color, source: Color, scale: number) {
  target.r += source.r * scale;
  target.g += source.g * scale;
  target.b += source.b * scale;
  return target;
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle') return child;
  }
  return null;
}

function randomOffset(scale: number) {
  return new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
    .normalize()
    .multiplyScalar(scale * (0.5 + Math.random() * 0.7));
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(t: number) {
  return t * t * (3 - 2 * t);
}
