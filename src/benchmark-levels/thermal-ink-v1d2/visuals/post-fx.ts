import { float, mix, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Thermal Ink screen effects, driven per-frame by the runtime:
// - irUniform grades the frame into the stark charcoal thermal display
//   (materials already swap palettes; this adds the contrast curve, a faint
//   scanline shimmer, and the cold cast);
// - inkUniform swallows the edges of the frame while the camera is inside ink;
// - flash is the cream-white overload on set pieces; hurt bleeds rust-red.
export const irUniform = uniform(0);
export const inkUniform = uniform(0);
export const flashUniform = uniform(0);
export const hurtUniform = uniform(0);

export function composeThermalInkOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  // Thermal grade: pull toward a mono charcoal curve with a cold cast; hot
  // things stay hot (the material swap already pushed them to HDR).
  const luma = base.r.mul(0.3).add(base.g.mul(0.55)).add(base.b.mul(0.15));
  const charcoal = vec3(luma.pow(0.82)).mul(vec3(0.9, 1.02, 1.1)).mul(1.12);
  let color = mix(base, vec4(charcoal, base.a), irUniform.clamp(0, 1).mul(0.85));

  // Scanline shimmer only while infrared — the sensor's refresh made visible.
  const scan = screenUV.y.mul(340).add(time.mul(3.1)).sin().mul(0.5).add(0.5);
  color = color.sub(vec4(vec3(scan.mul(0.05)), float(0)).mul(irUniform));

  // Ink swallow: the murk closes in from the edges.
  const edge = screenUV.sub(vec2(0.5, 0.5)).length().mul(1.6);
  const swallow = smoothstep(float(0), float(1), edge.sub(inkUniform.mul(0.7)));
  color = color.mul(float(1).sub(swallow.mul(0.85)));

  const flash = vec3(1.0, 0.88, 0.66).mul(flashUniform);
  const hurt = vec3(0.55, 0.08, 0.04).mul(hurtUniform);
  return color.add(vec4(flash.add(hurt), float(0)));
}
