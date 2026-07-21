import { float, mix, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Mass Driver screen effects, driven per-frame by the runtime:
// - `flash` is the electric white-out: coil overloads, the muzzle, the burst;
// - `charge` is the violet field bias that creeps in as the firing charge
//   builds, so the frame itself is visibly holding voltage before the finale;
// - `warp` squeezes the frame toward the bore centre during the launch.
// Global motion blur stays engine-owned in src/engine/post.ts.
export const flashUniform = uniform(0);
export const chargeUniform = uniform(0);
export const warpUniform = uniform(0);

export function composeMassDriverOutput({ base, scenePass, bloomPass, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const sceneTexture = scenePass.getTextureNode();

  // Launch warp: a radial pull toward the vanishing point. It only ever runs
  // at the muzzle, where the payload stops being accelerated and starts flying.
  const centred = screenUV.sub(vec2(0.5, 0.5));
  const pulled = screenUV.sub(centred.mul(warpUniform.mul(0.09)));
  const warpFrame = sceneTexture.sample(pulled).add(bloomPass);
  const color = mix(base, warpFrame, warpUniform.clamp(0, 1));

  // Charge bias: violet, and pushed into the corners rather than flat, so the
  // middle of the bore stays readable while the frame gets visibly hot.
  const corner = centred.length().mul(1.5).clamp(0, 1);
  const charge = vec3(0.34, 0.10, 0.66).mul(chargeUniform).mul(corner.add(0.35));

  const flash = vec3(0.72, 0.86, 1.0).mul(flashUniform);
  return color.add(vec4(charge.add(flash), float(0)));
}
