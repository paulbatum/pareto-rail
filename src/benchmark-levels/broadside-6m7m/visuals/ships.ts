import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, mix, normalWorld, positionWorld, smoothstep, vec3 } from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { SPINE_TOP_FRACTION } from '../rail';
import { CYAN, GOLD, hdr, MAGENTA, MOLTEN, OBSIDIAN } from './palette';

// Capital ships. Every hull is merged into a handful of draw calls: dark
// plates lit only by a nebula rim (gold from above, magenta from the sides),
// a strip layer of running lights in the side's colour, and engine discs.
// Ships face -z in their local frame: bow at -length/2, stern at +length/2.

export type ShipSide = 'friend' | 'enemy';
export type ShipKind = 'cruiser' | 'carrier' | 'flagship' | 'homeCarrier';
export type ShipSpec = { side: ShipSide; kind: ShipKind; length: number; width: number; height: number; seed: number };

export type CapitalShip = {
  group: Group;
  segments: Group[];
  guns: Vector3[];
  engines: Vector3[];
  stripMaterial: MeshBasicMaterial;
  engineMaterial: MeshBasicMaterial;
  spec: ShipSpec;
};


const hullMaterials = new Map<ShipSide, MeshBasicNodeMaterial>();

export function hullMaterialFor(side: ShipSide) {
  const existing = hullMaterials.get(side);
  if (existing) return existing;
  const material = new MeshBasicNodeMaterial();
  const base = side === 'friend' ? new Color(0.36, 0.41, 0.5) : OBSIDIAN;
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(view).abs();
  const rim = float(1).sub(facing).pow(3.2);
  const upness = normalWorld.y.mul(0.5).add(0.5);
  const rimColor = mix(vec3(MAGENTA.r, MAGENTA.g, MAGENTA.b), vec3(GOLD.r, GOLD.g, GOLD.b), smoothstep(float(0.25), float(0.9), upness));
  const shade = float(side === 'friend' ? 0.5 : 0.45).add(normalWorld.y.mul(side === 'friend' ? 0.3 : 0.25)).add(normalWorld.x.abs().mul(0.1));
  material.colorNode = vec3(base.r, base.g, base.b).mul(shade).add(rimColor.mul(rim).mul(side === 'friend' ? 0.24 : 0.42));
  hullMaterials.set(side, material);
  return material;
}

type Category = 'hull' | 'deck' | 'strip' | 'engine';

const deckMaterials = new Map<ShipSide, MeshBasicMaterial>();
function deckMaterialFor(side: ShipSide) {
  const existing = deckMaterials.get(side);
  if (existing) return existing;
  const material = new MeshBasicMaterial({ color: side === 'friend' ? new Color(0.11, 0.125, 0.16) : new Color(0.05, 0.04, 0.06) });
  deckMaterials.set(side, material);
  return material;
}

export function createCapitalShip(spec: ShipSpec): CapitalShip {
  const rng = mulberry32(spec.seed);
  const { length: L, width: W, height: H } = spec;
  const segmentCount = spec.kind === 'flagship' ? 3 : 1;
  const buckets: Array<Record<Category, BufferGeometry[]>> = Array.from({ length: segmentCount }, () => ({ hull: [], deck: [], strip: [], engine: [] }));
  const guns: Vector3[] = [];
  const engines: Vector3[] = [];

  const segmentFor = (z: number) => {
    if (segmentCount === 1) return 0;
    if (z < -L * 0.18) return 0;
    if (z > L * 0.2) return 2;
    return 1;
  };
  const add = (category: Category, geometry: BufferGeometry, x: number, y: number, z: number, rotation?: Vector3, scale?: Vector3) => {
    const matrix = new Matrix4();
    const rotated = geometry.clone();
    if (rotation) rotated.rotateX(rotation.x).rotateY(rotation.y).rotateZ(rotation.z);
    if (scale) rotated.scale(scale.x, scale.y, scale.z);
    matrix.makeTranslation(x, y, z);
    rotated.applyMatrix4(matrix);
    buckets[segmentFor(z)][category].push(rotated);
    geometry.dispose();
  };
  const box = (category: Category, w: number, h: number, d: number, x: number, y: number, z: number) => add(category, new BoxGeometry(w, h, d), x, y, z);

  const flatDeck = spec.kind === 'carrier' || spec.kind === 'homeCarrier';

  // Keel and spine.
  box('hull', W * 0.8, H * 0.5, L * 0.72, 0, -H * 0.2, L * 0.05);
  if (flatDeck) {
    box('hull', W * 0.92, H * 0.46, L * 0.86, 0, H * 0.02, 0);
    box('deck', W, H * 0.08, L * 0.94, 0, H * 0.46, -L * 0.02); // flight deck: flat dark plating, no rim
    // Island off to one side, aft.
    box('hull', W * 0.12, H * 0.5, L * 0.1, W * 0.34, H * 0.7, L * 0.22);
    box('hull', W * 0.05, H * 0.5, L * 0.04, W * 0.34, H * 1.05, L * 0.24);
    // Hangar mouths along both flanks glow in the side's colour.
    box('strip', W * 0.02, H * 0.14, L * 0.42, W * 0.47, H * 0.12, -L * 0.05);
    box('strip', W * 0.02, H * 0.14, L * 0.42, -W * 0.47, H * 0.12, -L * 0.05);
  } else {
    const spineH = spec.kind === 'flagship' ? H * 0.6 : H * 0.55;
    const spineY = spec.kind === 'flagship' ? H * SPINE_TOP_FRACTION - spineH / 2 : H * 0.12;
    box('hull', W * 0.42, spineH, L * 0.92, 0, spineY, 0);
    // Bow prow.
    add('hull', new ConeGeometry(W * 0.21, L * 0.14, 4), 0, spineY, -L * 0.46 - L * 0.07, new Vector3(-Math.PI / 2, 0, 0), new Vector3(1, 1, spineH / (W * 0.42)));
    if (spec.kind === 'flagship') {
      // Flank sponsons carry the broadside batteries and the towers; the spine top stays clear for the trench.
      box('hull', W * 0.3, H * 0.42, L * 0.62, W * 0.36, -H * 0.02, L * 0.04);
      box('hull', W * 0.3, H * 0.42, L * 0.62, -W * 0.36, -H * 0.02, L * 0.04);
      box('hull', W * 0.1, H * 0.5, L * 0.08, W * 0.36, H * 0.4, L * 0.3);
      box('hull', W * 0.1, H * 0.5, L * 0.08, -W * 0.36, H * 0.4, L * 0.3);
      box('hull', W * 0.9, H * 0.2, L * 0.16, 0, -H * 0.42, L * 0.36);
    } else {
      box('hull', W * 0.3, H * 0.4, L * 0.22, 0, H * 0.5, L * 0.15);
      box('hull', W * 0.12, H * 0.5, L * 0.08, 0, H * 0.85, L * 0.2);
      box('hull', W * 0.35, H * 0.03, L * 0.3, W * 0.45, -H * 0.1, L * 0.05);
      box('hull', W * 0.35, H * 0.03, L * 0.3, -W * 0.45, -H * 0.1, L * 0.05);
    }
    for (let i = 0; i < 3; i += 1) {
      box('hull', W * 0.015, H * 0.35, W * 0.015, (rng() - 0.5) * W * 0.25, H * 0.75 + H * 0.15, L * (0.22 + rng() * 0.15));
    }
  }

  // Engine block and discs.
  box('hull', W * 0.7, H * 0.6, L * 0.12, 0, 0, L * 0.5);
  const engineCount = spec.kind === 'flagship' ? 5 : flatDeck ? 4 : 3;
  for (let i = 0; i < engineCount; i += 1) {
    const x = (i - (engineCount - 1) / 2) * (W * 0.62 / Math.max(1, engineCount - 1));
    const radius = spec.kind === 'flagship' ? H * 0.13 : H * 0.11;
    add('engine', new CircleGeometry(radius, 18), x, -H * 0.02, L * 0.5 + L * 0.061);
    add('hull', new BoxGeometry(radius * 2.3, radius * 2.3, L * 0.05), x, -H * 0.02, L * 0.5 + L * 0.03);
    engines.push(new Vector3(x, -H * 0.02, L * 0.5 + L * 0.065));
  }

  // Broadside batteries along both flanks; their muzzles are where tracers start.
  const gunCount = spec.kind === 'flagship' ? 10 : flatDeck ? 4 : 7;
  const flankX = flatDeck ? W * 0.47 : spec.kind === 'flagship' ? W * 0.51 : W * 0.42;
  for (let i = 0; i < gunCount; i += 1) {
    const z = MathLerp(-L * 0.3, L * 0.3, i / (gunCount - 1));
    for (const side of [-1, 1]) {
      const y = flatDeck ? H * 0.2 : H * 0.06;
      box('hull', W * 0.06, H * 0.08, L * 0.04, side * flankX, y, z);
      box('hull', W * 0.05, H * 0.02, L * 0.07, side * (flankX + W * 0.03), y + H * 0.02, z);
      guns.push(new Vector3(side * (flankX + W * 0.06), y + H * 0.02, z));
    }
  }

  // Running lights: window rows and ridge strips.
  const rows = spec.kind === 'flagship' ? 3 : 2;
  for (let row = 0; row < rows; row += 1) {
    const y = flatDeck ? -H * 0.05 + row * H * 0.16 : H * (0.08 + row * 0.16);
    const halfLength = L * (0.28 + rng() * 0.12);
    for (const side of [-1, 1]) {
      const x = side * (flatDeck ? W * 0.462 : spec.kind === 'flagship' ? W * 0.51 : W * 0.212);
      box('strip', W * 0.008, H * 0.018, halfLength * 2, x, y, (rng() - 0.5) * L * 0.1);
      // Sparse brighter window blocks break up the line.
      for (let k = 0; k < 6; k += 1) box('strip', W * 0.012, H * 0.04, L * 0.012, x, y + H * 0.05, (rng() - 0.5) * L * 0.6);
    }
  }
  if (!flatDeck) {
    const ridgeY = spec.kind === 'flagship' ? H * SPINE_TOP_FRACTION + H * 0.01 : H * 0.4;
    for (const side of [-1, 1]) box('strip', W * 0.01, H * 0.015, L * 0.7, side * W * 0.2, ridgeY, 0);
  } else {
    // Deck edge lights.
    for (const side of [-1, 1]) box('strip', W * 0.012, H * 0.02, L * 0.9, side * W * 0.49, H * 0.51, -L * 0.02);
  }

  const group = new Group();
  const stripColor = spec.side === 'friend' ? hdr(CYAN, 1.1) : hdr(MOLTEN, 1.0);
  const engineColor = spec.side === 'friend' ? hdr(CYAN, 1.45) : hdr(MOLTEN, 1.3);
  const stripMaterial = createAdditiveBasicMaterial({ color: stripColor });
  const engineMaterial = createAdditiveBasicMaterial({ color: engineColor });
  const hullMaterial = hullMaterialFor(spec.side);
  const segments: Group[] = [];
  for (const bucket of buckets) {
    const segment = new Group();
    if (bucket.hull.length) segment.add(new Mesh(mergeGeometries(bucket.hull), hullMaterial));
    if (bucket.deck.length) segment.add(new Mesh(mergeGeometries(bucket.deck), deckMaterialFor(spec.side)));
    if (bucket.strip.length) {
      const strips = new Mesh(mergeGeometries(bucket.strip), stripMaterial);
      strips.userData.raildIgnoreOcclusion = true;
      segment.add(strips);
    }
    if (bucket.engine.length) {
      const engineMesh = new Mesh(mergeGeometries(bucket.engine), engineMaterial);
      engineMesh.userData.raildIgnoreOcclusion = true;
      segment.add(engineMesh);
    }
    for (const list of Object.values(bucket)) for (const geometry of list) geometry.dispose();
    group.add(segment);
    segments.push(segment);
  }

  return { group, segments, guns, engines, stripMaterial, engineMaterial, spec };
}

function MathLerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
