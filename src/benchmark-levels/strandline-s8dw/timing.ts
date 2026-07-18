import { createMusicTime } from '../../engine/music-time';

export const STRANDLINE_BPM = 128;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });

export const STRANDLINE_BARS = {
  firstLight: 0,
  stirring: 6,
  moonReveal: 12,
  deepStrands: 16,
  crown: 22,
  exposed: 28,
  release: 30,
  end: 32,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers(STRANDLINE_BARS);
export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;

export type StrandlineSection = Exclude<keyof typeof STRANDLINE_BARS, 'end'>;

export const STRANDLINE_SCORE_SECTIONS = [
  { index: 'firstLight', fromBar: STRANDLINE_BARS.firstLight },
  { index: 'stirring', fromBar: STRANDLINE_BARS.stirring, crossfadeBars: 1 },
  { index: 'moonReveal', fromBar: STRANDLINE_BARS.moonReveal },
  { index: 'deepStrands', fromBar: STRANDLINE_BARS.deepStrands, crossfadeBars: 1 },
  { index: 'crown', fromBar: STRANDLINE_BARS.crown },
  { index: 'exposed', fromBar: STRANDLINE_BARS.exposed },
  { index: 'release', fromBar: STRANDLINE_BARS.release },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'first-light', fromBar: STRANDLINE_BARS.firstLight },
  { name: 'stirring', fromBar: STRANDLINE_BARS.stirring },
  { name: 'green-moon', fromBar: STRANDLINE_BARS.moonReveal },
  { name: 'deep-strands', fromBar: STRANDLINE_BARS.deepStrands },
  { name: 'the-crown', fromBar: STRANDLINE_BARS.crown },
  { name: 'parent-exposed', fromBar: STRANDLINE_BARS.exposed },
  { name: 'released', fromBar: STRANDLINE_BARS.release },
] as const;
