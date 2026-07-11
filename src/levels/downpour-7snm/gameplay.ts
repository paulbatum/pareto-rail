import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';

export const DOWNPOUR_7SNM_BPM = 176;
export const DOWNPOUR_7SNM_TIME = createMusicTime(DOWNPOUR_7SNM_BPM, { stepsPerBar: 16 });
export const DOWNPOUR_7SNM_RUN_DURATION = DOWNPOUR_7SNM_TIME.bar(44);
const bar = (n: number) => DOWNPOUR_7SNM_TIME.bar(n);

export const DOWNPOUR_MARKERS = {
  firstPlunge: bar(4), avenue: bar(12), secondDescent: bar(20),
  canal: bar(28), hunterReveal: bar(30), citadel: bar(34), cloudbreak: bar(42),
} as const;

export type Downpour7snmEnemyKind = 'interceptor' | 'crawler' | 'skimmer' | 'sentinel' | 'gunship';
type Motion = 'wing' | 'wall' | 'slalom' | 'guard' | 'boss';
export type Downpour7snmSpawnData = {
  motion: Motion; lead: number; lane: number; row: number; phase: number;
};
export type DownpourSpawnEntry = LockOnSpawnEntry<Downpour7snmEnemyKind, Downpour7snmSpawnData>;

const SPEED_KEYS: Array<[number, number]> = [
  [0, .46], [bar(3.5), .7], [bar(4), 1.72], [bar(6), 1.12],
  [bar(18), 1.2], [bar(20), 1.85], [bar(22), 1.25], [bar(28), 1.42],
  [bar(34), 1.62], [bar(40), 1.9], [bar(42), .62], [bar(44), .4],
];
const speed = createSpeedProfile(SPEED_KEYS, DOWNPOUR_7SNM_RUN_DURATION);
export const downpourRunProgress = speed.runProgress;
export const downpourSpeedAt = speed.speedAt;

export function createDownpour7snmRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 235, 0), new Vector3(-10, 230, -85),
    new Vector3(20, 175, -185), new Vector3(-14, 98, -300), // tower plunge
    new Vector3(5, 42, -430), new Vector3(30, 35, -570),
    new Vector3(-32, 31, -720), new Vector3(18, 28, -860), // avenue
    new Vector3(-8, -15, -990), new Vector3(10, -68, -1110), // second descent
    new Vector3(-24, -76, -1240), new Vector3(22, -73, -1380),
    new Vector3(-18, -62, -1520), new Vector3(8, -48, -1650), // canal
    new Vector3(30, 10, -1770), new Vector3(-20, 92, -1880),
    new Vector3(10, 188, -1990), new Vector3(0, 278, -2100), // citadel ascent
    new Vector3(-8, 330, -2230), new Vector3(0, 355, -2360),
  ], false, 'catmullrom', .38);
}

const formation = (time: number, kind: Downpour7snmEnemyKind, motion: Motion, lanes: number[], lead = 4.2, row = 0): DownpourSpawnEntry[] =>
  lanes.map((lane, i) => ({ time: time + i * .11, kind, data: { motion, lead, lane, row, phase: i * 1.71 + time } }));
const armored = (entries: DownpourSpawnEntry[], hitStages: number[]): DownpourSpawnEntry[] => entries.map(entry => ({ ...entry, hitStages }));

const timeline: DownpourSpawnEntry[] = [
  ...formation(bar(2), 'interceptor', 'wing', [-2,-1,0,1,2], 4.8),
  ...formation(bar(5), 'interceptor', 'wing', [-2.5,-1.5,-.5,.5,1.5,2.5], 4.0),
  ...formation(bar(7), 'crawler', 'wall', [-2,-1,1,2], 4.5, 1),
  ...formation(bar(9), 'interceptor', 'wing', [-2,-1,0,1,2], 3.9, -1),
  ...formation(bar(11), 'crawler', 'wall', [-2.5,-1.25,0,1.25,2.5], 4.4, -1),
  ...formation(bar(13), 'interceptor', 'wing', [-3,-2,-1,0,1,2], 3.8),
  ...formation(bar(15), 'crawler', 'wall', [-2,-1,1,2], 4.1, 1),
  ...formation(bar(17), 'interceptor', 'wing', [-2.5,-1.5,-.5,.5,1.5,2.5], 3.8, -1),
  ...formation(bar(21), 'crawler', 'wall', [-2,-1,0,1,2], 3.8),
  ...formation(bar(23), 'interceptor', 'wing', [-2.5,-1.5,-.5,.5,1.5,2.5], 3.6),
  ...armored(formation(bar(25), 'sentinel', 'guard', [-1.5,1.5], 5.0), [2,2]),
  ...formation(bar(26), 'crawler', 'wall', [-2,-1,0,1,2], 3.8, -1),
  ...formation(bar(28.5), 'skimmer', 'slalom', [-2,-1,0,1,2], 4.0),
  ...formation(bar(30.5), 'skimmer', 'slalom', [-2.5,-1.5,-.5,.5,1.5,2.5], 3.8),
  ...formation(bar(32), 'interceptor', 'wing', [-2,-1,0,1,2], 3.7, 1),
  ...armored(formation(bar(34), 'sentinel', 'guard', [-2,0,2], 4.8), [2,2]),
  ...formation(bar(36), 'interceptor', 'wing', [-2.5,-1.5,-.5,.5,1.5,2.5], 3.5),
  ...armored(formation(bar(38), 'sentinel', 'guard', [-2.2,2.2], 4.5), [3,3]),
  { time: bar(39), kind: 'gunship' as const, hitStages: [6,6,6], data: { motion:'boss' as const, lead:5.6, lane:0, row:0, phase:0 } },
].sort((a,b) => a.time-b.time);

export const DOWNPOUR_7SNM_SPAWN_TIMELINE = timeline;

export const downpour7snmGameplay: LockOnRunnerLevel<Downpour7snmEnemyKind, Downpour7snmSpawnData> = {
  duration: DOWNPOUR_7SNM_RUN_DURATION, bpm: DOWNPOUR_7SNM_BPM,
  createRail: createDownpour7snmRail, spawnTimeline: timeline,
  easeRunProgress: downpourRunProgress,
  playerHealth: 4, lockRadiusNdc: .25,
  timing: { shotDelay: { maxGridSeconds: .155 }, actionSfx: { enabled: true, gridThirtyseconds: 1 } },
  scoreForKill(size, enemy) { return Math.round((enemy.kind === 'gunship' ? 900 : enemy.kind === 'sentinel' ? 190 : enemy.kind === 'skimmer' ? 135 : 110) * (1 + Math.max(0,size-1)*.14)); },
  scoreForHit(_size, enemy) { return enemy.kind === 'gunship' ? 75 : 30; },
  rankForRun(score, kills, total) { const ratio = kills / Math.max(1,total); return ratio > .92 && score > 8500 ? 'S' : ratio > .78 ? 'A' : ratio > .58 ? 'B' : ratio > .35 ? 'C' : 'D'; },
  detailsForRun() { return ['ROUTE 07 · PRIORITY BLACK', 'STORM WINDOW · 60.0 SEC']; },
  updateEnemy({ enemy, runProgress, age, curve, camera, railAnchor }) {
    const d = enemy.entry.data;
    const u = railAnchor(d.lead);
    const lane = d.lane * 3.2;
    const drift = new Vector3();
    if (d.motion === 'wing') drift.set(lane + Math.sin(age*2.4+d.phase)*1.2, d.row*2.2 + Math.cos(age*2+d.phase)*1.1, 0);
    if (d.motion === 'wall') drift.set((d.row || (d.lane<0?-1:1))*10.5, d.lane*2.1 + Math.sin(age*1.8+d.phase), Math.sin(age*2.5)*1.5);
    if (d.motion === 'slalom') drift.set(Math.sin(age*2.2+d.phase)*8 + lane*.35, -3.8 + Math.abs(Math.sin(age*3+d.phase))*.8, 0);
    if (d.motion === 'guard') drift.set(lane, 2.5 + Math.sin(age*1.3+d.phase)*1.3, Math.cos(age*1.7+d.phase));
    if (d.motion === 'boss') drift.set(Math.sin(age*.65)*7, 5 + Math.sin(age*1.2)*1.5, -2);
    enemy.mesh.position.copy(offsetFromRail(curve, u, drift));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(d.motion === 'wall' ? Math.PI/2 * Math.sign(drift.x) : Math.sin(age*1.5+d.phase)*.18);
    enemy.mesh.rotateY(d.motion === 'wing' ? 0 : Math.sin(age+d.phase)*.22);
    const grace = d.motion === 'boss' ? .05 : .025;
    return runProgress > MathUtils.clamp(u + grace, 0, 1);
  },
};
