import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnRunnerLevel } from '../../engine/lock-on-runner';
import { createRailPacer } from '../../engine/rail-pacer';
import { offsetFromRail } from '../../engine/rail';
import { sortTimeline } from '../../engine/spawn-patterns';
import { createEventBus, type EventBus } from '../../events';
import { createPurseBoss, type PurseBoss } from './boss';
import { orientAlongRail } from './rider-motion';
import { PURSE_BPM, PURSE_MARKERS, PURSE_RUN_DURATION, PURSE_TIME, purseRunProgress } from './timing';
import { PURSE_PLAYER_HEALTH, PURSE_TUNING } from './tuning';
import type {
  BombData,
  PurseEnemyKind,
  PurseSpawnData,
  PurseSpawnEntry,
  PurseUpdate,
  RiderData,
  SpikeData,
} from './gameplay-types';

export { PURSE_BPM, PURSE_RUN_DURATION } from './timing';
export { PURSE_PLAYER_HEALTH } from './tuning';
export type { PurseEnemyKind, PurseSpawnData } from './gameplay-types';

const T = PURSE_TIME;
const LANES = PURSE_TUNING.enemies.laneOffsetsUnits;
/** Rail-relative height of the tarmac, and of a bike's model origin on it. */
const DECK = -PURSE_TUNING.road.cameraHeightUnits;
const RIDE = DECK + PURSE_TUNING.enemies.rideHeightUnits * PURSE_TUNING.enemies.modelScale;
const LATERAL_LIMITS = PURSE_TUNING.enemies.lateralLimitsUnits;
/** Metres a rider must be off the centreline by the time you draw level. */
const PASS_CLEARANCE = 5.4;
/** Gap at which that swerve starts. */
const PASS_CLEARANCE_RANGE = 13;

export function createPursePursuitRail() {
  const length = PURSE_TUNING.rail.lengthUnits;
  const sweep = PURSE_TUNING.rail.sweepUnits;
  const relief = PURSE_TUNING.rail.reliefUnits;
  // A city ring road: long lazy S-bends and shallow crests, never a corner you
  // could not take at 130. The lateral sweep is what slides the guardrails and
  // the skyline across the frame instead of nailing them to the vanishing point.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(sweep * 0.18, relief * 0.2, -length * 0.06),
      new Vector3(sweep * 0.7, 0, -length * 0.14),
      new Vector3(sweep * 0.3, relief * 0.7, -length * 0.22),
      new Vector3(-sweep * 0.54, relief * 0.35, -length * 0.31),
      new Vector3(-sweep * 0.92, -relief * 0.25, -length * 0.4),
      new Vector3(-sweep * 0.3, relief * 0.45, -length * 0.49),
      new Vector3(sweep * 0.54, relief * 0.95, -length * 0.58),
      new Vector3(sweep, relief * 0.35, -length * 0.67),
      new Vector3(sweep * 0.38, -relief * 0.12, -length * 0.76),
      new Vector3(-sweep * 0.38, relief * 0.5, -length * 0.85),
      new Vector3(-sweep * 0.15, relief * 0.22, -length * 0.93),
      new Vector3(sweep * 0.08, 0, -length),
    ],
    false,
    'catmullrom',
    PURSE_TUNING.rail.tension,
  );
}

export const pursePacer = createRailPacer({
  curve: createPursePursuitRail(),
  duration: PURSE_RUN_DURATION,
  runProgress: purseRunProgress,
  spawnAheadUnits: PURSE_TUNING.enemies.spawnAheadUnits,
  defaultLeadSeconds: PURSE_TUNING.enemies.defaultLeadSeconds,
});

// ---------------------------------------------------------------------------
// Choreography
//
// Every wave is authored on the bar grid against the arrangement in timing.ts.
// `lanes` index the highway's six lane centres, and waves deliberately open on
// the outside lanes: the sweep is the game, so riders arrive spread wide and
// cross each other on the way in rather than queueing up on the vanishing point.
// ---------------------------------------------------------------------------

type Wave = {
  bar: number;
  beat?: number;
  kind: Exclude<PurseEnemyKind, 'boss' | 'bomb' | 'spike'>;
  lanes: readonly number[];
  /** 16th-note steps between successive riders in the wave. */
  stepEvery?: number;
  leadSeconds?: number;
  lift?: number;
  hitPoints?: number;
  harasses?: boolean;
};

const WEAVER_LEAD = 3.3;
const SWINGER_LEAD = 3.1;
const HAULER_LEAD = 4.0;
const FLYER_LEAD = 2.8;

const WAVES: readonly Wave[] = [
  // --- Rollout: your buddy floors it and the tail lights ahead resolve into
  // bikes. Three sightings, wide apart, nothing to dodge yet.
  { bar: 1, kind: 'weaver', lanes: [1, 4], stepEvery: 3, leadSeconds: WEAVER_LEAD },
  { bar: 2, kind: 'weaver', lanes: [0, 3, 5], stepEvery: 2, leadSeconds: WEAVER_LEAD },
  { bar: 3, kind: 'swinger', lanes: [5, 0], stepEvery: 4, leadSeconds: SWINGER_LEAD },

  // --- Chase (verse): the gang closes ranks. Choppers swing off the shoulder,
  // the first ramp jumper crosses the roof line.
  { bar: 4, kind: 'weaver', lanes: [0, 2, 3, 5], stepEvery: 2, leadSeconds: WEAVER_LEAD },
  { bar: 5, kind: 'swinger', lanes: [5, 0], stepEvery: 4, leadSeconds: SWINGER_LEAD },
  { bar: 5, beat: 2, kind: 'flyer', lanes: [2], leadSeconds: FLYER_LEAD, lift: 7.2 },
  { bar: 6, kind: 'weaver', lanes: [1, 4, 0, 5], stepEvery: 2, leadSeconds: WEAVER_LEAD },
  { bar: 7, kind: 'hauler', lanes: [3], hitPoints: 2, leadSeconds: HAULER_LEAD, harasses: true },
  { bar: 7, beat: 2, kind: 'weaver', lanes: [0, 5], stepEvery: 3, leadSeconds: WEAVER_LEAD },
  { bar: 7, beat: 3, kind: 'flyer', lanes: [4], leadSeconds: FLYER_LEAD, lift: 7.0 },

  { bar: 8, kind: 'weaver', lanes: [0, 1, 3, 4, 5], stepEvery: 2, leadSeconds: WEAVER_LEAD },
  { bar: 9, kind: 'swinger', lanes: [0, 5], stepEvery: 4, leadSeconds: SWINGER_LEAD },
  { bar: 9, beat: 2, kind: 'flyer', lanes: [2], leadSeconds: FLYER_LEAD, lift: 7.6 },
  { bar: 10, kind: 'hauler', lanes: [1, 4], stepEvery: 6, hitPoints: 2, leadSeconds: HAULER_LEAD, harasses: true },
  { bar: 10, beat: 2, kind: 'weaver', lanes: [0, 2, 5], stepEvery: 2, leadSeconds: WEAVER_LEAD },
  { bar: 11, kind: 'flyer', lanes: [1, 4], stepEvery: 4, leadSeconds: FLYER_LEAD, lift: 6.8 },
  { bar: 11, beat: 2, kind: 'swinger', lanes: [5, 0], stepEvery: 3, leadSeconds: SWINGER_LEAD },

  // --- Hook (chorus drop): the whole gang, six across, on the downbeat.
  { bar: 12, kind: 'weaver', lanes: [0, 5, 1, 4, 2, 3], stepEvery: 1, leadSeconds: WEAVER_LEAD },
  { bar: 13, kind: 'swinger', lanes: [5, 0, 4], stepEvery: 3, leadSeconds: SWINGER_LEAD },
  { bar: 13, beat: 3, kind: 'flyer', lanes: [1, 3], stepEvery: 3, leadSeconds: FLYER_LEAD, lift: 7.9 },
  { bar: 14, kind: 'hauler', lanes: [0, 5], stepEvery: 6, hitPoints: 2, leadSeconds: HAULER_LEAD, harasses: true },
  { bar: 14, beat: 2, kind: 'weaver', lanes: [1, 2, 3, 4], stepEvery: 2, leadSeconds: WEAVER_LEAD },
  { bar: 15, kind: 'weaver', lanes: [0, 2, 5], stepEvery: 2, leadSeconds: WEAVER_LEAD },
  { bar: 15, beat: 2, kind: 'swinger', lanes: [5, 0], stepEvery: 3, leadSeconds: SWINGER_LEAD },
  { bar: 15, beat: 3, kind: 'flyer', lanes: [0, 5], stepEvery: 3, leadSeconds: FLYER_LEAD, lift: 8.0 },

  // --- Hook lift: the densest stretch. Ramp jumpers overhead while the pack
  // fills the deck underneath them.
  { bar: 16, kind: 'weaver', lanes: [0, 1, 4, 5], stepEvery: 1, leadSeconds: WEAVER_LEAD },
  { bar: 16, beat: 2, kind: 'flyer', lanes: [2, 3], stepEvery: 3, leadSeconds: FLYER_LEAD, lift: 8.1 },
  { bar: 17, kind: 'hauler', lanes: [2, 3], stepEvery: 6, hitPoints: 2, leadSeconds: HAULER_LEAD, harasses: true },
  { bar: 17, beat: 2, kind: 'swinger', lanes: [0, 5], stepEvery: 3, leadSeconds: SWINGER_LEAD },
  { bar: 18, kind: 'weaver', lanes: [5, 0, 4, 1, 3, 2], stepEvery: 1, leadSeconds: WEAVER_LEAD },
  { bar: 19, kind: 'flyer', lanes: [1, 4], stepEvery: 4, leadSeconds: FLYER_LEAD, lift: 7.4 },
  { bar: 19, beat: 2, kind: 'swinger', lanes: [5, 0], stepEvery: 3, leadSeconds: SWINGER_LEAD },
  { bar: 19, beat: 3, kind: 'weaver', lanes: [0, 3, 5], stepEvery: 2, leadSeconds: WEAVER_LEAD },

  // --- Breakdown: the road empties out. One armoured outrider, two stragglers,
  // then nothing but the boss's tail light growing ahead.
  { bar: 20, kind: 'hauler', lanes: [2], hitPoints: 3, leadSeconds: HAULER_LEAD, harasses: true },
  { bar: 21, kind: 'weaver', lanes: [0, 5], stepEvery: 4, leadSeconds: WEAVER_LEAD },

  // --- Boss escort: thin, so the fight stays readable, but never silent.
  { bar: 23, beat: 2, kind: 'weaver', lanes: [0, 5], stepEvery: 3, leadSeconds: WEAVER_LEAD },
  { bar: 25, beat: 2, kind: 'weaver', lanes: [1, 4], stepEvery: 3, leadSeconds: WEAVER_LEAD },
  { bar: 27, beat: 2, kind: 'flyer', lanes: [0, 5], stepEvery: 4, leadSeconds: FLYER_LEAD, lift: 7.6 },
  { bar: 26, beat: 3, kind: 'swinger', lanes: [5, 0], stepEvery: 3, leadSeconds: SWINGER_LEAD },
  { bar: 28, kind: 'weaver', lanes: [0, 5], stepEvery: 3, leadSeconds: WEAVER_LEAD },

  // --- The scatter. With the boss down the survivors break for the off-ramps,
  // so the outro still has something to shoot at while the purse comes home.
  { bar: 29, beat: 3, kind: 'weaver', lanes: [0, 5, 1], stepEvery: 3, leadSeconds: 2.6 },
  { bar: 30, beat: 2, kind: 'weaver', lanes: [4, 2], stepEvery: 3, leadSeconds: 2.2 },
] as const;

function buildRiderEntries(): PurseSpawnEntry[] {
  const entries: PurseSpawnEntry[] = [];
  for (const wave of WAVES) {
    wave.lanes.forEach((lane, index) => {
      const time = T.bar(wave.bar, wave.beat ?? 0) + index * (wave.stepEvery ?? 2) * T.stepSeconds;
      const lead = wave.leadSeconds ?? PURSE_TUNING.enemies.defaultLeadSeconds;
      if (time > PURSE_RUN_DURATION - lead) return;
      const laneX = LANES[lane] ?? 0;
      const data: RiderData = {
        role: 'rider',
        engagement: pursePacer.resolve(time, lead),
        laneX,
        side: laneX >= 0 ? 1 : -1,
        phase: index * 1.31 + wave.bar * 0.73,
        lift: wave.lift ?? 0,
        harasses: wave.harasses === true,
      };
      entries.push({ time, kind: wave.kind, hitPoints: wave.hitPoints, data });
    });
  }
  return entries;
}

function createTimeline(boss: PurseBoss): PurseSpawnEntry[] {
  return sortTimeline([...buildRiderEntries(), ...boss.entries()]);
}

// A throwaway boss keeps the exported timeline available to `trace:spawns`
// without booting a run.
export const PURSE_SPAWN_TIMELINE: PurseSpawnEntry[] = createTimeline(
  createPurseBoss(createEventBus(), PURSE_MARKERS.bossEntrance),
);

const KILL_SCORE: Record<PurseEnemyKind, number> = {
  weaver: 100,
  swinger: 140,
  hauler: 220,
  flyer: 170,
  bomb: 70,
  spike: 70,
  boss: 3200,
};

const BOMB_MAX_AGE = 9;
const HAULER_HARASS_DISTANCE = 26;

export function createPursePursuitGameplay(bus: EventBus): LockOnRunnerLevel<PurseEnemyKind, PurseSpawnData> {
  const boss = createPurseBoss(bus, PURSE_MARKERS.bossEntrance);
  const timeline = createTimeline(boss);
  const interceptions = new Set<number>();
  const offset = new Vector3();
  let hitsTaken = 0;
  let cleanSixes = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    cleanSixes = 0;
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
  bus.on('volley', ({ size, kills }) => {
    if (size >= 6 && kills >= 6) cleanSixes += 1;
  });

  // -- rider grammars -------------------------------------------------------
  // Four kinds, four silhouettes, four ways of moving. Nothing here is a
  // reskin: the weaver owns the lane grid, the swinger owns depth and the
  // screen edges, the hauler owns the middle distance, the flyer owns the sky.

  function updateRider(context: PurseUpdate, data: RiderData) {
    const { enemy, runTime, age, curve } = context;
    const railLength = curve.getLength();
    const paced = pursePacer.sample(enemy.entry.time, runTime, data.engagement);
    const window = Math.max(0.2, data.engagement.windowSeconds);
    const t = MathUtils.clamp(age / window, 0, 1);
    let lean = 0;
    let steer = 0;

    if (enemy.kind === 'weaver') {
      // Sport bikes braiding through the lane grid: a fast lateral sine over a
      // slow drift, so no two riders in a wave ever sit on the same line.
      const swing = Math.sin(age * 2.7 + data.phase) * 8.4;
      const drift = Math.sin(age * 0.7 + data.phase * 1.7) * 2.4;
      offset.set(data.laneX + swing + drift, RIDE + Math.sin(age * 5.1 + data.phase) * 0.06, 0);
      lean = -Math.cos(age * 2.7 + data.phase) * 0.52;
      steer = lean * -0.35;
    } else if (enemy.kind === 'swinger') {
      // Choppers come off the shoulder, swing right up against the flank at
      // mid-window, then peel back out. The tangent term is what sells "close".
      const entryEase = (1 - t) ** 1.7;
      const closeness = Math.sin(t * Math.PI);
      offset.set(
        data.laneX + data.side * 6.8 * entryEase + Math.sin(age * 1.6 + data.phase) * 0.8,
        RIDE + 0.16 + Math.sin(age * 2.4 + data.phase) * 0.12,
        -closeness * 7.5,
      );
      lean = data.side * (0.42 * entryEase + 0.2 * closeness);
      steer = -data.side * 0.22 * entryEase;
    } else if (enemy.kind === 'hauler') {
      // Heavy tourers hold the middle distance and pump forward and back,
      // hunting for a moment when your buddy has no room to swerve.
      offset.set(
        data.laneX + Math.sin(age * 0.85 + data.phase) * 3.6,
        RIDE + 0.28,
        Math.sin(age * 1.25 + data.phase) * 7.2,
      );
      lean = -Math.cos(age * 0.85 + data.phase) * 0.2;
      if (data.harasses) harass(context, paced.anchorU, data);
    } else {
      // Ramp jumpers: launched off an overpass abutment, fully airborne across
      // the top of the frame, front wheel high, landing on the far side.
      const arc = Math.sin(t * Math.PI) ** 0.78;
      offset.set(
        data.laneX + Math.sin(age * 0.9 + data.phase) * 3.8,
        RIDE + data.lift * arc,
        Math.cos(age * 1.4 + data.phase) * 1.4,
      );
      lean = Math.sin(age * 1.9 + data.phase) * 0.3;
      steer = Math.sin(age * 0.8) * 0.18;
      enemy.mesh.userData.airborne = arc;
    }

    // Riders never leave the tarmac, which also keeps them clear of the
    // guardrails, lamp posts and overpass piers as occluders.
    offset.x = MathUtils.clamp(offset.x, LATERAL_LIMITS[0], LATERAL_LIMITS[1]);

    // The pass. A rider you are drawing level with has to end up in the next
    // lane over, not through the windscreen. This keys off the real gap rather
    // than the window fraction, because a hauler's depth surges can put it on
    // the bumper long before its lead is up. Airborne riders are exempt: they
    // clear the roof by seven metres.
    if (enemy.kind !== 'flyer') {
      const gap = (paced.anchorU - context.runProgress) * railLength + offset.z;
      const passing = MathUtils.clamp(1 - gap / PASS_CLEARANCE_RANGE, 0, 1);
      if (passing > 0) {
        const side = offset.x >= 0 ? 1 : -1;
        const clear = side * Math.max(Math.abs(offset.x), PASS_CLEARANCE);
        offset.x = MathUtils.lerp(offset.x, clear, passing);
        lean += side * 0.5 * passing;
      }
    }
    enemy.mesh.position.copy(offsetFromRail(curve, paced.anchorU, offset));
    orientAlongRail(enemy.mesh, curve, paced.anchorU, lean, steer);
    if (enemy.kind === 'flyer') enemy.mesh.rotateX(-0.5 + Math.cos(t * Math.PI) * 0.34);

    return runTime > paced.passTime + PURSE_TUNING.enemies.missGraceSeconds;
  }

  /** A hauler that gets inside harassing range kicks one spike cluster loose. */
  function harass(context: PurseUpdate, anchorU: number, data: RiderData) {
    const state = context.enemyState<{ dropped: boolean }>(() => ({ dropped: false }));
    if (state.dropped || context.age < 0.8) return;
    if (context.enemy.mesh.position.distanceTo(context.camera.position) > HAULER_HARASS_DISTANCE) return;
    state.dropped = true;
    const spike: SpikeData = {
      role: 'spike',
      anchorU: anchorU - 2 / context.curve.getLength(),
      lane: data.laneX * 0.65,
      drift: data.side * 1.1,
    };
    context.spawnEnemy({ time: context.runTime, kind: 'spike', countsTowardTotal: false, data: spike });
  }

  /** A lobbed satchel bomb: thrown high, then it noses over and comes for you. */
  function updateBomb(context: PurseUpdate, data: BombData) {
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
      config: { hitDistance: 3.0, impactBrake: 0.4, damageDistance: 0.9 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      enemy.mesh.userData.armed = 1;
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Gravity for the first beat of flight so the throw reads as a lob; then
    // the fuse catches and it homes on the windscreen.
    if (age < 0.55) data.velocity.y -= 9.2 * dt;
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 8,
      maxSpeed: 22,
      accel: 7,
      turnRate: age < 0.55 ? 0.4 : 2.0,
    });

    enemy.mesh.position.copy(data.position);
    enemy.mesh.rotateZ(dt * (3.4 + data.spin * 0.05));
    enemy.mesh.rotateX(dt * 2.6);
    enemy.mesh.userData.armed = MathUtils.clamp((age - 0.4) / 1.4, 0, 1);
    return shotBehindCamera(camera, data.position) || age > BOMB_MAX_AGE;
  }

  /**
   * Spike clusters are nailed to the tarmac: they do not chase you, the road
   * delivers them. Shoot them, or your buddy eats them.
   */
  function updateSpike(context: PurseUpdate, data: SpikeData) {
    const { enemy, age, runProgress, curve, camera, damagePlayer } = context;
    const skitter = Math.sin(age * 7.5 + data.lane) * 0.28;
    offset.set(data.lane + data.drift * Math.min(1, age * 0.5) + skitter, DECK + 0.34, 0);
    enemy.mesh.position.copy(offsetFromRail(curve, data.anchorU, offset));
    orientAlongRail(enemy.mesh, curve, data.anchorU, 0, age * 2.4);
    const distance = enemy.mesh.position.distanceTo(camera.position);
    enemy.mesh.userData.proximity = MathUtils.clamp(1 - distance / 26, 0, 1);

    if (distance < 2.6) {
      damagePlayer(1);
      return true;
    }
    return runProgress > data.anchorU + 0.0004;
  }

  return {
    duration: PURSE_RUN_DURATION,
    bpm: PURSE_BPM,
    playerHealth: PURSE_PLAYER_HEALTH,
    createRail: createPursePursuitRail,
    spawnTimeline: timeline,
    easeRunProgress: purseRunProgress,
    // At 33 m/s a bar-long shot grid strands impacts behind the car; cap the
    // coarse grid near an eighth note so volleys still land on the beat.
    timing: { shotDelay: { maxGridSeconds: 0.62, gridRampGapGrowthThirtyseconds: 1 } },
    lockRadiusNdc: 0.095,
    startWord: 'FLOOR!',
    replayWord: 'AGAIN!',

    /**
     * The car leans into the lane changes. This runs before the engine's
     * edge-look, so sweeping the reticle rides on top of the body roll instead
     * of fighting it.
     */
    updateCameraEffects({ camera, curve, runProgress, runTime }) {
      const tangent = curve.getTangentAt(MathUtils.clamp(runProgress, 0, 1));
      const bank = MathUtils.degToRad(PURSE_TUNING.rail.bankDegrees) * MathUtils.clamp(-tangent.x * 2.6, -1, 1);
      // A slow two-bar weave on top of the geometry: your buddy is working.
      const weave = Math.sin(runTime * ((Math.PI * 2) / (T.barSeconds * 4))) * 0.6;
      camera.rotateZ(bank + MathUtils.degToRad(PURSE_TUNING.camera.swayDegrees) * weave);
    },

    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'rider':
          return updateRider(context, data);
        case 'bomb':
          return updateBomb(context, data);
        case 'spike':
          return updateSpike(context, data);
        case 'boss':
          return boss.update(context);
      }
    },

    scoreForKill(volleySize, enemy) {
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.14));
    },
    // Chipping the boss's chrome pays, so a long fight is never a dead score.
    scoreForHit: (_volleySize, enemy) => (enemy.kind === 'boss' ? 90 : 40),
    // A full six-lock volley that clears is the level's signature moment.
    scoreForVolley(results) {
      if (results.length < 6 || results.some((result) => !result.killed)) return 0;
      return 900;
    },

    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (!boss.purseRecovered) return clearRate >= 0.6 ? 'C' : 'D';
      // S needs disciplined six-lock volleys, not just a clean sheet: the
      // headless perfect policy clears 98% and still only reaches A.
      if (score >= 21000 && clearRate >= 0.9) return 'S';
      if (score >= 15500 && clearRate >= 0.75) return 'A';
      if (score >= 10500 && clearRate >= 0.55) return 'B';
      return 'C';
    },

    detailsForRun() {
      const lines = [
        `Bodywork ${Math.max(0, PURSE_PLAYER_HEALTH - hitsTaken)}/${PURSE_PLAYER_HEALTH}`,
        boss.summary(),
      ];
      if (cleanSixes > 0) lines.push(`${cleanSixes}× clean six`);
      return lines;
    },
  };
}
