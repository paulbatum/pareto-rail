import { createMusicTime } from '../../engine/music-time';

// Strandline breathes at 96 BPM: one bar = 2.5 s, one bell contraction per
// downbeat, 24 bars = exactly the 60-second run. Every set piece is a bar
// boundary first — the forest wakes at bar 4, the rail swings out to face
// the bell on the bar-8 phrase, dives back in at bar 11, and reaches the
// crown on the bar-15 downbeat. The parent must be torn loose before bar 22½.
export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const BAR_SECONDS = STRANDLINE_TIME.barSeconds;
export const BEAT_SECONDS = STRANDLINE_TIME.beatSeconds;

export const STRANDLINE_BARS = {
  drift: 0,
  kindle: 4,
  swing: 8,
  upstream: 11,
  crown: 15,
  deadline: 22,
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  drift: STRANDLINE_BARS.drift,
  kindle: STRANDLINE_BARS.kindle,
  swing: STRANDLINE_BARS.swing,
  greenMoon: [9, 2],
  upstream: STRANDLINE_BARS.upstream,
  crown: STRANDLINE_BARS.crown,
  firstBrood: [15, 1],
  deadline: [22, 2],
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;

/** Score sections: indexes drive the kill-lane and player-instrument voicing. */
export const SECTION = {
  drift: 0,
  kindle: 1,
  moon: 2,
  upstream: 3,
  crown: 4,
  serene: 5,
  blight: 6,
} as const;
export type SectionIndex = typeof SECTION[keyof typeof SECTION];

export const STRANDLINE_SCORE_SECTIONS = [
  { index: SECTION.drift, fromBar: STRANDLINE_BARS.drift },
  { index: SECTION.kindle, fromBar: STRANDLINE_BARS.kindle, crossfadeBars: 1 },
  { index: SECTION.moon, fromBar: STRANDLINE_BARS.swing, crossfadeBars: 1 },
  { index: SECTION.upstream, fromBar: STRANDLINE_BARS.upstream },
  { index: SECTION.crown, fromBar: STRANDLINE_BARS.crown },
  // The ending sections are reached by override (the parent's death or the
  // deadline), never by the bar clock; they sit past the run so the score
  // validator still sees a lane for each.
  { index: SECTION.serene, fromBar: 40 },
  { index: SECTION.blight, fromBar: 48 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'drift', fromBar: STRANDLINE_BARS.drift },
  { name: 'kindling', fromBar: STRANDLINE_BARS.kindle },
  { name: 'green moon', fromBar: STRANDLINE_BARS.swing },
  { name: 'upstream', fromBar: STRANDLINE_BARS.upstream },
  { name: 'the crown', fromBar: STRANDLINE_BARS.crown },
] as const;

export const bar = STRANDLINE_TIME.bar;
