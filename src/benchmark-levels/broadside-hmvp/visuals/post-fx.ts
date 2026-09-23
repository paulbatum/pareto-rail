import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput, LevelPostConfig } from '../../../engine/types';

// Screen effects, written every frame by visuals/index.ts:
// - flash: a gold-white overload for shield collapse, core kills, full broadsides;
// - damage: a crimson edge bleed when the hull takes a hit;
// - cyan: a cold pulse on our own salvos.
export const flashUniform = uniform(0);
export const damageUniform = uniform(0);
export const salvoUniform = uniform(0);

function compose({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(0.5);
  const edge = centered.dot(centered).mul(3.2).clamp(0, 1);
  const flash = vec3(1.0, 0.86, 0.62).mul(flashUniform);
  const damage = vec3(0.9, 0.02, 0.05).mul(damageUniform).mul(edge);
  const salvo = vec3(0.1, 0.55, 0.7).mul(salvoUniform).mul(edge.mul(0.7).add(0.1));
  return base.add(vec4(flash.add(damage).add(salvo), float(0)));
}

export const broadsidePost: LevelPostConfig = {
  clearColor: 0x030108,
  bloom: { strength: 0.75, threshold: 0.78, radius: 0.2 },
  vignette: { inner: 0.34, outer: 1.12, strength: 0.62 },
  composeOutput: compose,
};
