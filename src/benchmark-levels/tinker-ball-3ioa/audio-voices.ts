import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Instrument construction for Tinker Ball. Everything here takes parameters and
// decides nothing: the arrangement, harmony, and event choreography live in
// audio.ts. The palette is bright eccentric pop: bell-like mallets, clipped
// reed-organ stabs, a bouncy synth bass, handclaps, and tiny workshop
// percussion (woodblock ticks, pen clicks, pin tinks, a shaker).

export type TinkerToneVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  /** 0–1: how much of the bell's upper partial rings. */
  partial: number;
  reverb: number;
};

export type TinkerVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createTinkerVoices(environment: TinkerVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const duckDestination = () => environment.mix()?.duck ?? environment.mix()?.master ?? null;
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

  // ---- voice specs ----------------------------------------------------------

  // Bell mallet: sine fundamental, a fast-decaying upper partial, and a tiny
  // wooden transient. The partial ratio sits just off an octave-plus-fifth so
  // the bell shimmers instead of reading as a pure organ tone.
  const malletBody = voice<{ vel: number; decay: number }>({
    oscillators: [{ type: 'sine' }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.2 * vel, time: time + 0.004 },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });
  const malletPartial = voice<{ vel: number; decay: number }>({
    oscillators: [{ type: 'sine', frequencyRatio: 3.01 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.07 * vel, time: time + 0.003 },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.35 },
    ],
  });

  // Reed organ: two saws a hair apart through a nasal band, then a lowpass.
  const organTone = voice<{ vel: number; duration: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', detune: -5, gain: 0.55 },
      { type: 'square', detune: 5, gain: 0.45 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 1.4 },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.05 * vel, time: time + 0.008 },
      { type: 'set', value: 0.05 * vel, time: time + Math.max(0.01, duration - 0.03) },
      { type: 'linearRamp', value: 0.0005, time: time + duration },
    ],
  });

  const padTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', detune: -8, gain: 0.5 },
      { type: 'sawtooth', detune: 8, gain: 0.5 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: 1100, Q: 0.7 },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.022 * vel, time: time + Math.min(0.5, duration * 0.3) },
      { type: 'set', value: 0.022 * vel, time: time + duration - Math.min(0.5, duration * 0.3) },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const bassSquare = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.26,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 4,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 500 + vel * 1300, time },
        { type: 'exponentialRamp', value: 190, time: time + 0.2 },
      ],
    },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.08, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.045 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.11 * vel, time: time + 0.006 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });
  const bassSub = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.24,
    stopPadding: 0.03,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.22 * vel, time: time + 0.008 },
      { type: 'set', value: 0.22 * vel, time: time + 0.15 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.16,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 46, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const tickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.055,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 960, time: time + 0.02 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.17 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.055 },
    ],
  });

  const tinkTone = voice<{ vel: number; decay: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', frequencyRatio: 2.42, gain: 0.3 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: 0.06 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  // Spring boing: a triangle whose pitch overshoots and settles.
  const boingTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.38,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 2600 },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 0.78, time },
      { type: 'exponentialRamp', value: frequency * 1.18, time: time + 0.05 },
      { type: 'exponentialRamp', value: frequency * 0.96, time: time + 0.13 },
      { type: 'exponentialRamp', value: frequency * 1.02, time: time + 0.22 },
      { type: 'exponentialRamp', value: frequency, time: time + 0.3 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.14 * vel, time: time + 0.006 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.38 },
    ],
  });

  const thumpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.7,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 32, time: time + 0.45 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const squelchDrop = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.18,
    stopPadding: 0.03,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.26, time: time + 0.14 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.13 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });

  const playerToneSpec = voice<{ voice: TinkerToneVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    gainAutomation: (time, gain, { voice }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: gain, time: time + 0.004 },
      { type: 'exponentialRamp', value: 0.001, time: time + voice.decay },
    ],
  });
  const playerPartialSpec = voice<{ voice: TinkerToneVoice }>({
    oscillators: [{ type: 'sine', frequencyRatio: 3.01, gain: ({ voice }) => voice.gain * 0.32 * voice.partial }],
    duration: ({ voice }) => voice.decay * 0.4,
    stopPadding: 0.03,
    gainAutomation: (time, gain, { voice }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: gain, time: time + 0.003 },
      { type: 'exponentialRamp', value: 0.001, time: time + voice.decay * 0.4 },
    ],
  });

  // ---- instruments ---------------------------------------------------------

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    mallet(context, time, midi, vel, bright) {
      const mix = environment.mix();
      const output = duckDestination();
      if (!mix || !output) return;
      const decay = 0.42 + bright * 0.2;
      const sends = mix.delaySend ? [{ destination: mix.delaySend, gain: 0.32 }] : [];
      malletBody.play({ context, time, midi, vel, decay, destination: output, sends });
      malletPartial.play({ context, time, midi, vel: vel * (0.5 + bright * 0.8), decay, destination: output, sends });
      noiseHit(time, 0.035 * vel, 0.006, 'highpass', 3800, output);
    },

    organ(context, time, midis, vel, duration, cutoff) {
      const mix = environment.mix();
      const output = duckDestination();
      if (!mix || !output) return;
      const sends = mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.22 }] : [];
      for (const midi of midis) organTone.play({ context, time, midi, vel: vel / Math.sqrt(midis.length / 3), duration, cutoff, destination: output, sends });
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      const output = duckDestination();
      if (!mix || !output) return;
      const sends = mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.5 }] : [];
      for (const midi of midis) padTone.play({ context, time, midi, vel: vel / Math.sqrt(midis.length / 4), duration, destination: output, sends });
    },

    bass(context, time, midi, vel) {
      const output = duckDestination();
      if (!output) return;
      bassSquare.play({ context, time, midi: midi + 12, vel, destination: output });
      bassSub.play({ context, time, midi, vel, destination: output });
    },

    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 128, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.004, 'highpass', 1400, output);
      mix.duckAt(time, 0.55, 0.17);
    },

    clap(_context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      noiseHit(time, 0.14 * vel, 0.028, 'bandpass', 1700, output);
      noiseHit(time + 0.011, 0.1 * vel, 0.028, 'bandpass', 2100, output);
      noiseHit(time + 0.023, 0.17 * vel, 0.1, 'bandpass', 1500, output);
      if (mix.reverbSend) noiseHit(time + 0.023, 0.06 * vel, 0.12, 'bandpass', 1800, mix.reverbSend);
    },

    tick(context, time, vel) {
      const output = duckDestination();
      if (!output) return;
      tickTone.play({ context, time, frequency: 1750, vel, destination: output });
      noiseHit(time, 0.03 * vel, 0.005, 'highpass', 5000, output);
    },

    click(_context, time, vel) {
      const output = duckDestination();
      if (!output) return;
      noiseHit(time, 0.13 * vel, 0.01, 'highpass', 5600, output);
      noiseHit(time + 0.014, 0.05 * vel, 0.008, 'highpass', 7000, output);
    },

    tink(context, time, midi, vel, decay) {
      const mix = environment.mix();
      const output = duckDestination();
      if (!mix || !output) return;
      const sends = mix.delaySend ? [{ destination: mix.delaySend, gain: 0.25 }] : [];
      tinkTone.play({ context, time, midi, vel, decay, destination: output, sends });
    },

    shaker(_context, time, vel) {
      const output = duckDestination();
      if (!output) return;
      noiseHit(time, 0.05 * vel, 0.045, 'highpass', 8600, output);
    },

    boing(context, time, midi, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      const sends = mix.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : [];
      boingTone.play({ context, time, midi, vel, destination: output, sends });
    },

    thump(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      thumpTone.play({ context, time, frequency: 92, vel, destination: output });
      noiseHit(time, 0.2 * vel, 0.3, 'lowpass', 320, output);
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
          frequency: 320,
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

    // Glue: a wet lowpassed burst with a sagging pitch. Intensity opens the
    // filter, so repeated boss hits get audibly wetter and louder.
    squelch(context, time, intensity, vel) {
      const output = sfxDestination();
      if (!output) return;
      noiseHit(time, 0.16 * vel, 0.11, 'lowpass', 700 + intensity * 1400, output);
      noiseHit(time + 0.02, 0.08 * vel, 0.16, 'bandpass', 380, output);
      squelchDrop.play({ context, time, frequency: 380 + intensity * 260, vel, destination: output });
    },

    crack(context, time, vel) {
      const output = sfxDestination();
      if (!output) return;
      noiseHit(time, 0.22 * vel, 0.055, 'bandpass', 3200, output);
      noiseHit(time + 0.008, 0.1 * vel, 0.03, 'highpass', 7200, output);
      tickTone.play({ context, time, frequency: 2400, vel: 0.8 * vel, destination: output });
    },

    // The last glue snapping: bone-dry, then the sub drops out from under it.
    snap(context, time) {
      const output = sfxDestination();
      if (!output) return;
      noiseHit(time, 0.3, 0.03, 'highpass', 3000, output);
      noiseHit(time + 0.006, 0.18, 0.012, 'highpass', 6500, output);
      tickTone.play({ context, time, frequency: 2600, vel: 1.2, destination: output });
      thumpTone.play({ context, time: time + 0.03, frequency: 110, vel: 0.9, destination: output });
    },

    // Spill ambience: a slow gurgle of lowpassed noise breathing under the beat.
    gurgle(context, time, duration) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      const steps: Array<{ type: 'linearRamp'; value: number; time: number }> = [];
      const period = 0.31;
      for (let t = 0; t < duration; t += period) {
        steps.push({ type: 'linearRamp', value: 0.05, time: time + t + period * 0.5 });
        steps.push({ type: 'linearRamp', value: 0.012, time: time + t + period });
      }
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: { type: 'lowpass', frequency: 260, Q: 3 },
        gainAutomation: [{ type: 'set', value: 0.001, time }, ...steps, { type: 'linearRamp', value: 0, time: time + duration + 0.05 }],
        destination: output,
      });
    },
  }, {
    mallet: ['midi', 'vel', 'bright'],
    organ: ['midis', 'vel', 'duration', 'cutoff'],
    pad: ['midis', 'duration', 'vel'],
    bass: ['midi', 'vel'],
    kick: ['vel'],
    clap: ['vel'],
    tick: ['vel'],
    click: ['vel'],
    tink: ['midi', 'vel', 'decay'],
    shaker: ['vel'],
    boing: ['midi', 'vel'],
    thump: ['vel'],
    riser: ['duration', 'level'],
    squelch: ['intensity', 'vel'],
    crack: ['vel'],
    snap: [],
    gurgle: ['duration'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  /** The player's pitched instrument: a mallet in the act's timbre, on the sfx bus. */
  function playerTone(time: number, midi: number, voice: TinkerToneVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice, velocity: vel, weight, destination: output, sends: playerSends(0.34, voice.reverb) });
    if (voice.partial > 0.02) playerPartialSpec.play({ context, time, midi, voice, velocity: vel, weight, destination: output });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number, filterType: BiquadFilterType = 'highpass') {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, filterType, frequency, output);
  }

  /** A pitched chirp on the sfx bus: the pin shot. */
  function playerChirp(time: number, fromMidi: number, toMidi: number, vel: number, cutoff: number) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.09,
      oscillatorType: 'triangle',
      frequency: midiToFreq(fromMidi),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(toMidi), time: time + 0.06 }],
      filter: { type: 'lowpass', frequency: cutoff },
      gainAutomation: [
        { type: 'set', value: 0.09 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
      ],
      destination: output,
    });
  }

  /** Dissonant rubber squeak for rejected releases: a bent saw through a narrow band. */
  function playerSqueak(time: number, vel: number) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    for (const [start, end, at, gain] of [[420, 170, time, 0.16], [297, 120, time + 0.03, 0.11]] as const) {
      playOscillatorVoice({
        context,
        time: at,
        stopTime: at + 0.26,
        oscillatorType: 'sawtooth',
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.2 }],
        filter: {
          type: 'bandpass',
          Q: 6,
          frequencyAutomation: [
            { type: 'set', value: 1300, time: at },
            { type: 'exponentialRamp', value: 420, time: at + 0.2 },
          ],
        },
        gainAutomation: [
          { type: 'set', value: gain * vel, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.25 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.12 * vel, 0.08, 'bandpass', 640, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise, playerChirp, playerSqueak };
}
