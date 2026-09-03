import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import {
  createBeetleMesh,
  createBirdMesh,
  createBlobMesh,
  createBossCoreMesh,
  createProjectileMeshInternal,
  createReticleMesh,
  createStilterMesh,
} from './enemies';
import {
  ballDipUntil,
  burstShards,
  burstSparks,
  createEffects,
  feedBall,
  resetEffects,
  scatterDebris,
  showerDebris,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import { createEnvironmentInternal, type Environment } from './environment';
import { createLetterMesh, setLetterLocked } from './letters';
import { AMBER, BUTTON_RED, BUTTON_TEAL, CREAM, GLUE_VIOLET, hdr } from './palette';

// Spine: palette and event choreography live here; mesh construction is in
// leaves (enemies, letters, environment, effects). Every gameplay event has
// a visual answer: spawn rings, lock rings, fire glints, hit sparks, kill
// shatter + persistent debris + ball growth, miss puffs, reject shakes.

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress?: number;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailAt: number;
};

let environment: Environment | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let spillCoresDown = 0;

const LOCK_GRADIENT = [BUTTON_TEAL, AMBER, BUTTON_RED];
const MISS_GRAY = new Color(0.5, 0.45, 0.4);

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
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
    case 'beetle':
      return withLockGlow(createBeetleMesh());
    case 'bird':
      return withLockGlow(createBirdMesh());
    case 'stilter':
      return withLockGlow(createStilterMesh());
    case 'blob':
      return withLockGlow(createBlobMesh());
    case 'boss-core':
      return withLockGlow(createBossCoreMesh());
    default:
      return withLockGlow(createBlobMesh());
  }
}

// An additive accent shell that only shows while locked: the tactile flare.
function withLockGlow(group: Group): Group {
  const accent = (group.userData.accent as Color | undefined) ?? CREAM;
  const glow = new Mesh(
    new SphereGeometry(1, 12, 8),
    createAdditiveBasicMaterial({ color: hdr(accent, 0.85), opacity: 0.4 }),
  );
  const fit = (group.userData.lockRingScale as number | undefined) ?? 1;
  glow.scale.setScalar(1.9 * fit);
  glow.visible = false;
  group.add(glow);
  group.userData.lockGlow = glow;
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  const glow = mesh.userData.lockGlow as Mesh | undefined;
  if (glow) glow.visible = locked;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
}

export function createProjectileMesh() {
  const mesh = createProjectileMeshInternal();
  projectileRecords.enqueue({ mesh, trailAt: 0 });
  return mesh;
}

export function createReticle() {
  return createReticleMesh();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) {
    part.material.color.copy(active ? part.active : part.base);
  }
}

function popShellPiece(worldPosition: Vector3, record: EnemyRecord) {
  const pieces = record.mesh.userData.shellPieces as Object3D[] | undefined;
  const piece = pieces?.pop();
  if (piece) {
    piece.visible = false;
    burstSparks(worldPosition, hdr(CREAM, 1.0), 8, 5);
  }
  const vein = record.mesh.userData.veinMaterial as MeshBasicMaterial | undefined;
  if (vein) {
    const total = 6;
    const gone = total - (pieces?.length ?? 0);
    vein.color.copy(hdr(AMBER, 0.7 + gone * 0.5));
  }
  spawnRing(worldPosition, hdr(AMBER, 1.3), 4.5, 0.4);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'boss-core') {
      bus.emit('bossphase', { phase: 'summoned' });
      spawnRing(worldPosition, hdr(GLUE_VIOLET, 1.2), 7, 0.7);
      spawnGlint(worldPosition, hdr(AMBER, 1.6), 1.2, 0.3);
    } else {
      spawnRing(worldPosition, hdr(GLUE_VIOLET, 0.8), 3.4, 0.5);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.6, 0.3);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(CREAM, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) return; // kill carries the visual.
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? CREAM;
    burstSparks(worldPosition, hdr(accent, 1.0), 7, 5);
    spawnRing(worldPosition, hdr(CREAM, 0.8), 2.2, 0.25);
    if (record && record.mesh.userData.kind === 'boss-core') {
      popShellPiece(worldPosition, record);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = (record?.mesh.userData.kind as string | undefined) ?? 'blob';
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? CREAM;
    const specs = record?.mesh.userData.shardSpecs as
      | Array<{ direction: Vector3; color: Color; size: number }>
      | undefined;
    burstShards(worldPosition, specs, accent, kind === 'boss-core' ? 2 : 1);
    burstSparks(worldPosition, hdr(accent, 1.1), 10, 7);
    if (kind === 'boss-core') {
      // A cracked core showers the route with rescued pieces; the ball dips
      // to scoop through the fresh field.
      spawnRing(worldPosition, hdr(GLUE_VIOLET, 1.4), 9, 0.7);
      spawnRing(worldPosition, hdr(CREAM, 1.0), 6, 0.5);
      spawnGlint(worldPosition, hdr(CREAM, 2.0), 2.0, 0.3);
      burstSparks(worldPosition, hdr(AMBER, 1.4), 16, 8);
      showerDebris(worldPosition, 22);
      feedBall(5);
      ballDipUntil(elapsedNow, 3.2);
      spillCoresDown += 1;
      if (spillCoresDown >= 3) bus.emit('bossphase', { phase: 'destroyed' });
      else bus.emit('bossphase', { phase: 'exposed' });
    } else {
      spawnRing(worldPosition, hdr(accent, 0.9), 5, 0.45);
      spawnGlint(worldPosition, hdr(CREAM, 0.9), 0.7, 0.15);
      scatterDebris(worldPosition, kind, accent, 4);
      feedBall(2);
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, MISS_GRAY, 5, 2.5, 2);
  });

  bus.on('reject', ({ enemyIds }) => {
    for (const enemyId of enemyIds) {
      const record = enemyRecords.get(enemyId);
      if (!record) continue;
      record.mesh.userData.deniedUntil = elapsedNow + 0.45;
      spawnRing(record.mesh.position, hdr(AMBER, 1.2), 2.8, 0.35);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
  });

  bus.on('runstart', () => {
    resetEffects();
    spillCoresDown = 0;
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);

  ctx.feel.setFovOffset(beatEnergy * 1.1);
  environment?.update(dt, beatEnergy);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const deniedUntil = (record.mesh.userData.deniedUntil as number | undefined) ?? -Infinity;
    const denied = deniedUntil > elapsedNow;
    const grow = easeOutBack(Math.min(1, age / 0.35));
    const shake = denied ? 1 + Math.sin(elapsedNow * 60) * 0.06 : 1;
    record.mesh.scale.setScalar(Math.max(0.001, grow * shake));

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.6;
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
    if (elapsedNow - record.trailAt > 0.06) {
      record.trailAt = elapsedNow;
      burstSparks(record.mesh.position, hdr(AMBER, 0.9), 1, 0.6, 0);
    }
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 5 : 1.4);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 3.2 : 0.8);
  }

  updateEffects(dt, ctx.camera, ctx.elapsed, ctx.runProgress ?? 0);
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  ring.rotation.z = Math.PI / 4;
  const innerRing = new Mesh(
    new RingGeometry(0.68, 0.71, 32),
    createAdditiveBasicMaterial({ color: hdr(color, 1.4), side: DoubleSide }),
  );
  group.add(ring, innerRing);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
