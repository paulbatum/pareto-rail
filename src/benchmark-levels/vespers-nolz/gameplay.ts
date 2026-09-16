import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { offsetFromRail } from '../../engine/rail';

export const VESPERS_NOLZ_BPM = 80;
export const VESPERS_NOLZ_TIME = createMusicTime(VESPERS_NOLZ_BPM);
export const VESPERS_NOLZ_RUN_DURATION = VESPERS_NOLZ_TIME.bar(20);
export const ROSE_Z = -382;
export const JEWELS = [0x234be8, 0xb51938, 0x168c55, 0xe2a32e];
export type VespersNolzEnemyKind = 'moth' | 'shroud' | 'thurible' | 'vesper';
export type VespersNolzSpawnData = { x: number; y: number; phase: number; pane: number; tint: number; lead: number };

// The last twelve seconds approach the rose slowly rather than passing through it.
export function runProgress(t: number) {
  if (t <= 42) return t / 42 * 280 / 348;
  if (t <= 48) return (280 + (t - 42) * 9) / 348;
  return Math.min(1, (334 + (t - 48) * 14 / 12) / 348);
}
export function createVespersNolzRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 0, 0), new Vector3(1.8, 1, -85),
    new Vector3(-1.4, 3, -165), new Vector3(0, 1, -250),
    new Vector3(0, 0, -348),
  ], false, 'catmullrom', 0.5);
}

const entries: Array<LockOnSpawnEntry<VespersNolzEnemyKind, VespersNolzSpawnData>> = [];
const usedPanes = new Set<number>();
function add(bar: number, beat: number, kind: VespersNolzEnemyKind, x: number, y: number, phase: number) {
  const time = VESPERS_NOLZ_TIME.bar(bar, beat);
  const desiredBay = Math.min(20, Math.max(0, Math.round((runProgress(time + 3) * 348 - 18) / 18)));
  let pane = desiredBay * 4 + (x > 0 ? 2 : 0) + (y > 1 ? 1 : 0);
  while (usedPanes.has(pane)) pane = (pane + 1) % 88;
  usedPanes.add(pane);
  entries.push({ time, kind, data: { x, y, phase, pane, tint: (Math.floor(pane / 4) + pane % 4) % 4, lead: 5.2 } });
}
// The two manual parts answer from opposite galleries, then join in six-note fans.
add(1, 0, 'moth', -11, 5, 0); add(1, 1, 'moth', 10, -5, 1);
add(2, 0, 'shroud', 12, 6, 2); add(2, 1.5, 'moth', -12, -6, 3);
add(3, 0, 'thurible', -9, 7, 0); add(3, 1, 'shroud', 10, -6, 1); add(3, 2, 'moth', 2, 8, 2);
for (const bar of [4, 6, 8, 10]) {
  for (let i = 0; i < 6; i++) {
    const kinds: VespersNolzEnemyKind[] = ['moth', 'shroud', 'thurible'];
    add(bar, i * 0.3, kinds[(i + bar) % 3], [-13, -7, 1, 12, 7, -2][i], [5, -6, 8, -4, 6, -7][i], i * 1.1);
  }
}
for (const bar of [5, 7, 9]) {
  add(bar, 1, 'shroud', -11, -5, bar); add(bar, 2, 'thurible', 12, 6, bar + 1);
}
// Bars 12–14: an intentional six-second empty span after the last thieves pass.
for (let i = 0; i < 6; i++) add(14, i * 0.45, i % 2 ? 'shroud' : 'moth', [-12, 12, -8, 8, -3, 3][i], [6, -6, -5, 7, 8, -7][i], i);
entries.push({ time: VESPERS_NOLZ_TIME.bar(16), kind: 'vesper', hitStages: [6, 6, 6], data: { x: 0, y: 0, phase: 0, pane: -1, tint: 3, lead: 12 } });
export const VESPERS_NOLZ_SPAWN_TIMELINE = entries.sort((a, b) => a.time - b.time);

export const vespersNolzGameplay: LockOnRunnerLevel<VespersNolzEnemyKind, VespersNolzSpawnData> = {
  duration: VESPERS_NOLZ_RUN_DURATION, bpm: VESPERS_NOLZ_BPM,
  createRail: createVespersNolzRail, easeRunProgress: runProgress,
  spawnTimeline: VESPERS_NOLZ_SPAWN_TIMELINE,
  lockRadiusNdc: 0.15, allowLockUndo: true, startWord: 'START',
  scoreForKill: (size, enemy) => (enemy.kind === 'vesper' ? 1800 : 120) * (1 + (size - 1) * 0.35),
  scoreForHit: (size) => 35 * size,
  scoreForVolley: (results) => results.length === 6 ? 600 : 0,
  rankForRun: (_score, kills, total) => kills / total > 0.94 ? 'LUX' : kills / total > 0.75 ? 'CANTOR' : kills / total > 0.4 ? 'ACOLYTE' : 'NOCTURNE',
  updateEnemy({ enemy, age, runTime, curve, railAnchor }) {
    const d = enemy.entry.data;
    enemy.mesh.userData.pane = d.pane;
    enemy.mesh.userData.tint = d.tint;
    enemy.mesh.userData.hp = enemy.hitPointsRemaining;
    if (enemy.kind === 'vesper') {
      enemy.mesh.position.set(Math.sin(age * 0.4) * 0.7, Math.sin(age * 0.7) * 0.5, ROSE_Z + 2);
      enemy.mesh.rotation.z = Math.sin(age * 0.35) * 0.08;
      enemy.mesh.userData.open = enemy.hitStageIndex;
      return runTime > 59.6;
    }
    let x = d.x, y = d.y;
    if (enemy.kind === 'moth') {
      x += Math.sin(age * 2.4 + d.phase) * 1.8;
      y += Math.sin(age * 4 + d.phase) * 0.6;
      enemy.mesh.rotation.z = Math.sin(age * 2.4 + d.phase) * 0.24;
    } else if (enemy.kind === 'shroud') {
      x += Math.sin(age * 0.9 + d.phase) * 2.5;
      y += Math.sin(age * 1.1 + d.phase) * 1.9;
      enemy.mesh.rotation.z = Math.sin(age + d.phase) * 0.13;
    } else {
      x += Math.sin(age * 1.7 + d.phase) * 3;
      y += (1 - Math.cos(age * 1.7 + d.phase)) * 1.1;
      enemy.mesh.rotation.z = Math.sin(age * 1.7 + d.phase) * 0.45;
    }
    // Thieves detach from the actual window before entering their sweep lanes.
    const bay = Math.floor(d.pane / 4), side = d.pane % 4 < 2 ? -1 : 1;
    const target = offsetFromRail(curve, railAnchor(d.lead), new Vector3(x, y, 0));
    const detach = Math.min(1, age / 0.85); const eased = 1 - (1 - detach) ** 3;
    enemy.mesh.position.set(side * 21, d.pane % 2 ? 23 : 5, -18 - bay * 18).lerp(target, eased);
    return age > d.lead + 0.5;
  },
};
