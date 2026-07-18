import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createMassDriverDetailedVoices(environment: VoiceEnvironment) {
  const musicOut = () => environment.mix()?.duck ?? environment.mix()?.music ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const kickSpec = voice<{ velocity: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.24,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [
      { type: 'set', value: 150, time },
      { type: 'exponentialRamp', value: 43, time: time + 0.055 },
      { type: 'exponentialRamp', value: 34, time: time + 0.22 },
    ],
    gainAutomation: (time, _gain, { velocity }) => [
      { type: 'set', value: 0.46 * velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.23 },
    ],
  });
  const bassSpec = voice<{ velocity: number; bright: number; decay: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.12 }, { type: 'sine', gain: 0.2 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ bright }) => bright, Q: 3.5 },
    gainAutomation: (time, _gain, { velocity, decay }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });
  const synthSpec = voice<{ type: OscillatorType; velocity: number; bright: number; decay: number }>({
    oscillators: [{ type: ({ type }) => type }, { type: 'sine', octave: 1, gain: 0.13 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ bright }) => bright, Q: 5 },
    gainAutomation: (time, _gain, { velocity, decay }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });
  const padSpec = voice<{ velocity: number; decay: number; major: boolean }>({
    oscillators: [
      { type: 'sine', gain: 0.34 },
      { type: 'triangle', detune: -8, gain: 0.18 },
      { type: 'triangle', detune: 9, gain: 0.18 },
      { type: 'sine', octave: 1, gain: ({ major }) => major ? 0.1 : 0.055 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.2,
    filter: { type: 'lowpass', cutoff: ({ major }) => major ? 5200 : 1800 },
    gainAutomation: (time, _gain, { velocity, decay }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: velocity, time: time + Math.min(0.45, decay * 0.15) },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });
  const noiseSpec = noiseHit({ filterType: 'highpass', frequency: 5600, decay: 0.035 });

  return defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, velocity) {
      const out = musicOut();
      if (!out) return;
      kickSpec.play({ context, time, frequency: 110, velocity, destination: out });
      environment.mix()?.duckAt(time, 0.48, 0.24);
    },
    noise(context, time, velocity, frequency, decay) {
      const out = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      noiseSpec.play({ context, buffer, time, velocity, frequency, decay, destination: out, offset: (time * 0.731) % 1 });
    },
    bass(context, time, midi, velocity, bright, decay) {
      const out = musicOut();
      if (!out) return;
      bassSpec.play({ context, time, midi, velocity, bright, decay, destination: out });
    },
    synth(context, time, midi, type, velocity, bright, decay, send) {
      const out = musicOut();
      if (!out) return;
      const delay = environment.mix()?.delaySend;
      const reverb = environment.mix()?.reverbSend;
      synthSpec.play({
        context,
        time,
        midi,
        type,
        velocity,
        bright,
        decay,
        destination: out,
        sends: [
          ...(delay && send > 0 ? [{ destination: delay, gain: send }] : []),
          ...(reverb && send > 0 ? [{ destination: reverb, gain: send * 0.45 }] : []),
        ],
      });
    },
    pad(context, time, midi, velocity, decay, major) {
      const out = musicOut();
      if (!out) return;
      const reverb = environment.mix()?.reverbSend;
      padSpec.play({
        context,
        time,
        midi,
        velocity,
        decay,
        major,
        destination: out,
        sends: reverb ? [{ destination: reverb, gain: major ? 0.55 : 0.22 }] : undefined,
      });
    },
    action(context, time, midi, type, velocity, bright, decay, send) {
      const out = sfxOut();
      if (!out) return;
      const delay = environment.mix()?.delaySend;
      const reverb = environment.mix()?.reverbSend;
      synthSpec.play({
        context,
        time,
        midi,
        type,
        velocity,
        bright,
        decay,
        destination: out,
        sends: [
          ...(delay && send > 0 ? [{ destination: delay, gain: send }] : []),
          ...(reverb && send > 0 ? [{ destination: reverb, gain: send * 0.65 }] : []),
        ],
      });
    },
    breaker(context, time, velocity, decay) {
      const out = sfxOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + decay + 0.05,
        filter: {
          type: 'bandpass',
          Q: 9,
          frequencyAutomation: [
            { type: 'set', value: 1900, time },
            { type: 'exponentialRamp', value: 82, time: time + decay },
          ],
        },
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        destination: out,
      });
    },
  }, {
    kick: ['velocity'],
    noise: ['velocity', 'frequency', 'decay'],
    bass: ['midi', 'velocity', 'bright', 'decay'],
    synth: ['midi', 'type', 'velocity', 'bright', 'decay', 'send'],
    pad: ['midi', 'velocity', 'decay', 'major'],
    action: ['midi', 'type', 'velocity', 'bright', 'decay', 'send'],
    breaker: ['velocity', 'decay'],
  });
}
