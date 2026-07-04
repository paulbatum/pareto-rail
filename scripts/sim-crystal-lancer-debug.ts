import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { createEventBus } from '../src/events';
import type { LockOnEnemy, LockOnSpawnEntry } from '../src/engine/lock-on-runner';
import { createCrystalGameplay, type CrystalEnemyKind, type CrystalSpawnData } from '../src/levels/crystal-debug/gameplay';

type Enemy = LockOnEnemy<CrystalEnemyKind, CrystalSpawnData>;
type Entry = LockOnSpawnEntry<CrystalEnemyKind, CrystalSpawnData>;

type SimOptions = {
  dt: number;
  maxSeconds?: number;
  logEvery?: number;
};

const PLAYER_INVULNERABILITY_SECONDS = 0.9;

class SimEnemy implements Enemy {
  id: number;
  kind: CrystalEnemyKind;
  mesh = new Object3D();
  spawnTime: number;
  entry: Entry;
  letter?: string;
  hitPointsRemaining: number;

  constructor(id: number, entry: Entry, runTime: number) {
    this.id = id;
    this.kind = entry.kind;
    this.spawnTime = runTime;
    this.entry = entry;
    this.letter = entry.letter;
    this.hitPointsRemaining = Math.max(1, entry.hitPoints ?? 1);
  }
}

export function runCrystalLancerDebugSim(options: SimOptions) {
  const bus = createEventBus();
  const level = createCrystalGameplay(bus);
  const curve = level.createRail();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const enemies = new Map<number, SimEnemy>();
  const spawnEvents: Array<{ time: number; enemyId: number; kind: string; distance: number }> = [];
  const playerHits: Array<{ time: number; damage: number; healthRemaining: number }> = [];
  const misses: Array<{ time: number; enemyId: number; kind: string; age: number; distance: number }> = [];

  let runTime = 0;
  let spawnIndex = 0;
  let nextEnemyId = 1;
  let health = level.playerHealth ?? Infinity;
  let invulnerableUntil = -Infinity;
  let ended = false;

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    spawnEvents.push({
      time: runTime,
      enemyId,
      kind,
      distance: worldPosition.distanceTo(camera.position),
    });
  });
  bus.on('playerhit', (event) => {
    playerHits.push({ time: runTime, ...event });
  });
  bus.on('miss', ({ enemyId }) => {
    const enemy = enemies.get(enemyId);
    if (!enemy) return;
    misses.push({
      time: runTime,
      enemyId,
      kind: enemy.kind,
      age: runTime - enemy.spawnTime,
      distance: enemy.mesh.position.distanceTo(camera.position),
    });
  });

  function updateCamera() {
    const progress = level.easeRunProgress?.(runTime, level.duration) ?? runTime / level.duration;
    const position = curve.getPointAt(Math.min(1, Math.max(0, progress)));
    const lookAt = curve.getPointAt(Math.min(1, Math.max(0, progress + 0.025)));
    camera.position.copy(position);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
    return progress;
  }

  function spawnEnemy(entry: Entry) {
    const enemy = new SimEnemy(nextEnemyId, entry, runTime);
    nextEnemyId += 1;
    enemies.set(enemy.id, enemy);
    updateEnemy(enemy);
    bus.emit('spawn', {
      enemyId: enemy.id,
      kind: enemy.kind,
      worldPosition: enemy.mesh.position.clone(),
      letter: enemy.letter,
    });
    return enemy.id;
  }

  function missEnemy(enemy: SimEnemy) {
    bus.emit('miss', { enemyId: enemy.id, worldPosition: enemy.mesh.position.clone(), letter: enemy.letter });
    enemies.delete(enemy.id);
  }

  function damagePlayer(amount = 1) {
    if (runTime < invulnerableUntil) return;
    const damage = Math.max(0, amount);
    health = Math.max(0, health - damage);
    invulnerableUntil = runTime + PLAYER_INVULNERABILITY_SECONDS;
    bus.emit('playerhit', { damage, healthRemaining: health });
    if (health <= 0) ended = true;
  }

  function updateEnemy(enemy: SimEnemy) {
    const progress = level.easeRunProgress?.(runTime, level.duration) ?? runTime / level.duration;
    return level.updateEnemy({
      enemy,
      runTime,
      runProgress: progress,
      age: Math.max(0, runTime - enemy.spawnTime),
      curve,
      camera,
      spawnEnemy,
      damagePlayer,
      playerHealth: health,
    }) === true;
  }

  bus.emit('runstart', {
    runNumber: 1,
    duration: level.duration,
    totalEnemies: level.spawnTimeline.filter((entry) => entry.countsTowardTotal !== false).length,
  });

  const maxSeconds = options.maxSeconds ?? level.duration;
  const logEvery = options.logEvery ?? 0;
  let nextLogAt = logEvery > 0 ? 0 : Infinity;

  while (!ended && runTime < Math.min(level.duration, maxSeconds)) {
    runTime = Math.min(level.duration, runTime + options.dt);
    updateCamera();

    while (spawnIndex < level.spawnTimeline.length && level.spawnTimeline[spawnIndex].time <= runTime) {
      spawnEnemy(level.spawnTimeline[spawnIndex]);
      spawnIndex += 1;
    }

    for (const enemy of [...enemies.values()]) {
      const despawn = updateEnemy(enemy);
      if (despawn) missEnemy(enemy);
      if (ended) break;
    }

    if (runTime >= nextLogAt) nextLogAt += logEvery;
  }

  const byKind = new Map<string, number>();
  for (const event of spawnEvents) byKind.set(event.kind, (byKind.get(event.kind) ?? 0) + 1);

  return {
    secondsSimulated: runTime,
    endedByDeath: ended,
    healthRemaining: health,
    activeEnemies: [...enemies.values()].map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      age: runTime - enemy.spawnTime,
      distance: enemy.mesh.position.distanceTo(camera.position),
    })),
    spawnCounts: Object.fromEntries(byKind),
    firstSpawns: spawnEvents.slice(0, 10),
    playerHits,
    misses,
  };
}

const result = runCrystalLancerDebugSim({ dt: 1 / 120 });
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

if (verbose) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const spawnCounts = Object.entries(result.spawnCounts)
    .map(([kind, count]) => `${kind}:${count}`)
    .join(' ');
  const outcome = result.endedByDeath ? `death at ${result.secondsSimulated.toFixed(2)}s` : `${result.secondsSimulated.toFixed(2)}s`;
  console.log(
    `crystal-debug sim: ${outcome}; health ${result.healthRemaining}; spawns ${spawnCounts}; hits ${result.playerHits.length}; misses ${result.misses.length}; active ${result.activeEnemies.length}`,
  );
}
