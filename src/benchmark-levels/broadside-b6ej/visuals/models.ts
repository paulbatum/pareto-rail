import {
  BoxGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh,
  MeshBasicMaterial, OctahedronGeometry, PlaneGeometry, RingGeometry, SphereGeometry, TorusGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CRIMSON, CYAN, ENEMY_HULL, ENEMY_PLATE, FRIENDLY_EDGE, GOLD, hdr, ORANGE, WHITE,
} from './palette';

const enemy = () => new MeshBasicMaterial({ color: ENEMY_HULL });
const plate = () => new MeshBasicMaterial({ color: ENEMY_PLATE });
const orange = (power = 1) => new MeshBasicMaterial({ color: hdr(ORANGE, power) });

export function createInterceptorMesh() {
  const root = new Group();
  const nose = new Mesh(new ConeGeometry(0.48, 3.2, 4), plate()); nose.rotation.x = Math.PI / 2; root.add(nose);
  for (const side of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(2.9, 0.09, 1.25), enemy()); wing.position.set(side * 1.35, 0, -0.15); wing.rotation.z = side * 0.16; root.add(wing);
    const slash = new Mesh(new BoxGeometry(1.8, 0.05, 0.16), orange(1.3)); slash.position.set(side * 1.35, 0.06, 0.1); root.add(slash);
  }
  const engine = new Mesh(new CircleGeometry(0.26, 12), orange(1.9)); engine.position.z = -1.7; engine.rotation.y = Math.PI; root.add(engine);
  root.userData.accent = ORANGE; return root;
}

export function createSpiralMesh() {
  const root = new Group();
  const core = new Mesh(new OctahedronGeometry(0.72, 0), plate()); core.scale.z = 1.5; root.add(core);
  for (let i = 0; i < 3; i += 1) {
    const arm = new Mesh(new BoxGeometry(0.22, 3.9, 0.16), enemy()); arm.rotation.z = i * Math.PI * 2 / 3; root.add(arm);
    const tip = new Mesh(new SphereGeometry(0.2, 8, 6), orange(1.5)); tip.position.set(Math.cos(i * Math.PI * 2 / 3) * 1.8, Math.sin(i * Math.PI * 2 / 3) * 1.8, 0); root.add(tip);
  }
  const ring = new Mesh(new TorusGeometry(1.05, 0.07, 6, 24), createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.2), opacity: 0.75 })); root.add(ring);
  root.userData.accent = CRIMSON; return root;
}

export function createBomberMesh() {
  const root = new Group();
  const hull = new Mesh(new IcosahedronGeometry(1.05, 0), plate()); hull.scale.set(1.9, 0.85, 2.2); root.add(hull);
  for (const side of [-1, 1]) {
    const pod = new Mesh(new CylinderGeometry(0.42, 0.62, 2.6, 8), enemy()); pod.rotation.x = Math.PI / 2; pod.position.set(side * 1.65, -0.15, 0); root.add(pod);
    const engine = new Mesh(new CircleGeometry(0.26, 10), orange(1.8)); engine.position.set(side * 1.65, -0.15, -1.35); engine.rotation.y = Math.PI; root.add(engine);
  }
  const stripe = new Mesh(new BoxGeometry(3.8, 0.08, 0.16), orange(1.2)); stripe.position.y = 0.58; root.add(stripe);
  root.userData.accent = ORANGE; return root;
}

export function createEscortMesh() {
  const root = createInterceptorMesh(); root.scale.set(0.82, 0.82, 1.12);
  const crown = new Mesh(new RingGeometry(0.72, 0.82, 6), new MeshBasicMaterial({ color: hdr(CRIMSON, 1.6), side: DoubleSide })); crown.position.z = 0.55; root.add(crown);
  root.userData.accent = CRIMSON; return root;
}

export function createTurretMesh() {
  const root = new Group();
  const base = new Mesh(new CylinderGeometry(1.3, 1.65, 0.65, 8), enemy()); root.add(base);
  const housing = new Mesh(new BoxGeometry(2.5, 1.25, 1.75), plate()); housing.position.y = 0.8; root.add(housing);
  for (const x of [-0.58, 0.58]) { const barrel = new Mesh(new CylinderGeometry(0.13, 0.2, 3.5, 7), enemy()); barrel.rotation.x = Math.PI / 2; barrel.position.set(x, 1, 2); root.add(barrel); }
  const slit = new Mesh(new BoxGeometry(1, 0.12, 0.08), orange(1.7)); slit.position.set(0, 0.92, 0.92); root.add(slit);
  root.userData.accent = ORANGE; return root;
}

export function createShieldMesh() {
  const root = new Group();
  const housing = new Mesh(new CylinderGeometry(1.35, 1.8, 1.6, 8), enemy()); housing.rotation.x = Math.PI / 2; root.add(housing);
  const iris = new Mesh(new RingGeometry(0.42, 1.25, 12), new MeshBasicMaterial({ color: ENEMY_PLATE, side: DoubleSide })); iris.position.z = 0.86; root.add(iris);
  const core = new Mesh(new SphereGeometry(0.42, 14, 10), orange(1.8)); core.position.z = 0.9; root.add(core); root.userData.core = core;
  const halo = new Mesh(new TorusGeometry(1.8, 0.08, 8, 32), createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.25), opacity: 0.78 })); halo.position.z = 0.55; root.add(halo); root.userData.halo = halo;
  for (let i = 0; i < 4; i += 1) { const fin = new Mesh(new BoxGeometry(0.28, 2.7, 0.18), enemy()); fin.rotation.z = i * Math.PI / 2; root.add(fin); }
  root.userData.accent = CRIMSON; return root;
}

export function createCoreMesh() {
  const root = new Group();
  for (let i = 0; i < 3; i += 1) {
    const cage = new Mesh(new TorusGeometry(1.35 + i * 0.23, 0.09, 7, 28), new MeshBasicMaterial({ color: i === 1 ? ENEMY_PLATE : ORANGE }));
    cage.rotation.set(i === 0 ? Math.PI / 2 : 0, i === 2 ? Math.PI / 2 : 0, i * 0.4); root.add(cage);
  }
  const core = new Mesh(new IcosahedronGeometry(0.72, 1), orange(0.65)); root.add(core); root.userData.core = core;
  const capA = new Mesh(new ConeGeometry(0.65, 2.6, 8), enemy()); capA.position.z = -1.5; capA.rotation.x = -Math.PI / 2; root.add(capA);
  const capB = capA.clone(); capB.position.z = 1.5; capB.rotation.x = Math.PI / 2; root.add(capB);
  root.userData.accent = ORANGE; return root;
}

export function createFlakMesh() {
  const root = new Group();
  const bolt = new Mesh(new OctahedronGeometry(0.42, 0), new MeshBasicMaterial({ color: hdr(CRIMSON, 2) })); bolt.scale.z = 2.8; root.add(bolt);
  const ring = new Mesh(new TorusGeometry(0.72, 0.06, 6, 18), createAdditiveBasicMaterial({ color: hdr(ORANGE, 1.2), opacity: 0.78 })); ring.rotation.x = Math.PI / 2; root.add(ring);
  root.userData.accent = CRIMSON; return root;
}

export function updateSpecialMesh(root: Group, time: number) {
  if (root.userData.halo) (root.userData.halo as Mesh).rotation.z = time * 1.35;
  if (root.userData.core) {
    const core = root.userData.core as Mesh; const armed = root.userData.armed !== false;
    (core.material as MeshBasicMaterial).color.copy(hdr(armed ? ORANGE : ENEMY_PLATE, armed ? 1.1 + Math.sin(time * 8) * 0.28 : 0.7));
    core.scale.setScalar(1 + (armed ? Math.sin(time * 9) * 0.08 : 0));
  }
}

export function createLetterMesh(character: string) {
  const root = new Group(); const cells = glyphOnCells(character);
  const cellGeometry = new BoxGeometry(0.23, 0.23, 0.12); const fill = new MeshBasicMaterial({ color: FRIENDLY_EDGE });
  for (const cell of cells) { const block = new Mesh(cellGeometry, fill); block.position.set((cell.x - 2) * 0.29, (3 - cell.y) * 0.29, 0); root.add(block); }
  const plateMesh = new Mesh(new PlaneGeometry(1.75, 2.4), new MeshBasicMaterial({ color: 0x10222c, side: DoubleSide })); plateMesh.position.z = -0.11; root.add(plateMesh);
  const frame = new Mesh(new RingGeometry(1.23, 1.31, 6), new MeshBasicMaterial({ color: CYAN, side: DoubleSide })); frame.scale.y = 1.22; frame.rotation.z = Math.PI / 6; frame.position.z = 0.04; root.add(frame);
  for (const side of [-1, 1]) { const lamp = new Mesh(new SphereGeometry(0.08, 7, 5), new MeshBasicMaterial({ color: hdr(GOLD, 1.35) })); lamp.position.set(side * 0.95, -1.05, 0.08); root.add(lamp); }
  root.userData.isLetter = true; root.userData.accent = CYAN; return root;
}

export function createPlayerProjectile() {
  const root = new Group();
  const lance = new Mesh(new OctahedronGeometry(0.28, 0), new MeshBasicMaterial({ color: hdr(CYAN, 2.1) })); lance.scale.set(0.6, 0.6, 3.2); root.add(lance);
  const trail = new Mesh(new ConeGeometry(0.28, 2.4, 8), createAdditiveBasicMaterial({ color: hdr(WHITE, 1.25), opacity: 0.65 })); trail.rotation.x = -Math.PI / 2; trail.position.z = -1.1; root.add(trail);
  return root;
}
