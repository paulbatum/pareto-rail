import { float, mix, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../engine/types';

/**
 * Three screen writes, all driven from the runtime:
 *
 * - `strobeUniform` is the amber wash of a sodium lamp sweeping over the car.
 *   It pulses on the beat and on every overpass, and it is what makes the run
 *   feel lit from above rather than evenly ambient.
 * - `blowUniform` is the boss's fireball: a hot white-amber overload.
 * - `purseUniform` is the catch. It is the only place in the whole level where
 *   the frame itself turns blue, so it lands as an event.
 */
export const strobeUniform = uniform(0);
export const blowUniform = uniform(0);
export const purseUniform = uniform(0);

const STROBE = vec3(1.0, 0.62, 0.22);
const BLOW = vec3(1.0, 0.78, 0.44);
const PURSE = vec3(0.24, 0.5, 1.0);

export function composePurseOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Lamp wash tints before it adds, so the whole frame reads sodium rather than
  // gaining a bright film over the road.
  const washed = mix(base, base.mul(vec4(STROBE.mul(1.25), float(1))), strobeUniform.clamp(0, 0.55));
  const glare = STROBE.mul(strobeUniform.mul(0.16))
    .add(BLOW.mul(blowUniform))
    .add(PURSE.mul(purseUniform));
  return washed.add(vec4(glare, float(0)));
}
