import { MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnRunnerLevel } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { createParentController, PARENT_HIT_STAGES, type ParentController, type ParentDebug } from './parent';
import { PULL_SECONDS } from './camera';
import { STRANDLINE_BPM, STRANDLINE_DURATION, STRANDLINE_TIME, bar } from './timing';
import type { StrandlineData, StrandlineEntry, StrandlineKind, StrandlineUpdate } from './types';
import { createStrandlineRail, PULL_END_PROGRESS, RAIL_LENGTH, strandlineRunProgress } from './world';

// STRANDLINE — sixty seconds up the tentacles of a colossal jellyfish, scored
// at 96 BPM (one bar = 2.5 s; 24 bars). The parasites are the only thing that
// is wrong; everything the run does is give the animal back its light.
//
//   bars 0–6     Strandwood  — slow drift in, dim strands, clampers on the strands
//   bars 6.4–9.6 The Moon    — the rail leaves the forest; the bell rises; leech schools
//   bars 10–12   The Dive    — back into the strands at speed; brooders spit spores
//   bars 12–20   The Crown   — the parent behind its webbing; broods, then the tear
//   bars 20–24   Drift       — the camera pulls back until the whole animal is in frame

export { STRANDLINE_BPM, STRANDLINE_DURATION } from './timing';
export const STRANDLINE_PLAYER_HEALTH = 3;

const MISS_GRACE_U = 6 / RAIL_LENGTH;
const SPORE_MAX_AGE = 12;

// ---- spawn timeline -----------------------------------------------------------

const V = (x: number, y: number) => new Vector3(x, y, 0);

/** Clampers latch onto strands; `detachAt` is seconds after spawn that they peel off. */
const clampers = (
  time: number,
  lead: number,
  detachAt: number,
  offsets: Array<[number, number]>,
  stagger = 0.11,
): StrandlineEntry[] =>
  offsets.map(([x, y], index) => ({
    time: time + index * stagger,
    kind: 'clamper',
    data: { role: 'clamper', lead, x, y, detachAt, sweep: (x >= 0 ? 1 : -1) * (0.7 + (index % 3) * 0.12) },
  }));

type LeechRun = {
  from: number;
  to: number;
  y: number;
  amp?: number;
  freq?: number;
  cross?: number;
  depth?: number;
  toDepth?: number;
};

/** A school: S-waves crossing the frame. In the camera frame x/y are screen fractions (±1 = the screen edge). */
const leeches = (
  time: number,
  frame: 'rail' | 'camera',
  lead: number,
  stagger: number,
  runs: LeechRun[],
): StrandlineEntry[] =>
  runs.map((run, index) => ({
    time: time + index * stagger,
    kind: 'leech',
    data: {
      role: 'leech',
      frame,
      lead,
      fromX: run.from,
      toX: run.to,
      y: run.y,
      depth: run.depth ?? 30,
      toDepth: run.toDepth ?? run.depth ?? 30,
      amp: run.amp ?? (frame === 'rail' ? 3 : 0.16),
      freq: run.freq ?? 1.4,
      delay: 0,
      crossTime: run.cross ?? 3,
    },
  }));

const brooders = (
  time: number,
  lead: number,
  firstSpore: number,
  period: number,
  offsets: Array<[number, number]>,
  stagger = 0.4,
): StrandlineEntry[] =>
  offsets.map(([x, y], index) => ({
    time: time + index * stagger,
    kind: 'brooder',
    hitStages: [2, 2],
    data: { role: 'brooder', lead, x, y, firstSpore: firstSpore + index * 0.5, period },
  }));

// A full-width arc of six clampers: the first "chord" volley.
const SMILE: Array<[number, number]> = [[-22, 4], [-14, -6], [-5, -11], [5, -11], [14, -6], [22, 4]];

function buildTimeline(): StrandlineEntry[] {
  return [
    // --- Strandwood: dim water, slow drift. Learn the sweep among the strands.
    ...clampers(bar(1), 4.4, 2.2, [[-13, 4], [12, 7], [1, -6]], 0.28),
    ...clampers(bar(2.5), 4.5, 2.3, [[-21, 8], [-9, -7], [10, -5], [21, 6]], 0.22),
    ...leeches(bar(3.5), 'rail', 3.6, 0.32, [
      { from: 34, to: -34, y: -8, amp: 2.4, cross: 3.2 },
      { from: 34, to: -34, y: 0, amp: 3, cross: 3.2 },
      { from: 34, to: -34, y: 6, amp: 2.6, cross: 3.2 },
      { from: 34, to: -34, y: 11, amp: 2, cross: 3.2 },
    ]),
    // stir: the first glow climbs the strands — a six-lock chord.
    ...clampers(bar(4), 4.7, 2.4, SMILE, 0.09),
    ...brooders(bar(5.5), 3.8, 1.7, 2.4, [[13, 4]]),
    ...clampers(bar(5.5) + 0.62, 3.2, 1.5, [[-15, 6], [-8, -8]], 0.24),
    // the water opens: a school swims out to meet the swing
    ...leeches(bar(6.6), 'camera', 0, 0.24, [
      { from: -1.2, to: 1.2, y: 0.5, amp: 0.14, depth: 34, toDepth: 28, cross: 3.1 },
      { from: 1.2, to: -1.2, y: -0.15, amp: 0.16, depth: 34, toDepth: 28, cross: 3.1 },
      { from: -1.2, to: 1.2, y: -0.45, amp: 0.13, depth: 34, toDepth: 28, cross: 3.1 },
      { from: 1.2, to: -1.2, y: 0.28, amp: 0.15, depth: 34, toDepth: 28, cross: 3.1 },
      { from: -1.2, to: 1.2, y: 0.05, amp: 0.17, depth: 34, toDepth: 28, cross: 3.1 },
    ]),

    // --- The Moon: the rail swings out of the forest; the school sweeps under the bell.
    ...leeches(bar(7.75), 'camera', 0, 0.2, [
      { from: -1.2, to: 1.2, y: -0.42, amp: 0.13, depth: 34, toDepth: 27, cross: 3.5 },
      { from: -1.2, to: 1.2, y: -0.22, amp: 0.16, depth: 34, toDepth: 27, cross: 3.5 },
      { from: -1.2, to: 1.2, y: 0, amp: 0.18, depth: 34, toDepth: 27, cross: 3.5 },
      { from: -1.2, to: 1.2, y: 0.22, amp: 0.16, depth: 34, toDepth: 27, cross: 3.5 },
      { from: -1.2, to: 1.2, y: 0.42, amp: 0.13, depth: 34, toDepth: 27, cross: 3.5 },
      { from: -1.2, to: 1.2, y: 0.6, amp: 0.1, depth: 34, toDepth: 27, cross: 3.5 },
    ]),
    ...leeches(bar(9.05), 'camera', 0, 0.22, [
      { from: 1.2, to: -1.2, y: 0.5, amp: 0.15, depth: 36, toDepth: 30, cross: 3.0, freq: 1.8 },
      { from: 1.2, to: -1.2, y: 0.12, amp: 0.2, depth: 36, toDepth: 30, cross: 3.0, freq: 1.8 },
      { from: 1.2, to: -1.2, y: -0.25, amp: 0.2, depth: 36, toDepth: 30, cross: 3.0, freq: 1.8 },
      { from: 1.2, to: -1.2, y: -0.52, amp: 0.14, depth: 36, toDepth: 30, cross: 3.0, freq: 1.8 },
    ]),

    // --- The Dive: fast, close, latched on streaking strands.
    ...clampers(bar(10), 2.5, 1.3, [[-19, 10], [-9, -8], [0, 11], [9, -8], [19, 10]], 0.11),
    ...brooders(bar(11), 3.1, 1.5, 2.2, [[-15, 4], [15, -3]], 0.32),
    ...leeches(bar(11.5), 'rail', 2.5, 0.2, [
      { from: -32, to: 32, y: 6, amp: 2.4, cross: 2.2 },
      { from: 32, to: -32, y: -3, amp: 2.8, cross: 2.2 },
      { from: -32, to: 32, y: -9, amp: 2.2, cross: 2.2 },
      { from: 32, to: -32, y: 10, amp: 2.4, cross: 2.2 },
    ]),
  ];
}

// ---- kill values ---------------------------------------------------------------

const KILL_SCORE: Record<StrandlineKind, number> = {
  clamper: 100,
  leech: 130,
  brooder: 320,
  spore: 40,
  brood: 180,
  parent: 3000,
};

// ---- gameplay factory ------------------------------------------------------------

export type StrandlineGameplay = LockOnRunnerLevel<StrandlineKind, StrandlineData> & { boss: ParentController };

export function createStrandlineGameplay(bus: EventBus, debug?: ParentDebug): StrandlineGameplay {
  const rail = createStrandlineRail();
  const timeline = buildTimeline().sort((a, b) => a.time - b.time);
  const boss = createParentController(bus, debug);

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let sporesDowned = 0;
  let clampersFreed = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    sporesDowned = 0;
    clampersFreed = 0;
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

  // Run progress: up the climb on the waypoint clock — then, once the parent
  // lets go, out along the pull-back stretch of rail to the far vantage.
  function runProgress(time: number, duration = STRANDLINE_DURATION) {
    const freedAt = boss.freedAt();
    if (freedAt === null || time <= freedAt) return strandlineRunProgress(time, duration);
    const span = Math.max(1, Math.min(PULL_SECONDS, duration - freedAt));
    const k = MathUtils.smootherstep((time - freedAt) / span, 0, 1);
    return MathUtils.lerp(strandlineRunProgress(freedAt, duration), PULL_END_PROGRESS, k);
  }

  // ---- shared helpers -------------------------------------------------------------

  const smooth = (t: number) => {
    const c = MathUtils.clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
  };

  function faceCamera(context: StrandlineUpdate, roll: number) {
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(roll);
  }

  function launchSpore(context: StrandlineUpdate, from: Vector3, speed = 4.2) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    return context.spawnEnemy({
      time: context.runTime,
      kind: 'spore',
      countsTowardTotal: false,
      data: { role: 'spore', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement --------------------------------------------------------------------

  function updateClamper(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'clamper' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    // Latched: it belongs to the strand. Then it peels off and closes on the
    // rail faster than the strand does, sweeping across the screen as it comes.
    const peel = Math.max(0, age - data.detachAt);
    const anchorU = railAnchor(data.lead - peel * 0.55);
    const k = smooth(peel / 1.3);
    const radius = Math.hypot(data.x, data.y) * (1 - 0.3 * k);
    const angle = Math.atan2(data.y, data.x) + data.sweep * k;
    let x = Math.cos(angle) * radius;
    let y = Math.sin(angle) * radius;
    if (peel <= 0) {
      // A clamped body shudders against the strand.
      x += Math.sin(age * 2.1 + enemy.id) * 0.18;
      y += Math.sin(age * 1.7 + enemy.id * 1.9) * 0.22;
    } else {
      x += Math.cos(age * 9 + enemy.id) * 0.55 * k;
      y += Math.sin(age * 11 + enemy.id) * 0.55 * k;
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.userData.peel = MathUtils.clamp(peel / 0.7, 0, 1);
    faceCamera(context, age * 0.35 + enemy.id * 1.7 + k * 1.8);
    return runProgress > anchorU + MISS_GRACE_U;
  }

  function leechPoint(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'leech' }>, t: number, anchorU: number, target: Vector3) {
    const c = MathUtils.clamp(t, 0, 1);
    const eased = c * (2 - c) * 0.35 + c * 0.65; // a little burst of speed on entry
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const wave = Math.sin(c * data.freq * Math.PI * 2 + context.enemy.id * 0.9);
    const y = data.y + data.amp * wave;
    if (data.frame === 'rail') {
      return target.copy(offsetFromRail(context.curve, anchorU, new Vector3(x, y, Math.sin(c * 5 + context.enemy.id) * 0.6)));
    }
    const camera = context.camera;
    const depth = MathUtils.lerp(data.depth, data.toDepth, c);
    const tanH = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const tanW = tanH * camera.aspect;
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const forward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
    return target
      .copy(camera.position)
      .addScaledVector(forward, depth)
      .addScaledVector(right, x * depth * tanW)
      .addScaledVector(up, y * depth * tanH);
  }

  const scratchA = new Vector3();
  const scratchB = new Vector3();

  function updateLeech(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'leech' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = data.frame === 'rail' ? railAnchor(data.lead) : 0;
    const t = (age - data.delay) / data.crossTime;
    leechPoint(context, data, t, anchorU, scratchA);
    leechPoint(context, data, t + 0.04, anchorU, scratchB);
    enemy.mesh.position.copy(scratchA);
    // Nose along the direction of travel; the S-wave animates in the mesh.
    enemy.mesh.lookAt(scratchB);
    enemy.mesh.userData.speedHint = 1;
    if (t > 1.04) return true;
    return data.frame === 'rail' && runProgress > anchorU + MISS_GRACE_U;
  }

  function updateBrooder(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'brooder' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const x = data.x + Math.sin(age * 0.8 + enemy.id) * 0.5;
    const y = data.y + Math.sin(age * 1.1 + enemy.id * 2.3) * 0.6;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    faceCamera(context, Math.sin(age * 0.6 + enemy.id) * 0.3);

    // Closing in wakes it. It swells, then pops a spore toward the rail.
    const state = context.enemyState(() => ({ nextAt: data.firstSpore }));
    const untilSpore = state.nextAt - age;
    enemy.mesh.userData.swell = untilSpore < 0.7 && untilSpore > 0 ? 1 - untilSpore / 0.7 : 0;
    if (age >= state.nextAt && age < data.lead - 0.5) {
      state.nextAt = age + data.period;
      launchSpore(context, enemy.mesh.position);
    } else if (age >= state.nextAt) {
      state.nextAt = Infinity;
    }
    return runProgress > anchorU + MISS_GRACE_U;
  }

  function updateSpore(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'spore' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    // When the parent lets go, the spores it spat wither with it.
    if (boss.freedAt() !== null) return true;
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
      faceCamera(context, age * 5);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.6,
      maxSpeed: 11,
      accel: 2.6,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    // Tail trails opposite its heading.
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > SPORE_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ---------------------------------------------------------------

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    createRail: () => rail,
    spawnTimeline: [...timeline, boss.parentEntry],
    easeRunProgress: runProgress,
    startWord: 'STRAND',
    replayWord: 'REPLAY',
    timing: {
      // A slow, breathing tempo can absorb longer snap periods than the default,
      // but a volley should still land inside two beats of release.
      shotDelay: { maxGridSeconds: 1.25 },
    },
    boss,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'clamper':
          return updateClamper(context, data);
        case 'leech':
          return updateLeech(context, data);
        case 'brooder':
          return updateBrooder(context, data);
        case 'spore':
          return updateSpore(context, data);
        case 'brood':
          return boss.updateBrood(context, data, launchSpore);
        case 'parent':
          return boss.updateParent(context, launchSpore);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'spore') sporesDowned += 1;
      if (enemy.kind === 'clamper') clampersFreed += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping shells, webbing and the parent's carapace pays a little.
    scoreForHit: (_volleySize, enemy) => (enemy.kind === 'parent' ? 90 : 55),
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (boss.freedBy() === 'kill' && score >= 15500 && clearRate >= 0.8) return 'S';
      if (score >= 10500 && clearRate >= 0.62) return 'A';
      if (score >= 6500 && clearRate >= 0.42) return 'B';
      if (score >= 2800 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${STRANDLINE_PLAYER_HEALTH}`];
      lines.push(`${clampersFreed} strand${clampersFreed === 1 ? '' : 's'} freed`);
      if (sporesDowned > 0) lines.push(`${sporesDowned} spore${sporesDowned === 1 ? '' : 's'} intercepted`);
      const bossLine = boss.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}

// Start/replay glyphs are drawn at fixed size; keep the timing tables reachable
// for tools that inspect them.
export const STRANDLINE_TIMELINE: StrandlineEntry[] = buildTimeline().sort((a, b) => a.time - b.time);
export { PARENT_HIT_STAGES, STRANDLINE_TIME };
