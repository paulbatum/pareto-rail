import { float, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';
import { flashU, hurtU } from './uniforms';

// Two screen responses, both driven by the runtime:
//  - flashU: a gold-white bloom for a six-lock volley and for the parent's death;
//  - hurtU: bruise-violet at the screen edges when a spore reaches the hull.
// Motion blur and bloom are engine-owned; this only adds over the composed frame.
export function composeStrandlineOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const edge = screenUV.sub(0.5).length().mul(1.55).pow(2.4).clamp(0, 1);
  const flash = vec3(1.0, 0.9, 0.58).mul(flashU);
  const hurt = vec3(0.7, 0.12, 0.5).mul(edge.mul(0.9).add(0.12)).mul(hurtU);
  return base.add(vec4(flash.add(hurt), float(0)));
}
