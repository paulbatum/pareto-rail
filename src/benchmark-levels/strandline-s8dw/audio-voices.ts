import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createStrandlineVoices(environment: VoiceEnvironment) {
  const musicOut = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const tidePad = voice<{ duration: number; light: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'triangle', octave: 1, detune: 6, gain: ({ light }) => 0.08 + light * 0.18 },
      { type: 'sine', octave: -1, gain: 0.34 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.2,
    filter: { type: 'lowpass', cutoff: ({ light }) => 420 + light * 2500, Q: 0.7 },
    envelope: { attack: 0.28, decay: 0.35, sustain: 0.62, release: 1.2, peak: 0.82 },
  });

  const pulseTone = voice<{ duration: number; light: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', octave: 1, gain: 0.22 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ light }) => 330 + light * 1100, Q: 1.4 },
    envelope: { attack: 0.012, decay: 0.16, sustain: 0.16, release: 0.18 },
  });

  const shimmerTone = voice<{ duration: number; light: number }>({
    oscillators: [
      { type: 'sine' },
      { type: 'sine', octave: 1, detune: -7, gain: 0.28 },
      { type: 'triangle', octave: 2, gain: ({ light }) => 0.06 + light * 0.14 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'bandpass', cutoff: ({ light }) => 1200 + light * 3300, Q: 1.6 },
    envelope: { attack: 0.015, decay: 0.24, sustain: 0.2, release: 0.42 },
  });

  const parasiteTone = voice<{ duration: number; open: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.65 },
      { type: 'square', octave: -1, detune: 9, gain: 0.22 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'bandpass', cutoff: ({ open }) => 370 + open * 1600, Q: 4.2 },
    envelope: { attack: 0.006, decay: 0.11, sustain: 0.12, release: 0.16 },
  });

  const playerTone = voice<{ duration: number; bright: number }>({
    oscillators: [
      { type: 'triangle' },
      { type: 'sine', octave: 1, gain: ({ bright }) => 0.24 + bright * 0.26 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ bright }) => 1700 + bright * 5000, Q: 1.2 },
    envelope: { attack: 0.003, decay: 0.1, sustain: 0.1, release: 0.11 },
  });

  const releaseTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'sine' },
      { type: 'sine', octave: 1, gain: 0.36 },
      { type: 'triangle', octave: -1, gain: 0.18 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.25,
    filter: {
      type: 'lowpass',
      frequency: 5200,
      frequencyAutomation: (time, { duration }) => [{ type: 'exponentialRamp', value: 520, time: time + duration * 0.9 }],
    },
    envelope: { attack: 0.08, decay: 0.3, sustain: 0.58, release: 1.6 },
  });

  const waterNoise = noiseHit({ filterType: 'bandpass', frequency: 3600, decay: 0.12 });
  const currentNoise = noiseHit({ filterType: 'lowpass', frequency: 1100, decay: 1.25 });

  return defineInstruments({ trace: environment.trace, context: environment.context }, {
    pad(context, time, midi, velocity, duration, light) {
      const destination = musicOut();
      if (destination) tidePad.play({ context, time, midi, velocity, duration, light, destination });
    },
    pulse(context, time, midi, velocity, duration, light) {
      const destination = musicOut();
      if (destination) pulseTone.play({ context, time, midi, velocity, duration, light, destination });
    },
    shimmer(context, time, midi, velocity, duration, light) {
      const destination = musicOut();
      if (destination) shimmerTone.play({ context, time, midi, velocity, duration, light, destination });
    },
    parasite(context, time, midi, velocity, duration, open) {
      const destination = musicOut();
      if (destination) parasiteTone.play({ context, time, midi, velocity, duration, open, destination });
    },
    player(context, time, midi, velocity, duration, bright) {
      const destination = sfxOut();
      if (destination) playerTone.play({ context, time, midi, velocity, duration, bright, destination });
    },
    wash(context, time, velocity, frequency, decay) {
      const destination = sfxOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (destination && buffer) waterNoise.play({
        context,
        buffer,
        time,
        destination,
        velocity,
        frequency,
        decay,
        offset: Math.random() * 1.4,
      });
    },
    current(context, time, velocity, frequency, decay) {
      const destination = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (destination && buffer) currentNoise.play({
        context,
        buffer,
        time,
        destination,
        velocity,
        frequency,
        decay,
        offset: Math.random() * 0.6,
      });
    },
    release(context, time, midi, velocity, duration) {
      const destination = musicOut();
      if (!destination) return;
      environment.mix()?.duckAt(time, 0.12, 1.5);
      releaseTone.play({ context, time, midi, velocity, duration, destination });
    },
  });
}

export type StrandlineVoices = ReturnType<typeof createStrandlineVoices>;
