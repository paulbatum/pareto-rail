import { MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import type { EventBus } from '../../events';
import {
  barrelRadiusAt,
  boreOffset,
  createMassDriverRail,
  massDriverRunProgress,
  railBasis,
} from './barrel';
import { createInterlockBank, INTERLOCK_SOCKETS } from './interlocks';
import {
  INTERLOCK_SPAWN_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  at,
} from './timing';

// MASS DRIVER — sixty seconds inside an orbital railgun that is already firing.
//
//   bars  0–3    Breech        packed coils, the hum is barely audible
//   bars  4–11   Stage one     defence drones start threading the accelerator
//   bars 12–19   Stage two     rings spread, armour arrives, the bore glows violet
//   bars 20–23   Jam           the safety interlocks seize; the charge starts
//   bars 24–31   Overload      four interlocks, one charge timer, no extensions
//   bars 32–35   Muzzle        the gun fires and the noise stops
//
// The rail's progress easing is the normalized integral of the speed curve in
// barrel.ts, so accelerator rings authored at runProgress(beat) are crossed on
// the beat for the whole run while their spacing quadruples underneath you.

export { MASS_DRIVER_BPM, MASS_DRIVER_DURATION, MUZZLE_TIME } from './timing';
export { createMassDriverRail, massDriverRunProgress, speedFactorAt } from './barrel';

export const MASS_DRIVER_PLAYER_HEALTH = 3;

/** Below this many locks the capacitor bank will not discharge — bolts excepted. */
export const MIN_DISCHARGE_LOCKS = 2;

export type MassDriverEnemyKind = 'sentry' | 'skimmer' | 'weaver' | 'arcnode' | 'interlock' | 'bolt';

// Timeline data is immutable: the engine reuses the same entries across runs.
// Per-enemy mutable state lives in the runner's enemyState bags, run state
// lives in this module, and bolts get a fresh data object per launch.
export type MassDriverSpawnData =
  | { role: 'sentry'; engagement: RailLead; angle: number; spin: number; bore: number; fireDelay: number }
  | { role: 'skimmer'; engagement: RailLead; angle: number; spin: number; bore: number; wobble: number }
  | { role: 'weaver'; engagement: RailLead; fromBore: number; toBore: number; height: number; arc: number; crossTime: number; delay: number }
  | { role: 'arcnode'; engagement: RailLead; angle: number; drift: number; swingTime: number }
  | { role: 'interlock'; socket: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

const rail = createMassDriverRail();

// Fixed anchors would sit past the fog wall once bore speed doubles, so leads
// are paced: `lead` still means "overtaken this many seconds after spawn", and
// the pacer compresses the approach to fit the visibility budget.
const pacer = createRailPacer({
  curve: rail,
  duration: MASS_DRIVER_DURATION,
  runProgress: massDriverRunProgress,
  // Kept deliberately tight. A wider budget lets targets spawn far down the
  // bore, where they are both hard to read and clustered near the vanishing
  // point; pulling it in puts engagements across the full width of the frame.
  spawnAheadUnits: 76,
  defaultLeadSeconds: 2.9,
});

export { pacer as massDriverPacer };

const MISS_GRACE = 0.14;
/** Furthest a target may sit from the bore axis before wall plate can occlude it. */
const SENTRY_MAX_BORE = 0.84;
const WEAVER_MAX_BORE = 0.8;
const BOLT_MAX_AGE = 9;
const DEG = Math.PI / 180;

// ---- spawn builders ---------------------------------------------------------
// Positions are authored as bore fractions (0 at the axis, 1 at the wall) so a
// wave keeps its shape as the barrel narrows toward the muzzle.

type SentrySpec = { angle: number; spin?: number; bore?: number; fire?: number };

const sentries = (time: number, lead: number, specs: SentrySpec[]): MassDriverSpawnEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * 0.075,
    kind: 'sentry',
    data: {
      role: 'sentry',
      engagement: pacer.resolve(time + index * 0.075, lead),
      angle: spec.angle * DEG,
      spin: (spec.spin ?? 26) * DEG,
      bore: spec.bore ?? 0.82,
      fireDelay: spec.fire ?? Infinity,
    },
  }));

type SkimmerSpec = { angle: number; bore?: number; spin?: number; wobble?: number };

const skimmers = (time: number, lead: number, specs: SkimmerSpec[]): MassDriverSpawnEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * 0.09,
    kind: 'skimmer',
    data: {
      role: 'skimmer',
      engagement: pacer.resolve(time + index * 0.09, lead),
      angle: spec.angle * DEG,
      spin: (spec.spin ?? 190) * DEG,
      bore: spec.bore ?? 0.44,
      wobble: spec.wobble ?? 0.3,
    },
  }));

type WeaverSpec = { from: number; to: number; height: number; arc?: number; delay?: number; cross?: number };

const weavers = (time: number, lead: number, specs: WeaverSpec[]): MassDriverSpawnEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * 0.06,
    kind: 'weaver',
    data: {
      role: 'weaver',
      engagement: pacer.resolve(time + index * 0.06, lead),
      fromBore: spec.from,
      toBore: spec.to,
      height: spec.height,
      arc: spec.arc ?? 0.22,
      crossTime: spec.cross ?? 2.3,
      delay: spec.delay ?? index * 0.24,
    },
  }));

const arcnodes = (time: number, lead: number, specs: Array<{ angle: number; drift?: number }>): MassDriverSpawnEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * 0.18,
    kind: 'arcnode',
    hitStages: [2, 2],
    data: {
      role: 'arcnode',
      engagement: pacer.resolve(time + index * 0.18, lead),
      angle: spec.angle * DEG,
      drift: (spec.drift ?? 14) * DEG,
      swingTime: 1.9,
    },
  }));

const interlocks = (): MassDriverSpawnEntry[] =>
  INTERLOCK_SOCKETS.map((_socketAngle, socket) => ({
    time: INTERLOCK_SPAWN_TIME + socket * 0.16,
    kind: 'interlock' as const,
    hitStages: [2, 3],
    data: { role: 'interlock' as const, socket },
  }));

// ---- the timeline -----------------------------------------------------------
// Waves are written against bars. Sentries ride the bore wall, so they arrive at
// the screen edges; weavers cut the full width; skimmers corkscrew through the
// middle distance. Between them a wave nearly always offers six locks spread
// across the frame rather than a cluster to camp on.

function buildTimeline(): MassDriverSpawnEntry[] {
  return [
    // --- Breech. Two clean shapes, nothing armoured, nothing shooting.
    ...weavers(at(2), 3.0, [
      { from: -0.86, to: 0.86, height: 0.16 },
      { from: 0.86, to: -0.86, height: -0.3, arc: 0.3 },
    ]),
    ...sentries(at(3), 3.0, [{ angle: 118 }, { angle: 62 }]),

    // --- Stage one. The wall wakes up; sentries start shooting at bar 8.
    ...sentries(at(4), 3.0, [{ angle: 160 }, { angle: 20 }, { angle: 90, bore: 0.7 }]),
    ...weavers(at(5), 2.9, [
      { from: -0.9, to: 0.9, height: -0.42, arc: 0.34 },
      { from: -0.9, to: 0.9, height: 0.34, arc: 0.18 },
      { from: 0.9, to: -0.9, height: 0.02, arc: 0.26 },
    ]),
    ...skimmers(at(6), 2.9, [{ angle: 40, bore: 0.5 }, { angle: 220, bore: 0.5 }]),
    ...sentries(at(6, 2), 2.9, [{ angle: 205, spin: -24 }, { angle: 335, spin: -24 }]),
    ...weavers(at(7), 2.8, [
      { from: -0.92, to: 0.55, height: 0.44, arc: 0.14 },
      { from: 0.92, to: -0.55, height: -0.44, arc: 0.14 },
      { from: -0.6, to: 0.92, height: -0.08, arc: 0.28 },
      { from: 0.6, to: -0.92, height: 0.2, arc: 0.28 },
    ]),
    ...arcnodes(at(8), 3.2, [{ angle: 250 }]),
    ...sentries(at(8, 2), 2.9, [{ angle: 30, fire: 1.5 }, { angle: 150, fire: 1.8 }, { angle: 90, bore: 0.6 }]),
    ...weavers(at(9), 2.8, [
      { from: -0.9, to: 0.9, height: 0.46, arc: 0.12, cross: 2.1 },
      { from: 0.9, to: -0.9, height: 0.14, arc: 0.22, cross: 2.1 },
      { from: -0.9, to: 0.9, height: -0.2, arc: 0.26, cross: 2.1 },
      { from: 0.9, to: -0.9, height: -0.5, arc: 0.3, cross: 2.1 },
    ]),
    ...skimmers(at(10), 2.8, [{ angle: 0, bore: 0.55 }, { angle: 120, bore: 0.55 }, { angle: 240, bore: 0.55 }]),
    ...sentries(at(10, 2), 2.8, [{ angle: 195, fire: 1.6 }, { angle: 345, fire: 1.9 }]),
    ...weavers(at(11), 2.7, [
      { from: -0.88, to: 0.88, height: -0.36, arc: 0.4, cross: 2.0 },
      { from: 0.88, to: -0.88, height: 0.36, arc: -0.4, cross: 2.0 },
      { from: -0.5, to: 0.5, height: 0.0, arc: 0.5, cross: 2.0 },
    ]),

    // (bar 11.5–12 left clear: the stage-two drop wants an empty frame)

    // --- Stage two. Four-point ring formations, armour, live fire.
    ...sentries(at(12), 2.9, [{ angle: 90 }, { angle: 180 }, { angle: 270 }, { angle: 0 }]),
    ...weavers(at(13), 2.7, [
      { from: -0.9, to: 0.9, height: 0.5, arc: 0.1, cross: 2.0 },
      { from: 0.9, to: -0.9, height: -0.5, arc: 0.1, cross: 2.0 },
      { from: -0.9, to: 0.9, height: -0.14, arc: 0.3, cross: 2.0 },
      { from: 0.9, to: -0.9, height: 0.14, arc: -0.3, cross: 2.0 },
    ]),
    ...skimmers(at(14), 2.8, [{ angle: 60, bore: 0.6 }, { angle: 180, bore: 0.42 }, { angle: 300, bore: 0.6 }]),
    ...arcnodes(at(14, 2), 3.1, [{ angle: 70 }, { angle: 290 }]),
    ...sentries(at(15), 2.8, [{ angle: 135, fire: 1.5 }, { angle: 45, fire: 1.7 }, { angle: 225, spin: -30 }, { angle: 315, spin: -30 }]),
    ...weavers(at(16), 2.6, [
      { from: -0.92, to: 0.92, height: 0.52, arc: 0.1, cross: 1.9, delay: 0 },
      { from: -0.92, to: 0.92, height: 0.2, arc: 0.2, cross: 1.9, delay: 0.16 },
      { from: -0.92, to: 0.92, height: -0.16, arc: 0.28, cross: 1.9, delay: 0.32 },
      { from: -0.92, to: 0.92, height: -0.52, arc: 0.36, cross: 1.9, delay: 0.48 },
      { from: 0.92, to: -0.92, height: 0.0, arc: -0.44, cross: 1.9, delay: 0.64 },
    ]),
    ...skimmers(at(17), 2.7, [{ angle: 20, bore: 0.62 }, { angle: 140, bore: 0.62 }, { angle: 260, bore: 0.62 }]),
    ...sentries(at(17, 2), 2.7, [{ angle: 90, bore: 0.9, fire: 1.4 }, { angle: 270, bore: 0.9, fire: 1.6 }]),
    ...arcnodes(at(18), 3.0, [{ angle: 20 }, { angle: 160 }]),
    ...weavers(at(18, 2), 2.6, [
      { from: -0.9, to: 0.3, height: 0.46, arc: 0.2, cross: 1.9 },
      { from: 0.9, to: -0.3, height: -0.46, arc: 0.2, cross: 1.9 },
      { from: -0.3, to: 0.9, height: -0.1, arc: 0.32, cross: 1.9 },
      { from: 0.3, to: -0.9, height: 0.1, arc: -0.32, cross: 1.9 },
    ]),
    ...sentries(at(19), 2.7, [
      { angle: 60, fire: 1.4 }, { angle: 120, fire: 1.6 }, { angle: 240, fire: 1.8 }, { angle: 300, fire: 2.0 },
    ]),

    // (bar 19.5–20 clear: the interlock alarm lands on an empty bore)

    // --- Jam. Thin, tense, and the bore starts flashing red.
    ...skimmers(at(20, 2), 2.8, [{ angle: 90, bore: 0.5 }]),
    ...sentries(at(21), 2.8, [{ angle: 200, fire: 1.5 }, { angle: 340, fire: 1.7 }, { angle: 270, bore: 0.62 }]),
    ...interlocks(),
    ...weavers(at(22, 2), 2.6, [
      { from: -0.86, to: 0.86, height: 0.34, arc: 0.16, cross: 1.9 },
      { from: 0.86, to: -0.86, height: -0.34, arc: 0.16, cross: 1.9 },
    ]),
    ...skimmers(at(23, 2), 2.6, [{ angle: 30, bore: 0.55 }, { angle: 210, bore: 0.55 }]),

    // --- Overload. Drone pressure stays deliberately light: the interlocks are
    // the fight, and a screen full of chaff would just eat the charge timer.
    ...sentries(at(25), 2.6, [{ angle: 45, spin: -30 }, { angle: 225, spin: -30 }]),
    ...weavers(at(26), 2.5, [
      { from: -0.88, to: 0.88, height: 0.4, arc: 0.14, cross: 1.8 },
      { from: 0.88, to: -0.88, height: -0.4, arc: 0.14, cross: 1.8 },
    ]),
    ...skimmers(at(27, 2), 2.5, [{ angle: 150, bore: 0.5 }, { angle: 330, bore: 0.5 }]),
    ...sentries(at(29), 2.5, [{ angle: 15, fire: 1.4 }, { angle: 165, fire: 1.6 }]),
    ...weavers(at(30), 2.4, [
      { from: -0.86, to: 0.86, height: -0.24, arc: 0.34, cross: 1.7 },
      { from: 0.86, to: -0.86, height: 0.24, arc: -0.34, cross: 1.7 },
    ]),
    // The last thing in the barrel: two skimmers thrown at you a bar before the
    // muzzle, so the run is still a fight right up to the moment it goes quiet.
    ...skimmers(at(31), 2.2, [{ angle: 75, bore: 0.58 }, { angle: 255, bore: 0.58 }]),
  ].sort((a, b) => a.time - b.time);
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = buildTimeline();

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  sentry: 120,
  skimmer: 150,
  weaver: 130,
  arcnode: 300,
  interlock: 900,
  bolt: 60,
};

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let boltsDowned = 0;
  let bestChain = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    boltsDowned = 0;
    bestChain = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => interceptions.add(enemyId));
  bus.on('kill', ({ enemyId }) => interceptions.delete(enemyId));
  bus.on('miss', ({ enemyId }) => interceptions.delete(enemyId));
  bus.on('volley', ({ size, kills }) => {
    if (kills === size) bestChain = Math.max(bestChain, size);
  });

  function fireBolt(context: MassDriverUpdate, from: Vector3, speed = 5.5) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const bank = createInterlockBank(bus, { fireBolt });

  // ---- movement -------------------------------------------------------------

  const scratch = new Vector3();

  /** Sentry: a hex plate clamped to the bore wall, walking around the barrel. */
  function updateSentry(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'sentry' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const pace = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const theta = data.angle + age * data.spin;
    const radius = barrelRadiusAt(pace.anchorU) * Math.min(SENTRY_MAX_BORE, data.bore);
    enemy.mesh.position.copy(offsetFromRail(curve, pace.anchorU, boreOffset(theta, radius, 0, scratch)));
    // Billboard so the plate always reads face-on, then roll it so its notch
    // points out at the wall it is bolted to.
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(theta - Math.PI / 2);
    enemy.mesh.rotateX(Math.sin(age * 1.6 + enemy.id) * 0.22);

    if (Number.isFinite(data.fireDelay)) {
      const fire = context.enemyState(() => ({ nextAt: data.fireDelay }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 2.6;
        fireBolt(context, enemy.mesh.position);
      }
    }
    return runTime > pace.passTime + MISS_GRACE;
  }

  /** Skimmer: a needle running back up the bore at you, corkscrewing as it comes. */
  function updateSkimmer(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'skimmer' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const pace = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const theta = data.angle + age * data.spin;
    const breathe = 1 - data.wobble + data.wobble * Math.cos(age * 1.7);
    const radius = barrelRadiusAt(pace.anchorU) * data.bore * breathe;
    enemy.mesh.position.copy(offsetFromRail(curve, pace.anchorU, boreOffset(theta, radius, 0, scratch)));
    // Aimed at your face the whole way in; the spin is the only tell.
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(age * 7.5);
    return runTime > pace.passTime + MISS_GRACE;
  }

  /** Weaver: threads the aperture, crossing the full bore between two rings. */
  function updateWeaver(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'weaver' }>) {
    const { enemy, runTime, age, curve } = context;
    const pace = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.16 || runTime > pace.passTime + MISS_GRACE) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const radius = barrelRadiusAt(pace.anchorU);
    const sample = (progress: number, target: Vector3) => {
      const smooth = MathUtils.clamp(progress, 0, 1);
      const across = MathUtils.lerp(data.fromBore, data.toBore, smooth);
      const up = data.height + Math.sin(smooth * Math.PI) * data.arc;
      // Across and up are authored independently, so their corners can land
      // outside the bore and put wall plate between the target and the player.
      // Pull the whole offset back inside the tube instead of clipping either axis.
      const reach = Math.hypot(across, up);
      const fit = reach > WEAVER_MAX_BORE ? WEAVER_MAX_BORE / reach : 1;
      return target.set(
        across * fit * radius,
        up * fit * radius,
        Math.sin(age * 2.4 + enemy.id) * 1.6,
      );
    };
    const position = offsetFromRail(curve, pace.anchorU, sample(eased, scratch));
    const ahead = offsetFromRail(curve, pace.anchorU, sample(eased + 0.05, scratch));
    enemy.mesh.position.copy(position);
    enemy.mesh.lookAt(ahead);
    // Bank into the crossing: rotors outboard, belly toward the direction of travel.
    enemy.mesh.rotateZ(Math.sin(clamped * Math.PI) * 0.9 * Math.sign(data.toBore - data.fromBore) + age * 1.2);
    return false;
  }

  /** Arcnode: a capacitor drum that swings off the wall into your path, then discharges. */
  function updateArcnode(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'arcnode' }>) {
    const { enemy, runTime, age, curve } = context;
    const pace = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const swing = MathUtils.clamp(age / data.swingTime, 0, 1);
    const eased = swing * swing * (3 - 2 * swing);
    const theta = data.angle + age * data.drift;
    const radius = barrelRadiusAt(pace.anchorU) * MathUtils.lerp(0.97, 0.34, eased);
    enemy.mesh.position.copy(offsetFromRail(curve, pace.anchorU, boreOffset(theta, radius, 0, scratch)));
    enemy.mesh.quaternion.setFromRotationMatrix(railBasis(curve, pace.anchorU, theta));
    enemy.mesh.rotateY(age * 2.1);
    // Cracked open: the exposed core rattles in its mount.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 24) * 0.16;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.14;
    }
    const fire = context.enemyState(() => ({ nextAt: data.swingTime + 0.35 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 2.2;
      fireBolt(context, enemy.mesh.position, 6.5);
    }
    return runTime > pace.passTime + MISS_GRACE;
  }

  /** Bolt: drone fire. Lockable, so a sweep can shoot the shot down. */
  function updateBolt(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'bolt' }>) {
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
      config: { hitDistance: 2.6, impactBrake: 0.34, damageDistance: 0.7 },
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
      baseSpeed: 7,
      maxSpeed: 17,
      accel: 4.2,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.0001) {
      enemy.mesh.lookAt(scratch.copy(data.position).add(data.velocity));
    }
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    // A fast bore: cap the coarsest impact grid at half a bar so the sixth shot
    // in a volley still lands while its target is on screen. Actions snap to
    // 16ths rather than 32nds — this level's whole promise is a locked grid.
    timing: {
      shotDelay: { maxGridSeconds: 0.85 },
      actionSfx: { gridThirtyseconds: 2 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'sentry':
          return updateSentry(context, data);
        case 'skimmer':
          return updateSkimmer(context, data);
        case 'weaver':
          return updateWeaver(context, data);
        case 'arcnode':
          return updateArcnode(context, data);
        case 'interlock':
          return bank.updateInterlock(context, data);
        case 'bolt':
          return updateBolt(context, data);
      }
    },
    // The capacitor bank needs a real charge to discharge. One lock only ever
    // fires as a point-defence snap at an incoming bolt.
    validateRelease(enemies) {
      if (enemies.length >= MIN_DISCHARGE_LOCKS) return true;
      return enemies.every((enemy) => enemy.kind === 'bolt');
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 55,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 700 : results.length * 80;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (bank.barrelCleared() && score >= 26000 && clearRate >= 0.8) return 'S';
      if (bank.barrelCleared() && score >= 17000 && clearRate >= 0.6) return 'A';
      if (score >= 10000 && clearRate >= 0.4) return 'B';
      if (score >= 4500 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`, bank.summaryLine()];
      if (bestChain >= 4) lines.push(`Best clean volley ${bestChain}`);
      if (boltsDowned > 0) lines.push(`${boltsDowned} round${boltsDowned === 1 ? '' : 's'} shot down`);
      return lines;
    },
  };
}
