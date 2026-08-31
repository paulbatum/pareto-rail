import { Color, DoubleSide, MeshBasicMaterial, MeshLambertMaterial } from 'three';

export const WATER_NEAR = new Color(0.012, 0.13, 0.21);
export const WATER_CLEAR = new Color(0.018, 0.25, 0.31);
export const WATER_DEEP = new Color(0.006, 0.035, 0.13);
export const SUN_WATER = new Color(0.18, 0.56, 0.49);

export const JELLY_GREEN = new Color(0.11, 0.62, 0.29);
export const JELLY_GOLD = new Color(0.95, 0.68, 0.18);
export const JELLY_CREAM = new Color(0.58, 0.9, 0.62);
export const JELLY_SHADOW = new Color(0.035, 0.19, 0.16);

export const PARASITE_VIOLET = new Color(0.55, 0.08, 0.66);
export const PARASITE_SOUR = new Color(0.92, 0.24, 0.9);
export const PARASITE_DARK = new Color(0.095, 0.018, 0.15);
export const DENIED = new Color(1.0, 0.2, 0.43);

export const PLAYER_CYAN = new Color(0.52, 1.0, 0.92);
export const PLAYER_GOLD = new Color(1.0, 0.88, 0.47);

export function strandMat(color: Color | number, opacity = 1) {
  return new MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.98,
    side: DoubleSide,
  });
}

export function fleshMat(color: Color | number, opacity = 1) {
  return new MeshLambertMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.98,
    side: DoubleSide,
  });
}
