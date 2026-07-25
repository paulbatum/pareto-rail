import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// Leaf: organ rank construction. Every timbre decision that shapes a rank
// lives here as a voice spec; which rank plays what, and when, stays in
// audio.ts. All ranks are additive stacks of harmonically-related partials —
// the classic way an organ builds its sound — so they blend into one
// instrument rather than a pile of synths.

export type VespersVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createVespersVoices(environment: VespersVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.duck ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const reverbSends = (gain: number) => {
    const reverbSend = environment.mix()?.reverbSend;
    return reverbSend && gain > 0 ? [{ destination: reverbSend, gain }] : [];
  };

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

  // 16' pedal: fundamental, a sub octave, and a whisper of definition.
  const pedalTone = voice<{ dur: number }>({
    oscillators: [
      { type: 'sine', gain: 0.34 },
      { type: 'sine', octave: -1, gain: 0.22 },
      { type: 'triangle', gain: 0.1 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.3,
    envelope: { attack: 0.07, decay: 0.25, sustain: 0.8, release: 0.28 },
  });

  // 8' principal chorus: the organ's speaking voice. Fundamental, octave,
  // twelfth, and fifteenth partials.
  const principalTone = voice<{ dur: number; cutoff: number }>({
    oscillators: [
      { type: 'sine', gain: 0.3 },
      { type: 'sine', octave: 1, gain: 0.12 },
      { type: 'sine', frequencyRatio: 3, gain: 0.055 },
      { type: 'triangle', gain: 0.07 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.25,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: 0.03, decay: 0.18, sustain: 0.72, release: 0.2 },
  });

  // Stopped flute: nearly pure, breathy, for the quiet span and the locks.
  const fluteTone = voice<{ dur: number }>({
    oscillators: [
      { type: 'sine', gain: 0.3 },
      { type: 'triangle', gain: 0.05 },
      { type: 'sine', frequencyRatio: 2.004, gain: 0.03 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.25,
    envelope: { attack: 0.045, decay: 0.2, sustain: 0.7, release: 0.22 },
  });

  // Dark reed for the Vigil: a saw pair behind a closed filter.
  const reedTone = voice<{ dur: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.085 },
      { type: 'sawtooth', detune: 7, gain: 0.05 },
      { type: 'sine', gain: 0.1 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.25,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 0.9 },
    envelope: { attack: 0.04, decay: 0.2, sustain: 0.75, release: 0.2 },
  });

  // The rank held back all night: an en chamade trumpet. It speaks only at
  // the finale, so it is allowed to be bright.
  const trumpetTone = voice<{ dur: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.13 },
      { type: 'square', gain: 0.035 },
      { type: 'sine', gain: 0.08 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.3,
    filter: { type: 'lowpass', cutoff: 3400 },
    envelope: { attack: 0.018, decay: 0.14, sustain: 0.78, release: 0.24 },
  });

  // Choir: paired detuned voices behind a vowel-ish band, slow to bloom.
  const choirTone = voice<{ dur: number; detune: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.045, detune: ({ detune }) => detune }],
    duration: ({ dur }) => dur,
    stopPadding: 0.4,
    filter: { type: 'lowpass', cutoff: 1350, Q: 0.7 },
    gainAutomation: (time, gain, { dur }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain, time: time + dur * 0.35 },
      { type: 'set', value: gain, time: time + dur * 0.7 },
      { type: 'linearRamp', value: 0.0001, time: time + dur },
    ],
  });

  // Bell: inharmonic partials, long decay — the tower speaking through stone.
  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.3 },
      { type: 'sine', frequencyRatio: 2.0, gain: 0.11 },
      { type: 'sine', frequencyRatio: 2.76, gain: 0.16 },
      { type: 'sine', frequencyRatio: 5.404, gain: 0.05 },
    ],
    duration: 2.6,
    stopPadding: 0.2,
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.0008, time: time + 2.6 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    pedal(context, time, midi, dur, vel) {
      const output = musicDestination();
      if (!output) return;
      pedalTone.play({ context, time, midi, dur, velocity: vel, destination: output, sends: reverbSends(0.22) });
    },

    principal(context, time, midi, dur, vel, cutoff) {
      const output = musicDestination();
      if (!output) return;
      principalTone.play({ context, time, midi, dur, cutoff, velocity: vel, destination: output, sends: reverbSends(0.38) });
      // Chiff: the pipe's breath of attack.
      noiseHit(time, 0.016 * vel, 0.018, 'bandpass', 2400, output);
    },

    flute(context, time, midi, dur, vel) {
      const output = musicDestination();
      if (!output) return;
      fluteTone.play({ context, time, midi, dur, velocity: vel, destination: output, sends: reverbSends(0.5) });
    },

    reed(context, time, midi, dur, vel, cutoff) {
      const output = musicDestination();
      if (!output) return;
      reedTone.play({ context, time, midi, dur, cutoff, velocity: vel, destination: output, sends: reverbSends(0.3) });
    },

    trumpet(context, time, midi, dur, vel) {
      const output = musicDestination();
      if (!output) return;
      trumpetTone.play({ context, time, midi, dur, velocity: vel, destination: output, sends: reverbSends(0.45) });
    },

    choir(context, time, midis, dur) {
      const output = musicDestination();
      if (!output) return;
      for (const midi of midis) {
        for (const detune of [-9, 9]) {
          choirTone.play({ context, time, midi, dur, detune, destination: output, sends: reverbSends(0.5) });
        }
      }
    },

    bell(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      bellTone.play({ context, time, midi, vel, destination: output, sends: reverbSends(0.55) });
    },
  }, {
    pedal: ['midi', 'dur', 'vel'],
    principal: ['midi', 'dur', 'vel', 'cutoff'],
    flute: ['midi', 'dur', 'vel'],
    reed: ['midi', 'dur', 'vel', 'cutoff'],
    trumpet: ['midi', 'dur', 'vel'],
    choir: ['midis', 'dur'],
    bell: ['midi', 'vel'],
  });

  return {
    ...instruments,
    noiseHit,
    reverbSends,
    sfxDestination,
    musicDestination,
  };
}
