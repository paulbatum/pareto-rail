import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Synth construction only; the score decides every pitch, gain and moment.
// The palette is one machine: a sine thump for the ring pass, metal for the
// coils, a resonant capacitor pluck, and a single continuous rail hum that
// climbs in pitch across the whole run and becomes the muzzle scream.

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

export type RailHum = {
  /** Glide the fundamental to `midi` over `seconds`. */
  glide(time: number, midi: number, seconds: number): void;
  /** Ride the hum's level; 0 silences it. */
  level(time: number, value: number, seconds: number): void;
  /** Open or close the resonant filter riding on top of the fundamental. */
  brightness(time: number, hz: number, seconds: number): void;
  /** Depth of the pulsing amplitude modulation — the gun's idle tremble. */
  tremble(time: number, depth: number, rate: number, seconds: number): void;
};

/**
 * The gun's own voice: a detuned saw pair over a sine sub, through a resonant
 * lowpass, running continuously from the moment audio starts. Everything else in
 * the mix sits on top of it.
 */
export function installRailHum(context: AudioContext, mix: MixBus): RailHum {
  const output = context.createGain();
  output.gain.value = 0.0001;
  output.connect(mix.music);

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 220;
  filter.Q.value = 6;
  filter.connect(output);

  const sub = context.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = midiToFreq(21);
  const subGain = context.createGain();
  subGain.gain.value = 0.72;
  sub.connect(subGain).connect(output);

  const saws: OscillatorNode[] = [];
  for (const detune of [-9, 9]) {
    const saw = context.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = midiToFreq(33);
    saw.detune.value = detune;
    const gain = context.createGain();
    gain.gain.value = 0.16;
    saw.connect(gain).connect(filter);
    saws.push(saw);
  }

  // Slow amplitude tremble: the barrel's idle, and the thing that speeds up as
  // the firing charge builds.
  const trembleOscillator = context.createOscillator();
  trembleOscillator.type = 'sine';
  trembleOscillator.frequency.value = 1.4;
  const trembleDepth = context.createGain();
  trembleDepth.gain.value = 0;
  trembleOscillator.connect(trembleDepth).connect(output.gain);

  sub.start();
  for (const saw of saws) saw.start();
  trembleOscillator.start();

  return {
    glide(time, midi, seconds) {
      const fundamental = Math.max(12, midiToFreq(midi));
      sub.frequency.cancelScheduledValues(time);
      sub.frequency.setValueAtTime(Math.max(8, sub.frequency.value), time);
      sub.frequency.exponentialRampToValueAtTime(fundamental, time + Math.max(0.02, seconds));
      for (const saw of saws) {
        saw.frequency.cancelScheduledValues(time);
        saw.frequency.setValueAtTime(Math.max(8, saw.frequency.value), time);
        saw.frequency.exponentialRampToValueAtTime(fundamental * 2, time + Math.max(0.02, seconds));
      }
    },
    level(time, value, seconds) {
      output.gain.cancelScheduledValues(time);
      output.gain.setValueAtTime(Math.max(0.0001, output.gain.value), time);
      output.gain.linearRampToValueAtTime(Math.max(0.0001, value), time + Math.max(0.02, seconds));
    },
    brightness(time, hz, seconds) {
      filter.frequency.cancelScheduledValues(time);
      filter.frequency.setValueAtTime(Math.max(40, filter.frequency.value), time);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, hz), time + Math.max(0.02, seconds));
    },
    tremble(time, depth, rate, seconds) {
      trembleOscillator.frequency.cancelScheduledValues(time);
      trembleOscillator.frequency.setValueAtTime(trembleOscillator.frequency.value, time);
      trembleOscillator.frequency.linearRampToValueAtTime(Math.max(0.1, rate), time + Math.max(0.02, seconds));
      trembleDepth.gain.cancelScheduledValues(time);
      trembleDepth.gain.setValueAtTime(trembleDepth.gain.value, time);
      trembleDepth.gain.linearRampToValueAtTime(depth, time + Math.max(0.02, seconds));
    },
  };
}

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseSpec = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noise(
    time: number,
    velocity: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    destination: AudioNode,
  ) {
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseSpec.play({
      context,
      buffer,
      time,
      velocity,
      decay,
      filterType,
      frequency,
      destination,
      offset: Math.random() * 1.5,
    });
  }

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.19,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 41, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const clankBody = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.06,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 140, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.075 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.06 },
    ],
  });

  const pluckTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: {
      type: 'bandpass',
      Q: 6,
      frequency: 1500,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 520, time: time + 0.12 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.1 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 3,
      frequency: 3200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 420, time: time + 0.26 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.045 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const alarmTone = voice<{ duration: number; vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 900 },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.075 * vel, time: time + duration * 0.25 },
      { type: 'linearRamp', value: 0.0001, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.9,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 26, time: time + 0.6 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.6 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const dischargeTone = voice<{ vel: number; duration: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.5 }, { type: 'square', octave: -1, gain: 0.35 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      Q: 9,
      frequency: 4800,
      frequencyAutomation: (time, { duration }) => [{ type: 'exponentialRamp', value: 90, time: time + duration }],
    },
    frequencyAutomation: (time, frequency, { duration }) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: frequency * 0.06, time: time + duration },
    ],
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.22 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const playerToneSpec = voice<{ voice: MassDriverTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', Q: 2.5, cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    /** The ring pass. Fires on every beat, all sixty seconds; it is the level. */
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 180, vel, destination: output });
      noise(time, 0.11 * vel, 0.005, 'highpass', 2600, output);
      mix.duckAt(time, 0.46, 0.14);
    },

    /** Steel on steel between coils: the offbeat that keeps the pulse hypnotic. */
    coil(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noise(time, vel, decay, 'bandpass', 3400, duck);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noise(time, vel, decay, 'highpass', 9200, duck);
    },

    clank(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noise(time, 0.16 * vel, 0.09, 'bandpass', 2100, output);
      noise(time, 0.07 * vel, 0.028, 'highpass', 6400, output);
      clankBody.play({ context, time, frequency: 240, vel, destination: output });
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noise(time, vel, 1.0, 'highpass', 5200, output);
      noise(time, vel * 0.5, 1.8, 'bandpass', 7800, reverbSend);
    },

    /** Bass: a hard sine sub under a resonant square, the coil driver. */
    bass(context, time, midi, vel, growl) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const duration = 0.24;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.3 * vel, time + 0.008);
      subGain.gain.setValueAtTime(0.3 * vel, time + duration * 0.6);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + duration + 0.03);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 9;
      filter.frequency.setValueAtTime(260 + growl * 1400 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(150, time + duration);
      const driveGain = context.createGain();
      driveGain.gain.setValueAtTime(0, time);
      driveGain.gain.linearRampToValueAtTime(0.085 * vel, time + 0.006);
      driveGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      for (const detune of [-11, 11]) {
        const osc = context.createOscillator();
        osc.type = 'square';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.03);
      }
      filter.connect(driveGain).connect(duck);
    },

    /** Field pad: the standing wave in the barrel. Wide, slow, always underneath. */
    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          const osc = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.7) * 5;
          filter.type = 'lowpass';
          filter.Q.value = 1.4;
          filter.frequency.setValueAtTime(520, time);
          filter.frequency.linearRampToValueAtTime(1500, time + duration * 0.5);
          filter.frequency.linearRampToValueAtTime(560, time + duration);
          const level = (0.036 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.9, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(filter).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.5;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.06);
        }
      }
    },

    /** Capacitor pluck: the hypnotic sixteenth line running under the pulse. */
    pluck(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      pluckTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.46 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-9, 9]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.4 }] });
        }
      }
    },

    /** Interlock fault siren. */
    alarm(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({
        context,
        time,
        midi,
        duration,
        vel,
        destination: mix.duck,
        sends: [{ destination: mix.reverbSend, gain: 0.45 }],
      });
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
          frequency: 220,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 8200, time: time + duration }],
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
      impactTone.play({ context, time, frequency: 130, vel, destination: output });
      noise(time, 0.28 * vel, 0.36, 'lowpass', 380, output);
      instruments.crash(time, 0.18 * vel);
    },

    /** The gun firing: everything the barrel has, dumped downward at once. */
    discharge(context, time, midi, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      dischargeTone.play({ context, time, midi, duration, vel, destination: output });
      noise(time, 0.42 * vel, duration * 0.8, 'lowpass', 900, output);
      noise(time, 0.2 * vel, duration, 'highpass', 4200, output);
    },
  }, {
    kick: ['vel'],
    coil: ['vel', 'decay'],
    hat: ['vel', 'decay'],
    clank: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel', 'growl'],
    pad: ['midis', 'duration', 'vel'],
    pluck: ['midi', 'vel'],
    stab: ['midis', 'vel'],
    alarm: ['midi', 'duration', 'vel'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    discharge: ['midi', 'duration', 'vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tonal: MassDriverTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonal.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({
      context,
      time,
      midi,
      voice: tonal,
      velocity: vel,
      weight,
      destination: output,
      sends: playerSends(0.34, tonal.reverb),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noise(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit: noise, playerSends, playerTone, playerNoise };
}
