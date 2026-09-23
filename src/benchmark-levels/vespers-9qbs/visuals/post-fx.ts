import { Color } from 'three';
import { float, smoothstep, uniform, vec2, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Screen effects, written per frame by the visuals spine:
// - `breath` darkens the whole frame for the beat of silence before the rose ignites;
// - `flash` is the ignition itself, tinted by `flashTint`;
// - `wash` is the lit rose's glow filling the upper-middle of the frame.
export const breathUniform = uniform(0);
export const flashUniform = uniform(0);
export const flashTint = uniform(new Color(1, 0.86, 0.62));
export const washUniform = uniform(0);
export const washTint = uniform(new Color(1, 0.62, 0.3));

export function composeVespersOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const fromRose = screenUV.sub(vec2(0.5, 0.42)).length();
  const wash = smoothstep(float(0.8), float(0.05), fromRose).mul(washUniform);
  const lit = base.mul(float(1).sub(breathUniform));
  return lit
    .add(vec4(flashTint.mul(flashUniform), 0))
    .add(vec4(washTint.mul(wash), 0));
}
