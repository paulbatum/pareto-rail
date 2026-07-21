import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { createBreech, createInterlockEntries } from './breech';
import {
  bar,
  MASS_DRIVER_BEAT,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MUZZLE_TIME,
  RING_COUNT,
} from './timing';

// MASS DRIVER — 60 seconds down the bore of an orbital railgun, in six movements
// scored to 144 BPM (36 bars = exactly 60 s):
//
//   Breech      (0–10s)      The payload seats. Coils bite, one per beat.
//   Accel       (10–23.3s)   Defence drones start threading between the coils.
//   Overdrive   (23.3–36.7s) Coil spacing opens up; clamp drones ride the rings in.
//   Fault       (36.7–43.3s) The safety interlocks jam. The firing charge builds.
//   Interlock   (43.3–56.7s) Six jammed safeties. Clear them before the charge peaks.
//   Muzzle      (56.7–60s)   The gun fires — or the barrel does.
//
// The signature: the camera crosses exactly one accelerator ring per beat for
// the whole run. Ring n is planted at rail parameter `runProgress(n * beat)`,
// so the identity holds by construction no matter what the speed curve does.
// Because the curve only ever accelerates, the rings physically spread apart as
// the run goes on while the strobe stays locked to the pulse — speed and tempo
// are the same quantity, which is the whole idea of the level.

export const MASS_DRIVER_PLAYER_HEALTH = 3;

export type MassDriverEnemyKind = 'sentry' | 'weaver' | 'clamp' | 'lance' | 'interlock';

export type MassDriverSpawnData =
  | { role: 'sentry'; lead: number; angle: number; radius: number; spin: number; seed: number; salvo: number }
  | { role: 'weaver'; lead: number; fromX: number; toX: number; y: number; arc: number; crossTime: number; delay: number }
  | { role: 'clamp'; lead: number; angle: number; spin: number; closeTime: number }
  // The engine grants hostile shots lock and volley priority by reading `role`,
  // and it only recognises its own two names. Lances are this level's homing
  // hazard, so they carry the engine-facing role while keeping their own kind,
  // score, and look.
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; socket: number };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// ---- barrel geometry --------------------------------------------------------

/** Inner wall of the bore. Every fight in this level happens inside this tube. */
export const BARREL_RADIUS = 17;
/** Radius the accelerator coils sit at, just inboard of the wall. */
export const RING_RADIUS = 13.2;
/** Radius of the conductor rails running the length of the bore. */
export const CONDUCTOR_RADIUS = 15.4;

// ---- speed profile → rail easing -------------------------------------------

// One monotone acceleration from breech to muzzle, then the launch itself.
// Nothing here ever slows down: a mass driver only does one thing.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.62],
  [bar(6), 0.8],
  [bar(14), 1.0],
  [bar(22), 1.18],
  [bar(26), 1.3],
  [bar(31), 1.5],
  [bar(34), 1.7],
  [bar(36), 3.0],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for planting set pieces. */
export const railU = (time: number) => massDriverRunProgress(time);

// ---- rail -------------------------------------------------------------------

// A gun barrel is straight. This one runs 1350 units and drifts about four
// units across its entire length — the sag of something kilometres long, alive
// enough to keep the bore from reading as a tube of stills, never a corner.
export function createMassDriverRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(1.6, -1.1, -150),
      new Vector3(-2.4, 1.8, -300),
      new Vector3(3.2, 1.0, -450),
      new Vector3(-1.6, -2.0, -600),
      new Vector3(2.6, 1.9, -750),
      new Vector3(-3.4, -0.8, -900),
      new Vector3(1.8, 1.7, -1050),
      new Vector3(-1.4, -1.0, -1200),
      new Vector3(0, 0, -1350),
    ],
    false,
    'catmullrom',
    0.5,
  );
}

// ---- the coil table ---------------------------------------------------------

/**
 * Rail parameter of every accelerator coil, one per beat up to the muzzle.
 * `RING_US[n]` is where the camera stands on beat `n`, so crossing ring `n`
 * *is* beat `n`. Visuals read this table; nothing else defines ring placement.
 */
export const RING_US: number[] = Array.from({ length: RING_COUNT + 1 }, (_unused, index) =>
  massDriverRunProgress(Math.min(MASS_DRIVER_DURATION, index * MASS_DRIVER_BEAT)));

/** Rail parameter of the muzzle. Past this the barrel ends and space begins. */
export const MUZZLE_U = massDriverRunProgress(MUZZLE_TIME);

// ---- spawn timeline ---------------------------------------------------------

const TAU = Math.PI * 2;
/** Clock position on the barrel wall, in sixths. */
const clock = (sixth: number) => (sixth / 6) * TAU;

/**
 * Sentries hold station at a radius and wheel around the bore axis. `angle` is
 * their clock position on the wall, so a formation reads as a ring of hostiles
 * the player sweeps *around* rather than across.
 */
const sentries = (
  time: number,
  lead: number,
  spin: number,
  stations: Array<[angle: number, radius: number]>,
  options: { stagger?: number; salvo?: number } = {},
): MassDriverSpawnEntry[] =>
  stations.map(([angle, radius], index) => ({
    time: time + index * (options.stagger ?? 0.11),
    kind: 'sentry',
    data: {
      role: 'sentry',
      lead,
      angle,
      radius,
      spin,
      seed: time * 1.7 + index * 2.3,
      salvo: options.salvo ?? 0,
    },
  }));

/** Weavers slalom across the bore, ducking through the gaps between coils. */
const weavers = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; crossTime?: number; delay?: number }>,
): MassDriverSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.09,
    kind: 'weaver',
    data: {
      role: 'weaver',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      crossTime: run.crossTime ?? 2.4,
      delay: run.delay ?? index * 0.34,
    },
  }));

/** Clamps board a coil at full bore radius, then release and screw inward. */
const clamps = (
  time: number,
  lead: number,
  entries: Array<[angle: number, spin: number]>,
): MassDriverSpawnEntry[] =>
  entries.map(([angle, spin], index) => ({
    time: time + index * 0.26,
    kind: 'clamp',
    hitStages: [2, 2],
    data: { role: 'clamp', lead, angle, spin, closeTime: lead * 0.82 },
  }));

// Crossing extent for weavers. The bore wall is at BARREL_RADIUS, so targets
// have to stay comfortably inside it — anything further out is behind the wall
// from the payload's point of view, which is both wrong and unshootable.
const CROSS = 12.6;

function buildTimeline(interlockEntries: MassDriverSpawnEntry[]): MassDriverSpawnEntry[] {
  return [
    // --- Breech (bars 0–6). Wide, slow, unmissable. Teach that targets live on
    // the barrel wall, not in front of your nose.
    ...sentries(bar(1), 3.4, 0.5, [[clock(1), 10.5], [clock(4), 10.5]]),
    ...sentries(bar(2.5), 3.4, -0.45, [[clock(0), 11], [clock(2), 11], [clock(4), 11]]),
    ...weavers(bar(4), 3.3, [
      { fromX: -CROSS, toX: CROSS, y: 5.4, arc: 2.2 },
      { fromX: -CROSS, toX: CROSS, y: -5.6, arc: -2.0, delay: 0.4 },
    ]),
    ...sentries(bar(5), 3.3, 0.55, [[clock(3), 9.5], [clock(1), 12], [clock(5), 12]]),

    // --- Acceleration (bars 6–14). Two-bar cadence; full six-lock rings arrive.
    ...sentries(bar(6), 3.2, 0.6, [
      [clock(0), 11], [clock(1), 11], [clock(2), 11], [clock(3), 11], [clock(4), 11], [clock(5), 11],
    ], { stagger: 0.09 }),
    ...weavers(bar(7.5), 3.1, [
      { fromX: -CROSS, toX: CROSS, y: 6.4, arc: 1.8 },
      { fromX: CROSS, toX: -CROSS, y: -4.2, arc: -2.6, delay: 0.3 },
      { fromX: -CROSS, toX: CROSS, y: -7.4, arc: 1.6, delay: 0.6 },
    ]),
    ...clamps(bar(9), 3.4, [[clock(2), 0.42], [clock(5), -0.42]]),
    ...sentries(bar(10), 3.1, -0.62, [[clock(1), 12], [clock(3), 9.6], [clock(5), 12]]),
    ...weavers(bar(11), 3.0, [
      { fromX: -CROSS, toX: CROSS, y: 4.2, arc: 2.8, delay: 0 },
      { fromX: CROSS, toX: -CROSS, y: 7.6, arc: -1.8, delay: 0.26 },
      { fromX: -CROSS, toX: CROSS, y: -6.6, arc: 2.0, delay: 0.52 },
      { fromX: CROSS, toX: -CROSS, y: -4.0, arc: -2.6, delay: 0.78 },
    ]),
    ...sentries(bar(12), 3.0, 0.66, [
      [clock(0), 10], [clock(1.5), 12.5], [clock(3), 10], [clock(4.5), 12.5],
    ], { salvo: 1 }),

    // --- Overdrive (bars 14–22). The barrel starts shooting back.
    ...sentries(bar(14), 2.9, 0.7, [
      [clock(0.5), 11.5], [clock(1.5), 11.5], [clock(2.5), 11.5],
      [clock(3.5), 11.5], [clock(4.5), 11.5], [clock(5.5), 11.5],
    ], { stagger: 0.08, salvo: 1 }),
    ...clamps(bar(15.5), 3.0, [[clock(1), 0.5], [clock(4), -0.5]]),
    ...weavers(bar(16.5), 2.8, [
      { fromX: -CROSS, toX: CROSS, y: 5.8, arc: 2.4, crossTime: 2.1 },
      { fromX: CROSS, toX: -CROSS, y: -5.8, arc: -2.4, crossTime: 2.1, delay: 0.24 },
      { fromX: -CROSS, toX: CROSS, y: 8.2, arc: 1.4, crossTime: 2.1, delay: 0.48 },
    ]),
    ...sentries(bar(17.5), 2.8, -0.72, [[clock(2), 12.5], [clock(4), 12.5], [clock(0), 9.4]], { salvo: 1 }),
    ...clamps(bar(19), 2.9, [[clock(0), 0.55], [clock(2), -0.55], [clock(4), 0.55]]),
    ...weavers(bar(20), 2.7, [
      { fromX: -CROSS, toX: CROSS, y: -4.4, arc: -3.0, crossTime: 2.0, delay: 0 },
      { fromX: CROSS, toX: -CROSS, y: 5.2, arc: 2.6, crossTime: 2.0, delay: 0.22 },
      { fromX: -CROSS, toX: CROSS, y: 8.4, arc: 1.4, crossTime: 2.0, delay: 0.44 },
      { fromX: CROSS, toX: -CROSS, y: -8.0, arc: -1.6, crossTime: 2.0, delay: 0.66 },
    ]),
    ...sentries(bar(21), 2.7, 0.75, [
      [clock(0), 12], [clock(1), 12], [clock(2), 12],
      [clock(3), 12], [clock(4), 12], [clock(5), 12],
    ], { stagger: 0.075, salvo: 1 }),

    // --- Fault (bars 22–26). Pressure thins out on purpose: this is where the
    // charge becomes audible and the interlocks light up down the bore.
    ...weavers(bar(23), 2.7, [
      { fromX: -CROSS, toX: CROSS, y: 4.6, arc: 2.6, crossTime: 2.2 },
      { fromX: CROSS, toX: -CROSS, y: -6.4, arc: -2.0, crossTime: 2.2, delay: 0.36 },
    ]),
    ...sentries(bar(24.5), 2.6, 0.7, [[clock(1), 11.5], [clock(3), 11.5], [clock(5), 11.5]]),

    // --- Interlock (bars 26–34). Six jammed safeties around the bore, plus just
    // enough drone traffic that you have to choose what a volley is worth.
    ...interlockEntries,
    ...weavers(bar(28), 2.4, [
      { fromX: -CROSS, toX: CROSS, y: 7.0, arc: 1.6, crossTime: 1.9 },
      { fromX: CROSS, toX: -CROSS, y: -7.0, arc: -1.6, crossTime: 1.9, delay: 0.3 },
    ]),
    ...weavers(bar(30.5), 2.3, [
      { fromX: CROSS, toX: -CROSS, y: 5.0, arc: 2.2, crossTime: 1.8 },
      { fromX: -CROSS, toX: CROSS, y: -5.0, arc: -2.2, crossTime: 1.8, delay: 0.28 },
    ]),
    // The last drones in the barrel. A perfect player who has already cleared
    // the safeties still has something to shoot on the way to the muzzle.
    ...sentries(bar(32.4), 2.2, 0.8, [
      [clock(0.5), 12], [clock(2.5), 12], [clock(4.5), 12],
    ], { stagger: 0.1 }),
    ...weavers(bar(33.2), 2.0, [
      { fromX: -CROSS, toX: CROSS, y: 6.2, arc: 1.8, crossTime: 1.5 },
      { fromX: CROSS, toX: -CROSS, y: -6.2, arc: -1.8, crossTime: 1.5, delay: 0.22 },
    ]),
  ];
}

export function createMassDriverTimeline() {
  const interlocks = createInterlockEntries();
  return { interlocks, timeline: sortTimeline(buildTimeline(interlocks.timeline)) };
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = createMassDriverTimeline().timeline;

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  sentry: 120,
  weaver: 150,
  clamp: 340,
  lance: 50,
  interlock: 900,
};

const LANCE_MAX_AGE = 11;
const MISS_GRACE_U = 0.006;

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const { timeline, interlocks } = createMassDriverTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let lancesDowned = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    lancesDowned = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  function fireLance(context: MassDriverUpdate, from: Vector3, speed = 5) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'lance',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const breech = createBreech(bus, { entries: interlocks, fireLance });

  // ---- movement -------------------------------------------------------------

  function updateSentry(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'sentry' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);

    // Station-keeping on the barrel wall: it wheels around the bore axis, so a
    // formation rotates as a unit and the player's sweep is a circular gesture.
    const theta = data.angle + age * data.spin;
    const radius = data.radius + Math.sin(age * 1.6 + data.seed) * 0.7;
    const offset = new Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius, 0);

    // Telegraphed salvo: it cants forward off the wall, then spits a lance.
    if (data.salvo > 0) {
      const fire = context.enemyState(() => ({ nextAt: 1.5 }));
      const until = fire.nextAt - age;
      const charging = until < 0.5 && until > 0;
      if (charging) offset.z += (0.5 - until) * 5;
      if (age >= fire.nextAt) {
        fire.nextAt = age + 2.6;
        fireLance(context, enemy.mesh.position);
      }
      enemy.mesh.userData.charging = charging;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Blades stay radial: the drone keeps its spine to the wall it patrols.
    enemy.mesh.rotateZ(theta + Math.PI / 2);
    enemy.mesh.rotateX(Math.sin(age * 2.1 + data.seed) * 0.35);
    return runProgress > anchorU + MISS_GRACE_U;
  }

  function updateWeaver(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'weaver' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.2 || runProgress > anchorU + MISS_GRACE_U) return true;

    // Threading the coils: a fast vertical slalom laid over the long crossing,
    // so it visibly ducks through the gap between one ring and the next.
    const place = (u: number) => {
      const eased = u * u * (3 - 2 * u);
      return new Vector3(
        MathUtils.lerp(data.fromX, data.toX, eased),
        data.y + Math.sin(u * Math.PI) * data.arc + Math.sin(u * Math.PI * 5) * 1.5,
        0,
      );
    };

    const clamped = MathUtils.clamp(t, 0, 1);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, place(clamped)));
    enemy.mesh.lookAt(offsetFromRail(curve, anchorU, place(Math.min(1, clamped + 0.03))));
    enemy.mesh.rotateZ(age * 7);
    return false;
  }

  function updateClamp(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'clamp' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);

    // It boards on a coil at full bore radius and unwinds inward toward the
    // payload — a slow screw down the barrel wall into your lane.
    const close = MathUtils.clamp(age / data.closeTime, 0, 1);
    const eased = close * close * (3 - 2 * close);
    const radius = MathUtils.lerp(RING_RADIUS, 8.6, eased);
    const theta = data.angle + age * data.spin;
    const offset = new Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius, 0);

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(theta * 1.4 + age * 0.5);
    // Armour cracked: the exposed core judders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 24) * 0.13;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.11;
    }
    return runProgress > anchorU + MISS_GRACE_U;
  }

  function updateLance(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: interceptions.delete(enemy.id),
      config: { hitDistance: 2.5, impactBrake: 0.38, damageDistance: 0.7 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 11);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6.5,
      maxSpeed: 15,
      accel: 3.8,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > LANCE_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: timeline,
    easeRunProgress: massDriverRunProgress,
    startWord: 'LAUNCH',
    // The bore is wide and targets ride its wall, so the sweep is a big circular
    // gesture. A slightly tighter lock radius keeps that gesture deliberate
    // instead of hoovering up half the ring on one pass.
    lockRadiusNdc: 0.078,
    // Everything here is on the pulse. Shots collapse onto a tight grid so a
    // six-lock volley lands as a drum fill instead of a smear of impacts.
    timing: { shotDelay: { maxGridSeconds: 0.16 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'sentry':
          return updateSentry(context, data);
        case 'weaver':
          return updateWeaver(context, data);
        case 'clamp':
          return updateClamp(context, data);
        case 'bolt':
          return updateLance(context, data);
        case 'interlock':
          return breech.updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'lance') lancesDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 55,
    scoreForVolley(results) {
      // Six coils, six locks. A full clean volley is this level's signature.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // Nothing above C if the gun never fired. The run has one job.
      if (!breech.fired()) return clearRate >= 0.5 ? 'C' : 'D';
      if (score >= 17500 && clearRate >= 0.9) return 'S';
      if (score >= 13000 && clearRate >= 0.62) return 'A';
      if (score >= 8000 && clearRate >= 0.42) return 'B';
      return 'C';
    },
    detailsForRun() {
      const hull = Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`, breech.summaryLine()];
      if (lancesDowned > 0) lines.push(`${lancesDowned} lance${lancesDowned === 1 ? '' : 's'} intercepted`);
      return lines;
    },
  };
}
