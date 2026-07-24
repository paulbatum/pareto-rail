import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Three colour families, and nothing else is allowed in the frame:
//
//   the gun     — arc blue → violet → blinding white. Hot here means electric.
//   the enemy   — amber and fault red, the only warm things in a cold machine.
//   the player  — plasma white-cyan: reticle, locks, shots, kills.
//
// Every ring, coil and wall panel reads its colour off the run's heat ramp, so
// the barrel visibly climbs the same gradient the bass hum climbs in pitch.

export const VOID = new Color(0.006, 0.006, 0.018);
export const ARC_BLUE = new Color(0.16, 0.52, 1.0);
export const ARC_VIOLET = new Color(0.66, 0.24, 1.0);
export const ARC_WHITE = new Color(0.88, 0.94, 1.0);
export const PLASMA = new Color(0.58, 0.9, 1.0);
export const HOSTILE = new Color(1.0, 0.44, 0.1);
export const HOSTILE_DEEP = new Color(0.34, 0.11, 0.02);
export const FAULT = new Color(1.0, 0.15, 0.08);
export const CASING = new Color(0.048, 0.048, 0.072);
export const COIL = new Color(0.1, 0.1, 0.19);

/** Locks charge plasma → white → overcharge pink-white; the sixth lock is a full capacitor. */
export const LOCK_GRADIENT = [PLASMA, ARC_WHITE, new Color(1.0, 0.84, 1.0)] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

const heatScratch = new Color();

/** Ring heat by run progress: arc blue at the breech, violet mid-barrel, white at the muzzle. */
export function ringHeat(progress: number, target = heatScratch) {
  const t = Math.min(1, Math.max(0, progress));
  if (t < 0.55) return target.copy(ARC_BLUE).lerp(ARC_VIOLET, t / 0.55);
  return target.copy(ARC_VIOLET).lerp(ARC_WHITE, (t - 0.55) / 0.45);
}

export { mulberry32, type Rng };
