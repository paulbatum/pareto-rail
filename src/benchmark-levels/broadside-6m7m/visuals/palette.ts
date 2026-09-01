import { Color } from 'three';

// Sides read by colour. Ours: ice-white hulls, cyan engines and cyan fire.
// Theirs: obsidian streaked with molten orange, firing crimson. The nebula
// behind everything is magenta and gold, so every hull is a silhouette with
// a coloured rim. The player owns cyan: reticle, locks, and shots.
export const ICE = new Color(0.86, 0.94, 1.0);
export const CYAN = new Color(0.25, 0.9, 1.0);
export const CYAN_DEEP = new Color(0.06, 0.48, 0.72);
export const OBSIDIAN = new Color(0.085, 0.066, 0.1);
export const MOLTEN = new Color(1.0, 0.46, 0.09);
export const CRIMSON = new Color(1.0, 0.14, 0.1);
export const MAGENTA = new Color(0.82, 0.14, 0.64);
export const GOLD = new Color(1.0, 0.72, 0.28);
export const WHITE_HOT = new Color(1.0, 0.96, 0.88);
export const NEBULA_DEEP = new Color(0.05, 0.008, 0.07);
export const SPACE = new Color(0.018, 0.004, 0.028);

// Locks charge cyan → ice → gold: the sixth lock is a full broadside.
export const LOCK_GRADIENT = [CYAN, ICE, GOLD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
