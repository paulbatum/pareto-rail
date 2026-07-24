import { createMusicTime } from '../../engine/music-time';

export const PRISM_WARM_PALETTE_J3XR_BPM = 96;
export const PRISM_WARM_PALETTE_J3XR_STEPS_PER_BAR = 16;
export const PRISM_WARM_PALETTE_J3XR_TIME = createMusicTime(PRISM_WARM_PALETTE_J3XR_BPM, {
  stepsPerBar: PRISM_WARM_PALETTE_J3XR_STEPS_PER_BAR,
});

export const PRISM_WARM_PALETTE_J3XR_BARS = {
  opening: 0,
  pulse: 2,
  shimmer: 4,
  bloom: 6,
  finale: 10,
  secondOpening: 12,
  secondPulse: 14,
  secondShimmer: 16,
  secondBloom: 18,
  secondFinale: 22,
  end: 24,
} as const;

export const PRISM_WARM_PALETTE_J3XR_MARKERS = PRISM_WARM_PALETTE_J3XR_TIME.markers({
  opening: PRISM_WARM_PALETTE_J3XR_BARS.opening,
  firstGateFan: [0, 1.6],
  firstCometFan: [1, 3.04],
  pulse: PRISM_WARM_PALETTE_J3XR_BARS.pulse,
  firstEchoFan: [3, 1.12],
  shimmer: PRISM_WARM_PALETTE_J3XR_BARS.shimmer,
  secondGateFan: [4, 2.88],
  bloom: PRISM_WARM_PALETTE_J3XR_BARS.bloom,
  secondCometFan: [6, 1.6],
  secondEchoFan: [8, 0.32],
  finale: PRISM_WARM_PALETTE_J3XR_BARS.finale,
  finalGateFan: PRISM_WARM_PALETTE_J3XR_BARS.finale,
  secondOpening: PRISM_WARM_PALETTE_J3XR_BARS.secondOpening,
  secondGateFanCycle: [12, 1.6],
  secondCometFanCycle: [13, 3.04],
  secondPulse: PRISM_WARM_PALETTE_J3XR_BARS.secondPulse,
  secondEchoFanCycle: [15, 1.12],
  secondShimmer: PRISM_WARM_PALETTE_J3XR_BARS.secondShimmer,
  thirdGateFan: [16, 2.88],
  secondBloom: PRISM_WARM_PALETTE_J3XR_BARS.secondBloom,
  thirdCometFan: [18, 1.6],
  thirdEchoFan: [20, 0.32],
  secondFinale: PRISM_WARM_PALETTE_J3XR_BARS.secondFinale,
  secondFinalGateFan: PRISM_WARM_PALETTE_J3XR_BARS.secondFinale,
  end: PRISM_WARM_PALETTE_J3XR_BARS.end,
});

export const PRISM_WARM_PALETTE_J3XR_DURATION_BARS = PRISM_WARM_PALETTE_J3XR_BARS.end;
export const PRISM_WARM_PALETTE_J3XR_RUN_DURATION = PRISM_WARM_PALETTE_J3XR_MARKERS.end;

export type PrismWarmPaletteJ3xrSectionName =
  | 'opening' | 'pulse' | 'shimmer' | 'bloom' | 'finale'
  | 'opening2' | 'pulse2' | 'shimmer2' | 'bloom2' | 'finale2';

export const PRISM_WARM_PALETTE_J3XR_SCORE_SECTIONS = [
  { index: 'opening', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.opening },
  { index: 'pulse', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.pulse },
  { index: 'shimmer', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.shimmer },
  { index: 'bloom', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.bloom },
  { index: 'finale', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.finale },
  { index: 'opening2', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.secondOpening },
  { index: 'pulse2', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.secondPulse },
  { index: 'shimmer2', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.secondShimmer },
  { index: 'bloom2', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.secondBloom },
  { index: 'finale2', fromBar: PRISM_WARM_PALETTE_J3XR_BARS.secondFinale },
] as const;

export const PRISM_WARM_PALETTE_J3XR_ARRANGEMENT_SECTIONS = [
  { name: 'opening', fromBar: 0, toBar: 2 },
  { name: 'pulse', fromBar: 2, toBar: 4 },
  { name: 'shimmer', fromBar: 4, toBar: 6 },
  { name: 'bloom', fromBar: 6, toBar: 10 },
  { name: 'finale', fromBar: 10, toBar: 12 },
  { name: 'opening2', fromBar: 12, toBar: 14 },
  { name: 'pulse2', fromBar: 14, toBar: 16 },
  { name: 'shimmer2', fromBar: 16, toBar: 18 },
  { name: 'bloom2', fromBar: 18, toBar: 22 },
  { name: 'finale2', fromBar: 22, toBar: 24 },
] as const;

export const PRISM_WARM_PALETTE_J3XR_TIMEBASE = {
  bpm: PRISM_WARM_PALETTE_J3XR_BPM,
  beatsPerBar: PRISM_WARM_PALETTE_J3XR_TIME.beatsPerBar,
  stepsPerBar: PRISM_WARM_PALETTE_J3XR_STEPS_PER_BAR,
  beatSeconds: PRISM_WARM_PALETTE_J3XR_TIME.beatSeconds,
  barSeconds: PRISM_WARM_PALETTE_J3XR_TIME.barSeconds,
  stepSeconds: PRISM_WARM_PALETTE_J3XR_TIME.stepSeconds,
} as const;
