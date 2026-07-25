import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf file: construction only. Every timbre here is a piece of the same object —
// a hard plastic mechanism. The kit is literally the cube: `click` is a cubie
// touching its neighbour, `snap` is a layer landing on the beat (and doubles as
// the backbeat), `thud` is the mass of the whole thing settling.

export type SpeedsolveVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createSpeedsolveVoices(environment: SpeedsolveVoiceEnvironment) {
  const musicOut = () => environment.mix()?.duck ?? environment.mix()?.master ?? null;
  const busOut = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.04 });

  function noise(
    time: number,
    velocity: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    destination: AudioNode,
  ) {
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseVoice.play({
      context,
      buffer,
      time,
      velocity,
      decay,
      filterType,
      frequency,
      destination,
      loopStart: Math.random(),
      offset: Math.random() * 1.4,
    });
  }

  const thudTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.19,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 46, time: time + 0.09 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.52 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  // The snap's pitched core: a stiff square blip that reads as ABS plastic
  // seating into a detent. Brightness rises with the snap's weight.
  const snapCore = voice<{ vel: number; bright: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.055,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 3.4, cutoff: ({ bright }) => 1500 + bright * 2200 },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.5, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.03 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.2 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.055 },
    ],
  });

  const clickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.02,
    stopPadding: 0.01,
    filter: { type: 'highpass', cutoff: 2400 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.02 },
    ],
  });

  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.8 }, { type: 'sine', octave: -1, gain: 0.5 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 320 + vel * 900, time },
        { type: 'exponentialRamp', value: 190, time: time + 0.14 },
      ],
    },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.3 * gain * vel, time: time + 0.005 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const padTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 620, time },
        { type: 'linearRamp', value: 1050, time: time + duration * 0.45 },
        { type: 'linearRamp', value: 620, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0.0008, time },
      { type: 'linearRamp', value: 0.05 * level, time: time + duration * 0.35 },
      { type: 'linearRamp', value: 0.036 * level, time: time + duration * 0.8 },
      { type: 'linearRamp', value: 0.0008, time: time + duration },
    ],
  });

  // Plastic mallet: the melodic voice of the toy. Triangle body, sine octave,
  // very fast decay so runs stay articulate at 144.
  const pluckTone = voice<{ vel: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: 1 }, { type: 'sine', octave: 1, gain: 0.34 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ vel }) => 2600 + vel * 2400 },
    gainAutomation: (time, gain, { vel, decay }) => [
      { type: 'set', value: 0.16 * gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const glassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.62,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.62 },
    ],
  });

  const subTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'sine' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.1,
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.3 * level, time: time + 0.25 },
      { type: 'set', value: 0.3 * level, time: time + duration - 0.3 },
      { type: 'linearRamp', value: 0.001, time: time + duration },
    ],
  });

  const clunkTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 900, Q: 2 },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: frequency * 0.42, time: time + 0.22 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.2 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    thud(context, time, vel) {
      const mix = environment.mix();
      const output = busOut();
      if (!mix || !output) return;
      thudTone.play({ context, time, frequency: 132, vel, destination: output });
      noise(time, 0.07 * vel, 0.004, 'highpass', 1600, output);
      mix.duckAt(time, 0.5, 0.2);
    },

    /** The layer snap. Doubles as the level's snare, because it is the same event. */
    snap(context, time, midi, vel, bright) {
      const output = busOut();
      if (!output) return;
      snapCore.play({ context, time, midi, vel, bright, destination: output });
      noise(time, 0.16 * vel, 0.028, 'bandpass', 2300 + bright * 1500, output);
      noise(time + 0.011, 0.075 * vel, 0.016, 'highpass', 5200, output);
    },

    click(context, time, vel, pitch) {
      const duck = musicOut();
      if (!duck) return;
      clickTone.play({ context, time, frequency: pitch, vel, destination: duck });
      noise(time, 0.028 * vel, 0.01, 'highpass', 7600, duck);
    },

    bass(context, time, midi, vel) {
      const duck = musicOut();
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    pad(context, time, midis, duration, level) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        for (const detune of [-5, 6]) {
          padTone.play({ context, time, midi, detune, duration, level, destination: mix.duck });
        }
      }
    },

    pluck(context, time, midi, vel, decay) {
      const mix = environment.mix();
      const duck = musicOut();
      if (!duck) return;
      pluckTone.play({
        context,
        time,
        midi,
        vel,
        decay,
        destination: duck,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.28 }] : undefined,
      });
    },

    glass(context, time, midi, vel) {
      const mix = environment.mix();
      const duck = musicOut();
      if (!duck) return;
      glassTone.play({
        context,
        time,
        midi,
        vel,
        destination: duck,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.5 }] : undefined,
      });
    },

    sub(context, time, midi, duration, level) {
      const duck = musicOut();
      if (!duck) return;
      subTone.play({ context, time, midi, duration, level, destination: duck });
    },

    clunk(context, time, midi, vel) {
      const output = sfxOut();
      if (!output) return;
      clunkTone.play({ context, time, midi, vel, destination: output });
      noise(time, 0.2 * vel, 0.09, 'bandpass', 780, output);
    },

    /** A face riffling into its scramble: a fast stack of cubie clicks. */
    riffle(context, time, count, spacing) {
      const output = busOut();
      if (!output) return;
      for (let index = 0; index < count; index += 1) {
        const at = time + index * spacing;
        clickTone.play({ context, time: at, frequency: 1500 + index * 190, vel: 0.7, destination: output });
        noise(at, 0.05, 0.012, 'bandpass', 3200 + index * 320, output);
      }
    },

    /** Conquest: the face falls away and the machine rings a bright confirmation. */
    chime(context, time, midis, spacing) {
      const mix = environment.mix();
      const output = busOut();
      if (!output) return;
      midis.forEach((midi: number, index: number) => {
        const at = time + index * spacing;
        playOscillatorVoice({
          context,
          time: at,
          stopTime: at + 0.7,
          oscillatorType: 'triangle',
          frequency: midiToFreq(midi),
          filter: { type: 'lowpass', frequency: 5200 },
          gainAutomation: [
            { type: 'set', value: 0.12 - index * 0.012, time: at },
            { type: 'exponentialRamp', value: 0.001, time: at + 0.65 },
          ],
          destination: output,
          sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.55 }] : undefined,
        });
      });
    },

    riser(context, time, duration) {
      const output = busOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.12,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.5,
          frequencyAutomation: [
            { type: 'set', value: 420, time },
            { type: 'exponentialRamp', value: 7200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.11, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },
  }, {
    thud: ['vel'],
    snap: ['midi', 'vel', 'bright'],
    click: ['vel', 'pitch'],
    bass: ['midi', 'vel'],
    pad: ['midis', 'duration', 'level'],
    pluck: ['midi', 'vel', 'decay'],
    glass: ['midi', 'vel'],
    sub: ['midi', 'duration', 'level'],
    clunk: ['midi', 'vel'],
    riffle: ['count', 'spacing'],
    chime: ['midis', 'spacing'],
    riser: ['duration'],
  });

  return { ...instruments, noise, sfxOut, busOut, musicOut };
}
