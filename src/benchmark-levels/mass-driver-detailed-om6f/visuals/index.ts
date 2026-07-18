import {
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { MD_BEAT_SECONDS, MD_RING_COUNT, MD_SHOT_TIME } from '../timing';
import { MD_RAIL } from '../gameplay';
import { mdRun, onSignal } from '../state';
import { decayPostFx, pumpDetonation, pumpFlash, resetPostFx, setChargeOverlay } from '../post-fx';
import { createEnvironment as buildEnvironment, type Environment } from './environment';
import {
  burstSplinters,
  createEffects,
  resetEffects,
  spawnArcBolt,
  spawnFlashDisc,
  spawnGlint,
  spawnShockwave,
  updateEffects,
  whipArcBolt,
} from './effects';
import {
  createArcMesh,
  createCapacitorMesh,
  createCoilMesh,
  createInterlockMesh,
  createThreaderMesh,
  type HostileVisual,
} from './enemies';
import { createLetterMesh, setLetterState } from './letters';
import {
  ARC_BLUE,
  HAZARD_AMBER,
  HAZARD_RED,
  IGNITION,
  ION_WHITE,
  LOCK_GRADIENT,
  VOLT_VIOLET,
  heatRamp,
  hdr,
} from './palette';

// The visual spine. It owns the palette decisions and the event choreography;
// every mesh here comes from a leaf that decides nothing. Because all five
// hostile kinds expose the same four materials, the per-frame tint pass below
// is the single place where "closing", "locked", "denied", and "hit" turn into
// color — which is what keeps the tunnel readable with bloom at zero.

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  feel: CameraFeelRig;
  elapsed: number;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  lockRing: Group | null;
  lockCount: number;
  deniedUntil: number;
  flashUntil: number;
};

type ProjectileRecord = { mesh: Object3D };

let environment: Environment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let strobe = 0;
let lastRingCrossed = -1;
// Seconds the audible transport runs behind nominal run time. The ring lattice
// is authored on run time, but what the player hears is the transport, so the
// crossings are nudged onto the beat that is actually sounding.
let beatOffset = 0;
let pendingShake = 0;

const scratchColor = new Color();
const scratchVector = new Vector3();
const scratchDirection = new Vector3();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<{ mesh: Group; kind: string }, EnemyRecord>({
  createRecord: ({ mesh, kind }) => ({
    mesh,
    kind,
    bornAt: null,
    lockRing: null,
    lockCount: 0,
    deniedUntil: -1,
    flashUntil: -1,
  }),
  disposeRecord: (record) => lockRings.detach(record),
});

const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = buildEnvironment(scene, MD_RAIL);
  createEffects(scene);
  return environment.root;
}

export function disposeEnvironment() {
  environment?.dispose();
  environment = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.mdKindTag = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue({ mesh, kind });
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'coil':
      return createCoilMesh();
    case 'threader':
      return createThreaderMesh();
    case 'capacitor':
      return createCapacitorMesh();
    case 'interlock':
      return createInterlockMesh();
    case 'arc':
      return createArcMesh();
    default:
      return createCoilMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 0) {
  mesh.userData.mdLocked = locked;
  mesh.userData.mdLockCount = lockCount;
  if (mesh.userData.mdKind === 'letter') setLetterState(mesh as Group, locked ? 'locked' : 'idle');
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.mdDeniedUntil = elapsedNow + 0.5;
  spawnShockwave(mesh.position, hdr(HAZARD_RED, 1.6), 4.4, 0.34);
  whipArcBolt(mesh.position, hdr(HAZARD_RED, 1.8), 3.2, 0.22, 1.3);
  if (mesh.userData.mdKind === 'letter') setLetterState(mesh as Group, 'denied');
}

/** The player's shot: a cold ion dart — a white-hot core in an arc-blue shell. */
export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new ConeGeometry(0.16, 1.5, 6), new MeshBasicMaterial({ color: hdr(ION_WHITE, 3.2) }));
  core.geometry.rotateX(Math.PI / 2);
  const shell = new Mesh(
    new ConeGeometry(0.3, 2.4, 6),
    createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.4), opacity: 0.5 }),
  );
  shell.geometry.rotateX(Math.PI / 2);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group });
  return group;
}

// ---------------------------------------------------------------------------
// Reticle: the breech charge gauge. Six arc segments light one per lock, and
// the sixth is ignition white, so a full volley literally reads "fully charged".
// ---------------------------------------------------------------------------

const RETICLE_SEGMENTS = 6;

export function createReticle() {
  const group = new Group();

  const ring = new Mesh(
    new RingGeometry(0.56, 0.6, 56),
    createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.2), side: DoubleSide }),
  );

  const spinner = new Group();
  for (let i = 0; i < 3; i += 1) {
    const tick = new Mesh(
      new RingGeometry(0.34, 0.39, 3, 1, (i / 3) * Math.PI * 2, 0.42),
      createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.0), side: DoubleSide }),
    );
    spinner.add(tick);
  }

  const gauge = new Group();
  const segments: MeshBasicMaterial[] = [];
  const gap = 0.1;
  for (let i = 0; i < RETICLE_SEGMENTS; i += 1) {
    const start = (i / RETICLE_SEGMENTS) * Math.PI * 2 + gap / 2;
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    gauge.add(new Mesh(
      new RingGeometry(0.68, 0.83, 3, 1, start, (Math.PI * 2) / RETICLE_SEGMENTS - gap),
      material,
    ));
    segments.push(material);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 18), createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 2.6) }));

  group.add(ring, spinner, gauge, dot);
  group.userData.mdRing = ring.material as MeshBasicMaterial;
  group.userData.mdSpinner = spinner;
  group.userData.mdSegments = segments;
  group.userData.mdActive = false;
  group.userData.mdLocks = 0;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.mdActive = active;
  reticle.userData.mdLocks = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.05 : 0));
  const segments = reticle.userData.mdSegments as MeshBasicMaterial[];
  for (let i = 0; i < segments.length; i += 1) {
    if (i < lockCount) {
      // The gauge climbs the lock gradient; the sixth segment is ignition white.
      segments[i].color.copy(colorForLockCount(i + 1, LOCK_GRADIENT)).multiplyScalar(i === 5 ? 3.2 : 1.5 + i * 0.22);
    } else {
      segments[i].color.copy(ARC_BLUE).multiplyScalar(0.1);
    }
  }
  const ringMaterial = reticle.userData.mdRing as MeshBasicMaterial;
  ringMaterial.color.copy(active ? hdr(ION_WHITE, 1.8) : hdr(ARC_BLUE, 1.2));
}

// ---------------------------------------------------------------------------
// Event choreography
// ---------------------------------------------------------------------------

function accentFor(record: EnemyRecord | undefined): Color {
  const visual = record?.mesh.userData.md as HostileVisual | undefined;
  return visual?.accentBase ?? ARC_BLUE;
}

function shatter(record: EnemyRecord | undefined, position: Vector3, heavy: boolean) {
  const visual = record?.mesh.userData.md as HostileVisual | undefined;
  const accent = visual?.accentBase ?? ARC_BLUE;
  const facets = visual?.facets;
  if (facets) {
    // The machine comes apart along its own facets, not into generic dust.
    for (const facet of facets) {
      scratchDirection.copy(facet.direction).applyQuaternion(record!.mesh.quaternion);
      burstSplinters(position, hdr(accent, heavy ? 1.4 : 0.9), heavy ? 7 : 4, heavy ? 26 : 17, {
        cone: scratchDirection.clone(),
        length: facet.size * (heavy ? 1.5 : 1.1),
        life: heavy ? 0.5 : 0.34,
      });
    }
  } else {
    burstSplinters(position, hdr(accent, 1.0), 14, 18);
  }
  spawnShockwave(position, hdr(accent, heavy ? 2.0 : 1.2), heavy ? 13 : 5.6, heavy ? 0.62 : 0.36);
  whipArcBolt(position, hdr(ION_WHITE, heavy ? 2.4 : 1.6), heavy ? 9 : 4.5, heavy ? 0.4 : 0.24, heavy ? 1.5 : 1);
  if (heavy) {
    whipArcBolt(position, hdr(VOLT_VIOLET, 2.0), 11, 0.44, 1.7);
    spawnShockwave(position, hdr(IGNITION, 1.4), 7, 0.42);
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'letter') return;
    if (kind === 'interlock') {
      // A double hazard ring announces a jammed clamp.
      spawnShockwave(worldPosition, hdr(HAZARD_AMBER, 2.2), 16, 0.6);
      spawnShockwave(worldPosition, hdr(HAZARD_AMBER, 1.2), 9, 0.42);
      return;
    }
    spawnShockwave(worldPosition, hdr(accentFor(record), 0.9), kind === 'arc' ? 2.4 : 4.2, 0.3);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    if (record) {
      record.lockCount = lockCount;
      if (!record.lockRing) {
        const visual = record.mesh.userData.md as HostileVisual | undefined;
        lockRings.attach(record, makeLockClamp(color, visual?.lockScale ?? 1.5), scene);
      }
    }
    spawnShockwave(worldPosition, hdr(color, 1.5), 3.4, 0.26);
    if (lockCount === 6) {
      // The sixth lock: the gun reads fully charged.
      pumpFlash(0.34);
      spawnGlint(worldPosition, hdr(IGNITION, 2.6), 3.2, 0.24);
      spawnShockwave(worldPosition, hdr(IGNITION, 2.4), 9, 0.4);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      lockRings.detach(record);
      record.lockCount = 0;
    }
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.4), 0.7, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (record) record.flashUntil = elapsedNow + 0.16;
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.8), 1.1, 0.14);
    if (lethal) return;
    // A non-lethal armor chip: splinters plus a whip of arc lightning.
    burstSplinters(worldPosition, hdr(ION_WHITE, 1.2), 9, 13, { life: 0.24 });
    whipArcBolt(worldPosition, hdr(ARC_BLUE, 2.0), 3.4, 0.2, 1.1);
    pendingShake = Math.max(pendingShake, 0.07);
  });

  bus.on('stage', ({ worldPosition }) => {
    spawnShockwave(worldPosition, hdr(HAZARD_AMBER, 1.6), 6.5, 0.42);
    whipArcBolt(worldPosition, hdr(HAZARD_AMBER, 1.8), 5, 0.3, 1.4);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const heavy = record?.kind === 'interlock';
    shatter(record, worldPosition, heavy);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    pendingShake = Math.max(pendingShake, heavy ? 0.4 : 0.09);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    // A miss fizzles rather than shatters: it got away.
    burstSplinters(worldPosition, hdr(ARC_BLUE, 0.35), 5, 5, { life: 0.3 });
  });

  bus.on('reject', () => {
    pumpDetonation(0.24);
    pendingShake = Math.max(pendingShake, 0.16);
  });

  bus.on('playerhit', () => {
    pumpDetonation(0.4);
    pendingShake = Math.max(pendingShake, 0.5);
  });

  bus.on('beat', ({ beatNumber, isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
    if (!mdRun.running) return;
    const drift = mdRun.runTime - beatNumber * MD_BEAT_SECONDS;
    // Ignore wild readings (a paused tab, a beat from the previous run) and
    // ease onto the rest, so the correction never jumps a ring.
    if (Math.abs(drift) < MD_BEAT_SECONDS * 0.75) beatOffset += (drift - beatOffset) * 0.3;
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < size || size < 4) return;
    pumpFlash(size === 6 ? 0.4 : 0.2);
  });

  bus.on('runstart', () => {
    resetEffects();
    resetPostFx();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    beatEnergy = 0;
    strobe = 0;
    beatOffset = 0;
    lastRingCrossed = -1;
    pendingShake = 0;
  });

  onSignal((signal) => {
    if (signal.type === 'interlock-spawn') {
      pendingShake = Math.max(pendingShake, 0.3);
    } else if (signal.type === 'interlock-down') {
      pumpFlash(0.18);
    } else if (signal.type === 'interlocks-clear') {
      // A brief full-tunnel white strobe sweep.
      strobe = 1;
      pumpFlash(0.6);
    } else if (signal.type === 'shot') {
      strobe = Math.max(strobe, 0.6);
      pumpFlash(1.7);
      pendingShake = 1;
    } else if (signal.type === 'detonation') {
      pumpDetonation(1.6);
      pendingShake = 1;
    }
  });
}

function makeLockClamp(color: Color, scale: number): Group {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.9, 0.98, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 2.0), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.7, 0.75, 6),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ION_WHITE, 0.5), 1.5), side: DoubleSide }),
  );
  inner.rotation.z = Math.PI / 6;
  group.add(outer, inner);
  group.userData.mdScale = scale;
  return group;
}

// ---------------------------------------------------------------------------
// Per-frame tint pass and environment drive
// ---------------------------------------------------------------------------

const CLOSE_NEAR = 12;
const CLOSE_FAR = 62;

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.4);
  strobe = Math.max(0, strobe - dt * 2.6);
  decayPostFx(dt);

  // The charge overlay is deliberately held back: raised to a high power it
  // stays out of the way until the last bar and a half, so the clamps remain
  // legible. The shot ends it outright — the whiteout belongs to the flash.
  setChargeOverlay(mdRun.gunFired ? 0 : mdRun.charge ** 4 * 0.78 + strobe * 0.25);

  // Airspeed breathes the field of view; the beat kicks it a hair.
  ctx.feel.setFovOffset((mdRun.speedFactor - 0.5) * 2.1 + beatEnergy * 0.9, { response: 6 });
  if (pendingShake > 0) {
    ctx.feel.shake(pendingShake);
    pendingShake = 0;
  }

  updateRingCrossings(ctx);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Enemies pop in with a quick overshoot.
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.32)));

    if (record.kind === 'letter') {
      const denied = (record.mesh.userData.mdDeniedUntil as number | undefined) ?? -1;
      if (denied > elapsedNow) setLetterState(record.mesh, 'denied', (denied - elapsedNow) / 0.5);
      else setLetterState(record.mesh, record.mesh.userData.mdLocked === true ? 'locked' : 'idle');
    } else {
      tintHostile(record, ctx);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 1.5;
      const pulse = 1 + Math.sin(elapsedNow * 8.5) * 0.04;
      record.lockRing.scale.setScalar(pulse * (record.lockRing.userData.mdScale as number));
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    // The dart drops a blue trail behind it.
    burstSplinters(record.mesh.position, hdr(ARC_BLUE, 0.55), 1, 1.4, { life: 0.2, length: 0.5 });
  }

  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const spinner = reticle.userData.mdSpinner as Group;
    const locks = (reticle.userData.mdLocks as number) ?? 0;
    // The gauge spins faster while charging.
    spinner.rotation.z += dt * (0.8 + locks * 1.4 + (reticle.userData.mdActive ? 1.6 : 0));
  }

  environment?.update({
    camera: ctx.camera,
    dt,
    runProgress: mdRun.runProgress,
    runTime: mdRun.runTime,
    beatTime: mdRun.runTime - beatOffset,
    charge: mdRun.charge,
    speedFactor: mdRun.speedFactor,
    running: mdRun.running,
    gunFired: mdRun.gunFired,
    elapsed: elapsedNow,
    beatEnergy,
    strobe,
  });

  updateEffects(dt, ctx.camera);
}

/**
 * Every crossing lands on a beat by construction, so the pulse is driven from
 * run time rather than the audio callback: the ring index the camera has just
 * passed *is* the beat number.
 */
function updateRingCrossings(ctx: VisualContext) {
  if (!environment || !mdRun.running) return;
  const index = Math.floor((mdRun.runTime - beatOffset) / MD_BEAT_SECONDS);
  if (index <= lastRingCrossed || index >= MD_RING_COUNT || mdRun.runTime > MD_SHOT_TIME) {
    lastRingCrossed = Math.max(lastRingCrossed, Math.min(index, MD_RING_COUNT));
    return;
  }
  lastRingCrossed = index;
  const downbeat = index % 4 === 0;
  environment.ringPosition(index, scratchVector);
  const radius = environment.ringRadius(index);
  const heat = heatRamp((index / (MD_RING_COUNT - 1)) * 0.72 + mdRun.charge * 0.28, scratchColor);
  spawnShockwave(
    scratchVector,
    heat.clone().multiplyScalar(downbeat ? 2.2 : 1.1),
    radius * (downbeat ? 2.1 : 1.5),
    downbeat ? 0.42 : 0.28,
  );
  if (downbeat) ctx.feel.kickFov(0.85, { decay: 7 });
}

function tintHostile(record: EnemyRecord, ctx: VisualContext) {
  const visual = record.mesh.userData.md as HostileVisual | undefined;
  if (!visual) return;

  const distance = record.mesh.position.distanceTo(ctx.camera.position);
  // Bloom halos are screen-space: a far drone would sit inside its own halo and
  // read as a blob. Hot elements only reach full energy as the target closes.
  const closeness = smoothstep(1 - clamp01((distance - CLOSE_NEAR) / (CLOSE_FAR - CLOSE_NEAR)));
  const locked = record.mesh.userData.mdLocked === true;
  const denied = (record.mesh.userData.mdDeniedUntil as number | undefined) ?? -1;
  const deniedAmount = denied > elapsedNow ? (denied - elapsedNow) / 0.5 : 0;
  const flash = record.flashUntil > elapsedNow ? (record.flashUntil - elapsedNow) / 0.16 : 0;

  // One tint pass, four states. Base first, then each state overrides upward.
  scratchColor.copy(visual.accentBase).multiplyScalar(1.0 + closeness * 0.9);
  let fillScale = 0.85 + closeness * 0.6;
  let coreColor = visual.coreBase;
  let coreScale = 1.4 + closeness * 1.6;

  if (locked) {
    scratchColor.copy(ION_WHITE).multiplyScalar(2.4);
    fillScale = 1.5;
    coreColor = IGNITION;
    coreScale = 3.0;
  }
  if (deniedAmount > 0) {
    scratchColor.copy(HAZARD_RED).multiplyScalar(1.6 + deniedAmount * 1.8);
    fillScale = 1.0 + deniedAmount * 1.4;
    coreColor = HAZARD_RED;
    coreScale = 1.6 + deniedAmount * 2.2;
  }
  if (flash > 0) {
    scratchColor.copy(IGNITION).multiplyScalar(2.4 + flash * 3.2);
    fillScale = 1.6 + flash * 2.4;
    coreColor = IGNITION;
    coreScale = 3.0 + flash * 4;
  }

  visual.edge.color.copy(scratchColor);
  visual.fill.color.copy(locked || deniedAmount > 0 || flash > 0
    ? scratchColor.clone().multiplyScalar(0.18)
    : GUNMETAL_TINT.clone().multiplyScalar(fillScale));
  visual.core.color.copy(coreColor).multiplyScalar(coreScale);
  visual.glow.color.copy(coreColor).multiplyScalar(coreScale * 0.35);
  if (visual.eye) {
    const charge = (record.mesh.userData.mdCharge as number | undefined) ?? 0;
    visual.eye.color.copy(charge > 0 ? HAZARD_AMBER : ARC_BLUE).multiplyScalar(1.6 + charge * 3.4 + closeness);
  }

  // Staged parts: the capacitor sheds its staves, the interlock pops its cowl.
  const exposed = record.mesh.userData.mdExposed === true;
  if (visual.staves && visual.staves.visible && exposed) {
    visual.staves.visible = false;
    shedStaves(record, visual);
  }
  if (visual.cowl && visual.cowl.visible && exposed) {
    visual.cowl.visible = false;
    spawnShockwave(record.mesh.position, hdr(HAZARD_AMBER, 2.0), 8, 0.44);
    burstSplinters(record.mesh.position, hdr(HAZARD_AMBER, 1.2), 16, 20, { life: 0.42 });
  }
  if (visual.wireShells) {
    // Ball lightning: the shells re-randomize every frame. That instability is
    // the "this is incoming" tell.
    for (const shell of visual.wireShells) {
      shell.rotation.set(Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283);
      shell.scale.setScalar(0.78 + Math.random() * 0.44);
    }
  }
}

function shedStaves(record: EnemyRecord, visual: HostileVisual) {
  for (const facet of visual.facets) {
    scratchDirection.copy(facet.direction).applyQuaternion(record.mesh.quaternion);
    burstSplinters(record.mesh.position, hdr(ARC_BLUE, 1.1), 5, 20, {
      cone: scratchDirection.clone(),
      length: 1.4,
      life: 0.5,
    });
  }
  spawnShockwave(record.mesh.position, hdr(VOLT_VIOLET, 1.8), 9, 0.46);
  whipArcBolt(record.mesh.position, hdr(VOLT_VIOLET, 2.2), 6, 0.34, 1.5);
}

export function spawnMuzzleFlash(camera: PerspectiveCamera) {
  camera.getWorldDirection(scratchDirection);
  scratchVector.copy(camera.position).addScaledVector(scratchDirection, 22);
  spawnFlashDisc(scratchVector, hdr(IGNITION, 3.4), 46, 0.7);
  spawnShockwave(scratchVector, hdr(IGNITION, 2.6), 60, 0.6);
  for (let i = 0; i < 3; i += 1) {
    whipArcBolt(scratchVector, hdr(ION_WHITE, 2.6), 24, 0.4, 2);
  }
}

export function spawnDetonation(camera: PerspectiveCamera) {
  camera.getWorldDirection(scratchDirection);
  scratchVector.copy(camera.position).addScaledVector(scratchDirection, 14);
  spawnFlashDisc(scratchVector, hdr(HAZARD_RED, 3.0), 52, 0.9);
  spawnShockwave(scratchVector, hdr(HAZARD_AMBER, 2.4), 44, 0.7);
  burstSplinters(scratchVector, hdr(HAZARD_AMBER, 1.4), 90, 34, { life: 0.8, length: 1.6 });
  for (let i = 0; i < 5; i += 1) {
    whipArcBolt(scratchVector, hdr(HAZARD_RED, 2.4), 20, 0.5, 2.2);
    spawnArcBolt(camera.position, scratchVector, hdr(HAZARD_AMBER, 2.0), 0.5, 2.4);
  }
}

const GUNMETAL_TINT = new Color(0.115, 0.130, 0.155);

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle') return child;
  }
  return null;
}

function easeOutBack(t: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
