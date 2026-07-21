import { createMusicTime } from '../../engine/music-time';

export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: 16 });
export const MASS_DRIVER_DURATION = MASS_DRIVER_TIME.bar(32);

export const INJECTION_END = MASS_DRIVER_TIME.bar(4);
export const STAGE_ONE_END = MASS_DRIVER_TIME.bar(12);
export const STAGE_TWO_END = MASS_DRIVER_TIME.bar(20);
export const WARNING_TIME = MASS_DRIVER_TIME.bar(19);
export const INTERLOCK_TIME = MASS_DRIVER_TIME.bar(20);
export const SHOT_TIME = MASS_DRIVER_TIME.bar(28);
export const MUZZLE_END = MASS_DRIVER_DURATION;

export const MASS_DRIVER_MARKERS: Record<string, number> = {
  injection: 0,
  stage1: INJECTION_END,
  stage2: STAGE_ONE_END,
  warning: WARNING_TIME,
  interlocks: INTERLOCK_TIME,
  shot: SHOT_TIME,
  muzzle: SHOT_TIME + MASS_DRIVER_TIME.bar(0.25),
};

export const MASS_DRIVER_SECTIONS = [
  { name: 'Injection', time: 0 },
  { name: 'Stage 1', time: INJECTION_END },
  { name: 'Stage 2', time: STAGE_ONE_END },
  { name: 'Interlocks', time: INTERLOCK_TIME },
  { name: 'The Shot', time: SHOT_TIME },
];

export const bar = (value: number) => MASS_DRIVER_TIME.bar(value);
export const beat = (barIndex: number, beatIndex = 0) => MASS_DRIVER_TIME.bar(barIndex, beatIndex);
