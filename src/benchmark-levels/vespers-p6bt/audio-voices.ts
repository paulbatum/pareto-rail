import {
  defineInstruments,
  playNoiseHit,
  playOscillatorVoice,
  type AutomationStep,
  type MixBus,
} from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// The instrument is one organ. Every pitched sound in Vespers — backing voices,
// choir, bells and every note the player plays — is a stop on it, which is why
// they are all built the same way: a fundamental with a stack of ranks tuned to
// exact harmonics above it.
//
// Organ pipes do not decay while the key is down, so these envelopes are flat:
// a fast chiff on the attack, a level sustain, a short release. Rank gains are
// tuned by ear, not by matching numbers — a sawtooth rank at the same gain as a
// sine is several times louder.

type Rank = { ratio: number; type: OscillatorType; gain: number; detune?: number };

/** 16' and 8' with a soft octave: the weight the whole level sits on. */
const PEDAL: Rank[] = [
  { ratio: 0.5, type: 'sine', gain: 0.62 },
  { ratio: 1, type: 'sine', gain: 0.44 },
  { ratio: 2, type: 'triangle', gain: 0.15 },
  { ratio: 3, type: 'sine', gain: 0.05 },
];

/** Diapason: the plain speaking voice of the instrument. */
const PRINCIPAL: Rank[] = [
  { ratio: 1, type: 'triangle', gain: 0.5 },
  { ratio: 2, type: 'triangle', gain: 0.2 },
  { ratio: 3, type: 'sine', gain: 0.12 },
  { ratio: 4, type: 'sine', gain: 0.05 },
];

/** Stopped flute: hollow, almost pure, for the quietest voices. */
const FLUTE: Rank[] = [
  { ratio: 1, type: 'sine', gain: 0.78 },
  { ratio: 2, type: 'sine', gain: 0.17 },
  { ratio: 3, type: 'sine', gain: 0.04 },
];

/** Mixture: the bright upperwork that makes an organ ring. */
const MIXTURE: Rank[] = [
  { ratio: 1, type: 'sawtooth', gain: 0.2 },
  { ratio: 2, type: 'triangle', gain: 0.18 },
  { ratio: 3, type: 'sine', gain: 0.14 },
  { ratio: 4, type: 'sine', gain: 0.11 },
  { ratio: 6, type: 'sine', gain: 0.07 },
  { ratio: 8, type: 'sine', gain: 0.05 },
];

/** The reed that has been off all night. Kept for the last thirty seconds. */
const REED: Rank[] = [
  { ratio: 1, type: 'sawtooth', gain: 0.26 },
  { ratio: 2, type: 'sawtooth', gain: 0.15, detune: 7 },
  { ratio: 3, type: 'square', gain: 0.08 },
  { ratio: 4, type: 'sawtooth', gain: 0.06, detune: -9 },
  { ratio: 6, type: 'sine', gain: 0.04 },
];

/** Vox humana: two slightly-out-of-tune ranks, which is what makes it a choir. */
const CHOIR: Rank[] = [
  { ratio: 1, type: 'triangle', gain: 0.36, detune: -8 },
  { ratio: 1, type: 'triangle', gain: 0.36, detune: 9 },
  { ratio: 2, type: 'sine', gain: 0.16 },
  { ratio: 3, type: 'sine', gain: 0.05 },
];

export const STOPS = { pedal: PEDAL, principal: PRINCIPAL, flute: FLUTE, mixture: MIXTURE, reed: REED, choir: CHOIR };
export type StopName = keyof typeof STOPS;

/** Inharmonic partials: a struck bell, not a pipe. */
const BELL_PARTIALS = [
  { ratio: 0.5, gain: 0.4, decay: 3.6 },
  { ratio: 1, gain: 0.5, decay: 2.8 },
  { ratio: 2.02, gain: 0.24, decay: 1.9 },
  { ratio: 2.76, gain: 0.2, decay: 1.4 },
  { ratio: 5.42, gain: 0.09, decay: 0.8 },
  { ratio: 8.9, gain: 0.05, decay: 0.4 },
];

export type VespersVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createVespersVoices(environment: VespersVoiceEnvironment) {
  const music = () => environment.mix()?.duck ?? environment.mix()?.master ?? null;
  const solo = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const church = () => environment.mix()?.reverbSend ?? null;

  /** Wet send for anything that should sound like it is happening in the room. */
  const sends = (amount: number) => {
    const reverb = church();
    return reverb ? [{ destination: reverb, gain: amount }] : undefined;
  };

  function speak(
    context: AudioContext,
    time: number,
    ranks: Rank[],
    midi: number,
    duration: number,
    gain: number,
    destination: AudioNode,
    wet: number,
    brightness?: number,
  ) {
    const frequency = midiToFreq(midi);
    if (!Number.isFinite(frequency) || frequency < 12 || frequency > 12000) return;
    for (const rank of ranks) {
      const partial = frequency * rank.ratio;
      // Above the top of the instrument's compass a rank simply is not there.
      if (partial > 11000) continue;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.35,
        oscillatorType: rank.type,
        frequency: partial,
        detune: rank.detune,
        gainAutomation: pipeEnvelope(time, gain * rank.gain, duration),
        filter: brightness === undefined ? undefined : { type: 'lowpass', frequency: brightness, Q: 0.6 },
        destination,
        sends: sends(wet),
      });
    }
  }

  return defineInstruments(environment, {
    /** The note the level opens on and never really leaves. */
    pedal(context: AudioContext, time: number, midi: number, duration: number, gain: number) {
      const destination = music();
      if (destination) speak(context, time, PEDAL, midi, duration, gain, destination, 0.5);
    },

    /** A manual voice: which stop is drawn is the arrangement's decision. */
    manual(context: AudioContext, time: number, stop: StopName, midi: number, duration: number, gain: number) {
      const destination = music();
      if (destination) speak(context, time, STOPS[stop], midi, duration, gain, destination, 0.42);
    },

    /** Choir weight under a swell: whole chords, slow in, slow out. */
    choir(context: AudioContext, time: number, midis: number[], duration: number, gain: number) {
      const destination = music();
      if (!destination) return;
      for (const midi of midis) {
        const frequency = midiToFreq(midi);
        for (const rank of CHOIR) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + duration + 0.6,
            oscillatorType: rank.type,
            frequency: frequency * rank.ratio,
            detune: rank.detune,
            gainAutomation: [
              { type: 'set', value: 0.0001, time },
              { type: 'linearRamp', value: gain * rank.gain, time: time + duration * 0.34 },
              { type: 'set', value: gain * rank.gain, time: time + duration * 0.74 },
              { type: 'exponentialRamp', value: 0.0001, time: time + duration },
            ],
            filter: { type: 'lowpass', frequency: 2200, Q: 0.5 },
            destination,
            sends: sends(0.7),
          });
        }
      }
    },

    /** Tower bell. Inharmonic, long, and the only thing here that decays. */
    bell(context: AudioContext, time: number, midi: number, gain: number) {
      const destination = music();
      if (!destination) return;
      const frequency = midiToFreq(midi);
      for (const partial of BELL_PARTIALS) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + partial.decay + 0.2,
          oscillatorType: 'sine',
          frequency: frequency * partial.ratio,
          gainAutomation: [
            { type: 'set', value: gain * partial.gain, time },
            { type: 'exponentialRamp', value: 0.0001, time: time + partial.decay },
          ],
          destination,
          sends: sends(0.65),
        });
      }
    },

    /** A note the player played. Same instrument, its own bench. */
    stop(
      context: AudioContext,
      time: number,
      stop: StopName,
      midi: number,
      duration: number,
      gain: number,
      brightness: number,
    ) {
      const destination = solo();
      if (destination) speak(context, time, STOPS[stop], midi, duration, gain, destination, 0.55, brightness);
    },

    /** Wind in the case: the swell shoe opening, and the breath before a note. */
    wind(context: AudioContext, time: number, gain: number, decay: number, frequency: number) {
      const destination = solo();
      const buffer = environment.mix()?.noiseBuffer;
      if (!destination || !buffer) return;
      playNoiseHit({
        context,
        buffer,
        time,
        velocity: gain,
        decay,
        filterType: 'bandpass',
        frequency,
        destination,
        offset: 0.1,
      });
    },

    /**
     * A cipher: a pipe stuck on with the wind failing under it. This is the
     * one sound in the level that is out of tune on purpose.
     */
    cipher(context: AudioContext, time: number, gain: number) {
      const destination = solo();
      const buffer = environment.mix()?.noiseBuffer;
      if (!destination) return;
      for (const [midi, detune] of [[62, 0], [61.5, 24], [55.5, -18]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 0.5,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 1500, time },
              { type: 'exponentialRamp', value: 220, time: time + 0.32 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: gain, time },
            { type: 'set', value: gain * 0.8, time: time + 0.16 },
            { type: 'exponentialRamp', value: 0.0001, time: time + 0.42 },
          ],
          destination,
        });
      }
      if (buffer) {
        playNoiseHit({
          context,
          buffer,
          time,
          velocity: gain * 1.1,
          decay: 0.3,
          filterType: 'bandpass',
          frequency: 420,
          destination,
          offset: 0.4,
        });
      }
    },

    /** Something struck the case: the hull taking a hit. */
    knock(context: AudioContext, time: number, gain: number) {
      const destination = solo();
      const buffer = environment.mix()?.noiseBuffer;
      if (!destination) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.7,
        oscillatorType: 'sine',
        frequency: 88,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 31, time: time + 0.4 }],
        gainAutomation: [
          { type: 'set', value: gain, time },
          { type: 'exponentialRamp', value: 0.0001, time: time + 0.65 },
        ],
        destination,
      });
      for (const midi of [61, 67]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 0.3,
          oscillatorType: 'square',
          frequency: midiToFreq(midi),
          gainAutomation: [
            { type: 'set', value: gain * 0.14, time },
            { type: 'exponentialRamp', value: 0.0001, time: time + 0.28 },
          ],
          destination,
        });
      }
      if (buffer) {
        playNoiseHit({ context, buffer, time, velocity: gain * 0.5, decay: 0.22, filterType: 'bandpass', frequency: 700, destination });
      }
    },
  });
}

export type VespersVoices = ReturnType<typeof createVespersVoices>;

/**
 * Flat-topped pipe envelope: a fast chiff, a level sustain for as long as the
 * key is down, then a short release. No decay — that is what separates an
 * organ from everything else in this benchmark.
 */
function pipeEnvelope(time: number, peak: number, duration: number): AutomationStep[] {
  const hold = Math.max(0.08, duration);
  return [
    { type: 'set', value: 0.0001, time },
    { type: 'exponentialRamp', value: peak * 1.22, time: time + 0.014 },
    { type: 'exponentialRamp', value: peak, time: time + 0.07 },
    { type: 'set', value: peak, time: time + hold * 0.92 },
    { type: 'exponentialRamp', value: 0.0001, time: time + hold + 0.08 },
  ];
}
