import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';
import {
  CRIMSON,
  CYAN,
  CYAN_DEEP,
  EMBER,
  ICE_SHADOW,
  ICE_WHITE,
  MOLTEN,
  OBSIDIAN,
  OBSIDIAN_EDGE,
  hdr,
} from './palette';

// Capital ships are built once as merged geometry — four draw calls each — and
// then dropped into the battle at whatever angle suits the fight. Nothing here
// decides where a ship goes or what it means; environment.ts owns that.
//
// Local frame: bow at -Z, stern at +Z, X is beam, Y is up.

export type FleetSide = 'friendly' | 'enemy';

export type CapitalSpec = {
  length: number;
  beam: number;
  depth: number;
  side: FleetSide;
  seed: number;
  /** Broadside battery blisters per flank. Their muzzles are returned for the gun effects. */
  batteries?: number;
  /** 0 disables the dorsal superstructure; 1 is a full command tower stack. */
  superstructure?: number;
};

export type CapitalShip = {
  group: Group;
  /** Local-space muzzle points, alternating port and starboard. */
  batteryPoints: Vector3[];
  hullMaterial: MeshBasicMaterial;
  trimMaterial: MeshBasicMaterial;
  lightMaterial: MeshBasicMaterial;
  engineMaterial: MeshBasicMaterial;
  length: number;
};

type Palette = {
  hull: Color;
  trim: Color;
  light: Color;
  engine: Color;
  seam: Color;
};

const PALETTES: Record<FleetSide, Palette> = {
  friendly: { hull: ICE_SHADOW, trim: ICE_WHITE, light: CYAN, engine: CYAN, seam: CYAN_DEEP },
  enemy: { hull: OBSIDIAN, trim: OBSIDIAN_EDGE, light: CRIMSON, engine: MOLTEN, seam: EMBER },
};

function place(geometry: BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz));
  matrix.setPosition(x, y, z);
  return geometry.applyMatrix4(matrix);
}

function mergeInto(group: Group, geometries: BufferGeometry[], material: MeshBasicMaterial) {
  if (geometries.length === 0) return;
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  if (merged) group.add(new Mesh(merged, material));
}

export function createCapitalShip(spec: CapitalSpec): CapitalShip {
  const rng = mulberry32(spec.seed);
  const palette = PALETTES[spec.side];
  const group = new Group();
  const hull: BufferGeometry[] = [];
  const trim: BufferGeometry[] = [];
  const lights: BufferGeometry[] = [];
  const engines: BufferGeometry[] = [];
  const batteryPoints: Vector3[] = [];

  const L = spec.length;
  const B = spec.beam;
  const D = spec.depth;
  const half = L / 2;

  // Spine: eight boxes that taper toward the bow, so the silhouette narrows
  // instead of reading as one long brick.
  const segments = 8;
  for (let i = 0; i < segments; i += 1) {
    const t = i / (segments - 1);
    const z = -half + L * ((i + 0.5) / segments);
    const taper = 0.36 + 0.64 * t;
    const box = new BoxGeometry(B * taper, D * (0.5 + 0.5 * taper), L / segments + 1);
    place(box, 0, 0, z);
    hull.push(box);
  }

  // Prow: a long wedge.
  const prow = new ConeGeometry(B * 0.28, L * 0.16, 4);
  place(prow, 0, 0, -half - L * 0.06, -Math.PI / 2, 0, Math.PI / 4);
  hull.push(prow);

  // Keel fin and dorsal ridge run the full length: the shape that says "ship".
  const keel = new BoxGeometry(B * 0.1, D * 0.55, L * 0.72);
  place(keel, 0, -D * 0.6, half * 0.1);
  hull.push(keel);
  const ridge = new BoxGeometry(B * 0.22, D * 0.28, L * 0.8);
  place(ridge, 0, D * 0.55, half * 0.05);
  trim.push(ridge);

  // Flank ribs: the physical speed cue when one of these slides past you.
  const ribCount = Math.max(10, Math.round(L / 34));
  for (let i = 0; i < ribCount; i += 1) {
    const t = i / (ribCount - 1);
    const z = -half + L * (0.1 + 0.85 * t);
    const taper = 0.4 + 0.6 * t;
    for (const side of [-1, 1]) {
      const rib = new BoxGeometry(1.6, D * 0.9 * taper, 2.4);
      place(rib, side * B * 0.5 * taper, 0, z);
      trim.push(rib);
    }
  }

  // Running lights and window rows.
  const lightRows = Math.max(14, Math.round(L / 22));
  for (let i = 0; i < lightRows; i += 1) {
    const t = i / (lightRows - 1);
    const z = -half + L * (0.08 + 0.86 * t);
    const taper = 0.38 + 0.62 * t;
    for (const side of [-1, 1]) {
      const lamp = new BoxGeometry(0.7, 0.7, 1.2);
      place(lamp, side * (B * 0.52 * taper + 0.4), D * (rng() - 0.5) * 0.6, z);
      lights.push(lamp);
    }
  }

  // Broadside batteries: paired blisters with a raised muzzle block. Their
  // world positions are what the gunnery effects fire from.
  const batteries = spec.batteries ?? 0;
  for (let i = 0; i < batteries; i += 1) {
    const t = (i + 0.5) / batteries;
    const z = -half + L * (0.16 + 0.7 * t);
    const taper = 0.42 + 0.58 * t;
    for (const side of [-1, 1]) {
      const x = side * (B * 0.5 * taper + 2.2);
      const blister = new BoxGeometry(4.4, 3.2, 7.0);
      place(blister, x, D * 0.18, z);
      hull.push(blister);
      const barrel = new CylinderGeometry(0.7, 0.9, 7.5, 6);
      place(barrel, x + side * 3.2, D * 0.18, z, 0, 0, Math.PI / 2);
      trim.push(barrel);
      batteryPoints.push(new Vector3(x + side * 7.0, D * 0.18, z));
    }
  }

  // Superstructure: a stepped command stack in the aft third.
  const tower = spec.superstructure ?? 1;
  if (tower > 0) {
    const stack = 4;
    for (let i = 0; i < stack; i += 1) {
      const t = i / stack;
      const box = new BoxGeometry(B * (0.6 - t * 0.34) * tower, D * 0.5 * tower, L * (0.16 - t * 0.03));
      place(box, 0, D * (0.7 + t * 0.55) * tower, half * (0.42 + t * 0.06));
      hull.push(box);
      const band = new BoxGeometry(B * (0.62 - t * 0.34) * tower, 0.7, L * (0.165 - t * 0.03));
      place(band, 0, D * (0.7 + t * 0.55) * tower + D * 0.2, half * (0.42 + t * 0.06));
      lights.push(band);
    }
    const mast = new BoxGeometry(1.6, D * 1.5 * tower, 1.6);
    place(mast, 0, D * 2.6 * tower, half * 0.5);
    trim.push(mast);
  }

  // Engines: a bank of bells with additive discs, always the brightest thing
  // on the ship and always its faction color.
  const bells = 4;
  for (let i = 0; i < bells; i += 1) {
    const x = (i - (bells - 1) / 2) * B * 0.28;
    const bell = new CylinderGeometry(D * 0.3, D * 0.36, L * 0.05, 8);
    place(bell, x, 0, half + L * 0.02, Math.PI / 2);
    hull.push(bell);
    const disc = new CircleGeometry(D * 0.26, 12);
    place(disc, x, 0, half + L * 0.05);
    engines.push(disc);
  }

  const hullMaterial = new MeshBasicMaterial({ color: palette.hull.clone() });
  const trimMaterial = new MeshBasicMaterial({ color: palette.trim.clone().multiplyScalar(0.55) });
  const lightMaterial = createAdditiveBasicMaterial({ color: hdr(palette.light, 0.9) });
  // Engine bells are the brightest thing on a hull, but they are engines, not
  // stars: bloom turns anything much above 1.0 into a white disc at this scale.
  const engineMaterial = createAdditiveBasicMaterial({ color: hdr(palette.engine, 1.05), side: DoubleSide });

  mergeInto(group, hull, hullMaterial);
  mergeInto(group, trim, trimMaterial);
  mergeInto(group, lights, lightMaterial);
  mergeInto(group, engines, engineMaterial);

  group.userData.side = spec.side;
  return { group, batteryPoints, hullMaterial, trimMaterial, lightMaterial, engineMaterial, length: L };
}
