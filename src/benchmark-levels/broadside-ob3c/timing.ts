import { createMusicTime } from '../../engine/music-time';

// Broadside is scored as space opera at a heroic march tempo. 112 BPM puts a
// bar at 2.142857 s, so 28 bars is exactly 60.000 seconds — seven four-bar
// phrases, and every set piece in the level is a phrase boundary rather than
// a stopwatch reading.
//
//   deck      bars 0–3    Catapult off your own flagship's bow into the battle.
//   gauntlet  bars 3–8    The crossfire. Hard banks between hulls.
//   flank     bars 8–12   High-speed run down a friendly cruiser as it fires.
//   belly     bars 12–16  Under an enemy warship. The eye of the battle: quiet.
//   flagship  bars 16–21  Close pass along the enemy flagship, shield generators.
//   fighters  bars 21–24  Shield down, escorts pour in, the rail comes around.
//   trench    bars 24–27  Dive into the trenchwork, kill the exposed power cores.
//   victory   bars 27–28  Pull out. The whole engagement in frame.
export const BROADSIDE_BPM = 112;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });

export const BROADSIDE_BARS = {
  deck: 0,
  gauntlet: 3,
  flank: 8,
  belly: 12,
  flagship: 16,
  fighters: 21,
  trench: 24,
  victory: 27,
  end: 28,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers({
  deck: BROADSIDE_BARS.deck,
  gauntlet: BROADSIDE_BARS.gauntlet,
  flank: BROADSIDE_BARS.flank,
  belly: BROADSIDE_BARS.belly,
  flagship: BROADSIDE_BARS.flagship,
  fighters: BROADSIDE_BARS.fighters,
  trench: BROADSIDE_BARS.trench,
  victory: BROADSIDE_BARS.victory,
});

export const BROADSIDE_DURATION = BROADSIDE_TIME.bar(BROADSIDE_BARS.end);

/** Authored bar index → seconds. The level's one time conversion. */
export const bar = BROADSIDE_TIME.bar;

// Player instruments and kill lanes turn over five times across the run. The
// arrangement has more sections than this — these are the points where the
// soloist itself changes voice, so they crossfade rather than snap except at
// the flagship, where the music turns over with them.
export type BroadsideSection = 0 | 1 | 2 | 3 | 4;

export const BROADSIDE_SCORE_SECTIONS = [
  { index: 0, fromBar: BROADSIDE_BARS.deck },
  { index: 1, fromBar: BROADSIDE_BARS.flank, crossfadeBars: 1 },
  { index: 2, fromBar: BROADSIDE_BARS.belly, crossfadeBars: 1 },
  { index: 3, fromBar: BROADSIDE_BARS.flagship },
  { index: 4, fromBar: BROADSIDE_BARS.trench, crossfadeBars: 1 },
] as const;

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'deck', fromBar: BROADSIDE_BARS.deck, toBar: BROADSIDE_BARS.gauntlet },
  { name: 'gauntlet', fromBar: BROADSIDE_BARS.gauntlet, toBar: BROADSIDE_BARS.flank },
  { name: 'flank', fromBar: BROADSIDE_BARS.flank, toBar: BROADSIDE_BARS.belly },
  { name: 'belly', fromBar: BROADSIDE_BARS.belly, toBar: BROADSIDE_BARS.flagship },
  { name: 'flagship', fromBar: BROADSIDE_BARS.flagship, toBar: BROADSIDE_BARS.fighters },
  { name: 'fighters', fromBar: BROADSIDE_BARS.fighters, toBar: BROADSIDE_BARS.trench },
  { name: 'trench', fromBar: BROADSIDE_BARS.trench, toBar: BROADSIDE_BARS.victory },
  { name: 'victory', fromBar: BROADSIDE_BARS.victory, toBar: BROADSIDE_BARS.end },
] as const;
