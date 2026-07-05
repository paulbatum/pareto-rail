import type { EventBus } from '../events';

export function midiToFreq(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function quantizeToGrid(time: number, step: number) {
  return Math.ceil(time / step) * step;
}

export function secondsPerStep(bpm: number, stepsPerBeat: number) {
  return 60 / bpm / stepsPerBeat;
}

export function tempo(bpm: number, beatsPerBar = 4) {
  const beatSeconds = 60 / bpm;
  const barSeconds = beatSeconds * beatsPerBar;
  return {
    beatSeconds,
    barSeconds,
    beat: (n: number) => n * beatSeconds,
    bar: (n: number) => n * barSeconds,
  };
}

export function emitBeatAt(bus: EventBus, context: AudioContext, time: number, beatNumber: number, isDownbeat: boolean) {
  const delay = Math.max(0, (time - context.currentTime) * 1000);
  window.setTimeout(() => bus.emit('beat', { beatNumber, isDownbeat, audioTime: time }), delay);
}
