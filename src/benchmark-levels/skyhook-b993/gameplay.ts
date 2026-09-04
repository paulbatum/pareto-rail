import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';

export const SKYHOOK_B993_BPM = 120;
export const TIME = createMusicTime(SKYHOOK_B993_BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(30);
export const BOSS_TIME = TIME.bar(18);
export const DOCK_TIME = TIME.bar(27);
export const CLIMBER_HULL = 8;
export const PLAYER_HULL = 5;
const speed = createSpeedProfile([[0, 0.65], [10, 1], [14, 1.5], [17, 1.15], [32, 1.15], [50, 1.0], [54, 0.7], [58, 0.08], [60, 0]], DURATION);
export const climbProgress = speed.runProgress;
export const climbSpeed = speed.speedAt;
export const climbZ = (time: number) => -900 * climbProgress(time);
export type Kind = 'sail' | 'diver' | 'satellite' | 'borer' | 'bolt' | 'harvester';
export type Data = { x: number; y: number; seed: number; life: number; origin?: Vector3 };
export type Entry = LockOnSpawnEntry<Kind, Data>;
export type ClimbState = { carHull: number; carHits: number; bossId: number; bossDead: boolean; bossStage: number; bossRemaining: number; pilotHull: number };
export function createSkyhookB993Rail() {
  // Local -Z is the tether's upward axis; the planet defines the visual horizon.
  return new CatmullRomCurve3([new Vector3(), new Vector3(0, 0, -300), new Vector3(0, 0, -600), new Vector3(0, 0, -900)]);
}
const wave = (bar: number, kind: Kind, points: [number, number][], spacing = 0.25): Entry[] => points.map(([x, y], i) => ({
  time: TIME.bar(bar) + TIME.beats(spacing * i), kind,
  hitPoints: kind === 'borer' ? 2 : 1,
  data: { x: x * 1.6, y: y * 1.4, seed: i * 1.83 + bar, life: kind === 'borer' ? 6.4 : kind === 'satellite' ? 5.8 : 5.2 },
}));
export const SKYHOOK_B993_SPAWN_TIMELINE: Entry[] = [
  ...wave(0.5, 'sail', [[-13, 5], [-5, 9], [5, 9], [13, 5]]),
  ...wave(2, 'sail', [[-16, -6], [-9, -2], [0, -9], [9, -2], [16, -6]]),
  ...wave(3.5, 'diver', [[-14, 9], [14, 9], [-7, -8], [7, -8]]),
  ...wave(5, 'sail', [[-17, 4], [-10, 8], [-4, -6], [4, -6], [10, 8], [17, 4]], 0.18),
  // The cloud breakthrough gets a full bar without new threats.
  ...wave(7.5, 'diver', [[-16, -5], [16, -5], [-10, 9], [10, 9]]),
  ...wave(9, 'sail', [[-17, 8], [-10, -7], [-7, 9], [3, -7], [10, 9], [17, -7]], 0.18),
  ...wave(10.5, 'satellite', [[-14, 7], [14, -7]]),
  ...wave(11.5, 'diver', [[-17, -6], [17, 7], [-7, 9], [7, -7]]),
  ...wave(13, 'satellite', [[-15, -7], [15, 8], [-7, 8], [7, -7]]),
  ...wave(14.5, 'borer', [[-15, 7], [15, -7]]),
  ...wave(15.5, 'satellite', [[-17, -5], [17, 7], [-6, 9], [6, -7]]),
  ...wave(16.5, 'borer', [[-12, -7], [12, 7]]),
  { time: BOSS_TIME, kind: 'harvester' as const, hitStages: [6, 6, 6, 6, 6, 6], data: { x: 0, y: 4.8, seed: 0, life: 17.5 } },
].sort((a, b) => a.time - b.time);

export function createSkyhookDesign(bus: EventBus) {
  const state: ClimbState = { carHull: CLIMBER_HULL, carHits: 0, bossId: -1, bossDead: false, bossStage: 0, bossRemaining: 36, pilotHull: PLAYER_HULL };
  bus.on('runstart', () => Object.assign(state, { carHull: CLIMBER_HULL, carHits: 0, bossId: -1, bossDead: false, bossStage: 0, bossRemaining: 36, pilotHull: PLAYER_HULL }));
  bus.on('spawn', ({ kind, enemyId }) => { if (kind === 'harvester') { state.bossId = enemyId; bus.emit('bossphase', { phase: 'summoned' }); } });
  bus.on('kill', ({ enemyId }) => { if (enemyId === state.bossId) { state.bossDead = true; bus.emit('bossphase', { phase: 'destroyed' }); } });
  bus.on('playerhit', ({ healthRemaining }) => { state.pilotHull = healthRemaining; });
  const level: LockOnRunnerLevel<Kind, Data> = {
    duration: DURATION, bpm: SKYHOOK_B993_BPM,
    createRail: createSkyhookB993Rail, easeRunProgress: climbProgress,
    spawnTimeline: SKYHOOK_B993_SPAWN_TIMELINE,
    playerHealth: PLAYER_HULL, lockRadiusNdc: 0.16, allowLockUndo: true,
    scoreForKill: (size, enemy) => (enemy.kind === 'harvester' ? 3000 : enemy.kind === 'borer' ? 220 : 100) * (1 + (size - 1) * 0.4),
    scoreForHit: (size) => 25 + size * 8,
    scoreForVolley: (results) => results.length === 6 ? 400 : 0,
    rankForRun: (_score, kills, total) => !state.bossDead ? 'ADRIFT' : state.carHull === CLIMBER_HULL && state.pilotHull === PLAYER_HULL && kills / total > 0.9 ? 'PERFECT ASCENT' : kills / total > 0.8 ? 'FLIGHT DIRECTOR' : 'DOCKED',
    detailsForRun: () => [`Climber integrity: ${state.carHull}/${CLIMBER_HULL}`, state.bossDead ? 'Tether cleared · station secured' : 'Harvester reached the climber'],
    updateEnemy({ enemy, age, runTime, enemyState, spawnEnemy, damagePlayer }) {
      const d = enemy.entry.data;
      const mesh = enemy.mesh;
      const s = enemyState(() => ({ fired: false, impact: false }));
      const carDamage = () => {
        state.carHull = Math.max(0, state.carHull - 1); state.carHits++;
        if (state.carHull === 0) damagePlayer(99);
      };
      if (enemy.kind === 'harvester') {
        state.bossStage = enemy.hitStageIndex;
        state.bossRemaining = enemy.hitPointsRemaining;
        const stageReady = age >= enemy.hitStageIndex * TIME.beats(5);
        enemy.entry.lockable = stageReady;
        mesh.userData.shielded = !stageReady;
        mesh.userData.stage = enemy.hitStageIndex;
        // Alternating clamp strokes never interrupt the overall descent.
        mesh.position.set(Math.sin(age * 0.65) * 0.4, 4.8, climbZ(runTime) - (76 - age * 3.35));
        mesh.rotation.z = Math.sin(age * 1.7) * 0.025;
        if (age >= d.life) { state.carHull = 0; state.carHits++; damagePlayer(99); return true; }
        return false;
      }
      if (enemy.kind === 'bolt') {
        const t = Math.min(1, age / d.life);
        mesh.position.copy(d.origin!).lerp(new Vector3(0, 0, climbZ(runTime) - 0.5), t * t);
        mesh.rotation.z = age * 3;
        if (t === 1) { damagePlayer(); return true; }
        return false;
      }
      const p = Math.min(1, age / d.life);
      let x = d.x, y = d.y, depth = 40 - age * 3.5;
      if (enemy.kind === 'sail') {
        x += Math.sin(age * 1.4 + d.seed) * 3.0;
        y += Math.sin(age * 2.0 + d.seed) * 1.25;
        mesh.rotation.z = Math.sin(age * 1.4 + d.seed) * 0.24;
        mesh.rotation.y = Math.sin(age * 0.8 + d.seed) * 0.3;
      } else if (enemy.kind === 'diver') {
        const dive = Math.max(0, (p - 0.4) / 0.6) ** 2;
        x = d.x * (1 - dive); y = d.y * (1 - dive) - 3.8 * dive;
        depth = 40 * (1 - dive) + 3 * dive;
        mesh.rotation.z = Math.atan2(-d.x, d.y + 4) * dive;
        mesh.rotation.x = p * 0.4;
      } else if (enemy.kind === 'satellite') {
        x += Math.cos(age * 2 + d.seed) * 2.1;
        y += Math.sin(age * 2 + d.seed) * 2.1;
        mesh.rotation.z = age * 0.55 + d.seed;
        if (!s.fired && age > 3.6) {
          s.fired = true;
          spawnEnemy({ time: runTime, kind: 'bolt', countsTowardTotal: false, data: { x: 0, y: 0, seed: 0, life: 2.8, origin: mesh.position.clone() } });
        }
      } else {
        const dive = p ** 2.5;
        x = d.x * (1 - dive) + Math.sin(age * 5) * 0.3;
        y = d.y * (1 - dive) - 3.8 * dive;
        depth = 40 - 37 * dive;
        mesh.rotation.z = age * 2.4;
      }
      mesh.position.set(x, y, climbZ(runTime) - depth);
      if (age >= d.life) {
        if ((enemy.kind === 'diver' || enemy.kind === 'borer') && !s.impact) { s.impact = true; carDamage(); }
        return true;
      }
      return false;
    },
  };
  return { level, state };
}

export function createSkyhookGameplay(bus: EventBus) { return createSkyhookDesign(bus).level; }
