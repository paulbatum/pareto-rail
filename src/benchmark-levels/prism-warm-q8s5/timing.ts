import { createMusicTime } from '../../engine/music-time';

export const PRISM_WARM_Q8S5_BPM = 96;
export const PRISM_WARM_Q8S5_STEPS_PER_BAR = 16;
export const PRISM_WARM_Q8S5_TIME = createMusicTime(PRISM_WARM_Q8S5_BPM, { stepsPerBar: PRISM_WARM_Q8S5_STEPS_PER_BAR });

export const PRISM_WARM_Q8S5_TIMEBASE = {
  bpm: PRISM_WARM_Q8S5_BPM,
  beatsPerBar: PRISM_WARM_Q8S5_TIME.beatsPerBar,
  stepsPerBar: PRISM_WARM_Q8S5_STEPS_PER_BAR,
  beatSeconds: PRISM_WARM_Q8S5_TIME.beatSeconds,
  barSeconds: PRISM_WARM_Q8S5_TIME.barSeconds,
  stepSeconds: PRISM_WARM_Q8S5_TIME.stepSeconds,
} as const;

export const PRISM_WARM_Q8S5_BARS = {
  opening: 0,
  pulse: 2,
  shimmer: 4,
  bloom: 6,
  finale: 10,
  end: 12,
} as const;

export const PRISM_WARM_Q8S5_MARKERS = PRISM_WARM_Q8S5_TIME.markers({
  opening: PRISM_WARM_Q8S5_BARS.opening,
  firstGateFan: [0, 1.6],
  firstCometFan: [1, 3.04],
  pulse: PRISM_WARM_Q8S5_BARS.pulse,
  firstEchoFan: [3, 1.12],
  shimmer: PRISM_WARM_Q8S5_BARS.shimmer,
  secondGateFan: [4, 2.88],
  bloom: PRISM_WARM_Q8S5_BARS.bloom,
  secondCometFan: [6, 1.6],
  secondEchoFan: [8, 0.32],
  finale: PRISM_WARM_Q8S5_BARS.finale,
  finalGateFan: PRISM_WARM_Q8S5_BARS.finale,
  end: PRISM_WARM_Q8S5_BARS.end,
});

export const PRISM_WARM_Q8S5_DURATION_BARS = PRISM_WARM_Q8S5_BARS.end;
export const PRISM_WARM_Q8S5_RUN_DURATION = PRISM_WARM_Q8S5_MARKERS.end;

export type PrismSectionName = 'opening' | 'pulse' | 'shimmer' | 'bloom' | 'finale';

export const PRISM_WARM_Q8S5_SCORE_SECTIONS = [
  { index: 'opening', fromBar: PRISM_WARM_Q8S5_BARS.opening },
  { index: 'pulse', fromBar: PRISM_WARM_Q8S5_BARS.pulse },
  { index: 'shimmer', fromBar: PRISM_WARM_Q8S5_BARS.shimmer },
  { index: 'bloom', fromBar: PRISM_WARM_Q8S5_BARS.bloom },
  { index: 'finale', fromBar: PRISM_WARM_Q8S5_BARS.finale },
] as const;

export const PRISM_WARM_Q8S5_ARRANGEMENT_SECTIONS = [
  { name: 'opening', fromBar: PRISM_WARM_Q8S5_BARS.opening, toBar: PRISM_WARM_Q8S5_BARS.pulse },
  { name: 'pulse', fromBar: PRISM_WARM_Q8S5_BARS.pulse, toBar: PRISM_WARM_Q8S5_BARS.shimmer },
  { name: 'shimmer', fromBar: PRISM_WARM_Q8S5_BARS.shimmer, toBar: PRISM_WARM_Q8S5_BARS.bloom },
  { name: 'bloom', fromBar: PRISM_WARM_Q8S5_BARS.bloom, toBar: PRISM_WARM_Q8S5_BARS.finale },
  { name: 'finale', fromBar: PRISM_WARM_Q8S5_BARS.finale, toBar: PRISM_WARM_Q8S5_BARS.end },
] as const;

export const PRISM_WARM_Q8S5_SPAWN_SYNC = {
  bpm: PRISM_WARM_Q8S5_BPM,
  beatsPerBar: PRISM_WARM_Q8S5_TIME.beatsPerBar,
  duration: PRISM_WARM_Q8S5_RUN_DURATION,
  durationBars: PRISM_WARM_Q8S5_DURATION_BARS,
  sections: PRISM_WARM_Q8S5_ARRANGEMENT_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};
