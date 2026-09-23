import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Strandline screen effects, written each frame by the visual spine:
// - bloom is the jelly's light flaring: a green-gold wash on clean volleys,
//   sector withering, and the parent tearing loose;
// - sting is parasite violet pressing in from the frame edge when a spore
//   lands;
// - clarity lifts the whole grade toward sunlit water for the finale.
export const bloomUniform = uniform(0);
export const stingUniform = uniform(0);
export const clarityUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const clarity = clarityUniform.clamp(0, 1);
  const grade = mix(vec3(0.97, 1.0, 1.02), vec3(1.04, 1.06, 1.0), clarity);
  let color = base.mul(vec4(grade, float(1)));
  color = color.add(vec4(vec3(0.02, 0.05, 0.045).mul(clarity), float(0)));

  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.55).clamp(0, 1).pow(2.6);
  color = color.add(vec4(vec3(0.55, 0.06, 0.62).mul(edge).mul(stingUniform), float(0)));

  const wash = float(0.35).add(edge.mul(0.65));
  return color.add(vec4(vec3(0.42, 0.62, 0.28).mul(wash).mul(bloomUniform), float(0)));
}
