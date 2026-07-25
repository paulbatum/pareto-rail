import { float, max, mix, time, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Thermal Ink screen effects, driven per-frame by the runtime:
// - irUniform: the infrared display — contrast-boosted charcoal grayscale with
//   red signal excess preserved, plus faint scanlines so it reads as a lens;
// - blindUniform: the swallowed beat between ink ejection and the lens snap;
// - flashUniform: amber lamp flash (hull hits, the lamps-return finale).
export const irUniform = uniform(0);
export const blindUniform = uniform(0);
export const flashUniform = uniform(0);

export function composeThermalOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const rgb = base.rgb;
  const luma = rgb.dot(vec3(0.2126, 0.7152, 0.0722));

  // Anything meaningfully redder than it is green/blue keeps its red under the
  // lens — the signal cores burn through the grayscale.
  const redness = max(rgb.r.sub(max(rgb.g, rgb.b)), float(0));
  const scan = screenUV.y.mul(560).add(time.mul(6.0)).sin().mul(0.5).add(0.5).mul(0.055);
  const thermalGray = luma.mul(1.5).add(0.006);
  const thermal = vec3(thermalGray)
    .add(vec3(1.0, 0.1, 0.05).mul(redness).mul(1.7))
    .mul(float(1).sub(scan.mul(irUniform)));

  const graded = mix(rgb, thermal, irUniform.clamp(0, 1));
  const swallowed = graded.mul(float(1).sub(blindUniform.mul(0.72)));
  const flashed = swallowed.add(vec3(1.0, 0.74, 0.4).mul(flashUniform));
  return vec4(flashed, base.a);
}
