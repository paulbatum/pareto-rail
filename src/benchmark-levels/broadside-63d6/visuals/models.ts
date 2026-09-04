import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group,
  IcosahedronGeometry, Matrix4, Mesh, MeshBasicMaterial, Quaternion, RingGeometry,
  SphereGeometry, Vector3, type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';

export type Paint = { hull: Material; plate: Material; dark: Material; trim: Material; hot: Material; glass: Material };
const cube = new BoxGeometry(1, 1, 1);
const cylinder = new CylinderGeometry(1, 1, 1, 10);
const crystal = new IcosahedronGeometry(1, 0);

export class Parts {
  private batches = new Map<Material, BufferGeometry[]>();
  add(geometry: BufferGeometry, material: Material, position: number[], scale: number[], rotation = new Quaternion()) {
    const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    copy.deleteAttribute('uv');
    copy.applyMatrix4(new Matrix4().compose(new Vector3(...position), rotation, new Vector3(...scale)));
    const batch = this.batches.get(material) ?? [];
    batch.push(copy);
    this.batches.set(material, batch);
  }
  box(material: Material, position: number[], scale: number[], rotation?: Quaternion) { this.add(cube, material, position, scale, rotation); }
  finish() {
    const root = new Group();
    for (const [material, parts] of this.batches) {
      const geometry = mergeGeometries(parts, false)!;
      geometry.computeBoundingSphere();
      root.add(new Mesh(geometry, material));
      parts.forEach(p => p.dispose());
    }
    this.batches.clear();
    return root;
  }
}

function hullGeometry(length: number, width: number, height: number) {
  const stations = [[-0.5, 0.12], [-0.4, 0.72], [-0.22, 1], [0.24, 1], [0.46, 0.78], [0.5, 0.68]];
  const outline = [[-0.5, 0], [-0.4, 0.5], [0.4, 0.5], [0.5, 0], [0.37, -0.5], [-0.37, -0.5]];
  const vertices: number[] = [];
  const at = (s: number, i: number) => new Vector3(outline[i][0] * width * stations[s][1], outline[i][1] * height * stations[s][1], stations[s][0] * length);
  const triangle = (a: Vector3, b: Vector3, c: Vector3) => vertices.push(...a.toArray(), ...c.toArray(), ...b.toArray());
  for (let s = 0; s < stations.length - 1; s++) for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    triangle(at(s, i), at(s, j), at(s + 1, j));
    triangle(at(s, i), at(s + 1, j), at(s + 1, i));
  }
  for (let i = 1; i < 5; i++) {
    triangle(at(0, 0), at(0, i + 1), at(0, i));
    triangle(at(5, 0), at(5, i), at(5, i + 1));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export type ShipSpec = {
  friendly: boolean; length: number; width: number; height: number;
  position: [number, number, number]; rotation: [number, number, number];
  split?: boolean; deck?: boolean;
};
export function makeCapital(spec: ShipSpec, paint: Paint) {
  const root = new Group();
  const { length: l, width: w, height: h } = spec;
  const halves: Group[] = [];
  const barrels: Vector3[] = [];
  const lobes = spec.split ? [-1, 1] : [0];
  for (const lobe of lobes) {
    const p = new Parts();
    const lw = spec.split ? w * 0.39 : w;
    const dx = spec.split ? lobe * w * 0.305 : 0;
    const hull = hullGeometry(l, lw, h);
    p.add(hull, paint.hull, [0, 0, 0], [1, 1, 1]);
    hull.dispose();
    // Overlapping armor courses, recessed ports and very small running lights.
    for (let i = 0; i < 22; i++) {
      const z = (i / 22 - 0.37) * l;
      const taper = 0.75 + 0.25 * Math.sin(i / 22 * Math.PI);
      for (const side of [-1, 1]) {
        p.box(i % 3 ? paint.plate : paint.hull, [side * lw * 0.37 * taper, h * 0.35, z], [lw * 0.23, h * 0.18, l * 0.031]);
        p.box(paint.dark, [side * lw * 0.474 * taper, -h * 0.045, z], [lw * 0.018, h * 0.26, l * 0.028]);
        p.box(paint.trim, [side * lw * 0.482 * taper, h * 0.14, z], [0.6, 0.85, l * 0.026]);
        for (let j = 0; j < 3; j++) p.box(paint.glass, [side * lw * 0.49 * taper, -h * 0.1 + j * 2.3, z + j * 3.4], [0.8, 0.65, 2]);
        if (i % 2 === 0) {
          const tx = side * lw * 0.49;
          const ty = h * 0.27;
          p.box(paint.dark, [tx, ty, z], [lw * 0.14, h * 0.12, l * 0.021]);
          p.box(paint.plate, [tx, ty + h * 0.08, z], [lw * 0.1, h * 0.08, l * 0.018]);
          for (const twin of [-1, 1]) {
            p.box(paint.hull, [tx + side * lw * 0.1, ty + h * 0.07, z + twin * 2], [lw * 0.24, 2.5, 2]);
            p.box(paint.hot, [tx + side * lw * 0.22, ty + h * 0.07, z + twin * 2], [0.7, 2.6, 2.1]);
          }
          barrels.push(new Vector3(dx + tx + side * lw * 0.22, ty + h * 0.07, z));
        }
      }
      if (i % 3 === 0) {
        p.box(paint.dark, [0, h * 0.51, z], [lw * 0.35, 2, l * 0.02]);
        for (let j = 0; j < 5; j++) p.box(paint.trim, [(j - 2) * lw * 0.058, h * 0.53, z], [1, 0.45, l * 0.016]);
      }
    }
    // An offset command island keeps the flight deck and flagship trench open.
    const islandX = spec.deck ? lw * 0.33 : spec.split ? lobe * lw * 0.12 : 0;
    const islandZ = l * 0.18;
    for (let tier = 0; tier < 4; tier++) {
      p.box(paint.plate, [islandX, h * (0.54 + tier * 0.14), islandZ + tier * l * 0.018], [lw * (0.34 - tier * 0.056), h * 0.2, l * (0.16 - tier * 0.024)]);
      p.box(paint.glass, [islandX, h * (0.64 + tier * 0.14), islandZ - l * (0.08 - tier * 0.03)], [lw * (0.28 - tier * 0.045), 0.7, 0.65]);
    }
    for (const x of [-0.12, 0.1]) {
      p.box(paint.hull, [islandX + lw * x, h * 1.23, islandZ + l * 0.03], [1.6, h * 0.7, 1.6]);
      p.box(paint.trim, [islandX + lw * x, h * 1.57, islandZ + l * 0.03], [3, 1.2, 3]);
    }
    const alongZ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * lw * 0.118;
      p.add(cylinder, paint.dark, [x, -h * 0.07, l * 0.49], [lw * 0.065, l * 0.05, lw * 0.065], alongZ);
      p.add(cylinder, paint.hot, [x, -h * 0.07, l * 0.518], [lw * 0.052, 1.5, lw * 0.052], alongZ);
      p.add(cylinder, paint.trim, [x, -h * 0.07, l * 0.54], [lw * 0.025, l * 0.045, lw * 0.025], alongZ);
    }
    const half = p.finish();
    half.position.x = dx;
    halves.push(half);
    root.add(half);
  }
  const p = new Parts();
  if (spec.split) {
    p.box(paint.dark, [0, -h * 0.12, 0], [w * 0.32, h * 0.3, l * 0.84]);
    for (let i = 0; i < 32; i++) {
      const z = (i / 32 - 0.42) * l;
      p.box(paint.plate, [0, h * 0.04, z], [w * 0.18, 2, l * 0.016]);
      for (const side of [-1, 1]) {
        p.box(paint.hot, [side * w * 0.098, h * 0.48, z], [1.2, 1.2, l * 0.016]);
        p.box(paint.dark, [side * w * 0.095, h * 0.15, z], [3, h * 0.24, l * 0.02]);
      }
    }
  }
  if (spec.deck) {
    p.box(paint.plate, [0, h * 0.52, 0], [w * 0.56, 1.2, l * 0.75]);
    for (let i = 0; i < 30; i++) {
      const z = (i / 30 - 0.38) * l;
      p.box(paint.trim, [0, h * 0.535, z], [1.1, 0.18, l * 0.014]);
      for (const side of [-1, 1]) {
        p.box(paint.dark, [side * w * 0.25, h * 0.54, z], [1.8, 0.3, l * 0.02]);
        p.box(paint.hot, [side * w * 0.24, h * 0.55, z], [0.8, 0.35, 3]);
      }
    }
  }
  root.add(p.finish());
  root.position.set(...spec.position);
  root.rotation.set(...spec.rotation);
  root.updateMatrixWorld(true);
  return { root, halves, barrels: barrels.map(v => root.localToWorld(v)) };
}

export function makeFighter(kind: string, paint: Paint, letter?: string) {
  const p = new Parts();
  const body = new Group();
  if (kind === 'letter') {
    p.box(paint.dark, [0, 0, -0.13], [1.72, 2.35, 0.15]);
    p.box(paint.hull, [0, -1.16, 0], [1.78, 0.08, 0.18]);
    for (const cell of glyphOnCells(letter ?? 'A')) p.box(paint.glass, [(cell.x - 2) * 0.28, (3 - cell.y) * 0.28, 0.03], [0.215, 0.215, 0.12]);
    for (const side of [-1, 1]) {
      p.box(paint.trim, [side * 0.87, 0, 0], [0.055, 2.3, 0.16]);
      p.box(paint.hot, [side * 0.6, -1.04, 0.04], [0.19, 0.04, 0.05]);
    }
  } else if (kind === 'raptor') {
    p.add(crystal, paint.hull, [0, 0, 0], [0.6, 0.35, 1.65]);
    for (const side of [-1, 1]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), side * -0.42);
      p.box(paint.plate, [side * 1.05, -0.08, -0.2], [2.05, 0.17, 0.62], q);
      p.box(paint.hot, [side * 1.8, -0.05, 0.07], [0.15, 0.13, 0.65], q);
      p.box(paint.trim, [side * 0.5, 0, -1.1], [0.2, 0.22, 0.9]);
    }
    p.add(crystal, paint.glass, [0, 0.29, 0.5], [0.26, 0.2, 0.55]);
  } else if (kind === 'helix') {
    p.add(crystal, paint.hull, [0, 0, 0], [0.6, 0.6, 1.3]);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a);
      p.box(paint.plate, [Math.sin(a) * 1.1, Math.cos(a) * 1.1, -0.2], [0.42, 2, 0.4], q);
      p.add(crystal, paint.hot, [Math.sin(a) * 1.9, Math.cos(a) * 1.9, 0], [0.23, 0.23, 0.5]);
    }
    p.add(crystal, paint.glass, [0, 0, 1], [0.32, 0.32, 0.5]);
  } else if (kind === 'bomber' || kind === 'battery') {
    p.box(paint.hull, [0, 0, 0], [2.7, 0.7, 1.7]);
    for (const side of [-1, 1]) {
      p.box(paint.plate, [side * 1.55, 0.15, 0], [0.64, 1.1, 2.3]);
      p.box(paint.trim, [side * 1.55, 0.15, -1.3], [0.5, 0.65, 0.5]);
      p.box(paint.dark, [side * 0.6, 0.25, 1.25], [0.26, 0.26, 1.8]);
      p.box(paint.hot, [side * 0.6, 0.25, 2.16], [0.29, 0.29, 0.08]);
    }
    p.box(paint.glass, [0, 0.38, 0.6], [0.65, 0.18, 0.4]);
  } else if (kind === 'generator' || kind === 'reactor') {
    const size = kind === 'reactor' ? 4.2 : 5.5;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -a);
      p.box(paint.hull, [Math.sin(a) * size, Math.cos(a) * size, 0], [size * 0.65, size * 0.8, 2], q);
      p.box(paint.hot, [Math.sin(a) * size * 0.7, Math.cos(a) * size * 0.7, 1.1], [0.5, 1.2, 0.3], q);
    }
    p.add(crystal, paint.glass, [0, 0, 0.8], [size * 0.56, size * 0.56, 2]);
    const rotor = new Mesh(new RingGeometry(size * 0.62, size * 0.69, 36), paint.trim);
    rotor.position.z = 1.5;
    rotor.name = 'rotor';
    body.add(rotor);
  } else {
    p.add(crystal, paint.hot, [0, 0, 0], [0.5, 0.5, 1.4]);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      p.box(paint.glass, [Math.sin(a) * 0.8, Math.cos(a) * 0.8, 0], [0.14, 0.14, 1.2]);
    }
  }
  body.add(p.finish());
  return body;
}

export function makeHalo(material: MeshBasicMaterial, radius: number) {
  return new Mesh(new RingGeometry(radius, radius + 0.085, 32, 1, Math.PI * 0.12, Math.PI * 1.76), material);
}

export const effectGeometry = new IcosahedronGeometry(1, 0);
export const flashGeometry = new SphereGeometry(1, 8, 6);
