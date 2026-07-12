import type { EventBus } from '../../events';
import { createBeatLevelAudio, playNoiseHit, playOscillatorVoice } from '../../engine/audio-kit';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { DOWNPOUR_BPM, DOWNPOUR_TIME } from './timing';

const STEP = DOWNPOUR_TIME.stepSeconds;
const CHORDS = [
  { bass: 31, tones: [55, 58, 62, 65] }, { bass: 29, tones: [53, 57, 60, 64] },
  { bass: 34, tones: [58, 62, 65, 69] }, { bass: 36, tones: [60, 63, 67, 70] },
] as const;
const KILL_LANE = [0, 2, 3, 1, 2, 3, 5, 4, 3, 2, 5, 6, 4, 3, 1, 2] as const;

export function createAudio(bus: EventBus) {
  return createDownpourAudio(bus).audio;
}

export const traceDownpourAudio = createAudioTraceHarness({
  level: 'downpour-hlht', bpm: DOWNPOUR_BPM, stepSeconds: STEP, defaultSeconds: 60, createAudio: createDownpourAudio,
});

function createDownpourAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<typeof CHORDS[number], number>({
    bpm: DOWNPOUR_BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2,
    sections: [{ index: 0, fromBar: 0 }, { index: 1, fromBar: 10 }, { index: 2, fromBar: 28 }, { index: 3, fromBar: 36 }],
    leadSet: (chord) => [...chord.tones, ...chord.tones.map((midi) => midi + 12)],
    killLanes: { 0: KILL_LANE, 1: KILL_LANE, 2: KILL_LANE, 3: KILL_LANE },
  });
  const runtime = createBeatLevelAudio({
    bus, trace, bpm: DOWNPOUR_BPM, stepSeconds: STEP, stepsPerBar: 16, score, runAlignment: 'bar', beatNumber: 'position',
    scheduleAhead: 0.12, schedulerMs: 20, volumeScale: 0.78,
    mix: { compressor: { threshold: -20, ratio: 5, attack: 0.004, release: 0.16 }, noiseSeconds: 1.5, delay: { time: STEP * 3, feedback: 0.32, dampHz: 1700, sendGain: 0.26, returnTo: 'master' }, reverb: { seconds: 1.8, decay: 2.1, level: 0.15 } },
    onStep({ time, step, bar, mode }) {
      const context = runtime.context(); const mix = runtime.mix(); if (!context || !mix) return;
      if (mode !== 'run') { if (step === 0) pad(context, mix.music, time, 50, 0.045, 1.3); return; }
      const drop = (bar >= 10 && bar < 18) || (bar >= 28 && bar < 42);
      const release = bar >= 42;
      if (!release && step % 4 === 0) kick(context, mix.music, time, drop ? 0.23 : 0.13);
      if (!release && step % 2 === 1) noise(context, mix, time, 0.06 + (drop ? 0.028 : 0), 0.025, 7800);
      if (drop && (step === 3 || step === 11)) noise(context, mix, time, 0.042, 0.015, 11200);
      if (step === 0 && (bar < 10 || release)) pad(context, mix.music, time, CHORDS[(bar / 2 | 0) % CHORDS.length].bass + 12, release ? 0.045 : 0.075, release ? 1.6 : 0.8);
      if (!release && (step === 0 || step === 6 || step === 10 || step === 14)) bass(context, mix.music, time, CHORDS[(bar / 2 | 0) % CHORDS.length].bass, drop ? 0.13 : 0.08);
      if (bar === 10 && step === 0 || bar === 28 && step === 0) lightning(context, mix.music, time);
      if (bar >= 36 && bar < 42 && step % 4 === 2) siren(context, mix.music, time, 0.045);
    },
    onRunEnd() { const context = runtime.context(); const mix = runtime.mix(); if (context && mix) pad(context, mix.music, context.currentTime, 74, 0.08, 1.8); },
  });
  bus.on('lock', ({ lockCount }) => withMix(runtime, (context, mix) => zap(context, mix.sfx, context.currentTime, 420 + lockCount * 85, 0.035 + lockCount * 0.004, 0.055)));
  bus.on('unlock', () => withMix(runtime, (context, mix) => zap(context, mix.sfx, context.currentTime, 210, 0.035, 0.07)));
  bus.on('fire', ({ volleySize }) => withMix(runtime, (context, mix) => { zap(context, mix.sfx, context.currentTime, 130, 0.11 + volleySize * 0.011, 0.16); mix.duckAt(context.currentTime, 0.83, 0.08); }));
  bus.on('hit', ({ lethal, indexInVolley }) => withMix(runtime, (context, mix) => { const note = score.nextKill(context.currentTime); zap(context, mix.sfx, note.time, note.midi + (lethal ? 12 : 0), lethal ? 0.14 : 0.075, lethal ? 0.24 : 0.12); noise(context, mix, note.time, lethal ? 0.08 : 0.035, lethal ? 0.07 : 0.025, 4300 + (indexInVolley ?? 0) * 300); }));
  bus.on('kill', () => withMix(runtime, (context, mix) => zap(context, mix.sfx, context.currentTime, 900, 0.11, 0.13)));
  bus.on('miss', () => withMix(runtime, (context, mix) => noise(context, mix, context.currentTime, 0.06, 0.12, 780)));
  bus.on('reject', () => withMix(runtime, (context, mix) => { zap(context, mix.sfx, context.currentTime, 66, 0.15, 0.18); noise(context, mix, context.currentTime, 0.07, 0.09, 1200); }));
  bus.on('playerhit', () => withMix(runtime, (context, mix) => { lightning(context, mix.sfx, context.currentTime); mix.duckAt(context.currentTime, 0.56, 0.28); }));
  return runtime;
}

function withMix(runtime: ReturnType<typeof createBeatLevelAudio>, action: (context: AudioContext, mix: NonNullable<ReturnType<typeof runtime.mix>>) => void) { const context = runtime.context(); const mix = runtime.mix(); if (context && mix) action(context, mix); }
function noise(context: AudioContext, mix: NonNullable<ReturnType<ReturnType<typeof createBeatLevelAudio>['mix']>>, time: number, velocity: number, decay: number, frequency: number) { if (!mix.noiseBuffer) return; playNoiseHit({ context, buffer: mix.noiseBuffer, time, velocity, decay, filterType: 'highpass', frequency, destination: mix.music, offset: 0 }); }
function kick(context: AudioContext, destination: AudioNode, time: number, velocity: number) { playOscillatorVoice({ context, time, stopTime: time + 0.19, oscillatorType: 'sine', frequency: 105, frequencyAutomation: [{ type: 'set', value: 145, time }, { type: 'exponentialRamp', value: 40, time: time + 0.14 }], gainAutomation: [{ type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.19 }], destination }); }
function bass(context: AudioContext, destination: AudioNode, time: number, midi: number, velocity: number) { playOscillatorVoice({ context, time, stopTime: time + STEP * 2, oscillatorType: 'sawtooth', frequency: midiToFreq(midi), filter: { type: 'lowpass', frequency: 850, frequencyAutomation: [{ type: 'set', value: 1450, time }, { type: 'exponentialRamp', value: 170, time: time + STEP * 1.8 }] }, gainAutomation: [{ type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + STEP * 1.9 }], destination }); }
function pad(context: AudioContext, destination: AudioNode, time: number, midi: number, velocity: number, duration: number) { playOscillatorVoice({ context, time, stopTime: time + duration, oscillatorType: 'triangle', frequency: midiToFreq(midi), filter: { type: 'lowpass', frequency: 1100 }, gainAutomation: [{ type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + duration }], destination }); }
function zap(context: AudioContext, destination: AudioNode, time: number, midiOrHz: number, velocity: number, duration: number) { const frequency = midiOrHz < 150 ? midiToFreq(midiOrHz) : midiOrHz; playOscillatorVoice({ context, time, stopTime: time + duration, oscillatorType: 'square', frequency, frequencyAutomation: [{ type: 'set', value: frequency * 1.4, time }, { type: 'exponentialRamp', value: Math.max(50, frequency * 0.6), time: time + duration }], filter: { type: 'bandpass', frequency: Math.max(300, frequency * 1.8), Q: 5 }, gainAutomation: [{ type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + duration }], destination }); }
function lightning(context: AudioContext, destination: AudioNode, time: number) { zap(context, destination, time, 2200, 0.16, 0.24); }
function siren(context: AudioContext, destination: AudioNode, time: number, velocity: number) { zap(context, destination, time, 780, velocity, STEP * 1.2); }
