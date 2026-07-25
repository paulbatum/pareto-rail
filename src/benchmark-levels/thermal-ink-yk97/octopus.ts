import { MathUtils, Vector3 } from 'three';
import type { CatmullRomCurve3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { INK_MARKERS, INK_TIME, INK_BARS } from './timing';
import type { ThermalSpawnEntry, ThermalUpdate } from './gameplay';

// The octopus is not itself a target: its body is environment-side scenery
// anchored a fixed distance ahead of the camera, so it holds the screen while
// the rail circles the harbor. What the player fights are six arm-tip targets
// sweeping around the body and, at the end, the core in its split mantle.

export const BOSS_AHEAD = 30;
export const ARM_COUNT = 6;

// Per-arm home placement around the body, in screen-ellipse terms: angle in
// degrees plus per-arm radii. Spread covers both edges, the top, and the low
// band so the sweep works the whole viewport.
const ARM_ANGLES = [142, 38, 205, -25, 90, 268];
const ARM_RX = [10.2, 10.2, 9.4, 9.4, 7.2, 8.2];
const ARM_RY = [5.6, 5.6, 4.6, 4.6, 7.8, 6.4];

const swayScratch = new Vector3();

/** Boss body center: seated ahead of the camera with a heavy, slow sway. Visuals and gameplay share this. */
export function bossCenter(curve: CatmullRomCurve3, runProgress: number, runTime: number, target: Vector3) {
  swayScratch.set(
    Math.sin(runTime * 0.42) * 2.2,
    2.4 + Math.sin(runTime * 0.61) * 1.4,
    BOSS_AHEAD + Math.sin(runTime * 0.27) * 1.2,
  );
  target.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 1), swayScratch));
  return target;
}

export type OctopusSpawnData =
  | { role: 'arm'; index: number }
  | { role: 'core' };

export function createOctopus(bus: EventBus) {
  const center = new Vector3();
  let coreId = -1;
  let coreSpawned = false;
  let coreKilled = false;
  let coreExposed = false;
  let armsSpawned = 0;
  let armsDown = 0;
  const armIds = new Set<number>();
  let coreEntry: ThermalSpawnEntry | undefined;

  bus.on('runstart', () => {
    coreId = -1;
    coreSpawned = false;
    coreKilled = false;
    coreExposed = false;
    armsSpawned = 0;
    armsDown = 0;
    armIds.clear();
    if (coreEntry) coreEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'arm') {
      armIds.add(enemyId);
      armsSpawned += 1;
    }
    if (kind === 'core') {
      coreSpawned = true;
      coreId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  bus.on('kill', ({ enemyId }) => {
    if (armIds.delete(enemyId)) armsDown += 1;
    if (enemyId === coreId && !coreKilled) {
      coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  function entries(): ThermalSpawnEntry[] {
    // The core target arrives just before the final ejection: earlier, and the
    // (unlockable) center target starves lock policies aimed at the fight.
    const core: ThermalSpawnEntry = {
      time: INK_TIME.bar(19.7),
      kind: 'core',
      hitStages: [2, 6],
      lockable: false,
      data: { role: 'core' },
    };
    coreEntry = core;
    const pairTimes = [
      INK_TIME.bar(INK_BARS.armsA),
      INK_TIME.bar(INK_BARS.armsB),
      INK_TIME.bar(INK_BARS.armsC),
    ];
    const arms: ThermalSpawnEntry[] = [];
    for (let index = 0; index < ARM_COUNT; index += 1) {
      arms.push({
        time: pairTimes[Math.floor(index / 2)] + (index % 2) * 0.22,
        kind: 'arm',
        hitPoints: 2,
        data: { role: 'arm', index },
      });
    }
    return [core, ...arms];
  }

  function updateArm(context: ThermalUpdate, data: Extract<OctopusSpawnData, { role: 'arm' }>) {
    const { enemy, runTime, runProgress, age, curve, camera } = context;
    bossCenter(curve, runProgress, runTime, center);

    // Slow predatory sweep around the body: angle wobble, radius breathing, and
    // a reach toward the camera that peaks per-arm out of phase.
    const home = MathUtils.degToRad(ARM_ANGLES[data.index]);
    const angle = home + Math.sin(runTime * 0.5 + data.index * 1.9) * 0.24;
    const breathe = 1 + Math.sin(runTime * 0.8 + data.index * 2.4) * 0.09;
    // Unfurl on the camera side of the mantle: while growing out to its home
    // radius the arm also reaches forward, so it never hides behind the body.
    const grow = 1 - Math.exp(-age * 1.8) * 0.45;
    const reach = Math.sin(runTime * 0.62 + data.index * 1.1) * 2.4 - 1.2 - (1 - grow) * 10;

    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const forward = new Vector3();
    camera.getWorldDirection(forward);

    enemy.mesh.position
      .copy(center)
      .addScaledVector(right, Math.cos(angle) * ARM_RX[data.index] * breathe * grow)
      .addScaledVector(up, Math.sin(angle) * ARM_RY[data.index] * breathe * grow)
      .addScaledVector(forward, reach);
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Club tip rolls as the arm writhes; wounded arms (stage HP down) shudder.
    enemy.mesh.rotateZ(angle + Math.sin(runTime * 1.4 + data.index) * 0.5);
    if (enemy.hitPointsRemaining < 2) {
      enemy.mesh.position.addScaledVector(right, Math.sin(age * 19) * 0.16);
      enemy.mesh.position.addScaledVector(up, Math.cos(age * 23) * 0.13);
    }
    return false;
  }

  function updateCore(context: ThermalUpdate, _data: Extract<OctopusSpawnData, { role: 'core' }>) {
    const { enemy, runTime, runProgress, curve, camera, age } = context;
    bossCenter(curve, runProgress, runTime, center);

    // The core only becomes a legal target once every arm is severed AND the
    // final blackout has begun — the last volley always lands through ink.
    const exposedNow = armsSpawned >= ARM_COUNT && armIds.size === 0 && runTime >= INK_MARKERS.ink3;
    if (exposedNow && !coreExposed && !coreKilled) {
      coreExposed = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
    enemy.entry.lockable = coreExposed && !coreKilled;

    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const jitter = coreExposed ? 1 : 0;
    enemy.mesh.position
      .copy(center)
      .addScaledVector(forward, -5.5)
      .add(new Vector3(
        Math.sin(runTime * 2.3) * 0.5 * jitter,
        Math.sin(runTime * 2.9) * 0.4 * jitter - 0.4,
        0,
      ));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.7) * 0.2);
    enemy.mesh.userData.exposed = coreExposed;
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(age * (coreExposed ? 7 : 2.6));
    return false;
  }

  function update(context: ThermalUpdate, data: OctopusSpawnData) {
    return data.role === 'arm' ? updateArm(context, data) : updateCore(context, data);
  }

  return {
    entries,
    update,
    armsDown: () => armsDown,
    coreSpawned: () => coreSpawned,
    coreKilled: () => coreKilled,
    coreExposed: () => coreExposed,
    summary() {
      if (!coreSpawned) return undefined;
      if (coreKilled) return 'Harbor octopus destroyed';
      return `Octopus survived — ${armsDown}/${ARM_COUNT} arms severed`;
    },
  };
}

export type Octopus = ReturnType<typeof createOctopus>;
