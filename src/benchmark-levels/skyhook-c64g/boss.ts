import { MathUtils, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { SkyhookData, SkyhookEntry, SkyhookUpdate } from './gameplay';
import { CLIMB_LENGTH, TETHER_DROP, T_DOOR, createViewBasis, skyhookRunProgress, tanHalfFov, viewBasisAt } from './space';
import { LATCH_TIME } from './timing';

// THE RIPPER — something huge latches onto the tether far above and climbs
// down it, hand over hand, toward the car. It grips the four guy cables that
// frame the ribbon; each stride is two beats of the score. Shoot the clamps
// and it slips back up the cable; with all four gone the core is exposed. If
// it reaches the car it tears the climber apart.
//
// Gameplay owns the state below; the visuals read it to draw the body. The
// hidden `hauler` enemy is the boss's clock — it is never lockable and sits
// behind the camera so it never reads as a target.

/** The Ripper is drawn (and its hands placed) at this multiple of its base model. */
export const BOSS_SCALE = 1.9;
export const BOSS_START_DISTANCE = 340;
export const BOSS_TEAR_DISTANCE = 80; // close enough to bite, far enough that its core is still on screen
export const BOSS_STRIDE_SECONDS = 1.25; // two beats at 96 BPM
export const BOSS_STRIDE_LENGTH = 24;
export const BOSS_CLAMP_HP = 2;
export const BOSS_CORE_STAGES = [4, 4];
/** Cable positions around the tether axis: local (x right, y rail-up). */
export const BOSS_GRIP: ReadonlyArray<readonly [number, number]> = [
  [-20 * BOSS_SCALE, 11 * BOSS_SCALE],
  [20 * BOSS_SCALE, 11 * BOSS_SCALE],
  [-20 * BOSS_SCALE, -11 * BOSS_SCALE],
  [20 * BOSS_SCALE, -11 * BOSS_SCALE],
];
export const BOSS_REACH = 40 * BOSS_SCALE; // hands are this far ahead (toward the car) of the body centre
export const BOSS_MAW_Z = -24 * BOSS_SCALE; // the maw, in local z (negative = toward the car)

export type BossPhase = 'idle' | 'approach' | 'exposed' | 'dying' | 'gone';

export const bossState = {
  phase: 'idle' as BossPhase,
  /** Distance from the car up the cable to the body centre. */
  distance: BOSS_START_DISTANCE,
  broken: 0,
  exposed: false,
  tearing: false,
  killed: false,
  killedAt: -1,
  /** True if the docking clamps sheared it off the cable (it was still alive at the door). */
  sheared: false,
  latchedAt: -1,
  /** Stride phase 0..1 and the count of completed strides (each is a grip slam). */
  stride: 0,
  strides: 0,
  /** Which clamps have been torn off. */
  clampGone: [false, false, false, false] as boolean[],
  coreStage: 0,
  /** World frame of the body, refreshed every frame the boss is alive. */
  origin: new Vector3(),
  right: new Vector3(1, 0, 0),
  up: new Vector3(0, 1, 0),
  tangent: new Vector3(0, 0, -1),
  flinch: 0,
  frameTime: -1,
};

function resetBoss() {
  bossState.phase = 'idle';
  bossState.distance = BOSS_START_DISTANCE;
  bossState.broken = 0;
  bossState.exposed = false;
  bossState.tearing = false;
  bossState.killed = false;
  bossState.killedAt = -1;
  bossState.sheared = false;
  bossState.latchedAt = -1;
  bossState.stride = 0;
  bossState.strides = 0;
  bossState.clampGone.fill(false);
  bossState.coreStage = 0;
  bossState.flinch = 0;
  bossState.frameTime = -1;
}

// Body advance profile: one stride's worth of motion lands in the first 45% of
// each stride cycle (the lurch); the rest is the plant. Integrates to 1.
const LURCH = 0.45;
export function lurchRate(phase: number) {
  return phase < LURCH ? (Math.PI / (2 * LURCH)) * Math.sin((Math.PI * phase) / LURCH) : 0;
}
/** Fraction of a stride's advance completed by `phase`. */
export function lurchDone(phase: number) {
  if (phase >= LURCH) return 1;
  return (1 - Math.cos((Math.PI * phase) / LURCH)) / 2;
}

/**
 * Local hand position (x right, y rail-up, z along the cable away from the
 * car) for clamp `index` at stride `phase` on stride number `stride`. Pairs
 * alternate: one plants and is dragged back relative to the body while the
 * other swings forward to its next grip.
 */
export function clampLocal(index: number, stride: number, phase: number, out = new Vector3()) {
  const pairA = index === 0 || index === 3;
  const planted = (stride % 2 === 0) === pairA;
  const [gx, gy] = BOSS_GRIP[index];
  const front = -BOSS_REACH;
  let z: number;
  let lift = 0;
  if (planted) {
    z = front + BOSS_STRIDE_LENGTH * lurchDone(phase);
  } else {
    const swing = MathUtils.smoothstep(phase, 0.08, 0.92);
    z = front + BOSS_STRIDE_LENGTH - BOSS_STRIDE_LENGTH * swing;
    lift = Math.sin(swing * Math.PI) * 9 * BOSS_SCALE;
  }
  return out.set(gx + Math.sign(gx) * lift * 0.5, gy + Math.sign(gy) * lift, z);
}

export function bossLocalToWorld(x: number, y: number, z: number, out = new Vector3()) {
  return out
    .copy(bossState.origin)
    .addScaledVector(bossState.right, x)
    .addScaledVector(bossState.up, y)
    .addScaledVector(bossState.tangent, z);
}

const scratchBasis = createViewBasis();
const scratchForward = new Vector3();
const scratchLocal = new Vector3();

export function createBoss(bus: EventBus) {
  const clampIds = new Map<number, number>();
  let coreId = -1;
  let coreRequested = false;
  let lastTime = -1;
  let kick = 0;
  let lunge = 0;
  let nextHookAt = 0;
  let tearHitsAt = 0;

  bus.on('runstart', () => {
    resetBoss();
    clampIds.clear();
    coreId = -1;
    coreRequested = false;
    lastTime = -1;
    kick = 0;
    lunge = 0;
    nextHookAt = 0;
    tearHitsAt = 0;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'core') coreId = enemyId;
  });

  const onClampGone = (enemyId: number, killed: boolean) => {
    const index = clampIds.get(enemyId);
    if (index === undefined) return;
    clampIds.delete(enemyId);
    if (!killed) return;
    bossState.clampGone[index] = true;
    bossState.broken += 1;
    kick += 38; // it slips back up the cable
    bossState.flinch = 1;
    if (bossState.broken >= 4 && !bossState.exposed) {
      bossState.exposed = true;
      bossState.phase = 'exposed';
      coreRequested = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onClampGone(enemyId, true);
    if (enemyId === coreId) {
      bossState.killed = true;
      bossState.phase = 'dying';
      bossState.exposed = false;
      bossState.tearing = false;
      bossState.killedAt = lastTime;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('miss', ({ enemyId }) => onClampGone(enemyId, false));

  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (enemyId !== coreId) return;
    bossState.coreStage = stageIndex;
    bossState.flinch = 1;
    lunge += 26; // it lurches at the car, enraged
    nextHookAt = Math.min(nextHookAt, lastTime + 0.4);
  });

  function ensureFrame(context: SkyhookUpdate) {
    if (bossState.frameTime === context.runTime) return;
    bossState.frameTime = context.runTime;
    const u = MathUtils.clamp(skyhookRunProgress(context.runTime) + bossState.distance / CLIMB_LENGTH, 0, 1);
    const frame = sampleRailFrame(context.curve, u);
    bossState.origin.copy(frame.position).addScaledVector(frame.up, TETHER_DROP);
    bossState.right.copy(frame.right);
    bossState.up.copy(frame.up);
    bossState.tangent.copy(frame.tangent);
  }

  function fireHook(context: SkyhookUpdate, spread: number) {
    const camera = context.camera;
    const maw = bossLocalToWorld(0, 0, BOSS_MAW_Z);
    const basis = viewBasisAt(context.curve, context.runTime, scratchBasis);
    const rel = maw.clone().sub(basis.position);
    const depth = Math.max(8, rel.dot(basis.forward));
    const tanV = tanHalfFov(camera.fov);
    const nx = rel.dot(basis.right) / (depth * tanV * camera.aspect);
    const ny = rel.dot(basis.up) / (depth * tanV);
    const side = spread === 0 ? (Math.floor(context.runTime * 3) % 2 === 0 ? -1 : 1) : Math.sign(spread);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'hook',
      countsTowardTotal: false,
      data: {
        role: 'hook',
        side,
        startX: MathUtils.clamp(nx, -0.9, 0.9) + spread * 0.16,
        startY: MathUtils.clamp(ny, -0.6, 0.9),
        z0: Math.min(depth, 70),
        dur: 3.1,
      },
    });
  }

  /** Runs on the hidden boss clock every frame. */
  function updateHauler(context: SkyhookUpdate) {
    const { enemy, runTime, camera } = context;
    const dt = lastTime < 0 ? 0 : MathUtils.clamp(runTime - lastTime, 0, 0.1);
    lastTime = runTime;
    camera.getWorldDirection(scratchForward);
    enemy.mesh.position.copy(camera.position).addScaledVector(scratchForward, -9);

    bossState.flinch = Math.max(0, bossState.flinch - dt * 2.4);
    if (bossState.phase === 'idle' && runTime >= LATCH_TIME) {
      bossState.phase = 'approach';
      bossState.latchedAt = runTime;
      nextHookAt = runTime + 4.6;
      bus.emit('bossphase', { phase: 'summoned' });
    }
    if (bossState.phase === 'idle' || bossState.phase === 'gone') return false;

    // If it is somehow still alive when the car reaches the bay door, the door
    // shears it off the cable.
    if (!bossState.killed && runTime >= T_DOOR - 1.4) {
      bossState.phase = 'gone';
      bossState.sheared = true;
      bossState.tearing = false;
      return false;
    }

    if (bossState.phase === 'dying') {
      // The body has let go: it drifts free of the cable and the car overtakes it.
      if (runTime - bossState.killedAt > 5) bossState.phase = 'gone';
      ensureFrame(context);
      return false;
    }

    // Hand over hand, on the beat.
    const cycle = (runTime - bossState.latchedAt) / BOSS_STRIDE_SECONDS;
    const strides = Math.floor(cycle);
    const phase = cycle - strides;
    if (strides > bossState.strides) bossState.strides = strides;
    bossState.stride = phase;
    const rate = bossState.exposed ? 0.4 : 1 - bossState.broken * 0.1;
    bossState.distance -= (BOSS_STRIDE_LENGTH / BOSS_STRIDE_SECONDS) * lurchRate(phase) * rate * dt;

    if (kick > 0) {
      const apply = Math.min(kick, 90 * dt);
      bossState.distance += apply;
      kick -= apply;
    }
    if (lunge > 0) {
      const apply = Math.min(lunge, 60 * dt);
      bossState.distance -= apply;
      lunge -= apply;
    }
    bossState.distance = Math.min(BOSS_START_DISTANCE + 40, bossState.distance);

    // Hooks flung at the car.
    ensureFrame(context);
    if (runTime >= nextHookAt) {
      const volley = bossState.exposed || bossState.broken >= 2 ? 2 : 1;
      for (let i = 0; i < volley; i += 1) fireHook(context, volley === 1 ? 0 : i === 0 ? -1 : 1);
      nextHookAt = runTime + (bossState.exposed ? 3.4 : 4.6);
    }

    // At the car: the maw closes on the climber.
    if (bossState.distance <= BOSS_TEAR_DISTANCE) {
      bossState.tearing = true;
      bossState.distance = BOSS_TEAR_DISTANCE;
      if (runTime >= tearHitsAt) {
        context.damagePlayer(2); // the maw closes: this is how a climber gets torn apart
        tearHitsAt = runTime + 1.6;
      }
    }

    // Core exposed once every clamp is off.
    if (coreRequested) {
      coreRequested = false;
      const entry: SkyhookEntry = {
        time: runTime,
        kind: 'core',
        hitStages: [...BOSS_CORE_STAGES],
        data: { role: 'core' },
      };
      context.spawnEnemy(entry);
    }
    return false;
  }

  function updateClamp(context: SkyhookUpdate, data: Extract<SkyhookData, { role: 'clamp' }>) {
    if (bossState.phase === 'gone' || bossState.phase === 'dying') return true;
    ensureFrame(context);
    clampIds.set(context.enemy.id, data.index);
    clampLocal(data.index, bossState.strides, bossState.stride, scratchLocal);
    bossLocalToWorld(scratchLocal.x, scratchLocal.y, scratchLocal.z, context.enemy.mesh.position);
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    return false;
  }

  function updateCore(context: SkyhookUpdate) {
    if (bossState.phase === 'gone') return true;
    ensureFrame(context);
    bossLocalToWorld(0, 0, BOSS_MAW_Z - 3 * BOSS_SCALE, context.enemy.mesh.position);
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    return false;
  }

  return { updateHauler, updateClamp, updateCore };
}
