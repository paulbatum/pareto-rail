import { createMusicTime } from '../../engine/music-time';

export const STRANDLINE_542F_BPM = 96;
export const STRANDLINE_542F_STEPS_PER_BAR = 16;
export const STRANDLINE_542F_TIME = createMusicTime(STRANDLINE_542F_BPM, {
  stepsPerBar: STRANDLINE_542F_STEPS_PER_BAR,
});

// Twenty-four bars at 96 BPM is exactly sixty seconds. The last two bars are
// intentionally free of new targets: they are the camera pullback and release.
export const STRANDLINE_542F_BARS = {
  drift: 0,
  firstLight: 2,
  moonReveal: 6,
  forestReturn: 9,
  livingCurrent: 11,
  crownApproach: 14,
  parent: 16,
  webTwo: 18,
  webThree: 20,
  release: 22,
  wholeAnimal: 23,
  end: 24,
} as const;

export const STRANDLINE_542F_MARKERS = STRANDLINE_542F_TIME.markers(STRANDLINE_542F_BARS);
export const STRANDLINE_542F_RUN_DURATION = STRANDLINE_542F_MARKERS.end;

export const STRANDLINE_542F_SCORE_SECTIONS = [
  { index: 'hush', fromBar: STRANDLINE_542F_BARS.drift },
  { index: 'sunward', fromBar: STRANDLINE_542F_BARS.moonReveal, crossfadeBars: 1 },
  { index: 'pulse', fromBar: STRANDLINE_542F_BARS.livingCurrent, crossfadeBars: 1 },
  { index: 'crown', fromBar: STRANDLINE_542F_BARS.crownApproach },
  { index: 'parent', fromBar: STRANDLINE_542F_BARS.parent },
  { index: 'free', fromBar: STRANDLINE_542F_BARS.release },
] as const;

export type Strandline542fSection = (typeof STRANDLINE_542F_SCORE_SECTIONS)[number]['index'];

export const STRANDLINE_542F_RUN_SECTIONS = [
  { name: 'trailing-forest', fromBar: 0, toBar: 6 },
  { name: 'green-moon', fromBar: 6, toBar: 9 },
  { name: 'living-strands', fromBar: 9, toBar: 14 },
  { name: 'infested-crown', fromBar: 14, toBar: 16 },
  { name: 'parent-web', fromBar: 16, toBar: 22 },
  { name: 'liberation', fromBar: 22, toBar: 24 },
] as const;

export const strandlineBar = STRANDLINE_542F_TIME.bar;
