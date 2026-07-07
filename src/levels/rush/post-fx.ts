import { uniform, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../engine/types';
import { RUSH_TUNING } from './tuning';

export const rushSurgeFlashUniform = uniform(0);

export function kickRushSurgeFlash(value = RUSH_TUNING.post.surgeFlash) {
  rushSurgeFlashUniform.value = Math.max(rushSurgeFlashUniform.value, Math.max(0, value));
}

export function decayRushPost(dt: number) {
  rushSurgeFlashUniform.value = Math.max(0, rushSurgeFlashUniform.value - dt * RUSH_TUNING.post.surgeDecay);
}

export function composeRushOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const flash = vec4(0.95, 0.38, 0.08, 0).mul(rushSurgeFlashUniform.mul(0.22));
  return base.add(flash);
}
