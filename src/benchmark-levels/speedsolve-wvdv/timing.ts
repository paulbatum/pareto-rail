import { createMusicTime } from '../../engine/music-time';

export const SPEEDSOLVE_WVDV_BPM = 128;
export const SPEEDSOLVE_WVDV_STEPS_PER_BAR = 16;
export const SPEEDSOLVE_WVDV_TIME = createMusicTime(SPEEDSOLVE_WVDV_BPM, {
  stepsPerBar: SPEEDSOLVE_WVDV_STEPS_PER_BAR,
});

// 32 bars at 128 BPM is exactly sixty seconds.
export const SPEEDSOLVE_WVDV_BARS = {
  white: 0,
  red: 4,
  blue: 8,
  orange: 12,
  green: 16,
  yellow: 20,
  shellOpen: 24,
  core: 28,
  resolve: 30,
  end: 32,
} as const;

export const SPEEDSOLVE_WVDV_MARKERS = SPEEDSOLVE_WVDV_TIME.markers(SPEEDSOLVE_WVDV_BARS);
export const SPEEDSOLVE_WVDV_RUN_DURATION = SPEEDSOLVE_WVDV_MARKERS.end;
export const speedsolveBar = SPEEDSOLVE_WVDV_TIME.bar;

export const SPEEDSOLVE_WVDV_SECTIONS = [
  { name: 'white-face', fromBar: 0, toBar: 4 },
  { name: 'red-face', fromBar: 4, toBar: 8 },
  { name: 'blue-face', fromBar: 8, toBar: 12 },
  { name: 'orange-face', fromBar: 12, toBar: 16 },
  { name: 'green-face', fromBar: 16, toBar: 20 },
  { name: 'yellow-face', fromBar: 20, toBar: 24 },
  { name: 'mechanism', fromBar: 24, toBar: 28 },
  { name: 'naked-core', fromBar: 28, toBar: 30 },
  { name: 'resolution', fromBar: 30, toBar: 32 },
] as const;

export const SPEEDSOLVE_WVDV_SCORE_SECTIONS = [
  { index: 'white', fromBar: 0 },
  { index: 'red', fromBar: 4, crossfadeBars: 0.5 },
  { index: 'blue', fromBar: 8, crossfadeBars: 0.5 },
  { index: 'orange', fromBar: 12, crossfadeBars: 0.5 },
  { index: 'green', fromBar: 16, crossfadeBars: 0.5 },
  { index: 'yellow', fromBar: 20, crossfadeBars: 0.5 },
  { index: 'core', fromBar: 24 },
  { index: 'resolve', fromBar: 30 },
] as const;

export type SpeedsolveSection = (typeof SPEEDSOLVE_WVDV_SCORE_SECTIONS)[number]['index'];
