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
import { mulberry32 } from '../../engine/rng';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  CROWN_X,
  CROWN_Y,
  CROWN_Z,
  STRANDLINE_SK9Q_BARS,
  STRANDLINE_SK9Q_BPM,
  STRANDLINE_SK9Q_DURATION,
  STRANDLINE_SK9Q_MARKERS,
  STRANDLINE_SK9Q_PLAYER_HEALTH,
  bar,
} from './timing';

// STRANDLINE — a 60-second flight through the trailing tentacles of a gigantic
// jellyfish, cleaning the parasites off it. 28 bars at 112 BPM (bar = 60/112·4
// s ≈ 2.143 s) is exactly 60.00 s:
//
//   drift    (0–4)   Slow pulse in sunlit water. Latched parasites only.
//   strandwood(4–8)  The forest thickens; skitters dash between the strands.
//   greenmoon(8–12)  The rail swings wide: the bell hangs in view like a green
//                    moon. Spitters and the first armored husk.
//   souring   (12–16) Deeper, denser, more violet. Mixed pressure waves.
//   crown     (16–19) Second wide swing; the crown and webbing grow ahead.
//   parent    (19–26) The parent organism pumps out broods behind its webbing.
//                    Kill a brood → the web it fed dies back → the parent is
//                    bare for a stage. Tear all three stages off before the
//                    deadline or it burrows and the colony remains.
//   release   (26–28) Serene coda: the rail falls back, every strand clean.
//
// The rail climbs gently forward (-Z) and up (+Y) through the strand forest,
// with two authored wide swings (u≈0.3 and u≈0.58) that pan the view across
// the bell. A speed profile drives the rail easing so the reveals surge and
// the coda genuinely decelerates.

export type StrandlineEnemyKind = 'latcher' | 'skitter' | 'husk' | 'spitter' | 'spore' | 'broodling' | 'parent';

// Timeline data is immutable — the runner reuses the timeline across runs.
// Per-enemy runtime state lives in the runner's enemyState bags, boss/run state
// lives in the closure of createStrandlineGameplay, and dynamically spawned
// spores/broodlings get fresh data objects each launch.
export type StrandlineSpawnData =
  | { role: 'latcher'; lead: number; baseX: number; baseY: number; phase: number; aggro: boolean }
  | { role: 'skitter'; lead: number; startX: number; y: number; dir: number; seed: number }
  | { role: 'husk'; lead: number; baseX: number; baseY: number; spin: number; phase: number }
  | { role: 'spitter'; lead: number; baseX: number; baseY: number; firstFire: number; period: number }
  | { role: 'spore'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'broodling'; radius: number; angSpeed: number; phase: number; tilt: number; bob: number; seed: number; firstSpit: number; spitPeriod: number }
  | { role: 'parent' };

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

// ---- speed profile → rail easing ------------------------------------------

// Piecewise-linear felt swim speed over run time. 1.0 ≈ cruise (~8.3 u/s).
// Slow drift in, surges through both wide-swing reveals, steady through the
// boss, then a long decel into the coda so the camera visibly falls back.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.66],
  [bar(3), 0.9],
  [bar(6), 1.0],
  [bar(8), 1.18],
  [bar(10), 1.1],
  [bar(14), 1.04],
  [bar(16), 1.16],
  [bar(18), 1.08],
  [bar(20), 0.98],
  [bar(24), 0.94],
  [bar(26), 0.72],
  [bar(27), 0.45],
  [bar(28), 0.3],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_SK9Q_DURATION);

export const strandlineSpeedAt = speedProfile.speedAt;

export function strandlineRunProgress(time: number, duration = STRANDLINE_SK9Q_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- rail ------------------------------------------------------------------

// Authored rail through the strands: mostly -Z with a gentle +Y climb. Two
// pronounced lateral swings bank the camera around the forest; the climb
// steepens a touch through each so the look-ahead axis lifts across the bell.
const RAIL_POINTS: Array<[number, number, number]> = [
  [0, 0, 0],
  [-7, 1.8, -35],
  [6, 4, -70],
  [12, 7, -105],
  [-2, 11, -140],
  [-14, 13.5, -175],
  [-4, 15.5, -210],
  [9, 17.5, -245],
  [14, 20.5, -280],
  [0, 23, -315],
  [-11, 24.5, -350],
  [-3, 26, -385],
  [8, 27, -420],
  [3, 28, -450],
  [0, 29.5, -475],
  // The final approach tilts up toward the crown so the bell holds the frame
  // through the boss and the pull-back coda.
  [4, 31.5, -500],
];

export function createStrandlineRail() {
  return new CatmullRomCurve3(
    RAIL_POINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'catmullrom',
    0.5,
  );
}

// ---- the parent anchor -------------------------------------------------------

// Where the parent hangs: dug in just below and ahead of the crown. The slow
// breathing sway is shared by the boss mesh, its broodlings' orbit center, and
// the webbing, so the whole colony moves as one organism.
export function parentAnchorAt(runTime: number, out = new Vector3()) {
  return out.set(
    CROWN_X + Math.sin(runTime * 0.5) * 0.9,
    CROWN_Y - 4.2 + Math.sin(runTime * 0.72) * 0.7,
    CROWN_Z + 10 + Math.sin(runTime * 0.4) * 0.6,
  );
}

// ---- spawn timeline --------------------------------------------------------

const LATCHER_LEAD = 4.6;
const SKITTER_LEAD = 4.9;
const HUSK_LEAD = 5.4;
const SPITTER_LEAD = 6.2;
const PASS_EPS = 0.014;

// Latchers are fodder that clings to the strands. Center-lane ones turn AGGRO:
// they detach and strike as you close in. Wide ones stay clamped — still worth
// points, never hull damage. The split keeps the threat legible.
const latchers = (
  time: number,
  offsets: Array<[number, number]>,
  lead = LATCHER_LEAD,
  aggroAll = true,
): StrandlineSpawnEntry[] =>
  offsets.map(([x, y], index) => ({
    time: time + index * 0.15,
    kind: 'latcher',
    data: {
      role: 'latcher',
      lead,
      baseX: x,
      baseY: y,
      phase: index * 1.9 + x * 0.31,
      aggro: aggroAll && Math.abs(x) <= 5.5 && Math.abs(y) <= 5,
    },
  }));

const skitters = (
  time: number,
  runs: Array<{ x: number; y: number; dir: number }>,
  lead = SKITTER_LEAD,
): StrandlineSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.22,
    kind: 'skitter',
    data: { role: 'skitter', lead, startX: run.x, y: run.y, dir: run.dir, seed: time * 2.3 + index * 5.1 },
  }));

const husks = (
  time: number,
  specs: Array<{ x: number; y: number }>,
  lead = HUSK_LEAD,
): StrandlineSpawnEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * 0.4,
    kind: 'husk',
    hitStages: [2, 1],
    data: { role: 'husk', lead, baseX: spec.x, baseY: spec.y, spin: index % 2 === 0 ? 1 : -1, phase: index * 2.4 },
  }));

const spitters = (
  time: number,
  specs: Array<{ x: number; y: number; firstFire?: number; period?: number }>,
  lead = SPITTER_LEAD,
): StrandlineSpawnEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * 0.5,
    kind: 'spitter',
    data: {
      role: 'spitter',
      lead,
      baseX: spec.x,
      baseY: spec.y,
      firstFire: spec.firstFire ?? 2.1,
      period: spec.period ?? 2.7,
    },
  }));

function buildStrandlineTimeline(parentEntry: StrandlineSpawnEntry): StrandlineSpawnEntry[] {
  return [
    // --- drift: sparse latched parasites on the strands ahead, wide and calm.
    //     Nothing strikes in the tutorial bars; the water just teaches the sweep.
    ...latchers(bar(1), [[-9, 2], [0, 5], [9, 2]], LATCHER_LEAD, false),
    ...latchers(bar(2.5), [[-12, -1], [-5, 6], [5, 6], [12, -1]], LATCHER_LEAD, false),
    ...latchers(bar(3.6), [[-7, 4], [0, -3], [7, 4]], LATCHER_LEAD, false),

    // --- strandwood: skitters arrive, dashing across the frame between strands.
    ...skitters(bar(4.5), [{ x: -12, y: 3, dir: 1 }, { x: 12, y: -2, dir: -1 }]),
    ...latchers(bar(5.5), [[-13, 5], [-6, -2], [0, 7], [6, -2], [13, 5]]),
    ...skitters(bar(6.6), [{ x: -14, y: 6, dir: 1 }, { x: 0, y: -3, dir: -1 }, { x: 14, y: 2, dir: 1 }]),
    // A full six-lock fan to close the section — the first big volley moment.
    ...latchers(bar(7.5), [[-13, -2], [-8, 6], [-3, 1], [3, 4], [8, -2], [13, 6]]),

    // --- greenmoon: the wide swing. Light screen for the reveal, then the
    //     first spitter (its spores are the first incoming damage) and husk.
    ...latchers(bar(8.4), [[-10, 6], [2, -3], [10, 4]]),
    ...spitters(bar(9.6), [{ x: 11, y: 5 }]),
    ...latchers(bar(9.7), [[-11, 3], [-4, -2]]),
    ...husks(bar(10.6), [{ x: -2, y: 4 }]),
    ...latchers(bar(10.8), [[-12, 0], [6, 7], [12, -1]]),
    ...skitters(bar(11.6), [{ x: -14, y: -2, dir: 1 }, { x: -14, y: 7, dir: 1 }, { x: 14, y: 1, dir: -1 }, { x: 14, y: -4, dir: -1 }]),

    // --- souring: deeper water. Denser mixed waves; husks soak locks while
    //     spitters pressure the hull from the sides.
    ...husks(bar(12.4), [{ x: -8, y: 3 }]),
    ...spitters(bar(12.6), [{ x: 10, y: 6 }]),
    ...latchers(bar(13.4), [[-13, 2], [-6, 7], [0, -3], [6, 7], [13, 2]]),
    ...skitters(bar(14.4), [{ x: -14, y: 5, dir: 1 }, { x: 14, y: -2, dir: -1 }, { x: -14, y: -4, dir: 1 }]),
    ...spitters(bar(14.6), [{ x: -9, y: 7 }]),
    ...husks(bar(15.4), [{ x: 7, y: 5 }]),
    ...latchers(bar(15.6), [[-12, 4], [-2, -3], [12, 1]]),

    // --- crown: the second wide swing. The webbing is visible ahead; waves
    //     thin out so the frame is clear for the boss entrance.
    ...latchers(bar(16.4), [[-13, 5], [-5, -2], [5, -2], [13, 5]]),
    ...skitters(bar(17.3), [{ x: -14, y: 2, dir: 1 }, { x: 14, y: 6, dir: -1 }, { x: -14, y: -3, dir: 1 }, { x: 14, y: 0, dir: -1 }]),
    ...husks(bar(18.2), [{ x: -4, y: 6 }]),
    ...spitters(bar(18.3), [{ x: 12, y: 3 }]),
    ...latchers(bar(18.4), [[-12, 0], [4, -3]]),

    // --- parent: the organism arrives at the crown. Broods are spawned by the
    //     boss director at runtime (see createStrandlineGameplay).
    parentEntry,
  ];
}

const KILL_SCORE: Record<StrandlineEnemyKind, number> = {
  latcher: 100,
  skitter: 120,
  husk: 220,
  spitter: 150,
  spore: 40,
  broodling: 90,
  parent: 2000,
};

const SPORE_MAX_AGE = 10;
const BROODLING_LEAD = 6.0;
const BROODLING_CENTER_X = 4;
const BROODLING_CENTER_Y = 6;
const BROOD_COUNTS = [3, 4, 5];
const BROOD_FIRST_BAR_TIMES = [0, bar(STRANDLINE_SK9Q_BARS.parent) + 0.6, bar(STRANDLINE_SK9Q_BARS.brood2), bar(STRANDLINE_SK9Q_BARS.brood3)];
const BROOD_RESPAWN_CAP = 13;

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  const parentEntry: StrandlineSpawnEntry = {
    time: bar(STRANDLINE_SK9Q_BARS.parent),
    kind: 'parent',
    hitStages: [2, 3, 4],
    // Always lockable: the web blocks the SHOT, not the lock. validateRelease
    // filters the parent out of volleys while its stage's web still lives.
    lockable: true,
    data: { role: 'parent' },
  };
  const timeline = buildStrandlineTimeline(parentEntry).sort((a, b) => a.time - b.time);

  // ---- run state (reset on runstart) ----------------------------------------
  const rng = mulberry32(0x5eed9);
  const interceptions = new Set<number>();
  let lastRunTime = 0;
  let hitsTaken = 0;

  // Boss director.
  let parentId = -1;
  let broodNumber = 0;
  let websDead = 0;
  let stageIndex = 0;
  let nextBroodAt: number | null = null;
  let pendingBroodSpawns: Array<{ at: number }> = [];
  const liveBroodlings = new Set<number>();
  let broodSpawnedTotal = 0;
  let parentKilled = false;
  let parentEscaped = false;
  let parentDeathTime = 0;

  function resetRunState() {
    parentId = -1;
    broodNumber = 0;
    websDead = 0;
    stageIndex = 0;
    nextBroodAt = null;
    pendingBroodSpawns = [];
    liveBroodlings.clear();
    broodSpawnedTotal = 0;
    parentKilled = false;
    parentEscaped = false;
    parentDeathTime = 0;
    lastRunTime = 0;
    hitsTaken = 0;
    interceptions.clear();
    parentEntry.lockable = true;
  }

  bus.on('runstart', resetRunState);
  bus.on('playerhit', ({ damage }) => {
    hitsTaken += damage;
  });
  bus.on('fire', ({ enemyId }) => interceptions.add(enemyId));
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'parent') return;
    parentId = enemyId;
    bus.emit('bossphase', { phase: 'summoned' });
    nextBroodAt = lastRunTime + 0.6;
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (liveBroodlings.delete(enemyId)) return;
    if (enemyId === parentId) {
      parentKilled = true;
      parentDeathTime = lastRunTime;
      parentEntry.lockable = false;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (liveBroodlings.delete(enemyId)) {
      // A broodling that got away swims back to the parent and is re-brooded —
      // the colony keeps pumping out fresh defenders until the deadline.
      if (!parentKilled && !parentEscaped && broodNumber > websDead && broodSpawnedTotal < BROOD_RESPAWN_CAP) {
        pendingBroodSpawns.push({ at: lastRunTime + 2.6 });
      }
    }
  });
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== parentId) return;
    stageIndex += 1;
    // A wounded parent calls the next brood early — but never before its bar.
    if (nextBroodAt !== null) nextBroodAt = Math.min(nextBroodAt, lastRunTime + 0.75);
  });

  function spawnBroodling(context: StrandlineUpdate) {
    broodSpawnedTotal += 1;
    const id = context.spawnEnemy({
      time: context.runTime,
      kind: 'broodling',
      data: {
        role: 'broodling',
        radius: 3.2 + rng() * 3.4,
        angSpeed: (0.42 + rng() * 0.4) * (rng() < 0.5 ? 1 : -1),
        phase: rng() * Math.PI * 2,
        tilt: (rng() - 0.5) * 0.9,
        bob: 0.5 + rng() * 1.2,
        seed: rng() * 100,
        firstSpit: 2.6 + rng() * 2.2,
        spitPeriod: 5.2 + rng() * 2.4,
      },
    });
    liveBroodlings.add(id);
    return id;
  }

  function fireSpore(context: StrandlineUpdate, from: Vector3, speed = 4.2) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'spore',
      countsTowardTotal: false,
      data: { role: 'spore', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // The boss director runs inside the parent's per-frame update.
  function updateParentDirector(context: StrandlineUpdate) {
    const { runTime } = context;
    if (parentKilled || parentEscaped) return;

    if (nextBroodAt !== null && runTime >= nextBroodAt && broodNumber < 3) {
      broodNumber += 1;
      broodSpawnedTotal = 0;
      for (let i = 0; i < BROOD_COUNTS[broodNumber - 1]; i += 1) {
        pendingBroodSpawns.push({ at: runTime + 0.4 + i * 0.38 });
      }
      nextBroodAt = null;
    }
    while (pendingBroodSpawns.length > 0 && pendingBroodSpawns[0].at <= runTime) {
      pendingBroodSpawns.shift();
      spawnBroodling(context);
    }
    if (broodNumber > websDead && pendingBroodSpawns.length === 0 && liveBroodlings.size === 0) {
      // The brood is dead; the webbing it fed shrivels and the parent is bare
      // for one more stage.
      websDead = broodNumber;
      bus.emit('bossphase', { phase: 'exposed' });
      if (websDead < 3) nextBroodAt = Math.max(BROOD_FIRST_BAR_TIMES[websDead + 1], runTime + 1.0);
    }

    if (runTime >= STRANDLINE_SK9Q_MARKERS.deadline) {
      parentEscaped = true;
      parentEntry.lockable = false;
    }
  }

  // ---- movement ------------------------------------------------------------

  function updateLatcher(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'latcher' }>) {
    const { enemy, runProgress, runTime, age, curve, camera, railAnchor, damagePlayer } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ velocity: new Vector3(), detached: false, lastAge: 0 }));
    const dt = Math.max(0, age - state.lastAge);
    state.lastAge = age;

    if (!state.detached) {
      // Clamped to its strand, pulsing; sways with the current.
      const sway = Math.sin(runTime * 0.8 + data.phase);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(
        data.baseX + sway * 0.5,
        data.baseY + Math.cos(runTime * 0.6 + data.phase) * 0.4,
        sway * 0.3,
      )));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(runTime * 3.1 + data.phase);
      // Aggro latchers detach and defend the colony once the player closes in.
      if (data.aggro && age > data.lead - 2.6) {
        state.detached = true;
        enemy.mesh.userData.detached = true;
        state.velocity.copy(camera.position).sub(enemy.mesh.position).normalize().multiplyScalar(2);
      }
      return runProgress > anchorU + PASS_EPS;
    }

    // Free-swimming: homes straight at the camera and strikes unless shot
    // down. It must outpace the camera's own advance to close the gap.
    const desired = camera.position.clone().sub(enemy.mesh.position).normalize().multiplyScalar(11.5);
    state.velocity.lerp(desired, Math.min(1, dt * 3.5));
    enemy.mesh.position.addScaledVector(state.velocity, dt);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(runTime * 9 + data.phase);
    if (enemy.mesh.position.distanceTo(camera.position) < 2.6) {
      enemy.mesh.userData.struck = true;
      damagePlayer(1);
      return true;
    }
    return runProgress > anchorU + PASS_EPS;
  }

  function updateSkitter(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'skitter' }>) {
    const { enemy, runProgress, runTime, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({
      x: data.startX,
      vx: data.dir * 9,
      nextFlipAt: 0.5 + hash01(data.seed) * 0.6,
      lastAge: 0,
    }));
    const dt = Math.max(0, age - state.lastAge);
    state.lastAge = age;
    // Erratic lateral dashing: sharp bursts, sudden reversals, like something
    // sprinting along a strand it doesn't want to leave.
    if (age >= state.nextFlipAt) {
      state.nextFlipAt = age + 0.35 + hash01(data.seed + age * 3.7) * 0.75;
      const flip = hash01(data.seed * 1.3 + age * 7.1);
      if (flip < 0.42) state.vx = -state.vx;
      state.vx = MathUtils.clamp(state.vx * (0.7 + flip), -13, 13);
    }
    state.x += state.vx * dt;
    if (state.x > 15) { state.x = 15; state.vx = -Math.abs(state.vx); }
    if (state.x < -15) { state.x = -15; state.vx = Math.abs(state.vx); }
    const hop = Math.abs(Math.sin(age * 7 + data.seed)) * 0.8;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(state.x, data.y + hop, Math.sin(age * 3 + data.seed) * 0.3)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(state.vx > 0 ? 0 : Math.PI);
    enemy.mesh.userData.scurry = Math.abs(state.vx) / 13;
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(runTime * 6 + data.seed);
    return runProgress > anchorU + PASS_EPS;
  }

  function updateHusk(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'husk' }>) {
    const { enemy, runProgress, runTime, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // A slow, stately tumble — an armored sac drifting with the current.
    const spiral = age * 0.7 * data.spin + data.phase;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(
      data.baseX + Math.cos(spiral) * 1.4,
      data.baseY + Math.sin(spiral) * 1.1 + Math.sin(runTime * 0.5 + data.phase) * 0.5,
      0,
    )));
    enemy.mesh.rotation.set(age * 0.6 * data.spin + data.phase, age * 0.4, age * 0.5 * data.spin);
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(runTime * 2.2 + data.phase);
    return runProgress > anchorU + PASS_EPS;
  }

  function updateSpitter(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'spitter' }>) {
    const { enemy, runProgress, runTime, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ nextFireAt: data.firstFire }));
    const sway = Math.sin(runTime * 0.7 + enemy.id);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(
      data.baseX + sway * 0.4,
      data.baseY + Math.cos(runTime * 0.55 + enemy.id) * 0.35,
      0,
    )));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(runTime * 2.8 + enemy.id);

    const distanceToCamera = enemy.mesh.position.distanceTo(camera.position);
    const cueUntil = state.nextFireAt - 0.55;
    enemy.mesh.userData.cue = age >= cueUntil && age < state.nextFireAt ? (age - cueUntil) / 0.55 : 0;
    if (age >= state.nextFireAt && runProgress < anchorU && distanceToCamera < 80) {
      state.nextFireAt = age + data.period;
      fireSpore(context, enemy.mesh.position, 4.6);
    }
    return runProgress > anchorU + PASS_EPS;
  }

  function updateSpore(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'spore' }>) {
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
      enemy.mesh.userData.pulse = 1;
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.4,
      maxSpeed: 10,
      accel: 2.6,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(age * 14 + enemy.id);
    return age > SPORE_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateBroodling(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'broodling' }>) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const gone = parentKilled || parentEscaped;
    const state = context.enemyState(() => ({ flee: null as Vector3 | null, fleeAt: 0, lastAge: 0, nextSpitAt: data.firstSpit }));
    const dt = Math.max(0, age - state.lastAge);
    state.lastAge = age;
    const anchorU = railAnchor(BROODLING_LEAD);

    if (gone && !state.flee) {
      // The parent is dead or gone: the brood scatters into the blue.
      state.flee = enemy.mesh.position.clone().sub(camera.position).normalize()
        .add(new Vector3((hash01(data.seed) - 0.5) * 1.4, 0.9, (hash01(data.seed * 3) - 0.5) * 0.6))
        .normalize().multiplyScalar(14);
      state.fleeAt = age;
      enemy.mesh.userData.fleeing = true;
    }
    if (state.flee) {
      enemy.mesh.position.addScaledVector(state.flee, dt);
      state.flee.multiplyScalar(1 + dt * 0.25);
      enemy.mesh.quaternion.copy(camera.quaternion);
      return age > state.fleeAt + 1.6;
    }

    // A swarm pod: detached from the parent, it swims out to meet the player
    // and orbits a point ahead, on a ring tilted toward the crown.
    const angle = data.phase + age * data.angSpeed;
    const ring = new Vector3(
      BROODLING_CENTER_X + Math.cos(angle) * data.radius,
      BROODLING_CENTER_Y + Math.sin(angle) * data.radius * 0.5,
      Math.sin(angle) * data.radius * 0.45,
    );
    ring.applyAxisAngle(new Vector3(1, 0, 0), data.tilt);
    ring.y += Math.sin(age * 1.7 + data.seed) * data.bob;
    const orbitPosition = offsetFromRail(curve, anchorU, ring);
    if (age < 0.9) {
      // Fresh spawn: fly out from the parent to the orbit ring.
      const blend = easeOutQuad(age / 0.9);
      enemy.mesh.position.copy(parentAnchorAt(runTime)).lerp(orbitPosition, blend);
    } else {
      enemy.mesh.position.copy(orbitPosition);
    }
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle);
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(runTime * 5 + data.seed);

    // Spit spores at the camera while the colony is defended.
    if (!gone && age >= state.nextSpitAt && runTime < STRANDLINE_SK9Q_MARKERS.deadline - 1.5 && runProgress < anchorU) {
      state.nextSpitAt = age + data.spitPeriod;
      fireSpore(context, enemy.mesh.position, 4.0);
    }
    // Overtaken pods flee back to the parent (and are re-brooded).
    return runProgress > anchorU + PASS_EPS;
  }

  function updateParent(context: StrandlineUpdate) {
    const { enemy, runTime } = context;
    updateParentDirector(context);
    if (parentEscaped) {
      // The director's deadline has passed: the mesh burrows (visuals) and the
      // runner retires it as a miss.
      return true;
    }
    const anchor = parentAnchorAt(runTime);
    enemy.mesh.position.copy(anchor);
    enemy.mesh.lookAt(context.camera.position);
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(runTime * 2.6);
    enemy.mesh.userData.bare = stageIndex < websDead;
    enemy.mesh.userData.stageIndex = stageIndex;
    return false;
  }

  // ---- level definition ----------------------------------------------------

  return {
    duration: STRANDLINE_SK9Q_DURATION,
    bpm: STRANDLINE_SK9Q_BPM,
    playerHealth: STRANDLINE_SK9Q_PLAYER_HEALTH,
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    timing: { shotDelay: { maxGridSeconds: 0.22 } },
    updateEnemy(context) {
      lastRunTime = context.runTime;
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'latcher':
          return updateLatcher(context, data);
        case 'skitter':
          return updateSkitter(context, data);
        case 'husk':
          return updateHusk(context, data);
        case 'spitter':
          return updateSpitter(context, data);
        case 'spore':
          return updateSpore(context, data);
        case 'broodling':
          return updateBroodling(context, data);
        case 'parent':
          return updateParent(context);
      }
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      // Adrift in the strand forest, looking down-rail toward the bell glow.
      const base = curve.getPointAt(0.004);
      const look = curve.getPointAt(0.06);
      camera.position.copy(base).add(new Vector3(
        Math.sin(modeTime * 0.42) * 0.5,
        Math.cos(modeTime * 0.33) * 0.35,
        Math.sin(modeTime * 0.27) * 0.2,
      ));
      camera.lookAt(look.add(new Vector3(Math.sin(modeTime * 0.38) * 0.6, Math.cos(modeTime * 0.5) * 0.4 + 1.2, 0)));
    },
    scoreForKill(volleySize, enemy) {
      const award = KILL_SCORE[enemy.kind];
      return Math.round(award * (1 + Math.max(0, volleySize - 1) * 0.1));
    },
    // Cracking a husk shell or tearing a parent stage pays a little.
    scoreForHit: () => 40,
    // The web lattice blocks the SHOT, not the lock: a shielded parent locked
    // into a volley is denied (and fed back as such) while the rest of the
    // volley flies. A volley of ONLY the shielded parent rejects outright.
    validateRelease(enemies) {
      const allowed = enemies.filter((enemy) => enemy.kind !== 'parent' || stageIndex < websDead);
      if (allowed.length === 0) return false;
      if (allowed.length === enemies.length) return true;
      return allowed;
    },
    scoreForVolley(results) {
      if (results.length < 2) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length * results.length * 25;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (parentKilled && clearRate >= 0.9 && score >= 11000) return 'RADIANT';
      if (parentKilled && clearRate >= 0.72) return 'LUMEN';
      if (parentKilled || clearRate >= 0.55) return 'TIDE';
      if (clearRate >= 0.35) return 'DRIFT';
      return 'FOULED';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_SK9Q_PLAYER_HEALTH - hitsTaken);
      const lines = [`HULL ${hull}/${STRANDLINE_SK9Q_PLAYER_HEALTH}`, `WEBS BURNED OFF ${websDead}/3`];
      if (parentKilled) {
        const margin = STRANDLINE_SK9Q_MARKERS.deadline - parentDeathTime;
        lines.push(`PARENT TORN LOOSE — T-${margin.toFixed(1)}s TO SPARE`);
      } else if (parentEscaped) {
        lines.push('THE PARENT BURROWED — COLONY REMAINS');
      } else if (hull <= 0) {
        lines.push('LIGHT SNUFFED OUT');
      }
      return lines;
    },
  };
}

function easeOutQuad(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) * (1 - clamped);
}

// Cheap deterministic hash → [0,1), for skitter flips and broodling scatter.
function hash01(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
