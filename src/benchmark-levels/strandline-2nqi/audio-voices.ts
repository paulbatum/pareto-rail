import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type AutomationStep,
  type MixBus,
} from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { noiseHit as noiseHitSpec } from '../../engine/audio-voices';

// Leaf: synth voice construction only. What plays, when, and at what pitch is
// decided in audio.ts. The palette is water: sine and triangle bodies, glassy
// inharmonic bells, filtered noise for surf and shimmer — and one sour voice
// (a stack of minor seconds and tritones) reserved for the parasites.

export type StrandlineVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type ToneOptions = {
  time: number;
  midi?: number;
  frequency?: number;
  type?: OscillatorType;
  gain: number;
  attack?: number;
  decay: number;
  cutoff?: number;
  Q?: number;
  detune?: number;
  glideTo?: number;
  glideTime?: number;
  delaySend?: number;
  reverbSend?: number;
  destination: AudioNode | AudioNode[];
};

export function createStrandlineVoices(environment: StrandlineVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.duck ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const noiseVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

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
    noiseVoice.play({
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

  /** One enveloped oscillator with optional pitch glide and effect sends. */
  function tone(options: ToneOptions) {
    const context = environment.context();
    const mix = environment.mix();
    if (!context) return;
    const frequency = options.frequency ?? midiToFreq(options.midi ?? 60);
    if (!Number.isFinite(frequency) || frequency <= 0) return; // a bad note is a rest, never a crash in the scheduler
    const attack = options.attack ?? 0.004;
    const stop = options.time + attack + options.decay + 0.06;
    const gainSteps: AutomationStep[] = [
      { type: 'set', value: 0.0001, time: options.time },
      { type: 'linearRamp', value: options.gain, time: options.time + attack },
      { type: 'exponentialRamp', value: 0.0001, time: options.time + attack + options.decay },
    ];
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && options.delaySend) sends.push({ destination: mix.delaySend, gain: options.delaySend });
    if (mix?.reverbSend && options.reverbSend) sends.push({ destination: mix.reverbSend, gain: options.reverbSend });
    playOscillatorVoice({
      context,
      time: options.time,
      stopTime: stop,
      oscillatorType: options.type ?? 'sine',
      frequency,
      detune: options.detune,
      frequencyAutomation: options.glideTo
        ? [{ type: 'exponentialRamp', value: options.glideTo, time: options.time + (options.glideTime ?? 0.08) }]
        : undefined,
      filter: options.cutoff ? { type: 'lowpass', frequency: options.cutoff, Q: options.Q ?? 0.7 } : undefined,
      gainAutomation: gainSteps,
      destination: options.destination,
      sends,
    });
  }

  /** A sustained swell: slow attack, long release — pads, drones, bloom chords. */
  function swell(options: {
    time: number;
    midi: number;
    type: OscillatorType;
    gain: number;
    attack: number;
    hold: number;
    release: number;
    cutoff: number;
    cutoffTo?: number;
    detune?: number;
    reverbSend?: number;
    delaySend?: number;
    destination: AudioNode | AudioNode[];
  }) {
    const context = environment.context();
    const mix = environment.mix();
    if (!context || !Number.isFinite(options.midi)) return;
    const end = options.time + options.attack + options.hold;
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && options.delaySend) sends.push({ destination: mix.delaySend, gain: options.delaySend });
    if (mix?.reverbSend && options.reverbSend) sends.push({ destination: mix.reverbSend, gain: options.reverbSend });
    playOscillatorVoice({
      context,
      time: options.time,
      stopTime: end + options.release + 0.05,
      oscillatorType: options.type,
      frequency: midiToFreq(options.midi),
      detune: options.detune,
      filter: {
        type: 'lowpass',
        Q: 0.5,
        frequencyAutomation: [
          { type: 'set', value: options.cutoff, time: options.time },
          { type: 'linearRamp', value: options.cutoffTo ?? options.cutoff, time: end },
        ],
      },
      gainAutomation: [
        { type: 'set', value: 0.0001, time: options.time },
        { type: 'linearRamp', value: options.gain, time: options.time + options.attack },
        { type: 'set', value: options.gain, time: end },
        { type: 'linearRamp', value: 0.0001, time: end + options.release },
      ],
      destination: options.destination,
      sends,
    });
  }

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    // The jelly's pulse: a sine that falls like a hand pressed into water.
    // `dub` is the softer, higher second beat of the lub-dub.
    heart(_context, time, vel, dub) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      const start = dub > 0 ? 118 : 96;
      const end = dub > 0 ? 62 : 44;
      tone({ time, frequency: start, glideTo: end, glideTime: 0.2, gain: 0.36 * vel, decay: 0.26, destination: output });
      // a rounder body an octave up, so the pulse is felt on small speakers too
      tone({ time, frequency: start * 2.2, glideTo: end * 2.2, glideTime: 0.14, type: 'triangle', gain: 0.13 * vel, decay: 0.14, cutoff: 700, destination: output });
      noiseHit(time, 0.05 * vel, 0.05, 'lowpass', 420, output);
      if (dub === 0) mix.duckAt(time, 0.72, 0.34);
    },

    // Groove kick for the tide — same family as the pulse, but rounder.
    kick(_context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      tone({ time, frequency: 138, glideTo: 42, glideTime: 0.13, gain: 0.4 * vel, decay: 0.22, destination: output });
      tone({ time, frequency: 220, glideTo: 90, glideTime: 0.07, type: 'triangle', gain: 0.1 * vel, decay: 0.09, cutoff: 900, destination: output });
      noiseHit(time, 0.06 * vel, 0.02, 'bandpass', 900, output);
      mix.duckAt(time, 0.5, 0.26);
    },

    // Wooden click on the backbeat: a knuckle on a marimba bar.
    tok(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.13 * vel, 0.035, 'bandpass', 1900, output);
      tone({ time, frequency: 640, glideTo: 310, glideTime: 0.05, gain: 0.09 * vel, decay: 0.07, destination: output });
    },

    // Surf shimmer: hats are sand in moving water.
    swish(_context, time, vel, decay) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, vel, decay, 'highpass', 6800, output);
    },

    // Soft round bass: a sine with a whisper of triangle above it.
    bass(_context, time, midi, vel, decay) {
      const output = musicDestination();
      if (!output) return;
      tone({ time, midi, gain: 0.3 * vel, attack: 0.012, decay, destination: output });
      tone({ time, midi: midi + 12, type: 'triangle', gain: 0.05 * vel, attack: 0.012, decay: decay * 0.6, cutoff: 700, destination: output });
    },

    // Whole-chord pad: slow bloom, long release, drenched in reverb.
    pad(_context, time, midis: number[], duration: number, bright: number) {
      const output = musicDestination();
      if (!output) return;
      const cutoff = 520 + bright * 1900;
      for (const midi of midis) {
        for (const detune of [-6, 6]) {
          swell({
            time,
            midi,
            type: bright > 0.55 ? 'sawtooth' : 'triangle',
            gain: bright > 0.55 ? 0.011 + bright * 0.01 : 0.03,
            attack: 0.9,
            hold: Math.max(0.2, duration - 1.6),
            release: 1.2,
            cutoff,
            cutoffTo: cutoff * 1.35,
            detune,
            reverbSend: 0.55,
            delaySend: 0.1,
            destination: output,
          });
        }
        swell({
          time,
          midi: midi - 12,
          type: 'sine',
          gain: 0.028,
          attack: 1.1,
          hold: Math.max(0.2, duration - 1.8),
          release: 1.4,
          cutoff: 900,
          reverbSend: 0.25,
          destination: output,
        });
      }
    },

    // Glass bell / kalimba: fundamental plus two inharmonic partials.
    bell(_context, time, midi, vel, decay) {
      const output = musicDestination();
      if (!output) return;
      tone({ time, midi, gain: 0.15 * vel, decay, delaySend: 0.5, reverbSend: 0.4, destination: output });
      tone({ time, frequency: midiToFreq(midi) * 2.76, gain: 0.045 * vel, decay: decay * 0.35, reverbSend: 0.3, destination: output });
      tone({ time, frequency: midiToFreq(midi) * 5.4, gain: 0.018 * vel, decay: decay * 0.15, destination: output });
    },

    // Reveal riser: surf swelling from murk to glitter.
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
            { type: 'exponentialRamp', value: 7200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.16, time: time + duration * 0.96 },
          { type: 'linearRamp', value: 0, time: time + duration + 0.04 },
        ],
        destination: output,
      });
      tone({ time, frequency: 220, glideTo: 880, glideTime: duration, type: 'sine', gain: 0.05, attack: duration * 0.9, decay: 0.1, reverbSend: 0.5, destination: output });
    },

    // The dive: surf falling away under a sub drop.
    dive(context, time, duration) {
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
            { type: 'set', value: 5200, time },
            { type: 'exponentialRamp', value: 220, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.13, time },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
      tone({ time, frequency: 180, glideTo: 36, glideTime: duration, gain: 0.34, decay: duration, destination: output });
    },

    // The moon: the bell fills the sky. A wide D chord blooms in three octaves
    // above a sub swell, with a cascade of glass falling through it.
    bloomHit(_context, time, midis: number[]) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix) return;
      mix.duckAt(time, 0.4, 1.1);
      tone({ time, frequency: 110, glideTo: 36.7, glideTime: 0.6, gain: 0.5, decay: 1.4, destination: output });
      midis.forEach((midi, index) => {
        for (const detune of [-8, 8]) {
          swell({
            time: time + index * 0.045,
            midi,
            type: 'sawtooth',
            gain: 0.013,
            attack: 0.06,
            hold: 1.4,
            release: 1.9,
            cutoff: 900,
            cutoffTo: 3400,
            detune,
            reverbSend: 0.6,
            delaySend: 0.3,
            destination: output,
          });
        }
      });
      noiseHit(time, 0.12, 1.6, 'highpass', 5200, output);
    },

    // The crown: the water goes cold. Low pad, sub boom, reversed shimmer.
    crownHit(_context, time) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix) return;
      mix.duckAt(time, 0.3, 0.9);
      tone({ time, frequency: 96, glideTo: 30, glideTime: 0.9, gain: 0.6, decay: 1.6, destination: output });
      noiseHit(time, 0.16, 0.9, 'lowpass', 900, output);
      // A sour dyad opens: minor second over the tonic's fifth.
      tone({ time, midi: 59, type: 'sawtooth', gain: 0.03, attack: 0.05, decay: 1.6, cutoff: 900, reverbSend: 0.5, destination: output });
      tone({ time, midi: 60, type: 'sawtooth', gain: 0.03, attack: 0.05, decay: 1.6, cutoff: 900, reverbSend: 0.5, destination: output });
    },

    // The violet undertow: parasite harmony. Saws a semitone and a tritone off
    // the root, throbbing. Fades as the webbing dies back.
    drone(_context, time, midi, duration, infection) {
      const output = musicDestination();
      if (!output || infection <= 0.02) return;
      const gain = 0.018 * infection;
      for (const [offset, level] of [[0, 1.4], [1, 1], [6, 0.7], [13, 0.6]] as const) {
        for (const detune of [-14, 14]) {
          swell({
            time,
            midi: midi + offset,
            type: 'sawtooth',
            gain: gain * level,
            attack: 0.35,
            hold: Math.max(0.1, duration - 0.9),
            release: 0.55,
            cutoff: 380 + infection * 260,
            cutoffTo: 220,
            detune,
            reverbSend: 0.3,
            destination: output,
          });
        }
      }
    },

    // A sparkle: the pentatonic glitter that answers the parasites dying back.
    glint(_context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      tone({ time, midi, gain: 0.09 * vel, decay: 0.5, delaySend: 0.6, reverbSend: 0.5, destination: output });
    },
  }, {
    heart: ['vel', 'dub'],
    kick: ['vel'],
    tok: ['vel'],
    swish: ['vel', 'decay'],
    bass: ['midi', 'vel', 'decay'],
    pad: ['midis', 'duration', 'bright'],
    bell: ['midi', 'vel', 'decay'],
    riser: ['duration'],
    dive: ['duration'],
    bloomHit: ['midis'],
    crownHit: [],
    drone: ['midi', 'duration', 'infection'],
    glint: ['midi', 'vel'],
  });

  return { ...instruments, tone, swell, noiseHit, sfxDestination, musicDestination };
}

export type StrandlineVoices = ReturnType<typeof createStrandlineVoices>;
