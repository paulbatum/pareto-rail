import { float, mix, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Skyhook screen effects, driven per-frame by the runtime:
// - flash: the white-out punching through the cloud deck, lightning, the kill;
// - hull: a warm edge bloom when the climber takes a hit;
// - dock: a quiet desaturation as everything decelerates into the bay.
// Global motion blur is engine-owned in src/engine/post.ts.
export const flashUniform = uniform(0);
export const hullUniform = uniform(0);
export const dockUniform = uniform(0);

export function composeSkyhookOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const grey = base.rgb.dot(vec3(0.3, 0.59, 0.11));
  const calm = mix(base.rgb, vec3(grey, grey, grey).mul(0.9), dockUniform.mul(0.4));
  const edge = smoothstep(float(0.42), float(0.95), screenUV.distance(vec2(0.5)).mul(1.35));
  const hull = vec3(1.0, 0.36, 0.08).mul(edge).mul(hullUniform).mul(0.7);
  const flash = vec3(0.95, 0.97, 1.0).mul(flashUniform);
  return vec4(calm.add(hull).add(flash), base.a);
}
