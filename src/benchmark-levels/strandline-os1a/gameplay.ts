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
import { createCrown, type CrownController } from './crown';
import { STRANDLINE_BPM, STRANDLINE_DURATION, bar } from './timing';

// STRANDLINE — sixty seconds inside the trailing tentacles of an animal the
// size of a weather system, cutting an infestation off it.
//
//   Strands   (bars 0–6)   Sunlit green water, a forest of glowing strands.
//                          The first parasites are latched on and waiting.
//   Openwater (bars 6–8)   The rail banks clear of the skirt. For five seconds
//                          the bell is just there — a green moon over the frame.
//   Thicket   (bars 8–14)  Back in, tighter and faster. Spitters wake up.
//   Rise      (bars 14–16) A second, higher swing. The animal is much closer now
//                          and you can see where the strands root.
//   Crown     (bars 16–22) The parent, dug into the crown behind its own webbing.
//                          It pumps broods; each brood killed starves a panel.
//   Adrift    (bars 22–24) The camera lets go, and keeps letting go.

export {
  ADRIFT_TIME,
  CROWN_TIME,
  OPEN_TIME,
  RISE_TIME,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  THICKET_TIME,
  bar,
} from './timing';

export const STRANDLINE_PLAYER_HEALTH = 3;

// ---- the animal --------------------------------------------------------------

// The animal is authored so the frame works from three places at once: from
// deep in the skirt (the bell is a distant green moon), from directly under the
// crown (it fills everything above the sightline), and from far back at the end
// (the whole silhouette fits, tentacles included).
/** Where the strands root into the bell. The parent is dug in here. */
export const CROWN_CENTER = new Vector3(0, 96, -640);
/** The bell hangs just above the crown, flattened the way a real bell is. */
export const BELL_CENTER = new Vector3(0, 160, -690);
export const BELL_RADIUS = 250;
export const BELL_FLATTEN = 0.6;

// ---- speed profile → rail easing ----------------------------------------------

// Underwater pacing: heavy and slow on entry, quickest through the thicket,
// then a long deceleration into the crown so the parent visibly grows. The
// last two bars nearly stop — the level hands its motion over to the camera.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.55],
  [bar(2), 0.80],
  [bar(5.6), 0.95],
  [bar(6.6), 1.15],
  [bar(8.0), 1.30],
  [bar(13.2), 1.42],
  [bar(14.6), 1.05],
  [bar(16.0), 0.80],
  [bar(20.5), 0.62],
  [bar(22.0), 0.30],
  [bar(24.0), 0.10],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- rail ---------------------------------------------------------------------

const RAIL_START = new Vector3(0, -40, 90);
const RAIL_END = new Vector3(0, 64, -560);
export const RAIL_LENGTH_ESTIMATE = 690;

// The two lifts are placed by musical bar, not by eye: whatever the speed
// profile does, each bank lands where the arrangement opens up.
const U_OPEN = strandlineRunProgress(bar(6.6));
const U_RISE = strandlineRunProgress(bar(14.7));

/** Smooth 1-at-centre, 0-at-edges bump with zero slope at both edges. */
function bump(u: number, centre: number, halfWidth: number) {
  const k = MathUtils.clamp((u - centre) / halfWidth, -1, 1);
  return Math.cos(k * Math.PI * 0.5) ** 2;
}

function railPoint(u: number, out = new Vector3()) {
  const climb = u * u * (3 - 2 * u);
  // The weave threads between strands; it fades out at both ends so the
  // attract shot and the final drift are both steady.
  const weave = Math.sin(u * Math.PI * 4.2 + 0.7) * 8 * Math.sin(u * Math.PI);
  const open = bump(u, U_OPEN, 0.1);
  const rise = bump(u, U_RISE, 0.095);
  return out.set(
    weave + open * 42 - rise * 49,
    MathUtils.lerp(RAIL_START.y, RAIL_END.y, climb) + open * 5 + rise * 11 + Math.sin(u * Math.PI * 2.6) * 3.5,
    MathUtils.lerp(RAIL_START.z, RAIL_END.z, u),
  );
}

/**
 * The un-banked centreline of the skirt. The rail banks away from this on the
 * two lifts; the strand forest is anchored to it, which is exactly why swinging
 * wide takes you out of the strands instead of dragging them along with you.
 */
export function spineAtZ(z: number, out = new Vector3()) {
  const raw = (RAIL_START.z - z) / (RAIL_START.z - RAIL_END.z);
  const u = MathUtils.clamp(raw, 0, 1);
  const climb = u * u * (3 - 2 * u);
  return out.set(
    Math.sin(u * Math.PI * 4.2 + 0.7) * 8 * Math.sin(u * Math.PI),
    MathUtils.lerp(RAIL_START.y, RAIL_END.y, climb) + Math.sin(u * Math.PI * 2.6) * 3.5,
    z,
  );
}

export function createStrandlineRail() {
  const points: Vector3[] = [];
  const N = 30;
  for (let i = 0; i <= N; i += 1) points.push(railPoint(i / N));
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.4);
}

/** Rail-relative station that holds a roughly constant distance ahead of the camera. */
const STATION_U = 48 / RAIL_LENGTH_ESTIMATE;
export function stationAhead(runProgress: number, extra = 0) {
  return Math.min(0.999, runProgress + STATION_U + extra);
}

// ---- spawn data ----------------------------------------------------------------

export type StrandlineKind = 'cling' | 'larva' | 'spitter' | 'spore' | 'brood' | 'parent';

// Timeline data is immutable (the engine reuses it across runs); anything
// mutable lives in enemyState bags, in the crown controller, or on spores,
// which are always created fresh at runtime.
export type StrandlineData =
  | { role: 'cling'; lead: number; x: number; y: number; detachAt: number; sweep: number; seed: number }
  | { role: 'larva'; lead: number; fromX: number; toX: number; y: number; amp: number; delay: number; crossTime: number; phase: number }
  | { role: 'spitter'; lead: number; x: number; y: number; span: number; seed: number }
  | { role: 'spore'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'brood'; slot: number; x: number; y: number }
  | { role: 'parent' };

export type StrandlineEntry = LockOnSpawnEntry<StrandlineKind, StrandlineData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineKind, StrandlineData>;

// ---- timeline builders ---------------------------------------------------------

type ClingSpec = { x: number; y: number; detach?: number; sweep?: number };

const clings = (time: number, lead: number, specs: ClingSpec[], stagger = 0.12): StrandlineEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * stagger,
    kind: 'cling',
    data: {
      role: 'cling',
      lead,
      x: spec.x,
      y: spec.y,
      detachAt: spec.detach ?? 1.35 + index * 0.11,
      sweep: spec.sweep ?? (spec.x > 0 ? -5 : 5),
      seed: time * 1.7 + index * 2.3,
    },
  }));

type SchoolSpec = { fromX: number; toX: number; y: number; amp?: number; crossTime?: number };

/** A brood school: one crossing, staggered so it reads as a shoal, not a row. */
const school = (time: number, lead: number, specs: SchoolSpec[], stagger = 0.1): StrandlineEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * stagger,
    kind: 'larva',
    data: {
      role: 'larva',
      lead,
      fromX: spec.fromX,
      toX: spec.toX,
      y: spec.y,
      amp: spec.amp ?? 2.4,
      delay: index * 0.17,
      crossTime: spec.crossTime ?? 2.9,
      phase: index * 1.31,
    },
  }));

const spitters = (time: number, lead: number, posts: Array<[number, number, number]>): StrandlineEntry[] =>
  posts.map(([x, y, span], index) => ({
    time: time + index * 0.24,
    kind: 'spitter',
    data: { role: 'spitter', lead, x, y, span, seed: time * 0.9 + index * 2.71 },
  }));

const CLING_LEAD = 3.4;
const SCHOOL_LEAD = 3.2;
const SPITTER_LEAD = 3.7;

function buildTimeline(crownEntries: StrandlineEntry[]): StrandlineEntry[] {
  return [
    // --- Strands. Latched, waiting, sparse. Learn the sweep.
    ...clings(bar(1), CLING_LEAD, [
      { x: -18, y: -7 },
      { x: 17, y: 9 },
    ], 0.3),
    ...clings(bar(2.5), CLING_LEAD, [
      { x: -24, y: 12 },
      { x: -6, y: 3 },
      { x: 15, y: -9 },
    ], 0.22),
    ...school(bar(4), SCHOOL_LEAD, [
      { fromX: -30, toX: 28, y: -12 },
      { fromX: -30, toX: 28, y: -8, amp: 3.2 },
      { fromX: -30, toX: 28, y: -14, amp: 1.8 },
      { fromX: -30, toX: 28, y: -5, amp: 2.8 },
    ]),
    ...clings(bar(5), CLING_LEAD, [
      { x: -25, y: 4 },
      { x: 24, y: -3 },
      { x: 2, y: 14 },
    ], 0.26),

    // --- Openwater. The bank. Two silhouettes against the bell and little else;
    //     the payoff here is the view, not the pressure.
    ...clings(bar(6.6), CLING_LEAD, [
      { x: -22, y: 13, detach: 1.9 },
      { x: 21, y: 11, detach: 1.9 },
    ], 0.5),
    ...school(bar(7.3), SCHOOL_LEAD, [
      { fromX: 26, toX: -26, y: 6, crossTime: 3.3 },
      { fromX: 26, toX: -26, y: 10, crossTime: 3.3, amp: 3.0 },
      { fromX: 26, toX: -26, y: 2, crossTime: 3.3, amp: 1.9 },
    ], 0.14),

    // --- Thicket. Everything tightens.
    ...clings(bar(8.1), CLING_LEAD, [
      { x: -26, y: -10 },
      { x: -14, y: 6 },
      { x: 0, y: 15 },
      { x: 14, y: 5 },
      { x: 26, y: -11 },
    ], 0.13),
    ...spitters(bar(9.1), SPITTER_LEAD, [[-23, 1, 9]]),
    ...school(bar(9.4), SCHOOL_LEAD, [
      { fromX: 29, toX: -29, y: -13 },
      { fromX: 29, toX: -29, y: -9, amp: 3.4 },
      { fromX: 29, toX: -29, y: -16, amp: 2.0 },
      { fromX: 29, toX: -29, y: -4, amp: 2.6 },
    ]),
    // Two full-height columns: forces a vertical sweep, not a horizontal drag.
    ...clings(bar(10.2), CLING_LEAD, [
      { x: -21, y: 16 },
      { x: -19, y: 2 },
      { x: -23, y: -12 },
      { x: 22, y: 15 },
      { x: 20, y: 1 },
      { x: 24, y: -13 },
    ], 0.1),
    ...spitters(bar(11.1), SPITTER_LEAD, [[-25, -6, 8], [25, 8, 7]]),
    ...school(bar(11.5), SCHOOL_LEAD, [
      { fromX: -28, toX: 26, y: 13, crossTime: 2.6 },
      { fromX: -28, toX: 26, y: 9, crossTime: 2.6, amp: 3.0 },
      { fromX: -28, toX: 26, y: 17, crossTime: 2.6, amp: 1.7 },
      { fromX: -28, toX: 26, y: 5, crossTime: 2.6, amp: 2.2 },
    ], 0.09),
    // Bar 12: the arc. Six across the full frame on a downbeat — the level's
    // designed six-lock release.
    ...clings(bar(12), CLING_LEAD, [
      { x: -27, y: 2 },
      { x: -17, y: 12 },
      { x: -6, y: 17 },
      { x: 6, y: 16 },
      { x: 17, y: 11 },
      { x: 27, y: 0 },
    ], 0.085),
    ...school(bar(13), SCHOOL_LEAD, [
      { fromX: -30, toX: 30, y: -15, crossTime: 2.5 },
      { fromX: 30, toX: -30, y: -9, crossTime: 2.5, amp: 3.2 },
      { fromX: -30, toX: 30, y: -3, crossTime: 2.5, amp: 2.4 },
      { fromX: 30, toX: -30, y: -17, crossTime: 2.5, amp: 1.8 },
      { fromX: -30, toX: 30, y: 4, crossTime: 2.5, amp: 2.9 },
    ], 0.08),
    ...spitters(bar(13.4), SPITTER_LEAD, [[3, 15, 6]]),

    // --- Rise. Wide again, higher, and the animal is close enough to read.
    ...clings(bar(14.6), CLING_LEAD, [
      { x: -28, y: 10, detach: 1.8 },
      { x: 0, y: 18, detach: 2.0 },
      { x: 28, y: 8, detach: 1.8 },
    ], 0.4),
    ...school(bar(15.4), SCHOOL_LEAD, [
      { fromX: -24, toX: 24, y: -14, crossTime: 3.0 },
      { fromX: -24, toX: 24, y: -8, crossTime: 3.0, amp: 3.4 },
      { fromX: -24, toX: 24, y: -2, crossTime: 3.0, amp: 2.6 },
      { fromX: -24, toX: 24, y: 5, crossTime: 3.0, amp: 3.0 },
    ], 0.13),

    // --- Crown. The parent and its broods (see crown.ts), plus enough loose
    //     infestation that the boss never fights you alone.
    ...crownEntries,
    ...clings(bar(17.4), CLING_LEAD, [
      { x: -26, y: -8 },
      { x: 25, y: -6 },
      { x: -3, y: -16 },
    ], 0.18),
    ...spitters(bar(19.0), SPITTER_LEAD, [[-24, 10, 7]]),
    ...school(bar(19.2), SCHOOL_LEAD, [
      { fromX: 27, toX: -27, y: -12, crossTime: 2.8 },
      { fromX: 27, toX: -27, y: -6, crossTime: 2.8, amp: 3.0 },
      { fromX: 27, toX: -27, y: -18, crossTime: 2.8, amp: 2.0 },
    ], 0.12),
    ...clings(bar(20.4), CLING_LEAD, [
      { x: -22, y: 5 },
      { x: -8, y: -15 },
      { x: 23, y: 4 },
    ], 0.13),

    // (bars 22–24: the animal drifts on. Nothing spawns. That is the point.)
  ];
}

const KILL_SCORE: Record<StrandlineKind, number> = {
  cling: 120,
  larva: 90,
  spitter: 260,
  spore: 45,
  brood: 760,
  parent: 3600,
};

const SPORE_MAX_AGE = 11;
const MISS_GRACE_U = 0.014;

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineKind, StrandlineData> {
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let sporesShot = 0;

  function spawnSpore(context: StrandlineUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'spore',
      countsTowardTotal: false,
      data: { role: 'spore', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // Broods do not shoot; they breed. Each pulse throws a larva out sideways
  // into the frame, so leaving a brood alive is a rising tax on your attention.
  function spawnBroodLarva(context: StrandlineUpdate, index: number, side: number) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'larva',
      countsTowardTotal: false,
      data: {
        role: 'larva',
        lead: SCHOOL_LEAD,
        fromX: side * 3,
        toX: side * 30,
        y: -13 + ((index * 7.3) % 27),
        amp: 2.6,
        delay: 0,
        crossTime: 2.6,
        phase: index * 1.7,
      },
    });
  }

  const crown: CrownController = createCrown(bus, {
    crownCenter: CROWN_CENTER,
    spawnLarva: spawnBroodLarva,
    stationAhead,
  });

  const timeline = sortTimeline(buildTimeline(crown.entries));

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

  // ---- motion ------------------------------------------------------------------

  const scratch = new Vector3();

  // A cling is the level's grammar in one enemy: it is part of the scenery
  // until it decides not to be. It grips a strand, breathes with the music,
  // then lets go and swims at the centre of the frame.
  function updateCling(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'cling' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + MISS_GRACE_U) return true;

    const breathe = Math.sin(age * 2.1 + data.seed) * 0.35;
    let x = data.x + breathe * 0.4;
    let y = data.y + breathe;
    let z = 0;

    const detachAge = age - data.detachAt;
    if (detachAge > 0) {
      // Release. It kicks off the strand and closes on the centreline.
      const k = MathUtils.clamp(detachAge / 1.25, 0, 1);
      const eased = 1 - (1 - k) ** 2.2;
      x = MathUtils.lerp(x, data.x * 0.28 + data.sweep, eased);
      y = MathUtils.lerp(y, data.y * 0.3, eased);
      z = -7.5 * eased;
      enemy.mesh.userData.detached = true;
      enemy.mesh.userData.detachProgress = k;
      enemy.mesh.userData.tension = 0;
    } else {
      enemy.mesh.userData.detached = false;
      enemy.mesh.userData.detachProgress = 0;
      // Telegraph: it shivers for the last half second before letting go.
      enemy.mesh.userData.tension = MathUtils.clamp(1 + detachAge / 0.5, 0, 1);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(x, y, z)));
    if (detachAge > 0) {
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(detachAge * 2.4 + data.seed);
      enemy.mesh.rotateX(Math.sin(detachAge * 5 + data.seed) * 0.3);
    } else {
      // Latched: it faces out from the strand it is riding.
      enemy.mesh.lookAt(offsetFromRail(curve, anchorU, scratch.set(x * 2.2, y * 2.2, 0)));
      enemy.mesh.rotateZ(Math.sin(age * 1.4 + data.seed) * 0.25);
    }
    return false;
  }

  // Larvae are the loose brood: they never stop, they cross, they undulate.
  function updateLarva(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'larva' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.2 || runProgress > anchorU + MISS_GRACE_U) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI * 2 + data.phase) * data.amp + Math.sin(age * 7 + data.phase) * 0.35;
    const z = Math.sin(clamped * Math.PI * 3 + data.phase) * 3.5;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(x, y, z)));

    const ahead = offsetFromRail(curve, anchorU, scratch.set(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.04)),
      data.y + Math.sin(Math.min(1, clamped + 0.04) * Math.PI * 2 + data.phase) * data.amp,
      z,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.userData.swim = age;
    return false;
  }

  // Spitters do not cross and do not let go: they creep up and down one strand
  // and spit. They are the only ordinary thing in the level that shoots back.
  function updateSpitter(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'spitter' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + MISS_GRACE_U) return true;

    const state = context.enemyState(() => ({ fireAt: 1.15 + (data.seed % 0.7) }));
    const crawl = Math.sin(age * 0.72 + data.seed);
    const x = data.x + Math.cos(age * 0.5 + data.seed) * 1.4;
    const y = data.y + crawl * data.span;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(x, y, 0)));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 0.9 + data.seed) * 0.2);
    enemy.mesh.userData.crawl = crawl;

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.9 ? MathUtils.clamp(1 - untilShot / 0.9, 0, 1) : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 2.5;
      spawnSpore(context, enemy.mesh.position);
    }
    return false;
  }

  function updateSpore(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'spore' }>) {
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
      // Spitters sit wide, so a spore has real lateral distance to close in a
      // short flight. A slightly wider catch radius keeps a spore you ignored
      // from sailing past on geometry alone.
      config: { hitDistance: 3.2 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 7);
      enemy.mesh.userData.imminent = true;
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Spores must out-run the rail, not merely drift toward it: the camera
    // covers up to ~16 units a second, so anything slower is simply overtaken
    // and the hull is never in danger.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 8,
      maxSpeed: 21,
      accel: 5,
      turnRate: 4.2,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(scratch.copy(data.position).add(data.velocity));
    return age > SPORE_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition -----------------------------------------------------------

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    startWord: 'SWIM',
    replayWord: 'AGAIN',
    // A slow, close level: the engine's default grid ramp is tuned for faster
    // levels and spreads a six-shot volley too thin here. Tighten the coarsest
    // grid so a full release still lands as one gesture.
    timing: {
      shotDelay: { maxGridSeconds: 0.16 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'cling':
          return updateCling(context, data);
        case 'larva':
          return updateLarva(context, data);
        case 'spitter':
          return updateSpitter(context, data);
        case 'spore':
          return updateSpore(context, data);
        case 'brood':
          return crown.updateBrood(context, data);
        case 'parent':
          return crown.updateParent(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'spore') sporesShot += 1;
      // Volleys pay: freeing six strands at once is worth more than six ones.
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 55,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 640 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (crown.parentKilled() && score >= 16000 && clearRate >= 0.9) return 'S';
      if (crown.parentKilled() && score >= 11000 && clearRate >= 0.66) return 'A';
      if (score >= 6200 && clearRate >= 0.42) return 'B';
      if (score >= 2500 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${STRANDLINE_PLAYER_HEALTH}`, crown.summaryLine()];
      if (sporesShot > 0) lines.push(`${sporesShot} spore${sporesShot === 1 ? '' : 's'} shot down`);
      return lines;
    },
  };
}
