import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Speedsolve screen effects, driven per-frame by the runtime:
// - flash is the whiteout of a face falling away and the core burst;
// - solvePulse washes the frame edges in the just-solved face's color;
// - damage presses warning red in from the frame edge while the hull is hurt.
export const flashUniform = uniform(0);
export const solvePulseUniform = uniform(0);
export const solveColorUniform = uniform(vec3(1, 1, 1));
export const damageUniform = uniform(0);

export function composeSpeedsolveOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // The void warms very slightly as the solve deepens — kept subtle so the
  // pale ground stays pale.
  let color = base;

  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.55).clamp(0, 1).pow(2.6);

  // Solved-face wash: the face's color floods in from the edges for a beat.
  color = color.add(vec4(solveColorUniform.mul(edge).mul(solvePulseUniform).mul(0.55), float(0)));

  // Hull damage: hazard red pressing in from the frame edge. On a pale frame
  // this needs to subtract light as well as add red, so it darkens too.
  const damagePress = edge.mul(damageUniform);
  color = mix(color, vec4(vec3(0.62, 0.05, 0.03), float(1)), damagePress.mul(0.55));

  // Fall-away / core-burst flash.
  return color.add(vec4(vec3(0.98, 0.97, 0.94).mul(flashUniform), float(0)));
}
