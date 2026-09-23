import { createMusicTime } from '../../engine/music-time';

// One authoritative clock for the whole level. Vespers is a 24-bar organ
// piece at 96 BPM — one bar is 2.5 s, so the run is exactly 60 seconds.
export const VESPERS_BPM = 96;
export const VESPERS_STEPS_PER_BAR = 16;
export const VESPERS_TIME = createMusicTime(VESPERS_BPM, { stepsPerBar: VESPERS_STEPS_PER_BAR });

// The form, in bars. Voices enter one at a time over a held pedal (a fugue
// exposition), swell under the crossing, fall to a single voice in the dark
// nave, then the pedal takes the subject as a ground bass for the fight at the
// west rose. Bar 23 is the final chord: major if the rose burns, bare minor
// if it does not.
export const VESPERS_BARS = {
  pedal: 0,
  alto: 2,
  soprano: 4,
  tenor: 6,
  swell: 8,
  episode: 10,
  quiet: 12,
  wake: 14,
  rose: 15,
  deadline: 22,
  amen: 23,
  end: 24,
} as const;

export const VESPERS_MARKERS = VESPERS_TIME.markers({
  pedal: VESPERS_BARS.pedal,
  alto: VESPERS_BARS.alto,
  soprano: VESPERS_BARS.soprano,
  tenor: VESPERS_BARS.tenor,
  swell: VESPERS_BARS.swell,
  episode: VESPERS_BARS.episode,
  quiet: VESPERS_BARS.quiet,
  wake: VESPERS_BARS.wake,
  rose: VESPERS_BARS.rose,
  deadline: VESPERS_BARS.deadline,
  amen: VESPERS_BARS.amen,
});

export const VESPERS_DURATION = VESPERS_TIME.bar(VESPERS_BARS.end);

// Score sections drive the player's instrument (kill lane contour, voicing).
// Section 4 is never reached by bar count: it is forced when the rose burns.
export type VespersSection = 0 | 1 | 2 | 3 | 4;
export const VESPERS_SCORE_SECTIONS = [
  { index: 0, fromBar: VESPERS_BARS.pedal },
  { index: 1, fromBar: VESPERS_BARS.swell, crossfadeBars: 1 },
  { index: 2, fromBar: VESPERS_BARS.quiet },
  { index: 3, fromBar: VESPERS_BARS.rose },
] as const;

export const VESPERS_RUN_SECTIONS = [
  { name: 'pedal', fromBar: VESPERS_BARS.pedal },
  { name: 'alto', fromBar: VESPERS_BARS.alto },
  { name: 'soprano', fromBar: VESPERS_BARS.soprano },
  { name: 'tenor', fromBar: VESPERS_BARS.tenor },
  { name: 'swell', fromBar: VESPERS_BARS.swell },
  { name: 'episode', fromBar: VESPERS_BARS.episode },
  { name: 'quiet', fromBar: VESPERS_BARS.quiet },
  { name: 'rose', fromBar: VESPERS_BARS.rose },
  { name: 'amen', fromBar: VESPERS_BARS.amen },
] as const;
