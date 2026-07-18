import { createMusicTime } from '../../engine/music-time';

export const MASS_DRIVER_DETAILED_M7HQ_BPM = 128;
export const MASS_DRIVER_DETAILED_M7HQ_TIME = createMusicTime(MASS_DRIVER_DETAILED_M7HQ_BPM, { stepsPerBar: 16 });

export const MASS_DRIVER_DETAILED_M7HQ_BARS = {
  injection: 0,
  stage1: 4,
  stage2: 12,
  interlock: 20,
  shot: 28,
  end: 32,
} as const;

export const MASS_DRIVER_DETAILED_M7HQ_MARKERS = MASS_DRIVER_DETAILED_M7HQ_TIME.markers({
  injection: MASS_DRIVER_DETAILED_M7HQ_BARS.injection,
  stage1: MASS_DRIVER_DETAILED_M7HQ_BARS.stage1,
  stage2: MASS_DRIVER_DETAILED_M7HQ_BARS.stage2,
  warning: 19,
  interlock: MASS_DRIVER_DETAILED_M7HQ_BARS.interlock,
  charge60: 23,
  charge85: 26,
  critical: 27,
  shot: MASS_DRIVER_DETAILED_M7HQ_BARS.shot,
  muzzle: 30,
  end: MASS_DRIVER_DETAILED_M7HQ_BARS.end,
});

export const MASS_DRIVER_DETAILED_M7HQ_RUN_DURATION = MASS_DRIVER_DETAILED_M7HQ_MARKERS.end;
export const MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME = MASS_DRIVER_DETAILED_M7HQ_MARKERS.shot;
export const MASS_DRIVER_DETAILED_M7HQ_BEAT_SECONDS = MASS_DRIVER_DETAILED_M7HQ_TIME.beatSeconds;

export type MassDriverDetailedM7hqSection = 'injection' | 'stage-1' | 'stage-2' | 'interlock' | 'muzzle';

export const MASS_DRIVER_DETAILED_M7HQ_SCORE_SECTIONS = [
  { index: 'injection' as const, fromBar: 0 },
  { index: 'stage-1' as const, fromBar: 4, crossfadeBars: 1 },
  { index: 'stage-2' as const, fromBar: 12, crossfadeBars: 1 },
  { index: 'interlock' as const, fromBar: 20, crossfadeBars: 1 },
  { index: 'muzzle' as const, fromBar: 28 },
] as const;

export const MASS_DRIVER_DETAILED_M7HQ_RUN_SECTIONS = [
  { name: 'injection', fromBar: 0 },
  { name: 'stage-1', fromBar: 4 },
  { name: 'stage-2', fromBar: 12 },
  { name: 'interlock', fromBar: 20 },
  { name: 'THE SHOT', fromBar: 28 },
  { name: 'muzzle', fromBar: 28.25 },
] as const;

export const mdBar = MASS_DRIVER_DETAILED_M7HQ_TIME.bar;
