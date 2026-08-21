import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile, type SpeedKey } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  bar,
  TINKER_BARS,
  TINKER_BPM,
  TINKER_MARKERS,
  TINKER_RUN_DURATION,
  TINKER_TIME,
} from './timing';

export type TinkerEnemyKind =
  | 'beetle'
  | 'skitterer'
  | 'walker'
  | 'snapper'
  | 'mortar'
  | 'hazard'
  | 'spill-core-1'
  | 'spill-core-2'
  | 'spill-core-3'
  | 'spill-core-4'
  | 'spill-heart';

export type TinkerSpawnData =
  | { role: 'beetle'; lead: number; offset: Vector3; freq: number }
  | { role: 'skitterer'; lead: number; fromX: number; toX: number; y: number }
  | { role: 'walker'; lead: number; offset: Vector3; stepRate: number }
  | { role: 'snapper'; lead: number; offset: Vector3; diveDepth: number }
  | { role: 'mortar'; lead: number; offset: Vector3; fireTime: number }
  | { role: 'hazard'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'spill-core'; lead: number; angleOffset: number; radius: number }
  | { role: 'spill-heart'; lead: number };

export type TinkerSpawnEntry = LockOnSpawnEntry<TinkerEnemyKind, TinkerSpawnData>;
export type TinkerUpdate = LockOnEnemyUpdate<TinkerEnemyKind, TinkerSpawnData>;

// ---- Rail Geometry ----
// Dynamic 3D path across the oversized worktable: loops between props, ruler bridges, and boss center
export function createTinkerRail(): CatmullRomCurve3 {
  const points = [
    new Vector3(-45, 3.5, 55),
    new Vector3(-35, 4.0, 38),
    new Vector3(-20, 3.2, 22),
    new Vector3(-5, 4.5, 12),
    new Vector3(15, 3.8, 18),
    new Vector3(32, 5.2, 8),
    new Vector3(25, 7.5, -12),
    new Vector3(8, 8.2, -28),
    new Vector3(-16, 5.4, -36),
    new Vector3(-38, 4.2, -20),
    new Vector3(-42, 4.8, 5),
    new Vector3(-24, 3.5, 30),
    new Vector3(0, 4.2, 42),
    new Vector3(28, 5.0, 32),
    new Vector3(40, 6.2, 5),
    new Vector3(30, 7.0, -22),
    new Vector3(6, 6.5, -40),
    new Vector3(-22, 5.0, -32),
    new Vector3(-30, 4.0, -8),
    new Vector3(-15, 3.5, 15),
    new Vector3(5, 4.0, 25),
    new Vector3(22, 5.2, 10),
    new Vector3(18, 6.0, -15),
    new Vector3(-5, 5.5, -20),
    new Vector3(-18, 4.2, -5),
    new Vector3(-8, 3.8, 8),
    new Vector3(0, 3.5, 0), // The Great Glue Spill center
    new Vector3(8, 4.2, -8),
    new Vector3(18, 4.5, -18),
    new Vector3(30, 3.8, -32),
    new Vector3(45, 3.5, -48),
  ];

  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- Speed Profile ----
const SPEED_KEYS: SpeedKey[] = [
  [bar(0), 0.75],
  [bar(4), 0.85],
  [bar(10), 1.25], // Tennis-ball scale acceleration
  [bar(18), 1.15], // Melon scale
  [bar(22), 1.35], // Boss battle rush
  [bar(28), 1.45], // Core crack climax
  [bar(30), 0.95], // Spotless clean coast
  [bar(32), 0.5],
];

export const speedProfile = createSpeedProfile(SPEED_KEYS, TINKER_RUN_DURATION);

// ---- Spawn Timeline Choreography ----
export function createTinkerTimeline(): TinkerSpawnEntry[] {
  const entries: TinkerSpawnEntry[] = [];
  const add = (entry: TinkerSpawnEntry) => entries.push(entry);

  // 1. Act 1: Marble Scale & Craft Clutter (Bars 2 to 10)
  // Wide lateral button beetles
  add({
    time: bar(2, 0),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(-10.2, -2.5, 0), freq: 8 },
  });
  add({
    time: bar(2, 2),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(10.5, -2.5, 0), freq: 9 },
  });
  add({
    time: bar(3, 0),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(-9.5, 3.5, 0), freq: 11 },
  });
  add({
    time: bar(3, 2),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(9.2, -3.2, 0), freq: 10 },
  });

  // Skitterers sweeping broadly across the full screen
  add({
    time: bar(4, 0),
    kind: 'skitterer',
    data: { role: 'skitterer', lead: 3.2, fromX: -13.5, toX: 12.0, y: 3.5 },
  });
  add({
    time: bar(4, 2),
    kind: 'skitterer',
    data: { role: 'skitterer', lead: 3.2, fromX: 13.5, toX: -12.0, y: -3.5 },
  });
  add({
    time: bar(5, 0),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(-11.0, -2.0, 0), freq: 12 },
  });
  add({
    time: bar(5, 1),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(7.5, 5.2, 0), freq: 8 },
  });
  add({
    time: bar(5, 2),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(11.0, -2.0, 0), freq: 12 },
  });

  add({
    time: bar(6, 0),
    kind: 'skitterer',
    data: { role: 'skitterer', lead: 3.0, fromX: -14.0, toX: 13.0, y: 4.0 },
  });
  add({
    time: bar(6, 2),
    kind: 'skitterer',
    data: { role: 'skitterer', lead: 3.0, fromX: 14.0, toX: -13.0, y: -3.8 },
  });

  // Snapping Birds swooping high from outer flanks
  add({
    time: bar(7, 0),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.6, offset: new Vector3(-10.5, 7.5, 0), diveDepth: 4.0 },
  });
  add({
    time: bar(7, 2),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.6, offset: new Vector3(10.5, 7.5, 0), diveDepth: 4.0 },
  });
  add({
    time: bar(8, 0),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.4, offset: new Vector3(-8.5, 8.0, 0), diveDepth: 4.5 },
  });
  add({
    time: bar(8, 2),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(-10.5, -3.2, 0), freq: 10 },
  });
  add({
    time: bar(8, 3),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(10.5, -3.2, 0), freq: 10 },
  });
  add({
    time: bar(9, 0),
    kind: 'skitterer',
    data: { role: 'skitterer', lead: 3.0, fromX: -13.0, toX: 13.0, y: 2.5 },
  });
  add({
    time: bar(9, 2),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.5, offset: new Vector3(-9.8, 6.8, 0), diveDepth: 3.5 },
  });

  // 2. Act 2: Tennis-Ball Scale & Workshop Rush (Bars 10 to 18)
  // Tall Pencil-Leg Walkers stride on far flanks
  add({
    time: bar(10, 0),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.2, offset: new Vector3(-11.0, 3.2, 0), stepRate: 6 },
  });
  add({
    time: bar(10, 2),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.2, offset: new Vector3(11.0, 3.2, 0), stepRate: 6 },
  });

  add({
    time: bar(11, 2),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.5, offset: new Vector3(8.5, 7.5, 0), diveDepth: 4.2 },
  });
  add({
    time: bar(12, 0),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.0, offset: new Vector3(-9.5, 3.8, 0), stepRate: 7 },
  });
  add({
    time: bar(12, 2),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.5, offset: new Vector3(10.0, -2.8, 0), freq: 11 },
  });
  add({
    time: bar(13, 0),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.0, offset: new Vector3(9.8, 3.8, 0), stepRate: 7 },
  });
  add({
    time: bar(13, 2),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.5, offset: new Vector3(-9.5, 6.8, 0), diveDepth: 3.5 },
  });

  // Paint-Pot Mortar Turrets on far left and right edges
  add({
    time: bar(14, 0),
    kind: 'mortar',
    hitPoints: 3,
    hitStages: [1, 1, 1],
    data: { role: 'mortar', lead: 4.8, offset: new Vector3(-11.5, 1.8, 0), fireTime: bar(15, 0) },
  });
  add({
    time: bar(14, 2),
    kind: 'mortar',
    hitPoints: 3,
    hitStages: [1, 1, 1],
    data: { role: 'mortar', lead: 4.8, offset: new Vector3(11.5, 1.8, 0), fireTime: bar(15, 2) },
  });

  add({
    time: bar(15, 2),
    kind: 'skitterer',
    data: { role: 'skitterer', lead: 3.0, fromX: -13.5, toX: 13.5, y: 3.0 },
  });
  add({
    time: bar(16, 0),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.0, offset: new Vector3(-10.2, 3.5, 0), stepRate: 6 },
  });
  add({
    time: bar(16, 2),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.0, offset: new Vector3(10.2, 3.5, 0), stepRate: 6 },
  });
  add({
    time: bar(17, 0),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.4, offset: new Vector3(-8.8, 7.2, 0), diveDepth: 4.0 },
  });
  add({
    time: bar(17, 2),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.4, offset: new Vector3(8.8, 7.2, 0), diveDepth: 4.0 },
  });

  // 3. Act 3: Melon Scale & Approach to the Spill (Bars 18 to 22)
  add({
    time: bar(18, 0),
    kind: 'mortar',
    hitPoints: 3,
    hitStages: [1, 1, 1],
    data: { role: 'mortar', lead: 4.5, offset: new Vector3(-12.0, 2.2, 0), fireTime: bar(19, 0) },
  });
  add({
    time: bar(18, 2),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.0, offset: new Vector3(8.5, 4.5, 0), stepRate: 8 },
  });
  add({
    time: bar(19, 0),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.5, offset: new Vector3(-10.2, 6.8, 0), diveDepth: 3.8 },
  });
  add({
    time: bar(19, 2),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.5, offset: new Vector3(10.2, 6.8, 0), diveDepth: 3.8 },
  });

  add({
    time: bar(20, 0),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.2, offset: new Vector3(-10.0, -2.8, 0), freq: 12 },
  });
  add({
    time: bar(20, 1),
    kind: 'beetle',
    data: { role: 'beetle', lead: 3.2, offset: new Vector3(10.0, -2.8, 0), freq: 12 },
  });
  add({
    time: bar(20, 2),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.0, offset: new Vector3(-9.8, 3.2, 0), stepRate: 7 },
  });
  add({
    time: bar(20, 3),
    kind: 'walker',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'walker', lead: 4.0, offset: new Vector3(9.8, 3.2, 0), stepRate: 7 },
  });

  // 4. Boss Encounter: The Great Glue Spill (Bars 22 to 30)
  // 4 Auxiliary Cores in wide orbit protecting the central spill
  add({
    time: bar(22, 0),
    kind: 'spill-core-1',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'spill-core', lead: 5.5, angleOffset: 0, radius: 8.5 },
  });
  add({
    time: bar(22, 1),
    kind: 'spill-core-2',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'spill-core', lead: 5.5, angleOffset: Math.PI * 0.5, radius: 8.5 },
  });
  add({
    time: bar(22, 2),
    kind: 'spill-core-3',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'spill-core', lead: 5.5, angleOffset: Math.PI, radius: 8.5 },
  });
  add({
    time: bar(22, 3),
    kind: 'spill-core-4',
    hitPoints: 2,
    hitStages: [1, 1],
    data: { role: 'spill-core', lead: 5.5, angleOffset: Math.PI * 1.5, radius: 8.5 },
  });

  // Snapper escorts during boss
  add({
    time: bar(24, 0),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.5, offset: new Vector3(-9.5, 7.5, 0), diveDepth: 3.5 },
  });
  add({
    time: bar(24, 2),
    kind: 'snapper',
    data: { role: 'snapper', lead: 3.5, offset: new Vector3(9.5, 7.5, 0), diveDepth: 3.5 },
  });

  // Mortar support during boss
  add({
    time: bar(25, 0),
    kind: 'mortar',
    hitPoints: 2,
    data: { role: 'mortar', lead: 4.5, offset: new Vector3(-10.5, 2.5, 0), fireTime: bar(26, 0) },
  });
  add({
    time: bar(25, 2),
    kind: 'mortar',
    hitPoints: 2,
    data: { role: 'mortar', lead: 4.5, offset: new Vector3(10.5, 2.5, 0), fireTime: bar(26, 2) },
  });

  // Grand Spill Heart (Final Boss Core - 6 Hit Points, unlocks at bar 27)
  add({
    time: bar(27, 0),
    kind: 'spill-heart',
    hitPoints: 6,
    hitStages: [1, 1, 1, 1, 1, 1],
    data: { role: 'spill-heart', lead: 5.0 },
  });

  // Sort timeline chronologically
  return entries.sort((a, b) => a.time - b.time);
}

// ---- Enemy Motion & Runtime Update ----
export function updateTinkerEnemy(ctx: TinkerUpdate): boolean | void {
  const { enemy, runTime, curve, age, railAnchor, camera, enemyState, spawnEnemy, damagePlayer } = ctx;
  const data = enemy.entry.data;

  switch (data.role) {
    case 'beetle': {
      const u = railAnchor(data.lead);
      if (age > data.lead + 1.2) return true; // Despawn miss
      const xWave = Math.sin(age * data.freq) * 4.2;
      const offset = new Vector3(data.offset.x + xWave, data.offset.y, data.offset.z);
      const pos = offsetFromRail(curve, u, offset);
      enemy.mesh.position.copy(pos);
      enemy.mesh.rotation.y = age * 3.0;
      break;
    }

    case 'skitterer': {
      const u = railAnchor(data.lead);
      if (age > data.lead + 1.0) return true;
      const t = Math.min(1, age / data.lead);
      const x = MathUtils.lerp(data.fromX, data.toX, t);
      const offset = new Vector3(x, data.y + Math.sin(age * 16) * 0.8, 0);
      const pos = offsetFromRail(curve, u, offset);
      enemy.mesh.position.copy(pos);
      enemy.mesh.rotation.z = Math.sin(age * 20) * 0.2;
      break;
    }

    case 'walker': {
      const u = railAnchor(data.lead);
      if (age > data.lead + 1.2) return true;
      const stepY = Math.abs(Math.sin(age * data.stepRate)) * 1.1;
      const offset = new Vector3(data.offset.x, data.offset.y + stepY, data.offset.z);
      const pos = offsetFromRail(curve, u, offset);
      enemy.mesh.position.copy(pos);
      enemy.mesh.rotation.z = Math.sin(age * data.stepRate) * 0.15;
      break;
    }

    case 'snapper': {
      const u = railAnchor(data.lead);
      if (age > data.lead + 1.0) return true;
      const diveProgress = Math.sin((age / data.lead) * Math.PI);
      const diveY = -diveProgress * data.diveDepth;
      const offset = new Vector3(data.offset.x, data.offset.y + diveY, data.offset.z);
      const pos = offsetFromRail(curve, u, offset);
      enemy.mesh.position.copy(pos);
      enemy.mesh.rotation.x = Math.sin(age * 12) * 0.25;
      break;
    }

    case 'mortar': {
      const u = railAnchor(data.lead);
      if (age > data.lead + 1.5) return true;
      const pos = offsetFromRail(curve, u, data.offset);
      enemy.mesh.position.copy(pos);
      enemy.mesh.lookAt(camera.position);

      // Fire hazard projectile once at fireTime
      const state = enemyState(() => ({ fired: false }));
      if (!state.fired && runTime >= data.fireTime) {
        state.fired = true;
        const shotVel = camera.position.clone().sub(pos).normalize().multiplyScalar(18);
        spawnEnemy({
          time: runTime,
          kind: 'hazard',
          countsTowardTotal: false,
          data: {
            role: 'hazard',
            position: pos.clone().add(new Vector3(0, 1.2, 0)),
            velocity: shotVel,
            lastAge: 0,
            impact: {},
          },
        });
      }
      break;
    }

    case 'hazard': {
      if (age > 4.5 || shotBehindCamera(camera, enemy.mesh.position)) return true;
      const dt = age - data.lastAge;
      data.lastAge = age;

      const aim = hostileShotAimPoint(camera, enemy.mesh.position);
      steerHomingShot(data.position, data.velocity, aim, age, dt, {
        baseSpeed: 14,
        maxSpeed: 22,
        accel: 3.0,
        turnRate: 4.5,
      });
      enemy.mesh.position.copy(data.position);
      enemy.mesh.rotation.x += dt * 8;
      enemy.mesh.rotation.y += dt * 10;

      const impact = updateHostileShotImpact({
        age,
        camera,
        position: enemy.mesh.position,
        velocity: data.velocity,
        state: data.impact,
        config: {
          hitDistance: 2.2,
          damageDistance: 1.4,
        },
      });

      if (impact.phase === 'braking' && impact.damaged) {
        damagePlayer(1);
        return true;
      }
      break;
    }

    case 'spill-core': {
      const u = railAnchor(data.lead);
      if (age > data.lead + 1.8) return true;
      const orbitAngle = age * 1.8 + data.angleOffset;
      const ox = Math.cos(orbitAngle) * data.radius;
      const oy = Math.sin(orbitAngle) * (data.radius * 0.55) + 3.0;
      const offset = new Vector3(ox, oy, 0);
      const pos = offsetFromRail(curve, u, offset);
      enemy.mesh.position.copy(pos);
      enemy.mesh.rotation.y = orbitAngle;
      break;
    }

    case 'spill-heart': {
      const u = railAnchor(data.lead);
      if (age > data.lead + 2.5) return true;
      const offset = new Vector3(5.5, 4.5 + Math.sin(age * 3) * 1.2, 0);
      const pos = offsetFromRail(curve, u, offset);
      enemy.mesh.position.copy(pos);
      enemy.mesh.rotation.y = age * 1.2;
      break;
    }
  }
}

export function createTinkerGameplay(bus: EventBus): LockOnRunnerLevel<TinkerEnemyKind, TinkerSpawnData> {
  const curve = createTinkerRail();
  const spawnTimeline = createTinkerTimeline();

  return {
    duration: TINKER_RUN_DURATION,
    bpm: TINKER_BPM,
    createRail: () => curve,
    spawnTimeline,
    updateEnemy: updateTinkerEnemy,
    easeRunProgress: (t) => speedProfile.runProgress(t),
    playerHealth: 5,
    lockRadiusNdc: 0.085,
    startWord: 'START!',
    replayWord: 'REPLAY',
    rankForRun(score, kills, totalEnemies) {
      const killRatio = totalEnemies > 0 ? kills / totalEnemies : 0;
      if (killRatio >= 0.92) return 'S';
      if (killRatio >= 0.78) return 'A';
      if (killRatio >= 0.60) return 'B';
      if (killRatio >= 0.40) return 'C';
      return 'D';
    },
    detailsForRun() {
      return [
        'CLEANUP CREW DISPATCHED',
        'TABLETOP RESTORED TO PRISTINE FINISH',
      ];
    },
  };
}
