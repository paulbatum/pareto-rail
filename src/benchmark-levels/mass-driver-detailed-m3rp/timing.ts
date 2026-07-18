import { createMusicTime } from '../../engine/music-time';

// Mass Driver is a 60-second ride down the bore of an orbital railgun, scored
// to a locked 128 BPM minimal-techno pulse. One bar is 1.875 s, so 32 bars is
// exactly 60 seconds, and the core conceit — the payload crosses one glowing
// accelerator ring on every quarter-note beat — makes the beat grid the level's
// unit of distance as well as time: four rings per bar, breech to muzzle, and
// the gun fires on the downbeat of bar 28 whether or not the player is ready.
export const MASS_DRIVER_BPM = 128;
export const STEPS_PER_BAR = 16;
export const MUSIC = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: STEPS_PER_BAR });
export const BAR_SECONDS = MUSIC.barSeconds;
export const BEAT_SECONDS = MUSIC.beatSeconds;
export const bar = MUSIC.bar;

export const BARS = {
  /** Breech. The hum fades in, sparse pulse, first drones teach the sweep. */
  injection: 0,
  /** The four-on-floor locks in. */
  stage1: 4,
  /** Rings run violet; density rises; hostiles start shooting back. */
  stage2: 12,
  /** Klaxon — six safety interlocks jammed across the bore. Clear them or die. */
  interlock: 20,
  /** THE SHOT: the charge peaks on this downbeat. Hard cut, not a crossfade. */
  shot: 28,
  /** Open space. Silence winding down. The run ends at exactly 60 s. */
  end: 32,
} as const;

export const MARKERS = MUSIC.markers(BARS);

export const RUN_DURATION = MARKERS.end;
export const STAGE1_TIME = MARKERS.stage1;
export const STAGE2_TIME = MARKERS.stage2;
export const INTERLOCK_TIME = MARKERS.interlock;
export const SHOT_TIME = MARKERS.shot;

/** One accelerator ring per quarter note from breech to muzzle. */
export const RING_COUNT = BARS.shot * 4;
export const ringTime = (beatIndex: number) => beatIndex * BEAT_SECONDS;

// Audio section indexes; crossfades lead into each boundary except the shot,
// which is a hard cut — the gun fires and the barrel simply is not there.
export const SCORE_SECTIONS = [
  { index: 0, fromBar: BARS.injection },
  { index: 1, fromBar: BARS.stage1, crossfadeBars: 1 },
  { index: 2, fromBar: BARS.stage2, crossfadeBars: 2 },
  { index: 3, fromBar: BARS.interlock, crossfadeBars: 1 },
  { index: 4, fromBar: BARS.shot },
] as const;

export const RUN_SECTIONS = [
  { name: 'injection', fromBar: BARS.injection, toBar: BARS.stage1 },
  { name: 'stage-1', fromBar: BARS.stage1, toBar: BARS.stage2 },
  { name: 'stage-2', fromBar: BARS.stage2, toBar: BARS.interlock },
  { name: 'interlock', fromBar: BARS.interlock, toBar: BARS.shot },
  { name: 'muzzle', fromBar: BARS.shot, toBar: BARS.end },
] as const;
