import { createMusicTime } from '../../engine/music-time';

export const WARM_BPM = 96;
export const WARM_STEPS_PER_BAR = 16;
export const WARM_TIME = createMusicTime(WARM_BPM, { stepsPerBar: WARM_STEPS_PER_BAR });

export const WARM_TIMEBASE = {
  bpm: WARM_BPM,
  beatsPerBar: WARM_TIME.beatsPerBar,
  stepsPerBar: WARM_STEPS_PER_BAR,
  beatSeconds: WARM_TIME.beatSeconds,
  barSeconds: WARM_TIME.barSeconds,
  stepSeconds: WARM_TIME.stepSeconds,
} as const;

export const WARM_BARS = {
  opening: 0,
  pulse: 2,
  shimmer: 4,
  bloom: 6,
  finale: 10,
  end: 12,
} as const;

export const WARM_MARKERS = WARM_TIME.markers({
  opening: WARM_BARS.opening,
  firstGateFan: [0, 1.6],
  firstCometFan: [1, 3.04],
  pulse: WARM_BARS.pulse,
  firstEchoFan: [3, 1.12],
  shimmer: WARM_BARS.shimmer,
  secondGateFan: [4, 2.88],
  bloom: WARM_BARS.bloom,
  secondCometFan: [6, 1.6],
  secondEchoFan: [8, 0.32],
  finale: WARM_BARS.finale,
  finalGateFan: WARM_BARS.finale,
  end: WARM_BARS.end,
});

export const WARM_DURATION_BARS = WARM_BARS.end;
export const WARM_RUN_DURATION = WARM_MARKERS.end;

export type WarmSectionName = 'opening' | 'pulse' | 'shimmer' | 'bloom' | 'finale';

export const WARM_SCORE_SECTIONS = [
  { index: 'opening', fromBar: WARM_BARS.opening },
  { index: 'pulse', fromBar: WARM_BARS.pulse },
  { index: 'shimmer', fromBar: WARM_BARS.shimmer },
  { index: 'bloom', fromBar: WARM_BARS.bloom },
  { index: 'finale', fromBar: WARM_BARS.finale },
] as const;

export const WARM_ARRANGEMENT_SECTIONS = [
  { name: 'opening', fromBar: WARM_BARS.opening, toBar: WARM_BARS.pulse },
  { name: 'pulse', fromBar: WARM_BARS.pulse, toBar: WARM_BARS.shimmer },
  { name: 'shimmer', fromBar: WARM_BARS.shimmer, toBar: WARM_BARS.bloom },
  { name: 'bloom', fromBar: WARM_BARS.bloom, toBar: WARM_BARS.finale },
  { name: 'finale', fromBar: WARM_BARS.finale, toBar: WARM_BARS.end },
] as const;

export const WARM_SPAWN_SYNC = {
  bpm: WARM_BPM,
  beatsPerBar: WARM_TIME.beatsPerBar,
  duration: WARM_RUN_DURATION,
  durationBars: WARM_DURATION_BARS,
  sections: WARM_ARRANGEMENT_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};
