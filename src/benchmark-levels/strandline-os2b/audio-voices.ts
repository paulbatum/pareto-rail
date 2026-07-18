import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// Strandline's band is the animal. There is no kit: the downbeat is the bell
// contracting (a soft sub thump plus the water it displaces), the hats are
// particulate matter ticking past the ear, the bass is the animal's body tone,
// and the melodic layer is bioluminescence — struck glass with a long tail.
// Nothing here has an attack transient harder than a wooden mallet.

export type StrandlineKillVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  shimmer: number;
  octave: number;
};

export type StrandlineVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createStrandlineVoices(environment: StrandlineVoiceEnvironment) {
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

  // The contraction. A round sub thump with almost no click, tuned low enough
  // to be felt as displacement rather than heard as a drum.
  const pulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.42,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [
      { type: 'exponentialRamp', value: 46, time: time + 0.07 },
      { type: 'exponentialRamp', value: 31, time: time + 0.36 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.52 * vel, time: time + 0.018 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  // The body tone underneath everything: a slow, wide, breathing drone.
  const subTone = voice<{ duration: number; vel: number }>({
    oscillators: [{ type: 'sine' }, { type: 'sine', midiOffset: 0.12, gain: 0.6 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.2 * vel, time: time + duration * 0.35 },
      { type: 'linearRamp', value: 0.13 * vel, time: time + duration * 0.8 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }, { type: 'sine', octave: -1, gain: 0.5 }],
    duration: 0.7,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      Q: 3,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 260 + vel * 520, time },
        { type: 'exponentialRamp', value: 150, time: time + 0.6 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.26 * vel, time: time + 0.05 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  // Bioluminescence: struck glass. The whole level's melodic identity.
  const bellTone = voice<{ vel: number; decay: number }>({
    oscillators: [
      { type: 'triangle' },
      { type: 'sine', octave: 1, gain: 0.28 },
      { type: 'sine', frequencyRatio: 2.76, gain: 0.09 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: ({ vel }) => 1800 + vel * 2600 },
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.19 * vel, time: time + 0.006 },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  // Wide, slow, unhurried water light.
  const padTone = voice<{ duration: number; vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      Q: 1.2,
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 380, time },
        { type: 'linearRamp', value: 1150, time: time + duration * 0.55 },
        { type: 'linearRamp', value: 460, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.036 * vel, time: time + duration * 0.4 },
      { type: 'set', value: 0.036 * vel, time: time + duration * 0.72 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // The reveal: a bowed swell that opens like the water opening.
  const swellTone = voice<{ duration: number; vel: number }>({
    oscillators: [
      { type: 'sawtooth', detune: -8 },
      { type: 'sawtooth', detune: 9, gain: 0.9 },
      { type: 'sine', octave: 1, gain: 0.25 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.1,
    filter: {
      type: 'lowpass',
      Q: 2.4,
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 300, time },
        { type: 'exponentialRamp', value: 2400, time: time + duration * 0.62 },
        { type: 'exponentialRamp', value: 700, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.09 * vel, time: time + duration * 0.5 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  // The infestation's own sound: a detuned low growl under the crown section.
  const groanTone = voice<{ duration: number; vel: number }>({
    oscillators: [
      { type: 'sawtooth', detune: -22 },
      { type: 'sawtooth', detune: 24, gain: 0.85 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 180, time },
        { type: 'linearRamp', value: 520, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 170, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.075 * vel, time: time + duration * 0.3 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  // Sunlight on the surface: a high ping that only ever appears in clear water.
  const causticTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }, { type: 'sine', frequencyRatio: 1.503, gain: 0.35 }],
    duration: 0.9,
    stopPadding: 0.06,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.055 * vel, time: time + 0.01 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    pulse(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      pulseTone.play({ context, time, frequency: 118, vel, destination: output });
      // The water the bell moves.
      noiseHit(time, 0.075 * vel, 0.19, 'lowpass', 420, output);
      noiseHit(time + 0.03, 0.03 * vel, 0.3, 'bandpass', 900, output);
      mix.duckAt(time, 0.62, 0.3);
    },

    sub(context, time, midi, duration, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subTone.play({ context, time, midi, duration, vel, destination: duck });
    },

    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    bell(context, time, midi, vel, decay) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      bellTone.play({
        context,
        time,
        midi,
        vel,
        decay,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.55 }, ...(mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : [])],
      });
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        for (const detune of [-9, 8]) {
          padTone.play({
            context,
            time,
            midi,
            detune,
            duration,
            vel,
            destination: mix.duck,
            sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.55 }] : undefined,
          });
        }
      }
    },

    swell(context, time, midis, duration, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      for (const midi of midis) {
        swellTone.play({
          context,
          time,
          midi,
          duration,
          vel,
          destination: output,
          sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.7 }] : undefined,
        });
      }
    },

    groan(context, time, midi, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      groanTone.play({ context, time, midi, duration, vel, destination: output });
    },

    caustic(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      causticTone.play({
        context,
        time,
        midi,
        vel,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.7 }],
      });
    },

    /** Particulate matter drifting past the ear — the level's only "hat". */
    tick(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.018, 'bandpass', 5200 + Math.random() * 2600, duck);
    },

    riser(context, time, duration) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.12,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.5,
          frequencyAutomation: [
            { type: 'set', value: 240, time },
            { type: 'exponentialRamp', value: 4800, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.1, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },
  }, {
    pulse: ['vel'],
    sub: ['midi', 'duration', 'vel'],
    bass: ['midi', 'vel'],
    bell: ['midi', 'vel', 'decay'],
    pad: ['midis', 'duration', 'vel'],
    swell: ['midis', 'duration', 'vel'],
    groan: ['midi', 'duration', 'vel'],
    caustic: ['midi', 'vel'],
    tick: ['vel'],
    riser: ['duration'],
  });

  return { ...instruments, noiseHit };
}
