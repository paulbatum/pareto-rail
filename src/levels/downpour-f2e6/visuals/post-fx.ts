import { uniform, vec4 } from 'three/tsl';
import type { LevelPostComposeInput } from '../../../engine/types';
import { LIGHTNING } from './palette';

// Lightning strikes and boss impacts punch a brief additive flash over the
// composited frame; everything else stays in the shared bloom/vignette pipe.
export const flashUniform = uniform(0);

export function composeDownpourOutput({ base }: LevelPostComposeInput) {
  const tint = vec4(LIGHTNING.r, LIGHTNING.g, LIGHTNING.b, 0).mul(flashUniform);
  return base.add(tint);
}
