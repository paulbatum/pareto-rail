import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER runs at 144 BPM, and 36 bars is exactly 60.000 seconds. That is
// not a coincidence: the whole level is built on the identity "one accelerator
// ring per beat", so the beat grid, the ring geometry, and the run clock have
// to be the same object. 144 beats = 144 rings = 60 seconds.
export const MASS_DRIVER_BPM = 144;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });
export const MASS_DRIVER_BAR = MASS_DRIVER_TIME.barSeconds;
export const MASS_DRIVER_BEAT = MASS_DRIVER_TIME.beatSeconds;

export const MASS_DRIVER_BARS = {
  /** Breech. The payload seats and the first coils bite. */
  breech: 0,
  /** Acceleration. Defence drones start threading the coils. */
  accel: 6,
  /** Overdrive. Coil spacing opens up, the barrel fights back. */
  overdrive: 14,
  /** Safety fault. The interlocks jam and the firing charge starts building. */
  fault: 22,
  /** Interlock. Kill the jammed safeties before the charge peaks. */
  interlock: 26,
  /** Muzzle. The charge peaks: the gun fires, or the barrel does. */
  muzzle: 34,
  end: 36,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers({
  breech: MASS_DRIVER_BARS.breech,
  accel: MASS_DRIVER_BARS.accel,
  overdrive: MASS_DRIVER_BARS.overdrive,
  fault: MASS_DRIVER_BARS.fault,
  interlock: MASS_DRIVER_BARS.interlock,
  muzzle: MASS_DRIVER_BARS.muzzle,
  end: MASS_DRIVER_BARS.end,
});

export const MASS_DRIVER_DURATION = MASS_DRIVER_MARKERS.end;
export const ACCEL_TIME = MASS_DRIVER_MARKERS.accel;
export const OVERDRIVE_TIME = MASS_DRIVER_MARKERS.overdrive;
export const FAULT_TIME = MASS_DRIVER_MARKERS.fault;
export const INTERLOCK_TIME = MASS_DRIVER_MARKERS.interlock;
/** The firing charge peaks here. Interlocks still standing means the barrel bursts. */
export const MUZZLE_TIME = MASS_DRIVER_MARKERS.muzzle;

/** Total coils in the barrel: one per beat, up to the muzzle. */
export const RING_COUNT = Math.round(MUZZLE_TIME / MASS_DRIVER_BEAT);

// Four timbral sections. The player's instrument, the kill lane, and the
// harmony all step up together at these bars — the gun climbing in pitch.
export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_BARS.breech },
  { index: 1, fromBar: MASS_DRIVER_BARS.overdrive, crossfadeBars: 2 },
  { index: 2, fromBar: MASS_DRIVER_BARS.interlock, crossfadeBars: 2 },
  { index: 3, fromBar: MASS_DRIVER_BARS.muzzle, crossfadeBars: 1 },
] as const;

export const MASS_DRIVER_RUN_SECTIONS = [
  { name: 'breech', fromBar: MASS_DRIVER_BARS.breech, toBar: MASS_DRIVER_BARS.accel },
  { name: 'accel', fromBar: MASS_DRIVER_BARS.accel, toBar: MASS_DRIVER_BARS.overdrive },
  { name: 'overdrive', fromBar: MASS_DRIVER_BARS.overdrive, toBar: MASS_DRIVER_BARS.fault },
  { name: 'fault', fromBar: MASS_DRIVER_BARS.fault, toBar: MASS_DRIVER_BARS.interlock },
  { name: 'interlock', fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.muzzle },
  { name: 'muzzle', fromBar: MASS_DRIVER_BARS.muzzle, toBar: MASS_DRIVER_BARS.end },
] as const;

export const bar = MASS_DRIVER_TIME.bar;
