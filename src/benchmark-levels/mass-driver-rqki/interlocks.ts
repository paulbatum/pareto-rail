import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import {
  RAIL_LENGTH,
  barrelRadiusAt,
  boreOffset,
  massDriverRunProgress,
  railBasis,
} from './barrel';
import type { MassDriverSpawnData, MassDriverUpdate } from './gameplay';
import { INTERLOCK_SPAWN_TIME, MUZZLE_TIME } from './timing';

// THE INTERLOCKS. Four safety clamps ring the bore near the muzzle. They have
// seized shut with the firing charge already building, and they are closing:
// the longer they live the further they reach into the barrel. Clear all four
// before the charge peaks at bar 32 and the gun fires with you in the payload.
// Miss the window and the charge has nowhere to go.

/** Bore angles, in radians: top, right, bottom, left. Four clamps, four screen edges. */
export const INTERLOCK_SOCKETS = [
  Math.PI / 2,
  0,
  -Math.PI / 2,
  Math.PI,
] as const;

const CHARGE_SECONDS = MUZZLE_TIME - INTERLOCK_SPAWN_TIME;

/** 0 when the interlocks seize, 1 when the charge peaks. */
export function chargeAt(runTime: number) {
  return MathUtils.clamp((runTime - INTERLOCK_SPAWN_TIME) / CHARGE_SECONDS, 0, 1);
}

/** How far ahead of the payload the clamp bank rides, in rail units. */
function holdDistance(charge: number, socket: number, runTime: number) {
  const closing = MathUtils.lerp(58, 40, charge);
  return closing + Math.sin(runTime * 1.15 + socket * 1.7) * 5;
}

export type InterlockBankOptions = {
  fireBolt(context: MassDriverUpdate, from: Vector3, speed?: number): void;
};

export function createInterlockBank(bus: EventBus, options: InterlockBankOptions) {
  const liveIds = new Set<number>();
  let spawned = 0;
  let destroyed = 0;
  let clearedAt = -1;
  let breached = false;

  bus.on('runstart', () => {
    liveIds.clear();
    spawned = 0;
    destroyed = 0;
    clearedAt = -1;
    breached = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'interlock') return;
    liveIds.add(enemyId);
    spawned += 1;
    if (spawned === 1) bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('stage', ({ enemyId }) => {
    if (liveIds.has(enemyId)) bus.emit('bossphase', { phase: 'exposed' });
  });

  const forget = (enemyId: number, runTimeHint: number) => {
    if (!liveIds.delete(enemyId)) return;
    destroyed += 1;
    if (destroyed >= INTERLOCK_SOCKETS.length && clearedAt < 0) {
      clearedAt = runTimeHint;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  };

  let lastRunTime = 0;
  bus.on('kill', ({ enemyId }) => forget(enemyId, lastRunTime));
  bus.on('miss', ({ enemyId }) => liveIds.delete(enemyId));

  const scratch = new Vector3();

  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    lastRunTime = runTime;
    const charge = chargeAt(runTime);

    // The bank paces the payload rather than sitting on a rail anchor: it is
    // machinery bolted to a barrel you are still falling down, so it holds a
    // near-constant distance ahead and creeps closer as the charge builds.
    const anchorU = MathUtils.clamp(
      massDriverRunProgress(runTime) + holdDistance(charge, data.socket, runTime) / RAIL_LENGTH,
      0,
      1,
    );
    // The whole ring of clamps rolls slowly, so every socket sweeps the frame
    // instead of parking one target in a corner for thirteen seconds.
    const theta = INTERLOCK_SOCKETS[data.socket] + runTime * 0.18 + Math.sin(runTime * 0.7 + data.socket) * 0.1;
    // Closing: a seized clamp reaches further into the bore the hotter it gets.
    const reach = MathUtils.lerp(0.94, 0.58, charge) - (enemy.hitStageIndex > 0 ? 0.06 : 0);
    const radius = barrelRadiusAt(anchorU) * reach;

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, boreOffset(theta, radius, 0, scratch)));
    enemy.mesh.quaternion.setFromRotationMatrix(railBasis(curve, anchorU, theta));
    // Jammed hardware does not idle smoothly: it judders harder as it heats.
    const judder = (0.02 + charge * 0.06) * (enemy.hitStageIndex > 0 ? 2.2 : 1);
    enemy.mesh.rotateZ(Math.sin(runTime * 17 + data.socket * 2.1) * judder);
    enemy.mesh.rotateX(Math.sin(runTime * 11 + data.socket) * judder * 0.6);
    enemy.mesh.userData.charge = charge;
    enemy.mesh.userData.cracked = enemy.hitStageIndex > 0;

    // Suppressing fire, staggered so the four never volley together.
    const fire = context.enemyState(() => ({ nextAt: 2.0 + data.socket * 0.55 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + MathUtils.lerp(3.4, 2.0, charge);
      options.fireBolt(context, enemy.mesh.position, 6);
    }

    // Charge peak with a clamp still seized: the barrel has nowhere to vent.
    if (runTime >= MUZZLE_TIME) {
      breached = true;
      context.damagePlayer(MASS_DRIVER_BREACH_DAMAGE);
    }
    void camera;
    return false;
  }

  return {
    updateInterlock,
    barrelCleared: () => clearedAt >= 0,
    clearedAt: () => clearedAt,
    liveCount: () => liveIds.size,
    charge: chargeAt,
    summaryLine() {
      if (clearedAt >= 0) {
        const spare = Math.max(0, MUZZLE_TIME - clearedAt);
        return `Barrel cleared with ${spare.toFixed(1)}s of charge left`;
      }
      if (breached) return `Barrel breach — ${destroyed}/${INTERLOCK_SOCKETS.length} interlocks cleared`;
      return `${destroyed}/${INTERLOCK_SOCKETS.length} interlocks cleared`;
    },
  };
}

/** Enough to end a run outright: the barrel does not do partial failures. */
const MASS_DRIVER_BREACH_DAMAGE = 99;
