import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';

export const TINKER_BALL_X9A0_BPM = 128;
export const TIME = createMusicTime(TINKER_BALL_X9A0_BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(32); // 60 seconds, including the four-bar clean-table coda.
export type Kind = 'button-beetle' | 'pencil-strider' | 'peg-bird' | 'spill-core';
export type SupplyData = { x: number; y: number; phase: number; size: number; lead: number };
export type Entry = LockOnSpawnEntry<Kind, SupplyData>;

export function createTinkerBallX9a0Rail() {
  return new CatmullRomCurve3([
    new Vector3(-32, 5, 76), new Vector3(-24, 5.5, 54),
    new Vector3(-34, 6, 28), new Vector3(-12, 6.8, 6),
    new Vector3(12, 7.8, 20), new Vector3(31, 8.6, 1),
    new Vector3(24, 9.5, -30), new Vector3(0, 10.5, -48),
    new Vector3(-20, 11, -34), new Vector3(-8, 11.5, -8),
    new Vector3(18, 12, -12), new Vector3(38, 12, -42),
  ], false, 'catmullrom', 0.35);
}

const timeline: Entry[] = [];
function wave(bar: number, kind: Kind, slots: Array<[number, number]>, stagger = 0.5) {
  slots.forEach(([x, y], i) => timeline.push({
    time: TIME.bar(bar, i * stagger), kind,
    data: { x, y, phase: i * 1.9 + bar, size: kind === 'pencil-strider' ? 1.2 : 1, lead: 5.1 },
  }));
}
// Each phrase has a silhouette and a sweep direction. The last beat is a breath.
wave(0.5, 'button-beetle', [[-7,-2], [0,-1], [7,-2]], 1);
wave(2, 'button-beetle', [[8,0], [3,2], [-3,2], [-8,0]], 0.5);
wave(4, 'pencil-strider', [[-8,-1], [7,1]], 1.5);
wave(5, 'button-beetle', [[-5,3], [0,0], [5,3]], 0.5);
wave(6.5, 'peg-bird', [[-8,4], [0,5], [8,3]], 0.75);
wave(8, 'button-beetle', [[-9,-2], [-5,1], [0,3], [5,1], [9,-2]], 0.4);
wave(10, 'pencil-strider', [[-7,2], [7,-1], [0,4]], 0.75);
wave(11.5, 'peg-bird', [[9,4], [3,1], [-3,4], [-9,1]], 0.5);
wave(13, 'button-beetle', [[-9,-2], [-4,2], [4,2], [9,-2]], 0.5);
wave(14.5, 'pencil-strider', [[8,3], [0,-2], [-8,3]], 0.75);
wave(16, 'peg-bird', [[-9,4], [-5,0], [0,4], [5,0], [9,4]], 0.5);
wave(18, 'pencil-strider', [[-8,1], [8,1]], 1);
wave(19, 'button-beetle', [[-5,-2], [0,3], [5,-2]], 0.5);
wave(20.5, 'peg-bird', [[-9,4], [0,2], [9,4]], 0.6);
// Three recycled shells, each with three repeat-lock stages. They arrive on
// successive two-bar phrases; the previous shell's supplies remain collectible.
for (let i = 0; i < 3; i++) timeline.push({
  time: TIME.bar(22 + i * 3), kind: 'spill-core', hitStages: [2, 2, 2],
  data: { x: [-6, 6, 0][i], y: [3, 3, 4][i], phase: i, size: 2.25 + i * 0.25, lead: 7 },
});
wave(23, 'peg-bird', [[8,4], [-8,4]], 1);
wave(25, 'button-beetle', [[-8,-2], [8,-2]], 1);
wave(27, 'peg-bird', [[-7,3], [7,3]], 0.75);
export const TINKER_BALL_X9A0_SPAWN_TIMELINE = timeline.sort((a,b) => a.time-b.time);

export const tinkerBallX9a0Gameplay: LockOnRunnerLevel<Kind, SupplyData> = {
  duration: DURATION, bpm: TINKER_BALL_X9A0_BPM,
  createRail: createTinkerBallX9a0Rail,
  spawnTimeline: TINKER_BALL_X9A0_SPAWN_TIMELINE,
  easeRunProgress: (t, duration) => Math.min(1, t / duration),
  updateCameraEffects: ({camera}) => { camera.rotateX(-0.16); },
  lockRadiusNdc: 0.14,
  startWord: 'START',
  replayWord: 'REPLAY',
  scoreForKill: (volley, enemy) => (enemy.kind === 'spill-core' ? 600 : 100) * (1 + (volley - 1) * 0.3),
  scoreForHit: (volley) => 35 + volley * 10,
  rankForRun: (_score, kills, total) => kills / total > 0.92 ? 'POLISHED' : kills / total > 0.7 ? 'RESOURCEFUL' : 'TINKERER',
  updateEnemy({ enemy, age, camera }) {
    const d = enemy.entry.data;
    const boss = enemy.kind === 'spill-core';
    let x = d.x, y = d.y;
    if (enemy.kind === 'button-beetle') {
      x += Math.sin(age * 3.4 + d.phase) * 0.65;
      y += Math.abs(Math.sin(age * 5 + d.phase)) * 0.45;
    } else if (enemy.kind === 'pencil-strider') {
      x += Math.sin(age * 1.7 + d.phase) * 2;
      y += Math.sin(age * 3.4 + d.phase) * 0.45;
    } else if (enemy.kind === 'peg-bird') {
      x += Math.sin(age * 2 + d.phase) * 1.6;
      y += Math.sin(age * 2.9 + d.phase) * 1.4;
    } else {
      x += Math.sin(age * 1.4) * 1.1;
      y += Math.sin(age * 2) * 0.35;
    }
    const distance = boss ? 21 - Math.min(age, 6) * 0.6 : 23 - age * 2.1;
    enemy.mesh.position.set(x, y, -distance).applyQuaternion(camera.quaternion).add(camera.position);
    enemy.mesh.position.y = Math.max(boss ? 3 : 1.8, enemy.mesh.position.y);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(boss ? Math.sin(age) * 0.06 : Math.sin(age * 2 + d.phase) * 0.12);
    const intro = Math.min(1, 0.3 + age * 3);
    enemy.mesh.scale.setScalar(d.size * intro);
    const shell = enemy.mesh.getObjectByName('shell');
    if (shell) {
      shell.rotation.z = boss ? age * 0.3 : 0;
      if (boss) shell.scale.setScalar(1 - enemy.hitStageIndex * 0.16);
    }
    const left = enemy.mesh.getObjectByName('wing-left');
    const right = enemy.mesh.getObjectByName('wing-right');
    if (left && right) { left.rotation.z = Math.sin(age * 9) * 0.65; right.rotation.z = -left.rotation.z; }
    const legs = enemy.mesh.getObjectByName('legs');
    if (legs) legs.rotation.z = Math.sin(age * 9) * 0.18;
    return age > d.lead;
  },
};
