import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

/** One player timbre. `air` and `echo` are how much room the note is allowed. */
export type SkyhookTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  air: number;
  echo: number;
};

export type SkyhookVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type WindBed = {
  /** Ramp the wind's level and brightness. Both go to nothing as the air does. */
  set(time: number, level: number, cutoff: number, seconds: number): void;
};

/**
 * The bed the whole first half of the score sits on: broadband wind through a
 * moving band-pass, with a slow gust LFO. It is the only voice in the level that
 * is present from the first frame, and the only one that has to be gone by the
 * end — up top there is nothing to carry sound at all.
 */
export function installSkyhookWind(context: AudioContext, mix: MixBus): WindBed | null {
  if (!mix.noiseBuffer) return null;
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;

  const band = context.createBiquadFilter();
  band.type = 'lowpass';
  band.frequency.value = 900;
  band.Q.value = 0.7;

  const body = context.createBiquadFilter();
  body.type = 'highpass';
  body.frequency.value = 140;

  const gain = context.createGain();
  gain.gain.value = 0.09;

  // Gusts: two slow LFOs so the bed never settles into a steady hiss.
  const gust = context.createOscillator();
  gust.frequency.value = 0.13;
  const gustGain = context.createGain();
  gustGain.gain.value = 0.05;
  gust.connect(gustGain).connect(gain.gain);

  const sweep = context.createOscillator();
  sweep.frequency.value = 0.071;
  const sweepGain = context.createGain();
  sweepGain.gain.value = 260;
  sweep.connect(sweepGain).connect(band.frequency);

  source.connect(body).connect(band).connect(gain).connect(mix.music);
  source.start();
  gust.start();
  sweep.start();

  return {
    set(time, level, cutoff, seconds) {
      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), time);
      gain.gain.linearRampToValueAtTime(level, time + seconds);
      band.frequency.cancelScheduledValues(time);
      band.frequency.setValueAtTime(band.frequency.value, time);
      band.frequency.linearRampToValueAtTime(cutoff, time + seconds);
    },
  };
}

export function createSkyhookVoices(environment: SkyhookVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(
    time: number,
    velocity: number,
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
      { type: 'set', value: 0.56 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.075,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 128, time: time + 0.055 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.13 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.075 },
    ],
  });

  // Struck panel — the level's snare above the cloud deck. Two detuned metal
  // partials over a short noise burst: a wrench on the tether, not a drum.
  const clankTone = voice<{ vel: number; ratio: number }>({
    oscillators: [{ type: 'square', frequencyRatio: ({ ratio }) => ratio, gain: 0.5 }],
    duration: 0.24,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 6, frequency: 2600 },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0.09 * vel * gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const pluckTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      frequency: 3400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 700, time: time + 0.15 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.062 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.7 },
      { type: 'sine', octave: 1, midiOffset: 7, gain: 0.18 },
    ],
    duration: 0.9,
    stopPadding: 0.06,
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0.09 * vel * gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 3000,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 520, time: time + 0.26 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.045 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const alarmTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 420,
      frequencyAutomation: (time, { duration }) => [{ type: 'linearRamp', value: 1700, time: time + duration * 0.8 }],
    },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: level, time: time + duration * 0.65 },
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

  // Dock beacon: one pure sine ping with a long tail. By the end of the level it
  // is very nearly the only thing left playing.
  const beaconTone = voice<{ vel: number; decay: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', octave: 1, gain: 0.12 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.08,
    gainAutomation: (time, gain, { vel, decay }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.13 * vel * gain, time: time + 0.012 },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const playerToneSpec = voice<{ voice: SkyhookTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.004, 'highpass', 1600, output);
      mix.duckAt(time, 0.42, 0.15);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.19 * vel, 0.08, 'bandpass', 1650, output);
      noiseHit(time, 0.09 * vel, 0.03, 'highpass', 5400, output);
      snareBody.play({ context, time, frequency: 205, vel, destination: output });
    },

    /** Rain and, higher up, dust: the hat line, tuned by decay and cutoff. */
    rain(_context, time, vel, decay, frequency) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', frequency, duck);
    },

    clank(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix?.reverbSend || !output) return;
      for (const ratio of [1, 1.51, 2.31]) {
        clankTone.play({
          context,
          time,
          frequency: 214,
          ratio,
          vel: vel / (1 + ratio * 0.4),
          destination: output,
          sends: [{ destination: mix.reverbSend, gain: 0.18 }],
        });
      }
      noiseHit(time, 0.13 * vel, 0.02, 'highpass', 7200, output);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.85, 'highpass', 4200, output);
      noiseHit(time, vel * 0.5, 1.5, 'bandpass', 6800, reverbSend);
    },

    /** Sub plus a filtered saw pair. `growl` opens the saws for the boss section. */
    bass(context, time, midi, vel, growl) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.24;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.3 * vel, time + 0.01);
      subGain.gain.setValueAtTime(0.3 * vel, time + dur * 0.65);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      if (growl <= 0) return;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(280 + growl * 1100 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(160, time + dur);
      const saws = context.createGain();
      saws.gain.setValueAtTime(0, time);
      saws.gain.linearRampToValueAtTime(0.085 * vel * growl, time + 0.006);
      saws.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-12, 12]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
      filter.connect(saws).connect(duck);
    },

    /** The air layer: wide detuned saws behind a vowel filter, soaked in hall. */
    air(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-11, 11]) {
          const osc = context.createOscillator();
          const vowel = context.createBiquadFilter();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 5;
          vowel.type = 'bandpass';
          vowel.frequency.setValueAtTime(520, time);
          vowel.frequency.linearRampToValueAtTime(880, time + duration * 0.5);
          vowel.frequency.linearRampToValueAtTime(520, time + duration);
          vowel.Q.value = 0.85;
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 2000;
          const level = (0.048 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.9, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(vowel).connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.7;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    /** A cold sustained saw with no room at all: the boss section's only pad. */
    drone(context, time, midi, duration, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 3;
      filter.frequency.setValueAtTime(220, time);
      filter.frequency.linearRampToValueAtTime(620, time + duration * 0.6);
      filter.frequency.linearRampToValueAtTime(240, time + duration);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.055 * vel, time + 0.25);
      gain.gain.setValueAtTime(0.055 * vel, time + duration - 0.3);
      gain.gain.linearRampToValueAtTime(0, time + duration);
      for (const detune of [-7, 6]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      filter.connect(gain).connect(duck);
    },

    /** Machinery: a short band-passed noise pulse, the Descender's winch. */
    grinder(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.09 * vel, 0.07, 'bandpass', 420, duck);
      noiseHit(time, 0.04 * vel, 0.03, 'bandpass', 1800, duck);
    },

    bell(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      bellTone.play({
        context,
        time,
        midi,
        vel,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }, { destination: mix.reverbSend, gain: 0.45 }],
      });
    },

    pluck(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      pluckTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.34 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.28 }] });
        }
      }
    },

    /** The climb motif. Two detuned saws with a slow vibrato and a soft top. */
    lead(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2900, time);
      filter.frequency.linearRampToValueAtTime(1500, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.075 * vel, time + 0.03);
      gain.gain.setValueAtTime(0.075 * vel, time + Math.max(0.03, duration - 0.1));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);
      const vibrato = context.createOscillator();
      const vibratoGain = context.createGain();
      vibrato.frequency.value = 5.1;
      vibratoGain.gain.setValueAtTime(0, time);
      vibratoGain.gain.linearRampToValueAtTime(5, time + Math.min(0.45, duration * 0.6));
      for (const [type, detune] of [['sawtooth', -6], ['triangle', 6]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        vibrato.connect(vibratoGain).connect(osc.detune);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      vibrato.start(time);
      vibrato.stop(time + duration + 0.05);
      filter.connect(gain);
      gain.connect(mix.duck);
      const echo = context.createGain();
      echo.gain.value = 0.42;
      gain.connect(echo).connect(mix.delaySend);
      const hall = context.createGain();
      hall.gain.value = 0.3;
      gain.connect(hall).connect(mix.reverbSend);
    },

    alarm(context, time, midi, duration, level) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      alarmTone.play({ context, time, midi, duration, level, destination: mix.duck });
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

    beacon(context, time, midi, vel, decay) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!output) return;
      beaconTone.play({
        context,
        time,
        midi,
        vel,
        decay,
        destination: output,
        sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.32 }] : undefined,
      });
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 116, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.34, 'lowpass', 380, output);
      instruments.crash(time, 0.15 * vel);
    },
  }, {
    kick: ['vel'],
    snare: ['vel'],
    rain: ['vel', 'decay', 'frequency'],
    clank: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel', 'growl'],
    air: ['midis', 'duration', 'vel'],
    drone: ['midi', 'duration', 'vel'],
    grinder: ['vel'],
    bell: ['midi', 'vel'],
    pluck: ['midi', 'vel'],
    stab: ['midis', 'vel'],
    lead: ['midi', 'duration', 'vel'],
    alarm: ['midi', 'duration', 'level'],
    riser: ['duration', 'level'],
    beacon: ['midi', 'vel', 'decay'],
    impact: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tonal: SkyhookTonalVoice, vel: number, weight = 1) {
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
      sends: playerSends(tonal.echo, tonal.air),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
