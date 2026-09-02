import { noiseHit, voice } from '../../engine/audio-voices';

// Orchestral space opera voices:
// Full orchestra instrumentation: timpani, march snare, crash cymbals,
// heroic high brass, heavy low brass, driving ostinato strings, and lush pads.
// Plus capital ship broadside cannons and transport-quantized player voices.

// 1. Timpani: deep tuned orchestral kettle drum with dynamic pitch bend
export const timpaniVoice = voice({
  oscillators: [
    { type: 'sine', gain: 0.8 },
    { type: 'triangle', gain: 0.25, octave: 1 },
  ],
  duration: 0.55,
  envelope: { attack: 0.004, decay: 0.5, peak: 0.28 },
  frequencyAutomation: (time, freq) => [
    { type: 'set', value: freq * 1.48, time },
    { type: 'exponentialRamp', value: freq, time: time + 0.065 },
  ],
});

// 2. March Snare: crisp military orchestral snare drum
export const snareTone = voice({
  oscillators: [
    { type: 'triangle', gain: 0.6 },
    { type: 'sine', gain: 0.4, frequencyRatio: 1.6 },
  ],
  duration: 0.18,
  envelope: { attack: 0.002, decay: 0.14, peak: 0.14 },
});

export const snareNoise = noiseHit({
  filterType: 'bandpass',
  frequency: 2400,
  decay: 0.14,
});

// 3. Crash Cymbals: shimmering orchestral brass plate
export const cymbalNoise = noiseHit({
  filterType: 'highpass',
  frequency: 5200,
  decay: 1.3,
});

// 4. Low Brass: French horns, trombones, and tubas providing heroic weight
export const lowBrassVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.4 },
    { type: 'square', gain: 0.2, octave: -1 },
  ],
  duration: 0.65,
  filter: {
    type: 'lowpass',
    frequency: 720,
    Q: 2.2,
    frequencyAutomation: (time) => [
      { type: 'set', value: 350, time },
      { type: 'linearRamp', value: 850, time: time + 0.06 },
      { type: 'exponentialRamp', value: 450, time: time + 0.5 },
    ],
  },
  envelope: { attack: 0.045, decay: 0.5, peak: 0.18 },
});

// 5. High Brass: Piercing trumpet fanfares and heroic victory melodies
export const highBrassVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.45 },
    { type: 'square', gain: 0.15, detune: 6 },
  ],
  duration: 0.7,
  filter: {
    type: 'bandpass',
    frequency: 1650,
    Q: 1.8,
    frequencyAutomation: (time) => [
      { type: 'set', value: 800, time },
      { type: 'linearRamp', value: 1900, time: time + 0.04 },
      { type: 'exponentialRamp', value: 1300, time: time + 0.6 },
    ],
  },
  envelope: { attack: 0.025, decay: 0.55, peak: 0.16 },
});

// 6. Strings Ostinato: tight spiccato cellos and violins driving the combat pulse
export const stringsOstinatoVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.4 },
    { type: 'triangle', gain: 0.25, octave: 1 },
  ],
  duration: 0.24,
  filter: { type: 'lowpass', frequency: 1400, Q: 1.2 },
  envelope: { attack: 0.008, decay: 0.2, peak: 0.15 },
});

// 7. Strings Pad: sweeping legato violas/violins for majestic swelling phrases
export const stringsPadVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.3, detune: -7 },
    { type: 'sawtooth', gain: 0.3, detune: 7 },
  ],
  duration: 1.6,
  filter: { type: 'lowpass', frequency: 1100, Q: 0.9 },
  envelope: { attack: 0.22, decay: 1.2, peak: 0.12 },
});

// 8. Capital Ship Broadside Cannon: colossal thunderous broadside discharge
export const broadsideCannonTone = voice({
  oscillators: [
    { type: 'sine', gain: 0.8 },
    { type: 'triangle', gain: 0.3, frequencyRatio: 0.5 },
  ],
  duration: 0.8,
  envelope: { attack: 0.005, decay: 0.7, peak: 0.26 },
  frequencyAutomation: (time, freq) => [
    { type: 'set', value: freq * 2.2, time },
    { type: 'exponentialRamp', value: freq * 0.5, time: time + 0.15 },
  ],
});

export const broadsideCannonNoise = noiseHit({
  filterType: 'lowpass',
  frequency: 450,
  decay: 0.65,
});

// 9. Player Lock: orchestral glockenspiel / harp chime pitched to live harmony
export const playerLockVoice = voice({
  oscillators: [
    { type: 'sine', gain: 0.5 },
    { type: 'triangle', gain: 0.35, octave: 1 },
  ],
  duration: 0.16,
  filter: { type: 'bandpass', frequency: 2800, Q: 1.5 },
  envelope: { attack: 0.002, decay: 0.14, peak: 0.13 },
});

// 10. Player Fire: kinetic torpedo discharge
export const playerFireVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.4 },
    { type: 'triangle', gain: 0.3, frequencyRatio: 1.5 },
  ],
  duration: 0.25,
  frequencyAutomation: (time, freq) => [
    { type: 'set', value: freq * 1.8, time },
    { type: 'exponentialRamp', value: freq * 0.4, time: time + 0.12 },
  ],
  envelope: { attack: 0.003, decay: 0.2, peak: 0.12 },
});

// 11. Player Kill: singing solo trumpet / heroic lead playing written kill lane
export const playerKillVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.45 },
    { type: 'triangle', gain: 0.3, octave: 1 },
  ],
  duration: 0.36,
  filter: { type: 'bandpass', frequency: 2200, Q: 2.0 },
  envelope: { attack: 0.005, decay: 0.3, peak: 0.18 },
});

// 12. Klaxon / Alarm: warning signal for denied release and damage
export const alarmVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.35 },
    { type: 'square', gain: 0.15, detune: 12 },
  ],
  duration: 0.35,
  filter: { type: 'bandpass', frequency: 1100, Q: 3.5 },
  frequencyAutomation: (time, freq) => [
    { type: 'set', value: freq * 1.05, time },
    { type: 'linearRamp', value: freq * 0.95, time: time + 0.3 },
  ],
  envelope: { attack: 0.02, decay: 0.3, peak: 0.14 },
});
