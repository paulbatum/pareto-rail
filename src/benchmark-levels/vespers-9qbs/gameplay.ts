import { MathUtils, Quaternion, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { createRoseThing } from './boss';
import {
  createVespersRail,
  createWindowClaims,
  NAVE_HALF_WIDTH,
  railZAt,
  vespersRunProgress,
  WINDOWS,
  type WindowTier,
} from './cathedral';
import { VESPERS_BARS, VESPERS_BPM, VESPERS_DURATION, VESPERS_TIME } from './timing';

// VESPERS — a 60-second flight down the nave of a cathedral at night while
// something eats the light out of it. Every creature is a flat black shape
// that peeled off one specific window carrying that pane's colour; killing it
// sends the light home and the window stays lit for the rest of the run.
//
// The spawn timeline is written against the organ score (timing.ts):
//   bars 0–1   pedal alone          — a few moths, room to learn the sweep
//   bars 2–3   alto enters (subject) — six moths drawn in the subject's contour
//   bars 4–5   soprano answers      — rosettes roll across on the answer's notes
//   bars 6–7   tenor enters         — shades rise from the aisles below
//   bars 8–9   pedal takes the tune — censers swing down from the crossing vault
//   bars 10–11 episode climax       — the lantern empties, the densest volleys
//   bars 12–14 the dark span        — one voice, almost nothing on screen
//   bars 15–22 the rose             — the Thing in the west rose; break it open

export { VESPERS_BPM, VESPERS_DURATION } from './timing';
export const VESPERS_PLAYER_HEALTH = 3;

export type VespersEnemyKind = 'moth' | 'rosette' | 'shade' | 'censer' | 'shard' | 'claw' | 'heart';

type Sweep = { fromX: number; toX: number; y: number; arc: number; crossTime: number };
type Swing = { pivotX: number; bottomY: number; amplitude: number; phase: number };

export type WaveData = {
  role: 'moth' | 'rosette' | 'shade' | 'censer';
  lead: number;
  offset: Vector3;
  window: number;
  seed: number;
  sweep?: Sweep;
  swing?: Swing;
};

export type ShardData = {
  role: 'shard';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  hue: number;
  impact: HostileShotImpactState;
};

export type BossData = { role: 'claw'; index: number; window: number } | { role: 'heart' };

export type VespersSpawnData = WaveData | ShardData | BossData;
export type VespersSpawnEntry = LockOnSpawnEntry<VespersEnemyKind, VespersSpawnData>;
export type VespersUpdate = LockOnEnemyUpdate<VespersEnemyKind, VespersSpawnData>;

const T = VESPERS_TIME;
const bar = (index: number, beat = 0) => T.bar(index, beat);

// ---- timeline authoring ------------------------------------------------------

const TIERS: Record<WaveData['role'], readonly WindowTier[]> = {
  moth: ['clerestory'],
  rosette: ['oculus', 'lantern', 'clerestory'],
  shade: ['aisle'],
  censer: ['oculus', 'lantern', 'clerestory'],
};

type WaveMember = {
  beat: number;
  offset: [number, number];
  sweep?: Sweep;
  swing?: Swing;
};

function createTimeline(): VespersSpawnEntry[] {
  const claims = createWindowClaims();
  const entries: VespersSpawnEntry[] = [];
  let seed = 1;

  // A wave is anchored on one bar; every member is overtaken at the same
  // musical moment (`meetAt`), so staggered entrances still resolve as one
  // readable formation and one volley.
  const wave = (
    role: WaveData['role'],
    atBar: number,
    meetAt: number,
    members: WaveMember[],
    hitPoints = 1,
  ) => {
    for (const member of members) {
      const time = bar(atBar, member.beat);
      const lead = Math.max(2.4, meetAt - time);
      const side = member.sweep ? Math.sign(member.sweep.fromX) : member.swing ? Math.sign(member.swing.pivotX) || 1 : Math.sign(member.offset[0]) || 1;
      const window = claims.claim(time, railZAt(time + lead), side, TIERS[role]);
      entries.push({
        time,
        kind: role,
        hitPoints,
        data: {
          role,
          lead,
          offset: new Vector3(member.offset[0], member.offset[1], 0),
          window,
          seed: (seed += 1.618),
          sweep: member.sweep,
          swing: member.swing,
        },
      });
    }
  };

  // bars 0–1: the pedal alone. Two small flights, one per side.
  wave('moth', 0, bar(0, 2) + 4.9, [
    { beat: 2, offset: [-9.5, 4] },
    { beat: 2.5, offset: [-5, 1.2] },
    { beat: 3, offset: [-10.5, -2.6] },
  ]);
  wave('moth', 1, bar(1) + 4.9, [
    { beat: 0, offset: [9.5, 3.4] },
    { beat: 0.5, offset: [5, 0.4] },
    { beat: 1, offset: [10.5, -3] },
  ]);

  // bars 2–3: the alto states the subject — D A B♭ A G F — and six moths
  // come off the glass on its notes, hanging in the shape of the tune.
  const subjectBeats = [0, 1, 2, 2.5, 3, 3.5];
  const subjectHeights = [-3.8, 3, 4.4, 3, 1.1, -0.9];
  const subjectXs = [-11, -6.8, -2.6, 1.8, 6, 10.4];
  wave('moth', VESPERS_BARS.alto, bar(VESPERS_BARS.alto) + 5.3, subjectBeats.map((beat, index) => ({
    beat,
    offset: [subjectXs[index], subjectHeights[index]] as [number, number],
  })));

  // bars 4–5: the soprano answers from the other side — rosettes roll across
  // the vault line on the answer's notes, then a low row of moths.
  const answer = [
    { beat: 0, y: 2.2 },
    { beat: 1, y: 5.6 },
    { beat: 2, y: 7 },
    { beat: 2.5, y: 6.2 },
    { beat: 3, y: 5.2 },
  ];
  wave('rosette', VESPERS_BARS.soprano, bar(VESPERS_BARS.soprano) + 5.8, answer.map(({ beat, y }) => ({
    beat,
    offset: [0, y] as [number, number],
    sweep: { fromX: 13.5, toX: -13.5, y, arc: -1.6, crossTime: 3.4 },
  })));
  wave('moth', 5, bar(5) + 4.6, [
    { beat: 0, offset: [-8.5, -4.6] },
    { beat: 1, offset: [0.8, -5.8] },
    { beat: 2, offset: [8.8, -4.4] },
  ]);

  // bars 6–7: the tenor enters low, so the shades rise out of the aisles.
  wave('shade', VESPERS_BARS.tenor, bar(VESPERS_BARS.tenor) + 5.6, [
    { beat: 0, offset: [-10.5, -1.6] },
    { beat: 1, offset: [-3.6, 2.8] },
    { beat: 2, offset: [3.8, 3.6] },
    { beat: 3, offset: [10.5, 1] },
  ]);
  wave('rosette', 7, bar(7) + 4.8, [
    { beat: 0, offset: [0, 6.2], sweep: { fromX: -14, toX: 14, y: 6.2, arc: 1.4, crossTime: 3.1 } },
    { beat: 2, offset: [0, -5.4], sweep: { fromX: 14, toX: -14, y: -5.4, arc: -1.2, crossTime: 3.1 } },
  ]);

  // bars 8–9: the pedal takes the subject and the crossing opens. Censers
  // swing on the bar — through the middle on beats one and three.
  wave('censer', VESPERS_BARS.swell, bar(VESPERS_BARS.swell) + 6.4, [
    { beat: 0, offset: [0, 0], swing: { pivotX: -6.5, bottomY: -1.5, amplitude: 0.36, phase: 0 } },
    { beat: 1, offset: [0, 0], swing: { pivotX: 7, bottomY: 1.5, amplitude: 0.36, phase: Math.PI } },
    { beat: 2, offset: [0, 0], swing: { pivotX: 0.5, bottomY: -4.5, amplitude: 0.42, phase: Math.PI * 0.5 } },
  ], 2);
  const ring: WaveMember[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    ring.push({ beat: i * 0.5, offset: [Math.cos(angle) * 9.5, 1 + Math.sin(angle) * 5.6] });
  }
  wave('moth', 9, bar(9) + 5, ring);

  // bars 10–11: the episode climbs to the half cadence. The lantern empties:
  // two rows of rosettes, then a closing V of moths into the A-major peak.
  wave('rosette', VESPERS_BARS.episode, bar(VESPERS_BARS.episode) + 5.4, [0, 0.5, 1, 1.5, 2, 2.5].map((beat, index) => {
    const leftward = index % 2 === 0;
    const y = index % 2 === 0 ? 5.2 : -3.4;
    return {
      beat,
      offset: [0, y] as [number, number],
      sweep: { fromX: leftward ? 14 : -14, toX: leftward ? -14 : 14, y, arc: leftward ? 1.2 : -1.2, crossTime: 3.6 },
    };
  }));
  wave('moth', 10, bar(11) + 4.2, [
    { beat: 3, offset: [-11.5, 5.4] },
    { beat: 3.25, offset: [11.5, 5.4] },
    { beat: 3.5, offset: [-7.5, 2] },
    { beat: 3.75, offset: [7.5, 2] },
    { beat: 4, offset: [-3.2, -1.4] },
    { beat: 4.25, offset: [3.2, -1.4] },
  ]);

  // bars 12–14: the dark span. One moth, one shade, far apart.
  wave('moth', VESPERS_BARS.quiet, bar(VESPERS_BARS.quiet, 2) + 6.2, [{ beat: 2, offset: [6.5, 3.2] }]);
  wave('shade', 13, bar(13, 2) + 5.4, [{ beat: 2, offset: [-6.5, 0.4] }]);

  return entries;
}

// ---- motion ------------------------------------------------------------------

const PEEL_SECONDS = 1.05;
const MISS_MARGIN = 0.014;
const scratchQuaternion = new Quaternion();
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function windowLaunchPoint(windowIndex: number) {
  const slot = WINDOWS[windowIndex];
  if (!slot) return null;
  const point = slot.position.clone().addScaledVector(slot.inward, 3.2);
  // Aisle lights sit behind the arcade: their creatures surface through the
  // arch in front of them rather than through the stone.
  if (slot.tier === 'aisle') point.x = Math.sign(slot.position.x) * (NAVE_HALF_WIDTH - 4);
  return point;
}

/** Peel: the creature tears off its window and flies to where it wants to be. */
function peel(context: VespersUpdate, data: WaveData, target: Vector3, seconds = PEEL_SECONDS) {
  const from = context.enemyState(() => ({ launch: windowLaunchPoint(data.window) })).launch;
  if (!from) return target;
  const t = MathUtils.clamp(context.age / seconds, 0, 1);
  if (t >= 1) return target;
  const eased = easeOutCubic(t);
  const point = from.clone().lerp(target, eased);
  // A lift in the middle of the flight so it reads as leaving the wall.
  point.y += Math.sin(Math.PI * t) * 2.2;
  return point;
}

function faceCamera(context: VespersUpdate, roll = 0) {
  const mesh = context.enemy.mesh;
  mesh.quaternion.copy(context.camera.quaternion);
  if (roll !== 0) mesh.quaternion.multiply(scratchQuaternion.setFromAxisAngle(Z_AXIS, roll));
}

function tagMesh(context: VespersUpdate, windowIndex: number) {
  const userData = context.enemy.mesh.userData;
  if (userData.windowIndex !== undefined) return;
  userData.windowIndex = windowIndex;
  userData.hue = WINDOWS[windowIndex]?.hue ?? 3;
}

function updateMoth(context: VespersUpdate, data: WaveData) {
  const { enemy, age, runProgress, curve, railAnchor } = context;
  tagMesh(context, data.window);
  const anchorU = railAnchor(data.lead);
  const offset = data.offset.clone();
  // Fluttering drift: a lazy lateral meander with a quicker wingbeat bob.
  offset.x += Math.sin(age * 1.05 + data.seed) * 1.3;
  offset.y += Math.sin(age * 2.4 + data.seed * 1.7) * 0.55 + Math.sin(age * 9.5 + data.seed) * 0.12;
  const slot = offsetFromRail(curve, anchorU, offset);
  enemy.mesh.position.copy(peel(context, data, slot));
  const bank = Math.cos(age * 1.05 + data.seed) * 0.28;
  faceCamera(context, bank);
  enemy.mesh.userData.flap = age;
  return runProgress > anchorU + MISS_MARGIN;
}

function updateRosette(context: VespersUpdate, data: WaveData) {
  const { enemy, age, runProgress, curve, railAnchor } = context;
  tagMesh(context, data.window);
  const sweep = data.sweep!;
  const anchorU = railAnchor(data.lead);
  // Roll across the frame after peeling to the sweep's start.
  const s = MathUtils.clamp((age - PEEL_SECONDS * 0.8) / sweep.crossTime, 0, 1.4);
  const eased = s <= 1 ? s * s * (3 - 2 * s) : 1 + (s - 1) * 0.6;
  const x = MathUtils.lerp(sweep.fromX, sweep.toX, eased);
  const y = sweep.y + sweep.arc * Math.sin(Math.PI * Math.min(1, s));
  const slot = offsetFromRail(curve, anchorU, new Vector3(x, y, 0));
  enemy.mesh.position.copy(peel(context, data, slot, PEEL_SECONDS * 0.8));
  // Roll without slipping: spin follows the direction of travel.
  const direction = Math.sign(sweep.toX - sweep.fromX);
  faceCamera(context, -direction * (x - sweep.fromX) / 1.6 - age * 0.6 * direction);
  return runProgress > anchorU + MISS_MARGIN;
}

function updateShade(context: VespersUpdate, data: WaveData) {
  const { enemy, age, runProgress, curve, railAnchor } = context;
  tagMesh(context, data.window);
  const anchorU = railAnchor(data.lead);
  // Rises out of the aisle below, keeps rising slowly once it has arrived.
  const rise = Math.min(2.2, Math.max(0, age - 1.5) * 0.3);
  const offset = data.offset.clone();
  offset.y += rise;
  offset.x += Math.sin(age * 0.8 + data.seed) * 0.7;
  const slot = offsetFromRail(curve, anchorU, offset);
  const from = context.enemyState(() => ({ launch: windowLaunchPoint(data.window) })).launch;
  if (from && age < 1.5) {
    const t = easeOutCubic(age / 1.5);
    const point = from.clone().lerp(slot, t);
    // Hug the floor first, then climb: the shade surfaces from below.
    point.y = MathUtils.lerp(from.y - 4, slot.y, Math.sin((t * Math.PI) / 2) ** 1.6);
    enemy.mesh.position.copy(point);
  } else {
    enemy.mesh.position.copy(slot);
  }
  faceCamera(context, Math.sin(age * 0.8 + data.seed) * 0.08);
  return runProgress > anchorU + MISS_MARGIN;
}

function updateCenser(context: VespersUpdate, data: WaveData) {
  const { enemy, age, runTime, runProgress, curve, railAnchor } = context;
  tagMesh(context, data.window);
  const swing = data.swing!;
  const anchorU = railAnchor(data.lead);
  const frame = sampleRailFrame(curve, anchorU);
  // The chain hangs from a fixed height up in the vault.
  const pivot = frame.position.clone().addScaledVector(frame.right, swing.pivotX);
  pivot.y = 40;
  const bottom = frame.position.y + swing.bottomY;
  const fullLength = pivot.y - bottom;
  const lower = easeOutCubic(MathUtils.clamp(age / 1.6, 0, 1));
  const length = fullLength * (0.25 + 0.75 * lower);
  // One swing per bar, locked to the transport so it crosses the middle on
  // beats one and three.
  const angle = swing.amplitude * Math.sin((runTime / T.barSeconds) * Math.PI * 2 + swing.phase) * lower;
  const direction = new Vector3().addScaledVector(frame.right, Math.sin(angle)).addScaledVector(new Vector3(0, -1, 0), Math.cos(angle)).normalize();
  enemy.mesh.position.copy(pivot).addScaledVector(direction, length);
  enemy.mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.clone().negate());
  enemy.mesh.rotateY(age * 0.7);
  enemy.mesh.userData.chainLength = length;

  const fire = context.enemyState(() => ({ thrown: false }));
  if (!fire.thrown && age > 2.6 + (data.seed % 1) * 0.8) {
    fire.thrown = true;
    throwShard(context, enemy.mesh.position, WINDOWS[data.window]?.hue ?? 3);
  }
  return runProgress > anchorU + MISS_MARGIN * 0.6;
}

const SHARD_MAX_AGE = 12;

function updateShard(context: VespersUpdate, data: ShardData, interceptions: Set<number>) {
  const { enemy, age, camera, damagePlayer } = context;
  enemy.mesh.userData.hue = data.hue;
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
    faceCamera(context, age * 7);
    if (impact.damaged) {
      damagePlayer(1);
      return true;
    }
    return false;
  }
  steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
    baseSpeed: 4.6,
    maxSpeed: 10.5,
    accel: 2.8,
    turnRate: 2,
  });
  enemy.mesh.position.copy(data.position);
  faceCamera(context, age * 3.4);
  return shotBehindCamera(camera, data.position) || age > SHARD_MAX_AGE;
}

export function throwShard(context: VespersUpdate, from: Vector3, hue: number) {
  const aim = hostileShotAimPoint(context.camera, from).sub(from).normalize();
  const scatter = new Vector3(Math.sin(context.runTime * 7.1), Math.cos(context.runTime * 5.3) + 0.6, 0).multiplyScalar(2.2);
  context.spawnEnemy({
    time: context.runTime,
    kind: 'shard',
    countsTowardTotal: false,
    data: {
      role: 'shard',
      position: from.clone(),
      velocity: aim.multiplyScalar(4.2).add(scatter),
      lastAge: 0,
      hue,
      impact: {},
    },
  });
}

// ---- scoring -------------------------------------------------------------------

const KILL_SCORE: Record<VespersEnemyKind, number> = {
  moth: 100,
  rosette: 120,
  shade: 120,
  censer: 220,
  shard: 30,
  claw: 260,
  heart: 3000,
};

/** `previewHeartAt` (debug only) tears the heart loose at that run time whatever the claws are doing. */
export function createVespersGameplay(bus: EventBus, previewHeartAt = -1): LockOnRunnerLevel<VespersEnemyKind, VespersSpawnData> {
  const interceptions = new Set<number>();
  const rose = createRoseThing(bus, throwShard, previewHeartAt);
  const timeline = sortTimeline([...createTimeline(), ...rose.entries()]);
  const windowBearers = timeline.filter((entry) => entry.kind !== 'heart').length;
  let relit = 0;
  let hitsTaken = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    relit = 0;
    hitsTaken = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  const windowIds = new Set<number>();
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'shard' && kind !== 'heart' && kind !== 'letter') windowIds.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (windowIds.delete(enemyId)) relit += 1;
  });

  return {
    duration: VESPERS_DURATION,
    bpm: VESPERS_BPM,
    playerHealth: VESPERS_PLAYER_HEALTH,
    createRail: createVespersRail,
    spawnTimeline: timeline,
    easeRunProgress: vespersRunProgress,
    // Volleys land on the organ's grid, but the ramp stops at the quarter
    // note: at 96 BPM a coarser snap would hold a kill for most of a bar.
    timing: {
      shotDelay: { maxGridSeconds: T.beatSeconds * 1.01 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'moth':
          return updateMoth(context, data);
        case 'rosette':
          return updateRosette(context, data);
        case 'shade':
          return updateShade(context, data);
        case 'censer':
          return updateCenser(context, data);
        case 'shard':
          // Once the rose burns, thrown glass in flight falls harmlessly away.
          return rose.burned() || updateShard(context, data, interceptions);
        case 'claw':
        case 'heart':
          return rose.update(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.15));
    },
    scoreForHit: () => 50,
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const burned = rose.burned();
      if (burned && clear >= 0.9 && score >= 11000) return 'S';
      if (burned && clear >= 0.72) return 'A';
      if (burned || clear >= 0.6) return 'B';
      if (clear >= 0.35) return 'C';
      return 'D';
    },
    detailsForRun() {
      return [
        `Windows relit ${relit}/${windowBearers}`,
        rose.burned() ? 'The rose burns' : 'The rose stayed dark',
        `Hull ${Math.max(0, VESPERS_PLAYER_HEALTH - hitsTaken)}/${VESPERS_PLAYER_HEALTH}`,
      ];
    },
  };
}

