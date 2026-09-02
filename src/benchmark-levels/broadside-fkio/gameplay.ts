import {
  CatmullRomCurve3,
  MathUtils,
  Vector3,
  type Object3D,
} from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type {
  LockOnEnemy,
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile, type SpeedKey } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  bar,
  BROADSIDE_BARS,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
} from './timing';

export type BroadsideEnemyKind =
  | 'skiff'
  | 'bomber'
  | 'turret'
  | 'shield-gen'
  | 'core-power'
  | 'bolt';

export type BroadsideSpawnData =
  | {
      role: 'skiff';
      lead: number;
      fromX: number;
      toX: number;
      y: number;
      weaveAmp: number;
      weaveFreq: number;
    }
  | {
      role: 'bomber';
      lead: number;
      offset: Vector3;
      strafeX: number;
    }
  | {
      role: 'turret';
      lead: number;
      offset: Vector3;
    }
  | {
      role: 'shield-gen';
      lead: number;
      offset: Vector3;
      index: number;
    }
  | {
      role: 'core-power';
      lead: number;
      offset: Vector3;
      index: number;
    }
  | {
      role: 'bolt';
      position: Vector3;
      velocity: Vector3;
      impact: HostileShotImpactState;
    };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// ---- 1. Rail Curve ---------------------------------------------------------

export function createBroadsideFkioRail(): CatmullRomCurve3 {
  const points = [
    // Launch deck catapult on friendly flagship Aegis Prime
    new Vector3(0, 0, 60),
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -80),
    new Vector3(0, -2, -170),

    // Clearing bow into the fleet engagement
    new Vector3(0, -8, -280),
    new Vector3(18, -4, -400),

    // High-speed run down friendly cruiser Valiant's flank (Valiant on right at x=55, z=-480)
    new Vector3(26, 8, -520),
    new Vector3(24, 14, -660),
    new Vector3(14, 16, -800),

    // Hard banks and corkscrews through the fleet crossfire
    new Vector3(-20, 4, -940),
    new Vector3(-28, -10, -1080),
    new Vector3(-10, -14, -1200),

    // Underbelly run beneath enemy warship Oblivion (overhead at y=42, z=-1280)
    new Vector3(6, 18, -1300),
    new Vector3(12, 22, -1420),
    new Vector3(-8, 16, -1560),

    // Accelerating toward enemy flagship The Leviathan (at z=-2350)
    new Vector3(0, 8, -1740),
    new Vector3(0, 4, -1940),

    // Boss Phase 1: High-speed strafe along flagship upper spine (shield generators)
    new Vector3(0, 8, -2120),
    new Vector3(0, 10, -2260),
    new Vector3(0, 12, -2430),

    // Turnaround: High-G evasive loop around flagship engines
    new Vector3(45, 16, -2560),
    new Vector3(55, -6, -2480),
    new Vector3(20, -18, -2380),
    new Vector3(-24, -14, -2260),
    new Vector3(0, -12, -2180),

    // Boss Phase 2: Dive down into the central trenchwork (core power reactors)
    new Vector3(0, -16, -2280),
    new Vector3(0, -16, -2420),
    new Vector3(0, -16, -2560),

    // Finale: Climax pullout climb away from breaking flagship
    new Vector3(0, 30, -2700),
    new Vector3(0, 85, -2880),
    new Vector3(0, 140, -3050),
  ];

  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- 2. Speed Profile ------------------------------------------------------

const SPEED_KEYS: readonly SpeedKey[] = [
  [bar(0), 0.65],
  [bar(2.5), 0.8],
  [bar(3.5), 1.65], // Catapult launch kick!
  [bar(4.5), 1.35], // Cruiser flank run
  [bar(9.5), 1.2],
  [bar(10.5), 0.95], // Eye of battle / dreadnought belly run
  [bar(14.5), 1.05],
  [bar(16.0), 1.5], // Flagship approach
  [bar(21.5), 1.3],
  [bar(22.5), 1.15], // Evasive turnaround
  [bar(25.0), 1.75], // Trench dive rush!
  [bar(27.5), 1.5],
  [bar(28.5), 0.75], // Pullout wide view
  [bar(30.0), 0.6],
];

export const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_DURATION);

// ---- 3. Spawn Timeline Choreography ---------------------------------------

export function createBroadsideTimeline(): BroadsideSpawnEntry[] {
  const timeline: BroadsideSpawnEntry[] = [
    // ---- Act 1: Launch & Flight Deck Bow (Bars 1.5 - 3.5) -----------------
    // Recon swarm diving across the bow - wide perimeter sweeps
    {
      time: bar(1.5),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.4, fromX: -22, toX: -13, y: 9, weaveAmp: 2.4, weaveFreq: 2.8 },
    },
    {
      time: bar(1.8),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.4, fromX: 22, toX: 13, y: 9.5, weaveAmp: 2.2, weaveFreq: 2.5 },
    },
    {
      time: bar(2.6),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: -21, toX: -12, y: -7.5, weaveAmp: 2.5, weaveFreq: 3.0 },
    },
    {
      time: bar(2.9),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: 21, toX: 12, y: -8, weaveAmp: 2.4, weaveFreq: 2.8 },
    },

    // ---- Act 2: Fleet Crossfire & Friendly Cruiser Flank (Bars 4.0 - 10.0) -
    // Wave 1: Swarm interceptors weaving through broadside beams
    {
      time: bar(4.2),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.5, fromX: -24, toX: -14, y: 9.5, weaveAmp: 2.8, weaveFreq: 3.2 },
    },
    {
      time: bar(4.5),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.5, fromX: 24, toX: 14, y: 10, weaveAmp: 2.6, weaveFreq: 3.0 },
    },
    {
      time: bar(4.8),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.5, fromX: -22, toX: -13, y: -7.5, weaveAmp: 2.4, weaveFreq: 2.8 },
    },

    // Heavy Bomber pair with flak hazard
    {
      time: bar(5.6),
      kind: 'bomber',
      hitPoints: 2,
      data: { role: 'bomber', lead: 3.8, offset: new Vector3(-19, 9, 0), strafeX: 4 },
    },
    {
      time: bar(5.8),
      kind: 'bomber',
      hitPoints: 2,
      data: { role: 'bomber', lead: 3.8, offset: new Vector3(19, -8, 0), strafeX: -4 },
    },

    // Wave 2: Skiff quad in wide diamond formation
    {
      time: bar(7.0),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.4, fromX: -23, toX: -14, y: 10.5, weaveAmp: 2.5, weaveFreq: 3.0 },
    },
    {
      time: bar(7.2),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.4, fromX: 23, toX: 14, y: 10, weaveAmp: 2.5, weaveFreq: 3.0 },
    },
    {
      time: bar(7.5),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.4, fromX: -21, toX: -13, y: -8.5, weaveAmp: 2.2, weaveFreq: 2.6 },
    },
    {
      time: bar(7.7),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.4, fromX: 21, toX: 13, y: -8, weaveAmp: 2.2, weaveFreq: 2.6 },
    },

    // Strafing Bomber + Skiff escort
    {
      time: bar(8.8),
      kind: 'bomber',
      hitPoints: 2,
      data: { role: 'bomber', lead: 3.8, offset: new Vector3(20, 9.5, 0), strafeX: -5 },
    },
    {
      time: bar(9.1),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.4, fromX: -23, toX: -13, y: 8.5, weaveAmp: 2.8, weaveFreq: 3.2 },
    },
    {
      time: bar(9.3),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.4, fromX: 23, toX: 13, y: -7.5, weaveAmp: 2.8, weaveFreq: 3.0 },
    },

    // ---- Act 3: Eye of Battle & Warship Underbelly Run (Bars 10.0 - 16.0) ---
    // Raking the dreadnought's underbelly turrets
    {
      time: bar(10.5),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.2, offset: new Vector3(-18, 10, 0) },
    },
    {
      time: bar(11.4),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.2, offset: new Vector3(18, 10.5, 0) },
    },
    {
      time: bar(12.0),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.3, fromX: -22, toX: -13, y: -7, weaveAmp: 2.2, weaveFreq: 2.6 },
    },
    {
      time: bar(12.3),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.3, fromX: 22, toX: 13, y: -8, weaveAmp: 2.2, weaveFreq: 2.6 },
    },
    {
      time: bar(13.2),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.2, offset: new Vector3(-17, 10.5, 0) },
    },
    {
      time: bar(14.0),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.2, offset: new Vector3(18, 10, 0) },
    },
    {
      time: bar(14.6),
      kind: 'bomber',
      hitPoints: 2,
      data: { role: 'bomber', lead: 3.6, offset: new Vector3(-19, -8, 0), strafeX: 4 },
    },
    {
      time: bar(15.2),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: 22, toX: 13, y: 9, weaveAmp: 2.4, weaveFreq: 2.8 },
    },

    // ---- Act 4: Flagship Approach & Shield Assault (Bars 16.0 - 22.0) -------
    // Boss Phase 1: 4 Shield Generators along upper hull spine + Point Defense
    // hitStages [2, 1] triggers the 'stage' event when the first layer shatters!
    {
      time: bar(16.5),
      kind: 'shield-gen',
      hitStages: [2, 1],
      data: { role: 'shield-gen', lead: 3.6, offset: new Vector3(-18, 10.5, 0), index: 0 },
    },
    {
      time: bar(17.2),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.2, offset: new Vector3(19, 9, 0) },
    },
    {
      time: bar(18.0),
      kind: 'shield-gen',
      hitStages: [2, 1],
      data: { role: 'shield-gen', lead: 3.6, offset: new Vector3(18, 11, 0), index: 1 },
    },
    {
      time: bar(18.8),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.2, offset: new Vector3(-19, 8.5, 0) },
    },
    {
      time: bar(19.6),
      kind: 'shield-gen',
      hitStages: [2, 1],
      data: { role: 'shield-gen', lead: 3.6, offset: new Vector3(-17, 10.5, 0), index: 2 },
    },
    {
      time: bar(20.6),
      kind: 'shield-gen',
      hitStages: [2, 1],
      data: { role: 'shield-gen', lead: 3.6, offset: new Vector3(17, 11, 0), index: 3 },
    },
    {
      time: bar(21.2),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.2, offset: new Vector3(-18, 9.5, 0) },
    },

    // ---- Act 5: Shield Collapse & Escort Swarm Turnaround (Bars 22.0 - 25.0) -
    // Emergency escort fighters launch from the flagship hangars
    {
      time: bar(22.3),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: -23, toX: -13, y: 10, weaveAmp: 2.8, weaveFreq: 3.2 },
    },
    {
      time: bar(22.5),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: 23, toX: 13, y: 10.5, weaveAmp: 2.6, weaveFreq: 3.0 },
    },
    {
      time: bar(22.8),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: -21, toX: -12, y: -8, weaveAmp: 2.4, weaveFreq: 2.8 },
    },
    {
      time: bar(23.0),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: 21, toX: 12, y: -8.5, weaveAmp: 2.4, weaveFreq: 2.8 },
    },

    // Escort gunship & interceptor pincer
    {
      time: bar(23.7),
      kind: 'bomber',
      hitPoints: 2,
      data: { role: 'bomber', lead: 3.6, offset: new Vector3(-20, 9.5, 0), strafeX: 4 },
    },
    {
      time: bar(24.0),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: 23, toX: 14, y: 9.5, weaveAmp: 2.6, weaveFreq: 3.0 },
    },
    {
      time: bar(24.3),
      kind: 'skiff',
      hitPoints: 1,
      data: { role: 'skiff', lead: 3.2, fromX: -22, toX: -13, y: -7.5, weaveAmp: 2.6, weaveFreq: 3.0 },
    },

    // ---- Act 6: Boss Phase 2: Trench Dive & Core Power Systems (Bars 25.0 - 28.0)
    // Diving into the flagship central trenchwork
    // hitStages [2, 2] triggers 'stage' event when the containment fields shatter!
    {
      time: bar(25.2),
      kind: 'core-power',
      hitStages: [2, 2],
      data: { role: 'core-power', lead: 3.2, offset: new Vector3(-14, -8, 0), index: 0 },
    },
    {
      time: bar(25.6),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.0, offset: new Vector3(17, 8, 0) },
    },
    {
      time: bar(26.2),
      kind: 'core-power',
      hitStages: [2, 2],
      data: { role: 'core-power', lead: 3.2, offset: new Vector3(14, -8, 0), index: 1 },
    },
    {
      time: bar(26.6),
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', lead: 3.0, offset: new Vector3(-17, 8, 0) },
    },
    {
      time: bar(27.2),
      kind: 'core-power',
      hitStages: [2, 2],
      data: { role: 'core-power', lead: 3.2, offset: new Vector3(-13, -8.5, 0), index: 2 },
    },
  ];

  return timeline.sort((a, b) => a.time - b.time);
}

export const BROADSIDE_TIMELINE = createBroadsideTimeline();

// ---- 4. Scoring & Rank Ladder ----------------------------------------------

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  skiff: 120,
  bomber: 240,
  turret: 200,
  'shield-gen': 600,
  'core-power': 1200,
  bolt: 50,
};

export function scoreForKill(volleySize: number, enemy: LockOnEnemy<BroadsideEnemyKind, BroadsideSpawnData>): number {
  const base = KILL_SCORE[enemy.kind] ?? 100;
  const volleyMultiplier = 1 + (volleySize - 1) * 0.25;
  return Math.round(base * volleyMultiplier);
}

export function scoreForHit(_volleySize: number, enemy: LockOnEnemy<BroadsideEnemyKind, BroadsideSpawnData>): number {
  if (enemy.kind === 'shield-gen') return 150;
  if (enemy.kind === 'core-power') return 250;
  if (enemy.kind === 'bomber' || enemy.kind === 'turret') return 80;
  return 40;
}

export function scoreForVolley(results: Array<{ enemy: LockOnEnemy<BroadsideEnemyKind, BroadsideSpawnData>; killed: boolean }>): number {
  const killCount = results.filter((r) => r.killed).length;
  if (killCount <= 1) return 0;
  const bonusTable = [0, 0, 150, 350, 700, 1200, 2000];
  return bonusTable[Math.min(bonusTable.length - 1, killCount)];
}

export function rankForRun(score: number, kills: number, totalEnemies: number): string {
  const killRatio = totalEnemies > 0 ? kills / totalEnemies : 0;
  if (killRatio >= 0.92 && score >= 14000) return 'S';
  if (killRatio >= 0.82) return 'A';
  if (killRatio >= 0.68) return 'B';
  return 'C';
}

// ---- 5. Gameplay Engine Assembly -------------------------------------------

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const timeline = createBroadsideTimeline();
  const interceptedIds = new Set<number>();

  bus.on('runstart', () => {
    interceptedIds.clear();
  });
  bus.on('fire', ({ enemyId }) => {
    interceptedIds.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptedIds.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptedIds.delete(enemyId);
  });

  function fireBolt(context: BroadsideUpdate, from: Vector3) {
    const aimTarget = hostileShotAimPoint(context.camera, from, 4.0);
    const initialVel = aimTarget.clone().sub(from).normalize().multiplyScalar(15);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: {
        role: 'bolt',
        position: from.clone(),
        velocity: initialVel,
        impact: {},
      },
    });
  }

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    createRail: createBroadsideFkioRail,
    spawnTimeline: timeline,
    startWord: 'LAUNCH',
    replayWord: 'REPLAY',
    playerHealth: 4,
    easeRunProgress(time, duration) {
      return speedProfile.runProgress(time, duration);
    },
    scoreForKill,
    scoreForHit,
    scoreForVolley,
    rankForRun,

    updateAttractCamera({ camera, modeTime }) {
      const sway = Math.sin(modeTime * 0.8) * 0.4;
      camera.position.set(sway, 2.5, 40);
      camera.lookAt(0, 3.5, -40);
    },

    updateEnemy(context: BroadsideUpdate) {
      const { enemy, runProgress, age, curve, camera, railAnchor, damagePlayer } = context;
      const data = enemy.entry.data;

      // Hostile projectile bolt logic
      if (data.role === 'bolt') {
        const distToCam = data.position.distanceTo(camera.position);
        if (distToCam < 3.6 && !interceptedIds.has(enemy.id)) {
          damagePlayer(1);
          return true;
        }

        const impact = updateHostileShotImpact({
          age,
          camera,
          position: data.position,
          velocity: data.velocity,
          state: data.impact,
          intercepted: interceptedIds.delete(enemy.id),
          config: { hitDistance: 4.5, impactBrake: 0.35, damageDistance: 1.0 },
        });

        if (impact.phase === 'braking') {
          enemy.mesh.position.copy(data.position);
          enemy.mesh.quaternion.copy(camera.quaternion);
          if (impact.damaged) {
            damagePlayer(1);
            return true;
          }
          return false;
        }

        steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, 3.5), age, 1 / 60, {
          baseSpeed: 14,
          maxSpeed: 24,
          accel: 4,
          turnRate: 2.2,
        });

        enemy.mesh.position.copy(data.position);
        enemy.mesh.lookAt(camera.position);

        return age > 6.0 || shotBehindCamera(camera, data.position, 4);
      }

      const anchorU = railAnchor(data.lead);

      // Despawn if camera has passed anchor point
      if (runProgress > anchorU + 0.014) {
        return true;
      }

      if (data.role === 'skiff') {
        const progress = MathUtils.clamp(age / data.lead, 0, 1);
        const x = MathUtils.lerp(data.fromX, data.toX, progress) + Math.sin(age * data.weaveFreq) * data.weaveAmp;
        const y = data.y + Math.cos(age * (data.weaveFreq * 0.8)) * (data.weaveAmp * 0.6);
        const pos = offsetFromRail(curve, anchorU, new Vector3(x, y, 0));
        enemy.mesh.position.copy(pos);

        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateZ(Math.sin(age * data.weaveFreq) * 0.6);
        return false;
      }

      if (data.role === 'bomber') {
        const progress = MathUtils.clamp(age / data.lead, 0, 1);
        const offset = data.offset.clone();
        offset.x += Math.sin(progress * Math.PI) * data.strafeX;

        const pos = offsetFromRail(curve, anchorU, offset);
        enemy.mesh.position.copy(pos);
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateZ(-data.strafeX * 0.04);

        const fireState = context.enemyState(() => ({ fired: false }));
        if (!fireState.fired && age > 1.2) {
          fireState.fired = true;
          fireBolt(context, pos);
        }
        return false;
      }

      if (data.role === 'turret') {
        const pos = offsetFromRail(curve, anchorU, data.offset);
        enemy.mesh.position.copy(pos);

        const housing = enemy.mesh.userData.turretHousing as Object3D | undefined;
        if (housing) {
          housing.lookAt(camera.position);
        }

        const fireState = context.enemyState(() => ({ fired: false }));
        if (!fireState.fired && age > 1.1) {
          fireState.fired = true;
          fireBolt(context, pos);
        }
        return false;
      }

      if (data.role === 'shield-gen') {
        const pos = offsetFromRail(curve, anchorU, data.offset);
        enemy.mesh.position.copy(pos);

        const ring = enemy.mesh.userData.ringMesh as Object3D | undefined;
        if (ring) {
          ring.rotation.z += 0.08;
        }
        const shield = enemy.mesh.userData.shieldMesh as Object3D | undefined;
        if (shield) {
          const pulse = 1.0 + Math.sin(age * 5) * 0.08;
          shield.scale.setScalar(pulse);
        }
        return false;
      }

      if (data.role === 'core-power') {
        const pos = offsetFromRail(curve, anchorU, data.offset);
        enemy.mesh.position.copy(pos);

        const aura = enemy.mesh.userData.auraMesh as Object3D | undefined;
        if (aura) {
          const pulse = 1.0 + Math.sin(age * 7) * 0.12;
          aura.scale.setScalar(pulse);
        }
        return false;
      }

      return false;
    },
  };
}
