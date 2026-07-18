import { Color, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Object3D, RingGeometry, Scene, Vector3 } from 'three';
import type { LineBasicMaterial, LineSegments, PerspectiveCamera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { massDriverRunState } from '../state';
import { MASS_DRIVER_TIME, SHOT_TIME, MASS_DRIVER_BARS } from '../timing';
import {
  createArcMesh,
  createCapacitorMesh,
  createCoilMesh,
  createInterlockMesh,
  createLetterMesh,
  createProjectileMeshInternal,
  createReticleInternal,
  createThreaderMesh,
  setLetterDenied,
  setLetterLocked,
  type ShardSpec,
} from './enemies';
import { createEnvironmentInternal, type MassDriverEnvironment } from './environment';
import {
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnArcLightning,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import { ARC_BLUE, HAZARD_AMBER, HAZARD_RED, hdr, heatRamp, ION_WHITE, LOCK_GRADIENT, VOLT_VIOLET } from './palette';
import { chargeUniform, detonationUniform, flashUniform } from './post-fx';

// Spine: palette decisions and event choreography. Mesh construction lives in
// enemies.ts, scenery in environment.ts, transient effects in effects.ts.

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  feel: CameraFeelRig;
  elapsed: number;
  runTime: number;
  running: boolean;
};

type EnemyRecord = { mesh: Group; bornAt: number | null; lockRing: Group | null };
type ProjectileRecord = { mesh: Object3D; trailColor: Color };

let environment: MassDriverEnvironment | null = null;
let elapsedNow = 0;
let flash = 0;
let detonation = 0;
let lastBeat = -1;
let shotFired = false;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  // Every enemy mesh owns freshly built geometries; free them with the record
  // or the renderer's geometry count grows for the whole run.
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
      return createLetterMesh(letter ?? '?');
    case 'coil':
      return createCoilMesh();
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
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  applyTint(mesh as Group);
}

const scratchVector = new Vector3();

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group);
  spawnRing(mesh.getWorldPosition(scratchVector), hdr(HAZARD_RED, 1.1), 2.6, 0.3);
  detonation = Math.max(detonation, 0.12);
}

export function createProjectileMesh() {
  const group = createProjectileMeshInternal();
  projectileRecords.enqueue({ mesh: group, trailColor: ARC_BLUE.clone().multiplyScalar(0.9) });
  return group;
}

export function createReticle() {
  return createReticleInternal();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const segments = reticle.userData.segments as MeshBasicMaterial[];
  for (let i = 0; i < segments.length; i += 1) {
    if (i < lockCount) {
      const color = i === 5 ? hdr(ION_WHITE, 2.2) : hdr(colorForLockCount(i + 1, LOCK_GRADIENT), 1.5);
      segments[i].color.copy(color);
    } else {
      segments[i].color.setRGB(0, 0, 0).lerp(ARC_BLUE, active ? 0.12 : 0.05);
    }
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'interlock') {
      // Interlock spawns land a double hazard ring and a camera jolt.
      spawnRing(worldPosition, hdr(HAZARD_AMBER, 1.4), 6.5, 0.5);
      spawnRing(worldPosition, hdr(HAZARD_AMBER, 0.9), 3.6, 0.34);
      feel.shake(0.24);
    } else if (kind !== 'arc' && kind !== 'letter') {
      spawnRing(worldPosition, hdr(ARC_BLUE, 0.8), 2.8, 0.4);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.2, 0.26);
    if (lockCount >= 6) {
      // The sixth lock pumps a blinding bloom: fully charged.
      flash = Math.max(flash, 0.35);
      spawnGlint(worldPosition, hdr(ION_WHITE, 2.2), 1.6, 0.2);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.1), 0.5, 0.11);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, stageCompleted }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    const record = enemyRecords.get(enemyId);
    if (!lethal) {
      // Armor chips crackle: sparks plus a short whip of arc lightning.
      burstSparks(worldPosition, hdr(ION_WHITE, 0.9), 7, 11);
      spawnGlint(worldPosition, hdr(ION_WHITE, 1.4), 1, 0.14);
      spawnArcLightning(
        worldPosition,
        worldPosition.clone().add(randomOffset(2.4)),
        hdr(ARC_BLUE, 1.6),
        0.18,
      );
      if (record) record.mesh.userData.hitFlashUntil = elapsedNow + 0.32;
    }
    if (stageCompleted && record) {
      // Stage break: shear the capacitor staves / pop the interlock cowl.
      const staves = record.mesh.userData.staves as Group | undefined;
      if (staves) staves.visible = false;
      const cowl = record.mesh.userData.cowl as Group | undefined;
      const core = record.mesh.userData.actuatorCore as Group | undefined;
      if (cowl) cowl.visible = false;
      if (core) core.visible = true;
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      shatterAlongFacets(worldPosition, specs, record.mesh.userData.accent as Color);
      spawnRing(worldPosition, hdr(VOLT_VIOLET, 1.5), 4.6, 0.4);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const isInterlock = record.mesh.userData.isInterlock === true;
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      const accent = (record.mesh.userData.accent as Color | undefined) ?? ARC_BLUE;
      shatterAlongFacets(worldPosition, specs, accent, isInterlock ? 2 : 1);
      spawnRing(worldPosition, hdr(accent, 1.0), isInterlock ? 8.5 : 5, 0.45);
      spawnArcLightning(worldPosition, worldPosition.clone().add(randomOffset(isInterlock ? 6 : 3.5)), hdr(ION_WHITE, 1.8), 0.24);
      if (isInterlock) {
        spawnArcLightning(worldPosition, worldPosition.clone().add(randomOffset(6)), hdr(HAZARD_AMBER, 1.4), 0.3);
        spawnGlint(worldPosition, hdr(ION_WHITE, 2.4), 2.6, 0.26);
        feel.shake(0.3);
        flash = Math.max(flash, 0.22);
        if (massDriverRunState.interlocksDown >= 6) {
          // Interlocks clear: a brief full-tunnel white strobe sweep.
          flash = Math.max(flash, 0.85);
        }
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.has(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    // Misses fizzle.
    burstSparks(worldPosition, VOLT_VIOLET.clone().multiplyScalar(0.4), 3, 2.5, 0.4);
  });

  bus.on('reject', () => {
    // Rejects pulse the detonation overlay — hazard red, a breaker trip.
    detonation = Math.max(detonation, 0.28);
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills >= 4 && kills >= size) flash = Math.max(flash, kills === 6 ? 0.5 : 0.28);
  });

  bus.on('playerhit', () => {
    detonation = Math.max(detonation, 0.45);
    feel.shake(0.5);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    flash = 0;
    detonation = 0;
    lastBeat = -1;
    shotFired = false;
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;

  // Charge ramps through the interlock bars, held back enough that the fight
  // stays readable until the last bar and a half.
  const interlockStart = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.interlock);
  let charge = 0;
  if (ctx.running && ctx.runTime > interlockStart && ctx.runTime < SHOT_TIME) {
    const t = (ctx.runTime - interlockStart) / (SHOT_TIME - interlockStart);
    charge = t < 0.8 ? t * 0.55 : 0.44 + ((t - 0.8) / 0.2) * 0.56;
    if (massDriverRunState.interlocksDown >= 6) charge = Math.min(charge, 0.5);
  }

  // Ring crossings: every quarter note. Shockwave pulse at the moment of
  // crossing, bigger and brighter on downbeats, with a hair of FOV kick.
  if (ctx.running && environment) {
    const beat = Math.floor(ctx.runTime / MASS_DRIVER_TIME.beatSeconds);
    if (beat !== lastBeat && beat >= 0 && beat <= MASS_DRIVER_BARS.shot * 4) {
      lastBeat = beat;
      const isDownbeat = beat % 4 === 0;
      const heat = heatRamp(beat / (MASS_DRIVER_BARS.shot * 4));
      spawnRing(environment.ringPosition(beat), hdr(heat, isDownbeat ? 1.7 : 1.0), isDownbeat ? 13 : 9, isDownbeat ? 0.4 : 0.28);
      if (isDownbeat) ctx.feel.kickFov(1.1, { decay: 6 });
    }

    // THE SHOT / the detonation, at the bar-28 downbeat.
    if (!shotFired && ctx.runTime >= SHOT_TIME) {
      shotFired = true;
      if (massDriverRunState.outcome === 'fired') {
        flash = Math.max(flash, 1.5);
        ctx.feel.kickFov(11, { decay: 2.2 });
        ctx.feel.shake(0.9, { rollDegrees: 1.6, frequency: 13 });
        spawnGlint(ctx.camera.position.clone().add(cameraForward(ctx.camera).multiplyScalar(30)), hdr(ION_WHITE, 3), 14, 0.5);
      } else {
        detonation = Math.max(detonation, 1.6);
        flash = Math.max(flash, 0.5);
        ctx.feel.shake(1.4, { rollDegrees: 2.4, frequency: 15 });
      }
    }
  }

  // Overlay decay.
  flash = Math.max(0, flash - dt * (flash > 0.8 ? 1.8 : 3.2));
  detonation = Math.max(0, detonation - dt * 1.9);
  flashUniform.value = flash;
  chargeUniform.value = charge * 0.55;
  detonationUniform.value = detonation;

  environment?.update({
    dt,
    camera: ctx.camera,
    runTime: ctx.runTime,
    running: ctx.running,
    charge,
    elapsed: ctx.elapsed,
  });

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Pop in with a quick overshoot.
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.35)));

    // Arc shells re-randomize rotation and scale every frame — the unstable
    // "this is incoming" tell.
    const shells = record.mesh.userData.arcShells as LineSegments[] | undefined;
    if (shells) {
      for (const shell of shells) {
        shell.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
        shell.scale.setScalar(0.8 + Math.random() * 0.5);
      }
    }

    applyTint(record.mesh, ctx);

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 1.6;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar((1 + Math.sin(elapsedNow * 8) * 0.05) * 2.1 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const active = reticle.userData.active === true;
    const lockCount = (reticle.userData.lockCount as number | undefined) ?? 0;
    const spinner = reticle.userData.spinner as Group;
    // The gauge spins faster while charging.
    spinner.rotation.z -= dt * (active ? 2.6 + lockCount * 0.5 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

// One tint pass drives every state: enemies brighten as they close, a lock
// turns them ion-white with a blue-tinted fill, a denial flushes them
// hazard-red for a beat, a hit flashes them blinding.
function applyTint(mesh: Group, ctx?: VisualContext) {
  const userData = mesh.userData;
  const edge = userData.edgeMaterial as LineBasicMaterial | undefined;
  const fill = userData.fillMaterial as MeshBasicMaterial | undefined;
  const core = userData.coreMaterial as MeshBasicMaterial | undefined;
  const glow = userData.glowMaterial as MeshBasicMaterial | undefined;
  if (!edge || !fill || !core || !glow) return;
  const baseEdge = userData.baseEdge as Color;
  const baseCore = userData.baseCore as Color;

  let closeness = 1;
  if (ctx) {
    const distance = mesh.position.distanceTo(ctx.camera.position);
    closeness = smootherstep(1 - MathUtils.clamp((distance - 16) / (110 - 16), 0, 1));
  }

  const deniedUntil = userData.deniedUntil as number | undefined;
  const hitFlashUntil = userData.hitFlashUntil as number | undefined;
  if ((hitFlashUntil ?? -Infinity) > elapsedNow) {
    const f = (hitFlashUntil! - elapsedNow) / 0.32;
    edge.color.copy(hdr(ION_WHITE, 1.4 + f * 1.6));
    fill.color.copy(ION_WHITE.clone().multiplyScalar(0.2 + f * 0.4));
    core.color.copy(hdr(ION_WHITE, 2.4 + f * 1.6));
    glow.color.copy(hdr(ION_WHITE, 1 + f));
  } else if ((deniedUntil ?? -Infinity) > elapsedNow) {
    const f = (deniedUntil! - elapsedNow) / 0.45;
    edge.color.copy(hdr(HAZARD_RED, 1.2 + f));
    fill.color.copy(HAZARD_RED.clone().multiplyScalar(0.12 + f * 0.14));
    core.color.copy(hdr(HAZARD_RED, 1.8));
    glow.color.copy(hdr(HAZARD_RED, 0.9));
  } else if (userData.locked === true) {
    edge.color.copy(hdr(ION_WHITE, 1.6));
    fill.color.copy(ARC_BLUE.clone().multiplyScalar(0.22));
    core.color.copy(hdr(ION_WHITE, 2.6));
    glow.color.copy(hdr(ARC_BLUE, 1.1));
  } else {
    const hot = 0.45 + 0.55 * closeness;
    edge.color.copy(baseEdge).multiplyScalar(0.55 + 0.65 * closeness);
    fill.color.setScalar(0.075).multiplyScalar(0.6 + 0.4 * closeness);
    core.color.copy(baseCore).multiplyScalar(2.2 * hot);
    glow.color.copy(baseCore).multiplyScalar(0.7 * hot);
  }
}

function shatterAlongFacets(position: import('three').Vector3, specs: ShardSpec[] | undefined, accent: Color, intensity = 1) {
  const directions = specs && specs.length > 0 ? specs : undefined;
  if (directions) {
    for (const spec of directions) {
      burstSparks(
        position.clone().addScaledVector(spec.direction, 0.3),
        accent.clone().multiplyScalar(0.5 * intensity),
        2,
        (8 + spec.size * 5) * intensity,
        0.35,
      );
    }
  }
  burstSparks(position, hdr(ION_WHITE, 0.8 * intensity), Math.round(10 * intensity), 9 * intensity);
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // A hexagonal clamp of two nested rings.
  const outer = new Mesh(
    new RingGeometry(0.88, 0.94, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.7, 0.73, 6),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ION_WHITE, 0.5), 1.3), side: DoubleSide }),
  );
  inner.rotation.z = Math.PI / 6;
  group.add(outer, inner);
  return group;
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) {
    if (child.userData.reticle) return child;
  }
  return null;
}

function cameraForward(camera: PerspectiveCamera) {
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  return forward;
}

function randomOffset(scale: number) {
  return new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
    .normalize()
    .multiplyScalar(scale * (0.6 + Math.random() * 0.4));
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function smootherstep(t: number): number {
  return t * t * (3 - 2 * t);
}
