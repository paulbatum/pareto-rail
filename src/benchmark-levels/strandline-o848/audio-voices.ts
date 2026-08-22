import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Underwater synthesis: everything is rounded, softened, and slightly delayed
// by the water. Percussion is the jelly's own pulse and moving water rather
// than drums; melody lives in glassy bells and warm pads.

export type StrandlineTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  sparkle: number;
  reverb: number;
};

export type StrandlineVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function installStrandlineDeep(context: AudioContext, mix: MixBus) {
  // The deep: a very slow, very low pressure swell under everything.
  if (!mix.noiseBuffer) return;
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 65;
  filter.Q.value = 0.5;
  const gain = context.createGain();
  gain.gain.value = 0.14;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain).connect(gain.gain);
  source.connect(filter).connect(gain).connect(mix.music);
  source.start();
  lfo.start();
}

export function createStrandlineVoices(environment: StrandlineVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'bandpass', frequency: 900, velocity: 1, decay: 0.08 });

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
      offset: Math.random() * 1.5,
    });
  }

  // The pulse: the animal's heartbeat — a soft, deep contraction.
  const pulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.32,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [
      { type: 'exponentialRamp', value: 34, time: time + 0.24 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.4 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  // Moving water: a soft bandpassed wash instead of a snare.
  const washVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.12,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 90, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.16 },
      { type: 'sine', octave: 2, gain: 0.05 },
    ],
    duration: 0.5,
    stopPadding: 0.06,
    envelope: { decay: 0.5 },
  });

  const subTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.4,
    stopPadding: 0.05,
    envelope: {
      attack: 0.02,
      decay: 0.38,
    },
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      frequency: 2400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 800, time: time + 0.14 }],
    },
    envelope: { decay: 0.16 },
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 2200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 420, time: time + 0.26 }],
    },
    envelope: { decay: 0.3 },
  });

  const alarmTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sine' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency, { duration }) => [
      { type: 'exponentialRamp', value: frequency * 1.5, time: time + duration * 0.8 },
    ],
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.09, time: time + duration * 0.7 },
      { type: 'linearRamp', value: 0.001, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.9,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.6 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
    ],
  });

  const playerToneSpec = voice<{ voice: StrandlineTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    pulse(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      pulseTone.play({ context, time, frequency: 62, vel, destination: output });
      noiseHit(time, 0.03 * vel, 0.05, 'lowpass', 300, output);
      mix.duckAt(time, 0.35, 0.3);
    },

    wash(context, time, vel, decay = 0.3) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.16 * vel, decay, 'bandpass', 700, output);
      washVoice.play({ context, time, frequency: 160, vel, destination: output });
    },

    tick(_context, time, vel, decay = 0.03) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'bandpass', 7600, duck);
    },

    sub(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subTone.play({ context, time, midi, vel, destination: duck });
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-8, 8]) {
          const osc = context.createOscillator();
          const breath = context.createBiquadFilter();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 3;
          breath.type = 'bandpass';
          breath.frequency.setValueAtTime(520, time);
          breath.frequency.linearRampToValueAtTime(860, time + duration * 0.5);
          breath.frequency.linearRampToValueAtTime(520, time + duration);
          breath.Q.value = 0.8;
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 1700;
          const level = (0.042 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(1.2, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.4, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(breath).connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.7;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
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
        sends: [
          { destination: mix.delaySend, gain: 0.5 },
          { destination: mix.reverbSend!, gain: 0.4 },
        ],
      });
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.45 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.4 }] });
        }
      }
    },

    lead(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1900, time);
      filter.frequency.linearRampToValueAtTime(1200, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.075 * vel, time + 0.04);
      gain.gain.setValueAtTime(0.075 * vel, time + Math.max(0.04, duration - 0.12));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.03);
      const vibrato = context.createOscillator();
      const vibratoGain = context.createGain();
      vibrato.frequency.value = 4.6;
      vibratoGain.gain.setValueAtTime(0, time);
      vibratoGain.gain.linearRampToValueAtTime(5, time + Math.min(0.5, duration * 0.6));
      for (const [type, detune] of [['sawtooth', -6], ['triangle', 8]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        vibrato.connect(vibratoGain).connect(osc.detune);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.06);
      }
      vibrato.start(time);
      vibrato.stop(time + duration + 0.06);
      filter.connect(gain);
      gain.connect(mix.duck);
      const echo = context.createGain();
      echo.gain.value = 0.55;
      gain.connect(echo).connect(mix.delaySend);
      const hall = context.createGain();
      hall.gain.value = 0.35;
      gain.connect(hall).connect(mix.reverbSend);
    },

    alarm(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({
        context,
        time,
        midi,
        duration,
        destination: mix.duck,
        sends: [{ destination: mix.reverbSend, gain: 0.55 }],
      });
    },

    riser(context, time, duration, level) {
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
          frequency: 220,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 5200, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.2 * vel, 0.4, 'lowpass', 380, output);
    },

    bloom(context, time, vel) {
      // A soft chord-bloom used for the bell reveal and the clean-water turn.
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      noiseHit(time, 0.12 * vel, 0.9, 'bandpass', 2400, mix.reverbSend);
      instruments.impact(time, 0.5 * vel);
    },
  }, {
    pulse: ['vel'],
    wash: ['vel', 'decay'],
    tick: ['vel', 'decay'],
    sub: ['midi', 'vel'],
    pad: ['midis', 'duration', 'vel'],
    bell: ['midi', 'vel'],
    arp: ['midi', 'vel'],
    stab: ['midis', 'vel'],
    lead: ['midi', 'duration', 'vel'],
    alarm: ['midi', 'duration'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    bloom: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, timbre: StrandlineTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: timbre.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: timbre, velocity: vel, weight, destination: output, sends: playerSends(0.45, timbre.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}

export type StrandlineVoices = ReturnType<typeof createStrandlineVoices>;
