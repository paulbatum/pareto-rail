import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Four screen-space pressures, all written from the runtime:
// - flash: a broadside going off overhead, the shield collapsing, the core kill;
// - damage: crimson pushing in from the frame edge as the hull is opened;
// - shieldBlock: a violet slap when the flagship's shield eats a volley;
// - heat: the run's slow grade from cool nebula magenta toward furnace gold.
export const flashUniform = uniform(0);
export const damageUniform = uniform(0);
export const shieldBlockUniform = uniform(0);
export const heatUniform = uniform(0);

export function composeBroadsideOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const grade = mix(vec3(1.0, 0.98, 1.04), vec3(1.09, 0.98, 0.9), heatUniform.clamp(0, 1));
  let color = base.mul(vec4(grade, float(1)));

  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.55).clamp(0, 1).pow(3.0);
  color = color.add(vec4(vec3(0.95, 0.07, 0.09).mul(edge).mul(damageUniform), float(0)));
  color = color.add(vec4(vec3(0.55, 0.12, 0.95).mul(edge.mul(0.6).add(0.4)).mul(shieldBlockUniform), float(0)));

  return color.add(vec4(vec3(1.0, 0.94, 0.86).mul(flashUniform), float(0)));
}
