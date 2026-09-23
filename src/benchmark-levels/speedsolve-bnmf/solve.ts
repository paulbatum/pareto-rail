import { createCubeState, type Axis, type DerivedPlan, type PlanStep } from './cube-model';
import { emitCubeSignal } from './signals';

// Leaf: the solve machine. Gameplay decides the plan and every timing value;
// this module only keeps the books — which slice turns are queued, when each
// one snaps (always on the transport grid), and when a finished face falls
// and exposes its weakpoint.

export type SolveTiming = {
  faceStartBeat(face: number): number;
  /** Grid the first snap of a roll lands on (the beat itself), in beats. */
  leadGridBeats: number;
  /** Grid follow-up snaps in the same roll land on, in beats. */
  gridBeats: number;
  /** Grid the machine uses when it has to finish a face by itself. */
  autoGridBeats: number;
  /** A snap is never scheduled closer than this to the request. */
  minLeadBeats: number;
  /** Longest visible spin before a snap. */
  spinBeats: number;
  /** The face falls on the first whole beat at least this long after its last snap. */
  fallGapBeats: number;
  /** The weakpoint rises this long after the fall. */
  exposeDelayBeats: number;
  /** Faces exposed later than this (relative to their phrase) keep their weakpoint hidden. */
  lastExposeBeat: number;
};

export type TurnRecord = {
  face: number;
  axis: Axis;
  layer: number;
  dir: 1 | -1;
  startBeat: number;
  snapBeat: number;
  auto: boolean;
  committed: boolean;
};

export type FaceStatus = 'waiting' | 'solving' | 'solved' | 'fallen' | 'exposed' | 'done';

export type FaceProgress = {
  status: FaceStatus;
  totalQuarters: number;
  requested: number;
  committed: number;
  armedBeat: number;
  solvedBeat: number;
  solveSeconds: number;
  auto: boolean;
  fallBeat: number;
  exposeBeat: number;
  destroyed: boolean;
};

export function createSolveMachine(plan: readonly PlanStep[], derived: DerivedPlan, timing: SolveTiming, beatSeconds: number) {
  const state = createCubeState(derived.owner);
  const turns: TurnRecord[] = [];
  const faces: FaceProgress[] = plan.map(() => freshFace());
  let lastSnapBeat = -Infinity;
  const pendingExposures: number[] = [];

  function freshFace(): FaceProgress {
    return {
      status: 'waiting',
      totalQuarters: 0,
      requested: 0,
      committed: 0,
      armedBeat: 0,
      solvedBeat: 0,
      solveSeconds: 0,
      auto: false,
      fallBeat: Infinity,
      exposeBeat: Infinity,
      destroyed: false,
    };
  }

  function reset() {
    state.reset();
    turns.length = 0;
    pendingExposures.length = 0;
    lastSnapBeat = -Infinity;
    plan.forEach((step, face) => {
      faces[face] = freshFace();
      faces[face].totalQuarters = step.quarters.reduce((sum, quarters) => sum + Math.abs(quarters), 0);
    });
  }

  function arm(face: number, beat: number) {
    const progress = faces[face];
    if (progress.status !== 'waiting') return;
    progress.status = 'solving';
    progress.armedBeat = beat;
    emitCubeSignal({ type: 'arm', face, beat, targets: derived.wrongLayers[face].length });
  }

  /** Queue one quarter turn of a wrong layer; returns the snap beat. */
  function requestTurn(face: number, layer: number, nowBeat: number, auto = false) {
    const progress = faces[face];
    if (progress.requested >= progress.totalQuarters) return undefined;
    const step = plan[face];
    const quarters = step.quarters[layer + 1];
    const dir: 1 | -1 = quarters < 0 ? -1 : 1;
    // A fresh roll opens on the beat; turns queued behind it roll on the
    // finer grid, one per line, so a volley plays as a clean fill.
    const rolling = lastSnapBeat > nowBeat - 1e-6;
    const grid = auto ? timing.autoGridBeats : rolling ? timing.gridBeats : timing.leadGridBeats;
    let snap = Math.ceil((nowBeat + timing.minLeadBeats) / grid - 1e-6) * grid;
    if (snap <= lastSnapBeat + 1e-6) snap = lastSnapBeat + grid;
    // A slice can only start turning once its previous turn has landed.
    const sameLayer = turns.filter((turn) => turn.face === face && turn.layer === layer);
    const previousSnap = sameLayer.length ? sameLayer[sameLayer.length - 1].snapBeat : -Infinity;
    while (snap - Math.max(nowBeat, previousSnap) < timing.minLeadBeats * 0.75) snap += grid;
    const startBeat = Math.max(nowBeat, previousSnap, snap - timing.spinBeats);
    lastSnapBeat = snap;
    progress.requested += 1;
    if (auto) progress.auto = true;
    const turn: TurnRecord = { face, axis: step.axis, layer, dir, startBeat, snapBeat: snap, auto, committed: false };
    turns.push(turn);
    emitCubeSignal({
      type: 'turn',
      face,
      axis: step.axis,
      layer,
      dir,
      startBeat,
      snapBeat: snap,
      auto,
      step: progress.requested,
      steps: progress.totalQuarters,
    });
    return snap;
  }

  function tick(nowBeat: number) {
    for (const turn of turns) {
      if (turn.committed || turn.snapBeat > nowBeat) continue;
      turn.committed = true;
      state.turn(turn.axis, turn.layer, turn.dir);
      const progress = faces[turn.face];
      progress.committed += 1;
      if (progress.committed >= progress.totalQuarters && progress.status === 'solving') {
        progress.status = 'solved';
        progress.solvedBeat = turn.snapBeat;
        progress.solveSeconds = (turn.snapBeat - progress.armedBeat) * beatSeconds;
        progress.fallBeat = Math.ceil(turn.snapBeat + timing.fallGapBeats - 1e-6);
        emitCubeSignal({ type: 'solved', face: turn.face, beat: turn.snapBeat, auto: progress.auto, seconds: progress.solveSeconds });
      }
    }
    // Keep a short tail of landed turns for the snap recoil animation.
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].committed && nowBeat - turns[i].snapBeat > 2) turns.splice(i, 1);
    }

    faces.forEach((progress, face) => {
      if (progress.status === 'solved' && nowBeat >= progress.fallBeat) {
        progress.status = 'fallen';
        state.strip(face);
        emitCubeSignal({ type: 'fall', face, beat: progress.fallBeat });
        const exposeBeat = progress.fallBeat + timing.exposeDelayBeats;
        if (exposeBeat - timing.faceStartBeat(face) <= timing.lastExposeBeat) progress.exposeBeat = exposeBeat;
        else {
          progress.status = 'done';
          emitCubeSignal({ type: 'conquer', face, beat: progress.fallBeat, destroyed: false });
        }
      }
      if (progress.status === 'fallen' && nowBeat >= progress.exposeBeat) {
        progress.status = 'exposed';
        pendingExposures.push(face);
        emitCubeSignal({ type: 'expose', face, beat: progress.exposeBeat });
      }
    });
  }

  function conquer(face: number, beat: number, destroyed: boolean) {
    const progress = faces[face];
    if (progress.status === 'done') return;
    progress.status = 'done';
    progress.destroyed = destroyed;
    emitCubeSignal({ type: 'conquer', face, beat, destroyed });
  }

  reset();

  return {
    state,
    turns,
    faces,
    reset,
    arm,
    requestTurn,
    tick,
    conquer,
    takeExposures() {
      return pendingExposures.splice(0, pendingExposures.length);
    },
    remainingQuarters(face: number) {
      return faces[face].totalQuarters - faces[face].requested;
    },
  };
}

export type SolveMachine = ReturnType<typeof createSolveMachine>;
