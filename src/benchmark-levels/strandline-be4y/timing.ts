import { createMusicTime } from '../../engine/music-time';

// Strandline drifts at 96 BPM: one bar = 2.5 s, 24 bars = exactly the
// 60-second run. The set pieces are bar boundaries first: the pulse enters at
// bar 4, the rail swings wide to stare at the bell at bar 8, dives back into
// the strands at bar 10, reaches the crown at bar 16, and the parent's
// deadline is bar 22 — the last two bars are the coda either way.
export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const STRANDLINE_BAR = STRANDLINE_TIME.barSeconds;

export const STRANDLINE_BARS = {
  drift: 0,
  forest: 4,
  bell: 8,
  dive: 10,
  crownApproach: 15,
  crown: 16,
  deadline: 22,
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  drift: STRANDLINE_BARS.drift,
  forest: STRANDLINE_BARS.forest,
  bell: STRANDLINE_BARS.bell,
  dive: STRANDLINE_BARS.dive,
  crownApproach: STRANDLINE_BARS.crownApproach,
  crown: STRANDLINE_BARS.crown,
  deadline: STRANDLINE_BARS.deadline,
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;
export const FOREST_TIME = STRANDLINE_MARKERS.forest;
export const BELL_TIME = STRANDLINE_MARKERS.bell;
export const DIVE_TIME = STRANDLINE_MARKERS.dive;
export const CROWN_TIME = STRANDLINE_MARKERS.crown;
export const DEADLINE_TIME = STRANDLINE_MARKERS.deadline;

export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.drift },
  { index: 1, fromBar: STRANDLINE_BARS.forest, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_BARS.bell, crossfadeBars: 0.5 },
  { index: 3, fromBar: STRANDLINE_BARS.dive, crossfadeBars: 1 },
  { index: 4, fromBar: STRANDLINE_BARS.crown, crossfadeBars: 1 },
  { index: 5, fromBar: STRANDLINE_BARS.deadline, crossfadeBars: 1 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'drift', fromBar: STRANDLINE_BARS.drift, toBar: STRANDLINE_BARS.forest },
  { name: 'forest', fromBar: STRANDLINE_BARS.forest, toBar: STRANDLINE_BARS.bell },
  { name: 'bell', fromBar: STRANDLINE_BARS.bell, toBar: STRANDLINE_BARS.dive },
  { name: 'dive', fromBar: STRANDLINE_BARS.dive, toBar: STRANDLINE_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.deadline },
  { name: 'serene', fromBar: STRANDLINE_BARS.deadline, toBar: STRANDLINE_BARS.end },
] as const;

export const bar = STRANDLINE_TIME.bar;
