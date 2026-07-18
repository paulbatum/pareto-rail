import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { StrandlineSpawnData, StrandlineSpawnEntry, StrandlineUpdate } from './gameplay';
import { bar } from './timing';

// The Matriarch: the parent organism, dug into the crown where the strands
// root into the bell. She hides behind a lattice of her own webbing and pumps
// out broods to defend it; every brood killed lets a curtain of that webbing
// die back, until she is bare and can be torn loose. The whole fight is one
// readable idea — the violet in the frame is her, and it recedes kill by kill.

const BROOD_WAVES: Array<{ atBar: number; slots: Array<[number, number]> }> = [
  { atBar: 15.6, slots: [[-15, 7], [1, -6], [15, 8]] },
  { atBar: 17.6, slots: [[-18, -2], [8, 12], [19, 1]] },
];

export const BROOD_TOTAL = BROOD_WAVES.reduce((sum, wave) => sum + wave.slots.length, 0);

const FLINCH_SECONDS = 1.4;
const LOCK_DISTANCE = 130; // camera-to-matriarch range where she can be locked once bare
const BROOD_AHEAD_U = 0.045; // broods escort the camera at this rail fraction ahead

type MatriarchEntries = {
  matriarchEntry: StrandlineSpawnEntry;
  broodEntries: StrandlineSpawnEntry[];
  timeline: StrandlineSpawnEntry[];
};

type MatriarchOptions = {
  matriarchEntry: StrandlineSpawnEntry;
  broodEntries: StrandlineSpawnEntry[];
  /** Rail parameter of the crown grip point (resolved from the speed profile). */
  crownU(): number;
};

export function createMatriarchEntries(time: number): MatriarchEntries {
  const matriarchEntry: StrandlineSpawnEntry = {
    time,
    kind: 'matriarch',
    hitStages: [3, 3],
    lockable: false,
    data: { role: 'matriarch' },
  };
  const broodEntries: StrandlineSpawnEntry[] = BROOD_WAVES.flatMap((wave, waveIndex) =>
    wave.slots.map(([holdX, holdY], slot): StrandlineSpawnEntry => ({
      time: bar(wave.atBar) + slot * 0.22,
      kind: 'brood',
      data: { role: 'brood', wave: waveIndex, slot, holdX, holdY },
    })),
  );
  return { matriarchEntry, broodEntries, timeline: [matriarchEntry, ...broodEntries] };
}

export function createMatriarch(bus: EventBus, options: MatriarchOptions) {
  const boss = {
    matriarchId: -1,
    spawned: false,
    killed: false,
    killedAtTime: -1,
    exposed: false,
    flinchUntil: -1,
    lastRunTime: -1,
    broodIds: new Set<number>(),
    broodsKilled: 0,
    position: new Vector3(),
  };

  bus.on('runstart', () => {
    boss.matriarchId = -1;
    boss.spawned = false;
    boss.killed = false;
    boss.killedAtTime = -1;
    boss.exposed = false;
    boss.flinchUntil = -1;
    boss.lastRunTime = -1;
    boss.broodIds.clear();
    boss.broodsKilled = 0;
    options.matriarchEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'brood') boss.broodIds.add(enemyId);
    if (kind === 'matriarch') {
      boss.spawned = true;
      boss.matriarchId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  bus.on('kill', ({ enemyId }) => {
    if (boss.broodIds.delete(enemyId)) {
      boss.broodsKilled += 1;
      // Bare: the last brood dies and the webbing it fed dies with it.
      if (boss.broodsKilled >= BROOD_TOTAL && !boss.exposed) {
        boss.exposed = true;
        if (boss.flinchUntil < boss.lastRunTime) options.matriarchEntry.lockable = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
    if (enemyId === boss.matriarchId) {
      boss.killed = true;
      boss.killedAtTime = boss.lastRunTime;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  // Stage break: her forward grip tears free; she reels, unlockable for a
  // breath, then digs the remaining hooks in and bares her core again.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== boss.matriarchId) return;
    boss.flinchUntil = boss.lastRunTime + FLINCH_SECONDS;
    options.matriarchEntry.lockable = false;
  });

  function updateMatriarch(context: StrandlineUpdate, _data: Extract<StrandlineSpawnData, { role: 'matriarch' }>) {
    const { enemy, runTime, curve, camera } = context;
    boss.lastRunTime = runTime;
    const flinching = boss.flinchUntil > runTime;

    // Dug in at the crown: she never leaves it — the rail brings you to her.
    // The grip ratchets as she works the strand roots; a flinch throws the
    // whole carapace wide of the grip line.
    const sway = flinching ? Math.sin(runTime * 4.2) * 3.6 : Math.sin(runTime * 0.8) * 1.1;
    const bob = Math.sin(runTime * 1.3) * 0.8 + (flinching ? Math.sin(runTime * 6.1) * 1.2 : 0);
    enemy.mesh.position.copy(offsetFromRail(curve, options.crownU(), new Vector3(sway, 11.5 + bob, 0)));
    boss.position.copy(enemy.mesh.position);

    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.55) * 0.12 + (flinching ? Math.sin(runTime * 5.3) * 0.3 : 0));
    enemy.mesh.userData.exposed = boss.exposed && !flinching && !boss.killed;
    enemy.mesh.userData.flinching = flinching;
    enemy.mesh.userData.broodsKilled = boss.broodsKilled;

    // Re-arm after a flinch; range-gate so locks only open once she is close
    // enough to read.
    if (boss.exposed && !flinching && !boss.killed) {
      options.matriarchEntry.lockable = camera.position.distanceTo(enemy.mesh.position) < LOCK_DISTANCE;
    }
    return false;
  }

  function updateBrood(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'brood' }>) {
    const { enemy, age, runProgress, curve, camera } = context;
    // Born at the crown, each brood swims down the strands to meet you, then
    // escorts the camera — a violet picket line between you and the parent.
    const holdU = MathUtils.clamp(runProgress + BROOD_AHEAD_U, 0, 1);
    const hold = offsetFromRail(curve, holdU, new Vector3(
      data.holdX + Math.sin(age * 1.9 + data.slot * 2.1) * 1.5,
      data.holdY + Math.cos(age * 1.5 + data.wave + data.slot) * 1.3,
      0,
    ));
    const arrive = MathUtils.clamp(age / 1.9, 0, 1);
    const eased = 1 - (1 - arrive) ** 2.4;
    enemy.mesh.position.lerpVectors(boss.spawned ? boss.position : hold, hold, eased);
    enemy.mesh.quaternion.copy(camera.quaternion);
    // A larval wriggle: constant flexing even at station.
    enemy.mesh.rotation.z = Math.sin(age * 8.2 + data.slot * 2.6) * 0.55;
    enemy.mesh.userData.wriggle = Math.sin(age * 8.2 + data.slot * 2.6);
    return false;
  }

  return {
    updateMatriarch,
    updateBrood,
    matriarchKilled: () => boss.killed,
    matriarchSpawned: () => boss.spawned,
    matriarchExposed: () => boss.exposed,
    broodsKilled: () => boss.broodsKilled,
    position: () => boss.position,
    summaryLine() {
      if (!boss.spawned) return undefined;
      if (!boss.killed) {
        return boss.exposed ? 'The Matriarch was bared but never torn loose' : 'The Matriarch still grips the crown';
      }
      return 'Matriarch torn from the crown — every strand runs clean';
    },
  };
}

export type Matriarch = ReturnType<typeof createMatriarch>;
