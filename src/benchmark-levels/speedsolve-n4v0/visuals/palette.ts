import { Color } from 'three';

// The cube owns the six bright solve colours; everything else stays out of
// their way. Machinery is white and grey, the void is pale, letters and the
// player's own light are graphite and hot white. Enemy fire borrows the cube's
// colours because it belongs to the cube. Values are sRGB hex so they read on
// screen exactly as authored.
export const SOLVE_COLORS: readonly Color[] = [
  new Color(0xff2f45), // 0 +X  red
  new Color(0xff8a1a), // 1 -X  orange
  new Color(0xffd21f), // 2 +Y  yellow
  new Color(0x2ed65a), // 3 -Y  green
  new Color(0x2b7bff), // 4 +Z  blue
  new Color(0xb048ff), // 5 -Z  violet
];
export const SOLVE_COLOR_NAMES = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'VIOLET'] as const;

export const VOID_TOP = new Color(0xd2d8df);
export const VOID_BOTTOM = new Color(0x98a1ac);
export const VOID_FOG = new Color(0xbfc7d0);

export const MACHINE_WHITE = new Color(0xe4e8ed);
export const MACHINE_GREY = new Color(0x9ba2ab);
export const MACHINE_DARK = new Color(0x5a6068);
export const CUBIE_BODY = new Color(0xb9bec6);
export const SEAM = new Color(0x2a2d33);
export const GRAPHITE = new Color(0x23262c);
export const HOT_WHITE = new Color(0xfffbf2);
export const DENY = new Color(0xff5a2a);

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

export function solveColor(index: number): Color {
  return SOLVE_COLORS[((index % 6) + 6) % 6];
}
