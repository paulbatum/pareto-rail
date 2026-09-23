import { Color, FrontSide } from 'three';
import type { Side } from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  clamp,
  float,
  mix,
  normalView,
  positionViewDirection,
  uniform,
  vec3,
} from 'three/tsl';

// Dual-sense surfaces. Every material in the level carries two answers — what
// the eye sees in sodium murk, and what the thermal sight sees — and shared
// uniforms choose between them on the GPU, so switching senses is one number,
// not a scene rebuild.
//
// Leaf file: callers supply every color and flag; nothing here decides a look.

export const senseUniforms = {
  /** 0 murk → 1 thermal display. */
  thermal: uniform(0),
  /** Creatures vanish into murk ink: ink × (1 − thermal). */
  veil: uniform(0),
  /** Harbor lamp power, 0 dark → 1 lit. */
  lamps: uniform(1),
  /** Beat energy, decays between beats. */
  beat: uniform(0),
  /** The creature's body heat, 1 alive → 0 cold corpse. */
  bodyHeat: uniform(1),
};

const colorUniform = (value: Color) => uniform(value);
const floatUniform = (value: number) => uniform(value);
type ColorUniform = ReturnType<typeof colorUniform>;

/** Per-object reaction channels, read by shared materials through `userData.tint`. */
export type TintState = {
  /** White hit flash, 0..1. */
  flash: number;
  /** Red rejection flash, 0..1. */
  deny: number;
  /** Charge glow (telegraphs, locks), 0..1. */
  charge: number;
};

export function createTintState(): TintState {
  return { flash: 0, deny: 0, charge: 0 };
}

type ObjectFrame = { object?: { userData: Record<string, unknown> } };
const readTint = (key: keyof TintState) => (frame: ObjectFrame) =>
  (frame.object?.userData.tint as TintState | undefined)?.[key] ?? 0;

// One set of tint uniforms shared by every creature material; each draw reads
// its own object's state, so a hundred brood share a handful of shaders.
const objectTint = {
  flash: floatUniform(0).onObjectUpdate(readTint('flash') as never),
  deny: floatUniform(0).onObjectUpdate(readTint('deny') as never),
  charge: floatUniform(0).onObjectUpdate(readTint('charge') as never),
};

/** Tag every mesh under `root` with the same tint state. */
export function bindTint(root: { traverse(callback: (object: { userData: Record<string, unknown> }) => void): void }, tint: TintState) {
  root.traverse((object) => {
    object.userData.tint = tint;
  });
}

export type SurfaceUniforms = {
  color: ColorUniform;
  heat: ColorUniform;
  emissive: ColorUniform;
};

export type SurfaceOptions = {
  /** Murk albedo. */
  color: Color;
  /** Thermal radiance (HDR allowed): white-hot creatures, grey cold steel. */
  heat: Color;
  /** Murk self-illumination (lamps, lures, glands). */
  emissive?: Color;
  /** Standard-lit in murk (default) or flat. */
  lit?: boolean;
  roughness?: number;
  metalness?: number;
  /** A creature: black in murk ink until the thermal sight finds it. */
  veil?: boolean;
  /** Thermal fall-off at grazing angles (0 flat → 1 strong limb cooling). */
  cooling?: number;
  /** Murk emissive follows the harbor's lamp power. */
  lampPowered?: boolean;
  /** Thermal radiance follows the creature's body heat. */
  bodyHeat?: boolean;
  /** React to the drawn object's flash/deny/charge state. */
  tint?: boolean;
  /** Color the charge channel pushes toward in murk / thermal. */
  chargeMurk?: Color;
  chargeThermal?: Color;
  side?: Side;
  transparent?: boolean;
  opacity?: number;
  flatShading?: boolean;
};

const DENY_MURK = vec3(1.4, 0.08, 0.03);

export function surfaceMaterial(options: SurfaceOptions) {
  const uniforms: SurfaceUniforms = {
    color: colorUniform(options.color.clone()),
    heat: colorUniform(options.heat.clone()),
    emissive: colorUniform((options.emissive ?? new Color(0, 0, 0)).clone()),
  };
  const thermal = senseUniforms.thermal;
  const murk = thermal.oneMinus();
  const seen = options.veil ? senseUniforms.veil.oneMinus() : float(1);

  const facing = clamp(normalView.dot(positionViewDirection), 0, 1);
  const cooling = options.cooling ?? 0.35;
  let heat = uniforms.heat.mul(mix(float(1 - cooling), float(1), facing.pow(0.55)));
  if (options.bodyHeat) heat = heat.mul(senseUniforms.bodyHeat.mul(0.88).add(0.12));

  let glow = uniforms.emissive.mul(seen);
  if (options.lampPowered) glow = glow.mul(senseUniforms.lamps);

  let extraMurk: Node<'vec3'> = vec3(0, 0, 0);
  let extraThermal: Node<'vec3'> = vec3(0, 0, 0);
  if (options.tint) {
    const tint = objectTint;
    const chargeMurk = options.chargeMurk ?? new Color(1.6, 0.9, 0.3);
    const chargeThermal = options.chargeThermal ?? new Color(2.4, 0.2, 0.1);
    extraMurk = vec3(1.4, 1.35, 1.25).mul(tint.flash)
      .add(DENY_MURK.mul(tint.deny))
      .add(vec3(chargeMurk.r, chargeMurk.g, chargeMurk.b).mul(tint.charge));
    extraThermal = vec3(2.6, 2.6, 2.6).mul(tint.flash)
      .add(vec3(2.4, 0.1, 0.05).mul(tint.deny))
      .add(vec3(chargeThermal.r, chargeThermal.g, chargeThermal.b).mul(tint.charge));
  }

  const common = {
    side: options.side ?? FrontSide,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  };

  if (options.lit === false) {
    const material = new MeshBasicNodeMaterial(common);
    material.colorNode = mix(
      uniforms.color.mul(seen).add(glow).add(extraMurk),
      heat.add(extraThermal),
      thermal,
    );
    material.userData.surface = uniforms;
    return material;
  }

  const material = new MeshStandardNodeMaterial({
    ...common,
    flatShading: options.flatShading ?? false,
    roughness: options.roughness ?? 0.8,
    metalness: options.metalness ?? 0.1,
  });
  material.colorNode = uniforms.color.mul(murk).mul(seen);
  material.emissiveNode = glow.add(extraMurk).mul(murk).add(heat.add(extraThermal).mul(thermal));
  material.userData.surface = uniforms;
  return material;
}
