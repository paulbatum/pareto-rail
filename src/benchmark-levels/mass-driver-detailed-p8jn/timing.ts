import { createMusicTime } from '../../engine/music-time';

export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });

export const MASS_DRIVER_BARS = {
  injection: 0,
  stage1: 4,
  stage2: 12,
  warning: 19,
  interlock: 20,
  shot: 28,
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers(MASS_DRIVER_BARS);
export const MASS_DRIVER_DURATION = MASS_DRIVER_MARKERS.end;
export const MASS_DRIVER_SHOT_TIME = MASS_DRIVER_MARKERS.shot;

export const MASS_DRIVER_SECTIONS = [
  { name: 'injection', fromBar: MASS_DRIVER_BARS.injection, toBar: MASS_DRIVER_BARS.stage1 },
  { name: 'stage-1', fromBar: MASS_DRIVER_BARS.stage1, toBar: MASS_DRIVER_BARS.stage2 },
  { name: 'stage-2', fromBar: MASS_DRIVER_BARS.stage2, toBar: MASS_DRIVER_BARS.interlock },
  { name: 'interlock', fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.shot },
  { name: 'muzzle', fromBar: MASS_DRIVER_BARS.shot, toBar: MASS_DRIVER_BARS.end },
] as const;

export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_BARS.injection },
  { index: 1, fromBar: MASS_DRIVER_BARS.stage1, crossfadeBars: 2 },
  { index: 2, fromBar: MASS_DRIVER_BARS.stage2, crossfadeBars: 2 },
  { index: 3, fromBar: MASS_DRIVER_BARS.interlock, crossfadeBars: 1 },
  { index: 4, fromBar: MASS_DRIVER_BARS.shot },
] as const;

export const bar = MASS_DRIVER_TIME.bar;
