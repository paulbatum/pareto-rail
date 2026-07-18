import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Strandline screen effects, driven per-frame by the runtime:
// - flash is the gold-white bloom of the reveal, stage breaks, and the tearing
//   loose of the Matriarch;
// - venom is the parasites' violet pressing in from the frame edge while the
//   diver is hurt;
// - cleanse warms the whole water column green-gold as the animal revives.
export const flashUniform = uniform(0);
export const venomUniform = uniform(0);
export const cleanseUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Revival grade: cleansed water leans warm and slightly brighter.
  const grade = mix(vec3(1, 1, 1), vec3(1.04, 1.08, 0.98), cleanseUniform.clamp(0, 1));
  let color = base.mul(vec4(grade, float(1)));

  // Venom hit: sick violet pressing in from the frame edge.
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.6).clamp(0, 1).pow(3);
  color = color.add(vec4(vec3(0.5, 0.06, 0.7).mul(edge).mul(venomUniform), float(0)));

  // Reveal / severance flash: warm white-gold light through the water.
  return color.add(vec4(vec3(0.95, 1.0, 0.85).mul(flashUniform), float(0)));
}
