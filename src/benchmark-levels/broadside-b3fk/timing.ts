import { createMusicTime } from '../../engine/music-time';

export const BROADSIDE_B3FK_BPM = 120;
export const BROADSIDE_B3FK_STEPS_PER_BAR = 16;
export const BROADSIDE_B3FK_TIME = createMusicTime(BROADSIDE_B3FK_BPM, {
  stepsPerBar: BROADSIDE_B3FK_STEPS_PER_BAR,
});

export const BROADSIDE_B3FK_BARS = {
  launch: 0,
  melee: 4,
  flank: 9,
  belly: 13,
  eye: 16,
  flagship: 18,
  shieldBreak: 23,
  secondPass: 25,
  trench: 26,
  victory: 29,
  end: 30,
} as const;

export const BROADSIDE_B3FK_RUN_DURATION = BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.end);

export const BROADSIDE_B3FK_MARKERS = {
  launch: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.launch),
  melee: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.melee),
  broadside: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.flank),
  enemyBelly: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.belly),
  eye: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.eye),
  flagship: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.flagship),
  shieldBreak: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.shieldBreak),
  secondPass: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.secondPass),
  trench: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.trench),
  victory: BROADSIDE_B3FK_TIME.bar(BROADSIDE_B3FK_BARS.victory),
} as const;

export type BroadsideSection = 'launch' | 'engagement' | 'broadside' | 'eye' | 'flagship' | 'trench' | 'victory';

export const BROADSIDE_B3FK_SCORE_SECTIONS = [
  { index: 'launch' as const, fromBar: 0 },
  { index: 'engagement' as const, fromBar: 4, crossfadeBars: 0.5 },
  { index: 'broadside' as const, fromBar: 9, crossfadeBars: 0.5 },
  { index: 'eye' as const, fromBar: 16 },
  { index: 'flagship' as const, fromBar: 18 },
  { index: 'trench' as const, fromBar: 26 },
  { index: 'victory' as const, fromBar: 29 },
] as const;

export const BROADSIDE_B3FK_RUN_SECTIONS = [
  { name: 'Deck launch', fromBar: 0 },
  { name: 'Fleet engagement', fromBar: 4 },
  { name: 'Cruiser broadside', fromBar: 9 },
  { name: 'Eye of battle', fromBar: 16 },
  { name: 'Flagship shields', fromBar: 18 },
  { name: 'Core trench', fromBar: 26 },
  { name: 'Enemy line breaks', fromBar: 29 },
];
