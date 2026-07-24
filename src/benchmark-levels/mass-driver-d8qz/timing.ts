import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER runs on a locked 128 BPM pulse: one bar is 1.875 s, one beat is
// 0.46875 s, and 32 bars are exactly 60.000 s. That exactness matters — the
// accelerator rings are placed at the rail position the camera occupies on each
// beat, so the tempo grid and the barrel geometry are the same object.

export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });
export const MASS_DRIVER_BAR_SECONDS = MASS_DRIVER_TIME.barSeconds;
export const MASS_DRIVER_BEAT_SECONDS = MASS_DRIVER_TIME.beatSeconds;

export const MASS_DRIVER_BARS = {
  breech: 0,
  cold: 2,
  drive: 8,
  arc: 14,
  fault: 20,
  charge: 24,
  launch: 28,
  muzzle: 30,
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers({
  breech: MASS_DRIVER_BARS.breech,
  cold: MASS_DRIVER_BARS.cold,
  drive: MASS_DRIVER_BARS.drive,
  arc: MASS_DRIVER_BARS.arc,
  fault: MASS_DRIVER_BARS.fault,
  charge: MASS_DRIVER_BARS.charge,
  launch: MASS_DRIVER_BARS.launch,
  muzzle: MASS_DRIVER_BARS.muzzle,
  end: MASS_DRIVER_BARS.end,
});

export const MASS_DRIVER_DURATION = MASS_DRIVER_MARKERS.end;
/** Bar 20: the safety interlocks jam and the firing charge starts building. */
export const FAULT_TIME = MASS_DRIVER_MARKERS.fault;
/** Bar 24: the charge is past the point where it can be bled off. */
export const CHARGE_TIME = MASS_DRIVER_MARKERS.charge;
/** Bar 28: the charge peaks. Interlocks clear → the gun fires. Otherwise the barrel does. */
export const LAUNCH_TIME = MASS_DRIVER_MARKERS.launch;
/** Bar 30: the muzzle. The last ring, the last kick, then open space. */
export const MUZZLE_TIME = MASS_DRIVER_MARKERS.muzzle;

/** Player timbre / kill-lane sections. Crossfades land inside the bar before the change. */
export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_BARS.breech },
  { index: 1, fromBar: MASS_DRIVER_BARS.drive, crossfadeBars: 2 },
  { index: 2, fromBar: MASS_DRIVER_BARS.fault, crossfadeBars: 2 },
  { index: 3, fromBar: MASS_DRIVER_BARS.launch, crossfadeBars: 1 },
] as const;

export const MASS_DRIVER_RUN_SECTIONS = [
  { name: 'breech', fromBar: MASS_DRIVER_BARS.breech, toBar: MASS_DRIVER_BARS.cold },
  { name: 'cold-barrel', fromBar: MASS_DRIVER_BARS.cold, toBar: MASS_DRIVER_BARS.drive },
  { name: 'drive', fromBar: MASS_DRIVER_BARS.drive, toBar: MASS_DRIVER_BARS.arc },
  { name: 'arc-phase', fromBar: MASS_DRIVER_BARS.arc, toBar: MASS_DRIVER_BARS.fault },
  { name: 'fault', fromBar: MASS_DRIVER_BARS.fault, toBar: MASS_DRIVER_BARS.charge },
  { name: 'charge', fromBar: MASS_DRIVER_BARS.charge, toBar: MASS_DRIVER_BARS.launch },
  { name: 'launch', fromBar: MASS_DRIVER_BARS.launch, toBar: MASS_DRIVER_BARS.muzzle },
  { name: 'void', fromBar: MASS_DRIVER_BARS.muzzle, toBar: MASS_DRIVER_BARS.end },
] as const;

export const bar = MASS_DRIVER_TIME.bar;
export const step = MASS_DRIVER_TIME.step;
