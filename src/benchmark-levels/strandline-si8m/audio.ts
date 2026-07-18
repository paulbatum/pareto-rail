import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { STRANDLINE_SI8M_BPM, STRANDLINE_SI8M_RUN_DURATION } from './gameplay';

const SIXTEENTH = 60 / STRANDLINE_SI8M_BPM / 4; // 16th note duration at 72 BPM
const THIRTYSECOND = SIXTEENTH / 2;

// Slow ambient harmony in A minor, growing to major by the end
const CHORDS = [
  { bass: 33, pad: [57, 60, 64, 69, 72], arp: [69, 72, 76, 79] }, // Am
  { bass: 29, pad: [53, 57, 60, 65, 69], arp: [65, 69, 72, 76] }, // Fmaj
  { bass: 36, pad: [55, 60, 64, 67, 72], arp: [67, 72, 76, 79] }, // Cadd9
  { bass: 31, pad: [55, 59, 62, 67, 71], arp: [67, 71, 74, 79] }, // G
];

const DOCK_CHORDS = [
  { bass: 33, pad: [57, 61, 64, 69, 73], arp: [69, 73, 76, 81] }, // A major
];

export function createAudio(bus: EventBus) {
  const score = createScore({
    bpm: STRANDLINE_SI8M_BPM,
    stepsPerBar: 16,
    chords: CHORDS,
    barsPerChord: 4,
    alternateChordSets: [
      { fromBar: 16, toBar: 18, chords: DOCK_CHORDS, barsPerChord: 2 },
    ],
    sections: [
      { index: 0, fromBar: 0, crossfadeBars: 1 },
      { index: 1, fromBar: 4, crossfadeBars: 1 },
      { index: 2, fromBar: 8, crossfadeBars: 1 },
      { index: 3, fromBar: 12, crossfadeBars: 2 },
    ],
    killLanes: {
      0: [0, 1, 2, 3, 2, 1, 0, 1],
      1: [2, 3, 4, 3, 2, 3, 4, 2],
      2: [4, 5, 6, 5, 4, 5, 6, 4],
      3: [6, 7, 6, 5, 4, 5, 6, 7],
    },
  });

  const runtime = createBeatLevelAudio({
    bus,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.7,
    score,
    mix: {
      compressor: { threshold: -16, ratio: 4, attack: 0.005, release: 0.2 },
    },
    onStep({ position, time, mode }) {
      if (mode === 'run') {
        const chord = score.chordAt(position);
        // Slow ambient pad pulses on downbeat
        const output = runtime.mix()?.music ?? runtime.mix()?.master;
        if (output) {
          playOscillatorVoice({
            context: runtime.context(),
            time,
            stopTime: time + 1.2,
            oscillatorType: 'triangle',
            frequency: midiToFreq(chord.bass + 24),
            gainAutomation: [
              { type: 'set', value: 0.06, time },
              { type: 'exponentialRamp', value: 0.001, time: time + 1.2 },
            ],
            filter: { type: 'lowpass', frequency: 1200 },
            destination: output,
          });
        }
      }
    },
  });

  const sfxDest = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // Player instruments: green-gold bioluminescent tones
  const playerTone = voice<{ midi: number; gain: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gain }) => gain }],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 3200 },
    gainAutomation: (time, _gain, { gain, decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killTone = voice<{ midi: number; gain: number; decay: number }>({
    oscillators: [{ type: 'sine', gain: ({ gain }) => gain }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 4000 },
    gainAutomation: (time, _gain, { gain, decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.05 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 6, frequency: 480 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  const missVoice = voice<{ midi: number; gain: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gain }) => gain }],
    duration: 0.12,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 1800 },
    gainAutomation: (time, _gain, { gain }) => [
      { type: 'set', value: gain * 0.3, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
    ],
  });

  const hitVoice = voice<{ midi: number; gain: number }>({
    oscillators: [{ type: 'sine', gain: ({ gain }) => gain }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3000 },
    gainAutomation: (time, _gain, { gain }) => [
      { type: 'set', value: gain * 0.4, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
    ],
  });

  bus.on('lock', ({ lockCount }) => {
    const ctx = runtime.context();
    const time = score.quantizePlayerAction(ctx?.currentTime ?? 0);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const midi = chord.arp[Math.min(lockCount - 1, chord.arp.length - 1)];
    const output = sfxDest();
    if (ctx && output) {
      playerTone.play({ context: ctx, time, midi, gain: 0.1, decay: 0.1, destination: output });
    }
  });

  bus.on('fire', ({ indexInVolley }) => {
    const ctx = runtime.context();
    const time = score.quantizePlayerAction(ctx?.currentTime ?? 0);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const midi = chord.arp[(indexInVolley ?? 0) % chord.arp.length];
    const output = sfxDest();
    if (ctx && output) {
      playerTone.play({ context: ctx, time, midi, gain: 0.08, decay: 0.06, destination: output });
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const ctx = runtime.context();
    const killTime = score.nextKill(ctx?.currentTime ?? 0);
    const position = Math.max(0, killTime.step - score.arrangementStart);
    const leadSet = score.leadSetAt(position);
    const lane = score.killLaneAt(position);
    const midi = lane !== undefined ? leadSet[lane] : leadSet[0];
    const output = sfxDest();
    if (ctx && output) {
      killTone.play({ context: ctx, time: killTime.time, midi, gain: 0.14, decay: 0.28, destination: output });
    }
  });

  bus.on('hit', () => {
    const ctx = runtime.context();
    const time = score.nextGridTime(ctx?.currentTime ?? 0, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const midi = chord.stab[0];
    const output = sfxDest();
    if (ctx && output) {
      hitVoice.play({ context: ctx, time, midi: midi + 12, gain: 0.08, destination: output });
    }
  });

  bus.on('miss', () => {
    const ctx = runtime.context();
    const time = ctx?.currentTime ?? 0;
    const output = sfxDest();
    if (ctx && output) {
      missVoice.play({ context: ctx, time, midi: 48, gain: 0.05, destination: output });
    }
  });

  bus.on('reject', () => {
    const ctx = runtime.context();
    const time = ctx?.currentTime ?? 0;
    const output = sfxDest();
    if (ctx && output) {
      rejectVoice.play({ context: ctx, time, frequency: 196, vel: 0.13, destination: output });
    }
  });

  return runtime.audio;
}
export { createAudio };
