import { createMusicTime } from '../../engine/music-time';

// One authoritative tempo. 128 BPM, 16 steps per bar: a bar is 1.875 s, so the
// 32-bar arrangement is exactly the 60-second run.
export const TINKER_BPM = 128;
export const TINKER_STEPS_PER_BAR = 16;
export const TINKER_TIME = createMusicTime(TINKER_BPM, { stepsPerBar: TINKER_STEPS_PER_BAR });

export const TINKER_BARS = {
  run: 0,
  marble: 0,
  tennis: 8,
  melon: 16,
  spillFill: 20,
  spill: 21,
  clean: 30,
  end: 32,
} as const;

export const TINKER_MARKERS = TINKER_TIME.markers({
  run: TINKER_BARS.run,
  marble: TINKER_BARS.marble,
  tennis: TINKER_BARS.tennis,
  melon: TINKER_BARS.melon,
  spillFill: TINKER_BARS.spillFill,
  spill: TINKER_BARS.spill,
  bossEntrance: TINKER_BARS.spill,
  clean: TINKER_BARS.clean,
  end: TINKER_BARS.end,
});

export const TINKER_RUN_DURATION = TINKER_MARKERS.end;
export const TENNIS_TIME = TINKER_MARKERS.tennis;
export const MELON_TIME = TINKER_MARKERS.melon;
export const SPILL_TIME = TINKER_MARKERS.spill;
export const CLEAN_TIME = TINKER_MARKERS.clean;

// Score sections drive the player's instrument timbres and kill lanes. The
// scale changes crossfade over a bar because the backing track only turns over
// gently there; the Spill snaps because the whole arrangement turns with it.
export const TINKER_SCORE_SECTIONS = [
  { index: 0, fromBar: TINKER_BARS.marble },
  { index: 1, fromBar: TINKER_BARS.tennis, crossfadeBars: 1 },
  { index: 2, fromBar: TINKER_BARS.melon, crossfadeBars: 1 },
  { index: 3, fromBar: TINKER_BARS.spill },
  { index: 4, fromBar: TINKER_BARS.clean, crossfadeBars: 1 },
] as const;

export const TINKER_RUN_SECTIONS = [
  { name: 'marble', fromBar: TINKER_BARS.marble, toBar: TINKER_BARS.tennis },
  { name: 'tennis-ball', fromBar: TINKER_BARS.tennis, toBar: TINKER_BARS.melon },
  { name: 'melon', fromBar: TINKER_BARS.melon, toBar: TINKER_BARS.spillFill },
  { name: 'spill-fill', fromBar: TINKER_BARS.spillFill, toBar: TINKER_BARS.spill },
  { name: 'the-spill', fromBar: TINKER_BARS.spill, toBar: TINKER_BARS.clean },
  { name: 'spotless', fromBar: TINKER_BARS.clean, toBar: TINKER_BARS.end },
] as const;

export const bar = TINKER_TIME.bar;
