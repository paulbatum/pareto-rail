import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

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

  // Bell-like mallet: sine fundamental plus a bright fifth-partial ping.
  const malletTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }, { type: 'sine', octave: 1, gain: 0.28 }],
    duration: 0.34,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 5200 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.2 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  // Clipped reed-organ stab: band-limited saw with a fast choke.
  const reedTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }, { type: 'sawtooth', detune: 8, gain: 0.5 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 3,
      frequencyAutomation: (time) => [
        { type: 'set', value: 2600, time },
        { type: 'exponentialRamp', value: 700, time: time + 0.15 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.16 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // Bouncy synth bass: square with pitch scoop and a snappy filter.
  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 0.89, time: time + 0.05 }],
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 300 + vel * 900, time },
        { type: 'exponentialRamp', value: 180, time: time + 0.2 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.26 * vel, time: time + 0.008 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.15,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 44, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  // Workshop woodblock: high sine tick with a woody overtone.
  const blockTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }, { type: 'sine', octave: 1, gain: 0.35 }],
    duration: 0.09,
    stopPadding: 0.02,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.22 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
    ],
  });

  // Soft reed-organ pad: detuned saws breathing through a slow filter.
  const padTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 500, time },
        { type: 'linearRamp', value: 900, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 500, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.04, time: time + 0.5 },
      { type: 'set', value: 0.04, time: time + duration - 0.4 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.08 * vel, 0.004, 'highpass', 1400, output);
      mix.duckAt(time, 0.45, 0.24);
    },

    clap(_context, time, vel = 1) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.17 * vel, 0.05, 'bandpass', 1800, output);
      noiseHit(time + 0.012, 0.11 * vel, 0.08, 'bandpass', 2300, output);
      noiseHit(time + 0.026, 0.07 * vel, 0.1, 'bandpass', 2600, output);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 7400, duck);
    },

    shaker(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.06 * vel, 0.06, 'highpass', 5600, duck);
      noiseHit(time + 0.03, 0.04 * vel, 0.05, 'highpass', 6400, duck);
    },

    block(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      blockTone.play({ context, time, midi, vel, destination: duck });
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    mallet(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      malletTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.5 }] });
    },

    reed(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      reedTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.3 }] });
    },

    pad(context, time, midis, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
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
          Q: 1.1,
          frequencyAutomation: [
            { type: 'set', value: 350, time },
            { type: 'exponentialRamp', value: 6600, time: time + duration },
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
    clap: ['vel'],
    hat: ['vel', 'decay'],
    shaker: ['vel'],
    block: ['midi', 'vel'],
    bass: ['midi', 'vel'],
    mallet: ['midi', 'vel'],
    reed: ['midi', 'vel'],
    pad: ['midis', 'duration'],
    riser: ['duration'],
  });

  return { ...instruments, noiseHit };
}
