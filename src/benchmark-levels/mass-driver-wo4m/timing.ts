import { createMusicTime } from '../../engine/music-time';

// Mass Driver runs at 128 BPM in common time: one bar = 1.875 s, so the
// 32-bar arrangement is exactly the 60-second run. The core conceit — the
// payload crosses one accelerator ring on every beat — makes the quarter-note
// grid the level's unit of distance as well as time: 4 rings per bar,
// 112 rings from breech to muzzle, and the gun fires on the downbeat of
// bar 28 whether or not the player survives what happens next.
export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });
export const MASS_DRIVER_BAR = MASS_DRIVER_TIME.barSeconds;
export const BEAT_SECONDS = MASS_DRIVER_TIME.beatSeconds;

export const MASS_DRIVER_BARS = {
  /** Breech: the payload is chambered, the hum fades in, first drones. */
  injection: 0,
  /** First-stage acceleration: the pulse locks in. */
  stage1: 4,
  /** Second-stage acceleration: hum climbs, rings run violet. */
  stage2: 12,
  /** The jammed safety interlocks — clear all six before the charge peaks. */
  interlock: 20,
  /** Charge peak. The gun fires (or the barrel does not survive). */
  shot: 28,
  /** Open space, silence, done. */
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers(MASS_DRIVER_BARS);

export const MASS_DRIVER_DURATION = MASS_DRIVER_MARKERS.end;
export const STAGE1_TIME = MASS_DRIVER_MARKERS.stage1;
export const STAGE2_TIME = MASS_DRIVER_MARKERS.stage2;
export const INTERLOCK_TIME = MASS_DRIVER_MARKERS.interlock;
export const SHOT_TIME = MASS_DRIVER_MARKERS.shot;

/** Accelerator rings sit on every quarter note of the barrel section. */
export const RING_BEATS = MASS_DRIVER_BARS.shot * 4;
export const ringBeatTime = (beat: number) => beat * BEAT_SECONDS;

export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_BARS.injection },
  { index: 1, fromBar: MASS_DRIVER_BARS.stage1, crossfadeBars: 1 },
  { index: 2, fromBar: MASS_DRIVER_BARS.stage2, crossfadeBars: 2 },
  { index: 3, fromBar: MASS_DRIVER_BARS.interlock, crossfadeBars: 1 },
  // The shot is a hard cut, not a crossfade: the gun fires and the world ends.
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
