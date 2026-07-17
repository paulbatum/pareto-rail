import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Mass Driver's instrument rack: locked minimal techno — the kick's duck IS
// the pump — plus the gun's own voice: the climbing hum, the klaxon, alarm
// sweeps, risers, and the discharge transient.

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

export type GunHum = {
  /** Ramp the fundamental (as MIDI) over `glide` seconds starting at `time`. */
  rampTo(time: number, midi: number, glide: number, level: number, cutoff: number): void;
  /** Kill the hum dead in a heartbeat. */
  cut(time: number): void;
  /** Return to the attract-mode idle wobble. */
  idle(time: number): void;
};

// The climbing hum: detuned saws over a sine sub through a lowpass. It idles
// low in attract mode with a slow wobble; across the run it climbs a fourth,
// then an octave, then accelerates into the charge peak. The shot cuts it dead.
export function installGunHum(context: AudioContext | null, mix: MixBus | null, trace?: AudioTraceSink): GunHum {
  const IDLE_MIDI = 28; // E1
  const IDLE_LEVEL = 0.085;
  const IDLE_CUTOFF = 340;

  if (trace || !context || !mix) {
    return {
      rampTo(time, midi, _glide, level, cutoff) {
        trace?.record(time, 'hum', { midi, level, cutoff });
      },
      cut(time) {
        trace?.record(time, 'humCut', {});
      },
      idle(time) {
        trace?.record(time, 'humIdle', {});
      },
    };
  }

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = IDLE_CUTOFF;
  filter.Q.value = 1.4;
  const gain = context.createGain();
  gain.gain.value = IDLE_LEVEL;
  filter.connect(gain).connect(mix.music);

  const oscillators: OscillatorNode[] = [];
  for (const [type, ratio, detune, level] of [
    ['sawtooth', 1, -7, 0.5],
    ['sawtooth', 1, 7, 0.5],
    ['sine', 0.5, 0, 1.0],
  ] as const) {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = midiToFreq(IDLE_MIDI) * ratio;
    osc.detune.value = detune;
    const level0 = context.createGain();
    level0.gain.value = level;
    osc.connect(level0).connect(filter);
    osc.start();
    oscillators.push(osc);
  }

  // Slow idle wobble.
  const wobble = context.createOscillator();
  wobble.frequency.value = 0.13;
  const wobbleGain = context.createGain();
  wobbleGain.gain.value = 4;
  wobble.connect(wobbleGain);
  for (const osc of oscillators) wobbleGain.connect(osc.detune);
  wobble.start();

  const setFrequency = (time: number, midi: number, glide: number) => {
    const ratios = [1, 1, 0.5];
    oscillators.forEach((osc, index) => {
      const target = midiToFreq(midi) * ratios[index];
      osc.frequency.cancelScheduledValues(time);
      osc.frequency.setValueAtTime(Math.max(10, osc.frequency.value), time);
      osc.frequency.exponentialRampToValueAtTime(target, time + Math.max(0.02, glide));
    });
  };

  return {
    rampTo(time, midi, glide, level, cutoff) {
      setFrequency(time, midi, glide);
      gain.gain.cancelScheduledValues(time);
      gain.gain.setTargetAtTime(level, time, Math.max(0.05, glide * 0.5));
      filter.frequency.cancelScheduledValues(time);
      filter.frequency.setTargetAtTime(cutoff, time, Math.max(0.05, glide * 0.5));
    },
    cut(time) {
      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(gain.gain.value, time);
      gain.gain.linearRampToValueAtTime(0, time + 0.045);
    },
    idle(time) {
      setFrequency(time, IDLE_MIDI, 1.6);
      gain.gain.cancelScheduledValues(time);
      gain.gain.setTargetAtTime(IDLE_LEVEL, time, 1.2);
      filter.frequency.cancelScheduledValues(time);
      filter.frequency.setTargetAtTime(IDLE_CUTOFF, time, 1.2);
    },
  };
}

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
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 42, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.55 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.07,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 140, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.13 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 2700,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 850, time: time + 0.08 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
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
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  // 303-flavored acid pluck: resonant lowpass, per-note accent and slide-down.
  const acidTone = voice<{ vel: number; open: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 9,
      frequency: 900,
      frequencyAutomation: (time, { vel, open }) => [
        { type: 'set', value: 500 + open * 2600 * vel, time },
        { type: 'exponentialRamp', value: 320, time: time + 0.13 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.06 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const alarmTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 380,
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
      { type: 'set', value: 0.52 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
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
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.004, 'highpass', 2200, output);
      // Moderate sidechain: the duck is the pump.
      mix.duckAt(time, 0.42, 0.2);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.18 * vel, 0.07, 'bandpass', 1850, output);
      noiseHit(time, 0.09 * vel, 0.028, 'highpass', 5600, output);
      snareBody.play({ context, time, frequency: 220, vel, destination: output });
    },

    clap(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      // Three tight noise bursts read as a clap.
      for (const [offset, level] of [[0, 0.7], [0.012, 0.55], [0.026, 1]] as const) {
        noiseHit(time + offset, 0.13 * vel * level, offset === 0.026 ? 0.09 : 0.02, 'bandpass', 1450, output);
      }
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8600, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.17, 'highpass', 7600, duck);
    },

    // High-voltage tick: the dry metallic pulse under the grid.
    tick(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel * 0.55, 0.012, 'bandpass', 6200, duck);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.05,
        oscillatorType: 'sine',
        frequency: 2093,
        gainAutomation: [
          { type: 'set', value: 0.02 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.04 },
        ],
        destination: duck,
      });
    },

    bass(context, time, midi, vel, growl) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.19;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.27 * vel, time + 0.008);
      subGain.gain.setValueAtTime(0.27 * vel, time + dur * 0.7);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(280 + growl * 850 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(160, time + dur);
      const sawGain = context.createGain();
      sawGain.gain.setValueAtTime(0, time);
      sawGain.gain.linearRampToValueAtTime(0.09 * vel, time + 0.006);
      sawGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-11, 11]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
      filter.connect(sawGain).connect(duck);
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
          osc.detune.value = detune + Math.sin(midi * 5.7) * 3;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(900, time);
          lowpass.frequency.linearRampToValueAtTime(1900, time + duration * 0.45);
          lowpass.frequency.linearRampToValueAtTime(750, time + duration);
          const level = (0.045 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.25));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.0, duration * 0.3));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.55;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.45 }] });
    },

    acid(context, time, midi, vel, open) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      acidTone.play({ context, time, midi, vel, open, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.3 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.35 }] });
        }
      }
    },

    // Two-bar klaxon: alternating minor-second blasts through a bandpass.
    klaxon(context, time, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      const burst = 0.234;
      const count = Math.floor(duration / burst);
      for (let i = 0; i < count; i += 1) {
        const at = time + i * burst;
        const midi = i % 2 === 0 ? 71 : 70;
        const envelope = 1 - (i / count) * 0.35;
        playOscillatorVoice({
          context,
          time: at,
          stopTime: at + burst * 0.85,
          oscillatorType: 'square',
          frequency: midiToFreq(midi),
          filter: { type: 'bandpass', Q: 2.4, frequency: 1300 },
          gainAutomation: [
            { type: 'set', value: 0.001, time: at },
            { type: 'exponentialRamp', value: 0.055 * envelope, time: at + 0.02 },
            { type: 'exponentialRamp', value: 0.001, time: at + burst * 0.8 },
          ],
          destination: mix.duck,
          sends: [{ destination: mix.reverbSend, gain: 0.4 }],
        });
      }
    },

    alarm(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.5 }] });
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
          frequency: 300,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 7600, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.9, 'highpass', 4800, output);
      noiseHit(time, vel * 0.5, 1.5, 'bandpass', 7400, reverbSend);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.3, 'lowpass', 400, output);
      instruments.crash(time, 0.15 * vel);
    },

    // Glassy sparkle for the muzzle bars: a quiet high ping into the delay.
    sparkle(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.045 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: mix.duck,
        sends: [
          { destination: mix.delaySend, gain: 0.7 },
          { destination: mix.reverbSend, gain: 0.5 },
        ],
      });
    },

    // The detonation: everything cuts to a long low sub rumble and filtered noise.
    detonation(context, time) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 3.6,
        oscillatorType: 'sine',
        frequency: 46,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 24, time: time + 3.0 }],
        gainAutomation: [
          { type: 'set', value: 0.5, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 3.4 },
        ],
        destination: output,
      });
      if (!noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + 3.2,
        loop: true,
        filter: {
          type: 'lowpass',
          frequency: 900,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 120, time: time + 2.8 }],
        },
        gainAutomation: [
          { type: 'set', value: 0.3, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 3.0 },
        ],
        destination: output,
      });
    },
  }, {
    kick: ['vel'],
    snare: ['vel'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    tick: ['vel'],
    bass: ['midi', 'vel', 'growl'],
    pad: ['midis', 'duration', 'vel'],
    arp: ['midi', 'vel'],
    acid: ['midi', 'vel', 'open'],
    stab: ['midis', 'vel'],
    klaxon: ['duration'],
    alarm: ['midi', 'duration'],
    riser: ['duration', 'level'],
    crash: ['vel'],
    impact: ['vel'],
    sparkle: ['midi', 'vel'],
    detonation: [],
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
      sends: playerSends(0.4, voiceSpec.reverb),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  // Clamp-release clank: metallic body + a pitch that drops per interlock.
  function clank(time: number, drop: number) {
    if (environment.trace) {
      environment.trace.record(time, 'clank', { drop });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    const base = 330 * 2 ** (-drop / 7);
    for (const [ratio, level] of [[1, 0.11], [1.53, 0.06], [2.79, 0.035]] as const) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'square',
        frequency: base * ratio,
        filter: { type: 'bandpass', Q: 3.2, frequency: base * ratio },
        frequencyAutomation: [{ type: 'exponentialRamp', value: base * ratio * 0.72, time: time + 0.22 }],
        gainAutomation: [
          { type: 'set', value: level, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
        ],
        destination: output,
        sends: playerSends(0.15, 0.3),
      });
    }
    playerNoise(time, 0.1, 0.05, 2400);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise, clank };
}
