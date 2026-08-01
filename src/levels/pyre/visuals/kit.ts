import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { createEdges, type EdgeStyle } from '../../../engine/edge-overlay';
import { PYRE_LIGHT } from './world';

/**
 * Construction primitives for pyre's world. Everything here takes world metres
 * and decides nothing: sizes, positions and colours all arrive from `world.ts`.
 */

export interface EnvironmentBuild {
  group: Group;
  dispose(): void;
}

/**
 * Collects every geometry and material the environment owns so the level can
 * release them, and attaches the edge shells when the spine asks for them.
 * `edgeStyleFor` being null is the single switch that turns the overlay off.
 */
export class EnvironmentSink {
  readonly group = new Group();
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();

  constructor(private readonly edgeStyleFor: ((faceColor: number) => EdgeStyle) | null = null) {}

  add(object: Object3D) {
    this.group.add(object);
    return object;
  }

  outline(mesh: Mesh, faceColor: number, offset: number) {
    if (!this.edgeStyleFor) return;
    const lines = createEdges(mesh, { ...this.edgeStyleFor(faceColor), offset });
    mesh.add(lines);
    this.track(lines.geometry, lines.material as Material);
  }

  track(geometry: BufferGeometry, material: Material) {
    this.geometries.add(geometry);
    this.materials.add(material);
  }

  build(): EnvironmentBuild {
    const { group, geometries, materials } = this;
    return {
      group,
      dispose() {
        group.removeFromParent();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        geometries.clear();
        materials.clear();
      },
    };
  }
}

const LIGHT = new Vector3(...PYRE_LIGHT.direction).normalize();

const triangle = [new Vector3(), new Vector3(), new Vector3()];
const edgeA = new Vector3();
const edgeB = new Vector3();
const faceNormal = new Vector3();
const faceColor = new Color();

/**
 * Bakes flat facet shading into vertex colours. Aerial perspective is not baked:
 * the engine height haze does that per pixel.
 *
 * The blockout has no lights, so without this every mass is one unbroken colour
 * and a hundred-metre block reads as a card. Per-facet shading is what makes the
 * masses read as solids from any angle; a lighting pass later replaces it.
 */
export function shadeGeometry(source: BufferGeometry, color: number) {
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();

  const position = geometry.getAttribute('position');
  const base = new Color(color);
  const colors = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i += 3) {
    for (let corner = 0; corner < 3; corner += 1) triangle[corner].fromBufferAttribute(position, i + corner);
    edgeA.subVectors(triangle[1], triangle[0]);
    edgeB.subVectors(triangle[2], triangle[0]);
    faceNormal.crossVectors(edgeA, edgeB);
    if (faceNormal.lengthSq() < 1e-12) faceNormal.set(0, 1, 0);
    else faceNormal.normalize();

    const key = Math.max(faceNormal.dot(LIGHT), 0);
    const sky = faceNormal.y * 0.5 + 0.5;
    const level = PYRE_LIGHT.ambient + PYRE_LIGHT.key * key + PYRE_LIGHT.sky * sky;
    faceColor.copy(base).multiplyScalar(level);

    for (let corner = 0; corner < 3; corner += 1) {
      const index = (i + corner) * 3;
      colors[index] = faceColor.r;
      colors[index + 1] = faceColor.g;
      colors[index + 2] = faceColor.b;
      normals[index] = faceNormal.x;
      normals[index + 1] = faceNormal.y;
      normals[index + 2] = faceNormal.z;
    }
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  return geometry;
}

/**
 * How far an edge shell stands off the mass it traces.
 *
 * Depth precision coarsens with the square of distance, so a fixed offset that
 * clears the depth buffer at the pit rim vanishes on a mass kilometres out. The
 * ceiling is the mass's own thinnest dimension: a shell that stands off a wide
 * flat plate by more than a fraction of its thickness floats clear of it and
 * draws as a line hanging in the air in front of everything behind it.
 */
function edgeOffset(thinnest: number, distance: number) {
  return Math.min(Math.max(distance * 0.0015, 0.06), thinnest * 0.05);
}

export interface Mass {
  /** Centre in world metres. */
  x: number;
  y: number;
  z: number;
  /** Full extents in world metres. */
  sx: number;
  sy: number;
  sz: number;
  /** Degrees. */
  yaw?: number;
  roll?: number;
  pitch?: number;
  color: number;
  outline?: boolean;
}

const DEG = Math.PI / 180;
const origin = new Vector3();

export function addMass(sink: EnvironmentSink, mass: Mass) {
  origin.set(mass.x, mass.y, mass.z);
  const box = new BoxGeometry(mass.sx, mass.sy, mass.sz);
  const geometry = shadeGeometry(box, mass.color);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(origin);
  mesh.rotation.set(DEG * (mass.pitch ?? 0), DEG * (mass.yaw ?? 0), DEG * (mass.roll ?? 0));
  sink.track(geometry, material);
  if (mass.outline !== false) {
    sink.outline(mesh, mass.color, edgeOffset(Math.min(mass.sx, mass.sy, mass.sz), origin.length()));
  }
  return sink.add(mesh);
}

export interface Pyramid {
  x: number;
  z: number;
  /** Full base width, corner to corner along the axes. */
  base: number;
  height: number;
  /** Base altitude; sink it so the silhouette runs behind nearer masses. */
  y0: number;
  /** Degrees. 45 puts a corner toward a camera looking down -z. */
  yaw?: number;
  color: number;
  outline?: boolean;
}

export function addPyramid(sink: EnvironmentSink, pyramid: Pyramid) {
  // A 4-segment cone is a square pyramid whose corners sit at the radius.
  const cone = new ConeGeometry(pyramid.base / Math.SQRT2, pyramid.height, 4);
  origin.set(pyramid.x, pyramid.y0 + pyramid.height / 2, pyramid.z);
  const geometry = shadeGeometry(cone, pyramid.color);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(origin);
  mesh.rotation.y = DEG * (45 + (pyramid.yaw ?? 0));
  sink.track(geometry, material);
  if (pyramid.outline !== false) {
    sink.outline(mesh, pyramid.color, edgeOffset(pyramid.base * 0.2, origin.length()));
  }
  return sink.add(mesh);
}

/** Deterministic 0..1 hash, so tower silhouettes survive rebuilds unchanged. */
export function hash01(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** One tower storey: half-widths left/right of centre and its height. */
export type TowerSection = readonly [left: number, right: number, height: number];

export interface CragTower {
  x: number;
  z: number;
  /** Full extent along z. */
  depth: number;
  /** Stacked bottom-up from y0. */
  sections: readonly TowerSection[];
  y0?: number;
  /** Sideways slope as rise/run; positive leans toward +x. */
  lean?: number;
  /** Corner displacement as a fraction of the section size. */
  jitter?: number;
  seed?: number;
  color: number;
  outline?: boolean;
  /**
   * Optional surface override. When set, the baked vertex colours carry only the
   * grayscale facet level (base white) and this material is expected to multiply
   * them in — so facet shading survives under a procedural surface.
   */
  material?: Material;
}

/**
 * A tower of stacked box sections with every corner displaced by a hash of its
 * own index, so the silhouette breaks into rock instead of stepping in clean
 * right angles. Sections are independent boxes: the jitter pulls them apart at
 * the joints without tearing the mesh, and that separation is what reads as
 * erosion at distance.
 */
export function addCragTower(sink: EnvironmentSink, tower: CragTower) {
  const jitter = tower.jitter ?? 0.2;
  const seed = tower.seed ?? 0;
  const hd = tower.depth / 2;
  const positions: number[] = [];
  let y = 0;

  for (let si = 0; si < tower.sections.length; si += 1) {
    const [left, right, height] = tower.sections[si];
    const ring = [
      [-left, -hd],
      [right, -hd],
      [right, hd],
      [-left, hd],
    ] as const;
    const corner = (k: number, c: number) => {
      const [px, pz] = ring[c];
      const t = seed + si * 3.7 + k * 1.3 + px * 0.9 + pz * 0.6;
      return [
        px + (hash01(t, 5.0) - 0.5) * jitter * (left + right),
        y + k * height + (hash01(t, 17.0) - 0.5) * jitter * height,
        pz + (hash01(t, 11.0) - 0.5) * jitter * tower.depth,
      ];
    };
    const v = [corner(0, 0), corner(0, 1), corner(0, 2), corner(0, 3), corner(1, 0), corner(1, 1), corner(1, 2), corner(1, 3)];
    const quads = [
      [3, 2, 1, 0],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    for (const [a, b, c, d] of quads) {
      positions.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
    }
    y += height;
  }

  const raw = new BufferGeometry();
  raw.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  const geometry = shadeGeometry(raw, tower.material ? 0xffffff : tower.color);
  const material = tower.material ?? new MeshBasicMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);
  origin.set(tower.x, tower.y0 ?? 0, tower.z);
  mesh.position.copy(origin);
  mesh.rotation.z = Math.atan(-(tower.lean ?? 0));
  sink.track(geometry, material);
  if (tower.outline !== false) {
    const thinnest = Math.min(tower.depth, ...tower.sections.map(([l, r]) => l + r));
    sink.outline(mesh, tower.color, edgeOffset(thinnest, origin.length()));
  }
  return sink.add(mesh);
}

/**
 * A discrete light slit: flat, sharp, no texture. Authored over 1 so it blooms
 * and rolls filmic under AgX rather than reading as painted-on colour.
 */
export function addSlit(
  sink: EnvironmentSink,
  at: { x: number; y: number; z: number; sx: number; sy: number; sz: number },
  rgb: readonly [number, number, number],
  strength: number,
) {
  const geometry = new BoxGeometry(at.sx, at.sy, at.sz);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec3(rgb[0], rgb[1], rgb[2]).mul(strength);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(at.x, at.y, at.z);
  sink.track(geometry, material);
  return sink.add(mesh);
}

/** A ground slab named by its footprint and its top surface. */
export interface Plate {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
  drop: number;
  color: number;
  outline?: boolean;
}

export function addPlate(sink: EnvironmentSink, plate: Plate) {
  return addMass(sink, {
    x: (plate.x0 + plate.x1) / 2,
    y: plate.top - plate.drop / 2,
    z: (plate.z0 + plate.z1) / 2,
    sx: Math.abs(plate.x1 - plate.x0),
    sy: plate.drop,
    sz: Math.abs(plate.z1 - plate.z0),
    color: plate.color,
    outline: plate.outline,
  });
}
