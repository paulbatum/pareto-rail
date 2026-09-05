import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects written per frame by the runtime:
// - flash: warm white overload for the ignition and perfect volleys;
// - warmth: a faint amber lift over the whole frame once the rose is lit.
export const flashUniform = uniform(0);
export const warmthUniform = uniform(0);

export function composeVespersOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const flash = vec3(1.0, 0.92, 0.74).mul(flashUniform);
  const warmth = vec3(0.012, 0.007, 0.002).mul(warmthUniform);
  return base.add(vec4(flash.add(warmth), float(0)));
}
