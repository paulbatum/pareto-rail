import { MathUtils, Object3D, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import type { CatmullRomCurve3 } from 'three';
import { createInput } from './input';
import { MAX_LOCKS } from './locks';
import { smoothRunProgress } from './rail';
import { scoreForKill as defaultScoreForKill, rankForRun as defaultRankForRun, type RunSummary } from './scoring';
import type { VisualFactories } from './types';
import type { EventBus } from '../events';
import type { Hud } from '../ui/hud';

const RETICLE_DISTANCE = 24;
const LOCK_RADIUS_NDC = 0.085;
const PROJECTILE_SPEED = 82;
const PROJECTILE_HIT_RADIUS = 1.15;
const FIRE_STAGGER = 0.06;
const WORD_DISTANCE = 20;
const START_WORD = 'START!';
const REPLAY_WORD = 'REPLAY';
const CONTROL_TIP = 'HOLD to charge — SWEEP across all six targets — RELEASE to fire';
const PLAYER_INVULNERABILITY_SECONDS = 0.9;

type RunState = 'attract' | 'running' | 'ended';
type TargetPurpose = 'enemy' | 'start-letter' | 'replay-letter';

export type LockOnSpawnEntry<TKind extends string = string, TData = unknown> = {
  time: number;
  kind: TKind;
  data: TData;
  letter?: string;
  hitPoints?: number;
  lockable?: boolean;
  countsTowardTotal?: boolean;
};

export type LockOnEnemy<TKind extends string = string, TData = unknown> = {
  id: number;
  kind: TKind;
  mesh: Object3D;
  spawnTime: number;
  entry: LockOnSpawnEntry<TKind, TData>;
  letter?: string;
  hitPointsRemaining: number;
};

export type LockOnEnemyUpdate<TKind extends string = string, TData = unknown> = {
  enemy: LockOnEnemy<TKind, TData>;
  runTime: number;
  runProgress: number;
  age: number;
  curve: CatmullRomCurve3;
  camera: PerspectiveCamera;
  spawnEnemy(entry: LockOnSpawnEntry<TKind, TData>): number;
  damagePlayer(amount?: number): void;
  playerHealth: number;
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
  scoreForHit?(volleySize: number, enemy: LockOnEnemy<TKind, TData>): number;
  scoreForKill?(volleySize: number, enemy: LockOnEnemy<TKind, TData>): number;
  scoreForVolley?(results: Array<{ enemy: LockOnEnemy<TKind, TData>; killed: boolean }>): number;
  validateRelease?(enemies: Array<LockOnEnemy<TKind, TData>>): boolean;
  rankForRun?(score: number, kills: number, totalEnemies: number): string;
  detailsForRun?(): string[] | undefined;
  lockRadiusNdc?: number;
  startWord?: string;
  replayWord?: string;
  playerHealth?: number;
};

type Enemy<TKind extends string, TData> = {
  id: number;
  kind: TKind | 'letter';
  purpose: TargetPurpose;
  mesh: Object3D;
  spawnTime: number;
  locked: boolean;
  hitPointsRemaining: number;
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
  volleyId?: number;
  indexInVolley?: number;
};

type Projectile = {
  id: number;
  enemyId: number;
  volleySize: number;
  mesh: Object3D;
  velocity: Vector3;
  volleyId?: number;
  indexInVolley?: number;
};

type Volley<TKind extends string, TData> = {
  id: number;
  members: Array<{ enemy: LockOnEnemy<TKind, TData>; killed?: boolean }>;
  unresolved: number;
};

export type LockOnRunnerOptions<TKind extends string = string, TData = unknown> = {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  bus: EventBus;
  hud: Hud;
  visuals: VisualFactories;
  onPause: () => void;
  onFullscreen: () => void;
  startTip: string;
  level: LockOnRunnerLevel<TKind, TData>;
};

export function createLockOnRunner<TKind extends string = string, TData = unknown>(
  options: LockOnRunnerOptions<TKind, TData>,
) {
  const { scene, camera, canvas, bus, hud, visuals, onPause, onFullscreen, startTip, level } = options;
  const duration = level.duration;
  const startWord = level.startWord ?? START_WORD;
  const replayWord = level.replayWord ?? REPLAY_WORD;
  const lockRadiusNdc = level.lockRadiusNdc ?? LOCK_RADIUS_NDC;
  const curve = level.createRail();
  const easeRunProgress = level.easeRunProgress ?? smoothRunProgress;
  const timelineTotalEnemies = level.spawnTimeline.filter((entry) => countsEntryTowardTotal(entry)).length;
  const hasPlayerHealth = level.playerHealth !== undefined;
  const maxPlayerHealth = level.playerHealth ?? Infinity;
  const input = createInput(canvas, {
    onRestart: () => startRun(),
    onPause,
    onFullscreen,
    onPointerDown: () => recordAttractPointerDown(),
    onUndoLock: () => undoLastLock(),
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
  let dynamicCountedEnemies = 0;
  let health = maxPlayerHealth;
  let invulnerableUntil = -Infinity;
  let nextEnemyId = 1;
  let nextProjectileId = 1;
  let nextVolleyId = 1;
  let failedAttractReleases = 0;
  let attractPointerDowns = 0;
  let attractReachedFullLocks = false;
  let startWhenLettersClear = false;
  let replayWhenLettersClear = false;
  let startDelay = -1;
  let runEase = 0;
  let showingStartTip = false;
  const easeFromPosition = new Vector3();
  const easeFromLook = new Vector3(0, 0, -1);

  const enemies = new Map<number, Enemy<TKind, TData>>();
  const locks: number[] = [];
  const pendingShots: PendingShot[] = [];
  const projectiles = new Map<number, Projectile>();
  const volleys = new Map<number, Volley<TKind, TData>>();
  const reticlePoint = new Vector3();
  const enemyUpdateHelpers = {
    spawnEnemy(entry: LockOnSpawnEntry<TKind, TData>) {
      if (state !== 'running') return -1;
      return spawnEnemy(entry, true);
    },
    damagePlayer(amount?: number) {
      applyPlayerDamage(amount);
    },
  };

  scene.add(reticle);
  document.addEventListener('fullscreenchange', updateStartTipVisibility);

  function showStartTip() {
    if (startTip && !document.fullscreenElement) {
      hud.setTip(startTip);
      hud.showTip();
      showingStartTip = true;
    } else {
      hud.hideTip();
      showingStartTip = false;
    }
  }

  function updateStartTipVisibility() {
    if (state !== 'attract' || !showingStartTip) return;
    showStartTip();
  }

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
    dynamicCountedEnemies = 0;
    health = maxPlayerHealth;
    invulnerableUntil = -Infinity;
    spawnIndex = 0;
    hud.hideEnd();
    hud.setCallout('');
    showStartTip();
    hud.setHudActive(false);
    hud.update({ score, timeRemaining: duration, lockCount: 0, health: readyHealthForHud() });
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
    dynamicCountedEnemies = 0;
    health = maxPlayerHealth;
    invulnerableUntil = -Infinity;
    nextEnemyId = 1;
    nextProjectileId = 1;
    nextVolleyId = 1;
    startWhenLettersClear = false;
    replayWhenLettersClear = false;
    startDelay = -1;
    hud.hideEnd();
    hud.hideTip();
    hud.setCallout('');
    hud.setHudActive(true);
    hud.update({ score, timeRemaining: duration, lockCount: 0, health: currentHealthForHud() });
    bus.emit('runstart', { runNumber, duration, totalEnemies: timelineTotalEnemies });
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
    hud.update({ score, timeRemaining: duration, lockCount: locks.length, health: readyHealthForHud() });
  }

  function updateRunning(dt: number) {
    runTime = Math.min(duration, runTime + dt);
    const runProgress = easeRunProgress(runTime, duration);
    updateRunCamera(runProgress, dt);
    updateReticle();
    spawnDueEnemies();
    if (state !== 'running') return;
    updateEnemies(runProgress);
    if (state !== 'running') return;
    updateLocks();
    if (input.consumeRelease()) releaseLocks();
    updatePendingShots();
    updateProjectiles(dt);

    hud.update({
      score,
      timeRemaining: Math.max(0, duration - runTime),
      lockCount: locks.length,
      health: currentHealthForHud(),
    });

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
    hud.update({ score, timeRemaining: 0, lockCount: locks.length, health: readyHealthForHud() });
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

  function spawnEnemy(entry: LockOnSpawnEntry<TKind, TData>, dynamic = false) {
    const id = nextEnemyId;
    nextEnemyId += 1;
    if (dynamic && countsEntryTowardTotal(entry)) dynamicCountedEnemies += 1;
    const mesh = visuals.createEnemyMesh(entry.kind, entry.letter);
    const enemy: Enemy<TKind, TData> = {
      id,
      kind: entry.kind,
      purpose: 'enemy',
      mesh,
      spawnTime: runTime,
      locked: false,
      hitPointsRemaining: normalizedHitPoints(entry),
      entry,
      letter: entry.letter,
    };
    scene.add(mesh);
    enemies.set(id, enemy);
    updateEnemy(enemy, easeRunProgress(runTime, duration));
    bus.emit('spawn', { enemyId: id, kind: enemy.kind, worldPosition: mesh.position.clone(), letter: enemy.letter });
    return id;
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
        hitPointsRemaining: 1,
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
      const despawn = updateEnemy(enemy, runProgress);
      // damagePlayer inside updateEnemy can end the run; endRun already
      // cleared the field, so stop before double-missing anything.
      if (state !== 'running') return;
      if (despawn) missEnemy(enemy);
    }
  }

  function updateEnemy(enemy: Enemy<TKind, TData>, runProgress: number) {
    if (!enemy.entry || enemy.kind === 'letter') return false;
    return level.updateEnemy({
      enemy: toPublicEnemy(enemy),
      runTime,
      runProgress,
      age: Math.max(0, runTime - enemy.spawnTime),
      curve,
      camera,
      spawnEnemy: enemyUpdateHelpers.spawnEnemy,
      damagePlayer: enemyUpdateHelpers.damagePlayer,
      playerHealth: hasPlayerHealth ? health : Infinity,
    }) === true;
  }

  function toPublicEnemy(enemy: Enemy<TKind, TData>): LockOnEnemy<TKind, TData> {
    if (!enemy.entry || enemy.kind === 'letter') throw new Error('Enemy entry is required');
    return {
      id: enemy.id,
      kind: enemy.kind,
      mesh: enemy.mesh,
      spawnTime: enemy.spawnTime,
      entry: enemy.entry,
      letter: enemy.letter,
      hitPointsRemaining: enemy.hitPointsRemaining,
    };
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
      if (enemy.purpose === 'enemy' && enemy.entry?.lockable === false) continue;
      const projected = enemy.mesh.position.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const dx = projected.x - input.state.pointerNdc.x;
      const dy = projected.y - input.state.pointerNdc.y;
      if (Math.hypot(dx, dy) <= lockRadiusNdc) lockEnemy(enemy);
    }

    if (state === 'attract' && countLockedLetters('start-letter') === startWord.length) {
      attractReachedFullLocks = true;
      hud.hideTip();
    }
  }

  function lockEnemy(enemy: Enemy<TKind, TData>) {
    enemy.locked = true;
    locks.push(enemy.id);
    visuals.setEnemyLocked(enemy.mesh, true, locks.length);
    bus.emit('lock', {
      enemyId: enemy.id,
      lockCount: locks.length,
      worldPosition: enemy.mesh.position.clone(),
      letter: enemy.letter,
    });
    if (locks.length === MAX_LOCKS) flashMaxLock();
  }

  function flashMaxLock() {
    const rect = canvas.getBoundingClientRect();
    hud.flashMaxLock(
      rect.left + ((input.state.pointerNdc.x + 1) / 2) * rect.width,
      rect.top + ((1 - input.state.pointerNdc.y) / 2) * rect.height,
    );
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
    const released = [...locks];
    const releasedEnemies = released.map((enemyId) => enemies.get(enemyId)).filter((enemy) => enemy !== undefined);
    if (level.validateRelease && !level.validateRelease(releasedEnemies.map((enemy) => toPublicEnemy(enemy)))) {
      unlockReleased(released);
      for (const enemy of releasedEnemies) visuals.setEnemyDenied?.(enemy.mesh);
      bus.emit('reject', { enemyIds: releasedEnemies.map((enemy) => enemy.id), size: releasedEnemies.length });
      return;
    }
    fireLocks(released);
  }

  function releaseLetterLocks(purpose: Extract<TargetPurpose, 'start-letter' | 'replay-letter'>, required: number) {
    const released = [...locks];
    const matching = released.filter((enemyId) => enemies.get(enemyId)?.purpose === purpose);
    if (matching.length !== required) {
      unlockReleased(released);
      if (purpose === 'start-letter') {
        failedAttractReleases += 1;
        if (failedAttractReleases >= 3) {
          showingStartTip = false;
          hud.setTip(CONTROL_TIP);
          hud.showTip();
        }
      }
      return;
    }

    if (purpose === 'start-letter') startWhenLettersClear = true;
    if (purpose === 'replay-letter') replayWhenLettersClear = true;
    fireLocks(matching);
  }

  function undoLastLock() {
    const enemyId = locks.pop();
    if (enemyId === undefined) return;
    const enemy = enemies.get(enemyId);
    if (!enemy) return;
    unlockEnemy(enemy);
  }

  function fireLocks(released: number[]) {
    locks.length = 0;
    const releasedEnemies = released.map((enemyId) => enemies.get(enemyId)).filter((enemy) => enemy !== undefined);
    if (releasedEnemies.length === 0) return;
    const volleyId = state === 'running' ? createVolley(releasedEnemies) : undefined;

    releasedEnemies.forEach((enemy, index) => {
      enemy.locked = false;
      visuals.setEnemyLocked(enemy.mesh, false);
      bus.emit('unlock', {
        enemyId: enemy.id,
        lockCount: locks.length,
        worldPosition: enemy.mesh.position.clone(),
        letter: enemy.letter,
      });
      pendingShots.push({
        projectileId: nextProjectileId,
        enemyId: enemy.id,
        volleySize: releasedEnemies.length,
        fireAt: worldTime + index * FIRE_STAGGER,
        origin: reticlePoint.clone(),
        volleyId,
        indexInVolley: volleyId === undefined ? undefined : index,
      });
      nextProjectileId += 1;
    });
  }

  function createVolley(releasedEnemies: Array<Enemy<TKind, TData>>) {
    const volleyId = nextVolleyId;
    nextVolleyId += 1;
    volleys.set(volleyId, {
      id: volleyId,
      members: releasedEnemies.map((enemy) => ({ enemy: toPublicEnemy(enemy) })),
      unresolved: releasedEnemies.length,
    });
    return volleyId;
  }

  function resolveVolleyMember(volleyId: number | undefined, indexInVolley: number | undefined, killed: boolean) {
    if (volleyId === undefined || indexInVolley === undefined) return;
    const volley = volleys.get(volleyId);
    if (!volley) return;
    const member = volley.members[indexInVolley];
    if (!member || member.killed !== undefined) return;
    member.killed = killed;
    volley.unresolved -= 1;
    if (volley.unresolved > 0) return;
    volleys.delete(volleyId);
    if (state !== 'running') return;
    const results = volley.members.map((resolved) => ({
      enemy: resolved.enemy,
      killed: resolved.killed === true,
    }));
    const scoreAwarded = level.scoreForVolley?.(results) ?? 0;
    score += scoreAwarded;
    bus.emit('volley', {
      volleyId,
      size: volley.members.length,
      kills: results.filter((result) => result.killed).length,
      scoreAwarded,
    });
  }

  function resolveTargetLoss(enemyId: number) {
    for (let i = pendingShots.length - 1; i >= 0; i -= 1) {
      const shot = pendingShots[i];
      if (shot.enemyId !== enemyId) continue;
      pendingShots.splice(i, 1);
      resolveVolleyMember(shot.volleyId, shot.indexInVolley, false);
    }
    for (const projectile of [...projectiles.values()]) {
      if (projectile.enemyId !== enemyId) continue;
      removeProjectile(projectile);
      resolveVolleyMember(projectile.volleyId, projectile.indexInVolley, false);
    }
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
      if (!enemy) {
        resolveVolleyMember(shot.volleyId, shot.indexInVolley, false);
        continue;
      }
      const mesh = visuals.createProjectileMesh();
      mesh.position.copy(shot.origin);
      scene.add(mesh);
      projectiles.set(shot.projectileId, {
        id: shot.projectileId,
        enemyId: shot.enemyId,
        volleySize: shot.volleySize,
        mesh,
        velocity: enemy.mesh.position.clone().sub(shot.origin).normalize().multiplyScalar(PROJECTILE_SPEED),
        volleyId: shot.volleyId,
        indexInVolley: shot.indexInVolley,
      });
      bus.emit('fire', {
        projectileId: shot.projectileId,
        enemyId: shot.enemyId,
        volleySize: shot.volleySize,
        worldPosition: shot.origin.clone(),
        targetPosition: enemy.mesh.position.clone(),
        letter: enemy.letter,
        volleyId: shot.volleyId,
        indexInVolley: shot.indexInVolley,
      });
    }
  }

  function updateProjectiles(dt: number) {
    for (const projectile of [...projectiles.values()]) {
      const enemy = enemies.get(projectile.enemyId);
      if (!enemy) {
        removeProjectile(projectile);
        resolveVolleyMember(projectile.volleyId, projectile.indexInVolley, false);
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

    if (enemy.kind === 'letter') {
      bus.emit('hit', {
        enemyId: enemy.id,
        projectileId: projectile.id,
        worldPosition: worldPosition.clone(),
        letter: enemy.letter,
        volleyId: projectile.volleyId,
        indexInVolley: projectile.indexInVolley,
        lethal: true,
        hitPointsRemaining: 0,
      });
      removeProjectile(projectile);
      removeEnemy(enemy);
      bus.emit('kill', {
        enemyId: enemy.id,
        worldPosition,
        scoreAwarded: 0,
        letter: enemy.letter,
        volleyId: projectile.volleyId,
        indexInVolley: projectile.indexInVolley,
      });
      resolveVolleyMember(projectile.volleyId, projectile.indexInVolley, true);
      return;
    }

    enemy.hitPointsRemaining = Math.max(0, enemy.hitPointsRemaining - 1);
    const lethal = enemy.hitPointsRemaining <= 0;
    bus.emit('hit', {
      enemyId: enemy.id,
      projectileId: projectile.id,
      worldPosition: worldPosition.clone(),
      letter: enemy.letter,
      volleyId: projectile.volleyId,
      indexInVolley: projectile.indexInVolley,
      lethal,
      hitPointsRemaining: enemy.hitPointsRemaining,
    });
    removeProjectile(projectile);

    const publicEnemy = toPublicEnemy(enemy);
    if (!lethal) {
      const award = level.scoreForHit?.(projectile.volleySize, publicEnemy) ?? 0;
      score += award;
      resolveVolleyMember(projectile.volleyId, projectile.indexInVolley, true);
      return;
    }

    removeEnemy(enemy);
    if (countsEnemyTowardTotal(enemy)) kills += 1;
    const award = level.scoreForKill?.(projectile.volleySize, publicEnemy) ?? defaultScoreForKill(projectile.volleySize);
    score += award;
    bus.emit('kill', {
      enemyId: enemy.id,
      worldPosition,
      scoreAwarded: award,
      letter: enemy.letter,
      volleyId: projectile.volleyId,
      indexInVolley: projectile.indexInVolley,
    });
    resolveVolleyMember(projectile.volleyId, projectile.indexInVolley, true);
  }

  function missEnemy(enemy: Enemy<TKind, TData>) {
    const worldPosition = enemy.mesh.position.clone();
    if (enemy.locked) unlockEnemy(enemy);
    resolveTargetLoss(enemy.id);
    removeEnemy(enemy);
    if (countsEnemyTowardTotal(enemy)) missed += 1;
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
    if (attractPointerDowns >= 8) {
      showingStartTip = false;
      hud.setTip(CONTROL_TIP);
      hud.showTip();
    }
  }

  function countsEntryTowardTotal(entry: LockOnSpawnEntry<TKind, TData>) {
    return entry.countsTowardTotal !== false;
  }

  function countsEnemyTowardTotal(enemy: Enemy<TKind, TData>) {
    return enemy.purpose === 'enemy' && enemy.entry !== undefined && countsEntryTowardTotal(enemy.entry);
  }

  function normalizedHitPoints(entry: LockOnSpawnEntry<TKind, TData>) {
    return Math.max(1, entry.hitPoints ?? 1);
  }

  function currentHealthForHud() {
    if (!hasPlayerHealth) return undefined;
    return { current: health, max: maxPlayerHealth };
  }

  function readyHealthForHud() {
    if (!hasPlayerHealth) return undefined;
    return { current: maxPlayerHealth, max: maxPlayerHealth };
  }

  function applyPlayerDamage(amount = 1) {
    if (state !== 'running' || !hasPlayerHealth) return;
    if (worldTime < invulnerableUntil) return;
    const damage = Math.max(0, amount);
    health = Math.max(0, health - damage);
    invulnerableUntil = worldTime + PLAYER_INVULNERABILITY_SECONDS;
    bus.emit('playerhit', { damage, healthRemaining: health });
    hud.flashDamage();
    if (health <= 0) endRun(true);
  }

  function endRun(died = false) {
    if (state === 'ended') return;
    state = 'ended';
    volleys.clear();
    for (const enemy of [...enemies.values()]) missEnemy(enemy);
    modeTime = 0;
    locks.length = 0;
    pendingShots.length = 0;
    for (const projectile of [...projectiles.values()]) removeProjectile(projectile);
    const totalEnemies = timelineTotalEnemies + dynamicCountedEnemies;
    const details = level.detailsForRun?.();
    const summary: RunSummary = {
      score,
      kills,
      missed,
      totalEnemies,
      rank: died ? '—' : (level.rankForRun?.(score, kills, totalEnemies) ?? defaultRankForRun(score, kills, totalEnemies)),
      details: details && details.length > 0 ? details : undefined,
      died: died || undefined,
    };
    hud.setHudActive(false);
    hud.update({ score, timeRemaining: 0, lockCount: 0, health: readyHealthForHud() });
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
    volleys.clear();
    locks.length = 0;
  }

  enterAttract();

  return {
    start: startRun,
    update,
    dispose() {
      document.removeEventListener('fullscreenchange', updateStartTipVisibility);
      input.dispose();
      scene.remove(reticle);
      clearRunObjects();
    },
    get state() {
      return state;
    },
  };
}
