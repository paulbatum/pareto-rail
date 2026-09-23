import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Route } from './route';
import { bar, TINKER_BARS } from './timing';

// The ball director: the one place that decides where the ball is, how big it
// is, and how the chase camera frames it. The rail is only the ball's
// *baseline* route; the director arcs it sideways through fresh debris fields
// and swings the camera so the pieces stay dead ahead. Gameplay, visuals, and
// audio all read the same state.

export type Tier = 0 | 1 | 2;

export const TIER_NAMES = ['marble', 'tennis ball', 'melon'] as const;

// Core radius (world units ≈ cm) over bars: a 1.8 cm marble, a tennis ball
// after the bar-9 size-up, a melon after bar 19, heavier through the spill.
const RADIUS_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.9],
  [8.55, 1.05],
  [9.2, 3.0],
  [18.55, 3.4],
  [19.2, 5.0],
  [29.5, 5.8],
];

// Chase distance from ball to camera. It pulls back less than the ball grows,
// so each size-up visibly fattens the ball on screen.
const VIEW_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, 12],
  [8.55, 12.6],
  [9.3, 23],
  [18.55, 24],
  [19.3, 30],
  [TINKER_BARS.spill, 32],
  [29.5, 34],
  [31, 38],
];

/** Chase distance of each size tier: enemies author their lanes in these units. */
export const TIER_VIEW: Record<Tier, number> = { 0: 12, 1: 23.5, 2: 31 };
/** Core radius of each tier, for lane geometry. */
export const TIER_RADIUS: Record<Tier, number> = { 0: 0.95, 1: 3.2, 2: 5.2 };
/** Enemy build scale per tier, relative to the marble-tier models. */
export const TIER_SCALE: Record<Tier, number> = { 0: 1, 1: 2.05, 2: 2.75 };

export const CAMERA_ELEVATION_DEG = 21;
// The ball sits this far below the centre of view (degrees), leaving the
// table ahead and the air above it for targets.
export const BALL_DROP_DEG = 13.5;
const MAX_LATERAL = 0.42; // of chase distance
const FOCUS_RESPONSE = 3.2;
const LATERAL_STIFFNESS = 7;

export type DebrisField = {
  id: number;
  /** Route distance of the field centre. */
  s: number;
  lateral: number;
  center: Vector3;
  radius: number;
  bornAt: number;
  consumed: boolean;
  tier: Tier;
};

export type BallDirector = ReturnType<typeof createBallDirector>;

export function createBallDirector(route: Route) {
  const position = new Vector3();
  const velocity = new Vector3();
  const focus = new Vector3(0, 0, -1);
  const focusTarget = new Vector3();
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const railPoint = new Vector3();
  const fields: DebrisField[] = [];
  const fieldByEnemy = new Map<number, DebrisField>();
  // A camera, not a plain Object3D: camera lookAt faces -Z, matching the runner's pose.
  const edgeBase = new PerspectiveCamera();
  const edgeDelta = new Quaternion();
  const edgeIdentity = new Quaternion();
  const lookTarget = new Vector3();

  let runTime = 0;
  let distance = 0;
  let lateral = 0;
  let lateralVelocity = 0;
  let radius = RADIUS_KEYS[0][1];
  let view = VIEW_KEYS[0][1];
  let speed = 0;
  let nextFieldId = 1;
  let bonusRadius = 0;
  let spillWeight = 0;
  let fieldWeight = 0;
  let initialized = false;
  let coastSpeed = 0;
  let heartCleared = false;

  function reset() {
    fields.length = 0;
    fieldByEnemy.clear();
    runTime = 0;
    distance = 0;
    lateral = 0;
    lateralVelocity = 0;
    bonusRadius = 0;
    spillWeight = 0;
    fieldWeight = 0;
    heartCleared = false;
    initialized = false;
    step(0, 0, true);
  }

  const frameAt = route.frameAt;

  function tierAt(time: number): Tier {
    const b = time / bar(1);
    if (b < 8.9) return 0;
    if (b < 18.9) return 1;
    return 2;
  }

  function step(time: number, dt: number, snap = false) {
    runTime = time;
    const b = time / bar(1);
    distance = route.distanceAtTime(time);
    radius = keyed(RADIUS_KEYS, b) + bonusRadius;
    view = keyed(VIEW_KEYS, b);
    const frame = frameAt(distance);

    // --- lateral: the ball's own lively weave, overridden by debris fields.
    for (const field of fields) {
      if (!field.consumed && distance > field.s + field.radius + radius * 0.5) field.consumed = true;
    }
    const weave = Math.sin(time * 0.83 + 0.6) * 0.1 + Math.sin(time * 0.37 + 2.1) * 0.06;
    let targetLateral = weave * view;
    let nearest: DebrisField | null = null;
    for (const field of fields) {
      if (field.consumed) continue;
      const ahead = field.s - distance;
      if (ahead < -field.radius || ahead > view * 2.6) continue;
      if (!nearest || field.s < nearest.s) nearest = field;
    }
    const maxLateral = MAX_LATERAL * view * (spillWeight > 0.5 ? 0.35 : 1);
    let wantField = 0;
    if (nearest) {
      targetLateral = nearest.lateral;
      wantField = MathUtils.clamp(1 - (nearest.s - distance) / (view * 2.6), 0.25, 1);
    }
    targetLateral = MathUtils.clamp(targetLateral, -maxLateral, maxLateral);
    if (snap) {
      lateral = targetLateral;
      lateralVelocity = 0;
    } else if (dt > 0) {
      const damping = 2 * Math.sqrt(LATERAL_STIFFNESS);
      lateralVelocity += (LATERAL_STIFFNESS * (targetLateral - lateral) - damping * lateralVelocity) * dt;
      const maxSpeed = view * 1.1;
      lateralVelocity = MathUtils.clamp(lateralVelocity, -maxSpeed, maxSpeed);
      lateral = MathUtils.clamp(lateral + lateralVelocity * dt, -maxLateral * 1.1, maxLateral * 1.1);
    }

    const previous = tmp2.copy(position);
    position.copy(frame.position).addScaledVector(frame.right, lateral);
    position.y = radius;
    if (!snap && dt > 0 && initialized) {
      velocity.copy(position).sub(previous).divideScalar(dt);
      velocity.y = 0;
      speed = velocity.length();
    } else {
      velocity.copy(frame.tangent).multiplyScalar(route.speedAt(time));
      speed = velocity.length();
    }
    initialized = true;

    // --- focus: where the camera looks. Route ahead by default, swung to the
    // spill during the orbit, and pulled onto the nearest fresh debris.
    const aheadFrame = frameAt(distance + view * 1.3);
    focusTarget.copy(aheadFrame.position).sub(position).setY(0);
    if (focusTarget.lengthSq() < 1e-6) focusTarget.copy(frame.tangent);
    focusTarget.normalize();

    const targetSpill = spillFocusWeight(b);
    spillWeight = snap ? targetSpill : MathUtils.lerp(spillWeight, targetSpill, 1 - Math.exp(-2.5 * dt));
    if (spillWeight > 0.001) {
      tmp.copy(route.spillCenter).sub(position).setY(0);
      if (tmp.lengthSq() > 1) {
        tmp.normalize();
        focusTarget.lerp(tmp, spillWeight).normalize();
      }
    }
    fieldWeight = snap ? wantField : MathUtils.lerp(fieldWeight, wantField, 1 - Math.exp(-3 * dt));
    if (nearest && fieldWeight > 0.001) {
      tmp.copy(nearest.center).sub(position).setY(0);
      if (tmp.length() > radius * 2) {
        tmp.normalize();
        focusTarget.lerp(tmp, fieldWeight * 0.55 * (1 - spillWeight * 0.6)).normalize();
      }
    }
    if (snap) focus.copy(focusTarget);
    else {
      focus.lerp(focusTarget, 1 - Math.exp(-FOCUS_RESPONSE * dt)).setY(0);
      if (focus.lengthSq() < 1e-6) focus.copy(focusTarget);
      focus.normalize();
    }
  }

  function spillFocusWeight(b: number) {
    if (b < TINKER_BARS.spillReveal) return 0;
    if (b < TINKER_BARS.spill) return smooth((b - TINKER_BARS.spillReveal) / 1) * 0.9;
    if (b < 29.2) return 0.9;
    if (b < TINKER_BARS.heartCut) return 0.9 * (1 - smooth((b - 29.2) / 0.8));
    return 0;
  }

  /** Place the chase camera. `runnerLook` is where the engine aimed before any level override. */
  function placeCamera(camera: PerspectiveCamera, options: { runnerPosition?: Vector3; runnerLook?: Vector3; edgeWeight?: number } = {}) {
    // Recover the player's edge-look rotation from what the runner applied,
    // so our framing replaces its rail pose without eating the steer.
    edgeDelta.identity();
    const edgeWeight = options.edgeWeight ?? 0;
    if (options.runnerPosition && options.runnerLook && edgeWeight > 0 && options.runnerPosition.distanceToSquared(options.runnerLook) > 1e-4) {
      edgeBase.position.copy(options.runnerPosition);
      edgeBase.lookAt(options.runnerLook);
      edgeDelta.copy(edgeBase.quaternion).invert().multiply(camera.quaternion);
      if (edgeWeight < 1) edgeDelta.slerp(edgeIdentity, 1 - edgeWeight);
    }

    const elevation = MathUtils.degToRad(CAMERA_ELEVATION_DEG + (spillWeight * 3));
    const back = view * Math.cos(elevation);
    const up = view * Math.sin(elevation);
    camera.position.copy(position).addScaledVector(focus, -back);
    camera.position.y = position.y + up;
    const pitch = -(elevation - MathUtils.degToRad(BALL_DROP_DEG));
    lookTarget.copy(camera.position)
      .addScaledVector(focus, Math.cos(pitch) * 10)
      .add(tmp.set(0, Math.sin(pitch) * 10, 0));
    camera.lookAt(lookTarget);
    camera.quaternion.multiply(edgeDelta);
    camera.updateMatrixWorld();
  }

  /** Register a burst of rescued pieces. Returns the field the ball will arc through. */
  function addField(enemyId: number, worldPosition: Vector3, options: { minAhead?: number; maxAhead?: number; scatter?: number } = {}) {
    const minAhead = (options.minAhead ?? 0.45) * view;
    const maxAhead = (options.maxAhead ?? 2.1) * view;
    // Closest route point to the kill, searched just around the ball.
    let bestS = distance;
    let bestD = Infinity;
    for (let s = distance - view * 0.5; s <= distance + view * 4; s += view / 10) {
      railPoint.copy(frameAt(s).position);
      const d = railPoint.distanceToSquared(tmp.set(worldPosition.x, 0, worldPosition.z));
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    const frame = frameAt(bestS);
    const signedLateral = tmp.set(worldPosition.x, 0, worldPosition.z).sub(frame.position).dot(frame.right);
    const s = MathUtils.clamp(bestS + view * 0.25, distance + minAhead, distance + maxAhead);
    const fieldFrame = frameAt(s);
    const maxLateral = MAX_LATERAL * view * (spillWeight > 0.5 ? 0.35 : 0.85);
    const fieldLateral = MathUtils.clamp(signedLateral * 0.6 + (options.scatter ?? 0) * view, -maxLateral, maxLateral);
    const field: DebrisField = {
      id: nextFieldId,
      s,
      lateral: fieldLateral,
      center: fieldFrame.position.clone().addScaledVector(fieldFrame.right, fieldLateral).setY(0),
      radius: Math.max(radius * 1.6, view * 0.09),
      bornAt: runTime,
      consumed: false,
      tier: tierAt(runTime),
    };
    nextFieldId += 1;
    fields.push(field);
    if (fields.length > 48) fields.shift();
    fieldByEnemy.set(enemyId, field);
    return field;
  }

  /** Coast after the run: the ball rolls on across the clean table and slows. */
  function coast(dt: number) {
    coastSpeed = Math.max(0, coastSpeed - dt * 3.2);
    distance += coastSpeed * dt;
    const frame = frameAt(distance);
    lateral *= Math.exp(-dt * 1.5);
    position.copy(frame.position).addScaledVector(frame.right, lateral);
    position.y = radius;
    velocity.copy(frame.tangent).multiplyScalar(coastSpeed);
    speed = coastSpeed;
  }

  function beginCoast() {
    coastSpeed = Math.max(speed, 6);
  }

  function growBonus(amount: number) {
    bonusRadius += amount;
    radius += amount;
  }

  reset();

  return {
    reset,
    step,
    placeCamera,
    addField,
    coast,
    beginCoast,
    growBonus,
    tierAt,
    frameAt,
    fieldFor(enemyId: number) {
      return fieldByEnemy.get(enemyId);
    },
    markHeartCleared() {
      heartCleared = true;
    },
    get heartCleared() {
      return heartCleared;
    },
    get fields() {
      return fields as readonly DebrisField[];
    },
    get position() {
      return position;
    },
    get velocity() {
      return velocity;
    },
    get focus() {
      return focus;
    },
    get radius() {
      return radius;
    },
    get view() {
      return view;
    },
    get distance() {
      return distance;
    },
    get lateral() {
      return lateral;
    },
    get speed() {
      return speed;
    },
    get runTime() {
      return runTime;
    },
    get spillWeight() {
      return spillWeight;
    },
    route,
  };
}

function keyed(keys: ReadonlyArray<readonly [number, number]>, x: number) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [x1, v1] = keys[i];
    if (x <= x1) {
      const [x0, v0] = keys[i - 1];
      return MathUtils.lerp(v0, v1, smooth((x - x0) / Math.max(1e-4, x1 - x0)));
    }
  }
  return keys[keys.length - 1][1];
}

function smooth(t: number) {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
