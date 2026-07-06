import { MathUtils, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { LockOnEnemy } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { CrystalEnemyKind, CrystalSpawnData, CrystalSpawnEntry, CrystalUpdate } from './gameplay';

const WARDEN_OUTER_COUNT = 6;
const WARDEN_SHIELD_COUNT = 3;
const CRYSTAL_WARDEN_DEFENSE_COUNT = WARDEN_OUTER_COUNT + WARDEN_SHIELD_COUNT;

export type WardenSpawnData =
  | { role: 'outer'; index: number }
  | { role: 'shield'; index: number }
  | { role: 'core' };

type CrystalEnemy = LockOnEnemy<CrystalEnemyKind, CrystalSpawnData>;

export function createCrystalWarden(
  bus: EventBus,
  fireBolt: (context: CrystalUpdate, from: Vector3) => void,
) {
  const corePosition = new Vector3();
  let coreId = -1;
  let coreSpawned = false;
  let coreKilled = false;
  let exposed = false;
  let defenseSpawned = 0;
  let coreEntry: CrystalSpawnEntry | undefined;
  const defenseIds = new Set<number>();
  const defensePositions = new Map<number, Vector3>();

  bus.on('runstart', () => {
    coreId = -1;
    coreSpawned = false;
    coreKilled = false;
    exposed = false;
    defenseIds.clear();
    defensePositions.clear();
    defenseSpawned = 0;
    if (coreEntry) coreEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'warden-outer' || kind === 'warden-shield') {
      defenseIds.add(enemyId);
      defenseSpawned += 1;
    }
    if (kind === 'warden-core') {
      coreSpawned = true;
      coreId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const onDefenseGone = (enemyId: number) => {
    if (!defenseIds.delete(enemyId)) return;
    defensePositions.delete(enemyId);
    if (
      defenseSpawned >= CRYSTAL_WARDEN_DEFENSE_COUNT
      && defenseIds.size === 0
      && coreSpawned
      && !exposed
      && coreEntry
    ) {
      exposed = true;
      coreEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onDefenseGone(enemyId);
    if (enemyId === coreId && !coreKilled) {
      coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onDefenseGone(enemyId);
  });

  function entries(time: number): CrystalSpawnEntry[] {
    const core: CrystalSpawnEntry = {
      time,
      kind: 'warden-core',
      hitStages: [6, 6],
      lockable: false,
      data: { role: 'core' },
    };
    coreEntry = core;
    return [
      core,
      { time: time + 0.2, kind: 'warden-outer', data: { role: 'outer', index: 0 } },
      { time: time + 0.28, kind: 'warden-outer', data: { role: 'outer', index: 1 } },
      { time: time + 0.36, kind: 'warden-outer', data: { role: 'outer', index: 2 } },
      { time: time + 0.44, kind: 'warden-outer', data: { role: 'outer', index: 3 } },
      { time: time + 0.52, kind: 'warden-outer', data: { role: 'outer', index: 4 } },
      { time: time + 0.6, kind: 'warden-outer', data: { role: 'outer', index: 5 } },
      { time: time + 0.95, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 0 } },
      { time: time + 1.08, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 1 } },
      { time: time + 1.21, kind: 'warden-shield', hitStages: [1, 1], data: { role: 'shield', index: 2 } },
    ];
  }

  function defenseBasis(camera: CrystalUpdate['camera']) {
    return {
      right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    };
  }

  function updateOuterDefense(context: CrystalUpdate, data: Extract<WardenSpawnData, { role: 'outer' }>) {
    const { enemy, runTime, camera } = context;
    const { right, up } = defenseBasis(camera);
    const angle = data.index * ((Math.PI * 2) / WARDEN_OUTER_COUNT) - runTime * 0.42;
    const breathe = 1 + Math.sin(runTime * 1.25 + data.index) * 0.045;
    enemy.mesh.position
      .copy(corePosition)
      .addScaledVector(right, Math.cos(angle) * 8.4 * breathe)
      .addScaledVector(up, Math.sin(angle) * 6.25 * breathe);
    defensePositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + runTime * 0.9);
    return false;
  }

  function updateShield(context: CrystalUpdate, data: Extract<WardenSpawnData, { role: 'shield' }>) {
    const { enemy, runTime, age, camera } = context;
    // Screen-space orbit around the core so the triangle formation always
    // reads from the rail.
    const angle = data.index * ((Math.PI * 2) / WARDEN_SHIELD_COUNT) + runTime * 0.85;
    const { right, up } = defenseBasis(camera);
    enemy.mesh.position
      .copy(corePosition)
      .addScaledVector(right, Math.cos(angle) * 4.7)
      .addScaledVector(up, Math.sin(angle) * 4.0);
    defensePositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);

    const fire = context.enemyState(() => ({ nextAt: 4.8 + data.index * 1.2, shotsLeft: Number.POSITIVE_INFINITY }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 5.4;
      fireBolt(context, enemy.mesh.position);
    }
    return false;
  }

  function updateCore(context: CrystalUpdate, _data: Extract<WardenSpawnData, { role: 'core' }>) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    // Anchored a fixed distance ahead of the camera (tangent offset, not a
    // timeline anchor) so the Warden holds the screen to the end of the rail.
    const exposedJuke = exposed ? 1 : 0;
    const sway = new Vector3(
      Math.sin(runTime * 0.5) * 3.4
        + exposedJuke * (Math.sin(runTime * 2.9) * 2.1 + Math.sin(runTime * 5.1) * 0.9),
      2.1 + Math.sin(runTime * 0.8) * 1.5
        + exposedJuke * (Math.cos(runTime * 2.6) * 1.4 + Math.sin(runTime * 4.7) * 0.65),
      28 + exposedJuke * Math.sin(runTime * 3.7) * 2.2,
    );
    corePosition.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 1), sway));
    enemy.mesh.position.copy(corePosition);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.35);

    enemy.mesh.userData.exposed = exposed;
    const shell = enemy.mesh.userData.shell as Object3D | undefined;
    if (shell && shell.visible) {
      shell.rotation.z = runTime * 1.15;
      shell.rotation.x = Math.sin(runTime * 0.4) * 0.35;
    }

    if (exposed) {
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

  function update(context: CrystalUpdate, data: WardenSpawnData) {
    switch (data.role) {
      case 'outer':
        return updateOuterDefense(context, data);
      case 'shield':
        return updateShield(context, data);
      case 'core':
        return updateCore(context, data);
    }
  }

  function validateRelease(enemies: CrystalEnemy[]): boolean | CrystalEnemy[] {
    // The outer lattice and shield plates are all real targets: the player
    // may pick them off one by one or sweep several in a volley. Only stale
    // locks on the core are denied while any defensive node remains alive.
    if (defenseIds.size === 0) return true;
    const releasedCoreIds = enemies.filter((enemy) => enemy.kind === 'warden-core').map((enemy) => enemy.id);
    if (releasedCoreIds.length === 0) return true;

    bus.emit('shielded', {
      shields: [...defenseIds].map((enemyId) => ({
        enemyId,
        worldPosition: defensePositions.get(enemyId)?.clone() ?? corePosition.clone(),
      })),
      blockedEnemyIds: releasedCoreIds,
    });
    return enemies.filter((enemy) => enemy.kind !== 'warden-core');
  }

  function summary() {
    if (!coreSpawned) return undefined;
    return coreKilled ? 'Crystal Warden destroyed' : 'Crystal Warden escaped';
  }

  return { entries, update, validateRelease, summary };
}

export type CrystalWarden = ReturnType<typeof createCrystalWarden>;
