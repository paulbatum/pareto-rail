import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type SkyhookAudioEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type SkyhookPlayerVoice = {
  oscillator: OscillatorType;
  cutoff: number;
  gain: number;
  decay: number;
  delay: number;
  reverb: number;
};

export type SkyhookAirBed = {
  setAir(time: number, amount: number): void;
};

export function installSkyhookAirBed(context: AudioContext, mix: MixBus): SkyhookAirBed | null {
  if (!mix.noiseBuffer) return null;
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 75;
  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 2600;
  const gain = context.createGain();
  gain.gain.value = 0.09;
  const lfo = context.createOscillator();
  const lfoGain = context.createGain();
  lfo.frequency.value = 0.13;
  lfoGain.gain.value = 0.025;
  lfo.connect(lfoGain).connect(gain.gain);
  source.connect(highpass).connect(lowpass).connect(gain).connect(mix.music);
  source.start();
  lfo.start();

  return {
    setAir(time, amount) {
      const air = Math.max(0, Math.min(1, amount));
      gain.gain.cancelScheduledValues(time);
      gain.gain.linearRampToValueAtTime(0.006 + air * 0.09, time + 0.12);
      lowpass.frequency.cancelScheduledValues(time);
      lowpass.frequency.linearRampToValueAtTime(480 + air * 2700, time + 0.15);
    },
  };
}

export function createSkyhookVoices(environment: SkyhookAudioEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  function noise(
    time: number,
    velocity: number,
    decay: number,
    frequency: number,
    filterType: BiquadFilterType,
    destination: AudioNode,
  ) {
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    playBufferSourceVoice({
      context,
      buffer,
      time,
      stopTime: time + decay + 0.03,
      filter: { type: filterType, frequency, Q: filterType === 'bandpass' ? 1.4 : 0.7 },
      gainAutomation: [
        { type: 'set', value: Math.max(0.001, velocity), time },
        { type: 'exponentialRamp', value: 0.001, time: time + Math.max(0.018, decay) },
      ],
      destination,
    });
  }

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    airPad(context, time, midis: number[], duration: number, velocity: number, brightness: number) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-5, 5]) {
          const oscillator = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          oscillator.type = 'triangle';
          oscillator.frequency.value = midiToFreq(midi);
          oscillator.detune.value = detune;
          filter.type = 'lowpass';
          filter.frequency.value = 700 + brightness * 2600;
          const level = velocity * 0.055 / Math.sqrt(midis.length / 3);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.65, duration * 0.22));
          gain.gain.setValueAtTime(level, time + Math.max(0.66, duration - 0.8));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          oscillator.connect(filter).connect(gain).connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.54;
          gain.connect(send).connect(mix.reverbSend);
          oscillator.start(time);
          oscillator.stop(time + duration + 0.04);
        }
      }
    },

    hullPulse(context, time, midi: number, velocity: number, duration: number) {
      const output = musicDestination();
      if (!output) return;
      const frequency = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.03,
        oscillatorType: 'sine',
        frequency: frequency * 1.8,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency, time: time + Math.min(0.11, duration * 0.45) }],
        gainAutomation: [
          { type: 'set', value: 0.24 * velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
      environment.mix()?.duckAt(time, 0.82, 0.12);
    },

    rainTick(_context, time, velocity: number, high: number) {
      const output = musicDestination();
      if (!output) return;
      noise(time, velocity * 0.1, 0.018 + high * 0.025, 2400 + high * 6800, 'highpass', output);
    },

    cableTick(context, time, midi: number, velocity: number, ring: number) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      const frequency = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.09 + ring * 0.22,
        oscillatorType: 'triangle',
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * (0.65 + ring * 0.1), time: time + 0.07 }],
        gainAutomation: [
          { type: 'set', value: 0.07 * velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.08 + ring * 0.2 },
        ],
        filter: { type: 'bandpass', frequency: 1100 + ring * 2500, Q: 3.5 },
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.42 }],
      });
    },

    beacon(context, time, midi: number, duration: number, velocity: number) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.03,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: 0.085 * velocity, time: time + Math.min(0.04, duration * 0.15) },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.reverbSend, gain: 0.62 }],
      });
    },

    cableGroan(context, time, midi: number, duration: number, velocity: number) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const ratio of [0.5, 1, 1.497]) {
        const frequency = midiToFreq(midi) * ratio;
        playOscillatorVoice({
          context,
          time,
          stopTime: time + duration + 0.05,
          oscillatorType: ratio === 1 ? 'sawtooth' : 'triangle',
          frequency: frequency * 0.82,
          frequencyAutomation: [{ type: 'exponentialRamp', value: frequency, time: time + duration * 0.65 }],
          gainAutomation: [
            { type: 'set', value: 0.001, time },
            { type: 'linearRamp', value: velocity * (ratio === 1 ? 0.075 : 0.045), time: time + duration * 0.32 },
            { type: 'exponentialRamp', value: 0.001, time: time + duration },
          ],
          filter: { type: 'lowpass', frequency: 650 + velocity * 900, Q: 2 },
          destination: mix.duck,
          sends: [{ destination: mix.reverbSend, gain: 0.56 }],
        });
      }
    },

    lift(context, time, midi: number, duration: number, velocity: number) {
      const output = musicDestination();
      if (!output) return;
      const start = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.04,
        oscillatorType: 'sine',
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: start * 4, time: time + duration }],
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'linearRamp', value: 0.09 * velocity, time: time + duration * 0.72 },
          { type: 'linearRamp', value: 0, time: time + duration },
        ],
        destination: output,
      });
      const buffer = environment.mix()?.noiseBuffer;
      if (buffer) {
        playBufferSourceVoice({
          context,
          buffer,
          time,
          stopTime: time + duration + 0.04,
          loop: true,
          filter: {
            type: 'bandpass',
            Q: 1.2,
            frequency: 260,
            frequencyAutomation: [{ type: 'exponentialRamp', value: 6400, time: time + duration }],
          },
          gainAutomation: [
            { type: 'set', value: 0.001, time },
            { type: 'exponentialRamp', value: 0.08 * velocity, time: time + duration * 0.88 },
            { type: 'linearRamp', value: 0, time: time + duration },
          ],
          destination: output,
        });
      }
    },

    impact(context, time, velocity: number) {
      const output = musicDestination();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.72,
        oscillatorType: 'sine',
        frequency: 118,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 29, time: time + 0.55 }],
        gainAutomation: [
          { type: 'set', value: 0.42 * velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
        ],
        destination: output,
      });
      noise(time, 0.16 * velocity, 0.32, 460, 'lowpass', output);
      environment.mix()?.duckAt(time, 0.42, 0.38);
    },
  }, {
    airPad: ['midis', 'duration', 'velocity', 'brightness'],
    hullPulse: ['midi', 'velocity', 'duration'],
    rainTick: ['velocity', 'high'],
    cableTick: ['midi', 'velocity', 'ring'],
    beacon: ['midi', 'duration', 'velocity'],
    cableGroan: ['midi', 'duration', 'velocity'],
    lift: ['midi', 'duration', 'velocity'],
    impact: ['velocity'],
  });

  const playerToneVoice = voice<{ timbre: SkyhookPlayerVoice }>({
    oscillators: [{ type: ({ timbre }) => timbre.oscillator, gain: ({ timbre }) => timbre.gain }],
    duration: ({ timbre }) => timbre.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ timbre }) => timbre.cutoff },
    envelope: { decay: ({ timbre }) => timbre.decay },
  });

  function playerSends(delay: number, reverb: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delay > 0) sends.push({ destination: mix.delaySend, gain: delay });
    if (mix?.reverbSend && reverb > 0) sends.push({ destination: mix.reverbSend, gain: reverb });
    return sends;
  }

  function playerTone(time: number, midi: number, timbre: SkyhookPlayerVoice, velocity = 1, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, velocity, oscillator: timbre.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneVoice.play({
      context,
      time,
      midi,
      timbre,
      velocity,
      weight,
      destination: output,
      sends: playerSends(timbre.delay, timbre.reverb),
    });
  }

  function playerNoise(time: number, velocity: number, decay: number, frequency: number, type: BiquadFilterType = 'highpass') {
    const output = sfxDestination();
    if (!output) return;
    noise(time, velocity, decay, frequency, type, output);
  }

  return { ...instruments, playerTone, playerNoise, playerSends };
}
