import { createMusicTime } from '../../engine/music-time';

export const SKYHOOK_LOYY_BPM = 96;
export const SKYHOOK_LOYY_STEPS_PER_BAR = 16;
export const SKYHOOK_LOYY_TIME = createMusicTime(SKYHOOK_LOYY_BPM, {
  stepsPerBar: SKYHOOK_LOYY_STEPS_PER_BAR,
});

// 24 bars at 96 BPM: exactly sixty seconds of active play.
export const SKYHOOK_LOYY_RUN_DURATION = SKYHOOK_LOYY_TIME.bar(24);

export const SKYHOOK_LOYY_BARS = {
  storm: 0,
  cloudbreak: 4,
  stratosphere: 10,
  vacuum: 14,
  boss: 16,
  dock: 22,
  end: 24,
} as const;

export const SKYHOOK_LOYY_MARKERS = {
  cloudbreak: SKYHOOK_LOYY_TIME.bar(SKYHOOK_LOYY_BARS.cloudbreak),
  stratosphere: SKYHOOK_LOYY_TIME.bar(SKYHOOK_LOYY_BARS.stratosphere),
  vacuum: SKYHOOK_LOYY_TIME.bar(SKYHOOK_LOYY_BARS.vacuum),
  boss: SKYHOOK_LOYY_TIME.bar(SKYHOOK_LOYY_BARS.boss),
  dock: SKYHOOK_LOYY_TIME.bar(SKYHOOK_LOYY_BARS.dock),
  end: SKYHOOK_LOYY_RUN_DURATION,
} as const;

export type SkyhookSectionName = 'storm' | 'sunbreak' | 'thin-air' | 'vacuum' | 'crawler' | 'docking';

export const SKYHOOK_LOYY_SECTIONS: ReadonlyArray<{ name: SkyhookSectionName; fromBar: number; toBar: number }> = [
  { name: 'storm', fromBar: 0, toBar: 4 },
  { name: 'sunbreak', fromBar: 4, toBar: 10 },
  { name: 'thin-air', fromBar: 10, toBar: 14 },
  { name: 'vacuum', fromBar: 14, toBar: 16 },
  { name: 'crawler', fromBar: 16, toBar: 22 },
  { name: 'docking', fromBar: 22, toBar: 24 },
];

export const skyhookBar = (bar: number, beat = 0) => SKYHOOK_LOYY_TIME.bar(bar, beat);
