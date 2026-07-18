import { float, mix, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput, LevelPostConfig } from '../../../engine/types';

// STRANDLINE screen effects, driven per-frame by the runtime:
// - `flashUniform` is a soft white-green overload for big cleansing moments;
// - `hitEdgeUniform` floods the frame edges violet when a parasite strikes;
// - `sereneUniform` lifts the whole frame toward warm jade-gold in the coda.
// Base colors carry full legibility with bloom at 0; these only add mood.
export const flashUniform = uniform(0);
export const hitEdgeUniform = uniform(0);
export const sereneUniform = uniform(0);

export function composeStrandlineOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  // Radial mask, brightest at the frame edges, for the parasite-strike vignette.
  const edge = screenUV.sub(0.5).length().mul(1.55).clamp(0, 1);
  const violetEdge = vec3(0.55, 0.12, 0.62).mul(edge.mul(hitEdgeUniform));

  // Serene wash: the frame drifts toward clean sunlit jade in the coda.
  const serene = vec3(0.55, 0.85, 0.62);
  let color = mix(base, vec4(serene, float(1)), sereneUniform.mul(0.28));

  color = color.add(vec4(violetEdge, float(0)));

  const whiteout = vec3(0.85, 1.0, 0.9).mul(flashUniform);
  return color.add(vec4(whiteout, float(0)));
}

export const strandlinePost: LevelPostConfig = {
  clearColor: 0x07222e,
  bloom: { strength: 0.62, threshold: 0.6, radius: 0.4 },
  vignette: { inner: 0.34, outer: 1.06, strength: 0.5 },
  composeOutput: composeStrandlineOutput,
};
