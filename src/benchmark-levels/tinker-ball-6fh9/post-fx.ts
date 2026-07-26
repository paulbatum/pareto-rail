import { mix, uniform, vec4 } from 'three/tsl';
import type { LevelPostConfig } from '../../engine/types';

// Two screen feelings, both driven from the visuals layer: a warm lamp-light
// flash for payoffs (core cracks, the heart, full volleys) and a brief glue
// smear that darkens the frame toward violet when the hull takes a hit or a
// release is rejected.

export const warmFlashUniform = uniform(0);
export const gooFlashUniform = uniform(0);

export const tinkerPost: LevelPostConfig = {
  clearColor: 0x0e0a07,
  bloom: { strength: 0.55, threshold: 0.78, radius: 0.14 },
  vignette: { inner: 0.32, outer: 1.02, strength: 0.55 },
  composeOutput({ base }) {
    const flashed = base.add(vec4(1.0, 0.72, 0.35, 0).mul(warmFlashUniform));
    return mix(flashed, vec4(0.13, 0.065, 0.17, 1), gooFlashUniform.mul(0.55));
  },
};
