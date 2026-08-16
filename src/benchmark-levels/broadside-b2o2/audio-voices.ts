import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Broadside's orchestra is synthesized, but it thinks like an orchestra:
// timpani are tuned drums with real pitch, horns are detuned saw pairs with
// a breath attack and a swell, strings are saw stacks that can shimmer or
// drive, brass stabs are filtered bursts, and the fleet's broadside guns are
// the biggest percussion in the mix. Player actions sit in the same hall.

export type BroadTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type BroadVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createBroadsideVoices(environment: BroadVoiceEnvironment) {
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

  // ---- tonal voice specs ---------------------------------------------------------

  // Timpani: a tuned skin — pitch falls into the note, long boom after.
  const timpaniTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.85,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.45, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.09 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
    ],
  });

  // Horn: two detuned saws through a warm filter, breath then swell.
  const hornTone = voice<{ vel: number; duration: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.55, detune: -7 },
      { type: 'sawtooth', gain: 0.55, detune: 7 },
      { type: 'sine', octave: -1, gain: 0.4 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'linearRamp', value: cutoff * 0.72, time: time + 0.6 }],
    },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.16 * vel, time: time + 0.07 },
      { type: 'linearRamp', value: 0.13 * vel, time: time + Math.min(duration * 0.6, 0.5) },
      { type: 'set', value: 0.13 * vel, time: time + Math.max(0.07, duration - 0.18) },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  // Brass stab: fast filtered burst with a hard accent.
  const stabTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -5 },
      { type: 'sawtooth', gain: 0.5, detune: 5 },
      { type: 'square', octave: -1, gain: 0.22 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      cutoff: 2400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 640, time: time + 0.16 }],
    },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.17 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  // String pad: three detuned saws per note, slow swell.
  const stringPadTone = voice<{ vel: number; duration: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.4, detune: -9 },
      { type: 'sawtooth', gain: 0.4, detune: 0 },
      { type: 'sawtooth', gain: 0.4, detune: 9 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.1,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff, duration }) => [{ type: 'linearRamp', value: cutoff * 0.7, time: time + duration }],
    },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.075 * vel, time: time + Math.min(0.8, duration * 0.3) },
      { type: 'set', value: 0.075 * vel, time: time + Math.max(0.1, duration - Math.min(1.0, duration * 0.35)) },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  // Ostinato chug: a short saw note for 16th strings.
  const ostinatoTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.62 },
      { type: 'square', octave: -1, gain: 0.2 },
    ],
    duration: 0.1,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'exponentialRamp', value: Math.max(320, cutoff * 0.4), time: time + 0.09 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.062 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
    ],
  });

  // Harp / celesta: triangle pluck with a sine octave shimmer.
  const harpTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.8 },
      { type: 'sine', octave: 1, gain: 0.25 },
    ],
    duration: 0.55,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.1 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
    ],
  });

  // Solo flute-ish voice for the eye: sine + breath.
  const fluteTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.85 },
      { type: 'triangle', octave: 1, gain: 0.08 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.12 * vel, time: time + 0.12 },
      { type: 'set', value: 0.12 * vel, time: time + Math.max(0.12, duration - 0.25) },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const subTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.6,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.3 * vel, time: time + 0.02 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.07,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 150, time: time + 0.06 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
    ],
  });

  const playerToneSpec = voice<{ voice: BroadTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    timpani(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      timpaniTone.play({ context, time, midi, vel, destination: output });
      noiseHit(time, 0.09 * vel, 0.05, 'lowpass', 480, output);
      environment.mix()?.duckAt(time, 0.55, 0.12);
    },

    // The fleet's broadside guns: the largest percussion in the mix.
    salvoBoom(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      timpaniTone.play({ context, time, frequency: 58, vel: vel * 1.2, destination: output });
      subTone.play({ context, time, frequency: 34, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.5, 'lowpass', 300, output);
      noiseHit(time + 0.03, 0.1 * vel, 0.9, 'bandpass', 900, output);
      environment.mix()?.duckAt(time, 0.5, 0.3);
    },

    // Distant battle, heard from the eye: far-off ordnance.
    battleRumble(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.1 * vel, 1.4, 'lowpass', 160, output);
      noiseHit(time + 0.02, 0.04 * vel, 2.0, 'lowpass', 320, output);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.14 * vel, 0.09, 'bandpass', 1900, output);
      noiseHit(time + 0.008, 0.07 * vel, 0.06, 'bandpass', 2800, output);
      snareBody.play({ context, time, frequency: 200, vel, destination: output });
    },

    // Snare roll: N sixteenths starting here.
    snareRoll(context, time, vel, steps, stepSeconds) {
      const output = musicDestination();
      if (!output) return;
      for (let i = 0; i < steps; i += 1) {
        const t = time + i * stepSeconds;
        const v = vel * (0.4 + 0.6 * (i / steps));
        noiseHit(t, 0.08 * v, 0.05, 'bandpass', 2200, output);
      }
    },

    cymbal(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel * 0.5, 1.1, 'highpass', 5200, output);
      noiseHit(time, vel * 0.4, 1.9, 'bandpass', 7600, reverbSend);
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
          Q: 1.1,
          frequency: 260,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 7200, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    horn(context, time, midi, duration, vel, cutoff = 1500) {
      const mixBus = environment.mix();
      const output = musicDestination();
      if (!mixBus || !output) return;
      hornTone.play({
        context,
        time,
        midi,
        duration,
        vel,
        cutoff,
        destination: output,
        sends: mixBus.reverbSend ? [{ destination: mixBus.reverbSend, gain: 0.45 }] : [],
      });
    },

    brassStab(context, time, midi, vel, duration = 0.24) {
      const mixBus = environment.mix();
      const output = musicDestination();
      if (!mixBus || !output) return;
      stabTone.play({
        context,
        time,
        midi,
        duration,
        vel,
        destination: output,
        sends: mixBus.reverbSend ? [{ destination: mixBus.reverbSend, gain: 0.3 }] : [],
      });
    },

    // Chord stab: root triad as one call.
    brassChord(context, time, midis, vel, duration = 0.3) {
      for (const [index, midi] of midis.entries()) {
        instruments.brassStab(time + index * 0.012, midi, vel * (1 - index * 0.12), duration);
      }
    },

    strings(context, time, midis, duration, vel, cutoff = 1800) {
      const mixBus = environment.mix();
      const output = musicDestination();
      if (!mixBus || !output) return;
      for (const midi of midis) {
        stringPadTone.play({
          context,
          time,
          midi,
          duration,
          vel: vel / Math.sqrt(midis.length),
          cutoff,
          destination: output,
          sends: mixBus.reverbSend ? [{ destination: mixBus.reverbSend, gain: 0.5 }] : [],
        });
      }
    },

    ostinato(context, time, midi, vel, cutoff = 2100) {
      const mixBus = environment.mix();
      const output = musicDestination();
      if (!mixBus || !output) return;
      ostinatoTone.play({
        context,
        time,
        midi,
        vel,
        cutoff,
        destination: output,
        sends: mixBus.delaySend ? [{ destination: mixBus.delaySend, gain: 0.25 }] : [],
      });
    },

    harp(context, time, midi, vel) {
      const mixBus = environment.mix();
      const output = musicDestination();
      if (!mixBus || !output) return;
      harpTone.play({
        context,
        time,
        midi,
        vel,
        destination: output,
        sends: mixBus.reverbSend ? [{ destination: mixBus.reverbSend, gain: 0.55 }] : [],
      });
    },

    flute(context, time, midi, duration, vel) {
      const mixBus = environment.mix();
      const output = musicDestination();
      if (!mixBus || !output) return;
      fluteTone.play({
        context,
        time,
        midi,
        duration,
        vel,
        destination: output,
        sends: mixBus.reverbSend ? [{ destination: mixBus.reverbSend, gain: 0.6 }] : [],
      });
    },

    subPulse(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subTone.play({ context, time, midi, vel, destination: duck });
    },

    // The victory tutti: the whole orchestra lands on one chord.
    tutti(context, time, midis, vel) {
      const mixBus = environment.mix();
      const output = musicDestination();
      if (!mixBus || !output) return;
      const duration = 4.2;
      for (const midi of midis) {
        hornTone.play({ context, time, midi, duration, vel: vel * 1.15, cutoff: 2100, destination: output, sends: mixBus.reverbSend ? [{ destination: mixBus.reverbSend, gain: 0.55 }] : [] });
        stringPadTone.play({ context, time, midi: midi + 12, duration, vel: vel * 0.5, cutoff: 2600, destination: output, sends: mixBus.reverbSend ? [{ destination: mixBus.reverbSend, gain: 0.6 }] : [] });
      }
      instruments.timpani(time, midis[0] - 24, vel * 1.1);
      instruments.cymbal(time, vel * 0.55);
    },
  }, {
    timpani: ['midi', 'vel'],
    salvoBoom: ['vel'],
    battleRumble: ['vel'],
    snare: ['vel'],
    snareRoll: ['vel', 'steps', 'stepSeconds'],
    cymbal: ['vel'],
    riser: ['duration', 'level'],
    horn: ['midi', 'duration', 'vel', 'cutoff'],
    brassStab: ['midi', 'vel', 'duration'],
    brassChord: ['midis', 'vel', 'duration'],
    strings: ['midis', 'duration', 'vel', 'cutoff'],
    ostinato: ['midi', 'vel', 'cutoff'],
    harp: ['midi', 'vel'],
    flute: ['midi', 'duration', 'vel'],
    subPulse: ['midi', 'vel'],
    tutti: ['midis', 'vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voice: BroadTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice, velocity: vel, weight, destination: output, sends: playerSends(0.3, voice.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  function killBody(time: number, midi: number, decay: number, gain: number, vel: number) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    killBodyVoice.play({ context, time, midi, decay, gain, velocity: vel, destination: output });
  }

  function oscillatorVoice(options: Parameters<typeof playOscillatorVoice>[0]) {
    if (environment.trace) {
      environment.trace.record(options.time, 'oscVoice', { frequency: options.frequency, oscillator: options.oscillatorType });
      return;
    }
    playOscillatorVoice(options);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise, killBody, oscillatorVoice };
}

export type BroadsideVoices = ReturnType<typeof createBroadsideVoices>;
