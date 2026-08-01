import { Color, Vector3 } from 'three';
import type { ColorRepresentation, Scene } from 'three';
import type { Node, UniformNode } from 'three/webgpu';
import { Fn, atan, cameraPosition, float, max, mix, output, positionWorld, select, sqrt, uniform, vec4 } from 'three/tsl';

/**
 * Analytic height haze: what a volumetric box does in an offline renderer, as a
 * per-pixel single-scattering term.
 *
 * Integration is `scene.fogNode` (three's WebGPU node fog hook), not a post
 * hook. Every NodeMaterial picks it up with no per-material wiring, it composes
 * ahead of bloom and motion blur so haze blooms and smears like the rest of the
 * frame, and `scene.background` is left clear — sky above the structures stays
 * sky. The cost is that it reaches transparent and additive materials too.
 *
 * Two terms, both closed-form along the camera→fragment ray:
 *
 * Cold extinction. Density falls off exponentially with world height,
 * `density` at `floorHeight` with scale height `falloffHeight`. With ray length
 * L and Δy the height the ray climbs, the optical depth is
 *
 *   τ = density · L · exp(-(camY - floorHeight)/H) · f(Δy/H),  f(x) = (1 - e⁻ˣ)/x
 *
 * f is the mean of the exponential profile over the ray, f(0) = 1. Fragment
 * colour blends toward `coldColor` by 1 - e^(-τ).
 *
 * Warm emission. The hot region is a segment (equal endpoints give a point)
 * sampled at up to 8 positions. Each contributes the closed-form inverse-square
 * line integral ∫₀ᴸ ds/(w² + (s - s₀)²) = (atan((L - s₀)/w) + atan(s₀/w))/w,
 * where s₀ is the projection of the source onto the ray and w² is the squared
 * perpendicular distance plus `glowRadius²`. Normalised by radius/π so a
 * sightline through the centre reads 1. Scaled by the same mean-density factor
 * on `glowFalloffHeight`, so the glow fades with height like the cold term.
 */
export interface HeightHazeConfig {
  /** Colour horizontal sightlines dissolve into. */
  coldColor?: ColorRepresentation;
  /** Extinction per world unit at `floorHeight`. */
  density?: number;
  /** World height (Y) the density profile is anchored at. */
  floorHeight?: number;
  /** Scale height: density drops by 1/e every this many world units above the floor. */
  falloffHeight?: number;
  /** Warm light added along sightlines through the hot region. */
  glowColor?: ColorRepresentation;
  /** 0 disables the warm term. */
  glowStrength?: number;
  /** Hot region endpoints. Equal endpoints make it a point source. */
  glowStart?: Vector3;
  glowEnd?: Vector3;
  /** Softening radius of the hot region; also sets how fast the glow falls off with distance. */
  glowRadius?: number;
  /** Scale height for the warm term. */
  glowFalloffHeight?: number;
  /** Sources distributed along the segment, 1–8. Compiled in, so it is not a uniform. */
  glowSamples?: number;
}

export interface HeightHazeUniforms {
  coldColor: UniformNode<'color', Color>;
  density: UniformNode<'float', number>;
  floorHeight: UniformNode<'float', number>;
  falloffHeight: UniformNode<'float', number>;
  glowColor: UniformNode<'color', Color>;
  glowStrength: UniformNode<'float', number>;
  glowStart: UniformNode<'vec3', Vector3>;
  glowEnd: UniformNode<'vec3', Vector3>;
  glowRadius: UniformNode<'float', number>;
  glowFalloffHeight: UniformNode<'float', number>;
}

export interface HeightHaze {
  /** Assign to `scene.fogNode`, or use `attach`. */
  node: Node;
  /** Live-tweakable; write `.value` any frame. */
  uniforms: HeightHazeUniforms;
  /** Sets `scene.fogNode`; the returned function restores what was there. */
  attach(scene: Scene): () => void;
}

const DEFAULT_COLD_COLOR = 0x2a3f5c;
const DEFAULT_DENSITY = 0.012;
const DEFAULT_FLOOR_HEIGHT = 0;
const DEFAULT_FALLOFF_HEIGHT = 18;
const DEFAULT_GLOW_COLOR = 0xff7326;
const DEFAULT_GLOW_STRENGTH = 0.6;
const DEFAULT_GLOW_RADIUS = 12;
const DEFAULT_GLOW_FALLOFF_HEIGHT = 10;
const MAX_GLOW_SAMPLES = 8;
/* Below `floorHeight` the profile is held at its floor value rather than growing,
   and optical depth is capped: past this the medium is opaque anyway, and the cap
   is what keeps a ray that dives far below the floor out of exp() overflow. */
const MAX_OPTICAL_DEPTH = 40;
const MAX_HEIGHT_EXPONENT = 60;
const EPSILON = 1e-4;

type FloatNode = Node<'float'>;
type Vec3Node = Node<'vec3'>;

/** f(x) = (1 - e⁻ˣ)/x, the mean of exp(-t) over t ∈ [0, x]. Guarded at x → 0, where f → 1. */
function profileMean(x: FloatNode) {
  const clamped = x.clamp(-MAX_HEIGHT_EXPONENT, MAX_HEIGHT_EXPONENT);
  const safe = select(clamped.abs().lessThan(EPSILON), float(EPSILON), clamped);
  return safe.negate().exp().oneMinus().div(safe);
}

/** Mean density along the ray relative to the floor value, for scale height `falloff`. */
function meanDensityFactor(fragmentY: FloatNode, floorHeight: FloatNode, falloff: FloatNode) {
  const height = max(falloff, float(EPSILON));
  const atCamera = cameraPosition.y.sub(floorHeight).div(height).negate().clamp(-MAX_HEIGHT_EXPONENT, 0).exp();
  return atCamera.mul(profileMean(fragmentY.sub(cameraPosition.y).div(height)));
}

/** Normalised ∫₀ᴸ ds/(w² + (s - s₀)²) for one point source: 1 for a sightline through its centre. */
function sourceIntegral(source: Vec3Node, direction: Vec3Node, rayLength: FloatNode, radius: FloatNode) {
  const toSource = source.sub(cameraPosition);
  const along = toSource.dot(direction);
  const perpendicularSq = max(toSource.dot(toSource).sub(along.mul(along)), float(0));
  const w = max(sqrt(perpendicularSq.add(radius.mul(radius))), float(EPSILON));
  const integral = atan(rayLength.sub(along).div(w)).add(atan(along.div(w))).div(w);
  return integral.mul(radius).div(Math.PI);
}

export function createHeightHaze(config: HeightHazeConfig = {}): HeightHaze {
  const uniforms: HeightHazeUniforms = {
    coldColor: uniform(new Color(config.coldColor ?? DEFAULT_COLD_COLOR)),
    density: uniform(config.density ?? DEFAULT_DENSITY),
    floorHeight: uniform(config.floorHeight ?? DEFAULT_FLOOR_HEIGHT),
    falloffHeight: uniform(config.falloffHeight ?? DEFAULT_FALLOFF_HEIGHT),
    glowColor: uniform(new Color(config.glowColor ?? DEFAULT_GLOW_COLOR)),
    glowStrength: uniform(config.glowStrength ?? DEFAULT_GLOW_STRENGTH),
    glowStart: uniform((config.glowStart ?? new Vector3()).clone()),
    glowEnd: uniform((config.glowEnd ?? config.glowStart ?? new Vector3()).clone()),
    glowRadius: uniform(config.glowRadius ?? DEFAULT_GLOW_RADIUS),
    glowFalloffHeight: uniform(config.glowFalloffHeight ?? DEFAULT_GLOW_FALLOFF_HEIGHT),
  };

  const samples = Math.min(MAX_GLOW_SAMPLES, Math.max(1, Math.round(config.glowSamples ?? 1)));

  const node = Fn(() => {
    const toFragment = positionWorld.sub(cameraPosition);
    const rayLength = max(toFragment.length(), float(EPSILON)).toVar();
    const direction = toFragment.div(rayLength).toVar();

    const coldMean = meanDensityFactor(positionWorld.y, uniforms.floorHeight, uniforms.falloffHeight);
    const opticalDepth = uniforms.density.mul(rayLength).mul(coldMean).clamp(0, MAX_OPTICAL_DEPTH);
    const cooled = mix(output.rgb, uniforms.coldColor, opticalDepth.negate().exp().oneMinus());

    let accumulated: FloatNode = float(0);
    for (let i = 0; i < samples; i += 1) {
      const t = samples === 1 ? 0.5 : i / (samples - 1);
      const source = mix(uniforms.glowStart, uniforms.glowEnd, float(t));
      accumulated = accumulated.add(sourceIntegral(source, direction, rayLength, uniforms.glowRadius));
    }

    const glowMean = meanDensityFactor(positionWorld.y, uniforms.floorHeight, uniforms.glowFalloffHeight).clamp(0, 1);
    const glow = uniforms.glowColor.mul(uniforms.glowStrength).mul(accumulated.div(samples)).mul(glowMean);

    return vec4(cooled.add(glow), output.a);
  })();

  return {
    node,
    uniforms,
    attach(scene: Scene) {
      const previous = scene.fogNode ?? null;
      scene.fogNode = node;
      return () => {
        scene.fogNode = previous;
      };
    },
  };
}
