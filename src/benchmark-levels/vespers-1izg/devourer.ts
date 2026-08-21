import { MathUtils, Vector3 } from 'three';
import type { LockOnEnemy } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { VespersEnemyKind, VespersSpawnData, VespersSpawnEntry, VespersUpdate } from './gameplay';

// The Devourer: the thing that has been eating the nave's light, nested in the
// dead rose window at the west end. It wears the run's whole arc as defense —
// a crown of six stolen-light spokes, then four petal panes that must fall in
// one sweep, and only then the heart itself, holding every colour it has
// taken. Breaking it ignites the rose.

export const SPOKE_COUNT = 6;
export const PETAL_COUNT = 4;
export const DEFENSE_COUNT = SPOKE_COUNT + PETAL_COUNT;

export type DevourerSpawnData =
  | { role: 'spoke'; index: number }
  | { role: 'petal'; index: number }
  | { role: 'heart' };

type VespersEnemy = LockOnEnemy<VespersEnemyKind, VespersSpawnData>;

export function createDevourer(
  bus: EventBus,
  fireGloom: (context: VespersUpdate, from: Vector3) => void,
) {
  const heartPosition = new Vector3();
  let heartId = -1;
  let heartSpawned = false;
  let heartKilled = false;
  let exposed = false;
  let petalsOpen = false;
  let defenseSpawned = 0;
  let heartEntry: VespersSpawnEntry | undefined;
  let petalEntries: VespersSpawnEntry[] = [];
  const spokeIds = new Set<number>();
  const petalIds = new Set<number>();
  const defenseIds = new Set<number>();
  const defensePositions = new Map<number, Vector3>();

  bus.on('runstart', () => {
    heartId = -1;
    heartSpawned = false;
    heartKilled = false;
    exposed = false;
    petalsOpen = false;
    defenseSpawned = 0;
    spokeIds.clear();
    petalIds.clear();
    defenseIds.clear();
    defensePositions.clear();
    if (heartEntry) heartEntry.lockable = false;
    for (const entry of petalEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'spoke' || kind === 'petal') {
      defenseIds.add(enemyId);
      defenseSpawned += 1;
    }
    if (kind === 'spoke') spokeIds.add(enemyId);
    if (kind === 'petal') petalIds.add(enemyId);
    if (kind === 'heart') {
      heartSpawned = true;
      heartId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const openPetals = () => {
    if (petalsOpen || spokeIds.size > 0) return;
    petalsOpen = true;
    for (const entry of petalEntries) entry.lockable = true;
  };

  const onDefenseGone = (enemyId: number) => {
    if (!defenseIds.delete(enemyId)) return;
    spokeIds.delete(enemyId);
    petalIds.delete(enemyId);
    defensePositions.delete(enemyId);
    openPetals();
    if (
      defenseSpawned >= DEFENSE_COUNT
      && defenseIds.size === 0
      && heartSpawned
      && !exposed
      && heartEntry
    ) {
      exposed = true;
      heartEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onDefenseGone(enemyId);
    if (enemyId === heartId && !heartKilled) {
      heartKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onDefenseGone(enemyId);
  });

  function entries(time: number): VespersSpawnEntry[] {
    const heart: VespersSpawnEntry = {
      time,
      kind: 'heart',
      hitStages: [3, 3],
      lockable: false,
      data: { role: 'heart' },
    };
    const petals: VespersSpawnEntry[] = [0, 1, 2, 3].map((index) => ({
      time: time + 0.85 + index * 0.13,
      kind: 'petal' as const,
      hitStages: [1, 1],
      lockable: false,
      data: { role: 'petal', index } as DevourerSpawnData,
    }));
    heartEntry = heart;
    petalEntries = petals;
    return [
      heart,
      ...[0, 1, 2, 3, 4, 5].map((index) => ({
        time: time + 0.2 + index * 0.12,
        kind: 'spoke' as const,
        data: { role: 'spoke', index } as DevourerSpawnData,
      })),
      ...petals,
    ];
  }

  function screenBasis(camera: VespersUpdate['camera']) {
    return {
      right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    };
  }

  function updateSpoke(context: VespersUpdate, data: Extract<DevourerSpawnData, { role: 'spoke' }>) {
    const { enemy, runTime, camera } = context;
    const { right, up } = screenBasis(camera);
    const angle = data.index * ((Math.PI * 2) / SPOKE_COUNT) - runTime * 0.22;
    const breathe = 1 + Math.sin(runTime * 0.9 + data.index * 1.3) * 0.04;
    enemy.mesh.position
      .copy(heartPosition)
      .addScaledVector(right, Math.cos(angle) * 9.6 * breathe)
      .addScaledVector(up, Math.sin(angle) * 9.6 * breathe);
    defensePositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle);
    return false;
  }

  function updatePetal(context: VespersUpdate, data: Extract<DevourerSpawnData, { role: 'petal' }>) {
    const { enemy, runTime, age, camera } = context;
    const { right, up } = screenBasis(camera);
    const angle = data.index * ((Math.PI * 2) / PETAL_COUNT) + runTime * 0.5;
    enemy.mesh.position
      .copy(heartPosition)
      .addScaledVector(right, Math.cos(angle) * 5.4)
      .addScaledVector(up, Math.sin(angle) * 4.6);
    defensePositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.visible = petalsOpen;
    enemy.entry.lockable = petalsOpen;
    if (!petalsOpen) return false;

    const fire = context.enemyState(() => ({ nextAt: 3.6 + data.index * 1.1 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 5.2;
      fireGloom(context, enemy.mesh.position);
    }
    return false;
  }

  function updateHeart(context: VespersUpdate, _data: Extract<DevourerSpawnData, { role: 'heart' }>) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    // Anchored a fixed distance ahead of the camera so the heart holds the
    // west end of the nave — the dead rose window behind it — to the end.
    const exposedJuke = exposed ? 1 : 0;
    const sway = new Vector3(
      Math.sin(runTime * 0.42) * 3.0
        + exposedJuke * (Math.sin(runTime * 2.6) * 1.9 + Math.sin(runTime * 4.9) * 0.8),
      1.6 + Math.sin(runTime * 0.7) * 1.3
        + exposedJuke * (Math.cos(runTime * 2.3) * 1.2 + Math.sin(runTime * 4.4) * 0.6),
      26 + exposedJuke * Math.sin(runTime * 3.4) * 1.8,
    );
    heartPosition.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 1), sway));
    enemy.mesh.position.copy(heartPosition);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.16);

    enemy.mesh.userData.exposed = exposed;

    if (exposed) {
      const fire = context.enemyState(() => ({ nextAt: age + 1.3 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 2.8;
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        fireGloom(context, enemy.mesh.position.clone().addScaledVector(right, 2.0));
        fireGloom(context, enemy.mesh.position.clone().addScaledVector(right, -2.0));
      }
    }
    return false;
  }

  function update(context: VespersUpdate, data: DevourerSpawnData) {
    switch (data.role) {
      case 'spoke':
        return updateSpoke(context, data);
      case 'petal':
        return updatePetal(context, data);
      case 'heart':
        return updateHeart(context, data);
    }
  }

  function validateRelease(enemies: VespersEnemy[]): boolean | VespersEnemy[] {
    // The petals are a linked layer: a released petal is protected unless
    // every live petal is in the same volley — take the ring in one sweep.
    // The heart is sealed while any defense still lives.
    const deniedIds = new Set<number>();
    const flashIds = new Set<number>();

    if (petalsOpen && petalIds.size > 0) {
      const releasedPetals = new Set(
        enemies.filter((enemy) => enemy.kind === 'petal').map((enemy) => enemy.id),
      );
      if (releasedPetals.size > 0) {
        const missing = [...petalIds].filter((enemyId) => !releasedPetals.has(enemyId));
        if (missing.length > 0) {
          for (const enemyId of releasedPetals) deniedIds.add(enemyId);
          for (const enemyId of missing) flashIds.add(enemyId);
        }
      }
    }

    if (defenseIds.size > 0) {
      const releasedHearts = enemies.filter((enemy) => enemy.kind === 'heart').map((enemy) => enemy.id);
      if (releasedHearts.length > 0) {
        for (const enemyId of releasedHearts) deniedIds.add(enemyId);
        for (const enemyId of defenseIds) flashIds.add(enemyId);
      }
    }

    if (deniedIds.size === 0) return true;

    bus.emit('shielded', {
      shields: [...flashIds].map((enemyId) => ({
        enemyId,
        worldPosition: defensePositions.get(enemyId)?.clone() ?? heartPosition.clone(),
      })),
      blockedEnemyIds: [...deniedIds],
    });
    return enemies.filter((enemy) => !deniedIds.has(enemy.id));
  }

  function summary() {
    if (!heartSpawned) return undefined;
    return heartKilled ? 'The Devourer is broken' : 'The Devourer fed';
  }

  return { entries, update, validateRelease, summary, isHeart: (enemyId: number) => enemyId === heartId };
}
