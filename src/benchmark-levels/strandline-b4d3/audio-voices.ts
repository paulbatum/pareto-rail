import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

type Environment = { context(): AudioContext | null; mix(): MixBus | null; trace?: AudioTraceSink };

export function createWaterVoices(environment: Environment) {
  const pluck = voice<{ decay: number; brightness: number }>({
    oscillators: [{ type: 'sine', gain: 0.82 }, { type: 'triangle', gain: 0.12 }, { type: 'sine', octave: 1, gain: 0.13 }],
    duration: ({ decay }) => decay, stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ brightness }) => brightness },
    envelope: { attack: 0.004, decay: ({ decay }) => decay },
  });
  const cloud = voice<{ length: number; brightness: number }>({
    oscillators: [{ type: 'triangle', detune: -4, gain: 0.42 }, { type: 'sine', detune: 4, gain: 0.58 }],
    duration: ({ length }) => length, stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ brightness }) => brightness },
    envelope: { attack: 0.65, decay: 0.6, sustain: 0.62, release: 1.25 },
  });
  const pulse = voice({
    oscillators: [{ type: 'sine' }], duration: 0.32, stopPadding: 0.03,
    frequencyAutomation: (time, f) => [{ type: 'set', value: f * 1.65, time }, { type: 'exponentialRamp', value: f, time: time + 0.13 }],
    envelope: { attack: 0.007, decay: 0.32 },
  });
  const breath = noiseHit({ filterType: 'bandpass', frequency: 1500, decay: 0.18, velocity: 1 });
  const slide = voice<{ length: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.11 }],
    duration: ({ length }) => length, stopPadding: 0.02,
    frequencyAutomation: (time, f, { length }) => [{ type: 'exponentialRamp', value: f * 0.58, time: time + length * 0.85 }],
    filter: { type: 'lowpass', cutoff: 1700 }, envelope: { decay: ({ length }) => length },
  });
  const sends = (amount: number) => {
    const mix = environment.mix();
    return [
      ...(mix?.delaySend ? [{ destination: mix.delaySend, gain: amount }] : []),
      ...(mix?.reverbSend ? [{ destination: mix.reverbSend, gain: amount * 0.7 }] : []),
    ];
  };
  return defineInstruments(environment, {
    waterPulse(context, time, midi: number, gain: number) {
      const mix = environment.mix(); if (!mix) return;
      pulse.play({ context, time, midi, gain, destination: mix.duck });
    },
    glass(context, time, midi: number, gain: number, decay: number, brightness: number) {
      const mix = environment.mix(); if (!mix) return;
      pluck.play({ context, time, midi, gain, decay, brightness, destination: mix.duck, sends: sends(0.4) });
    },
    chordCloud(context, time, notes: number[], gain: number, length: number, brightness: number) {
      const mix = environment.mix(); if (!mix) return;
      for (const midi of notes) cloud.play({ context, time, midi, gain, length, brightness, destination: mix.duck, sends: sends(0.25) });
    },
    waterBrush(context, time, gain: number, frequency: number, decay: number) {
      const mix = environment.mix(); if (!mix?.noiseBuffer) return;
      breath.play({ context, buffer: mix.noiseBuffer, time, velocity: gain, frequency, decay, destination: mix.duck });
    },
    playerNote(context, time, midi: number, gain: number, decay: number, brightness: number) {
      const mix = environment.mix(); if (!mix) return;
      pluck.play({ context, time, midi, gain, decay, brightness, destination: mix.sfx, sends: sends(0.45) });
    },
    releaseNote(context, time, midi: number, gain: number, length: number) {
      const mix = environment.mix(); if (!mix) return;
      slide.play({ context, time, midi, gain, length, destination: mix.sfx, sends: sends(0.14) });
    },
    lysis(context, time, gain: number, decay: number) {
      const mix = environment.mix(); if (!mix?.noiseBuffer) return;
      breath.play({ context, buffer: mix.noiseBuffer, time, velocity: gain, frequency: 2900, decay, destination: mix.sfx });
    },
  });
}
