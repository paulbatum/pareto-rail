import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

export type StrandlineKillVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  shimmer: number;
};

export type StrandlineVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createStrandlineVoices(environment: StrandlineVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({
    filterType: 'highpass',
    frequency: 1200,
    velocity: 1,
    decay: 0.05,
  });

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

  // Deep aquatic sub-kick
  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.22,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [
      { type: 'set', value: 125, time },
      { type: 'exponentialRamp', value: 38, time: time + 0.14 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.55 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  // Rolling oceanic sub-bass
  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }, { type: 'sine', octave: -1, gain: 0.6 }],
    duration: 0.32,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      Q: 4,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 180 + vel * 550, time },
        { type: 'exponentialRamp', value: 140, time: time + 0.25 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.34 * vel, time: time + 0.008 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
    ],
  });

  // Shimmering oceanic ambient pad
  const padTone = voice<{ duration: number; gainMultiplier?: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.4 }, { type: 'sine', gain: 0.6 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 380, time },
        { type: 'linearRamp', value: 850, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 380, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, gainMultiplier = 1.0 }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.04 * gainMultiplier, time: time + 0.6 },
      { type: 'set', value: 0.04 * gainMultiplier, time: time + duration - 0.5 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // Liquid marimba / kalimba bell arpeggios
  const bellTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', octave: 1, gain: 0.25 }],
    duration: 0.28,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 3200 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.18 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });

  // Melodic player kill note instrument
  const killPlayerTone = voice<{ voice: StrandlineKillVoice }>({
    oscillators: [
      { type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain },
      { type: 'sine', octave: 1, gain: ({ voice }) => voice.gain * voice.shimmer },
    ],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  // Player action SFX: Lock, Fire, Hit, Reject
  const lockTone = voice<{ cutoff: number; gain: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', octave: 1, gain: 0.3 }],
    duration: 0.12,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    gainAutomation: (time, _gain, { gain }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  const instruments = defineInstruments(
    { trace: environment.trace, context: environment.context },
    {
      kick(context, time, vel) {
        const mix = environment.mix();
        const output = musicDestination();
        if (!mix || !output) return;
        kickTone.play({ context, time, frequency: 130, vel, destination: output });
        noiseHit(time, 0.08 * vel, 0.006, 'highpass', 1400, output);
        mix.duckAt(time, 0.38, 0.28);
      },

      clap(_context, time) {
        const output = musicDestination();
        if (!output) return;
        noiseHit(time, 0.14, 0.06, 'bandpass', 2100, output);
        noiseHit(time + 0.012, 0.09, 0.08, 'bandpass', 2400, output);
      },

      hat(_context, time, vel, decay = 0.04) {
        const duck = environment.mix()?.duck;
        if (!duck) return;
        noiseHit(time, vel * 0.12, decay, 'highpass', 7800, duck);
      },

      bass(context, time, midi, vel) {
        const duck = environment.mix()?.duck;
        if (!duck) return;
        bassTone.play({ context, time, midi, vel, destination: duck });
      },

      pad(context, time, midis, duration, gainMultiplier = 1.0) {
        const mix = environment.mix();
        if (!mix?.duck || !mix.delaySend) return;
        for (const midi of midis) {
          for (const detune of [-6, 6]) {
            padTone.play({
              context,
              time,
              midi,
              detune,
              duration,
              gainMultiplier,
              destination: [mix.duck, mix.delaySend],
            });
          }
        }
      },

      bell(context, time, midi, vel) {
        const mix = environment.mix();
        if (!mix?.duck || !mix.delaySend) return;
        bellTone.play({
          context,
          time,
          midi,
          vel,
          destination: mix.duck,
          sends: [{ destination: mix.delaySend, gain: 0.45 }],
        });
      },

      playerKill(context, time, midi, voiceConfig) {
        const mix = environment.mix();
        const sfx = sfxDestination();
        if (!mix || !sfx) return;
        killPlayerTone.play({
          context,
          time,
          midi,
          voice: voiceConfig,
          destination: sfx,
          sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.35 }] : undefined,
        });
      },

      playerLock(context, time, midi, cutoff = 3000, gain = 0.12) {
        const sfx = sfxDestination();
        if (!sfx) return;
        lockTone.play({ context, time, midi, cutoff, gain, destination: sfx });
      },

      playerFire(context, time) {
        const sfx = sfxDestination();
        if (!sfx) return;
        noiseHit(time, 0.12, 0.09, 'bandpass', 1800, sfx);
      },

      playerHit(context, time, lethal) {
        const sfx = sfxDestination();
        if (!sfx) return;
        noiseHit(time, lethal ? 0.22 : 0.12, lethal ? 0.14 : 0.06, 'lowpass', lethal ? 900 : 1600, sfx);
      },

      playerReject(context, time) {
        const sfx = sfxDestination();
        if (!sfx) return;
        // Low resonant water bubble thud
        kickTone.play({ context, time, frequency: 70, vel: 0.4, destination: sfx });
        noiseHit(time, 0.18, 0.12, 'lowpass', 500, sfx);
      },
    },
  );

  return instruments;
}
