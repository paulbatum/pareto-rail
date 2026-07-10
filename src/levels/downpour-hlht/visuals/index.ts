import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Points, PointsMaterial, RingGeometry,
  Scene, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { createDownpourRail } from '../gameplay';

const INK = new Color(0.008, 0.014, 0.028);
const SLATE = new Color(0.045, 0.09, 0.15);
const CYAN = new Color(0.08, 0.9, 1.35);
const MAGENTA = new Color(1.2, 0.06, 0.72);
const AMBER = new Color(1.4, 0.38, 0.05);
const WHITE = new Color(1.5, 1.65, 1.8);
const ACID = new Color(0.42, 1.65, 0.1);
const hdr = (color: Color, amount: number) => color.clone().multiplyScalar(amount);

type EnemyRecord = { mesh: Group; locked: boolean; born: number };
type Burst = { mesh: Mesh; age: number; life: number; color: Color };
const pending: Group[] = [];
const records = new Map<number, EnemyRecord>();
const bursts: Burst[] = [];
let root: Group | null = null;
let elapsedNow = 0;
let lightning = 0;
let beatKick = 0;

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  scene.background = INK;
  root = new Group();
  const rail = createDownpourRail();
  const solid = new MeshBasicMaterial({ color: SLATE, transparent: true, opacity: 0.78 });
  const cyan = createAdditiveBasicMaterial({ color: hdr(CYAN, 0.8) });
  const magenta = createAdditiveBasicMaterial({ color: hdr(MAGENTA, 0.55) });
  const amber = createAdditiveBasicMaterial({ color: hdr(AMBER, 0.7) });
  const towerGeometry = new BoxGeometry(1, 1, 1);
  const windowGeometry = new BoxGeometry(0.11, 0.15, 0.02);
  // Tower faces are placed down the whole rail; their narrow window strips make the city read at bloom zero.
  for (let i = 0; i < 74; i += 1) {
    const u = i / 73;
    const p = rail.getPointAt(u);
    const side = i % 2 === 0 ? -1 : 1;
    const width = 10 + (i * 17) % 18;
    const height = 28 + (i * 31) % 85;
    const depth = 20 + (i * 11) % 30;
    const building = new Mesh(towerGeometry, solid);
    building.position.set(p.x + side * (48 + (i % 4) * 11), p.y + height * 0.34 - 26, p.z - ((i % 3) * 12));
    building.scale.set(width, height, depth);
    root.add(building);
    if (i % 2 === 0) {
      for (let row = 0; row < 4; row += 1) {
        const window = new Mesh(windowGeometry, i % 5 === 0 ? magenta : cyan);
        window.position.copy(building.position).add(new Vector3(-side * (width * 0.51), -height * 0.22 + row * height * 0.15, 0));
        window.scale.set(7, 1, 1);
        root.add(window);
      }
    }
  }
  // Under-city sodium arches and distant security skyways cross close to the camera line.
  for (let i = 0; i < 24; i += 1) {
    const u = 0.30 + i / 42;
    const p = rail.getPointAt(u);
    const beam = new Mesh(new BoxGeometry(34, 0.38, 0.55), i % 3 === 0 ? amber : cyan);
    beam.position.copy(p).add(new Vector3(0, 8 + (i % 3) * 3, -4));
    beam.rotation.z = (i % 2 ? 1 : -1) * 0.035;
    root.add(beam);
  }
  const rainGeometry = new BufferGeometry();
  const rain = new Float32Array(1100 * 3);
  for (let i = 0; i < 1100; i += 1) {
    rain[i * 3] = ((i * 43) % 100) - 50;
    rain[i * 3 + 1] = ((i * 71) % 70) - 25;
    rain[i * 3 + 2] = -((i * 29) % 130);
  }
  rainGeometry.setAttribute('position', new Float32BufferAttribute(rain, 3));
  const rainPoints = new Points(rainGeometry, new PointsMaterial({ color: hdr(WHITE, 0.5), size: 0.13, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }));
  rainPoints.userData.rain = rain;
  root.add(rainPoints);
  const canal = new Mesh(new PlaneGeometry(130, 980), createAdditiveBasicMaterial({ color: hdr(CYAN, 0.08), side: DoubleSide, opacity: 0.42 }));
  canal.rotation.x = -Math.PI / 2;
  canal.position.set(0, -327, -1780);
  root.add(canal);
  scene.add(root);
}

export function disposeEnvironment() {
  records.clear(); pending.length = 0; bursts.length = 0;
  if (root) { root.removeFromParent(); disposeObject3D(root); }
  root = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' ? createLetter(letter ?? 'A') : createHostile(kind);
  mesh.scale.setScalar(0.001);
  pending.push(mesh);
  return mesh;
}

function createHostile(kind: string) {
  const group = new Group();
  const accent = kind === 'gunship' ? ACID : kind === 'skiff' ? MAGENTA : kind === 'turret' ? WHITE : CYAN;
  const line = createAdditiveBasicMaterial({ color: hdr(accent, kind === 'gunship' ? 1.75 : 1.15) });
  const core = createAdditiveBasicMaterial({ color: hdr(WHITE, 1.6) });
  if (kind === 'drone') {
    group.add(new Mesh(new ConeGeometry(0.43, 1.35, 4), line));
    const wing = new Mesh(new BoxGeometry(1.75, 0.05, 0.22), line); wing.rotation.z = Math.PI / 4; group.add(wing);
  } else if (kind === 'turret') {
    group.add(new Mesh(new CylinderGeometry(0.55, 0.76, 0.32, 6), line));
    const cannon = new Mesh(new BoxGeometry(0.14, 0.14, 1.35), core); cannon.position.z = 0.55; group.add(cannon);
    group.add(new Mesh(new TorusGeometry(0.7, 0.035, 6, 24), line));
  } else if (kind === 'skiff') {
    const hull = new Mesh(new ConeGeometry(0.75, 2.2, 4), line); hull.rotation.x = Math.PI / 2; group.add(hull);
    const wake = new Mesh(new PlaneGeometry(0.08, 2.8), core); wake.position.z = 1.3; group.add(wake);
  } else {
    const body = new Mesh(new BoxGeometry(2.6, 0.65, 0.75), line); group.add(body);
    const wings = new Mesh(new BoxGeometry(5.5, 0.12, 0.35), line); group.add(wings);
    const eye = new Mesh(new RingGeometry(0.3, 0.44, 18), core); eye.position.z = 0.42; group.add(eye);
    for (let i = 0; i < 3; i += 1) { const ring = new Mesh(new TorusGeometry(0.85 + i * 0.24, 0.022, 5, 24), line.clone()); ring.rotation.z = i * 0.68; group.add(ring); }
  }
  group.userData.materials = [line, core];
  group.userData.accent = accent;
  return group;
}

function createLetter(character: string) {
  const group = new Group();
  const material = createAdditiveBasicMaterial({ color: hdr(CYAN, 1.45) });
  const cell = new BoxGeometry(0.24, 0.24, 0.1);
  for (const c of glyphOnCells(character)) {
    const block = new Mesh(cell, material); block.position.set((c.x - 2) * 0.31, (3 - c.y) * 0.31, 0); group.add(block);
  }
  group.add(new Mesh(new RingGeometry(0.94, 0.98, 32), material.clone()));
  group.userData.materials = [material]; group.userData.accent = CYAN;
  return group;
}

export function createProjectileMesh() { return new Mesh(new SphereGeometry(0.13, 8, 6), createAdditiveBasicMaterial({ color: hdr(CYAN, 2.2) })); }
export function createReticle() { return new Mesh(new RingGeometry(0.46, 0.52, 32), createAdditiveBasicMaterial({ color: hdr(CYAN, 1.6) })); }
export function setReticleActive(reticle: Object3D, active: boolean, locks: number) { reticle.visible = true; reticle.scale.setScalar(1 + locks * 0.06 + (active ? 0.09 : 0)); }
export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  const group = mesh as Group; const materials = group.userData.materials as MeshBasicMaterial[] | undefined;
  if (materials) for (const material of materials) material.color.copy(locked ? hdr(MAGENTA, 1.8) : hdr(group.userData.accent as Color, 1.25));
  mesh.scale.setScalar(locked ? 1.22 : 1);
}
export function setEnemyDenied(mesh: Object3D) { mesh.scale.setScalar(0.74); burst(mesh.position, AMBER, 0.28); }

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId }) => { const mesh = pending.shift(); if (!mesh) return; mesh.scale.setScalar(1); scene.add(mesh); records.set(enemyId, { mesh, locked: false, born: elapsedNow }); });
  bus.on('lock', ({ enemyId, lockCount }) => { const record = records.get(enemyId); if (record) { record.locked = true; setEnemyLocked(record.mesh, true); } burst(record?.mesh.position ?? new Vector3(), lockCount === 6 ? MAGENTA : CYAN, 0.18); });
  bus.on('unlock', ({ enemyId }) => { const record = records.get(enemyId); if (record) { record.locked = false; setEnemyLocked(record.mesh, false); } });
  bus.on('fire', ({ targetPosition }) => burst(targetPosition, CYAN, 0.22));
  bus.on('hit', ({ enemyId, worldPosition, lethal }) => { const record = records.get(enemyId); if (record && !lethal) record.mesh.scale.multiplyScalar(0.88); burst(worldPosition, lethal ? WHITE : MAGENTA, lethal ? 0.34 : 0.18); });
  const remove = ({ enemyId, worldPosition }: { enemyId: number; worldPosition: Vector3 }) => { const record = records.get(enemyId); if (record) { scene.remove(record.mesh); records.delete(enemyId); } burst(worldPosition, MAGENTA, 0.42); };
  bus.on('kill', remove); bus.on('miss', ({ enemyId, worldPosition }) => { const record = records.get(enemyId); if (record) { scene.remove(record.mesh); records.delete(enemyId); } burst(worldPosition, AMBER, 0.24); });
  bus.on('reject', () => { lightning = 0.22; });
  bus.on('beat', ({ isDownbeat }) => { if (isDownbeat) beatKick = 1; });
}

function burst(position: Vector3, color: Color, life: number) {
  if (!root) return;
  const ring = new Mesh(new RingGeometry(0.14, 0.2, 18), createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }));
  ring.position.copy(position); root.add(ring); bursts.push({ mesh: ring, age: 0, life, color });
}

export function updateVisuals(dt: number, context: { camera: Camera; elapsed: number; runTime: number; running: boolean }) {
  elapsedNow = context.elapsed; beatKick = Math.max(0, beatKick - dt * 4.5); lightning = Math.max(0, lightning - dt * 2.3);
  if (root) {
    const rain = root.children.find((child) => child instanceof Points) as Points | undefined;
    if (rain) { rain.position.copy(context.camera.position); rain.position.y += 8; (rain.material as PointsMaterial).opacity = 0.46 + beatKick * 0.18 + lightning * 0.32; }
  }
  for (const record of records.values()) {
    const pulse = record.locked ? 1 + Math.sin(context.elapsed * 18) * 0.08 : 1;
    record.mesh.scale.setScalar(pulse);
  }
  for (let i = bursts.length - 1; i >= 0; i -= 1) {
    const item = bursts[i]; item.age += dt; const p = item.age / item.life;
    item.mesh.quaternion.copy(context.camera.quaternion); item.mesh.scale.setScalar(0.4 + p * 5.2); (item.mesh.material as MeshBasicMaterial).opacity = (1 - p) * 0.9;
    if (p >= 1) { item.mesh.removeFromParent(); disposeObject3D(item.mesh); bursts.splice(i, 1); }
  }
}
