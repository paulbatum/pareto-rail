import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import {
  STRANDLINE_542F_BPM,
  STRANDLINE_542F_MARKERS,
  STRANDLINE_542F_RUN_DURATION,
  STRANDLINE_542F_TIME,
  strandlineBar,
} from './timing';

export { STRANDLINE_542F_BPM, STRANDLINE_542F_RUN_DURATION } from './timing';

export const STRANDLINE_542F_PLAYER_HEALTH = 4;

export type Strandline542fEnemyKind = 'latcher' | 'skimmer' | 'cyst' | 'drifter' | 'brood' | 'stinger' | 'parent';

export type Strandline542fSpawnData =
  | { role: 'latcher'; lead: number; side: number; high: number; phase: number; detachAge: number }
  | { role: 'skimmer'; lead: number; direction: number; high: number; phase: number; arc: number }
  | { role: 'cyst'; lead: number; side: number; high: number; phase: number; fireAge: number }
  | { role: 'drifter'; lead: number; side: number; high: number; phase: number; spiral: number }
  | { role: 'brood'; phase: number; slot: number; count: number; anchorU: number; angle: number }
  | { role: 'stinger'; origin: readonly [number, number, number]; seed: number }
  | { role: 'parent'; anchorU: number; deadline: number };

export type Strandline542fSpawnEntry = LockOnSpawnEntry<Strandline542fEnemyKind, Strandline542fSpawnData>;
type Strandline542fUpdate = LockOnEnemyUpdate<Strandline542fEnemyKind, Strandline542fSpawnData>;

const speedProfile = createSpeedProfile([
  [0, 0.72],
  [strandlineBar(2), 0.8],
  [strandlineBar(6), 1.02],
  [strandlineBar(8), 0.86],
  [strandlineBar(11), 1.12],
  [strandlineBar(14), 0.9],
  [strandlineBar(16), 0.58],
  [strandlineBar(21), 0.5],
  [strandlineBar(22), 1.0],
  [STRANDLINE_542F_RUN_DURATION, 0.78],
], STRANDLINE_542F_RUN_DURATION);

export const strandline542fRunProgress = speedProfile.runProgress;
export const strandline542fSpeedAt = speedProfile.speedAt;

/**
 * The first two thirds braid through the trailing tentacles. The lateral swing
 * at the green-moon section is intentionally much wider than the combat bends;
 * the final three points peel away from the crown for the whole-animal view.
 */
export function createStrandline542fRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(-5, 3, -24),
    new Vector3(8, -4, -49),
    new Vector3(-12, 6, -74),
    new Vector3(-4, -7, -99),
    new Vector3(16, -2, -122),
    new Vector3(34, 10, -143),
    new Vector3(49, 18, -165),
    new Vector3(31, 11, -190),
    new Vector3(8, 2, -214),
    new Vector3(-15, -8, -239),
    new Vector3(13, -11, -264),
    new Vector3(-19, 1, -288),
    new Vector3(-2, 12, -312),
    new Vector3(19, 25, -334),
    new Vector3(7, 39, -354),
    new Vector3(-5, 48, -373),
    new Vector3(7, 50, -394),
    new Vector3(30, 58, -416),
    new Vector3(62, 72, -428),
    new Vector3(96, 88, -418),
    new Vector3(126, 102, -393),
  ], false, 'catmullrom', 0.34);
}

const stagger = STRANDLINE_542F_TIME.seconds(0.12);

function latchers(time: number, slots: ReadonlyArray<readonly [number, number]>, lead = 4.6): Strandline542fSpawnEntry[] {
  return slots.map(([side, high], index) => ({
    time: time + index * stagger,
    kind: 'latcher',
    data: {
      role: 'latcher',
      lead,
      side,
      high,
      phase: time * 0.41 + index * 1.27,
      detachAge: 0.72 + (index % 3) * 0.18,
    },
  }));
}

function skimmers(time: number, slots: ReadonlyArray<readonly [number, number]>, lead = 4.35): Strandline542fSpawnEntry[] {
  return slots.map(([direction, high], index) => ({
    time: time + index * stagger * 1.1,
    kind: 'skimmer',
    data: {
      role: 'skimmer',
      lead,
      direction,
      high,
      phase: time * 0.29 + index * 0.91,
      arc: (index % 2 === 0 ? 1 : -1) * (1.3 + (index % 3) * 0.4),
    },
  }));
}

function cysts(time: number, slots: ReadonlyArray<readonly [number, number]>, lead = 5.1): Strandline542fSpawnEntry[] {
  return slots.map(([side, high], index) => ({
    time: time + index * stagger * 1.35,
    kind: 'cyst',
    hitPoints: 2,
    data: {
      role: 'cyst',
      lead,
      side,
      high,
      phase: index * 1.83 + time,
      fireAge: 2.35 + index * 0.16,
    },
  }));
}

function drifters(time: number, slots: ReadonlyArray<readonly [number, number]>, lead = 4.65): Strandline542fSpawnEntry[] {
  return slots.map(([side, high], index) => ({
    time: time + index * stagger,
    kind: 'drifter',
    data: {
      role: 'drifter',
      lead,
      side,
      high,
      phase: time * 0.34 + index * 1.67,
      spiral: index % 2 === 0 ? 1 : -1,
    },
  }));
}

const PARENT_ANCHOR_U = strandline542fRunProgress(strandlineBar(21.2));

export const STRANDLINE_542F_PARENT_ENTRY: Strandline542fSpawnEntry = {
  time: STRANDLINE_542F_MARKERS.parent,
  kind: 'parent',
  hitStages: [2, 2, 2],
  lockable: false,
  data: {
    role: 'parent',
    anchorU: PARENT_ANCHOR_U,
    deadline: STRANDLINE_542F_MARKERS.release - 0.25,
  },
};

export function createStrandline542fTimeline(): Strandline542fSpawnEntry[] {
  return [
    // Hush: parasites still look like sour knots clamped to the living strands.
    ...latchers(strandlineBar(0.7), [[-7.6, -3.2], [-3.7, 3.8], [1.2, -1.4], [6.9, 4.8]], 4.7),
    ...drifters(strandlineBar(1.65), [[-7.8, 4.8], [-2.8, -4.7], [3.0, 4.1], [8.0, -2.8]], 4.4),
    ...skimmers(strandlineBar(2.55), [[-1, -4.8], [1, 4.9], [-1, 1.1], [1, -1.2]], 4.25),
    ...cysts(strandlineBar(3.45), [[-6.8, 4.4], [6.8, -3.9]], 4.85),
    ...latchers(strandlineBar(4.25), [[-8.4, 0], [-5, 5.3], [-1.7, -4.8], [1.7, 4.8], [5, -5.3], [8.4, 0]], 4.35),
    ...drifters(strandlineBar(5.25), [[-7.5, -4.8], [-2.5, 5.6], [2.5, -5.6], [7.5, 4.8]], 4.15),

    // The wide curve: fewer bodies, broad crossings, the bell readable behind them.
    ...skimmers(strandlineBar(6.35), [[-1, 5.5], [1, -4.9], [-1, 0.4]], 4.9),
    ...drifters(strandlineBar(7.1), [[-8.2, 2.8], [0, -5.6], [8.2, 3.6]], 5.0),
    ...cysts(strandlineBar(8.0), [[-7.4, -3.8], [0, 5.7], [7.4, -3.8]], 4.75),

    // Back inside: the animal's returning pulse turns the formations musical.
    ...skimmers(strandlineBar(9.05), [[1, -5.4], [-1, 5.5], [1, 2.0], [-1, -1.8], [1, 0]], 4.15),
    ...latchers(strandlineBar(10.0), [[-8, 4.6], [-4.8, -4.9], [0, 5.8], [4.8, -4.9], [8, 4.6]], 4.3),
    ...drifters(strandlineBar(11.0), [[-8.5, -1.5], [-5.2, 5.5], [-1.8, -5.6], [1.8, 5.6], [5.2, -5.5], [8.5, 1.5]], 4.15),
    ...cysts(strandlineBar(12.0), [[-7.8, 4.6], [-2.6, -5.2], [2.6, 5.2], [7.8, -4.6]], 4.65),
    ...skimmers(strandlineBar(13.05), [[-1, -5.7], [1, 5.7], [-1, 2.3], [1, -2.3], [-1, 0]], 4.0),

    // Crown approach: violet geometry thickens, then everything clears for the parent.
    ...latchers(strandlineBar(14.0), [[-8.3, -4.2], [-5.0, 3.5], [-1.7, 5.8], [1.7, -5.8], [5.0, -3.5], [8.3, 4.2]], 4.0),
    ...cysts(strandlineBar(14.9), [[-7.2, 5.0], [0, -5.8], [7.2, 5.0]], 4.1),
    ...drifters(strandlineBar(15.45), [[-6.4, -3.5], [-2.1, 4.8], [2.1, -4.8], [6.4, 3.5]], 3.7),
    STRANDLINE_542F_PARENT_ENTRY,
  ].sort((a, b) => a.time - b.time);
}

export const STRANDLINE_542F_SPAWN_TIMELINE = createStrandline542fTimeline();

const KILL_SCORE: Record<Strandline542fEnemyKind, number> = {
  latcher: 130,
  skimmer: 145,
  cyst: 260,
  drifter: 165,
  brood: 210,
  stinger: 80,
  parent: 3000,
};

type EnemyState = HostileShotImpactState & {
  fired: boolean;
  initialized: boolean;
  velocity: Vector3;
  waveStamp: number;
  damaged: boolean;
  lastAge: number;
};

export function createStrandline542fGameplay(bus: EventBus): LockOnRunnerLevel<Strandline542fEnemyKind, Strandline542fSpawnData> {
  let parentId = -1;
  let parentKilled = false;
  let currentWeb = 0;
  let clearedWebs = 0;
  let currentRunTime = 0;
  let phaseReadyAt = STRANDLINE_542F_MARKERS.parent + 0.55;
  let cleansedBroods = 0;
  let escapedBroods = 0;
  let interceptedStingers = 0;
  let hullHits = 0;
  const spawnedWebs = new Set<number>();
  const livingBroods = new Map<number, Set<number>>();
  const stingerIds = new Set<number>();

  const reset = () => {
    parentId = -1;
    parentKilled = false;
    currentWeb = 0;
    clearedWebs = 0;
    currentRunTime = 0;
    phaseReadyAt = STRANDLINE_542F_MARKERS.parent + 0.55;
    cleansedBroods = 0;
    escapedBroods = 0;
    interceptedStingers = 0;
    hullHits = 0;
    spawnedWebs.clear();
    livingBroods.clear();
    stingerIds.clear();
    STRANDLINE_542F_PARENT_ENTRY.lockable = false;
  };

  const openWebIfClear = (web: number) => {
    const remaining = livingBroods.get(web);
    if (web !== currentWeb || !spawnedWebs.has(web) || (remaining && remaining.size > 0)) return;
    clearedWebs = Math.max(clearedWebs, web + 1);
    currentWeb = clearedWebs;
    const nextGate = [
      STRANDLINE_542F_MARKERS.parent,
      STRANDLINE_542F_MARKERS.webTwo,
      STRANDLINE_542F_MARKERS.webThree,
    ][currentWeb] ?? currentRunTime;
    phaseReadyAt = Math.max(currentRunTime + 0.38, nextGate);
    if (clearedWebs >= 3) {
      STRANDLINE_542F_PARENT_ENTRY.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('runstart', reset);
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') {
      parentId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
    if (kind === 'stinger') stingerIds.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (enemyId === parentId) {
      parentKilled = true;
      STRANDLINE_542F_PARENT_ENTRY.lockable = false;
      bus.emit('bossphase', { phase: 'destroyed' });
      return;
    }
    if (stingerIds.delete(enemyId)) interceptedStingers += 1;
    for (const [web, living] of livingBroods) {
      if (!living.delete(enemyId)) continue;
      cleansedBroods += 1;
      openWebIfClear(web);
      break;
    }
  });
  bus.on('miss', ({ enemyId }) => {
    stingerIds.delete(enemyId);
    for (const [web, living] of livingBroods) {
      if (!living.delete(enemyId)) continue;
      escapedBroods += 1;
      // A detached brood no longer feeds its strand of web. It counts as a
      // miss, but does not make a late run mechanically impossible.
      openWebIfClear(web);
      break;
    }
  });
  bus.on('playerhit', () => { hullHits += 1; });

  const updateEnemy = ({ enemy, runTime, age, curve, camera, railAnchor, enemyState, spawnEnemy, damagePlayer }: Strandline542fUpdate) => {
    currentRunTime = runTime;
    const data = enemy.entry.data;
    const state = enemyState<EnemyState>(() => ({
      fired: false,
      initialized: false,
      velocity: new Vector3(),
      waveStamp: -1,
      damaged: false,
      lastAge: 0,
    }));

    if (data.role === 'stinger') {
      const frameDt = Math.max(0, Math.min(0.1, age - state.lastAge));
      state.lastAge = age;
      if (!state.initialized) {
        state.initialized = true;
        enemy.mesh.position.fromArray(data.origin);
        const aim = hostileShotAimPoint(camera, enemy.mesh.position);
        state.velocity.copy(aim).sub(enemy.mesh.position).normalize().multiplyScalar(7.5 + data.seed * 0.45);
      }
      const impact = updateHostileShotImpact({
        age,
        camera,
        position: enemy.mesh.position,
        velocity: state.velocity,
        state,
        config: { hitDistance: 2.55, impactBrake: 0.42, damageDistance: 0.72 },
      });
      if (impact.phase === 'approach') {
        steerHomingShot(
          enemy.mesh.position,
          state.velocity,
          hostileShotAimPoint(camera, enemy.mesh.position),
          age,
          frameDt,
          { baseSpeed: 7.5, maxSpeed: 17, accel: 2.4, turnRate: 1.6 },
        );
      } else if (impact.damaged && !state.damaged) {
        state.damaged = true;
        damagePlayer();
        return true;
      }
      enemy.mesh.lookAt(camera.position);
      enemy.mesh.rotateZ(age * 2.1);
      return age > 7 || shotBehindCamera(camera, enemy.mesh.position, 2.5);
    }

    let anchorU = railAnchor(4.4);
    const drift = new Vector3();
    const pacedCrownU = strandline542fRunProgress(Math.min(STRANDLINE_542F_MARKERS.release - 0.3, runTime + 4.35));

    if (data.role === 'latcher') {
      anchorU = railAnchor(data.lead);
      const detach = MathUtils.smootherstep(age, data.detachAge, data.detachAge + 1.05);
      const inward = MathUtils.smoothstep(age, data.detachAge + 0.25, data.lead - 0.25);
      const coil = Math.sin(age * 2.5 + data.phase);
      drift.set(
        MathUtils.lerp(data.side, -data.side * 0.32, inward) + coil * detach * 1.7,
        MathUtils.lerp(data.high, data.high * 0.18, inward) + Math.cos(age * 2.1 + data.phase) * detach * 1.2,
        Math.sin(age * 1.7 + data.phase) * detach * 1.4,
      );
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ((1 - detach) * Math.sign(data.side || 1) * 0.55 + coil * 0.3);
    } else if (data.role === 'skimmer') {
      anchorU = railAnchor(data.lead);
      const crossing = MathUtils.smootherstep(age, 0.35, data.lead - 0.35);
      drift.set(
        MathUtils.lerp(data.direction * 9.3, -data.direction * 9.3, crossing),
        data.high + Math.sin(crossing * Math.PI) * data.arc + Math.sin(age * 1.7 + data.phase) * 0.7,
        Math.cos(age * 1.4 + data.phase) * 1.2,
      );
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(-data.direction * (0.42 + Math.sin(age * 1.3) * 0.2));
      enemy.mesh.rotateY(Math.sin(age * 2.0 + data.phase) * 0.32);
    } else if (data.role === 'cyst') {
      anchorU = railAnchor(data.lead);
      const peel = MathUtils.smootherstep(age, 0.6, Math.min(data.fireAge, data.lead - 0.5));
      drift.set(
        data.side + Math.sin(age * 0.8 + data.phase) * (0.4 + peel * 1.5),
        data.high + Math.cos(age * 1.05 + data.phase) * (0.35 + peel * 1.0),
        Math.sin(age * 1.2) * 0.8,
      );
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 0.7 * Math.sign(data.side || 1));
      if (!state.fired && age >= data.fireAge) {
        state.fired = true;
        const origin = enemy.mesh.position;
        spawnEnemy({
          time: runTime,
          kind: 'stinger',
          countsTowardTotal: false,
          data: { role: 'stinger', origin: [origin.x, origin.y, origin.z], seed: Math.abs(data.side) + data.phase % 3 },
        });
      }
    } else if (data.role === 'drifter') {
      anchorU = railAnchor(data.lead);
      const close = MathUtils.smoothstep(age, 0.2, data.lead - 0.25);
      const spiral = age * (1.35 + close * 1.5) * data.spiral + data.phase;
      drift.set(
        MathUtils.lerp(data.side, data.side * 0.35, close) + Math.cos(spiral) * (1.2 + close * 1.5),
        MathUtils.lerp(data.high, -data.high * 0.15, close) + Math.sin(spiral) * (1.1 + close),
        Math.sin(age * 1.5 + data.phase) * 1.3,
      );
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(spiral * 0.48);
    } else if (data.role === 'brood') {
      // The crown paces the camera during the fight. This keeps all three
      // broods in the same readable band instead of letting early waves sit
      // beyond the fog while the rail is still approaching the bell.
      anchorU = pacedCrownU;
      // Keep the complete six-node lattice inside one sweep even while the
      // crown rail is curving. Later webs rotate faster instead of growing so
      // a feeder cannot hide just outside the frustum and stall the phase.
      const spread = 2.9 + data.phase * 0.12;
      const angle = data.angle + age * (0.42 + data.phase * 0.08) * (data.slot % 2 ? -1 : 1);
      const breathe = 1 + Math.sin(age * 2.2 + data.slot) * 0.12;
      drift.set(
        Math.cos(angle) * spread * breathe,
        Math.sin(angle) * spread * 0.72 + (data.slot - (data.count - 1) / 2) * 0.4,
        Math.sin(age * 1.1 + data.slot) * 1.1,
      );
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(angle + age * 0.9);
    } else {
      anchorU = pacedCrownU;
      drift.set(Math.sin(age * 0.38) * 0.75, 1.8 + Math.cos(age * 0.52) * 0.45, 0);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(Math.sin(age * 0.66) * 0.1);
      enemy.mesh.userData.hitStageIndex = enemy.hitStageIndex;
      enemy.mesh.userData.webStage = clearedWebs;
      enemy.mesh.userData.webOpen = enemy.entry.lockable !== false;

      if (!spawnedWebs.has(currentWeb) && currentWeb < 3 && runTime >= phaseReadyAt) {
        spawnedWebs.add(currentWeb);
        // Six feeders make each web a deliberate full-lock sweep. This also
        // gives the brood clear musical punctuation: one volley starves one
        // lattice before the two-lock strike on the parent.
        const count = 6;
        const living = new Set<number>();
        livingBroods.set(currentWeb, living);
        for (let slot = 0; slot < count; slot += 1) {
          const id = spawnEnemy({
            time: runTime,
            kind: 'brood',
            data: {
              role: 'brood',
              phase: currentWeb,
              slot,
              count,
              anchorU: data.anchorU,
              angle: (slot / count) * Math.PI * 2 + currentWeb * 0.5,
            },
          });
          living.add(id);
        }
      }
      if (runTime >= data.deadline && !parentKilled) enemy.mesh.userData.deadline = true;
    }

    if (data.role === 'parent') return false;
    if (data.role === 'brood') return age > 5.8;
    return age > data.lead + 0.72;
  };

  return {
    duration: STRANDLINE_542F_RUN_DURATION,
    bpm: STRANDLINE_542F_BPM,
    createRail: createStrandline542fRail,
    spawnTimeline: STRANDLINE_542F_SPAWN_TIMELINE,
    easeRunProgress: strandline542fRunProgress,
    playerHealth: STRANDLINE_542F_PLAYER_HEALTH,
    lockRadiusNdc: 0.155,
    timing: {
      shotDelay: { gapThirtyseconds: 1, gridRampGapGrowthThirtyseconds: 1, maxGridSeconds: 0.46 },
      actionSfx: { gridThirtyseconds: 2 },
    },
    updateEnemy,
    scoreForHit(volleySize, enemy) {
      if (enemy.kind === 'parent') return 110 + volleySize * 18;
      if (enemy.kind === 'cyst') return 65 + volleySize * 8;
      return 45;
    },
    scoreForKill(volleySize, enemy) {
      const chain = 1 + Math.max(0, volleySize - 1) * 0.14;
      return Math.round(KILL_SCORE[enemy.kind] * chain);
    },
    scoreForVolley(results) {
      return results.length === 6 && results.every(({ killed }) => killed) ? 620 : 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const ratio = totalEnemies ? kills / totalEnemies : 0;
      if (parentKilled && ratio >= 0.93 && hullHits === 0) return 'LUMINOUS';
      if (parentKilled && ratio >= 0.78) return 'CLEAN CURRENT';
      if (parentKilled) return 'UNBOUND';
      if (score > 0) return 'WEBBED';
      return 'ADRIFT';
    },
    detailsForRun() {
      return [
        `BROODS ${cleansedBroods} CLEANSED${escapedBroods ? ` / ${escapedBroods} LOST` : ''}`,
        `STINGERS ${interceptedStingers} INTERCEPTED`,
        parentKilled ? 'STRANDLINE RESTORED' : 'PARENT STILL LATCHED',
      ];
    },
  };
}
