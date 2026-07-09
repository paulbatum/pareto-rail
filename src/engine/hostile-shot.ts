import { MathUtils, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

export type HomingSteerParams = {
  baseSpeed: number;
  maxSpeed: number;
  accel: number; // speed gain per second of age
  turnRate: number; // velocity lerp factor per second
};

/** Advance a homing shot one step: speed ramps with age, velocity turns toward the target, position integrates. */
export function steerHomingShot(
  position: Vector3,
  velocity: Vector3,
  target: Vector3,
  age: number,
  dt: number,
  params: HomingSteerParams,
): void {
  const speed = Math.min(params.maxSpeed, params.baseSpeed + age * params.accel);
  const desired = target.clone().sub(position).normalize().multiplyScalar(speed);
  velocity.lerp(desired, Math.min(1, dt * params.turnRate));
  position.addScaledVector(velocity, dt);
}

/** True once a shot is far enough behind the camera plane to despawn. */
export function shotBehindCamera(camera: PerspectiveCamera, position: Vector3, margin = 3): boolean {
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  return position.clone().sub(camera.position).dot(forward) < -margin;
}

export type HostileShotImpactState = {
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type HostileShotImpactConfig = {
  hitDistance?: number;
  impactBrake?: number;
  damageDistance?: number;
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

const HOSTILE_SHOT_INTERCEPT_GRACE = 0.45;
const HOSTILE_SHOT_CENTER_IMPACT_HALF_SIZE_NDC = 0.5;
const HOSTILE_SHOT_CENTERLINE_DEPTH_FRACTION = 0.62;

const DEFAULT_HOSTILE_SHOT_IMPACT = {
  hitDistance: 2.4,
  impactBrake: 0.35,
  damageDistance: 0.65,
} satisfies Required<HostileShotImpactConfig>;

/** Point hostile shots should steer toward so they visibly converge on the center of the player's view. */
export function hostileShotAimPoint(
  camera: PerspectiveCamera,
  shotPosition: Vector3,
  impactDistance = DEFAULT_HOSTILE_SHOT_IMPACT.hitDistance,
): Vector3 {
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const depth = shotPosition.clone().sub(camera.position).dot(forward);
  const targetDepth = Math.max(impactDistance, depth * HOSTILE_SHOT_CENTERLINE_DEPTH_FRACTION);
  return camera.position.clone().addScaledVector(forward, targetDepth);
}

export function updateHostileShotImpact(context: HostileShotImpactContext): HostileShotImpactResult {
  const config = { ...DEFAULT_HOSTILE_SHOT_IMPACT, ...context.config };
  const forward = new Vector3();
  context.camera.getWorldDirection(forward);

  if (context.intercepted) {
    context.state.interceptUntil = Math.max(context.state.interceptUntil ?? 0, context.age + HOSTILE_SHOT_INTERCEPT_GRACE);
  }

  if (context.state.impactAt === undefined) {
    if (context.position.distanceTo(context.camera.position) > config.hitDistance) return { phase: 'approach' };
    if (!shotInCenterImpactArea(context.camera, context.position, HOSTILE_SHOT_CENTER_IMPACT_HALF_SIZE_NDC)) return { phase: 'approach' };
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

function shotInCenterImpactArea(camera: PerspectiveCamera, position: Vector3, centerImpactHalfSizeNdc: number) {
  const centerHalfSize = Math.max(0.08, Math.min(1, centerImpactHalfSizeNdc));
  const toShot = position.clone().sub(camera.position);
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  if (toShot.dot(forward) <= 0) return false;

  const projected = position.clone().project(camera);
  return (
    Number.isFinite(projected.x)
    && Number.isFinite(projected.y)
    && Math.abs(projected.x) <= centerHalfSize
    && Math.abs(projected.y) <= centerHalfSize
  );
}
