import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

type Environment = { trace?: AudioTraceSink; context(): AudioContext | null; mix(): MixBus | null };

export function createMassDriverVoices(environment: Environment) {
  const musicOut = () => environment.mix()?.duck ?? environment.mix()?.music ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const tickSpec = noiseHit({ filterType: 'highpass', frequency: 5600, decay: 0.025 });
  const pulseSpec = voice<{ velocity: number }>({
    oscillators: [{ type: 'sine' }], duration: 0.22, stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 38, time: time + 0.16 }],
    gainAutomation: (time, _gain, { velocity }) => [
      { type: 'set', value: 0.42 * velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });
  const inductionSpec = voice<{ velocity: number; bright: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.09 }, { type: 'square', octave: 1, gain: 0.025 }],
    duration: 0.19, stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 5, cutoff: ({ bright }) => bright },
    gainAutomation: (time, _gain, { velocity }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });
  const actionSpec = voice<{ type: OscillatorType; decay: number; cutoff: number; velocity: number }>({
    oscillators: [{ type: ({ type }) => type }], duration: ({ decay }) => decay, stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    gainAutomation: (time, _gain, { decay, velocity }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    pulse(context, time, midi, velocity) {
      const out = musicOut();
      if (!out) return;
      pulseSpec.play({ context, time, midi, velocity, frequency: 110, destination: out });
      environment.mix()?.duckAt(time, 0.48, 0.22);
    },
    tick(context, time, velocity, long) {
      const out = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      tickSpec.play({ context, buffer, time, velocity, decay: long ? 0.09 : 0.018, frequency: long ? 3100 : 6500, destination: out, offset: Math.random() });
    },
    induction(context, time, midi, velocity, bright) {
      const out = musicOut();
      if (!out) return;
      inductionSpec.play({ context, time, midi, velocity, bright, destination: out });
    },
    action(context, time, midi, type, decay, cutoff, velocity) {
      const out = sfxOut();
      if (!out) return;
      const delay = environment.mix()?.delaySend;
      actionSpec.play({
        context, time, midi, type, decay, cutoff, velocity, destination: out,
        sends: delay ? [{ destination: delay, gain: 0.35 }] : undefined,
      });
    },
    arc(context, time, velocity, decay) {
      const out = sfxOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      playBufferSourceVoice({
        context, buffer, time, stopTime: time + decay + 0.05,
        filter: { type: 'bandpass', Q: 9, frequencyAutomation: [
          { type: 'set', value: 6200, time }, { type: 'exponentialRamp', value: 900, time: time + decay },
        ] },
        gainAutomation: [{ type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + decay }],
        destination: out,
      });
    },
  }, {
    pulse: ['midi', 'velocity'], tick: ['velocity', 'long'], induction: ['midi', 'velocity', 'bright'],
    action: ['midi', 'type', 'decay', 'cutoff', 'velocity'], arc: ['velocity', 'decay'],
  });

  return instruments;
}
