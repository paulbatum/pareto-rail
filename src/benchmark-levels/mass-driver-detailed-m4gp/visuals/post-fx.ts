import { float, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Mass Driver screen effects, written per-frame by the runtime and composited
// additively over the engine frame (global motion blur + bloom). Vignette stays
// engine-owned.
//   flash       — the white overload: THE SHOT whiteout, perfect-volley pumps.
//   charge      — a rising radial white-violet bloom down the bore through the
//                 interlock bars: the firing charge you can see building.
//   detonation  — the fail state: a hazard red/white overload if the barrel
//                 goes up with you inside it.
export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  // Charge reads as a violet-white glow that pools in the center of the frame
  // (the far muzzle) and lifts the whole image slightly as it peaks.
  const radial = screenUV.sub(vec2(0.5, 0.5)).length();
  const core = float(1).sub(radial.mul(1.35)).clamp(0, 1);
  const charge = vec3(0.62, 0.5, 1.0).mul(chargeUniform.mul(core.mul(0.6).add(0.18)));

  // The shot: a flat white flash. The detonation: hazard red bleeding to white.
  const flash = vec3(0.86, 0.95, 1.0).mul(flashUniform);
  const detonation = vec3(1.0, 0.28, 0.12).mul(detonationUniform);

  return base.add(vec4(charge.add(flash).add(detonation), float(0)));
}
