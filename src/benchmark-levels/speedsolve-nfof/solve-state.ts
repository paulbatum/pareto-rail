import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { CatmullRomCurve3 } from 'three';
import { CUBE_LEAD_UNITS, FACE_COUNT } from './timing';

// Shared per-run solve state plus the cube rig. Gameplay (target placement),
// visuals (shell, panels, core) and audio (snap pitches, gained layers) all
// read this one source of truth; gameplay writes it. Everything resets on
// 'runstart' so repeated simulator runs start clean.

export type SolveSignal =
  | { type: 'snap'; face: number; solvedInFace: number; row: number; col: number }
  | { type: 'face-clear'; face: number }
  | { type: 'face-change'; face: number; conquered: boolean }
  | { type: 'face-conquered'; face: number }
  | { type: 'core-reveal' }
  | { type: 'core-dead' };

type SignalHandler = (signal: SolveSignal) => void;

// ---- cube rig ---------------------------------------------------------------

export type SolveRigState = {
  /** World position of the cube centre. */
  pos: Vector3;
  /** World orientation of the whole cube. */
  quat: Quaternion;
  /** Active-face basis in world space: the face plane the player is solving. */
  right: Vector3;
  up: Vector3;
  normal: Vector3;
  faceIndex: number;
};

export type SolveRig = {
  state: SolveRigState;
  update(input: { runTime: number; easedProgress: number; cameraPos: Vector3; dt: number }): void;
  /** Swing the active face toward `face` — the rail being "swung around". */
  swingTo(face: number, runTime: number): void;
  /** A small rotational ratchet about the face normal; kills click the cube. */
  impulse(amount: number): void;
  /** Static attract-mode pose: cube ahead of the rail start, facing the camera. */
  poseAttract(): void;
};

const SWING_SECONDS = 1.1;

export function createSolveRig(curve: CatmullRomCurve3): SolveRig {
  const leadU = CUBE_LEAD_UNITS / curve.getLength();

  const state: SolveRigState = {
    pos: new Vector3(),
    quat: new Quaternion(),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    normal: new Vector3(0, 0, 1),
    faceIndex: 0,
  };

  const desiredQuat = new Quaternion();
  const smoothedQuat = new Quaternion();
  const basisMatrix = new Matrix4();
  const rollQuat = new Quaternion();
  const tmpNormal = new Vector3();
  const tmpRight = new Vector3();
  const tmpUp = new Vector3();
  const refUp = new Vector3();

  let rollAngle = 0;
  let rollVelocity = 0;
  let swingUntil = -1;
  let swingFace = 0;
  let lastRunTime = 0;

  return {
    state,
    impulse(amount) {
      rollVelocity += amount * (Math.random() < 0.5 ? -1 : 1);
    },
    swingTo(face, runTime) {
      if (face === state.faceIndex && swingUntil > runTime) return;
      state.faceIndex = face;
      swingFace = face;
      swingUntil = runTime + SWING_SECONDS;
      rollVelocity += 0.9;
    },
    update({ runTime, easedProgress, cameraPos, dt }) {
      // Cube centre rides the rail ahead of the camera.
      const u = MathUtils.clamp(easedProgress + leadU, 0, 1);
      curve.getPointAt(u, state.pos);

      // The active face tracks the camera.
      tmpNormal.copy(cameraPos).sub(state.pos);
      if (tmpNormal.lengthSq() < 1e-6) tmpNormal.set(0, 0, 1);
      tmpNormal.normalize();
      refUp.set(0, 1, 0);
      if (Math.abs(refUp.dot(tmpNormal)) > 0.94) refUp.set(0, 0, 1);
      tmpRight.crossVectors(refUp, tmpNormal).normalize();
      tmpUp.crossVectors(tmpNormal, tmpRight).normalize();

      // Slow authored spin about the face normal keeps the shell alive; swings
      // add a fast fling that settles.
      const swingT = swingUntil > 0 ? MathUtils.clamp(1 - (swingUntil - runTime) / SWING_SECONDS, 0, 1) : 1;
      const swingRate = swingT < 1 ? 7 : 2.1;
      rollVelocity *= Math.exp(-dt * 4.2);
      rollAngle += rollVelocity * dt;
      const slowSpin = runTime * 0.05 + swingFace * 1.05;
      const fling = swingT < 1 ? Math.sin(swingT * Math.PI) * 0.38 : 0;

      basisMatrix.makeBasis(tmpRight, tmpUp, tmpNormal);
      desiredQuat.setFromRotationMatrix(basisMatrix);
      rollQuat.setFromAxisAngle(tmpNormal, slowSpin + rollAngle + fling);
      desiredQuat.premultiply(rollQuat);

      smoothedQuat.slerp(desiredQuat, 1 - Math.exp(-dt * swingRate));
      state.quat.copy(smoothedQuat);
      state.right.set(1, 0, 0).applyQuaternion(state.quat);
      state.up.set(0, 1, 0).applyQuaternion(state.quat);
      state.normal.set(0, 0, 1).applyQuaternion(state.quat);

      lastRunTime = runTime;
      void lastRunTime;
    },
    poseAttract() {
      // A large dt snaps the smoothed orientation straight to the desired pose.
      this.update({ runTime: 2.5, easedProgress: 0, cameraPos: curve.getPointAt(0), dt: 10 });
    },
  };
}

// ---- per-run solve state ----------------------------------------------------

export type CellSlot = { face: number; row: number; col: number };

class SolveState {
  running = false;
  runTime = 0;
  phase: 'idle' | 'boot' | 'face' | 'core' = 'idle';
  faceIndex = -1;
  facesConquered = 0;
  solvedInFace = 0;
  faceConquered: boolean[] = [];
  faceCleared: boolean[] = [];
  cellByEnemyId = new Map<number, CellSlot>();
  coreRevealed = false;
  coreDeadAt: number | null = null;
  rig: SolveRig | null = null;

  private handlers = new Set<SignalHandler>();
  private pendingWeakQueue: Array<{ face: number; readyAt: number }> = [];

  on(handler: SignalHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(signal: SolveSignal) {
    for (const handler of [...this.handlers]) handler(signal);
  }

  reset(rig: SolveRig) {
    this.running = true;
    this.runTime = 0;
    this.phase = 'boot';
    this.faceIndex = -1;
    this.facesConquered = 0;
    this.solvedInFace = 0;
    this.faceConquered = Array.from({ length: FACE_COUNT }, () => false);
    this.faceCleared = Array.from({ length: FACE_COUNT }, () => false);
    this.cellByEnemyId.clear();
    this.coreRevealed = false;
    this.coreDeadAt = null;
    this.rig = rig;
    this.pendingWeakQueue = [];
  }

  stop() {
    this.running = false;
    this.phase = 'idle';
  }

  registerCell(enemyId: number, slot: CellSlot) {
    this.cellByEnemyId.set(enemyId, slot);
  }

  /** A cell target died. Returns true when this clears its face. */
  cellKilled(enemyId: number): { cleared: boolean; face: number } | null {
    const slot = this.cellByEnemyId.get(enemyId);
    if (!slot) return null;
    this.cellByEnemyId.delete(enemyId);
    this.solvedInFace += 1;
    this.emit({ type: 'snap', face: slot.face, solvedInFace: this.solvedInFace, row: slot.row, col: slot.col });
    const remaining = [...this.cellByEnemyId.values()].some((candidate) => candidate.face === slot.face);
    if (!remaining && !this.faceCleared[slot.face]) {
      this.faceCleared[slot.face] = true;
      this.emit({ type: 'face-clear', face: slot.face });
      this.pendingWeakQueue.push({ face: slot.face, readyAt: this.runTime + 0.75 });
      return { cleared: true, face: slot.face };
    }
    return { cleared: false, face: slot.face };
  }

  weakKilled(face: number) {
    if (this.faceConquered[face]) return;
    this.faceConquered[face] = true;
    this.facesConquered += 1;
    this.emit({ type: 'face-conquered', face });
  }

  markCoreDead(time: number) {
    if (this.coreDeadAt === null) {
      this.coreDeadAt = time;
      this.emit({ type: 'core-dead' });
    }
  }

  takePendingWeak(runTime: number): { face: number } | undefined {
    const first = this.pendingWeakQueue[0];
    if (!first || runTime < first.readyAt) return undefined;
    return this.pendingWeakQueue.shift();
  }
}

export const solveState = new SolveState();
