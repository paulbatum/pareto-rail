import {
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { AMBER, CHROME, HOT_PINK, PURSE_BLUE, TAIL_RED, VIOLET, WHITE, hdr } from './palette';

const dark = (color = 0x15131a) => new MeshLambertMaterial({ color, flatShading: true });
const glow = (color = AMBER, intensity = 1.2) => createAdditiveBasicMaterial({ color: hdr(color, intensity), side: DoubleSide });

function bikeWheel(radius: number, thick: number) {
  const group = new Group();
  const tire = new Mesh(new TorusGeometry(radius, thick, 7, 20), dark(0x09090d));
  const rim = new Mesh(new TorusGeometry(radius * 0.72, thick * 0.34, 5, 18), glow(CHROME, 1.05));
  group.add(tire, rim);
  return group;
}

function rider(accent: number, lean: number, heavy = false) {
  const root = new Group();
  const torso = new Mesh(new CapsuleGeometry(heavy ? 0.34 : 0.27, heavy ? 0.72 : 0.62, 4, 8), dark(accent));
  torso.rotation.z = lean;
  torso.position.y = 0.45;
  const helmet = new Mesh(new SphereGeometry(heavy ? 0.34 : 0.29, 10, 7), dark(0x202029));
  helmet.position.set(-Math.sin(lean) * 0.52, 1.05, 0);
  const visor = new Mesh(new BoxGeometry(0.36, 0.095, 0.08), glow(HOT_PINK, 1.2));
  visor.position.set(helmet.position.x, 1.08, 0.27);
  root.add(torso, helmet, visor);
  return root;
}

function baseBike(options: { accent: number; wheel: number; length: number; heavy?: boolean; lean?: number }) {
  const root = new Group();
  const wheelLeft = bikeWheel(options.wheel, options.heavy ? 0.105 : 0.075);
  const wheelRight = bikeWheel(options.wheel, options.heavy ? 0.105 : 0.075);
  wheelLeft.position.set(-options.length * 0.43, -0.52, 0);
  wheelRight.position.set(options.length * 0.43, -0.52, 0);
  const frame = new Mesh(new BoxGeometry(options.length * 0.7, options.heavy ? 0.42 : 0.3, 0.38), dark(options.accent));
  frame.position.y = -0.18;
  frame.rotation.z = -0.04;
  const tank = new Mesh(new SphereGeometry(options.heavy ? 0.48 : 0.36, 9, 6), dark(options.accent));
  tank.scale.set(1.25, 0.72, 0.86);
  tank.position.set(-0.08, 0.06, 0);
  const fork = new Mesh(new BoxGeometry(0.08, 0.95, 0.08), glow(CHROME, 0.9));
  fork.position.set(options.length * 0.36, -0.06, 0);
  fork.rotation.z = -0.3;
  const tail = new Mesh(new BoxGeometry(0.34, 0.12, 0.15), glow(TAIL_RED, 1.8));
  tail.position.set(-options.length * 0.47, -0.04, 0.24);
  root.add(wheelLeft, wheelRight, frame, tank, fork, tail, rider(options.accent, options.lean ?? -0.18, options.heavy));
  return root;
}

export function createScoutBike() {
  const root = baseBike({ accent: 0xc65a18, wheel: 0.37, length: 2.05, lean: -0.24 });
  const pennant = new Mesh(new ConeGeometry(0.24, 0.8, 3), glow(AMBER, 1.15));
  pennant.rotation.z = Math.PI / 2;
  pennant.position.set(-1.2, 0.55, 0);
  root.add(pennant);
  return root;
}

export function createSwooperBike() {
  const root = baseBike({ accent: 0x66193f, wheel: 0.34, length: 2.2, lean: -0.62 });
  const fairing = new Mesh(new ConeGeometry(0.48, 1.25, 5), dark(0xb91f66));
  fairing.rotation.z = -Math.PI / 2;
  fairing.position.set(0.58, -0.02, 0);
  const fins = new Mesh(new BoxGeometry(1.35, 0.08, 0.72), glow(HOT_PINK, 0.95));
  fins.position.set(0.1, -0.08, 0);
  root.add(fairing, fins);
  return root;
}

export function createBruiserBike() {
  const root = baseBike({ accent: 0x3e293b, wheel: 0.48, length: 2.6, heavy: true, lean: 0.05 });
  for (const x of [-0.72, 0.72]) {
    const pannier = new Mesh(new BoxGeometry(0.62, 0.62, 0.72), dark(0x33293a));
    pannier.position.set(x, -0.12, -0.18);
    root.add(pannier);
  }
  const crashBar = new Mesh(new TorusGeometry(0.9, 0.06, 6, 20, Math.PI), glow(VIOLET, 1.1));
  crashBar.position.y = -0.1;
  root.add(crashBar);
  return root;
}

export function createPurse(detached = false) {
  const root = new Group();
  const bag = new Mesh(new BoxGeometry(detached ? 0.9 : 0.7, detached ? 0.65 : 0.52, 0.24), new MeshLambertMaterial({ color: PURSE_BLUE, flatShading: true }));
  bag.geometry.rotateZ(-0.08);
  const clasp = new Mesh(new BoxGeometry(0.17, 0.12, 0.08), glow(PURSE_BLUE, 1.9));
  clasp.position.set(0, 0.07, 0.17);
  const strap = new Mesh(new TorusGeometry(detached ? 0.63 : 0.52, 0.035, 5, 24, Math.PI), glow(PURSE_BLUE, 1.35));
  strap.position.y = 0.26;
  root.add(bag, clasp, strap);
  root.userData.isPurse = true;
  return root;
}

export function createBossBike() {
  const root = baseBike({ accent: 0x1a171e, wheel: 0.58, length: 3.25, heavy: true, lean: -0.08 });
  const engine = new Mesh(new IcosahedronGeometry(0.62, 1), glow(CHROME, 1.05));
  engine.scale.set(1.3, 0.8, 0.9);
  engine.position.set(0, -0.05, 0);
  const cowling = new Mesh(new BoxGeometry(2.2, 0.16, 0.85), dark(0x09090d));
  cowling.position.y = 0.25;
  for (const x of [-1.08, 1.08]) {
    const pipe = new Mesh(new CylinderGeometry(0.09, 0.13, 1.15, 8), glow(AMBER, 1.05));
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(x, -0.1, -0.42);
    root.add(pipe);
  }
  const purse = createPurse();
  purse.position.set(-0.56, 0.84, 0.48);
  purse.rotation.z = -0.38;
  root.add(engine, cowling, purse);
  root.scale.setScalar(1.25);
  root.userData.purse = purse;
  return root;
}

export function createBomb() {
  const root = new Group();
  const body = new Mesh(new IcosahedronGeometry(0.55, 1), dark(0x161219));
  const bandA = new Mesh(new TorusGeometry(0.61, 0.055, 6, 20), glow(TAIL_RED, 1.65));
  const bandB = bandA.clone();
  bandB.rotation.x = Math.PI / 2;
  const fuse = new Mesh(new ConeGeometry(0.13, 0.6, 5), glow(AMBER, 1.4));
  fuse.position.y = 0.66;
  root.add(body, bandA, bandB, fuse);
  return root;
}

export function createSpikeCluster() {
  const root = new Group();
  for (let i = 0; i < 7; i += 1) {
    const spike = new Mesh(new ConeGeometry(0.17, 0.9 + (i % 3) * 0.16, 4), dark(i % 2 ? 0x2b2730 : 0x4a4047));
    const angle = (i / 7) * Math.PI * 2;
    spike.position.set(Math.cos(angle) * 0.42, 0.15, Math.sin(angle) * 0.42);
    spike.rotation.z = Math.cos(angle) * 0.42;
    spike.rotation.x = Math.sin(angle) * 0.42;
    root.add(spike);
  }
  const warning = new Mesh(new RingGeometry(0.72, 0.79, 12), glow(TAIL_RED, 1.35));
  warning.rotation.x = Math.PI / 2;
  root.add(warning);
  return root;
}

export function createLetterMesh(character: string) {
  const root = new Group();
  const plate = new Mesh(new BoxGeometry(1.75, 2.25, 0.16), dark(0x17131c));
  const border = new Mesh(new RingGeometry(1.03, 1.09, 4), glow(AMBER, 1.05));
  border.scale.y = 1.28;
  border.rotation.z = Math.PI / 4;
  root.add(plate, border);
  const cellGeometry = new CircleGeometry(0.095, 8);
  for (const cell of glyphOnCells(character)) {
    const lamp = new Mesh(cellGeometry, glow(WHITE, 1.25));
    lamp.position.set((cell.x - 2) * 0.27, (3 - cell.y) * 0.27, 0.12);
    root.add(lamp);
  }
  root.userData.isLetter = true;
  return root;
}

export function createPlayerProjectile() {
  const root = new Group();
  const core = new Mesh(new OctahedronGeometry(0.18, 0), glow(WHITE, 2));
  core.scale.set(0.75, 0.75, 4.2);
  const ring = new Mesh(new RingGeometry(0.32, 0.38, 6), glow(HOT_PINK, 1.2));
  root.add(core, ring);
  return root;
}

export function createCarFlank() {
  const root = new Group();
  const door = new Mesh(new BoxGeometry(6.8, 2.25, 0.48), new MeshLambertMaterial({ color: 0xb52947, flatShading: true }));
  door.position.set(1.5, -0.6, 0);
  door.rotation.z = -0.035;
  const belt = new Mesh(new BoxGeometry(6.6, 0.1, 0.08), glow(CHROME, 0.85));
  belt.position.set(1.45, 0.44, 0.29);
  const window = new Mesh(new BoxGeometry(3.3, 1.18, 0.08), new MeshBasicMaterial({ color: 0x171324, transparent: true, opacity: 0.78 }));
  window.position.set(0.6, 1.08, 0.04);
  const mirrorStem = new Mesh(new CylinderGeometry(0.055, 0.065, 0.75, 8), glow(CHROME, 0.8));
  mirrorStem.position.set(-2.3, 0.58, 0.15);
  mirrorStem.rotation.z = -0.75;
  const mirror = new Mesh(new SphereGeometry(0.52, 12, 8), dark(0x34323d));
  mirror.scale.set(1.45, 0.65, 0.28);
  mirror.position.set(-2.62, 0.85, 0.2);
  const mirrorGlass = new Mesh(new CircleGeometry(0.42, 16), new MeshBasicMaterial({ color: 0x5a435f, side: DoubleSide }));
  mirrorGlass.scale.set(1.4, 0.62, 1);
  mirrorGlass.position.set(-2.62, 0.85, 0.36);
  const hand = new Mesh(new CapsuleGeometry(0.15, 0.65, 4, 8), dark(0xd28b62));
  hand.position.set(-0.25, 1.75, 0.25);
  hand.rotation.z = -0.55;
  root.add(door, belt, window, mirrorStem, mirror, mirrorGlass, hand);
  root.userData.raildIgnoreOcclusion = true;
  return root;
}
