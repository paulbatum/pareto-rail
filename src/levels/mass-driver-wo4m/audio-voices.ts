import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// A per-section player timbre. The lock and kill slots read the live harmony;
// the fields tune brightness, tail, and how much hall each slot swims in so the
// gun's guns crossfade with the arrangement instead of cutting over it.
export type MassDriverTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  sparkle: number;
  reverb: number;
};

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

// ---- the climbing hum -------------------------------------------------------
// The gun is the instrument. A persistent tonal drone — a detuned saw pair over
// a sine sub, folded through a lowpass into the music bus — whose fundamental is
// scheduled bar by bar by the arrangement. It idles at E1 in attract mode and
// climbs across the run, brightening and swelling as the firing charge builds,
// until the shot cuts it dead. The oscillators run for the whole session; runs
// only steer frequency, cutoff, and level, so a cut leaves them ready to re-idle.

export type MassDriverHum = {
  /** Ramp the fundamental to `midi` over `seconds`, optionally settling the level. */
  glideTo(midi: number, atTime: number, seconds: number, level?: number): void;
  /** Return to the E1 attract drone with a slow LFO wobble. */
  idle(atTime: number): void;
  /** Kill the drone on the shot. */
  cutAt(time: number): void;
};

const HUM_IDLE_MIDI = 28; // E1

export function installMassDriverHum(context: AudioContext, mix: MixBus): MassDriverHum {
  const output = mix.music;
  const humGain = context.createGain();
  humGain.gain.value = 0.0001;
  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 220;
  lowpass.Q.value = 0.8;
  lowpass.connect(humGain).connect(output);

  // Detuned saws carry the harmonics the ear tracks as pitch; the sine adds weight.
  const oscillators: OscillatorNode[] = [];
  const baseFreq = midiToFreq(HUM_IDLE_MIDI);
  const specs: Array<{ type: OscillatorType; detune: number; gain: number }> = [
    { type: 'sawtooth', detune: -7, gain: 0.5 },
    { type: 'sawtooth', detune: 7, gain: 0.5 },
    { type: 'sine', detune: 0, gain: 0.95 },
  ];
  for (const spec of specs) {
    const osc = context.createOscillator();
    osc.type = spec.type;
    osc.frequency.value = baseFreq;
    osc.detune.value = spec.detune;
    const gain = context.createGain();
    gain.gain.value = spec.gain;
    osc.connect(gain).connect(lowpass);
    osc.start();
    oscillators.push(osc);
  }

  // A slow always-on wobble keeps the idle drone alive without any per-run bookkeeping.
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 5;
  lfo.connect(lfoGain);
  for (const osc of oscillators) lfoGain.connect(osc.detune);
  lfo.start();

  let currentMidi = HUM_IDLE_MIDI;
  let currentCutoff = 220;

  const rampPitch = (midi: number, atTime: number, seconds: number) => {
    const from = midiToFreq(currentMidi);
    const target = midiToFreq(midi);
    for (const osc of oscillators) {
      osc.frequency.cancelScheduledValues(atTime);
      osc.frequency.setValueAtTime(from, atTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, target), atTime + seconds);
    }
    const cutoff = Math.min(4200, target * 7 + 90);
    lowpass.frequency.cancelScheduledValues(atTime);
    lowpass.frequency.setValueAtTime(currentCutoff, atTime);
    lowpass.frequency.linearRampToValueAtTime(cutoff, atTime + seconds);
    currentMidi = midi;
    currentCutoff = cutoff;
  };

  return {
    glideTo(midi, atTime, seconds, level) {
      rampPitch(midi, atTime, seconds);
      if (level !== undefined) {
        humGain.gain.cancelScheduledValues(atTime);
        humGain.gain.setTargetAtTime(level, atTime, Math.max(0.05, seconds * 0.4));
      }
    },
    idle(atTime) {
      rampPitch(HUM_IDLE_MIDI, atTime, 1.5);
      humGain.gain.cancelScheduledValues(atTime);
      humGain.gain.setTargetAtTime(0.06, atTime, 0.5);
    },
    cutAt(time) {
      const held = Math.max(0.0001, humGain.gain.value);
      humGain.gain.cancelScheduledValues(time);
      humGain.gain.setValueAtTime(held, time);
      humGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    },
  };
}

// ---- the instrument bank ----------------------------------------------------

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
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

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.16,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 42, time: time + 0.085 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.6 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.08,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 150, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.1,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 3000,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 850, time: time + 0.09 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.06 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.24,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 3400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 480, time: time + 0.2 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.045 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const klaxonTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth', detune: -8 }, { type: 'sawtooth', detune: 8 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 1400, Q: 3 },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.11, time: time + 0.04 },
      { type: 'linearRamp', value: 0.05, time: time + duration * 0.5 },
      { type: 'linearRamp', value: 0.001, time: time + duration },
    ],
  });

  const alarmTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 340,
      frequencyAutomation: (time, { duration }) => [{ type: 'linearRamp', value: 1600, time: time + duration * 0.8 }],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.13, time: time + duration * 0.7 },
      { type: 'linearRamp', value: 0, time: time + duration },
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

  const sparkleTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.7 }, { type: 'sine', octave: 1, gain: 0.3 }],
    duration: 0.32,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 5200 },
    gainAutomation: (time, gain) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
    ],
  });

  const subPulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.5,
    stopPadding: 0.05,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.5, time: time + 0.4 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.3 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
    ],
  });

  const playerToneSpec = voice<{ voice: MassDriverTonalVoice }>({
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
      kickTone.play({ context, time, frequency: 160, vel, destination: output });
      noiseHit(time, 0.08 * vel, 0.004, 'highpass', 2000, output);
      // The duck IS the pump: a moderate, grid-locked dip that recovers over the beat.
      mix.duckAt(time, 0.5, 0.18);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 9000, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.16, 'highpass', 7600, duck);
    },

    clap(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      // A little three-tap smear reads as a clap rather than a single burst.
      for (const [offset, level] of [[0, 0.7], [0.008, 0.5], [0.018, 1]] as const) {
        noiseHit(time + offset, vel * level, 0.02 + level * 0.05, 'bandpass', 1650, duck);
      }
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.18 * vel, 0.08, 'bandpass', 1850, output);
      noiseHit(time, 0.09 * vel, 0.03, 'highpass', 5400, output);
      snareBody.play({ context, time, frequency: 230, vel, destination: output });
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.85, 'highpass', 4800, output);
      noiseHit(time, vel * 0.5, 1.3, 'bandpass', 7400, reverbSend);
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.2;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.26 * vel, time + 0.006);
      subGain.gain.setValueAtTime(0.26 * vel, time + dur * 0.6);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      // A short detuned reese gives the mid punch without stepping on the hum's sub.
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(700 * vel + 240, time);
      filter.frequency.exponentialRampToValueAtTime(180, time + dur);
      const reeseGain = context.createGain();
      reeseGain.gain.setValueAtTime(0, time);
      reeseGain.gain.linearRampToValueAtTime(0.08 * vel, time + 0.005);
      reeseGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-12, 12]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
      filter.connect(reeseGain).connect(duck);
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.4 }] });
    },

    acid(context, time, midi, vel, accent) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      // Resonant lowpass with a fast cutoff decay — the 303 snarl. Accented steps
      // open brighter and ring longer.
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 7 + accent * 7;
      const top = 500 + accent * 2600 + vel * 900;
      filter.frequency.setValueAtTime(top, time);
      filter.frequency.exponentialRampToValueAtTime(220, time + 0.13 + accent * 0.08);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.09 * vel * (0.7 + accent * 0.5), time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12 + accent * 0.06);
      osc.connect(filter).connect(gain).connect(mix.duck);
      const echo = context.createGain();
      echo.gain.value = 0.3;
      gain.connect(echo).connect(mix.delaySend);
      osc.start(time);
      osc.stop(time + 0.24);
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.32 }] });
        }
      }
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-8, 8]) {
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 3;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(700, time);
          lowpass.frequency.linearRampToValueAtTime(1900, time + duration * 0.5);
          lowpass.frequency.linearRampToValueAtTime(900, time + duration);
          const level = (0.045 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain).connect(mix.duck);
          const hall = context.createGain();
          hall.gain.value = 0.55;
          gain.connect(hall).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    klaxon(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      klaxonTone.play({ context, time, midi, duration, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.4 }] });
    },

    alarm(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.45 }] });
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

    sparkle(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      sparkleTone.play({
        context,
        time,
        midi,
        vel,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.6 }, { destination: mix.reverbSend, gain: 0.4 }],
      });
    },

    subPulse(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subPulseTone.play({ context, time, midi, vel, destination: duck });
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.28 * vel, 0.32, 'lowpass', 400, output);
      instruments.crash(time, 0.18 * vel);
    },
  }, {
    kick: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    clap: ['vel'],
    snare: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel'],
    arp: ['midi', 'vel'],
    acid: ['midi', 'vel', 'accent'],
    stab: ['midis', 'vel'],
    pad: ['midis', 'duration', 'vel'],
    klaxon: ['midi', 'duration'],
    alarm: ['midi', 'duration'],
    riser: ['duration', 'level'],
    sparkle: ['midi', 'vel'],
    subPulse: ['midi', 'vel'],
    impact: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voiceSpec: MassDriverTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voiceSpec.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({
      context,
      time,
      midi,
      voice: voiceSpec,
      velocity: vel,
      weight,
      destination: output,
      sends: playerSends(0.36, voiceSpec.reverb),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
