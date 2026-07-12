import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// SKYHOOK palette discipline (see design doc):
// - Friendly hardware is UTILITARIAN: white paneling + hazard orange. HDR only on
//   thin strips and small marker lights.
// - Enemies are dark gunmetal with signal-red / amber cores (HDR on small cores).
// - Player marks (reticle, locks, projectiles) are a clean white → orange family.
// - NO neon cyan / magenta / green anywhere. Sky colours come from the atmosphere
//   ramp in environment.ts, never from props.

// -- friendly hardware ---------------------------------------------------------
export const PANEL_WHITE = new Color(0.91, 0.91, 0.933); // 0xe8e8ee
export const PANEL_SHADE = new Color(0.42, 0.44, 0.48); // recessed panel seams
export const MARKER_WHITE = new Color(1.0, 0.98, 0.94); // HDR marker lights
export const HAZARD_ORANGE = new Color(1.0, 0.467, 0.133); // 0xff7722
export const BAY_WARM = new Color(1.0, 0.72, 0.4); // station interior glow

// -- enemies -------------------------------------------------------------------
export const GUNMETAL = new Color(0.165, 0.18, 0.204); // 0x2a2e34
export const GUNMETAL_DARK = new Color(0.075, 0.084, 0.098);
export const SIGNAL_RED = new Color(1.0, 0.16, 0.11);
export const SIGNAL_AMBER = new Color(1.0, 0.6, 0.14);

// -- player marks (clean white → orange family) --------------------------------
export const MARK_WHITE = new Color(0.9, 0.93, 0.98);
export const MARK_HOT = new Color(1.0, 0.9, 0.72);
export const DENY_RED = new Color(1.6, 0.11, 0.05);
export const DENY_FILL = new Color(0.32, 0.03, 0.02);

// Locks charge white → warm white → hazard orange. The sixth lock reads as a
// "cleared for launch" orange, distinct from the red the enemies wear.
export const LOCK_GRADIENT = [MARK_WHITE, MARK_HOT, HAZARD_ORANGE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
