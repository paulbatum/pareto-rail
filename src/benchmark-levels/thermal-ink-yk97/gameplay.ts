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
import { bossCenter, createOctopus, type OctopusSpawnData } from './octopus';
import {
  INK_BARS,
  INK_MARKERS,
  INK_TIME,
  THERMAL_INK_BPM,
  THERMAL_INK_RUN_DURATION,
} from './timing';

// THERMAL INK — one continuous 60-second boss fight in a drowned industrial
// harbor. The octopus is wrapped around wreckage dead ahead for the whole run;
// the rail circles the basin while its spawn scavenge in from the edges. The
// fight's rhythm is the ink: three ejections blind the harbor, infrared snaps
// in, and the player strikes white-hot silhouettes through the dark. Sever all
// six arms, then put the core out through the final blackout.

export { THERMAL_INK_BPM, THERMAL_INK_RUN_DURATION } from './timing';
export const THERMAL_PLAYER_HEALTH = 3;

export type ThermalEnemyKind =
  | 'skimmer'
  | 'lurker'
  | 'dredger'
  | 'inkshot'
  | 'arm'
  | 'core';

// Timeline entries carry immutable config; per-enemy runtime state lives in
// the runner's enemyState bags. Lurker-fired ink globs are spawned dynamically
// with fresh data objects.
export type ThermalSpawnData =
  | { role: 'skimmer'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'lurker'; lead: number; offset: Vector3; seed: number; shots: number }
  | { role: 'dredger'; leadStart: number; leadEnd: number; closeTime: number; offset: Vector3 }
  | { role: 'inkshot'; siphonX?: number; position?: Vector3; velocity?: Vector3 }
  | OctopusSpawnData;

export type ThermalSpawnEntry = LockOnSpawnEntry<ThermalEnemyKind, ThermalSpawnData>;
export type ThermalUpdate = LockOnEnemyUpdate<ThermalEnemyKind, ThermalSpawnData>;

// ---- rail -------------------------------------------------------------------

// A winding circuit of the harbor basin: wide arcs left and right (the circling
// read), a low skim near the waterline through the middle third, and a slow
// climb for the finale. The octopus rides 30 units ahead the whole way.
export function createThermalRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 2, 0),
      new Vector3(13, 3, -38),
      new Vector3(28, 1, -78),
      new Vector3(34, -2, -122),
      new Vector3(23, 4, -162),
      new Vector3(2, 6, -200),
      new Vector3(-22, 2, -238),
      new Vector3(-35, -3, -282),
      new Vector3(-28, -5, -326),
      new Vector3(-8, -4, -366),
      new Vector3(12, 1, -406),
      new Vector3(23, 6, -448),
      new Vector3(10, 4, -488),
      new Vector3(0, 5, -520),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

// ---- speed profile ----------------------------------------------------------

// Gentle cruise with a surge into each ink dive and a dying glide once the
// lamps return. The easing is the normalized integral, so surges read as real
// acceleration on the musical turnovers.
const SPEED_KEYS: Array<[number, number]> = [
  [INK_TIME.bar(0), 0.82],
  [INK_TIME.bar(2), 1.0],
  [INK_TIME.bar(5.7), 1.0],
  [INK_TIME.bar(6.4), 1.32],
  [INK_TIME.bar(8), 1.02],
  [INK_TIME.bar(11.7), 1.02],
  [INK_TIME.bar(12.4), 1.3],
  [INK_TIME.bar(14), 1.05],
  [INK_TIME.bar(19.7), 1.0],
  [INK_TIME.bar(20.4), 1.24],
  [INK_TIME.bar(22), 0.92],
  [INK_TIME.bar(23), 0.72],
  [INK_TIME.bar(24), 0.66],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, THERMAL_INK_RUN_DURATION);

export function thermalRunProgress(time: number, duration = THERMAL_INK_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- spawn timeline ---------------------------------------------------------

const bar = (n: number) => INK_TIME.bar(n);

const skimmers = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): ThermalSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.12,
    kind: 'skimmer',
    data: {
      role: 'skimmer',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.25,
      crossTime: run.crossTime ?? 2.4,
    },
  }));

const lurkers = (time: number, lead: number, offsets: Array<[number, number]>, shots = 2): ThermalSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.2,
    kind: 'lurker',
    data: { role: 'lurker', lead, seed: index * 2.13 + time, offset: new Vector3(offset[0], offset[1], 0), shots },
  }));

const dredgers = (time: number, offsets: Array<[number, number]>): ThermalSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.3,
    kind: 'dredger',
    hitPoints: 3,
    data: { role: 'dredger', leadStart: 5.5, leadEnd: 3.0, closeTime: 7.0, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const siphonShots = (times: Array<[number, number]>): ThermalSpawnEntry[] =>
  times.map(([time, x]) => ({
    time,
    kind: 'inkshot',
    countsTowardTotal: false,
    data: { role: 'inkshot', siphonX: x },
  }));

function buildThermalTimeline(octopusEntries: ThermalSpawnEntry[]): ThermalSpawnEntry[] {
  return [
    ...octopusEntries,

    // --- Reveal + first murk act: learn the sweep among the scavengers.
    ...skimmers(bar(0.6), 3.6, [
      { fromX: -19, toX: 19, y: 2.6, arc: 2.0 },
      { fromX: 19, toX: -19, y: 0.8, arc: 2.6 },
      { fromX: -19, toX: 19, y: 4.6, arc: 1.4 },
    ]),
    ...lurkers(bar(1.5), 2.8, [[-7, 1.6], [7, 1.6]]),
    ...skimmers(bar(3), 3.6, [
      { fromX: 19, toX: -19, y: 3.4, arc: 1.8 },
      { fromX: -19, toX: 19, y: 1.2, arc: 2.4 },
      { fromX: 19, toX: -19, y: 5.2, arc: 1.2 },
      { fromX: -19, toX: 19, y: -0.6, arc: 2.8 },
    ]),
    ...lurkers(bar(4.25), 2.8, [[-6, -2], [6, -2]]),
    ...dredgers(bar(4.9), [[0, 5.0]]),

    // --- Ink 1 (bars 6–8): the first blackout. Thermal streaks cross while the
    // player works arm pair A by its signal cores.
    ...siphonShots([[bar(6.3), -3.5], [bar(6.9), 3.5]]),
    ...skimmers(bar(6.5), 3.3, [
      { fromX: -18, toX: 18, y: 3.0, arc: 1.8, crossTime: 2.4 },
      { fromX: 18, toX: -18, y: 1.2, arc: 2.2, crossTime: 2.4 },
      { fromX: -18, toX: 18, y: 5.0, arc: 1.2, crossTime: 2.4 },
    ]),

    // --- Murk B (bars 8–12): the cloud thins, pair B reaches out, pressure builds.
    ...skimmers(bar(8.6), 3.6, [
      { fromX: 19, toX: -19, y: 2.2, arc: 2.2 },
      { fromX: -19, toX: 19, y: 0.4, arc: 2.6 },
      { fromX: 19, toX: -19, y: 4.4, arc: 1.6 },
    ]),
    ...lurkers(bar(9.5), 2.8, [[-8, 3], [0, 5.4], [8, 3]]),
    ...dredgers(bar(10.4), [[-5, 4.4], [5, 4.4]]),
    ...skimmers(bar(11), 3.6, [
      { fromX: -19, toX: 19, y: 1.6, arc: 2.4 },
      { fromX: 19, toX: -19, y: 3.6, arc: 1.8 },
      { fromX: -19, toX: 19, y: -0.4, arc: 2.8 },
    ]),

    // --- Ink 2 (bars 12–14): denser blackout; lurkers blaze at the edges.
    ...siphonShots([[bar(12.3), 4], [bar(13), -4]]),
    ...skimmers(bar(12.4), 3.3, [
      { fromX: -19, toX: 19, y: 2.4, arc: 2.0, crossTime: 2.3 },
      { fromX: 19, toX: -19, y: 0.6, arc: 2.4, crossTime: 2.3 },
      { fromX: -19, toX: 19, y: 4.6, arc: 1.4, crossTime: 2.3 },
      { fromX: 19, toX: -19, y: 3.2, arc: 1.8, crossTime: 2.3 },
    ]),
    ...lurkers(bar(12.8), 2.8, [[-7.5, 4.2], [7.5, 4.2]], 1),

    // --- Murk C (bars 14–18): the last arms and the heaviest scavenger tide.
    ...skimmers(bar(14.8), 3.6, [
      { fromX: -19, toX: 19, y: 1.0, arc: 2.6 },
      { fromX: 19, toX: -19, y: 3.0, arc: 2.0 },
      { fromX: -19, toX: 19, y: 5.0, arc: 1.4 },
      { fromX: 19, toX: -19, y: -0.6, arc: 3.0 },
    ]),
    ...lurkers(bar(15.75), 2.8, [[-8, -1], [8, -1]]),
    ...dredgers(bar(16.4), [[0, 5.4]]),
    ...skimmers(bar(17), 3.6, [
      { fromX: 19, toX: -19, y: 2.0, arc: 2.2 },
      { fromX: -19, toX: 19, y: 4.0, arc: 1.6 },
      { fromX: 19, toX: -19, y: 0.2, arc: 2.6 },
    ]),

    // --- Core reveal (bars 18–20): the mantle opens; clear the last spawn
    // before the final ejection.
    ...lurkers(bar(18.3), 2.8, [[-6, 3.8], [6, 3.8]], 1),
    ...skimmers(bar(18.6), 3.5, [
      { fromX: -18, toX: 18, y: 1.4, arc: 2.2 },
      { fromX: 18, toX: -18, y: 3.4, arc: 1.6 },
      { fromX: -18, toX: 18, y: 5.2, arc: 1.2 },
    ]),

    // --- Ink 3 (bars 20–23): the final blackout. The core burns red through
    // the dark; the siphon keeps spitting until it dies.
    ...siphonShots([[bar(20.5), -4.5], [bar(21.3), 0], [bar(22.1), 4.5]]),
  ];
}

const KILL_SCORE: Record<ThermalEnemyKind, number> = {
  skimmer: 90,
  lurker: 130,
  dredger: 260,
  inkshot: 40,
  arm: 350,
  core: 1800,
};

const INKSHOT_MAX_AGE = 12;

export function createThermalGameplay(bus: EventBus): LockOnRunnerLevel<ThermalEnemyKind, ThermalSpawnData> {
  const octopus = createOctopus(bus);
  const timeline = sortTimeline(buildThermalTimeline(octopus.entries()));

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let globsDowned = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    globsDowned = 0;
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

  function fireInkGlob(context: ThermalUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'inkshot',
      countsTowardTotal: false,
      data: { role: 'inkshot', position: from.clone(), velocity: initial },
    });
  }

  // ---- movement -------------------------------------------------------------

  function updateSkimmer(context: ThermalUpdate, data: Extract<ThermalSpawnData, { role: 'skimmer' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.013) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 2.4 + enemy.id) * 0.35;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 2.1 + enemy.id) * 0.5)));
    // Nose into travel; the debris-ray banks through its arc.
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)),
      data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(Math.sin(age * 1.7 + enemy.id) * 0.55);
    return false;
  }

  function updateLurker(context: ThermalUpdate, data: Extract<ThermalSpawnData, { role: 'lurker' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.9 + data.seed) * 1.4;
    offset.y += Math.sin(age * 1.35 + data.seed * 1.7) * 0.8;

    // Telegraphed spit: hunch back, snap forward, loose an ink glob.
    const fire = context.enemyState(() => ({ nextAt: 1.7 + (data.seed % 1) * 0.8, shotsLeft: data.shots }));
    const untilShot = fire.nextAt - age;
    if (fire.shotsLeft > 0) {
      if (untilShot < 0.8 && untilShot > 0.45) offset.z += (0.8 - untilShot) * 7;
      else if (untilShot <= 0.45 && untilShot > 0) offset.z -= (0.45 - untilShot) * 12;
      if (age >= fire.nextAt) {
        fire.shotsLeft -= 1;
        fire.nextAt = age + 3.1;
        fireInkGlob(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.3 + data.seed) * 0.3);
    return runProgress > anchorU + 0.014;
  }

  function updateDredger(context: ThermalUpdate, data: Extract<ThermalSpawnData, { role: 'dredger' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const close = Math.min(1, age / data.closeTime);
    const eased = close * close * (3 - 2 * close);
    const anchorU = railAnchor(MathUtils.lerp(data.leadStart, data.leadEnd, eased));
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.45 + enemy.id) * 1.2;
    // Lowered in on its chain from above the boss's mantle line, then grinds level.
    offset.y += (1 - eased) * 7 + Math.sin(age * 0.7) * 0.7;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // A grinding roll — dead machinery repurposed as a jaw.
    enemy.mesh.rotateZ(Math.sin(age * 0.9) * 0.18);
    // Chipped open: the wounded dredger shudders harder per lost hit point.
    const wounds = 3 - enemy.hitPointsRemaining;
    if (wounds > 0) {
      enemy.mesh.position.x += Math.sin(age * 17) * 0.05 * wounds;
      enemy.mesh.position.y += Math.cos(age * 21) * 0.045 * wounds;
    }
    return runProgress > anchorU + 0.014;
  }

  function updateInkshot(context: ThermalUpdate, data: Extract<ThermalSpawnData, { role: 'inkshot' }>) {
    const { enemy, age, runTime, runProgress, curve, camera, damagePlayer } = context;
    const state = context.enemyState(() => {
      // Siphon shots launch from the octopus body; lurker shots carry their
      // own launch data.
      if (data.position && data.velocity) {
        return { position: data.position.clone(), velocity: data.velocity.clone(), lastAge: 0, impact: {} as HostileShotImpactState };
      }
      const center = bossCenter(curve, runProgress, runTime, new Vector3());
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const forward = new Vector3();
      camera.getWorldDirection(forward);
      // Launch from the siphon mouth, on the camera side of the mantle.
      const from = center.clone()
        .addScaledVector(right, data.siphonX ?? 0)
        .addScaledVector(forward, -5)
        .add(new Vector3(0, -2, 0));
      const velocity = hostileShotAimPoint(camera, from).sub(from).normalize().multiplyScalar(4.2);
      return { position: from, velocity, lastAge: 0, impact: {} as HostileShotImpactState };
    });
    const dt = Math.max(0, age - state.lastAge);
    state.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: state.position,
      velocity: state.velocity,
      state: state.impact,
      intercepted: interceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(state.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 6);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // A heavy glob: slow ballistic launch that tightens into a homing run.
    steerHomingShot(state.position, state.velocity, hostileShotAimPoint(camera, state.position), age, dt, {
      baseSpeed: 4.6,
      maxSpeed: 10.5,
      accel: 2.8,
      turnRate: 2.0,
    });
    enemy.mesh.position.copy(state.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 2.4);
    return age > INKSHOT_MAX_AGE || shotBehindCamera(camera, state.position);
  }

  // ---- level definition -----------------------------------------------------

  return {
    duration: THERMAL_INK_RUN_DURATION,
    bpm: THERMAL_INK_BPM,
    playerHealth: THERMAL_PLAYER_HEALTH,
    createRail: createThermalRail,
    spawnTimeline: timeline,
    easeRunProgress: thermalRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'skimmer':
          return updateSkimmer(context, data);
        case 'lurker':
          return updateLurker(context, data);
        case 'dredger':
          return updateDredger(context, data);
        case 'inkshot':
          return updateInkshot(context, data);
        case 'arm':
        case 'core':
          return octopus.update(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'inkshot') globsDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chips on arms, dredger plate, and the core pay a little.
    scoreForHit: () => 45,
    scoreForVolley(results) {
      // A clean full volley is the fight's signature play.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 420 : results.length * 55;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (octopus.coreKilled() && score >= 9000 && clearRate >= 0.82) return 'S';
      if (score >= 6500 && clearRate >= 0.62) return 'A';
      if (score >= 4200 && clearRate >= 0.42) return 'B';
      if (score >= 1800 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, THERMAL_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${THERMAL_PLAYER_HEALTH}`, `Arms severed ${octopus.armsDown()}/6`];
      if (globsDowned > 0) lines.push(`${globsDowned} ink glob${globsDowned === 1 ? '' : 's'} shot down`);
      const summary = octopus.summary();
      if (summary) lines.push(summary);
      return lines;
    },
  };
}

// Marker re-exports for the level shell.
export { INK_BARS, INK_MARKERS, INK_TIME };
