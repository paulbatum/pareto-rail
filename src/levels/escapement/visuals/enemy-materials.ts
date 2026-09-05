import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Side } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { clamp, float, mix, normalView, positionLocal, transformNormalToView, vec3 } from 'three/tsl';
import { fractalNoise } from '../../../engine/tsl-surface';
import {
  BLACK_OXIDE,
  BRASS,
  BRASS_DARK,
  CHIME_SILVER,
  hdr,
  LOCK_COLD,
  RUBY,
  RUBY_DULL,
  STEEL_BLUE,
  STEEL_DARK,
  VERDIGRIS,
  WHITE_HOT,
} from './palette';

// Two material families. Metals (brass, steel, black oxide, silver) are lit
// MeshStandardNodeMaterials shared by every enemy and by the boss, with a
// brushed-grain colour, roughness and normal perturbation built from fractal
// noise. Target paints (verdigris, ruby, spark) are per-enemy materials so
// each target can show its own locked, denied and damaged state.
//
// Environment lighting: the level assigns `scene.environment` from a PMREM
// bake. These materials leave `envMapIntensity` at 1, so the bake lights them
// with no further change here. Metalness sits at 0.7 rather than 0.9 because a
// metal takes no diffuse light: under direct lights alone a 0.9 metal is a
// black shape with one highlight, and the level must stay legible before the
// bake is in.

type MetalSpec = {
  color: Color;
  dark: Color;
  metalness: number;
  roughness: number;
  /** Object-space axis the brushing runs along. */
  brushAxis: readonly [number, number, number];
  /** World units per grain feature. */
  grainScale: number;
  side?: Side;
};

function createMetalMaterial(spec: MetalSpec) {
  const material = new MeshStandardNodeMaterial({
    metalness: spec.metalness,
    roughness: spec.roughness,
    side: spec.side ?? 0,
  });
  const [ax, ay, az] = spec.brushAxis;
  // Squash the noise along the brush axis so the grain reads as streaks.
  const squash: [number, number, number] = [
    ax === 1 ? 0.12 : 1,
    ay === 1 ? 0.12 : 1,
    az === 1 ? 0.12 : 1,
  ];
  const grain = fractalNoise(positionLocal, { scale: spec.grainScale, octaves: 3, roughness: 0.5, squash });
  const tone = grain.mul(0.5).add(0.5);
  material.colorNode = mix(
    vec3(spec.dark.r, spec.dark.g, spec.dark.b),
    vec3(spec.color.r, spec.color.g, spec.color.b),
    tone,
  );
  material.roughnessNode = clamp(float(spec.roughness).add(grain.sub(0.5).mul(0.3)), float(0.05), float(1));
  // Anisotropic highlight: tilt the shading normal along the brush axis by the
  // grain so the specular streaks stretch with the brushing.
  const brush = transformNormalToView(vec3(ax, ay, az));
  material.normalNode = normalView.add(brush.mul(grain.sub(0.5).mul(0.35))).normalize();
  return material;
}

let brass: MeshStandardNodeMaterial | null = null;
let steel: MeshStandardNodeMaterial | null = null;
let steelTwoSided: MeshStandardNodeMaterial | null = null;
let oxide: MeshStandardNodeMaterial | null = null;
let silver: MeshStandardNodeMaterial | null = null;

/** Lamp-lit brass, shared. */
export function brassMaterial() {
  brass ??= createMetalMaterial({
    color: BRASS,
    dark: BRASS_DARK,
    metalness: 0.7,
    roughness: 0.42,
    brushAxis: [1, 0, 0],
    grainScale: 3.5,
  });
  return brass;
}

/** Steel blue, shared. */
export function steelMaterial() {
  steel ??= createMetalMaterial({
    color: STEEL_BLUE,
    dark: STEEL_DARK,
    metalness: 0.7,
    roughness: 0.38,
    brushAxis: [0, 1, 0],
    grainScale: 4,
  });
  return steel;
}

/** Steel blue rendered on both faces, for open shells such as the burr's shaving. */
export function steelTwoSidedMaterial() {
  steelTwoSided ??= createMetalMaterial({
    color: STEEL_BLUE,
    dark: STEEL_DARK,
    metalness: 0.7,
    roughness: 0.34,
    brushAxis: [0, 0, 1],
    grainScale: 6,
    side: DoubleSide,
  });
  return steelTwoSided;
}

/** Black oxide: near-black, low-roughness, shared. */
export function oxideMaterial() {
  oxide ??= createMetalMaterial({
    color: BLACK_OXIDE.clone().multiplyScalar(2.2),
    dark: BLACK_OXIDE,
    metalness: 0.45,
    roughness: 0.32,
    brushAxis: [0, 0, 1],
    grainScale: 8,
  });
  return oxide;
}

/** Chime silver, shared. */
export function silverMaterial() {
  silver ??= createMetalMaterial({
    color: CHIME_SILVER,
    dark: CHIME_SILVER.clone().multiplyScalar(0.55),
    metalness: 0.7,
    roughness: 0.22,
    brushAxis: [0, 1, 0],
    grainScale: 6,
  });
  return silver;
}

// ---- target paints -----------------------------------------------------------

export type AccentKind = 'verdigris' | 'ruby' | 'ruby-dull';

type AccentSpec = { color: Color; emissive: number; metalness: number; roughness: number };

const ACCENT_SPECS: Record<AccentKind, AccentSpec> = {
  verdigris: { color: VERDIGRIS, emissive: 0.32, metalness: 0.2, roughness: 0.62 },
  ruby: { color: RUBY, emissive: 0.6, metalness: 0.1, roughness: 0.16 },
  'ruby-dull': { color: RUBY_DULL, emissive: 0.12, metalness: 0.1, roughness: 0.3 },
};

type AccentEntry = { material: MeshStandardMaterial; spec: AccentSpec };
type SparkEntry = { material: MeshBasicMaterial; intensity: number };

export type TargetStateInput = {
  locked: boolean;
  /** 0..1 strength of the denied flash. */
  denied: number;
  /** 0..1 strength of the damage flash. */
  damaged: number;
  /** 0..1 beat pulse applied to the spark. */
  pulse: number;
  /** 0..1 heat: lifts the spark and accent glow (wasp charge, lifted jewel). */
  heat: number;
  /** 0..1 dim: lowers the spark (an engaged pallet jewel). */
  dim: number;
};

/**
 * Per-target paint: owns the accent and spark materials of one target and
 * recolours them from a state. Metals are not part of the paint; they never
 * change with state.
 */
export type TargetPaint = ReturnType<typeof createTargetPaint>;

export function createTargetPaint() {
  const accents: AccentEntry[] = [];
  const sparks: SparkEntry[] = [];
  const scratch = new Color();

  function accent(kind: AccentKind, side: Side = 0, flatShading = false) {
    const spec = ACCENT_SPECS[kind];
    const material = new MeshStandardMaterial({
      color: spec.color.clone(),
      emissive: spec.color.clone().multiplyScalar(spec.emissive),
      metalness: spec.metalness,
      roughness: spec.roughness,
      side,
      flatShading,
    });
    accents.push({ material, spec });
    return material;
  }

  function spark(intensity = 2.4) {
    const material = new MeshBasicMaterial({ color: hdr(WHITE_HOT, intensity) });
    sparks.push({ material, intensity });
    return material;
  }

  function retint(entry: AccentEntry, kind: AccentKind) {
    entry.spec = ACCENT_SPECS[kind];
  }

  function apply(state: TargetStateInput) {
    for (const entry of accents) {
      const { material, spec } = entry;
      if (state.denied > 0) {
        material.color.copy(RUBY_DULL);
        material.emissive.copy(RUBY_DULL).multiplyScalar(0.15 * state.denied);
        continue;
      }
      material.color.copy(spec.color);
      if (state.locked) material.color.lerp(LOCK_COLD, 0.45);
      const glow = spec.emissive * (1 + state.heat * 1.6);
      material.emissive.copy(state.locked ? LOCK_COLD : spec.color).multiplyScalar(glow);
      if (state.damaged > 0) material.emissive.lerp(scratch.copy(WHITE_HOT).multiplyScalar(0.9), state.damaged);
    }
    for (const entry of sparks) {
      const { material, intensity } = entry;
      if (state.denied > 0) {
        material.color.copy(RUBY_DULL).multiplyScalar(0.6);
        continue;
      }
      const base = state.locked ? LOCK_COLD : WHITE_HOT;
      let strength = intensity * (1 + state.pulse * 0.3 + state.heat * 1.2);
      if (state.locked) strength *= 1.5;
      if (state.damaged > 0) strength *= 1 + state.damaged * 1.5;
      strength *= 1 - state.dim * 0.75;
      material.color.copy(base).multiplyScalar(strength);
    }
  }

  function dispose() {
    for (const entry of accents) entry.material.dispose();
    for (const entry of sparks) entry.material.dispose();
  }

  return { accent, spark, retint, apply, dispose, accents, sparks };
}
