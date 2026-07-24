import { createMusicTime } from '../../engine/music-time';

// Strandline runs on a slow 112 BPM ocean grid: one bar = 2.142857 s, and
// 28 bars is exactly 60.000 s. Every set piece is a bar boundary first and a
// place in the water second — the infestation shows itself at bar 4, the rail
// swings wide into open water at bar 9, dives back into the strands at 13, the
// parent is found at the crown at 18, and the last three bars are the animal
// drifting away clean.
export const STRANDLINE_BPM = 112;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const STRANDLINE_BAR_SECONDS = STRANDLINE_TIME.barSeconds;

export const STRANDLINE_BARS = {
  drift: 0,
  swarm: 4,
  open: 9,
  dive: 13,
  crown: 18,
  clear: 25,
  end: 28,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers({
  drift: STRANDLINE_BARS.drift,
  swarm: STRANDLINE_BARS.swarm,
  open: STRANDLINE_BARS.open,
  dive: STRANDLINE_BARS.dive,
  crown: STRANDLINE_BARS.crown,
  clear: STRANDLINE_BARS.clear,
  end: STRANDLINE_BARS.end,
});

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;
export const SWARM_TIME = STRANDLINE_MARKERS.swarm;
export const OPEN_TIME = STRANDLINE_MARKERS.open;
export const DIVE_TIME = STRANDLINE_MARKERS.dive;
export const CROWN_TIME = STRANDLINE_MARKERS.crown;
export const CLEAR_TIME = STRANDLINE_MARKERS.clear;

/** Score sections. Index order matches the run's arc, so kill lanes read top to bottom. */
export const STRANDLINE_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_BARS.drift },
  { index: 1, fromBar: STRANDLINE_BARS.swarm, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_BARS.open, crossfadeBars: 1 },
  { index: 3, fromBar: STRANDLINE_BARS.dive, crossfadeBars: 1 },
  { index: 4, fromBar: STRANDLINE_BARS.crown, crossfadeBars: 1 },
  { index: 5, fromBar: STRANDLINE_BARS.clear, crossfadeBars: 1 },
] as const;

export const STRANDLINE_RUN_SECTIONS = [
  { name: 'drift', fromBar: STRANDLINE_BARS.drift, toBar: STRANDLINE_BARS.swarm },
  { name: 'swarm', fromBar: STRANDLINE_BARS.swarm, toBar: STRANDLINE_BARS.open },
  { name: 'open', fromBar: STRANDLINE_BARS.open, toBar: STRANDLINE_BARS.dive },
  { name: 'dive', fromBar: STRANDLINE_BARS.dive, toBar: STRANDLINE_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.clear },
  { name: 'clear', fromBar: STRANDLINE_BARS.clear, toBar: STRANDLINE_BARS.end },
] as const;

export const bar = STRANDLINE_TIME.bar;
