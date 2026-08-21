import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// Tinker Ball's instrument shelf: bright, eccentric, workshop-sized pop.
// Bell-like mallets lead, clipped reed-organ stabs chord, the synth bass
// bounces, handclaps keep the backbeat, and a shelf of tiny workshop
// percussion (woodblock, ratchet ticks, jar pings) fills the gaps.

export type TinkerVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createTinkerVoices(environment: TinkerVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

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

  // Bouncy pop kick: round, short, more thump than boom.
  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.14,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 48, time: time + 0.09 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.44 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  // Synth bass with a plucked, bouncing envelope.
  const bassTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.7 },
      { type: 'sine', octave: -1, gain: 0.5 },
    ],
    duration: 0.2,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 3,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 420 + vel * 900, time },
        { type: 'exponentialRamp', value: 180, time: time + 0.16 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.34 * vel, time: time + 0.005 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  // Warm reed-organ pad: soft, blurred, sits under everything.
  const padTone = voice<{ duration: number }>({
    oscillators: [{ type: 'square', gain: 0.5 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      Q: 1.4,
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 380, time },
        { type: 'linearRamp', value: 700, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 380, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.038, time: time + 0.45 },
      { type: 'set', value: 0.038, time: time + duration - 0.4 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // Clipped reed-organ stab: a short square chord shove through a bandpass —
  // the "honk" of the arrangement.
  const reedTone = voice<{ vel: number; duration: number }>({
    oscillators: [{ type: 'square', gain: 0.8 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.03,
    filter: {
      type: 'bandpass',
      Q: 1.1,
      frequencyAutomation: (time) => [
        { type: 'set', value: 1500, time },
        { type: 'exponentialRamp', value: 900, time: time + 0.12 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  // Bell-like mallet: sine fundamental plus inharmonic partials, fast bloom
  // and a long ring. The player's mallet reuses the same recipe.
  const malletTone = voice<{ decay: number; brightness: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', frequencyRatio: 2.76, gain: ({ brightness }) => 0.22 * brightness },
      { type: 'sine', frequencyRatio: 5.4, gain: ({ brightness }) => 0.08 * brightness },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 3200 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.13 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  const woodblockTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.05,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [
      { type: 'set', value: 820, time },
      { type: 'exponentialRamp', value: 460, time: time + 0.04 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.22 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.05 },
    ],
  });

  const jarPingTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.7 },
      { type: 'sine', frequencyRatio: 2.42, gain: 0.18 },
    ],
    duration: 0.5,
    stopPadding: 0.06,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.48 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.06 * vel, 0.004, 'highpass', 1400, output);
      mix.duckAt(time, 0.45, 0.22);
    },

    clap(_context, time, vel = 1) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.17 * vel, 0.045, 'bandpass', 1700, output);
      noiseHit(time + 0.012, 0.11 * vel, 0.065, 'bandpass', 2100, output);
      noiseHit(time + 0.024, 0.07 * vel, 0.08, 'bandpass', 2400, output);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 7800, duck);
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    pad(context, time, midis, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      for (const midi of midis) {
        for (const detune of [-6, 6]) {
          padTone.play({ context, time, midi, detune, duration, destination: [mix.duck, mix.delaySend] });
        }
      }
    },

    reed(context, time, midis, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      for (const midi of midis) {
        reedTone.play({
          context,
          time,
          midi,
          vel,
          duration: 0.14,
          destination: output,
          sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.2 }] : undefined,
        });
      }
    },

    mallet(context, time, midi, vel, decay = 0.42, brightness = 0.8) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix?.delaySend || !output) return;
      malletTone.play({
        context,
        time,
        midi,
        velocity: vel,
        decay,
        brightness,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.4 }],
      });
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.45 }] });
    },

    woodblock(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      woodblockTone.play({ context, time, vel, frequency: 820, destination: duck });
    },

    jarPing(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      jarPingTone.play({
        context,
        time,
        midi,
        vel,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
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
          Q: 1.1,
          frequencyAutomation: [
            { type: 'set', value: 320, time },
            { type: 'exponentialRamp', value: 6800, time: time + duration },
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
  }, {
    kick: ['vel'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    bass: ['midi', 'vel'],
    pad: ['midis', 'duration'],
    reed: ['midis', 'vel'],
    mallet: ['midi', 'vel', 'decay', 'brightness'],
    arp: ['midi', 'vel'],
    woodblock: ['vel'],
    jarPing: ['midi', 'vel'],
    riser: ['duration'],
  });

  function playerSends(delayGain: number) {
    const delaySend = environment.mix()?.delaySend;
    return delaySend && delayGain > 0 ? [{ destination: delaySend, gain: delayGain }] : [];
  }

  // The player's mallet voice — same bell recipe as the arrangement mallet
  // but routed to the sfx bus so it always speaks over the backing.
  function playerMallet(
    time: number,
    midi: number,
    options: { vel?: number; decay?: number; brightness?: number; weight?: number } = {},
  ) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    malletTone.play({
      context,
      time,
      midi,
      velocity: options.vel ?? 1,
      decay: options.decay ?? 0.4,
      brightness: options.brightness ?? 0.9,
      weight: options.weight ?? 1,
      destination: output,
      sends: playerSends(0.45),
    });
  }

  return {
    ...instruments,
    arpNote: instruments.arp,
    noiseHit,
    playerSends,
    playerMallet,
  };
}
