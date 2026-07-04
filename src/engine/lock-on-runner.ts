import { MathUtils, Object3D, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import type { CatmullRomCurve3 } from 'three';
import { createInput } from './input';
import { smoothRunProgress } from './rail';
import { scoreForKill as defaultScoreForKill, rankForRun as defaultRankForRun, type RunSummary } from './scoring';
import type { VisualFactories } from './types';
import type { EventBus } from '../events';
import type { Hud } from '../ui/hud';

const MAX_LOCKS = 8;
const RETICLE_DISTANCE = 24;
const LOCK_RADIUS_NDC = 0.085;
const PROJECTILE_SPEED = 82;
const PROJECTILE_HIT_RADIUS = 1.15;
const FIRE_STAGGER = 0.06;
const WORD_DISTANCE = 20;
const START_WORD = 'START';
const REPLAY_WORD = 'REPLAY';

type RunState = 'attract' | 'running' | 'ended';
type TargetPurpose = 'enemy' | 'start-letter' | 'replay-letter';

export type LockOnSpawnEntry<TKind extends string = string, TData = unknown> = {
  time: number;
  kind: TKind;
  data: TData;
};

export type LockOnEnemy<TKind extends string = string, TData = unknown> = {
  id: number;
  kind: TKind;
  mesh: Object3D;
  spawnTime: number;
  entry: LockOnSpawnEntry<TKind, TData>;
};

export type LockOnEnemyUpdate<TKind extends string = string, TData = unknown> = {
  enemy: LockOnEnemy<TKind, TData>;
  runTime: number;
  runProgress: number;
  age: number;
  curve: CatmullRomCurve3;
  camera: PerspectiveCamera;
};

export type LockOnAttractCameraUpdate = {
  camera: PerspectiveCamera;
  curve: CatmullRomCurve3;
  modeTime: number;
  dt: number;
};

export type LockOnRunnerLevel<TKind extends string = string, TData = unknown> = {
  duration: number;
  createRail(): CatmullRomCurve3;
  spawnTimeline: Array<LockOnSpawnEntry<TKind, TData>>;
  updateEnemy(context: LockOnEnemyUpdate<TKind, TData>): boolean | void;
  updateAttractCamera?(context: LockOnAttractCameraUpdate): void;
  easeRunProgress?(time: number, duration: number): number;
  scoreForKill?(volleySize: number, enemy: LockOnEnemy<TKind, TData>): number;
  rankForRun?(score: number, kills: number, totalEnemies: number): string;
  startWord?: string;
  replayWord?: string;
};

type Enemy<TKind extends string, TData> = {
  id: number;
  kind: TKind | 'letter';
  purpose: TargetPurpose;
  mesh: Object3D;
  spawnTime: number;
  locked: boolean;
  entry?: LockOnSpawnEntry<TKind, TData>;
  letter?: string;
  letterIndex?: number;
  wordLength?: number;
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

export type LockOnRunnerOptions<TKind extends string = string, TData = unknown> = {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  bus: EventBus;
  hud: Hud;
  visuals: VisualFactories;
  onPause: () => void;
  level: LockOnRunnerLevel<TKind, TData>;
};

export function createLockOnRunner<TKind extends string = string, TData = unknown>(
  options: LockOnRunnerOptions<TKind, TData>,
) {
  const { scene, camera, canvas, bus, hud, visuals, onPause, level } = options;
  const duration = level.duration;
  const startWord = level.startWord ?? START_WORD;
  const replayWord = level.replayWord ?? REPLAY_WORD;
  const curve = level.createRail();
  const easeRunProgress = level.easeRunProgress ?? smoothRunProgress;
  const input = createInput(canvas, {
    onRestart: () => startRun(),
    onPause,
    onPointerDown: () => recordAttractPointerDown(),
  });
  const raycaster = new Raycaster();
  const reticle = visuals.createReticle();

  let state: RunState = 'attract';
  let runNumber = 0;
  let runTime = 0;
  let worldTime = 0;
  let modeTime = 0;
  let spawnIndex = 0;
  let score = 0;
  let kills = 0;
  let missed = 0;
  let nextEnemyId = 1;
  let nextProjectileId = 1;
  let failedAttractReleases = 0;
  let attractPointerDowns = 0;
  let attractReachedFullLocks = false;
  let startWhenLettersClear = false;
  let replayWhenLettersClear = false;
  let startDelay = -1;
  let runEase = 0;
  const easeFromPosition = new Vector3();
  const easeFromLook = new Vector3(0, 0, -1);

  const enemies = new Map<number, Enemy<TKind, TData>>();
  const locks: number[] = [];
  const pendingShots: PendingShot[] = [];
  const projectiles = new Map<number, Projectile>();
  const reticlePoint = new Vector3();

  scene.add(reticle);

  function enterAttract() {
    clearRunObjects();
    state = 'attract';
    modeTime = 0;
    failedAttractReleases = 0;
    attractPointerDowns = 0;
    attractReachedFullLocks = false;
    startWhenLettersClear = false;
    replayWhenLettersClear = false;
    startDelay = -1;
    runTime = 0;
    score = 0;
    kills = 0;
    missed = 0;
    spawnIndex = 0;
    hud.hideEnd();
    hud.hideTip();
    hud.setHudActive(false);
    hud.update({ score, timeRemaining: duration, lockCount: 0 });
    updateAttractCamera(0);
    updateReticle();
    spawnWord(startWord, 'start-letter');
  }

  function startRun() {
    easeFromPosition.copy(camera.position);
    camera.getWorldDirection(easeFromLook);
    clearRunObjects();
    state = 'running';
    modeTime = 0;
    runEase = 0;
    runNumber += 1;
    runTime = 0;
    spawnIndex = 0;
    score = 0;
    kills = 0;
    missed = 0;
    nextEnemyId = 1;
    nextProjectileId = 1;
    startWhenLettersClear = false;
    replayWhenLettersClear = false;
    startDelay = -1;
    hud.hideEnd();
    hud.hideTip();
    hud.setHudActive(true);
    hud.update({ score, timeRemaining: duration, lockCount: 0 });
    bus.emit('runstart', { runNumber, duration, totalEnemies: level.spawnTimeline.length });
  }

  function update(dt: number) {
    worldTime += dt;
    modeTime += dt;

    if (state === 'attract') updateAttract(dt);
    else if (state === 'running') updateRunning(dt);
    else updateEnded(dt);
  }

  function updateAttract(dt: number) {
    updateAttractCamera(dt);
    updateReticle();
    updateLetterTargets();
    updateLocks();
    if (input.consumeRelease()) releaseLocks();
    updatePendingShots();
    updateProjectiles(dt);
    updateLetterStartDelay(dt);
    hud.update({ score, timeRemaining: duration, lockCount: locks.length });
  }

  function updateRunning(dt: number) {
    runTime = Math.min(duration, runTime + dt);
    const runProgress = easeRunProgress(runTime, duration);
    updateRunCamera(runProgress, dt);
    updateReticle();
    spawnDueEnemies();
    updateEnemies(runProgress);
    updateLocks();
    if (input.consumeRelease()) releaseLocks();
    updatePendingShots();
    updateProjectiles(dt);

    hud.update({ score, timeRemaining: Math.max(0, duration - runTime), lockCount: locks.length });

    if (runTime >= duration) endRun();
  }

  function updateEnded(dt: number) {
    updateReticle();
    updateLetterTargets();
    updateLocks();
    if (input.consumeRelease()) releaseLocks();
    updatePendingShots();
    updateProjectiles(dt);
    updateLetterStartDelay(dt);
    hud.update({ score, timeRemaining: 0, lockCount: locks.length });
  }

  function updateAttractCamera(dt: number) {
    if (level.updateAttractCamera) {
      level.updateAttractCamera({ camera, curve, modeTime, dt });
      return;
    }
    const base = curve.getPointAt(0);
    const lookBase = curve.getPointAt(0.03);
    const drift = new Vector3(
      Math.sin(modeTime * 0.7) * 0.035,
      Math.cos(modeTime * 0.9) * 0.025,
      Math.sin(modeTime * 0.5) * 0.02,
    );
    const lookDrift = new Vector3(
      Math.sin(modeTime * 0.55 + 1.4) * 0.07,
      Math.cos(modeTime * 0.6) * 0.045,
      0,
    );
    camera.position.copy(base).add(drift);
    camera.lookAt(lookBase.clone().add(lookDrift));
    camera.updateMatrixWorld();
  }

  function updateRunCamera(runProgress: number, dt: number) {
    const position = curve.getPointAt(runProgress);
    const lookAt = curve.getPointAt(MathUtils.clamp(runProgress + 0.025, 0, 1));
    if (runEase < 1) {
      runEase = Math.min(1, runEase + dt);
      const eased = runEase * runEase * (3 - 2 * runEase);
      const fromLook = easeFromPosition.clone().add(easeFromLook);
      camera.position.copy(easeFromPosition).lerp(position, eased);
      camera.lookAt(fromLook.lerp(lookAt, eased));
    } else {
      camera.position.copy(position);
      camera.lookAt(lookAt);
    }
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
    while (spawnIndex < level.spawnTimeline.length && level.spawnTimeline[spawnIndex].time <= runTime) {
      spawnEnemy(level.spawnTimeline[spawnIndex]);
      spawnIndex += 1;
    }
  }

  function spawnEnemy(entry: LockOnSpawnEntry<TKind, TData>) {
    const id = nextEnemyId;
    nextEnemyId += 1;
    const mesh = visuals.createEnemyMesh(entry.kind);
    const enemy: Enemy<TKind, TData> = {
      id,
      kind: entry.kind,
      purpose: 'enemy',
      mesh,
      spawnTime: runTime,
      locked: false,
      entry,
    };
    scene.add(mesh);
    enemies.set(id, enemy);
    updateEnemy(enemy, easeRunProgress(runTime, duration));
    bus.emit('spawn', { enemyId: id, kind: enemy.kind, worldPosition: mesh.position.clone() });
  }

  function spawnWord(word: string, purpose: Extract<TargetPurpose, 'start-letter' | 'replay-letter'>) {
    [...word].forEach((letter, index) => {
      const id = nextEnemyId;
      nextEnemyId += 1;
      const mesh = visuals.createEnemyMesh('letter', letter);
      const target: Enemy<TKind, TData> = {
        id,
        kind: 'letter',
        purpose,
        mesh,
        spawnTime: worldTime,
        locked: false,
        letter,
        letterIndex: index,
        wordLength: word.length,
      };
      updateLetterPosition(target);
      scene.add(mesh);
      enemies.set(id, target);
      bus.emit('spawn', { enemyId: id, kind: 'letter', letter, worldPosition: mesh.position.clone() });
    });
  }

  function updateEnemies(runProgress: number) {
    for (const enemy of [...enemies.values()]) {
      if (enemy.purpose !== 'enemy') continue;
      if (updateEnemy(enemy, runProgress)) missEnemy(enemy);
    }
  }

  function updateEnemy(enemy: Enemy<TKind, TData>, runProgress: number) {
    if (!enemy.entry || enemy.kind === 'letter') return false;
    const publicEnemy: LockOnEnemy<TKind, TData> = {
      id: enemy.id,
      kind: enemy.kind,
      mesh: enemy.mesh,
      spawnTime: enemy.spawnTime,
      entry: enemy.entry,
    };
    return level.updateEnemy({
      enemy: publicEnemy,
      runTime,
      runProgress,
      age: Math.max(0, runTime - enemy.spawnTime),
      curve,
      camera,
    }) === true;
  }

  function updateLetterTargets() {
    for (const enemy of enemies.values()) if (enemy.kind === 'letter') updateLetterPosition(enemy);
  }

  function updateLetterPosition(enemy: Enemy<TKind, TData>) {
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const index = enemy.letterIndex ?? 0;
    const wordLength = enemy.wordLength ?? 1;
    const spacing = enemy.purpose === 'replay-letter' ? 2.55 : 2.75;
    const x = (index - (wordLength - 1) / 2) * spacing;
    const y = enemy.purpose === 'replay-letter' ? 1.1 : 0.25;
    enemy.mesh.position.copy(camera.position)
      .addScaledVector(forward, WORD_DISTANCE)
      .addScaledVector(right, x)
      .addScaledVector(up, y);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(modeTime * 1.15 + index * 0.7) * 0.15);
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

    if (state === 'attract' && countLockedLetters('start-letter') === startWord.length) {
      attractReachedFullLocks = true;
      hud.hideTip();
    }
  }

  function lockEnemy(enemy: Enemy<TKind, TData>) {
    enemy.locked = true;
    locks.push(enemy.id);
    visuals.setEnemyLocked(enemy.mesh, true);
    bus.emit('lock', {
      enemyId: enemy.id,
      lockCount: locks.length,
      worldPosition: enemy.mesh.position.clone(),
      letter: enemy.letter,
    });
  }

  function releaseLocks() {
    if (locks.length === 0) return;
    if (state === 'attract') {
      releaseLetterLocks('start-letter', startWord.length);
      return;
    }
    if (state === 'ended') {
      releaseLetterLocks('replay-letter', replayWord.length);
      return;
    }
    fireLocks([...locks]);
  }

  function releaseLetterLocks(purpose: Extract<TargetPurpose, 'start-letter' | 'replay-letter'>, required: number) {
    const released = [...locks];
    const matching = released.filter((enemyId) => enemies.get(enemyId)?.purpose === purpose);
    if (matching.length !== required) {
      unlockReleased(released);
      if (purpose === 'start-letter') {
        failedAttractReleases += 1;
        if (failedAttractReleases >= 3) hud.showTip();
      }
      return;
    }

    if (purpose === 'start-letter') startWhenLettersClear = true;
    if (purpose === 'replay-letter') replayWhenLettersClear = true;
    fireLocks(matching);
  }

  function fireLocks(released: number[]) {
    locks.length = 0;

    released.forEach((enemyId, index) => {
      const enemy = enemies.get(enemyId);
      if (!enemy) return;
      enemy.locked = false;
      visuals.setEnemyLocked(enemy.mesh, false);
      bus.emit('unlock', {
        enemyId,
        lockCount: locks.length,
        worldPosition: enemy.mesh.position.clone(),
        letter: enemy.letter,
      });
      pendingShots.push({
        projectileId: nextProjectileId,
        enemyId,
        volleySize: released.length,
        fireAt: worldTime + index * FIRE_STAGGER,
        origin: reticlePoint.clone(),
      });
      nextProjectileId += 1;
    });
  }

  function unlockReleased(released: number[]) {
    for (const enemyId of released) {
      const enemy = enemies.get(enemyId);
      if (!enemy) continue;
      enemy.locked = false;
      visuals.setEnemyLocked(enemy.mesh, false);
      bus.emit('unlock', {
        enemyId,
        lockCount: Math.max(0, locks.length - 1),
        worldPosition: enemy.mesh.position.clone(),
        letter: enemy.letter,
      });
    }
    locks.length = 0;
  }

  function updatePendingShots() {
    for (let i = pendingShots.length - 1; i >= 0; i -= 1) {
      const shot = pendingShots[i];
      if (shot.fireAt > worldTime) continue;
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
        letter: enemy.letter,
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

  function hitEnemy(projectile: Projectile, enemy: Enemy<TKind, TData>) {
    const worldPosition = enemy.mesh.position.clone();
    bus.emit('hit', {
      enemyId: enemy.id,
      projectileId: projectile.id,
      worldPosition: worldPosition.clone(),
      letter: enemy.letter,
    });
    removeProjectile(projectile);
    removeEnemy(enemy);

    if (enemy.kind === 'letter') {
      bus.emit('kill', { enemyId: enemy.id, worldPosition, scoreAwarded: 0, letter: enemy.letter });
      return;
    }

    kills += 1;
    const publicEnemy = enemy.entry
      ? { id: enemy.id, kind: enemy.kind, mesh: enemy.mesh, spawnTime: enemy.spawnTime, entry: enemy.entry }
      : undefined;
    const award = publicEnemy ? (level.scoreForKill?.(projectile.volleySize, publicEnemy) ?? defaultScoreForKill(projectile.volleySize)) : 0;
    score += award;
    bus.emit('kill', { enemyId: enemy.id, worldPosition, scoreAwarded: award });
  }

  function missEnemy(enemy: Enemy<TKind, TData>) {
    const worldPosition = enemy.mesh.position.clone();
    if (enemy.locked) unlockEnemy(enemy);
    removeEnemy(enemy);
    if (enemy.kind !== 'letter') missed += 1;
    bus.emit('miss', { enemyId: enemy.id, worldPosition, letter: enemy.letter });
  }

  function unlockEnemy(enemy: Enemy<TKind, TData>) {
    enemy.locked = false;
    const index = locks.indexOf(enemy.id);
    if (index >= 0) locks.splice(index, 1);
    visuals.setEnemyLocked(enemy.mesh, false);
    bus.emit('unlock', {
      enemyId: enemy.id,
      lockCount: locks.length,
      worldPosition: enemy.mesh.position.clone(),
      letter: enemy.letter,
    });
  }

  function removeEnemy(enemy: Enemy<TKind, TData>) {
    enemies.delete(enemy.id);
    scene.remove(enemy.mesh);
  }

  function removeProjectile(projectile: Projectile) {
    projectiles.delete(projectile.id);
    scene.remove(projectile.mesh);
  }

  function updateLetterStartDelay(dt: number) {
    if (!startWhenLettersClear && !replayWhenLettersClear) return;
    const purpose = startWhenLettersClear ? 'start-letter' : 'replay-letter';
    if (countTargets(purpose) > 0) return;
    if (startDelay < 0) startDelay = 0.8;
    startDelay -= dt;
    if (startDelay <= 0) startRun();
  }

  function countTargets(purpose: TargetPurpose) {
    let count = 0;
    for (const enemy of enemies.values()) if (enemy.purpose === purpose) count += 1;
    return count;
  }

  function countLockedLetters(purpose: TargetPurpose) {
    let count = 0;
    for (const enemyId of locks) if (enemies.get(enemyId)?.purpose === purpose) count += 1;
    return count;
  }

  function recordAttractPointerDown() {
    if (state !== 'attract' || attractReachedFullLocks) return;
    attractPointerDowns += 1;
    if (attractPointerDowns >= 8) hud.showTip();
  }

  function endRun() {
    if (state === 'ended') return;
    for (const enemy of [...enemies.values()]) missEnemy(enemy);
    state = 'ended';
    modeTime = 0;
    locks.length = 0;
    pendingShots.length = 0;
    for (const projectile of [...projectiles.values()]) removeProjectile(projectile);
    const totalEnemies = level.spawnTimeline.length;
    const summary: RunSummary = {
      score,
      kills,
      missed,
      totalEnemies,
      rank: level.rankForRun?.(score, kills, totalEnemies) ?? defaultRankForRun(score, kills, totalEnemies),
    };
    hud.setHudActive(false);
    hud.update({ score, timeRemaining: 0, lockCount: 0 });
    hud.showEnd(summary);
    bus.emit('runend', summary);
    spawnWord(replayWord, 'replay-letter');
  }

  function clearRunObjects() {
    for (const enemy of enemies.values()) scene.remove(enemy.mesh);
    for (const projectile of projectiles.values()) scene.remove(projectile.mesh);
    enemies.clear();
    projectiles.clear();
    pendingShots.length = 0;
    locks.length = 0;
  }

  enterAttract();

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
