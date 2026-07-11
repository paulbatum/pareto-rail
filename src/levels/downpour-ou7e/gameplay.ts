import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createMusicTime } from '../../engine/music-time';

export const DOWNPOUR_OU7E_BPM = 176;
export const DOWNPOUR_OU7E_TIME = createMusicTime(DOWNPOUR_OU7E_BPM, { stepsPerBar: 16 });
export const DOWNPOUR_OU7E_RUN_DURATION = DOWNPOUR_OU7E_TIME.bar(44);

export type DownpourOu7eEnemyKind = 'drone' | 'skater' | 'turret' | 'gunship';
export type DownpourOu7eSpawnData = { lead: number; offset: Vector3; motion: 'hover' | 'cross' | 'drop' | 'boss'; seed: number };
type Spawn = LockOnSpawnEntry<DownpourOu7eEnemyKind, DownpourOu7eSpawnData>;
const bar = (value: number) => DOWNPOUR_OU7E_TIME.bar(value);

// Storm ceiling → vertical tower faces → wet avenue → drowned undercity → canal → citadel.
export function createDownpourOu7eRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 18, 0), new Vector3(-8, 13, -80), new Vector3(10, 6, -155),
    new Vector3(-4, -8, -245), new Vector3(0, -16, -340), new Vector3(12, -12, -450),
    new Vector3(-10, -18, -570), new Vector3(0, -26, -690), new Vector3(8, -20, -810),
    new Vector3(-6, -12, -920), new Vector3(0, 0, -1040),
  ], false, 'catmullrom', 0.42);
}

const entries = (time: number, kind: DownpourOu7eEnemyKind, motion: DownpourOu7eSpawnData['motion'], offsets: Array<[number, number]>, lead = 4.6): Spawn[] =>
  offsets.map(([x, y], index) => ({ time: time + index * 0.12, kind, data: { lead, offset: new Vector3(x, y, 0), motion, seed: time * 2.3 + index * 1.71 } }));

export const DOWNPOUR_OU7E_SPAWN_TIMELINE: Spawn[] = [
  // Storm ceiling: small hunter beacons drift through rain, then slice across the first descent.
  ...entries(bar(2), 'drone', 'hover', [[-5, 2], [-2, 3.5], [2, 3.5], [5, 2]]),
  ...entries(bar(4), 'skater', 'cross', [[-13, 1], [13, 3], [-13, 5]]),
  ...entries(bar(6), 'drone', 'drop', [[-6, 4], [0, 5.5], [6, 4]]),
  ...entries(bar(8), 'turret', 'hover', [[-5, 1], [5, 1]], 5.2),
  // Tower faces: alternating lanes make the descent feel like an ambush, not a parade.
  ...entries(bar(11), 'skater', 'cross', [[-15, -1], [15, 2], [-15, 4], [15, 0]]),
  ...entries(bar(13), 'drone', 'drop', [[-7, 5], [-3, 2], [3, 2], [7, 5]]),
  ...entries(bar(15), 'turret', 'hover', [[0, 5.4]], 5.5),
  ...entries(bar(17), 'drone', 'hover', [[-7, 1], [-3.5, 3], [0, 4], [3.5, 3], [7, 1]]),
  // Avenue: dense DnB call-and-response under signage.
  ...entries(bar(20), 'skater', 'cross', [[-16, 0], [16, 4], [-16, 2], [16, 5], [-16, 4]]),
  ...entries(bar(22), 'turret', 'hover', [[-6, 4], [6, 4]], 5.0),
  ...entries(bar(24), 'drone', 'drop', [[-7, 5], [-3.5, 2], [0, 0], [3.5, 2], [7, 5]]),
  ...entries(bar(26), 'skater', 'cross', [[15, 1], [-15, 3], [15, 5], [-15, 0]]),
  // Undercity and flooded canal breathe, then fold into the citadel approach.
  ...entries(bar(29), 'drone', 'hover', [[-5, 4], [0, 2], [5, 4]]),
  ...entries(bar(31), 'turret', 'hover', [[-7, 1], [0, 5], [7, 1]], 5.3),
  ...entries(bar(33), 'skater', 'cross', [[-16, 3], [16, 0], [-16, 5], [16, 2]]),
  ...entries(bar(35), 'drone', 'drop', [[-7, 4], [-2.4, 1], [2.4, 1], [7, 4]]),
  ...entries(bar(37), 'turret', 'hover', [[-5, 4], [5, 4]], 5.1),
  // A single acid-green pursuit craft owns the last phrase.
  { time: bar(36), kind: 'gunship' as const, hitStages: [3, 3, 3], data: { lead: 16, offset: new Vector3(0, 3, 0), motion: 'boss' as const, seed: 99 } },
].sort((a, b) => a.time - b.time);

export function updateDownpourEnemy({ enemy, age, runTime, curve, railAnchor }: LockOnEnemyUpdate<DownpourOu7eEnemyKind, DownpourOu7eSpawnData>) {
  const { data } = enemy.entry;
  const lead = data.motion === 'boss' ? Math.min(data.lead, Math.max(2.2, DOWNPOUR_OU7E_RUN_DURATION - enemy.spawnTime - 0.3)) : data.lead;
  const base = offsetFromRail(curve, railAnchor(lead), data.offset);
  const phase = age * (data.motion === 'cross' ? 4.2 : 2.1) + data.seed;
  if (data.motion === 'cross') base.x += Math.sin(phase) * 8;
  if (data.motion === 'drop') base.y -= Math.max(0, age - 0.5) * 1.6 + Math.sin(phase) * 0.5;
  if (data.motion === 'hover') base.y += Math.sin(phase) * 0.7;
  if (data.motion === 'boss') { base.x += Math.sin(runTime * 1.8) * 4.5; base.y += Math.sin(runTime * 2.7) * 1.2; }
  enemy.mesh.position.copy(base);
  enemy.mesh.rotation.z = Math.sin(phase) * 0.3;
  enemy.mesh.rotation.y = phase * 0.25;
  const scale = data.motion === 'boss' ? 2.3 : enemy.kind === 'turret' ? 1.15 : 0.9;
  enemy.mesh.scale.setScalar(scale);
  return age > lead + (data.motion === 'boss' ? 6 : 1.2);
}

export const downpourOu7eGameplay: LockOnRunnerLevel<DownpourOu7eEnemyKind, DownpourOu7eSpawnData> = {
  duration: DOWNPOUR_OU7E_RUN_DURATION, bpm: DOWNPOUR_OU7E_BPM, createRail: createDownpourOu7eRail,
  spawnTimeline: DOWNPOUR_OU7E_SPAWN_TIMELINE, updateEnemy: updateDownpourEnemy,
  lockRadiusNdc: 0.14,
  timing: { shotDelay: { maxGridSeconds: 0.11 } },
  scoreForKill: (volley, enemy) => (enemy.kind === 'gunship' ? 1200 : enemy.kind === 'turret' ? 260 : 140) * volley,
  rankForRun: (score, kills, total) => kills === total ? 'S' : kills >= total * 0.85 && score > total * 300 ? 'A' : kills >= total * 0.6 ? 'B' : 'C',
  detailsForRun: () => ['COURIER ROUTE: BLACK CHANNEL', 'HUNTER: ACID-GREEN GUNSHIP'],
};
