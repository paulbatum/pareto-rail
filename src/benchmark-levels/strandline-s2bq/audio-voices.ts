import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Strandline's instrument cabinet. Everything is built to sound submerged:
// soft attacks, lowpassed tops, long watery releases, and a shared reverb/
// delay wash standing in for the open water. The percussion is the animal —
// the kick is its slow pulse, the plinks are drips of bioluminescence.

export type StrandlineKillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number };

export type StrandlineVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createStrandlineVoices(environment: StrandlineVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;

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

  // The pulse: a deep, round thump with no click — heard through water.
  const pulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.3,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 36, time: time + 0.16 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.52 * vel, time: time + 0.015 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const bassTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.7 },
      { type: 'sine', octave: -1, gain: 0.5 },
    ],
    duration: 0.42,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 620, Q: 1.2 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.26 * vel, time: time + 0.03 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  // Sunlit pad: detuned saws breathing open and shut under a slow filter.
  const padTone = voice<{ duration: number; brightness: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration, brightness }) => [
        { type: 'set', value: 300 + brightness * 160, time },
        { type: 'linearRamp', value: 620 + brightness * 700, time: time + duration * 0.55 },
        { type: 'linearRamp', value: 300 + brightness * 160, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.04, time: time + Math.min(0.8, duration * 0.3) },
      { type: 'set', value: 0.04, time: time + duration - 0.5 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // A glassy overtone that floats above the pad — the bell's own light.
  const glowTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sine', gain: 1 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.028, time: time + duration * 0.4 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // Bubble arp: short round triangle plinks through the delay.
  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 2300 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.15 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // Droplet: a tiny falling ping, like light dripping off a strand tip.
  const dropletTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.22,
    stopPadding: 0.03,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 2.1, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.05 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  // The crown's undertow: a low two-saw dread cell for the Matriarch bars.
  const droneTone = voice<{ duration: number; vel: number }>({
    oscillators: [
      { type: 'sawtooth', detune: -8, gain: 0.6 },
      { type: 'sawtooth', detune: 8, gain: 0.6 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 340, Q: 2.2 },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.11 * vel, time: time + duration * 0.2 },
      { type: 'set', value: 0.11 * vel, time: time + duration * 0.75 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    pulse(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      pulseTone.play({ context, time, frequency: 110, vel, destination: output });
      mix.duckAt(time, 0.55, 0.34);
    },

    plink(context, time, midi, vel) {
      // The backbeat: a watery knuckle-tap on the animal's skin.
      const mix = environment.mix();
      if (!mix?.duck) return;
      noiseHit(time, 0.09 * vel, 0.045, 'bandpass', 1500, mix.duck);
      dropletTone.play({ context, time, midi, vel: vel * 0.7, destination: mix.duck, sends: sendsTo(mix.delaySend, 0.4) });
    },

    tick(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 6400, duck);
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    pad(context, time, midis, duration, brightness) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        for (const detune of [-6, 6]) {
          padTone.play({ context, time, midi, detune, duration, brightness, destination: mergeDestinations(mix.duck, mix.reverbSend) });
        }
      }
      // The top pad note gets a pure glassy double an octave up.
      const top = Math.max(...midis);
      glowTone.play({ context, time, midi: top + 12, duration, destination: mergeDestinations(mix.duck, mix.reverbSend) });
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: sendsTo(mix.delaySend, 0.5) });
    },

    droplet(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      dropletTone.play({ context, time, midi, vel, destination: mix.duck, sends: sendsTo(mix.delaySend, 0.65) });
    },

    drone(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      droneTone.play({ context, time, midi, duration, vel, destination: mix.duck });
    },

    swell(context, time, duration, vel) {
      // Water gathering itself: a bandpassed rush that opens upward.
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.15,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequencyAutomation: [
            { type: 'set', value: 240, time },
            { type: 'exponentialRamp', value: 3600, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.12 * vel, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.1 },
        ],
        destination: output,
      });
    },

    shimmerFall(context, time, midi) {
      // A brood's webbing dying back: a soft glissando falling away.
      const mix = environment.mix();
      if (!mix?.duck) return;
      const start = midiToFreq(midi + 12);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.7,
        oscillatorType: 'sine',
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: start * 0.5, time: time + 0.55 }],
        gainAutomation: [
          { type: 'set', value: 0.07, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.65 },
        ],
        destination: mix.duck,
        sends: sendsTo(mix.delaySend, 0.6),
      });
      noiseHit(time, 0.05, 0.3, 'highpass', 5200, mix.duck);
    },
  }, {
    pulse: ['vel'],
    plink: ['midi', 'vel'],
    tick: ['vel', 'decay'],
    bass: ['midi', 'vel'],
    pad: ['midis', 'duration', 'brightness'],
    arp: ['midi', 'vel'],
    droplet: ['midi', 'vel'],
    drone: ['midi', 'duration', 'vel'],
    swell: ['duration', 'vel'],
    shimmerFall: ['midi'],
  });

  function sendsTo(destination: AudioNode | undefined, gain: number) {
    return destination ? [{ destination, gain }] : [];
  }

  function mergeDestinations(primary: AudioNode, wash?: AudioNode) {
    return wash ? [primary, wash] : primary;
  }

  return {
    ...instruments,
    noiseHit,
    sendsTo,
  };
}
