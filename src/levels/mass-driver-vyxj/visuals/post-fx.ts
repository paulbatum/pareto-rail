import { float, mix, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Mass Driver screen effects, driven per-frame by the runtime:
// - flash is the blue-white electric overload (stage drops, interlock
//   discharges, the firing itself);
// - interference is horizontal arc jitter while the jammed charge builds —
//   the picture itself starts losing containment.
// Global motion blur is engine-owned in src/engine/post.ts.
export const flashUniform = uniform(0);
export const interferenceUniform = uniform(0);

export function composeMassDriverOutput({ base, scenePass, bloomPass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();

  // Arc interference: thin scan bands shear the frame sideways, strobing at
  // mains-hum speed. Kept subtle; it reads as electrical stress, not glitch art.
  const band = screenUV.y.mul(90).add(time.mul(13)).sin();
  const strobe = time.mul(47).sin().mul(0.5).add(0.5);
  const shear = vec2(band.mul(strobe).mul(interferenceUniform).mul(0.006), 0);
  const shearedFrame = sceneTexture.sample(screenUV.add(shear)).add(bloomPass);
  const color = mix(base, shearedFrame, interferenceUniform.clamp(0, 0.7));

  const flash = vec3(0.78, 0.87, 1.0).mul(flashUniform);
  return color.add(vec4(flash, float(0)));
}
