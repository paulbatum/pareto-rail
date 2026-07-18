import { float, mix, screenUV as tslScreenUV, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Three full-frame overlays, driven per-frame by the runtime:
// - flash: flat white overload — the shot whiteout, clean-volley pumps, the
//   sixth lock, the interlocks-clear strobe;
// - charge: a violet-white radial bloom pooling at frame center — the visible
//   firing charge through the interlock bars;
// - detonation: hazard red bleeding to white on containment failure.
export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  void tslScreenUV;
  const centered = screenUV.sub(0.5);
  const radial = float(1).sub(centered.length().mul(1.7)).clamp(0, 1);

  const chargeColor = vec3(0.72, 0.5, 1.0).mul(radial.pow(2)).mul(chargeUniform);
  const detonationColor = mix(vec3(1.0, 0.1, 0.06), vec3(1, 1, 1), detonationUniform.clamp(0, 1).pow(2))
    .mul(detonationUniform);
  const flashColor = vec3(1, 1, 1).mul(flashUniform);

  return base
    .add(vec4(chargeColor, float(0)))
    .add(vec4(detonationColor, float(0)))
    .add(vec4(flashColor, float(0)));
}
