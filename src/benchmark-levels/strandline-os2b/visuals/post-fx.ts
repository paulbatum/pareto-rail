import { cos, float, mix, screenUV, sin, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects for water. The caustic net is the level's signature: surface
// light broken into a moving lattice that plays over the whole frame, strongest
// where the water is clearest. Infestation presses violet in from the edges as
// the hull takes damage, and the bloom uniform is the animal's own light
// flooding the frame at the kill.
export const causticUniform = uniform(0.18);
export const causticTimeUniform = uniform(0);
export const infestUniform = uniform(0);
export const bloomFlashUniform = uniform(0);
/** 0 → 1 as the animal comes back to life; warms and greens the whole grade. */
export const revivalUniform = uniform(0);

export function composeStrandlineOutput({ base }: LevelPostComposeInput): LevelPostColorNode {
  const uv = screenUV;
  const t = causticTimeUniform;

  // Two interfering wave sets read as light refracted through a moving surface.
  const wave = sin(uv.x.mul(38.0).add(uv.y.mul(19.0)).add(t.mul(1.35)))
    .mul(cos(uv.y.mul(31.0).sub(uv.x.mul(13.0)).sub(t.mul(0.95))))
    .add(sin(uv.x.mul(17.0).sub(uv.y.mul(43.0)).add(t.mul(0.62))).mul(0.5));
  // A high power keeps the net to thin bright filaments instead of a haze.
  const caustic = wave.mul(0.5).add(0.5).clamp(0, 1).pow(6.0).mul(causticUniform);

  // The net brightens toward the top of the frame — the light is above you.
  const fromAbove = uv.y.mul(0.75).add(0.25);
  let color = base.add(vec4(vec3(0.2, 0.44, 0.36).mul(caustic).mul(fromAbove), float(0)));

  // Revival grade: the water warms toward green-gold as the animal recovers.
  const grade = mix(vec3(0.96, 1.0, 1.04), vec3(1.06, 1.05, 0.95), revivalUniform.clamp(0, 1));
  color = color.mul(vec4(grade, float(1)));

  // Infestation: sickly violet pressing in from outside the frame.
  const centered = uv.sub(vec2(0.5, 0.5));
  const edge = centered.length().mul(1.65).clamp(0, 1).pow(2.8);
  color = color.add(vec4(vec3(0.55, 0.06, 0.78).mul(edge).mul(infestUniform), float(0)));

  // The animal's light flooding out: green-white rather than plain white.
  return color.add(vec4(vec3(0.72, 1.0, 0.86).mul(bloomFlashUniform), float(0)));
}
