import { MathUtils, Vector3 } from 'three';
import type { LockOnEnemy, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { TinkerEnemyKind, TinkerSpawnData, TinkerUpdate } from './gameplay';

export type TinkerSpawnEntry = LockOnSpawnEntry<TinkerEnemyKind, TinkerSpawnData>;

// The Spill: a glue puddle at the table's end that has swallowed the act's
// props and rebuilt them as armor. Three layers, cracked one by one:
//
//   1. Six rescued objects (jar, ruler, blocks) orbiting as loose targets.
//   2. Three adhesive nodes — a linked shell: a release only bites when every
//      live node is locked in the same volley (the Warden-shield rule).
//   3. The dark heart itself, sealed until the nodes are gone, four HP per
//      stage across two stages. Every break showers the route with rescued
//      pieces for the ball to gather.

export const SPILL_ORBIT_COUNT = 6;
export const SPILL_NODE_COUNT = 3;

export type SpillSpawnData =
  | { role: 'orbit'; index: number }
  | { role: 'node'; index: number }
  | { role: 'core' };

type TinkerEnemy = LockOnEnemy<TinkerEnemyKind, TinkerSpawnData>;

export function createTinkerSpill(
  bus: EventBus,
  fireGlob: (context: TinkerUpdate, from: Vector3) => void,
) {
  const corePosition = new Vector3();
  let coreId = -1;
  let coreSpawned = false;
  let coreKilled = false;
  let coreExposed = false;
  let nodesUnlocked = false;
  let orbitSpawned = 0;
  let coreEntry: TinkerSpawnEntry | undefined;
  let nodeEntries: TinkerSpawnEntry[] = [];
  const orbitIds = new Set<number>();
  const nodeIds = new Set<number>();
  const defenseIds = new Set<number>();
  const defensePositions = new Map<number, Vector3>();

  bus.on('runstart', () => {
    coreId = -1;
    coreSpawned = false;
    coreKilled = false;
    coreExposed = false;
    nodesUnlocked = false;
    orbitSpawned = 0;
    orbitIds.clear();
    nodeIds.clear();
    defenseIds.clear();
    defensePositions.clear();
    if (coreEntry) coreEntry.lockable = false;
    for (const entry of nodeEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'spill-orbit') {
      orbitIds.add(enemyId);
      defenseIds.add(enemyId);
      orbitSpawned += 1;
    }
    if (kind === 'spill-node') {
      nodeIds.add(enemyId);
      defenseIds.add(enemyId);
    }
    if (kind === 'spill-core') {
      coreSpawned = true;
      coreId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const unlockNodes = () => {
    if (nodesUnlocked || orbitIds.size > 0 || orbitSpawned < SPILL_ORBIT_COUNT) return;
    nodesUnlocked = true;
    for (const entry of nodeEntries) entry.lockable = true;
  };

  const onDefenseGone = (enemyId: number) => {
    if (!defenseIds.delete(enemyId)) return;
    orbitIds.delete(enemyId);
    defensePositions.delete(enemyId);
    unlockNodes();
    if (
      defenseIds.size === 0
      && orbitSpawned >= SPILL_ORBIT_COUNT
      && coreSpawned
      && !coreExposed
      && coreEntry
    ) {
      coreExposed = true;
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

  function entries(time: number): TinkerSpawnEntry[] {
    const core: TinkerSpawnEntry = {
      time,
      kind: 'spill-core',
      hitStages: [4, 4],
      lockable: false,
      data: { role: 'core' },
    };
    const nodes: TinkerSpawnEntry[] = [0, 1, 2].map((index) => ({
      time: time + 0.95 + index * 0.14,
      kind: 'spill-node',
      hitStages: [1, 1],
      lockable: false,
      data: { role: 'node', index },
    }));
    coreEntry = core;
    nodeEntries = nodes;
    return [
      core,
      ...[0, 1, 2, 3, 4, 5].map((index) => ({
        time: time + 0.2 + index * 0.11,
        kind: 'spill-orbit',
        data: { role: 'orbit', index },
      })),
      ...nodes,
    ] as TinkerSpawnEntry[];
  }

  function defenseBasis(camera: TinkerUpdate['camera']) {
    return {
      right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    };
  }

  function updateOrbit(context: TinkerUpdate, data: Extract<SpillSpawnData, { role: 'orbit' }>) {
    const { enemy, runTime, age, camera } = context;
    const { right, up } = defenseBasis(camera);
    const angle = data.index * ((Math.PI * 2) / SPILL_ORBIT_COUNT) - runTime * 0.5;
    const breathe = 1 + Math.sin(runTime * 1.4 + data.index * 1.1) * 0.05;
    enemy.mesh.position
      .copy(corePosition)
      .addScaledVector(right, Math.cos(angle) * 8.6 * breathe)
      .addScaledVector(up, Math.sin(angle) * 4.4 * breathe + 1.6);
    defensePositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + runTime * 0.7);

    const fire = context.enemyState(() => ({ nextAt: 3.0 + (data.index % 3) * 1.6, shotsLeft: data.index < 3 ? 1 : 0 }));
    if (fire.shotsLeft > 0 && age >= fire.nextAt) {
      fire.shotsLeft -= 1;
      fireGlob(context, enemy.mesh.position);
    }
    return false;
  }

  function updateNode(context: TinkerUpdate, data: Extract<SpillSpawnData, { role: 'node' }>) {
    const { enemy, runTime, age, camera } = context;
    const angle = data.index * ((Math.PI * 2) / SPILL_NODE_COUNT) + runTime * 0.75;
    const { right, up } = defenseBasis(camera);
    enemy.mesh.position
      .copy(corePosition)
      .addScaledVector(right, Math.cos(angle) * 5.6)
      .addScaledVector(up, Math.sin(angle) * 3.6 + 1.2);
    defensePositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.visible = nodesUnlocked;
    enemy.entry.lockable = nodesUnlocked;
    if (!nodesUnlocked) return false;

    const fire = context.enemyState(() => ({ nextAt: 4.8 + data.index * 1.3, shotsLeft: Number.POSITIVE_INFINITY }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 6.0;
      fireGlob(context, enemy.mesh.position);
    }
    return false;
  }

  function updateCore(context: TinkerUpdate, _data: Extract<SpillSpawnData, { role: 'core' }>) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    // Anchored a fixed distance ahead of the camera so the Spill holds the
    // screen until the rail runs out.
    const exposedJuke = coreExposed ? 1 : 0;
    const sway = new Vector3(
      Math.sin(runTime * 0.55) * 3.2
        + exposedJuke * (Math.sin(runTime * 2.7) * 1.9 + Math.sin(runTime * 4.9) * 0.8),
      1.4 + Math.sin(runTime * 0.85) * 1.3
        + exposedJuke * (Math.cos(runTime * 2.4) * 1.2 + Math.sin(runTime * 4.3) * 0.6),
      21 + exposedJuke * Math.sin(runTime * 3.5) * 2.0,
    );
    corePosition.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 1), sway));
    enemy.mesh.position.copy(corePosition);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.3);

    enemy.mesh.userData.exposed = coreExposed;

    if (coreExposed) {
      const fire = context.enemyState(() => ({ nextAt: age + 1.6, shotsLeft: Number.POSITIVE_INFINITY }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 3.4;
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        fireGlob(context, enemy.mesh.position.clone().addScaledVector(right, 2.1));
        fireGlob(context, enemy.mesh.position.clone().addScaledVector(right, -2.1));
      }
    }
    return false;
  }

  function update(context: TinkerUpdate, data: SpillSpawnData) {
    switch (data.role) {
      case 'orbit':
        return updateOrbit(context, data);
      case 'node':
        return updateNode(context, data);
      case 'core':
        return updateCore(context, data);
    }
  }

  function validateRelease(enemies: TinkerEnemy[]): boolean | TinkerEnemy[] {
    // Nodes are a linked shell: any released node is protected unless every
    // live node is in the same volley. The core is denied while any defense
    // remains. Mixed releases (globs, stragglers) still fire.
    const deniedIds = new Set<number>();
    const flashIds = new Set<number>();

    if (nodesUnlocked && nodeIds.size > 0) {
      const releasedNodeIds = new Set(
        enemies.filter((enemy) => enemy.kind === 'spill-node').map((enemy) => enemy.id),
      );
      if (releasedNodeIds.size > 0) {
        const missing = [...nodeIds].filter((enemyId) => !releasedNodeIds.has(enemyId));
        if (missing.length > 0) {
          for (const enemyId of releasedNodeIds) deniedIds.add(enemyId);
          for (const enemyId of missing) flashIds.add(enemyId);
        }
      }
    }

    if (defenseIds.size > 0) {
      for (const enemy of enemies.filter((candidate) => candidate.kind === 'spill-core')) {
        deniedIds.add(enemy.id);
      }
      for (const enemyId of defenseIds) flashIds.add(enemyId);
    }

    if (deniedIds.size === 0) return true;

    bus.emit('shielded', {
      shields: [...flashIds].map((enemyId) => ({
        enemyId,
        worldPosition: defensePositions.get(enemyId)?.clone() ?? corePosition.clone(),
      })),
      blockedEnemyIds: [...deniedIds],
    });
    return enemies.filter((enemy) => !deniedIds.has(enemy.id));
  }

  function summary() {
    if (!coreSpawned) return undefined;
    return coreKilled ? 'The Spill cleaned up' : 'The Spill remains';
  }

  return { entries, update, validateRelease, summary, coreKilled: () => coreKilled };
}

export type TinkerSpill = ReturnType<typeof createTinkerSpill>;
