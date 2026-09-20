import { Data3DTexture, LinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';
import type { Node } from 'three/webgpu';
import { int, texture3D } from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';

// Gradient noise baked at load into a small tiling 3D texture: four independent
// channels, each like `mx_noise_float` (about -1..1, one feature per unit). The
// world's shaders sample it instead of evaluating noise inline. Every inline noise
// call is expanded in full by the shader compiler, and with a dozen of them in each
// of the rock, water and concrete shaders, compiling those shaders took most of
// the level's load time. A texture fetch compiles to one instruction.

const SIZE = 64;
/** Lattice cells across the texture; one cell is one unit of noise space. */
const CELLS = 8;

function gradientVolume(seed: number) {
  const rng = mulberry32(seed);
  const gradients = new Float32Array(CELLS * CELLS * CELLS * 3);
  for (let i = 0; i < CELLS * CELLS * CELLS; i += 1) {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    gradients.set([r * Math.cos(angle), r * Math.sin(angle), z], i * 3);
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const corner = (ix: number, iy: number, iz: number, fx: number, fy: number, fz: number) => {
    const g = (((iz % CELLS) * CELLS + (iy % CELLS)) * CELLS + (ix % CELLS)) * 3;
    return gradients[g] * fx + gradients[g + 1] * fy + gradients[g + 2] * fz;
  };
  const values = new Float32Array(SIZE * SIZE * SIZE);
  const step = CELLS / SIZE;
  for (let z = 0; z < SIZE; z += 1) {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const px = x * step;
        const py = y * step;
        const pz = z * step;
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const iz = Math.floor(pz);
        const fx = px - ix;
        const fy = py - iy;
        const fz = pz - iz;
        const u = fade(fx);
        const v = fade(fy);
        const w = fade(fz);
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        const x00 = lerp(corner(ix, iy, iz, fx, fy, fz), corner(ix + 1, iy, iz, fx - 1, fy, fz), u);
        const x10 = lerp(corner(ix, iy + 1, iz, fx, fy - 1, fz), corner(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u);
        const x01 = lerp(corner(ix, iy, iz + 1, fx, fy, fz - 1), corner(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u);
        const x11 = lerp(corner(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), corner(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u);
        values[(z * SIZE + y) * SIZE + x] = lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
      }
    }
  }
  return values;
}

let volume: Data3DTexture | null = null;

function noiseVolume() {
  if (volume) return volume;
  const data = new Uint8Array(SIZE * SIZE * SIZE * 4);
  for (let channel = 0; channel < 4; channel += 1) {
    const values = gradientVolume(0x5eed + channel * 7919);
    // Gradient noise stays within about ±0.9; this spreads it over the byte range.
    for (let i = 0; i < values.length; i += 1) data[i * 4 + channel] = Math.max(0, Math.min(255, Math.round((values[i] * 1.1 * 0.5 + 0.5) * 255)));
  }
  volume = new Data3DTexture(data, SIZE, SIZE, SIZE);
  volume.format = RGBAFormat;
  volume.type = UnsignedByteType;
  volume.minFilter = LinearFilter;
  volume.magFilter = LinearFilter;
  volume.wrapS = RepeatWrapping;
  volume.wrapT = RepeatWrapping;
  volume.wrapR = RepeatWrapping;
  volume.unpackAlignment = 1;
  volume.needsUpdate = true;
  return volume;
}

/**
 * Four independent noises in -1..1 at `p`, in noise units (one feature per unit, like `mx_noise_float(p)`).
 *
 * The volume carries no mip chain, so the fetch names level 0 rather than asking
 * for an implicit derivative. That is the same sample, and it is the form a fetch
 * has to take to be legal in a vertex shader or inside a branch.
 */
export function noise4(p: Node<'vec3'>): Node<'vec4'> {
  return texture3D(noiseVolume(), p.div(CELLS)).level(int(0)).mul(2).sub(1) as unknown as Node<'vec4'>;
}

/** One noise in -1..1 at `p`. */
export function noise1(p: Node<'vec3'>): Node<'float'> {
  return noise4(p).x;
}

/** Fractal sum in 0..1 over `octaves`, the texture counterpart of `fractalNoise` from tsl-surface. */
export function fractal(p: Node<'vec3'>, octaves: number): Node<'float'> {
  let sum: Node<'float'> | null = null;
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    // Offsetting each octave keeps their lattices from lining up.
    const sample = noise1(p.mul(2 ** octave).add(octave * 3.7)).mul(0.5).add(0.5).mul(amplitude);
    sum = sum ? sum.add(sample) : sample;
    total += amplitude;
    amplitude *= 0.5;
  }
  return (sum as Node<'float'>).div(total);
}

export function disposeNoiseVolume() {
  volume?.dispose();
  volume = null;
}
