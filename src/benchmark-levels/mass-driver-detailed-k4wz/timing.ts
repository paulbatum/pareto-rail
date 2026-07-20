import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER — 128 BPM, common time, 32 bars = exactly 60 seconds.
// The quarter-note grid is the level's unit of distance as well as time:
// the payload crosses one accelerator ring on every beat, and the gun fires
// on the downbeat of bar 28 whether or not the player is ready.
export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });

export const MASS_DRIVER_BARS = {
  injection: 0,
  stage1: 4,
  stage2: 12,
  breath: 19,
  interlock: 20,
  shot: 28,
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers({
  injection: MASS_DRIVER_BARS.injection,
  stage1: MASS_DRIVER_BARS.stage1,
  stage2: MASS_DRIVER_BARS.stage2,
  interlock: MASS_DRIVER_BARS.interlock,
  shot: MASS_DRIVER_BARS.shot,
  muzzle: [MASS_DRIVER_BARS.shot, 1],
});

/** Active run: 32 bars, 60.000 s. */
export const MASS_DRIVER_RUN_DURATION = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.end);
/** THE SHOT — downbeat of bar 28. Hard cut, not a crossfade. */
export const SHOT_TIME = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.shot);
export const INTERLOCK_TIME = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.interlock);
export const STAGE2_TIME = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.stage2);
export const STAGE1_TIME = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.stage1);

/** Beats in the barrel: ring k is crossed exactly on beat k; ring 112 is the muzzle crown. */
export const MUZZLE_BEAT = MASS_DRIVER_BARS.shot * 4;

// Player-instrument sections (audio timbres + kill lanes).
export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_BARS.injection },
  { index: 1, fromBar: MASS_DRIVER_BARS.stage1, crossfadeBars: 1 },
  { index: 2, fromBar: MASS_DRIVER_BARS.stage2, crossfadeBars: 1 },
  { index: 3, fromBar: MASS_DRIVER_BARS.interlock, crossfadeBars: 1 },
  // THE SHOT is a hard cut: no crossfade into the muzzle.
  { index: 4, fromBar: MASS_DRIVER_BARS.shot },
] as const;

export const MASS_DRIVER_RUN_SECTIONS = [
  { name: 'injection', fromBar: MASS_DRIVER_BARS.injection, toBar: MASS_DRIVER_BARS.stage1 },
  { name: 'stage-1', fromBar: MASS_DRIVER_BARS.stage1, toBar: MASS_DRIVER_BARS.stage2 },
  { name: 'stage-2', fromBar: MASS_DRIVER_BARS.stage2, toBar: MASS_DRIVER_BARS.interlock },
  { name: 'interlock', fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.shot },
  { name: 'muzzle', fromBar: MASS_DRIVER_BARS.shot, toBar: MASS_DRIVER_BARS.end },
] as const;

export const bar = MASS_DRIVER_TIME.bar;
export const BEAT_SECONDS = MASS_DRIVER_TIME.beatSeconds;
