import { createMusicTime } from '../../engine/music-time';

// BROADSIDE rides a 132 BPM grid: one bar = 1.8181 s, and 33 bars is exactly
// 60.000 s. Thirty-two bars carry the engagement; the thirty-third is the
// victory chord ringing out over the wreck.
//
// Every set piece is a bar boundary first and a place in the battle second.
// The catapult throws you on bar 0, the fleets close at bar 4, the friendly
// cruiser's broadside opens overhead at bar 10, you rake an enemy warship's
// belly from bar 15, and bar 20 is the eye of the battle — one bar of near
// silence before the enemy flagship fills the frame.
export const BROADSIDE_BPM = 132;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });
export const BROADSIDE_BAR = BROADSIDE_TIME.barSeconds;

export const BROADSIDE_BARS = {
  launch: 0,
  crossfire: 4,
  flank: 10,
  raking: 15,
  eye: 20,
  shields: 21,
  breach: 26,
  trench: 28,
  victory: 32,
  end: 33,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers({
  launch: BROADSIDE_BARS.launch,
  crossfire: BROADSIDE_BARS.crossfire,
  flank: BROADSIDE_BARS.flank,
  raking: BROADSIDE_BARS.raking,
  eye: BROADSIDE_BARS.eye,
  shields: BROADSIDE_BARS.shields,
  breach: BROADSIDE_BARS.breach,
  trench: BROADSIDE_BARS.trench,
  victory: BROADSIDE_BARS.victory,
  end: BROADSIDE_BARS.end,
});

export const BROADSIDE_DURATION = BROADSIDE_MARKERS.end;

export const CROSSFIRE_TIME = BROADSIDE_MARKERS.crossfire;
export const FLANK_TIME = BROADSIDE_MARKERS.flank;
export const RAKING_TIME = BROADSIDE_MARKERS.raking;
export const EYE_TIME = BROADSIDE_MARKERS.eye;
export const SHIELDS_TIME = BROADSIDE_MARKERS.shields;
export const BREACH_TIME = BROADSIDE_MARKERS.breach;
export const TRENCH_TIME = BROADSIDE_MARKERS.trench;
export const VICTORY_TIME = BROADSIDE_MARKERS.victory;

// Score sections. The flagship act folds the eye, the shield pass, and the
// escort breach into one harmonic world so the Neapolitan flat-second that
// arrives with the flagship owns everything up to the trench dive.
export const BROADSIDE_SCORE_SECTIONS = [
  { index: 0, fromBar: BROADSIDE_BARS.launch },
  { index: 1, fromBar: BROADSIDE_BARS.crossfire, crossfadeBars: 1 },
  { index: 2, fromBar: BROADSIDE_BARS.flank, crossfadeBars: 1 },
  { index: 3, fromBar: BROADSIDE_BARS.raking, crossfadeBars: 1 },
  { index: 4, fromBar: BROADSIDE_BARS.eye, crossfadeBars: 1 },
  { index: 5, fromBar: BROADSIDE_BARS.trench, crossfadeBars: 0.5 },
  { index: 6, fromBar: BROADSIDE_BARS.victory, crossfadeBars: 0.5 },
] as const;

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'launch', fromBar: BROADSIDE_BARS.launch },
  { name: 'crossfire', fromBar: BROADSIDE_BARS.crossfire },
  { name: 'flank', fromBar: BROADSIDE_BARS.flank },
  { name: 'raking', fromBar: BROADSIDE_BARS.raking },
  { name: 'flagship', fromBar: BROADSIDE_BARS.eye },
  { name: 'trench', fromBar: BROADSIDE_BARS.trench },
  { name: 'victory', fromBar: BROADSIDE_BARS.victory },
] as const;

export const bar = BROADSIDE_TIME.bar;
