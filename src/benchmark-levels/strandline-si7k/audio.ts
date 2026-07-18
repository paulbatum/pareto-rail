import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp } from '../../engine/score';
import { STRANDLINE_SI7K_BPM, STRANDLINE_SI7K_TIME } from './gameplay';

const BPM = STRANDLINE_SI7K_BPM;
const STEP = STRANDLINE_SI7K_TIME.stepSeconds;

// A slow, water-deep minor progression: Am -> Fmaj7 -> Cmaj7 -> G6
// Each chord lasts 2 bars (4 beats in 4/4 at 96 BPM = 10 sec per chord pair)
const CHORDS = [
  { root: 57, name: 'Am7', notes: [57, 60, 64, 67] },
  { root: 53, name: 'Fmaj7', notes: [53, 57, 60, 64] },
  { root: 52, name: 'Cmaj7', notes: [52, 55, 60, 64] },
  { root: 55, name: 'G6', notes: [55, 59, 62, 64] },
];

const SECTIONS = [
  { index: 0, fromBar: 0, crossfadeBars: 2 },
  { index: 1, fromBar: 8, crossfadeBars: 2 },
  { index: 2, fromBar: 16, crossfadeBars: 2 },
] as const;

const KILL_LANES = {
  0: [0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 3, 2, 2],
  1: [0, 3, 2, 1, 4, 2, 3, 1, 0, 4, 3, 2, 5, 4, 3, 4],
  2: [5, 4, 3, 2, 4, 3, 2, 1, 3, 2, 1, 0, 3, 4, 5, 4],
} as const;

export function createAudio(bus: EventBus) {
  const score = createScore({
    bpm: BPM,
    stepsPerBar: 16,
    chords: CHORDS,
    barsPerChord: 2,
    sections: SECTIONS,
    killLanes: KILL_LANES,
    leadSet(chord) {
      const notes = chord.notes;
      return [...notes, ...notes.map((n) => n + 12)];
    },
  });

  const runtime = createBeatLevelAudio({
    bus,
    stepSeconds: STEP,
    mix: {
      compressor: { threshold: -18, ratio: 4, attack: 0.006, release: 0.25 },
      delay: { time: STEP * 3, feedback: 0.32, dampHz: 2400 },
      noiseSeconds: 2.5,
    },
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    volumeScale: 0.7,
    onStep({ mode, position }) {
      if (mode === 'ambient') {
        scheduleAmbient(position, score);
      } else {
        scheduleRun(position, score);
      }
    },
    onRunStart() {
      score.setEpoch(runtime.context()?.currentTime ?? 0);
      score.restartArrangement(0, { align: 'bar' });
    },
    onRunEnd() {
      score.clearOverride();
    },
  });

  const ctx = () => runtime.context();
  const sfxDest = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const delaySend = () => runtime.mix()?.delaySend ?? null;

  // ----- player instruments -----
  const killLayerVoice = voice<{ decay: number; gain: number; cutoff: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gain }) => gain }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const killBodyVoice = voice<{ gain: number; decay: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.55 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const lockVoice = voice<{ cutoff: number; gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.1 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.08 }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.14,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3400 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const rejectVoice = voice<{ vel: number; filterStart: number; filterEnd: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.24,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 5,
      frequencyAutomation: (time, { filterStart, filterEnd }) => [
        { type: 'set', value: filterStart, time },
        { type: 'exponentialRamp', value: filterEnd, time: time + 0.18 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const impactBoomVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.4,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 34, time: time + 0.28 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.42, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
    ],
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.15,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 68, time: time + 0.12 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.05, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  // ----- kill melody -----
  bus.on('kill', ({ indexInVolley }) => {
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    const ds = delaySend();
    const mix = runtime.mix();
    if (!c || !out) return;
    const kill = score.nextKill(c.currentTime);
    const midi = kill.midi;
    const dec = 0.36;
    const gain = 0.16;
    killLayerVoice.play({ context: c, time: kill.time, midi, decay: dec, gain, cutoff: 3000, destination: out, sends: ds ? [{ destination: ds, gain: 0.4 }] : undefined });
    killBodyVoice.play({ context: c, time: kill.time, midi, decay: dec, gain: gain * 0.55, destination: out });
    if (indexInVolley && indexInVolley >= 2) {
      killLayerVoice.play({ context: c, time: kill.time + 0.04, midi: midi + 12, decay: 0.3, gain: gain * 0.6, cutoff: 3200, destination: out, sends: ds ? [{ destination: ds, gain: 0.35 }] : undefined });
    }
  });

  // ----- lock -----
  bus.on('lock', ({ lockCount }) => {
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    const ds = delaySend();
    if (!out) return;
    const time = score.quantizePlayerAction(c.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const midi = chord.notes[Math.min(lockCount - 1, chord.notes.length - 1)];
    lockVoice.play({ context: c, time, midi, cutoff: 2400, gainValue: 0.11, destination: out, sends: ds ? [{ destination: ds, gain: 0.35 }] : undefined });
  });

  // ----- fire -----
  bus.on('fire', () => {
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    if (!out) return;
    const time = score.quantizePlayerAction(c.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = chord.root;
    fireVoice.play({ context: c, time, midi: root + 36, cutoff: 2600, destination: out });
  });

  // ----- hit (non-lethal) -----
  bus.on('hit', ({ lethal }) => {
    if (lethal) return;
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    const ds = delaySend();
    if (!out) return;
    const time = score.quantizePlayerAction(c.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    chipVoice.play({ context: c, time, midi: chord.notes[0] + 12, vel: 0.08, destination: out, sends: ds ? [{ destination: ds, gain: 0.3 }] : undefined });
  });

  // ----- reject -----
  bus.on('reject', () => {
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    if (!out) return;
    const time = c.currentTime;
    for (const [start, end, at, vel] of [
      [330, 92, time, 0.18],
      [233, 61, time + 0.028, 0.13],
    ] as const) {
      rejectVoice.play({ context: c, time: at, frequency: start, vel, filterStart: 1100, filterEnd: 430, destination: out });
    }
  });

  // ----- miss -----
  bus.on('miss', () => {
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    if (!out) return;
    missVoice.play({ context: c, time: c.currentTime, frequency: 130, destination: out });
  });

  // ----- spawn visual pulse (audio hint) -----
  bus.on('spawn', () => {
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    if (!out) return;
    // Gentle plink for each spawn
    try {
      const chord = score.chordAt(score.arrangementPositionAt(c.currentTime));
      const midi = chord.notes[0];
      playOscillatorVoice({
        context: c,
        time: c.currentTime,
        stopTime: c.currentTime + 0.06,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi + 18),
        gainAutomation: [
          { type: 'set', value: 0.04, time: c.currentTime },
          { type: 'exponentialRamp', value: 0.001, time: c.currentTime + 0.06 },
        ],
        destination: out,
      });
    } catch (e) { /* ignore */ }
  });

  // ----- boss spawn: rising alarm and override section 2 -----
  bus.on('spawn', ({ kind }) => {
    if (kind !== 'parent') return;
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    const ds = delaySend();
    if (!out) return;
    score.overrideSection(2);
    const time = score.nextGridTime(c.currentTime);
    [57, 63].forEach((midi, index) => {
      playOscillatorVoice({
        context: c,
        time: time + index * 0.42,
        stopTime: time + index * 0.42 + 0.55,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1600 },
        gainAutomation: [
          { type: 'set', value: 0.14, time: time + index * 0.42 },
          { type: 'exponentialRamp', value: 0.001, time: time + index * 0.42 + 0.5 },
        ],
        destination: out,
        sends: ds ? [{ destination: ds, gain: 0.5 }] : undefined,
      });
    });
  });

  // ----- playerhit -----
  bus.on('playerhit', () => {
    const c = ctx();
    if (!c) return;
    const out = sfxDest();
    if (!out) return;
    const time = c.currentTime;
    impactBoomVoice.play({ context: c, time, frequency: 96, destination: out });
    [63, 69].forEach((midi) => {
      playOscillatorVoice({
        context: c,
        time,
        stopTime: time + 0.24,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.07, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
        ],
        destination: out,
      });
    });
  });

  // ----- ambient/run scheduling -----
  function scheduleAmbient(position: number, scoreObj: ReturnType<typeof createScore>) {
    // Minimal ambient: soft pad on chord root
    const chord = scoreObj.chordAt(position);
    const time = (position / 16) * STEP; // approximate for scheduling reference
    // We don't schedule directly here; arrangement handles it if added.
  }
  function scheduleRun(position: number, scoreObj: ReturnType<typeof createScore>) {
    // Minimal drive: simple pulse
  }

  return runtime.audio ?? runtime;
}

