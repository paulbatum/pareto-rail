import { createMusicTime } from '../../engine/music-time';
import type { ScoreSection } from '../../engine/score';

export const VESPERS_C8VR_BPM = 120;
export const VESPERS_C8VR_STEPS_PER_BAR = 16;
export const VESPERS_C8VR_BARS = 30;

export const VESPERS_C8VR_TIME = createMusicTime(VESPERS_C8VR_BPM, {
  stepsPerBar: VESPERS_C8VR_STEPS_PER_BAR,
});

export const VESPERS_C8VR_RUN_DURATION = VESPERS_C8VR_TIME.bar(VESPERS_C8VR_BARS);

export const VESPERS_SECTIONS: ScoreSection<string>[] = [
  { index: 'intro', fromBar: 0 },
  { index: 'wave1', fromBar: 4 },
  { index: 'quietSpan', fromBar: 14 },
  { index: 'boss', fromBar: 19 },
  { index: 'finale', fromBar: 27 },
];
