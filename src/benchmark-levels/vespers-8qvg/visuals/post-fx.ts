import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// VESPERS screen effects:
// - flashWarmth: the gold-white overload when the rose window ignites;
// - flashRed: the damage sting on a hull hit.
// Global motion blur and bloom stay engine-owned.
export const flashWarmth = uniform(0);
export const flashRed = uniform(0);

export function composeVespersOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const gold = vec3(1.0, 0.82, 0.55).mul(flashWarmth);
  const red = vec3(0.92, 0.06, 0.05).mul(flashRed);
  return base.add(vec4(gold.add(red), float(0)));
}
