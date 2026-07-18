import { float, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../engine/types';

// Three full-frame overlays sit over the scene, and each one has exactly one
// job:
//   flash       — flat white overload: THE SHOT, the sixth lock, clean volleys,
//                 and the interlocks-clear strobe;
//   charge      — a violet-white radial bloom pooling at frame center, the
//                 visible firing charge through the interlock bars;
//   detonation  — hazard red bleeding to white on containment failure, with
//                 small pulses on rejects and hull hits.
// All three decay quickly; the runtime writes them and nothing else does.

export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const detonationUniform = uniform(0);

export function pumpFlash(value: number) {
  flashUniform.value = Math.max(flashUniform.value, Math.max(0, value));
}

export function pumpDetonation(value: number) {
  detonationUniform.value = Math.max(detonationUniform.value, Math.max(0, value));
}

export function setChargeOverlay(value: number) {
  chargeUniform.value = Math.max(0, value);
}

export function decayPostFx(dt: number) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * 1.9);
  detonationUniform.value = Math.max(0, detonationUniform.value - dt * 1.35);
}

export function resetPostFx() {
  flashUniform.value = 0;
  chargeUniform.value = 0;
  detonationUniform.value = 0;
}

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  // Anisotropic centering keeps the charge bloom a disc rather than an ellipse
  // on wide displays; it pools at frame center, where the muzzle sits.
  const centered = screenUV.sub(vec2(0.5, 0.5)).mul(vec2(1.7, 1.0));
  const radial = float(1).sub(centered.length().mul(1.9)).clamp(0, 1).pow(2.4);
  const charge = vec3(0.60, 0.44, 1.0).mul(radial.mul(chargeUniform));
  const flash = vec3(1.0, 1.0, 1.0).mul(flashUniform);
  // Red first, then white as the overload saturates.
  const detonation = vec3(1.0, 0.16, 0.08)
    .mul(detonationUniform)
    .add(vec3(1.0, 0.9, 0.85).mul(detonationUniform.mul(detonationUniform).mul(0.85)));

  return base.add(vec4(charge.add(flash).add(detonation), float(0)));
}
