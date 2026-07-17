import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER — 128 BPM, common time, 32 bars = exactly 60 seconds.
// One accelerator ring per quarter-note beat; the gun fires on the downbeat
// of bar 28 whether or not the player is ready.
export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MD_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });
export const MD_BAR = MD_TIME.barSeconds;
export const MD_BEAT = MD_TIME.beatSeconds;

export const MD_BARS = {
  injection: 0,
  stage1: 4,
  stage2: 12,
  interlock: 20,
  shot: 28,
  end: 32,
} as const;

export const MD_MARKERS = MD_TIME.markers({
  injection: MD_BARS.injection,
  stage1: MD_BARS.stage1,
  stage2: MD_BARS.stage2,
  interlock: MD_BARS.interlock,
  shot: MD_BARS.shot,
  end: MD_BARS.end,
});

export const MD_DURATION = MD_MARKERS.end; // 60.0 s
export const SHOT_TIME = MD_MARKERS.shot; // 52.5 s — THE SHOT
export const INTERLOCK_TIME = MD_MARKERS.interlock; // 37.5 s — klaxon

/** Rings span the barrel only: one per beat from the breech to the muzzle. */
export const RING_BEATS = MD_BARS.shot * 4; // 112 crossings

export const MD_RUN_SECTIONS = [
  { name: 'injection', fromBar: MD_BARS.injection, toBar: MD_BARS.stage1 },
  { name: 'stage-1', fromBar: MD_BARS.stage1, toBar: MD_BARS.stage2 },
  { name: 'stage-2', fromBar: MD_BARS.stage2, toBar: MD_BARS.interlock },
  { name: 'interlock', fromBar: MD_BARS.interlock, toBar: MD_BARS.shot },
  { name: 'muzzle', fromBar: MD_BARS.shot, toBar: MD_BARS.end },
] as const;

// Audio score sections. Crossfades lead into the section's fromBar; the shot
// is a hard cut by design (crossfadeBars omitted on `muzzle`).
export const MD_SCORE_SECTIONS = [
  { index: 0, fromBar: MD_BARS.injection },
  { index: 1, fromBar: MD_BARS.stage1, crossfadeBars: 1 },
  { index: 2, fromBar: MD_BARS.stage2, crossfadeBars: 2 },
  { index: 3, fromBar: MD_BARS.interlock, crossfadeBars: 1 },
  { index: 4, fromBar: MD_BARS.shot },
] as const;

export const bar = MD_TIME.bar;
