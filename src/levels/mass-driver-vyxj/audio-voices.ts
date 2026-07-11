import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Mass Driver's sound is electric, not orchestral: everything is oscillators
// under pressure. The gun itself is the lead instrument — a persistent hum
// (sub sine + coil-whine saws through a resonant lowpass) whose pitch the
// arrangement steps up a two-octave ladder across the run.

export type MassDriverTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type HumController = {
  setNote(time: number, midi: number, brightness: number): void;
  setLevel(time: number, level: number, ramp?: number): void;
};

export const HUM_IDLE_LEVEL = 0.05;
export const HUM_RUN_LEVEL = 0.17;

export function installMassDriverHum(context: AudioContext, mix: MixBus): HumController {
  const whines: OscillatorNode[] = [];
  const humGain = context.createGain();
  humGain.gain.value = HUM_IDLE_LEVEL;
  // Through the duck bus so every kick pumps the gun's own voice.
  humGain.connect(mix.duck);

  const sub = context.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = midiToFreq(28);
  const subGain = context.createGain();
  subGain.gain.value = 0.72;
  sub.connect(subGain).connect(humGain);
  sub.start();

  const whineFilter = context.createBiquadFilter();
  whineFilter.type = 'lowpass';
  whineFilter.frequency.value = 340;
  whineFilter.Q.value = 5.5;
  const whineGain = context.createGain();
  whineGain.gain.value = 0.16;
  whineFilter.connect(whineGain).connect(humGain);
  for (const detune of [-9, 9]) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(28 + 24);
    osc.detune.value = detune;
    osc.connect(whineFilter);
    osc.start();
    whines.push(osc);
  }

  const subFreq = (midi: number) => midiToFreq(midi);
  return {
    setNote(time, midi, brightness) {
      // setTargetAtTime needs no anchor point, so repeated servo steps stay smooth.
      sub.frequency.setTargetAtTime(subFreq(midi), time, 0.11);
      for (const osc of whines) osc.frequency.setTargetAtTime(subFreq(midi + 24), time, 0.11);
      whineFilter.frequency.setTargetAtTime(340 + brightness * 3800, time, 0.4);
    },
    setLevel(time, level, ramp = 0.5) {
      humGain.gain.setTargetAtTime(level, time, ramp / 3);
    },
  };
}

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment, humController: () => HumController | null) {
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
    duration: 0.16,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 43, time: time + 0.085 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.55 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const subBassTone = voice<{ vel: number; dur: number }>({
    oscillators: [{ type: 'sine', gain: 0.3 }, { type: 'triangle', gain: 0.1 }],
    duration: ({ dur }) => dur,
    stopPadding: 0.03,
    gainAutomation: (time, gain, { dur }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: gain, time: time + 0.009 },
      { type: 'set', value: gain, time: time + dur * 0.6 },
      { type: 'exponentialRamp', value: 0.001, time: time + dur },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 3000,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 480, time: time + 0.2 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.045 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const arpTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      Q: 3,
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.06 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
    ],
  });

  const alarmTone = voice<{ duration: number; vel: number }>({
    oscillators: [{ type: 'square', gain: 0.5 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'bandpass', frequency: 1150, Q: 2.4 },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.05 * vel, time: time + 0.03 },
      { type: 'set', value: 0.05 * vel, time: time + duration * 0.7 },
      { type: 'linearRamp', value: 0.001, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.8,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 27, time: time + 0.55 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.55 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
    ],
  });

  const clangTone = voice<{ vel: number; decay: number }>({
    // Inharmonic pair reads as struck metal — the interlock housings.
    oscillators: [
      { type: 'square', gain: 0.16 },
      { type: 'square', gain: 0.11, frequencyRatio: 2.756 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    filter: { type: 'bandpass', frequency: 1900, Q: 1.1 },
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.08 * vel, 0.005, 'highpass', 2200, output);
      mix.duckAt(time, 0.42, 0.15);
    },

    clap(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      for (const [offset, level] of [[0, 0.85], [0.011, 0.6], [0.024, 1]] as const) {
        noiseHit(time + offset, 0.16 * vel * level, 0.05, 'bandpass', 1500, output);
      }
      noiseHit(time + 0.024, 0.07 * vel, 0.16, 'bandpass', 1150, output);
      void context;
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 9200, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.17, 'highpass', 7800, duck);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.85, 'highpass', 5000, output);
      noiseHit(time, vel * 0.5, 1.3, 'bandpass', 7600, reverbSend);
    },

    subBass(context, time, midi, vel, dur) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subBassTone.play({ context, time, midi, vel, dur, velocity: vel, destination: duck });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.3 }] });
        }
      }
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 3;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(700, time);
          lowpass.frequency.linearRampToValueAtTime(1400, time + duration * 0.5);
          lowpass.frequency.linearRampToValueAtTime(700, time + duration);
          const level = (0.038 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.6, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(0.8, duration * 0.3));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.55;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arp(context, time, midi, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, cutoff, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.4 }] });
    },

    // The payload crosses an accelerator ring on every beat: this is that
    // crossing. It gets brighter and more pitched as the barrel heats.
    ringPass(context, time, heat, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, (0.045 + heat * 0.05) * vel, 0.014 + heat * 0.012, 'highpass', 5200 + heat * 3800, output);
      const ping = context.createOscillator();
      const pingGain = context.createGain();
      ping.type = 'sine';
      ping.frequency.value = 780 + heat * 2400;
      pingGain.gain.setValueAtTime(0.028 * vel * (0.5 + heat), time);
      pingGain.gain.exponentialRampToValueAtTime(0.001, time + 0.07 + heat * 0.05);
      ping.connect(pingGain).connect(output);
      ping.start(time);
      ping.stop(time + 0.16);
    },

    alarm(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      // Two-tone klaxon: the note and its minor third above, alternating.
      alarmTone.play({ context, time, midi, duration: duration / 2, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.4 }] });
      alarmTone.play({ context, time: time + duration / 2, midi: midi + 3, duration: duration / 2, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.4 }] });
    },

    clang(context, time, midi, vel, decay) {
      const output = sfxDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output) return;
      clangTone.play({
        context,
        time,
        midi,
        vel,
        decay,
        velocity: vel,
        destination: output,
        sends: reverbSend ? [{ destination: reverbSend, gain: 0.45 }] : undefined,
      });
      noiseHit(time, 0.14 * vel, 0.06, 'bandpass', 3400, output);
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
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 115, vel, destination: output });
      noiseHit(time, 0.28 * vel, 0.32, 'lowpass', 380, output);
      instruments.crash(time, 0.18 * vel);
    },

    // Weightless space after the muzzle: a very high, slow, reverb-drenched cluster.
    shimmer(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const [index, midi] of midis.entries()) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.value = midiToFreq(midi);
        const level = 0.026 * vel * (1 - index * 0.1);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + Math.min(1.2, duration * 0.3));
        gain.gain.setValueAtTime(level, time + duration * 0.6);
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(gain);
        gain.connect(mix.duck);
        const send = context.createGain();
        send.gain.value = 0.85;
        gain.connect(send).connect(mix.reverbSend);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    },

    hum(_context, time, midi, brightness) {
      humController()?.setNote(time, midi, brightness);
    },

    humLevel(_context, time, level, ramp) {
      humController()?.setLevel(time, level, ramp);
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    crash: ['vel'],
    subBass: ['midi', 'vel', 'dur'],
    stab: ['midis', 'vel'],
    pad: ['midis', 'duration', 'vel'],
    arp: ['midi', 'vel', 'cutoff'],
    ringPass: ['heat', 'vel'],
    alarm: ['midi', 'duration', 'vel'],
    clang: ['midi', 'vel', 'decay'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    shimmer: ['midis', 'duration', 'vel'],
    hum: ['midi', 'brightness'],
    humLevel: ['level', 'ramp'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  const playerToneSpec = voice<{ voice: MassDriverTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  function playerTone(time: number, midi: number, tonalVoice: MassDriverTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonalVoice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: tonalVoice, velocity: vel, weight, destination: output, sends: playerSends(0.4, tonalVoice.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
