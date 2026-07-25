import { float, luminance, max, mix, time, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../engine/types';

export const thermalModeUniform = uniform(0);
export const inkBlackoutUniform = uniform(0);
export const thermalSwitchUniform = uniform(0);

export function composeThermalInkOutput({
  base,
  screenUV,
}: LevelPostComposeInput): LevelPostColorNode {
  const luma = luminance(base.rgb).sub(0.13).mul(1.68).add(0.04).clamp(0, 1.65);
  // Infrared is monochrome except for authored signal-red materials. Detect
  // genuine red dominance so sodium/orange scenery cannot leak back into the
  // charcoal display, while nerves and vulnerable cores stay unambiguously red.
  const redDominance = base.r.sub(max(base.g, base.b).mul(1.18)).max(0);
  const signalMask = redDominance.mul(0.9).clamp(0, 1);
  const thermalRgb = mix(vec3(luma), vec3(2.8, 0.018, 0.008), signalMask);
  const charcoal = vec4(thermalRgb, base.a);
  const sensed = mix(base, charcoal, thermalModeUniform.clamp(0, 1));

  // Ink consumes normal optics, but not the heat image. Physical ink meshes
  // remain visible in both modes as cold, drifting voids.
  const normalBlackout = inkBlackoutUniform
    .mul(float(1).sub(thermalModeUniform))
    .mul(0.84)
    .clamp(0, 0.9);
  const darkened = vec4(sensed.rgb.mul(float(1).sub(normalBlackout)), sensed.a);

  const scanline = screenUV.y
    .mul(610)
    .add(time.mul(34))
    .sin()
    .mul(0.018)
    .mul(thermalModeUniform);
  const switchFlash = vec3(0.75, 0.82, 0.78).mul(thermalSwitchUniform.mul(0.24));
  return darkened.add(vec4(vec3(scanline).add(switchFlash), float(0)));
}
