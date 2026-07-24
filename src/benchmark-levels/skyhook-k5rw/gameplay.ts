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
import { createDescender, createDescenderEntries } from './descender';
import {
  bar,
  SIGHTING_TIME,
  ENGAGE_TIME,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_TIME,
} from './timing';

// SKYHOOK — sixty seconds of climbing a space elevator, scored to a 32-bar
// arrangement at 128 BPM (one bar = 1.875 s, 32 bars = exactly 60 s):
//
//   Weather    (0–15s)     Anchor clamps release. Storm grey, rain, wind-riders.
//   Deck       (15s)       Punch through the cloud deck. The sky opens blue.
//   Above      (15–26s)    Thinning air, interceptors, the first vacuum pods.
//   Sighting   (26s)       Something is clamped to the tether, far above.
//   Descender  (30–48s)    It climbs down. Kill it before it reaches the car.
//   Dock       (49–60s)    The station opens overhead and swallows the climber.
//
// The rail is the tether: it rises steeply and leans forward just enough that
// the camera's up-vector stays well conditioned. Rail-relative offsets still
// read exactly like every other level — x is screen-right, y is screen-up,
// z is ahead — so spawn authoring is unchanged even though the world is vertical.

export {
  CONTACT_TIME,
  DECK_TIME,
  DESCENDER_TIME,
  DOCK_TIME,
  ENGAGE_TIME,
  QUIET_TIME,
  SIGHTING_TIME,
  SKYHOOK_BAR,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  bar,
} from './timing';

export const SKYHOOK_HULL = 5;

export type SkyhookEnemyKind = 'kite' | 'spar' | 'shrike' | 'limpet' | 'slug' | 'grapnel' | 'core';

// Timeline data is immutable — the engine reuses the timeline across runs, so
// per-enemy mutable state lives in the runner's `enemyState` bags and every
// runtime-spawned slug gets a fresh data object.
export type SkyhookSpawnData =
  | { role: 'kite'; lead: number; fromX: number; toX: number; y: number; arc: number; crossTime: number; delay: number }
  | { role: 'spar'; lead: number; x: number; drift: number; fromY: number; toY: number; fallTime: number; delay: number; seed: number }
  | { role: 'shrike'; lead: number; offset: Vector3; hold: number; seed: number }
  | { role: 'limpet'; leadStart: number; leadEnd: number; closeTime: number; angle: number; spin: number; clamp: Vector3 }
  | { role: 'slug'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'grapnel'; socket: number }
  | { role: 'core' };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

// ---- speed profile → rail easing --------------------------------------------

// The climb accelerates out of the anchor, kicks hard through the cloud deck,
// holds a fast cruise through the fight, then brakes into the dock. The rail
// easing is the normalized integral of this curve, so the deck punch and the
// docking brake are real changes in speed, not just visual dressing.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.55],
  [bar(2), 0.85],
  [bar(6), 1.0],
  [bar(7, 2), 1.05],
  [bar(8, 0.4), 1.85],
  [bar(9, 2), 1.32],
  [bar(13), 1.4],
  [bar(16, 0.3), 1.62],
  [bar(22), 1.56],
  [bar(25, 2), 1.45],
  [bar(26, 2), 1.0],
  [bar(28), 0.45],
  [bar(30), 0.18],
  [bar(32), 0.05],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_DURATION);

export const speedFactorAt = speedProfile.speedAt;

// The runner aims the camera at `runProgress + 0.025` clamped to the rail end,
// so a profile that reaches exactly 1 leaves the last frame with a zero-length
// look direction — harmless on a level that flies along -Z, a 70° snap on a
// level that flies straight up. Stopping a whisker short costs half a metre of
// travel and keeps the docked camera pointing up the tether.
const RAIL_END = 0.9985;

export function skyhookRunProgress(time: number, duration = SKYHOOK_DURATION) {
  return Math.min(RAIL_END, speedProfile.runProgress(time, duration));
}

/** Rail parameter the camera occupies at run time `t` — for seating set pieces. */
export const railU = (time: number) => skyhookRunProgress(time);

// ---- rail --------------------------------------------------------------------

// Anchor at the bottom, station at the top. Segments are ~63 units long and the
// lean off vertical tightens from 40° to 20° as the climb steepens, which tips
// the camera from "looking out over the weather" to "looking straight up into
// the dark" without a single line of camera code.
const RAIL_POINTS: Array<[number, number, number]> = [
  [0, 6, 0],
  [2.5, 54.3, -40.5],
  [-2.0, 103.9, -79.3],
  [3.0, 154.9, -116.3],
  [-2.4, 207.1, -151.5],
  [1.8, 260.5, -184.9],
  [-1.4, 315.1, -216.4],
  [1.0, 370.7, -245.9],
  [-0.6, 427.3, -273.5],
  [0.4, 484.9, -299.1],
  [0, 543.3, -322.7],
  [0, 602.1, -345.3],
  [0, 661.3, -366.8],
];

export function createSkyhookRail() {
  return new CatmullRomCurve3(
    RAIL_POINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'catmullrom',
    0.4,
  );
}

/** Rail-relative seat of the cable: directly below the car, running to the vanishing point. */
export const CABLE_OFFSET = new Vector3(0, -4.4, 0);

// ---- spawn timeline ----------------------------------------------------------

const MISS_GRACE = 0.012;

// Wind-riders: taut sailcloth deltas that cross the frame on a gust.
// Motion times are written as fractions of the lead rather than in seconds. A
// target that crosses in 0.58 of its lead is still comfortably far out when it
// leaves, at any point on a speed curve that varies by more than 3x.
const CROSS_SHARE = 0.58;
const FALL_SHARE = 0.62;
const STAGGER_SHARE = 0.1;

const kites = (
  time: number,
  lead: number,
  runs: Array<{ from: number; to: number; y: number; arc: number }>,
): SkyhookSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.09,
    kind: 'kite',
    data: {
      role: 'kite',
      lead,
      fromX: run.from,
      toX: run.to,
      y: run.y,
      arc: run.arc,
      crossTime: lead * CROSS_SHARE,
      delay: index * lead * STAGGER_SHARE,
    },
  }));

// Shear debris off the tether above: falls straight through the frame, tumbling.
const spars = (
  time: number,
  lead: number,
  drops: Array<{ x: number; y?: number; drift?: number }>,
): SkyhookSpawnEntry[] =>
  drops.map((drop, index) => ({
    time: time + index * 0.07,
    kind: 'spar',
    data: {
      role: 'spar',
      lead,
      x: drop.x,
      drift: drop.drift ?? 0,
      fromY: drop.y ?? 22,
      toY: (drop.y ?? 22) - 34,
      fallTime: lead * FALL_SHARE,
      delay: index * lead * STAGGER_SHARE * 0.6,
      seed: time * 3.7 + index * 2.13,
    },
  }));

// Interceptors: they pace the car, then commit to a ram. They want the climber,
// not the gunner — every shrike that lands is a point off the hull.
const shrikes = (time: number, lead: number, offsets: Array<[number, number]>, hold = 1.7): SkyhookSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.22,
    kind: 'shrike',
    hitPoints: 2,
    data: {
      role: 'shrike',
      lead,
      hold: hold + index * 0.28,
      seed: time + index * 1.77,
      offset: new Vector3(offset[0], offset[1], 0),
    },
  }));

// Vacuum-hardened clamp pods: they spiral onto the cable ahead of the car, spit
// one slug at the gunner, then grind. Armour first, core second.
const limpets = (time: number, pods: Array<{ angle: number; x: number; y: number; close?: number }>): SkyhookSpawnEntry[] =>
  pods.map((pod, index) => ({
    time: time + index * 0.26,
    kind: 'limpet',
    hitStages: [1, 2],
    data: {
      role: 'limpet',
      leadStart: 4.2,
      leadEnd: 1.2,
      closeTime: pod.close ?? 3.0,
      angle: pod.angle,
      spin: index % 2 === 0 ? 1.55 : -1.55,
      clamp: new Vector3(pod.x, pod.y, 0),
    },
  }));

function buildSkyhookTimeline(descenderEntries: SkyhookSpawnEntry[]): SkyhookSpawnEntry[] {
  return [
    // --- Weather. Wide, slow, legible: learn the sweep in the storm. ---------
    ...kites(bar(1), 5.2, [
      { from: -34, to: 28, y: 6, arc: 5 },
      { from: -36, to: 26, y: 16, arc: 4 },
      { from: -30, to: 32, y: 0.5, arc: 6 },
    ]),
    ...spars(bar(2, 2), 4.9, [{ x: -13 }, { x: 8, y: 18 }, { x: 19, drift: -3 }]),
    ...kites(bar(4), 4.6, [
      { from: 34, to: -28, y: 11, arc: -4.5 },
      { from: -34, to: 28, y: 2.5, arc: 6 },
      { from: 32, to: -32, y: 19, arc: -3.5 },
      { from: -28, to: 34, y: 14, arc: 4 },
    ]),
    ...spars(bar(5, 2), 4.2, [{ x: -21 }, { x: -8, y: 17, drift: 2 }, { x: 22 }]),
    ...shrikes(bar(6, 2), 3.6, [[0, 11]], 2.6),
    ...kites(bar(7), 3.2, [
      { from: -32, to: 20, y: 1.5, arc: 5 },
      { from: -22, to: 30, y: 9, arc: 4 },
      { from: 32, to: -20, y: 18, arc: -4 },
    ]),

    // (bar 7.5–8: screen kept clear for the cloud-deck punch-through)

    // --- Above the deck. Sunlight, thinner air, the first vacuum hardware. ---
    ...kites(bar(8, 2), 3.2, [
      { from: -36, to: 22, y: 2.5, arc: 6 },
      { from: -32, to: 28, y: 11, arc: 5 },
      { from: 36, to: -24, y: 21, arc: -3.5 },
      { from: 32, to: -28, y: 6, arc: -5.5 },
    ]),
    ...spars(bar(9, 2), 3.4, [{ x: -23 }, { x: -9, y: 18 }, { x: 17 }, { x: 27, drift: -4 }]),
    ...shrikes(bar(10, 2), 3.4, [[-16, 14], [16, 5]], 2.4),
    ...kites(bar(11, 2), 3.35, [
      { from: -34, to: 26, y: 13, arc: 5 },
      { from: 34, to: -26, y: 3, arc: -6 },
      { from: -28, to: 32, y: 21, arc: -3.5 },
      { from: 28, to: -32, y: 9, arc: -4.5 },
    ]),
    ...spars(bar(12, 2), 3.3, [{ x: -25 }, { x: -11, y: 16, drift: 3 }, { x: 15 }]),
    ...limpets(bar(13), [{ angle: 0.4, x: -5.6, y: -1.2 }]),
    ...kites(bar(13, 2), 3.2, [
      { from: -30, to: 24, y: 18, arc: 4 },
      { from: 30, to: -24, y: 7, arc: -5 },
      { from: -20, to: 28, y: 1, arc: 6 },
    ]),

    // --- Sighting. The tether starts shedding wreckage from far above. -------
    ...spars(bar(14, 2), 3.1, [{ x: -18 }, { x: -8, y: 17 }, { x: 23, drift: -3 }]),
    ...limpets(bar(15), [{ angle: 2.3, x: 5.2, y: -0.8 }]),

    // --- The Descender. No wind up here: pods, wreckage, and the thing. ------
    ...descenderEntries,
    ...spars(bar(16, 2), 2.9, [{ x: -26 }, { x: -12, y: 17 }, { x: 25 }]),
    ...limpets(bar(17, 2), [{ angle: 1.1, x: -6.2, y: -1.6 }, { angle: 3.9, x: 6.0, y: -0.6 }]),
    ...spars(bar(19, 2), 2.9, [{ x: -21, drift: 4 }, { x: 9, y: 18 }, { x: 22, drift: -4 }]),
    ...limpets(bar(21), [{ angle: 0.2, x: 4.8, y: -2.4 }]),
    ...spars(bar(22), 2.9, [{ x: -27 }, { x: -10, y: 16, drift: 3 }, { x: 18 }]),
    ...spars(bar(24), 2.85, [{ x: -23 }, { x: 24, y: 18 }]),

    // --- Dock. The tether sheds one last cascade, then everything goes quiet.
    ...spars(bar(26), 3.2, [{ x: -26 }, { x: -15, y: 18 }, { x: -7.5 }, { x: 9, y: 17 }, { x: 27 }]),
    ...spars(bar(26, 1), 3.0, [{ x: -18 }, { x: 8, y: 20 }, { x: 20 }]),
  ];
}

export function createSkyhookTimeline() {
  const descender = createDescenderEntries(SIGHTING_TIME, ENGAGE_TIME);
  return { coreEntry: descender.coreEntry, timeline: sortTimeline(buildSkyhookTimeline(descender.timeline)) };
}

const KILL_SCORE: Record<SkyhookEnemyKind, number> = {
  kite: 130,
  spar: 110,
  shrike: 300,
  limpet: 380,
  slug: 60,
  grapnel: 420,
  core: 3000,
};

const SLUG_MAX_AGE = 11;
const SHRIKE_DIVE_MAX = 6.5;
const LIMPET_GRIND = 3.2;

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> {
  const { timeline, coreEntry } = createSkyhookTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let slugsDowned = 0;
  let podsClamped = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    slugsDowned = 0;
    podsClamped = 0;
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

  function fireSlug(context: SkyhookUpdate, from: Vector3, spread = 0) {
    const aim = hostileShotAimPoint(context.camera, from).sub(from).normalize();
    if (spread !== 0) aim.x += spread;
    context.spawnEnemy({
      time: context.runTime,
      kind: 'slug',
      countsTowardTotal: false,
      data: { role: 'slug', position: from.clone(), velocity: aim.normalize().multiplyScalar(6), lastAge: 0, impact: {} },
    });
  }

  const descender = createDescender(bus, { coreEntry, fireSlug });

  // ---- movement --------------------------------------------------------------

  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'kite' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.05 || runProgress > anchorU + MISS_GRACE) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    // Gusts: the whole wing surges and sags as it rides turbulence.
    const gust = Math.sin(age * 3.1 + enemy.id) * 0.9 + Math.sin(age * 7.3 + enemy.id * 2.1) * 0.35;
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + gust;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 1.7 + enemy.id) * 1.4)));

    const nextEased = Math.min(1, eased + 0.05);
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, nextEased),
      data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.arc + gust,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    // Bank hard into the crossing: the tell that separates a kite from debris.
    const direction = Math.sign(data.toX - data.fromX) || 1;
    enemy.mesh.rotateZ(direction * (0.85 + Math.sin(age * 2.6 + enemy.id) * 0.28));
    return false;
  }

  function updateSpar(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'spar' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.fallTime;
    if (t > 1.05 || runProgress > anchorU + MISS_GRACE) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    // Debris accelerates as it falls; nothing up here slows it down.
    const fall = clamped * clamped * 0.72 + clamped * 0.28;
    const y = MathUtils.lerp(data.fromY, data.toY, fall);
    const x = data.x + data.drift * fall;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(data.seed) * 2.2)));
    // End-over-end tumble on a fixed axis, so the silhouette flickers long/short.
    enemy.mesh.rotation.set(
      age * (2.3 + (enemy.id % 3) * 0.7) + data.seed,
      age * 0.7 + data.seed * 1.3,
      age * (1.4 + (enemy.id % 5) * 0.22),
    );
    return false;
  }

  function updateShrike(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'shrike' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor, damagePlayer } = context;
    const dive = context.enemyState(() => ({
      launched: false,
      position: new Vector3(),
      velocity: new Vector3(),
      lastAge: 0,
      impact: {} as HostileShotImpactState,
    }));

    if (!dive.launched) {
      const anchorU = railAnchor(data.lead);
      const offset = data.offset.clone();
      offset.x += Math.sin(age * 1.3 + data.seed) * 3.4;
      offset.y += Math.sin(age * 1.9 + data.seed * 1.7) * 1.8;
      // Wind up: it rears back a beat before committing.
      const toDive = data.hold - age;
      if (toDive < 0.55 && toDive > 0) offset.z += (0.55 - toDive) * 9;
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
      enemy.mesh.lookAt(camera.position);
      enemy.mesh.rotateZ(Math.sin(age * 2.4 + data.seed) * 0.45);
      enemy.mesh.userData.commit = MathUtils.clamp(1 - toDive / 1.2, 0, 1);
      if (age >= data.hold) {
        dive.launched = true;
        dive.position.copy(enemy.mesh.position);
        dive.velocity.copy(camera.position).sub(dive.position).normalize().multiplyScalar(14);
        dive.lastAge = age;
      }
      return runProgress > anchorU + MISS_GRACE;
    }

    const dt = Math.max(0, age - dive.lastAge);
    dive.lastAge = age;
    enemy.mesh.userData.commit = 1;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: dive.position,
      velocity: dive.velocity,
      state: dive.impact,
      config: { hitDistance: 4.6, impactBrake: 0.3, damageDistance: 2.8 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(dive.position);
      enemy.mesh.lookAt(camera.position);
      if (impact.damaged) {
        // It got through to the climber, not to you.
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(dive.position, dive.velocity, hostileShotAimPoint(camera, dive.position, 4.6), age - data.hold, dt, {
      baseSpeed: 10,
      maxSpeed: 21,
      accel: 5,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(dive.position);
    enemy.mesh.lookAt(dive.position.clone().add(dive.velocity));
    return age - data.hold > SHRIKE_DIVE_MAX || shotBehindCamera(camera, dive.position);
  }

  function updateLimpet(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'limpet' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor, damagePlayer } = context;
    const state = context.enemyState(() => ({ clamped: false, clampedAt: 0, fired: false }));
    const close = MathUtils.clamp(age / data.closeTime, 0, 1);
    const eased = close * close * (3 - 2 * close);
    const lead = MathUtils.lerp(data.leadStart, data.leadEnd, eased);
    const anchorU = railAnchor(lead);

    // Spiral in around the cable, then settle onto the clamp point.
    const radius = MathUtils.lerp(15, 0, eased);
    const angle = data.angle + age * data.spin * (1 - eased * 0.85);
    const offset = new Vector3(
      MathUtils.lerp(Math.cos(angle) * radius, data.clamp.x, eased),
      MathUtils.lerp(Math.sin(angle) * radius * 0.7 + 3, data.clamp.y, eased),
      0,
    );

    if (close >= 1) {
      if (!state.clamped) {
        state.clamped = true;
        state.clampedAt = age;
        podsClamped += 1;
      }
      const grind = age - state.clampedAt;
      // Grinding into the cable: it shakes itself apart against the rail.
      offset.x += Math.sin(age * 34) * 0.14;
      offset.y += Math.cos(age * 29) * 0.11;
      enemy.mesh.userData.grind = MathUtils.clamp(grind / LIMPET_GRIND, 0, 1);
      if (!state.fired && grind > 0.35) {
        state.fired = true;
        fireSlug(context, enemy.mesh.position);
      }
      if (grind >= LIMPET_GRIND) {
        damagePlayer(1);
        return true;
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle * 0.5 + age * 0.8);
    return runProgress > anchorU + MISS_GRACE;
  }

  function updateSlug(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'slug' }>) {
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
      config: { hitDistance: 3.0, impactBrake: 0.36, damageDistance: 1.7 },
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
      maxSpeed: 15,
      accel: 3.6,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > SLUG_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition --------------------------------------------------------

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    playerHealth: SKYHOOK_HULL,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    startWord: 'ASCEND',
    lockRadiusNdc: 0.088,
    // Sixty seconds is not long enough to let a six-lock volley spread across a
    // whole bar, so the coarsest snap grid is capped at one beat. Action SFX stay
    // on the 32nd grid: locks are fast and should feel immediate.
    timing: {
      shotDelay: {
        pattern: 'grid-ramp',
        releaseShare: 0.7,
        gapThirtyseconds: 2,
        gridRampGapGrowthThirtyseconds: 1,
        maxGridSeconds: SKYHOOK_TIME.beatSeconds,
      },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'kite':
          return updateKite(context, data);
        case 'spar':
          return updateSpar(context, data);
        case 'shrike':
          return updateShrike(context, data);
        case 'limpet':
          return updateLimpet(context, data);
        case 'slug':
          return updateSlug(context, data);
        case 'grapnel':
          return descender.updateGrapnel(context, data);
        case 'core':
          return descender.updateCore(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'slug') slugsDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armour — limpet shells, grapnel joints, the core — pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 700 : results.length * 80;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (descender.coreKilled() && score >= 19000 && clearRate >= 0.85) return 'S';
      if (score >= 13000 && clearRate >= 0.68) return 'A';
      if (score >= 8000 && clearRate >= 0.46) return 'B';
      if (score >= 3800 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_HULL - hitsTaken);
      const lines = [`Climber hull ${hull}/${SKYHOOK_HULL}`];
      if (slugsDowned > 0) lines.push(`${slugsDowned} slug${slugsDowned === 1 ? '' : 's'} intercepted`);
      if (podsClamped > 0) lines.push(`${podsClamped} pod${podsClamped === 1 ? '' : 's'} reached the cable`);
      const descenderLine = descender.summaryLine();
      if (descenderLine) lines.push(descenderLine);
      return lines;
    },
  };
}
