import { Color } from 'three';

export const MD_VOID = 0x01030b;
export const MD_STEEL = 0x101927;
export const MD_STEEL_LIT = 0x263449;
export const MD_ARC = 0x159dff;
export const MD_VIOLET = 0x7a32ff;
export const MD_WHITE = 0xeafaff;
export const MD_AMBER = 0xffa31a;
export const MD_RED = 0xff2038;

export function heatColor(progress: number, intensity = 1) {
  const t = Math.max(0, Math.min(1, progress));
  const color = new Color();
  if (t < 0.62) color.lerpColors(new Color(MD_ARC), new Color(MD_VIOLET), t / 0.62);
  else color.lerpColors(new Color(MD_VIOLET), new Color(MD_WHITE), (t - 0.62) / 0.38);
  return color.multiplyScalar(intensity);
}
