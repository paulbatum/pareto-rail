import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createRailPacer, resolveRailPacing, type RailPacingOverrides, type RailPacingResolved } from '../../engine/rail-pacer';
import { createSpeedProfile } from '../../engine/speed-profile';
import { offsetFromRail } from '../../engine/rail';
import { RUSH_RUN_DURATION, RUSH_TIME, RUSH_TUNING } from './tuning';

export const RUSH_BPM = RUSH_TUNING.bpm;
export { RUSH_RUN_DURATION, RUSH_TIME } from './tuning';

export type RushEnemyKind = 'pod' | 'dart' | 'heavy';
export type RushEnemyMotion = 'gate' | 'strafe' | 'sink';

export type RushSpawnData = {
  engagement: RailPacingResolved;
  lane: number;
  row: number;
  phase: number;
  motion: RushEnemyMotion;
  radiusUnits: number;
};

export const rushSpeedProfile = createSpeedProfile(RUSH_TUNING.speedProfile.keys, RUSH_RUN_DURATION, { samples: 1600 });

export function speedFactorAt(time: number) {
  return rushSpeedProfile.speedAt(time);
}

export function rushRunProgress(time: number, duration = RUSH_RUN_DURATION) {
  return rushSpeedProfile.runProgress(time, duration);
}

export function createRushRail() {
  const length = RUSH_TUNING.rail.lengthUnits;
  const bend = RUSH_TUNING.rail.bendWidthUnits;
  const rise = RUSH_TUNING.rail.bendHeightUnits;
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 1, -length * 0.08),
      new Vector3(bend * 0.34, -rise * 0.22, -length * 0.18),
      new Vector3(bend, -rise * 0.5, -length * 0.34),
      new Vector3(bend * 0.3, rise * 0.16, -length * 0.48),
      new Vector3(-bend * 0.82, rise * 0.44, -length * 0.66),
      new Vector3(-bend * 0.28, -rise * 0.2, -length * 0.82),
      new Vector3(0, 0, -length),
    ],
    false,
    'catmullrom',
    0.22,
  );
}

type RushWave = {
  bar: number;
  beat?: number;
  kind: RushEnemyKind;
  motion: RushEnemyMotion;
  lanes: readonly number[];
  row?: number;
  stepEvery?: number;
  engagement?: RailPacingOverrides;
  radiusUnits?: number;
  hitPoints?: number;
};

const RUSH_PACER_DEFAULTS = resolveRailPacing({
  spawnAheadUnits: RUSH_TUNING.fog.farUnits * 0.92,
  engageAheadUnits: RUSH_TUNING.enemies.engageAheadUnits,
  enterSeconds: 0.5,
  readableFor: RUSH_TIME.beats(2),
  exitSeconds: 0.45,
});

const SHORT_SURGE_ENGAGEMENT = { readableFor: RUSH_TIME.beats(1.25), exitSeconds: 0.34 } as const;
const HEAVY_ENGAGEMENT = { readableFor: RUSH_TIME.beats(2.6), exitAheadUnits: RUSH_TUNING.enemies.engageAheadUnits * 0.55 } as const;
const TERMINAL_HEAVY_ENGAGEMENT = { ...HEAVY_ENGAGEMENT, readableFor: RUSH_TIME.beats(1.6), exitSeconds: 0.34 } as const;

export const rushPacer = createRailPacer({
  curve: createRushRail(),
  duration: RUSH_RUN_DURATION,
  runProgress: rushRunProgress,
  defaults: RUSH_PACER_DEFAULTS,
});

const WAVES: readonly RushWave[] = [
  { bar: 1, kind: 'pod', motion: 'gate', lanes: [-1, 0, 1], row: 0, stepEvery: 2 },
  { bar: 2, beat: 2, kind: 'dart', motion: 'strafe', lanes: [-2, -1, 1, 2], row: 0, stepEvery: 1 },
  { bar: 4, kind: 'pod', motion: 'gate', lanes: [-2, 0, 2], row: 1, stepEvery: 2 },
  { bar: 5, beat: 2, kind: 'dart', motion: 'strafe', lanes: [2, 1, -1, -2], row: -1, stepEvery: 1, engagement: SHORT_SURGE_ENGAGEMENT },
  { bar: 7, kind: 'heavy', motion: 'sink', lanes: [-1, 1], row: 0, stepEvery: 3, hitPoints: 2, engagement: HEAVY_ENGAGEMENT, radiusUnits: 4.9 },
  { bar: 8, beat: 2, kind: 'pod', motion: 'gate', lanes: [-2, -1, 0, 1, 2], row: 1, stepEvery: 1 },
  { bar: 10, kind: 'dart', motion: 'strafe', lanes: [-2, 2, -1, 1, 0], row: -1, stepEvery: 1 },
  { bar: 12, kind: 'heavy', motion: 'sink', lanes: [0], row: 0, stepEvery: 4, hitPoints: 3, engagement: HEAVY_ENGAGEMENT, radiusUnits: 4.4 },
  { bar: 13, beat: 2, kind: 'pod', motion: 'gate', lanes: [-2, -1, 1, 2], row: 1, stepEvery: 1, engagement: SHORT_SURGE_ENGAGEMENT },
  { bar: 15, kind: 'dart', motion: 'strafe', lanes: [2, -2, 1, -1, 0, 2], row: 0, stepEvery: 1 },
  { bar: 17, kind: 'pod', motion: 'gate', lanes: [-2, 0, 2, -1, 1], row: -1, stepEvery: 1, engagement: SHORT_SURGE_ENGAGEMENT },
  { bar: 18, beat: 2, kind: 'heavy', motion: 'sink', lanes: [-1, 1], row: 0, stepEvery: 2, hitPoints: 2, engagement: TERMINAL_HEAVY_ENGAGEMENT, radiusUnits: 5.1 },
  { bar: 19, beat: 2, kind: 'dart', motion: 'strafe', lanes: [-2, -1, 0, 1, 2, 0], row: 1, stepEvery: 1, engagement: SHORT_SURGE_ENGAGEMENT },
] as const;

function waveTime(wave: RushWave, index: number) {
  const beat = wave.beat ?? 0;
  const stepEvery = wave.stepEvery ?? 1;
  return RUSH_TIME.bar(wave.bar, beat) + index * stepEvery * RUSH_TIME.stepSeconds;
}

function buildTimeline(): Array<LockOnSpawnEntry<RushEnemyKind, RushSpawnData>> {
  const entries: Array<LockOnSpawnEntry<RushEnemyKind, RushSpawnData>> = [];
  for (const wave of WAVES) {
    wave.lanes.forEach((lane, index) => {
      entries.push({
        time: waveTime(wave, index),
        kind: wave.kind,
        hitPoints: wave.hitPoints,
        data: {
          engagement: rushPacer.resolve(wave.engagement),
          lane,
          row: wave.row ?? 0,
          phase: index * 1.137 + wave.bar * 0.61,
          motion: wave.motion,
          radiusUnits: wave.radiusUnits ?? RUSH_TUNING.enemies.laneRadiusUnits,
        },
      });
    });
  }
  return entries.filter((entry) => entry.time < RUSH_RUN_DURATION - 0.8).sort((a, b) => a.time - b.time);
}

export const RUSH_SPAWN_TIMELINE = buildTimeline();

const tempOffset = new Vector3();

export const rushGameplay: LockOnRunnerLevel<RushEnemyKind, RushSpawnData> = {
  duration: RUSH_RUN_DURATION,
  bpm: RUSH_BPM,
  createRail: createRushRail,
  spawnTimeline: RUSH_SPAWN_TIMELINE,
  easeRunProgress: rushRunProgress,
  lockRadiusNdc: 0.1,
  playerHealth: 3,
  scoreForKill(volleySize, enemy) {
    const base = enemy.kind === 'heavy' ? 180 : enemy.kind === 'dart' ? 120 : 100;
    return Math.round(base * (1 + Math.max(0, volleySize - 1) * 0.1));
  },
  detailsForRun() {
    return [`${Math.round(createRushRail().getLength() / RUSH_RUN_DURATION)} u/s base rail`, 'speed rig prototype'];
  },
  updateCameraEffects({ camera, curve, runProgress }) {
    const tangent = curve.getTangentAt(MathUtils.clamp(runProgress, 0, 1));
    const bank = MathUtils.degToRad(RUSH_TUNING.rail.bankDegrees) * MathUtils.clamp(-tangent.x * 2.2, -1, 1);
    camera.rotateZ(bank);
  },
  updateEnemy({ enemy, runTime, age, curve, camera }) {
    const data = enemy.entry.data;
    const paced = rushPacer.sample(enemy.entry.time, runTime, data.engagement);
    const anchorU = paced.anchorU;
    const laneX = data.lane * data.radiusUnits;
    const rowY = data.row * 1.85;
    const speed = speedFactorAt(runTime);

    if (data.motion === 'gate') {
      const pulse = Math.sin(age * 8.5 + data.phase) * 0.45;
      tempOffset.set(laneX + Math.sin(runTime * 1.8 + data.phase) * 0.35, rowY + pulse, 0);
    } else if (data.motion === 'strafe') {
      const side = data.lane >= 0 ? 1 : -1;
      const sweep = side * Math.max(0, 5.6 - age * (4.1 + speed * 1.1));
      tempOffset.set(laneX + sweep, rowY + Math.sin(age * 7 + data.phase) * 1.2, Math.sin(age * 5) * 0.9);
    } else {
      const sink = Math.sin(Math.min(1, age * 0.8) * Math.PI) * -2.2;
      tempOffset.set(laneX * 0.75 + Math.sin(age * 1.8 + data.phase) * 0.7, rowY + sink, Math.cos(age * 2.1) * 0.7);
    }

    if (paced.phase === 'exit' || paced.phase === 'done') {
      const exit = paced.phase === 'done' ? 1 : paced.phaseProgress;
      const side = data.lane >= 0 ? 1 : -1;
      if (enemy.kind === 'dart') {
        tempOffset.x += side * exit * exit * 11;
        tempOffset.y += Math.sin(exit * Math.PI) * 2.4;
      } else if (enemy.kind === 'heavy') {
        tempOffset.y -= exit * exit * 3.2;
        tempOffset.z -= exit * 16;
      } else {
        tempOffset.y += Math.sin(exit * Math.PI) * 1.4;
        tempOffset.z += exit * 4;
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, tempOffset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.phase + runTime * (enemy.kind === 'dart' ? -2.7 : enemy.kind === 'heavy' ? 0.45 : 1.2));
    enemy.mesh.rotateX(Math.sin(runTime * 1.6 + enemy.id) * 0.18);

    return runTime > paced.exitCompleteTime + RUSH_TUNING.enemies.missGraceSeconds;
  },
};
