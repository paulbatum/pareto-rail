import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// A synthetic orchestra, built for one job: space opera. Nothing here is a
// general-purpose synth patch — each voice is shaped after the instrument it
// stands in for, because the whole musical identity of the level rests on the
// difference between a horn and a trumpet.
//
//   timpani   sine with a sharp downward pitch bend and a struck-skin thump
//   basses    short bowed saw, dark, under everything
//   brass     three detuned saws through a filter that opens on the attack —
//             the brightness of the opening is the difference between a warm
//             horn call and a cutting trumpet stab
//   strings   wide detuned saw pad, slow bow, gentle top
//   spiccato  the same strings played short: the ostinato engine
//   celesta   triangle bell with an octave sparkle — the player's lock
//   choir     soft filtered sines, only ever heard at the two quiet moments
//
// Perceived loudness, not matching numbers: the saw-based voices are given far
// lower gains than the sine and triangle ones because at equal gain a saw
// buries everything else in the mix.

export type BroadsideVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

/** How a brass voice speaks: attack speed and how far the filter opens. */
export type BrassColour = {
  /** 0 = warm and covered (horn), 1 = bright and edged (trumpet). */
  bright: number;
  /** Seconds to full tone. Fanfares are fast; swells are slow. */
  attack: number;
  gain: number;
};

export const HORN: BrassColour = { bright: 0.3, attack: 0.09, gain: 0.115 };
export const TRUMPET: BrassColour = { bright: 1.0, attack: 0.028, gain: 0.085 };
export const TROMBONE: BrassColour = { bright: 0.55, attack: 0.045, gain: 0.1 };
export const TUBA: BrassColour = { bright: 0.16, attack: 0.07, gain: 0.13 };

export function createBroadsideVoices(environment: BroadsideVoiceEnvironment) {
  const musicOut = () => environment.mix()?.duck ?? environment.mix()?.music ?? environment.mix()?.master ?? null;
  const musicBed = () => environment.mix()?.music ?? environment.mix()?.master ?? null;

  const noiseVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

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
    noiseVoice.play({
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

  // ---- tone specs ---------------------------------------------------------------

  const timpaniTone = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.7,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.45, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.075 },
      { type: 'exponentialRamp', value: frequency * 0.94, time: time + 0.7 },
    ],
    gainAutomation: (time, gain) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: gain * 0.25, time: time + 0.16 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const bassTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.6, detune: -6 },
      { type: 'sawtooth', gain: 0.6, detune: 5 },
      { type: 'sine', gain: 0.7, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      Q: 1.4,
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 180, time },
        { type: 'linearRamp', value: 520, time: time + 0.05 },
        { type: 'linearRamp', value: 240, time: time + duration },
      ],
    },
    gainAutomation: (time, gain, { duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain, time: time + 0.02 },
      { type: 'linearRamp', value: gain * 0.7, time: time + duration * 0.6 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const brassTone = voice<{ duration: number; colour: BrassColour }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -8 },
      { type: 'sawtooth', gain: 0.5, detune: 7 },
      { type: 'square', gain: ({ colour }) => 0.14 + colour.bright * 0.1, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      Q: 1.1,
      // The whole character of the section lives in this ramp: a horn opens a
      // little and settles back, a trumpet snaps wide and stays there.
      frequencyAutomation: (time, { duration, colour }) => [
        { type: 'set', value: 260, time },
        { type: 'linearRamp', value: 780 + colour.bright * 3400, time: time + colour.attack * 1.6 },
        { type: 'linearRamp', value: 520 + colour.bright * 1500, time: time + duration },
      ],
    },
    gainAutomation: (time, gain, { duration, colour }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain, time: time + colour.attack },
      { type: 'linearRamp', value: gain * 0.78, time: time + Math.min(duration * 0.6, 0.42) },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const stringTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.42, detune: -11 },
      { type: 'sawtooth', gain: 0.42, detune: 9 },
      { type: 'triangle', gain: 0.34 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.1,
    filter: {
      type: 'lowpass',
      Q: 0.9,
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 500, time },
        { type: 'linearRamp', value: 1500, time: time + duration * 0.45 },
        { type: 'linearRamp', value: 700, time: time + duration },
      ],
    },
    // Slow bow in, slow bow out: strings never punch, they arrive.
    gainAutomation: (time, gain, { duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain, time: time + Math.min(0.55, duration * 0.35) },
      { type: 'set', value: gain, time: time + Math.max(0.05, duration - 0.5) },
      { type: 'linearRamp', value: 0.0001, time: time + duration },
    ],
  });

  const spiccatoTone = voice({
    oscillators: [
      { type: 'sawtooth', gain: 0.55 },
      { type: 'triangle', gain: 0.4, octave: 1 },
    ],
    duration: 0.12,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 2300, Q: 1.6 },
    envelope: { decay: 0.12 },
  });

  const tremoloTone = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.5 }, { type: 'sawtooth', gain: 0.5, detune: 12 }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 1700 },
    envelope: { attack: 0.012, decay: 0.075 },
  });

  const celestaTone = voice({
    oscillators: [
      { type: 'triangle', gain: 0.6 },
      { type: 'sine', gain: 0.26, octave: 1 },
      { type: 'sine', gain: 0.1, octave: 2 },
    ],
    duration: 0.55,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: 5200 },
    envelope: { decay: 0.55 },
  });

  const choirTone = voice<{ duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.7 },
      { type: 'triangle', gain: 0.22, detune: 7 },
      { type: 'sine', gain: 0.18, octave: 1, detune: -5 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.12,
    filter: { type: 'lowpass', cutoff: 2000 },
    gainAutomation: (time, gain, { duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain, time: time + duration * 0.4 },
      { type: 'linearRamp', value: 0.0001, time: time + duration },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    /** Struck skin: the level's heartbeat and its only percussion below 200 Hz. */
    timpani(context, time, midi, vel) {
      const out = musicOut();
      const mix = environment.mix();
      if (!out || !mix) return;
      timpaniTone.play({ context, time, midi, gain: 0.62 * vel, destination: out });
      noise(time, 0.09 * vel, 0.05, 'lowpass', 420, out);
      mix.duckAt(time, 0.78, 0.2);
    },

    /** Contrabasses and low brass doubling: the floor of the orchestra. */
    basses(context, time, midi, vel, duration) {
      const out = musicOut();
      if (!out) return;
      bassTone.play({ context, time, midi, gain: 0.16 * vel, duration, destination: out });
    },

    brass(context, time, midis, vel, duration, colour) {
      const mix = environment.mix();
      const out = musicOut();
      if (!out || !mix) return;
      const voicing = colour as BrassColour;
      for (const midi of midis as number[]) {
        brassTone.play({
          context,
          time,
          midi,
          gain: voicing.gain * vel,
          duration,
          colour: voicing,
          destination: out,
          sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.3 }] : undefined,
        });
      }
    },

    strings(context, time, midis, vel, duration) {
      const mix = environment.mix();
      const out = musicOut();
      if (!out || !mix) return;
      for (const midi of midis as number[]) {
        stringTone.play({
          context,
          time,
          midi,
          gain: 0.05 * vel,
          duration,
          destination: out,
          sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.42 }] : undefined,
        });
      }
    },

    spiccato(context, time, midi, vel) {
      const out = musicOut();
      if (!out) return;
      spiccatoTone.play({ context, time, midi, gain: 0.075 * vel, destination: out });
    },

    tremolo(context, time, midi, vel) {
      const out = musicOut();
      if (!out) return;
      tremoloTone.play({ context, time, midi, gain: 0.05 * vel, destination: out });
    },

    celesta(context, time, midi, vel) {
      const mix = environment.mix();
      const out = musicOut();
      if (!out || !mix) return;
      celestaTone.play({
        context,
        time,
        midi,
        gain: 0.09 * vel,
        destination: out,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.4 }] : undefined,
      });
    },

    choir(context, time, midis, vel, duration) {
      const mix = environment.mix();
      const out = musicOut();
      if (!out || !mix) return;
      for (const midi of midis as number[]) {
        choirTone.play({
          context,
          time,
          midi,
          gain: 0.055 * vel,
          duration,
          destination: out,
          sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.6 }] : undefined,
        });
      }
    },

    /** Suspended cymbal: a wash, not a crack. */
    cymbal(_context, time, vel, decay) {
      const out = musicBed();
      if (!out) return;
      noise(time, 0.055 * vel, decay, 'highpass', 7200, out);
      noise(time + 0.012, 0.03 * vel, decay * 0.7, 'bandpass', 4200, out);
    },

    /** Field drum: the martial layer. Tight, dry, and always off the beat. */
    snare(_context, time, vel) {
      const out = musicBed();
      if (!out) return;
      noise(time, 0.075 * vel, 0.055, 'bandpass', 1900, out);
      noise(time + 0.009, 0.045 * vel, 0.09, 'highpass', 3600, out);
    },

    /** Cymbal roll or noise sweep under a build. */
    riser(context, time, duration, peak) {
      const out = musicBed();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.12,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.1,
          frequencyAutomation: [
            { type: 'set', value: 420, time },
            { type: 'exponentialRamp', value: 7400, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: peak, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: out,
      });
    },
  }, {
    timpani: ['midi', 'vel'],
    basses: ['midi', 'vel', 'duration'],
    brass: ['midis', 'vel', 'duration', 'colour'],
    strings: ['midis', 'vel', 'duration'],
    spiccato: ['midi', 'vel'],
    tremolo: ['midi', 'vel'],
    celesta: ['midi', 'vel'],
    choir: ['midis', 'vel', 'duration'],
    cymbal: ['vel', 'decay'],
    snare: ['vel'],
    riser: ['duration', 'peak'],
  });

  // Only `brassTone` escapes the registry: audio.ts plays the soloist's own
  // notes through it directly so a kill can be crossfaded between two brass
  // colours mid-section. Everything else speaks through the instruments above.
  return { ...instruments, noise, brassTone };
}
