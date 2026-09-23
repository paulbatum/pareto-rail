import { playBufferSourceVoice, playNoiseHit, playOscillatorVoice, type MixBus } from '../../engine/audio-kit';
import { midiToFreq } from '../../engine/music';

// Leaf: synth construction for Mass Driver. Every function takes its pitch,
// level, and timing from the score in audio.ts; nothing here decides what
// plays when.

export type PlayerTimbre = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  /** Semitones the note slides up into its pitch — the capacitor "charging" chirp. */
  chirp: number;
  sparkle: number;
  delay: number;
  reverb: number;
};

export type VoiceEnvironment = {
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type HumVoice = ReturnType<typeof createHumVoice>;
export type WhineVoice = ReturnType<typeof createWhineVoice>;

const freq = midiToFreq;

export function createMassDriverVoices(env: VoiceEnvironment) {
  const music = () => env.mix()?.duck ?? null;
  const sfx = () => env.mix()?.sfx ?? null;
  /** Finales bypass the duck so a score-wide duck cannot swallow their own tails. */
  const finale = () => env.mix()?.music ?? null;

  function sends(delay: number, reverb: number) {
    const mix = env.mix();
    const result: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delay > 0) result.push({ destination: mix.delaySend, gain: delay });
    if (mix?.reverbSend && reverb > 0) result.push({ destination: mix.reverbSend, gain: reverb });
    return result;
  }

  function noise(time: number, vel: number, decay: number, type: BiquadFilterType, frequency: number, destination: AudioNode | null) {
    const context = env.context();
    const buffer = env.mix()?.noiseBuffer;
    if (!context || !buffer || !destination || vel <= 0) return;
    playNoiseHit({ context, buffer, time, velocity: vel, decay, filterType: type, frequency, destination, offset: Math.random() * 1.2 });
  }

  // The coil firing as the payload crosses it. It is the kick drum, tuned to
  // the hum's pedal: a sine body that drops from two octaves up onto the root,
  // a transient click, and an electric snap that brightens with heat.
  function coilPulse(time: number, rootMidi: number, vel: number, heat: number) {
    const context = env.context();
    const destination = music();
    if (!context || !destination) return;
    const body = freq(rootMidi);
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.42,
      oscillatorType: 'sine',
      frequency: body * 4,
      frequencyAutomation: [
        { type: 'exponentialRamp', value: body * 1.2, time: time + 0.035 },
        { type: 'exponentialRamp', value: body, time: time + 0.16 },
      ],
      gainAutomation: [
        { type: 'set', value: 0.95 * vel, time },
        { type: 'exponentialRamp', value: 0.4 * vel, time: time + 0.09 },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
      ],
      destination,
    });
    noise(time, 0.16 * vel, 0.012, 'highpass', 5200, destination);
    // Electric snap: a square chirp falling through a bandpass.
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.07,
      oscillatorType: 'square',
      frequency: freq(rootMidi + 55),
      frequencyAutomation: [{ type: 'exponentialRamp', value: freq(rootMidi + 31), time: time + 0.05 }],
      filter: { type: 'bandpass', frequency: 2400 + heat * 3600, Q: 3 },
      gainAutomation: [
        { type: 'set', value: (0.025 + heat * 0.06) * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.06 },
      ],
      destination,
      sends: sends(0, 0.06 + heat * 0.08),
    });
  }

  function hat(time: number, vel: number, decay: number, brightness = 8200) {
    noise(time, vel, decay, 'highpass', brightness, music());
  }

  // Arc-crackle clap: three fast noise bursts and a spark.
  function clap(time: number, vel: number) {
    const destination = music();
    const context = env.context();
    if (!destination || !context) return;
    for (const [offset, level] of [[0, 0.7], [0.011, 0.55], [0.023, 1]] as const) {
      noise(time + offset, 0.22 * vel * level, offset === 0.023 ? 0.13 : 0.02, 'bandpass', 1650, destination);
    }
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.05,
      oscillatorType: 'sawtooth',
      frequency: 3400,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 900, time: time + 0.04 }],
      filter: { type: 'highpass', frequency: 1200 },
      gainAutomation: [
        { type: 'set', value: 0.03 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.045 },
      ],
      destination,
      sends: sends(0, 0.12),
    });
  }

  function arp(time: number, midi: number, vel: number, cutoff: number, decay = 0.16) {
    const context = env.context();
    const destination = music();
    if (!context || !destination) return;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + decay + 0.03,
      oscillatorType: 'square',
      frequency: freq(midi),
      filter: {
        type: 'lowpass',
        frequency: cutoff,
        Q: 4,
        frequencyAutomation: [{ type: 'exponentialRamp', value: Math.max(200, cutoff * 0.25), time: time + decay }],
      },
      gainAutomation: [
        { type: 'set', value: 0.06 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + decay },
      ],
      destination,
      sends: sends(0.22, 0.08),
    });
  }

  function bassPluck(time: number, midi: number, vel: number, cutoff: number) {
    const context = env.context();
    const destination = music();
    if (!context || !destination) return;
    for (const detune of [-7, 7]) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.2,
        oscillatorType: 'sawtooth',
        frequency: freq(midi),
        detune,
        filter: {
          type: 'lowpass',
          frequency: cutoff,
          Q: 6,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 140, time: time + 0.14 }],
        },
        gainAutomation: [
          { type: 'set', value: 0.075 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
        ],
        destination,
      });
    }
  }

  function pad(time: number, midis: readonly number[], duration: number, vel: number, cutoff: number) {
    const context = env.context();
    const destination = music();
    if (!context || !destination) return;
    const attack = Math.min(0.8, duration * 0.3);
    for (const [index, midi] of midis.entries()) {
      for (const detune of [-9, 9]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + duration + 0.6,
          oscillatorType: 'sawtooth',
          frequency: freq(midi),
          detune: detune + index * 1.5,
          filter: { type: 'lowpass', frequency: cutoff, Q: 0.7 },
          gainAutomation: [
            { type: 'set', value: 0.0001, time },
            { type: 'linearRamp', value: 0.012 * vel, time: time + attack },
            { type: 'linearRamp', value: 0.009 * vel, time: time + duration },
            { type: 'linearRamp', value: 0.0001, time: time + duration + 0.55 },
          ],
          destination,
          sends: sends(0, 0.35),
        });
      }
    }
  }

  function stab(time: number, midis: readonly number[], vel: number, cutoff: number) {
    const context = env.context();
    const destination = music();
    if (!context || !destination) return;
    for (const midi of midis) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sawtooth',
        frequency: freq(midi),
        filter: {
          type: 'lowpass',
          frequency: cutoff,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 420, time: time + 0.24 }],
        },
        gainAutomation: [
          { type: 'set', value: 0.035 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.27 },
        ],
        destination,
        sends: sends(0.25, 0.2),
      });
    }
  }

  function riser(time: number, duration: number, vel: number) {
    const context = env.context();
    const buffer = env.mix()?.noiseBuffer;
    const destination = music();
    if (!context || !buffer || !destination) return;
    playBufferSourceVoice({
      context,
      buffer,
      time,
      stopTime: time + duration + 0.05,
      loop: true,
      filter: {
        type: 'bandpass',
        frequency: 400,
        Q: 2.5,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 7800, time: time + duration }],
      },
      gainAutomation: [
        { type: 'set', value: 0.0001, time },
        { type: 'exponentialRamp', value: 0.16 * vel, time: time + duration * 0.95 },
        { type: 'linearRamp', value: 0, time: time + duration + 0.04 },
      ],
      destination,
    });
  }

  function impact(time: number, vel: number, rootMidi: number) {
    const context = env.context();
    const destination = music();
    if (!context || !destination) return;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 1.4,
      oscillatorType: 'sine',
      frequency: freq(rootMidi + 12) * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: freq(rootMidi) * 0.75, time: time + 1.1 }],
      gainAutomation: [
        { type: 'set', value: 0.8 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.3 },
      ],
      destination,
    });
    noise(time, 0.5 * vel, 0.9, 'lowpass', 1800, destination);
    noise(time, 0.18 * vel, 0.25, 'highpass', 6000, destination);
  }

  // Safety klaxon: a filtered square alternating a semitone, like a breaker panel screaming.
  function alarm(time: number, midi: number, duration: number, vel: number) {
    const context = env.context();
    const destination = music();
    if (!context || !destination) return;
    const half = duration / 4;
    for (let i = 0; i < 4; i += 1) {
      const at = time + i * half;
      playOscillatorVoice({
        context,
        time: at,
        stopTime: at + half,
        oscillatorType: 'square',
        frequency: freq(midi + (i % 2)),
        filter: { type: 'bandpass', frequency: freq(midi + 12), Q: 5 },
        gainAutomation: [
          { type: 'set', value: 0.0001, time: at },
          { type: 'linearRamp', value: 0.05 * vel, time: at + 0.02 },
          { type: 'linearRamp', value: 0.0001, time: at + half * 0.95 },
        ],
        destination,
        sends: sends(0.1, 0.25),
      });
    }
  }

  // A struck, slightly inharmonic chime for open space.
  function bell(time: number, midi: number, vel: number, decay: number) {
    const context = env.context();
    const destination = music();
    if (!context || !destination) return;
    for (const [ratio, level, length] of [[1, 1, 1], [2.76, 0.28, 0.5], [5.4, 0.1, 0.25]] as const) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + decay * length + 0.05,
        oscillatorType: 'sine',
        frequency: freq(midi) * ratio,
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.05 * vel * level, time: time + 0.004 },
          { type: 'exponentialRamp', value: 0.0001, time: time + decay * length },
        ],
        destination,
        sends: sends(0.3, 0.6),
      });
    }
  }

  // The gun fires. Sub drop, pressure wave, and a whole chord struck at once.
  function launchBlast(time: number, midis: readonly number[], rootMidi: number) {
    const context = env.context();
    const destination = finale();
    if (!context || !destination) return;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 3.2,
      oscillatorType: 'sine',
      frequency: freq(rootMidi + 24),
      frequencyAutomation: [{ type: 'exponentialRamp', value: freq(rootMidi - 12), time: time + 2.4 }],
      gainAutomation: [
        { type: 'set', value: 1.1, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 3.1 },
      ],
      destination,
    });
    noise(time, 0.9, 1.6, 'lowpass', 2600, destination);
    noise(time, 0.35, 0.5, 'highpass', 4000, destination);
    for (const midi of midis) {
      for (const octave of [0, 12]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 4.2,
          oscillatorType: octave === 0 ? 'sawtooth' : 'triangle',
          frequency: freq(midi + octave),
          filter: {
            type: 'lowpass',
            frequency: 6000,
            frequencyAutomation: [{ type: 'exponentialRamp', value: 500, time: time + 3.2 }],
          },
          gainAutomation: [
            { type: 'set', value: 0.04, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 4 },
          ],
          destination,
          sends: sends(0.2, 0.7),
        });
      }
    }
  }

  // The barrel lets go: an overdriven, collapsing roar with nowhere to go.
  function breachBlast(time: number, rootMidi: number) {
    const context = env.context();
    const destination = finale();
    if (!context || !destination) return;
    const shaper = context.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    shaper.curve = curve;
    const level = context.createGain();
    level.gain.setValueAtTime(0.5, time);
    level.gain.exponentialRampToValueAtTime(0.001, time + 2.6);
    shaper.connect(level).connect(destination);
    for (const [type, offset] of [['sawtooth', 0], ['square', 0.3], ['sawtooth', -11.7]] as const) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 2.7,
        oscillatorType: type,
        frequency: freq(rootMidi + 24 + offset),
        frequencyAutomation: [{ type: 'exponentialRamp', value: freq(rootMidi - 14 + offset), time: time + 2.2 }],
        gainAutomation: [{ type: 'set', value: 0.35, time }],
        destination: shaper,
      });
    }
    noise(time, 1.0, 2.2, 'lowpass', 900, destination);
    noise(time, 0.4, 0.6, 'bandpass', 2400, destination);
    setTimeout(() => {
      shaper.disconnect();
      level.disconnect();
    }, Math.max(0, (time - context.currentTime + 3) * 1000));
  }

  // ---- player instruments -------------------------------------------------------------

  function playerTone(time: number, midi: number, timbre: PlayerTimbre, vel: number, weight: number) {
    const context = env.context();
    const destination = sfx();
    if (!context || !destination || weight <= 0) return;
    const target = freq(midi);
    playOscillatorVoice({
      context,
      time,
      stopTime: time + timbre.decay + 0.04,
      oscillatorType: timbre.oscillator,
      frequency: timbre.chirp > 0 ? freq(midi - timbre.chirp) : target,
      frequencyAutomation: timbre.chirp > 0 ? [{ type: 'exponentialRamp', value: target, time: time + 0.028 }] : undefined,
      filter: {
        type: 'lowpass',
        frequency: timbre.cutoff,
        Q: 2,
        frequencyAutomation: [{ type: 'exponentialRamp', value: Math.max(300, timbre.cutoff * 0.3), time: time + timbre.decay }],
      },
      gainAutomation: [
        { type: 'set', value: timbre.gain * vel * weight, time },
        { type: 'exponentialRamp', value: 0.001, time: time + timbre.decay },
      ],
      destination,
      sends: sends(timbre.delay * weight, timbre.reverb * weight),
    });
    if (timbre.sparkle > 0) noise(time, timbre.sparkle * 0.05 * vel * weight, 0.03, 'highpass', 9000, destination);
  }

  /** Sine body under a kill note: weight without adding brightness. */
  function thud(time: number, midi: number, vel: number, decay: number) {
    const context = env.context();
    const destination = sfx();
    if (!context || !destination) return;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + decay + 0.03,
      oscillatorType: 'sine',
      frequency: freq(midi),
      gainAutomation: [
        { type: 'set', value: 0.2 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + decay },
      ],
      destination,
    });
  }

  /** A falling electric zap — slugs leaving the rail, bolts leaving a pylon. */
  function zap(time: number, fromMidi: number, toMidi: number, duration: number, vel: number, type: OscillatorType, cutoff: number, bus: 'music' | 'sfx' = 'sfx') {
    const context = env.context();
    const destination = bus === 'music' ? music() : sfx();
    if (!context || !destination) return;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + duration + 0.02,
      oscillatorType: type,
      frequency: freq(fromMidi),
      frequencyAutomation: [{ type: 'exponentialRamp', value: freq(toMidi), time: time + duration }],
      filter: { type: 'lowpass', frequency: cutoff, Q: 1.5 },
      gainAutomation: [
        { type: 'set', value: vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + duration },
      ],
      destination,
      sends: sends(0.1, 0.06),
    });
  }

  function crackle(time: number, vel: number, decay: number, frequency: number, bus: 'music' | 'sfx' = 'sfx') {
    noise(time, vel, decay, 'bandpass', frequency, bus === 'music' ? music() : sfx());
  }

  /** Breaker trip: a mains-hum buzz with a minor-second snarl and a relay clack. */
  function breaker(time: number, rootMidi: number) {
    const context = env.context();
    const destination = sfx();
    if (!context || !destination) return;
    for (const [offset, level] of [[0, 0.1], [1, 0.08]] as const) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.24,
        oscillatorType: 'square',
        frequency: freq(rootMidi + offset),
        filter: { type: 'bandpass', frequency: 700, Q: 3 },
        gainAutomation: [
          { type: 'set', value: level, time },
          { type: 'linearRamp', value: level * 0.85, time: time + 0.16 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
        ],
        destination,
      });
    }
    noise(time, 0.3, 0.018, 'bandpass', 3200, destination);
    noise(time + 0.2, 0.18, 0.015, 'bandpass', 2600, destination);
  }

  return {
    sends,
    coilPulse,
    hat,
    clap,
    arp,
    bassPluck,
    pad,
    stab,
    riser,
    impact,
    alarm,
    bell,
    launchBlast,
    breachBlast,
    playerTone,
    thud,
    zap,
    crackle,
    breaker,
    createHum: () => createHumVoice(env),
    createWhine: () => createWhineVoice(env),
  };
}

// The gun's hum: two detuned saws and a sub through a resonant lowpass, fed
// into a gain that the score pumps on every beat. It lives for the whole
// session; the score only moves its pitch, brightness, level, and pump.
function createHumVoice(env: VoiceEnvironment) {
  const context = env.context();
  const mix = env.mix();
  if (!context || !mix) return null;
  const saws = [context.createOscillator(), context.createOscillator()];
  const sub = context.createOscillator();
  const filter = context.createBiquadFilter();
  const subGain = context.createGain();
  const pump = context.createGain();
  const level = context.createGain();
  saws[0].type = 'sawtooth';
  saws[1].type = 'sawtooth';
  saws[1].detune.value = 11;
  sub.type = 'sine';
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  filter.Q.value = 5;
  subGain.gain.value = 0.7;
  level.gain.value = 0;
  for (const saw of saws) saw.connect(filter);
  sub.connect(subGain).connect(pump);
  filter.connect(pump).connect(level).connect(mix.duck);
  const start = context.currentTime;
  for (const osc of [...saws, sub]) osc.start(start);

  function setPitch(time: number, midi: number) {
    for (const saw of saws) saw.frequency.setValueAtTime(freq(midi), time);
    sub.frequency.setValueAtTime(freq(midi - 12), time);
  }
  setPitch(start, 38);

  return {
    setPitch,
    /** Portamento from whatever the pitch is at `time` to `midi`, arriving at `arrive`. */
    glide(time: number, arrive: number, midi: number) {
      for (const saw of saws) {
        saw.frequency.cancelScheduledValues(time);
        saw.frequency.setValueAtTime(saw.frequency.value || freq(midi), time);
        saw.frequency.exponentialRampToValueAtTime(freq(midi), arrive);
      }
      sub.frequency.cancelScheduledValues(time);
      sub.frequency.setValueAtTime(sub.frequency.value || freq(midi - 12), time);
      sub.frequency.exponentialRampToValueAtTime(freq(midi - 12), arrive);
    },
    brightness(time: number, cutoff: number, q = 5) {
      filter.frequency.setTargetAtTime(cutoff, time, 0.08);
      filter.Q.setTargetAtTime(q, time, 0.1);
    },
    level(time: number, value: number, seconds: number) {
      level.gain.cancelScheduledValues(time);
      level.gain.setTargetAtTime(value, time, Math.max(0.005, seconds / 3));
    },
    pumpAt(time: number, depth: number, recover: number) {
      pump.gain.cancelScheduledValues(time);
      pump.gain.setValueAtTime(depth, time);
      pump.gain.setTargetAtTime(1, time + 0.01, recover / 3);
    },
    dispose() {
      for (const osc of [...saws, sub]) {
        try {
          osc.stop();
        } catch {
          // already stopped
        }
      }
      level.disconnect();
    },
  };
}

// The charge whine: a sine with a faint octave partner under a tremolo whose
// rate the score accelerates toward the peak.
function createWhineVoice(env: VoiceEnvironment) {
  const context = env.context();
  const mix = env.mix();
  if (!context || !mix) return null;
  const tone = context.createOscillator();
  const octave = context.createOscillator();
  const octaveGain = context.createGain();
  const tremolo = context.createGain();
  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();
  const level = context.createGain();
  tone.type = 'sine';
  octave.type = 'triangle';
  octaveGain.gain.value = 0.1;
  tremolo.gain.value = 0.6;
  lfo.type = 'sine';
  lfo.frequency.value = 3;
  lfoDepth.gain.value = 0.4;
  level.gain.value = 0;
  lfo.connect(lfoDepth).connect(tremolo.gain);
  tone.connect(tremolo);
  octave.connect(octaveGain).connect(tremolo);
  tremolo.connect(level).connect(mix.duck);
  if (mix.reverbSend) {
    const send = context.createGain();
    send.gain.value = 0.25;
    level.connect(send).connect(mix.reverbSend);
  }
  const start = context.currentTime;
  for (const osc of [tone, octave, lfo]) osc.start(start);

  return {
    set(time: number, midi: number) {
      tone.frequency.cancelScheduledValues(time);
      octave.frequency.cancelScheduledValues(time);
      tone.frequency.setValueAtTime(freq(midi), time);
      octave.frequency.setValueAtTime(freq(midi + 12), time);
    },
    rampTo(time: number, midi: number) {
      tone.frequency.exponentialRampToValueAtTime(freq(midi), time);
      octave.frequency.exponentialRampToValueAtTime(freq(midi + 12), time);
    },
    tremoloTo(time: number, rate: number, depth: number) {
      lfo.frequency.exponentialRampToValueAtTime(rate, time);
      lfoDepth.gain.linearRampToValueAtTime(depth, time);
    },
    level(time: number, value: number, seconds: number) {
      level.gain.cancelScheduledValues(time);
      level.gain.setTargetAtTime(value, time, Math.max(0.005, seconds / 3));
    },
    reset(time: number) {
      level.gain.cancelScheduledValues(time);
      level.gain.setTargetAtTime(0, time, 0.05);
      lfo.frequency.cancelScheduledValues(time);
      lfo.frequency.setValueAtTime(3, time);
      lfoDepth.gain.cancelScheduledValues(time);
      lfoDepth.gain.setValueAtTime(0.4, time);
    },
    dispose() {
      for (const osc of [tone, octave, lfo]) {
        try {
          osc.stop();
        } catch {
          // already stopped
        }
      }
      level.disconnect();
    },
  };
}
