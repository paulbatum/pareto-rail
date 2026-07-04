import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { Object3D } from 'three';
import { updateHostileShotImpact } from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import type { EventBus } from '../../events';

// Crystal Corridor debug testbed. The selected target spawns early and stays
// ahead of the camera so individual enemies and the Warden fight can be tested
// without playing through the full level.

export const CRYSTAL_RUN_DURATION = 90;
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
export type CrystalDebugTarget = 'node' | 'drifter' | 'orbiter' | 'lancer' | 'warden';

export const CRYSTAL_DEBUG_TARGETS: Array<{ id: CrystalDebugTarget; title: string }> = [
  { id: 'lancer', title: 'Lancer' },
  { id: 'warden', title: 'Crystal Warden' },
  { id: 'node', title: 'Node' },
  { id: 'drifter', title: 'Drifter' },
  { id: 'orbiter', title: 'Orbiter' },
];

export function normalizeCrystalDebugTarget(value: string | undefined): CrystalDebugTarget {
  return CRYSTAL_DEBUG_TARGETS.find((target) => target.id === value)?.id ?? 'lancer';
}

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
  | {
    role: 'wave';
    lead: number;
    pattern: CrystalMovementPattern;
    offset: Vector3;
    debugHold?: boolean;
    fireForever?: boolean;
  }
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

function debugWave(kind: Exclude<CrystalDebugTarget, 'warden'>): CrystalSpawnEntry {
  const pattern: CrystalMovementPattern = kind === 'drifter' ? 'drift' : kind === 'orbiter' ? 'orbit' : 'hold';
  return {
    time: 1.0,
    kind,
    hitStages: Array.from({ length: 12 }, () => 6),
    data: {
      role: 'wave',
      lead: 0,
      pattern,
      offset: new Vector3(0, kind === 'lancer' ? 2.8 : 1.8, 0),
      debugHold: true,
      fireForever: kind === 'lancer',
    },
  };
}

function createDebugTimeline(target: CrystalDebugTarget): CrystalSpawnEntry[] {
  const timeline: CrystalSpawnEntry[] = target === 'warden'
    ? [
      { time: 1.0, kind: 'warden-core', hitStages: [6, 6], lockable: false, data: { role: 'core' } },
      { time: 1.2, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 0 } },
      { time: 1.3, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 1 } },
      { time: 1.4, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 2 } },
    ]
    : [debugWave(target)];
  return timeline.sort((a, b) => a.time - b.time);
}

export const CRYSTAL_TIMELINE: CrystalSpawnEntry[] = createDebugTimeline('lancer');

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

export function createCrystalGameplay(
  bus: EventBus,
  target: CrystalDebugTarget = 'lancer',
): LockOnRunnerLevel<CrystalEnemyKind, CrystalSpawnData> {
  const timeline = createDebugTimeline(target);
  const coreEntry = timeline.find((entry) => entry.kind === 'warden-core');

  const boss = {
    corePosition: new Vector3(),
    coreId: -1,
    coreSpawned: false,
    coreKilled: false,
    exposed: false,
    shieldIds: new Set<number>(),
    shieldPositions: new Map<number, Vector3>(),
  };
  // Fire cadence per live enemy (lancers, shields, core), reset every run.
  const fireState = new Map<number, { nextAt: number; shotsLeft: number }>();
  const boltInterceptions = new Set<number>();
  let hitsTaken = 0;

  bus.on('runstart', () => {
    boss.coreId = -1;
    boss.coreSpawned = false;
    boss.coreKilled = false;
    boss.exposed = false;
    boss.shieldIds.clear();
    boss.shieldPositions.clear();
    fireState.clear();
    boltInterceptions.clear();
    hitsTaken = 0;
    if (coreEntry) coreEntry.lockable = false;
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
    if (boss.shieldIds.size === 0 && boss.coreSpawned && !boss.exposed && coreEntry) {
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

  function cadence(enemyId: number, firstAt: number, shots: number) {
    let state = fireState.get(enemyId);
    if (!state) {
      state = { nextAt: firstAt, shotsLeft: shots };
      fireState.set(enemyId, state);
    }
    return state;
  }

  function updateWave(context: CrystalUpdate, data: Extract<CrystalSpawnData, { role: 'wave' }>) {
    const { enemy, runTime, runProgress, age, curve, camera } = context;
    const anchorU = data.debugHold
      ? MathUtils.clamp(runProgress + 0.08, 0, 1)
      : smoothRunProgress(
        Math.min(CRYSTAL_RUN_DURATION, enemy.entry.time + data.lead),
        CRYSTAL_RUN_DURATION,
      );
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
      const fire = cadence(enemy.id, data.fireForever ? 0.8 : 1.4, data.fireForever ? Number.POSITIVE_INFINITY : 2);
      if (fire.shotsLeft > 0 && age >= fire.nextAt) {
        fire.shotsLeft -= 1;
        fire.nextAt = age + (data.fireForever ? 1.8 : 3.2);
        fireBolt(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * (0.3 + (enemy.id % 5) * 0.09) + enemy.id * 1.7);
    enemy.mesh.rotateY(Math.sin(runTime * 0.8 + enemy.id * 1.3) * 0.4);
    enemy.mesh.rotateX(Math.cos(runTime * 0.65 + enemy.id * 2.1) * 0.3);

    return !data.debugHold && runProgress > anchorU + 0.018;
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
    const speed = Math.min(11.5, 5 + age * 3.2);
    const desired = camera.position.clone().sub(data.position).normalize().multiplyScalar(speed);
    data.velocity.lerp(desired, Math.min(1, dt * 2.2));
    data.position.addScaledVector(data.velocity, dt);

    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 3.1);

    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const toBolt = data.position.clone().sub(camera.position);
    if (toBolt.dot(forward) < -3) return true;
    return age > BOLT_MAX_AGE;
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

    const fire = cadence(enemy.id, 2.2 + data.index * 1.6, Number.POSITIVE_INFINITY);
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
      const fire = cadence(enemy.id, age + 1.2, Number.POSITIVE_INFINITY);
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
    spawnTimeline: timeline,
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
