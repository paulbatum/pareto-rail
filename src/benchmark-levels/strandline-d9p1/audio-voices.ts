import { midiToFreq } from '../../engine/music';
import {
  playNoiseHit,
  playOscillatorVoice,
  type AutomationStep,
  type MixBus,
} from '../../engine/audio-kit';
import { voice, type VoiceSpec } from '../../engine/audio-voices';

export type StrandlineTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  detune?: number;
  reverb?: number;
};

// Procedural Audio Voices for Strandline:
// An aquatic, crystalline, organic aesthetic combining deep sub pulses,
// warm water pads, resonant marimba/bell arpeggios, and crisp hydrodynamic transients.

export function createStrandlineVoices(context: AudioContext, mix: MixBus) {
  // Pre-generate noise buffer for splashes, clicks, and hydrodynamic transients
  const noiseBuffer = context.createBuffer(
    1,
    Math.floor(context.sampleRate * 0.4),
    context.sampleRate,
  );
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i += 1) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  // 1. Sub Bass
  const subBassVoice = voice({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'triangle', gain: 0.35, octave: 0 },
    ],
    filter: { type: 'lowpass', cutoff: 180, Q: 1.0 },
    envelope: { attack: 0.02, decay: 0.7, sustain: 0.3, release: 0.4 },
    duration: 0.8,
  });

  // 2. Ocean Pad
  const oceanPadVoice = voice({
    oscillators: [
      { type: 'sawtooth', gain: 0.3, detune: -7 },
      { type: 'sawtooth', gain: 0.3, detune: 7 },
      { type: 'triangle', gain: 0.4, octave: 0 },
    ],
    filter: { type: 'lowpass', cutoff: 950, Q: 1.2 },
    envelope: { attack: 0.4, decay: 1.8, sustain: 0.6, release: 1.2 },
    duration: 2.4,
  });

  // 3. Water Bell / Plankton Arp
  const waterBellVoice = voice({
    oscillators: [
      { type: 'sine', gain: 0.65 },
      { type: 'triangle', gain: 0.35, frequencyRatio: 2.76 },
    ],
    filter: { type: 'lowpass', cutoff: 2800, Q: 2.0 },
    envelope: { attack: 0.005, decay: 0.45, sustain: 0.1, release: 0.35 },
    duration: 0.55,
  });

  // 4. Parasite Stinger / Synth
  const parasiteVoice = voice({
    oscillators: [
      { type: 'sawtooth', gain: 0.4, detune: -14 },
      { type: 'sawtooth', gain: 0.4, detune: 14 },
      { type: 'square', gain: 0.25, octave: -1 },
    ],
    filter: { type: 'bandpass', cutoff: 1400, Q: 3.5 },
    envelope: { attack: 0.01, decay: 0.35, sustain: 0.2, release: 0.2 },
    duration: 0.4,
  });

  // 5. Percussion
  function playKick(time: number, gain = 0.45) {
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.35,
      oscillatorType: 'sine',
      frequency: 110,
      frequencyAutomation: [
        { type: 'exponentialRamp', value: 38, time: time + 0.16 },
      ],
      gainAutomation: [
        { type: 'set', value: gain, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
      ],
      destination: mix.music,
    });
  }

  function playWaterSnare(time: number, gain = 0.25) {
    playNoiseHit({
      context,
      buffer: noiseBuffer,
      time,
      velocity: gain * 0.7,
      decay: 0.16,
      filterType: 'bandpass',
      frequency: 1600,
      destination: mix.music,
      offset: 0,
    });
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'triangle',
      frequency: 240,
      gainAutomation: [
        { type: 'set', value: gain * 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: mix.music,
    });
  }

  function playTick(time: number, gain = 0.15) {
    playNoiseHit({
      context,
      buffer: noiseBuffer,
      time,
      velocity: gain,
      decay: 0.03,
      filterType: 'highpass',
      frequency: 6500,
      destination: mix.music,
      offset: 0,
    });
  }

  // 6. Player Action Voices
  function playPlayerLock(time: number, midi: number) {
    const freq = midiToFreq(midi);
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.2,
      oscillatorType: 'sine',
      frequency: freq,
      gainAutomation: [
        { type: 'set', value: 0.14, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
      ],
      destination: mix.sfx,
    });
  }

  function playPlayerFire(time: number) {
    playNoiseHit({
      context,
      buffer: noiseBuffer,
      time,
      velocity: 0.18,
      decay: 0.14,
      filterType: 'bandpass',
      frequency: 2200,
      destination: mix.sfx,
      offset: 0,
    });
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.15,
      oscillatorType: 'sine',
      frequency: 440,
      frequencyAutomation: [
        { type: 'exponentialRamp', value: 180, time: time + 0.12 },
      ],
      gainAutomation: [
        { type: 'set', value: 0.12, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
      ],
      destination: mix.sfx,
    });
  }

  function playPlayerHit(time: number) {
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.25,
      oscillatorType: 'triangle',
      frequency: 580,
      gainAutomation: [
        { type: 'set', value: 0.12, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
      ],
      destination: mix.sfx,
    });
  }

  function playPlayerKill(time: number, midi: number, isBoss = false) {
    const freq = midiToFreq(midi);
    playOscillatorVoice({
      context,
      time,
      stopTime: time + (isBoss ? 1.8 : 0.65),
      oscillatorType: 'sine',
      frequency: freq,
      gainAutomation: [
        { type: 'set', value: isBoss ? 0.35 : 0.22, time },
        { type: 'exponentialRamp', value: 0.001, time: time + (isBoss ? 1.6 : 0.55) },
      ],
      destination: mix.sfx,
    });
    playOscillatorVoice({
      context,
      time,
      stopTime: time + (isBoss ? 1.4 : 0.45),
      oscillatorType: 'triangle',
      frequency: freq * 2,
      gainAutomation: [
        { type: 'set', value: isBoss ? 0.25 : 0.12, time },
        { type: 'exponentialRamp', value: 0.001, time: time + (isBoss ? 1.2 : 0.38) },
      ],
      destination: mix.sfx,
    });

    if (isBoss) {
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 2.5,
        oscillatorType: 'sine',
        frequency: midiToFreq(38),
        gainAutomation: [
          { type: 'set', value: 0.45, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 2.2 },
        ],
        destination: mix.sfx,
      });
    }
  }

  return {
    subBass: subBassVoice,
    oceanPad: oceanPadVoice,
    waterBell: waterBellVoice,
    parasiteVoice,
    playKick,
    playWaterSnare,
    playTick,
    playPlayerLock,
    playPlayerFire,
    playPlayerHit,
    playPlayerKill,
  };
}
