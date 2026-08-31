import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createMusicTime } from '../../engine/music-time';

export const TINKER_BALL_8BF3_BPM = 128;
export const TINKER_BALL_8BF3_TIME = createMusicTime(TINKER_BALL_8BF3_BPM, { stepsPerBar: 16 });
export const TINKER_BALL_8BF3_RUN_DURATION = TINKER_BALL_8BF3_TIME.bar(32);
export const TINKER_BALL_8BF3_SECTIONS = [
  { name: 'marble sweep', fromBar: 0 },
  { name: 'drawer shuffle', fromBar: 8 },
  { name: 'lamp sprint', fromBar: 16 },
  { name: 'glue spill', fromBar: 24 },
] as const;

export type TinkerBall8bf3EnemyKind = 'beetle' | 'stilt' | 'bird' | 'spool' | 'core';
export type TinkerBall8bf3EnemyRole = TinkerBall8bf3EnemyKind;
export type TinkerBall8bf3SpawnData = {
  role: TinkerBall8bf3EnemyRole;
  lead: number;
  offsetX: number;
  offsetY: number;
  phase: number;
  scale: number;
  coreIndex?: number;
};
export type TinkerBall8bf3SpawnEntry = LockOnSpawnEntry<TinkerBall8bf3EnemyKind, TinkerBall8bf3SpawnData>;
export type TinkerBall8bf3Update = LockOnEnemyUpdate<TinkerBall8bf3EnemyKind, TinkerBall8bf3SpawnData>;

// The camera stays on the broad surface of one table. The route has enough
// lateral and vertical motion to make the tabletop feel oversized without
// ever losing the warm, close-up scale of a desk.
export function createTinkerBall8bf3Rail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(1.5, 0.2, -38),
      new Vector3(-7, 0.6, -78),
      new Vector3(8, -0.5, -118),
      new Vector3(4, 0.5, -158),
      new Vector3(-11, 1.0, -202),
      new Vector3(10, -0.7, -248),
      new Vector3(-7, 0.4, -294),
      new Vector3(9, 0.1, -340),
      new Vector3(-9, -0.7, -388),
      new Vector3(7, 0.7, -438),
      new Vector3(-4, 0, -488),
      new Vector3(5, -0.4, -535),
      new Vector3(0, 0, -575),
    ],
    false,
    'catmullrom',
    0.32,
  );
}

type TinkerWave = {
  bar: number;
  beat?: number;
  kind: Exclude<TinkerBall8bf3EnemyKind, 'core'>;
  offsets: readonly (readonly [number, number])[];
  lead: number;
  stagger?: number;
  scale?: number;
};

const WAVES: readonly TinkerWave[] = [
  // Marble scale: buttons and pins skitter out from under the lamp.
  { bar: 1, kind: 'beetle', offsets: [[-7, 2.2], [-2.4, -1.7], [2.5, 3.4], [7, -0.9]], lead: 4.4, scale: 0.78 },
  { bar: 3, beat: 1, kind: 'bird', offsets: [[6, 3.4], [1.8, -2.5], [-3.2, 2.8], [-7, -0.8]], lead: 4.2, stagger: 0.16, scale: 0.82 },
  { bar: 5, kind: 'beetle', offsets: [[-7, -2.8], [-4.2, 3.8], [1.2, -0.5], [4.2, 4.5], [7, -1.6]], lead: 4.1, stagger: 0.12, scale: 0.82 },
  { bar: 7, beat: 2, kind: 'spool', offsets: [[-5, 2.6], [5, -2.2], [-1.6, 4.1]], lead: 4.3, stagger: 0.18, scale: 0.88 },

  // Drawer scale: the bodies get taller and the route starts to zig-zag.
  { bar: 9, kind: 'stilt', offsets: [[-7, 3.8], [-2, -1.2], [3.2, 4.2], [7, -2.8]], lead: 4.1, stagger: 0.15, scale: 0.92 },
  { bar: 11, kind: 'bird', offsets: [[-6.8, -2.7], [-3.1, 3.7], [0.7, -0.8], [4.4, 4.5], [7.4, 0.2]], lead: 4.0, stagger: 0.13, scale: 0.94 },
  { bar: 13, kind: 'spool', offsets: [[-6.2, 3.5], [-2, -2.9], [3, 4.4], [6.8, -0.7]], lead: 4.0, stagger: 0.15, scale: 1.0 },
  { bar: 15, beat: 2, kind: 'beetle', offsets: [[-7.4, -2.9], [-4.5, 2.4], [-1.4, 4.8], [2.1, -0.8], [5.1, 4.1], [7.5, -2.1]], lead: 3.9, stagger: 0.11, scale: 0.94 },

  // Tennis-ball scale: larger supplies make a six-lock sweep feel like a
  // clean pass across the whole work surface.
  { bar: 17, kind: 'stilt', offsets: [[-7.2, 4.4], [-3.5, -2.6], [0.5, 3.3], [4.2, -3.8], [7.5, 1.5]], lead: 3.8, stagger: 0.12, scale: 1.05 },
  { bar: 19, kind: 'bird', offsets: [[-7.4, -1.9], [-4.1, 4.5], [-0.5, -3.6], [3.4, 3.8], [7.6, -0.4]], lead: 3.75, stagger: 0.12, scale: 1.02 },
  { bar: 21, kind: 'spool', offsets: [[-7.6, 3.7], [-4, -2.9], [1.4, 4.7], [4.2, -1.1], [7.4, 2.8]], lead: 3.8, stagger: 0.12, scale: 1.06 },
  { bar: 23, beat: 1, kind: 'stilt', offsets: [[-7.7, -3.5], [-3.9, 4.8], [-1.3, -1], [4.3, 4.1], [7.6, -2.2]], lead: 3.7, stagger: 0.12, scale: 1.08 },
] as const;

function makeWave(wave: TinkerWave): TinkerBall8bf3SpawnEntry[] {
  return wave.offsets.map(([offsetX, offsetY], index) => {
    const time = TINKER_BALL_8BF3_TIME.bar(wave.bar, wave.beat ?? 0) + index * (wave.stagger ?? 0.14);
    return {
      time,
      kind: wave.kind,
      data: {
        role: wave.kind,
        lead: wave.lead,
        offsetX,
        offsetY,
        phase: wave.bar * 0.71 + index * 1.618,
        scale: wave.scale ?? 1,
      },
    };
  });
}

function makeCore(coreIndex: number, bar: number, beat: number, offsetX: number, offsetY: number, lead: number): TinkerBall8bf3SpawnEntry {
  const time = TINKER_BALL_8BF3_TIME.bar(bar, beat);
  return {
    time,
    kind: 'core',
    hitStages: [2, 2],
    lockable: coreIndex === 0,
    data: {
      role: 'core',
      lead,
      offsetX,
      offsetY,
      phase: 0.8 + coreIndex * 1.9,
      scale: 1.28 + coreIndex * 0.12,
      coreIndex,
    },
  };
}

export const TINKER_BALL_8BF3_SPAWN_TIMELINE: TinkerBall8bf3SpawnEntry[] = [
  ...WAVES.flatMap(makeWave),
  makeCore(0, 25, 0, 0, 3.6, 4.35),
  makeCore(1, 27, 1, -5.3, -3.3, 4.15),
  makeCore(2, 29, 2, 5.5, 2.6, 3.85),
].sort((a, b) => a.time - b.time);

const tempOffset = new Vector3();
const SCORE_BY_KIND: Record<TinkerBall8bf3EnemyKind, number> = {
  beetle: 105,
  bird: 140,
  stilt: 135,
  spool: 175,
  core: 520,
};

export function createTinkerBall8bf3Gameplay(bus?: EventBus): LockOnRunnerLevel<TinkerBall8bf3EnemyKind, TinkerBall8bf3SpawnData> {
  let bossCoresDestroyed = 0;
  let lastRunTime = -1;
  bus?.on('runstart', () => {
    bossCoresDestroyed = 0;
    lastRunTime = -1;
  });

  const gameplay: LockOnRunnerLevel<TinkerBall8bf3EnemyKind, TinkerBall8bf3SpawnData> = {
    duration: TINKER_BALL_8BF3_RUN_DURATION,
    bpm: TINKER_BALL_8BF3_BPM,
    // The route is quick enough to reward a slightly tighter, eighth-note-ish
    // impact profile while still leaving a six-lock volley musical room.
    timing: {
      shotDelay: { maxGridSeconds: 0.72, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    createRail: createTinkerBall8bf3Rail,
    spawnTimeline: TINKER_BALL_8BF3_SPAWN_TIMELINE,
    lockRadiusNdc: 0.09,
    playerHealth: 3,
    startWord: 'START!',
    replayWord: 'REPLAY',
    scoreForHit(_volleySize, enemy) {
      return enemy.kind === 'core' ? 82 : 12;
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'core') bossCoresDestroyed = Math.min(3, bossCoresDestroyed + 1);
      const chain = 1 + Math.max(0, volleySize - 1) * 0.14;
      return Math.round(SCORE_BY_KIND[enemy.kind] * chain);
    },
    scoreForVolley(results) {
      if (!results.every((result) => result.killed)) return 0;
      if (results.length === 6) return 480;
      if (results.length >= 4) return results.length * 70;
      return results.length >= 2 ? results.length * 22 : 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (bossCoresDestroyed === 3 && score >= 9000 && clearRate >= 0.9) return 'S';
      if (score >= 6500 && clearRate >= 0.68) return 'A';
      if (score >= 3600 && clearRate >= 0.46) return 'B';
      if (score >= 1500 && clearRate >= 0.24) return 'C';
      return 'D';
    },
    detailsForRun() {
      return [
        `Glue cores cracked ${bossCoresDestroyed}/3`,
        bossCoresDestroyed === 3 ? 'Clean patch reached' : 'The spill is still holding supplies',
      ];
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      const base = curve.getPointAt(0);
      const look = curve.getPointAt(0.035);
      camera.position.copy(base).add(new Vector3(Math.sin(modeTime * 0.4) * 0.8, 1.1 + Math.cos(modeTime * 0.6) * 0.25, 0));
      camera.lookAt(look.clone().add(new Vector3(0, -0.8, 0)));
    },
    updateCameraEffects({ camera, curve, runProgress }) {
      const tangent = curve.getTangentAt(MathUtils.clamp(runProgress, 0, 1));
      const bank = MathUtils.clamp(-tangent.x * 0.035, -0.08, 0.08);
      camera.rotateZ(bank);
    },
    updateEnemy(context) {
      if (context.runTime + 0.001 < lastRunTime) bossCoresDestroyed = 0;
      lastRunTime = context.runTime;

      const data = context.enemy.entry.data;
      if (data.role === 'core') {
        // Only the current core can be locked. The following core is already
        // physically present in the spill, but its black center stays sealed
        // until the previous layer is dismantled.
        context.enemy.entry.lockable = data.coreIndex === bossCoresDestroyed;
      }

      const anchorU = context.railAnchor(data.lead);
      const age = context.age;
      let x = data.offsetX;
      let y = data.offsetY;
      let z = 0;

      switch (data.role) {
        case 'beetle':
          x += Math.sin(age * 2.25 + data.phase) * 0.7;
          y += Math.abs(Math.sin(age * 7.5 + data.phase)) * 0.32;
          z = Math.sin(age * 3.4 + data.phase) * 0.38;
          break;
        case 'stilt':
          x += Math.sin(age * 1.7 + data.phase) * 0.72;
          y += Math.sin(age * 2.55 + data.phase) * 0.75;
          z = Math.sin(age * 1.2 + data.phase) * 0.45;
          break;
        case 'bird':
          x += Math.sin(age * 3.2 + data.phase) * 1.5;
          y += Math.sin(age * 5.2 + data.phase) * 0.62;
          z = Math.cos(age * 3.7 + data.phase) * 0.75;
          break;
        case 'spool':
          x += Math.sin(age * 1.25 + data.phase) * 1.7;
          y += Math.sin(age * 2.3 + data.phase) * 0.48;
          z = Math.sin(age * 1.8 + data.phase) * 1.15;
          break;
        case 'core':
          x += Math.sin(age * 1.15 + data.phase) * 0.42;
          y += Math.cos(age * 1.4 + data.phase) * 0.5;
          z = Math.sin(age * 1.8 + data.phase) * 0.28;
          break;
      }

      tempOffset.set(x, y, z);
      context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchorU, tempOffset));
      context.enemy.mesh.quaternion.copy(context.camera.quaternion);
      context.enemy.mesh.rotateZ(data.phase + age * (data.role === 'spool' ? 2.7 : data.role === 'core' ? 0.55 : 1.1));
      context.enemy.mesh.rotateX(Math.sin(age * 1.6 + data.phase) * (data.role === 'bird' ? 0.26 : 0.12));

      return context.runProgress > anchorU + 0.028;
    },
  };

  return gameplay;
}

export const TINKER_BALL_8BF3_SPAWN_TIMELINE_READONLY = TINKER_BALL_8BF3_SPAWN_TIMELINE;
export const tinkerBall8bf3Gameplay = createTinkerBall8bf3Gameplay();
