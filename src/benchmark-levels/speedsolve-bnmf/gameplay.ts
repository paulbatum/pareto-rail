import { CatmullRomCurve3, MathUtils, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { createBeatClock } from './beat-clock';
import {
  CUBE_SLOTS,
  FACE_NORMALS,
  FACE_RIGHT,
  FACE_SLOTS,
  FACE_UP,
  derivePlan,
  dot,
  type PlanStep,
  type Vec3i,
} from './cube-model';
import { blendPose, cameraLookQuaternion, frameQuaternion, orbitQuaternion, poseCamera, screenDirection, type OrbitPose } from './orbit';
import { emitCubeSignal } from './signals';
import { createSolveMachine } from './solve';
import {
  BEAT,
  FACE_BEATS,
  FACE_COUNT,
  SPEEDSOLVE_BARS,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_RUN_DURATION,
  SPEEDSOLVE_TIME,
  faceBeat,
} from './timing';

export { SPEEDSOLVE_BPM, SPEEDSOLVE_RUN_DURATION } from './timing';

// Speedsolve: one continuous boss fight against a colossal puzzle cube. The
// rail orbits it face by face (F, R, U, B, L, D — each a quarter swing from
// the last). On every face a few rows are wrong; each glowing bracket marks a
// row, and every hit on it snaps that slice a quarter turn on the next free
// eighth note. Rows of one face are parallel slices, so they commute: any
// order solves it. A solved face sheds its stickers, a weakpoint rises from
// the machinery, and the rail swings on. Six faces down, the shell opens and
// the naked core takes the last barrage.

// ---- the puzzle ------------------------------------------------------------

/**
 * Found by exhaustive offline search: every face ends single-colored using
 * only stickers no earlier face consumed, so the cube can be solved in order
 * and strips down to bare machinery exactly as the sixth face falls. Hits per
 * face climb 3, 4, 3, 3, 5, 5.
 */
export const SOLVE_PLAN: readonly PlanStep[] = [
  { axis: 1, quarters: [1, -1, 1] },
  { axis: 2, quarters: [2, 1, -1] },
  { axis: 0, quarters: [0, 1, 2] },
  { axis: 1, quarters: [-1, -1, -1] },
  { axis: 2, quarters: [2, 2, -1] },
  { axis: 2, quarters: [2, -1, 2] },
];
export const DERIVED_PLAN = derivePlan(SOLVE_PLAN);

// ---- world scale -----------------------------------------------------------

export const CUBE_CENTER = new Vector3(0, 0, 0);
export const CUBIE_PITCH = 4;
/** Outer face plane; stickers sit flush with it. */
export const FACE_PLANE = 6;
const TILE_LIFT = 0.55;
const WEAKPOINT_RISE = 1.9;

export const SPEEDSOLVE_PLAYER_HEALTH = 4;

// ---- tuning ----------------------------------------------------------------

const SOLVE_TIMING = {
  faceStartBeat: faceBeat,
  leadGridBeats: 1,
  gridBeats: 0.5,
  autoGridBeats: 0.25,
  minLeadBeats: 0.28,
  spinBeats: 0.62,
  fallGapBeats: 0.75,
  exposeDelayBeats: 1,
  lastExposeBeat: FACE_BEATS.weakpointDeadline - 1.25,
};

const WEAKPOINT_HP = [3, 3, 3, 4, 4, 4];
const CORE_STAGES = [6, 6];
const SHOT_MAX_AGE = 12;
const SHOT_STEER = { baseSpeed: 2.4, maxSpeed: 8, accel: 2.4, turnRate: 1.5 };
/** Shards brake well short of the lens so the incoming cube reads instead of swallowing the frame. */
const SHOT_IMPACT = { hitDistance: 3.4, impactBrake: 0.4, damageDistance: 1.8 };

// ---- camera ----------------------------------------------------------------

const FACE_FRAMES = FACE_NORMALS.map((normal, face) => frameQuaternion(FACE_RIGHT[face], FACE_UP[face], normal));
const FINALE_FRAME = new Quaternion();
const INTRO_FROM: Vec3i = [1, 1, 0];
const FINALE_TOWARD: Vec3i = [0, 0, 1];
const FACE_LEAN = 0.36;
const FACE_RADIUS = { from: 16.4, to: 14.8 };
/** The orbit aims this far out along the active face's normal, so the face sits centred in frame. */
const FACE_AIM = 3;
const SWING_BULGE = 6.5;
const ATTRACT = { yaw: 0.62, lift: 0.36, radius: 42, drop: 12.5 };
const INTRO_BLEND_SECONDS = 1.3;
const FINALE_POSE = { yaw: 0.46, lift: 0.22, radiusFrom: 21.5, radiusTo: 19.5 };

/** Where the camera came from and where it leans next, in each face's screen frame. */
const FACE_AIM_POINTS = FACE_NORMALS.map((normal) => new Vector3(...normal).multiplyScalar(FACE_AIM));
const FACE_LEANS = FACE_NORMALS.map((_, face) => {
  const previous = face === 0 ? INTRO_FROM : FACE_NORMALS[face - 1];
  const next = face === FACE_COUNT - 1 ? FINALE_TOWARD : FACE_NORMALS[face + 1];
  return {
    from: screenDirection(previous, FACE_RIGHT[face], FACE_UP[face]),
    to: screenDirection(next, FACE_RIGHT[face], FACE_UP[face]),
  };
});

function facePose(face: number, beatInPhrase: number): OrbitPose {
  const s = MathUtils.smootherstep(MathUtils.clamp(beatInPhrase / 16, 0, 1), 0, 1);
  const lean = FACE_LEANS[face];
  const yaw = MathUtils.lerp(lean.from[0], lean.to[0], s) * FACE_LEAN;
  const lift = MathUtils.lerp(lean.from[1], lean.to[1], s) * FACE_LEAN + 0.06;
  return {
    q: orbitQuaternion(FACE_FRAMES[face], yaw, lift),
    target: FACE_AIM_POINTS[face],
    radius: MathUtils.lerp(FACE_RADIUS.from, FACE_RADIUS.to, s),
    drop: 0,
  };
}

function attractPose(modeTime: number): OrbitPose {
  return {
    q: orbitQuaternion(FINALE_FRAME, ATTRACT.yaw + Math.sin(modeTime * 0.21) * 0.16, ATTRACT.lift + Math.sin(modeTime * 0.13) * 0.05),
    target: CUBE_CENTER,
    radius: ATTRACT.radius,
    drop: ATTRACT.drop,
  };
}

function finalePose(beat: number): OrbitPose {
  const start = SPEEDSOLVE_BARS.shell * 4 + 0.75;
  const end = SPEEDSOLVE_BARS.end * 4;
  const s = MathUtils.clamp((beat - start) / (end - start), 0, 1);
  const settle = 1 - (1 - s) ** 3;
  return {
    q: orbitQuaternion(FINALE_FRAME, FINALE_POSE.yaw * (1 - settle), FINALE_POSE.lift * (1 - settle)),
    target: CUBE_CENTER,
    radius: MathUtils.lerp(FINALE_POSE.radiusFrom, FINALE_POSE.radiusTo, settle),
    drop: 0,
  };
}

/** The authored orbit at a nominal beat of the run. */
export function authoredPose(beat: number): OrbitPose {
  const firstArrive = faceBeat(0) + FACE_BEATS.swingTo - 16;
  if (beat < firstArrive) {
    const t = MathUtils.clamp(beat / firstArrive, 0, 1);
    return blendPose(attractPose(0), facePose(0, firstArrive - faceBeat(0)), easeInOutCubic(t));
  }
  for (let face = 0; face < FACE_COUNT; face += 1) {
    const start = faceBeat(face);
    const local = beat - start;
    if (local < FACE_BEATS.swingFrom) return facePose(face, local);
    if (local < FACE_BEATS.swingTo) {
      const t = (local - FACE_BEATS.swingFrom) / (FACE_BEATS.swingTo - FACE_BEATS.swingFrom);
      const from = facePose(face, FACE_BEATS.swingFrom);
      const to = face === FACE_COUNT - 1 ? finalePose(start + FACE_BEATS.swingTo) : facePose(face + 1, FACE_BEATS.swingTo - 16);
      return blendPose(from, to, MathUtils.smootherstep(t, 0, 1), SWING_BULGE);
    }
  }
  return finalePose(beat);
}

// ---- rail ------------------------------------------------------------------

// The rail is a straight line the runner walks; the orbit above overrides
// where the camera actually is. A straight -Z rail keeps the runner's own
// look direction exactly identity, so the player's edge-look survives the
// override untouched, and the finale pose (looking down -Z) hands over to
// the REPLAY screen without a seam.
export function createSpeedsolveRail() {
  return new CatmullRomCurve3(
    [new Vector3(0, 0, 0), new Vector3(0, 0, -20), new Vector3(0, 0, -40), new Vector3(0, 0, -60)],
    false,
    'catmullrom',
    0.5,
  );
}

// ---- spawn data --------------------------------------------------------------

export type SpeedsolveEnemyKind = 'conductor' | 'tile' | 'weakpoint' | 'core' | 'tetra' | 'octa' | 'prism' | 'shard';

/** Frame 0..5 = the face frames, 6 = the finale frame, 'camera' = rides the orbit. */
type FrameRef = number | 'camera';
const FINALE = 6;

type ConductorData = { role: 'conductor' };
type TileData = { role: 'tile'; face: number; layer: number; slot: number; quarters: number };
type WeakpointData = { role: 'weakpoint'; face: number };
type CoreData = { role: 'core'; fireBeats: readonly number[] };
type CarouselData = {
  role: 'carousel';
  frame: number;
  phase: number;
  radius: readonly [number, number];
  depth: number;
  spin: 1 | -1;
  holdBeats: number;
  hue: number;
};
type GunnerData = {
  role: 'gunner';
  frame: number;
  rim: readonly [number, number];
  station: readonly [number, number];
  depth: number;
  fireBeats: readonly number[];
  exitBeat: number;
  hue: number;
};
type ZipperData = {
  role: 'zipper';
  frame: FrameRef;
  from: readonly [number, number];
  to: readonly [number, number];
  depth: number;
  travelBeats: number;
  arc: number;
  hue: number;
};
type BoltData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  hue: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type SpeedsolveSpawnData =
  | ConductorData
  | TileData
  | WeakpointData
  | CoreData
  | CarouselData
  | GunnerData
  | ZipperData
  | BoltData;
type Entry = LockOnSpawnEntry<SpeedsolveEnemyKind, SpeedsolveSpawnData>;
type Update = LockOnEnemyUpdate<SpeedsolveEnemyKind, SpeedsolveSpawnData>;

// ---- stage space ---------------------------------------------------------------
// Waves are authored in screen-ish units: x/y are NDC at the given depth in
// front of the face plane, so a formation fills the frame the same way on
// every face regardless of how that face is oriented in the world.

const TAN_HALF_FOV = Math.tan(MathUtils.degToRad(31));
const ASPECT = 16 / 9;
const FRAME_VIEW_DISTANCE = [12.4, 12.4, 12.4, 12.4, 12.4, 12.4, 14.5];
const CAMERA_FRAME_DISTANCE = 11;

function frameAxes(frame: number) {
  if (frame === FINALE) return { right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), normal: new Vector3(0, 0, 1) };
  return {
    right: new Vector3(...FACE_RIGHT[frame]),
    up: new Vector3(...FACE_UP[frame]),
    normal: new Vector3(...FACE_NORMALS[frame]),
  };
}
const FRAME_AXES = [0, 1, 2, 3, 4, 5, FINALE].map(frameAxes);

function stagePoint(frame: number, nx: number, ny: number, depth: number, out = new Vector3()) {
  const axes = FRAME_AXES[frame];
  const halfHeight = Math.max(1, FRAME_VIEW_DISTANCE[frame] - depth) * TAN_HALF_FOV;
  return out.copy(axes.normal).multiplyScalar(FACE_PLANE + depth)
    .addScaledVector(axes.right, nx * halfHeight * ASPECT)
    .addScaledVector(axes.up, ny * halfHeight);
}

export function slotWorldPosition(slot: number, lift = 0, out = new Vector3()) {
  const { p, n } = CUBE_SLOTS[slot];
  return out.set(p[0], p[1], p[2]).multiplyScalar(CUBIE_PITCH)
    .addScaledVector(new Vector3(n[0], n[1], n[2]), FACE_PLANE - CUBIE_PITCH + lift);
}

// ---- choreography --------------------------------------------------------------

const t = SPEEDSOLVE_TIME;
const beatTime = (beat: number) => t.beats(beat);

function carousel(
  beat: number,
  frame: number,
  count: number,
  options: { radius?: [number, number]; depth?: number; spin?: 1 | -1; hold?: number; hue?: number; phase?: number; stagger?: number },
): Entry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: beatTime(beat + index * (options.stagger ?? 0.25)),
    kind: 'tetra' as const,
    data: {
      role: 'carousel' as const,
      frame,
      phase: (options.phase ?? 0) + (index / count) * Math.PI * 2,
      radius: options.radius ?? [0.7, 0.72],
      depth: options.depth ?? 3.9,
      spin: options.spin ?? 1,
      holdBeats: (options.hold ?? 6) - index * (options.stagger ?? 0.25),
      hue: ((options.hue ?? frame) + (index % 2) * 3) % 6,
    },
  }));
}

function gunners(
  beat: number,
  frame: number,
  posts: Array<{ rim: [number, number]; station: [number, number] }>,
  options: { fire: number[]; exit: number; depth?: number; hue?: number },
): Entry[] {
  return posts.map((post, index) => ({
    time: beatTime(beat + index * 0.5),
    kind: 'octa' as const,
    data: {
      role: 'gunner' as const,
      frame,
      rim: post.rim,
      station: post.station,
      depth: options.depth ?? 4.2,
      fireBeats: options.fire.map((fire) => fire + (index % 2) * 0.5),
      exitBeat: options.exit - index * 0.5,
      hue: ((options.hue ?? frame) + index * 2) % 6,
    },
  }));
}

function zipper(
  beat: number,
  frame: FrameRef,
  count: number,
  from: [number, number],
  to: [number, number],
  options: { depth?: number; travel?: number; arc?: number; hue?: number; spacing?: number },
): Entry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: beatTime(beat + index * (options.spacing ?? 0.5)),
    kind: 'prism' as const,
    data: {
      role: 'zipper' as const,
      frame,
      from,
      to,
      depth: options.depth ?? 4.8,
      travelBeats: options.travel ?? 5.5,
      arc: options.arc ?? 0,
      hue: ((options.hue ?? 0) + index) % 6,
    },
  }));
}

function faceTiles(face: number): Entry[] {
  const step = SOLVE_PLAN[face];
  return DERIVED_PLAN.wrongLayers[face].map(({ layer, quarters }, index) => {
    // The bracket sits on one end of its row so brackets spread across the
    // face instead of stacking on the center column.
    const along = axisAlongLayer(face, step.axis);
    const end = (face + index) % 2 === 0 ? 1 : -1;
    const slot = FACE_SLOTS[face].find((candidate) => {
      const p = CUBE_SLOTS[candidate].p;
      return p[step.axis] === layer && dot(p, along) === end;
    }) ?? FACE_SLOTS[face][0];
    return {
      time: beatTime(faceBeat(face) + FACE_BEATS.tilesArm + index * 0.25),
      kind: 'tile' as const,
      hitPoints: Math.abs(quarters),
      data: { role: 'tile' as const, face, layer, slot, quarters },
    };
  });
}

/** The in-face axis a layer's slots run along (neither the face normal nor the slice axis). */
function axisAlongLayer(face: number, sliceAxis: number): Vec3i {
  const normalAxis = FACE_NORMALS[face].findIndex((component) => component !== 0);
  const along = [0, 1, 2].find((axis) => axis !== normalAxis && axis !== sliceAxis) ?? 0;
  const v: [number, number, number] = [0, 0, 0];
  v[along] = 1;
  return v;
}

function faceWaves(face: number): Entry[] {
  const b = faceBeat(face);
  switch (face) {
    case 0: // red — the lesson: a slow carousel, two gunners, one low train.
      return [
        ...carousel(b + 2, 0, 5, { radius: [0.72, 0.74], spin: 1, hold: 7, hue: 1 }),
        ...gunners(b + 6, 0, [
          { rim: [-0.3, 0.45], station: [-0.74, 0.62] },
          { rim: [0.3, 0.45], station: [0.74, 0.62] },
        ], { fire: [3], exit: 7.5, hue: 2 }),
        ...zipper(b + 10, 0, 3, [-1.25, -0.72], [1.25, -0.5], { travel: 5.5, arc: 0.08, hue: 3 }),
      ];
    case 1: // blue — a high train, gunners either side, then the ring closes.
      return [
        ...zipper(b + 1.5, 1, 4, [1.25, 0.72], [-1.25, 0.55], { travel: 5.5, arc: -0.1, hue: 4 }),
        ...gunners(b + 3.5, 1, [
          { rim: [-0.35, 0], station: [-0.8, -0.1] },
          { rim: [0.35, 0], station: [0.8, 0.12] },
        ], { fire: [2.5], exit: 6.5, hue: 0 }),
        ...carousel(b + 7.5, 1, 5, { radius: [0.74, 0.72], spin: -1, hold: 5, hue: 2 }),
      ];
    case 2: // yellow — two counter-rotating rings.
      return [
        ...carousel(b + 1.5, 2, 4, { radius: [0.8, 0.76], spin: 1, hold: 6.5, hue: 0, stagger: 0.5 }),
        ...carousel(b + 1.75, 2, 3, { radius: [0.5, 0.5], spin: -1, hold: 6, hue: 3, phase: Math.PI / 3, stagger: 0.5 }),
        ...gunners(b + 5.5, 2, [
          { rim: [-0.3, -0.45], station: [-0.72, -0.64] },
          { rim: [0.3, -0.45], station: [0.72, -0.64] },
        ], { fire: [2, 4], exit: 6.5, hue: 1 }),
        ...zipper(b + 10, 2, 4, [-0.8, 1.2], [0.8, -1.2], { travel: 5, arc: 0.18, hue: 4 }),
      ];
    case 3: // green — gunners bracket the face, a train, the ring.
      return [
        ...gunners(b + 1, 3, [
          { rim: [-0.35, 0.3], station: [-0.78, 0.5] },
          { rim: [0.35, -0.3], station: [0.78, -0.5] },
        ], { fire: [2, 4], exit: 6, hue: 4 }),
        ...zipper(b + 3.5, 3, 4, [-1.25, 0.1], [1.25, 0.75], { travel: 5, arc: -0.12, hue: 1 }),
        ...carousel(b + 7, 3, 6, { radius: [0.76, 0.74], spin: 1, hold: 5, hue: 5 }),
      ];
    case 4: // orange — a dense ring, a long train, three gunners.
      return [
        ...carousel(b + 1.5, 4, 7, { radius: [0.78, 0.76], spin: -1, hold: 6, hue: 3, stagger: 0.25 }),
        ...zipper(b + 5.5, 4, 5, [1.25, -0.72], [-1.25, 0.2], { travel: 5, arc: 0.15, hue: 2, spacing: 0.5 }),
        ...gunners(b + 8.5, 4, [
          { rim: [-0.35, 0.3], station: [-0.8, 0.66] },
          { rim: [0, -0.45], station: [0, -0.8] },
          { rim: [0.35, 0.3], station: [0.8, 0.66] },
        ], { fire: [1.5], exit: 5, hue: 5 }),
      ];
    default: // pink — the densest phrase: four gunners, a long train, the ring.
      return [
        ...gunners(b + 1, 5, [
          { rim: [-0.35, 0.3], station: [-0.8, 0.64] },
          { rim: [0.35, 0.3], station: [0.8, 0.64] },
          { rim: [-0.35, -0.3], station: [-0.8, -0.64] },
          { rim: [0.35, -0.3], station: [0.8, -0.64] },
        ], { fire: [2.5], exit: 6, hue: 1 }),
        ...zipper(b + 4.5, 5, 5, [-1.25, 0], [1.25, 0.1], { travel: 5, arc: 0.3, hue: 0, spacing: 0.5 }),
        ...carousel(b + 8, 5, 7, { radius: [0.78, 0.76], spin: 1, hold: 4.5, hue: 4, stagger: 0.25 }),
      ];
  }
}

/** Trains that ride the swing itself, so the rail's fastest moment is also a sweep. */
function swingTrain(face: number): Entry[] {
  const b = faceBeat(face) + FACE_BEATS.swingFrom - 0.5;
  const high = face % 2 === 0;
  return zipper(b, 'camera', 3, [-1.3, high ? 0.5 : -0.5], [1.3, high ? -0.2 : 0.3], {
    depth: CAMERA_FRAME_DISTANCE,
    travel: 4,
    arc: high ? 0.12 : -0.12,
    hue: face + 2,
    spacing: 0.25,
  });
}

function finaleWaves(): Entry[] {
  const b = SPEEDSOLVE_BARS.shell * 4;
  return [
    {
      time: t.bar(SPEEDSOLVE_BARS.coreArmed),
      kind: 'core',
      hitStages: CORE_STAGES,
      data: { role: 'core', fireBeats: [3, 5, 7, 9] },
    },
    ...carousel(b + 1, FINALE, 6, { radius: [0.8, 0.76], depth: 4.5, spin: 1, hold: 6, hue: 0, stagger: 0.25 }),
    ...gunners(b + 7, FINALE, [
      { rim: [-0.25, 0.25], station: [-0.8, 0.62] },
      { rim: [0.25, 0.25], station: [0.8, 0.62] },
    ], { fire: [2], exit: 5.5, depth: 5, hue: 2 }),
    ...zipper(b + 10.5, FINALE, 4, [-1.25, -0.55], [1.25, -0.4], { depth: 5.5, travel: 4, arc: 0.15, hue: 3, spacing: 0.5 }),
  ];
}

function introWaves(): Entry[] {
  // The assembly bar: one train crosses while the cube snaps together.
  return zipper(5, 'camera', 4, [-1.3, -0.5], [1.3, -0.35], { depth: CAMERA_FRAME_DISTANCE - 1, travel: 3.5, arc: 0.1, hue: 0, spacing: 0.5 });
}

function createTimeline(): Entry[] {
  const entries: Entry[] = [{ time: 0, kind: 'conductor', lockable: false, countsTowardTotal: false, data: { role: 'conductor' } }];
  entries.push(...introWaves());
  for (let face = 0; face < FACE_COUNT; face += 1) {
    entries.push(...faceTiles(face), ...faceWaves(face));
    entries.push(...swingTrain(face));
  }
  entries.push(...finaleWaves());
  return sortTimeline(entries);
}

export const SPEEDSOLVE_TIMELINE = createTimeline();

// ---- scoring -----------------------------------------------------------------

const KILL_SCORE: Record<SpeedsolveEnemyKind, number> = {
  conductor: 0,
  tile: 300,
  weakpoint: 1000,
  core: 5000,
  tetra: 100,
  octa: 150,
  prism: 100,
  shard: 60,
};

// ---- gameplay ----------------------------------------------------------------

export function createSpeedsolveGameplay(bus: EventBus) {
  const clock = createBeatClock(bus, BEAT);
  const machine = createSolveMachine(SOLVE_PLAN, DERIVED_PLAN, SOLVE_TIMING, BEAT);
  const tileByEnemy = new Map<number, TileData>();
  const weakpointByEnemy = new Map<number, number>();
  const shotsIntercepted = new Set<number>();
  const pose = { position: new Vector3(), quaternion: new Quaternion() };
  const finale = { shellOpened: false, burst: false, coreId: -1, coreDestroyed: false };
  let cameraRef: PerspectiveCamera | null = null;
  let hitsTaken = 0;
  let lastRunTime = 0;
  let assembled = false;
  const startPose = { position: new Vector3(), base: new Quaternion() };
  const easeFrom = { position: new Vector3(), look: new Vector3(0, 0, -1) };
  const lastBase = new Quaternion();

  bus.on('runstart', () => {
    machine.reset();
    tileByEnemy.clear();
    weakpointByEnemy.clear();
    shotsIntercepted.clear();
    finale.shellOpened = false;
    finale.burst = false;
    finale.coreId = -1;
    finale.coreDestroyed = false;
    hitsTaken = 0;
    lastRunTime = 0;
    assembled = false;
    // The runner captured exactly this camera state for its own ease; keep a
    // copy so the override can undo that ease and keep only the edge-look.
    if (cameraRef) {
      easeFrom.position.copy(cameraRef.position);
      cameraRef.getWorldDirection(easeFrom.look);
      startPose.position.copy(cameraRef.position);
    } else {
      easeFrom.position.set(0, 0, 0);
      easeFrom.look.set(0, 0, -1);
      startPose.position.set(0, 0, 0);
    }
    startPose.base.copy(lastBase);
  });

  bus.on('runend', () => {
    lastBase.identity();
    // Scramble restored for the next attempt; the cube re-forms behind REPLAY.
    machine.reset();
    emitCubeSignal({ type: 'reform', delaySeconds: 1.1, pieces: 26, spanBeats: 5.5 });
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    shotsIntercepted.add(enemyId);
  });

  bus.on('hit', ({ enemyId }) => {
    const tile = tileByEnemy.get(enemyId);
    if (tile) machine.requestTurn(tile.face, tile.layer, clock.beatAt(lastRunTime));
  });

  bus.on('kill', ({ enemyId }) => {
    shotsIntercepted.delete(enemyId);
    tileByEnemy.delete(enemyId);
    const face = weakpointByEnemy.get(enemyId);
    if (face !== undefined) {
      weakpointByEnemy.delete(enemyId);
      machine.conquer(face, clock.beatAt(lastRunTime), true);
    }
    if (enemyId === finale.coreId) {
      finale.coreDestroyed = true;
      if (!finale.burst) {
        finale.burst = true;
        emitCubeSignal({ type: 'burst', beat: clock.beatAt(lastRunTime), destroyed: true });
      }
    }
  });

  bus.on('miss', ({ enemyId }) => {
    shotsIntercepted.delete(enemyId);
    tileByEnemy.delete(enemyId);
  });

  // ---- per-role motion --------------------------------------------------------

  const scratch = new Vector3();
  const scratchQ = new Quaternion();

  function updateConductor(context: Update) {
    const { enemy, camera, runTime } = context;
    const beat = clock.beatAt(runTime);
    if (!assembled) {
      assembled = true;
      emitCubeSignal({ type: 'assemble', beat: Math.max(0, beat), pieces: 26, spanBeats: 6 });
    }
    machine.tick(beat);
    for (const face of machine.takeExposures()) {
      context.spawnEnemy({
        time: runTime,
        kind: 'weakpoint',
        hitPoints: WEAKPOINT_HP[face],
        data: { role: 'weakpoint', face },
      });
    }
    if (!finale.shellOpened && beat >= SPEEDSOLVE_BARS.shell * 4) {
      finale.shellOpened = true;
      emitCubeSignal({ type: 'shell', beat: SPEEDSOLVE_BARS.shell * 4 });
    }
    // Parked behind the camera: it keeps the books, it is never a target.
    camera.getWorldDirection(scratch);
    enemy.mesh.position.copy(camera.position).addScaledVector(scratch, -60);
    return false;
  }

  function updateTile(context: Update, data: TileData) {
    const { enemy, runTime } = context;
    context.enemyState(() => {
      tileByEnemy.set(enemy.id, data);
      machine.arm(data.face, clock.beatAt(runTime));
      return {};
    });
    slotWorldPosition(data.slot, TILE_LIFT, enemy.mesh.position);
    enemy.mesh.quaternion.copy(FACE_FRAMES[data.face]);
    const beat = clock.beatAt(runTime);
    if (beat >= faceBeat(data.face) + FACE_BEATS.tileDeadline) {
      // Too slow: the machine turns the rest of this row by itself.
      for (let i = 0; i < enemy.hitPointsRemaining; i += 1) machine.requestTurn(data.face, data.layer, beat, true);
      return true;
    }
    return false;
  }

  function updateWeakpoint(context: Update, data: WeakpointData) {
    const { enemy, runTime, age } = context;
    context.enemyState(() => {
      weakpointByEnemy.set(enemy.id, data.face);
      return {};
    });
    const rise = easeOutBack(MathUtils.clamp(age / 0.45, 0, 1)) * WEAKPOINT_RISE;
    enemy.mesh.position.copy(FRAME_AXES[data.face].normal).multiplyScalar(FACE_PLANE + rise);
    scratchQ.setFromAxisAngle(FRAME_AXES[data.face].normal, age * 2.6);
    enemy.mesh.quaternion.copy(scratchQ).multiply(FACE_FRAMES[data.face]);
    if (clock.beatAt(runTime) >= faceBeat(data.face) + FACE_BEATS.weakpointDeadline) {
      weakpointByEnemy.delete(enemy.id);
      machine.conquer(data.face, clock.beatAt(runTime), false);
      return true;
    }
    return false;
  }

  function updateCore(context: Update, data: CoreData) {
    const { enemy, runTime, age } = context;
    const state = context.enemyState(() => {
      finale.coreId = enemy.id;
      return { fired: 0 };
    });
    enemy.mesh.position.set(0, Math.sin(age * 1.7) * 0.25, 0);
    const damage = 1 - enemy.hitPointsRemaining / CORE_STAGES.reduce((sum, hp) => sum + hp, 0);
    enemy.mesh.userData.spin = 1.2 + age * 0.9 + damage * 6;
    enemy.mesh.userData.damage = damage;
    const beatAge = age / BEAT;
    while (state.fired < data.fireBeats.length && beatAge >= data.fireBeats[state.fired]) {
      const hueBase = state.fired * 2;
      for (let i = 0; i < 2; i += 1) {
        const angle = (state.fired * 0.9 + i * Math.PI) + Math.PI / 4;
        // Launched from the rim of the spinning core, clear of its arms.
        scratch.set(Math.cos(angle) * 5, Math.sin(angle) * 5, 8.5).add(enemy.mesh.position);
        fireShard(context, scratch, (hueBase + i * 3) % 6);
      }
      state.fired += 1;
    }
    if (runTime >= t.bar(SPEEDSOLVE_BARS.coreDeadline)) {
      if (!finale.burst) {
        finale.burst = true;
        emitCubeSignal({ type: 'burst', beat: clock.beatAt(runTime), destroyed: false });
      }
      return true;
    }
    return false;
  }

  function updateCarousel(context: Update, data: CarouselData) {
    const { enemy, age } = context;
    const beats = age / BEAT;
    const angle = data.phase + data.spin * beats * (Math.PI * 2 / 9);
    let spread = 1;
    let depth = data.depth;
    let done = false;
    if (beats < 1.5) {
      const k = easeOutCubic(beats / 1.5);
      spread = k;
      // Emerge in front of the volume a turning slice sweeps through.
      depth = MathUtils.lerp(2.6, data.depth, k);
    } else if (beats > 1.5 + data.holdBeats) {
      const e = (beats - 1.5 - data.holdBeats) / 1.6;
      spread = 1 + e * e * 1.6;
      depth = data.depth + e * 1.2;
      done = e >= 1;
    }
    const breathe = 1 + Math.sin(beats * Math.PI * 2) * 0.025;
    stagePoint(data.frame, Math.cos(angle) * data.radius[0] * spread * breathe, Math.sin(angle) * data.radius[1] * spread * breathe, depth, enemy.mesh.position);
    tumble(enemy.mesh.quaternion, enemy.id, age, 2.2);
    return done;
  }

  function updateGunner(context: Update, data: GunnerData) {
    const { enemy, age } = context;
    const state = context.enemyState(() => ({ fired: 0 }));
    const beats = age / BEAT;
    const rim = stagePoint(data.frame, data.rim[0], data.rim[1], 0.4, new Vector3());
    const station = stagePoint(data.frame, data.station[0], data.station[1], data.depth, new Vector3());
    let charge = 0;
    if (beats < 1.25) {
      enemy.mesh.position.copy(rim).lerp(station, easeOutBack(beats / 1.25));
    } else if (beats < data.exitBeat) {
      enemy.mesh.position.copy(station).addScaledVector(FRAME_AXES[data.frame].up, Math.sin(beats * Math.PI) * 0.3);
      const nextFire = data.fireBeats[state.fired];
      if (nextFire !== undefined) {
        charge = MathUtils.clamp(1 - (nextFire - beats) / 0.75, 0, 1);
        if (beats >= nextFire) {
          fireShard(context, enemy.mesh.position, (data.hue + state.fired) % 6);
          state.fired += 1;
        }
      }
    } else {
      const e = (beats - data.exitBeat) / 1.1;
      enemy.mesh.position.copy(station).lerp(rim, easeInCubic(Math.min(1, e)));
      if (e >= 1) return true;
    }
    enemy.mesh.userData.charge = charge;
    tumble(enemy.mesh.quaternion, enemy.id, age, 1.1 + charge * 7);
    return false;
  }

  function updateZipper(context: Update, data: ZipperData) {
    const { enemy, age } = context;
    const progress = age / BEAT / data.travelBeats;
    const x = MathUtils.lerp(data.from[0], data.to[0], progress);
    const y = MathUtils.lerp(data.from[1], data.to[1], progress) + Math.sin(Math.PI * progress) * data.arc;
    if (data.frame === 'camera') {
      const halfHeight = data.depth * TAN_HALF_FOV;
      scratch.set(x * halfHeight * ASPECT, y * halfHeight, -data.depth).applyQuaternion(pose.quaternion);
      enemy.mesh.position.copy(pose.position).add(scratch);
      enemy.mesh.quaternion.copy(pose.quaternion);
    } else {
      stagePoint(data.frame, x, y, data.depth, enemy.mesh.position);
      enemy.mesh.quaternion.copy(data.frame === FINALE ? FINALE_FRAME : FACE_FRAMES[data.frame]);
    }
    // Long axis along the travel, rolling like a drill bit.
    const heading = Math.atan2(data.to[1] - data.from[1], data.to[0] - data.from[0]);
    scratchQ.setFromAxisAngle(Z_AXIS, heading - Math.PI / 2);
    enemy.mesh.quaternion.multiply(scratchQ);
    scratchQ.setFromAxisAngle(Y_AXIS, age * 7);
    enemy.mesh.quaternion.multiply(scratchQ);
    return progress >= 1;
  }

  function fireShard(context: Update, from: Vector3, hue: number) {
    // Launched outward, away from the middle of the view, so every cubelet
    // loops wide and takes a readable couple of seconds to come home.
    const aim = hostileShotAimPoint(context.camera, from);
    const outward = from.clone().sub(aim);
    const toward = aim.clone().sub(from).normalize();
    outward.addScaledVector(toward, -outward.dot(toward));
    if (outward.lengthSq() < 0.01) outward.set(0, 1, 0);
    const initial = outward.normalize().multiplyScalar(6).addScaledVector(toward, -1.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'shard',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, hue },
    });
  }

  function updateBolt(context: Update, data: BoltData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: shotsIntercepted.delete(enemy.id),
      config: SHOT_IMPACT,
    });
    enemy.mesh.userData.closeness = MathUtils.clamp(1 - (data.position.distanceTo(camera.position) - 2) / 10, 0, 1);
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      tumble(enemy.mesh.quaternion, enemy.id, age, 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, SHOT_STEER);
    enemy.mesh.position.copy(data.position);
    tumble(enemy.mesh.quaternion, enemy.id, age, 4.5);
    return shotBehindCamera(camera, data.position) || age > SHOT_MAX_AGE;
  }

  // ---- camera ---------------------------------------------------------------------

  const railBase = new Quaternion();
  const edge = new Quaternion();
  const railEye = new Vector3();
  const railTarget = new Vector3();
  const blendQ = new Quaternion();

  function applyCamera(camera: PerspectiveCamera, curve: CatmullRomCurve3, runTime: number, runProgress: number) {
    cameraRef = camera;
    lastRunTime = runTime;
    clock.frame(runTime);
    // Recover the runner's edge-look: it applied it on top of its own base,
    // which is identity once its one-second ease is over.
    const ease = Math.min(1, runTime);
    if (ease < 1) {
      const eased = ease * ease * (3 - 2 * ease);
      railEye.copy(easeFrom.position).lerp(curve.getPointAt(runProgress), eased);
      railTarget.copy(easeFrom.position).add(easeFrom.look).lerp(curve.getPointAt(Math.min(1, runProgress + 0.025)), eased);
      cameraLookQuaternion(railEye, railTarget, railBase);
    } else {
      railBase.identity();
    }
    edge.copy(railBase).invert().multiply(camera.quaternion);

    const authored = authoredPose(runTime / BEAT);
    poseCamera(authored, pose.position, pose.quaternion);
    const blend = MathUtils.smootherstep(MathUtils.clamp(runTime / INTRO_BLEND_SECONDS, 0, 1), 0, 1);
    if (blend < 1) {
      pose.position.lerpVectors(startPose.position, pose.position, blend);
      blendQ.copy(startPose.base).slerp(pose.quaternion, blend);
      pose.quaternion.copy(blendQ);
    }
    lastBase.copy(pose.quaternion);
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion).multiply(edge);
    camera.updateMatrixWorld();
  }

  const level: LockOnRunnerLevel<SpeedsolveEnemyKind, SpeedsolveSpawnData> = {
    duration: SPEEDSOLVE_RUN_DURATION,
    bpm: SPEEDSOLVE_BPM,
    playerHealth: SPEEDSOLVE_PLAYER_HEALTH,
    createRail: createSpeedsolveRail,
    spawnTimeline: SPEEDSOLVE_TIMELINE,
    easeRunProgress: (time, duration) => MathUtils.clamp(time / duration, 0, 1),
    lockRadiusNdc: 0.095,
    timing: {
      // Clean, quantized attacks: impacts snap to 32nds and the volley ramp
      // tops out at a half-bar so a full release still lands inside the phrase.
      shotDelay: { maxGridSeconds: 0.95 },
      actionSfx: { gridThirtyseconds: 2 },
    },
    updateAttractCamera({ camera, modeTime }) {
      cameraRef = camera;
      const attract = attractPose(modeTime);
      poseCamera(attract, camera.position, camera.quaternion);
      lastBase.copy(camera.quaternion);
      pose.position.copy(camera.position);
      pose.quaternion.copy(camera.quaternion);
      camera.updateMatrixWorld();
    },
    updateCameraEffects({ camera, curve, runTime, runProgress }) {
      applyCamera(camera, curve, runTime, runProgress);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      // Visuals read hue and remaining HP straight off the mesh.
      const userData = context.enemy.mesh.userData;
      if ('hue' in data) userData.hue = data.hue;
      else if (data.role === 'weakpoint' || data.role === 'tile') userData.hue = data.face;
      userData.hp = context.enemy.hitPointsRemaining;
      switch (data.role) {
        case 'conductor':
          return updateConductor(context);
        case 'tile':
          return updateTile(context, data);
        case 'weakpoint':
          return updateWeakpoint(context, data);
        case 'core':
          return updateCore(context, data);
        case 'carousel':
          return updateCarousel(context, data);
        case 'gunner':
          return updateGunner(context, data);
        case 'zipper':
          return updateZipper(context, data);
        case 'bolt':
          return updateBolt(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.12;
      let score = KILL_SCORE[enemy.kind];
      if (enemy.kind === 'weakpoint') {
        const face = weakpointByEnemy.get(enemy.id) ?? (enemy.entry.data as WeakpointData).face;
        const progress = machine.faces[face];
        // Speedsolve bonus: a hand-solved face pays for every second under eight.
        if (!progress.auto) score += Math.round(Math.max(0, 8 - progress.solveSeconds) * 250);
      }
      return Math.round(score * multiplier);
    },
    scoreForHit(_volleySize, enemy) {
      if (enemy.kind === 'tile') return 150;
      if (enemy.kind === 'core') return 200;
      return 60;
    },
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      const turns = results.filter((result) => result.enemy.kind === 'tile').length;
      let bonus = 0;
      if (results.length === 6 && kills === 6) bonus += 600;
      if (turns >= 2) bonus += (turns - 1) * 250;
      return bonus;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const conquered = machine.faces.filter((face) => face.destroyed).length;
      if (score >= 41000 && clearRate >= 0.9 && conquered === 6 && finale.coreDestroyed) return 'S';
      if (score >= 33000 && clearRate >= 0.75 && conquered >= 5) return 'A';
      if (score >= 24000 && clearRate >= 0.55) return 'B';
      if (score >= 13000 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const byHand = machine.faces.filter((face) => face.status !== 'waiting' && !face.auto && face.solveSeconds > 0);
      const conquered = machine.faces.filter((face) => face.destroyed).length;
      const lines = [`Faces solved by hand ${byHand.length}/6 · weakpoints ${conquered}/6`];
      if (byHand.length) {
        const times = byHand.map((face) => face.solveSeconds);
        const best = Math.min(...times);
        const average = times.reduce((sum, value) => sum + value, 0) / times.length;
        lines.push(`Fastest face ${best.toFixed(2)}s · average ${average.toFixed(2)}s`);
      }
      const hull = Math.max(0, SPEEDSOLVE_PLAYER_HEALTH - hitsTaken);
      lines.push(`Core ${finale.coreDestroyed ? 'shattered' : 'survived'} · hull ${hull}/${SPEEDSOLVE_PLAYER_HEALTH}`);
      return lines;
    },
  };

  // The runner (and the headless simulator) take the level object as-is; the
  // extra handles let visuals read the live puzzle without a second source.
  return Object.assign(level, {
    clock,
    machine,
    pose,
    finale,
    currentRunTime: () => lastRunTime,
  });
}

export type SpeedsolveGameplay = ReturnType<typeof createSpeedsolveGameplay>;

const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);
const tumbleAxis = new Vector3();
const tumbleQ = new Quaternion();

function tumble(out: Quaternion, id: number, age: number, rate: number) {
  const a = id * 1.618;
  tumbleAxis.set(Math.sin(a), Math.cos(a * 1.3), Math.sin(a * 0.7 + 1)).normalize();
  tumbleQ.setFromAxisAngle(tumbleAxis, age * rate + id);
  out.copy(tumbleQ);
}

function easeOutCubic(x: number) {
  return 1 - (1 - MathUtils.clamp(x, 0, 1)) ** 3;
}

function easeInCubic(x: number) {
  const c = MathUtils.clamp(x, 0, 1);
  return c * c * c;
}

function easeInOutCubic(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

function easeOutBack(x: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}
