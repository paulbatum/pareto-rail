import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { bindTint, createTintState, surfaceMaterial, type TintState } from './materials';
import { MURK, THERMAL, hdr } from './palette';

// The brood and the boss parts. Every creature is built from flesh and harbor
// debris, and every one carries a *signal core*: a sodium lure or gland in
// murk that burns red in thermal — the thing the player is really aiming at.
// Leaf file: shapes and materials only; motion lives in gameplay, reactions in
// the visuals spine.

export type EnemyParts = {
  tint: TintState;
  /** Parts the spine animates, by role. */
  legs?: Group[];
  segments?: Object3D[];
  bell?: Object3D;
  tendrils?: Object3D[];
  glands?: Object3D[];
  heart?: Object3D;
  membrane?: Object3D;
  beak?: Object3D[];
  /** Lock-marker radius for this silhouette. */
  markerScale: number;
  /** Colors the kill burst throws. */
  burst: { flesh: Color; debris: Color };
};

// Materials are built once per role and shared by every instance; hit, deny,
// and charge reactions come from each mesh's own tint state.
const materialCache = new Map<string, ReturnType<typeof surfaceMaterial>>();
const cached = (key: string, build: () => ReturnType<typeof surfaceMaterial>) => {
  let material = materialCache.get(key);
  if (!material) {
    material = build();
    materialCache.set(key, material);
  }
  return material;
};

const creature = (key: string, color: Color, heat: Color, options: { emissive?: Color; roughness?: number; flat?: boolean } = {}) =>
  cached(`creature:${key}`, () => surfaceMaterial({
    color,
    heat,
    emissive: options.emissive,
    roughness: options.roughness ?? 0.55,
    metalness: 0.15,
    veil: true,
    tint: true,
    flatShading: options.flat,
  }));

/** The red-in-thermal signal core: a sodium lure in murk. */
const signal = (murkGlow: number) =>
  cached(`signal:${murkGlow}`, () => surfaceMaterial({
    color: new Color(0.1, 0.05, 0.02),
    heat: THERMAL.signal,
    emissive: hdr(MURK.sodiumHot, murkGlow),
    lit: false,
    veil: true,
    tint: true,
    cooling: 0.1,
    chargeThermal: new Color(3.2, 0.4, 0.2),
  }));

const scrap = (key: string, color: Color) =>
  cached(`scrap:${key}`, () => surfaceMaterial({ color, heat: THERMAL.bodyCool.clone().multiplyScalar(0.55), roughness: 0.85, metalness: 0.45, veil: true, tint: true, flatShading: true }));

function finish(root: Group, parts: EnemyParts) {
  bindTint(root, parts.tint);
  root.userData.parts = parts;
  return root;
}

// Shared geometry.
const sphereHigh = new SphereGeometry(1, 18, 12);
const sphereLow = new SphereGeometry(1, 10, 8);
const lumpy = new IcosahedronGeometry(1, 1);
const unitBox = new BoxGeometry(1, 1, 1);
const unitCylinder = new CylinderGeometry(1, 1, 1, 6, 1);
const unitCone = new ConeGeometry(1, 1, 6, 1);
const ring = new TorusGeometry(1, 0.22, 6, 14);
const coreGeometry = new IcosahedronGeometry(1, 3);

function part(geometry: typeof unitBox | typeof sphereHigh | typeof unitCylinder | typeof unitCone | typeof ring | typeof lumpy, material: ReturnType<typeof surfaceMaterial>, position: Vector3, scale: Vector3, rotation?: Vector3) {
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.scale.copy(scale);
  if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  return mesh;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Scrapper: a crab of pale flesh armored in rusted plate, walking on rebar. Seen from above, legs splayed. */
export function createScrapper(): Group {
  const tint = createTintState();
  const root = new Group();
  const crab = new Group();
  crab.rotation.x = 1.1; // tip its back toward the viewer
  root.add(crab);
  const flesh = creature('scrapper-flesh', MURK.flesh, THERMAL.body, { flat: true });
  const plate = scrap('rust', MURK.rust);
  const paint = scrap('cream', MURK.cream);
  const rebar = scrap('iron', MURK.iron);
  crab.add(part(lumpy, flesh, v(0, 0, 0), v(1.55, 0.62, 1.2)));
  crab.add(part(unitBox, plate, v(-0.45, 0.55, -0.1), v(1.1, 0.12, 0.9), v(0.1, 0.3, 0.18)));
  crab.add(part(unitBox, paint, v(0.5, 0.52, 0.15), v(0.9, 0.1, 0.8), v(-0.12, -0.4, -0.2)));
  crab.add(part(unitBox, plate, v(0.05, 0.62, -0.62), v(1.3, 0.1, 0.5), v(0.3, 0.1, 0)));
  // Six rebar legs in two jointed segments.
  const legs: Group[] = [];
  for (const side of [-1, 1]) {
    for (const [index, z] of [-0.62, 0.05, 0.7].entries()) {
      const leg = new Group();
      leg.position.set(side * 1.25, 0, z);
      leg.rotation.y = side * (0.35 - index * 0.35);
      const femur = part(unitCylinder, rebar, v(side * 0.55, 0.35, 0), v(0.09, 1.25, 0.09), v(0, 0, side * -1.0));
      const tibia = part(unitCylinder, rebar, v(side * 1.32, 0.05, 0), v(0.07, 1.25, 0.07), v(0, 0, side * 0.55));
      leg.add(femur, tibia);
      leg.userData.side = side;
      leg.userData.phase = index * 2.1 + (side > 0 ? 1 : 0);
      crab.add(leg);
      legs.push(leg);
    }
  }
  // Sheet-metal pincers and the lamp-eye that burns red in thermal.
  for (const side of [-1, 1]) {
    crab.add(part(unitBox, paint, v(side * 0.8, 0.15, 1.45), v(0.28, 0.2, 0.9), v(0, side * -0.5, 0)));
    crab.add(part(unitBox, paint, v(side * 1.1, 0.12, 1.85), v(0.2, 0.16, 0.7), v(0, side * 0.35, 0)));
  }
  const eye = part(sphereLow, signal(3.2), v(0, 0.28, 1.05), v(0.34, 0.34, 0.34));
  crab.add(eye);
  return finish(root, {
    tint,
    legs,
    heart: eye,
    markerScale: 1.25,
    burst: { flesh: MURK.flesh, debris: MURK.rust },
  });
}

export const EEL_SEGMENTS = 10;

/** Cable leech: a lamprey head with a lure, trailing a hose of flesh rings and rusted collars. */
export function createEel(): Group {
  const tint = createTintState();
  const root = new Group();
  const flesh = creature('eel-flesh', MURK.flesh.clone().multiplyScalar(0.85), THERMAL.body);
  const dark = creature('eel-dark', MURK.fleshDark, THERMAL.body.clone().multiplyScalar(0.8));
  const collar = scrap('rust', MURK.rust);
  const teeth = creature('bone', MURK.bone, THERMAL.bodyCool);
  const head = new Group();
  head.add(part(sphereHigh, dark, v(0, 0, 0), v(1.25, 0.72, 0.72)));
  head.add(part(ring, teeth, v(1.05, 0, 0), v(0.46, 0.46, 0.46), v(0, Math.PI / 2, 0)));
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    head.add(part(unitCone, teeth, v(1.18, Math.cos(angle) * 0.4, Math.sin(angle) * 0.4), v(0.08, 0.3, 0.08), v(angle, 0, -Math.PI / 2)));
  }
  head.add(part(unitCylinder, collar, v(0.1, 0.7, 0), v(0.05, 0.9, 0.05), v(0, 0, -0.5)));
  const lure = part(sphereLow, signal(3.4), v(0.42, 1.12, 0), v(0.3, 0.3, 0.3));
  head.add(lure);
  root.add(head);
  const segments: Object3D[] = [];
  for (let i = 0; i < EEL_SEGMENTS; i += 1) {
    const radius = 0.62 * (1 - i / (EEL_SEGMENTS + 2));
    const segment = new Group();
    segment.add(part(sphereLow, i % 2 === 0 ? flesh : dark, v(0, 0, 0), v(radius * 1.25, radius, radius)));
    if (i % 3 === 1) segment.add(part(ring, collar, v(0, 0, 0), v(radius * 1.05, radius * 1.05, radius * 1.05), v(0, Math.PI / 2, 0)));
    root.add(segment);
    segments.push(segment);
  }
  return finish(root, {
    tint,
    segments,
    heart: lure,
    markerScale: 1.2,
    burst: { flesh: MURK.flesh, debris: MURK.rustDark },
  });
}

/** Bell buoy: a rusted striped float fused to a jellyfish bell, ringing as it jets upward. */
export function createBellbuoy(): Group {
  const tint = createTintState();
  const root = new Group();
  const jelly = creature('jelly', MURK.jelly, THERMAL.body, { emissive: hdr(MURK.jelly, 0.25), roughness: 0.3 });
  const stripeRust = scrap('rust', MURK.rust);
  const stripeCream = scrap('cream', MURK.cream);
  const brass = scrap('brass', new Color(0.42, 0.3, 0.12));
  const flesh = creature('tendril', MURK.flesh, THERMAL.bodyCool);
  const bell = new Group();
  bell.add(part(sphereHigh, jelly, v(0, 0.3, 0), v(1.55, 1.15, 1.55)));
  const heart = part(sphereLow, signal(2.6), v(0, 0.4, 0.7), v(0.5, 0.5, 0.5));
  bell.add(heart);
  root.add(bell);
  root.add(part(unitCylinder, stripeRust, v(0, -0.75, 0), v(0.95, 0.5, 0.95)));
  root.add(part(unitCylinder, stripeCream, v(0, -1.25, 0), v(0.98, 0.5, 0.98)));
  root.add(part(unitCylinder, stripeRust, v(0, -1.75, 0), v(0.9, 0.5, 0.9)));
  // Cage and the bell that gives it a name.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    root.add(part(unitCylinder, brass, v(Math.cos(angle) * 0.55, 1.75, Math.sin(angle) * 0.55), v(0.05, 1.1, 0.05), v(Math.sin(angle) * 0.25, 0, -Math.cos(angle) * 0.25)));
  }
  root.add(part(unitCone, brass, v(0, 2.05, 0), v(0.42, 0.55, 0.42)));
  const tendrils: Object3D[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const tendril = new Group();
    tendril.position.set(Math.cos(angle) * 1.2, -0.2, Math.sin(angle) * 1.2);
    tendril.add(part(unitCylinder, flesh, v(0, -1.4, 0), v(0.07, 2.8, 0.07)));
    tendril.userData.phase = angle;
    root.add(tendril);
    tendrils.push(tendril);
  }
  return finish(root, {
    tint,
    bell,
    tendrils,
    heart,
    markerScale: 1.5,
    burst: { flesh: MURK.jelly, debris: MURK.cream },
  });
}

/** Ink barb: a bone spike in a glob of ink, spat at the rail. */
export function createBarb(): Group {
  const tint = createTintState();
  const root = new Group();
  const ink = cached('barb-ink', () => surfaceMaterial({ color: MURK.ink, heat: THERMAL.ink, emissive: new Color(0, 0, 0), roughness: 0.2, veil: true, tint: true }));
  const bone = creature('barb-bone', MURK.bone, THERMAL.hot);
  root.add(part(lumpy, ink, v(0, 0, -0.1), v(0.85, 0.85, 1.05)));
  root.add(part(unitCone, bone, v(0, 0, 0.9), v(0.22, 1.5, 0.22), v(Math.PI / 2, 0, 0)));
  const tip = part(sphereLow, signal(4), v(0, 0, 1.62), v(0.16, 0.16, 0.16));
  root.add(tip);
  return finish(root, {
    tint,
    heart: tip,
    markerScale: 1,
    burst: { flesh: MURK.ink, debris: MURK.bone },
  });
}

/** Arm node: a cluster of swollen glands around a lamp-bright core, grown into a tentacle. */
export function createNode(): Group {
  const tint = createTintState();
  const root = new Group();
  const gland = creature('gland', new Color(0.34, 0.16, 0.22), THERMAL.hot, { emissive: hdr(MURK.sodium, 0.18), roughness: 0.25 });
  const glands: Object3D[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    const mesh = part(sphereLow, gland, v(Math.cos(angle) * 1.05, Math.sin(angle) * 1.05, 0.1), v(0.78, 0.78, 0.7));
    root.add(mesh);
    glands.push(mesh);
  }
  const heart = part(sphereHigh, signal(2.2), v(0, 0, 0.35), v(0.85, 0.85, 0.85));
  root.add(heart);
  root.add(part(ring, creature('node-ring', MURK.fleshDark, THERMAL.body), v(0, 0, 0.1), v(1.05, 1.05, 1.05)));
  return finish(root, {
    tint,
    glands,
    heart,
    markerScale: 1.9,
    burst: { flesh: new Color(0.34, 0.16, 0.22), debris: MURK.fleshDark },
  });
}

/** The core: the burning organ at the center of the arm crown, ringed by beak plates. */
export function createCore(): Group {
  const tint = createTintState();
  const root = new Group();
  const heart = part(coreGeometry, signal(1.7), v(0, 0, 0), v(2.3, 2.3, 2.3));
  root.add(heart);
  const vein = creature('vein', MURK.fleshDark, THERMAL.hot);
  for (let i = 0; i < 3; i += 1) {
    root.add(part(ring, vein, v(0, 0, 0), v(2.4, 2.4, 2.4), v(i * 1.05, i * 0.7, 0)));
  }
  const chitin = cached('chitin', () => surfaceMaterial({ color: new Color(0.05, 0.04, 0.05), heat: THERMAL.body, roughness: 0.2, metalness: 0.3, veil: true, tint: true }));
  const beak: Object3D[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const plate = part(unitCone, chitin, v(Math.cos(angle) * 3.4, Math.sin(angle) * 3.4, -0.4), v(0.7, 2.6, 0.45), v(0, 0, angle - Math.PI / 2));
    root.add(plate);
    beak.push(plate);
  }
  const membrane = part(sphereHigh, creature('membrane', MURK.oil.clone().multiplyScalar(2.2), THERMAL.body, { roughness: 0.3 }), v(0, 0, 0.2), v(2.9, 2.9, 2.9));
  root.add(membrane);
  return finish(root, {
    tint,
    heart,
    membrane,
    beak,
    markerScale: 3.4,
    burst: { flesh: MURK.fleshDark, debris: MURK.oil },
  });
}
