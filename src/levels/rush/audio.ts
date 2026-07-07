import type { EventBus } from '../../events';
import { createBeatLevelAudio, playNoiseHit, playOscillatorVoice } from '../../engine/audio-kit';
import { midiToFreq } from '../../engine/music';
import { RUSH_TUNING, RUSH_TIME } from './tuning';

const STEP_SECONDS = RUSH_TIME.stepSeconds;
const BASS_PATTERN = [34, 34, 41, 34, 34, 46, 41, 34] as const;

export function createAudio(bus: EventBus) {
  const runtime = createBeatLevelAudio({
    bus,
    bpm: RUSH_TUNING.bpm,
    stepSeconds: STEP_SECONDS,
    stepsPerBar: RUSH_TUNING.stepsPerBar,
    scheduleAhead: 0.12,
    schedulerMs: 20,
    volumeScale: 0.82,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -18, ratio: 7, attack: 0.003, release: 0.12 },
      noiseSeconds: 1.2,
      delay: { time: STEP_SECONDS * 3, feedback: 0.18, dampHz: 1800, sendGain: 0.16, returnTo: 'master' },
    },
    onStep({ time, step, bar, mode }) {
      const mix = runtime.mix();
      const ctx = runtime.context();
      if (!mix || !ctx) return;
      if (mode !== 'run') {
        if (step === 0) tick(ctx, mix.music, time, 0.04, 0.025, 7000);
        return;
      }
      if (step % 4 === 0) kick(ctx, mix.music, time, step === 0 ? 0.32 : 0.24);
      if (step % 2 === 1) tick(ctx, mix.music, time, 0.038 + (bar > 14 ? 0.018 : 0), 0.032, 8600);
      if (step % 4 === 2 && bar > 5) tick(ctx, mix.music, time, 0.026, 0.018, 10500);
      if (step === 0 || step === 6 || step === 10 || step === 14) {
        const midi = BASS_PATTERN[(bar + step / 2) % BASS_PATTERN.length | 0];
        bass(ctx, mix.music, time, midi, bar > 16 ? 0.22 : 0.17);
      }
    },
    onRunEnd() {
      const ctx = runtime.context();
      const mix = runtime.mix();
      if (!ctx || !mix) return;
      zap(ctx, mix.sfx, ctx.currentTime + 0.02, 110, 0.28, 0.18);
    },
  });

  bus.on('lock', ({ lockCount }) => {
    const ctx = runtime.context();
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    zap(ctx, mix.sfx, ctx.currentTime, 520 + lockCount * 120, 0.055, 0.06);
  });
  bus.on('fire', ({ volleySize }) => {
    const ctx = runtime.context();
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    zap(ctx, mix.sfx, ctx.currentTime, 170, 0.1, 0.11 + volleySize * 0.01);
    mix.duckAt(ctx.currentTime, 0.82, 0.08);
  });
  bus.on('hit', ({ lethal }) => {
    const ctx = runtime.context();
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    tick(ctx, mix.sfx, ctx.currentTime, lethal ? 0.13 : 0.07, lethal ? 0.06 : 0.035, lethal ? 3200 : 5200);
  });
  bus.on('kill', () => {
    const ctx = runtime.context();
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    zap(ctx, mix.sfx, ctx.currentTime, 880, 0.13, 0.16);
    tick(ctx, mix.sfx, ctx.currentTime + 0.015, 0.1, 0.07, 6500);
  });
  bus.on('reject', () => {
    const ctx = runtime.context();
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    zap(ctx, mix.sfx, ctx.currentTime, 82, 0.16, 0.12);
    tick(ctx, mix.sfx, ctx.currentTime, 0.11, 0.06, 900);
  });
  bus.on('miss', () => {
    const ctx = runtime.context();
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    zap(ctx, mix.sfx, ctx.currentTime, 72, 0.12, 0.1);
  });

  return runtime.audio;
}

function kick(context: AudioContext, destination: AudioNode, time: number, velocity: number) {
  playOscillatorVoice({
    context,
    time,
    stopTime: time + 0.18,
    oscillatorType: 'sine',
    frequency: 86,
    frequencyAutomation: [
      { type: 'set', value: 130, time },
      { type: 'exponentialRamp', value: 42, time: time + 0.11 },
    ],
    gainAutomation: [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
    destination,
  });
}

function bass(context: AudioContext, destination: AudioNode, time: number, midi: number, velocity: number) {
  playOscillatorVoice({
    context,
    time,
    stopTime: time + STEP_SECONDS * 1.8,
    oscillatorType: 'sawtooth',
    frequency: midiToFreq(midi),
    filter: {
      type: 'lowpass',
      frequency: 780,
      frequencyAutomation: [
        { type: 'set', value: 1300, time },
        { type: 'exponentialRamp', value: 160, time: time + STEP_SECONDS * 1.6 },
      ],
    },
    gainAutomation: [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + STEP_SECONDS * 1.8 },
    ],
    destination,
  });
}

function tick(context: AudioContext, destination: AudioNode, time: number, velocity: number, decay: number, frequency: number) {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.12), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  playNoiseHit({ context, buffer, time, velocity, decay, filterType: 'highpass', frequency, destination, offset: 0 });
}

function zap(context: AudioContext, destination: AudioNode, time: number, frequency: number, velocity: number, duration: number) {
  playOscillatorVoice({
    context,
    time,
    stopTime: time + duration + 0.02,
    oscillatorType: 'square',
    frequency,
    frequencyAutomation: [
      { type: 'set', value: frequency * 1.8, time },
      { type: 'exponentialRamp', value: Math.max(24, frequency * 0.55), time: time + duration },
    ],
    gainAutomation: [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
    filter: { type: 'bandpass', frequency: Math.max(220, frequency * 2.2), Q: 6 },
    destination,
  });
}
