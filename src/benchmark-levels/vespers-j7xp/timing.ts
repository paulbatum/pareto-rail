import { createMusicTime } from '../../engine/music-time';

export const VESPERS_BPM = 96;
export const VESPERS_STEPS_PER_BAR = 16;
export const VESPERS_TIME = createMusicTime(VESPERS_BPM, { stepsPerBar: VESPERS_STEPS_PER_BAR });

export const VESPERS_BARS = {
  run: 0,
  introitus: 0,
  voice1: 2,
  voice2: 4,
  swell: 8,
  arcadeClimax: 12,
  quietNave: 14,
  bossEntrance: 18,
  bossCoreExposed: 21,
  finale: 24,
} as const;

export const VESPERS_MARKERS = VESPERS_TIME.markers({
  run: VESPERS_BARS.run,
  introitus: VESPERS_BARS.introitus,
  voice1: VESPERS_BARS.voice1,
  voice2: VESPERS_BARS.voice2,
  swell: VESPERS_BARS.swell,
  arcadeClimax: VESPERS_BARS.arcadeClimax,
  quietNave: VESPERS_BARS.quietNave,
  bossEntrance: VESPERS_BARS.bossEntrance,
  bossCoreExposed: VESPERS_BARS.bossCoreExposed,
  finale: VESPERS_BARS.finale,
});

// Run duration: 24.5 bars @ 96 BPM = 61.25 seconds.
// This allows the triumphant D Major finale chord and Rose Window illumination to bloom.
export const VESPERS_RUN_DURATION = VESPERS_TIME.bar(24, 2);

export type VespersSectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

export const VESPERS_SCORE_SECTIONS = [
  { index: 0 as VespersSectionIndex, fromBar: VESPERS_BARS.introitus },
  { index: 1 as VespersSectionIndex, fromBar: VESPERS_BARS.voice2, crossfadeBars: 1 },
  { index: 2 as VespersSectionIndex, fromBar: VESPERS_BARS.swell, crossfadeBars: 1 },
  { index: 3 as VespersSectionIndex, fromBar: VESPERS_BARS.quietNave, crossfadeBars: 0.5 },
  { index: 4 as VespersSectionIndex, fromBar: VESPERS_BARS.bossEntrance, crossfadeBars: 0.5 },
  { index: 5 as VespersSectionIndex, fromBar: VESPERS_BARS.finale, crossfadeBars: 0.25 },
] as const;

export const VESPERS_RUN_SECTIONS = [
  { name: 'introitus', fromBar: VESPERS_BARS.introitus, toBar: VESPERS_BARS.voice2 },
  { name: 'polyphony', fromBar: VESPERS_BARS.voice2, toBar: VESPERS_BARS.swell },
  { name: 'swell', fromBar: VESPERS_BARS.swell, toBar: VESPERS_BARS.quietNave },
  { name: 'quiet-nave', fromBar: VESPERS_BARS.quietNave, toBar: VESPERS_BARS.bossEntrance },
  { name: 'rose-boss', fromBar: VESPERS_BARS.bossEntrance, toBar: VESPERS_BARS.finale },
  { name: 'lit-cathedral', fromBar: VESPERS_BARS.finale },
] as const;
