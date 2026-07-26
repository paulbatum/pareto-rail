import { createMusicTime } from '../../engine/music-time';

// One authoritative tempo for the whole level. 128 BPM in common time makes a
// bar exactly 1.875 s, so the 32-bar arrangement lands the run on 60.0 s —
// the finale coast across the clean patch of table ends on the phrase.
export const TINKER_BPM = 128;
export const TINKER_STEPS_PER_BAR = 16;
export const TINKER_TIME = createMusicTime(TINKER_BPM, { stepsPerBar: TINKER_STEPS_PER_BAR });

// Arrangement bars. The run is one lap of the worktable in three growth
// stages — marble, tennis ball, melon — then the glue spill under the lamp.
export const TINKER_BARS = {
  run: 0,
  marble: 0,
  claps: 4,
  tennis: 8,
  playerTennis: 8,
  organ: 12,
  clutter: 16,
  preSpill: 20,
  spillFill: 21,
  spill: 22,
  playerSpill: 22,
  spillDrive: 26,
  coast: 30,
} as const;

export const TINKER_MARKERS = TINKER_TIME.markers({
  run: TINKER_BARS.run,
  claps: TINKER_BARS.claps,
  tennis: TINKER_BARS.tennis,
  organ: TINKER_BARS.organ,
  clutter: TINKER_BARS.clutter,
  preSpill: TINKER_BARS.preSpill,
  bossEntrance: [TINKER_BARS.spill, 0],
  coast: TINKER_BARS.coast,
});

export const TINKER_RUN_DURATION = TINKER_TIME.bar(32);

export const TINKER_SCORE_SECTIONS = [
  { index: 0, fromBar: TINKER_BARS.marble },
  { index: 1, fromBar: TINKER_BARS.playerTennis, crossfadeBars: 2 },
  { index: 2, fromBar: TINKER_BARS.playerSpill, crossfadeBars: 1 },
] as const;

export const TINKER_RUN_SECTIONS = [
  { name: 'marble', fromBar: TINKER_BARS.marble, toBar: TINKER_BARS.claps },
  { name: 'claps', fromBar: TINKER_BARS.claps, toBar: TINKER_BARS.tennis },
  { name: 'tennis', fromBar: TINKER_BARS.tennis, toBar: TINKER_BARS.organ },
  { name: 'organ', fromBar: TINKER_BARS.organ, toBar: TINKER_BARS.clutter },
  { name: 'clutter', fromBar: TINKER_BARS.clutter, toBar: TINKER_BARS.preSpill },
  { name: 'pre-spill', fromBar: TINKER_BARS.preSpill, toBar: TINKER_BARS.spill },
  { name: 'spill', fromBar: TINKER_BARS.spill, toBar: TINKER_BARS.coast },
  { name: 'coast', fromBar: TINKER_BARS.coast },
] as const;

export const TINKER_SPAWN_SYNC = {
  bpm: TINKER_BPM,
  beatsPerBar: TINKER_TIME.beatsPerBar,
  duration: TINKER_RUN_DURATION,
  sections: TINKER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    fromBar: section.fromBar,
    ...('toBar' in section ? { toBar: section.toBar } : {}),
  })),
};
