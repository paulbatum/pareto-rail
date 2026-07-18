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
import { createFlagship, createFlagshipEntries } from './flagship';
import { BROADSIDE_BPM, BROADSIDE_DURATION, BROADSIDE_TIME, bar } from './timing';

// BROADSIDE — launched off your own flagship's deck into the middle of a
// fleet engagement, flown across the whole battle in sixty seconds:
//
//   Launch    (0–4)    catapult slam off the deck, first skiff pickets.
//   Gauntlet  (4–10)   hard banks between the capital hulls; the swarm arrives.
//   Broadside (10–16)  flat out down a friendly cruiser's flank, her guns
//                      going off overhead on the downbeats.
//   The Eye   (16–18)  the becalmed pocket at the heart of the battle.
//   The Belly (18–24)  inverted world: an enemy warship's keel overhead,
//                      raking its turrets as they track you.
//   Flagship  (24–29)  phase 1 — shield generators one by one, point
//                      defense filling the space around the rail.
//   Escorts   (29–31)  the shield falls; fighters pour in; the rail banks
//                      around for the second pass.
//   Trench    (31–35)  dive into the trenchwork, kill the exposed power
//                      cores, and climb away as the line breaks.

export { BROADSIDE_BPM, BROADSIDE_DURATION, bar } from './timing';

export const BROADSIDE_PLAYER_HEALTH = 3;

export type BroadsideEnemyKind =
  | 'dart'
  | 'skiff'
  | 'raptor'
  | 'turret'
  | 'shieldgen'
  | 'core'
  | 'bolt';

// Timeline data is immutable and reused across runs; per-instance mutable
// state lives in the runner's enemyState bags, and boss/run state lives in
// the flagship module. Bolts are runtime spawns with fresh data objects.
export type BroadsideSpawnData =
  | { role: 'dart'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'skiff'; lead: number; offset: Vector3; spin: number; drift?: boolean }
  | { role: 'raptor'; lead: number; offset: Vector3; seed: number }
  | { role: 'turret'; lead: number; offset: Vector3; seed: number }
  | { role: 'shieldgen'; lead: number; offset: Vector3; index: number }
  | { role: 'core'; lead: number; offset: Vector3; index: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; heavy: boolean };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// ---- speed profile → rail easing -------------------------------------------

// The capital ships are vast and slow; you are quick and small. The profile
// is the contrast: the catapult slam, the broadside surge, the near-stall in
// the eye, and the trench dive are the four acceleration moments.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.5],
  [bar(0.5), 1.9],
  [bar(2), 1.15],
  [bar(4), 1.2],
  [bar(10), 1.25],
  [bar(10.7), 1.72],
  [bar(15), 1.45],
  [bar(16), 0.6],
  [bar(17.6), 0.62],
  [bar(18.8), 1.32],
  [bar(24), 1.1],
  [bar(29), 1.06],
  [bar(31), 1.88],
  [bar(33.5), 1.5],
  [bar(35), 1.1],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function broadsideRunProgress(time: number, duration = BROADSIDE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => broadsideRunProgress(time);

// ---- rail --------------------------------------------------------------------

// Off the deck, S-banks through the melee, a long straight down the cruiser
// flank, a drift through the eye, a shallow dive under the enemy keel, a
// bank around the flagship, the trench, and the climb away.
export function createBroadsideRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 4, 0),
      new Vector3(0, 5, -62),
      new Vector3(-14, 7, -132),
      new Vector3(21, 2, -212),
      new Vector3(-25, 9, -292),
      new Vector3(16, -1, -372),
      new Vector3(2, 3, -452),
      new Vector3(-3, 2, -545),
      new Vector3(-5, 3, -645),
      new Vector3(0, 1, -706),
      new Vector3(7, -4, -766),
      new Vector3(3, -6, -846),
      new Vector3(-6, -5, -924),
      new Vector3(-20, 0, -1002),
      new Vector3(-29, 4, -1082),
      new Vector3(-17, 2, -1152),
      new Vector3(0, -2, -1222),
      new Vector3(5, -3, -1292),
      new Vector3(0, 7, -1362),
      new Vector3(-5, 30, -1438),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// ---- spawn timeline -----------------------------------------------------------

const darts = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.09,
    kind: 'dart',
    data: {
      role: 'dart',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.66,
      crossTime: run.crossTime ?? 2.9,
    },
  }));

const skiffWheel = (
  time: number,
  lead: number,
  spin: number,
  center: [number, number],
  offsets: Array<[number, number]>,
  drift = false,
): BroadsideSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.12,
    kind: 'skiff',
    data: {
      role: 'skiff',
      lead,
      spin,
      drift,
      offset: new Vector3(center[0] + offset[0], center[1] + offset[1], 0),
    },
  }));

const ring = (count: number, radius: number, phase = 0): Array<[number, number]> =>
  Array.from({ length: count }, (_item, index) => {
    const angle = phase + (index / count) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72];
  });

const raptors = (time: number, lead: number, offsets: Array<[number, number]>): BroadsideSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.22,
    kind: 'raptor',
    data: { role: 'raptor', lead, seed: time * 1.7 + index * 2.61, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const turret = (time: number, lead: number, x: number, y: number): BroadsideSpawnEntry => ({
  time,
  kind: 'turret',
  hitStages: [2, 1],
  data: { role: 'turret', lead, seed: time * 2.13, offset: new Vector3(x, y, 0) },
});

function buildBroadsideTimeline(flagshipEntries: BroadsideSpawnEntry[]): BroadsideSpawnEntry[] {
  return [
    // --- Launch: pickets dead ahead; learn the sweep while the catapult glow fades.
    ...skiffWheel(bar(1), 2.6, 0.4, [0, 2.4], ring(4, 6.0, 0.5)),
    ...darts(bar(2.5), 2.5, [
      { fromX: -20, toX: 20, y: -1.2, arc: 2.2 },
      { fromX: -20, toX: 20, y: 3.4, arc: 1.6 },
      { fromX: 20, toX: -20, y: 6.6, arc: 1.0 },
    ]),

    // --- The Gauntlet: waves every two bars, the melee closing in.
    ...skiffWheel(bar(4), 2.5, -0.45, [-3, 2.2], ring(5, 6.6, 0.2)),
    ...darts(bar(5), 2.5, [
      { fromX: -22, toX: 22, y: -1.6, arc: 2.8 },
      { fromX: 22, toX: -22, y: 2.2, arc: 2.0 },
      { fromX: -22, toX: 22, y: 4.8, arc: 1.6 },
      { fromX: 22, toX: -22, y: 7.0, arc: 0.8 },
    ]),
    ...raptors(bar(6), 2.7, [[-8, 5.2], [8, 2.2]]),
    ...skiffWheel(bar(7), 2.5, 0.5, [3, 2.6], ring(6, 7.2, 0)),
    ...darts(bar(8), 2.5, [
      { fromX: -22, toX: 22, y: 0.6, arc: 3, delay: 0 },
      { fromX: 22, toX: -22, y: 3, arc: 2.2, delay: 0.34 },
      { fromX: -22, toX: 22, y: 5.4, arc: 1.4, delay: 0.68 },
      { fromX: 22, toX: -22, y: -1.8, arc: 3.4, delay: 1.02 },
      { fromX: -22, toX: 22, y: 7.2, arc: 0.8, delay: 1.36 },
    ]),
    ...raptors(bar(8.5), 2.7, [[0, 7.0]]),
    ...skiffWheel(bar(9.2), 2.5, 0.35, [0, 2], [[-9.5, -3.0], [-3.4, 0.2], [3.4, 2.6], [9.5, 5.6]]),

    // --- Broadside: a squadron crosses under every salvo; the theme carries it.
    ...darts(bar(10.25), 2.5, [
      { fromX: -24, toX: 24, y: 1.2, arc: 2.6, crossTime: 2.5 },
      { fromX: -24, toX: 24, y: 3.6, arc: 1.8, crossTime: 2.5 },
      { fromX: -24, toX: 24, y: 6.4, arc: 1.2, crossTime: 2.5 },
      { fromX: -24, toX: 24, y: -1.8, arc: 3.2, crossTime: 2.5 },
    ]),
    ...skiffWheel(bar(11), 2.5, 0.6, [-4, 2.8], ring(5, 6.4, 0.9)),
    ...darts(bar(12.25), 2.5, [
      { fromX: 24, toX: -24, y: -1.2, arc: 3, crossTime: 2.5 },
      { fromX: 24, toX: -24, y: 2.4, arc: 2.2, crossTime: 2.5 },
      { fromX: 24, toX: -24, y: 4.8, arc: 1.5, crossTime: 2.5 },
      { fromX: 24, toX: -24, y: 7.0, arc: 0.9, crossTime: 2.5 },
    ]),
    ...raptors(bar(13), 2.7, [[-8.5, 0.4], [8.5, 5.8]]),
    ...darts(bar(14.4), 2.5, [
      { fromX: -24, toX: 24, y: 0.8, arc: 3, crossTime: 2.0, delay: 0 },
      { fromX: 24, toX: -24, y: 4.8, arc: -2.8, crossTime: 2.0, delay: 0.22 },
      { fromX: -24, toX: 24, y: 2.8, arc: 2.2, crossTime: 2.0, delay: 0.44 },
      { fromX: 24, toX: -24, y: 6.4, arc: -1.4, crossTime: 2.0, delay: 0.66 },
    ]),

    // --- The Eye: two dead skiffs adrift in the calm. Quiet kills.
    ...skiffWheel(bar(16.4), 2.6, 0.06, [0, 0], [[-7.5, 5.6], [8, 0.6]], true),

    // --- The Belly: turrets hang from the keel overhead; the swarm hunts below.
    turret(bar(18.4), 3.0, -4.5, 7.2),
    ...darts(bar(19), 2.5, [
      { fromX: -22, toX: 22, y: -1.4, arc: 2.2 },
      { fromX: 22, toX: -22, y: 2.0, arc: 1.6 },
      { fromX: -22, toX: 22, y: 4.6, arc: 1.2 },
    ]),
    turret(bar(19.8), 3.0, 5.0, 7.4),
    ...raptors(bar(20.5), 2.7, [[-8.5, -0.2], [8.5, 2.6]]),
    turret(bar(21.3), 3.0, -6.6, 7.2),
    ...darts(bar(22), 2.5, [
      { fromX: 22, toX: -22, y: 0.8, arc: 2.4 },
      { fromX: -22, toX: 22, y: 3.2, arc: 1.8 },
      { fromX: 22, toX: -22, y: 5.6, arc: 1.2 },
      { fromX: -22, toX: 22, y: -2.0, arc: 2.8 },
    ]),
    turret(bar(22.8), 3.0, 6.4, 7.3),
    ...skiffWheel(bar(23.2), 2.5, 0.45, [0, 0.2], ring(4, 6.0, 0.4)),

    // --- Flagship phase 1: generators to port, point defense everywhere,
    //     dart cover crossing from starboard.
    ...flagshipEntries,
    ...darts(bar(25), 2.5, [
      { fromX: 24, toX: -24, y: 2.2, arc: 2, crossTime: 2.6 },
      { fromX: 24, toX: -24, y: 5.6, arc: 1.4, crossTime: 2.6 },
      { fromX: 24, toX: -24, y: -0.8, arc: 2.6, crossTime: 2.6 },
    ]),
    ...darts(bar(27), 2.5, [
      { fromX: 24, toX: -24, y: 0.6, arc: 2.4, crossTime: 2.6 },
      { fromX: 24, toX: -24, y: 6.4, arc: 1.0, crossTime: 2.6 },
      { fromX: -24, toX: 24, y: 3.2, arc: 1.8, crossTime: 2.6 },
    ]),

    // --- Escorts: the shield is down and everything with wings comes at once.
    ...darts(bar(29.1), 2.4, [
      { fromX: -10, toX: 10, y: 0.6, arc: 2.4, crossTime: 1.9, delay: 0 },
      { fromX: 10, toX: -10, y: 2.4, arc: -1.8, crossTime: 1.9, delay: 0.19 },
      { fromX: -10, toX: 10, y: 4.4, arc: 1.6, crossTime: 1.9, delay: 0.38 },
      { fromX: 10, toX: -10, y: 6, arc: -1.2, crossTime: 1.9, delay: 0.57 },
      { fromX: -10, toX: 10, y: 1.4, arc: 2.0, crossTime: 1.9, delay: 0.76 },
      { fromX: 10, toX: -10, y: 3.4, arc: -1.6, crossTime: 1.9, delay: 0.95 },
    ]),
    ...raptors(bar(29.9), 2.6, [[-7, 5.2], [7, 1.0]]),

    // --- The Trench: cores between the walls; a last pair of chasers.
    ...darts(bar(32.1), 2.7, [
      { fromX: -9, toX: 9, y: 4.8, arc: 1.2, crossTime: 1.9 },
      { fromX: 9, toX: -9, y: 0.6, arc: 1.6, crossTime: 1.9 },
    ]),
  ];
}

export function createBroadsideTimeline() {
  const flagship = createFlagshipEntries();
  return {
    flagship,
    timeline: buildBroadsideTimeline(flagship.timeline).sort((a, b) => a.time - b.time),
  };
}

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  dart: 100,
  skiff: 120,
  raptor: 220,
  turret: 380,
  shieldgen: 500,
  core: 800,
  bolt: 50,
};

const BOLT_MAX_AGE = 11;
const PASS_MARGIN = 0.012;

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const { timeline, flagship: flagshipEntries } = createBroadsideTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let boltsDowned = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    boltsDowned = 0;
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

  function fireBolt(context: BroadsideUpdate, from: Vector3, heavy: boolean) {
    const speed = heavy ? 8.5 : 7;
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {}, heavy },
    });
  }

  const flagship = createFlagship(bus, { entries: flagshipEntries, fireBolt });

  // ---- movement ---------------------------------------------------------------

  // Darts cross the whole screen in squadron file — the swarm's motion is
  // lateral, not approach; sweeping the reticle across them is the game.
  function updateDart(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'dart' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + PASS_MARGIN) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 2.6 + enemy.id) * 0.5)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)),
      data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    // Corkscrew roll along the flight line — the fast-and-small read.
    enemy.mesh.rotateZ(age * 7 + enemy.id);
    return false;
  }

  // Skiffs hold station in a slowly wheeling picket; adrift in the eye they
  // barely tumble — dead ships among the living.
  function updateSkiff(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'skiff' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const angle = age * data.spin;
    const breathe = data.drift ? 1 : 1 + Math.sin(age * 1.2 + enemy.id) * 0.07;
    const x = (data.offset.x * Math.cos(angle) - data.offset.y * Math.sin(angle)) * breathe;
    const y = (data.offset.x * Math.sin(angle) + data.offset.y * Math.cos(angle)) * breathe + 1.4;
    const sway = data.drift ? Math.sin(age * 0.5 + enemy.id) * 0.6 : 0;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x + sway, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * (data.drift ? 0.25 : 0.7 + (enemy.id % 3) * 0.2) + enemy.id * 1.9);
    enemy.mesh.rotateY(Math.sin(age * 0.8 + enemy.id) * 0.4);
    return runProgress > anchorU + PASS_MARGIN;
  }

  // Raptors weave a hunting figure-eight, rear back, and lunge as they loose
  // a crimson bolt — the telegraph is the rear-back.
  function updateRaptor(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'raptor' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 1.1 + data.seed) * 2.8;
    offset.y += Math.sin(age * 2.2 + data.seed * 1.7) * 1.5;

    const fire = context.enemyState(() => ({ nextAt: 0.85 }));
    const untilShot = fire.nextAt - age;
    if (untilShot < 0.85 && untilShot > 0.5) offset.z += (0.85 - untilShot) * 9; // rear back
    else if (untilShot <= 0.5 && untilShot > 0) offset.z -= (0.5 - untilShot) * 15; // lunge
    if (age >= fire.nextAt) {
      fire.nextAt = age + 2.0;
      fireBolt(context, enemy.mesh.position, false);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.9 + data.seed) * 0.45);
    return runProgress > anchorU + PASS_MARGIN;
  }

  // Turrets are rooted to the keel overhead, traversing to track the rail and
  // firing heavy shells. Armor first, then the exposed mount.
  function updateTurret(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'turret' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.4 + data.seed) * 0.5;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.lookAt(camera.position);

    const fire = context.enemyState(() => ({ nextAt: 1.0 + (data.seed % 1) * 0.5 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 1.9;
      fireBolt(context, enemy.mesh.position, true);
    }
    // Armor cracked: the mount shudders on its yoke.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 23) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.1;
    }
    return runProgress > anchorU + PASS_MARGIN;
  }

  function updateBolt(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'bolt' }>) {
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
      config: { hitDistance: 3.1, impactBrake: 0.4, damageDistance: 0.7 },
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
      baseSpeed: data.heavy ? 9.5 : 8,
      maxSpeed: data.heavy ? 21 : 18,
      accel: data.heavy ? 5.4 : 4.6,
      turnRate: 3.3,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ----------------------------------------------------------

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    createRail: createBroadsideRail,
    spawnTimeline: timeline,
    easeRunProgress: broadsideRunProgress,
    startWord: 'ENGAGE',
    replayWord: 'SORTIE',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'dart':
          return updateDart(context, data);
        case 'skiff':
          return updateSkiff(context, data);
        case 'raptor':
          return updateRaptor(context, data);
        case 'turret':
          return updateTurret(context, data);
        case 'bolt': {
          const downed = updateBolt(context, data);
          return downed;
        }
        case 'shieldgen':
          return flagship.updateShieldGenerator(context, data);
        case 'core':
          return flagship.updateCore(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor — turret plate, generator housing, core casing — pays a little.
    scoreForHit: () => 60,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (flagship.destroyed() && score >= 17500 && clearRate >= 0.9) return 'S';
      if (score >= 12000 && clearRate >= 0.6) return 'A';
      if (score >= 7000 && clearRate >= 0.4) return 'B';
      if (score >= 3000 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${BROADSIDE_PLAYER_HEALTH}`];
      if (boltsDowned > 0) lines.push(`${boltsDowned} shell${boltsDowned === 1 ? '' : 's'} shot down`);
      const flagshipLine = flagship.summaryLine();
      if (flagshipLine) lines.push(flagshipLine);
      return lines;
    },
  };
}

// Authoritative time exports for consumers that only need the clock.
export const BROADSIDE_B4KD_BPM = BROADSIDE_BPM;
export const BROADSIDE_B4KD_TIME = BROADSIDE_TIME;
