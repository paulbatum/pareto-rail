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
// jellyfish, burning a parasite infestation off it strand by strand:
//
//   Drift   (bars 0–4)    Entering the forest of strands. First cysts peel off.
//   Forest  (bars 4–10)   Banking between strands; lashers and spitters wake.
//   Reveal  (bars 10–13)  The curve slings wide — the bell fills the view like
//                         a green moon — then the rail dives back in.
//   Thick   (bars 13–17)  The densest infestation, deep in the strands.
//   Crown   (bars 17–22)  The Matriarch, dug in where the strands root into
//                         the bell, behind webbing fed by its broods.
//   Release (bars 22–24)  The animal, whole and clean, drifting on.

export {
  CROWN_TIME,
  RELEASE_TIME,
  REVEAL_TIME,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  THICK_TIME,
  bar,
} from './timing';

export const STRANDLINE_PLAYER_HEALTH = 3;

// ---- the animal -------------------------------------------------------------

// The jellyfish owns the world: one vertical axis, the bell high above, the
// strands trailing far below it. Everything — rail, scenery, boss — is placed
// around this skeleton.
export const BELL_CENTER = new Vector3(0, 94, 0);
export const BELL_RADIUS = 62;
export const BELL_SQUASH = 0.62;
export const STRAND_TOP_Y = 88;
export const STRAND_BOTTOM_Y = -66;
export const CROWN_POINT = new Vector3(0, 76, 0);

export function polarPoint(angleDeg: number, radius: number, y: number) {
  const angle = MathUtils.degToRad(angleDeg);
  return new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

// ---- rail -------------------------------------------------------------------

// The rail climbs the animal in four movements. A spiral only ever looks
// tangentially, so both set pieces are authored as straight aimed runs:
//
//   1. Forest spiral — rising weave among the strand tips; radius oscillation
//      is the banking around the strands.
//   2. The reveal — swing wide, then a radial strafe straight AT the animal:
//      for a few seconds heading and pitch line up with the bell, it fills
//      the upper frame, and the rail flies the cleared aisle under it.
//   3. Second forest stretch — bank away, dip back into the strands.
//   4. The crown ascent — one long straight climb aimed just under the crown,
//      so the Matriarch holds steady in the upper-center for the whole fight.
const RAIL_POINTS: Vector3[] = [
  // 1 — forest spiral
  ...([
    [0, 46, -48],
    [28, 36, -43],
    [58, 46, -38],
    [88, 32, -33],
    [118, 44, -28],
    [150, 32, -23],
    [182, 44, -18],
    [214, 33, -13],
    [244, 40, -8],
    [258, 56, -6],
    [272, 76, 2],
    [286, 92, 12],
  ] as Array<[number, number, number]>).map(([deg, radius, y]) => polarPoint(deg, radius, y)),
  // 2 — the strafe: radial run at the animal, climbing
  new Vector3(18, 20, -62),
  new Vector3(8, 28, -34),
  // bank away under the bell
  new Vector3(-7, 33, -14),
  new Vector3(-22, 37, 2),
  // 3 — second forest stretch, dipping back among the strands
  new Vector3(-36, 32, -16),
  new Vector3(-24, 29, -38),
  // 4 — the crown ascent: one long straight climb, boss dead ahead and above
  new Vector3(-13, 29, -56),
  new Vector3(-11, 33, -50),
  new Vector3(-9, 38, -43),
  new Vector3(-7, 43, -37),
  new Vector3(-5, 48, -30),
  new Vector3(-4, 53, -24),
  new Vector3(-2, 58, -17),
  new Vector3(-1, 61, -12),
  new Vector3(0, 63, -6),
];

export function createStrandlineRail() {
  return new CatmullRomCurve3(RAIL_POINTS, false, 'catmullrom', 0.4);
}

// ---- speed profile → rail easing --------------------------------------------

// Slow drift in, cruising through the forest, one surge across the open water
// of the reveal, then a decelerating climb that all but stops under the crown.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.75],
  [bar(3), 1.05],
  [bar(9.5), 1.1],
  [bar(10.5), 1.55],
  [bar(12.5), 1.45],
  [bar(13.5), 1.15],
  [bar(16.5), 1.05],
  [bar(17.5), 0.75],
  [bar(19), 0.62],
  [bar(21), 0.5],
  [bar(22.5), 0.4],
  [bar(24), 0.3],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- spawn data -------------------------------------------------------------

export type StrandlineEnemyKind =
  | 'cyst'
  | 'lasher'
  | 'spitter'
  | 'venom'
  | 'brood'
  | 'matriarch';

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in enemyState bags; boss state lives in the
// matriarch module; dynamically spawned venom globs get fresh data objects.
export type StrandlineSpawnData =
  | { role: 'cyst'; lead: number; x: number; y: number; drop: number; sway: number }
  | { role: 'lasher'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'spitter'; lead: number; x: number; y: number; seed: number; firstShot: number }
  | { role: 'venom'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'brood'; wave: number; slot: number }
  | { role: 'matriarch' };

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

// ---- spawn timeline ---------------------------------------------------------

const cysts = (
  time: number,
  lead: number,
  pods: Array<{ x: number; y: number; drop?: number }>,
): StrandlineSpawnEntry[] =>
  pods.map((pod, index) => ({
    time: time + index * 0.16,
    kind: 'cyst',
    data: {
      role: 'cyst',
      lead,
      x: pod.x,
      y: pod.y,
      // Cap the hang height so a dropping cyst still starts on screen.
      drop: Math.min(pod.drop ?? 10 + (index % 3) * 4, 16 - pod.y),
      sway: 0.7 + (index % 4) * 0.35,
    },
  }));

const lashers = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): StrandlineSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.1,
    kind: 'lasher',
    data: {
      role: 'lasher',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.42,
      crossTime: run.crossTime ?? 3.1,
    },
  }));

const spitters = (time: number, lead: number, posts: Array<[number, number]>): StrandlineSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.24,
    kind: 'spitter',
    hitPoints: 2,
    data: { role: 'spitter', lead, x, y, seed: index * 2.71 + time, firstShot: 2.0 + index * 0.6 },
  }));

function buildTimeline(matriarchEntries: StrandlineSpawnEntry[]): StrandlineSpawnEntry[] {
  return [
    // --- Drift: the first cysts peel off the strands. Wide, calm, readable.
    ...cysts(bar(1), 4.6, [
      { x: -18, y: 8 },
      { x: 2, y: -7 },
      { x: 19, y: 4 },
    ]),
    ...lashers(bar(2.4), 4.4, [
      { fromX: -26, toX: 26, y: 2, arc: 3.4 },
      { fromX: 26, toX: -26, y: 9, arc: 2.2 },
    ]),
    ...cysts(bar(3.2), 4.2, [
      { x: -12, y: -10 },
      { x: 12, y: -9 },
      { x: 0, y: 12 },
    ]),

    // --- Forest: the colony defends itself in earnest.
    ...cysts(bar(4.2), 4.2, [
      { x: -21, y: 3 },
      { x: -8, y: 11 },
      { x: 8, y: 11 },
      { x: 21, y: 3 },
    ]),
    ...lashers(bar(5.4), 4.0, [
      { fromX: 27, toX: -27, y: -6, arc: 4.2, delay: 0 },
      { fromX: -27, toX: 27, y: 3, arc: 3.0, delay: 0.3 },
      { fromX: 27, toX: -27, y: 10.5, arc: 2.0, delay: 0.6 },
    ]),
    ...spitters(bar(6.1), 4.4, [[-14, 7]]),
    ...cysts(bar(7), 4.0, [
      { x: -22, y: -8 },
      { x: -11, y: -2 },
      { x: 0, y: 4 },
      { x: 11, y: -2 },
      { x: 22, y: -8 },
    ]),
    ...spitters(bar(8.2), 4.0, [[13, -4], [-4, 12]]),
    ...lashers(bar(8.6), 3.8, [
      { fromX: -27, toX: 27, y: 6.5, arc: 2.6 },
      { fromX: 27, toX: -27, y: -1, arc: 3.4 },
    ]),

    // (bars 9.4–10.2 kept clear: the slingshot starts and the bell arrives.)

    // --- Reveal: a ring of cysts silhouetted against the bell, then long
    // graceful lasher crossings in open water.
    ...cysts(bar(10.3), 3.8, [
      { x: 0, y: 13, drop: 8 },
      { x: -15, y: 8, drop: 9 },
      { x: 15, y: 8, drop: 9 },
      { x: -20, y: -4, drop: 10 },
      { x: 20, y: -4, drop: 10 },
      { x: 0, y: -10, drop: 11 },
    ]),
    ...lashers(bar(11.6), 3.4, [
      { fromX: -21, toX: 21, y: 1, arc: 5.0, delay: 0, crossTime: 2.8 },
      { fromX: 21, toX: -21, y: 9, arc: 3.2, delay: 0.4, crossTime: 2.8 },
      { fromX: -21, toX: 21, y: -8, arc: 4.4, delay: 0.8, crossTime: 2.8 },
    ]),

    // --- Thick: the densest stretch, back among the strands.
    ...spitters(bar(13.2), 4.2, [[-12, 2], [12, 8]]),
    ...cysts(bar(13.8), 4.0, [
      { x: -19, y: 10 },
      { x: -6, y: -9 },
      { x: 6, y: 12 },
      { x: 19, y: -6 },
    ]),
    ...lashers(bar(14.6), 3.2, [
      { fromX: 22, toX: -22, y: -4, arc: 4.0, delay: 0, crossTime: 2.6 },
      { fromX: -22, toX: 22, y: 4, arc: 3.0, delay: 0.26, crossTime: 2.6 },
      { fromX: 22, toX: -22, y: 11, arc: 2.0, delay: 0.52, crossTime: 2.6 },
      { fromX: -22, toX: 22, y: -10, arc: 4.6, delay: 0.78, crossTime: 2.6 },
    ]),
    ...cysts(bar(15.6), 3.8, [
      { x: -23, y: 2 },
      { x: -10, y: 8 },
      { x: 0, y: -8 },
      { x: 10, y: 8 },
      { x: 23, y: 2 },
    ]),
    ...spitters(bar(16.2), 3.6, [[0, 13]]),

    // Escort up the last stretch of strands, so the climb to the crown never
    // goes quiet before the boss is actually in view.
    ...cysts(bar(16.5), 3.8, [
      { x: -15, y: 6 },
      { x: 15, y: 2 },
    ]),
    ...lashers(bar(17.1), 3.5, [
      { fromX: -27, toX: 27, y: 1, arc: 3.4, delay: 0, crossTime: 2.9 },
      { fromX: 27, toX: -27, y: 8, arc: 2.4, delay: 0.7, crossTime: 2.9 },
    ]),

    // --- Crown: the Matriarch and its broods. The web is the fight.
    ...matriarchEntries,
    ...lashers(bar(18.2), 3.6, [
      { fromX: -26, toX: 26, y: -8, arc: 3.2, delay: 0, crossTime: 2.8 },
      { fromX: 26, toX: -26, y: 11, arc: 2.0, delay: 0.6, crossTime: 2.8 },
    ]),
    ...lashers(bar(19.8), 3.4, [
      { fromX: -26, toX: 26, y: -7, arc: 3.6, delay: 0, crossTime: 2.7 },
      { fromX: 26, toX: -26, y: 12, arc: 2.2, delay: 0.5, crossTime: 2.7 },
    ]),

    // (bars 22–24: the release. Nothing spawns; the quiet is the payoff.)
  ];
}

export function createStrandlineTimeline() {
  const matriarch = createMatriarchEntries(CROWN_TIME);
  return {
    matriarchEntry: matriarch.matriarchEntry,
    broodEntries: matriarch.broodEntries,
    timeline: buildTimeline(matriarch.timeline).sort((a, b) => a.time - b.time),
  };
}

const KILL_SCORE: Record<StrandlineEnemyKind, number> = {
  cyst: 90,
  lasher: 140,
  spitter: 200,
  venom: 40,
  brood: 260,
  matriarch: 2600,
};

const VENOM_MAX_AGE = 12;
const OVERTAKE_MISS = 0.012;

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  const { timeline, matriarchEntry, broodEntries } = createStrandlineTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let venomShot = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    venomShot = 0;
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

  function spitVenom(context: StrandlineUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'venom',
      countsTowardTotal: false,
      data: { role: 'venom', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const matriarch = createMatriarch(bus, {
    matriarchEntry,
    broodEntries,
    crownPoint: CROWN_POINT,
    spawnVenom: spitVenom,
  });

  // ---- movement --------------------------------------------------------------

  // Cyst: latched to a strand above its post, it drops on a mucus thread when
  // the player nears, then hangs there pulsing — a sac on a line, swaying.
  function updateCyst(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'cyst' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + OVERTAKE_MISS) return true;

    const DROP = 1.6;
    const k = MathUtils.clamp(age / DROP, 0, 1);
    const eased = 1 - (1 - k) ** 3;
    const y = data.y + data.drop * (1 - eased);
    const sway = k >= 1 ? Math.sin(age * data.sway * 2.2) * 0.9 : 0;
    const bob = k >= 1 ? Math.sin(age * 1.6 + enemy.id) * 0.5 : 0;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x + sway, y + bob, 0)));
    enemy.mesh.quaternion.copy(context.camera.quaternion);
    enemy.mesh.rotation.z = Math.sin(age * 1.1 + enemy.id * 2.3) * 0.18;
    enemy.mesh.userData.threadTop = data.drop * eased + 4;
    enemy.mesh.userData.pulse = age;
    return false;
  }

  // Lasher: a ribbon worm swimming a full-width crossing arc, body undulating.
  function updateLasher(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'lasher' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + OVERTAKE_MISS) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 3.1 + enemy.id) * 0.4;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)),
      data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * Math.sin(clamped * Math.PI) * 0.6);
    enemy.mesh.userData.swimPhase = age * 7;
    enemy.mesh.userData.swimAmp = 1;
    return false;
  }

  // Spitter: an urchin that station-keeps on a slow lissajous drift and lobs
  // venom globs with a readable wind-up.
  function updateSpitter(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'spitter' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ fireAt: data.firstShot }));

    const x = data.x + Math.sin(age * 0.7 + data.seed) * 2.4;
    const y = data.y + Math.sin(age * 1.1 + data.seed * 1.7) * 1.6;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotation.z += age * 0.002;

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.9 ? 1 - untilShot / 0.9 : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 3.8;
      spitVenom(context, enemy.mesh.position);
    }
    return runProgress > anchorU + OVERTAKE_MISS;
  }

  function updateVenom(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'venom' }>) {
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
      enemy.mesh.rotation.z += age * 6;
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5,
      maxSpeed: 11,
      accel: 2.6,
      turnRate: 2.3,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    enemy.mesh.userData.wobble = age;
    return age > VENOM_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition -------------------------------------------------------

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    validateRelease(enemies) {
      const verdict = matriarch.validateRelease(enemies);
      if (verdict === true) return true;
      const allowed = new Set(verdict.map((enemy) => enemy.id));
      return enemies.filter((enemy) => allowed.has(enemy.id));
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'cyst':
          return updateCyst(context, data);
        case 'lasher':
          return updateLasher(context, data);
        case 'spitter':
          return updateSpitter(context, data);
        case 'venom':
          return updateVenom(context, data);
        case 'brood':
          return matriarch.updateBrood(context, data);
        case 'matriarch':
          return matriarch.updateMatriarch(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'venom') venomShot += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (spitter shells, the Matriarch's stages) pays a little.
    scoreForHit: () => 45,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (matriarch.freed() && score >= 12000 && clearRate >= 0.92) return 'S';
      if (matriarch.freed() && score >= 9000 && clearRate >= 0.62) return 'A';
      if (score >= 5200 && clearRate >= 0.4) return 'B';
      if (score >= 2200 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Diver integrity ${hull}/${STRANDLINE_PLAYER_HEALTH}`];
      if (venomShot > 0) lines.push(`${venomShot} venom glob${venomShot === 1 ? '' : 's'} burst mid-water`);
      const broodLine = matriarch.broodLine();
      if (broodLine) lines.push(broodLine);
      const bossLine = matriarch.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
