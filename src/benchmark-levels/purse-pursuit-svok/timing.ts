import { createMusicTime } from '../../engine/music-time';
import { createSpeedProfile } from '../../engine/speed-profile';

// 128 BPM electropop. Four beats to a bar, 1.875s a bar, 32 bars to the run:
// exactly 60.000 seconds of chase that ends on a downbeat.
export const PURSE_BPM = 128;
export const PURSE_STEPS_PER_BAR = 16;
export const PURSE_TIME = createMusicTime(PURSE_BPM, { stepsPerBar: PURSE_STEPS_PER_BAR });

/**
 * The arrangement in bars. Every gameplay beat in the level is authored against
 * one of these, so the spawn choreography and the track turn over together.
 */
export const PURSE_BARS = {
  rollout: 0,
  chase: 4,
  chaseLift: 8,
  hook: 12,
  hookLift: 16,
  breakdown: 20,
  boss: 22,
  bossRage: 26,
  payoff: 30,
  end: 32,
} as const;

export const PURSE_RUN_DURATION = PURSE_TIME.bar(PURSE_BARS.end);

export const PURSE_MARKERS = PURSE_TIME.markers({
  rollout: PURSE_BARS.rollout,
  chase: PURSE_BARS.chase,
  chaseLift: PURSE_BARS.chaseLift,
  hook: PURSE_BARS.hook,
  hookLift: PURSE_BARS.hookLift,
  breakdown: PURSE_BARS.breakdown,
  bossSighted: [PURSE_BARS.breakdown, 2],
  bossEntrance: [PURSE_BARS.boss, 0],
  bossRage: PURSE_BARS.bossRage,
  payoff: PURSE_BARS.payoff,
});

/**
 * Player-instrument voicing sections. The verse/chorus handover crossfades
 * because the backing track does not turn over at bar 12's downbeat until the
 * hook lands; the boss and the payoff both snap because the music does too.
 */
export const PURSE_SCORE_SECTIONS = [
  { index: 0, fromBar: PURSE_BARS.rollout },
  { index: 1, fromBar: PURSE_BARS.hook, crossfadeBars: 2 },
  { index: 2, fromBar: PURSE_BARS.boss },
  { index: 3, fromBar: PURSE_BARS.payoff },
] as const;

export const PURSE_RUN_SECTIONS = [
  { name: 'rollout', fromBar: PURSE_BARS.rollout, toBar: PURSE_BARS.chase },
  { name: 'chase', fromBar: PURSE_BARS.chase, toBar: PURSE_BARS.chaseLift },
  { name: 'chase-lift', fromBar: PURSE_BARS.chaseLift, toBar: PURSE_BARS.hook },
  { name: 'hook', fromBar: PURSE_BARS.hook, toBar: PURSE_BARS.hookLift },
  { name: 'hook-lift', fromBar: PURSE_BARS.hookLift, toBar: PURSE_BARS.breakdown },
  { name: 'breakdown', fromBar: PURSE_BARS.breakdown, toBar: PURSE_BARS.boss },
  { name: 'boss', fromBar: PURSE_BARS.boss, toBar: PURSE_BARS.bossRage },
  { name: 'boss-rage', fromBar: PURSE_BARS.bossRage, toBar: PURSE_BARS.payoff },
  { name: 'payoff', fromBar: PURSE_BARS.payoff },
] as const;

const bar = (index: number, beat = 0) => PURSE_TIME.bar(index, beat);

/**
 * Your buddy's right foot. The car eases out of the kerb, settles into traffic
 * speed, floors it on the chorus drop, backs off through the breakdown while
 * the boss is sighted, then pulls away clean once the purse is back.
 */
export const PURSE_SPEED_KEYS = [
  [0, 0.72],
  [bar(1), 0.9],
  [bar(PURSE_BARS.chase), 1.0],
  [bar(PURSE_BARS.chaseLift), 1.04],
  [bar(PURSE_BARS.hook), 1.18],
  [bar(PURSE_BARS.hookLift), 1.16],
  [bar(PURSE_BARS.breakdown), 0.94],
  [bar(PURSE_BARS.breakdown, 3), 0.9],
  [bar(PURSE_BARS.boss), 1.1],
  [bar(PURSE_BARS.bossRage), 1.14],
  [bar(PURSE_BARS.payoff), 1.3],
  [bar(PURSE_BARS.payoff, 2), 1.6],
  [bar(PURSE_BARS.end), 1.6],
] as const;

export const purseSpeedProfile = createSpeedProfile(PURSE_SPEED_KEYS, PURSE_RUN_DURATION, { samples: 1800 });

export function purseRunProgress(time: number, duration = PURSE_RUN_DURATION) {
  return purseSpeedProfile.runProgress(time, duration);
}

export function purseSpeedFactorAt(time: number) {
  return purseSpeedProfile.speedAt(time);
}
