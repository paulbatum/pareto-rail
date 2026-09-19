import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import {
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import type { RailPacer } from '../../engine/rail-pacer';
import type { SpillwaySpawnData, SpillwayUpdate } from './gameplay';
import { railFrameAt, walkerTrack, type WalkerPose } from './rail';
import { hatchPoint, rackPoint, sternPoint } from './walker';
import { canyonWallPoint, nearestSpine, rimPoint, riverPoint, type WallPoint } from './world';

// Enemy motion. Every target is seated on the river, the walls or the air
// around the rail at a pacer anchor, then moved by its kind's own rules:
// skiffs fly in from the walker and carve the water, spotters flock and peel
// off in a line, pods winch down the walls and shoot rivets, clamps surface
// holding a cable across the river. Visual state the effects react to
// (landing, charge, the free swing) is written to `mesh.userData`.

type Data<R extends SpillwaySpawnData['role']> = Extract<SpillwaySpawnData, { role: R }>;

export type SkiffLaunch = 'back' | 'belly' | 'flood';

/** Seconds a pod takes to winch down from the rim and bite into the wall. */
export const POD_LOWER_SECONDS = 1.1;
/** Seconds between spotters leaving the flock, and each one's crossing time. */
export const PEEL_GAP = 0.22;
export const PEEL_SECONDS = 2;

/** Hull height above the water on its foils, at the model's scale. */
const SKIFF_RIDE = 1.15;
const SKIFF_GRAVITY = 26;
/** The widest the skiffs spread across open water, in units from the rail. */
const SKIFF_MAX_HALF_WIDTH = 24;
const POD_STANDOFF = 3.3;
/** Where the clamp jaw holds the cable above the float, at the model's scale. */
const CLAMP_JAW_HEIGHT = 3;
const MISS_GRACE = 0.3;
/** Fast enough to catch a camera running the rapids at up to 40 units a second. */
const RIVET_STEER = { baseSpeed: 22, maxSpeed: 36, accel: 14, turnRate: 8 };
/** A rivet that reaches the lens stops and bursts several units out, never in the lens itself. */
const RIVET_IMPACT = { hitDistance: 8, impactBrake: 0.22, damageDistance: 5 };
/** Closer than this without a hit, a rivet has missed: it is culled before it can fill the frame. */
const RIVET_NEAR_MISS = 4.5;
/** Half-width of the camera's clearance tube for anything on the water. */
const CAMERA_CLEARANCE = 7;
const RIVET_MAX_AGE = 10;
/** After a hull hit, cable sweeps and rivets pass harmlessly for this long, so one fumble does not cascade. */
const HULL_GRACE_SECONDS = 14;
/** Pods fire only while this far ahead, so a rivet has room to fly and to be shot down. */
const POD_FIRE_WINDOW = { near: 30, far: 62 };
const UP = new Vector3(0, 1, 0);

// ---- the walker's racks ------------------------------------------------------------

const launchPose: WalkerPose = walkerTrack(0);

/** Where a skiff leaves the walker: a slot on the rear launch rack, or the stern chute under it. */
export function skiffLaunchPoint(time: number, launch: SkiffLaunch, rack: number, out = new Vector3()) {
  return launch === 'belly' ? sternPoint(time, rack, out) : rackPoint(time, rack, out);
}

/** Flight time from the rack to the splashdown at `landAt`: longer the further the walker is. */
export function skiffFlightSeconds(landAt: number, launch: SkiffLaunch) {
  if (launch === 'flood') return 0;
  if (launch === 'belly') return 1.05;
  const distance = walkerTrack(landAt, launchPose).position.distanceTo(railFrameAt(landAt).position);
  return MathUtils.clamp(0.7 + distance / 150, 1.1, 2.8);
}

// ---- cables ----------------------------------------------------------------------------

export type CableState = {
  id: number;
  /** Jaw of each clamp, in slot order across the river. */
  jaws: Vector3[];
  held: boolean[];
  /** Where the cable meets each bank. */
  ends: [Vector3, Vector3];
  state: 'taut' | 'cut' | 'swept';
};

export function createCableRegistry() {
  const cables = new Map<number, CableState>();
  const clampSlots = new Map<number, { cable: CableState; slot: number }>();

  function claim(id: number, slots: number) {
    let cable = cables.get(id);
    if (!cable) {
      cable = {
        id,
        jaws: Array.from({ length: slots }, () => new Vector3()),
        held: new Array<boolean>(slots).fill(true),
        ends: [new Vector3(), new Vector3()],
        state: 'taut',
      };
      cables.set(id, cable);
    }
    return cable;
  }

  return {
    claim,
    register(enemyId: number, cable: CableState, slot: number) {
      clampSlots.set(enemyId, { cable, slot });
    },
    clampKilled(enemyId: number) {
      const entry = clampSlots.get(enemyId);
      if (!entry) return;
      clampSlots.delete(enemyId);
      entry.cable.held[entry.slot] = false;
      if (entry.cable.state === 'taut' && entry.cable.held.every((held) => !held)) entry.cable.state = 'cut';
    },
    /** Whether this clamp is the only one still holding its cable. */
    isLastClamp(enemyId: number) {
      const entry = clampSlots.get(enemyId);
      return entry !== undefined && entry.cable.held.filter(Boolean).length === 1 && entry.cable.held[entry.slot];
    },
    cutCount() {
      let count = 0;
      for (const cable of cables.values()) if (cable.state === 'cut') count += 1;
      return count;
    },
    reset() {
      cables.clear();
      clampSlots.clear();
    },
  };
}

export type CableRegistry = ReturnType<typeof createCableRegistry>;

// ---- helpers ---------------------------------------------------------------------------

const scratchFrameRight = new Vector3();

/** Offset from the rail, across the flattened river, of lane `lane` (-1..1 bank to bank). */
function laneLateral(curve: SpillwayUpdate['curve'], u: number, lane: number) {
  const frame = sampleRailFrame(curve, u);
  const hit = nearestSpine(frame.position.x, frame.position.z);
  const half = Math.min(hit.sample.halfWidth - 3.5, SKIFF_MAX_HALF_WIDTH);
  return lane * half - hit.lateral;
}

/**
 * Keep a lateral offset out of the tube the camera flies through: nothing on
 * the water may sit on the rail line once it is close, so it passes beside
 * the lens. Cables span the tube; their buoys do not.
 */
function clearOfCamera(lateral: number, distanceAhead: number) {
  const clearance = MathUtils.lerp(CAMERA_CLEARANCE * 0.5, CAMERA_CLEARANCE, smooth((24 - distanceAhead) / 18));
  return Math.abs(lateral) < clearance ? (lateral < 0 ? -1 : 1) * clearance : lateral;
}

function easeOutBack(t: number) {
  const x = MathUtils.clamp(t, 0, 1) - 1;
  return 1 + 2.7 * x * x * x + 1.7 * x * x;
}

const smooth = (t: number) => {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const basis = new Matrix4();
const basisX = new Vector3();
const basisZ = new Vector3();

/** Orient `quaternion` so local +X points along `outward` and +Y stays up. */
function faceOutward(quaternion: Quaternion, outward: Vector3) {
  basisX.copy(outward).setY(0).normalize();
  basisZ.crossVectors(basisX, UP).normalize();
  basis.makeBasis(basisX, UP, basisZ);
  return quaternion.setFromRotationMatrix(basis);
}

// ---- motion ---------------------------------------------------------------------------

export function createEnemyMotion({ pacer, wallPacer, cables }: { pacer: RailPacer; wallPacer: RailPacer; cables: CableRegistry }) {
  /** Rivets a player shot is already flying at: their impact waits for the shot. */
  const intercepted = new Set<number>();
  let graceUntil = -Infinity;
  const aimForward = new Vector3();
  const aimOffset = new Vector3();
  const aimPoint = new Vector3();

  /** Costs a hull point unless the player was hit moments ago. */
  function hurt(context: SpillwayUpdate) {
    // A replay restarts run time, which clears the grace.
    if (context.runTime < graceUntil - HULL_GRACE_SECONDS) graceUntil = -Infinity;
    if (context.runTime < graceUntil) return;
    graceUntil = context.runTime + HULL_GRACE_SECONDS;
    context.damagePlayer(1);
  }

  const target = new Vector3();
  const offset = new Vector3();
  const wall: WallPoint = { position: new Vector3(), normal: new Vector3(), valid: false };
  const rim = new Vector3();
  const muzzle = new Vector3();

  // ---- skiff: the arc from the rack, the splashdown, the carve ----
  function skiff(context: SpillwayUpdate, data: Data<'skiff'>) {
    const { enemy, runTime, age, curve, camera } = context;
    const mesh = enemy.mesh;
    const state = context.enemyState(() => {
      enemy.entry.lockable = data.launch === 'flood';
      return {
        from: data.launch === 'flood' ? null : skiffLaunchPoint(enemy.entry.time, data.launch, data.rack),
        previous: new Vector3(),
        y: Number.NaN,
        vy: 0,
        yaw: 0,
        roll: 0,
        pitch: 0,
        airborne: data.launch !== 'flood',
        lastAge: 0,
      };
    });
    const dt = Math.max(1e-4, age - state.lastAge);
    state.lastAge = age;

    // The water point the skiff is paced to, carving across the river.
    const sample = pacer.sample(data.landAt, runTime, data.engagement);
    const carve = Math.max(0, runTime - data.landAt);
    const lane = MathUtils.clamp(data.lane + data.weave * Math.sin(data.rate * carve + data.phase), -1, 1);
    let lateral = laneLateral(curve, sample.anchorU, lane);
    lateral = clearOfCamera(lateral, sample.distanceAheadUnits);
    riverPoint(curve, sample.anchorU, lateral, target);
    const surface = target.y + SKIFF_RIDE;

    if (runTime < data.landAt && state.from) {
      // In the air: a ballistic arc from the rack onto the water point.
      const flight = data.landAt - enemy.entry.time;
      const t = MathUtils.clamp(age / flight, 0, 1);
      const span = state.from.distanceTo(target);
      const arc = data.launch === 'belly' ? 3 : 8 + span * 0.14;
      mesh.position.lerpVectors(state.from, target, t);
      mesh.position.y = MathUtils.lerp(state.from.y, surface, data.launch === 'belly' ? t * t : t) + arc * 4 * t * (1 - t);
      state.y = mesh.position.y;
      state.vy = (mesh.position.y - state.previous.y) / dt;
      mesh.userData.phase = 'air';
    } else {
      mesh.position.copy(target);
      if (Number.isNaN(state.y)) state.y = surface;
      if (state.airborne || state.y > surface + 1.2) {
        // Off a drop (the cascade, the ski-jump lip): fall until the water catches it.
        state.airborne = true;
        state.vy -= SKIFF_GRAVITY * dt;
        state.y += state.vy * dt;
        if (state.y <= surface) {
          state.airborne = false;
          state.y = surface;
          mesh.userData.splashAt = runTime;
        }
      } else {
        const bob = Math.sin(age * 7.3 + data.phase) * 0.06;
        state.vy = (surface + bob - state.y) / dt;
        state.y = surface + bob;
      }
      mesh.position.y = state.y;
      mesh.userData.phase = state.airborne ? 'air' : 'water';
      if (!enemy.entry.lockable) enemy.entry.lockable = true;
    }

    // Nose along the motion, banked into the carve.
    const vx = (mesh.position.x - state.previous.x) / dt;
    const vz = (mesh.position.z - state.previous.z) / dt;
    if (age > 0 && vx * vx + vz * vz > 1) {
      const yaw = Math.atan2(vx, vz);
      const turn = MathUtils.euclideanModulo(yaw - state.yaw + Math.PI, Math.PI * 2) - Math.PI;
      const blend = 1 - Math.exp(-dt * (mesh.userData.phase === 'air' ? 4 : 6));
      state.yaw += turn * blend;
      state.roll = MathUtils.lerp(state.roll, MathUtils.clamp(-turn * 2.2, -0.6, 0.6), blend);
      const climb = Math.atan2(state.vy, Math.hypot(vx, vz));
      state.pitch = MathUtils.lerp(state.pitch, mesh.userData.phase === 'air' ? -climb : -0.06, blend);
    }
    mesh.rotation.set(state.pitch, state.yaw, state.roll, 'YXZ');
    state.previous.copy(mesh.position);
    mesh.userData.speed = Math.hypot(vx, vz);
    mesh.userData.carve = state.roll;
    void camera;
    return runTime > data.engagement.passTime + MISS_GRACE;
  }

  // ---- spotter: a loose flock, then one by one along a line across the screen ----
  const center = new Vector3();
  const axisRight = new Vector3();
  const axisUp = new Vector3();
  const axisForward = new Vector3();
  function spotter(context: SpillwayUpdate, data: Data<'spotter'>) {
    const { enemy, runTime, age, curve, camera } = context;
    const mesh = enemy.mesh;
    const state = context.enemyState(() => ({ previous: new Vector3(), bank: 0, lastAge: 0 }));
    const dt = Math.max(1e-4, age - state.lastAge);
    state.lastAge = age;
    const side = data.entrance === 'left' ? -1 : data.entrance === 'right' ? 1 : Math.sign(data.x || 1);

    // The flock's centre and axes. Most flocks pace the rail; the belly flock
    // holds under the walker while the camera looks up at it.
    let closing = 1;
    if (data.entrance === 'belly') {
      walkerTrack(runTime, launchPose);
      hatchPoint(runTime, center).addScaledVector(UP, -5);
      // On the dam the flock swings out over the lake, clear of the pier heads.
      if (launchPose.state === 'on-dam') center.lerp(camera.position, 0.2 * smooth(age / 1.5));
      axisRight.copy(launchPose.right);
      axisUp.copy(UP);
      axisForward.copy(launchPose.forward);
    } else {
      const sample = pacer.sample(enemy.entry.time, runTime, data.engagement);
      const frame = sampleRailFrame(curve, sample.anchorU);
      axisRight.copy(frame.right);
      axisUp.copy(frame.up);
      axisForward.copy(frame.tangent);
      center.copy(frame.position).addScaledVector(axisRight, data.x).addScaledVector(axisUp, data.y);
      closing = MathUtils.clamp(sample.distanceAheadUnits / 26, 0.55, 1);
    }

    // Formation slot: a slowly turning ring that breathes.
    const angle = (data.slot / data.size) * Math.PI * 2 + age * 0.6 * side;
    const radius = 3.8 + Math.sin(age * 1.7 + data.slot * 1.3) * 0.5;
    offset.set(
      Math.cos(angle) * radius * 1.35 + Math.sin(age * 0.7 + data.size) * 1.4,
      Math.sin(angle) * radius * 0.6 + Math.sin(age * 1.9 + data.slot) * 0.35,
      Math.sin(angle) * radius * 0.8,
    );

    // Peel: along a line across the upper screen, lower as it closes so it stays in frame.
    const peel = age - data.peelAt - data.slot * PEEL_GAP;
    if (peel > 0) {
      const p = peel / PEEL_SECONDS;
      if (p > 1) return true;
      const exitX = -side * 44 - data.x;
      const lineY = data.lineY * closing - data.y;
      offset.x = MathUtils.lerp(offset.x, exitX, p ** 1.5);
      offset.y = MathUtils.lerp(offset.y, lineY, smooth(p * 3));
      offset.z *= 1 - smooth(p * 2);
    }

    // Entrance: in from the side and above, or dropped out of the belly hatch.
    const enter = smooth(age / (data.entrance === 'belly' ? 1.2 : 1));
    if (data.entrance === 'belly') {
      offset.y += 7 * (1 - enter);
      offset.multiplyScalar(0.3 + 0.7 * enter);
    } else {
      offset.x += side * 26 * (1 - enter);
      offset.y += (data.entrance === 'dive' ? 22 : 11) * (1 - enter);
      offset.z += 14 * (1 - enter);
    }
    mesh.position.copy(center)
      .addScaledVector(axisRight, offset.x)
      .addScaledVector(axisUp, offset.y)
      .addScaledVector(axisForward, offset.z);

    // Face the camera, banked into the direction of flight and pitched to show the rotors.
    const velocity = target.copy(mesh.position).sub(state.previous).divideScalar(dt);
    state.previous.copy(mesh.position);
    const right = scratchFrameRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const sideways = age > 0 ? velocity.dot(right) : 0;
    state.bank = MathUtils.lerp(state.bank, MathUtils.clamp(-sideways * 0.035, -0.7, 0.7), 1 - Math.exp(-dt * 5));
    mesh.quaternion.copy(camera.quaternion);
    mesh.rotateZ(state.bank + Math.sin(age * 2.3 + data.slot) * 0.08);
    mesh.rotateX(0.8 + Math.sin(age * 1.4 + data.slot) * 0.05);
    return runTime > data.engagement.passTime + MISS_GRACE;
  }

  // ---- pod: winched down the wall, bites in, shoots rivets; one hit tears it loose ----
  function pod(context: SpillwayUpdate, data: Data<'pod'>) {
    const { enemy, runTime, age, curve, camera } = context;
    const mesh = enemy.mesh;
    const sample = wallPacer.sample(enemy.entry.time, runTime, data.engagement);
    const u = sample.anchorU;
    const state = context.enemyState(() => ({ nextShot: data.firstShot, looseAt: -1, normal: new Vector3(), cableTop: new Vector3() }));

    canyonWallPoint(curve, u, data.side, data.height, wall);
    const normal = state.normal;
    let standoff = POD_STANDOFF;
    if (wall.valid) {
      // Where the river is wide the winch hangs the pod further out on its boom.
      standoff += Math.max(0, nearestSpine(wall.position.x, wall.position.z).sample.halfWidth - 24) * 0.4;
      target.copy(wall.position).addScaledVector(wall.normal, standoff);
      normal.copy(wall.normal);
      rimPoint(curve, u, data.side, rim);
    } else {
      const frame = sampleRailFrame(curve, u);
      target.copy(offsetFromRail(curve, u, offset.set(data.side * 17, data.height - 2.5, 0)));
      normal.copy(frame.right).setY(0).normalize().multiplyScalar(-data.side);
      rim.copy(target).setY(target.y + 40);
    }
    state.cableTop.copy(rim).addScaledVector(normal, standoff);

    const lowering = age / POD_LOWER_SECONDS;
    if (lowering < 1) {
      mesh.position.copy(target);
      mesh.position.y = MathUtils.lerp(rim.y - 2, target.y, easeOutBack(lowering));
      mesh.position.addScaledVector(normal, (1 - lowering) * 1.5);
    } else {
      mesh.position.copy(target);
    }

    // A hit tears the claw off the rock: it swings out on the cable, the swing dying away.
    if (enemy.hitPointsRemaining < 2 && state.looseAt < 0) state.looseAt = age;
    let tilt = Math.sin(age * 1.6 + data.side) * 0.04;
    if (state.looseAt >= 0) {
      const t = age - state.looseAt;
      const swing = Math.sin(t * 2.6) * Math.exp(-t * 0.35);
      mesh.position.addScaledVector(normal, 1.2 + 2.8 * swing);
      mesh.position.y -= 0.6 * swing * swing;
      tilt = -swing * 0.45;
    }
    faceOutward(mesh.quaternion, normal);
    mesh.rotateZ(tilt * data.side);
    mesh.userData.cableTop = state.cableTop;
    mesh.userData.loose = state.looseAt >= 0;
    mesh.userData.wallNormal = normal;

    // Rivets, telegraphed by the charging lamp.
    const anchored = lowering >= 1;
    mesh.userData.charge = anchored ? MathUtils.clamp(1 - (state.nextShot - age) / 0.7, 0, 1) : 0;
    // A loose pod swings on its cable and cannot aim.
    if (anchored && state.looseAt < 0 && age >= state.nextShot) {
      state.nextShot = age + data.every;
      if (sample.distanceAheadUnits > POD_FIRE_WINDOW.near && sample.distanceAheadUnits < POD_FIRE_WINDOW.far) {
        muzzle.copy(mesh.position).addScaledVector(normal, 2.9).addScaledVector(UP, -0.15);
        fireRivet(context, muzzle);
        mesh.userData.firedAt = runTime;
      }
    }
    void camera;
    return runTime > data.engagement.passTime + MISS_GRACE;
  }

  /**
   * The camera outruns a shot aimed at the usual point well down its centreline,
   * so rivets cut across to a point just ahead of the lens.
   */
  function rivetAimPoint(camera: SpillwayUpdate['camera'], from: Vector3) {
    camera.getWorldDirection(aimForward);
    const depth = aimOffset.copy(from).sub(camera.position).dot(aimForward);
    return aimPoint.copy(camera.position).addScaledVector(aimForward, Math.max(2.4, depth * 0.2));
  }

  function fireRivet(context: SpillwayUpdate, from: Vector3) {
    const velocity = rivetAimPoint(context.camera, from).clone().sub(from).normalize().multiplyScalar(RIVET_STEER.baseSpeed);
    velocity.y += 2;
    context.spawnEnemy({
      time: context.runTime,
      kind: 'rivet',
      countsTowardTotal: false,
      data: { role: 'rivet', position: from.clone(), velocity, lastAge: 0, impact: {} },
    });
  }

  // ---- rivet: spinning, red-hot, homing on the lens ----
  function rivet(context: SpillwayUpdate, data: Data<'rivet'>) {
    const { enemy, age, camera } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: intercepted.delete(enemy.id),
      config: RIVET_IMPACT,
    });
    const range = data.position.distanceTo(camera.position);
    // Shrinks as it closes, so its size on screen stays bounded.
    enemy.mesh.scale.setScalar(MathUtils.clamp((range - 2) / 10, 0.25, 1));
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.userData.impact = true;
      if (impact.damaged) {
        hurt(context);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, rivetAimPoint(camera, data.position), age, dt, RIVET_STEER);
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.01) enemy.mesh.lookAt(target.copy(data.position).add(data.velocity));
    return age > RIVET_MAX_AGE || range < RIVET_NEAR_MISS || shotBehindCamera(camera, data.position);
  }

  // ---- clamp: surfaces holding the cable; an uncut cable sweeps the camera ----
  function clamp(context: SpillwayUpdate, data: Data<'clamp'>) {
    const { enemy, runTime, age, curve } = context;
    const mesh = enemy.mesh;
    const sample = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const u = sample.anchorU;
    const cable = context.enemyState(() => {
      const claimed = cables.claim(data.cable, data.of);
      cables.register(enemy.id, claimed, data.slot);
      return claimed;
    });

    const frame = sampleRailFrame(curve, u);
    const across = scratchFrameRight.copy(frame.right).setY(0).normalize();
    riverPoint(curve, u, clearOfCamera(laneLateral(curve, u, data.lane), sample.distanceAheadUnits), target);
    const rise = easeOutBack(age / 0.8);
    const bob = Math.sin(age * 2.1 + data.slot * 1.7) * 0.14;
    mesh.position.copy(target);
    mesh.position.y += MathUtils.lerp(-3.2, 0, rise) + bob;
    faceOutward(mesh.quaternion, across);
    mesh.rotateX(Math.sin(age * 1.7 + data.slot) * 0.07);
    mesh.rotateZ(Math.sin(age * 1.3 + data.slot * 2.3) * 0.06);
    mesh.userData.cable = cable;
    mesh.userData.surfaced = rise >= 0.98;

    cable.jaws[data.slot].copy(mesh.position).addScaledVector(UP, CLAMP_JAW_HEIGHT);
    if (data.slot === 0) {
      const hit = nearestSpine(frame.position.x, frame.position.z);
      const half = hit.sample.halfWidth + 1;
      riverPoint(curve, u, -half - hit.lateral, cable.ends[0]).y += CLAMP_JAW_HEIGHT * 0.7;
      riverPoint(curve, u, half - hit.lateral, cable.ends[1]).y += CLAMP_JAW_HEIGHT * 0.7;
    }

    // A few units out the uncut cable catches the camera.
    if (cable.state === 'taut' && sample.distanceAheadUnits < 4) {
      cable.state = 'swept';
      hurt(context);
    }
    return runTime >= data.engagement.passTime;
  }

  return { intercepted, hurt, skiff, spotter, pod, rivet, clamp };
}

export type EnemyMotion = ReturnType<typeof createEnemyMotion>;
