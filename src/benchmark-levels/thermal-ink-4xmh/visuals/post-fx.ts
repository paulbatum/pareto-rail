import { float, fract, mix, screenUV, sin, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';
import { inkUniform, thermalUniform } from './materials';

// The image the imager produces. The palette swap itself happens in the
// materials — every surface already knows its infrared colour — so this pass
// only does what a screen does: sensor scan lines, sensor noise, a charcoal
// floor that never quite reaches black, and the sodium bloom when the harbour
// lamps come back at the end.
export const lampsUniform = uniform(0);
export const hurtUniform = uniform(0);

const SCAN_DENSITY = 620;
const CHARCOAL = vec3(0.028, 0.031, 0.038);

export function composeThermalInkOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Sensor scan: a fine horizontal comb plus a slow refresh band rolling up.
  const comb = screenUV.y.mul(SCAN_DENSITY).sin().mul(0.5).add(0.5).mul(0.14).oneMinus();
  const band = screenUV.y.add(time.mul(0.18)).fract().mul(6.2831).sin().mul(0.5).add(0.5).mul(0.07).oneMinus();
  const grain = fract(sin(screenUV.dot(vec2(12.9898, 78.233)).add(time.mul(11.3))).mul(43758.5453)).sub(0.5);

  const imaged = base
    .mul(vec4(vec3(comb.mul(band)), float(1)))
    .add(vec4(CHARCOAL, float(0)))
    .add(vec4(vec3(grain.mul(0.05)), float(0)));

  // Under ink without the imager the frame is not merely dark, it is dead: a
  // cold crush that leaves the reticle and the HUD as the only things left.
  const swallowed = base.mul(float(1).sub(inkUniform.mul(0.34)));
  const composed = mix(swallowed, imaged, thermalUniform);

  // Hull damage bleeds in from the edges of the frame, never over the middle of
  // it: the player still has to aim through the hit.
  const edge = screenUV.distance(vec2(0.5)).mul(1.4).clamp(0, 1).pow(1.6);
  const lamps = vec3(1.0, 0.62, 0.24).mul(lampsUniform);
  const blood = vec3(0.62, 0.05, 0.04).mul(hurtUniform.mul(edge));
  return composed.add(vec4(lamps.add(blood), float(0)));
}
