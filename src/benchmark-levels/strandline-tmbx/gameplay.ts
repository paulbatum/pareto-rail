import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type {
  LockOnAttractCameraUpdate,
  LockOnCameraEffectsUpdate,
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import { mulberry32 } from '../../engine/rng';
import type { EventBus } from '../../events';
import { createCrown, createCrownEntries, type CrownSpawnData } from './crown';
import { BEAT_SECONDS, STRANDLINE_BPM, STRANDLINE_DURATION, bar } from './timing';
import {
  BELL_LOOK,
  RAIL,
  VIEW_TAN_X,
  VIEW_TAN_Y,
  cameraFrameAt,
  axisAt,
  createStrandlineRail,
  finalePose,
  hostRootFor,
  lookQuaternion,
  railBaseFrame,
  railToWorld,
  strandClearance,
  strandPointAt,
  strandRootY,
  strandlineRunProgress,
  viewDirectionAt,
  worldToRail,
  type StrandSpec,
} from './world';

// STRANDLINE — sixty seconds freeing a giant jellyfish from a parasite colony.
//
//   Drift     (bars 0–4)    Dim strands, the first ticks clamped on ahead.
//   Kindling  (bars 4–8)    The forest wakes; creepers, bladders, drifters.
//   Green Moon(bars 8–11)   The rail swings wide into open water to face the
//                           bell, a drifter ring silhouetted across its disc.
//   Upstream  (bars 11–15)  Back into the strands, climbing to the crown.
//   The Crown (bars 15–22)  The parent, walled in its web, pumps three broods;
//                           each brood cleared withers the web that fed it.
//                           Bare, it is torn loose in two volleys.
//   Drift On  (to bar 24)   The camera pulls back until the whole animal is
//                           in frame, every strand glowing clean.
//
// Parasites are seated on real strands: every latched spawn's world position
// is computed from the authored camera frame at its spawn time, and the
// visuals grow a host strand through exactly that point.

export { STRANDLINE_BPM, STRANDLINE_DURATION } from './timing';

export const STRANDLINE_PLAYER_HEALTH = 3;

export type StrandlineEnemyKind =
  | 'tick'
  | 'creeper'
  | 'bladder'
  | 'drifter'
  | 'spore'
  | 'hatchling'
  | 'crown'
  | 'parent';

type SwimStyle = 'arc' | 'eel' | 'orbit' | 'rise' | 'sink';

export type SwimSpec = {
  style: SwimStyle;
  dir: 1 | -1;
  /** Arc height (arc), undulation amplitude (eel), radial growth (orbit), weave (rise/sink). */
  span: number;
  /** Rail-space depth the swimmer settles to after kicking off. */
  depth: number;
  speed: number;
};

export type DrifterFormation =
  | { shape: 'ring'; index: number; count: number; radius: number; depth: number; spin: 1 | -1; scatterAt: number }
  | { shape: 'line'; from: readonly [number, number]; to: readonly [number, number]; depth: number; delayBeats: number; jets: number };

export type StrandlineSpawnData =
  | { role: 'tick'; latch: Vector3; host: number; detachAt: number; swim: SwimSpec }
  | { role: 'creeper'; latch: Vector3; host: number; detachAt: number; swim: SwimSpec }
  | { role: 'bladder'; latch: Vector3; host: number; spits: readonly number[]; leaveAt: number }
  | { role: 'drifter'; formation: DrifterFormation }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | CrownSpawnData;

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

// ---- host strands ------------------------------------------------------------------

const hostRng = mulberry32(0x57a4d);
const HOST_CLEARANCE = 4.2;

/** Strands grown through latch points; the visuals build these first. */
export const HOST_STRANDS: StrandSpec[] = [];

function growHost(point: Vector3): { host: number; latch: Vector3 } {
  let root = hostRootFor(point);
  const latch = point.clone();
  // A latch authored just beyond the forest's edge is pulled back in until a
  // strand from the bell margin can reach it.
  for (let guard = 0; !root && guard < 40; guard += 1) {
    latch.lerp(axisAt(latch.y), 0.04);
    root = hostRootFor(latch);
  }
  const resolved = root ?? { rootRadius: 40, rootAngle: 0 };
  const spec: StrandSpec = {
    kind: 'tentacle',
    rootRadius: resolved.rootRadius,
    rootAngle: resolved.rootAngle,
    length: 0,
    anchorY: latch.y,
    wobbleA: 1.6 + hostRng() * 2.4,
    wobbleB: 1.2 + hostRng() * 2.2,
    wobbleK: 0.018 + hostRng() * 0.022,
    curlA: 0.6 + hostRng() * 0.9,
    curlK: 0.12 + hostRng() * 0.1,
    thickness: 0.36 + hostRng() * 0.2,
    seed: hostRng(),
    infections: [],
  };
  const rootY = strandRootY(spec);
  spec.length = rootY - (latch.y - 70 - hostRng() * 90);
  // The meander is zero at the latch height, so reshaping it elsewhere keeps
  // the parasite on its strand while steering the strand off the camera path.
  const wobbleA = spec.wobbleA;
  const wobbleB = spec.wobbleB;
  for (let attempt = 0; attempt < 8 && strandClearance(spec) < HOST_CLEARANCE; attempt += 1) {
    spec.wobbleA = wobbleA * (attempt % 2 === 0 ? -1 : 1) * (1 - attempt * 0.1);
    spec.wobbleB = wobbleB * (attempt % 4 < 2 ? -0.6 : 0.6);
    spec.wobbleK *= 0.85;
  }
  HOST_STRANDS.push(spec);
  return { host: HOST_STRANDS.length - 1, latch };
}

function infect(host: number, latch: Vector3) {
  const spec = HOST_STRANDS[host];
  spec.infections.push(MathUtils.clamp((strandRootY(spec) - latch.y) / spec.length, 0, 1));
}

// ---- timeline builders --------------------------------------------------------------

type Clamped = {
  kind: 'tick' | 'creeper' | 'bladder';
  sy: number;
  /** Bars (absolute) when it lets go; bladders never do. */
  detach?: number;
  swim?: Partial<SwimSpec> & { style: SwimStyle };
  spits?: number[];
};

const DEFAULT_DEPTH = 36;

/**
 * One strand ahead with parasites clamped along it. `sx` is the strand's
 * screen column at spawn time; each parasite's `sy` its screen row. The
 * strand is grown through the first parasite and the rest are seated on it at
 * their own heights, so they genuinely share a strand.
 */
function strand(atBar: number, sx: number, parasites: Clamped[], depth = DEFAULT_DEPTH): StrandlineSpawnEntry[] {
  const time = bar(atBar);
  const frame = cameraFrameAt(time);
  const spot = (sy: number) => frame.position.clone()
    .addScaledVector(frame.forward, depth)
    .addScaledVector(frame.right, sx * depth * VIEW_TAN_X)
    .addScaledVector(frame.up, sy * depth * VIEW_TAN_Y);
  const first = growHost(spot(parasites[0].sy));
  const spec = HOST_STRANDS[first.host];
  return parasites.map((parasite, index) => {
    const latch = index === 0 ? first.latch : strandPointAt(spec, spot(parasite.sy).y);
    infect(first.host, latch);
    const entryTime = time + index * 0.06;
    if (parasite.kind === 'bladder') {
      return {
        time: entryTime,
        kind: 'bladder',
        hitPoints: 2,
        data: {
          role: 'bladder',
          latch,
          host: first.host,
          spits: (parasite.spits ?? []).map((spitBar) => bar(spitBar)),
          leaveAt: time + 9,
        },
      } satisfies StrandlineSpawnEntry;
    }
    const swim: SwimSpec = {
      style: parasite.swim?.style ?? 'arc',
      dir: parasite.swim?.dir ?? (sx > 0 ? -1 : 1),
      span: parasite.swim?.span ?? 5,
      depth: parasite.swim?.depth ?? 19,
      speed: parasite.swim?.speed ?? 8,
    };
    return {
      time: entryTime,
      kind: parasite.kind,
      data: {
        role: parasite.kind,
        latch,
        host: first.host,
        detachAt: bar(parasite.detach ?? atBar + 1),
        swim,
      },
    } satisfies StrandlineSpawnEntry;
  });
}

function ring(atBar: number, count: number, radius: number, depth: number, spin: 1 | -1, scatterBar: number): StrandlineSpawnEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: bar(atBar) + index * 0.05,
    kind: 'drifter' as const,
    data: {
      role: 'drifter' as const,
      formation: { shape: 'ring' as const, index, count, radius, depth, spin, scatterAt: bar(scatterBar) },
    },
  }));
}

function line(
  atBar: number,
  count: number,
  from: readonly [number, number],
  to: readonly [number, number],
  options: { depth?: number; stagger?: number; jets?: number; spread?: number } = {},
): StrandlineSpawnEntry[] {
  const stagger = options.stagger ?? 0.5;
  const spread = options.spread ?? 0;
  return Array.from({ length: count }, (_, index) => {
    const lane = (index - (count - 1) / 2) * spread;
    return {
      time: bar(atBar) + index * 0.04,
      kind: 'drifter' as const,
      data: {
        role: 'drifter' as const,
        formation: {
          shape: 'line' as const,
          from: [from[0], from[1] + lane] as const,
          to: [to[0], to[1] + lane] as const,
          depth: options.depth ?? 28,
          delayBeats: index * stagger,
          jets: options.jets ?? 8,
        },
      },
    };
  });
}

// ---- the timeline ---------------------------------------------------------------------

function buildTimeline(crownEntries: StrandlineSpawnEntry[]): StrandlineSpawnEntry[] {
  const arc = (dir: 1 | -1, span = 5): Clamped['swim'] => ({ style: 'arc', dir, span });
  const eel = (dir: 1 | -1): Clamped['swim'] => ({ style: 'eel', dir, span: 2.6, speed: 7 });
  const orbit = (dir: 1 | -1): Clamped['swim'] => ({ style: 'orbit', dir, span: 2.4, speed: 1.3 });
  const rise = (dir: 1 | -1): Clamped['swim'] => ({ style: 'rise', dir, span: 5, speed: 6.5 });
  const sink = (dir: 1 | -1): Clamped['swim'] => ({ style: 'sink', dir, span: 5, speed: 6.5 });

  return [
    // --- Drift: one strand at a time. Learn the sweep on slow, lone ticks.
    ...strand(0.5, 0.18, [
      { kind: 'tick', sy: 0.32, detach: 1.5, swim: arc(-1, 6) },
      { kind: 'tick', sy: -0.2, detach: 1.75, swim: arc(-1, -5) },
    ]),
    ...strand(1.25, -0.3, [
      { kind: 'tick', sy: 0.18, detach: 2.25, swim: arc(1, 6) },
      { kind: 'tick', sy: -0.32, detach: 2.5, swim: arc(1, -4) },
    ]),
    ...strand(2, 0.02, [
      { kind: 'creeper', sy: 0.36, detach: 3, swim: eel(1) },
    ]),
    ...strand(2.75, 0.3, [
      { kind: 'tick', sy: 0.38, detach: 3.5, swim: rise(-1) },
      { kind: 'tick', sy: -0.02, detach: 3.625, swim: arc(-1, 4) },
      { kind: 'tick', sy: -0.4, detach: 3.75, swim: sink(-1) },
    ]),
    ...strand(3.25, -0.42, [
      { kind: 'tick', sy: 0.3, detach: 4, swim: arc(1, 5) },
    ]),

    // --- Kindling: the downbeat of bar 4 brings the first full six.
    ...strand(4, -0.4, [
      { kind: 'tick', sy: 0.34, detach: 5, swim: orbit(1) },
      { kind: 'tick', sy: -0.26, detach: 5.125, swim: orbit(1) },
    ]),
    ...strand(4.05, 0.02, [
      { kind: 'tick', sy: 0.42, detach: 5.25, swim: orbit(1) },
      { kind: 'tick', sy: -0.4, detach: 5.375, swim: orbit(1) },
    ]),
    ...strand(4.1, 0.36, [
      { kind: 'tick', sy: 0.24, detach: 5.5, swim: orbit(1) },
      { kind: 'tick', sy: -0.2, detach: 5.625, swim: orbit(1) },
    ]),
    ...strand(5, -0.3, [
      { kind: 'creeper', sy: 0.1, detach: 6, swim: eel(1) },
    ]),
    ...strand(5.1, 0.28, [
      { kind: 'creeper', sy: 0.3, detach: 6.25, swim: eel(-1) },
    ]),
    ...strand(5.5, 0.16, [
      { kind: 'bladder', sy: -0.06, spits: [6.25, 7] },
    ], 44),
    ...line(6, 4, [-26, -16], [26, 9], { depth: 26, stagger: 0.5, jets: 9, spread: 3 }),
    ...strand(6.75, -0.38, [
      { kind: 'tick', sy: -0.3, detach: 7.5, swim: arc(1, 5) },
      { kind: 'tick', sy: 0.34, detach: 7.625, swim: arc(1, -5) },
    ]),
    ...strand(6.8, 0.3, [
      { kind: 'tick', sy: -0.36, detach: 7.75, swim: rise(-1) },
      { kind: 'creeper', sy: 0.14, detach: 7.5, swim: eel(-1) },
    ]),
    ...strand(7.25, -0.12, [
      { kind: 'bladder', sy: 0.28, spits: [7.75] },
    ], 40),

    // --- Green Moon: out of the forest into open blue, a school crossing the
    // swing; then, with the bell filling the frame, a ring of drifters holds
    // station around its disc until the dive.
    ...line(8.25, 4, [-30, 6], [30, -2], { depth: 30, stagger: 0.5, jets: 8, spread: 3 }),
    ...ring(9.25, 6, 14.5, 32, 1, 10.6),
    ...strand(10.5, -0.2, [
      { kind: 'tick', sy: 0.3, detach: 11.25, swim: arc(1, 5) },
      { kind: 'tick', sy: -0.3, detach: 11.375, swim: arc(1, -5) },
    ], 40),
    ...strand(10.55, 0.34, [
      { kind: 'tick', sy: 0.05, detach: 11.5, swim: arc(-1, 6) },
    ], 40),

    // --- Upstream: the wall, crossfire, a school, the spiral, the last push.
    ...strand(11, -0.44, [
      { kind: 'tick', sy: 0.36, detach: 11.75, swim: arc(1, -5) },
      { kind: 'tick', sy: -0.3, detach: 11.875, swim: arc(1, 5) },
    ]),
    ...strand(11.05, 0.4, [
      { kind: 'tick', sy: 0.3, detach: 12, swim: arc(-1, -5) },
      { kind: 'tick', sy: -0.34, detach: 12.125, swim: arc(-1, 5) },
    ]),
    ...strand(11.1, -0.04, [
      { kind: 'creeper', sy: 0.2, detach: 12, swim: eel(1) },
      { kind: 'creeper', sy: -0.24, detach: 12.25, swim: eel(-1) },
    ]),
    ...strand(11.75, -0.3, [
      { kind: 'bladder', sy: 0.22, spits: [12.25, 13] },
    ], 44),
    ...strand(11.8, 0.3, [
      { kind: 'bladder', sy: -0.14, spits: [12.5, 13.25] },
    ], 44),
    ...line(12.5, 5, [-30, -14], [28, 12], { depth: 27, stagger: 0.25, jets: 8, spread: 2.4 }),
    ...strand(13, -0.36, [
      { kind: 'tick', sy: 0.32, detach: 13.75, swim: orbit(-1) },
      { kind: 'tick', sy: -0.3, detach: 13.875, swim: orbit(-1) },
    ]),
    ...strand(13.05, 0.05, [
      { kind: 'tick', sy: 0.42, detach: 14, swim: orbit(-1) },
      { kind: 'tick', sy: -0.38, detach: 14.125, swim: orbit(-1) },
    ]),
    ...strand(13.1, 0.4, [
      { kind: 'tick', sy: 0.26, detach: 14.25, swim: orbit(-1) },
      { kind: 'tick', sy: -0.24, detach: 14.375, swim: orbit(-1) },
    ]),
    ...strand(13.75, -0.26, [
      { kind: 'creeper', sy: 0.3, detach: 14.5, swim: eel(1) },
    ], 38),
    ...strand(13.8, 0.3, [
      { kind: 'creeper', sy: -0.3, detach: 14.625, swim: eel(-1) },
      { kind: 'bladder', sy: 0.3, spits: [14.5] },
    ], 38),

    // --- The Crown.
    ...crownEntries,
  ];
}

// ---- motion ---------------------------------------------------------------------------

const KICK_SECONDS = 0.55;
const SWIM_LIFE = 4.6;

const scratch = new Vector3();
const scratchB = new Vector3();
const basis = new Matrix4();

function swimLocal(swim: SwimSpec, start: Vector3, tau: number, out: Vector3) {
  const settle = 1 - (1 - Math.min(1, tau / 0.9)) ** 3;
  const z = MathUtils.lerp(start.z, -swim.depth, settle);
  switch (swim.style) {
    case 'arc': {
      const k = Math.min(1, tau / 3.2);
      return out.set(
        start.x + swim.dir * swim.speed * tau,
        start.y + swim.span * Math.sin(k * Math.PI),
        z,
      );
    }
    case 'eel':
      return out.set(
        start.x + swim.dir * swim.speed * tau,
        start.y + swim.span * Math.sin(tau * 5.2) * Math.min(1, tau * 2),
        z,
      );
    case 'orbit': {
      const r0 = Math.hypot(start.x, start.y);
      const a0 = Math.atan2(start.y, start.x);
      const r = r0 + swim.span * tau;
      const a = a0 + swim.dir * swim.speed * tau;
      return out.set(Math.cos(a) * r * 1.25, Math.sin(a) * r * 0.85, z);
    }
    case 'rise':
    case 'sink': {
      const up = swim.style === 'rise' ? 1 : -1;
      return out.set(
        start.x + swim.dir * swim.span * Math.sin(tau * 1.8),
        start.y + up * swim.speed * tau,
        z,
      );
    }
  }
}

function offscreen(local: Vector3, margin = 1.2) {
  const depth = -local.z;
  if (depth < 1.2) return true;
  return Math.abs(local.x / (depth * VIEW_TAN_X)) > margin || Math.abs(local.y / (depth * VIEW_TAN_Y)) > margin;
}

/** Orient: local +z along `forward`, local +y toward `up`. */
function face(mesh: { quaternion: Quaternion }, forward: Vector3, up: Vector3) {
  const z = scratch.copy(forward).normalize();
  const x = scratchB.crossVectors(up, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new Vector3().crossVectors(z, x);
  basis.makeBasis(x, y, z);
  mesh.quaternion.setFromRotationMatrix(basis);
}

// ---- gameplay factory --------------------------------------------------------------------

const KILL_SCORE: Record<StrandlineEnemyKind, number> = {
  tick: 100,
  creeper: 160,
  bladder: 260,
  drifter: 120,
  spore: 40,
  hatchling: 150,
  crown: 0,
  parent: 3200,
};

export type StrandlineGameplay = LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> & {
  /** Pose the camera after the run has ended (the animal drifting on). */
  holdFinaleCamera(camera: { position: Vector3; quaternion: Quaternion }, secondsSinceEnd: number): boolean;
  /** Seconds into the ending, or -1 while the fight is on. */
  finaleElapsed(runTime: number): number;
  outcome(): 'pending' | 'freed' | 'blighted';
};

const crownPreview = createCrownEntries();
export const STRANDLINE_TIMELINE = buildTimeline(crownPreview.entries).sort((a, b) => a.time - b.time);

export function createStrandlineGameplay(bus: EventBus, debugValue?: string): StrandlineGameplay {
  const timeline = STRANDLINE_TIMELINE;
  const crown = createCrown(bus, {
    spawnSpore: fireSpore,
    // `?debugValue=freed` rehearses the good ending for headless inspection.
    rehearseFreedAt: debugValue === 'freed' ? bar(20.5) : undefined,
  });

  const intercepted = new Set<number>();
  const healedHosts = new Set<number>();
  let hitsTaken = 0;
  let sporesShot = 0;
  let finaleStart = -1;
  let finaleFrom = new Vector3();

  bus.on('runstart', () => {
    intercepted.clear();
    healedHosts.clear();
    hitsTaken = 0;
    sporesShot = 0;
    finaleStart = -1;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    intercepted.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    intercepted.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    intercepted.delete(enemyId);
  });

  function fireSpore(context: StrandlineUpdate, from: Vector3, kick: Vector3) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'spore',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: kick.clone(), lastAge: 0, impact: {} },
    });
  }

  function markHost(context: StrandlineUpdate, host: number) {
    context.enemy.mesh.userData.host = host;
  }

  // Latched parasites hold their world point until their detach beat, then
  // kick off the strand into rail space and swim their authored figure.
  function updateSwimmer(
    context: StrandlineUpdate,
    data: Extract<StrandlineSpawnData, { role: 'tick' | 'creeper' }>,
  ) {
    const { enemy, runTime, camera } = context;
    const mesh = enemy.mesh;
    markHost(context, data.host);
    const state = context.enemyState(() => ({
      detachAt: data.detachAt,
      start: new Vector3(),
      started: false,
    }));
    const frame = cameraFrameAt(runTime);
    const toLatch = scratch.copy(data.latch).sub(frame.position);
    // Never let a clamped parasite be overtaken while still on its strand.
    if (!state.started && toLatch.dot(frame.forward) < 7) state.detachAt = Math.min(state.detachAt, runTime);

    if (runTime < state.detachAt) {
      mesh.userData.latched = true;
      const spec = HOST_STRANDS[data.host];
      if (data.role === 'creeper') {
        // Creepers spiral around their strand while they feed.
        const age = context.age;
        const y = data.latch.y + Math.sin(age * 0.9) * 1.4;
        strandPointAt(spec, y, mesh.position);
        const angle = age * 2.1 + enemy.id;
        mesh.position.x += Math.cos(angle) * 0.9;
        mesh.position.z += Math.sin(angle) * 0.9;
        const tangent = new Vector3(-Math.sin(angle), 0.35 * Math.cos(age * 0.9), Math.cos(angle));
        face(mesh, tangent, new Vector3(Math.cos(angle), 0, Math.sin(angle)));
      } else {
        mesh.position.copy(data.latch);
        mesh.position.y += Math.sin(context.age * 3.1 + enemy.id) * 0.08;
        const up = strandPointAt(spec, data.latch.y + 1, new Vector3()).sub(data.latch).normalize();
        const toCamera = new Vector3().subVectors(camera.position, data.latch);
        toCamera.addScaledVector(up, -toCamera.dot(up)).normalize();
        face(mesh, up, toCamera);
      }
      return false;
    }

    if (!state.started) {
      state.started = true;
      worldToRail(runTime, mesh.position, state.start);
    }
    mesh.userData.latched = false;
    const tau = runTime - state.detachAt;
    const local = swimLocal(data.swim, state.start, tau, new Vector3());
    const target = railToWorld(runTime, local, new Vector3());
    const previous = mesh.position.clone();
    if (tau < KICK_SECONDS) {
      const k = tau / KICK_SECONDS;
      mesh.position.lerp(target, Math.min(1, 0.25 + k * k));
    } else {
      mesh.position.copy(target);
    }
    const velocity = mesh.position.clone().sub(previous);
    if (velocity.lengthSq() > 1e-5) face(mesh, velocity, frame.up);
    mesh.userData.swimAge = tau;
    return tau > SWIM_LIFE || (tau > 1 && offscreen(local));
  }

  function updateBladder(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'bladder' }>) {
    const { enemy, runTime, camera } = context;
    const mesh = enemy.mesh;
    markHost(context, data.host);
    const state = context.enemyState(() => ({ nextSpit: 0 }));
    mesh.position.copy(data.latch);
    mesh.position.y += Math.sin(context.age * 1.7 + enemy.id) * 0.25;
    const toCamera = new Vector3().subVectors(camera.position, mesh.position);
    face(mesh, toCamera, new Vector3(0, 1, 0));

    // Inflate across the beat before each spit so the shot is telegraphed.
    const next = data.spits[state.nextSpit];
    mesh.userData.charge = next === undefined ? 0 : MathUtils.clamp(1 - (next - runTime) / BEAT_SECONDS, 0, 1);
    if (next !== undefined && runTime >= next) {
      state.nextSpit += 1;
      const kick = toCamera.normalize().multiplyScalar(4).add(new Vector3(0, 2.4, 0));
      fireSpore(context, mesh.position.clone().addScaledVector(toCamera, 1.2), kick);
    }

    const frame = cameraFrameAt(runTime);
    const ahead = scratch.copy(mesh.position).sub(frame.position).dot(frame.forward);
    return ahead < 2 || runTime > data.leaveAt;
  }

  function updateDrifter(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'drifter' }>) {
    const { enemy, runTime } = context;
    const mesh = enemy.mesh;
    const formation = data.formation;
    const beats = (runTime - enemy.entry.time) / BEAT_SECONDS;
    // Jet propulsion on the beat: a hard stroke, then a long glide.
    const stroke = (count: number) => Math.floor(count) + 1 - (1 - (count - Math.floor(count))) ** 3;
    mesh.userData.jet = beats - Math.floor(beats);
    const local = new Vector3();

    if (formation.shape === 'ring') {
      // Hold station around the bell's disc: the ring's centre tracks where
      // the bell sits in the frame.
      const bell = worldToRail(runTime, BELL_LOOK, new Vector3());
      const scale = formation.depth / Math.max(1, -bell.z);
      const limitX = formation.depth * VIEW_TAN_X * 0.3;
      const limitY = formation.depth * VIEW_TAN_Y * 0.25;
      const cx = -bell.z > 1 ? MathUtils.clamp(bell.x * scale, -limitX, limitX) : 0;
      const cy = -bell.z > 1 ? MathUtils.clamp(bell.y * scale, -limitY, limitY) : 0;
      const rise = Math.min(1, beats / 2);
      const step = stroke(Math.max(0, beats));
      const angle = (formation.index / formation.count) * Math.PI * 2 + formation.spin * step * 0.26;
      let radius = formation.radius * (0.45 + 0.55 * (1 - (1 - rise) ** 3));
      const scatterBeats = (runTime - formation.scatterAt) / BEAT_SECONDS;
      if (scatterBeats > 0) radius += stroke(scatterBeats) * 7;
      local.set(cx + Math.cos(angle) * radius * 1.12, cy + Math.sin(angle) * radius, -formation.depth);
      const target = railToWorld(runTime, local, new Vector3());
      const heading = target.clone().sub(mesh.position);
      mesh.position.copy(target);
      if (heading.lengthSq() > 1e-6) face(mesh, heading, cameraFrameAt(runTime).forward.clone().negate());
      return scatterBeats > 5 || (scatterBeats > 0 && offscreen(local, 1.15));
    }

    const t = Math.max(0, beats - formation.delayBeats);
    const k = Math.min(1.35, stroke(t) / formation.jets);
    local.set(
      MathUtils.lerp(formation.from[0], formation.to[0], k),
      MathUtils.lerp(formation.from[1], formation.to[1], k) + Math.sin(t * 1.3 + enemy.id) * 0.6,
      -formation.depth,
    );
    const target = railToWorld(runTime, local, new Vector3());
    const heading = new Vector3(formation.to[0] - formation.from[0], formation.to[1] - formation.from[1], 0)
      .applyQuaternion(cameraFrameAt(runTime).quaternion);
    mesh.position.copy(target);
    face(mesh, heading, cameraFrameAt(runTime).forward.clone().negate());
    return k >= 1.3 || (k > 0.6 && offscreen(local, 1.15));
  }

  function updateSpore(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    // With the parent torn loose, its last spores die in the water.
    if (crown.outcome() === 'freed') return true;
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
      enemy.mesh.userData.braking = true;
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.2,
      maxSpeed: 10.5,
      accel: 2.3,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    return age > 13 || shotBehindCamera(camera, data.position);
  }

  // ---- camera ------------------------------------------------------------------------

  const railBase = { position: new Vector3(), quaternion: new Quaternion() };
  const desired = new Quaternion();
  const viewTarget = new Quaternion();
  const edgeDelta = new Quaternion();
  const finaleQuaternion = new Quaternion();

  function finaleSpan() {
    return MathUtils.clamp(STRANDLINE_DURATION - finaleStart - 0.4, 4.2, 8.5);
  }

  function updateCameraEffects({ camera, runTime, runProgress }: LockOnCameraEffectsUpdate) {
    const endingAt = crown.endingAt();
    if (endingAt >= 0 && finaleStart < 0 && runTime >= endingAt) {
      finaleStart = endingAt;
      finaleFrom = camera.position.clone();
    }

    const view = viewDirectionAt(runTime);
    const inFinale = finaleStart >= 0;
    if (view.weight <= 0 && !inFinale) return;

    // Keep the player's edge-look: express it as a delta from the rail's own
    // orientation and re-apply it on top of the authored view.
    railBaseFrame(runProgress, railBase);
    edgeDelta.copy(railBase.quaternion).invert().multiply(camera.quaternion);
    lookQuaternion(camera.position, view.target, viewTarget);
    desired.slerpQuaternions(railBase.quaternion, viewTarget, view.weight);

    if (inFinale) {
      const elapsed = runTime - finaleStart;
      const pose = finalePose(finaleFrom, elapsed, finaleSpan(), jellyDrift(elapsed));
      camera.position.copy(pose.position);
      lookQuaternion(pose.position, pose.target, finaleQuaternion);
      desired.slerp(finaleQuaternion, MathUtils.clamp(elapsed / 0.9, 0, 1));
      // The player's edge-look fades out as the camera takes the wide view.
      edgeDelta.slerp(new Quaternion(), MathUtils.clamp(elapsed / 2, 0, 1));
    }
    camera.quaternion.copy(desired).multiply(edgeDelta);
    camera.updateMatrixWorld();
  }

  function updateAttractCamera({ camera, modeTime }: LockOnAttractCameraUpdate) {
    // Idle among the first strands: a slow tread-water sway, bell far above.
    railBaseFrame(0, railBase);
    camera.position.copy(railBase.position);
    camera.position.x += Math.sin(modeTime * 0.37) * 0.5;
    camera.position.y += Math.sin(modeTime * 0.51) * 0.35;
    const look = RAIL.curve.getPointAt(0.03).clone();
    look.x += Math.sin(modeTime * 0.23 + 1.1) * 1.4;
    look.y += Math.sin(modeTime * 0.29) * 0.8 + 1.2;
    camera.lookAt(look);
  }

  function holdFinaleCamera(camera: { position: Vector3; quaternion: Quaternion }, secondsSinceEnd: number) {
    if (finaleStart < 0) return false;
    const elapsed = STRANDLINE_DURATION - finaleStart + secondsSinceEnd;
    const pose = finalePose(finaleFrom, elapsed, finaleSpan(), jellyDrift(elapsed));
    camera.position.copy(pose.position);
    lookQuaternion(pose.position, pose.target, camera.quaternion);
    return true;
  }

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    startWord: 'START!',
    replayWord: 'REPLAY',
    // Volleys land as a short slowing cascade — 32nds opening out toward an
    // eighth — so six kills play as one phrase of the kill lane rather than a
    // burst or a two-second drawl at this unhurried tempo.
    timing: {
      shotDelay: { maxGridSeconds: 0.7, gridRampGapGrowthThirtyseconds: 1 },
    },
    // A touch more generous than the default: swimmers curve through a busy
    // forest of strands.
    lockRadiusNdc: 0.09,
    updateCameraEffects,
    updateAttractCamera,
    holdFinaleCamera,
    finaleElapsed(runTime: number) {
      return finaleStart < 0 ? -1 : runTime - finaleStart;
    },
    outcome: crown.outcome,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'tick':
        case 'creeper':
          return updateSwimmer(context, data);
        case 'bladder':
          return updateBladder(context, data);
        case 'drifter':
          return updateDrifter(context, data);
        case 'bolt':
          return updateSpore(context, data);
        case 'hatchling':
          return crown.updateHatchling(context, data);
        case 'crown':
          return crown.updateCrown(context);
        case 'parent':
          return crown.updateParent(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'spore') sporesShot += 1;
      const data = enemy.entry.data;
      if ('host' in data) healedHosts.add(data.host);
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 50,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const freed = crown.outcome() === 'freed';
      if (freed && clearRate >= 0.92 && score >= 19000) return 'S';
      if (freed && clearRate >= 0.75 && score >= 14000) return 'A';
      if (clearRate >= 0.5 && score >= 8000) return 'B';
      if (clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [`Strands cleansed ${healedHosts.size}/${HOST_STRANDS.length}`];
      lines.push(crown.summaryLine());
      if (sporesShot > 0) lines.push(`${sporesShot} spore${sporesShot === 1 ? '' : 's'} shot down`);
      lines.push(`Membrane ${Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken)}/${STRANDLINE_PLAYER_HEALTH}`);
      return lines;
    },
  };
}

/** How far the animal has drifted `elapsed` seconds into the ending. */
export function jellyDrift(elapsed: number, out = new Vector3()) {
  const e = Math.max(0, elapsed);
  const ease = e < 3 ? (e * e) / 6 : e - 1.5;
  return out.set(0, ease * 2.1, -ease * 0.8);
}
