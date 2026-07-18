import { Vector3 } from 'three';

// Three systems need to agree about one story: the gun's charge, the six
// interlocks, and whether the shot happened. The typed event bus carries the
// shared gameplay vocabulary; this module carries the *level's* vocabulary —
// klaxon, charge, shot, detonation — plus a live snapshot of the run that
// visuals and audio poll instead of recomputing.

export type MdSignal =
  | { type: 'klaxon' }
  | { type: 'interlock-spawn'; worldPosition: Vector3 }
  | { type: 'interlock-down'; count: number; worldPosition: Vector3 }
  | { type: 'interlocks-clear' }
  | { type: 'shot' }
  | { type: 'detonation' }
  | { type: 'callout'; text: string; seconds: number };

type Listener = (signal: MdSignal) => void;

const listeners = new Set<Listener>();

export function onSignal(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSignal(signal: MdSignal) {
  for (const listener of listeners) listener(signal);
}

export type MdRunState = {
  /** Seconds into the current run; frozen at the end. */
  runTime: number;
  /** Eased rail progress in [0, 1]. */
  runProgress: number;
  /** Relative airspeed, matching the authored speed profile. */
  speedFactor: number;
  /** Firing charge in [0, 1] across the interlock bars. */
  charge: number;
  interlocksDown: number;
  interlocksAlive: number;
  gunFired: boolean;
  detonated: boolean;
  running: boolean;
};

export const mdRun: MdRunState = {
  runTime: 0,
  runProgress: 0,
  speedFactor: 0.5,
  charge: 0,
  interlocksDown: 0,
  interlocksAlive: 0,
  gunFired: false,
  detonated: false,
  running: false,
};

export function resetRunState() {
  mdRun.runTime = 0;
  mdRun.runProgress = 0;
  mdRun.speedFactor = 0.5;
  mdRun.charge = 0;
  mdRun.interlocksDown = 0;
  mdRun.interlocksAlive = 0;
  mdRun.gunFired = false;
  mdRun.detonated = false;
  mdRun.running = false;
}
