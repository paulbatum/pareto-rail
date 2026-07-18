import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// The Broadside orchestra, synthesized: string sections are detuned saw
// pairs, brass is saw+square with a filter that opens like an embouchure,
// horns are triangle-bodied, timpani is a pitched sine drop that doubles as
// the fleet's guns, and the snare is the marine drumline. Everything sits in
// a shared hall reverb so it reads as one room-sized orchestra, not a synth.

export type BroadsideVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createBroadsideVoices(environment: BroadsideVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const duckDestination = () => environment.mix()?.duck ?? environment.mix()?.master ?? null;

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

  // Timpani: pitched skin drop with a felt-mallet thump. The battle's pulse
  // and, during the broadside, the guns themselves.
  const timpaniTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.34,
    stopPadding: 0.05,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.45, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.09 },
      { type: 'exponentialRamp', value: frequency * 0.94, time: time + 0.3 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  // Strings, short bow: a pair of saws a few cents apart. The ostinato engine.
  const stringShortTone = voice<{ vel: number; detune: number; cutoff: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.17,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 0.8 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.085 * vel, time: time + 0.012 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
  });

  // Strings, sustained section pad. Slow attack, wide detune, hall-bound.
  const stringPadTone = voice<{ duration: number; vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 520, time },
        { type: 'linearRamp', value: 1150, time: time + duration * 0.55 },
        { type: 'linearRamp', value: 480, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.028 * vel, time: time + Math.min(0.7, duration * 0.3) },
      { type: 'set', value: 0.028 * vel, time: time + Math.max(0.01, duration - 0.5) },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // Brass: saw body + square bark, filter opening like a crescendo through
  // the note, tiny under-pitch scoop into the attack.
  const brassTone = voice<{ duration: number; vel: number; bright: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.62 },
      { type: 'square', gain: 0.3, detune: 7 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 0.965, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.055 },
    ],
    filter: {
      type: 'lowpass',
      Q: 1.1,
      frequencyAutomation: (time, { duration, bright }) => [
        { type: 'set', value: 640, time },
        { type: 'linearRamp', value: 1500 + 1400 * bright, time: time + Math.min(0.5, duration * 0.6) },
        { type: 'linearRamp', value: 900, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.075 * vel, time: time + 0.045 },
      { type: 'set', value: 0.07 * vel, time: time + Math.max(0.05, duration - 0.14) },
      { type: 'linearRamp', value: 0.0001, time: time + duration },
    ],
  });

  // Horn: the lonely voice for the eye of the battle.
  const hornTone = voice<{ duration: number; vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.8 },
      { type: 'sine', gain: 0.5, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: 1150, Q: 0.7 },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.11 * vel, time: time + 0.09 },
      { type: 'set', value: 0.1 * vel, time: time + Math.max(0.05, duration - 0.22) },
      { type: 'linearRamp', value: 0.0001, time: time + duration },
    ],
  });

  // Basses: short low saw with a sine sub underneath.
  const bassTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.7 },
      { type: 'sine', gain: 0.85, octave: -1 },
    ],
    duration: 0.26,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 620, Q: 2.2 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.34 * vel, time: time + 0.008 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    timpani(context, time, midi, vel) {
      const mix = environment.mix();
      const output = duckDestination();
      if (!mix || !output) return;
      timpaniTone.play({ context, time, midi, vel, destination: output, sends: reverbSends(0.35) });
      noiseHit(time, 0.16 * vel, 0.05, 'lowpass', 420, output);
      mix.duckAt(time, 0.62, 0.18);
    },

    snare(_context, time, vel) {
      const output = duckDestination();
      if (!output) return;
      noiseHit(time, 0.13 * vel, 0.045, 'bandpass', 1750, output);
      noiseHit(time + 0.011, 0.09 * vel, 0.07, 'bandpass', 2700, output);
    },

    cymbal(_context, time, vel, decay) {
      const output = duckDestination();
      if (!output) return;
      noiseHit(time, 0.075 * vel, decay, 'highpass', 7400, output);
      noiseHit(time + 0.02, 0.045 * vel, decay * 1.6, 'highpass', 9200, output);
    },

    stringsShort(context, time, midi, vel, cutoff) {
      const output = duckDestination();
      if (!output) return;
      for (const detune of [-6, 6]) {
        stringShortTone.play({ context, time, midi, vel, detune, cutoff, destination: output, sends: reverbSends(0.3) });
      }
    },

    stringsPad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      for (const midi of midis) {
        for (const detune of [-8, 8]) {
          stringPadTone.play({ context, time, midi, detune, duration, vel, destination: output, sends: reverbSends(0.5) });
        }
      }
    },

    brass(context, time, midi, duration, vel, bright) {
      const output = duckDestination();
      if (!output) return;
      brassTone.play({ context, time, midi, duration, vel, bright, destination: output, sends: reverbSends(0.42) });
    },

    horn(context, time, midi, duration, vel) {
      const output = duckDestination();
      if (!output) return;
      hornTone.play({ context, time, midi, duration, vel, destination: output, sends: reverbSends(0.6) });
    },

    bassNote(context, time, midi, vel) {
      const output = duckDestination();
      if (!output) return;
      bassTone.play({ context, time, midi, vel, destination: output });
    },

    // A capital gun going off somewhere in the middle distance: deep pitched
    // boom with a pressure thud. `far` filters it down to a rumble.
    cannon(context, time, vel, far) {
      const output = duckDestination();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.65,
        oscillatorType: 'sine',
        frequency: far ? 52 : 74,
        frequencyAutomation: [{ type: 'exponentialRamp', value: far ? 27 : 31, time: time + 0.4 }],
        gainAutomation: [
          { type: 'set', value: (far ? 0.2 : 0.4) * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.62 },
        ],
        destination: output,
        sends: reverbSends(far ? 0.7 : 0.4),
      });
      noiseHit(time, (far ? 0.05 : 0.14) * vel, far ? 0.18 : 0.09, 'lowpass', far ? 240 : 500, output);
    },

    // Dry mechanical tick for the belly of the enemy ship — machinery heard
    // through the hull.
    tick(_context, time, vel) {
      const output = duckDestination();
      if (!output) return;
      noiseHit(time, 0.05 * vel, 0.018, 'bandpass', 5200, output);
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
            { type: 'set', value: 340, time },
            { type: 'exponentialRamp', value: 5800, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.11, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    // Timpani roll: a crescendo of rapid strokes, used for launch and victory.
    timpaniRoll(context, time, midi, duration, peak) {
      const output = duckDestination();
      if (!output) return;
      const strokes = Math.max(4, Math.floor(duration / 0.055));
      for (let index = 0; index < strokes; index += 1) {
        const at = time + (index / strokes) * duration;
        const vel = 0.12 + (index / strokes) * peak;
        timpaniTone.play({ context, time: at, midi, vel, destination: output, sends: index % 3 === 0 ? reverbSends(0.3) : undefined });
      }
    },
  }, {
    timpani: ['midi', 'vel'],
    snare: ['vel'],
    cymbal: ['vel', 'decay'],
    stringsShort: ['midi', 'vel', 'cutoff'],
    stringsPad: ['midis', 'duration', 'vel'],
    brass: ['midi', 'duration', 'vel', 'bright'],
    horn: ['midi', 'duration', 'vel'],
    bassNote: ['midi', 'vel'],
    cannon: ['vel', 'far'],
    tick: ['vel'],
    riser: ['duration'],
    timpaniRoll: ['midi', 'duration', 'peak'],
  });

  function reverbSends(gain: number) {
    const reverbSend = environment.mix()?.reverbSend;
    return reverbSend ? [{ destination: reverbSend, gain }] : undefined;
  }

  return {
    ...instruments,
    noiseHit,
    reverbSends,
    midiToFreq,
  };
}
