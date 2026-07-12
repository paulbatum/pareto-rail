import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Skyhook screen effects, driven per-frame by the runtime:
// - flash is the whiteout of the cloud punch, boss slam, and severance;
// - damage is a hazard-red edge pressure while the car is being hurt;
// - altitude cools and hardens the grade as the air disappears.
export const flashUniform = uniform(0);
export const damageUniform = uniform(0);
export const altitudeUniform = uniform(0);

export function composeSkyhookOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Thin-air grade: high altitude pulls the frame cold and slightly crisp.
  const grade = mix(vec3(1, 1, 1), vec3(0.93, 0.97, 1.07), altitudeUniform.clamp(0, 1).mul(0.85));
  let color = base.mul(vec4(grade, float(1)));

  // Hull damage: hazard red pressing in from the frame edge.
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.6).clamp(0, 1).pow(3.2);
  color = color.add(vec4(vec3(0.9, 0.08, 0.03).mul(edge).mul(damageUniform), float(0)));

  // Cloud punch / boss slam flash: cold white with a breath of warmth.
  return color.add(vec4(vec3(0.95, 0.97, 1.0).mul(flashUniform), float(0)));
}
