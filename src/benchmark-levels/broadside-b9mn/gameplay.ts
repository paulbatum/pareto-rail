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
import { BROADSIDE_BPM, BROADSIDE_DURATION, bar } from './timing';

// BROADSIDE — 60 seconds across a full fleet engagement:
//
//   Launch     (bars 0–4)    Catapult off your own flagship's deck into the fight.
//   Gauntlet   (bars 4–11)   Hard banks through the gaps between the capital lines.
//   Broadside  (bars 11–16)  Full-speed run down a friendly cruiser's flank while
//                            its main guns fire over your canopy.
//   The Eye    (bars 16–18)  The dead calm in the middle of the battle. Wreckage.
//   Belly run  (bars 18–22)  Under an enemy cruiser, raking its turrets as you pass.
//   Flagship   (bars 22–28)  Phase one: shield generators along the hull, point
//                            defense filling the space around you; then over the
//                            spine while the escorts pour in.
//   Trench     (bars 28–34)  Phase two: dive into the trenchwork and blow the
//                            exposed power cores at its heart.
//   Victory    (bars 34–36)  Pull out past the breaking flagship, the whole
//                            battle in frame.

export {
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_MARKERS,
  bar,
} from './timing';

export const BROADSIDE_PLAYER_HEALTH = 4;

// ---- battlefield geometry ---------------------------------------------------

// The engagement is laid out along -Z. The rail weaves through it; capital
// ships are the walls, ceilings, and floors it flies close to.
export const FRIENDLY_FLANK = {
  // Friendly cruiser wall on the right during the broadside run (bars 11–16).
  faceX: 78,
  topY: 34,
  bottomY: -12,
  fromZ: -470,
  toZ: -910,
} as const;

export const ENEMY_BELLY = {
  // Enemy cruiser overhead during the belly run (bars 18–22).
  bellyY: 2,
  fromZ: -990,
  toZ: -1265,
  centerX: -14,
  halfWidth: 46,
} as const;

export const FLAGSHIP_GEOM = {
  // The enemy flagship: the last 640 metres of the run.
  centerX: 60,
  centerY: -4,
  faceX: 30, // port face the phase-one pass hugs
  deckY: 18,
  bellyY: -26,
  fromZ: -1270,
  toZ: -1910,
  trench: { x: 60, halfWidth: 11, floorY: -7, fromZ: -1510, toZ: -1800 },
} as const;

const RAIL_POINTS: Array<[number, number, number]> = [
  [0, 6, 30], // catapult run-up along the deck
  [0, 7, -40], // off the bow
  [-14, 4, -120], // bank left into the gauntlet
  [24, -6, -220], // hard right weave
  [-28, 10, -320], // climb left
  [8, -12, -410], // dive through a gap
  [38, 0, -500], // swing onto the friendly cruiser's flank
  [46, 6, -620], // flank run
  [44, 10, -740], // flank run
  [18, 4, -840], // peel off toward the eye
  [-8, -2, -930], // the eye
  [-24, -16, -1020], // dip under the enemy cruiser
  [-18, -14, -1120], // belly run
  [2, -6, -1210], // exit; flagship dead ahead
  [16, 0, -1290], // along the flagship hull
  [24, 6, -1370], // hull pass
  [36, 26, -1450], // climbing over the deck line
  [56, 30, -1500], // over the dorsal spine
  [60, 10, -1555], // dive into the trench
  [60, 2, -1630], // trench
  [60, 8, -1700], // trench deep
  [60, 18, -1780], // trench exit over the stern
  [56, 60, -1840], // pull-up
  [50, 112, -1892], // away above the battle
];

export function createBroadsideRail() {
  return new CatmullRomCurve3(
    RAIL_POINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'catmullrom',
    0.32,
  );
}

// ---- speed profile → rail easing --------------------------------------------

// The catapult is the level's opening statement; the broadside run is the
// fastest stretch; the eye almost stops; the trench surges again; the victory
// pull-out accelerates away.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.5],
  [bar(0.7), 1.95],
  [bar(2), 1.25],
  [bar(4), 1.2],
  [bar(10.5), 1.25],
  [bar(11.4), 1.9],
  [bar(15), 1.55],
  [bar(16), 0.72],
  [bar(17.5), 0.72],
  [bar(18.6), 1.35],
  [bar(22), 1.1],
  [bar(26), 1.25],
  [bar(28), 1.5],
  [bar(33), 1.35],
  [bar(34), 1.75],
  [bar(36), 1.2],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function broadsideRunProgress(time: number, duration = BROADSIDE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => broadsideRunProgress(time);

// ---- spawn data --------------------------------------------------------------

export type BroadsideEnemyKind =
  | 'dart'
  | 'lancer'
  | 'turret'
  | 'escort'
  | 'bolt'
  | 'shieldgen'
  | 'core';

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in enemyState bags; boss state lives in the
// flagship module; dynamically spawned bolts get fresh data objects.
export type BroadsideSpawnData =
  | { role: 'dart'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number; roll: number }
  | { role: 'lancer'; lead: number; x: number; y: number; side: number; delay: number; seed: number }
  | { role: 'turret'; lead: number; x: number; y: number; seed: number }
  | { role: 'escort'; lead: number; phase0: number; radius: number; ccw: boolean; delay: number; yLift: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'shieldgen'; lead: number; x: number; y: number; index: number }
  | { role: 'core'; lead: number; x: number; y: number; index: number };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// ---- spawn timeline -----------------------------------------------------------

const darts = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.08,
    kind: 'dart',
    data: {
      role: 'dart',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.32,
      crossTime: run.crossTime ?? 2.5,
      roll: (index % 2 === 0 ? 1 : -1) * (0.8 + index * 0.15),
    },
  }));

const lancers = (time: number, lead: number, posts: Array<[number, number]>): BroadsideSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.24,
    kind: 'lancer',
    data: { role: 'lancer', lead, x, y, side: x >= 0 ? 1 : -1, delay: index * 0.3, seed: index * 3.7 + time },
  }));

const turrets = (time: number, lead: number, mounts: Array<[number, number]>): BroadsideSpawnEntry[] =>
  mounts.map(([x, y], index) => ({
    time: time + index * 0.2,
    kind: 'turret',
    // Two one-point stages: the casing shears off (stage event), then the works.
    hitStages: [1, 1],
    data: { role: 'turret', lead, x, y, seed: index * 2.3 + time },
  }));

// Radius stays inside the trench half-width: these spirals fly between the
// flagship's walls as often as the open battle.
// Radius stays inside the trench half-width, and the golden-angle phase plus
// the wide time stagger keeps pack members from eclipsing each other along
// the view axis.
const escorts = (time: number, lead: number, count: number, ccw: boolean, yLift = 3): BroadsideSpawnEntry[] =>
  Array.from({ length: count }, (_unused, index) => ({
    time: time + index * 0.3,
    kind: 'escort',
    data: {
      role: 'escort',
      lead,
      phase0: index * 2.4 + (ccw ? 0.4 : 2.1),
      radius: 7 + (index % 3) * 0.8,
      ccw,
      delay: index * 0.22,
      yLift,
    },
  }));

function buildTimeline(flagshipEntries: BroadsideSpawnEntry[]): BroadsideSpawnEntry[] {
  return [
    // --- Launch: the first swarm meets you coming off the bow.
    ...darts(bar(1.4), 3.6, [
      { fromX: -24, toX: 24, y: 4, arc: 2.6 },
      { fromX: -24, toX: 24, y: -4, arc: 3.2 },
      { fromX: -24, toX: 24, y: 10, arc: 1.8 },
    ]),
    ...darts(bar(2.6), 3.5, [
      { fromX: 24, toX: -24, y: 7, arc: 2.2 },
      { fromX: 24, toX: -24, y: -2, arc: 3.0 },
    ]),

    // --- Gauntlet: waves off the enemy carriers, both directions, full frame.
    ...darts(bar(4.1), 3.4, [
      { fromX: -26, toX: 26, y: -6, arc: 3.8, delay: 0 },
      { fromX: 26, toX: -26, y: 1, arc: 3.0, delay: 0.26 },
      { fromX: -26, toX: 26, y: 6, arc: 2.4, delay: 0.52 },
      { fromX: 26, toX: -26, y: 11, arc: 1.7, delay: 0.78 },
    ]),
    ...lancers(bar(5.1), 3.3, [[-15, 8], [15, -2]]),
    ...darts(bar(6.3), 3.3, [
      { fromX: 26, toX: -26, y: -4, arc: 3.4 },
      { fromX: -26, toX: 26, y: 3, arc: 2.6 },
      { fromX: 26, toX: -26, y: 9.5, arc: 2.0 },
    ]),
    ...lancers(bar(7.2), 3.2, [[-12, -4], [4, 10], [16, 4]]),
    ...darts(bar(8.3), 3.2, [
      { fromX: -27, toX: 27, y: 0, arc: 3.2, delay: 0 },
      { fromX: -27, toX: 27, y: 8, arc: 2.2, delay: 0.3 },
      { fromX: 27, toX: -27, y: -7, arc: 4.0, delay: 0.6 },
      { fromX: 27, toX: -27, y: 4, arc: 2.8, delay: 0.9 },
    ]),
    ...lancers(bar(9.3), 3.1, [[-16, 2], [14, 9]]),
    ...darts(bar(10.1), 3.0, [
      { fromX: 26, toX: -26, y: 5.5, arc: 2.4 },
      { fromX: -26, toX: 26, y: -3, arc: 3.4 },
    ]),

    // --- Broadside run: fast crossings while the guns fire overhead.
    // Width stays under ±24 here: the friendly hull wall is close to starboard.
    ...darts(bar(11.6), 2.8, [
      { fromX: -24, toX: 24, y: -5, arc: 3.6, delay: 0, crossTime: 2.1 },
      { fromX: 24, toX: -24, y: 1.5, arc: 2.8, delay: 0.2, crossTime: 2.1 },
      { fromX: -24, toX: 24, y: 7.5, arc: 2.2, delay: 0.4, crossTime: 2.1 },
      { fromX: 24, toX: -24, y: 12, arc: 1.6, delay: 0.6, crossTime: 2.1 },
    ]),
    ...lancers(bar(12.6), 2.9, [[-14, 6], [10, -3]]),
    ...darts(bar(13.5), 2.8, [
      { fromX: 24, toX: -24, y: -6, arc: 3.8, delay: 0, crossTime: 2.1 },
      { fromX: -24, toX: 24, y: 2.5, arc: 2.8, delay: 0.25, crossTime: 2.1 },
      { fromX: 24, toX: -24, y: 9, arc: 2.0, delay: 0.5, crossTime: 2.1 },
    ]),
    ...lancers(bar(14.5), 2.8, [[-9, 10], [15, 3]]),

    // --- The eye: two dead-stick drifters coasting through the wreckage.
    ...darts(bar(16.6), 3.6, [
      { fromX: -22, toX: 14, y: 6, arc: 1.2, crossTime: 3.6 },
      { fromX: 20, toX: -14, y: -2, arc: 1.6, delay: 0.5, crossTime: 3.6 },
    ]),

    // --- Belly run: turret rows hanging off the cruiser's keel overhead.
    ...turrets(bar(18.3), 3.4, [[-11, 10], [8, 12]]),
    ...darts(bar(19.1), 3.2, [
      { fromX: 26, toX: -26, y: -6, arc: 2.6 },
      { fromX: -26, toX: 26, y: -1, arc: 2.2 },
    ]),
    ...turrets(bar(19.6), 3.3, [[-4, 13], [14, 9], [-16, 8]]),
    ...lancers(bar(20.6), 3.1, [[-13, -5], [12, -2]]),
    ...turrets(bar(20.9), 3.2, [[3, 11], [-9, 12]]),

    // --- Flagship phase one + the trench cores: authored in the flagship module.
    ...flagshipEntries,
    ...darts(bar(24.0), 3.1, [
      { fromX: -24, toX: 20, y: -5, arc: 2.4 },
      { fromX: -22, toX: 24, y: 12, arc: 1.6, delay: 0.4 },
    ]),

    // --- The dive and the trench: the escorts pour in behind you as the
    // shield falls and chase you between the walls. The spine crossing
    // itself stays empty — targets there hide behind the hull's deck edge.
    ...escorts(bar(28.3), 2.4, 3, true),
    ...escorts(bar(29.5), 2.5, 2, false),
    ...darts(bar(30.6), 2.4, [
      { fromX: -8, toX: 8, y: 2, arc: 1.6, crossTime: 2.0 },
      { fromX: 8, toX: -8, y: 4.5, arc: 1.2, delay: 0.4, crossTime: 2.0 },
    ]),
    ...escorts(bar(31.4), 2.5, 2, true),

    // (bars 34–36: the pull-out. Nothing spawns; the view is the payoff.)
  ];
}

export function createBroadsideTimeline() {
  const flagship = createFlagshipEntries();
  return {
    genEntries: flagship.genEntries,
    coreEntries: flagship.coreEntries,
    timeline: buildTimeline(flagship.timeline).sort((a, b) => a.time - b.time),
  };
}

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  dart: 90,
  lancer: 160,
  turret: 220,
  escort: 150,
  bolt: 40,
  shieldgen: 420,
  core: 900,
};

const BOLT_MAX_AGE = 11;
const MAX_LIVE_BOLTS = 9;
const PASS_GRACE = 0.012;

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const { timeline, genEntries, coreEntries } = createBroadsideTimeline();

  const interceptions = new Set<number>();
  const liveBolts = new Set<number>();
  let hitsTaken = 0;
  let boltsShot = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    liveBolts.clear();
    hitsTaken = 0;
    boltsShot = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    liveBolts.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    liveBolts.delete(enemyId);
  });

  function fireBolt(context: BroadsideUpdate, from: Vector3, speed = 24) {
    if (liveBolts.size >= MAX_LIVE_BOLTS) return;
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    const id = context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
    liveBolts.add(id);
  }

  const flagship = createFlagship(bus, { genEntries, coreEntries, fireBolt });

  // ---- movement ---------------------------------------------------------------

  function updateDart(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'dart' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + PASS_GRACE) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    // The arc is the bank; the corkscrew wobble is the swarm's signature.
    const y = data.y
      + Math.sin(clamped * Math.PI) * data.arc
      + Math.sin(clamped * Math.PI * 2 * Math.abs(data.roll) + enemy.id) * 0.8;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const aheadT = Math.min(1, clamped + 0.05);
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, aheadT),
      data.y + Math.sin(aheadT * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * (0.6 + Math.sin(clamped * Math.PI) * 0.9) * Math.sign(data.roll));
    return false;
  }

  function updateLancer(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'lancer' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = age - data.delay;
    const SWOOP = 1.3;
    const HOLD = 2.3;
    let x = data.x;
    let y = data.y;
    if (t < SWOOP) {
      // Swoop in from the flank on a decelerating arc. Entry stays inside
      // ±30 of the rail so it never starts inside a cruiser wall.
      const k = MathUtils.clamp(t / SWOOP, 0, 1);
      const eased = 1 - (1 - k) ** 2.6;
      x = MathUtils.lerp(data.x + data.side * 20, data.x, eased);
      y = data.y + Math.sin(k * Math.PI) * 4.5;
    } else if (t < SWOOP + HOLD) {
      // On post: hover with a hard little jink, wind up, and fire once.
      const held = t - SWOOP;
      x = data.x + Math.sin(held * 2.1 + data.seed) * 1.4;
      y = data.y + Math.sin(held * 3.4 + data.seed * 2) * 0.9;
      const state = context.enemyState(() => ({ fired: false }));
      const fireAt = SWOOP + 0.9 + (data.seed % 0.6);
      enemy.mesh.userData.charge = MathUtils.clamp((t - (fireAt - 0.7)) / 0.7, 0, 1);
      if (!state.fired && t >= fireAt) {
        state.fired = true;
        enemy.mesh.userData.charge = 0;
        fireBolt(context, enemy.mesh.position.clone());
      }
    } else {
      // Break away down and off the rail line.
      const off = t - SWOOP - HOLD;
      x = data.x + data.side * off * 16;
      y = data.y - off * off * 20;
      if (off > 1.2) return true;
    }
    if (runProgress > anchorU + PASS_GRACE) return true;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.side * 0.3 + Math.sin(age * 2.2 + data.seed) * 0.18);
    return false;
  }

  function updateTurret(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'turret' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Deploy: drop down out of the keel plating, then track the player.
    const deploy = MathUtils.clamp(age / 0.8, 0, 1);
    const y = data.y + (1 - (1 - deploy) ** 2) * -3.5;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x, y, 0)));
    enemy.mesh.lookAt(camera.position);
    const state = context.enemyState(() => ({ fireAt: 1.6 + (data.seed % 0.9) }));
    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.8 ? 1 - untilShot / 0.8 : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 3.4;
      fireBolt(context, enemy.mesh.position.clone(), 26);
    }
    return runProgress > anchorU + PASS_GRACE;
  }

  function updateEscort(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'escort' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = Math.max(0, age - data.delay);
    // Corkscrew in around the rail axis, tightening as it closes.
    const angle = data.phase0 + (data.ccw ? 1 : -1) * t * 2.3;
    const radius = MathUtils.lerp(data.radius, 5.5, MathUtils.clamp(t / 3.2, 0, 1));
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.62 + data.yLift;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const nextAngle = angle + (data.ccw ? 1 : -1) * 0.3;
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      Math.cos(nextAngle) * radius,
      Math.sin(nextAngle) * radius * 0.62 + data.yLift,
      -2,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.ccw ? -1 : 1) * 1.1);
    return runProgress > anchorU + PASS_GRACE;
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

    // This level's camera moves fast; bolts must be faster or they can never
    // close the gap and simply fall behind the fight.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 26,
      maxSpeed: 50,
      accel: 9,
      turnRate: 2.8,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ---------------------------------------------------------

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    createRail: createBroadsideRail,
    spawnTimeline: timeline,
    easeRunProgress: broadsideRunProgress,
    startWord: 'SORTIE',
    timing: {
      // A fast level: cap the coarsest shot-snap well under the default so
      // late volley shots do not lag the reticle at combat speed.
      shotDelay: { maxGridSeconds: 1.25 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'dart':
          return updateDart(context, data);
        case 'lancer':
          return updateLancer(context, data);
        case 'turret':
          return updateTurret(context, data);
        case 'escort':
          return updateEscort(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'shieldgen':
          return flagship.updateGen(context, data);
        case 'core':
          return flagship.updateCore(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsShot += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (turret casings, generators, core housings) pays a little.
    scoreForHit: () => 50,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      // A clean six-kill release is the level's namesake: a full broadside.
      return results.length === 6 ? 650 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (flagship.destroyed() && score >= 13000 && clearRate >= 0.97) return 'S';
      if (score >= 12000 && clearRate >= 0.62) return 'A';
      if (score >= 7000 && clearRate >= 0.4) return 'B';
      if (score >= 3000 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${BROADSIDE_PLAYER_HEALTH}`];
      if (boltsShot > 0) lines.push(`${boltsShot} incoming bolt${boltsShot === 1 ? '' : 's'} shot down`);
      const genLine = flagship.genSummaryLine();
      if (genLine) lines.push(genLine);
      const bossLine = flagship.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
