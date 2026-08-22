import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  TorusGeometry,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CRIMSON, CYAN, EMBER, FOE_HULL, GOLD, hdr, ICE, MAGENTA } from './palette';
import { SphereGeometry } from 'three';

// Enemy swarm craft and boss hardware. Everything is obsidian armor with a
// molten-orange read; crimson is reserved for weapons aimed at the player.
// Each mesh carries userData the gameplay/visual loops drive:
//   spin (generator rings, weaver gyro), pulse (conduits), shielded.

const hull = () => new MeshBasicMaterial({ color: FOE_HULL });
const plate = () => new MeshBasicMaterial({ color: 0x120b07 });

export function createDartMesh() {
  const root = new Group();
  const body = new Mesh(new ConeGeometry(0.42, 2.6, 4), plate());
  body.rotation.x = Math.PI / 2;
  root.add(body);
  for (const side of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(1.5, 0.07, 0.7), hull());
    wing.position.set(side * 0.75, -0.05, -0.5);
    wing.rotation.z = side * 0.28;
    root.add(wing);
    const tip = new Mesh(new BoxGeometry(0.12, 0.09, 0.3), new MeshBasicMaterial({ color: hdr(CRIMSON, 1.4) }));
    tip.position.set(side * 1.32, 0.14, -0.62);
    root.add(tip);
  }
  const engine = new Mesh(new OctahedronGeometry(0.26, 0), new MeshBasicMaterial({ color: hdr(EMBER, 2.1) }));
  engine.scale.set(0.8, 0.8, 1.6);
  engine.position.z = -1.35;
  root.add(engine);
  root.userData.accent = EMBER;
  return root;
}

export function createGunshipMesh() {
  const root = new Group();
  const deck = new Mesh(new BoxGeometry(3.4, 0.34, 1.9), hull());
  root.add(deck);
  const spine = new Mesh(new BoxGeometry(1.4, 0.4, 2.6), plate());
  spine.position.y = 0.22;
  root.add(spine);
  for (const side of [-1, 1]) {
    const prong = new Mesh(new BoxGeometry(0.24, 0.18, 2.1), plate());
    prong.position.set(side * 1.15, 0, 1.3);
    root.add(prong);
    const slit = new Mesh(new BoxGeometry(0.16, 0.08, 0.5), new MeshBasicMaterial({ color: hdr(CRIMSON, 1.7) }));
    slit.position.set(side * 1.15, 0.02, 2.1);
    root.add(slit);
  }
  const eye = new Mesh(new SphereGeometry(0.3, 10, 8), new MeshBasicMaterial({ color: hdr(EMBER, 1.9) }));
  eye.position.z = -0.4;
  root.add(eye);
  for (const side of [-1, 1]) {
    const engine = new Mesh(new BoxGeometry(0.2, 0.14, 0.7), new MeshBasicMaterial({ color: hdr(EMBER, 1.7) }));
    engine.position.set(side * 1.55, 0, -1.25);
    root.add(engine);
  }
  root.userData.accent = EMBER;
  return root;
}

export function createWeaverMesh() {
  const root = new Group();
  const ring = new Mesh(
    new TorusGeometry(0.95, 0.11, 8, 20),
    hull(),
  );
  root.add(ring);
  const gyro = new Mesh(
    new TorusGeometry(0.68, 0.09, 8, 18),
    new MeshBasicMaterial({ color: 0x18100a }),
  );
  gyro.rotation.x = Math.PI / 2;
  root.add(gyro);
  const spindle = new Mesh(new OctahedronGeometry(0.42, 0), new MeshBasicMaterial({ color: hdr(EMBER, 2.2) }));
  spindle.scale.set(0.7, 0.7, 2);
  root.add(spindle);
  const halo = new Mesh(
    new RingGeometry(1.06, 1.13, 24),
    createAdditiveBasicMaterial({ color: hdr(MAGENTA, 0.55), opacity: 0.7, side: DoubleSide }),
  );
  root.add(halo);
  root.userData.accent = EMBER;
  root.userData.gyro = gyro;
  return root;
}

// Belly turret of the enemy warship: a stalk reaching up to imply its mount
// on the hull above, an armored housing, twin barrels that track the player.
export function createBatteryMesh() {
  const root = new Group();
  const stalk = new Mesh(new CylinderGeometry(0.22, 0.4, 3.4, 8), hull());
  stalk.position.y = 1.7;
  root.add(stalk);
  const collar = new Mesh(new CylinderGeometry(0.85, 1.05, 0.6, 8), plate());
  collar.position.y = 0.45;
  root.add(collar);
  const dome = new Mesh(new SphereGeometry(1.05, 12, 9), plate());
  dome.position.y = -0.35;
  root.add(dome);
  for (const side of [-1, 1]) {
    const barrel = new Mesh(new CylinderGeometry(0.14, 0.2, 2.6, 8), hull());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(side * 0.48, -0.55, 1);
    root.add(barrel);
  }
  const lens = new Mesh(new BoxGeometry(0.7, 0.12, 0.1), new MeshBasicMaterial({ color: hdr(CRIMSON, 1.8) }));
  lens.position.set(0, -0.5, 0.92);
  root.add(lens);
  root.userData.accent = CRIMSON;
  return root;
}

// Point-defense emitter on the flagship: small box, single barrel, fast lens.
export function createPdTurretMesh() {
  const root = new Group();
  const base = new Mesh(new BoxGeometry(1.15, 0.75, 1.15), plate());
  root.add(base);
  const barrel = new Mesh(new CylinderGeometry(0.1, 0.14, 1.7, 8), hull());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.1, 0.9);
  root.add(barrel);
  const lens = new Mesh(new CircleGeometry(0.17, 10), new MeshBasicMaterial({ color: hdr(CRIMSON, 2) }));
  lens.position.set(0, 0.38, 0.59);
  lens.rotation.x = -0.5;
  root.add(lens);
  root.userData.accent = CRIMSON;
  return root;
}

// Shield generator: a hot magenta-gold orb caged in obsidian posts with two
// counter-rotating rings (driven by userData.spin from the visual loop).
export function createGeneratorMesh() {
  const root = new Group();
  const orb = new Mesh(new SphereGeometry(0.72, 14, 11), new MeshBasicMaterial({ color: hdr(MAGENTA, 1.5) }));
  root.add(orb);
  const core = new Mesh(new SphereGeometry(0.3, 10, 8), new MeshBasicMaterial({ color: hdr(GOLD, 2.4) }));
  root.add(core);
  for (let i = 0; i < 4; i += 1) {
    const post = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), hull());
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    post.position.set(Math.cos(angle) * 1.25, Math.sin(angle) * 1.25, 0);
    root.add(post);
  }
  const ringA = new Mesh(
    new RingGeometry(1.42, 1.52, 4, 1),
    createAdditiveBasicMaterial({ color: hdr(GOLD, 1.1), side: DoubleSide }),
  );
  const ringB = new Mesh(
    new RingGeometry(1.66, 1.71, 32),
    createAdditiveBasicMaterial({ color: hdr(MAGENTA, 0.8), side: DoubleSide }),
  );
  root.add(ringA, ringB);
  root.userData.rings = [ringA, ringB];
  root.userData.accent = MAGENTA;
  root.userData.lockRingScale = 1.4;
  return root;
}

// Power conduit in the trench: a bright plasma main between conductor plates.
export function createConduitMesh() {
  const root = new Group();
  const channel = new Mesh(new BoxGeometry(1.5, 0.5, 0.4), new MeshBasicMaterial({ color: hdr(GOLD, 2) }));
  root.add(channel);
  const plasma = new Mesh(
    new PlaneGeometry(2.1, 1),
    createAdditiveBasicMaterial({ color: hdr(GOLD, 0.9), side: DoubleSide }),
  );
  root.add(plasma);
  for (const side of [-1, 1]) {
    const clamp = new Mesh(new BoxGeometry(0.36, 1.15, 0.55), plate());
    clamp.position.x = side * 1.05;
    root.add(clamp);
  }
  const warning = new Mesh(new PlaneGeometry(0.9, 0.14), createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.1), side: DoubleSide }));
  warning.position.y = -0.75;
  root.add(warning);
  root.userData.plasma = plasma;
  root.userData.channel = channel;
  root.userData.accent = GOLD;
  root.userData.lockRingScale = 1.3;
  return root;
}

export function createBoltMesh() {
  const root = new Group();
  const core = new Mesh(new OctahedronGeometry(0.4, 0), new MeshBasicMaterial({ color: hdr(CRIMSON, 2.2) }));
  core.scale.set(0.55, 0.55, 2.3);
  root.add(core);
  const shell = new Mesh(
    new OctahedronGeometry(0.62, 0),
    createAdditiveBasicMaterial({ color: hdr(EMBER, 0.9), opacity: 0.55 }),
  );
  shell.scale.set(0.6, 0.6, 2);
  root.add(shell);
  root.userData.accent = CRIMSON;
  root.userData.isBolt = true;
  return root;
}

export function createPlayerProjectileMesh() {
  const group = new Group();
  const dart = new Mesh(new OctahedronGeometry(0.3, 0), new MeshBasicMaterial({ color: hdr(ICE, 2.4) }));
  dart.scale.set(0.55, 0.55, 2.6);
  group.add(dart);
  const trail = new Mesh(
    new PlaneGeometry(0.34, 1.6),
    createAdditiveBasicMaterial({ color: hdr(CYAN, 0.8), opacity: 0.6, side: DoubleSide }),
  );
  trail.position.z = -1.1;
  group.add(trail);
  return group;
}
