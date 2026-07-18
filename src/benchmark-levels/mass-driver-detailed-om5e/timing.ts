import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER — the gun is the clock.
//
// 128 BPM, common time. One bar = 1.875 s, so 32 bars is exactly 60.000 s and
// the run's 128 quarter-note beats are also its 128 accelerator rings: the
// payload crosses one ring per beat by construction, breech to muzzle.
//
// The whole level hangs off this file: rings, spawns, the speed curve, the
// arrangement, the HUD narration, and the firing deadline all read their bars
// from here so nothing can drift out of phase with anything else.

export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });

export const BEAT_SECONDS = MASS_DRIVER_TIME.beatSeconds;
export const BAR_SECONDS = MASS_DRIVER_TIME.barSeconds;
export const SIXTEENTH_SECONDS = MASS_DRIVER_TIME.stepSeconds;

/** The six moves of the run, in arrangement bars. */
export const MASS_DRIVER_BARS = {
  injection: 0,
  stage1: 4,
  stage2: 12,
  interlock: 20,
  /** THE SHOT — hard cut, not a crossfade. */
  shot: 28,
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers({
  injection: MASS_DRIVER_BARS.injection,
  stage1: MASS_DRIVER_BARS.stage1,
  stage2: MASS_DRIVER_BARS.stage2,
  klaxon: [MASS_DRIVER_BARS.interlock - 1, 0],
  interlock: MASS_DRIVER_BARS.interlock,
  secondRank: [22, 0],
  chargeCritical: [26, 0],
  shot: MASS_DRIVER_BARS.shot,
  muzzle: [MASS_DRIVER_BARS.shot, 2],
});

export const MASS_DRIVER_DURATION = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.end);
export const SHOT_TIME = MASS_DRIVER_MARKERS.shot;

/** Beats that carry an accelerator ring: beat 0 at the breech through the muzzle downbeat. */
export const RING_COUNT = MASS_DRIVER_BARS.shot * MASS_DRIVER_TIME.beatsPerBar + 1;

/** Player-instrument voicing sections. The shot gets no crossfade — it is a cut. */
export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_BARS.injection },
  { index: 1, fromBar: MASS_DRIVER_BARS.stage1, crossfadeBars: 2 },
  { index: 2, fromBar: MASS_DRIVER_BARS.stage2, crossfadeBars: 2 },
  { index: 3, fromBar: MASS_DRIVER_BARS.interlock, crossfadeBars: 2 },
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
