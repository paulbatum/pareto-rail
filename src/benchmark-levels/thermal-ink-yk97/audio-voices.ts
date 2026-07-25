import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Thermal Ink's instrument rack: a slow industrial pulse (kick, sub), a heavy
// bouncing synth bass, sparse metallic percussion (anvil, chain, tick), one
// haunting lead that brightens under infrared, and harbor color — sonar pings,
// a foghorn, ink gurgles, and risers.

export type ThermalVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createThermalVoices(environment: ThermalVoiceEnvironment) {
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
    duration: 0.24,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 40, time: time + 0.15 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.56 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const subTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.3,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 34, time: time + 0.2 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.4 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  // The bounce: a saw bass whose filter snaps open and slams shut, with a sine
  // an octave below to keep the weight when the filter closes.
  const bassSaw = voice<{ vel: number; bright: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      Q: 7,
      frequencyAutomation: (time, { vel, bright }) => [
        { type: 'set', value: 240 + vel * (620 + bright * 900), time },
        { type: 'exponentialRamp', value: 130, time: time + 0.26 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.34 * vel, time: time + 0.008 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const bassSub = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', octave: -1 }],
    duration: 0.28,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.22 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });

  const padTone = voice<{ duration: number; airy: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration, airy }) => [
        { type: 'set', value: 340 + airy * 900, time },
        { type: 'linearRamp', value: 620 + airy * 1400, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 340 + airy * 900, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, airy }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.05 - airy * 0.018, time: time + 0.6 },
      { type: 'set', value: 0.05 - airy * 0.018, time: time + duration - 0.5 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // The haunting melody. bright 0 = murk (hollow triangle), bright 1 =
  // infrared (focused square an octave brighter in the filter).
  const leadDark = voice<{ vel: number; dur: number }>({
    oscillators: [
      { type: 'triangle', gain: 1 },
      { type: 'triangle', gain: 0.55, detune: 7 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 1500 },
    envelope: {
      attack: 0.09,
      decay: ({ dur }) => dur * 0.9,
      peak: ({ vel }) => 0.16 * vel,
    },
  });

  const leadBright = voice<{ vel: number; dur: number }>({
    oscillators: [
      { type: 'square', gain: 0.5 },
      { type: 'sine', gain: 0.6, octave: 1 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 3400, Q: 1.5 },
    envelope: {
      attack: 0.02,
      decay: ({ dur }) => dur * 0.9,
      peak: ({ vel }) => 0.12 * vel,
    },
  });

  const foghornTone = voice<{ vel: number; dur: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sawtooth', gain: 0.12 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.1,
    filter: { type: 'lowpass', cutoff: 300 },
    gainAutomation: (time, _gain, { vel, dur }) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.34 * vel, time: time + dur * 0.35 },
      { type: 'set', value: 0.34 * vel, time: time + dur * 0.7 },
      { type: 'exponentialRamp', value: 0.001, time: time + dur },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 116, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.006, 'highpass', 1600, output);
      mix.duckAt(time, 0.5, 0.3);
    },

    subKick(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      subTone.play({ context, time, frequency: 68, vel, destination: output });
    },

    bass(context, time, midi, vel, bright) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassSaw.play({ context, time, midi, vel, bright, destination: duck });
      bassSub.play({ context, time, midi, vel, destination: duck });
    },

    pad(context, time, midis, duration, airy) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const sends = mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.5 }] : undefined;
      for (const midi of midis) {
        for (const detune of [-6, 6]) {
          padTone.play({ context, time, midi, detune, duration, airy, destination: mix.duck, sends });
        }
      }
    },

    lead(context, time, midi, dur, vel, bright) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      const sends = [];
      if (mix.delaySend) sends.push({ destination: mix.delaySend, gain: 0.5 + bright * 0.2 });
      if (mix.reverbSend) sends.push({ destination: mix.reverbSend, gain: 0.55 });
      if (bright < 0.98) leadDark.play({ context, time, midi, dur, vel: vel * (1 - bright), destination: output, sends });
      if (bright > 0.02) leadBright.play({ context, time, midi, dur, vel: vel * bright, destination: output, sends });
    },

    anvil(context, time, vel) {
      const mix = environment.mix();
      const duck = mix?.duck;
      if (!duck) return;
      // Inharmonic partials: struck harbor steel.
      for (const [ratio, gain, decay] of [[1, 0.09, 0.3], [2.756, 0.05, 0.2], [5.404, 0.028, 0.12]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + decay + 0.05,
          oscillatorType: 'square',
          frequency: 264 * ratio,
          filter: { type: 'bandpass', frequency: 264 * ratio, Q: 9 },
          gainAutomation: [
            { type: 'set', value: gain * vel, time },
            { type: 'exponentialRamp', value: 0.001, time: time + decay },
          ],
          destination: duck,
          sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : undefined,
        });
      }
      noiseHit(time, 0.1 * vel, 0.05, 'bandpass', 3200, duck);
    },

    chain(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      void context;
      for (let i = 0; i < 3; i += 1) {
        noiseHit(time + i * 0.032, vel * (0.09 - i * 0.02), 0.03, 'highpass', 4200 + i * 900, duck);
      }
    },

    tick(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      void context;
      noiseHit(time, vel, 0.016, 'highpass', 6600, duck);
    },

    sonar(context, time, frequency, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      const sends = [];
      if (mix.delaySend) sends.push({ destination: mix.delaySend, gain: 0.7 });
      if (mix.reverbSend) sends.push({ destination: mix.reverbSend, gain: 0.5 });
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'sine',
        frequency,
        gainAutomation: [
          { type: 'set', value: 0.09 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: output,
        sends,
      });
    },

    foghorn(context, time, midi, vel, dur) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      foghornTone.play({
        context,
        time,
        frequency: midiToFreq(midi),
        vel,
        dur,
        destination: output,
        sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.7 }] : undefined,
      });
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
            { type: 'set', value: 240, time },
            { type: 'exponentialRamp', value: 5200, time: time + duration },
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

    gurgle(context, time, duration, vel) {
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
          type: 'lowpass',
          Q: 6,
          frequencyAutomation: [
            { type: 'set', value: 950, time },
            { type: 'exponentialRamp', value: 130, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.16 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
    },

    boom(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.55,
        oscillatorType: 'sine',
        frequency: 92,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 33, time: time + 0.4 }],
        gainAutomation: [
          { type: 'set', value: 0.42 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.52 },
        ],
        destination: output,
      });
      noiseHit(time, 0.16 * vel, 0.12, 'bandpass', 640, output);
    },
  }, {
    kick: ['vel'],
    subKick: ['vel'],
    bass: ['midi', 'vel', 'bright'],
    pad: ['midis', 'duration', 'airy'],
    lead: ['midi', 'dur', 'vel', 'bright'],
    anvil: ['vel'],
    chain: ['vel'],
    tick: ['vel'],
    sonar: ['frequency', 'vel'],
    foghorn: ['midi', 'vel', 'dur'],
    riser: ['duration'],
    gurgle: ['duration', 'vel'],
    boom: ['vel'],
  });

  return {
    ...instruments,
    noiseHit,
  };
}
