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
import { createMatriarch, createMatriarchEntries } from './matriarch';
import { CROWN_TIME, STRANDLINE_BPM, STRANDLINE_DURATION, bar } from './timing';

// STRANDLINE — 60 seconds inside the trailing tentacles of a gigantic
// jellyfish, freeing it from an infestation:
//
//   Drift   (bars 0–4)    Sunlit water, glowing strands, the first leeches
//                         letting go of the tentacles to meet you.
//   Bloom   (bars 4–8)    The forest thickens; mites flit between the strands.
//   Reveal  (bars 8–10)   The rail swings wide of the forest and for six
//                         seconds the bell fills the view like a green moon.
//   Deep    (bars 10–15)  Back into the strands: spitters, venom, cysts.
//   Crown   (bars 15–22)  Where the strands root into the bell, the Matriarch
//                         waits behind her own webbing and pumps out broods.
//   Serene  (bars 22–24)  The camera falls away; the whole animal, glowing
//                         clean, drifts on.

export {
  CROWN_TIME,
  REVEAL_TIME,
  SERENE_TIME,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  bar,
} from './timing';

export const STRANDLINE_PLAYER_HEALTH = 3;

// ---- rail geometry ---------------------------------------------------------

// The rail threads the strand forest, climbing gently toward the crown, with
// two authored swings: wide right for the bar-8 bell reveal, and out past the
// crown for the final pull-away. The bell hangs over the crown at the far end.
const RAIL_POINTS: Array<[number, number, number]> = [
  [0, -32, 0],
  [-14, -30, -46],
  [13, -27, -95],
  [-18, -24, -142],
  [6, -21, -186],
  [36, -17, -230], // reveal: swing wide, the forest opens
  [32, -14, -270],
  [-8, -11, -312],
  [14, -8, -352],
  [-12, -4, -392],
  [-2, 0, -428], // crown approach
  [4, 3, -458],
  [34, -3, -492], // the rail lets go of the animal
  [72, -14, -516],
  [104, -24, -528],
];

export function createStrandlineRail() {
  return new CatmullRomCurve3(
    RAIL_POINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'catmullrom',
    0.4,
  );
}

// The bell: one world-space anchor shared by gameplay, visuals, and the
// finale camera. The crown (where the Matriarch grips) sits on its underside.
export const BELL_CENTER = new Vector3(-6, 42, -462);
export const BELL_RADIUS = 85;

// ---- speed profile → rail easing -------------------------------------------

// Ease out of the first strands, glide through the reveal, push through the
// deep forest, then bleed speed away as the animal is freed.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.62],
  [bar(2), 0.8],
  [bar(4), 0.98],
  [bar(7.4), 0.82],
  [bar(8.4), 0.68],
  [bar(9.6), 0.85],
  [bar(11), 1.14],
  [bar(14), 1.16],
  [bar(15.5), 0.95],
  [bar(20), 0.9],
  [bar(22), 0.56],
  [bar(23), 0.36],
  [bar(24), 0.28],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => strandlineRunProgress(time);

// ---- spawn data -------------------------------------------------------------

export type StrandlineEnemyKind =
  | 'leech'
  | 'mite'
  | 'spitter'
  | 'cyst'
  | 'bolt'
  | 'brood'
  | 'matriarch';

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in enemyState bags; boss state lives in the
// matriarch module; dynamically spawned bolts get fresh data objects.
export type StrandlineSpawnData =
  | { role: 'leech'; lead: number; fromX: number; fromY: number; toX: number; toY: number; clampFor: number; crossTime: number }
  | { role: 'mite'; lead: number; fromX: number; fromY: number; toX: number; toY: number; delay: number; crossTime: number; wiggle: number }
  | { role: 'spitter'; lead: number; x: number; y: number; seed: number }
  | { role: 'cyst'; lead: number; x: number; y: number; seed: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'brood'; wave: number; slot: number; holdX: number; holdY: number }
  | { role: 'matriarch' };

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

// ---- spawn timeline ----------------------------------------------------------

// Leeches start clamped to a strand, then let go and swim across the view.
const leeches = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; fromY: number; toX: number; toY: number; clampFor?: number; crossTime?: number }>,
): StrandlineSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.14,
    kind: 'leech',
    data: {
      role: 'leech',
      lead,
      fromX: run.fromX,
      fromY: run.fromY,
      toX: run.toX,
      toY: run.toY,
      clampFor: run.clampFor ?? 1.1 + index * 0.42,
      crossTime: run.crossTime ?? 3.1,
    },
  }));

const mites = (
  time: number,
  lead: number,
  darts: Array<{ fromX: number; fromY: number; toX: number; toY: number }>,
): StrandlineSpawnEntry[] =>
  darts.map((dart, index) => ({
    time: time + index * 0.12,
    kind: 'mite',
    data: {
      role: 'mite',
      lead,
      fromX: dart.fromX,
      fromY: dart.fromY,
      toX: dart.toX,
      toY: dart.toY,
      delay: index * 0.3,
      crossTime: 2.2,
      wiggle: 1.1 + (index % 3) * 0.5,
    },
  }));

const spitters = (time: number, lead: number, posts: Array<[number, number]>): StrandlineSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.24,
    kind: 'spitter',
    data: { role: 'spitter', lead, x, y, seed: index * 2.31 + time },
  }));

const cysts = (time: number, lead: number, spots: Array<[number, number]>): StrandlineSpawnEntry[] =>
  spots.map(([x, y], index) => ({
    time: time + index * 0.2,
    kind: 'cyst',
    hitPoints: 2,
    data: { role: 'cyst', lead, x, y, seed: index * 1.73 + time },
  }));

function buildTimeline(matriarchEntries: StrandlineSpawnEntry[]): StrandlineSpawnEntry[] {
  return [
    // --- Drift: sparse leeches letting go of the strands, wide and slow.
    ...leeches(bar(0.75), 4.4, [
      { fromX: -16, fromY: 5, toX: 18, toY: -3 },
      { fromX: 14, fromY: -6, toX: -16, toY: 6 },
    ]),
    ...leeches(bar(2), 4.4, [
      { fromX: 20, fromY: 8, toX: -20, toY: -2 },
      { fromX: -19, fromY: -7, toX: 17, toY: 9 },
    ]),
    ...leeches(bar(3), 4.2, [
      { fromX: -22, fromY: 2, toX: 20, toY: 10, crossTime: 2.8 },
      { fromX: 21, fromY: 11, toX: -18, toY: -6, crossTime: 2.8 },
    ]),

    // --- Bloom: the forest thickens; mites flit between the strands.
    ...leeches(bar(4.2), 4.0, [
      { fromX: -20, fromY: 9, toX: 22, toY: -4 },
      { fromX: 18, fromY: -8, toX: -21, toY: 3 },
      { fromX: -15, fromY: -4, toX: 16, toY: 11 },
    ]),
    ...mites(bar(5.1), 3.7, [
      { fromX: -26, fromY: -9, toX: 26, toY: 8 },
      { fromX: 26, fromY: -4, toX: -26, toY: 10 },
      { fromX: -26, fromY: 11, toX: 26, toY: -6 },
      { fromX: 26, fromY: 7, toX: -26, toY: -9 },
    ]),
    ...leeches(bar(6.1), 3.8, [
      { fromX: 22, fromY: 3, toX: -20, toY: 10, clampFor: 0.8 },
      { fromX: -21, fromY: 10, toX: 19, toY: -7, clampFor: 1.2 },
    ]),
    ...mites(bar(6.8), 3.6, [
      { fromX: -26, fromY: 2, toX: 26, toY: 12 },
      { fromX: 26, fromY: 12, toX: -26, toY: -3 },
      { fromX: -26, fromY: -8, toX: 26, toY: 1 },
    ]),

    // (bars 7.4–8.5 kept clear: the forest opens and the bell takes the frame)

    // --- Reveal: two slow silhouettes crossing beneath the bell.
    ...leeches(bar(8.6), 4.6, [
      { fromX: -24, fromY: -2, toX: 22, toY: 8, clampFor: 0.4, crossTime: 3.8 },
      { fromX: 23, fromY: 10, toX: -22, toY: -1, clampFor: 0.9, crossTime: 3.8 },
    ]),

    // --- Deep strands: full pressure. Venom arrives.
    ...spitters(bar(10.1), 4.2, [[-13, 7], [12, -3]]),
    ...mites(bar(10.7), 3.5, [
      { fromX: 26, fromY: 9, toX: -26, toY: -5 },
      { fromX: -26, fromY: -7, toX: 26, toY: 10 },
      { fromX: 26, fromY: -2, toX: -26, toY: 12 },
      { fromX: -26, fromY: 12, toX: 26, toY: -8 },
    ]),
    ...cysts(bar(11.3), 4.4, [[-19, 3], [20, 8]]),
    ...leeches(bar(11.9), 3.6, [
      { fromX: -20, fromY: 6, toX: 21, toY: -5, clampFor: 0.7, crossTime: 2.6 },
      { fromX: 19, fromY: -7, toX: -20, toY: 9, clampFor: 1.0, crossTime: 2.6 },
      { fromX: -16, fromY: 12, toX: 18, toY: 2, clampFor: 1.3, crossTime: 2.6 },
    ]),
    ...spitters(bar(12.6), 3.9, [[9, 11], [-9, -6]]),
    ...mites(bar(13.1), 3.4, [
      { fromX: -26, fromY: 4, toX: 26, toY: -7 },
      { fromX: 26, fromY: -8, toX: -26, toY: 6 },
      { fromX: -26, fromY: -2, toX: 26, toY: 12 },
      { fromX: 26, fromY: 11, toX: -26, toY: 1 },
    ]),
    ...cysts(bar(13.5), 4.0, [[15, -2], [-14, 10]]),
    ...leeches(bar(14.1), 3.4, [
      { fromX: 22, fromY: 5, toX: -20, toY: -4, clampFor: 0.5, crossTime: 2.4 },
      { fromX: -21, fromY: -3, toX: 20, toY: 10, clampFor: 0.8, crossTime: 2.4 },
      { fromX: 17, fromY: 12, toX: -18, toY: 4, clampFor: 1.1, crossTime: 2.4 },
    ]),

    // --- Crown: the Matriarch, her webbing, and the broods that feed it.
    ...matriarchEntries,
    ...spitters(bar(18.6), 4.6, [[-15, 3], [14, 9]]),
    ...mites(bar(20.1), 4.0, [
      { fromX: -26, fromY: 8, toX: 26, toY: -4 },
      { fromX: 26, fromY: -6, toX: -26, toY: 9 },
      { fromX: -26, fromY: 1, toX: 26, toY: 11 },
    ]),

    // (bars 22–24: the serene coda. Nothing spawns; the animal is the payoff.)
  ];
}

export function createStrandlineTimeline() {
  const entries = createMatriarchEntries(CROWN_TIME);
  return {
    matriarchEntry: entries.matriarchEntry,
    broodEntries: entries.broodEntries,
    timeline: buildTimeline(entries.timeline).sort((a, b) => a.time - b.time),
  };
}

const KILL_SCORE: Record<StrandlineEnemyKind, number> = {
  leech: 100,
  mite: 120,
  spitter: 220,
  cyst: 280,
  bolt: 40,
  brood: 260,
  matriarch: 2600,
};

const BOLT_MAX_AGE = 12;

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  const { timeline, matriarchEntry, broodEntries } = createStrandlineTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let boltsShot = 0;

  bus.on('runstart', () => {
    interceptions.clear();
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
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  function spitBolt(context: StrandlineUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const matriarch = createMatriarch(bus, {
    matriarchEntry,
    broodEntries,
    crownU: () => strandlineRunProgress(bar(21.9)),
  });

  // ---- movement ----------------------------------------------------------------

  function updateLeech(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'leech' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + 0.012) return true;

    if (age < data.clampFor) {
      // Clamped to a strand: a slow feeding pulse, drip of stolen light.
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.fromX, data.fromY, 0)));
      enemy.mesh.position.y += Math.sin(age * 2.4 + enemy.id) * 0.2;
      enemy.mesh.quaternion.copy(context.camera.quaternion);
      enemy.mesh.rotation.z = Math.sin(age * 1.6 + enemy.id) * 0.2;
      enemy.mesh.userData.clamped = true;
      return false;
    }

    // Detached: an undulating crossing, banking with its own swim stroke.
    const t = (age - data.clampFor) / data.crossTime;
    if (t > 1.25) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = MathUtils.lerp(data.fromY, data.toY, eased) + Math.sin(clamped * Math.PI * 3 + enemy.id) * 1.6;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.06)),
      MathUtils.lerp(data.fromY, data.toY, Math.min(1, eased + 0.06)),
      0,
    ));
    enemy.mesh.lookAt(ahead);
    // The swim stroke itself: the whole body flexes as it pulls water.
    enemy.mesh.rotation.z += Math.sin(age * 7 + enemy.id) * 0.5;
    enemy.mesh.userData.clamped = false;
    enemy.mesh.userData.stroke = Math.sin(age * 7 + enemy.id);
    return false;
  }

  function updateMite(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'mite' }>) {
    const { enemy, runProgress, age, curve, railAnchor, camera } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.2 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    // Darting: stepwise jerks along the crossing, never a smooth glide.
    const jerks = 5;
    const stepped = (Math.floor(clamped * jerks) + Math.min(1, (clamped * jerks) % 1 * 2.6)) / jerks;
    const x = MathUtils.lerp(data.fromX, data.toX, stepped) + Math.sin(age * 11 + enemy.id * 2.3) * data.wiggle;
    const y = MathUtils.lerp(data.fromY, data.toY, stepped) + Math.cos(age * 9.4 + enemy.id) * data.wiggle;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotation.z = age * (2.8 + (enemy.id % 3));
    return false;
  }

  function updateSpitter(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'spitter' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ fireAt: 2.0 + (data.seed % 1.1) }));

    // Rises from the murk below its post, then station-keeps with a slow bob.
    const rise = MathUtils.clamp(age / 1.3, 0, 1);
    const y = MathUtils.lerp(data.y - 22, data.y, 1 - (1 - rise) ** 2.2) + Math.sin(age * 1.7 + data.seed) * 0.8;
    const x = data.x + Math.sin(age * 1.1 + data.seed * 3) * 1.2;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotation.z = Math.sin(age * 0.9 + data.seed) * 0.25;

    // Venom cadence with a readable swelling telegraph.
    const untilSpit = state.fireAt - age;
    enemy.mesh.userData.charge = untilSpit < 0.85 ? 1 - untilSpit / 0.85 : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 3.4;
      spitBolt(context, enemy.mesh.position);
    }
    return runProgress > anchorU + 0.012;
  }

  function updateCyst(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'cyst' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Rooted where it grips a strand; only its feeding pulse moves it.
    const swell = 1 + Math.sin(age * 2.1 + data.seed) * 0.05;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x, data.y + Math.sin(age * 1.2 + data.seed) * 0.4, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotation.z = data.seed + Math.sin(age * 0.8) * 0.1;
    enemy.mesh.userData.swell = swell;
    if (enemy.hitPointsRemaining < 2) enemy.mesh.userData.cracked = true;
    return runProgress > anchorU + 0.012;
  }

  function updateBolt(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'bolt' }>) {
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
      enemy.mesh.rotation.z = age * 6;
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Venom swims, it does not fly: slow, heavy, wavering.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.6,
      maxSpeed: 10,
      accel: 2.4,
      turnRate: 2.2,
    });
    data.position.y += Math.sin(age * 5 + enemy.id) * dt * 1.4;
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ----------------------------------------------------------

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'leech':
          return updateLeech(context, data);
        case 'mite':
          return updateMite(context, data);
        case 'spitter':
          return updateSpitter(context, data);
        case 'cyst':
          return updateCyst(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'brood':
          return matriarch.updateBrood(context, data);
        case 'matriarch':
          return matriarch.updateMatriarch(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsShot += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Cracking a cyst shell or chipping the Matriarch pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (matriarch.matriarchKilled() && score >= 12500 && clearRate >= 0.92) return 'S';
      if (score >= 10000 && clearRate >= 0.66) return 'A';
      if (score >= 5600 && clearRate >= 0.4) return 'B';
      if (score >= 2200 && clearRate >= 0.18) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${STRANDLINE_PLAYER_HEALTH}`];
      const broods = matriarch.broodsKilled();
      if (broods > 0) lines.push(`${broods}/6 broods cleared from the crown`);
      if (boltsShot > 0) lines.push(`${boltsShot} venom bolt${boltsShot === 1 ? '' : 's'} burst mid-water`);
      const bossLine = matriarch.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
