import { MathUtils, Vector3 } from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mulberry32 } from '../../engine/rng';
import { sampleRailFrame } from '../../engine/rail';
import {
  DAM,
  GORGE_MOUTH_S,
  LIP_A,
  LIP_HEIGHT,
  SPINE,
  TAILWATER,
  WATER_LEVEL,
  archFaceA,
  damLocal,
  damPoint,
  rightVector,
  valleyRiverHalfWidth,
  type SpineSample,
} from './route';

// World queries: the shape of the gorge walls, the terrain and the water as
// plain functions of position. The environment meshes are built from these,
// and enemy code uses them to seat things on the world without reaching into
// mesh internals. Every function here is deterministic and cheap enough to
// call per enemy per frame, except `terrainHeight`, which is meant for
// placement at build time.

const noise = new SimplexNoise({ random: mulberry32(0x5b111) });

/** Fractal simplex noise in roughly -1..1. */
export function fbm2(x: number, y: number, octaves = 3) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise.noise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

export function noise3(x: number, y: number, z: number) {
  return noise.noise3d(x, y, z);
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- spine lookup -------------------------------------------------------------------

const CELL = 24;
const cells = new Map<number, number[]>();
const cellKey = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;
SPINE.forEach((sample, index) => {
  const key = cellKey(Math.floor(sample.x / CELL), Math.floor(sample.z / CELL));
  const list = cells.get(key);
  if (list) list.push(index);
  else cells.set(key, [index]);
});
const COARSE = SPINE.filter((_, index) => index % 12 === 0);

export type SpineHit = {
  sample: SpineSample;
  /** Signed horizontal offset from the spine: positive to the right of the flow. */
  lateral: number;
  distance: number;
};

const hit: SpineHit = { sample: SPINE[0], lateral: 0, distance: 0 };

/** Nearest spine sample to a horizontal position. Returns a shared object; copy what you keep. */
export function nearestSpine(x: number, z: number): SpineHit {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = -1;
  let bestDistance = Infinity;
  let maxRadius = 6;
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius && radius > 0) continue;
        const list = cells.get(cellKey(cx + dx, cz + dz));
        if (!list) continue;
        for (const index of list) {
          const sample = SPINE[index];
          const distance = (sample.x - x) ** 2 + (sample.z - z) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
      }
    }
    // One more ring after the first hit: a sample in the next ring can still be nearer.
    if (best >= 0 && maxRadius > radius + 1) maxRadius = radius + 1;
  }
  if (best < 0) {
    let coarse = 0;
    for (let i = 0; i < COARSE.length; i += 1) {
      const distance = (COARSE[i].x - x) ** 2 + (COARSE[i].z - z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        coarse = i;
      }
    }
    best = SPINE.indexOf(COARSE[coarse]);
    for (let i = Math.max(0, best - 12); i < Math.min(SPINE.length, best + 12); i += 1) {
      const distance = (SPINE[i].x - x) ** 2 + (SPINE[i].z - z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
  }
  const sample = SPINE[best];
  const rx = Math.cos(sample.heading);
  const rz = Math.sin(sample.heading);
  hit.sample = sample;
  hit.lateral = (x - sample.x) * rx + (z - sample.z) * rz;
  hit.distance = Math.sqrt(bestDistance);
  return hit;
}

// ---- gorge walls ------------------------------------------------------------------

/** 1 is the right wall (the sunward side), -1 the left. */
export type WallSide = 1 | -1;

type Notch = { s: number; width: number; depth: number; side: WallSide };
const NOTCHES: Notch[] = (() => {
  const rng = mulberry32(0x4e07c4);
  const notches: Notch[] = [];
  for (let s = 420; s < GORGE_MOUTH_S - 60; s += 95 + rng() * 90) {
    const sunward = rng() < 0.72;
    notches.push({ s, width: 12 + rng() * 16, depth: sunward ? 0.5 + rng() * 0.32 : 0.2 + rng() * 0.2, side: sunward ? 1 : -1 });
  }
  return notches;
})();

/** Wall height after rim notches and skyline variation. */
export function wallHeight(sample: SpineSample, side: WallSide) {
  let cut = 0;
  for (const notch of NOTCHES) {
    if (notch.side !== side) continue;
    const x = Math.abs(sample.s - notch.s) / notch.width;
    if (x < 1) cut = Math.max(cut, notch.depth * (1 - x) ** 1.4);
  }
  const skyline = 1 + 0.16 * fbm2(sample.s / 90, side * 7.3, 2);
  return sample.wall * skyline * (1 - cut);
}

/** Lateral displacement of the rock face: tall joint columns plus small breakup. */
export function wallDisplacement(s: number, side: WallSide, height: number, wall: number) {
  const columns = fbm2(s * 0.045 + side * 31, height * 0.018, 3);
  const breakup = noise.noise(s * 0.22 + side * 11, height * 0.2);
  return (1.3 + wall * 0.03) * columns + 0.7 * breakup;
}

export type WallProfile = {
  /** Offsets from the river centreline, outward positive. */
  lateral: number[];
  /** Heights above the water. Monotone up to `rimIndex + 2`, then the skirt tucks under the terrain. */
  height: number[];
  rimIndex: number;
  wall: number;
};

const profiles = [new WeakMap<SpineSample, WallProfile>(), new WeakMap<SpineSample, WallProfile>()];

/** Cross-section of one gorge wall at a spine sample, before rock displacement. Cached; do not mutate. */
export function wallProfile(sample: SpineSample, side: WallSide): WallProfile {
  const cache = profiles[side > 0 ? 1 : 0];
  let profile = cache.get(sample);
  if (!profile) {
    profile = buildWallProfile(sample, side);
    cache.set(sample, profile);
  }
  return profile;
}

function buildWallProfile(sample: SpineSample, side: WallSide): WallProfile {
  const w = sample.halfWidth;
  const H = wallHeight(sample, side);
  const scale = Math.max(H, 6);
  const n1 = fbm2(sample.s / 70, side * 3.1, 2) * 0.5 + 0.5;
  const n2 = fbm2(sample.s / 55 + 40, side * 5.7, 2) * 0.5 + 0.5;
  const n3 = fbm2(sample.s / 45 + 90, side * 2.3, 2) * 0.5 + 0.5;
  const L1 = 1.5 + 7 * n1 * smooth(20, 50, H);
  const L2 = 1.5 + 6 * n2 * smooth(30, 70, H);
  const O = 4 * n3 * smooth(40, 80, H);
  const lateral = [w - 10, w - 3, w, w + 0.6, w + 1.4, w + 2, w + 2 + L1, w + 2.6 + L1 - O, w + 2.2 + L1 - 1.3 * O, w + 3.6 + L1, w + 4.2 + L1, w + 4.2 + L1 + L2, w + 5 + L1 + L2, w + 6.5 + L1 + L2, w + 9 + L1 + L2];
  const height = [-10, -2.5, 0.3, Math.max(1.2, 0.08 * scale), 0.18 * scale, 0.27 * scale, 0.285 * scale, 0.44 * scale, 0.53 * scale, 0.6 * scale, 0.71 * scale, 0.725 * scale, 0.86 * scale, 0.97 * scale, scale + 1.2];
  const rim = lateral[lateral.length - 1];
  const rimIndex = lateral.length - 1;
  lateral.push(rim + 18, rim + 32, rim + 44);
  height.push(scale + 2.4, scale + 3.2, scale - 14);
  if (H < 6) {
    // A submerged bank where the gorge opens into the lake: the whole profile sinks.
    const sink = 6 - H;
    for (let i = 3; i < height.length; i += 1) height[i] -= sink * smooth(3, 8, i);
  }
  return { lateral, height, rimIndex, wall: H };
}

/** Distance from the centreline beyond which the terrain takes over from the wall mesh. */
export function corridorHalfWidth(sample: SpineSample, side: WallSide) {
  const profile = wallProfile(sample, side);
  return profile.lateral[profile.rimIndex] + 24;
}

/** Share of the sky a point on a wall sees, 0.15 at the foot of a deep gorge to 1 in the open. */
export function wallSkyVisibility(sample: SpineSample, heightAboveWater: number, wall: number) {
  const open = smooth(0.6, 3, (2 * sample.halfWidth) / Math.max(1, wall));
  const up = MathUtils.clamp(heightAboveWater / Math.max(1, wall), 0, 1);
  return MathUtils.lerp(0.15 + 0.85 * up ** 0.8, 1, open);
}

// ---- water -------------------------------------------------------------------------

/** Water surface height near a horizontal position: river, lake, flood-filled chute or valley river. */
export function waterHeightAt(x: number, z: number) {
  const { sample } = nearestSpine(x, z);
  if (sample.kind === 'lake') {
    const { a } = damLocal(x, z);
    return a > 30 ? TAILWATER : WATER_LEVEL;
  }
  return sample.y;
}

const frameRight = new Vector3();

/** Point on the water at rail parameter `u`, offset `lateral` units across the river from the rail. */
export function riverPoint(curve: Parameters<typeof sampleRailFrame>[0], u: number, lateral: number, out = new Vector3()) {
  const frame = sampleRailFrame(curve, u);
  frameRight.set(frame.right.x, 0, frame.right.z).normalize();
  out.copy(frame.position).addScaledVector(frameRight, lateral);
  out.y = waterHeightAt(out.x, out.z);
  return out;
}

export type WallPoint = { position: Vector3; normal: Vector3; valid: boolean };

/**
 * Point on a gorge wall beside the camera at rail parameter `u`, `height` units
 * above the water, with the face's outward normal (pointing into the gorge).
 * `valid` is false outside the gorge, where there is no wall to anchor to.
 */
export function canyonWallPoint(curve: Parameters<typeof sampleRailFrame>[0], u: number, side: WallSide, height: number, out?: WallPoint): WallPoint {
  const result = out ?? { position: new Vector3(), normal: new Vector3(), valid: false };
  const frame = sampleRailFrame(curve, u);
  const { sample } = nearestSpine(frame.position.x, frame.position.z);
  const profile = wallProfile(sample, side);
  const top = profile.height[profile.rimIndex];
  const h = MathUtils.clamp(height, 0.5, top);
  let i = 0;
  while (i < profile.rimIndex - 1 && profile.height[i + 1] < h) i += 1;
  const t = (h - profile.height[i]) / Math.max(1e-4, profile.height[i + 1] - profile.height[i]);
  const lateral = MathUtils.lerp(profile.lateral[i], profile.lateral[i + 1], t) + wallDisplacement(sample.s, side, h, profile.wall);
  const right = rightVector(sample.heading, frameRight);
  result.position.set(sample.x, sample.y + h, sample.z).addScaledVector(right, side * lateral);
  const slope = (profile.lateral[i + 1] - profile.lateral[i]) / Math.max(1e-4, profile.height[i + 1] - profile.height[i]);
  result.normal.copy(right).multiplyScalar(-side).setY(slope).normalize();
  result.valid = sample.kind === 'river' && sample.s < GORGE_MOUTH_S && profile.wall > 8;
  return result;
}

/** The rim edge above the camera at rail parameter `u`, where winch cables hang from. */
export function rimPoint(curve: Parameters<typeof sampleRailFrame>[0], u: number, side: WallSide, out = new Vector3()) {
  const frame = sampleRailFrame(curve, u);
  const { sample } = nearestSpine(frame.position.x, frame.position.z);
  const profile = wallProfile(sample, side);
  const right = rightVector(sample.heading, frameRight);
  const lateral = profile.lateral[profile.rimIndex - 1];
  return out.set(sample.x, sample.y + profile.height[profile.rimIndex], sample.z).addScaledVector(right, side * lateral);
}

// ---- terrain ------------------------------------------------------------------------

/** Lake shoreline half-width at axial dam coordinate `a`: a winding granite basin, narrowing to the dam's neck. */
export function lakeShore(a: number, side = 1) {
  const basin = 185 + 40 * fbm2(a / 150, 3.3 + side, 2);
  return MathUtils.lerp(basin, DAM.halfSpan - 26, smooth(-120, 10, a));
}

/** Landscape far from the water: plateau and hills stepping down toward the valley below the dam. */
function landscape(x: number, z: number, a: number) {
  const base = MathUtils.lerp(60, -42, smooth(-1500, -520, a)) + MathUtils.lerp(0, -72, smooth(150, 900, a));
  const ridges = 1 - Math.abs(fbm2(x / 520, z / 520, 3));
  return base + 55 * fbm2(x / 900 + 7, z / 900, 3) + 55 * ridges * ridges;
}

const BURIED = -1000;

function gorgeTerrain(sample: SpineSample, lateral: number, x: number, z: number, a: number) {
  const side: WallSide = lateral >= 0 ? 1 : -1;
  const profile = wallProfile(sample, side);
  const corridor = profile.lateral[profile.rimIndex] + 24;
  const beyond = Math.abs(lateral) - corridor;
  if (beyond < 0) return BURIED;
  const rim = sample.y + profile.height[profile.rimIndex];
  const berm = rim - 4 + Math.min(beyond, 16) * 0.95 + Math.max(0, beyond - 16) * 0.18 + 6 * fbm2(x / 60, z / 60, 2);
  return MathUtils.lerp(berm, Math.max(landscape(x, z, a), rim - 6), smooth(30, 320, beyond));
}

function basinTerrain(a: number, l: number, x: number, z: number) {
  const absL = Math.abs(l);
  const rough = 5 * fbm2(x / 45, z / 45, 2);
  if (a < 40) {
    // Upstream of the dam the reservoir sits in the same granite country as the gorge:
    // a cliff straight out of the water, a forested bench, a second cliff band, then
    // the plateau. Near the dam the cliffs rise above the crest to hold its ends.
    const side = l < 0 ? -1 : 1;
    const shore = lakeShore(a, side);
    if (absL < shore) return WATER_LEVEL - 12 - 20 * smooth(shore, shore * 0.5, absL);
    const x0 = absL - shore;
    const neck = smooth(-160, -20, a);
    const n1 = fbm2(a / 110, side * 4.1, 2) * 0.5 + 0.5;
    const n2 = fbm2(a / 80 + 20, side * 2.2, 2) * 0.5 + 0.5;
    const cliff = 26 + 30 * n1 + (DAM.crestHeight + 8) * neck;
    const cliffWidth = 7 + 9 * n2;
    const bench = cliffWidth + 45 + 35 * n2;
    const upper = 26 + 26 * (1 - n1);
    // In the coves a mud flat of drowned forest lies exposed below the cliff.
    const flat = 34 * smooth(0.45, 0.2, n1) * (1 - neck);
    const xc = Math.max(0, x0 - flat);
    const mud = 6 * smooth(0, Math.max(1, flat), x0) + 0.8 * fbm2(x / 9, z / 9, 2);
    const crag = 3 * fbm2(x / 14, z / 14, 2) * smooth(0, cliffWidth, xc) * (1 - smooth(cliffWidth, cliffWidth + 6, xc));
    const local = WATER_LEVEL - 1.5 + mud + cliff * smooth(0, cliffWidth, xc) + Math.max(0, xc - cliffWidth) * 0.22 + upper * smooth(bench, bench + 16, xc) + Math.max(0, xc - bench - 16) * 0.12 + rough * smooth(0, 4, xc) + crag;
    return Math.max(local, MathUtils.lerp(local, landscape(x, z, a), smooth(170, 420, x0)));
  }
  // Downstream: a rock canyon below the dam opening into the sunlit valley.
  const river = valleyRiverHalfWidth(a);
  // Below the chute the canyon floor is dry rock; the river starts where the jet lands.
  if (absL < river) return a < LIP_A - 10 ? TAILWATER + 1.5 + rough * 0.3 : TAILWATER - 5;
  const canyon = MathUtils.lerp(DAM.halfSpan - 30, 520, smooth(120, 700, a));
  const x0 = absL - river;
  const width = Math.max(10, canyon - river);
  const meadow = TAILWATER + 1.2 + x0 * 0.05 + rough * 0.4;
  const wall = WATER_LEVEL + DAM.crestHeight + 20;
  const canyonSide = MathUtils.lerp(meadow, wall, smooth(width * 0.25, width, x0) ** 1.3);
  const dam = smooth(420, 60, a);
  const valleySlope = meadow + Math.max(0, x0 - 90) * 0.28 + rough;
  const near = MathUtils.lerp(valleySlope, canyonSide, dam);
  return MathUtils.lerp(near, landscape(x, z, a), smooth(width, width + 500, x0) * (1 - dam * 0.7));
}

export type TerrainSample = {
  height: number;
  /** Water level of the nearest river or lake, for wet rock at the shore. */
  waterY: number;
  /** True inside the gorge corridor, where the wall mesh is the ground and the terrain is buried. */
  buried: boolean;
};

const terrain: TerrainSample = { height: 0, waterY: 0, buried: false };

/** Ground height at a horizontal position. Returns a shared object; copy what you keep. */
export function terrainSample(x: number, z: number): TerrainSample {
  const { sample, lateral } = nearestSpine(x, z);
  const { a, l } = damLocal(x, z);
  const toBasin = sample.kind === 'river' ? smooth(GORGE_MOUTH_S - 150, GORGE_MOUTH_S + 30, sample.s) : 1;
  const gorge = toBasin < 1 ? gorgeTerrain(sample, lateral, x, z, a) : 0;
  const basin = toBasin > 0 ? basinTerrain(a, l, x, z) : 0;
  terrain.buried = toBasin < 0.5 && gorge <= BURIED;
  terrain.height = terrain.buried ? sample.y - 60 : MathUtils.lerp(gorge, basin, toBasin);
  terrain.waterY = sample.kind === 'lake' ? (a > 30 ? TAILWATER : WATER_LEVEL) : sample.y;
  return terrain;
}

/** Ground height at a horizontal position. Inside the gorge corridor it is buried below the wall mesh. */
export function terrainHeight(x: number, z: number) {
  return terrainSample(x, z).height;
}

// ---- dam ----------------------------------------------------------------------------

/** Centre of spillway bay `index` (0..gateCount-1, left to right), at the sill. */
export function gateBayCenter(index: number, out = new Vector3()) {
  const pitch = DAM.gateWidth + DAM.pierWidth;
  return damPoint(0, (index - (DAM.gateCount - 1) / 2) * pitch, DAM.sillHeight, out);
}

/** A point on the crest walkway at lateral offset `l` from the axis (negative is left). */
export function crestPoint(l: number, out = new Vector3()) {
  return damPoint(archFaceA(l) + DAM.crestWidth / 2, l, DAM.crestHeight, out);
}

/** Where the flood leaves the ski-jump lip. */
export const LIP_POSITION = damPoint(LIP_A, 0, LIP_HEIGHT);
