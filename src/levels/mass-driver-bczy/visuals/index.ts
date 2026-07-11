import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, PlaneGeometry, RingGeometry, Scene, TorusGeometry, Vector3 } from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../../events';
import { colorForLockCount } from '../../../engine/locks';
import { sampleRailFrame } from '../../../engine/rail';
import { createAdditiveBasicMaterial, createPendingVisualRecords, createTransientEffectPool, disposeObject3D } from '../../../engine/visual-kit';
import { createMassDriverBczyRail, MASS_DRIVER_BCZY_BPM, MASS_DRIVER_BCZY_RUN_DURATION, massDriverRunProgress } from '../gameplay';

const BLUE = new Color(0.08, 0.42, 1.0);
const VIOLET = new Color(0.58, 0.16, 1.0);
const WHITE = new Color(0.72, 0.9, 1.0);
const HOT = new Color(1.35, 1.25, 1.65);
const RED = new Color(1.0, 0.12, 0.32);
const hdr = (color: Color, n: number) => color.clone().multiplyScalar(n);
type EnemyRecord = { mesh: Group; born: number };
type Effect = { mesh: Mesh; age: number; life: number; color: Color; scale: number };
const enemies = createPendingVisualRecords<Group, EnemyRecord, [number]>({ createRecord: (mesh, born) => ({ mesh, born }) });
const projectiles = createPendingVisualRecords<Group, Group>({ createRecord: (mesh) => mesh });
const effects = createTransientEffectPool<Effect, { scene: Scene; camera: Camera }>({
  update(item, p, _dt, ctx) { item.mesh.quaternion.copy(ctx.camera.quaternion); item.mesh.scale.setScalar(item.scale * (0.25 + p * 1.9)); (item.mesh.material as MeshBasicMaterial).color.copy(item.color).multiplyScalar((1 - p) ** 1.8); },
  dispose(item, ctx) { ctx.scene.remove(item.mesh); item.mesh.geometry.dispose(); (item.mesh.material as MeshBasicMaterial).dispose(); },
});
let root: Group | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let launchState: 'idle' | 'armed' | 'launch' | 'failure' = 'idle';
let interlocksClear = false;

export function createEnvironment(scene: Scene) {
  root?.removeFromParent(); if (root) disposeObject3D(root);
  root = new Group(); scene.background = new Color(0.002, 0.004, 0.018); scene.add(root);
  const rail = createMassDriverBczyRail();
  const beatSeconds = 60 / MASS_DRIVER_BCZY_BPM;
  // Precisely one accelerating coil per beat. Ring positions derive from exactly
  // the runner's integral speed easing, so spatial spacing opens with the pulse.
  for (let beat = 0; beat < 128; beat += 1) {
    const t = beat * beatSeconds;
    const frame = sampleRailFrame(rail, massDriverRunProgress(t));
    const color = beat < 48 ? BLUE : beat < 96 ? VIOLET : WHITE;
    const ring = new Mesh(new TorusGeometry(10.5 + Math.min(3, beat / 40), 0.06, 6, 36), createAdditiveBasicMaterial({ color: hdr(color, 0.72 + beat / 220) }));
    ring.position.copy(frame.position);
    ring.lookAt(frame.position.clone().add(frame.tangent));
    ring.userData.beat = beat;
    root.add(ring);
    if (beat % 4 === 0) {
      const inner = new Mesh(new TorusGeometry(6.2, 0.025, 4, 24), createAdditiveBasicMaterial({ color: hdr(color, 0.36) }));
      inner.position.copy(frame.position); inner.lookAt(frame.position.clone().add(frame.tangent)); root.add(inner);
    }
  }
  // Sparse rail conductors keep the machine legible with bloom disabled.
  for (const side of [-1, 1]) {
    const points: Vector3[] = [];
    for (let i = 0; i <= 80; i += 1) { const f = sampleRailFrame(rail, i / 80); points.push(f.position.addScaledVector(f.right, side * 7.4)); }
    const geom = new BufferGeometry().setFromPoints(points);
    root.add(new Line(geom, new LineBasicMaterial({ color: hdr(BLUE, 0.48), transparent: true, blending: AdditiveBlending, depthWrite: false })));
  }
  return root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' ? createGlyph(letter ?? 'A') : createDrone(kind);
  mesh.scale.setScalar(0.001); enemies.enqueue(mesh); return mesh;
}

function material(color: Color, strength: number) { return createAdditiveBasicMaterial({ color: hdr(color, strength), side: DoubleSide }); }
function createDrone(kind: string) {
  const group = new Group();
  const accent = kind === 'skimmer' ? BLUE : kind === 'coilguard' ? VIOLET : WHITE;
  const edge = material(accent, 1.55); const core = material(WHITE, 2.1);
  if (kind === 'skimmer') {
    const body = new Mesh(new OctahedronGeometry(0.55, 0), edge); body.scale.set(2.2, 0.45, 0.65); group.add(body);
    for (const x of [-1.1, 1.1]) { const fin = new Mesh(new PlaneGeometry(1.5, 0.12), edge.clone()); fin.position.x = x; fin.rotation.z = x * 0.35; group.add(fin); }
  } else if (kind === 'coilguard') {
    group.add(new Mesh(new OctahedronGeometry(0.58, 1), core));
    for (let i = 0; i < 3; i += 1) { const torus = new Mesh(new TorusGeometry(0.92 + i * 0.22, 0.035, 5, 28), edge.clone()); torus.rotation.set(i * 0.55, i * 0.9, 0); group.add(torus); }
  } else {
    const slab = new Mesh(new PlaneGeometry(1.6, 2.2), edge); group.add(slab);
    for (const y of [-0.68, 0, 0.68]) { const bar = new Mesh(new PlaneGeometry(1.9, 0.08), core.clone()); bar.position.y = y; group.add(bar); }
    const lock = new Mesh(new RingGeometry(0.58, 0.7, 6), material(WHITE, 1.7)); lock.rotation.x = Math.PI / 2; group.add(lock);
  }
  group.userData.materials = group.children.map((child) => (child as Mesh).material).flat().filter((m): m is MeshBasicMaterial => m instanceof MeshBasicMaterial);
  group.userData.accent = accent; return group;
}

const GLYPHS: Record<string, string[]> = {
  S: ['01111','10000','10000','01110','00001','00001','11110'], T: ['11111','00100','00100','00100','00100','00100','00100'],
  A: ['01110','10001','10001','11111','10001','10001','10001'], R: ['11110','10001','10001','11110','10100','10010','10001'],
  E: ['11111','10000','10000','11110','10000','10000','11111'], P: ['11110','10001','10001','11110','10000','10000','10000'],
  L: ['10000','10000','10000','10000','10000','10000','11111'], Y: ['10001','10001','01010','00100','00100','00100','00100'],
};
function createGlyph(letter: string) {
  const group = new Group(); const glyph = GLYPHS[letter.toUpperCase()] ?? GLYPHS.A; const cell = 0.24;
  const fill = material(BLUE, 1.45); const hot = material(WHITE, 2.4);
  for (let y = 0; y < 7; y += 1) for (let x = 0; x < 5; x += 1) if (glyph[y][x] === '1') {
    const p = new Mesh(new PlaneGeometry(0.19, 0.19), fill); p.position.set((x - 2) * cell, (3 - y) * cell, 0);
    const c = new Mesh(new PlaneGeometry(0.065, 0.065), hot); c.position.copy(p.position); c.position.z = 0.01; group.add(p, c);
  }
  group.userData.materials = [fill, hot]; group.userData.accent = BLUE; return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, count?: number) {
  mesh.userData.locked = locked; tint(mesh, locked ? colorForLockCount(count ?? 1, [BLUE, VIOLET, WHITE]) : undefined);
}
export function setEnemyDenied(mesh: Object3D) { mesh.userData.deniedUntil = elapsedNow + 0.45; tint(mesh, RED); }
function tint(mesh: Object3D, color?: Color) { for (const m of (mesh.userData.materials as MeshBasicMaterial[] ?? [])) m.color.copy(color ? hdr(color, 2.3) : hdr(mesh.userData.accent as Color ?? BLUE, m === (mesh.userData.materials as MeshBasicMaterial[])[0] ? 1.55 : 2.0)); }

export function createProjectileMesh() { const g = new Group(); const core = new Mesh(new OctahedronGeometry(0.2, 0), material(WHITE, 2.8)); core.scale.z = 2.6; g.add(core, new Mesh(new RingGeometry(0.35, 0.4, 12), material(BLUE, 1.6))); projectiles.enqueue(g); return g; }
export function createReticle() { const g = new Group(); g.add(new Mesh(new RingGeometry(0.48, 0.54, 24), material(BLUE, 1.8)), new Mesh(new RingGeometry(0.77, 0.8, 12), material(VIOLET, 1.3))); return g; }
export function setReticleActive(reticle: Object3D, active: boolean, count: number) { reticle.scale.setScalar(1 + count * 0.075 + (active ? 0.1 : 0)); }

function flash(scene: Scene, position: Vector3, color: Color, scale: number, life: number) { const mesh = new Mesh(new RingGeometry(0.8, 0.9, 24), material(color, 1.8)); mesh.position.copy(position); scene.add(mesh); effects.add({ mesh, age: 0, life, color: hdr(color, 1.25), scale }); }
export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition }) => { enemies.claim(enemyId, elapsedNow); flash(scene, worldPosition, BLUE, 1.5, 0.25); });
  bus.on('lock', ({ worldPosition, lockCount }) => flash(scene, worldPosition, colorForLockCount(lockCount, [BLUE, VIOLET, WHITE]), 1.1, 0.18));
  bus.on('unlock', ({ worldPosition }) => flash(scene, worldPosition, VIOLET, 0.9, 0.14));
  bus.on('fire', ({ projectileId, worldPosition }) => { projectiles.claim(projectileId); flash(scene, worldPosition, WHITE, 1.0, 0.15); });
  bus.on('hit', ({ projectileId, worldPosition, lethal }) => { projectiles.delete(projectileId); flash(scene, worldPosition, lethal ? WHITE : VIOLET, lethal ? 3.2 : 1.8, 0.3); });
  bus.on('stage', ({ worldPosition }) => flash(scene, worldPosition, VIOLET, 4.2, 0.42));
  bus.on('kill', ({ enemyId, worldPosition }) => { enemies.delete(enemyId); flash(scene, worldPosition, HOT, 5.4, 0.55); });
  bus.on('miss', ({ enemyId, worldPosition }) => { enemies.delete(enemyId); flash(scene, worldPosition, RED, 2.2, 0.3); });
  bus.on('reject', ({ enemyIds, missingEnemyIds }) => { for (const id of [...enemyIds, ...(missingEnemyIds ?? [])]) { const record = enemies.get(id); if (record) flash(scene, record.mesh.position, RED, 2.8, 0.32); } });
  bus.on('beat', ({ isDownbeat }) => { beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.48); });
  bus.on('playerhit', () => flash(scene, new Vector3(0, 0, -5), RED, 12, 0.32));
  bus.on('runstart', () => {
    enemies.clear({ dispose: true, pending: true });
    projectiles.clear({ pending: true });
    launchState = 'armed';
    interlocksClear = false;
    if (root) root.visible = true;
    scene.background = new Color(0.002, 0.004, 0.018);
  });
  bus.on('bossphase', ({ phase }) => { if (phase === 'destroyed') interlocksClear = true; });
  bus.on('runend', ({ died }) => {
    launchState = !died && interlocksClear ? 'launch' : 'failure';
    flash(scene, new Vector3(0, 0, -8), launchState === 'launch' ? WHITE : RED, launchState === 'launch' ? 18 : 34, launchState === 'launch' ? 0.8 : 1.15);
    if (launchState === 'launch') {
      if (root) root.visible = false;
      scene.background = new Color(0.0002, 0.0003, 0.002);
    }
  });
}

export function updateVisuals(dt: number, context: { scene: Scene; camera: Camera; elapsed: number; runTime: number; running: boolean }) {
  elapsedNow = context.elapsed; beatEnergy = Math.max(0, beatEnergy - dt * 3.6);
  if (root) { root.rotation.z = Math.sin(context.elapsed * 0.25) * 0.015; root.children.forEach((item) => { if (item instanceof Mesh && item.geometry instanceof TorusGeometry) item.scale.setScalar(1 + beatEnergy * 0.025); }); }
  for (const record of enemies.values()) { const p = Math.min(1, (context.elapsed - record.born) / 0.22); const denied = (record.mesh.userData.deniedUntil as number ?? -1) > context.elapsed; record.mesh.scale.setScalar((p * p * (3 - 2 * p)) * (denied ? 1 + Math.sin(context.elapsed * 42) * 0.1 : 1)); if (!record.mesh.userData.locked && !denied) tint(record.mesh); record.mesh.children.forEach((child, i) => child.rotateZ(dt * (0.35 + i * 0.14))); }
  for (const projectile of projectiles.values()) projectile.rotateZ(dt * 10);
  effects.update(dt, context);
  if (launchState === 'launch' && root) root.scale.setScalar(1 + Math.max(0, context.runTime - 58.1) * 0.1);
  if (launchState === 'failure') context.scene.background = RED.clone().multiplyScalar(0.035 + Math.abs(Math.sin(context.elapsed * 28)) * 0.025);
}
