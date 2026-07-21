import { float, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const radius = centered.length();
  const centerBloom = float(1).sub(smoothstep(float(0.03), float(0.72), radius)).pow(1.55);
  const edgeBleed = smoothstep(float(0.22), float(0.78), radius).pow(2.2);
  let color = base.add(vec4(vec3(0.44, 0.12, 0.82).mul(centerBloom).mul(chargeUniform.mul(0.34)), float(0)));
  color = color.add(vec4(vec3(0.95, 0.03, 0.06).mul(edgeBleed).mul(detonationUniform), float(0)));
  color = color.add(vec4(vec3(1, 0.2, 0.28).mul(detonationUniform.mul(0.48)), float(0)));
  return color.add(vec4(vec3(0.94, 0.98, 1).mul(flashUniform), float(0)));
}
