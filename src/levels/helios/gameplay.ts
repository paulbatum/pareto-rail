import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { tempo } from '../../engine/music';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { createHeliosDebugTimeline, type HeliosDebugTarget } from './debug';
import { createSuneater, createSuneaterEntries } from './suneater';

// HELIOS — a 120-second dive into a dying star, in four movements scored to a
// 172 BPM arrangement (one bar = 240/172 s; 86 bars = exactly 120 s):
//
//   Act 1  (0–22.3s)   The Approach — wreckage field, the star fills the horizon.
//   Gate   (22.3s)     Transit through the shattered Dyson gate. Drop 1.
//   Act 2  (22.3–56s)  The Furnace Road — conduit corridor, the corridor fights back.
//   Corona (55.8s)     Whiteout plunge through the corona. Drop 2.
//   Act 3  (56–78s)    The Burning Sea — skimming the photosphere, flares lash up.
//   Act 4  (78–120s)   The Suneater — the serpent that eats the star breaches
//                      and holds the sky until its heart is put out.
//
// The run rides a variable speed profile: the rail progress easing is the
// normalized integral of speed(t), so the gate transit and corona dive land
// as genuine kicks of acceleration on their musical drops.

export const HELIOS_BPM = 172;
const HELIOS_TEMPO = tempo(HELIOS_BPM);
export const HELIOS_BAR = HELIOS_TEMPO.barSeconds;
export const HELIOS_DURATION = 120;
export const HELIOS_PLAYER_HEALTH = 4;

export const bar = HELIOS_TEMPO.bar;

export const GATE_TIME = bar(16); // 22.33 — drop 1
export const CORONA_TIME = bar(40); // 55.81 — drop 2
export const REVEAL_TIME = bar(56); // 78.14 — breakdown, the serpent stirs
export const BOSS_TIME = bar(60); // 83.72 — the Suneater breaches
export const DROP3_TIME = bar(64); // 89.30 — boss theme

export type HeliosEnemyKind =
  | 'cinder'
  | 'mote'
  | 'scorcher'
  | 'pyre'
  | 'bolt'
  | 'flare'
  | 'fang'
  | 'heart';

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in the runner's enemyState bags, boss/run
// state lives in this module, and dynamically spawned bolts get fresh data
// objects each launch.
export type HeliosSpawnData =
  | { role: 'lattice'; lead: number; offset: Vector3; spin: number; debugHold?: boolean }
  | { role: 'mote'; lead: number; fromX: number; toX: number; y: number; arc: number; crossTime: number; delay: number; debugHold?: boolean }
  | { role: 'scorcher'; lead: number; offset: Vector3; seed: number; debugHold?: boolean; fireForever?: boolean }
  | { role: 'pyre'; leadStart: number; leadEnd: number; closeTime: number; offset: Vector3; debugHold?: boolean }
  | { role: 'flare'; targetLead: number; x: number; debugHold?: boolean }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'fang'; socket: number }
  | { role: 'heart'; debugHold?: boolean };

export type HeliosSpawnEntry = LockOnSpawnEntry<HeliosEnemyKind, HeliosSpawnData>;
export type HeliosUpdate = LockOnEnemyUpdate<HeliosEnemyKind, HeliosSpawnData>;

// ---- speed profile → rail easing ------------------------------------------

// Piecewise-linear speed factors over run time. 1.0 ≈ cruise; the spikes at
// the gate and corona are the acceleration moments.
const SPEED_KEYS: Array<[number, number]> = [
  [0, 0.55],
  [8, 0.82],
  [21.8, 1.0],
  [22.4, 1.7],
  [24.8, 1.15],
  [40, 1.22],
  [55.4, 1.32],
  [56.0, 2.0],
  [58.6, 1.52],
  [76, 1.45],
  [80, 0.95],
  [84, 0.85],
  [110, 0.88],
  [120, 1.3],
];

export function speedFactorAt(time: number) {
  const t = MathUtils.clamp(time, 0, HELIOS_DURATION);
  for (let i = 1; i < SPEED_KEYS.length; i += 1) {
    if (t <= SPEED_KEYS[i][0]) {
      const [t0, v0] = SPEED_KEYS[i - 1];
      const [t1, v1] = SPEED_KEYS[i];
      return MathUtils.lerp(v0, v1, (t - t0) / Math.max(0.0001, t1 - t0));
    }
  }
  return SPEED_KEYS[SPEED_KEYS.length - 1][1];
}

const EASE_SAMPLES = 1200;
const easeTable: number[] = (() => {
  const table = [0];
  let sum = 0;
  const dt = HELIOS_DURATION / EASE_SAMPLES;
  for (let i = 1; i <= EASE_SAMPLES; i += 1) {
    const mid = (i - 0.5) * dt;
    sum += speedFactorAt(mid) * dt;
    table.push(sum);
  }
  const total = table[EASE_SAMPLES];
  return table.map((value) => value / total);
})();

export function heliosRunProgress(time: number, duration = HELIOS_DURATION) {
  const t = MathUtils.clamp(time / duration, 0, 1) * EASE_SAMPLES;
  const index = Math.min(EASE_SAMPLES - 1, Math.floor(t));
  return MathUtils.lerp(easeTable[index], easeTable[index + 1], t - index);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => heliosRunProgress(time);

// ---- rail ------------------------------------------------------------------

// Space run (y≈0) → dive at the corona → low skim over the star (y≈-60) →
// boss arc. The star sphere sits below the skim section.
export function createHeliosRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 6, 0),
      new Vector3(3, 4, -70),
      new Vector3(-15, 1, -150),
      new Vector3(11, -3, -235),
      new Vector3(0, 0, -330),
      new Vector3(-25, -5, -430),
      new Vector3(27, 7, -540),
      new Vector3(-31, -9, -650),
      new Vector3(19, 11, -760),
      new Vector3(-9, -2, -860),
      new Vector3(0, -18, -950),
      new Vector3(7, -46, -1040),
      new Vector3(-21, -58, -1140),
      new Vector3(25, -65, -1250),
      new Vector3(-27, -58, -1360),
      new Vector3(11, -66, -1460),
      new Vector3(0, -60, -1560),
      new Vector3(-15, -52, -1680),
      new Vector3(11, -56, -1800),
      new Vector3(0, -48, -1950),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// The star that owns the lower half of the sky. Exported so the environment
// and the gameplay agree on where "below" is.
export const STAR_CENTER = new Vector3(0, -1640, -1500);
export const STAR_RADIUS = 1500;

// ---- spawn timeline ---------------------------------------------------------

const cinders = (time: number, lead: number, spin: number, offsets: Array<[number, number]>): HeliosSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.14,
    kind: 'cinder',
    data: { role: 'lattice', lead, spin, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const motes = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): HeliosSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.1,
    kind: 'mote',
    data: {
      role: 'mote',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.42,
      crossTime: run.crossTime ?? 2.6,
    },
  }));

const scorchers = (time: number, lead: number, offsets: Array<[number, number]>): HeliosSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.2,
    kind: 'scorcher',
    data: { role: 'scorcher', lead, seed: index * 2.61 + time, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const pyres = (time: number, offsets: Array<[number, number]>): HeliosSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.3,
    kind: 'pyre',
    hitStages: [3, 3],
    data: { role: 'pyre', leadStart: 9.5, leadEnd: 3.6, closeTime: 8.5, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const flares = (time: number, entries: Array<[number, number]>): HeliosSpawnEntry[] =>
  entries.map(([x, targetLead], index) => ({
    time: time + index * 0.35,
    kind: 'flare',
    countsTowardTotal: false,
    data: { role: 'flare', targetLead, x },
  }));

function buildHeliosTimeline(suneaterEntries: HeliosSpawnEntry[]): HeliosSpawnEntry[] {
  return [
  // --- Act 1: The Approach. Sparse, formation-first; learn the sweep among wreckage.
  ...cinders(bar(2), 4.6, 0.35, [[-5, 2], [-1.8, 3.4], [1.8, 3.4], [5, 2]]),
  ...cinders(bar(4), 4.8, -0.3, [[-6, -1], [-3, 1.4], [0, 3.6], [3, 1.4], [6, -1]]),
  ...motes(bar(6), 4.4, [
    { fromX: -20, toX: 20, y: 2.5, arc: 2 },
    { fromX: -20, toX: 20, y: 0.2, arc: 3 },
    { fromX: -20, toX: 20, y: 4.4, arc: 1.4 },
  ]),
  ...cinders(bar(8), 4.6, 0.42, [[-7, 1], [-4.2, 3], [-1.4, 4.4], [1.4, 4.4], [4.2, 3], [7, 1]]),
  ...motes(bar(10), 4.5, [
    { fromX: -22, toX: 22, y: 1, arc: 2.4 },
    { fromX: 22, toX: -22, y: 3.4, arc: 1.8 },
    { fromX: -22, toX: 22, y: 5, arc: 1.2 },
    { fromX: 22, toX: -22, y: -0.6, arc: 2.8 },
  ]),
  ...scorchers(bar(12), 5.2, [[0, 4.6]]),
  ...cinders(bar(12.5), 4.4, 0.5, [[-4.5, 0.5], [0, -1], [4.5, 0.5]]),
  ...scorchers(bar(14), 5.0, [[-5.5, 3.2], [5.5, 3.2]]),

  // (bars 15.5–17: screen kept clear for the gate transit)

  // --- Act 2: The Furnace Road. Dense two-bar cadence, armor arrives.
  ...cinders(bar(17.5), 4.2, 0.55, [[-6, 2.4], [-3, 4], [0, 2.4], [3, 4], [6, 2.4], [0, 0]]),
  ...motes(bar(20), 4.3, [
    { fromX: -24, toX: 24, y: -1, arc: 3.2 },
    { fromX: -24, toX: 24, y: 1.6, arc: 2.4 },
    { fromX: -24, toX: 24, y: 4, arc: 1.8 },
    { fromX: 24, toX: -24, y: 2.6, arc: 2.2 },
    { fromX: 24, toX: -24, y: 0, arc: 3 },
  ]),
  ...pyres(bar(22), [[0, 2.6]]),
  ...cinders(bar(22.3), 4.4, -0.4, [[-6.5, 0], [6.5, 0]]),
  ...scorchers(bar(24), 4.8, [[-6, 4.4], [6, 4.4]]),
  ...motes(bar(24.5), 4.2, [
    { fromX: -22, toX: 22, y: 0.5, arc: 2 },
    { fromX: 22, toX: -22, y: 3, arc: 2 },
    { fromX: -22, toX: 22, y: 5.2, arc: 1.4 },
  ]),
  ...cinders(bar(26), 4.5, 0.3, [[-8, 1], [-5.3, 2.8], [-2.6, 4], [0, 4.6], [2.6, 4], [5.3, 2.8], [8, 1]]),
  ...pyres(bar(28), [[-5.5, 1.6], [5.5, 1.6]]),
  ...scorchers(bar(28.5), 4.6, [[0, 5.6]]),
  ...motes(bar(30), 4.4, [
    { fromX: -24, toX: 24, y: 0, arc: 4, delay: 0 },
    { fromX: 24, toX: -24, y: 4.4, arc: -4, delay: 0.21 },
    { fromX: -24, toX: 24, y: 1.4, arc: 3.2, delay: 0.42 },
    { fromX: 24, toX: -24, y: 3, arc: -3.2, delay: 0.63 },
    { fromX: -24, toX: 24, y: 2.6, arc: 2.4, delay: 0.84 },
    { fromX: 24, toX: -24, y: 1.8, arc: -2.4, delay: 1.05 },
  ]),
  ...cinders(bar(32), 4.3, 0.6, [[-5, -1.5], [-2.5, 0.5], [2.5, 0.5], [5, -1.5]]),
  ...scorchers(bar(32.5), 4.7, [[-4, 5.4], [4, 5.4]]),
  ...pyres(bar(34), [[0, 4.2]]),
  ...motes(bar(34.5), 4.2, [
    { fromX: -22, toX: 22, y: 2, arc: 2.6 },
    { fromX: 22, toX: -22, y: 0.4, arc: 2.2 },
    { fromX: -22, toX: 22, y: 4.6, arc: 1.6 },
    { fromX: 22, toX: -22, y: 3, arc: 2 },
  ]),
  ...scorchers(bar(36), 4.5, [[-7, 2.4], [0, 5.8], [7, 2.4]]),
  ...motes(bar(38), 4.0, [
    { fromX: -24, toX: 24, y: 1, arc: 2.8, delay: 0 },
    { fromX: -24, toX: 24, y: 3, arc: 2.2, delay: 0.3 },
    { fromX: 24, toX: -24, y: 2, arc: 2.6, delay: 0.6 },
    { fromX: 24, toX: -24, y: 4.2, arc: 1.8, delay: 0.9 },
    { fromX: -24, toX: 24, y: 0, arc: 3.2, delay: 1.2 },
    { fromX: 24, toX: -24, y: 5, arc: 1.4, delay: 1.5 },
  ]),

  // (bars 39.5–41: clear for the corona plunge)

  // --- Act 3: The Burning Sea. Fast, low, and the sun itself starts throwing fire.
  ...flares(bar(41), [[-4, 4.4], [4, 4.8]]),
  ...motes(bar(41.2), 4.0, [
    { fromX: -24, toX: 24, y: 3, arc: 2, crossTime: 2.2 },
    { fromX: 24, toX: -24, y: 1.4, arc: 2.6, crossTime: 2.2 },
    { fromX: -24, toX: 24, y: 5, arc: 1.4, crossTime: 2.2 },
  ]),
  ...cinders(bar(42.5), 4.2, 0.45, [[-7, -0.5], [-3.5, 0.5], [0, 1.2], [3.5, 0.5], [7, -0.5]]),
  ...scorchers(bar(44), 4.6, [[-5.5, 4], [5.5, 4]]),
  ...flares(bar(44.5), [[0, 4.2], [-6, 4.6]]),
  ...motes(bar(46), 3.9, [
    { fromX: -25, toX: 25, y: 0.5, arc: 3.4, crossTime: 2.2, delay: 0 },
    { fromX: 25, toX: -25, y: 2.2, arc: 2.8, crossTime: 2.2, delay: 0.28 },
    { fromX: -25, toX: 25, y: 4, arc: 2.2, crossTime: 2.2, delay: 0.56 },
    { fromX: 25, toX: -25, y: 5.6, arc: 1.6, crossTime: 2.2, delay: 0.84 },
    { fromX: -25, toX: 25, y: 1.4, arc: 3, crossTime: 2.2, delay: 1.12 },
    { fromX: 25, toX: -25, y: 3.2, arc: 2.4, crossTime: 2.2, delay: 1.4 },
  ]),
  ...pyres(bar(48), [[0, 3.4]]),
  ...cinders(bar(48.4), 4.3, -0.5, [[-6, 1], [-3, 3], [3, 3], [6, 1]]),
  ...flares(bar(50), [[-5, 4.2], [0, 4.6], [5, 5.0]]),
  ...motes(bar(50.5), 4.0, [
    { fromX: -22, toX: 22, y: 2.4, arc: 2.4, crossTime: 2.3 },
    { fromX: 22, toX: -22, y: 4, arc: 1.8, crossTime: 2.3 },
  ]),
  ...scorchers(bar(52), 4.4, [[-6.5, 3.4], [0, 5.4], [6.5, 3.4]]),
  ...cinders(bar(52.4), 4.2, 0.5, [[-4, -0.5], [0, 0.8], [4, -0.5]]),
  ...motes(bar(54), 3.9, [
    { fromX: -24, toX: 24, y: 1.4, arc: 2.6, crossTime: 2.2 },
    { fromX: 24, toX: -24, y: 3.2, arc: 2.2, crossTime: 2.2 },
    { fromX: -24, toX: 24, y: 4.8, arc: 1.6, crossTime: 2.2 },
    { fromX: 24, toX: -24, y: 0.2, arc: 3, crossTime: 2.2 },
  ]),

  // --- Act 4: The Suneater. The heart is sealed until all four fangs shatter.
  ...suneaterEntries,
  ...motes(bar(68), 3.8, [
    { fromX: -24, toX: 24, y: 2, arc: 2.4, crossTime: 2.4 },
    { fromX: 24, toX: -24, y: 4, arc: 1.8, crossTime: 2.4 },
  ]),
  ...motes(bar(72), 3.8, [
    { fromX: 24, toX: -24, y: 1.4, arc: 2.6, crossTime: 2.4 },
    { fromX: -24, toX: 24, y: 3.4, arc: 2, crossTime: 2.4 },
  ]),
  ];
}

export function createHeliosTimeline() {
  const suneaterEntries = createSuneaterEntries(BOSS_TIME);
  return {
    heartEntry: suneaterEntries.heartEntry,
    timeline: buildHeliosTimeline(suneaterEntries.timeline).sort((a, b) => a.time - b.time),
  };
}

export const HELIOS_TIMELINE: HeliosSpawnEntry[] = createHeliosTimeline().timeline;

const KILL_SCORE: Record<HeliosEnemyKind, number> = {
  cinder: 100,
  mote: 140,
  scorcher: 180,
  pyre: 320,
  bolt: 40,
  flare: 60,
  fang: 400,
  heart: 2000,
};

const BOLT_MAX_AGE = 13;
const FLARE_MAX_AGE = 14;
const DEBUG_HOLD_PROGRESS_OFFSET = 0.014;

export function createHeliosGameplay(
  bus: EventBus,
  debugTarget?: HeliosDebugTarget,
): LockOnRunnerLevel<HeliosEnemyKind, HeliosSpawnData> {
  const { timeline, heartEntry } = debugTarget ? createHeliosDebugTimeline(debugTarget) : createHeliosTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let flaresDowned = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    flaresDowned = 0;
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

  function fireBolt(context: HeliosUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  function spawnBossFlare(context: HeliosUpdate, x: number) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'flare',
      countsTowardTotal: false,
      data: { role: 'flare', targetLead: 3.2, x },
    });
  }

  const suneater = createSuneater(bus, { heartEntry, drop3Time: DROP3_TIME, spawnBossFlare });

  // ---- movement -------------------------------------------------------------

  function updateLattice(context: HeliosUpdate, data: Extract<HeliosSpawnData, { role: 'lattice' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(data.lead);
    // The whole formation slowly wheels around its center while each ember
    // tumbles in place — a smoldering constellation, not a static wall.
    const angle = age * data.spin;
    const breathe = 1 + Math.sin(age * 1.3 + enemy.id) * 0.06;
    const x = (data.offset.x * Math.cos(angle) - data.offset.y * Math.sin(angle)) * breathe;
    const y = (data.offset.x * Math.sin(angle) + data.offset.y * Math.cos(angle)) * breathe + 1.2;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * (0.5 + (enemy.id % 4) * 0.13) + enemy.id * 2.3);
    enemy.mesh.rotateX(Math.sin(age * 0.9 + enemy.id) * 0.5);
    return !data.debugHold && runProgress > anchorU + 0.014;
  }

  function updateMote(context: HeliosUpdate, data: Extract<HeliosSpawnData, { role: 'mote' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (!data.debugHold && (t > 1.15 || runProgress > anchorU + 0.012)) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 3 + enemy.id) * 0.4)));
    // Nose into the direction of travel; the tail streak sells the speed.
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.04)),
      data.y + Math.sin(Math.min(1, clamped + 0.04) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(age * 6);
    void camera;
    return false;
  }

  function updateScorcher(context: HeliosUpdate, data: Extract<HeliosSpawnData, { role: 'scorcher' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 1.15 + data.seed) * 2.6;
    offset.y += Math.sin(age * 1.75 + data.seed * 2.1) * 1.7;

    // Telegraphed lunge: rear back, dash at the camera, loose a molten bolt.
    const fire = context.enemyState(() => ({ nextAt: 1.6 }));
    const untilShot = fire.nextAt - age;
    if (untilShot < 0.9 && untilShot > 0.55) offset.z += (0.9 - untilShot) * 8; // rear back
    else if (untilShot <= 0.55 && untilShot > 0) offset.z -= (0.55 - untilShot) * 14; // lunge in
    if (age >= fire.nextAt) {
      fire.nextAt = age + (data.fireForever ? 1.8 : 3.4);
      fireBolt(context, enemy.mesh.position);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 2.2 + data.seed) * 0.5);
    return !data.debugHold && runProgress > anchorU + 0.014;
  }

  function updatePyre(context: HeliosUpdate, data: Extract<HeliosSpawnData, { role: 'pyre' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const close = Math.min(1, age / data.closeTime);
    const lead = MathUtils.lerp(data.leadStart, data.leadEnd, close * close * (3 - 2 * close));
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.5) * 1.1;
    offset.y += 2 + Math.sin(age * 0.75) * 0.8;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Ponderous roll — a furnace idol grinding toward the rail.
    enemy.mesh.rotateZ(age * 0.4);
    // Cracked open (stage 1): the exposed core shudders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 21) * 0.14;
      enemy.mesh.position.y += Math.cos(age * 17) * 0.12;
    }
    return !data.debugHold && runProgress > anchorU + 0.014;
  }

  function updateBolt(context: HeliosUpdate, data: Extract<HeliosSpawnData, { role: 'bolt' }>) {
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
      baseSpeed: 5.5,
      maxSpeed: 12.5,
      accel: 3.4,
      turnRate: 2.4,
    });
    enemy.mesh.position.copy(data.position);
    orientAlongVelocity(enemy.mesh.position, data.velocity, context);
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateFlare(context: HeliosUpdate, data: Extract<HeliosSpawnData, { role: 'flare' }>) {
    const { enemy, age, curve, camera, damagePlayer, runProgress } = context;
    if (data.debugHold) {
      const anchorU = MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(0, 2.2, 0)));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 4);
      return false;
    }
    const launchU = heliosRunProgress(Math.min(HELIOS_DURATION, enemy.entry.time + data.targetLead));
    const position = offsetFromRail(curve, launchU, new Vector3(data.x, -36, 0));
    const velocity = new Vector3(0, 26, 0);
    const state = context.enemyState(() => ({ position, velocity, lastAge: 0, impact: {} }));
    const dt = Math.max(0, age - state.lastAge);
    state.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: state.position,
      velocity: state.velocity,
      state: state.impact,
      intercepted: interceptions.delete(enemy.id),
      config: { hitDistance: 2.6, impactBrake: 0.42, damageDistance: 0.72 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(state.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 7);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    const RISE = 1.05;
    if (age < RISE) {
      // Telegraph: a prominence column punches up out of the star before the
      // head detaches and starts hunting.
      state.velocity.set(Math.sin(enemy.id) * 2, 26 - age * 10, 0);
      state.position.addScaledVector(state.velocity, dt);
    } else {
      steerHomingShot(state.position, state.velocity, hostileShotAimPoint(camera, state.position, 2.6), age - RISE, dt, {
        baseSpeed: 6,
        maxSpeed: 13,
        accel: 2.6,
        turnRate: 1.9,
      });
    }
    enemy.mesh.position.copy(state.position);
    orientAlongVelocity(enemy.mesh.position, state.velocity, context);
    return age > FLARE_MAX_AGE || shotBehindCamera(camera, state.position);
  }

  function orientAlongVelocity(position: Vector3, velocity: Vector3, context: HeliosUpdate) {
    if (velocity.lengthSq() < 0.001) return;
    const target = position.clone().add(velocity);
    const mesh = context.enemy.mesh;
    mesh.lookAt(target);
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: debugTarget ? 90 : HELIOS_DURATION,
    bpm: HELIOS_BPM,
    playerHealth: HELIOS_PLAYER_HEALTH,
    createRail: createHeliosRail,
    spawnTimeline: timeline,
    easeRunProgress: heliosRunProgress,
    startWord: 'IGNITE',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'lattice':
          return updateLattice(context, data);
        case 'mote':
          return updateMote(context, data);
        case 'scorcher':
          return updateScorcher(context, data);
        case 'pyre':
          return updatePyre(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'flare':
          return updateFlare(context, data);
        case 'fang':
          return suneater.updateFang(context, data);
        case 'heart':
          return suneater.updateHeart(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'flare') flaresDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (pyre plates, fangs, the heart) pays a little.
    scoreForHit: () => 45,
    scoreForVolley(results) {
      // A full, perfect volley is the level's signature play; pay it like one.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (suneater.heartKilled() && score >= 24000 && clearRate >= 0.8) return 'S';
      if (score >= 16000 && clearRate >= 0.62) return 'A';
      if (score >= 9500 && clearRate >= 0.42) return 'B';
      if (score >= 4000 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, HELIOS_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${HELIOS_PLAYER_HEALTH}`];
      if (flaresDowned > 0) lines.push(`${flaresDowned} flare${flaresDowned === 1 ? '' : 's'} shot down`);
      const suneaterLine = suneater.summaryLine();
      if (suneaterLine) lines.push(suneaterLine);
      return lines;
    },
  };
}
