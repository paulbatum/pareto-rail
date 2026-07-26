import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// Leaf module: the band. Bell-like mallets on top, a clipped reed organ for
// stabs, a bouncy synth bass, handclaps, and the small percussion of a
// workshop — pencil taps, bead shakers, and a wooden block. Nothing here
// decides when it plays.

export type TinkerKillVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  partial: number;
  shimmer: number;
};

export type TinkerVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createTinkerVoices(environment: TinkerVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(
    time: number,
    vel: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    destination: AudioNode,
  ) {
    const context = environment.context();
    const noiseBuffer = environment.mix()?.noiseBuffer;
    if (!context || !noiseBuffer) return;
    noiseHitVoice.play({
      context,
      buffer: noiseBuffer,
      time,
      velocity: vel,
      decay,
      filterType,
      frequency,
      destination,
      loopStart: Math.random(),
      offset: Math.random() * 1.5,
    });
  }

  // A struck bar: pure fundamental with two inharmonic partials that die faster.
  const malletTone = voice<{ vel: number; decay: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', gain: 0.3, frequencyRatio: 2.76 },
      { type: 'sine', gain: 0.12, frequencyRatio: 5.4 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { vel, decay }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.34 * vel * gain, time: time + 0.004 },
      { type: 'exponentialRamp', value: 0.0001, time: time + decay },
    ],
  });

  // Clipped reed organ: bright, short, and slightly out of breath.
  const organTone = voice<{ vel: number; decay: number }>({
    oscillators: [
      { type: 'square', gain: 0.5 },
      { type: 'sawtooth', gain: 0.34, detune: 7 },
      { type: 'square', gain: 0.22, octave: 1, detune: -9 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    filter: {
      type: 'bandpass',
      Q: 1.1,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 900 + vel * 1500, time },
        { type: 'exponentialRamp', value: 700, time: time + 0.14 },
      ],
    },
    gainAutomation: (time, gain, { vel, decay }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.09 * vel * gain, time: time + 0.008 },
      { type: 'set', value: 0.075 * vel * gain, time: time + decay * 0.55 },
      { type: 'exponentialRamp', value: 0.0001, time: time + decay },
    ],
  });

  const bassTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 1 },
      { type: 'square', gain: 0.34, octave: 1 },
    ],
    duration: 0.26,
    stopPadding: 0.04,
    // The bounce: pitch snaps down from a fifth above in the first 30 ms.
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.5, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.03 },
    ],
    filter: {
      type: 'lowpass',
      Q: 7,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 320 + vel * 1500, time },
        { type: 'exponentialRamp', value: 190, time: time + 0.22 },
      ],
    },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.3 * vel * gain, time: time + 0.006 },
      { type: 'exponentialRamp', value: 0.0001, time: time + 0.26 },
    ],
  });

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.18,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 48, time: time + 0.09 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.46 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });

  const padTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'triangle', gain: 1 },
      { type: 'sawtooth', gain: 0.24, detune: 6 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 520, time },
        { type: 'linearRamp', value: 1100, time: time + duration * 0.45 },
        { type: 'linearRamp', value: 520, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.038, time: time + 0.35 },
      { type: 'set', value: 0.038, time: time + duration - 0.35 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const blockTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 1 }, { type: 'square', gain: 0.16, frequencyRatio: 3.1 }],
    duration: 0.09,
    stopPadding: 0.02,
    frequencyAutomation: (time, frequency) => [
      { type: 'exponentialRamp', value: frequency * 0.72, time: time + 0.07 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.2 * vel, time },
      { type: 'exponentialRamp', value: 0.0001, time: time + 0.09 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 138, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.004, 'highpass', 1600, output);
      mix.duckAt(time, 0.5, 0.2);
    },

    clap(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      // Three quick slaps: a real handclap is never one hit.
      noiseHit(time, 0.14 * vel, 0.012, 'bandpass', 1750, output);
      noiseHit(time + 0.011, 0.11 * vel, 0.016, 'bandpass', 2100, output);
      noiseHit(time + 0.024, 0.16 * vel, 0.09, 'bandpass', 1550, output);
    },

    shake(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.028, 'highpass', 6800, duck);
    },

    tick(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.05 * vel, 0.006, 'highpass', 3400, duck);
      blockTone.play({ context, time, frequency: 2050, vel: vel * 0.32, destination: duck });
    },

    block(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      blockTone.play({ context, time, midi, vel, destination: duck });
      noiseHit(time, 0.05 * vel, 0.01, 'bandpass', 1200, duck);
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    mallet(context, time, midi, vel, decay) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      malletTone.play({
        context,
        time,
        midi,
        vel,
        decay,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.4 }],
      });
    },

    organ(context, time, midis, vel, decay) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis as number[]) {
        organTone.play({ context, time, midi, vel, decay, destination: mix.duck });
      }
    },

    pad(context, time, midis, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      for (const midi of midis as number[]) {
        padTone.play({ context, time, midi, duration, destination: [mix.duck, mix.delaySend] });
      }
    },

    riser(context, time, duration) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequencyAutomation: [
            { type: 'set', value: 420, time },
            { type: 'exponentialRamp', value: 7200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.13, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    shake: ['vel'],
    tick: ['vel'],
    block: ['midi', 'vel'],
    bass: ['midi', 'vel'],
    mallet: ['midi', 'vel', 'decay'],
    organ: ['midis', 'vel', 'decay'],
    pad: ['midis', 'duration'],
    riser: ['duration'],
  });

  return { ...instruments, noiseHit };
}
