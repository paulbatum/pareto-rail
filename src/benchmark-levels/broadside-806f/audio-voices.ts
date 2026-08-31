import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

export type BroadsideVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createBroadsideVoices(environment: BroadsideVoiceEnvironment) {
  const musicOut = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const stringTone = voice<{ duration: number; brightness: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.34, detune: -7 },
      { type: 'sawtooth', gain: 0.31, detune: 7 },
      { type: 'triangle', gain: 0.5, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: ({ brightness }) => 620 + brightness * 3200, Q: 0.8 },
    envelope: { attack: 0.018, decay: 0.11, sustain: 0.38, release: 0.12 },
  });

  const brassTone = voice<{ duration: number; power: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.42 },
      { type: 'square', gain: ({ power }) => 0.08 + power * 0.08, octave: -1 },
      { type: 'triangle', gain: 0.32, octave: 1, detune: 5 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.12,
    filter: {
      type: 'lowpass',
      cutoff: ({ power }) => 540 + power * 1850,
      Q: 1.5,
      frequencyAutomation: (time, { duration, power }) => [
        { type: 'set', value: 420 + power * 780, time },
        { type: 'linearRamp', value: 1100 + power * 2400, time: time + Math.min(0.18, duration * 0.3) },
        { type: 'exponentialRamp', value: 480 + power * 620, time: time + Math.max(0.2, duration * 0.88) },
      ],
    },
    envelope: { attack: 0.028, decay: 0.16, sustain: 0.42, release: 0.28 },
  });

  const bassTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.82 },
      { type: 'sine', gain: 0.68, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'lowpass', frequency: 440, Q: 0.9 },
    envelope: { attack: 0.012, decay: 0.13, sustain: 0.34, release: 0.16 },
  });

  const choirTone = voice<{ duration: number; open: number }>({
    oscillators: [
      { type: 'sine', gain: 0.65 },
      { type: 'triangle', gain: 0.28, octave: 1, detune: -9 },
      { type: 'triangle', gain: 0.25, octave: 1, detune: 9 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.4,
    filter: { type: 'lowpass', cutoff: ({ open }) => 800 + open * 2500, Q: 0.45 },
    envelope: { attack: 0.28, decay: 0.42, sustain: 0.52, release: 0.85 },
  });

  const timpaniTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.32, octave: 1 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency, { duration }) => [
      { type: 'set', value: frequency * 1.42, time },
      { type: 'exponentialRamp', value: frequency, time: time + Math.min(0.13, duration * 0.3) },
    ],
    filter: { type: 'lowpass', frequency: 620, Q: 1.1 },
    envelope: { attack: 0.002, decay: 0.34, sustain: 0.05, release: 0.14, peak: 1 },
  });

  const playerTone = voice<{ duration: number; bright: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.76 },
      { type: 'sine', gain: ({ bright }) => 0.3 + bright * 0.24, octave: 1 },
      { type: 'square', gain: ({ bright }) => bright * 0.08, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ bright }) => 1800 + bright * 4800, Q: 1.3 },
    envelope: { attack: 0.004, decay: 0.075, sustain: 0.2, release: 0.11 },
  });

  const blastTone = voice<{ duration: number; victory: boolean }>({
    oscillators: [
      { type: ({ victory }) => victory ? 'triangle' : 'sawtooth', gain: 0.8 },
      { type: 'sine', gain: 0.72, octave: -1 },
      { type: 'square', gain: ({ victory }) => victory ? 0.05 : 0.15, octave: -2 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.2,
    filter: {
      type: 'lowpass',
      cutoff: ({ victory }) => victory ? 4800 : 1250,
      frequencyAutomation: (time, { duration, victory }) => [
        { type: 'set', value: victory ? 320 : 3600, time },
        { type: victory ? 'linearRamp' : 'exponentialRamp', value: victory ? 6200 : 190, time: time + duration * 0.88 },
      ],
    },
    envelope: { attack: 0.008, decay: 0.25, sustain: 0.46, release: 0.8 },
  });

  const highNoise = noiseHit({ filterType: 'highpass', frequency: 4200, decay: 0.055 });
  const lowNoise = noiseHit({ filterType: 'lowpass', frequency: 520, decay: 0.28 });
  const metalNoise = noiseHit({ filterType: 'bandpass', frequency: 1800, decay: 0.12 });

  return defineInstruments({ trace: environment.trace, context: environment.context }, {
    strings(context, time, midi, velocity, duration, brightness) {
      const output = musicOut();
      if (!output) return;
      stringTone.play({ context, time, midi, velocity, duration, brightness, destination: output });
    },
    brass(context, time, midi, velocity, duration, power) {
      const output = musicOut();
      if (!output) return;
      brassTone.play({ context, time, midi, velocity, duration, power, destination: output });
    },
    bass(context, time, midi, velocity, duration) {
      const output = musicOut();
      if (!output) return;
      bassTone.play({ context, time, midi, velocity, duration, destination: output });
    },
    choir(context, time, midi, velocity, duration, open) {
      const output = musicOut();
      if (!output) return;
      choirTone.play({ context, time, midi, velocity, duration, open, destination: output });
    },
    timpani(context, time, midi, velocity, duration) {
      const output = musicOut();
      if (!output) return;
      timpaniTone.play({ context, time, midi, velocity, duration, destination: output });
      const buffer = environment.mix()?.noiseBuffer;
      if (buffer) lowNoise.play({ context, buffer, time, destination: output, velocity: velocity * 0.3, decay: Math.min(0.45, duration), frequency: 460, offset: Math.random() * 1.3 });
    },
    percussion(context, time, velocity, high, decay) {
      const output = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      (high ? highNoise : metalNoise).play({
        context,
        buffer,
        time,
        destination: output,
        velocity,
        decay,
        frequency: high ? 5600 : 1450,
        offset: Math.random() * 1.4,
      });
    },
    player(context, time, midi, velocity, duration, bright) {
      const output = sfxOut();
      if (!output) return;
      playerTone.play({ context, time, midi, velocity, duration, bright, destination: output });
    },
    impact(context, time, velocity, frequency, decay) {
      const output = sfxOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      metalNoise.play({ context, buffer, time, destination: output, velocity, frequency, decay, offset: Math.random() * 1.5 });
    },
    cannon(context, time, midi, velocity, duration) {
      const output = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output) return;
      timpaniTone.play({ context, time, midi, velocity, duration, destination: output });
      if (buffer) lowNoise.play({ context, buffer, time, destination: output, velocity: velocity * 0.7, frequency: 260, decay: duration * 0.7, offset: Math.random() });
    },
    finale(context, time, midi, velocity, duration, victory) {
      const output = musicOut();
      if (!output) return;
      environment.mix()?.duckAt(time, victory ? 0.12 : 0.38, victory ? 1.0 : 0.7);
      blastTone.play({ context, time, midi, velocity, duration, victory, destination: output });
    },
  });
}

export type BroadsideVoices = ReturnType<typeof createBroadsideVoices>;
