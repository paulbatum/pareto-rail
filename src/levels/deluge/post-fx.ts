import { mix, uniform, vec2, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../engine/types';

export const speedBlurUniform = uniform(0);
export const flashUniform = uniform(0);
export const staticUniform = uniform(0);

export function composeDelugeOutput({ base, scenePass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();
  const centerPull = vec2(0.5).sub(screenUV).mul(speedBlurUniform);
  const tap1 = sceneTexture.sample(screenUV.add(centerPull.mul(0.18)));
  const tap2 = sceneTexture.sample(screenUV.add(centerPull.mul(0.38)));
  const tap3 = sceneTexture.sample(screenUV.add(centerPull.mul(0.62)));
  const blurred = base.add(tap1).add(tap2).add(tap3).mul(0.25);
  const coldFlash = vec4(0.65, 0.92, 1.0, 0).mul(flashUniform);
  const glitch = vec4(0.1, 0.95, 1.2, 0).mul(staticUniform.mul(0.16));
  return mix(base, blurred, speedBlurUniform).add(coldFlash).add(glitch);
}
