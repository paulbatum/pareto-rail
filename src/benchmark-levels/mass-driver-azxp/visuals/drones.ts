import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Leaf: defense-drone meshes. Each factory takes its colours from the spine
// and returns a Group whose userData.tint lists the materials the spine
// recolours for lock, damage, charge, and denial.

export type DronePalette = {
  /** Dark hull. */
  body: Color;
  /** Bright outline and trim (HDR). */
  edge: Color;
  /** Hot core (HDR). */
  core: Color;
};

export type DroneTint = {
  edges: Array<LineBasicMaterial | MeshBasicMaterial>;
  cores: MeshBasicMaterial[];
  baseEdge: Color;
  baseCore: Color;
};

const LIGHT = new Vector3(0.35, 0.8, 0.5).normalize();

/** Bake flat directional shading into a hull so it reads without scene lights. */
function shaded(geometry: BufferGeometry, body: Color) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.computeVertexNormals();
  const normals = flat.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  const n = new Vector3();
  for (let i = 0; i < normals.count; i += 1) {
    n.fromBufferAttribute(normals, i);
    const light = 0.55 + Math.max(0, n.dot(LIGHT)) * 0.9 + Math.max(0, n.z) * 0.35;
    colors[i * 3] = body.r * light;
    colors[i * 3 + 1] = body.g * light;
    colors[i * 3 + 2] = body.b * light;
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return flat;
}

function strip(geometry: BufferGeometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
  return flat;
}

// Geometry is built once per drone kind and shared; only materials are
// per-instance, so a spawn never allocates GPU buffers.
const geometryCache = new Map<string, BufferGeometry>();
function memo(key: string, build: () => BufferGeometry) {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = build();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function hull(key: string, parts: () => BufferGeometry[], palette: DronePalette) {
  const geometry = memo(`${key}:hull`, () => shaded(mergeGeometries(parts().map(strip)), palette.body));
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
  const edgeMaterial = new LineBasicMaterial({ color: palette.edge, toneMapped: false });
  const edges = new LineSegments(memo(`${key}:edges`, () => new EdgesGeometry(geometry, 25)), edgeMaterial);
  return { mesh, edges, edgeMaterial };
}

function glow(color: Color) {
  return new MeshBasicMaterial({ color, toneMapped: false });
}

function finish(group: Group, kind: string, palette: DronePalette, edges: DroneTint['edges'], cores: MeshBasicMaterial[], radius: number) {
  const tint: DroneTint = { edges, cores, baseEdge: palette.edge.clone(), baseCore: palette.core.clone() };
  group.userData.kind = kind;
  group.userData.tint = tint;
  group.userData.radius = radius;
  return group;
}

/** Picket: a three-bladed spinner with hot blade tips. */
export function createPicketMesh(palette: DronePalette) {
  const group = new Group();
  const body = hull('picket', () => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 3; i += 1) {
      const blade = new OctahedronGeometry(1, 0);
      blade.scale(0.34, 1.25, 0.16);
      blade.translate(0, 1.2, 0);
      blade.rotateZ((i / 3) * Math.PI * 2);
      parts.push(blade);
    }
    const hub = new CylinderGeometry(0.5, 0.5, 0.34, 6);
    hub.rotateX(Math.PI / 2);
    parts.push(hub);
    return parts;
  }, palette);
  const coreMaterial = glow(palette.core);
  const core = new Mesh(memo('picket:core', () => new IcosahedronGeometry(0.34, 0)), coreMaterial);
  core.position.z = 0.2;
  const tips = new Mesh(memo('picket:tips', () => mergeGeometries([0, 1, 2].map((i) => {
    const tip = new OctahedronGeometry(0.2, 0);
    tip.translate(0, 2.5, 0);
    tip.rotateZ((i / 3) * Math.PI * 2);
    return strip(tip);
  }))), coreMaterial);
  const haloMaterial = glow(palette.edge);
  const halo = new Mesh(memo('picket:halo', () => new TorusGeometry(0.8, 0.06, 4, 36)), haloMaterial);
  group.add(body.mesh, body.edges, core, tips, halo);
  return finish(group, 'picket', palette, [body.edgeMaterial, haloMaterial], [coreMaterial], 2.6);
}

/** Threader: a long needle with two collars, built to dart through coils. */
export function createThreaderMesh(palette: DronePalette) {
  const group = new Group();
  const body = hull('threader', () => {
    const spine = new OctahedronGeometry(1, 0);
    spine.scale(0.42, 0.42, 2.1);
    const finA = new BoxGeometry(1.5, 0.08, 0.8);
    finA.translate(0, 0, -1.35);
    const finB = new BoxGeometry(0.08, 1.5, 0.8);
    finB.translate(0, 0, -1.35);
    return [spine, finA, finB];
  }, palette);
  const collarMaterial = glow(palette.edge);
  const collarGeometry = memo('threader:collar', () => new TorusGeometry(0.66, 0.08, 4, 28));
  const collars = [0.55, -0.45].map((z) => {
    const collar = new Mesh(collarGeometry, collarMaterial);
    collar.position.z = z;
    return collar;
  });
  const coreMaterial = glow(palette.core);
  const needle = new Mesh(memo('threader:needle', () => new CylinderGeometry(0.07, 0.07, 3.9, 5).rotateX(Math.PI / 2)), coreMaterial);
  const nose = new Mesh(memo('threader:nose', () => new OctahedronGeometry(0.24, 0).translate(0, 0, 2.15)), coreMaterial);
  group.add(body.mesh, body.edges, needle, nose, ...collars);
  return finish(group, 'threader', palette, [body.edgeMaterial, collarMaterial], [coreMaterial], 2.4);
}

/** Leech: a C-clamp that grips a coil, claws out, capacitor core draining. */
export function createLeechMesh(palette: DronePalette) {
  const group = new Group();
  const body = hull('leech', () => {
    const arcLength = 4.3;
    const clamp = new TorusGeometry(1.05, 0.34, 6, 24, arcLength);
    // Centre the open side of the C on +x, toward the coil it grips.
    clamp.rotateZ(Math.PI - arcLength / 2);
    const parts: BufferGeometry[] = [clamp];
    for (const y of [-0.75, 0, 0.75]) {
      const claw = new ConeGeometry(0.18, 1.2, 5);
      claw.rotateZ(-Math.PI / 2);
      claw.translate(1.45, y, 0);
      parts.push(claw);
    }
    return parts;
  }, palette);
  const coreMaterial = glow(palette.core);
  const core = new Mesh(memo('leech:core', () => new CylinderGeometry(0.46, 0.46, 0.8, 10).rotateX(Math.PI / 2)), coreMaterial);
  const bandMaterial = glow(palette.edge);
  const band = new Mesh(memo('leech:band', () => new TorusGeometry(0.6, 0.06, 4, 28).translate(0, 0, 0.42)), bandMaterial);
  group.add(body.mesh, body.edges, core, band);
  return finish(group, 'leech', palette, [body.edgeMaterial, bandMaterial], [coreMaterial], 2.4);
}

const PYLON_AXES = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

/** Pylon: a six-spiked caltrop whose spike tips charge before each discharge. */
export function createPylonMesh(palette: DronePalette) {
  const group = new Group();
  const body = hull('pylon', () => PYLON_AXES.map(([x, y, z]) => {
    const spike = new ConeGeometry(0.3, 1.7, 5);
    spike.translate(0, 1.2, 0);
    spike.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(x, y, z)));
    return spike;
  }), palette);
  const coreMaterial = glow(palette.core);
  const core = new Mesh(memo('pylon:core', () => new IcosahedronGeometry(0.62, 0)), coreMaterial);
  const tipMaterial = glow(palette.edge);
  const tips = new Mesh(memo('pylon:tips', () => mergeGeometries(PYLON_AXES.map(([x, y, z]) => strip(new OctahedronGeometry(0.24, 0).translate(x * 2.15, y * 2.15, z * 2.15))))), tipMaterial);
  const cageMaterial = glow(palette.edge);
  const cageGeometry = memo('pylon:cage', () => new TorusGeometry(1.05, 0.045, 4, 36));
  const cageA = new Mesh(cageGeometry, cageMaterial);
  const cageB = new Mesh(cageGeometry, cageMaterial);
  cageB.rotation.x = Math.PI / 2;
  group.add(body.mesh, body.edges, core, tips, cageA, cageB);
  group.userData.tipMaterial = tipMaterial;
  return finish(group, 'pylon', palette, [body.edgeMaterial, cageMaterial], [coreMaterial], 2.8);
}

/** Arc bolt: a jagged ball of charge in a translucent shell. */
export function createBoltMesh(palette: DronePalette) {
  const group = new Group();
  const coreMaterial = glow(palette.core);
  const core = new Mesh(memo('bolt:core', () => {
    const jagged = new IcosahedronGeometry(0.5, 0);
    const positions = jagged.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const jitter = 0.7 + ((i * 7919) % 13) / 13;
      positions.setXYZ(i, positions.getX(i) * jitter, positions.getY(i) * jitter, positions.getZ(i) * jitter);
    }
    return jagged;
  }), coreMaterial);
  const shellMaterial = new MeshBasicMaterial({ color: palette.edge.clone().multiplyScalar(0.28), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const shell = new Mesh(memo('bolt:shell', () => new IcosahedronGeometry(0.95, 1)), shellMaterial);
  const rayMaterial = new LineBasicMaterial({ color: palette.edge, toneMapped: false });
  const rays = new LineSegments(memo('bolt:rays', () => {
    const points: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      points.push(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0, Math.cos(a + 0.4) * 1.5, Math.sin(a + 0.4) * 1.5, 0);
    }
    return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  }), rayMaterial);
  group.add(core, shell, rays);
  return finish(group, 'bolt', palette, [rayMaterial], [coreMaterial], 1.4);
}

/** Safety interlock: a heavy striped clamp, armoured over a hot core. */
export function createInterlockMesh(palette: DronePalette, hazard: Color) {
  const group = new Group();
  const body = hull('interlock', () => {
    const block = new BoxGeometry(3.4, 1.6, 1.4);
    const jawL = new BoxGeometry(0.8, 2.3, 1.3).rotateZ(0.32).translate(-2.0, -0.35, 0);
    const jawR = new BoxGeometry(0.8, 2.3, 1.3).rotateZ(-0.32).translate(2.0, -0.35, 0);
    const spine = new BoxGeometry(2.4, 0.5, 1.8).translate(0, 0.95, -0.1);
    return [block, jawL, jawR, spine];
  }, palette);
  const coreMaterial = glow(palette.core);
  const core = new Mesh(memo('interlock:core', () => new SphereGeometry(0.62, 16, 12)), coreMaterial);
  core.position.z = 0.55;

  // Stage-one armour: two striped plates over the core.
  const armor = new Group();
  const plateGeometry = memo('interlock:plate', () => new BoxGeometry(1.55, 1.4, 0.26));
  const plateEdges = memo('interlock:plate-edges', () => new EdgesGeometry(plateGeometry));
  const stripeGeometry = memo('interlock:stripe', () => new BoxGeometry(0.2, 1.3, 0.05));
  const plateMaterial = new MeshBasicMaterial({ color: palette.body.clone().multiplyScalar(1.3) });
  const stripeMaterial = glow(hazard);
  for (const side of [-1, 1]) {
    const plate = new Group();
    plate.position.set(side * 0.82, 0, 0.88);
    plate.add(new Mesh(plateGeometry, plateMaterial));
    plate.add(new LineSegments(plateEdges, body.edgeMaterial));
    for (let i = 0; i < 3; i += 1) {
      const stripe = new Mesh(stripeGeometry, stripeMaterial);
      stripe.position.set((i - 1) * 0.45, 0, 0.15);
      stripe.rotation.z = 0.6;
      plate.add(stripe);
    }
    plate.userData.side = side;
    armor.add(plate);
  }
  const lampMaterial = glow(palette.edge);
  const lamp = new Mesh(memo('interlock:lamp', () => new BoxGeometry(2.2, 0.14, 0.12).translate(0, 1.25, 0.8)), lampMaterial);
  group.add(body.mesh, body.edges, core, armor, lamp);
  group.userData.armor = armor;
  group.userData.stripeMaterial = stripeMaterial;
  return finish(group, 'interlock', palette, [body.edgeMaterial, lampMaterial], [coreMaterial], 3.6);
}

/** The charge itself: no body, only a position the spine can hang effects on. */
export function createDischargeMesh() {
  const group = new Group();
  group.userData.kind = 'discharge';
  return group;
}

/** Dispose per-instance materials; shared geometry stays cached. */
export function disposeDroneMaterials(root: Group) {
  root.traverse((child) => {
    const material = (child as Mesh).material;
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) item.dispose();
  });
}
