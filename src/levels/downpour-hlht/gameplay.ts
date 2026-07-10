import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { DOWNPOUR_BPM, DOWNPOUR_DURATION, DOWNPOUR_MARKERS, DOWNPOUR_TIME } from './timing';

export { DOWNPOUR_BPM, DOWNPOUR_DURATION, DOWNPOUR_MARKERS } from './timing';

export type DownpourEnemyKind = 'drone' | 'turret' | 'skiff' | 'gunship';
export type DownpourSpawnData = {
  lead: number;
  lane: number;
  rise: number;
  phase: number;
  motion: 'swoop' | 'brace' | 'skate' | 'hunt';
};

const speedProfile = createSpeedProfile([
  [0, 0.64],
  [DOWNPOUR_MARKERS.firstDrop - 0.5, 0.84],
  [DOWNPOUR_MARKERS.firstDrop, 1.72],
  [DOWNPOUR_TIME.bar(18), 1.15],
  [DOWNPOUR_MARKERS.secondDrop - 0.45, 1.05],
  [DOWNPOUR_MARKERS.secondDrop, 1.82],
  [DOWNPOUR_MARKERS.hunt, 1.26],
  [DOWNPOUR_MARKERS.release, 0.48],
  [DOWNPOUR_DURATION, 0.32],
], DOWNPOUR_DURATION, { samples: 1600 });

export const downpourRunProgress = (time: number, duration = DOWNPOUR_DURATION) => speedProfile.runProgress(time, duration);

export function createDownpourRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 42, 0), new Vector3(8, 38, -100), new Vector3(-12, 18, -250),
    new Vector3(2, -92, -430), new Vector3(19, -140, -620), new Vector3(-14, -154, -820),
    new Vector3(-30, -150, -1030), new Vector3(14, -150, -1220), new Vector3(4, -168, -1430),
    new Vector3(-8, -268, -1610), new Vector3(12, -320, -1780), new Vector3(-8, -292, -1950),
    new Vector3(5, -90, -2120), new Vector3(0, 118, -2300), new Vector3(0, 235, -2450),
  ], false, 'catmullrom', 0.36);
}

type Wave = { bar: number; beat?: number; kind: DownpourEnemyKind; motion: DownpourSpawnData['motion']; lanes: readonly number[]; rise?: number; lead?: number; hp?: number };
const WAVES: readonly Wave[] = [
  { bar: 2, kind: 'drone', motion: 'swoop', lanes: [-2, 0, 2] },
  { bar: 4, beat: 2, kind: 'drone', motion: 'swoop', lanes: [3, 1, -1, -3], rise: 1 },
  { bar: 7, kind: 'turret', motion: 'brace', lanes: [-2.5, 2.5], lead: 5.0 },
  { bar: 9, kind: 'drone', motion: 'swoop', lanes: [-3, -1, 1, 3], rise: -1 },
  // First lightning descent: exposed security units arrive in a hard fan.
  { bar: 11, kind: 'turret', motion: 'brace', lanes: [-3, 0, 3], lead: 4.6 },
  { bar: 12, beat: 2, kind: 'drone', motion: 'swoop', lanes: [4, 2, -2, -4], rise: 1 },
  { bar: 15, kind: 'skiff', motion: 'skate', lanes: [-2, 2], rise: -1, lead: 4.8, hp: 2 },
  { bar: 17, kind: 'drone', motion: 'swoop', lanes: [-3, -1, 1, 3] },
  { bar: 19, kind: 'turret', motion: 'brace', lanes: [-3, 0, 3], rise: 1, lead: 4.7 },
  { bar: 21, kind: 'skiff', motion: 'skate', lanes: [3, -3, 0], lead: 4.3 },
  { bar: 24, kind: 'drone', motion: 'swoop', lanes: [-4, -2, 0, 2, 4], rise: -1 },
  { bar: 26, kind: 'turret', motion: 'brace', lanes: [-2.5, 2.5], lead: 4.5 },
  // Second descent goes into the flooded canal: low skiffs cut through the mist.
  { bar: 29, kind: 'skiff', motion: 'skate', lanes: [-3, -1, 1, 3], rise: -2, lead: 4.2 },
  { bar: 31, beat: 2, kind: 'drone', motion: 'swoop', lanes: [4, 2, 0, -2, -4], rise: 1 },
  { bar: 33, kind: 'turret', motion: 'brace', lanes: [-3, 0, 3], lead: 4.5 },
  { bar: 35, kind: 'skiff', motion: 'skate', lanes: [-3.5, 3.5], rise: 1, lead: 4.4, hp: 2 },
  // The hunter owns the final phrase, first as a wing pair then a multi-stage core.
  { bar: 37, kind: 'gunship', motion: 'hunt', lanes: [-3.2, 3.2], lead: 6.0, hp: 2 },
  { bar: 39, kind: 'gunship', motion: 'hunt', lanes: [0], rise: 1, lead: 7.0, hp: 4 },
  { bar: 41, kind: 'drone', motion: 'swoop', lanes: [-3, 3], lead: 3.8 },
] as const;

function buildTimeline(): Array<LockOnSpawnEntry<DownpourEnemyKind, DownpourSpawnData>> {
  return WAVES.flatMap((wave, waveIndex) => wave.lanes.map((lane, index) => {
    const entry: LockOnSpawnEntry<DownpourEnemyKind, DownpourSpawnData> = {
      time: DOWNPOUR_TIME.bar(wave.bar, wave.beat ?? 0) + index * DOWNPOUR_TIME.stepSeconds * (wave.kind === 'drone' ? 1.7 : 2.2),
      kind: wave.kind,
      data: { lead: wave.lead ?? 4.5, lane, rise: wave.rise ?? 0, phase: waveIndex * 0.73 + index * 1.41, motion: wave.motion },
    };
    if (wave.hp !== undefined) entry.hitPoints = wave.hp;
    if (wave.kind === 'gunship' && wave.hp === 4) entry.hitStages = [2, 2];
    return entry;
  })).filter((entry) => entry.time < DOWNPOUR_MARKERS.release - 1.2).sort((a, b) => a.time - b.time);
}

export const DOWNPOUR_SPAWN_TIMELINE = buildTimeline();
const drift = new Vector3();

export const downpourGameplay: LockOnRunnerLevel<DownpourEnemyKind, DownpourSpawnData> = {
  duration: DOWNPOUR_DURATION,
  bpm: DOWNPOUR_BPM,
  timing: { shotDelay: { maxGridSeconds: 0.56, gridRampGapGrowthThirtyseconds: 1 } },
  createRail: createDownpourRail,
  spawnTimeline: DOWNPOUR_SPAWN_TIMELINE,
  easeRunProgress: downpourRunProgress,
  playerHealth: 3,
  lockRadiusNdc: 0.105,
  scoreForKill(volley, enemy) {
    const base = enemy.kind === 'gunship' ? 260 : enemy.kind === 'skiff' ? 155 : enemy.kind === 'turret' ? 130 : 110;
    return Math.round(base * (1 + Math.max(0, volley - 1) * 0.13));
  },
  rankForRun(score, kills, total) {
    const ratio = total === 0 ? 0 : kills / total;
    return ratio > 0.92 ? 'NIGHT RUNNER' : ratio > 0.75 ? 'COURIER' : ratio > 0.5 ? 'WET WIRES' : 'LOST IN RAIN';
  },
  detailsForRun() { return ['44 bars / 60 seconds', 'hunter-gunship escaped the storm ceiling']; },
  updateEnemy({ enemy, age, runTime, runProgress, curve, camera, railAnchor }) {
    const d = enemy.entry.data;
    const anchor = railAnchor(d.lead);
    if (d.motion === 'swoop') {
      drift.set(d.lane * 2.1 + Math.sin(age * 3.2 + d.phase) * 2.7, d.rise * 1.4 + Math.cos(age * 4.1 + d.phase) * 1.1, Math.sin(age * 2.2) * 1.3);
    } else if (d.motion === 'brace') {
      drift.set(d.lane * 2.05, d.rise * 1.5 + Math.sin(runTime * 2 + d.phase) * 0.35, 0);
    } else if (d.motion === 'skate') {
      drift.set(d.lane * 1.8 + Math.sin(age * 2.6 + d.phase) * 2.2, -2.2 + d.rise * 1.15 + Math.sin(age * 5) * 0.45, Math.cos(age * 3) * 1.1);
    } else {
      const tighten = Math.max(0.45, 1 - age * 0.08);
      drift.set(d.lane * tighten + Math.sin(runTime * 1.8 + d.phase) * 1.8, d.rise * 1.5 + Math.cos(runTime * 2.1 + d.phase) * 1.1, 0);
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchor, drift));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(d.phase + runTime * (enemy.kind === 'drone' ? -2.7 : enemy.kind === 'skiff' ? 1.8 : 0.45));
    return runProgress > anchor + MathUtils.lerp(0.018, 0.03, enemy.kind === 'gunship' ? 1 : 0);
  },
};
