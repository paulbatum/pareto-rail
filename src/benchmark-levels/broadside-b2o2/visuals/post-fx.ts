import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Broadside screen effects, written per-frame by the runtime:
// - flash is the whiteout of broadside salvos, the shield break, and the
//   flagship going up;
// - damage is crimson edge pressure while the hull is being hit;
// - nebulaGrade warms the whole frame toward the sky's magenta-gold heart,
// - victoryGold lifts the grade warm as the enemy line breaks.
export const flashUniform = uniform(0);
export const damageUniform = uniform(0);
export const victoryUniform = uniform(0);

export function composeBroadsideOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Nebula grade: a constant gentle pull toward the sky's own colors.
  let color = base.mul(vec4(vec3(1.02, 0.97, 1.04), float(1)));

  // Hull damage: crimson pressing in from the frame edge.
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.6).clamp(0, 1).pow(3.2);
  color = color.add(vec4(vec3(0.85, 0.06, 0.08).mul(edge).mul(damageUniform), float(0)));

  // Victory: the frame warms gold as the enemy line breaks.
  color = mix(color, color.mul(vec4(vec3(1.14, 1.04, 0.86), float(1))), victoryUniform.clamp(0, 1).mul(0.55));

  // Salvo / shield-break / core-kill flash: pale gold-white.
  return color.add(vec4(vec3(1.0, 0.9, 0.72).mul(flashUniform), float(0)));
}
