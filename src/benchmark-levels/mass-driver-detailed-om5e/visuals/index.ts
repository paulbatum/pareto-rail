import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { sampleRailFrame } from '../../../engine/rail';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createMassDriverRail } from '../gameplay';
import { BEAT_SECONDS, MASS_DRIVER_MARKERS, RING_COUNT, SHOT_TIME } from '../timing';
import {
  createArcMesh,
  createCapacitorMesh,
  createCoilMesh,
  createInterlockMesh,
  createThreaderMesh,
  hostilePartsOf,
  type HostileParts,
} from './enemies';
import { createMassDriverEnvironment, type MassDriverEnvironment } from './environment';
import {
  burstArcWhip,
  burstSplinters,
  createEffects,
  disposeEffects,
  dropTrail,
  resetEffects,
  spawnFlashDisc,
  spawnGlint,
  spawnShock,
  updateEffects,
} from './effects';
import { cachedGeometry } from './geometry-cache';
import { createLetterMesh, setLetterState } from './letters';
import { chargeUniform, detonationUniform, flashUniform } from './post-fx';
import {
  ARC_BLUE,
  HAZARD_AMBER,
  HAZARD_RED,
  IGNITION,
  ION_WHITE,
  LOCK_GRADIENT,
  VOLT_VIOLET,
  heat,
  hdr,
} from './palette';

// The visual spine. It owns the palette decisions, the event choreography, and
// the one tint pass that drives every hostile's state; the leaf files own mesh
// construction, the barrel, and the effect pools.

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  feel: CameraFeelRig;
  elapsed: number;
  runTime: number;
  runProgress: number;
  running: boolean;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  previous: Vector3;
};

// A metallic gun-barrel rattle: quick and tight, more roll than pitch — the
// whole barrel ringing rather than a soft impact.
const BARREL_RATTLE: CameraFeelShakeOptions = {
  decay: 4.6,
  pitchDegrees: 0.22,
  yawDegrees: 0.2,
  rollDegrees: 1.5,
  frequency: 19,
  smoothing: 36,
};

const CHARGE_START = MASS_DRIVER_MARKERS.interlock;

let environment: MassDriverEnvironment | null = null;
const bankCurve = createMassDriverRail();
let elapsedNow = 0;
let beatEnergy = 0;
let flash = 0;
let strobe = 0;
let detonation = 0;
let lastBeatIndex = -1;
let shotFired = false;
const scratchColor = new Color();
const scratchVector = new Vector3();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
  // Clamp geometry is shared across every lock; only the materials are per-clamp.
  disposeAdornment: (adornment) => {
    adornment.traverse((child) => {
      const material = (child as Mesh).material;
      if (Array.isArray(material)) for (const entry of material) entry.dispose();
      else material?.dispose();
    });
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  environment = createMassDriverEnvironment(scene);
  createEffects(scene);
  return environment.root;
}

/** Called from the level runtime's dispose so a remount starts from a clean scene. */
export function disposeVisuals() {
  disposeEffects();
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
  environment?.dispose();
  environment = null;
}

// Hostiles are sized so they read as objects rather than sparks at the distances
// this barrel engages them at; the interlocks are already large by construction.
const KIND_SCALE: Record<string, number> = {
  coil: 1.3,
  threader: 1.25,
  capacitor: 1.15,
  arc: 1.1,
};

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.userData.baseScale = KIND_SCALE[kind] ?? 1;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'threader':
      return createThreaderMesh();
    case 'capacitor':
      return createCapacitorMesh();
    case 'arc':
      return createArcMesh();
    case 'interlock':
      return createInterlockMesh();
    default:
      return createCoilMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterState(mesh as Group, locked ? 'locked' : 'idle');
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.42;
  if (mesh.userData.isLetter) setLetterState(mesh as Group, 'denied');
  spawnShock(mesh.position, hdr(HAZARD_RED, 1.6), 3.4, 0.3);
  burstArcWhip(mesh.position, hdr(HAZARD_RED, 1.7), 3, 2.4, 1.3);
  detonation = Math.max(detonation, 0.2);
}

export function createProjectileMesh() {
  const group = new Group();
  // A cold ion dart: a stretched white-hot core inside a translucent arc-blue shell.
  const core = new Mesh(
    cachedGeometry('dart:core', () => new OctahedronGeometry(0.3, 0)),
    new MeshBasicMaterial({ color: hdr(IGNITION, 3.2) }),
  );
  core.scale.set(0.34, 0.34, 2.3);
  const shell = new Mesh(
    cachedGeometry('dart:shell', () => new OctahedronGeometry(0.5, 0)),
    createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.1), opacity: 0.45 }),
  );
  shell.scale.set(0.44, 0.44, 2.0);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group, previous: new Vector3() });
  return group;
}

// ---- reticle: the breech charge gauge ---------------------------------------
// Six arc segments light one per lock, climbing the lock gradient. The sixth is
// ignition-white, so a full volley literally reads "fully charged".

export function createReticle() {
  const group = new Group();
  const ringMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.1), side: DoubleSide });
  const ring = new Mesh(new RingGeometry(0.52, 0.555, 56), ringMaterial);

  const spinner = new Group();
  const segmentMaterials: MeshBasicMaterial[] = [];
  for (let index = 0; index < 6; index += 1) {
    const start = (index / 6) * Math.PI * 2 + 0.07;
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    const segment = new Mesh(new RingGeometry(0.66, 0.78, 10, 1, start, Math.PI / 3 - 0.14), material);
    segmentMaterials.push(material);
    spinner.add(segment);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 18), createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 2.4) }));

  group.add(ring, spinner, dot);
  group.userData.spinner = spinner;
  group.userData.segments = segmentMaterials;
  group.userData.ringMaterial = ringMaterial;
  group.userData.active = false;
  group.userData.lockCount = 0;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.05 : 0));
  const segments = reticle.userData.segments as MeshBasicMaterial[];
  segments.forEach((material, index) => {
    if (index >= lockCount) {
      material.color.setRGB(0.03, 0.07, 0.12);
      return;
    }
    material.color.copy(hdr(colorForLockCount(index + 1, LOCK_GRADIENT), index === 5 ? 3.2 : 1.9));
  });
  (reticle.userData.ringMaterial as MeshBasicMaterial).color.copy(hdr(ARC_BLUE, active ? 1.9 : 1.1));
}

// ---- event choreography ------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'interlock') {
      // A jammed clamp announces itself: a double hazard ring and a jolt.
      spawnShock(worldPosition, hdr(HAZARD_AMBER, 1.9), 9, 0.42);
      spawnShock(worldPosition, hdr(HAZARD_AMBER, 1.1), 5.2, 0.6);
      burstArcWhip(worldPosition, hdr(HAZARD_AMBER, 1.4), 4, 4.5, 1.1);
      feel.shake(0.4, BARREL_RATTLE);
    } else if (kind === 'arc') {
      spawnShock(worldPosition, hdr(VOLT_VIOLET, 1.4), 2.4, 0.24);
    } else if (kind !== 'letter') {
      spawnShock(worldPosition, hdr(ARC_BLUE, 0.9), 3.0, 0.34);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, createLockClamp(color), scene);
      record.mesh.userData.lockScale = hostilePartsOf(record.mesh)?.lockRingScale ?? 1;
    }
    spawnShock(worldPosition, hdr(color, 1.5), 2.6, 0.26);
    if (lockCount === 6) {
      // The sixth lock is ignition: a blinding bloom pump.
      flash = Math.max(flash, 0.34);
      spawnGlint(worldPosition, hdr(IGNITION, 2.6), 3.2, 0.24);
      spawnShock(worldPosition, hdr(IGNITION, 2.2), 7.5, 0.36);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    const record = projectileRecords.claim(projectileId);
    if (record) record.previous.copy(worldPosition);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.3), 0.55, 0.11);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    if (lethal) return;
    // An armor chip: a cross-glint for the player's own impact, plus a whip of
    // lightning off the plate that refused to break.
    const record = enemyRecords.get(enemyId);
    if (record) record.mesh.userData.hitFlashUntil = elapsedNow + 0.24;
    spawnGlint(worldPosition, hdr(IGNITION, 2.0), 1.4, 0.16);
    burstSplinters(worldPosition, hdr(ION_WHITE, 1.1), 7, 11);
    burstArcWhip(worldPosition, hdr(ARC_BLUE, 1.6), 2, 2.6, 1.1);
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const hostile = record ? hostilePartsOf(record.mesh) : undefined;
    // The armor shears off along its own facets and the core is exposed.
    if (record && hostile) {
      for (const part of hostile.shellParts) part.visible = false;
      for (const part of hostile.revealParts) part.visible = true;
      burstSplinters(worldPosition, hdr(ARC_BLUE, 1.3), hostile.facets.length * 3, 15, worldFacets(record.mesh, hostile));
    }
    spawnShock(worldPosition, hdr(VOLT_VIOLET, 1.7), 6.5, 0.4);
    burstArcWhip(worldPosition, hdr(VOLT_VIOLET, 1.8), 5, 4.2, 1.2);
    spawnGlint(worldPosition, hdr(IGNITION, 2.4), 2.0, 0.2);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const hostile = hostilePartsOf(record.mesh);
    const isInterlock = record.mesh.userData.kind === 'interlock';
    const accent = isInterlock
      ? HAZARD_AMBER
      : record.mesh.userData.kind === 'arc' ? VOLT_VIOLET : ARC_BLUE;
    const heavy = isInterlock ? 2 : 1;
    burstSplinters(
      worldPosition,
      hdr(accent, 1.2),
      (hostile ? hostile.facets.length * 4 : 12) * heavy,
      15 + heavy * 6,
      hostile ? worldFacets(record.mesh, hostile) : undefined,
    );
    burstArcWhip(worldPosition, hdr(IGNITION, 1.8), 4 * heavy, 4 + heavy * 2, 1.2);
    spawnShock(worldPosition, hdr(accent, 1.1), 5.5 * heavy, 0.42);
    spawnGlint(worldPosition, hdr(IGNITION, 1.5), 1.1 * heavy, 0.16);
    if (isInterlock) {
      spawnShock(worldPosition, hdr(IGNITION, 1.6), 12, 0.55);
      feel.shake(0.5, BARREL_RATTLE);
      flash = Math.max(flash, 0.18);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.get(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    // A miss fizzles: a few dim sparks and nothing else.
    burstSplinters(worldPosition, ARC_BLUE.clone().multiplyScalar(0.35), 4, 5);
  });

  bus.on('reject', () => {
    detonation = Math.max(detonation, 0.3);
    feel.shake(0.22, BARREL_RATTLE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < 4 || kills < size) return;
    flash = Math.max(flash, 0.1 + kills * 0.03);
  });

  bus.on('playerhit', () => {
    detonation = Math.max(detonation, 0.45);
    feel.shake(0.62, BARREL_RATTLE);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.42;
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    lastBeatIndex = -1;
    shotFired = false;
    flash = 0;
    strobe = 0;
    detonation = 0;
  });
}

/** The sixth interlock kill runs a brief full-tunnel white strobe sweep. */
export function fireInterlocksClearStrobe() {
  strobe = 1;
  flash = Math.max(flash, 0.42);
}

/** Containment failure: hazard red bleeding to white, and the barrel comes apart. */
export function fireDetonation(camera: PerspectiveCamera) {
  detonation = 1.5;
  camera.getWorldDirection(scratchVector);
  spawnFlashDisc(camera.position.clone().addScaledVector(scratchVector, 6), hdr(HAZARD_RED, 3.4), 30, 0.8);
  burstArcWhip(camera.position.clone().addScaledVector(scratchVector, 9), hdr(HAZARD_AMBER, 2), 10, 16, 1.4);
}

function worldFacets(mesh: Object3D, hostile: HostileParts) {
  return hostile.facets.map((facet) => facet.clone().applyQuaternion(mesh.quaternion));
}

function createLockClamp(color: Color): Group {
  // A hexagonal clamp of two nested rings, camera-facing and slowly rotating.
  const group = new Group();
  const outer = new Mesh(
    cachedGeometry('clamp:outer', () => new RingGeometry(0.92, 1.0, 6)),
    createAdditiveBasicMaterial({ color: hdr(color, 2.0), side: DoubleSide }),
  );
  const inner = new Mesh(
    cachedGeometry('clamp:inner', () => new RingGeometry(0.68, 0.72, 6)),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(IGNITION, 0.5), 1.5), side: DoubleSide }),
  );
  inner.rotation.z = Math.PI / 6;
  group.add(outer, inner);
  return group;
}

// ---- the tint pass ------------------------------------------------------------
// Every hostile is built from the same three material roles, so one pass drives
// every state: enemies brighten as they close, a lock turns them ion-white with
// a blue-tinted fill, a denial flushes them hazard red, a hit flashes blinding.

function tintHostile(record: EnemyRecord, camera: PerspectiveCamera) {
  const hostile = hostilePartsOf(record.mesh);
  if (!hostile) return;
  const userData = record.mesh.userData;
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smoothstep(1 - clamp01((distance - 12) / 52));

  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const hitFlash = clamp01((((userData.hitFlashUntil as number | undefined) ?? -Infinity) - elapsedNow) / 0.24);
  const locked = userData.locked === true;

  const edge = scratchColor.copy(hostile.baseEdge);
  let edgeGain = 0.55 + closeness * 1.1;
  let fillGain = 0.35 + closeness * 0.85;
  let coreGain = 0.4 + closeness * 0.85;

  if (locked) {
    edge.copy(ION_WHITE);
    edgeGain = 2.4;
    coreGain = 2.2;
  }
  if (denied) {
    edge.copy(HAZARD_RED);
    edgeGain = 2.6;
    fillGain = 0.9;
    coreGain = 2.0;
  }
  if (hitFlash > 0) {
    edge.lerp(IGNITION, hitFlash);
    edgeGain += hitFlash * 2.6;
    coreGain += hitFlash * 2.4;
    fillGain += hitFlash * 0.9;
  }

  for (const material of hostile.edges) material.color.copy(edge).multiplyScalar(edgeGain);
  for (const material of hostile.fills) {
    material.color.setRGB(0.115, 0.128, 0.155).multiplyScalar(fillGain * 1.7);
    if (locked) material.color.lerp(ARC_BLUE, 0.35);
    if (denied) material.color.lerp(HAZARD_RED, 0.45);
  }
  for (const material of hostile.cores) material.color.copy(hostile.baseCore).multiplyScalar(0.9 + coreGain * 0.85);
  for (const material of hostile.glows) material.color.copy(edge).multiplyScalar(0.35 + coreGain * 0.45);
}

// ---- per-frame ----------------------------------------------------------------

export function updateVisuals(dt: number, context: VisualContext) {
  const { camera, feel, running, runTime, runProgress } = context;
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.4);
  flash = Math.max(0, flash - dt * 3.4);
  strobe = Math.max(0, strobe - dt * 1.5);
  detonation = Math.max(0, detonation - dt * 2.2);

  const charge = running ? clamp01((runTime - CHARGE_START) / (SHOT_TIME - CHARGE_START)) : 0;

  // THE SHOT — the single biggest moment in the game.
  if (running && !shotFired && runTime >= SHOT_TIME) {
    shotFired = true;
    feel.kickFov(21, { decay: 1.5 });
    feel.shake(1, { ...BARREL_RATTLE, decay: 2.2 });
    flash = 1.35;
    camera.getWorldDirection(scratchVector);
    spawnFlashDisc(camera.position.clone().addScaledVector(scratchVector, 7), hdr(IGNITION, 4), 34, 0.75);
    spawnShock(camera.position.clone().addScaledVector(scratchVector, 9), hdr(IGNITION, 2.6), 60, 0.7);
  }

  // Ring crossings: driven off the run clock, so the flash, the shockwave, and
  // the FOV kick land on the beat frame-exactly rather than chasing a timer.
  if (running) {
    const beatIndex = Math.floor(runTime / BEAT_SECONDS);
    if (beatIndex > lastBeatIndex && runTime < SHOT_TIME) {
      lastBeatIndex = beatIndex;
      const downbeat = beatIndex % 4 === 0;
      camera.getWorldDirection(scratchVector);
      const at = camera.position.clone().addScaledVector(scratchVector, 2.5);
      heat(clamp01((beatIndex / (RING_COUNT - 1)) * 0.72 + charge * 0.4), scratchColor);
      spawnShock(
        at,
        scratchColor.clone().multiplyScalar(downbeat ? 2.4 : 1.2),
        downbeat ? 26 : 17,
        downbeat ? 0.36 : 0.28,
      );
      if (downbeat) feel.kickFov(1.5, { decay: 7 });
    }
  } else {
    lastBeatIndex = -1;
  }

  environment?.update({
    dt,
    camera,
    runTime: running ? runTime : context.elapsed,
    runProgress,
    running,
    charge,
    strobe,
    fired: shotFired,
    beatEnergy,
  });

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    // Pop in with a quick overshoot.
    const base = (record.mesh.userData.baseScale as number | undefined) ?? 1;
    record.mesh.scale.setScalar(base * easeOutBack(Math.min(1, (elapsedNow - record.bornAt) / 0.32)));

    if (record.mesh.userData.isLetter) {
      const denied = ((record.mesh.userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;
      if (denied) setLetterState(record.mesh, 'denied');
      else if (record.mesh.userData.locked !== true) setLetterState(record.mesh, 'idle');
    } else {
      tintHostile(record, camera);
    }

    // Arc bolts re-randomize their wire shells every frame — the unstable tell.
    const shells = record.mesh.userData.arcShells as Object3D[] | undefined;
    if (shells) {
      for (const shell of shells) {
        shell.rotation.set(Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283);
        shell.scale.setScalar(0.82 + Math.random() * 0.42);
      }
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 1.9;
      const fit = (record.mesh.userData.lockScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar((1 + Math.sin(elapsedNow * 10) * 0.045) * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    scratchVector.copy(record.mesh.position).sub(record.previous);
    if (scratchVector.lengthSq() > 0.0001) dropTrail(record.mesh.position, scratchVector, hdr(ARC_BLUE, 0.9));
    record.previous.copy(record.mesh.position);
  }

  const spinner = findReticleSpinner(context.scene);
  if (spinner) {
    const parent = spinner.parent;
    const lockCount = (parent?.userData.lockCount as number | undefined) ?? 0;
    // Spins faster while charging.
    spinner.rotation.z += dt * (parent?.userData.active === true ? 1.5 + lockCount * 0.6 : 0.5);
  }

  updateEffects(dt, camera);

  // Overlays. The charge is held back so the interlock fight stays readable
  // until the last bar and a half; the true whiteout belongs to the shot.
  flashUniform.value = Math.min(1.6, flash + strobe * 0.5);
  chargeUniform.value = shotFired ? 0 : charge ** 3.2 * 0.5;
  detonationUniform.value = detonation;

  applyCameraFeel(dt, context);
}

/** Camera: a cosmetic bank into the weave, FOV breathing with airspeed, barrel rattle. */
function applyCameraFeel(dt: number, context: VisualContext) {
  const { camera, feel, running, runTime, runProgress } = context;
  if (running) {
    const u = Math.min(0.999, runProgress);
    const here = sampleRailFrame(bankCurve, u);
    const ahead = sampleRailFrame(bankCurve, Math.min(1, u + 0.004));
    const bank = (ahead.tangent.x - here.tangent.x) * 26;
    camera.rotateZ(Math.max(-0.09, Math.min(0.09, bank)));

    // The field of view breathes with airspeed.
    const airspeed = runTime < SHOT_TIME
      ? runTime / SHOT_TIME
      : 1 + Math.min(1, (runTime - SHOT_TIME) / 0.5) * 2.4;
    feel.setFovOffset(airspeed * 3.4 + beatEnergy * 0.7, { response: 9 });
  }
  feel.update(dt, { shake: BARREL_RATTLE });
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle' && child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function easeOutBack(t: number) {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
