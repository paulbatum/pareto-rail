import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// Construction only: every timbre in the harbour, and none of the decisions
// about when it sounds. The score owns patterns, harmony, and the mix moves.

export type ThermalInkVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
  /** Sub-bus for grit: metal, chain, and noise, ducked whenever the imager is up. */
  grit(): AudioNode | null;
};

export function createThermalInkVoices(environment: ThermalInkVoiceEnvironment) {
  const musicOut = () => environment.mix()?.duck ?? environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const gritOut = () => environment.grit() ?? musicOut();

  const noise = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

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
    noise.play({
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

  // A dockside piling struck underwater: a long sub fall with almost no click.
  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.34,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [
      { type: 'exponentialRamp', value: 52, time: time + 0.06 },
      { type: 'exponentialRamp', value: 33, time: time + 0.3 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  // Heavy bouncing bass: a resonant saw that snaps shut, with a sine under it
  // so the bounce still lands on small speakers.
  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.34 }, { type: 'square', gain: 0.1, detune: -8 }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      Q: 9,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 320 + vel * 1500, time },
        { type: 'exponentialRamp', value: 150, time: time + 0.26 },
      ],
    },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: gain * vel, time: time + 0.008 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const subTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.36 }],
    duration: 0.36,
    stopPadding: 0.05,
    envelope: { decay: 0.3 },
  });

  // Metal: three inharmonic partials, which is what makes a struck hull sound
  // like a hull and not a bell.
  const anvilPartial = voice<{ ratio: number; vel: number; decay: number }>({
    oscillators: [{ type: 'square', frequencyRatio: ({ ratio }) => ratio, gain: 0.055 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 2.4, cutoff: ({ ratio }) => 900 * ratio },
    gainAutomation: (time, gain, { vel, decay }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const droneTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.5 }, { type: 'sawtooth', gain: 0.5, detune: 9 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.1,
    filter: {
      type: 'lowpass',
      Q: 1.2,
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 240, time },
        { type: 'linearRamp', value: 620, time: time + duration * 0.55 },
        { type: 'linearRamp', value: 220, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: level, time: time + duration * 0.35 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // The melody. One voice, no chorus: it has to sound like a single lamp in a
  // lot of water. `cutoff` is the imager: closed in murk, wide open in infrared.
  const leadTone = voice<{ vel: number; cutoff: number; decay: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.3 },
      { type: 'triangle', gain: 0.16, detune: 7 },
      { type: 'square', gain: 0.05, octave: -1 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.08,
    filter: { type: 'lowpass', Q: 1.6, cutoff: ({ cutoff }) => cutoff },
    gainAutomation: (time, gain, { vel, decay }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain * vel, time: time + 0.03 },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const sonarTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 0.16 }],
    duration: 0.7,
    stopPadding: 0.06,
    envelope: { attack: 0.01, decay: 0.66 },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain * vel, time: time + 0.012 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  // The creature: a slow bend down through the floor of the mix.
  const groanTone = voice<{ from: number; to: number; level: number; duration: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.5 }, { type: 'sawtooth', gain: 0.3, detune: -14 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.1,
    filter: {
      type: 'lowpass',
      Q: 4,
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 700, time },
        { type: 'exponentialRamp', value: 130, time: time + duration },
      ],
    },
    frequencyAutomation: (time, _frequency, { to, duration }) => [
      { type: 'exponentialRamp', value: to, time: time + duration * 0.9 },
    ],
    gainAutomation: (time, _gain, { level, duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: level, time: time + 0.08 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const out = musicOut();
      if (!mix || !out) return;
      kickTone.play({ context, time, frequency: 132, vel, destination: out });
      noiseHit(time, 0.05 * vel, 0.02, 'lowpass', 700, gritOut() ?? out);
      mix.duckAt(time, 0.52, 0.3);
    },

    anvil(context, time, vel, decay) {
      const out = gritOut();
      if (!out) return;
      for (const ratio of [1, 2.76, 5.41]) {
        anvilPartial.play({ context, time, frequency: 196, ratio, vel, decay, destination: out });
      }
      noiseHit(time, 0.09 * vel, 0.05, 'bandpass', 3200, out);
    },

    chain(_context, time, vel) {
      const out = gritOut();
      if (!out) return;
      noiseHit(time, vel, 0.028, 'highpass', 7400, out);
      noiseHit(time + 0.02, vel * 0.5, 0.02, 'highpass', 5200, out);
    },

    bass(context, time, midi, vel) {
      const out = musicOut();
      if (!out) return;
      bassTone.play({ context, time, midi, vel, destination: out });
      subTone.play({ context, time, midi, vel, destination: out });
    },

    drone(context, time, midis, duration, level) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        droneTone.play({ context, time, midi, duration, level, destination: mix.duck });
      }
    },

    lead(context, time, midi, vel, cutoff, decay) {
      const mix = environment.mix();
      const out = musicOut();
      if (!mix || !out) return;
      leadTone.play({
        context,
        time,
        midi,
        vel,
        cutoff,
        decay,
        destination: out,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.42 }] : undefined,
      });
    },

    sonar(context, time, midi, vel) {
      const mix = environment.mix();
      const out = musicOut();
      if (!mix || !out) return;
      sonarTone.play({
        context,
        time,
        midi,
        vel,
        destination: out,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.7 }] : undefined,
      });
      noiseHit(time, 0.02 * vel, 0.4, 'bandpass', 900, gritOut() ?? out);
    },

    groan(context, time, from, to, level, duration) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      groanTone.play({ context, time, frequency: from, from, to, level, duration, destination: mix.duck });
    },

    riser(context, time, duration) {
      const out = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequencyAutomation: [
            { type: 'set', value: 200, time },
            { type: 'exponentialRamp', value: 4200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.11, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: out,
      });
    },
  }, {
    kick: ['vel'],
    anvil: ['vel', 'decay'],
    chain: ['vel'],
    bass: ['midi', 'vel'],
    drone: ['midis', 'duration', 'level'],
    lead: ['midi', 'vel', 'cutoff', 'decay'],
    sonar: ['midi', 'vel'],
    groan: ['from', 'to', 'level', 'duration'],
    riser: ['duration'],
  });

  return { ...instruments, noiseHit, sfxOut, musicOut, gritOut };
}
