import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Broadside screen effects, driven per-frame by the runtime:
// - flash is the catapult slam, the shield collapse, and the flagship kill;
// - damage is a crimson edge pressure while the fighter is being hurt;
// - victory warms and lifts the grade as the enemy line burns.
export const flashUniform = uniform(0);
export const damageUniform = uniform(0);
export const victoryUniform = uniform(0);

export function composeBroadsideOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Victory grade: gold seeps into the frame as the fleet's day is won.
  const grade = mix(vec3(1, 1, 1), vec3(1.1, 1.02, 0.9), victoryUniform.clamp(0, 1).mul(0.8));
  let color = base.mul(vec4(grade, float(1)));

  // Hull damage: crimson pressing in from the frame edge.
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.6).clamp(0, 1).pow(3.2);
  color = color.add(vec4(vec3(0.95, 0.05, 0.04).mul(edge).mul(damageUniform), float(0)));

  // Catapult / shield-fall / kill flash: cold cyan-white.
  return color.add(vec4(vec3(0.88, 0.97, 1.0).mul(flashUniform), float(0)));
}
