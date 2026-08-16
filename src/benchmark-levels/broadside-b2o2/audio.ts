import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createBroadsideVoices, type BroadTonalVoice } from './audio-voices';
import {
  BROADSIDE_BARS,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_SCORE_SECTIONS,
  BROADSIDE_STEPS_PER_BAR,
  BROADSIDE_TIME,
} from './timing';

// The Broadside score: 132 BPM in D minor, 33 bars = exactly 60 seconds,
// scored like space opera. Timpani are tuned, horns carry the theme, strings
// drive the ostinati, and the RELENTLESS's own broadside guns are the
// biggest percussion in the hall. The arrangement swells with each push and
// falls to a solo flute and distant thunder in the eye (bars 13–15). Locks,
// volleys, chips, and kills are all notes in the score: they snap to the
// transport, read the live chord, and kills walk hidden per-section melody
// lanes so a chained volley is a solo. The finale is earned: killing the
// flagship's core ducks the hall for a breath and lands the D-major tutti.

const SIXTEENTH = BROADSIDE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = BROADSIDE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Main loop, two bars each: Dm — Bb — F — C. The heroic march home.
const CHORDS: Chord[] = [
  { bass: 38, pad: [62, 65, 69, 72], arp: [69, 74, 77, 81], stab: [62, 65, 69] }, // Dm
  { bass: 34, pad: [58, 62, 65, 67], arp: [65, 70, 74, 77], stab: [58, 62, 65] }, // Bb
  { bass: 41, pad: [57, 60, 64, 65], arp: [65, 69, 72, 77], stab: [57, 60, 64] }, // F
  { bass: 36, pad: [55, 60, 64, 67], arp: [67, 72, 76, 79], stab: [55, 60, 64] }, // C
];
// The eye: Bbmaj7 hanging, then an A sus that refuses to resolve.
const EYE_CHORDS: Chord[] = [
  { bass: 34, pad: [58, 62, 65, 69], arp: [65, 69, 70, 74], stab: [58, 62, 65] },
  { bass: 33, pad: [57, 62, 64, 69], arp: [64, 69, 74, 76], stab: [57, 62, 64] },
];
// The belly: darker water — Gm, Dm, Eb, Bb, one per bar.
const BELLY_CHORDS: Chord[] = [
  { bass: 43, pad: [55, 58, 62, 67], arp: [62, 67, 70, 74], stab: [55, 58, 62] }, // Gm
  CHORDS[0],
  { bass: 39, pad: [55, 58, 63, 67], arp: [63, 67, 70, 75], stab: [51, 55, 58] }, // Eb
  CHORDS[1],
];
// The flagship: a climbing cadence, one chord per bar, landing on the
// dominant for the swing-around and holding it into the trench.
const FLAGSHIP_CHORDS: Chord[] = [
  CHORDS[0], // Dm
  { bass: 43, pad: [55, 58, 62, 67], arp: [62, 67, 70, 74], stab: [55, 58, 62] }, // Gm
  CHORDS[1], // Bb
  { bass: 33, pad: [57, 61, 64, 69], arp: [64, 69, 73, 76], stab: [57, 61, 64] }, // A
  CHORDS[0],
  { bass: 33, pad: [57, 61, 64, 69], arp: [64, 69, 73, 76], stab: [57, 61, 64] }, // A
];
// Victory: the Picardy third — D major, with the subdominant lift for the pull-out.
const VICTORY_CHORDS: Chord[] = [
  { bass: 38, pad: [62, 66, 69, 74], arp: [69, 74, 78, 81], stab: [62, 66, 69] }, // D
  { bass: 43, pad: [59, 62, 67, 71], arp: [67, 71, 74, 79], stab: [55, 59, 62] }, // G
];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Launch: a gentle arch finding its wings.
  0: [
    0, 1, 2, 3, 2, 3, 4, 3,
    4, 5, 4, 3, 2, 3, 4, 5,
    4, 3, 2, 3, 4, 5, 6, 5,
    6, 5, 4, 3, 2, 1, 2, 3,
  ],
  // Mêlée I: broken-chord jumps.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 2, 6, 3, 5, 1, 4, 0,
    2, 5, 3, 6, 4, 7, 5, 3,
    6, 4, 2, 5, 3, 1, 2, 0,
  ],
  // Broadside: bold triadic strides.
  2: [
    0, 2, 4, 4, 2, 0, 2, 4,
    5, 4, 2, 4, 5, 7, 5, 4,
    2, 4, 5, 4, 2, 0, 2, 4,
    6, 5, 4, 2, 4, 5, 7, 5,
  ],
  // Eye: sparse high bells.
  3: [
    7, 6, 7, 5, 6, 7, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 5,
    7, 5, 6, 4, 5, 6, 7, 6,
    5, 4, 5, 6, 7, 6, 7, 4,
  ],
  // Mêlée II: fast scalar runs.
  4: [
    0, 1, 2, 3, 4, 5, 6, 7,
    6, 5, 4, 5, 6, 7, 6, 5,
    4, 3, 4, 5, 6, 7, 6, 5,
    7, 6, 5, 4, 3, 2, 1, 0,
  ],
  // Belly: the descent into dark water.
  5: [
    7, 6, 5, 4, 5, 6, 5, 4,
    3, 4, 3, 2, 3, 4, 3, 2,
    1, 2, 1, 0, 1, 2, 3, 2,
    3, 2, 1, 0, 1, 2, 3, 4,
  ],
  // Flagship: the climb.
  6: [
    0, 1, 2, 3, 4, 5, 6, 7,
    7, 6, 7, 5, 6, 7, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 7,
    5, 6, 7, 6, 7, 6, 7, 7,
  ],
  // Victory: the D-major arpeggio, over and over.
  7: [
    0, 2, 4, 7, 4, 2, 4, 5,
    7, 5, 4, 5, 7, 4, 2, 4,
    0, 2, 4, 7, 7, 4, 2, 4,
    5, 4, 2, 4, 5, 7, 6, 7,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: BroadTonalVoice; kill: BroadTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.12, cutoff: 3200, gain: 0.12, sparkle: 0.5, reverb: 0.24 },
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 1700, gain: 0.16, sparkle: 0.5, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 2600, gain: 0.07, fallSemitones: 10, noise: 0.04 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 3000, gain: 0.11, sparkle: 0.45, reverb: 0.2 },
    kill: { oscillator: 'sawtooth', decay: 0.28, cutoff: 1900, gain: 0.17, sparkle: 0.55, reverb: 0.26 },
    fire: { oscillator: 'sawtooth', cutoff: 3000, gain: 0.06, fallSemitones: 9, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2800, gain: 0.07, sparkle: 0.4, reverb: 0.16 },
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 2200, gain: 0.19, sparkle: 0.6, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 3200, gain: 0.065, fallSemitones: 8, noise: 0.05 },
  },
  3: {
    // The eye: everything the player does sounds small and far away.
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 4200, gain: 0.13, sparkle: 0.75, reverb: 0.4 },
    kill: { oscillator: 'sine', decay: 0.4, cutoff: 3600, gain: 0.15, sparkle: 0.85, reverb: 0.45 },
    fire: { oscillator: 'triangle', cutoff: 2400, gain: 0.05, fallSemitones: 12, noise: 0.03 },
  },
  4: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 3000, gain: 0.07, sparkle: 0.4, reverb: 0.16 },
    kill: { oscillator: 'sawtooth', decay: 0.26, cutoff: 2000, gain: 0.18, sparkle: 0.55, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 3200, gain: 0.06, fallSemitones: 8, noise: 0.05 },
  },
  5: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 2200, gain: 0.1, sparkle: 0.35, reverb: 0.28 },
    kill: { oscillator: 'sawtooth', decay: 0.32, cutoff: 1300, gain: 0.17, sparkle: 0.4, reverb: 0.34 },
    fire: { oscillator: 'sawtooth', cutoff: 2200, gain: 0.055, fallSemitones: 11, noise: 0.04 },
  },
  6: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2600, gain: 0.075, sparkle: 0.4, reverb: 0.18 },
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 2400, gain: 0.2, sparkle: 0.55, reverb: 0.26 },
    fire: { oscillator: 'sawtooth', cutoff: 3000, gain: 0.065, fallSemitones: 9, noise: 0.05 },
  },
  7: {
    lock: { oscillator: 'triangle', decay: 0.12, cutoff: 3600, gain: 0.12, sparkle: 0.6, reverb: 0.3 },
    kill: { oscillator: 'sawtooth', decay: 0.4, cutoff: 2600, gain: 0.2, sparkle: 0.7, reverb: 0.36 },
    fire: { oscillator: 'triangle', cutoff: 2800, gain: 0.06, fallSemitones: 8, noise: 0.04 },
  },
};

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-b2o2',
  bpm: BROADSIDE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: BROADSIDE_DURATION,
  createAudio: createBroadsideAudio,
});

// Horn themes, as [barInSection, step, midi, seconds, vel] rows.
type MelodyRow = readonly [number, number, number, number, number];
const LAUNCH_CALL: MelodyRow[] = [
  [0, 0, 62, 0.5, 0.85], [0, 6, 65, 0.4, 0.8], [0, 12, 69, 0.65, 0.9],
  [2, 0, 65, 0.5, 0.8], [2, 6, 69, 0.4, 0.8], [2, 12, 72, 0.75, 0.9],
];
const MELEE1_THEME: MelodyRow[] = [
  [0, 0, 74, 0.7, 0.92], [0, 8, 77, 0.4, 0.78], [0, 12, 81, 0.45, 0.88],
  [1, 0, 79, 0.55, 0.86], [1, 8, 77, 0.3, 0.72], [1, 12, 76, 0.3, 0.72],
  [2, 0, 74, 1.4, 0.95],
  [3, 8, 72, 0.3, 0.68], [3, 12, 74, 0.55, 0.82],
];
const BROADSIDE_THEME: MelodyRow[] = [
  [0, 0, 69, 0.5, 1.0], [0, 6, 74, 0.35, 0.9], [0, 10, 77, 0.35, 0.9],
  [1, 0, 81, 0.8, 1.0], [1, 8, 79, 0.3, 0.85], [1, 12, 77, 0.3, 0.85],
  [2, 0, 76, 0.6, 0.9], [2, 8, 74, 0.3, 0.85], [2, 12, 76, 0.3, 0.85],
  [3, 0, 77, 1.2, 1.0],
];
const EYE_SOLO: MelodyRow[] = [
  [0, 0, 69, 1.6, 0.8],
  [1, 0, 67, 1.6, 0.75],
  [2, 0, 65, 0.8, 0.75], [2, 8, 64, 0.8, 0.75],
];
const MELEE2_THEME: MelodyRow[] = [
  [0, 0, 74, 0.5, 0.95], [0, 6, 77, 0.3, 0.85], [0, 10, 81, 0.35, 0.9], [0, 14, 86, 0.55, 1.0],
  [1, 0, 84, 0.5, 0.95], [1, 6, 81, 0.3, 0.85], [1, 10, 79, 0.35, 0.85],
  [2, 0, 77, 0.95, 0.95],
  [3, 0, 79, 0.5, 0.9], [3, 8, 81, 0.3, 0.9], [3, 12, 79, 0.3, 0.85],
  [4, 0, 77, 1.2, 0.95],
];
const BELLY_MOTIF: MelodyRow[] = [
  [0, 0, 55, 0.7, 0.85], [0, 12, 58, 0.5, 0.8],
  [1, 0, 62, 0.9, 0.9],
  [2, 0, 63, 0.7, 0.85], [2, 12, 62, 0.4, 0.8],
  [3, 0, 58, 1.2, 0.9],
];
const FLAGSHIP_CLIMB: MelodyRow[] = [
  [0, 0, 69, 0.8, 0.9],
  [1, 0, 70, 0.8, 0.9],
  [2, 0, 73, 0.8, 0.95],
  [3, 0, 74, 1.2, 1.0],
  [4, 0, 74, 1.0, 0.95],
  [5, 0, 73, 1.5, 1.0],
];

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let coreId = -1;
  const generatorIds = new Set<number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: BROADSIDE_BARS.eye, toBar: BROADSIDE_BARS.melee2, chords: EYE_CHORDS, barsPerChord: 2 },
      { fromBar: BROADSIDE_BARS.belly, toBar: BROADSIDE_BARS.flagship, chords: BELLY_CHORDS, barsPerChord: 1 },
      { fromBar: BROADSIDE_BARS.flagship, toBar: BROADSIDE_BARS.trench, chords: FLAGSHIP_CHORDS, barsPerChord: 1 },
      { fromBar: BROADSIDE_BARS.trench, chords: VICTORY_CHORDS, barsPerChord: 1 },
    ],
    sections: BROADSIDE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2400 },
      reverb: { seconds: 3.4, decay: 2.5, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      coreId = -1;
      generatorIds.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) {
        // Whatever happened, the hall settles into the summary screen.
        strings(context.currentTime + 0.05, [50, 57, 62, 66], 6, 0.7, 1200);
      }
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement -----------------------------------------------------------

  const blankBar = '................';
  const ostinatoBar = 'O.O.O.O.O.O.O.O.';
  const ostinatoFull = 'OOOOOOOOOOOOOOOO';
  const timpaniMarch = 'T...T...T...T...';
  const timpaniGallop = 'T..T.T..T..T.T..';
  const timpaniBattle = 'T..T..T...T..T..';
  const snareBackbeat = '....S.......S...';
  const snareMarch = '..S...S..S.S..S.';
  const padWhole = 'P...............................';

  const melodyTrack = (rows: MelodyRow[], instrument: 'horn' | 'flute', velScale = 1): ArrangementTrack<Chord> =>
    fn(({ time, barInSection, step }) => {
      for (const [bar, rowStep, midi, len, vel] of rows) {
        if (barInSection === bar && step === rowStep) {
          if (instrument === 'horn') horn(time, midi, len, vel * velScale);
          else flute(time, midi, len, vel * velScale);
        }
      }
    });

  const ostinatoTrack = (pattern: string, vel: number, octaveOffset = -12): ArrangementTrack<Chord> =>
    hits(pattern, { O: vel }, ({ time, step, chord }) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      ostinato(time, chord.arp[order[(step / 2) % order.length]] + octaveOffset, vel, 2100);
    });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(bar / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          hits(padWhole, { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.55, 1100)),
          fn(({ time, step, bar, chord }) => {
            if (bar % 4 === 3 && step === 12) harp(time, chord.arp[2] + 12, 0.32);
            if (bar % 2 === 1 && step === 4) battleRumble(time, 0.5);
          }),
        ],
      },
    ],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'launch',
        fromBar: BROADSIDE_BARS.launch,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            cymbal(time, 0.5);
            timpani(time, 38, 1.1);
          }),
          hits(padWhole, { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.75, 1400)),
          ostinatoTrack(ostinatoBar, 0.32),
          hits(timpaniMarch, { T: 0.55 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          melodyTrack(LAUNCH_CALL, 'horn'),
          oneShot(3, 8, ({ time }) => riser(time, 12 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'melee1',
        fromBar: BROADSIDE_BARS.melee1,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            cymbal(time, 0.55);
            timpani(time, 38, 1.15);
          }),
          hits(padWhole, { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.7, 1550)),
          ostinatoTrack(ostinatoFull, 0.4),
          hits(timpaniBattle, { T: 0.85 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(snareBackbeat, { S: 0.7 }, ({ time }, vel) => snare(time, vel)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection % 2 === 0 && step === 0) brassChord(time, chord.stab, 0.55, 0.4);
          }),
          melodyTrack(MELEE1_THEME, 'horn'),
          oneShot(4, 8, ({ time }) => riser(time, 12 * SIXTEENTH, 0.22)),
        ],
      },
      {
        name: 'broadside',
        fromBar: BROADSIDE_BARS.broadside,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            cymbal(time, 0.5);
            timpani(time, 38, 1.1);
          }),
          hits(padWhole, { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.75, 1650)),
          ostinatoTrack(ostinatoFull, 0.46),
          hits(timpaniGallop, { T: 0.95 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits('....S...S...S..S', { S: 0.75 }, ({ time }, vel) => snare(time, vel)),
          // The fleet's broadside, on the authored salvo grid.
          fn(({ time, barInSection, step }) => {
            const SALVO_HITS: Array<[number, number]> = [[0, 8], [1, 0], [1, 8], [2, 0], [2, 8], [3, 0]];
            for (const [salvoBar, salvoStep] of SALVO_HITS) {
              if (barInSection === salvoBar && step === salvoStep) salvoBoom(time, 1.05);
            }
          }),
          // Trombone pedal: the cruisers' own voices under the guns.
          hits('B.B.B.B.B.B.B.B.', { B: 0.6 }, ({ time, chord }, vel) => horn(time, chord.bass + 12, 0.16, vel, 900)),
          melodyTrack(BROADSIDE_THEME, 'horn'),
        ],
      },
      {
        name: 'eye',
        fromBar: BROADSIDE_BARS.eye,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            cymbal(time, 0.18);
            subPulse(time, chord.bass, 0.5);
          }),
          hits(padWhole, { P: 1 }, ({ time, chord }) => strings(time, chord.pad.slice(1), 32 * SIXTEENTH * 1.04, 0.5, 950)),
          hits('o...o...o...o...', { o: 0.16 }, ({ time, step, chord }, vel) => ostinato(time, chord.arp[(step / 4) % chord.arp.length] + 12, vel, 2600)),
          melodyTrack(EYE_SOLO, 'flute'),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection === 0 && step === 12) harp(time, chord.arp[1] + 12, 0.3);
            if (barInSection === 1 && step === 8) harp(time, chord.arp[2] + 12, 0.28);
            if (barInSection === 2 && step === 12) harp(time, chord.arp[3] + 12, 0.26);
            // Far-off thunder: the battle goes on without us.
            if (barInSection === 0 && step === 4) battleRumble(time, 0.65);
            if (barInSection === 1 && step === 10) battleRumble(time, 0.5);
            if (barInSection === 2 && step === 6) battleRumble(time, 0.7);
            if (step === 0) subPulse(time, chord.bass, 0.22);
          }),
          oneShot(2, 8, ({ time }) => riser(time, 14 * SIXTEENTH, 0.14)),
        ],
      },
      {
        name: 'melee2',
        fromBar: BROADSIDE_BARS.melee2,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            cymbal(time, 0.6);
            timpani(time, 38, 1.2);
          }),
          hits(padWhole, { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.75, 1650)),
          ostinatoTrack(ostinatoFull, 0.48),
          hits(timpaniBattle, { T: 0.9 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits('..S...S...S...S.', { S: 0.8 }, ({ time }, vel) => snare(time, vel)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0) brassChord(time, chord.stab, 0.5, 0.32);
            if (barInSection % 2 === 1 && step === 12) brassChord(time, chord.stab, 0.35, 0.2);
          }),
          melodyTrack(MELEE2_THEME, 'horn'),
          oneShot(4, 0, ({ time }) => snareRoll(time, 0.7, 8, SIXTEENTH / 2)),
        ],
      },
      {
        name: 'belly',
        fromBar: BROADSIDE_BARS.belly,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            cymbal(time, 0.4);
            timpani(time, 43, 1.0);
          }),
          hits(padWhole, { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.7, 1150)),
          ostinatoTrack(ostinatoBar, 0.42, -24),
          hits(timpaniMarch, { T: 0.85 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(snareMarch, { S: 0.6 }, ({ time }, vel) => snare(time, vel)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection % 2 === 0 && step === 8) brassChord(time, chord.stab, 0.4, 0.26);
          }),
          melodyTrack(BELLY_MOTIF, 'horn', 0.9),
        ],
      },
      {
        name: 'flagship',
        fromBar: BROADSIDE_BARS.flagship,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            cymbal(time, 0.55);
            timpani(time, 38, 1.15);
          }),
          hits(padWhole, { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.75, 1500)),
          ostinatoTrack(ostinatoFull, 0.46),
          hits(timpaniMarch, { T: 0.95 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(snareMarch, { S: 0.75 }, ({ time }, vel) => snare(time, vel)),
          fn(({ time, step, chord }) => {
            if (step === 0) brassChord(time, chord.stab, 0.6, 0.36);
          }),
          melodyTrack(FLAGSHIP_CLIMB, 'horn'),
          oneShot(3, 12, ({ time }) => snareRoll(time, 0.8, 8, SIXTEENTH / 2)),
        ],
      },
      {
        name: 'screen',
        fromBar: BROADSIDE_BARS.screen,
        tracks: [
          // Swirling string up-runs as the rail swings around her stern.
          fn(({ time, step, chord }) => {
            if (step % 2 === 0) {
              const index = step / 2;
              ostinato(time, chord.arp[index % chord.arp.length] + (index >= chord.arp.length ? 12 : 0), 0.5, 2600);
            }
          }),
          hits('T.......T.....T.', { T: 0.8 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(snareMarch, { S: 0.65 }, ({ time }, vel) => snare(time, vel)),
          oneShot(0, 0, ({ time }) => cymbal(time, 0.4)),
          oneShot(1, 8, ({ time }) => snareRoll(time, 0.9, 16, SIXTEENTH / 2)),
          oneShot(1, 12, ({ time }) => riser(time, 8 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'trench',
        fromBar: BROADSIDE_BARS.trench,
        toBar: BROADSIDE_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            cymbal(time, 0.3);
            riser(time, 16 * SIXTEENTH, 0.22);
          }),
          // Tremolo anticipation: the hall holds its breath for the dive.
          hits('t.t.t.t.t.t.t.t.', { t: 0.2 }, ({ time, step, chord }, vel) => ostinato(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel, 2800)),
          hits('T.......T.......', { T: 0.7 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          fn(({ time, step, chord }) => {
            if (step === 0) strings(time, chord.pad, 16 * SIXTEENTH * 1.05, 0.6, 1900);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ------------------------------------------------------------------

  const voices = createBroadsideVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    timpani, salvoBoom, battleRumble, snare, snareRoll, cymbal, riser, horn, brassStab, brassChord,
    strings, ostinato, harp, flute, subPulse, tutti,
    noiseHit, playerSends, playerTone, playerNoise, killBody, oscillatorVoice,
  } = voices;

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const clankVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3200 },
    envelope: { decay: 0.09 },
  });

  // Rejection: a muted brass blat — the gunnery officer shaking his head.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -4 },
      { type: 'sawtooth', gain: 0.5, detune: 4 },
    ],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 900, frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 380, time: time + 0.2 }] },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.11 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.46 }],
    duration: 0.55,
    stopPadding: 0.05,
    envelope: { decay: 0.55 },
  });

  const klaxonVoice = voice({
    oscillators: [{ type: 'triangle', gain: 0.06 }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 2000 },
    envelope: { decay: 0.22 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.045 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  // ---- player instruments ---------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof BroadTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = score.leadSetAt(position);
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = leadSet[degree];
    const vel = Math.min(1.45, 1 + chain * 0.14);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBody(time, midi, decay, gain, vel);
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkle * 0.04, 0.08, 7400);
  }

  // Shield generators die with a climbing confirmation — three notes closer
  // to the trench each time.
  function generatorKill(time: number, remaining: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const degree = Math.min(7, 4 + (3 - remaining));
    playerTone(time, leadSet[degree], PLAYER_VOICES[6].kill, 1.0, 1);
    playerTone(time + THIRTYSECOND * 2, leadSet[Math.min(7, degree + 2)], PLAYER_VOICES[6].kill, 0.7, 1);
    const context = ctx;
    brassStab(time, score.chordAt(position).stab[0] + 12, 0.5, 0.3);
    if (remaining === 0) {
      // The shield falls: the hall ducks, then the whole brass section
      // announces the trench run.
      const audioMix = runtime.mix();
      audioMix?.duckAt(time + 0.05, 0.25, 1.2);
      const at = time + 0.12;
      brassChord(at, [62, 66, 69], 0.85, 0.7);
      cymbal(at, 0.45);
      timpani(at, 38, 1.1);
      for (const [index, midi] of [69, 74, 78, 81].entries()) {
        playerTone(at + 0.25 + index * SIXTEENTH, midi, PLAYER_VOICES[6].kill, 0.8 - index * 0.06, 1);
      }
      void context;
    }
  }

  function coreFinale(time: number) {
    const audioMix = runtime.mix();
    if (!ctx || !audioMix?.duck) return;
    // A breath of silence, then the victory tutti lands and rings home.
    audioMix.duckAt(time, 0.08, 2.4);
    const at = time + 0.14;
    tutti(at, [38, 50, 62, 66, 69, 74], 1.0);
    for (const [index, midi] of [74, 78, 81, 86, 90].entries()) {
      playerTone(at + 0.5 + index * SIXTEENTH, midi, PLAYER_VOICES[7].kill, 0.9 - index * 0.08, 1);
    }
    oscillatorVoice({
      context: ctx,
      time: at,
      stopTime: at + 5,
      oscillatorType: 'sine',
      frequency: midiToFreq(26),
      gainAutomation: [
        { type: 'set', value: 0.0001, time: at },
        { type: 'exponentialRamp', value: 0.22, time: at + 0.06 },
        { type: 'exponentialRamp', value: 0.001, time: at + 4.6 },
      ],
      destination: sfxDestination() ?? audioMix.master,
    });
  }

  // ---- event wiring ------------------------------------------------------------

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].lock, 1, weight);
    }
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.012 + sparkle * 0.028, 0.022, 9200);
    if (lockCount >= 6) {
      // Six locked: a celesta octave and a low brass swell — full broadside.
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      brassStab(time, score.chordAt(position).bass + 24, 0.4, 0.5);
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.32, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 12;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fire = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: fire.oscillator,
        cutoff: fire.cutoff,
        gainValue: fire.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.065 }],
        destination: output,
        sends: playerSends(0.16, 0.08),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.028, 4600);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    // Armor chip: a timpani tap with a tuned clank ringing off the plating.
    timpani(time, chord.bass, 0.35);
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      clankVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        gainValue: 0.05 - index * 0.009,
        destination: output,
        sends: playerSends(0.2, 0.16),
      });
    }
    playerNoise(time, 0.04, 0.032, 5400);
    void hitPointsRemaining;
    void enemyId;
  });

  bus.on('stage', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Plating shears away: a rip of noise and a brass tear.
    noiseHit(time, 0.18, 0.14, 'bandpass', 2300, output);
    brassStab(time, chord.stab[1] + 12, 0.5, 0.4);
    timpani(time + 0.03, chord.bass - 12, 0.6);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === coreId) {
      coreFinale(kill.time);
      return;
    }
    if (generatorIds.delete(enemyId)) {
      generatorKill(kill.time, generatorIds.size);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const mix = score.sectionMixAt(position);
    // Volley fanfare: a brass figure for a clean sweep.
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[mix.to].kill, (size >= 6 ? 0.7 : 0.55) - index * 0.06, 1);
    });
    if (size >= 6) {
      timpani(time, score.chordAt(position).bass, 0.6);
      brassChord(time + SIXTEENTH, score.chordAt(position).stab, 0.5, 0.4);
    }
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const context = ctx;
    for (const [midi, at, vel] of [[45, time, 0.9], [44, time + 0.1, 0.7]] as const) {
      rejectVoice.play({
        context,
        time: at,
        midi,
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.08, 0.05, 'bandpass', 700, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // A hit on the hull: timpani crash and a dissonant brass cluster.
    hullBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[2] + 11].forEach((midi, index) => {
      klaxonVoice.play({ context, time: time + 0.16 + index * 0.12, midi, destination: output, sends: playerSends(0.1, 0.1) });
    });
    noiseHit(time, 0.18, 0.15, 'bandpass', 900, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.11 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'core') {
      coreId = enemyId;
      const time = score.nextGridTime(ctx.currentTime, 1);
      riser(time, 1.6, 0.16);
    } else if (kind === 'generator') {
      generatorIds.add(enemyId);
    } else if (kind === 'gunship') {
      // A heavy contact: a low brass warn.
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      brassStab(time, chord.bass + 12, 0.4, 0.5);
    } else if (kind === 'shieldDome') {
      // Her shields, felt before they are seen: a low menace swell.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      horn(time, chord.bass + 12, 2.2, 0.5, 700);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'exposed') {
      // Covered by the final generator kill's confirmation; nothing more here.
      return;
    }
    if (phase === 'destroyed') {
      // Covered by coreFinale on the kill event.
      return;
    }
  });

  return runtime;
}
