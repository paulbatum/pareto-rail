import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';

export const SOLVE_COLORS = [
  new Color(0.96, 0.98, 1),
  new Color(0.98, 0.12, 0.18),
  new Color(0.05, 0.28, 1),
  new Color(1, 0.34, 0.035),
  new Color(0.05, 0.78, 0.25),
  new Color(1, 0.84, 0.04),
] as const;

export const GRAPHITE = new Color(0.12, 0.14, 0.17);
export const MACHINE = new Color(0.46, 0.5, 0.55);
export const VOID_WHITE = new Color(0.92, 0.94, 0.97);

const matte = (color: Color | number, opacity = 1) => new MeshLambertMaterial({
  color,
  transparent: opacity < 1,
  opacity,
  side: DoubleSide,
  depthWrite: opacity >= 1,
});
const unlit = (color: Color | number, opacity = 1) => new MeshBasicMaterial({
  color,
  transparent: opacity < 1,
  opacity,
  side: DoubleSide,
  depthWrite: opacity >= 1,
});

function addEdgeCage(group: Group, radius: number, color: Color) {
  const cage = new Mesh(new TorusGeometry(radius, 0.055, 5, 20), unlit(color));
  group.add(cage);
  const cageB = cage.clone();
  cageB.rotation.x = Math.PI / 2;
  group.add(cageB);
}

export function createTileTarget() {
  const group = new Group();
  const frame = new Mesh(new BoxGeometry(2.7, 2.7, 0.42), matte(GRAPHITE));
  group.add(frame);
  const face = new Mesh(new PlaneGeometry(2.25, 2.25), unlit(VOID_WHITE));
  face.position.z = 0.225;
  group.add(face);
  const inset = new Mesh(new RingGeometry(0.42, 0.58, 4), unlit(GRAPHITE));
  inset.position.z = 0.25;
  inset.rotation.z = Math.PI / 4;
  group.add(inset);
  group.userData.tintMaterials = [face.material];
  group.userData.baseScale = 1;
  return group;
}

export function createWeakpoint() {
  const group = new Group();
  const iris = new Mesh(new CylinderGeometry(1.65, 1.65, 0.7, 12), matte(GRAPHITE));
  iris.rotation.x = Math.PI / 2;
  group.add(iris);
  for (let i = 0; i < 8; i += 1) {
    const shutter = new Mesh(new BoxGeometry(0.42, 1.45, 0.24), matte(MACHINE));
    shutter.position.set(Math.cos(i * Math.PI / 4) * 0.95, Math.sin(i * Math.PI / 4) * 0.95, 0.46);
    shutter.rotation.z = i * Math.PI / 4;
    group.add(shutter);
  }
  const lensMaterial = unlit(VOID_WHITE);
  const lens = new Mesh(new OctahedronGeometry(0.62, 0), lensMaterial);
  lens.position.z = 0.78;
  group.add(lens);
  group.userData.tintMaterials = [lensMaterial];
  group.userData.baseScale = 1;
  return group;
}

export function createPolyhedron(kind: 'tetra' | 'octa' | 'prism') {
  const group = new Group();
  const color = kind === 'tetra' ? SOLVE_COLORS[1] : kind === 'octa' ? SOLVE_COLORS[2] : SOLVE_COLORS[4];
  if (kind === 'tetra') {
    group.add(new Mesh(new TetrahedronGeometry(1.2, 0), matte(color)));
    for (let i = 0; i < 3; i += 1) {
      const thorn = new Mesh(new ConeGeometry(0.18, 1.3, 3), matte(GRAPHITE));
      thorn.position.set(Math.cos(i * Math.PI * 2 / 3) * 1.05, Math.sin(i * Math.PI * 2 / 3) * 1.05, 0);
      thorn.rotation.z = i * Math.PI * 2 / 3 - Math.PI / 2;
      group.add(thorn);
    }
  } else if (kind === 'octa') {
    group.add(new Mesh(new OctahedronGeometry(1.25, 0), matte(color)));
    addEdgeCage(group, 1.48, GRAPHITE);
  } else {
    const body = new Mesh(new CylinderGeometry(0.9, 0.9, 2.6, 6), matte(color));
    body.rotation.z = Math.PI / 2;
    group.add(body);
    for (const x of [-1.35, 1.35]) {
      const cap = new Mesh(new TorusGeometry(0.92, 0.1, 5, 6), unlit(GRAPHITE));
      cap.position.x = x;
      cap.rotation.y = Math.PI / 2;
      group.add(cap);
    }
  }
  const eyeMaterial = unlit(SOLVE_COLORS[5]);
  const eye = new Mesh(new OctahedronGeometry(0.22, 0), eyeMaterial);
  eye.position.z = 1.25;
  group.add(eye);
  group.userData.tintMaterials = [eyeMaterial];
  group.userData.baseScale = 1;
  return group;
}

export function createBolt() {
  const group = new Group();
  const color = SOLVE_COLORS[3];
  const shaft = new Mesh(new CylinderGeometry(0.12, 0.32, 1.7, 6), unlit(color));
  shaft.rotation.x = Math.PI / 2;
  group.add(shaft);
  const cage = new Mesh(new OctahedronGeometry(0.43, 0), unlit(color, 0.62));
  group.add(cage);
  group.userData.tintMaterials = [shaft.material, cage.material];
  group.userData.baseScale = 1;
  return group;
}

export function createCoreTarget() {
  const group = new Group();
  const coreMaterial = unlit(VOID_WHITE);
  group.add(new Mesh(new IcosahedronGeometry(2.7, 2), coreMaterial));
  for (let axis = 0; axis < 3; axis += 1) {
    const ring = new Mesh(new TorusGeometry(3.55 + axis * 0.46, 0.12, 6, 32), matte(axis === 1 ? MACHINE : GRAPHITE));
    if (axis === 0) ring.rotation.x = Math.PI / 2;
    if (axis === 1) ring.rotation.y = Math.PI / 2;
    if (axis === 2) ring.rotation.set(Math.PI / 3, Math.PI / 4, 0);
    group.add(ring);
  }
  group.userData.tintMaterials = [coreMaterial];
  group.userData.baseScale = 1;
  return group;
}

export function createPlayerProjectile() {
  const group = new Group();
  const material = unlit(new Color(0.35, 0.92, 1));
  const head = new Mesh(new OctahedronGeometry(0.2, 0), material);
  group.add(head);
  const trail = new Mesh(new CylinderGeometry(0.035, 0.12, 1.25, 5), unlit(new Color(0.25, 0.72, 1), 0.72));
  trail.position.z = 0.65;
  trail.rotation.x = Math.PI / 2;
  group.add(trail);
  return group;
}

export function createPuzzleReticle() {
  const group = new Group();
  for (let corner = 0; corner < 4; corner += 1) {
    const angle = corner * Math.PI / 2;
    const bracket = new Group();
    const a = new Mesh(new BoxGeometry(0.36, 0.055, 0.03), unlit(GRAPHITE));
    const b = new Mesh(new BoxGeometry(0.055, 0.36, 0.03), unlit(GRAPHITE));
    a.position.x = 0.15;
    b.position.y = 0.15;
    bracket.add(a, b);
    bracket.position.set(Math.cos(angle + Math.PI / 4) * 0.68, Math.sin(angle + Math.PI / 4) * 0.68, 0);
    bracket.rotation.z = angle + Math.PI / 4;
    group.add(bracket);
  }
  const pips = new Group();
  for (let i = 0; i < 6; i += 1) {
    const pip = new Mesh(new BoxGeometry(0.11, 0.11, 0.035), unlit(SOLVE_COLORS[i]));
    pip.position.set((i - 2.5) * 0.15, -0.91, 0);
    pip.visible = false;
    pips.add(pip);
  }
  pips.name = 'pips';
  group.add(pips);
  group.userData.baseScale = 1;
  return group;
}

export function createLetterMesh(character: string) {
  const group = new Group();
  const backing = new Mesh(new BoxGeometry(2.25, 2.8, 0.22), matte(GRAPHITE));
  backing.position.z = -0.12;
  group.add(backing);
  const cells = glyphOnCells(character);
  for (const cell of cells) {
    const color = SOLVE_COLORS[(cell.x + cell.y) % SOLVE_COLORS.length];
    const block = new Mesh(new BoxGeometry(0.3, 0.3, 0.18), unlit(color));
    block.position.set((cell.x - 2) * 0.36, (3 - cell.y) * 0.36, 0.12);
    group.add(block);
  }
  group.userData.baseScale = 1;
  return group;
}
