// Shared run state, module-scoped like post-fx uniforms: gameplay writes it,
// the audio scheduler and visual choreography read it. Everything here is
// derivable only at run time (did the gun actually fire?), so it cannot live
// in the static timeline.

export type MassDriverOutcome = 'pending' | 'fired' | 'detonated';

export const massDriverRunState = {
  outcome: 'pending' as MassDriverOutcome,
  /** Interlocks destroyed so far, 0..6. */
  interlocksDown: 0,
  /** Interlocks currently alive on the collar (spawned minus killed). */
  interlocksAlive: 0,
  arcsIntercepted: 0,
  hitsTaken: 0,
};

export function resetMassDriverRunState() {
  massDriverRunState.outcome = 'pending';
  massDriverRunState.interlocksDown = 0;
  massDriverRunState.interlocksAlive = 0;
  massDriverRunState.arcsIntercepted = 0;
  massDriverRunState.hitsTaken = 0;
}
