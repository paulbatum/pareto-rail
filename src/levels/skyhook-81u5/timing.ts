import { createMusicTime } from '../../engine/music-time';

export const SKYHOOK_BPM = 96;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });

// 24 bars at 96 BPM = exactly 60 seconds.
export const SKYHOOK_BARS = {
  storm: 0,
  cloudbreak: 6,
  blue: 8,
  thinAir: 11,
  orbital: 14,
  boss: 15,
  bossClose: 19,
  clear: 22,
  docked: 23,
  end: 24,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers(SKYHOOK_BARS);
export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;

export const SKYHOOK_SCORE_SECTIONS = [
  { index: 'storm', fromBar: SKYHOOK_BARS.storm },
  { index: 'sun', fromBar: SKYHOOK_BARS.cloudbreak, crossfadeBars: 1 },
  { index: 'thin', fromBar: SKYHOOK_BARS.thinAir, crossfadeBars: 1 },
  { index: 'boss', fromBar: SKYHOOK_BARS.boss },
  { index: 'dock', fromBar: SKYHOOK_BARS.clear },
] as const;

export type SkyhookSection = (typeof SKYHOOK_SCORE_SECTIONS)[number]['index'];

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'weather', fromBar: 0, toBar: 6 },
  { name: 'cloudbreak', fromBar: 6, toBar: 11 },
  { name: 'thin-air', fromBar: 11, toBar: 15 },
  { name: 'tether-crawler', fromBar: 15, toBar: 22 },
  { name: 'docking', fromBar: 22, toBar: 24 },
] as const;

export const bar = SKYHOOK_TIME.bar;
