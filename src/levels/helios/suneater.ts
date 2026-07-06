import { MathUtils, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { HeliosSpawnData, HeliosSpawnEntry, HeliosUpdate } from './gameplay';

const FANG_SOCKETS: Array<[number, number]> = [[-4.1, 2.4], [4.1, 2.4], [-2.6, -2.6], [2.6, -2.6]];

type SuneaterEntriesOptions = {
  debugHold?: boolean;
};

type SuneaterEntries = {
  heartEntry: HeliosSpawnEntry;
  timeline: HeliosSpawnEntry[];
};

type SuneaterOptions = {
  heartEntry: HeliosSpawnEntry;
  drop3Time: number;
  spawnBossFlare(context: HeliosUpdate, x: number): void;
};

export function createSuneaterEntries(time: number, options: SuneaterEntriesOptions = {}): SuneaterEntries {
  const heartEntry: HeliosSpawnEntry = {
    time,
    kind: 'heart',
    hitStages: [5, 6],
    lockable: false,
    data: options.debugHold ? { role: 'heart', debugHold: true } : { role: 'heart' },
  };
  const fangs: HeliosSpawnEntry[] = [0, 1, 2, 3].map((socket, index) => ({
    time: time + 0.15 + index * 0.1,
    kind: 'fang',
    hitPoints: 3,
    data: { role: 'fang', socket },
  }));
  return { heartEntry, timeline: [heartEntry, ...fangs] };
}

export function createSuneater(bus: EventBus, options: SuneaterOptions) {
  const boss = {
    heartId: -1,
    heartSpawned: false,
    heartKilled: false,
    exposed: false,
    diveUntil: -1,
    fangIds: new Set<number>(),
    headPosition: new Vector3(),
    headRight: new Vector3(1, 0, 0),
    headUp: new Vector3(0, 1, 0),
    headForward: new Vector3(0, 0, 1),
  };

  bus.on('runstart', () => {
    boss.heartId = -1;
    boss.heartSpawned = false;
    boss.heartKilled = false;
    boss.exposed = false;
    boss.diveUntil = -1;
    boss.fangIds.clear();
    options.heartEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'fang') boss.fangIds.add(enemyId);
    if (kind === 'heart') {
      boss.heartSpawned = true;
      boss.heartId = enemyId;
    }
  });

  const onFangGone = (enemyId: number) => {
    if (!boss.fangIds.delete(enemyId)) return;
    if (boss.fangIds.size === 0 && boss.heartSpawned && !boss.exposed) {
      boss.exposed = true;
      options.heartEntry.lockable = true;
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onFangGone(enemyId);
    if (enemyId === boss.heartId) boss.heartKilled = true;
  });

  bus.on('miss', ({ enemyId }) => {
    onFangGone(enemyId);
  });

  // The heart's stage break: it plunges back into the star, unlockable, then
  // resurfaces meaner. (Pyres also emit `stage` on their armor break; only
  // the heart dives.)
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== boss.heartId) return;
    options.heartEntry.lockable = false;
  });

  function updateHeart(context: HeliosUpdate, data: Extract<HeliosSpawnData, { role: 'heart' }>) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + (data.debugHold ? 0.08 : 0.004), 0, 1));

    // Breach: the head erupts out of the star over the first 2.6 seconds.
    const breach = MathUtils.clamp(age / 2.6, 0, 1);
    const breachEase = 1 - (1 - breach) ** 3;

    // Stage break: plunge back under, run submerged, erupt again.
    const diving = boss.diveUntil > runTime;
    if (enemy.hitStageIndex > 0 && boss.diveUntil < 0) {
      boss.diveUntil = runTime + 4.4;
    }
    let submerge = 0;
    if (diving) {
      const remaining = boss.diveUntil - runTime;
      submerge = MathUtils.clamp(Math.min(remaining / 1.2, (4.4 - remaining) / 0.9), 0, 1);
    } else if (boss.diveUntil > 0 && enemy.hitStageIndex > 0 && boss.exposed) {
      options.heartEntry.lockable = true; // resurfaced
    }

    const weave = data.debugHold
      ? new Vector3(
          Math.sin(runTime * 0.55) * 2.5,
          5.5 + Math.sin(runTime * 0.85) * 1.2,
          20,
        )
      : new Vector3(
          Math.sin(runTime * 0.55) * 7 + Math.sin(runTime * 1.7) * 2.4,
          6.5 + Math.sin(runTime * 0.85) * 3 + Math.sin(runTime * 2.3) * 1.1,
          42,
        );
    weave.y = MathUtils.lerp(-130, weave.y, breachEase) - submerge * 150;

    boss.headPosition
      .copy(frame.position)
      .addScaledVector(frame.right, weave.x)
      .addScaledVector(frame.up, weave.y)
      .addScaledVector(frame.tangent, weave.z);
    boss.headRight.copy(frame.right);
    boss.headUp.copy(frame.up);
    boss.headForward.copy(frame.tangent).negate(); // faces back down the rail at the player

    enemy.mesh.position.copy(boss.headPosition);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.7) * 0.16);
    enemy.mesh.userData.exposed = boss.exposed && !diving;
    enemy.mesh.userData.submerge = submerge;
    enemy.mesh.userData.breach = breachEase;

    // Flare volleys: wider and faster once the theme drops, relentless while diving.
    if (age > 3) {
      const fire = context.enemyState(() => ({ nextAt: age + 1.4 }));
      if (age >= fire.nextAt) {
        const brutal = runTime >= options.drop3Time;
        fire.nextAt = age + (diving ? 3.2 : brutal ? 4.6 : 5.8);
        const spread = brutal ? [-7, 0, 7] : [-5, 5];
        for (const x of spread) options.spawnBossFlare(context, weave.x * 0.25 + x);
      }
    }
    return false;
  }

  function updateFang(context: HeliosUpdate, data: Extract<HeliosSpawnData, { role: 'fang' }>) {
    const { enemy, age, camera } = context;
    const socket = FANG_SOCKETS[data.socket];
    const wobble = Math.sin(age * 2.1 + data.socket * 1.9) * 0.5;
    enemy.mesh.position
      .copy(boss.headPosition)
      .addScaledVector(boss.headRight, socket[0] * 1.15 + wobble * 0.4)
      .addScaledVector(boss.headUp, socket[1] * 1.15 + wobble)
      .addScaledVector(boss.headForward, 4.5);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.socket * 1.57 + Math.sin(age * 1.4 + data.socket) * 0.3);
    return false;
  }

  function heartKilled() {
    return boss.heartKilled;
  }

  function summaryLine() {
    if (!boss.heartSpawned) return undefined;
    return boss.heartKilled ? 'The Suneater is slain' : 'The Suneater still feeds';
  }

  return { updateHeart, updateFang, heartKilled, summaryLine };
}

export type Suneater = ReturnType<typeof createSuneater>;
