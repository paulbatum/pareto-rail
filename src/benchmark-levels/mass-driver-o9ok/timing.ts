import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER runs on one idea: the camera passes exactly one accelerator ring
// per beat, for the whole run. Ring positions are not authored in world space —
// they are sampled from the same rail easing the camera uses, at beat times. So
// "hit a ring on every beat" is true by construction at any speed, and the
// widening ring gaps you see late in the run are literally the acceleration.
//
// 128 BPM, 4/4: one bar = 1.875 s, and 32 bars = exactly 60.000 s.

export const MD_BPM = 128;
export const MD_STEPS_PER_BAR = 16;
export const MD_TIME = createMusicTime(MD_BPM, { stepsPerBar: MD_STEPS_PER_BAR });
export const MD_BAR = MD_TIME.barSeconds;
export const MD_BEAT = MD_TIME.beatSeconds;

export const MD_BARS = {
  breech: 0,
  accel: 8,
  overdrive: 16,
  charge: 22,
  /** Charge peak. Interlocks still standing here detonate the barrel. */
  fire: 30,
  end: 32,
} as const;

export const MD_MARKERS = MD_TIME.markers({
  breech: MD_BARS.breech,
  accel: MD_BARS.accel,
  overdrive: MD_BARS.overdrive,
  charge: MD_BARS.charge,
  fire: MD_BARS.fire,
  end: MD_BARS.end,
});

export const MD_DURATION = MD_MARKERS.end;
export const ACCEL_TIME = MD_MARKERS.accel;
export const OVERDRIVE_TIME = MD_MARKERS.overdrive;
export const CHARGE_TIME = MD_MARKERS.charge;
export const FIRE_TIME = MD_MARKERS.fire;

/** Beats in the run; one accelerator ring is seated on each of them. */
export const MD_TOTAL_BEATS = MD_BARS.end * MD_TIME.beatsPerBar;
/** The muzzle: the last beat that still has a coil on it. Past this it is open space. */
export const MD_MUZZLE_BEAT = MD_BARS.fire * MD_TIME.beatsPerBar;

export const MD_SCORE_SECTIONS = [
  { index: 0, fromBar: MD_BARS.breech },
  { index: 1, fromBar: MD_BARS.accel, crossfadeBars: 2 },
  { index: 2, fromBar: MD_BARS.overdrive, crossfadeBars: 2 },
  { index: 3, fromBar: MD_BARS.charge, crossfadeBars: 2 },
] as const;

export const MD_RUN_SECTIONS = [
  { name: 'breech', fromBar: MD_BARS.breech, toBar: MD_BARS.accel },
  { name: 'accelerate', fromBar: MD_BARS.accel, toBar: MD_BARS.overdrive },
  { name: 'overdrive', fromBar: MD_BARS.overdrive, toBar: MD_BARS.charge },
  { name: 'charge', fromBar: MD_BARS.charge, toBar: MD_BARS.fire },
  { name: 'fire', fromBar: MD_BARS.fire, toBar: MD_BARS.end },
] as const;

export const bar = MD_TIME.bar;
export const beat = MD_TIME.beats;
