import { createMusicTime } from '../../engine/music-time';

export const MASS_DRIVER_BPM = 144;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: 16 });
export const MASS_DRIVER_BARS = 36;
export const MASS_DRIVER_DURATION = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS);

export const MASS_DRIVER_MARKERS = {
  injection: MASS_DRIVER_TIME.bar(0),
  induction: MASS_DRIVER_TIME.bar(8),
  compression: MASS_DRIVER_TIME.bar(16),
  safetyJammed: MASS_DRIVER_TIME.bar(27),
  finalCharge: MASS_DRIVER_TIME.bar(28),
  muzzle: MASS_DRIVER_TIME.bar(36),
};

export const MASS_DRIVER_SECTIONS = [
  { name: 'INJECTION', fromBar: 0 },
  { name: 'INDUCTION', fromBar: 8 },
  { name: 'COMPRESSION', fromBar: 16 },
  { name: 'FINAL CHARGE', fromBar: 28 },
];
