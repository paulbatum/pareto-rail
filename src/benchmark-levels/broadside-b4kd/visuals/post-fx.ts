import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Broadside screen effects, written per-frame by the runtime:
// - flash: the catapult slam, shield collapse, and hull hits;
// - victory: the golden wash that builds while the flagship breaks apart.
// Global motion blur stays engine-owned.
export const flashUniform = uniform(0);
export const victoryUniform = uniform(0);

export function composeBroadsideOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const flash = vec3(0.75, 0.92, 1.0).mul(flashUniform);
  const victory = vec3(1.0, 0.82, 0.5).mul(victoryUniform.mul(0.4));
  return base.add(vec4(flash.add(victory), float(0)));
}
