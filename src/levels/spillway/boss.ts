import { Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { EventBus } from '../../events';
import type { EnemyMotion } from './enemies';
import type { SpillwaySpawnEntry, SpillwayUpdate, SpotterEntrance } from './gameplay';
import { bar } from './timing';
import { WALKER_DAM, railFrameAt } from './rail';
import { WATER_LEVEL, damPoint } from './route';
import { BELLY_DROP_BARS, WALKER_LEGS, WALKER_WORK_FROM, clawPoint, corePoint, kneePoint, rackPoint, resetWalkerDamage, walkerDamage } from './walker';

// The walker fight at the dam crest, bars 44–58. The walker stands astride
// the right-hand gate bays; the camera circles in front of it.
//
//   44–51  the legs open one after another, in the order the camera meets
//          them: rear left, rear right, front right, front left. A leg's
//          knee lamp blinks while it is open. Each takes two stages, armour
//          then the knee. A player who keeps up breaks each before the next
//          opens; one who falls behind faces several at once.
//   throughout  the crane tears slabs out of the gates and throws them, faster
//          with every leg down; skiffs and flocks keep coming (the waves below).
//   ~53    all four down: the core bay at the stern opens.
//   ~55    the core dies: the walker falls onto the gates.
//   58     the gates burst whatever happened. An early kill leaves the wreck
//          on the crest until then; a failed fight ends with the walker
//          tearing the centre gate out itself.
//
// One unlockable controller entry of kind `slab` runs the crane's cycles and
// opens each leg and the core by spawning its target when it becomes
// lockable. A target that exists but cannot be locked would sit in the frame
// as a false lead, so the controller itself rides behind the camera, hidden.

export type BossPart = 'leg' | 'core' | 'slab';

export type BossSpawnData =
  | { role: 'boss'; part: 'leg'; leg: number }
  | { role: 'boss'; part: 'core' }
  | { role: 'boss'; part: 'crane' }
  | { role: 'boss'; part: 'slab'; position: Vector3; velocity: Vector3; spin: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'boss'; part: 'skiff'; landAt: number; rack: number; lane: number; weave: number; phase: number };

const BREACH = bar(58);
/** Bar each leg opens, in fight order, and its hit stages: the armour, then the knee. */
const LEG_OPEN_BARS = [44.25, 46, 47.75, 49.5];
const LEG_STAGES = [[2, 2], [2, 2], [2, 2], [2, 3]];
const CORE_STAGES = [2, 3];
/** The core bay's doors swing open before the core can be locked. */
const CORE_OPEN_SECONDS = bar(0.5);
/** Bars between slab throws with 0–4 legs down; with the core open, every bar. */
const THROW_BARS = [2, 1.75, 1.5, 1.25, 1];
const FIRST_THROW_BAR = 45.25;
const LAST_THROW_BAR = 56.5;
/** Slabs are lobbed, then home in: slower than rivets, and they hit from further out. */
const SLAB_STEER = { baseSpeed: 26, maxSpeed: 40, accel: 9, turnRate: 2.6 };
const SLAB_LOB = 9;
const SLAB_IMPACT = { hitDistance: 6, damageDistance: 3 };
const SLAB_MAX_AGE = 12;
/** Rack skiffs: flight from the rack, where they land (share of the way from camera to walker, half-width across it), and their run at the lens. */
const SKIFF_FLIGHT = 1.6;
const SKIFF_LANDING = { toward: 0.78, across: 34 };
const SKIFF_RUN = { speed: 17, ride: 1.15, clearance: 8, maxSeconds: 7 };

type FlockWave = (atBar: number, size: number, entrance: SpotterEntrance, options: { x: number; y: number; peelBar: number; lineY: number; lead?: number }) => SpillwaySpawnEntry[];

/**
 * Skiffs thrown off the rear rack onto the lake between the camera and the walker,
 * authored by the bar the first lands on; `lanes` are [across the view -1..1, weave].
 * The rail-paced skiffs of the chase would land ahead along the orbit, out of frame.
 */
function rackSkiffs(landBar: number, lanes: Array<[number, number]>): SpillwaySpawnEntry[] {
  return lanes.map(([lane, weave], rack) => {
    const landAt = bar(landBar) + rack * bar(0.125);
    return { time: landAt - SKIFF_FLIGHT, kind: 'skiff', data: { role: 'boss', part: 'skiff', landAt, rack, lane, weave, phase: rack * 2.1 + landBar } };
  });
}

/** Timeline entries for the fight. Times are absolute run seconds. */
export function createBossSpawns({ flock }: { flock: FlockWave }): SpillwaySpawnEntry[] {
  // Flocks drop out of the belly hatch and peel off across the frame, alternating sides.
  const drops = BELLY_DROP_BARS.flatMap((at, k) => flock(at, k % 2 === 0 ? 4 : 6, 'belly', { x: k % 2 === 0 ? 8 : -8, y: 0, peelBar: at + 1.5, lineY: -6 }));
  return [
    { time: WALKER_WORK_FROM, kind: 'slab', lockable: false, countsTowardTotal: false, data: { role: 'boss', part: 'crane' } },
    ...drops,
    ...rackSkiffs(44.75, [[-0.5, 0.3], [0.5, 0.3]]),
    ...rackSkiffs(47.5, [[-0.7, 0.3], [0, 0.4], [0.7, 0.3]]),
    ...rackSkiffs(50.25, [[-0.8, 0.3], [-0.3, 0.4], [0.3, 0.4], [0.8, 0.3]]),
  ];
}

export function createBoss(bus: EventBus, motion: EnemyMotion) {
  const d = walkerDamage;
  const legIds = new Map<number, number>();
  const legsSpawned = WALKER_LEGS.map(() => false);
  let coreId = -1;
  let now = 0;

  const touch = () => {
    d.version += 1;
  };

  bus.on('runstart', () => {
    legIds.clear();
    legsSpawned.fill(false);
    coreId = -1;
    now = 0;
    resetWalkerDamage();
  });
  bus.on('kill', ({ enemyId }) => {
    const leg = legIds.get(enemyId);
    if (leg !== undefined) {
      d.legDownAt[leg] = now;
      d.legOpen[leg] = false;
      touch();
    } else if (enemyId === coreId) {
      d.coreDownAt = now;
      touch();
    }
  });

  const legsDown = () => d.legDownAt.filter((at) => at <= now).length;

  const legOpen = (leg: number, time: number) => time >= bar(LEG_OPEN_BARS[leg]) && time < BREACH && !(d.legDownAt[leg] <= time);

  /** Seat a target on the walker and note any damage it took since last frame. */
  function track(context: SpillwayUpdate, onHit: () => void) {
    const state = context.enemyState(() => ({ hp: context.enemy.hitPointsRemaining }));
    if (context.enemy.hitPointsRemaining < state.hp) onHit();
    state.hp = context.enemy.hitPointsRemaining;
  }

  function leg(context: SpillwayUpdate, data: Extract<BossSpawnData, { part: 'leg' }>) {
    const { enemy, runTime } = context;
    legIds.set(enemy.id, data.leg);
    kneePoint(runTime, data.leg, enemy.mesh.position);
    if (d.legStage[data.leg] !== enemy.hitStageIndex) {
      d.legStage[data.leg] = enemy.hitStageIndex;
      touch();
    }
    enemy.mesh.userData.leg = data.leg;
    track(context, () => {
      d.legHitAt[data.leg] = runTime;
      touch();
    });
    return runTime >= BREACH;
  }

  function core(context: SpillwayUpdate) {
    const { enemy, runTime } = context;
    corePoint(runTime, enemy.mesh.position);
    if (d.coreStage !== enemy.hitStageIndex) {
      d.coreStage = enemy.hitStageIndex;
      touch();
    }
    track(context, () => {
      d.coreHitAt = runTime;
      touch();
    });
    return runTime >= BREACH;
  }

  const release = new Vector3();
  const aim = new Vector3();

  /** The crane: schedules its cycles, lets go of each slab, and opens the core once the legs are gone. */
  function crane(context: SpillwayUpdate) {
    const { enemy, runTime, camera } = context;
    now = runTime;
    if (!Number.isFinite(d.throwFrom)) {
      d.throwFrom = WALKER_WORK_FROM;
      d.throwAt = bar(FIRST_THROW_BAR);
      touch();
    }
    const alive = !(d.coreDownAt <= runTime);
    if (runTime >= d.throwAt) {
      clawPoint(d.throwAt, release);
      if (alive) throwSlab(context, release, hostileShotAimPoint(camera, release));
      const down = legsDown();
      const next = d.throwAt + bar(Number.isFinite(d.coreOpenAt) ? 1 : THROW_BARS[down]);
      d.throwFrom = d.throwAt;
      d.throwAt = alive && next <= bar(LAST_THROW_BAR) ? next : Infinity;
      d.throwCount += 1;
      touch();
    }
    // Legs open in turn; each target appears as its knee lamp lights.
    WALKER_LEGS.forEach((_, leg) => {
      const open = legOpen(leg, runTime);
      if (d.legOpen[leg] !== open) {
        d.legOpen[leg] = open;
        touch();
      }
      if (open && !legsSpawned[leg]) {
        legsSpawned[leg] = true;
        context.spawnEnemy({ time: runTime, kind: 'leg', hitStages: LEG_STAGES[leg], data: { role: 'boss', part: 'leg', leg } });
      }
    });
    // With the legs gone the core bay opens; the core is a target once the doors are clear.
    if (runTime < BREACH && legsDown() === WALKER_LEGS.length) {
      if (!Number.isFinite(d.coreOpenAt)) {
        d.coreOpenAt = runTime;
        touch();
      } else if (coreId < 0 && runTime >= d.coreOpenAt + CORE_OPEN_SECONDS) {
        coreId = context.spawnEnemy({ time: runTime, kind: 'core', hitStages: CORE_STAGES, data: { role: 'boss', part: 'core' } });
      }
    }
    enemy.mesh.visible = false;
    enemy.mesh.userData.controller = true;
    camera.getWorldDirection(enemy.mesh.position).multiplyScalar(-40).add(camera.position);
    return false;
  }

  function throwSlab(context: SpillwayUpdate, from: Vector3, target: Vector3) {
    const velocity = aim.copy(target).sub(from).normalize().multiplyScalar(SLAB_STEER.baseSpeed).clone();
    velocity.y += SLAB_LOB;
    context.spawnEnemy({
      time: context.runTime,
      kind: 'slab',
      countsTowardTotal: false,
      hitPoints: legsDown() >= 2 ? 2 : 1,
      data: {
        role: 'boss',
        part: 'slab',
        position: from.clone(),
        velocity,
        spin: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random()),
        lastAge: 0,
        impact: {},
      },
    });
  }

  function slab(context: SpillwayUpdate, data: Extract<BossSpawnData, { part: 'slab' }>) {
    const { enemy, age, camera } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: motion.intercepted.delete(enemy.id),
      config: SLAB_IMPACT,
    });
    const spinner = enemy.mesh.userData.spinner as { rotateOnAxis(axis: Vector3, angle: number): void } | undefined;
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      if (impact.damaged) {
        motion.hurt(context);
        return true;
      }
      return false;
    }
    // Lobbed high out of the claw, then it comes down on you.
    data.velocity.y -= 14 * dt * Math.max(0, 1 - age / 1.4);
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age + 0.2, dt * Math.min(1, age / 0.9), SLAB_STEER);
    enemy.mesh.position.copy(data.position);
    spinner?.rotateOnAxis(aim.copy(data.spin).normalize(), data.spin.length() * dt);
    return age > SLAB_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  const walkerBase = damPoint(WALKER_DAM.a, WALKER_DAM.l, 0);
  const toCamera = new Vector3();
  const side = new Vector3();

  /** A rack skiff: the arc off the stern, the splashdown, then an S-carve at the camera that passes beside it. */
  function skiff(context: SpillwayUpdate, data: Extract<BossSpawnData, { part: 'skiff' }>) {
    const { enemy, runTime, age, camera } = context;
    const mesh = enemy.mesh;
    const state = context.enemyState(() => {
      const from = rackPoint(enemy.entry.time, data.rack);
      const eye = railFrameAt(data.landAt).position.clone().setY(WATER_LEVEL);
      const land = eye.clone().lerp(walkerBase, SKIFF_LANDING.toward);
      side.copy(walkerBase).sub(eye).setY(0).normalize();
      land.x += -side.z * data.lane * SKIFF_LANDING.across;
      land.z += side.x * data.lane * SKIFF_LANDING.across;
      land.y = WATER_LEVEL + SKIFF_RUN.ride;
      return { from, land, water: land.clone(), previous: from.clone(), yaw: 0, roll: 0, pitch: 0, lastAge: 0 };
    });
    const dt = Math.max(1e-4, age - state.lastAge);
    state.lastAge = age;
    enemy.entry.lockable = runTime >= data.landAt;
    if (runTime < data.landAt) {
      const t = Math.min(1, age / SKIFF_FLIGHT);
      const arc = 10 + state.from.distanceTo(state.land) * 0.12;
      mesh.position.lerpVectors(state.from, state.land, t);
      mesh.position.y += arc * 4 * t * (1 - t);
      mesh.userData.phase = 'air';
    } else {
      // Carve at the lens: head for a point beside the camera, weaving, so it passes close without hitting it.
      const carve = runTime - data.landAt;
      toCamera.copy(camera.position).sub(state.water).setY(0);
      const distance = toCamera.length();
      toCamera.normalize();
      side.set(-toCamera.z, 0, toCamera.x);
      const pass = data.lane === 0 ? 1 : Math.sign(data.lane);
      // Across the dam foot first, in full view, then round toward the camera, passing beside it.
      const across = Math.max(0, 1 - carve / 2.5) * 1.6;
      const aimAt = Math.min(1, SKIFF_RUN.clearance / Math.max(1, distance)) * 1.4;
      const weave = Math.sin(carve * 1.6 + data.phase) * data.weave;
      toCamera.multiplyScalar(0.6).addScaledVector(side, pass * (across + aimAt) + weave).normalize();
      state.water.addScaledVector(toCamera, SKIFF_RUN.speed * dt);
      mesh.position.copy(state.water);
      mesh.position.y = WATER_LEVEL + SKIFF_RUN.ride + Math.sin(age * 7.3 + data.phase) * 0.06;
      mesh.userData.phase = 'water';
    }
    // Nose along the motion, banked into the carve.
    const vx = (mesh.position.x - state.previous.x) / dt;
    const vz = (mesh.position.z - state.previous.z) / dt;
    if (age > 0 && vx * vx + vz * vz > 1) {
      const yaw = Math.atan2(vx, vz);
      const turn = ((yaw - state.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const blend = 1 - Math.exp(-dt * 5);
      state.yaw += turn * blend;
      state.roll += (Math.max(-0.6, Math.min(0.6, -turn * 2.2)) - state.roll) * blend;
      const climb = Math.atan2((mesh.position.y - state.previous.y) / dt, Math.hypot(vx, vz));
      state.pitch += ((mesh.userData.phase === 'air' ? -climb : -0.06) - state.pitch) * blend;
    }
    mesh.rotation.set(state.pitch, state.yaw, state.roll, 'YXZ');
    mesh.userData.speed = Math.hypot(vx, vz);
    mesh.userData.carve = state.roll;
    state.previous.copy(mesh.position);
    return runTime - data.landAt > SKIFF_RUN.maxSeconds || (runTime > data.landAt && shotBehindCamera(camera, mesh.position));
  }

  return {
    /** Motion for a boss part; return true to despawn it as a miss. */
    update(context: SpillwayUpdate, data: BossSpawnData): boolean {
      switch (data.part) {
        case 'leg':
          return leg(context, data);
        case 'core':
          return core(context);
        case 'crane':
          return crane(context);
        case 'slab':
          return slab(context, data);
        case 'skiff':
          return skiff(context, data);
      }
    },
    /** One end-screen line about the fight, or nothing. */
    summaryLine(): string | undefined {
      if (Number.isFinite(d.coreDownAt)) return `Walker down in ${(d.coreDownAt - bar(44)).toFixed(1)} s`;
      const down = d.legDownAt.filter(Number.isFinite).length;
      return down > 0 ? `Walker legs broken ${down}/${WALKER_LEGS.length}` : undefined;
    },
  };
}
