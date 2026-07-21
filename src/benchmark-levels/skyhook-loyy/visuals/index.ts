import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
} from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { SKYHOOK_LOYY_MARKERS } from '../gameplay';
import {
  animateEnemySignals,
  createClawMesh,
  createCrawlerMesh,
  createKiteMesh,
  createRaiderMesh,
  createSaboteurMesh,
  createShardMesh,
  createSkimmerMesh,
  pulseCrawler,
  type TintPart,
} from './enemies';
import { clearEffects, createEffects, spawnImpact, spawnMiss, spawnRing, updateEffects } from './effects';
import {
  createEnvironmentInternal,
  flashCarDamage,
  resetCarIntegrity,
  setCarThreatCount,
  triggerLightning,
  updateEnvironment,
  type SkyhookEnvironment,
} from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { DENY_RED, HAZARD_DARK, LOCK_BLUE, ORANGE, PANEL, PANEL_SHADE, SUN_WHITE, hdr } from './palette';
import {
  kickCaptureFlash,
  kickDamageFlash,
  kickStormFlash,
  resetSkyhookPost,
  updateSkyhookPost,
} from './post-fx';

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = { mesh: Group; bornAt: number };

export type SkyhookVisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

let environment: SkyhookEnvironment | null = null;
let elapsedNow = 0;
let beatPulse = 0;
let bossPressure = 0;
let dockFlash = 0;
let lastRunTime = -1;
const carThreatIds = new Set<number>();

const LOCK_OUTER_GEOMETRY = new RingGeometry(0.86, 0.92, 8);
const LOCK_INNER_GEOMETRY = new RingGeometry(0.65, 0.68, 24);

const LOCK_COLORS = [LOCK_BLUE, PANEL, ORANGE, ORANGE, SUN_WHITE, SUN_WHITE];

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord(record) {
    if (record.lockRing) {
      record.lockRing.removeFromParent();
      record.lockRing = null;
    }
  },
});
const projectileRecords = createPendingVisualRecords<Group, ProjectileRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: elapsedNow }),
});
const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => { record.lockRing = ring; },
  disposeAdornment(adornment) {
    adornment.removeFromParent();
    adornment.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  },
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemy(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemy(kind: string, letter?: string) {
  switch (kind) {
    case 'letter': return createLetterMesh(letter ?? 'A');
    case 'kite': return createKiteMesh();
    case 'skimmer': return createSkimmerMesh();
    case 'raider': return createRaiderMesh();
    case 'saboteur': return createSaboteurMesh();
    case 'shard': return createShardMesh();
    case 'claw': return createClawMesh();
    case 'crawler': return createCrawlerMesh();
    default: return createRaiderMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.55;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group, true);
  spawnRing(mesh.position, DENY_RED, 2.5, 0.34);
}

export function createProjectileMesh() {
  const group = new Group();
  const body = new Mesh(new OctahedronGeometry(0.26, 0), new MeshBasicMaterial({ color: hdr(PANEL, 1.15) }));
  body.scale.set(0.55, 0.55, 2.4);
  const tip = new Mesh(new OctahedronGeometry(0.12, 0), new MeshBasicMaterial({ color: hdr(ORANGE, 1.35) }));
  tip.position.z = 0.7;
  group.add(body, tip);
  projectileRecords.enqueue(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const materials: MeshBasicMaterial[] = [];
  const add = (mesh: Mesh, color: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(color);
    material.side = DoubleSide;
    materials.push(material);
    group.add(mesh);
  };
  add(new Mesh(new RingGeometry(0.48, 0.515, 32), new MeshBasicMaterial()), PANEL);
  add(new Mesh(new CircleGeometry(0.035, 12), new MeshBasicMaterial()), ORANGE);
  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const bracket = new Group();
    const horizontal = new Mesh(new PlaneGeometry(0.28, 0.045), new MeshBasicMaterial({ color: PANEL }));
    horizontal.position.x = 0.14;
    const vertical = new Mesh(new PlaneGeometry(0.045, 0.2), new MeshBasicMaterial({ color: PANEL }));
    vertical.position.y = 0.1;
    bracket.add(horizontal, vertical);
    bracket.position.set(Math.cos(i * Math.PI / 2 + Math.PI / 4) * 0.72, Math.sin(i * Math.PI / 2 + Math.PI / 4) * 0.72, 0);
    bracket.rotation.z = i * Math.PI / 2 + Math.PI / 4;
    brackets.add(bracket);
    materials.push(horizontal.material as MeshBasicMaterial, vertical.material as MeshBasicMaterial);
  }
  group.add(brackets);
  group.userData.materials = materials;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.065 + (active ? 0.04 : 0));
  const color = lockCount > 0 ? colorForLockCount(lockCount, LOCK_COLORS) : PANEL;
  for (const material of reticle.userData.materials as MeshBasicMaterial[]) {
    material.color.copy(color).multiplyScalar(active ? 1.15 : 0.82);
  }
}

function makeLockRing() {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  const outer = new Mesh(LOCK_OUTER_GEOMETRY, new MeshBasicMaterial({ color: ORANGE, side: DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
  const inner = new Mesh(LOCK_INNER_GEOMETRY, new MeshBasicMaterial({ color: PANEL, side: DoubleSide, transparent: true, opacity: 0.75, depthWrite: false }));
  group.add(outer, inner);
  return group;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    record.bornAt = elapsedNow;
    if (kind === 'saboteur' || kind === 'crawler') {
      carThreatIds.add(enemyId);
      if (environment) setCarThreatCount(environment, carThreatIds.size);
    }
    if (kind === 'crawler') {
      bossPressure = 1;
      spawnRing(worldPosition, ORANGE, 18, 1.2, 0.4);
      feel.shake(0.8, CAMERA_SHAKE);
    } else if (kind !== 'letter' && kind !== 'shard') {
      spawnRing(worldPosition, PANEL_SHADE, 2.2, 0.3, 0.4);
    }
  });
  bus.on('lock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const ring = makeLockRing();
    scene.add(ring);
    lockRings.attach(record, ring, scene);
    spawnRing(record.mesh.position, LOCK_BLUE, 2.2, 0.24, 0.65);
  });
  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });
  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnRing(worldPosition, ORANGE, 2.6, 0.24, 0.15);
  });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, stageCompleted }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (record) record.mesh.userData.hitUntil = elapsedNow + 0.13;
    spawnImpact(worldPosition, lethal || stageCompleted);
    feel.shake(lethal ? 0.3 : 0.12, CAMERA_SHAKE);
  });
  bus.on('stage', ({ worldPosition }) => {
    spawnRing(worldPosition, PANEL, 12, 0.75, 1);
    spawnRing(worldPosition, ORANGE, 7, 0.5, 0.5);
    feel.shake(0.65, CAMERA_SHAKE);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    if (carThreatIds.delete(enemyId) && environment) setCarThreatCount(environment, carThreatIds.size);
    const record = enemyRecords.get(enemyId);
    if (record?.mesh.userData.isCrawler) {
      for (let i = 0; i < 4; i += 1) spawnRing(worldPosition, i % 2 === 0 ? PANEL : ORANGE, 20 + i * 9, 0.8 + i * 0.18, 1 + i);
      feel.shake(1.5, CAMERA_SHAKE);
      bossPressure = 0;
      dockFlash = 1;
      kickCaptureFlash(0.82);
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (carThreatIds.delete(enemyId) && environment) setCarThreatCount(environment, carThreatIds.size);
    enemyRecords.delete(enemyId, { dispose: true });
    spawnMiss(worldPosition);
  });
  bus.on('reject', () => {
    dockFlash = Math.max(dockFlash, 0.25);
    feel.shake(0.12, CAMERA_SHAKE);
  });
  bus.on('beat', ({ isDownbeat }) => {
    beatPulse = Math.max(beatPulse, isDownbeat ? 1 : 0.35);
    if (environment && isDownbeat && lastRunTime < 0) triggerLightning(environment, 0.72);
    if (isDownbeat && lastRunTime < SKYHOOK_LOYY_MARKERS.cloudbreak) kickStormFlash(0.45);
  });
  bus.on('playerhit', ({ healthRemaining }) => {
    if (environment) flashCarDamage(environment, healthRemaining);
    dockFlash = 0.55;
    kickDamageFlash(0.9);
    feel.shake(1.0, CAMERA_SHAKE);
  });
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      bossPressure = 1.3;
      feel.shake(0.75, CAMERA_SHAKE);
    }
  });
  bus.on('runstart', () => {
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    clearEffects(new PerspectiveCamera());
    lastRunTime = -1;
    beatPulse = 0;
    bossPressure = 0;
    dockFlash = 0;
    resetSkyhookPost();
    carThreatIds.clear();
    if (environment) resetCarIntegrity(environment);
  });
  bus.on('runend', () => {
    feel.restore();
  });
}

const CAMERA_SHAKE = {
  decay: 2.8,
  maxTrauma: 1.6,
  pitchDegrees: 0.25,
  yawDegrees: 0.25,
  rollDegrees: 0.55,
  frequency: 8,
  smoothing: 20,
};

export function updateVisuals(dt: number, context: SkyhookVisualContext) {
  elapsedNow = context.elapsed;
  beatPulse = Math.max(0, beatPulse - dt * 3.4);
  bossPressure = Math.max(0, bossPressure - dt * 0.04);
  dockFlash = Math.max(0, dockFlash - dt * 1.5);
  updateSkyhookPost(dt);

  if (environment) {
    let carThreatUrgency = 0;
    for (const enemyId of carThreatIds) {
      const mesh = enemyRecords.get(enemyId)?.mesh;
      if (!mesh) continue;
      carThreatUrgency = Math.max(
        carThreatUrgency,
        mesh.userData.isCrawler ? Number(mesh.userData.approach ?? 0) : Number(mesh.userData.dive ?? 0),
      );
    }
    setCarThreatCount(environment, carThreatIds.size, carThreatUrgency);
    updateEnvironment(environment, dt, context.camera, context.runTime, context.running);
    if (dockFlash > 0) {
      for (const panel of environment.carPanels) panel.color.lerp(SUN_WHITE, dockFlash * 0.16);
    }
  }

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    const age = elapsedNow - (record.bornAt ?? elapsedNow);
    const targetScale = record.mesh.userData.isCrawler ? 1 : 1;
    const spawnScale = Math.min(1, age / (record.mesh.userData.isCrawler ? 0.7 : 0.25));
    record.mesh.scale.setScalar(targetScale * (1 - (1 - spawnScale) ** 3));

    updateTint(record.mesh);
    animateEnemySignals(record.mesh, elapsedNow);
    if (record.mesh.userData.isCrawler) pulseCrawler(record.mesh, elapsedNow);

    if (record.lockRing) {
      record.lockRing.position.copy(record.mesh.position);
      record.lockRing.quaternion.copy(context.camera.quaternion);
      record.lockRing.rotation.z += dt * 1.8;
      const size = record.mesh.userData.isCrawler ? 7.5 : record.mesh.userData.bossPart ? 2.1 : 1.45;
      record.lockRing.scale.setScalar(size * (1 + Math.sin(elapsedNow * 8) * 0.04));
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) projectileRecords.delete(projectileId);
    else record.mesh.rotation.z += dt * 8;
  }

  const reticle = context.scene.children.find((child) => child.userData.brackets) as Group | undefined;
  const brackets = reticle?.userData.brackets as Group | undefined;
  if (brackets) brackets.rotation.z += dt * (reticle?.userData.active ? 1.6 : 0.35);

  if (context.running && lastRunTime >= 0 && lastRunTime < SKYHOOK_LOYY_MARKERS.dock && context.runTime >= SKYHOOK_LOYY_MARKERS.dock) {
    dockFlash = 0.75;
    kickCaptureFlash(0.6);
    feelDock(context.feel);
  }
  lastRunTime = context.running ? context.runTime : -1;
  context.feel.setFovOffset(context.running ? beatPulse * 0.4 + bossPressure * 0.55 - (context.runTime >= SKYHOOK_LOYY_MARKERS.dock ? 4 : 0) : 0);
  context.feel.update(dt, { shake: CAMERA_SHAKE });
  updateEffects(dt, context.camera);
}

function feelDock(feel: CameraFeelRig) {
  feel.shake(0.85, CAMERA_SHAKE);
}

function updateTint(mesh: Group) {
  if (mesh.userData.isLetter) {
    const denied = (mesh.userData.deniedUntil as number | undefined ?? -1) > elapsedNow;
    if (denied) setLetterDenied(mesh, true);
    else setLetterLocked(mesh, mesh.userData.locked === true);
    return;
  }
  const parts = mesh.userData.parts as TintPart[] | undefined;
  if (!parts) return;
  const denied = (mesh.userData.deniedUntil as number | undefined ?? -1) > elapsedNow;
  const hit = (mesh.userData.hitUntil as number | undefined ?? -1) > elapsedNow;
  const locked = mesh.userData.locked === true;
  for (const part of parts) {
    if (denied) part.material.color.copy(part.kind === 'panel' ? HAZARD_DARK : DENY_RED);
    else if (hit) part.material.color.copy(SUN_WHITE).multiplyScalar(part.kind === 'panel' ? 0.9 : 1.25);
    else if (locked) part.material.color.copy(part.kind === 'accent' ? SUN_WHITE : ORANGE);
    else part.material.color.copy(part.base);
  }
}
