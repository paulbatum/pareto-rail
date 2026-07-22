import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdditiveBasicMaterial, createPendingVisualRecords, disposeObject3D } from '../../../engine/visual-kit';
import type { PursePursuitTahrEnemyKind } from '../gameplay';
import { createPurseEnvironment, disposePurseEnvironment, updatePurseEnvironment, type PurseEnvironment } from './environment';
import {
  createBomb,
  createBossBike,
  createBruiserBike,
  createLetterMesh,
  createPlayerProjectile,
  createPurse,
  createScoutBike,
  createSpikeCluster,
  createSwooperBike,
} from './models';
import { AMBER, CHROME, HOT_PINK, PURSE_BLUE, TAIL_RED, VIOLET, WHITE, hdr } from './palette';

type EnemyRecord = {
  mesh: Group;
  kind: string;
  born: number;
  lockRing: Group | null;
  baseScale: number;
};
type Spark = { mesh: Mesh; velocity: Vector3; born: number; life: number };
type Recovery = { mesh: Group; born: number };

let environment: PurseEnvironment | null = null;
let currentScene: Scene | null = null;
let currentFeel: CameraFeelRig | null = null;
let elapsedNow = 0;
let beatPulse = 0;
let recovery: Recovery | null = null;
const sparks: Spark[] = [];
const sparkGeometry = new BoxGeometry(0.08, 0.08, 0.62);
const sparkMaterials = new Map<number, MeshBasicMaterial>();
const recoveryLocal = new Vector3();

const records = createPendingVisualRecords<Group, EnemyRecord, [string]>({
  createRecord: (mesh, kind) => ({ mesh, kind, born: elapsedNow, lockRing: null, baseScale: kind === 'boss' ? 1.25 : kind === 'bomb' || kind === 'spike' ? 0.9 : 1 }),
  disposeRecord(record) {
    record.lockRing?.removeFromParent();
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<Group, Group>({
  createRecord: (mesh) => mesh,
  disposeRecord: disposeObject3D,
});

export function createEnvironment(scene: Scene) {
  disposePurseEnvironment(environment);
  environment = createPurseEnvironment(scene);
  currentScene = scene;
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  switch (kind as PursePursuitTahrEnemyKind | 'letter') {
    case 'letter': mesh = createLetterMesh(letter ?? 'A'); break;
    case 'swooper': mesh = createSwooperBike(); break;
    case 'bruiser': mesh = createBruiserBike(); break;
    case 'boss': mesh = createBossBike(); break;
    case 'bomb': mesh = createBomb(); break;
    case 'spike': mesh = createSpikeCluster(); break;
    default: mesh = createScoutBike(); break;
  }
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  records.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.42;
  burst(mesh.position, TAIL_RED, 8, 4.5, 0.34);
}

export function createProjectileMesh() {
  const mesh = createPlayerProjectile();
  projectileRecords.enqueue(mesh);
  return mesh;
}

export function createReticle() {
  const root = new Group();
  const materials: MeshBasicMaterial[] = [];
  const inner = new Mesh(new RingGeometry(0.43, 0.47, 32), new MeshBasicMaterial({ color: hdr(WHITE, 0.9), side: DoubleSide, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
  inner.renderOrder = 1000;
  root.add(inner);
  materials.push(inner.material);
  for (let i = 0; i < 6; i += 1) {
    const material = createAdditiveBasicMaterial({ color: hdr(HOT_PINK, 0.78), side: DoubleSide, depthTest: false });
    const segment = new Mesh(new RingGeometry(0.67, 0.73, 12, 1, i * Math.PI / 3 + 0.07, Math.PI / 3 - 0.14), material);
    segment.renderOrder = 1000;
    root.add(segment);
    materials.push(material);
  }
  const center = new Mesh(new CircleGeometry(0.032, 8), createAdditiveBasicMaterial({ color: hdr(AMBER, 1.2), depthTest: false }));
  center.renderOrder = 1000;
  root.add(center);
  materials.push(center.material as MeshBasicMaterial);
  root.userData.materials = materials;
  return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.1 : 0));
  const tint = lockCount > 0 ? colorForLockCount(lockCount, [HOT_PINK, HOT_PINK, AMBER, AMBER, WHITE, WHITE]) : HOT_PINK;
  for (const material of reticle.userData.materials as MeshBasicMaterial[]) material.color.copy(hdr(tint, active ? 1.4 : 0.82));
}

function lockBracket(color: Color) {
  const root = new Group();
  const material = createAdditiveBasicMaterial({ color: hdr(color, 1.45), side: DoubleSide });
  for (let i = 0; i < 4; i += 1) {
    const corner = new Mesh(new RingGeometry(1.2, 1.3, 5, 1, 0, Math.PI / 2), material);
    corner.rotation.z = i * Math.PI / 2 + Math.PI / 4;
    root.add(corner);
  }
  root.userData.raildIgnoreOcclusion = true;
  return root;
}

function ring(position: Vector3, color: Color, scale: number, life = 0.35) {
  if (!currentScene) return;
  const mesh = new Mesh(new RingGeometry(0.55, 0.63, 28), createAdditiveBasicMaterial({ color: hdr(color, 1.4), side: DoubleSide, opacity: 0.9 }));
  mesh.position.copy(position);
  mesh.userData.effectRing = true;
  mesh.userData.born = elapsedNow;
  mesh.userData.life = life;
  mesh.userData.maxScale = scale;
  mesh.userData.raildIgnoreOcclusion = true;
  currentScene.add(mesh);
}

function burst(position: Vector3, color: Color, count: number, speed: number, life = 0.5) {
  if (!currentScene) return;
  const key = color.getHex();
  let material = sparkMaterials.get(key);
  if (!material) {
    material = createAdditiveBasicMaterial({ color: hdr(color, 1.35), opacity: 0.9 });
    sparkMaterials.set(key, material);
  }
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(sparkGeometry, material);
    mesh.position.copy(position);
    const velocity = new Vector3(Math.sin(i * 9.73 + 1), Math.cos(i * 5.41), Math.sin(i * 3.17 + 2)).normalize().multiplyScalar(speed * (0.45 + (i % 6) / 7));
    currentScene.add(mesh);
    sparks.push({ mesh, velocity, born: elapsedNow, life });
  }
}

function startRecovery(position: Vector3) {
  if (!currentScene) return;
  recovery?.mesh.removeFromParent();
  const purse = createPurse(true);
  purse.position.copy(position);
  purse.scale.setScalar(0.001);
  purse.userData.raildIgnoreOcclusion = true;
  currentScene.add(purse);
  recovery = { mesh: purse, born: elapsedNow };
  ring(position, PURSE_BLUE, 8.5, 1.2);
  ring(position, AMBER, 6.5, 0.8);
  burst(position, AMBER, 34, 14, 1.25);
  burst(position, WHITE, 18, 9, 0.9);
  currentFeel?.kickFov(5.5);
  currentFeel?.shake(0.95);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel?: CameraFeelRig) {
  currentScene = scene;
  currentFeel = feel ?? null;
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = records.claim(enemyId, kind);
    if (!record) return;
    record.born = elapsedNow;
    const color = kind === 'boss' ? AMBER : kind === 'bomb' || kind === 'spike' ? TAIL_RED : HOT_PINK;
    ring(worldPosition, color, kind === 'boss' ? 4.8 : 1.8, kind === 'boss' ? 0.7 : 0.26);
    if (kind === 'boss') currentFeel?.kickFov(3.2);
  });
  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = records.get(enemyId);
    if (record && !record.lockRing && currentScene) {
      record.lockRing = lockBracket(colorForLockCount(lockCount, [HOT_PINK, HOT_PINK, AMBER, AMBER, WHITE, WHITE]));
      currentScene.add(record.lockRing);
    }
    ring(worldPosition, HOT_PINK, 1.55 + lockCount * 0.16, 0.2);
  });
  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    record?.lockRing?.removeFromParent();
    if (record) record.lockRing = null;
    ring(worldPosition, VIOLET, 1.2, 0.18);
  });
  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectileRecords.claim(projectileId);
    ring(worldPosition, AMBER, 1.5 + volleySize * 0.22, 0.2);
    currentFeel?.shake(0.05 + volleySize * 0.025);
  });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    const record = records.get(enemyId);
    if (record) record.mesh.userData.flashUntil = elapsedNow + 0.13;
    burst(worldPosition, lethal ? AMBER : CHROME, lethal ? 13 : 5, lethal ? 7 : 3.2, lethal ? 0.72 : 0.28);
  });
  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = records.get(enemyId);
    if (record) record.mesh.userData.stage = stageIndex;
    ring(worldPosition, stageIndex >= 2 ? WHITE : AMBER, 5.2, 0.7);
    burst(worldPosition, AMBER, 26, 10, 0.9);
    currentFeel?.kickFov(2.2 + stageIndex);
    currentFeel?.shake(0.7);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    const boss = record?.kind === 'boss';
    if (boss) {
      startRecovery(worldPosition);
      bus.emit('bossphase', { phase: 'destroyed' });
    } else {
      ring(worldPosition, AMBER, 3.5, 0.45);
      burst(worldPosition, HOT_PINK, 10, 6, 0.58);
    }
    records.delete(enemyId, { dispose: true });
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    ring(worldPosition, record?.kind === 'bomb' || record?.kind === 'spike' ? TAIL_RED : VIOLET, 2.2, 0.3);
    records.delete(enemyId, { dispose: true });
  });
  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    for (const id of [...enemyIds, ...(missingEnemyIds ?? [])]) {
      const record = records.get(id);
      if (record) record.mesh.userData.deniedUntil = elapsedNow + 0.42;
    }
    beatPulse = -1;
    currentFeel?.shake(0.22);
  });
  bus.on('beat', ({ isDownbeat }) => { beatPulse = isDownbeat ? 1 : 0.45; });
  bus.on('playerhit', () => {
    beatPulse = -1.3;
    currentFeel?.shake(0.9);
    currentFeel?.kickFov(-2.4);
  });
  bus.on('runstart', () => {
    records.clear();
    projectileRecords.clear();
    recovery?.mesh.removeFromParent();
    recovery = null;
    beatPulse = 1;
  });
}

export function updateVisuals(dt: number, context: { scene: Scene; camera: PerspectiveCamera; elapsed: number; runTime: number; runProgress: number; running: boolean }) {
  elapsedNow = context.elapsed;
  beatPulse *= Math.exp(-dt * 6.5);
  if (environment) updatePurseEnvironment(environment, { camera: context.camera, runProgress: context.runProgress, dt, elapsed: context.elapsed, beat: beatPulse });

  for (const record of records.values()) {
    const intro = Math.min(1, Math.max(0.001, (elapsedNow - record.born) * 4.8));
    const denied = Number(record.mesh.userData.deniedUntil ?? -1) > elapsedNow;
    const lockPulse = record.mesh.userData.locked ? 1 + Math.sin(elapsedNow * 12) * 0.055 : 1;
    const perspectiveScale = Number(record.mesh.userData.perspectiveScale ?? 1);
    record.mesh.scale.setScalar(record.baseScale * perspectiveScale * intro * lockPulse * (denied ? 0.76 + Math.sin(elapsedNow * 38) * 0.13 : 1));
    if (record.kind === 'boss') {
      const stage = Number(record.mesh.userData.stage ?? 0);
      record.mesh.rotation.y = Math.sin(elapsedNow * 1.2) * 0.05;
      record.mesh.rotation.x = Math.sin(elapsedNow * 2.1) * 0.035;
      const purse = record.mesh.userData.purse as Object3D | undefined;
      if (purse) purse.rotation.z = -0.38 + Math.sin(elapsedNow * (4.2 + stage)) * (0.11 + stage * 0.035);
    }
    const flash = Number(record.mesh.userData.flashUntil ?? -1) > elapsedNow;
    record.mesh.traverse((child) => {
      if (!(child instanceof Mesh) || !(child.material instanceof MeshBasicMaterial)) return;
      child.material.opacity = flash ? 0.58 : 1;
    });
    if (record.lockRing) {
      record.lockRing.position.copy(record.mesh.position);
      record.lockRing.quaternion.copy(context.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.1;
      record.lockRing.scale.setScalar(record.kind === 'boss' ? 1.65 : 1);
    }
  }

  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i];
    const age = elapsedNow - spark.born;
    if (age >= spark.life) {
      spark.mesh.removeFromParent();
      sparks.splice(i, 1);
      continue;
    }
    spark.mesh.position.addScaledVector(spark.velocity, dt);
    spark.velocity.y -= dt * 3.5;
    spark.mesh.scale.setScalar(Math.max(0.02, 1 - age / spark.life));
    spark.mesh.quaternion.copy(context.camera.quaternion);
  }

  for (const object of [...context.scene.children]) {
    if (!object.userData.effectRing) continue;
    const age = elapsedNow - Number(object.userData.born ?? 0);
    const life = Number(object.userData.life ?? 0.4);
    if (age >= life) {
      object.removeFromParent();
      disposeObject3D(object);
      continue;
    }
    const t = age / life;
    object.quaternion.copy(context.camera.quaternion);
    object.scale.setScalar(0.2 + t * Number(object.userData.maxScale ?? 2));
    const mesh = object as Mesh;
    if (mesh.material instanceof MeshBasicMaterial) mesh.material.opacity = (1 - t) ** 1.4;
  }

  if (recovery) {
    const age = elapsedNow - recovery.born;
    const t = Math.min(1, age / 3.1);
    recoveryLocal.set(-1 + t * 4.8, 0.5 + Math.sin(t * Math.PI) * 3.5 - t * 2.8, -10 + t * 4.2).applyQuaternion(context.camera.quaternion);
    recovery.mesh.position.copy(context.camera.position).add(recoveryLocal);
    recovery.mesh.quaternion.copy(context.camera.quaternion);
    recovery.mesh.rotation.z += dt * (1 - t) * 5.5;
    recovery.mesh.scale.setScalar(Math.min(1.5, 0.05 + age * 2.4));
    if (t < 1 && Math.floor(age * 14) % 3 === 0) burst(recovery.mesh.position, PURSE_BLUE, 1, 1.4, 0.18);
  }
}

export function disposeVisuals() {
  recovery?.mesh.removeFromParent();
  recovery = null;
  for (const spark of sparks) spark.mesh.removeFromParent();
  sparks.length = 0;
  records.clear({ dispose: true, pending: true });
  projectileRecords.clear({ dispose: true, pending: true });
  disposePurseEnvironment(environment);
  environment = null;
  currentScene = null;
  currentFeel = null;
}
