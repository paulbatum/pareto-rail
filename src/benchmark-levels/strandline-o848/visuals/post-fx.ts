import { uniform, vec4 } from 'three/tsl';
import type { LevelPostConfig } from '../../../engine/types';

// Screen-space responses written by the runtime:
// - flashUniform: set-piece whiteouts (bell reveal, panel tears, the kill).
// - hurtUniform: violet wash when parasites land a hit.
export const flashUniform = uniform(0);
export const hurtUniform = uniform(0);

export const strandlinePost: LevelPostConfig = {
  composeOutput({ base }) {
    return base
      .add(vec4(0.82, 1.0, 0.9, 0).mul(flashUniform))
      .add(vec4(0.5, 0.16, 0.62, 0).mul(hurtUniform));
  },
};
