import { CatmullRomCurve3, Vector3 } from 'three';
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
import { createMusicTime } from '../../engine/music-time';

// Skyhook is 30 bars at 120 BPM: a clean one-minute ascent with a four-bar
// docking coda. The score and the spawn sheet both use these same markers.
export const SKYHOOK_V01U_BPM = 120;
export const SKYHOOK_V01U_STEPS_PER_BAR = 16;
export const SKYHOOK_V01U_TIME = createMusicTime(SKYHOOK_V01U_BPM, { stepsPerBar: SKYHOOK_V01U_STEPS_PER_BAR });
export const SKYHOOK_V01U_BARS = {
  storm: 0,
  cloudDeck: 5,
  stratosphere: 11,
  edge: 17,
  boss: 22,
  docking: 28,
  end: 30,
} as const;
export const SKYHOOK_V01U_MARKERS = SKYHOOK_V01U_TIME.markers({
  storm: SKYHOOK_V01U_BARS.storm,
  cloudDeck: SKYHOOK_V01U_BARS.cloudDeck,
  stratosphere: SKYHOOK_V01U_BARS.stratosphere,
  edge: SKYHOOK_V01U_BARS.edge,
  boss: SKYHOOK_V01U_BARS.boss,
  docking: SKYHOOK_V01U_BARS.docking,
  end: SKYHOOK_V01U_BARS.end,
});
export const SKYHOOK_V01U_RUN_DURATION = SKYHOOK_V01U_MARKERS.end;
export const SKYHOOK_V01U_PLAYER_HEALTH = 4;

export type SkyhookV01uEnemyKind = 'gust' | 'skiff' | 'carclaw' | 'needle' | 'voidling' | 'bolt' | 'skyhook';
export type SkyhookV01uMotion = 'sweep' | 'bank' | 'orbit' | 'plunge';

export type SkyhookV01uSpawnData =
  | {
    role: 'wave';
    lead: number;
    offset: Vector3;
    motion: SkyhookV01uMotion;
    phase: number;
  }
  | {
    role: 'carclaw';
    lead: number;
    offset: Vector3;
    attackAt: number;
  }
  | {
    role: 'needle';
    lead: number;
    offset: Vector3;
    fireDelay: number;
  }
  | {
    role: 'bolt';
    position: Vector3;
    velocity: Vector3;
    lastAge: number;
    impact: HostileShotImpactState;
  }
  | {
    role: 'boss';
    lead: number;
    phase: number;
  };

export type SkyhookV01uSpawnEntry = LockOnSpawnEntry<SkyhookV01uEnemyKind, SkyhookV01uSpawnData>;
export type SkyhookV01uUpdate = LockOnEnemyUpdate<SkyhookV01uEnemyKind, SkyhookV01uSpawnData>;

// The car accelerates through the deck, then coasts into the station. The
// profile is an integral, so the camera's distance along the elevator is
// still monotonic while the surges have a visible physical consequence.
const SPEED_KEYS: Array<[number, number]> = [
  [SKYHOOK_V01U_TIME.bar(0), 0.62],
  [SKYHOOK_V01U_TIME.bar(3), 0.88],
  [SKYHOOK_V01U_TIME.bar(5), 1.12],
  [SKYHOOK_V01U_TIME.bar(7), 1.42],
  [SKYHOOK_V01U_TIME.bar(9), 1.0],
  [SKYHOOK_V01U_TIME.bar(11), 1.34],
  [SKYHOOK_V01U_TIME.bar(14), 1.12],
  [SKYHOOK_V01U_TIME.bar(17), 0.92],
  [SKYHOOK_V01U_TIME.bar(20), 1.18],
  [SKYHOOK_V01U_TIME.bar(22), 0.78],
  [SKYHOOK_V01U_TIME.bar(24), 0.92],
  [SKYHOOK_V01U_TIME.bar(28), 0.5],
  [SKYHOOK_V01U_TIME.bar(30), 0.28],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_V01U_RUN_DURATION);
export const skyhookSpeedFactorAt = speedProfile.speedAt;
export const skyhookRunProgress = speedProfile.runProgress;

export function createSkyhookV01uRail() {
  // A long, slightly wandering elevator line. Y is the climb; Z gives the
  // car enough forward travel for clouds, debris, and the planet limb to read
  // as passing scenery instead of a moving backdrop.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(3, 2, -55),
      new Vector3(-5, 8, -110),
      new Vector3(6, 16, -165),
      new Vector3(-6, 27, -220),
      new Vector3(7, 40, -275),
      new Vector3(-5, 56, -330),
      new Vector3(6, 74, -385),
      new Vector3(-7, 94, -440),
      new Vector3(5, 116, -495),
      new Vector3(-4, 140, -550),
      new Vector3(6, 166, -605),
      new Vector3(-5, 194, -660),
      new Vector3(4, 224, -715),
      new Vector3(-3, 258, -770),
      new Vector3(0, 292, -825),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

// Seat ordinary targets a little nearer than the boss set piece. This keeps
// the average destruction distance intimate while the larger layout offsets
// make a full-screen sweep meaningful at the moment of impact.
const seatLead = (lead: number) => Math.max(2.8, lead - 0.85);
const spreadOffset = (x: number, y: number) => new Vector3(x * 1.8, y * 1.8, 0);

function wave(
  time: number,
  kind: Extract<SkyhookV01uEnemyKind, 'gust' | 'skiff' | 'voidling'>,
  lead: number,
  motion: SkyhookV01uMotion,
  offsets: Array<[number, number]>,
  phase = 0,
): SkyhookV01uSpawnEntry[] {
  return offsets.map(([x, y], index) => ({
    time: time + index * 0.12,
    kind,
    data: {
      role: 'wave',
      lead: seatLead(lead),
      offset: spreadOffset(x, y),
      motion,
      phase: phase + index * 0.63,
    },
  }));
}

function carclaws(time: number, lead: number, offsets: Array<[number, number]>, attackAt = 4.1): SkyhookV01uSpawnEntry[] {
  return offsets.map(([x, y], index) => ({
    time: time + index * 0.22,
    kind: 'carclaw',
    data: {
      role: 'carclaw',
      lead: seatLead(lead),
      offset: spreadOffset(x, y),
      attackAt,
    },
  }));
}

function needles(time: number, lead: number, offsets: Array<[number, number]>, fireDelay = 1.4): SkyhookV01uSpawnEntry[] {
  return offsets.map(([x, y], index) => ({
    time: time + index * 0.16,
    kind: 'needle',
    data: {
      role: 'needle',
      lead: seatLead(lead),
      offset: spreadOffset(x, y),
      fireDelay: fireDelay + index * 0.12,
    },
  }));
}

function boss(time: number): SkyhookV01uSpawnEntry {
  return {
    time,
    kind: 'skyhook',
    hitStages: [2, 2, 2],
    data: { role: 'boss', lead: 14, phase: 0.4 },
  };
}

// The sheet has deliberate breaths at the cloud-deck punch, the black-sky
// reveal, and the docking phrase. Each family moves differently rather than
// becoming a palette swap of the same target.
export const SKYHOOK_V01U_SPAWN_TIMELINE: SkyhookV01uSpawnEntry[] = [
  // Weather: wide, generous sweeps through storm grey.
  ...wave(SKYHOOK_V01U_TIME.bar(1), 'gust', 3.8, 'sweep', [
    [-9, 2.4], [-5.2, 5.4], [-1.5, 1.2], [3.2, 5.6], [8.8, 2.2],
  ], 0.2),
  ...wave(SKYHOOK_V01U_TIME.bar(2, 1), 'skiff', 4.0, 'bank', [
    [-10, -2], [-6, 3.4], [0, 6.1], [6, 3.4], [10, -2],
  ], 1.1),
  ...wave(SKYHOOK_V01U_TIME.bar(3), 'gust', 3.7, 'sweep', [
    [-8.8, 5.6], [-4.4, 1.5], [0, -2.3], [4.8, 1.2], [9.2, 5.5],
  ], 2.2),
  ...carclaws(SKYHOOK_V01U_TIME.bar(3, 2.5), 4.3, [[-8.4, 6.7]]),
  ...wave(SKYHOOK_V01U_TIME.bar(4), 'skiff', 4.1, 'bank', [
    [-9.2, 0.3], [-5.7, 4.7], [-1.8, 7.2], [3.4, 4.8], [8.7, 0.1],
  ], 0.8),

  // Cloud deck: the car surges, clouds peel off the screen, and the first
  // dedicated car attackers make the elevator itself feel vulnerable.
  ...wave(SKYHOOK_V01U_TIME.bar(5, 1), 'gust', 3.6, 'sweep', [
    [-10.5, 2.1], [-6.1, 6.2], [-2.1, 3.1], [2.4, 6.1], [6.7, 2.7], [10.2, -1],
  ], 1.5),
  ...carclaws(SKYHOOK_V01U_TIME.bar(6, 0.5), 4.0, [[-7.5, 6.5], [7.5, 6.5]]),
  ...wave(SKYHOOK_V01U_TIME.bar(7), 'skiff', 4.0, 'bank', [
    [-10.2, -1], [-5.3, 3.6], [0, 6.6], [5.3, 3.4], [10.1, -1.2],
  ], 2.5),
  ...wave(SKYHOOK_V01U_TIME.bar(8, 1), 'gust', 3.8, 'sweep', [
    [-9.8, 5.5], [-6, 0.4], [-2.4, 3.5], [2.2, -1.7], [6.3, 3.7], [10, 5.1],
  ], 0.3),
  ...carclaws(SKYHOOK_V01U_TIME.bar(9, 0.25), 4.2, [[-8.8, 6.8], [8.8, 6.8]]),
  ...wave(SKYHOOK_V01U_TIME.bar(10), 'skiff', 3.7, 'bank', [
    [-10.3, 1], [-6.2, 5.2], [-2.1, -1.3], [3.2, 5.4], [7.4, 0.8], [10.4, 4.8],
  ], 1.7),

  // Stratosphere: vacuum-hardened needles and orbiting voidlings trade the
  // broad cloud choreography for vertical pressure and interceptable bolts.
  ...wave(SKYHOOK_V01U_TIME.bar(11, 1), 'voidling', 4.0, 'orbit', [
    [-9.2, 5.1], [-4.8, -1.4], [0, 6.8], [5.1, -1.1], [9.5, 5.2],
  ], 0.4),
  ...needles(SKYHOOK_V01U_TIME.bar(12), 4.2, [[-7.4, 5.5], [0, -1.8], [7.5, 5.2]], 1.45),
  ...carclaws(SKYHOOK_V01U_TIME.bar(13, 0.5), 4.0, [[-8.5, 6.4], [8.5, 6.4]], 3.7),
  ...wave(SKYHOOK_V01U_TIME.bar(14), 'voidling', 3.9, 'orbit', [
    [-10.2, 0], [-5.7, 5.8], [-1.5, -2.2], [4.1, 5.7], [9.6, 0.2],
  ], 2.1),
  ...needles(SKYHOOK_V01U_TIME.bar(15, 0.5), 4.1, [[-8.9, 4.8], [-3.2, -1.2], [3.5, 6.4], [9, 0.6]], 1.25),
  ...wave(SKYHOOK_V01U_TIME.bar(16, 1), 'voidling', 3.7, 'plunge', [
    [-8.8, 6.1], [-4, 2], [0, -2.5], [4.3, 2.4], [9, 6],
  ], 0.7),

  // Edge of atmosphere: less traffic, more negative space. The tether and
  // planet limb get to be seen before the boss owns the frame.
  ...wave(SKYHOOK_V01U_TIME.bar(17, 0.5), 'voidling', 4.0, 'orbit', [
    [-10.5, 4.7], [-5.6, -1.4], [0, 6.8], [5.8, -1.2], [10.4, 4.7],
  ], 1.4),
  ...needles(SKYHOOK_V01U_TIME.bar(18), 4.0, [[-8.4, 5.5], [8.5, 5.4]], 1.55),
  ...carclaws(SKYHOOK_V01U_TIME.bar(18, 2.5), 4.1, [[0, 7.2]], 3.9),
  ...wave(SKYHOOK_V01U_TIME.bar(19, 1), 'voidling', 3.8, 'plunge', [
    [-9.5, 5.8], [-4.1, 0], [1.3, 6.4], [7.2, 0.6],
  ], 2.8),
  ...needles(SKYHOOK_V01U_TIME.bar(20, 0.5), 3.9, [[-9.6, -1.1], [-4.4, 5.8], [4.5, 6], [9.5, -0.7]], 1.2),
  ...carclaws(SKYHOOK_V01U_TIME.bar(21, 0.5), 3.8, [[-8.7, 6.8], [8.7, 6.8]], 3.4),

  // Boss entrance at bar 22. The last two bars before it are intentionally
  // empty: black sky, stars, and a small hook silhouette get the reveal.
  boss(SKYHOOK_V01U_TIME.bar(SKYHOOK_V01U_BARS.boss)),
  ...wave(SKYHOOK_V01U_TIME.bar(23, 1), 'voidling', 3.5, 'orbit', [[-9, 5.5], [9, 5.5]], 0.2),
  ...needles(SKYHOOK_V01U_TIME.bar(24), 3.7, [[-8.7, -0.8], [8.8, 5.8]], 1.3),
  ...carclaws(SKYHOOK_V01U_TIME.bar(24, 2.5), 3.8, [[-8.7, 6.5], [8.7, 6.5]], 3.6),
  ...wave(SKYHOOK_V01U_TIME.bar(25, 1), 'voidling', 3.5, 'plunge', [[-7.5, 5.8], [0, -1.8], [7.5, 5.8]], 1.8),
  // Bars 26–27 are the boss's clear approach window. Once the Skyhook is
  // severed, no late add survives into the station docking phrase.
].sort((a, b) => a.time - b.time);

const KILL_SCORE: Record<SkyhookV01uEnemyKind, number> = {
  gust: 105,
  skiff: 135,
  carclaw: 230,
  needle: 185,
  voidling: 205,
  bolt: 45,
  skyhook: 2400,
};

const BOLT_MAX_AGE = 10.5;

export function createSkyhookV01uGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookV01uEnemyKind, SkyhookV01uSpawnData> {
  const boltInterceptions = new Set<number>();
  let bossId = -1;
  let bossKilled = false;
  let hitsTaken = 0;
  let bossPhase = 'unseen';

  bus.on('runstart', () => {
    boltInterceptions.clear();
    bossId = -1;
    bossKilled = false;
    hitsTaken = 0;
    bossPhase = 'unseen';
  });
  bus.on('playerhit', () => { hitsTaken += 1; });
  bus.on('fire', ({ enemyId }) => { boltInterceptions.add(enemyId); });
  bus.on('kill', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
    if (enemyId === bossId) {
      bossKilled = true;
      bossPhase = 'destroyed';
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('miss', ({ enemyId }) => { boltInterceptions.delete(enemyId); });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'skyhook') {
      bossId = enemyId;
      bossPhase = 'summoned';
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });
  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (enemyId === bossId && stageIndex === 1 && bossPhase !== 'exposed') {
      bossPhase = 'exposed';
      bus.emit('bossphase', { phase: 'exposed' });
    }
  });

  function fireBolt(context: SkyhookV01uUpdate, from: Vector3) {
    const velocity = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity, lastAge: 0, impact: {} },
    });
  }

  function updateWave(context: SkyhookV01uUpdate, data: Extract<SkyhookV01uSpawnData, { role: 'wave' }>) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const offset = data.offset.clone();
    if (data.motion === 'sweep') {
      offset.x += Math.sin(age * 1.5 + data.phase) * 1.2 + age * 0.18 * Math.sign(Math.sin(data.phase + 0.3));
      offset.y += Math.cos(age * 1.1 + data.phase) * 0.65;
      offset.z = Math.sin(age * 1.8 + data.phase) * 0.8;
    } else if (data.motion === 'bank') {
      offset.x += Math.sin(age * 1.15 + data.phase) * 1.3;
      offset.y += Math.sin(age * 1.9 + data.phase) * 0.55;
      offset.z = Math.cos(age * 1.35 + data.phase) * 1.5;
    } else if (data.motion === 'orbit') {
      const radius = 1.4 + Math.sin(age * 1.5 + data.phase) * 0.35;
      offset.x += Math.cos(age * 2.25 + data.phase) * radius;
      offset.y += Math.sin(age * 2.25 + data.phase) * radius;
      offset.z = Math.sin(age * 2.9 + data.phase) * 0.9;
    } else {
      offset.x += Math.sin(age * 1.8 + data.phase) * 0.75;
      offset.y -= age * 0.95;
      offset.z = Math.cos(age * 2.1 + data.phase) * 1.1;
    }

    const anchorU = railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.phase + runTime * (enemy.kind === 'voidling' ? -0.9 : 0.65));
    enemy.mesh.rotateX(Math.sin(age * 0.8 + data.phase) * 0.25);
    return runProgress > anchorU + 0.022;
  }

  function updateCarclaw(context: SkyhookV01uUpdate, data: Extract<SkyhookV01uSpawnData, { role: 'carclaw' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor, damagePlayer } = context;
    const state = context.enemyState(() => ({ attacked: false }));
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 1.2 + enemy.id) * 0.65;
    offset.y -= Math.min(2.8, age * 0.72);
    offset.z = Math.sin(age * 1.7 + enemy.id) * 0.6;
    // The clamp creeps down the tether instead of simply waiting at a fixed
    // anchor, so the player can read which target is threatening the car.
    const anchorU = railAnchor(Math.max(1.1, data.lead - age * 0.12));
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 2.2 + enemy.id) * 0.25);
    enemy.mesh.rotateY(Math.cos(age * 1.3 + enemy.id) * 0.18);

    if (!state.attacked && age >= data.attackAt) {
      state.attacked = true;
      damagePlayer(1);
    }
    return runProgress > anchorU + 0.024 || age > data.lead + 0.7;
  }

  function updateNeedle(context: SkyhookV01uUpdate, data: Extract<SkyhookV01uSpawnData, { role: 'needle' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const state = context.enemyState(() => ({ fired: false }));
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 1.1 + enemy.id) * 0.55;
    offset.y += Math.cos(age * 1.7 + enemy.id) * 0.45;
    offset.z = Math.sin(age * 2.1 + enemy.id) * 0.8;
    const anchorU = railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.8 + enemy.id) * 0.18);
    enemy.mesh.rotateX(age * 1.4);
    if (!state.fired && age >= data.fireDelay) {
      state.fired = true;
      fireBolt(context, enemy.mesh.position);
    }
    return runProgress > anchorU + 0.022;
  }

  function updateBoss(context: SkyhookV01uUpdate, data: Extract<SkyhookV01uSpawnData, { role: 'boss' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor, damagePlayer } = context;
    const state = context.enemyState(() => ({ damagedCar: false }));
    // Fourteen seconds of authored approach: the hook starts high above the
    // car and closes just enough each second to become physically enormous.
    const closingLead = Math.max(0.9, data.lead - age * 0.15);
    const offset = new Vector3(
      Math.sin(age * 0.45 + data.phase) * 2.3,
      3.2 + Math.sin(age * 0.8) * 0.7,
      Math.cos(age * 0.6) * 1.6,
    );
    const anchorU = railAnchor(closingLead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 0.18);
    enemy.mesh.rotateX(Math.sin(age * 0.4) * 0.08);

    if (!state.damagedCar && age >= 12.2) {
      state.damagedCar = true;
      damagePlayer(2);
    }
    // It reaches the carriage at the end of the boss phrase. If it was not
    // destroyed, this miss is the boss tearing its way past the camera.
    return age > 13.9;
  }

  function updateBolt(context: SkyhookV01uUpdate, data: Extract<SkyhookV01uSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: boltInterceptions.delete(enemy.id),
      config: { hitDistance: 2.2, impactBrake: 0.32, damageDistance: 0.58 },
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
      baseSpeed: 5.5,
      maxSpeed: 13.5,
      accel: 3.4,
      turnRate: 2.5,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 4.2);
    return shotBehindCamera(camera, data.position, 4) || age > BOLT_MAX_AGE;
  }

  return {
    duration: SKYHOOK_V01U_RUN_DURATION,
    bpm: SKYHOOK_V01U_BPM,
    playerHealth: SKYHOOK_V01U_PLAYER_HEALTH,
    createRail: createSkyhookV01uRail,
    spawnTimeline: SKYHOOK_V01U_SPAWN_TIMELINE,
    easeRunProgress: skyhookRunProgress,
    scoreForHit: (_volleySize, enemy) => enemy.kind === 'skyhook' ? 120 : 42,
    scoreForKill(volleySize, enemy) {
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.14));
    },
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      return kills >= 4 && kills === results.length ? 180 + kills * 24 : 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies > 0 ? kills / totalEnemies : 0;
      if (bossKilled && score >= 13500 && clearRate >= 0.82) return 'S';
      if (bossKilled && score >= 9200 && clearRate >= 0.62) return 'A';
      if (score >= 6100 && clearRate >= 0.45) return 'B';
      if (score >= 2800 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_V01U_PLAYER_HEALTH - hitsTaken);
      const bossDetail = bossKilled ? 'Skyhook severed' : bossPhase === 'summoned' || bossPhase === 'exposed' ? 'Skyhook reached the carriage' : 'Skyhook not reached';
      return [`Car hull ${hull}/${SKYHOOK_V01U_PLAYER_HEALTH}`, bossDetail, 'Docking sequence armed'];
    },
    updateEnemy(context: SkyhookV01uUpdate) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave': return updateWave(context, data);
        case 'carclaw': return updateCarclaw(context, data);
        case 'needle': return updateNeedle(context, data);
        case 'bolt': return updateBolt(context, data);
        case 'boss': return updateBoss(context, data);
      }
    },
  } satisfies LockOnRunnerLevel<SkyhookV01uEnemyKind, SkyhookV01uSpawnData>;
}
