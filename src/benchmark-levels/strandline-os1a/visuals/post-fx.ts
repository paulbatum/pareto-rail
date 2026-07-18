import { float, mix, screenUV, sin, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Strandline's screen layer is the water itself:
// - caustics: slow refracted sunlight crawling over the whole frame, always on;
// - bloomLight: the animal's own light flaring when something big happens;
// - infection: sickly violet pressing in from the edges while the parasites
//   are winning (hull damage, spores about to land);
// - clarity: the last two bars wash the sourness out and open the water up.
export const causticUniform = uniform(0);
export const bloomLightUniform = uniform(0);
export const infectionUniform = uniform(0);
export const clarityUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const centered = screenUV.sub(vec2(0.5, 0.5));

  // Two crossed low-frequency waves read as light refracted through a surface
  // somewhere above. Kept multiplicative and shallow so it never reads as a
  // filter sitting on top of the image.
  const wave = sin(screenUV.x.mul(9.3).add(causticUniform))
    .mul(sin(screenUV.y.mul(6.1).sub(causticUniform.mul(0.72))))
    .mul(0.5)
    .add(0.5);
  const shimmer = mix(vec3(0.965, 1.0, 0.985), vec3(1.06, 1.05, 0.96), wave);
  let color = base.mul(vec4(shimmer, float(1)));

  // Clarity: the water opens out, green-gold lifts, blue crush relaxes.
  const clear = clarityUniform.clamp(0, 1);
  color = color.mul(vec4(mix(vec3(1, 1, 1), vec3(1.02, 1.1, 1.02), clear), float(1)));

  // Infection: violet at the rim. This is the only violet the frame ever adds.
  const edge = centered.length().mul(1.55).clamp(0, 1).pow(3);
  color = color.add(vec4(vec3(0.52, 0.1, 0.86).mul(edge).mul(infectionUniform), float(0)));

  // The animal's own light: green-gold, never white.
  return color.add(vec4(vec3(0.62, 1.0, 0.74).mul(bloomLightUniform), float(0)));
}
