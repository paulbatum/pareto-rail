import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { SkyhookSpawnData, SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';
import { TETHER_OFFSET_X, TETHER_OFFSET_Y, climbOffset } from './gameplay';

// THE DESCENDER — a tether-walker the size of a building that clamps onto the
// ribbon somewhere above the weather and hauls itself down at the car. It is on
// screen for the whole fight and its only clock is distance: four clamp arms
// hold it to the ribbon, and every arm torn off makes it slip back up. Once all
// four are gone the core is exposed. If it reaches the car it starts tearing
// the climber apart until it dies or the run ends.

/** Distance up the tether, in world units, at first sighting and at the car. */
const DESCENT_FAR = 190;
const DESCENT_NEAR = 42;
/** Distance at which the clamp arms are big enough on screen to be worth shooting. */
const ARMS_LIVE_DISTANCE = 172;
/** Descent progress a torn-off arm costs it. */
const ARM_SETBACK = 0.145;
const STAGE_SETBACK = 0.09;
/** How fast an authored setback is paid out, in descent units per second — the visible slip. */
const SETBACK_SLIP_RATE = 0.34;
const STRIKE_PERIOD = 3.0;
const FIRST_STRIKE_DELAY = 1.6;

/** Arm sockets, in world units around the core, gripping the ribbon. */
const ARM_SOCKETS: Array<[number, number]> = [[-27, 15], [27, 15], [-21, -17], [21, -17]];

const WALKER_RIGHT = new Vector3(1, 0, 0);
const WALKER_UP = new Vector3(0, 0, 1);

export type DescenderOptions = {
  coreEntry: SkyhookSpawnEntry;
  armEntries: SkyhookSpawnEntry[];
  /** Run time by which the walker is on top of the car if nothing is torn off. */
  deadlineTime: number;
  /** Run time the station aperture reaches the car and shears anything still on the ribbon. */
  dockTime: number;
};

export type DescenderEntries = {
  coreEntry: SkyhookSpawnEntry;
  armEntries: SkyhookSpawnEntry[];
  timeline: SkyhookSpawnEntry[];
};

export function createDescenderEntries(time: number): DescenderEntries {
  const coreEntry: SkyhookSpawnEntry = {
    time,
    kind: 'core',
    hitStages: [3, 4],
    lockable: false,
    data: { role: 'core' },
  };
  const armEntries: SkyhookSpawnEntry[] = ARM_SOCKETS.map((_socket, index) => ({
    time: time + 0.12 + index * 0.08,
    kind: 'clamp',
    hitPoints: 2,
    lockable: false,
    data: { role: 'clamp', socket: index },
  }));
  return { coreEntry, armEntries, timeline: [coreEntry, ...armEntries] };
}

export function createDescender(bus: EventBus, options: DescenderOptions) {
  const walker = {
    coreId: -1,
    spawned: false,
    killed: false,
    exposed: false,
    armsLive: false,
    armIds: new Set<number>(),
    armsTorn: 0,
    setback: 0,
    paidSetback: 0,
    descent: 0,
    distance: DESCENT_FAR,
    reachedCar: false,
    strikes: 0,
    nextStrike: Infinity,
    lastTime: 0,
    position: new Vector3(),
  };

  function reset() {
    walker.coreId = -1;
    walker.spawned = false;
    walker.killed = false;
    walker.exposed = false;
    walker.armsLive = false;
    walker.armIds.clear();
    walker.armsTorn = 0;
    walker.setback = 0;
    walker.paidSetback = 0;
    walker.descent = 0;
    walker.distance = DESCENT_FAR;
    walker.reachedCar = false;
    walker.strikes = 0;
    walker.nextStrike = Infinity;
    walker.lastTime = 0;
    options.coreEntry.lockable = false;
    for (const entry of options.armEntries) entry.lockable = false;
  }

  reset();
  bus.on('runstart', reset);

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'clamp') walker.armIds.add(enemyId);
    if (kind === 'core') {
      walker.spawned = true;
      walker.coreId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const onArmGone = (enemyId: number) => {
    if (!walker.armIds.delete(enemyId)) return;
    walker.armsTorn += 1;
    walker.setback += ARM_SETBACK;
    if (walker.armIds.size === 0 && walker.spawned && !walker.exposed) {
      walker.exposed = true;
      options.coreEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onArmGone(enemyId);
    if (enemyId === walker.coreId && !walker.killed) {
      walker.killed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onArmGone(enemyId);
  });

  // Breaking the core's first stage rips a shell plate loose; the recoil buys
  // the car a little height back.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId === walker.coreId) walker.setback += STAGE_SETBACK;
  });

  // ---- motion ------------------------------------------------------------------

  function updateCore(context: SkyhookUpdate, _data: Extract<SkyhookSpawnData, { role: 'core' }>) {
    const { enemy, runTime, curve, runProgress, camera, damagePlayer } = context;
    // The dock shears it off the ribbon: whatever is still holding on when the
    // station aperture arrives loses, and the last stretch is clear either way.
    if (runTime >= options.dockTime) return true;
    const start = enemy.entry.time;
    const window = Math.max(0.001, options.deadlineTime - start);
    const dt = MathUtils.clamp(runTime - walker.lastTime, 0, 0.1);
    walker.lastTime = runTime;

    // Setbacks are banked instantly but paid out as a visible slip back up.
    walker.paidSetback = Math.min(walker.setback, walker.paidSetback + SETBACK_SLIP_RATE * dt);
    walker.descent = MathUtils.clamp((runTime - start) / window - walker.paidSetback, 0, 1);
    // Exponential approach keeps the on-screen growth rate roughly constant.
    walker.distance = DESCENT_FAR * (DESCENT_NEAR / DESCENT_FAR) ** walker.descent;

    if (!walker.armsLive && walker.distance <= ARMS_LIVE_DISTANCE) {
      walker.armsLive = true;
      for (const entry of options.armEntries) entry.lockable = true;
    }

    // It grips the same ribbon the car rides, so it hangs to the tether side of
    // the vanishing point and sways as it hauls itself down hand over hand.
    const sway = Math.sin(runTime * 0.9) * 3.4 * (1 - walker.descent * 0.5);
    const heave = Math.sin(runTime * 1.7) * 2.1;
    walker.position.copy(climbOffset(
      curve,
      runProgress,
      TETHER_OFFSET_X * 0.55 + sway,
      TETHER_OFFSET_Y + heave,
      walker.distance,
    ));

    enemy.mesh.position.copy(walker.position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.6) * 0.09);
    enemy.mesh.userData.descent = walker.descent;
    enemy.mesh.userData.distance = walker.distance;
    enemy.mesh.userData.exposed = walker.exposed;
    enemy.mesh.userData.armsRemaining = walker.armIds.size;

    // Arrival: it is on the car and pulling panels off until something gives.
    if (walker.descent >= 0.999) {
      if (!walker.reachedCar) {
        walker.reachedCar = true;
        walker.nextStrike = runTime + FIRST_STRIKE_DELAY;
      }
      if (runTime >= walker.nextStrike) {
        walker.nextStrike = runTime + STRIKE_PERIOD;
        walker.strikes += 1;
        damagePlayer(1);
      }
    } else if (!walker.reachedCar) {
      walker.nextStrike = Infinity;
    }
    enemy.mesh.userData.strain = walker.reachedCar ? 1 : MathUtils.clamp((walker.descent - 0.72) / 0.28, 0, 1);
    return false;
  }

  function updateClamp(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'clamp' }>) {
    const { enemy, age, camera, runTime } = context;
    if (runTime >= options.dockTime) return true;
    const socket = ARM_SOCKETS[data.socket];
    // The arms work: each reaches, bites the ribbon and hauls, out of phase with
    // the others so the whole machine reads as walking down toward you.
    const phase = age * 1.5 + data.socket * (Math.PI / 2);
    const stride = Math.sin(phase);
    enemy.mesh.position.copy(walker.position)
      .addScaledVector(WALKER_RIGHT, socket[0] + stride * 2.2)
      .addScaledVector(WALKER_UP, socket[1] + Math.cos(phase) * 3.4);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(data.socket * (Math.PI / 2) + stride * 0.22);
    enemy.mesh.userData.stride = stride;
    return false;
  }

  function summaryLine() {
    if (!walker.spawned) return undefined;
    if (walker.killed) {
      return walker.reachedCar ? 'The Descender was pried off the car' : 'The Descender never reached the car';
    }
    const left = walker.armIds.size;
    return `The Descender still holds the tether (${left} arm${left === 1 ? '' : 's'} left)`;
  }

  return {
    updateCore,
    updateClamp,
    coreKilled: () => walker.killed,
    reachedCar: () => walker.reachedCar,
    descent: () => walker.descent,
    distance: () => walker.distance,
    summaryLine,
  };
}

export type Descender = ReturnType<typeof createDescender>;
