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
import { configureAdditiveMaterial, createAdditiveBasicMaterial, createAdornmentSlot, createPendingVisualRecords, disposeObject3D } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { broadsideRunProgress, createBroadsideRail, railSpeedAt } from '../rail';
import { BARS, BROADSIDE_MARKERS, bar } from '../timing';
import { createBoltMesh, createCoreMesh, createDartMesh, createGeneratorMesh, createHunterMesh, createTurretMesh, createWaspMesh, setStripped, type TintPart } from './enemies';
import {
  createEnvironmentInternal,
  disposeEnvironmentInternal,
  fireBroadside,
  fireDuels,
  updateEnvironment,
  type Environment,
} from './environment';
import { burstShards, burstSparks, createEffects, disposeEffects, dropTrail, resetEffects, spawnFlash, spawnGlint, spawnRing, updateEffects, type ShardSpec } from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { CRIMSON, CYAN, GOLD, hdr, ICE, LOCK_GRADIENT, MOLTEN, WHITE_HOT } from './palette';
import { dawnUniform, flashUniform, hurtUniform, shieldUniform } from './post-fx';

// Spine of the level's look: palette lives in palette.ts, construction in the
// leaves; this file decides what every gameplay event looks like and drives
// the environment, camera feel, and screen effects each frame.

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

const DENY_RED = hdr(CRIMSON, 1.7);
const DENY_FILL = new Color(0.32, 0.03, 0.02);
const BROADSIDE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.8,
  pitchDegrees: 0.4,
  yawDegrees: 0.32,
  rollDegrees: 0.8,
  frequency: 8,
  smoothing: 20,
};

const rail = createBroadsideRail();

let environment: Environment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let surgePulse = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let lastRunTime = -1;
let shieldState: 'up' | 'falling' | 'down' = 'up';
let shieldLevel = 1;
let shieldPulse = 0;
let shieldFellAt = -1;
let victoryAt = -1;
let hurt = 0;
let nextBroadside = 0;
let nextDuelBeat = 0;

const BROADSIDE_BEATS = [bar(BARS.flank), bar(9), bar(10), bar(11), bar(11.5)];

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => { record.lockRing = ring; },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    // Every craft owns its geometry and materials; free them with the record.
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({ createRecord: (record) => record });

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function disposeEnvironment() {
  if (environment) disposeEnvironmentInternal(environment);
  environment = null;
  disposeEffects();
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
}

// ---- factories --------------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter': return createLetterMesh(letter ?? 'L');
    case 'dart': return createDartMesh();
    case 'wasp': return createWaspMesh();
    case 'hunter': return createHunterMesh();
    case 'turret': return createTurretMesh();
    case 'bolt': return createBoltMesh();
    case 'generator': return createGeneratorMesh();
    case 'core': return createCoreMesh();
    default: return createDartMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RED, mesh.userData.kind === 'core' ? 6 : 2.6, 0.32);
}

// Player shot: a cyan dart with an ice core — our fleet's colour, never theirs.
export function createProjectileMesh() {
  const group = new Group();
  const core = new OctahedronGeometry(0.3, 0);
  core.scale(0.45, 0.45, 2.4);
  group.add(new Mesh(core, new MeshBasicMaterial({ color: hdr(ICE, 2.6) })));
  const shell = new OctahedronGeometry(0.5, 0);
  shell.scale(0.55, 0.55, 2.0);
  group.add(new Mesh(shell, createAdditiveBasicMaterial({ color: hdr(CYAN, 1.1), opacity: 0.55 })));
  projectileRecords.enqueue({ mesh: group, trailColor: CYAN.clone().multiplyScalar(0.9) });
  return group;
}

// Reticle: a naval gunsight. Outer ring, four range brackets that close in as
// locks stack, a spinning inner crosshair, and a hot centre dot.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };
  const outer = new Mesh(new RingGeometry(0.66, 0.7, 48), new MeshBasicMaterial());
  addPart(outer, hdr(CYAN, 1.2));
  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = new Group();
    const a = new Mesh(new PlaneGeometry(0.26, 0.045), new MeshBasicMaterial());
    const b = new Mesh(new PlaneGeometry(0.045, 0.26), new MeshBasicMaterial());
    a.position.set(-0.11, 0.11, 0);
    b.position.set(-0.11, 0.11, 0);
    a.position.set(0, 0.13, 0);
    b.position.set(-0.13, 0, 0);
    addPart(a, hdr(ICE, 1.3));
    addPart(b, hdr(ICE, 1.3));
    arm.add(a, b);
    arm.rotation.z = angle - Math.PI / 4;
    arm.position.set(Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, 0);
    brackets.add(arm);
  }
  const spinner = new Group();
  for (const rotation of [0, Math.PI / 2]) {
    const tick = new Mesh(new PlaneGeometry(0.42, 0.035), new MeshBasicMaterial());
    tick.rotation.z = rotation;
    addPart(tick, hdr(CYAN, 1.0));
    spinner.add(tick);
  }
  const dot = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial());
  addPart(dot, hdr(ICE, 2.2));
  group.add(outer, brackets, spinner, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  group.userData.isBroadsideReticle = true;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
  const brackets = reticle.userData.brackets as Group | undefined;
  if (brackets) {
    // Brackets close in as the volley fills: six locks is a tight box.
    const reach = MathUtils.lerp(0.9, 0.5, lockCount / 6);
    brackets.children.forEach((arm, i) => {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      arm.position.set(Math.cos(angle) * reach, Math.sin(angle) * reach, 0);
    });
  }
}

// ---- event choreography ------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'generator') {
      spawnRing(worldPosition, hdr(CRIMSON, 1.3), 12, 0.7);
      spawnFlash(worldPosition, hdr(MOLTEN, 0.9), 5, 0.4);
    } else if (kind === 'core') {
      spawnRing(worldPosition, hdr(MOLTEN, 1.2), 9, 0.6);
    } else if (kind === 'bolt') {
      spawnFlash(worldPosition, hdr(CRIMSON, 1.6), 1.6, 0.16);
    } else if (kind !== 'letter') {
      spawnRing(worldPosition, hdr(MOLTEN, 0.7), 2.2, 0.3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.4, 0.26);
    if (lockCount === 6) {
      spawnGlint(worldPosition, hdr(GOLD, 1.6), 1.6, 0.22);
      surgePulse = Math.max(surgePulse, 0.25);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize, indexInVolley }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(CYAN, 1.3), 0.5, 0.12);
    if (volleySize === 6 && (indexInVolley ?? 0) === 0) {
      // A full broadside: the frame flashes cold and the camera kicks.
      flashUniform.value = Math.max(flashUniform.value, 0.22);
      cameraFeel.kickFov(2.6, { decay: 5 });
      cameraFeel.shake(0.35, BROADSIDE_SHAKE);
    }
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(ICE, 1.0), 6, 9, 0.4);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.35;
      spawnGlint(worldPosition, hdr(ICE, 1.9), 1.2, 0.16);
      if (record.mesh.userData.stripParts && record.mesh.userData.strippedShown !== true) {
        record.mesh.userData.strippedShown = true;
        setStripped(record.mesh, true);
        const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
        if (specs) burstShards(worldPosition, specs.slice(0, 4), 7);
        burstSparks(worldPosition, hdr(MOLTEN, 1.2), 10, 11, 0.5);
        if (record.mesh.userData.kind === 'generator') {
          spawnRing(worldPosition, hdr(MOLTEN, 1.3), 6, 0.45);
          cameraFeel.shake(0.3, BROADSIDE_SHAKE);
        }
      }
      if (record.mesh.userData.kind === 'core') {
        spawnRing(worldPosition, hdr(MOLTEN, 1.4), 7, 0.45);
        burstSparks(worldPosition, hdr(MOLTEN, 1.4), 16, 14, 0.6);
        cameraFeel.shake(0.4, BROADSIDE_SHAKE);
      }
    }
  });

  bus.on('stage', ({ worldPosition }) => {
    spawnRing(worldPosition, hdr(GOLD, 1.3), 6, 0.5);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? MOLTEN;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (kind === 'letter') {
      if (specs) burstShards(worldPosition, specs, 6);
      spawnRing(worldPosition, hdr(CYAN, 1.2), 3.5, 0.4);
      spawnGlint(worldPosition, hdr(ICE, 1.8), 1.4, 0.2);
    } else if (kind === 'generator') {
      cameraFeel.shake(0.8, BROADSIDE_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      if (specs) burstShards(worldPosition, specs, 11);
      burstSparks(worldPosition, hdr(WHITE_HOT, 1.3), 40, 22, 0.8);
      spawnFlash(worldPosition, hdr(WHITE_HOT, 1.6), 9, 0.5);
      spawnFlash(worldPosition, hdr(MOLTEN, 1.3), 16, 0.8);
      spawnRing(worldPosition, hdr(CRIMSON, 1.5), 22, 0.8);
      shieldPulse = 1.2;
    } else if (kind === 'core') {
      cameraFeel.shake(1.0, BROADSIDE_SHAKE);
      surgePulse = Math.max(surgePulse, 0.7);
      flashUniform.value = Math.max(flashUniform.value, 0.45);
      if (specs) burstShards(worldPosition, specs, 12);
      burstSparks(worldPosition, hdr(WHITE_HOT, 1.4), 50, 26, 0.9);
      spawnFlash(worldPosition, hdr(WHITE_HOT, 1.8), 12, 0.55);
      spawnFlash(worldPosition, hdr(MOLTEN, 1.4), 24, 1.0);
      spawnRing(worldPosition, hdr(GOLD, 1.5), 30, 0.9);
    } else if (kind === 'bolt') {
      burstSparks(worldPosition, hdr(CRIMSON, 1.2), 8, 12, 0.4);
      spawnFlash(worldPosition, hdr(CRIMSON, 1.2), 2.4, 0.25);
    } else {
      if (specs) burstShards(worldPosition, specs, 8);
      burstSparks(worldPosition, hdr(accent, 1.1), 10, 13, 0.5);
      spawnFlash(worldPosition, hdr(MOLTEN, 1.3), kind === 'hunter' || kind === 'turret' ? 5 : 3.2, 0.36);
      spawnRing(worldPosition, hdr(accent, 0.9), kind === 'hunter' || kind === 'turret' ? 6 : 4, 0.4);
      spawnGlint(worldPosition, hdr(ICE, 1.5), 1.1, 0.16);
      if (kind === 'turret') cameraFeel.shake(0.2, BROADSIDE_SHAKE);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, MOLTEN.clone().multiplyScalar(0.4), 3, 3, 0.3);
  });

  bus.on('reject', ({ enemyIds, missingEnemyIds, reason }) => {
    for (const id of [...enemyIds, ...(missingEnemyIds ?? [])]) {
      const record = enemyRecords.get(id);
      if (record) spawnRing(record.mesh.position, DENY_RED, 2.8, 0.34);
    }
    if (reason === 'level-rule') {
      shieldUniform.value = Math.max(shieldUniform.value, 0.55);
      shieldPulse = 1.4;
    } else {
      hurt = Math.max(hurt, 0.25);
    }
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      spawnRing(shield.worldPosition, hdr(CRIMSON, 1.6), 7, 0.4);
      burstSparks(shield.worldPosition, hdr(CRIMSON, 1.1), 14, 10, 0.4);
    }
    shieldPulse = 1.6;
    shieldUniform.value = Math.max(shieldUniform.value, 0.6);
    cameraFeel.shake(0.35, BROADSIDE_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      surgePulse = Math.max(surgePulse, 0.4);
      cameraFeel.shake(0.4, BROADSIDE_SHAKE);
      shieldPulse = 0.9;
    } else if (phase === 'exposed') {
      shieldState = 'falling';
      shieldFellAt = elapsedNow;
      flashUniform.value = Math.max(flashUniform.value, 0.5);
      cameraFeel.shake(1.0, BROADSIDE_SHAKE);
      surgePulse = Math.max(surgePulse, 0.8);
      if (environment) {
        spawnRing(environment.flagship.group.position, hdr(CRIMSON, 1.5), 140, 1.6);
        spawnRing(environment.flagship.group.position, hdr(MOLTEN, 1.1), 90, 1.2);
      }
    } else if (phase === 'destroyed') {
      victoryAt = elapsedNow;
      flashUniform.value = Math.max(flashUniform.value, 1.05);
      cameraFeel.shake(1.8, BROADSIDE_SHAKE);
      surgePulse = 1.2;
      if (environment) {
        const center = environment.flagship.group.position;
        spawnRing(center, hdr(WHITE_HOT, 1.6), 220, 2.2);
        spawnRing(center, hdr(GOLD, 1.3), 150, 1.7);
        spawnRing(center, hdr(MOLTEN, 1.1), 90, 1.2);
        spawnFlash(center, hdr(WHITE_HOT, 2.0), 60, 1.2);
      }
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === 6) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      surgePulse = Math.max(surgePulse, 0.45);
    } else if (size >= 4 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
    nextDuelBeat += 1;
    if (environment) {
      // The battle keeps time: a few duels exchange fire on every beat, more on downbeats.
      const quiet = lastRunTime >= bar(BARS.eye) && lastRunTime < bar(BARS.belly);
      fireDuels(environment, quiet ? 1 : isDownbeat ? 5 : 2, quiet ? 0.5 : 1);
    }
  });

  bus.on('playerhit', () => {
    hurt = 1;
    beatEnergy = 1.4;
    cameraFeel.shake(1.3, BROADSIDE_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    shieldState = 'up';
    shieldLevel = 1;
    shieldPulse = 0;
    shieldFellAt = -1;
    victoryAt = -1;
    hurt = 0;
    nextBroadside = 0;
    flashUniform.value = 0.7; // catapult flash
    hurtUniform.value = 0;
    shieldUniform.value = 0;
    dawnUniform.value = 0;
    surgePulse = 0.9;
    cameraFeel.kickFov(-6, { decay: 1.6 });
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame update ---------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.9);
  shieldPulse = Math.max(0, shieldPulse - dt * 3.2);
  hurt = Math.max(0, hurt - dt * 1.6);
  const runTime = ctx.running ? ctx.runTime : 0;

  updateSetPieceMoments(ctx);
  updateShieldState();

  if (environment) {
    updateEnvironment(environment, {
      camera: ctx.camera as PerspectiveCamera,
      dt,
      railU: ctx.running ? broadsideRunProgress(runTime) : 0,
      running: ctx.running,
      beat: beatEnergy,
      shield: shieldLevel,
      shieldPulse,
      victory: victoryAt >= 0 ? elapsedNow - victoryAt : -1,
    });
  }
  updatePostUniforms(dt, ctx);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const kind = record.mesh.userData.kind as string;
    const intro = kind === 'generator' || kind === 'core' ? 0.7 : 0.35;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / intro)));
    updateEnemyTint(record, ctx);
    if (record.mesh.userData.stripped === true && record.mesh.userData.strippedShown !== true) {
      record.mesh.userData.strippedShown = true;
      setStripped(record.mesh, true);
    }
    if (record.mesh.userData.isHostileShot) dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color, 0.4);
    if (kind === 'core') {
      const bubble = record.mesh.userData.shieldBubble as Mesh | undefined;
      if (bubble) {
        const shielded = record.mesh.userData.shielded === true;
        bubble.visible = shielded;
        (bubble.material as MeshBasicMaterial).color.copy(CRIMSON).multiplyScalar(0.45 + shieldPulse * 0.9 + Math.sin(elapsedNow * 7) * 0.1);
        bubble.rotation.y += dt * 0.6;
      }
    }
    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.2;
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
    dropTrail(record.mesh.position, record.trailColor, 0.45);
  }

  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const active = reticle.userData.active === true;
    const spinner = reticle.userData.spinner as Group;
    spinner.rotation.z += dt * (active ? 3.4 : 0.8);
  }

  updateEffects(dt, ctx.camera);
}

function updateShieldState() {
  if (shieldState === 'up') shieldLevel = 1;
  else if (shieldState === 'falling') {
    const since = elapsedNow - shieldFellAt;
    // Flicker, then collapse.
    shieldLevel = since < 0.9 ? (Math.sin(since * 50) > 0 ? 1.6 : 0.3) : Math.max(0, 1 - (since - 0.9) / 0.6);
    if (since > 1.6) { shieldState = 'down'; shieldLevel = 0; }
  } else shieldLevel = 0;
}

// Launch flash, the flank cruiser's broadsides on the downbeats, the dawn of the pull-out.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (environment) {
    while (nextBroadside < BROADSIDE_BEATS.length && ctx.runTime >= BROADSIDE_BEATS[nextBroadside]) {
      fireBroadside(environment, environment.flank, environment.broadsideTarget, nextBroadside === 0 ? 14 : 9, 0.045);
      ctx.feel.shake(nextBroadside === 0 ? 0.6 : 0.3, BROADSIDE_SHAKE);
      surgePulse = Math.max(surgePulse, nextBroadside === 0 ? 0.6 : 0.3);
      flashUniform.value = Math.max(flashUniform.value, nextBroadside === 0 ? 0.3 : 0.12);
      nextBroadside += 1;
    }
    // The enemy answers: the belly warship and flagship fire on their own downbeats.
    if (crossed(bar(BARS.belly)) || crossed(bar(16))) fireBroadside(environment, environment.belly, environment.friendShips[4], 8, 0.06);
    if (crossed(bar(BARS.flagship)) || crossed(bar(20))) fireBroadside(environment, environment.flagship, environment.friendShips[5], 10, 0.05);
    if (crossed(bar(BARS.pullout) + 0.2) && victoryAt < 0) fireBroadside(environment, environment.flagship, environment.friendShips[6], 10, 0.05);
  }
  if (crossed(bar(1.5))) {
    // Off the bow lip: a hard surge and a kick.
    surgePulse = Math.max(surgePulse, 0.7);
    ctx.feel.shake(0.5, BROADSIDE_SHAKE);
  }
  if (crossed(BROADSIDE_MARKERS.roll)) ctx.feel.shake(0.3, BROADSIDE_SHAKE);
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? railSpeedAt(runTime) : 20;
  const pullout = ctx.running ? MathUtils.clamp((runTime - bar(BARS.pullout)) / 2.4, 0, 1) : 0;
  const eye = ctx.running ? MathUtils.clamp(1 - Math.abs(runTime - bar(13)) / 2.2, 0, 1) : 0;
  // FOV breathes with airspeed, pumps with the beat, tightens in the eye, and opens wide for the pull-out.
  const targetFov = (speed / 40 - 1) * 7 + beatEnergy * 1.0 + surgePulse * 6 - eye * 5 + pullout * 16;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFov, Math.min(1, dt * 5));

  if (ctx.running) {
    // Bank into the turns, and one full barrel roll through the crossfire on bars 6–7.
    const u = broadsideRunProgress(runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.004, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 60, -0.42, 0.42) * (1 - pullout * 0.7);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.4);
    const rollT = MathUtils.clamp((runTime - BROADSIDE_MARKERS.roll) / (bar(7) - BROADSIDE_MARKERS.roll), 0, 1);
    const barrel = rollT * rollT * (3 - 2 * rollT) * Math.PI * 2;
    camera.rotateZ(cameraRoll + barrel);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: BROADSIDE_SHAKE });
}

function updatePostUniforms(dt: number, ctx: VisualContext) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.3 : 2.2));
  hurtUniform.value = hurt * hurt;
  shieldUniform.value = Math.max(0, shieldUniform.value - dt * 2.4);
  const victory = victoryAt >= 0 ? elapsedNow - victoryAt : -1;
  const dawnTarget = victory >= 0 ? MathUtils.clamp((victory - 0.5) / 3, 0, 1) * 0.8 : 0;
  dawnUniform.value += (dawnTarget - dawnUniform.value) * Math.min(1, dt * 1.5);
  if (victory >= 0 && victory < 2.2) flashUniform.value = Math.max(flashUniform.value, 0.45 * (1 - victory / 2.2));
  void ctx;
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
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 18) / (70 - 18)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const pulse = userData.pulse === true ? 0.8 + Math.sin(elapsedNow * (userData.kind === 'core' ? 5 + (userData.damage as number ?? 0) * 9 : 3.5)) * 0.25 : 1;
  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'hull' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(ICE, 1.7));
      else if (part.kind === 'hull') part.material.color.copy(CYAN.clone().multiplyScalar(0.3));
      else part.material.color.copy(hdr(ICE, 2.2));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(WHITE_HOT, part.kind === 'hull' ? 0.55 : 1.9));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.5 + 0.5 * closeness : part.kind === 'hull' ? 0.45 + 0.55 * closeness : (0.4 + 0.6 * closeness) * pulse;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) if (child.userData.isBroadsideReticle) return child;
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  const diamond = new Mesh(new RingGeometry(0.84, 0.9, 4), createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }));
  const inner = new Mesh(new RingGeometry(0.64, 0.67, 32), createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ICE, 0.5), 1.4), side: DoubleSide }));
  group.add(diamond, inner);
  group.userData.raildIgnoreOcclusion = true;
  return group;
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

export { Vector3 };
