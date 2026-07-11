import { createMusicTime } from '../../engine/music-time';

export const HULL_RUN_CVS3_BPM = 144;
export const HULL_RUN_CVS3_STEPS_PER_BAR = 16;
export const HULL_RUN_CVS3_TIME = createMusicTime(HULL_RUN_CVS3_BPM, { stepsPerBar: HULL_RUN_CVS3_STEPS_PER_BAR });
export const HULL_RUN_CVS3_RUN_DURATION = HULL_RUN_CVS3_TIME.bar(36); // exactly 60 seconds

export const HULL_RUN_CVS3_BARS = {
  arrival: 0,
  wake: 4,
  batteries: 12,
  redline: 20,
  boss: 26,
  wreck: 34,
  bow: 35,
  end: 36,
} as const;

export const HULL_RUN_CVS3_MARKERS = HULL_RUN_CVS3_TIME.markers({
  arrival: 0,
  firstWake: 4,
  batteriesOnline: 12,
  fullAlert: 20,
  turretRise: 26,
  turretWreck: 34,
  offTheBow: 35,
});

export const HULL_RUN_CVS3_SECTIONS = [
  { name: 'dark-deck', fromBar: 0, toBar: 4 },
  { name: 'wake-chain', fromBar: 4, toBar: 12 },
  { name: 'batteries-online', fromBar: 12, toBar: 20 },
  { name: 'general-quarters', fromBar: 20, toBar: 26 },
  { name: 'bow-turret', fromBar: 26, toBar: 34 },
  { name: 'off-the-bow', fromBar: 34, toBar: 36 },
] as const;

export type HullRunSection = 0 | 1 | 2 | 3;
export const HULL_RUN_CVS3_SCORE_SECTIONS = [
  { index: 0 as const, fromBar: 0 },
  { index: 1 as const, fromBar: 4 },
  { index: 2 as const, fromBar: 12 },
  { index: 3 as const, fromBar: 20 },
] as const;
