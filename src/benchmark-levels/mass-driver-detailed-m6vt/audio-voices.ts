import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf: synth construction only. All timing, harmony, and arrangement
// decisions live in audio.ts.

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;

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
      loopStart: Math.random(),
      offset: Math.random() * 1.5,
    });
  }

  // Four-on-the-floor induction kick: sine drop plus a dry click.
  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.16,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 44, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.52 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // Driving eighth-note root bass: saw through a closing lowpass.
  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 220 + vel * 700, time },
        { type: 'exponentialRamp', value: 150, time: time + 0.17 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.3 * vel, time: time + 0.005 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  // 303 acid line: resonant saw with a snapping filter envelope. Accent opens
  // the filter harder.
  const acidTone = voice<{ vel: number; accent: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 11,
      frequencyAutomation: (time, { accent }) => [
        { type: 'set', value: 320 + accent * 2400, time },
        { type: 'exponentialRamp', value: 200, time: time + 0.13 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.085 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const padTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 360, time },
        { type: 'linearRamp', value: 680, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 360, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.038, time: time + 0.5 },
      { type: 'set', value: 0.038, time: time + duration - 0.4 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 2800 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.15 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  // Two-tone klaxon: the interlock alarm. Hard square fifths, gated.
  const klaxonTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'square', gain: 0.55 },
      { type: 'square', frequencyRatio: 1.5, gain: 0.3 },
    ],
    duration: 0.34,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 2.2, cutoff: 1150 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.11 * vel, time },
      { type: 'set', value: 0.11 * vel, time: time + 0.26 },
      { type: 'linearRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 145, vel, destination: output });
      noiseHit(time, 0.09 * vel, 0.004, 'highpass', 1400, output);
      // The kick's duck IS the pump.
      mix.duckAt(time, 0.4, 0.24);
    },

    clap(_context, time) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.15, 0.05, 'bandpass', 1800, output);
      noiseHit(time + 0.012, 0.09, 0.07, 'bandpass', 2100, output);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 7600, duck);
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    acid(context, time, midi, vel, accent) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      acidTone.play({
        context,
        time,
        midi,
        vel,
        accent,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.28 }],
      });
    },

    pad(context, time, midis, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          padTone.play({ context, time, midi, detune, duration, destination: [mix.duck, mix.reverbSend] });
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.45 }] });
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
          frequencyAutomation: [
            { type: 'set', value: 340, time },
            { type: 'exponentialRamp', value: 6800, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    klaxon(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.music || !mix.reverbSend) return;
      klaxonTone.play({ context, time, midi, vel, destination: [mix.music, mix.reverbSend] });
    },

    // Rising alarm sweep: a resonant band climbing over half a bar.
    alarm(context, time, fromHz, toHz) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + 0.95,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 9,
          frequencyAutomation: [
            { type: 'set', value: fromHz, time },
            { type: 'exponentialRamp', value: toHz, time: time + 0.85 },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'linearRamp', value: 0.075, time: time + 0.2 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.95 },
        ],
        destination: output,
      });
    },

    snare(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, vel, 0.08, 'bandpass', 2400, output);
      noiseHit(time, vel * 0.5, 0.04, 'highpass', 5200, output);
    },

    // Ship-scale low impact: the klaxon's body blow and the shot's floor.
    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 1.1,
        oscillatorType: 'sine',
        frequency: 130,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 30, time: time + 0.5 }],
        gainAutomation: [
          { type: 'set', value: 0.55 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 1 },
        ],
        destination: output,
      });
      noiseHit(time, 0.22 * vel, 0.25, 'lowpass', 900, output);
    },

    crash(_context, time, vel) {
      const mix = environment.mix();
      if (!mix?.music || !mix.reverbSend) return;
      noiseHit(time, 0.3 * vel, 1.1, 'highpass', 4200, mix.music);
      noiseHit(time, 0.2 * vel, 1.6, 'highpass', 3000, mix.reverbSend);
    },

    // Clamp-release clank: a struck metal pair that drops in pitch per
    // interlock — cold iron under the climbing confirmation.
    clank(context, time, baseHz, vel) {
      const mix = environment.mix();
      if (!mix?.sfx || !mix.reverbSend) return;
      for (const [ratio, gain, decay] of [
        [1, 0.3, 0.22],
        [2.76, 0.14, 0.12],
        [5.4, 0.07, 0.07],
      ] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + decay + 0.05,
          oscillatorType: 'triangle',
          frequency: baseHz * ratio,
          frequencyAutomation: [{ type: 'exponentialRamp', value: baseHz * ratio * 0.82, time: time + decay }],
          gainAutomation: [
            { type: 'set', value: gain * vel, time },
            { type: 'exponentialRamp', value: 0.001, time: time + decay },
          ],
          destination: [mix.sfx, mix.reverbSend],
        });
      }
      noiseHit(time, 0.14 * vel, 0.05, 'bandpass', 2600, mix.sfx);
    },

    // Glassy sparkle for the muzzle bars, mostly delay and hall.
    sparkle(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.music || !mix.delaySend || !mix.reverbSend) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.7,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.06 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
        ],
        destination: mix.music,
        sends: [
          { destination: mix.delaySend, gain: 0.8 },
          { destination: mix.reverbSend, gain: 0.6 },
        ],
      });
    },
  }, {
    kick: ['vel'],
    clap: [],
    hat: ['vel', 'decay'],
    bass: ['midi', 'vel'],
    acid: ['midi', 'vel', 'accent'],
    pad: ['midis', 'duration'],
    arp: ['midi', 'vel'],
    riser: ['duration', 'level'],
    klaxon: ['midi', 'vel'],
    alarm: ['fromHz', 'toHz'],
    snare: ['vel'],
    impact: ['vel'],
    crash: ['vel'],
    clank: ['baseHz', 'vel'],
    sparkle: ['midi', 'vel'],
  });

  return {
    ...instruments,
    noiseHit,
  };
}
