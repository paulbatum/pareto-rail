import { Vector3 } from 'three';
import { float, mix, uniform, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen-level weather, written by the visual runtime each frame:
// - veil: the frame drowning in cloud while the car punches through the deck;
// - flash: lightning, hull hits, and the Descender's death, added over the frame.
export const veilUniform = uniform(0);
export const veilColorUniform = uniform(new Vector3(0.78, 0.8, 0.83));
export const flashUniform = uniform(0);
export const flashColorUniform = uniform(new Vector3(0.8, 0.84, 1.0));

export function composeSkyhookOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const veiled = mix(base, vec4(veilColorUniform, float(1)), veilUniform.clamp(0, 0.92));
  return veiled.add(vec4(flashColorUniform.mul(flashUniform), float(0)));
}
