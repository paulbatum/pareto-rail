import { MathUtils, Vector3 } from 'three';
import type { LockOnEnemy } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { VespersEnemyKind, VespersSpawnData, VespersSpawnEntry, VespersUpdate } from './gameplay';

// THE VIGIL — the thing nested in the dead rose window at the west end,
// holding every colour it has taken. Six glass petals orbit the heart, each
// burning with one stolen hue; while any petal lives the heart can be locked
// but not harmed — released shots turn away in a flash of gold. The heart
// itself dies in two stages, and completing the first stage makes the Vigil
// grasp for more light: three echo petals tear free and seal it again until
// they are put down.

const PETAL_COUNT = 6;
const ECHO_COUNT = 3;

export type VigilSpawnData =
  | { role: 'petal'; index: number; echo?: boolean }
  | { role: 'heart' };

type VespersEnemy = LockOnEnemy<VespersEnemyKind, VespersSpawnData>;

export function createVigil(
  bus: EventBus,
  fireBolt: (context: VespersUpdate, from: Vector3) => void,
) {
  const heartPosition = new Vector3();
  let heartId = -1;
  let heartSpawned = false;
  let heartKilled = false;
  let exposed = false;
  let petalsSpawned = 0;
  let echoesSummoned = false;
  const petalIds = new Set<number>();
  const petalPositions = new Map<number, Vector3>();

  bus.on('runstart', () => {
    heartId = -1;
    heartSpawned = false;
    heartKilled = false;
    exposed = false;
    petalsSpawned = 0;
    echoesSummoned = false;
    petalIds.clear();
    petalPositions.clear();
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'vigil-petal') {
      petalIds.add(enemyId);
      petalsSpawned += 1;
    }
    if (kind === 'vigil-heart') {
      heartSpawned = true;
      heartId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const refreshExposure = () => {
    if (!heartSpawned || heartKilled) return;
    const bare = petalsSpawned >= PETAL_COUNT && petalIds.size === 0;
    if (bare && !exposed) {
      exposed = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  const onPetalGone = (enemyId: number) => {
    if (!petalIds.delete(enemyId)) return;
    petalPositions.delete(enemyId);
    refreshExposure();
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

  // Completing the heart's first stage summons the echo petals; the heart
  // seals itself again until they fall.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== heartId || echoesSummoned) return;
    echoesSummoned = true;
    exposed = false;
  });

  function entries(time: number): VespersSpawnEntry[] {
    // The heart is lockable from the start; the petal seal lives in
    // validateRelease, so a blocked volley reads as "shielded", not "broken".
    const heart: VespersSpawnEntry = {
      time,
      kind: 'vigil-heart',
      hitStages: [4, 3],
      data: { role: 'heart' },
    };
    const petals: VespersSpawnEntry[] = [];
    for (let index = 0; index < PETAL_COUNT; index += 1) {
      petals.push({
        time: time + 0.5 + index * 0.22,
        kind: 'vigil-petal',
        data: { role: 'petal', index },
      });
    }
    return [heart, ...petals];
  }

  function screenBasis(camera: VespersUpdate['camera']) {
    return {
      right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    };
  }

  function updatePetal(context: VespersUpdate, data: Extract<VigilSpawnData, { role: 'petal' }>) {
    const { enemy, runTime, age, camera } = context;
    const { right, up } = screenBasis(camera);
    // Echo petals wheel the opposite way, tighter and faster — a snatching
    // motion where the first ring was a procession.
    const direction = data.echo ? 1 : -1;
    const speed = data.echo ? 0.9 : 0.45;
    const rx = data.echo ? 6.2 : 9.4;
    const ry = data.echo ? 4.8 : 7.4;
    const angle = data.index * ((Math.PI * 2) / (data.echo ? ECHO_COUNT : PETAL_COUNT)) + direction * runTime * speed;
    const breathe = 1 + Math.sin(runTime * 1.15 + data.index * 1.3) * 0.05;
    // A fast bloom: petals tear off the heart and are at their orbit almost
    // immediately, so the fight reads as a wheel, not a clump.
    const settle = Math.min(1, 0.45 + age / 0.35);
    enemy.mesh.position
      .copy(heartPosition)
      .addScaledVector(right, Math.cos(angle) * rx * breathe * settle)
      .addScaledVector(up, Math.sin(angle) * ry * breathe * settle);
    petalPositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);

    // Two of the six ring petals spit gloom bolts; echoes never do — their
    // threat is the reset, not the fire.
    if (!data.echo && data.index % 3 === 0) {
      const fire = context.enemyState(() => ({ nextAt: 2.4 + data.index * 0.9 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 6.4;
        fireBolt(context, enemy.mesh.position);
      }
    }
    return false;
  }

  function updateHeart(context: VespersUpdate, _data: Extract<VigilSpawnData, { role: 'heart' }>) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    // Anchored a fixed distance ahead along the rail tangent, so the Vigil
    // holds the west end of the nave and settles onto the rose window as the
    // camera closes on it.
    const agitation = exposed ? 1 : 0;
    const sway = new Vector3(
      Math.sin(runTime * 0.42) * 2.2 + agitation * Math.sin(runTime * 3.1) * 1.5,
      2.4 + Math.sin(runTime * 0.66) * 1.2 + agitation * Math.cos(runTime * 2.7) * 1.0,
      30 + agitation * Math.sin(runTime * 3.9) * 1.6,
    );
    heartPosition.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 1), sway));
    enemy.mesh.position.copy(heartPosition);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.22);
    enemy.mesh.userData.exposed = exposed;
    enemy.mesh.userData.stageIndex = enemy.hitStageIndex;

    // The heart's own reprisal: paired gloom bolts while it is bare.
    if (exposed) {
      const fire = context.enemyState(() => ({ nextAt: age + 1.4 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 3.4;
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        fireBolt(context, enemy.mesh.position.clone().addScaledVector(right, 2.4));
        fireBolt(context, enemy.mesh.position.clone().addScaledVector(right, -2.4));
      }
    }

    // Echo summon rides the update loop so the new petals spawn at the
    // heart's live position the frame after the stage completes.
    const summon = context.enemyState(() => ({ done: false }));
    if (echoesSummoned && !summon.done) {
      summon.done = true;
      for (let index = 0; index < ECHO_COUNT; index += 1) {
        context.spawnEnemy({
          time: context.runTime + index * 0.16,
          kind: 'vigil-petal',
          countsTowardTotal: false,
          data: { role: 'petal', index, echo: true },
        });
      }
    }
    return false;
  }

  function update(context: VespersUpdate, data: VigilSpawnData) {
    switch (data.role) {
      case 'petal':
        return updatePetal(context, data);
      case 'heart':
        return updateHeart(context, data);
    }
  }

  // The heart cannot be fired on while any petal lives. Other targets caught
  // in the same release still fire.
  function validateRelease(enemies: VespersEnemy[]): boolean | VespersEnemy[] {
    if (petalIds.size === 0) return true;
    const releasedHeartIds = enemies.filter((enemy) => enemy.kind === 'vigil-heart').map((enemy) => enemy.id);
    if (releasedHeartIds.length === 0) return true;
    bus.emit('shielded', {
      shields: [...petalIds].map((enemyId) => ({
        enemyId,
        worldPosition: petalPositions.get(enemyId)?.clone() ?? heartPosition.clone(),
      })),
      blockedEnemyIds: releasedHeartIds,
    });
    return enemies.filter((enemy) => enemy.kind !== 'vigil-heart');
  }

  function summary() {
    if (!heartSpawned) return undefined;
    return heartKilled ? 'The Vigil extinguished — light returned' : 'The Vigil endures';
  }

  function bossDead() {
    return heartKilled;
  }

  return { entries, update, validateRelease, summary, bossDead };
}

export type Vigil = ReturnType<typeof createVigil>;
