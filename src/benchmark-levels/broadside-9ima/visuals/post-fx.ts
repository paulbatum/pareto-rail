import { uniform, vec4 } from 'three/tsl';
import type { LevelPostConfig } from '../../../engine/types';

export const cyanFlashUniform = uniform(0);
export const orangeFlashUniform = uniform(0);

export const post: LevelPostConfig = {
  clearColor: 0x030208,
  bloom: {
    strength: 0.45,
    threshold: 0.8,
    radius: 0.15,
  },
  vignette: {
    inner: 0.35,
    outer: 1.0,
    strength: 0.45,
  },
  composeOutput({ base }) {
    // Screen flashes during broadside salvos (cyan) and boss detonations (orange)
    return base
      .add(vec4(0.1, 0.5, 1.0, 0).mul(cyanFlashUniform))
      .add(vec4(1.0, 0.4, 0.1, 0).mul(orangeFlashUniform));
  },
};
