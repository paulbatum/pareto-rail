import {
  BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial,
  OctahedronGeometry, PlaneGeometry, RingGeometry, TorusGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ALERT_RED, AMBER, EDGE, GUNMETAL, HEAT, hdr, PLATE, PLAYER, WHITE } from './palette';

const dark = () => new MeshBasicMaterial({ color: GUNMETAL });
const armor = () => new MeshBasicMaterial({ color: PLATE });
const edge = () => new MeshBasicMaterial({ color: EDGE });

export function createWatcherMesh() {
  const root = new Group();
  const body = new Mesh(new OctahedronGeometry(0.85, 0), armor()); body.scale.set(1.5, 0.55, 1.1); root.add(body);
  for (const side of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(1.7, 0.08, 0.8), dark()); wing.position.x = side * 1.2; wing.rotation.z = side * -0.18; root.add(wing);
    const eye = new Mesh(new BoxGeometry(0.13, 0.12, 0.35), new MeshBasicMaterial({ color: hdr(ALERT_RED, 1.8) })); eye.position.set(side * 0.42, 0, 0.78); root.add(eye);
  }
  root.userData.accent = ALERT_RED; return root;
}

export function createSkaterMesh() {
  const root = new Group();
  const hull = new Mesh(new ConeGeometry(0.65, 3.5, 4), armor()); hull.rotation.x = Math.PI / 2; root.add(hull);
  const blade = new Mesh(new BoxGeometry(5.2, 0.08, 0.55), dark()); root.add(blade);
  for (const side of [-1, 1]) { const lamp = new Mesh(new BoxGeometry(0.16, 0.12, 0.5), new MeshBasicMaterial({ color: hdr(AMBER, 1.4) })); lamp.position.x = side * 2.25; root.add(lamp); }
  root.userData.accent = AMBER; return root;
}

export function createSentryMesh() {
  const root = new Group();
  const base = new Mesh(new CylinderGeometry(1.25, 1.5, 0.7, 8), dark()); root.add(base);
  const head = new Mesh(new BoxGeometry(2.2, 1.2, 1.5), armor()); head.position.y = 1; root.add(head);
  for (const x of [-0.65, 0.65]) { const barrel = new Mesh(new CylinderGeometry(0.13, 0.2, 3.6, 8), edge()); barrel.rotation.x = Math.PI / 2; barrel.position.set(x, 1, 2); root.add(barrel); }
  const slit = new Mesh(new BoxGeometry(0.9, 0.13, 0.06), new MeshBasicMaterial({ color: hdr(ALERT_RED, 1.7) })); slit.position.set(0, 1.1, 0.78); root.add(slit);
  root.userData.accent = ALERT_RED; return root;
}

export function createShellMesh() {
  const root = new Group();
  const core = new Mesh(new OctahedronGeometry(0.42, 0), new MeshBasicMaterial({ color: hdr(HEAT, 2) })); core.scale.z = 2.4; root.add(core);
  const ring = new Mesh(new TorusGeometry(0.65, 0.055, 6, 18), createAdditiveBasicMaterial({ color: hdr(ALERT_RED, 1.2), opacity: 0.8 })); ring.rotation.x = Math.PI / 2; root.add(ring);
  root.userData.accent = HEAT; return root;
}

export function createTurretMesh() {
  const root = new Group();
  const pedestal = new Mesh(new CylinderGeometry(6.8, 8.2, 3.4, 12), dark()); root.add(pedestal);
  const housing = new Mesh(new BoxGeometry(11, 5.2, 8), armor()); housing.position.y = 3.2; root.add(housing);
  const shutters = new Group();
  for (const side of [-1, 1]) { const shutter = new Mesh(new BoxGeometry(4.5, 0.45, 5.2), dark()); shutter.position.set(side * 2.45, 5.9, 0); shutters.add(shutter); }
  root.add(shutters); root.userData.shutters = shutters;
  const core = new Mesh(new CylinderGeometry(1.75, 1.75, 0.75, 16), new MeshBasicMaterial({ color: hdr(HEAT, 0.85) })); core.rotation.x = Math.PI / 2; core.position.set(0, 5.2, 4.2); root.add(core); root.userData.core = core;
  const barrels = new Group();
  for (const x of [-2.4, 0, 2.4]) { const barrel = new Mesh(new CylinderGeometry(0.48, 0.65, 14, 10), dark()); barrel.rotation.x = Math.PI / 2; barrel.position.set(x, 4.4, 10); barrels.add(barrel); }
  root.add(barrels); root.userData.barrels = barrels; root.userData.accent = AMBER; return root;
}

export function updateTurretMesh(root: Group, time: number) {
  const venting = Boolean(root.userData.venting);
  const shutters = root.userData.shutters as Group;
  shutters.children.forEach((child, index) => { child.rotation.z = (index === 0 ? 1 : -1) * (venting ? 0.5 : 0.03); });
  const core = root.userData.core as Mesh;
  (core.material as MeshBasicMaterial).color.copy(hdr(venting ? HEAT : ALERT_RED, venting ? 1.45 + Math.sin(time * 9) * 0.2 : 0.62));
  const barrels = root.userData.barrels as Group; barrels.position.z = venting ? -1.6 : Math.sin(time * 2) * 0.25;
}

export function createLetterMesh(character: string) {
  const root = new Group();
  const cells = glyphOnCells(character);
  const geometry = new BoxGeometry(0.26, 0.26, 0.12);
  const fill = new MeshBasicMaterial({ color: WHITE });
  for (const cell of cells) { const block = new Mesh(geometry, fill); block.position.set((cell.x - 2) * 0.31, (3 - cell.y) * 0.31, 0); root.add(block); }
  const plate = new Mesh(new PlaneGeometry(1.9, 2.55), new MeshBasicMaterial({ color: GUNMETAL, side: DoubleSide })); plate.position.z = -0.1; root.add(plate);
  const frame = new Mesh(new RingGeometry(1.36, 1.42, 4), new MeshBasicMaterial({ color: AMBER, side: DoubleSide })); frame.scale.y = 1.3; frame.rotation.z = Math.PI / 4; frame.position.z = 0.04; root.add(frame);
  root.userData.isLetter = true; return root;
}

export function createPlayerProjectile() {
  const root = new Group();
  const dart = new Mesh(new OctahedronGeometry(0.3, 0), new MeshBasicMaterial({ color: hdr(PLAYER, 2.2) })); dart.scale.set(0.6, 0.6, 2.5); root.add(dart); return root;
}
