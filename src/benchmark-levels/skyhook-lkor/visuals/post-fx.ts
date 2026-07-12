import { float, mix, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput, LevelPostConfig } from '../../../engine/types';

// Skyhook screen effects, driven per-frame by the runtime:
// - `flashUniform` is the cloud-punch whiteout (brief, on the deck transit);
// - `hitEdgeUniform` reddens the frame edges when the car takes a hit;
// - `dockWarmUniform` washes the frame warm as the station swallows the car.
// Base colours carry full legibility with bloom at 0; these only add mood.
export const flashUniform = uniform(0);
export const hitEdgeUniform = uniform(0);
export const dockWarmUniform = uniform(0);

export function composeSkyhookOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  // Radial mask, brightest at the frame edges, for the damage vignette.
  const edge = screenUV.sub(0.5).length().mul(1.6).clamp(0, 1);
  const redEdge = vec3(0.9, 0.06, 0.04).mul(edge.mul(hitEdgeUniform));

  // Warm dock wash pulls the whole frame toward the bay glow as it seals.
  const warm = vec3(1.0, 0.72, 0.4);
  let color = mix(base, vec4(warm, float(1)), dockWarmUniform.mul(0.6));

  color = color.add(vec4(redEdge, float(0)));

  const whiteout = vec3(0.94, 0.96, 1.0).mul(flashUniform);
  return color.add(vec4(whiteout, float(0)));
}

export const skyhookPost: LevelPostConfig = {
  clearColor: 0x2b3138,
  // Tuned so the storm isn't a grey blob and space isn't a black void; base
  // colours stay legible at bloom 0.
  bloom: { strength: 0.55, threshold: 0.72, radius: 0.12 },
  vignette: { inner: 0.36, outer: 1.08, strength: 0.62 },
  composeOutput: composeSkyhookOutput,
};
