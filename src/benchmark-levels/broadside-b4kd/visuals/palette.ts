import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// The battle reads by silhouette and side. The nebula owns magenta and gold;
// every hull is a near-black shape rimmed in its faction's light. Your fleet
// is ice-white with cyan engines and cyan fire; the enemy is obsidian
// streaked with molten orange, firing crimson. The player's own optics —
// reticle, locks, shots — are the coldest cyan-white in the scene, so they
// can never be mistaken for the enemy's heat.
export const NEBULA_MAGENTA = new Color(0.95, 0.2, 0.66);
export const NEBULA_GOLD = new Color(1.0, 0.7, 0.26);
export const VOID_VIOLET = new Color(0.016, 0.008, 0.026);
export const ICE = new Color(0.85, 0.93, 1.0);
export const CYAN = new Color(0.3, 0.92, 1.0);
export const OBSIDIAN = new Color(0.04, 0.034, 0.055);
export const MOLTEN = new Color(1.0, 0.45, 0.1);
export const CRIMSON = new Color(1.0, 0.13, 0.17);

// Locks charge cyan → ice → gold: a full six-lock volley reads as a broadside
// about to fire.
export const LOCK_GRADIENT = [CYAN, ICE, NEBULA_GOLD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
