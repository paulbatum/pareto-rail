import { createMusicTime } from '../../engine/music-time';

// DOWNPOUR — 176 BPM drum & bass, 44 bars = exactly 60 seconds
// (one bar = 240/176 s = 1.363636...s; 44 * 1.363636... = 60).
export const DOWNPOUR_BPM = 176;
export const DOWNPOUR_STEPS_PER_BAR = 16;
export const DOWNPOUR_TIME = createMusicTime(DOWNPOUR_BPM, { stepsPerBar: DOWNPOUR_STEPS_PER_BAR });
export const DOWNPOUR_BAR = DOWNPOUR_TIME.barSeconds;

// Seven movements tracing the theme's arc: storm ceiling -> tower plunge
// (drop 1) -> avenue canyons -> undercity plunge (drop 2) -> flooded canal
// (half-time menace) -> citadel climb (the hunt) -> moonlit release above
// the clouds.
export const DOWNPOUR_BARS = {
  storm: 0,
  plunge: 4,
  avenue: 12,
  undercity: 18,
  canal: 24,
  citadel: 30,
  outro: 40,
  end: 44,
} as const;

export const DOWNPOUR_MARKERS = DOWNPOUR_TIME.markers(DOWNPOUR_BARS);

export const DOWNPOUR_DURATION = DOWNPOUR_MARKERS.end;
export const PLUNGE_TIME = DOWNPOUR_MARKERS.plunge;
export const AVENUE_TIME = DOWNPOUR_MARKERS.avenue;
export const UNDERCITY_TIME = DOWNPOUR_MARKERS.undercity;
export const CANAL_TIME = DOWNPOUR_MARKERS.canal;
export const CITADEL_TIME = DOWNPOUR_MARKERS.citadel;
export const OUTRO_TIME = DOWNPOUR_MARKERS.outro;

export const DOWNPOUR_SCORE_SECTIONS = [
  { index: 0, fromBar: DOWNPOUR_BARS.storm },
  { index: 1, fromBar: DOWNPOUR_BARS.plunge },
  { index: 2, fromBar: DOWNPOUR_BARS.avenue, crossfadeBars: 1 },
  { index: 3, fromBar: DOWNPOUR_BARS.undercity },
  { index: 4, fromBar: DOWNPOUR_BARS.canal, crossfadeBars: 2 },
  { index: 5, fromBar: DOWNPOUR_BARS.citadel },
  { index: 6, fromBar: DOWNPOUR_BARS.outro, crossfadeBars: 2 },
] as const;

export const DOWNPOUR_RUN_SECTIONS = [
  { name: 'storm', fromBar: DOWNPOUR_BARS.storm, toBar: DOWNPOUR_BARS.plunge },
  { name: 'plunge', fromBar: DOWNPOUR_BARS.plunge, toBar: DOWNPOUR_BARS.avenue },
  { name: 'avenue', fromBar: DOWNPOUR_BARS.avenue, toBar: DOWNPOUR_BARS.undercity },
  { name: 'undercity', fromBar: DOWNPOUR_BARS.undercity, toBar: DOWNPOUR_BARS.canal },
  { name: 'canal', fromBar: DOWNPOUR_BARS.canal, toBar: DOWNPOUR_BARS.citadel },
  { name: 'citadel', fromBar: DOWNPOUR_BARS.citadel, toBar: DOWNPOUR_BARS.outro },
  { name: 'outro', fromBar: DOWNPOUR_BARS.outro, toBar: DOWNPOUR_BARS.end },
] as const;

export const bar = DOWNPOUR_TIME.bar;
