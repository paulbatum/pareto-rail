import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type {
  StrandlineUzwmSpawnData,
  StrandlineUzwmSpawnEntry,
  StrandlineUzwmUpdate,
} from './gameplay';

// The Parent: a brood-mother dug into the crown where the strands root into
// the bell. It hides behind three plates of its own webbing and pumps out
// fresh broods; each brood wave cleared starves the webbing it fed, which
// withers away, until the parent hangs bare and can be torn loose.
//
// The whole fight is one readable idea — kill what it makes, and its armor
// dies on its own. Webs are never directly lockable; broods always are.

const WEB_SOCKETS: Array<[number, number]> = [[-5.4, 2.4], [5.4, 2.4], [0, -4.8]];
const BROOD_ORBIT_RADIUS = 6.4;
const PARENT_AHEAD = 27;

export type ParentEntries = {
  parentEntry: StrandlineUzwmSpawnEntry;
  webEntries: StrandlineUzwmSpawnEntry[];
  timeline: StrandlineUzwmSpawnEntry[];
};

export type ParentOptions = {
  curve: { getPointAt(u: number): Vector3 };
  parentEntry: StrandlineUzwmSpawnEntry;
  webEntries: StrandlineUzwmSpawnEntry[];
  /** Rail progress → world anchor helper owned by gameplay. */
  anchorAt(progress: number, sway: Vector3): Vector3;
  runProgressAt(runTime: number): number;
  spawnBossBolt(context: StrandlineUzwmUpdate, from: Vector3): void;
};

export function createParentEntries(time: number): ParentEntries {
  const parentEntry: StrandlineUzwmSpawnEntry = {
    time,
    kind: 'parent',
    hitStages: [3, 3],
    lockable: false,
    data: { role: 'parent' },
  };
  const webEntries: StrandlineUzwmSpawnEntry[] = WEB_SOCKETS.map((socket, index) => ({
    time: time + 0.15 + index * 0.12,
    kind: 'web',
    lockable: false,
    countsTowardTotal: false,
    data: { role: 'web', socket: index, webX: socket[0], webY: socket[1] },
  }));
  // Three brood waves, one feeding each web plate; a final pair for the
  // exposed-parent burn.
  const broods: StrandlineUzwmSpawnEntry[] = [];
  const waveStarts = [1.2, 3.6, 6.0, 9.4];
  waveStarts.forEach((start, wave) => {
    const count = wave === 3 ? 2 : 3;
    for (let i = 0; i < count; i += 1) {
      broods.push({
        time: time + start + i * 0.35,
        kind: 'brood',
        data: { role: 'brood', wave, orbit: (i / count) * Math.PI * 2 },
      });
    }
  });
  return {
    parentEntry,
    webEntries,
    timeline: [parentEntry, ...webEntries, ...broods],
  };
}

export function createParent(bus: EventBus, options: ParentOptions) {
  const boss = {
    parentId: -1,
    parentSpawned: false,
    parentKilled: false,
    exposed: false,
    withered: [false, false, false],
    witherAt: [-1, -1, -1],
    broodIds: new Map<number, number>(),
    waveRemaining: [0, 0, 0],
    parentPosition: new Vector3(),
    nextBoltAt: -1,
    lastRunTime: -1,
  };

  bus.on('runstart', () => {
    boss.parentId = -1;
    boss.parentSpawned = false;
    boss.parentKilled = false;
    boss.exposed = false;
    boss.withered = [false, false, false];
    boss.witherAt = [-1, -1, -1];
    boss.broodIds.clear();
    boss.waveRemaining = [0, 0, 0];
    boss.nextBoltAt = -1;
    boss.lastRunTime = -1;
    options.parentEntry.lockable = false;
    for (const entry of options.webEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') {
      boss.parentSpawned = true;
      boss.parentId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  // Brood ids are registered by gameplay (it knows the wave at spawn time).
  function registerBrood(enemyId: number, wave: number) {
    if (wave < 3) {
      boss.broodIds.set(enemyId, wave);
      boss.waveRemaining[wave] += 1;
    }
  }

  const waveCleared = (wave: number) => {
    if (boss.withered[wave] || boss.waveRemaining[wave] > 0) return;
    boss.withered[wave] = true;
    boss.witherAt[wave] = boss.lastRunTime;
    if (boss.withered.every(Boolean) && boss.parentSpawned && !boss.exposed) {
      boss.exposed = true;
      options.parentEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  const onBroodGone = (enemyId: number) => {
    const wave = boss.broodIds.get(enemyId);
    if (wave === undefined) return;
    boss.broodIds.delete(enemyId);
    boss.waveRemaining[wave] = Math.max(0, boss.waveRemaining[wave] - 1);
    waveCleared(wave);
  };

  bus.on('kill', ({ enemyId }) => {
    onBroodGone(enemyId);
    if (enemyId === boss.parentId && !boss.parentKilled) {
      boss.parentKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onBroodGone(enemyId);
  });

  function updateParent(context: StrandlineUzwmUpdate) {
    const { enemy, runTime, camera } = context;
    // The parent holds station ahead of the camera to the end of the rail —
    // a fixed tangent offset, so it never slides out of the lock frustum.
    const progress = options.runProgressAt(runTime);
    const sway = new Vector3(
      Math.sin(runTime * 0.45) * 2.2 + (boss.exposed ? Math.sin(runTime * 2.4) * 1.6 : 0),
      2.4 + Math.sin(runTime * 0.7) * 1.2 + (boss.exposed ? Math.cos(runTime * 2.1) * 1.1 : 0),
      PARENT_AHEAD,
    );
    enemy.mesh.position.copy(options.anchorAt(progress, sway));
    boss.parentPosition.copy(enemy.mesh.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * (boss.exposed ? 0.8 : 0.3));
    enemy.mesh.userData.exposed = boss.exposed && !boss.parentKilled;
    enemy.mesh.userData.witheredCount = boss.withered.filter(Boolean).length;

    if (boss.exposed && !boss.parentKilled) {
      if (boss.nextBoltAt < 0) boss.nextBoltAt = runTime + 1.6;
      if (runTime >= boss.nextBoltAt) {
        boss.nextBoltAt = runTime + 3.4;
        const side = Math.sin(runTime * 11.3) > 0 ? 1 : -1;
        options.spawnBossBolt(
          context,
          enemy.mesh.position.clone().add(new Vector3(side * 3.4, 2.2, -1)),
        );
      }
    }
    boss.lastRunTime = runTime;
    return false;
  }

  function updateWeb(
    context: StrandlineUzwmUpdate,
    data: Extract<StrandlineUzwmSpawnData, { role: 'web' }>,
  ) {
    const { enemy, age, runTime, camera } = context;
    boss.lastRunTime = runTime;
    enemy.mesh.position
      .copy(boss.parentPosition)
      .add(new Vector3(data.webX, data.webY, 1.5));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.5 + data.socket * 2.1);
    // Starved webbing withers: the mesh flag drives the visual collapse, and
    // a breath later the plate is gone (a quiet miss — it was never a target).
    if (boss.withered[data.socket]) {
      const wither = context.enemyState(() => ({ start: -1 }));
      if (wither.start < 0) wither.start = age;
      const t = MathUtils.clamp((age - wither.start) / 1.1, 0, 1);
      enemy.mesh.userData.witherT = t;
      return t >= 1;
    }
    return false;
  }

  function updateBrood(
    context: StrandlineUzwmUpdate,
    data: Extract<StrandlineUzwmSpawnData, { role: 'brood' }>,
  ) {
    const { enemy, age, camera } = context;
    boss.lastRunTime = context.runTime;
    const angle = data.orbit + age * 0.9;
    const radius = BROOD_ORBIT_RADIUS * (1 - Math.min(0.25, age * 0.02));
    enemy.mesh.position
      .copy(boss.parentPosition)
      .add(
        new Vector3(
          Math.cos(angle) * radius + Math.sin(age * 2.2) * 0.5,
          Math.sin(angle) * radius * 0.8 + Math.cos(age * 1.7) * 0.5,
          Math.sin(age * 1.1) * 2.2 - 2,
        ),
      );
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle * 2 + age);
    return false;
  }

  return {
    registerBrood,
    updateParent,
    updateWeb,
    updateBrood,
    parentKilled: () => boss.parentKilled,
    parentSpawned: () => boss.parentSpawned,
    parentPosition: () => boss.parentPosition,
    exposed: () => boss.exposed,
    summaryLine() {
      if (!boss.parentSpawned) return undefined;
      if (boss.parentKilled) return 'Parent torn loose — the jelly drifts on';
      const fed = boss.withered.filter(Boolean).length;
      return fed === 0 ? 'The parent kept its crown' : `The parent kept its crown (${fed}/3 webs starved)`;
    },
  };
}

export type StrandlineParent = ReturnType<typeof createParent>;
