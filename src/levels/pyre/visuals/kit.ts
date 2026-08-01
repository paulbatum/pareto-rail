import {
  BoxGeometry,
  BufferAttribute,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { BufferGeometry, Material } from 'three';
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
