import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { ChipSpec } from './effects';
import { randomUnit } from './effects';
import {
  CHASSIS_DARK,
  CHASSIS_LIGHT,
  CHASSIS_MID,
  HOT_ORANGE,
  HOT_WHITE,
  INK,
  MACHINE_DARK,
  SOLVE_COLORS,
  hdr,
  mulberry32,
} from './palette';

// Enemy construction. Hostiles are candy polyhedra — the cube's colors run
// loose — built as an ink outer shell with a saturated inner body so every
// silhouette carries a dark rim against the pale void. `parts` drives the
// shared tint pipeline (lock / deny / damage-flash) in visuals/index.

export type TintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'edge' | 'fill' | 'core';
};

function part(parts: TintPart[], mesh: Mesh, base: Color, kind: TintPart['kind']) {
  const material = mesh.material as MeshBasicMaterial;
  material.color.copy(base);
  parts.push({ material, base: base.clone(), kind });
  return mesh;
}

function shardSpecsFor(color: Color, count: number, rng: () => number, size = 0.35): ChipSpec[] {
  const specs: ChipSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    specs.push({ direction: randomUnit(rng), color: color.clone(), size: size * (0.7 + rng() * 0.6) });
  }
  return specs;
}

const assortment = { tetra: 0, octa: 0, prism: 0 };

function nextColor(kind: keyof typeof assortment, stride: number) {
  assortment[kind] = (assortment[kind] + stride) % SOLVE_COLORS.length;
  return SOLVE_COLORS[assortment[kind]];
}

// ---- solve square ----------------------------------------------------------------

// A solve square: a target-designator diamond floating proud of its tile. An
// ink diamond frame set 45° against the tile grid (so it can never camouflage
// into the cube's own squares), a white-hot lens at its heart, and colored
// pips on the frame corners. It takes its face color the moment gameplay
// stamps `faceIndex` on the mesh (see the tint pass in visuals/index).
export function createPanelMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const diamond = new Group();
  diamond.rotation.z = Math.PI / 4;
  const half = 2.45;
  for (const [w, h, x, y] of [
    [5.4, 0.55, 0, half],
    [5.4, 0.55, 0, -half],
    [0.55, 5.4, half, 0],
    [0.55, 5.4, -half, 0],
  ] as const) {
    const bar = new Mesh(new BoxGeometry(w, h, 0.5), new MeshBasicMaterial());
    bar.position.set(x, y, 0);
    diamond.add(part(parts, bar, INK.clone(), 'edge'));
  }

  for (const [x, y] of [[half, half], [-half, half], [half, -half], [-half, -half]] as const) {
    const pip = new Mesh(new BoxGeometry(0.85, 0.85, 0.8), new MeshBasicMaterial());
    pip.position.set(x, y, 0.12);
    diamond.add(part(parts, pip, hdr(HOT_WHITE, 1.4), 'fill'));
  }
  group.add(diamond);

  const lensGeometry = new OctahedronGeometry(1.05, 0);
  lensGeometry.scale(1, 1, 0.45);
  const lens = new Mesh(lensGeometry, new MeshBasicMaterial());
  lens.position.z = 0.2;
  group.add(part(parts, lens, hdr(HOT_WHITE, 1.7), 'core'));

  group.userData.parts = parts;
  group.userData.isPanel = true;
  group.userData.diamond = diamond;
  group.userData.lockRingScale = 2.2;
  group.userData.accent = HOT_WHITE.clone();
  group.userData.shardSpecs = shardSpecsFor(HOT_WHITE.clone(), 8, mulberry32(101), 0.4);
  return group;
}

// ---- weakpoint -------------------------------------------------------------------

// The machinery under a face: a white-hot piston heart in a grey collar. It
// emerges from the hatch socket and pumps on the half-beat.
export function createWeakpointMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const rng = mulberry32(77);

  const collar = new Mesh(new TorusGeometry(2.7, 0.55, 8, 24), new MeshBasicMaterial());
  group.add(part(parts, collar, MACHINE_DARK.clone(), 'fill'));

  const throatMesh = new Mesh(new CylinderGeometry(1.7, 2.1, 1.6, 12), new MeshBasicMaterial());
  throatMesh.rotation.x = Math.PI / 2;
  throatMesh.position.z = -0.6;
  group.add(part(parts, throatMesh, MACHINE_DARK.clone(), 'edge'));

  const heart = new Mesh(new OctahedronGeometry(2.0, 0), new MeshBasicMaterial());
  heart.position.z = 0.8;
  group.add(part(parts, heart, hdr(HOT_ORANGE, 1.7), 'core'));
  group.userData.heart = heart;

  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rod = new Mesh(new BoxGeometry(0.4, 0.4, 2.2), new MeshBasicMaterial());
    rod.position.set(Math.cos(angle) * 2.1, Math.sin(angle) * 2.1, -0.2);
    group.add(part(parts, rod, CHASSIS_DARK.clone(), 'edge'));
  }

  group.userData.parts = parts;
  group.userData.isWeakpoint = true;
  group.userData.lockRingScale = 2.2;
  group.userData.accent = HOT_ORANGE.clone();
  group.userData.shardSpecs = [
    ...shardSpecsFor(CHASSIS_MID.clone(), 6, rng, 0.4),
    ...shardSpecsFor(HOT_ORANGE.clone(), 5, rng, 0.3),
  ];
  return group;
}

// ---- wave polyhedra --------------------------------------------------------------

// Tetra: a spinning candy caltrop that dives across the face.
export function createTetraMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const color = nextColor('tetra', 1);
  const spinner = new Group();

  const shell = new Mesh(new TetrahedronGeometry(1.9, 0), new MeshBasicMaterial());
  spinner.add(part(parts, shell, INK.clone(), 'edge'));
  const body = new Mesh(new TetrahedronGeometry(1.5, 0), new MeshBasicMaterial());
  spinner.add(part(parts, body, color.clone(), 'fill'));
  const eye = new Mesh(new OctahedronGeometry(0.55, 0), new MeshBasicMaterial());
  spinner.add(part(parts, eye, hdr(HOT_WHITE, 1.35), 'core'));

  group.add(spinner);
  group.userData.spinner = spinner;
  group.userData.parts = parts;
  group.userData.lockRingScale = 1.5;
  group.userData.accent = color.clone();
  group.userData.shardSpecs = shardSpecsFor(color, 7, mulberry32(11 + assortment.tetra), 0.35);
  return group;
}

// Octa: an armored gunner that repositions in beat-quantized hops and returns
// fire. Two hits: the casing shears, then the core pops.
export function createOctaMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const color = nextColor('octa', 2);
  const spinner = new Group();

  const shell = new Mesh(new OctahedronGeometry(2.3, 0), new MeshBasicMaterial());
  spinner.add(part(parts, shell, INK.clone(), 'edge'));
  const body = new Mesh(new OctahedronGeometry(1.9, 0), new MeshBasicMaterial());
  spinner.add(part(parts, body, color.clone(), 'fill'));
  const band = new Mesh(new TorusGeometry(1.9, 0.22, 6, 18), new MeshBasicMaterial());
  band.rotation.x = Math.PI / 2;
  spinner.add(part(parts, band, CHASSIS_LIGHT.clone(), 'edge'));

  const lampMaterial = new MeshBasicMaterial({ color: HOT_WHITE.clone().multiplyScalar(0.5) });
  const lamp = new Mesh(new SphereGeometry(0.5, 10, 8), lampMaterial);
  lamp.position.set(0, 0, 1.6);
  group.add(lamp);
  group.userData.chargeLamp = lampMaterial;

  group.add(spinner);
  group.userData.spinner = spinner;
  group.userData.parts = parts;
  group.userData.lockRingScale = 1.7;
  group.userData.accent = color.clone();
  group.userData.shardSpecs = shardSpecsFor(color, 9, mulberry32(23 + assortment.octa), 0.4);
  return group;
}

// Prism: a long triangular strafer that crosses the whole face in a line.
export function createPrismMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const color = nextColor('prism', 4);
  const spinner = new Group();

  const shell = new Mesh(new CylinderGeometry(1.5, 1.5, 4.6, 3), new MeshBasicMaterial());
  shell.rotation.x = Math.PI / 2;
  spinner.add(part(parts, shell, INK.clone(), 'edge'));
  const body = new Mesh(new CylinderGeometry(1.15, 1.15, 4.0, 3), new MeshBasicMaterial());
  body.rotation.x = Math.PI / 2;
  spinner.add(part(parts, body, color.clone(), 'fill'));
  for (const z of [-1.6, 1.6]) {
    const cap = new Mesh(new CylinderGeometry(0.85, 0.85, 0.5, 3), new MeshBasicMaterial());
    cap.rotation.x = Math.PI / 2;
    cap.position.z = z;
    spinner.add(part(parts, cap, hdr(HOT_WHITE, 1.15), 'core'));
  }

  group.add(spinner);
  group.userData.spinner = spinner;
  group.userData.spinAxis = 'z';
  group.userData.parts = parts;
  group.userData.lockRingScale = 1.8;
  group.userData.accent = color.clone();
  group.userData.shardSpecs = shardSpecsFor(color, 8, mulberry32(37 + assortment.prism), 0.42);
  return group;
}

// ---- hostile bolt ----------------------------------------------------------------

// Enemy fire in the cube's own colors: a hot cubie with an ink halo ring so
// it stays legible over the pale void and the bright cube alike.
export function createBoltMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const core = new Mesh(new BoxGeometry(0.72, 0.72, 0.72), new MeshBasicMaterial());
  group.add(part(parts, core, hdr(HOT_WHITE, 1.6), 'core'));
  const halo = new Mesh(new RingGeometry(0.62, 0.74, 18), new MeshBasicMaterial());
  group.add(part(parts, halo, INK.clone(), 'edge'));

  group.userData.parts = parts;
  group.userData.isHostileShot = true;
  group.userData.lockRingScale = 1.1;
  group.userData.accent = HOT_WHITE.clone();
  group.userData.shardSpecs = shardSpecsFor(HOT_WHITE.clone(), 4, mulberry32(53), 0.25);
  return group;
}

// ---- the core --------------------------------------------------------------------

// The naked heart of the machine: a white-hot octahedron in a grey gimbal,
// wearing six stolen color pips — everything the cube was, in miniature.
export function createCoreMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const spinner = new Group();

  const heart = new Mesh(new OctahedronGeometry(3.1, 0), new MeshBasicMaterial());
  spinner.add(part(parts, heart, hdr(HOT_WHITE, 1.8), 'core'));
  const cage = new Mesh(new OctahedronGeometry(4.0, 0), new MeshBasicMaterial({ transparent: true, opacity: 0.3 }));
  spinner.add(part(parts, cage, CHASSIS_MID.clone(), 'fill'));

  const pipDirections = [
    new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
    new Vector3(0, 1, 0), new Vector3(0, -1, 0),
    new Vector3(0, 0, 1), new Vector3(0, 0, -1),
  ];
  pipDirections.forEach((direction, index) => {
    const pip = new Mesh(new BoxGeometry(1.1, 1.1, 1.1), new MeshBasicMaterial());
    pip.position.copy(direction).multiplyScalar(4.6);
    spinner.add(part(parts, pip, SOLVE_COLORS[index].clone(), 'fill'));
  });

  for (const [axis, radius] of [['x', 5.6], ['z', 6.4]] as const) {
    const ring = new Mesh(new TorusGeometry(radius, 0.28, 8, 40), new MeshBasicMaterial());
    if (axis === 'x') ring.rotation.x = Math.PI / 2;
    spinner.add(part(parts, ring, INK.clone(), 'edge'));
  }

  group.add(spinner);
  group.userData.spinner = spinner;
  group.userData.isCore = true;
  group.userData.heart = heart;
  group.userData.parts = parts;
  group.userData.lockRingScale = 3.4;
  group.userData.accent = HOT_WHITE.clone();
  const rng = mulberry32(91);
  group.userData.shardSpecs = SOLVE_COLORS.flatMap((color) => shardSpecsFor(color.clone(), 3, rng, 0.5));
  return group;
}
