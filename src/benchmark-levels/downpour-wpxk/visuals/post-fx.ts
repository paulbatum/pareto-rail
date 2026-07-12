import { uniform, vec4 } from 'three/tsl';
import type { LevelPostComposeInput, LevelPostColorNode } from '../../../engine/types';

// Lightning owns the frame for an instant: a cold blue-white flash written by
// the visual spine from the same authored bar table the thunder plays from.
export const flashUniform = uniform(0);

export function composeDownpourOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  return base.add(vec4(0.72, 0.82, 1.0, 0).mul(flashUniform));
}
