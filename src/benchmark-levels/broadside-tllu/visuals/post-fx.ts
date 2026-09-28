import { float, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostComposeInput } from '../../../engine/types';

// Screen-space punctuation, all additive over the shared bloom/blur frame:
// a gold-white flare (big kills, the flagship's death), a crimson edge wash
// when the hull is hit, and a cool cyan bloom on the edges when a full volley
// is released. Uniforms are written by the runtime and decay there.

export const flareUniform = uniform(0);
export const hitUniform = uniform(0);
export const volleyUniform = uniform(0);
/** The eye of the battle: the frame cools and dims a touch while the orchestra drops away. */
export const hushUniform = uniform(0);

export function composeBroadsideOutput({ base }: LevelPostComposeInput) {
  const centered = screenUV.sub(vec2(0.5));
  const radius = centered.length().mul(1.5);
  const edge = smoothstep(float(0.55), float(1.25), radius);
  const flare = vec3(1.0, 0.86, 0.6).mul(flareUniform).mul(float(0.55).add(float(1).sub(edge).mul(0.45)));
  const wound = vec3(1.0, 0.06, 0.1).mul(hitUniform).mul(edge).mul(0.7);
  const cool = vec3(0.2, 0.8, 1.0).mul(volleyUniform).mul(edge).mul(0.16);
  const hushTint = vec3(1).sub(vec3(0.2, 0.1, 0.0).mul(hushUniform)).mul(float(1).sub(hushUniform.mul(0.12)));
  return base.mul(vec4(hushTint, 1)).add(vec4(flare.add(wound).add(cool), 0));
}
