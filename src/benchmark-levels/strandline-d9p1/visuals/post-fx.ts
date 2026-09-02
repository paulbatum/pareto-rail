import { float, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Strandline underwater post-processing:
// - depthUniform: grades the water from clear turquoise shallows to deep oceanic emerald
// - damageUniform: sickly violet edge pressure when struck by parasite venom
// - flashUniform: radiant golden-green surge when liberating tissue and boss defeat
export const depthUniform = uniform(0);
export const damageUniform = uniform(0);
export const flashUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  // Depth grading: deep water leans into mysterious emerald-cyan depth
  const shallowGrade = vec3(1.0, 1.02, 1.04);
  const deepGrade = vec3(0.88, 1.05, 1.08);
  const grade = mix(shallowGrade, deepGrade, depthUniform.clamp(0, 1));
  let color = base.mul(vec4(grade, float(1)));

  // Toxic damage vignette: necrotic violet pressing from screen edges
  const centered = screenUV.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.5).clamp(0, 1).pow(2.8);
  color = color.add(vec4(vec3(0.65, 0.08, 0.85).mul(edge).mul(damageUniform), float(0)));

  // Radiant liberation flash: pure emerald-gold sunlight
  return color.add(vec4(vec3(0.6, 0.95, 0.7).mul(flashUniform), float(0)));
}
