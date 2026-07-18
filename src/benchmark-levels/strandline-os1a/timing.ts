import { createMusicTime } from '../../engine/music-time';

// STRANDLINE runs on a 96 BPM grid: one bar = 2.5 s, and 24 bars is exactly
// the 60-second dive. The animal's anatomy and the arrangement share the same
// bar numbers — the rail swings clear of the strands on the bar-6 lift, dives
// back into the thicket at bar 8, rises toward the crown at bar 14, meets the
// parent at bar 16, and drifts free from bar 22.
export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const STRANDLINE_BAR_SECONDS = STRANDLINE_TIME.barSeconds;

export const STRANDLINE_BARS = {
  drift: 0,
  open: 6,
  thicket: 8,
  rise: 14,
  crown: 16,
  adrift: 22,
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  drift: STRANDLINE_BARS.drift,
  open: STRANDLINE_BARS.open,
  thicket: STRANDLINE_BARS.thicket,
  rise: STRANDLINE_BARS.rise,
  crown: STRANDLINE_BARS.crown,
  adrift: STRANDLINE_BARS.adrift,
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;
export const OPEN_TIME = STRANDLINE_MARKERS.open;
export const THICKET_TIME = STRANDLINE_MARKERS.thicket;
export const RISE_TIME = STRANDLINE_MARKERS.rise;
export const CROWN_TIME = STRANDLINE_MARKERS.crown;
export const ADRIFT_TIME = STRANDLINE_MARKERS.adrift;

/** Score sections. Crossfades are long on purpose: the animal wakes, it does not cut. */
export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.drift },
  { index: 1, fromBar: STRANDLINE_BARS.open, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_BARS.thicket, crossfadeBars: 1 },
  { index: 3, fromBar: STRANDLINE_BARS.crown, crossfadeBars: 2 },
  { index: 4, fromBar: STRANDLINE_BARS.adrift, crossfadeBars: 1 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'strands', fromBar: STRANDLINE_BARS.drift, toBar: STRANDLINE_BARS.open },
  { name: 'openwater', fromBar: STRANDLINE_BARS.open, toBar: STRANDLINE_BARS.thicket },
  { name: 'thicket', fromBar: STRANDLINE_BARS.thicket, toBar: STRANDLINE_BARS.rise },
  { name: 'rise', fromBar: STRANDLINE_BARS.rise, toBar: STRANDLINE_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.adrift },
  { name: 'adrift', fromBar: STRANDLINE_BARS.adrift, toBar: STRANDLINE_BARS.end },
] as const;

export const bar = STRANDLINE_TIME.bar;
