import { float, mix, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Helios screen effects, driven per-frame by the runtime:
// - radial speed blur pulls the frame toward the vanishing point on the gate
//   transit, the corona plunge, and the boss breach;
// - heat shimmer wobbles the frame while skimming the photosphere;
// - flash is the gold-white overload on drops and the supernova.
export const speedBlurUniform = uniform(0);
export const heatUniform = uniform(0);
export const flashUniform = uniform(0);

export function composeHeliosOutput({ scenePass, bloomPass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();

  // Heat shimmer: two crossed sine ripples, amplitude on the heat knob.
  const wobble = vec2(
    screenUV.y.mul(46).add(time.mul(8.2)).sin(),
    screenUV.x.mul(31).add(time.mul(6.1)).sin(),
  ).mul(heatUniform.mul(0.0038));
  const uv = screenUV.add(wobble);

  // Radial blur: taps pulled toward screen center, mixed in by strength.
  const pull = vec2(0.5, 0.5).sub(uv);
  const sharp = sceneTexture.sample(uv);
  const blurred = sharp
    .add(sceneTexture.sample(uv.add(pull.mul(0.03))))
    .add(sceneTexture.sample(uv.add(pull.mul(0.07))))
    .add(sceneTexture.sample(uv.add(pull.mul(0.12))))
    .add(sceneTexture.sample(uv.add(pull.mul(0.18))))
    .mul(0.2);
  const color = mix(sharp, blurred, speedBlurUniform.clamp(0, 1));

  const flash = vec3(1.0, 0.84, 0.58).mul(flashUniform);
  return color.add(bloomPass).add(vec4(flash, float(0)));
}
