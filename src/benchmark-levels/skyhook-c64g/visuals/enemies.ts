import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { MergeBuilder, once } from './merge';
import { CHARCOAL, GUNMETAL, HAZARD, HAZARD_HOT, KEYLINE, PANEL_SHADE, PANEL_WHITE, hdr } from './palette';

// The hostile roster. Wind-riders (kite, manta) are dark, swept and fluid, with
// hazard-orange edges; the vacuum-hardened (sentry, torpedo) are white-panel and
// squared-off; limpets and hooks are tools, not creatures. Every kind has a
// different silhouette *and* a different way of moving — see gameplay.ts.
//
// Geometry is built once per kind (memoised, merged per material) and shared by
// every instance; only materials are per-enemy, so lock / deny / damage tints
// can recolour a single hostile. Each mesh points +Z at where it is going and
// exposes tint parts plus animated bits that `animateEnemy` drives every frame.

export type TintPart = { material: { color: Color }; base: Color; kind: 'body' | 'accent' | 'core' };

type Meta = { parts: TintPart[]; accent: Color; lockRingScale: number };

function register(group: Group, meta: Meta) {
  group.userData.parts = meta.parts;
  group.userData.accent = meta.accent;
  group.userData.lockRingScale = meta.lockRingScale;
}

function body(parts: TintPart[], color: Color, emissive = 0.14) {
  const material = new MeshLambertMaterial({ color: color.clone(), emissive: color.clone().multiplyScalar(emissive) });
  parts.push({ material, base: color.clone(), kind: 'body' });
  return material;
}

function accent(parts: TintPart[], intensity = 1.25, color: Color = HAZARD) {
  const base = hdr(color, intensity);
  const material = new MeshBasicMaterial({ color: base.clone() });
  parts.push({ material, base, kind: 'accent' });
  return material;
}

function core(parts: TintPart[], intensity = 2.4, color: Color = HAZARD_HOT) {
  const base = hdr(color, intensity);
  const material = new MeshBasicMaterial({ color: base.clone() });
  parts.push({ material, base, kind: 'core' });
  return material;
}

function additive(parts: TintPart[], intensity: number, kind: TintPart['kind'] = 'accent', color: Color = HAZARD) {
  const base = hdr(color, intensity);
  const material = new MeshBasicMaterial({ color: base.clone(), blending: AdditiveBlending, transparent: true, depthWrite: false, side: 2 });
  parts.push({ material, base, kind });
  return material;
}

/** A dark keyline (or hazard rim) around a shared outline geometry. */
function lines(parts: TintPart[], edges: BufferGeometry, color: Color, kind: TintPart['kind'] = 'accent') {
  const material = new LineBasicMaterial({ color: color.clone() });
  parts.push({ material, base: color.clone(), kind });
  return new LineSegments(edges, material);
}

function extrudeShape(points: Array<[number, number]>, depth: number) {
  const shape = new Shape();
  points.forEach(([x, y], index) => (index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  // Lay the shape in the XZ plane, nose (+y in the shape) toward +Z.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

const meshOf = (geometry: BufferGeometry, material: MeshBasicMaterial | MeshLambertMaterial) => new Mesh(geometry, material);

// ---- kite: swept delta of the storm --------------------------------------------------------

export function createKiteMesh() {
  const shared = once('kite', () => {
    const wing = extrudeShape([[0, 1.9], [-1.9, -0.9], [-0.55, -0.55], [0, -0.85], [0.55, -0.55], [1.9, -0.9]], 0.16);
    return {
      wing,
      edges: new EdgesGeometry(wing, 20),
      spine: new BoxGeometry(0.12, 0.2, 2.2).translate(0, 0.06, 0.15),
      eye: new SphereGeometry(0.14, 8, 6).translate(0, 0.06, 1.0),
      streamer: new BoxGeometry(0.07, 0.025, 3.3).translate(0, 0, -1.65),
    };
  });
  const group = new Group();
  const parts: TintPart[] = [];
  group.add(meshOf(shared.wing, body(parts, GUNMETAL, 0.2)));
  group.add(lines(parts, shared.edges, HAZARD.clone().multiplyScalar(1.4)));
  group.add(meshOf(shared.spine, accent(parts, 1.5)));
  group.add(meshOf(shared.eye, core(parts, 2.6)));
  // Streamers whip in the gust.
  const streamers: Mesh[] = [];
  const streamerMaterial = accent(parts, 1.1);
  for (const side of [-1, 1]) {
    const streamer = meshOf(shared.streamer, streamerMaterial);
    streamer.position.set(side * 1.55, 0, -0.85);
    group.add(streamer);
    streamers.push(streamer);
  }
  group.userData.streamers = streamers;
  group.userData.baseScale = 1.4;
  register(group, { parts, accent: HAZARD, lockRingScale: 1.05 });
  return group;
}

// ---- manta: the squall's slow glider ---------------------------------------------------------

export function createMantaMesh() {
  const shared = once('manta', () => {
    const wingFor = (side: number) => {
      const shape = extrudeShape([[0, 1.4], [side * 5.2, -0.1], [side * 4.9, -1.6], [side * 2.4, -2.2], [0, -1.8]], 0.1);
      const stripes = new MergeBuilder();
      for (let i = 1; i <= 3; i += 1) {
        stripes.add(new BoxGeometry(0.16, 0.05, 1.5), 'stripes', { position: [side * (1.0 + i * 1.05), 0.06, -0.55 - i * 0.12], rotation: [0, side * -0.32, 0] });
      }
      return { shape, edges: new EdgesGeometry(shape, 15), stripes: stripes.build().get('stripes') as BufferGeometry };
    };
    const eyes = new MergeBuilder();
    for (const side of [-1, 1]) eyes.add(new SphereGeometry(0.16, 8, 6), 'eyes', { position: [side * 0.42, 0.14, 2.05] });
    return {
      trunk: new SphereGeometry(1, 14, 10).scale(1.25, 0.42, 2.6),
      left: wingFor(-1),
      right: wingFor(1),
      eyes: eyes.build().get('eyes') as BufferGeometry,
      link: new BoxGeometry(0.16, 0.06, 0.95).translate(0, 0, -0.45),
    };
  });
  const group = new Group();
  const parts: TintPart[] = [];
  group.add(meshOf(shared.trunk, body(parts, GUNMETAL, 0.22)));
  const membraneMaterial = body(parts, GUNMETAL.clone().lerp(PANEL_SHADE, 0.25), 0.2);
  const stripeMaterial = accent(parts, 1.15);
  const wings: Group[] = [];
  for (const [side, data] of [[-1, shared.left], [1, shared.right]] as const) {
    const wing = new Group();
    wing.add(meshOf(data.shape, membraneMaterial));
    wing.add(lines(parts, data.edges, HAZARD.clone().multiplyScalar(1.3)));
    wing.add(meshOf(data.stripes, stripeMaterial));
    wing.position.x = side * 0.7;
    group.add(wing);
    wings.push(wing);
  }
  group.userData.wings = wings;
  group.add(meshOf(shared.eyes, core(parts, 2.6)));
  const tailMaterial = accent(parts, 1.0);
  const tail: Group[] = [];
  let parent: Group = group;
  for (let i = 0; i < 4; i += 1) {
    const link = new Group();
    link.position.z = i === 0 ? -2.4 : -0.95;
    const seg = meshOf(shared.link, tailMaterial);
    seg.scale.set(1 - i * 0.15, 1, 1);
    link.add(seg);
    parent.add(link);
    parent = link;
    tail.push(link);
  }
  group.userData.tail = tail;
  group.userData.baseScale = 1.15;
  register(group, { parts, accent: HAZARD, lockRingScale: 2.3 });
  return group;
}

// ---- limpet: a tool that goes for the car ---------------------------------------------------------

export function createLimpetMesh() {
  const shared = once('limpet', () => {
    const legs = new MergeBuilder();
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const leg = new Group();
      const upper = new Mesh(new BoxGeometry(0.13, 0.13, 0.85));
      upper.position.set(0, 0, 0.42);
      const knee = new Group();
      knee.position.set(0, 0, 0.85);
      knee.rotation.x = 0.7;
      const lower = new Mesh(new BoxGeometry(0.11, 0.11, 0.8));
      lower.position.set(0, 0, 0.42);
      knee.add(lower);
      leg.add(upper, knee);
      leg.position.set(Math.cos(angle) * 0.75, Math.sin(angle) * 0.75, 0.1);
      leg.rotation.set(-Math.sin(angle) * 0.7, Math.cos(angle) * 0.7, 0);
      legs.addObject(leg, 'legs');
    }
    return {
      shell: new SphereGeometry(0.9, 14, 10).scale(1, 0.8, 1),
      band: new TorusGeometry(0.86, 0.09, 6, 20).rotateX(Math.PI / 2).translate(0, 0, 0.05),
      bit: new ConeGeometry(0.42, 1.1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.95),
      flutes: new TorusGeometry(0.34, 0.05, 5, 12).translate(0, 0, 0.55),
      legs: legs.build().get('legs') as BufferGeometry,
    };
  });
  const group = new Group();
  const parts: TintPart[] = [];
  group.add(meshOf(shared.shell, body(parts, GUNMETAL, 0.24)));
  group.add(meshOf(shared.band, accent(parts, 1.3)));
  group.add(meshOf(shared.legs, body(parts, PANEL_SHADE, 0.25)));
  // Drill toward the camera: the car is behind it.
  const drill = new Group();
  const bit = meshOf(shared.bit, core(parts, 1.8));
  drill.add(bit, meshOf(shared.flutes, accent(parts, 1.6)));
  group.add(drill);
  group.userData.drill = drill;
  group.userData.gnawCore = bit;
  group.userData.baseScale = 1.1;
  register(group, { parts, accent: HAZARD, lockRingScale: 1.25 });
  return group;
}

// ---- sentry: vacuum-hardened armour ----------------------------------------------------------------

export function createSentryMesh() {
  const shared = once('sentry', () => {
    const plates = new MergeBuilder();
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const plate = new Group();
      plate.position.set(Math.cos(angle) * 1.32, Math.sin(angle) * 1.32, 0.05);
      plate.rotation.set(-Math.sin(angle) * 0.35, Math.cos(angle) * 0.35, angle);
      const slab = new Mesh(new BoxGeometry(1.7, 1.7, 0.26));
      slab.userData.tag = 'plates';
      const stripe = new Mesh(new BoxGeometry(1.75, 0.3, 0.3));
      stripe.position.set(0, 0, 0.02);
      stripe.userData.tag = 'stripes';
      plate.add(slab, stripe);
      plates.addObject(plate, (mesh) => mesh.userData.tag as string);
    }
    const built = plates.build();
    const dark = new MergeBuilder();
    dark.add(new TorusGeometry(0.62, 0.11, 8, 22), 'dark', { position: [0, 0, 0.95] });
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      dark.add(new ConeGeometry(0.16, 0.42, 6), 'dark', { position: [Math.cos(angle) * 0.95, Math.sin(angle) * 0.95, -0.55], rotation: [Math.PI / 2, 0, 0] });
    }
    dark.add(new CylinderGeometry(0.03, 0.03, 1.5, 4), 'dark', { position: [0.3, 1.5, -0.2] });
    const flames = new MergeBuilder();
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      flames.add(new ConeGeometry(0.15, 1.1, 6), 'flames', { position: [Math.cos(angle) * 0.95, Math.sin(angle) * 0.95, -1.15], rotation: [-Math.PI / 2, 0, 0] });
    }
    return {
      hull: new IcosahedronGeometry(1.05, 1),
      plates: built.get('plates') as BufferGeometry,
      stripes: built.get('stripes') as BufferGeometry,
      plateEdges: new EdgesGeometry(built.get('plates') as BufferGeometry, 20),
      dark: dark.build().get('dark') as BufferGeometry,
      iris: new SphereGeometry(0.46, 16, 8).scale(1, 1, 0.18).translate(0, 0, 1.0),
      tip: new SphereGeometry(0.08, 6, 4).translate(0.3, 2.25, -0.2),
      flames: flames.build().get('flames') as BufferGeometry,
    };
  });
  const group = new Group();
  const parts: TintPart[] = [];
  group.add(meshOf(shared.hull, body(parts, PANEL_WHITE, 0.2)));
  // Armour petals: they blow off at the stage break.
  const armour = new Group();
  armour.add(meshOf(shared.plates, body(parts, PANEL_WHITE.clone().multiplyScalar(0.92), 0.2)));
  armour.add(meshOf(shared.stripes, accent(parts, 1.15)));
  armour.add(lines(parts, shared.plateEdges, KEYLINE, 'body'));
  group.add(armour);
  group.userData.armour = armour;
  group.add(meshOf(shared.dark, body(parts, CHARCOAL, 0.6)));
  // The eye: dark glass, orange iris that winds up before a shot.
  const iris = meshOf(shared.iris, core(parts, 1.4));
  group.add(iris);
  group.userData.iris = iris;
  // RCS flames for the hop burns.
  const flames = meshOf(shared.flames, additive(parts, 1.8, 'accent', HAZARD_HOT));
  flames.visible = false;
  group.add(flames);
  group.userData.flames = flames;
  group.add(meshOf(shared.tip, accent(parts, 2.0)));
  group.userData.baseScale = 1.15;
  register(group, { parts, accent: HAZARD, lockRingScale: 1.85 });
  return group;
}

// ---- bolt: the sentry's shot at you ------------------------------------------------------------------

export function createBoltMesh() {
  const shared = once('bolt', () => {
    const spikes = new MergeBuilder();
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      spikes.add(new ConeGeometry(0.16, 1.0, 5), 'spikes', { position: [-Math.sin(angle) * 0.62, Math.cos(angle) * 0.62, 0], rotation: [0, 0, angle] });
    }
    return {
      heart: new OctahedronGeometry(0.44, 0),
      spikes: spikes.build().get('spikes') as BufferGeometry,
      halo: new RingGeometry(0.62, 0.72, 20),
    };
  });
  const group = new Group();
  const parts: TintPart[] = [];
  group.add(meshOf(shared.heart, core(parts, 1.9, HAZARD_HOT)));
  group.add(meshOf(shared.spikes, body(parts, CHARCOAL, 0.9)));
  group.add(meshOf(shared.halo, additive(parts, 1.0)));
  group.userData.isHostileShot = true;
  register(group, { parts, accent: HAZARD, lockRingScale: 1.1 });
  return group;
}

// ---- torpedo: vacuum-hardened, goes for the car -----------------------------------------------------------

export function createTorpedoMesh() {
  const shared = once('torpedo', () => {
    const accents = new MergeBuilder();
    accents.add(new ConeGeometry(0.36, 1.3, 12), 'accent', { position: [0, 0, 2.1], rotation: [Math.PI / 2, 0, 0] });
    for (const z of [0.5, -0.7]) accents.add(new CylinderGeometry(0.385, 0.385, 0.26, 12), 'accent', { position: [0, 0, z], rotation: [Math.PI / 2, 0, 0] });
    const fins = new MergeBuilder();
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      fins.add(new BoxGeometry(0.06, 0.9, 0.85), 'fins', { position: [Math.cos(angle + Math.PI / 2) * 0.45, Math.sin(angle + Math.PI / 2) * 0.45, -1.25], rotation: [0, 0, angle] });
    }
    return {
      shaft: new CylinderGeometry(0.36, 0.36, 3.0, 12).rotateX(Math.PI / 2),
      accents: accents.build().get('accent') as BufferGeometry,
      fins: fins.build().get('fins') as BufferGeometry,
      flame: new ConeGeometry(0.3, 2.6, 8).rotateX(-Math.PI / 2).translate(0, 0, -2.75),
    };
  });
  const group = new Group();
  const parts: TintPart[] = [];
  group.add(meshOf(shared.shaft, body(parts, PANEL_WHITE, 0.2)));
  group.add(meshOf(shared.accents, accent(parts, 1.25)));
  group.add(meshOf(shared.fins, body(parts, CHARCOAL, 0.7)));
  const flame = meshOf(shared.flame, additive(parts, 2.2, 'core', HAZARD_HOT));
  group.add(flame);
  group.userData.flame = flame;
  group.userData.isHostileShot = true;
  register(group, { parts, accent: HAZARD, lockRingScale: 1.9 });
  return group;
}

// ---- hook: the Ripper's grapnel ----------------------------------------------------------------------------------

export function createHookMesh() {
  const shared = once('hook', () => {
    const iron = new MergeBuilder();
    iron.add(new CylinderGeometry(0.28, 0.4, 2.4, 8), 'iron', { rotation: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2;
      const prong = new Group();
      prong.position.set(Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 1.0);
      prong.rotation.set(-Math.sin(angle) * 0.42, Math.cos(angle) * 0.42, 0);
      const seg = new Mesh(new BoxGeometry(0.24, 0.24, 1.7));
      seg.position.z = 0.85;
      seg.userData.tag = 'iron';
      const tip = new Mesh(new ConeGeometry(0.2, 0.7, 5).rotateX(Math.PI / 2));
      tip.position.z = 1.9;
      tip.userData.tag = 'tips';
      prong.add(seg, tip);
      iron.addObject(prong, (mesh) => mesh.userData.tag as string);
    }
    for (let i = 0; i < 4; i += 1) iron.add(new TorusGeometry(0.28, 0.07, 5, 10), 'iron', { position: [0, 0, -1.4 - i * 0.55], rotation: [0, i % 2 === 0 ? 0 : Math.PI / 2, 0] });
    const built = iron.build();
    return {
      iron: built.get('iron') as BufferGeometry,
      tips: built.get('tips') as BufferGeometry,
      band: new CylinderGeometry(0.44, 0.44, 0.4, 8).rotateX(Math.PI / 2).translate(0, 0, -0.4),
    };
  });
  const group = new Group();
  const parts: TintPart[] = [];
  group.add(meshOf(shared.iron, body(parts, GUNMETAL, 0.4)));
  group.add(meshOf(shared.band, accent(parts, 1.4)));
  group.add(meshOf(shared.tips, core(parts, 2.0)));
  group.userData.isHostileShot = true;
  register(group, { parts, accent: HAZARD, lockRingScale: 2.3 });
  return group;
}

// ---- boss targets ---------------------------------------------------------------------------------------------------

/** A grip clamp on one of the Ripper's hands. Scaled with distance so it stays a target. */
export function createClampMesh() {
  const shared = once('clamp', () => {
    const claws = new MergeBuilder();
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
      claws.add(new BoxGeometry(0.26, 0.9, 0.26), 'claws', { position: [Math.cos(angle) * 0.45, Math.sin(angle) * 0.45, 0], rotation: [0, 0, angle - Math.PI / 2] });
    }
    return {
      ring: new RingGeometry(0.78, 1.0, 6),
      claws: claws.build().get('claws') as BufferGeometry,
      eye: new SphereGeometry(0.24, 10, 8),
    };
  });
  const group = new Group();
  const parts: TintPart[] = [];
  const ringMaterial = accent(parts, 1.8);
  ringMaterial.side = 2;
  const ring = meshOf(shared.ring, ringMaterial);
  group.add(ring);
  group.add(meshOf(shared.claws, body(parts, GUNMETAL, 0.5)));
  group.add(meshOf(shared.eye, core(parts, 2.6)));
  group.userData.scaleWithDistance = { min: 1.1, per: 0.024, max: 8.5 };
  group.userData.spinner = ring;
  register(group, { parts, accent: HAZARD, lockRingScale: 1.6 });
  return group;
}

/** The Ripper's exposed core. */
export function createCoreMesh() {
  const shared = once('core', () => ({
    orb: new SphereGeometry(1.5, 18, 14),
    rings: [0, 1, 2].map((i) => new TorusGeometry(2.4 + i * 0.5, 0.11, 6, 40)),
  }));
  const group = new Group();
  const parts: TintPart[] = [];
  group.add(meshOf(shared.orb, core(parts, 2.2)));
  const rings: Mesh[] = [];
  shared.rings.forEach((geometry, i) => {
    const material = accent(parts, 1.5);
    material.side = 2;
    const ring = meshOf(geometry, material);
    ring.rotation.set(i * 1.05, i * 0.6, 0);
    group.add(ring);
    rings.push(ring);
  });
  group.userData.spinParts = rings;
  group.userData.scaleWithDistance = { min: 1.2, per: 0.02, max: 7 };
  register(group, { parts, accent: HAZARD, lockRingScale: 2.6 });
  return group;
}

export function createHaulerClock() {
  const group = new Group();
  group.userData.parts = [];
  group.userData.hidden = true;
  return group;
}

// ---- per-frame animation ------------------------------------------------------------------------------------------------

export function animateEnemy(mesh: Group, kind: string, age: number, dt: number, distanceToCamera: number) {
  const userData = mesh.userData;
  if (kind === 'kite') {
    const gust = (userData.gust as number | undefined) ?? 0;
    const streamers = userData.streamers as Mesh[] | undefined;
    if (streamers) {
      streamers.forEach((streamer, side) => {
        streamer.rotation.y = Math.sin(age * 9 + side * 1.7) * 0.34 + gust * 0.1 * (side ? 1 : -1);
        streamer.rotation.x = Math.sin(age * 7 + side) * 0.08;
      });
    }
  } else if (kind === 'manta') {
    const wings = userData.wings as Group[] | undefined;
    if (wings) {
      const flap = Math.sin(age * 2.4 + mesh.id) * 0.34;
      wings[0].rotation.z = -flap;
      wings[1].rotation.z = flap;
    }
    const tail = userData.tail as Group[] | undefined;
    if (tail) tail.forEach((link, i) => (link.rotation.y = Math.sin(age * 3 - i * 0.9) * 0.28));
  } else if (kind === 'limpet') {
    const drill = userData.drill as Group | undefined;
    const gnaw = (userData.gnaw as number | undefined) ?? 0;
    const latched = userData.latched === true;
    if (drill) drill.rotation.z += dt * (latched ? 18 + gnaw * 30 : 6);
    const bit = userData.gnawCore as Mesh | undefined;
    if (bit) bit.scale.setScalar(1 + (latched ? gnaw * 0.5 + Math.sin(age * 30) * 0.08 : 0));
  } else if (kind === 'sentry') {
    const iris = userData.iris as Mesh | undefined;
    const charge = (userData.charge as number | undefined) ?? 0;
    if (iris) iris.scale.set(1 + charge * 1.2, 1 + charge * 1.2, 1);
    const flames = userData.flames as Mesh | undefined;
    const thrust = (userData.thrust as number | undefined) ?? 0;
    if (flames) {
      flames.visible = thrust > 0.05;
      flames.scale.set(1, 0.6 + thrust * 1.2 + Math.random() * 0.2, 1);
    }
  } else if (kind === 'torpedo') {
    const flame = userData.flame as Mesh | undefined;
    if (flame) flame.scale.set(1 + Math.sin(age * 40) * 0.1, 0.8 + Math.random() * 0.5, 1);
  } else if (kind === 'clamp' || kind === 'core') {
    const spec = userData.scaleWithDistance as { min: number; per: number; max: number } | undefined;
    if (spec) {
      const s = Math.min(spec.max, Math.max(spec.min, distanceToCamera * spec.per));
      mesh.scale.setScalar(s * ((userData.spawnScale as number | undefined) ?? 1));
    }
    const spinParts = userData.spinParts as Mesh[] | undefined;
    if (spinParts) spinParts.forEach((ring, i) => (ring.rotation.z += dt * (1.4 + i * 0.7)));
    const spinner = userData.spinner as Mesh | undefined;
    if (spinner) spinner.rotation.z += dt * 0.9;
  }
}
