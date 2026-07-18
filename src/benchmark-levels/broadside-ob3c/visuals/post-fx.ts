import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Broadside's screen layer, driven per frame from the runtime:
//
//   flash    — muzzle wash: the cruiser's broadside, the shield collapsing, and
//              the flagship's core letting go. Gold-white, not blue-white.
//   damage   — crimson pressing in from the frame edge while your hull is hurt.
//   shadow   — the enemy warship's belly overhead. The nebula is occluded, the
//              frame goes cold and dark, and the eye of the battle is a real
//              change in the light rather than just fewer enemies.
export const flashUniform = uniform(0);
export const damageUniform = uniform(0);
export const shadowUniform = uniform(0);

export function composeBroadsideOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // In the warship's shadow the backlight is gone: everything crushes toward
  // a cold blue-black, and comes back when you clear her stern.
  const shadow = shadowUniform.clamp(0, 1);
  const grade = mix(vec3(1, 1, 1), vec3(0.42, 0.5, 0.68), shadow.mul(0.82));
  let color = base.mul(vec4(grade, float(1)));

  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.55).clamp(0, 1).pow(3.0);
  color = color.add(vec4(vec3(0.95, 0.06, 0.08).mul(edge).mul(damageUniform), float(0)));

  // Gunfire wash carries the nebula's own gold rather than a neutral white.
  return color.add(vec4(vec3(1.0, 0.88, 0.7).mul(flashUniform), float(0)));
}
