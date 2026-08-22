import { midiToFreq } from '../../engine/music';
import {
  defineInstruments,
  playNoiseHit,
  playOscillatorVoice,
  type InstrumentEnvironment,
  type InstrumentRegistry,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';

// Broadside's orchestra, synthesized: pitched timpani and field-snare
// percussion, detuned-saw string pads, filtered-saw horn swells, and the
// player's own concert-bell voices. Every instrument routes into the level
// mix bus so the compressor and reverb send hear the whole ensemble.

export type BroadsideVoices = InstrumentRegistry<{
  timpani(context: AudioContext, time: number, velocity: number, rootMidi: number): void;
  snare(context: AudioContext, time: number, velocity: number): void;
  tick(context: AudioContext, time: number, velocity: number, frequency: number): void;
  cymbal(context: AudioContext, time: number, velocity: number): void;
  cannon(context: AudioContext, time: number, velocity: number): void;
  heartbeat(context: AudioContext, time: number, velocity: number): void;
  horn(context: AudioContext, time: number, midi: number, velocity: number, duration: number, bright: number): void;
  padNote(context: AudioContext, time: number, midi: number, velocity: number, duration: number): void;
  bassLine(context: AudioContext, time: number, midi: number, velocity: number, duration: number): void;
  riser(context: AudioContext, time: number, duration: number): void;
  lockPluck(context: AudioContext, time: number, midi: number, velocity: number, cutoff: number): void;
  killNote(
    context: AudioContext,
    time: number,
    midi: number,
    velocity: number,
    decay: number,
    gain: number,
    cutoff: number,
  ): void;
  fireZap(context: AudioContext, time: number, midi: number, cutoff: number): void;
  chip(context: AudioContext, time: number, midi: number, velocity: number): void;
  rejectThud(context: AudioContext, time: number): void;
}>;

// --- voice specs -------------------------------------------------------------

const timpaniVoice = voice<{ velocity: number; rootFreq: number }>({
  oscillators: [{ type: 'sine' }],
  duration: 0.62,
  stopPadding: 0.05,
  frequencyAutomation: (time, _frequency, { rootFreq }) => [
    { type: 'set', value: rootFreq * 1.9, time },
    { type: 'exponentialRamp', value: rootFreq, time: time + 0.11 },
  ],
  gainAutomation: (time, _gain, { velocity }) => [
    { type: 'set', value: velocity * 0.5, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.58 },
  ],
});

const hornVoice = voice<{ velocity: number; duration: number; bright: number }>({
  oscillators: [
    { type: 'sawtooth', detune: -7, gain: 0.8 },
    { type: 'square', detune: 8, gain: 0.22 },
    { type: 'sawtooth', octave: -1, gain: 0.35 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.08,
  filter: {
    type: 'lowpass',
    frequencyAutomation: (time, { bright, duration }) => [
      { type: 'set', value: 260, time },
      { type: 'linearRamp', value: 700 + 2400 * bright, time: time + Math.min(0.45, duration * 0.5) },
      { type: 'linearRamp', value: 420 + 1400 * bright, time: time + duration },
    ],
  },
  envelope: { attack: 0.075, decay: 0.01, sustain: 0.85, release: ({ duration }) => Math.min(0.5, duration * 0.45) },
});

const padNoteVoice = voice<{ velocity: number; duration: number }>({
  oscillators: [
    { type: 'sawtooth', detune: -9, gain: 0.42 },
    { type: 'sawtooth', detune: 11, gain: 0.42 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.1,
  filter: { type: 'lowpass', cutoff: 1350 },
  envelope: { attack: 0.55, decay: 0.01, sustain: 0.85, release: 1.1 },
});

const bassVoice = voice<{ velocity: number; duration: number }>({
  oscillators: [{ type: 'sawtooth' }],
  duration: ({ duration }) => duration,
  stopPadding: 0.05,
  filter: { type: 'lowpass', cutoff: 340 },
  envelope: { attack: 0.015, decay: 0.01, sustain: 0.7, release: 0.12 },
});

const snareSpec = noiseHit({ filterType: 'bandpass', frequency: 1850, decay: 0.09 });
const tickSpec = noiseHit({ filterType: 'highpass', frequency: 6400, decay: 0.03 });
const cymbalSpec = noiseHit({ filterType: 'highpass', frequency: 5200, decay: 1.1 });

const heartbeatVoice = voice<{ velocity: number }>({
  oscillators: [{ type: 'sine' }],
  duration: 0.28,
  stopPadding: 0.04,
  frequencyAutomation: (time) => [
    { type: 'set', value: 74, time },
    { type: 'exponentialRamp', value: 44, time: time + 0.2 },
  ],
  gainAutomation: (time, _gain, { velocity }) => [
    { type: 'set', value: velocity, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
  ],
});

const lockPluckVoice = voice<{ velocity: number; cutoff: number }>({
  oscillators: [{ type: 'triangle' }, { type: 'square', gain: 0.18 }],
  duration: 0.13,
  stopPadding: 0.03,
  filter: { type: 'bandpass', Q: 2.4, cutoff: ({ cutoff }) => cutoff },
  envelope: { decay: 0.13 },
});

const killLayerVoice = voice<{ decay: number; gain: number; cutoff: number }>({
  oscillators: [{ type: 'sawtooth', gain: 0.62 }, { type: 'triangle', gain: 0.85 }],
  duration: ({ decay }) => decay,
  stopPadding: 0.05,
  filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
  envelope: { decay: ({ decay }) => decay },
});

const killBodyVoice = voice<{ decay: number; gain: number }>({
  oscillators: [{ type: 'sine', octave: -1, gain: 0.6 }],
  duration: ({ decay }) => decay,
  stopPadding: 0.05,
  envelope: { decay: ({ decay }) => decay * 0.9 },
});

const fireZapVoice = voice<{ cutoff: number }>({
  oscillators: [{ type: 'sawtooth', gain: 0.11 }],
  duration: 0.09,
  stopPadding: 0.02,
  filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
  envelope: { decay: 0.09 },
});

const chipVoice = voice<{ velocity: number }>({
  oscillators: [{ type: 'triangle' }],
  duration: 0.15,
  stopPadding: 0.02,
  filter: { type: 'lowpass', cutoff: 4200 },
  gainAutomation: (time, _gain, { velocity }) => [
    { type: 'set', value: velocity, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
  ],
});

const rejectThudVoice = voice({
  oscillators: [{ type: 'sawtooth' }, { type: 'sawtooth', detune: 24, gain: 0.6 }],
  duration: 0.26,
  stopPadding: 0.02,
  filter: {
    type: 'bandpass',
    Q: 4.5,
    frequencyAutomation: (time) => [
      { type: 'set', value: 1050, time },
      { type: 'exponentialRamp', value: 360, time: time + 0.19 },
    ],
  },
  gainAutomation: (time) => [
    { type: 'set', value: 0.17, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
  ],
});

// --- instrument registry ------------------------------------------------------

export function createBroadsideVoices(environment: InstrumentEnvironment, mix: () => MixBus | null): BroadsideVoices {
  const musicOut = () => mix()?.music ?? null;
  const percussionOut = () => mix()?.duck ?? null;

  return defineInstruments(environment, {
    timpani(context, time, velocity, rootMidi) {
      const output = percussionOut();
      if (!output) return;
      timpaniVoice.play({ context, time, velocity, frequency: midiToFreq(rootMidi - 12) * 1.9, rootFreq: midiToFreq(rootMidi - 12), destination: output });
      const bus = mix();
      if (bus?.noiseBuffer && bus.music) {
        playNoiseHit({
          context,
          buffer: bus.noiseBuffer,
          time,
          velocity: velocity * 0.16,
          decay: 0.16,
          filterType: 'lowpass',
          frequency: 340,
          destination: bus.music,
        });
      }
    },
    snare(context, time, velocity) {
      const output = musicOut();
      const bus = mix();
      if (!output || !bus?.noiseBuffer) return;
      snareSpec.play({ context, buffer: bus.noiseBuffer, time, velocity, destination: output, offset: Math.random() });
    },
    tick(context, time, velocity, frequency) {
      const output = musicOut();
      const bus = mix();
      if (!output || !bus?.noiseBuffer) return;
      tickSpec.play({ context, buffer: bus.noiseBuffer, time, velocity, destination: output, offset: Math.random(), frequency });
    },
    cymbal(context, time, velocity) {
      const output = musicOut();
      const bus = mix();
      if (!output || !bus?.noiseBuffer) return;
      cymbalSpec.play({ context, buffer: bus.noiseBuffer, time, velocity, destination: output, offset: Math.random() });
    },
    cannon(context, time, velocity) {
      const output = percussionOut();
      const bus = mix();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 1,
        oscillatorType: 'sine',
        frequency: 96,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 27, time: time + 0.5 }],
        gainAutomation: [
          { type: 'set', value: velocity * 0.55, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.92 },
        ],
        destination: output,
      });
      if (bus?.noiseBuffer && bus.music) {
        playNoiseHit({
          context,
          buffer: bus.noiseBuffer,
          time,
          velocity: velocity * 0.3,
          decay: 0.5,
          filterType: 'lowpass',
          frequency: 520,
          destination: bus.music,
        });
      }
    },
    heartbeat(context, time, velocity) {
      const output = musicOut();
      if (!output) return;
      heartbeatVoice.play({ context, time, velocity, frequency: 74, destination: output });
    },
    horn(context, time, midi, velocity, duration, bright) {
      const output = musicOut();
      const bus = mix();
      if (!output) return;
      hornVoice.play({
        context,
        time,
        midi,
        velocity,
        duration,
        bright,
        destination: output,
        sends: bus?.reverbSend ? [{ destination: bus.reverbSend, gain: 0.3 }] : undefined,
      });
    },
    padNote(context, time, midi, velocity, duration) {
      const output = musicOut();
      const bus = mix();
      if (!output) return;
      padNoteVoice.play({
        context,
        time,
        midi,
        velocity,
        duration,
        destination: output,
        sends: bus?.reverbSend ? [{ destination: bus.reverbSend, gain: 0.42 }] : undefined,
      });
    },
    bassLine(context, time, midi, velocity, duration) {
      const output = musicOut();
      if (!output) return;
      bassVoice.play({ context, time, midi, velocity, duration, destination: output });
    },
    riser(context, time, duration) {
      const output = musicOut();
      const bus = mix();
      if (!output || !bus?.noiseBuffer) return;
      // Filtered noise sweep: pressure gathering under an entrance.
      buildSweep(context, bus, time, duration, output);
    },
    lockPluck(context, time, midi, velocity, cutoff) {
      const output = mix()?.sfx ?? null;
      const bus = mix();
      if (!output) return;
      lockPluckVoice.play({
        context,
        time,
        midi,
        velocity,
        cutoff,
        destination: output,
        sends: bus?.delaySend ? [{ destination: bus.delaySend, gain: 0.3 }] : undefined,
      });
    },
    killNote(context, time, midi, velocity, decay, gain, cutoff) {
      const output = mix()?.sfx ?? null;
      const bus = mix();
      if (!output) return;
      killLayerVoice.play({
        context,
        time,
        midi,
        velocity,
        decay,
        gain,
        cutoff,
        destination: output,
        sends: bus?.delaySend ? [{ destination: bus.delaySend, gain: 0.42 }] : undefined,
      });
      killBodyVoice.play({ context, time, midi, decay, gain, velocity, destination: output });
    },
    fireZap(context, time, midi, cutoff) {
      const output = mix()?.sfx ?? null;
      if (!output) return;
      fireZapVoice.play({ context, time, midi, cutoff, destination: output });
    },
    chip(context, time, midi, velocity) {
      const output = mix()?.sfx ?? null;
      const bus = mix();
      if (!output) return;
      chipVoice.play({
        context,
        time,
        midi,
        velocity,
        destination: output,
        sends: bus?.delaySend ? [{ destination: bus.delaySend, gain: 0.35 }] : undefined,
      });
    },
    rejectThud(context, time) {
      const output = mix()?.sfx ?? null;
      const bus = mix();
      if (!output) return;
      rejectThudVoice.play({ context, time, frequency: 1050, destination: output });
      if (bus?.noiseBuffer) {
        playNoiseHit({
          context,
          buffer: bus.noiseBuffer,
          time,
          velocity: 0.13,
          decay: 0.1,
          filterType: 'bandpass',
          frequency: 700,
          destination: output,
        });
      }
    },
  }, {
    timpani: ['velocity', 'rootMidi'],
    snare: ['velocity'],
    tick: ['velocity', 'frequency'],
    cymbal: ['velocity'],
    cannon: ['velocity'],
    heartbeat: ['velocity'],
    horn: ['midi', 'velocity', 'duration', 'bright'],
    padNote: ['midi', 'velocity', 'duration'],
    bassLine: ['midi', 'velocity', 'duration'],
    riser: ['duration'],
    lockPluck: ['midi', 'velocity', 'cutoff'],
    killNote: ['midi', 'velocity', 'decay', 'gain', 'cutoff'],
    fireZap: ['midi', 'cutoff'],
    chip: ['midi', 'velocity'],
    rejectThud: [],
  });
}

function buildSweep(context: AudioContext, bus: MixBus, time: number, duration: number, output: AudioNode) {
  if (!bus.noiseBuffer) return;
  const source = context.createBufferSource();
  source.buffer = bus.noiseBuffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(280, time);
  filter.frequency.exponentialRampToValueAtTime(3600, time + duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.14, time + duration * 0.85);
  gain.gain.linearRampToValueAtTime(0.0001, time + duration + 0.05);
  source.connect(filter).connect(gain).connect(output);
  source.start(time);
  source.stop(time + duration + 0.1);
}
