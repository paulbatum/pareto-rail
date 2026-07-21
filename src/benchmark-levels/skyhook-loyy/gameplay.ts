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
import type { EventBus } from '../../events';
import { createCrawler, createCrawlerEntries } from './boss';
import {
  SKYHOOK_LOYY_BPM,
  SKYHOOK_LOYY_MARKERS,
  SKYHOOK_LOYY_RUN_DURATION,
  SKYHOOK_LOYY_TIME,
  skyhookBar,
} from './timing';

export { SKYHOOK_LOYY_BPM, SKYHOOK_LOYY_MARKERS, SKYHOOK_LOYY_RUN_DURATION, SKYHOOK_LOYY_TIME } from './timing';

export const SKYHOOK_LOYY_PLAYER_HEALTH = 6;

export type SkyhookEnemyKind = 'kite' | 'skimmer' | 'raider' | 'saboteur' | 'shard' | 'claw' | 'crawler';

export type SkyhookSpawnData =
  | { role: 'kite'; lead: number; lane: number; phase: number; gust: number }
  | { role: 'skimmer'; lead: number; fromX: number; toX: number; y: number; delay: number; crossTime: number }
  | { role: 'raider'; lead: number; angle: number; radius: number; fireAt: number }
  | { role: 'saboteur'; lead: number; x: number; y: number; diveTime: number }
  | { role: 'shard'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'claw'; socket: number }
  | { role: 'crawler' };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

export function createSkyhookRail() {
  // A mostly vertical climb with long, deliberate bends. Looking along this
  // curve keeps "up" ahead while the offset planet remains below the car.
  return new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(-5, 70, -18),
    new Vector3(10, 150, -44),
    new Vector3(-12, 240, -78),
    new Vector3(8, 340, -118),
    new Vector3(-7, 450, -160),
    new Vector3(6, 570, -206),
    new Vector3(-5, 700, -255),
    new Vector3(4, 840, -308),
    new Vector3(0, 1000, -365),
    new Vector3(0, 1160, -420),
  ], false, 'catmullrom', 0.32);
}

const kiteWave = (time: number, count: number, radius: number, gust: number): SkyhookSpawnEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    time: time + index * 0.13,
    kind: 'kite',
    data: {
      role: 'kite',
      lead: 2.7,
      lane: index - (count - 1) / 2,
      phase: index / count * Math.PI * 2,
      gust: radius * gust,
    },
  }));

const skimmerWave = (time: number, count: number, yBias = 0): SkyhookSpawnEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    time: time + index * 0.11,
    kind: 'skimmer',
    data: {
      role: 'skimmer',
      lead: 2.5,
      fromX: index % 2 === 0 ? -22 : 22,
      toX: index % 2 === 0 ? 22 : -22,
      y: yBias + (index - (count - 1) / 2) * 1.55,
      delay: index * 0.28,
      crossTime: 2.55,
    },
  }));

const raiderRing = (time: number, count: number, radius: number): SkyhookSpawnEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    time: time + index * 0.15,
    kind: 'raider',
    hitPoints: index === count - 1 ? 2 : 1,
    data: {
      role: 'raider',
      lead: 2.8,
      angle: index / count * Math.PI * 2,
      radius,
      fireAt: 1.7 + index * 0.22,
    },
  }));

const saboteurs = (time: number, offsets: Array<[number, number]>): SkyhookSpawnEntry[] =>
  offsets.map(([x, y], index) => ({
    time: time + index * 0.28,
    kind: 'saboteur',
    hitPoints: 2,
    data: { role: 'saboteur', lead: 3.05, x, y, diveTime: 5.4 + index * 0.25 },
  }));

function buildTimeline(bossEntries: SkyhookSpawnEntry[]): SkyhookSpawnEntry[] {
  return [
    // Storm: broad wind-riders teach long sweeps through rain.
    ...kiteWave(skyhookBar(1), 4, 4.8, 0.75),
    ...kiteWave(skyhookBar(2.25), 6, 6.6, 0.9),
    ...skimmerWave(skyhookBar(3.15), 4, -0.5),

    // Cloudbreak: sunlight, space to breathe, then the first car divers.
    ...kiteWave(skyhookBar(4.35), 6, 7.4, 0.7),
    ...skimmerWave(skyhookBar(5.7), 6, 1.5),
    ...saboteurs(skyhookBar(7.15), [[-7, 3], [7, 3]]),
    ...kiteWave(skyhookBar(8.15), 5, 8, 0.8),
    ...skimmerWave(skyhookBar(9.2), 6, -1.8),

    // Thin air: formations shed members as the arrangement loses layers.
    ...saboteurs(skyhookBar(10.1), [[0, 5], [-8, 0], [8, 0]]),
    ...raiderRing(skyhookBar(11.1), 5, 6.5),
    ...skimmerWave(skyhookBar(12.15), 4, 2),
    ...raiderRing(skyhookBar(13.1), 6, 8),

    // Vacuum: hard angular machines and a last coordinated attack on the car.
    ...raiderRing(skyhookBar(14.05), 6, 8.8),
    ...saboteurs(skyhookBar(14.9), [[-9, -1], [0, 5.5], [9, -1]]),
    ...raiderRing(skyhookBar(15.25), 4, 6.2),

    // Bars 16–22 belong to the crawler. Bars 22–24 are a clear docking lane.
    ...bossEntries,
  ].sort((a, b) => a.time - b.time);
}

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> {
  const { crawlerEntry, timeline: bossEntries } = createCrawlerEntries(SKYHOOK_LOYY_MARKERS.boss);
  const timeline = buildTimeline(bossEntries);
  const crawler = createCrawler(bus, { crawlerEntry });
  const intercepted = new Set<number>();
  let carHits = 0;
  let saboteursStopped = 0;
  let shardsStopped = 0;

  bus.on('runstart', () => {
    intercepted.clear();
    carHits = 0;
    saboteursStopped = 0;
    shardsStopped = 0;
  });
  bus.on('fire', ({ enemyId }) => intercepted.add(enemyId));
  bus.on('playerhit', () => { carHits += 1; });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    intercepted.delete(enemyId);
    void worldPosition;
  });
  bus.on('miss', ({ enemyId }) => intercepted.delete(enemyId));

  function spawnShard(context: SkyhookUpdate, from: Vector3) {
    const velocity = hostileShotAimPoint(context.camera, from, 1.2).sub(from).normalize().multiplyScalar(6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'shard',
      countsTowardTotal: false,
      data: { role: 'shard', position: from.clone(), velocity, lastAge: 0, impact: {} },
    });
  }

  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'kite' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const anchor = railAnchor(data.lead);
    const angle = data.phase + age * (0.75 + Math.abs(data.lane) * 0.05);
    const spread = 2.2 + Math.abs(data.lane) * 1.65;
    const offset = new Vector3(
      Math.sin(angle) * data.gust * 1.85 + data.lane * 2.65,
      Math.cos(angle * 0.72) * spread * 1.9,
      Math.sin(age * 1.8 + data.phase) * 1.2,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchor, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(-Math.sin(angle) * 0.7);
    enemy.mesh.rotateY(Math.cos(angle) * 0.35);
    return runProgress > anchor + 0.016;
  }

  function updateSkimmer(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'skimmer' }>) {
    const { enemy, age, runProgress, curve, railAnchor } = context;
    const anchor = railAnchor(data.lead);
    const t = MathUtils.clamp((age - data.delay) / data.crossTime, 0, 1);
    const ease = t * t * (3 - 2 * t);
    const x = MathUtils.lerp(data.fromX, data.toX, ease);
    const y = data.y + Math.sin(t * Math.PI) * 5.2;
    const here = offsetFromRail(curve, anchor, new Vector3(x, y, Math.sin(age * 4) * 0.5));
    const ahead = offsetFromRail(curve, anchor, new Vector3(MathUtils.lerp(data.fromX, data.toX, Math.min(1, ease + 0.035)), y, 0));
    enemy.mesh.position.copy(here);
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(age * 5);
    return t >= 1 && runProgress > anchor + 0.006;
  }

  function updateRaider(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'raider' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const anchor = railAnchor(data.lead);
    const angle = data.angle + age * 0.58;
    const offset = new Vector3(
      Math.cos(angle) * data.radius * 1.9,
      Math.sin(angle) * data.radius * 1.35,
      Math.sin(age * 0.9 + data.angle) * 2,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchor, offset));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(-angle * 0.45);

    const fire = context.enemyState(() => ({ fired: false }));
    const chargeWindow = 0.85;
    enemy.mesh.userData.fireCharge = fire.fired
      ? 0
      : MathUtils.clamp(1 - (data.fireAt - age) / chargeWindow, 0, 1);
    if (!fire.fired && age >= data.fireAt) {
      fire.fired = true;
      spawnShard(context, enemy.mesh.position);
    }
    return runProgress > anchor + 0.016;
  }

  function updateSaboteur(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'saboteur' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor, damagePlayer } = context;
    const anchor = railAnchor(data.lead);
    const dive = MathUtils.clamp(age / data.diveTime, 0, 1);
    const frame = sampleRailFrame(curve, runProgress);
    const staging = offsetFromRail(curve, anchor, new Vector3(data.x * 1.8, data.y * 1.55, 0));
    const carSocket = frame.position.clone()
      .addScaledVector(frame.right, Math.sign(data.x || 1) * 2.4)
      .addScaledVector(frame.up, -1.8)
      .addScaledVector(frame.tangent, 1.5);
    const swoop = dive * dive * (3 - 2 * dive);
    enemy.mesh.userData.dive = dive;
    enemy.mesh.position.copy(staging).lerp(carSocket, swoop);
    enemy.mesh.lookAt(carSocket);
    enemy.mesh.rotateZ(Math.sin(age * 4) * 0.25);
    if (dive >= 1) {
      damagePlayer(1);
      return true;
    }
    void camera;
    return false;
  }

  function updateShard(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'shard' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: intercepted.delete(enemy.id),
      config: { hitDistance: 2.8, impactBrake: 0.35, damageDistance: 0.8 },
    });
    if (impact.phase === 'braking') {
      const impactAt = data.impact.impactAt ?? age + 0.35;
      enemy.mesh.userData.impactBrake = MathUtils.clamp((age - (impactAt - 0.35)) / 0.35, 0, 1);
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 12);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    enemy.mesh.userData.impactBrake = 0;
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, 1.1), age, dt, {
      baseSpeed: 6.5,
      maxSpeed: 15,
      accel: 3.2,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > 11 || shotBehindCamera(camera, data.position);
  }

  const scoreByKind: Record<SkyhookEnemyKind, number> = {
    kite: 100,
    skimmer: 130,
    raider: 180,
    saboteur: 260,
    shard: 60,
    claw: 420,
    crawler: 2400,
  };

  return {
    duration: SKYHOOK_LOYY_RUN_DURATION,
    bpm: SKYHOOK_LOYY_BPM,
    playerHealth: SKYHOOK_LOYY_PLAYER_HEALTH,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    startWord: 'ASCEND',
    replayWord: 'AGAIN',
    lockRadiusNdc: 0.175,
    timing: {
      shotDelay: { maxGridSeconds: 0.72, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'kite': return updateKite(context, data);
        case 'skimmer': return updateSkimmer(context, data);
        case 'raider': return updateRaider(context, data);
        case 'saboteur': return updateSaboteur(context, data);
        case 'shard': return updateShard(context, data);
        case 'claw': return crawler.updateClaw(context, data);
        case 'crawler': return crawler.updateCrawler(context, data);
      }
    },
    scoreForHit: () => 55,
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'saboteur') saboteursStopped += 1;
      if (enemy.kind === 'shard') shardsStopped += 1;
      return Math.round(scoreByKind[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.16));
    },
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 75;
    },
    rankForRun(score, kills, total) {
      const clear = total > 0 ? kills / total : 0;
      if (crawler.killed() && carHits === 0 && score >= 14500 && clear >= 0.78) return 'S';
      if (crawler.killed() && score >= 10500 && clear >= 0.6) return 'A';
      if (score >= 7000 && clear >= 0.42) return 'B';
      if (score >= 3200 && clear >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [`Car integrity ${Math.max(0, SKYHOOK_LOYY_PLAYER_HEALTH - carHits)}/${SKYHOOK_LOYY_PLAYER_HEALTH}`];
      if (saboteursStopped > 0) lines.push(`${saboteursStopped} car diver${saboteursStopped === 1 ? '' : 's'} stopped`);
      if (shardsStopped > 0) lines.push(`${shardsStopped} debris strike${shardsStopped === 1 ? '' : 's'} intercepted`);
      const bossLine = crawler.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
