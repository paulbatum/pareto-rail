import { Color } from 'three';

// Broadside's rule: the nebula is the only light source in the frame, so every
// hull reads as a silhouette rimmed in colored light, and the two fleets are
// told apart by color alone — you never have to read a shape to know whose
// side something is on.
//
//   Friendly: ice-white plating, cyan engine glow, cyan gunfire.
//   Enemy:    obsidian plating, molten-orange seams, crimson gunfire.
//
// Nothing else on screen is saturated except the nebula itself, which is
// magenta and gold and sits behind everything.

// ---- friendly fleet ---------------------------------------------------------
export const ICE_WHITE = new Color(0.84, 0.9, 1.0);
export const ICE_SHADOW = new Color(0.12, 0.145, 0.19);
export const FRIEND_CYAN = new Color(0.24, 0.9, 1.0);
export const FRIEND_DEEP = new Color(0.05, 0.42, 0.62);

// ---- enemy fleet ------------------------------------------------------------
export const OBSIDIAN = new Color(0.022, 0.02, 0.03);
export const OBSIDIAN_LIT = new Color(0.055, 0.05, 0.07);
export const MOLTEN = new Color(1.0, 0.44, 0.08);
export const CRIMSON = new Color(1.0, 0.12, 0.16);
export const EMBER = new Color(0.62, 0.13, 0.03);

// ---- the nebula -------------------------------------------------------------
export const NEBULA_MAGENTA = new Color(0.62, 0.1, 0.5);
export const NEBULA_ROSE = new Color(0.9, 0.26, 0.55);
export const NEBULA_GOLD = new Color(1.0, 0.68, 0.28);
export const NEBULA_DEEP = new Color(0.09, 0.03, 0.13);
export const VOID = new Color(0.012, 0.008, 0.022);
export const STARLIGHT = new Color(0.86, 0.88, 1.0);

// Locks charge cyan → ice-white → gold: a full six reads as your own guns
// running hot enough to match the nebula behind them.
export const LOCK_GRADIENT = [FRIEND_CYAN, ICE_WHITE, NEBULA_GOLD] as const;

/** Push a base color into HDR so bloom picks it up. Base color still carries at bloom zero. */
export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
