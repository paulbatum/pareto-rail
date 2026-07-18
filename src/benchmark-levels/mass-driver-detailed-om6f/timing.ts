import { createMusicTime } from '../../engine/music-time';
import { createSpeedProfile, type SpeedKey } from '../../engine/speed-profile';

// Mass Driver is a gun, and the gun keeps time. 128 BPM in common time makes a
// bar exactly 1.875 s, so 32 bars is exactly 60 seconds and the payload crosses
// one accelerator ring on every quarter note. Everything below — the section
// map, the acceleration curve, the ring lattice — is derived from that one fact
// rather than restated, so the beat grid and the level's geometry cannot drift
// apart.

export const MD_BPM = 128;
export const MD_STEPS_PER_BAR = 16;
export const MD_TIME = createMusicTime(MD_BPM, { stepsPerBar: MD_STEPS_PER_BAR });

export const MD_BARS = {
  injection: 0,
  stage1: 4,
  stage2: 12,
  klaxon: 19,
  interlock: 20,
  shot: 28,
  end: 32,
} as const;

export const MD_RUN_DURATION = MD_TIME.bar(MD_BARS.end); // 60.000 s
export const MD_SHOT_TIME = MD_TIME.bar(MD_BARS.shot); // 52.500 s
export const MD_KLAXON_TIME = MD_TIME.bar(MD_BARS.klaxon);
export const MD_INTERLOCK_TIME = MD_TIME.bar(MD_BARS.interlock);
export const MD_BEAT_SECONDS = MD_TIME.beatSeconds;

/** Rings run breech to muzzle, one per beat, inclusive of both ends. */
export const MD_RING_COUNT = MD_BARS.shot * MD_TIME.beatsPerBar + 1; // 113

export const MD_MARKERS = MD_TIME.markers({
  injection: MD_BARS.injection,
  stage1: MD_BARS.stage1,
  stage2: MD_BARS.stage2,
  klaxon: MD_BARS.klaxon,
  interlock: MD_BARS.interlock,
  shot: MD_BARS.shot,
  muzzle: [MD_BARS.shot, 1],
});

// The bore. Radius 12 is wide enough that a wall-riding coil sits near the
// frame rim at engagement range, which is what keeps the reticle sweeping.
export const MD_BORE_RADIUS = 12;
export const MD_RAIL_LENGTH = 5100;

/**
 * The gun only ever speeds up. Factors are relative; the profile normalizes its
 * own integral, so the absolute pace comes from MD_RAIL_LENGTH. The pair of
 * keys straddling bar 28 is THE SHOT: a near-instant ~3x surge, authored as two
 * keys 80 ms apart because the profile is piecewise linear.
 */
const MD_SPEED_KEYS: readonly SpeedKey[] = [
  [0, 0.5],
  [MD_TIME.bar(2), 0.62],
  [MD_TIME.bar(4), 0.78],
  [MD_TIME.bar(8), 0.95],
  [MD_TIME.bar(12), 1.14],
  [MD_TIME.bar(16), 1.32],
  [MD_TIME.bar(20), 1.52],
  [MD_TIME.bar(24), 1.74],
  [MD_TIME.bar(27), 1.94],
  [MD_SHOT_TIME - 0.02, 2.0],
  [MD_SHOT_TIME + 0.06, 5.9],
  [MD_TIME.bar(30), 5.4],
  [MD_TIME.bar(32), 5.0],
];

const MD_SPEED = createSpeedProfile(MD_SPEED_KEYS, MD_RUN_DURATION, { samples: 2400 });

/** Authored rail easing. Every ring, spawn anchor, and scenery placement reads this. */
export function railProgress(time: number, duration = MD_RUN_DURATION) {
  return MD_SPEED.runProgress(time, duration);
}

/** Relative airspeed at a run time; drives FOV breathing and streak scroll. */
export function railSpeedFactor(time: number) {
  return MD_SPEED.speedAt(time);
}

export const MD_SPEED_FACTOR_MAX = 5.9;

/** Rail progress at the muzzle. Rings, rails, and the barrel wall all stop here. */
export const MD_MUZZLE_U = railProgress(MD_SHOT_TIME);

/** Rail progress where ring `beat` sits — by construction the camera is there on that beat. */
export function ringProgress(beat: number) {
  return railProgress(beat * MD_BEAT_SECONDS);
}

/** 0 before the interlock bars, 1 at the shot. The firing charge. */
export function chargeAt(time: number) {
  if (time <= MD_INTERLOCK_TIME) return 0;
  if (time >= MD_SHOT_TIME) return 1;
  return (time - MD_INTERLOCK_TIME) / (MD_SHOT_TIME - MD_INTERLOCK_TIME);
}

// Player-instrument timbre map. The muzzle section snaps rather than fades:
// the music turns over on the same downbeat, so a crossfade would smear it.
export type MdSection = 0 | 1 | 2 | 3 | 4;

export const MD_SCORE_SECTIONS = [
  { index: 0, fromBar: MD_BARS.injection },
  { index: 1, fromBar: MD_BARS.stage1, crossfadeBars: 2 },
  { index: 2, fromBar: MD_BARS.stage2, crossfadeBars: 2 },
  { index: 3, fromBar: MD_BARS.interlock, crossfadeBars: 2 },
  { index: 4, fromBar: MD_BARS.shot },
] as const;

export const MD_RUN_SECTIONS = [
  { name: 'injection', fromBar: MD_BARS.injection, toBar: MD_BARS.stage1 },
  { name: 'stage-1', fromBar: MD_BARS.stage1, toBar: MD_BARS.stage2 },
  { name: 'stage-2', fromBar: MD_BARS.stage2, toBar: MD_BARS.interlock },
  { name: 'interlock', fromBar: MD_BARS.interlock, toBar: MD_BARS.shot },
  { name: 'muzzle', fromBar: MD_BARS.shot },
] as const;
