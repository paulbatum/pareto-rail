import { AdditiveBlending, Color, DoubleSide, Vector3 } from 'three';
import type { Side } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, fract, max, mix, normalWorld, positionLocal, step, uniform, vec3, vertexColor } from 'three/tsl';

// Shared lighting. Every lit surface in the level — climber, station, enemies —
// reads the same sky-driven ambient and sun, so the storm greys everything,
// the sunlit sky blues the shadows, and vacuum turns the light hard and raking.
// The spine writes these every frame; this leaf only builds materials.

/** Colors travel as vec3 uniforms (r, g, b in x, y, z) so they mix freely with math nodes. */
export function colorUniform(color = new Color(0, 0, 0)) {
  return uniform(new Vector3(color.r, color.g, color.b));
}
export type ColorUniform = ReturnType<typeof colorUniform>;
export function setColorUniform(target: ColorUniform, color: Color) {
  target.value.set(color.r, color.g, color.b);
}

export const ambientUniform = colorUniform(new Color(0.5, 0.52, 0.56));
export const sunColorUniform = colorUniform(new Color(0.1, 0.1, 0.1));
export const sunDirectionUniform = uniform(new Vector3(0.62, 0.3, -0.72).normalize());
/** Lightning / whiteout flash that lights every lit surface at once. */
export const flashLightUniform = uniform(0);

export type LitOptions = {
  side?: Side;
  /** Multiply the base color by the geometry's vertex colors. */
  vertexColors?: boolean;
  /** Unlit additive self-glow added on top (HDR allowed). */
  emissive?: Color;
  transparent?: boolean;
  opacity?: number;
};

export function litMaterial(base: Color, options: LitOptions = {}) {
  const material = new MeshBasicNodeMaterial();
  const tint = vec3(base.r, base.g, base.b);
  const albedo = options.vertexColors ? tint.mul(vertexColor().rgb) : tint;
  const diffuse = max(float(0), normalWorld.dot(sunDirectionUniform));
  // A soft wrap term keeps the unlit side from going dead black in daylight.
  const wrap = normalWorld.dot(sunDirectionUniform).mul(0.5).add(0.5).mul(0.25);
  const light = ambientUniform.add(sunColorUniform.mul(diffuse.add(wrap))).add(flashLightUniform);
  let color = albedo.mul(light);
  if (options.emissive) color = color.add(vec3(options.emissive.r, options.emissive.g, options.emissive.b));
  material.colorNode = color;
  if (options.side !== undefined) material.side = options.side;
  if (options.transparent) {
    material.transparent = true;
    material.opacity = options.opacity ?? 1;
  }
  return material;
}

/** Unlit color, for lamps, glows, and anything that must read with bloom off. */
export function glowMaterial(color: Color, options: { additive?: boolean; opacity?: number; side?: Side; fog?: boolean } = {}) {
  const material = new MeshBasicNodeMaterial();
  material.color = color.clone();
  if (options.additive) {
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
  }
  if (options.opacity !== undefined) {
    material.transparent = true;
    material.opacity = options.opacity;
  }
  material.side = options.side ?? DoubleSide;
  if (options.fog === false) material.fog = false;
  return material;
}

/** Hazard chevrons: diagonal orange/graphite bands in local space. */
export function hazardStripeMaterial(orange: Color, dark: Color, frequency = 2.2) {
  const material = new MeshBasicNodeMaterial();
  const band = step(float(0.5), fract(positionLocal.x.add(positionLocal.y).add(positionLocal.z).mul(frequency)));
  const albedo = mix(vec3(dark.r, dark.g, dark.b), vec3(orange.r, orange.g, orange.b), band);
  const diffuse = max(float(0), normalWorld.dot(sunDirectionUniform));
  const light = ambientUniform.add(sunColorUniform.mul(diffuse.add(0.12))).add(flashLightUniform);
  material.colorNode = albedo.mul(light);
  return material;
}
