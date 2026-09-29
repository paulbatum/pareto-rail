import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Voice construction for Skyhook. The score (audio.ts) decides what plays and
// when; this file only knows how a pad, a pluck, a bell, a thunderclap or a
// struck cable *sounds*. Every arrangement voice takes an `air` amount (1 in
// thick air → 0 in vacuum) that thins its reverb send and its brightness: the
// same note gets drier and barer the higher the car climbs.

export type SkyhookTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  /** Partial ratio and gain of a second oscillator; 0 gain disables it. */
  partial: number;
  partialGain: number;
  reverb: number;
  delay: number;
  noise: number;
};

export type SkyhookVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type Wind = {
  set(level: number, rain: number, time: number, ramp: number): void;
};

/** A continuous storm bed: howling wind and rain hiss, automated by the score. */
export function installWind(context: AudioContext, mix: MixBus): Wind | null {
  if (!mix.noiseBuffer) return null;
  const windSource = context.createBufferSource();
  windSource.buffer = mix.noiseBuffer;
  windSource.loop = true;
  const windBand = context.createBiquadFilter();
  windBand.type = 'bandpass';
  windBand.frequency.value = 420;
  windBand.Q.value = 0.9;
  const windGain = context.createGain();
  windGain.gain.value = 0;
  const sway = context.createOscillator();
  sway.frequency.value = 0.13;
  const swayDepth = context.createGain();
  swayDepth.gain.value = 170;
  sway.connect(swayDepth).connect(windBand.frequency);
  const gust = context.createOscillator();
  gust.frequency.value = 0.31;
  const gustDepth = context.createGain();
  gustDepth.gain.value = 0.05;
  gust.connect(gustDepth).connect(windGain.gain);
  windSource.connect(windBand).connect(windGain).connect(mix.music);
  if (mix.reverbSend) {
    const send = context.createGain();
    send.gain.value = 0.35;
    windGain.connect(send).connect(mix.reverbSend);
  }

  const rainSource = context.createBufferSource();
  rainSource.buffer = mix.noiseBuffer;
  rainSource.loop = true;
  rainSource.loopStart = 0.7;
  const rainHigh = context.createBiquadFilter();
  rainHigh.type = 'highpass';
  rainHigh.frequency.value = 4200;
  const rainGain = context.createGain();
  rainGain.gain.value = 0;
  rainSource.connect(rainHigh).connect(rainGain).connect(mix.music);

  windSource.start();
  rainSource.start();
  sway.start();
  gust.start();

  return {
    set(level, rain, time, ramp) {
      // The gust LFO rides on the gain, so fade it out with the wind or thin air never goes quiet.
      gustDepth.gain.cancelScheduledValues(time);
      gustDepth.gain.setValueAtTime(gustDepth.gain.value, time);
      gustDepth.gain.linearRampToValueAtTime(Math.min(0.05, level * 0.3), time + ramp);
      windGain.gain.cancelScheduledValues(time);
      windGain.gain.setValueAtTime(windGain.gain.value, time);
      windGain.gain.linearRampToValueAtTime(level, time + ramp);
      rainGain.gain.cancelScheduledValues(time);
      rainGain.gain.setValueAtTime(rainGain.gain.value, time);
      rainGain.gain.linearRampToValueAtTime(rain, time + ramp);
      windBand.frequency.cancelScheduledValues(time);
      windBand.frequency.setValueAtTime(windBand.frequency.value, time);
      windBand.frequency.linearRampToValueAtTime(260 + level * 900, time + ramp);
    },
  };
}

export function createSkyhookVoices(environment: SkyhookVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const noiseBuffer = environment.mix()?.noiseBuffer;
    if (!context || !noiseBuffer) return;
    noiseHitVoice.play({ context, buffer: noiseBuffer, time, velocity: vel, decay, filterType, frequency, destination, offset: Math.random() * 1.5 });
  }

  function panned(context: AudioContext, destination: AudioNode, pan: number) {
    const node = context.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(destination);
    return node;
  }

  const sends = (delayGain: number, reverbGain: number) => {
    const mix = environment.mix();
    const list: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) list.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) list.push({ destination: mix.reverbSend, gain: reverbGain });
    return list;
  };

  const subTone = voice<{ vel: number; dur: number }>({
    oscillators: [{ type: 'sine', gain: 1 }],
    duration: ({ dur }) => dur,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel, dur }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.34 * vel, time: time + 0.03 },
      { type: 'linearRamp', value: 0.26 * vel, time: time + dur * 0.6 },
      { type: 'exponentialRamp', value: 0.001, time: time + dur },
    ],
  });

  const subOvertone = voice<{ vel: number; dur: number }>({
    oscillators: [{ type: 'triangle', octave: 1, gain: 1 }],
    duration: ({ dur }) => dur,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 520 },
    gainAutomation: (time, _gain, { vel, dur }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.09 * vel, time: time + 0.03 },
      { type: 'exponentialRamp', value: 0.001, time: time + dur * 0.9 },
    ],
  });

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.2,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 42, time: time + 0.13 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.46 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const pluckTone = voice<{ vel: number; cutoff: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: 1 }, { type: 'sine', octave: 1, gain: 0.32 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      frequency: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff, decay }) => [{ type: 'exponentialRamp', value: Math.max(500, cutoff * 0.28), time: time + decay * 0.9 }],
    },
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: 0.072 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const padVoice = voice<{ level: number; dur: number; cutoff: number; attack: number }>({
    oscillators: [{ type: 'sawtooth', detune: -9, gain: 0.5 }, { type: 'sawtooth', detune: 9, gain: 0.5 }, { type: 'sine', octave: -1, gain: 0.35 }],
    duration: ({ dur }) => dur,
    stopPadding: 0.1,
    filter: {
      type: 'lowpass',
      frequency: ({ cutoff }) => cutoff * 0.55,
      Q: 0.5,
      frequencyAutomation: (time, { cutoff, dur }) => [
        { type: 'linearRamp', value: cutoff, time: time + dur * 0.45 },
        { type: 'linearRamp', value: cutoff * 0.6, time: time + dur },
      ],
    },
    gainAutomation: (time, _gain, { level, dur, attack }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: level, time: time + attack },
      { type: 'linearRamp', value: level * 0.9, time: time + Math.max(attack + 0.01, dur - 1.2) },
      { type: 'linearRamp', value: 0, time: time + dur },
    ],
  });

  const bellCarrier = voice<{ vel: number; dur: number }>({
    oscillators: [{ type: 'sine', gain: 1 }],
    duration: ({ dur }) => dur,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel, dur }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.1 * vel, time: time + 0.006 },
      { type: 'exponentialRamp', value: 0.001, time: time + dur },
    ],
  });

  const bellPartial = voice<{ vel: number; dur: number; ratio: number }>({
    oscillators: [{ type: 'sine', frequencyRatio: ({ ratio }) => ratio, gain: 1 }],
    duration: ({ dur }) => dur * 0.5,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel, dur }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.05 * vel, time: time + 0.004 },
      { type: 'exponentialRamp', value: 0.001, time: time + dur * 0.5 },
    ],
  });

  const clangPartial = voice<{ level: number; dur: number; ratio: number }>({
    oscillators: [{ type: 'sine', frequencyRatio: ({ ratio }) => ratio, gain: 1 }],
    duration: ({ dur }) => dur,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { level, dur }) => [
      { type: 'set', value: level, time },
      { type: 'exponentialRamp', value: 0.0008, time: time + dur },
    ],
  });

  const thumpTone = voice<{ vel: number; from: number; to: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.22,
    stopPadding: 0.03,
    frequencyAutomation: (time, _frequency, { to }) => [{ type: 'exponentialRamp', value: to, time: time + 0.16 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.9,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.6 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const alarmTone = voice<{ duration: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 900 },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.11, time: time + duration * 0.15 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 120, vel, destination: output });
      noiseHit(time, 0.05 * vel, 0.006, 'highpass', 1600, output);
      mix.duckAt(time, 0.58, 0.2);
    },

    // A clap made of wind: filtered noise, no tonal body.
    clap(_context, time, vel) {
      const duck = environment.mix()?.duck;
      const reverb = environment.mix()?.reverbSend;
      if (!duck) return;
      noiseHit(time, 0.16 * vel, 0.14, 'bandpass', 1900, duck);
      noiseHit(time, 0.08 * vel, 0.05, 'highpass', 5400, duck);
      if (reverb) noiseHit(time, 0.06 * vel, 0.3, 'bandpass', 2600, reverb);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8400, duck);
    },

    shaker(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.06, 'bandpass', 6400, duck);
    },

    sub(context, time, midi, dur, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subTone.play({ context, time, midi, vel, dur, destination: duck });
      subOvertone.play({ context, time, midi, vel, dur, destination: duck });
    },

    pad(context, time, midis: number[], dur, vel, bright, air) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const count = midis.length;
      midis.forEach((midi, index) => {
        const level = (0.05 * vel) / Math.sqrt(Math.max(1, count / 3));
        const attack = Math.min(1.6, dur * 0.35);
        const pan = panned(context, mix.duck, ((index / Math.max(1, count - 1)) * 2 - 1) * 0.6);
        padVoice.play({
          context,
          time,
          midi,
          level,
          dur,
          cutoff: 700 + bright * 2600,
          attack,
          destination: pan,
          sends: sends(0.12, 0.8 * air + 0.12),
        });
      });
    },

    pluck(context, time, midi, vel, air) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const pan = panned(context, mix.duck, ((midi * 7) % 5 - 2) * 0.28);
      pluckTone.play({ context, time, midi, vel, cutoff: 2600 + air * 1600, decay: 0.34, destination: pan, sends: sends(0.5, 0.36 * air + 0.05) });
    },

    bell(context, time, midi, dur, vel, air) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const pan = panned(context, mix.duck, ((midi * 5) % 7 - 3) * 0.16);
      bellCarrier.play({ context, time, midi, vel, dur, destination: pan, sends: sends(0.3, 0.75 * air + 0.1) });
      bellPartial.play({ context, time, midi, vel, dur, ratio: 3.5, destination: pan, sends: sends(0.2, 0.5 * air) });
      bellPartial.play({ context, time, midi, vel: vel * 0.6, dur, ratio: 2, destination: pan });
    },

    // Metal struck once: inharmonic partials with staggered decays.
    clang(context, time, midi, dur, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      const ratios = [1, 2.76, 5.4, 8.93, 13.34];
      const levels = [0.16, 0.1, 0.055, 0.03, 0.016];
      ratios.forEach((ratio, i) => {
        clangPartial.play({ context, time, midi, ratio, level: levels[i] * vel, dur: dur * (1 - i * 0.17), destination: output, sends: sends(0.1, 0.5) });
      });
      noiseHit(time, 0.14 * vel, 0.06, 'bandpass', 2600, output);
    },

    // One cable-grip slam: the Ripper planting a hand. Dull, heavy, on the beat.
    grip(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      thumpTone.play({ context, time, frequency: 78, from: 78, to: 34, vel, destination: output });
      noiseHit(time, 0.12 * vel, 0.1, 'lowpass', 520, output);
      instruments.clang(time, 50, 0.35 + vel * 0.4, 0.5 * (0.6 + vel * 0.5));
    },

    heartbeat(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      thumpTone.play({ context, time, frequency: 62, from: 62, to: 40, vel: 0.85 * vel, destination: output });
      thumpTone.play({ context, time: time + 0.24, frequency: 56, from: 56, to: 38, vel: 0.55 * vel, destination: output });
    },

    thunder(context, time, vel) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix?.noiseBuffer) return;
      noiseHit(time, 0.34 * vel, 0.14, 'highpass', 1500, output);
      playBufferSourceVoice({
        context,
        buffer: mix.noiseBuffer,
        time: time + 0.05,
        stopTime: time + 3.2,
        loop: true,
        filter: {
          type: 'lowpass',
          Q: 0.7,
          frequency: 420,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 60, time: time + 2.6 }],
        },
        gainAutomation: [
          { type: 'set', value: 0.0001, time: time + 0.05 },
          { type: 'linearRamp', value: 0.5 * vel, time: time + 0.16 },
          { type: 'exponentialRamp', value: 0.001, time: time + 3.1 },
        ],
        destination: output,
      });
      if (mix.reverbSend) noiseHit(time, 0.2 * vel, 0.9, 'lowpass', 500, mix.reverbSend);
    },

    hiss(context, time, dur, vel) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix?.noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: mix.noiseBuffer,
        time,
        stopTime: time + dur + 0.1,
        loop: true,
        filter: { type: 'highpass', frequency: 3200 },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.09 * vel, time: time + 0.08 },
          { type: 'exponentialRamp', value: 0.001, time: time + dur },
        ],
        destination: output,
      });
    },

    whoosh(context, time, dur, vel, rising) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix?.noiseBuffer) return;
      const from = rising ? 260 : 3400;
      const to = rising ? 3400 : 260;
      playBufferSourceVoice({
        context,
        buffer: mix.noiseBuffer,
        time,
        stopTime: time + dur + 0.1,
        loop: true,
        filter: { type: 'bandpass', Q: 1.2, frequency: from, frequencyAutomation: [{ type: 'exponentialRamp', value: to, time: time + dur }] },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.16 * vel, time: time + dur * 0.5 },
          { type: 'linearRamp', value: 0, time: time + dur },
        ],
        destination: output,
      });
    },

    // A pylon passing the car: a short pitched-down rush of air, panned to alternate sides.
    swish(context, time, vel, pan) {
      const mix = environment.mix();
      if (!mix?.noiseBuffer || !mix.duck) return;
      const out = panned(context, mix.duck, pan);
      playBufferSourceVoice({
        context,
        buffer: mix.noiseBuffer,
        time,
        stopTime: time + 0.4,
        loop: true,
        filter: { type: 'bandpass', Q: 1.6, frequency: 1500, frequencyAutomation: [{ type: 'exponentialRamp', value: 240, time: time + 0.3 }] },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.07 * vel, time: time + 0.05 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
        ],
        destination: out,
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
        filter: { type: 'bandpass', Q: 1.1, frequency: 260, frequencyAutomation: [{ type: 'exponentialRamp', value: 7000, time: time + duration }] },
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
      noiseHit(time, 0.24 * vel, 0.34, 'lowpass', 460, output);
      instruments.crash(time, 0.15 * vel);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverb = environment.mix()?.reverbSend;
      if (!output || !reverb) return;
      noiseHit(time, vel, 0.9, 'highpass', 4800, output);
      noiseHit(time, vel * 0.5, 1.5, 'bandpass', 7000, reverb);
    },

    alarm(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      alarmTone.play({ context, time, midi, duration, destination: mix.duck, sends: sends(0, 0.4) });
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    shaker: ['vel'],
    sub: ['midi', 'dur', 'vel'],
    pad: ['midis', 'dur', 'vel', 'bright', 'air'],
    pluck: ['midi', 'vel', 'air'],
    bell: ['midi', 'dur', 'vel', 'air'],
    clang: ['midi', 'dur', 'vel'],
    grip: ['vel'],
    heartbeat: ['vel'],
    thunder: ['vel'],
    hiss: ['dur', 'vel'],
    whoosh: ['dur', 'vel', 'rising'],
    swish: ['vel', 'pan'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    crash: ['vel'],
    alarm: ['midi', 'duration'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    return sends(delayGain, reverbGain);
  }

  const playerToneSpec = voice<{ voice: SkyhookTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const playerPartialSpec = voice<{ voice: SkyhookTonalVoice }>({
    oscillators: [{ type: 'sine', frequencyRatio: ({ voice }) => voice.partial, gain: ({ voice }) => voice.gain * voice.partialGain }],
    duration: ({ voice }) => voice.decay * 0.7,
    stopPadding: 0.04,
    envelope: { decay: ({ voice }) => voice.decay * 0.7 },
  });

  function playerTone(time: number, midi: number, tonal: SkyhookTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonal.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: tonal, velocity: vel, weight, destination: output, sends: sends(tonal.delay, tonal.reverb) });
    if (tonal.partialGain > 0) playerPartialSpec.play({ context, time, midi, voice: tonal, velocity: vel, weight, destination: output, sends: sends(0, tonal.reverb * 0.6) });
    if (tonal.noise > 0) noiseHit(time, tonal.noise * vel * weight, 0.03, 'highpass', 7600, output);
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise, oscillator: playOscillatorVoice, midiToFreq };
}
