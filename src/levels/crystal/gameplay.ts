import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { Object3D } from 'three';
import { shotBehindCamera, steerHomingShot, updateHostileShotImpact } from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';

// A 45-second run in three acts: a familiar warm-up third, a dense middle
// where lancers start shooting back, and the Crystal Warden holding the final
// stretch. The player has a 3-point hull; shard bolts home in on the camera
// and must be shot down before they land.

export const CRYSTAL_RUN_DURATION = 45;
export const CRYSTAL_PLAYER_HEALTH = 3;

export type CrystalEnemyKind =
  | 'node'
  | 'drifter'
  | 'orbiter'
  | 'lancer'
  | 'bolt'
  | 'warden-shield'
  | 'warden-core';
export type CrystalTargetKind = CrystalEnemyKind | 'letter';
export type CrystalMovementPattern = 'hold' | 'drift' | 'orbit';

// Timeline entries carry immutable config only — the engine reuses the
// timeline across runs. Per-enemy runtime state (fire cadence) lives in a
// closure map keyed by enemy id; bolts are spawned dynamically with fresh
// data objects, so theirs may mutate.
export type CrystalSpawnData =
  | {
    role: 'bolt';
    position: Vector3;
    velocity: Vector3;
    lastAge: number;
    impactAt?: number;
    impactDirection?: Vector3;
    interceptUntil?: number;
  }
  | { role: 'wave'; lead: number; pattern: CrystalMovementPattern; offset: Vector3 }
  | { role: 'shield'; index: number }
  | { role: 'core' };

type CrystalSpawnEntry = LockOnSpawnEntry<CrystalEnemyKind, CrystalSpawnData>;
type CrystalUpdate = LockOnEnemyUpdate<CrystalEnemyKind, CrystalSpawnData>;

export function createCrystalRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 2, -24),
      new Vector3(14, -1, -54),
      new Vector3(-10, 5, -86),
      new Vector3(-22, -2, -118),
      new Vector3(6, 3, -152),
      new Vector3(24, 8, -184),
      new Vector3(-4, 0, -220),
      new Vector3(-18, 6, -254),
      new Vector3(-6, -4, -288),
      new Vector3(14, 3, -320),
      new Vector3(4, 6, -350),
      new Vector3(0, 3, -380),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

const wave = (
  time: number,
  lead: number,
  pattern: CrystalMovementPattern,
  kind: CrystalEnemyKind,
  offsets: Array<[number, number]>,
): CrystalSpawnEntry[] => formation(time, 0.18, offsets, (offset) => ({
  kind,
  data: { role: 'wave', lead, pattern, offset: new Vector3(offset[0], offset[1], 0) },
}));

const lancers = (time: number, lead: number, offsets: Array<[number, number]>): CrystalSpawnEntry[] =>
  wave(time, lead, 'hold', 'lancer', offsets);

const BOSS_TIME = 30.2;

const TIMELINE: CrystalSpawnEntry[] = [
  // --- Act 1 (0–10s): the familiar opening. Room to learn the sweep.
  ...section(0,
    wave(1.2, 4.0, 'hold', 'node', [
      [-5, 1], [-2, 3], [2, 3], [5, 1],
    ]),
    wave(4.2, 4.6, 'drift', 'drifter', [
      [-8, -1], [-4, 2], [0, 3], [4, 2], [8, -1],
    ]),
    wave(7.4, 4.8, 'orbit', 'orbiter', [
      [-6, 4], [-3, 0], [3, 0], [6, 4],
    ]),
  ),

  // --- Act 2 (10–30s): the corridor wakes up. Times are relative to the act;
  // lancers are haloed crystals that fire homing shard bolts at the hull.
  ...section(10,
    wave(0.6, 4.3, 'drift', 'drifter', [
      [-7, 2], [-3, -2], [2, 1], [7, -1],
    ]),
    wave(3.2, 4.6, 'hold', 'node', [
      [-7, -1], [-3.5, 2], [0, 3.5], [3.5, 2], [7, -1],
    ]),
    lancers(4.4, 5.0, [[0, 5.4]]),
    wave(6.4, 4.7, 'orbit', 'orbiter', [
      [-9, 2], [-4.5, 5], [0, 2], [4.5, 5], [9, 2],
    ]),
    wave(8.8, 4.4, 'drift', 'drifter', [
      [-7, 0], [-2, 3], [2, -1], [7, 2],
    ]),
    lancers(9.6, 5.2, [[-6, 4], [6, 4]]),
    wave(11.6, 4.5, 'hold', 'node', [
      [-7.5, 4], [-5, 1.5], [-2.5, -1], [2.5, -1], [5, 1.5], [7.5, 4],
    ]),
    wave(13.8, 4.6, 'orbit', 'orbiter', [
      [-8, -1], [-3, 3], [3, 3], [8, -1],
    ]),
    lancers(14.6, 4.8, [[-5, -2], [5, -2]]),
    wave(16.2, 4.2, 'drift', 'drifter', [
      [-8, 1], [-5, -2], [-1.5, 3], [1.5, -1], [5, 2], [8, -1],
    ]),
    lancers(18.2, 4.4, [[-3, 5], [3, 5]]),
    wave(19.2, 3.4, 'hold', 'node', [
      [-4, 2], [0, 4], [4, 2],
    ]),
  ),

  // --- Act 3 (30s–end): the Crystal Warden. Times are relative to BOSS_TIME;
  // shield plates break through two 1-HP stages before the core takes two full volleys.
  ...section(BOSS_TIME, [
    { time: 0, kind: 'warden-core', hitStages: [6, 6], lockable: false, data: { role: 'core' } },
    { time: 0.2, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 0 } },
    { time: 0.3, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 1 } },
    { time: 0.4, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 2 } },
  ] satisfies CrystalSpawnEntry[]),
];

export const CRYSTAL_TIMELINE: CrystalSpawnEntry[] = sortTimeline(TIMELINE);

const KILL_SCORE: Record<CrystalEnemyKind, number> = {
  node: 100,
  drifter: 100,
  orbiter: 100,
  lancer: 150,
  bolt: 40,
  'warden-shield': 300,
  'warden-core': 1500,
};

const BOLT_MAX_AGE = 14;

export function createCrystalGameplay(bus: EventBus): LockOnRunnerLevel<CrystalEnemyKind, CrystalSpawnData> {
  const coreEntry = CRYSTAL_TIMELINE.find((entry) => entry.kind === 'warden-core');
  if (!coreEntry) throw new Error('Crystal timeline is missing the warden core');

  const boss = {
    corePosition: new Vector3(),
    coreId: -1,
    coreSpawned: false,
    coreKilled: false,
    exposed: false,
    shieldIds: new Set<number>(),
    shieldPositions: new Map<number, Vector3>(),
  };
  const boltInterceptions = new Set<number>();
  let hitsTaken = 0;

  bus.on('runstart', () => {
    boss.coreId = -1;
    boss.coreSpawned = false;
    boss.coreKilled = false;
    boss.exposed = false;
    boss.shieldIds.clear();
    boss.shieldPositions.clear();
    boltInterceptions.clear();
    hitsTaken = 0;
    coreEntry.lockable = false;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    boltInterceptions.add(enemyId);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'warden-shield') boss.shieldIds.add(enemyId);
    if (kind === 'warden-core') {
      boss.coreSpawned = true;
      boss.coreId = enemyId;
    }
  });

  const onShieldGone = (enemyId: number) => {
    if (!boss.shieldIds.delete(enemyId)) return;
    boss.shieldPositions.delete(enemyId);
    if (boss.shieldIds.size === 0 && boss.coreSpawned && !boss.exposed) {
      boss.exposed = true;
      coreEntry.lockable = true;
    }
  };

  bus.on('kill', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
    onShieldGone(enemyId);
    if (enemyId === boss.coreId) boss.coreKilled = true;
  });

  bus.on('miss', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
    onShieldGone(enemyId);
  });

  function fireBolt(context: CrystalUpdate, from: Vector3) {
    const initial = context.camera.position.clone().sub(from).normalize().multiplyScalar(4.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0 },
    });
  }

  function updateWave(context: CrystalUpdate, data: Extract<CrystalSpawnData, { role: 'wave' }>) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    if (data.pattern === 'drift') {
      offset.x += Math.sin(age * 0.85 + enemy.id) * 1.3 + age * 0.55;
      offset.y += Math.cos(age * 0.65 + enemy.id * 0.5) * 0.55;
    } else if (data.pattern === 'orbit') {
      offset.x += Math.cos(age * 2.2 + enemy.id) * 2.1;
      offset.y += Math.sin(age * 2.2 + enemy.id) * 2.1;
    }

    if (enemy.kind === 'lancer') {
      // Menace pulse: a slow push toward the camera sells intent.
      offset.z = Math.sin(age * 1.5) * 0.9;
      const fire = context.enemyState(() => ({ nextAt: 1.4, shotsLeft: 2 }));
      if (fire.shotsLeft > 0 && age >= fire.nextAt) {
        fire.shotsLeft -= 1;
        fire.nextAt = age + 3.2;
        fireBolt(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * (0.3 + (enemy.id % 5) * 0.09) + enemy.id * 1.7);
    enemy.mesh.rotateY(Math.sin(runTime * 0.8 + enemy.id * 1.3) * 0.4);
    enemy.mesh.rotateX(Math.cos(runTime * 0.65 + enemy.id * 2.1) * 0.3);

    return runProgress > anchorU + 0.018;
  }

  function updateBolt(context: CrystalUpdate, data: Extract<CrystalSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: boltInterceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Ballistic launch that tightens into a homing run; speed ramps so the
    // player gets a beat to read it before it commits.
    steerHomingShot(data.position, data.velocity, camera.position, age, dt, {
      baseSpeed: 5,
      maxSpeed: 11.5,
      accel: 3.2,
      turnRate: 2.2,
    });

    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 3.1);

    return shotBehindCamera(camera, data.position) || age > BOLT_MAX_AGE;
  }

  function updateShield(context: CrystalUpdate, data: Extract<CrystalSpawnData, { role: 'shield' }>) {
    const { enemy, runTime, age, camera } = context;
    // Screen-space orbit around the core so the triangle formation always
    // reads from the rail.
    const angle = data.index * ((Math.PI * 2) / 3) + runTime * 0.85;
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    enemy.mesh.position
      .copy(boss.corePosition)
      .addScaledVector(right, Math.cos(angle) * 4.7)
      .addScaledVector(up, Math.sin(angle) * 4.0);
    boss.shieldPositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);

    const fire = context.enemyState(() => ({ nextAt: 2.2 + data.index * 1.6, shotsLeft: Number.POSITIVE_INFINITY }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 4.6;
      fireBolt(context, enemy.mesh.position);
    }
    return false;
  }

  function updateCore(context: CrystalUpdate, _data: Extract<CrystalSpawnData, { role: 'core' }>) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    // Anchored a fixed distance ahead of the camera (tangent offset, not a
    // timeline anchor) so the Warden holds the screen to the end of the rail.
    const exposedJuke = boss.exposed ? 1 : 0;
    const sway = new Vector3(
      Math.sin(runTime * 0.5) * 3.4
        + exposedJuke * (Math.sin(runTime * 2.9) * 2.1 + Math.sin(runTime * 5.1) * 0.9),
      2.1 + Math.sin(runTime * 0.8) * 1.5
        + exposedJuke * (Math.cos(runTime * 2.6) * 1.4 + Math.sin(runTime * 4.7) * 0.65),
      28 + exposedJuke * Math.sin(runTime * 3.7) * 2.2,
    );
    boss.corePosition.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 1), sway));
    enemy.mesh.position.copy(boss.corePosition);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.35);

    enemy.mesh.userData.exposed = boss.exposed;
    const shell = enemy.mesh.userData.shell as Object3D | undefined;
    if (shell && shell.visible) {
      shell.rotation.z = runTime * 1.15;
      shell.rotation.x = Math.sin(runTime * 0.4) * 0.35;
    }

    if (boss.exposed) {
      const fire = context.enemyState(() => ({ nextAt: age + 1.2, shotsLeft: Number.POSITIVE_INFINITY }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 2.7;
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        fireBolt(context, enemy.mesh.position.clone().addScaledVector(right, 2.2));
        fireBolt(context, enemy.mesh.position.clone().addScaledVector(right, -2.2));
      }
    }
    return false;
  }

  return {
    duration: CRYSTAL_RUN_DURATION,
    playerHealth: CRYSTAL_PLAYER_HEALTH,
    createRail: createCrystalRail,
    spawnTimeline: CRYSTAL_TIMELINE,
    easeRunProgress: smoothRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'shield':
          return updateShield(context, data);
        case 'core':
          return updateCore(context, data);
      }
    },
    validateRelease(enemies) {
      const releasedShieldIds = new Set(
        enemies.filter((enemy) => enemy.kind === 'warden-shield').map((enemy) => enemy.id),
      );
      if (releasedShieldIds.size === 0 || boss.shieldIds.size === 0) return true;

      const missingShieldIds = [...boss.shieldIds].filter((enemyId) => !releasedShieldIds.has(enemyId));
      if (missingShieldIds.length === 0) return true;

      bus.emit('shielded', {
        shields: missingShieldIds.map((enemyId) => ({
          enemyId,
          worldPosition: boss.shieldPositions.get(enemyId)?.clone() ?? boss.corePosition.clone(),
        })),
        blockedEnemyIds: [...releasedShieldIds],
      });
      return false;
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Armor chips (non-lethal hits on shields and the core) pay a little.
    scoreForHit: () => 40,
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 9200 && clearRate >= 0.88) return 'S';
      if (score >= 6800 && clearRate >= 0.72) return 'A';
      if (score >= 4400 && clearRate >= 0.5) return 'B';
      if (score >= 2000 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, CRYSTAL_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${CRYSTAL_PLAYER_HEALTH}`];
      if (boss.coreSpawned) lines.push(boss.coreKilled ? 'Crystal Warden destroyed' : 'Crystal Warden escaped');
      return lines;
    },
  };
}
