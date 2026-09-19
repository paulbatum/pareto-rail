import { BufferGeometry, Euler, Float32BufferAttribute, LatheGeometry, Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import type { Color } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, dot, float, fract, max, mix, positionGeometry, smoothstep, step, uniform, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { fractalNoise } from '../../../engine/tsl-surface';

// Machine parts: chamfered boxes and lathed drums merged into one geometry per
// model, each vertex carrying its finish. One lit material draws them all:
// yellow paint chipped to bare steel on the chamfers and in noise patches,
// grime in the low spots, diagonal hazard stripes where a part asks for them,
// and lamps that glow.

export type Finish = {
  color: Color;
  metal?: number;
  rough?: number;
  /** Emissive strength; lamps use it. */
  glow?: number;
  /** Painted surfaces wear through to steel on their edges. */
  paint?: boolean;
  /** Diagonal hazard stripes over the paint. */
  hazard?: boolean;
};

/** Which vertices count as an edge for wear: flat chamfers on boxes, the rim bands on lathed parts. */
export type WearRule = 'box' | 'lathe' | 'none';

export type Placement = { at?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] };

/** A box with its twelve edges cut at 45 degrees; the cuts are what wears to steel. */
export function chamferBox(width: number, height: number, depth: number, chamfer = Math.min(width, height, depth) * 0.18) {
  const points: Vector3[] = [];
  const [x, y, z] = [width / 2, height / 2, depth / 2];
  const c = Math.min(chamfer, x * 0.9, y * 0.9, z * 0.9);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        points.push(
          new Vector3(sx * (x - c), sy * (y - c), sz * z),
          new Vector3(sx * (x - c), sy * y, sz * (z - c)),
          new Vector3(sx * x, sy * (y - c), sz * (z - c)),
        );
      }
    }
  }
  return new ConvexGeometry(points);
}

/** A hull through the given points (a wedge, a claw finger); faces are flat. */
export function hull(points: Array<[number, number, number]>) {
  return new ConvexGeometry(points.map(([x, y, z]) => new Vector3(x, y, z)));
}

/** A drum around +Y with chamfered rims. */
export function drum(radius: number, height: number, chamfer = radius * 0.15, segments = 18) {
  const h = height / 2;
  const profile = [
    new Vector2(0, -h),
    new Vector2(radius - chamfer, -h),
    new Vector2(radius, -h + chamfer),
    new Vector2(radius, h - chamfer),
    new Vector2(radius - chamfer, h),
    new Vector2(0, h),
  ];
  return new LatheGeometry(profile, segments);
}

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchEuler = new Euler();

export function createPartBuilder() {
  const parts: BufferGeometry[] = [];

  return {
    add(geometry: BufferGeometry, finish: Finish, place: Placement = {}, wear: WearRule = 'box') {
      const part = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      geometry.dispose();
      for (const name of Object.keys(part.attributes)) if (name !== 'position' && name !== 'normal') part.deleteAttribute(name);
      if (!part.attributes.normal) part.computeVertexNormals();
      const count = part.attributes.position.count;
      const normals = part.attributes.normal;
      const color = new Float32Array(count * 3);
      const surface = new Float32Array(count * 4);
      const detail = new Float32Array(count * 2);
      for (let i = 0; i < count; i += 1) {
        const nx = Math.abs(normals.getX(i));
        const ny = Math.abs(normals.getY(i));
        const nz = Math.abs(normals.getZ(i));
        const edge = wear === 'box' ? Number(Math.max(nx, ny, nz) < 0.9) : wear === 'lathe' ? Number(ny > 0.25 && ny < 0.92) : 0;
        color.set([finish.color.r, finish.color.g, finish.color.b], i * 3);
        surface.set([finish.metal ?? 0.35, finish.rough ?? 0.6, finish.glow ?? 0, finish.paint ? 1 : 0], i * 4);
        detail.set([edge, finish.hazard ? 1 : 0], i * 2);
      }
      part.setAttribute('color', new Float32BufferAttribute(color, 3));
      part.setAttribute('surface', new Float32BufferAttribute(surface, 4));
      part.setAttribute('detail', new Float32BufferAttribute(detail, 2));
      const [px, py, pz] = place.at ?? [0, 0, 0];
      const [rx, ry, rz] = place.rot ?? [0, 0, 0];
      const [sx, sy, sz] = place.scale ?? [1, 1, 1];
      scratchQuaternion.setFromEuler(scratchEuler.set(rx, ry, rz));
      part.applyMatrix4(scratchMatrix.compose(new Vector3(px, py, pz), scratchQuaternion, new Vector3(sx, sy, sz)));
      parts.push(part);
    },
    build() {
      const merged = mergeGeometries(parts);
      if (!merged) throw new Error('machine parts failed to merge');
      for (const part of parts) part.dispose();
      parts.length = 0;
      merged.computeBoundingSphere();
      return merged;
    },
  };
}

export type MachineFx = {
  /** 0..1 white flash from a hit. */
  flash: Node<'float'>;
  /** Lamp brightness multiplier. */
  lamp: Node<'float'>;
  /** 0..1 grey-out from a rejected release. */
  deny: Node<'float'>;
};

/** Per-object effect levels read from `object.userData.fx`, for models that are ordinary meshes. */
export function objectFx(): MachineFx {
  const read = (name: 'flash' | 'lamp' | 'deny', fallback: number) =>
    uniform(fallback).onObjectUpdate(({ object }) => (object?.userData.fx?.[name] as number | undefined) ?? fallback);
  return { flash: read('flash', 0), lamp: read('lamp', 1), deny: read('deny', 0) };
}

export function createMachineMaterial(fx: MachineFx, options: { bare: Color; hazard: Color; wearScale?: number; stripeScale?: number }) {
  const albedo = attribute<'vec3'>('color', 'vec3');
  const surface = attribute<'vec4'>('surface', 'vec4');
  const detail = attribute<'vec2'>('detail', 'vec2');
  const p = positionGeometry;
  const chips = fractalNoise(p, { scale: options.wearScale ?? 2.4, octaves: 3 });
  const grime = fractalNoise(p.add(vec3(7.3, 1.1, 4.9)), { scale: 0.8, octaves: 2 });
  const worn = surface.w.mul(max(detail.x.mul(0.9), smoothstep(0.62, 0.67, chips)));
  const stripe = step(0.5, fract(p.x.add(p.y).add(p.z).mul(options.stripeScale ?? 2.6)));
  const painted = mix(albedo, vec3(options.hazard.r, options.hazard.g, options.hazard.b), detail.y.mul(stripe));
  const base = mix(painted, vec3(options.bare.r, options.bare.g, options.bare.b), worn).mul(mix(float(0.78), float(1), grime));
  const grey = vec3(dot(base, vec3(0.3, 0.59, 0.11)).mul(0.5));

  const material = new MeshStandardNodeMaterial();
  material.colorNode = mix(base, grey, fx.deny);
  material.metalnessNode = mix(surface.x, float(0.85), worn);
  material.roughnessNode = mix(surface.y, float(0.35), worn);
  material.emissiveNode = albedo.mul(surface.z).mul(fx.lamp).add(vec3(fx.flash.mul(1.4), fx.flash.mul(1.2), fx.flash));
  return material;
}
