import { BoxGeometry, BufferAttribute, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, TorusGeometry } from 'three';
import type { ColorRepresentation, Object3D } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';

// Geometry leaves: dimensions and pigments are supplied by the visual spine.
const box = new BoxGeometry(1, 1, 1);
const faceColors: number[] = [];
for (const shade of [0.66, 0.52, 1, 0.45, 0.86, 0.6]) for (let i = 0; i < 4; i++) faceColors.push(shade, shade, shade);
box.setAttribute('color', new BufferAttribute(new Float32Array(faceColors), 3));
const panelMaterials = new WeakMap<MeshBasicMaterial, MeshBasicMaterial>();
const rings = new Map<string, TorusGeometry>();
const ball = new SphereGeometry(1, 12, 8);
const engineCylinder = new CylinderGeometry(0.35, 0.35, 1.6, 8);
export function paint(color: ColorRepresentation) { return new MeshBasicMaterial({ color }); }
export function panel(parent: Object3D, material: MeshBasicMaterial, size: number[], position: number[], rotation = 0) {
  let shaded = panelMaterials.get(material);
  if (!shaded) { shaded = material.clone(); shaded.vertexColors = true; panelMaterials.set(material, shaded); }
  const mesh = new Mesh(box, shaded);
  mesh.scale.set(size[0], size[1], size[2]); mesh.position.set(position[0], position[1], position[2]); mesh.rotation.z = rotation;
  parent.add(mesh); return mesh;
}
export function ring(parent: Object3D, material: MeshBasicMaterial, radius: number, width: number, x = 0, y = 0, z = 0) {
  const key = `${radius}:${width}`;
  let geometry = rings.get(key); if (!geometry) { geometry = new TorusGeometry(radius, width, 4, 40); rings.set(key, geometry); }
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
export function makeHardware(kind: string, white: MeshBasicMaterial, orange: MeshBasicMaterial, dark: MeshBasicMaterial, steel: MeshBasicMaterial) {
  const g = new Group();
  if (kind === 'kite') {
    panel(g, dark, [0.7, 0.7, 0.9], [0, 0, 0]);
    for (const side of [-1, 1]) {
      panel(g, white, [2.5, 0.18, 0.8], [side * 1.3, 0.2, 0], side * 0.38);
      panel(g, orange, [0.4, 0.4, 0.8], [side * 2.2, 0.65, 0]);
      panel(g, steel, [0.08, 1.8, 0.12], [side * 1, -0.45, 0], side * -0.7);
    }
    panel(g, orange, [0.45, 0.4, 0.08], [0, 0, 0.5]);
    panel(g, white, [0.14, 1.4, 0.25], [0, -0.7, 0]);
  } else if (kind === 'skiff') {
    panel(g, white, [2.8, 0.9, 1.5], [0, 0, 0]);
    panel(g, dark, [1.5, 0.5, 0.2], [0, 0.2, 0.8]);
    for (const s of [-1, 1]) {
      const engine = new Mesh(engineCylinder, steel); engine.rotation.x = Math.PI / 2; engine.position.x = s * 1.8; g.add(engine);
      ring(g, orange, 0.35, 0.1, s * 1.8, 0, 0.8);
      panel(g, orange, [0.45, 1.6, 0.4], [s * 1.2, 0.6, 0], s * 0.3);
    }
    panel(g, dark, [0.25, 0.25, 1], [0, -0.5, 0.7]);
  } else if (kind === 'limpet') {
    panel(g, orange, [1.2, 1.2, 1.1], [0, 0, 0]);
    panel(g, dark, [0.8, 0.6, 0.16], [0, 0.15, 0.6]);
    for (const s of [-1, 1]) {
      panel(g, white, [0.25, 2.1, 0.4], [s * 0.95, -0.1, 0], s * -0.2);
      panel(g, steel, [0.7, 0.24, 0.4], [s * 0.7, -1, 0]);
    }
    panel(g, white, [0.5, 0.16, 0.08], [0, -0.15, 0.62]);
  } else if (kind === 'vacuum') {
    const core = new Mesh(ball, dark); core.scale.set(0.8, 0.8, 0.65); g.add(core);
    ring(g, steel, 1.6, 0.1);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      panel(g, white, [1.2, 0.55, 0.55], [Math.cos(a) * 1.6, Math.sin(a) * 1.6, 0], a);
      panel(g, orange, [0.45, 0.6, 0.1], [Math.cos(a) * 2, Math.sin(a) * 2, 0.35], a);
    }
    ring(g, orange, 0.55, 0.06, 0, 0, 0.72);
  } else if (kind === 'shrapnel') {
    const core = new Mesh(ball, orange); core.scale.set(0.4, 0.4, 1.1); g.add(core);
    ring(g, white, 0.58, 0.08);
  } else if (kind === 'tether-eater') {
    // A salvage crawler the size of a building. The front radiator is the
    // lockable point; opposing grippers cycle along the cable behind it.
    panel(g, dark, [7.5, 6.3, 5], [0, 0, -1.5]);
    panel(g, white, [6.4, 4.5, 0.8], [0, 0, 1.3]);
    panel(g, orange, [4.8, 2.4, 0.4], [0, 0, 1.8]);
    for (let i = 0; i < 9; i++) panel(g, dark, [0.25, 2, 0.15], [-2 + i * 0.5, 0, 2.05]);
    for (const s of [-1, 1]) {
      panel(g, white, [2, 6.4, 4], [s * 5, 0, -2]);
      panel(g, orange, [2.1, 0.8, 4.1], [s * 5, 2, -2]);
      for (let j = 0; j < 3; j++) {
        const arm = new Group(); arm.position.set(s * 4, (j - 1) * 2.3, -0.8); arm.name = 'gripper';
        panel(arm, steel, [4.7, 0.4, 0.6], [s * 2, 0, 0], s * 0.35);
        panel(arm, white, [0.7, 1.7, 1.4], [s * 4, 0.4, 0]);
        panel(arm, orange, [1.5, 0.25, 1], [s * 3.6, -0.3, 0]); g.add(arm);
      }
    }
    for (const s of [-1, 1]) for (const y of [-2.7, 2.7]) panel(g, steel, [1.2, 1.2, 4.8], [s * 3, y, -1]);
    ring(g, orange, 1.4, 0.12, 0, 0, 2.2);
    for (let i = 0; i < 5; i++) { const lamp = panel(g, white, [0.55, 0.3, 0.1], [(i - 2) * 0.8, -1.7, 2]); lamp.name = 'phase-lamp'; }
  }
  return g;
}
export function makeLetter(character: string, white: MeshBasicMaterial, orange: MeshBasicMaterial, dark: MeshBasicMaterial) {
  const g = new Group();
  panel(g, dark, [1.8, 2.3, 0.12], [0, 0, -0.08]);
  for (const cell of glyphOnCells(character)) panel(g, white, [0.23, 0.23, 0.06], [(cell.x - 2) * 0.28, (3 - cell.y) * 0.28, 0.04]);
  panel(g, orange, [1.8, 0.08, 0.08], [0, -1.18, 0]);
  for (const s of [-1, 1]) panel(g, white, [0.13, 0.13, 0.06], [s * 0.76, 1.02, 0]);
  return g;
}
export function makeCar(white: MeshBasicMaterial, orange: MeshBasicMaterial, dark: MeshBasicMaterial, steel: MeshBasicMaterial) {
  const g = new Group();
  panel(g, dark, [8, 1.4, 4], [0, -4.8, -5]);
  panel(g, white, [8, 0.3, 4], [0, -5.4, -5]);
  for (const s of [-1, 1]) {
    panel(g, white, [1.5, 1.9, 4], [s * 5.2, -4.8, -5]);
    panel(g, orange, [1.6, 0.14, 4.1], [s * 5.2, -3.9, -5]);
    panel(g, dark, [1, 0.4, 2], [s * 5.2, -3.8, -5]);
    for (let i = 0; i < 5; i++) panel(g, dark, [0.3, 0.12, 0.9], [s * 5.2, -3.81, -6.5 + i * 0.65], 0.6);
    panel(g, steel, [0.15, 2, 0.15], [s * 5.7, -3.5, -7]);
    panel(g, steel, [0.15, 0.15, 3], [s * 5.7, -2.5, -6]);
  }
  panel(g, white, [0.35, 1.4, 1], [3.2, -3.6, -8]);
  for (const y of [-3.2, -4.2]) { ring(g, steel, 0.6, 0.15, 3.2, y, -8); panel(g, orange, [1.5, 0.5, 1], [3.2, y, -8]); }
  return g;
}
export function makeStation(white: MeshBasicMaterial, orange: MeshBasicMaterial, dark: MeshBasicMaterial, steel: MeshBasicMaterial) {
  const g = new Group();
  const face = new Mesh(new RingGeometry(12, 28, 12), white); face.material.side = DoubleSide; g.add(face);
  ring(g, dark, 12.2, 0.6); ring(g, steel, 27, 0.5); ring(g, orange, 13.5, 0.18, 0, 0, 0.2);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    panel(g, dark, [0.25, 14, 0.2], [Math.sin(a) * 20, Math.cos(a) * 20, 0.2], -a);
    panel(g, orange, [0.6, 2, 0.1], [Math.sin(a) * 14.5, Math.cos(a) * 14.5, 0.3], -a);
    panel(g, steel, [0.8, 0.8, 28], [Math.sin(a) * 29, Math.cos(a) * 29, -12]);
  }
  for (const s of [-1, 1]) {
    const door = new Group(); door.name = s < 0 ? 'door-left' : 'door-right';
    panel(door, dark, [12, 23, 0.8], [s * 6, 0, -0.8]);
    panel(door, white, [11.3, 22, 0.2], [s * 6, 0, -0.25]);
    panel(door, orange, [0.7, 22, 0.1], [s * 0.5, 0, 0]); g.add(door);
    panel(g, dark, [1, 24, 50], [s * 12.5, 0, -26]);
    for (let i = 0; i < 8; i++) panel(g, white, [0.12, 10, 0.4], [s * 11.9, 0, -i * 6 - 4]);
    panel(g, white, [19, 0.8, 7], [s * 37, 0, -8]);
    panel(g, dark, [28, 16, 0.4], [s * 53, 0, -8]);
    for (let i = 0; i < 9; i++) panel(g, steel, [0.1, 16, 0.1], [s * (40 + i * 3), 0, -7.7]);
  }
  panel(g, dark, [24, 1, 50], [0, -12, -26]);
  panel(g, dark, [24, 1, 50], [0, 12, -26]);
  panel(g, steel, [24, 24, 1], [0, 0, -53]);
  return g;
}
