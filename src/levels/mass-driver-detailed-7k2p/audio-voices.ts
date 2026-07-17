import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createMassDriverVoices(environment: VoiceEnvironment) {
  const musicOut = () => environment.mix()?.duck ?? environment.mix()?.music ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const noise = noiseHit({ filterType: 'highpass', frequency: 6200, decay: 0.035 });
  const kickVoice = voice<{ velocity: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', octave: 1, gain: 0.18 }],
    duration: 0.25,
    frequencyAutomation: (time) => [
      { type: 'set', value: 116, time },
      { type: 'exponentialRamp', value: 39, time: time + 0.16 },
    ],
    gainAutomation: (time, _gain, { velocity }) => [
      { type: 'set', value: 0.48 * velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });
  const synthVoice = voice<{ type: OscillatorType; decay: number; cutoff: number; velocity: number }>({
    oscillators: [{ type: ({ type }) => type }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 2.2 },
    gainAutomation: (time, _gain, { decay, velocity }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });
  const acidVoice = voice<{ velocity: number; cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.11 }, { type: 'square', octave: -1, gain: 0.025 }],
    duration: 0.19,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 12 },
    gainAutomation: (time, _gain, { velocity }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });
  const padVoice = voice<{ velocity: number; seconds: number; major: boolean }>({
    oscillators: [
      { type: 'sine', gain: 0.45 },
      { type: 'triangle', octave: 1, gain: 0.13 },
      { type: 'sawtooth', gain: 0.025, detune: ({ major }) => major ? 7 : -7 },
    ],
    duration: ({ seconds }) => seconds,
    filter: { type: 'lowpass', cutoff: ({ major }) => major ? 4200 : 1300 },
    gainAutomation: (time, _gain, { velocity, seconds }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: velocity, time: time + Math.min(0.8, seconds * 0.18) },
      { type: 'linearRamp', value: velocity * 0.68, time: time + seconds * 0.72 },
      { type: 'exponentialRamp', value: 0.001, time: time + seconds },
    ],
  });

  return defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, velocity) {
      const out = musicOut();
      if (!out) return;
      kickVoice.play({ context, time, frequency: 110, velocity, destination: out });
      environment.mix()?.duckAt(time, 0.48, 0.2);
    },
    noise(context, time, velocity, decay, frequency, highpass) {
      const out = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      noise.play({ context, buffer, time, velocity, decay, frequency, filterType: highpass ? 'highpass' : 'bandpass', destination: out, offset: 0.21 });
    },
    synth(context, time, midi, type, decay, cutoff, velocity, player) {
      const out = player ? sfxOut() : musicOut();
      if (!out) return;
      const delay = environment.mix()?.delaySend;
      const reverb = environment.mix()?.reverbSend;
      synthVoice.play({
        context, time, midi, type, decay, cutoff, velocity, destination: out,
        sends: player
          ? [
              ...(delay ? [{ destination: delay, gain: 0.28 }] : []),
              ...(reverb ? [{ destination: reverb, gain: 0.34 }] : []),
            ]
          : undefined,
      });
    },
    acid(context, time, midi, velocity, cutoff) {
      const out = musicOut();
      if (!out) return;
      acidVoice.play({ context, time, midi, velocity, cutoff, destination: out });
    },
    pad(context, time, notes, seconds, velocity, major) {
      const out = musicOut();
      if (!out) return;
      const reverb = environment.mix()?.reverbSend;
      for (const midi of notes) {
        padVoice.play({
          context, time, midi, velocity: velocity / notes.length, seconds, major, destination: out,
          sends: reverb ? [{ destination: reverb, gain: major ? 0.72 : 0.42 }] : undefined,
        });
      }
    },
    arc(context, time, velocity, decay, fromHz, toHz) {
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
          Q: 10,
          frequencyAutomation: [
            { type: 'set', value: fromHz, time },
            { type: 'exponentialRamp', value: Math.max(40, toHz), time: time + decay },
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
    noise: ['velocity', 'decay', 'frequency', 'highpass'],
    synth: ['midi', 'type', 'decay', 'cutoff', 'velocity', 'player'],
    acid: ['midi', 'velocity', 'cutoff'],
    pad: ['notes', 'seconds', 'velocity', 'major'],
    arc: ['velocity', 'decay', 'fromHz', 'toHz'],
  });
}
