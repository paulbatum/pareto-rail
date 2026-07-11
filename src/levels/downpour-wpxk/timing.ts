import { createMusicTime } from '../../engine/music-time';

export const DOWNPOUR_BPM = 176;
export const DOWNPOUR_STEPS_PER_BAR = 16;
export const DOWNPOUR_TIME = createMusicTime(DOWNPOUR_BPM, { stepsPerBar: DOWNPOUR_STEPS_PER_BAR });
export const DOWNPOUR_BAR = DOWNPOUR_TIME.barSeconds;

// 44 bars at 176 BPM = exactly 60 seconds.
export const DOWNPOUR_BARS = {
  ceiling: 0,
  plunge: 8,
  undercity: 16,
  canal: 24,
  hunt: 32,
  summit: 40,
  end: 44,
} as const;

export const DOWNPOUR_MARKERS = DOWNPOUR_TIME.markers({
  ceiling: DOWNPOUR_BARS.ceiling,
  plunge: DOWNPOUR_BARS.plunge,
  undercity: DOWNPOUR_BARS.undercity,
  canal: DOWNPOUR_BARS.canal,
  hunt: DOWNPOUR_BARS.hunt,
  summit: DOWNPOUR_BARS.summit,
  end: DOWNPOUR_BARS.end,
});

export const DOWNPOUR_DURATION = DOWNPOUR_MARKERS.end;
export const PLUNGE_TIME = DOWNPOUR_MARKERS.plunge;
export const UNDERCITY_TIME = DOWNPOUR_MARKERS.undercity;
export const CANAL_TIME = DOWNPOUR_MARKERS.canal;
export const HUNT_TIME = DOWNPOUR_MARKERS.hunt;
export const SUMMIT_TIME = DOWNPOUR_MARKERS.summit;

// Lightning strikes are authored against the score so the sky and the music
// crack at the same instant. Bars, fractional. The two great descents (plunge,
// undercity dive) each land with a strike on the drop itself.
export const LIGHTNING_BARS = [2.5, 6, 8, 12.5, 16, 21, 24, 30, 35.5, 39] as const;

export const DOWNPOUR_SCORE_SECTIONS = [
  { index: 0, fromBar: DOWNPOUR_BARS.ceiling },
  { index: 1, fromBar: DOWNPOUR_BARS.plunge, crossfadeBars: 1 },
  { index: 2, fromBar: DOWNPOUR_BARS.canal, crossfadeBars: 2 },
  { index: 3, fromBar: DOWNPOUR_BARS.hunt, crossfadeBars: 2 },
] as const;

export const DOWNPOUR_RUN_SECTIONS = [
  { name: 'ceiling', fromBar: DOWNPOUR_BARS.ceiling, toBar: DOWNPOUR_BARS.plunge },
  { name: 'plunge', fromBar: DOWNPOUR_BARS.plunge, toBar: DOWNPOUR_BARS.undercity },
  { name: 'undercity', fromBar: DOWNPOUR_BARS.undercity, toBar: DOWNPOUR_BARS.canal },
  { name: 'canal', fromBar: DOWNPOUR_BARS.canal, toBar: DOWNPOUR_BARS.hunt },
  { name: 'hunt', fromBar: DOWNPOUR_BARS.hunt, toBar: DOWNPOUR_BARS.summit },
  { name: 'summit', fromBar: DOWNPOUR_BARS.summit, toBar: DOWNPOUR_BARS.end },
] as const;

export const bar = DOWNPOUR_TIME.bar;
