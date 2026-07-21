import { createMusicTime } from '../../engine/music-time';

// Skyhook is 160 BPM in 4/4, so one bar is exactly 1.5 s and the whole climb is
// 40 bars = 60.0 s. Every set piece in the level is authored as a bar number.
export const SKYHOOK_BPM = 160;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });
export const SKYHOOK_BAR = SKYHOOK_TIME.barSeconds;

// The climb in five movements. The names are altitudes, not song sections:
// the arrangement is built to lose a layer of air at every boundary.
export const SKYHOOK_BARS = {
  weather: 0,
  deck: 8,
  thin: 16,
  reveal: 23,
  descender: 24,
  dock: 36,
  end: 40,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers({
  weather: SKYHOOK_BARS.weather,
  deck: SKYHOOK_BARS.deck,
  thin: SKYHOOK_BARS.thin,
  reveal: SKYHOOK_BARS.reveal,
  descender: SKYHOOK_BARS.descender,
  dock: SKYHOOK_BARS.dock,
  end: SKYHOOK_BARS.end,
});

export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;
export const DECK_TIME = SKYHOOK_MARKERS.deck;
export const THIN_TIME = SKYHOOK_MARKERS.thin;
export const REVEAL_TIME = SKYHOOK_MARKERS.reveal;
export const DESCENDER_TIME = SKYHOOK_MARKERS.descender;
export const DOCK_TIME = SKYHOOK_MARKERS.dock;

/** Bar where the Descender must be dead; past this it is chewing on the car. */
export const DESCENDER_DEADLINE_BAR = 35;
export const DESCENDER_DEADLINE_TIME = SKYHOOK_TIME.bar(DESCENDER_DEADLINE_BAR);

// Player-instrument sections. Four is enough: the dock keeps the descender's
// dry vacuum voice because by then nothing is left to shoot.
export const SKYHOOK_SCORE_SECTIONS = [
  { index: 0, fromBar: SKYHOOK_BARS.weather },
  { index: 1, fromBar: SKYHOOK_BARS.deck, crossfadeBars: 2 },
  { index: 2, fromBar: SKYHOOK_BARS.thin, crossfadeBars: 2 },
  { index: 3, fromBar: SKYHOOK_BARS.descender, crossfadeBars: 2 },
] as const;

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'weather', fromBar: SKYHOOK_BARS.weather, toBar: SKYHOOK_BARS.deck },
  { name: 'deck', fromBar: SKYHOOK_BARS.deck, toBar: SKYHOOK_BARS.thin },
  { name: 'thin', fromBar: SKYHOOK_BARS.thin, toBar: SKYHOOK_BARS.descender },
  { name: 'descender', fromBar: SKYHOOK_BARS.descender, toBar: SKYHOOK_BARS.dock },
  { name: 'dock', fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end },
] as const;

export const bar = SKYHOOK_TIME.bar;
