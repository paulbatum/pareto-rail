import { voice } from '../../engine/audio-voices';
import type { MixBus } from '../../engine/audio-kit';

// Additive pipe ranks: fundamental, octave, twelfth, and fifteenth.
const pipe = voice<{ length: number; brightness: number }>({
  oscillators: [
    { type: 'sine', gain: 0.7 },
    { type: 'sine', octave: 1, gain: 0.28 },
    { type: 'sine', frequencyRatio: 3, gain: ({ brightness }) => brightness * 0.2 },
    { type: 'sine', octave: 2, gain: ({ brightness }) => brightness * 0.13 },
  ],
  duration: ({ length }) => length + 0.3,
  gainAutomation: (time, gain, { length }) => [
    { type: 'set', value: 0.0001, time },
    { type: 'linearRamp', value: gain, time: time + 0.045 },
    { type: 'set', value: gain * 0.92, time: time + Math.max(0.05, length) },
    { type: 'exponentialRamp', value: 0.0001, time: time + length + 0.3 },
  ],
});
const choir = voice<{ length: number }>({
  oscillators: [{ type: 'triangle', gain: 0.5, detune: -5 }, { type: 'triangle', gain: 0.5, detune: 5 }],
  filter: { type: 'bandpass', cutoff: 880, Q: 0.8 },
  duration: ({ length }) => length + 0.8,
  gainAutomation: (time, gain, { length }) => [
    { type: 'set', value: 0.0001, time }, { type: 'linearRamp', value: gain, time: time + 0.5 },
    { type: 'set', value: gain * 0.8, time: time + length }, { type: 'exponentialRamp', value: 0.0001, time: time + length + 0.8 },
  ],
});
const bell = voice({
  oscillators: [{ type: 'sine', gain: 0.65 }, { type: 'sine', frequencyRatio: 2, gain: 0.2 }, { type: 'sine', frequencyRatio: 2.76, gain: 0.04 }, { type: 'sine', frequencyRatio: 4, gain: 0.08 }],
  duration: 3.4, envelope: { attack: 0.012, decay: 3.3 },
});
export function playOrgan(context: AudioContext, mix: MixBus, time: number, midi: number, length: number, gain: number, brightness: number, player: boolean) {
  pipe.play({ context, time, midi, length, brightness, gain, destination: player ? mix.sfx : mix.music,
    sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.48 }] : undefined });
}
export function playChoir(context: AudioContext, mix: MixBus, time: number, midi: number, length: number, gain: number) {
  choir.play({ context, time, midi, length, gain, destination: mix.music, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.7 }] : undefined });
}
export function playBell(context: AudioContext, mix: MixBus, time: number, midi: number, gain: number) {
  bell.play({ context, time, midi, gain, destination: mix.music, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.7 }] : undefined });
}
