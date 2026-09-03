import { MathUtils, Vector3 } from 'three';
import type { CatmullRomCurve3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { TinkerSpawnEntry, TinkerUpdate } from './gameplay';

// THE SPILL — a glue spill spreading across the table ahead of the ball. It
// raises three dark cores one at a time, each wearing shells of swallowed
// supplies: the left core first, then the right, then the heart. Every broken
// shell showers the road with rescued pieces. When the heart goes, the spill
// freezes where it is, snaps clean, and the ball rolls through the spot.
//
// The puddle itself rides an invisible anchor enemy that sits behind the
// camera; it never counts, never locks, and exists so the fight has a driver
// between cores (only living enemies get updated).

export type SpillCoreData = { role: 'core'; index: number };
export type SpillAnchorData = { role: 'spill' };

/** Lateral offset and height above the table for each core, in world units at melon scale. */
export const SPILL_CORE_OFFSETS: Array<[x: number, y: number]> = [[-11.5, 4.6], [11.5, 4.6], [0, 9.2]];
export const SPILL_CORE_STAGES: number[][] = [[2, 2], [2, 3], [3, 3]];
export const SPILL_AHEAD = 30;
export const SPILL_RADIUS = 15;
const CORE_EMERGE_DELAY = 1.3;

export type SpillState = {
  spawned: boolean;
  alive: boolean;
  frozen: boolean;
  /** Puddle center on the table. */
  center: Vector3;
  right: Vector3;
  tangent: Vector3;
  activeIndex: number;
  coreAlive: boolean[];
  corePositions: Vector3[];
  /** Puddle spread multiplier: grows while alive, collapses after the snap. */
  spread: number;
  /** Run time the last core died, or -1. */
  snappedAt: number;
  runTime: number;
};

// Module singleton read by the visuals every frame; one runtime exists at a time.
export const spillState: SpillState = {
  spawned: false,
  alive: false,
  frozen: false,
  center: new Vector3(0, 0, -1000),
  right: new Vector3(1, 0, 0),
  tangent: new Vector3(0, 0, -1),
  activeIndex: 0,
  coreAlive: [false, false, false],
  corePositions: [new Vector3(), new Vector3(), new Vector3()],
  spread: 1,
  snappedAt: -1,
  runTime: 0,
};

type SpillOptions = {
  curve: CatmullRomCurve3;
  fireGlob(context: TinkerUpdate, from: Vector3, scale: number): void;
};

export function createSpill(bus: EventBus, options: SpillOptions) {
  const coreIds = new Map<number, number>(); // enemy id → core index
  let spawnedAt = -1;
  let spawnCount = 0;
  let nextCoreAt = -1;
  let snapped = false;
  const forward = new Vector3();

  function reset() {
    spillState.spawned = false;
    spillState.alive = false;
    spillState.frozen = false;
    spillState.activeIndex = 0;
    spillState.coreAlive = [false, false, false];
    spillState.spread = 1;
    spillState.snappedAt = -1;
    spillState.center.set(0, 0, -1000);
    coreIds.clear();
    spawnedAt = -1;
    spawnCount = 0;
    nextCoreAt = -1;
    snapped = false;
  }

  bus.on('runstart', reset);

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'spill-core') return;
    const index = spawnCount % SPILL_CORE_STAGES.length;
    spawnCount += 1;
    coreIds.set(enemyId, index);
    spillState.coreAlive[index] = true;
    spillState.activeIndex = index;
    if (index === 0) bus.emit('bossphase', { phase: 'summoned' });
    if (index === 2) bus.emit('bossphase', { phase: 'exposed' });
  });

  const onCoreGone = (enemyId: number, killed: boolean) => {
    const index = coreIds.get(enemyId);
    if (index === undefined) return;
    coreIds.delete(enemyId);
    spillState.coreAlive[index] = false;
    if (!killed) return;
    if (index < SPILL_CORE_STAGES.length - 1) {
      nextCoreAt = spillState.runTime + CORE_EMERGE_DELAY;
      return;
    }
    snapped = true;
    spillState.alive = false;
    spillState.frozen = true;
    spillState.snappedAt = spillState.runTime;
    bus.emit('bossphase', { phase: 'destroyed' });
  };

  bus.on('kill', ({ enemyId }) => onCoreGone(enemyId, true));
  bus.on('miss', ({ enemyId }) => onCoreGone(enemyId, false));

  function entries(time: number): TinkerSpawnEntry[] {
    return [{ time, kind: 'spill', countsTowardTotal: false, lockable: false, data: { role: 'spill' } }];
  }

  function spawnCore(context: TinkerUpdate, index: number) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'spill-core',
      hitStages: SPILL_CORE_STAGES[index],
      data: { role: 'core', index },
    });
  }

  /** The puddle driver: rides ahead of the camera, raises the next core, freezes on the snap. */
  function updateAnchor(context: TinkerUpdate) {
    const { enemy, runTime, runProgress, camera, age } = context;
    spillState.runTime = runTime;
    // Keep the anchor behind the camera so it is never a visible target.
    camera.getWorldDirection(forward);
    enemy.mesh.position.copy(camera.position).addScaledVector(forward, -25);
    enemy.entry.lockable = false;

    if (spawnedAt < 0) {
      spawnedAt = runTime;
      spillState.spawned = true;
      spillState.alive = true;
      nextCoreAt = runTime + 0.25;
    }

    if (!spillState.frozen) {
      const frame = sampleRailFrame(options.curve, MathUtils.clamp(runProgress, 0, 1));
      spillState.center
        .copy(frame.position)
        .addScaledVector(frame.tangent, SPILL_AHEAD)
        .addScaledVector(frame.right, Math.sin(runTime * 0.45) * 3);
      spillState.center.y = 0;
      spillState.right.copy(frame.right);
      spillState.tangent.copy(frame.tangent);
      spillState.spread = 1 + 0.35 * Math.min(1, age / 14);
    }

    if (nextCoreAt >= 0 && runTime >= nextCoreAt && !snapped) {
      const index = spawnCount;
      nextCoreAt = -1;
      if (index < SPILL_CORE_STAGES.length) spawnCore(context, index);
    }
    return snapped && runTime - spillState.snappedAt > 3;
  }

  function update(context: TinkerUpdate, data: SpillCoreData) {
    const { enemy, runTime, camera, age } = context;
    const active = spillState.alive && data.index === spillState.activeIndex;
    // Unlockable while it emerges from the glue; the halo lights when it is fair game.
    enemy.entry.lockable = active && age >= 0.9;
    enemy.mesh.userData.emerged = age >= 0.9;
    const [ox, oy] = SPILL_CORE_OFFSETS[data.index];
    const wobble = active ? Math.sin(runTime * 5.1 + data.index) * 0.45 : 0;
    const bob = Math.sin(runTime * 1.3 + data.index * 2.1) * 0.5;
    // Emerges from the puddle over 1.4 s.
    const spawnLift = MathUtils.smoothstep(Math.min(1, age / 1.4), 0, 1);
    const position = spillState.center.clone()
      .addScaledVector(spillState.right, ox * spillState.spread + wobble)
      .addScaledVector(spillState.tangent, -Math.abs(ox) * 0.12);
    position.y = (oy + bob) * spawnLift + 0.4;
    enemy.mesh.position.copy(position);
    spillState.corePositions[data.index].copy(position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.6 + data.index) * 0.12);
    enemy.mesh.scale.setScalar(0.3 + 0.7 * spawnLift);
    enemy.mesh.userData.active = active;
    enemy.mesh.userData.spawnLift = spawnLift;

    if (active && age > 2) {
      const spit = context.enemyState(() => ({ nextAt: age + 1.2 }));
      if (age >= spit.nextAt) {
        const heart = data.index === 2;
        spit.nextAt = age + (heart ? 4.6 : 5.2);
        if (heart) {
          for (const side of [-1, 1]) {
            options.fireGlob(context, position.clone().addScaledVector(spillState.right, side * 2.4), 4.8);
          }
        } else {
          options.fireGlob(context, position.clone(), 4.8);
        }
      }
    }
    return false;
  }

  function summary() {
    if (!spillState.spawned) return undefined;
    return snapped ? 'The Spill snapped clean' : 'The Spill is still spreading';
  }

  return {
    entries,
    updateAnchor,
    update,
    summary,
    snapped: () => snapped,
  };
}

export type Spill = ReturnType<typeof createSpill>;
