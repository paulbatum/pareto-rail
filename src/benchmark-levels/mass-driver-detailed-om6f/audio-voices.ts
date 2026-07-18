import {
  createAudioGraphBuilder,
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf: synth construction only. Every number that decides *when* something
// plays lives in audio.ts; this file only decides what a kick, a klaxon, or the
// gun's hum sounds like.

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

/**
 * The gun spooling up: detuned saws over a sine sub through a lowpass. It runs
 * for the whole session as one persistent voice — started once, steered by
 * pitch, level, and cutoff — because a retriggered note could never sound like
 * a machine that has been winding since before you got here.
 */
export type Hum = {
  set(time: number, midi: number, level: number, cutoff: number, glide: number): void;
  cut(time: number): void;
  dispose(): void;
};

function createHum(context: AudioContext, destination: AudioNode): Hum {
  const graph = createAudioGraphBuilder(context);
  const output = graph.gain(0.0001);
  const filter = graph.biquadFilter({ type: 'lowpass', frequency: 260, Q: 2.6 });
  graph.connect(filter, output);
  graph.connect(output, destination);

  const oscillators: OscillatorNode[] = [];
  const partials: Array<{ detune: number; octave: number; type: OscillatorType; gain: number }> = [
    { detune: -11, octave: 0, type: 'sawtooth', gain: 0.34 },
    { detune: 9, octave: 0, type: 'sawtooth', gain: 0.34 },
    { detune: 4, octave: 1, type: 'sawtooth', gain: 0.12 },
    { detune: 0, octave: -1, type: 'sine', gain: 0.85 },
  ];
  for (const partial of partials) {
    const oscillator = context.createOscillator();
    oscillator.type = partial.type;
    oscillator.detune.value = partial.detune;
    const gain = graph.gain(partial.gain);
    oscillator.connect(gain).connect(filter);
    oscillator.start();
    oscillators.push(oscillator);
    (oscillator as OscillatorNode & { __octave?: number }).__octave = partial.octave;
  }

  // A slow wobble so the idle hum never sits perfectly still.
  const wobble = context.createOscillator();
  wobble.type = 'sine';
  wobble.frequency.value = 0.11;
  const wobbleDepth = graph.gain(26);
  wobble.connect(wobbleDepth).connect(filter.frequency);
  wobble.start();

  return {
    set(time, midi, level, cutoff, glide) {
      for (const oscillator of oscillators) {
        const octave = (oscillator as OscillatorNode & { __octave?: number }).__octave ?? 0;
        oscillator.frequency.setTargetAtTime(midiToFreq(midi + octave * 12), time, Math.max(0.01, glide));
      }
      filter.frequency.setTargetAtTime(cutoff, time, Math.max(0.02, glide * 0.7));
      output.gain.setTargetAtTime(Math.max(0.0001, level), time, Math.max(0.02, glide * 0.6));
    },
    cut(time) {
      // The shot kills it in a heartbeat.
      output.gain.cancelScheduledValues(time);
      output.gain.setValueAtTime(Math.max(0.0001, output.gain.value), time);
      output.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
    },
    dispose() {
      for (const oscillator of oscillators) oscillator.stop();
      wobble.stop();
    },
  };
}

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const duckDestination = () => environment.mix()?.duck ?? musicDestination();
  let hum: Hum | null = null;

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
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseHitVoice.play({
      context,
      buffer,
      time,
      velocity,
      decay,
      filterType,
      frequency,
      destination,
      loopStart: Math.random(),
      offset: Math.random() * 1.6,
    });
  }

  function attachHum(context: AudioContext, mix: MixBus) {
    hum?.dispose();
    hum = createHum(context, mix.music);
  }

  function detachHum() {
    hum?.dispose();
    hum = null;
  }

  // --- music voices --------------------------------------------------------

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.19,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 41, time: time + 0.09 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const bassTone = voice<{ vel: number; length: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.55 },
      { type: 'square', gain: 0.22, octave: -1 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time, { vel, length }) => [
        { type: 'set', value: 240 + vel * 900, time },
        { type: 'exponentialRamp', value: 170, time: time + length * 0.85 },
      ],
    },
    gainAutomation: (time, _gain, { vel, length }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.26 * vel, time: time + 0.005 },
      { type: 'exponentialRamp', value: 0.001, time: time + length },
    ],
  });

  const padTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 380, time },
        { type: 'linearRamp', value: 900, time: time + duration * 0.55 },
        { type: 'linearRamp', value: 420, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0.0005, time },
      { type: 'linearRamp', value: level, time: time + Math.min(0.9, duration * 0.3) },
      { type: 'set', value: level, time: time + duration * 0.75 },
      { type: 'linearRamp', value: 0.0005, time: time + duration },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.8 }, { type: 'square', gain: 0.12 }],
    duration: 0.13,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ vel }) => 1800 + vel * 2600 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.15 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  // The 303: one saw through a resonant lowpass with an accent-driven sweep.
  const acidTone = voice<{ vel: number; accent: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.17,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 11,
      frequencyAutomation: (time, { accent }) => [
        { type: 'set', value: 420 + accent * 2400, time },
        { type: 'exponentialRamp', value: 250, time: time + 0.16 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.1 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
  });

  const klaxonTone = voice<{ duration: number }>({
    oscillators: [{ type: 'square', gain: 0.5 }, { type: 'sawtooth', gain: 0.3, midiOffset: 0.2 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'bandpass', Q: 3.4, cutoff: 1250 },
    frequencyAutomation: (time, frequency, { duration }) => [
      { type: 'set', value: frequency, time },
      { type: 'linearRamp', value: frequency * 1.19, time: time + duration * 0.42 },
      { type: 'linearRamp', value: frequency, time: time + duration },
    ],
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0.0005, time },
      { type: 'linearRamp', value: 0.15, time: time + 0.05 },
      { type: 'set', value: 0.15, time: time + duration - 0.12 },
      { type: 'linearRamp', value: 0.0005, time: time + duration },
    ],
  });

  const subImpactTone = voice<{ gain: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 1.1,
    stopPadding: 0.08,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: 28, time: time + 0.75 },
    ],
    gainAutomation: (time, _gain, { gain }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.1 },
    ],
  });

  const sparkleTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 0.7 }, { type: 'sine', gain: 0.2, octave: 1 }],
    duration: 0.5,
    stopPadding: 0.06,
    envelope: { decay: 0.5 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.08 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 165, vel, destination: output });
      noiseHit(time, 0.08 * vel, 0.005, 'highpass', 2400, output);
      // The kick's duck is the pump.
      mix.duckAt(time, 0.52, 0.22);
    },

    clap(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.14 * vel, 0.045, 'bandpass', 1750, output);
      noiseHit(time + 0.011, 0.1 * vel, 0.075, 'bandpass', 2150, output);
      noiseHit(time + 0.026, 0.05 * vel, 0.11, 'highpass', 3200, output);
    },

    hat(_context, time, vel, decay) {
      const output = duckDestination();
      if (!output) return;
      noiseHit(time, vel, decay, 'highpass', 8600, output);
    },

    bass(context, time, midi, vel, length) {
      const output = duckDestination();
      if (!output) return;
      bassTone.play({ context, time, midi, vel, length, destination: output });
    },

    pad(context, time, midis, duration, level) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const destinations: AudioNode[] = mix.reverbSend ? [mix.duck, mix.reverbSend] : [mix.duck];
      for (const midi of midis) {
        for (const detune of [-8, 8]) {
          padTone.play({ context, time, midi, detune, duration, level, destination: destinations });
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      arpTone.play({
        context,
        time,
        midi,
        vel,
        destination: mix.duck,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.45 }] : undefined,
      });
    },

    acid(context, time, midi, vel, accent) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      acidTone.play({
        context,
        time,
        midi,
        vel,
        accent,
        destination: mix.duck,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.34 }] : undefined,
      });
    },

    klaxon(context, time, midi, duration) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!output) return;
      klaxonTone.play({
        context,
        time,
        midi,
        duration,
        destination: output,
        sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : undefined,
      });
    },

    alarm(context, time, duration, midi) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output) return;
      // A rising alarm sweep: one saw climbing an octave through a bandpass.
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.06,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi + 12), time: time + duration }],
        filter: {
          type: 'bandpass',
          Q: 5,
          frequencyAutomation: [
            { type: 'set', value: 700, time },
            { type: 'exponentialRamp', value: 3800, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.0005, time },
          { type: 'exponentialRamp', value: 0.075, time: time + duration * 0.85 },
          { type: 'linearRamp', value: 0.0005, time: time + duration },
        ],
        destination: output,
        sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.3 }] : undefined,
      });
    },

    riser(context, time, duration, peak) {
      const output = musicDestination();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.12,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.3,
          frequencyAutomation: [
            { type: 'set', value: 320, time },
            { type: 'exponentialRamp', value: 7200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: peak, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    snare(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.13 * vel, 0.07, 'highpass', 2100, output);
      noiseHit(time, 0.07 * vel, 0.035, 'bandpass', 900, output);
    },

    impact(context, time, gain, frequency) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output) return;
      subImpactTone.play({ context, time, frequency, gain, destination: output });
      noiseHit(time, 0.22 * gain, 0.4, 'lowpass', 620, output);
      if (mix?.reverbSend) noiseHit(time, 0.12 * gain, 0.3, 'bandpass', 1800, mix.reverbSend);
    },

    crash(_context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.16 * vel, 1.5, 'highpass', 5200, output);
      if (mix?.reverbSend) noiseHit(time, 0.12 * vel, 1.2, 'highpass', 4200, mix.reverbSend);
    },

    sparkle(context, time, midi, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!output) return;
      sparkleTone.play({
        context,
        time,
        midi,
        vel,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.6 }] : undefined,
      });
    },

    rumble(context, time, duration) {
      const output = musicDestination();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      // Containment failure: a long low sub rumble under filtered noise.
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration,
        oscillatorType: 'sine',
        frequency: 46,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 22, time: time + duration }],
        gainAutomation: [
          { type: 'set', value: 0.42, time },
          { type: 'linearRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration,
        loop: true,
        filter: {
          type: 'lowpass',
          Q: 1.2,
          frequencyAutomation: [
            { type: 'set', value: 1600, time },
            { type: 'exponentialRamp', value: 120, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.3, time },
          { type: 'linearRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
    },

    hum(_context, time, midi, level, cutoff, glide) {
      hum?.set(time, midi, level, cutoff, glide);
    },

    humCut(_context, time) {
      hum?.cut(time);
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    bass: ['midi', 'vel', 'length'],
    pad: ['midis', 'duration', 'level'],
    arp: ['midi', 'vel'],
    acid: ['midi', 'vel', 'accent'],
    klaxon: ['midi', 'duration'],
    alarm: ['duration', 'midi'],
    riser: ['duration', 'peak'],
    snare: ['vel'],
    impact: ['gain', 'frequency'],
    crash: ['vel'],
    sparkle: ['midi', 'vel'],
    rumble: ['duration'],
    hum: ['midi', 'level', 'cutoff', 'glide'],
    humCut: [],
  });

  return { ...instruments, noiseHit, attachHum, detachHum };
}
