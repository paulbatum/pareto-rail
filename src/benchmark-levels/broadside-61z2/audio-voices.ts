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
  const sends = (gain: number) => {
    const delay = environment.mix()?.delaySend;
    return delay ? [{ destination: delay, gain }] : undefined;
  };

  const stringTone = voice<{ duration: number; air: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.28 },
      { type: 'triangle', octave: 1, gain: ({ air }) => 0.08 + air * 0.08, detune: -5 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: ({ air }) => 720 + air * 2200, Q: 0.7 },
    envelope: { attack: 0.12, decay: 0.42, sustain: 0.58, release: 0.35, peak: 0.7 },
  });

  const choirTone = voice<{ duration: number; brightness: number }>({
    oscillators: [
      { type: 'sine', gain: 0.36 },
      { type: 'triangle', octave: 1, gain: ({ brightness }) => 0.08 + brightness * 0.1, detune: 7 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.12,
    filter: { type: 'lowpass', cutoff: ({ brightness }) => 900 + brightness * 2600, Q: 0.55 },
    envelope: { attack: 0.2, decay: 0.55, sustain: 0.5, release: 0.52, peak: 0.42 },
  });

  const brassTone = voice<{ duration: number; weight: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.18 },
      { type: 'square', octave: 1, gain: ({ weight }) => 0.035 + weight * 0.045, detune: -3 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      cutoff: ({ weight }) => 780 + weight * 3300,
      Q: 1.1,
      frequencyAutomation: (time, { duration, weight }) => [{
        type: 'linearRamp',
        value: 420 + weight * 1200,
        time: time + duration * 0.88,
      }],
    },
    envelope: { attack: 0.018, decay: 0.18, sustain: 0.42, release: 0.18, peak: 0.68 },
  });

  const bassTone = voice<{ duration: number; grow: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.65 },
      { type: 'sine', octave: -1, gain: ({ grow }) => 0.45 + grow * 0.22 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: ({ grow }) => 260 + grow * 520, Q: 1.35 },
    envelope: { attack: 0.012, decay: 0.15, sustain: 0.5, release: 0.18, peak: 0.55 },
  });

  const timpaniTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'triangle', octave: -1, gain: 0.28 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    frequencyAutomation: (time, frequency, { duration }) => [{
      type: 'exponentialRamp',
      value: frequency * 0.68,
      time: time + duration * 0.9,
    }],
    filter: { type: 'lowpass', frequency: 680, Q: 0.8 },
    envelope: { attack: 0.004, decay: 0.26, release: 0.18, peak: 0.72 },
  });

  const pulseTone = voice<{ brightness: number }>({
    oscillators: [{ type: 'square', gain: 0.14 }],
    duration: 0.055,
    stopPadding: 0.025,
    filter: { type: 'bandpass', cutoff: ({ brightness }) => 1300 + brightness * 4200, Q: 5.5 },
    envelope: { attack: 0.001, decay: 0.052, peak: 0.55 },
  });

  const playerTone = voice<{ duration: number; shine: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.28 },
      { type: 'sine', octave: 1, gain: ({ shine }) => 0.12 + shine * 0.22 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ shine }) => 1800 + shine * 4800, Q: 1.25 },
    envelope: { attack: 0.004, decay: 0.1, sustain: 0.16, release: 0.1, peak: 0.62 },
  });

  const cannonTone = voice<{ duration: number; size: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.32 },
      { type: 'sine', octave: -1, gain: ({ size }) => 0.22 + size * 0.18 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      cutoff: ({ size }) => 420 + size * 950,
      Q: 0.9,
      frequencyAutomation: (time, { duration, size }) => [{
        type: 'exponentialRamp',
        value: 150 + size * 260,
        time: time + duration * 0.9,
      }],
    },
    envelope: { attack: 0.002, decay: 0.16, sustain: 0.2, release: 0.26, peak: 0.78 },
  });

  const rejectTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.24 }, { type: 'square', octave: -1, gain: 0.08 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      cutoff: 900,
      frequencyAutomation: (time, { duration }) => [{ type: 'exponentialRamp', value: 170, time: time + duration * 0.92 }],
    },
    envelope: { attack: 0.002, decay: 0.18, peak: 0.52 },
  });

  const noise = noiseHit({ filterType: 'highpass', frequency: 4200, decay: 0.06 });

  return defineInstruments({ trace: environment.trace, context: environment.context }, {
    strings(context, time, midi, velocity, duration, air) {
      const output = musicOut();
      if (!output) return;
      stringTone.play({ context, time, midi, velocity, duration, air, destination: output, sends: sends(0.32) });
    },
    choir(context, time, midi, velocity, duration, brightness) {
      const output = musicOut();
      if (!output) return;
      choirTone.play({ context, time, midi, velocity, duration, brightness, destination: output, sends: sends(0.42) });
    },
    brass(context, time, midi, velocity, duration, weight) {
      const output = musicOut();
      if (!output) return;
      brassTone.play({ context, time, midi, velocity, duration, weight, destination: output, sends: sends(0.22) });
    },
    bass(context, time, midi, velocity, duration, grow) {
      const output = musicOut();
      if (!output) return;
      bassTone.play({ context, time, midi, velocity, duration, grow, destination: output });
    },
    timpani(context, time, midi, velocity, duration) {
      const output = musicOut();
      if (!output) return;
      timpaniTone.play({ context, time, midi, velocity, duration, destination: output, sends: sends(0.16) });
    },
    pulse(context, time, midi, velocity, brightness) {
      const output = musicOut();
      if (!output) return;
      pulseTone.play({ context, time, midi, velocity, brightness, destination: output });
    },
    player(context, time, midi, velocity, duration, shine) {
      const output = sfxOut();
      if (!output) return;
      playerTone.play({ context, time, midi, velocity, duration, shine, destination: output, sends: sends(0.25) });
    },
    cannon(context, time, midi, velocity, duration, size) {
      const output = sfxOut();
      if (!output) return;
      cannonTone.play({ context, time, midi, velocity, duration, size, destination: output, sends: sends(0.18) });
    },
    crack(context, time, velocity, frequency, decay) {
      const output = sfxOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      noise.play({ context, buffer, time, destination: output, velocity, frequency, decay, offset: Math.random() * 1.35 });
    },
    reject(context, time, midi, velocity, duration) {
      const output = sfxOut();
      if (!output) return;
      rejectTone.play({ context, time, midi, velocity, duration, destination: output });
    },
  });
}

export type BroadsideVoices = ReturnType<typeof createBroadsideVoices>;
