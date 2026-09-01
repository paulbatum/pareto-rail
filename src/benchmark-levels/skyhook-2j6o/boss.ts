import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { SkyhookSpawnData, SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';
import { RAIL_BASIS, TETHER_OFFSET, railPoint } from './rail';
import { skyhookSignals } from './signals';
import {
  BOSS_ENGAGE_DISTANCE,
  BOSS_LURCHES,
  BOSS_LURCH_SECONDS,
  BOSS_REACH_DISTANCE,
  BOSS_START_DISTANCE,
} from './timing';

// THE TETHERJACK — something huge that takes the tether far above the climber
// and works its way down, one lurch per downbeat. Three claws reach down the
// tether ahead of it; the body hangs beside the tether toward the car.
//
// The fight is driven by an invisible "brain" entity that lives behind the
// camera for the whole vacuum act: it moves the boss, spawns the claws as
// lockable targets once they are in range, spawns the core as a target only
// when the claws are gone, sheds wreckage, spits bolts, and tears at the deck
// when it arrives. Before the targets exist, the visuals draw stand-ins from
// `tetherjackState`, so the player sees it the whole way down.

/** Where the body hangs, rail-frame relative to the camera line (the claws are on the tether). */
export const BOSS_BODY_OFFSET = { x: -0.6, y: 0.9 } as const;
export const BOSS_SCALE = 1.7;

/** Claw sockets around the tether axis, reaching down the tether ahead of the body. */
export const CLAW_SOCKETS: ReadonlyArray<{ angle: number; z: number }> = [
  { angle: 0.35, z: -3.0 },
  { angle: 2.45, z: -6.5 },
  { angle: 4.55, z: -10.0 },
];
export const CLAW_RADIUS = 1.9;

const BITE_PERIOD = 1.6;
const boltOrigin = new Vector3();
const LUNGE_DISTANCE = 12;
const BOLT_PERIOD = 4.2;

export type TetherjackState = {
  active: boolean;
  distance: number;
  closeness: number;
  lurching: number;
  bodyX: number;
  bodyY: number;
  engaged: boolean;
  exposed: boolean;
  reached: boolean;
  dead: boolean;
  coreSpawned: boolean;
  stage: number;
  age: number;
};

/** Live boss state, published by the brain every frame for the visuals' stand-ins. */
export const tetherjackState: TetherjackState = {
  active: false,
  distance: BOSS_START_DISTANCE,
  closeness: 0,
  lurching: 0,
  bodyX: BOSS_BODY_OFFSET.x,
  bodyY: BOSS_BODY_OFFSET.y,
  engaged: false,
  exposed: false,
  reached: false,
  dead: false,
  coreSpawned: false,
  stage: 0,
  age: 0,
};

/** Rail-frame position of the body for a camera at `u`. */
export function placeBossBody(u: number, state: TetherjackState, target = new Vector3()) {
  return railPoint(u, state.bodyX, state.bodyY, state.distance, target);
}

/** Rail-frame position of a claw socket for a camera at `u`. */
export function placeClaw(u: number, state: TetherjackState, socket: number, target = new Vector3()) {
  const spec = CLAW_SOCKETS[socket];
  const wobble = Math.sin(state.age * 2.1 + socket * 1.9) * 0.25;
  const grip = state.reached ? Math.sin(state.age * 30) * 0.12 : 0;
  const angle = clawAngle(state, socket);
  return railPoint(
    u,
    TETHER_OFFSET.x + Math.cos(angle) * CLAW_RADIUS + grip,
    TETHER_OFFSET.y + Math.sin(angle) * CLAW_RADIUS,
    state.distance + spec.z + wobble,
    target,
  );
}

export function clawAngle(state: TetherjackState, socket: number) {
  return CLAW_SOCKETS[socket].angle + Math.sin(state.age * 0.9 + socket) * 0.08;
}

type TetherjackOptions = {
  fireBolt(context: SkyhookUpdate, from: Vector3, dart: boolean): void;
  spawnWreck(context: SkyhookUpdate, x: number, y: number, z: number, seed: number): void;
  spawnClaw(context: SkyhookUpdate, socket: number): void;
  spawnCore(context: SkyhookUpdate): void;
};

export function createTetherjackEntries(time: number) {
  const brainEntry: SkyhookSpawnEntry = {
    time,
    kind: 'tether',
    lockable: false,
    countsTowardTotal: false,
    data: { role: 'brain' },
  };
  return { brainEntry, timeline: [brainEntry] };
}

export function createTetherjack(bus: EventBus, options: TetherjackOptions) {
  const boss = {
    coreId: -1,
    clawIds: new Set<number>(),
    clawsSpawned: false,
    clawsGone: 0,
    killed: false,
    lungeAt: -1,
    lurchesFired: 0,
    nextBite: 0,
    nextProximity: 0,
    nextBolt: 0,
    shedPending: 0,
    shedSeed: 0,
    lastRunTime: 0,
  };
  const state = tetherjackState;

  const reset = () => {
    boss.coreId = -1;
    boss.clawIds.clear();
    boss.clawsSpawned = false;
    boss.clawsGone = 0;
    boss.killed = false;
    boss.lungeAt = -1;
    boss.lurchesFired = 0;
    boss.nextBite = 0;
    boss.nextProximity = 0;
    boss.nextBolt = 0;
    boss.shedPending = 0;
    boss.shedSeed = 0;
    state.active = false;
    state.distance = BOSS_START_DISTANCE;
    state.closeness = 0;
    state.lurching = 0;
    state.bodyX = BOSS_BODY_OFFSET.x;
    state.bodyY = BOSS_BODY_OFFSET.y;
    state.engaged = false;
    state.exposed = false;
    state.reached = false;
    state.dead = false;
    state.coreSpawned = false;
    state.stage = 0;
    state.age = 0;
  };

  bus.on('runstart', reset);

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    if (kind === 'claw') boss.clawIds.add(enemyId);
    if (kind === 'core') boss.coreId = enemyId;
    if (kind === 'tether') {
      state.active = true;
      skyhookSignals.emit('bossLatch', { worldPosition });
    }
  });

  const onClawGone = (enemyId: number) => {
    if (!boss.clawIds.delete(enemyId)) return;
    boss.clawsGone += 1;
    if (boss.clawIds.size === 0 && boss.clawsSpawned && !state.exposed && !state.dead) {
      state.exposed = true;
      skyhookSignals.emit('bossGrip', {});
    }
  };

  bus.on('kill', ({ enemyId, worldPosition }) => {
    onClawGone(enemyId);
    if (enemyId === boss.coreId) {
      boss.killed = true;
      state.dead = true;
      skyhookSignals.emit('bossDead', { worldPosition });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onClawGone(enemyId);
  });

  // Core armor breaks: it lunges a body-length closer. Every chip on the naked
  // core after that sheds a chunk of it down the tether.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== boss.coreId) return;
    boss.lungeAt = boss.lastRunTime;
    state.stage = 1;
    skyhookSignals.emit('bossStage', {});
  });

  bus.on('hit', ({ enemyId, lethal, hitStageIndex }) => {
    if (enemyId !== boss.coreId || lethal || hitStageIndex < 1) return;
    boss.shedPending += 1;
  });

  function distanceAt(runTime: number, age: number) {
    let distance = BOSS_START_DISTANCE;
    let lurching = 0;
    for (const [index, lurch] of BOSS_LURCHES.entries()) {
      if (runTime < lurch.time) break;
      const t = MathUtils.clamp((runTime - lurch.time) / BOSS_LURCH_SECONDS, 0, 1);
      distance -= lurch.size * (1 - (1 - t) ** 3);
      if (t < 1) lurching = 1 - t;
      if (boss.lurchesFired <= index) {
        boss.lurchesFired = index + 1;
        skyhookSignals.emit('bossLurch', { index, distance });
      }
    }
    if (boss.lungeAt >= 0) {
      const t = MathUtils.clamp((runTime - boss.lungeAt) / 0.6, 0, 1);
      distance -= LUNGE_DISTANCE * (1 - (1 - t) ** 2);
    }
    // Settling on the tether before the first lurch; a heavy sway after.
    distance += Math.sin(age * 1.7) * 0.7;
    return { distance: Math.max(distance, BOSS_REACH_DISTANCE), lurching };
  }

  // The brain: invisible, behind the camera, alive for the whole act.
  function updateBrain(context: SkyhookUpdate, _data: Extract<SkyhookSpawnData, { role: 'brain' }>) {
    const { enemy, runTime, runProgress, age, damagePlayer } = context;
    boss.lastRunTime = runTime;
    railPoint(runProgress, 0, -6, -14, enemy.mesh.position);
    state.age = age;
    if (state.dead) {
      state.closeness = 0;
      return false;
    }

    const { distance, lurching } = distanceAt(runTime, age);
    state.distance = distance;
    state.lurching = lurching;
    state.closeness = MathUtils.clamp(1 - (distance - BOSS_REACH_DISTANCE) / (BOSS_START_DISTANCE - BOSS_REACH_DISTANCE), 0, 1);
    state.bodyX = BOSS_BODY_OFFSET.x + Math.sin(age * 0.9) * 0.5;
    state.bodyY = BOSS_BODY_OFFSET.y + Math.sin(age * 1.3) * 0.3 - lurching * 0.8;

    if (!state.engaged && distance < BOSS_ENGAGE_DISTANCE) {
      state.engaged = true;
      boss.clawsSpawned = true;
      for (let socket = 0; socket < CLAW_SOCKETS.length; socket += 1) options.spawnClaw(context, socket);
      boss.nextBolt = age + 1.2;
      skyhookSignals.emit('bossEngage', {});
    }

    if (state.exposed && !state.coreSpawned) {
      state.coreSpawned = true;
      options.spawnCore(context);
    }

    if (!state.reached && distance <= BOSS_REACH_DISTANCE + 0.01) {
      state.reached = true;
      boss.nextBite = age + 0.7;
      skyhookSignals.emit('bossReach', {});
    }
    if (state.reached && age >= boss.nextBite) {
      boss.nextBite = age + BITE_PERIOD;
      damagePlayer(1);
      skyhookSignals.emit('bossBite', {});
    }

    if (runTime >= boss.nextProximity) {
      boss.nextProximity = runTime + 0.25;
      skyhookSignals.emit('bossProximity', { closeness: state.closeness });
    }

    while (boss.shedPending > 0) {
      boss.shedPending -= 1;
      boss.shedSeed += 1;
      const seed = boss.shedSeed * 1.37;
      options.spawnWreck(context, state.bodyX + Math.sin(seed * 5) * 3, state.bodyY - 1.5 + Math.cos(seed * 3) * 2, distance - 3, seed);
    }

    // It spits at the turret while it climbs; once it has the deck it just tears.
    if (state.engaged && !state.reached && age >= boss.nextBolt) {
      boss.nextBolt = age + BOLT_PERIOD;
      options.fireBolt(context, placeClaw(runProgress, state, 1, boltOrigin), false);
    }
    return false;
  }

  function updateCore(context: SkyhookUpdate, _data: Extract<SkyhookSpawnData, { role: 'core' }>) {
    const { enemy, runProgress, age } = context;
    placeBossBody(runProgress, state, enemy.mesh.position);
    enemy.mesh.quaternion.copy(RAIL_BASIS);
    enemy.mesh.rotateZ(Math.sin(age * 0.5) * 0.12 + (state.reached ? Math.sin(age * 40) * 0.035 : 0));
    enemy.mesh.userData.exposed = state.exposed;
    enemy.mesh.userData.reached = state.reached;
    enemy.mesh.userData.engaged = state.engaged;
    enemy.mesh.userData.closeness = state.closeness;
    enemy.mesh.userData.lurching = state.lurching;
    enemy.mesh.userData.stage = enemy.hitStageIndex;
    return false;
  }

  function updateClaw(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'claw' }>) {
    const { enemy, runProgress } = context;
    placeClaw(runProgress, state, data.socket, enemy.mesh.position);
    enemy.mesh.quaternion.copy(RAIL_BASIS);
    enemy.mesh.rotateZ(clawAngle(state, data.socket));
    enemy.mesh.userData.engaged = true;
    return false;
  }

  return {
    updateBrain,
    updateCore,
    updateClaw,
    killed: () => boss.killed,
    reached: () => state.reached,
    distance: () => state.distance,
    summaryLine() {
      if (!state.active) return undefined;
      if (boss.killed) return 'The Tetherjack is off the tether';
      if (state.reached) return 'The Tetherjack reached the climber';
      return 'The Tetherjack still holds the tether';
    },
  };
}

export type Tetherjack = ReturnType<typeof createTetherjack>;
