import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { Pane, VespersSpawnEntry, VespersUpdate } from './gameplay';
import { ROSE_CENTER } from './gameplay';

// The thing in the rose window. It holds every colour it has taken as a ring
// of petal shards orbiting a black iris. Kill the petals and the eye opens;
// wound it and it sinks back into the glass and throws out a second, meaner
// ring; kill it and the rose ignites.

export type EaterSpawnData =
  | { role: 'petal'; index: number; ring: 0 | 1; pane: Pane; count: number }
  | { role: 'eye' };

const RING_0_PANES: Pane[] = ['cobalt', 'blood', 'bottle', 'gold', 'violet', 'cobalt', 'blood', 'gold'];
const RING_1_PANES: Pane[] = ['gold', 'cobalt', 'blood', 'bottle'];
const RETREAT_SECONDS = 1.6;

type EaterOptions = {
  eyeEntry: VespersSpawnEntry;
  fireShard(context: VespersUpdate, from: Vector3): void;
};

export function createEaterEntries(time: number) {
  const eyeEntry: VespersSpawnEntry = {
    time,
    kind: 'eye',
    hitStages: [3, 4],
    lockable: false,
    data: { role: 'eye' },
  };
  const petals: VespersSpawnEntry[] = RING_0_PANES.map((pane, index) => ({
    time: time + 0.5 + index * 0.16,
    kind: 'petal',
    data: { role: 'petal', index, ring: 0, pane, count: RING_0_PANES.length },
  }));
  return { eyeEntry, timeline: [eyeEntry, ...petals] };
}

export function createEater(bus: EventBus, options: EaterOptions) {
  const eyePosition = ROSE_CENTER.clone();
  const boss = {
    eyeId: -1,
    eyeSpawned: false,
    eyeKilled: false,
    exposed: false,
    stage: 0,
    retreatUntil: -1,
    retreatRequested: false,
    ring0Spawned: 0,
    ring1Spawned: false,
    ring0: new Set<number>(),
    ring1: new Set<number>(),
    nextShardAt: Infinity,
  };

  bus.on('runstart', () => {
    boss.eyeId = -1;
    boss.eyeSpawned = false;
    boss.eyeKilled = false;
    boss.exposed = false;
    boss.stage = 0;
    boss.retreatUntil = -1;
    boss.retreatRequested = false;
    boss.ring0Spawned = 0;
    boss.ring1Spawned = false;
    boss.ring0.clear();
    boss.ring1.clear();
    boss.nextShardAt = Infinity;
    options.eyeEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'eye') {
      boss.eyeSpawned = true;
      boss.eyeId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const expose = () => {
    if (boss.exposed) return;
    boss.exposed = true;
    options.eyeEntry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  };

  const onPetalGone = (enemyId: number) => {
    const wasRing0 = boss.ring0.delete(enemyId);
    const wasRing1 = boss.ring1.delete(enemyId);
    if (!wasRing0 && !wasRing1) return;
    if (boss.stage === 0 && boss.ring0Spawned >= RING_0_PANES.length && boss.ring0.size === 0 && boss.eyeSpawned) expose();
    if (boss.stage === 1 && boss.ring1Spawned && boss.ring1.size === 0 && boss.retreatUntil >= 0) expose();
  };

  bus.on('kill', ({ enemyId }) => {
    onPetalGone(enemyId);
    if (enemyId === boss.eyeId && !boss.eyeKilled) {
      boss.eyeKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('miss', ({ enemyId }) => onPetalGone(enemyId));

  // Stage break: the eye shuts, sinks into the glass, and the second ring
  // comes off the window around it.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== boss.eyeId) return;
    boss.stage = 1;
    boss.exposed = false;
    boss.retreatRequested = true;
    options.eyeEntry.lockable = false;
  });

  function screenBasis(camera: VespersUpdate['camera']) {
    return {
      right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    };
  }

  function updateEye(context: VespersUpdate, _data: Extract<EaterSpawnData, { role: 'eye' }>) {
    const { enemy, runTime, age, camera } = context;
    if (boss.retreatRequested) {
      boss.retreatRequested = false;
      boss.retreatUntil = runTime + RETREAT_SECONDS;
    }
    const retreating = boss.retreatUntil > runTime;
    if (!retreating && boss.stage === 1 && !boss.ring1Spawned && boss.retreatUntil >= 0) {
      boss.ring1Spawned = true;
      RING_1_PANES.forEach((pane, index) => {
        const id = context.spawnEnemy({
          time: runTime,
          kind: 'petal',
          data: { role: 'petal', index, ring: 1, pane, count: RING_1_PANES.length },
        });
        if (id >= 0) boss.ring1.add(id);
      });
    }

    // Nested in the rose: a slow breath, sinking into the glass when hurt.
    const sink = retreating ? smoothstep(MathUtils.clamp((boss.retreatUntil - runTime) / 0.5, 0, 1)) : 0;
    const wake = smoothstep(Math.min(1, age / 1.6));
    eyePosition.copy(ROSE_CENTER);
    eyePosition.x += Math.sin(runTime * 0.45) * 0.6 * wake;
    eyePosition.y += Math.sin(runTime * 0.7) * 0.5 * wake;
    eyePosition.z += 2.6 * sink;
    // While the eye is shut it is not a target at all: the mesh parks behind
    // the camera and the visuals show a dormant stand-in nested in the glass.
    // The moment it opens, the real target takes the stand-in's place.
    const dormant = !boss.exposed || retreating;
    if (dormant) {
      const forward = new Vector3();
      camera.getWorldDirection(forward);
      enemy.mesh.position.copy(camera.position).addScaledVector(forward, -8);
      enemy.mesh.visible = false;
    } else {
      enemy.mesh.position.copy(eyePosition);
      enemy.mesh.visible = true;
    }
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.3) * 0.08);
    enemy.mesh.userData.exposed = boss.exposed && !retreating;
    enemy.mesh.userData.dormant = dormant;
    enemy.mesh.userData.rosePosition = eyePosition;
    enemy.mesh.userData.sink = sink;
    enemy.mesh.userData.wake = wake;
    enemy.mesh.userData.stage = boss.stage;

    // The wounded eye throws dark glass while it is open.
    if (boss.stage === 1 && boss.exposed && !retreating) {
      if (boss.nextShardAt === Infinity) boss.nextShardAt = runTime + 1.4;
      if (runTime >= boss.nextShardAt) {
        boss.nextShardAt = runTime + 3.4;
        const { right } = screenBasis(camera);
        options.fireShard(context, eyePosition.clone().addScaledVector(right, 2.4));
        options.fireShard(context, eyePosition.clone().addScaledVector(right, -2.4));
        enemy.mesh.userData.throwAt = runTime;
      }
    } else {
      boss.nextShardAt = Infinity;
    }
    return false;
  }

  function updatePetal(context: VespersUpdate, data: Extract<EaterSpawnData, { role: 'petal' }>) {
    const { enemy, runTime, age, camera } = context;
    if (data.ring === 0 && !boss.ring0.has(enemy.id)) {
      boss.ring0.add(enemy.id);
      boss.ring0Spawned += 1;
    }
    const { right, up } = screenBasis(camera);
    // The ring keeps a constant size on screen as the camera closes on the
    // window, so the sweep stays wide from sixty metres out to twenty.
    const distance = camera.position.distanceTo(eyePosition);
    const ringScale = data.ring === 0 ? 1 : 0.72;
    const radius = MathUtils.clamp(distance * 0.21, 5.5, 13.5) * ringScale;
    const emerge = smoothstep(Math.min(1, age / 0.9));
    const spin = data.ring === 0 ? 0.32 : -0.55;
    const angle = data.index * ((Math.PI * 2) / data.count) + runTime * spin + (data.ring === 1 ? 0.4 : 0);
    const wobble = 1 + Math.sin(runTime * 1.3 + data.index * 1.9) * 0.05;
    enemy.mesh.position
      .copy(eyePosition)
      .addScaledVector(right, Math.cos(angle) * radius * emerge * wobble)
      .addScaledVector(up, Math.sin(angle) * radius * 0.86 * emerge * wobble)
      .addScaledVector(right, 0);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle - Math.PI / 2 + Math.sin(runTime * 2 + data.index) * 0.08);
    enemy.mesh.userData.pane = data.pane;
    enemy.mesh.userData.emerge = emerge;

    if (data.ring === 1 && data.index % 2 === 0) {
      const fire = context.enemyState(() => ({ fired: false }));
      if (!fire.fired && age >= 2.2 + data.index * 0.4) {
        fire.fired = true;
        enemy.mesh.userData.throwAt = runTime;
        options.fireShard(context, enemy.mesh.position);
      }
    }
    return false;
  }

  function eyeKilled() {
    return boss.eyeKilled;
  }

  function summaryLine() {
    if (!boss.eyeSpawned) return undefined;
    if (boss.eyeKilled) return 'The rose window ignited';
    return boss.exposed || boss.stage > 0 ? 'The eye is still open' : 'The rose stayed dark';
  }

  return { updateEye, updatePetal, eyeKilled, summaryLine };
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
