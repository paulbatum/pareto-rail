import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, GUNMETAL, GUNMETAL_LIT, HAZARD_AMBER, hdr, ION_WHITE, VOLT_VIOLET } from './palette';

// Every hostile is machined from the same facet vocabulary: gunmetal fills,
// thin bright edges, and a small hot core with a glow shell, so a single tint
// pass drives every state. Each mesh stores its materials and base colors in
// userData; visuals/index.ts owns the tint pass.

export type ShardSpec = { direction: Vector3; size: number };

type FacetBundle = {
  fill: MeshBasicMaterial;
  edge: LineBasicMaterial;
  core: MeshBasicMaterial;
  glow: MeshBasicMaterial;
};

function facetMaterials(edgeColor: Color, coreColor: Color): FacetBundle {
  return {
    fill: new MeshBasicMaterial({ color: GUNMETAL.clone() }),
    edge: new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, 1.0) })),
    core: new MeshBasicMaterial({ color: hdr(coreColor, 2.2) }),
    glow: createAdditiveBasicMaterial({ color: hdr(coreColor, 0.7), opacity: 0.6 }),
  };
}

function stampFacet(group: Group, materials: FacetBundle, edgeColor: Color, coreColor: Color, shardSpecs: ShardSpec[]) {
  group.userData.fillMaterial = materials.fill;
  group.userData.edgeMaterial = materials.edge;
  group.userData.coreMaterial = materials.core;
  group.userData.glowMaterial = materials.glow;
  group.userData.baseEdge = edgeColor.clone();
  group.userData.baseCore = coreColor.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = edgeColor.clone();
}

function facetPart(materials: FacetBundle, geometry: BoxGeometry | CylinderGeometry | ConeGeometry) {
  const part = new Group();
  part.add(new Mesh(geometry, materials.fill));
  part.add(new LineSegments(new EdgesGeometry(geometry), materials.edge));
  return part;
}

function hotCore(materials: FacetBundle, radius: number) {
  const core = new Group();
  core.add(new Mesh(new OctahedronGeometry(radius, 0), materials.core));
  const glow = new Mesh(new SphereGeometry(radius * 2.1, 10, 8), materials.glow);
  core.add(glow);
  return core;
}

// Coil — a wall-riding sentry: hexagonal maintenance pod, arc-blue ring-lens
// eye, two violet-edged clamp hooks gripping the wall behind it, emitter nub.
export function createCoilMesh(): Group {
  const group = new Group();
  const materials = facetMaterials(ARC_BLUE, ARC_BLUE);
  const shardSpecs: ShardSpec[] = [];

  const pod = facetPart(materials, new CylinderGeometry(0.85, 0.85, 0.5, 6));
  pod.rotation.x = Math.PI / 2;
  group.add(pod);

  const eye = new Mesh(new TorusGeometry(0.42, 0.07, 8, 24), materials.core);
  eye.position.z = 0.32;
  group.add(eye);
  const lens = new Mesh(new SphereGeometry(0.16, 8, 8), materials.glow);
  lens.position.z = 0.34;
  group.add(lens);

  const hookGeometry = new BoxGeometry(0.22, 0.7, 0.22);
  for (const side of [-1, 1]) {
    const hook = facetPart(materials, hookGeometry);
    hook.position.set(side * 0.75, 0, -0.55);
    hook.rotation.z = side * 0.5;
    group.add(hook);
    shardSpecs.push({ direction: new Vector3(side, 0.2, -0.4).normalize(), size: 0.5 });
  }
  const nub = facetPart(materials, new CylinderGeometry(0.12, 0.18, 0.3, 6));
  nub.position.set(0, -0.7, 0.1);
  group.add(nub);

  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    shardSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.3).normalize(), size: 0.6 });
  }
  stampFacet(group, materials, ARC_BLUE, ARC_BLUE, shardSpecs);
  group.userData.lockRingScale = 1;
  return group;
}

// Threader — a needle drone: stretched nose, ion-white hot core near the tip,
// three swept tail fins, translucent violet ion-tail.
export function createThreaderMesh(): Group {
  const group = new Group();
  const materials = facetMaterials(VOLT_VIOLET, ION_WHITE);
  const shardSpecs: ShardSpec[] = [];

  const nose = facetPart(materials, new ConeGeometry(0.3, 2.2, 6));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.5;
  group.add(nose);

  const core = hotCore(materials, 0.2);
  core.position.z = 1.05;
  group.add(core);

  const finGeometry = new BoxGeometry(0.08, 0.85, 0.5);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const fin = facetPart(materials, finGeometry);
    fin.position.set(Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, -0.75);
    fin.rotation.z = angle + Math.PI / 2;
    fin.rotation.x = -0.5;
    group.add(fin);
    shardSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), -0.5).normalize(), size: 0.5 });
  }

  const tail = new Mesh(
    new ConeGeometry(0.24, 2.4, 6),
    createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 0.55), opacity: 0.5 }),
  );
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -1.6;
  group.add(tail);
  group.userData.tailMaterial = tail.material;

  shardSpecs.push({ direction: new Vector3(0, 0, 1), size: 0.8 });
  shardSpecs.push({ direction: new Vector3(0, 0, -1), size: 0.6 });
  stampFacet(group, materials, VOLT_VIOLET, ION_WHITE, shardSpecs);
  group.userData.lockRingScale = 1.1;
  return group;
}

// Capacitor — a hot violet core cylinder caged by six gunmetal insulator
// staves with ribbed end caps. Two hits shear the staves off along the six
// stave directions and expose the core.
export function createCapacitorMesh(): Group {
  const group = new Group();
  const materials = facetMaterials(VOLT_VIOLET, VOLT_VIOLET);
  const shardSpecs: ShardSpec[] = [];

  const core = new Mesh(new CylinderGeometry(0.55, 0.55, 1.6, 10), materials.core);
  group.add(core);
  const coreGlow = new Mesh(new CylinderGeometry(0.75, 0.75, 1.7, 10), materials.glow);
  group.add(coreGlow);

  const staves = new Group();
  const staveGeometry = new BoxGeometry(0.3, 2.1, 0.3);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const stave = facetPart(materials, staveGeometry);
    stave.position.set(Math.cos(angle) * 1.05, 0, Math.sin(angle) * 1.05);
    staves.add(stave);
    shardSpecs.push({ direction: new Vector3(Math.cos(angle), 0.15, Math.sin(angle)).normalize(), size: 0.85 });
  }
  group.add(staves);
  group.userData.staves = staves;

  for (const side of [-1, 1]) {
    const cap = facetPart(materials, new CylinderGeometry(1.25, 1.25, 0.34, 10));
    cap.position.y = side * 1.2;
    group.add(cap);
    shardSpecs.push({ direction: new Vector3(0.2, side, 0).normalize(), size: 0.9 });
  }

  group.rotation.z = Math.PI / 2;
  stampFacet(group, materials, VOLT_VIOLET, VOLT_VIOLET, shardSpecs);
  group.userData.lockRingScale = 1.6;
  return group;
}

// Arc — ball lightning: an ion-white hot core inside two jagged wire shells
// that re-randomize their rotation and scale every frame (done in the spine).
export function createArcMesh(): Group {
  const group = new Group();
  const materials = facetMaterials(ARC_BLUE, ION_WHITE);
  group.add(new Mesh(new OctahedronGeometry(0.24, 0), materials.core));
  group.add(new Mesh(new SphereGeometry(0.42, 10, 8), materials.glow));
  const shells: LineSegments[] = [];
  for (const radius of [0.55, 0.78]) {
    const shell = new LineSegments(
      new EdgesGeometry(new IcosahedronGeometry(radius, 0)),
      new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 1.6) })),
    );
    group.add(shell);
    shells.push(shell);
  }
  group.userData.arcShells = shells;
  group.userData.isArc = true;
  const shardSpecs: ShardSpec[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    shardSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), (i % 2) - 0.5).normalize(), size: 0.4 });
  }
  stampFacet(group, materials, ARC_BLUE, ION_WHITE, shardSpecs);
  group.userData.lockRingScale = 0.85;
  return group;
}

// Interlock — a heavy hazard-striped X-clamp: two crossed gunmetal braces
// banded with amber hazard chevrons, around a central cowl hiding an
// ion-white actuator core. Hazard amber is reserved for these.
export function createInterlockMesh(): Group {
  const group = new Group();
  const materials = facetMaterials(HAZARD_AMBER, ION_WHITE);
  const shardSpecs: ShardSpec[] = [];

  const braceGeometry = new BoxGeometry(3.4, 0.62, 0.5);
  const chevronGeometry = new BoxGeometry(0.34, 0.66, 0.54);
  const chevronMaterial = new MeshBasicMaterial({ color: hdr(HAZARD_AMBER, 0.85) });
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const brace = facetPart(materials, braceGeometry);
    brace.rotation.z = angle;
    group.add(brace);
    for (const along of [-1.25, -0.42, 0.42, 1.25]) {
      const chevron = new Mesh(chevronGeometry, chevronMaterial);
      chevron.position.set(Math.cos(angle) * along, Math.sin(angle) * along, 0.02);
      chevron.rotation.z = angle;
      group.add(chevron);
    }
    shardSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.1).normalize(), size: 1.1 });
    shardSpecs.push({ direction: new Vector3(-Math.cos(angle), -Math.sin(angle), 0.1).normalize(), size: 1.1 });
  }

  const cowl = facetPart(materials, new CylinderGeometry(0.75, 0.85, 0.6, 6));
  cowl.rotation.x = Math.PI / 2;
  group.add(cowl);
  group.userData.cowl = cowl;

  const core = hotCore(materials, 0.34);
  core.position.z = 0.1;
  core.visible = false;
  group.add(core);
  group.userData.actuatorCore = core;

  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    shardSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.4).normalize(), size: 0.7 });
  }
  stampFacet(group, materials, HAZARD_AMBER, ION_WHITE, shardSpecs);
  group.userData.isInterlock = true;
  group.userData.lockRingScale = 2.1;
  return group;
}

// Letters (CHARGE / RELOAD): stencil plates off the gun housing — shallow
// gunmetal cell grids with a crisp arc-blue routed edge; the outline carries
// the shape with the glow off. Locked plates go ion-white; denied hazard red.
const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.3, 0.3, 0.12);

export function createLetterMesh(character: string): Group {
  const group = new Group();
  const cells = glyphOnCells(character);
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const shardSpecs: ShardSpec[] = [];
  for (const cell of cells) {
    const offset = new Vector3((cell.x - 2) * CELL, (3 - cell.y) * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    shardSpecs.push({
      direction: offset.lengthSq() > 0.001 ? offset.clone().normalize() : new Vector3(0, 0, 1),
      size: 0.3,
    });
  }
  const backing = new Mesh(new BoxGeometry(5 * CELL + 0.3, 7 * CELL + 0.3, 0.05), new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.8) }));
  backing.position.z = -0.09;
  const fillMaterial = new MeshBasicMaterial({ color: GUNMETAL_LIT.clone() });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 1.15) }));
  group.add(backing, new Mesh(mergeGeometries(fills), fillMaterial), new LineSegments(mergeGeometries(edges), edgeMaterial));
  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = ARC_BLUE.clone();
  group.userData.lockRingScale = 1.15;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial };
  materials.edgeMaterial.color.copy(locked ? hdr(ION_WHITE, 1.7) : hdr(ARC_BLUE, 1.15));
  materials.fillMaterial.color.copy(locked ? ARC_BLUE.clone().multiplyScalar(0.4) : GUNMETAL_LIT.clone());
}

export function setLetterDenied(group: Group) {
  const materials = group.userData.letterMaterials as { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial };
  materials.edgeMaterial.color.copy(hdr(HAZARD_RED_COLOR, 1.8));
  materials.fillMaterial.color.copy(HAZARD_RED_COLOR.clone().multiplyScalar(0.3));
}

import { HAZARD_RED as HAZARD_RED_COLOR } from './palette';

// Player shot: a cold ion dart — a stretched white-hot core in a translucent
// arc-blue shell.
export function createProjectileMeshInternal(): Group {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.3, 0), new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.8) }));
  core.scale.set(0.35, 0.35, 2.2);
  const shell = new Mesh(new OctahedronGeometry(0.5, 0), createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.0), opacity: 0.5 }));
  shell.scale.set(0.5, 0.5, 2);
  group.add(core, shell);
  return group;
}

// Reticle = breech charge gauge: a thin arc-blue ring around an ion-white
// center dot, with six arc segments that light one per lock, climbing the
// lock gradient — the sixth segment is ignition-white.
export function createReticleInternal(): Group {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.62, 0.66, 48),
    createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.1), side: DoubleSide }),
  );
  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(ION_WHITE, 2) })));

  const spinner = new Group();
  const segments: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const material = createAdditiveBasicMaterial({ color: new Color(0, 0, 0), side: DoubleSide });
    const arcLength = (Math.PI * 2) / 6 - 0.16;
    const segment = new Mesh(new RingGeometry(0.72, 0.8, 12, 1, i * (Math.PI * 2 / 6) + 0.08 + Math.PI / 2, arcLength), material);
    spinner.add(segment);
    segments.push(material);
  }
  group.add(outer, spinner, dot);
  group.userData.spinner = spinner;
  group.userData.segments = segments;
  group.userData.reticle = true;
  return group;
}

export { HAZARD_RED_COLOR };
