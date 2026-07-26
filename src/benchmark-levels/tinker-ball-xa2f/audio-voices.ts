import { voice } from '../../engine/audio-voices';
import { playNoiseHit } from '../../engine/audio-kit';

// Mallet (Marimba/Glockenspiel) voice for lead melody & kills
export const malletVoice = voice<{ frequency: number; gain?: number }>({
  oscillators: [
    { type: 'sine', gain: 0.8 },
    { type: 'triangle', gain: 0.4, octave: 1 },
    { type: 'sine', gain: 0.2, octave: 2 },
  ],
  envelope: { attack: 0.002, decay: 0.45, sustain: 0.0, release: 0.1 },
  filter: { type: 'lowpass', frequency: 3800 },
  duration: 0.5,
});

// Clipped Reed-Organ stab voice for chords
export const organVoice = voice<{ frequency: number; gain?: number }>({
  oscillators: [
    { type: 'sawtooth', gain: 0.5 },
    { type: 'square', gain: 0.4, midiOffset: 7 }, // fifth harmonic
    { type: 'triangle', gain: 0.3, octave: -1 },
  ],
  envelope: { attack: 0.01, decay: 0.22, sustain: 0.15, release: 0.1 },
  filter: { type: 'bandpass', frequency: 1800, Q: 2 },
  duration: 0.25,
});

// Bouncy Synth Bass voice
export const bassVoice = voice<{ frequency: number; gain?: number }>({
  oscillators: [
    { type: 'sawtooth', gain: 0.7 },
    { type: 'square', gain: 0.5, octave: -1 },
  ],
  envelope: { attack: 0.005, decay: 0.3, sustain: 0.1, release: 0.15 },
  filter: { type: 'lowpass', frequency: 900, Q: 3 },
  duration: 0.35,
});

// Workshop Percussion (Noise & Ticks)
export function playWorkshopPercussion(
  ctx: AudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
  time: number,
  type: 'tick' | 'snip' | 'clap' | 'wood',
): void {
  if (type === 'tick') {
    playNoiseHit({
      context: ctx,
      buffer,
      time,
      velocity: 0.25,
      decay: 0.035,
      filterType: 'highpass',
      frequency: 4500,
      destination,
    });
  } else if (type === 'snip') {
    playNoiseHit({
      context: ctx,
      buffer,
      time,
      velocity: 0.3,
      decay: 0.055,
      filterType: 'bandpass',
      frequency: 3200,
      destination,
    });
  } else if (type === 'clap') {
    playNoiseHit({
      context: ctx,
      buffer,
      time,
      velocity: 0.35,
      decay: 0.11,
      filterType: 'bandpass',
      frequency: 1400,
      destination,
    });
  } else {
    // Wood tap
    playNoiseHit({
      context: ctx,
      buffer,
      time,
      velocity: 0.4,
      decay: 0.075,
      filterType: 'lowpass',
      frequency: 1200,
      destination,
    });
  }
}

// Gameplay Action SFX
export const lockSfx = voice<{ midi: number }>({
  oscillators: [{ type: 'sine', gain: 0.18 }],
  envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
  filter: { type: 'highpass', frequency: 2400 },
  duration: 0.08,
});

export const fireSfx = voice<{ midi: number }>({
  oscillators: [
    { type: 'triangle', gain: 0.25 },
    { type: 'sine', gain: 0.15, octave: 1 },
  ],
  envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.04 },
  filter: { type: 'bandpass', frequency: 2200, Q: 2 },
  duration: 0.15,
});

export const hitSfx = voice<{ midi: number }>({
  oscillators: [{ type: 'square', gain: 0.2 }],
  envelope: { attack: 0.002, decay: 0.1, sustain: 0, release: 0.03 },
  filter: { type: 'lowpass', frequency: 1600 },
  duration: 0.1,
});

export const rejectSfx = voice<{ midi: number }>({
  oscillators: [
    { type: 'sawtooth', gain: 0.3, frequencyRatio: 1 },
    { type: 'sawtooth', gain: 0.3, frequencyRatio: 1.414 }, // tritone buzz
  ],
  envelope: { attack: 0.005, decay: 0.18, sustain: 0, release: 0.05 },
  filter: { type: 'lowpass', frequency: 800 },
  duration: 0.2,
});

export const playerHitSfx = voice<{ midi: number }>({
  oscillators: [{ type: 'sawtooth', gain: 0.4, midiOffset: -12 }],
  envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.1 },
  filter: { type: 'lowpass', frequency: 500, Q: 5 },
  duration: 0.3,
});
