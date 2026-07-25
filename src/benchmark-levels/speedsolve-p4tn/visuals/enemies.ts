import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CAP_SIZE } from '../cube';
import { candyMaterial, graphiteMaterial, hotMaterial, machineMaterial } from './cube-view';
import { GRAPHITE, HOT_WHITE, MACHINE_DARK, MACHINE_WHITE, solveColor } from './palette';

// Leaf file: silhouettes. Four readable shapes — a flat square marker on the cube,
// a spun tetrahedron, a gimballed octahedron, a long triangular prism — plus the
// weakpoint piston and the core. Player optics are the only graphite-and-white
// things in the frame, so a shot never reads as a piece of the toy.

export function createFacetMarker(colorIndex: number) {
  const group = new Group();
  const size = CAP_SIZE + 1.05;

  // Hard graphite bracket: legible against candy plastic with bloom disabled.
  const bracketMaterial = graphiteMaterial();
  for (const [x, y] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const bar = new Mesh(
      new BoxGeometry(x === 0 ? size : 0.4, y === 0 ? size : 0.4, 0.34),
      bracketMaterial,
    );
    bar.position.set((x * size) / 2, (y * size) / 2, 0.5);
    group.add(bar);
  }

  // Hot inner ticks that pulse; these are the "active target" read.
  const tickMaterial = createAdditiveBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(2.1), opacity: 0.95 });
  const ticks: Mesh[] = [];
  for (let index = 0; index < 4; index += 1) {
    const tick = new Mesh(new PlaneGeometry(1.5, 0.28), tickMaterial);
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * size * 0.42, Math.sin(angle) * size * 0.42, 0.62);
    tick.rotation.z = angle;
    ticks.push(tick);
    group.add(tick);
  }

  const wash = new Mesh(
    new PlaneGeometry(size * 0.92, size * 0.92),
    createAdditiveBasicMaterial({ color: solveColor(colorIndex).clone().multiplyScalar(0.5), opacity: 0.55 }),
  );
  wash.position.z = 0.4;
  group.add(wash);

  group.userData.facetTicks = ticks;
  group.userData.facetWash = wash;
  group.userData.markMaterials = [tickMaterial, wash.material as MeshBasicMaterial];
  group.userData.accent = colorIndex;
  return group;
}

export function createTetra(colorIndex: number) {
  const group = new Group();
  const geometry = new TetrahedronGeometry(1.85, 0);
  const body = new Mesh(geometry, candyMaterial(colorIndex, 0.45));
  const edges = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: MACHINE_WHITE }));
  const spike = new Mesh(new ConeGeometry(0.4, 1.5, 4), hotMaterial(1.5));
  spike.position.z = -1.9;
  spike.rotation.x = -Math.PI / 2;
  group.add(body, edges, spike);
  group.userData.accent = colorIndex;
  return group;
}

export function createOcta(colorIndex: number) {
  const group = new Group();
  const geometry = new OctahedronGeometry(2.15, 0);
  const body = new Mesh(geometry, candyMaterial(colorIndex, 0.4));
  const edges = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: MACHINE_DARK }));
  // A gimbal of two rings: the "this one shoots back" tell, and a distinct
  // silhouette from every other polyhedron in the level.
  const gimbal = new Group();
  for (const [radius, axis] of [[2.8, 0], [2.35, 1]] as const) {
    const ring = new Mesh(new TorusGeometry(radius, 0.12, 6, 36), machineMaterial(0.35));
    if (axis === 1) ring.rotation.y = Math.PI / 2;
    else ring.rotation.x = Math.PI / 2;
    gimbal.add(ring);
  }
  const muzzle = new Mesh(new CylinderGeometry(0.32, 0.5, 1.4, 6), graphiteMaterial());
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = 2.1;
  const eye = new Mesh(new CircleGeometry(0.42, 12), hotMaterial(2.2));
  eye.position.z = 2.8;
  group.add(body, edges, gimbal, muzzle, eye);
  group.userData.gimbal = gimbal;
  group.userData.accent = colorIndex;
  return group;
}

export function createPrism(colorIndex: number) {
  const group = new Group();
  const geometry = new CylinderGeometry(1.4, 1.4, 5.2, 3, 1);
  const body = new Mesh(geometry, candyMaterial(colorIndex, 0.42));
  body.rotation.z = Math.PI / 2;
  const edges = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: MACHINE_WHITE }));
  edges.rotation.z = Math.PI / 2;
  const collar = new Mesh(new TorusGeometry(1.25, 0.14, 6, 20), machineMaterial(0.3));
  collar.rotation.y = Math.PI / 2;
  const tip = new Mesh(new CircleGeometry(0.5, 10), hotMaterial(1.8));
  tip.position.x = 2.7;
  tip.rotation.y = Math.PI / 2;
  group.add(body, edges, collar, tip);
  group.userData.accent = colorIndex;
  return group;
}

export function createBolt(colorIndex: number) {
  const group = new Group();
  const core = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), candyMaterial(colorIndex, 0.9));
  const halo = new Mesh(
    new RingGeometry(0.34, 0.46, 4),
    createAdditiveBasicMaterial({ color: solveColor(colorIndex).clone().multiplyScalar(1.05), side: DoubleSide, opacity: 0.5 }),
  );
  const spark = new Mesh(new BoxGeometry(0.17, 0.17, 0.17), hotMaterial(1.8));
  group.add(core, halo, spark);
  group.userData.accent = colorIndex;
  group.userData.boltHalo = halo;
  return group;
}

/** The machinery under a conquered face: a piston head over a white-hot vent. */
export function createWeakpoint() {
  const group = new Group();
  const head = new Mesh(new CylinderGeometry(2.1, 2.6, 1.5, 6), machineMaterial(0.28));
  head.rotation.x = Math.PI / 2;
  const collar = new Mesh(new TorusGeometry(2.9, 0.28, 6, 24), graphiteMaterial());
  const shaft = new Mesh(new CylinderGeometry(1.15, 1.15, 5.5, 8), graphiteMaterial());
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -2.6;
  const vent = new Mesh(new CircleGeometry(1.45, 16), hotMaterial(2.4));
  vent.position.z = 0.95;
  const glow = new Mesh(
    new RingGeometry(1.5, 3.1, 24),
    createAdditiveBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(1.2), side: DoubleSide, opacity: 0.75 }),
  );
  glow.position.z = 0.98;
  for (let index = 0; index < 3; index += 1) {
    const clamp = new Mesh(new BoxGeometry(0.6, 2.4, 0.6), graphiteMaterial());
    const angle = (index / 3) * Math.PI * 2;
    clamp.position.set(Math.cos(angle) * 2.9, Math.sin(angle) * 2.9, -0.4);
    clamp.rotation.z = angle;
    group.add(clamp);
  }
  group.add(head, collar, shaft, vent, glow);
  group.userData.weakVent = vent;
  group.userData.weakGlow = glow;
  return group;
}

/** The naked core: six candy facets caged in graphite around a white-hot centre. */
export function createCore() {
  const group = new Group();
  // The shell is a cage, not a skin: the white-hot heart has to show through it.
  const shellGeometry = new IcosahedronGeometry(6.4, 0);
  const shell = new LineSegments(
    new EdgesGeometry(shellGeometry),
    new LineBasicMaterial({ color: MACHINE_DARK }),
  );
  const ribs = new Mesh(shellGeometry, graphiteMaterial());
  ribs.scale.setScalar(0.34);
  const heart = new Mesh(new IcosahedronGeometry(3.1, 1), hotMaterial(1.55));
  const cage = new Group();
  for (let index = 0; index < 6; index += 1) {
    const plate = new Mesh(new BoxGeometry(3.4, 3.4, 0.5), candyMaterial(index, 0.6));
    const angle = (index / 6) * Math.PI * 2;
    const lift = index % 2 === 0 ? 3.2 : -3.2;
    plate.position.set(Math.cos(angle) * 6.6, lift, Math.sin(angle) * 6.6);
    plate.lookAt(0, 0, 0);
    cage.add(plate);
  }
  const halo = new Mesh(
    new TorusGeometry(10, 0.24, 6, 56),
    createAdditiveBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(1.5), opacity: 0.9 }),
  );
  halo.rotation.x = Math.PI / 2;
  const halo2 = new Mesh(
    new TorusGeometry(8.4, 0.17, 6, 56),
    createAdditiveBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(1.2), opacity: 0.8 }),
  );
  halo2.rotation.y = Math.PI / 2;
  group.add(shell, ribs, heart, cage, halo, halo2);
  group.userData.coreCage = cage;
  group.userData.coreHeart = heart;
  group.userData.coreHalos = [halo, halo2];
  return group;
}

/** The player's shot: graphite body, white-hot tip. Never a candy colour. */
export function createProjectile() {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(0.3, 0.3, 1.7), new MeshBasicMaterial({ color: GRAPHITE }));
  const tip = new Mesh(new BoxGeometry(0.42, 0.42, 0.42), hotMaterial(2.8));
  tip.position.z = 0.95;
  const wake = new Mesh(
    new PlaneGeometry(0.6, 3.4),
    createAdditiveBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(0.9), opacity: 0.5 }),
  );
  wake.position.z = -1.4;
  group.add(body, tip, wake);
  return group;
}

/** A six-pip solve timer: one pip lights per lock, so the reticle counts the volley. */
export function createSolveReticle() {
  const group = new Group();
  const frameMaterial = new MeshBasicMaterial({ color: GRAPHITE, side: DoubleSide });
  for (const [x, y] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const bar = new Mesh(
      new PlaneGeometry(x === 0 ? 1.7 : 0.1, y === 0 ? 1.7 : 0.1),
      frameMaterial,
    );
    bar.position.set(x * 0.85, y * 0.85, 0);
    group.add(bar);
  }
  const inner = new Mesh(new RingGeometry(0.25, 0.3, 4), frameMaterial);
  inner.rotation.z = Math.PI / 4;
  const dot = new Mesh(new CircleGeometry(0.055, 10), new MeshBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(2.2) }));

  const pips: Mesh[] = [];
  const pipMaterials: MeshBasicMaterial[] = [];
  for (let index = 0; index < 6; index += 1) {
    const material = new MeshBasicMaterial({ color: GRAPHITE, side: DoubleSide });
    const pip = new Mesh(new PlaneGeometry(0.19, 0.19), material);
    pip.position.set(-0.62 + (index % 3) * 0.62, index < 3 ? 1.16 : -1.16, 0);
    pips.push(pip);
    pipMaterials.push(material);
    group.add(pip);
  }

  group.add(inner, dot);
  group.userData.reticleFrame = frameMaterial;
  group.userData.reticlePips = pips;
  group.userData.reticlePipMaterials = pipMaterials;
  group.userData.reticleSpinner = inner;
  return group;
}
