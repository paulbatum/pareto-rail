import { createMusicTime } from '../../engine/music-time';

// 128 BPM makes 32 bars land at exactly sixty seconds. Every authored set
// piece starts on the score grid so the battle, the rail, and the orchestra
// can turn over together.
export const BROADSIDE_806F_BPM = 128;
export const BROADSIDE_806F_STEPS_PER_BAR = 16;
export const BROADSIDE_806F_TIME = createMusicTime(BROADSIDE_806F_BPM, {
  stepsPerBar: BROADSIDE_806F_STEPS_PER_BAR,
});

export const BROADSIDE_806F_BARS = {
  launch: 0,
  engagement: 4,
  broadside: 8,
  underbelly: 14,
  eye: 18,
  flagship: 20,
  turn: 24,
  trench: 27,
  victory: 31,
  end: 32,
} as const;

export const BROADSIDE_806F_MARKERS = BROADSIDE_806F_TIME.markers(BROADSIDE_806F_BARS);
export const BROADSIDE_806F_RUN_DURATION = BROADSIDE_806F_MARKERS.end;

export type Broadside806fSection = Exclude<keyof typeof BROADSIDE_806F_BARS, 'end'>;

export const BROADSIDE_806F_SCORE_SECTIONS = [
  { index: 'launch', fromBar: BROADSIDE_806F_BARS.launch },
  { index: 'engagement', fromBar: BROADSIDE_806F_BARS.engagement, crossfadeBars: 1 },
  { index: 'broadside', fromBar: BROADSIDE_806F_BARS.broadside, crossfadeBars: 1 },
  { index: 'underbelly', fromBar: BROADSIDE_806F_BARS.underbelly, crossfadeBars: 1 },
  { index: 'eye', fromBar: BROADSIDE_806F_BARS.eye },
  { index: 'flagship', fromBar: BROADSIDE_806F_BARS.flagship },
  { index: 'turn', fromBar: BROADSIDE_806F_BARS.turn },
  { index: 'trench', fromBar: BROADSIDE_806F_BARS.trench },
  { index: 'victory', fromBar: BROADSIDE_806F_BARS.victory },
] as const;

export const BROADSIDE_806F_RUN_SECTIONS = [
  { name: 'flagship-launch', fromBar: BROADSIDE_806F_BARS.launch },
  { name: 'fleet-engagement', fromBar: BROADSIDE_806F_BARS.engagement },
  { name: 'friendly-broadside', fromBar: BROADSIDE_806F_BARS.broadside },
  { name: 'enemy-underbelly', fromBar: BROADSIDE_806F_BARS.underbelly },
  { name: 'eye-of-battle', fromBar: BROADSIDE_806F_BARS.eye },
  { name: 'flagship-shield-pass', fromBar: BROADSIDE_806F_BARS.flagship },
  { name: 'escort-turn', fromBar: BROADSIDE_806F_BARS.turn },
  { name: 'trench-run', fromBar: BROADSIDE_806F_BARS.trench },
  { name: 'victory-pullback', fromBar: BROADSIDE_806F_BARS.victory },
] as const;
