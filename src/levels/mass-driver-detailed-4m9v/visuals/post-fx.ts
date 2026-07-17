import { float, mix, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Three full-frame overlays over the scene, decaying quickly:
// - flash: flat white overload — the shot whiteout, clean-volley pumps, the
//   sixth lock, and the interlocks-clear strobe;
// - charge: a violet-white radial bloom pooling at frame center — the visible
//   firing charge ramping through the interlock bars;
// - detonation: hazard red bleeding to white on containment failure, with
//   small pulses on rejects and hits.
export const flashUniform = uniform(0);
export const chargeOverlayUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const centerFalloff = float(1).sub(centered.length().mul(2.4)).clamp(0, 1).pow(2.4);
  const chargeColor = mix(vec3(0.72, 0.5, 1.0), vec3(1.0, 0.98, 0.96), chargeOverlayUniform)
    .mul(centerFalloff)
    .mul(chargeOverlayUniform.mul(0.6));

  const detonation = mix(vec3(1.0, 0.13, 0.05), vec3(1.0, 0.97, 0.94), detonationUniform.clamp(0, 1))
    .mul(detonationUniform);

  const flash = vec3(1.0, 1.0, 1.0).mul(flashUniform);
  return base.add(vec4(chargeColor.add(flash).add(detonation), float(0)));
}
