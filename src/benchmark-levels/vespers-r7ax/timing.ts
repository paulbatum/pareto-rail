import { createMusicTime } from '../../engine/music-time';

export const VESPERS_R7AX_BPM = 96;
export const VESPERS_R7AX_STEPS_PER_BAR = 16;
export const VESPERS_R7AX_TIME = createMusicTime(VESPERS_R7AX_BPM, {
  stepsPerBar: VESPERS_R7AX_STEPS_PER_BAR,
});

export const VESPERS_R7AX_BARS = {
  introit: 0,
  procession: 4,
  counterpoint: 8,
  swell: 12,
  tenebrae: 14,
  rose: 18,
  assault: 20,
  illumination: 23,
  end: 24,
} as const;

export const VESPERS_R7AX_MARKERS = VESPERS_R7AX_TIME.markers({
  introit: VESPERS_R7AX_BARS.introit,
  procession: VESPERS_R7AX_BARS.procession,
  counterpoint: VESPERS_R7AX_BARS.counterpoint,
  swell: VESPERS_R7AX_BARS.swell,
  tenebrae: VESPERS_R7AX_BARS.tenebrae,
  rose: VESPERS_R7AX_BARS.rose,
  assault: VESPERS_R7AX_BARS.assault,
  illumination: VESPERS_R7AX_BARS.illumination,
  end: VESPERS_R7AX_BARS.end,
});

export const VESPERS_R7AX_RUN_DURATION = VESPERS_R7AX_MARKERS.end;

export type VespersR7axSectionName =
  | 'introit'
  | 'procession'
  | 'counterpoint'
  | 'swell'
  | 'tenebrae'
  | 'dead-rose'
  | 'illumination';

export const VESPERS_R7AX_SCORE_SECTIONS = [
  { index: 'introit', fromBar: VESPERS_R7AX_BARS.introit },
  { index: 'procession', fromBar: VESPERS_R7AX_BARS.procession, crossfadeBars: 1 },
  { index: 'counterpoint', fromBar: VESPERS_R7AX_BARS.counterpoint, crossfadeBars: 1 },
  { index: 'swell', fromBar: VESPERS_R7AX_BARS.swell, crossfadeBars: 1 },
  { index: 'tenebrae', fromBar: VESPERS_R7AX_BARS.tenebrae },
  { index: 'dead-rose', fromBar: VESPERS_R7AX_BARS.rose },
  { index: 'illumination', fromBar: VESPERS_R7AX_BARS.illumination },
] as const;

export const VESPERS_R7AX_RUN_SECTIONS = [
  { name: 'introit', fromBar: 0, toBar: 4 },
  { name: 'procession', fromBar: 4, toBar: 8 },
  { name: 'counterpoint', fromBar: 8, toBar: 12 },
  { name: 'swell', fromBar: 12, toBar: 14 },
  { name: 'tenebrae', fromBar: 14, toBar: 18 },
  { name: 'dead-rose', fromBar: 18, toBar: 23 },
  { name: 'illumination', fromBar: 23, toBar: 24 },
] as const;
