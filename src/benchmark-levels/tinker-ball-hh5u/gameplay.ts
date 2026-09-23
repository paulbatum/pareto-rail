import { MathUtils, Quaternion, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  BALL_DROP_DEG,
  CAMERA_ELEVATION_DEG,
  createBallDirector,
  TIER_RADIUS,
  TIER_SCALE,
  TIER_VIEW,
  type BallDirector,
  type Tier,
} from './ball';
import { createRoute } from './route';
import { createSpill, type SpillData } from './spill';
import { bar, BAR_SECONDS, BEAT_SECONDS, TINKER_BARS, TINKER_BPM, TINKER_RUN_DURATION } from './timing';

export { TINKER_BPM, TINKER_RUN_DURATION } from './timing';

// Tinker Ball: a rolling ball cleans up one enormous worktable. Glue monsters
// have stolen ordinary supplies and built bodies around black adhesive cores;
// shoot the core and the body falls apart into clean pieces, and the ball arcs
// through each fresh debris field to roll them up. Three size tiers, three
// kinds of monster rebuilt from each tier's supplies, then the spill.

export const TINKER_PLAYER_HEALTH = 4;

export type Family = 'beetle' | 'strider' | 'snapper';

export type TinkerEnemyKind =
  | 'button-beetle'
  | 'spool-beetle'
  | 'jar-beetle'
  | 'pin-strider'
  | 'pencil-strider'
  | 'ruler-strider'
  | 'paper-snapper'
  | 'card-snapper'
  | 'crate-snapper'
  | 'spill-core'
  | 'spill-heart'
  | 'glue-glob';

type KindInfo = { family: Family | 'core' | 'heart' | 'glob'; tier: Tier; score: number };

export const KIND_INFO: Record<TinkerEnemyKind, KindInfo> = {
  'button-beetle': { family: 'beetle', tier: 0, score: 100 },
  'spool-beetle': { family: 'beetle', tier: 1, score: 110 },
  'jar-beetle': { family: 'beetle', tier: 2, score: 130 },
  'pin-strider': { family: 'strider', tier: 0, score: 120 },
  'pencil-strider': { family: 'strider', tier: 1, score: 130 },
  'ruler-strider': { family: 'strider', tier: 2, score: 150 },
  'paper-snapper': { family: 'snapper', tier: 0, score: 110 },
  'card-snapper': { family: 'snapper', tier: 1, score: 120 },
  'crate-snapper': { family: 'snapper', tier: 2, score: 140 },
  'spill-core': { family: 'core', tier: 2, score: 450 },
  'spill-heart': { family: 'heart', tier: 2, score: 2400 },
  'glue-glob': { family: 'glob', tier: 2, score: 40 },
};

const FAMILY_KIND: Record<Family, [TinkerEnemyKind, TinkerEnemyKind, TinkerEnemyKind]> = {
  beetle: ['button-beetle', 'spool-beetle', 'jar-beetle'],
  strider: ['pin-strider', 'pencil-strider', 'ruler-strider'],
  snapper: ['paper-snapper', 'card-snapper', 'crate-snapper'],
};

// Where the glue core rides on each family's body, in marble-tier units
// (multiplied by the tier build scale).
export const CORE_HEIGHT: Record<Family, number> = { beetle: 0.62, strider: 0, snapper: 0 };

/**
 * Lane choreography is authored in screen terms so it survives three very
 * different camera scales. `a` is how far ahead of the ball along the route
 * (in chase distances of the enemy's tier), `x` is a normalized screen
 * column (±1 ≈ the screen edges), and `y` is a normalized screen row for
 * fliers or a physical height (chase distances) for striders. Beetles walk on
 * the table. A target slides from a0 to aEnd over its window, lingering in
 * the middle of it.
 */
export type WaveData = {
  role: 'wave';
  family: Family;
  tier: Tier;
  window: number;
  a0: number;
  aEnd: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  seed: number;
  hop: boolean;
  /** Beat offset for gait/snap phase so a formation moves as one or ripples. */
  phase: number;
  /** 'rail' anchors to the route; 'view' rides with the camera during the spill orbit. */
  frame: 'rail' | 'view';
};

export type GlobData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type TinkerSpawnData = WaveData | SpillData | GlobData;
export type TinkerSpawnEntry = LockOnSpawnEntry<TinkerEnemyKind, TinkerSpawnData>;
export type TinkerUpdate = LockOnEnemyUpdate<TinkerEnemyKind, TinkerSpawnData>;

type Member = {
  /** Screen column at spawn and at the end of the window. */
  x: readonly number[];
  y?: number | readonly number[];
  a0?: number;
  aEnd?: number;
  window?: number;
  hop?: boolean;
  phase?: number;
  seed?: number;
  hitPoints?: number;
};

const DEFAULT_WINDOW: Record<Tier, number> = { 0: 5.4, 1: 5.0, 2: 4.8 };
const DEFAULT_Y: Record<Family, number> = { beetle: 0, strider: 0.5, snapper: 0.7 };
const DEFAULT_A: Record<Family, readonly [number, number]> = {
  beetle: [0.55, -0.55],
  strider: [0.6, -0.45],
  snapper: [0.7, -0.3],
};

function wave(atBar: number, family: Family, tier: Tier, members: Member[], staggerBeats = 0.25): TinkerSpawnEntry[] {
  const frame = atBar >= TINKER_BARS.spill ? 'view' : 'rail';
  return members.map((member, index) => {
    const y = member.y ?? DEFAULT_Y[family];
    const [y0, y1] = typeof y === 'number' ? [y, y] : y;
    const entry: TinkerSpawnEntry = {
      time: bar(atBar) + index * staggerBeats * BEAT_SECONDS,
      kind: FAMILY_KIND[family][tier],
      data: {
        role: 'wave',
        family,
        tier,
        window: member.window ?? DEFAULT_WINDOW[tier],
        a0: member.a0 ?? DEFAULT_A[family][0],
        aEnd: member.aEnd ?? DEFAULT_A[family][1],
        x0: member.x[0],
        x1: member.x[1],
        y0,
        y1,
        seed: member.seed ?? index * 1.37 + atBar * 0.71,
        hop: member.hop ?? false,
        phase: member.phase ?? 0,
        frame,
      },
    };
    // Heavier loads take two cores' worth of glue.
    if (member.hitPoints) entry.hitPoints = member.hitPoints;
    return entry;
  });
}

const mirror = (members: Member[]): Member[] => members.map((member) => ({ ...member, x: [-member.x[0], -member.x[1]] }));

function createTimeline(spillEntries: TinkerSpawnEntry[]): TinkerSpawnEntry[] {
  return [
    // ── Bar 0: the wind-up. The ball rolls out among the buttons; nothing to
    // shoot until the groove lands.

    // ── MARBLE (bars 1–8): buttons, pins, beads, paperclips.
    // A skitter of button beetles out of the button tin, left and right.
    ...wave(1, 'beetle', 0, [
      { x: [-0.62, -0.4] }, { x: [0.62, 0.4] }, { x: [-0.36, -0.72] }, { x: [0.36, 0.74] },
    ], 0.5),
    // Pin striders step in from the right edge, one per beat.
    ...wave(2.5, 'strider', 0, [
      { x: [1.0, -0.35], y: 0.5 }, { x: [1.05, 0.05], y: 0.62 }, { x: [1.1, 0.42], y: 0.44 },
    ], 1),
    // Paper snappers swoop out of the high left, a ragged flock.
    ...wave(4, 'snapper', 0, [
      { x: [-0.95, 0.55], y: [0.85, 0.5] }, { x: [-1.05, 0.25], y: [0.95, 0.64] }, { x: [-0.9, 0.8], y: [0.72, 0.4] },
      { x: [-1.1, -0.1], y: [0.9, 0.76] }, { x: [-1.0, 0.42], y: [1.0, 0.86] },
    ], 0.5),
    // Drive: beetles hold the left, striders stride in on the right.
    ...wave(5, 'beetle', 0, [
      { x: [-0.8, -0.38], hop: true }, { x: [-0.55, -0.78] }, { x: [-0.34, -0.52], hop: true },
    ], 0.5),
    ...wave(5.5, 'strider', 0, [{ x: [0.98, 0.42], y: 0.56 }, { x: [0.72, 0.62], y: 0.42 }], 1),
    // A V of snappers overhead while two beetles cross underneath.
    ...wave(6.25, 'snapper', 0, [
      { x: [0, 0], y: [0.98, 0.72], phase: 0 },
      { x: [-0.3, -0.55], y: [0.86, 0.6], phase: 0.25 }, { x: [0.3, 0.55], y: [0.86, 0.6], phase: 0.25 },
      { x: [-0.6, -0.9], y: [0.74, 0.5], phase: 0.5 }, { x: [0.6, 0.9], y: [0.74, 0.5], phase: 0.5 },
    ], 0.125),
    ...wave(6.75, 'beetle', 0, [{ x: [-0.5, 0.55] }, { x: [0.5, -0.55] }], 0.5),
    // Payoff: a crescent of six beetles marching in step — one full volley.
    ...wave(7.5, 'beetle', 0, [
      { x: [-0.88, -0.7], a0: 0.35 }, { x: [-0.6, -0.48], a0: 0.62 }, { x: [-0.3, -0.25], a0: 0.8 },
      { x: [0.3, 0.25], a0: 0.8 }, { x: [0.6, 0.48], a0: 0.62 }, { x: [0.88, 0.7], a0: 0.35 },
    ].map((member) => ({ ...member, hop: true, window: 5.2 })), 0),

    // ── TENNIS (bars 9–18): spools, erasers, paint pots, wooden blocks.
    // Pencil striders walk a picket line straight at the ball.
    ...wave(9.25, 'strider', 1, [
      { x: [-0.8, -0.55], y: 0.5 }, { x: [-0.3, -0.22], y: 0.6 }, { x: [0.3, 0.22], y: 0.6 }, { x: [0.8, 0.55], y: 0.5 },
    ], 0.5),
    // Spool beetles bounce in from both sides; cardboard snappers cut across the top.
    ...wave(10.5, 'beetle', 1, [
      { x: [-0.95, -0.42], hop: true }, { x: [0.95, 0.42], hop: true }, { x: [-0.7, -0.32] }, { x: [0.7, 0.32] },
    ], 0.5),
    ...wave(11, 'snapper', 1, [
      { x: [1.0, -0.8], y: [0.8, 0.6] }, { x: [1.1, -0.5], y: [0.62, 0.45] },
    ], 1),
    // The carousel: six snappers wheel right across the sky.
    ...wave(12, 'snapper', 1, [
      { x: [-1.0, 0.8], y: [0.45, 0.72] }, { x: [-1.1, 0.65], y: [0.8, 0.52] }, { x: [-0.9, 1.0], y: [0.62, 0.86] },
      { x: [-1.2, 0.45], y: [0.95, 0.42] }, { x: [-0.95, 0.9], y: [0.36, 0.6] }, { x: [-1.05, 0.75], y: [0.72, 0.95] },
    ].map((member, index) => ({ ...member, phase: index * 0.2 })), 0.25),
    // Pincer: beetles from the left floor, striders from the right.
    ...wave(13.25, 'beetle', 1, [
      { x: [-0.95, -0.42] }, { x: [-0.7, -0.3], hop: true }, { x: [-0.5, -0.8] },
    ], 0.5),
    ...wave(13.5, 'strider', 1, [
      { x: [1.0, 0.55], y: 0.62 }, { x: [0.8, 0.36], y: 0.5 }, { x: [0.6, 0.3], y: 0.72 },
    ], 0.5),
    // Tennis drive: two heavy striders hauling double loads, snappers crossing in an X.
    ...wave(14.5, 'strider', 1, [
      { x: [-0.95, -0.36], y: 0.6, hitPoints: 2 }, { x: [0.95, 0.36], y: 0.6, hitPoints: 2 },
    ], 1),
    ...wave(15, 'snapper', 1, [
      { x: [-0.62, 0.6], y: [0.9, 0.55] }, { x: [0.62, -0.6], y: [0.9, 0.55] },
      { x: [-0.88, 0.2], y: [0.6, 0.86] }, { x: [0.88, -0.2], y: [0.6, 0.86] },
    ], 0.25),
    // Two rows of three spool beetles, bouncing on every beat.
    ...wave(16, 'beetle', 1, [
      { x: [-0.72, -0.8], a0: 0.4, phase: 0 }, { x: [0, 0], a0: 0.4, phase: 0 }, { x: [0.72, 0.8], a0: 0.4, phase: 0 },
      { x: [-0.4, -0.5], a0: 0.85, phase: 0.5 }, { x: [0.4, 0.5], a0: 0.85, phase: 0.5 }, { x: [0.95, 0.85], a0: 0.85, phase: 0.5 },
    ].map((member) => ({ ...member, hop: true })), 0),
    // Last call before the size-up: the whole width at once.
    ...wave(17.25, 'snapper', 1, mirror([{ x: [1.0, 0.32], y: [0.9, 0.7] }, { x: [-1.0, -0.32], y: [0.9, 0.7] }]), 0.5),
    ...wave(17.5, 'strider', 1, [{ x: [-0.62, 0.1], y: 0.52 }, { x: [0.62, -0.1], y: 0.56 }], 0.5),
    ...wave(17.75, 'beetle', 1, [{ x: [0.5, -0.5], hop: true }], 0),

    // ── MELON (bars 19–21): long rulers, jars, cardboard structures.
    ...wave(19.25, 'strider', 2, [
      { x: [-0.95, -0.42], y: 0.62 }, { x: [0.05, 0.18], y: 0.76, hitPoints: 2 }, { x: [0.95, 0.42], y: 0.62 },
    ], 0.5),
    ...wave(19.75, 'snapper', 2, [
      { x: [1.05, -0.5], y: [0.85, 0.6] }, { x: [1.15, -0.1], y: [0.7, 0.5] }, { x: [1.25, 0.3], y: [0.95, 0.8] },
    ], 0.5),
    ...wave(20.5, 'beetle', 2, [
      { x: [-0.85, -0.45], hop: true }, { x: [-0.4, -0.62] }, { x: [0.4, 0.62] }, { x: [0.85, 0.45], hop: true },
    ], 0.25),

    // ── THE SPILL (bars 22–29) — see spill.ts for the cores and heart.
    ...spillEntries,
    // Minions ride along with the orbit and keep the sweep busy.
    ...wave(23, 'snapper', 2, [
      { x: [-1.0, 0.6], y: [0.85, 0.6] }, { x: [-1.1, 0.2], y: [0.95, 0.75] },
      { x: [-1.2, 0.9], y: [0.7, 0.5] }, { x: [-1.15, -0.2], y: [1.0, 0.85] },
    ], 0.5),
    ...wave(24.5, 'beetle', 2, [
      { x: [-0.8, -0.38], hop: true }, { x: [0.8, 0.38], hop: true }, { x: [0.5, 0.75] },
    ], 0.5),
    ...wave(26, 'snapper', 2, mirror([
      { x: [-1.0, 0.6], y: [0.8, 0.55] }, { x: [-1.1, 0.25], y: [0.95, 0.72] },
      { x: [-1.2, 0.85], y: [0.62, 0.45] }, { x: [-1.15, -0.15], y: [1.0, 0.86] },
    ]), 0.5),
    ...wave(27.5, 'strider', 2, [{ x: [-1.0, -0.58], y: 0.7 }, { x: [1.0, 0.58], y: 0.7 }], 1),
  ];
}

const _tmp = new Vector3();
const COS_ELEVATION = Math.cos(MathUtils.degToRad(CAMERA_ELEVATION_DEG));
const SIN_ELEVATION = Math.sin(MathUtils.degToRad(CAMERA_ELEVATION_DEG));
const LOOK_DOWN = MathUtils.degToRad(CAMERA_ELEVATION_DEG - BALL_DROP_DEG);
const TAN_HALF_FOV = Math.tan(MathUtils.degToRad(31));
// Half the screen width at unit depth, for a 16:9 frame.
const SCREEN_HALF_WIDTH = TAN_HALF_FOV * (16 / 9);

/** Height (in chase distances) that puts a flier on screen row `yn` at route depth `a`. */
function screenRowHeight(yn: number, a: number, tier: Tier) {
  const depth = Math.max(0.3, a + COS_ELEVATION);
  const cameraHeight = SIN_ELEVATION + TIER_RADIUS[tier] / TIER_VIEW[tier];
  return cameraHeight + depth * Math.tan(Math.atan(TAN_HALF_FOV * yn) - LOOK_DOWN);
}
const _right = new Vector3();
const _yawQuat = new Quaternion();
const _up = new Vector3(0, 1, 0);

type WaveState = {
  last: Vector3;
  heading: number;
  bank: number;
  initialized: boolean;
};

export type TinkerGameplay = LockOnRunnerLevel<TinkerEnemyKind, TinkerSpawnData> & {
  director: BallDirector;
  /** Visuals report pieces as they stick, for the run summary. */
  notePieces(count: number): void;
};

export function createTinkerBallHh5uGameplay(bus: EventBus): TinkerGameplay {
  const route = createRoute();
  const director = createBallDirector(route);
  const globInterceptions = new Set<number>();
  let hitsTaken = 0;
  let volleysCleared = 0;
  let piecesRescued = 0;

  function fireGlob(context: TinkerUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(9);
    initial.y += 7;
    context.spawnEnemy({
      time: context.runTime,
      kind: 'glue-glob',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0 },
    });
  }

  const spill = createSpill(bus, director, fireGlob);
  const timeline = sortTimeline(createTimeline(spill.entries()));

  bus.on('runstart', () => {
    director.reset();
    spill.reset();
    globInterceptions.clear();
    hitsTaken = 0;
    volleysCleared = 0;
    piecesRescued = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => globInterceptions.add(enemyId));
  bus.on('kill', ({ enemyId }) => globInterceptions.delete(enemyId));
  bus.on('miss', ({ enemyId }) => globInterceptions.delete(enemyId));
  bus.on('volley', ({ size, kills }) => {
    if (size >= 4 && kills === size) volleysCleared += 1;
  });

  // Every body that breaks leaves its pieces on the route ahead. The field is
  // decided here, where the route lives; visuals throw the pieces into it.
  const bodyKinds = new Set<string>();
  bus.on('spawn', ({ enemyId, kind }) => {
    const info = KIND_INFO[kind as TinkerEnemyKind];
    if (info && info.family !== 'glob') bodyKinds.add(String(enemyId));
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    if (!bodyKinds.delete(String(enemyId))) return;
    director.addField(enemyId, worldPosition);
  });
  bus.on('stage', ({ enemyId, worldPosition }) => {
    director.addField(enemyId, worldPosition, { minAhead: 0.7, maxAhead: 1.5, scatter: (Math.random() - 0.5) * 0.2 });
  });

  function updateWave(context: TinkerUpdate, data: WaveData) {
    const { enemy, age, runTime } = context;
    const view = TIER_VIEW[data.tier];
    const scale = TIER_SCALE[data.tier];
    const p = Math.min(1, age / data.window);
    const shaped = p + 0.13 * Math.sin(Math.PI * 2 * p);
    let a = MathUtils.lerp(data.a0, data.aEnd, shaped);
    let xn = MathUtils.lerp(data.x0, data.x1, smooth(p));
    const beat = runTime / BEAT_SECONDS + data.phase;
    const beatIndex = Math.floor(beat);
    const beatFrac = beat - beatIndex;
    const exit = smooth((p - 0.78) / 0.22);
    const state = context.enemyState<WaveState>(() => ({ last: new Vector3(), heading: 0, bank: 0, initialized: false }));
    let y = 0;

    if (data.family === 'beetle') {
      // Stop-and-go scuttle: a dash in the first part of every beat toward a
      // fresh waypoint, then a freeze. Hoppers leap on each bar's downbeat.
      const wp = (k: number) => Math.sin(k * 1.91 + data.seed * 5.1) * 0.09;
      const wa = (k: number) => Math.cos(k * 1.33 + data.seed * 3.7) * 0.08;
      const dash = easeOutCubic(Math.min(1, beatFrac / 0.42));
      xn += MathUtils.lerp(wp(beatIndex - 1), wp(beatIndex), dash);
      a += MathUtils.lerp(wa(beatIndex - 1), wa(beatIndex), dash);
      y = CORE_HEIGHT.beetle * scale;
      if (data.hop && beatIndex % 4 === 0) y += Math.sin(Math.PI * Math.min(1, beatFrac / 0.55)) * 1.1 * scale;
      enemy.mesh.userData.dash = 1 - Math.min(1, beatFrac / 0.42);
    } else if (data.family === 'strider') {
      // One stride per beat; the body dips as each foot plants. Striders
      // leave by walking off the side.
      xn += Math.sign(data.x1 || data.x0) * exit * 0.7;
      y = data.y0 * view + Math.abs(Math.sin(Math.PI * beatFrac)) * 0.03 * view;
      enemy.mesh.userData.gait = beat;
    } else {
      // Snappers wheel on a lazy sine, dip on every downbeat, and climb away
      // out of the top of the frame at the end of their window.
      xn += Math.sin(Math.PI * 2 * (p * 1.1) + data.seed) * 0.07;
      const barFrac = (runTime / BAR_SECONDS + data.phase * 0.25) % 1;
      const dip = barFrac < 0.35 ? Math.sin((Math.PI * barFrac) / 0.35) * 0.08 : 0;
      const yn = MathUtils.lerp(data.y0, data.y1, smooth(p)) + Math.sin(runTime * 2.3 + data.seed) * 0.04 - dip + exit * 0.75;
      y = screenRowHeight(yn, a, data.tier) * view;
      y = Math.max(y, 0.18 * view);
      enemy.mesh.userData.flap = beat;
    }

    // Screen column → lateral offset at this depth.
    const depth = Math.max(0.3, a + COS_ELEVATION);
    const lateral = xn * SCREEN_HALF_WIDTH * depth * view;
    const position = enemy.mesh.position;
    if (data.frame === 'view') {
      // During the spill orbit, ride along in the camera's frame.
      _right.copy(director.focus).cross(_up).normalize();
      position.copy(director.position).setY(0)
        .addScaledVector(director.focus, a * view)
        .addScaledVector(_right, lateral);
    } else {
      const frame = director.frameAt(director.distance + a * view);
      position.copy(frame.position).addScaledVector(frame.right, lateral);
    }
    position.y = y;

    // Face the direction of travel (in world), with a bank for fliers.
    if (state.initialized) {
      _tmp.copy(position).sub(state.last);
      _tmp.y = 0;
      if (_tmp.lengthSq() > 1e-6) {
        const target = Math.atan2(_tmp.x, _tmp.z);
        const delta = wrapAngle(target - state.heading);
        state.heading += delta * 0.18;
        if (data.family === 'snapper') state.bank = MathUtils.lerp(state.bank, MathUtils.clamp(-delta * 3, -0.6, 0.6), 0.1);
      }
    } else {
      state.heading = Math.atan2(-director.focus.x, -director.focus.z);
    }
    state.last.copy(position);
    state.initialized = true;
    enemy.mesh.quaternion.setFromAxisAngle(_up, state.heading);
    if (data.family === 'snapper') enemy.mesh.rotateZ(state.bank);
    enemy.mesh.userData.progress = p;
    return p >= 1;
  }

  function updateGlob(context: TinkerUpdate, data: GlobData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: globInterceptions.delete(enemy.id),
      config: { hitDistance: 3.2, impactBrake: 0.3, damageDistance: 0.9 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.userData.impact = true;
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    // Lobbed high, then it drops onto the lens like wet glue.
    data.velocity.y -= 9 * dt;
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 10,
      maxSpeed: 30,
      accel: 9,
      turnRate: 1.6 + age * 1.8,
    });
    enemy.mesh.position.copy(data.position);
    _right.copy(data.velocity);
    if (_right.lengthSq() > 1e-4) {
      _yawQuat.setFromUnitVectors(_up, _right.normalize());
      enemy.mesh.quaternion.copy(_yawQuat);
    }
    return shotBehindCamera(camera, data.position) || age > 9;
  }

  const runnerPosition = new Vector3();
  const runnerLook = new Vector3();

  return {
    director,
    duration: TINKER_RUN_DURATION,
    bpm: TINKER_BPM,
    playerHealth: TINKER_PLAYER_HEALTH,
    createRail: () => route.curve,
    spawnTimeline: timeline,
    easeRunProgress: (time) => route.runProgress(time),
    updateAttractCamera({ camera, modeTime, dt }) {
      director.step(0, dt, true);
      director.placeCamera(camera);
      // A slow breathing sway while the ball waits for START.
      camera.position.x += Math.sin(modeTime * 0.4) * 0.35;
      camera.position.y += Math.sin(modeTime * 0.55) * 0.18;
      camera.rotateY(Math.sin(modeTime * 0.3) * 0.02);
    },
    updateCameraEffects({ camera, curve, runTime, runProgress, dt }) {
      director.step(runTime, dt);
      runnerPosition.copy(curve.getPointAt(runProgress));
      runnerLook.copy(curve.getPointAt(Math.min(1, runProgress + 0.025)));
      director.placeCamera(camera, {
        runnerPosition,
        runnerLook,
        edgeWeight: MathUtils.clamp((runTime - 1.05) / 0.5, 0, 1),
      });
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'bolt':
          return updateGlob(context, data);
        case 'core':
        case 'heart':
          return spill.update(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KIND_INFO[enemy.kind].score * multiplier);
    },
    // Cracking a shell layer off a spill core pays a little on its own.
    scoreForHit: () => 60,
    // A clean sweep — four or more locks, every one a kill — earns a bonus.
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      if (results.length < 4 || kills < results.length) return 0;
      return kills * 60 + (kills === 6 ? 300 : 0);
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 19000 && clear >= 0.9) return 'S';
      if (score >= 14000 && clear >= 0.75) return 'A';
      if (score >= 9000 && clear >= 0.55) return 'B';
      if (score >= 4500 && clear >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const diameter = (director.radius * 2).toFixed(1);
      const lines = [`Ball ${diameter} cm across`];
      if (piecesRescued > 0) lines.push(`${piecesRescued} pieces rescued`);
      lines.push(spill.summary());
      if (volleysCleared > 0) lines.push(`${volleysCleared} clean sweep${volleysCleared === 1 ? '' : 's'}`);
      lines.push(`Stickiness ${Math.max(0, TINKER_PLAYER_HEALTH - hitsTaken)}/${TINKER_PLAYER_HEALTH}`);
      return lines;
    },
    notePieces(count: number) {
      piecesRescued += count;
    },
  };
}

function smooth(t: number) {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export const FIRST_ENEMY_BAR = TINKER_BARS.marble;
