import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, hits, oneShot, fn } from '../../engine/arrangement';
import { midiToFreq, secondsPerStep } from '../../engine/music';
import { createScore } from '../../engine/score';
import { STRANDLINE_DE7D_BPM, STRANDLINE_DE7D_RUN_DURATION } from './gameplay';

const BPM = STRANDLINE_DE7D_BPM;
const STEPS = 16;
const STEP = secondsPerStep(BPM, 16);

const CHORDS = [
  { root: 45, pad: [57, 62, 67, 69], arp: [69, 72, 76, 79] },
  { root: 41, pad: [53, 57, 62, 65], arp: [65, 69, 72, 76] },
  { root: 48, pad: [60, 65, 69, 72], arp: [72, 76, 81, 84] },
  { root: 43, pad: [55, 60, 64, 67], arp: [67, 71, 74, 77] },
];

const KILL_LANES = [
  [0, 1, 2, 3, 4, 3, 2, 1, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0, 1],
];

export function createAudio(bus: EventBus) {
  const score = createScore({
    bpm: BPM,
    stepsPerBar: STEPS,
    chords: CHORDS,
    barsPerChord: 2,
    sections: [
      { index: 0, fromBar: 0 },
      { index: 1, fromBar: 8 },
      { index: 2, fromBar: 16 },
      { index: 3, fromBar: 22 },
      { index: 4, fromBar: 24 },
    ],
    killLanes: {
      0: [
        0, 1, 2, 3, 4, 3, 2, 1, 4, 5, 6, 5, 4, 3, 2, 1,
        0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0, 1,
      ],
      1: [
        0, 1, 2, 3, 4, 3, 2, 1, 4, 5, 6, 5, 4, 3, 2, 1,
        0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0, 1,
      ],
      2: [
        7, 6, 5, 4, 7, 6, 5, 4, 5, 4, 3, 2, 5, 4, 3, 2,
        3, 2, 1, 0, 3, 2, 1, 0, 4, 5, 6, 7, 4, 5, 6, 7,
      ],
      3: [
        0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0, 1,
        4, 3, 2, 1, 4, 5, 6, 7, 3, 2, 1, 0, 2, 3, 4, 5,
      ],
      4: [
        3, 2, 1, 0, 3, 2, 1, 0, 4, 5, 6, 7, 4, 5, 6, 7,
        3, 4, 5, 6, 7, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7,
      ],
    },
  });

  const runtime = createBeatLevelAudio({
    bus,
    stepSeconds: STEP,
    score,
    runAlignment: 'bar',
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
      delay: { time: STEP * 3, feedback: 0.35, dampHz: 2600 },
    },
    onRunStart() {
      score.clearOverride();
    },
    onStep({ position }) {
    },
  });

  const ctxRef: { ctx: AudioContext | null } = { ctx: null };
  const audio = runtime.audio;
  (audio as any).onPostBuild = (context: AudioContext) => {
    ctxRef.ctx = context;
  };

  const mixBus = runtime.mix();
  const master = () => mixBus?.master ?? null;
  const delaySend = () => mixBus?.delaySend ?? null;

  const lockVoice = voice<{ midi: number; lockCount: number; weight: number }>({
    oscillators: [{ type: 'triangle', gain: 0.1 }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 2400 },
    envelope: { decay: 0.08 },
  });

  const fireVoice = voice<{ midi: number; weight: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.08 }],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3200 },
    envelope: { decay: 0.07 },
  });

  const killLayerVoice = voice<{ midi: number; decay: number; gain: number; shimmer: number; weight: number }>({
    oscillators: [{ type: 'sine', gain: ({ gain }) => gain }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 3400 },
    envelope: { decay: ({ decay }) => decay },
  });

  const rejectVoice = voice<{ vel: number; filterStart: number; filterEnd: number; weight: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.1 }],
    duration: 0.2,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 5,
      frequencyAutomation: (time, { filterStart, filterEnd }) => [
        { type: 'set', value: filterStart, time },
        { type: 'exponentialRamp', value: filterEnd, time: time + 0.15 },
      ],
    },
    gainAutomation: (time, _g, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });

  bus.on('lock', ({ lockCount }) => {
    const ctx = ctxRef.ctx;
    const out = master();
    if (!ctx || !out) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const pos = score.arrangementPositionAt(time);
    const chord = score.chordAt(pos);
    const midi = chord.arp[0];
    lockVoice.play({ context: ctx, time, midi: midi + 12, lockCount, weight: 1, destination: out, sends: delaySend() ? [{ destination: delaySend() as AudioNode, gain: 0.3 }] : [] });
  });

  bus.on('fire', () => {
    const ctx = ctxRef.ctx;
    const out = master();
    if (!ctx || !out) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const pos = score.arrangementPositionAt(time);
    const chord = score.chordAt(pos);
    const midi = chord.root + 36;
    fireVoice.play({ context: ctx, time, midi, weight: 1, destination: out, sends: delaySend() ? [{ destination: delaySend() as AudioNode, gain: 0.25 }] : [] });
  });

  bus.on('kill', ({ indexInVolley }) => {
    const ctx = ctxRef.ctx;
    const out = master();
    if (!ctx || !out) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const pos = score.arrangementPositionAt(time);
    const chord = score.chordAt(pos);
    const lane = KILL_LANES[0][(pos % 32) | 0];
    const leadSet = score.leadSetAt(pos);
    const midi = leadSet ? leadSet[lane % leadSet.length] : chord.arp[0];
    const vel = Math.min(1.2, 1 + (indexInVolley ?? 0) * 0.12);
    const dec = 0.35 + (indexInVolley ?? 0) * 0.05;
    killLayerVoice.play({ context: ctx, time, midi: midi, decay: dec, gain: 0.18, shimmer: 0.4, weight: 1, destination: out, sends: delaySend() ? [{ destination: delaySend() as AudioNode, gain: 0.45 }] : [] });
  });

  bus.on('reject', () => {
    const ctx = ctxRef.ctx;
    const out = master();
    if (!ctx || !out) return;
    const time = ctx.currentTime;
    rejectVoice.play({ context: ctx, time, frequency: 330, frequencyAutomation: [{ type: 'exponentialRamp', value: 92, time: time + 0.18 }], vel: 0.18, filterStart: 1100, filterEnd: 430, weight: 1, destination: out });
    rejectVoice.play({ context: ctx, time: time + 0.025, frequency: 233, frequencyAutomation: [{ type: 'exponentialRamp', value: 61, time: time + 0.2 }], vel: 0.13, filterStart: 1100, filterEnd: 430, weight: 1, destination: out });
  });

  bus.on('playerhit', () => {
    const ctx = ctxRef.ctx;
    const out = master();
    if (!ctx || !out) return;
    const time = ctx.currentTime;
    playOscillatorVoice({ context: ctx, time, stopTime: time + 0.4, oscillatorType: 'sine', frequency: 96, frequencyAutomation: [{ type: 'exponentialRamp', value: 34, time: time + 0.28 }], gainAutomation: [{ type: 'set', value: 0.4, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.38 }], destination: out });
  });

  bus.on('miss', () => {
    const ctx = ctxRef.ctx;
    const out = master();
    if (!ctx || !out) return;
    const time = ctx.currentTime;
    playOscillatorVoice({ context: ctx, time, stopTime: time + 0.12, oscillatorType: 'triangle', frequency: 130, frequencyAutomation: [{ type: 'exponentialRamp', value: 68, time: time + 0.09 }], gainAutomation: [{ type: 'set', value: 0.06, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.11 }], destination: out });
  });

  return audio;
}
