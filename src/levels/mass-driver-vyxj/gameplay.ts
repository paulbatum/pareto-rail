import { CatmullRomCurve3, MathUtils, Matrix4, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { createSpeedProfile } from '../../engine/speed-profile';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  BEAT_SECONDS,
  FIRE_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  bar,
} from './timing';

// MASS DRIVER — riding a payload down an orbital railgun, 32 bars at 128 BPM
// (60 seconds exactly). The barrel is a tunnel of accelerator rings and the
// payload crosses one ring on every beat: the speed and the music are the
// same thing. The rings space out as the launch accelerates but the crossing
// stays on the beat by construction — ring k sits at the rail progress the
// speed profile reaches at beat k.
//
//   Injection (bars 0–4)   breech crawl; the hum wakes; first drones.
//   Stage 1   (4–12)       first accelerator stage kicks on the drop.
//   Stage 2   (12–20)      violet heat; dense defense-drone traffic.
//   Alarm     (20–24)      the safety interlocks jam; the charge builds.
//   Charge    (24–30)      clear all six interlocks before the charge peaks.
//   Muzzle    (30–32)      the gun fires; open space; silence.
//
// Fail the interlocks and the charge has nowhere to go: the barrel blows
// with the player in it.

export { FIRE_TIME, MASS_DRIVER_BPM, MASS_DRIVER_DURATION } from './timing';

export const MASS_DRIVER_PLAYER_HEALTH = 3;
export const TUNNEL_RADIUS = 11;
export const COLLAR_RADIUS = 7.4;
export const INTERLOCK_COUNT = 6;

/** Clock angles (radians) of the barrel's six conduit rails; sliders ride these. */
export const RAIL_ANGLES = [30, 90, 150, 210, 270, 330].map((degrees) => MathUtils.degToRad(degrees));

export type MassDriverEnemyKind = 'weaver' | 'slider' | 'sentinel' | 'bolt' | 'interlock';

// Timeline data is immutable across runs; per-enemy mutable state lives in
// the runner's enemyState bags and dynamically spawned bolts get fresh data.
export type MassDriverSpawnData =
  | { role: 'weaver'; engagement: RailLead; angle0: number; angleVel: number; radius: number; wobble: number; wobbleFreq: number }
  | { role: 'slider'; engagement: RailLead; angle: number; surge: number; surgePhase: number }
  | { role: 'sentinel'; engagement: RailLead; angle: number; radius: number; drift: number; firstShotAt: number; shotEvery: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; socket: number };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// ---- speed profile → rail easing --------------------------------------------

// Monotonic acceleration with a kick at each stage drop; the firing at bar 30
// is the one violent discontinuity the whole run has been charging toward.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.42],
  [bar(3.75), 0.56],
  [bar(4.2), 1.0], // stage 1 drop
  [bar(11.6), 1.16],
  [bar(12.2), 1.64], // stage 2 drop
  [bar(19.6), 1.8],
  [bar(21), 1.62], // alarm: power diverted into the charge
  [bar(24), 1.88],
  [bar(29.9), 2.35],
  [bar(30.25), 4.9], // THE FIRING
  [bar(32), 4.5],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => massDriverRunProgress(time);

/** Rail progress of accelerator ring `k` — the camera crosses it exactly on beat `k`. */
export const ringU = (beatIndex: number) => massDriverRunProgress(beatIndex * BEAT_SECONDS);

// ---- rail --------------------------------------------------------------------

// A railgun barrel: nearly straight, with long gentle flexes so the tunnel
// geometry sweeps instead of sitting static in frame. Past the muzzle the
// path rises slightly — launched out over the planet's limb.
export function createMassDriverRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(4, -2, -260),
      new Vector3(9, 1, -520),
      new Vector3(2, 4, -790),
      new Vector3(-7, 1, -1060),
      new Vector3(-10, -3, -1330),
      new Vector3(-4, -5, -1600),
      new Vector3(5, -2, -1870),
      new Vector3(10, 2, -2140),
      new Vector3(5, 5, -2410),
      new Vector3(-2, 3, -2680),
      new Vector3(-3, 2, -2950),
      new Vector3(0, 6, -3250),
      new Vector3(4, 14, -3550),
    ],
    false,
    'catmullrom',
    0.32,
  );
}

/** Rail progress of the muzzle: where the barrel ends and space begins. */
export const MUZZLE_U = massDriverRunProgress(FIRE_TIME);

// ---- rail pacing ---------------------------------------------------------------

// The barrel is fast (top speed ~150 u/s at the firing); fixed anchors would
// spawn beyond the fog. The pacer keeps authored leads meaning "seconds on
// screen" and compresses approach distance to the visibility budget.
const SPAWN_AHEAD_UNITS = 70;
const MISS_GRACE = 0.35;

const pacer = createRailPacer({
  curve: createMassDriverRail(),
  duration: MASS_DRIVER_DURATION,
  runProgress: massDriverRunProgress,
  spawnAheadUnits: SPAWN_AHEAD_UNITS,
  defaultLeadSeconds: 4.0,
});

// ---- spawn timeline --------------------------------------------------------------

type WeaverWaveOptions = {
  anglesDeg: number[];
  angleVel: number;
  radius: number;
  lead: number;
  stagger?: number;
  wobble?: number;
};

const weavers = (time: number, options: WeaverWaveOptions): MassDriverSpawnEntry[] =>
  options.anglesDeg.map((degrees, index) => {
    const entryTime = time + index * (options.stagger ?? 0.14);
    return {
      time: entryTime,
      kind: 'weaver' as const,
      data: {
        role: 'weaver' as const,
        engagement: pacer.resolve(entryTime, options.lead),
        angle0: MathUtils.degToRad(degrees),
        angleVel: options.angleVel,
        radius: options.radius,
        wobble: options.wobble ?? 0.7,
        wobbleFreq: 1.7 + (index % 3) * 0.35,
      },
    };
  });

const sliders = (time: number, railIndexes: number[], lead: number, stagger = 0.234): MassDriverSpawnEntry[] =>
  railIndexes.map((railIndex, index) => {
    const entryTime = time + index * stagger;
    return {
      time: entryTime,
      kind: 'slider' as const,
      data: {
        role: 'slider' as const,
        engagement: pacer.resolve(entryTime, lead),
        angle: RAIL_ANGLES[railIndex % RAIL_ANGLES.length],
        surge: 5.5 + (index % 2) * 2,
        surgePhase: index * 1.9,
      },
    };
  });

const sentinels = (
  time: number,
  posts: Array<{ deg: number; radius?: number }>,
  lead: number,
  shotEvery = 3.2,
): MassDriverSpawnEntry[] =>
  posts.map((post, index) => {
    const entryTime = time + index * 0.3;
    return {
      time: entryTime,
      kind: 'sentinel' as const,
      hitPoints: 2,
      data: {
        role: 'sentinel' as const,
        engagement: pacer.resolve(entryTime, lead),
        angle: MathUtils.degToRad(post.deg),
        radius: post.radius ?? 8.2,
        drift: (index % 2 === 0 ? 1 : -1) * 0.22,
        firstShotAt: 1.5 + index * 0.4,
        shotEvery,
      },
    };
  });

function interlockEntries(time: number): MassDriverSpawnEntry[] {
  const entries: MassDriverSpawnEntry[] = [];
  for (let socket = 0; socket < INTERLOCK_COUNT; socket += 1) {
    entries.push({
      time: time + 0.12 + socket * 0.117,
      kind: 'interlock',
      hitStages: [1, 1],
      data: { role: 'interlock', socket },
    });
  }
  return entries;
}

function buildTimeline(): MassDriverSpawnEntry[] {
  return sortTimeline<MassDriverEnemyKind, MassDriverSpawnData>([
    // --- Injection: sparse top/bottom arcs teach the sweep among the coils.
    ...weavers(bar(1), { anglesDeg: [60, 90, 120], angleVel: 0.55, radius: 8.2, lead: 4.6 }),
    ...weavers(bar(2.5), { anglesDeg: [240, 270, 300], angleVel: -0.55, radius: 8.2, lead: 4.4 }),

    // --- Stage 1: the kick drops and the traffic starts wheeling.
    ...weavers(bar(4.1), { anglesDeg: [45, 135, 225, 315], angleVel: 0.85, radius: 8.6, lead: 4.2 }),
    ...sliders(bar(5.5), [3, 5], 3.4),
    ...weavers(bar(6.5), { anglesDeg: [0, 90, 180, 270], angleVel: -0.95, radius: 9.0, lead: 4.2 }),
    ...sentinels(bar(8), [{ deg: 90, radius: 7.8 }], 5.2),
    ...weavers(bar(8.25), { anglesDeg: [250, 290], angleVel: 0.7, radius: 8.4, lead: 4.0 }),
    ...sliders(bar(9.5), [2, 4, 0], 3.4, 0.23),
    // Spiral train: staggered spawns with a shared spin read as one moving helix.
    ...weavers(bar(10.5), { anglesDeg: [90, 227, 4, 141, 278], angleVel: 1.2, radius: 8.8, lead: 4.0, stagger: 0.234 }),

    // --- Stage 2: counter-rotating helices, armored sentinels, rail sleds.
    ...weavers(bar(12.1), { anglesDeg: [0, 120, 240], angleVel: 1.45, radius: 9.2, lead: 4.2, stagger: 0.117 }),
    ...weavers(bar(12.28), { anglesDeg: [60, 180, 300], angleVel: -1.45, radius: 9.2, lead: 4.2, stagger: 0.117 }),
    ...sentinels(bar(13.5), [{ deg: 200, radius: 8.6 }, { deg: 340, radius: 8.6 }], 5.0, 3.4),
    ...sliders(bar(14.5), [0, 3, 2, 5], 3.2, 0.117),
    ...weavers(bar(16), { anglesDeg: [30, 90, 150, 210, 270, 330], angleVel: 0.95, radius: 9.0, lead: 4.0, stagger: 0.117 }),
    ...sentinels(bar(17.5), [{ deg: 90, radius: 8.8 }], 4.6, 3.0),
    ...sliders(bar(17.75), [4, 3], 2.9),
    ...weavers(bar(18.5), { anglesDeg: [45, 135, 225, 315], angleVel: 1.9, radius: 8.6, lead: 3.6 }),

    // --- Alarm: the screen thins out; the jammed collar arrives.
    ...weavers(bar(21), { anglesDeg: [120, 270, 30], angleVel: 0.6, radius: 8.8, lead: 3.8, stagger: 0.234 }),
    ...interlockEntries(bar(22)),

    // --- Charge window: drones keep threading the coils while the collar burns.
    ...weavers(bar(24.6), { anglesDeg: [80, 200, 320], angleVel: 1.05, radius: 9.4, lead: 3.6 }),
    ...sliders(bar(26), [2, 5], 3.2),
    ...weavers(bar(27.5), { anglesDeg: [0, 120, 240], angleVel: -1.15, radius: 9.4, lead: 3.4 }),
    ...weavers(bar(28.25), { anglesDeg: [60, 300], angleVel: 1.3, radius: 9.2, lead: 3.0 }),

    // --- Muzzle: nothing. Open space, insane speed, silence.
  ]);
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = buildTimeline();

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  weaver: 100,
  slider: 160,
  sentinel: 260,
  bolt: 50,
  interlock: 500,
};

const BOLT_MAX_AGE = 9;

// Interlocks ride the charge collar pinned this far ahead of the payload
// (constant world distance; the collar is the jammed carriage the payload
// is chasing up the barrel).
const COLLAR_AHEAD_UNITS = 30;
const COLLAR_APPROACH_SECONDS = 2.6;

/** When the jammed charge collar arrives (bar 22). Visuals share this. */
export const COLLAR_TIME = bar(22);

// The collar (interlocks + the charge core visual) rides a fixed distance
// ahead of the payload; on arrival it eases in from the fog instead of
// popping. Shared with the visuals module, which drives the charge core —
// deliberately not a lockable enemy, so nothing baits the reticle onto an
// untargetable centerpiece.
export function collarAnchorU(runTime: number) {
  const approach = MathUtils.clamp((runTime - COLLAR_TIME) / COLLAR_APPROACH_SECONDS, 0, 1);
  const eased = approach * approach * (3 - 2 * approach);
  const extraU = ((SPAWN_AHEAD_UNITS - COLLAR_AHEAD_UNITS) / pacer.railLength) * (1 - eased);
  return MathUtils.clamp(massDriverRunProgress(runTime) + COLLAR_AHEAD_UNITS / pacer.railLength + extraU, 0, 1);
}

/** Charge build 0→1 between the collar's arrival and the firing. */
export function chargeProgress(runTime: number) {
  return MathUtils.clamp((runTime - COLLAR_TIME) / (FIRE_TIME - COLLAR_TIME), 0, 1);
}

const scratchBasis = new Matrix4();

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const interceptions = new Set<number>();
  const interlockIds = new Set<number>();
  let collarSummoned = false;
  let interlocksCleared = 0;
  let fired = false;
  let detonated = false;
  let hitsTaken = 0;
  let boltsShotDown = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    interlockIds.clear();
    collarSummoned = false;
    interlocksCleared = 0;
    fired = false;
    detonated = false;
    hitsTaken = 0;
    boltsShotDown = 0;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'interlock') return;
    interlockIds.add(enemyId);
    if (!collarSummoned) {
      collarSummoned = true;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (interlockIds.delete(enemyId)) {
      interlocksCleared += 1;
      if (interlockIds.size === 0) {
        // All six clear before the peak: the gun can fire safely.
        fired = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
  });

  bus.on('runend', () => {
    if (fired) bus.emit('bossphase', { phase: 'destroyed' });
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    interlockIds.delete(enemyId);
  });

  function fireBolt(context: MassDriverUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement --------------------------------------------------------------

  function paced(context: MassDriverUpdate, engagement: RailLead) {
    return pacer.sample(context.enemy.entry.time, context.runTime, engagement).anchorU;
  }

  function passedBy(context: MassDriverUpdate, engagement: RailLead) {
    return context.runTime > engagement.passTime + MISS_GRACE;
  }

  // Wall-riders at full tunnel radius leave the lock frustum well before the
  // camera overtakes them. In the last stretch of their window they peel off
  // the wall toward the ring aperture — threading between the coils — which
  // keeps them lockable through the authored lead.
  function apertureDive(runTime: number, engagement: RailLead) {
    const remaining = MathUtils.clamp((engagement.passTime - runTime) / 2.3, 0, 1);
    const eased = remaining * remaining * (3 - 2 * remaining);
    return MathUtils.lerp(0.5, 1, eased);
  }

  function updateWeaver(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'weaver' }>) {
    const { enemy, age, curve, camera } = context;
    const anchorU = paced(context, data.engagement);
    const angle = data.angle0 + data.angleVel * age;
    const radius = (data.radius + Math.sin(age * data.wobbleFreq + data.angle0) * data.wobble) * apertureDive(context.runTime, data.engagement);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // The whole drone leans into its orbit; the blade disc spin lives in visuals.
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    return passedBy(context, data.engagement);
  }

  function updateSlider(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'slider' }>) {
    const { enemy, age, curve } = context;
    const anchorU = paced(context, data.engagement);
    // The sled releases its pantograph and lunges off the wall as it is
    // overtaken; the longitudinal surging settles as it commits to the lunge.
    const dive = apertureDive(context.runTime, data.engagement);
    const surgeZ = Math.sin(age * 1.6 + data.surgePhase) * data.surge * dive;
    const wallRadius = (TUNNEL_RADIUS - 1.15) * dive;
    const frame = sampleRailFrame(curve, anchorU);
    enemy.mesh.position
      .copy(frame.position)
      .addScaledVector(frame.right, Math.cos(data.angle) * wallRadius)
      .addScaledVector(frame.up, Math.sin(data.angle) * wallRadius)
      .addScaledVector(frame.tangent, surgeZ);
    // Belly to the wall, nose down the barrel: basis from the rail frame,
    // rolled so local -y points outward at this clock angle.
    scratchBasis.makeBasis(frame.right, frame.up, frame.tangent);
    enemy.mesh.quaternion.setFromRotationMatrix(scratchBasis);
    enemy.mesh.rotateZ(data.angle + Math.PI / 2);
    return passedBy(context, data.engagement);
  }

  function updateSentinel(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'sentinel' }>) {
    const { enemy, age, curve, camera, runTime } = context;
    const anchorU = paced(context, data.engagement);
    const angle = data.angle + data.drift * age;
    const radius = data.radius * apertureDive(runTime, data.engagement);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.9) * 0.2);

    // Telegraphed arc shot: the core visibly overcharges before it looses.
    const state = context.enemyState(() => ({ nextAt: data.firstShotAt }));
    const canFire = runTime < data.engagement.passTime - 1.2;
    enemy.mesh.userData.chargeT = canFire ? MathUtils.clamp(1 - (state.nextAt - age) / 0.9, 0, 1) : 0;
    if (canFire && age >= state.nextAt) {
      state.nextAt = age + data.shotEvery;
      fireBolt(context, enemy.mesh.position);
    }
    return passedBy(context, data.engagement);
  }

  function updateBolt(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
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
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 11);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 7,
      maxSpeed: 17,
      accel: 4.2,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 11);
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, age, runTime, curve, damagePlayer } = context;

    if (runTime >= FIRE_TIME) {
      // The charge peaks with this interlock still jammed: nowhere to go.
      // The barrel blows with the payload in it. Keep pressing until the
      // damage lands — a post-hit invulnerability window may hold it off
      // for a beat, but the detonation is not dodgeable.
      detonated = true;
      damagePlayer(99);
      return false;
    }

    const anchorU = collarAnchorU(runTime);
    const angle = Math.PI / 2 + (data.socket / INTERLOCK_COUNT) * Math.PI * 2;
    const chargeT = chargeProgress(runTime);
    // Jam shudder: the clamps rattle harder as the charge climbs; a cracked
    // casing (stage 2) rattles harder still.
    const jitter = (0.04 + chargeT * 0.1) * (enemy.hitStageIndex > 0 ? 2.2 : 1);
    const offset = new Vector3(
      Math.cos(angle) * COLLAR_RADIUS + Math.sin(age * 31 + data.socket * 2.4) * jitter,
      Math.sin(angle) * COLLAR_RADIUS + Math.cos(age * 27 + data.socket * 1.7) * jitter,
      Math.sin(age * 1.3 + data.socket) * 0.3,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    const frame = sampleRailFrame(curve, anchorU);
    scratchBasis.makeBasis(frame.right, frame.up, frame.tangent);
    enemy.mesh.quaternion.setFromRotationMatrix(scratchBasis);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.userData.chargeT = chargeT;
    return false;
  }

  // ---- level definition --------------------------------------------------------

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    // At barrel speeds a near-bar snap strands impacts behind the payload;
    // cap the coarsest grid at a half bar and fan volleys out gently.
    timing: { shotDelay: { maxGridSeconds: 0.9375, gridRampGapGrowthThirtyseconds: 1 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'weaver':
          return updateWeaver(context, data);
        case 'slider':
          return updateSlider(context, data);
        case 'sentinel':
          return updateSentinel(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'interlock':
          return updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsShotDown += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Cracking an interlock casing or a sentinel's armor pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (fired && score >= 12000 && clearRate >= 0.85) return 'S';
      if (score >= 9000 && clearRate >= 0.6) return 'A';
      if (score >= 6000 && clearRate >= 0.4) return 'B';
      if (score >= 2500 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`];
      if (collarSummoned) lines.push(`Interlocks cleared ${interlocksCleared}/${INTERLOCK_COUNT}`);
      if (fired) lines.push('Payload away at muzzle velocity');
      else if (detonated) lines.push('The barrel blew with you in it');
      if (boltsShotDown > 0) lines.push(`${boltsShotDown} arc bolt${boltsShotDown === 1 ? '' : 's'} shot down`);
      return lines;
    },
  };
}
