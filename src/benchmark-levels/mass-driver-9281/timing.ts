import { createMusicTime } from '../../engine/music-time';

export const MASS_DRIVER_9281_BPM = 120;
export const MASS_DRIVER_9281_STEPS_PER_BAR = 16;
export const MASS_DRIVER_9281_TIME = createMusicTime(MASS_DRIVER_9281_BPM, { stepsPerBar: MASS_DRIVER_9281_STEPS_PER_BAR });

export const MASS_DRIVER_9281_BARS = {
  injection: 0,
  phaseLock: 6,
  overdrive: 14,
  critical: 24,
  muzzle: 30,
  end: 32,
} as const;

export const MASS_DRIVER_9281_MARKERS = MASS_DRIVER_9281_TIME.markers(MASS_DRIVER_9281_BARS);
export const MASS_DRIVER_9281_RUN_DURATION = MASS_DRIVER_9281_MARKERS.end;

export type MassDriverSection = Exclude<keyof typeof MASS_DRIVER_9281_BARS, 'end'>;

export const MASS_DRIVER_9281_SCORE_SECTIONS = [
  { index: 'injection', fromBar: MASS_DRIVER_9281_BARS.injection },
  { index: 'phaseLock', fromBar: MASS_DRIVER_9281_BARS.phaseLock, crossfadeBars: 1 },
  { index: 'overdrive', fromBar: MASS_DRIVER_9281_BARS.overdrive, crossfadeBars: 1 },
  { index: 'critical', fromBar: MASS_DRIVER_9281_BARS.critical },
  { index: 'muzzle', fromBar: MASS_DRIVER_9281_BARS.muzzle },
] as const;

export const MASS_DRIVER_9281_RUN_SECTIONS = [
  { name: 'injection', fromBar: MASS_DRIVER_9281_BARS.injection },
  { name: 'phase-lock', fromBar: MASS_DRIVER_9281_BARS.phaseLock },
  { name: 'overdrive', fromBar: MASS_DRIVER_9281_BARS.overdrive },
  { name: 'critical-charge', fromBar: MASS_DRIVER_9281_BARS.critical },
  { name: 'muzzle', fromBar: MASS_DRIVER_9281_BARS.muzzle },
] as const;
