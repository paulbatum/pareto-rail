import { MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import { createEventBus, type EventBus } from '../../events';
import { createStrandlineParent, type StrandlineParentData } from './parent';
import {
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  STRANDLINE_MARKERS,
  STRANDLINE_TIME,
} from './timing';
import { createStrandlineRail } from './world';

// A sixty-second swim down the trailing strands of a jellyfish the size of a
// cathedral, clearing the parasites off it. Three grammars share the forest:
// clingers that let go of a strand as you close, swarmers that braid across the
// whole width of the water, and borers screwed into a strand that spit homing
// spores. The last seven bars are the parent organism at the crown.

export { STRANDLINE_BPM, STRANDLINE_DURATION } from './timing';
export { createStrandlineRail };
export const STRANDLINE_PLAYER_HEALTH = 3;

export type StrandlineEnemyKind = 'cling' | 'swarmer' | 'borer' | 'spore' | 'brood' | 'parent';

type StrandData = {
  role: 'strand';
  lead: number;
  offset: readonly [number, number];
  /** Fraction of the lead spent gripping the strand before it lets go. */
  hold: number;
  outward: readonly [number, number];
};

type SwarmData = {
  role: 'swarm';
  lead: number;
  offset: readonly [number, number];
  drift: number;
  phase: number;
};

type BorerData = {
  role: 'borer';
  lead: number;
  offset: readonly [number, number];
  shots: number;
};

type SporeData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type StrandlineSpawnData = StrandData | SwarmData | BorerData | SporeData | StrandlineParentData;
export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

const time = STRANDLINE_TIME;
const MISS_GRACE = 0.015;
const FORMATION_GAP = 0.11;
const SPORE_MAX_AGE = 12;

// The swim itself: an unhurried drift into the forest, a long glide through the
// wide arc where the whole animal is in view, the fastest water in the deep
// braid, then a hard deceleration into the crown so the fight is at a hover.
const SPEED_KEYS = [
  [0, 0.62],
  [time.bar(2), 0.8],
  [time.bar(6), 1.06],
  [time.bar(8), 0.86],
  [time.bar(10), 0.94],
  [time.bar(12), 1.32],
  [time.bar(14.5), 1.34],
  [time.bar(15.5), 0.72],
  [time.bar(18), 0.5],
  [time.bar(22), 0.34],
  [STRANDLINE_DURATION, 0.26],
] as const;

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);
export const strandlineRunProgress = (runTime: number, duration = STRANDLINE_DURATION) =>
  speedProfile.runProgress(runTime, duration);
export const strandlineSpeedAt = (runTime: number) => speedProfile.speedAt(runTime);

// ---- spawn grammar --------------------------------------------------------

/** Parasites gripping strands ahead; each lets go before you reach it. */
function clings(
  at: number,
  lead: number,
  offsets: Array<readonly [number, number]>,
  hold = 0.55,
): StrandlineSpawnEntry[] {
  return formation(at, FORMATION_GAP, offsets, (offset) => ({
    kind: 'cling' as const,
    data: { role: 'strand' as const, lead, offset, hold, outward: normalized(offset) },
  }));
}

/** A school braiding across the water; `drift` is signed lateral speed. */
function swarm(
  at: number,
  lead: number,
  offsets: Array<readonly [number, number]>,
  drift: number,
): StrandlineSpawnEntry[] {
  return formation(at, FORMATION_GAP * 0.7, offsets, (offset, index) => ({
    kind: 'swarmer' as const,
    data: { role: 'swarm' as const, lead, offset, drift, phase: index * 0.9 },
  }));
}

/** Screwed into a strand and spitting spores; two hits to prise out. */
function borers(
  at: number,
  lead: number,
  offsets: Array<readonly [number, number]>,
  shots = 2,
): StrandlineSpawnEntry[] {
  return formation(at, FORMATION_GAP * 2, offsets, (offset) => ({
    kind: 'borer' as const,
    hitPoints: 2,
    data: { role: 'borer' as const, lead, offset, shots },
  }));
}

function normalized(offset: readonly [number, number]): readonly [number, number] {
  const length = Math.hypot(offset[0], offset[1]);
  if (length < 0.001) return [0, 1];
  return [offset[0] / length, offset[1] / length];
}

type StrandlineParentRig = ReturnType<typeof createStrandlineParent<StrandlineEnemyKind, StrandlineSpawnData>>;

function createStrandlineTimeline(parent: StrandlineParentRig): StrandlineSpawnEntry[] {
  return [
    // --- Drift. The forest closes over you; wide, slow, readable.
    ...section(STRANDLINE_MARKERS.drift,
      clings(time.beats(2), 3.6, [[-11, 2], [-4.5, 8], [5, 7], [12, 1]]),
      swarm(time.beats(6), 3.4, [[-16, -7], [-16, -2], [-16, 4], [-16, 9]], 10),
      clings(time.beats(10), 3.5, [[-13, -4], [-6, 6], [6, -6], [13, 3]]),
      clings(time.beats(13.5), 3.4, [[-10, 9], [-3, -7], [10, 9]]),
    ),

    // --- Bloom. Layers arrive in the music and in the water together.
    ...section(STRANDLINE_MARKERS.bloom,
      clings(time.beats(0), 3.5, [[-15, 0], [-9, 7], [-2, 11], [7, 7], [14, 0]]),
      swarm(time.beats(3), 3.3, [[16, 10], [16, 5], [16, 0], [16, -5], [16, -10]], -10.5),
      borers(time.beats(6), 3.8, [[-3, 11]]),
      clings(time.beats(6.5), 3.5, [[-14, -3], [14, -3], [-7, -8]]),
      swarm(time.beats(9.5), 3.3, [[-17, 11], [-17, 6], [-17, 0], [-17, -5], [-17, -10]], 11),
      clings(time.beats(12), 3.4, [[-14, 5], [-8, -7], [4, 10], [11, -4], [16, 5]]),
      clings(time.beats(14.5), 3.2, [[-11, -8], [11, -8]]),
    ),

    // --- Open water. The rail banks wide, the murk clears, and the animal is
    // there. Two sparse high formations keep the eye up on the bell.
    ...section(STRANDLINE_MARKERS.openWater,
      // Cleared deliberately between beats 4 and 9.5: for three seconds there
      // is nothing to shoot and the camera gives the frame to the animal.
      clings(time.beats(-3), 2.9, [[-14, 7], [-5, 12], [6, 12], [14, 7]], 0.62),
      clings(time.beats(6), 3.4, [[-13, 5], [-3, 15], [13, 5]], 0.68),
    ),

    // --- Deep. Back into the strands, and now they shoot back.
    ...section(STRANDLINE_MARKERS.deep,
      swarm(time.beats(0), 3.2, [[-18, 6], [-18, 1], [-18, -4], [-18, -9], [-18, 12], [-18, -13]], 11.5),
      borers(time.beats(3), 3.6, [[-11, 4], [11, 4]]),
      clings(time.beats(5), 3.3, [[-16, -4], [-9, 7], [-1, -9], [9, 7], [16, -4]]),
      swarm(time.beats(7), 3.1, [[17, -11], [17, -5], [17, 2], [17, 9]], -12),
    ),

    // --- Braid. The densest water in the level, straight into the crown.
    ...section(STRANDLINE_MARKERS.braid,
      clings(time.beats(0), 3.3, [[-17, 1], [-11, 9], [-4, -7], [5, 12], [12, -3], [18, 6]]),
      swarm(time.beats(2), 3.0, [[-19, 13], [-19, 6], [-19, -1], [-19, -8], [-19, -14]], 12.5),
      borers(time.beats(4), 3.4, [[-12, 9], [12, 9]], 3),
      swarm(time.beats(6), 3.0, [[18, -13], [18, -7], [18, -1], [18, 5], [18, 11], [18, 15]], -12.5),
      clings(time.beats(8), 3.2, [[-17, -6], [-11, 4], [-3, 12], [5, 4], [13, -7], [18, 3]]),
      swarm(time.beats(10), 2.9, [[-17, -12], [-17, -4], [-17, 5], [-17, 13]], 13),
      borers(time.beats(10.5), 3.2, [[4, 12]], 3),
    ),

    // --- The crown. The parent, its webbing, and its broods.
    ...parent.entries(STRANDLINE_MARKERS.crown),

    // --- Purge. Parasites still gripping the crown roots while you work.
    ...section(STRANDLINE_MARKERS.purge,
      clings(time.beats(1), 3.0, [[-15, 4], [15, 4], [-9, -7]], 0.45),
      clings(time.beats(6), 2.9, [[11, -7], [-14, 9], [15, 10]], 0.45),
      clings(time.beats(11), 2.8, [[-9, 12], [9, 12], [-2, -9]], 0.45)
      ,clings(time.beats(15), 2.6, [[-13, 2], [13, 2], [-4, 13], [5, -8]], 0.4),
    ),
  ];
}

const traceParent = createStrandlineParent<StrandlineEnemyKind, StrandlineSpawnData>(createEventBus(), () => {});
export const STRANDLINE_TIMELINE: StrandlineSpawnEntry[] = sortTimeline(createStrandlineTimeline(traceParent));

const KILL_SCORE: Record<StrandlineEnemyKind, number> = {
  cling: 100,
  swarmer: 80,
  borer: 240,
  spore: 60,
  brood: 320,
  parent: 3000,
};

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let cleanVolleys = 0;

  function spitSpore(context: StrandlineUpdate, from: Vector3) {
    const launch = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'spore',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: launch, lastAge: 0 },
    });
  }

  const parent = createStrandlineParent<StrandlineEnemyKind, StrandlineSpawnData>(bus, spitSpore);
  const timeline = sortTimeline(createStrandlineTimeline(parent));

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    cleanVolleys = 0;
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

  function seatOnRail(context: StrandlineUpdate, anchorU: number, offset: Vector3) {
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchorU, offset));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
  }

  // A clinger grips its strand, shivers, then lets go and swims clear of it.
  function updateCling(context: StrandlineUpdate, data: StrandData) {
    const { enemy, age, runProgress, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const holdSeconds = data.lead * data.hold;
    const release = MathUtils.clamp((age - holdSeconds) / Math.max(0.35, data.lead - holdSeconds), 0, 1);
    const eased = release * release * (3 - 2 * release);
    const grip = 1 - release;

    const offset = new Vector3(data.offset[0], data.offset[1], 0);
    // Gripping: a tight shiver against the strand. Loose: a slow open swim.
    offset.x += Math.sin(age * 7.5 + enemy.id) * 0.28 * grip + data.outward[0] * eased * 5.2;
    offset.y += Math.cos(age * 6.9 + enemy.id * 0.7) * 0.22 * grip + data.outward[1] * eased * 3.6;
    offset.y += Math.sin(age * 2.4 + enemy.id) * 1.15 * eased;
    offset.z = Math.sin(age * 1.6 + enemy.id * 0.4) * 0.8 * eased;

    seatOnRail(context, anchorU, offset);
    enemy.mesh.rotateZ(Math.sin(age * 1.3 + enemy.id) * 0.5 + eased * 1.4);
    enemy.mesh.userData.detach = eased;
    enemy.mesh.userData.pulse = 0.5 + Math.sin(age * (grip > 0.5 ? 9 : 3.4) + enemy.id) * 0.5;

    return runProgress > anchorU + MISS_GRACE;
  }

  // A school crossing the corridor: everything travels the same way, so the
  // player sweeps the whole width of the frame to take a wave in one volley.
  function updateSwarm(context: StrandlineUpdate, data: SwarmData) {
    const { enemy, age, runProgress, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = new Vector3(
      data.offset[0] + data.drift * age,
      data.offset[1] + Math.sin(age * 2.7 + data.phase) * 3.3,
      Math.cos(age * 2.1 + data.phase) * 1.6,
    );
    seatOnRail(context, anchorU, offset);
    enemy.mesh.rotateZ(Math.sin(age * 5.5 + data.phase) * 0.55);
    enemy.mesh.userData.pulse = 0.5 + Math.sin(age * 7.4 + data.phase) * 0.5;
    enemy.mesh.userData.heading = Math.sign(data.drift);

    return runProgress > anchorU + MISS_GRACE;
  }

  // Screwed head-first into a strand: it turns in place and spits spores.
  function updateBorer(context: StrandlineUpdate, data: BorerData) {
    const { enemy, age, runProgress, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const fire = context.enemyState(() => ({ nextAt: 1.05, left: data.shots }));
    const offset = new Vector3(
      data.offset[0] + Math.sin(age * 1.15 + enemy.id) * 1.9,
      data.offset[1] + Math.cos(age * 0.95 + enemy.id) * 1.2,
      Math.sin(age * 1.6) * 0.7,
    );
    seatOnRail(context, anchorU, offset);
    enemy.mesh.rotateZ(age * 2.6);
    enemy.mesh.userData.charge = fire.left > 0 ? MathUtils.clamp(1 - (fire.nextAt - age) / 0.7, 0, 1) : 0;
    enemy.mesh.userData.pulse = 0.5 + Math.sin(age * 3.1) * 0.5;

    if (fire.left > 0 && age >= fire.nextAt) {
      fire.left -= 1;
      fire.nextAt = age + 1.35;
      spitSpore(context, enemy.mesh.position);
    }

    return runProgress > anchorU + MISS_GRACE;
  }

  // Spores drift out lazily, then commit and home. They are lockable, and the
  // runner puts them at the front of the lock queue.
  function updateSpore(context: StrandlineUpdate, data: SporeData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: interceptions.delete(enemy.id),
    });
    enemy.mesh.userData.pulse = 0.5 + Math.sin(age * 11) * 0.5;

    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 6.5);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.6,
      maxSpeed: 11,
      accel: 2.9,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 3.4);

    return shotBehindCamera(camera, data.position) || age > SPORE_MAX_AGE;
  }

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    startWord: 'REVIVE',
    replayWord: 'RETURN',
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    // A whole bar of snap at this tempo would feel sludgy; half a bar keeps
    // six-lock volleys landing inside the phrase they were released in.
    timing: { shotDelay: { maxGridSeconds: 1.25 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'strand':
          return updateCling(context, data);
        case 'swarm':
          return updateSwarm(context, data);
        case 'borer':
          return updateBorer(context, data);
        case 'bolt':
          return updateSpore(context, data);
        case 'parent':
        case 'brood':
          return parent.update(context, data);
      }
    },
    validateRelease(enemies) {
      return parent.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 55,
    // A full six-lock release that kills everything it touched: one clean
    // length of strand freed at once.
    scoreForVolley(results) {
      if (results.length < 6 || results.some((result) => !result.killed)) return 0;
      cleanVolleys += 1;
      return 700;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (parent.destroyed && score >= 15500 && clearRate >= 0.88) return 'S';
      if (score >= 11000 && clearRate >= 0.7) return 'A';
      if (score >= 7000 && clearRate >= 0.5) return 'B';
      if (score >= 3500 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${STRANDLINE_PLAYER_HEALTH}`, parent.summary()];
      if (cleanVolleys > 0) lines.push(`${cleanVolleys} clean strand${cleanVolleys === 1 ? '' : 's'}`);
      return lines;
    },
  };
}
