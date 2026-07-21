import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { MassDriverSpawnData, MassDriverSpawnEntry, MassDriverUpdate } from './gameplay';
import { INTERLOCK_TIME, MUZZLE_TIME } from './timing';

// THE BREECH INTERLOCKS — this level's boss is a deadline, not a healthbar.
//
// Six safety interlocks are jammed shut around the bore while the firing charge
// builds behind you. There is no shield to strip and no phase to wait out: the
// charge peaks at the muzzle bar whatever you do. Clear all six and the gun
// fires as designed, launching the payload into open space. Leave one standing
// and the charge has nowhere to go, so the barrel lets go instead — with you
// inside it.
//
// Six interlocks at three hit points each is eighteen hits, which is exactly
// three full six-lock volleys. That arithmetic is deliberate: the level's best
// play and the level's win condition are the same shape.

/** Clock positions around the bore, in sixths of a turn. */
export const INTERLOCK_SOCKETS = [0, 1, 2, 3, 4, 5] as const;

export const INTERLOCK_HIT_POINTS = 3;
export const INTERLOCK_COUNT = INTERLOCK_SOCKETS.length;

/** Radius the interlocks are bolted at, inboard of the coils. */
const SOCKET_RADIUS = 11.5;
/** Arc length the interlock ring holds ahead of the payload, in rail units. */
const STANDOFF = 31;
/** Rail length hint used to turn that standoff into a rail-parameter offset. */
const RAIL_LENGTH = 1350;
const STANDOFF_U = STANDOFF / RAIL_LENGTH;

/** Sockets whose emitters still work. The jam did not disarm them. */
const ARMED_SOCKETS = new Set([1, 4]);

const CHARGE_SECONDS = Math.max(0.001, MUZZLE_TIME - INTERLOCK_TIME);

/** 0 when the interlocks appear, 1 the instant the firing charge peaks. */
export function chargeAt(runTime: number) {
  return MathUtils.clamp((runTime - INTERLOCK_TIME) / CHARGE_SECONDS, 0, 1);
}

export type InterlockEntries = {
  timeline: MassDriverSpawnEntry[];
};

export function createInterlockEntries(): InterlockEntries {
  // They light up around the bore in sequence rather than all at once, so the
  // reveal reads as a ring closing rather than a wall appearing.
  return {
    timeline: INTERLOCK_SOCKETS.map((socket, index) => ({
      time: INTERLOCK_TIME + index * 0.14,
      kind: 'interlock' as const,
      hitPoints: INTERLOCK_HIT_POINTS,
      data: { role: 'interlock' as const, socket },
    })),
  };
}

type BreechOptions = {
  entries: InterlockEntries;
  fireLance(context: MassDriverUpdate, from: Vector3, speed?: number): void;
};

export function createBreech(bus: EventBus, options: BreechOptions) {
  void options.entries;
  const state = {
    live: new Set<number>(),
    spawned: 0,
    cleared: 0,
    detonated: false,
  };

  bus.on('runstart', () => {
    state.live.clear();
    state.spawned = 0;
    state.cleared = 0;
    state.detonated = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'interlock') return;
    state.live.add(enemyId);
    state.spawned += 1;
  });

  bus.on('kill', ({ enemyId }) => {
    if (state.live.delete(enemyId)) state.cleared += 1;
  });

  // An interlock can never be missed — it holds station until it dies or the
  // charge peaks — but keep the bookkeeping honest if that ever changes.
  bus.on('miss', ({ enemyId }) => {
    state.live.delete(enemyId);
  });

  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, runProgress, age, curve, camera } = context;
    const charge = chargeAt(runTime);

    // The interlock ring holds a constant standoff ahead of the payload, so the
    // fight stays framed for its whole duration instead of sliding past.
    const anchorU = MathUtils.clamp(runProgress + STANDOFF_U, 0, 1);
    const theta = (data.socket / INTERLOCK_COUNT) * Math.PI * 2 + runTime * 0.16;

    // Straining against the jam: a slow grind that becomes a hard buzz as the
    // charge peaks. This is the player's clock, readable without the HUD.
    const strain = charge * charge;
    const shudder = Math.sin(age * (7 + charge * 26) + data.socket) * (0.12 + strain * 0.9);
    const radius = SOCKET_RADIUS + shudder * 0.35;

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(
      Math.cos(theta) * radius,
      Math.sin(theta) * radius,
      shudder * 0.8,
    )));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(theta + Math.PI / 2);
    enemy.mesh.userData.charge = charge;
    enemy.mesh.userData.strain = strain;

    // Jammed, not disarmed: two of the six keep spitting lances, and they get
    // more insistent the closer the charge gets to peaking.
    if (ARMED_SOCKETS.has(data.socket)) {
      const emitter = context.enemyState(() => ({ nextAt: 3.0 }));
      if (age >= emitter.nextAt) {
        emitter.nextAt = age + (3.1 - charge * 1.1);
        options.fireLance(context, enemy.mesh.position, 6);
      }
    }

    // The charge peaks with this one still shut. There is nowhere for it to go.
    if (runTime >= MUZZLE_TIME && !state.detonated) {
      state.detonated = true;
      context.damagePlayer(99);
    }
    return false;
  }

  return {
    updateInterlock,
    /** True once every interlock is clear — the gun fires as designed. */
    fired: () => state.spawned > 0 && state.live.size === 0 && !state.detonated,
    remaining: () => state.live.size,
    summaryLine() {
      if (state.spawned === 0) return 'Charge never built';
      if (state.detonated || state.live.size > 0) {
        return `Barrel burst — ${state.live.size} interlock${state.live.size === 1 ? '' : 's'} still jammed`;
      }
      return 'Safeties clear — gun fired on schedule';
    },
  };
}

export type Breech = ReturnType<typeof createBreech>;
