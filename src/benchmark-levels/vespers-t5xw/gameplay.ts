import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { VESPERS_BPM, VESPERS_MARKERS, VESPERS_RUN_DURATION, VESPERS_TIME } from './timing';
import { createVigil, type VigilSpawnData } from './vigil';

// VESPERS — a 60-second night flight down the nave of an enormous cathedral
// while flat black thieves carry its window-light away. Every thief burns
// with one stolen pane's colour; killing it sends the light home and the
// window stays lit for the rest of the run. Past the middle the nave goes
// quiet, and then the Vigil — the thing hoarding every colour — must be
// broken open in the dead rose window at the west end.

export { VESPERS_BPM, VESPERS_RUN_DURATION } from './timing';
export const VESPERS_PLAYER_HEALTH = 3;

export type VespersEnemyKind =
  | 'wisp'
  | 'moth'
  | 'gargoyle'
  | 'censer'
  | 'bolt'
  | 'vigil-petal'
  | 'vigil-heart';

// Timeline entries carry immutable config; per-enemy runtime state lives in
// the runner's enemyState bags, and dynamically spawned bolts get fresh data.
export type VespersSpawnData =
  | { role: 'wisp'; lead: number; offset: Vector3 }
  | { role: 'moth'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'gargoyle'; lead: number; offset: Vector3; shots: number }
  | { role: 'censer'; lead: number; offset: Vector3; phase: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | VigilSpawnData;

export type VespersSpawnEntry = LockOnSpawnEntry<VespersEnemyKind, VespersSpawnData>;
export type VespersUpdate = LockOnEnemyUpdate<VespersEnemyKind, VespersSpawnData>;

// ---- rail -------------------------------------------------------------------

// Straight down the nave with a gentle weave between the pier lines, a rise
// toward the vault for the quiet span, then a level, dead-straight approach
// to the west rose window so the Vigil sits square in the frame at the end.
export function createVespersRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 1, 0),
      new Vector3(3.8, 4.5, -45),
      new Vector3(-4.2, -3.2, -95),
      new Vector3(4.2, 5.5, -145),
      new Vector3(-3.8, -3.8, -195),
      new Vector3(3.5, 7, -245),
      new Vector3(-4.2, -2.8, -295),
      new Vector3(3.8, 1, -345),
      new Vector3(-1.8, 7.5, -390),
      new Vector3(1, 8, -430),
      new Vector3(0, 5.5, -470),
      new Vector3(0, 4.5, -520),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

// ---- spawn timeline ---------------------------------------------------------

const time = VESPERS_TIME;
const STAGGER = time.seconds(0.16);

const wisps = (at: number, lead: number, offsets: Array<[number, number]>): VespersSpawnEntry[] =>
  formation(at, STAGGER, offsets, (offset) => ({
    kind: 'wisp',
    data: { role: 'wisp', lead, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const moths = (
  at: number,
  lead: number,
  runs: Array<{ f: number; t: number; y: number; a: number; c?: number }>,
): VespersSpawnEntry[] =>
  runs.map((run, index) => ({
    time: at + index * 0.12,
    kind: 'moth',
    data: {
      role: 'moth',
      lead,
      fromX: run.f,
      toX: run.t,
      y: run.y,
      arc: run.a,
      delay: index * 0.35,
      crossTime: run.c ?? 3.4,
    },
  }));

const gargoyles = (at: number, lead: number, offsets: Array<[number, number]>, shots: number): VespersSpawnEntry[] =>
  formation(at, STAGGER, offsets, (offset) => ({
    kind: 'gargoyle',
    data: { role: 'gargoyle', lead, offset: new Vector3(offset[0], offset[1], 0), shots },
  }));

const censers = (at: number, lead: number, offsets: Array<[number, number]>): VespersSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: at + index * 0.3,
    kind: 'censer',
    hitPoints: 2,
    data: { role: 'censer', lead, offset: new Vector3(offset[0], offset[1], 0), phase: index * 1.7 },
  }));

const RING_OFFSETS: Array<[number, number]> = [
  [0, 8], [-8.5, 5], [-8.5, -2], [0, -4.2], [8.5, -2], [8.5, 5],
];

function createVespersTimeline(vigil: ReturnType<typeof createVigil>): VespersSpawnEntry[] {
  return [
    // --- Movement I: the procession. One organ voice, one slow wave; each
    // new voice above the pedal brings a new shape into the nave.
    ...wisps(time.bar(0, 2.4), 4.2, [[-7, -0.8], [-2.6, 4.6], [2.6, 4.6], [7, -0.8]]),
    ...moths(time.bar(1, 2), 4.1, [
      { f: -10, t: 10, y: 2.6, a: 2.6 },
      { f: 10, t: -10, y: -1.4, a: 2.6 },
      { f: -10, t: 10, y: 5.8, a: 1.3 },
    ]),
    ...wisps(time.bar(2, 1), 4.2, [[-8.5, -2.6], [-4.2, 1.8], [0, 5.8], [4.2, 1.8], [8.5, -2.6]]),
    ...gargoyles(time.bar(3, 1.6), 4.7, [[0, 7]], 1),
    ...wisps(time.bar(3, 2.2), 4.0, [[-6.4, -2.2], [6.4, -2.2]]),
    ...moths(time.bar(4, 1.4), 4.1, [
      { f: 10, t: -10, y: 0.2, a: 2.4 },
      { f: -10, t: 10, y: 3.2, a: 1.8 },
      { f: 10, t: -10, y: 5, a: 1.2 },
      { f: -10, t: 10, y: -2.2, a: 2.8 },
    ]),
    ...wisps(time.bar(5, 2), 4.1, [[-9, 4.6], [-6, 1], [-3, -2.6], [3, -2.6], [6, 1], [9, 4.6]]),
    ...censers(time.bar(6, 0.8), 4.4, [[0, 4.2]]),
    ...gargoyles(time.bar(6, 1.8), 4.5, [[-8.6, 4.6], [8.6, 4.6]], 2),

    // --- Movement II: the plenum. Full organ, full nave.
    ...wisps(time.bar(7, 0.6), 4.0, [[-7.6, 1.2], [-4.4, 5.4], [0, 7.8], [4.4, 5.4], [7.6, 1.2]]),
    ...moths(time.bar(7, 3), 3.9, [
      { f: -10, t: 10, y: -1.6, a: 3.0, c: 3.0 },
      { f: 10, t: -10, y: 2, a: 2.4, c: 3.0 },
    ]),
    ...censers(time.bar(8, 0), 4.6, [[-5.6, 2.6], [5.6, 2.6]]),
    ...wisps(time.bar(8, 2), 4.0, [[-3.4, -3.4], [-0.8, 5.6], [3.4, 1.4]]),
    ...moths(time.bar(9, 0), 3.9, [
      { f: -10, t: 10, y: 1, a: 2.6, c: 2.9 },
      { f: 10, t: -10, y: 3.4, a: 2, c: 2.9 },
      { f: -10, t: 10, y: 6.4, a: 1.4, c: 2.9 },
      { f: 10, t: -10, y: -2.6, a: 3, c: 2.9 },
      { f: -10, t: 10, y: 2.4, a: 2.2, c: 2.9 },
    ]),
    ...gargoyles(time.bar(9, 2.4), 4.2, [[0, 6.2]], 2),
    ...wisps(time.bar(10, 0), 3.4, RING_OFFSETS),
    ...gargoyles(time.bar(10, 1), 4.0, [[-9.2, -0.6], [9.2, -0.6]], 1),

    // --- The quiet. A long dark empty span; one voice, one last thief
    // drifting alone so the stillness has a heartbeat.
    ...wisps(time.bar(11, 2), 4.2, [[3.8, 4.4]]),

    // --- The Vigil, nested in the dead rose window.
    ...vigil.entries(VESPERS_MARKERS.vigil),

    // --- Coda: the last two thieves flee down the lit nave while the organ
    // holds its final chord — and fill the tail for players who broke the
    // Vigil early.
    ...wisps(time.bar(15, 2), 3.6, [[-6.4, 4.6]]),
    ...wisps(time.bar(16, 3), 3.2, [[6.2, -1.8]]),
  ];
}

// ---- scoring ----------------------------------------------------------------

const KILL_SCORE: Record<VespersEnemyKind, number> = {
  wisp: 90,
  moth: 120,
  gargoyle: 150,
  censer: 240,
  bolt: 40,
  'vigil-petal': 180,
  'vigil-heart': 1500,
};

const BOLT_MAX_AGE = 13;

export function createVespersGameplay(bus: EventBus): LockOnRunnerLevel<VespersEnemyKind, VespersSpawnData> {
  const boltInterceptions = new Set<number>();
  let hitsTaken = 0;
  let panesReclaimed = 0;

  function fireBolt(context: VespersUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const vigil = createVigil(bus, fireBolt);
  const timeline = sortTimeline(createVespersTimeline(vigil));

  bus.on('runstart', () => {
    boltInterceptions.clear();
    hitsTaken = 0;
    panesReclaimed = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    boltInterceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
  });
  bus.on('kill', () => {
    panesReclaimed += 1;
  });

  // ---- movement -------------------------------------------------------------

  function updateWisp(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'wisp' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    // Hunger drift: the thief sinks slowly toward the candle sea below while
    // its shroud flutters like a flame in a draught.
    offset.x += Math.sin(age * 1.1 + enemy.id * 1.9) * 0.7;
    offset.y += Math.sin(age * 1.7 + enemy.id) * 0.45 + Math.cos(age * 0.6 + enemy.id * 0.7) * 0.3 - Math.min(1.4, age * 0.28);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.8 + enemy.id) * 0.22);
    return runProgress > anchorU + 0.016;
  }

  function updateMoth(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'moth' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12 || runProgress > anchorU + 0.014) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 5 + enemy.id) * 0.24;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    // Nose along the flight line, banked into the arc.
    const aheadX = MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05));
    const aheadY = data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.arc;
    enemy.mesh.lookAt(offsetFromRail(curve, anchorU, new Vector3(aheadX, aheadY, 0)));
    enemy.mesh.rotateZ(Math.sign(data.toX - data.fromX) * -0.5);
    return false;
  }

  function updateGargoyle(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'gargoyle' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.7 + enemy.id) * 0.5;
    offset.y += Math.sin(age * 1.9 + enemy.id) * 0.25;

    // Telegraphed pounce: it rears up on its corbel, then snaps forward as it
    // spits a gloom bolt at the hull.
    const fire = context.enemyState(() => ({ nextAt: 1.5 + (enemy.id % 3) * 0.5, shotsLeft: data.shots }));
    if (fire.shotsLeft > 0) {
      const untilShot = fire.nextAt - age;
      if (untilShot < 1.0 && untilShot > 0.6) offset.z += (1.0 - untilShot) * 6;
      else if (untilShot <= 0.6 && untilShot > 0) offset.z -= (0.6 - untilShot) * 10;
      if (age >= fire.nextAt) {
        fire.shotsLeft -= 1;
        fire.nextAt = age + 3.6;
        fireBolt(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.9 + enemy.id) * 0.08);
    return runProgress > anchorU + 0.016;
  }

  function updateCenser(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'censer' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // A true pendulum: the thurible swings on its chain, rising at the ends
    // of the arc, and the vessel tilts with the swing.
    const theta = Math.sin(age * 1.35 + data.phase) * 0.85;
    const chain = 4.6;
    const offset = data.offset.clone();
    offset.x += Math.sin(theta) * chain;
    offset.y += chain - Math.cos(theta) * chain;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(-theta);
    // Cracked open after the first hit: the vessel shudders, leaking light.
    if (enemy.hitPointsRemaining < 2) {
      enemy.mesh.position.x += Math.sin(age * 23) * 0.1;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.08;
    }
    return runProgress > anchorU + 0.016;
  }

  function updateBolt(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'bolt' }>) {
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
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.8,
      maxSpeed: 11,
      accel: 3.0,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 3.4);
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition -----------------------------------------------------

  return {
    duration: VESPERS_RUN_DURATION,
    bpm: VESPERS_BPM,
    playerHealth: VESPERS_PLAYER_HEALTH,
    createRail: createVespersRail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wisp':
          return updateWisp(context, data);
        case 'moth':
          return updateMoth(context, data);
        case 'gargoyle':
          return updateGargoyle(context, data);
        case 'censer':
          return updateCenser(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'petal':
        case 'heart':
          return vigil.update(context, data);
      }
    },
    validateRelease(enemies) {
      return vigil.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Cracking a censer or chipping the heart pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      // A clean full sweep is the signature play; pay it like one.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 550 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (vigil.bossDead() && score >= 9800 && clearRate >= 0.85) return 'S';
      if (score >= 7800 && clearRate >= 0.68) return 'A';
      if (score >= 5000 && clearRate >= 0.48) return 'B';
      if (score >= 2200 && clearRate >= 0.26) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, VESPERS_PLAYER_HEALTH - hitsTaken);
      const lines = [
        `Hull ${hull}/${VESPERS_PLAYER_HEALTH}`,
        `${panesReclaimed} pane${panesReclaimed === 1 ? '' : 's'} of light reclaimed`,
      ];
      const vigilLine = vigil.summary();
      if (vigilLine) lines.push(vigilLine);
      return lines;
    },
  };
}
