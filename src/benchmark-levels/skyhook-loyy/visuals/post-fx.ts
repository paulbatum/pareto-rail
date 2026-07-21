import { uniform, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

export const stormFlashUniform = uniform(0);
export const damageFlashUniform = uniform(0);
export const captureFlashUniform = uniform(0);

export function kickStormFlash(value: number) {
  stormFlashUniform.value = Math.max(stormFlashUniform.value, value);
}

export function kickDamageFlash(value: number) {
  damageFlashUniform.value = Math.max(damageFlashUniform.value, value);
}

export function kickCaptureFlash(value: number) {
  captureFlashUniform.value = Math.max(captureFlashUniform.value, value);
}

export function resetSkyhookPost() {
  stormFlashUniform.value = 0;
  damageFlashUniform.value = 0;
  captureFlashUniform.value = 0;
}

export function updateSkyhookPost(dt: number) {
  stormFlashUniform.value = Math.max(0, stormFlashUniform.value - dt * 4.8);
  damageFlashUniform.value = Math.max(0, damageFlashUniform.value - dt * 2.7);
  captureFlashUniform.value = Math.max(0, captureFlashUniform.value - dt * 1.25);
}

export function composeSkyhookOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const storm = vec4(0.58, 0.68, 0.74, 0).mul(stormFlashUniform.mul(0.24));
  const damage = vec4(0.72, 0.2, 0.035, 0).mul(damageFlashUniform.mul(0.2));
  const capture = vec4(0.82, 0.88, 0.9, 0).mul(captureFlashUniform.mul(0.18));
  return base.add(storm).add(damage).add(capture);
}
