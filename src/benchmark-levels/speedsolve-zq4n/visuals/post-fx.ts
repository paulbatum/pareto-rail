import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Speedsolve grades against a pale room, so the usual tricks invert: a white
// flash would disappear into the void, and darkness is the alarming thing.
//
// - snap is the mechanical flare on a layer rotation or a face coming off;
//   it lifts the frame and pushes it slightly warm, like a shutter firing.
// - strain is hull damage, and it works by draining the room to graphite from
//   the edges in — the lights going out, not blood on the lens.
// - solve tracks how much of the cube is gone and quietly cools the grade.
export const snapUniform = uniform(0);
export const strainUniform = uniform(0);
export const solveUniform = uniform(0);

export function composeSpeedsolveOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const grade = mix(vec3(1, 1, 1), vec3(0.94, 0.97, 1.06), solveUniform.clamp(0, 1));
  let color = base.mul(vec4(grade, float(1)));

  // Hull strain: the room loses its light from the outside edge inward.
  const edge = screenUV.sub(vec2(0.5, 0.5)).length().mul(1.55).clamp(0, 1).pow(2.6);
  color = color.mul(vec4(vec3(1, 1, 1).sub(vec3(0.72, 0.78, 0.82).mul(edge).mul(strainUniform)), float(1)));

  // Shutter snap: a short, mostly-neutral lift on the machine's own accents.
  return color.add(vec4(vec3(1.0, 0.98, 0.92).mul(snapUniform), float(0)));
}
