import type { Axis } from './cube-model';

// The cube's mechanical events, published by gameplay and heard by the score.
// Beats are arrangement beats (beat 0 = the run's first downbeat), so the
// audio can place a snap on the exact transport step the visuals land on.

export type CubeSignal =
  | { type: 'assemble'; beat: number; pieces: number; spanBeats: number }
  | { type: 'arm'; face: number; beat: number; targets: number }
  | {
    type: 'turn';
    face: number;
    axis: Axis;
    layer: number;
    dir: 1 | -1;
    startBeat: number;
    snapBeat: number;
    auto: boolean;
    /** 1-based position of this snap in the face's solve. */
    step: number;
    steps: number;
  }
  | { type: 'solved'; face: number; beat: number; auto: boolean; seconds: number }
  | { type: 'fall'; face: number; beat: number }
  | { type: 'expose'; face: number; beat: number }
  | { type: 'conquer'; face: number; beat: number; destroyed: boolean }
  | { type: 'shell'; beat: number }
  | { type: 'burst'; beat: number; destroyed: boolean }
  /** After the run: the scattered cube re-forms, freshly scrambled, for the next solve. */
  | { type: 'reform'; delaySeconds: number; pieces: number; spanBeats: number };

type Listener = (signal: CubeSignal) => void;

const listeners = new Set<Listener>();

export function onCubeSignal(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCubeSignal(signal: CubeSignal) {
  for (const listener of listeners) listener(signal);
}

/**
 * When each of the cube's pieces snaps home during the opening assembly, in
 * beats from the assembly start: sparse at first, then an accelerating roll,
 * every landing on a sixteenth. Visuals and score both read this schedule.
 */
export function assemblyBeats(pieces: number, spanBeats: number) {
  return Array.from({ length: pieces }, (_, index) => Math.round(spanBeats * Math.sqrt((index + 1) / pieces) * 4) / 4);
}
