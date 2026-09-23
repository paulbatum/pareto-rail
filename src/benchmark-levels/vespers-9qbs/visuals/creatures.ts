import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Path,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  ConeGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Leaf: the things that eat the light. Flat black silhouettes — lancet
// wings, a tracery wheel, a robed shade, a thurible, a talon — each carrying
// one stolen colour in its chest. Every creature also carries a soft halo of
// that colour behind it, so the black shape reads against its own light even
// with bloom off. Builders take colours; the spine decides which.

export type CreatureParts = {
  /** Stolen light in the chest: HDR-tinted by the spine. */
  heart: MeshBasicMaterial;
  /** Soft glow behind the silhouette. */
  halo: MeshBasicMaterial;
  /** Thin additive outline of the silhouette. */
  rim: MeshBasicMaterial;
  /** Meshes the spine animates (wings, gem, shells), by name. */
  animated: Record<string, Group | Mesh>;
  /** Screen-facing children (for 3D bodies like the censer). */
  billboards: Array<Group | Mesh>;
  /** Approximate radius for lock rings and bursts. */
  size: number;
};

const BLACK = new Color(0.004, 0.004, 0.006);
const geometryCache = new Map<string, BufferGeometry>();

function cached(key: string, build: () => BufferGeometry) {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = build();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function additive(color: Color, opacity = 1) {
  return new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
}

function bodyMaterial() {
  return new MeshBasicMaterial({ color: BLACK, side: DoubleSide });
}

/** Radial glow disc: bright centre fading to nothing at the rim. */
function haloGeometry() {
  return cached('halo', () => {
    const geometry = new CircleGeometry(1, 40, 0, Math.PI * 2);
    const positions = geometry.getAttribute('position');
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i += 1) {
      const r = Math.hypot(positions.getX(i), positions.getY(i));
      const v = Math.pow(Math.max(0, 1 - r), 1.8);
      colors.push(v, v, v);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geometry;
  });
}

function haloMesh(material: MeshBasicMaterial, scaleX: number, scaleY = scaleX) {
  material.vertexColors = true;
  const mesh = new Mesh(haloGeometry(), material);
  mesh.scale.set(scaleX, scaleY, 1);
  mesh.position.z = -0.12;
  mesh.renderOrder = -1;
  return mesh;
}

function lancetShape(width: number, height: number, bottom = 0) {
  const shape = new Shape();
  const half = width / 2;
  const headHeight = Math.min(height * 0.62, width * 0.95);
  const spring = bottom + height - headHeight;
  shape.moveTo(-half, bottom);
  shape.lineTo(half, bottom);
  shape.lineTo(half, spring);
  shape.quadraticCurveTo(half, spring + headHeight * 0.62, 0, bottom + height);
  shape.quadraticCurveTo(-half, spring + headHeight * 0.62, -half, spring);
  shape.lineTo(-half, bottom);
  return shape;
}

function quatrefoil(radius: number) {
  return cached(`quatrefoil:${radius}`, () => {
    const lobes: BufferGeometry[] = [];
    for (let k = 0; k < 4; k += 1) {
      const angle = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const lobe = new CircleGeometry(radius * 0.55, 16).toNonIndexed();
      lobe.translate(Math.cos(angle) * radius * 0.5, Math.sin(angle) * radius * 0.5, 0);
      lobes.push(lobe);
    }
    lobes.push(new CircleGeometry(radius * 0.5, 16).toNonIndexed());
    return mergeGeometries(lobes)!;
  });
}

function vesica(width: number, height: number) {
  const shape = new Shape();
  shape.moveTo(0, -height / 2);
  shape.quadraticCurveTo(width, 0, 0, height / 2);
  shape.quadraticCurveTo(-width, 0, 0, -height / 2);
  return new ShapeGeometry(shape, 10);
}

// ---- moth: two lancet panes for wings ------------------------------------------

export function createMoth(hue: Color): Group {
  const group = new Group();
  const heart = additive(hue.clone());
  const halo = additive(hue.clone());
  const rim = additive(hue.clone());
  const wingGeometry = cached('moth-wing', () => new ShapeGeometry(lancetShape(1.15, 2.1, 0), 8));
  const wings: Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new Group();
    const wing = new Mesh(wingGeometry, bodyMaterial());
    wing.rotation.z = side * -0.72;
    wing.position.set(side * 0.08, -0.25, 0);
    const outline = new Mesh(wingGeometry, rim);
    outline.rotation.z = wing.rotation.z;
    outline.position.set(wing.position.x, wing.position.y - 0.04, -0.04);
    outline.scale.setScalar(1.07);
    pivot.add(outline, wing);
    group.add(pivot);
    wings.push(pivot);
  }
  const body = new Mesh(cached('moth-body', () => {
    const shape = new Shape();
    shape.moveTo(0, -1.1);
    shape.lineTo(0.3, 0);
    shape.lineTo(0, 0.95);
    shape.lineTo(-0.3, 0);
    shape.lineTo(0, -1.1);
    return new ShapeGeometry(shape);
  }), bodyMaterial());
  body.position.z = 0.02;
  const chest = new Mesh(quatrefoil(0.34), heart);
  chest.position.set(0, 0.05, 0.05);
  group.add(body, chest, haloMesh(halo, 2.1));
  return finish(group, { heart, halo, rim, animated: { left: wings[0], right: wings[1] }, billboards: [], size: 1.5 });
}

// ---- rosette: a wheel of black tracery over its stolen light ----------------------

export function createRosette(hue: Color): Group {
  const group = new Group();
  const heart = additive(hue.clone());
  const halo = additive(hue.clone());
  const rim = additive(hue.clone());
  const wheel = new Group();
  const tracery = new Mesh(cached('rosette-tracery', () => {
    const shape = new Shape();
    const cusps = 12;
    for (let i = 0; i <= cusps * 4; i += 1) {
      const angle = (i / (cusps * 4)) * Math.PI * 2;
      const radius = 1.5 + Math.max(0, Math.sin(angle * cusps)) * 0.14;
      if (i === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    for (let k = 0; k < 6; k += 1) {
      const angle = (k / 6) * Math.PI * 2;
      shape.holes.push(new Path().absarc(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0.35, 0, Math.PI * 2, true));
    }
    shape.holes.push(new Path().absarc(0, 0, 0.27, 0, Math.PI * 2, true));
    return new ShapeGeometry(shape, 12);
  }), bodyMaterial());
  const glow = new Mesh(cached('rosette-glow', () => new CircleGeometry(1.2, 32)), heart);
  glow.position.z = -0.05;
  const ring = new Mesh(cached('rosette-rim', () => new RingGeometry(1.52, 1.62, 48)), rim);
  ring.position.z = -0.03;
  wheel.add(glow, tracery, ring);
  group.add(wheel, haloMesh(halo, 2.2));
  return finish(group, { heart, halo, rim, animated: { wheel }, billboards: [], size: 1.7 });
}

// ---- shade: a robed figure stepped out of a lancet --------------------------------

export function createShade(hue: Color): Group {
  const group = new Group();
  const heart = additive(hue.clone());
  const halo = additive(hue.clone());
  const rim = additive(hue.clone());
  const robeGeometry = cached('shade-robe', () => {
    const shape = new Shape();
    // Ragged hem, narrow shoulders, a hood drawn to a point.
    shape.moveTo(-0.85, -2.1);
    const teeth = 5;
    for (let i = 1; i <= teeth; i += 1) {
      const x = -0.85 + (1.7 * i) / teeth;
      shape.lineTo(x - 0.17, -1.72 - (i % 2) * 0.1);
      shape.lineTo(x, -2.1 - (i % 2 === 0 ? 0.18 : 0));
    }
    shape.lineTo(0.62, 0.7);
    shape.quadraticCurveTo(0.58, 1.2, 0.42, 1.35);
    shape.quadraticCurveTo(0.5, 1.9, 0, 2.45);
    shape.quadraticCurveTo(-0.5, 1.9, -0.42, 1.35);
    shape.quadraticCurveTo(-0.58, 1.2, -0.62, 0.7);
    shape.lineTo(-0.85, -2.1);
    return new ShapeGeometry(shape, 8);
  });
  const robe = new Mesh(robeGeometry, bodyMaterial());
  const outline = new Mesh(robeGeometry, rim);
  outline.scale.set(1.06, 1.03, 1);
  outline.position.z = -0.04;
  const mandorla = new Mesh(cached('shade-mandorla', () => vesica(0.42, 1.05)), heart);
  mandorla.position.set(0, 0.25, 0.05);
  group.add(outline, robe, mandorla, haloMesh(halo, 1.8, 3.3));
  return finish(group, { heart, halo, rim, animated: {}, billboards: [], size: 2.2 });
}

// ---- censer: a thurible on its chain, coals burning with a stolen colour ----------

export function createCenser(hue: Color): Group {
  const group = new Group();
  const heart = additive(hue.clone());
  const halo = additive(hue.clone());
  const rim = additive(hue.clone());
  const body = new Mesh(cached('censer-body', () => {
    const profile = [
      [0.01, -1.15], [0.5, -1.05], [0.85, -0.65], [0.95, -0.2], [0.8, 0.05],
      [0.86, 0.12], [0.74, 0.5], [0.5, 0.88], [0.24, 1.18], [0.1, 1.55], [0.01, 1.7],
    ].map(([x, y]) => new Vector2(x, y));
    return new LatheGeometry(profile, 12);
  }), bodyMaterial());
  const coals = new Group();
  for (const [y, radius] of [[0.1, 0.88], [0.48, 0.74], [0.82, 0.52]] as const) {
    const band = new Mesh(cached(`censer-band:${radius}`, () => new TorusGeometry(radius, 0.07, 6, 24)), heart);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    coals.add(band);
  }
  const chain = new Mesh(cached('censer-chain', () => {
    const geometry = new CylinderGeometry(0.09, 0.09, 1, 5);
    geometry.translate(0, 0.5, 0);
    return geometry;
  }), bodyMaterial());
  chain.position.y = 1.6;
  const glowHalo = haloMesh(halo, 3.4);
  glowHalo.position.set(0, 0.2, 0);
  const rimHalo = new Mesh(cached('censer-rim', () => new RingGeometry(1.0, 1.12, 40)), rim);
  const facing = new Group();
  facing.add(glowHalo, rimHalo);
  group.add(body, coals, chain, facing);
  return finish(group, { heart, halo, rim, animated: { chain, coals }, billboards: [facing], size: 1.6 });
}

// ---- shard: a thrown splinter of stolen glass ------------------------------------

export function createShard(hue: Color): Group {
  const group = new Group();
  const heart = additive(hue.clone());
  const halo = additive(hue.clone());
  const rim = additive(hue.clone());
  const geometry = cached('shard', () => {
    const shape = new Shape();
    shape.moveTo(0, 1.25);
    shape.lineTo(0.55, -0.2);
    shape.lineTo(0.22, -0.95);
    shape.lineTo(-0.3, -0.62);
    shape.lineTo(-0.6, 0.1);
    shape.lineTo(0, 1.25);
    const extruded = new ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false });
    extruded.translate(0, 0, -0.07);
    return extruded;
  });
  const pane = new Mesh(geometry, heart);
  const edge = new Mesh(geometry, rim);
  edge.scale.setScalar(1.08);
  edge.position.z = -0.1;
  group.add(edge, pane, haloMesh(halo, 2.1));
  return finish(group, { heart, halo, rim, animated: { pane }, billboards: [], size: 1.2 });
}

// ---- claw: a black talon clutching a gem of stolen colour --------------------------

export function createClaw(hue: Color): Group {
  const group = new Group();
  const heart = additive(hue.clone());
  const halo = additive(hue.clone());
  const rim = additive(hue.clone());
  const talonGeometry = cached('claw-talon', () => {
    const shape = new Shape();
    // Three hooked fingers closing over the gem from the wrist.
    shape.moveTo(-0.45, -2.3);
    shape.lineTo(0.45, -2.3);
    shape.quadraticCurveTo(0.7, -1.2, 1.35, -0.7);
    shape.quadraticCurveTo(1.85, 0.2, 1.2, 1.15);
    shape.quadraticCurveTo(1.45, 0.25, 0.9, -0.25);
    shape.quadraticCurveTo(0.55, 0.9, 0.12, 1.55);
    shape.quadraticCurveTo(0.3, 0.6, 0.05, -0.35);
    shape.quadraticCurveTo(-0.35, 0.8, -0.95, 1.3);
    shape.quadraticCurveTo(-0.55, 0.35, -0.75, -0.3);
    shape.quadraticCurveTo(-1.4, 0.3, -1.45, 0.9);
    shape.quadraticCurveTo(-1.6, -0.3, -1.1, -0.9);
    shape.quadraticCurveTo(-0.6, -1.3, -0.45, -2.3);
    return new ShapeGeometry(shape, 8);
  });
  const talon = new Mesh(talonGeometry, bodyMaterial());
  talon.position.z = 0.1;
  const outline = new Mesh(talonGeometry, rim);
  outline.scale.setScalar(1.1);
  outline.position.z = -0.02;
  const gem = new Mesh(cached('claw-gem', () => new OctahedronGeometry(0.62, 0)), heart);
  gem.position.set(0, 0.25, 0);
  group.add(outline, gem, talon, haloMesh(halo, 3.3));
  return finish(group, { heart, halo, rim, animated: { gem }, billboards: [], size: 2 });
}

// ---- heart: the hoard, every colour it has taken, in three shells of thorns --------

export function createHeart(jewels: readonly Color[]): Group {
  const group = new Group();
  const heart = new MeshBasicMaterial({ vertexColors: true, color: new Color(1.4, 1.4, 1.4) });
  const halo = additive(new Color(1, 1, 1));
  const rim = additive(new Color(1, 1, 1));
  const core = new Mesh(cached('heart-core', () => {
    const geometry = new IcosahedronGeometry(2.1, 1).toNonIndexed();
    const colors: number[] = [];
    const count = geometry.getAttribute('position').count;
    for (let face = 0; face < count / 3; face += 1) {
      const jewel = jewels[(face * 7 + (face >> 2)) % jewels.length];
      for (let v = 0; v < 3; v += 1) colors.push(jewel.r, jewel.g, jewel.b);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geometry;
  }), heart);
  const shells: Group[] = [];
  for (let layer = 0; layer < 3; layer += 1) {
    const shell = new Group();
    const thorns = new Mesh(cached(`heart-shell:${layer}`, () => thornShell(2.4 + layer * 0.75, 26 + layer * 10, layer * 11 + 3)), bodyMaterial());
    shell.add(thorns);
    group.add(shell);
    shells.push(shell);
  }
  const haloMeshInstance = haloMesh(halo, 6.5);
  haloMeshInstance.geometry = cached('heart-halo', () => {
    const geometry = new CircleGeometry(1, 48);
    const positions = geometry.getAttribute('position');
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const r = Math.hypot(x, y);
      const angle = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
      const jewel = jewels[Math.floor(angle * jewels.length * 2) % jewels.length];
      const v = Math.pow(Math.max(0, 1 - r), 1.6);
      colors.push(jewel.r * v, jewel.g * v, jewel.b * v);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geometry;
  });
  group.add(core, haloMeshInstance);
  return finish(group, { heart, halo, rim, animated: { core, shell0: shells[0], shell1: shells[1], shell2: shells[2] }, billboards: [], size: 4.5 });
}

function thornShell(radius: number, count: number, seed: number) {
  const parts: BufferGeometry[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i + seed;
    const direction = new Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
    const length = 1.6 + ((i * 37 + seed) % 7) * 0.22;
    const thorn = new ConeGeometry(0.5, length, 5).toNonIndexed();
    thorn.translate(0, length / 2, 0);
    thorn.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
    thorn.translate(direction.x * radius * 0.8, direction.y * radius * 0.8, direction.z * radius * 0.8);
    parts.push(thorn);
  }
  // A cage of plates under the thorns hides most of the hoard.
  const cage = new IcosahedronGeometry(radius * 0.86, 0).toNonIndexed();
  const positions = cage.getAttribute('position');
  const kept: number[] = [];
  for (let face = 0; face < positions.count / 3; face += 1) {
    if ((face + seed) % 3 === 0) continue; // leave gaps for the light to leak
    for (let v = 0; v < 3; v += 1) {
      const index = face * 3 + v;
      kept.push(positions.getX(index), positions.getY(index), positions.getZ(index));
    }
  }
  const plates = new BufferGeometry();
  plates.setAttribute('position', new Float32BufferAttribute(kept, 3));
  plates.computeVertexNormals();
  parts.push(plates);
  return mergeGeometries(parts.map((part) => {
    for (const name of Object.keys(part.attributes)) if (name !== 'position') part.deleteAttribute(name);
    return part;
  }))!;
}

function finish(group: Group, parts: CreatureParts) {
  group.userData.parts = parts;
  return group;
}
