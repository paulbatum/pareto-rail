import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import { createBroadsideAmr2Rail, BROADSIDE_AMR2_MARKERS, BROADSIDE_AMR2_RUN_DURATION } from '../gameplay';
import {
  burstShatter,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import {
  createBoltMesh,
  createDartMesh,
  createFlagCoreMesh,
  createGunshipMesh,
  createPowerNodeMesh,
  createShieldGenMesh,
  createWeaverMesh,
  setSwarmLocked,
  type EnemyMeshKind,
} from './enemies';
import { createBroadsideEnvironment, type BroadsideEnvironment } from './environment';
import { createLetterMesh, setLetterLocked } from './letters';
import { CORE_WHITE, CRIMSON, CYAN_GLOW, GOLD, hdr, ICE, MOLTEN } from './palette';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runTime: number;
  runProgress?: number;
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

let environment: BroadsideEnvironment | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let battleIntensity = 0.7;

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
  const curve = createBroadsideAmr2Rail();
  environment = createBroadsideEnvironment(scene, curve);
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
  switch (kind as EnemyMeshKind | 'letter') {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'dart':
      return createDartMesh();
    case 'gunship':
      return createGunshipMesh();
    case 'weaver':
      return createWeaverMesh();
    case 'bolt':
      return createBoltMesh();
    case 'shield-gen':
      return createShieldGenMesh();
    case 'power-node':
      return createPowerNodeMesh();
    case 'flag-core':
      return createFlagCoreMesh();
    default:
      return createDartMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  setSwarmLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnRing(mesh.position, hdr(GOLD, 1.0), 2.8, 0.32);
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(
    new OctahedronGeometry(0.3, 0),
    new MeshBasicMaterial({ color: hdr(ICE, 2.6) }),
  );
  core.scale.set(0.4, 0.4, 2.2);
  const shell = new Mesh(
    new OctahedronGeometry(0.5, 0),
    createAdditiveBasicMaterial({ color: hdr(CYAN_GLOW, 0.9), opacity: 0.55 }),
  );
  shell.scale.set(0.5, 0.5, 2.0);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group, trailColor: CYAN_GLOW.clone().multiplyScalar(0.9) });
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];

  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base, active });
  };

  // Broadside reticle: a gold-rimmed gunner's sight with cyan brackets.
  const outer = new Mesh(new RingGeometry(0.6, 0.65, 48), new MeshBasicMaterial());
  addPart(outer, hdr(GOLD, 1.1), hdr(GOLD, 1.9));

  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.33, 0.36, 3), new MeshBasicMaterial());
  addPart(inner, hdr(CYAN_GLOW, 0.8), hdr(CORE_WHITE, 1.6));
  spinner.add(inner);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.2, 0.04), new MeshBasicMaterial());
    addPart(tick, hdr(CYAN_GLOW, 1.3), hdr(GOLD, 2.0));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 20), new MeshBasicMaterial());
  addPart(dot, hdr(CORE_WHITE, 2), hdr(CORE_WHITE, 3));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) {
    part.material.color.copy(active ? part.active : part.base);
  }
}

// Battle intensity follows the arrangement: full broadsides over the flank,
// the belly and the flagship, a hollow calm in the eye.
function intensityAt(runTime: number): number {
  const { broadside, belly, eye, flagship, trench, finale } = BROADSIDE_AMR2_MARKERS;
  const end = BROADSIDE_AMR2_RUN_DURATION;
  if (runTime < broadside) return 0.45;
  if (runTime < belly) return 1.0;
  if (runTime < eye) return 0.9;
  if (runTime < flagship) return 0.12;
  if (runTime < trench) return 0.85;
  if (runTime < finale) return 1.0;
  if (runTime < end) return 0.7;
  return 0.4;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    const color = kind === 'bolt' ? hdr(CRIMSON, 1.0) : hdr(CYAN_GLOW, 0.9);
    spawnRing(worldPosition, color, kind === 'flag-core' ? 9 : 3.2, 0.5);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [CYAN_GLOW, GOLD, MOLTEN]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.4, 0.3);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ICE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) {
      const accent = (record?.mesh.userData.accent as Color | undefined) ?? MOLTEN;
      burstSparks(worldPosition, accent.clone().multiplyScalar(0.3), 2, 7);
    } else {
      burstSparks(worldPosition, hdr(CORE_WHITE, 0.9), 6, 12);
    }
    const kind = record?.mesh.userData.kind as string | undefined;
    if ((kind === 'shield-gen' || kind === 'power-node' || kind === 'flag-core') && !lethal) {
      if (record) record.mesh.userData.damageFlashUntil = elapsedNow + 0.42;
      spawnRing(worldPosition, hdr(MOLTEN, 1.35), 4.2, 0.34);
      spawnGlint(worldPosition, hdr(CORE_WHITE, 2.0), 1.3, 0.18);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const kind = enemyRecords.get(enemyId)?.mesh.userData.kind as string | undefined;
    if (kind !== 'flag-core') return;
    spawnRing(worldPosition, hdr(GOLD, 1.5), 7.5, 0.5);
    spawnGlint(worldPosition, hdr(CORE_WHITE, 2.2), 1.8, 0.22);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      const accent = (record.mesh.userData.accent as Color | undefined) ?? MOLTEN;
      burstShatter(worldPosition, specs, accent);
      const big = record.mesh.userData.kind === 'flag-core';
      spawnRing(worldPosition, hdr(accent, 0.9), big ? 14 : 5.5, big ? 0.9 : 0.5);
      spawnRing(worldPosition, hdr(GOLD, 0.55), big ? 9 : 3.2, 0.34);
      spawnGlint(worldPosition, hdr(CORE_WHITE, big ? 2.4 : 0.65), big ? 3 : 0.45, big ? 0.5 : 0.12);
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, MOLTEN.clone().multiplyScalar(0.5), 4, 3);
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.shieldFlashUntil = elapsedNow + 0.65;
      spawnRing(shield.worldPosition, hdr(CRIMSON, 1.5), 5.2, 0.45);
      spawnGlint(shield.worldPosition, hdr(CORE_WHITE, 1.7), 1.6, 0.2);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      environment?.flagshipTrenchPulse(1.4);
    }
    if (phase === 'destroyed') {
      environment?.flagshipBreaking();
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.6;
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    battleIntensity = 0.45;
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  battleIntensity += (intensityAt(ctx.runTime) - battleIntensity) * Math.min(1, dt * 2);

  ctx.feel.setFovOffset(beatEnergy * 1.2);
  environment?.update(dt, ctx.elapsed, ctx.runProgress ?? 0, ctx.camera, battleIntensity);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const baseScale = record.mesh.userData.locked === true ? 1.12 : 1;
    record.mesh.scale.setScalar(baseScale * easeOutBack(Math.min(1, age / 0.4)));

    const deniedUntil = record.mesh.userData.deniedUntil as number | undefined;
    const shieldFlashUntil = record.mesh.userData.shieldFlashUntil as number | undefined;
    const flashUntil = Math.max(deniedUntil ?? -Infinity, shieldFlashUntil ?? -Infinity);
    const damageFlashUntil = record.mesh.userData.damageFlashUntil as number | undefined;
    if (flashUntil > elapsedNow) {
      const flash = Math.max(0, Math.min(1, (flashUntil - elapsedNow) / 0.65));
      applyEdgeFlash(record.mesh, hdr(CRIMSON, 1.1 + flash * 1.4));
    } else if ((damageFlashUntil ?? -Infinity) > elapsedNow) {
      const flash = Math.max(0, Math.min(1, ((damageFlashUntil ?? 0) - elapsedNow) / 0.42));
      applyEdgeFlash(record.mesh, hdr(CORE_WHITE, 1.2 + flash * 1.6));
    } else {
      applyEdgeFlash(record.mesh, null);
    }

    const spinner = record.mesh.userData.spinner as Group | undefined;
    if (spinner) {
      spinner.rotation.z += dt * (record.mesh.userData.kind === 'weaver' ? 4.2 : 1.1);
    }

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
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 5 : 1.4);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 3.2 : 0.8);
  }

  updateEffects(dt, ctx.camera);
}

// Flash feedback tints every edge line on the mesh; passing null restores
// stored base colors (unless the target is locked, which owns its tint).
function applyEdgeFlash(mesh: Group, color: Color | null) {
  mesh.traverse((child) => {
    if (!(child instanceof LineSegments)) return;
    const material = child.material as MeshBasicMaterial;
    if (material.userData.baseColor === undefined) {
      material.userData.baseColor = material.color.clone();
    }
    if (color) {
      material.color.copy(color);
    } else if (mesh.userData.locked !== true) {
      material.color.copy(material.userData.baseColor as Color);
    }
  });
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.68, 0.71, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(CORE_WHITE, 0.55), 1.4), side: DoubleSide }),
  );
  group.add(ring, innerRing);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
