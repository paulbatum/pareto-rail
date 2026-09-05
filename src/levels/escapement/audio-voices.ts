import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Instrument construction for the Escapement score. Every decision about
// when a voice plays, which pitch it takes, and how loud it sits in a section
// lives in audio.ts; this file only builds the sounds it is asked for.

export type EscapementVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
  /**
   * Pitch ratio at the start and end of a note that begins at `time` and lasts
   * `duration` seconds. The spine returns 1/1 outside the Free Run glissando.
   */
  glide(time: number, duration: number): { start: number; end: number };
};

/** Timbre of the player's chime: the kill note and the six-lock bell chord. */
export type EscapementChimeVoice = { bright: number; decay: number; gain: number; hall: number };
/** Timbre of the player's lock click. */
export type EscapementClickVoice = { cutoff: number; gain: number };

type Partial = { ratio: number; gain: number; decay: number; type?: OscillatorType; detune?: number };
type Send = { destination: AudioNode; gain: number };

type NoiseBurst = {
  type: BiquadFilterType;
  frequency: number;
  Q?: number;
  gain: number;
  decay: number;
  destination: AudioNode;
  sends?: Send[];
  /** Filter frequency reached at `time + decay` when set. */
  frequencyEnd?: number;
};

// A large church bell: hum, prime, minor-third tierce, quint, nominal, then
// inharmonic upper partials. Ratios are relative to the prime.
const STRIKE_BELL_PARTIALS: Partial[] = [
  { ratio: 0.5, gain: 0.55, decay: 5.5 },
  { ratio: 1, gain: 1, decay: 4.2 },
  { ratio: 1.003, gain: 0.45, decay: 4.0 },
  { ratio: 1.183, gain: 0.6, decay: 3.2 },
  { ratio: 1.5, gain: 0.35, decay: 2.6 },
  { ratio: 2, gain: 0.7, decay: 2.2 },
  { ratio: 2.006, gain: 0.3, decay: 2.0 },
  { ratio: 2.51, gain: 0.3, decay: 1.5 },
  { ratio: 2.99, gain: 0.25, decay: 1.2 },
  { ratio: 3.68, gain: 0.15, decay: 0.9 },
  { ratio: 4.2, gain: 0.12, decay: 0.7 },
  { ratio: 5.4, gain: 0.08, decay: 0.5 },
];

// A smaller, brighter bell for the boss rings. The prime carries the pitch.
const BOSS_BELL_PARTIALS: Partial[] = [
  { ratio: 0.5, gain: 0.35, decay: 1.8 },
  { ratio: 1, gain: 1, decay: 2.6 },
  { ratio: 1.19, gain: 0.45, decay: 1.6 },
  { ratio: 1.5, gain: 0.2, decay: 1.2 },
  { ratio: 2, gain: 0.6, decay: 1.4 },
  { ratio: 2.74, gain: 0.3, decay: 0.8 },
  { ratio: 3, gain: 0.15, decay: 0.7 },
  { ratio: 4.07, gain: 0.12, decay: 0.45 },
];

// Steel struck at the arbor: an anvil's inharmonic set.
const STEEL_PARTIALS: Partial[] = [
  { ratio: 1, gain: 1, decay: 0.35 },
  { ratio: 1.58, gain: 0.6, decay: 0.25 },
  { ratio: 2.24, gain: 0.5, decay: 0.2 },
  { ratio: 3.37, gain: 0.3, decay: 0.12 },
  { ratio: 4.5, gain: 0.2, decay: 0.08 },
];

export function createEscapementVoices(environment: EscapementVoiceEnvironment) {
  const musicOut = () => environment.mix()?.music ?? null;
  const duckOut = () => environment.mix()?.duck ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? null;
  const shaperCurves = new Map<number, Float32Array<ArrayBuffer>>();

  function sends(delay: number, hall: number) {
    const mix = environment.mix();
    const list: Send[] = [];
    if (mix?.delaySend && delay > 0) list.push({ destination: mix.delaySend, gain: delay });
    if (mix?.reverbSend && hall > 0) list.push({ destination: mix.reverbSend, gain: hall });
    return list;
  }

  function route(context: AudioContext, node: AudioNode, destination: AudioNode, sendList: Send[]) {
    node.connect(destination);
    for (const send of sendList) {
      const gain = context.createGain();
      gain.gain.value = send.gain;
      node.connect(gain).connect(send.destination);
    }
  }

  function panned(context: AudioContext, pan: number, destination: AudioNode) {
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(destination);
    return panner;
  }

  /** One oscillator whose pitch follows the glissando over its lifetime. */
  function glidingOscillator(
    context: AudioContext,
    type: OscillatorType,
    frequency: number,
    time: number,
    duration: number,
    detune = 0,
  ) {
    const glide = environment.glide(time, duration);
    const osc = context.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(frequency * glide.start, time);
    if (glide.end !== glide.start) osc.frequency.exponentialRampToValueAtTime(frequency * glide.end, time + duration);
    return osc;
  }

  function playPartials(
    context: AudioContext,
    time: number,
    frequency: number,
    partials: readonly Partial[],
    gain: number,
    attack: number,
    destination: AudioNode,
    sendList: Send[],
    decayScale = 1,
  ) {
    const out = context.createGain();
    out.gain.value = gain;
    route(context, out, destination, sendList);
    for (const partial of partials) {
      // Partials that end above 18 kHz would alias; the ear does not miss them.
      if (frequency * partial.ratio * environment.glide(time, partial.decay).end > 18000) continue;
      const decay = partial.decay * decayScale;
      const osc = glidingOscillator(context, partial.type ?? 'sine', frequency * partial.ratio, time, attack + decay, partial.detune);
      const env = context.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(partial.gain, time + attack);
      env.gain.exponentialRampToValueAtTime(0.0005, time + attack + decay);
      osc.connect(env).connect(out);
      osc.start(time);
      osc.stop(time + attack + decay + 0.03);
    }
  }

  function noiseBurst(context: AudioContext, time: number, burst: NoiseBurst) {
    const buffer = environment.mix()?.noiseBuffer;
    if (!buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = burst.type;
    filter.frequency.setValueAtTime(burst.frequency, time);
    if (burst.frequencyEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(burst.frequencyEnd, time + burst.decay);
    filter.Q.value = burst.Q ?? 1;
    const gain = context.createGain();
    gain.gain.setValueAtTime(burst.gain, time);
    gain.gain.exponentialRampToValueAtTime(0.0005, time + burst.decay);
    source.connect(filter).connect(gain);
    route(context, gain, burst.destination, burst.sends ?? []);
    source.start(time, Math.random() * 1.5);
    source.stop(time + burst.decay + 0.03);
  }

  /** A sine that falls in pitch: kick bodies, thuds, and the pawl's dead thump. */
  function fallingSine(
    context: AudioContext,
    time: number,
    from: number,
    to: number,
    fallSeconds: number,
    gain: number,
    decay: number,
    destination: AudioNode,
  ) {
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, time);
    osc.frequency.exponentialRampToValueAtTime(to, time + fallSeconds);
    const env = context.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0005, time + decay);
    osc.connect(env).connect(destination);
    osc.start(time);
    osc.stop(time + decay + 0.03);
  }

  function distortionCurve(drive: number) {
    const key = Math.round(drive * 20);
    const cached = shaperCurves.get(key);
    if (cached) return cached;
    const curve = new Float32Array(512);
    const k = 2 + drive * 28;
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    shaperCurves.set(key, curve);
    return curve;
  }

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    /**
     * The clock's tick: a 4 ms click, a short inharmonic ring, and a low pawl
     * thump. `kind` alternates the pitch and the pan so a pair reads as
     * tick-tock. `hall` is the reverb send.
     */
    tick(context, time, kind: 'tick' | 'tock', vel: number, hall: number) {
      const output = musicOut();
      if (!output) return;
      const isTick = kind === 'tick';
      const out = panned(context, isTick ? -0.32 : 0.32, output);
      const hallSends = sends(0, hall);
      noiseBurst(context, time, {
        type: 'bandpass',
        frequency: isTick ? 4600 : 3400,
        Q: 3,
        gain: 0.34 * vel,
        decay: 0.008,
        destination: out,
        sends: hallSends,
      });
      playPartials(context, time, isTick ? 2350 : 1760, [
        { ratio: 1, gain: 1, decay: 0.028 },
        { ratio: 2.47, gain: 0.45, decay: 0.014 },
        { ratio: 5.1, gain: 0.2, decay: 0.008 },
      ], 0.2 * vel, 0.001, out, hallSends);
      fallingSine(context, time, 190, 120, 0.02, 0.14 * vel, 0.03, out);
    },

    /**
     * A pawl skipping over teeth: `clicks` bandpass clicks `spacing` seconds
     * apart, each one brighter than the last. `where` picks the music or the
     * effects bus.
     */
    ratchet(context, time, vel: number, clicks: number, spacing: number, pan: number, where: 'music' | 'sfx') {
      const output = where === 'sfx' ? sfxOut() : duckOut();
      if (!output) return;
      const out = panned(context, pan, output);
      for (let i = 0; i < clicks; i += 1) {
        const at = time + i * spacing;
        noiseBurst(context, at, {
          type: 'bandpass',
          frequency: 2600 + i * 350,
          Q: 6,
          gain: 0.14 * vel * (1 - i * 0.08),
          decay: 0.012,
          destination: out,
        });
        playPartials(context, at, 1900 + i * 120, [{ ratio: 1, gain: 1, decay: 0.01 }], 0.06 * vel, 0.001, out, []);
      }
    },

    /**
     * FM celesta: a sine carrier with a sine modulator three times its
     * frequency whose depth collapses in 180 ms, so each note starts glassy and
     * settles pure. A second carrier an octave up is the celesta's upper bar.
     */
    celesta(context, time, midi: number, vel: number, duration: number) {
      const output = duckOut();
      if (!output) return;
      const frequency = midiToFreq(midi);
      const out = context.createGain();
      out.gain.value = 0.15 * vel;
      route(context, out, output, sends(0.3, 0.3));

      const carrier = glidingOscillator(context, 'sine', frequency, time, duration);
      const modulator = glidingOscillator(context, 'sine', frequency * 3, time, duration);
      const depth = context.createGain();
      depth.gain.setValueAtTime(frequency * 3 * 1.2, time);
      depth.gain.exponentialRampToValueAtTime(frequency * 0.15, time + 0.18);
      modulator.connect(depth).connect(carrier.frequency);
      const env = context.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(1, time + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0005, time + duration);
      carrier.connect(env).connect(out);

      const upper = glidingOscillator(context, 'sine', frequency * 2, time, duration * 0.5);
      const upperEnv = context.createGain();
      upperEnv.gain.setValueAtTime(0, time);
      upperEnv.gain.linearRampToValueAtTime(0.35, time + 0.002);
      upperEnv.gain.exponentialRampToValueAtTime(0.0005, time + duration * 0.5);
      upper.connect(upperEnv).connect(out);

      noiseBurst(context, time, { type: 'lowpass', frequency: 4000, gain: 0.05 * vel, decay: 0.004, destination: out });
      for (const osc of [carrier, modulator, upper]) {
        osc.start(time);
        osc.stop(time + duration + 0.03);
      }
    },

    /**
     * Marimba: a sine fundamental with the bar's fourth partial, a soft mallet
     * transient, and a decay that lengthens toward the low register.
     */
    marimba(context, time, midi: number, vel: number) {
      const output = duckOut();
      if (!output) return;
      const decay = Math.min(0.5, Math.max(0.18, 0.22 + (72 - midi) * 0.01));
      playPartials(context, time, midiToFreq(midi), [
        { ratio: 1, gain: 1, decay },
        { ratio: 3.93, gain: 0.35, decay: 0.08 },
      ], 0.24 * vel, 0.002, output, sends(0, 0.2));
      noiseBurst(context, time, { type: 'lowpass', frequency: 1500, gain: 0.09 * vel, decay: 0.008, destination: output });
    },

    /**
     * Harp pluck: a sawtooth whose low-pass closes in a quarter second over a
     * sine body, panned by register.
     */
    harp(context, time, midi: number, vel: number, duration: number, hall: number) {
      const output = duckOut();
      if (!output) return;
      const frequency = midiToFreq(midi);
      const out = panned(context, Math.min(0.5, Math.max(-0.5, (midi - 70) / 30)), output);
      const sendList = sends(0.2, hall);
      const saw = glidingOscillator(context, 'sawtooth', frequency, time, duration);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(6000, frequency * 6), time);
      filter.frequency.exponentialRampToValueAtTime(frequency * 1.5, time + 0.25);
      const sawEnv = context.createGain();
      sawEnv.gain.setValueAtTime(0, time);
      sawEnv.gain.linearRampToValueAtTime(0.085 * vel, time + 0.004);
      sawEnv.gain.exponentialRampToValueAtTime(0.0005, time + duration);
      saw.connect(filter).connect(sawEnv);
      route(context, sawEnv, out, sendList);

      const body = glidingOscillator(context, 'sine', frequency, time, duration * 0.8);
      const bodyEnv = context.createGain();
      bodyEnv.gain.setValueAtTime(0, time);
      bodyEnv.gain.linearRampToValueAtTime(0.05 * vel, time + 0.004);
      bodyEnv.gain.exponentialRampToValueAtTime(0.0005, time + duration * 0.8);
      body.connect(bodyEnv);
      route(context, bodyEnv, out, sendList);
      for (const osc of [saw, body]) {
        osc.start(time);
        osc.stop(time + duration + 0.03);
      }
    },

    /**
     * Sustained chord: two detuned sawtooths per note through one low-pass
     * that opens toward the middle of the note. `cutoff`, `attack`, and
     * `release` set the character; `hall` is the reverb send.
     */
    pad(context, time, midis: number[], duration: number, vel: number, cutoff: number, attack: number, release: number, hall: number) {
      const output = duckOut();
      if (!output) return;
      const level = (0.045 * vel) / Math.sqrt(Math.max(1, midis.length) / 4);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, time);
      filter.frequency.linearRampToValueAtTime(cutoff * 1.6, time + duration * 0.5);
      filter.frequency.linearRampToValueAtTime(cutoff, time + duration);
      filter.Q.value = 0.7;
      const env = context.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(level, time + attack);
      env.gain.setValueAtTime(level, time + Math.max(attack, duration - release));
      env.gain.linearRampToValueAtTime(0, time + duration);
      filter.connect(env);
      route(context, env, output, sends(0, hall));
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          const osc = glidingOscillator(context, 'sawtooth', midiToFreq(midi), time, duration, detune + Math.sin(midi * 5.1) * 3);
          osc.connect(filter);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    /**
     * The pendulum's bass-pad swell: a sub sine and two sawtooths whose filter
     * and level rise to the middle of `duration` and fall back, one arc per
     * swing.
     */
    swell(context, time, midi: number, duration: number, vel: number) {
      const output = duckOut();
      if (!output) return;
      const frequency = midiToFreq(midi);
      const mid = time + duration * 0.5;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2;
      filter.frequency.setValueAtTime(120, time);
      filter.frequency.exponentialRampToValueAtTime(900, mid);
      filter.frequency.exponentialRampToValueAtTime(120, time + duration);
      const sawEnv = context.createGain();
      sawEnv.gain.setValueAtTime(0, time);
      sawEnv.gain.linearRampToValueAtTime(0.13 * vel, mid);
      sawEnv.gain.linearRampToValueAtTime(0, time + duration);
      filter.connect(sawEnv);
      route(context, sawEnv, output, sends(0, 0.3));
      for (const [octave, detune] of [[0, -6], [1, 6]] as const) {
        const osc = glidingOscillator(context, 'sawtooth', frequency * 2 ** octave, time, duration, detune);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      const sub = glidingOscillator(context, 'sine', frequency, time, duration);
      const subEnv = context.createGain();
      subEnv.gain.setValueAtTime(0, time);
      subEnv.gain.linearRampToValueAtTime(0.16 * vel, mid);
      subEnv.gain.linearRampToValueAtTime(0, time + duration);
      sub.connect(subEnv).connect(output);
      sub.start(time);
      sub.stop(time + duration + 0.05);
    },

    /**
     * Bass note: a sub sine under a filtered sawtooth pair. `drive` above 0
     * pushes the sawtooths through a tanh shaper before the filter; the boss
     * plays at 0.7 and above.
     */
    bass(context, time, midi: number, vel: number, duration: number, drive: number) {
      const output = duckOut();
      if (!output) return;
      const frequency = midiToFreq(midi);
      const sub = glidingOscillator(context, 'sine', frequency, time, duration);
      const subEnv = context.createGain();
      subEnv.gain.setValueAtTime(0, time);
      subEnv.gain.linearRampToValueAtTime(0.24 * vel, time + 0.006);
      subEnv.gain.setValueAtTime(0.24 * vel, time + duration * 0.7);
      subEnv.gain.exponentialRampToValueAtTime(0.0005, time + duration);
      sub.connect(subEnv).connect(output);
      sub.start(time);
      sub.stop(time + duration + 0.03);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 5;
      filter.frequency.setValueAtTime(400 + drive * 1400 + vel * 300, time);
      filter.frequency.exponentialRampToValueAtTime(180, time + duration);
      const sawEnv = context.createGain();
      sawEnv.gain.setValueAtTime(0, time);
      sawEnv.gain.linearRampToValueAtTime((drive > 0 ? 0.09 : 0.11) * vel, time + 0.005);
      sawEnv.gain.exponentialRampToValueAtTime(0.0005, time + duration);
      let input: AudioNode = filter;
      if (drive > 0) {
        const shaper = context.createWaveShaper();
        shaper.curve = distortionCurve(drive);
        shaper.oversample = '2x';
        shaper.connect(filter);
        input = shaper;
      }
      filter.connect(sawEnv).connect(output);
      for (const detune of [-10, 10]) {
        const osc = glidingOscillator(context, 'sawtooth', frequency * 2, time, duration, detune);
        osc.connect(input);
        osc.start(time);
        osc.stop(time + duration + 0.03);
      }
    },

    /** Kick: a falling sine and a click. `sidechain` true dips the duck bus. */
    kick(context, time, vel: number, sidechain: boolean) {
      const mix = environment.mix();
      const output = musicOut();
      if (!mix || !output) return;
      fallingSine(context, time, 150, 46, 0.1, 0.42 * vel, 0.17, output);
      noiseBurst(context, time, { type: 'highpass', frequency: 1400, gain: 0.08 * vel, decay: 0.004, destination: output });
      if (sidechain) mix.duckAt(time, 0.45, 0.24);
    },

    /** The pawl crack that stands in for a snare: bright noise over a short body. */
    crack(context, time, vel: number) {
      const output = musicOut();
      if (!output) return;
      noiseBurst(context, time, { type: 'bandpass', frequency: 2200, Q: 1.5, gain: 0.22 * vel, decay: 0.07, destination: output, sends: sends(0, 0.25) });
      noiseBurst(context, time, { type: 'highpass', frequency: 6000, gain: 0.08 * vel, decay: 0.03, destination: output });
      fallingSine(context, time, 260, 150, 0.04, 0.1 * vel, 0.05, output);
    },

    /**
     * The hour bell: an additive inharmonic bell with hum, prime, tierce,
     * quint, nominal, and upper partials, under a hammer thud. `midi` is the
     * prime. The bell bypasses the duck bus so a mix duck does not touch it.
     */
    bell(context, time, midi: number, vel: number) {
      const output = musicOut();
      if (!output) return;
      playPartials(context, time, midiToFreq(midi), STRIKE_BELL_PARTIALS, 0.17 * vel, 0.003, output, sends(0, 0.6));
      noiseBurst(context, time, { type: 'bandpass', frequency: 1800, Q: 1, gain: 0.17 * vel, decay: 0.05, destination: output, sends: sends(0, 0.4) });
      noiseBurst(context, time, { type: 'lowpass', frequency: 300, gain: 0.2 * vel, decay: 0.12, destination: output });
      fallingSine(context, time, 70, 40, 0.3, 0.2 * vel, 0.5, output);
    },

    /** One boss ring: a brighter additive bell whose prime sits on `midi`. */
    bossBell(context, time, midi: number, vel: number) {
      const output = sfxOut();
      if (!output) return;
      playPartials(context, time, midiToFreq(midi), BOSS_BELL_PARTIALS, 0.22 * vel, 0.003, output, sends(0, 0.55));
      noiseBurst(context, time, { type: 'bandpass', frequency: 3000, Q: 2, gain: 0.25 * vel, decay: 0.03, destination: output });
    },

    /**
     * Small silver chime: the player's melodic voice. `bright` scales the
     * upper partials, `decay` the ring, `hall` the reverb send.
     */
    chime(context, time, midi: number, vel: number, bright: number, decay: number, gain: number, hall: number) {
      const output = sfxOut();
      if (!output) return;
      playPartials(context, time, midiToFreq(midi), [
        { ratio: 0.5, gain: 0.45, decay: 0.55 },
        { ratio: 1, gain: 1, decay: 1 },
        { ratio: 2.76, gain: 0.25 + 0.3 * bright, decay: 0.45 },
        { ratio: 5.4, gain: 0.05 + 0.2 * bright, decay: 0.22 },
        { ratio: 8.9, gain: 0.02 + 0.08 * bright, decay: 0.1 },
      ], gain * vel, 0.002, output, sends(0.35, hall), decay);
      noiseBurst(context, time, { type: 'highpass', frequency: 5000, gain: 0.12 * vel * bright, decay: 0.01, destination: output });
    },

    /** Gear hand-off: a band-passed noise sweep that peaks 45% of the way through. */
    whoosh(context, time, duration: number, level: number) {
      const output = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      const peak = time + duration * 0.45;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequency: 300,
          frequencyAutomation: [
            { type: 'exponentialRamp', value: 2400, time: peak },
            { type: 'exponentialRamp', value: 300, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: peak },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
    },

    /** Noise riser into a downbeat. */
    riser(context, time, duration: number, level: number) {
      const output = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.1,
          frequency: 220,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 7000, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    /** Fire: a spring release. A triangle zips up from `midi`, over a twang and a hiss. */
    spring(context, time, midi: number, vel: number) {
      const output = sfxOut();
      if (!output) return;
      const frequency = midiToFreq(midi);
      const zip = context.createOscillator();
      zip.type = 'triangle';
      zip.frequency.setValueAtTime(frequency, time);
      zip.frequency.exponentialRampToValueAtTime(frequency * 2.4, time + 0.07);
      const zipFilter = context.createBiquadFilter();
      zipFilter.type = 'lowpass';
      zipFilter.frequency.value = 3800;
      const zipEnv = context.createGain();
      zipEnv.gain.setValueAtTime(0.07 * vel, time);
      zipEnv.gain.exponentialRampToValueAtTime(0.0005, time + 0.09);
      zip.connect(zipFilter).connect(zipEnv);
      route(context, zipEnv, output, sends(0.15, 0.08));
      zip.start(time);
      zip.stop(time + 0.12);

      const twang = context.createOscillator();
      twang.type = 'sawtooth';
      twang.frequency.value = frequency * 1.5;
      const twangFilter = context.createBiquadFilter();
      twangFilter.type = 'bandpass';
      twangFilter.frequency.value = 1800;
      twangFilter.Q.value = 8;
      const twangEnv = context.createGain();
      twangEnv.gain.setValueAtTime(0.04 * vel, time);
      twangEnv.gain.exponentialRampToValueAtTime(0.0005, time + 0.05);
      twang.connect(twangFilter).connect(twangEnv).connect(output);
      twang.start(time);
      twang.stop(time + 0.08);
      noiseBurst(context, time, { type: 'highpass', frequency: 5000, gain: 0.03 * vel, decay: 0.004, destination: output });
    },

    /** Lock: an escapement click pitched on `midi`, with a low-pass at `cutoff`. */
    click(context, time, midi: number, cutoff: number, gain: number, weight: number) {
      const output = sfxOut();
      if (!output) return;
      const frequency = midiToFreq(midi);
      const sendList = sends(0.25, 0.1);
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.value = frequency;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const env = context.createGain();
      env.gain.setValueAtTime(gain * weight, time);
      env.gain.exponentialRampToValueAtTime(0.0005, time + 0.07);
      osc.connect(filter).connect(env);
      route(context, env, output, sendList);
      osc.start(time);
      osc.stop(time + 0.1);
      playPartials(context, time, frequency * 2, [{ ratio: 1, gain: 1, decay: 0.05 }], 0.03 * weight, 0.001, output, sendList);
      noiseBurst(context, time, { type: 'bandpass', frequency: 3600, Q: 4, gain: 0.08 * weight, decay: 0.006, destination: output });
    },

    /** Reject: a dead pawl. A dull thump with an out-of-tune sibling and no ring. */
    deadPawl(context, time, vel: number) {
      const output = sfxOut();
      if (!output) return;
      noiseBurst(context, time, { type: 'lowpass', frequency: 380, gain: 0.32 * vel, decay: 0.07, destination: output });
      noiseBurst(context, time, { type: 'bandpass', frequency: 700, Q: 3, gain: 0.14 * vel, decay: 0.04, destination: output });
      fallingSine(context, time, 105, 62, 0.1, 0.25 * vel, 0.12, output);
      fallingSine(context, time + 0.01, 98, 60, 0.08, 0.12 * vel, 0.09, output);
    },

    /**
     * Jewel break: a fork tip shears (a resonant scrape and a glass crack) and
     * a crown-wheel plate falls into the void (wobbling steel, pitch and level
     * fading over 1.4 s).
     */
    shear(context, time, vel: number) {
      const output = sfxOut();
      if (!output) return;
      noiseBurst(context, time, { type: 'bandpass', frequency: 5200, frequencyEnd: 1400, Q: 9, gain: 0.3 * vel, decay: 0.28, destination: output, sends: sends(0, 0.4) });
      playPartials(context, time, 6200, [
        { ratio: 1, gain: 1, decay: 0.06 },
        { ratio: 1.41, gain: 0.7, decay: 0.05 },
        { ratio: 1.93, gain: 0.5, decay: 0.04 },
      ], 0.2 * vel, 0.001, output, []);

      const plateStart = time + 0.12;
      const plateEnd = plateStart + 1.4;
      const plate = context.createGain();
      plate.gain.setValueAtTime(0.18 * vel, plateStart);
      plate.gain.exponentialRampToValueAtTime(0.0005, plateEnd);
      route(context, plate, output, sends(0, 0.6));
      const wobble = context.createOscillator();
      wobble.frequency.value = 9;
      const wobbleDepth = context.createGain();
      wobbleDepth.gain.value = 0.06 * vel;
      wobble.connect(wobbleDepth).connect(plate.gain);
      wobble.start(plateStart);
      wobble.stop(plateEnd);
      for (const ratio of [1, 1.5, 2.3, 3.1]) {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520 * ratio, plateStart);
        osc.frequency.exponentialRampToValueAtTime(520 * ratio * 0.55, plateEnd);
        const env = context.createGain();
        env.gain.value = 1 / ratio;
        osc.connect(env).connect(plate);
        osc.start(plateStart);
        osc.stop(plateEnd + 0.03);
      }
    },

    /** Struck steel at `frequency`: the arbor hit, and the hull hit at a lower pitch. */
    clank(context, time, frequency: number, vel: number) {
      const output = sfxOut();
      if (!output) return;
      playPartials(context, time, frequency, STEEL_PARTIALS, 0.22 * vel, 0.002, output, sends(0, 0.35));
      noiseBurst(context, time, { type: 'bandpass', frequency: 2400, Q: 2, gain: 0.25 * vel, decay: 0.03, destination: output });
      fallingSine(context, time, 80, 50, 0.1, 0.25 * vel, 0.15, output);
    },

    /** Oxide tick leap: a fast upward zip and a click. */
    leap(context, time, vel: number) {
      const output = sfxOut();
      if (!output) return;
      const osc = context.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, time);
      osc.frequency.exponentialRampToValueAtTime(1400, time + 0.09);
      const env = context.createGain();
      env.gain.setValueAtTime(0.09 * vel, time);
      env.gain.exponentialRampToValueAtTime(0.0005, time + 0.12);
      osc.connect(env);
      route(context, env, output, sends(0.1, 0.1));
      osc.start(time);
      osc.stop(time + 0.15);
      noiseBurst(context, time, { type: 'bandpass', frequency: 3000, Q: 3, gain: 0.1 * vel, decay: 0.005, destination: output });
    },

    /** Jewel wasp bolt: a detuned sawtooth buzz falling three semitones under a white-hot hiss. */
    bolt(context, time, midi: number, vel: number) {
      const output = sfxOut();
      if (!output) return;
      const frequency = midiToFreq(midi);
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 2;
      const env = context.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.07 * vel, time + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0005, time + 0.32);
      filter.connect(env);
      route(context, env, output, sends(0.1, 0.15));
      for (const detune of [-12, 12]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(frequency, time);
        osc.frequency.exponentialRampToValueAtTime(frequency * 0.84, time + 0.3);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + 0.35);
      }
      noiseBurst(context, time, { type: 'highpass', frequency: 7000, gain: 0.09 * vel, decay: 0.35, destination: output });
    },

    /**
     * Mainspring wind: `clicks` ratchet clicks that start `spacing` seconds
     * apart and accelerate, under a low swell on `midi`.
     */
    wind(context, time, midi: number, clicks: number, spacing: number, accelerate: boolean) {
      const output = musicOut();
      if (!output) return;
      let at = time;
      let gap = spacing;
      for (let i = 0; i < clicks; i += 1) {
        noiseBurst(context, at, { type: 'bandpass', frequency: 2200 + i * 90, Q: 6, gain: 0.12, decay: 0.012, destination: output, sends: sends(0, 0.2) });
        at += gap;
        gap *= accelerate ? 0.86 : 1.16;
      }
      const duration = at - time + 0.6;
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = midiToFreq(midi);
      const env = context.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(accelerate ? 0.2 : 0.14, time + duration * 0.6);
      env.gain.linearRampToValueAtTime(0, time + duration);
      osc.connect(env).connect(output);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    },
  }, {
    tick: ['kind', 'vel', 'hall'],
    ratchet: ['vel', 'clicks', 'spacing', 'pan', 'where'],
    celesta: ['midi', 'vel', 'duration'],
    marimba: ['midi', 'vel'],
    harp: ['midi', 'vel', 'duration', 'hall'],
    pad: ['midis', 'duration', 'vel', 'cutoff', 'attack', 'release', 'hall'],
    swell: ['midi', 'duration', 'vel'],
    bass: ['midi', 'vel', 'duration', 'drive'],
    kick: ['vel', 'sidechain'],
    crack: ['vel'],
    bell: ['midi', 'vel'],
    bossBell: ['midi', 'vel'],
    chime: ['midi', 'vel', 'bright', 'decay', 'gain', 'hall'],
    whoosh: ['duration', 'level'],
    riser: ['duration', 'level'],
    spring: ['midi', 'vel'],
    click: ['midi', 'cutoff', 'gain', 'weight'],
    deadPawl: ['vel'],
    shear: ['vel'],
    clank: ['frequency', 'vel'],
    leap: ['vel'],
    bolt: ['midi', 'vel'],
    wind: ['midi', 'clicks', 'spacing', 'accelerate'],
  });

  /** A player-bus noise transient outside the instrument registry, for sparkle under other voices. */
  function sparkle(time: number, vel: number, decay: number, frequency: number) {
    const context = environment.context();
    const output = sfxOut();
    if (!context || !output) return;
    noiseBurst(context, time, { type: 'highpass', frequency, gain: vel, decay, destination: output });
  }

  return { ...instruments, sparkle };
}

export type EscapementVoices = ReturnType<typeof createEscapementVoices>;
