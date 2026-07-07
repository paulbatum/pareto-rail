import { uniform, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../engine/types';

export const flashUniform = uniform(0);
export const staticUniform = uniform(0);

export function composeDelugeOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const coldFlash = vec4(0.65, 0.92, 1.0, 0).mul(flashUniform);
  const glitch = vec4(0.1, 0.95, 1.2, 0).mul(staticUniform.mul(0.16));
  return base.add(coldFlash).add(glitch);
}
