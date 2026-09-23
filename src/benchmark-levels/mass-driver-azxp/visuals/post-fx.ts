import { Color } from 'three';
import { float, screenUV, smoothstep, uniform, vec2, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Leaf: screen-space layers over the engine-composited frame. The spine
// writes every uniform each frame; nothing here decides when they fire.
export const flashUniform = uniform(0);
export const flashColorUniform = uniform(new Color(0.7, 0.8, 1));
/** Violet static creeping in from the frame edge as the final charge builds. */
export const edgeChargeUniform = uniform(0);
export const edgeColorUniform = uniform(new Color(0.55, 0.3, 1));
/** Fades the frame to black after the barrel lets go. */
export const blackoutUniform = uniform(0);

export function composeMassDriverOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const edge = smoothstep(float(0.32), float(0.78), screenUV.distance(vec2(0.5)));
  const edgeGlow = edgeColorUniform.mul(edge.mul(edge).mul(edgeChargeUniform));
  const lit = base.rgb.add(flashColorUniform.mul(flashUniform)).add(edgeGlow);
  return vec4(lit.mul(float(1).sub(blackoutUniform)), base.a);
}
