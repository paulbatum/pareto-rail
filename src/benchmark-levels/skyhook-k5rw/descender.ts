import { MathUtils, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { SkyhookSpawnData, SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';
import { CONTACT_TIME } from './timing';

// THE DESCENDER — a tether-walker the size of a house. It latches on far above
// the climber during the sighting bar and then walks down the cable toward you
// for the rest of the run. It is on screen the entire fight, and the only thing
// that changes is how big it is.
//
// Four grapnels hold it to the cable; while any of them grip, the core is
// armoured and unlockable. Break all four and the core swings open. Let the
// clock run out and it reaches the climber and takes two hull points with it.

/** Time-to-contact in seconds, keyed against run time. This is the whole fight. */
const GAP_KEYS: Array<[number, number]> = [
  [0, 11.0],
  [30.0, 7.0],
  [33.75, 4.0],
  [37.5, 3.2],
  [41.25, 2.7],
  [45.0, 2.2],
  [CONTACT_TIME, 1.3],
];

const SIGHT_GAP = GAP_KEYS[0][1];
const LUNGE_SECONDS = 0.9;

// Grapnel sockets around the collar: [angle around the cable, reach down it].
const SOCKETS: Array<[number, number]> = [
  [Math.PI * 0.25, 1.0],
  [Math.PI * 0.75, 1.0],
  [Math.PI * 1.25, 1.0],
  [Math.PI * 1.75, 1.0],
];

/** Rail-relative seat of the collar: wrapped around the cable, body riding above it. */
const COLLAR_OFFSET = new Vector3(0, -1.0, 0);

type DescenderEntries = {
  coreEntry: SkyhookSpawnEntry;
  timeline: SkyhookSpawnEntry[];
};

type DescenderOptions = {
  coreEntry: SkyhookSpawnEntry;
  fireSlug(context: SkyhookUpdate, from: Vector3, spread?: number): void;
};

export function createDescenderEntries(sightingTime: number, engageTime: number): DescenderEntries {
  const coreEntry: SkyhookSpawnEntry = {
    time: sightingTime,
    kind: 'core',
    hitStages: [2, 3],
    lockable: false,
    data: { role: 'core' },
  };
  const grapnels: SkyhookSpawnEntry[] = SOCKETS.map((_socket, index) => ({
    time: engageTime + index * 0.16,
    kind: 'grapnel',
    hitPoints: 2,
    data: { role: 'grapnel', socket: index },
  }));
  return { coreEntry, timeline: [coreEntry, ...grapnels] };
}

function gapAt(runTime: number) {
  for (let i = 1; i < GAP_KEYS.length; i += 1) {
    if (runTime <= GAP_KEYS[i][0]) {
      const [t0, g0] = GAP_KEYS[i - 1];
      const [t1, g1] = GAP_KEYS[i];
      const t = MathUtils.clamp((runTime - t0) / Math.max(0.0001, t1 - t0), 0, 1);
      return MathUtils.lerp(g0, g1, t * t * (3 - 2 * t));
    }
  }
  return GAP_KEYS[GAP_KEYS.length - 1][1];
}

export function createDescender(bus: EventBus, options: DescenderOptions) {
  const boss = {
    coreId: -1,
    spawned: false,
    killed: false,
    reached: false,
    gone: false,
    exposed: false,
    grapnelIds: new Set<number>(),
    collar: new Vector3(),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    down: new Vector3(0, 0, 1),
    lungeTimer: 0,
  };

  bus.on('runstart', () => {
    boss.coreId = -1;
    boss.spawned = false;
    boss.killed = false;
    boss.reached = false;
    boss.gone = false;
    boss.exposed = false;
    boss.grapnelIds.clear();
    boss.lungeTimer = 0;
    options.coreEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'grapnel') boss.grapnelIds.add(enemyId);
    if (kind === 'core') {
      boss.spawned = true;
      boss.coreId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const releaseGrapnel = (enemyId: number) => {
    if (!boss.grapnelIds.delete(enemyId)) return;
    if (boss.grapnelIds.size === 0 && boss.spawned && !boss.exposed) {
      boss.exposed = true;
      options.coreEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    releaseGrapnel(enemyId);
    if (enemyId === boss.coreId) {
      boss.killed = true;
      boss.gone = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    releaseGrapnel(enemyId);
    if (enemyId === boss.coreId) boss.gone = true;
  });

  // Halfway through the core it hauls itself down a body-length in one jerk.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== boss.coreId) return;
    boss.lungeTimer = LUNGE_SECONDS;
  });

  function updateCore(context: SkyhookUpdate, _data: Extract<SkyhookSpawnData, { role: 'core' }>) {
    const { enemy, runTime, age, curve, camera, damagePlayer } = context;
    const state = context.enemyState(() => ({ lastAge: 0, nextShotAt: 6.5 }));
    const dt = Math.max(0, age - state.lastAge);
    state.lastAge = age;

    if (runTime >= CONTACT_TIME && !boss.killed) {
      // It made it. Two hull points and a hole where the upper deck was.
      boss.reached = true;
      boss.gone = true;
      damagePlayer(2);
      return true;
    }

    const lunge = MathUtils.clamp(boss.lungeTimer / LUNGE_SECONDS, 0, 1);
    if (boss.lungeTimer > 0) boss.lungeTimer = Math.max(0, boss.lungeTimer - dt);

    // Unlike every other target the Descender is not seated at a fixed lead: its
    // anchor is "wherever the car will be `gap` seconds from now", so shrinking
    // the gap is literally the boss closing the distance.
    const gap = Math.max(0.5, gapAt(runTime) - lunge * 0.55);
    const anchorU = context.railAnchor(runTime + gap - enemy.entry.time);
    const frame = sampleRailFrame(curve, anchorU);

    // Walking gait: the whole body rocks side to side as it hauls itself down.
    const gait = Math.sin(age * 1.9) * 0.9;
    const sway = Math.sin(age * 0.7) * 1.4;
    boss.collar
      .copy(frame.position)
      .addScaledVector(frame.right, COLLAR_OFFSET.x + sway)
      .addScaledVector(frame.up, COLLAR_OFFSET.y + gait * 0.35);
    boss.right.copy(frame.right);
    boss.up.copy(frame.up);
    boss.down.copy(frame.tangent).negate();

    enemy.mesh.position.copy(boss.collar);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(gait * 0.06);

    // Visual state the mesh reads: 0 far away, 1 on top of the car.
    enemy.mesh.userData.approach = MathUtils.clamp(1 - (gap - 1.3) / (SIGHT_GAP - 1.3), 0, 1);
    enemy.mesh.userData.exposed = boss.exposed;
    enemy.mesh.userData.lunge = lunge;

    // Furnace slot: once it is close enough to bother, it spits slugs at the gunner.
    if (age >= state.nextShotAt) {
      state.nextShotAt = age + (enemy.hitStageIndex > 0 ? 2.8 : 3.6);
      for (const spread of enemy.hitStageIndex > 0 ? [-0.16, 0.16] : [-0.13, 0.13]) {
        options.fireSlug(context, enemy.mesh.position, spread);
      }
    }
    return false;
  }

  function updateGrapnel(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'grapnel' }>) {
    const { enemy, age, camera } = context;
    // Arms have no life of their own: when the body leaves the cable they go
    // with it, whether it was shot off or it got what it came for.
    if (boss.gone) return true;
    const [angle, reach] = SOCKETS[data.socket];
    // Each arm works the cable on its own cycle: grip, haul, re-plant.
    const cycle = Math.sin(age * 2.3 + data.socket * 1.6);
    const spread = 5.6 + cycle * 0.9;
    enemy.mesh.position
      .copy(boss.collar)
      .addScaledVector(boss.right, Math.cos(angle) * spread)
      .addScaledVector(boss.up, Math.sin(angle) * spread * 0.72)
      .addScaledVector(boss.down, reach * (2.4 + cycle * 1.6));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2 + cycle * 0.22);
    enemy.mesh.userData.grip = 0.5 + cycle * 0.5;
    return false;
  }

  function coreKilled() {
    return boss.killed;
  }

  function summaryLine() {
    if (!boss.spawned) return undefined;
    if (boss.killed) return 'The Descender fell off the tether';
    if (boss.reached) return 'The Descender reached the climber';
    return 'The Descender still holds the cable';
  }

  return { updateCore, updateGrapnel, coreKilled, summaryLine, gapAt };
}

export type Descender = ReturnType<typeof createDescender>;
