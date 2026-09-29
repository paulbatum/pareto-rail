import { MathUtils, Vector3 } from 'three';
import {
  shotBehindCamera,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import type { EventBus } from '../../events';
import { BOSS_CLAMP_HP, createBoss, bossState } from './boss';
import {
  CAR_ANCHORS,
  CAR_FLANKS,
  createSkyhookRail,
  createViewBasis,
  ndcPoint,
  pitchDegAt,
  skyhookRunProgress,
  tanHalfFov,
  viewBasisAt,
} from './space';
import { LATCH_TIME, SKYHOOK_BPM, SKYHOOK_DURATION, bar } from './timing';

// SKYHOOK — a 60-second climb up a space elevator, scored as a thinning:
//
//   Weather  (0–15 s)   Storm cell over the anchor platform. Wind-riders
//                       (kites, mantas) and limpets that go for the car.
//   Deck     (15 s)     Punch through the cloud deck. Sunlit blue.
//   Sunlit   (15–25 s)  Torpedoes join the wind-riders: the car is a target.
//   Thin air (25–35 s)  Vacuum-hardened sentries take over as the sky goes black.
//   Ripper   (35–51 s)  Something huge latches on far above and climbs down.
//   Docking  (52.5 s+)  The station opens overhead and swallows the car.
//
// Enemies are placed in *screen space* relative to the climb view (see
// space.ts): the car outruns anything fixed to the cable, so hostiles pace it
// and the world falls away underneath. Some go for you (bolts), some go for the
// car (limpets, torpedoes, hooks). Both end the same way: the hull.

export { SKYHOOK_BPM, SKYHOOK_DURATION };
export const SKYHOOK_HULL = 8;
export const LIMPET_ARRIVE = 2.8;
export const LIMPET_GNAW = 5.2;
export const TORPEDO_FLIGHT = 4.0;

export type SkyhookKind =
  | 'kite'
  | 'manta'
  | 'limpet'
  | 'sentry'
  | 'bolt'
  | 'torpedo'
  | 'hook'
  | 'clamp'
  | 'core'
  | 'hauler';

export type SentryStop = { nx: number; ny: number; z: number; hold: number; shoot?: boolean };

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in enemyState bags; boss state lives in boss.ts.
export type SkyhookData =
  | { role: 'kite'; fromX: number; toX: number; y: number; amp: number; waves: number; phase: number; cross: number; z0: number; z1: number }
  | { role: 'ring'; index: number; count: number; spin: number; phase: number; rx: number; ry: number; cy: number; life: number; z0: number; z1: number }
  | { role: 'manta'; fromX: number; fromY: number; toX: number; toY: number; bow: number; dur: number; z0: number; z1: number }
  | { role: 'limpet'; anchor: number; startX: number; startY: number; z0: number; spin: number }
  | { role: 'sentry'; path: SentryStop[] }
  | { role: 'bolt'; nx: number; ny: number; z0: number; speed: number }
  | { role: 'torpedo' | 'hook'; side: number; startX: number; startY: number; z0: number; dur: number }
  | { role: 'clamp'; index: number }
  | { role: 'core' }
  | { role: 'hauler' };

export type SkyhookEntry = LockOnSpawnEntry<SkyhookKind, SkyhookData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookKind, SkyhookData>;

// ---- timeline builders -------------------------------------------------------------

type KiteOptions = { gap?: number; cross?: number; amp?: number; waves?: number; z0?: number; z1?: number };

/** A flock of wind-riders crossing the frame; entry i lands `gap` seconds after i-1. */
const kites = (time: number, dir: 1 | -1, ys: number[], options: KiteOptions = {}): SkyhookEntry[] =>
  ys.map((y, index) => ({
    time: time + index * (options.gap ?? 0.26),
    kind: 'kite',
    data: {
      role: 'kite',
      fromX: -dir * 1.25,
      toX: dir * 1.25,
      y,
      amp: options.amp ?? 0.12,
      waves: options.waves ?? 1.5,
      phase: index * 1.3 + (dir > 0 ? 0 : 2),
      cross: options.cross ?? 3.8,
      z0: options.z0 ?? 44,
      z1: options.z1 ?? 16,
    },
  }));

/** A wheel of wind-riders orbiting the view: one sweep of the reticle takes the whole ring. */
const ring = (time: number, count: number, options: { spin?: number; phase?: number; rx?: number; ry?: number; cy?: number; life?: number; z0?: number; z1?: number } = {}): SkyhookEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    time: time + index * 0.09,
    kind: 'kite' as const,
    data: {
      role: 'ring' as const,
      index,
      count,
      spin: options.spin ?? 0.55,
      phase: options.phase ?? 0,
      rx: options.rx ?? 0.86,
      ry: options.ry ?? 0.56,
      cy: options.cy ?? 0.06,
      life: options.life ?? 4.6,
      z0: options.z0 ?? 42,
      z1: options.z1 ?? 22,
    },
  }));

const manta = (time: number, from: [number, number], to: [number, number], dur = 5.6, bow = 0, z0 = 34, z1 = 25): SkyhookEntry => ({
  time,
  kind: 'manta',
  hitStages: [2],
  data: { role: 'manta', fromX: from[0], fromY: from[1], toX: to[0], toY: to[1], bow, dur, z0, z1 },
});

const limpet = (time: number, anchor: number, start: [number, number], z0 = 40): SkyhookEntry => ({
  time,
  kind: 'limpet',
  data: { role: 'limpet', anchor, startX: start[0], startY: start[1], z0, spin: anchor % 2 === 0 ? 1 : -1 },
});

const torpedo = (time: number, side: -1 | 1, start: [number, number], z0 = 54): SkyhookEntry => ({
  time,
  kind: 'torpedo',
  data: { role: 'torpedo', side, startX: start[0], startY: start[1], z0, dur: TORPEDO_FLIGHT },
});

// Sentries hold at authored depths (the exit leg is left alone); keep them close.
const sentry = (time: number, path: SentryStop[]): SkyhookEntry => ({
  time,
  kind: 'sentry',
  hitStages: [2, 1],
  data: { role: 'sentry', path: path.map((stop, index) => (index === path.length - 1 ? stop : { ...stop, z: stop.z * 0.86 })) },
});

// The boss's hidden clock: never lockable, never counted, parked behind the camera.
const haulerClock = (time: number): SkyhookEntry => ({
  time,
  kind: 'hauler',
  lockable: false,
  countsTowardTotal: false,
  data: { role: 'hauler' },
});

function buildTimeline(): SkyhookEntry[] {
  const at = bar;
  return [
    // --- Weather. Learn the sweep: wind-riders cross in flocks, high and low,
    // never through the middle; a limpet teaches that the car is a target too.
    ...kites(at(1), 1, [0.76, 0.62, 0.48, 0.34], { cross: 3.3 }),
    ...kites(at(2), -1, [-0.36, -0.5, -0.64, -0.42, -0.56]),
    limpet(at(2, 3), 0, [-0.2, 0.3]),
    manta(at(3), [-0.95, 0.5], [0.95, 0.5], 5.6, 0.34),
    ...kites(at(3, 2), -1, [0.72, 0.54, 0.36], { amp: 0.08 }),
    ...kites(at(4), 1, [-0.38, -0.52, -0.66], { z0: 44, waves: 1.2 }),
    ...kites(at(4), -1, [0.68, 0.52, 0.36], { z0: 56, waves: 1.2, gap: 0.3 }),
    limpet(at(4, 2), 1, [0.25, 0.35]),
    manta(at(5), [0.95, -0.5], [-0.95, -0.5], 5.4, -0.26),
    manta(at(5, 1), [-0.95, 0.56], [0.95, 0.62], 5.2, 0.3),
    ...kites(at(5, 3), -1, [0.72, 0.56, 0.4, 0.3], { gap: 0.22, cross: 3.0 }),

    // --- Sunlit. The drop: six kites open the sky; then the car gets hunted.
    ...kites(at(6, 1), 1, [0.76, 0.56, 0.36], { gap: 0.2, waves: 1.0, z0: 44 }),
    ...kites(at(6, 1), -1, [-0.4, -0.56, -0.72], { gap: 0.2, waves: 1.0, z0: 48 }),
    limpet(at(6, 3), 3, [0.3, 0.4]),
    manta(at(7), [-0.95, -0.5], [0.95, -0.48], 5.4, -0.28),
    torpedo(at(7, 2), -1, [-0.72, -0.95]),
    // The wheel: six wind-riders orbit the view — the level's signature full-volley sweep.
    ...ring(at(8), 6, { spin: 0.55 }),
    ...kites(at(9, 1), -1, [-0.4, -0.56, -0.7], { gap: 0.28, amp: 0.1, waves: 2.2, cross: 3.5 }),
    torpedo(at(8, 2), 1, [0.7, -0.95]),
    manta(at(9), [0.95, 0.6], [-0.95, 0.56], 5.6, 0.3),
    limpet(at(9), 0, [-0.1, 0.2]),
    ...kites(at(9, 2), -1, [0.74, 0.58, 0.42, 0.34, -0.4, -0.56], { gap: 0.2, cross: 3.0, amp: 0.06 }),

    // --- Thin air. The wind-riders are gone; the sentries hold position in
    // vacuum and the car is hunted from below.
    sentry(at(10), [
      { nx: -1.05, ny: 0.5, z: 52, hold: 0.1 },
      { nx: -0.66, ny: 0.42, z: 42, hold: 1.5, shoot: true },
      { nx: -0.3, ny: 0.62, z: 36, hold: 1.4, shoot: true },
      { nx: -1.2, ny: 0.95, z: 90, hold: 0 },
    ]),
    sentry(at(10, 1), [
      { nx: 1.05, ny: 0.3, z: 52, hold: 0.1 },
      { nx: 0.68, ny: 0.26, z: 42, hold: 1.5, shoot: true },
      { nx: 0.36, ny: 0.5, z: 36, hold: 1.4, shoot: true },
      { nx: 1.2, ny: 0.95, z: 90, hold: 0 },
    ]),
    torpedo(at(10, 3), 1, [0.6, -0.95]),
    limpet(at(11), 2, [-0.4, 0.5]),
    limpet(at(11, 1), 3, [0.4, 0.6]),
    sentry(at(11, 2), [
      { nx: 0.0, ny: 1.0, z: 60, hold: 0.1 },
      { nx: -0.08, ny: 0.62, z: 40, hold: 1.6, shoot: true },
      { nx: 0.5, ny: 0.7, z: 34, hold: 1.3, shoot: true },
      { nx: 1.2, ny: 1.0, z: 92, hold: 0 },
    ]),
    torpedo(at(11, 3), -1, [-0.85, -0.95]),
    torpedo(at(12), 1, [0.85, -0.9]),
    sentry(at(12, 2), [
      { nx: -1.05, ny: 0.2, z: 50, hold: 0.1 },
      { nx: -0.7, ny: 0.05, z: 38, hold: 1.4, shoot: true },
      { nx: -0.55, ny: 0.55, z: 32, hold: 1.4, shoot: true },
      { nx: -1.3, ny: 1.0, z: 92, hold: 0 },
    ]),
    sentry(at(12, 2.5), [
      { nx: 1.05, ny: 0.65, z: 50, hold: 0.1 },
      { nx: 0.72, ny: 0.55, z: 40, hold: 1.4, shoot: true },
      { nx: 0.5, ny: 0.1, z: 32, hold: 1.4, shoot: true },
      { nx: 1.3, ny: 1.0, z: 92, hold: 0 },
    ]),
    limpet(at(13, 1), 1, [0.0, 0.4]),

    // --- The Ripper latches onto the cable (bar 14). Its clamps are targets from
    // the moment it grips; the core opens once all four are torn off.
    ...[0, 1, 2, 3].map((index): SkyhookEntry => ({
      time: LATCH_TIME + 0.4 + index * 0.05,
      kind: 'clamp',
      hitPoints: BOSS_CLAMP_HP,
      data: { role: 'clamp', index },
    })),
    haulerClock(LATCH_TIME),

    // Adds while the Ripper climbs: the car keeps being hunted.
    limpet(at(15, 1), 0, [-0.1, 0.4]),
    sentry(at(16), [
      { nx: -1.05, ny: -0.1, z: 50, hold: 0.1 },
      { nx: -0.78, ny: -0.2, z: 40, hold: 1.5, shoot: true },
      { nx: -0.7, ny: 0.4, z: 34, hold: 1.4, shoot: true },
      { nx: -1.3, ny: 1.0, z: 92, hold: 0 },
    ]),
    sentry(at(16, 1), [
      { nx: 1.05, ny: -0.05, z: 50, hold: 0.1 },
      { nx: 0.78, ny: -0.15, z: 40, hold: 1.5, shoot: true },
      { nx: 0.7, ny: 0.45, z: 34, hold: 1.4, shoot: true },
      { nx: 1.3, ny: 1.0, z: 92, hold: 0 },
    ]),
    torpedo(at(17), -1, [-0.8, -0.95]),
    limpet(at(17, 3), 2, [-0.3, 0.6]),
    sentry(at(18), [
      { nx: 0.0, ny: 1.05, z: 56, hold: 0.1 },
      { nx: -0.55, ny: -0.35, z: 36, hold: 1.5, shoot: true },
      { nx: 0.55, ny: -0.3, z: 32, hold: 1.4, shoot: true },
      { nx: 1.3, ny: 0.3, z: 92, hold: 0 },
    ]),
    torpedo(at(19, 1), -1, [-0.7, -0.95]),
    sentry(at(19, 3), [
      { nx: -1.05, ny: 0.6, z: 48, hold: 0.1 },
      { nx: -0.75, ny: 0.55, z: 38, hold: 1.4, shoot: true },
      { nx: 0.75, ny: 0.55, z: 34, hold: 1.4, shoot: true },
      { nx: 1.3, ny: 1.0, z: 92, hold: 0 },
    ]),
  ].sort((a, b) => a.time - b.time);
}

export const SKYHOOK_TIMELINE: SkyhookEntry[] = buildTimeline();

const KILL_SCORE: Record<SkyhookKind, number> = {
  kite: 100,
  manta: 240,
  limpet: 160,
  sentry: 320,
  bolt: 50,
  torpedo: 180,
  hook: 140,
  clamp: 420,
  core: 3000,
  hauler: 0,
};

// ---- the view -----------------------------------------------------------------------

const basis = createViewBasis();
let basisTime = -1;
const scratchA = new Vector3();

function viewFor(context: SkyhookUpdate) {
  if (basisTime !== context.runTime) {
    viewBasisAt(context.curve, context.runTime, basis);
    basisTime = context.runTime;
  }
  return basis;
}

function put(context: SkyhookUpdate, nx: number, ny: number, z: number, out: Vector3) {
  return ndcPoint(viewFor(context), context.camera.aspect, nx, ny, z, out, tanHalfFov(context.camera.fov));
}

/** Position the mesh at (nx, ny, z) and aim its +Z at where it will be `lookAhead` seconds on. */
function placeFacing(
  context: SkyhookUpdate,
  now: { nx: number; ny: number; z: number },
  next: { nx: number; ny: number; z: number },
) {
  const mesh = context.enemy.mesh;
  put(context, now.nx, now.ny, now.z, mesh.position);
  put(context, next.nx, next.ny, next.z, scratchA);
  if (scratchA.distanceToSquared(mesh.position) > 1e-6) mesh.lookAt(scratchA);
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp01 = (t: number) => MathUtils.clamp(t, 0, 1);

// ---- level definition ------------------------------------------------------------------

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookKind, SkyhookData> {
  const timeline = SKYHOOK_TIMELINE;
  const boss = createBoss(bus);
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let limpetsBored = 0;
  let torpedoesDown = 0;
  let shotsDown = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    limpetsBored = 0;
    torpedoesDown = 0;
    shotsDown = 0;
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

  function markImpact(context: SkyhookUpdate) {
    context.enemy.mesh.userData.impacted = true;
  }

  // ---- wind-riders --------------------------------------------------------------------

  function kitePoint(data: Extract<SkyhookData, { role: 'kite' }>, t: number) {
    const e = MathUtils.lerp(t, smooth(t), 0.35);
    return {
      nx: MathUtils.lerp(data.fromX, data.toX, e),
      ny: data.y + data.amp * Math.sin(t * Math.PI * data.waves + data.phase),
      z: MathUtils.lerp(data.z0, data.z1, t),
    };
  }

  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookData, { role: 'kite' }>) {
    const t = context.age / data.cross;
    if (t > 1) return true;
    placeFacing(context, kitePoint(data, t), kitePoint(data, Math.min(1.2, t + 0.04)));
    // Bank into the gust: roll follows the vertical swing of the path.
    const swing = Math.cos(t * Math.PI * data.waves + data.phase);
    context.enemy.mesh.rotateZ(swing * 0.7 * Math.sign(data.toX - data.fromX));
    context.enemy.mesh.userData.gust = swing;
    return false;
  }

  function ringPoint(data: Extract<SkyhookData, { role: 'ring' }>, age: number) {
    const t = clamp01(age / data.life);
    const angle = data.phase + (data.index / data.count) * Math.PI * 2 + age * data.spin;
    // The wheel swings in from the side and out again: it never sits in the middle.
    const swing = Math.sin(t * Math.PI);
    return {
      nx: Math.cos(angle) * data.rx * (0.55 + 0.45 * swing),
      ny: data.cy + Math.sin(angle) * data.ry * (0.6 + 0.4 * swing),
      z: MathUtils.lerp(data.z0, data.z1, t),
    };
  }

  function updateRing(context: SkyhookUpdate, data: Extract<SkyhookData, { role: 'ring' }>) {
    if (context.age > data.life) return true;
    placeFacing(context, ringPoint(data, context.age), ringPoint(data, context.age + 0.05));
    context.enemy.mesh.rotateZ(Math.sin(context.age * 3 + context.enemy.id) * 0.4);
    context.enemy.mesh.userData.gust = Math.cos(context.age * 3 + context.enemy.id);
    return false;
  }

  function mantaPoint(data: Extract<SkyhookData, { role: 'manta' }>, t: number) {
    const e = smooth(clamp01(t));
    return {
      nx: MathUtils.lerp(data.fromX, data.toX, e),
      ny: MathUtils.lerp(data.fromY, data.toY, e) + data.bow * Math.sin(Math.PI * e) + Math.sin(t * 5.2) * 0.03,
      z: MathUtils.lerp(data.z0, data.z1, smooth(clamp01(t * 1.3))),
    };
  }

  function updateManta(context: SkyhookUpdate, data: Extract<SkyhookData, { role: 'manta' }>) {
    const t = context.age / data.dur;
    if (t > 1.02) return true;
    placeFacing(context, mantaPoint(data, t), mantaPoint(data, Math.min(1.1, t + 0.05)));
    context.enemy.mesh.rotateZ(Math.sin(context.age * 1.4 + context.enemy.id) * 0.22);
    return false;
  }

  // ---- limpets: they go for the car -------------------------------------------------------

  function updateLimpet(context: SkyhookUpdate, data: Extract<SkyhookData, { role: 'limpet' }>) {
    const { enemy, age } = context;
    const anchor = CAR_ANCHORS[data.anchor];
    const q = clamp01(age / LIMPET_ARRIVE);
    const e = smooth(Math.pow(q, 1.25));
    // A lazy corkscrew: slow enough that a homing shot can always run it down.
    const swirl = (1 - e) * 0.07;
    const nx = MathUtils.lerp(data.startX, anchor.nx, e) + Math.cos(age * 3 * data.spin) * swirl;
    const ny = MathUtils.lerp(data.startY, anchor.ny, e) + Math.sin(age * 3 * data.spin) * swirl;
    const z = MathUtils.lerp(data.z0, anchor.depth, e);
    const mesh = enemy.mesh;
    put(context, nx, ny, z, mesh.position);
    mesh.quaternion.copy(context.camera.quaternion);
    mesh.userData.side = data.anchor % 2 === 0 ? -1 : 1; // which side of the car it is attacking
    if (q < 1) {
      mesh.rotateZ(age * 3 * data.spin);
      mesh.userData.latched = false;
      return false;
    }
    // Clamped on: it gnaws through the hull. The longer it holds, the hotter it glows.
    const gnaw = clamp01((age - LIMPET_ARRIVE) / LIMPET_GNAW);
    mesh.userData.latched = true;
    mesh.userData.gnaw = gnaw;
    mesh.position.x += Math.sin(age * 41) * 0.03 * (0.4 + gnaw);
    mesh.position.y += Math.cos(age * 37) * 0.03 * (0.4 + gnaw);
    mesh.rotateZ(data.anchor * 1.7);
    if (gnaw >= 1) {
      markImpact(context);
      limpetsBored += 1;
      context.damagePlayer(1);
      return true;
    }
    return false;
  }

  // ---- sentries: vacuum-hardened, they hop between fixed points and shoot at you -------------

  const HOP_SECONDS = 0.46;
  const EXIT_SECONDS = 1.0;

  function fireBolt(context: SkyhookUpdate, nx: number, ny: number, z: number) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', nx, ny, z0: Math.min(z, 38), speed: 15 },
    });
  }

  function updateSentry(context: SkyhookUpdate, data: Extract<SkyhookData, { role: 'sentry' }>) {
    const { enemy, age } = context;
    const state = context.enemyState(() => ({ fired: new Set<number>() }));
    const path = data.path;
    // Walk the waypoint list: a hop, then a hold, then the next hop.
    let cursor = 0;
    let from = path[0];
    let to = path[0];
    let hopProgress = 1;
    let holdElapsed = 0;
    let stopIndex = 0;
    let done = true;
    for (let i = 0; i < path.length; i += 1) {
      const last = i === path.length - 1;
      const travel = i === 0 ? 0 : last ? EXIT_SECONDS : HOP_SECONDS;
      const hop = cursor + travel;
      if (age < hop) {
        from = path[Math.max(0, i - 1)];
        to = path[i];
        hopProgress = travel === 0 ? 1 : (age - cursor) / travel;
        stopIndex = i;
        done = false;
        break;
      }
      cursor = hop + path[i].hold;
      if (age < cursor) {
        from = path[i];
        to = path[i];
        holdElapsed = age - hop;
        stopIndex = i;
        done = false;
        break;
      }
      if (last) {
        from = path[i];
        to = path[i];
      }
    }
    if (done) return true;

    // RCS hop: hard burn, coast, brake — no gliding, no wind.
    const e = hopProgress >= 1 ? 1 : smoother(clamp01(hopProgress));
    const stop = path[stopIndex];
    const jitter = hopProgress >= 1 && stop.hold > 0 ? 1 : 0;
    const nx = MathUtils.lerp(from.nx, to.nx, e) + Math.sin(age * 2.3 + enemy.id) * 0.008 * jitter;
    const ny = MathUtils.lerp(from.ny, to.ny, e) + Math.cos(age * 1.9 + enemy.id) * 0.008 * jitter;
    const z = MathUtils.lerp(from.z, to.z, e);
    const mesh = enemy.mesh;
    put(context, nx, ny, z, mesh.position);
    mesh.quaternion.copy(context.camera.quaternion);
    mesh.rotateZ(Math.sin(age * 0.6 + enemy.id) * 0.12);

    const moving = hopProgress < 1;
    mesh.userData.thrust = moving ? Math.sin(clamp01(hopProgress) * Math.PI) : 0;
    mesh.userData.hopDir = Math.sign(to.nx - from.nx);
    // Telegraph, then fire: the lens winds up through the last 0.7 s of each hold.
    let charge = 0;
    if (!moving && stop.shoot) {
      charge = clamp01((holdElapsed - (stop.hold - 0.7)) / 0.7);
      if (holdElapsed >= stop.hold - 0.06 && !state.fired.has(stopIndex)) {
        state.fired.add(stopIndex);
        fireBolt(context, nx, ny, z);
      }
    }
    mesh.userData.charge = charge;
    return false;
  }

  function updateBolt(context: SkyhookUpdate, data: Extract<SkyhookData, { role: 'bolt' }>) {
    const { enemy, age, camera } = context;
    const state = context.enemyState(() => ({
      position: new Vector3(),
      velocity: new Vector3(),
      impact: {} as HostileShotImpactState,
    }));
    const mesh = enemy.mesh;
    if (state.impact.impactAt !== undefined) {
      const impact = updateHostileShotImpact({
        age,
        camera,
        position: state.position,
        velocity: state.velocity,
        state: state.impact,
        intercepted: interceptions.delete(enemy.id),
      });
      mesh.position.copy(state.position);
      mesh.quaternion.copy(camera.quaternion);
      mesh.rotateZ(age * 9);
      if (impact.phase === 'braking' && impact.damaged) {
        markImpact(context);
        context.damagePlayer(1);
        return true;
      }
      return false;
    }

    // Closing on the camera: accelerate, and converge on the centre of the view.
    const z = Math.max(2.2, data.z0 - data.speed * age - 3 * age * age);
    const travelled = clamp01((data.z0 - z) / Math.max(1, data.z0 - 2.4));
    const pull = Math.pow(1 - travelled, 1.35);
    put(context, data.nx * pull, data.ny * pull, z, state.position);
    mesh.position.copy(state.position);
    mesh.quaternion.copy(camera.quaternion);
    mesh.rotateZ(age * 7);
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: state.position,
      velocity: state.velocity,
      state: state.impact,
      intercepted: interceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') mesh.position.copy(state.position);
    return shotBehindCamera(camera, mesh.position, 4);
  }

  // ---- torpedoes and hooks: they go for the car ----------------------------------------------

  function updateSeeker(context: SkyhookUpdate, data: Extract<SkyhookData, { role: 'torpedo' | 'hook' }>) {
    const { enemy, age } = context;
    const flank = CAR_FLANKS[data.side < 0 ? 0 : 1];
    const q = age / data.dur;
    if (q >= 1) {
      markImpact(context);
      context.damagePlayer(1);
      return true;
    }
    const point = (t: number) => {
      const e = Math.pow(clamp01(t), 1.7);
      const arc = Math.sin(clamp01(t) * Math.PI) * 0.22 * data.side;
      return {
        nx: MathUtils.lerp(data.startX, flank.nx, e) - arc * (1 - e),
        ny: MathUtils.lerp(data.startY, flank.ny, e) + arc * 0.6,
        z: MathUtils.lerp(data.z0, flank.depth, Math.pow(clamp01(t), 1.25)),
      };
    };
    placeFacing(context, point(q), point(Math.min(1.1, q + 0.04)));
    enemy.mesh.rotateZ(age * (data.role === 'hook' ? 4 : 9));
    enemy.mesh.userData.closing = q;
    enemy.mesh.userData.side = data.side;
    return false;
  }

  // ---- level ------------------------------------------------------------------------------------

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    playerHealth: SKYHOOK_HULL,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    startWord: 'ASCEND',
    replayWord: 'AGAIN',
    timing: { shotDelay: { maxGridSeconds: 1.25 } },
    updateAttractCamera({ camera, curve, modeTime }) {
      // Hold on the launch cradle: the tether climbs away into the storm.
      const base = curve.getPointAt(0);
      camera.position.copy(base);
      camera.position.x += Math.sin(modeTime * 0.5) * 0.12;
      camera.position.y += Math.cos(modeTime * 0.7) * 0.08;
      camera.lookAt(curve.getPointAt(0.025));
      camera.rotateX(-(pitchDegAt(0) * Math.PI) / 180);
    },
    updateCameraEffects({ camera, runTime }) {
      // The pitch that frames the climb (see space.ts). Enemy placement uses the
      // same function, so every hostile lands where the view says it will. The
      // runner spends the first second easing from the attract camera — which
      // already carries the pitch — so the pitch is phased in with the same ease.
      const ease = MathUtils.smoothstep(runTime, 0, 1);
      camera.rotateX(-(pitchDegAt(runTime) * ease * Math.PI) / 180);
      camera.updateMatrixWorld();
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'kite':
          return updateKite(context, data);
        case 'ring':
          return updateRing(context, data);
        case 'manta':
          return updateManta(context, data);
        case 'limpet':
          return updateLimpet(context, data);
        case 'sentry':
          return updateSentry(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'torpedo':
        case 'hook':
          return updateSeeker(context, data);
        case 'clamp':
          return boss.updateClamp(context, data);
        case 'core':
          return boss.updateCore(context);
        case 'hauler':
          return boss.updateHauler(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'torpedo' || enemy.kind === 'hook') torpedoesDown += 1;
      if (enemy.kind === 'bolt') shotsDown += 1;
      const altitude = 1 + 0.5 * clamp01(enemy.spawnTime / 48);
      const chain = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * chain * altitude);
    },
    scoreForHit: () => 45,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 700 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (bossState.killed && score >= 21000 && clear >= 0.8) return 'S';
      if (score >= 14000 && clear >= 0.62) return 'A';
      if (score >= 8500 && clear >= 0.42) return 'B';
      if (score >= 3500 && clear >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [`Hull ${Math.max(0, SKYHOOK_HULL - hitsTaken)}/${SKYHOOK_HULL}`];
      if (torpedoesDown > 0) lines.push(`${torpedoesDown} missile${torpedoesDown === 1 ? '' : 's'} shot from the sky`);
      if (limpetsBored > 0) lines.push(`${limpetsBored} limpet${limpetsBored === 1 ? '' : 's'} chewed through`);
      if (bossState.killed) lines.push('The Ripper is off the cable');
      else if (bossState.sheared) lines.push('The dock clamps sheared the Ripper off');
      else if (bossState.phase !== 'idle') lines.push('The Ripper is still on the cable');
      return lines;
    },
  };
}

