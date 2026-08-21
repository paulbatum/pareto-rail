import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type TinkerTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  sparkle: number;
  reverb?: number;
};

export type TinkerVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createTinkerVoices(environment: TinkerVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  // Noise hit spec for percussion
  const noiseVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1200, velocity: 1, decay: 0.04 });

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
    noiseVoice.play({
      context,
      buffer: noiseBuffer,
      time,
      velocity: vel,
      decay,
      filterType,
      frequency,
      destination,
      offset: Math.random() * 1.2,
    });
  }

  // ---- Drums & Workshop Percussion ----
  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.16,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 45, time: time + 0.08 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.48 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const woodblockTone = voice<{ vel: number; pitch: number }>({
    oscillators: [{ type: 'triangle', gain: 0.8 }, { type: 'sine', gain: 0.5, octave: 1 }],
    duration: 0.05,
    stopPadding: 0.01,
    filter: { type: 'bandpass', frequency: 1600, Q: 3.5 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.22 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.05 },
    ],
  });

  // ---- Backing Melodic Instruments ----
  const bassTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.85 },
      { type: 'sine', gain: 0.6, octave: -1 },
    ],
    duration: 0.22,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      frequency: 1800,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 380, time: time + 0.18 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.32 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const reedStabTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5 },
      { type: 'square', gain: 0.35, octave: 1 },
    ],
    duration: 0.12,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      frequency: 2200,
      Q: 1.8,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 900, time: time + 0.11 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.18 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  const malletTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'triangle', gain: 0.4, octave: 1 },
      { type: 'sine', gain: 0.25, octave: 2 },
    ],
    duration: 0.28,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 4500 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.24 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });

  const instruments = defineInstruments(environment, {
    // 1. Kick
    kick(context, time, vel = 1) {
      const dest = musicDestination();
      if (!dest) return;
      kickTone.play({ context, destination: dest, time, frequency: 140, vel: Number(vel) });
    },

    // 2. Handclap / Snare
    clap(_context, time, vel = 1) {
      const dest = musicDestination();
      if (!dest) return;
      const v = Number(vel);
      noiseHit(time, v * 0.3, 0.02, 'bandpass', 1800, dest);
      noiseHit(time + 0.012, v * 0.4, 0.025, 'bandpass', 2000, dest);
      noiseHit(time + 0.024, v * 0.8, 0.06, 'bandpass', 1600, dest);
    },

    // 3. Hi-hat / Shaker
    hat(_context, time, vel = 1) {
      const dest = musicDestination();
      if (!dest) return;
      noiseHit(time, Number(vel) * 0.22, 0.025, 'highpass', 5500, dest);
    },

    // 4. Workshop Woodblock
    woodblock(context, time, midi = 72, vel = 1) {
      const dest = musicDestination();
      if (!dest) return;
      woodblockTone.play({ context, destination: dest, time, midi: Number(midi), pitch: Number(midi), vel: Number(vel) });
    },

    // 5. Bouncy Synth Bass
    bass(context, time, midi = 36, vel = 1) {
      const dest = musicDestination();
      if (!dest) return;
      bassTone.play({ context, destination: dest, time, midi: Number(midi), vel: Number(vel) });
    },

    // 6. Reed-Organ Chord Stab
    stab(context, time, midi = 60, vel = 1) {
      const dest = musicDestination();
      if (!dest) return;
      reedStabTone.play({ context, destination: dest, time, midi: Number(midi), vel: Number(vel) });
    },

    // 7. Bell Mallet / Celesta
    mallet(context, time, midi = 72, vel = 1) {
      const dest = musicDestination();
      if (!dest) return;
      malletTone.play({ context, destination: dest, time, midi: Number(midi), vel: Number(vel) });
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    hat: ['vel'],
    woodblock: ['midi', 'vel'],
    bass: ['midi', 'vel'],
    stab: ['midi', 'vel'],
    mallet: ['midi', 'vel'],
  });

  return {
    ...instruments,
    // ---- Player Action SFX / Melodic Voices ----
    playerLock(time: number, midi: number, vel = 1) {
      const dest = sfxDestination();
      const ctx = environment.context();
      if (!dest || !ctx) return;
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.12,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        filter: { type: 'highpass', frequency: 1200 },
        gainAutomation: [
          { type: 'set', value: 0.14 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
        ],
        destination: dest,
      });
    },

    playerFire(time: number, vel = 1) {
      const dest = sfxDestination();
      const ctx = environment.context();
      if (!dest || !ctx) return;
      noiseHit(time, vel * 0.35, 0.04, 'bandpass', 2400, dest);
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.08,
        oscillatorType: 'triangle',
        frequency: 440,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 160, time: time + 0.07 }],
        gainAutomation: [
          { type: 'set', value: 0.18 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
        ],
        destination: dest,
      });
    },

    playerHit(time: number, midi: number, vel = 1) {
      const dest = sfxDestination();
      const ctx = environment.context();
      if (!dest || !ctx) return;
      woodblockTone.play({ context: ctx, destination: dest, time, midi, pitch: midi, vel });
    },

    playerKill(time: number, midi: number, vel = 1) {
      const dest = sfxDestination();
      const ctx = environment.context();
      if (!dest || !ctx) return;
      malletTone.play({ context: ctx, destination: dest, time, midi, vel: vel * 1.25 });
    },

    playerReject(time: number) {
      const dest = sfxDestination();
      if (!dest) return;
      noiseHit(time, 0.4, 0.03, 'lowpass', 600, dest);
      noiseHit(time + 0.04, 0.3, 0.03, 'lowpass', 500, dest);
    },
  };
}
