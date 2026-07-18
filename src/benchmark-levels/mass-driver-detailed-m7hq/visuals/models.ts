import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  Line,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { MD_AMBER, MD_ARC, MD_RED, MD_STEEL, MD_STEEL_LIT, MD_VIOLET, MD_WHITE, heatColor } from './palette';

type MarkedMaterial = MeshBasicMaterial | LineBasicMaterial;
const GEOMETRIES = new Map<string, BufferGeometry>();

function sharedGeometry<T extends BufferGeometry>(key: string, factory: () => T): T {
  const existing = GEOMETRIES.get(key);
  if (existing) return existing as T;
  const created = factory();
  GEOMETRIES.set(key, created);
  return created;
}

function material(color: number | Color, intensity = 1, additive = false, opacity = 1) {
  const value = color instanceof Color ? color.clone() : new Color(color);
  value.multiplyScalar(intensity);
  return new MeshBasicMaterial({
    color: value,
    transparent: additive || opacity < 1,
    opacity,
    blending: additive ? AdditiveBlending : undefined,
    depthWrite: !additive,
    side: DoubleSide,
  });
}

function edgeMaterial(color: number | Color, intensity = 1.25, opacity = 1) {
  const value = color instanceof Color ? color.clone() : new Color(color);
  value.multiplyScalar(intensity);
  return new LineBasicMaterial({
    color: value,
    transparent: opacity < 1,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

function remember(root: Object3D, materials: MarkedMaterial[], hot: MarkedMaterial[] = []) {
  root.userData.mdMaterials = materials;
  root.userData.mdHotMaterials = hot;
  root.userData.mdBaseColors = materials.map((entry) => entry.color.clone());
  root.userData.mdHotColors = hot.map((entry) => entry.color.clone());
  return root;
}

function outlinedBox(size: Vector3, fill: MeshBasicMaterial, edge: LineBasicMaterial) {
  const group = new Group();
  const key = `box:${size.x}:${size.y}:${size.z}`;
  const geometry = sharedGeometry(key, () => new BoxGeometry(size.x, size.y, size.z));
  const edges = sharedGeometry(`edges:${key}`, () => new EdgesGeometry(geometry));
  group.add(new Mesh(geometry, fill), new LineSegments(edges, edge));
  return group;
}

function createCoil() {
  const group = new Group();
  const shell = material(MD_STEEL_LIT);
  const edge = edgeMaterial(MD_VIOLET, 1.2);
  const arc = material(MD_ARC, 1.7, true);
  const white = material(MD_WHITE, 2.2, true);
  const bodyGeometry = sharedGeometry('coil-body', () => new CylinderGeometry(1.05, 1.05, 0.78, 6));
  const body = new Mesh(bodyGeometry, shell);
  body.rotation.x = Math.PI / 2;
  const bodyEdges = new LineSegments(sharedGeometry('coil-body-edges', () => new EdgesGeometry(bodyGeometry)), edge);
  bodyEdges.rotation.copy(body.rotation);
  const lens = new Mesh(sharedGeometry('coil-lens', () => new TorusGeometry(0.48, 0.085, 5, 24)), arc);
  lens.position.z = 0.43;
  const pupil = new Mesh(sharedGeometry('coil-pupil', () => new SphereGeometry(0.15, 8, 6)), white);
  pupil.position.z = 0.48;
  const emitter = new Mesh(sharedGeometry('coil-emitter', () => new CylinderGeometry(0.12, 0.2, 0.45, 6)), shell);
  emitter.rotation.x = Math.PI / 2;
  emitter.position.set(0, -0.72, 0.15);
  for (const side of [-1, 1]) {
    const hook = new Mesh(sharedGeometry('coil-hook', () => new TorusGeometry(0.66, 0.13, 5, 14, Math.PI * 1.25)), shell);
    hook.position.set(side * 0.95, 0, -0.42);
    hook.rotation.z = side > 0 ? -0.8 : 2.35;
    const seam = new Mesh(sharedGeometry('coil-hook-seam', () => new TorusGeometry(0.67, 0.035, 4, 14, Math.PI * 1.25)), material(MD_VIOLET, 1.45, true));
    seam.position.copy(hook.position);
    seam.rotation.copy(hook.rotation);
    group.add(hook, seam);
  }
  group.add(body, bodyEdges, lens, pupil, emitter);
  group.userData.eye = lens;
  group.userData.core = pupil;
  group.userData.kind = 'coil';
  return remember(group, [shell, edge], [arc, white]);
}

function createThreader() {
  const group = new Group();
  const shell = material(MD_STEEL_LIT);
  const edge = material(MD_VIOLET, 1.45, true);
  const white = material(MD_WHITE, 2.5, true);
  const tail = material(MD_VIOLET, 1.15, true, 0.32);
  const nose = new Mesh(sharedGeometry('threader-nose', () => new ConeGeometry(0.58, 3.8, 7)), shell);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 0.3;
  const core = new Mesh(sharedGeometry('threader-core', () => new OctahedronGeometry(0.22, 0)), white);
  core.position.z = 1.82;
  core.scale.z = 1.9;
  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2;
    const fin = new Mesh(sharedGeometry('threader-fin', () => new PlaneGeometry(1.55, 1.15)), shell);
    fin.position.set(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, -1.35);
    fin.rotation.z = angle;
    fin.rotation.y = 0.55;
    const finEdge = new Mesh(sharedGeometry('threader-fin-edge', () => new BoxGeometry(1.4, 0.035, 0.05)), edge);
    finEdge.position.copy(fin.position);
    finEdge.rotation.copy(fin.rotation);
    group.add(fin, finEdge);
  }
  const ionTail = new Mesh(sharedGeometry('threader-tail', () => new ConeGeometry(0.46, 3.4, 8, 1, true)), tail);
  ionTail.rotation.x = Math.PI / 2;
  ionTail.position.z = -3.1;
  group.add(nose, core, ionTail);
  group.userData.ionTail = ionTail;
  group.userData.core = core;
  group.userData.kind = 'threader';
  return remember(group, [shell], [edge, white, tail]);
}

function createCapacitor() {
  const group = new Group();
  const shell = material(MD_STEEL_LIT);
  const edge = edgeMaterial(MD_ARC, 1.25);
  const violet = material(MD_VIOLET, 1.55, true);
  const coreMaterial = material(MD_VIOLET, 2.1, true);
  const core = new Mesh(sharedGeometry('capacitor-core', () => new CylinderGeometry(0.72, 0.72, 2.75, 12)), coreMaterial);
  core.rotation.x = Math.PI / 2;
  const staves = new Group();
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const stave = outlinedBox(new Vector3(0.32, 0.46, 3.55), shell, edge);
    stave.position.set(Math.cos(angle) * 1.08, Math.sin(angle) * 1.08, 0);
    stave.rotation.z = angle;
    stave.userData.basePosition = stave.position.clone();
    stave.userData.baseRotation = angle;
    staves.add(stave);
  }
  const capA = new Mesh(sharedGeometry('capacitor-cap', () => new TorusGeometry(1.18, 0.22, 6, 24)), shell);
  const capB = capA.clone();
  capA.position.z = -1.55;
  capB.position.z = 1.55;
  const ribA = new Mesh(sharedGeometry('capacitor-rib', () => new TorusGeometry(1.2, 0.045, 5, 24)), violet);
  const ribB = ribA.clone();
  ribA.position.z = -1.56;
  ribB.position.z = 1.56;
  group.add(core, staves, capA, capB, ribA, ribB);
  group.userData.staves = staves;
  group.userData.core = core;
  group.userData.kind = 'capacitor';
  return remember(group, [shell], [edge, violet, coreMaterial]);
}

function jaggedLoop(radius: number, seed: number, color: number, intensity: number) {
  const points: number[] = [];
  const segments = 12;
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const jitter = 0.72 + ((index * 17 + seed * 13) % 11) / 20;
    points.push(Math.cos(angle) * radius * jitter, Math.sin(angle) * radius * jitter, Math.sin(index * 4.1 + seed) * 0.24);
  }
  const geometry = sharedGeometry(`arc-loop:${radius}:${seed}`, () => {
    const loop = new BufferGeometry();
    loop.setAttribute('position', new Float32BufferAttribute(points, 3));
    return loop;
  });
  return new Line(geometry, edgeMaterial(color, intensity));
}

function createArc() {
  const group = new Group();
  const shellA = jaggedLoop(0.78, 1, MD_ARC, 2.1);
  const shellB = jaggedLoop(1.02, 7, MD_VIOLET, 1.8);
  shellB.rotation.x = 1.15;
  const coreMaterial = material(MD_WHITE, 3.2, true);
  const core = new Mesh(sharedGeometry('arc-core', () => new IcosahedronGeometry(0.28, 1)), coreMaterial);
  const glow = new Mesh(sharedGeometry('arc-glow', () => new SphereGeometry(0.58, 10, 7)), material(MD_ARC, 1.2, true, 0.22));
  group.add(shellA, shellB, glow, core);
  group.userData.shells = [shellA, shellB];
  group.userData.core = core;
  group.userData.kind = 'arc';
  return remember(group, [shellA.material as LineBasicMaterial, shellB.material as LineBasicMaterial], [coreMaterial, glow.material as MeshBasicMaterial]);
}

function hazardBand(parent: Group, x: number, y: number, rotation: number, amber: MeshBasicMaterial) {
  for (let index = -1; index <= 1; index += 1) {
    const stripe = new Mesh(sharedGeometry('interlock-stripe', () => new BoxGeometry(0.3, 0.72, 0.05)), amber);
    stripe.position.set(x + Math.cos(rotation) * index * 0.66, y + Math.sin(rotation) * index * 0.66, 0.38);
    stripe.rotation.z = rotation + 0.55;
    parent.add(stripe);
  }
}

function createInterlock() {
  const group = new Group();
  const steel = material(MD_STEEL_LIT, 1.15);
  const amber = material(MD_AMBER, 1.5, true);
  const white = material(MD_WHITE, 2.7, true);
  const braceA = outlinedBox(new Vector3(4.25, 0.72, 0.72), steel, edgeMaterial(MD_AMBER, 1.05));
  const braceB = outlinedBox(new Vector3(4.25, 0.72, 0.72), steel, edgeMaterial(MD_AMBER, 1.05));
  braceA.rotation.z = Math.PI / 4;
  braceB.rotation.z = -Math.PI / 4;
  hazardBand(group, -0.95, -0.95, Math.PI / 4, amber);
  hazardBand(group, 0.95, 0.95, Math.PI / 4, amber);
  hazardBand(group, -0.95, 0.95, -Math.PI / 4, amber);
  hazardBand(group, 0.95, -0.95, -Math.PI / 4, amber);
  const cowl = new Mesh(sharedGeometry('interlock-cowl', () => new CylinderGeometry(1.02, 1.18, 0.82, 8)), steel);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.z = 0.48;
  const cowlRing = new Mesh(sharedGeometry('interlock-cowl-ring', () => new TorusGeometry(0.86, 0.1, 5, 24)), amber);
  cowlRing.position.z = 0.92;
  const core = new Mesh(sharedGeometry('interlock-core', () => new OctahedronGeometry(0.48, 1)), white);
  core.position.z = 0.58;
  core.visible = false;
  const jam = new Mesh(sharedGeometry('interlock-jam', () => new RingGeometry(1.18, 1.3, 18)), amber);
  jam.position.z = 0.35;
  group.add(braceA, braceB, cowl, cowlRing, core, jam);
  group.userData.cowl = cowl;
  group.userData.cowlRing = cowlRing;
  group.userData.cowlBaseZ = cowl.position.z;
  group.userData.cowlRingBaseZ = cowlRing.position.z;
  group.userData.core = core;
  group.userData.jam = jam;
  group.userData.kind = 'interlock';
  group.userData.isInterlock = true;
  return remember(group, [steel], [amber, white]);
}

export function createMassDriverEnemy(kind: string) {
  if (kind === 'coil') return createCoil();
  if (kind === 'threader') return createThreader();
  if (kind === 'capacitor') return createCapacitor();
  if (kind === 'arc') return createArc();
  return createInterlock();
}

export function createMassDriverLetter(character: string) {
  const group = new Group();
  const plate = material(MD_STEEL, 1.15);
  const edge = edgeMaterial(MD_ARC, 1.35);
  const cellFill = material(MD_STEEL_LIT, 1.2);
  const route = material(MD_ARC, 1.6, true);
  const back = outlinedBox(new Vector3(2.2, 3.05, 0.18), plate, edge);
  back.position.z = -0.12;
  group.add(back);
  const cellGeometry = sharedGeometry('letter-cell', () => new BoxGeometry(0.29, 0.29, 0.1));
  const routeGeometry = sharedGeometry('letter-route', () => new BoxGeometry(0.18, 0.18, 0.13));
  for (const cell of glyphOnCells(character)) {
    const tile = new Mesh(cellGeometry, cellFill);
    const light = new Mesh(routeGeometry, route);
    tile.position.set((cell.x - 2) * 0.39, (3 - cell.y) * 0.39, 0.05);
    light.position.copy(tile.position);
    light.position.z = 0.12;
    group.add(tile, light);
  }
  group.userData.kind = 'letter';
  return remember(group, [plate, edge, cellFill], [route]);
}

export function createMassDriverProjectile() {
  const group = new Group();
  const white = material(MD_WHITE, 3.2, true);
  const arc = material(MD_ARC, 1.65, true, 0.55);
  const core = new Mesh(sharedGeometry('projectile-core', () => new OctahedronGeometry(0.18, 0)), white);
  core.scale.set(0.55, 0.55, 4.4);
  const shell = new Mesh(sharedGeometry('projectile-shell', () => new ConeGeometry(0.38, 2.4, 8, 1, true)), arc);
  shell.rotation.x = Math.PI / 2;
  shell.position.z = -1.15;
  const trail = new Mesh(sharedGeometry('projectile-trail', () => new ConeGeometry(0.2, 3.5, 7, 1, true)), material(MD_ARC, 1.1, true, 0.22));
  trail.rotation.x = Math.PI / 2;
  trail.position.z = -3.2;
  group.add(core, shell, trail);
  return group;
}

export function createMassDriverReticle() {
  const group = new Group();
  const center = new Mesh(new SphereGeometry(0.055, 8, 6), material(MD_WHITE, 2.2));
  const inner = new Mesh(new RingGeometry(0.38, 0.415, 32), material(MD_ARC, 1.4));
  group.add(inner, center);
  const segments: Mesh[] = [];
  for (let index = 0; index < 6; index += 1) {
    const segmentMaterial = material(index === 5 ? MD_WHITE : heatColor(index / 5), 1.45);
    const segment = new Mesh(new RingGeometry(0.58, 0.635, 18, 1, index / 6 * Math.PI * 2 + 0.07, Math.PI / 3 - 0.14), segmentMaterial);
    segment.visible = false;
    segments.push(segment);
    group.add(segment);
  }
  group.userData.segments = segments;
  group.userData.spinner = inner;
  return group;
}

export function restoreEnemyColors(root: Object3D) {
  const materials = root.userData.mdMaterials as MarkedMaterial[] | undefined;
  const hot = root.userData.mdHotMaterials as MarkedMaterial[] | undefined;
  const baseColors = root.userData.mdBaseColors as Color[] | undefined;
  const hotColors = root.userData.mdHotColors as Color[] | undefined;
  materials?.forEach((entry, index) => entry.color.copy(baseColors?.[index] ?? new Color(MD_STEEL)));
  hot?.forEach((entry, index) => entry.color.copy(hotColors?.[index] ?? new Color(MD_ARC)));
}

export function lockEnemyColors(root: Object3D, lockCount: number) {
  const materials = root.userData.mdMaterials as MarkedMaterial[] | undefined;
  const hot = root.userData.mdHotMaterials as MarkedMaterial[] | undefined;
  materials?.forEach((entry) => entry.color.set(MD_ARC).multiplyScalar(0.7));
  hot?.forEach((entry) => entry.color.copy(heatColor(Math.min(1, lockCount / 6), 1.9)));
}

export function denyEnemyColors(root: Object3D) {
  const materials = root.userData.mdMaterials as MarkedMaterial[] | undefined;
  const hot = root.userData.mdHotMaterials as MarkedMaterial[] | undefined;
  [...(materials ?? []), ...(hot ?? [])].forEach((entry) => entry.color.set(MD_RED).multiplyScalar(1.65));
}
