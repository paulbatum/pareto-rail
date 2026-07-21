import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER runs on one idea: the payload passes through exactly one
// accelerator ring on every beat. 144 BPM makes a bar 5/3 s, so 36 bars is
// 60.000 s of run — the rings are placed at runProgress(beat), which makes the
// ring-per-beat contract exact under any speed curve rather than approximate.

export const MASS_DRIVER_BPM = 144;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });
export const MASS_DRIVER_BAR = MASS_DRIVER_TIME.barSeconds;
export const MASS_DRIVER_BEAT = MASS_DRIVER_TIME.beatSeconds;
export const MASS_DRIVER_STEP = MASS_DRIVER_TIME.stepSeconds;

export const BARS = {
  /** Breech: the payload is seated, coils idle, rings are packed tight. */
  breech: 0,
  /** First accelerator stage. Defence drones start threading the coils. */
  accelerate: 4,
  /** Second stage. Rings spread, the sequence doubles, armour arrives. */
  overdrive: 12,
  /** The safety interlocks jam. The firing charge starts building. */
  jam: 20,
  /** Overload: clear four interlocks before the charge peaks. */
  overload: 24,
  /** Charge peak. Either the gun fires, or the barrel does. */
  muzzle: 32,
  end: 36,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers(BARS);

export const MASS_DRIVER_DURATION = MASS_DRIVER_MARKERS.end;
export const ACCELERATE_TIME = MASS_DRIVER_MARKERS.accelerate;
export const OVERDRIVE_TIME = MASS_DRIVER_MARKERS.overdrive;
export const JAM_TIME = MASS_DRIVER_MARKERS.jam;
export const OVERLOAD_TIME = MASS_DRIVER_MARKERS.overload;
export const MUZZLE_TIME = MASS_DRIVER_MARKERS.muzzle;

/** Interlocks are on the field well before the charge peaks; this is the fight window. */
export const INTERLOCK_SPAWN_TIME = MASS_DRIVER_TIME.bar(22);

/** Last beat that still has a ring: the muzzle aperture itself. */
export const LAST_RING_BEAT = Math.round(MUZZLE_TIME / MASS_DRIVER_BEAT);

// Player timbre sections. The jam and the overload share one voice because the
// arrangement turns over hard at bar 20 — the alarm is the cover for the switch.
export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: BARS.breech },
  { index: 1, fromBar: BARS.accelerate, crossfadeBars: 2 },
  { index: 2, fromBar: BARS.overdrive, crossfadeBars: 2 },
  { index: 3, fromBar: BARS.jam, crossfadeBars: 1 },
  { index: 4, fromBar: BARS.muzzle, crossfadeBars: 1 },
] as const;

export const MASS_DRIVER_RUN_SECTIONS = [
  { name: 'breech', fromBar: BARS.breech, toBar: BARS.accelerate },
  { name: 'stage-one', fromBar: BARS.accelerate, toBar: BARS.overdrive },
  { name: 'stage-two', fromBar: BARS.overdrive, toBar: BARS.jam },
  { name: 'jam', fromBar: BARS.jam, toBar: BARS.overload },
  { name: 'overload', fromBar: BARS.overload, toBar: BARS.muzzle },
  { name: 'muzzle', fromBar: BARS.muzzle, toBar: BARS.end },
] as const;

export const bar = MASS_DRIVER_TIME.bar;
export const at = (barIndex: number, beat = 0) => MASS_DRIVER_TIME.bar(barIndex, beat);
