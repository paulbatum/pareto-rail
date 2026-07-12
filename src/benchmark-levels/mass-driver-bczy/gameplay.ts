import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { createMusicTime } from '../../engine/music-time';

// 32 bars at 128 BPM is exactly sixty seconds.  The machine marks each beat;
// the speed curve is intentionally also the source of truth for the rings.
export const MASS_DRIVER_BCZY_BPM = 128;
export const MASS_DRIVER_BCZY_TIME = createMusicTime(MASS_DRIVER_BCZY_BPM, { stepsPerBar: 16 });
export const MASS_DRIVER_BCZY_RUN_DURATION = MASS_DRIVER_BCZY_TIME.bar(32);
export const MASS_DRIVER_BCZY_MARKERS = {
  injection: MASS_DRIVER_BCZY_TIME.bar(0),
  blueBank: MASS_DRIVER_BCZY_TIME.bar(8),
  violetBank: MASS_DRIVER_BCZY_TIME.bar(16),
  interlocks: MASS_DRIVER_BCZY_TIME.bar(24),
  launch: MASS_DRIVER_BCZY_TIME.bar(31),
};

export type MassDriverBczyEnemyKind = 'skimmer' | 'coilguard' | 'interlock';
export type MassDriverBczySpawnData = {
  lead: number;
  lane: number;
  row: number;
  phase: number;
  motion: 'sweep' | 'orbit' | 'brace';
};

const speedProfile = createSpeedProfile([
  [0, 0.48], [MASS_DRIVER_BCZY_TIME.bar(4), 0.62], [MASS_DRIVER_BCZY_TIME.bar(8), 0.86],
  [MASS_DRIVER_BCZY_TIME.bar(12), 1.14], [MASS_DRIVER_BCZY_TIME.bar(16), 1.38],
  [MASS_DRIVER_BCZY_TIME.bar(20), 1.72], [MASS_DRIVER_BCZY_TIME.bar(24), 2.08],
  [MASS_DRIVER_BCZY_TIME.bar(28), 2.45], [MASS_DRIVER_BCZY_TIME.bar(31), 3.1],
  [MASS_DRIVER_BCZY_RUN_DURATION, 4.15],
], MASS_DRIVER_BCZY_RUN_DURATION, { samples: 1800 });

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_BCZY_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

export function massDriverSpeedAt(time: number) { return speedProfile.speedAt(time); }

export function createMassDriverBczyRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 0, 0), new Vector3(0, 1, -110), new Vector3(7, -3, -250),
    new Vector3(-10, 5, -430), new Vector3(4, -4, -640), new Vector3(-6, 2, -860),
    new Vector3(0, 0, -1110),
  ], false, 'catmullrom', 0.32);
}

type Wave = { bar: number; beat: number; kind: MassDriverBczyEnemyKind; motion: MassDriverBczySpawnData['motion']; lanes: readonly number[]; row: number; lead?: number; hp?: number };
const WAVES: readonly Wave[] = [
  { bar: 2, beat: 0, kind: 'skimmer', motion: 'sweep', lanes: [-2, 0, 2], row: 1 },
  { bar: 4, beat: 2, kind: 'skimmer', motion: 'sweep', lanes: [2, 1, -1, -2], row: -1 },
  { bar: 6, beat: 0, kind: 'coilguard', motion: 'orbit', lanes: [-2, 2], row: 1, hp: 2 },
  { bar: 8, beat: 0, kind: 'skimmer', motion: 'sweep', lanes: [-3, -1, 1, 3], row: 0 },
  { bar: 10, beat: 1, kind: 'coilguard', motion: 'orbit', lanes: [-2, 0, 2], row: -1, hp: 2 },
  { bar: 12, beat: 0, kind: 'skimmer', motion: 'sweep', lanes: [3, 1, -1, -3], row: 1 },
  { bar: 14, beat: 2, kind: 'coilguard', motion: 'orbit', lanes: [-3, 3], row: 0, hp: 2 },
  { bar: 16, beat: 0, kind: 'skimmer', motion: 'sweep', lanes: [-3, -1, 1, 3], row: -1 },
  { bar: 18, beat: 1, kind: 'coilguard', motion: 'orbit', lanes: [-2, 0, 2], row: 1, hp: 2 },
  { bar: 20, beat: 0, kind: 'skimmer', motion: 'sweep', lanes: [3, 2, 1, -1, -2, -3], row: 0 },
  { bar: 22, beat: 0, kind: 'coilguard', motion: 'orbit', lanes: [-3, -1, 1, 3], row: -1, hp: 2 },
  // Eight locks clear the jammed safety array. A missed plate reads as a failed launch.
  { bar: 24, beat: 0, kind: 'interlock', motion: 'brace', lanes: [-3, -1, 1, 3], row: 1, lead: 4.2, hp: 2 },
  { bar: 26, beat: 0, kind: 'interlock', motion: 'brace', lanes: [-3, -1, 1, 3], row: -1, lead: 3.8, hp: 2 },
];

function buildTimeline(): Array<LockOnSpawnEntry<MassDriverBczyEnemyKind, MassDriverBczySpawnData>> {
  return WAVES.flatMap((wave) => wave.lanes.map((lane, index) => {
    const time = MASS_DRIVER_BCZY_TIME.bar(wave.bar, wave.beat) + index * MASS_DRIVER_BCZY_TIME.stepSeconds * 1.55;
    return { time, kind: wave.kind, hitPoints: wave.hp, hitStages: wave.hp ? [1, wave.hp - 1] : undefined, data: { lead: wave.lead ?? (wave.kind === 'coilguard' ? 3.4 : 3.0), lane, row: wave.row, phase: wave.bar * 0.47 + index * 1.31, motion: wave.motion } };
  })).sort((a, b) => a.time - b.time);
}
export const MASS_DRIVER_BCZY_SPAWN_TIMELINE = buildTimeline();
const offset = new Vector3();

export const massDriverBczyGameplay: LockOnRunnerLevel<MassDriverBczyEnemyKind, MassDriverBczySpawnData> = {
  duration: MASS_DRIVER_BCZY_RUN_DURATION, bpm: MASS_DRIVER_BCZY_BPM,
  createRail: createMassDriverBczyRail, spawnTimeline: MASS_DRIVER_BCZY_SPAWN_TIMELINE,
  easeRunProgress: massDriverRunProgress, lockRadiusNdc: 0.105,
  timing: { shotDelay: { maxGridSeconds: 0.62, gridRampGapGrowthThirtyseconds: 1 } },
  scoreForKill(volley, enemy) { return Math.round((enemy.kind === 'interlock' ? 240 : enemy.kind === 'coilguard' ? 155 : 110) * (1 + Math.max(0, volley - 1) * 0.1)); },
  detailsForRun() { return ['128 beat-locked coils', 'clear all 8 safety interlocks']; },
  rankForRun(score, kills, total) { return kills === total ? (score > 6600 ? 'S' : score > 4600 ? 'A' : 'B') : '—'; },
  updateCameraEffects({ camera, curve, runProgress }) {
    const tangent = curve.getTangentAt(MathUtils.clamp(runProgress, 0, 1));
    camera.rotateZ(-tangent.x * 0.12);
  },
  updateEnemy({ enemy, runTime, age, curve, camera, railAnchor }) {
    const { lead, lane, row, phase, motion } = enemy.entry.data;
    const laneX = lane * 5.4;
    const rowY = row * 5.5;
    if (motion === 'sweep') offset.set(laneX + Math.sin(age * 2.6 + phase) * 1.55, rowY + Math.cos(age * 3.2 + phase) * 0.8, 0);
    else if (motion === 'orbit') offset.set(laneX + Math.cos(age * 2.25 + phase) * 1.25, rowY + Math.sin(age * 2.25 + phase) * 1.25, Math.sin(age * 4 + phase) * 0.55);
    else offset.set(laneX * (1 - Math.min(age / 4.8, 0.24)), rowY + Math.sin(age * 7 + phase) * 0.18, 0);
    enemy.mesh.position.copy(offsetFromRail(curve, railAnchor(lead), offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(phase + age * (motion === 'brace' ? 0.25 : 1.7));
    return runTime > enemy.entry.time + lead + 0.7;
  },
};
