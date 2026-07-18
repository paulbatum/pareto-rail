import { createMusicTime } from '../../engine/music-time';
import { createSpeedProfile } from '../../engine/speed-profile';

// MASS DRIVER — 128 BPM locked minimal techno, common time, 32 bars = exactly
// 60 seconds. The quarter-note grid is the level's unit of distance as well as
// time: the payload crosses one accelerator ring on every beat, and the gun
// fires on the downbeat of bar 28 whether or not the player is ready.

export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });

export const MASS_DRIVER_BARS = {
  injection: 0,
  stage1: 4,
  stage2: 12,
  interlock: 20,
  shot: 28,
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers({
  injection: MASS_DRIVER_BARS.injection,
  stage1: MASS_DRIVER_BARS.stage1,
  stage2: MASS_DRIVER_BARS.stage2,
  breath: 18,
  interlock: MASS_DRIVER_BARS.interlock,
  shot: MASS_DRIVER_BARS.shot,
});

export const MASS_DRIVER_RUN_DURATION = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.end);
export const SHOT_TIME = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.shot);
// Interlocks stop accepting locks a quarter note before the shot, so the
// launch-or-detonate outcome is settled before the audio schedules the
// downbeat and homing shots in flight still have room to resolve.
export const DEADLINE_TIME = MASS_DRIVER_TIME.bar(27, 3);

// ---- acceleration ----------------------------------------------------------
// The gun only ever speeds up. A slow start off the breech, a steady climb, a
// harder pull as the charge builds, then a sudden ~3x surge on the bar-28
// downbeat — THE SHOT — easing off only slightly in open space.
export const MASS_DRIVER_SPEED_KEYS: Array<[number, number]> = [
  [MASS_DRIVER_TIME.bar(0), 0.46],
  [MASS_DRIVER_TIME.bar(4), 0.6],
  [MASS_DRIVER_TIME.bar(12), 0.8],
  [MASS_DRIVER_TIME.bar(20), 1.05],
  [MASS_DRIVER_TIME.bar(26), 1.32],
  [MASS_DRIVER_TIME.bar(27, 3.75), 1.6],
  [MASS_DRIVER_TIME.bar(28, 0.3), 4.5],
  [MASS_DRIVER_TIME.bar(30), 4.1],
  [MASS_DRIVER_TIME.bar(32), 3.85],
];

const speedProfile = createSpeedProfile(MASS_DRIVER_SPEED_KEYS, MASS_DRIVER_RUN_DURATION);

export const massDriverSpeedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const massDriverRailU = (time: number) => massDriverRunProgress(time);

/** Rail parameter of ring `k` — the camera crosses it exactly on beat `k` by construction. */
export function ringU(beatIndex: number) {
  return massDriverRunProgress(Math.min(MASS_DRIVER_RUN_DURATION, beatIndex * MASS_DRIVER_TIME.beatSeconds));
}

/** The camera reaches the end of the barrel exactly on the shot. */
export const MUZZLE_U = massDriverRunProgress(SHOT_TIME);
export const BARREL_BEATS = MASS_DRIVER_BARS.shot * 4;

// Player-instrument sections: glassy at the breech, tight and square in
// stage-1, bright saws in stage-2, dark reverb-heavy saws at the interlocks,
// quiet and hall-drenched at the muzzle. The muzzle switch is a hard cut on
// purpose — the music turns over with the shot.
export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_BARS.injection },
  { index: 1, fromBar: MASS_DRIVER_BARS.stage1, crossfadeBars: 1 },
  { index: 2, fromBar: MASS_DRIVER_BARS.stage2, crossfadeBars: 2 },
  { index: 3, fromBar: MASS_DRIVER_BARS.interlock, crossfadeBars: 1 },
  { index: 4, fromBar: MASS_DRIVER_BARS.shot },
] as const;

export const MASS_DRIVER_RUN_SECTIONS = [
  { name: 'injection', fromBar: MASS_DRIVER_BARS.injection, toBar: MASS_DRIVER_BARS.stage1 },
  { name: 'stage-1', fromBar: MASS_DRIVER_BARS.stage1, toBar: MASS_DRIVER_BARS.stage2 },
  { name: 'stage-2', fromBar: MASS_DRIVER_BARS.stage2, toBar: MASS_DRIVER_BARS.interlock },
  { name: 'interlock', fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.shot },
  { name: 'muzzle', fromBar: MASS_DRIVER_BARS.shot },
] as const;
