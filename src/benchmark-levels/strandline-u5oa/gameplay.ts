import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type {
  LockOnCameraEffectsUpdate,
  LockOnEnemy,
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  bar,
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  STRANDLINE_TIME,
} from './timing';

export { STRANDLINE_BPM, STRANDLINE_DURATION, bar } from './timing';

export const STRANDLINE_PLAYER_HEALTH = 3;

export type StrandlineEnemyKind = 'clasper' | 'skimmer' | 'spore_sac' | 'spore_bolt' | 'parent';

export type StrandlineSpawnData =
  | {
      role: 'clasper';
      lead: number;
      offsetX: number;
      offsetY: number;
      spiralSpeed: number;
      spiralRadius: number;
    }
  | {
      role: 'skimmer';
      lead: number;
      startX: number;
      endX: number;
      baseY: number;
      waveFreq: number;
      waveAmp: number;
    }
  | {
      role: 'spore_sac';
      lead: number;
      offsetX: number;
      offsetY: number;
      boltFired?: boolean;
    }
  | {
      role: 'spore_bolt';
      position: Vector3;
      velocity: Vector3;
      impact: HostileShotImpactState;
    }
  | {
      role: 'parent';
      lead: number;
      broodsLeft: number;
    };

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

const KILL_SCORE: Record<StrandlineEnemyKind, number> = {
  clasper: 120,
  skimmer: 160,
  spore_sac: 220,
  spore_bolt: 80,
  parent: 2500,
};

// ---- 3D Rail Curve ---------------------------------------------------------
export function createStrandlineRail(): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 18, 20),      // start
      new Vector3(-6, 14, -40),    // bar 3
      new Vector3(8, 16, -110),    // bar 6
      new Vector3(-12, 12, -180),  // bar 9
      new Vector3(14, 20, -260),   // bar 12
      new Vector3(32, 26, -330),   // bar 14: starting wide curve
      new Vector3(56, 36, -395),   // bar 17: peak of wide swell, viewing bell
      new Vector3(28, 30, -455),   // bar 20: diving back in toward crown
      new Vector3(4, 24, -495),    // bar 22: approaching crown
      new Vector3(0, 22, -520),    // bar 26: crown confront
      new Vector3(0, 22, -525),    // bar 28: drift
      new Vector3(0, 22, -528),    // bar 30: finish
    ],
    false,
    'catmullrom',
    0.45,
  );
}

// ---- Speed Profile & Progress Easing ---------------------------------------
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.85],
  [bar(6), 1.05],
  [bar(14), 1.35], // surge during the wide swell
  [bar(20), 0.95], // deceleration at the crown
  [bar(26), 0.7],  // easing down after boss death
  [bar(30), 0.35], // serene slow drift
];

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);

export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION): number {
  return speedProfile.runProgress(time, duration);
}

// ---- Spawn Timeline Choreography -------------------------------------------
function makeClasper(time: number, offsetX: number, offsetY: number, lead = 3.2): StrandlineSpawnEntry {
  return {
    time,
    kind: 'clasper',
    hitPoints: 1,
    data: {
      role: 'clasper',
      lead,
      offsetX,
      offsetY,
      spiralSpeed: 3.5 + Math.random() * 1.5,
      spiralRadius: 1.8 + Math.random() * 1.2,
    },
  };
}

function makeSkimmer(time: number, startX: number, endX: number, baseY: number, lead = 3.5): StrandlineSpawnEntry {
  return {
    time,
    kind: 'skimmer',
    hitPoints: 1,
    data: {
      role: 'skimmer',
      lead,
      startX,
      endX,
      baseY,
      waveFreq: 5.5 + Math.random() * 2.0,
      waveAmp: 2.2 + Math.random() * 0.8,
    },
  };
}

function makeSporeSac(time: number, offsetX: number, offsetY: number, lead = 3.8): StrandlineSpawnEntry {
  return {
    time,
    kind: 'spore_sac',
    hitPoints: 1,
    data: {
      role: 'spore_sac',
      lead,
      offsetX,
      offsetY,
    },
  };
}

export const STRANDLINE_SPAWN_TIMELINE: StrandlineSpawnEntry[] = [
  // ---- SECTION 0: DESCENT (Bars 0 to 6, 0.0s to 12.0s) ----
  makeClasper(bar(1.0), -8, 4),
  makeClasper(bar(1.2), 8, -3),

  makeClasper(bar(2.5), 2, 7),
  makeClasper(bar(2.7), -7, -5),
  makeClasper(bar(2.9), 9, 3),

  makeClasper(bar(4.2), -9, 5),
  makeClasper(bar(4.4), -6, -4),
  makeClasper(bar(4.6), 6, 6),
  makeClasper(bar(4.8), 10, -4),

  // ---- SECTION 1: STRAND FOREST (Bars 6 to 14, 12.0s to 28.0s) ----
  makeSkimmer(bar(6.5), -12, 10, 3),
  makeSkimmer(bar(6.8), 12, -10, -3),
  makeSkimmer(bar(7.1), -11, 9, 6),

  makeClasper(bar(8.2), -8, 6),
  makeClasper(bar(8.4), 8, 6),
  makeClasper(bar(8.6), -9, -4),
  makeClasper(bar(8.8), 9, -4),

  makeSkimmer(bar(9.8), 13, -11, 4),
  makeSkimmer(bar(10.1), -13, 11, -2),
  makeSkimmer(bar(10.4), 11, -9, -5),

  makeClasper(bar(11.4), -7, 5),
  makeClasper(bar(11.6), 7, -5),
  makeSkimmer(bar(11.8), -12, 10, 2),
  makeSkimmer(bar(12.1), 12, -10, 5),

  makeSkimmer(bar(12.8), -14, 12, -3),
  makeSkimmer(bar(13.0), 14, -12, 3),
  makeSkimmer(bar(13.2), -13, 11, 6),
  makeSkimmer(bar(13.4), 13, -11, -5),

  // ---- SECTION 2: THE WIDE SWELL (Bars 14 to 20, 28.0s to 40.0s) ----
  makeSporeSac(bar(14.5), -8, 6),
  makeSporeSac(bar(14.8), 9, -4),
  makeSkimmer(bar(15.1), -12, 11, 2),
  makeSkimmer(bar(15.4), 12, -10, -3),

  makeSporeSac(bar(16.5), 8, 6),
  makeSporeSac(bar(16.8), -8, -5),
  makeClasper(bar(17.1), -9, 4),
  makeClasper(bar(17.3), 9, 3),
  makeClasper(bar(17.5), 0, -7),

  makeSkimmer(bar(18.4), -13, 12, 4),
  makeSkimmer(bar(18.6), 13, -11, -4),
  makeSporeSac(bar(18.9), 0, 7),
  makeSkimmer(bar(19.2), -11, 10, 0),

  // ---- SECTION 3: THE CROWN & PARENT ORGANISM (Bars 20 to 26, 40.0s to 52.0s) ----
  {
    time: bar(20.0),
    kind: 'parent',
    hitStages: [4, 4], // 2 stages of 4 HP = 8 hits total
    lockable: false,   // initially shielded by web lattice
    data: {
      role: 'parent',
      lead: 5.5,
      broodsLeft: 3,
    },
  },

  // Brood 1 defending parent
  makeClasper(bar(20.8), -7, 4),
  makeClasper(bar(21.0), 7, 4),
  makeClasper(bar(21.2), 0, -6),

  // Brood 2 defending parent
  makeSkimmer(bar(22.2), -12, 9, 5),
  makeSkimmer(bar(22.4), 12, -9, 5),
  makeSkimmer(bar(22.6), -10, 10, -4),
  makeSkimmer(bar(22.8), 10, -10, -4),

  // Brood 3 defending parent
  makeSporeSac(bar(23.6), -6, 6),
  makeSporeSac(bar(23.8), 6, 6),
  makeClasper(bar(24.0), -8, -4),
  makeClasper(bar(24.2), 8, -4),
];

// ---- Enemy Update Logic ----------------------------------------------------
type EnemyRuntimeState = {
  broodKills: number;
  unlockedAt: number;
};

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  let parentEnemyId = -1;
  let broodKillsCount = 0;

  bus.on('runstart', () => {
    parentEnemyId = -1;
    broodKillsCount = 0;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') {
      parentEnemyId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  bus.on('kill', ({ enemyId }) => {
    if (enemyId === parentEnemyId) {
      bus.emit('bossphase', { phase: 'destroyed' });
    } else {
      broodKillsCount++;
      if (broodKillsCount >= 10) {
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
  });

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    createRail: createStrandlineRail,
    spawnTimeline: STRANDLINE_SPAWN_TIMELINE,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    easeRunProgress: strandlineRunProgress,

    scoreForKill(volleySize, enemy) {
      const mult = 1 + Math.max(0, volleySize - 1) * 0.25;
      const base = KILL_SCORE[enemy.kind] ?? 100;
      return Math.round(base * mult);
    },

    scoreForHit() {
      return 60;
    },

    scoreForVolley(results) {
      const count = results.filter((r) => r.killed).length;
      if (count >= 6) return 1200;
      if (count >= 5) return 600;
      if (count >= 4) return 300;
      if (count >= 3) return 150;
      return 0;
    },

    updateCameraEffects({ camera, runTime }: LockOnCameraEffectsUpdate) {
      if (runTime > 52.0) {
        const pullProgress = Math.min(1.0, (runTime - 52.0) / 7.5);
        const backDist = pullProgress * 48.0;
        const camDir = new Vector3();
        camera.getWorldDirection(camDir);
        camera.position.addScaledVector(camDir, -backDist);
        camera.position.y += pullProgress * 12.0;
      }
    },

    updateEnemy({
      enemy,
      runTime,
      age,
      curve,
      camera,
      railAnchor,
      enemyState,
      spawnEnemy,
      damagePlayer,
    }: StrandlineUpdate): boolean {
      const data = enemy.entry.data;

      // 1. CLASPER
      if (data.role === 'clasper') {
        const u = railAnchor(data.lead);
        if (age > data.lead + 0.35) return true;

        let x = data.offsetX;
        let y = data.offsetY;

        if (age >= 0.7) {
          const unspoolAge = age - 0.7;
          const r = Math.min(data.spiralRadius, unspoolAge * 2.0);
          x += Math.sin(unspoolAge * data.spiralSpeed) * r;
          y += Math.cos(unspoolAge * data.spiralSpeed) * r;
        }

        const pos = offsetFromRail(curve, u, new Vector3(x, y, 0));
        enemy.mesh.position.copy(pos);
        enemy.mesh.rotation.z += 0.04;
        return false;
      }

      // 2. SKIMMER
      if (data.role === 'skimmer') {
        const u = railAnchor(data.lead);
        if (age > data.lead + 0.35) return true;

        const progress = MathUtils.clamp(age / data.lead, 0, 1);
        const x = MathUtils.lerp(data.startX, data.endX, progress);
        const y = data.baseY + Math.sin(age * data.waveFreq) * data.waveAmp;

        const pos = offsetFromRail(curve, u, new Vector3(x, y, 0));
        enemy.mesh.position.copy(pos);

        const dir = Math.sign(data.endX - data.startX);
        enemy.mesh.rotation.y = dir > 0 ? 0.35 : -0.35;
        enemy.mesh.rotation.z = Math.cos(age * data.waveFreq) * 0.3;
        return false;
      }

      // 3. SPORE SAC
      if (data.role === 'spore_sac') {
        const u = railAnchor(data.lead);
        if (age > data.lead + 0.35) return true;

        const x = data.offsetX + Math.sin(age * 1.8) * 1.4;
        const y = data.offsetY + Math.cos(age * 2.2) * 1.1;
        const pos = offsetFromRail(curve, u, new Vector3(x, y, 0));
        enemy.mesh.position.copy(pos);

        if (!data.boltFired && age >= 1.2 && runTime < 50.0) {
          data.boltFired = true;
          const boltVel = camera.position.clone().sub(pos).normalize().multiplyScalar(12);
          spawnEnemy({
            time: runTime,
            kind: 'spore_bolt',
            countsTowardTotal: false,
            hitPoints: 1,
            data: {
              role: 'spore_bolt',
              position: pos.clone(),
              velocity: boltVel,
              impact: {},
            },
          });
        }
        return false;
      }

      // 4. SPORE BOLT
      if (data.role === 'spore_bolt') {
        const aim = hostileShotAimPoint(camera, data.position);
        steerHomingShot(data.position, data.velocity, aim, age, 1 / 60, {
          baseSpeed: 14,
          maxSpeed: 22,
          accel: 3.5,
          turnRate: 3.0,
        });

        enemy.mesh.position.copy(data.position);
        enemy.mesh.lookAt(aim);

        const impact = updateHostileShotImpact({
          age,
          camera,
          position: data.position,
          velocity: data.velocity,
          state: data.impact,
          config: { hitDistance: 2.2, damageDistance: 0.8 },
        });

        if (impact.phase === 'braking' && impact.damaged) {
          damagePlayer(1);
          return true;
        }

        if (shotBehindCamera(camera, data.position, 2)) return true;
        return false;
      }

      // 5. PARENT ORGANISM
      if (data.role === 'parent') {
        parentEnemyId = enemy.id;
        const state = enemyState<EnemyRuntimeState>(() => ({ broodKills: 0, unlockedAt: -1 }));

        const crownPos = new Vector3(0, 22, -525);
        enemy.mesh.position.copy(crownPos);
        enemy.mesh.rotation.z = Math.sin(age * 1.5) * 0.08;

        const shouldExpose = broodKillsCount >= 10 || runTime >= bar(24.5);
        if (shouldExpose && !enemy.entry.lockable) {
          enemy.entry.lockable = true;
          state.unlockedAt = runTime;
          bus.emit('bossphase', { phase: 'exposed' });
        }

        return false;
      }

      return false;
    },

    rankForRun(score: number, kills: number, totalEnemies: number): string {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 13000 && clearRate >= 0.92) return 'S+';
      if (score >= 9500 && clearRate >= 0.85) return 'S';
      if (score >= 6800 && clearRate >= 0.70) return 'A';
      if (score >= 4200 && clearRate >= 0.50) return 'B';
      if (score >= 2000) return 'C';
      return 'D';
    },

    detailsForRun(): string[] {
      return [
        'Organism: Titan Medusa',
        'Crown status: Purified',
        'Strands restored: 52/52',
      ];
    },
  };
}
