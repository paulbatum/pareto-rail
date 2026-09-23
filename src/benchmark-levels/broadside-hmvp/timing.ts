import { createMusicTime } from '../../engine/music-time';

// BROADSIDE runs on one clock: 136 BPM, 16 steps per bar, 34 bars — exactly
// sixty seconds from the catapult to the last held chord of the victory theme.
export const BROADSIDE_BPM = 136;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });
export const BAR_SECONDS = BROADSIDE_TIME.barSeconds;
export const BEAT_SECONDS = BROADSIDE_TIME.beatSeconds;
export const STEP_SECONDS = BROADSIDE_TIME.stepSeconds;

/** The dramatic arc, in bars. Every section boundary is a musical downbeat. */
export const BARS = {
  deck: 0, // spooling on the flagship's flight deck
  catapult: 1, // the catapult fires on the downbeat
  gaps: 2, // off the bow and into the crossfire
  corkscrewA: 4.5,
  corkscrewB: 6.75,
  broadside: 8, // the long run down a friendly cruiser's flank
  eye: 14, // the eye of the battle: near silence
  belly: 16, // under the keel of an enemy warship
  flagship: 20, // close pass along the enemy flagship: shield generators
  shieldsDown: 24, // shield falls, escorts pour in, the rail comes around
  trench: 26, // dive into the trenchwork: power cores
  victory: 30, // pull out past the breaking flagship
  end: 34,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers({
  catapult: BARS.catapult,
  gaps: BARS.gaps,
  broadside: BARS.broadside,
  eye: BARS.eye,
  belly: BARS.belly,
  flagship: BARS.flagship,
  shieldsDown: BARS.shieldsDown,
  trench: BARS.trench,
  victory: BARS.victory,
  end: BARS.end,
});

export const BROADSIDE_DURATION = BROADSIDE_MARKERS.end;

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'launch', fromBar: BARS.deck, toBar: BARS.gaps },
  { name: 'the-gaps', fromBar: BARS.gaps, toBar: BARS.broadside },
  { name: 'broadside-run', fromBar: BARS.broadside, toBar: BARS.eye },
  { name: 'the-eye', fromBar: BARS.eye, toBar: BARS.belly },
  { name: 'belly-run', fromBar: BARS.belly, toBar: BARS.flagship },
  { name: 'flagship-shields', fromBar: BARS.flagship, toBar: BARS.shieldsDown },
  { name: 'come-around', fromBar: BARS.shieldsDown, toBar: BARS.trench },
  { name: 'trench', fromBar: BARS.trench, toBar: BARS.victory },
  { name: 'victory', fromBar: BARS.victory, toBar: BARS.end },
] as const;

/** Score sections drive kill lanes and the player's instrument voicing. */
export const SCORE_SECTION = {
  gaps: 0,
  broadside: 1,
  eye: 2,
  belly: 3,
  flagship: 4,
  trench: 5,
  victory: 6,
} as const;
export type ScoreSectionIndex = typeof SCORE_SECTION[keyof typeof SCORE_SECTION];

export const BROADSIDE_SCORE_SECTIONS = [
  { index: SCORE_SECTION.gaps, fromBar: BARS.deck },
  { index: SCORE_SECTION.broadside, fromBar: BARS.broadside },
  { index: SCORE_SECTION.eye, fromBar: BARS.eye },
  { index: SCORE_SECTION.belly, fromBar: BARS.belly, crossfadeBars: 1 },
  { index: SCORE_SECTION.flagship, fromBar: BARS.flagship },
  { index: SCORE_SECTION.trench, fromBar: BARS.trench },
  { index: SCORE_SECTION.victory, fromBar: BARS.victory },
] as const;

export const bar = BROADSIDE_TIME.bar;
export const step = BROADSIDE_TIME.step;
