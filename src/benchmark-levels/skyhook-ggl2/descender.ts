import { MathUtils, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';

// The Descender: something huge that latches onto the tether high above and
// climbs down toward the climber car, getting bigger the whole way. Two armour
// layers before its core is exposed. If it reaches the car it grabs on and
// tears at it (car damage) — so the fight is a race: put it out before it
// arrives. Killing it clears the last stretch into the station.

export const DESCENDER_STAGES = [5, 6];

// Seconds from the boss appearing to it reaching the car if left alive.
const DESCEND_SECONDS = 15;

type DescenderOptions = {
  bossEntry: SkyhookSpawnEntry;
  fireBolt(context: SkyhookUpdate, from: Vector3, speed?: number): void;
  onCarHit(): void;
};

type BossState = {
  nextFireAt: number;
  nextGrabAt: number;
};

export function createDescender(bus: EventBus, options: DescenderOptions) {
  const boss = {
    id: -1,
    spawned: false,
    killed: false,
    reachedCar: false,
    descend: 0,
    worldPosition: new Vector3(),
  };

  bus.on('runstart', () => {
    boss.id = -1;
    boss.spawned = false;
    boss.killed = false;
    boss.reachedCar = false;
    boss.descend = 0;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'descender') return;
    boss.spawned = true;
    boss.id = enemyId;
  });

  bus.on('kill', ({ enemyId }) => {
    if (enemyId === boss.id) boss.killed = true;
  });

  function updateBoss(context: SkyhookUpdate) {
    const { enemy, runProgress, age, curve, camera } = context;
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + 0.006, 0, 1));

    // 0 = latched high on the tether, far ahead; 1 = arrived at the car.
    const descend = MathUtils.clamp(age / DESCEND_SECONDS, 0, 1);
    boss.descend = descend;
    const plunge = descend * descend * (3 - 2 * descend);
    const highY = MathUtils.lerp(40, 4.5, plunge);
    const forward = MathUtils.lerp(46, 13, plunge);
    const weaveX = Math.sin(age * 0.5) * 5 + Math.sin(age * 1.27) * 1.6;

    const position = frame.position
      .clone()
      .addScaledVector(frame.right, weaveX)
      .addScaledVector(frame.up, highY)
      .addScaledVector(frame.tangent, forward);
    boss.worldPosition.copy(position);

    enemy.mesh.position.copy(position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 0.6) * 0.12);

    // It swells as it nears, and swells again once the armour cracks.
    const bulk = MathUtils.lerp(1.0, 2.5, plunge) * (enemy.hitStageIndex > 0 ? 1.12 : 1);
    enemy.mesh.userData.isBoss = true;
    enemy.mesh.userData.bossScale = bulk;
    enemy.mesh.userData.bossDescend = descend;
    enemy.mesh.userData.bossExposed = enemy.hitStageIndex > 0;
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 19) * 0.16;
      enemy.mesh.position.y += Math.cos(age * 15) * 0.14;
    }

    const state = context.enemyState<BossState>(() => ({ nextFireAt: age + 1.8, nextGrabAt: 0 }));

    // Debris volleys down the tether — it goes for the player as well as the car.
    if (age >= state.nextFireAt) {
      state.nextFireAt = age + (boss.reachedCar ? 1.5 : MathUtils.lerp(2.8, 1.6, descend));
      const spread = descend > 0.45 ? [-6, 0, 6] : [-4, 4];
      for (const offset of spread) {
        const from = position.clone().addScaledVector(frame.right, offset).addScaledVector(frame.up, -1.5);
        options.fireBolt(context, from, 5.2 + descend * 1.4);
      }
    }

    // Arrival: it grabs the car and tears. The invulnerability window paces the
    // damage; the run can still end at the station, scarred, if it is not killed.
    if (descend >= 1) {
      boss.reachedCar = true;
      if (age >= state.nextGrabAt) {
        state.nextGrabAt = age + 1.15;
        context.damagePlayer(1);
        options.onCarHit();
      }
    }

    return false;
  }

  function bossKilled() {
    return boss.killed;
  }

  function reachedCar() {
    return boss.reachedCar;
  }

  function summaryLine() {
    if (!boss.spawned) return undefined;
    return boss.killed ? 'The Descender put down' : 'The Descender reached the car';
  }

  return { updateBoss, bossKilled, reachedCar, summaryLine };
}

export type Descender = ReturnType<typeof createDescender>;
