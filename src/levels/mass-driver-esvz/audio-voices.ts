import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Mass Driver's instrument rack. The gun is the instrument: `hum` is the
// barrel itself (detuned saws over a sub, brightness driven by the charge),
// `coilTick` is the metallic ring-crossing chime that fires on every beat,
// and the drums are a locked techno pulse that never breaks until the muzzle.

export type MdTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type MdVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createMassDriverVoices(environment: MdVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

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
      offset: Math.random() * 1.5,
    });
  }

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.14,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 42, time: time + 0.085 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.55 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const clapBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.06,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 160, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.1 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.06 },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 3100,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 800, time: time + 0.085 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.24,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 3400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 480, time: time + 0.2 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  // The charge klaxon: a hard bandpassed saw whoop that climbs each bar.
  const alarmTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'bandpass',
      Q: 2.5,
      frequency: 700,
      frequencyAutomation: (time, { duration }) => [{ type: 'exponentialRamp', value: 2100, time: time + duration * 0.7 }],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.085, time: time + duration * 0.55 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.8,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.55 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.52 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
    ],
  });

  const playerToneSpec = voice<{ voice: MdTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.08 * vel, 0.004, 'highpass', 1600, output);
      mix.duckAt(time, 0.45, 0.14);
    },

    clap(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.17 * vel, 0.07, 'bandpass', 1900, output);
      noiseHit(time + 0.011, 0.09 * vel, 0.05, 'bandpass', 2500, output);
      clapBody.play({ context, time, frequency: 230, vel, destination: output });
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.19 * vel, 0.07, 'bandpass', 1800, output);
      noiseHit(time, 0.1 * vel, 0.028, 'highpass', 5400, output);
      clapBody.play({ context, time, frequency: 210, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8600, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.16, 'highpass', 7600, duck);
    },

    ride(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.12, 'bandpass', 10200, duck);
    },

    // The barrel: sub sine root + two detuned saws through a lowpass that the
    // charge drives open. Scheduled once per bar with overlap so it reads as a
    // continuous drone whose pitch steps up the climb.
    hum(context, time, midi, duration, vel, brightness) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.2 * vel, time + duration * 0.18);
      subGain.gain.setValueAtTime(0.2 * vel, time + duration * 0.8);
      subGain.gain.linearRampToValueAtTime(0, time + duration);
      sub.connect(subGain).connect(mix.duck);
      sub.start(time);
      sub.stop(time + duration + 0.03);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4.5;
      filter.frequency.setValueAtTime(140 + brightness * 1500, time);
      filter.frequency.linearRampToValueAtTime(140 + brightness * 2100, time + duration);
      const sawGain = context.createGain();
      sawGain.gain.setValueAtTime(0, time);
      sawGain.gain.linearRampToValueAtTime(0.075 * vel, time + duration * 0.2);
      sawGain.gain.setValueAtTime(0.075 * vel, time + duration * 0.8);
      sawGain.gain.linearRampToValueAtTime(0, time + duration);
      for (const detune of [-11, 11]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.03);
      }
      filter.connect(sawGain).connect(mix.duck);
    },

    // The ring you just passed through: a struck-coil chime, brighter as the
    // barrel heats. Fires on every beat — the crossing cadence made audible.
    coilTick(context, time, midi, vel, heat) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.05 * vel, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09 + heat * 0.06);
      for (const ratio of [1, 2.76 + heat * 0.6]) {
        const osc = context.createOscillator();
        osc.type = ratio === 1 ? 'triangle' : 'sine';
        osc.frequency.value = midiToFreq(midi) * ratio;
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + 0.2);
      }
      gain.connect(mix.duck);
      const send = context.createGain();
      send.gain.value = 0.3;
      gain.connect(send).connect(mix.delaySend);
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.19;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(260 + 800 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(150, time + dur);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.3 * vel, time + 0.007);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.value = midiToFreq(midi);
      osc.connect(filter).connect(gain).connect(duck);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.4 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.32 }] });
        }
      }
    },

    alarm(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.4 }] });
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
          frequency: 300,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 8200, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.28 * vel, 0.3, 'lowpass', 380, output);
      noiseHit(time, 0.16 * vel, 0.8, 'highpass', 4200, output);
    },

    // Open space after the muzzle: a glassy, airless high cluster.
    shimmer(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = Math.sin(midi * 5.1) * 6;
        const level = (0.035 * vel) / Math.sqrt(midis.length / 4);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + Math.min(0.9, duration * 0.3));
        gain.gain.setValueAtTime(level, time + duration - Math.min(1.2, duration * 0.3));
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(gain);
        gain.connect(mix.duck);
        const send = context.createGain();
        send.gain.value = 0.7;
        gain.connect(send).connect(mix.reverbSend);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    snare: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    ride: ['vel'],
    hum: ['midi', 'duration', 'vel', 'brightness'],
    coilTick: ['midi', 'vel', 'heat'],
    bass: ['midi', 'vel'],
    arp: ['midi', 'vel'],
    stab: ['midis', 'vel'],
    alarm: ['midi', 'duration'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    shimmer: ['midis', 'duration', 'vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voiceSpec: MdTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voiceSpec.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: voiceSpec, velocity: vel, weight, destination: output, sends: playerSends(0.4, voiceSpec.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
