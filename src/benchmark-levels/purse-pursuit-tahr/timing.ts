import { createMusicTime } from '../../engine/music-time';

export const PURSE_PURSUIT_BPM = 128;
export const PURSE_PURSUIT_STEPS_PER_BAR = 16;
export const PURSE_PURSUIT_TIME = createMusicTime(PURSE_PURSUIT_BPM, { stepsPerBar: PURSE_PURSUIT_STEPS_PER_BAR });
export const PURSE_PURSUIT_DURATION = PURSE_PURSUIT_TIME.bar(32);

export const PURSE_PURSUIT_BARS = {
  launch: 0,
  slipstream: 4,
  crossTraffic: 9,
  overpass: 15,
  boss: 23,
  recovery: 29,
  victory: 30,
  end: 32,
} as const;

export const PURSE_PURSUIT_MARKERS = {
  launch: PURSE_PURSUIT_TIME.bar(PURSE_PURSUIT_BARS.launch),
  slipstream: PURSE_PURSUIT_TIME.bar(PURSE_PURSUIT_BARS.slipstream),
  crossTraffic: PURSE_PURSUIT_TIME.bar(PURSE_PURSUIT_BARS.crossTraffic),
  overpass: PURSE_PURSUIT_TIME.bar(PURSE_PURSUIT_BARS.overpass),
  bossEntrance: PURSE_PURSUIT_TIME.bar(PURSE_PURSUIT_BARS.boss),
  purseFlight: PURSE_PURSUIT_TIME.bar(PURSE_PURSUIT_BARS.recovery),
  victory: PURSE_PURSUIT_TIME.bar(PURSE_PURSUIT_BARS.victory),
} as const;

export type PurseSection = 0 | 1 | 2 | 3 | 4;

export const PURSE_PURSUIT_SCORE_SECTIONS: Array<{ index: PurseSection; fromBar: number }> = [
  { index: 0, fromBar: PURSE_PURSUIT_BARS.launch },
  { index: 1, fromBar: PURSE_PURSUIT_BARS.slipstream },
  { index: 2, fromBar: PURSE_PURSUIT_BARS.crossTraffic },
  { index: 3, fromBar: PURSE_PURSUIT_BARS.boss },
  { index: 4, fromBar: PURSE_PURSUIT_BARS.victory },
];

export const PURSE_PURSUIT_SECTIONS = [
  { name: 'tail lights', fromBar: 0, toBar: 4 },
  { name: 'slipstream', fromBar: 4, toBar: 9 },
  { name: 'cross traffic', fromBar: 9, toBar: 15 },
  { name: 'underpass rush', fromBar: 15, toBar: 23 },
  { name: 'boss barrage', fromBar: 23, toBar: 30 },
  { name: 'purse recovered', fromBar: 30, toBar: 32 },
] as const;
