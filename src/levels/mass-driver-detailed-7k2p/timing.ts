import { createMusicTime } from '../../engine/music-time';

export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });

export const MASS_DRIVER_BARS = {
  injection: 0,
  stage1: 4,
  stage2: 12,
  interlock: 20,
  warning: 19,
  shot: 28,
  muzzle: 28,
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers({
  injection: MASS_DRIVER_BARS.injection,
  stage1: MASS_DRIVER_BARS.stage1,
  stage2: MASS_DRIVER_BARS.stage2,
  warning: MASS_DRIVER_BARS.warning,
  interlock: MASS_DRIVER_BARS.interlock,
  shot: MASS_DRIVER_BARS.shot,
  muzzle: MASS_DRIVER_BARS.muzzle,
  end: MASS_DRIVER_BARS.end,
});

export const MASS_DRIVER_DURATION = MASS_DRIVER_MARKERS.end;
export const MASS_DRIVER_BEAT_SECONDS = 60 / MASS_DRIVER_BPM;
export const MASS_DRIVER_BAR_SECONDS = MASS_DRIVER_TIME.bar(1);

export const MASS_DRIVER_SECTIONS = [
  { name: 'INJECTION', fromBar: MASS_DRIVER_BARS.injection },
  { name: 'STAGE 1', fromBar: MASS_DRIVER_BARS.stage1 },
  { name: 'STAGE 2', fromBar: MASS_DRIVER_BARS.stage2 },
  { name: 'INTERLOCK', fromBar: MASS_DRIVER_BARS.interlock },
  { name: 'THE SHOT', fromBar: MASS_DRIVER_BARS.shot },
  { name: 'MUZZLE', fromBar: MASS_DRIVER_BARS.muzzle },
] as const;

export type MassDriverSection = 'injection' | 'stage1' | 'stage2' | 'interlock' | 'muzzle';

export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 'injection' as const, fromBar: 0 },
  { index: 'stage1' as const, fromBar: 4, crossfadeBars: 2 },
  { index: 'stage2' as const, fromBar: 12, crossfadeBars: 2 },
  { index: 'interlock' as const, fromBar: 20 },
  { index: 'muzzle' as const, fromBar: 28 },
];
