import {
  defineInstruments,
  playNoiseHit,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

type VoiceOptions = {
  context(): AudioContext | null;
  mix(): MixBus | null;
  trace?: AudioTraceSink;
};

export function createSkyhookVoices(options: VoiceOptions) {
  const musicOutput = () => options.mix()?.music ?? null;
  const sfxOutput = () => options.mix()?.sfx ?? null;

  return defineInstruments({ context: options.context, trace: options.trace }, {
    wind(context, time, velocity: number, decay: number, cutoff: number) {
      const mix = options.mix();
      const output = musicOutput();
      if (!mix?.noiseBuffer || !output) return;
      playNoiseHit({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay,
        filterType: 'bandpass',
        frequency: cutoff,
        destination: output,
        offset: (time * 0.731) % 1.5,
      });
    },
    cable(context, time, midi: number, velocity: number, decay: number) {
      const output = musicOutput();
      if (!output) return;
      const frequency = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + decay + 0.05,
        oscillatorType: 'triangle',
        frequency,
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        filter: { type: 'lowpass', frequency: 1800 },
        destination: output,
        sends: options.mix()?.reverbSend ? [{ destination: options.mix()!.reverbSend!, gain: 0.34 }] : undefined,
      });
      playOscillatorVoice({
        context,
        time: time + 0.004,
        stopTime: time + decay * 0.8,
        oscillatorType: 'sine',
        frequency: frequency * 2.006,
        gainAutomation: [
          { type: 'set', value: velocity * 0.22, time: time + 0.004 },
          { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.75 },
        ],
        destination: output,
      });
    },
    panel(context, time, velocity: number, bright: boolean) {
      const mix = options.mix();
      const output = musicOutput();
      if (!mix?.noiseBuffer || !output) return;
      playNoiseHit({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay: bright ? 0.045 : 0.08,
        filterType: bright ? 'highpass' : 'bandpass',
        frequency: bright ? 5200 : 1200,
        destination: output,
        offset: (time * 1.117) % 1.7,
      });
    },
    pressure(context, time, midi: number, velocity: number, decay: number) {
      const output = musicOutput();
      if (!output) return;
      const frequency = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + decay + 0.08,
        oscillatorType: 'sine',
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.72, time: time + decay * 0.55 }],
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        destination: output,
      });
    },
    airChord(context, time, notes: readonly number[], velocity: number, decay: number) {
      const output = musicOutput();
      const reverb = options.mix()?.reverbSend;
      if (!output) return;
      notes.forEach((midi, index) => {
        playOscillatorVoice({
          context,
          time: time + index * 0.012,
          stopTime: time + decay + 0.1,
          oscillatorType: index % 2 === 0 ? 'sine' : 'triangle',
          frequency: midiToFreq(midi),
          detune: (index - notes.length / 2) * 2.2,
          gainAutomation: [
            { type: 'set', value: 0.001, time },
            { type: 'linearRamp', value: velocity / Math.max(1, notes.length), time: time + Math.min(0.45, decay * 0.2) },
            { type: 'exponentialRamp', value: 0.001, time: time + decay },
          ],
          filter: { type: 'lowpass', frequency: 1500 },
          destination: output,
          sends: reverb ? [{ destination: reverb, gain: 0.72 }] : undefined,
        });
      });
    },
    playerTone(context, time, midi: number, velocity: number, decay: number, brightness: number) {
      const output = sfxOutput();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + decay + 0.04,
        oscillatorType: brightness > 0.7 ? 'triangle' : 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        filter: { type: 'lowpass', frequency: 900 + brightness * 4200 },
        destination: output,
        sends: options.mix()?.delaySend ? [{ destination: options.mix()!.delaySend!, gain: 0.22 }] : undefined,
      });
    },
    release(context, time, midi: number, velocity: number) {
      const output = sfxOutput();
      if (!output) return;
      const frequency = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.16,
        oscillatorType: 'sawtooth',
        frequency: frequency * 2,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.5, time: time + 0.13 }],
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
        ],
        filter: { type: 'lowpass', frequency: 2600 },
        destination: output,
      });
    },
    metal(context, time, velocity: number, decay: number, pitch: number) {
      const mix = options.mix();
      const output = sfxOutput();
      if (!mix?.noiseBuffer || !output) return;
      playNoiseHit({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay,
        filterType: 'bandpass',
        frequency: pitch,
        destination: output,
        offset: (time * 1.913) % 1.6,
      });
    },
    alarm(context, time, midi: number, velocity: number, decay: number) {
      const output = sfxOutput();
      if (!output) return;
      const frequency = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + decay + 0.05,
        oscillatorType: 'square',
        frequency,
        frequencyAutomation: [
          { type: 'linearRamp', value: frequency * 1.035, time: time + decay * 0.5 },
          { type: 'linearRamp', value: frequency, time: time + decay },
        ],
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        filter: { type: 'bandpass', frequency: 980, Q: 3.5 },
        destination: output,
      });
    },
  });
}
