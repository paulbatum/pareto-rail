import { createMusicTime } from '../../engine/music-time';

// Vespers runs at a hymn tempo: 72 BPM, 4/4, sixteen steps to the bar. One
// bar is 3.333 s, so eighteen bars are exactly sixty seconds and the run ends
// on the last bar line of the chorale.
export const VESPERS_BPM = 72;
export const VESPERS_STEPS_PER_BAR = 16;
export const VESPERS_TIME = createMusicTime(VESPERS_BPM, { stepsPerBar: VESPERS_STEPS_PER_BAR });

// The arrangement is a chorale prelude: voices enter one at a time above the
// pedal, swell with choir and bells, fall silent, and the last voice waits for
// the boss to die before it speaks.
export const VESPERS_BARS = {
  run: 0, // pedal alone; the first shades peel off the glass
  tenor: 2, // cantus firmus enters
  alto: 4, // counter-melody above it
  soprano: 6, // descant; censers swing in
  swell: 8, // choir and bells; the densest wave
  quiet: 10, // one voice, an empty nave
  boss: 12, // the thing in the rose window
  end: 18,
} as const;

export const VESPERS_MARKERS = VESPERS_TIME.markers({
  run: VESPERS_BARS.run,
  tenor: VESPERS_BARS.tenor,
  alto: VESPERS_BARS.alto,
  soprano: VESPERS_BARS.soprano,
  swell: VESPERS_BARS.swell,
  quiet: VESPERS_BARS.quiet,
  bossEntrance: VESPERS_BARS.boss,
  end: VESPERS_BARS.end,
});

export const VESPERS_RUN_DURATION = VESPERS_MARKERS.end;
export const BOSS_TIME = VESPERS_MARKERS.bossEntrance;
export const QUIET_TIME = VESPERS_MARKERS.quiet;
export const SWELL_TIME = VESPERS_MARKERS.swell;

// Player-instrument sections for the score. The coda (index 4) is never
// reached by the clock: the audio overrides into it when the eye dies and the
// key turns major.
export const VESPERS_SCORE_SECTIONS = [
  { index: 0, fromBar: VESPERS_BARS.run },
  { index: 1, fromBar: VESPERS_BARS.swell, crossfadeBars: 1 },
  { index: 2, fromBar: VESPERS_BARS.quiet },
  { index: 3, fromBar: VESPERS_BARS.boss },
  { index: 4, fromBar: VESPERS_BARS.end },
] as const;

export const VESPERS_RUN_SECTIONS = [
  { name: 'pedal', fromBar: VESPERS_BARS.run, toBar: VESPERS_BARS.tenor },
  { name: 'tenor', fromBar: VESPERS_BARS.tenor, toBar: VESPERS_BARS.alto },
  { name: 'alto', fromBar: VESPERS_BARS.alto, toBar: VESPERS_BARS.soprano },
  { name: 'soprano', fromBar: VESPERS_BARS.soprano, toBar: VESPERS_BARS.swell },
  { name: 'swell', fromBar: VESPERS_BARS.swell, toBar: VESPERS_BARS.quiet },
  { name: 'quiet', fromBar: VESPERS_BARS.quiet, toBar: VESPERS_BARS.boss },
  { name: 'rose', fromBar: VESPERS_BARS.boss, toBar: VESPERS_BARS.end },
] as const;

export const bar = VESPERS_TIME.bar;
