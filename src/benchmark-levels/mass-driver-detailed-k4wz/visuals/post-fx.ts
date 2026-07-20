import { float, mix, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Three full-frame overlays over the scene, driven per-frame by the runtime:
// - flash: flat white overload — the shot whiteout, clean-volley pumps, the
//   sixth lock, and the interlocks-clear strobe;
// - charge: a violet-white radial bloom pooling at frame center — the visible
//   firing charge ramping through the interlock bars;
// - detonation: hazard red bleeding to white on containment failure, with
//   small pulses on rejects and hull hits.
// All three decay quickly in the runtime; this file only composites them.
export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const centerDistance = screenUV.distance(vec2(0.5, 0.5));

  // Charge pools at frame center as a violet-white radial bloom.
  const chargePool = smoothstep(float(0.62), float(0.05), centerDistance).mul(chargeUniform);
  const chargeColor = mix(vec3(0.5, 0.32, 0.95), vec3(0.94, 0.9, 1.0), chargeUniform).mul(chargePool);

  // Detonation bleeds hazard red toward white as it saturates.
  const detonationColor = mix(vec3(1.0, 0.1, 0.06), vec3(1.0, 0.94, 0.9), detonationUniform.mul(detonationUniform))
    .mul(detonationUniform);

  const flashColor = vec3(1.0, 1.0, 1.0).mul(flashUniform);

  return base
    .add(vec4(chargeColor, float(0)))
    .add(vec4(detonationColor, float(0)))
    .add(vec4(flashColor, float(0)));
}
