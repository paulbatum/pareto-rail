import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Path,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../engine/rng';

// Leaf: the great west rose. Glass (a disc mosaic in every jewel), the stone
// tracery in front of it, the light it throws when it ignites (a burst halo
// and a cone of coloured shafts pouring down the nave), the Thing nested in
// it, and the black tendrils that tie the Thing's claws back to the glass.

export type RoseParts = {
  group: Group;
  glass: MeshBasicMaterial;
  burst: MeshBasicMaterial;
  shafts: MeshBasicMaterial;
  nest: Group;
  nestEyes: MeshBasicMaterial[];
  tendrils: InstancedMesh;
};

const TENDRIL_SEGMENTS = 14;
export const TENDRIL_CAPACITY = 12;

function roseGlassGeometry(radius: number, jewels: readonly Color[]) {
  const rng = mulberry32(777);
  const positions: number[] = [];
  const colors: number[] = [];
  const push = (points: Array<[number, number]>, color: Color) => {
    for (const [x, y] of points) {
      positions.push(x, y, 0);
      colors.push(color.r, color.g, color.b);
    }
  };
  // Rings laid out to match the tracery openings, one pane colour per
  // opening: a gold heart, red and blue petals, green and gold lights, a
  // cobalt rim.
  const rings = [
    { inner: 0, outer: 0.2, count: 8, offset: 0, scheme: [3] },
    { inner: 0.2, outer: 0.44, count: 12, offset: 0, scheme: [1, 0] },
    { inner: 0.44, outer: 0.665, count: 12, offset: 0, scheme: [0, 2, 0, 1] },
    { inner: 0.665, outer: 0.885, count: 12, offset: Math.PI / 12, scheme: [2, 3, 1, 3] },
    { inner: 0.885, outer: 1.0, count: 24, offset: 0, scheme: [0, 3] },
  ];
  for (const ring of rings) {
    const width = (Math.PI * 2) / ring.count;
    for (let i = 0; i < ring.count; i += 1) {
      const a0 = ring.offset + (i - 0.5) * width;
      const a1 = a0 + width;
      const hue = ring.scheme[i % ring.scheme.length];
      const color = jewels[hue].clone().multiplyScalar(0.75 + rng() * 0.25);
      const r0 = ring.inner * radius;
      const r1 = ring.outer * radius;
      const steps = 4;
      for (let s = 0; s < steps; s += 1) {
        const b0 = a0 + ((a1 - a0) * s) / steps;
        const b1 = a0 + ((a1 - a0) * (s + 1)) / steps;
        const p0: [number, number] = [Math.cos(b0) * r0, Math.sin(b0) * r0];
        const p1: [number, number] = [Math.cos(b0) * r1, Math.sin(b0) * r1];
        const p2: [number, number] = [Math.cos(b1) * r1, Math.sin(b1) * r1];
        const p3: [number, number] = [Math.cos(b1) * r0, Math.sin(b1) * r0];
        push([p0, p1, p2, p0, p2, p3], color);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

function traceryGeometry(radius: number) {
  const shape = new Shape();
  shape.absarc(0, 0, radius + 0.6, 0, Math.PI * 2, false);
  const hole = (x: number, y: number, r: number) => shape.holes.push(new Path().absarc(x, y, r, 0, Math.PI * 2, true));
  hole(0, 0, radius * 0.17);
  for (let k = 0; k < 12; k += 1) {
    const angle = (k / 12) * Math.PI * 2;
    hole(Math.cos(angle) * radius * 0.33, Math.sin(angle) * radius * 0.33, radius * 0.07);
    hole(Math.cos(angle) * radius * 0.56, Math.sin(angle) * radius * 0.56, radius * 0.12);
    const outer = angle + Math.PI / 12;
    hole(Math.cos(outer) * radius * 0.77, Math.sin(outer) * radius * 0.77, radius * 0.1);
  }
  for (let k = 0; k < 24; k += 1) {
    const angle = (k / 24) * Math.PI * 2;
    hole(Math.cos(angle) * radius * 0.93, Math.sin(angle) * radius * 0.93, radius * 0.045);
  }
  const geometry = new ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: false, curveSegments: 20 });
  geometry.translate(0, 0, 0.1);
  return geometry;
}

/** Radial burst: jewel spokes fading outward. */
function burstGeometry(radius: number, jewels: readonly Color[]) {
  const positions: number[] = [];
  const colors: number[] = [];
  const spokes = 48;
  for (let i = 0; i < spokes; i += 1) {
    const a0 = (i / spokes) * Math.PI * 2;
    const a1 = ((i + 1) / spokes) * Math.PI * 2;
    const hue = jewels[(i * 5) % jewels.length];
    const reach = radius * (0.7 + ((i * 7) % 5) * 0.12);
    positions.push(0, 0, 0, Math.cos(a0) * reach, Math.sin(a0) * reach, 0, Math.cos(a1) * reach, Math.sin(a1) * reach, 0);
    colors.push(hue.r, hue.g, hue.b, 0, 0, 0, 0, 0, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Coloured shafts from the rose down the nave toward the viewer (+Z). */
function shaftConeGeometry(radius: number, length: number, jewels: readonly Color[]) {
  const positions: number[] = [];
  const colors: number[] = [];
  const beams = 16;
  for (let i = 0; i < beams; i += 1) {
    const angle = (i / beams) * Math.PI * 2;
    const hue = jewels[i % jewels.length];
    const start = new Vector3(Math.cos(angle) * radius * 0.55, Math.sin(angle) * radius * 0.55, 0);
    const end = new Vector3(Math.cos(angle) * radius * 1.3, Math.sin(angle) * radius * 1.1 - length * 0.35, length);
    const side = new Vector3(-Math.sin(angle), Math.cos(angle), 0).multiplyScalar(radius * 0.13);
    const quad = [
      start.clone().sub(side), start.clone().add(side), end.clone().add(side.clone().multiplyScalar(2.5)), end.clone().sub(side.clone().multiplyScalar(2.5)),
    ];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(quad[index].x, quad[index].y, quad[index].z);
      const v = index < 2 ? 1 : 0;
      colors.push(hue.r * v, hue.g * v, hue.b * v);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

function nestGeometry() {
  const rng = mulberry32(1313);
  const parts: BufferGeometry[] = [];
  const core = new SphereGeometry(3.2, 12, 10).toNonIndexed();
  parts.push(core);
  for (let i = 0; i < 46; i += 1) {
    const direction = new Vector3(rng() - 0.5, rng() - 0.5, (rng() - 0.3) * 0.8).normalize();
    const length = 4 + rng() * 9;
    const thorn = new ConeGeometry(0.35 + rng() * 0.5, length, 5).toNonIndexed();
    thorn.translate(0, length / 2, 0);
    thorn.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction));
    thorn.translate(direction.x * 2.4, direction.y * 2.4, direction.z * 2.4);
    parts.push(thorn);
  }
  return mergeGeometries(parts.map((part) => {
    for (const name of Object.keys(part.attributes)) if (name !== 'position') part.deleteAttribute(name);
    return part;
  }))!;
}

export function createRose(center: Vector3, radius: number, jewels: readonly Color[], stone: Material): RoseParts {
  const group = new Group();
  group.position.copy(center);

  const glass = new MeshBasicMaterial({ vertexColors: true, color: new Color(0.03, 0.03, 0.03), side: DoubleSide });
  const glassMesh = new Mesh(roseGlassGeometry(radius, jewels), glass);
  glassMesh.position.z = -0.4;
  group.add(glassMesh);

  const tracery = new Mesh(traceryGeometry(radius), stone);
  group.add(tracery);

  const burst = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, color: new Color(0, 0, 0) });
  const burstMesh = new Mesh(burstGeometry(radius * 2.1, jewels), burst);
  burstMesh.position.z = 1.4;
  burstMesh.userData.raildIgnoreOcclusion = true;
  group.add(burstMesh);

  const shafts = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, color: new Color(0, 0, 0) });
  const shaftMesh = new Mesh(shaftConeGeometry(radius, 70, jewels), shafts);
  shaftMesh.position.z = 1.2;
  shaftMesh.userData.raildIgnoreOcclusion = true;
  group.add(shaftMesh);

  // The Thing, nested: a knot of black thorns with the stolen colours
  // smouldering inside it.
  const nest = new Group();
  nest.add(new Mesh(nestGeometry(), new MeshBasicMaterial({ color: new Color(0.003, 0.003, 0.004) })));
  const nestEyes: MeshBasicMaterial[] = [];
  const eyeGeometry = new OctahedronGeometry(0.55, 0);
  for (let i = 0; i < 12; i += 1) {
    const material = new MeshBasicMaterial({ color: jewels[i % jewels.length].clone(), transparent: true, blending: AdditiveBlending, depthWrite: false });
    const eye = new Mesh(eyeGeometry, material);
    const angle = (i / 12) * Math.PI * 2;
    eye.position.set(Math.cos(angle) * (1.6 + (i % 3) * 0.7), Math.sin(angle) * (1.4 + (i % 2) * 0.9), 3.1);
    nest.add(eye);
    nestEyes.push(material);
  }
  nest.position.z = 2;
  group.add(nest);

  const tendrils = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: new Color(0.004, 0.004, 0.006) }), TENDRIL_CAPACITY * TENDRIL_SEGMENTS);
  tendrils.count = 0;
  tendrils.frustumCulled = false;
  tendrils.userData.raildIgnoreOcclusion = true;

  return { group, glass, burst, shafts, nest, nestEyes, tendrils };
}

const MATRIX = new Matrix4();
const ORIGIN = new Vector3();
const TARGET = new Vector3();
const CONTROL = new Vector3();
const A = new Vector3();
const B = new Vector3();
const DIRECTION = new Vector3();
const ROTATION = new Quaternion();
const SCALE = new Vector3();
const Z = new Vector3(0, 0, 1);

/** Lays out black tendrils from anchor points on the rose to each held target. */
export function layoutTendrils(tendrils: InstancedMesh, links: Array<{ from: Vector3; to: Vector3; thickness: number; sway: number }>) {
  let index = 0;
  for (const link of links.slice(0, TENDRIL_CAPACITY)) {
    ORIGIN.copy(link.from);
    TARGET.copy(link.to);
    CONTROL.copy(ORIGIN).lerp(TARGET, 0.5);
    CONTROL.y += 4 + link.sway;
    CONTROL.x += link.sway * 0.8;
    for (let s = 0; s < TENDRIL_SEGMENTS; s += 1) {
      const t0 = s / TENDRIL_SEGMENTS;
      const t1 = (s + 1) / TENDRIL_SEGMENTS;
      bezier(A, ORIGIN, CONTROL, TARGET, t0);
      bezier(B, ORIGIN, CONTROL, TARGET, t1);
      DIRECTION.copy(B).sub(A);
      const length = DIRECTION.length();
      if (length < 1e-4) continue;
      ROTATION.setFromUnitVectors(Z, DIRECTION.multiplyScalar(1 / length));
      const thickness = link.thickness * (1 - t0 * 0.75);
      SCALE.set(thickness, thickness, length * 1.08);
      MATRIX.compose(A.clone().lerp(B, 0.5), ROTATION, SCALE);
      tendrils.setMatrixAt(index, MATRIX);
      index += 1;
    }
  }
  tendrils.count = index;
  tendrils.instanceMatrix.needsUpdate = true;
}

function bezier(out: Vector3, p0: Vector3, p1: Vector3, p2: Vector3, t: number) {
  const u = 1 - t;
  return out.set(
    u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
  );
}
