import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Strandline's kit is built around one idea: the mix IS the water. A filtered
// current bed runs under everything and clears as the animal revives, the
// percussion is the jelly's own heartbeat plus small wet ticks, and every
// melodic voice is round — sines, triangles, slow attacks — so the parasites'
// dry buzzes (menace, skitter, reject) are the only hard edges in the ocean.

export type StrandTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  sparkle: number;
  reverb: number;
};

export type StrandVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type WaterController = {
  setWater(time: number, level: number, rampSeconds?: number): void;
};

// The current bed: looped noise breathing through a low bandpass, with a
// faint high hiss of suspended particles. The score fades it like weather.
export function installStrandlineWater(context: AudioContext, mix: MixBus): WaterController {
  if (!mix.noiseBuffer) return { setWater: () => {} };
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const body = context.createBiquadFilter();
  body.type = 'bandpass';
  body.frequency.value = 210;
  body.Q.value = 0.5;
  const hiss = context.createBiquadFilter();
  hiss.type = 'highpass';
  hiss.frequency.value = 2600;
  const hissGain = context.createGain();
  hissGain.gain.value = 0.045;
  const waterGain = context.createGain();
  waterGain.gain.value = 0;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain).connect(body.frequency);
  const swellLfo = context.createOscillator();
  swellLfo.frequency.value = 0.17;
  const swellGain = context.createGain();
  swellGain.gain.value = 0.03;
  swellLfo.connect(swellGain).connect(waterGain.gain);
  source.connect(body).connect(waterGain);
  source.connect(hiss).connect(hissGain).connect(waterGain);
  waterGain.connect(mix.music);
  source.start();
  lfo.start();
  swellLfo.start();
  return {
    setWater(time, level, rampSeconds = 2) {
      waterGain.gain.cancelScheduledValues(time);
      waterGain.gain.setValueAtTime(waterGain.gain.value, time);
      waterGain.gain.linearRampToValueAtTime(level, time + rampSeconds);
    },
  };
}

export function createStrandlineVoices(environment: StrandVoiceEnvironment) {
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

  // A round, deep kick — more felt than heard, like pressure.
  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.22,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 38, time: time + 0.14 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.44 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  // The animal's heartbeat: one soft systolic thump. The score plays it in
  // lub-dub pairs; its calm return at the end is the resolution.
  const heartTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.3,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 30, time: time + 0.22 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.4 * vel, time: time + 0.025 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const subPulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.6,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.32 * vel, time: time + 0.02 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
    ],
  });

  // Water drop: a sine blip whose pitch swells upward — the "bloink".
  const dropletTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [{ type: 'sine', gain: 0.8 }, { type: 'triangle', gain: 0.25 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 0.72, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.07 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.085 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', frequencyRatio: 2.99, gain: 0.12 },
    ],
    duration: 0.9,
    stopPadding: 0.06,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const chimeTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.72 },
      { type: 'sine', frequencyRatio: 2.0, gain: 0.2 },
      { type: 'sine', frequencyRatio: 4.16, gain: 0.05 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.085 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  // The bell-reveal gong: deep, slightly inharmonic, very long — a moon made
  // of glass struck once.
  const gongTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.7 },
      { type: 'sine', frequencyRatio: 1.48, gain: 0.28 },
      { type: 'sine', frequencyRatio: 2.76, gain: 0.14 },
      { type: 'triangle', frequencyRatio: 0.5, gain: 0.4 },
    ],
    duration: 3.4,
    stopPadding: 0.1,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.24 * vel, time: time + 0.04 },
      { type: 'exponentialRamp', value: 0.001, time: time + 3.4 },
    ],
  });

  // Boss dread: two detuned saws under a closed lowpass, swelling and dying.
  const menaceTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.55, detune: -7 },
      { type: 'sawtooth', gain: 0.55, detune: 7 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'lowpass', frequency: 480, Q: 1.4 },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.12 * vel, time: time + Math.min(0.4, duration * 0.3) },
      { type: 'set', value: 0.12 * vel, time: time + duration * 0.7 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.8,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 30, time: time + 0.5 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.44 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
    ],
  });

  const playerToneSpec = voice<{ voice: StrandTonalVoice }>({
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
      kickTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.02 * vel, 0.008, 'lowpass', 900, output);
      mix.duckAt(time, 0.62, 0.16);
    },

    heart(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      // Lub… dub: the second, softer thump rides a fixed 260 ms behind.
      heartTone.play({ context, time, frequency: 62, vel, destination: duck });
      heartTone.play({ context, time: time + 0.26, frequency: 54, vel: vel * 0.6, destination: duck });
    },

    shaker(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'bandpass', 3400, duck);
    },

    snap(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.6 * vel, 0.03, 'bandpass', 1700, duck);
      noiseHit(time + 0.01, 0.3 * vel, 0.06, 'bandpass', 2600, duck);
      dropletTone.play({ context, time, frequency: 300, vel: vel * 0.5, cutoff: 2200, destination: duck });
    },

    subPulse(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subPulseTone.play({ context, time, midi, vel, destination: duck });
    },

    bass(context, time, midi, vel, drive) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.34;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.26 * vel, time + 0.015);
      subGain.gain.setValueAtTime(0.26 * vel, time + dur * 0.6);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      if (drive > 0.01) {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 2.5;
        filter.frequency.setValueAtTime(220 + drive * 700 * vel, time);
        filter.frequency.exponentialRampToValueAtTime(140, time + dur);
        const warmGain = context.createGain();
        warmGain.gain.setValueAtTime(0, time);
        warmGain.gain.linearRampToValueAtTime(0.06 * vel, time + 0.01);
        warmGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        for (const detune of [-8, 8]) {
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

    // The light pad. `voicesPerNote` counts detuned layers and `cutoff` is the
    // clarity of the water: closed and dark in the drift, wide open for the
    // bell, warm and clear for the release.
    pad(context, time, midis, duration, vel, voicesPerNote, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      const layers = Math.max(1, Math.round(voicesPerNote));
      for (const midi of midis) {
        for (let layer = 0; layer < layers; layer += 1) {
          const detune = layers === 1 ? 0 : (layer / (layers - 1) - 0.5) * 18;
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = layers === 1 ? 'sine' : 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 4.7 + layer * 2.3) * 3;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(cutoff, time);
          lowpass.frequency.linearRampToValueAtTime(cutoff * 0.7, time + duration);
          const level = (0.05 * vel) / (Math.sqrt(midis.length) * Math.sqrt(layers));
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(1.1, duration * 0.35));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.2, duration * 0.35));
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

    droplet(context, time, midi, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      dropletTone.play({ context, time, midi, vel, cutoff, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.45 }] });
    },

    bell(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      bellTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.55 }] });
    },

    chime(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      chimeTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.7 }] });
    },

    gong(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      gongTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.8 }] });
      noiseHit(time, 0.05 * vel, 1.6, 'highpass', 6400, mix.reverbSend);
    },

    menace(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      menaceTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.4 }] });
    },

    skitter(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.4 * vel, 0.016, 'bandpass', 5200, duck);
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
          Q: 1.1,
          frequency: 180,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 4800, time: time + duration }],
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
      noiseHit(time, vel * 0.7, 0.7, 'highpass', 4600, output);
      noiseHit(time, vel * 0.4, 1.4, 'bandpass', 6800, reverbSend);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 92, vel, destination: output });
      noiseHit(time, 0.16 * vel, 0.3, 'lowpass', 320, output);
      noiseHit(time, 0.06 * vel, 0.6, 'highpass', 5200, output);
    },
  }, {
    kick: ['vel'],
    heart: ['vel'],
    shaker: ['vel', 'decay'],
    snap: ['vel'],
    subPulse: ['midi', 'vel'],
    bass: ['midi', 'vel', 'drive'],
    pad: ['midis', 'duration', 'vel', 'voicesPerNote', 'cutoff'],
    droplet: ['midi', 'vel', 'cutoff'],
    bell: ['midi', 'vel'],
    chime: ['midi', 'duration', 'vel'],
    gong: ['midi', 'vel'],
    menace: ['midi', 'duration', 'vel'],
    skitter: ['vel'],
    riser: ['duration', 'level'],
    crash: ['vel'],
    impact: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voice: StrandTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice, velocity: vel, weight, destination: output, sends: playerSends(0.34, voice.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
