import { float, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const radial = float(1).sub(centered.length().mul(1.42).clamp(0, 1)).pow(2.15);
  let color = base.add(vec4(vec3(0.28, 0.05, 0.72).mul(radial).mul(chargeUniform), float(0)));
  const edge = centered.length().mul(1.55).clamp(0, 1).pow(2.8);
  color = color.add(vec4(vec3(1.1, 0.025, 0.015).mul(edge).mul(detonationUniform), float(0)));
  return color.add(vec4(vec3(0.96, 0.99, 1.05).mul(flashUniform), float(0)));
}
