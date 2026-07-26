import { MathUtils, Vector3 } from 'three';
import type { LockOnEnemy } from '../../engine/lock-on-runner';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { TinkerEnemyKind, TinkerSpawnData, TinkerSpawnEntry, TinkerUpdate } from './gameplay';

// The finale: a glue spill in the middle of the table that has been eating the
// supplies around it. Three crusts of recycled junk cover three cores, and the
// heart sits under all of it.
//
// Nothing here is ever unlockable — an unlockable target parked in the middle
// of the frame just teaches the player that their reticle is broken. Instead
// every part can be swept up, and the spill answers a premature release by
// flashing whatever is still protecting it. The last rule is the fight's shape
// in one line: the heart only breaks under a volley carrying every lock it can
// hold, so the level ends on the fullest sweep the player can make.

export const SPILL_CRUST_COUNT = 3;
/** How far ahead of the ball the spill parks itself while the fight runs. */
const SPILL_DISTANCE = 42;
const HEART_STAGE_HITS = 3;

export type SpillSpawnData =
  | { role: 'crust'; index: number }
  | { role: 'core'; index: number }
  | { role: 'heart' };

type TinkerEnemy = LockOnEnemy<TinkerEnemyKind, TinkerSpawnData>;
export type SpillCallout = (message: string, seconds: number) => void;

const spillCenter = new Vector3();
const partPosition = new Vector3();

export function createGlueSpill(
  bus: EventBus,
  fireBlob: (context: TinkerUpdate, from: Vector3, scale: number) => void,
  say: SpillCallout,
) {
  /** enemy id -> slot index, for the parts still standing. */
  const liveCrusts = new Map<number, number>();
  const liveCores = new Map<number, number>();
  const partPositions = new Map<number, Vector3>();
  const exposedCores = new Set<number>();
  let crustSpawnCount = 0;
  let coreSpawnCount = 0;
  let heartId = -1;
  let coresBroken = 0;
  let heartOpen = false;
  let heartBroken = false;
  let arrived = false;
  let centerStamp = -1;
  /** Set when a release bounces off the heart; the glue reseals for a beat. */
  let resealRequested = false;
  let heartSealedUntil = -1;

  bus.on('runstart', () => {
    liveCrusts.clear();
    liveCores.clear();
    partPositions.clear();
    exposedCores.clear();
    crustSpawnCount = 0;
    coreSpawnCount = 0;
    heartId = -1;
    coresBroken = 0;
    heartOpen = false;
    heartBroken = false;
    arrived = false;
    centerStamp = -1;
    resealRequested = false;
    heartSealedUntil = -1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'crust') {
      liveCrusts.set(enemyId, crustSpawnCount);
      crustSpawnCount += 1;
    }
    if (kind === 'core') {
      liveCores.set(enemyId, coreSpawnCount);
      coreSpawnCount += 1;
    }
    if (kind === 'heart') {
      heartId = enemyId;
      if (arrived) return;
      arrived = true;
      bus.emit('bossphase', { phase: 'summoned' });
      say('GLUE SPILL', 2.4);
    }
  });

  const exposeCore = (slot: number) => {
    if (exposedCores.has(slot)) return;
    exposedCores.add(slot);
    say(exposedCores.size >= SPILL_CRUST_COUNT ? 'ALL CORES BARE' : `CORE ${exposedCores.size} BARE`, 1.8);
  };

  const onCoreGone = () => {
    coresBroken += 1;
    if (coresBroken < SPILL_CRUST_COUNT || heartOpen) return;
    heartOpen = true;
    bus.emit('bossphase', { phase: 'exposed' });
    say('HEART OPEN — FULL VOLLEY', 2.8);
  };

  const removePart = (enemyId: number) => {
    partPositions.delete(enemyId);
    const crustSlot = liveCrusts.get(enemyId);
    if (crustSlot !== undefined) {
      liveCrusts.delete(enemyId);
      exposeCore(crustSlot);
      return;
    }
    if (liveCores.delete(enemyId)) onCoreGone();
  };

  bus.on('kill', ({ enemyId }) => {
    if (enemyId === heartId && !heartBroken) {
      heartBroken = true;
      bus.emit('bossphase', { phase: 'destroyed' });
      say('TABLE CLEAN', 3.2);
      return;
    }
    removePart(enemyId);
  });

  // A defence that scrolls past unshot counts as gone; the fight must never be
  // able to stall behind armour the player let go by.
  bus.on('miss', ({ enemyId }) => {
    removePart(enemyId);
  });

  function entries(at: number): TinkerSpawnEntry[] {
    const crusts: TinkerSpawnEntry[] = Array.from({ length: SPILL_CRUST_COUNT }, (_value, index) => ({
      time: at + 0.16 + index * 0.16,
      kind: 'crust' as const,
      hitPoints: 2,
      data: { role: 'crust' as const, index },
    }));
    const cores: TinkerSpawnEntry[] = Array.from({ length: SPILL_CRUST_COUNT }, (_value, index) => ({
      time: at + 0.7 + index * 0.1,
      kind: 'core' as const,
      hitStages: [1, 2],
      data: { role: 'core' as const, index },
    }));
    const heart: TinkerSpawnEntry = {
      time: at,
      kind: 'heart',
      hitStages: [HEART_STAGE_HITS, HEART_STAGE_HITS],
      data: { role: 'heart' },
    };
    return [heart, ...crusts, ...cores];
  }

  function ensureCenter(context: TinkerUpdate) {
    if (centerStamp === context.runTime) return;
    centerStamp = context.runTime;
    const u = MathUtils.clamp(context.runProgress, 0, 1);
    const railY = context.curve.getPointAt(u).y;
    // The spill lies on the wood, so its height is authored against the table
    // rather than the rail: it sinks in frame as the ball climbs above it.
    spillCenter.copy(offsetFromRail(context.curve, u, new Vector3(
      Math.sin(context.runTime * 0.42) * 5.5,
      1.4 - railY,
      SPILL_DISTANCE,
    )));
  }

  function seatPart(context: TinkerUpdate, slot: number, radiusScale: number, depth: number) {
    const frame = sampleRailFrame(context.curve, MathUtils.clamp(context.runProgress, 0, 1));
    const span = SPILL_DISTANCE * 0.6;
    const wide = SPILL_DISTANCE * 1.067;
    const angle = (slot / SPILL_CRUST_COUNT) * Math.PI * 2 + context.runTime * 0.34;
    partPosition.copy(spillCenter)
      .addScaledVector(frame.right, Math.cos(angle) * 0.46 * wide * radiusScale)
      .addScaledVector(frame.up, 0.36 * span + Math.sin(angle) * 0.2 * span * radiusScale)
      .addScaledVector(frame.tangent, depth);
    return partPosition;
  }

  function faceCamera(context: TinkerUpdate, spin: number) {
    const { enemy, camera } = context;
    enemy.mesh.rotation.set(
      0,
      Math.atan2(camera.position.x - enemy.mesh.position.x, camera.position.z - enemy.mesh.position.z),
      spin,
    );
  }

  function updateCrust(context: TinkerUpdate, data: Extract<SpillSpawnData, { role: 'crust' }>) {
    ensureCenter(context);
    const { enemy, runTime } = context;
    enemy.mesh.position.copy(seatPart(context, data.index, 1, -2.2));
    enemy.mesh.scale.setScalar(2.6);
    faceCamera(context, Math.sin(runTime * 0.9 + data.index) * 0.28);
    partPositions.set(enemy.id, enemy.mesh.position.clone());
    return false;
  }

  function updateCore(context: TinkerUpdate, data: Extract<SpillSpawnData, { role: 'core' }>) {
    ensureCenter(context);
    const { enemy, age, runTime } = context;
    const exposed = exposedCores.has(data.index);
    enemy.mesh.position.copy(seatPart(context, data.index, 0.9, 1.4));
    // Sealed cores show as a small black bead peeking out of their crust; a
    // bared one swells and breathes.
    enemy.mesh.scale.setScalar(exposed ? 2.4 * (1 + Math.sin(runTime * 4.4 + data.index) * 0.04) : 1.1);
    faceCamera(context, runTime * 0.5 + data.index);
    partPositions.set(enemy.id, enemy.mesh.position.clone());
    if (!exposed) return false;

    const fire = context.enemyState(() => ({ nextAt: age + 2.6 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 4.4;
      fireBlob(context, enemy.mesh.position, 2.0);
    }
    return false;
  }

  function updateHeart(context: TinkerUpdate) {
    ensureCenter(context);
    const { enemy, age, runTime, curve } = context;
    const frame = sampleRailFrame(curve, MathUtils.clamp(context.runProgress, 0, 1));
    const span = SPILL_DISTANCE * 0.6;
    if (resealRequested) {
      resealRequested = false;
      heartSealedUntil = runTime + 0.75;
    }
    // A bounced volley leaves the heart glazed over for a beat, so a denial
    // costs the player a moment instead of letting them spam the same release.
    enemy.entry.lockable = runTime >= heartSealedUntil;
    const sealed = runTime < heartSealedUntil;
    const breathe = heartOpen ? 1 + Math.sin(runTime * 3.1) * 0.06 : 1;
    enemy.mesh.position.copy(spillCenter)
      .addScaledVector(frame.up, 0.3 * span)
      .addScaledVector(frame.right, Math.sin(runTime * 0.8) * 2.4);
    enemy.mesh.scale.setScalar(3.2 * breathe * (sealed ? 0.94 : 1));
    faceCamera(context, Math.sin(runTime * 0.6) * 0.2);
    partPositions.set(enemy.id, enemy.mesh.position.clone());
    const ring = enemy.mesh.userData.ring as { rotation: { z: number } } | undefined;
    if (ring) ring.rotation.z = runTime * (heartOpen ? 0.9 : 0.3);
    if (!heartOpen) return false;

    const fire = context.enemyState(() => ({ nextAt: age + 1.4 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 3.6;
      fireBlob(context, enemy.mesh.position.clone().addScaledVector(frame.right, 5), 2.2);
      fireBlob(context, enemy.mesh.position.clone().addScaledVector(frame.right, -5), 2.2);
    }
    return false;
  }

  function update(context: TinkerUpdate, data: SpillSpawnData) {
    switch (data.role) {
      case 'crust':
        return updateCrust(context, data);
      case 'core':
        return updateCore(context, data);
      case 'heart':
        return updateHeart(context);
    }
  }

  function positionOf(enemyId: number) {
    return partPositions.get(enemyId)?.clone() ?? spillCenter.clone();
  }

  /**
   * Three rules, in order of how the fight teaches them: a core is protected by
   * its own crust, the heart is protected by everything, and the bare heart is
   * only broken by a volley carrying every lock it can hold.
   */
  function validateRelease(enemies: TinkerEnemy[]): boolean | TinkerEnemy[] {
    if (heartId < 0) return true;
    const denied = new Set<number>();
    const flash = new Set<number>();

    for (const enemy of enemies) {
      if (enemy.kind !== 'core') continue;
      const slot = liveCores.get(enemy.id);
      if (slot === undefined || exposedCores.has(slot)) continue;
      denied.add(enemy.id);
      for (const [crustId, crustSlot] of liveCrusts) if (crustSlot === slot) flash.add(crustId);
    }

    const heartLocks = enemies.filter((enemy) => enemy.id === heartId).length;
    if (heartLocks > 0) {
      if (liveCrusts.size > 0 || liveCores.size > 0) {
        denied.add(heartId);
        for (const crustId of liveCrusts.keys()) flash.add(crustId);
        for (const coreId of liveCores.keys()) flash.add(coreId);
      } else if (heartLocks < HEART_STAGE_HITS) {
        denied.add(heartId);
        flash.add(heartId);
      }
    }

    if (denied.size === 0) return true;
    if (denied.has(heartId)) resealRequested = true;
    bus.emit('shielded', {
      shields: [...flash].map((enemyId) => ({ enemyId, worldPosition: positionOf(enemyId) })),
      blockedEnemyIds: [...denied],
    });
    return enemies.filter((enemy) => !denied.has(enemy.id));
  }

  function summary() {
    if (!arrived) return undefined;
    if (heartBroken) return 'Glue spill cleared';
    if (heartOpen) return 'Spill heart still stuck';
    return `Spill cores broken ${coresBroken}/${SPILL_CRUST_COUNT}`;
  }

  return { entries, update, validateRelease, summary };
}

export type GlueSpill = ReturnType<typeof createGlueSpill>;
