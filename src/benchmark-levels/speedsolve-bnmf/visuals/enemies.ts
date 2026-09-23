import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';
import type { Material, Object3D } from 'three';

// Leaf: target meshes. Every factory takes its colors from the caller; the
// spine (visuals/index.ts) decides palette and every animation. Candy
// polyhedra carry ink edges so they read against the pale void, the cube
// faces, and each other with bloom switched off.

export type Ink = { ink: Color; white: Color; machine: Color; steel: Color };

// Geometry is shared across every spawn; only materials (which carry the
// per-enemy tint) are created per mesh and disposed with it.
const geometryCache = new Map<string, BufferGeometry>();
function shared<T extends BufferGeometry>(key: string, build: () => T): T {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = build();
    geometryCache.set(key, geometry);
  }
  return geometry as T;
}

const materialCache = new Map<string, Material>();
function sharedMaterial<T extends Material>(key: string, build: () => T): T {
  let material = materialCache.get(key);
  if (!material) {
    material = build();
    material.userData.shared = true;
    materialCache.set(key, material);
  }
  return material as T;
}

export type Tintable = {
  fill: MeshStandardMaterial;
  edge: LineBasicMaterial;
};

function inkEdges(key: string, geometry: BufferGeometry, color: Color) {
  const material = new LineBasicMaterial({ color });
  return { lines: new LineSegments(shared(`${key}:edges`, () => new EdgesGeometry(geometry, 1)), material), material };
}

function candy(color: Color, flat = true) {
  return new MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.02, flatShading: flat });
}

export function createTetra(color: Color, ink: Ink) {
  const group = new Group();
  const geometry = shared('tetra', () => new TetrahedronGeometry(1.15, 0));
  const fill = candy(color);
  group.add(new Mesh(geometry, fill));
  const edges = inkEdges('tetra', geometry, ink.ink);
  edges.lines.scale.setScalar(1.005);
  group.add(edges.lines);
  const core = new Mesh(shared('tetra-core', () => new TetrahedronGeometry(0.42, 0)), new MeshBasicMaterial({ color: ink.white }));
  core.rotation.set(Math.PI, 0.3, 0);
  group.add(core);
  group.userData.tint = { fill, edge: edges.material } satisfies Tintable;
  group.userData.lockScale = 1.35;
  return group;
}

export function createOcta(color: Color, ink: Ink) {
  const group = new Group();
  const body = new Group();
  const geometry = shared('octa', () => new OctahedronGeometry(1.2, 0));
  const fill = candy(color);
  body.add(new Mesh(geometry, fill));
  const edges = inkEdges('octa', geometry, ink.ink);
  edges.lines.scale.setScalar(1.005);
  body.add(edges.lines);
  group.add(body);
  // The gunner's eye: a white band that heats up as it charges a shot.
  const eyeMaterial = new MeshStandardMaterial({ color: ink.machine, roughness: 0.4, emissive: new Color(0, 0, 0) });
  const eye = new Mesh(shared('octa-eye', () => new TorusGeometry(1.42, 0.13, 8, 28)), eyeMaterial);
  eye.rotation.x = Math.PI / 2;
  group.add(eye);
  const pupil = new Mesh(shared('octa-pupil', () => new TorusGeometry(1.42, 0.05, 6, 28)), new MeshBasicMaterial({ color: ink.ink }));
  pupil.rotation.x = Math.PI / 2;
  pupil.scale.setScalar(1.04);
  group.add(pupil);
  group.userData.tint = { fill, edge: edges.material } satisfies Tintable;
  group.userData.eye = eyeMaterial;
  group.userData.lockScale = 1.55;
  return group;
}

export function createPrism(color: Color, ink: Ink) {
  const group = new Group();
  const geometry = shared('prism', () => new CylinderGeometry(0.72, 0.72, 2.7, 3, 1));
  const fill = candy(color);
  group.add(new Mesh(geometry, fill));
  const edges = inkEdges('prism', geometry, ink.ink);
  edges.lines.scale.setScalar(1.005);
  group.add(edges.lines);
  const bandMaterial = new MeshStandardMaterial({ color: ink.machine, roughness: 0.5 });
  for (const y of [-1.05, 1.05]) {
    const band = new Mesh(shared('prism-band', () => new CylinderGeometry(0.78, 0.78, 0.22, 3, 1)), bandMaterial);
    band.position.y = y;
    group.add(band);
  }
  group.userData.tint = { fill, edge: edges.material } satisfies Tintable;
  group.userData.lockScale = 1.45;
  return group;
}

export function createShard(color: Color, ink: Ink) {
  const group = new Group();
  const geometry = shared('shard', () => new BoxGeometry(0.78, 0.78, 0.78));
  const fill = new MeshStandardMaterial({ color, roughness: 0.3, emissive: color.clone().multiplyScalar(0.55) });
  group.add(new Mesh(geometry, fill));
  const edges = inkEdges('shard', geometry, ink.white);
  edges.lines.scale.setScalar(1.02);
  group.add(edges.lines);
  const halo = new Mesh(shared('shard-halo', () => new RingGeometry(0.72, 0.84, 4)), new MeshBasicMaterial({ color: ink.ink, side: DoubleSide }));
  halo.userData.faceCamera = true;
  group.add(halo);
  group.userData.tint = { fill, edge: edges.material } satisfies Tintable;
  group.userData.shardHalo = halo;
  group.userData.lockScale = 1.1;
  return group;
}

/** The row bracket: four ink corners, a glowing inner square, HP pips. Faces +Z. */
export function createTileTarget(ink: Ink) {
  const group = new Group();
  const cornerMaterial = new MeshBasicMaterial({ color: ink.ink });
  const size = 3.9;
  const arm = 1.05;
  const thick = 0.2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const h = new Mesh(shared('tile-h', () => new BoxGeometry(arm, thick, 0.12)), cornerMaterial);
      h.position.set(sx * (size / 2 - arm / 2), sy * size / 2, 0);
      const v = new Mesh(shared('tile-v', () => new BoxGeometry(thick, arm, 0.12)), cornerMaterial);
      v.position.set(sx * size / 2, sy * (size / 2 - arm / 2), 0);
      group.add(h, v);
    }
  }
  const glowMaterial = new MeshBasicMaterial({ color: ink.white.clone().multiplyScalar(2.2), transparent: true, opacity: 0.9, depthWrite: false });
  const glow = new Mesh(shared('tile-glow', () => new RingGeometry(1.42, 1.56, 4, 1)), glowMaterial);
  glow.rotation.z = Math.PI / 4;
  group.add(glow);
  const wash = new Mesh(shared('tile-wash', () => new PlaneGeometry(3.2, 3.2)), new MeshBasicMaterial({ color: ink.white, transparent: true, opacity: 0.22, depthWrite: false }));
  wash.position.z = -0.1;
  group.add(wash);
  const dot = new Mesh(shared('tile-dot', () => new CircleGeometry(0.2, 16)), cornerMaterial);
  dot.position.z = 0.05;
  group.add(dot);
  const pips: Mesh[] = [];
  for (let i = 0; i < 2; i += 1) {
    const pip = new Mesh(shared('tile-pip', () => new BoxGeometry(0.42, 0.42, 0.12)), new MeshBasicMaterial({ color: ink.ink }));
    pip.position.set(-size / 2 + 0.55 + i * 0.6, size / 2 + 0.55, 0);
    group.add(pip);
    pips.push(pip);
  }
  group.userData.glow = glowMaterial;
  group.userData.wash = wash;
  group.userData.pips = pips;
  group.userData.lockScale = 2.2;
  group.userData.flat = true;
  return group;
}

/** The weakpoint: a white machined housing, a counter-spinning steel gear, a hot lens. Faces +Z. */
export function createWeakpoint(ink: Ink) {
  const group = new Group();
  const white = new MeshStandardMaterial({ color: ink.machine, roughness: 0.35, metalness: 0.05 });
  const steel = new MeshStandardMaterial({ color: ink.steel, roughness: 0.3, metalness: 0.7 });
  const housing = new Mesh(shared('wp-housing', () => new TorusGeometry(1.6, 0.36, 14, 40)), white);
  group.add(housing);
  const gear = new Group();
  for (let i = 0; i < 14; i += 1) {
    const tooth = new Mesh(shared('wp-tooth', () => new BoxGeometry(0.34, 0.5, 0.36)), steel);
    const angle = (i / 14) * Math.PI * 2;
    tooth.position.set(Math.cos(angle) * 2.12, Math.sin(angle) * 2.12, -0.1);
    tooth.rotation.z = angle;
    gear.add(tooth);
  }
  group.add(gear);
  const lensMaterial = new MeshStandardMaterial({ color: ink.white, roughness: 0.2, emissive: new Color(1, 1, 1) });
  const lens = new Mesh(shared('wp-lens', () => new SphereGeometry(0.95, 24, 16)), lensMaterial);
  lens.scale.z = 0.7;
  group.add(lens);
  const iris = new Mesh(shared('wp-iris', () => new RingGeometry(0.5, 0.62, 24)), new MeshBasicMaterial({ color: ink.ink, side: DoubleSide }));
  iris.position.z = 0.7;
  group.add(iris);
  for (let i = 0; i < 3; i += 1) {
    const strut = new Mesh(shared('wp-strut', () => new BoxGeometry(0.28, 0.28, 2.4)), steel);
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    strut.position.set(Math.cos(angle) * 1.6, Math.sin(angle) * 1.6, -1.3);
    group.add(strut);
  }
  group.userData.gear = gear;
  group.userData.lens = lensMaterial;
  group.userData.baseScale = 1.4;
  group.userData.lockScale = 2.3 * 1.4;
  return group;
}

/** The finale target: gyroscope rings that wrap the cube's own spider core. */
export function createCoreTarget(ink: Ink, colors: readonly Color[]) {
  const group = new Group();
  const steel = new MeshStandardMaterial({ color: ink.steel, roughness: 0.28, metalness: 0.75 });
  const rings: Group[] = [];
  for (let r = 0; r < 2; r += 1) {
    const ring = new Group();
    ring.add(new Mesh(new TorusGeometry(6.2 + r * 1.0, 0.16, 8, 72), steel));
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const marker = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), new MeshStandardMaterial({ color: colors[(i + r * 3) % 6], roughness: 0.3 }));
      marker.position.set(Math.cos(angle) * (6.2 + r * 1.0), Math.sin(angle) * (6.2 + r * 1.0), 0);
      ring.add(marker);
    }
    ring.rotation.x = r === 0 ? 0.5 : -0.9;
    rings.push(ring);
    group.add(ring);
  }
  const heartGlow = new MeshBasicMaterial({ color: ink.white.clone().multiplyScalar(1.6), transparent: true, opacity: 0.0, depthWrite: false });
  const glow = new Mesh(new SphereGeometry(3.3, 24, 16), heartGlow);
  group.add(glow);
  group.userData.rings = rings;
  group.userData.heartGlow = heartGlow;
  group.userData.lockScale = 3.6;
  return group;
}

export function createProjectile(ink: Ink) {
  const group = new Group();
  const dart = new Mesh(shared('dart', () => new OctahedronGeometry(0.3, 0)), sharedMaterial('dart', () => new MeshBasicMaterial({ color: ink.ink })));
  dart.scale.set(0.55, 0.55, 2.6);
  const core = new Mesh(shared('dart-core', () => new OctahedronGeometry(0.16, 0)), sharedMaterial('dart-core', () => new MeshBasicMaterial({ color: ink.white.clone().multiplyScalar(2.4) })));
  core.scale.set(0.6, 0.6, 3.2);
  core.position.z = 0.1;
  group.add(dart, core);
  return group;
}

export function createReticle(ink: Ink) {
  const group = new Group();
  const materials: MeshBasicMaterial[] = [];
  const mat = (color: Color) => {
    const material = new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, side: DoubleSide });
    materials.push(material);
    return material;
  };
  const ring = new Mesh(new RingGeometry(0.58, 0.64, 48), mat(ink.ink));
  const halo = new Mesh(new RingGeometry(0.64, 0.7, 48), mat(ink.white));
  const dot = new Mesh(new CircleGeometry(0.06, 16), mat(ink.ink));
  group.add(halo, ring, dot);
  const notches: Mesh[] = [];
  const spinner = new Group();
  for (let i = 0; i < 6; i += 1) {
    const notch = new Mesh(new PlaneGeometry(0.2, 0.12), mat(ink.machine));
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 2;
    notch.position.set(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0);
    notch.rotation.z = angle;
    const outline = new Mesh(new RingGeometry(0.1, 0.13, 4), mat(ink.ink));
    outline.rotation.z = Math.PI / 4;
    notch.add(outline);
    spinner.add(notch);
    notches.push(notch);
  }
  group.add(spinner);
  for (const child of [halo, ring, dot]) child.renderOrder = 20;
  group.traverse((child) => {
    child.renderOrder = 20;
  });
  group.userData.notches = notches;
  group.userData.spinner = spinner;
  group.userData.materials = materials;
  return group;
}

/** Lock mark: an ink diamond with a white inner edge, drawn over everything. */
export function createLockMark(ink: Ink) {
  const group = new Group();
  const outer = new Mesh(shared('lock-outer', () => new RingGeometry(0.9, 1.0, 4)), sharedMaterial('lock-outer', () => new MeshBasicMaterial({ color: ink.ink, depthTest: false, depthWrite: false, transparent: true, side: DoubleSide })));
  const inner = new Mesh(shared('lock-inner', () => new RingGeometry(0.8, 0.86, 4)), sharedMaterial('lock-inner', () => new MeshBasicMaterial({ color: ink.white, depthTest: false, depthWrite: false, transparent: true, side: DoubleSide })));
  group.add(outer, inner);
  group.traverse((child) => {
    child.renderOrder = 18;
  });
  return group;
}

export function tint(object: Object3D, color: Color) {
  const tintable = object.userData.tint as Tintable | undefined;
  if (!tintable) return;
  tintable.fill.color.copy(color);
  if (tintable.fill.emissive.getHex() !== 0) tintable.fill.emissive.copy(color).multiplyScalar(0.55);
}

export function disposeMaterials(object: Object3D) {
  object.traverse((child) => {
    const material = (child as Mesh).material as Material | Material[] | undefined;
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) if (!item.userData.shared) item.dispose();
  });
}
