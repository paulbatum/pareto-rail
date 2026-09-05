import { CatmullRomCurve3, MathUtils, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { shotBehindCamera, updateHostileShotImpact, type HostileShotImpactState } from '../../engine/hostile-shot';
import type { LockOnEnemy, LockOnEnemyUpdate, LockOnRunnerLevel } from '../../engine/lock-on-runner';
import { attachRailFrame, railCameraPose, sampleRailFrame, type RailCameraPose, type RailFrameConfig } from '../../engine/rail';
import type { EventBus } from '../../events';
import { ESCAPEMENT_AUDIO_KINDS } from './audio';
import {
  BOSS_DEADLINE,
  type BossEvent,
  type BossPart,
  type BossSnapshot,
  createEscapementBoss,
  pendulumPhase,
  type EscapementBoss,
} from './boss-logic';
import {
  createArborEntry,
  createEscapementTimeline,
  createRubyBolt,
  createTickPour,
  ESCAPEMENT_KILL_SCORE,
  type EscapementEnemyKind,
  type EscapementPlacement,
  type EscapementSpawnData,
  type EscapementSpawnEntry,
  leadSeconds,
  screenSeconds,
} from './choreography';
import { ESCAPEMENT_BAR, ESCAPEMENT_BARS, ESCAPEMENT_BPM, ESCAPEMENT_DURATION, ESCAPEMENT_MARKERS, ESCAPEMENT_TIME, bar } from './timing';
import { barrelCorridor } from './visuals/environment/barrel';
import { BARREL_LAYOUT, BELL_LAYOUT, BOB_REST, DIAL_LAYOUT, PENDULUM_LAYOUT, RAIL_X, TRAIN_LAYOUT } from './visuals/environment/index';
import { PENDULUM_RIDE_OFFSET } from './visuals/environment/pendulum';
import { dialGateway } from './visuals/environment/dial';
import { rimPoint } from './visuals/environment/train';

// The Escapement run: 60 bars at 120 BPM. The rail leaves the mainspring
// barrel, rides three great wheels, swings out around the orrery sun, passes
// the bell as it strikes, joins the pendulum bob's swinging frame and climbs
// toward the escapement, holds under it for the boss, and is released under
// the plate and out through the dial's XII.
//
// Enemies are placed in the camera's view frame: the pose the runner gives the
// camera from the rail and its look targets, before the pointer's edge-look.
// A target sits a fixed distance ahead that closes over the entry's lead, so
// every kind reads at the same scale whether the rail is fast (Barrel,
// Orrery) or nearly still (the boss hold), and it stays in frame wherever the
// look targets turn the camera. The choreography in choreography.ts supplies
// the offsets, leads and per-kind motion parameters; this file turns them into
// positions.

export { ESCAPEMENT_BPM, ESCAPEMENT_DURATION };
export const ESCAPEMENT_PLAYER_HEALTH = 4;

export type EscapementUpdate = LockOnEnemyUpdate<EscapementEnemyKind, EscapementSpawnData>;

const BEAT = ESCAPEMENT_TIME.beatSeconds;
const BAR = ESCAPEMENT_BAR;
const DEG = Math.PI / 180;

// The score reacts to spawns by kind name; these are the names the choreography uses.
ESCAPEMENT_AUDIO_KINDS.chime = ['chime'];
ESCAPEMENT_AUDIO_KINDS.waspBolt = ['bolt'];
ESCAPEMENT_AUDIO_KINDS.boss = ['jewel', 'arbor'];

// ---- rail ------------------------------------------------------------------

type LegName = 'barrel' | 'train-a' | 'train-b' | 'train-c' | 'orrery' | 'strike' | 'climb' | 'hold' | 'free-run';

type RailLeg = {
  name: LegName;
  /** Control points after the previous leg's last point. */
  points: Vector3[];
  /** Run time at which the camera reaches the leg's last point. */
  endTime: number;
  /** Cumulative distance fraction at fraction `t` of the leg's duration. Identity when omitted. */
  shape?: (t: number) => number;
};

/** Where on the barrel corridor the run starts, as a fraction of the corridor arc. */
const BARREL_START = 0.35;
/** Where the rail joins the bob frame at bar 29: the environment's ride offset from the bob at rest. */
export const PENDULUM_START = BOB_REST.clone().add(PENDULUM_RIDE_OFFSET);
/**
 * Camera station for the boss, in the bob's rest frame: level with the escape
 * wheel's centre and 95 units in front of the fork pivot. Aimed at the pivot,
 * the frame holds the arbor at the reticle, the jewels just below it at 12
 * degrees to either side, the escape wheel in the bottom half with its top
 * teeth 4 degrees under the reticle, and the crown wheel in the top third.
 */
export const BOSS_STATION = PENDULUM_LAYOUT.mount.clone().add(new Vector3(0, -33, 95));
/** World point the camera aims at during the boss: the fork pivot. */
export const BOSS_AIM = PENDULUM_LAYOUT.mount.clone();
/** Aim drop below the fork pivot at the pendulum start: the escapement sits in the top third from the ride offset. */
const PENDULUM_AIM_DROP = 90;
/** Camera pitch above the rail tangent while riding the Train, so the wheel face stays below the frame. */
const TRAIN_PITCH = 15 * DEG;
/** Rail parameter the runner looks ahead to aim the camera (its RUN_LOOK_AHEAD_U). */
const LOOK_AHEAD_U = 0.025;

function corridorPoints() {
  const points: Vector3[] = [];
  const samples = 7;
  for (let i = 0; i <= samples; i += 1) {
    const t = BARREL_START + (1 - BARREL_START) * (i / samples);
    points.push(barrelCorridor(BARREL_LAYOUT, t).position);
  }
  return points;
}

function rimArc(wheelIndex: number, includeEntry: boolean) {
  const wheel = TRAIN_LAYOUT.wheels[wheelIndex];
  const arc = wheel.exitAngle - wheel.entryAngle;
  const steps = Math.max(4, Math.round(Math.abs(arc) / (8 * DEG)));
  const points: Vector3[] = [];
  for (let i = includeEntry ? 0 : 1; i <= steps; i += 1) {
    points.push(rimPoint(wheel, wheel.entryAngle + (arc * i) / steps, 0));
  }
  return points;
}

const strikeShape = (t: number) => (t < 1 / 3 ? 2 * t : 2 / 3 + 0.5 * (t - 1 / 3));
const climbShape = (t: number) => 2 * t - t * t;
const launchShape = (t: number) => t ** 1.4;

function buildLegs(): RailLeg[] {
  const trainEntry = TRAIN_LAYOUT.wheels[0].entry.clone().setY(0);
  const gateway = dialGateway(DIAL_LAYOUT);
  const doorway = new Vector3(RAIL_X, 0, TRAIN_LAYOUT.backPlate.z);
  return [
    {
      name: 'barrel',
      points: [...corridorPoints(), new Vector3(RAIL_X, 0, -70), new Vector3(RAIL_X, 0, -140), new Vector3(RAIL_X, 0, -200), trainEntry],
      endTime: bar(ESCAPEMENT_BARS.train),
    },
    { name: 'train-a', points: rimArc(0, false), endTime: bar(10) },
    { name: 'train-b', points: rimArc(1, false), endTime: bar(14) },
    { name: 'train-c', points: rimArc(2, false), endTime: bar(ESCAPEMENT_BARS.orrery) },
    {
      // Straight through the back plate doorway, then a swing out to the right
      // of the sun, 100 units clear of its cage, and back to the rail line.
      name: 'orrery',
      points: [
        new Vector3(RAIL_X, 0, -640),
        doorway,
        new Vector3(170, 5, -775),
        new Vector3(240, 20, -850),
        new Vector3(315, 36, -925),
        new Vector3(352, 42, -1000),
        new Vector3(350, 38, -1075),
        new Vector3(285, 22, -1130),
        new Vector3(190, 8, -1160),
        new Vector3(RAIL_X, 0, -1175),
      ],
      endTime: bar(ESCAPEMENT_BARS.strike),
    },
    {
      // Bows right of the bell frame's hammer-side leg at x 80, then climbs to the ride offset.
      name: 'strike',
      points: [new Vector3(RAIL_X + 30, 28, -1220), new Vector3(RAIL_X + 22, 66, -1262), PENDULUM_START.clone()],
      endTime: bar(ESCAPEMENT_BARS.pendulum),
    },
    {
      // In the bob frame: a slow climb from the ride offset to the boss station.
      name: 'climb',
      points: [
        PENDULUM_START.clone().lerp(BOSS_STATION, 0.3),
        PENDULUM_START.clone().lerp(BOSS_STATION, 0.65),
        BOSS_STATION.clone(),
      ],
      endTime: bar(ESCAPEMENT_BARS.boss),
      shape: climbShape,
    },
    {
      name: 'hold',
      points: [BOSS_STATION.clone().add(new Vector3(0, 1, -10)), BOSS_STATION.clone().add(new Vector3(0, 2, -20))],
      endTime: bar(ESCAPEMENT_BARS.freeRun),
    },
    {
      // Released at the bottom of the swing: right of the bob, under the plate
      // (its lower edge is at y 40), then a climb to the XII gateway.
      name: 'free-run',
      points: [
        new Vector3(185, 175, -1375),
        new Vector3(235, 90, -1425),
        new Vector3(220, 10, -1488),
        new Vector3(165, 60, -1590),
        new Vector3(150, 140, -1690),
        gateway,
        gateway.clone().add(new Vector3(0, 20, -150)),
      ],
      endTime: bar(ESCAPEMENT_BARS.end),
      shape: launchShape,
    },
  ];
}

export type RailLegTable = Array<{ name: LegName; startTime: number; endTime: number; startU: number; endU: number; shape: (t: number) => number }>;

function buildRailTable(legs: RailLeg[]) {
  const points: Vector3[] = [];
  const legEndIndex: number[] = [];
  for (const leg of legs) {
    points.push(...leg.points);
    legEndIndex.push(points.length - 1);
  }
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const divisions = 8192;
  const lengths = curve.getLengths(divisions);
  const total = lengths[divisions];
  const uAtIndex = (index: number) => {
    const t = index / (points.length - 1);
    const scaled = t * divisions;
    const low = Math.min(divisions - 1, Math.floor(scaled));
    const fraction = scaled - low;
    return (lengths[low] + (lengths[low + 1] - lengths[low]) * fraction) / total;
  };
  const table: RailLegTable = [];
  let startTime = 0;
  let startU = 0;
  legs.forEach((leg, i) => {
    const endU = uAtIndex(legEndIndex[i]);
    table.push({ name: leg.name, startTime, endTime: leg.endTime, startU, endU, shape: leg.shape ?? ((t) => t) });
    startTime = leg.endTime;
    startU = endU;
  });
  table[table.length - 1].endU = 1;
  return { points, table, length: total };
}

const RAIL = buildRailTable(buildLegs());
export const RAIL_LEGS: RailLegTable = RAIL.table;
export const RAIL_LENGTH = RAIL.length;

function legAt(time: number) {
  for (const leg of RAIL_LEGS) if (time < leg.endTime) return leg;
  return RAIL_LEGS[RAIL_LEGS.length - 1];
}

function legNamed(name: LegName) {
  const leg = RAIL_LEGS.find((entry) => entry.name === name);
  if (!leg) throw new Error(`No rail leg named ${name}`);
  return leg;
}

/** Rail parameter the camera occupies at run time `time`. */
export function escapementRunProgress(time: number, duration = ESCAPEMENT_DURATION) {
  const clamped = MathUtils.clamp(time, 0, duration);
  const leg = legAt(clamped);
  const t = MathUtils.clamp((clamped - leg.startTime) / (leg.endTime - leg.startTime), 0, 1);
  return leg.startU + (leg.endU - leg.startU) * leg.shape(t);
}

/** Roll keys for the Barrel spiral: bank into the left turn and level out along the straight run to the drum. */
function barrelRollKeys(): RailFrameConfig['roll'] {
  const barrel = legNamed('barrel');
  const span = barrel.endU - barrel.startU;
  return [
    [barrel.startU, -6],
    [barrel.startU + span * 0.18, -30],
    [barrel.startU + span * 0.42, -30],
    [barrel.startU + span * 0.6, 0],
  ];
}

/** The bob frame: a rotation about the pendulum pivot, about +z, by the swing angle. */
export function bobFrameMatrix(angleRadians: number, out = new Matrix4()) {
  const pivot = PENDULUM_LAYOUT.pivot;
  return out
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new Matrix4().makeRotationZ(angleRadians))
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/**
 * Swing angle in degrees, positive toward the camera's left, at `time` and
 * `amplitude`. The world rotation about +z is the negative of this angle.
 */
export function swingDegrees(time: number, amplitude: number) {
  return pendulumPhase(time) * amplitude;
}

export type PendulumClock = {
  /** Swing angle in degrees at run time `time`, positive toward the camera's left. */
  degreesAt(time: number): number;
};

const FIXED_PENDULUM: PendulumClock = { degreesAt: (time) => swingDegrees(time, 20) };

/**
 * World point the camera aims at while it approaches and holds under the
 * escapement: below the fork pivot at the pendulum start, rising to the pivot
 * itself by the boss, so the escapement drops from the top third to the centre.
 */
function escapementAim(time: number, out = new Vector3()) {
  const k = MathUtils.smoothstep(time, bar(ESCAPEMENT_BARS.pendulum), bar(ESCAPEMENT_BARS.boss));
  return out.copy(BOSS_AIM).add(new Vector3(0, -PENDULUM_AIM_DROP * (1 - k), 0));
}

/**
 * The level rail with its authored frame: parallel transport, the Barrel
 * roll, a pitch-up look through the Train, a glance at the bell for the
 * strike, the bob-frame section from bar 29 to the release, the escapement
 * aim through the climb and the hold, and the gateway aim for the Free Run.
 */
export function createEscapementRail(pendulum: PendulumClock = FIXED_PENDULUM) {
  const train = { start: legNamed('train-a').startU, end: legNamed('train-c').endU };
  const climb = legNamed('climb');
  const hold = legNamed('hold');
  // The hold is 20 units long and nearly still, so its ranges end a few units
  // into the Free Run with blends shorter than the hold: the release is where
  // the escapement aim and the bob frame let go, over the first third of a second.
  const release = hold.endU + 0.002;
  const curve = new CatmullRomCurve3(RAIL.points.map((point) => point.clone()), false, 'catmullrom', 0.5);
  const parent = new Matrix4();
  const bell = BELL_LAYOUT.mouth.clone().add(new Vector3(0, BELL_LAYOUT.height * 0.45, 0));
  const gateGlow = dialGateway(DIAL_LAYOUT).add(new Vector3(0, 0, -140));
  const aheadOf = (time: number, span: number) => {
    const u = escapementRunProgress(time);
    return sampleRailFrame(curve, Math.min(1, u + span), time).position;
  };
  const config: RailFrameConfig = {
    frame: 'parallel-transport',
    roll: barrelRollKeys(),
    lookTargets: [
      {
        range: [train.start, train.end],
        blend: 0.004,
        target: (time) => {
          const u = escapementRunProgress(time);
          const here = sampleRailFrame(curve, u, time);
          const ahead = sampleRailFrame(curve, Math.min(1, u + 0.02), time);
          const distance = ahead.position.distanceTo(here.position);
          return ahead.position.addScaledVector(here.up, distance * Math.tan(TRAIN_PITCH));
        },
      },
      {
        // The bell drifts to the left of centre as the hammer falls.
        range: [escapementRunProgress(bar(25)), escapementRunProgress(bar(27, 1))],
        blend: 0.004,
        target: (time) => aheadOf(time, 0.03).lerp(bell, 0.6),
      },
      {
        range: [escapementRunProgress(bar(27)), release + 0.004],
        blend: 0.006,
        target: (time) => escapementAim(time),
      },
      {
        // The dive keeps mostly to the rail; the climb locks onto the lit gateway.
        range: [release, 1],
        blend: 0.01,
        target: (time) => {
          const k = MathUtils.lerp(0.35, 1, MathUtils.smoothstep(time, bar(ESCAPEMENT_BARS.freeRun), bar(ESCAPEMENT_BARS.freeRun + 2.5)));
          return aheadOf(time, 0.03).lerp(gateGlow, k);
        },
      },
    ],
    sections: [
      {
        range: [climb.startU, release],
        blend: 0.002,
        parent: (time) => bobFrameMatrix(-pendulum.degreesAt(time) * DEG, parent),
      },
    ],
  };
  return attachRailFrame(curve, config);
}

/**
 * Fraction of the bob's roll the camera keeps. The bob frame rolls the camera
 * by the full swing; the level takes the rest back in updateCameraEffects.
 */
export const CAMERA_SWING_ROLL = 0.6;

/** Roll in radians the level adds to the camera at `time` to leave it CAMERA_SWING_ROLL of the swing. */
export function cameraRollCorrection(time: number, swingDegrees: number) {
  if (time < ESCAPEMENT_MARKERS.pendulum || time >= bar(ESCAPEMENT_BARS.freeRun)) return 0;
  return (1 - CAMERA_SWING_ROLL) * swingDegrees * DEG;
}

// ---- placement --------------------------------------------------------------

/** Offsets from the choreography are scaled up so a seated target spreads across the frame. */
const OFFSET_SCALE = 1.6;
/** Distance ahead of the camera where a seated target sits once it has arrived. */
const NEAR = 17;
/**
 * How much of a target's seat offset grows with its distance beyond NEAR. At
 * 0 a far target sits near the centre and slides outward as it closes; at 1
 * it holds its seat's screen angle all the way in. 0.6 shows a target at
 * about 70 percent of its seat angle when it appears.
 */
const APPROACH_SPREAD = 0.6;
const PASS_SECONDS = 0.45;
const PASS_BEHIND = -8;
/** Seconds a ruby bolt takes from the wasp to the hull. */
const BOLT_FLIGHT_SECONDS = 1.8;
/** The bolt brakes here and lands at BOLT_DAMAGE_DISTANCE; its white-hot spark would fill the frame any closer. */
const BOLT_HIT_DISTANCE = 4.2;
const BOLT_DAMAGE_DISTANCE = 1.6;
const scratchForward = new Vector3();
const scratchUp = new Vector3();
const scratchNose = new Vector3();

type Frame = ReturnType<typeof sampleRailFrame>;

const viewPose: RailCameraPose = { position: new Vector3(), quaternion: new Quaternion() };
const viewRoll = new Quaternion();
const viewFrame: Frame = { position: new Vector3(), tangent: new Vector3(), right: new Vector3(), up: new Vector3() };
let viewFrameTime = NaN;

/**
 * The camera's view frame at the update's run time: the rail pose with its
 * look targets, rolled the way the level rolls the camera during the
 * pendulum. Every enemy update in one frame shares the same run time, so the
 * frame is computed once per run time.
 */
function frameAt(context: EscapementUpdate, swingDegrees: number): Frame {
  if (context.runTime === viewFrameTime) return viewFrame;
  viewFrameTime = context.runTime;
  railCameraPose(context.curve, context.runProgress, LOOK_AHEAD_U, viewPose, context.runTime);
  const pose = viewPose.quaternion;
  viewFrame.position.copy(viewPose.position);
  viewFrame.tangent.set(0, 0, -1).applyQuaternion(pose);
  viewFrame.right.set(1, 0, 0).applyQuaternion(pose);
  viewFrame.up.set(0, 1, 0).applyQuaternion(pose);
  const correction = cameraRollCorrection(context.runTime, swingDegrees);
  if (correction !== 0) {
    // The camera rolls about its own z, which points back along the tangent.
    viewRoll.setFromAxisAngle(viewFrame.tangent, -correction);
    viewFrame.right.applyQuaternion(viewRoll);
    viewFrame.up.applyQuaternion(viewRoll);
  }
  return viewFrame;
}

/**
 * World point `ahead` units in front of the camera, `lateral` to its right and
 * `vertical` up, with the offsets widened by APPROACH_SPREAD beyond NEAR.
 */
function placeAhead(frame: Frame, lateral: number, vertical: number, ahead: number, out = new Vector3()) {
  const spread = ahead > NEAR ? MathUtils.lerp(1, ahead / NEAR, APPROACH_SPREAD) : 1;
  return out
    .copy(frame.position)
    .addScaledVector(frame.right, lateral * spread)
    .addScaledVector(frame.up, vertical * spread)
    .addScaledVector(frame.tangent, ahead);
}

/** Seat offsets from a placement, scaled for the hold distance. */
function seatOf(placement: EscapementPlacement) {
  return { lateral: placement.lateral * OFFSET_SCALE, vertical: placement.vertical * OFFSET_SCALE };
}

/** Distance ahead for a seated target: closes from `far` to NEAR over its lead, then sweeps past the camera. */
function approach(age: number, lead: number, far: number) {
  if (age <= lead) {
    const t = MathUtils.clamp(age / Math.max(0.001, lead), 0, 1);
    return MathUtils.lerp(far, NEAR, t * t * (3 - 2 * t));
  }
  const t = MathUtils.clamp((age - lead) / PASS_SECONDS, 0, 1);
  return MathUtils.lerp(NEAR, PASS_BEHIND, t * t);
}

function faceCamera(mesh: Object3D, frame: Frame, camera: EscapementUpdate['camera']) {
  mesh.up.copy(frame.up);
  mesh.lookAt(camera.position);
}

// ---- rig hooks --------------------------------------------------------------
// Gameplay drives per-frame rig state through optional methods the visuals put
// on the mesh. The simulator's plain Object3D has none, so every call is guarded.

type GaitMesh = Object3D & { setGait?(gait: 'walk' | 'raised' | 'leap'): void };
type ChargeMesh = Object3D & { setCharge?(charge: number): void };
type StageMesh = Object3D & { setStage?(stage: number): void };

// ---- the level ----------------------------------------------------------------

export type BossEventListener = (event: BossEvent) => void;

export type EscapementGameplayHooks = {
  /** Seats a boss part mesh on the boss body. Return false to fall back to the analytic pose. */
  seatBossPart?(part: BossPart, mesh: Object3D): boolean;
  /** Called when a wasp fires, a tick leaps or a ratchet steps, for audio. */
  onRatchetStep?(stage: number): void;
  onTickLeap?(): void;
};

export type EscapementDebugTarget = 'mote' | 'burr' | 'tick' | 'ratchet' | 'wasp' | 'chime' | 'boss';

export const ESCAPEMENT_DEBUG_TARGETS: Array<{ id: EscapementDebugTarget; title: string }> = [
  { id: 'mote', title: 'Tarnish mote' },
  { id: 'burr', title: 'Burr' },
  { id: 'tick', title: 'Oxide tick' },
  { id: 'ratchet', title: 'Ratchet' },
  { id: 'wasp', title: 'Jewel wasp' },
  { id: 'chime', title: 'Chime' },
  { id: 'boss', title: 'The Escapement' },
];

export function normalizeEscapementDebugTarget(value: string | undefined): EscapementDebugTarget | undefined {
  return ESCAPEMENT_DEBUG_TARGETS.find((target) => target.id === value)?.id;
}

export type EscapementGameplay = LockOnRunnerLevel<EscapementEnemyKind, EscapementSpawnData> & {
  boss: EscapementBoss;
  /** Boss state after the latest update. */
  bossSnapshot(): BossSnapshot;
  onBossEvent(listener: BossEventListener): () => void;
  /** Advances the boss machine and the displayed swing amplitude to run time `time`. Safe to call more than once per frame. */
  updateBoss(time: number): void;
  /** Swing angle in degrees at `time` with the amplitude currently displayed. */
  swingDegreesAt(time: number): number;
  /** Displayed pendulum amplitude in degrees; eases toward the boss machine's value. */
  amplitude(): number;
  /** True once the twelfth ring has landed this run. */
  clockFreed(): boolean;
  hooks: EscapementGameplayHooks;
};

const DEBUG_LEAD = 600;

function debugTimeline(target: EscapementDebugTarget): { entries: EscapementSpawnEntry[]; debug: Set<EscapementSpawnEntry> } {
  const timeline = createEscapementTimeline();
  const debug = new Set<EscapementSpawnEntry>();
  const pick = (kinds: EscapementEnemyKind[]) => {
    const entries: EscapementSpawnEntry[] = [];
    for (const kind of kinds) {
      const source = timeline.find((entry) => entry.kind === kind);
      if (!source) continue;
      const entry: EscapementSpawnEntry = { ...source, time: 1 + entries.length * 0.1, hitStages: Array.from({ length: 12 }, () => 6), lockable: true };
      debug.add(entry);
      entries.push(entry);
    }
    return entries;
  };
  if (target === 'boss') {
    const entries = pick(['jewel']);
    const right = timeline.find((entry) => entry.data.role === 'jewel' && entry.data.part === 'jewel-right');
    for (const source of [right, createArborEntry(bar(ESCAPEMENT_BARS.boss))]) {
      if (!source) continue;
      const entry: EscapementSpawnEntry = { ...source, time: 1.2 + entries.length * 0.1, hitStages: Array.from({ length: 12 }, () => 6), lockable: true };
      debug.add(entry);
      entries.push(entry);
    }
    return { entries, debug };
  }
  return { entries: pick([target]), debug };
}

export function createEscapementGameplay(bus: EventBus, debugTarget?: EscapementDebugTarget): EscapementGameplay {
  const built = debugTarget ? debugTimeline(debugTarget) : { entries: createEscapementTimeline(), debug: new Set<EscapementSpawnEntry>() };
  const timeline = built.entries;
  const debugEntries = built.debug;
  const hooks: EscapementGameplayHooks = {};

  const boss = createEscapementBoss();
  const listeners = new Set<BossEventListener>();
  const bossParts = new Map<number, BossPart>();
  const interceptions = new Set<number>();
  const waspPositions = new Map<number, Vector3>();
  const waspSeats = new Map<number, { lateral: number; vertical: number; ahead: number }>();
  const pendingSpawns: EscapementSpawnEntry[] = [];
  let lastRunTime = 0;
  let bossTime = -1;
  let liveAmplitude = 20;
  let freed = false;
  let hitsTaken = 0;
  let boltsDowned = 0;

  function emitBoss(events: BossEvent[]) {
    for (const event of events) {
      if (event.type === 'arborStage' && event.stage === 1) pendingSpawns.push(createArborEntry(event.time));
      if (event.type === 'tickPour') pendingSpawns.push(...createTickPour(event.time));
      if (event.type === 'killed') freed = true;
      for (const listener of listeners) listener(event);
    }
  }

  function updateBoss(time: number) {
    if (time === bossTime) return;
    const dt = Math.max(0, time - (bossTime < 0 ? time : bossTime));
    bossTime = time;
    const target = boss.snapshot().amplitude;
    liveAmplitude = MathUtils.damp(liveAmplitude, target, 1.6, dt);
    if (Math.abs(liveAmplitude - target) < 0.05) liveAmplitude = target;
    emitBoss(boss.update(time, swingDegrees(time, liveAmplitude)));
  }

  function reset() {
    boss.reset();
    bossParts.clear();
    interceptions.clear();
    waspPositions.clear();
    waspSeats.clear();
    pendingSpawns.length = 0;
    lastRunTime = 0;
    bossTime = -1;
    liveAmplitude = 20;
    freed = false;
    hitsTaken = 0;
    boltsDowned = 0;
  }

  bus.on('runstart', reset);
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    waspPositions.delete(enemyId);
    waspSeats.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    waspPositions.delete(enemyId);
    waspSeats.delete(enemyId);
  });
  bus.on('hit', ({ enemyId }) => {
    const part = bossParts.get(enemyId);
    if (part === undefined) return;
    updateBoss(lastRunTime);
    emitBoss(boss.hit(part, lastRunTime));
  });

  function flushSpawns(context: EscapementUpdate) {
    while (pendingSpawns.length > 0) context.spawnEnemy(pendingSpawns.shift()!);
  }

  function isDebug(entry: EscapementSpawnEntry) {
    return debugEntries.has(entry);
  }

  /** The camera's view frame for this update, with the amplitude currently displayed. */
  function viewAt(context: EscapementUpdate) {
    return frameAt(context, swingDegrees(context.runTime, liveAmplitude));
  }

  /** Age used for placement: debug targets freeze partway into their approach. */
  function placementAge(context: EscapementUpdate, lead: number) {
    return isDebug(context.enemy.entry) ? lead * 0.7 : context.age;
  }

  function effectiveLead(context: EscapementUpdate, placement: EscapementPlacement) {
    return isDebug(context.enemy.entry) ? DEBUG_LEAD : leadSeconds(placement);
  }

  // ---- movement ---------------------------------------------------------------

  function updateMote(context: EscapementUpdate, data: Extract<EscapementSpawnData, { role: 'mote' }>) {
    const { enemy, age, runTime, camera } = context;
    const lead = effectiveLead(context, data.placement);
    const frame = viewAt(context);
    const seat = seatOf(data.placement);
    const spiral = (2 * Math.PI * age) / (data.spiralBeats * BEAT) + data.slot * 0.8;
    const lateral = seat.lateral + Math.cos(spiral) * data.spiralRadius + (data.drift[0] * age) / BAR;
    const vertical = seat.vertical + Math.sin(spiral) * data.spiralRadius * 0.7 + (data.drift[1] * age) / BAR;
    const ahead = approach(placementAge(context, lead), lead, 70);
    placeAhead(frame, lateral, vertical, ahead, enemy.mesh.position);
    faceCamera(enemy.mesh, frame, camera);
    enemy.mesh.rotateX(0.55 + Math.sin(age * 0.9 + data.slot) * 0.3);
    enemy.mesh.rotateY(age * 1.3 + data.slot);
    return !isDebug(enemy.entry) && age > lead + PASS_SECONDS;
  }

  function updateBurr(context: EscapementUpdate, data: Extract<EscapementSpawnData, { role: 'burr' }>) {
    const { enemy, age, runTime, camera } = context;
    const frame = viewAt(context);
    const crossSeconds = data.crossBeats * BEAT;
    const t = isDebug(enemy.entry) ? 0.5 : (age - data.delayBeats * BEAT) / crossSeconds;
    if (!isDebug(enemy.entry) && t > 1.12) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const lateral = MathUtils.lerp(data.fromLateral, data.toLateral, eased) * OFFSET_SCALE;
    const vertical = data.placement.vertical * OFFSET_SCALE + Math.sin(clamped * Math.PI) * data.arc * OFFSET_SCALE;
    const ahead = MathUtils.lerp(34, 24, clamped);
    placeAhead(frame, lateral, vertical, ahead, enemy.mesh.position);
    faceCamera(enemy.mesh, frame, camera);
    enemy.mesh.rotateZ(age * data.tumbleTurnsPerBar * (2 * Math.PI) / BAR);
    return false;
  }

  function updateTick(context: EscapementUpdate, data: Extract<EscapementSpawnData, { role: 'tick' }>) {
    const { enemy, age, runTime, camera } = context;
    const frame = viewAt(context);
    const seat = seatOf(data.placement);
    const walkSeconds = data.walkBeats * BEAT;
    const leapAt = data.leapBeat * BEAT;
    const leapSeconds = data.leapBeats * BEAT;
    const mesh = enemy.mesh as GaitMesh;
    const state = context.enemyState(() => ({ leapt: false }));
    const from = { lateral: data.walkFrom[0] * OFFSET_SCALE, vertical: data.walkFrom[1] * OFFSET_SCALE };
    const clock = isDebug(enemy.entry) ? walkSeconds * 0.6 : age;

    let lateral: number;
    let vertical: number;
    let ahead: number;
    if (clock < walkSeconds) {
      const t = clock / walkSeconds;
      lateral = MathUtils.lerp(from.lateral, seat.lateral, t);
      vertical = MathUtils.lerp(from.vertical, seat.vertical, t) + Math.abs(Math.sin(t * Math.PI * data.walkBeats)) * 0.15;
      ahead = MathUtils.lerp(36, 28, t);
      mesh.setGait?.('walk');
    } else if (clock < leapAt) {
      lateral = seat.lateral;
      vertical = seat.vertical;
      ahead = 28;
      mesh.setGait?.('raised');
    } else {
      const t = MathUtils.clamp((clock - leapAt) / leapSeconds, 0, 1);
      if (!state.leapt) {
        state.leapt = true;
        hooks.onTickLeap?.();
      }
      lateral = MathUtils.lerp(seat.lateral, 0, t);
      vertical = MathUtils.lerp(seat.vertical, 0, t) + Math.sin(t * Math.PI) * 1.5;
      ahead = MathUtils.lerp(28, PASS_BEHIND, t * t);
      mesh.setGait?.('leap');
      if (t >= 1) return true;
    }
    placeAhead(frame, lateral, vertical, ahead, enemy.mesh.position);
    // Walking: head down the face toward the seat. Leaping: head at the camera.
    if (clock < leapAt) {
      const toward = placeAhead(frame, seat.lateral, seat.vertical - 4, 20);
      mesh.up.copy(frame.up);
      mesh.lookAt(toward);
    } else {
      faceCamera(mesh, frame, camera);
    }
    return false;
  }

  function updateRatchet(context: EscapementUpdate, data: Extract<EscapementSpawnData, { role: 'ratchet' }>) {
    const { enemy, age, runTime, camera } = context;
    const lead = effectiveLead(context, data.placement);
    const frame = viewAt(context);
    const seat = seatOf(data.placement);
    const from = { lateral: data.from[0] * OFFSET_SCALE, vertical: data.from[1] * OFFSET_SCALE };
    const state = context.enemyState(() => ({ steps: 0, travelled: 0 }));
    const stage = enemy.hitStageIndex;
    (enemy.mesh as StageMesh).setStage?.(stage);
    const steps = Math.floor(placementAge(context, lead) / BEAT);
    while (state.steps < steps) {
      state.steps += 1;
      state.travelled += data.stepMetres * OFFSET_SCALE * 2 ** stage;
      hooks.onRatchetStep?.(stage);
    }
    const dx = seat.lateral - from.lateral;
    const dy = seat.vertical - from.vertical;
    const distance = Math.hypot(dx, dy);
    const travelled = Math.min(distance, state.travelled);
    // The lever kicks forward on the beat and settles.
    const snap = Math.exp(-((placementAge(context, lead) % BEAT) / BEAT) * 7) * 0.25;
    const lateral = from.lateral + (dx / Math.max(0.001, distance)) * travelled;
    const vertical = from.vertical + (dy / Math.max(0.001, distance)) * travelled - snap;
    const ahead = approach(placementAge(context, lead), lead, 46);
    placeAhead(frame, lateral, vertical, ahead, enemy.mesh.position);
    faceCamera(enemy.mesh, frame, camera);
    enemy.mesh.rotateZ(-0.4 + Math.sin(age * 0.7) * 0.1);
    return !isDebug(enemy.entry) && age > lead + PASS_SECONDS;
  }

  function fireBolt(context: EscapementUpdate, from: Vector3) {
    const entry = createRubyBolt(context.runTime, context.enemy.id);
    waspPositions.set(context.enemy.id, from.clone());
    context.spawnEnemy(entry);
  }

  function updateWasp(context: EscapementUpdate, data: Extract<EscapementSpawnData, { role: 'wasp' }>) {
    const { enemy, age, runTime, camera } = context;
    const lead = effectiveLead(context, data.placement);
    const frame = viewAt(context);
    const seat = seatOf(data.placement);
    const state = context.enemyState(() => ({ fired: 0, nextDebugFire: 3 }));
    const ride = Math.sin(age * 0.55 + enemy.id) * data.rideMetresPerBar * 1.6;
    const lateral = seat.lateral + ride;
    const vertical = seat.vertical + Math.sin(age * 1.3) * 0.4;
    const ahead = approach(placementAge(context, lead), lead, 42);
    placeAhead(frame, lateral, vertical, ahead, enemy.mesh.position);
    faceCamera(enemy.mesh, frame, camera);
    waspPositions.set(enemy.id, enemy.mesh.position);
    waspSeats.set(enemy.id, { lateral, vertical, ahead });

    const fireTimes = isDebug(enemy.entry) ? [state.nextDebugFire] : data.fireTimes;
    const next = fireTimes[state.fired];
    const mesh = enemy.mesh as ChargeMesh;
    if (next !== undefined) {
      const until = next - runTime;
      mesh.setCharge?.(MathUtils.clamp(1 - until / BEAT, 0, 1));
      if (until <= 0) {
        state.fired += 1;
        if (isDebug(enemy.entry)) {
          state.nextDebugFire = runTime + 4;
          state.fired = 0;
        }
        mesh.setCharge?.(0);
        fireBolt(context, enemy.mesh.position);
      }
    } else {
      mesh.setCharge?.(0);
    }
    return !isDebug(enemy.entry) && age > lead + PASS_SECONDS;
  }

  function updateChime(context: EscapementUpdate, data: Extract<EscapementSpawnData, { role: 'chime' }>) {
    const { enemy, age, runTime } = context;
    const lead = effectiveLead(context, data.placement);
    const frame = viewAt(context);
    const seat = seatOf(data.placement);
    const dial = data.placement.anchor === 'dial-numeral';
    const far = dial ? 110 : 60;
    const ahead = approach(placementAge(context, lead), lead, far);
    placeAhead(frame, seat.lateral, seat.vertical, ahead, enemy.mesh.position);
    // A chime hangs from the rail frame's up and faces back along the rail.
    enemy.mesh.up.copy(frame.up);
    enemy.mesh.lookAt(enemy.mesh.position.clone().sub(frame.tangent));
    return !isDebug(enemy.entry) && age > lead + PASS_SECONDS;
  }

  /**
   * A ruby bolt flies from the wasp's seat to the camera's nose in the rail
   * frame, so it arrives whatever the rail speed or the swing. hostile-shot.ts
   * owns the last metres: the brake, the intercept grace, and the damage.
   */
  function updateBolt(context: EscapementUpdate, data: Extract<EscapementSpawnData, { role: 'bolt' }>) {
    const { enemy, age, runTime, camera, damagePlayer } = context;
    const frame = viewAt(context);
    const state = context.enemyState(() => ({
      seat: waspSeats.get(data.waspId) ?? { lateral: 0, vertical: 3 * OFFSET_SCALE, ahead: 30 },
      position: new Vector3(),
      velocity: new Vector3(),
      last: null as Vector3 | null,
      lastAge: 0,
      impact: {} as HostileShotImpactState,
    }));
    const dt = Math.max(1e-3, age - state.lastAge);
    state.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: state.position,
      velocity: state.velocity,
      state: state.impact,
      intercepted: interceptions.delete(enemy.id),
      config: { hitDistance: BOLT_HIT_DISTANCE, impactBrake: 0.3, damageDistance: BOLT_DAMAGE_DISTANCE },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(state.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    const t = MathUtils.clamp(age / BOLT_FLIGHT_SECONDS, 0, 1);
    const eased = t * t;
    const seat = placeAhead(
      frame,
      MathUtils.lerp(state.seat.lateral, 0, eased),
      MathUtils.lerp(state.seat.vertical, 0.2, eased),
      MathUtils.lerp(state.seat.ahead, BOLT_HIT_DISTANCE * 0.8, eased),
    );
    camera.getWorldDirection(scratchForward);
    scratchUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const nose = scratchNose.copy(camera.position).addScaledVector(scratchForward, BOLT_HIT_DISTANCE * 0.8).addScaledVector(scratchUp, 0.2);
    seat.lerp(nose, MathUtils.smoothstep(t, 0.55, 1));
    if (state.last) state.velocity.copy(seat).sub(state.last).divideScalar(dt);
    state.last = (state.last ?? new Vector3()).copy(seat);
    state.position.copy(seat);
    enemy.mesh.position.copy(seat);
    if (state.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(seat.clone().add(state.velocity));
    else enemy.mesh.lookAt(camera.position);
    return age > BOLT_FLIGHT_SECONDS + 2 || shotBehindCamera(camera, state.position);
  }

  // Analytic pose of a boss part when no body is attached: the fork tips and the
  // arbor in the body's frame at the mount, rocked by the fork angle.
  const partOffsets: Record<BossPart, Vector3> = {
    'jewel-left': new Vector3(-21, -18.4, 4.6),
    'jewel-right': new Vector3(21, -18.4, 4.6),
    arbor: new Vector3(0, 0, 7.4),
  };

  function seatPart(part: BossPart, mesh: Object3D, forkRadians: number) {
    if (hooks.seatBossPart?.(part, mesh)) return;
    const offset = partOffsets[part].clone().applyAxisAngle(new Vector3(0, 0, 1), forkRadians);
    mesh.position.copy(PENDULUM_LAYOUT.mount).add(offset);
    mesh.quaternion.identity();
  }

  function updateBossPart(context: EscapementUpdate, part: BossPart) {
    const { enemy, runTime } = context;
    bossParts.set(enemy.id, part);
    updateBoss(runTime);
    flushSpawns(context);
    const snapshot = boss.snapshot();
    const debug = isDebug(enemy.entry);
    enemy.entry.lockable = debug ? true : snapshot.lockable[part];
    const forkRadians = -swingDegrees(runTime, liveAmplitude) * DEG;
    seatPart(part, enemy.mesh, forkRadians);
    if (part === 'arbor') enemy.mesh.visible = debug || snapshot.arborStage > 0;
    if (debug) return false;
    if (snapshot.stage === 'failed' || runTime >= BOSS_DEADLINE) return true;
    return !snapshot.alive[part] && snapshot.stage !== 'dead';
  }

  const level: EscapementGameplay = {
    duration: debugTarget ? 90 : ESCAPEMENT_DURATION,
    bpm: ESCAPEMENT_BPM,
    playerHealth: ESCAPEMENT_PLAYER_HEALTH,
    createRail: () => createEscapementRail({ degreesAt: (time) => swingDegrees(time, liveAmplitude) }),
    spawnTimeline: timeline,
    easeRunProgress: escapementRunProgress,
    startWord: 'START',
    replayWord: 'REPLAY',
    boss,
    hooks,
    bossSnapshot: () => boss.snapshot(),
    onBossEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateBoss,
    swingDegreesAt: (time) => swingDegrees(time, liveAmplitude),
    amplitude: () => liveAmplitude,
    clockFreed: () => freed,
    updateEnemy(context) {
      lastRunTime = context.runTime;
      if (pendingSpawns.length > 0) flushSpawns(context);
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'mote':
          return updateMote(context, data);
        case 'burr':
          return updateBurr(context, data);
        case 'tick':
          return updateTick(context, data);
        case 'ratchet':
          return updateRatchet(context, data);
        case 'wasp':
          return updateWasp(context, data);
        case 'chime':
          return updateChime(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'jewel':
        case 'arbor':
          return updateBossPart(context, data.part);
      }
    },
    scoreForKill(volleySize, enemy: LockOnEnemy<EscapementEnemyKind, EscapementSpawnData>) {
      if (enemy.kind === 'bolt') boltsDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(ESCAPEMENT_KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (freed && score >= 17000 && clearRate >= 0.8) return 'S';
      if (score >= 11000 && clearRate >= 0.6) return 'A';
      if (score >= 6500 && clearRate >= 0.4) return 'B';
      if (score >= 2500 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, ESCAPEMENT_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${ESCAPEMENT_PLAYER_HEALTH}`];
      if (boltsDowned > 0) lines.push(`${boltsDowned} bolt${boltsDowned === 1 ? '' : 's'} shot down`);
      const bossLine = boss.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
  return level;
}

/** Run-section name at `time`, from timing.ts. */
export function sectionAt(time: number) {
  const bars = ESCAPEMENT_BARS;
  if (time < ESCAPEMENT_MARKERS.train) return 'barrel';
  if (time < ESCAPEMENT_MARKERS.orrery) return 'train';
  if (time < ESCAPEMENT_MARKERS.strike) return 'orrery';
  if (time < ESCAPEMENT_MARKERS.pendulum) return 'strike';
  if (time < ESCAPEMENT_MARKERS.boss) return 'pendulum';
  if (time < bar(bars.freeRun)) return 'boss';
  return 'free-run';
}

export type { EscapementSpawnEntry };
