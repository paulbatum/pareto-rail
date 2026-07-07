import { float, mix, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Helios screen effects, driven per-frame by the runtime:
// - heat shimmer wobbles the frame while skimming the photosphere;
// - flash is the gold-white overload on drops and the supernova.
// Global motion blur is engine-owned in src/engine/post.ts.
export const heatUniform = uniform(0);
export const flashUniform = uniform(0);

export function composeHeliosOutput({ base, scenePass, bloomPass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode('output');

  // Heat shimmer is a local distortion, not a motion-blur strength knob. Mix it
  // over the engine-composited frame so the normal path keeps global blur.
  const wobble = vec2(
    screenUV.y.mul(46).add(time.mul(8.2)).sin(),
    screenUV.x.mul(31).add(time.mul(6.1)).sin(),
  ).mul(heatUniform.mul(0.0038));
  const heatFrame = sceneTexture.sample(screenUV.add(wobble)).add(bloomPass);
  const color = mix(base, heatFrame, heatUniform.clamp(0, 0.65));

  const flash = vec3(1.0, 0.84, 0.58).mul(flashUniform);
  return color.add(vec4(flash, float(0)));
}
