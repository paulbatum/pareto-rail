import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Two screen-wide values, both written from the runtime:
// - `ignition` is the rose going up, and is the only time this level is
//   allowed to be bright everywhere at once;
// - `warmth` tracks how much of the cathedral the player has won back, and
//   lifts the frame a little as the glass fills in.

export const ignitionUniform = uniform(0);
export const warmthUniform = uniform(0);

export function composeVespersOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const glory = vec3(1.0, 0.86, 0.55).mul(ignitionUniform);
  const glow = vec3(0.9, 0.78, 0.55).mul(warmthUniform.mul(0.028));
  return base.add(vec4(glory.add(glow), float(0)));
}
