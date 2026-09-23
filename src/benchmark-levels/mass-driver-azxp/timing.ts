import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER runs on one clock. 128 BPM, 32 bars of 4/4 = exactly 60.0 s,
// and the payload passes through one accelerator ring on every beat — beat k
// is ring k, so the 112th beat is the muzzle.
export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });
export const BEAT = MASS_DRIVER_TIME.beatSeconds;
export const BAR = MASS_DRIVER_TIME.barSeconds;
export const bar = MASS_DRIVER_TIME.bar;

export const MASS_DRIVER_BARS = {
  breech: 0,
  stageOne: 4,
  stageTwo: 12,
  charge: 20,
  muzzle: 28,
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers({
  breech: MASS_DRIVER_BARS.breech,
  stageOne: MASS_DRIVER_BARS.stageOne,
  stageTwo: MASS_DRIVER_BARS.stageTwo,
  charge: MASS_DRIVER_BARS.charge,
  verdict: [MASS_DRIVER_BARS.muzzle - 1, 3],
  muzzle: MASS_DRIVER_BARS.muzzle,
  end: MASS_DRIVER_BARS.end,
});

export const MASS_DRIVER_DURATION = MASS_DRIVER_MARKERS.end;
export const STAGE_ONE_TIME = MASS_DRIVER_MARKERS.stageOne;
export const STAGE_TWO_TIME = MASS_DRIVER_MARKERS.stageTwo;
export const CHARGE_TIME = MASS_DRIVER_MARKERS.charge;
/** Point of no return: the last beat before the peak. Safeties still standing here doom the barrel. */
export const VERDICT_TIME = MASS_DRIVER_MARKERS.verdict;
/** The charge peaks on this downbeat: the gun fires, or the barrel blows. */
export const FIRE_TIME = MASS_DRIVER_MARKERS.muzzle;

/** Ring k is passed on beat k. The muzzle is the last ring. */
export const MUZZLE_RING = MASS_DRIVER_BARS.muzzle * MASS_DRIVER_TIME.beatsPerBar;

export const MASS_DRIVER_SECTIONS = [
  { name: 'breech', fromBar: MASS_DRIVER_BARS.breech, toBar: MASS_DRIVER_BARS.stageOne },
  { name: 'stage-one', fromBar: MASS_DRIVER_BARS.stageOne, toBar: MASS_DRIVER_BARS.stageTwo },
  { name: 'stage-two', fromBar: MASS_DRIVER_BARS.stageTwo, toBar: MASS_DRIVER_BARS.charge },
  { name: 'final-charge', fromBar: MASS_DRIVER_BARS.charge, toBar: MASS_DRIVER_BARS.muzzle },
  { name: 'open-space', fromBar: MASS_DRIVER_BARS.muzzle, toBar: MASS_DRIVER_BARS.end },
] as const;
