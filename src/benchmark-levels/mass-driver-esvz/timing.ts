import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER runs at 128 BPM so that 32 bars are exactly 60.000 seconds and
// one accelerator ring passes on every beat. The whole level hangs off this
// identity: ring positions, spawn choreography, the charge deadline, and the
// launch all live on the same beat grid.
export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MD_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });

export const MD_BARS = {
  injection: 0,
  acceleration: 8,
  overdrive: 16,
  charge: 24,
  fire: 30,
  end: 32,
} as const;

export const MD_MARKERS = MD_TIME.markers({
  injection: MD_BARS.injection,
  acceleration: MD_BARS.acceleration,
  overdrive: MD_BARS.overdrive,
  charge: MD_BARS.charge,
  fire: MD_BARS.fire,
  end: MD_BARS.end,
});

export const MD_DURATION = MD_MARKERS.end;
/** The charge peaks and the gun fires (or the breech detonates) here. */
export const FIRE_TIME = MD_MARKERS.fire;
export const CHARGE_TIME = MD_MARKERS.charge;
/** Interlock collar reveal: two beats before the charge section drops. */
export const INTERLOCK_TIME = MD_TIME.bar(22, 2);

/** One ring per beat through the barrel; the muzzle collar is ring FIRE_BEAT. */
export const BEAT_SECONDS = MD_TIME.beatSeconds;
export const FIRE_BEAT = MD_BARS.fire * MD_TIME.beatsPerBar;

export const MD_SCORE_SECTIONS = [
  { index: 0, fromBar: MD_BARS.injection },
  { index: 1, fromBar: MD_BARS.acceleration, crossfadeBars: 1 },
  { index: 2, fromBar: MD_BARS.overdrive, crossfadeBars: 1 },
  { index: 3, fromBar: MD_BARS.charge },
] as const;

export const MD_RUN_SECTIONS = [
  { name: 'injection', fromBar: MD_BARS.injection, toBar: MD_BARS.acceleration },
  { name: 'acceleration', fromBar: MD_BARS.acceleration, toBar: MD_BARS.overdrive },
  { name: 'overdrive', fromBar: MD_BARS.overdrive, toBar: MD_BARS.charge },
  { name: 'charge', fromBar: MD_BARS.charge, toBar: MD_BARS.fire },
  { name: 'launch', fromBar: MD_BARS.fire, toBar: MD_BARS.end },
] as const;

export const bar = MD_TIME.bar;
