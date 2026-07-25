import { createMusicTime } from '../../engine/music-time';

// VESPERS — 72 BPM, 4/4, 18 bars = exactly 60.0 seconds. The whole level is
// authored against these bars; every spawn, section change, and set piece
// lands on the organ's own grid.
export const VESPERS_BPM = 72;
export const VESPERS_STEPS_PER_BAR = 16;
export const VESPERS_TIME = createMusicTime(VESPERS_BPM, { stepsPerBar: VESPERS_STEPS_PER_BAR });

// The musical arc: a procession where organ voices enter one at a time, the
// full plenum, a long quiet span with a single voice, then the Vigil in the
// dead rose window, an apex bar on the dominant, and whatever the player has
// earned for the last light.
export const VESPERS_BARS = {
  run: 0,
  voices: 2,
  descant: 4,
  plenum: 7,
  quiet: 11,
  vigil: 13,
  apex: 16,
  lastLight: 17,
  end: 18,
} as const;

export const VESPERS_MARKERS = VESPERS_TIME.markers({
  run: VESPERS_BARS.run,
  voices: VESPERS_BARS.voices,
  descant: VESPERS_BARS.descant,
  plenum: VESPERS_BARS.plenum,
  quiet: VESPERS_BARS.quiet,
  vigil: VESPERS_BARS.vigil,
  bossEntrance: VESPERS_BARS.vigil,
  apex: VESPERS_BARS.apex,
  lastLight: VESPERS_BARS.lastLight,
});

export const VESPERS_RUN_DURATION = VESPERS_TIME.bar(VESPERS_BARS.end);

// Player-instrument sections: which organ voice the player's own actions speak
// in. The quiet span and the Vigil turn over hard (the music turns over with
// them); the plenum handover crossfades.
export const VESPERS_SCORE_SECTIONS = [
  { index: 0, fromBar: VESPERS_BARS.run },
  { index: 1, fromBar: VESPERS_BARS.plenum, crossfadeBars: 1 },
  { index: 2, fromBar: VESPERS_BARS.quiet },
  { index: 3, fromBar: VESPERS_BARS.vigil },
] as const;

export const VESPERS_RUN_SECTIONS = [
  { name: 'procession', fromBar: VESPERS_BARS.run, toBar: VESPERS_BARS.voices },
  { name: 'voices', fromBar: VESPERS_BARS.voices, toBar: VESPERS_BARS.descant },
  { name: 'descant', fromBar: VESPERS_BARS.descant, toBar: VESPERS_BARS.plenum },
  { name: 'plenum', fromBar: VESPERS_BARS.plenum, toBar: VESPERS_BARS.quiet },
  { name: 'quiet', fromBar: VESPERS_BARS.quiet, toBar: VESPERS_BARS.vigil },
  { name: 'vigil', fromBar: VESPERS_BARS.vigil, toBar: VESPERS_BARS.apex },
  { name: 'apex', fromBar: VESPERS_BARS.apex, toBar: VESPERS_BARS.lastLight },
  { name: 'last-light', fromBar: VESPERS_BARS.lastLight },
] as const;
