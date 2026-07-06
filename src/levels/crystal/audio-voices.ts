import {
  defineInstruments,
  playBufferSourceVoice,
  playNoiseHit,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type CrystalKillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number };

export type CrystalVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createCrystalVoices(environment: CrystalVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

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
    playNoiseHit({
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

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.2,
        oscillatorType: 'sine',
        frequency: 150,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 43, time: time + 0.11 }],
        gainAutomation: [
          { type: 'set', value: 0.5 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
        ],
        destination: output,
      });
      noiseHit(time, 0.1 * vel, 0.004, 'highpass', 1200, output);
      mix.duckAt(time, 0.42, 0.26);
    },

    clap(_context, time) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.16, 0.05, 'bandpass', 1900, output);
      noiseHit(time + 0.013, 0.1, 0.07, 'bandpass', 2200, output);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 7200, duck);
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.28,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: {
          type: 'lowpass',
          Q: 6,
          frequencyAutomation: [
            { type: 'set', value: 200 + vel * 800, time },
            { type: 'exponentialRamp', value: 160, time: time + 0.2 },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: 0.3 * vel, time: time + 0.006 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
        ],
        destination: duck,
      });
    },

    pad(context, time, midis, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + duration + 0.05,
            oscillatorType: 'sawtooth',
            frequency: midiToFreq(midi),
            detune,
            filter: {
              type: 'lowpass',
              frequencyAutomation: [
                { type: 'set', value: 420, time },
                { type: 'linearRamp', value: 760, time: time + duration * 0.5 },
                { type: 'linearRamp', value: 420, time: time + duration },
              ],
            },
            gainAutomation: [
              { type: 'set', value: 0, time },
              { type: 'linearRamp', value: 0.045, time: time + 0.5 },
              { type: 'set', value: 0.045, time: time + duration - 0.4 },
              { type: 'linearRamp', value: 0, time: time + duration },
            ],
            destination: [mix.duck, mix.delaySend],
          });
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.15,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2600 },
        gainAutomation: [
          { type: 'set', value: 0.16 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
        ],
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
          Q: 1.2,
          frequencyAutomation: [
            { type: 'set', value: 300, time },
            { type: 'exponentialRamp', value: 6400, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.14, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },
  }, {
    kick: ['vel'],
    clap: [],
    hat: ['vel', 'decay'],
    bass: ['midi', 'vel'],
    pad: ['midis', 'duration'],
    arp: ['midi', 'vel'],
    riser: ['duration'],
  });

  function playerSends(delayGain: number) {
    const delaySend = environment.mix()?.delaySend;
    return delaySend && delayGain > 0 ? [{ destination: delaySend, gain: delayGain }] : [];
  }

  function playerTone(time: number, midi: number, voice: CrystalKillVoice, vel: number, weight = 1) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + voice.decay + 0.05,
      oscillatorType: voice.oscillator,
      frequency: midiToFreq(midi),
      filter: { type: 'lowpass', frequency: voice.cutoff },
      gainAutomation: [
        { type: 'set', value: voice.gain * vel * weight, time },
        { type: 'exponentialRamp', value: 0.001, time: time + voice.decay },
      ],
      destination: output,
      sends: playerSends(0.45),
    });
  }

  return {
    ...instruments,
    arpNote: instruments.arp,
    noiseHit,
    playerSends,
    playerTone,
  };
}
