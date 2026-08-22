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
import { formation, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { createFlagship, type Flagship } from './flagship';
import {
  BROADSIDE_7HIN_BARS,
  BROADSIDE_7HIN_BPM,
  BROADSIDE_7HIN_MARKERS,
  BROADSIDE_7HIN_RUN_DURATION,
  BROADSIDE_7HIN_TIME,
} from './timing';

export { BROADSIDE_7HIN_BPM, BROADSIDE_7HIN_MARKERS, BROADSIDE_7HIN_RUN_DURATION, BROADSIDE_7HIN_SECTIONS } from './timing';

// A 60-second fleet engagement flown across a whole battle: launch off the
// friendly flagship, corkscrew through the crossfire, a high-speed broadside
// run down a cruiser's flank, the hushed eye of the battle, a belly run under
// an enemy warship raking its turrets, and the two-phase enemy flagship
// finale. The player flies a 4-point hull; crimson shells home in and must be
// shot down before they brake against it.

export const BROADSIDE_PLAYER_HEALTH = 4;

export type BroadsideEnemyKind =
  | 'dart'
  | 'gunship'
  | 'weaver'
  | 'battery'
  | 'pdturret'
  | 'generator'
  | 'conduit'
  | 'bolt';

type WaveData = {
  role: 'wave';
  lead: number;
  pattern: 'weave' | 'strafe' | 'helix' | 'hold';
  x: number;
  y: number;
  phase: number;
};

type BoltData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impact: HostileShotImpactState;
};

export type BroadsideBossData =
  | { role: 'generator'; index: number; lead: number; x: number; y: number }
  | { role: 'pd'; index: number; lead: number; x: number; y: number }
  | { role: 'conduit'; index: number; lead: number; x: number; y: number };

export type BroadsideSpawnData = WaveData | BoltData | BroadsideBossData;
export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// --- Rail -------------------------------------------------------------------
// Waypoints are laid out so section boundaries land near even fractions of
// the curve: launch banks left off the deck, the gap corkscrews through two
// ship lines, the broadside run straightens along the friendly cruiser, the
// eye rises into the open vista, the belly run dips under the enemy hull, and
// the tail sweeps right into the trench before climbing hard for the pull-out.

export function createBroadsideRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 7, 24),
      new Vector3(-5, 8, -40),
      new Vector3(9, 5, -100),
      new Vector3(-12, 9, -160),
      new Vector3(13, -3, -225),
      new Vector3(-14, 7, -290),
      new Vector3(10, -5, -350),
      new Vector3(-7, 2, -420),
      new Vector3(-3, 3, -490),
      new Vector3(3, 9, -550),
      new Vector3(0, -2, -600),
      new Vector3(-4, -1, -650),
      new Vector3(3, 5, -705),
      new Vector3(0, 6, -765),
      new Vector3(14, 7, -820),
      new Vector3(10, 6, -852),
      new Vector3(10, 5, -884),
      new Vector3(10, 26, -952),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

// --- Speed profile ------------------------------------------------------------
// Authored speed keys in seconds: brisk build through the swarm sections, a
// fast broadside dash, a hard deceleration into the eye of the battle, a
// menacing belly cruise, a slow boss flank run, the crawl through the trench,
// and the pull-out spike over the breaking flagship.
const SPEED_KEYS: Array<[number, number]> = [
  [0, 11],
  [7.5, 14],
  [15, 16],
  [22.5, 17],
  [27, 18],
  [30, 17],
  [31.8, 10],
  [33.75, 9],
  [37.5, 13],
  [41.25, 14],
  [43.5, 15],
  [45, 11],
  [50.5, 11],
  [54.4, 13],
  [56.4, 9],
  [57.8, 10],
  [58.3, 26],
  [60, 30],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_7HIN_RUN_DURATION);

/** Rail progress [0,1] at an authored run time — the single map every set piece uses. */
export function progressAt(seconds: number) {
  return speedProfile.runProgress(seconds, BROADSIDE_7HIN_RUN_DURATION);
}

// --- Spawn timeline -----------------------------------------------------------

const time = BROADSIDE_7HIN_TIME;
const WAVE_STAGGER = 0.12;

const wave = (
  barValue: number,
  beat: number,
  kind: Extract<BroadsideEnemyKind, 'dart' | 'gunship' | 'weaver' | 'battery'>,
  pattern: WaveData['pattern'],
  offsets: Array<[number, number]>,
  lead = 3.7,
): BroadsideSpawnEntry[] =>
  formation(time.bar(barValue, beat), WAVE_STAGGER, offsets, ([x, y], index) => ({
    kind,
    ...(kind === 'battery' ? { hitStages: [1, 1] } : {}),
    data: { role: 'wave', lead, pattern, x, y, phase: index * 1.71 + barValue * 0.83 },
  }));

function createBroadsideTimeline(flagship: Flagship): BroadsideSpawnEntry[] {
  return [
    // --- Launch (bars 0-4): scouts peel off the deck as the fanfare lands.
    ...wave(2, 0, 'dart', 'weave', [[-5, -1], [-2, 3], [2, -2], [5, 2]], 3.9),
    ...wave(3.5, 0, 'dart', 'weave', [[-7, -2], [0, 4], [7, -2]], 3.9),

    // --- The gap (bars 4-8): first swarms knotted between the ship lines.
    ...wave(4.5, 0, 'weaver', 'helix', [[-6, 2], [0, 3.5], [6, 2]], 3.9),
    ...wave(5.5, 0, 'dart', 'weave', [[-8, -2], [-4, 3], [0, 4.5], [4, -1], [8, 1]], 3.7),
    ...wave(6.5, 0, 'gunship', 'strafe', [[-9, 3], [9, -2]], 4.2),
    ...wave(7.25, 0, 'dart', 'weave', [[-6, -2], [-2, 4], [2, -3], [6, 3]], 3.7),

    // --- Corkscrew (bars 8-12): hard banks, full-width spread.
    ...wave(8.25, 0, 'weaver', 'helix', [[-8, 3], [-3, -3], [3, 3], [8, -3]], 3.2),
    ...wave(9.25, 0, 'dart', 'weave', [[-10, 1], [-5, 4], [0, -3], [2, 5], [7, 2], [11, -1]], 3.2),
    ...wave(10.25, 0, 'gunship', 'strafe', [[-11, 2], [11, -2]], 3.9),
    ...wave(10.5, 2, 'dart', 'weave', [[-7, -3], [0, 3], [7, 4]], 3.2),
    ...wave(11.25, 0, 'weaver', 'helix', [[-5, 4], [1, -2], [6, 3]], 3.4),
    ...wave(11.75, 0, 'dart', 'weave', [[-11, 2], [-6, -2], [-1, 4], [4, -3], [9, 2]], 3.4),

    // --- Broadside run (bars 12-16): pace eases onto the set piece; the
    // cruiser's guns do the talking while light opposition sweeps through.
    ...wave(12.5, 0, 'gunship', 'strafe', [[-12, -1], [-5, 5.5], [0, -2]], 3.9),
    ...wave(13.5, 0, 'dart', 'weave', [[-9, -2], [-4, 3], [1, 4], [6, -1], [11, 2]], 3.2),
    ...wave(14.5, 0, 'weaver', 'helix', [[-8, 3], [-3, -3], [1, 3], [-6, -2]], 3.4),
    ...wave(15.5, 0, 'dart', 'weave', [[-6, 2], [0, -3], [4, 3]], 3.2),

    // --- Eye of the battle (bars 16-18): near silence, one drifting wing.
    ...wave(16.75, 0, 'dart', 'weave', [[-4, -2], [0, 3], [4, -1]], 4.2),

    // --- Belly run (bars 18-22): rake the warship's turrets while its
    // escort darts drop off the hull.
    ...wave(18.25, 0, 'battery', 'hold', [[-5, 5.5], [5, 5.5]], 4.6),
    ...wave(19, 0, 'dart', 'weave', [[-8, 1], [-3, -3], [2, 3], [7, 2]], 3.7),
    ...wave(20, 0, 'battery', 'hold', [[-8, 6], [2, 5]], 4.4),
    ...wave(20.75, 0, 'gunship', 'strafe', [[-10, -2], [10, 3]], 3.9),
    ...wave(21.5, 0, 'dart', 'weave', [[-9, 3], [-4, -2], [1, 4], [6, 1], [11, -2]], 3.2),

    // --- Approach (bars 22-24): the escort screen masses before the reveal.
    ...wave(22.25, 0, 'dart', 'weave', [[-10, 2], [-5, 4], [0, -3], [5, 3], [10, 1]], 3.2),
    ...wave(23, 0, 'weaver', 'helix', [[-7, -2], [-2, 4], [3, -3], [8, 3]], 3.4),
    ...wave(23.25, 2, 'gunship', 'strafe', [[-12, 1], [12, -1]], 3.7),
    ...wave(23.75, 0, 'dart', 'weave', [[-6, 3], [0, -2], [6, 4]], 3.2),

    // --- Flagship fight (bars 24-32): authored by the boss controller —
    // shield generators, point-defense emitters, and trench conduits.
    ...flagship.entries(BROADSIDE_7HIN_MARKERS.flagship),

// Escort waves ride the come-around as the shield falls (bars 27-29).
    ...wave(27, 0, 'dart', 'weave', [[-4, 2], [0, 4], [4, -2], [2, -4]], 3.4),
    ...wave(27.4, 0, 'gunship', 'strafe', [[-4, 4], [4, -2]], 3),
    ...wave(27.5, 0, 'dart', 'weave', [[-4, -3], [0, 4], [4, -1]], 2.2),
  ];
}

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const intercepted = new Set<number>();
  let hitsTaken = 0;
  let boltsDown = 0;
  let generatorsKilled = 0;
  let conduitsKilled = 0;

  function fireBolt(context: BroadsideUpdate, from: Vector3, spread = 0) {
    const aim = hostileShotAimPoint(context.camera, from);
    if (spread > 0) {
      aim.x += (Math.random() - 0.5) * spread * 2;
      aim.y += (Math.random() - 0.5) * spread * 2;
    }
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: {
        role: 'bolt',
        position: from.clone(),
        velocity: aim.sub(from).normalize().multiplyScalar(6),
        lastAge: 0,
        impact: {},
      },
    });
  }

  const flagshipLive = createFlagship(bus, fireBolt);
  const timeline = sortTimeline(createBroadsideTimeline(flagshipLive));

  bus.on('runstart', () => {
    intercepted.clear();
    hitsTaken = 0;
    boltsDown = 0;
    generatorsKilled = 0;
    conduitsKilled = 0;
  });

  bus.on('fire', ({ enemyId }) => intercepted.add(enemyId));
  bus.on('kill', ({ enemyId }) => intercepted.delete(enemyId));
  bus.on('miss', ({ enemyId }) => intercepted.delete(enemyId));
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  function updateWave(context: BroadsideUpdate, data: WaveData) {
    const { enemy, runTime, age, camera } = context;
    const anchorU = context.railAnchor(data.lead);
    const offset = new Vector3(data.x, data.y, 0);

    switch (data.pattern) {
      case 'weave': {
        offset.x += Math.sin(age * 1.9 + data.phase) * 1.7 - Math.sign(data.x) * Math.min(2.2, age * 0.5);
        offset.y += Math.cos(age * 1.45 + data.phase) * 0.9;
        break;
      }
      case 'strafe': {
        offset.x += Math.sin(age * 0.72 + data.phase) * 2.6;
        offset.y += Math.sin(age * 0.5 + data.phase * 1.3) * 0.7;
        break;
      }
      case 'helix': {
        const angle = age * 2.6 + data.phase;
        offset.x += Math.cos(angle) * 2.7;
        offset.y += Math.sin(angle) * 2.1;
        break;
      }
      case 'hold':
        break;
    }

    if (data.pattern === 'strafe' || data.pattern === 'hold') {
      const fire = context.enemyState(() => ({
        nextAt: data.pattern === 'hold' ? 1.9 + (enemy.id % 3) * 0.4 : 1.5 + (enemy.id % 3) * 0.35,
      }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + (data.pattern === 'hold' ? 3.4 : 3.8);
        fireBolt(context, enemy.mesh.position.clone(), data.pattern === 'hold' ? 0 : 0.5);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(context.curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    if (data.pattern === 'weave') enemy.mesh.rotateZ(Math.sin(age * 2.2 + data.phase) * 0.55);
    if (data.pattern === 'strafe') enemy.mesh.rotateZ(Math.cos(age * 0.72 + data.phase) * 0.22);
    if (data.pattern === 'helix') enemy.mesh.rotateZ(angleOf(age, data.phase));

    return context.runProgress > anchorU + 0.018 || age > 9;
  }

  function angleOf(age: number, phase: number) {
    return Math.sin(age * 2.6 + phase) * 0.8;
  }

  function updateBolt(context: BroadsideUpdate, data: BoltData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: intercepted.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 7);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5.5,
      maxSpeed: 11.5,
      accel: 3.0,
      turnRate: 1.7,
    });

    enemy.mesh.position.copy(data.position);
    enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return shotBehindCamera(camera, data.position) || age > 12;
  }

  return {
    duration: BROADSIDE_7HIN_RUN_DURATION,
    bpm: BROADSIDE_7HIN_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    lockRadiusNdc: 0.13,
    createRail: createBroadsideRail,
    spawnTimeline: timeline,
    easeRunProgress: speedProfile.runProgress,
    updateAttractCamera: updateBroadsideAttractCamera,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'wave') return updateWave(context, data);
      if (data.role === 'bolt') return updateBolt(context, data);
      return flagshipLive.update(context, data);
    },
    validateRelease(enemies) {
      return flagshipLive.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'generator') generatorsKilled += 1;
      if (enemy.kind === 'conduit') conduitsKilled += 1;
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.15));
    },
    scoreForHit: () => 45,
    // A clean six-lock release is a full broadside: worth a bonus.
    scoreForVolley: (results) => (results.length === 6 && results.every((result) => result.killed) ? 500 : 0),
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 14000 && clearRate >= 0.95 && hitsTaken === 0) return 'GRAND ADMIRAL';
      if (score >= 10000 && clearRate >= 0.78) return 'VICE ADMIRAL';
      if (score >= 6500 && clearRate >= 0.58) return 'CAPTAIN';
      if (score >= 3200 && clearRate >= 0.36) return 'COMMANDER';
      return 'ENSIGN';
    },
    detailsForRun() {
      const lines = [`Hull ${Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken)}/${BROADSIDE_PLAYER_HEALTH}`];
      const summary = flagshipLive.summary();
      if (summary) lines.push(summary);
      return lines;
    },
  };
}

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  dart: 100,
  gunship: 160,
  weaver: 120,
  battery: 260,
  pdturret: 140,
  generator: 420,
  conduit: 520,
  bolt: 50,
};

// Attract mode: a slow drift above the friendly flagship's deck looking down
// the rail into the nebula and the far fleet.
export function updateBroadsideAttractCamera({ camera, curve, modeTime }: {
  camera: import('three').PerspectiveCamera;
  curve: CatmullRomCurve3;
  modeTime: number;
}) {
  const u = 0.012 + Math.sin(modeTime * 0.05) * 0.004;
  const base = curve.getPointAt(MathUtils.clamp(u, 0, 1));
  const drift = new Vector3(
    Math.sin(modeTime * 0.21) * 2.4,
    Math.sin(modeTime * 0.13) * 1.1 + 1.6,
    Math.cos(modeTime * 0.17) * 1.8,
  );
  camera.position.copy(base).add(drift);
  const lookBase = curve.getPointAt(MathUtils.clamp(u + 0.06, 0, 1));
  camera.lookAt(lookBase.clone().add(new Vector3(drift.x * 0.4, drift.y * 0.4 - 1.2, 0)));
}
