import {
  BoxGeometry, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera, RingGeometry, Scene, Vector3,
} from 'three';
import { colorForLockCount } from '../../../engine/locks';
import { createAdditiveBasicMaterial, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import type { BroadsideB6ejEnemyKind } from '../gameplay';
import { createBroadsideEnvironment, updateBroadsideEnvironment, type BroadsideEnvironment } from './environment';
import {
  createBomberMesh, createCoreMesh, createEscortMesh, createFlakMesh, createInterceptorMesh,
  createLetterMesh, createPlayerProjectile, createShieldMesh, createSpiralMesh, createTurretMesh, updateSpecialMesh,
} from './models';
import { CRIMSON, CYAN, GOLD, hdr, ORANGE, WHITE } from './palette';

type EnemyRecord = { mesh: Group; born: number; lockRing: Group | null };
type Spark = { mesh: Mesh; velocity: Vector3; born: number; life: number; spin: number };
type Wave = { mesh: Mesh; born: number; life: number; start: number; end: number };
let environment: BroadsideEnvironment | null = null; let currentScene: Scene | null = null; let elapsedNow = 0; let beatPulse = 0;
const sparks: Spark[] = []; const waves: Wave[] = [];
const sparkGeometry = new BoxGeometry(0.12, 0.12, 0.8); const sparkMaterials = new Map<number, MeshBasicMaterial>();

function disposeObject(root: Object3D) {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return; child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
  });
}

const records = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, born: elapsedNow, lockRing: null }),
  disposeRecord(record) { if (record.lockRing) { record.lockRing.removeFromParent(); disposeObject(record.lockRing); } disposeObject(record.mesh); },
});
const projectileRecords = createPendingVisualRecords<Group, Group>({ createRecord: (mesh) => mesh, disposeRecord: disposeObject });

export function createEnvironment(scene: Scene) { currentScene = scene; environment = createBroadsideEnvironment(scene); return environment.root; }

export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  switch (kind as BroadsideB6ejEnemyKind | 'letter') {
    case 'letter': mesh = createLetterMesh(letter ?? 'A'); break;
    case 'interceptor': mesh = createInterceptorMesh(); break;
    case 'spiral': mesh = createSpiralMesh(); break;
    case 'bomber': mesh = createBomberMesh(); break;
    case 'escort': mesh = createEscortMesh(); break;
    case 'turret': mesh = createTurretMesh(); break;
    case 'shield': mesh = createShieldMesh(); break;
    case 'core': mesh = createCoreMesh(); break;
    case 'flak': mesh = createFlakMesh(); break;
    default: mesh = createInterceptorMesh();
  }
  mesh.userData.kind = kind; mesh.scale.setScalar(0.001); records.enqueue(mesh); return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  mesh.traverse((child) => {
    if (child instanceof Mesh && child.material instanceof MeshBasicMaterial && !mesh.userData.isLetter) child.material.wireframe = locked;
  });
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.48; burst(mesh.position, CRIMSON, 8, 5.5, 0.35); shockwave(mesh.position, CRIMSON, 0.6, 4, 0.34);
}

export function createProjectileMesh() { const mesh = createPlayerProjectile(); projectileRecords.enqueue(mesh); return mesh; }

export function createReticle() {
  const root = new Group(); const parts: MeshBasicMaterial[] = [];
  const add = (geometry: RingGeometry | BoxGeometry | CircleGeometry, color: Color, opacity = 0.9) => {
    const material = createAdditiveBasicMaterial({ color, opacity, side: DoubleSide }); parts.push(material); const mesh = new Mesh(geometry, material); root.add(mesh); return mesh;
  };
  add(new RingGeometry(0.52, 0.58, 6), hdr(CYAN, 1.3));
  add(new RingGeometry(0.72, 0.75, 24), hdr(WHITE, 0.9), 0.65);
  for (let i = 0; i < 6; i += 1) { const tick = add(new BoxGeometry(0.22, 0.045, 0.02), hdr(GOLD, 1.1)); const a = i * Math.PI / 3; tick.position.set(Math.cos(a) * 0.84, Math.sin(a) * 0.84, 0); tick.rotation.z = a; }
  add(new CircleGeometry(0.035, 9), hdr(WHITE, 1.8)); root.userData.parts = parts; return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true; reticle.rotation.z = lockCount * Math.PI / 18; reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const color = lockCount ? colorForLockCount(lockCount, [CYAN, CYAN, WHITE, GOLD, ORANGE, CRIMSON]) : CYAN;
  for (const material of reticle.userData.parts as MeshBasicMaterial[]) material.color.copy(hdr(color, active ? 1.45 : 1));
}

function lockBracket(color: Color) {
  const root = new Group(); const material = createAdditiveBasicMaterial({ color: hdr(color, 1.35), opacity: 0.86 });
  for (let i = 0; i < 4; i += 1) { const corner = new Mesh(new RingGeometry(1.4, 1.5, 4, 1, 0, Math.PI / 2), material); corner.rotation.z = i * Math.PI / 2 + Math.PI / 4; root.add(corner); }
  for (const side of [-1, 1]) { const pip = new Mesh(new BoxGeometry(0.18, 0.18, 0.05), material); pip.position.x = side * 1.75; root.add(pip); }
  return root;
}

function burst(position: Vector3, color: Color, count: number, speed: number, life = 0.5) {
  if (!currentScene) return; const key = color.getHex(); let material = sparkMaterials.get(key);
  if (!material) { material = createAdditiveBasicMaterial({ color: hdr(color, 1.3), opacity: 0.9 }); sparkMaterials.set(key, material); }
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(sparkGeometry, material); mesh.position.copy(position);
    const velocity = new Vector3(Math.sin(i * 12.91 + elapsedNow), Math.cos(i * 7.13), Math.sin(i * 4.77 + 1)).normalize().multiplyScalar(speed * (0.35 + (i % 7) / 7));
    currentScene.add(mesh); sparks.push({ mesh, velocity, born: elapsedNow, life, spin: (i % 2 ? -1 : 1) * (2 + i * 0.1) });
  }
}

function shockwave(position: Vector3, color: Color, start = 0.4, end = 7, life = 0.55) {
  if (!currentScene) return;
  const mesh = new Mesh(new RingGeometry(0.88, 1, 32), createAdditiveBasicMaterial({ color: hdr(color, 1.3), opacity: 0.78, side: DoubleSide }));
  mesh.position.copy(position); mesh.scale.setScalar(start); currentScene.add(mesh); waves.push({ mesh, born: elapsedNow, life, start, end });
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = records.claim(enemyId); if (!record) return; record.born = elapsedNow;
    if (kind === 'shield' || kind === 'core') { burst(worldPosition, ORANGE, 18, 7, 0.75); shockwave(worldPosition, CRIMSON, 0.8, 8, 0.8); }
    else if (kind !== 'flak') burst(worldPosition, ORANGE, 5, 3.2, 0.32);
  });
  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = records.get(enemyId);
    if (record && !record.lockRing && currentScene) { record.lockRing = lockBracket(colorForLockCount(lockCount, [CYAN, WHITE, GOLD, ORANGE, CRIMSON])); currentScene.add(record.lockRing); }
    burst(worldPosition, CYAN, 3, 2.5, 0.2);
  });
  bus.on('unlock', ({ enemyId }) => { const record = records.get(enemyId); if (record?.lockRing) { record.lockRing.removeFromParent(); record.lockRing = null; } });
  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => { projectileRecords.claim(projectileId); burst(worldPosition, CYAN, 3 + volleySize, 5, 0.2); if (volleySize === 6) shockwave(worldPosition, CYAN, 0.4, 4, 0.35); });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true }); burst(worldPosition, lethal ? ORANGE : WHITE, lethal ? 16 : 7, lethal ? 9 : 4, lethal ? 0.7 : 0.3);
    if (lethal) shockwave(worldPosition, ORANGE, 0.5, 7, 0.55); const record = records.get(enemyId); if (record) record.mesh.userData.flashUntil = elapsedNow + 0.18;
  });
  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    burst(worldPosition, stageIndex > 0 ? CRIMSON : ORANGE, 25, 12, 0.9); shockwave(worldPosition, GOLD, 0.8, 10, 0.75);
    const record = records.get(enemyId); if (record) record.mesh.userData.stageKick = elapsedNow;
  });
  bus.on('kill', ({ enemyId, worldPosition }) => { burst(worldPosition, ORANGE, 22, 13, 0.82); shockwave(worldPosition, CRIMSON, 0.7, 11, 0.7); records.delete(enemyId, { dispose: true }); });
  bus.on('miss', ({ enemyId, worldPosition }) => { burst(worldPosition, CRIMSON, 5, 3, 0.32); records.delete(enemyId, { dispose: true }); });
  bus.on('reject', () => { beatPulse = -1; });
  bus.on('beat', ({ isDownbeat }) => { beatPulse = isDownbeat ? 1 : 0.42; });
  bus.on('playerhit', () => { beatPulse = -1.4; });
  bus.on('bossphase', ({ phase }) => { if (phase === 'exposed') { beatPulse = 1.8; if (environment) shockwave(environment.flagship.position, ORANGE, 4, 70, 1.4); } });
  bus.on('runstart', () => { beatPulse = 0; });
}

export function updateVisuals(dt: number, context: { camera: PerspectiveCamera; elapsed: number; runTime: number; running: boolean }) {
  elapsedNow = context.elapsed; beatPulse *= Math.exp(-dt * 7);
  if (environment) updateBroadsideEnvironment(environment, context.runTime, context.elapsed, context.running);
  for (const record of records.values()) {
    const intro = Math.min(1, Math.max(0.001, (elapsedNow - record.born) * 5)); const denied = record.mesh.userData.deniedUntil > elapsedNow;
    record.mesh.scale.setScalar(intro * (denied ? 0.78 + Math.sin(elapsedNow * 38) * 0.13 : 1)); updateSpecialMesh(record.mesh, elapsedNow);
    if (record.lockRing) { record.lockRing.position.copy(record.mesh.position); record.lockRing.quaternion.copy(context.camera.quaternion); record.lockRing.rotation.z += dt * 1.8; }
    const flash = record.mesh.userData.flashUntil > elapsedNow;
    record.mesh.traverse((child) => { if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) child.material.opacity = flash ? 0.6 : 1; });
  }
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i]; const age = elapsedNow - spark.born;
    if (age >= spark.life) { spark.mesh.removeFromParent(); sparks.splice(i, 1); continue; }
    spark.mesh.position.addScaledVector(spark.velocity, dt); spark.mesh.rotation.z += dt * spark.spin; spark.mesh.scale.setScalar(Math.max(0.02, 1 - age / spark.life)); spark.mesh.quaternion.copy(context.camera.quaternion);
  }
  for (let i = waves.length - 1; i >= 0; i -= 1) {
    const wave = waves[i]; const age = elapsedNow - wave.born;
    if (age >= wave.life) { wave.mesh.removeFromParent(); disposeObject(wave.mesh); waves.splice(i, 1); continue; }
    const t = age / wave.life; wave.mesh.scale.setScalar(wave.start + (wave.end - wave.start) * t); wave.mesh.quaternion.copy(context.camera.quaternion);
    if (wave.mesh.material instanceof MeshBasicMaterial) wave.mesh.material.opacity = (1 - t) * 0.78;
  }
}

export function disposeVisuals() {
  for (const spark of sparks) spark.mesh.removeFromParent(); sparks.length = 0;
  for (const wave of waves) { wave.mesh.removeFromParent(); disposeObject(wave.mesh); } waves.length = 0;
  records.clear({ dispose: true, pending: true }); projectileRecords.clear({ dispose: true, pending: true }); environment = null; currentScene = null;
}
