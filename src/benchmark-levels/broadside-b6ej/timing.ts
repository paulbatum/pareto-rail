import { createMusicTime } from '../../engine/music-time';

export const BROADSIDE_B6EJ_BPM = 144;
export const BROADSIDE_B6EJ_STEPS_PER_BAR = 16;
export const BROADSIDE_B6EJ_TIME = createMusicTime(BROADSIDE_B6EJ_BPM, { stepsPerBar: BROADSIDE_B6EJ_STEPS_PER_BAR });
export const BROADSIDE_B6EJ_RUN_DURATION = BROADSIDE_B6EJ_TIME.bar(36); // exactly 60 seconds

export const BROADSIDE_B6EJ_BARS = {
  launch: 0,
  melee: 4,
  friendlyBroadside: 10,
  enemyBelly: 16,
  eye: 22,
  flagship: 26,
  shieldBreak: 30,
  trench: 33,
  victory: 35,
  end: 36,
} as const;

export const BROADSIDE_B6EJ_MARKERS = BROADSIDE_B6EJ_TIME.markers({
  launch: 0,
  fleetMelee: 4,
  friendlyBroadside: 10,
  enemyBelly: 16,
  eyeOfBattle: 22,
  flagshipPass: 26,
  shieldBreak: 30,
  trenchDive: 33,
  victoryPullback: 35,
});

export const BROADSIDE_B6EJ_SECTIONS = [
  { name: 'flagship-launch', fromBar: 0, toBar: 4 },
  { name: 'fleet-melee', fromBar: 4, toBar: 10 },
  { name: 'friendly-broadside', fromBar: 10, toBar: 16 },
  { name: 'enemy-belly', fromBar: 16, toBar: 22 },
  { name: 'eye-of-battle', fromBar: 22, toBar: 26 },
  { name: 'shield-pass', fromBar: 26, toBar: 30 },
  { name: 'escort-turn', fromBar: 30, toBar: 33 },
  { name: 'trench-dive', fromBar: 33, toBar: 35 },
  { name: 'victory-pullback', fromBar: 35, toBar: 36 },
] as const;

export type BroadsideScoreSection = 0 | 1 | 2 | 3 | 4;
export const BROADSIDE_B6EJ_SCORE_SECTIONS = [
  { index: 0 as const, fromBar: 0 },
  { index: 1 as const, fromBar: 4 },
  { index: 2 as const, fromBar: 10 },
  { index: 3 as const, fromBar: 22 },
  { index: 4 as const, fromBar: 26 },
] as const;
