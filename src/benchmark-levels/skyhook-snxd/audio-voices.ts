import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Skyhook's kit is built around one idea: the mix IS the altitude. The pad
// takes a voice count and a cutoff so the arrangement can strip it layer by
// layer as the air thins, the wind is a live bed the score fades out at the
// cloud deck, and the vacuum act keeps only what would carry through the
// car's own structure — subs, ticks, and dull metal.

export type SkyTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type SkyVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type WindController = {
  setWind(time: number, level: number, rampSeconds?: number): void;
};

export function installSkyhookWind(context: AudioContext, mix: MixBus): WindController {
  if (!mix.noiseBuffer) return { setWind: () => {} };
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const body = context.createBiquadFilter();
  body.type = 'bandpass';
  body.frequency.value = 330;
  body.Q.value = 0.4;
  const hiss = context.createBiquadFilter();
  hiss.type = 'highpass';
  hiss.frequency.value = 1600;
  const hissGain = context.createGain();
  hissGain.gain.value = 0.16;
  const windGain = context.createGain();
  windGain.gain.value = 0;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.09;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 140;
  lfo.connect(lfoGain).connect(body.frequency);
  const gustLfo = context.createOscillator();
  gustLfo.frequency.value = 0.31;
  const gustGain = context.createGain();
  gustGain.gain.value = 0.035;
  gustLfo.connect(gustGain).connect(windGain.gain);
  source.connect(body).connect(windGain);
  source.connect(hiss).connect(hissGain).connect(windGain);
  windGain.connect(mix.music);
  source.start();
  lfo.start();
  gustLfo.start();
  return {
    setWind(time, level, rampSeconds = 2) {
      windGain.gain.cancelScheduledValues(time);
      windGain.gain.setValueAtTime(windGain.gain.value, time);
      windGain.gain.linearRampToValueAtTime(level, time + rampSeconds);
    },
  };
}

export function createSkyhookVoices(environment: SkyVoiceEnvironment) {
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
    duration: 0.17,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 42, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
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

  const subPulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.62,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.34 * vel, time: time + 0.02 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.62 },
    ],
  });

  const arpTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [{ type: 'triangle', gain: 0.7 }, { type: 'square', gain: 0.28 }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'exponentialRamp', value: Math.max(300, cutoff * 0.3), time: time + 0.13 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.06 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', frequencyRatio: 2.99, gain: 0.14 },
    ],
    duration: 0.7,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.075 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const chimeTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.75 },
      { type: 'sine', frequencyRatio: 2.0, gain: 0.2 },
      { type: 'sine', frequencyRatio: 4.16, gain: 0.06 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const motifTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.6, detune: -6 },
      { type: 'sawtooth', gain: 0.6, detune: 6 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'lowpass', frequency: 640, Q: 1.2 },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.11 * vel, time: time + Math.min(0.3, duration * 0.3) },
      { type: 'set', value: 0.11 * vel, time: time + duration * 0.7 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.7,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 32, time: time + 0.45 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.46 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const playerToneSpec = voice<{ voice: SkyTonalVoice }>({
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
      kickTone.play({ context, time, frequency: 148, vel, destination: output });
      noiseHit(time, 0.05 * vel, 0.005, 'highpass', 2400, output);
      mix.duckAt(time, 0.5, 0.14);
    },

    clap(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.16 * vel, 0.07, 'bandpass', 1500, output);
      noiseHit(time + 0.012, 0.09 * vel, 0.05, 'bandpass', 2400, output);
      clapBody.play({ context, time, frequency: 230, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8600, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.2, 'highpass', 7000, duck);
    },

    // Structure-borne click for the thin-air acts: a dead knuckle on a hull panel.
    tick(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.5 * vel, 0.014, 'bandpass', 3300, duck);
      clapBody.play({ context, time, frequency: 620, vel: vel * 0.4, destination: duck });
    },

    subPulse(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subPulseTone.play({ context, time, midi, vel, destination: duck });
    },

    bass(context, time, midi, vel, drive) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.24;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.27 * vel, time + 0.01);
      subGain.gain.setValueAtTime(0.27 * vel, time + dur * 0.65);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      if (drive > 0.01) {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 3.5;
        filter.frequency.setValueAtTime(260 + drive * 800 * vel, time);
        filter.frequency.exponentialRampToValueAtTime(160, time + dur);
        const warmGain = context.createGain();
        warmGain.gain.setValueAtTime(0, time);
        warmGain.gain.linearRampToValueAtTime(0.085 * vel, time + 0.008);
        warmGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        for (const detune of [-9, 9]) {
          const osc = context.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi + 12);
          osc.detune.value = detune;
          osc.connect(filter);
          osc.start(time);
          osc.stop(time + dur + 0.02);
        }
        filter.connect(warmGain).connect(duck);
      }
    },

    // The altitude pad. `voices` counts detuned layers per note and `cutoff`
    // is the air: wide and warm in the storm, a single narrow sine by vacuum.
    pad(context, time, midis, duration, vel, voicesPerNote, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      const layers = Math.max(1, Math.round(voicesPerNote));
      for (const midi of midis) {
        for (let layer = 0; layer < layers; layer += 1) {
          const detune = layers === 1 ? 0 : (layer / (layers - 1) - 0.5) * 22;
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = layers === 1 ? 'sine' : 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1 + layer * 2.7) * 3;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(cutoff, time);
          lowpass.frequency.linearRampToValueAtTime(cutoff * 0.72, time + duration);
          const level = (0.052 * vel) / (Math.sqrt(midis.length) * Math.sqrt(layers));
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.9, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.5;
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

    bell(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      bellTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.5 }] });
    },

    chime(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      chimeTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.65 }] });
    },

    // Thin-air dread: a minor-second cluster swelling and dying each bar.
    drone(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const [offset, level] of [[0, 1], [1, 0.55], [-12, 0.7]] as const) {
        const osc = context.createOscillator();
        const lowpass = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'triangle';
        osc.frequency.value = midiToFreq(midi + offset);
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 900;
        const peak = 0.055 * vel * level;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(peak, time + duration * 0.6);
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(lowpass).connect(gain);
        gain.connect(mix.duck);
        const send = context.createGain();
        send.gain.value = 0.6;
        gain.connect(send).connect(mix.reverbSend);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    },

    motif(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      motifTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.45 }] });
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
          Q: 1.0,
          frequency: 240,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 6800, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.8, 'highpass', 5000, output);
      noiseHit(time, vel * 0.5, 1.3, 'bandpass', 7600, reverbSend);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.22 * vel, 0.28, 'lowpass', 380, output);
      noiseHit(time, 0.1 * vel, 0.7, 'highpass', 5200, output);
    },

    // The docking latch: a heavy mechanical seat and a pneumatic sigh.
    dockLatch(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 76, vel: vel * 0.8, destination: output });
      noiseHit(time + 0.04, 0.14 * vel, 0.03, 'bandpass', 2100, output);
      noiseHit(time + 0.12, 0.07 * vel, 0.5, 'lowpass', 900, output);
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    tick: ['vel'],
    subPulse: ['midi', 'vel'],
    bass: ['midi', 'vel', 'drive'],
    pad: ['midis', 'duration', 'vel', 'voicesPerNote', 'cutoff'],
    arp: ['midi', 'vel', 'cutoff'],
    bell: ['midi', 'vel'],
    chime: ['midi', 'duration', 'vel'],
    drone: ['midi', 'duration', 'vel'],
    motif: ['midi', 'duration', 'vel'],
    riser: ['duration', 'level'],
    crash: ['vel'],
    impact: ['vel'],
    dockLatch: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voice: SkyTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice, velocity: vel, weight, destination: output, sends: playerSends(0.36, voice.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
