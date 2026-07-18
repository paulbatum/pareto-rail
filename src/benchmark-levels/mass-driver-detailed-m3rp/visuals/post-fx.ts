import { float, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Three full-frame overlays over the engine-composited frame (motion blur +
// bloom); the shared vignette stays engine-owned and lands after this hook.
//   flash      — flat white overload: THE SHOT whiteout, clean-volley pumps,
//                the sixth lock, the interlocks-clear strobe.
//   charge     — a violet-white radial bloom pooling at frame center (the far
//                muzzle): the visible firing charge through the interlock bars.
//   detonation — hazard red bleeding to white on containment failure, small
//                pulses on rejects and hits.
export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const radial = screenUV.sub(vec2(0.5, 0.5)).length();
  const pool = float(1).sub(radial.mul(1.4)).clamp(0, 1);
  const charge = vec3(0.6, 0.48, 1.0).mul(chargeUniform.mul(pool.mul(0.62).add(0.16)));

  const flash = vec3(0.87, 0.95, 1.0).mul(flashUniform);
  // Detonation bleeds red at the rim toward white at full strength.
  const detonation = vec3(1.0, 0.26, 0.1)
    .add(vec3(0.0, 0.55, 0.7).mul(detonationUniform))
    .mul(detonationUniform.mul(0.9));

  return base.add(vec4(charge.add(flash).add(detonation), float(0)));
}
