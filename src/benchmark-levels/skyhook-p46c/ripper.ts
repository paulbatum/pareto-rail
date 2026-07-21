import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';
import { railSAt, tetherPoint } from './gameplay';
import { BOSS_LATCH_TIME, BOSS_REACH_TIME, SKYHOOK_BAR, VACUUM_TIME } from './timing';

// THE TETHERJACK — a salvage beast the size of a house that slams onto the
// tether far above the car and climbs down it, hand over hand, one lurch per
// bar. The player watches it grow for the whole fight. Kill it before it
// reaches the car; fail, and it rides the hull and starts tearing pieces off.
//
// Two carapace stages (4 + 5 lock-hits). Breaking the first sheds its shell
// and it climbs meaner. While it descends it wrenches glowing rivets off the
// tether collars and hurls them down at the player.

/** Distance up the tether where it latches on. */
const LATCH_GAP = 260;
/** Distance at which it is considered "on the car". */
const GRIP_GAP = 12;
const BITE_INTERVAL = 2.2;

type TetherjackOptions = {
  bossEntry: SkyhookSpawnEntry;
  throwRivet(context: SkyhookUpdate, from: Vector3, speed: number): void;
};

export function createTetherjackEntry(time: number): SkyhookSpawnEntry {
  return {
    time,
    kind: 'ripper',
    hitStages: [4, 5],
    data: { role: 'ripper' },
  };
}

export function createTetherjack(bus: EventBus, options: TetherjackOptions) {
  const boss = {
    id: -1,
    spawned: false,
    dead: false,
    gripped: false,
    /** 0 at latch → 1 at the car. Integrated so the stage break can speed it up. */
    descent: 0,
  };

  bus.on('runstart', () => {
    boss.id = -1;
    boss.spawned = false;
    boss.dead = false;
    boss.gripped = false;
    boss.descent = 0;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'ripper') {
      boss.id = enemyId;
      boss.spawned = true;
    }
  });

  bus.on('kill', ({ enemyId }) => {
    if (enemyId === boss.id) boss.dead = true;
  });

  function update(context: SkyhookUpdate) {
    const { enemy, runTime, age, runProgress, curve, camera, damagePlayer } = context;
    const state = context.enemyState(() => ({ nextRivetAt: 2.4, nextBiteAt: 0, lastRunTime: runTime }));
    const dt = Math.max(0, runTime - state.lastRunTime);
    state.lastRunTime = runTime;

    // Hand-over-hand: the descent rate pulses once per bar, so the whole
    // arena reads its climbing rhythm against the music. Shedding the first
    // carapace makes it climb a third faster.
    if (!boss.gripped) {
      const barPhase = (runTime / SKYHOOK_BAR) % 1;
      const lurch = 0.42 + 1.16 * Math.max(0, Math.sin(barPhase * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
      const stageBoost = enemy.hitStageIndex > 0 ? 1.34 : 1;
      boss.descent = Math.min(1, boss.descent + (dt / (BOSS_REACH_TIME - BOSS_LATCH_TIME)) * lurch * stageBoost);
      if (boss.descent >= 1) boss.gripped = true;
    }

    const latchEase = Math.min(1, age / 1.1);
    if (boss.gripped) {
      // On the car: huge, bottom-right, tearing at the deck until it dies.
      const carU = MathUtils.clamp(runProgress + 0.0015, 0, 1);
      const wrench = Math.sin(runTime * 3.1) * 0.3;
      enemy.mesh.position.copy(offsetFromRail(curve, carU, new Vector3(3.4 + wrench * 0.4, -2.4, 5.6)));
      enemy.mesh.lookAt(camera.position);
      enemy.mesh.rotateZ(0.5 + wrench * 0.25);
      enemy.mesh.userData.gap = GRIP_GAP;
      enemy.mesh.userData.gripped = true;
      if (runTime >= state.nextBiteAt) {
        state.nextBiteAt = Math.max(runTime, state.nextBiteAt) + BITE_INTERVAL;
        enemy.mesh.userData.biteAt = runTime;
        damagePlayer(1);
      }
      return false;
    }

    // Descending the tether: its position is literally on the cable, closing.
    const gap = MathUtils.lerp(LATCH_GAP, GRIP_GAP, boss.descent);
    const barPhase = (runTime / SKYHOOK_BAR) % 1;
    const heave = Math.max(0, Math.sin(barPhase * Math.PI * 2 - Math.PI / 2)) * 1.6;
    const position = tetherPoint(railSAt(runTime) + gap);
    // Slight overshoot off the cable when it first slams on.
    position.addScaledVector(new Vector3(0, 1, 0), (1 - latchEase) * 26);
    position.y += heave * 0.4;
    enemy.mesh.position.copy(position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.9) * 0.12);
    enemy.mesh.userData.gap = gap;
    enemy.mesh.userData.gripped = false;
    enemy.mesh.userData.heave = heave;

    // Rivet volleys: wrenched off collars and hurled down. Meaner without a
    // shell, relentless in the vacuum act.
    if (age >= state.nextRivetAt) {
      const brutal = runTime >= VACUUM_TIME;
      const shed = enemy.hitStageIndex > 0;
      state.nextRivetAt = age + (brutal ? 2.2 : shed ? 2.6 : 3.2);
      const sources = shed ? [-6, 6] : [0];
      const towardPlayer = camera.position.clone().sub(position).normalize();
      for (const side of sources) {
        const from = position.clone()
          .addScaledVector(new Vector3(1, 0, 0), side)
          .addScaledVector(towardPlayer, 7);
        options.throwRivet(context, from, 6.5);
      }
    }
    return false;
  }

  function killed() {
    return boss.dead;
  }

  function summaryLine() {
    if (!boss.spawned) return undefined;
    if (boss.dead) return 'Tetherjack cut loose';
    return boss.gripped ? 'The Tetherjack rode the car into the dock' : 'The Tetherjack still holds the line';
  }

  return { update, killed, summaryLine };
}

export type Tetherjack = ReturnType<typeof createTetherjack>;
