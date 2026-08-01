import type { Node } from 'three/webgpu';
import { abs, clamp, dot, float, floor, length, max, min, mix, mx_noise_float, select, sin, smoothstep, vec3 } from 'three/tsl';

export type FloatNode = Node<'float'>;
export type Vec3Node = Node<'vec3'>;
export type FloatInput = number | FloatNode;

const HASH_LARGE = 43758.5453;
const NEIGHBORHOOD = [-1, 0, 1];
const DEFAULT_RANDOMNESS = 0.12;
const DEFAULT_OCTAVES = 5;
const DEFAULT_ROUGHNESS = 0.55;
const DEFAULT_SEAM_WIDTH = 0.06;
const HAIRLINE_SCALE = 3.3;
const HAIRLINE_ANISO = 0.6;
const HAIRLINE_FLOOR = 0.55;
const FAR_EDGE = 1e4;

function asFloat(value: FloatInput): FloatNode {
  return typeof value === 'number' ? float(value) : value;
}

/** Stable pseudo-random float in 0..1 from an integer lattice coordinate. */
export function hash1(cell: Vec3Node): FloatNode {
  return sin(dot(cell, vec3(127.1, 311.7, 74.7))).mul(HASH_LARGE).fract();
}

/** Stable pseudo-random vec3 in 0..1 from an integer lattice coordinate. */
export function hash3(cell: Vec3Node): Vec3Node {
  return sin(vec3(
    dot(cell, vec3(127.1, 311.7, 74.7)),
    dot(cell, vec3(269.5, 183.3, 246.1)),
    dot(cell, vec3(113.5, 271.9, 124.6)),
  )).mul(HASH_LARGE).fract();
}

export type FractalNoiseOptions = {
  /** World-space frequency of the first octave. */
  scale?: FloatInput;
  /** Octave count. Unrolled at construction, so this is a build-time constant. */
  octaves?: number;
  /** Per-octave amplitude falloff. */
  roughness?: number;
  /** Per-axis scale applied before sampling; values below 1 stretch features along that axis. */
  squash?: readonly [number, number, number];
};

/** Multi-octave noise, roughly 0..1. */
export function fractalNoise(pos: Vec3Node, options: FractalNoiseOptions = {}): FloatNode {
  const octaves = Math.max(1, Math.round(options.octaves ?? DEFAULT_OCTAVES));
  const roughness = options.roughness ?? DEFAULT_ROUGHNESS;
  const squash = options.squash;
  const stretched = squash ? pos.mul(vec3(squash[0], squash[1], squash[2])) : pos;
  const base = stretched.mul(asFloat(options.scale ?? 1));

  let sum: FloatNode = float(0);
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    const sample = mx_noise_float(base.mul(frequency)).mul(0.5).add(0.5);
    sum = sum.add(sample.mul(amplitude));
    total += amplitude;
    amplitude *= roughness;
    frequency *= 2;
  }
  return sum.div(total);
}

export type VoronoiOptions = {
  /** 0 keeps feature points on a perfect grid; small values offset the panelling. */
  randomness?: number;
  /** Above 1 stretches cells along z. */
  aniso?: FloatInput;
};

function safeNormalize(v: Vec3Node): Vec3Node {
  return v.div(max(length(v), float(1e-6)));
}

function chebychev(v: Vec3Node): FloatNode {
  return max(max(abs(v.x), abs(v.y)), abs(v.z));
}

type Neighborhood = {
  /** Lattice coordinate of each neighbour cell. */
  cells: Vec3Node[];
  /** Vector from the sample to each neighbour's feature point, cached as shader vars. */
  offsets: Vec3Node[];
};

function neighborhood(pos: Vec3Node, scale: FloatInput, options: VoronoiOptions): Neighborhood {
  const randomness = options.randomness ?? DEFAULT_RANDOMNESS;
  const aniso = asFloat(options.aniso ?? 1);
  const p = vec3(pos.x, pos.y, pos.z.div(aniso)).mul(asFloat(scale));
  const cell = floor(p).toVar();
  const local = p.sub(cell).toVar();

  const cells: Vec3Node[] = [];
  const offsets: Vec3Node[] = [];
  for (const ox of NEIGHBORHOOD) {
    for (const oy of NEIGHBORHOOD) {
      for (const oz of NEIGHBORHOOD) {
        const neighbor = cell.add(vec3(ox, oy, oz));
        const center = vec3(ox + 0.5, oy + 0.5, oz + 0.5);
        const point = randomness === 0 ? center : center.add(hash3(neighbor).sub(0.5).mul(randomness));
        cells.push(neighbor);
        offsets.push(point.sub(local).toVar());
      }
    }
  }
  return { cells, offsets };
}

/** Stable random value 0..1 per Chebychev cell. */
export function voronoiCells(pos: Vec3Node, scale: FloatInput, options: VoronoiOptions = {}): FloatNode {
  const { cells, offsets } = neighborhood(pos, scale, options);
  let bestDistance = chebychev(offsets[0]);
  let bestRandom = hash1(cells[0]);
  for (let index = 1; index < offsets.length; index += 1) {
    const distance = chebychev(offsets[index]);
    bestRandom = select(distance.lessThan(bestDistance), hash1(cells[index]), bestRandom);
    bestDistance = min(distance, bestDistance);
  }
  return bestRandom;
}

/**
 * Distance to the nearest cell border, in cell units (0 at a border, 0.5 mid-plate).
 * Borders are the bisecting planes between the winning feature point and its
 * neighbours, which for near-lattice points are the axis-aligned box faces.
 */
export function voronoiEdgeDistance(pos: Vec3Node, scale: FloatInput, options: VoronoiOptions = {}): FloatNode {
  const { offsets } = neighborhood(pos, scale, options);
  let bestDistance = chebychev(offsets[0]);
  let bestOffset = offsets[0];
  for (let index = 1; index < offsets.length; index += 1) {
    const distance = chebychev(offsets[index]);
    bestOffset = select(distance.lessThan(bestDistance), offsets[index], bestOffset);
    bestDistance = min(distance, bestDistance);
  }

  const winner = bestOffset.toVar();
  let edge: FloatNode = float(FAR_EDGE);
  for (const offset of offsets) {
    const delta = offset.sub(winner);
    const planeDistance = dot(winner.add(offset).mul(0.5), safeNormalize(delta));
    const sameCell = dot(delta, delta).lessThan(float(1e-5));
    edge = min(edge, select(sameCell, float(FAR_EDGE), planeDistance));
  }
  return edge;
}

/** Plate-seam mask: 1 on plate faces, ~0 in the grooves between them. */
export function seams(
  pos: Vec3Node,
  scale: FloatInput,
  aniso: FloatInput = 1,
  width = DEFAULT_SEAM_WIDTH,
  options: Pick<VoronoiOptions, 'randomness'> = {},
): FloatNode {
  const randomness = options.randomness ?? DEFAULT_RANDOMNESS;
  const major = smoothstep(float(0), float(width), voronoiEdgeDistance(pos, scale, { aniso, randomness }));
  const hairline = smoothstep(
    float(0),
    float(width),
    voronoiEdgeDistance(pos, asFloat(scale).mul(HAIRLINE_SCALE), {
      aniso: asFloat(aniso).mul(HAIRLINE_ANISO),
      randomness,
    }),
  );
  return major.mul(mix(float(HAIRLINE_FLOOR), float(1), hairline));
}

export type ColorRampStop = readonly [position: number, color: readonly [number, number, number]];

/** Piecewise-linear float-to-color ramp. Stops are sorted at construction. */
export function colorRamp(stops: readonly ColorRampStop[]): (fac: FloatNode) => Vec3Node {
  if (stops.length === 0) throw new Error('colorRamp needs at least one stop');
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  return (fac: FloatNode) => {
    let color: Vec3Node = vec3(sorted[0][1][0], sorted[0][1][1], sorted[0][1][2]);
    for (let index = 1; index < sorted.length; index += 1) {
      const [from] = sorted[index - 1];
      const [to, rgb] = sorted[index];
      const span = Math.max(1e-5, to - from);
      const t = clamp(fac.sub(from).div(span), float(0), float(1));
      color = mix(color, vec3(rgb[0], rgb[1], rgb[2]), t);
    }
    return color;
  };
}
