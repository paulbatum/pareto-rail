import {
  BoxGeometry, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera, RingGeometry, Scene, Vector3,
} from 'three';
import { colorForLockCount } from '../../../engine/locks';
import { createAdditiveBasicMaterial, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import type { HullRunCvs3EnemyKind } from '../gameplay';
import { createHullEnvironment, updateHullEnvironment, type HullEnvironment } from './environment';
import {
  createLetterMesh, createPlayerProjectile, createSentryMesh, createShellMesh, createSkaterMesh,
  createTurretMesh, createWatcherMesh, updateTurretMesh,
} from './models';
import { ALERT_RED, AMBER, EDGE, GUNMETAL, HEAT, hdr, PLAYER, WHITE } from './palette';

type EnemyRecord = { mesh: Group; born: number; lockRing: Group | null };
type Spark = { mesh: Mesh; velocity: Vector3; born: number; life: number; baseScale: number };
let environment: HullEnvironment | null = null;
let currentScene: Scene | null = null;
let elapsedNow = 0;
let beatPulse = 0;
const sparks: Spark[] = [];
const sparkGeometry = new BoxGeometry(0.1, 0.1, 0.55);
const sparkMaterials = new Map<number, MeshBasicMaterial>();

function disposeObject(root: Object3D) {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

const records = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, born: elapsedNow, lockRing: null }),
  disposeRecord(record) { if (record.lockRing) { record.lockRing.removeFromParent(); disposeObject(record.lockRing); } disposeObject(record.mesh); },
});
const projectileRecords = createPendingVisualRecords<Group, Group>({ createRecord: (mesh) => mesh, disposeRecord: disposeObject });

export function createEnvironment(scene: Scene) {
  currentScene = scene; environment = createHullEnvironment(scene); return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  switch (kind as HullRunCvs3EnemyKind | 'letter') {
    case 'letter': mesh = createLetterMesh(letter ?? 'A'); break;
    case 'watcher': mesh = createWatcherMesh(); break;
    case 'skater': mesh = createSkaterMesh(); break;
    case 'sentry': mesh = createSentryMesh(); break;
    case 'shell': mesh = createShellMesh(); break;
    case 'turret': mesh = createTurretMesh(); break;
    default: mesh = createWatcherMesh();
  }
  mesh.userData.kind = kind; mesh.scale.setScalar(0.001); records.enqueue(mesh); return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  mesh.traverse((child) => { if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) child.material.wireframe = locked && !mesh.userData.isLetter; });
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  burst(mesh.position, ALERT_RED, 7, 4.5, 0.3);
}

export function createProjectileMesh() {
  const mesh = createPlayerProjectile(); projectileRecords.enqueue(mesh); return mesh;
}

export function createReticle() {
  const root = new Group(); const parts: MeshBasicMaterial[] = [];
  const add = (geometry: RingGeometry | BoxGeometry | CircleGeometry, color: Color) => {
    const material = createAdditiveBasicMaterial({ color, opacity: 0.9, side: DoubleSide }); parts.push(material);
    const mesh = new Mesh(geometry, material); root.add(mesh); return mesh;
  };
  add(new RingGeometry(0.54, 0.59, 32), hdr(PLAYER, 1.25));
  for (let i = 0; i < 4; i += 1) { const tick = add(new BoxGeometry(0.24, 0.035, 0.02), hdr(WHITE, 1.1)); const a = i * Math.PI / 2; tick.position.set(Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0); tick.rotation.z = a; }
  add(new CircleGeometry(0.035, 10), hdr(WHITE, 1.8)); root.userData.parts = parts; root.userData.active = false; return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active; reticle.scale.setScalar(1 + lockCount * 0.065 + (active ? 0.06 : 0));
  const colors = [PLAYER, PLAYER, WHITE, AMBER, AMBER, HEAT];
  const color = lockCount ? colorForLockCount(lockCount, colors) : PLAYER;
  for (const material of reticle.userData.parts as MeshBasicMaterial[]) material.color.copy(hdr(color, active ? 1.55 : 1));
}

function lockBracket(color: Color) {
  const root = new Group(); const material = createAdditiveBasicMaterial({ color: hdr(color, 1.3), opacity: 0.82 });
  for (let i = 0; i < 4; i += 1) { const corner = new Mesh(new RingGeometry(1.35, 1.43, 4, 1, 0, Math.PI / 2), material); corner.rotation.z = i * Math.PI / 2 + Math.PI / 4; root.add(corner); }
  return root;
}

function burst(position: Vector3, color: Color, count: number, speed: number, life = 0.45) {
  if (!currentScene) return;
  for (let i = 0; i < count; i += 1) {
    const key = color.getHex();
    let material = sparkMaterials.get(key);
    if (!material) { material = createAdditiveBasicMaterial({ color: hdr(color, 1.25), opacity: 0.85 }); sparkMaterials.set(key, material); }
    const mesh = new Mesh(sparkGeometry, material);
    mesh.position.copy(position); const velocity = new Vector3(Math.sin(i * 12.91), Math.cos(i * 7.13), Math.sin(i * 4.77 + 1)).normalize().multiplyScalar(speed * (0.45 + (i % 5) / 5));
    currentScene.add(mesh); sparks.push({ mesh, velocity, born: elapsedNow, life, baseScale: 1 });
  }
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = records.claim(enemyId); if (!record) return; record.born = elapsedNow;
    if (kind === 'turret') burst(worldPosition, AMBER, 28, 9, 0.9);
    else if (kind !== 'shell') burst(worldPosition, kind === 'sentry' ? ALERT_RED : AMBER, 5, 3, 0.35);
  });
  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = records.get(enemyId); if (record && !record.lockRing && currentScene) { record.lockRing = lockBracket(colorForLockCount(lockCount, [PLAYER, WHITE, AMBER, HEAT])); currentScene.add(record.lockRing); }
    burst(worldPosition, PLAYER, 3, 2.2, 0.2);
  });
  bus.on('unlock', ({ enemyId }) => { const record = records.get(enemyId); if (record?.lockRing) { record.lockRing.removeFromParent(); record.lockRing = null; } });
  bus.on('fire', ({ projectileId, worldPosition }) => { projectileRecords.claim(projectileId); burst(worldPosition, PLAYER, 4, 4, 0.16); });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true }); burst(worldPosition, lethal ? AMBER : WHITE, lethal ? 13 : 6, lethal ? 8 : 4, lethal ? 0.65 : 0.28);
    const record = records.get(enemyId); if (record) record.mesh.userData.flashUntil = elapsedNow + 0.16;
  });
  bus.on('stage', ({ enemyId, worldPosition }) => { burst(worldPosition, HEAT, 22, 11, 0.8); const record = records.get(enemyId); if (record) record.mesh.userData.stageKick = elapsedNow; });
  bus.on('kill', ({ enemyId, worldPosition }) => { burst(worldPosition, HEAT, 18, 12, 0.75); records.delete(enemyId, { dispose: true }); });
  bus.on('miss', ({ enemyId, worldPosition }) => { burst(worldPosition, ALERT_RED, 4, 2.5, 0.3); records.delete(enemyId, { dispose: true }); });
  bus.on('reject', () => { beatPulse = -0.8; });
  bus.on('beat', ({ isDownbeat }) => { beatPulse = isDownbeat ? 1 : 0.45; });
  bus.on('playerhit', () => { beatPulse = -1.2; });
  bus.on('runstart', () => { beatPulse = 0; });
}

export function updateVisuals(dt: number, context: { scene: Scene; camera: PerspectiveCamera; elapsed: number; runTime: number; runProgress: number; running: boolean }) {
  elapsedNow = context.elapsed; beatPulse *= Math.exp(-dt * 7);
  if (environment) updateHullEnvironment(environment, context.runProgress, context.elapsed, context.running);
  for (const record of records.values()) {
    const intro = Math.min(1, Math.max(0.001, (elapsedNow - record.born) * 5));
    const denied = record.mesh.userData.deniedUntil > elapsedNow; record.mesh.scale.setScalar(intro * (denied ? 0.78 + Math.sin(elapsedNow * 35) * 0.12 : 1));
    if (record.mesh.userData.kind === 'turret') updateTurretMesh(record.mesh, elapsedNow);
    if (record.lockRing) { record.lockRing.position.copy(record.mesh.position); record.lockRing.quaternion.copy(context.camera.quaternion); record.lockRing.rotation.z += dt * 1.5; }
    const flash = record.mesh.userData.flashUntil > elapsedNow;
    record.mesh.traverse((child) => { if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) child.material.opacity = flash ? 0.62 : 1; });
  }
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i]; const age = elapsedNow - spark.born;
    if (age >= spark.life) { spark.mesh.removeFromParent(); sparks.splice(i, 1); continue; }
    spark.mesh.position.addScaledVector(spark.velocity, dt); spark.velocity.y -= dt * 5; spark.mesh.scale.setScalar(Math.max(0.02, 1 - age / spark.life)); spark.mesh.quaternion.copy(context.camera.quaternion);
  }
}

export function disposeVisuals() {
  for (const spark of sparks) spark.mesh.removeFromParent(); sparks.length = 0; records.clear({ dispose: true, pending: true }); projectileRecords.clear({ dispose: true, pending: true }); environment = null; currentScene = null;
}
