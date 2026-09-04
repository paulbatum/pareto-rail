import { defineInstruments, playNoiseHit, type InstrumentEnvironment, type MixBus } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';

type Note = { duration: number; gain: number; cutoff: number };
const strings = voice<Note>({
  oscillators: [{ type: 'sawtooth', gain: 0.45, detune: -7 }, { type: 'sawtooth', gain: 0.3, detune: 9 }, { type: 'triangle', gain: 0.6 }],
  duration: n => n.duration, stopPadding: 0.08,
  envelope: { attack: 0.045, decay: 0.08, sustain: 0.55, release: 0.12 },
  filter: { type: 'lowpass', cutoff: n => n.cutoff, Q: 0.6 },
});
const brass = voice<Note>({
  oscillators: [{ type: 'sawtooth', gain: 0.6, detune: -3 }, { type: 'square', gain: 0.13, detune: 4 }, { type: 'sine', gain: 0.7 }],
  duration: n => n.duration, stopPadding: 0.08,
  envelope: { attack: 0.065, decay: 0.13, sustain: 0.66, release: 0.16 },
  filter: { type: 'lowpass', Q: 0.75, frequencyAutomation: (t, n) => [
    { type: 'set', value: 450, time: t }, { type: 'linearRamp', value: n.cutoff, time: t + 0.09 },
    { type: 'linearRamp', value: n.cutoff * 0.65, time: t + n.duration },
  ] },
});
const timpani = voice<{ gain: number }>({
  oscillators: [{ type: 'sine', gain: 1 }, { type: 'sine', frequencyRatio: 1.5, gain: 0.2 }, { type: 'sine', frequencyRatio: 2.15, gain: 0.08 }],
  duration: 0.7, stopPadding: 0.05,
  envelope: { attack: 0.003, decay: 0.68 },
  frequencyAutomation: (t, f) => [{ type: 'set', value: f * 1.25, time: t }, { type: 'exponentialRamp', value: f, time: t + 0.055 }],
});
const solo = voice<Note>({
  oscillators: [{ type: 'triangle', gain: 0.62 }, { type: 'sine', gain: 0.35, octave: 1 }],
  duration: n => n.duration, stopPadding: 0.07,
  envelope: { attack: 0.008, decay: n => n.duration },
  filter: { type: 'lowpass', cutoff: n => n.cutoff },
});
const boom = voice({
  oscillators: [{ type: 'sine', gain: 0.27 }], duration: 0.85,
  frequencyAutomation: t => [{ type: 'exponentialRamp', value: 32, time: t + 0.5 }],
  envelope: { attack: 0.002, decay: 0.82 },
});

export function createVoices(environment: InstrumentEnvironment & { mix(): MixBus | null }) {
  const send = (gain: number) => {
    const reverb = environment.mix()?.reverbSend;
    return reverb ? [{ destination: reverb, gain }] : [];
  };
  return defineInstruments(environment, {
    strings(ctx, time, midi: number, duration: number, gain: number, cutoff = 1800) {
      const mix = environment.mix(); if (!mix) return;
      strings.play({ context: ctx, time, midi, duration, gain, cutoff, destination: mix.music, sends: send(0.26) });
    },
    brass(ctx, time, midi: number, duration: number, gain: number, cutoff = 2000) {
      const mix = environment.mix(); if (!mix) return;
      brass.play({ context: ctx, time, midi, duration, gain, cutoff, destination: mix.music, sends: send(0.34) });
    },
    timpani(ctx, time, midi: number, gain: number) {
      const mix = environment.mix(); if (!mix) return;
      timpani.play({ context: ctx, time, midi, gain, destination: mix.music, sends: send(0.26) });
    },
    cymbal(ctx, time, gain: number, decay: number) {
      const mix = environment.mix(); if (!mix?.noiseBuffer) return;
      playNoiseHit({ context: ctx, time, buffer: mix.noiseBuffer, velocity: gain, decay, filterType: 'highpass', frequency: 5700, destination: mix.music });
    },
    snare(ctx, time, gain: number) {
      const mix = environment.mix(); if (!mix?.noiseBuffer) return;
      playNoiseHit({ context: ctx, time, buffer: mix.noiseBuffer, velocity: gain, decay: 0.12, filterType: 'bandpass', frequency: 2300, destination: mix.music });
    },
    solo(ctx, time, midi: number, gain: number, duration = 0.34) {
      const mix = environment.mix(); if (!mix) return;
      solo.play({ context: ctx, time, midi, duration, gain, cutoff: 4400, destination: mix.sfx, sends: send(0.35) });
    },
    lock(ctx, time, midi: number, gain: number) {
      const mix = environment.mix(); if (!mix) return;
      solo.play({ context: ctx, time, midi, duration: 0.095, gain, cutoff: 2900, destination: mix.sfx, sends: send(0.08) });
    },
    fire(ctx, time, midi: number, gain: number) {
      const mix = environment.mix(); if (!mix) return;
      brass.play({ context: ctx, time, midi, duration: 0.19, gain, cutoff: 1400, destination: mix.sfx, sends: send(0.08) });
    },
    impact(ctx, time, midi: number, gain: number) {
      const mix = environment.mix(); if (!mix) return;
      timpani.play({ context: ctx, time, midi, gain, destination: mix.sfx, sends: send(0.16) });
    },
    explosion(ctx, time, gain: number) {
      const mix = environment.mix(); if (!mix) return;
      boom.play({ context: ctx, time, frequency: 120, velocity: gain, destination: mix.sfx });
      if (mix.noiseBuffer) playNoiseHit({ context: ctx, time, buffer: mix.noiseBuffer, velocity: gain * 0.15, decay: 0.7, filterType: 'lowpass', frequency: 850, destination: mix.sfx });
    },
  });
}
