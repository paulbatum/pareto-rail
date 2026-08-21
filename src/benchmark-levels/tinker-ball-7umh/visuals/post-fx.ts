import { uniform, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

export const warmFlashUniform = uniform(0);
export const cleanGlowUniform = uniform(0);

export function kickWarmFlash(amount = 0.4) {
  warmFlashUniform.value = Math.max(warmFlashUniform.value, amount);
}

export function decayPostFx(dt: number) {
  if (warmFlashUniform.value > 0.001) {
    warmFlashUniform.value = Math.max(0, warmFlashUniform.value - dt * 3.5);
  }
  if (cleanGlowUniform.value > 0.001) {
    cleanGlowUniform.value = Math.max(0, cleanGlowUniform.value - dt * 2.0);
  }
}

export function composeTinkerOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Warm golden flash on hits/kills
  const flashColor = vec4(1.0, 0.75, 0.35, 0.0).mul(warmFlashUniform);
  // Spotless clean ambient boost at finale
  const cleanColor = vec4(0.2, 0.4, 0.6, 0.0).mul(cleanGlowUniform);
  return base.add(flashColor).add(cleanColor);
}
