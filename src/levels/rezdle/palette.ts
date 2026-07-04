import { Color } from 'three';

// Midnight print shop: warm bone type on ink-black, brass fittings,
// vermillion rubrication for locks and stamped words.
export const INK_BLACK = new Color(0.028, 0.02, 0.012);
export const BONE = new Color(0.93, 0.87, 0.7);
export const BRASS = new Color(1.0, 0.76, 0.34);
export const VERMILLION = new Color(1.0, 0.26, 0.13);
export const SMOKE = new Color(0.42, 0.35, 0.24);
export const PLATE = new Color(0.1, 0.078, 0.05);

export const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);
