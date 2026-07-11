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
import type { EventBus } from '../../events';
import {
  bar,
  CANAL_TIME,
  DOWNPOUR_BPM,
  DOWNPOUR_DURATION,
  HUNT_TIME,
  PLUNGE_TIME,
  SUMMIT_TIME,
  UNDERCITY_TIME,
} from './timing';

// DOWNPOUR — a hunted courier drone's 60-second escape through a rain-lashed
// neon megacity, 44 bars of 176 BPM drum & bass:
//
//   Ceiling   (bars 0–8)    Drifting through the storm ceiling above the towers.
//   Plunge    (bar 8)       Drop 1: straight down a tower face into the streets.
//   Streets   (bars 8–16)   Avenue canyons — skyways and girders strobe past.
//   Undercity (bar 16)      Drop 2: dive under the city. Sodium light, trains.
//   Canal     (bars 24–32)  Breach out along the flooded canal. Half-time menace:
//                           the hunter-gunship shadows the run, untouchable.
//   Hunt      (bars 32–40)  The gunship engages on the citadel climb.
//   Summit    (bars 40–44)  Above the clouds. Moonlight. Near-silence.
//
// The rail's two great descents (plunge, undercity dive) are the musical drops;
// speed, lightning, and the arrangement all break on the same bar lines.

export { bar, DOWNPOUR_BPM, DOWNPOUR_DURATION } from './timing';
export const DOWNPOUR_PLAYER_HEALTH = 3;

export const GUNSHIP_REVEAL_TIME = bar(26);
// It engages (locks open, guns hot) before the hunt drop so the fight has
// room to breathe across all three stages.
export const GUNSHIP_ENGAGE_TIME = bar(29);
export const GUNSHIP_BREAKOFF_TIME = bar(39.5);

export type DownpourEnemyKind = 'drone' | 'skimmer' | 'sentry' | 'enforcer' | 'tracer' | 'gunship';

// Timeline data is immutable across runs; per-enemy runtime state lives in the
// runner's enemyState bags, and dynamically launched tracers get fresh data.
export type DownpourSpawnData =
  | { role: 'drone'; lead: number; offset: Vector3; wheel: number; drift: number }
  | { role: 'skimmer'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'sentry'; lead: number; offset: Vector3; seed: number }
  | { role: 'enforcer'; leadStart: number; leadEnd: number; closeTime: number; offset: Vector3 }
  | { role: 'tracer'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'gunship' };

export type DownpourSpawnEntry = LockOnSpawnEntry<DownpourEnemyKind, DownpourSpawnData>;
export type DownpourUpdate = LockOnEnemyUpdate<DownpourEnemyKind, DownpourSpawnData>;

// ---- speed profile → rail easing --------------------------------------------

// The two descents are genuine kicks of acceleration; the hunt sits back into
// half-time menace, and the summit bleeds speed away into the release.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.62],
  [bar(7.5), 0.74],
  [bar(8.2), 1.85],
  [bar(10), 1.28],
  [bar(15.5), 1.32],
  [bar(16.3), 1.75],
  [bar(18), 1.22],
  [bar(23.5), 1.26],
  [bar(24.3), 1.58],
  [bar(26), 1.32],
  [bar(32), 1.05],
  [bar(39), 1.18],
  [bar(40.5), 1.55],
  [bar(42.5), 0.85],
  [bar(44), 0.58],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, DOWNPOUR_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function downpourRunProgress(time: number, duration = DOWNPOUR_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => downpourRunProgress(time);

// ---- rail --------------------------------------------------------------------

// Storm ceiling (y≈125) → plunge down a tower face → avenue canyon (y≈10) →
// undercity tunnel (y≈-14) → flooded canal (y≈-4) → citadel climb → above the
// clouds (y≈115).
export function createDownpourRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 128, 0),
      new Vector3(4, 124, -55),
      new Vector3(-6, 118, -110),
      new Vector3(3, 104, -165),
      new Vector3(-4, 62, -215),
      new Vector3(5, 26, -270),
      new Vector3(-10, 14, -330),
      new Vector3(14, 12, -395),
      new Vector3(-16, 10, -460),
      new Vector3(10, 4, -525),
      new Vector3(-4, -12, -585),
      new Vector3(6, -14, -650),
      new Vector3(-6, -14, -715),
      new Vector3(4, -12, -780),
      new Vector3(-8, -4, -850),
      new Vector3(8, -4, -920),
      new Vector3(-6, 0, -990),
      new Vector3(4, 34, -1050),
      new Vector3(-4, 78, -1105),
      new Vector3(0, 116, -1160),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// ---- spawn timeline -----------------------------------------------------------

const drones = (time: number, lead: number, wheel: number, offsets: Array<[number, number]>): DownpourSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.12,
    kind: 'drone',
    data: { role: 'drone', lead, wheel, drift: index * 1.7, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const skimmers = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): DownpourSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.1,
    kind: 'skimmer',
    data: {
      role: 'skimmer',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.38,
      crossTime: run.crossTime ?? 2.3,
    },
  }));

const sentries = (time: number, lead: number, offsets: Array<[number, number]>): DownpourSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.2,
    kind: 'sentry',
    data: { role: 'sentry', lead, seed: index * 2.61 + time, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const enforcers = (time: number, offsets: Array<[number, number]>): DownpourSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.3,
    kind: 'enforcer',
    hitStages: [2, 2],
    data: { role: 'enforcer', leadStart: 8.5, leadEnd: 3.4, closeTime: 7.5, offset: new Vector3(offset[0], offset[1], 0) },
  }));

export function createDownpourTimeline(): DownpourSpawnEntry[] {
  const gunshipEntry: DownpourSpawnEntry = {
    time: GUNSHIP_REVEAL_TIME,
    kind: 'gunship',
    hitStages: [2, 3, 3],
    lockable: false, // sealed until it engages — flipped live at GUNSHIP_ENGAGE_TIME
    data: { role: 'gunship' },
  };
  return [
    // --- Ceiling: sparse, formation-first. Learn the sweep in the rain.
    ...drones(bar(1.5), 4.8, 0.3, [[-4.5, 2], [-1.5, 3.2], [1.5, 3.2], [4.5, 2]]),
    ...drones(bar(3.5), 4.6, -0.35, [[-5.5, -0.5], [-2.7, 1.5], [0, 3.2], [2.7, 1.5], [5.5, -0.5]]),
    ...skimmers(bar(5), 4.4, [
      { fromX: -20, toX: 20, y: 2.4, arc: 1.8 },
      { fromX: 20, toX: -20, y: 0.6, arc: 2.4 },
      { fromX: -20, toX: 20, y: 4.2, arc: 1.4 },
    ]),
    ...drones(bar(6.4), 4.3, 0.45, [[-6, 1.4], [-3, 3], [3, 3], [6, 1.4]]),

    // (bars 7.4–8.4: screen kept clear for the plunge)

    // --- Streets: full rolling breaks; the canyon fights back.
    ...skimmers(bar(8.5), 4.2, [
      { fromX: -15, toX: 15, y: 1.2, arc: 2.6, crossTime: 2.1 },
      { fromX: 15, toX: -15, y: 3.4, arc: 2, crossTime: 2.1 },
      { fromX: -15, toX: 15, y: 5, arc: 1.4, crossTime: 2.1 },
      { fromX: 15, toX: -15, y: -0.4, arc: 2.8, crossTime: 2.1 },
    ]),
    ...drones(bar(10), 4.4, 0.5, [[-6.5, 1], [-3.8, 2.8], [-1.2, 4], [1.2, 4], [3.8, 2.8], [6.5, 1]]),
    ...sentries(bar(11.5), 5.0, [[0, 4.6]]),
    ...skimmers(bar(12.5), 4.1, [
      { fromX: -15, toX: 15, y: 0.4, arc: 3, delay: 0 },
      { fromX: 15, toX: -15, y: 2.6, arc: 2.4, delay: 0.24 },
      { fromX: -15, toX: 15, y: 4.4, arc: 1.8, delay: 0.48 },
      { fromX: 15, toX: -15, y: 1.4, arc: 2.6, delay: 0.72 },
    ]),
    ...sentries(bar(13.8), 4.7, [[-5.5, 3.4], [5.5, 3.4]]),
    ...drones(bar(14.4), 4.1, -0.4, [[-4.5, 0], [0, -1.2], [4.5, 0]]),

    // (bars 15.4–16.4: clear for the undercity dive)

    // --- Undercity: sodium light, tight walls, armor on the rails.
    ...drones(bar(17), 4.0, 0.55, [[-5, 1.6], [-2.5, 3], [0, 1.6], [2.5, 3], [5, 1.6]]),
    ...enforcers(bar(17.5), [[0, 2.2]]),
    ...skimmers(bar(18.6), 4.0, [
      { fromX: -18, toX: 18, y: 1, arc: 1.6, crossTime: 2.0 },
      { fromX: 18, toX: -18, y: 3, arc: 1.3, crossTime: 2.0 },
      { fromX: -18, toX: 18, y: -0.6, arc: 1.8, crossTime: 2.0 },
    ]),
    ...sentries(bar(20), 4.5, [[-4.5, 3.8], [4.5, 3.8]]),
    ...drones(bar(21), 4.2, 0.4, [[-6, 0.4], [-3, 2.2], [0, 3.4], [3, 2.2], [6, 0.4]]),
    ...enforcers(bar(22), [[-4.5, 1.4]]),
    ...skimmers(bar(22.6), 3.9, [
      { fromX: 18, toX: -18, y: 2, arc: 1.5, crossTime: 1.9 },
      { fromX: -18, toX: 18, y: 0.4, arc: 1.8, crossTime: 1.9 },
    ]),

    // --- Canal: breach into open water; the gunship shadows the run.
    ...skimmers(bar(24.3), 4.2, [
      { fromX: -24, toX: 24, y: 1.4, arc: 2.4, crossTime: 2.2 },
      { fromX: 24, toX: -24, y: 3.2, arc: 1.8, crossTime: 2.2 },
      { fromX: -24, toX: 24, y: 5, arc: 1.4, crossTime: 2.2 },
    ]),
    ...drones(bar(25.4), 4.4, 0.35, [[-5.5, 1.8], [-2.8, 3.4], [2.8, 3.4], [5.5, 1.8]]),
    gunshipEntry,
    ...sentries(bar(27.2), 4.6, [[-6, 4.2], [6, 4.2]]),
    ...skimmers(bar(28.6), 4.0, [
      { fromX: -24, toX: 24, y: 0.6, arc: 2.8, delay: 0 },
      { fromX: 24, toX: -24, y: 2.4, arc: 2.2, delay: 0.26 },
      { fromX: -24, toX: 24, y: 4.2, arc: 1.6, delay: 0.52 },
    ]),
    ...drones(bar(30), 4.3, -0.45, [[-6.5, 0.8], [-3.2, 2.6], [0, 3.8], [3.2, 2.6], [6.5, 0.8]]),
    ...enforcers(bar(31), [[4.5, 1.8]]),

    // --- Hunt: the gunship engages; security throws everything at the climb.
    ...sentries(bar(33), 4.4, [[-5, 4.4], [5, 4.4]]),
    ...skimmers(bar(34.2), 3.9, [
      { fromX: -14, toX: 14, y: 1.6, arc: 2, crossTime: 2.1 },
      { fromX: 14, toX: -14, y: 3.2, arc: 1.6, crossTime: 2.1 },
    ]),
    ...drones(bar(35.4), 4.1, 0.5, [[-5.5, 0.6], [-2.8, 2.4], [2.8, 2.4], [5.5, 0.6]]),
    ...enforcers(bar(36.4), [[0, 3.6]]),
    ...sentries(bar(37.6), 4.2, [[0, 5.2]]),
    ...skimmers(bar(38.4), 3.8, [
      { fromX: 14, toX: -14, y: 1.2, arc: 2.2, crossTime: 2.0 },
      { fromX: -14, toX: 14, y: 2.8, arc: 1.8, crossTime: 2.0 },
    ]),

    // --- Summit: two last stragglers glide in the moonlight — a gentle
    // closing volley over near-silence.
    ...drones(bar(40.8), 4.6, 0.18, [[-3, 2.4], [3, 2.4]]),
    ...drones(bar(42), 4.4, -0.15, [[-1.8, 3.4], [1.8, 3.4]]),
  ].sort((a, b) => a.time - b.time);
}

export const DOWNPOUR_TIMELINE: DownpourSpawnEntry[] = createDownpourTimeline();

const KILL_SCORE: Record<DownpourEnemyKind, number> = {
  drone: 100,
  skimmer: 150,
  sentry: 200,
  enforcer: 340,
  tracer: 40,
  gunship: 1500,
};

const TRACER_MAX_AGE = 11;

export type DownpourGameplay = LockOnRunnerLevel<DownpourEnemyKind, DownpourSpawnData> & {
  gunshipKilled(): boolean;
};

export function createDownpourGameplay(bus: EventBus): DownpourGameplay {
  const timeline = createDownpourTimeline();
  const gunshipEntry = timeline.find((entry) => entry.kind === 'gunship');

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let tracersDowned = 0;
  let gunshipId = -1;
  let gunshipDown = false;
  let gunshipEscaped = false;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    tracersDowned = 0;
    gunshipId = -1;
    gunshipDown = false;
    gunshipEscaped = false;
    if (gunshipEntry) gunshipEntry.lockable = false;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'gunship') gunshipId = enemyId;
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (enemyId === gunshipId) gunshipDown = true;
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  function fireTracer(context: DownpourUpdate, from: Vector3, speed: number) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'tracer',
      countsTowardTotal: false,
      data: { role: 'tracer', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement ---------------------------------------------------------------

  function updateDrone(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'drone' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // The pack wheels slowly around its formation center while each drone
    // bobs on its own rotor rhythm — searchlights hunting in the rain.
    const angle = age * data.wheel;
    const x = data.offset.x * Math.cos(angle) - data.offset.y * Math.sin(angle);
    const y = data.offset.x * Math.sin(angle) + data.offset.y * Math.cos(angle) + 1.4
      + Math.sin(age * 2.1 + data.drift) * 0.35;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateY(Math.sin(age * 1.3 + data.drift) * 0.4);
    enemy.mesh.rotateZ(Math.sin(age * 0.8 + data.drift) * 0.18);
    return runProgress > anchorU + 0.014;
  }

  function updateSkimmer(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'skimmer' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 2.6 + enemy.id) * 0.3)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.04)),
      data.y + Math.sin(Math.min(1, clamped + 0.04) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    // Bank hard into the crossing — a courier bike leaning through the wet.
    enemy.mesh.rotateZ(MathUtils.clamp((data.toX - data.fromX) * 0.02, -0.7, 0.7));
    return false;
  }

  function updateSentry(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'sentry' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.9 + data.seed) * 2.2;
    offset.y += Math.sin(age * 1.5 + data.seed * 2.1) * 1.4;

    // Telegraphed shot: the pod flares its hazard strobes wide, drops back,
    // then snaps forward and looses a tracer.
    const fire = context.enemyState(() => ({ nextAt: 1.7 }));
    const untilShot = fire.nextAt - age;
    if (untilShot < 0.85 && untilShot > 0.5) offset.z += (0.85 - untilShot) * 7;
    else if (untilShot <= 0.5 && untilShot > 0) offset.z -= (0.5 - untilShot) * 12;
    enemy.mesh.userData.telegraph = untilShot < 0.85 && untilShot > 0;
    if (age >= fire.nextAt) {
      fire.nextAt = age + 3.6;
      fireTracer(context, enemy.mesh.position, 5.5);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.8 + data.seed) * 0.3);
    return runProgress > anchorU + 0.014;
  }

  function updateEnforcer(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'enforcer' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const close = Math.min(1, age / data.closeTime);
    const lead = MathUtils.lerp(data.leadStart, data.leadEnd, close * close * (3 - 2 * close));
    const anchorU = railAnchor(lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.45) * 1.2;
    offset.y += 2 + Math.sin(age * 0.7) * 0.7;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Broken open (stage 1): the exposed reactor judders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 23) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.1;
    }
    return runProgress > anchorU + 0.014;
  }

  function updateTracer(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'tracer' }>) {
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
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5.5,
      maxSpeed: 13,
      accel: 3.6,
      turnRate: 2.5,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > TRACER_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateGunship(context: DownpourUpdate) {
    const { enemy, runTime, age, curve, camera, railAnchor } = context;

    // Canal (revealed, sealed): it shadows the run from a distance, weaving
    // contemptuously. Once it engages, it closes in and the locks open.
    const hunting = runTime >= GUNSHIP_ENGAGE_TIME;
    if (gunshipEntry && hunting) gunshipEntry.lockable = true;

    if (!gunshipDown && runTime >= GUNSHIP_BREAKOFF_TIME) {
      gunshipEscaped = true;
      return true; // peels off into the storm — the one that got away
    }

    const state = context.enemyState(() => ({ closeness: 0, nextFireAt: GUNSHIP_ENGAGE_TIME - enemy.spawnTime + 1.2 }));
    state.closeness = MathUtils.lerp(state.closeness, hunting ? 1 : 0, Math.min(1, age * 0.02 + 0.02));
    const lead = MathUtils.lerp(6.8, 3.9, state.closeness);
    const anchorU = railAnchor(lead);

    // It owns the upper airspace so it never masks the waves running below.
    const sway = hunting ? 5.2 : 9;
    const offset = new Vector3(
      Math.sin(age * 0.55) * sway,
      hunting ? 6.4 + Math.sin(age * 0.83) * 1.2 : 4.2 + Math.sin(age * 0.83) * 2.6,
      0,
    );
    // Final stage: the core is exposed; it strafes tighter and shudders.
    if (enemy.hitStageIndex >= 2) {
      offset.x = Math.sin(age * 0.9) * 4.2 + Math.sin(age * 24) * 0.16;
      offset.y += Math.cos(age * 21) * 0.14;
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.55) * -0.12);

    // It fires in bursts once the hunt is on; each broken stage angers it.
    if (hunting && age >= state.nextFireAt) {
      const cadence = enemy.hitStageIndex >= 2 ? 2.2 : enemy.hitStageIndex >= 1 ? 2.8 : 3.4;
      state.nextFireAt = age + cadence;
      fireTracer(context, enemy.mesh.position, 6.2);
    }
    return false;
  }

  // ---- level definition ---------------------------------------------------------

  return {
    duration: DOWNPOUR_DURATION,
    bpm: DOWNPOUR_BPM,
    playerHealth: DOWNPOUR_PLAYER_HEALTH,
    createRail: createDownpourRail,
    spawnTimeline: timeline,
    easeRunProgress: downpourRunProgress,
    startWord: 'START',
    replayWord: 'REPLAY',
    // 176 BPM DnB: keep volley shots on a tight grid so a six-lock release
    // rolls out inside a single bar instead of trailing into the next phrase.
    timing: { shotDelay: { maxGridSeconds: 0.9 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'drone':
          return updateDrone(context, data);
        case 'skimmer':
          return updateSkimmer(context, data);
        case 'sentry':
          return updateSentry(context, data);
        case 'enforcer':
          return updateEnforcer(context, data);
        case 'tracer':
          return updateTracer(context, data);
        case 'gunship':
          return updateGunship(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'tracer') tracersDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (enforcer plating, gunship stages) pays a little.
    scoreForHit: () => 50,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (gunshipDown && score >= 13000 && clearRate >= 0.8) return 'S';
      if (score >= 9000 && clearRate >= 0.6) return 'A';
      if (score >= 5500 && clearRate >= 0.4) return 'B';
      if (score >= 2500 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, DOWNPOUR_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${DOWNPOUR_PLAYER_HEALTH}`];
      if (tracersDowned > 0) lines.push(`${tracersDowned} tracer${tracersDowned === 1 ? '' : 's'} shot down`);
      if (gunshipDown) lines.push('Hunter-gunship destroyed');
      else if (gunshipEscaped) lines.push('The gunship broke off — it will find you again');
      return lines;
    },
    gunshipKilled: () => gunshipDown,
  };
}

export { CANAL_TIME, HUNT_TIME, PLUNGE_TIME, SUMMIT_TIME, UNDERCITY_TIME };
