import { MathUtils, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { SkyhookSpawnData, SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';

const CLAW_SOCKETS: ReadonlyArray<readonly [number, number]> = [
  [-5.4, 3.2],
  [5.4, 3.2],
  [0, -4.4],
];

export function createCrawlerEntries(time: number) {
  const crawlerEntry: SkyhookSpawnEntry = {
    time,
    kind: 'crawler',
    hitStages: [6, 6],
    lockable: false,
    data: { role: 'crawler' },
  };
  const claws: SkyhookSpawnEntry[] = CLAW_SOCKETS.map((_socket, socket) => ({
    time: time + 0.12 + socket * 0.1,
    kind: 'claw',
    hitPoints: 2,
    data: { role: 'claw', socket },
  }));
  return { crawlerEntry, timeline: [crawlerEntry, ...claws] };
}

type CrawlerOptions = {
  crawlerEntry: SkyhookSpawnEntry;
};

export function createCrawler(bus: EventBus, { crawlerEntry }: CrawlerOptions) {
  const state = {
    id: -1,
    spawned: false,
    killed: false,
    reachedCar: false,
    exposed: false,
    clawIds: new Set<number>(),
    position: new Vector3(),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    forward: new Vector3(0, 0, 1),
  };

  bus.on('runstart', () => {
    state.id = -1;
    state.spawned = false;
    state.killed = false;
    state.reachedCar = false;
    state.exposed = false;
    state.clawIds.clear();
    crawlerEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'crawler') {
      state.id = enemyId;
      state.spawned = true;
    } else if (kind === 'claw') {
      state.clawIds.add(enemyId);
    }
  });

  const removeClaw = (enemyId: number) => {
    if (!state.clawIds.delete(enemyId) || state.clawIds.size !== 0 || !state.spawned) return;
    state.exposed = true;
    crawlerEntry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  };

  bus.on('kill', ({ enemyId }) => {
    removeClaw(enemyId);
    if (enemyId === state.id) {
      state.killed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('miss', ({ enemyId }) => removeClaw(enemyId));

  function updateCrawler(context: SkyhookUpdate, _data: Extract<SkyhookSpawnData, { role: 'crawler' }>) {
    const { enemy, age, runProgress, curve, camera, damagePlayer } = context;
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + 0.001, 0, 1));
    // It is visible at the far end of the tether from the first frame of the
    // fight and crawls down in one continuous, increasingly desperate move.
    const close = MathUtils.smoothstep(age, 0, 14.25);
    const distance = MathUtils.lerp(64, 8.5, close * close * (3 - 2 * close));
    const tetherSide = MathUtils.lerp(7.2, 2.4, close);

    state.position
      .copy(frame.position)
      .addScaledVector(frame.tangent, distance)
      .addScaledVector(frame.right, tetherSide)
      .addScaledVector(frame.up, 1.2 + Math.sin(age * 1.7) * 0.8);
    state.right.copy(frame.right);
    state.up.copy(frame.up);
    state.forward.copy(frame.tangent).negate();

    enemy.mesh.position.copy(state.position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 0.85) * 0.09);
    enemy.mesh.userData.approach = close;
    enemy.mesh.userData.exposed = state.exposed;
    enemy.mesh.userData.stage = enemy.hitStageIndex;

    if (age >= 14.25 && !state.killed && !state.reachedCar) {
      state.reachedCar = true;
      damagePlayer(6);
      return true;
    }
    return false;
  }

  function updateClaw(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'claw' }>) {
    const { enemy, age, camera } = context;
    const socket = CLAW_SOCKETS[data.socket] ?? CLAW_SOCKETS[0];
    const pump = Math.sin(age * 3.2 + data.socket * 1.8) * 0.35;
    enemy.mesh.position
      .copy(state.position)
      .addScaledVector(state.right, socket[0] + pump)
      .addScaledVector(state.up, socket[1])
      .addScaledVector(state.forward, -0.8);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.socket * Math.PI * 2 / 3 + age * 0.35);
    return false;
  }

  return {
    updateCrawler,
    updateClaw,
    killed: () => state.killed,
    reachedCar: () => state.reachedCar,
    summaryLine: () => state.killed
      ? 'Crawler cut loose'
      : state.reachedCar
        ? 'Climber car lost'
        : state.spawned
          ? 'Crawler still on the tether'
          : undefined,
  };
}
