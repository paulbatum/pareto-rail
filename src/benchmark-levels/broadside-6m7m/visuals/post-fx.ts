import { float, mix, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects written by the runtime each frame:
// - flash: the catapult launch, full broadsides, and the flagship's death (ice-cyan white);
// - hurt: crimson bleeding in from the frame edge when the hull takes a hit;
// - shield: a brief crimson-orange wash when the flagship shield swats a volley;
// - dawn: the gold victory grade during the pull-out.
export const flashUniform = uniform(0);
export const hurtUniform = uniform(0);
export const shieldUniform = uniform(0);
export const dawnUniform = uniform(0);

export function composeBroadsideOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const edge = smoothstep(float(0.35), float(0.95), screenUV.distance(vec2(0.5)).mul(1.25));
  const hurt = vec3(0.9, 0.05, 0.04).mul(edge).mul(hurtUniform);
  const shield = vec3(1.0, 0.35, 0.1).mul(edge.mul(0.6).add(0.2)).mul(shieldUniform);
  const flash = vec3(0.78, 0.95, 1.0).mul(flashUniform);
  const graded = mix(base, base.mul(vec4(1.08, 0.98, 0.82, 1.0)).add(vec4(0.05, 0.03, 0.0, 0.0)), dawnUniform);
  return graded.add(vec4(flash.add(hurt).add(shield), float(0)));
}
