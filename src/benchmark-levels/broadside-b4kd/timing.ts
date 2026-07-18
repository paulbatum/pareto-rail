import { createMusicTime } from '../../engine/music-time';

// BROADSIDE — 140 BPM, 4/4, 35 bars = exactly 60.0 seconds.
// One bar = 60/140*4 ≈ 1.714 s. The run is a single crossing of a fleet
// engagement, and every section boundary lands on a bar line.
export const BROADSIDE_BPM = 140;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });
export const bar = BROADSIDE_TIME.bar;

// The dramatic arc, in bars:
//   0–4    Launch      — catapult off the flagship deck, fanfare, accelerando.
//   4–10   The Gauntlet— into the melee; swarm waves between the hulls.
//   10–16  Broadside   — flat out down a friendly cruiser's flank while her
//                        guns go off overhead; the main theme.
//   16–18  The Eye     — the calm pocket at the heart of the battle. Near silence.
//   18–24  The Belly   — under an enemy warship, raking its turrets.
//   24–29  The Flagship— phase 1: shield generators under point defense.
//   29–31  Escorts     — shield down, fighters pour in, the rail banks around.
//   31–35  The Trench  — dive into the trenchwork; power cores; victory.
export const BROADSIDE_BARS = {
  launch: 0,
  gauntlet: 4,
  broadside: 10,
  eye: 16,
  belly: 18,
  flagship: 24,
  escorts: 29,
  trench: 31,
  end: 35,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers(BROADSIDE_BARS);
export const BROADSIDE_DURATION = BROADSIDE_MARKERS.end;

// Player-instrument sections for the score (timbres and kill lanes).
export const BROADSIDE_SCORE_SECTIONS = [
  { index: 0, fromBar: BROADSIDE_BARS.launch },
  { index: 1, fromBar: BROADSIDE_BARS.broadside, crossfadeBars: 1 },
  { index: 2, fromBar: BROADSIDE_BARS.eye },
  { index: 3, fromBar: BROADSIDE_BARS.belly },
  { index: 4, fromBar: BROADSIDE_BARS.flagship, crossfadeBars: 1 },
  { index: 5, fromBar: BROADSIDE_BARS.trench },
] as const;

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'launch', fromBar: BROADSIDE_BARS.launch, toBar: BROADSIDE_BARS.gauntlet },
  { name: 'gauntlet', fromBar: BROADSIDE_BARS.gauntlet, toBar: BROADSIDE_BARS.broadside },
  { name: 'broadside', fromBar: BROADSIDE_BARS.broadside, toBar: BROADSIDE_BARS.eye },
  { name: 'eye', fromBar: BROADSIDE_BARS.eye, toBar: BROADSIDE_BARS.belly },
  { name: 'belly', fromBar: BROADSIDE_BARS.belly, toBar: BROADSIDE_BARS.flagship },
  { name: 'flagship', fromBar: BROADSIDE_BARS.flagship, toBar: BROADSIDE_BARS.escorts },
  { name: 'escorts', fromBar: BROADSIDE_BARS.escorts, toBar: BROADSIDE_BARS.trench },
  { name: 'trench', fromBar: BROADSIDE_BARS.trench, toBar: BROADSIDE_BARS.end },
] as const;
