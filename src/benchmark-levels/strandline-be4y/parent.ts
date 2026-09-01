import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import { CROWN_TIME, DEADLINE_TIME, bar } from './timing';
import { APPROACH_DIR, APPROACH_QUATERNION, APPROACH_RIGHT, APPROACH_UP, PARENT_POSITION, WORLD_SCALE, parentFramePoint } from './world';
import type { StrandlineSpawnData, StrandlineSpawnEntry, StrandlineUpdate } from './gameplay';

// The Parent: the organism the whole infestation grew from, dug into the crown
// where the strands root into the bell. It hides behind three fans of its own
// webbing and pumps a brood into each. Kill a brood and the web it fed dies
// back; when all three are gone the Parent is bare, and its grip can be torn
// loose in two stages. It has until the deadline bar; then it burrows in and
// the animal drifts on still carrying it.

export const BROOD_COUNT = 3;
export const BROOD_SIZE = 3;
// Screen-space angles (in the approach frame) of the three webs around the body.
export const WEB_ANGLES = [MathUtils.degToRad(125), MathUtils.degToRad(235), MathUtils.degToRad(355)];
const S = WORLD_SCALE;
export const WEB_CENTER_REACH = 8.5 * S;
export const WEB_ANCHOR_REACH = 14 * S;
const BROOD_ORBIT_RADIUS = 3.6 * S;
const BROOD_EMERGE_SECONDS = 0.9;
const FLINCH_SECONDS = 1.3;
const SPORE_PERIOD = 3.4;
const SPORE_FIRST_DELAY = bar(1.1);
const BROOD_SCHEDULE = [bar(0.4), bar(1.65), bar(2.9)];
const BROOD_FOLLOW_UP = bar(0.55);

type ParentEntries = {
  parentEntry: StrandlineSpawnEntry;
  timeline: StrandlineSpawnEntry[];
};

type ParentOptions = {
  parentEntry: StrandlineSpawnEntry;
  spitSpore(context: StrandlineUpdate, from: Vector3): void;
};

export function webCenter(index: number, out = new Vector3()) {
  const angle = WEB_ANGLES[index % WEB_ANGLES.length];
  // Broods orbit in front of the body, between it and the player, clear of the crown bulb behind.
  return parentFramePoint(Math.cos(angle) * WEB_CENTER_REACH, Math.sin(angle) * WEB_CENTER_REACH, -4 * S, out);
}

export function webAnchor(index: number, out = new Vector3()) {
  const angle = WEB_ANGLES[index % WEB_ANGLES.length];
  return parentFramePoint(Math.cos(angle) * WEB_ANCHOR_REACH, Math.sin(angle) * WEB_ANCHOR_REACH, 4 * S, out);
}

/** The gullet the broods and spores come out of: the near face of the body. */
export function gulletPoint(out = new Vector3()) {
  return out.copy(PARENT_POSITION).addScaledVector(APPROACH_DIR, -3.2 * S);
}

export function createParentEntries(time: number): ParentEntries {
  // Always lockable: the webbing is what stops the shot, not the lock. The
  // level's validateRelease denies volleys at it until it is bare, so the
  // player (and the simulator) can always sweep it without getting stuck.
  const parentEntry: StrandlineSpawnEntry = {
    time,
    kind: 'parent',
    hitStages: [3, 3],
    data: { role: 'parent' },
  };
  return { parentEntry, timeline: [parentEntry] };
}

export function createParent(bus: EventBus, options: ParentOptions) {
  const boss = {
    parentId: -1,
    spawned: false,
    killed: false,
    killedAt: -1,
    bare: false,
    flinchUntil: -1,
    lastRunTime: -1,
    nextSporeAt: -1,
    broodSpawned: [false, false, false],
    broodClearedAt: [-1, -1, -1],
    broodAlive: [new Set<number>(), new Set<number>(), new Set<number>()],
    broodGone: [0, 0, 0],
    pumpAt: -1,
    position: PARENT_POSITION.clone(),
  };

  const broodOf = new Map<number, number>();

  bus.on('runstart', () => {
    boss.parentId = -1;
    boss.spawned = false;
    boss.killed = false;
    boss.killedAt = -1;
    boss.bare = false;
    boss.flinchUntil = -1;
    boss.lastRunTime = -1;
    boss.nextSporeAt = -1;
    boss.broodSpawned = [false, false, false];
    boss.broodClearedAt = [-1, -1, -1];
    boss.broodAlive = [new Set(), new Set(), new Set()];
    boss.broodGone = [0, 0, 0];
    boss.pumpAt = -1;
    boss.position.copy(PARENT_POSITION);
    broodOf.clear();
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') {
      boss.spawned = true;
      boss.parentId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const onBroodlingGone = (enemyId: number) => {
    const brood = broodOf.get(enemyId);
    if (brood === undefined) return;
    broodOf.delete(enemyId);
    boss.broodAlive[brood].delete(enemyId);
    boss.broodGone[brood] += 1;
    if (boss.broodGone[brood] >= BROOD_SIZE && boss.broodClearedAt[brood] < 0) {
      boss.broodClearedAt[brood] = boss.lastRunTime;
      if (boss.broodClearedAt.every((at) => at >= 0) && !boss.bare) {
        boss.bare = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onBroodlingGone(enemyId);
    if (enemyId === boss.parentId && !boss.killed) {
      boss.killed = true;
      boss.killedAt = boss.lastRunTime;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onBroodlingGone(enemyId);
  });

  // Stage break: the grip tears, it flinches back into the crown for a breath.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== boss.parentId) return;
    boss.flinchUntil = boss.lastRunTime + FLINCH_SECONDS;
  });

  function broodDueAt(index: number) {
    const scheduled = CROWN_TIME + BROOD_SCHEDULE[index];
    if (index === 0) return scheduled;
    const previousCleared = boss.broodClearedAt[index - 1];
    if (previousCleared < 0) return scheduled;
    return Math.min(scheduled, Math.max(CROWN_TIME + BROOD_SCHEDULE[0], previousCleared + BROOD_FOLLOW_UP));
  }

  function pumpBrood(context: StrandlineUpdate, index: number) {
    boss.broodSpawned[index] = true;
    boss.pumpAt = context.runTime;
    for (let slot = 0; slot < BROOD_SIZE; slot += 1) {
      const id = context.spawnEnemy({
        time: context.runTime,
        kind: 'broodling',
        data: { role: 'broodling', brood: index, slot },
      });
      if (id >= 0) {
        broodOf.set(id, index);
        boss.broodAlive[index].add(id);
      }
    }
  }

  function updateParent(context: StrandlineUpdate, _data: Extract<StrandlineSpawnData, { role: 'parent' }>) {
    const { enemy, runTime, age } = context;
    boss.lastRunTime = runTime;
    const flinching = boss.flinchUntil > runTime;
    const webs = boss.broodClearedAt.map((at) => at < 0);

    // Deadline: it burrows back into the crown and the run carries it away.
    if (runTime >= DEADLINE_TIME) {
      enemy.mesh.userData.retreating = true;
      return true;
    }

    // Dug in: a slow heave, a shudder while flinching. The body never leaves the crown.
    const heave = Math.sin(runTime * 1.7) * 0.35 * S;
    const shudder = flinching ? Math.sin(runTime * 41) * 0.5 * S : 0;
    boss.position.copy(PARENT_POSITION)
      .addScaledVector(APPROACH_DIR, -heave)
      .addScaledVector(APPROACH_DIR, flinching ? 2.2 * S : 0);
    enemy.mesh.position.copy(boss.position);
    enemy.mesh.position.x += shudder;
    // Pinned to the approach frame, not billboarded: the webs and legs must not
    // swing with the player's edge-look.
    enemy.mesh.quaternion.copy(APPROACH_QUATERNION);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.5) * 0.06 + (flinching ? Math.sin(runTime * 9) * 0.12 : 0));

    enemy.mesh.userData.exposed = boss.bare && !flinching && !boss.killed;
    enemy.mesh.userData.flinching = flinching;
    enemy.mesh.userData.websAlive = webs;
    enemy.mesh.userData.stage = enemy.hitStageIndex;
    enemy.mesh.userData.pump = boss.pumpAt < 0 ? 0 : MathUtils.clamp(1 - (runTime - boss.pumpAt) / 0.8, 0, 1);
    enemy.mesh.userData.age = age;

    // Pump the broods: on schedule, or sooner when the last one is already dead.
    for (let index = 0; index < BROOD_COUNT; index += 1) {
      if (boss.broodSpawned[index]) continue;
      if (runTime >= broodDueAt(index)) {
        pumpBrood(context, index);
        break;
      }
    }

    // Spores: it defends itself while it still has webbing to hide behind.
    if (!boss.bare && !flinching && runTime >= CROWN_TIME + SPORE_FIRST_DELAY) {
      if (boss.nextSporeAt < 0) boss.nextSporeAt = runTime;
      if (runTime >= boss.nextSporeAt) {
        boss.nextSporeAt = runTime + SPORE_PERIOD;
        options.spitSpore(context, gulletPoint());
      }
    }
    return false;
  }

  function updateBroodling(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'broodling' }>) {
    const { enemy, runTime, age, camera } = context;
    if (runTime >= DEADLINE_TIME) return true;
    const center = webCenter(data.brood);
    const angle = data.slot * ((Math.PI * 2) / BROOD_SIZE) + age * 2.1 + data.brood * 1.3;
    const wobble = Math.sin(age * 5.2 + data.slot * 2.4) * 0.35 * S;
    // The orbit plane faces the approach: screen-right and screen-up.
    const orbit = center.clone()
      .addScaledVector(APPROACH_RIGHT, Math.cos(angle) * (BROOD_ORBIT_RADIUS + wobble))
      .addScaledVector(APPROACH_UP, Math.sin(angle) * (BROOD_ORBIT_RADIUS + wobble) * 0.75);
    // Emerges from the gullet, then takes up its orbit around the web it feeds.
    const emerge = MathUtils.clamp(age / BROOD_EMERGE_SECONDS, 0, 1);
    const eased = 1 - (1 - emerge) ** 2.2;
    enemy.mesh.position.copy(gulletPoint()).lerp(orbit, eased);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle * 0.5);
    enemy.mesh.userData.swim = Math.sin(age * 6 + data.slot) * 0.5 + 0.5;
    return false;
  }

  return {
    updateParent,
    updateBroodling,
    parentKilled: () => boss.killed,
    parentId: () => boss.parentId,
    /** Can a released volley reach it right now? Only when bare, steady, alive, and before the deadline. */
    parentTargetable: () => boss.spawned && boss.bare && !boss.killed && boss.flinchUntil <= boss.lastRunTime && boss.lastRunTime < DEADLINE_TIME,
    parentPosition: () => boss.position,
    parentSpawned: () => boss.spawned,
    parentBare: () => boss.bare,
    killedAt: () => boss.killedAt,
    broodsCleared: () => boss.broodClearedAt.filter((at) => at >= 0).length,
    broodSummaryLine() {
      if (!boss.spawned) return undefined;
      const cleared = boss.broodClearedAt.filter((at) => at >= 0).length;
      return `Broods cleared ${cleared}/${BROOD_COUNT}`;
    },
    summaryLine() {
      if (!boss.spawned) return undefined;
      if (!boss.killed) return 'The Parent held on';
      const spare = Math.max(0, DEADLINE_TIME - boss.killedAt);
      return `The Parent torn loose with ${spare.toFixed(1)}s to spare`;
    },
  };
}

export type Parent = ReturnType<typeof createParent>;
