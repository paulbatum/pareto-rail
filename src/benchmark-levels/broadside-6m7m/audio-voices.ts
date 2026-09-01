import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// A procedural orchestra. Nothing here decides *when* to play: audio.ts owns
// the arrangement; these are the instruments it conducts. Gains are tuned by
// ear for perceived loudness — saws are far louder than sines at equal gain.

export type BroadsideVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type SoloVoice = { cutoff: number; decay: number; gain: number; bite: number };

export function createBroadsideVoices(environment: BroadsideVoiceEnvironment) {
  const music = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfx = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const reverbSends = (gain: number) => {
    const send = environment.mix()?.reverbSend;
    return send && gain > 0 ? [{ destination: send, gain }] : undefined;
  };
  const delaySends = (gain: number) => {
    const send = environment.mix()?.delaySend;
    return send && gain > 0 ? [{ destination: send, gain }] : undefined;
  };

  const noiseSpec = noiseHitSpec({ filterType: 'bandpass', frequency: 1000, velocity: 1, decay: 0.05 });
  function noise(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseSpec.play({ context, buffer, time, velocity: vel, decay, filterType, frequency, destination, loopStart: Math.random(), offset: Math.random() * 1.5 });
  }

  // ---- percussion -------------------------------------------------------------

  const timpaniTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.22, frequencyRatio: 1.5 }],
    duration: 0.95,
    stopPadding: 0.05,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.45, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.06 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.95 },
    ],
  });

  const snareTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.07,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 120, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.2 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
    ],
  });

  // ---- brass -------------------------------------------------------------------

  const hornTone = voice<{ dur: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -6 },
      { type: 'sawtooth', gain: 0.5, detune: 6 },
      { type: 'square', gain: 0.16, octave: -1 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      Q: 0.9,
      frequencyAutomation: (time, { dur }) => [
        { type: 'set', value: 420, time },
        { type: 'linearRamp', value: 1500, time: time + 0.09 },
        { type: 'linearRamp', value: 880, time: time + Math.max(0.2, dur) },
      ],
    },
    envelope: { attack: 0.045, decay: 0.22, sustain: 0.72, release: 0.14, releaseCurve: 'linear' },
  });

  const trumpetTone = voice<{ dur: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5 },
      { type: 'sawtooth', gain: 0.32, detune: 9 },
      { type: 'square', gain: 0.08, octave: 1 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      Q: 1.1,
      frequencyAutomation: (time, { dur }) => [
        { type: 'set', value: 900, time },
        { type: 'linearRamp', value: 3200, time: time + 0.05 },
        { type: 'linearRamp', value: 2200, time: time + Math.max(0.15, dur) },
      ],
    },
    envelope: { attack: 0.028, decay: 0.16, sustain: 0.7, release: 0.09, releaseCurve: 'linear' },
  });

  // ---- strings ---------------------------------------------------------------------

  const stringTone = voice<{ dur: number; attack: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.3, detune: -9 },
      { type: 'sawtooth', gain: 0.3, detune: 9 },
      { type: 'triangle', gain: 0.32 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.1,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 0.7 },
    envelope: { attack: ({ attack }) => attack, decay: 0.3, sustain: 0.85, release: 0.4, releaseCurve: 'linear' },
  });

  const tremoloTone = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.55 }, { type: 'triangle', gain: 0.25, detune: 7 }],
    duration: 0.13,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 2100 },
    envelope: { attack: 0.012, decay: 0.12 },
  });

  const choirTone = voice<{ dur: number }>({
    oscillators: [{ type: 'sine', gain: 0.6 }, { type: 'triangle', gain: 0.28, detune: -5 }, { type: 'sine', gain: 0.14, octave: 1 }],
    duration: ({ dur }) => dur,
    stopPadding: 0.2,
    filter: { type: 'bandpass', frequency: 900, Q: 0.8 },
    envelope: { attack: 0.55, decay: 0.4, sustain: 0.8, release: 0.7, releaseCurve: 'linear' },
  });

  const harpTone = voice({
    oscillators: [{ type: 'triangle', gain: 0.6 }, { type: 'sine', gain: 0.25, octave: 1 }],
    duration: 0.65,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 3400 },
    envelope: { decay: 0.65 },
  });

  const subTone = voice<{ dur: number }>({
    oscillators: [{ type: 'sine' }],
    duration: ({ dur }) => dur,
    stopPadding: 0.3,
    envelope: { attack: 0.35, decay: 0.5, sustain: 1, release: 0.6, releaseCurve: 'linear' },
  });

  // ---- the player's instruments ----------------------------------------------------

  const pizzicatoTone = voice<{ lockCount: number }>({
    oscillators: [{ type: 'triangle', gain: 0.62 }, { type: 'sine', gain: 0.3, octave: 1 }],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ lockCount }) => 2400 + lockCount * 180 },
    envelope: { decay: 0.11 },
  });

  const stabTone = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.5, detune: -5 }, { type: 'sawtooth', gain: 0.5, detune: 5 }],
    duration: 0.19,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time) => [
        { type: 'set', value: 2600, time },
        { type: 'exponentialRamp', value: 900, time: time + 0.18 },
      ],
    },
    envelope: { attack: 0.006, decay: 0.19 },
  });

  const soloTone = voice<{ solo: SoloVoice }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5 },
      { type: 'sawtooth', gain: 0.3, detune: 7 },
      { type: 'square', gain: ({ solo }) => solo.bite, octave: 1 },
    ],
    duration: ({ solo }) => solo.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ solo }) => solo.cutoff, Q: 1.2 },
    frequencyAutomation: (time, frequency, { solo }) => [
      { type: 'set', value: frequency * 0.985, time },
      { type: 'linearRamp', value: frequency, time: time + 0.03 },
      { type: 'linearRamp', value: frequency * 1.004, time: time + solo.decay * 0.3 },
      { type: 'linearRamp', value: frequency * 0.996, time: time + solo.decay * 0.55 },
      { type: 'linearRamp', value: frequency * 1.003, time: time + solo.decay * 0.8 },
      { type: 'linearRamp', value: frequency, time: time + solo.decay },
    ],
    envelope: { attack: 0.014, decay: ({ solo }) => solo.decay * 0.35, sustain: 0.6, release: ({ solo }) => solo.decay * 0.45, releaseCurve: 'linear' },
  });

  const chipTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.5 }, { type: 'square', gain: 0.3, frequencyRatio: 2.76 }],
    duration: 0.14,
    stopPadding: 0.02,
    filter: { type: 'bandpass', frequency: 2400, Q: 2.6 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const blatTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.6 }, { type: 'square', gain: 0.2, octave: -1 }],
    duration: 0.28,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 560, Q: 4 },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: frequency * 0.68, time: time + 0.22 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });

  const slideTone = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.5 }],
    duration: 0.22,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 620 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.62, time: time + 0.2 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.06, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    timpani(context, time, midi, vel) {
      const mix = environment.mix();
      const output = music();
      if (!mix || !output) return;
      timpaniTone.play({ context, time, midi, vel, destination: output, sends: reverbSends(0.35) });
      noise(time, 0.16 * vel, 0.05, 'lowpass', 320, output);
      if (vel >= 0.8) mix.duckAt(time, 0.72, 0.2);
    },
    snare(_context, time, vel, tight) {
      const output = music();
      if (!output) return;
      noise(time, 0.24 * vel, tight ? 0.06 : 0.12, 'bandpass', 1900, output);
      noise(time + 0.004, 0.1 * vel, 0.16, 'highpass', 4200, output);
      const context = environment.context();
      if (context) snareTone.play({ context, time, frequency: 205, vel, destination: output });
    },
    crash(_context, time, vel) {
      const output = music();
      if (!output) return;
      noise(time, 0.28 * vel, 1.4, 'highpass', 5200, output);
      noise(time, 0.14 * vel, 0.7, 'bandpass', 3100, output);
    },
    boom(context, time, vel) {
      const output = music();
      if (!output) return;
      noise(time, 0.32 * vel, 0.6, 'lowpass', 240, output);
      timpaniTone.play({ context, time, frequency: 46, vel: vel * 0.5, destination: output, sends: reverbSends(0.5) });
    },
    horns(context, time, midis, vel, dur) {
      const output = music();
      if (!output) return;
      for (const midi of midis) hornTone.play({ context, time, midi, dur, gain: 0.11 * vel, destination: output, sends: reverbSends(0.3) });
    },
    trumpets(context, time, midi, vel, dur) {
      const output = music();
      if (!output) return;
      trumpetTone.play({ context, time, midi, dur, gain: 0.085 * vel, destination: output, sends: reverbSends(0.32) });
    },
    strings(context, time, midis, vel, dur, attack = 0.25, cutoff = 1700) {
      const output = music();
      if (!output) return;
      for (const midi of midis) stringTone.play({ context, time, midi, dur, attack, cutoff, gain: 0.05 * vel, destination: output, sends: reverbSends(0.45) });
    },
    tremolo(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      tremoloTone.play({ context, time, midi, gain: 0.07 * vel, destination: duck });
    },
    choir(context, time, midis, vel, dur) {
      const output = music();
      if (!output) return;
      for (const midi of midis) choirTone.play({ context, time, midi, dur, gain: 0.07 * vel, destination: output, sends: reverbSends(0.6) });
    },
    harp(context, time, midi, vel) {
      const output = music();
      if (!output) return;
      harpTone.play({ context, time, midi, gain: 0.12 * vel, destination: output, sends: delaySends(0.4) });
    },
    sub(context, time, midi, vel, dur) {
      const output = music();
      if (!output) return;
      subTone.play({ context, time, midi, dur, gain: 0.3 * vel, destination: output });
    },
    riser(context, time, duration, peak = 0.12) {
      const output = music();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.1,
          frequencyAutomation: [
            { type: 'set', value: 260, time },
            { type: 'exponentialRamp', value: 5200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: peak, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    pizzicato(context, time, midi, lockCount, vel) {
      const output = sfx();
      if (!output) return;
      pizzicatoTone.play({ context, time, midi, lockCount, gain: 0.16 * vel, destination: output, sends: delaySends(0.3) });
    },
    stab(context, time, midi, vel) {
      const output = sfx();
      if (!output) return;
      stabTone.play({ context, time, midi, gain: 0.07 * vel, destination: output });
      noise(time, 0.05 * vel, 0.03, 'highpass', 3000, output);
    },
    solo(context, time, midi, solo, vel, weight = 1) {
      const output = sfx();
      if (!output) return;
      soloTone.play({ context, time, midi, solo, gain: solo.gain * vel, weight, destination: output, sends: reverbSends(0.4) });
    },
    chip(context, time, midi, vel) {
      const output = sfx();
      if (!output) return;
      chipTone.play({ context, time, midi, vel, destination: output, sends: delaySends(0.25) });
      noise(time, 0.04, 0.03, 'highpass', 5000, output);
    },
    blat(context, time, midi, vel) {
      const output = sfx();
      if (!output) return;
      blatTone.play({ context, time, midi, vel, destination: output });
      noise(time, 0.12, 0.09, 'bandpass', 700, output);
    },
    slide(context, time, frequency) {
      const output = sfx();
      if (!output) return;
      slideTone.play({ context, time, frequency, destination: output });
    },
    deflect(_context, time, vel) {
      const output = sfx();
      if (!output) return;
      noise(time, 0.2 * vel, 0.14, 'bandpass', 1500, output);
      noise(time, 0.1 * vel, 0.3, 'lowpass', 380, output);
      const context = environment.context();
      if (context) chipTone.play({ context, time, frequency: 310, vel: 0.08 * vel, destination: output });
    },
    hull(context, time) {
      const output = sfx();
      if (!output) return;
      timpaniTone.play({ context, time, frequency: 52, vel: 1.1, destination: output });
      for (const midi of [63, 69]) stabTone.play({ context, time, midi, gain: 0.06, destination: output });
      noise(time, 0.24, 0.16, 'bandpass', 800, output);
    },
  }, {
    timpani: ['midi', 'vel'],
    snare: ['vel', 'tight'],
    crash: ['vel'],
    boom: ['vel'],
    horns: ['midis', 'vel', 'dur'],
    trumpets: ['midi', 'vel', 'dur'],
    strings: ['midis', 'vel', 'dur', 'attack', 'cutoff'],
    tremolo: ['midi', 'vel'],
    choir: ['midis', 'vel', 'dur'],
    harp: ['midi', 'vel'],
    sub: ['midi', 'vel', 'dur'],
    riser: ['duration', 'peak'],
    pizzicato: ['midi', 'lockCount', 'vel'],
    stab: ['midi', 'vel'],
    solo: ['midi', 'solo', 'vel', 'weight'],
    chip: ['midi', 'vel'],
    blat: ['midi', 'vel'],
    slide: ['frequency'],
    deflect: ['vel'],
    hull: [],
  });

  return { ...instruments, noise };
}
