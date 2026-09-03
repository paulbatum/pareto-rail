import { float, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects driven by the runtime: a warm lamp flash on the big
// moments, and a dark glue creep at the frame edges after the ball is gummed.
export const flashUniform = uniform(0);
export const gooUniform = uniform(0);

export function composeTinkerOutput({ base, screenUV: uvNode }: LevelPostComposeInput): LevelPostColorNode {
  const edge = uvNode.distance(vec2(0.5)).mul(1.25).smoothstep(0.55, 1.15);
  const goo = float(1).sub(edge.mul(gooUniform).mul(0.85));
  const flash = vec3(1.0, 0.86, 0.6).mul(flashUniform);
  void screenUV;
  return base.mul(vec4(goo, goo, goo, 1)).add(vec4(flash, float(0)));
}
