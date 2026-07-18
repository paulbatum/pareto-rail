import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createBroadsideVoices } from './audio-voices';
import {
  BROADSIDE_BARS,
  BROADSIDE_BPM,
  BROADSIDE_SCORE_SECTIONS,
  BROADSIDE_STEPS_PER_BAR,
  BROADSIDE_TIME,
} from './timing';

// Space opera, synthesized: brass and strings over timpani, swelling with
// each push across the battle and dropping to near silence in the eye. The
// player is the soloist — locks are pizzicato plucks off the live chord,
// kills walk hidden per-section melody lanes so a chained volley performs a
// fanfare run, and the flagship's death lands as a scheduled D-major peal
// that ducks the whole orchestra for a breath.

const SIXTEENTH = BROADSIDE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = BROADSIDE_STEPS_PER_BAR;
const LANE_STEPS = 32; // two bars — one full chord

// D minor, scored for the fleet: i–VI–III–VII at cruise, i–VI–VII down the
// broadside, a suspended ninth becalmed in the eye, and i–iv–VI–V from the
// flagship to the end.
const CHORDS = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74] }, // Dm
  { bass: 34, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70] }, // Bb
  { bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] }, // F
  { bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72] }, // C
];
type Chord = typeof CHORDS[number];

const BROADSIDE_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74] }, // Dm
  { bass: 34, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70] }, // Bb
  { bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72] }, // C
];
const EYE_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 64], arp: [62, 64, 69, 76] }, // Dm(add9)
];
const WAR_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74] }, // Dm
  { bass: 31, pad: [50, 55, 58, 62], arp: [62, 67, 70, 74] }, // Gm
  { bass: 34, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70] }, // Bb
  { bass: 33, pad: [49, 52, 57, 61], arp: [61, 64, 69, 73] }, // A
];

// Hidden kill-melody lanes: degrees 0–7 into the live lead set (arp plus the
// octave above), one lane per act, 32 steps over the two-bar chord.
type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Launch/gauntlet — a heroic stepwise arch.
  0: [
    0, 1, 2, 3, 4, 3, 2, 3,
    4, 5, 4, 3, 4, 5, 6, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 2, 1,
  ],
  // Broadside — fanfare leaps; dense volleys ring like a brass section.
  1: [
    0, 4, 2, 6, 4, 7, 5, 7,
    0, 4, 2, 6, 4, 2, 5, 3,
    7, 4, 6, 3, 5, 2, 4, 1,
    3, 6, 4, 7, 5, 6, 7, 4,
  ],
  // The eye — barely moving, close intervals, low.
  2: [
    2, 1, 0, 1, 2, 3, 2, 1,
    0, 1, 2, 3, 4, 3, 2, 1,
    2, 1, 0, 1, 2, 3, 4, 3,
    2, 1, 2, 3, 2, 1, 0, 1,
  ],
  // The belly — dark zig-zags under the keel.
  3: [
    0, 3, 1, 4, 2, 5, 3, 6,
    4, 1, 5, 2, 6, 3, 7, 4,
    0, 3, 1, 4, 2, 5, 3, 6,
    7, 5, 6, 4, 5, 3, 4, 2,
  ],
  // The flagship — descending peals, alarm bells falling.
  4: [
    7, 6, 5, 4, 7, 6, 5, 4,
    6, 5, 4, 3, 6, 5, 4, 3,
    5, 4, 3, 2, 5, 4, 3, 2,
    4, 5, 6, 7, 6, 5, 4, 3,
  ],
  // The trench — runs climbing to the kill.
  5: [
    0, 1, 2, 3, 4, 5, 6, 7,
    1, 2, 3, 4, 5, 6, 7, 6,
    2, 3, 4, 5, 6, 7, 6, 5,
    4, 5, 6, 7, 6, 7, 6, 7,
  ],
};

// Per-act voicing for the player's instruments. Gains tuned by perceived
// loudness: squares and saws are set well below sines and triangles.
const SECTION_VOICES: Record<SectionIndex, {
  kill: { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number };
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'triangle', decay: 0.34, cutoff: 2700, gain: 0.17, shimmer: 0.3 },
    lock: { oscillator: 'triangle', cutoff: 2400, gain: 0.12 },
    fire: { cutoff: 2100, noise: 0.035 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.27, cutoff: 3100, gain: 0.14, shimmer: 0.5 },
    lock: { oscillator: 'square', cutoff: 2100, gain: 0.055 },
    fire: { cutoff: 3000, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'sine', decay: 0.55, cutoff: 2100, gain: 0.16, shimmer: 0.2 },
    lock: { oscillator: 'sine', cutoff: 2000, gain: 0.12 },
    fire: { cutoff: 1500, noise: 0.02 },
  },
  3: {
    kill: { oscillator: 'square', decay: 0.22, cutoff: 1950, gain: 0.13, shimmer: 0.35 },
    lock: { oscillator: 'square', cutoff: 1750, gain: 0.05 },
    fire: { cutoff: 2600, noise: 0.045 },
  },
  4: {
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 2650, gain: 0.15, shimmer: 0.55 },
    lock: { oscillator: 'sawtooth', cutoff: 2000, gain: 0.05 },
    fire: { cutoff: 3600, noise: 0.06 },
  },
  5: {
    kill: { oscillator: 'sawtooth', decay: 0.36, cutoff: 3400, gain: 0.16, shimmer: 0.7 },
    lock: { oscillator: 'sawtooth', cutoff: 2400, gain: 0.055 },
    fire: { cutoff: 4200, noise: 0.07 },
  },
};

type MelodyNote = { bar: number; step: number; midi: number; durSteps: number; vel: number; bright?: number };

// The launch fanfare and the broadside theme share their opening shape —
// the theme is the fanfare come back with the whole section behind it.
const LAUNCH_FANFARE: MelodyNote[] = [
  { bar: 0, step: 0, midi: 62, durSteps: 6, vel: 0.85, bright: 0.55 },
  { bar: 0, step: 8, midi: 69, durSteps: 3, vel: 0.9, bright: 0.65 },
  { bar: 0, step: 12, midi: 74, durSteps: 3, vel: 0.95, bright: 0.75 },
  { bar: 1, step: 0, midi: 72, durSteps: 10, vel: 0.9, bright: 0.65 },
  { bar: 1, step: 12, midi: 69, durSteps: 3, vel: 0.75, bright: 0.5 },
  { bar: 2, step: 0, midi: 70, durSteps: 6, vel: 0.85, bright: 0.6 },
  { bar: 2, step: 8, midi: 65, durSteps: 3, vel: 0.75, bright: 0.5 },
  { bar: 2, step: 12, midi: 70, durSteps: 3, vel: 0.8, bright: 0.55 },
  { bar: 3, step: 0, midi: 69, durSteps: 14, vel: 0.95, bright: 0.8 },
];

const BROADSIDE_THEME: MelodyNote[] = [
  { bar: 0, step: 0, midi: 62, durSteps: 6, vel: 1, bright: 0.8 },
  { bar: 0, step: 8, midi: 69, durSteps: 3, vel: 1, bright: 0.85 },
  { bar: 0, step: 12, midi: 74, durSteps: 3, vel: 1.05, bright: 0.9 },
  { bar: 1, step: 0, midi: 72, durSteps: 10, vel: 1, bright: 0.85 },
  { bar: 1, step: 12, midi: 69, durSteps: 3, vel: 0.85, bright: 0.7 },
  { bar: 2, step: 0, midi: 70, durSteps: 6, vel: 0.95, bright: 0.8 },
  { bar: 2, step: 8, midi: 65, durSteps: 3, vel: 0.85, bright: 0.65 },
  { bar: 2, step: 12, midi: 70, durSteps: 3, vel: 0.9, bright: 0.7 },
  { bar: 3, step: 0, midi: 69, durSteps: 12, vel: 1, bright: 0.85 },
  { bar: 3, step: 12, midi: 67, durSteps: 3, vel: 0.8, bright: 0.6 },
  { bar: 4, step: 0, midi: 67, durSteps: 4, vel: 0.9, bright: 0.7 },
  { bar: 4, step: 4, midi: 69, durSteps: 4, vel: 0.92, bright: 0.75 },
  { bar: 4, step: 8, midi: 71, durSteps: 4, vel: 0.95, bright: 0.8 },
  { bar: 4, step: 12, midi: 72, durSteps: 3, vel: 1, bright: 0.85 },
  { bar: 5, step: 0, midi: 76, durSteps: 8, vel: 1.05, bright: 0.9 },
  { bar: 5, step: 8, midi: 74, durSteps: 8, vel: 0.95, bright: 0.75 },
];

// The eye: one horn, almost alone.
const EYE_HORN: MelodyNote[] = [
  { bar: 0, step: 0, midi: 62, durSteps: 8, vel: 0.55 },
  { bar: 0, step: 10, midi: 57, durSteps: 5, vel: 0.45 },
  { bar: 1, step: 0, midi: 65, durSteps: 6, vel: 0.5 },
  { bar: 1, step: 8, midi: 64, durSteps: 4, vel: 0.45 },
  { bar: 1, step: 12, midi: 62, durSteps: 4, vel: 0.4 },
];

// The trench: brass climbing a rung per bar to the flagship's core.
const TRENCH_CLIMB: MelodyNote[] = [
  { bar: 0, step: 0, midi: 69, durSteps: 14, vel: 0.8, bright: 0.7 },
  { bar: 1, step: 0, midi: 74, durSteps: 14, vel: 0.88, bright: 0.78 },
  { bar: 2, step: 0, midi: 77, durSteps: 14, vel: 0.95, bright: 0.85 },
  { bar: 3, step: 0, midi: 79, durSteps: 12, vel: 1.05, bright: 0.92 },
];

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-b4kd',
  bpm: BROADSIDE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let flagshipDestroyed = false;
  // Boss parts get an escalating anvil; map ids to their full hit points.
  const heavyIds = new Map<number, { maxHp: number }>();

  const score = createScore<Chord, SectionIndex>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { chords: BROADSIDE_CHORDS, fromBar: BROADSIDE_BARS.broadside, toBar: BROADSIDE_BARS.eye, barsPerChord: 2 },
      { chords: EYE_CHORDS, fromBar: BROADSIDE_BARS.eye, toBar: BROADSIDE_BARS.belly, barsPerChord: 2 },
      { chords: WAR_CHORDS, fromBar: BROADSIDE_BARS.flagship, barsPerChord: 2 },
    ],
    sections: BROADSIDE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.006, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.26, dampHz: 2300 },
      reverb: { seconds: 2.6, decay: 2.3, level: 0.22 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      flagshipDestroyed = false;
      heavyIds.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      // The last chord: D major if the flagship burned, D minor if it holds.
      const padMidis = flagshipDestroyed ? [50, 54, 57, 62, 66] : [50, 53, 57, 62];
      voices.stringsPad(context.currentTime + 0.06, padMidis, 4.5, 0.85);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createBroadsideVoices({ trace, context: () => ctx, mix: runtime.mix });
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- player voices ---------------------------------------------------------

  const killLayerVoice = voice<{ killVoice: typeof SECTION_VOICES[SectionIndex]['kill'] }>({
    oscillators: [{ type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain }],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { decay: ({ killVoice }) => killVoice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.55 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.4 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  // Lock: a pizzicato pluck walking up the live chord with each lock.
  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.09,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 190 },
    envelope: { decay: 0.09 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.085 }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  // Reject: a muted-horn flub — dry, dissonant, unmistakably not a hit.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.22,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 4.5,
      frequencyAutomation: (time) => [
        { type: 'set', value: 950, time },
        { type: 'exponentialRamp', value: 380, time: time + 0.17 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.13,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  const impactBoomVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.42,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 32, time: time + 0.3 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.44, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  const impactStabVoice = voice({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    gainAutomation: (time) => [
      { type: 'set', value: 0.06, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  // ---- arrangement -----------------------------------------------------------

  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const padOdd = blankBar + 'P...............';

  function padTrack(fromBar: number, vel = 0.8): ArrangementTrack<Chord> {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) =>
      voices.stringsPad(time, chord.pad, LANE_STEPS * SIXTEENTH * 1.05, vel));
  }

  function timpaniTrack(pattern: string): ArrangementTrack<Chord> {
    return hits<Chord>(pattern, { T: 1, t: 0.7, f: 0.75 }, ({ time, chord }, vel, symbol) =>
      voices.timpani(time, symbol === 'f' ? chord.bass + 7 : chord.bass, vel));
  }

  function snareTrack(pattern: string): ArrangementTrack<Chord> {
    return hits(pattern, { S: 1, s: 0.55 }, ({ time }, vel) => voices.snare(time, vel));
  }

  function bassTrack(pattern: string): ArrangementTrack<Chord> {
    return hits<Chord>(pattern, { B: 1, b: 0.75, u: 0.7, f: 0.72 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0;
      voices.bassNote(time, chord.bass + offset, vel);
    });
  }

  // The string ostinato: eighth notes cycling chord tones an octave down.
  function ostinatoTrack(vel: number, cutoff: number, order: number[]): ArrangementTrack<Chord> {
    return fn<Chord>((context) => {
      if (context.step % 2 !== 0) return;
      const index = order[(context.step / 2) % order.length];
      const accent = context.step === 0 ? 1.25 : context.step === 8 ? 1.1 : 1;
      voices.stringsShort(context.time, context.chord.arp[index] - 12, vel * accent, cutoff);
    });
  }

  function melodyTrack(notes: MelodyNote[], instrument: 'brass' | 'horn'): ArrangementTrack<Chord> {
    return fn<Chord>((context) => {
      for (const note of notes) {
        if (context.barInSection !== note.bar || context.step !== note.step) continue;
        const duration = note.durSteps * SIXTEENTH;
        if (instrument === 'brass') voices.brass(context.time, note.midi, duration, note.vel, note.bright ?? 0.6);
        else voices.horn(context.time, note.midi, duration, note.vel);
      }
    });
  }

  function brassStabTrack(pattern: string): ArrangementTrack<Chord> {
    return hits<Chord>(pattern, { B: 0.9, b: 0.65 }, ({ time, chord }, vel) => {
      voices.brass(time, chord.pad[2] + 12, 0.16, vel, 0.75);
      voices.brass(time, chord.pad[0] + 12, 0.16, vel * 0.8, 0.6);
    });
  }

  function cannonTrack(pattern: string): ArrangementTrack<Chord> {
    return hits(pattern, { C: 1, c: 0.6 }, ({ time }, vel, symbol) => voices.cannon(time, vel, symbol === 'c'));
  }

  function tickTrack(pattern: string): ArrangementTrack<Chord> {
    return hits(pattern, { x: 1, X: 1.6 }, ({ time }, vel) => voices.tick(time, vel));
  }

  const marchOrder = [0, 2, 1, 2, 0, 2, 1, 3];
  const driveOrder = [0, 1, 2, 3, 2, 1, 2, 3];
  const trenchOrder = [0, 2, 1, 3, 2, 0, 3, 1];

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'launch',
        fromBar: BROADSIDE_BARS.launch,
        toBar: BROADSIDE_BARS.gauntlet,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            voices.timpaniRoll(time, 38, 0.8, 0.7);
            voices.cymbal(time, 1.1, 0.8);
          }),
          melodyTrack(LAUNCH_FANFARE, 'brass'),
          padTrack(0, 0.7),
          timpaniTrack('T.......t.......'),
          bassTrack('B...............'),
          oneShot(3, 8, ({ time }) => voices.riser(time, 8 * SIXTEENTH)),
        ],
      },
      {
        name: 'gauntlet',
        fromBar: BROADSIDE_BARS.gauntlet,
        toBar: BROADSIDE_BARS.broadside,
        tracks: [
          oneShot(0, 0, ({ time }) => voices.cymbal(time, 0.9, 0.6)),
          padTrack(BROADSIDE_BARS.gauntlet, 0.75),
          timpaniTrack('T.......t.....f.'),
          snareTrack('....S.......S..s'),
          ostinatoTrack(0.5, 1700, marchOrder),
          bassTrack('B......b......u.'),
          fn<Chord>((context) => {
            if (context.barInSection % 2 !== 0 || context.step !== 8) return;
            voices.horn(context.time, context.chord.pad[3], SIXTEENTH * 10, 0.4);
          }),
          oneShot(5, 0, ({ time }) => voices.riser(time, STEPS_PER_BAR * SIXTEENTH)),
        ],
      },
      {
        name: 'broadside',
        fromBar: BROADSIDE_BARS.broadside,
        toBar: BROADSIDE_BARS.eye,
        tracks: [
          oneShot(0, 0, ({ time }) => voices.cymbal(time, 1.3, 1.1)),
          melodyTrack(BROADSIDE_THEME, 'brass'),
          padTrack(BROADSIDE_BARS.broadside, 0.9),
          timpaniTrack('T.....t.T.....t.'),
          snareTrack('....S..s....S.ss'),
          ostinatoTrack(0.7, 2200, driveOrder),
          bassTrack('B...b...B...b...'),
          cannonTrack('C.......c.......'),
        ],
      },
      {
        name: 'eye',
        fromBar: BROADSIDE_BARS.eye,
        toBar: BROADSIDE_BARS.belly,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => voices.stringsPad(time, chord.pad, LANE_STEPS * SIXTEENTH, 0.55)),
          melodyTrack(EYE_HORN, 'horn'),
          oneShot(1, 6, ({ time }) => voices.cannon(time, 0.7, true)),
        ],
      },
      {
        name: 'belly',
        fromBar: BROADSIDE_BARS.belly,
        toBar: BROADSIDE_BARS.flagship,
        tracks: [
          padTrack(BROADSIDE_BARS.belly, 0.5),
          hits<Chord>('T...............t...............', { T: 0.85, t: 0.6 }, ({ time, chord }, vel) =>
            voices.timpani(time, chord.bass, vel)),
          fn<Chord>((context) => {
            if (context.step % 2 !== 0) return;
            const pattern = [1, 0, 0, 1, 0, 1, 0, 0];
            if (!pattern[(context.step / 2) % 8]) return;
            voices.stringsShort(context.time, context.chord.pad[context.barInSection % 2 === 0 ? 0 : 1] - 12, 0.55, 950);
          }),
          tickTrack('x..x..x...x.x...'),
          snareTrack('............s.ss'),
          fn<Chord>((context) => {
            if (context.barInSection % 2 !== 1 || context.step !== 0) return;
            voices.horn(context.time, context.chord.pad[0], SIXTEENTH * 12, 0.42);
          }),
          oneShot(5, 0, ({ time }) => voices.riser(time, STEPS_PER_BAR * SIXTEENTH)),
        ],
      },
      {
        name: 'flagship',
        fromBar: BROADSIDE_BARS.flagship,
        toBar: BROADSIDE_BARS.escorts,
        tracks: [
          oneShot(0, 0, ({ time }) => voices.cymbal(time, 1.2, 0.9)),
          padTrack(BROADSIDE_BARS.flagship, 0.85),
          brassStabTrack('B..b....B..b..b.'),
          timpaniTrack('T...t...T...t.f.'),
          snareTrack('..s.S..s..s.S.s.'),
          ostinatoTrack(0.62, 2000, driveOrder),
          bassTrack('B..b..u.B..b..f.'),
          oneShot(4, 0, ({ time }) => voices.riser(time, STEPS_PER_BAR * SIXTEENTH)),
        ],
      },
      {
        name: 'escorts',
        fromBar: BROADSIDE_BARS.escorts,
        toBar: BROADSIDE_BARS.trench,
        tracks: [
          padTrack(BROADSIDE_BARS.escorts, 0.85),
          brassStabTrack('B..b..B...b..b..'),
          timpaniTrack('T...t...T...t...'),
          snareTrack('s.s.S.s.s.s.S.s.'),
          ostinatoTrack(0.72, 2300, driveOrder),
          bassTrack('B.b.B.b.B.b.B.b.'),
          oneShot(1, 8, ({ time }) => voices.riser(time, 8 * SIXTEENTH)),
        ],
      },
      {
        name: 'trench',
        fromBar: BROADSIDE_BARS.trench,
        tracks: [
          oneShot(0, 0, ({ time }) => voices.cymbal(time, 1.35, 1.2)),
          melodyTrack(TRENCH_CLIMB, 'brass'),
          padTrack(BROADSIDE_BARS.trench, 0.95),
          timpaniTrack('T...t...T...t...'),
          snareTrack('S...s...S...s.ss'),
          ostinatoTrack(0.8, 2500, trenchOrder),
          bassTrack('B.b.B.b.B.b.B.b.'),
          tickTrack('x.x.x.x.x.x.x.x.'),
          oneShot(2, 0, ({ time }) => voices.riser(time, STEPS_PER_BAR * SIXTEENTH)),
        ],
      },
    ],
  });

  // Attract mode: the battle heard from the hangar deck — a quiet pad and
  // far-off capital guns.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        hits<Chord>(padEven, { P: 1 }, ({ time, chord }) =>
          voices.stringsPad(time, chord.pad, LANE_STEPS * SIXTEENTH * 1.05, 0.5)),
        fn<Chord>((context) => {
          if (context.bar % 4 === 2 && context.step === 6) voices.cannon(context.time, 0.55, true);
          if (context.bar % 8 === 5 && context.step === 0) voices.horn(context.time, context.chord.arp[0], SIXTEENTH * 12, 0.3);
        }),
      ],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else {
      if (position % STEPS_PER_BAR === 0) runArrangement.recordSectionStart(time, position / STEPS_PER_BAR);
      runArrangement.schedule(position, time);
    }
  }

  // ---- the player's instruments -----------------------------------------------

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = SECTION_VOICES[sectionMix.from].kill;
    const toVoice = SECTION_VOICES[sectionMix.to].kill;
    const vel = Math.min(1.35, 1 + chain * 0.12);
    const decay = lerp(fromVoice.decay, toVoice.decay, sectionMix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, sectionMix.t);
    const shimmer = lerp(fromVoice.shimmer, toVoice.shimmer, sectionMix.t);

    const layers: Array<[typeof fromVoice, number]> = sectionMix.from === sectionMix.to
      ? [[toVoice, 1]]
      : [[fromVoice, 1 - sectionMix.t], [toVoice, sectionMix.t]];
    for (const [layer, weight] of layers) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice: layer,
        velocity: vel,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.4 }],
      });
    }
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: [{ destination: audioMix.delaySend, gain: 0.5 }] });
    }
    voices.noiseHit(time, 0.045 * shimmer + 0.025, 0.07, 'highpass', 5400, output);
  }

  bus.on('kill', ({ indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    const layers: Array<[SectionIndex, number]> = sectionMix.from === sectionMix.to
      ? [[sectionMix.to, 1]]
      : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
    for (const [section, weight] of layers) {
      if (weight < 0.02) continue;
      const lockSpec = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: lockSpec.oscillator,
        cutoff: lockSpec.cutoff,
        gainValue: lockSpec.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.3 }],
      });
    }
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const fromFire = SECTION_VOICES[sectionMix.from].fire;
    const toFire = SECTION_VOICES[sectionMix.to].fire;
    const cutoff = lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t);
    const noise = lerp(fromFire.noise, toFire.noise, sectionMix.t);
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      destination: output,
    });
    voices.noiseHit(time, noise, 0.02, 'highpass', 3200, output);
  });

  // Non-lethal hits: boss armor rings a rising anvil that grows with damage
  // dealt; ordinary chips answer with a quick in-chord triplet.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    const heavy = heavyIds.get(enemyId);
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (heavy) {
      const intensity = Math.min(1, Math.max(0, 1 - hitPointsRemaining / heavy.maxHp));
      const rootFreq = midiToFreq(chord.bass + 12);
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.42,
        oscillatorType: 'sine',
        frequency: rootFreq * 3,
        frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.08 }],
        gainAutomation: [
          { type: 'set', value: 0.24 + 0.16 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.36 },
        ],
        destination: output,
      });
      const lead = score.leadSetAt(position);
      const beacon = lead[Math.min(lead.length - 1, Math.floor(intensity * lead.length))];
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'triangle',
        frequency: midiToFreq(beacon + 12),
        gainAutomation: [
          { type: 'set', value: 0.06 + 0.07 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.46 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.5 }],
      });
      voices.noiseHit(time, 0.1 + 0.08 * intensity, 0.05, 'bandpass', 1350, output);
      return;
    }
    ([[0, 0.075], [1, 0.06], [2, 0.05]] as const).forEach(([index, vel]) => {
      if (!ctx || !output) return;
      const at = time + THIRTYSECOND * index;
      chipVoice.play({ context: ctx, time: at, midi: chord.arp[index] + 12, vel, destination: output, sends: [{ destination: delaySend, gain: 0.35 }] });
    });
    voices.noiseHit(time, 0.03, 0.03, 'highpass', 5600, output);
  });

  // Turret armor shears off / generator housing splits: one heavy metallic crack.
  bus.on('stage', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    voices.noiseHit(time, 0.16, 0.09, 'bandpass', 900, output);
    voices.noiseHit(time + 0.02, 0.09, 0.14, 'highpass', 3600, output);
    const root = score.chordAt(score.arrangementPositionAt(time)).bass;
    voices.brass(time, root + 24, 0.22, 0.7, 0.8);
  });

  // A clean volley of four or more kills: the orchestra answers with a chord
  // stab on the next beat.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.48,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2500 },
        gainAutomation: [
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.44 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.45 }],
      });
    }
    voices.cymbal(time, 0.8, 0.5);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    rejectVoice.play({ context: ctx, time, frequency: 310, vel: 0.17, destination: output });
    rejectVoice.play({ context: ctx, time: time + 0.03, frequency: 222, vel: 0.12, destination: output });
    voices.noiseHit(time, 0.13, 0.08, 'bandpass', 700, output);
    voices.noiseHit(time + 0.02, 0.06, 0.11, 'highpass', 2500, output);
  });

  // Hull hit: a flak boom under a deliberately out-of-key tritone stab.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    impactBoomVoice.play({ context: ctx, time, frequency: 92, destination: output });
    for (const midi of [63, 69]) {
      impactStabVoice.play({ context: ctx, time, midi, destination: output });
    }
    voices.noiseHit(time, 0.18, 0.13, 'bandpass', 850, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'sine',
      frequency: 126,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 64, time: time + 0.11 }],
      gainAutomation: [
        { type: 'set', value: 0.045, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: output,
    });
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind === 'turret') heavyIds.set(enemyId, { maxHp: 3 });
    if (kind === 'shieldgen') heavyIds.set(enemyId, { maxHp: 2 });
    if (kind === 'core') heavyIds.set(enemyId, { maxHp: 2 });
  });

  bus.on('bossphase', ({ phase }) => {
    const mix = runtime.mix();
    const output = sfxDestination();
    if (!ctx || !mix?.duck || !output) return;
    if (phase === 'summoned') {
      // The flagship raises its shields: a low brass alarm, twice.
      const time = score.nextGridTime(ctx.currentTime);
      voices.brass(time, 45, 0.5, 0.85, 0.5);
      voices.brass(time, 51, 0.5, 0.7, 0.5);
      voices.brass(time + 0.5, 46, 0.6, 0.9, 0.6);
      voices.brass(time + 0.5, 52, 0.6, 0.75, 0.6);
      voices.timpani(time, 38, 1);
      return;
    }
    if (phase === 'exposed') {
      // The shield falls: the orchestra ducks and the whole lead set pours
      // down like glass coming apart.
      const time = score.nextGridTime(ctx.currentTime);
      mix.duckAt(time, 0.3, 1.3);
      voices.cannon(time, 1, false);
      voices.cymbal(time, 1.2, 1.3);
      const position = score.arrangementPositionAt(time);
      const lead = score.leadSetAt(position);
      for (let index = 0; index < lead.length; index += 1) {
        voices.stringsShort(time + index * THIRTYSECOND, lead[lead.length - 1 - index], 0.75 - index * 0.05, 2600);
      }
      return;
    }
    // Destroyed: the victory theme. Duck the war, roll the drums, land the
    // peal in D major, and let the hall carry it.
    flagshipDestroyed = true;
    const time = score.nextGridTime(ctx.currentTime, 4);
    mix.duckAt(time, 0.16, 2.6);
    voices.cannon(time, 1, false);
    voices.timpaniRoll(time, 38, 1.1, 0.95);
    voices.cymbal(time, 1.4, 1.6);
    [62, 66, 69, 74, 78, 81].forEach((midi, index) => {
      voices.brass(time + 0.16 + index * SIXTEENTH, midi, 0.6 + index * 0.08, 0.95, 0.9);
    });
    voices.stringsPad(time + 0.4, [50, 54, 57, 62, 66], 3.4, 1.05);
    voices.noiseHit(time, 0.12, 0.7, 'highpass', 6400, output);
  });

  return runtime;
}
