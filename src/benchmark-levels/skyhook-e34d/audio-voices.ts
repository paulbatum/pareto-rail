import { defineInstruments, playOscillatorVoice, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Synth construction for Skyhook. Every function takes its musical decisions
// (pitch, velocity, brightness, air) as arguments; the score in audio.ts
// decides what plays when.

export type PlayerTimbre = {
  /** Oscillator for the body of the note. */
  wave: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  /** FM bell brightness; 0 = plain oscillator. */
  bell: number;
  /** Reverb and delay sends: thick air rings, vacuum is bone dry. */
  reverb: number;
  delay: number;
  /** Structure-borne thump under the note: what the hull conducts in vacuum. */
  thump: number;
};

export type SkyhookVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
  /** 0..1 how much air there is right now: scales every reverb send. */
  air(time: number): number;
};

export type AirBed = {
  set(time: number, level: number, brightness: number, ramp: number): void;
  gust(time: number, amount: number, seconds: number): void;
};

/** Continuous wind: looping noise through a wandering band-pass. */
export function installAirBed(context: AudioContext, mix: MixBus): AirBed {
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer ?? null;
  source.loop = true;
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 520;
  band.Q.value = 0.7;
  const low = context.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 1800;
  const gain = context.createGain();
  gain.gain.value = 0;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.09;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 260;
  lfo.connect(lfoDepth).connect(band.frequency);
  const panner = context.createStereoPanner();
  const panLfo = context.createOscillator();
  panLfo.frequency.value = 0.05;
  const panDepth = context.createGain();
  panDepth.gain.value = 0.6;
  panLfo.connect(panDepth).connect(panner.pan);
  source.connect(band).connect(low).connect(gain).connect(panner).connect(mix.music);
  source.start();
  lfo.start();
  panLfo.start();
  return {
    set(time, level, brightness, ramp) {
      gain.gain.cancelScheduledValues(time);
      gain.gain.setTargetAtTime(level, time, ramp);
      low.frequency.setTargetAtTime(600 + brightness * 3400, time, ramp);
    },
    gust(time, amount, seconds) {
      band.frequency.setTargetAtTime(420 + amount * 900, time, seconds * 0.3);
      band.frequency.setTargetAtTime(520, time + seconds * 0.6, seconds * 0.4);
    },
  };
}

export function createSkyhookVoices(env: SkyhookVoiceEnvironment) {
  const music = () => env.mix()?.music ?? null;
  const sfx = () => env.mix()?.sfx ?? null;

  function sends(time: number, reverb: number, delay: number) {
    const mix = env.mix();
    const air = env.air(time);
    const result: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.reverbSend && reverb > 0) result.push({ destination: mix.reverbSend, gain: reverb * (0.15 + air * 0.85) });
    if (mix?.delaySend && delay > 0) result.push({ destination: mix.delaySend, gain: delay * (0.3 + air * 0.7) });
    return result;
  }

  function panned(context: AudioContext, destination: AudioNode, pan: number) {
    const node = context.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(destination);
    return node;
  }

  function noise(context: AudioContext, time: number, seconds: number, filter: BiquadFilterType, frequency: number, q: number, gainSteps: Array<[number, number]>, destination: AudioNode, sweepTo?: number, sendReverb = 0) {
    const buffer = env.mix()?.noiseBuffer;
    if (!buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const bq = context.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(frequency, time);
    if (sweepTo !== undefined) bq.frequency.exponentialRampToValueAtTime(sweepTo, time + seconds);
    bq.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    for (const [at, value] of gainSteps) gain.gain.linearRampToValueAtTime(value, time + at);
    source.connect(bq).connect(gain).connect(destination);
    if (sendReverb > 0) {
      for (const send of sends(time, sendReverb, 0)) {
        const g = context.createGain();
        g.gain.value = send.gain;
        gain.connect(g).connect(send.destination);
      }
    }
    source.start(time, Math.random() * 1.2);
    source.stop(time + seconds + 0.05);
  }

  /** Two-operator FM: the bells, the kills, the vacuum's radio tones. */
  function fm(context: AudioContext, time: number, frequency: number, ratio: number, index: number, decay: number, gain: number, destination: AudioNode, sendList: Array<{ destination: AudioNode; gain: number }> = []) {
    const carrier = context.createOscillator();
    carrier.frequency.value = frequency;
    const modulator = context.createOscillator();
    modulator.frequency.value = frequency * ratio;
    const depth = context.createGain();
    depth.gain.setValueAtTime(frequency * index, time);
    depth.gain.exponentialRampToValueAtTime(Math.max(0.01, frequency * index * 0.05), time + decay * 0.6);
    modulator.connect(depth).connect(carrier.frequency);
    const amp = context.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(gain, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    carrier.connect(amp).connect(destination);
    for (const send of sendList) {
      const g = context.createGain();
      g.gain.value = send.gain;
      amp.connect(g).connect(send.destination);
    }
    carrier.start(time);
    modulator.start(time);
    carrier.stop(time + decay + 0.05);
    modulator.stop(time + decay + 0.05);
    return [carrier, modulator];
  }

  const instruments = defineInstruments(env, {
    pad(context: AudioContext, time: number, notes: number[], seconds: number, vel: number, bright: number, width: number) {
      const out = music();
      if (!out) return;
      notes.forEach((midi, i) => {
        const pan = notes.length === 1 ? 0 : ((i / (notes.length - 1)) * 2 - 1) * width;
        const dest = panned(context, out, pan);
        for (const [wave, detune, level] of [['sawtooth', -7, 0.5], ['triangle', 6, 1]] as const) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + seconds + 0.1,
            oscillatorType: wave,
            frequency: midiToFreq(midi),
            detune,
            filter: { type: 'lowpass', frequency: 500 + bright * 2600, Q: 0.4 },
            gainAutomation: [
              { type: 'set', value: 0.0001, time },
              { type: 'linearRamp', value: 0.03 * vel * level, time: time + Math.min(1.2, seconds * 0.35) },
              { type: 'linearRamp', value: 0.024 * vel * level, time: time + seconds * 0.7 },
              { type: 'linearRamp', value: 0.0001, time: time + seconds },
            ],
            destination: dest,
            sends: sends(time, 0.9, 0.1),
          });
        }
      });
    },

    rain(context: AudioContext, time: number, midi: number, vel: number, pan: number) {
      const out = music();
      if (!out) return;
      const dest = panned(context, out, pan);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.4,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'highpass', frequency: 280 },
        gainAutomation: [
          { type: 'set', value: 0.05 * vel, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.32 },
        ],
        destination: dest,
        sends: sends(time, 0.5, 0.45),
      });
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.15,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi + 12),
        gainAutomation: [
          { type: 'set', value: 0.02 * vel, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.12 },
        ],
        destination: dest,
      });
    },

    thunder(context: AudioContext, time: number, vel: number) {
      const out = music();
      if (!out) return;
      noise(context, time, 3.2, 'lowpass', 320, 0.5, [[0.03, 0.34 * vel], [0.5, 0.2 * vel], [3.1, 0.0001]], out, 70, 0.6);
      noise(context, time, 0.35, 'bandpass', 1800, 0.8, [[0.005, 0.12 * vel], [0.3, 0.0001]], out);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 1.6,
        oscillatorType: 'sine',
        frequency: 58,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 32, time: time + 1.4 }],
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.3 * vel, time: time + 0.04 },
          { type: 'exponentialRamp', value: 0.0001, time: time + 1.5 },
        ],
        destination: out,
      });
    },

    kick(context: AudioContext, time: number, vel: number) {
      const out = music();
      if (!out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.4,
        oscillatorType: 'sine',
        frequency: 110,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 42, time: time + 0.16 }],
        gainAutomation: [
          { type: 'set', value: 0.5 * vel, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.38 },
        ],
        destination: out,
      });
      noise(context, time, 0.03, 'highpass', 2400, 0.7, [[0.002, 0.05 * vel], [0.025, 0.0001]], out);
    },

    tom(context: AudioContext, time: number, midi: number, vel: number) {
      const out = music();
      if (!out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.7,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi + 12),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi), time: time + 0.2 }],
        gainAutomation: [
          { type: 'set', value: 0.26 * vel, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.65 },
        ],
        destination: out,
        sends: sends(time, 0.5, 0),
      });
    },

    snap(context: AudioContext, time: number, vel: number) {
      const out = music();
      if (!out) return;
      noise(context, time, 0.2, 'bandpass', 1900, 1.1, [[0.003, 0.2 * vel], [0.18, 0.0001]], out, 1200, 0.5);
    },

    hat(context: AudioContext, time: number, vel: number, pan: number) {
      const out = music();
      if (!out) return;
      noise(context, time, 0.06, 'highpass', 7200, 0.7, [[0.002, 0.06 * vel], [0.05, 0.0001]], panned(context, out, pan));
    },

    bass(context: AudioContext, time: number, midi: number, seconds: number, vel: number, cutoff: number) {
      const out = music();
      if (!out) return;
      for (const [wave, level, octave] of [['sine', 1, 0], ['sawtooth', 0.35, 0]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + seconds + 0.1,
          oscillatorType: wave,
          frequency: midiToFreq(midi + octave),
          filter: { type: 'lowpass', frequency: cutoff, Q: 1.2 },
          gainAutomation: [
            { type: 'set', value: 0.0001, time },
            { type: 'linearRamp', value: 0.2 * vel * level, time: time + 0.012 },
            { type: 'exponentialRamp', value: 0.09 * vel * level, time: time + seconds * 0.6 },
            { type: 'exponentialRamp', value: 0.0001, time: time + seconds },
          ],
          destination: out,
        });
      }
    },

    bell(context: AudioContext, time: number, midi: number, vel: number, decay: number, pan: number) {
      const out = music();
      if (!out) return;
      fm(context, time, midiToFreq(midi), 3.5, 1.6, decay, 0.045 * vel, panned(context, out, pan), sends(time, 0.55, 0.4));
    },

    sub(context: AudioContext, time: number, midi: number, vel: number) {
      const out = music();
      if (!out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.6,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi) * 0.8, time: time + 0.5 }],
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.34 * vel, time: time + 0.03 },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.55 },
        ],
        destination: out,
      });
    },

    drone(context: AudioContext, time: number, midi: number, seconds: number, vel: number) {
      const out = music();
      if (!out) return;
      const { oscillator } = playOscillatorVoice({
        context,
        time,
        stopTime: time + seconds + 0.1,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.018 * vel, time: time + seconds * 0.4 },
          { type: 'linearRamp', value: 0.0001, time: time + seconds },
        ],
        destination: out,
      });
      const vibrato = context.createOscillator();
      vibrato.frequency.value = 4.6;
      const depth = context.createGain();
      depth.gain.value = midiToFreq(midi) * 0.004;
      vibrato.connect(depth).connect(oscillator.frequency);
      vibrato.start(time);
      vibrato.stop(time + seconds + 0.1);
    },

    riser(context: AudioContext, time: number, seconds: number, vel: number) {
      const out = music();
      if (!out) return;
      noise(context, time, seconds, 'bandpass', 300, 2.5, [[seconds * 0.9, 0.22 * vel], [seconds, 0.0001]], out, 5200, 0.4);
    },

    whoosh(context: AudioContext, time: number, vel: number) {
      const out = music();
      if (!out) return;
      noise(context, time, 1.6, 'lowpass', 6000, 0.6, [[0.05, 0.4 * vel], [0.5, 0.25 * vel], [1.55, 0.0001]], out, 300, 0.8);
    },

    impact(context: AudioContext, time: number, vel: number) {
      const out = music();
      if (!out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 1.4,
        oscillatorType: 'sine',
        frequency: 90,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 30, time: time + 1.2 }],
        gainAutomation: [
          { type: 'set', value: 0.5 * vel, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 1.3 },
        ],
        destination: out,
      });
      noise(context, time, 1.8, 'highpass', 3000, 0.5, [[0.004, 0.14 * vel], [1.7, 0.0001]], out, undefined, 0.9);
    },

    /** The Descender's grip: iron conducted up the tether, muffled by distance. */
    clank(context: AudioContext, time: number, vel: number, muffle: number, midi: number) {
      const out = music();
      if (!out) return;
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 260 + muffle * 3800;
      lowpass.connect(out);
      const base = midiToFreq(midi);
      for (const [ratio, level, decay] of [[1, 1, 0.9], [2.76, 0.5, 0.5], [5.4, 0.28, 0.3], [8.93, 0.16, 0.18]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + decay + 0.05,
          oscillatorType: 'sine',
          frequency: base * ratio,
          gainAutomation: [
            { type: 'set', value: 0.16 * vel * level, time },
            { type: 'exponentialRamp', value: 0.0001, time: time + decay },
          ],
          destination: lowpass,
        });
      }
      noise(context, time, 0.12, 'bandpass', 900 + muffle * 1500, 1.2, [[0.002, 0.16 * vel], [0.1, 0.0001]], lowpass);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.35,
        oscillatorType: 'sine',
        frequency: 64,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 38, time: time + 0.25 }],
        gainAutomation: [
          { type: 'set', value: 0.4 * vel, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.3 },
        ],
        destination: out,
      });
    },

    /** Metal under load: a bowed glide, the tether groaning. */
    groan(context: AudioContext, time: number, midi: number, seconds: number, vel: number) {
      const out = music();
      if (!out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + seconds + 0.1,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 1),
        frequencyAutomation: [{ type: 'linearRamp', value: midiToFreq(midi), time: time + seconds }],
        filter: { type: 'bandpass', frequency: midiToFreq(midi) * 3, Q: 6 },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.06 * vel, time: time + seconds * 0.3 },
          { type: 'linearRamp', value: 0.0001, time: time + seconds },
        ],
        destination: out,
      });
    },

    /** The maw opening: a formant roar through the hull. */
    roar(context: AudioContext, time: number, midi: number, seconds: number, vel: number) {
      const out = music();
      if (!out) return;
      for (const detune of [-18, 0, 14]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + seconds + 0.1,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - 5), time: time + seconds }],
          filter: {
            type: 'bandpass',
            frequency: 380,
            Q: 3,
            frequencyAutomation: [
              { type: 'linearRamp', value: 1100, time: time + seconds * 0.3 },
              { type: 'linearRamp', value: 260, time: time + seconds },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.0001, time },
            { type: 'linearRamp', value: 0.11 * vel, time: time + 0.2 },
            { type: 'linearRamp', value: 0.0001, time: time + seconds },
          ],
          destination: out,
        });
      }
    },

    /** Motor whine conducted through the car — the sprint for the station. */
    motor(context: AudioContext, time: number, seconds: number, fromHz: number, toHz: number, vel: number) {
      const out = music();
      if (!out) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + seconds + 0.1,
        oscillatorType: 'sawtooth',
        frequency: fromHz,
        frequencyAutomation: [{ type: 'exponentialRamp', value: toHz, time: time + seconds * 0.7 }, { type: 'exponentialRamp', value: fromHz * 0.6, time: time + seconds }],
        filter: { type: 'lowpass', frequency: 700, Q: 2 },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.07 * vel, time: time + seconds * 0.3 },
          { type: 'linearRamp', value: 0.05 * vel, time: time + seconds * 0.75 },
          { type: 'linearRamp', value: 0.0001, time: time + seconds },
        ],
        destination: out,
      });
    },

    clamp(context: AudioContext, time: number, vel: number) {
      const out = music();
      if (!out) return;
      noise(context, time, 0.4, 'lowpass', 2400, 0.8, [[0.003, 0.4 * vel], [0.35, 0.0001]], out, 300);
      for (const [f, level] of [[73, 1], [196, 0.4], [523, 0.15]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 0.7,
          oscillatorType: 'sine',
          frequency: f,
          gainAutomation: [
            { type: 'set', value: 0.3 * vel * level, time },
            { type: 'exponentialRamp', value: 0.0001, time: time + 0.6 },
          ],
          destination: out,
        });
      }
    },

    hiss(context: AudioContext, time: number, seconds: number, vel: number) {
      const out = music();
      if (!out) return;
      noise(context, time, seconds, 'highpass', 1800, 0.5, [[seconds * 0.25, 0.1 * vel], [seconds * 0.6, 0.06 * vel], [seconds, 0.0001]], out, 5000, 0.6);
    },

    /** The last chord: soft sines that bloom as the bay pressurizes. */
    choir(context: AudioContext, time: number, notes: number[], seconds: number, vel: number) {
      const out = music();
      if (!out) return;
      notes.forEach((midi, i) => {
        const dest = panned(context, out, ((i % 2) * 2 - 1) * (0.2 + i * 0.1));
        playOscillatorVoice({
          context,
          time,
          stopTime: time + seconds + 0.1,
          oscillatorType: i === 0 ? 'sine' : 'triangle',
          frequency: midiToFreq(midi),
          detune: (i % 3) * 3 - 3,
          filter: { type: 'lowpass', frequency: 2200 },
          gainAutomation: [
            { type: 'set', value: 0.0001, time },
            { type: 'linearRamp', value: 0.05 * vel, time: time + seconds * 0.35 },
            { type: 'linearRamp', value: 0.0001, time: time + seconds },
          ],
          destination: dest,
          sends: sends(time, 1, 0.2),
        });
      });
    },
  });

  // ---- player instruments (sfx bus) -------------------------------------------------

  function playerTone(time: number, midi: number, timbre: PlayerTimbre, vel: number, weight: number) {
    const context = env.context();
    const out = sfx();
    if (!context || !out || weight <= 0.01) return;
    const gain = timbre.gain * vel * weight;
    const sendList = sends(time, timbre.reverb, timbre.delay);
    if (timbre.bell > 0) {
      fm(context, time, midiToFreq(midi), 2, timbre.bell, timbre.decay, gain, out, sendList);
    } else {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + timbre.decay + 0.05,
        oscillatorType: timbre.wave,
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: timbre.cutoff },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: gain, time: time + 0.003 },
          { type: 'exponentialRamp', value: 0.0001, time: time + timbre.decay },
        ],
        destination: out,
        sends: sendList,
      });
    }
    if (timbre.thump > 0) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.14,
        oscillatorType: 'sine',
        frequency: 150,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 55, time: time + 0.09 }],
        gainAutomation: [
          { type: 'set', value: 0.13 * timbre.thump * vel * weight, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.12 },
        ],
        destination: out,
      });
    }
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number, filter: BiquadFilterType = 'highpass') {
    const context = env.context();
    const out = sfx();
    if (!context || !out || vel <= 0) return;
    noise(context, time, decay, filter, frequency, 0.8, [[0.002, vel], [decay, 0.0001]], out);
  }

  /** A tone that can be cancelled if the threat it warns about dies first. */
  function alarmBeep(time: number, midi: number, vel: number) {
    const context = env.context();
    const out = sfx();
    if (!context || !out) return [];
    const { oscillator } = playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.09,
      oscillatorType: 'square',
      frequency: midiToFreq(midi),
      filter: { type: 'lowpass', frequency: 2400 },
      gainAutomation: [
        { type: 'set', value: 0.035 * vel, time },
        { type: 'linearRamp', value: 0.03 * vel, time: time + 0.07 },
        { type: 'linearRamp', value: 0.0001, time: time + 0.09 },
      ],
      destination: out,
    });
    return [oscillator];
  }

  /** Wind-rider cry: a breathy whistle bending up into the note. */
  function cry(time: number, midi: number, air: number) {
    const context = env.context();
    const out = music();
    if (!context || !out || air < 0.05) return;
    const { oscillator } = playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.7,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi - 5),
      frequencyAutomation: [
        { type: 'exponentialRamp', value: midiToFreq(midi), time: time + 0.18 },
        { type: 'exponentialRamp', value: midiToFreq(midi - 2), time: time + 0.6 },
      ],
      gainAutomation: [
        { type: 'set', value: 0.0001, time },
        { type: 'linearRamp', value: 0.035 * air, time: time + 0.08 },
        { type: 'exponentialRamp', value: 0.0001, time: time + 0.65 },
      ],
      destination: panned(context, out, Math.random() * 1.2 - 0.6),
      sends: sends(time, 0.7, 0.5),
    });
    const wobble = context.createOscillator();
    wobble.frequency.value = 7;
    const depth = context.createGain();
    depth.gain.value = midiToFreq(midi) * 0.012;
    wobble.connect(depth).connect(oscillator.frequency);
    wobble.start(time);
    wobble.stop(time + 0.7);
    noise(context, time, 0.4, 'bandpass', midiToFreq(midi) * 2, 4, [[0.06, 0.03 * air], [0.38, 0.0001]], out);
  }

  function buzz(time: number, midi: number, vel: number) {
    const context = env.context();
    const out = sfx();
    if (!context || !out) return;
    for (const offset of [0, 1]) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.22,
        oscillatorType: 'square',
        frequency: midiToFreq(midi + offset),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi + offset - 5), time: time + 0.2 }],
        filter: { type: 'bandpass', frequency: 700, Q: 3 },
        gainAutomation: [
          { type: 'set', value: 0.08 * vel, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.21 },
        ],
        destination: out,
      });
    }
  }

  function crunch(time: number, midi: number, vel: number) {
    const context = env.context();
    const out = sfx();
    if (!context || !out) return;
    noise(context, time, 0.5, 'lowpass', 3200, 0.9, [[0.004, 0.3 * vel], [0.45, 0.0001]], out, 200);
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.6,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi + 12),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - 12), time: time + 0.4 }],
      gainAutomation: [
        { type: 'set', value: 0.36 * vel, time },
        { type: 'exponentialRamp', value: 0.0001, time: time + 0.55 },
      ],
      destination: out,
    });
  }

  return { ...instruments, playerTone, playerNoise, alarmBeep, buzz, crunch, cry, sends };
}
