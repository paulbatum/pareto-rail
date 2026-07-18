import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createBroadsideVoices, type PlayerVoiceSpec } from './audio-voices';
import { CORE_COUNT, DOME_OPEN_STEPS } from './flagship';
import { battle } from './state';
import {
  BROADSIDE_BARS,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_SCORE_SECTIONS,
  BROADSIDE_STEPS_PER_BAR,
  BROADSIDE_TIME,
} from './timing';

// THE BROADSIDE SCORE — 132 BPM in D minor, 33 bars, full orchestra.
//
// The arrangement is the battle's shape, not a loop with a lid on it. It opens
// on a catapult hit and a horn call, thickens into martial ostinato as the
// fleets close, hands the flank act a real four-bar brass theme whose downbeats
// are the friendly cruiser's guns going off overhead, grinds low and dark
// through the raking pass, and then — at bar 20 — stops. One bar of tremolo and
// a lone harp descent is the eye of the battle, and it is the only quiet in the
// level.
//
// The flagship act turns the harmony: an E-flat major against a D-minor tonic,
// the Neapolitan flat second, which is the oldest "something enormous and wrong
// is here" chord in the book. Accents land on steps 2, 6, and 14 of every bar,
// which are exactly the steps where the boss's shield domes drop — so the
// rhythm you are hearing is the rhythm you must shoot on. The trench takes the
// harmonic rhythm to one chord per bar, and the last bar is D major.
//
// Everything the player does is a note in this score. Locks are pizzicato,
// climbing the live chord one degree per lock. A volley is a brass stab. Kills
// walk per-act melodic lanes drawn from the live harmony, so a chained six-kill
// release performs a written run — the player is the soloist over the orchestra.

const SIXTEENTH = BROADSIDE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = BROADSIDE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// i — VI — III — VII in D minor, two bars each: the fleet-action loop.
const D_MINOR: Chord = { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74], stab: [62, 65, 69] };
const B_FLAT: Chord = { bass: 34, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70], stab: [58, 62, 65] };
const F_MAJOR: Chord = { bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], stab: [65, 69, 72] };
const C_MAJOR: Chord = { bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72], stab: [60, 64, 67] };
// The flagship's chord: E-flat major over a D tonic — the Neapolitan.
const E_FLAT: Chord = { bass: 39, pad: [51, 55, 58, 63], arp: [63, 67, 70, 75], stab: [63, 67, 70] };
const A_MAJOR: Chord = { bass: 33, pad: [45, 49, 52, 57], arp: [64, 69, 73, 76], stab: [64, 69, 73] };
// Victory: the Picardy third, D major.
const D_MAJOR: Chord = { bass: 38, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74], stab: [62, 66, 69] };

const CHORDS: Chord[] = [D_MINOR, B_FLAT, F_MAJOR, C_MAJOR];

// Alternate sets are indexed by absolute bar, so the array order compensates:
// with barsPerChord 2 from bar 20, bar 20 reads index 2, bar 22 index 3, and so
// on. The intended progression is Dm — Eb — Dm — A.
const FLAGSHIP_CHORDS: Chord[] = [D_MINOR, A_MAJOR, D_MINOR, E_FLAT];
// One chord per bar from 28: Dm — Eb — C — A, and bar 28 reads index 0.
const TRENCH_CHORDS: Chord[] = [D_MINOR, E_FLAT, C_MAJOR, A_MAJOR];
const VICTORY_CHORDS: Chord[] = [D_MAJOR];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Kill lanes: hidden melodies the player performs by chaining kills. Degrees
// index the eight-note lead set (chord tones across two octaves).
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Launch: a simple climbing signal, like a ship working up to speed.
  0: [
    0, 1, 2, 3, 2, 3, 4, 5,
    2, 3, 4, 5, 4, 5, 6, 7,
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 5, 6, 7, 6, 5, 4, 3,
  ],
  // Crossfire: agitated leaps that never settle — everything is at an angle.
  1: [
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 1, 5, 2, 6, 3, 7, 4,
    2, 6, 0, 5, 3, 7, 1, 6,
    5, 2, 7, 3, 6, 1, 4, 0,
  ],
  // Flank: broad heroic ascents, the same shape as the brass theme above it.
  2: [
    0, 2, 4, 5, 4, 5, 7, 6,
    4, 5, 7, 6, 7, 6, 5, 4,
    2, 4, 5, 7, 5, 7, 6, 7,
    5, 4, 5, 7, 6, 7, 6, 5,
  ],
  // Raking: low, tight, grinding — a working figure, not a singing one.
  3: [
    0, 1, 0, 2, 1, 0, 2, 1,
    3, 2, 1, 3, 2, 1, 0, 2,
    1, 3, 2, 4, 3, 2, 1, 3,
    2, 0, 1, 2, 3, 2, 1, 0,
  ],
  // Flagship: tolling descents around the flat second.
  4: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    6, 5, 4, 3, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
  ],
  // Trench: fast urgent runs, the fastest lane in the level.
  5: [
    0, 2, 4, 6, 7, 5, 3, 1,
    2, 4, 6, 7, 6, 4, 2, 0,
    1, 3, 5, 7, 6, 4, 2, 3,
    4, 6, 7, 6, 5, 4, 3, 2,
  ],
  // Victory: an unhurried fanfare shape that keeps resolving upward.
  6: [
    0, 2, 4, 7, 4, 7, 6, 7,
    2, 4, 7, 6, 7, 4, 2, 4,
    0, 4, 7, 6, 7, 6, 4, 7,
    2, 4, 6, 7, 6, 7, 4, 2,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// Player timbres per act. The lock is always a plucked string, but the section
// decides how bright it is and how much hall sits behind it; the fire is the
// section's brass character. Crossfades between adjacent acts are covered by
// the score's section crossfade bars.
const PLAYER_VOICES: Record<SectionIndex, { lock: PlayerVoiceSpec; kill: PlayerVoiceSpec; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.12, cutoff: 2900, gain: 0.11, sparkle: 0.4, reverb: 0.32 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3100, gain: 0.14, sparkle: 0.55, reverb: 0.4 },
    fire: { oscillator: 'sawtooth', cutoff: 2400, gain: 0.05, fallSemitones: 9, noise: 0.04 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 3400, gain: 0.1, sparkle: 0.5, reverb: 0.26 },
    kill: { oscillator: 'sawtooth', decay: 0.24, cutoff: 3400, gain: 0.075, sparkle: 0.65, reverb: 0.3 },
    fire: { oscillator: 'sawtooth', cutoff: 3000, gain: 0.055, fallSemitones: 8, noise: 0.05 },
  },
  2: {
    // The flank act is the heroic one: the player's kill note is openly brassy.
    lock: { oscillator: 'triangle', decay: 0.11, cutoff: 3800, gain: 0.11, sparkle: 0.6, reverb: 0.3 },
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 4200, gain: 0.085, sparkle: 0.8, reverb: 0.36 },
    fire: { oscillator: 'sawtooth', cutoff: 3600, gain: 0.06, fallSemitones: 7, noise: 0.05 },
  },
  3: {
    lock: { oscillator: 'square', decay: 0.09, cutoff: 2000, gain: 0.055, sparkle: 0.3, reverb: 0.24 },
    kill: { oscillator: 'square', decay: 0.22, cutoff: 2300, gain: 0.05, sparkle: 0.4, reverb: 0.28 },
    fire: { oscillator: 'square', cutoff: 1900, gain: 0.038, fallSemitones: 11, noise: 0.035 },
  },
  4: {
    // Flagship: cold, close, long-tailed. Everything sounds like it is
    // happening inside a shield envelope.
    lock: { oscillator: 'sine', decay: 0.15, cutoff: 1700, gain: 0.12, sparkle: 0.18, reverb: 0.5 },
    kill: { oscillator: 'sine', decay: 0.42, cutoff: 2000, gain: 0.16, sparkle: 0.35, reverb: 0.56 },
    fire: { oscillator: 'square', cutoff: 1600, gain: 0.042, fallSemitones: 13, noise: 0.022 },
  },
  5: {
    lock: { oscillator: 'sawtooth', decay: 0.08, cutoff: 3800, gain: 0.055, sparkle: 0.6, reverb: 0.2 },
    kill: { oscillator: 'sawtooth', decay: 0.2, cutoff: 4400, gain: 0.07, sparkle: 0.85, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 4000, gain: 0.06, fallSemitones: 6, noise: 0.055 },
  },
  6: {
    lock: { oscillator: 'triangle', decay: 0.18, cutoff: 4000, gain: 0.11, sparkle: 0.7, reverb: 0.6 },
    kill: { oscillator: 'triangle', decay: 0.5, cutoff: 4400, gain: 0.14, sparkle: 0.9, reverb: 0.66 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.05, fallSemitones: 5, noise: 0.03 },
  },
};

// The flank theme: six bars of brass over the cruiser's broadside. Authored as
// [step, midi, beats] per bar of the section so it can be read as music.
const FLANK_THEME: Array<Array<[number, number, number]>> = [
  [[0, 74, 1.5], [6, 77, 0.5], [8, 74, 1], [12, 70, 1]],
  [[0, 72, 2], [8, 69, 1], [12, 70, 1]],
  [[0, 69, 1.5], [6, 72, 0.5], [8, 77, 2]],
  [[0, 76, 2], [8, 72, 1], [12, 74, 1]],
  [[0, 67, 1], [4, 72, 1], [8, 76, 2]],
  [[0, 74, 2.5], [10, 72, 0.5], [12, 70, 1]],
];

// The victory theme: the level's last statement, in D major.
const VICTORY_THEME: Array<Array<[number, number, number]>> = [
  [[0, 62, 1], [4, 66, 1], [8, 69, 2]],
  [[0, 74, 3], [12, 69, 1]],
];

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-ob4d',
  bpm: BROADSIDE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: BROADSIDE_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: BROADSIDE_BARS.eye, toBar: BROADSIDE_BARS.trench, chords: FLAGSHIP_CHORDS, barsPerChord: 2 },
      { fromBar: BROADSIDE_BARS.trench, toBar: BROADSIDE_BARS.victory, chords: TRENCH_CHORDS, barsPerChord: 1 },
      { fromBar: BROADSIDE_BARS.victory, chords: VICTORY_CHORDS, barsPerChord: 1 },
    ],
    sections: BROADSIDE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.82,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      // A concert-hall tail and a long pre-delay: this is an orchestra in a
      // very large room, not a synth in a booth.
      compressor: { threshold: -15, ratio: 4, attack: 0.006, release: 0.24 },
      delay: { time: SIXTEENTH * 6, feedback: 0.22, dampHz: 2200 },
      reverb: { seconds: 3.6, decay: 2.4, level: 0.62 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      generatorIds.clear();
      coreIds.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      // Whatever happened, the fleet is still out there.
      strings(context.currentTime + 0.05, D_MAJOR.pad, 6, 0.7, 4, 1500);
      choir(context.currentTime + 0.1, [62, 69, 74], 5.5, 0.5);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  const voices = createBroadsideVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    timpani, timpaniRoll, snare, snareRoll, cymbal, gong, impact,
    brass, lowBrass, horn, strings, tremolo, choir, pizz, harp, riser,
    noiseHit, playerSends, playerTone, playerNoise,
  } = voices;

  // ---- arrangement ------------------------------------------------------------

  const blank = '................';
  const timpQuarters = 'T...T...T...T...';
  const timpOneThree = 'T.......T.......';
  const timpOne = 'T...............';
  const snareMarch = 's.s.s.s.s.s.s.s.';
  const snareBackbeat = '....S.......S...';
  // The shield rhythm: steps 2, 6, and 14 are exactly where the flagship's
  // domes drop. The score plays them whether or not an emitter is on screen,
  // so by the time you meet the boss the pattern is already in your ear.
  const shieldAccents = '..a...a.......a.';

  const playTheme = (
    theme: Array<Array<[number, number, number]>>,
    barInSection: number,
    step: number,
    time: number,
    vel: number,
    bite: number,
  ) => {
    const bar = theme[barInSection % theme.length];
    for (const [themeStep, midi, beats] of bar) {
      if (themeStep === step) brass(time, midi, beats * SIXTEENTH * 4, vel, bite);
    }
  };

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(bar / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'standby',
        fromBar: 0,
        tracks: [
          // Attract mode: the fleet at station-keeping. A slow string bed and
          // one distant gun going off somewhere in the dark every other bar.
          hits('P...............................', { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.42, 3, 900)),
          fn(({ time, step, bar, chord }) => {
            if (bar % 2 === 1 && step === 8) harp(time, chord.arp[bar % chord.arp.length], 1.4, 0.34);
            if (bar % 4 === 2 && step === 0) timpani(time, chord.bass, 0.32);
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
        // --- Launch. The catapult hit, a horn call, and the section walking in.
        name: 'launch',
        fromBar: BROADSIDE_BARS.launch,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            gong(time, 0.85);
            timpani(time, chord.bass, 1);
            cymbal(time, 0.5, 1.1);
            impact(time, 0.8);
          }),
          oneShot(0, 4, ({ time, chord }) => horn(time, chord.bass + 24, 6 * SIXTEENTH, 0.75)),
          oneShot(1, 0, ({ time, chord }) => horn(time, chord.bass + 26, 10 * SIXTEENTH, 0.9)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.72, 4, 1500)),
          hits([blank, timpOne, timpOneThree, timpQuarters].join(''), { T: 0.62 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection >= 1 && step === 0) lowBrass(time, chord.bass + 12, 12 * SIXTEENTH, 0.6);
          }),
          hits([blank, blank, snareBackbeat, snareMarch].join(''), { s: 0.28, S: 0.5 }, ({ time }, vel) => snare(time, vel)),
          oneShot(3, 0, ({ time }) => {
            riser(time, 16 * SIXTEENTH, 0.2);
            snareRoll(time, 16 * SIXTEENTH, 0.7);
          }),
        ],
      },
      {
        // --- Crossfire. Martial ostinato: the two lines are now in contact.
        name: 'crossfire',
        fromBar: BROADSIDE_BARS.crossfire,
        tracks: [
          oneShot(0, 0, ({ time }) => cymbal(time, 0.8, 1.4)),
          hits(timpQuarters, { T: 0.72 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(snareMarch, { s: 0.3 }, ({ time }, vel) => snare(time, vel)),
          hits(snareBackbeat, { S: 0.62 }, ({ time }, vel) => snare(time, vel)),
          // Driving brass ostinato on a 3-3-2 figure — the level's engine.
          hits('B..B..B.B..B..B.', { B: 0.8 }, ({ time, step, chord }, vel) => {
            const order = [0, 1, 2, 1, 0, 2, 1, 0];
            brass(time, chord.stab[order[step % order.length] % chord.stab.length], 3 * SIXTEENTH, vel, 0.72);
          }),
          fn(({ time, step, chord }) => {
            if (step === 0) lowBrass(time, chord.bass, 8 * SIXTEENTH, 0.85);
            if (step === 8) lowBrass(time, chord.bass + 7, 6 * SIXTEENTH, 0.6);
          }),
          hits('R...............................', { R: 1 }, ({ time, chord }) => tremolo(time, chord.pad.slice(1), 32 * SIXTEENTH * 1.02, 0.6, 9)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection % 2 === 1 && step === 12) harp(time, chord.arp[3] + 12, 0.9, 0.3);
          }),
          oneShot(5, 0, ({ time }) => {
            riser(time, 16 * SIXTEENTH, 0.24);
            snareRoll(time, 16 * SIXTEENTH, 0.9);
          }),
        ],
      },
      {
        // --- Flank. The theme, and a broadside on every downbeat.
        name: 'flank',
        fromBar: BROADSIDE_BARS.flank,
        tracks: [
          // The cruiser's guns. This is the loudest recurring event in the
          // level and it is deliberately locked to the downbeat, because the
          // visuals fire the ship's battery on the same pulse.
          fn(({ time, step, chord }) => {
            if (step !== 0) return;
            timpani(time, chord.bass - 12, 1);
            cymbal(time, 0.42, 0.9);
            for (const midi of chord.stab) brass(time, midi - 12, 5 * SIXTEENTH, 0.95, 0.95);
          }),
          fn(({ time, step, barInSection }) => playTheme(FLANK_THEME, barInSection, step, time, 1, 1)),
          hits('T...T..T.T..T...', { T: 0.5 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(snareMarch, { s: 0.34 }, ({ time }, vel) => snare(time, vel)),
          // Running strings under the theme: the sense of speed in the mix.
          hits('A.A.A.A.A.A.A.A.', { A: 0.62 }, ({ time, step, chord }, vel) => {
            const order = [0, 1, 2, 3, 2, 3, 1, 2];
            harp(time, chord.arp[order[(step / 2) % order.length]], 0.34, vel * 0.7);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.03, 0.85, 5, 2400)),
          fn(({ time, step, chord }) => {
            if (step === 0 || step === 8) lowBrass(time, chord.bass, 7 * SIXTEENTH, 0.78);
          }),
        ],
      },
      {
        // --- Raking. Low, close, and mechanical: you are under a keel.
        name: 'raking',
        fromBar: BROADSIDE_BARS.raking,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 0.9);
            lowBrass(time, chord.bass - 12, 14 * SIXTEENTH, 1);
          }),
          hits(timpOneThree, { T: 0.78 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits('s...s.s.s...s.s.', { s: 0.42 }, ({ time }, vel) => snare(time, vel)),
          // A grinding staccato figure in the low brass, on the eighths.
          hits('L.L.L.L.L.L.L.L.', { L: 0.62 }, ({ time, step, chord }, vel) => {
            const order = [0, 0, 7, 0, 5, 0, 7, 3];
            lowBrass(time, chord.bass + order[(step / 2) % order.length], 1.6 * SIXTEENTH, vel);
          }),
          hits('R...............................', { R: 1 }, ({ time, chord }) => tremolo(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.55, 11)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 8 && barInSection % 2 === 0) brass(time, chord.stab[2], 4 * SIXTEENTH, 0.7, 0.5);
          }),
          // The last bar of the act empties out into the eye.
          oneShot(4, 8, ({ time }) => {
            snareRoll(time, 8 * SIXTEENTH, 0.55);
            timpaniRoll(time, 8 * SIXTEENTH, 0.6);
          }),
        ],
      },
      {
        // --- The eye of the battle. One bar. Everything stops.
        name: 'eye',
        fromBar: BROADSIDE_BARS.eye,
        toBar: BROADSIDE_BARS.shields,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            runtime.mix()?.duckAt(time, 0.24, 1.6);
            gong(time, 0.4);
            tremolo(time, chord.pad, 16 * SIXTEENTH * 1.1, 0.5, 6);
            choir(time, [chord.pad[0] + 12, chord.pad[2] + 12], 16 * SIXTEENTH, 0.6);
          }),
          // A harp descent, falling through the silence.
          fn(({ time, step, chord }) => {
            const fall = [0, 2, 4, 6, 8, 10, 12];
            const index = fall.indexOf(step);
            if (index >= 0) harp(time, chord.arp[3 - (index % 4)] + (index < 4 ? 12 : 0), 1.6, 0.42 - index * 0.03);
          }),
          oneShot(0, 12, ({ time }) => timpaniRoll(time, 4 * SIXTEENTH, 0.85)),
        ],
      },
      {
        // --- Shields. The Neapolitan, and the dome rhythm you must shoot on.
        name: 'shields',
        fromBar: BROADSIDE_BARS.shields,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.15);
            cymbal(time, 0.55, 1.8);
          }),
          hits('R...............................', { R: 1 }, ({ time, chord }) => tremolo(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.72, 8)),
          hits(timpOneThree, { T: 0.85 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          // The dome accents. Three per bar, on steps 2, 6, and 14.
          hits(shieldAccents, { a: 0.6 }, ({ time, step, chord }, vel) => {
            snare(time, vel * 0.7);
            brass(time, chord.stab[DOME_OPEN_STEPS.indexOf(step as 2 | 6 | 14) % chord.stab.length], 2 * SIXTEENTH, vel, 0.85);
          }),
          fn(({ time, step, chord }) => {
            if (step === 0) lowBrass(time, chord.bass - 12, 15 * SIXTEENTH, 0.95);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection % 2 === 1 && step === 0) {
              choir(time, [chord.pad[1] + 12, chord.pad[3] + 12], 16 * SIXTEENTH, 0.52);
            }
          }),
          fn(({ time, step, barInSection, chord }) => {
            // The last bar before the breach tightens into a roll.
            if (barInSection === 4 && step === 8) {
              snareRoll(time, 8 * SIXTEENTH, 1);
              riser(time, 8 * SIXTEENTH, 0.26);
              horn(time, chord.bass + 24, 8 * SIXTEENTH, 0.8);
            }
          }),
        ],
      },
      {
        // --- Breach. Tutti. The hangars empty and so does the orchestra.
        name: 'breach',
        fromBar: BROADSIDE_BARS.breach,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            cymbal(time, 1, 2.2);
            impact(time, 1);
          }),
          hits(timpQuarters, { T: 0.9 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(snareMarch, { s: 0.42 }, ({ time }, vel) => snare(time, vel)),
          hits('B...B...B...B...', { B: 1 }, ({ time, chord }, vel) => {
            for (const midi of chord.stab) brass(time, midi, 3.5 * SIXTEENTH, vel, 1);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.9, 5, 2600)),
          fn(({ time, step, chord }) => {
            if (step % 4 === 0) lowBrass(time, chord.bass, 3.5 * SIXTEENTH, 0.85);
          }),
          oneShot(1, 8, ({ time }) => {
            snareRoll(time, 8 * SIXTEENTH, 1.1);
            riser(time, 8 * SIXTEENTH, 0.3);
          }),
        ],
      },
      {
        // --- Trench. One chord per bar; nothing has time to breathe.
        name: 'trench',
        fromBar: BROADSIDE_BARS.trench,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.25);
            cymbal(time, 0.7, 1.2);
          }),
          hits(timpQuarters, { T: 0.95 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
          hits('s.s.s.s.s.s.s.s.', { s: 0.5 }, ({ time }, vel) => snare(time, vel)),
          hits('....S.......S...', { S: 0.8 }, ({ time }, vel) => snare(time, vel)),
          // Hammering eighths: the drive of the dive.
          hits('B.B.B.B.B.B.B.B.', { B: 0.9 }, ({ time, step, chord }, vel) => {
            const order = [0, 0, 1, 0, 2, 1, 0, 2];
            brass(time, chord.stab[order[(step / 2) % order.length]] - 12, 1.6 * SIXTEENTH, vel, 0.95);
          }),
          fn(({ time, step, chord }) => {
            if (step === 0) lowBrass(time, chord.bass - 12, 15 * SIXTEENTH, 1);
            if (step === 0) strings(time, chord.pad.map((midi) => midi + 12), 16 * SIXTEENTH * 1.02, 0.7, 4, 3200);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection === 3 && step === 8) {
              snareRoll(time, 8 * SIXTEENTH, 1.2);
              timpaniRoll(time, 8 * SIXTEENTH, 1);
              horn(time, chord.bass + 26, 8 * SIXTEENTH, 0.9);
            }
          }),
        ],
      },
      {
        // --- Victory. D major, and the camera pulls out over the wreck.
        name: 'victory',
        fromBar: BROADSIDE_BARS.victory,
        toBar: BROADSIDE_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            gong(time, 1);
            cymbal(time, 1, 3.2);
            timpani(time, chord.bass - 12, 1);
            impact(time, 1.1);
            strings(time, [...chord.pad, chord.pad[0] + 12], 20 * SIXTEENTH, 1, 6, 3000);
            choir(time, [chord.arp[0], chord.arp[2], chord.arp[3]], 18 * SIXTEENTH, 0.9);
            for (const midi of chord.stab) lowBrass(time, midi - 12, 16 * SIXTEENTH, 1);
          }),
          fn(({ time, step, barInSection }) => playTheme(VICTORY_THEME, barInSection, step, time, 1.1, 1)),
          hits('T...T...T...T...', { T: 0.75 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection === 0 && step % 4 === 2) harp(time, chord.arp[(step / 4) % chord.arp.length] + 12, 1.2, 0.4);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player instrument details ---------------------------------------------

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.55 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      Q: 1.4,
      // A brass stab's shape: bright on the attack, shut a moment later.
      frequencyAutomation: (time, { cutoff }) => [
        { type: 'set', value: cutoff, time },
        { type: 'exponentialRamp', value: Math.max(300, cutoff * 0.25), time: time + 0.09 },
      ],
    },
    envelope: { attack: 0.004, decay: 0.1 },
  });

  // Non-lethal hits are a muted brass chug: air moving, no note landing.
  const chugVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'sawtooth', gain: ({ gainValue }) => gainValue }],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 900, Q: 3.2 },
    envelope: { decay: 0.11 },
  });

  // Rejection: col legno — the section striking the strings with the wood of
  // the bow. Dry, wrong, and unmistakably an orchestra saying no.
  const colLegnoVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 7, frequency: 520 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
    ],
  });

  const missVoice = voice({
    oscillators: [{ type: 'triangle', gain: 0.045 }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 1200 },
    envelope: { attack: 0.03, decay: 0.2 },
  });

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof PlayerVoiceSpec) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : (to as number);
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = score.leadSetAt(position);
    const midi = leadSet[KILL_LANES[laneSection][position % KILL_LANE_STEPS]];
    const vel = Math.min(1.5, 1 + chain * 0.15);

    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    killBodyVoice.play({
      context: ctx,
      time,
      midi,
      decay: mixedVoiceValue(mix, 'kill', 'decay'),
      gain: mixedVoiceValue(mix, 'kill', 'gain'),
      velocity: vel,
      destination: output,
    });
    // From the third kill in a chain the soloist gets the orchestra behind it:
    // a brass double an octave down. A six-kill release is genuinely loud.
    if (chain >= 2) brass(time, midi - 12, 0.26, 0.42 + chain * 0.07, 0.9);
    if (chain >= 4) harp(time + THIRTYSECOND, midi + 12, 0.7, 0.4);
    playerNoise(time, 0.015 + mixedVoiceValue(mix, 'kill', 'sparkle') * 0.03, 0.06, 7000);
  }

  /** A shield emitter taking a hit. Each one is brighter and higher than the last. */
  function emitterChip(time: number, intensity: number) {
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    brass(time, chord.stab[0] + Math.round(intensity * 5), 0.3, 0.6 + intensity * 0.5, 0.5 + intensity * 0.6);
    snare(time, 0.5 + intensity * 0.4);
    playerNoise(time, 0.06 + intensity * 0.07, 0.09, 3800);
  }

  /** The shield envelope failing: the level's biggest single musical event. */
  function shieldCollapse(time: number) {
    const audioMix = runtime.mix();
    if (!ctx || !audioMix) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.18, 1.4);
    gong(time, 1);
    impact(time, 1.4);
    timpani(time, chord.bass - 12, 1);
    cymbal(time, 0.9, 2.6);
    // The envelope unwinding: a falling choir cluster over a rising horn.
    choir(time + 0.05, [chord.pad[3] + 12, chord.pad[2] + 12, chord.pad[0] + 12], 2.4, 0.85);
    horn(time + 0.08, chord.bass + 24, 1.8, 1);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      harp(time + 0.1 + index * THIRTYSECOND * 1.5, midi, 1.1, 0.55 - index * 0.05);
    });
  }

  /** The killing blow: duck everything, then land the victory chord. */
  function flagshipFinale(time: number) {
    const audioMix = runtime.mix();
    if (!ctx || !audioMix) return;
    audioMix.duckAt(time, 0.1, 2.2);
    gong(time, 1);
    impact(time, 1.5);
    timpani(time, D_MAJOR.bass - 12, 1);
    cymbal(time, 1, 3.4);
    timpaniRoll(time + 0.1, 0.7, 0.9);
    // Straight into D major: brass, choir, and the theme's first phrase.
    for (const midi of D_MAJOR.stab) brass(time + 0.75, midi, 2.4, 1, 1);
    choir(time + 0.75, [D_MAJOR.arp[0], D_MAJOR.arp[2], D_MAJOR.arp[3]], 3.2, 0.95);
    lowBrass(time + 0.75, D_MAJOR.bass - 12, 3, 1);
    [62, 66, 69, 74].forEach((midi, index) => {
      harp(time + 0.8 + index * SIXTEENTH, midi + 12, 1.4, 0.6);
    });
  }

  // ---- event wiring -------------------------------------------------------------

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
    // The pluck under every lock: the strings loading your battery.
    pizz(time, midi - 12, 0.55 + lockCount * 0.07);
    playerNoise(time, 0.008 + mixedVoiceValue(mix, 'lock', 'sparkle') * 0.02, 0.02, 9000);
    if (lockCount >= 6) {
      // Battery full. A horn call answers before you have even released.
      horn(time, score.chordAt(position).bass + 24, 0.45, 0.55);
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    pizz(time, score.chordAt(score.arrangementPositionAt(time)).bass + 12, 0.28);
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.075 }],
        destination: output,
        sends: playerSends(0.12, 0.12),
      });
    }
    playerNoise(
      time,
      lerp(PLAYER_VOICES[mix.from].fire.noise, PLAYER_VOICES[mix.to].fire.noise, mix.t),
      0.03,
      4200,
    );
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (generatorIds.has(enemyId)) {
      emitterChip(time, 1 - hitPointsRemaining / 2);
      return;
    }
    if (coreIds.has(enemyId)) {
      emitterChip(time, 1 - hitPointsRemaining / 4);
      return;
    }
    // Armour chip on a turret or an escort: a short muted brass cluster.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      chugVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi - 12,
        gainValue: 0.05 - index * 0.011,
        destination: output,
        sends: playerSends(0.1, 0.16),
      });
    }
    playerNoise(time, 0.035, 0.03, 5000);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Armour shearing off: a noise tear plus a rising brass swell.
    noiseHit(time, 0.16, 0.16, 'bandpass', 2100, output);
    brass(time, chord.stab[1], 0.45, 0.8, 0.9);
    if (coreIds.has(enemyId)) {
      snare(time, 0.9);
      riser(time, 0.9, 0.16);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    // Boss hardware gets its own kill figure rather than a melody-lane note.
    // The phase changes that follow — shield collapse, flagship destroyed —
    // arrive as `bossphase` immediately after this handler returns, so they
    // schedule against the same grid step as the shot that caused them.
    if (generatorIds.delete(enemyId)) {
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      timpani(time, chord.bass, 0.95);
      cymbal(time, 0.6, 1.6);
      brass(time, chord.stab[2] + 12, 0.7, 0.9, 1);
      return;
    }
    if (coreIds.delete(enemyId)) {
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      timpani(time, chord.bass - 12, 1);
      impact(time, 1.1);
      cymbal(time, 0.7, 1.4);
      // Each coupling that goes up lifts the horn call a step higher.
      horn(time + 0.06, chord.bass + 22 + battle.coresDown * 2, 0.9, 0.85);
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || kills < size || size < 3) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    if (battle.broadsideVolley) {
      // The namesake: the whole battery answering on one side. Timpani, a
      // brass chord, and a cymbal — the same figure the cruiser gets.
      timpani(time, chord.bass - 12, 0.85);
      cymbal(time, 0.45 + size * 0.06, 1.3);
      for (const midi of chord.stab) brass(time, midi, 0.55, 0.75 + size * 0.05, 1);
      if (size >= 6) horn(time + SIXTEENTH, chord.bass + 26, 0.9, 0.9);
    } else {
      const leadSet = score.leadSetAt(position);
      [0, 2, 4, 7].forEach((degree, index) => {
        playerTone(time + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[mix.to].kill, 0.55 - index * 0.06, 1);
      });
    }
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const context = ctx;
    // A dry cluster a semitone apart, struck twice.
    for (const [frequency, at, vel] of [[196, time, 0.12], [208, time + 0.005, 0.1], [196, time + 0.1, 0.07]] as const) {
      colLegnoVoice.play({ context, time: at, frequency, vel, destination: output });
    }
    noiseHit(time, 0.09, 0.05, 'bandpass', 820, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // A hull hit is orchestral too: a timpani strike and a low brass cluster
    // a semitone apart, which is the only genuinely ugly sound in the level.
    timpani(time, chord.bass - 12, 1);
    impact(time, 0.9);
    lowBrass(time + 0.02, chord.bass, 0.7, 0.9);
    lowBrass(time + 0.03, chord.bass + 1, 0.7, 0.7);
    noiseHit(time, 0.16, 0.18, 'bandpass', 700, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 22), time: time + 0.18 }],
      destination: output,
      sends: playerSends(0.06, 0.2),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'generator') {
      generatorIds.add(enemyId);
      // A shield emitter coming online: a low choir swell under the tremolo.
      const time = score.nextGridTime(ctx.currentTime, 2);
      choir(time, [score.chordAt(score.arrangementPositionAt(time)).pad[0]], 1.4, 0.4);
    } else if (kind === 'core') {
      coreIds.add(enemyId);
      const time = score.nextGridTime(ctx.currentTime, 1);
      lowBrass(time, score.chordAt(score.arrangementPositionAt(time)).bass - 12, 0.8, 0.7);
    } else if (kind === 'turret') {
      const time = score.nextGridTime(ctx.currentTime, 2);
      snare(time, 0.35);
    } else if (kind === 'escort') {
      const time = score.nextGridTime(ctx.currentTime, 2);
      brass(time, score.chordAt(score.arrangementPositionAt(time)).stab[0] - 12, 0.35, 0.55, 0.7);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    // The boss emits these synchronously from inside its own `kill` handler,
    // which runs after this module's, so quantizing from the audio clock here
    // still lands on the grid step of the shot that earned the phase change.
    const time = score.nextGridTime(ctx.currentTime, 1);
    if (phase === 'exposed') shieldCollapse(time);
    else if (phase === 'destroyed') flagshipFinale(time);
  });

  return runtime;
}
