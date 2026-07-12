import { AdditiveBlending, BoxGeometry, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, RingGeometry, Scene, SphereGeometry, TorusGeometry, Vector3, WireframeGeometry } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { createDownpourOu7eRail } from '../gameplay';

const CYAN = new Color(0.05, 0.7, 1.25), PINK = new Color(1.1, 0.08, 0.45), ACID = new Color(0.55, 1.5, 0.08), INK = new Color(0.004, 0.008, 0.02);
const glow = (color: Color) => new MeshBasicMaterial({ color, transparent: true, blending: AdditiveBlending, depthWrite: false });
let root: Group | null = null; let beat = 0; const flashes: Array<{ mesh: Mesh; life: number }> = [];
const rain: LineSegments[] = [];

export function createEnvironment(scene: Scene) {
  root?.removeFromParent(); root = new Group(); scene.background = INK;
  const rail = createDownpourOu7eRail();
  rain.length = 0;
  for (let i = 0; i < 92; i++) {
    const u = i / 91, p = rail.getPointAt(u); const side = i % 2 ? -1 : 1;
    const tower = new Mesh(new BoxGeometry(8 + (i % 5) * 3, 28 + (i % 7) * 9, 5), new MeshBasicMaterial({ color: new Color(0.008, 0.014, 0.035) }));
    tower.position.set(p.x + side * (18 + (i % 4) * 7), p.y + 5, p.z); tower.raycast = () => {}; root.add(tower);
    if (i % 2 === 0) { const sign = new Mesh(new PlaneGeometry(4, 1.2), glow(i % 6 === 0 ? PINK : CYAN)); sign.position.copy(tower.position).add(new Vector3(-side * 4, (i % 5) * 3, -2.7)); sign.raycast = () => {}; root.add(sign); }
  }
  // Near architecture changes its grammar with the route: open girders, avenue
  // skyways, ribbed undercity, a moonlit canal, then the citadel's hard gate.
  for (let i = 0; i < 28; i++) { const u = (i + 8) / 45; const p = rail.getPointAt(Math.min(u, 0.62)); const girder = new LineSegments(new WireframeGeometry(new BoxGeometry(22, 13, 1)), new LineBasicMaterial({ color: i < 12 ? CYAN : PINK, transparent: true, opacity: 0.38 })); girder.position.copy(p); girder.raycast = () => {}; root.add(girder); }
  for (let i = 0; i < 18; i++) { const p = rail.getPointAt(0.48 + i / 65); const train = new Mesh(new BoxGeometry(9, 2.5, 16), new MeshBasicMaterial({ color: new Color(0.015, 0.025, 0.06) })); train.position.copy(p).add(new Vector3(i % 2 ? 14 : -14, 5, 0)); train.raycast = () => {}; root.add(train); }
  const water = new Mesh(new PlaneGeometry(55, 250), new MeshBasicMaterial({ color: new Color(0.01, 0.09, 0.15), transparent: true, opacity: 0.72 })); water.rotation.x = -Math.PI / 2; water.position.set(0, -28, -760); water.raycast = () => {}; root.add(water);
  const citadel = new Mesh(new BoxGeometry(42, 30, 7), new MeshBasicMaterial({ color: new Color(0.025, 0.06, 0.02) })); citadel.position.copy(rail.getPointAt(0.9)).add(new Vector3(0, 10, -10)); citadel.raycast = () => {}; root.add(citadel);
  // Thin rain streaks remain readable with bloom disabled.
  const rainMat = new LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.32 });
  for (let i = 0; i < 170; i++) { const g = new WireframeGeometry(new BoxGeometry(0.025, 2 + (i % 4), 0.025)); const streak = new LineSegments(g, rainMat); streak.position.set(((i * 17) % 60) - 30, ((i * 13) % 30) - 8, -((i * 29) % 1050)); streak.raycast = () => {}; root.add(streak); rain.push(streak); }
  scene.add(root);
}

export function updateVisuals(dt: number) { beat = Math.max(0, beat - dt * 2.4); for (const streak of rain) { streak.position.y -= dt * 28; if (streak.position.y < -22) streak.position.y += 32; } for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.life -= dt; f.mesh.scale.multiplyScalar(1 + dt * 7); (f.mesh.material as MeshBasicMaterial).opacity = Math.max(0, f.life * 2); if (f.life <= 0) { f.mesh.removeFromParent(); flashes.splice(i, 1); } } }
export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  const burst = (position: Vector3, color: Color) => { const mesh = new Mesh(new RingGeometry(0.35, 0.48, 16), glow(color)); mesh.position.copy(position); scene.add(mesh); flashes.push({ mesh, life: 0.45 }); };
  bus.on('beat', ({ isDownbeat, beatNumber }) => { beat = isDownbeat ? 1 : 0.35; if (isDownbeat && beatNumber % 16 === 0) burst(new Vector3(0, 18, -130), CYAN); });
  bus.on('spawn', ({ worldPosition }) => burst(worldPosition, CYAN));
  bus.on('lock', ({ worldPosition }) => burst(worldPosition, PINK));
  bus.on('unlock', ({ worldPosition }) => burst(worldPosition, CYAN));
  bus.on('fire', ({ worldPosition }) => burst(worldPosition, CYAN));
  bus.on('kill', ({ worldPosition }) => burst(worldPosition, PINK)); bus.on('hit', ({ worldPosition }) => burst(worldPosition, PINK));
  bus.on('miss', ({ worldPosition }) => burst(worldPosition, CYAN)); bus.on('reject', () => { beat = 1; });
}

export function createEnemyMesh(kind: string, letter?: string) {
  if (kind === 'letter') return createLetterMesh(letter ?? 'A');
  const g = new Group(); const accent = kind === 'gunship' ? ACID : kind === 'turret' ? PINK : CYAN;
  const wire = new LineSegments(new WireframeGeometry(kind === 'gunship' ? new BoxGeometry(2.8, 0.8, 1.2) : new SphereGeometry(kind === 'turret' ? 1 : 0.72, 7, 5)), new LineBasicMaterial({ color: accent })); g.add(wire);
  const core = new Mesh(new SphereGeometry(kind === 'gunship' ? 0.42 : 0.2, 8, 6), glow(accent)); g.add(core);
  if (kind === 'skater') { const wing = new Mesh(new PlaneGeometry(2.4, 0.12), glow(accent)); wing.rotation.z = 0.28; g.add(wing); }
  if (kind === 'gunship') for (const x of [-1, 1]) { const wing = new Mesh(new PlaneGeometry(2.5, 0.16), glow(ACID)); wing.position.x = x * 1.5; g.add(wing); }
  return g;
}
export function setEnemyLocked(mesh: Object3D, locked: boolean) { mesh.userData.locked = locked; mesh.scale.multiplyScalar(locked ? 1.13 : 1 / 1.13); }
export function setEnemyDenied(mesh: Object3D) { mesh.rotation.z += Math.PI / 3; }
export function createProjectileMesh() { return new Mesh(new SphereGeometry(0.12, 7, 5), glow(CYAN)); }
export function createReticle() { return new Mesh(new RingGeometry(0.45, 0.52, 24), glow(CYAN)); }
export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) { reticle.scale.setScalar(1 + lockCount * 0.08 + (active ? 0.13 : 0)); }
function createLetterMesh(char: string) { const g = new Group(); const mat = glow(CYAN); const cell = new BoxGeometry(0.22, 0.22, 0.05); for (const c of glyphOnCells(char)) { const m = new Mesh(cell, mat); m.position.set((c.x - 2) * 0.28, (3 - c.y) * 0.28, 0); g.add(m); } g.add(new Mesh(new TorusGeometry(1.05, 0.025, 6, 24), glow(PINK))); return g; }
