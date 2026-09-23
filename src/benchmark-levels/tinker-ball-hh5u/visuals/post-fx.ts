import { float, mix, mx_noise_float, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects, driven per frame by the runtime:
// - lensGlue: a glue glob splatted on the lens creeps in from the edges and
//   slowly wipes away;
// - warmFlash: a lamp-warm lift on size-ups and the spill finale.
export const lensGlue = uniform(0);
export const warmFlash = uniform(0);

export function composeTinkerOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(0.5).mul(vec2(1.7, 1));
  const blob = mx_noise_float(vec3(screenUV.x.mul(6), screenUV.y.mul(3.5), time.mul(0.15))).mul(0.22);
  const drip = mx_noise_float(vec2(screenUV.x.mul(18), 0.5)).mul(0.12).mul(screenUV.y.oneMinus());
  const reach = centered.length().add(blob).add(drip);
  const coat = smoothstep(float(0.78), float(0.5), float(1).sub(reach).add(lensGlue.mul(0.55)).oneMinus()).mul(lensGlue);
  const sheen = smoothstep(float(0.1), float(0.0), reach.sub(0.62).abs()).mul(0.25);
  const glue = vec3(0.025, 0.018, 0.035).add(vec3(0.35, 0.28, 0.6).mul(sheen));
  const glued = mix(base.xyz, glue, coat.clamp(0, 0.94));
  const warm = vec3(1.0, 0.72, 0.4).mul(warmFlash.mul(0.35));
  return vec4(glued.add(warm), base.w);
}
