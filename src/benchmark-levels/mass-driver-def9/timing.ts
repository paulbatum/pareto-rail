import { createMusicTime } from '../../engine/music-time';

export const MASS_DRIVER_DEF9_BPM = 128;
export const MASS_DRIVER_DEF9_STEPS_PER_BAR = 16;
export const MASS_DRIVER_DEF9_TIME = createMusicTime(MASS_DRIVER_DEF9_BPM, {
  stepsPerBar: MASS_DRIVER_DEF9_STEPS_PER_BAR,
});

export const MASS_DRIVER_DEF9_BARS = {
  injection: 0,
  induction: 8,
  redline: 16,
  interlocks: 23,
  launch: 31,
  end: 32,
} as const;

export const MASS_DRIVER_DEF9_MARKERS = MASS_DRIVER_DEF9_TIME.markers(MASS_DRIVER_DEF9_BARS);
export const MASS_DRIVER_DEF9_RUN_DURATION = MASS_DRIVER_DEF9_MARKERS.end;

export const MASS_DRIVER_DEF9_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_DEF9_BARS.injection },
  { index: 1, fromBar: MASS_DRIVER_DEF9_BARS.induction, crossfadeBars: 1 },
  { index: 2, fromBar: MASS_DRIVER_DEF9_BARS.redline, crossfadeBars: 1 },
  { index: 3, fromBar: MASS_DRIVER_DEF9_BARS.interlocks },
] as const;

export const MASS_DRIVER_DEF9_RUN_SECTIONS = [
  { name: 'injection', fromBar: MASS_DRIVER_DEF9_BARS.injection, toBar: MASS_DRIVER_DEF9_BARS.induction },
  { name: 'induction', fromBar: MASS_DRIVER_DEF9_BARS.induction, toBar: MASS_DRIVER_DEF9_BARS.redline },
  { name: 'redline', fromBar: MASS_DRIVER_DEF9_BARS.redline, toBar: MASS_DRIVER_DEF9_BARS.interlocks },
  { name: 'safety interlocks', fromBar: MASS_DRIVER_DEF9_BARS.interlocks, toBar: MASS_DRIVER_DEF9_BARS.launch },
  { name: 'launch', fromBar: MASS_DRIVER_DEF9_BARS.launch, toBar: MASS_DRIVER_DEF9_BARS.end },
] as const;

export const MASS_DRIVER_DEF9_SPAWN_SYNC = {
  bpm: MASS_DRIVER_DEF9_BPM,
  beatsPerBar: MASS_DRIVER_DEF9_TIME.beatsPerBar,
  duration: MASS_DRIVER_DEF9_RUN_DURATION,
  sections: MASS_DRIVER_DEF9_RUN_SECTIONS.map(({ name, fromBar, toBar }) => ({ name, fromBar, toBar })),
};
