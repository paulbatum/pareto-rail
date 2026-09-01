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
import { createParent, createParentEntries } from './parent';
import { CROWN_TIME, STRANDLINE_BPM, STRANDLINE_DURATION, bar } from './timing';
import { VISTA, WORLD_SCALE, approachPoint, cylindricalPoint } from './world';

// STRANDLINE — 60 seconds freeing a gigantic jellyfish from an infestation:
//
//   Drift   (bars 0–4)    Open water into the strand tips. One pulse, one pad.
//   Forest  (bars 4–8)    Inside the curtain of strands: ticks latch, darters cross.
//   Bell    (bars 8–10)   The rail swings wide; the bell fills the view like a moon.
//   Dive    (bars 10–16)  Back under the bell, the forest thickens, spores fly.
//   Crown   (bars 16–22)  The Parent, dug in where the strands root. Three webs,
//                         three broods. Kill a brood, its web dies back.
//   Serene  (bars 22–24)  The camera pulls back and back; the animal drifts on.
//
// The whole level is one animal in one world frame: bell centred on the
// origin, strands trailing down -Y, the crown under the bell's centre. The rail
// spirals up through the strands and finishes on a straight 45° approach to the
// crown; the coda dollies straight back down that line to the vista the attract
// screen starts on, so the level opens and closes on the same wide shot.

export {
  BELL_TIME,
  CROWN_TIME,
  DEADLINE_TIME,
  DIVE_TIME,
  FOREST_TIME,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  bar,
} from './timing';

export const STRANDLINE_PLAYER_HEALTH = 3;

// ---- the animal ------------------------------------------------------------------

export {
  APPROACH_DIR,
  APPROACH_RIGHT,
  APPROACH_UP,
  BELL_CENTER,
  BELL_CUT_ANGLE,
  BELL_RADIUS,
  BELL_RIM_RADIUS,
  BELL_RIM_Y,
  BELL_TOP_Y,
  BELL_Y_SCALE,
  CROWN,
  CROWN_RADIUS,
  PARENT_POSITION,
  VISTA,
  VISTA_DISTANCE,
  WORLD_SCALE,
  approachPoint,
} from './world';

const S = WORLD_SCALE;

// ---- the rail ------------------------------------------------------------------------

// Cylindrical keyframes around the animal's axis: (azimuth°, radius, height) in
// design units. The rail spirals in and up through the strands, swings wide,
// charges straight at the bell, dives back under it, wanders the oral arms,
// then climbs the approach line. The last three points are collinear along
// APPROACH_DIR so the coda can dolly back along the final look direction.
const c = (azimuth: number, radius: number, y: number) => cylindricalPoint(azimuth, radius, y);

const RAIL_POINTS: Vector3[] = [
  VISTA.clone(), // (120°, r≈241, y≈-126): the wide shot, looking along the approach line
  approachPoint(236 * S),
  c(123, 208, -114),
  c(129, 182, -110),
  c(139, 156, -108),
  c(153, 132, -107),
  c(171, 112, -106),
  c(193, 96, -105), // through the curtain of strand tips
  c(217, 86, -104),
  c(241, 84, -102),
  c(264, 92, -100),
  c(284, 108, -98), // swing wide
  c(298, 130, -94),
  c(310, 152, -90),
  c(321, 168, -84),
  c(332, 166, -76), // apex: the arc turns to face the bell
  c(340, 148, -68),
  c(342, 122, -60), // the charge: the bell fills the view
  c(340, 98, -54),
  c(346, 86, -60), // dive back in under the rim
  c(0, 78, -70),
  c(14, 74, -82),
  c(30, 74, -96),
  c(52, 84, -104), // wandering the outer strands
  c(74, 92, -106),
  c(94, 92, -92),
  c(108, 84, -80),
  c(116, 74, -68),
  c(119, 67, -60),
  approachPoint(64 * S), // the approach line: straight into the crown
  approachPoint(44 * S),
  approachPoint(30 * S),
];

export function createStrandlineRail() {
  return new CatmullRomCurve3(RAIL_POINTS.map((point) => point.clone()), false, 'centripetal');
}

// ---- speed profile → rail easing ------------------------------------------------------

// Slow drift in, quicker through the forest, a surge into the swing-wide, a
// slow stare at the bell, a fast dive, then the rail all but stops at the crown.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.6],
  [bar(1.5), 0.8],
  [bar(4), 1.0],
  [bar(7), 1.1],
  [bar(7.7), 1.3],
  [bar(8.5), 1.2],
  [bar(9.2), 0.85],
  [bar(10), 0.75],
  [bar(10.7), 0.75],
  [bar(11.5), 1.15],
  [bar(13.8), 1.15],
  [bar(14.6), 0.9],
  [bar(15.4), 0.55],
  [bar(15.9), 0.22],
  [bar(16.2), 0.035],
  [bar(24), 0.035],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

// Clamped just short of 1 so the runner's look-ahead never collapses onto the
// camera position on the final frame.
export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION) {
  return Math.min(0.9995, speedProfile.runProgress(time, duration));
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => strandlineRunProgress(time);

// ---- spawn data -------------------------------------------------------------------------

export type StrandlineEnemyKind =
  | 'tick'
  | 'darter'
  | 'spinner'
  | 'sac'
  | 'spore'
  | 'parent'
  | 'broodling';

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in enemyState bags; the boss keeps its own.
export type StrandlineSpawnData =
  | { role: 'tick'; lead: number; x: number; y: number; detachAt: number; drift: number }
  | { role: 'darter'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'spinner'; lead: number; x: number; y: number; radius: number; phase: number; fireAt: number }
  | { role: 'sac'; lead: number; x: number; y: number }
  // Spores use the engine's hostile-projectile role name so they win lock priority.
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'parent' }
  | { role: 'broodling'; brood: number; slot: number };

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

// ---- spawn timeline ----------------------------------------------------------------------

const TICK_LEAD = 3.1;
const DARTER_LEAD = 3.0;
const SPINNER_LEAD = 3.7;
const SAC_LEAD = 3.9;
// A detached tick never swims behind the player: it holds this far ahead of the camera.
const TICK_HOLD_AHEAD = 11;

// Ticks latch on a strand at (x, y) and let go on a beat to defend the colony.
const ticks = (time: number, latches: Array<[number, number]>, detach = 1.25): StrandlineSpawnEntry[] =>
  latches.map(([x, y], index) => ({
    time: time + index * 0.08,
    kind: 'tick',
    data: { role: 'tick', lead: TICK_LEAD, x, y, detachAt: detach + index * 0.3125, drift: x >= 0 ? -1 : 1 },
  }));

const darters = (
  time: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): StrandlineSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.07,
    kind: 'darter',
    data: {
      role: 'darter',
      lead: DARTER_LEAD,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.3125,
      crossTime: run.crossTime ?? 2.6,
    },
  }));

const spinners = (time: number, posts: Array<[number, number]>): StrandlineSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.2,
    kind: 'spinner',
    data: { role: 'spinner', lead: SPINNER_LEAD, x, y, radius: 3.2, phase: index * 2.1 + time, fireAt: 1.6 + index * 0.4 },
  }));

const sacs = (time: number, latches: Array<[number, number]>): StrandlineSpawnEntry[] =>
  latches.map(([x, y], index) => ({
    time: time + index * 0.3,
    kind: 'sac',
    hitStages: [2, 1],
    data: { role: 'sac', lead: SAC_LEAD, x, y },
  }));

function buildTimeline(parentEntries: StrandlineSpawnEntry[]): StrandlineSpawnEntry[] {
  return [
    // --- Drift: the first ticks, wide, letting go one per beat.
    ...ticks(bar(1), [[-22, 6], [18, -8], [4, 14]], 1.25),
    ...darters(bar(2.5), [
      { fromX: -30, toX: 30, y: 2, arc: 4 },
      { fromX: 30, toX: -30, y: 10, arc: -3 },
    ]),
    ...ticks(bar(3.25), [[24, 4], [-14, -11], [-26, 12]], 1.25),

    // --- Forest: the pulse arrives; the sweep widens.
    ...darters(bar(4), [
      { fromX: -30, toX: 30, y: -8, arc: 5, delay: 0 },
      { fromX: 30, toX: -30, y: 4, arc: -4, delay: 0.3 },
      { fromX: -30, toX: 30, y: 13, arc: 2, delay: 0.6 },
    ]),
    ...ticks(bar(4.75), [[12, 12], [-20, -6]], 1.0),
    ...sacs(bar(5.5), [[-24, 8]]),
    ...ticks(bar(5.75), [[22, -10], [8, -3]], 1.25),
    ...spinners(bar(6.4), [[-16, 10], [20, -4]]),
    ...ticks(bar(7), [[-6, 14], [26, 8], [-26, -9]], 1.0),
    ...darters(bar(7.25), [
      { fromX: 30, toX: -30, y: -3, arc: 4, delay: 0 },
      { fromX: -30, toX: 30, y: 8, arc: -3, delay: 0.4 },
    ]),

    // --- Bell: the swing-wide. A curtain of darters across the bell's face.
    ...darters(bar(8.4), [
      { fromX: -32, toX: 32, y: -10, arc: 6, delay: 0, crossTime: 2.9 },
      { fromX: 32, toX: -32, y: -2, arc: 4, delay: 0.31, crossTime: 2.9 },
      { fromX: -32, toX: 32, y: 6, arc: 3, delay: 0.62, crossTime: 2.9 },
      { fromX: 32, toX: -32, y: 14, arc: 1.5, delay: 0.94, crossTime: 2.9 },
      { fromX: -32, toX: 32, y: 11, arc: -4, delay: 1.25, crossTime: 2.9 },
      { fromX: 32, toX: -32, y: -12, arc: -2, delay: 1.56, crossTime: 2.9 },
    ]),
    ...spinners(bar(9.1), [[-24, 2], [24, 9]]),

    // --- Dive: back under the bell. The forest is dense here.
    ...ticks(bar(10.25), [[-24, -10], [22, 12], [-8, 3], [14, -14]], 1.0),
    ...sacs(bar(10.9), [[18, 6], [-22, -4]]),
    ...spinners(bar(11.5), [[-14, 12], [10, -10], [26, 4]]),
    ...darters(bar(11.75), [
      { fromX: -30, toX: 30, y: 0, arc: 6, delay: 0 },
      { fromX: 30, toX: -30, y: 12, arc: -3, delay: 0.31 },
      { fromX: -30, toX: 30, y: -12, arc: 3, delay: 0.62 },
    ]),
    ...ticks(bar(12.5), [[26, -2], [-18, 13], [6, -12]], 1.0),
    ...sacs(bar(12.9), [[-26, 10]]),
    ...darters(bar(13.5), [
      { fromX: 32, toX: -32, y: -9, arc: 5, delay: 0, crossTime: 2.3 },
      { fromX: -32, toX: 32, y: -1, arc: 4, delay: 0.25, crossTime: 2.3 },
      { fromX: 32, toX: -32, y: 7, arc: -3, delay: 0.5, crossTime: 2.3 },
      { fromX: -32, toX: 32, y: 14, arc: -2, delay: 0.75, crossTime: 2.3 },
      { fromX: 32, toX: -32, y: -14, arc: 2, delay: 1.0, crossTime: 2.3 },
    ]),
    ...spinners(bar(14.4), [[-22, -6], [20, 10]]),
    ...ticks(bar(14.6), [[-10, 14], [12, 2], [28, -10]], 0.9),

    // (bar 15.5–16: the crown reveal. Nothing spawns; the riser owns it.)

    // --- Crown: the Parent, its webs, and the broods it pumps out.
    ...parentEntries,

    // (bars 22–24: the coda. Nothing spawns; the pull-back is the payoff.)
  ];
}

export function createStrandlineTimeline() {
  const parent = createParentEntries(CROWN_TIME);
  return {
    parentEntry: parent.parentEntry,
    timeline: buildTimeline(parent.timeline).sort((a, b) => a.time - b.time),
  };
}

/** The static timeline as authored, for the spawn-trace tool; the gameplay factory builds its own copy. */
export const STRANDLINE_SPAWN_TIMELINE: StrandlineSpawnEntry[] = createStrandlineTimeline().timeline;

/** World-space latch points of every strand-borne parasite (ticks, sacs, spinners), for the environment's host strands. */
export function strandLatchPoints(curve: CatmullRomCurve3, timeline: StrandlineSpawnEntry[]) {
  const points: Array<{ position: Vector3; kind: StrandlineEnemyKind }> = [];
  for (const entry of timeline) {
    const data = entry.data;
    if (data.role !== 'tick' && data.role !== 'sac' && data.role !== 'spinner') continue;
    const anchorU = strandlineRunProgress(Math.min(STRANDLINE_DURATION, entry.time + data.lead));
    points.push({ position: offsetFromRail(curve, anchorU, new Vector3(data.x, data.y, 0)), kind: entry.kind });
  }
  return points;
}

const KILL_SCORE: Record<StrandlineEnemyKind, number> = {
  tick: 100,
  darter: 120,
  spinner: 160,
  sac: 220,
  spore: 40,
  broodling: 150,
  parent: 2400,
};

const SPORE_MAX_AGE = 11;
const SPINNER_FIRE_PERIOD = 2.8;

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  const { timeline, parentEntry } = createStrandlineTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let sporesShot = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    sporesShot = 0;
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

  function spitSpore(context: StrandlineUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'spore',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const parent = createParent(bus, { parentEntry, spitSpore });

  // ---- movement -----------------------------------------------------------------

  function behindCamera(context: StrandlineUpdate, margin = 2.5) {
    return shotBehindCamera(context.camera, context.enemy.mesh.position, margin);
  }

  // Overtaken: `lead` seconds after spawn the camera reaches the anchor. Measured
  // in time rather than rail progress so targets near the crown hold, where the
  // rail all but stops, still leave on schedule.
  function passed(context: StrandlineUpdate, lead: number, grace = 0.35) {
    return context.runTime > context.enemy.entry.time + lead + grace;
  }

  function updateTick(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'tick' }>) {
    const { enemy, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (passed(context, data.lead)) return true;
    const held = age < data.detachAt;
    let x = data.x;
    let y = data.y;
    let z = 0;
    if (held) {
      // Clamped to the strand: a tremor, nothing more.
      x += Math.sin(age * 23 + enemy.id) * 0.06;
    } else {
      // Let go: kick off the strand, swim inward and toward the camera with a
      // jellied pulse, so it grows on screen while it closes.
      const t = age - data.detachAt;
      const kick = 1 - Math.exp(-t * 3.2);
      x = data.x + data.drift * kick * 5 + Math.sin(t * 2.6 + enemy.id) * 1.2;
      y = data.y * (1 - 0.35 * Math.min(1, t / 2.4)) + Math.sin(t * 3.1 + enemy.id * 0.7) * 0.9;
      z = -t * 4.5;
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, z)));
    if (!held) {
      // Swims at the player but stops short: it defends the colony from in front.
      const forward = camera.getWorldDirection(new Vector3());
      const ahead = enemy.mesh.position.clone().sub(camera.position).dot(forward);
      if (ahead < TICK_HOLD_AHEAD) enemy.mesh.position.addScaledVector(forward, TICK_HOLD_AHEAD - ahead);
    }
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(held ? Math.sin(age * 1.3 + enemy.id) * 0.2 : (age - data.detachAt) * 1.4 * data.drift);
    enemy.mesh.userData.latched = held;
    enemy.mesh.userData.swim = held ? 0 : Math.min(1, (age - data.detachAt) * 2);
    return behindCamera(context);
  }

  function updateDarter(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'darter' }>) {
    const { enemy, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12 || passed(context, data.lead)) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    // Sinuous crossing: the authored arc plus a body-wave, closing on the camera.
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 7 + enemy.id) * 0.35;
    const z = MathUtils.lerp(8, -4, clamped);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, z)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.04)),
      data.y + Math.sin(Math.min(1, clamped + 0.04) * Math.PI) * data.arc,
      z - 0.6,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * (0.35 + Math.sin(clamped * Math.PI) * 0.4));
    enemy.mesh.userData.wave = age * 9;
    return behindCamera(context);
  }

  function updateSpinner(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'spinner' }>) {
    const { enemy, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (passed(context, data.lead)) return true;
    const state = context.enemyState(() => ({ fireAt: data.fireAt }));
    // Corkscrews down its strand toward the camera.
    const angle = data.phase + age * 3.4;
    const x = data.x + Math.cos(angle) * data.radius;
    const y = data.y + Math.sin(angle) * data.radius * 0.8;
    const z = 5 - age * 2.4;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, z)));
    enemy.mesh.quaternion.copy(context.camera.quaternion);
    enemy.mesh.rotateZ(-angle);
    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.7 ? 1 - untilShot / 0.7 : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + SPINNER_FIRE_PERIOD;
      spitSpore(context, enemy.mesh.position);
    }
    return behindCamera(context);
  }

  function updateSac(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'sac' }>) {
    const { enemy, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (passed(context, data.lead)) return true;
    const state = context.enemyState(() => ({ burst: false }));
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x, data.y, 0)));
    enemy.mesh.quaternion.copy(context.camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.9 + enemy.id) * 0.12);
    enemy.mesh.userData.bare = enemy.hitStageIndex > 0;
    // The membrane bursting spits the sac's spore at the player.
    if (enemy.hitStageIndex > 0 && !state.burst) {
      state.burst = true;
      spitSpore(context, enemy.mesh.position);
    }
    return behindCamera(context);
  }

  function updateSpore(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'bolt' }>) {
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
      enemy.mesh.rotateZ(age * 6);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6.5,
      maxSpeed: 14,
      accel: 3,
      turnRate: 2.4,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    enemy.mesh.rotateZ(age * 5);
    return age > SPORE_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition -------------------------------------------------------------

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    // The webbing stops the shot: volleys at the Parent are denied until it is
    // bare (and steady), while the rest of the volley still fires.
    validateRelease(enemies) {
      const atParent = enemies.filter((enemy) => enemy.kind === 'parent');
      if (atParent.length === 0 || parent.parentTargetable()) return true;
      bus.emit('shielded', {
        shields: atParent.map((enemy) => ({ enemyId: enemy.id, worldPosition: enemy.mesh.position.clone() })),
        blockedEnemyIds: atParent.map((enemy) => enemy.id),
      });
      return enemies.filter((enemy) => enemy.kind !== 'parent');
    },
    timing: {
      // A slow tempo: cap the volley grid at a beat so a six-lock release still
      // performs its run inside a couple of seconds.
      shotDelay: { maxGridSeconds: 0.7 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'tick':
          return updateTick(context, data);
        case 'darter':
          return updateDarter(context, data);
        case 'spinner':
          return updateSpinner(context, data);
        case 'sac':
          return updateSac(context, data);
        case 'bolt':
          return updateSpore(context, data);
        case 'parent':
          return parent.updateParent(context, data);
        case 'broodling':
          return parent.updateBroodling(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'spore') sporesShot += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Tearing membrane (sac skins, the Parent's grip) pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length === 5 ? 300 : 160;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (parent.parentKilled() && score >= 11000 && clearRate >= 0.92) return 'S';
      if (score >= 8200 && clearRate >= 0.7) return 'A';
      if (score >= 4800 && clearRate >= 0.45) return 'B';
      if (score >= 2000 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${STRANDLINE_PLAYER_HEALTH}`];
      if (sporesShot > 0) lines.push(`${sporesShot} spore${sporesShot === 1 ? '' : 's'} shot down`);
      const broodLine = parent.broodSummaryLine();
      if (broodLine) lines.push(broodLine);
      const bossLine = parent.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
