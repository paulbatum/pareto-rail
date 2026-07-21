import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// Mass Driver screen effects, driven per frame by the runtime:
// - charge is the firing charge building down the barrel: a violet-white bloom
//   that grows out of the vanishing point and washes the edges last;
// - flash is the discrete overload — a coil bank letting go, an interlock
//   blowing, and finally the shot itself;
// - flashTint lets the same flash path read as arc white for the gun firing and
//   as fault red for a barrel breach.
// Global motion blur is engine-owned in src/engine/post.ts.
export const chargeUniform = uniform(0);
export const flashUniform = uniform(0);
export const flashTintUniform = uniform(vec3(1.0, 0.94, 1.0));

export function composeMassDriverOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  // Distance from screen centre — the charge arrives from down the bore, so it
  // is brightest at the vanishing point and reaches the corners last.
  const centred = screenUV.sub(0.5);
  const radius = centred.length().mul(2.0).clamp(0, 1);
  const core = float(1).sub(radius).clamp(0, 1);
  const bore = core.mul(core).mul(core);

  const charge = vec3(0.42, 0.24, 0.95).mul(chargeUniform.mul(0.55))
    .add(vec3(0.8, 0.78, 1.0).mul(bore.mul(chargeUniform).mul(0.85)));

  const flash = flashTintUniform.mul(flashUniform);

  return base.add(vec4(charge.add(flash), float(0)));
}
