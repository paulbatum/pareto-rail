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
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  BROADSIDE_MARKERS,
  BROADSIDE_PLAYER_HEALTH,
  broadsideRunProgress,
  speedFactorAt,
} from '../gameplay';
import {
  createBoltMesh,
  createCoreMesh,
  createDartMesh,
  createEscortMesh,
  createLancerMesh,
  createShieldGenMesh,
  createTurretMesh,
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
  spawnDriftingHulk,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { COLD_WHITE, CRIMSON, CYAN, CYAN_PALE, LOCK_GRADIENT, MOLTEN, NEBULA_MAGENTA, OBSIDIAN_EDGE, hdr } from './palette';
import { damageUniform, flashUniform, victoryUniform } from './post-fx';

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
let hitsTaken = 0;
let damagePulse = 0;
let victoryAtRun = -1;
let lookBack = 0;

const BROADSIDE_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.5,
  maxTrauma: 1.7,
  pitchDegrees: 0.36,
  yawDegrees: 0.32,
  rollDegrees: 0.8,
  frequency: 8.5,
  smoothing: 20,
};

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// Every enemy and projectile builds unique geometries; without disposal the
// renderer's geometry count grows for the whole run. Meshes retire here and
// are disposed once the engine has removed them from the scene.
const retiredMeshes: Object3D[] = [];
function retireMesh(mesh: Object3D) {
  retiredMeshes.push(mesh);
}
function drainRetiredMeshes() {
  for (let i = retiredMeshes.length - 1; i >= 0; i -= 1) {
    if (!retiredMeshes[i].parent) {
      disposeObject3D(retiredMeshes[i]);
      retiredMeshes.splice(i, 1);
    }
  }
}

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    retireMesh(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  disposeRecord: (record) => retireMesh(record.mesh),
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

const KIND_SCALE: Record<string, number> = {
  dart: 1.35,
  lancer: 1.25,
  turret: 1.35,
  escort: 1.35,
  bolt: 1.25,
  shieldgen: 1.2,
  core: 1.15,
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
    case 'dart':
      return createDartMesh();
    case 'lancer':
      return createLancerMesh();
    case 'turret':
      return createTurretMesh();
    case 'escort':
      return createEscortMesh();
    case 'bolt':
      return createBoltMesh();
    case 'shieldgen':
      return createShieldGenMesh();
    case 'core':
      return createCoreMesh();
    default:
      return createDartMesh();
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

// Player shot: fleet ordnance — a cold white core in a cyan shell. Reads as
// "ours" against crimson return fire at any distance.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.4);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(COLD_WHITE, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.48, 0);
  shellGeometry.scale(0.55, 0.55, 2.1);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(CYAN, 1.1), opacity: 0.55 })));
  projectileRecords.enqueue({ mesh: group, trailColor: CYAN.clone().multiplyScalar(0.8) });
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

  // A fleet gunsight: thin outer ring, three chevron vanes that spin while
  // tracking, and a hot center pip.
  const outer = new Mesh(new RingGeometry(0.62, 0.652, 48), new MeshBasicMaterial());
  addPart(outer, hdr(CYAN_PALE, 1.05));

  const vanes = new Group();
  for (let i = 0; i < 3; i += 1) {
    const vane = new Mesh(new PlaneGeometry(0.26, 0.05), new MeshBasicMaterial());
    addPart(vane, hdr(CYAN, 1.2));
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    vane.position.set(Math.cos(angle) * 0.44, Math.sin(angle) * 0.44, 0);
    vane.rotation.z = angle + Math.PI / 2;
    vanes.add(vane);
  }

  const ticks = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.2, 0.045), new MeshBasicMaterial());
    addPart(tick, hdr(COLD_WHITE, 0.95));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(COLD_WHITE, 1.9));

  group.add(outer, vanes, ticks, dot);
  group.userData.parts = parts;
  group.userData.spinner = vanes;
  group.userData.ticks = ticks;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  // Charging walks the sight cyan → pale ice → cold white: six locks is a
  // full firing solution burning at fleet brightness.
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
    if (kind === 'shieldgen') {
      spawnRing(worldPosition, hdr(NEBULA_MAGENTA, 1.2), 5, 0.5);
    } else if (kind === 'core') {
      spawnRing(worldPosition, hdr(MOLTEN, 1.0), 4, 0.45);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(CYAN_PALE, 0.5), 2.2, 0.32);
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
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(CYAN_PALE, 0.85), 5, 9);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(COLD_WHITE, 1.7), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    // Armor stage sheared away: casing shards and a molten ring.
    const record = enemyRecords.get(enemyId);
    const specs = record?.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs.slice(0, 4));
    burstSparks(worldPosition, hdr(MOLTEN, 1.0), 10, 12);
    spawnRing(worldPosition, hdr(MOLTEN, 1.2), 5, 0.4);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? MOLTEN;
      burstSparks(worldPosition, hdr(accent, 0.95), 8, 12);
      spawnRing(worldPosition, hdr(accent, 0.85), 4.2, 0.4);
      spawnGlint(worldPosition, hdr(COLD_WHITE, 1.5), 1.1, 0.16);

      const kind = record.mesh.userData.kind as string | undefined;
      if (kind === 'shieldgen') {
        cameraFeel.shake(0.55, BROADSIDE_CAMERA_SHAKE);
        spawnRing(worldPosition, hdr(NEBULA_MAGENTA, 1.3), 10, 0.6);
        burstSparks(worldPosition, hdr(NEBULA_MAGENTA, 1.0), 16, 16);
      } else if (kind === 'core') {
        cameraFeel.shake(0.9, BROADSIDE_CAMERA_SHAKE);
        flashUniform.value = Math.max(flashUniform.value, 0.35);
        spawnRing(worldPosition, hdr(MOLTEN, 1.4), 14, 0.7);
        spawnRing(worldPosition, hdr(COLD_WHITE, 1.0), 8, 0.5);
        burstSparks(worldPosition, hdr(MOLTEN, 1.2), 26, 20);
      } else if (kind === 'dart' || kind === 'escort' || kind === 'lancer') {
        // Dead fighters roll off burning — the swarm thins visibly.
        const away = new Vector3().randomDirection().multiplyScalar(6);
        away.z += 4;
        spawnDriftingHulk(worldPosition, kind === 'lancer' ? 1.3 : 1.0, away);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstSparks(worldPosition, OBSIDIAN_EDGE.clone().multiplyScalar(0.5), 3, 3);
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
    cameraFeel.shake(1.3, BROADSIDE_CAMERA_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      // The shield film tears: one bright magenta collapse over the bow.
      environment?.notifyShieldDown();
      flashUniform.value = Math.max(flashUniform.value, 0.5);
      surgePulse = Math.max(surgePulse, 0.6);
      cameraFeel.shake(0.9, BROADSIDE_CAMERA_SHAKE);
      if (environment) {
        spawnRing(environment.flagshipFocus.clone().add(new Vector3(0, 10, 160)), hdr(NEBULA_MAGENTA, 1.4), 90, 1.2);
      }
    } else if (phase === 'destroyed') {
      flashUniform.value = Math.max(flashUniform.value, 1.0);
      surgePulse = 1.0;
      cameraFeel.shake(1.7, BROADSIDE_CAMERA_SHAKE);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    environment?.reset();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    damageUniform.value = 0;
    victoryUniform.value = 0;
    surgePulse = 0;
    hitsTaken = 0;
    damagePulse = 0;
    victoryAtRun = -1;
    lookBack = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

/** The runtime tells visuals when the win lands so the grade and camera can turn. */
export function notifyVictory(runTime: number) {
  victoryAtRun = runTime;
  environment?.notifyDestroyed(runTime);
}

// ---- per-frame update ---------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFovOffset = 0;
  lookBack = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);
  damagePulse = Math.max(0, damagePulse - dt * 1.5);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.6;

  // Catapult moment: one launch slam as the deck lets go.
  if (ctx.running && runTime > 0.05 && runTime < 0.2 && flashUniform.value < 0.1) {
    flashUniform.value = Math.max(flashUniform.value, 0.4);
    surgePulse = Math.max(surgePulse, 0.7);
    ctx.feel.shake(0.6, BROADSIDE_CAMERA_SHAKE);
  }

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    speed,
    beatEnergy,
  });

  // Post grade: damage pushes crimson in; victory pours gold over the frame.
  damageUniform.value = Math.min(1, damagePulse * 0.6 + Math.min(1, hitsTaken / BROADSIDE_PLAYER_HEALTH) * 0.06);
  if (victoryAtRun >= 0 && ctx.running) {
    victoryUniform.value = MathUtils.clamp((runTime - victoryAtRun) / 2.5, 0, 1);
  }
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

    const kind = record.mesh.userData.kind as string | undefined;

    // Wind-up lamps: lancer prong arcs and turret muzzles climb to white-hot
    // before each bolt so incoming fire is always telegraphed.
    if (kind === 'lancer' || kind === 'turret') {
      const charge = (record.mesh.userData.charge as number | undefined) ?? 0;
      for (const key of ['chargeLamp', 'chargeLampB'] as const) {
        const lamp = record.mesh.userData[key] as MeshBasicMaterial | undefined;
        if (lamp && record.mesh.userData.locked !== true) {
          lamp.color.copy(CRIMSON.clone().lerp(COLD_WHITE, charge * 0.7)).multiplyScalar(0.7 + charge * 2.4);
        }
      }
    }

    if (kind === 'shieldgen') {
      const ring = record.mesh.userData.cageRing as Mesh | undefined;
      const ring2 = record.mesh.userData.cageRing2 as Mesh | undefined;
      if (ring) ring.rotation.z += dt * 1.6;
      if (ring2) ring2.rotation.x += dt * 2.1;
      const emitter = record.mesh.userData.emitter as MeshBasicMaterial | undefined;
      if (emitter && record.mesh.userData.locked !== true) {
        const wounded = (record.mesh.userData.armed as number | undefined ?? 2) <= 1;
        const pulse = 1.1 + Math.sin(elapsedNow * (wounded ? 13 : 4.5)) * (wounded ? 0.7 : 0.35);
        emitter.color.copy(hdr(NEBULA_MAGENTA, pulse));
      }
    }

    if (kind === 'core') {
      const column = record.mesh.userData.coreColumn as MeshBasicMaterial | undefined;
      const film = record.mesh.userData.shieldFilm as MeshBasicMaterial | undefined;
      const exposed = record.mesh.userData.exposed === true;
      if (column && record.mesh.userData.locked !== true) {
        const pulse = exposed ? 1.6 + Math.sin(elapsedNow * 9) * 0.6 : 0.55 + Math.sin(elapsedNow * 2.4) * 0.15;
        column.color.copy(exposed ? MOLTEN.clone().lerp(COLD_WHITE, 0.35) : MOLTEN).multiplyScalar(pulse);
      }
      if (film) {
        film.color.copy(hdr(NEBULA_MAGENTA, exposed ? 0 : 0.16 + Math.sin(elapsedNow * 3.1) * 0.05));
      }
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
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }
  drainRetiredMeshes();

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.6 : 0.9);
    const ticks = reticleSpinner.parent?.userData.ticks as Group | undefined;
    if (ticks) ticks.rotation.z -= dt * (active ? 2.4 : 0.5);
  }

  updateEffects(dt, ctx.camera, ctx.elapsed);
}

const LOOK_BACK_TARGET = new Vector3();

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.6;
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with speed, kicks with the beat and the set pieces; the
  // catapult and the broadside surge visibly stretch the world.
  const targetFovOffset = (speed - 1.0) * 8 + beatEnergy * 1.0 + surgePulse * 6.5;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the weave: roll follows the rail's lateral curvature, hard in
    // the gauntlet, steady on the straights.
    const u = broadsideRunProgress(ctx.runTime);
    const rail = cameraRailForEffects();
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.2, 0.2);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.4);
    camera.rotateZ(cameraRoll);

    // The pull-out: past the victory bar the camera trades the road ahead for
    // the battle behind — the flagship burning, both fleets in frame.
    const wantLook = runTime > BROADSIDE_MARKERS.victory + 0.6 ? 0.6 : 0;
    lookBack += (wantLook - lookBack) * Math.min(1, dt * 1.6);
    if (lookBack > 0.01 && environment) {
      LOOK_BACK_TARGET.copy(environment.flagshipFocus);
      const original = camera.quaternion.clone();
      camera.lookAt(LOOK_BACK_TARGET);
      camera.quaternion.slerp(original, 1 - lookBack);
    }
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: BROADSIDE_CAMERA_SHAKE });
}

import { createBroadsideRail } from '../gameplay';

let effectsRail: ReturnType<typeof createBroadsideRail> | null = null;
function cameraRailForEffects() {
  if (!effectsRail) effectsRail = createBroadsideRail();
  return effectsRail;
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
  const closeness = smootherstep(1 - clamp01((distance - 16) / (60 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      // Locked hostiles light up in the fleet's own cyan: claimed.
      if (part.kind === 'edge') part.material.color.copy(hdr(CYAN, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(CYAN.clone().multiplyScalar(0.22));
      else part.material.color.copy(hdr(COLD_WHITE, 1.9));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(COLD_WHITE, part.kind === 'fill' ? 0.5 : 1.8));
      continue;
    }
    const dim = part.kind === 'fill' ? 0.5 + 0.5 * closeness : 0.55 + 0.45 * closeness;
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
  // Three chevrons closing on the target: the fleet's firing-solution mark.
  const chevrons = new Group();
  for (let i = 0; i < 3; i += 1) {
    const blade = new Mesh(
      new PlaneGeometry(0.5, 0.06),
      createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
    );
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    blade.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    blade.rotation.z = angle + Math.PI / 2;
    chevrons.add(blade);
  }
  const innerRing = new Mesh(
    new RingGeometry(0.64, 0.67, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(COLD_WHITE, 0.5), 1.3), side: DoubleSide }),
  );
  group.add(chevrons, innerRing);
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
