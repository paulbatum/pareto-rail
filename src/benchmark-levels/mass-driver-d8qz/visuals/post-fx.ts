import { float, mix, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects, all written per frame by the visuals spine:
// - `chargeUniform` bathes the frame in capacitor violet as the firing charge builds;
// - `arcUniform` tears thin horizontal bands sideways, the barrel arcing over;
// - `flashUniform` is the white overload of the firing charge and the muzzle;
// - `blastUniform` is the same energy going the wrong way, in fault red.
// Global motion blur stays engine-owned in src/engine/post.ts.

export const chargeUniform = uniform(0);
export const arcUniform = uniform(0);
export const flashUniform = uniform(0);
/** Fault-red overload: the barrel rupturing, never the gun firing. */
export const blastUniform = uniform(0);

export function composeMassDriverOutput({ base, scenePass, bloomPass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();

  // Arc tear: a few sparse horizontal bands slip sideways, like a frame caught
  // in the discharge. Mixed over the engine-composited frame so the normal path
  // keeps global motion blur.
  const bandSelect = screenUV.y.mul(37).add(time.mul(6.3)).sin().mul(screenUV.y.mul(113).sin());
  const shift = bandSelect.mul(arcUniform).mul(0.024);
  const torn = sceneTexture.sample(screenUV.add(vec2(shift, float(0)))).add(bloomPass);
  const color = mix(base, torn, arcUniform.clamp(0, 0.85));

  const charge = vec3(0.3, 0.1, 0.62).mul(chargeUniform);
  const flash = vec3(0.82, 0.9, 1.0).mul(flashUniform);
  const blast = vec3(1.0, 0.16, 0.07).mul(blastUniform);
  return color.add(vec4(charge.add(flash).add(blast), float(0)));
}
