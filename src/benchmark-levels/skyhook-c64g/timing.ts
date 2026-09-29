import { createMusicTime } from '../../engine/music-time';

// SKYHOOK — 96 BPM, 24 bars of 4/4: bar = 2.5 s, so the run is exactly 60 s.
// The climb is scored as a thinning: every bar boundary below is a place where
// the sky, the enemy roster and a layer of the music all change together.
export const SKYHOOK_BPM = 96;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });
export const SKYHOOK_BAR = SKYHOOK_TIME.barSeconds;

export const SKYHOOK_BARS = {
  weather: 0, // storm cell: wind-riders, rain, the ground falling away
  deck: 6, // the cloud deck: whiteout, punch-through, the drop
  sun: 6, // sunlit blue over a sea of cloud
  thin: 10, // the air gives out: indigo, first stars, sentries
  latch: 14, // the Ripper latches onto the tether, far above
  dock: 21, // the station opens overhead
  end: 24,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers({
  weather: SKYHOOK_BARS.weather,
  deck: SKYHOOK_BARS.deck,
  sun: SKYHOOK_BARS.sun,
  thin: SKYHOOK_BARS.thin,
  latch: SKYHOOK_BARS.latch,
  dock: SKYHOOK_BARS.dock,
  end: SKYHOOK_BARS.end,
});

export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;
export const DECK_TIME = SKYHOOK_MARKERS.deck;
export const THIN_TIME = SKYHOOK_MARKERS.thin;
export const LATCH_TIME = SKYHOOK_MARKERS.latch;
export const DOCK_TIME = SKYHOOK_MARKERS.dock;

// Score sections drive the player's instrument and kill lanes.
export const SKYHOOK_SCORE_SECTIONS = [
  { index: 0, fromBar: SKYHOOK_BARS.weather },
  { index: 1, fromBar: SKYHOOK_BARS.sun, crossfadeBars: 1 },
  { index: 2, fromBar: SKYHOOK_BARS.thin, crossfadeBars: 2 },
  { index: 3, fromBar: SKYHOOK_BARS.latch, crossfadeBars: 1 },
  { index: 4, fromBar: SKYHOOK_BARS.dock, crossfadeBars: 1 },
] as const;

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'weather', fromBar: SKYHOOK_BARS.weather, toBar: SKYHOOK_BARS.deck },
  { name: 'sunlit', fromBar: SKYHOOK_BARS.sun, toBar: SKYHOOK_BARS.thin },
  { name: 'thin-air', fromBar: SKYHOOK_BARS.thin, toBar: SKYHOOK_BARS.latch },
  { name: 'ripper', fromBar: SKYHOOK_BARS.latch, toBar: SKYHOOK_BARS.dock },
  { name: 'docking', fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end },
] as const;

export const bar = SKYHOOK_TIME.bar;
