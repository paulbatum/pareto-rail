import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Mass Driver screen effects, written per-frame by the level runtime:
// - flash: blue-white overload on the firing slam, interlock kills, drops;
// - charge: the six-bar capacitor build tints the frame edges violet-white,
//   creeping inward as the charge approaches its peak.
export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(0.5);
  const edge = centered.dot(centered).mul(2.6).clamp(0, 1);
  const chargeTint = vec3(0.5, 0.32, 1.0).mul(edge.mul(chargeUniform).mul(0.5));
  const flash = vec3(0.78, 0.87, 1.0).mul(flashUniform);
  return base.add(vec4(chargeTint.add(flash), float(0)));
}
