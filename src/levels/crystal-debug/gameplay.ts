import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import type { EventBus } from '../../events';

// Temporary copy of Crystal Corridor for debugging lancer behavior. The run is
// slowed down and starts with an untargetable high-health lancer that remains
// ahead of the camera long enough to make repeated firing easy to observe.

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

const DEBUG_LANCER: CrystalSpawnEntry = {
  time: 1.0,
  kind: 'lancer',
  hitPoints: 999,
  lockable: false,
  data: { role: 'wave', lead: 0, pattern: 'hold', offset: new Vector3(0, 2.8, 0) },
};

const TIMELINE: CrystalSpawnEntry[] = [DEBUG_LANCER];

export const CRYSTAL_TIMELINE: CrystalSpawnEntry[] = TIMELINE.sort((a, b) => a.time - b.time);

const KILL_SCORE: Record<CrystalEnemyKind, number> = {
  node: 100,
  drifter: 100,
  orbiter: 100,
  lancer: 150,
  bolt: 40,
  'warden-shield': 300,
  'warden-core': 1500,
};

const BOLT_HIT_DISTANCE = 2.4;
const BOLT_IMPACT_BRAKE = 0.35;
const BOLT_DAMAGE_DISTANCE = 0.65;
const BOLT_INTERCEPT_GRACE = 0.45;
const BOLT_MAX_AGE = 14;

export function createCrystalGameplay(bus: EventBus): LockOnRunnerLevel<CrystalEnemyKind, CrystalSpawnData> {
  const coreEntry = CRYSTAL_TIMELINE.find((entry) => entry.kind === 'warden-core');

  const boss = {
    corePosition: new Vector3(),
    coreId: -1,
    coreSpawned: false,
    coreKilled: false,
    exposed: false,
    shieldIds: new Set<number>(),
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
    const anchorU = enemy.kind === 'lancer'
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
      const fire = cadence(enemy.id, 0.8, Number.POSITIVE_INFINITY);
      if (fire.shotsLeft > 0 && age >= fire.nextAt) {
        fire.shotsLeft -= 1;
        fire.nextAt = age + 1.8;
        fireBolt(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * (0.3 + (enemy.id % 5) * 0.09) + enemy.id * 1.7);
    enemy.mesh.rotateY(Math.sin(runTime * 0.8 + enemy.id * 1.3) * 0.4);
    enemy.mesh.rotateX(Math.cos(runTime * 0.65 + enemy.id * 2.1) * 0.3);

    return enemy.kind !== 'lancer' && runProgress > anchorU + 0.018;
  }

  function updateBolt(context: CrystalUpdate, data: Extract<CrystalSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const forward = new Vector3();
    camera.getWorldDirection(forward);
    if (boltInterceptions.delete(enemy.id)) {
      data.interceptUntil = Math.max(data.interceptUntil ?? 0, age + BOLT_INTERCEPT_GRACE);
    }

    if (data.impactAt !== undefined) {
      const direction = data.impactDirection ?? forward;
      const brakeStart = data.impactAt - BOLT_IMPACT_BRAKE;
      const t = MathUtils.clamp((age - brakeStart) / BOLT_IMPACT_BRAKE, 0, 1);
      const eased = 1 - (1 - t) ** 2;
      const distance = MathUtils.lerp(BOLT_HIT_DISTANCE * 0.92, BOLT_DAMAGE_DISTANCE, eased);
      data.position.copy(camera.position).addScaledVector(direction, distance);
      data.velocity.set(0, 0, 0);
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 8);
      if (age >= data.impactAt && age >= (data.interceptUntil ?? -Infinity)) {
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

    if (data.position.distanceTo(camera.position) <= BOLT_HIT_DISTANCE) {
      const toBolt = data.position.clone().sub(camera.position);
      data.impactDirection = toBolt.lengthSq() > 0.0001 ? toBolt.normalize() : forward.clone();
      data.impactAt = age + BOLT_IMPACT_BRAKE;
      return false;
    }
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
    const sway = new Vector3(
      Math.sin(runTime * 0.5) * 3.4,
      2.1 + Math.sin(runTime * 0.8) * 1.5,
      28,
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
      if (boss.coreSpawned) lines.push(boss.coreKilled ? 'Warden destroyed' : 'Warden escaped');
      return lines;
    },
  };
}
