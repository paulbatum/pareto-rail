import { float, mix, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput, LevelPostConfig } from '../../../engine/types';

// Screen effects driven per-frame by the runtime:
// - `flashUniform` — solve moments: face conquests and the core burst;
// - `hitEdgeUniform` — reddens the frame edges when a bolt gets through.
// Base colours carry full legibility with bloom at 0; these only add mood.
export const flashUniform = uniform(0);
export const hitEdgeUniform = uniform(0);

export function composeSpeedsolveOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const edge = screenUV.sub(0.5).length().mul(1.6).clamp(0, 1);
  const redEdge = vec3(0.9, 0.06, 0.04).mul(edge.mul(hitEdgeUniform));
  const whiteout = vec3(0.97, 0.97, 1.0).mul(flashUniform);
  const color = mix(base, vec4(vec3(1), float(1)), flashUniform.mul(0.25));
  return color.add(vec4(redEdge.add(whiteout), float(0)));
}

export const speedsolvePost: LevelPostConfig = {
  clearColor: 0xe2e6ef,
  // NOTE: the shared pipeline forwards these positionally into three's
// bloom(node, strength, radius, threshold) — i.e. config.threshold lands in the
// radius slot and config.radius in the luminance-threshold slot. The pale void
// needs a HIGH luminance cutoff, so 0.88 is authored in the "radius" field.
  bloom: { strength: 0.55, threshold: 0.3, radius: 0.88 },
  vignette: { inner: 0.42, outer: 1.05, strength: 0.4 },
  composeOutput: composeSpeedsolveOutput,
};
