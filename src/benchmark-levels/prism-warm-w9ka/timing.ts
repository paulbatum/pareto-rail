import { createMusicTime } from '../../engine/music-time';

export const PRISM_WARM_W9KA_BPM = 96;
export const PRISM_WARM_W9KA_STEPS_PER_BAR = 16;
export const PRISM_WARM_W9KA_TIME = createMusicTime(PRISM_WARM_W9KA_BPM, { stepsPerBar: PRISM_WARM_W9KA_STEPS_PER_BAR });

export const PRISM_WARM_W9KA_TIMEBASE = {
  bpm: PRISM_WARM_W9KA_BPM,
  beatsPerBar: PRISM_WARM_W9KA_TIME.beatsPerBar,
  stepsPerBar: PRISM_WARM_W9KA_STEPS_PER_BAR,
  beatSeconds: PRISM_WARM_W9KA_TIME.beatSeconds,
  barSeconds: PRISM_WARM_W9KA_TIME.barSeconds,
  stepSeconds: PRISM_WARM_W9KA_TIME.stepSeconds,
} as const;

export const PRISM_WARM_W9KA_BARS = {
  opening: 0,
  pulse: 2,
  shimmer: 4,
  bloom: 6,
  finale: 10,
  end: 12,
} as const;

export const PRISM_WARM_W9KA_MARKERS = PRISM_WARM_W9KA_TIME.markers({
  opening: PRISM_WARM_W9KA_BARS.opening,
  firstGateFan: [0, 1.6],
  firstCometFan: [1, 3.04],
  pulse: PRISM_WARM_W9KA_BARS.pulse,
  firstEchoFan: [3, 1.12],
  shimmer: PRISM_WARM_W9KA_BARS.shimmer,
  secondGateFan: [4, 2.88],
  bloom: PRISM_WARM_W9KA_BARS.bloom,
  secondCometFan: [6, 1.6],
  secondEchoFan: [8, 0.32],
  finale: PRISM_WARM_W9KA_BARS.finale,
  finalGateFan: PRISM_WARM_W9KA_BARS.finale,
  end: PRISM_WARM_W9KA_BARS.end,
});

export const PRISM_WARM_W9KA_DURATION_BARS = PRISM_WARM_W9KA_BARS.end;
export const PRISM_WARM_W9KA_RUN_DURATION = PRISM_WARM_W9KA_MARKERS.end;

export type PrismSectionName = 'opening' | 'pulse' | 'shimmer' | 'bloom' | 'finale';

export const PRISM_WARM_W9KA_SCORE_SECTIONS = [
  { index: 'opening', fromBar: PRISM_WARM_W9KA_BARS.opening },
  { index: 'pulse', fromBar: PRISM_WARM_W9KA_BARS.pulse },
  { index: 'shimmer', fromBar: PRISM_WARM_W9KA_BARS.shimmer },
  { index: 'bloom', fromBar: PRISM_WARM_W9KA_BARS.bloom },
  { index: 'finale', fromBar: PRISM_WARM_W9KA_BARS.finale },
] as const;

export const PRISM_WARM_W9KA_ARRANGEMENT_SECTIONS = [
  { name: 'opening', fromBar: PRISM_WARM_W9KA_BARS.opening, toBar: PRISM_WARM_W9KA_BARS.pulse },
  { name: 'pulse', fromBar: PRISM_WARM_W9KA_BARS.pulse, toBar: PRISM_WARM_W9KA_BARS.shimmer },
  { name: 'shimmer', fromBar: PRISM_WARM_W9KA_BARS.shimmer, toBar: PRISM_WARM_W9KA_BARS.bloom },
  { name: 'bloom', fromBar: PRISM_WARM_W9KA_BARS.bloom, toBar: PRISM_WARM_W9KA_BARS.finale },
  { name: 'finale', fromBar: PRISM_WARM_W9KA_BARS.finale, toBar: PRISM_WARM_W9KA_BARS.end },
] as const;

export const PRISM_WARM_W9KA_SPAWN_SYNC = {
  bpm: PRISM_WARM_W9KA_BPM,
  beatsPerBar: PRISM_WARM_W9KA_TIME.beatsPerBar,
  duration: PRISM_WARM_W9KA_RUN_DURATION,
  durationBars: PRISM_WARM_W9KA_DURATION_BARS,
  sections: PRISM_WARM_W9KA_ARRANGEMENT_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};
