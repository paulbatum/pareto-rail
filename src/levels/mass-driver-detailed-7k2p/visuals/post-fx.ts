import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(0.5);
  const radius = centered.dot(centered).mul(3.2).clamp(0, 1);
  // Charge pools near the center but also catches the frame edge, leaving the
  // rim-held interlocks readable through the middle of the build.
  const centerPool = float(1).sub(radius).pow(3).mul(chargeUniform).mul(0.18);
  const edgePool = radius.pow(2).mul(chargeUniform).mul(0.22);
  const charge = vec3(0.48, 0.25, 1.0).mul(centerPool.add(edgePool));
  const flash = vec3(0.9, 0.96, 1.0).mul(flashUniform);
  const detonation = vec3(1.0, 0.035, 0.07).mul(detonationUniform.mul(0.72))
    .add(vec3(1.0).mul(detonationUniform.pow(2).mul(0.42)));
  return base.add(vec4(charge.add(flash).add(detonation), float(0)));
}
