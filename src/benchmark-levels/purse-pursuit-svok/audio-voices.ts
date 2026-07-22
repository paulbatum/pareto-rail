import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

/**
 * Voice construction for the chase soundtrack. No arrangement, no harmony and
 * no section logic lives here — those are decisions and they belong in
 * `audio.ts`. This file only knows how to make each timbre.
 *
 * The palette is deliberately glossy pop: a short round kick with a hard
 * sidechain pump behind it, a layered clap, a plucked super-saw bass, wide
 * detuned pads, a bright bell pluck, and a stacked saw lead for the hook. The
 * one non-pop element is the engine drone, which is the car.
 */
export type PurseVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type PurseKillVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  shimmer: number;
  octave: number;
};

export type PurseLockVoice = { oscillator: OscillatorType; cutoff: number; gain: number };

export function createPurseVoices(environment: PurseVoiceEnvironment) {
  const music = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const duck = () => environment.mix()?.duck ?? music();

  const noiseSpec = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(
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
    noiseSpec.play({
      context,
      buffer,
      time,
      velocity,
      decay,
      filterType,
      frequency,
      destination,
      loopStart: Math.random(),
      offset: Math.random() * 1.5,
    });
  }

  const kickBody = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.2,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [
      { type: 'exponentialRamp', value: 92, time: time + 0.028 },
      { type: 'exponentialRamp', value: 41, time: time + 0.15 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const snareTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.11,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 130, time: time + 0.08 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  // Plucked super-saw bass: three detuned saws through a snapping filter.
  const bassTone = voice<{ vel: number; bright: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.34 },
      { type: 'sawtooth', gain: 0.24, detune: -11 },
      { type: 'square', gain: 0.16, octave: 1 },
    ],
    duration: 0.26,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 7,
      frequencyAutomation: (time, { vel, bright }) => [
        { type: 'set', value: 260 + vel * 900 * bright, time },
        { type: 'exponentialRamp', value: 150, time: time + 0.22 },
      ],
    },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: gain * 0.9 * vel, time: time + 0.007 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  const padTone = voice<{ duration: number; bright: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5 },
      { type: 'sawtooth', gain: 0.5, detune: 9 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      Q: 0.9,
      frequencyAutomation: (time, { duration, bright }) => [
        { type: 'set', value: 520 * bright, time },
        { type: 'linearRamp', value: 1500 * bright, time: time + duration * 0.45 },
        { type: 'linearRamp', value: 620 * bright, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.036, time: time + 0.35 },
      { type: 'set', value: 0.036, time: time + Math.max(0.4, duration - 0.5) },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const pluckTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.7 },
      { type: 'square', gain: 0.12, octave: 1 },
    ],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 3600 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.14 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // The hook lead: three saws a hair apart, the classic glossy pop stack.
  const leadTone = voice<{ vel: number; length: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.4 },
      { type: 'sawtooth', gain: 0.34, detune: 12 },
      { type: 'sawtooth', gain: 0.34, detune: -13 },
      { type: 'square', gain: 0.1, octave: 1 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      Q: 2.2,
      frequencyAutomation: (time, { vel, length }) => [
        { type: 'set', value: 1200 + vel * 3200, time },
        { type: 'exponentialRamp', value: 1500, time: time + length },
      ],
    },
    gainAutomation: (time, _gain, { vel, length }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.115 * vel, time: time + 0.012 },
      { type: 'set', value: 0.1 * vel, time: time + Math.max(0.05, length - 0.09) },
      { type: 'exponentialRamp', value: 0.001, time: time + length },
    ],
  });

  // The car. A detuned saw pair under everything, with a slow vibrato that
  // reads as revs rather than as a synth pad.
  const engineTone = voice<{ duration: number; rev: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5 },
      { type: 'sawtooth', gain: 0.45, detune: 17 },
      { type: 'square', gain: 0.2, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      Q: 3.4,
      frequencyAutomation: (time, { duration, rev }) => [
        { type: 'set', value: 190 + rev * 240, time },
        { type: 'linearRamp', value: 240 + rev * 420, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 190 + rev * 250, time: time + duration },
      ],
    },
    frequencyAutomation: (time, frequency, { duration }) => [
      { type: 'set', value: frequency, time },
      { type: 'linearRamp', value: frequency * 1.02, time: time + duration * 0.5 },
      { type: 'linearRamp', value: frequency, time: time + duration },
    ],
    gainAutomation: (time, _gain, { duration, rev }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.03 + rev * 0.026, time: time + 0.18 },
      { type: 'set', value: 0.03 + rev * 0.026, time: time + Math.max(0.3, duration - 0.25) },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const stabTone = voice<{ vel: number; length: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.45 },
      { type: 'sawtooth', gain: 0.4, detune: -14 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 2600, Q: 1.4 },
    gainAutomation: (time, _gain, { vel, length }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + length },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = music();
      if (!mix || !output) return;
      kickBody.play({ context, time, frequency: 210, vel, destination: output });
      noiseHit(time, 0.09 * vel, 0.006, 'highpass', 2400, output);
      // The pump. This is most of why the track sounds like pop.
      mix.duckAt(time, 0.4, 0.28);
    },

    clap(_context, time, vel) {
      const output = music();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 0.012, 'bandpass', 1500, output);
      noiseHit(time + 0.011, 0.16 * vel, 0.02, 'bandpass', 2000, output);
      noiseHit(time + 0.023, 0.22 * vel, 0.09, 'bandpass', 2400, output);
    },

    snare(context, time, vel) {
      const output = music();
      if (!output) return;
      snareTone.play({ context, time, frequency: 210, vel, destination: output });
      noiseHit(time, 0.19 * vel, 0.075, 'highpass', 1900, output);
    },

    hat(_context, time, vel, decay) {
      const output = duck();
      if (!output) return;
      noiseHit(time, vel, decay, 'highpass', 8200, output);
    },

    bass(context, time, midi, vel, bright) {
      const output = duck();
      if (!output) return;
      bassTone.play({ context, time, midi, vel, bright, destination: output });
    },

    pad(context, time, midis, duration, bright) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const destinations = mix.delaySend ? [mix.duck, mix.delaySend] : [mix.duck];
      for (const midi of midis as number[]) {
        padTone.play({ context, time, midi, duration, bright, destination: destinations });
      }
    },

    pluck(context, time, midi, vel) {
      const mix = environment.mix();
      const output = duck();
      if (!output) return;
      pluckTone.play({
        context,
        time,
        midi,
        vel,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.42 }] : undefined,
      });
    },

    lead(context, time, midi, vel, length) {
      const mix = environment.mix();
      const output = duck();
      if (!output) return;
      leadTone.play({
        context,
        time,
        midi,
        vel,
        length,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : undefined,
      });
    },

    stab(context, time, midis, vel, length) {
      const output = duck();
      if (!output) return;
      for (const midi of midis as number[]) {
        stabTone.play({ context, time, midi, vel, length, destination: output });
      }
    },

    engine(context, time, midi, duration, rev) {
      const output = music();
      if (!output) return;
      engineTone.play({ context, time, midi, duration, rev, destination: output });
    },

    riser(context, time, duration, peak) {
      const output = music();
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
          Q: 1.4,
          frequencyAutomation: [
            { type: 'set', value: 340, time },
            { type: 'exponentialRamp', value: 7200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: peak, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    crash(_context, time, vel) {
      const mix = environment.mix();
      const output = music();
      if (!output) return;
      noiseHit(time, 0.16 * vel, 0.9, 'highpass', 5200, output);
      noiseHit(time, 0.1 * vel, 1.6, 'bandpass', 3200, mix?.delaySend ?? output);
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    snare: ['vel'],
    hat: ['vel', 'decay'],
    bass: ['midi', 'vel', 'bright'],
    pad: ['midis', 'duration', 'bright'],
    pluck: ['midi', 'vel'],
    lead: ['midi', 'vel', 'length'],
    stab: ['midis', 'vel', 'length'],
    engine: ['midi', 'duration', 'rev'],
    riser: ['duration', 'peak'],
    crash: ['vel'],
  });

  return { ...instruments, noiseHit };
}
