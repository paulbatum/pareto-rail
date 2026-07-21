import { float, mix, screenUV as tslScreenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Three screen effects, all driven from visuals/index.ts:
// - `glare` is the sunlight that floods the frame the instant the car clears
//   the cloud deck, and the white-out when the Descender's core goes;
// - `strain` is the hull-warning wash: a hazard-orange edge burn that pulses
//   while something is chewing on the car;
// - `haze` is the thickness of the air, a soft desaturating lift that drains
//   to nothing as the atmosphere runs out.
export const glareUniform = uniform(0);
export const strainUniform = uniform(0);
export const hazeUniform = uniform(0);

export function composeSkyhookOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const uv = tslScreenUV;
  const centered = uv.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.9).clamp(0, 1);

  // Thick air lifts the blacks and pulls everything toward the sky's grey.
  const hazed = mix(base, base.add(vec4(0.030, 0.036, 0.046, 0)), hazeUniform.clamp(0, 1));

  // Hull strain burns in from the edges of the frame, never the middle, so it
  // never hides a target.
  const strainBurn = vec3(1.0, 0.34, 0.06).mul(strainUniform.mul(edge.mul(edge)).mul(0.55));

  const glare = vec3(1.0, 0.96, 0.88).mul(glareUniform);
  return hazed.add(vec4(strainBurn.add(glare), float(0)));
}
