import { createMusicTime } from '../../engine/music-time';

// BROADSIDE runs on a 144 BPM martial grid: one bar = 1.6667 s, and 36 bars is
// exactly 60 seconds — nine four-bar phrases, so every set piece lands on a
// phrase boundary. The engagement is authored in bars first and in kilometres
// second; the rail geometry is generated from these times, not the reverse.
export const BROADSIDE_BPM = 144;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });
export const BROADSIDE_BAR_SECONDS = BROADSIDE_TIME.barSeconds;

export const BARS = {
  /** Catapult off your own flagship's deck. */
  launch: 0,
  /** Into the gap between the two battle lines. */
  crossfire: 4,
  /** Long high-speed run down a friendly cruiser's flank, its broadside overhead. */
  flank: 12,
  /** Under the belly of an enemy warship, raking its turrets. */
  belly: 18,
  /** The enemy flagship: close pass, shield generators, point defence. */
  shields: 23,
  /** Shield deadline. Escorts pour in and the rail comes around. */
  breach: 28,
  /** Into the trenchwork, after the exposed power cores. */
  trench: 30,
  /** Core deadline; the rail pulls out of the wreck either way. */
  victory: 34,
  end: 36,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers({
  launch: BARS.launch,
  crossfire: BARS.crossfire,
  flank: BARS.flank,
  belly: BARS.belly,
  shields: BARS.shields,
  breach: BARS.breach,
  trench: BARS.trench,
  victory: BARS.victory,
});

export const bar = BROADSIDE_TIME.bar;

export const BROADSIDE_DURATION = bar(BARS.end);
export const CROSSFIRE_TIME = BROADSIDE_MARKERS.crossfire;
export const FLANK_TIME = BROADSIDE_MARKERS.flank;
export const BELLY_TIME = BROADSIDE_MARKERS.belly;
export const SHIELDS_TIME = BROADSIDE_MARKERS.shields;
export const BREACH_TIME = BROADSIDE_MARKERS.breach;
export const TRENCH_TIME = BROADSIDE_MARKERS.trench;
export const VICTORY_TIME = BROADSIDE_MARKERS.victory;

/** Score sections: what the player's own instrument sounds like, and which kill lane it walks. */
export const BROADSIDE_SCORE_SECTIONS = [
  { index: 0, fromBar: BARS.launch },
  { index: 1, fromBar: BARS.crossfire, crossfadeBars: 1 },
  { index: 2, fromBar: BARS.flank, crossfadeBars: 1 },
  { index: 3, fromBar: BARS.belly, crossfadeBars: 1 },
  { index: 4, fromBar: BARS.shields, crossfadeBars: 1 },
  { index: 5, fromBar: BARS.trench, crossfadeBars: 1 },
] as const;

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'launch', fromBar: BARS.launch, toBar: BARS.crossfire },
  { name: 'crossfire', fromBar: BARS.crossfire, toBar: BARS.flank },
  { name: 'flank', fromBar: BARS.flank, toBar: BARS.belly },
  { name: 'belly', fromBar: BARS.belly, toBar: BARS.shields },
  { name: 'shields', fromBar: BARS.shields, toBar: BARS.breach },
  { name: 'breach', fromBar: BARS.breach, toBar: BARS.trench },
  { name: 'trench', fromBar: BARS.trench, toBar: BARS.victory },
  { name: 'victory', fromBar: BARS.victory, toBar: BARS.end },
] as const;
