import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import { ROSE_CENTER, ROSE_RADIUS, WEST_BAY_WINDOWS, WINDOWS } from './cathedral';
import type { BossData, VespersSpawnEntry, VespersUpdate } from './gameplay';
import { VESPERS_MARKERS, VESPERS_TIME } from './timing';

// The Thing in the west rose. It wakes nested in the dead window (bar 14),
// reaches eight claws out of the tracery on the ground bass's first bar
// (bar 15), each claw clutching the light of one of the last eight windows
// before the west wall. When the claws are gone it tears itself loose and
// comes for you: the hoard, every colour it has taken, inside a shell of
// black thorns (three stages of six). It gives up at bar 22 and sinks back into
// the glass — the rose stays dark and the piece ends in minor.

const CLAW_COUNT = 8;
const CLAW_DEPTH = 27;
const HEART_DEPTH = 29;
const RETREAT_SECONDS = 1.3;
const DEADLINE = VESPERS_MARKERS.deadline;

type ThrowShard = (context: VespersUpdate, from: Vector3, hue: number) => void;

function cameraBasis(context: VespersUpdate) {
  const { camera } = context;
  return {
    right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
    up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    forward: camera.getWorldDirection(new Vector3()),
  };
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

export function createRoseThing(bus: EventBus, throwShard: ThrowShard, previewExposeAt = -1) {
  let heartEntry: VespersSpawnEntry | undefined;
  let heartId = -1;
  let clawsSpawned = 0;
  let exposed = false;
  let exposedAt = -1;
  let burned = false;
  const clawIds = new Set<number>();

  bus.on('runstart', () => {
    heartId = -1;
    clawsSpawned = 0;
    exposed = false;
    exposedAt = -1;
    burned = false;
    clawIds.clear();
    if (heartEntry) heartEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'claw') {
      clawIds.add(enemyId);
      clawsSpawned += 1;
    }
    if (kind === 'heart') {
      heartId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const clawGone = (enemyId: number) => {
    if (!clawIds.delete(enemyId)) return;
    if (clawsSpawned >= CLAW_COUNT && clawIds.size === 0 && !exposed && heartId >= 0 && heartEntry) {
      exposed = true;
      heartEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    clawGone(enemyId);
    if (enemyId === heartId && !burned) {
      burned = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('miss', ({ enemyId }) => clawGone(enemyId));

  function entries(): VespersSpawnEntry[] {
    const heart: VespersSpawnEntry = {
      time: VESPERS_TIME.bar(14, 2),
      kind: 'heart',
      hitStages: [6, 6, 6],
      lockable: false,
      data: { role: 'heart' },
    };
    heartEntry = heart;
    const claws: VespersSpawnEntry[] = [];
    for (let index = 0; index < CLAW_COUNT; index += 1) {
      claws.push({
        time: VESPERS_TIME.bar(15, index * 0.5),
        kind: 'claw',
        hitPoints: 2,
        data: { role: 'claw', index, window: WEST_BAY_WINDOWS[index] ?? -1 },
      });
    }
    return [heart, ...claws];
  }

  function retreatFactor(runTime: number) {
    return MathUtils.clamp((runTime - (DEADLINE - RETREAT_SECONDS)) / RETREAT_SECONDS, 0, 1);
  }

  function updateClaw(context: VespersUpdate, data: Extract<BossData, { role: 'claw' }>) {
    const { enemy, age, runTime, camera } = context;
    const userData = enemy.mesh.userData;
    if (userData.windowIndex === undefined) {
      userData.windowIndex = data.window;
      userData.hue = WINDOWS[data.window]?.hue ?? data.index % 4;
    }
    const { right, up, forward } = cameraBasis(context);
    // The eight claws hold a slowly turning ring — the rose's own rotation —
    // and each one grasps and flexes on its own breath.
    const angle = data.index * ((Math.PI * 2) / CLAW_COUNT) + Math.PI / 8 + runTime * 0.16;
    const breathe = 1 + Math.sin(runTime * 1.4 + data.index * 1.3) * 0.06;
    const center = camera.position.clone().addScaledVector(forward, CLAW_DEPTH).addScaledVector(up, 0.8);
    const target = center
      .addScaledVector(right, Math.cos(angle) * 11.6 * breathe)
      .addScaledVector(up, Math.sin(angle) * 7.1 * breathe);
    const rim = ROSE_CENTER.clone()
      .addScaledVector(right, Math.cos(angle) * ROSE_RADIUS * 0.55)
      .addScaledVector(up, Math.sin(angle) * ROSE_RADIUS * 0.55)
      .addScaledVector(forward, -9);
    const reach = easeOutCubic(MathUtils.clamp(age / 1.7, 0, 1)) * (1 - easeOutCubic(retreatFactor(runTime)));
    enemy.mesh.position.copy(rim).lerp(target, reach);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2 + Math.sin(runTime * 2.1 + data.index) * 0.18);
    userData.anchor = ROSE_CENTER;
    userData.reach = reach;

    const fire = context.enemyState(() => ({ nextAt: 3.2 + data.index * 1.05 }));
    if (age >= fire.nextAt && reach > 0.9) {
      fire.nextAt = age + 9.5;
      throwShard(context, enemy.mesh.position, userData.hue as number);
    }
    return runTime >= DEADLINE;
  }

  function updateHeart(context: VespersUpdate) {
    const { enemy, age, runTime, camera } = context;
    const userData = enemy.mesh.userData;
    userData.hue = -1;
    userData.anchor = ROSE_CENTER;
    userData.exposed = exposed;
    userData.stage = enemy.hitStageIndex;
    const { right, up, forward } = cameraBasis(context);

    if (!exposed && previewExposeAt >= 0 && runTime >= previewExposeAt && heartEntry) {
      exposed = true;
      heartEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
    if (!exposed) {
      // While it is nested, the Thing is part of the rose (the environment
      // draws it). The target waits out of frame, high above the vault, so
      // nothing can aim at a heart that cannot yet be locked.
      enemy.mesh.position.copy(ROSE_CENTER).addScaledVector(up, 90);
      enemy.mesh.quaternion.copy(camera.quaternion);
      userData.hidden = true;
      return runTime >= DEADLINE;
    }
    userData.hidden = false;

    if (exposedAt < 0) exposedAt = runTime;
    const since = runTime - exposedAt;
    const agitation = 1 + enemy.hitStageIndex * 0.35;
    const hover = camera.position.clone()
      .addScaledVector(forward, HEART_DEPTH)
      .addScaledVector(right, Math.sin(runTime * 0.85 * agitation) * 4.6 + Math.sin(runTime * 2.3) * 0.6 * agitation)
      .addScaledVector(up, 1.6 + Math.sin(runTime * 1.25 * agitation) * 2.6);
    const advance = easeOutCubic(MathUtils.clamp(since / 2.2, 0, 1)) * (1 - easeOutCubic(retreatFactor(runTime)));
    enemy.mesh.position.copy(ROSE_CENTER).addScaledVector(forward, -5).lerp(hover, advance);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.35 * agitation);
    userData.wake = 1;
    userData.advance = advance;
    if (retreatFactor(runTime) > 0) enemy.entry.lockable = false;

    const fire = context.enemyState(() => ({ nextAt: age + 2.4, volley: 0 }));
    if (age >= fire.nextAt && advance > 0.85) {
      fire.volley += 1;
      fire.nextAt = age + 3.2 - enemy.hitStageIndex * 0.45;
      const spread = 3.2;
      throwShard(context, enemy.mesh.position.clone().addScaledVector(right, spread), fire.volley % 4);
      throwShard(context, enemy.mesh.position.clone().addScaledVector(right, -spread), (fire.volley + 2) % 4);
    }
    return runTime >= DEADLINE;
  }

  function update(context: VespersUpdate, data: BossData) {
    return data.role === 'claw' ? updateClaw(context, data) : updateHeart(context);
  }

  return {
    entries,
    update,
    burned: () => burned,
  };
}
