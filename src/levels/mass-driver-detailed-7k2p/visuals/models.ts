import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import type { MassDriverEnemyKind } from '../gameplay';

export const PALETTE = {
  void: new Color(0x01030a),
  steel: new Color(0x0a1320),
  steelEdge: new Color(0x1c3046),
  arc: new Color(0x159cff),
  violet: new Color(0x7538ff),
  white: new Color(0xeaf8ff),
  amber: new Color(0xffa31a),
  red: new Color(0xff2438),
};

export type TintPart = { material: MeshBasicMaterial; base: Color; hot: boolean };

// Hostile instances own materials so they can flash independently, but share
// immutable geometry. This keeps a busy 60-second run from continuously
// registering new GPU geometries as waves spawn and die.
const geometryCache = new Map<string, BufferGeometry>();
function cachedGeometry<T extends BufferGeometry>(key: string, create: () => T): T {
  const existing = geometryCache.get(key) as T | undefined;
  if (existing) return existing;
  const geometry = create();
  geometryCache.set(key, geometry);
  return geometry;
}

export function material(color: Color, intensity = 1, additive = false, opacity = 1) {
  const base = color.clone().multiplyScalar(intensity);
  const result = new MeshBasicMaterial({
    color: base,
    side: DoubleSide,
    transparent: additive || opacity < 1,
    opacity,
    blending: additive ? AdditiveBlending : undefined,
    depthWrite: !additive,
  });
  return result;
}

function remember(root: Group, parts: TintPart[]) {
  root.userData.tintParts = parts;
  root.userData.baseScale = root.scale.clone();
  return root;
}

function builder(root: Group) {
  const parts: TintPart[] = [];
  const add = (
    geometry: ConstructorParameters<typeof Mesh>[0],
    color: Color,
    options: { intensity?: number; additive?: boolean; opacity?: number; position?: Vector3; rotation?: Vector3; hot?: boolean } = {},
  ) => {
    const mat = material(color, options.intensity ?? 1, options.additive ?? false, options.opacity ?? 1);
    const mesh = new Mesh(geometry, mat);
    if (options.position) mesh.position.copy(options.position);
    if (options.rotation) mesh.rotation.set(options.rotation.x, options.rotation.y, options.rotation.z);
    root.add(mesh);
    parts.push({ material: mat, base: mat.color.clone(), hot: options.hot ?? false });
    return mesh;
  };
  return { add, parts };
}

export function createHostile(kind: MassDriverEnemyKind) {
  if (kind === 'coil') return createCoil();
  if (kind === 'threader') return createThreader();
  if (kind === 'capacitor') return createCapacitor();
  if (kind === 'arc') return createArc();
  return createInterlock();
}

function createCoil() {
  const root = new Group();
  const { add, parts } = builder(root);
  const body = add(cachedGeometry('coil-body', () => new CylinderGeometry(0.76, 0.92, 1.28, 6)), PALETTE.steel, { rotation: new Vector3(Math.PI / 2, 0, 0) });
  body.scale.z = 1.25;
  add(cachedGeometry('coil-eye-ring', () => new TorusGeometry(0.72, 0.075, 5, 6)), PALETTE.arc, { intensity: 1.75, additive: true, hot: true, position: new Vector3(0, 0, 0.74) });
  add(cachedGeometry('coil-eye', () => new SphereGeometry(0.23, 10, 7)), PALETTE.white, { intensity: 2.4, additive: true, hot: true, position: new Vector3(0, 0, 0.8) });
  for (const side of [-1, 1]) {
    const hook = add(cachedGeometry('coil-hook', () => new TorusGeometry(0.62, 0.12, 5, 10, Math.PI * 1.15)), PALETTE.steelEdge, {
      position: new Vector3(side * 0.88, 0, -0.42),
      rotation: new Vector3(0, 0, side > 0 ? -0.72 : Math.PI + 0.72),
    });
    hook.scale.set(0.72, 1.25, 1);
    add(cachedGeometry('coil-hook-edge', () => new BoxGeometry(0.08, 1.1, 0.12)), PALETTE.violet, { intensity: 1.45, additive: true, hot: true, position: new Vector3(side * 1.16, 0, -0.4) });
  }
  add(cachedGeometry('coil-emitter', () => new CylinderGeometry(0.13, 0.19, 0.54, 6)), PALETTE.arc, { position: new Vector3(0, -0.72, 0.55), rotation: new Vector3(Math.PI / 2, 0, 0), hot: true });
  root.userData.rotors = [];
  root.userData.accent = PALETTE.arc;
  return remember(root, parts);
}

function createThreader() {
  const root = new Group();
  const { add, parts } = builder(root);
  const nose = add(cachedGeometry('threader-nose', () => new ConeGeometry(0.52, 3.4, 6)), PALETTE.steelEdge, { rotation: new Vector3(-Math.PI / 2, 0, 0) });
  nose.position.z = -0.25;
  add(cachedGeometry('threader-core', () => new SphereGeometry(0.24, 9, 7)), PALETTE.white, { intensity: 2.6, additive: true, hot: true, position: new Vector3(0, 0, -1.45) });
  const fins: Mesh[] = [];
  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2;
    const fin = add(cachedGeometry('threader-fin', () => new ConeGeometry(0.48, 1.5, 3)), PALETTE.steel, { position: new Vector3(0, 0, 1.22), rotation: new Vector3(Math.PI / 2, 0, angle) });
    fin.scale.x = 0.34;
    fins.push(fin);
  }
  const tail = add(cachedGeometry('threader-tail', () => new ConeGeometry(0.5, 3.5, 8, 1, true)), PALETTE.violet, {
    intensity: 1.3, additive: true, opacity: 0.32, hot: true, position: new Vector3(0, 0, 2.75), rotation: new Vector3(Math.PI / 2, 0, 0),
  });
  root.userData.tail = tail;
  root.userData.fins = fins;
  root.userData.accent = PALETTE.violet;
  return remember(root, parts);
}

function createCapacitor() {
  const root = new Group();
  const { add, parts } = builder(root);
  const core = add(cachedGeometry('capacitor-core', () => new CylinderGeometry(0.66, 0.66, 3.1, 12)), PALETTE.violet, { intensity: 1.65, additive: true, hot: true, rotation: new Vector3(Math.PI / 2, 0, 0) });
  const staves: Mesh[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const stave = add(cachedGeometry('capacitor-stave', () => new BoxGeometry(0.36, 0.48, 3.5)), PALETTE.steelEdge, { position: new Vector3(Math.cos(angle) * 1.02, Math.sin(angle) * 1.02, 0) });
    stave.rotation.z = angle;
    staves.push(stave);
  }
  for (const z of [-1.65, 1.65]) {
    add(cachedGeometry('capacitor-cap', () => new TorusGeometry(1.18, 0.19, 6, 18)), PALETTE.steel, { position: new Vector3(0, 0, z) });
    add(cachedGeometry('capacitor-cap-edge', () => new TorusGeometry(0.84, 0.045, 4, 18)), PALETTE.violet, { intensity: 1.25, additive: true, hot: true, position: new Vector3(0, 0, z + Math.sign(z) * 0.05) });
  }
  root.userData.core = core;
  root.userData.staves = staves;
  root.userData.accent = PALETTE.violet;
  return remember(root, parts);
}

function createArc() {
  const root = new Group();
  const { add, parts } = builder(root);
  add(cachedGeometry('arc-core', () => new SphereGeometry(0.28, 10, 8)), PALETTE.white, { intensity: 3.2, additive: true, hot: true });
  const shells: Mesh[] = [];
  for (let index = 0; index < 2; index += 1) {
    const shell = add(cachedGeometry(`arc-shell-${index}`, () => new IcosahedronGeometry(0.66 + index * 0.22, 0)), index ? PALETTE.violet : PALETTE.arc, { intensity: 1.6, additive: true, opacity: 0.65, hot: true });
    shell.material.wireframe = true;
    shells.push(shell);
  }
  root.userData.shells = shells;
  root.userData.isArc = true;
  root.userData.accent = PALETTE.white;
  return remember(root, parts);
}

function createInterlock() {
  const root = new Group();
  const { add, parts } = builder(root);
  const braces: Mesh[] = [];
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const brace = add(cachedGeometry('interlock-brace', () => new BoxGeometry(5.0, 0.72, 0.72)), PALETTE.steelEdge, { rotation: new Vector3(0, 0, angle) });
    braces.push(brace);
    // Amber is exclusive to the boss hazard bands.
    for (let stripe = -2; stripe <= 2; stripe += 1) {
      const band = add(cachedGeometry('interlock-band', () => new BoxGeometry(0.28, 0.78, 0.76)), PALETTE.amber, { intensity: 1.25, additive: true, hot: true });
      band.rotation.z = angle + (stripe % 2 ? 0.16 : -0.16);
      band.position.set(Math.cos(angle) * stripe * 0.72, Math.sin(angle) * stripe * 0.72, 0.02);
    }
  }
  const cowl = add(cachedGeometry('interlock-cowl', () => new CylinderGeometry(0.92, 1.08, 0.82, 8)), PALETTE.steel, { rotation: new Vector3(Math.PI / 2, 0, 0) });
  add(cachedGeometry('interlock-ring', () => new TorusGeometry(1.05, 0.09, 5, 24)), PALETTE.amber, { intensity: 1.55, additive: true, hot: true, position: new Vector3(0, 0, 0.48) });
  const core = add(cachedGeometry('interlock-core', () => new OctahedronGeometry(0.48, 0)), PALETTE.white, { intensity: 2.8, additive: true, hot: true, position: new Vector3(0, 0, 0.64) });
  core.visible = false;
  root.userData.cowl = cowl;
  root.userData.core = core;
  root.userData.braces = braces;
  root.userData.isInterlock = true;
  root.userData.accent = PALETTE.amber;
  return remember(root, parts);
}

export function exposeArmor(root: Object3D) {
  if (!(root instanceof Group)) return;
  const staves = root.userData.staves as Mesh[] | undefined;
  if (staves) {
    staves.forEach((stave, index) => {
      stave.position.add(new Vector3(Math.cos(index / 6 * Math.PI * 2), Math.sin(index / 6 * Math.PI * 2), 0).multiplyScalar(0.42));
      stave.rotation.z += (index % 2 ? 1 : -1) * 0.35;
      (stave.material as MeshBasicMaterial).opacity = 0.35;
      (stave.material as MeshBasicMaterial).transparent = true;
    });
  }
  const cowl = root.userData.cowl as Mesh | undefined;
  const core = root.userData.core as Mesh | undefined;
  if (cowl && core) {
    cowl.visible = false;
    core.visible = true;
  }
}

export function createLetter(character: string) {
  const root = new Group();
  const { add, parts } = builder(root);
  add(cachedGeometry('letter-plate', () => new BoxGeometry(2.5, 3.35, 0.18)), PALETTE.steel, { position: new Vector3(0, 0, -0.11) });
  const cellGeometry = cachedGeometry('letter-cell', () => new BoxGeometry(0.3, 0.3, 0.12));
  for (const cell of glyphOnCells(character)) {
    add(cellGeometry, PALETTE.arc, {
      intensity: 1.5,
      additive: true,
      hot: true,
      position: new Vector3((cell.x - 2) * 0.38, (3 - cell.y) * 0.38, 0.1),
    });
  }
  // Routed edge plus corner bolts keep the stencil readable at bloom zero.
  add(cachedGeometry('letter-rail-h', () => new BoxGeometry(2.64, 0.07, 0.08)), PALETTE.arc, { intensity: 1.25, position: new Vector3(0, 1.72, 0.04), hot: true });
  add(cachedGeometry('letter-rail-h', () => new BoxGeometry(2.64, 0.07, 0.08)), PALETTE.arc, { intensity: 1.25, position: new Vector3(0, -1.72, 0.04), hot: true });
  add(cachedGeometry('letter-rail-v', () => new BoxGeometry(0.07, 3.5, 0.08)), PALETTE.arc, { intensity: 1.25, position: new Vector3(1.34, 0, 0.04), hot: true });
  add(cachedGeometry('letter-rail-v', () => new BoxGeometry(0.07, 3.5, 0.08)), PALETTE.arc, { intensity: 1.25, position: new Vector3(-1.34, 0, 0.04), hot: true });
  for (const x of [-1.12, 1.12]) for (const y of [-1.48, 1.48]) add(cachedGeometry('letter-bolt', () => new CircleGeometry(0.06, 8)), PALETTE.white, { intensity: 1.5, hot: true, position: new Vector3(x, y, 0.08) });
  root.userData.isLetter = true;
  return remember(root, parts);
}

export function createProjectile() {
  const root = new Group();
  const core = new Mesh(cachedGeometry('projectile-core', () => new OctahedronGeometry(0.2, 0)), material(PALETTE.white, 3, true));
  core.scale.set(0.5, 0.5, 3.2);
  const shell = new Mesh(cachedGeometry('projectile-shell', () => new ConeGeometry(0.34, 2.5, 8, 1, true)), material(PALETTE.arc, 1.55, true, 0.45));
  shell.rotation.x = Math.PI / 2;
  shell.position.z = 1.1;
  root.add(core, shell);
  return root;
}

export function createChargeReticle() {
  const root = new Group();
  const ring = new Mesh(cachedGeometry('reticle-ring', () => new RingGeometry(0.52, 0.555, 48)), material(PALETTE.arc, 1.35, true));
  const dot = new Mesh(cachedGeometry('reticle-dot', () => new CircleGeometry(0.055, 16)), material(PALETTE.white, 2.3, true));
  const segments: Array<{ mesh: Mesh; material: MeshBasicMaterial }> = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2 + Math.PI / 2;
    const segment = new Mesh(cachedGeometry('reticle-segment', () => new RingGeometry(0.72, 0.79, 18, 1, -0.36, 0.72)), material(PALETTE.steelEdge, 0.7));
    segment.rotation.z = angle;
    root.add(segment);
    segments.push({ mesh: segment, material: segment.material as MeshBasicMaterial });
  }
  root.add(ring, dot);
  root.userData.ring = ring;
  root.userData.segments = segments;
  return root;
}

export function tintObject(root: Object3D, locked: boolean) {
  const parts = root.userData.tintParts as TintPart[] | undefined;
  for (const part of parts ?? []) {
    if (locked) part.material.color.copy(part.hot ? PALETTE.white : PALETTE.arc).multiplyScalar(part.hot ? 1.9 : 0.58);
    else part.material.color.copy(part.base);
  }
  root.scale.setScalar(locked ? 1.08 : 1);
}

export function denyObject(root: Object3D) {
  const parts = root.userData.tintParts as TintPart[] | undefined;
  for (const part of parts ?? []) part.material.color.copy(PALETTE.red).multiplyScalar(part.hot ? 1.8 : 0.55);
  root.scale.set(1.18, 0.82, 1.18);
}
