import { MathUtils, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { LockOnEnemy } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { VespersEnemyKind, VespersSpawnData, VespersSpawnEntry, VespersUpdate } from './gameplay';

// The thing in the rose window. It is holding six of the colours it took, and
// it will not let go of the last one until the other five are gone: the heart
// cannot be locked while a petal is still lit.
//
// Once it is open the fight has a pulse of its own. Every stage the player
// breaks makes the shell slam shut for a couple of seconds — unlockable, and
// spitting embers — before it grinds open again. Three closings, then the
// window goes up.

const PETAL_COUNT = 6;
const SHUT_SECONDS = 2.6;

export type RoseSpawnData = { role: 'petal'; index: number } | { role: 'heart' };

type VespersEnemy = LockOnEnemy<VespersEnemyKind, VespersSpawnData>;

export function createRoseFight(bus: EventBus, fireMote: (context: VespersUpdate, from: Vector3) => void) {
  const heartPosition = new Vector3();
  const petalPositions = new Map<number, Vector3>();
  const petalIds = new Set<number>();
  let heartEntry: VespersSpawnEntry | undefined;
  let heartId = -1;
  let heartSpawned = false;
  let heartKilled = false;
  let exposed = false;
  let petalsSpawned = 0;
  let shutUntil = -1;

  bus.on('runstart', () => {
    heartId = -1;
    heartSpawned = false;
    heartKilled = false;
    exposed = false;
    petalsSpawned = 0;
    shutUntil = -1;
    petalIds.clear();
    petalPositions.clear();
    if (heartEntry) heartEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'rose-petal') {
      petalIds.add(enemyId);
      petalsSpawned += 1;
    }
    if (kind === 'rose-heart') {
      heartSpawned = true;
      heartId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const onPetalGone = (enemyId: number) => {
    if (!petalIds.delete(enemyId)) return;
    petalPositions.delete(enemyId);
    if (petalsSpawned < PETAL_COUNT || petalIds.size > 0 || !heartSpawned || exposed || !heartEntry) return;
    exposed = true;
    heartEntry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  };

  bus.on('kill', ({ enemyId }) => {
    onPetalGone(enemyId);
    if (enemyId === heartId && !heartKilled) {
      heartKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onPetalGone(enemyId);
  });

  // Breaking a stage does not expose the next one: the shell shuts on the
  // player's hand and has to be waited out.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== heartId) return;
    shutUntil = Number.POSITIVE_INFINITY;
  });

  function entries(at: number): VespersSpawnEntry[] {
    const heart: VespersSpawnEntry = {
      time: at,
      kind: 'rose-heart',
      hitStages: [3, 4, 4],
      lockable: false,
      data: { role: 'heart' },
    };
    heartEntry = heart;
    return [
      heart,
      ...Array.from({ length: PETAL_COUNT }, (_unused, index): VespersSpawnEntry => ({
        time: at + 0.35 + index * 0.16,
        kind: 'rose-petal',
        hitPoints: 2,
        data: { role: 'petal', index },
      })),
    ];
  }

  function screenBasis(camera: VespersUpdate['camera']) {
    return {
      right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    };
  }

  function updateHeart(context: VespersUpdate) {
    const { enemy, runTime, runProgress, curve, camera } = context;
    const state = context.enemyState(() => ({ reopenAt: -1, nextSalvo: 0, lastAge: 0, openness: 0 }));
    const dt = Math.max(0, Math.min(0.1, context.age - state.lastAge));
    state.lastAge = context.age;
    // Held a fixed distance ahead of the camera rather than pinned to a
    // timeline anchor, so the rose owns the frame all the way to the end.
    const shut = runTime < shutUntil;
    const rage = exposed ? 1 : 0;
    heartPosition.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 1), new Vector3(
      Math.sin(runTime * 0.42) * 3.2 + rage * Math.sin(runTime * 2.7) * 1.6,
      5.5 + Math.sin(runTime * 0.66) * 1.8 + rage * Math.cos(runTime * 2.3) * 1.1,
      33 + rage * Math.sin(runTime * 3.3) * 2,
    )));
    enemy.mesh.position.copy(heartPosition);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * -0.18);

    // The shell grinds open when the heart is exposed and slams shut on every
    // stage the player breaks.
    state.openness += ((exposed && !shut ? 1 : 0) - state.openness) * Math.min(1, dt * 3.6);
    const shell = enemy.mesh.userData.shell as Object3D | undefined;
    if (shell) {
      shell.scale.setScalar(1 + state.openness * 0.55);
      shell.rotation.z = runTime * (0.35 + state.openness * 0.9);
    }
    const spokes = enemy.mesh.userData.spokes as Object3D | undefined;
    if (spokes) spokes.scale.setScalar(0.4 + state.openness * 0.6);

    if (shut) {
      if (state.reopenAt < 0) {
        state.reopenAt = runTime + SHUT_SECONDS;
        state.nextSalvo = runTime + 0.5;
      }
      if (runTime >= state.nextSalvo) {
        state.nextSalvo = runTime + 1.5;
        const { right } = screenBasis(camera);
        fireMote(context, heartPosition.clone().addScaledVector(right, state.reopenAt > runTime + 1.3 ? 3.2 : -3.2));
      }
      if (runTime >= state.reopenAt) {
        state.reopenAt = -1;
        state.nextSalvo = runTime + 1.6;
        shutUntil = -1;
      }
    } else if (exposed && runTime >= state.nextSalvo) {
      state.nextSalvo = runTime + 2.6;
      fireMote(context, heartPosition.clone());
    }

    enemy.entry.lockable = exposed && !shut;
    return false;
  }

  function updatePetal(context: VespersUpdate, data: Extract<RoseSpawnData, { role: 'petal' }>) {
    const { enemy, runTime, camera } = context;
    // A slow wheel in screen space: the six lights turn around the heart, so
    // the player has to sweep the full width of the window to take them.
    const angle = (data.index / PETAL_COUNT) * Math.PI * 2 - runTime * 0.34;
    const breathe = 1 + Math.sin(runTime * 1.1 + data.index) * 0.07;
    const { right, up } = screenBasis(camera);
    enemy.mesh.position
      .copy(heartPosition)
      .addScaledVector(right, Math.cos(angle) * 17 * breathe)
      .addScaledVector(up, Math.sin(angle) * 11.5 * breathe);
    petalPositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle - Math.PI / 2);

    return false;
  }

  function update(context: VespersUpdate, data: RoseSpawnData) {
    return data.role === 'heart' ? updateHeart(context) : updatePetal(context, data);
  }

  /** While any light is still burning, the heart refuses the shot. */
  function validateRelease(enemies: VespersEnemy[]): boolean | VespersEnemy[] {
    if (petalIds.size === 0) return true;
    const blocked = enemies.filter((enemy) => enemy.kind === 'rose-heart');
    if (blocked.length === 0) return true;
    bus.emit('shielded', {
      shields: [...petalIds].map((enemyId) => ({
        enemyId,
        worldPosition: petalPositions.get(enemyId)?.clone() ?? heartPosition.clone(),
      })),
      blockedEnemyIds: blocked.map((enemy) => enemy.id),
    });
    return enemies.filter((enemy) => enemy.kind !== 'rose-heart');
  }

  function summary() {
    if (!heartSpawned) return undefined;
    return heartKilled ? 'The rose is lit' : 'The rose held';
  }

  return { entries, update, validateRelease, summary };
}

export type VespersRoseFight = ReturnType<typeof createRoseFight>;
