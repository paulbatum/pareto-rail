import { createMusicTime } from '../../engine/music-time';

export const PRISM_WARM_T2QX_BPM = 96;
export const PRISM_WARM_T2QX_STEPS_PER_BAR = 16;
export const PRISM_WARM_T2QX_TIME = createMusicTime(PRISM_WARM_T2QX_BPM, { stepsPerBar: PRISM_WARM_T2QX_STEPS_PER_BAR });

export const PRISM_WARM_T2QX_TIMEBASE = {
  bpm: PRISM_WARM_T2QX_BPM,
  beatsPerBar: PRISM_WARM_T2QX_TIME.beatsPerBar,
  stepsPerBar: PRISM_WARM_T2QX_STEPS_PER_BAR,
  beatSeconds: PRISM_WARM_T2QX_TIME.beatSeconds,
  barSeconds: PRISM_WARM_T2QX_TIME.barSeconds,
  stepSeconds: PRISM_WARM_T2QX_TIME.stepSeconds,
} as const;

export const PRISM_BARS = {
  opening: 0,
  pulse: 2,
  shimmer: 4,
  bloom: 6,
  finale: 10,
  end: 12,
} as const;

export const PRISM_WARM_T2QX_MARKERS = PRISM_WARM_T2QX_TIME.markers({
  opening: PRISM_BARS.opening,
  firstGateFan: [0, 1.6],
  firstCometFan: [1, 3.04],
  pulse: PRISM_BARS.pulse,
  firstEchoFan: [3, 1.12],
  shimmer: PRISM_BARS.shimmer,
  secondGateFan: [4, 2.88],
  bloom: PRISM_BARS.bloom,
  secondCometFan: [6, 1.6],
  secondEchoFan: [8, 0.32],
  finale: PRISM_BARS.finale,
  finalGateFan: PRISM_BARS.finale,
  end: PRISM_BARS.end,
});

export const PRISM_DURATION_BARS = PRISM_BARS.end;
export const PRISM_WARM_T2QX_RUN_DURATION = PRISM_WARM_T2QX_MARKERS.end;

export type PrismWarmSectionName = 'opening' | 'pulse' | 'shimmer' | 'bloom' | 'finale';

export const PRISM_WARM_T2QX_SCORE_SECTIONS = [
  { index: 'opening', fromBar: PRISM_BARS.opening },
  { index: 'pulse', fromBar: PRISM_BARS.pulse },
  { index: 'shimmer', fromBar: PRISM_BARS.shimmer },
  { index: 'bloom', fromBar: PRISM_BARS.bloom },
  { index: 'finale', fromBar: PRISM_BARS.finale },
] as const;

export const PRISM_WARM_T2QX_ARRANGEMENT_SECTIONS = [
  { name: 'opening', fromBar: PRISM_BARS.opening, toBar: PRISM_BARS.pulse },
  { name: 'pulse', fromBar: PRISM_BARS.pulse, toBar: PRISM_BARS.shimmer },
  { name: 'shimmer', fromBar: PRISM_BARS.shimmer, toBar: PRISM_BARS.bloom },
  { name: 'bloom', fromBar: PRISM_BARS.bloom, toBar: PRISM_BARS.finale },
  { name: 'finale', fromBar: PRISM_BARS.finale, toBar: PRISM_BARS.end },
] as const;

export const PRISM_SPAWN_SYNC = {
  bpm: PRISM_WARM_T2QX_BPM,
  beatsPerBar: PRISM_WARM_T2QX_TIME.beatsPerBar,
  duration: PRISM_WARM_T2QX_RUN_DURATION,
  durationBars: PRISM_DURATION_BARS,
  sections: PRISM_WARM_T2QX_ARRANGEMENT_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};
