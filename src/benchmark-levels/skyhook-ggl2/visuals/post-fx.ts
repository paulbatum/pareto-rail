import { float, mix, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Skyhook screen effects, driven per-frame by the runtime:
// - flash is the white overload punching through the cloud deck and the moment
//   the Descender is put down;
// - dock is the station light swallowing the frame as the car docks;
// - haze is the cloud-deck wash that briefly desaturates toward white.
export const flashUniform = uniform(0);
export const dockUniform = uniform(0);
export const hazeUniform = uniform(0);

export function composeSkyhookOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Cloud haze: lift toward a soft white as the car pushes through the deck.
  const hazed = mix(base, vec4(vec3(0.9, 0.93, 0.98), float(1)), hazeUniform.clamp(0, 0.7));
  // Station light and set-piece flashes both add a clean white bloomless wash.
  const wash = vec3(1.0, 0.98, 0.94).mul(flashUniform.add(dockUniform));
  return hazed.add(vec4(wash, float(0)));
}
