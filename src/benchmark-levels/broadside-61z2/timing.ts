import { createMusicTime } from '../../engine/music-time';

export const BROADSIDE_61Z2_BPM = 120;
export const BROADSIDE_61Z2_STEPS_PER_BAR = 16;
export const BROADSIDE_61Z2_TIME = createMusicTime(BROADSIDE_61Z2_BPM, {
  stepsPerBar: BROADSIDE_61Z2_STEPS_PER_BAR,
});

export const BROADSIDE_61Z2_BARS = {
  launch: 0,
  skirmish: 4,
  broadside: 8,
  crossfire: 12,
  approach: 16,
  shieldRun: 20,
  shieldBreak: 24,
  trench: 26,
  victory: 30,
} as const;

export const BROADSIDE_61Z2_MARKERS = BROADSIDE_61Z2_TIME.markers(BROADSIDE_61Z2_BARS);
export const BROADSIDE_61Z2_RUN_DURATION = BROADSIDE_61Z2_MARKERS.victory;

export type Broadside61z2Section = 'launch' | 'skirmish' | 'broadside' | 'crossfire' | 'approach' | 'shieldRun' | 'shieldBreak' | 'trench';

export const BROADSIDE_61Z2_SCORE_SECTIONS = [
  { index: 'launch', fromBar: BROADSIDE_61Z2_BARS.launch },
  { index: 'skirmish', fromBar: BROADSIDE_61Z2_BARS.skirmish, crossfadeBars: 1 },
  { index: 'broadside', fromBar: BROADSIDE_61Z2_BARS.broadside, crossfadeBars: 1 },
  { index: 'crossfire', fromBar: BROADSIDE_61Z2_BARS.crossfire, crossfadeBars: 1 },
  { index: 'approach', fromBar: BROADSIDE_61Z2_BARS.approach, crossfadeBars: 1 },
  { index: 'shieldRun', fromBar: BROADSIDE_61Z2_BARS.shieldRun },
  { index: 'shieldBreak', fromBar: BROADSIDE_61Z2_BARS.shieldBreak, crossfadeBars: 1 },
  { index: 'trench', fromBar: BROADSIDE_61Z2_BARS.trench },
] as const;

export const BROADSIDE_61Z2_RUN_SECTIONS = [
  { name: 'launch', fromBar: BROADSIDE_61Z2_BARS.launch },
  { name: 'skirmish', fromBar: BROADSIDE_61Z2_BARS.skirmish },
  { name: 'broadside', fromBar: BROADSIDE_61Z2_BARS.broadside },
  { name: 'crossfire', fromBar: BROADSIDE_61Z2_BARS.crossfire },
  { name: 'approach', fromBar: BROADSIDE_61Z2_BARS.approach },
  { name: 'shield-run', fromBar: BROADSIDE_61Z2_BARS.shieldRun },
  { name: 'shield-break', fromBar: BROADSIDE_61Z2_BARS.shieldBreak },
  { name: 'trench', fromBar: BROADSIDE_61Z2_BARS.trench },
] as const;
