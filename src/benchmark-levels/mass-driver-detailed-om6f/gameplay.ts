import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  MD_BEAT_SECONDS,
  MD_BORE_RADIUS,
  MD_BPM,
  MD_KLAXON_TIME,
  MD_MUZZLE_U,
  MD_RAIL_LENGTH,
  MD_RUN_DURATION,
  MD_SHOT_TIME,
  MD_TIME,
  chargeAt,
  railProgress,
  railSpeedFactor,
} from './timing';
import { emitSignal, mdRun, resetRunState } from './state';

export { MD_BPM, MD_RUN_DURATION } from './timing';

export const MD_PLAYER_HEALTH = 3;
export const MD_INTERLOCK_COUNT = 6;

export type MdEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

type CoilData = {
  role: 'coil';
  engagement: RailLead;
  /** Clock angle on the bore rim, measured from +X. */
  angle: number;
  /** Circumferential crawl, radians per second. */
  drift: number;
  fires: boolean;
};

type ThreaderData = {
  role: 'threader';
  engagement: RailLead;
  from: number;
  to: number;
  yFrom: number;
  yTo: number;
  arc: number;
  /** Helix handedness. Pairs spawn with opposite signs so they read as a double helix. */
  sign: number;
  phase: number;
};

type CapacitorData = {
  role: 'capacitor';
  engagement: RailLead;
  offset: Vector3;
  phase: number;
};

type InterlockData = {
  role: 'interlock';
  angle: number;
  index: number;
  fires: boolean;
};

type ArcData = {
  role: 'arc';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type MdSpawnData = CoilData | ThreaderData | CapacitorData | InterlockData | ArcData;
export type MdSpawnEntry = LockOnSpawnEntry<MdEnemyKind, MdSpawnData>;
type MdUpdate = LockOnEnemyUpdate<MdEnemyKind, MdSpawnData>;

// ---------------------------------------------------------------------------
// The bore
// ---------------------------------------------------------------------------

const RAIL_POINTS = 161;
const WEAVE_CYCLES_X = 11;
const WEAVE_CYCLES_Y = 7.5;
const WEAVE_AMPLITUDE_X = 34;
const WEAVE_AMPLITUDE_Y = 20;
const MUZZLE_LIFT = 120;
const TAU = Math.PI * 2;

/**
 * A long line down the bore with a gentle weave so the tunnel reads and the
 * drones get parallax. The weave tapers to zero just before the muzzle so the
 * exit is dead straight, and past the muzzle the line lifts away into the black.
 */
export function createMassDriverRail() {
  const points: Vector3[] = [];
  const taperEnd = MD_MUZZLE_U * 0.94;
  for (let i = 0; i < RAIL_POINTS; i += 1) {
    const f = i / (RAIL_POINTS - 1);
    const taper = f >= taperEnd ? 0 : (1 - f / taperEnd) ** 0.7;
    const beyond = f <= MD_MUZZLE_U ? 0 : (f - MD_MUZZLE_U) / (1 - MD_MUZZLE_U);
    points.push(new Vector3(
      Math.sin(TAU * f * WEAVE_CYCLES_X) * WEAVE_AMPLITUDE_X * taper,
      Math.sin(TAU * f * WEAVE_CYCLES_Y + 0.9) * WEAVE_AMPLITUDE_Y * taper + beyond * beyond * MUZZLE_LIFT,
      -MD_RAIL_LENGTH * f,
    ));
  }
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  // 161 control points need a finer arc-length table than the three.js default.
  curve.arcLengthDivisions = 1500;
  return curve;
}

export const MD_RAIL = createMassDriverRail();

const pacer = createRailPacer({
  curve: MD_RAIL,
  duration: MD_RUN_DURATION,
  runProgress: railProgress,
  // Just inside the fog wall: targets appear at the edge of the readable bore
  // and close from there, so the engagement window equals the authored lead at
  // any speed. Without this the late bars would spawn targets past the fog.
  spawnAheadUnits: 34,
  defaultLeadSeconds: 3.5,
});

// ---------------------------------------------------------------------------
// Spawn choreography
// ---------------------------------------------------------------------------

const at = (bar: number, beat = 0) => MD_TIME.bar(bar, beat);
const STAGGER = MD_BEAT_SECONDS / 4;

/** Frame-rim clock positions, measured from +X. */
const CLOCK: Record<number, number> = {
  12: Math.PI / 2,
  1: Math.PI / 3,
  2: Math.PI / 6,
  4: -Math.PI / 6,
  5: -Math.PI / 3,
  6: -Math.PI / 2,
  7: -2 * Math.PI / 3,
  8: -5 * Math.PI / 6,
  10: 5 * Math.PI / 6,
  11: 2 * Math.PI / 3,
};

const COIL_RADIUS = MD_BORE_RADIUS - 1.6;

function coilRank(
  time: number,
  clocks: number[],
  options: { lead?: number; firing?: number[]; drift?: number } = {},
): MdSpawnEntry[] {
  const lead = options.lead ?? 3.5;
  const firing = new Set(options.firing ?? []);
  return clocks.map((clock, index) => {
    const entryTime = time + index * STAGGER;
    return {
      time: entryTime,
      kind: 'coil' as const,
      data: {
        role: 'coil' as const,
        engagement: pacer.resolve(entryTime, lead),
        angle: CLOCK[clock] ?? 0,
        drift: (options.drift ?? 0.3) * (index % 2 === 0 ? 1 : -1),
        fires: firing.has(clock),
      },
    };
  });
}

function threaders(
  time: number,
  specs: Array<{ dir: 1 | -1; y: [number, number]; arc?: number; sign?: 1 | -1; delay?: number; lead?: number }>,
): MdSpawnEntry[] {
  return specs.map((spec, index) => {
    const entryTime = time + (spec.delay ?? index * STAGGER * 2);
    const span = 9.2;
    return {
      time: entryTime,
      kind: 'threader' as const,
      data: {
        role: 'threader' as const,
        engagement: pacer.resolve(entryTime, spec.lead ?? 3.4),
        from: -span * spec.dir,
        to: span * spec.dir,
        yFrom: spec.y[0],
        yTo: spec.y[1],
        // The crossing bows the way it is already travelling, so a rising
        // threader arcs over the frame and a falling one dips under it —
        // twice the vertical spread for the same shallow arc.
        arc: (spec.arc ?? 5.2) * (spec.y[1] >= spec.y[0] ? 1 : -1),
        sign: spec.sign ?? (index % 2 === 0 ? 1 : -1),
        phase: index * 1.9,
      },
    };
  });
}

function capacitors(
  time: number,
  places: Array<[number, number]>,
  options: { lead?: number; stagger?: number } = {},
): MdSpawnEntry[] {
  return places.map((place, index) => {
    const entryTime = time + index * (options.stagger ?? STAGGER * 3);
    return {
      time: entryTime,
      kind: 'capacitor' as const,
      // Two hits shear the staves off; two more kill the exposed core.
      hitStages: [2, 2],
      data: {
        role: 'capacitor' as const,
        engagement: pacer.resolve(entryTime, options.lead ?? 3.9),
        offset: new Vector3(place[0], place[1], 0),
        phase: index * 2.3,
      },
    };
  });
}

function interlockRank(time: number, clocks: number[], firing: number[], from: number): MdSpawnEntry[] {
  return clocks.map((clock, index) => ({
    time: time + index * STAGGER * 2,
    kind: 'interlock' as const,
    // The cowl pops first, then the actuator core takes two.
    hitStages: [1, 2],
    data: {
      role: 'interlock' as const,
      angle: CLOCK[clock] ?? 0,
      index: from + index,
      fires: firing.includes(clock),
    },
  }));
}

const MD_TIMELINE: MdSpawnEntry[] = sortTimeline([
  // --- injection (bars 0-4): the breech. The counter-rotating threader pair is
  // the double-helix reveal; the four-coil rank teaches the rim sweep.
  ...threaders(at(0, 2), [
    { dir: 1, y: [-4, 4], sign: 1 },
    { dir: -1, y: [4, -4], sign: -1, delay: 0 },
  ]),
  ...coilRank(at(1, 2), [10, 12, 2, 4], { lead: 3.7 }),
  ...threaders(at(2, 2), [{ dir: -1, y: [3, -3], arc: 4.2 }]),
  ...threaders(at(3, 2), [{ dir: 1, y: [-5, 2] }]),

  // --- stage-1 (bars 4-12): the four-on-floor locks in. Coil ranks and
  // threader weaves trade two-bar phrases; the first capacitor drifts in.
  ...coilRank(at(4, 0), [12, 4, 8]),
  ...threaders(at(5, 0), [
    { dir: 1, y: [-5, 3], sign: 1 },
    { dir: -1, y: [4, -4], sign: -1 },
  ]),
  ...coilRank(at(6, 0), [2, 6, 10]),
  ...threaders(at(7, 0), [
    { dir: -1, y: [2, -5], sign: -1 },
    { dir: 1, y: [-3, 5], sign: 1 },
  ]),
  ...capacitors(at(8, 0), [[-7.4, 5.4]]),
  ...coilRank(at(8, 2), [12, 2, 10], { lead: 3.4 }),
  ...threaders(at(9, 0), [{ dir: 1, y: [-4, 4], sign: 1 }]),
  ...coilRank(at(10, 0), [4, 6, 8]),
  ...threaders(at(11, 0), [
    { dir: -1, y: [3, -4], sign: -1 },
    { dir: 1, y: [-5, 1], sign: 1 },
  ]),

  // --- stage-2 (bars 12-20): density plus return fire; coils start shooting.
  ...coilRank(at(12, 0), [10, 12, 2, 6], { firing: [12, 6], lead: 3.4 }),
  ...threaders(at(13, 0), [
    { dir: 1, y: [-5, 4], sign: 1 },
    { dir: -1, y: [4, -5], sign: -1 },
  ]),
  ...capacitors(at(14, 0), [[-7.8, -4.6], [7.4, 5.2]]),
  ...coilRank(at(14, 2), [8, 4, 2], { firing: [4], lead: 3.3 }),
  ...threaders(at(15, 0), [
    { dir: -1, y: [5, -3], sign: -1 },
    { dir: 1, y: [-4, 5], sign: 1 },
  ]),
  ...coilRank(at(16, 0), [12, 2, 4, 8, 10], { firing: [2, 8], lead: 3.3 }),
  ...threaders(at(17, 0), [
    { dir: 1, y: [-5, 2], sign: 1 },
    { dir: -1, y: [3, -5], sign: -1 },
  ]),
  ...capacitors(at(17, 2), [[7.0, -6.2]]),
  ...coilRank(at(18, 0), [11, 1, 5], { firing: [11, 5], lead: 3.2 }),
  ...threaders(at(18, 2), [
    { dir: -1, y: [4, -4], sign: -1 },
    { dir: 1, y: [-3, 4], sign: 1 },
  ]),
  // Bar 19 is a deliberate breath: empty air under the klaxon.

  // --- interlock (bars 20-28): six jammed clamps in two ranks of three, with
  // threader chaff keeping the volleys mixed while the boss is worked down.
  ...interlockRank(at(20, 0), [12, 4, 8], [4], 0),
  ...threaders(at(21, 2), [
    { dir: 1, y: [-4, 4], sign: 1, lead: 3.2 },
    { dir: -1, y: [4, -4], sign: -1, lead: 3.2 },
  ]),
  ...interlockRank(at(22, 0), [2, 6, 10], [10], 3),
  ...threaders(at(23, 2), [{ dir: -1, y: [3, -5], sign: -1, lead: 3.1 }]),
  ...threaders(at(25, 0), [
    { dir: 1, y: [-4, 5], sign: 1, lead: 3.0 },
    { dir: -1, y: [5, -4], sign: -1, lead: 3.0 },
  ]),
  ...threaders(at(26, 2), [{ dir: 1, y: [-5, 2], sign: 1, lead: 2.9 }]),
  // --- muzzle (bars 28-32): intentionally empty. Silence is the payoff.
]);

export const MD_SPAWN_TIMELINE = MD_TIMELINE;

// ---------------------------------------------------------------------------
// Motion and rules
// ---------------------------------------------------------------------------

const MISS_GRACE = 0.5;
const ARC_MAX_AGE = 9;
const INTERLOCK_STANDOFF_NEAR = 34;
const INTERLOCK_STANDOFF_FAR = 47;
const INTERLOCK_RADIUS = MD_BORE_RADIUS - 2.2;

const KILL_SCORE: Record<MdEnemyKind, number> = {
  coil: 110,
  threader: 130,
  capacitor: 300,
  arc: 70,
  interlock: 700,
};

const scratchOffset = new Vector3();

/** Drones weave in front of the wall, never through it: keep them inside the rings. */
const DRONE_MAX_RADIUS = MD_BORE_RADIUS - 1.4;
function clampToBore(offset: Vector3) {
  const radius = Math.hypot(offset.x, offset.y);
  if (radius <= DRONE_MAX_RADIUS) return offset;
  const scale = DRONE_MAX_RADIUS / radius;
  offset.x *= scale;
  offset.y *= scale;
  return offset;
}
const scratchTangentDelta = new Vector3();

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MdEnemyKind, MdSpawnData> {
  const arcIds = new Set<number>();
  const arcInterceptions = new Set<number>();
  const interlockIds = new Set<number>();
  let arcsIntercepted = 0;
  let hitsTaken = 0;
  let klaxonFired = false;
  let chargeCallout = 0;

  bus.on('runstart', () => {
    resetRunState();
    mdRun.running = true;
    arcIds.clear();
    arcInterceptions.clear();
    interlockIds.clear();
    arcsIntercepted = 0;
    hitsTaken = 0;
    klaxonFired = false;
    chargeCallout = 0;
  });

  bus.on('runend', () => {
    mdRun.running = false;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    if (kind === 'arc') arcIds.add(enemyId);
    if (kind === 'interlock') {
      interlockIds.add(enemyId);
      mdRun.interlocksAlive = interlockIds.size;
      emitSignal({ type: 'interlock-spawn', worldPosition });
    }
  });

  bus.on('fire', ({ enemyId }) => {
    if (arcIds.has(enemyId)) arcInterceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    // A bolt only counts as intercepted if the player's shot actually connected.
    if (arcIds.delete(enemyId)) arcsIntercepted += 1;
    arcInterceptions.delete(enemyId);
    if (!interlockIds.delete(enemyId)) return;
    mdRun.interlocksAlive = interlockIds.size;
    mdRun.interlocksDown += 1;
    emitSignal({ type: 'interlock-down', count: mdRun.interlocksDown, worldPosition });
    if (mdRun.interlocksDown >= MD_INTERLOCK_COUNT) {
      emitSignal({ type: 'interlocks-clear' });
      emitSignal({ type: 'callout', text: 'INTERLOCKS CLEAR — BRACE FOR SHOT', seconds: 2.6 });
    } else {
      emitSignal({ type: 'callout', text: `INTERLOCKS ${mdRun.interlocksDown}/${MD_INTERLOCK_COUNT}`, seconds: 1.6 });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    arcIds.delete(enemyId);
    arcInterceptions.delete(enemyId);
    if (interlockIds.delete(enemyId)) mdRun.interlocksAlive = interlockIds.size;
  });

  function fireArc(context: MdUpdate, from: Vector3) {
    const launch = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arc',
      countsTowardTotal: false,
      data: { role: 'arc', position: from.clone(), velocity: launch, lastAge: 0 },
    });
  }

  /** Seat an enemy on the rail at a pacer-resolved anchor, offset in the bore frame. */
  function seat(context: MdUpdate, engagement: RailLead, offset: Vector3) {
    const sample = pacer.sample(context.enemy.entry.time, context.runTime, engagement);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, sample.anchorU, offset));
    return sample;
  }

  function updateCoil(context: MdUpdate, data: CoilData) {
    const { enemy, age, curve } = context;
    const state = context.enemyState(() => ({
      fireAt: data.fires ? 1.05 + (enemy.id % 3) * 0.16 : Infinity,
      fired: false,
    }));
    const angle = data.angle + data.drift * age;

    // A firing coil rears back toward the wall, then lunges inward and looses
    // the bolt at the bottom of the lunge — the whole tell lives in the radius.
    let radius = COIL_RADIUS;
    const toFire = state.fireAt - age;
    if (toFire < 0.55 && toFire > -0.35) {
      const t = MathUtils.clamp((0.55 - toFire) / 0.9, 0, 1);
      radius += t < 0.6
        ? Math.sin((t / 0.6) * Math.PI * 0.5) * 1.7
        : -Math.sin(((t - 0.6) / 0.4) * Math.PI) * 3.4;
    }

    scratchOffset.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    const sample = seat(context, data.engagement, scratchOffset);

    // Always facing inward: look at the bore axis at the coil's own station.
    const frame = sampleRailFrame(curve, sample.anchorU);
    enemy.mesh.lookAt(frame.position);
    enemy.mesh.rotateZ(age * 0.55 + enemy.id);
    enemy.mesh.userData.mdCharge = data.fires ? MathUtils.clamp(1 - Math.abs(toFire) / 0.6, 0, 1) : 0;

    if (!state.fired && age >= state.fireAt && context.runTime < MD_SHOT_TIME - 0.6) {
      state.fired = true;
      fireArc(context, enemy.mesh.position);
    }

    return context.runTime > sample.passTime + MISS_GRACE;
  }

  function updateThreader(context: MdUpdate, data: ThreaderData) {
    const { enemy, age, curve } = context;
    const window = Math.max(0.35, data.engagement.windowSeconds);
    const p = MathUtils.clamp(age / window, 0, 1.2);

    // A shallow vertical arc across the full frame width, with the body winding
    // a helix around that path. Pairs get opposite signs: counter-rotating.
    const helixRadius = 2.2 + Math.sin(Math.min(1, p) * Math.PI) * 1.2;
    const helixAngle = data.sign * (age * 4.6) + data.phase;
    scratchOffset.set(
      MathUtils.lerp(data.from, data.to, p) + Math.cos(helixAngle) * helixRadius,
      MathUtils.lerp(data.yFrom, data.yTo, p) + Math.sin(Math.min(1, p) * Math.PI) * data.arc + Math.sin(helixAngle) * helixRadius,
      0,
    );
    clampToBore(scratchOffset);
    const sample = seat(context, data.engagement, scratchOffset);

    // The nose points a moment ahead of where the drone is actually travelling.
    const aheadP = MathUtils.clamp(p + 0.05, 0, 1.25);
    const aheadAngle = data.sign * ((age + 0.09) * 4.6) + data.phase;
    scratchOffset.set(
      MathUtils.lerp(data.from, data.to, aheadP) + Math.cos(aheadAngle) * helixRadius,
      MathUtils.lerp(data.yFrom, data.yTo, aheadP) + Math.sin(Math.min(1, aheadP) * Math.PI) * data.arc + Math.sin(aheadAngle) * helixRadius,
      0,
    );
    clampToBore(scratchOffset);
    enemy.mesh.lookAt(offsetFromRail(curve, Math.min(1, sample.anchorU + 0.0014), scratchOffset));

    return p >= 1.12 || context.runTime > sample.passTime + MISS_GRACE;
  }

  function updateCapacitor(context: MdUpdate, data: CapacitorData) {
    const { enemy, age, camera } = context;
    // A lazy figure-drift: half-rate in x against full rate in y traces an eight.
    scratchOffset.set(
      data.offset.x + Math.sin(age * 0.72 + data.phase) * 2.4,
      data.offset.y + Math.sin(age * 1.44 + data.phase) * 1.5,
      0,
    );
    const sample = seat(context, data.engagement, scratchOffset);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.85 + data.phase) * 0.85);
    // Once the staves are sheared off the exposed core shudders at high frequency.
    const exposed = enemy.hitStageIndex > 0;
    enemy.mesh.userData.mdExposed = exposed;
    if (exposed) enemy.mesh.rotateX(Math.sin(age * 34) * 0.06);
    return context.runTime > sample.passTime + MISS_GRACE;
  }

  function updateInterlock(context: MdUpdate, data: InterlockData) {
    const { enemy, age, runTime, curve } = context;
    const state = context.enemyState(() => ({
      fireAt: data.fires ? 2.4 + data.index * 0.7 : Infinity,
      shots: 0,
    }));

    // Station-keeping: the clamp holds a roughly constant distance ahead of the
    // camera and tightens as the charge builds, so it can never be overtaken or
    // lost to the fog before the shot.
    const standoff = MathUtils.lerp(INTERLOCK_STANDOFF_FAR, INTERLOCK_STANDOFF_NEAR, chargeAt(runTime));
    const anchorU = MathUtils.clamp(railProgress(runTime) + standoff / MD_RAIL_LENGTH, 0, MD_MUZZLE_U);

    const angle = data.angle + Math.sin(runTime * 0.35 + data.index) * 0.06;
    scratchOffset.set(Math.cos(angle) * INTERLOCK_RADIUS, Math.sin(angle) * INTERLOCK_RADIUS, 0);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratchOffset));

    const frame = sampleRailFrame(curve, anchorU);
    enemy.mesh.lookAt(frame.position);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.userData.mdPop = 1 - Math.exp(-age * 7);
    enemy.mesh.userData.mdExposed = enemy.hitStageIndex > 0;

    if (state.shots < 3 && age >= state.fireAt && runTime < MD_SHOT_TIME - 0.8) {
      state.shots += 1;
      state.fireAt = age + 2.6;
      fireArc(context, enemy.mesh.position);
    }

    // The deadline. A clamp still standing when the gun fires is the detonation.
    if (runTime >= MD_SHOT_TIME) {
      if (!mdRun.detonated) {
        mdRun.detonated = true;
        emitSignal({ type: 'detonation' });
        emitSignal({ type: 'callout', text: 'CHARGE CONTAINMENT FAILED', seconds: 3.2 });
      }
      context.damagePlayer(MD_PLAYER_HEALTH);
      return true;
    }
    return false;
  }

  function updateArc(context: MdUpdate, data: ArcData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: arcInterceptions.delete(enemy.id),
      config: { hitDistance: 2.6, impactBrake: 0.32, damageDistance: 0.7 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 8,
      maxSpeed: 22,
      accel: 5.5,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    return shotBehindCamera(camera, data.position) || age > ARC_MAX_AGE;
  }

  const CHARGE_CALLOUTS = [
    [MD_TIME.bar(22), 'CHARGE 60%'],
    [MD_TIME.bar(25), 'CHARGE 85%'],
    [MD_TIME.bar(27), 'CHARGE CRITICAL'],
  ] as const;

  return {
    duration: MD_RUN_DURATION,
    bpm: MD_BPM,
    playerHealth: MD_PLAYER_HEALTH,
    createRail: () => MD_RAIL,
    spawnTimeline: MD_TIMELINE,
    easeRunProgress: railProgress,
    // The bore is short-range and fast: the engine's default coarse shot grid
    // would let a volley's last impacts drift most of a bar past the release.
    timing: { shotDelay: { maxGridSeconds: 0.95 } },
    lockRadiusNdc: 0.095,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',

    updateCameraEffects({ camera, curve, runTime, dt }) {
      mdRun.runTime = runTime;
      mdRun.runProgress = railProgress(runTime);
      mdRun.speedFactor = railSpeedFactor(runTime);
      mdRun.charge = chargeAt(runTime);

      if (!klaxonFired && runTime >= MD_KLAXON_TIME) {
        klaxonFired = true;
        emitSignal({ type: 'klaxon' });
        emitSignal({ type: 'callout', text: 'WARNING — SAFETY INTERLOCKS JAMMED', seconds: 2.4 });
      }

      // The charge readout only speaks while interlocks are still standing.
      while (
        chargeCallout < CHARGE_CALLOUTS.length
        && runTime >= CHARGE_CALLOUTS[chargeCallout][0]
      ) {
        if (mdRun.interlocksDown < MD_INTERLOCK_COUNT) {
          emitSignal({ type: 'callout', text: CHARGE_CALLOUTS[chargeCallout][1], seconds: 1.7 });
        }
        chargeCallout += 1;
      }

      if (!mdRun.gunFired && !mdRun.detonated && runTime >= MD_SHOT_TIME) {
        mdRun.gunFired = true;
        emitSignal({ type: 'shot' });
        emitSignal({ type: 'callout', text: 'PAYLOAD AWAY', seconds: 2.8 });
      }

      // The camera banks into the weave: cosmetic roll only, read from how the
      // rail tangent swings sideways a short way ahead.
      const u = mdRun.runProgress;
      const here = sampleRailFrame(curve, u);
      const ahead = sampleRailFrame(curve, Math.min(1, u + 0.0035));
      scratchTangentDelta.copy(ahead.tangent).sub(here.tangent);
      const bank = MathUtils.clamp(scratchTangentDelta.dot(here.right) * 26, -0.2, 0.2);
      const previous = (camera.userData.mdBank as number | undefined) ?? bank;
      const smoothed = MathUtils.lerp(previous, bank, Math.min(1, dt * 3.5));
      camera.userData.mdBank = smoothed;
      camera.rotateZ(smoothed);
      camera.updateMatrixWorld();
    },

    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'coil':
          return updateCoil(context, data);
        case 'threader':
          return updateThreader(context, data);
        case 'capacitor':
          return updateCapacitor(context, data);
        case 'interlock':
          return updateInterlock(context, data);
        case 'arc':
          return updateArc(context, data);
      }
    },

    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Every non-lethal armor chip pays: staves off a capacitor, cowl off a clamp.
    scoreForHit: () => 55,
    scoreForVolley(results) {
      if (results.length < 2 || results.some((result) => !result.killed)) return 0;
      // A perfect six is the gun fully charged, and it is worth a lot.
      return results.length === 6 ? 1500 : results.length * 80;
    },

    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // S is reserved for a run where the gun actually fired.
      if (mdRun.gunFired && score >= 18000 && clearRate >= 0.9) return 'S';
      if (score >= 12000 && clearRate >= 0.78) return 'A';
      if (score >= 8000 && clearRate >= 0.58) return 'B';
      if (score >= 4000 && clearRate >= 0.32) return 'C';
      return 'D';
    },

    detailsForRun() {
      const hull = mdRun.detonated ? 0 : Math.max(0, MD_PLAYER_HEALTH - hitsTaken);
      return [
        `Hull ${hull}/${MD_PLAYER_HEALTH}`,
        `Interlocks ${mdRun.interlocksDown}/${MD_INTERLOCK_COUNT}`,
        `Arcs intercepted ${arcsIntercepted}`,
        mdRun.detonated ? 'CHARGE CONTAINMENT FAILED' : 'PAYLOAD AWAY — muzzle exit clean',
      ];
    },
  };
}
