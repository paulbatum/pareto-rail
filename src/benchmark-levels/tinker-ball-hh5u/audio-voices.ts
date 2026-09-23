import {
  defineInstruments,
  playBufferSourceVoice,
  playNoiseHit,
  playOscillatorVoice,
  type AutomationStep,
  type MixBus,
} from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf: Tinker Ball's instruments. Bell-like mallets, clipped reed-organ
// stabs, a bouncy synth bass, handclaps, and tiny workshop percussion — a
// table thump for a kick, rulers, pins, wood blocks, a tape-measure zip.
// Every function here takes its pitch, time, and level from the score; none
// of them decides what to play.

export type Partial = { ratio: number; gain: number; decay: number; type?: OscillatorType };

export type BellSpec = {
  partials: Partial[];
  /** Noise click at the strike: [gain, decay, highpass Hz]. */
  click: [number, number, number];
  /** Soft detuned twin for vibraphone-style beating (cents), or 0. */
  beat: number;
  gain: number;
  send: number;
};

export type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createTinkerVoices(environment: VoiceEnvironment) {
  const music = () => environment.mix()?.duck ?? environment.mix()?.master ?? null;
  const dry = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfx = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const delaySends = (gain: number) => {
    const send = environment.mix()?.delaySend;
    return send && gain > 0 ? [{ destination: send, gain }] : [];
  };
  const reverbSends = (gain: number) => {
    const send = environment.mix()?.reverbSend;
    return send && gain > 0 ? [{ destination: send, gain }] : [];
  };

  function noise(context: AudioContext, time: number, velocity: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const buffer = environment.mix()?.noiseBuffer;
    if (!buffer) return;
    playNoiseHit({ context, buffer, time, velocity, decay, filterType, frequency, destination, offset: Math.random() * 1.5 });
  }

  function partials(context: AudioContext, time: number, frequency: number, list: Partial[], gain: number, destination: AudioNode, sends: Array<{ destination: AudioNode; gain: number }> = []) {
    for (const p of list) {
      const g = gain * p.gain;
      if (g < 1e-4) continue;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + p.decay + 0.05,
        oscillatorType: p.type ?? 'sine',
        frequency: frequency * p.ratio,
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: g, time: time + 0.002 },
          { type: 'exponentialRamp', value: 0.0005, time: time + p.decay },
        ],
        destination,
        sends,
      });
    }
  }

  function bell(context: AudioContext, time: number, midi: number, spec: BellSpec, velocity: number, destination: AudioNode, sendScale = 1) {
    const frequency = midiToFreq(midi);
    const sends = [...delaySends(spec.send * sendScale), ...reverbSends(spec.send * 0.6 * sendScale)];
    partials(context, time, frequency, spec.partials, spec.gain * velocity, destination, sends);
    if (spec.beat) partials(context, time, frequency * 2 ** (spec.beat / 1200), spec.partials.slice(0, 1), spec.gain * velocity * 0.6, destination, sends);
    const [clickGain, clickDecay, clickHz] = spec.click;
    if (clickGain > 0) noise(context, time, clickGain * velocity, clickDecay, 'highpass', clickHz, destination);
  }

  // ── The backing band (traced) ───────────────────────────────────────────
  const band = defineInstruments({ trace: environment.trace, context: environment.context }, {
    /** A fist on the tabletop: a pitched thump with a wooden knock. */
    kick(context, time, vel) {
      const out = dry();
      const mix = environment.mix();
      if (!out || !mix) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.34,
        oscillatorType: 'sine',
        frequency: 150,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 44, time: time + 0.13 }],
        gainAutomation: [
          { type: 'set', value: 0.85 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
        ],
        destination: out,
      });
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.07,
        oscillatorType: 'triangle',
        frequency: 360,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 190, time: time + 0.04 }],
        gainAutomation: [
          { type: 'set', value: 0.16 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.05 },
        ],
        destination: out,
      });
      noise(context, time, 0.07 * vel, 0.025, 'bandpass', 1400, out);
      mix.duckAt(time, 0.5, 0.2);
    },

    /** Three slapped hands and a short room tail. */
    clap(context, time, vel) {
      const out = music();
      if (!out) return;
      for (const [offset, gain] of [[0, 0.26], [0.011, 0.22], [0.023, 0.3]] as const) {
        noise(context, time + offset, gain * vel, 0.018, 'bandpass', 1350 + offset * 9000, out);
      }
      noise(context, time + 0.03, 0.16 * vel, 0.14, 'bandpass', 1750, out);
    },

    /** A needle-thin tick: closed-hat duty. */
    tick(context, time, vel) {
      const out = music();
      if (out) noise(context, time, vel, 0.022, 'highpass', 8200, out);
    },

    /** A tin of screws, shaken. */
    shaker(context, time, vel) {
      const out = music();
      if (!out) return;
      noise(context, time, vel * 0.6, 0.02, 'bandpass', 5200, out);
      noise(context, time + 0.012, vel, 0.05, 'bandpass', 6400, out);
    },

    /** A wooden block, pitched. */
    woodblock(context, time, midi, vel) {
      const out = music();
      if (!out) return;
      partials(context, time, midiToFreq(midi), [
        { ratio: 1, gain: 1, decay: 0.07 },
        { ratio: 2.9, gain: 0.3, decay: 0.03, type: 'triangle' },
      ], 0.16 * vel, out);
    },

    /** A pin dropped on the table: a tiny high ring. */
    tink(context, time, midi, vel) {
      const out = music();
      if (!out) return;
      partials(context, time, midiToFreq(midi), [
        { ratio: 1, gain: 1, decay: 0.32 },
        { ratio: 2.76, gain: 0.4, decay: 0.1 },
      ], 0.05 * vel, out, delaySends(0.4));
    },

    /** The ruler flicked off the table edge: a twang with a falling pitch. */
    twang(context, time, midi, vel) {
      const out = music();
      if (!out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 5),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi), time: time + 0.08 }],
        filter: { type: 'lowpass', frequency: 1800, Q: 6 },
        gainAutomation: [
          { type: 'set', value: 0.05 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
        ],
        destination: out,
      });
    },

    /** Bouncy synth bass: a quick scoop up into each note, a plucked filter. */
    bass(context, time, midi, vel, length) {
      const out = music();
      if (!out) return;
      const f = midiToFreq(midi);
      const end = time + Math.max(0.08, length);
      for (const [type, gain, detune] of [['square', 0.11, -4], ['sawtooth', 0.07, 5]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: end + 0.05,
          oscillatorType: type,
          frequency: f * 0.84,
          detune,
          frequencyAutomation: [{ type: 'exponentialRamp', value: f, time: time + 0.028 }],
          filter: {
            type: 'lowpass',
            Q: 7,
            frequencyAutomation: [
              { type: 'set', value: 260 + vel * 1500, time },
              { type: 'exponentialRamp', value: 240, time: time + 0.16 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: gain * vel, time: time + 0.006 },
            { type: 'linearRamp', value: gain * vel * 0.55, time: time + 0.1 },
            { type: 'exponentialRamp', value: 0.001, time: end },
          ],
          destination: out,
        });
      }
      playOscillatorVoice({
        context,
        time,
        stopTime: end + 0.05,
        oscillatorType: 'sine',
        frequency: f / 2 < 30 ? f : f / 2,
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: 0.22 * vel, time: time + 0.01 },
          { type: 'exponentialRamp', value: 0.001, time: end },
        ],
        destination: out,
      });
    },

    /** Clipped reed-organ stab: nasal, bright, and cut short. */
    stab(context, time, midis, vel, brightness) {
      const out = music();
      if (!out) return;
      for (const midi of midis as number[]) {
        for (const [type, detune] of [['square', -7], ['sawtooth', 6]] as const) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + 0.2,
            oscillatorType: type,
            frequency: midiToFreq(midi),
            detune,
            filter: { type: 'lowpass', frequency: 1300 + brightness * 1600, Q: 1.5 },
            gainAutomation: [
              { type: 'set', value: 0, time },
              { type: 'linearRamp', value: 0.02 * vel, time: time + 0.004 },
              { type: 'linearRamp', value: 0.017 * vel, time: time + 0.07 },
              { type: 'exponentialRamp', value: 0.0008, time: time + 0.15 },
            ],
            destination: out,
            sends: delaySends(0.12),
          });
        }
      }
    },

    /** A held reed-organ chord that breathes in and out. */
    organ(context, time, midis, duration, vel) {
      const out = music();
      if (!out) return;
      for (const midi of midis as number[]) {
        for (const detune of [-8, 8]) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + duration + 0.3,
            oscillatorType: 'square',
            frequency: midiToFreq(midi),
            detune,
            filter: { type: 'lowpass', frequency: 1100, Q: 0.8 },
            gainAutomation: [
              { type: 'set', value: 0, time },
              { type: 'linearRamp', value: 0.013 * vel, time: time + 0.12 },
              { type: 'linearRamp', value: 0.011 * vel, time: time + duration },
              { type: 'linearRamp', value: 0, time: time + duration + 0.25 },
            ],
            destination: out,
            sends: reverbSends(0.25),
          });
        }
      }
    },

    /** The backing mallet: a soft marimba in the middle register. */
    mallet(context, time, midi, vel) {
      const out = music();
      if (!out) return;
      partials(context, time, midiToFreq(midi), [
        { ratio: 1, gain: 1, decay: 0.42 },
        { ratio: 3.93, gain: 0.3, decay: 0.07 },
        { ratio: 9.8, gain: 0.07, decay: 0.02 },
      ], 0.1 * vel, out, delaySends(0.18));
    },

    /** Tape measure: a ratchet that speeds up and a zipping sweep. */
    zip(context, time, duration) {
      const out = music();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      let t = time;
      let gap = 0.09;
      while (t < time + duration) {
        noise(context, t, 0.07, 0.012, 'bandpass', 3800, out);
        t += gap;
        gap = Math.max(0.018, gap * 0.86);
      }
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.05,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 2.5,
          frequencyAutomation: [
            { type: 'set', value: 600, time },
            { type: 'exponentialRamp', value: 7000, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.09, time: time + duration * 0.95 },
          { type: 'linearRamp', value: 0, time: time + duration + 0.04 },
        ],
        destination: out,
      });
    },

    /** A bubble of glue rising and popping. */
    bubble(context, time, midi, vel) {
      const out = music();
      if (!out) return;
      const f = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.14,
        oscillatorType: 'sine',
        frequency: f,
        frequencyAutomation: [{ type: 'exponentialRamp', value: f * 2.8, time: time + 0.07 }],
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: 0.12 * vel, time: time + 0.01 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
        ],
        destination: out,
        sends: delaySends(0.2),
      });
    },

    /** The spill's low, sticky drone. */
    drone(context, time, midi, duration, vel) {
      const out = music();
      if (!out) return;
      for (const detune of [-11, 0, 13]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + duration + 0.2,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            Q: 4,
            frequencyAutomation: [
              { type: 'set', value: 140, time },
              { type: 'linearRamp', value: 520, time: time + duration * 0.5 },
              { type: 'linearRamp', value: 160, time: time + duration },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: 0.05 * vel, time: time + 0.25 },
            { type: 'linearRamp', value: 0.04 * vel, time: time + duration },
            { type: 'linearRamp', value: 0, time: time + duration + 0.15 },
          ],
          destination: out,
        });
      }
    },

    /** A noise swell for the approach to a downbeat. */
    riser(context, time, duration) {
      const out = music();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequencyAutomation: [
            { type: 'set', value: 350, time },
            { type: 'exponentialRamp', value: 6000, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.1, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: out,
      });
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    tick: ['vel'],
    shaker: ['vel'],
    woodblock: ['midi', 'vel'],
    tink: ['midi', 'vel'],
    twang: ['midi', 'vel'],
    bass: ['midi', 'vel', 'length'],
    stab: ['midis', 'vel', 'brightness'],
    organ: ['midis', 'duration', 'vel'],
    mallet: ['midi', 'vel'],
    zip: ['duration'],
    bubble: ['midi', 'vel'],
    drone: ['midi', 'duration', 'vel'],
    riser: ['duration'],
  });

  // ── The player's instruments (sfx bus) ──────────────────────────────────
  const player = {
    bell(time: number, midi: number, spec: BellSpec, velocity: number, sendScale = 1) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      bell(context, time, midi, spec, velocity, out, sendScale);
    },

    /** A glue core popping: a soft low plop under the bell. */
    plop(time: number, midi: number, velocity: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      const f = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.12,
        oscillatorType: 'sine',
        frequency: f * 1.6,
        frequencyAutomation: [{ type: 'exponentialRamp', value: f * 0.7, time: time + 0.08 }],
        gainAutomation: [
          { type: 'set', value: 0.14 * velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
        ],
        destination: out,
      });
    },

    /** Lock: a small struck tick, climbing with each lock. */
    lock(time: number, midi: number, spec: BellSpec, velocity: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      bell(context, time, midi, spec, velocity, out, 0.5);
    },

    /** Release: a spritz of solvent — a spray hiss over a pitched flick. */
    spritz(time: number, rootMidi: number, velocity: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      noise(context, time, 0.09 * velocity, 0.07, 'highpass', 5200, out);
      noise(context, time + 0.01, 0.05 * velocity, 0.05, 'bandpass', 2600, out);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.08,
        oscillatorType: 'triangle',
        frequency: midiToFreq(rootMidi + 31),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(rootMidi + 24), time: time + 0.05 }],
        gainAutomation: [
          { type: 'set', value: 0.06 * velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
        ],
        destination: out,
      });
    },

    /** A non-lethal crack on a shell: a pitched wood block and a splinter. */
    crack(time: number, midi: number, velocity: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      partials(context, time, midiToFreq(midi), [
        { ratio: 1, gain: 1, decay: 0.09 },
        { ratio: 2.7, gain: 0.4, decay: 0.04, type: 'triangle' },
      ], 0.14 * velocity, out, delaySends(0.2));
      noise(context, time, 0.08 * velocity, 0.03, 'bandpass', 3200, out);
    },

    /** A piece sticking to the ball: a music-box patter note. */
    pickup(time: number, midi: number, velocity: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      partials(context, time, midiToFreq(midi), [
        { ratio: 1, gain: 1, decay: 0.14 },
        { ratio: 3, gain: 0.25, decay: 0.05 },
      ], 0.032 * velocity, out, delaySends(0.3));
      noise(context, time, 0.012 * velocity, 0.01, 'highpass', 6000, out);
    },

    /** Rejected release: a dull clunk and a sproing that sags out of key. */
    reject(time: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.14,
        oscillatorType: 'sine',
        frequency: 110,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 60, time: time + 0.1 }],
        gainAutomation: [
          { type: 'set', value: 0.3, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
        ],
        destination: out,
      });
      noise(context, time, 0.12, 0.05, 'lowpass', 500, out);
      const sproing: AutomationStep[] = [];
      for (let i = 0; i <= 10; i += 1) {
        const t = time + 0.02 + i * 0.026;
        const base = 470 * 0.93 ** i;
        sproing.push({ type: 'linearRamp', value: base * (i % 2 === 0 ? 1.06 : 0.94), time: t });
      }
      playOscillatorVoice({
        context,
        time: time + 0.02,
        stopTime: time + 0.34,
        oscillatorType: 'triangle',
        frequency: 470,
        frequencyAutomation: sproing,
        gainAutomation: [
          { type: 'set', value: 0.09, time: time + 0.02 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
        ],
        destination: out,
      });
    },

    /** An escapee: a small falling kazoo sigh. */
    miss(time: number, midi: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.24,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - 5), time: time + 0.2 }],
        filter: { type: 'bandpass', frequency: 900, Q: 3 },
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: 0.035, time: time + 0.02 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
        ],
        destination: out,
      });
    },

    /** A glob of glue on the lens: a wet splat and a sour organ cluster. */
    splat(time: number, rootMidi: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      noise(context, time, 0.5, 0.3, 'lowpass', 520, out);
      noise(context, time + 0.02, 0.2, 0.18, 'bandpass', 1500, out);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sine',
        frequency: 190,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 70, time: time + 0.22 }],
        gainAutomation: [
          { type: 'set', value: 0.35, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
        ],
        destination: out,
      });
      for (const offset of [0, 1, 6]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 0.45,
          oscillatorType: 'square',
          frequency: midiToFreq(rootMidi + 12 + offset),
          filter: { type: 'lowpass', frequency: 1200 },
          gainAutomation: [
            { type: 'set', value: 0.035, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
          ],
          destination: out,
        });
      }
    },

    /** Size-up: a rubbery boing that swells into the new key. */
    swell(time: number, fromMidi: number, toMidi: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.75,
        oscillatorType: 'triangle',
        frequency: midiToFreq(fromMidi),
        frequencyAutomation: [
          { type: 'exponentialRamp', value: midiToFreq(toMidi + 12), time: time + 0.35 },
          { type: 'exponentialRamp', value: midiToFreq(toMidi), time: time + 0.55 },
        ],
        filter: { type: 'lowpass', frequency: 2400 },
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: 0.13, time: time + 0.05 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.72 },
        ],
        destination: out,
        sends: delaySends(0.3),
      });
      noise(context, time + 0.3, 0.1, 0.5, 'highpass', 6500, out);
    },

    /** A great hanging bell: the heart's killing blow and the spill's last word. */
    gong(time: number, midi: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      partials(context, time, midiToFreq(midi), [
        { ratio: 1, gain: 1, decay: 3.2 },
        { ratio: 2.02, gain: 0.5, decay: 2.4 },
        { ratio: 2.98, gain: 0.35, decay: 1.8 },
        { ratio: 4.16, gain: 0.25, decay: 1.2 },
        { ratio: 5.43, gain: 0.18, decay: 0.8 },
        { ratio: 6.8, gain: 0.1, decay: 0.5 },
      ], 0.2, out, [...delaySends(0.3), ...reverbSends(0.5)]);
      noise(context, time, 0.18, 0.8, 'highpass', 5000, out);
    },

    /** Organ stab on the sfx bus (volley flourishes, shell cracks). */
    stab(time: number, midis: number[], velocity: number, brightness: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      for (const midi of midis) {
        for (const [type, detune] of [['square', -7], ['sawtooth', 7]] as const) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + 0.32,
            oscillatorType: type,
            frequency: midiToFreq(midi),
            detune,
            filter: { type: 'lowpass', frequency: 1500 + brightness * 2400, Q: 1.2 },
            gainAutomation: [
              { type: 'set', value: 0, time },
              { type: 'linearRamp', value: 0.03 * velocity, time: time + 0.005 },
              { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
            ],
            destination: out,
            sends: delaySends(0.25),
          });
        }
      }
    },

    /** Handclaps on the sfx bus: the table applauds a clean sweep. */
    applause(time: number, velocity: number) {
      const context = environment.context();
      const out = sfx();
      if (!context || !out) return;
      for (const [offset, gain] of [[0, 0.24], [0.012, 0.2], [0.024, 0.28]] as const) {
        noise(context, time + offset, gain * velocity, 0.02, 'bandpass', 1500, out);
      }
      noise(context, time + 0.03, 0.14 * velocity, 0.16, 'bandpass', 1900, out);
    },
  };

  return { band, player };
}
