import { mix, uniform, vec2, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../engine/types';
import { RUSH_TUNING } from './tuning';

export const rushRadialBlurUniform = uniform(0);
export const rushSurgeFlashUniform = uniform(0);

export function setRushRadialBlur(value: number) {
  rushRadialBlurUniform.value = Math.max(0, Math.min(RUSH_TUNING.post.radialBlurMax, value));
}

export function kickRushRadialBlur(value = RUSH_TUNING.post.surgeBlurPulse) {
  rushSurgeFlashUniform.value = Math.max(rushSurgeFlashUniform.value, Math.max(0, value));
}

export function decayRushPost(dt: number) {
  rushSurgeFlashUniform.value = Math.max(0, rushSurgeFlashUniform.value - dt * RUSH_TUNING.post.surgeBlurDecay);
}

export function composeRushOutput({ base, scenePass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();
  const blurAmount = rushRadialBlurUniform.add(rushSurgeFlashUniform.mul(0.35));
  const centerPull = vec2(0.5).sub(screenUV).mul(blurAmount);
  const tap1 = sceneTexture.sample(screenUV.add(centerPull.mul(0.16)));
  const tap2 = sceneTexture.sample(screenUV.add(centerPull.mul(0.36)));
  const tap3 = sceneTexture.sample(screenUV.add(centerPull.mul(0.62)));
  const tap4 = sceneTexture.sample(screenUV.add(centerPull.mul(0.84)));
  const blurred = base.add(tap1).add(tap2).add(tap3).add(tap4).mul(0.2);
  const flash = vec4(0.95, 0.38, 0.08, 0).mul(rushSurgeFlashUniform.mul(0.22));
  return mix(base, blurred, blurAmount).add(flash);
}
