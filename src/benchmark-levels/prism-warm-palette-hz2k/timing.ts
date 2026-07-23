import { createMusicTime } from '../../engine/music-time';

export const PRISM_BPM = 96;
export const PRISM_STEPS_PER_BAR = 16;
export const PRISM_TIME = createMusicTime(PRISM_BPM, { stepsPerBar: PRISM_STEPS_PER_BAR });

export const PRISM_TIMEBASE = {
  bpm: PRISM_BPM,
  beatsPerBar: PRISM_TIME.beatsPerBar,
  stepsPerBar: PRISM_STEPS_PER_BAR,
  beatSeconds: PRISM_TIME.beatSeconds,
  barSeconds: PRISM_TIME.barSeconds,
  stepSeconds: PRISM_TIME.stepSeconds,
} as const;

export const PRISM_BARS = {
  opening: 0,
  pulse: 2,
  shimmer: 4,
  bloom: 6,
  finale: 10,
  end: 12,
} as const;

export const PRISM_MARKERS = PRISM_TIME.markers({
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
export const PRISM_RUN_DURATION = PRISM_MARKERS.end;

export type PrismSectionName = 'opening' | 'pulse' | 'shimmer' | 'bloom' | 'finale';

export const PRISM_SCORE_SECTIONS = [
  { index: 'opening', fromBar: PRISM_BARS.opening },
  { index: 'pulse', fromBar: PRISM_BARS.pulse },
  { index: 'shimmer', fromBar: PRISM_BARS.shimmer },
  { index: 'bloom', fromBar: PRISM_BARS.bloom },
  { index: 'finale', fromBar: PRISM_BARS.finale },
] as const;

export const PRISM_ARRANGEMENT_SECTIONS = [
  { name: 'opening', fromBar: PRISM_BARS.opening, toBar: PRISM_BARS.pulse },
  { name: 'pulse', fromBar: PRISM_BARS.pulse, toBar: PRISM_BARS.shimmer },
  { name: 'shimmer', fromBar: PRISM_BARS.shimmer, toBar: PRISM_BARS.bloom },
  { name: 'bloom', fromBar: PRISM_BARS.bloom, toBar: PRISM_BARS.finale },
  { name: 'finale', fromBar: PRISM_BARS.finale, toBar: PRISM_BARS.end },
] as const;

export const PRISM_SPAWN_SYNC = {
  bpm: PRISM_BPM,
  beatsPerBar: PRISM_TIME.beatsPerBar,
  duration: PRISM_RUN_DURATION,
  durationBars: PRISM_DURATION_BARS,
  sections: PRISM_ARRANGEMENT_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};
