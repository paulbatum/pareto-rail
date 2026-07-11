import type { EventBus } from '../../events';
import { createBeatLevelAudio, playNoiseHit, playOscillatorVoice } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import { MASS_DRIVER_BCZY_BPM, MASS_DRIVER_BCZY_RUN_DURATION, MASS_DRIVER_BCZY_TIME } from './gameplay';

const STEP = MASS_DRIVER_BCZY_TIME.stepSeconds;
const CHORDS = [
  { bass: 29, lead: [57, 60, 64, 69] }, { bass: 31, lead: [59, 62, 66, 71] },
  { bass: 34, lead: [62, 65, 69, 74] }, { bass: 36, lead: [64, 67, 71, 76] },
] as const;
const KILL_LANE = [0,1,2,1,3,2,1,0,2,3,2,1,3,2,3,0] as const;

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverBczyAudio = createAudioTraceHarness({
  level: 'mass-driver-bczy',
  bpm: MASS_DRIVER_BCZY_BPM,
  stepSeconds: STEP,
  defaultSeconds: MASS_DRIVER_BCZY_RUN_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let interlocksClear = false;
  const score = createScore<typeof CHORDS[number], 0>({ bpm: MASS_DRIVER_BCZY_BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2, sections: [{ index: 0, fromBar: 0 }], leadSet: (chord) => chord.lead, killLanes: { 0: KILL_LANE } });
  const runtime = createBeatLevelAudio({
    bus, trace, bpm: MASS_DRIVER_BCZY_BPM, stepSeconds: STEP, stepsPerBar: 16, score, scheduleAhead: 0.12, schedulerMs: 20, volumeScale: 0.8, runAlignment: 'bar',
    mix: { compressor: { threshold: -19, ratio: 5, attack: 0.005, release: 0.18 }, noiseSeconds: 1.3, delay: { time: STEP * 3, feedback: 0.29, dampHz: 2200, sendGain: 0.2, returnTo: 'master' } },
    onStep({ time, step, bar, mode }) {
      if (mode === 'run') {
        if (step === 0 && [0, 8, 16, 24, 31].includes(bar)) trace?.record(time, 'section', { name: ['injection', 'blue-bank', 'violet-bank', 'interlocks', 'launch-charge'][[0, 8, 16, 24, 31].indexOf(bar)], bar });
        if (step % 4 === 0) trace?.record(time, 'instrument', { name: 'accelerator-pulse', bar, beat: step / 4 });
        if (step === 2 || step === 10) trace?.record(time, 'instrument', { name: 'climbing-hum', midi: 41 + bar * 0.34 });
        if (bar >= 16 && step % 4 === 2) trace?.record(time, 'instrument', { name: 'charge-tick' });
      }
      const ctx = runtime.context(); const mix = runtime.mix(); if (!ctx || !mix) return;
      if (mode !== 'run') { if (step === 0) pulse(ctx, mix.music, time, 34, 0.055, 0.34); return; }
      const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
      const humClimb = bar * 0.34;
      // Hypnotic one-beat pulse and a bass hum that climbs into white heat.
      if (step % 4 === 0) { pulse(ctx, mix.music, time, chord.bass, 0.18 + Math.min(0.08, bar / 300), 0.37); if (bar > 7) noise(ctx, mix.music, time, 0.028 + bar * 0.001, 0.025, 7200); }
      if (step === 2 || step === 10) hum(ctx, mix.music, time, 41 + humClimb, 0.045 + bar * 0.0012, 0.32);
      if (bar >= 16 && step % 4 === 2) zap(ctx, mix.music, time, midiToFreq(chord.lead[(step / 2 + bar) % 4]), 0.026, 0.1);
      if (bar >= 24 && step % 2 === 0) noise(ctx, mix.music, time, 0.022, 0.018, 10500);
    },
    onRunEnd() {},
  });
  bus.on('lock', ({ lockCount }) => { const ctx = runtime.context(); const mix = runtime.mix(); if (ctx && mix) zap(ctx, mix.sfx, score.quantizePlayerAction(ctx.currentTime), 410 + lockCount * 125, 0.075, 0.07); });
  bus.on('unlock', () => { const ctx = runtime.context(); const mix = runtime.mix(); if (ctx && mix) zap(ctx, mix.sfx, ctx.currentTime, 180, 0.035, 0.05); });
  bus.on('fire', ({ volleySize }) => { const ctx = runtime.context(); const mix = runtime.mix(); if (ctx && mix) { pulse(ctx, mix.sfx, ctx.currentTime, 42, 0.15 + volleySize * 0.012, 0.18); mix.duckAt(ctx.currentTime, 0.82, 0.08); } });
  bus.on('hit', ({ lethal, indexInVolley }) => { const ctx = runtime.context(); const mix = runtime.mix(); if (!ctx || !mix) return; const note = score.nextKill(ctx.currentTime, 0); zap(ctx, mix.sfx, note.time, midiToFreq(note.midi + (lethal ? 12 : 0)), lethal ? 0.14 : 0.08, lethal ? 0.22 : 0.12); noise(ctx, mix.sfx, note.time + (indexInVolley ?? 0) * 0.008, lethal ? 0.09 : 0.04, lethal ? 0.05 : 0.025, lethal ? 6400 : 3600); });
  bus.on('kill', () => { const ctx = runtime.context(); const mix = runtime.mix(); if (ctx && mix) zap(ctx, mix.sfx, ctx.currentTime, 1320, 0.13, 0.16); });
  bus.on('reject', () => { const ctx = runtime.context(); const mix = runtime.mix(); if (ctx && mix) { zap(ctx, mix.sfx, ctx.currentTime, 76, 0.14, 0.18); noise(ctx, mix.sfx, ctx.currentTime, 0.08, 0.07, 850); } });
  bus.on('miss', () => { const ctx = runtime.context(); const mix = runtime.mix(); if (ctx && mix) zap(ctx, mix.sfx, ctx.currentTime, 55, 0.1, 0.2); });
  bus.on('playerhit', () => { const ctx = runtime.context(); const mix = runtime.mix(); if (ctx && mix) noise(ctx, mix.sfx, ctx.currentTime, 0.18, 0.18, 260); });
  bus.on('runstart', () => { interlocksClear = false; });
  bus.on('bossphase', ({ phase }) => { if (phase === 'destroyed') interlocksClear = true; });
  bus.on('runend', ({ died }) => {
    const ctx = runtime.context(); const mix = runtime.mix(); if (!ctx || !mix) return;
    if (!died && interlocksClear) launchTone(ctx, mix.music, ctx.currentTime + 0.02, 0.42);
    else { pulse(ctx, mix.sfx, ctx.currentTime, 24, 0.34, 0.45); noise(ctx, mix.sfx, ctx.currentTime + 0.02, 0.28, 0.32, 180); }
  });
  return runtime;
}

function pulse(context: AudioContext, destination: AudioNode, time: number, midi: number, gain: number, duration: number) { playOscillatorVoice({ context, time, stopTime: time + duration + 0.03, oscillatorType: 'sine', frequency: midiToFreq(midi), frequencyAutomation: [{ type: 'set', value: midiToFreq(midi + 12), time }, { type: 'exponentialRamp', value: midiToFreq(midi), time: time + duration }], gainAutomation: [{ type: 'set', value: gain, time }, { type: 'exponentialRamp', value: 0.001, time: time + duration }], destination }); }
function hum(context: AudioContext, destination: AudioNode, time: number, midi: number, gain: number, duration: number) { playOscillatorVoice({ context, time, stopTime: time + duration + 0.02, oscillatorType: 'sawtooth', frequency: midiToFreq(midi), filter: { type: 'lowpass', frequency: 760, frequencyAutomation: [{ type: 'set', value: 1400, time }, { type: 'exponentialRamp', value: 260, time: time + duration }] }, gainAutomation: [{ type: 'set', value: gain, time }, { type: 'exponentialRamp', value: 0.001, time: time + duration }], destination }); }
function zap(context: AudioContext, destination: AudioNode, time: number, frequency: number, gain: number, duration: number) { playOscillatorVoice({ context, time, stopTime: time + duration + 0.02, oscillatorType: 'square', frequency, frequencyAutomation: [{ type: 'set', value: frequency * 1.55, time }, { type: 'exponentialRamp', value: Math.max(35, frequency * 0.55), time: time + duration }], gainAutomation: [{ type: 'set', value: gain, time }, { type: 'exponentialRamp', value: 0.001, time: time + duration }], filter: { type: 'bandpass', frequency: Math.max(280, frequency * 2), Q: 5 }, destination }); }
function noise(context: AudioContext, destination: AudioNode, time: number, gain: number, decay: number, frequency: number) { const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.1), context.sampleRate); const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1; playNoiseHit({ context, buffer, time, velocity: gain, decay, filterType: 'highpass', frequency, destination, offset: 0 }); }
function launchTone(context: AudioContext, destination: AudioNode, time: number, gain: number) { playOscillatorVoice({ context, time, stopTime: time + 1.8, oscillatorType: 'sine', frequency: 110, frequencyAutomation: [{ type: 'set', value: 110, time }, { type: 'exponentialRamp', value: 1760, time: time + 1.25 }], gainAutomation: [{ type: 'set', value: gain, time }, { type: 'exponentialRamp', value: 0.001, time: time + 1.7 }], destination }); }
