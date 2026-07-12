import { createMusicTime } from '../../engine/music-time';

// MASS DRIVER — 128 BPM, 32 bars = exactly 60 seconds. The whole level is
// built on one identity: the payload crosses one accelerator ring on every
// beat. 4 beats × 32 bars = 128 beats; the muzzle sits at beat 120 (bar 30),
// so 120 rings of barrel and 8 beats of open space.
export const MASS_DRIVER_BPM = 128;
export const MASS_DRIVER_STEPS_PER_BAR = 16;
export const MASS_DRIVER_TIME = createMusicTime(MASS_DRIVER_BPM, { stepsPerBar: MASS_DRIVER_STEPS_PER_BAR });
export const MASS_DRIVER_BAR = MASS_DRIVER_TIME.barSeconds;
export const BEAT_SECONDS = MASS_DRIVER_TIME.beatSeconds;

export const MASS_DRIVER_BARS = {
  injection: 0, // breech: the hum wakes, first drones thread in
  stage1: 4, // first accelerator stage kicks: four-on-floor drops
  stage2: 12, // second stage: violet heat, dense traffic
  alarm: 20, // interlocks jam: breakdown, naked hum, klaxon
  boss: 24, // the charge builds: clear all six interlocks
  muzzle: 30, // the gun fires: launched into open space
  end: 32,
} as const;

export const MASS_DRIVER_MARKERS = MASS_DRIVER_TIME.markers(MASS_DRIVER_BARS);

export const MASS_DRIVER_DURATION = MASS_DRIVER_MARKERS.end;
export const STAGE1_TIME = MASS_DRIVER_MARKERS.stage1;
export const STAGE2_TIME = MASS_DRIVER_MARKERS.stage2;
export const ALARM_TIME = MASS_DRIVER_MARKERS.alarm;
export const BOSS_TIME = MASS_DRIVER_MARKERS.boss;
export const FIRE_TIME = MASS_DRIVER_MARKERS.muzzle;

/** Beat index of the muzzle: the last accelerator ring of the barrel. */
export const MUZZLE_BEAT = MASS_DRIVER_BARS.muzzle * MASS_DRIVER_TIME.beatsPerBar;

// Player-instrument sections for the score: timbres heat up with the barrel.
export const MASS_DRIVER_SCORE_SECTIONS = [
  { index: 0, fromBar: MASS_DRIVER_BARS.injection },
  { index: 1, fromBar: MASS_DRIVER_BARS.stage2, crossfadeBars: 1 },
  { index: 2, fromBar: MASS_DRIVER_BARS.alarm, crossfadeBars: 1 },
  { index: 3, fromBar: MASS_DRIVER_BARS.muzzle },
] as const;

export const MASS_DRIVER_RUN_SECTIONS = [
  { name: 'injection', fromBar: MASS_DRIVER_BARS.injection, toBar: MASS_DRIVER_BARS.stage1 },
  { name: 'stage-1', fromBar: MASS_DRIVER_BARS.stage1, toBar: MASS_DRIVER_BARS.stage2 },
  { name: 'stage-2', fromBar: MASS_DRIVER_BARS.stage2, toBar: MASS_DRIVER_BARS.alarm },
  { name: 'alarm', fromBar: MASS_DRIVER_BARS.alarm, toBar: MASS_DRIVER_BARS.boss },
  { name: 'charge', fromBar: MASS_DRIVER_BARS.boss, toBar: MASS_DRIVER_BARS.muzzle },
  { name: 'muzzle', fromBar: MASS_DRIVER_BARS.muzzle, toBar: MASS_DRIVER_BARS.end },
] as const;

export const bar = MASS_DRIVER_TIME.bar;
