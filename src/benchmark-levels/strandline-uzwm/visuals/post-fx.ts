import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Strandline screen effects, driven per-frame by the runtime:
// - resolve is the serene grade of the freed animal: the frame warms and
//   softens toward green-gold as the camera pulls back;
// - damage is a violet pressure at the frame edge while the hull is hurt;
// - flash is the cold-white sting of vista reveals and the parent's death.
export const resolveUniform = uniform(0);
export const damageUniform = uniform(0);
export const flashUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Resolve grade: the whole frame warms toward the jelly's clean light.
  const grade = mix(vec3(1, 1, 1), vec3(1.04, 1.0, 0.9), resolveUniform.clamp(0, 1).mul(0.7));
  let color = base.mul(vec4(grade, float(1)));

  // Hull damage: sickly violet pressing in from the frame edge.
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.6).clamp(0, 1).pow(3.2);
  color = color.add(vec4(vec3(0.45, 0.08, 0.7).mul(edge).mul(damageUniform), float(0)));

  // Vista / severance flash: cold sunlit white.
  return color.add(vec4(vec3(0.85, 0.97, 0.92).mul(flashUniform), float(0)));
}
