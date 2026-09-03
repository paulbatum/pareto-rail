import { Color } from 'three';

export type BroadsidePalette = {
  space: Color;
  nebula: Color;
  nebulaHot: Color;
  gold: Color;
  ice: Color;
  iceShadow: Color;
  cyan: Color;
  cyanWhite: Color;
  obsidian: Color;
  obsidianEdge: Color;
  orange: Color;
  crimson: Color;
  scarlet: Color;
  white: Color;
};

export const PALETTE: BroadsidePalette = {
  space: new Color(0.004, 0.001, 0.022),
  nebula: new Color(0.34, 0.006, 0.18),
  nebulaHot: new Color(0.9, 0.12, 0.035),
  gold: new Color(1.0, 0.34, 0.035),
  ice: new Color(0.58, 0.78, 1.0),
  iceShadow: new Color(0.075, 0.14, 0.25),
  cyan: new Color(0.015, 0.62, 1.0),
  cyanWhite: new Color(0.62, 0.94, 1.0),
  obsidian: new Color(0.012, 0.018, 0.045),
  obsidianEdge: new Color(0.12, 0.16, 0.25),
  orange: new Color(1.0, 0.16, 0.012),
  crimson: new Color(0.9, 0.008, 0.018),
  scarlet: new Color(1.0, 0.055, 0.02),
  white: new Color(0.92, 0.98, 1.0),
};

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
