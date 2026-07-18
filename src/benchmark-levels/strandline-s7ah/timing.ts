import { createMusicTime } from '../../engine/music-time';

// Strandline breathes at 96 BPM: one bar = 2.5 s, 24 bars = exactly the
// 60-second swim. The run's shape is bar boundaries first and geography
// second — the strand forest thickens at bar 4, the curve slings wide of the
// animal at bar 10 and the bell fills the view, the rail dives back into the
// thick of the infestation at bar 13, the crown fight starts at bar 17, and
// the last two bars belong to the freed jellyfish.
export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });

export const STRANDLINE_BARS = {
  drift: 0,
  forest: 4,
  reveal: 10,
  thick: 13,
  crown: 17,
  release: 22,
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  drift: STRANDLINE_BARS.drift,
  forest: STRANDLINE_BARS.forest,
  reveal: STRANDLINE_BARS.reveal,
  thick: STRANDLINE_BARS.thick,
  crown: STRANDLINE_BARS.crown,
  release: STRANDLINE_BARS.release,
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;
export const REVEAL_TIME = STRANDLINE_MARKERS.reveal;
export const THICK_TIME = STRANDLINE_MARKERS.thick;
export const CROWN_TIME = STRANDLINE_MARKERS.crown;
export const RELEASE_TIME = STRANDLINE_MARKERS.release;

export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.drift },
  { index: 1, fromBar: STRANDLINE_BARS.forest, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_BARS.reveal, crossfadeBars: 1 },
  { index: 3, fromBar: STRANDLINE_BARS.thick, crossfadeBars: 1 },
  { index: 4, fromBar: STRANDLINE_BARS.crown, crossfadeBars: 1 },
  { index: 5, fromBar: STRANDLINE_BARS.release, crossfadeBars: 1 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'drift', fromBar: STRANDLINE_BARS.drift, toBar: STRANDLINE_BARS.forest },
  { name: 'forest', fromBar: STRANDLINE_BARS.forest, toBar: STRANDLINE_BARS.reveal },
  { name: 'reveal', fromBar: STRANDLINE_BARS.reveal, toBar: STRANDLINE_BARS.thick },
  { name: 'thick', fromBar: STRANDLINE_BARS.thick, toBar: STRANDLINE_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.release },
  { name: 'release', fromBar: STRANDLINE_BARS.release, toBar: STRANDLINE_BARS.end },
] as const;

export const bar = STRANDLINE_TIME.bar;
