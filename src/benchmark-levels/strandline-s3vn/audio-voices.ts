import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Strandline's kit is built on one rule: everything is heard through water.
// Nothing has a hard attack, the top end is rolled off until the animal starts
// coming back to life, and the level's pulse is not a drum but a contraction —
// a sub-bass swell with the sound of displaced water wrapped around it.
//
// Two live beds sit under the arrangement: `flow`, the body of the water, and
// `glow`, a high shimmer the runtime opens as more of the colony comes off the
// strands. Together they are why the last minute sounds brighter than the first
// without a single extra note being written.

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

export type CurrentController = {
  setFlow(time: number, level: number, rampSeconds?: number): void;
  setGlow(time: number, level: number, rampSeconds?: number): void;
};

export function installStrandlineCurrent(context: AudioContext, mix: MixBus): CurrentController {
  if (!mix.noiseBuffer) return { setFlow: () => {}, setGlow: () => {} };

  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;

  // Body: a wide low band that breathes, the weight of open water.
  const body = context.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 260;
  body.Q.value = 0.6;
  const flowGain = context.createGain();
  flowGain.gain.value = 0;
  source.connect(body).connect(flowGain);
  flowGain.connect(mix.music);

  const swell = context.createOscillator();
  swell.frequency.value = 0.07;
  const swellGain = context.createGain();
  swellGain.gain.value = 0.03;
  swell.connect(swellGain).connect(flowGain.gain);

  const drift = context.createOscillator();
  drift.frequency.value = 0.043;
  const driftGain = context.createGain();
  driftGain.gain.value = 90;
  drift.connect(driftGain).connect(body.frequency);

  // Glow: the animal's own light, heard. A narrow shimmer band that opens as
  // the strands come back.
  const glow = context.createBiquadFilter();
  glow.type = 'bandpass';
  glow.frequency.value = 5200;
  glow.Q.value = 2.4;
  const glowGain = context.createGain();
  glowGain.gain.value = 0;
  source.connect(glow).connect(glowGain);
  glowGain.connect(mix.music);
  const glowLfo = context.createOscillator();
  glowLfo.frequency.value = 0.19;
  const glowLfoGain = context.createGain();
  glowLfoGain.gain.value = 1400;
  glowLfo.connect(glowLfoGain).connect(glow.frequency);

  source.start();
  swell.start();
  drift.start();
  glowLfo.start();

  const ramp = (param: AudioParam, time: number, level: number, seconds: number) => {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
    param.linearRampToValueAtTime(level, time + seconds);
  };

  return {
    setFlow(time, level, rampSeconds = 2.5) {
      ramp(flowGain.gain, time, level, rampSeconds);
    },
    setGlow(time, level, rampSeconds = 2.0) {
      ramp(glowGain.gain, time, level, rampSeconds);
    },
  };
}

export function createStrandlineVoices(environment: StrandVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'lowpass', frequency: 900, velocity: 1, decay: 0.06 });

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

  // The animal's contraction. Slow attack, deep fall, and a wash of water
  // moving with it — this is the level's kick and it never clicks.
  const contractionTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.52,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 33, time: time + 0.3 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.52 * vel, time: time + 0.035 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.52 },
    ],
  });

  const bubbleTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.11,
    stopPadding: 0.02,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 2.6, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  const subTone = voice<{ vel: number; sustain: number }>({
    oscillators: [{ type: 'sine', gain: 0.85 }, { type: 'triangle', octave: 1, gain: 0.12 }],
    duration: ({ sustain }) => sustain,
    stopPadding: 0.06,
    gainAutomation: (time, gain, { vel, sustain }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.3 * vel * gain, time: time + 0.05 },
      { type: 'set', value: 0.3 * vel * gain, time: time + sustain * 0.6 },
      { type: 'exponentialRamp', value: 0.001, time: time + sustain },
    ],
  });

  const glassTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', frequencyRatio: 2.76, gain: 0.16 },
      { type: 'sine', frequencyRatio: 5.4, gain: 0.05 },
    ],
    duration: 1.05,
    stopPadding: 0.06,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.085 * vel, time: time + 0.012 },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.05 },
    ],
  });

  const pluckTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [{ type: 'triangle', gain: 0.8 }, { type: 'sine', octave: 1, gain: 0.22 }],
    duration: 0.2,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'exponentialRamp', value: Math.max(280, cutoff * 0.28), time: time + 0.19 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.075 * vel, time: time + 0.008 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const chimeTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.7 },
      { type: 'sine', frequencyRatio: 2.0, gain: 0.22 },
      { type: 'sine', frequencyRatio: 3.01, gain: 0.08 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.085 * vel, time: time + 0.02 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  // The infestation's voice: two detuned saws crawling under a narrow filter.
  const groanTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.6, detune: -11 },
      { type: 'sawtooth', gain: 0.6, detune: 9 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.07,
    filter: { type: 'lowpass', frequency: 480, Q: 3.2 },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.11 * vel, time: time + duration * 0.35 },
      { type: 'set', value: 0.11 * vel, time: time + duration * 0.7 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.5 }, { type: 'sawtooth', gain: 0.4, detune: 7 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'bandpass', frequency: 1250, Q: 2.4 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 1.0,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.6 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.45 * vel, time: time + 0.05 },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.0 },
    ],
  });

  const playerToneSpec = voice<{ voice: StrandTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { attack: 0.004, decay: ({ voice }) => voice.decay, attackCurve: 'linear' },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    // Bell contraction: the animal's heartbeat and the level's downbeat.
    contraction(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      contractionTone.play({ context, time, frequency: 88, vel, destination: output });
      noiseHit(time, 0.09 * vel, 0.34, 'lowpass', 300, output);
      mix.duckAt(time, 0.62, 0.2);
    },

    // Sand and shell: a soft dry click, the closest this level gets to a snare.
    grit(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.2 * vel, 0.05, 'bandpass', 1900, duck);
      noiseHit(time + 0.01, 0.1 * vel, 0.09, 'bandpass', 3400, duck);
    },

    // Snapping shrimp: the level's hi-hat, tiny and irregular in timbre.
    tick(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.42 * vel, 0.012, 'highpass', 6400, duck);
    },

    bubble(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      bubbleTone.play({ context, time, midi, vel, destination: mix.duck, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.45 }] : undefined });
    },

    sub(context, time, midi, vel, sustain) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subTone.play({ context, time, midi, vel, sustain, destination: duck });
    },

    // The water chord. `layers` is how much of the animal is awake, `cutoff` is
    // how much light is getting down to you.
    pad(context, time, midis, duration, vel, layers, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      const count = Math.max(1, Math.round(layers));
      for (const midi of midis) {
        for (let layer = 0; layer < count; layer += 1) {
          const detune = count === 1 ? 0 : (layer / (count - 1) - 0.5) * 16;
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = count === 1 ? 'sine' : 'triangle';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 4.3 + layer * 1.9) * 4;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(cutoff, time);
          lowpass.frequency.linearRampToValueAtTime(cutoff * 0.7, time + duration);
          const level = (0.07 * vel) / (Math.sqrt(midis.length) * Math.sqrt(count));
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(1.4, duration * 0.4));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.4, duration * 0.4));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.6;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.06);
        }
      }
    },

    pluck(context, time, midi, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      pluckTone.play({
        context,
        time,
        midi,
        vel,
        cutoff,
        destination: mix.duck,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.42 }] : undefined,
      });
    },

    glass(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      glassTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.7 }] });
    },

    chime(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      chimeTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.8 }] });
    },

    groan(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      groanTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.5 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const [index, midi] of (midis as number[]).entries()) {
        stabTone.play({ context, time: time + index * 0.006, midi, vel: vel * (1 - index * 0.15), destination: mix.duck });
      }
    },

    riser(context, time, duration, level) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.12,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequency: 180,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 5200, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.08 },
        ],
        destination: output,
      });
    },

    // Water displaced in bulk — the level's cymbal, all body and no metal.
    wash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, 0.5 * vel, 1.1, 'lowpass', 2200, output);
      noiseHit(time, 0.3 * vel, 1.8, 'bandpass', 4200, reverbSend);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 96, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.45, 'lowpass', 280, output);
    },
  }, {
    contraction: ['vel'],
    grit: ['vel'],
    tick: ['vel'],
    bubble: ['midi', 'vel'],
    sub: ['midi', 'vel', 'sustain'],
    pad: ['midis', 'duration', 'vel', 'layers', 'cutoff'],
    pluck: ['midi', 'vel', 'cutoff'],
    glass: ['midi', 'vel'],
    chime: ['midi', 'duration', 'vel'],
    groan: ['midi', 'duration', 'vel'],
    stab: ['midis', 'vel'],
    riser: ['duration', 'level'],
    wash: ['vel'],
    impact: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tonal: StrandTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonal.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({
      context,
      time,
      midi,
      voice: tonal,
      velocity: vel,
      weight,
      destination: output,
      sends: playerSends(0.3, tonal.reverb),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
