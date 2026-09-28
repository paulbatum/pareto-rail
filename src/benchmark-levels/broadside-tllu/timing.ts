import { createMusicTime } from '../../engine/music-time';

// 128 BPM x 32 bars = exactly 60 seconds. One bar is 1.875 s; the whole run is
// scored in bar-long phrases so every set piece opens on a downbeat.
export const BROADSIDE_TLLU_BPM = 128;
export const BROADSIDE_TLLU_STEPS_PER_BAR = 16;
export const BROADSIDE_TLLU_TIME = createMusicTime(BROADSIDE_TLLU_BPM, { stepsPerBar: BROADSIDE_TLLU_STEPS_PER_BAR });
export const BROADSIDE_TLLU_BARS_TOTAL = 32;
export const BROADSIDE_TLLU_RUN_DURATION = BROADSIDE_TLLU_TIME.bar(BROADSIDE_TLLU_BARS_TOTAL);

/** Movement boundaries, in bars. The rail, speed curve, spawns, and score all key off these. */
export const BARS = {
  launch: 0,
  crossfire: 2,
  crossfirePush: 5.5,
  flank: 9,
  eye: 15,
  belly: 17.5,
  flagship: 21,
  escorts: 24,
  trench: 26,
  victory: 29,
  end: 32,
} as const;

export const BROADSIDE_TLLU_MARKERS = BROADSIDE_TLLU_TIME.markers({
  launch: BARS.launch,
  crossfire: BARS.crossfire,
  broadside: BARS.flank,
  eye: BARS.eye,
  belly: BARS.belly,
  flagship: BARS.flagship,
  escorts: BARS.escorts,
  trench: BARS.trench,
  victory: BARS.victory,
});

export const BROADSIDE_TLLU_SECTIONS = [
  { name: 'launch', fromBar: BARS.launch, toBar: BARS.crossfire },
  { name: 'crossfire', fromBar: BARS.crossfire, toBar: BARS.flank },
  { name: 'broadside', fromBar: BARS.flank, toBar: BARS.eye },
  { name: 'eye', fromBar: BARS.eye, toBar: BARS.belly },
  { name: 'belly', fromBar: BARS.belly, toBar: BARS.flagship },
  { name: 'flagship', fromBar: BARS.flagship, toBar: BARS.escorts },
  { name: 'escorts', fromBar: BARS.escorts, toBar: BARS.trench },
  { name: 'trench', fromBar: BARS.trench, toBar: BARS.victory },
  { name: 'victory', fromBar: BARS.victory, toBar: BARS.end },
] as const;

/** Score sections: what the player's melodic kill lane keys off. */
export type BroadsideSection = 0 | 1 | 2 | 3 | 4 | 5;
export const BROADSIDE_TLLU_SCORE_SECTIONS = [
  { index: 0 as const, fromBar: 0 }, // launch + crossfire: bright heroic pentatonic
  { index: 1 as const, fromBar: BARS.flank, crossfadeBars: 1 }, // broadside: the big tune
  { index: 2 as const, fromBar: BARS.eye, crossfadeBars: 0.5 }, // eye: sparse, high, held
  { index: 3 as const, fromBar: 18, crossfadeBars: 0.5 }, // belly + flagship pass: minor menace
  { index: 4 as const, fromBar: 24 }, // escorts + trench: driving
  { index: 5 as const, fromBar: BARS.victory }, // victory: major
] as const;
