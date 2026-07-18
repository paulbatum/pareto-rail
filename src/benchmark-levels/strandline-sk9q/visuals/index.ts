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
  TorusGeometry,
  Vector3,
} from 'three';
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
import { createStrandlineRail, parentAnchorAt, strandlineRunProgress, strandlineSpeedAt } from '../gameplay';
import { STRANDLINE_SK9Q_MARKERS, STRANDLINE_SK9Q_PLAYER_HEALTH } from '../timing';
import {
  animateBroodling,
  animateHusk,
  animateLatcher,
  animateSkitter,
  animateSpitter,
  crackHuskPlates,
  createBroodlingMesh,
  createHuskMesh,
  createLatcherMesh,
  createSkitterMesh,
  createSpitterMesh,
  createSporeMesh,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type StrandlineEnvironmentInternal } from './environment';
import { burstSparks, createEffects, dropTrail, resetEffects, spawnGlint, spawnHealBloom, spawnRing, updateEffects } from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { animateParent, createParentMesh, createWebbing, deflateParentSac, updateWebPanel, type WebPanel } from './parent';
import { DENY_FILL, DENY_VIOLET, GOLD, JADE, LOCK_GRADIENT, MARK_GOLD, MARK_WHITE, VIOLET, VIOLET_HOT, VIOLET_PALE, hdr } from './palette';
import { flashUniform, hitEdgeUniform, sereneUniform } from './post-fx';

export type StrandlineVisualFrame = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type StrandlineCameraFrame = {
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

const STRANDLINE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.0,
  pitchDegrees: 0.3,
  yawDegrees: 0.24,
  rollDegrees: 0.55,
  frequency: 7.5,
  smoothing: 18,
};

const rail = createStrandlineRail();

let environment: StrandlineEnvironmentInternal | null = null;
let webbing: { root: Group; panels: WebPanel[] } | null = null;
let deathHolder: Group | null = null;

let beatEnergy = 0;
let elapsedNow = 0;
let cameraFovOffset = 0;
let cameraRoll = 0;

let bossId = -1;
let websDead = 0;
let parentDead = false;
let parentDeathTime = 0;
let parentEscaped = false;
let dyingParent: { mesh: Object3D; since: number; mode: 'kill' | 'burrow'; velocity: Vector3 } | null = null;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    // Each enemy owns its geometries/materials (no shared module caches), so the
    // whole mesh is safe to release when the record is dropped with dispose.
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
  webbing = createWebbing();
  webbing.root.visible = false;
  scene.add(webbing.root);
  deathHolder = new Group();
  scene.add(deathHolder);
}

// ---- enemy factories ---------------------------------------------------------

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
      return createLetterMesh(letter ?? 'C');
    case 'latcher':
      return createLatcherMesh();
    case 'skitter':
      return createSkitterMesh();
    case 'husk':
      return createHuskMesh();
    case 'spitter':
      return createSpitterMesh();
    case 'spore':
      return createSporeMesh();
    case 'broodling':
      return createBroodlingMesh();
    case 'parent':
      return createParentMesh();
    default:
      return createLatcherMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, hdr(DENY_VIOLET, 1.2), 2.4, 0.32);
}

// Player shot: a dart of condensed sunlight — white core in a jade sheath.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.28, 0);
  coreGeometry.scale(0.4, 0.4, 2.2);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(MARK_WHITE, 2.4) })));
  const shellGeometry = new OctahedronGeometry(0.44, 0);
  shellGeometry.scale(0.5, 0.5, 1.7);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(JADE, 1.2), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: GOLD.clone().multiplyScalar(0.75) });
  return group;
}

// ---- reticle -----------------------------------------------------------------

// A bubble ring with three orbit beads: the cleansing light gathering.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.58, 0.62, 48), new MeshBasicMaterial());
  addPart(outer, hdr(JADE, 1.2));

  const spinner = new Group();
  const arc = new Mesh(new RingGeometry(0.4, 0.44, 24, 1, 0, Math.PI * 0.65), new MeshBasicMaterial());
  addPart(arc, hdr(GOLD, 1.1));
  spinner.add(arc);

  const beads = new Group();
  for (let i = 0; i < 3; i += 1) {
    const bead = new Mesh(new CircleGeometry(0.05, 12), new MeshBasicMaterial());
    addPart(bead, hdr(GOLD, 1.4));
    const angle = (i / 3) * Math.PI * 2;
    bead.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    beads.add(bead);
  }

  const pip = new Mesh(new CircleGeometry(0.045, 12), new MeshBasicMaterial());
  addPart(pip, hdr(MARK_WHITE, 1.8));

  group.add(outer, spinner, beads, pip);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.25));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.25 : 1);
  }
}

// ---- event wiring ------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'parent') {
      bossId = enemyId;
      if (webbing) webbing.root.visible = true;
      cameraFeel.shake(0.55, STRANDLINE_SHAKE);
      spawnRing(worldPosition, hdr(VIOLET_HOT, 1.4), 18, 1.1);
      spawnRing(worldPosition, hdr(VIOLET, 0.9), 30, 1.6);
    } else if (kind === 'broodling') {
      spawnRing(worldPosition, hdr(VIOLET, 0.8), 1.6, 0.3);
    } else if (kind !== 'spore') {
      spawnRing(worldPosition, hdr(JADE, 0.7), 2.2, 0.34);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.3), 1.8, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(MARK_WHITE, 1.2), 0.4, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(GOLD, 1.0), 4, 8, 0.6);
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (!lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(MARK_WHITE, 1.6), 0.9, 0.16);
    }
    if (record.mesh.userData.kind === 'parent') {
      cameraFeel.shake(0.3, STRANDLINE_SHAKE);
      burstSparks(worldPosition, hdr(VIOLET_HOT, 1.2), 6, 12, 0.8);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'husk') {
      // The shell cracks off: plates burst away, the hot core bares.
      for (const shardPosition of crackHuskPlates(record.mesh)) {
        burstSparks(shardPosition, hdr(VIOLET, 1.1), 3, 9, 0.9);
      }
      spawnRing(worldPosition, hdr(VIOLET_HOT, 1.2), 4, 0.5);
      spawnGlint(worldPosition, hdr(GOLD, 1.4), 1.2, 0.3);
    } else if (record.mesh.userData.kind === 'parent') {
      // A stage tears loose: the wound rings gold.
      cameraFeel.shake(0.6, STRANDLINE_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.22);
      spawnRing(worldPosition, hdr(GOLD, 1.4), 16, 0.8);
      burstSparks(worldPosition, hdr(VIOLET_HOT, 1.2), 18, 20, 1.2);
      spawnHealBloom(worldPosition, hdr(JADE, 1.3), 2.2);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string;

    if (kind === 'parent') {
      // The tear-loose: the colony comes apart; the animal breathes clean.
      cameraFeel.shake(1.0, STRANDLINE_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.85);
      spawnRing(worldPosition, hdr(MARK_WHITE, 1.6), 60, 1.6);
      spawnRing(worldPosition, hdr(GOLD, 1.4), 42, 1.3);
      spawnRing(worldPosition, hdr(JADE, 1.2), 26, 1.0);
      burstSparks(worldPosition, hdr(VIOLET_HOT, 1.3), 40, 26, 1.6);
      spawnHealBloom(worldPosition, hdr(GOLD, 1.4), 3.4);
      if (deathHolder) {
        deathHolder.add(record.mesh);
        dyingParent = {
          mesh: record.mesh,
          since: 0,
          mode: 'kill',
          velocity: new Vector3(2.5, -5, 7),
        };
      }
      enemyRecords.delete(enemyId); // no dispose: the death holder owns it now
      bossId = -1;
      return;
    }

    // Parasite kills dissolve into a green-gold breath: the strand heals.
    burstSparks(worldPosition, hdr(VIOLET_HOT, 1.1), 8, 11, 0.9);
    spawnHealBloom(worldPosition, hdr(kind === 'broodling' ? JADE : GOLD, 1.2), kind === 'husk' ? 1.7 : 1.1);
    spawnRing(worldPosition, hdr(GOLD, 1.0), 3.8, 0.4);
    if (kind === 'spore') {
      spawnGlint(worldPosition, hdr(VIOLET_PALE, 1.4), 0.9, 0.2);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string;
    if (kind === 'parent') {
      // It burrows back into the crown; the lattice shrivels after it.
      if (webbing) for (const panel of webbing.panels) panel.dying = true;
      if (deathHolder) {
        deathHolder.add(record.mesh);
        dyingParent = {
          mesh: record.mesh,
          since: 0,
          mode: 'burrow',
          velocity: new Vector3(-1.5, 4.5, -6),
        };
      }
      enemyRecords.delete(enemyId); // no dispose yet
      bossId = -1;
      return;
    }
    const struck = record.mesh.userData.struck === true;
    if (!struck) burstSparks(worldPosition, VIOLET.clone().multiplyScalar(0.4), 3, 3, 0.6);
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('reject', () => {
    cameraFeel.shake(0.2, STRANDLINE_SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.3);
      flashUniform.value = Math.max(flashUniform.value, 0.12);
      // A full-clear release is an event: the frame surges with it.
      cameraFeel.kickFov(1.4, { decay: 3.2 });
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      cameraFeel.shake(0.7, STRANDLINE_SHAKE);
      hitEdgeUniform.value = Math.max(hitEdgeUniform.value, 0.45);
    } else if (phase === 'exposed') {
      // A web fan dies back; its brood sac deflates; gold light breaks through.
      if (webbing && websDead < webbing.panels.length) {
        webbing.panels[websDead].dying = true;
      }
      websDead += 1;
      const record = enemyRecords.get(bossId);
      if (record) {
        deflateParentSac(record.mesh, websDead - 1);
        spawnHealBloom(record.mesh.position, hdr(JADE, 1.3), 2.4);
      }
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      cameraFeel.shake(0.5, STRANDLINE_SHAKE);
    } else if (phase === 'destroyed') {
      parentDead = true;
      parentDeathTime = lastKnownRunTime;
      sereneUniform.value = Math.max(sereneUniform.value, 0.01);
      // The whole lattice dies with the colony.
      if (webbing) for (const panel of webbing.panels) panel.dying = true;
    }
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.3;
    hitEdgeUniform.value = Math.max(hitEdgeUniform.value, 1);
    cameraFeel.shake(0.55, STRANDLINE_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    if (deathHolder) {
      for (const child of [...deathHolder.children]) {
        deathHolder.remove(child);
        disposeObject3D(child);
      }
    }
    dyingParent = null;
    bossId = -1;
    websDead = 0;
    parentDead = false;
    parentDeathTime = 0;
    parentEscaped = false;
    if (webbing) {
      webbing.root.visible = false;
      for (const panel of webbing.panels) {
        panel.dying = false;
        panel.dieT = 0;
        panel.group.scale.set(1, 1, 1);
        panel.group.position.set(0, 0, 0);
        for (const material of panel.membranes) material.opacity = 0.3;
      }
    }
    flashUniform.value = 0;
    hitEdgeUniform.value = 0;
    sereneUniform.value = 0;
    lastKnownRunTime = 0;
    lastSetPieceRunTime = -1;
    cameraRoll = 0;
    cameraFovOffset = 0;
    cameraFeel.restore();
  });

  bus.on('runend', () => {
    cameraFeel.restore();
  });
}

// ---- per-frame ---------------------------------------------------------------

let lastKnownRunTime = 0;
let lastSetPieceRunTime = -1;

function updateSetPieceMoments(frame: StrandlineVisualFrame) {
  if (!frame.running) {
    lastSetPieceRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastSetPieceRunTime >= 0 && lastSetPieceRunTime < t && frame.runTime >= t;
  // Each wide swing gets a small FOV swell as the bell comes into view.
  if (crossed(STRANDLINE_SK9Q_MARKERS.reveal1) || crossed(STRANDLINE_SK9Q_MARKERS.reveal2)) {
    frame.feel.kickFov(2.5, { decay: 1.6 });
    beatEnergy = Math.max(beatEnergy, 0.8);
  }
  lastSetPieceRunTime = frame.runTime;
}

export function updateVisuals(dt: number, frame: StrandlineVisualFrame) {
  elapsedNow = frame.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);

  const runTime = frame.running ? frame.runTime : 0;
  lastKnownRunTime = frame.running ? frame.runTime : lastKnownRunTime;
  updateSetPieceMoments(frame);
  const progress = frame.running ? strandlineRunProgress(runTime) : 0;
  const speed = frame.running ? strandlineSpeedAt(runTime) : 0.6;

  // The cleanse: progress alone revives the forest a little; each dead web and
  // the parent's death flood it with light.
  const deadlinePassed = frame.running && runTime >= STRANDLINE_SK9Q_MARKERS.deadline;
  if (deadlinePassed && !parentDead) parentEscaped = true;
  const cleanse = MathUtils.clamp(
    progress * 0.4 + websDead * 0.16 + (parentDead ? 0.5 : 0),
    0,
    1,
  );
  const releaseT = parentDead
    ? MathUtils.clamp((runTime - parentDeathTime) / 4.5, 0, 1)
    : parentEscaped
      ? MathUtils.clamp((runTime - STRANDLINE_SK9Q_MARKERS.deadline) / 4.5, 0, 1) * 0.4
      : 0;

  if (environment) {
    environment.update({
      dt,
      elapsed: elapsedNow,
      progress,
      speed,
      running: frame.running,
      cleanse,
      beatPulse: beatEnergy,
      releaseT,
      cameraPosition: frame.camera.position,
    });
  }

  updateWebbing(dt, frame);
  updateEnemies(dt, frame.camera);
  updateDyingParent(dt);
  updatePostUniforms(dt, parentDead ? releaseT : 0);

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const spinner = findReticleSpinner(frame.scene);
  if (spinner) {
    const active = spinner.parent?.userData.active === true;
    spinner.rotation.z += dt * (active ? 3.0 : 0.9);
  }

  updateEffects(dt);
}

function updateWebbing(dt: number, frame: StrandlineVisualFrame) {
  if (!webbing || !webbing.root.visible) return;
  webbing.root.position.copy(parentAnchorAt(frame.running ? frame.runTime : 0));
  webbing.root.rotation.z = Math.sin(elapsedNow * 0.4) * 0.04;
  let anyAlive = false;
  for (const panel of webbing.panels) {
    if (updateWebPanel(panel, dt, elapsedNow)) anyAlive = true;
    else if (panel.dying && panel.group.parent) panel.group.removeFromParent();
  }
  // Once the parent is gone and every fan has died back, hide the lattice.
  if (bossId < 0 && !anyAlive) webbing.root.visible = false;
}

function updatePostUniforms(dt: number, releaseT: number) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.3 : 2.2));
  hitEdgeUniform.value = Math.max(0, hitEdgeUniform.value - dt * 2.0);
  const targetSerene = parentDead ? 0.2 + releaseT * 0.35 : 0;
  sereneUniform.value += (targetSerene - sereneUniform.value) * Math.min(1, dt * 0.8);
}

function updateEnemies(dt: number, camera: PerspectiveCamera) {
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const kind = record.mesh.userData.kind as string;
    const growDuration = kind === 'parent' ? 1.4 : 0.4;
    const grow = Math.min(1, age / growDuration);
    const baseScale = kind === 'parent' ? easeOutCubic(grow) : easeOutBack(grow);
    record.mesh.userData.baseScale = baseScale;
    record.mesh.scale.setScalar(baseScale);

    updateEnemyTint(record, camera);

    switch (kind) {
      case 'latcher':
        animateLatcher(record.mesh, dt, elapsedNow);
        break;
      case 'skitter':
        animateSkitter(record.mesh, dt, elapsedNow);
        break;
      case 'husk':
        animateHusk(record.mesh, dt, elapsedNow);
        break;
      case 'spitter':
        animateSpitter(record.mesh, dt, elapsedNow);
        break;
      case 'broodling':
        animateBroodling(record.mesh, dt, elapsedNow);
        break;
      case 'parent':
        animateParent(record.mesh, dt, elapsedNow);
        break;
      default:
        break;
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
      record.mesh.rotation.x += dt * 7;
      record.mesh.rotation.y += dt * 5;
    }

    if (record.mesh.userData.isLetter) {
      // Letters breathe gently; the membrane ring keeps time with the pulse.
      const parts = record.mesh.userData.letterParts as { ring: Mesh; baseRingRadius: number } | undefined;
      if (parts) {
        const target = parts.baseRingRadius * (1 + beatEnergy * 0.04);
        parts.ring.scale.setScalar(parts.ring.scale.x + (target - parts.ring.scale.x) * Math.min(1, dt * 3));
      }
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 2.1;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = kind === 'parent' ? 6.2 : 1.9;
      record.lockRing.scale.setScalar(pulse * fit);
    }
  }
}

function updateDyingParent(dt: number) {
  if (!dyingParent || !deathHolder) return;
  dyingParent.since += dt;
  const t = dyingParent.since;
  const mesh = dyingParent.mesh;
  if (dyingParent.mode === 'kill') {
    // Torn loose: tumbles away, dissolving into violet sparks and gold motes.
    mesh.position.addScaledVector(dyingParent.velocity, dt);
    dyingParent.velocity.multiplyScalar(1 - dt * 0.4);
    mesh.rotation.x += dt * 0.7;
    mesh.rotation.z += dt * 0.5;
    mesh.scale.setScalar(Math.max(0.01, 1 - t * 0.45));
    if (Math.random() < dt * 14) burstSparks(mesh.position, hdr(VIOLET_HOT, 1.1), 3, 9, 1.0);
    if (Math.random() < dt * 8) spawnHealBloom(mesh.position, hdr(GOLD, 1.1), 1.2);
    if (t > 2.6) {
      deathHolder.remove(mesh);
      disposeObject3D(mesh);
      dyingParent = null;
    }
  } else {
    // Burrowed: slides back into the crown shadow and is gone.
    mesh.position.addScaledVector(dyingParent.velocity, dt);
    mesh.scale.setScalar(Math.max(0.01, 1 - t * 0.8));
    mesh.rotation.y += dt * 1.2;
    if (t > 1.4) {
      deathHolder.remove(mesh);
      disposeObject3D(mesh);
      dyingParent = null;
    }
  }
}

function updateEnemyTint(record: EnemyRecord, camera: PerspectiveCamera) {
  const userData = record.mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smootherstep(1 - clamp01((distance - 18) / (70 - 18)));
  // Hot cores fade again at point-blank so a passing parasite never whites out.
  const nearFade = clamp01((distance - 3) / 14);
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_VIOLET);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(MARK_GOLD, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(MARK_WHITE.clone().multiplyScalar(0.3));
      else part.material.color.copy(hdr(MARK_WHITE, 2.1));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(MARK_WHITE, part.kind === 'fill' ? 0.5 : 1.8));
      continue;
    }
    let dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.4 + 0.6 * closeness : 0.5 + 0.5 * closeness;
    if (part.kind === 'core') dim *= 0.3 + 0.7 * nearFade;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

// ---- camera effects ----------------------------------------------------------

export function updateStrandlineCameraEffects(dt: number, frame: StrandlineCameraFrame) {
  if (!(frame.camera instanceof PerspectiveCamera)) return;
  const camera = frame.camera;
  const runTime = frame.running ? frame.runTime : 0;
  const speed = frame.running ? strandlineSpeedAt(runTime) : 0.6;

  // FOV breathes with swim speed and the beat, then widens as the camera
  // falls back in the coda — the pull-back should feel like opening out.
  let targetFovOffset = (speed - 0.95) * 9 + beatEnergy * 1.1;
  if (parentDead) targetFovOffset = MathUtils.lerp(targetFovOffset, 2.5, 0.7);
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 5));

  if (frame.running) {
    const u = strandlineRunProgress(frame.runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.007, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.2, 0.2);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.0);
    camera.rotateZ(cameraRoll);
    // Water bob: the whole view floats a little, always.
    camera.rotateX(Math.sin(elapsedNow * 0.5) * 0.0035);
    camera.rotateY(Math.cos(elapsedNow * 0.42) * 0.003);
  }

  frame.feel.setFovOffset(cameraFovOffset);
  frame.feel.update(dt, { shake: STRANDLINE_SHAKE });
}

// ---- helpers -----------------------------------------------------------------

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // A bubble-net closing on the target: a fine torus plus three orbit beads.
  const ring = new Mesh(
    new TorusGeometry(0.8, 0.022, 6, 40),
    createAdditiveBasicMaterial({ color: hdr(color, 1.6) }),
  );
  group.add(ring);
  for (let i = 0; i < 3; i += 1) {
    const bead = new Mesh(
      new CircleGeometry(0.06, 10),
      createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
    );
    const angle = (i / 3) * Math.PI * 2;
    bead.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    group.add(bead);
  }
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Snapshot helpers for the model-inspection tooling.
export function snapshotLatcher(): Object3D {
  return createLatcherMesh();
}
export function snapshotParent(): Object3D {
  return createParentMesh();
}
export function snapshotReticle(): Object3D {
  return createReticle();
}
