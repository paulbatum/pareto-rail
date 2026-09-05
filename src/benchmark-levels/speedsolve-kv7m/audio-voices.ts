import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { voice, noiseHit } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

type Environment = { context(): AudioContext | null; mix(): MixBus | null; trace?: AudioTraceSink };
export function createVoices(env: Environment) {
  const pluck = voice<{ gain: number; decay: number; cutoff: number }>({
    oscillators: [{ type: 'triangle' }, { type: 'sine', octave: 1, gain: 0.16 }],
    duration: c => c.decay, filter: { type: 'lowpass', cutoff: c => c.cutoff },
    envelope: { attack: 0.0015, decay: c => c.decay },
  });
  const knock = voice<{ gain: number; decay: number }>({
    oscillators: [{ type: 'sine' }], duration: c => c.decay,
    frequencyAutomation: t => [{ type: 'exponentialRamp', value: 58, time: t + 0.065 }],
    envelope: { attack: 0.001, decay: c => c.decay },
  });
  const metal = voice<{ gain: number; decay: number }>({
    oscillators: [{ type: 'sine' }, { type: 'sine', frequencyRatio: 2.76, gain: 0.24 }, { type: 'sine', frequencyRatio: 4.07, gain: 0.08 }],
    duration: c => c.decay, envelope: { attack: 0.001, decay: c => c.decay },
  });
  const tick = noiseHit({ filterType: 'highpass', frequency: 4800, velocity: 0.1, decay: 0.024 });
  const noise = (context: AudioContext, time: number, gain: number, decay: number, hz: number, destination: AudioNode) => {
    const buffer = env.mix()?.noiseBuffer; if (!buffer) return;
    tick.play({ context, time, buffer, velocity: gain, decay, frequency: hz, destination, offset: (time * 0.317) % 0.8 });
  };
  return defineInstruments({ context: env.context, trace: env.trace }, {
    kick(context, time, velocity: number) {
      const mix = env.mix(); if (!mix) return;
      knock.play({ context, time, frequency: 135, gain: 0.36 * velocity, decay: 0.14, destination: mix.music });
      noise(context, time, 0.02 * velocity, 0.008, 1600, mix.music);
      mix.duckAt(time, 0.8, 0.1);
    },
    click(context, time, midi: number, velocity: number) {
      const out = env.mix()?.music; if (!out) return;
      metal.play({ context, time, midi, gain: velocity * 0.045, decay: 0.038, destination: out });
    },
    hat(context, time, velocity: number) {
      const out = env.mix()?.music; if (out) noise(context, time, velocity * 0.045, 0.025, 6600, out);
    },
    snap(context, time, velocity: number) {
      const out = env.mix()?.music; if (!out) return;
      noise(context, time, velocity * 0.07, 0.046, 2200, out);
      metal.play({ context, time, midi: 57, gain: velocity * 0.027, decay: 0.06, destination: out });
    },
    bass(context, time, midi: number, velocity: number) {
      const out = env.mix()?.duck; if (!out) return;
      pluck.play({ context, time, midi, gain: velocity * 0.23, decay: 0.19, cutoff: 650, destination: out });
    },
    wood(context, time, midi: number, velocity: number) {
      const out = env.mix()?.duck; if (!out) return;
      pluck.play({ context, time, midi, gain: velocity * 0.07, decay: 0.075, cutoff: 1800, destination: out });
    },
    turn(context, time, midi: number, velocity: number) {
      const out = env.mix()?.sfx; if (!out) return;
      // The same dry resonator as the clock, with the low body of a layer detent.
      metal.play({ context, time, midi, gain: velocity * 0.12, decay: 0.095, destination: out });
      knock.play({ context, time, frequency: 180, gain: velocity * 0.17, decay: 0.065, destination: out });
      noise(context, time, velocity * 0.05, 0.012, 3000, out);
    },
    action(context, time, midi: number, gain: number, decay: number, brightness: number) {
      const out = env.mix()?.sfx; if (!out) return;
      pluck.play({ context, time, midi, gain, decay, cutoff: brightness, destination: out });
    },
    bell(context, time, midi: number, gain: number, decay: number) {
      const out = env.mix()?.sfx; if (!out) return;
      metal.play({ context, time, midi, gain, decay, destination: out });
    },
    reject(context, time) {
      const out = env.mix()?.sfx; if (!out) return;
      for (let i = 0; i < 2; i++) {
        metal.play({ context, time: time + i * 0.055, midi: 47 - i * 5, gain: 0.06, decay: 0.06, destination: out });
        noise(context, time + i * 0.055, 0.018, 0.015, 1000, out);
      }
    },
  });
}
