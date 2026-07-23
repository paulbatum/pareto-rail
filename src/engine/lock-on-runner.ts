import { Box3, Group, MathUtils, type Material, Object3D, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import {
  setActionSfxQuantization,
  setShotDelaySettings,
  shotDelayForIndex,
} from './action-sfx-quantization';
import type {
  LockOnEnemy,
  LockOnRunnerLevel,
  LockOnRunnerOptions,
  LockOnSpawnEntry,
} from './lock-on-runner-types';
export type {
  LockOnAttractCameraUpdate,
  LockOnCameraEffectsUpdate,
  LockOnEnemy,
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnRunnerOptions,
  LockOnSpawnEntry,
} from './lock-on-runner-types';
import { createInput } from './input';
import { MAX_LOCKS } from './locks';
import { getPlayerCameraSettings } from './player-camera';
import { smoothRunProgress } from './rail';
import { scoreForKill as defaultScoreForKill, rankForRun as defaultRankForRun, type RunSummary } from './scoring';

export const RETICLE_DISTANCE = 24;
const RETICLE_RENDER_ORDER = 1000;

// The game's vertical field of view. Shared so the offline harness measures
// the reticle against the same projection the game renders it with.
export const GAME_FOV_DEGREES = 62;

// The drawn reticle must depict at least this fraction of the lock radius; a
// smaller one locks targets visibly outside the sight, so the engine scales it
// up to this floor.
export const RETICLE_MIN_VISUAL_FRACTION = 0.5;

// The reticle's XY half-extent at RETICLE_DISTANCE, expressed as an NDC radius:
// the same units lockRadiusNdc uses, so the two are directly comparable.
export function measureReticleVisualNdc(reticle: Object3D, fovDeg: number): number {
  const box = new Box3().setFromObject(reticle);
  if (box.isEmpty()) return 0;
  const radius = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.y), Math.abs(box.max.y));
  return radius / (RETICLE_DISTANCE * Math.tan((fovDeg * Math.PI) / 360));
}

// Factor the rendered reticle must be scaled by to reach the visual floor.
// Never below 1: an already-large reticle is left as the level drew it.
export function reticleCorrectionScale(visualNdc: number, lockRadiusNdc: number): number {
  if (!(visualNdc > 0)) return 1;
  return Math.max(1, (RETICLE_MIN_VISUAL_FRACTION * lockRadiusNdc) / visualNdc);
}

// The reticle sits at a real world depth, so level geometry closer than
// RETICLE_DISTANCE would otherwise swallow it. It reads as a sight, not as an
// object in the world, so draw it last and ignore the depth buffer.
function keepReticleOnTop(reticle: Object3D) {
  reticle.traverse((child) => {
    child.renderOrder = RETICLE_RENDER_ORDER;
    const { material } = child as { material?: Material | Material[] };
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      entry.depthTest = false;
      entry.depthWrite = false;
    }
  });
}
export const LOCK_RADIUS_NDC = 0.085;
const PROJECTILE_SPEED = 82;
const PROJECTILE_MAX_SPEED = PROJECTILE_SPEED * 3;
const PROJECTILE_HIT_RADIUS = 1.15;
const WORD_DISTANCE = 20;
export const START_WORD = 'START!';
export const REPLAY_WORD = 'REPLAY';
const PLAYER_INVULNERABILITY_SECONDS = 0.9;
const REPEAT_LOCK_DELAY = 0.18;
const EDGE_LOOK_EXPONENT = 1.35;
const EDGE_LOOK_RESPONSE = 9;

// Shot delays quantize each impact to the music, so a projectile's planned
// arrival is a contract: re-solving speed from the live distance every frame
// keeps the appointment even when the target moves after release (fast levels
// pace enemies along the rail). Overdue or unreachable shots close at the
// speed ceiling instead of drifting past their beat indefinitely.
function impactContractSpeed(distance: number, remainingSeconds: number) {
  return Math.min(PROJECTILE_MAX_SPEED, distance / Math.max(0.05, remainingSeconds));
}

// Matches how the client-tip helper distinguishes touch from mouse, so the
// instruction prompt speaks the right verb on each device.
function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches;
}

declare global {
  interface Window {
    __raildDebug?: {
      immortal?: boolean;
    };
  }
}

type RunState = 'attract' | 'running' | 'ended';
// The START! screen teaches the hold-sweep-release control with a single
// prompt that follows live input: hold, then sweep every letter, then
// release; an early release asks for the whole word before letting go.
type PromptStage = 'tap' | 'hold' | 'sweep' | 'release' | 'rejected';
type TargetPurpose = 'enemy' | 'start-letter' | 'replay-letter';
type ReleaseRejectReason = 'incomplete-word' | 'level-rule';
type ReleaseValidation<TKind extends string, TData> =
  | { valid: true; fireIds: number[]; denied?: Array<Enemy<TKind, TData>> }
  | {
    valid: false;
    reason: ReleaseRejectReason;
    released: Array<Enemy<TKind, TData>>;
    missing: Array<Enemy<TKind, TData>>;
    required: Array<Enemy<TKind, TData>>;
  };

type Enemy<TKind extends string, TData> = {
  id: number;
  kind: TKind | 'letter';
  purpose: TargetPurpose;
  mesh: Object3D;
  spawnTime: number;
  locked: boolean;
  lastLockedAt: number;
  hitStages: number[];
  hitStageIndex: number;
  hitPointsRemaining: number;
  entry?: LockOnSpawnEntry<TKind, TData>;
  updateState?: unknown;
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
  impactAt: number;
  volleyId?: number;
  indexInVolley?: number;
};

type Projectile = {
  id: number;
  enemyId: number;
  volleySize: number;
  mesh: Object3D;
  velocity: Vector3;
  speed: number;
  impactAt: number;
  lastTargetPosition: Vector3;
  volleyId?: number;
  indexInVolley?: number;
};

type Volley<TKind extends string, TData> = {
  id: number;
  members: Array<{ enemy: LockOnEnemy<TKind, TData>; killed?: boolean }>;
  unresolved: number;
};

export function createLockOnRunner<TKind extends string = string, TData = unknown>(
  options: LockOnRunnerOptions<TKind, TData>,
) {
  // `startTip` is intentionally not destructured: the staged instruction prompt
  // below supersedes it. The option is retained on the type for compatibility
  // with levels that still pass one (see lock-on-runner-types.ts).
  const { scene, camera, canvas, bus, hud, visuals, onPause, onFullscreen, level } = options;
  const duration = level.duration;
  if (!Number.isFinite(level.bpm) || level.bpm <= 0) throw new Error('Lock-on runner level bpm must be a positive number');
  const beatSeconds = 60 / level.bpm;
  const thirtysecondSeconds = beatSeconds / 8;
  if (level.timing?.shotDelay) setShotDelaySettings(level.timing.shotDelay);
  if (level.timing?.actionSfx) setActionSfxQuantization(level.timing.actionSfx);
  const startWord = level.startWord ?? START_WORD;
  const replayWord = level.replayWord ?? REPLAY_WORD;
  const lockRadiusNdc = level.lockRadiusNdc ?? LOCK_RADIUS_NDC;
  const curve = level.createRail();
  const easeRunProgress = level.easeRunProgress ?? smoothRunProgress;
  const timelineTotalEnemies = level.spawnTimeline.filter((entry) => countsEntryTowardTotal(entry)).length;
  const hasPlayerHealth = level.playerHealth !== undefined;
  const maxPlayerHealth = level.playerHealth ?? Infinity;
  let lastBeatWorldTime = -Infinity;
  let lastBeatMusicTime = 0;
  const offBeat = bus.on('beat', ({ beatNumber }) => {
    lastBeatWorldTime = worldTime;
    lastBeatMusicTime = beatNumber * beatSeconds;
  });
  const input = createInput(canvas, {
    onRestart: () => startRun(),
    onPause,
    onFullscreen,
    onUndoLock: () => {
      if (level.allowLockUndo) undoLastLock();
    },
  });
  const raycaster = new Raycaster();
  const reticle = visuals.createReticle();
  reticle.userData.raildRole = 'reticle';
  // A level draws its own sight, but the acquisition radius is the engine's. If
  // the drawn reticle is far smaller than the lock radius it locks targets well
  // outside the ring, so scale an under-drawn reticle up to the visual floor.
  // Levels animate reticle.scale every frame in setReticleActive, so the
  // correction rides on an engine-owned wrapper the level never touches; the
  // inner group keeps its authored transform. Only wrap when a correction is
  // actually needed, so a well-drawn reticle stays exactly as the level built
  // it. When wrapping, the wrapper adopts the inner reticle's userData (shared
  // by reference) so levels that look the reticle up from the scene by
  // raildRole still see its spinner/active/lockCount state through the wrapper.
  const reticleScale = reticleCorrectionScale(measureReticleVisualNdc(reticle, camera.fov), lockRadiusNdc);
  let reticleWrapper: Group | undefined;
  if (reticleScale > 1) {
    reticleWrapper = new Group();
    reticleWrapper.userData = reticle.userData;
    reticleWrapper.scale.setScalar(reticleScale);
    reticleWrapper.add(reticle);
  }
  const reticleRoot: Object3D = reticleWrapper ?? reticle;
  keepReticleOnTop(reticleRoot);

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
  let startWhenLettersClear = false;
  let replayWhenLettersClear = false;
  let startDelay = -1;
  let runEase = 0;
  let promptStage: PromptStage | undefined;
  // Latched when a letter word is released before every letter is locked; the
  // prompt asks for the whole word until the next hold begins.
  let promptReleaseRejected = false;
  const easeFromPosition = new Vector3();
  const easeFromLook = new Vector3(0, 0, -1);
  const cameraBaseQuaternion = new Quaternion();
  const smoothedEdgeLook = new Vector2();
  const targetEdgeLook = new Vector2();

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

  scene.add(reticleRoot);

  // The staged instruction prompt for the START! letter screen. It shows in
  // the HUD tip element and advances with live input: hold, sweep, release,
  // and a rejection notice after an early release. The tip is only rewritten
  // when the stage changes, not every frame. The end screen gets no prompt:
  // its card already fills the bottom of the screen, and the player has done
  // the gesture once by then.
  function letterPrompt(): { purpose: TargetPurpose; wordLength: number } | undefined {
    if (state === 'attract') return { purpose: 'start-letter', wordLength: startWord.length };
    return undefined;
  }

  /* iOS only grants user activation for a *tap* — never at touch-down, and never at the
     end of a touch that moved. Every game gesture is a drag, so on a fresh deep link none
     of them can ever legally start audio; the browser needs one plain tap first. The tap
     stage asks for it, and the window-level unlock listeners turn it into sound. Once a
     click-navigated page unlocks eagerly (or the tap lands), the stage never shows. */
  function needsSoundTap() {
    if (!isCoarsePointer() || hud.isSoundActive()) return false;
    return navigator.userActivation?.hasBeenActive !== true;
  }

  function currentPromptStage(prompt: { purpose: TargetPurpose; wordLength: number }): PromptStage {
    if (promptReleaseRejected) return 'rejected';
    if (!input.state.pointerDown) return needsSoundTap() ? 'tap' : 'hold';
    if (countLockedLetters(prompt.purpose) >= prompt.wordLength) return 'release';
    return 'sweep';
  }

  function promptText(stage: PromptStage): string {
    switch (stage) {
      case 'tap':
        return 'TAP to turn on sound';
      case 'hold':
        return isCoarsePointer() ? 'TOUCH and hold' : 'HOLD the mouse button';
      case 'sweep':
        return 'SWEEP across all the letters';
      case 'release':
        return 'RELEASE!';
      case 'rejected':
        return 'Lock every letter before letting go';
    }
  }

  function updateInstructionPrompt() {
    const prompt = letterPrompt();
    if (!prompt) return;
    // A completed word is launching the run/replay; leave the prompt frozen on
    // its last stage until the state change hides the tip.
    if (startWhenLettersClear || replayWhenLettersClear) return;
    if (input.state.pointerDown) promptReleaseRejected = false;
    const stage = currentPromptStage(prompt);
    if (stage === promptStage) return;
    promptStage = stage;
    hud.setTip(promptText(stage), { preserveCase: true });
    hud.showTip();
  }

  function enterAttract() {
    clearRunObjects();
    state = 'attract';
    modeTime = 0;
    promptStage = undefined;
    promptReleaseRejected = false;
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
    /* The start nudges (sound, rotate, fullscreen) are their own elements, shown for as long
       as the player is on the attract screen alongside the staged instruction prompt. */
    hud.setStartNudgesVisible(true);
    hud.setHudActive(false);
    hud.update({ score, elapsedTime: 0, health: readyHealthForHud() });
    updateAttractCamera(0);
    updateReticle();
    spawnWord(startWord, 'start-letter');
    updateInstructionPrompt();
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
    hud.setStartNudgesVisible(false);
    hud.setCallout('');
    hud.setHudActive(true);
    hud.update({ score, elapsedTime: 0, health: currentHealthForHud() });
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
    updateInstructionPrompt();
    hud.update({ score, elapsedTime: 0, health: readyHealthForHud() });
  }

  function updateRunning(dt: number) {
    runTime = Math.min(duration, runTime + dt);
    const runProgress = easeRunProgress(runTime, duration);
    updateRunCamera(runProgress, dt);
    level.updateCameraEffects?.({ camera, curve, runTime, runProgress, dt });
    updateReticle();
    spawnDueEnemies();
    if (state !== 'running') return;
    updateEnemies(runProgress);
    if (state !== 'running') return;
    updateLocks();
    if (input.consumeRelease()) releaseLocks();
    updatePendingShots();
    updateProjectiles(dt);

    hud.update({ score, elapsedTime: runTime, health: currentHealthForHud() });

    if (runTime >= duration) endRun();
  }

  function updateEnded(dt: number) {
    applyEdgeLook(dt);
    updateReticle();
    updateLetterTargets();
    updateLocks();
    if (input.consumeRelease()) releaseLocks();
    updatePendingShots();
    updateProjectiles(dt);
    updateLetterStartDelay(dt);
    hud.update({ score, elapsedTime: runTime, health: readyHealthForHud() });
  }

  function updateAttractCamera(dt: number) {
    // Establish the default attract pose before the level hook, giving
    // updateAttractCamera the same contract as updateCameraEffects: a
    // freshly-placed camera it may overwrite or nudge. Without the reset, an
    // incremental adjustment like `camera.rotation.z +=` integrates across
    // frames into a frame-rate-dependent roll.
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
    level.updateAttractCamera?.({ camera, curve, modeTime, dt });
    captureCameraBaseAndApplyEdgeLook(dt);
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
    captureCameraBaseAndApplyEdgeLook(dt);
  }

  function captureCameraBaseAndApplyEdgeLook(dt: number) {
    cameraBaseQuaternion.copy(camera.quaternion);
    applyEdgeLook(dt);
  }

  function applyEdgeLook(dt: number) {
    const settings = getPlayerCameraSettings();
    targetEdgeLook.set(
      edgeCurve(input.state.pointerNdc.x, settings.edgeDeadZone),
      edgeCurve(input.state.pointerNdc.y, settings.edgeDeadZone),
    );
    const alpha = dt <= 0 ? 1 : 1 - Math.exp(-EDGE_LOOK_RESPONSE * dt);
    smoothedEdgeLook.lerp(targetEdgeLook, Math.min(1, alpha));

    camera.quaternion.copy(cameraBaseQuaternion);
    const yaw = -MathUtils.degToRad(settings.edgeLookDegrees) * smoothedEdgeLook.x;
    const pitch = MathUtils.degToRad(settings.edgeLookDegrees) * smoothedEdgeLook.y;
    const roll = -MathUtils.degToRad(settings.edgeRollDegrees) * smoothedEdgeLook.x;
    if (yaw !== 0) camera.rotateY(yaw);
    if (pitch !== 0) camera.rotateX(pitch);
    if (roll !== 0) camera.rotateZ(roll);
    camera.updateMatrixWorld();
  }

  function edgeCurve(value: number, deadZone: number) {
    const sign = Math.sign(value);
    const activeRange = 1 - deadZone;
    const magnitude = activeRange <= 0 ? 1 : Math.max(0, Math.min(1, Math.abs(value)) - deadZone) / activeRange;
    return sign * magnitude ** EDGE_LOOK_EXPONENT;
  }

  function updateReticle() {
    raycaster.setFromCamera(input.state.pointerNdc, camera);
    reticlePoint.copy(raycaster.ray.direction).multiplyScalar(RETICLE_DISTANCE).add(raycaster.ray.origin);
    // Position and correction scale live on the root (the wrapper when present);
    // orientation and the level's per-frame reticle.scale/rotation stay on the
    // inner group. When unwrapped the root is the inner group, so this matches
    // the original single-object behaviour exactly.
    reticleRoot.position.copy(reticlePoint);
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
    const hitStages = normalizedHitStages(entry);
    const mesh = visuals.createEnemyMesh(entry.kind, entry.letter);
    markTargetMesh(mesh, id, 'enemy', entry.kind, entry.letter);
    const enemy: Enemy<TKind, TData> = {
      id,
      kind: entry.kind,
      purpose: 'enemy',
      mesh,
      spawnTime: runTime,
      locked: false,
      lastLockedAt: -Infinity,
      hitStages,
      hitStageIndex: 0,
      hitPointsRemaining: hitStages[0],
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
      markTargetMesh(mesh, id, purpose, 'letter', letter);
      const target: Enemy<TKind, TData> = {
        id,
        kind: 'letter',
        purpose,
        mesh,
        spawnTime: worldTime,
        locked: false,
        lastLockedAt: -Infinity,
        hitStages: [1],
        hitStageIndex: 0,
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
    return updateActiveEnemy(enemy as Enemy<TKind, TData> & { entry: LockOnSpawnEntry<TKind, TData> }, runProgress);
  }

  function updateActiveEnemy(enemy: Enemy<TKind, TData> & { entry: LockOnSpawnEntry<TKind, TData> }, runProgress: number) {
    return level.updateEnemy({
      enemy: toPublicEnemy(enemy),
      runTime,
      runProgress,
      age: Math.max(0, runTime - enemy.spawnTime),
      curve,
      camera,
      railAnchor: (lead) => easeRunProgress(Math.min(duration, enemy.entry.time + lead), duration),
      enemyState: <S>(init: () => S): S => (enemy.updateState ??= init()) as S,
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
      hitPointsRemaining: totalHitPointsRemaining(enemy),
      hitStageIndex: enemy.hitStageIndex,
      hitStageCount: enemy.hitStages.length,
      stageHitPointsRemaining: enemy.hitPointsRemaining,
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

  // The letter screens ask for the whole word at once, so the run cap would
  // make a word longer than MAX_LOCKS impossible to spell. Only letters are
  // lockable there and each takes a single lock, so the word length is itself
  // the cap.
  function maxLocksForState() {
    if (state === 'attract') return startWord.length;
    if (state === 'ended') return replayWord.length;
    return MAX_LOCKS;
  }

  function updateLocks() {
    const maxLocks = maxLocksForState();
    if (!input.state.pointerDown || locks.length >= maxLocks) return;

    for (const enemy of lockPriorityTargets()) {
      if (locks.length >= maxLocks) return;
      if (!canLockEnemy(enemy)) continue;
      const projected = enemy.mesh.position.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const dx = projected.x - input.state.pointerNdc.x;
      const dy = projected.y - input.state.pointerNdc.y;
      if (Math.hypot(dx, dy) <= lockRadiusNdc) lockEnemy(enemy);
    }
  }

  function lockPriorityTargets() {
    return [...enemies.values()].sort((a, b) => Number(isHostileProjectile(b)) - Number(isHostileProjectile(a)));
  }

  function canLockEnemy(enemy: Enemy<TKind, TData>) {
    if (enemy.purpose === 'enemy' && enemy.entry?.lockable === false) return false;
    const existingLocks = lockCountForEnemy(enemy.id);
    if (existingLocks >= lockCapacityForEnemy(enemy)) return false;
    if (existingLocks > 0 && worldTime - enemy.lastLockedAt < REPEAT_LOCK_DELAY) return false;
    return true;
  }

  function lockCapacityForEnemy(enemy: Enemy<TKind, TData>) {
    if (enemy.purpose !== 'enemy') return 1;
    return Math.min(MAX_LOCKS, Math.max(1, enemy.hitPointsRemaining));
  }

  function lockCountForEnemy(enemyId: number) {
    let count = 0;
    for (const lockedId of locks) if (lockedId === enemyId) count += 1;
    return count;
  }

  function lockEnemy(enemy: Enemy<TKind, TData>) {
    enemy.locked = true;
    enemy.lastLockedAt = worldTime;
    locks.push(enemy.id);
    visuals.setEnemyLocked(enemy.mesh, true, locks.length);
    bus.emit('lock', {
      enemyId: enemy.id,
      lockCount: locks.length,
      worldPosition: enemy.mesh.position.clone(),
      letter: enemy.letter,
    });
    if (locks.length === maxLocksForState()) flashMaxLock();
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
    const released = [...locks];
    const validation = validateRelease(released);
    if (!validation.valid) {
      denyRelease(validation);
      return;
    }
    if (validation.denied && validation.denied.length > 0) {
      denyRelease({
        valid: false,
        reason: 'level-rule',
        released: validation.denied,
        missing: [],
        required: [],
      });
    }
    fireLocks(validation.fireIds);
  }

  function validateRelease(releasedIds: number[]): ReleaseValidation<TKind, TData> {
    const releasedTargets = targetsForIds(releasedIds);
    if (state === 'attract') return validateLetterRelease('start-letter', startWord.length, releasedTargets);
    if (state === 'ended') return validateLetterRelease('replay-letter', replayWord.length, releasedTargets);

    const releasedEnemies = releasedTargets.filter((enemy) => enemy.purpose === 'enemy');
    const releaseVerdict = level.validateRelease?.(releasedEnemies.map((enemy) => toPublicEnemy(enemy))) ?? true;
    if (releaseVerdict === false) {
      return { valid: false, reason: 'level-rule', released: releasedEnemies, missing: [], required: [] };
    }
    if (Array.isArray(releaseVerdict)) {
      const allowedIds = new Set(releaseVerdict.map((enemy) => enemy.id));
      const allowedReleased = releasedEnemies.filter((enemy) => allowedIds.has(enemy.id));
      if (allowedReleased.length === 0) {
        return { valid: false, reason: 'level-rule', released: releasedEnemies, missing: [], required: [] };
      }
      return {
        valid: true,
        fireIds: allowedReleased.map((enemy) => enemy.id),
        denied: releasedEnemies.filter((enemy) => !allowedIds.has(enemy.id)),
      };
    }
    return { valid: true, fireIds: releasedEnemies.map((enemy) => enemy.id) };
  }

  function validateLetterRelease(
    purpose: Extract<TargetPurpose, 'start-letter' | 'replay-letter'>,
    required: number,
    releasedTargets: Array<Enemy<TKind, TData>>,
  ): ReleaseValidation<TKind, TData> {
    const requiredTargets = [...enemies.values()].filter((enemy) => enemy.purpose === purpose);
    const releasedLetters = releasedTargets.filter((enemy) => enemy.purpose === purpose);
    if (releasedLetters.length === required) {
      if (purpose === 'start-letter') startWhenLettersClear = true;
      if (purpose === 'replay-letter') replayWhenLettersClear = true;
      return { valid: true, fireIds: releasedLetters.map((enemy) => enemy.id) };
    }

    const releasedLetterIds = new Set(releasedLetters.map((enemy) => enemy.id));
    return {
      valid: false,
      reason: 'incomplete-word',
      released: releasedTargets,
      missing: requiredTargets.filter((enemy) => !releasedLetterIds.has(enemy.id)),
      required: requiredTargets,
    };
  }

  function denyRelease(rejection: Extract<ReleaseValidation<TKind, TData>, { valid: false }>) {
    unlockReleased(rejection.released.map((enemy) => enemy.id));
    const deniedTargets = uniqueTargets([...rejection.released, ...rejection.missing]);
    for (const enemy of deniedTargets) visuals.setEnemyDenied(enemy.mesh);
    bus.emit('reject', {
      enemyIds: rejection.released.map((enemy) => enemy.id),
      size: rejection.released.length,
      reason: rejection.reason,
      requiredEnemyIds: rejection.required.map((enemy) => enemy.id),
      missingEnemyIds: rejection.missing.map((enemy) => enemy.id),
    });

    if (rejection.reason === 'incomplete-word' && state === 'attract') {
      // The staged prompt picks this up on the next frame and asks for the
      // whole word until the player holds again.
      promptReleaseRejected = true;
    }
  }

  function targetsForIds(ids: number[]) {
    return ids.map((enemyId) => enemies.get(enemyId)).filter((enemy) => enemy !== undefined);
  }

  function uniqueTargets(targets: Array<Enemy<TKind, TData>>) {
    const unique = new Map<number, Enemy<TKind, TData>>();
    for (const target of targets) unique.set(target.id, target);
    return [...unique.values()];
  }

  function undoLastLock() {
    const enemyId = locks.pop();
    if (enemyId === undefined) return;
    const enemy = enemies.get(enemyId);
    if (!enemy) return;
    if (lockCountForEnemy(enemy.id) === 0) {
      enemy.locked = false;
      visuals.setEnemyLocked(enemy.mesh, false);
    }
    bus.emit('unlock', {
      enemyId: enemy.id,
      lockCount: locks.length,
      worldPosition: enemy.mesh.position.clone(),
      letter: enemy.letter,
    });
  }

  function fireLocks(released: number[]) {
    locks.length = 0;
    const releasedEnemies = prioritizeVolleyTargets(released.map((enemyId) => enemies.get(enemyId)).filter((enemy) => enemy !== undefined));
    if (releasedEnemies.length === 0) return;
    const volleyId = state === 'running' ? createVolley(releasedEnemies) : undefined;

    for (const enemy of uniqueTargets(releasedEnemies)) {
      enemy.locked = false;
      visuals.setEnemyLocked(enemy.mesh, false);
      bus.emit('unlock', {
        enemyId: enemy.id,
        lockCount: locks.length,
        worldPosition: enemy.mesh.position.clone(),
        letter: enemy.letter,
      });
    }

    const origin = reticlePoint.clone();
    const baselineTravelTimes = releasedEnemies.map((enemy) => enemy.mesh.position.distanceTo(origin) / PROJECTILE_SPEED);
    const releaseMusicTime = currentMusicTime();
    releasedEnemies.forEach((enemy, index) => {
      const shotDelay = shotDelayForIndex({
        index,
        volleySize: releasedEnemies.length,
        releaseTime: releaseMusicTime,
        baselineTravelTime: baselineTravelTimes[index] ?? 0,
        baselineTravelTimes,
        thirtysecondSeconds,
      });
      pendingShots.push({
        projectileId: nextProjectileId,
        enemyId: enemy.id,
        volleySize: releasedEnemies.length,
        fireAt: worldTime + shotDelay.releaseDelay,
        origin: origin.clone(),
        impactAt: worldTime + shotDelay.releaseDelay + (baselineTravelTimes[index] ?? 0) + shotDelay.travelDelay,
        volleyId,
        indexInVolley: volleyId === undefined ? undefined : index,
      });
      nextProjectileId += 1;
    });
  }

  function currentMusicTime() {
    if (Number.isFinite(lastBeatWorldTime) && worldTime - lastBeatWorldTime < beatSeconds * 8) {
      return lastBeatMusicTime + (worldTime - lastBeatWorldTime);
    }
    return worldTime;
  }

  function prioritizeVolleyTargets(targets: Array<Enemy<TKind, TData>>) {
    return targets
      .map((target, index) => ({ target, index }))
      .sort((a, b) => Number(isHostileProjectile(b.target)) - Number(isHostileProjectile(a.target)) || a.index - b.index)
      .map(({ target }) => target);
  }

  function isHostileProjectile(enemy: Enemy<TKind, TData>) {
    if (enemy.purpose !== 'enemy') return false;
    const role = roleForEntry(enemy.entry);
    return role === 'bolt' || role === 'flare' || enemy.kind === 'bolt' || enemy.kind === 'flare';
  }

  function roleForEntry(entry: LockOnSpawnEntry<TKind, TData> | undefined) {
    const data = entry?.data;
    if (typeof data !== 'object' || data === null || !('role' in data)) return undefined;
    const role = (data as { role?: unknown }).role;
    return typeof role === 'string' ? role : undefined;
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
    const releasedEnemies = uniqueTargets(released.map((enemyId) => enemies.get(enemyId)).filter((enemy) => enemy !== undefined));
    locks.length = 0;
    for (const enemy of releasedEnemies) {
      enemy.locked = false;
      visuals.setEnemyLocked(enemy.mesh, false);
      bus.emit('unlock', {
        enemyId: enemy.id,
        lockCount: locks.length,
        worldPosition: enemy.mesh.position.clone(),
        letter: enemy.letter,
      });
    }
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
      mesh.userData.raildRole = 'projectile';
      mesh.position.copy(shot.origin);
      scene.add(mesh);
      const toTarget = enemy.mesh.position.clone().sub(shot.origin);
      const distance = toTarget.length();
      const speed = impactContractSpeed(distance, shot.impactAt - worldTime);
      projectiles.set(shot.projectileId, {
        id: shot.projectileId,
        enemyId: shot.enemyId,
        volleySize: shot.volleySize,
        mesh,
        velocity: toTarget.normalize().multiplyScalar(speed),
        speed,
        impactAt: shot.impactAt,
        lastTargetPosition: enemy.mesh.position.clone(),
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

      // Targets can translate arbitrarily fast — rail-paced enemies, or
      // letters anchored to a moving camera. Feed the target's frame-to-frame
      // displacement forward so pursuit happens in the target's rest frame:
      // the speed contract, steering, and hit test then act on relative
      // distance, and convergence never depends on how the target moves.
      projectile.mesh.position.add(enemy.mesh.position.clone().sub(projectile.lastTargetPosition));
      projectile.lastTargetPosition.copy(enemy.mesh.position);

      const toTarget = enemy.mesh.position.clone().sub(projectile.mesh.position);
      const distance = toTarget.length();
      if (distance <= PROJECTILE_HIT_RADIUS) {
        hitEnemy(projectile, enemy);
        continue;
      }

      projectile.speed = impactContractSpeed(distance, projectile.impactAt - worldTime);
      const desired = toTarget.normalize().multiplyScalar(projectile.speed);
      // The smoothed steering caps turn rate at 8 rad/s, while the overdue
      // contract speed is proportional to distance — together those make a
      // stable orbit (turn radius = speed/8 ≥ distance) that a shot which
      // barely missed its beat can never leave. Overdue shots steer straight
      // at the target instead; distance-proportional speed then guarantees
      // convergence at any frame rate.
      if (worldTime >= projectile.impactAt) projectile.velocity.copy(desired);
      else projectile.velocity.lerp(desired, Math.min(1, dt * 8));
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
        hitStageIndex: 0,
        hitStageCount: 1,
        stageCompleted: true,
        stageHitPointsRemaining: 0,
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
    const stageCompleted = enemy.hitPointsRemaining <= 0;
    const lethal = stageCompleted && enemy.hitStageIndex >= enemy.hitStages.length - 1;
    bus.emit('hit', {
      enemyId: enemy.id,
      projectileId: projectile.id,
      worldPosition: worldPosition.clone(),
      letter: enemy.letter,
      volleyId: projectile.volleyId,
      indexInVolley: projectile.indexInVolley,
      lethal,
      hitPointsRemaining: lethal ? 0 : totalHitPointsRemaining(enemy),
      hitStageIndex: enemy.hitStageIndex,
      hitStageCount: enemy.hitStages.length,
      stageCompleted,
      stageHitPointsRemaining: enemy.hitPointsRemaining,
    });
    removeProjectile(projectile);

    const publicEnemy = toPublicEnemy(enemy);
    if (!lethal) {
      const award = level.scoreForHit?.(projectile.volleySize, publicEnemy) ?? 0;
      score += award;
      if (stageCompleted) advanceEnemyStage(enemy, worldPosition);
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

  function advanceEnemyStage(enemy: Enemy<TKind, TData>, worldPosition: Vector3) {
    const previousStageIndex = enemy.hitStageIndex;
    enemy.hitStageIndex += 1;
    enemy.hitPointsRemaining = enemy.hitStages[enemy.hitStageIndex];
    bus.emit('stage', {
      enemyId: enemy.id,
      worldPosition: worldPosition.clone(),
      previousStageIndex,
      stageIndex: enemy.hitStageIndex,
      hitStageCount: enemy.hitStages.length,
      stageHitPoints: enemy.hitPointsRemaining,
      letter: enemy.letter,
    });
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
    for (let i = locks.length - 1; i >= 0; i -= 1) {
      if (locks[i] === enemy.id) locks.splice(i, 1);
    }
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

  function markTargetMesh(mesh: Object3D, enemyId: number, purpose: TargetPurpose, kind: string, letter?: string) {
    mesh.userData.raildRole = 'target';
    mesh.userData.raildTargetPurpose = purpose;
    mesh.userData.raildEnemyId = enemyId;
    mesh.userData.raildEnemyKind = kind;
    if (letter !== undefined) mesh.userData.raildEnemyLetter = letter;
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

  function countsEntryTowardTotal(entry: LockOnSpawnEntry<TKind, TData>) {
    return entry.countsTowardTotal !== false;
  }

  function countsEnemyTowardTotal(enemy: Enemy<TKind, TData>) {
    return enemy.purpose === 'enemy' && enemy.entry !== undefined && countsEntryTowardTotal(enemy.entry);
  }

  function normalizedHitStages(entry: LockOnSpawnEntry<TKind, TData>) {
    const stages = entry.hitStages ?? [entry.hitPoints ?? 1];
    if (stages.length === 0) throw new Error(`Enemy ${entry.kind} has no hit stages`);
    return stages.map((stageHitPoints) => {
      const normalized = Math.floor(stageHitPoints);
      if (normalized < 1) throw new Error(`Enemy ${entry.kind} has a hit stage below 1 HP`);
      if (normalized > MAX_LOCKS) throw new Error(`Enemy ${entry.kind} has a hit stage above ${MAX_LOCKS} HP`);
      return normalized;
    });
  }

  function totalHitPointsRemaining(enemy: Enemy<TKind, TData>) {
    let total = enemy.hitPointsRemaining;
    for (let i = enemy.hitStageIndex + 1; i < enemy.hitStages.length; i += 1) total += enemy.hitStages[i];
    return total;
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
    invulnerableUntil = worldTime + PLAYER_INVULNERABILITY_SECONDS;
    if (window.__raildDebug?.immortal === true) {
      bus.emit('playerhit', { damage, healthRemaining: health });
      hud.flashDamage();
      return;
    }
    health = Math.max(0, health - damage);
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
    hud.setStartNudgesVisible(false);
    hud.update({ score, elapsedTime: runTime, health: readyHealthForHud() });
    hud.showEnd(summary);
    bus.emit('runend', summary);
    spawnWord(replayWord, 'replay-letter');
  }

  const offEndRunRequest = bus.on('runendrequest', () => {
    if (state === 'running' || state === 'attract') endRun();
  });

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
      offBeat();
      offEndRunRequest();
      input.dispose();
      scene.remove(reticleRoot);
      clearRunObjects();
    },
    get state() {
      return state;
    },
    get runProgress() {
      return state === 'running' ? easeRunProgress(runTime, duration) : (state === 'ended' ? 1 : 0);
    },
  };
}
