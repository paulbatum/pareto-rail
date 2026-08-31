import { createMusicTime } from '../../engine/music-time';

export const SKYHOOK_7631_BPM = 96;
export const SKYHOOK_7631_STEPS_PER_BAR = 16;
export const SKYHOOK_7631_TIME = createMusicTime(SKYHOOK_7631_BPM, {
  stepsPerBar: SKYHOOK_7631_STEPS_PER_BAR,
});

export const SKYHOOK_7631_BARS = {
  storm: 0,
  squall: 3,
  cloudbreak: 6,
  blue: 7,
  thinAir: 12,
  orbitalNight: 15,
  boss: 17,
  docking: 22,
  docked: 24,
} as const;

export const SKYHOOK_7631_MARKERS = SKYHOOK_7631_TIME.markers(SKYHOOK_7631_BARS);
export const SKYHOOK_7631_RUN_DURATION = SKYHOOK_7631_MARKERS.docked;
export const SKYHOOK_7631_CLOUDBREAK_TIME = SKYHOOK_7631_MARKERS.cloudbreak;
export const SKYHOOK_7631_BOSS_TIME = SKYHOOK_7631_MARKERS.boss;
export const SKYHOOK_7631_DOCKING_TIME = SKYHOOK_7631_MARKERS.docking;
export const SKYHOOK_7631_BOSS_DEADLINE = SKYHOOK_7631_DOCKING_TIME - SKYHOOK_7631_TIME.beats(0.75);

export const SKYHOOK_7631_SCORE_SECTIONS = [
  { index: 0, fromBar: SKYHOOK_7631_BARS.storm },
  { index: 1, fromBar: SKYHOOK_7631_BARS.cloudbreak, crossfadeBars: 1 },
  { index: 2, fromBar: SKYHOOK_7631_BARS.thinAir, crossfadeBars: 2 },
  { index: 3, fromBar: SKYHOOK_7631_BARS.boss },
  { index: 4, fromBar: SKYHOOK_7631_BARS.docking },
] as const;

export const SKYHOOK_7631_RUN_SECTIONS = [
  { name: 'weather', fromBar: SKYHOOK_7631_BARS.storm, toBar: SKYHOOK_7631_BARS.squall },
  { name: 'squall', fromBar: SKYHOOK_7631_BARS.squall, toBar: SKYHOOK_7631_BARS.cloudbreak },
  { name: 'cloudbreak', fromBar: SKYHOOK_7631_BARS.cloudbreak, toBar: SKYHOOK_7631_BARS.blue },
  { name: 'blue', fromBar: SKYHOOK_7631_BARS.blue, toBar: SKYHOOK_7631_BARS.thinAir },
  { name: 'thin-air', fromBar: SKYHOOK_7631_BARS.thinAir, toBar: SKYHOOK_7631_BARS.orbitalNight },
  { name: 'orbital-night', fromBar: SKYHOOK_7631_BARS.orbitalNight, toBar: SKYHOOK_7631_BARS.boss },
  { name: 'cable-reaver', fromBar: SKYHOOK_7631_BARS.boss, toBar: SKYHOOK_7631_BARS.docking },
  { name: 'docking', fromBar: SKYHOOK_7631_BARS.docking, toBar: SKYHOOK_7631_BARS.docked },
] as const;

export const skyhook7631Bar = SKYHOOK_7631_TIME.bar;
