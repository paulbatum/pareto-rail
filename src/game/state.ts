import {
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
} from 'three';
import type { EnemyKind } from '../events';
import { createInput } from './input';
import { createRail, easeRailTime, offsetFromRail, RUN_DURATION } from './rail';
import { scoreForKill, rankForRun, type RunSummary } from './scoring';
import { SPAWN_TIMELINE, type MovementPattern, type SpawnEntry } from './timeline';
import type { GameOptions } from './types';

const MAX_LOCKS = 8;
const RETICLE_DISTANCE = 24;
const LOCK_RADIUS_NDC = 0.085;
const PROJECTILE_SPEED = 82;
const PROJECTILE_HIT_RADIUS = 1.15;
const FIRE_STAGGER = 0.06;

type RunState = 'ready' | 'running' | 'ended';

type Enemy = {
  id: number;
  kind: EnemyKind;
  pattern: MovementPattern;
  mesh: Object3D;
  spawnTime: number;
  anchorU: number;
  offset: Vector3;
  locked: boolean;
};

type PendingShot = {
  projectileId: number;
  enemyId: number;
  volleySize: number;
  fireAt: number;
  origin: Vector3;
};

type Projectile = {
  id: number;
  enemyId: number;
  volleySize: number;
  mesh: Object3D;
  velocity: Vector3;
};

export function createGame(options: GameOptions) {
  const { scene, camera, canvas, bus, hud, visuals } = options;
  const curve = createRail();
  const input = createInput(canvas, () => startRun());
  const raycaster = new Raycaster();
  const reticle = visuals.createReticle();

  let state: RunState = 'ready';
  let runNumber = 0;
  let runTime = 0;
  let spawnIndex = 0;
  let score = 0;
  let kills = 0;
  let missed = 0;
  let nextEnemyId = 1;
  let nextProjectileId = 1;

  const enemies = new Map<number, Enemy>();
  const locks: number[] = [];
  const pendingShots: PendingShot[] = [];
  const projectiles = new Map<number, Projectile>();
  const reticlePoint = new Vector3();

  scene.add(reticle);

  function startRun() {
    clearRunObjects();
    state = 'running';
    runNumber += 1;
    runTime = 0;
    spawnIndex = 0;
    score = 0;
    kills = 0;
    missed = 0;
    nextEnemyId = 1;
    nextProjectileId = 1;
    hud.hideEnd();
    hud.update({ score, timeRemaining: RUN_DURATION, lockCount: 0 });
    bus.emit('runstart', { runNumber, duration: RUN_DURATION, totalEnemies: SPAWN_TIMELINE.length });
  }

  function update(dt: number) {
    if (state !== 'running') return;

    runTime = Math.min(RUN_DURATION, runTime + dt);
    const railU = easeRailTime(runTime);
    updateCamera(railU);
    updateReticle();
    spawnDueEnemies();
    updateEnemies(railU);
    updateLocks();
    if (input.consumeRelease()) releaseLocks();
    updatePendingShots();
    updateProjectiles(dt);

    hud.update({ score, timeRemaining: Math.max(0, RUN_DURATION - runTime), lockCount: locks.length });

    if (runTime >= RUN_DURATION) endRun();
  }

  function updateCamera(railU: number) {
    const position = curve.getPointAt(railU);
    const lookAt = curve.getPointAt(MathUtils.clamp(railU + 0.025, 0, 1));
    camera.position.copy(position);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
  }

  function updateReticle() {
    raycaster.setFromCamera(input.state.pointerNdc, camera);
    reticlePoint.copy(raycaster.ray.direction).multiplyScalar(RETICLE_DISTANCE).add(raycaster.ray.origin);
    reticle.position.copy(reticlePoint);
    reticle.quaternion.copy(camera.quaternion);
    visuals.setReticleActive(reticle, input.state.pointerDown || locks.length > 0, locks.length);
  }

  function spawnDueEnemies() {
    while (spawnIndex < SPAWN_TIMELINE.length && SPAWN_TIMELINE[spawnIndex].time <= runTime) {
      spawnEnemy(SPAWN_TIMELINE[spawnIndex]);
      spawnIndex += 1;
    }
  }

  function spawnEnemy(entry: SpawnEntry) {
    const id = nextEnemyId;
    nextEnemyId += 1;
    const mesh = visuals.createEnemyMesh(entry.kind);
    const anchorU = easeRailTime(Math.min(RUN_DURATION, entry.time + entry.lead));
    const enemy: Enemy = {
      id,
      kind: entry.kind,
      pattern: entry.pattern,
      mesh,
      spawnTime: runTime,
      anchorU,
      offset: entry.offset.clone(),
      locked: false,
    };
    mesh.position.copy(enemyPosition(enemy));
    scene.add(mesh);
    enemies.set(id, enemy);
    bus.emit('spawn', { enemyId: id, kind: enemy.kind, worldPosition: mesh.position.clone() });
  }

  function updateEnemies(railU: number) {
    for (const enemy of [...enemies.values()]) {
      enemy.mesh.position.copy(enemyPosition(enemy));
      enemy.mesh.rotation.x += 0.01;
      enemy.mesh.rotation.y += 0.018;

      if (railU > enemy.anchorU + 0.018) {
        missEnemy(enemy);
      }
    }
  }

  function enemyPosition(enemy: Enemy) {
    const age = Math.max(0, runTime - enemy.spawnTime);
    const offset = enemy.offset.clone();
    if (enemy.pattern === 'drift') {
      offset.x += Math.sin(age * 0.85 + enemy.id) * 1.3 + age * 0.55;
      offset.y += Math.cos(age * 0.65 + enemy.id * 0.5) * 0.55;
    } else if (enemy.pattern === 'orbit') {
      offset.x += Math.cos(age * 2.2 + enemy.id) * 2.1;
      offset.y += Math.sin(age * 2.2 + enemy.id) * 2.1;
    }
    return offsetFromRail(curve, enemy.anchorU, offset);
  }

  function updateLocks() {
    if (!input.state.pointerDown || locks.length >= MAX_LOCKS) return;

    for (const enemy of enemies.values()) {
      if (locks.length >= MAX_LOCKS) return;
      if (enemy.locked) continue;
      const projected = enemy.mesh.position.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const dx = projected.x - input.state.pointerNdc.x;
      const dy = projected.y - input.state.pointerNdc.y;
      if (Math.hypot(dx, dy) <= LOCK_RADIUS_NDC) lockEnemy(enemy);
    }
  }

  function lockEnemy(enemy: Enemy) {
    enemy.locked = true;
    locks.push(enemy.id);
    visuals.setEnemyLocked(enemy.mesh, true);
    bus.emit('lock', {
      enemyId: enemy.id,
      lockCount: locks.length,
      worldPosition: enemy.mesh.position.clone(),
    });
  }

  function releaseLocks() {
    if (locks.length === 0) return;
    const released = [...locks];
    locks.length = 0;

    released.forEach((enemyId, index) => {
      const enemy = enemies.get(enemyId);
      if (!enemy) return;
      enemy.locked = false;
      visuals.setEnemyLocked(enemy.mesh, false);
      bus.emit('unlock', { enemyId, lockCount: locks.length, worldPosition: enemy.mesh.position.clone() });
      pendingShots.push({
        projectileId: nextProjectileId,
        enemyId,
        volleySize: released.length,
        fireAt: runTime + index * FIRE_STAGGER,
        origin: reticlePoint.clone(),
      });
      nextProjectileId += 1;
    });
  }

  function updatePendingShots() {
    for (let i = pendingShots.length - 1; i >= 0; i -= 1) {
      const shot = pendingShots[i];
      if (shot.fireAt > runTime) continue;
      pendingShots.splice(i, 1);
      const enemy = enemies.get(shot.enemyId);
      if (!enemy) continue;
      const mesh = visuals.createProjectileMesh();
      mesh.position.copy(shot.origin);
      scene.add(mesh);
      projectiles.set(shot.projectileId, {
        id: shot.projectileId,
        enemyId: shot.enemyId,
        volleySize: shot.volleySize,
        mesh,
        velocity: enemy.mesh.position.clone().sub(shot.origin).normalize().multiplyScalar(PROJECTILE_SPEED),
      });
      bus.emit('fire', {
        projectileId: shot.projectileId,
        enemyId: shot.enemyId,
        volleySize: shot.volleySize,
        worldPosition: shot.origin.clone(),
        targetPosition: enemy.mesh.position.clone(),
      });
    }
  }

  function updateProjectiles(dt: number) {
    for (const projectile of [...projectiles.values()]) {
      const enemy = enemies.get(projectile.enemyId);
      if (!enemy) {
        removeProjectile(projectile);
        continue;
      }

      const toTarget = enemy.mesh.position.clone().sub(projectile.mesh.position);
      const distance = toTarget.length();
      if (distance <= PROJECTILE_HIT_RADIUS) {
        hitEnemy(projectile, enemy);
        continue;
      }

      const desired = toTarget.normalize().multiplyScalar(PROJECTILE_SPEED);
      projectile.velocity.lerp(desired, Math.min(1, dt * 8));
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      projectile.mesh.lookAt(enemy.mesh.position);
    }
  }

  function hitEnemy(projectile: Projectile, enemy: Enemy) {
    const worldPosition = enemy.mesh.position.clone();
    bus.emit('hit', { enemyId: enemy.id, projectileId: projectile.id, worldPosition: worldPosition.clone() });
    removeProjectile(projectile);
    removeEnemy(enemy);
    kills += 1;
    const award = scoreForKill(projectile.volleySize);
    score += award;
    bus.emit('kill', { enemyId: enemy.id, worldPosition, scoreAwarded: award });
  }

  function missEnemy(enemy: Enemy) {
    const worldPosition = enemy.mesh.position.clone();
    if (enemy.locked) unlockEnemy(enemy);
    removeEnemy(enemy);
    missed += 1;
    bus.emit('miss', { enemyId: enemy.id, worldPosition });
  }

  function unlockEnemy(enemy: Enemy) {
    enemy.locked = false;
    const index = locks.indexOf(enemy.id);
    if (index >= 0) locks.splice(index, 1);
    visuals.setEnemyLocked(enemy.mesh, false);
    bus.emit('unlock', { enemyId: enemy.id, lockCount: locks.length, worldPosition: enemy.mesh.position.clone() });
  }

  function removeEnemy(enemy: Enemy) {
    enemies.delete(enemy.id);
    scene.remove(enemy.mesh);
  }

  function removeProjectile(projectile: Projectile) {
    projectiles.delete(projectile.id);
    scene.remove(projectile.mesh);
  }

  function endRun() {
    if (state === 'ended') return;
    for (const enemy of [...enemies.values()]) missEnemy(enemy);
    state = 'ended';
    locks.length = 0;
    pendingShots.length = 0;
    for (const projectile of [...projectiles.values()]) removeProjectile(projectile);
    const summary: RunSummary = {
      score,
      kills,
      missed,
      totalEnemies: SPAWN_TIMELINE.length,
      rank: rankForRun(score, kills, SPAWN_TIMELINE.length),
    };
    hud.update({ score, timeRemaining: 0, lockCount: 0 });
    hud.showEnd(summary);
    bus.emit('runend', summary);
  }

  function clearRunObjects() {
    for (const enemy of enemies.values()) scene.remove(enemy.mesh);
    for (const projectile of projectiles.values()) scene.remove(projectile.mesh);
    enemies.clear();
    projectiles.clear();
    pendingShots.length = 0;
    locks.length = 0;
  }

  return {
    start: startRun,
    update,
    dispose() {
      input.dispose();
      scene.remove(reticle);
      clearRunObjects();
    },
    get state() {
      return state;
    },
  };
}
