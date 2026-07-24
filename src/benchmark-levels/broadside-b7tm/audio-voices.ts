import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// The BROADSIDE orchestra, synthesised from scratch.
//
// Strings are detuned saw pairs with a slow bow and a lowpass that opens with
// velocity. Brass is a saw stack whose filter blats open on the attack and
// whose pitch scoops up into the note — that scoop is most of what makes a
// synthesised horn read as brass. Timpani is a pitched sine with a hard
// downward bend plus a skin transient. Everything is fed from a shared plate
// reverb so the battle has a hall around it, because space opera is recorded
// in a hall, not in a vacuum.

export type PlayerVoiceSpec = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  air: number;
  reverb: number;
};

export type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createBroadsideVoices(environment: VoiceEnvironment) {
  const musicOut = () => environment.mix()?.duck ?? environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const sends = (delayGain: number, reverbGain: number) => {
    const mix = environment.mix();
    if (!mix) return undefined;
    const list: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix.delaySend && delayGain > 0) list.push({ destination: mix.delaySend, gain: delayGain });
    if (mix.reverbSend && reverbGain > 0) list.push({ destination: mix.reverbSend, gain: reverbGain });
    return list.length > 0 ? list : undefined;
  };

  const noiseVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1200, velocity: 1, decay: 0.06 });

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
      offset: Math.random() * 1.6,
    });
  }

  // ---- primitive specs ------------------------------------------------------

  const stringVoice = voice<{ vel: number; cutoff: number; attack: number; length: number; detune: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: ({ detune }) => detune },
      { type: 'sawtooth', gain: 0.5, detune: ({ detune }) => -detune },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      Q: 0.9,
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff, attack, length }) => [
        { type: 'set', value: Math.max(220, cutoff * 0.45), time },
        { type: 'linearRamp', value: cutoff, time: time + attack + 0.05 },
        { type: 'linearRamp', value: Math.max(220, cutoff * 0.7), time: time + length },
      ],
    },
    gainAutomation: (time, _gain, { vel, attack, length }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.035 * vel, time: time + attack },
      { type: 'set', value: 0.035 * vel, time: time + Math.max(attack, length - 0.22) },
      { type: 'exponentialRamp', value: 0.0001, time: time + length },
    ],
  });

  const brassVoice = voice<{ vel: number; cutoff: number; length: number; weightGain: number; scoop: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.55, detune: 6 },
      { type: 'sawtooth', gain: 0.42, detune: -9 },
      { type: 'square', gain: 0.16, octave: -1 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.07,
    // The blat: filter snaps open in 40 ms, then settles back.
    filter: {
      type: 'lowpass',
      Q: 1.4,
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff, length }) => [
        { type: 'set', value: Math.max(260, cutoff * 0.22), time },
        { type: 'linearRamp', value: cutoff, time: time + 0.045 },
        { type: 'exponentialRamp', value: Math.max(260, cutoff * 0.5), time: time + length },
      ],
    },
    frequencyAutomation: (time, frequency, { scoop }) => (scoop <= 0 ? undefined : [
      { type: 'set', value: frequency * (1 - scoop), time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.05 },
    ]),
    gainAutomation: (time, _gain, { vel, length, weightGain }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.05 * vel * weightGain, time: time + 0.03 },
      { type: 'linearRamp', value: 0.038 * vel * weightGain, time: time + Math.min(0.2, length * 0.4) },
      { type: 'set', value: 0.036 * vel * weightGain, time: time + Math.max(0.06, length - 0.16) },
      { type: 'exponentialRamp', value: 0.0001, time: time + length },
    ],
  });

  const spiccatoVoice = voice<{ vel: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.6, detune: 5 },
      { type: 'sawtooth', gain: 0.5, detune: -5 },
    ],
    duration: 0.13,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'exponentialRamp', value: Math.max(300, cutoff * 0.35), time: time + 0.12 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.055 * vel, time },
      { type: 'exponentialRamp', value: 0.0001, time: time + 0.13 },
    ],
  });

  const timpaniVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 0.9 }, { type: 'triangle', gain: 0.18, octave: 1 }],
    duration: 0.65,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.5, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.06 },
      { type: 'exponentialRamp', value: frequency * 0.86, time: time + 0.6 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.42 * vel, time },
      { type: 'exponentialRamp', value: 0.0001, time: time + 0.6 },
    ],
  });

  const hornVoice = voice<{ vel: number; length: number; cutoff: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.7 },
      { type: 'sawtooth', gain: 0.3, detune: 7 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      Q: 0.8,
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff, length }) => [
        { type: 'set', value: Math.max(240, cutoff * 0.3), time },
        { type: 'linearRamp', value: cutoff, time: time + 0.06 },
        { type: 'exponentialRamp', value: Math.max(240, cutoff * 0.55), time: time + length },
      ],
    },
    gainAutomation: (time, _gain, { vel, length }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.06 * vel, time: time + 0.035 },
      { type: 'exponentialRamp', value: 0.0001, time: time + length },
    ],
  });

  const subVoice = voice<{ vel: number; length: number }>({
    oscillators: [{ type: 'sine', gain: 1 }],
    duration: ({ length }) => length,
    stopPadding: 0.06,
    gainAutomation: (time, _gain, { vel, length }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.32 * vel, time: time + 0.03 },
      { type: 'exponentialRamp', value: 0.0001, time: time + length },
    ],
  });

  const harpVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.8 }, { type: 'sine', gain: 0.3, octave: 1 }],
    duration: 0.5,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 4200 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.075 * vel, time },
      { type: 'exponentialRamp', value: 0.0001, time: time + 0.5 },
    ],
  });

  const bellVoice = voice<{ vel: number; length: number }>({
    oscillators: [
      { type: 'sine', gain: 0.7 },
      { type: 'sine', gain: 0.16, frequencyRatio: 2.76 },
      { type: 'sine', gain: 0.08, frequencyRatio: 5.4 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.06,
    gainAutomation: (time, _gain, { vel, length }) => [
      { type: 'set', value: 0.08 * vel, time },
      { type: 'exponentialRamp', value: 0.0001, time: time + length },
    ],
  });

  const choirVoice = voice<{ vel: number; length: number }>({
    oscillators: [
      { type: 'sine', gain: 0.6, detune: 4 },
      { type: 'sine', gain: 0.45, detune: -6 },
      { type: 'triangle', gain: 0.12, octave: 1 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.1,
    filter: { type: 'lowpass', cutoff: 1500 },
    gainAutomation: (time, _gain, { vel, length }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.03 * vel, time: time + length * 0.35 },
      { type: 'exponentialRamp', value: 0.0001, time: time + length },
    ],
  });

  const playerVoiceSpec = voice<{ vel: number; spec: PlayerVoiceSpec; weightGain: number }>({
    oscillators: [
      { type: ({ spec }) => spec.oscillator, gain: ({ spec }) => spec.gain },
      { type: 'sine', gain: ({ spec }) => spec.gain * 0.4, octave: 1 },
    ],
    duration: ({ spec }) => spec.decay,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      cutoff: ({ spec }) => spec.cutoff,
      frequencyAutomation: (time, { spec }) => [
        { type: 'set', value: spec.cutoff, time },
        { type: 'exponentialRamp', value: Math.max(320, spec.cutoff * 0.35), time: time + spec.decay },
      ],
    },
    gainAutomation: (time, gain, { vel, spec, weightGain }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain * vel * weightGain, time: time + 0.006 },
      { type: 'exponentialRamp', value: 0.0001, time: time + spec.decay },
    ],
  });

  const riserVoice = voice<{ vel: number; length: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.5 }, { type: 'sawtooth', gain: 0.4, detune: 12 }],
    duration: ({ length }) => length,
    stopPadding: 0.08,
    filter: {
      type: 'bandpass',
      Q: 4,
      cutoff: 400,
      frequencyAutomation: (time, { length }) => [
        { type: 'set', value: 320, time },
        { type: 'exponentialRamp', value: 3800, time: time + length },
      ],
    },
    frequencyAutomation: (time, frequency, { length }) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: frequency * 2.4, time: time + length },
    ],
    gainAutomation: (time, _gain, { vel, length }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.05 * vel, time: time + length * 0.85 },
      { type: 'exponentialRamp', value: 0.0001, time: time + length },
    ],
  });

  // ---- instrument registry --------------------------------------------------

  return defineInstruments(environment, {
    /** Bowed string section. `midis` is a whole chord voiced as written. */
    strings(context: AudioContext, time: number, midis: number[], length: number, vel: number, cutoff: number, attack = 0.16) {
      const out = musicOut();
      if (!out) return;
      for (const midi of midis) {
        stringVoice.play({
          context,
          time,
          midi,
          vel,
          cutoff,
          attack,
          length,
          detune: 7,
          destination: out,
          sends: sends(0, 0.34),
        });
      }
    },

    /** Short bowed attack — the ostinato engine of the whole score. */
    spiccato(context: AudioContext, time: number, midi: number, vel: number, cutoff = 2600) {
      const out = musicOut();
      if (out) spiccatoVoice.play({ context, time, midi, vel, cutoff, destination: out, sends: sends(0, 0.16) });
    },

    /** Brass section. Scoop is a fraction of a semitone of pitch rise on entry. */
    brass(context: AudioContext, time: number, midis: number[], length: number, vel: number, cutoff = 2600, scoop = 0.03) {
      const out = musicOut();
      if (!out) return;
      const weightGain = 1 / Math.max(1, Math.sqrt(midis.length));
      for (const midi of midis) {
        brassVoice.play({ context, time, midi, vel, cutoff, length, weightGain, scoop, destination: out, sends: sends(0.1, 0.3) });
      }
    },

    /** Solo horn line — the melodic voice the player's kills borrow. */
    horn(context: AudioContext, time: number, midi: number, length: number, vel: number, cutoff = 2000) {
      const out = musicOut();
      if (out) hornVoice.play({ context, time, midi, length, vel, cutoff, destination: out, sends: sends(0.12, 0.36) });
    },

    /** Trombones and tuba, an octave down and wide. */
    lowBrass(context: AudioContext, time: number, midi: number, length: number, vel: number) {
      const out = musicOut();
      if (!out) return;
      brassVoice.play({ context, time, midi, vel, cutoff: 1200, length, weightGain: 1.15, scoop: 0.05, destination: out, sends: sends(0, 0.3) });
      subVoice.play({ context, time, midi: midi - 12, vel: vel * 0.45, length, destination: out });
    },

    /** Tuned kettle drum. */
    timpani(context: AudioContext, time: number, midi: number, vel: number) {
      const out = musicOut();
      if (!out) return;
      timpaniVoice.play({ context, time, midi, vel, destination: out, sends: sends(0, 0.22) });
      noise(time, 0.05 * vel, 0.05, 'lowpass', 240, out);
    },

    /** Bass drum: no pitch, all weight. */
    granCassa(context: AudioContext, time: number, vel: number) {
      const out = musicOut();
      if (!out) return;
      subVoice.play({
        context,
        time,
        frequency: 62,
        vel: vel * 1.25,
        length: 0.4,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 34, time: time + 0.16 }],
        destination: out,
      });
      noise(time, 0.07 * vel, 0.08, 'lowpass', 180, out);
    },

    /** Field drum. Rolls are just a lot of these. */
    snare(context: AudioContext, time: number, vel: number) {
      const out = musicOut();
      if (!out) return;
      noise(time, 0.075 * vel, 0.075, 'bandpass', 1900, out);
      noise(time, 0.035 * vel, 0.03, 'highpass', 3800, out);
      subVoice.play({ context, time, frequency: 190, vel: vel * 0.16, length: 0.06, destination: out });
    },

    crash(context: AudioContext, time: number, vel: number, decay = 1.6) {
      const out = musicOut();
      if (out) noise(time, 0.06 * vel, decay, 'highpass', 4600, out);
      void context;
    },

    /** Tam-tam: the enormous, slow, dark one. */
    tamTam(context: AudioContext, time: number, vel: number) {
      const out = musicOut();
      if (!out) return;
      noise(time, 0.055 * vel, 2.6, 'bandpass', 900, out);
      subVoice.play({ context, time, frequency: 48, vel: vel * 0.5, length: 1.8, destination: out });
    },

    /** Cymbal swell: a filtered noise crescendo into a downbeat. */
    swell(context: AudioContext, time: number, length: number, vel: number) {
      const out = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + length + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.2,
          frequency: 900,
          frequencyAutomation: [
            { type: 'set', value: 700, time },
            { type: 'exponentialRamp', value: 5200, time: time + length },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'exponentialRamp', value: 0.05 * vel, time: time + length * 0.92 },
          { type: 'exponentialRamp', value: 0.0001, time: time + length + 0.08 },
        ],
        destination: out,
      });
    },

    harp(context: AudioContext, time: number, midi: number, vel: number) {
      const out = musicOut();
      if (out) harpVoice.play({ context, time, midi, vel, destination: out, sends: sends(0.14, 0.4) });
    },

    bell(context: AudioContext, time: number, midi: number, vel: number, length = 1.4) {
      const out = musicOut();
      if (out) bellVoice.play({ context, time, midi, vel, length, destination: out, sends: sends(0.2, 0.5) });
    },

    choir(context: AudioContext, time: number, midis: number[], length: number, vel: number) {
      const out = musicOut();
      if (!out) return;
      for (const midi of midis) choirVoice.play({ context, time, midi, vel, length, destination: out, sends: sends(0, 0.55) });
    },

    riser(context: AudioContext, time: number, length: number, vel: number, midi = 40) {
      const out = musicOut();
      if (out) riserVoice.play({ context, time, midi, vel, length, destination: out, sends: sends(0, 0.3) });
    },

    /** Ship-scale impact: a hull-sized transient for entrances and kills. */
    impact(context: AudioContext, time: number, vel: number) {
      const out = sfxOut();
      if (!out) return;
      subVoice.play({
        context,
        time,
        frequency: 130,
        vel: vel * 1.3,
        length: 0.9,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 26, time: time + 0.5 }],
        destination: out,
      });
      noise(time, 0.09 * vel, 0.5, 'lowpass', 950, out);
      noise(time, 0.05 * vel, 1.1, 'bandpass', 320, out);
    },

    /** The player's own instrument, retuned per act by the score. */
    playerTone(context: AudioContext, time: number, midi: number, spec: PlayerVoiceSpec, vel: number, weight: number) {
      const out = sfxOut();
      if (!out) return;
      playerVoiceSpec.play({
        context,
        time,
        midi,
        vel,
        spec,
        weightGain: weight,
        destination: out,
        sends: sends(0.12, spec.reverb),
      });
    },

    playerNoise(context: AudioContext, time: number, vel: number, decay: number, frequency: number) {
      const out = sfxOut();
      if (out) noise(time, vel, decay, 'highpass', frequency, out);
      void context;
    },

    /** Free-form noise hit for shears, blocks and rejections. */
    noiseHit(context: AudioContext, time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number) {
      const out = sfxOut();
      if (out) noise(time, vel, decay, filterType, frequency, out);
      void context;
    },
  }, {
    strings: ['midis', 'length', 'vel', 'cutoff', 'attack'],
    spiccato: ['midi', 'vel', 'cutoff'],
    brass: ['midis', 'length', 'vel', 'cutoff', 'scoop'],
    horn: ['midi', 'length', 'vel', 'cutoff'],
    lowBrass: ['midi', 'length', 'vel'],
    timpani: ['midi', 'vel'],
    granCassa: ['vel'],
    snare: ['vel'],
    crash: ['vel', 'decay'],
    tamTam: ['vel'],
    swell: ['length', 'vel'],
    harp: ['midi', 'vel'],
    bell: ['midi', 'vel', 'length'],
    choir: ['midis', 'length', 'vel'],
    riser: ['length', 'vel', 'midi'],
    impact: ['vel'],
    playerTone: ['midi', 'spec', 'vel', 'weight'],
    playerNoise: ['vel', 'decay', 'frequency'],
    noiseHit: ['vel', 'decay', 'filterType', 'frequency'],
  });
}

export { midiToFreq };
