import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';

export const SKYHOOK_U9LG_BPM = 120;
export const SKYHOOK_U9LG_TIME = createMusicTime(SKYHOOK_U9LG_BPM, { stepsPerBar: 16 });
export const SKYHOOK_U9LG_RUN_DURATION = SKYHOOK_U9LG_TIME.bar(30);
export const BOSS_TIME = SKYHOOK_U9LG_TIME.bar(18);
export const BOSS_DEADLINE = SKYHOOK_U9LG_TIME.bar(26);
const speed = createSpeedProfile([[0, 0.6], [10, 1], [14, 1.55], [18, 1.1], [32, 1.25], [48, 1.05], [54, 0.8], [58, 0.12], [60, 0]], 60);
export const climbProgress = speed.runProgress;
export const climbSpeed = speed.speedAt;

// Local forward is altitude: the tether is straight; weather and planet supply
// the changing frame of reference. Keeping the rail straight sells a climber.
export function createSkyhookU9lgRail() {
  return new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0, 0, -240), new Vector3(0, 0, -480), new Vector3(0, 0, -720)]);
}
export type SkyhookKind = 'kite' | 'skiff' | 'limpet' | 'vacuum' | 'shrapnel' | 'tether-eater';
export type SkyhookData = { x: number; y: number; seed: number; life: number; origin?: Vector3 };
type Entry = LockOnSpawnEntry<SkyhookKind, SkyhookData>;
const bar = SKYHOOK_U9LG_TIME.bar;
const timeline: Entry[] = [];
function wave(at: number, kind: SkyhookKind, points: number[][], stagger = 0.125) {
  points.forEach(([x, y], i) => timeline.push({ time: at + i * stagger, kind, hitPoints: kind === 'vacuum' ? 2 : 1, data: { x, y, seed: i * 1.7 + at, life: kind === 'limpet' ? 6.2 : 6.8 } }));
}
// Each phrase is a readable gesture: open chevrons, opposing sweeps, a six
// target cloud-break fan, then harder sparse machines in the upper atmosphere.
wave(bar(1), 'kite', [[-12, 5], [-5, 9], [5, 9], [12, 5]]);
wave(bar(3), 'kite', [[-14, -4], [-8, 4], [-2, 9], [5, 6], [12, -3]]);
wave(bar(4.5), 'limpet', [[-11, -6], [11, -6]], 0.25);
wave(bar(6), 'skiff', [[-13, 7], [13, -5], [-9, -6]], 0.25);
wave(bar(7), 'kite', [[-15, 1], [-9, 7], [-3, 10], [3, 10], [9, 7], [15, 1]], 0.0625);
wave(bar(9), 'limpet', [[-14, -5], [14, -5], [-7, 6]], 0.25);
wave(bar(10), 'skiff', [[-13, 8], [13, 6], [-10, -6], [10, -7]], 0.25);
wave(bar(12), 'vacuum', [[-13, 6], [13, -6], [-11, -7], [11, 7]], 0.125);
wave(bar(13.5), 'limpet', [[-14, 4], [14, -4]], 0.25);
wave(bar(15), 'vacuum', [[-15, 1], [-7, 9], [12, -8], [15, 2]], 0.125);
wave(bar(16), 'skiff', [[-13, -6], [13, 6]], 0.5);
wave(bar(17), 'limpet', [[-11, -7], [11, -7]], 0.25);
timeline.push({ time: BOSS_TIME, kind: 'tether-eater', hitStages: [6, 6, 6, 6, 6], data: { x: 3.2, y: 1, seed: 0, life: BOSS_DEADLINE - BOSS_TIME } });
export const SKYHOOK_U9LG_SPAWN_TIMELINE = timeline.sort((a, b) => a.time - b.time);

export function createSkyhookGameplay(bus: EventBus) {
  let integrity = 100;
  let carHits = 0;
  let bossDead = false;
  let bossId = -1;
  let impactTime = -100;
  let runningTime = 0;
  const off = [
    bus.on('runstart', () => { integrity = 100; carHits = 0; bossDead = false; bossId = -1; impactTime = -100; }),
    bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'tether-eater') { bossId = enemyId; bus.emit('bossphase', { phase: 'summoned' }); } }),
    bus.on('kill', ({ enemyId }) => { if (enemyId === bossId) { bossDead = true; bus.emit('bossphase', { phase: 'destroyed' }); } }),
    bus.on('stage', ({ enemyId, stageIndex }) => { if (enemyId === bossId && stageIndex === 4) bus.emit('bossphase', { phase: 'exposed' }); }),
  ];
  const level: LockOnRunnerLevel<SkyhookKind, SkyhookData> = {
    duration: SKYHOOK_U9LG_RUN_DURATION, bpm: SKYHOOK_U9LG_BPM,
    createRail: createSkyhookU9lgRail, spawnTimeline: SKYHOOK_U9LG_SPAWN_TIMELINE,
    easeRunProgress: climbProgress, playerHealth: 5, lockRadiusNdc: 0.15,
    timing: { shotDelay: { maxGridSeconds: 0.16 } },
    scoreForKill: (size, enemy) => (enemy.kind === 'tether-eater' ? 2200 : enemy.kind === 'limpet' ? 170 : 110) * (1 + (size - 1) * 0.3),
    scoreForHit: (size) => 25 + size * 5,
    scoreForVolley: (results) => results.length === 6 ? 300 : 0,
    rankForRun: (_score, kills, total) => kills / total > 0.95 ? 'S' : kills / total > 0.8 ? 'A' : kills / total > 0.6 ? 'B' : 'C',
    detailsForRun: () => [`CLIMBER INTEGRITY ${integrity}% · ${carHits} IMPACTS`, bossDead ? 'TETHER CLEARED · STATION U9 DOCKED' : 'TETHER CONTACT LOST'],
    updateAttractCamera({ camera, modeTime }) {
      camera.position.set(Math.sin(modeTime * 0.2) * 0.3, 0.3, 4);
      camera.lookAt(0, 0, -50);
    },
    updateEnemy({ enemy, age, runTime, camera, enemyState, spawnEnemy, damagePlayer, playerHealth }) {
      runningTime = runTime;
      const { x, y, seed, life } = enemy.entry.data;
      const state = enemyState(() => ({ fired: false, lastAge: age }));
      const dt = Math.max(0, age - state.lastAge); state.lastAge = age;
      const mesh = enemy.mesh;
      if (enemy.kind === 'tether-eater') {
        // Each broken radiator exposes the next bank as the crawler descends.
        enemy.entry.lockable = age >= enemy.hitStageIndex * 2.4;
        mesh.userData.phaseWaiting = !enemy.entry.lockable;
        const distance = MathUtils.lerp(90, 4, MathUtils.clamp(age / life, 0, 1));
        mesh.position.copy(camera.position).add(new Vector3(3.2, -1.2, -distance));
        mesh.rotation.z = Math.sin(age * 1.6) * 0.028;
        mesh.userData.bossAge = age;
        mesh.userData.bossDamage = enemy.hitStageIndex * 6 + 6 - enemy.stageHitPointsRemaining;
        if (age >= life) { integrity = 0; carHits++; impactTime = runTime; damagePlayer(playerHealth); return true; }
        return false;
      }
      if (enemy.kind === 'shrapnel') {
        if (age < 0.04) mesh.position.copy(enemy.entry.data.origin ?? camera.position);
        const aim = camera.position.clone().add(new Vector3(0, 0, -0.6));
        mesh.position.lerp(aim, Math.min(1, dt * 1.25));
        mesh.rotation.z += dt * 5;
        if (age > 3.3 || mesh.position.distanceTo(camera.position) < 2.2) { damagePlayer(); return true; }
        return false;
      }
      let px = x, py = y;
      const approach = MathUtils.smoothstep(age, 0, life);
      let distance = 34 - age * 2.6;
      if (enemy.kind === 'kite') {
        px += Math.sin(age * 1.8 + seed) * 2.2;
        py += Math.sin(age * 2.6 + seed) * 1.3;
        mesh.rotation.set(0.1 * Math.sin(age), 0.2 * Math.cos(age + seed), Math.sin(age * 1.8 + seed) * 0.23);
      } else if (enemy.kind === 'skiff') {
        px += Math.sin(age * 1.1 + seed) * 5;
        py += Math.sin(age * 0.6 + seed) * 1.4;
        mesh.rotation.z = Math.cos(age * 1.1 + seed) * -0.35;
        if (age > 3.4 && !state.fired) {
          state.fired = true;
          spawnEnemy({ time: runTime, kind: 'shrapnel', countsTowardTotal: false, data: { x: 0, y: 0, seed, life: 3.5, origin: mesh.position.clone() } });
        }
      } else if (enemy.kind === 'limpet') {
        const dive = MathUtils.smoothstep(age, 3.5, life);
        px = MathUtils.lerp(x + Math.sin(age * 2 + seed), -3, dive);
        py = MathUtils.lerp(y, -4, dive);
        distance = MathUtils.lerp(32, 2, dive);
        mesh.rotation.z = Math.sin(age * 2 + seed) * 0.15;
      } else if (enemy.kind === 'vacuum') {
        px += Math.cos(age * 2 + seed) * 1.8;
        py += Math.sin(age * 2 + seed) * 1.8;
        mesh.rotation.z = age * 0.7 + seed;
        distance = 36 - approach * 18;
      }
      mesh.position.copy(camera.position).add(new Vector3(px, py, -distance));
      if (age >= life) {
        if (enemy.kind === 'limpet') { integrity = Math.max(0, integrity - 20); carHits++; impactTime = runTime; if (integrity === 0) damagePlayer(playerHealth); }
        else if (enemy.kind === 'vacuum') damagePlayer();
        return true;
      }
      return false;
    },
  };
  return Object.assign(level, {
    status: () => ({ integrity, carHits, bossDead, bossId, impactTime, runTime: runningTime }),
    dispose: () => off.forEach((stop) => stop()),
  });
}
