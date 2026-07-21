import { float, mix, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Skyhook screen effects, driven per-frame by the runtime:
// - flash: lightning strikes, the cloud-break punch, boss impacts;
// - chill: a faint cold desaturating cast as the air runs out.
export const flashUniform = uniform(0);
export const chillUniform = uniform(0);

export function composeSkyhookOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const luma = base.rgb.dot(vec3(0.299, 0.587, 0.114));
  const chilled = mix(base.rgb, vec3(luma).mul(vec3(0.86, 0.94, 1.1)), chillUniform.clamp(0, 0.4));
  const flash = vec3(0.95, 0.97, 1.05).mul(flashUniform);
  return vec4(chilled.add(flash), float(1));
}
