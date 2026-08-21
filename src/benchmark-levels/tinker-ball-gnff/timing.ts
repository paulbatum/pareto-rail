import { createMusicTime } from '../../engine/music-time';

// Tinker Ball runs a bright 112 BPM pop score. One bar is 2.142857… s, and
// the whole run is exactly 28 bars: 60 seconds from START to run summary.
export const TINKER_BPM = 112;
export const TINKER_STEPS_PER_BAR = 16;
export const TINKER_TIME = createMusicTime(TINKER_BPM, {
  beatsPerBar: 4,
  stepsPerBar: TINKER_STEPS_PER_BAR,
});

// The worktable crossing has three scale acts plus the Spill finale:
//   Act 1  (bars 0–8)   marble-sized: buttons, pins, beads, paperclips
//   Act 2  (bars 8–16)  tennis-ball: spools, erasers, paint pots, blocks
//   Act 3  (bars 16–21) melon-sized: rulers, jars, cardboard structures
//   Boss   (bars 21–28) the Spill swallows the table's end
export const TINKER_BARS = {
  run: 0,
  act2: 8,
  act3: 16,
  preSpill: 20,
  spill: 21,
  finale: 27,
} as const;

export const TINKER_MARKERS = TINKER_TIME.markers({
  run: TINKER_BARS.run,
  act2: TINKER_BARS.act2,
  act3: TINKER_BARS.act3,
  preSpill: TINKER_BARS.preSpill,
  spillEntrance: [TINKER_BARS.spill, 2],
  finale: TINKER_BARS.finale,
});

export const TINKER_RUN_DURATION = TINKER_TIME.bar(28);

export const TINKER_SCORE_SECTIONS = [
  { index: 0, fromBar: TINKER_BARS.run },
  { index: 1, fromBar: TINKER_BARS.act2, crossfadeBars: 2 },
  { index: 2, fromBar: TINKER_BARS.spill },
] as const;

export const TINKER_RUN_SECTIONS = [
  { name: 'intro', fromBar: TINKER_BARS.run, toBar: 1 },
  { name: 'marble', fromBar: 1, toBar: TINKER_BARS.act2 },
  { name: 'tennis', fromBar: TINKER_BARS.act2, toBar: TINKER_BARS.act3 },
  { name: 'melon', fromBar: TINKER_BARS.act3, toBar: TINKER_BARS.preSpill },
  { name: 'pre-spill', fromBar: TINKER_BARS.preSpill, toBar: TINKER_BARS.spill },
  { name: 'spill', fromBar: TINKER_BARS.spill },
] as const;
