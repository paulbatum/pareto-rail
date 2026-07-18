import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Strandline screen effects, driven per-frame by the runtime:
// - flash is the soft white bloom of the reveal, the exposure, and the tear;
// - venom presses sickly violet in from the frame edge while the hull hurts;
// - cleanse warms the whole grade green-gold as the animal comes back.
export const flashUniform = uniform(0);
export const venomUniform = uniform(0);
export const cleanseGradeUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Cleansed water: the grade lifts toward warm green-gold sunlight.
  const grade = mix(vec3(1, 1, 1), vec3(1.06, 1.1, 0.96), cleanseGradeUniform.clamp(0, 1).mul(0.8));
  let color = base.mul(vec4(grade, float(1)));

  // Venom: parasite violet pressing in from the edges when the hull is hit.
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.6).clamp(0, 1).pow(3);
  color = color.add(vec4(vec3(0.5, 0.06, 0.6).mul(edge).mul(venomUniform), float(0)));

  // Flash: sunlight through water, never a hard whiteout.
  return color.add(vec4(vec3(0.85, 0.96, 0.9).mul(flashUniform), float(0)));
}
