// Shared, per-run facts that gameplay decides and visuals/audio read. Nothing
// here makes a decision; gameplay.ts writes the charge outcome and index.ts
// writes the measured beat phase.

export type ChargeOutcome = 'pending' | 'launch' | 'breach';

export const runState = {
  /**
   * Seconds between run time and the audible beat grid (run time of beat 0).
   * Rings are seated on it so the payload crosses each coil on the heard beat,
   * not on the scheduler's lookahead. Zero in headless simulation.
   */
  beatPhase: 0,
  /** Decided the moment the last interlock dies, or at the verdict beat. */
  outcome: 'pending' as ChargeOutcome,
  /** Run time the last safety interlock was destroyed; -1 while any stand. */
  safetiesClearAt: -1,
  interlocksSpawned: 0,
  interlocksDestroyed: 0,
};

export function resetRunState() {
  runState.outcome = 'pending';
  runState.safetiesClearAt = -1;
  runState.interlocksSpawned = 0;
  runState.interlocksDestroyed = 0;
}
