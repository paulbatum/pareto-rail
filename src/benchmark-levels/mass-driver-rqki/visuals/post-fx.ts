import { float, mix, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Three screen-space uniforms, all written from the runtime:
// - arcFlash is the electric lift as the payload crosses a ring, and the
//   whiteout when the gun finally fires;
// - chargeTint is the red bloom that creeps in while the interlocks are jammed;
// - vacuum drops the frame's contrast once you are outside the muzzle, so open
//   space reads as cold and empty after thirty seconds of strobing barrel.

export const arcFlashUniform = uniform(0);
export const chargeTintUniform = uniform(0);
export const vacuumUniform = uniform(0);

export function composeMassDriverOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Charge tint sits under the flash: the bore goes red before it goes white.
  const charged = base.add(vec4(vec3(1.0, 0.16, 0.07).mul(chargeTintUniform.mul(0.34)), float(0)));
  const flashed = charged.add(vec4(vec3(0.62, 0.78, 1.0).mul(arcFlashUniform), float(0)));
  // Vacuum: pull the frame toward its own dimmed self rather than desaturating,
  // so the stars stay legible while the barrel's glare falls away.
  return mix(flashed, flashed.mul(0.72), vacuumUniform.clamp(0, 1));
}
