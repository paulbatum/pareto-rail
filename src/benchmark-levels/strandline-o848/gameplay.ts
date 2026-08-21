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
  BROOD_WAVE_COUNTS,
  createParentAnchor,
  createParentEntries,
  createStrandlineParent,
  type StrandlineParent,
} from './parent';
import { PARENT_TIME, STRANDLINE_BPM, STRANDLINE_DURATION, bar } from './timing';

// STRANDLINE — a 60-second ride through a gigantic jellyfish, freeing it from
// a parasite infestation, scored to a 96 BPM arrangement (one bar = 2.5 s;
// 24 bars = exactly 60 s):
//
//   Drift   (0–20s)    The strands — banking through the tentacle forest,
//                      sunlit water, parasites latched and detaching.
//   Open    (20–30s)   The curve swings wide and the bell fills the view like
//                      a green moon. Brightest stretch of the run.
//   Return  (32.5–40s) The rail dives back into the strands; the forest
//                      thickens toward the crown.
//   Parent  (42.5–55s) The parent organism, dug in behind its webbing, pumping
//                      out broods. Starve the panels, tear them loose, expose.
//   Serene  (55–60s)   The kill: camera pulls back and back, every strand
//                      glowing clean, the animal drifts on.

export type StrandlineEnemyKind =
  | 'clasper'
  | 'drifter'
  | 'skein'
  | 'broodling'
  | 'nettle'
  | 'panel'
  | 'parent';

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in the runner's enemyState bags, boss/run
// state lives in parent.ts's closure, and dynamically spawned broodlings and
// nettles get fresh data objects each launch.
export type StrandlineSpawnData =
  | { role: 'latched'; lead: number; offset: Vector3; seed: number; detachAt: number }
  | { role: 'drifter'; lead: number; fromX: number; toX: number; y: number; bobPhase: number }
  | { role: 'skein'; lead: number; fromX: number; toX: number; y: number; zig: number; crossTime: number; delay: number }
  | { role: 'brood'; wave: number; slot: number }
  | { role: 'nettle'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'panel'; socket: number }
  | { role: 'parent' };

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

// ---- speed profile → rail easing ------------------------------------------

// Piecewise-linear speed factors over run time. The swing-wide at the bell is
// the surge; the crown approach and the serene pull-back slow everything down.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.78],
  [bar(4), 0.92],
  [bar(7), 1.0],
  [bar(8), 1.28],
  [bar(10), 1.16],
  [bar(12), 1.02],
  [bar(14), 1.06],
  [bar(16), 0.98],
  [bar(17), 0.88],
  [bar(20), 0.84],
  [bar(22), 0.6],
  [bar(24), 0.58],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => strandlineRunProgress(time);

// ---- rail ------------------------------------------------------------------

// Down among the trailing tentacles (deep, y ≈ -110), swinging out wide right
// for the bell reveal, then climbing back up under the crown where the strands
// root into the bell. The bell hangs at BELL_CENTER (see timing.ts).
export function createStrandlineRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(-5, -118, -8),
      new Vector3(14, -106, -76),
      new Vector3(-15, -128, -157),
      new Vector3(20, -112, -242),
      new Vector3(-19, -100, -323),
      new Vector3(7, -122, -400),
      new Vector3(44, -108, -476),
      new Vector3(100, -86, -553),
      new Vector3(134, -62, -638),
      new Vector3(128, -50, -723),
      new Vector3(88, -56, -795),
      new Vector3(41, -74, -850),
      new Vector3(-2, -92, -889),
      new Vector3(-29, -102, -916),
      new Vector3(-39, -108, -932),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

// ---- spawn timeline ---------------------------------------------------------

// Leads are authored at cruise and scaled once here: closer spawns mean
// bigger on-screen silhouettes and a wider sweep when volleys land.
const LEAD_SCALE = 0.85;

const claspers = (time: number, rawLead: number, entries: Array<[number, number]>, detachAt = 2.2): StrandlineSpawnEntry[] =>
  entries.map(([x, y], index) => ({
    time: time + index * 0.18,
    kind: 'clasper',
    data: { role: 'latched', lead: rawLead * LEAD_SCALE, offset: new Vector3(x, y, 0), seed: index * 2.61 + time, detachAt },
  }));

const drifters = (time: number, rawLead: number, runs: Array<{ fromX: number; toX: number; y: number }>): StrandlineSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.24,
    kind: 'drifter',
    hitPoints: 2,
    data: { role: 'drifter', lead: rawLead * LEAD_SCALE, fromX: run.fromX, toX: run.toX, y: run.y, bobPhase: index * 1.7 },
  }));

const skeins = (
  time: number,
  rawLead: number,
  runs: Array<{ fromX: number; toX: number; y: number; crossTime?: number; delay?: number; zig?: number }>,
): StrandlineSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.14,
    kind: 'skein',
    data: {
      role: 'skein',
      lead: rawLead * LEAD_SCALE,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      zig: run.zig ?? 1.8,
      crossTime: run.crossTime ?? 2.7,
      delay: run.delay ?? index * 0.36,
    },
  }));

function buildStrandlineTimeline(parentTimeline: StrandlineSpawnEntry[]): StrandlineSpawnEntry[] {
  return [
  // --- Act 1: The strands. Sparse and readable; learn the sweep among the glow.
  ...claspers(bar(2), 4.8, [[-5.5, 2], [1, 4.4], [5.5, -0.8]], 2.4),
  ...skeins(bar(3.5), 4.6, [
    { fromX: -16, toX: 16, y: 2.5 },
    { fromX: 16, toX: -16, y: -1.8, delay: 0.7 },
  ]),
  ...drifters(bar(4.5), 4.9, [
    { fromX: -7, toX: 7, y: 4.6 },
    { fromX: 7, toX: -7, y: -2.4 },
  ]),
  ...claspers(bar(5.5), 4.6, [[-8, -0.5], [-3, 3.4], [3, 3.4], [8, -0.5]], 2.0),
  ...skeins(bar(6.5), 4.5, [
    { fromX: -18, toX: 18, y: 3.4, crossTime: 2.4 },
    { fromX: 18, toX: -18, y: 1, crossTime: 2.4, delay: 0.45 },
    { fromX: -18, toX: 18, y: 5, crossTime: 2.4, delay: 0.9 },
  ]),
  ...drifters(bar(7.25), 4.7, [{ fromX: -2, toX: 2, y: 2.2 }]),

  // (bar 7.75–8.25 held nearly clear for the swing into open water)

  // --- Act 2: Open water. The bell fills the sky; the water brightens.
  ...drifters(bar(8.5), 4.4, [
    { fromX: -9, toX: 9, y: 3 },
    { fromX: 0, toX: 0, y: 5.4 },
    { fromX: 9, toX: -9, y: 0.5 },
  ]),
  ...claspers(bar(9.5), 4.4, [[-7.5, 2], [-2.5, 4.2], [2.5, 4.2], [7.5, 2]], 1.8),
  ...skeins(bar(10.5), 4.3, [
    { fromX: -22, toX: 22, y: 1, crossTime: 2.2 },
    { fromX: 22, toX: -22, y: 3.2, crossTime: 2.2, delay: 0.3 },
    { fromX: -22, toX: 22, y: 5, crossTime: 2.2, delay: 0.6 },
    { fromX: 22, toX: -22, y: -2.2, crossTime: 2.2, delay: 0.9 },
  ]),
  ...drifters(bar(11.25), 4.5, [
    { fromX: -10, toX: 10, y: 4.4 },
    { fromX: 11, toX: -11, y: -0.6 },
  ]),
  ...claspers(bar(12), 4.4, [[-6, 0.5], [0, 3.4], [6, 0.5]], 1.8),

  // --- Act 3: Back in the strands. Denser cadence, the forest closes in.
  ...claspers(bar(13), 4.3, [[-8.5, 1.5], [-4, 4.4], [0, -1.4], [4, 4.4], [8.5, 1.5]], 1.6),
  ...skeins(bar(14), 4.2, [
    { fromX: -24, toX: 24, y: 0.5, crossTime: 2.1 },
    { fromX: 24, toX: -24, y: 2.4, crossTime: 2.1, delay: 0.26 },
    { fromX: -24, toX: 24, y: 4.2, crossTime: 2.1, delay: 0.52 },
    { fromX: 24, toX: -24, y: 5.6, crossTime: 2.1, delay: 0.78 },
    { fromX: -24, toX: 24, y: 1.6, crossTime: 2.1, delay: 1.04 },
    { fromX: 24, toX: -24, y: 3.4, crossTime: 2.1, delay: 1.3 },
  ]),
  ...drifters(bar(15), 4.4, [
    { fromX: -9, toX: 9, y: 3.8 },
    { fromX: 9, toX: -9, y: -2.6 },
  ]),
  ...claspers(bar(15.5), 4.2, [[-8, -2], [0, 5], [8, -2]], 1.5),
  ...skeins(bar(16.25), 4.2, [
    { fromX: -20, toX: 20, y: 2, crossTime: 2 },
    { fromX: 20, toX: -20, y: 4, crossTime: 2, delay: 0.4 },
  ]),

  // (bars 16.75–17 clear for the crown approach)

  // --- Act 4: The parent. Webbing, broods, nettles — see parent.ts.
  ...parentTimeline,

  // A few late stragglers keep the crown approach honest.
  ...skeins(bar(19.5), 3.8, [
    { fromX: -16, toX: 16, y: 3, crossTime: 2.6 },
    { fromX: 16, toX: -16, y: 0.5, crossTime: 2.6, delay: 0.8 },
  ]),
  ].sort((a, b) => a.time - b.time);
}

export function createStrandlineTimeline() {
  const { parentEntry, timeline } = createParentEntries(PARENT_TIME);
  return {
    parentEntry,
    panelEntries: timeline.filter((entry) => entry.kind === 'panel'),
    parentTimeline: timeline,
    timeline: buildStrandlineTimeline(timeline),
  };
}

export const STRANDLINE_TIMELINE: StrandlineSpawnEntry[] = createStrandlineTimeline().timeline;

const KILL_SCORE: Record<StrandlineEnemyKind, number> = {
  clasper: 140,
  drifter: 200,
  skein: 150,
  broodling: 120,
  nettle: 60,
  panel: 400,
  parent: 2600,
};

const NETTLE_MAX_AGE = 12;

export function createStrandlineGameplay(
  bus: EventBus,
): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  const curve = createStrandlineRail();

  // Interceptions: player volleys can cut nettles out of the water.
  const interceptions = new Set<number>();
  let hitsTaken = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
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

  const anchor = createParentAnchor(curve, railU);
  const { parentTimeline } = createStrandlineTimeline();
  const parentEntry = parentTimeline.find((entry) => entry.kind === 'parent')!;
  const panelEntries = parentTimeline.filter((entry) => entry.kind === 'panel');

  const parent: StrandlineParent = createStrandlineParent(bus, {
    anchor,
    panelEntries,
    parentEntry,
    spawnBrood(context, wave) {
      const count = BROOD_WAVE_COUNTS[wave] ?? 3;
      for (let slot = 0; slot < count; slot += 1) {
        const broodId = context.spawnEnemy({
          time: context.runTime + slot * 0.22,
          kind: 'broodling',
          countsTowardTotal: false,
          data: { role: 'brood', wave, slot },
        });
        parent.registerBrood(wave, broodId);
      }
    },
    spawnNettle(context, spreadX) {
      const from = anchor.position.clone();
      const initial = hostileShotAimPoint(context.camera, from)
        .sub(from)
        .normalize()
        .multiplyScalar(5.5);
      initial.x += spreadX * 0.4;
      context.spawnEnemy({
        time: context.runTime,
        kind: 'nettle',
        countsTowardTotal: false,
        data: { role: 'nettle', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
      });
    },
  });

  // ---- movement -------------------------------------------------------------

  function updateClasper(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'latched' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);

    // Latched phase: gripped onto its strand, shuddering. Then it detaches
    // and swoops at the camera along a decaying arc.
    const detach = Math.min(1, Math.max(0, (age - data.detachAt) / 1.1));
    const eased = detach * detach * (3 - 2 * detach);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 5.2 + data.seed) * (1 - eased) * 0.14;
    offset.y += Math.cos(age * 4.4 + data.seed) * (1 - eased) * 0.1;
    if (eased > 0) {
      const swoop = Math.sin(eased * Math.PI);
      offset.y -= swoop * 2.4;
      offset.z -= eased * 7;
      offset.x += Math.sin(data.seed * 3.1) * eased * 3.4;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Shell halves gape wider as it detaches.
    enemy.mesh.userData.gape = eased;
    enemy.mesh.rotateZ(Math.sin(age * 2.4 + data.seed) * 0.3);
    return runProgress > anchorU + 0.014;
  }

  function updateDrifter(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'drifter' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = MathUtils.clamp(age / 5.2, 0, 1);
    const eased = t * t * (3 - 2 * t);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    // A jelly pulse: it surges on each contraction, drifts between.
    const pulse = Math.max(0, Math.sin(age * 2.4 + data.bobPhase));
    const y = data.y + Math.sin(age * 0.9 + data.bobPhase * 2) * 0.9 + pulse * 0.25;

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 0.7 + data.bobPhase) * 0.6)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.pulse = pulse;
    return runProgress > anchorU + 0.013;
  }

  function updateSkein(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'skein' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const zigzag = Math.sin(age * 6.2 + enemy.id) * data.zig * Math.sin(clamped * Math.PI);
    const y = data.y + zigzag * 0.45;

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    // Nose along its crossing, tail streaming.
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)),
      data.y + Math.sin(age * 6.2 + enemy.id + 0.3) * data.zig * Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * 0.45,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(Math.sin(age * 9 + enemy.id) * 0.25);
    void camera;
    return false;
  }

  function updateBrood(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'brood' }>) {
    const { enemy, age, camera } = context;
    // Launched from the parent, they swirl out around their wave siblings and
    // hold a swirling cloud in the mid-ground until picked off or washed past.
    const seed = data.wave * 7.3 + data.slot * 2.9;
    const state = context.enemyState(() => ({
      drift: new Vector3(
        Math.sin(seed) * (4 + data.slot * 2.4),
        Math.cos(seed * 1.7) * 2.4,
        -26 - data.slot * 7,
      ),
    }));
    // They spill out of the parent and dive down into the swim corridor.
    const descent = MathUtils.clamp(age / 1.6, 0, 1);
    const dive = descent * descent * (3 - 2 * descent);
    const orbit = age * (1.1 + data.slot * 0.22) + seed;
    const offset = new Vector3(
      state.drift.x + Math.sin(orbit) * 2.6,
      MathUtils.lerp(6, state.drift.y, dive) + Math.sin(orbit * 1.4) * 1.6,
      state.drift.z,
    );
    enemy.mesh.position
      .copy(parent.anchor.position)
      .addScaledVector(parent.anchor.right, offset.x)
      .addScaledVector(parent.anchor.up, offset.y)
      .addScaledVector(parent.anchor.forward, -offset.z);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.pulse = Math.max(0, Math.sin(age * 5 + seed));
    return age > 9 || shotBehindCamera(camera, enemy.mesh.position, 6);
  }

  function updateNettle(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'nettle' }>) {
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

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5.2,
      maxSpeed: 11.5,
      accel: 3.0,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    orientAlongVelocity(enemy.mesh.position, data.velocity, context);
    return age > NETTLE_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function orientAlongVelocity(position: Vector3, velocity: Vector3, context: StrandlineUpdate) {
    if (velocity.lengthSq() < 0.001) return;
    const target = position.clone().add(velocity);
    context.enemy.mesh.lookAt(target);
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: 4,
    createRail: createStrandlineRail,
    spawnTimeline: buildStrandlineTimeline(parentTimeline),
    easeRunProgress: strandlineRunProgress,
    startWord: 'STRAND',
    replayWord: 'RELEASE',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'latched':
          return updateClasper(context, data);
        case 'drifter':
          return updateDrifter(context, data);
        case 'skein':
          return updateSkein(context, data);
        case 'brood':
          return updateBrood(context, data);
        case 'nettle':
          return updateNettle(context, data);
        case 'panel':
          return parent.updatePanel(context, data);
        case 'parent':
          return parent.updateParent(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 45,
    scoreForVolley(results) {
      // A full, perfect volley is the tide coming back in; pay it like one.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (parent.state.parentKilled && score >= 10000 && clearRate >= 0.85) return 'S';
      if (score >= 7000 && clearRate >= 0.62) return 'A';
      if (score >= 4200 && clearRate >= 0.42) return 'B';
      if (score >= 1800 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, 4 - hitsTaken);
      const lines = [`Hull ${hull}/4`];
      const summary = parent.summaryLine();
      if (summary) lines.push(summary);
      return lines;
    },
  };
}
