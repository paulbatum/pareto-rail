import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects written per frame by the visuals spine:
// - flash: a white pop when a face falls, the shell blows, or the core bursts;
// - shutter: the swing dims the frame edges for a beat, a mechanical blink.
export const flashUniform = uniform(0);
export const shutterUniform = uniform(0);

export function composeSpeedsolveOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(0.5);
  const edge = centered.dot(centered).mul(3.2).clamp(0, 1);
  const shutter = float(1).sub(edge.mul(shutterUniform).mul(0.55));
  const flash = vec3(1.0, 0.99, 0.96).mul(flashUniform);
  return vec4(base.rgb.mul(shutter).add(flash), base.a);
}
