import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { offsetFromRail } from '../../engine/rail';
import {
  PURSE_PURSUIT_BPM,
  PURSE_PURSUIT_BARS,
  PURSE_PURSUIT_DURATION,
  PURSE_PURSUIT_TIME,
} from './timing';

export const PURSE_PURSUIT_TAHR_BPM = PURSE_PURSUIT_BPM;
export const PURSE_PURSUIT_TAHR_RUN_DURATION = PURSE_PURSUIT_DURATION;

export type PursePursuitTahrEnemyKind = 'scout' | 'swooper' | 'bruiser' | 'boss' | 'bomb' | 'spike';
export type PurseMotion = 'weave' | 'swoop' | 'brake' | 'boss' | 'bomb' | 'spike';
export type PursePursuitTahrSpawnData = {
  engagement: RailLead;
  lane: number;
  row: number;
  phase: number;
  motion: PurseMotion;
};

export function createPursePursuitTahrRail() {
  // The camera is the passenger window: long freeway bends become authored
  // lane changes, with one sharp underpass sweep before the boss straight.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 5.2, 0),
      new Vector3(8, 5.1, -250),
      new Vector3(-24, 5.3, -540),
      new Vector3(42, 5.0, -860),
      new Vector3(76, 5.4, -1180),
      new Vector3(4, 5.0, -1510),
      new Vector3(-82, 5.2, -1830),
      new Vector3(-30, 5.1, -2160),
      new Vector3(12, 5.2, -2520),
    ],
    false,
    'catmullrom',
    0.22,
  );
}

export function pursePursuitRunProgress(time: number, duration = PURSE_PURSUIT_DURATION) {
  return MathUtils.clamp(time / duration, 0, 1);
}

export const pursePursuitPacer = createRailPacer({
  curve: createPursePursuitTahrRail(),
  duration: PURSE_PURSUIT_DURATION,
  runProgress: pursePursuitRunProgress,
  spawnAheadUnits: 24,
  defaultLeadSeconds: 4.7,
});

type Wave = {
  bar: number;
  beat?: number;
  kind: Exclude<PursePursuitTahrEnemyKind, 'boss' | 'bomb' | 'spike'>;
  motion: Exclude<PurseMotion, 'boss' | 'bomb' | 'spike'>;
  lanes: readonly number[];
  rows?: readonly number[];
  everySteps?: number;
  lead?: number;
  hp?: number;
};

const WAVES: readonly Wave[] = [
  { bar: 1, kind: 'scout', motion: 'weave', lanes: [-2, 0, 2], rows: [0, 1, 0], everySteps: 2 },
  { bar: 2, beat: 2, kind: 'scout', motion: 'weave', lanes: [2, 1, 0, -1, -2], rows: [1, -1, 0, 1, -1] },
  { bar: 4, kind: 'swooper', motion: 'swoop', lanes: [-2, 2, -1, 1], rows: [1, 0, -1, 1], everySteps: 2, lead: 5.1 },
  { bar: 5, beat: 2, kind: 'scout', motion: 'weave', lanes: [-2, -1, 1, 2, 0], rows: [-1, 1, -1, 1, 0] },
  { bar: 7, kind: 'bruiser', motion: 'brake', lanes: [-1, 1, 0], rows: [0, 1, -1], everySteps: 3, lead: 5.5, hp: 2 },
  { bar: 9, kind: 'swooper', motion: 'swoop', lanes: [2, -2, 1, -1, 0], rows: [1, 0, -1, 1, 0], lead: 4.5 },
  { bar: 11, kind: 'scout', motion: 'weave', lanes: [-2, 0, 2, 1, -1, 0], rows: [1, -1, 0, 1, -1, 0] },
  { bar: 12, beat: 2, kind: 'bruiser', motion: 'brake', lanes: [-2, 2], rows: [0, 1], everySteps: 4, lead: 5.8, hp: 3 },
  { bar: 14, kind: 'swooper', motion: 'swoop', lanes: [-2, 2, -1, 1, 0, -2], rows: [-1, 1, 0, -1, 1, 0], lead: 4.3 },
  { bar: 16, kind: 'scout', motion: 'weave', lanes: [2, 1, 0, -1, -2, 0], rows: [1, -1, 1, -1, 0, 1] },
  { bar: 18, kind: 'bruiser', motion: 'brake', lanes: [-2, 0, 2], rows: [1, -1, 0], everySteps: 3, lead: 5.2, hp: 2 },
  { bar: 19, beat: 2, kind: 'swooper', motion: 'swoop', lanes: [2, -2, 1, -1, 0, 2], rows: [-1, 1, 0, -1, 1, 0], lead: 4.2 },
  { bar: 21, kind: 'scout', motion: 'weave', lanes: [-2, -1, 0, 1, 2, 0], rows: [0, 1, -1, 1, 0, -1] },
] as const;

function buildTimeline() {
  const timeline: Array<LockOnSpawnEntry<PursePursuitTahrEnemyKind, PursePursuitTahrSpawnData>> = [];
  for (const wave of WAVES) {
    wave.lanes.forEach((lane, index) => {
      const time = PURSE_PURSUIT_TIME.bar(wave.bar, wave.beat ?? 0) + index * (wave.everySteps ?? 1) * PURSE_PURSUIT_TIME.stepSeconds;
      timeline.push({
        time,
        kind: wave.kind,
        ...(wave.hp === undefined ? {} : { hitPoints: wave.hp }),
        data: {
          engagement: pursePursuitPacer.resolve(time, wave.lead),
          lane,
          row: wave.rows?.[index % wave.rows.length] ?? 0,
          phase: wave.bar * 0.71 + index * 1.37,
          motion: wave.motion,
        },
      });
    });
  }

  const bossTime = PURSE_PURSUIT_TIME.bar(PURSE_PURSUIT_BARS.boss);
  timeline.push({
    time: bossTime,
    kind: 'boss',
    hitPoints: 18,
    hitStages: [6, 6, 6],
    data: {
      engagement: pursePursuitPacer.resolve(bossTime, 15.1),
      lane: 0,
      row: 0,
      phase: 0,
      motion: 'boss',
    },
  });
  return timeline.sort((a, b) => a.time - b.time);
}

export const PURSE_PURSUIT_TAHR_SPAWN_TIMELINE = buildTimeline();

const offset = new Vector3();
const cameraRight = new Vector3();
const BARRAGE = [1.4, 3.7, 6.1, 8.6, 11.2, 13.4] as const;

type MovingState = { spawned: Set<number>; impacted: boolean };

function hazardEntry(runTime: number, index: number): LockOnSpawnEntry<PursePursuitTahrEnemyKind, PursePursuitTahrSpawnData> {
  const bomb = index % 2 === 0;
  const lane = [-1.7, 1.7, 0, -0.9, 1.1, -1.8][index] ?? 0;
  return {
    time: runTime,
    kind: bomb ? 'bomb' : 'spike',
    hitPoints: bomb ? 1 : 2,
    countsTowardTotal: false,
    data: {
      engagement: pursePursuitPacer.resolve(runTime, bomb ? 3.6 : 4.1),
      lane,
      row: -1,
      phase: index * 1.7,
      motion: bomb ? 'bomb' : 'spike',
    },
  };
}

export function createPursePursuitGameplay(bus: EventBus): LockOnRunnerLevel<PursePursuitTahrEnemyKind, PursePursuitTahrSpawnData> {
  let bossDestroyed = false;
  bus.on('spawn', ({ kind }) => {
    if (kind === 'boss') bus.emit('bossphase', { phase: 'summoned' });
  });
  bus.on('stage', ({ stageIndex, hitStageCount }) => {
    if (hitStageCount === 3 && stageIndex === 2) bus.emit('bossphase', { phase: 'exposed' });
  });
  bus.on('bossphase', ({ phase }) => { if (phase === 'destroyed') bossDestroyed = true; });
  bus.on('runstart', () => { bossDestroyed = false; });

  return {
    duration: PURSE_PURSUIT_DURATION,
    bpm: PURSE_PURSUIT_BPM,
    createRail: createPursePursuitTahrRail,
    spawnTimeline: PURSE_PURSUIT_TAHR_SPAWN_TIMELINE,
    easeRunProgress: pursePursuitRunProgress,
    startWord: 'CHASE',
    replayWord: 'AGAIN',
    playerHealth: 6,
    lockRadiusNdc: 0.115,
    timing: {
      shotDelay: { maxGridSeconds: 0.72, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 2 },
    },
    scoreForHit(volleySize, enemy) {
      return enemy.kind === 'boss' ? 280 + volleySize * 18 : 80 + volleySize * 10;
    },
    scoreForKill(volleySize, enemy) {
      const base = enemy.kind === 'boss' ? 4200 : enemy.kind === 'bruiser' ? 340 : enemy.kind === 'swooper' ? 240 : enemy.kind === 'scout' ? 180 : 130;
      return Math.round(base * (1 + Math.max(0, volleySize - 1) * 0.12));
    },
    scoreForVolley(results) {
      return results.length === 6 && results.every((result) => result.killed) ? 1280 : 0;
    },
    rankForRun(score, kills, total) {
      const ratio = total <= 0 ? 0 : kills / total;
      if (ratio >= 0.94 && score >= 18_000) return 'PURSE ICON';
      if (ratio >= 0.8) return 'NIGHT RIDER';
      if (ratio >= 0.58) return 'CLOSE CHASE';
      return 'BACK SEAT';
    },
    detailsForRun() {
      return [bossDestroyed ? 'PURSE RECOVERED' : 'PURSE STILL AHEAD', '128 BPM freeway mix'];
    },
    updateCameraEffects({ camera, runTime }) {
      const phrase = Math.sin(runTime * 0.62) * 0.55 + Math.sin(runTime * 1.43) * 0.18;
      const laneSnap = Math.sin((runTime / PURSE_PURSUIT_TIME.bar(2)) * Math.PI) * 0.18;
      camera.rotateZ(MathUtils.degToRad(-3.8 * phrase - 1.5 * laneSnap));
      cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(cameraRight, phrase * 0.42);
    },
    updateEnemy({ enemy, runTime, age, curve, camera, spawnEnemy, damagePlayer, enemyState }) {
      const data = enemy.entry.data;
      const paced = pursePursuitPacer.sample(enemy.entry.time, runTime, data.engagement);
      // World-space freeway lanes are deliberately exaggerated for the lock-on
      // camera: the gang owns the full music-video frame, not just the road's
      // vanishing point.
      const ordinary = data.motion === 'weave' || data.motion === 'swoop' || data.motion === 'brake';
      const laneSlot = ordinary && data.lane === 0 ? (Math.sin(data.phase) >= 0 ? 0.82 : -0.82) : data.lane;
      const xLane = laneSlot * 6.4;

      if (data.motion === 'weave') {
        offset.set(xLane + Math.sin(age * 2.7 + data.phase) * 3.1, -0.4 + data.row * 4.8 + Math.sin(age * 5.2 + data.phase) * 0.75, 0);
      } else if (data.motion === 'swoop') {
        const side = data.lane >= 0 ? 1 : -1;
        const close = Math.max(0, 1 - age / 2.2);
        offset.set(xLane + side * close * 10.5 - side * Math.sin(age * 1.8) * 2.2, data.row * 4.5 + Math.sin(age * 3.4) * 1.65, Math.sin(age * 2.1) * 1.2);
      } else if (data.motion === 'brake') {
        const kick = Math.sin(Math.min(1, age / 1.1) * Math.PI) * 2.5;
        offset.set(xLane * 0.85 + Math.sin(age * 1.4 + data.phase) * 1.4, -0.4 + data.row * 4.1 + kick, Math.cos(age * 1.7) * 0.7);
      } else if (data.motion === 'boss') {
        offset.set(Math.sin(age * 0.7) * 4.4, -0.45 + Math.sin(age * 1.9) * 0.45, Math.sin(age * 0.38) * 1.2);
        const state = enemyState<MovingState>(() => ({ spawned: new Set(), impacted: false }));
        BARRAGE.forEach((launchAge, index) => {
          if (age >= launchAge && !state.spawned.has(index)) {
            state.spawned.add(index);
            spawnEnemy(hazardEntry(runTime, index));
          }
        });
      } else if (data.motion === 'bomb') {
        const t = MathUtils.clamp(age / 3.15, 0, 1);
        offset.set(xLane, -4.15 + (1 - t) * 8.8 + Math.sin(t * Math.PI) * 3.8, 0);
        const state = enemyState<MovingState>(() => ({ spawned: new Set(), impacted: false }));
        if (t >= 0.98 && !state.impacted) { state.impacted = true; damagePlayer(); }
      } else {
        offset.set(xLane, -4.15 + Math.min(1, age * 2) * 0.35, 0);
        const state = enemyState<MovingState>(() => ({ spawned: new Set(), impacted: false }));
        if (age >= 3.55 && !state.impacted) { state.impacted = true; damagePlayer(); }
      }

      if (ordinary) {
        // Hold roughly the same screen angle while the rider paces the car.
        // Without this distance compensation close targets collapse toward the
        // vanishing point early and fly out of frame just before being passed.
        const projectionScale = Math.max(7, paced.distanceAheadUnits) / 52;
        offset.x *= projectionScale;
        offset.y *= projectionScale;
        enemy.mesh.userData.perspectiveScale = MathUtils.clamp(paced.distanceAheadUnits / 20, 0.16, 1);
      } else {
        enemy.mesh.userData.perspectiveScale = 1;
      }

      enemy.mesh.position.copy(offsetFromRail(curve, paced.anchorU, offset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      if (data.motion === 'swoop') enemy.mesh.rotateZ(Math.sin(age * 2 + data.phase) * 0.42);
      else if (data.motion === 'bomb') enemy.mesh.rotateZ(age * 5.2);
      else if (data.motion === 'spike') enemy.mesh.rotateZ(Math.sin(age * 6) * 0.08);
      else enemy.mesh.rotateZ(Math.sin(age * 1.8 + data.phase) * 0.16);

      return runTime > paced.passTime + (data.motion === 'boss' ? 1.2 : 0.55);
    },
  };
}
