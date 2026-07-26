import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { steerHomingShot, updateHostileShotImpact } from '../../engine/hostile-shot';
import {
  TINKER_BALL_XA2F_BPM,
  TINKER_BALL_XA2F_RUN_DURATION,
} from './timing';

export { TINKER_BALL_XA2F_BPM, TINKER_BALL_XA2F_RUN_DURATION } from './timing';

export type TinkerBallEnemyKind = 'beetle' | 'bird' | 'walker' | 'spillcore' | 'glueblob';

export type TinkerBallSpawnData = {
  lead: number;
  offset: Vector3;
  pattern?: 'zigzag' | 'dive' | 'step' | 'boss';
  phase?: number;
};

export function createTinkerBallRail(): CatmullRomCurve3 {
  // A 3D rail path winding smoothly across the oversized worktable from z = 0 to z = -200
  return new CatmullRomCurve3(
    [
      new Vector3(0, 1.2, 0),
      new Vector3(-6, 2.5, -25),
      new Vector3(7, 1.8, -55),
      new Vector3(-9, 3.2, -85),
      new Vector3(5, 2.0, -115),
      new Vector3(-3, 3.5, -140), // Boss area at central glue spill
      new Vector3(6, 1.5, -170),
      new Vector3(0, 1.0, -200),
    ],
    false,
    'catmullrom',
    0.35,
  );
}

// Build Choreographed Spawn Timeline across 32 Bars (60s) with broad screen spread
function buildSpawnTimeline(): Array<LockOnSpawnEntry<TinkerBallEnemyKind, TinkerBallSpawnData>> {
  const timeline: Array<LockOnSpawnEntry<TinkerBallEnemyKind, TinkerBallSpawnData>> = [];

  // Act 1: Marble Scale (Bars 1 - 8, 0s - 15s)
  // Buttons & Pins Beetles & Snapping Birds across wide X offsets (-7.5 to +7.5)
  const act1Times = [1.5, 3.0, 4.5, 6.0, 7.5, 9.0, 10.5, 12.0, 13.5];
  act1Times.forEach((t, idx) => {
    const kind: TinkerBallEnemyKind = idx % 2 === 0 ? 'beetle' : 'bird';
    const side = (idx % 2 === 0 ? 1 : -1) * (5.5 + (idx % 3) * 1.8);
    timeline.push({
      time: t,
      kind,
      data: {
        lead: 4.2,
        offset: new Vector3(side, (idx % 2) * 2.5 + 1.2, 0),
        pattern: kind === 'beetle' ? 'zigzag' : 'dive',
        phase: idx * 0.8,
      },
    });
  });

  // Act 2: Tennis Ball Scale (Bars 9 - 16, 15s - 30s)
  // Spools & Erasers Walkers & Birds plus hostile glueblobs
  const act2Times = [15.5, 17.0, 18.5, 20.0, 21.5, 23.0, 24.5, 26.0, 27.5, 29.0];
  act2Times.forEach((t, idx) => {
    const kind: TinkerBallEnemyKind = idx % 3 === 0 ? 'walker' : idx % 3 === 1 ? 'beetle' : 'bird';
    const hitPoints = kind === 'walker' ? 2 : 1;
    const hitStages = kind === 'walker' ? [1, 1] : undefined;
    const side = (idx % 2 === 0 ? -1 : 1) * (6.0 + (idx % 3) * 2.0);

    const entry: LockOnSpawnEntry<TinkerBallEnemyKind, TinkerBallSpawnData> = {
      time: t,
      kind,
      hitPoints,
      data: {
        lead: 4.5,
        offset: new Vector3(side, 1.2, 0),
        pattern: kind === 'walker' ? 'step' : 'zigzag',
        phase: idx * 0.9,
      },
    };
    if (hitStages) entry.hitStages = hitStages;
    timeline.push(entry);

    // Spawn a hostile glue blob at bar 12 (22.5s) heading right at player
    if (idx === 4) {
      timeline.push({
        time: t + 0.5,
        kind: 'glueblob',
        countsTowardTotal: false,
        data: {
          lead: 3.2,
          offset: new Vector3(0, 1.5, 0),
        },
      });
    }
  });

  // Act 3 & Boss Finale: Melon Scale (Bars 17 - 28, 30s - 52.5s)
  // Central Glue Spill Boss with rotating ruler armor plates (3 Stages!)
  timeline.push({
    time: 32.0,
    kind: 'spillcore',
    hitPoints: 4,
    hitStages: [2, 1, 1], // Multi-hit stage HP so `stage` event fires!
    data: {
      lead: 7.0,
      offset: new Vector3(0, 1.5, 0),
      pattern: 'boss',
    },
  });

  // Escorting Walker & Bird waves during boss fight with wide lateral spread
  const bossSupportTimes = [34.0, 37.0, 40.0, 43.0, 46.0, 49.0];
  bossSupportTimes.forEach((t, idx) => {
    const side = (idx % 2 === 0 ? 1 : -1) * 7.5;
    timeline.push({
      time: t,
      kind: idx % 2 === 0 ? 'walker' : 'bird',
      hitPoints: 2,
      hitStages: [1, 1],
      data: {
        lead: 4.0,
        offset: new Vector3(side, 2.0, 0),
        pattern: 'dive',
        phase: idx * 1.2,
      },
    });
  });

  return timeline.sort((a, b) => a.time - b.time);
}

export const TINKER_BALL_XA2F_SPAWN_TIMELINE = buildSpawnTimeline();

type EnemyState = {
  vel?: Vector3;
  shotState?: { impactAt?: number; impactDirection?: Vector3; interceptUntil?: number };
  lastBlobTime?: number;
};

export const tinkerBallXa2fGameplay: LockOnRunnerLevel<TinkerBallEnemyKind, TinkerBallSpawnData> = {
  duration: TINKER_BALL_XA2F_RUN_DURATION,
  bpm: TINKER_BALL_XA2F_BPM,
  createRail: createTinkerBallRail,
  spawnTimeline: TINKER_BALL_XA2F_SPAWN_TIMELINE,
  easeRunProgress: smoothRunProgress,
  playerHealth: 5,
  lockRadiusNdc: 0.085,
  startWord: 'START!',
  replayWord: 'REPLAY',

  scoreForKill(volleySize, enemy) {
    const base = enemy.kind === 'spillcore' ? 500 : enemy.kind === 'walker' ? 200 : 100;
    return Math.round(base * (1 + Math.max(0, volleySize - 1) * 0.15));
  },

  scoreForHit(_volleySize, enemy) {
    return enemy.kind === 'spillcore' ? 50 : 25;
  },

  scoreForVolley(results) {
    const kills = results.filter((r) => r.killed).length;
    return kills * 50;
  },

  rankForRun(score, kills, totalEnemies) {
    const ratio = totalEnemies > 0 ? kills / totalEnemies : 0;
    if (score >= 4500 && ratio >= 0.85) return 'S';
    if (score >= 3200 && ratio >= 0.70) return 'A';
    if (score >= 2000 && ratio >= 0.50) return 'B';
    if (score >= 1000) return 'C';
    return 'D';
  },

  updateEnemy({ enemy, runTime, runProgress, age, curve, camera, railAnchor, enemyState, spawnEnemy, damagePlayer }) {
    const data = enemy.entry.data ?? { lead: 4.2, offset: new Vector3() };
    const anchorU = railAnchor(data.lead);

    // Hostile Projectile Glue Blob logic
    if (enemy.kind === 'glueblob') {
      const state = enemyState<EnemyState>(() => ({
        vel: new Vector3(0, 0, -6),
        shotState: {},
      }));

      steerHomingShot(enemy.mesh.position, state.vel!, camera.position, age, 0.016, {
        baseSpeed: 12,
        maxSpeed: 22,
        accel: 6,
        turnRate: 4,
      });

      const impact = updateHostileShotImpact({
        age,
        camera,
        position: enemy.mesh.position,
        velocity: state.vel!,
        state: state.shotState!,
      });

      if (impact.phase === 'braking' && impact.damaged) {
        damagePlayer(1);
        return true; // Despawn hit projectile
      }

      return age > 3.5;
    }

    // Standard Enemies Motion
    const drift = data.offset.clone();

    if (data.pattern === 'zigzag') {
      drift.x += Math.sin((data.phase ?? 0) + age * 3.5) * 3.2;
      drift.y += Math.cos((data.phase ?? 0) + age * 2.0) * 0.8;
    } else if (data.pattern === 'dive') {
      drift.y += Math.sin((data.phase ?? 0) + age * 4.0) * 2.5;
      drift.x += Math.cos((data.phase ?? 0) + age * 2.5) * 2.0;
    } else if (data.pattern === 'step') {
      drift.x += (Math.floor(age * 3) % 4 - 1.5) * 1.8;
    } else if (data.pattern === 'boss') {
      // Rotating boss floating in central spill
      drift.x += Math.sin(runTime * 1.5) * 2.5;
      drift.y += Math.sin(runTime * 2.5) * 1.2;
      enemy.mesh.rotation.y = runTime * 1.2;

      // Boss occasionally fires hostile glue blobs!
      const state = enemyState<EnemyState>(() => ({ lastBlobTime: 0 }));
      if (runTime - (state.lastBlobTime ?? 0) > 3.5 && age > 1.0 && age < 6.0) {
        state.lastBlobTime = runTime;
        spawnEnemy({
          time: runTime,
          kind: 'glueblob',
          countsTowardTotal: false,
          data: { lead: 3.0, offset: enemy.mesh.position.clone() },
        });
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
    enemy.mesh.rotation.z += 0.02;

    // Despawn check when passed by player camera
    return runProgress > anchorU + 0.025;
  },
};
