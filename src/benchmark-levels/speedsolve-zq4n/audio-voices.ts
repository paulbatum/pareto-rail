import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Speedsolve's kit is a cube on a table, amplified.
//
// The signature voice is `clack`: a pitched plastic knock with a wooden body
// and a tiny bearing rattle, and it is deliberately shared — the arrangement
// plays it as percussion, and the machine plays it every time a layer snaps.
// A player solving on the grid is therefore literally drumming, which is the
// whole point of the level.
//
// Everything else follows one rule: hard attacks, no swells. Nothing in this
// kit fades in, because nothing about a speedcube fades in.

export type ToneVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; bite: number; verb: number };

export type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type MotorController = {
  /** 0..6 — one layer per conquered face. */
  setLayers(time: number, layers: number, ramp?: number): void;
  setDrive(time: number, level: number, ramp?: number): void;
};

/**
 * The machine's own hum: six detuned saw partials over a sub, each gated by a
 * gain the score opens as a face comes off. It is the only continuous sound in
 * the level, and it is what makes the arrangement thicker without adding notes.
 */
export function installMotor(context: AudioContext, mix: MixBus): MotorController {
  const layerGains: GainNode[] = [];
  const drive = context.createGain();
  drive.gain.value = 0.0;
  const shaper = context.createBiquadFilter();
  shaper.type = 'lowpass';
  shaper.frequency.value = 620;
  shaper.Q.value = 1.4;
  drive.connect(shaper).connect(mix.duck);

  const partials = [28, 40, 47, 52, 55, 59];
  for (let i = 0; i < partials.length; i += 1) {
    const gain = context.createGain();
    gain.gain.value = i === 0 ? 1 : 0;
    for (const detune of [-7, 7]) {
      const osc = context.createOscillator();
      osc.type = i === 0 ? 'sine' : 'sawtooth';
      osc.frequency.value = midiToFreq(partials[i]);
      osc.detune.value = detune * (1 + i * 0.2);
      osc.connect(gain);
      osc.start();
    }
    const level = context.createGain();
    level.gain.value = (i === 0 ? 0.42 : 0.1) / (1 + i * 0.35);
    gain.connect(level).connect(drive);
    layerGains.push(gain);
  }

  // A slow tremolo keeps the hum from sounding like a held organ note.
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.27;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain).connect(shaper.frequency);
  lfo.start();

  return {
    setLayers(time, layers, ramp = 1.2) {
      for (let i = 1; i < layerGains.length; i += 1) {
        const target = i <= layers ? 1 : 0;
        layerGains[i].gain.cancelScheduledValues(time);
        layerGains[i].gain.setValueAtTime(layerGains[i].gain.value, time);
        layerGains[i].gain.linearRampToValueAtTime(target, time + ramp);
      }
      shaper.frequency.cancelScheduledValues(time);
      shaper.frequency.setValueAtTime(shaper.frequency.value, time);
      shaper.frequency.linearRampToValueAtTime(560 + layers * 190, time + ramp);
    },
    setDrive(time, level, ramp = 1) {
      drive.gain.cancelScheduledValues(time);
      drive.gain.setValueAtTime(drive.gain.value, time);
      drive.gain.linearRampToValueAtTime(level, time + ramp);
    },
  };
}

export function createSpeedsolveVoices(environment: VoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.04 });

  function noiseHit(
    time: number,
    vel: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    destination: AudioNode,
  ) {
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseHitVoice.play({
      context,
      buffer,
      time,
      velocity: vel,
      decay,
      filterType,
      frequency,
      destination,
      offset: Math.random() * 1.4,
    });
  }

  // --- the knock -----------------------------------------------------------------
  // Two square partials a fifth apart with a hard pitch collapse: plastic, not
  // metal. The `bright` argument opens it from a dry click to a full snap.
  const clackBody = voice<{ vel: number; bright: number }>({
    oscillators: [
      { type: 'square', gain: 0.6 },
      { type: 'square', gain: 0.22, midiOffset: 7 },
    ],
    duration: 0.1,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ bright }) => 900 + bright * 4200, Q: 1.6 },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.35, time },
      { type: 'exponentialRamp', value: frequency * 0.86, time: time + 0.045 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.2 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
    ],
  });

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.15,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 46, time: time + 0.07 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  const rimTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.6 }, { type: 'square', gain: 0.16, midiOffset: 12 }],
    duration: 0.05,
    stopPadding: 0.02,
    filter: { type: 'bandpass', frequency: 2100, Q: 3 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.2 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.05 },
    ],
  });

  const subTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.5,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.36 * vel, time: time + 0.014 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
    ],
  });

  const bassTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -8 },
      { type: 'sawtooth', gain: 0.5, detune: 8 },
      { type: 'sine', gain: 0.75, octave: -1 },
    ],
    duration: 0.17,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 5,
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'exponentialRamp', value: Math.max(180, cutoff * 0.24), time: time + 0.16 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.19 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
  });

  const pluckTone = voice<{ vel: number; cutoff: number; decay: number }>({
    oscillators: [{ type: 'square', gain: 0.5 }, { type: 'triangle', gain: 0.5, octave: 1 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 1.1 },
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: 0.075 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -9 },
      { type: 'sawtooth', gain: 0.5, detune: 9 },
    ],
    duration: 0.13,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      frequency: 3200,
      Q: 3.4,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 700, time: time + 0.12 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.055 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  // Glass: the kill voice. Two sines a duodecime apart with a hard attack, so a
  // chained volley reads as a melody line rather than a series of hits.
  const glassTone = voice<{ vel: number; decay: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', gain: 0.2, frequencyRatio: 3.01 },
      { type: 'triangle', gain: 0.13, octave: 1 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: 0.1 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const padTone = voice<{ vel: number; duration: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -11 },
      { type: 'sawtooth', gain: 0.5, detune: 11 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 0.8 },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.035 * vel, time: time + Math.min(0.5, duration * 0.2) },
      { type: 'set', value: 0.035 * vel, time: time + duration * 0.72 },
      { type: 'linearRamp', value: 0.0001, time: time + duration },
    ],
  });

  const servoTone = voice<{ vel: number; duration: number; up: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.5 }, { type: 'square', gain: 0.18, octave: -1 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'bandpass', frequency: 1400, Q: 4.5 },
    frequencyAutomation: (time, frequency, { duration, up }) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: frequency * (up > 0 ? 2.2 : 0.42), time: time + duration },
    ],
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.05 * vel, time: time + duration * 0.35 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const thudTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.6,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 34, time: time + 0.4 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.52 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
    ],
  });

  const buzzTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.6 }, { type: 'square', gain: 0.4, midiOffset: 1 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'bandpass', frequency: 380, Q: 6 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'set', value: vel * 0.6, time: time + 0.06 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const toneSpec = voice<{ voice: ToneVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff, Q: 1.2 },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    /** The cube's knock. One instrument, played by both the score and the machine. */
    clack(context, time, midi, vel, bright) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      clackBody.play({ context, time, midi, vel, bright, destination: output });
      noiseHit(time, 0.09 * vel, 0.012, 'bandpass', 2400 + bright * 3400, output);
      noiseHit(time + 0.018, 0.03 * vel * bright, 0.03, 'highpass', 6200, output);
    },

    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 168, vel, destination: output });
      noiseHit(time, 0.045 * vel, 0.004, 'highpass', 2800, output);
      mix.duckAt(time, 0.62, 0.11);
    },

    rim(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      rimTone.play({ context, time, midi: 74, vel, destination: output });
      noiseHit(time, 0.13 * vel, 0.035, 'bandpass', 1900, output);
    },

    /** 32nd-note ratchet: the ticking that never stops under the whole level. */
    tick(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.36 * vel, 0.008, 'highpass', 9800, duck);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8200, duck);
    },

    sub(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subTone.play({ context, time, midi, vel, destination: duck });
    },

    bass(context, time, midi, vel, cutoff) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, cutoff, destination: duck });
    },

    pluck(context, time, midi, vel, cutoff, decay) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      pluckTone.play({
        context,
        time,
        midi,
        vel,
        cutoff,
        decay,
        destination: mix.duck,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : undefined,
      });
    },

    stab(context, time, midis, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      for (const midi of midis as number[]) stabTone.play({ context, time, midi, vel, destination: duck });
    },

    pad(context, time, midis, duration, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis as number[]) {
        padTone.play({
          context,
          time,
          midi,
          duration,
          vel: vel / Math.sqrt((midis as number[]).length),
          cutoff,
          destination: mix.duck,
          sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : undefined,
        });
      }
    },

    /** A servo sweep. `up` positive spins the mechanism up, negative winds it down. */
    servo(context, time, midi, duration, vel, up) {
      const output = musicDestination();
      if (!output) return;
      servoTone.play({ context, time, midi, duration, vel, up, destination: output });
      noiseHit(time, 0.05 * vel, duration * 0.6, 'bandpass', 1800, output);
    },

    /** The whole cube turning: a low mechanism thud under a wide air shift. */
    turn(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      thudTone.play({ context, time, frequency: 128, vel: vel * 0.72, destination: output });
      noiseHit(time, 0.2 * vel, 0.24, 'bandpass', 720, output);
      noiseHit(time + 0.05, 0.1 * vel, 0.34, 'highpass', 3600, output);
    },

    thud(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      thudTone.play({ context, time, frequency: 116, vel, destination: output });
      noiseHit(time, 0.16 * vel, 0.2, 'lowpass', 420, output);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output) return;
      noiseHit(time, vel, 0.65, 'highpass', 5400, output);
      if (reverbSend) noiseHit(time, vel * 0.55, 1.1, 'bandpass', 7800, reverbSend);
    },

    riser(context, time, duration, level) {
      const output = musicDestination();
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
          Q: 1.4,
          frequency: 300,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 7200, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    buzz(context, time, vel) {
      const output = sfxDestination();
      if (!output) return;
      buzzTone.play({ context, time, frequency: 116, vel, destination: output });
      noiseHit(time, 0.09, 0.07, 'bandpass', 520, output);
    },
  }, {
    clack: ['midi', 'vel', 'bright'],
    kick: ['vel'],
    rim: ['vel'],
    tick: ['vel'],
    hat: ['vel', 'decay'],
    sub: ['midi', 'vel'],
    bass: ['midi', 'vel', 'cutoff'],
    pluck: ['midi', 'vel', 'cutoff', 'decay'],
    stab: ['midis', 'vel'],
    pad: ['midis', 'duration', 'vel', 'cutoff'],
    servo: ['midi', 'duration', 'vel', 'up'],
    turn: ['vel'],
    thud: ['vel'],
    crash: ['vel'],
    riser: ['duration', 'level'],
    buzz: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tone: ToneVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tone.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    toneSpec.play({ context, time, midi, voice: tone, velocity: vel, weight, destination: output, sends: playerSends(0.24, tone.verb) });
  }

  function playerGlass(time: number, midi: number, vel: number, decay: number) {
    if (environment.trace) {
      environment.trace.record(time, 'playerGlass', { midi, vel, decay });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    glassTone.play({ context, time, midi, vel, decay, destination: output, sends: playerSends(0.34, 0.3) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerGlass, playerNoise };
}
