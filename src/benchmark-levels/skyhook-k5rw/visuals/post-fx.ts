import { Vector3 } from 'three';
import { float, mix, uniform, vec2, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Two screen effects, both written by the runtime:
//
//   whiteout — the cloud deck. Punching through the layer floods the frame with
//              flat grey and then dumps it as the sky opens underneath you.
//   strain   — the climber's own airframe: a cold shear rolling up the frame
//              while the car is taking damage or the Descender is hauling on it.
//
// Global motion blur stays engine-owned in src/engine/post.ts.
export const whiteoutUniform = uniform(0);
export const whiteoutTintUniform = uniform(new Vector3(0.78, 0.8, 0.84));
export const strainUniform = uniform(0);
export const strainPhaseUniform = uniform(0);

export function composeSkyhookOutput({ base, scenePass, bloomPass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();

  // Airframe shear: a horizontal wobble that runs up the frame, resampled from
  // the scene and mixed back over the composited image so global blur survives.
  const shear = vec2(screenUV.y.mul(26).add(strainPhaseUniform).sin().mul(strainUniform.mul(0.007)), float(0));
  const shearFrame = sceneTexture.sample(screenUV.add(shear)).add(bloomPass);
  const color = mix(base, shearFrame, strainUniform.clamp(0, 0.8));

  // Cloud whiteout: flat and colourless. It swallows contrast instead of adding light.
  return mix(color, vec4(whiteoutTintUniform, float(1)), whiteoutUniform.clamp(0, 1));
}
