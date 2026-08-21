import { createMusicTime } from '../../engine/music-time';

// Broadside runs at a martial 128 BPM: 32 bars is exactly 60 seconds, so every
// section boundary lands on a whole bar and the pull-out finale fills the last
// two bars of the phrase.
export const BROADSIDE_7HIN_BPM = 128;
export const BROADSIDE_7HIN_STEPS_PER_BAR = 16;
export const BROADSIDE_7HIN_TIME = createMusicTime(BROADSIDE_7HIN_BPM, {
  stepsPerBar: BROADSIDE_7HIN_STEPS_PER_BAR,
});
export const BROADSIDE_7HIN_RUN_DURATION = BROADSIDE_7HIN_TIME.bar(32);

export const BROADSIDE_7HIN_BARS = {
  launch: 0,
  gap: 4,
  corkscrew: 8,
  broadside: 12,
  eye: 16,
  belly: 18,
  approach: 22,
  flagship: 24,
  shieldsDown: 27,
  trench: 29,
  victory: 31,
  end: 32,
} as const;

export const BROADSIDE_7HIN_MARKERS = BROADSIDE_7HIN_TIME.markers({
  launch: 0,
  theGap: BROADSIDE_7HIN_BARS.gap,
  corkscrew: BROADSIDE_7HIN_BARS.corkscrew,
  broadside: BROADSIDE_7HIN_BARS.broadside,
  eyeOfBattle: BROADSIDE_7HIN_BARS.eye,
  bellyRun: BROADSIDE_7HIN_BARS.belly,
  approach: BROADSIDE_7HIN_BARS.approach,
  flagship: BROADSIDE_7HIN_BARS.flagship,
  flagshipReveal: [BROADSIDE_7HIN_BARS.flagship - 1, 3],
  shieldsDown: BROADSIDE_7HIN_BARS.shieldsDown,
  trenchDive: BROADSIDE_7HIN_BARS.trench,
  victory: BROADSIDE_7HIN_BARS.victory,
});

/** Arrangement sections for drums/strings/brass layering (bar ranges). */
export const BROADSIDE_7HIN_SECTIONS = [
  { name: 'launch', fromBar: 0, toBar: 4 },
  { name: 'the-gap', fromBar: 4, toBar: 8 },
  { name: 'corkscrew', fromBar: 8, toBar: 12 },
  { name: 'broadside', fromBar: 12, toBar: 16 },
  { name: 'eye-of-battle', fromBar: 16, toBar: 18 },
  { name: 'belly-run', fromBar: 18, toBar: 22 },
  { name: 'approach', fromBar: 22, toBar: 24 },
  { name: 'flagship', fromBar: 24, toBar: 27 },
  { name: 'shields-down', fromBar: 27, toBar: 29 },
  { name: 'trench', fromBar: 29, toBar: 31 },
  { name: 'victory', fromBar: 31 },
] as const;

/**
 * Player-voice sections: act 1 owns the whole approach, act 2 begins with the
 * enemy belly run (crossfade over two bars), and the boss snaps with the
 * flagship reveal because the arrangement turns over with it.
 */
export type BroadsideSection = 0 | 1 | 2;
export const BROADSIDE_7HIN_SCORE_SECTIONS = [
  { index: 0 as const, fromBar: 0 },
  { index: 1 as const, fromBar: 18, crossfadeBars: 2 },
  { index: 2 as const, fromBar: 24 },
] as const;
