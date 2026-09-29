import { float, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects, driven per frame by the runtime:
//  - flash: the deck punch-through, lightning, and the Ripper's death;
//  - hurt: an orange-red rim when the hull takes a hit;
//  - hush: the docking, when the whole frame is drawn down to a calm.
// Global motion blur and bloom are engine-owned (src/engine/post.ts).
export const flashUniform = uniform(0);
export const hurtUniform = uniform(0);
export const hushUniform = uniform(0);

export function composeSkyhookOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const edge = screenUV.distance(vec2(0.5)).mul(1.55).clamp(0, 1);
  const rim = edge.mul(edge);
  const hurt = vec3(1.0, 0.16, 0.05).mul(hurtUniform.mul(rim).mul(0.85));
  const flash = vec3(0.94, 0.97, 1.0).mul(flashUniform);
  const lifted = base.add(vec4(hurt.add(flash), float(0)));
  // Hush: pull the colour toward a soft warm grey and dim it a touch.
  const grey = lifted.r.mul(0.3).add(lifted.g.mul(0.59)).add(lifted.b.mul(0.11));
  const calm = vec4(grey.mul(1.04), grey.mul(1.0), grey.mul(0.94), lifted.a);
  return lifted.mul(float(1).sub(hushUniform.mul(0.45))).add(calm.mul(hushUniform.mul(0.45)));
}
