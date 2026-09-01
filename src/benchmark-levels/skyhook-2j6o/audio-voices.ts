import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf: instrument construction only. Every arrangement, harmony, gain
// balance and timing decision lives in ./audio.ts.

export type SkyhookTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type SkyhookVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

/** Continuous beds: rain, wind, the station hum, the Tetherjack's drone. */
export type SkyhookBeds = {
  setRain(level: number, time: number, smoothing?: number): void;
  setWind(level: number, time: number, smoothing?: number): void;
  setHum(level: number, time: number, smoothing?: number): void;
  setDrone(level: number, closeness: number, time: number, smoothing?: number): void;
};

export function installSkyhookBeds(context: AudioContext, mix: MixBus): SkyhookBeds | null {
  if (!mix.noiseBuffer) return null;
  const music = mix.music;

  const makeNoiseBed = (filterType: BiquadFilterType, frequency: number, q: number, lfoHz: number, lfoDepth: number) => {
    const source = context.createBufferSource();
    source.buffer = mix.noiseBuffer!;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.value = 0;
    const lfo = context.createOscillator();
    lfo.frequency.value = lfoHz;
    const lfoGain = context.createGain();
    lfoGain.gain.value = lfoDepth;
    const tremolo = context.createGain();
    tremolo.gain.value = 1;
    lfo.connect(lfoGain).connect(tremolo.gain);
    source.connect(filter).connect(tremolo).connect(gain).connect(music);
    source.start();
    lfo.start();
    return gain;
  };

  // Rain: bright hiss with a slow surge. Wind: low roar swelling under it.
  const rain = makeNoiseBed('bandpass', 1400, 0.5, 0.17, 0.3);
  const rainHigh = makeNoiseBed('highpass', 5200, 0.7, 0.23, 0.35);
  const wind = makeNoiseBed('lowpass', 320, 0.8, 0.09, 0.45);

  // Station hum: two low sines with a slow beat between them.
  const humGain = context.createGain();
  humGain.gain.value = 0;
  for (const [frequency, level] of [[55, 0.6], [110.4, 0.35], [164.8, 0.12]] as const) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = level;
    oscillator.connect(gain).connect(humGain);
    oscillator.start();
  }
  humGain.connect(music);

  // The Tetherjack's drone: detuned saws through a lowpass that opens as it nears.
  const droneGain = context.createGain();
  droneGain.gain.value = 0;
  const droneFilter = context.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 160;
  droneFilter.Q.value = 3;
  const dronePitch: OscillatorNode[] = [];
  for (const detune of [-9, 6, 14]) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = midiToFreq(35);
    oscillator.detune.value = detune;
    oscillator.connect(droneFilter);
    oscillator.start();
    dronePitch.push(oscillator);
  }
  const droneTremolo = context.createGain();
  droneTremolo.gain.value = 1;
  const droneLfo = context.createOscillator();
  droneLfo.frequency.value = 0.8;
  const droneLfoGain = context.createGain();
  droneLfoGain.gain.value = 0.35;
  droneLfo.connect(droneLfoGain).connect(droneTremolo.gain);
  droneLfo.start();
  droneFilter.connect(droneTremolo).connect(droneGain).connect(mix.duck);

  return {
    setRain(level, time, smoothing = 0.6) {
      rain.gain.setTargetAtTime(0.12 * level, time, smoothing);
      rainHigh.gain.setTargetAtTime(0.045 * level, time, smoothing);
    },
    setWind(level, time, smoothing = 0.8) {
      wind.gain.setTargetAtTime(0.32 * level, time, smoothing);
    },
    setHum(level, time, smoothing = 1.2) {
      humGain.gain.setTargetAtTime(0.09 * level, time, smoothing);
    },
    setDrone(level, closeness, time, smoothing = 0.3) {
      droneGain.gain.setTargetAtTime(0.11 * level * (0.4 + closeness * 0.6), time, smoothing);
      droneFilter.frequency.setTargetAtTime(150 + closeness * 900, time, smoothing);
      const midi = 35 + closeness * 7;
      for (const oscillator of dronePitch) oscillator.frequency.setTargetAtTime(midiToFreq(midi), time, smoothing);
      droneLfo.frequency.setTargetAtTime(0.8 + closeness * 5, time, smoothing);
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

  const kickTone = voice<{ vel: number; tone: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.18,
    stopPadding: 0.03,
    frequencyAutomation: (time, _frequency, { tone }) => [{ type: 'exponentialRamp', value: 40 + tone * 8, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.08,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 140, time: time + 0.06 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.1 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
    ],
  });

  const pluckTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.17,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 3400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 700, time: time + 0.15 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.11 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 3000,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 420, time: time + 0.26 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.045 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const bellPartial = voice<{ vel: number; duration: number; ratio: number; level: number }>({
    oscillators: [{ type: 'sine', frequencyRatio: ({ ratio }) => ratio }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel, duration, level }) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.16 * vel * level, time: time + 0.008 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const thudTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.55,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 30, time: time + 0.4 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.8,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.55 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
    ],
  });

  const alarmTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'square' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 1800 },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: level, time: time + 0.02 },
      { type: 'set', value: level, time: time + duration * 0.7 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const playerToneSpec = voice<{ voice: SkyhookTonalVoice }>({
    oscillators: [{ type: ({ voice: tonal }) => tonal.oscillator, gain: ({ voice: tonal }) => tonal.gain }],
    duration: ({ voice: tonal }) => tonal.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice: tonal }) => tonal.cutoff },
    envelope: { decay: ({ voice: tonal }) => tonal.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel, tone) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, tone, destination: output });
      noiseHit(time, 0.05 * vel * tone, 0.005, 'highpass', 1800, output);
      mix.duckAt(time, 0.55, 0.14);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      // Brushed: more air than crack.
      noiseHit(time, 0.16 * vel, 0.11, 'bandpass', 1900, output);
      noiseHit(time, 0.07 * vel, 0.04, 'highpass', 6000, output);
      snareBody.play({ context, time, frequency: 210, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8600, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.22, 'highpass', 7200, duck);
    },

    tick(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.018, 'bandpass', 6800, duck);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.9, 'highpass', 4400, output);
      noiseHit(time, vel * 0.5, 1.5, 'bandpass', 6800, reverbSend);
    },

    thunder(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output) return;
      noiseHit(time, 0.22 * vel, 0.07, 'bandpass', 1300, output);
      noiseHit(time + 0.05, 0.42 * vel, 1.6, 'lowpass', 190, output);
      if (reverbSend) noiseHit(time + 0.1, 0.25 * vel, 2.2, 'lowpass', 260, reverbSend);
    },

    // The pad: wide down low (two detuned saws, open filter), narrow up top
    // (a single triangle), a bare sine pedal at the very top. `width` 0..1.
    pad(context, time, midis, duration, vel, width) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      const attack = Math.min(0.9, duration * 0.22);
      const release = Math.min(1.2, duration * 0.3);
      const detunes = width > 0.55 ? [-(6 + width * 10), 6 + width * 10] : width > 0.15 ? [-4, 4] : [0];
      const type: OscillatorType = width > 0.55 ? 'sawtooth' : width > 0.15 ? 'triangle' : 'sine';
      const level = ((width > 0.55 ? 0.028 : width > 0.15 ? 0.05 : 0.07) * vel) / Math.sqrt(Math.max(1, midis.length) / 4);
      for (const midi of midis) {
        for (const detune of detunes) {
          const oscillator = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          oscillator.type = type;
          oscillator.frequency.value = midiToFreq(midi);
          oscillator.detune.value = detune + Math.sin(midi * 3.1) * 2;
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(700 + width * 1300, time);
          filter.frequency.linearRampToValueAtTime(500 + width * 700, time + duration);
          filter.Q.value = 0.7;
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + attack);
          gain.gain.setValueAtTime(level, time + duration - release);
          gain.gain.linearRampToValueAtTime(0, time + duration);
          oscillator.connect(filter).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.25 + width * 0.45;
          gain.connect(send).connect(mix.reverbSend);
          oscillator.start(time);
          oscillator.stop(time + duration + 0.05);
        }
      }
    },

    bass(context, time, midi, vel, duration) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.3 * vel, time + 0.01);
      subGain.gain.setValueAtTime(0.3 * vel, time + duration * 0.6);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + duration + 0.02);
      // A soft triangle an octave up gives it an edge without growling.
      const layer = context.createOscillator();
      const layerFilter = context.createBiquadFilter();
      const layerGain = context.createGain();
      layer.type = 'triangle';
      layer.frequency.value = midiToFreq(midi + 12);
      layerFilter.type = 'lowpass';
      layerFilter.frequency.setValueAtTime(900, time);
      layerFilter.frequency.exponentialRampToValueAtTime(220, time + duration);
      layerGain.gain.setValueAtTime(0.09 * vel, time);
      layerGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      layer.connect(layerFilter).connect(layerGain).connect(duck);
      layer.start(time);
      layer.stop(time + duration + 0.02);
    },

    pluck(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      pluckTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.38 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-9, 9]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.3 }] });
        }
      }
    },

    lead(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, time);
      filter.frequency.linearRampToValueAtTime(1500, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.07 * vel, time + 0.03);
      gain.gain.setValueAtTime(0.07 * vel, time + Math.max(0.03, duration - 0.1));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.03);
      const vibrato = context.createOscillator();
      const vibratoGain = context.createGain();
      vibrato.frequency.value = 5.2;
      vibratoGain.gain.setValueAtTime(0, time);
      vibratoGain.gain.linearRampToValueAtTime(5, time + Math.min(0.4, duration * 0.6));
      for (const [type, detune] of [['sawtooth', -6], ['triangle', 6]] as const) {
        const oscillator = context.createOscillator();
        oscillator.type = type;
        oscillator.frequency.value = midiToFreq(midi);
        oscillator.detune.value = detune;
        vibrato.connect(vibratoGain).connect(oscillator.detune);
        oscillator.connect(filter);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.06);
      }
      vibrato.start(time);
      vibrato.stop(time + duration + 0.06);
      filter.connect(gain);
      gain.connect(mix.duck);
      const echo = context.createGain();
      echo.gain.value = 0.45;
      gain.connect(echo).connect(mix.delaySend);
      const hall = context.createGain();
      hall.gain.value = 0.35;
      gain.connect(hall).connect(mix.reverbSend);
    },

    bell(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const [ratio, level] of [[1, 1], [2.01, 0.35], [3.0, 0.14], [4.2, 0.06]] as const) {
        bellPartial.play({ context, time, midi, vel, duration: duration / Math.sqrt(ratio), ratio, level, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.6 }] });
      }
    },

    thud(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      thudTone.play({ context, time, frequency: 70, vel, destination: output });
      noiseHit(time, 0.14 * vel, 0.2, 'bandpass', 380, output);
      noiseHit(time + 0.02, 0.06 * vel, 0.05, 'highpass', 2400, output);
      mix.duckAt(time, 0.5 - vel * 0.2, 0.3);
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

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.28 * vel, 0.32, 'lowpass', 380, output);
      instruments.crash(time, 0.18 * vel);
    },

    alarm(context, time, midi, duration, level) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, level, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.3 }] });
    },
  }, {
    kick: ['vel', 'tone'],
    snare: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    tick: ['vel'],
    crash: ['vel'],
    thunder: ['vel'],
    pad: ['midis', 'duration', 'vel', 'width'],
    bass: ['midi', 'vel', 'duration'],
    pluck: ['midi', 'vel'],
    stab: ['midis', 'vel'],
    lead: ['midi', 'duration', 'vel'],
    bell: ['midi', 'duration', 'vel'],
    thud: ['vel'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    alarm: ['midi', 'duration', 'level'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tonal: SkyhookTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonal.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: tonal, velocity: vel, weight, destination: output, sends: playerSends(0.34, tonal.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number, filterType: BiquadFilterType = 'highpass') {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, filterType, frequency, output);
  }

  function playerOscillator(options: Omit<Parameters<typeof playOscillatorVoice>[0], 'context' | 'destination'> & { destination?: AudioNode }) {
    const context = environment.context();
    const output = options.destination ?? sfxDestination();
    if (!context || !output) return;
    playOscillatorVoice({ ...options, context, destination: output });
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise, playerOscillator };
}
