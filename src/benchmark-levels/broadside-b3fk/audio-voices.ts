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

  const stringsTone = voice<{ duration: number; intensity: number }>({
    oscillators: [
      { type: 'sawtooth', detune: -7, gain: 0.38 },
      { type: 'sawtooth', detune: 7, gain: 0.38 },
      { type: 'triangle', octave: -1, gain: 0.36 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.18,
    filter: { type: 'lowpass', cutoff: ({ intensity }) => 620 + intensity * 3300, Q: 0.65 },
    envelope: { attack: 0.07, decay: 0.16, sustain: 0.62, release: 0.34, peak: 1 },
  });

  const brassTone = voice<{ duration: number; force: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.46 },
      { type: 'square', octave: -1, gain: 0.14 },
      { type: 'triangle', octave: 1, gain: 0.16 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.12,
    filter: { type: 'lowpass', cutoff: ({ force }) => 720 + force * 3600, Q: 1.2 },
    envelope: { attack: 0.025, decay: 0.12, sustain: 0.52, release: 0.24 },
  });

  const hornTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.72 },
      { type: 'sawtooth', detune: -5, gain: 0.2 },
      { type: 'sawtooth', detune: 5, gain: 0.2 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.16,
    filter: { type: 'lowpass', frequency: 1550, Q: 0.85 },
    envelope: { attack: 0.05, decay: 0.14, sustain: 0.6, release: 0.36 },
  });

  const timpaniTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'triangle', octave: 1, gain: 0.18 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      frequency: 680,
      Q: 1.1,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 120, time: time + 0.34 }],
    },
    envelope: { attack: 0.002, decay: 0.36, sustain: 0.06, release: 0.2 },
  });

  const choirTone = voice<{ duration: number; open: number }>({
    oscillators: [
      { type: 'sine', gain: 0.62 },
      { type: 'triangle', octave: 1, gain: 0.22 },
      { type: 'sine', octave: -1, gain: 0.24 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.25,
    filter: { type: 'bandpass', cutoff: ({ open }) => 620 + open * 820, Q: 0.7 },
    envelope: { attack: 0.16, decay: 0.18, sustain: 0.72, release: 0.52 },
  });

  const playerTone = voice<{ duration: number; bright: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.8 },
      { type: 'sine', octave: 1, gain: ({ bright }) => 0.22 + bright * 0.26 },
      { type: 'square', octave: 2, gain: ({ bright }) => bright * 0.055 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ bright }) => 2200 + bright * 6500, Q: 1.25 },
    envelope: { attack: 0.003, decay: 0.085, sustain: 0.12, release: 0.1 },
  });

  const enemyGunTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.42 },
      { type: 'square', octave: -1, gain: 0.38 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      frequency: 1300,
      Q: 2.2,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 170, time: time + 0.26 }],
    },
    envelope: { attack: 0.002, decay: 0.18, sustain: 0.12, release: 0.1 },
  });

  const impactNoise = noiseHit({ filterType: 'bandpass', frequency: 1600, decay: 0.11 });
  const airNoise = noiseHit({ filterType: 'highpass', frequency: 5200, decay: 0.075 });

  return defineInstruments({ trace: environment.trace, context: environment.context }, {
    strings(context, time, midi, velocity, duration, intensity) {
      const destination = musicOut();
      if (!destination) return;
      stringsTone.play({ context, time, midi, velocity, duration, intensity, destination });
    },
    brass(context, time, midi, velocity, duration, force) {
      const destination = musicOut();
      if (!destination) return;
      brassTone.play({ context, time, midi, velocity, duration, force, destination });
    },
    horn(context, time, midi, velocity, duration) {
      const destination = musicOut();
      if (!destination) return;
      hornTone.play({ context, time, midi, velocity, duration, destination });
    },
    timpani(context, time, midi, velocity, duration = 0.42) {
      const destination = musicOut();
      if (!destination) return;
      timpaniTone.play({ context, time, midi, velocity, duration, destination });
    },
    choir(context, time, midi, velocity, duration, open) {
      const destination = musicOut();
      if (!destination) return;
      choirTone.play({ context, time, midi, velocity, duration, open, destination });
    },
    player(context, time, midi, velocity, duration, bright) {
      const destination = sfxOut();
      if (!destination) return;
      playerTone.play({ context, time, midi, velocity, duration, bright, destination });
    },
    enemyGun(context, time, midi, velocity, duration) {
      const destination = sfxOut();
      if (!destination) return;
      enemyGunTone.play({ context, time, midi, velocity, duration, destination });
    },
    impact(context, time, velocity, frequency, decay) {
      const destination = sfxOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!destination || !buffer) return;
      impactNoise.play({ context, buffer, time, destination, velocity, frequency, decay, offset: Math.random() * 1.3 });
    },
    air(context, time, velocity, frequency, decay) {
      const destination = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!destination || !buffer) return;
      airNoise.play({ context, buffer, time, destination, velocity, frequency, decay, offset: Math.random() * 1.3 });
    },
    duck(context, time, amount, seconds) {
      void context;
      environment.mix()?.duckAt(time, amount, seconds);
    },
  });
}

export type BroadsideVoices = ReturnType<typeof createBroadsideVoices>;
