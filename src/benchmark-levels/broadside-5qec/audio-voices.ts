import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { voice, noiseHit } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// Construction only: the score selects registers, dynamics and articulation.
export function createVoices(env: { context(): AudioContext | null; mix(): MixBus | null; trace?: AudioTraceSink }) {
  const bowed = voice<{ length: number }>({
    oscillators: [{ type: 'sawtooth', detune: -8, gain: 0.45 }, { type: 'sawtooth', detune: 8, gain: 0.4 }, { type: 'triangle', octave: -1, gain: 0.15 }],
    filter: { type: 'lowpass', cutoff: 1800, Q: 0.6 },
    duration: ({ length }) => length + 0.2,
    envelope: { attack: 0.055, decay: ({ length }) => Math.max(0.08, length * 0.2), sustain: 0.65, release: 0.18 },
  });
  const horn = voice<{ length: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.65 }, { type: 'square', gain: 0.11 }, { type: 'sine', gain: 0.3 }],
    duration: ({ length }) => length + 0.2,
    filter: { type: 'lowpass', Q: 1, frequencyAutomation: (t, { length }) => [ { type: 'set', value: 430, time: t }, { type: 'linearRamp', value: 1700, time: t + 0.08 }, { type: 'linearRamp', value: 700, time: t + length } ] },
    frequencyAutomation: (t, f) => [{ type: 'set', value: f * 0.985, time: t }, { type: 'linearRamp', value: f, time: t + 0.05 }],
    envelope: { attack: 0.03, decay: 0.08, sustain: 0.75, release: 0.17 },
  });
  const drum = voice({ oscillators: [{ type: 'sine', gain: 1 }, { type: 'triangle', frequencyRatio: 1.51, gain: 0.11 }], duration: 0.65,
    frequencyAutomation: (t, f) => [{ type: 'set', value: f * 1.7, time: t }, { type: 'exponentialRamp', value: f, time: t + 0.08 }], envelope: { attack: 0.002, decay: 0.65 } });
  const solo = voice<{ length: number }>({ oscillators: [{ type: 'triangle', gain: 0.65 }, { type: 'sine', octave: 1, gain: 0.25 }], duration: ({ length }) => length, envelope: { attack: 0.003, decay: ({ length }) => length }, filter: { type: 'lowpass', cutoff: 4500 } });
  const noise = noiseHit({ filterType: 'bandpass', frequency: 2300, decay: 0.14 });
  const sends = (gain: number) => env.mix()?.reverbSend ? [{ destination: env.mix()!.reverbSend!, gain }] : [];
  return defineInstruments({ context: env.context, trace: env.trace }, {
    strings(ctx, time, midi: number, length: number, gain: number) { const mix = env.mix(); if (mix) bowed.play({ context: ctx, time, midi, length, gain, destination: mix.music, sends: sends(0.3) }); },
    brass(ctx, time, midi: number, length: number, gain: number) { const mix = env.mix(); if (mix) horn.play({ context: ctx, time, midi, length, gain, destination: mix.music, sends: sends(0.32) }); },
    timpani(ctx, time, midi: number, gain: number) { const mix = env.mix(); if (mix) drum.play({ context: ctx, time, midi, gain, destination: mix.music, sends: sends(0.2) }); },
    snare(ctx, time, gain: number) { const mix = env.mix(); if (mix?.noiseBuffer) noise.play({ context: ctx, buffer: mix.noiseBuffer, time, velocity: gain, destination: mix.music }); },
    cymbal(ctx, time, gain: number) { const mix = env.mix(); if (mix?.noiseBuffer) noise.play({ context: ctx, buffer: mix.noiseBuffer, time, velocity: gain, decay: 1.2, filterType: 'highpass', frequency: 4200, destination: mix.music }); },
    action(ctx, time, midi: number, length: number, gain: number) { const mix = env.mix(); if (mix) solo.play({ context: ctx, time, midi, length, gain, destination: mix.sfx, sends: sends(0.22) }); },
    impact(ctx, time, gain: number) { const mix = env.mix(); if (mix) { drum.play({ context: ctx, time, midi: 28, gain: gain * 0.6, destination: mix.sfx }); if (mix.noiseBuffer) noise.play({ context: ctx, buffer: mix.noiseBuffer, time, velocity: gain * 0.2, frequency: 650, decay: 0.3, destination: mix.sfx }); } },
  });
}
