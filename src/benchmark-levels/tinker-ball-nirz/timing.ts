import { createMusicTime } from '../../engine/music-time';

// One authoritative tempo for the level. Gameplay, the arrangement, and the
// runner all read the run's shape from this file.

export const TINKER_BPM = 132;
export const TINKER_STEPS_PER_BAR = 16;
export const TINKER_TIME = createMusicTime(TINKER_BPM, { stepsPerBar: TINKER_STEPS_PER_BAR });

/**
 * A 33-bar run at 132 BPM lands on exactly 60 seconds, with the last bar left
 * clear so the ball can coast across clean table before the summary.
 */
export const TINKER_BARS = {
  run: 0,
  groove: 2,
  pop: 6,
  lift: 10,
  drive: 14,
  warn: 20,
  spill: 22,
  finale: 30,
  coast: 32,
  end: 33,
} as const;

export const TINKER_MARKERS = TINKER_TIME.markers({
  marble: TINKER_BARS.run,
  groove: TINKER_BARS.groove,
  pop: TINKER_BARS.pop,
  tennis: TINKER_BARS.lift,
  drive: TINKER_BARS.drive,
  warn: TINKER_BARS.warn,
  spill: TINKER_BARS.spill,
  finale: TINKER_BARS.finale,
  coast: TINKER_BARS.coast,
});

export const TINKER_RUN_DURATION = TINKER_TIME.bar(TINKER_BARS.end);

/** Player-instrument voicing: marble, tennis ball, melon. */
export const TINKER_SCORE_SECTIONS = [
  { index: 0, fromBar: TINKER_BARS.run },
  { index: 1, fromBar: TINKER_BARS.lift, crossfadeBars: 2 },
  { index: 2, fromBar: TINKER_BARS.spill, crossfadeBars: 1 },
] as const;

export const TINKER_RUN_SECTIONS = [
  { name: 'wind-up', fromBar: TINKER_BARS.run, toBar: TINKER_BARS.groove },
  { name: 'groove', fromBar: TINKER_BARS.groove, toBar: TINKER_BARS.pop },
  { name: 'pop', fromBar: TINKER_BARS.pop, toBar: TINKER_BARS.lift },
  { name: 'lift', fromBar: TINKER_BARS.lift, toBar: TINKER_BARS.drive },
  { name: 'drive', fromBar: TINKER_BARS.drive, toBar: TINKER_BARS.warn },
  { name: 'warn', fromBar: TINKER_BARS.warn, toBar: TINKER_BARS.spill },
  { name: 'spill', fromBar: TINKER_BARS.spill, toBar: TINKER_BARS.finale },
  { name: 'finale', fromBar: TINKER_BARS.finale, toBar: TINKER_BARS.coast },
  { name: 'coast', fromBar: TINKER_BARS.coast },
] as const;
