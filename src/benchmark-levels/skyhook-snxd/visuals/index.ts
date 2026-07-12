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
  createSkyhookRail,
  SKYHOOK_DURATION,
  SKYHOOK_PLAYER_HEALTH,
  skyhookRunProgress,
  speedFactorAt,
} from '../gameplay';
import {
  breakBreakerArmor,
  createBoltMesh,
  createBreakerMesh,
  createClawMesh,
  createGliderMesh,
  createMawMesh,
  createSapperMesh,
  createSpikerMesh,
  createSpriteMesh,
  updateMawMesh,
  type TintPart,
} from './enemies';
import {
  beatUniform,
  createEnvironmentInternal,
  type Environment,
} from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnFallingHulk,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { AMBER, COLD_WHITE, GUNMETAL, HAZARD_ORANGE, LOCK_GRADIENT, PANEL_WHITE, SIGNAL_RED, hdr } from './palette';
import { altitudeUniform, damageUniform, flashUniform } from './post-fx';

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
  lastDrillSparkAt: number;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

const DENY_RED = new Color(1.5, 0.1, 0.05);
const DENY_FILL = new Color(0.28, 0.02, 0.01);

let environment: Environment | null = null;
let beatEnergy = 0;
let surgePulse = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let elapsedNow = 0;
let lastCameraY = -Infinity;
let hitsTaken = 0;
let damagePulse = 0;

const SKYHOOK_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.7,
  pitchDegrees: 0.34,
  yawDegrees: 0.3,
  rollDegrees: 0.7,
  frequency: 8,
  smoothing: 20,
};

const rail = createSkyhookRail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, lastDrillSparkAt: 0 }),
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
  glider: 1.35,
  sprite: 1.3,
  spiker: 1.4,
  sapper: 1.15,
  bolt: 1.25,
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
    case 'glider':
      return createGliderMesh();
    case 'sprite':
      return createSpriteMesh();
    case 'sapper':
      return createSapperMesh();
    case 'spiker':
      return createSpikerMesh();
    case 'breaker':
      return createBreakerMesh();
    case 'bolt':
      return createBoltMesh();
    case 'claw':
      return createClawMesh();
    case 'maw':
      return createMawMesh();
    default:
      return createGliderMesh();
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
  spawnRing(mesh.position, DENY_RED.clone(), 2.4, 0.3);
}

// Player shot: a hot tracer round — white core, hazard-amber shell. The car's
// own point-defence livery, unmistakable against sky or void.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.3);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(COLD_WHITE, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.48, 0);
  shellGeometry.scale(0.55, 0.55, 2.0);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(AMBER, 1.0), opacity: 0.55 })));
  projectileRecords.enqueue({ mesh: group, trailColor: AMBER.clone().multiplyScalar(0.8) });
  return group;
}

// ---- reticle -------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  // A point-defence gunsight: thin outer ring, four cardinal ticks, and an
  // inner square that spins up when tracking.
  const outer = new Mesh(new RingGeometry(0.62, 0.652, 48), new MeshBasicMaterial());
  addPart(outer, hdr(COLD_WHITE, 1.05));

  const square = new Group();
  const inner = new Mesh(new RingGeometry(0.34, 0.372, 4), new MeshBasicMaterial());
  inner.rotation.z = Math.PI / 4;
  addPart(inner, hdr(PANEL_WHITE, 0.95));
  square.add(inner);

  const ticks = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.2, 0.045), new MeshBasicMaterial());
    addPart(tick, hdr(HAZARD_ORANGE, 1.1));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(COLD_WHITE, 1.9));

  group.add(outer, square, ticks, dot);
  group.userData.parts = parts;
  group.userData.spinner = square;
  group.userData.ticks = ticks;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  // Charging walks the sight white → amber → hazard orange: lock six reads as
  // the car's warning livery going to full alert.
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.25));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
}

// ---- event wiring ----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'maw') {
      // The slam heard up the tether: the whole frame flinches.
      cameraFeel.shake(1.2, SKYHOOK_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.42);
      spawnRing(worldPosition, hdr(SIGNAL_RED, 1.2), 22, 0.8);
      spawnRing(worldPosition, hdr(COLD_WHITE, 0.9), 12, 0.6);
    } else if (kind === 'sapper') {
      // Sapper inbound: a hazard ping at its entry point.
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.2), 3.2, 0.45);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(COLD_WHITE, 0.55), 2.2, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockBracket(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.0, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(COLD_WHITE, 1.1), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(COLD_WHITE, 0.85), 5, 9);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(COLD_WHITE, 1.7), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'breaker') {
      breakBreakerArmor(record.mesh);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 5));
      burstSparks(worldPosition, hdr(HAZARD_ORANGE, 1.0), 12, 13);
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.3), 5.5, 0.45);
    } else if (record.mesh.userData.isMaw) {
      // The maw survives a stage: it loses grip and swings wide.
      cameraFeel.shake(1.0, SKYHOOK_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.45);
      flashUniform.value = Math.max(flashUniform.value, 0.32);
      spawnRing(worldPosition, hdr(SIGNAL_RED, 1.4), 24, 0.9);
      burstSparks(worldPosition, hdr(COLD_WHITE, 1.1), 26, 22);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? SIGNAL_RED;
      burstSparks(worldPosition, hdr(accent, 0.95), 8, 12);
      spawnRing(worldPosition, hdr(accent, 0.85), 4.2, 0.4);
      spawnGlint(worldPosition, hdr(COLD_WHITE, 1.5), 1.1, 0.16);

      if (record.mesh.userData.isMaw) {
        // Severance: the kill the whole climb is built around. It lets go and
        // falls the whole height of the sky.
        cameraFeel.shake(1.7, SKYHOOK_CAMERA_SHAKE);
        surgePulse = 1.0;
        flashUniform.value = Math.max(flashUniform.value, 1.0);
        spawnRing(worldPosition, hdr(COLD_WHITE, 1.5), 60, 1.4);
        spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.2), 36, 1.0);
        spawnRing(worldPosition, hdr(SIGNAL_RED, 1.0), 20, 0.8);
        spawnGlint(worldPosition, hdr(COLD_WHITE, 2.2), 6, 0.5);
        burstSparks(worldPosition, hdr(HAZARD_ORANGE, 1.2), 50, 30, 12);
        spawnFallingHulk(worldPosition, 5.5, 6);
      } else if (record.mesh.userData.kind === 'claw') {
        cameraFeel.shake(0.55, SKYHOOK_CAMERA_SHAKE);
        spawnRing(worldPosition, hdr(SIGNAL_RED, 1.2), 8, 0.5);
        spawnFallingHulk(worldPosition, 1.6, 3);
      } else if (record.mesh.userData.kind === 'breaker') {
        spawnFallingHulk(worldPosition, 2.0, -4);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstSparks(worldPosition, GUNMETAL.clone().multiplyScalar(0.5), 3, 3, 4);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.16);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    beatEnergy = 1.4;
    cameraFeel.shake(1.3, SKYHOOK_CAMERA_SHAKE);
    if (environment) {
      burstSparks(environment.car.group.position, hdr(HAZARD_ORANGE, 1.1), 16, 14);
      spawnRing(environment.car.group.position, hdr(SIGNAL_RED, 1.1), 5, 0.5);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    damageUniform.value = 0;
    altitudeUniform.value = 0;
    surgePulse = 0;
    hitsTaken = 0;
    damagePulse = 0;
    lastCameraY = -Infinity;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
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
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);
  damagePulse = Math.max(0, damagePulse - dt * 1.5);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? skyhookRunProgress(runTime) : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.45;

  // Cloud punch: crossing the deck slams the senses once per run.
  if (environment && ctx.running) {
    const cameraY = (ctx.camera as PerspectiveCamera).position.y;
    if (lastCameraY > -Infinity && lastCameraY < environment.deckY && cameraY >= environment.deckY) {
      flashUniform.value = Math.max(flashUniform.value, 0.85);
      surgePulse = Math.max(surgePulse, 0.9);
      ctx.feel.shake(0.7, SKYHOOK_CAMERA_SHAKE);
      spawnRing(environment.deckCenter, hdr(COLD_WHITE, 1.1), 60, 1.1);
    }
    lastCameraY = cameraY;
  }

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    speed,
    beatEnergy,
    hullDamage: Math.min(1, hitsTaken / SKYHOOK_PLAYER_HEALTH),
  });

  // Post grade: altitude cools the frame; damage pushes red in from the edges.
  altitudeUniform.value = MathUtils.clamp((progress - 0.35) / 0.55, 0, 1);
  damageUniform.value = Math.min(1, damagePulse * 0.6 + Math.min(1, hitsTaken / SKYHOOK_PLAYER_HEALTH) * 0.06);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.5 : 2.4));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);

    // Sapper drill: the lamp strobes faster as the drill bites, and the
    // contact point sheds sparks down the car's flank.
    if (record.mesh.userData.kind === 'sapper') {
      const lamp = record.mesh.userData.drillLamp as MeshBasicMaterial | undefined;
      const drilling = record.mesh.userData.drilling === true;
      const drillProgress = (record.mesh.userData.drillProgress as number | undefined) ?? 0;
      if (lamp && record.mesh.userData.locked !== true) {
        const rate = drilling ? 6 + drillProgress * 18 : 2.5;
        const pulse = 0.7 + Math.max(0, Math.sin(elapsedNow * rate)) * (drilling ? 1.6 : 0.5);
        lamp.color.copy(hdr(SIGNAL_RED, pulse));
      }
      if (drilling && elapsedNow - record.lastDrillSparkAt > 0.14) {
        record.lastDrillSparkAt = elapsedNow;
        burstSparks(record.mesh.position, hdr(HAZARD_ORANGE, 0.9), 2, 6);
      }
    }

    // Spiker wind-up: the muzzle lamp climbs to white-hot before each bolt.
    if (record.mesh.userData.kind === 'spiker') {
      const lamp = record.mesh.userData.chargeLamp as MeshBasicMaterial | undefined;
      const charge = (record.mesh.userData.charge as number | undefined) ?? 0;
      if (lamp && record.mesh.userData.locked !== true) {
        lamp.color.copy(SIGNAL_RED.clone().lerp(COLD_WHITE, charge * 0.7)).multiplyScalar(0.7 + charge * 2.2);
      }
    }

    if (record.mesh.userData.isMaw) {
      updateMawMesh(record.mesh, elapsedNow);
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 1.8;
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
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.2 : 0.9);
    const ticks = reticleSpinner.parent?.userData.ticks as Group | undefined;
    if (ticks) ticks.rotation.z -= dt * (active ? 2.4 : 0.5);
  }

  updateEffects(dt, ctx.camera);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.45;
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with climb rate, kicks with the beat and the set pieces; the
  // dock deceleration visibly narrows the world back down.
  const targetFovOffset = (speed - 0.9) * 7.5 + beatEnergy * 1.0 + surgePulse * 6.5;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank with the tether sway in the weather; the air stills near the top.
    const u = skyhookRunProgress(ctx.runTime, SKYHOOK_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.14, 0.14);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: SKYHOOK_CAMERA_SHAKE });
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
  const closeness = smootherstep(1 - clamp01((distance - 16) / (58 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(AMBER, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(HAZARD_ORANGE.clone().multiplyScalar(0.28));
      else part.material.color.copy(hdr(COLD_WHITE, 1.9));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(COLD_WHITE, part.kind === 'fill' ? 0.5 : 1.8));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.4 + 0.6 * closeness : 0.4 + 0.6 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockBracket(color: Color): Group {
  const group = new Group();
  // A square service bracket: the car's targeting system clamping on.
  const square = new Mesh(
    new RingGeometry(0.84, 0.9, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  square.rotation.z = Math.PI / 4;
  const innerRing = new Mesh(
    new RingGeometry(0.64, 0.67, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(COLD_WHITE, 0.5), 1.3), side: DoubleSide }),
  );
  group.add(square, innerRing);
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
