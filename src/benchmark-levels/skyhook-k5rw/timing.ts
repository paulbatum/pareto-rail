import { createMusicTime } from '../../engine/music-time';

// 128 BPM, 4/4. One bar = 1.875 s, so 32 bars is exactly 60 seconds — the whole
// climb fits one 32-bar arrangement with no leftover.
export const SKYHOOK_BPM = 128;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });
export const SKYHOOK_BAR = SKYHOOK_TIME.barSeconds;

// The climb in bars. Every section boundary is something the player sees.
export const SKYHOOK_BARS = {
  weather: 0, // release the anchor clamps, climb into the storm
  deck: 8, // punch through the cloud deck — the sky opens
  sighting: 14, // something is on the tether, far above
  descender: 16, // it is close enough to matter; the boss theme drops
  engage: 17.5, // its grapnels come into range
  contact: 25.5, // deadline: it reaches the car
  dock: 26, // the station opens overhead
  quiet: 28.5, // everything decelerates
  end: 32,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers({
  weather: SKYHOOK_BARS.weather,
  deck: SKYHOOK_BARS.deck,
  sighting: SKYHOOK_BARS.sighting,
  descender: SKYHOOK_BARS.descender,
  engage: SKYHOOK_BARS.engage,
  dock: SKYHOOK_BARS.dock,
  end: SKYHOOK_BARS.end,
});

export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;
export const DECK_TIME = SKYHOOK_MARKERS.deck;
export const SIGHTING_TIME = SKYHOOK_MARKERS.sighting;
export const DESCENDER_TIME = SKYHOOK_MARKERS.descender;
export const ENGAGE_TIME = SKYHOOK_MARKERS.engage;
export const CONTACT_TIME = SKYHOOK_TIME.bar(SKYHOOK_BARS.contact);
export const DOCK_TIME = SKYHOOK_MARKERS.dock;
export const QUIET_TIME = SKYHOOK_TIME.bar(SKYHOOK_BARS.quiet);

// Score sections: the air thins, so each one has fewer layers than the last.
export const SKYHOOK_SCORE_SECTIONS = [
  { index: 0, fromBar: SKYHOOK_BARS.weather },
  { index: 1, fromBar: SKYHOOK_BARS.deck, crossfadeBars: 2 },
  { index: 2, fromBar: SKYHOOK_BARS.descender, crossfadeBars: 2 },
  { index: 3, fromBar: SKYHOOK_BARS.dock, crossfadeBars: 1.5 },
] as const;

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'weather', fromBar: SKYHOOK_BARS.weather, toBar: SKYHOOK_BARS.deck },
  { name: 'deck', fromBar: SKYHOOK_BARS.deck, toBar: SKYHOOK_BARS.sighting },
  { name: 'sighting', fromBar: SKYHOOK_BARS.sighting, toBar: SKYHOOK_BARS.descender },
  { name: 'descender', fromBar: SKYHOOK_BARS.descender, toBar: SKYHOOK_BARS.dock },
  { name: 'dock', fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end },
] as const;

export const bar = SKYHOOK_TIME.bar;
