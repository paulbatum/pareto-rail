import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Strandline screen effects, driven per-frame by the runtime:
// - flash is the green-gold bloom of the bell reveal and the Parent's death;
// - damage is a sickly violet pressing in from the edges while the hull hurts;
// - life warms and clears the water grade as the animal comes back to life;
// - depth is a faint blue pooling in the corners: the water itself.
export const flashUniform = uniform(0);
export const damageUniform = uniform(0);
export const lifeUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Alive water: the grade lifts from cool blue toward green-gold as life returns.
  const grade = mix(vec3(0.94, 0.99, 1.05), vec3(1.05, 1.03, 0.94), lifeUniform.clamp(0, 1).mul(0.8));
  let color = base.mul(vec4(grade, float(1)));

  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.55).clamp(0, 1).pow(2.6);

  // Deep water pools in the corners, and gets clearer as the animal wakes.
  const depthTint = vec3(0.01, 0.05, 0.14).mul(edge).mul(float(1).sub(lifeUniform.mul(0.6)));
  color = color.add(vec4(depthTint, float(0)));

  // Hull damage: the infestation's violet, bleeding in from the frame edge.
  color = color.add(vec4(vec3(0.62, 0.12, 0.9).mul(edge).mul(damageUniform), float(0)));

  // Flash: the animal's own light, green-gold to white.
  return color.add(vec4(vec3(0.82, 1.0, 0.86).mul(flashUniform), float(0)));
}
