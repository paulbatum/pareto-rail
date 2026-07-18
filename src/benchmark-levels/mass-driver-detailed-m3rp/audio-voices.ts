import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// A per-section player timbre: lock and kill read the live harmony; these
// fields tune brightness, tail, and hall so the player's instrument crossfades
// with the arrangement instead of sitting on top of it as generic SFX.
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
// The gun spooling up: a persistent tonal drone — two detuned saws over a sine
// sub, folded through one lowpass into the music bus — whose fundamental the
// arrangement steers bar by bar. It idles low in attract mode with a slow
// wobble, climbs across the whole run, swells into the firing charge, and the
// shot cuts it dead in a heartbeat. The oscillators live for the whole session;
// runs only steer pitch, cutoff, and level, so a cut leaves them ready to
// re-idle when the run ends.

export type MassDriverHum = {
  /** Ramp the fundamental to `midi` over `seconds`, optionally settling the level. */
  glideTo(midi: number, atTime: number, seconds: number, level?: number): void;
  /** Return to the low attract-mode drone. */
  idle(atTime: number): void;
  /** Kill the drone dead — THE SHOT, or the player's death. */
  cutAt(time: number): void;
};

const HUM_IDLE_MIDI = 28; // E1

export function installMassDriverHum(context: AudioContext, mix: MixBus): MassDriverHum {
  const humGain = context.createGain();
  humGain.gain.value = 0.0001;
  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 210;
  lowpass.Q.value = 0.9;
  lowpass.connect(humGain).connect(mix.music);

  const oscillators: OscillatorNode[] = [];
  const baseFreq = midiToFreq(HUM_IDLE_MIDI);
  for (const spec of [
    { type: 'sawtooth' as OscillatorType, detune: -8, gain: 0.46 },
    { type: 'sawtooth' as OscillatorType, detune: 8, gain: 0.46 },
    { type: 'sine' as OscillatorType, detune: 0, gain: 1.0 },
  ]) {
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

  // A slow always-on detune wobble keeps the idle drone breathing with no
  // per-run bookkeeping.
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 6;
  lfo.connect(lfoGain);
  for (const osc of oscillators) lfoGain.connect(osc.detune);
  lfo.start();

  let currentMidi = HUM_IDLE_MIDI;
  let currentCutoff = 210;

  const rampPitch = (midi: number, atTime: number, seconds: number) => {
    const from = midiToFreq(currentMidi);
    const target = midiToFreq(midi);
    for (const osc of oscillators) {
      osc.frequency.cancelScheduledValues(atTime);
      osc.frequency.setValueAtTime(from, atTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, target), atTime + seconds);
    }
    // The filter opens as the charge builds: the hum brightens as it climbs.
    const cutoff = Math.min(4400, target * 6.5 + 100);
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
      rampPitch(HUM_IDLE_MIDI, atTime, 1.6);
      humGain.gain.cancelScheduledValues(atTime);
      humGain.gain.setTargetAtTime(0.055, atTime, 0.5);
    },
    cutAt(time) {
      const held = Math.max(0.0001, humGain.gain.value);
      humGain.gain.cancelScheduledValues(time);
      humGain.gain.setValueAtTime(held, time);
      humGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
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
    duration: 0.17,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 40, time: time + 0.09 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.58 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.09,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 155, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.11 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.11,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 2800,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 800, time: time + 0.1 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.055 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  // The coil tick: a struck-coil ping scheduled on every beat, because a ring
  // crosses the cockpit on every beat. The audible half of the level's one
  // non-negotiable — brighter and a fifth deeper on downbeats.
  const coilTickTone = voice<{ vel: number; down: boolean }>({
    oscillators: [{ type: 'square', gain: 0.6 }, { type: 'sine', octave: 1, gain: 0.4 }],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: ({ down }) => (down ? 5 : 8), cutoff: ({ down }) => (down ? 2100 : 3300) },
    gainAutomation: (time, _gain, { vel, down }) => [
      { type: 'set', value: (down ? 0.055 : 0.03) * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + (down ? 0.07 : 0.045) },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.26,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 3200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 460, time: time + 0.22 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.042 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  // Two detuned saws a minor third apart under a resonant lowpass: the jam warning.
  const klaxonTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth', detune: -9 }, { type: 'sawtooth', detune: 9, midiOffset: 3, gain: 0.7 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 1300, Q: 3.5 },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.1, time: time + 0.05 },
      { type: 'linearRamp', value: 0.045, time: time + duration * 0.55 },
      { type: 'linearRamp', value: 0.001, time: time + duration },
    ],
  });

  const alarmTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 320,
      frequencyAutomation: (time, { duration }) => [{ type: 'linearRamp', value: 1750, time: time + duration * 0.82 }],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.12, time: time + duration * 0.72 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.85,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 27, time: time + 0.6 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
    ],
  });

  const sparkleTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.65 }, { type: 'sine', octave: 1, gain: 0.35 }],
    duration: 0.34,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 5400 },
    gainAutomation: (time, gain) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  const subPulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.55,
    stopPadding: 0.05,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.5, time: time + 0.42 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.28 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
    ],
  });

  const playerToneSpec = voice<{ voice: MassDriverTonalVoice }>({
    oscillators: [{ type: ({ voice: v }) => v.oscillator, gain: ({ voice: v }) => v.gain }],
    duration: ({ voice: v }) => v.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice: v }) => v.cutoff },
    envelope: { decay: ({ voice: v }) => v.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 155, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.004, 'highpass', 2200, output);
      // Moderate sidechain: the kick's grid-locked duck IS the pump.
      mix.duckAt(time, 0.52, 0.17);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 9200, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.15, 'highpass', 7400, duck);
    },

    clap(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      for (const [offset, level] of [[0, 0.65], [0.009, 0.5], [0.019, 1]] as const) {
        noiseHit(time + offset, vel * level, 0.02 + level * 0.05, 'bandpass', 1700, duck);
      }
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.17 * vel, 0.08, 'bandpass', 1900, output);
      noiseHit(time, 0.08 * vel, 0.03, 'highpass', 5600, output);
      snareBody.play({ context, time, frequency: 235, vel, destination: output });
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.9, 'highpass', 4600, output);
      noiseHit(time, vel * 0.5, 1.35, 'bandpass', 7200, reverbSend);
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.19;
      // A clean sub carries the root...
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.25 * vel, time + 0.006);
      subGain.gain.setValueAtTime(0.25 * vel, time + dur * 0.6);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      // ...and a short detuned pair an octave up gives it a punchy mid edge
      // without treading on the hum's register.
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 5.5;
      filter.frequency.setValueAtTime(650 * vel + 260, time);
      filter.frequency.exponentialRampToValueAtTime(170, time + dur);
      const edgeGain = context.createGain();
      edgeGain.gain.setValueAtTime(0, time);
      edgeGain.gain.linearRampToValueAtTime(0.075 * vel, time + 0.005);
      edgeGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-11, 11]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
      filter.connect(edgeGain).connect(duck);
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.42 }] });
    },

    coilTick(context, time, midi, vel, down) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      coilTickTone.play({ context, time, midi, vel, down, destination: mix.duck });
    },

    acid(context, time, midi, vel, accent) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      // Resonant lowpass with a fast cutoff fall — the 303 snarl. Accents open
      // wider and ring a touch longer.
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 7 + accent * 6;
      const top = 480 + accent * 2500 + vel * 950;
      filter.frequency.setValueAtTime(top, time);
      filter.frequency.exponentialRampToValueAtTime(210, time + 0.13 + accent * 0.08);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.085 * vel * (0.7 + accent * 0.5), time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12 + accent * 0.06);
      osc.connect(filter).connect(gain).connect(mix.duck);
      const echo = context.createGain();
      echo.gain.value = 0.28;
      gain.connect(echo).connect(mix.delaySend);
      osc.start(time);
      osc.stop(time + 0.25);
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.3 }] });
        }
      }
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 4.7) * 3;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(650, time);
          lowpass.frequency.linearRampToValueAtTime(1850, time + duration * 0.5);
          lowpass.frequency.linearRampToValueAtTime(850, time + duration);
          const level = (0.043 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain).connect(mix.duck);
          const hall = context.createGain();
          hall.gain.value = 0.5;
          gain.connect(hall).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    klaxon(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      klaxonTone.play({ context, time, midi, duration, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.38 }] });
    },

    alarm(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.42 }] });
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
          Q: 1.3,
          frequency: 230,
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

    sparkle(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      sparkleTone.play({
        context,
        time,
        midi,
        vel,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.62 }, { destination: mix.reverbSend, gain: 0.42 }],
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
      impactTone.play({ context, time, frequency: 105, vel, destination: output });
      noiseHit(time, 0.27 * vel, 0.34, 'lowpass', 380, output);
      instruments.crash(time, 0.17 * vel);
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
    coilTick: ['midi', 'vel', 'down'],
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
      sends: playerSends(0.34, voiceSpec.reverb),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
