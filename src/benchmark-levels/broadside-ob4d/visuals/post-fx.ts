import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Four screen-space uniforms, all written by the runtime:
//
//   flash    white events — the catapult, the shield collapse, a core going up
//   damage   crimson pressure at the frame edge while your hull is taking hits
//   nebula   how much of the nebula's magenta-and-gold grade sits over the frame;
//            it lifts in the eye of the battle and again for the victory pull-out
//   alarm    the flagship's shield envelope answering a shot it just absorbed
export const flashUniform = uniform(0);
export const damageUniform = uniform(0);
export const nebulaUniform = uniform(0);
export const alarmUniform = uniform(0);

export function composeBroadsideOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Nebula grade: push magenta into the shadows and gold into the highlights,
  // so the whole frame reads as lit by the cloud rather than by the ships.
  const grade = mix(vec3(1, 1, 1), vec3(1.1, 0.94, 1.06), nebulaUniform.clamp(0, 1));
  let color = base.mul(vec4(grade, float(1)));

  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.55).clamp(0, 1).pow(3.0);

  // Gold bloom in from the corners with the nebula lift — the backdrop
  // bleeding into frame during the quiet moments.
  color = color.add(vec4(vec3(0.5, 0.3, 0.12).mul(edge).mul(nebulaUniform).mul(0.5), float(0)));
  // Hull damage: crimson closing in.
  color = color.add(vec4(vec3(0.95, 0.06, 0.08).mul(edge).mul(damageUniform), float(0)));
  // Shield absorb: a magenta wash across the whole frame, not just the edge.
  color = color.add(vec4(vec3(0.7, 0.12, 0.6).mul(alarmUniform).mul(0.5), float(0)));

  return color.add(vec4(vec3(1.0, 0.95, 0.92).mul(flashUniform), float(0)));
}
