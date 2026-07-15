import { createMusicTime } from '../../engine/music-time';

export const PRISM_WARM_M7DZ_BPM = 96;
export const PRISM_WARM_M7DZ_STEPS_PER_BAR = 16;
export const PRISM_WARM_M7DZ_TIME = createMusicTime(PRISM_WARM_M7DZ_BPM, { stepsPerBar: PRISM_WARM_M7DZ_STEPS_PER_BAR });

export const PRISM_WARM_M7DZ_TIMEBASE = {
  bpm: PRISM_WARM_M7DZ_BPM,
  beatsPerBar: PRISM_WARM_M7DZ_TIME.beatsPerBar,
  stepsPerBar: PRISM_WARM_M7DZ_STEPS_PER_BAR,
  beatSeconds: PRISM_WARM_M7DZ_TIME.beatSeconds,
  barSeconds: PRISM_WARM_M7DZ_TIME.barSeconds,
  stepSeconds: PRISM_WARM_M7DZ_TIME.stepSeconds,
} as const;

export const PRISM_WARM_M7DZ_BARS = {
  opening: 0,
  pulse: 2,
  shimmer: 4,
  bloom: 6,
  finale: 10,
  end: 12,
} as const;

export const PRISM_WARM_M7DZ_MARKERS = PRISM_WARM_M7DZ_TIME.markers({
  opening: PRISM_WARM_M7DZ_BARS.opening,
  firstGateFan: [0, 1.6],
  firstCometFan: [1, 3.04],
  pulse: PRISM_WARM_M7DZ_BARS.pulse,
  firstEchoFan: [3, 1.12],
  shimmer: PRISM_WARM_M7DZ_BARS.shimmer,
  secondGateFan: [4, 2.88],
  bloom: PRISM_WARM_M7DZ_BARS.bloom,
  secondCometFan: [6, 1.6],
  secondEchoFan: [8, 0.32],
  finale: PRISM_WARM_M7DZ_BARS.finale,
  finalGateFan: PRISM_WARM_M7DZ_BARS.finale,
  end: PRISM_WARM_M7DZ_BARS.end,
});

export const PRISM_WARM_M7DZ_DURATION_BARS = PRISM_WARM_M7DZ_BARS.end;
export const PRISM_WARM_M7DZ_RUN_DURATION = PRISM_WARM_M7DZ_MARKERS.end;

export type PrismWarmM7dzSectionName = 'opening' | 'pulse' | 'shimmer' | 'bloom' | 'finale';

export const PRISM_WARM_M7DZ_SCORE_SECTIONS = [
  { index: 'opening' as const, fromBar: PRISM_WARM_M7DZ_BARS.opening },
  { index: 'pulse' as const, fromBar: PRISM_WARM_M7DZ_BARS.pulse },
  { index: 'shimmer' as const, fromBar: PRISM_WARM_M7DZ_BARS.shimmer },
  { index: 'bloom' as const, fromBar: PRISM_WARM_M7DZ_BARS.bloom },
  { index: 'finale' as const, fromBar: PRISM_WARM_M7DZ_BARS.finale },
] as const;

export const PRISM_WARM_M7DZ_ARRANGEMENT_SECTIONS = [
  { name: 'opening' as const, fromBar: PRISM_WARM_M7DZ_BARS.opening, toBar: PRISM_WARM_M7DZ_BARS.pulse },
  { name: 'pulse' as const, fromBar: PRISM_WARM_M7DZ_BARS.pulse, toBar: PRISM_WARM_M7DZ_BARS.shimmer },
  { name: 'shimmer' as const, fromBar: PRISM_WARM_M7DZ_BARS.shimmer, toBar: PRISM_WARM_M7DZ_BARS.bloom },
  { name: 'bloom' as const, fromBar: PRISM_WARM_M7DZ_BARS.bloom, toBar: PRISM_WARM_M7DZ_BARS.finale },
  { name: 'finale' as const, fromBar: PRISM_WARM_M7DZ_BARS.finale, toBar: PRISM_WARM_M7DZ_BARS.end },
] as const;

export const PRISM_WARM_M7DZ_SPAWN_SYNC = {
  bpm: PRISM_WARM_M7DZ_BPM,
  beatsPerBar: PRISM_WARM_M7DZ_TIME.beatsPerBar,
  duration: PRISM_WARM_M7DZ_RUN_DURATION,
  durationBars: PRISM_WARM_M7DZ_DURATION_BARS,
  sections: PRISM_WARM_M7DZ_ARRANGEMENT_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};