import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Rng } from '../../../engine/rng';
import { noise3 } from '../world';

// Pines, drowned snags and boulders: instanced props placed by the
// environment. Each factory takes the placements and returns meshes; where
// things go is decided in environment.ts.

export type Placement = { position: Vector3; scale: number; yaw: number; tint?: Color; lean?: number };

const up = new Vector3(0, 1, 0);

function jagged(geometry: BufferGeometry, amount: number, seed: number) {
  // Displacement is a function of position, so vertices shared across faces move together.
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (Math.hypot(x, z) < 1e-3) continue;
    const k = 1 + noise3(x * 1.7 + seed, y * 1.7, z * 1.7) * amount;
    position.setXYZ(i, x * k, y + noise3(x * 2.3, y * 2.3 + seed, z * 2.3) * amount * 0.8, z * k);
  }
  return geometry;
}

function paint(geometry: BufferGeometry, color: Color, shade = 0) {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < count; i += 1) {
    // Darker toward the inside and bottom of each tier, which reads as depth in the canopy.
    const radial = Math.hypot(position.getX(i), position.getZ(i));
    const k = 1 - shade * (1 - Math.min(1, radial / 2.5));
    colors[i * 3] = color.r * k;
    colors[i * 3 + 1] = color.g * k;
    colors[i * 3 + 2] = color.b * k;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** A pine about 12 units tall at scale 1: trunk and four ragged tiers. */
export function createPineGeometry(rng: Rng, foliage: Color, trunk: Color) {
  const parts: BufferGeometry[] = [];
  const stem = new CylinderGeometry(0.18, 0.4, 5, 5, 1);
  stem.translate(0, 2.5, 0);
  parts.push(paint(stem.toNonIndexed(), trunk));
  const tiers = [
    { radius: 3.3, height: 4.6, y: 4.2 },
    { radius: 2.7, height: 4.2, y: 6.6 },
    { radius: 2, height: 3.8, y: 8.9 },
    { radius: 1.2, height: 3.4, y: 11 },
  ];
  for (const tier of tiers) {
    const cone = new ConeGeometry(tier.radius, tier.height, 8, 2, true);
    cone.translate(0, tier.y, 0);
    parts.push(paint(jagged(cone, 0.35, rng() * 50).toNonIndexed(), foliage, 0.45));
    const underside = new ConeGeometry(tier.radius * 0.95, 0.6, 8, 1, true);
    underside.rotateX(Math.PI);
    underside.translate(0, tier.y - tier.height / 2 + 0.3, 0);
    parts.push(paint(underside.toNonIndexed(), foliage, 0.8));
  }
  const merged = mergeGeometries(parts.map((part) => {
    part.deleteAttribute('uv');
    return part;
  }));
  merged.computeVertexNormals();
  // Bend foliage normals toward up so the canopy reads as soft masses rather than facets.
  const normal = merged.getAttribute('normal');
  const n = new Vector3();
  for (let i = 0; i < normal.count; i += 1) {
    n.fromBufferAttribute(normal, i).lerp(up, 0.45).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  return merged;
}

/** A drowned pine: a bleached trunk with broken branch stubs, about 16 units at scale 1. */
export function createSnagGeometry(rng: Rng, color: Color) {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.08, 0.55, 16, 6, 4);
  trunk.translate(0, 8, 0);
  parts.push(trunk.toNonIndexed());
  for (let i = 0; i < 6; i += 1) {
    const length = 1 + rng() * 2.6;
    const branch = new CylinderGeometry(0.04, 0.14, length, 4, 1);
    branch.translate(0, length / 2, 0);
    branch.rotateZ(1.1 + rng() * 0.5);
    branch.rotateY(rng() * Math.PI * 2);
    branch.translate(0, 6 + rng() * 8, 0);
    parts.push(branch.toNonIndexed());
  }
  const merged = mergeGeometries(parts.map((part) => {
    part.deleteAttribute('uv');
    return part;
  }));
  merged.computeVertexNormals();
  return paint(merged, color);
}

/** A rounded, fractured boulder of radius ~1. */
export function createBoulderGeometry(seed: number) {
  const geometry = new IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position');
  const p = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i);
    const k = 1 + 0.22 * noise3(p.x * 1.3 + seed, p.y * 1.3, p.z * 1.3) + 0.08 * noise3(p.x * 3.1, p.y * 3.1 + seed, p.z * 3.1);
    p.multiplyScalar(k);
    p.y *= 0.72;
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.deleteAttribute('uv');
  const flat = geometry.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

const matrix = new Matrix4();
const rotation = new Quaternion();
const tilt = new Quaternion();
const scale = new Vector3();
const axis = new Vector3();

function instanceMatrix(placement: Placement) {
  rotation.setFromAxisAngle(up, placement.yaw);
  if (placement.lean) {
    axis.set(Math.cos(placement.yaw), 0, Math.sin(placement.yaw));
    tilt.setFromAxisAngle(axis, placement.lean);
    rotation.premultiply(tilt);
  }
  scale.setScalar(placement.scale);
  return matrix.compose(placement.position, rotation, scale);
}

/** Instanced props, one mesh per group so an off-screen group is culled whole. */
export function createInstancedField(options: {
  geometry: BufferGeometry;
  material: Material;
  placements: Placement[];
  /**
   * Groups placements into meshes, so a group off screen is culled. Keep the groups
   * few and large: three compiles a separate shader and pipeline for every
   * InstancedMesh, so hundreds of small cells cost hundreds of compiles over a run.
   */
  groupOf: (placement: Placement) => number;
  castShadow: boolean;
  /** Per-instance float attributes, e.g. the local water level for wet rock. */
  attributes?: Record<string, (placement: Placement) => number>;
}) {
  const group = new Group();
  const cells = new Map<number, Placement[]>();
  for (const placement of options.placements) {
    const key = options.groupOf(placement);
    const list = cells.get(key);
    if (list) list.push(placement);
    else cells.set(key, [placement]);
  }
  for (const list of cells.values()) {
    const geometry = options.attributes ? options.geometry.clone() : options.geometry;
    for (const [name, value] of Object.entries(options.attributes ?? {})) {
      geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(list.map(value)), 1));
    }
    const mesh = new InstancedMesh(geometry, options.material, list.length);
    list.forEach((placement, index) => {
      mesh.setMatrixAt(index, instanceMatrix(placement));
      if (placement.tint) mesh.setColorAt(index, placement.tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = options.castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function createFoliageMaterial() {
  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  material.name = 'foliage';
  return material;
}
