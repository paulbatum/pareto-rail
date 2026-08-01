import { Vector3 } from 'three';
import type { Object3D } from 'three';
import type { LockOnEnemy } from '../../engine/lock-on-runner';
import type { EventBus } from '../../events';
import {
  roseAnchor,
  type VespersEnemyKind,
  type VespersSpawnData,
  type VespersSpawnEntry,
  type VespersUpdate,
} from './gameplay';

const THORN_COUNT = 6;
// The thorns orbit in the clear band just inside the rose window's rim, in
// screen space around the window centre, so the ring reads as a circle
// against the glass.
const THORN_RADIUS = 12;
const THORN_VERTICAL = 0.6;

export type VespersBossState = {
  coreId: number;
  coreSpawned: boolean;
  coreKilled: boolean;
  exposed: boolean;
  thornIds: Set<number>;
  roseCentre: Vector3;
};

export function createVespersBoss(
  bus: EventBus,
  fireWisp: (context: VespersUpdate, from: Vector3) => void,
) {
  const state: VespersBossState = {
    coreId: -1,
    coreSpawned: false,
    coreKilled: false,
    exposed: false,
    thornIds: new Set<number>(),
    roseCentre: roseAnchor(),
  };

  let coreEntry: VespersSpawnEntry | undefined;
  let thornCountSpawned = 0;

  bus.on('runstart', () => {
    state.coreId = -1;
    state.coreSpawned = false;
    state.coreKilled = false;
    state.exposed = false;
    state.thornIds.clear();
    thornCountSpawned = 0;
    if (coreEntry) coreEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'thorn') {
      state.thornIds.add(enemyId);
      thornCountSpawned += 1;
    }
    if (kind === 'core') {
      state.coreSpawned = true;
      state.coreId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const onDefenseGone = (enemyId: number) => {
    if (!state.thornIds.delete(enemyId)) return;
    if (
      thornCountSpawned >= THORN_COUNT
      && state.thornIds.size === 0
      && state.coreSpawned
      && !state.exposed
      && coreEntry
    ) {
      state.exposed = true;
      coreEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onDefenseGone(enemyId);
    if (enemyId === state.coreId && !state.coreKilled) {
      state.coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onDefenseGone(enemyId);
  });

  function entries(time: number): VespersSpawnEntry[] {
    const core: VespersSpawnEntry = {
      time,
      kind: 'core',
      hitStages: [3, 3],
      lockable: false,
      data: { role: 'core' },
    };
    coreEntry = core;
    return [
      core,
      ...Array.from({ length: THORN_COUNT }, (_, index) => ({
        time: time + 0.12 + index * 0.12,
        kind: 'thorn' as const,
        hitPoints: 1,
        data: { role: 'thorn' as const, index },
      })),
    ];
  }

  function screenBasis(camera: VespersUpdate['camera']) {
    return {
      right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    };
  }

  function updateThorn(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'thorn' }>) {
    const { enemy, runTime, age, camera } = context;
    const { right, up } = screenBasis(camera);
    const angle = data.index * ((Math.PI * 2) / THORN_COUNT) - runTime * 0.42;
    const breathe = 1 + Math.sin(runTime * 1.15 + data.index * 1.7) * 0.045;
    const position = state.roseCentre
      .clone()
      .addScaledVector(right, Math.cos(angle) * THORN_RADIUS * breathe)
      .addScaledVector(up, Math.sin(angle) * THORN_RADIUS * THORN_VERTICAL * breathe);
    enemy.mesh.position.copy(position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + runTime * 0.5);

    const fire = context.enemyState(() => ({ nextAt: 4.2 + data.index * 1.2 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 9.0;
      fireWisp(context, position);
    }
    return false;
  }

  function updateCore(context: VespersUpdate, _data: Extract<VespersSpawnData, { role: 'core' }>) {
    const { enemy, runTime, age, camera } = context;
    const exposedJuke = state.exposed ? 1 : 0;
    const sway = new Vector3(
      Math.sin(runTime * 0.5) * 1.7 + exposedJuke * (Math.sin(runTime * 2.7) * 1.3),
      0.5 + Math.sin(runTime * 0.82) * 1.1 + exposedJuke * (Math.cos(runTime * 2.4) * 0.85),
      0,
    );
    const position = state.roseCentre.clone().add(sway);
    enemy.mesh.position.copy(position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.3);

    enemy.mesh.userData.exposed = state.exposed;
    const shell = enemy.mesh.userData.shell as Object3D | undefined;
    if (shell && shell.visible) {
      shell.rotation.z = runTime * 1.05;
      shell.rotation.x = Math.sin(runTime * 0.35) * 0.3;
    }

    if (state.exposed) {
      const fire = context.enemyState(() => ({ nextAt: age + 2.2 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 5.2;
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        fireWisp(context, position.clone().addScaledVector(right, 2.3));
        fireWisp(context, position.clone().addScaledVector(right, -2.3));
      }
    }
    return false;
  }

  function update(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'thorn' | 'core' }>) {
    if (data.role === 'thorn') return updateThorn(context, data);
    return updateCore(context, data);
  }

  function validateRelease(enemies: Array<LockOnEnemy<VespersEnemyKind, VespersSpawnData>>): boolean | Array<LockOnEnemy<VespersEnemyKind, VespersSpawnData>> {
    // The Devourer's core is sealed inside the rose window while any thorn
    // lives: releasing the core is denied and the thorns flare a warning.
    if (state.thornIds.size === 0) return true;
    const releasedCoreIds = enemies.filter((enemy) => enemy.kind === 'core').map((enemy) => enemy.id);
    if (releasedCoreIds.length === 0) return true;

    bus.emit('shielded', {
      shields: [...state.thornIds].map((enemyId) => ({
        enemyId,
        worldPosition: state.roseCentre.clone(),
      })),
      blockedEnemyIds: releasedCoreIds,
    });
    return enemies.filter((enemy) => enemy.kind !== 'core');
  }

  function destroyed() {
    return state.coreKilled;
  }

  function summary() {
    if (!state.coreSpawned) return undefined;
    return state.coreKilled ? 'The Devourer is slain' : 'The Devourer still feeds';
  }

  return { entries, update, validateRelease, destroyed, summary };
}

export type VespersBoss = ReturnType<typeof createVespersBoss>;
