import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// Leaf synth construction for the workshop-pop kit: bell mallets, clipped
// reed-organ stabs, a bouncy octave bass, handclaps, and tiny tick-tock
// percussion. All gains are tuned by perceived loudness — the saw organ and
// square bass sit far below the sine bells on paper.

export type TinkerKillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number };

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

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.16,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 46, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.46 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // Music-box mallet: a pure tone with a quiet 3rd-partial ping over it.
  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', frequencyRatio: 3.02, gain: 0.16 },
    ],
    duration: 0.34,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.15 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  // Clipped reed organ: two detuned saws through a mid lowpass, chopped short.
  const organTone = voice<{ vel: number; detune: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.13,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 1350, Q: 1.2 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.05 * vel, time: time + 0.008 },
      { type: 'set', value: 0.05 * vel, time: time + 0.1 },
      { type: 'linearRamp', value: 0, time: time + 0.13 },
    ],
  });

  // Bouncy bass: a square pluck with a snapping filter.
  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.21,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 240 + vel * 760, time },
        { type: 'exponentialRamp', value: 150, time: time + 0.18 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.22 * vel, time: time + 0.006 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.21 },
    ],
  });

  const padTone = voice<{ duration: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 520, time },
        { type: 'linearRamp', value: 900, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 520, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.055, time: time + 0.4 },
      { type: 'set', value: 0.055, time: time + duration - 0.35 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // Tick-tock woodblock: a tight sine blip with a bandpass knock.
  const tickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.05,
    stopPadding: 0.02,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.72, time: time + 0.04 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.16 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.05 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 140, vel, destination: output });
      noiseHit(time, 0.06 * vel, 0.004, 'highpass', 1600, output);
      mix.duckAt(time, 0.5, 0.22);
    },

    clap(_context, time) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.15, 0.045, 'bandpass', 2000, output);
      noiseHit(time + 0.012, 0.09, 0.065, 'bandpass', 2400, output);
    },

    shaker(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8200, duck);
    },

    tick(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      tickTone.play({ context, time, midi, vel, destination: duck });
      noiseHit(time, 0.045 * vel, 0.012, 'bandpass', 3400, duck);
    },

    bell(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      bellTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.45 }] });
    },

    organ(context, time, midis, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          organTone.play({ context, time, midi, vel, detune, destination: duck });
        }
      }
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    pad(context, time, midis, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      for (const midi of midis) {
        for (const detune of [-6, 6]) {
          padTone.play({ context, time, midi, detune, duration, destination: [mix.duck, mix.delaySend] });
        }
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
            { type: 'set', value: 260, time },
            { type: 'exponentialRamp', value: 5600, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.13, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },
  }, {
    kick: ['vel'],
    clap: [],
    shaker: ['vel', 'decay'],
    tick: ['midi', 'vel'],
    bell: ['midi', 'vel'],
    organ: ['midis', 'vel'],
    bass: ['midi', 'vel'],
    pad: ['midis', 'duration'],
    riser: ['duration'],
  });

  return {
    ...instruments,
    noiseHit,
  };
}
