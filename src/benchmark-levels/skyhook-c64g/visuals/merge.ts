import { BufferGeometry, Euler, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Draw-call and geometry discipline. Everything in this level is built from
// primitives, and there are a lot of them — so static pieces are baked into one
// geometry per material, and per-enemy geometry is built once and shared.

const scratchMatrix = new Matrix4();
const scratchQuat = new Quaternion();
const scratchEuler = new Euler();
const scratchScale = new Vector3(1, 1, 1);
const scratchPos = new Vector3();

export type Placement = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
};

/** Bakes primitives into one merged geometry per tag. */
export class MergeBuilder {
  private buckets = new Map<string, BufferGeometry[]>();

  add(geometry: BufferGeometry, tag: string, placement: Placement = {}) {
    const clone = geometry.clone();
    scratchPos.set(...(placement.position ?? [0, 0, 0]));
    scratchEuler.set(...(placement.rotation ?? [0, 0, 0]));
    scratchQuat.setFromEuler(scratchEuler);
    if (typeof placement.scale === 'number') scratchScale.setScalar(placement.scale);
    else scratchScale.set(...(placement.scale ?? [1, 1, 1]));
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
    clone.applyMatrix4(scratchMatrix);
    const bucket = this.buckets.get(tag) ?? [];
    bucket.push(clone);
    this.buckets.set(tag, bucket);
    return this;
  }

  /** Bake every mesh under `root` (with its world transform) into the bucket chosen by `tag`. */
  addObject(root: Object3D, tag: string | ((mesh: Mesh) => string)) {
    root.updateMatrixWorld(true);
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const clone = mesh.geometry.clone();
      clone.applyMatrix4(mesh.matrixWorld);
      const key = typeof tag === 'string' ? tag : tag(mesh);
      const bucket = this.buckets.get(key) ?? [];
      bucket.push(clone);
      this.buckets.set(key, bucket);
    });
    return this;
  }

  /** One merged geometry per tag. Source clones are released. */
  build(): Map<string, BufferGeometry> {
    const result = new Map<string, BufferGeometry>();
    for (const [tag, list] of this.buckets) {
      // Merged primitives must agree on attributes and indexing: keep only the
      // common set, and de-index everything if the bucket mixes both kinds.
      const mixed = list.some((geometry) => geometry.index) && list.some((geometry) => !geometry.index);
      const prepared = list.map((geometry) => {
        geometry.deleteAttribute('uv');
        return mixed && geometry.index ? geometry.toNonIndexed() : geometry;
      });
      const merged = prepared.length === 1 ? prepared[0] : mergeGeometries(prepared, false);
      if (merged) result.set(tag, merged);
      if (prepared.length > 1) for (const geometry of [...list, ...prepared]) if (geometry !== merged) geometry.dispose();
    }
    this.buckets.clear();
    return result;
  }
}

/** Memoise a value built from primitives (shared geometry for enemy meshes). */
const shared = new Map<string, unknown>();
export function once<T>(key: string, build: () => T): T {
  if (!shared.has(key)) shared.set(key, build());
  return shared.get(key) as T;
}

/** Dispose the materials under an object but leave (shared) geometry alone. */
export function disposeMaterials(object: Object3D) {
  object.traverse((child) => {
    const material = (child as Mesh).material as Material | Material[] | undefined;
    if (!material) return;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  });
}

/** Add merged, single-material meshes for every tag to a parent; returns them by tag. */
export function addMerged(parent: Object3D, builder: MergeBuilder, materials: Record<string, Material>, flags: { ignoreOcclusion?: boolean } = {}) {
  const meshes: Record<string, Mesh> = {};
  for (const [tag, geometry] of builder.build()) {
    const material = materials[tag];
    if (!material) throw new Error(`No material for merge tag "${tag}"`);
    const mesh = new Mesh(geometry, material);
    if (flags.ignoreOcclusion) mesh.userData.raildIgnoreOcclusion = true;
    mesh.frustumCulled = false;
    parent.add(mesh);
    meshes[tag] = mesh;
  }
  return meshes;
}

export function emptyGroup() {
  return new Group();
}
