import { noiseHit, voice } from '../../engine/audio-voices';
import type { AutomationStep } from '../../engine/audio-kit';

// The orchestra, synthesized. Each timbre is a compact spec: what oscillators,
// how the filter opens (brass "blats" open the filter fast then settle; strings
// bloom slowly), and how the gain moves. Gains here are per-voice loudness
// trims; the arrangement decides which voices play when.

/** Attack / hold / release contour shared by the sustained voices. */
function contour(time: number, gain: number, duration: number, attack: number, release: number, sustain = 0.75): AutomationStep[] {
  const end = time + duration;
  const releaseStart = Math.max(time + attack + 0.02, end - release);
  return [
    { type: 'set', value: 0.0001, time },
    { type: 'linearRamp', value: gain, time: time + attack },
    { type: 'linearRamp', value: gain * sustain, time: Math.min(releaseStart, time + attack + Math.max(0.05, (duration - attack) * 0.5)) },
    { type: 'linearRamp', value: gain * sustain, time: releaseStart },
    { type: 'exponentialRamp', value: 0.0001, time: end },
  ];
}

type SustainCall = { velocity: number; duration: number };
type BrassCall = SustainCall & { bright: number };

/** Horns and trumpets: detuned saws plus a square edge, filter that blats open then settles. */
export const brassVoice = voice<BrassCall>({
  oscillators: [
    { type: 'sawtooth', detune: -7 },
    { type: 'sawtooth', detune: 6, gain: 0.85 },
    { type: 'square', gain: 0.16 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.1,
  filter: {
    type: 'lowpass',
    Q: 1.3,
    frequency: 500,
    frequencyAutomation: (time, call) => [
      { type: 'set', value: 380, time },
      { type: 'exponentialRamp', value: 1000 + call.bright * 2600, time: time + 0.09 },
      { type: 'exponentialRamp', value: 800 + call.bright * 1300, time: time + Math.max(0.24, call.duration * 0.55) },
    ],
  },
  gainAutomation: (time, gain, call) => contour(time, gain, call.duration, 0.055, 0.09, 0.8),
});

/** Short brass hits: sforzando stabs. */
export const stabVoice = voice<{ velocity: number; bright: number }>({
  oscillators: [
    { type: 'sawtooth', detune: -8 },
    { type: 'sawtooth', detune: 8, gain: 0.9 },
    { type: 'square', gain: 0.2 },
  ],
  duration: 0.42,
  stopPadding: 0.06,
  filter: {
    type: 'lowpass',
    Q: 1.6,
    frequency: 700,
    frequencyAutomation: (time, call) => [
      { type: 'set', value: 500, time },
      { type: 'exponentialRamp', value: 1400 + call.bright * 3400, time: time + 0.035 },
      { type: 'exponentialRamp', value: 600, time: time + 0.4 },
    ],
  },
  gainAutomation: (time, gain) => [
    { type: 'set', value: 0.0001, time },
    { type: 'linearRamp', value: gain, time: time + 0.014 },
    { type: 'exponentialRamp', value: gain * 0.32, time: time + 0.15 },
    { type: 'exponentialRamp', value: 0.0001, time: time + 0.4 },
  ],
});

/** Low brass ostinato: tuba/trombone, dark and short. */
export const lowBrassVoice = voice<{ velocity: number; duration: number }>({
  oscillators: [
    { type: 'sawtooth', detune: -5 },
    { type: 'square', gain: 0.5, octave: -1 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.05,
  filter: { type: 'lowpass', Q: 0.9, frequency: 620 },
  gainAutomation: (time, gain, call) => [
    { type: 'set', value: 0.0001, time },
    { type: 'linearRamp', value: gain, time: time + 0.02 },
    { type: 'exponentialRamp', value: gain * 0.5, time: time + call.duration * 0.6 },
    { type: 'exponentialRamp', value: 0.0001, time: time + call.duration },
  ],
});

/** String ensemble: three detuned saws plus a triangle body, slow bloom. */
export const stringsVoice = voice<SustainCall & { attack: number }>({
  oscillators: [
    { type: 'sawtooth', detune: -13 },
    { type: 'sawtooth', detune: 0, gain: 0.9 },
    { type: 'sawtooth', detune: 12 },
    { type: 'triangle', gain: 0.6, octave: -1 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.12,
  filter: { type: 'lowpass', Q: 0.5, frequency: 2300 },
  gainAutomation: (time, gain, call) => contour(time, gain, call.duration, call.attack, Math.min(0.7, call.duration * 0.4), 0.85),
});

/** Spiccato / tremolo bow: the same ensemble, clipped. */
export const spiccatoVoice = voice<{ velocity: number; decay: number; bright: number }>({
  oscillators: [
    { type: 'sawtooth', detune: -10 },
    { type: 'sawtooth', detune: 9, gain: 0.9 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.04,
  filter: { type: 'lowpass', Q: 0.8, frequency: 2600 },
  gainAutomation: (time, gain, call) => [
    { type: 'set', value: 0.0001, time },
    { type: 'linearRamp', value: gain, time: time + 0.008 },
    { type: 'exponentialRamp', value: 0.0001, time: time + call.decay },
  ],
});

/** Choir-ish pad: soft triangles plus a whisper of saw through a vowel-shaped bandpass. */
export const choirVoice = voice<SustainCall>({
  oscillators: [
    { type: 'triangle', detune: -9 },
    { type: 'triangle', detune: 8 },
    { type: 'sawtooth', gain: 0.16 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.15,
  filter: { type: 'bandpass', Q: 0.7, frequency: 1150 },
  gainAutomation: (time, gain, call) => contour(time, gain, call.duration, Math.min(1.2, call.duration * 0.4), Math.min(1.4, call.duration * 0.5), 0.9),
});

/** Timpani: a sine that starts sharp and falls onto its pitch, with a fifth overtone. */
export const timpaniVoice = voice<{ velocity: number; decay: number }>({
  oscillators: [{ type: 'sine' }, { type: 'sine', gain: 0.32, frequencyRatio: 1.5 }, { type: 'triangle', gain: 0.18, frequencyRatio: 2.01 }],
  duration: ({ decay }) => decay,
  stopPadding: 0.05,
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency * 1.9, time },
    { type: 'exponentialRamp', value: frequency, time: time + 0.075 },
  ],
  gainAutomation: (time, gain, call) => [
    { type: 'set', value: gain, time },
    { type: 'exponentialRamp', value: 0.0008, time: time + call.decay },
  ],
});

/** Harp: a plucked triangle with a bright octave that dies fast. */
export const harpVoice = voice<{ velocity: number; decay: number }>({
  oscillators: [{ type: 'triangle' }, { type: 'sine', gain: 0.4, octave: 1 }, { type: 'sine', gain: 0.12, frequencyRatio: 3.01 }],
  duration: ({ decay }) => decay,
  stopPadding: 0.05,
  filter: { type: 'lowpass', Q: 0.4, frequency: 4200 },
  gainAutomation: (time, gain, call) => [
    { type: 'set', value: gain, time },
    { type: 'exponentialRamp', value: gain * 0.25, time: time + call.decay * 0.25 },
    { type: 'exponentialRamp', value: 0.0005, time: time + call.decay },
  ],
});

/** The player's lock pluck: glass harp, pitched from the live harmony. */
export const glassVoice = voice<{ velocity: number; decay: number; bright: number }>({
  oscillators: [{ type: 'triangle' }, { type: 'sine', gain: 0.5, octave: 1 }, { type: 'square', gain: 0.05 }],
  duration: ({ decay }) => decay,
  stopPadding: 0.04,
  filter: { type: 'lowpass', Q: 1.1, frequency: 3400, cutoff: (call) => call.bright },
  gainAutomation: (time, gain, call) => [
    { type: 'set', value: gain, time },
    { type: 'exponentialRamp', value: 0.0005, time: time + call.decay },
  ],
});

/** Celesta / glockenspiel: a sine with two inharmonic partials. The kill voice. */
export const bellVoice = voice<{ velocity: number; decay: number }>({
  oscillators: [
    { type: 'sine' },
    { type: 'sine', gain: 0.3, frequencyRatio: 2.76 },
    { type: 'sine', gain: 0.13, frequencyRatio: 5.4 },
    { type: 'triangle', gain: 0.22, octave: -1 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.05,
  gainAutomation: (time, gain, call) => [
    { type: 'set', value: gain, time },
    { type: 'exponentialRamp', value: gain * 0.3, time: time + call.decay * 0.18 },
    { type: 'exponentialRamp', value: 0.0004, time: time + call.decay },
  ],
});

/** Gong / low tolling boom for the boss's death and the victory downbeat. */
export const gongVoice = voice<{ velocity: number; decay: number }>({
  oscillators: [
    { type: 'sine' },
    { type: 'sine', gain: 0.6, frequencyRatio: 1.593 },
    { type: 'sine', gain: 0.45, frequencyRatio: 2.14 },
    { type: 'sine', gain: 0.3, frequencyRatio: 2.653 },
    { type: 'sine', gain: 0.18, frequencyRatio: 3.9 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.1,
  filter: { type: 'lowpass', frequency: 2400, Q: 0.4 },
  gainAutomation: (time, gain, call) => [
    { type: 'set', value: 0.0001, time },
    { type: 'linearRamp', value: gain, time: time + 0.02 },
    { type: 'exponentialRamp', value: 0.0004, time: time + call.decay },
  ],
});

/** Sub swell under builds and impacts. */
export const subVoice = voice<{ velocity: number; duration: number }>({
  oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.25, octave: 1 }],
  duration: ({ duration }) => duration,
  stopPadding: 0.05,
  gainAutomation: (time, gain, call) => [
    { type: 'set', value: 0.0001, time },
    { type: 'linearRamp', value: gain, time: time + Math.min(0.08, call.duration * 0.2) },
    { type: 'exponentialRamp', value: 0.0002, time: time + call.duration },
  ],
});

/** Player zap: a fast falling sine, the fire voice's tail. */
export const zapVoice = voice<{ velocity: number; drop: number }>({
  oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.3, octave: 1 }],
  duration: 0.14,
  stopPadding: 0.03,
  frequencyAutomation: (time, frequency, call) => [
    { type: 'set', value: frequency, time },
    { type: 'exponentialRamp', value: frequency * call.drop, time: time + 0.12 },
  ],
  gainAutomation: (time, gain) => [
    { type: 'set', value: gain, time },
    { type: 'exponentialRamp', value: 0.0004, time: time + 0.13 },
  ],
});

export const snareNoise = noiseHit({ filterType: 'bandpass', frequency: 2300, decay: 0.15 });
export const snareBody = voice<{ velocity: number }>({
  oscillators: [{ type: 'triangle' }],
  duration: 0.11,
  stopPadding: 0.02,
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency * 1.4, time },
    { type: 'exponentialRamp', value: frequency, time: time + 0.05 },
  ],
  gainAutomation: (time, gain) => [
    { type: 'set', value: gain, time },
    { type: 'exponentialRamp', value: 0.0004, time: time + 0.1 },
  ],
});
export const cymbalNoise = noiseHit({ filterType: 'highpass', frequency: 5600, decay: 1.5 });
export const tickNoise = noiseHit({ filterType: 'bandpass', frequency: 6500, decay: 0.045 });
export const thumpNoise = noiseHit({ filterType: 'lowpass', frequency: 260, decay: 0.09 });
