import { Vector3 } from 'three';
import type { LockOnEnemy } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { BROADSIDE_7HIN_BARS, BROADSIDE_7HIN_TIME } from './timing';
import type {
  BroadsideBossData,
  BroadsideEnemyKind,
  BroadsideSpawnData,
  BroadsideSpawnEntry,
  BroadsideUpdate,
} from './gameplay';

// The enemy flagship fight, in two phases. Phase one: the rail runs the
// flagship's flank and three shield generators must fall while its point-
// defense emitters fill the space around the player. When every generator
// resolves (killed or passed), the shield drops, escort waves pour in as the
// rail comes around, and the power conduits inside the flagship's trench
// become targetable. The last conduit detonating ends the battle.

const GENERATOR_COUNT = 3;
const CONDUIT_COUNT = 3;

type BroadsideEnemy = LockOnEnemy<BroadsideEnemyKind, BroadsideSpawnData>;

export function createFlagship(bus: EventBus, fireBolt: (context: BroadsideUpdate, from: Vector3, spread?: number) => void) {
  const fallbackPosition = new Vector3();
  const liveGenerators = new Set<number>();
  const liveConduits = new Set<number>();
  const defensePositions = new Map<number, Vector3>();
  let generatorsSpawned = 0;
  let conduitsSpawned = 0;
  let shieldsDown = false;
  let destroyed = false;
  let armed = false;
  let conduitEntries: BroadsideSpawnEntry[] = [];

  bus.on('runstart', () => {
    liveGenerators.clear();
    liveConduits.clear();
    defensePositions.clear();
    generatorsSpawned = 0;
    conduitsSpawned = 0;
    shieldsDown = false;
    destroyed = false;
    // Timeline entries are shared across runs; put the shield back up.
    for (const entry of conduitEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!armed) return;
    if (kind === 'generator') {
      liveGenerators.add(enemyId);
      generatorsSpawned += 1;
      defensePositions.set(enemyId, fallbackPosition.clone());
    }
    if (kind === 'conduit') {
      liveConduits.add(enemyId);
      conduitsSpawned += 1;
    }
  });

  const dropShields = () => {
    if (shieldsDown || liveGenerators.size > 0 || generatorsSpawned < GENERATOR_COUNT) return;
    shieldsDown = true;
    for (const entry of conduitEntries) entry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  };

  const onDefenseGone = (enemyId: number) => {
    if (liveGenerators.delete(enemyId)) {
      defensePositions.delete(enemyId);
      dropShields();
    }
    liveConduits.delete(enemyId);
  };

  bus.on('kill', ({ enemyId }) => {
    onDefenseGone(enemyId);
    if (!destroyed && shieldsDown && conduitsSpawned >= CONDUIT_COUNT && liveConduits.size === 0) {
      destroyed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onDefenseGone(enemyId);
    if (!destroyed && shieldsDown && conduitsSpawned >= CONDUIT_COUNT && liveConduits.size === 0) {
      destroyed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  function entries(flagshipTime: number): BroadsideSpawnEntry[] {
    armed = true;
    // Times are authored relative to the bar-24 flagship marker so the whole
    // fight stays locked to the arrangement grid.
    const bar = (value: number, beat = 0) =>
      flagshipTime + BROADSIDE_7HIN_TIME.bar(value - BROADSIDE_7HIN_BARS.flagship, beat);

    const generators: BroadsideSpawnEntry[] = [
      { time: bar(24.25), kind: 'generator', hitStages: [1, 1], data: { role: 'generator', index: 0, lead: 4.9, x: -7.5, y: 3.5 } },
      { time: bar(24.4), kind: 'generator', hitStages: [1, 1], data: { role: 'generator', index: 1, lead: 4.9, x: 0.5, y: 5.5 } },
      { time: bar(24.55), kind: 'generator', hitStages: [1, 1], data: { role: 'generator', index: 2, lead: 4.9, x: 8.5, y: 2 } },
    ];
    const pointDefense: BroadsideSpawnEntry[] = [
      { time: bar(24.8), kind: 'pdturret', hitPoints: 1, data: { role: 'pd', index: 0, lead: 4.2, x: -4, y: -2.5 } },
      { time: bar(24.95), kind: 'pdturret', hitPoints: 1, data: { role: 'pd', index: 1, lead: 4.2, x: 5, y: 4.5 } },
      { time: bar(26.1), kind: 'pdturret', hitPoints: 1, data: { role: 'pd', index: 2, lead: 4.0, x: 0, y: 0.5 } },
    ];
    const conduits: BroadsideSpawnEntry[] = [
      { time: bar(28.7), kind: 'conduit', hitPoints: 1, lockable: false, data: { role: 'conduit', index: 0, lead: 5, x: -4.2, y: 0.4 } },
      { time: bar(28.85), kind: 'conduit', hitPoints: 1, lockable: false, data: { role: 'conduit', index: 1, lead: 5, x: 0, y: 1.2 } },
      { time: bar(29), kind: 'conduit', hitPoints: 1, lockable: false, data: { role: 'conduit', index: 2, lead: 5, x: 4.2, y: 0.4 } },
    ];
    conduitEntries = conduits;
    return [...generators, ...pointDefense, ...conduits];
  }

  function updateGenerator(context: BroadsideUpdate, data: Extract<BroadsideBossData, { role: 'generator' }>) {
    const { enemy, runTime, age, camera } = context;
    const anchorU = context.railAnchor(data.lead);
    const bob = Math.sin(runTime * 0.9 + data.index * 2.1) * 0.35;
    enemy.mesh.position.copy(offsetFromRail(context.curve, anchorU, new Vector3(data.x, data.y + bob, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.spin = runTime;
    defensePositions.set(enemy.id, enemy.mesh.position.clone());

    const fire = context.enemyState(() => ({ nextAt: 1.6 + data.index * 0.7 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 3.4;
      fireBolt(context, enemy.mesh.position.clone(), 0.8);
    }
    return context.runProgress > anchorU + 0.02;
  }

  function updatePointDefense(context: BroadsideUpdate, data: Extract<BroadsideBossData, { role: 'pd' }>) {
    const { enemy, age, camera } = context;
    const anchorU = context.railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(context.curve, anchorU, new Vector3(data.x, data.y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.spin = age * 1.4;
    defensePositions.set(enemy.id, enemy.mesh.position.clone());

    const fire = context.enemyState(() => ({ nextAt: 1.2 + data.index * 0.5 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 2.4;
      fireBolt(context, enemy.mesh.position.clone(), 0.4);
    }
    return context.runProgress > anchorU + 0.02;
  }

  function updateConduit(context: BroadsideUpdate, data: Extract<BroadsideBossData, { role: 'conduit' }>) {
    const { enemy, runTime, camera } = context;
    const anchorU = context.railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(context.curve, anchorU, new Vector3(data.x, data.y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.pulse = runTime;
    enemy.entry.lockable = shieldsDown;
    enemy.mesh.userData.shielded = !shieldsDown;
    return false;
  }

  function update(context: BroadsideUpdate, data: BroadsideBossData) {
    switch (data.role) {
      case 'generator':
        return updateGenerator(context, data);
      case 'pd':
        return updatePointDefense(context, data);
      case 'conduit':
        return updateConduit(context, data);
    }
  }

  function validateRelease(enemies: BroadsideEnemy[]): boolean | BroadsideEnemy[] {
    // Power conduits live behind the shield: releasing one while any shield
    // generator is still live is denied, and the surviving generators flash.
    if (shieldsDown) return true;
    const releasedConduits = enemies.filter((enemy) => enemy.kind === 'conduit');
    if (releasedConduits.length === 0) return true;
    const blockedIds = new Set(releasedConduits.map((enemy) => enemy.id));
    bus.emit('shielded', {
      shields: [...liveGenerators].map((enemyId) => ({
        enemyId,
        worldPosition: defensePositions.get(enemyId)?.clone() ?? fallbackPosition.clone(),
      })),
      blockedEnemyIds: [...blockedIds],
    });
    return enemies.filter((enemy) => !blockedIds.has(enemy.id));
  }

  function summary(): string | undefined {
    if (generatorsSpawned === 0 && conduitsSpawned === 0) return undefined;
    if (destroyed) return 'Enemy flagship destroyed';
    if (shieldsDown) return 'The flagship broke away';
    return 'The flagship held its shield';
  }

  return {
    entries,
    update,
    validateRelease,
    summary,
    get shieldsDown() {
      return shieldsDown;
    },
    get destroyed() {
      return destroyed;
    },
  };
}

export type Flagship = ReturnType<typeof createFlagship>;
