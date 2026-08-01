import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// VESPERS is the building's own organ: no percussion at all, the pulse is the
// counterpoint moving. These are the stops:
//
//   pedal       — the 16' drone the run opens on, a single held note
//   flute       — the cantus, the first voice to enter above the pedal
//   gamba       — the counterpoint, a reedier voice entering second
//   chorale     — the soft hymn blocks (root, third, fifth)
//   moving      — the 8th-note inner voice that makes the pulse felt
//   principale  — the bright voice held back all night; enters at the finale
//   bell        — the bell weight for the swells
//   choir       — the choir swell: detuned saws with a slow attack
//   riser       — a wind noise swell for the boss entrance
//
// Everything sends into the cathedral reverb; the room is part of the sound.

export type VespersKillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number };

export type VespersVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createVespersVoices(environment: VespersVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.duck ?? environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const delaySend = () => environment.mix()?.delaySend ?? null;

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

  const toMusic = (destination: AudioNode) => ({
    destination,
    sends: delaySend() ? [{ destination: delaySend()!, gain: 0.4 }] : undefined,
  });

  const pedalTone = voice<{ vel: number; destination?: AudioNode }>({
    oscillators: [
      { type: 'sawtooth', octave: -1, gain: 0.42 },
      { type: 'sine', gain: 0.6 },
    ],
    duration: 6.2,
    stopPadding: 0.5,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 170 + vel * 150, time },
        { type: 'linearRamp', value: 135, time: time + 2.2 },
      ],
    },
    envelope: { attack: 1.3, decay: 1.0, sustain: 0.9, release: 1.2 },
  });

  const fluteTone = voice<{ vel: number; destination?: AudioNode }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', octave: 1, gain: 0.32 },
    ],
    duration: 1.75,
    stopPadding: 0.35,
    filter: { type: 'lowpass', cutoff: 3400 },
    envelope: { attack: 0.07, decay: 0.5, sustain: 0.72, release: 0.5 },
  });

  const gambaTone = voice<{ vel: number; destination?: AudioNode }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', octave: 1, gain: 0.3 },
      { type: 'sine', midiOffset: 19, gain: 0.1 },
    ],
    duration: 1.7,
    stopPadding: 0.35,
    filter: { type: 'lowpass', cutoff: 3000 },
    envelope: { attack: 0.05, decay: 0.4, sustain: 0.66, release: 0.4 },
  });

  const choraleTone = voice<{ vel: number; destination?: AudioNode }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', octave: 1, gain: 0.18 },
    ],
    duration: 2.0,
    stopPadding: 0.4,
    filter: { type: 'lowpass', cutoff: 2600 },
    envelope: { attack: 0.3, decay: 0.45, sustain: 0.8, release: 0.6 },
  });

  const movingTone = voice<{ vel: number; destination?: AudioNode }>({
    oscillators: [
      { type: 'sine', gain: 0.85 },
      { type: 'sine', octave: 1, gain: 0.22 },
    ],
    duration: 0.34,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 3200 },
    envelope: { attack: 0.025, decay: 0.3 },
  });

  const principaleTone = voice<{ vel: number; destination?: AudioNode }>({
    oscillators: [
      { type: 'sine', gain: 0.7 },
      { type: 'sine', octave: 1, gain: 0.35 },
      { type: 'sine', midiOffset: 19, gain: 0.18 },
      { type: 'sine', octave: 2, gain: 0.09 },
    ],
    duration: 1.2,
    stopPadding: 0.4,
    filter: { type: 'lowpass', cutoff: 4200 },
    envelope: { attack: 0.035, decay: 0.3, sustain: 0.72, release: 0.35 },
  });

  const bellTone = voice<{ vel: number; destination?: AudioNode }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', frequencyRatio: 2.0, gain: 0.34 },
      { type: 'sine', frequencyRatio: 2.74, gain: 0.2 },
      { type: 'sine', frequencyRatio: 3.94, gain: 0.1 },
    ],
    duration: 2.4,
    stopPadding: 0.6,
    filter: { type: 'lowpass', cutoff: 5200 },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: gain * 0.55, time: time + 0.025 },
      { type: 'exponentialRamp', value: 0.001, time: time + 2.4 },
    ],
  });

  const choirTone = voice<{ vel: number; duration: number; destination?: AudioNode }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.4 },
      { type: 'sawtooth', gain: 0.3, detune: 9 },
      { type: 'sawtooth', gain: 0.3, detune: -9 },
      { type: 'sine', octave: 1, gain: 0.35 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.7,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 520, time },
        { type: 'linearRamp', value: 940, time: time + duration * 0.5 },
        { type: 'linearRamp', value: 500, time: time + duration },
      ],
    },
    envelope: { attack: 1.3, decay: 1.0, sustain: 0.82, release: 1.6 },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    pedal(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      pedalTone.play({ context, time, midi, vel, ...toMusic(output) });
    },

    flute(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      fluteTone.play({ context, time, midi, vel, ...toMusic(output) });
    },

    gamba(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      gambaTone.play({ context, time, midi, vel, ...toMusic(output) });
    },

    chorale(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      choraleTone.play({ context, time, midi, vel, ...toMusic(output) });
    },

    moving(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      movingTone.play({ context, time, midi, vel, ...toMusic(output) });
    },

    principale(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      principaleTone.play({ context, time, midi, vel, ...toMusic(output) });
    },

    bell(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      bellTone.play({ context, time, midi, vel, ...toMusic(output) });
    },

    choir(context, time, midis, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      for (const midi of midis) {
        choirTone.play({ context, time, midi, vel, duration, ...toMusic(output) });
      }
    },

    riser(context, time, duration) {
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
          frequencyAutomation: [
            { type: 'set', value: 240, time },
            { type: 'exponentialRamp', value: 4200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.12, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },
  }, {
    pedal: ['midi', 'vel'],
    flute: ['midi', 'vel'],
    gamba: ['midi', 'vel'],
    chorale: ['midi', 'vel'],
    moving: ['midi', 'vel'],
    principale: ['midi', 'vel'],
    bell: ['midi', 'vel'],
    choir: ['midis', 'duration', 'vel'],
    riser: ['duration'],
  });

  return {
    ...instruments,
    noiseHit,
    musicDestination,
    sfxDestination,
  };
}

export type VespersVoices = ReturnType<typeof createVespersVoices>;
