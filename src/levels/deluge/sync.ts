import { bar, STREETFALL_TIME, UNDER_TIME, VULTURE_TIME, OUTRO_TIME } from './gameplay';

export const LIGHTNING_STRIKES = [
  bar(7.75),
  STREETFALL_TIME,
  bar(24),
  UNDER_TIME,
  bar(56),
  bar(64),
  bar(80),
  bar(96),
  OUTRO_TIME,
];

export const TRAIN_PASS_TIME = bar(56);
export const CRASH_TIME = bar(101.5);

export function pulseAt(runTime: number, eventTime: number, attack = 0.05, release = 0.55) {
  const d = runTime - eventTime;
  if (d < -attack || d > release) return 0;
  if (d < 0) return 1 + d / attack;
  return 1 - d / release;
}

export function lightningIntensity(runTime: number) {
  let intensity = 0;
  for (const strike of LIGHTNING_STRIKES) intensity = Math.max(intensity, pulseAt(runTime, strike, 0.04, 0.7));
  return intensity;
}

export function nearestLightning(runTime: number, tolerance = 0.04) {
  return LIGHTNING_STRIKES.some((strike) => Math.abs(runTime - strike) <= tolerance);
}
