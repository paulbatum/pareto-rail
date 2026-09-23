import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf: the building's instruments. Pipe ranks are single oscillators with
// a hand-built harmonic spectrum (one PeriodicWave per stop), a little
// speech "chiff" on the attack, and the long stone reverb. The choir is a
// formant bank fed by detuned saws; bells are inharmonic partial stacks with
// the minor-third tierce real church bells have. Nothing here decides what to
// play — audio.ts owns every note, gain, and registration.

export type OrganStop = 'pedal' | 'principal' | 'plenum' | 'flute' | 'gedackt' | 'reed' | 'tuba' | 'cornet';
export type OrganOutput = 'music' | 'sfx';

// Harmonic amplitudes (index = harmonic number) for each rank.
const SPECTRA: Record<OrganStop, readonly number[]> = {
  // Soft 16' + 8' flue: fundamental and a whisper of octave.
  pedal: [0, 1, 0.42, 0.12, 0.08, 0.03],
  // Open diapason: the organ's own voice.
  principal: [0, 1, 0.46, 0.26, 0.19, 0.1, 0.07, 0.04, 0.035],
  // Principal chorus with mixture ranks (octaves and fifths up high).
  plenum: [0, 1, 0.72, 0.52, 0.56, 0.2, 0.42, 0.08, 0.34, 0.06, 0.12, 0.04, 0.2, 0.03, 0.05, 0.02, 0.13],
  // Harmonic flute: nearly pure, a trace of twelfth.
  flute: [0, 1, 0.1, 0.16, 0.03, 0.04],
  // Stopped flute (gedackt): odd harmonics — hollow and soft.
  gedackt: [0, 1, 0, 0.22, 0, 0.07, 0, 0.02],
  // Chorus reed: bright and buzzy, falling slowly.
  reed: [0, 1, 0.8, 0.68, 0.62, 0.55, 0.5, 0.42, 0.36, 0.3, 0.26, 0.22, 0.18, 0.15, 0.12, 0.1, 0.08],
  // Tuba mirabilis: a big round high-pressure reed with a strong formant.
  tuba: [0, 1, 0.9, 0.95, 0.8, 0.6, 0.48, 0.38, 0.3, 0.22, 0.16, 0.12, 0.09, 0.07, 0.05],
  // Cornet: 8' 4' 2⅔' 2' 1⅗' — the tierce gives the solo its reedy flute.
  cornet: [0, 1, 0.6, 0.62, 0.34, 0.5, 0.12, 0.05, 0.04],
};

const ATTACK: Record<OrganStop, number> = {
  pedal: 0.08,
  principal: 0.035,
  plenum: 0.03,
  flute: 0.045,
  gedackt: 0.03,
  reed: 0.022,
  tuba: 0.03,
  cornet: 0.018,
};

// Formants for a sung "ah" drifting toward "oh".
const CHOIR_FORMANTS = [
  { frequency: 720, Q: 6, gain: 1 },
  { frequency: 1120, Q: 7, gain: 0.55 },
  { frequency: 2550, Q: 9, gain: 0.22 },
];

const BELL_PARTIALS = [
  { ratio: 0.5, gain: 0.55, decay: 1 },
  { ratio: 1, gain: 1, decay: 0.72 },
  { ratio: 1.19, gain: 0.46, decay: 0.55 }, // tierce: the minor third
  { ratio: 1.5, gain: 0.24, decay: 0.42 },
  { ratio: 2, gain: 0.62, decay: 0.38 },
  { ratio: 2.52, gain: 0.26, decay: 0.24 },
  { ratio: 3.01, gain: 0.18, decay: 0.18 },
  { ratio: 4.17, gain: 0.1, decay: 0.12 },
];

const GLASS_PARTIALS = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.76, gain: 0.38, decay: 0.45 },
  { ratio: 5.4, gain: 0.16, decay: 0.22 },
  { ratio: 8.93, gain: 0.07, decay: 0.12 },
];

export type OrganEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

type ContextCache = {
  waves: Map<OrganStop, PeriodicWave>;
  choirInput: GainNode | null;
};

export function createOrgan(environment: OrganEnvironment) {
  const caches = new WeakMap<AudioContext, ContextCache>();

  function cacheFor(context: AudioContext) {
    let cache = caches.get(context);
    if (!cache) {
      cache = { waves: new Map(), choirInput: null };
      caches.set(context, cache);
    }
    return cache;
  }

  function wave(context: AudioContext, stop: OrganStop) {
    const cache = cacheFor(context);
    let periodic = cache.waves.get(stop);
    if (!periodic) {
      const spectrum = SPECTRA[stop];
      const real = new Float32Array(spectrum.length);
      const imag = Float32Array.from(spectrum);
      periodic = context.createPeriodicWave(real, imag);
      cache.waves.set(stop, periodic);
    }
    return periodic;
  }

  function destination(output: OrganOutput) {
    const mix = environment.mix();
    if (!mix) return null;
    return output === 'music' ? mix.duck : mix.sfx;
  }

  function send(context: AudioContext, from: AudioNode, amount: number) {
    const reverb = environment.mix()?.reverbSend;
    if (!reverb || amount <= 0) return;
    const gain = context.createGain();
    gain.gain.value = amount;
    from.connect(gain).connect(reverb);
  }

  function noise(context: AudioContext, time: number, duration: number, type: BiquadFilterType, frequency: number, Q: number, peak: number, output: AudioNode, reverb = 0) {
    const buffer = environment.mix()?.noiseBuffer;
    if (!buffer || !(peak > 0.0001)) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = Q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + Math.min(0.012, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(gain).connect(output);
    send(context, gain, reverb);
    source.start(time, Math.random() * Math.max(0, buffer.duration - duration - 0.1));
    source.stop(time + duration + 0.02);
  }

  function choirBank(context: AudioContext) {
    const cache = cacheFor(context);
    if (cache.choirInput) return cache.choirInput;
    const mix = environment.mix();
    if (!mix) return null;
    const input = context.createGain();
    const output = context.createGain();
    output.gain.value = 2.6;
    for (const formant of CHOIR_FORMANTS) {
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = formant.frequency;
      filter.Q.value = formant.Q;
      const level = context.createGain();
      level.gain.value = formant.gain;
      input.connect(filter).connect(level).connect(output);
    }
    output.connect(mix.duck);
    send(context, output, 0.9);
    cache.choirInput = input;
    return input;
  }

  return defineInstruments(environment, {
    /** One organ pipe speaking. */
    pipe(context, time: number, midi: number, duration: number, stop: OrganStop, gain: number, output: OrganOutput, reverb: number, chiff: number) {
      const out = destination(output);
      if (!out) return;
      const attack = ATTACK[stop];
      const hold = Math.max(duration, attack + 0.09);
      const release = stop === 'pedal' ? 0.22 : stop === 'tuba' ? 0.16 : 0.1;
      const oscillator = context.createOscillator();
      oscillator.setPeriodicWave(wave(context, stop));
      oscillator.frequency.value = midiToFreq(midi);
      const amp = context.createGain();
      amp.gain.setValueAtTime(0, time);
      // Pipes overshoot a touch as they speak, then settle.
      amp.gain.linearRampToValueAtTime(gain * 1.18, time + attack);
      amp.gain.linearRampToValueAtTime(gain, time + attack + 0.07);
      amp.gain.setValueAtTime(gain, time + hold);
      amp.gain.linearRampToValueAtTime(0, time + hold + release);
      oscillator.connect(amp).connect(out);
      send(context, amp, reverb);
      oscillator.start(time);
      oscillator.stop(time + hold + release + 0.05);
      if (stop === 'pedal') {
        // The 16' an octave down: felt more than heard.
        const sub = context.createOscillator();
        sub.frequency.value = midiToFreq(midi - 12);
        const subAmp = context.createGain();
        subAmp.gain.setValueAtTime(0, time);
        subAmp.gain.linearRampToValueAtTime(gain * 0.38, time + attack * 1.6);
        subAmp.gain.setValueAtTime(gain * 0.38, time + hold);
        subAmp.gain.linearRampToValueAtTime(0, time + hold + release);
        sub.connect(subAmp).connect(out);
        send(context, subAmp, reverb * 0.6);
        sub.start(time);
        sub.stop(time + hold + release + 0.05);
      }
      if (chiff > 0) noise(context, time, 0.05, 'bandpass', Math.min(9000, midiToFreq(midi) * 3.2), 2.5, chiff * gain, out, reverb * 0.5);
    },

    /** The flute of the dark span: the same pipe with a slow tremulant. */
    tremulant(context, time: number, midi: number, duration: number, gain: number, reverb: number) {
      const out = destination('music');
      if (!out) return;
      const oscillator = context.createOscillator();
      oscillator.setPeriodicWave(wave(context, 'flute'));
      oscillator.frequency.value = midiToFreq(midi);
      const amp = context.createGain();
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(gain, time + 0.07);
      amp.gain.setValueAtTime(gain, time + duration);
      amp.gain.linearRampToValueAtTime(0, time + duration + 0.18);
      const lfo = context.createOscillator();
      lfo.frequency.value = 5.3;
      const depth = context.createGain();
      depth.gain.value = gain * 0.22;
      lfo.connect(depth).connect(amp.gain);
      oscillator.connect(amp).connect(out);
      send(context, amp, reverb);
      oscillator.start(time);
      lfo.start(time);
      oscillator.stop(time + duration + 0.25);
      lfo.stop(time + duration + 0.25);
      noise(context, time, 0.07, 'bandpass', midiToFreq(midi) * 2, 2, gain * 0.35, out, reverb);
    },

    /** A sung chord through the formant bank. */
    choir(context, time: number, midis: number[], duration: number, gain: number) {
      const input = choirBank(context);
      if (!input) return;
      for (const midi of midis) {
        const amp = context.createGain();
        amp.gain.setValueAtTime(0, time);
        amp.gain.linearRampToValueAtTime(gain, time + Math.min(0.3, duration * 0.4));
        amp.gain.setValueAtTime(gain, time + duration);
        amp.gain.linearRampToValueAtTime(0, time + duration + 0.5);
        const soften = context.createBiquadFilter();
        soften.type = 'lowpass';
        soften.frequency.value = 3400;
        soften.connect(amp).connect(input);
        for (const detune of [-11, 0, 9]) {
          const oscillator = context.createOscillator();
          oscillator.type = 'sawtooth';
          oscillator.frequency.value = midiToFreq(midi);
          oscillator.detune.value = detune;
          oscillator.connect(soften);
          oscillator.start(time);
          oscillator.stop(time + duration + 0.6);
        }
      }
    },

    /** A church bell: hum, prime, tierce, quint, nominal and upper partials. */
    bell(context, time: number, midi: number, gain: number, decay: number, output: OrganOutput) {
      const out = destination(output);
      if (!out) return;
      const base = midiToFreq(midi);
      const ceiling = context.sampleRate * 0.42;
      for (const partial of BELL_PARTIALS) {
        if (base * partial.ratio > ceiling) continue;
        const oscillator = context.createOscillator();
        oscillator.frequency.value = base * partial.ratio;
        const amp = context.createGain();
        const length = decay * partial.decay;
        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(gain * partial.gain, time + 0.006);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + length);
        oscillator.connect(amp).connect(out);
        send(context, amp, 0.55);
        oscillator.start(time);
        oscillator.stop(time + length + 0.05);
      }
      noise(context, time, 0.04, 'bandpass', Math.min(8000, base * 6), 1.4, gain * 0.5, out, 0.3);
    },

    /** Glass: a thin inharmonic chime — light going back into a window. */
    glass(context, time: number, midi: number, gain: number, output: OrganOutput) {
      const out = destination(output);
      if (!out) return;
      const base = midiToFreq(midi);
      const ceiling = context.sampleRate * 0.42;
      for (const partial of GLASS_PARTIALS) {
        if (base * partial.ratio > ceiling) continue;
        const oscillator = context.createOscillator();
        oscillator.frequency.value = base * partial.ratio;
        const amp = context.createGain();
        const length = 1.1 * partial.decay;
        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(gain * partial.gain, time + 0.004);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + length);
        oscillator.connect(amp).connect(out);
        send(context, amp, 0.7);
        oscillator.start(time);
        oscillator.stop(time + length + 0.05);
      }
    },

    /** Light being drawn out of glass: a thin tone that sags and fades. */
    drain(context, time: number, midi: number, gain: number) {
      const out = destination('sfx');
      if (!out) return;
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(midiToFreq(midi), time);
      oscillator.frequency.exponentialRampToValueAtTime(midiToFreq(midi - 1.5), time + 0.5);
      const amp = context.createGain();
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(gain, time + 0.05);
      amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.55);
      oscillator.connect(amp).connect(out);
      send(context, amp, 0.8);
      oscillator.start(time);
      oscillator.stop(time + 0.6);
    },

    /** 32' rumble: sub-bass that swells. */
    rumble(context, time: number, midi: number, duration: number, gain: number) {
      const out = destination('music');
      if (!out) return;
      for (const [offset, level] of [[0, 1], [-12, 0.7], [12, 0.18]] as const) {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = midiToFreq(midi + offset);
        const amp = context.createGain();
        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(gain * level, time + duration * 0.85);
        amp.gain.setValueAtTime(gain * level, time + duration);
        amp.gain.linearRampToValueAtTime(0, time + duration + 0.6);
        oscillator.connect(amp).connect(out);
        send(context, amp, 0.4);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.7);
      }
    },

    /** A cipher: a stuck pair of reeds a semitone apart, the wind sagging under them. */
    cipher(context, time: number, midi: number, gain: number) {
      const out = destination('sfx');
      if (!out) return;
      for (const offset of [0, 1, 6]) {
        const oscillator = context.createOscillator();
        oscillator.setPeriodicWave(wave(context, 'reed'));
        oscillator.frequency.setValueAtTime(midiToFreq(midi + offset), time);
        oscillator.frequency.linearRampToValueAtTime(midiToFreq(midi + offset - 0.7), time + 0.34);
        const amp = context.createGain();
        amp.gain.setValueAtTime(0, time);
        amp.gain.linearRampToValueAtTime(gain * (offset === 6 ? 0.5 : 1), time + 0.02);
        amp.gain.linearRampToValueAtTime(gain * 0.5, time + 0.22);
        amp.gain.linearRampToValueAtTime(0, time + 0.38);
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2600, time);
        filter.frequency.exponentialRampToValueAtTime(500, time + 0.36);
        oscillator.connect(filter).connect(amp).connect(out);
        send(context, amp, 0.4);
        oscillator.start(time);
        oscillator.stop(time + 0.42);
      }
      noise(context, time, 0.4, 'bandpass', 900, 0.9, gain * 1.4, out, 0.3);
    },

    /** Breath of wind or shattering glass: filtered noise. */
    hiss(context, time: number, duration: number, type: BiquadFilterType, frequency: number, gain: number, output: OrganOutput) {
      const out = destination(output);
      if (!out) return;
      noise(context, time, duration, type, frequency, 1.2, gain, out, 0.5);
    },
  }, {
    pipe: ['midi', 'duration', 'stop', 'gain', 'output', 'reverb', 'chiff'],
    tremulant: ['midi', 'duration', 'gain', 'reverb'],
    choir: ['midis', 'duration', 'gain'],
    bell: ['midi', 'gain', 'decay', 'output'],
    glass: ['midi', 'gain', 'output'],
    drain: ['midi', 'gain'],
    rumble: ['midi', 'duration', 'gain'],
    cipher: ['midi', 'gain'],
    hiss: ['duration', 'type', 'frequency', 'gain', 'output'],
  });
}

export type Organ = ReturnType<typeof createOrgan>;
