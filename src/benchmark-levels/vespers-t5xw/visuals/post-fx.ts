import { float, uniform, vec4 } from 'three/tsl';
import type { LevelPostComposeInput, LevelPostColorNode } from '../../../engine/types';

// Two screen-space moments, both driven from the visual event handlers:
// goldFlash — light returning (window ignitions, and the rose at the finale);
// darkPulse — the gloom biting (hull hits and rejected releases).
export const goldFlash = uniform(0);
export const darkPulse = uniform(0);

export function composeVespersOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const warmed = base.add(vec4(1.0, 0.8, 0.45, 0).mul(goldFlash));
  return warmed.mul(float(1).sub(darkPulse.mul(0.55)));
}
