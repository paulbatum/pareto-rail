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
import {
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { BROADSIDE_PLAYER_HEALTH, broadsideRunProgress, rollRadiansAt, speedFactorAt } from '../gameplay';
import {
  createBoltMesh,
  createCoreMesh,
  createGeneratorMesh,
  createLanceMesh,
  createLockBracket,
  createPicketMesh,
  createTracerMesh,
  createTurretMesh,
  createWaspMesh,
  disposeLockBracket,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnFlare,
  spawnGlint,
  spawnHulk,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  COLD_WHITE,
  CRIMSON,
  CYAN,
  EMBER,
  ICE_WHITE,
  LOCK_GRADIENT,
  MOLTEN,
  OBSIDIAN_EDGE,
  hdr,
} from './palette';
import { damageUniform, flashUniform, heatUniform, shieldBlockUniform } from './post-fx';

// The visual spine: what each gameplay event looks like and how the frame
// behaves. Construction lives in the leaves (enemies, capitals, environment,
// effects, letters); every colour, timing and magnitude decision is here.

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
  lastVentAt: number;
};

type ProjectileRecord = { mesh: Object3D; trailColor: Color };

const DENY_RED = new Color(1.7, 0.1, 0.12);
const DENY_FILL = new Color(0.3, 0.02, 0.02);
const SHIELD_VIOLET = new Color(0.72, 0.18, 1.0);

const BROADSIDE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.5,
  maxTrauma: 1.8,
  pitchDegrees: 0.36,
  yawDegrees: 0.32,
  rollDegrees: 0.9,
  frequency: 9,
  smoothing: 21,
};

let environment: Environment | null = null;
let beatEnergy = 0;
let surge = 0;
let fovOffset = 0;
let elapsedNow = 0;
let runTimeNow = 0;
let runningNow = false;
let hitsTaken = 0;
let damagePulse = 0;
let shieldSlap = 0;

const lockBrackets = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, bracket) => {
    record.lockRing = bracket;
  },
  disposeAdornment: disposeLockBracket,
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, lastVentAt: 0 }),
  disposeRecord: (record) => {
    lockBrackets.detach(record);
    // Enemy hulls are assembled per spawn, so their merged geometry and tinted
    // materials die with them. The runner has already removed the mesh from the
    // scene by the time a kill or miss reaches us.
    disposeObject3D(record.mesh);
  },
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
  lance: 1.15,
  wasp: 1.2,
  bolt: 1.3,
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
    case 'lance':
      return createLanceMesh();
    case 'wasp':
      return createWaspMesh();
    case 'picket':
      return createPicketMesh();
    case 'turret':
      return createTurretMesh();
    case 'bolt':
      return createBoltMesh();
    case 'generator':
      return createGeneratorMesh();
    case 'core':
      return createCoreMesh();
    default:
      return createLanceMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RED.clone(), 3.0, 0.3);
}

export function createProjectileMesh() {
  const group = createTracerMesh();
  projectileRecords.enqueue({ mesh: group, trailColor: CYAN.clone().multiplyScalar(0.85) });
  return group;
}

// ---- reticle -------------------------------------------------------------------

/**
 * A gunnery director sight: a ranging ring, cardinal ticks, and six loading
 * pips around the rim. One pip lights per lock, so a full charge reads as
 * "battery loaded" before you release.
 */
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.66, 0.69, 56), new MeshBasicMaterial());
  addPart(outer, hdr(COLD_WHITE, 1.0));

  const inner = new Mesh(new RingGeometry(0.28, 0.305, 40), new MeshBasicMaterial());
  addPart(inner, hdr(CYAN, 1.1));

  const cross = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.035), new MeshBasicMaterial());
    addPart(tick, hdr(ICE_WHITE, 1.0));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.46, Math.sin(angle) * 0.46, 0);
    tick.rotation.z = angle;
    cross.add(tick);
  }

  const pips: MeshBasicMaterial[] = [];
  const pipRing = new Group();
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const pip = new Mesh(new PlaneGeometry(0.12, 0.075), new MeshBasicMaterial());
    const material = configureAdditiveMaterial(pip.material as MeshBasicMaterial, { color: hdr(COLD_WHITE, 0.16), side: DoubleSide });
    pip.position.set(Math.cos(angle) * 0.83, Math.sin(angle) * 0.83, 0);
    pip.rotation.z = angle;
    pipRing.add(pip);
    pips.push(material);
  }

  const dot = new Mesh(new CircleGeometry(0.038, 14), new MeshBasicMaterial());
  addPart(dot, hdr(COLD_WHITE, 2.0));

  group.add(outer, inner, cross, pipRing, dot);
  group.userData.parts = parts;
  group.userData.pips = pips;
  group.userData.spinner = cross;
  group.userData.pipRing = pipRing;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
  const pips = reticle.userData.pips as MeshBasicMaterial[];
  for (let i = 0; i < pips.length; i += 1) {
    const loaded = i < lockCount;
    const color = loaded ? colorForLockCount(i + 1, LOCK_GRADIENT) : COLD_WHITE;
    pips[i].color.copy(hdr(color, loaded ? 2.2 : 0.16));
  }
}

// ---- event wiring ----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'generator') {
      spawnRing(worldPosition, hdr(CRIMSON, 1.2), 9, 0.55);
      spawnFlare(worldPosition, hdr(MOLTEN, 0.8), 8, 0.4);
    } else if (kind === 'core') {
      spawnRing(worldPosition, SHIELD_VIOLET.clone().multiplyScalar(1.4), 12, 0.7);
    } else if (kind === 'turret' || kind === 'picket') {
      spawnRing(worldPosition, hdr(EMBER, 0.9), 4.0, 0.4);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(OBSIDIAN_EDGE, 2.2), 2.6, 0.3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockBrackets.attach(record, createLockBracket(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.4, 0.24);
    if (lockCount >= 6) spawnGlint(worldPosition, hdr(lockColor, 1.6), 2.2, 0.2);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockBrackets.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(COLD_WHITE, 1.2), 0.6, 0.11);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(COLD_WHITE, 0.9), 6, 11, 0.4);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.28;
      spawnGlint(worldPosition, hdr(COLD_WHITE, 1.8), 1.1, 0.14);
      spawnRing(worldPosition, hdr(MOLTEN, 1.0), 3.4, 0.26);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    // Armor comes off: petals blow outward, plate sheds, the core is bare.
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs.slice(0, 8));
    burstSparks(worldPosition, hdr(MOLTEN, 1.1), 18, 17, 0.7);
    spawnRing(worldPosition, hdr(MOLTEN, 1.4), 8, 0.5);
    if (record.mesh.userData.isCore) {
      cameraFeel.shake(0.8, BROADSIDE_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
      spawnFlare(worldPosition, hdr(COLD_WHITE, 1.3), 16, 0.42);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs);
    const accent = (record.mesh.userData.accent as Color | undefined) ?? MOLTEN;
    burstSparks(worldPosition, hdr(accent, 1.0), 10, 15, 0.55);
    spawnRing(worldPosition, hdr(accent, 0.95), 5.0, 0.4);
    spawnGlint(worldPosition, hdr(COLD_WHITE, 1.6), 1.2, 0.15);

    if (record.mesh.userData.isGenerator) {
      // A generator going up is a real explosion: it was holding a shield.
      cameraFeel.shake(1.0, BROADSIDE_SHAKE);
      surge = Math.max(surge, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.34);
      spawnFlare(worldPosition, hdr(COLD_WHITE, 1.6), 34, 0.6);
      spawnRing(worldPosition, hdr(MOLTEN, 1.4), 30, 0.85);
      spawnRing(worldPosition, hdr(CRIMSON, 1.0), 18, 0.6);
      burstSparks(worldPosition, hdr(MOLTEN, 1.3), 44, 26, 1.1);
      spawnHulk(worldPosition, 2.6, new Vector3(0, -7, 3));
    } else if (record.mesh.userData.isCore) {
      cameraFeel.shake(1.5, BROADSIDE_SHAKE);
      surge = Math.max(surge, 0.85);
      flashUniform.value = Math.max(flashUniform.value, 0.7);
      spawnFlare(worldPosition, hdr(COLD_WHITE, 2.0), 60, 0.8);
      spawnRing(worldPosition, hdr(COLD_WHITE, 1.6), 70, 1.1);
      spawnRing(worldPosition, hdr(MOLTEN, 1.3), 44, 0.85);
      burstSparks(worldPosition, hdr(MOLTEN, 1.4), 70, 34, 1.4);
    } else if (record.mesh.userData.kind === 'picket' || record.mesh.userData.kind === 'turret') {
      cameraFeel.shake(0.35, BROADSIDE_SHAKE);
      spawnFlare(worldPosition, hdr(MOLTEN, 1.1), 12, 0.35);
      spawnHulk(worldPosition, 1.6, new Vector3((Math.random() - 0.5) * 8, -3, 4));
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.get(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, OBSIDIAN_EDGE.clone().multiplyScalar(0.7), 3, 4, 0.35);
  });

  // The flagship's shield eating a volley gets its own language: a violet slap
  // across the frame and a facet flaring where each shot died.
  bus.on('shielded', ({ shields }) => {
    shieldSlap = 1;
    shieldBlockUniform.value = 0.85;
    for (const shield of shields) {
      spawnRing(shield.worldPosition, SHIELD_VIOLET.clone().multiplyScalar(2.0), 14, 0.45);
      spawnFlare(shield.worldPosition, SHIELD_VIOLET.clone().multiplyScalar(1.4), 18, 0.35);
    }
    cameraFeel.shake(0.4, BROADSIDE_SHAKE);
  });

  bus.on('reject', ({ enemyIds }) => {
    if (enemyIds.length > 0) cameraFeel.shake(0.25, BROADSIDE_SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.6);
      surge = Math.max(surge, 0.3);
      flashUniform.value = Math.max(flashUniform.value, 0.18);
    }
  });

  bus.on('beat', ({ beatNumber, isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
    environment?.onBeat(beatNumber, isDownbeat, runTimeNow, runningNow);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    beatEnergy = 1.5;
    cameraFeel.shake(1.4, BROADSIDE_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      environment?.dropShield();
      cameraFeel.shake(1.2, BROADSIDE_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.85);
      surge = Math.max(surge, 0.9);
    } else if (phase === 'destroyed') {
      environment?.killFlagship();
      cameraFeel.shake(1.8, BROADSIDE_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 1.0);
      surge = 1.0;
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    environment?.reset();
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    damageUniform.value = 0;
    shieldBlockUniform.value = 0;
    heatUniform.value = 0;
    surge = 0;
    hitsTaken = 0;
    damagePulse = 0;
    shieldSlap = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame ------------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  fovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  runTimeNow = ctx.runTime;
  runningNow = ctx.running;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);
  surge = Math.max(0, surge - dt * 0.9);
  damagePulse = Math.max(0, damagePulse - dt * 1.5);
  shieldSlap = Math.max(0, shieldSlap - dt * 2.2);

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? broadsideRunProgress(runTime) : 0;

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    speed: ctx.running ? speedFactorAt(runTime) : 0.5,
    beatEnergy,
  });

  // Grade: the run walks from the cool magenta of the open gap into the gold
  // furnace of the flagship's death.
  heatUniform.value = MathUtils.clamp((progress - 0.5) / 0.45, 0, 1);
  damageUniform.value = Math.min(1, damagePulse * 0.65 + Math.min(1, hitsTaken / BROADSIDE_PLAYER_HEALTH) * 0.07);
  shieldBlockUniform.value = shieldSlap * 0.85;
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.6 : 2.5));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    let scale = easeOutBack(Math.min(1, age / 0.34));
    if (record.mesh.userData.isHostileShot) {
      // An incoming round brakes to arm's length in front of the canopy. Left
      // at full size it would engulf the camera and white the frame out, so it
      // shrinks with proximity and holds a roughly constant angular size — a
      // bright round hanging in front of you, not a wall of light.
      const range = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
      scale *= MathUtils.clamp(range / 16, 0.16, 1);
    }
    record.mesh.scale.setScalar(scale);

    updateEnemyTint(record, ctx);
    updateEnemyBehaviour(record, dt);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 1.5;
      const pulse = 1 + Math.sin(elapsedNow * 10) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 2.0 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const spinner = findReticleSpinner(ctx.scene);
  if (spinner) {
    const active = spinner.parent?.userData.active === true;
    spinner.rotation.z += dt * (active ? 1.9 : 0.5);
    const pipRing = spinner.parent?.userData.pipRing as Group | undefined;
    if (pipRing) pipRing.rotation.z -= dt * (active ? 0.9 : 0.22);
  }

  updateEffects(dt, ctx.camera);
}

function updateEnemyBehaviour(record: EnemyRecord, dt: number) {
  const data = record.mesh.userData;
  const locked = data.locked === true;

  if (data.kind === 'turret' || data.kind === 'picket') {
    const muzzle = data.muzzle as MeshBasicMaterial | undefined;
    const charge = (data.charge as number | undefined) ?? 0;
    if (muzzle) muzzle.color.copy(CRIMSON).lerp(COLD_WHITE, charge * 0.6).multiplyScalar(0.15 + charge * 3.0);
  }

  if (data.isGenerator) {
    const ring = data.ring as Group | undefined;
    if (ring) ring.rotation.z = (data.spin as number | undefined) ?? 0;
    const halo = data.halo as MeshBasicMaterial | undefined;
    const strain = (data.strain as number | undefined) ?? 0;
    const charge = (data.charge as number | undefined) ?? 0;
    if (halo) {
      const beat = 0.5 + 0.5 * Math.sin(elapsedNow * (strain > 0 ? 12 : 4.5));
      halo.color.copy(strain > 0 ? MOLTEN : CRIMSON).multiplyScalar(0.35 + beat * (0.7 + strain * 1.1) + charge * 0.8);
    }
    const node = data.node as Group | undefined;
    if (node) node.scale.setScalar(1 + Math.sin(elapsedNow * (strain > 0 ? 14 : 5)) * (strain > 0 ? 0.16 : 0.06));
    if (strain > 0 && elapsedNow - record.lastVentAt > 0.22) {
      record.lastVentAt = elapsedNow;
      burstSparks(record.mesh.position, hdr(MOLTEN, 1.0), 2, 7, 0.4);
    }
  }

  if (data.isCore) {
    const exposed = data.exposed === true;
    const petals = data.armorPetals as Group[] | undefined;
    if (petals) {
      const target = exposed ? 1 : 0;
      for (const [index, petal] of petals.entries()) {
        const open = (petal.userData.open as number | undefined) ?? 0;
        const next = open + (target - open) * Math.min(1, dt * 5);
        petal.userData.open = next;
        petal.position.y = next * 1.4;
        petal.rotation.z = (index / 6) * Math.PI * 2 + next * 0.24;
        const plate = petal.children[0];
        if (plate) plate.rotation.set(-next * 1.1, 0, 0);
      }
    }
    const glow = data.glow as MeshBasicMaterial | undefined;
    const pulse = (data.pulse as number | undefined) ?? 0;
    if (glow) glow.color.copy(exposed ? COLD_WHITE : MOLTEN).multiplyScalar(exposed ? 0.6 + pulse * 1.7 : 0.25 + pulse * 0.4);
    const coreGroup = data.coreGroup as Group | undefined;
    if (coreGroup) coreGroup.scale.setScalar(exposed ? 1.15 + pulse * 0.25 : 0.9);
    const plate = data.shieldPlate as Group | undefined;
    const shieldMaterial = data.shieldMaterial as MeshBasicMaterial | undefined;
    if (plate) {
      plate.visible = data.shielded === true && !locked;
      plate.rotation.z = (data.spin as number | undefined) ?? 0;
    }
    if (shieldMaterial) shieldMaterial.color.copy(SHIELD_VIOLET).multiplyScalar(0.5 + pulse * 0.6);
  }
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  // FOV opens with throttle, kicks with the beat and every set piece, and blows
  // wide on the pull-out so the whole battle fits in the frame.
  const target = (speed - 1.0) * 8.5 + beatEnergy * 1.1 + surge * 8.0;
  fovOffset = MathUtils.lerp(fovOffset, target, Math.min(1, dt * 5.5));

  // Banks and the corkscrew are authored in gameplay.ts; the camera flies them.
  if (ctx.running) camera.rotateZ(rollRadiansAt(runTime));

  ctx.feel.setFovOffset(fovOffset);
  ctx.feel.update(dt, { shake: BROADSIDE_SHAKE });
}

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
  const data = record.mesh.userData;
  const denied = ((data.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (data.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (data.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = data.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff keeps far additive stacks quiet so silhouettes carry the
  // read — which is the whole point of a level lit from behind.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smoothstep(1 - clamp01((distance - 18) / (110 - 18)));
  const locked = data.locked === true;
  const damageFlash = ((data.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(CYAN, 1.7));
      else if (part.kind === 'fill') part.material.color.copy(CYAN.clone().multiplyScalar(0.2));
      else part.material.color.copy(hdr(COLD_WHITE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(COLD_WHITE, part.kind === 'fill' ? 0.55 : 1.9));
      continue;
    }
    const dim = part.kind === 'fill' ? 0.55 + 0.45 * closeness : 0.45 + 0.55 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
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
