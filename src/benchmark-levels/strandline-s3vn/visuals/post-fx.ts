import { float, mix, screenUV, sin, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Strandline's screen layer is the water itself:
// - caustics, a soft interference pattern falling from the surface above;
// - depth, which pulls red out of the frame as the deep blue takes over;
// - sick, violet pressure at the frame edge while the infestation has you;
// - flash, the clean green-gold bloom of the animal answering a big hit.
export const causticTime = uniform(0);
export const depthUniform = uniform(0);
export const sickUniform = uniform(0);
export const flashUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const grade = mix(vec3(1, 1, 1), vec3(0.74, 0.99, 1.14), depthUniform.clamp(0, 1));
  let color = base.mul(vec4(grade, float(1)));

  // Sunlight refracting through a moving surface. Two beat frequencies give a
  // slow crawl rather than a repeating pattern, and it fades out toward the
  // bottom of the frame where the light has not reached.
  const u = screenUV.x;
  const v = screenUV.y;
  const band = sin(u.mul(16.0).add(v.mul(4.5)).add(causticTime.mul(0.85)))
    .mul(sin(u.mul(6.8).sub(v.mul(2.6)).sub(causticTime.mul(0.5))))
    .mul(0.5)
    .add(0.5);
  const fromAbove = smoothstep(float(0.0), float(0.85), v);
  color = color.add(vec4(vec3(0.26, 0.62, 0.54).mul(band.pow(float(3.0))).mul(fromAbove).mul(0.085), float(0)));

  const edge = screenUV.sub(vec2(0.5, 0.5)).length().mul(1.7).clamp(0, 1).pow(float(3.0));
  color = color.add(vec4(vec3(0.62, 0.1, 0.88).mul(edge).mul(sickUniform), float(0)));

  return color.add(vec4(vec3(0.6, 1.0, 0.82).mul(flashUniform), float(0)));
}
