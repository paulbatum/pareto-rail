import { MathUtils, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

export type HostileShotImpactState = {
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type HostileShotImpactConfig = {
  hitDistance?: number;
  impactBrake?: number;
  damageDistance?: number;
  interceptGrace?: number;
};

export type HostileShotImpactContext = {
  age: number;
  camera: PerspectiveCamera;
  position: Vector3;
  velocity: Vector3;
  state: HostileShotImpactState;
  intercepted?: boolean;
  config?: HostileShotImpactConfig;
};

export type HostileShotImpactResult =
  | { phase: 'approach' }
  | { phase: 'braking'; damaged: boolean };

export const DEFAULT_HOSTILE_SHOT_IMPACT = {
  hitDistance: 2.4,
  impactBrake: 0.35,
  damageDistance: 0.65,
  interceptGrace: 0.45,
} satisfies Required<HostileShotImpactConfig>;

export function updateHostileShotImpact(context: HostileShotImpactContext): HostileShotImpactResult {
  const config = { ...DEFAULT_HOSTILE_SHOT_IMPACT, ...context.config };
  const forward = new Vector3();
  context.camera.getWorldDirection(forward);

  if (context.intercepted) {
    context.state.interceptUntil = Math.max(context.state.interceptUntil ?? 0, context.age + config.interceptGrace);
  }

  if (context.state.impactAt === undefined) {
    if (context.position.distanceTo(context.camera.position) > config.hitDistance) return { phase: 'approach' };
    const toShot = context.position.clone().sub(context.camera.position);
    context.state.impactDirection = toShot.lengthSq() > 0.0001 ? toShot.normalize() : forward.clone();
    context.state.impactAt = context.age + config.impactBrake;
    return { phase: 'braking', damaged: false };
  }

  const direction = context.state.impactDirection ?? forward;
  const brakeStart = context.state.impactAt - config.impactBrake;
  const t = MathUtils.clamp((context.age - brakeStart) / config.impactBrake, 0, 1);
  const eased = 1 - (1 - t) ** 2;
  const distance = MathUtils.lerp(config.hitDistance * 0.92, config.damageDistance, eased);
  context.position.copy(context.camera.position).addScaledVector(direction, distance);
  context.velocity.set(0, 0, 0);

  return {
    phase: 'braking',
    damaged: context.age >= context.state.impactAt && context.age >= (context.state.interceptUntil ?? -Infinity),
  };
}
