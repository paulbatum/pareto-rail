import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
  const musicOut = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const coilTone = voice<{ duration: number; heat: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'triangle', gain: ({ heat }) => 0.16 + heat * 0.18, octave: 1, detune: 4 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ heat }) => 320 + heat * 2400, Q: 0.8 },
    envelope: { attack: 0.025, decay: 0.13, sustain: 0.6, release: 0.12, peak: 1 },
  });

  const bassTone = voice<{ duration: number }>({
    oscillators: [{ type: 'triangle' }, { type: 'sine', octave: -1, gain: 0.7 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 440, Q: 1.2 },
    envelope: { attack: 0.008, decay: 0.12, sustain: 0.35, release: 0.1 },
  });

  const pulseTone = voice<{ heat: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.055,
    stopPadding: 0.02,
    filter: { type: 'bandpass', cutoff: ({ heat }) => 1700 + heat * 5600, Q: 5 },
    envelope: { attack: 0.001, decay: 0.05 },
  });

  const playerTone = voice<{ duration: number; bright: number }>({
    oscillators: [{ type: 'triangle' }, { type: 'sine', octave: 1, gain: ({ bright }) => bright * 0.42 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ bright }) => 1800 + bright * 5200, Q: 1.4 },
    envelope: { attack: 0.004, decay: 0.09, sustain: 0.12, release: 0.08 },
  });

  const dischargeTone = voice<{ duration: number; success: boolean }>({
    oscillators: [
      { type: ({ success }) => success ? 'sine' : 'sawtooth', gain: 1 },
      { type: 'triangle', octave: -1, gain: 0.75 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      cutoff: ({ success }) => success ? 6200 : 1250,
      frequencyAutomation: (time, { duration, success }) => [{
        type: success ? 'exponentialRamp' : 'linearRamp',
        value: success ? 180 : 3600,
        time: time + duration * 0.9,
      }],
    },
    envelope: { attack: 0.015, decay: 0.2, sustain: 0.55, release: 0.8 },
  });

  const noise = noiseHit({ filterType: 'highpass', frequency: 4200, decay: 0.05 });

  return defineInstruments({ trace: environment.trace, context: environment.context }, {
    coil(context, time, midi, velocity, duration, heat) {
      const output = musicOut();
      if (!output) return;
      coilTone.play({ context, time, midi, velocity, duration, heat, destination: output });
    },
    bass(context, time, midi, velocity, duration) {
      const output = musicOut();
      if (!output) return;
      bassTone.play({ context, time, midi, velocity, duration, destination: output });
    },
    pulse(context, time, midi, velocity, heat) {
      const output = musicOut();
      if (!output) return;
      pulseTone.play({ context, time, midi, velocity, heat, destination: output });
    },
    player(context, time, midi, velocity, duration, bright) {
      const output = sfxOut();
      if (!output) return;
      playerTone.play({ context, time, midi, velocity, duration, bright, destination: output });
    },
    crack(context, time, velocity, frequency, decay) {
      const output = sfxOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      noise.play({ context, buffer, time, destination: output, velocity, frequency, decay, offset: Math.random() * 1.4 });
    },
    discharge(context, time, midi, velocity, duration, success) {
      const output = musicOut();
      if (!output) return;
      environment.mix()?.duckAt(time, success ? 0.08 : 0.35, success ? 2.4 : 0.9);
      dischargeTone.play({ context, time, midi, velocity, duration, success, destination: output });
    },
  });
}

export type MassDriverVoices = ReturnType<typeof createMassDriverVoices>;
