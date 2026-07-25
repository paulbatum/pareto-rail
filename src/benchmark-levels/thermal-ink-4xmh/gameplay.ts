import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { formation, sortTimeline } from '../../engine/spawn-patterns';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  ARM_CONFIGS,
  ARM_COUNT,
  createOctopusBrain,
  octopusPose,
  poseOctopus,
} from './octopus';
import { THERMAL_INK_BARS, THERMAL_INK_BPM, THERMAL_INK_RUN_DURATION, THERMAL_INK_TIME, inkAtTime } from './timing';
import { INK_BLIND_THRESHOLD } from './vision';

// A drowned harbour, one creature, sixty seconds. There is no wave-then-boss
// structure here: the octopus is on screen from the first frame and every wave
// of scavengers is something it shakes loose. The fight's shape is the ink —
// three clouds that take normal sight away and hand back an infrared one.

export { THERMAL_INK_BPM, THERMAL_INK_RUN_DURATION } from './timing';
export const THERMAL_INK_PLAYER_HEALTH = 4;

export type ThermalInk4xmhEnemyKind = 'scuttler' | 'hatchling' | 'pod' | 'bolt' | 'arm' | 'core';

type WaveMotion = 'scuttle' | 'jet' | 'wallow';

type WaveData = {
  role: 'wave';
  motion: WaveMotion;
  lead: number;
  offset: Vector3;
  swing: number;
};

// Ink bolts take the engine's 'bolt' kind and role, which is what earns them
// lock and volley priority over the creature itself: an incoming bolt is always
// the thing the player is allowed to answer first.
type BoltData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

type ArmData = { role: 'arm'; index: number };
type CoreData = { role: 'core' };

export type ThermalInk4xmhSpawnData = WaveData | BoltData | ArmData | CoreData;
export type ThermalInkEntry = LockOnSpawnEntry<ThermalInk4xmhEnemyKind, ThermalInk4xmhSpawnData>;
export type ThermalInkUpdate = LockOnEnemyUpdate<ThermalInk4xmhEnemyKind, ThermalInk4xmhSpawnData>;

const time = THERMAL_INK_TIME;

// --- Rail ------------------------------------------------------------------
// A long banking arc around the flooded basin: out of the channel mouth, down
// under the wreck the creature is holding, and back up into the lamp line.
// Authored as (angle, radius, height) so the circling read stays legible. The
// last two keys are runway the player never reaches — RAIL_USE stops the run
// short of the end so there is always harbour ahead of the camera to see.
const RAIL_KEYS: Array<[angle: number, radius: number, height: number]> = [
  [0.00, 78, 12],
  [0.55, 72, 6],
  [1.15, 66, -1],
  [1.75, 61, -7],
  [2.40, 58, -12],
  [3.05, 57, -14],
  [3.70, 59, -11],
  [4.35, 62, -5],
  [5.00, 64, 1],
  [5.65, 63, 5],
  [6.30, 60, 2],
  [6.95, 55, -4],
  [7.60, 50, -9],
  [8.25, 46, -6],
  [8.80, 43, 2],
  [9.35, 42, 8],
  [9.90, 44, 13],
];

/** Fraction of the curve the run actually travels; the rest is scenery runway. */
const RAIL_USE = 0.87;

export function createThermalInk4xmhRail() {
  return new CatmullRomCurve3(
    RAIL_KEYS.map(([angle, radius, height]) => new Vector3(
      Math.sin(angle) * radius,
      height,
      -Math.cos(angle) * radius,
    )),
    false,
    'catmullrom',
    0.5,
  );
}

// Speed is authored against the clouds: the rail surges as the camera is
// dragged into each one and settles when the creature finally comes apart.
const SPEED_PROFILE = createSpeedProfile([
  [0, 0.52],
  [time.bar(2), 0.92],
  [time.bar(5.4), 1.22],
  [time.bar(8), 0.98],
  [time.bar(11.4), 1.26],
  [time.bar(14), 1.0],
  [time.bar(17), 1.1],
  [time.bar(19.4), 1.34],
  [time.bar(22.2), 0.72],
  [time.bar(24), 0.44],
], THERMAL_INK_RUN_DURATION);

// --- Spawn timeline --------------------------------------------------------

const WAVE_GAP = 0.13;

const wave = (
  bar: number,
  kind: Extract<ThermalInk4xmhEnemyKind, 'scuttler' | 'hatchling' | 'pod'>,
  motion: WaveMotion,
  lead: number,
  offsets: Array<[number, number]>,
): ThermalInkEntry[] => formation(time.bar(bar), WAVE_GAP, offsets, (offset, index) => ({
  kind,
  hitPoints: kind === 'pod' ? 2 : 1,
  data: {
    role: 'wave',
    motion,
    lead,
    offset: new Vector3(offset[0], offset[1], 0),
    swing: index * 1.37,
  } satisfies WaveData,
}));

const scuttlers = (bar: number, lead: number, offsets: Array<[number, number]>) => wave(bar, 'scuttler', 'scuttle', lead, offsets);
const hatchlings = (bar: number, lead: number, offsets: Array<[number, number]>) => wave(bar, 'hatchling', 'jet', lead, offsets);
const pods = (bar: number, lead: number, offsets: Array<[number, number]>) => wave(bar, 'pod', 'wallow', lead, offsets);

function createTimeline(): ThermalInkEntry[] {
  const arms: ThermalInkEntry[] = ARM_CONFIGS.map((config, index) => ({
    time: time.bar(config.bar),
    kind: 'arm',
    hitStages: [3, 3],
    data: { role: 'arm', index },
  }));

  const core: ThermalInkEntry = {
    time: time.bar(THERMAL_INK_BARS.expose),
    kind: 'core',
    hitStages: [2, 4],
    lockable: false,
    data: { role: 'core' },
  };

  return sortTimeline([
    ...arms,
    core,

    // --- Descent: scavengers come off the wreck first, from the edges.
    ...scuttlers(0.75, 3.4, [[-12, -1.5], [-8.5, 3.2], [8.5, 3.4], [12, -1.2]]),
    ...hatchlings(2.0, 3.3, [[-6.5, 6.4], [-2.2, 8.2], [6.5, 6.2]]),
    ...scuttlers(3.4, 3.2, [[-13, 2.4], [-9.5, -4.6], [9.5, -4.4]]),

    // --- Engage: the first arm is out. Broken machinery starts venting pods.
    ...pods(4.3, 3.5, [[-6.5, 4.8], [6.5, 5.2]]),
    ...hatchlings(5.2, 3.2, [[-10.5, -2.2], [-4, -5.4], [4.2, -5.2], [10.5, -1.8]]),

    // --- Ink A: the teaching blackout. These four only exist in infrared.
    ...hatchlings(6.5, 3.0, [[-9.5, 4.2], [-3.2, 7.4], [3.2, 7.2], [9.5, 4.0]]),
    ...scuttlers(7.4, 3.1, [[-12.5, -3.4], [-6, -6.6], [6, -6.4], [12.5, -3.2]]),

    // --- Surge: the murk comes back and the arms start spitting.
    ...scuttlers(8.4, 3.2, [[-13.5, 1.2], [-7.5, 5.6], [7.5, 5.4], [13.5, 1.0]]),
    ...pods(9.4, 3.4, [[-8.5, -3.6], [8.5, -3.4]]),
    ...hatchlings(10.2, 3.1, [[-7, 6.8], [2.4, -6.8], [7, 6.6]]),
    ...scuttlers(11.3, 3.0, [[-11, -5.2], [-4.5, 6.2], [4.5, 6.0], [11, -5.0]]),

    // --- Ink B: denser, and it lasts longer than you want it to.
    ...hatchlings(12.4, 3.0, [[-10, 2.6], [-3.5, -5.8], [3.5, -5.6], [10, 2.4]]),
    ...scuttlers(13.4, 3.0, [[-13, 4.2], [-2.6, -7.4], [13, 4.0]]),

    // --- Swarm: everything the wreck had left.
    ...hatchlings(14.4, 3.0, [[-8, 5.8], [-2.5, -4.2], [2.5, -4.4], [8, 5.6]]),
    ...pods(15.4, 3.3, [[-5.5, -5.4], [5.5, -5.2]]),
    ...scuttlers(16.3, 3.0, [[-14, -0.8], [-8, 6.4], [8, 6.2], [14, -1.0]]),
    ...hatchlings(17.3, 2.9, [[-11, -4.4], [-4, 7.0], [4, 6.8], [11, -4.2]]),
    ...scuttlers(18.3, 2.9, [[-9.5, 3.8], [2.8, -7.2], [9.5, 3.6]]),
    ...pods(19.4, 3.1, [[-7, 1.2], [7, 1.0]]),

    // --- Ink C: the last scavengers, then only the creature and the dark.
    ...scuttlers(20.7, 2.8, [[-12, -2.6], [12, -2.4]]),
    ...hatchlings(21.7, 2.7, [[-6.5, 5.4], [6.5, 5.2]]),
    // Last of the scavengers, arriving as the lamps come back up.
    ...scuttlers(22.6, 2.6, [[-10.5, 1.8], [10.5, 1.6]]),
  ]);
}

export const THERMAL_INK_SPAWN_TIMELINE: ThermalInkEntry[] = createTimeline();

const KILL_SCORE: Record<ThermalInk4xmhEnemyKind, number> = {
  scuttler: 100,
  hatchling: 110,
  pod: 190,
  bolt: 50,
  arm: 480,
  core: 2200,
};

const BOLT_MAX_AGE = 12;
const MISS_GRACE = 0.014;
/** The creature commits to opening even if arms are still swinging. */
const FORCE_EXPOSE = time.bar(THERMAL_INK_BARS.inkC + 0.35);

export function createThermalInk4xmhGameplay(bus: EventBus): LockOnRunnerLevel<ThermalInk4xmhEnemyKind, ThermalInk4xmhSpawnData> {
  const octopus = createOctopusBrain(bus);
  const timeline = createTimeline();
  const boltInterceptions = new Set<number>();
  const cameraPosition = new Vector3();
  let hitsTaken = 0;
  let nextBoltAt = time.bar(THERMAL_INK_BARS.surge);
  let denials = 0;
  // Gameplay reads the authored cloud straight off the clock rather than the
  // imager's live state: the rule is about where the creature is, not about
  // what the player can currently see.
  let cloud = 0;

  bus.on('runstart', () => {
    boltInterceptions.clear();
    hitsTaken = 0;
    denials = 0;
    cloud = 0;
    nextBoltAt = time.bar(THERMAL_INK_BARS.surge);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    boltInterceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
  });

  function fireBolt(context: ThermalInkUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0 },
    });
  }

  function updateWave(context: ThermalInkUpdate, data: WaveData) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    const side = Math.sign(offset.x) || 1;

    if (data.motion === 'scuttle') {
      // Scavengers hold the edge of the frame, then cut inward in short jerks —
      // the skitter is a hard sine riding a steady closing drift.
      offset.x -= side * (age * 1.55 + Math.sin(age * 7.4 + data.swing) * 0.55);
      offset.y += Math.sin(age * 6.1 + data.swing) * 0.85 + age * 0.35;
      offset.z = Math.sin(age * 2.6 + data.swing) * 0.9;
    } else if (data.motion === 'jet') {
      // Hatchlings swim on pulses: a jet, a glide, a jet.
      const pulse = age * 1.05 + Math.sin(age * 4.6 + data.swing) * 0.42;
      const heading = data.swing * 1.7;
      offset.x += Math.cos(heading) * pulse * 2.4 + Math.sin(age * 1.9 + data.swing) * 1.2;
      offset.y += Math.sin(heading) * pulse * 1.5 - age * 0.28;
      offset.z = Math.sin(age * 3.4 + data.swing) * 1.4;
    } else {
      // Vented machinery: heavy, tilting, and coming straight at the hull.
      offset.x += Math.sin(age * 0.9 + data.swing) * 1.6;
      offset.y += Math.cos(age * 0.7 + data.swing) * 0.9 - age * 0.55;
      offset.z = age * 1.15;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    if (data.motion === 'scuttle') {
      enemy.mesh.rotateZ(side * (0.35 + Math.sin(age * 8.2 + data.swing) * 0.18));
      enemy.mesh.rotateY(Math.sin(age * 1.4 + data.swing) * 0.35);
    } else if (data.motion === 'jet') {
      enemy.mesh.rotateZ(Math.sin(age * 2.1 + data.swing) * 0.9 + data.swing);
      enemy.mesh.rotateX(Math.sin(age * 3.1) * 0.3);
    } else {
      enemy.mesh.rotateZ(runTime * 0.55 + data.swing);
      enemy.mesh.rotateX(Math.sin(runTime * 0.8 + data.swing) * 0.45);
    }

    return runProgress > anchorU + MISS_GRACE;
  }

  function updateBolt(context: ThermalInkUpdate, data: BoltData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: boltInterceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.2,
      maxSpeed: 10.5,
      accel: 2.8,
      turnRate: 2.0,
    });

    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 2.6);

    return shotBehindCamera(camera, data.position) || age > BOLT_MAX_AGE;
  }

  // Bolts are the creature's cadence, not any one arm's: it spits them on its
  // own clock from whichever limb is still out, or from the beak once they are
  // all gone. Severing arms stops the swipes, never the ink.
  function tryFireBolt(context: ThermalInkUpdate) {
    const { runTime } = context;
    if (runTime < nextBoltAt) return;
    nextBoltAt = runTime + (runTime >= time.bar(THERMAL_INK_BARS.swarm) ? 2.9 : 3.9);
    const live = octopusPose.arms.filter((arm) => arm.alive);
    const source = live.length > 0
      ? live[Math.floor(runTime * 3.7) % live.length].tip
      : octopusPose.core;
    fireBolt(context, source);
  }

  function updateArm(context: ThermalInkUpdate, data: ArmData) {
    const { enemy, camera, runTime } = context;
    const pose = octopusPose.arms[data.index];
    if (!octopus.live[data.index]) octopus.registerArm(enemy.id, data.index);
    enemy.mesh.userData.armIndex = data.index;
    enemy.mesh.position.copy(pose.tip);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(runTime * 1.3 + data.index * 2.1) * 0.5);
    return false;
  }

  function updateCore(context: ThermalInkUpdate) {
    const { enemy, camera, runTime } = context;
    enemy.mesh.position.copy(octopusPose.core);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.9) * 0.35);
    enemy.mesh.userData.exposed = octopusPose.coreExposed;
    return false;
  }

  return {
    duration: THERMAL_INK_RUN_DURATION,
    bpm: THERMAL_INK_BPM,
    playerHealth: THERMAL_INK_PLAYER_HEALTH,
    createRail: createThermalInk4xmhRail,
    spawnTimeline: timeline,
    easeRunProgress: (runTime, duration) => SPEED_PROFILE.runProgress(runTime, duration) * RAIL_USE,
    // A heavy level wants its volleys to land like hammer blows rather than a
    // rattle, so the coarse end of the shot ramp is capped at a half bar.
    timing: { shotDelay: { maxGridSeconds: time.beats(2) } },
    updateAttractCamera({ camera, curve, modeTime, dt }) {
      // The creature is already here on the START screen, breathing in the murk.
      cameraPosition.copy(camera.position);
      poseOctopus({ curve, u: 0, time: modeTime, dt, cameraPosition }, octopus.live, octopus.uncoil);
    },
    updateCameraEffects({ camera, curve, runTime, runProgress, dt }) {
      cameraPosition.copy(camera.position);
      cloud = inkAtTime(runTime);
      octopus.updatePhase(runTime, dt, FORCE_EXPOSE);
      poseOctopus({ curve, u: runProgress, time: runTime, dt, cameraPosition }, octopus.live, octopus.uncoil);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role !== 'bolt') tryFireBolt(context);
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'arm':
          return updateArm(context, data);
        case 'core':
          octopus.registerCore(context.enemy.id, context.enemy.entry);
          return updateCore(context);
      }
    },
    // The beak only opens inside the cloud. Fire at the core while the ink is
    // thin and the shot is turned away — the last volley has to land blind.
    validateRelease(enemies) {
      const core = enemies.filter((enemy) => enemy.kind === 'core');
      if (core.length === 0 || cloud >= INK_BLIND_THRESHOLD) return true;
      denials += 1;
      bus.emit('shielded', {
        shields: core.map((enemy) => ({ enemyId: enemy.id, worldPosition: enemy.mesh.position.clone() })),
        blockedEnemyIds: core.map((enemy) => enemy.id),
      });
      const allowed = enemies.filter((enemy) => enemy.kind !== 'core');
      return allowed.length > 0 ? allowed : false;
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 70,
    // A clean sweep pays: every kill past the first in one volley is worth an
    // extra beat of the creature's attention.
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      if (kills < 2) return 0;
      return (kills - 1) * 130;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (octopus.coreKilled && score >= 19000 && clearRate >= 0.85) return 'S';
      if (octopus.coreKilled && score >= 14000 && clearRate >= 0.68) return 'A';
      if (score >= 9000 && clearRate >= 0.45) return 'B';
      if (score >= 4500 && clearRate >= 0.28) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, THERMAL_INK_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${THERMAL_INK_PLAYER_HEALTH}`, octopus.summary()];
      if (denials > 0) lines.push(`${denials} volley${denials === 1 ? '' : 's'} turned by the beak`);
      return lines;
    },
  };
}

/** Eased rail progress at a run time — the environment places its clouds with it. */
export function thermalInkRunProgress(runTime: number) {
  return SPEED_PROFILE.runProgress(runTime, THERMAL_INK_RUN_DURATION) * RAIL_USE;
}

/** Authored ink density at a run time, shared by the runtime, audio, and visuals. */
export function inkDensityAt(runTime: number) {
  return MathUtils.clamp(inkAtTime(runTime), 0, 1);
}

export const THERMAL_INK_ARM_COUNT = ARM_COUNT;
