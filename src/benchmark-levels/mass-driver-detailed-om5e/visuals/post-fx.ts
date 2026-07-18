import { float, mix, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Three full-frame overlays over the scene, all driven per-frame by the runtime
// and all quick to decay:
//
//   flash      flat white overload — THE SHOT's whiteout, smaller pumps on clean
//              volleys and the sixth lock, and the interlocks-clear strobe;
//   charge     a violet-white radial bloom pooling at frame centre — the visible
//              firing charge, held back so the fight stays readable;
//   detonation hazard red bleeding to white on containment failure, with small
//              pulses on rejects and hull hits.
//
// Global motion blur and bloom are engine-owned; this only adds over the frame.

export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const radius = screenUV.sub(vec2(0.5, 0.5)).length();
  const pooled = float(1).sub(radius.mul(1.55)).clamp(0, 1).pow(2.4);

  const charge = vec3(0.66, 0.5, 1.0).mul(pooled).mul(chargeUniform);
  const flash = vec3(1.0, 1.0, 1.0).mul(flashUniform);
  // Red first, bleeding to white as the overload peaks.
  const detonation = mix(vec3(1.0, 0.14, 0.07), vec3(1.0, 0.92, 0.86), detonationUniform.clamp(0, 1))
    .mul(detonationUniform);

  return base.add(vec4(charge.add(flash).add(detonation), float(0)));
}
