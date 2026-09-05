import { createMusicTime } from '../../engine/music-time';

// 120 BPM, 4/4: one bar is 2 s, 60 bars is 120 s. Every beat is a clock tick.
// The pendulum period is 4 s, so one full swing is two bars.
export const ESCAPEMENT_BPM = 120;
export const ESCAPEMENT_STEPS_PER_BAR = 16;
export const ESCAPEMENT_TIME = createMusicTime(ESCAPEMENT_BPM, { stepsPerBar: ESCAPEMENT_STEPS_PER_BAR });
export const ESCAPEMENT_BAR = ESCAPEMENT_TIME.barSeconds;
export const PENDULUM_PERIOD = 2 * ESCAPEMENT_BAR;

export const ESCAPEMENT_BARS = {
  barrel: 0,
  train: 7,
  orrery: 17,
  strike: 26,
  pendulum: 29,
  boss: 42,
  bossDeadline: 56,
  freeRun: 56,
  end: 60,
} as const;

export const ESCAPEMENT_MARKERS = ESCAPEMENT_TIME.markers(ESCAPEMENT_BARS);
export const ESCAPEMENT_DURATION = ESCAPEMENT_MARKERS.end;

export const ESCAPEMENT_SCORE_SECTIONS = [
  { index: 0, fromBar: ESCAPEMENT_BARS.barrel },
  { index: 1, fromBar: ESCAPEMENT_BARS.orrery, crossfadeBars: 2 },
  { index: 2, fromBar: ESCAPEMENT_BARS.strike },
  { index: 3, fromBar: ESCAPEMENT_BARS.pendulum, crossfadeBars: 1 },
  { index: 4, fromBar: ESCAPEMENT_BARS.boss, crossfadeBars: 2 },
  { index: 5, fromBar: ESCAPEMENT_BARS.freeRun },
] as const;

export const ESCAPEMENT_RUN_SECTIONS = [
  { name: 'barrel', fromBar: ESCAPEMENT_BARS.barrel, toBar: ESCAPEMENT_BARS.train },
  { name: 'train', fromBar: ESCAPEMENT_BARS.train, toBar: ESCAPEMENT_BARS.orrery },
  { name: 'orrery', fromBar: ESCAPEMENT_BARS.orrery, toBar: ESCAPEMENT_BARS.strike },
  { name: 'strike', fromBar: ESCAPEMENT_BARS.strike, toBar: ESCAPEMENT_BARS.pendulum },
  { name: 'pendulum', fromBar: ESCAPEMENT_BARS.pendulum, toBar: ESCAPEMENT_BARS.boss },
  { name: 'boss', fromBar: ESCAPEMENT_BARS.boss, toBar: ESCAPEMENT_BARS.freeRun },
  { name: 'free-run', fromBar: ESCAPEMENT_BARS.freeRun, toBar: ESCAPEMENT_BARS.end },
] as const;

export const ESCAPEMENT_SPAWN_SYNC = {
  bpm: ESCAPEMENT_BPM,
  beatsPerBar: ESCAPEMENT_TIME.beatsPerBar,
  duration: ESCAPEMENT_DURATION,
  sections: ESCAPEMENT_RUN_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};

export const bar = ESCAPEMENT_TIME.bar;
