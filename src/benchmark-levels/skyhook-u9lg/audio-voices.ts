import { defineInstruments, playNoiseHit } from '../../engine/audio-kit';
import type { MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { voice } from '../../engine/audio-voices';

export function createSkyhookVoices(environment: { context(): AudioContext | null; mix(): MixBus | null; trace?: AudioTraceSink }) {
  const tonal = voice<{ decay: number; brightness: number; waveform: OscillatorType }>({
    oscillators: [{ type: ({ waveform }) => waveform }], duration: ({ decay }) => decay, stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ brightness }) => brightness },
    envelope: { attack: 0.004, decay: ({ decay }) => decay },
  });
  const cushion = voice<{ length: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.16, detune: 6 }],
    duration: ({ length }) => length, stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 1200 },
    envelope: { attack: 0.35, decay: 0.5, sustain: 0.6, release: 0.8 },
  });
  return defineInstruments(environment, {
    tone(context, time, midi: number, gain: number, decay: number, brightness: number, waveform: OscillatorType = 'sine', player = false) {
      const mix = environment.mix(); if (!mix) return;
      tonal.play({ context, time, midi, gain, decay, brightness, waveform, destination: player ? mix.sfx : mix.duck, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.14 }] : undefined });
    },
    pad(context, time, notes: number[], gain: number, length: number) {
      const mix = environment.mix(); if (!mix) return;
      notes.forEach((midi, i) => {
        const pan = context.createStereoPanner(); pan.pan.value = (i / Math.max(1, notes.length - 1) - 0.5) * 1.7; pan.connect(mix.duck);
        cushion.play({ context, time, midi, gain: gain / notes.length, length, destination: pan, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.35 }] : undefined });
        // The panner is disconnected with its voices instead of accumulating
        // a run's worth of attached nodes in the mix graph.
        const timer = setTimeout(() => pan.disconnect(), Math.max(0, (time + length + 0.1 - context.currentTime) * 1000));
        void timer;
      });
    },
    air(context, time, gain: number, decay: number, cutoff: number, player = false) {
      const mix = environment.mix(); if (!mix?.noiseBuffer) return;
      playNoiseHit({ context, buffer: mix.noiseBuffer, time, velocity: gain, decay, filterType: 'bandpass', frequency: cutoff, destination: player ? mix.sfx : mix.duck });
    },
    thump(context, time, gain: number) {
      const mix = environment.mix(); if (!mix) return;
      tonal.play({ context, time, frequency: 95, gain, decay: 0.22, brightness: 260, waveform: 'sine', destination: mix.duck, frequencyAutomation: [{ type: 'exponentialRamp', value: 38, time: time + 0.18 }] });
    },
  });
}
