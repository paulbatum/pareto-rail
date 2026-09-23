import { Color } from 'three';

// The cube owns the six solve colors; everything else stays out of their way.
// The void is pale and cool, the machinery is white and grey, the cube's
// plastic is graphite so its silhouette holds against the pale void, and the
// player's instrument (reticle, darts, lock marks) is ink.

/** Face order F, R, U, B, L, D — the solve order. */
export const FACE_COLORS = [
  new Color('#ff2d48'), // red
  new Color('#2a6bff'), // blue
  new Color('#ffc30f'), // yellow
  new Color('#16c25a'), // green
  new Color('#ff7414'), // orange
  new Color('#f23ccb'), // pink
] as const;
export const FACE_NAMES = ['RED', 'BLUE', 'YELLOW', 'GREEN', 'ORANGE', 'PINK'] as const;

export const VOID = new Color('#eceff4');
export const VOID_DEEP = new Color('#dfe3ea');
export const HAZE = new Color('#c9ced8');
export const BODY = new Color('#2b2f38');
export const BODY_EDGE = new Color('#454b57');
export const MACHINE = new Color('#f3f4f6');
export const MACHINE_GREY = new Color('#a3a9b4');
export const STEEL = new Color('#7d8491');
export const INK = new Color('#161922');
export const WHITE = new Color('#ffffff');
export const DENY = new Color('#ff2d48');

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
