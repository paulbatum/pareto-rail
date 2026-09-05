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
// Environment lighting: the level assigns `scene.environmentNode` from the
// PMREM bake in `src/engine/environment-light.ts`. A metal takes no diffuse
// light, so these metals read only under that bake or a direct light; the
// preview harness in enemies.ts bakes the same sky the level uses.

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
    metalness: 0.9,
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
    metalness: 0.85,
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
    metalness: 0.85,
    roughness: 0.34,
    brushAxis: [0, 0, 1],
    grainScale: 6,
    side: DoubleSide,
  });
  return steelTwoSided;
}

/** Black oxide: near-black, matte and rough, shared. */
export function oxideMaterial() {
  oxide ??= createMetalMaterial({
    color: BLACK_OXIDE.clone().multiplyScalar(3),
    dark: BLACK_OXIDE,
    metalness: 0.5,
    roughness: 0.68,
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
    metalness: 0.95,
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
  verdigris: { color: VERDIGRIS, emissive: 0.22, metalness: 0.2, roughness: 0.62 },
  ruby: { color: RUBY, emissive: 0.5, metalness: 0.1, roughness: 0.16 },
  'ruby-dull': { color: RUBY_DULL, emissive: 0.12, metalness: 0.1, roughness: 0.3 },
};

type AccentEntry = { material: MeshStandardMaterial; spec: AccentSpec };
type SparkEntry = { material: MeshBasicMaterial; intensity: number };

export type TargetStateInput = {
  locked: boolean;
  /** Every accent turns white-hot: the lifted pallet jewel only. */
  whiteHot?: boolean;
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

  // Every state keeps the kind colour. Locked and damaged brighten the accent's
  // own hue and the spark; denied darkens both. Only `whiteHot` recolours.
  function apply(state: TargetStateInput) {
    for (const entry of accents) {
      const { material, spec } = entry;
      if (state.whiteHot) {
        material.color.copy(WHITE_HOT);
        material.emissive.copy(WHITE_HOT).multiplyScalar(1.4 + state.pulse * 0.3);
        continue;
      }
      material.color.copy(spec.color);
      let glow = spec.emissive * (1 + state.heat * 1.6);
      if (state.locked) glow *= 2.4;
      if (state.damaged > 0) glow *= 1 + state.damaged * 3;
      if (state.denied > 0) {
        material.color.multiplyScalar(1 - state.denied * 0.65);
        glow *= 1 - state.denied;
      }
      material.emissive.copy(spec.color).multiplyScalar(glow);
    }
    for (const entry of sparks) {
      const { material, intensity } = entry;
      let strength = intensity * (1 + state.pulse * 0.3 + state.heat * 1.2);
      if (state.locked) strength *= 1.6;
      if (state.damaged > 0) strength *= 1 + state.damaged * 1.5;
      strength *= 1 - state.dim * 0.75;
      if (state.denied > 0) strength *= 1 - state.denied * 0.8;
      material.color.copy(WHITE_HOT).multiplyScalar(strength);
    }
  }

  function dispose() {
    for (const entry of accents) entry.material.dispose();
    for (const entry of sparks) entry.material.dispose();
  }

  return { accent, spark, retint, apply, dispose, accents, sparks };
}
