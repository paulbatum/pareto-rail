import {
  BufferGeometry,
  Color,
  EdgesGeometry,
  Euler,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { createLightMaterial, createPanelMaterial, type PanelMaterial } from './materials';
import { hdr, INSTRUMENT } from './palette';

// Enemy meshes are built once as templates: every static part is merged into
// one geometry per material bucket, edges into one line set, and the result is
// cached. Instances share those geometries and only own their materials (for
// tinting) and their animated parts. Nothing per-spawn ever allocates GPU
// geometry, so the run's geometry count stays flat.

export type TintKind = 'body' | 'light' | 'edge';
export type BodyState = 'normal' | 'locked' | 'denied' | 'flash';
export type TintPart = {
  material: PanelMaterial | MeshBasicMaterial | LineBasicMaterial;
  base: Color;
  kind: TintKind;
  panel: boolean;
  /** Body parts swap between shared cached materials instead of owning one. */
  mesh?: Mesh;
};

// Shaded body panels are shared per (colour, state): a node material carries a
// whole shader graph, and one per enemy instance would pile up in the heap
// over a run. Lights and edges stay per instance; they are plain materials.
const DENY_BODY = new Color(0.32, 0.04, 0.02);
const FLASH_BODY = new Color(0.9, 0.88, 0.85);
const bodyMaterials = new Map<string, PanelMaterial>();

export function panelMaterialFor(base: Color, state: BodyState) {
  const key = `${base.getHexString()}|${state}`;
  const cached = bodyMaterials.get(key);
  if (cached) return cached;
  const color = state === 'locked'
    ? base.clone().lerp(INSTRUMENT, 0.35)
    : state === 'denied'
      ? DENY_BODY
      : state === 'flash'
        ? FLASH_BODY
        : base;
  const material = createPanelMaterial(color);
  material.userData.shared = true;
  bodyMaterials.set(key, material);
  return material;
}

export function setBodyState(part: TintPart, state: BodyState) {
  if (!part.mesh) return;
  const material = panelMaterialFor(part.base, state);
  if (part.mesh.material !== material) part.mesh.material = material;
}

export type PartKind = 'body' | 'light';

type Triple = [number, number, number];
type Transform = { position?: Triple; rotation?: Triple; scale?: Triple | number };
type PartOptions = Transform & {
  /** Animated part: gets its own mesh (and pivot group) reachable through group.userData.tagged. */
  tag?: string;
  /** Force a separate merge bucket for static parts that share colour but need their own material. */
  bucket?: string;
  pivot?: { position: Triple; rotation?: Triple };
  edges?: [Color, number];
};

type StaticBucket = { kind: PartKind; color: Color; intensity: number; bucket: string; geometries: BufferGeometry[] };
type EdgeBucket = { color: Color; intensity: number; geometries: BufferGeometry[] };
type DynamicPart = {
  tag: string;
  kind: PartKind;
  color: Color;
  intensity: number;
  geometry: BufferGeometry;
  transform: Transform;
  pivot?: { position: Triple; rotation?: Triple };
};

export type EnemyTemplate = {
  statics: Array<{ kind: PartKind; color: Color; intensity: number; bucket: string; geometry: BufferGeometry }>;
  dynamics: DynamicPart[];
  edges: Array<{ color: Color; intensity: number; geometry: BufferGeometry }>;
};

export type TemplateBuilder = {
  panel(geometry: BufferGeometry, color: Color, options?: PartOptions): void;
  light(geometry: BufferGeometry, color: Color, intensity: number, options?: PartOptions): void;
};

const identity = new Matrix4();

function matrixFor(options: Transform) {
  const position = new Vector3(...(options.position ?? [0, 0, 0]));
  const rotation = new Euler(...(options.rotation ?? [0, 0, 0]));
  const scale = options.scale === undefined ? new Vector3(1, 1, 1) : typeof options.scale === 'number' ? new Vector3(options.scale, options.scale, options.scale) : new Vector3(...options.scale);
  return new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), scale);
}

function nonIndexed(geometry: BufferGeometry) {
  const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  return copy;
}

/** Merge several placed geometries into one (for a single animated part built from pieces). */
export function mergeParts(parts: Array<[BufferGeometry, Transform?]>) {
  const pieces = parts.map(([geometry, transform]) => nonIndexed(geometry).applyMatrix4(transform ? matrixFor(transform) : identity));
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return merged;
}

export function buildTemplate(define: (builder: TemplateBuilder) => void): EnemyTemplate {
  const staticBuckets = new Map<string, StaticBucket>();
  const edgeBuckets = new Map<string, EdgeBucket>();
  const dynamics: DynamicPart[] = [];

  const dynamicBuckets = new Map<string, Array<{ kind: PartKind; color: Color; intensity: number; geometry: BufferGeometry; options: PartOptions }>>();

  const add = (kind: PartKind, geometry: BufferGeometry, color: Color, intensity: number, options: PartOptions) => {
    if (options.tag) {
      // Pivoted parts stay individual; un-pivoted parts sharing a tag merge into one mesh.
      if (options.pivot) {
        dynamics.push({ tag: options.tag, kind, color: color.clone(), intensity, geometry, transform: options, pivot: options.pivot });
        return;
      }
      const bucket = dynamicBuckets.get(options.tag) ?? [];
      bucket.push({ kind, color: color.clone(), intensity, geometry, options });
      dynamicBuckets.set(options.tag, bucket);
      return;
    }
    const matrix = matrixFor(options);
    const bucketName = options.bucket ?? '';
    const key = `${kind}|${color.getHexString()}|${intensity}|${bucketName}`;
    const bucket = staticBuckets.get(key) ?? { kind, color: color.clone(), intensity, bucket: bucketName, geometries: [] };
    bucket.geometries.push(nonIndexed(geometry).applyMatrix4(matrix));
    staticBuckets.set(key, bucket);
    if (options.edges) {
      const [edgeColor, edgeIntensity] = options.edges;
      const edgeKey = `${edgeColor.getHexString()}|${edgeIntensity}`;
      const edgeBucket = edgeBuckets.get(edgeKey) ?? { color: edgeColor.clone(), intensity: edgeIntensity, geometries: [] };
      edgeBucket.geometries.push(new EdgesGeometry(geometry).applyMatrix4(matrix));
      edgeBuckets.set(edgeKey, edgeBucket);
    }
  };

  define({
    panel: (geometry, color, options = {}) => add('body', geometry, color, 1, options),
    light: (geometry, color, intensity, options = {}) => add('light', geometry, color, intensity, options),
  });

  for (const [tag, bucket] of dynamicBuckets) {
    if (bucket.length === 1) {
      const only = bucket[0];
      dynamics.push({ tag, kind: only.kind, color: only.color, intensity: only.intensity, geometry: only.geometry, transform: only.options });
      continue;
    }
    const pieces = bucket.map((part) => nonIndexed(part.geometry).applyMatrix4(matrixFor(part.options)));
    const merged = mergeGeometries(pieces);
    for (const piece of pieces) piece.dispose();
    dynamics.push({ tag, kind: bucket[0].kind, color: bucket[0].color, intensity: bucket[0].intensity, geometry: merged, transform: {} });
  }

  const statics = [...staticBuckets.values()].map((bucket) => {
    const geometry = mergeGeometries(bucket.geometries);
    for (const piece of bucket.geometries) piece.dispose();
    return { kind: bucket.kind, color: bucket.color, intensity: bucket.intensity, bucket: bucket.bucket, geometry };
  });
  const edges = [...edgeBuckets.values()].map((bucket) => {
    const geometry = mergeGeometries(bucket.geometries);
    for (const piece of bucket.geometries) piece.dispose();
    return { color: bucket.color, intensity: bucket.intensity, geometry };
  });
  return { statics, dynamics, edges };
}

export function cachedTemplate(define: (builder: TemplateBuilder) => void) {
  let template: EnemyTemplate | null = null;
  return () => (template ??= buildTemplate(define));
}

function applyTransform(object: Object3D, transform: Transform) {
  object.position.set(...(transform.position ?? [0, 0, 0]));
  object.rotation.set(...(transform.rotation ?? [0, 0, 0]));
  if (transform.scale !== undefined) {
    if (typeof transform.scale === 'number') object.scale.setScalar(transform.scale);
    else object.scale.set(...transform.scale);
  }
}

export function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

/** Materialise a template into `group`; returns the animated parts by tag. */
export function instantiateTemplate(template: EnemyTemplate, group: Group) {
  const parts = tintable(group);
  const tagged: Record<string, Object3D> = (group.userData.tagged ??= {});

  const materialFor = (kind: PartKind, color: Color, intensity: number) => (kind === 'body' ? panelMaterialFor(color, 'normal') : createLightMaterial(color, intensity));

  for (const entry of template.statics) {
    const material = materialFor(entry.kind, entry.color, entry.intensity);
    const mesh = new Mesh(entry.geometry, material);
    group.add(mesh);
    parts.push({ material, base: entry.kind === 'body' ? entry.color.clone() : hdr(entry.color, entry.intensity), kind: entry.kind, panel: entry.kind === 'body', mesh });
  }
  for (const entry of template.dynamics) {
    const material = materialFor(entry.kind, entry.color, entry.intensity);
    const mesh = new Mesh(entry.geometry, material);
    applyTransform(mesh, entry.transform);
    mesh.userData.tag = entry.tag;
    let handle: Object3D = mesh;
    if (entry.pivot) {
      const pivot = new Group();
      pivot.position.set(...entry.pivot.position);
      pivot.rotation.set(...(entry.pivot.rotation ?? [0, 0, 0]));
      pivot.add(mesh);
      group.add(pivot);
      handle = pivot;
    } else {
      group.add(mesh);
    }
    tagged[entry.tag] = handle;
    parts.push({ material, base: entry.kind === 'body' ? entry.color.clone() : hdr(entry.color, entry.intensity), kind: entry.kind, panel: entry.kind === 'body', mesh });
  }
  for (const entry of template.edges) {
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(entry.color, entry.intensity) }));
    group.add(new LineSegments(entry.geometry, material));
    parts.push({ material, base: hdr(entry.color, entry.intensity), kind: 'edge', panel: false });
  }
  return tagged;
}

export function taggedPart(group: Object3D, tag: string): Object3D | undefined {
  return (group.userData.tagged as Record<string, Object3D> | undefined)?.[tag];
}

export function taggedMesh(group: Object3D, tag: string): Mesh | undefined {
  const handle = taggedPart(group, tag);
  if (!handle) return undefined;
  if (handle instanceof Mesh) return handle;
  return handle.children.find((child): child is Mesh => child instanceof Mesh);
}
