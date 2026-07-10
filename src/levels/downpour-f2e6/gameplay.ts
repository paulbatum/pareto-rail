import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  bar,
  CITADEL_TIME,
  DOWNPOUR_BAR,
  DOWNPOUR_BPM,
  DOWNPOUR_DURATION,
  DOWNPOUR_TIME,
  OUTRO_TIME,
} from './timing';

// DOWNPOUR — a 60-second hunted flight through a rain-lashed neon megacity,
// scored to a 176 BPM drum & bass arrangement, 44 bars = exactly 60 seconds:
//
//   Storm     (0–5.5s)    Above the storm ceiling. Sparse weather, no fight yet.
//   Plunge    (5.5–16.4s) DROP 1 — dive down the tower faces. Lightning cracks.
//   Avenue    (16.4–24.5s) Street-level canyon run, rolling breaks, signage.
//   Undercity (24.5–32.7s) DROP 2 — plunge into the tube. Ribs strobe past.
//   Canal     (32.7–40.9s) Flooded canal, half-time menace, the gunship arrives.
//   Citadel   (40.9–54.5s) Climb the security citadel. The hunt, full tempo.
//   Outro     (54.5–60s)   Break above the clouds. Near-silent moonlit release.
//
// The rail rides a variable speed profile — two acceleration spikes land on
// the drops, the canal eases into half-time dread, and the citadel surges
// into the chase before the outro lets go.

export { DOWNPOUR_BPM, DOWNPOUR_DURATION, bar } from './timing';
export const DOWNPOUR_PLAYER_HEALTH = 3;

export type DownpourEnemyKind = 'interceptor' | 'sentry' | 'trawler' | 'bolt' | 'gunship';

export type DownpourSpawnData =
  | { role: 'interceptor'; lead: number; offset: Vector3; weaveSpeed: number; weaveAmp: number; spin: number }
  | { role: 'sentry'; lead: number; offset: Vector3; seed: number; fireInterval: number }
  | { role: 'trawler'; lead: number; fromX: number; toX: number; y: number; arc: number; crossTime: number; delay: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'gunship' };

export type DownpourSpawnEntry = LockOnSpawnEntry<DownpourEnemyKind, DownpourSpawnData>;
export type DownpourUpdate = LockOnEnemyUpdate<DownpourEnemyKind, DownpourSpawnData>;

// ---- speed profile -> rail easing ------------------------------------------

const SPEED_KEYS: Array<[number, number]> = [
  [DOWNPOUR_TIME.bar(0), 0.6],
  [DOWNPOUR_TIME.bar(3.5), 0.78],
  [DOWNPOUR_TIME.bar(4), 1.95], // drop 1: the plunge past the tower faces
  [DOWNPOUR_TIME.bar(6), 1.2],
  [DOWNPOUR_TIME.bar(12), 1.05],
  [DOWNPOUR_TIME.bar(17.5), 0.82],
  [DOWNPOUR_TIME.bar(18), 2.05], // drop 2: the undercity plunge
  [DOWNPOUR_TIME.bar(20), 1.22],
  [DOWNPOUR_TIME.bar(24), 0.72], // canal: half-time menace
  [DOWNPOUR_TIME.bar(29), 0.68],
  [DOWNPOUR_TIME.bar(30), 1.15], // citadel base, climb begins
  [DOWNPOUR_TIME.bar(34), 1.4],
  [DOWNPOUR_TIME.bar(38), 1.55], // the hunt, near its peak
  [DOWNPOUR_TIME.bar(40), 0.85], // breaking through the cloud layer
  [DOWNPOUR_TIME.bar(44), 0.5], // moonlit release
];

const speedProfile = createSpeedProfile(SPEED_KEYS, DOWNPOUR_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function downpourRunProgress(time: number, duration = DOWNPOUR_DURATION) {
  return speedProfile.runProgress(time, duration);
}

export const railU = (time: number) => downpourRunProgress(time);

// ---- rail -------------------------------------------------------------------

// Storm ceiling -> tower-face dive -> avenue canyons -> tube plunge ->
// flooded canal -> citadel climb -> above the clouds. y tracks altitude;
// the run ends higher than it starts, breaking free of the storm.
export function createDownpourRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 120, 0),
      new Vector3(4, 112, -50),
      new Vector3(-6, 78, -120),
      new Vector3(9, 38, -200),
      new Vector3(-5, 14, -290),
      new Vector3(12, 11, -380),
      new Vector3(-14, 9, -470),
      new Vector3(5, 7, -560),
      new Vector3(-9, 4, -640),
      new Vector3(0, -22, -710),
      new Vector3(7, -48, -780),
      new Vector3(-9, -60, -850),
      new Vector3(11, -64, -940),
      new Vector3(-7, -62, -1030),
      new Vector3(0, -52, -1110),
      new Vector3(9, -14, -1190),
      new Vector3(-5, 55, -1260),
      new Vector3(7, 125, -1330),
      new Vector3(-3, 175, -1400),
      new Vector3(0, 210, -1470),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// ---- spawn timeline -----------------------------------------------------------

const interceptors = (
  time: number,
  lead: number,
  spin: number,
  offsets: Array<[number, number]>,
): DownpourSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.11,
    kind: 'interceptor',
    data: {
      role: 'interceptor',
      lead,
      spin,
      offset: new Vector3(offset[0], offset[1], 0),
      weaveSpeed: 2.6 + (index % 3) * 0.5,
      weaveAmp: 1.1 + (index % 2) * 0.5,
    },
  }));

const sentries = (time: number, lead: number, offsets: Array<[number, number]>): DownpourSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.2,
    kind: 'sentry',
    data: {
      role: 'sentry',
      lead,
      seed: index * 3.1 + time,
      fireInterval: 1.7 + (index % 2) * 0.4,
      offset: new Vector3(offset[0], offset[1], 0),
    },
  }));

const trawlers = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc?: number; delay?: number; crossTime?: number }>,
): DownpourSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.14,
    kind: 'trawler',
    data: {
      role: 'trawler',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc ?? 0.6,
      delay: run.delay ?? index * 0.32,
      crossTime: run.crossTime ?? 2.2,
    },
  }));

function buildDownpourTimeline(): DownpourSpawnEntry[] {
  return [
    // --- Storm: sparse weather above the towers, no fight yet.

    // --- Plunge (drop 1): dive past the tower faces, first formations.
    ...interceptors(bar(4.5), 3.6, 0.6, [[-4, 1.5], [0, 2.4], [4, 1.5]]),
    ...interceptors(bar(6.2), 3.5, -0.5, [[-5.5, 0], [-1.8, 2], [1.8, 2], [5.5, 0]]),
    ...sentries(bar(7.5), 4.4, [[-8, -1], [8, -1]]),
    ...interceptors(bar(9), 3.6, 0.55, [[-6, 1.2], [-2, 3], [2, 3], [6, 1.2]]),
    ...sentries(bar(10.2), 4.2, [[0, -2]]),
    ...interceptors(bar(10.8), 3.4, 0.7, [[-3, 0.5], [3, 0.5]]),

    // (bars 11.5–12: screen clear for the avenue transition)

    // --- Avenue: canyon walls, denser two-bar cadence.
    ...interceptors(bar(12.5), 3.5, 0.5, [[-7, 2], [-3.5, 3.4], [0, 4], [3.5, 3.4], [7, 2]]),
    ...sentries(bar(14), 4.5, [[-9, -0.5], [9, -0.5]]),
    ...interceptors(bar(15), 3.4, -0.6, [[-6, 0], [-2, 1.6], [2, 1.6], [6, 0]]),
    ...sentries(bar(16.2), 4.2, [[0, -1.5]]),
    ...interceptors(bar(16.8), 3.5, 0.65, [[-4, 2], [0, 3], [4, 2]]),

    // (bars 17.5–18: screen clear for the undercity plunge)

    // --- Undercity (drop 2): the tube, ribs strobing, tighter offsets.
    ...interceptors(bar(18.5), 3.2, 0.75, [[-3.5, 1], [0, 2], [3.5, 1]]),
    ...sentries(bar(20), 4, [[-6, -1], [6, -1], [0, 2.5]]),
    ...interceptors(bar(21.5), 3.3, -0.6, [[-4.5, 0.5], [-1.5, 2], [1.5, 2], [4.5, 0.5]]),
    ...trawlers(bar(23), 3.6, [
      { fromX: -9, toX: 9, y: -1, crossTime: 2 },
      { fromX: 9, toX: -9, y: 0.5, crossTime: 2.1 },
    ]),

    // --- Canal: half-time menace, water skimmers, banked sentries.
    ...trawlers(bar(24.5), 3.7, [
      { fromX: -10, toX: 10, y: -0.5, crossTime: 2.4 },
      { fromX: 10, toX: -10, y: 1, crossTime: 2.4 },
      { fromX: -10, toX: 10, y: 0, crossTime: 2.4 },
    ]),
    ...sentries(bar(26), 4.6, [[-8, 1], [8, 1]]),
    ...trawlers(bar(27.5), 3.6, [
      { fromX: 9, toX: -9, y: -0.5, crossTime: 2.2 },
      { fromX: -9, toX: 9, y: 1, crossTime: 2.2 },
    ]),
    ...interceptors(bar(28.2), 3.4, 0.5, [[-3, 2], [3, 2]]),

    // (bars 29–30: screen clear before the citadel climb)

    // --- Citadel: the climb, the hunt, the gunship.
    ...interceptors(bar(30.5), 3.6, 0.6, [[-5, 1.5], [0, 2.5], [5, 1.5]]),
    ...sentries(bar(32), 4.4, [[-8, -1], [8, -1]]),
    ...interceptors(bar(34), 3.5, -0.55, [[-4, 0.5], [-1.3, 2], [1.3, 2], [4, 0.5]]),
    ...sentries(bar(36), 4.2, [[-7, 1.5], [7, 1.5]]),
    ...interceptors(bar(38), 3.4, 0.65, [[-3, 1], [3, 1]]),

    // --- Outro: no new spawns. The gunship falls back into the clouds.
  ].sort((a, b) => a.time - b.time);
}

export const DOWNPOUR_TIMELINE: DownpourSpawnEntry[] = buildDownpourTimeline();

const KILL_SCORE: Record<DownpourEnemyKind, number> = {
  interceptor: 90,
  sentry: 150,
  trawler: 120,
  bolt: 35,
  gunship: 2200,
};

const BOLT_MAX_AGE = 9;
const GUNSHIP_ENTRY: DownpourSpawnEntry = {
  time: CITADEL_TIME,
  kind: 'gunship',
  hitStages: [2, 2, 2],
  data: { role: 'gunship' },
};
DOWNPOUR_TIMELINE.push(GUNSHIP_ENTRY);
DOWNPOUR_TIMELINE.sort((a, b) => a.time - b.time);

export function createDownpourGameplay(bus: EventBus): LockOnRunnerLevel<DownpourEnemyKind, DownpourSpawnData> {
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let gunshipKilled = false;
  let gunshipStagesCleared = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    gunshipKilled = false;
    gunshipStagesCleared = 0;
    GUNSHIP_ENTRY.lockable = true;
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

  bus.on('stage', ({ enemyId }) => {
    if (enemyId === gunshipId) gunshipStagesCleared += 1;
  });

  let gunshipId = -1;
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'gunship') gunshipId = enemyId;
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (enemyId === gunshipId) gunshipKilled = true;
  });

  function fireBolt(context: DownpourUpdate, from: Vector3, aimJitterX = 0) {
    const aim = hostileShotAimPoint(context.camera, from);
    aim.x += aimJitterX;
    const initial = aim.sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement -------------------------------------------------------------

  function updateInterceptor(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'interceptor' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const weave = Math.sin(age * data.weaveSpeed + enemy.id) * data.weaveAmp;
    const bob = Math.sin(age * 1.6 + enemy.id * 1.7) * 0.35;
    const x = data.offset.x + weave;
    const y = data.offset.y + bob;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.cos(age * data.weaveSpeed + enemy.id) * 0.55 + age * data.spin);
    enemy.mesh.rotateX(Math.sin(age * 2.1 + enemy.id) * 0.18);
    return runProgress > anchorU + 0.014;
  }

  function updateSentry(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'sentry' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.7 + data.seed) * 0.5;

    const fire = context.enemyState(() => ({ nextAt: 1.1 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + data.fireInterval;
      fireBolt(context, enemy.mesh.position);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 1.3 + data.seed) * 0.12);
    return runProgress > anchorU + 0.014;
  }

  function updateTrawler(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'trawler' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 9) * 0.06;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 2.4 + enemy.id) * 0.3)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.04)),
      data.y + Math.sin(Math.min(1, clamped + 0.04) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(Math.sin(age * 5 + enemy.id) * 0.2);
    return false;
  }

  function updateBolt(context: DownpourUpdate, data: Extract<DownpourSpawnData, { role: 'bolt' }>) {
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
      enemy.mesh.rotateZ(age * 10);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 13,
      accel: 3.6,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    orientAlongVelocity(enemy.mesh.position, data.velocity, context);
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateGunship(context: DownpourUpdate) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + 0.0035, 0, 1));
    const stage = enemy.hitStageIndex;

    const weaveX = Math.sin(runTime * 0.5) * 6 + Math.sin(runTime * 1.3 + 1) * 2.2;
    const weaveY = 3.5 + Math.sin(runTime * 0.65) * 2 + stage * 0.4;
    let tangentOffset = 32 - stage * 2.5;

    const fadingOut = runTime >= OUTRO_TIME;
    if (fadingOut) {
      const t = MathUtils.clamp((runTime - OUTRO_TIME) / 3, 0, 1);
      tangentOffset += t * 110;
      GUNSHIP_ENTRY.lockable = false;
      enemy.mesh.userData.fadeOut = t;
    } else {
      enemy.mesh.userData.fadeOut = 0;
    }

    enemy.mesh.position
      .copy(frame.position)
      .addScaledVector(frame.right, weaveX)
      .addScaledVector(frame.up, weaveY)
      .addScaledVector(frame.tangent, tangentOffset);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.7) * 0.12);
    enemy.mesh.userData.stage = stage;

    if (!fadingOut && age > 1.2) {
      const fire = context.enemyState(() => ({ nextAt: age + 1.7 }));
      if (age >= fire.nextAt) {
        const interval = stage === 0 ? 2.0 : stage === 1 ? 1.35 : 0.85;
        fire.nextAt = age + interval;
        const spread = stage === 2 ? [-3, 0, 3] : stage === 1 ? [-2, 2] : [0];
        for (const dx of spread) fireBolt(context, enemy.mesh.position.clone(), dx);
      }
    }

    return false;
  }

  function orientAlongVelocity(position: Vector3, velocity: Vector3, context: DownpourUpdate) {
    if (velocity.lengthSq() < 0.001) return;
    const target = position.clone().add(velocity);
    context.enemy.mesh.lookAt(target);
  }

  return {
    duration: DOWNPOUR_DURATION,
    bpm: DOWNPOUR_BPM,
    playerHealth: DOWNPOUR_PLAYER_HEALTH,
    createRail: createDownpourRail,
    spawnTimeline: DOWNPOUR_TIMELINE,
    easeRunProgress: downpourRunProgress,
    startWord: 'LAUNCH',
    timing: {
      shotDelay: { maxGridSeconds: DOWNPOUR_BAR },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'interceptor':
          return updateInterceptor(context, data);
        case 'sentry':
          return updateSentry(context, data);
        case 'trawler':
          return updateTrawler(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'gunship':
          return updateGunship(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 55,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 480 : results.length * 55;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (gunshipKilled && score >= 9500 && clearRate >= 0.75) return 'S';
      if (score >= 6500 && clearRate >= 0.6) return 'A';
      if (score >= 4000 && clearRate >= 0.42) return 'B';
      if (score >= 1800 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, DOWNPOUR_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${DOWNPOUR_PLAYER_HEALTH}`];
      lines.push(gunshipKilled ? 'The gunship went down' : gunshipStagesCleared > 0 ? 'The gunship broke off, wounded' : 'The gunship broke off pursuit');
      return lines;
    },
  };
}
