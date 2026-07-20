import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf: synth construction only. All musical decisions (what plays when, at
// which pitch, at what velocity) live in audio.ts.

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
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

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.16,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 42, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.52 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 180 + vel * 700, time },
        { type: 'exponentialRamp', value: 150, time: time + 0.18 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.3 * vel, time: time + 0.005 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  // The 303-ish acid voice: resonant lowpass with a per-note envelope; the
  // caller supplies cutoff so the line can open across the section.
  const acidTone = voice<{ vel: number; sweep: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 11,
      frequencyAutomation: (time, { sweep, vel }) => [
        { type: 'set', value: 240 + sweep * (0.4 + vel * 0.9), time },
        { type: 'exponentialRamp', value: 190, time: time + 0.15 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const padTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 380, time },
        { type: 'linearRamp', value: 820, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 380, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: level, time: time + Math.min(0.6, duration * 0.2) },
      { type: 'set', value: level, time: time + duration - 0.4 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 2500 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.15 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  // The ring tick: a tiny high sine ping so the very first crossings are
  // audible before the kick locks in.
  const tickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.05,
    stopPadding: 0.02,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.05 },
    ],
  });

  // Klaxon: a harsh bandpassed two-saw blare. The caller alternates pitches.
  const klaxonTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 1 },
      { type: 'sawtooth', gain: 0.6, detune: 11 },
    ],
    duration: 0.34,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 2.2, cutoff: 950 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.11 * vel, time: time + 0.02 },
      { type: 'set', value: 0.11 * vel, time: time + 0.26 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 145, vel, destination: output });
      noiseHit(time, 0.09 * vel, 0.004, 'highpass', 1400, output);
      // The kick's duck IS the pump.
      mix.duckAt(time, 0.4, 0.24);
    },

    ghostKick(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      kickTone.play({ context, time, frequency: 120, vel: vel * 0.45, destination: output });
    },

    clap(_context, time, vel) {
      const output = duckDestination();
      if (!output) return;
      noiseHit(time, 0.13 * vel, 0.05, 'bandpass', 1800, output);
      noiseHit(time + 0.012, 0.09 * vel, 0.07, 'bandpass', 2300, output);
    },

    hat(_context, time, vel, decay) {
      const duck = duckDestination();
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 7600, duck);
    },

    snare(_context, time, vel) {
      const duck = duckDestination();
      if (!duck) return;
      noiseHit(time, 0.16 * vel, 0.07, 'bandpass', 2100, duck);
      noiseHit(time, 0.1 * vel, 0.05, 'highpass', 4600, duck);
    },

    bass(context, time, midi, vel) {
      const duck = duckDestination();
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    acid(context, time, midi, vel, sweep) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      acidTone.play({
        context,
        time,
        midi,
        vel,
        sweep,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.22 }],
      });
    },

    pad(context, time, midis, duration, level) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const sends = mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : undefined;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          padTone.play({ context, time, midi, detune, duration, level, destination: mix.duck, sends });
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.45 }] });
    },

    ringTick(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      tickTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.3 }] });
    },

    klaxon(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const sends = mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.35 }] : undefined;
      klaxonTone.play({ context, time, midi, vel, destination: mix.duck, sends });
    },

    alarmSweep(context, time, startMidi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.05,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(startMidi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(startMidi + 12), time: time + duration }],
        filter: { type: 'bandpass', Q: 3, frequency: 1400 },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.06 * vel, time: time + duration * 0.8 },
          { type: 'linearRamp', value: 0, time: time + duration },
        ],
        destination: mix.duck,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : undefined,
      });
    },

    riser(context, time, duration, gain) {
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
            { type: 'set', value: 320, time },
            { type: 'exponentialRamp', value: 6800, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: gain, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 1.1,
        oscillatorType: 'sine',
        frequency: 130,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 32, time: time + 0.5 }],
        gainAutomation: [
          { type: 'set', value: 0.55 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 1.0 },
        ],
        destination: output,
      });
      noiseHit(time, 0.24 * vel, 0.16, 'lowpass', 900, output);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 1.5, 'highpass', 5200, output);
      noiseHit(time + 0.02, 0.1 * vel, 2.2, 'highpass', 7800, output);
    },

    // Clamp-release clank: iron ringing, pitch supplied per interlock.
    clank(context, time, frequency, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'square',
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.62, time: time + 0.22 }],
        filter: { type: 'bandpass', Q: 4, frequency: frequency * 2.6 },
        gainAutomation: [
          { type: 'set', value: 0.14 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
        ],
        destination: output,
        sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : undefined,
      });
      noiseHit(time, 0.1 * vel, 0.05, 'bandpass', 3200, output);
    },

    subPulse(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.28 * vel, time: time + 0.03 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: output,
      });
    },

    shimmer(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.7,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'highpass', frequency: 900 },
        gainAutomation: [
          { type: 'set', value: 0.07 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
        ],
        destination: mix.duck,
        sends: [
          { destination: mix.delaySend, gain: 0.7 },
          ...(mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.5 }] : []),
        ],
      });
    },
  }, {
    kick: ['vel'],
    ghostKick: ['vel'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    snare: ['vel'],
    bass: ['midi', 'vel'],
    acid: ['midi', 'vel', 'sweep'],
    pad: ['midis', 'duration', 'level'],
    arp: ['midi', 'vel'],
    ringTick: ['midi', 'vel'],
    klaxon: ['midi', 'vel'],
    alarmSweep: ['startMidi', 'duration', 'vel'],
    riser: ['duration', 'gain'],
    impact: ['vel'],
    crash: ['vel'],
    clank: ['frequency', 'vel'],
    subPulse: ['midi', 'vel'],
    shimmer: ['midi', 'vel'],
  });

  return { ...instruments, noiseHit };
}
