import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { BPM, DURATION, TIME } from './timing';
import { ANIMAL_CENTER, cameraFocus, createRail, createRescueState, nearestStrand, PARENT, railPosition, railProgress, smooth, strandPoint, BELL, type RescueState } from './world';

export type EnemyKind = 'louse' | 'ribbon' | 'cyst' | 'brood' | 'parent';
export type SpawnData = { x: number; y: number; seed: number; lead: number; sector?: number };
type Entry = LockOnSpawnEntry<EnemyKind, SpawnData>;
type Update = LockOnEnemyUpdate<EnemyKind, SpawnData>;

const fan: Array<[number, number]> = [[-11, -4.5], [-7, 5], [-2.5, -1.8], [3.8, 6], [8, -5], [12, 2]];
const crownSockets: Array<[number, number]> = [[-16, 7.8], [0, -10.8], [16, 7.8]];

function wave(bar: number, kind: EnemyKind, points: Array<[number, number]>, stagger = 0.25): Entry[] {
  return points.map(([x, y], i) => ({
    time: TIME.bar(bar) + TIME.stepSeconds * stagger * i,
    kind, hitPoints: kind === 'cyst' ? 2 : 1,
    data: { x: x * 1.4, y: y * 1.4, seed: bar * 2.7 + i * 1.63, lead: kind === 'cyst' ? 6.1 : 5.1 },
  }));
}

function buildTimeline(): Entry[] {
  const entries = [
    ...wave(0.5, 'louse', [[-8, 3.5], [1, -4.8], [10, 4]]),
    ...wave(1.75, 'louse', [[-11, -4], [-4, 5.5], [6, -4.5], [11, 4.5]]),
    ...wave(3, 'ribbon', [[-10, 4.5], [10, -5], [-5, -5.5], [6, 5.5]]),
    ...wave(4.25, 'louse', fan),
    ...wave(5.4, 'cyst', [[-8.5, -3.8], [8.5, 4.8]]),
    ...wave(6.1, 'ribbon', [[-9, 4], [8, -5]]),
    ...wave(8.3, 'ribbon', [[-11, -3.8], [10, 5.5]]),
    ...wave(9.5, 'louse', fan.map(([x, y]) => [-x, -y])),
    ...wave(10.75, 'ribbon', [[-12, -4], [12, 4], [-8, 5], [7, -5]]),
    ...wave(11.6, 'cyst', [[-10.5, 4], [2, -5], [11, 3.5]]),
    ...wave(12.7, 'louse', fan),
    ...wave(13.7, 'ribbon', [[-11, 5], [9, -5], [4, 5.5]]),
  ];
  for (let sector = 0; sector < 3; sector++) {
    for (let i = 0; i < 3; i++) entries.push({
      time: TIME.bar(15.25 + sector * 1.25) + i * TIME.stepSeconds,
      kind: 'brood', data: { x: crownSockets[i][0], y: crownSockets[i][1], seed: sector * 3 + i, sector, lead: 12 },
    });
  }
  return entries.sort((a, b) => a.time - b.time);
}

export function createStrandlineGameplay(bus: EventBus, state: RescueState = createRescueState()): LockOnRunnerLevel<EnemyKind, SpawnData> {
  const parent: Entry = { time: TIME.bar(15), kind: 'parent', hitStages: [3, 3], data: { x: 0, y: 0, seed: 0, lead: 16 } };
  const broodSectors = new Map<number, number>();
  let parentId = -1;
  let restUntil = 0;
  let pullCaptured = false;
  let summoned = false;
  let spawnTarget: Update['spawnEnemy'] | undefined;

  bus.on('runstart', () => {
    state.time = 0; state.kills = 0; state.freedAt = -1; state.exposed = false; state.ended = false;
    state.broodKills = [0, 0, 0]; state.cleansed.clear();
    parent.lockable = true; parentId = -1; restUntil = 0; pullCaptured = false; summoned = false;
    spawnTarget = undefined;
    broodSectors.clear();
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') parentId = enemyId;
  });
  bus.on('stage', ({ enemyId }) => { if (enemyId === parentId) restUntil = state.time + 0.65; });
  bus.on('kill', ({ enemyId, worldPosition, letter }) => {
    if (letter) return;
    state.kills++;
    state.cleansed.add(nearestStrand(worldPosition));
    const sector = broodSectors.get(enemyId);
    if (sector !== undefined) {
      state.broodKills[sector]++;
      if (state.broodKills.every((n) => n === 3) && !state.exposed) {
        state.exposed = true; parent.lockable = true;
        spawnTarget?.({ ...parent, time: state.time });
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
    if (enemyId === parentId) {
      state.freedAt = state.time;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
    broodSectors.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => { broodSectors.delete(enemyId); });
  bus.on('runend', () => { state.ended = true; });

  function updateEnemy(context: Update) {
    const { enemy, camera, runTime, age } = context;
    spawnTarget = context.spawnEnemy;
    state.time = runTime;
    const { data } = enemy.entry;
    if (enemy.kind === 'parent') {
      enemy.mesh.position.copy(PARENT);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(Math.sin(age * 0.55) * 0.05);
      enemy.entry.lockable = state.exposed && runTime >= restUntil && runTime < 52.5;
      enemy.mesh.userData.exposed = state.exposed;
      enemy.mesh.userData.broodKills = state.broodKills;
      enemy.mesh.userData.damage = 6 - enemy.hitPointsRemaining;
      enemy.mesh.userData.stage = enemy.hitStageIndex;
      return false;
    }
    if (enemy.kind === 'brood') {
      broodSectors.set(enemy.id, data.sector!);
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const toward = new Vector3().subVectors(camera.position, PARENT).normalize();
      const deploy = smooth(0, 0.85, age);
      const x = data.x + Math.sin(age * 1.2 + data.seed) * 1.25;
      const y = data.y + Math.cos(age * 1.6 + data.seed) * 0.8;
      enemy.mesh.position.copy(PARENT).addScaledVector(toward, 4.5 + 3 * deploy)
        .addScaledVector(right, x * deploy).addScaledVector(up, y * deploy);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * (data.seed % 2 ? -0.6 : 0.6));
      enemy.mesh.scale.setScalar(0.4 + smooth(0, 0.5, age) * 0.6);
      enemy.entry.lockable = age > 0.6;
      enemy.mesh.userData.tether = PARENT;
      enemy.mesh.userData.latched = true;
      return false;
    }

    const seat = context.enemyState(() => {
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const origin = camera.position.clone().addScaledVector(forward, 28)
        .addScaledVector(right, data.x).addScaledVector(up, data.y);
      const strand = nearestStrand(origin);
      const t = MathUtils.clamp((BELL.y - origin.y) / (154 + strand % 7 * 8.3), 0, 1);
      const tether = strandPoint(strand, t);
      const latch = tether.distanceTo(origin) < 7 ? tether.clone().addScaledVector(right, 0.7) : origin.clone();
      return { tether, latch, position: latch.clone(), lastAge: age, touched: false };
    });
    const dt = Math.max(0, age - seat.lastAge);
    seat.lastAge = age;
    const detach = smooth(0.7, 2.7, age);
    const chase = smooth(0.7, 1.9, age);
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const distance = 28 - smooth(1.8, data.lead, age) * 17;
    const destination = camera.position.clone().addScaledVector(forward, distance)
      .addScaledVector(right, data.x * (0.96 - detach * 0.2)).addScaledVector(up, data.y * (1 - detach * 0.1));
    seat.position.lerp(destination, (1 - Math.exp(-dt * 3.2)) * chase);
    enemy.mesh.position.copy(seat.latch).lerp(seat.position, chase);
    if (enemy.kind === 'louse') {
      enemy.mesh.position.addScaledVector(right, Math.sin(data.seed + age * 2) * 1.4 * detach)
        .addScaledVector(up, -Math.sign(data.y) * detach * 1.2)
        .addScaledVector(forward, -detach * 1.8);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(Math.sin(data.seed) * 0.6 + detach * Math.sin(age * 2) * 0.25);
    } else if (enemy.kind === 'ribbon') {
      enemy.mesh.position.addScaledVector(right, -Math.sign(data.x) * detach * 6 + Math.sin(age * 2.2 + data.seed) * 1.5)
        .addScaledVector(up, Math.sin(age * 2.6 + data.seed) * 2.2 * detach);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(Math.cos(age * 2.6 + data.seed) * 0.65);
    } else {
      enemy.mesh.position.addScaledVector(up, Math.abs(Math.sin(age * 1.65)) * 2.8 - 1.4)
        .addScaledVector(right, Math.sin(data.seed + age * 0.8) * 1.1)
        .addScaledVector(forward, -smooth(1.3, 5.2, age) * 2);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 0.4);
      enemy.mesh.userData.damage = 2 - enemy.hitPointsRemaining;
    }
    enemy.mesh.userData.age = age;
    enemy.mesh.userData.latched = age < 1.1;
    enemy.mesh.userData.tether = seat.tether;
    if (age > data.lead) {
      if (enemy.kind === 'cyst' && !seat.touched) { seat.touched = true; context.damagePlayer(); }
      return true;
    }
    return false;
  }

  return {
    duration: DURATION, bpm: BPM, createRail, spawnTimeline: buildTimeline(), updateEnemy,
    easeRunProgress: railProgress,
    playerHealth: 5, lockRadiusNdc: 0.105, allowLockUndo: true,
    timing: { shotDelay: { maxGridSeconds: 0.18 }, actionSfx: { enabled: true, gridThirtyseconds: 1 } },
    updateCameraEffects({ camera, runTime }) {
      state.time = runTime;
      if (!summoned && runTime >= TIME.bar(15)) { summoned = true; bus.emit('bossphase', { phase: 'summoned' }); }
      camera.lookAt(cameraFocus(runTime));
      if (state.freedAt >= 0) {
        if (!pullCaptured) {
          pullCaptured = true;
          state.pullPosition.copy(camera.position);
        }
        const t = smooth(state.freedAt, DURATION, runTime);
        const distance = Math.pow(t, 1.3);
        camera.position.copy(state.pullPosition).lerp(new Vector3(0, ANIMAL_CENTER.y, 265), distance);
        camera.lookAt(PARENT.clone().lerp(ANIMAL_CENTER, smooth(0, 0.62, t)));
        camera.rotateZ((1 - t) * 0.025);
      } else {
        camera.rotateZ((Math.sin(runTime * 0.43) * 0.1 + Math.sin(runTime * 0.8) * 0.035) * (1 - smooth(34, 38, runTime)));
        if (runTime > 52.5) {
          const retreat = smooth(52.5, 60, runTime);
          camera.position.lerp(new Vector3(0, PARENT.y, 50), retreat);
          camera.lookAt(PARENT);
        }
      }
      camera.updateMatrixWorld();
    },
    updateAttractCamera({ camera, modeTime }) {
      camera.position.copy(railPosition(0)).add(new Vector3(Math.sin(modeTime * 0.2) * 0.4, Math.sin(modeTime * 0.3) * 0.35, 0));
      camera.lookAt(cameraFocus(0));
    },
    scoreForKill: (size, enemy) => (enemy.kind === 'parent' ? 4000 : enemy.kind === 'brood' ? 240 : enemy.kind === 'cyst' ? 180 : 100) * (1 + (size - 1) * 0.25),
    scoreForHit: (size) => 30 + size * 10,
    scoreForVolley: (results) => results.length === 6 && results.every((r) => r.killed) ? 750 : 0,
    rankForRun: (_score, kills, total) => state.freedAt >= 0 ? kills / total > 0.9 ? 'S' : kills / total > 0.72 ? 'A' : 'B' : 'C',
    detailsForRun: () => [state.freedAt >= 0 ? 'The jellyfish drifts free' : 'The colony still holds the crown',
      `${state.broodKills.reduce((a, b) => a + b, 0)} / 9 brood parasites removed`,
      `${state.freedAt >= 0 ? 52 : state.cleansed.size} luminous strands restored`],
  };
}
