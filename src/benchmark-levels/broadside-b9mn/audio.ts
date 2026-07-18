import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createBroadsideVoices, type BroadsideTonalVoice } from './audio-voices';
import { BROADSIDE_BARS, BROADSIDE_BPM, BROADSIDE_DURATION, BROADSIDE_SCORE_SECTIONS, BROADSIDE_STEPS_PER_BAR, BROADSIDE_TIME } from './timing';

// The Broadside score: 144 BPM in D minor, 36 bars = exactly the 60-second
// sortie, written like space opera. Timpani and iron snare drive a low-string
// ostinato; horns swell over each push; the broadside run is the brass peak;
// the eye strips everything to strings and a glass bell; the flagship acts
// turn dark and martial; and the last core resolves the whole level to D
// major. Locks, shots, chips, and kills are notes in this orchestra: they
// snap to the transport, read the live chord, and kills walk per-act melody
// lanes so a clean volley is a fanfare the player performs.

const SIXTEENTH = BROADSIDE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = BROADSIDE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Dm — Bb — F — C, two bars each: the heroic minor loop of the engagement.
const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 65], arp: [62, 65, 69, 74], stab: [62, 65, 69] }, // Dm
  { bass: 34, pad: [46, 53, 58, 62], arp: [58, 62, 65, 70], stab: [58, 62, 65] }, // Bb
  { bass: 41, pad: [45, 53, 57, 60], arp: [57, 60, 65, 69], stab: [57, 60, 65] }, // F
  { bass: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72], stab: [60, 64, 67] }, // C
];
// The eye: one suspended Bbmaj9, barely breathing.
const EYE_CHORDS: Chord[] = [
  { bass: 34, pad: [46, 53, 57, 62], arp: [58, 62, 65, 72], stab: [58, 62, 65] },
];
// Flagship bars 22–30 walk Dm — Gm — Bb — A; the dominant is the shield
// falling. (Array order compensates for absolute-bar chord indexing.)
const ASSAULT_CHORDS: Chord[] = [
  { bass: 31, pad: [43, 50, 55, 58], arp: [55, 58, 62, 67], stab: [55, 58, 62] }, // Gm (bar 24)
  CHORDS[1], // Bb (bar 26)
  { bass: 33, pad: [45, 52, 57, 61], arp: [57, 61, 64, 69], stab: [57, 61, 64] }, // A (bar 28)
  CHORDS[0], // Dm (bar 22)
];
// Trench bars 30–34: Dm — A, the last question before the answer.
const TRENCH_CHORDS: Chord[] = [
  { bass: 33, pad: [45, 52, 57, 61], arp: [57, 61, 64, 69], stab: [57, 61, 64] }, // A (bar 32)
  CHORDS[0], // Dm (bar 30)
];
// Victory: D major, the whole level's release.
const VICTORY_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 66], arp: [62, 66, 69, 74], stab: [62, 66, 69] },
];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Launch: rising calls off the deck.
  0: [
    0, 1, 2, 3, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 6, 7,
    2, 3, 4, 5, 4, 5, 6, 7,
    6, 5, 4, 3, 4, 5, 6, 7,
  ],
  // Gauntlet: driving zig-zags for dense crossings.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    2, 5, 3, 6, 1, 4, 0, 7,
    4, 6, 5, 7, 6, 4, 2, 0,
  ],
  // Broadside: heroic leaps — the trumpet-run act.
  2: [
    0, 2, 4, 7, 4, 2, 4, 7,
    5, 7, 4, 2, 0, 4, 2, 7,
    0, 2, 4, 7, 6, 4, 6, 7,
    7, 4, 5, 2, 4, 0, 2, 4,
  ],
  // The eye: sparse glass in high air.
  3: [
    7, 6, 7, 5, 6, 5, 6, 4,
    5, 4, 5, 6, 5, 6, 7, 6,
    7, 5, 6, 4, 5, 4, 5, 6,
    6, 7, 6, 5, 6, 5, 4, 5,
  ],
  // Assault: hammering runs while the flagship fights back.
  4: [
    7, 5, 4, 2, 4, 5, 4, 2,
    0, 2, 4, 5, 4, 2, 1, 0,
    7, 6, 5, 4, 3, 2, 1, 0,
    2, 4, 5, 7, 5, 4, 2, 4,
  ],
  // Victory lap: the major-key answer.
  5: [
    0, 2, 4, 7, 4, 2, 4, 7,
    4, 5, 7, 5, 4, 2, 0, 2,
    4, 7, 5, 4, 2, 4, 7, 4,
    2, 0, 2, 4, 5, 4, 2, 0,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: BroadsideTonalVoice; kill: BroadsideTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 3100, gain: 0.11, sparkle: 0.5, reverb: 0.22 },
    kill: { oscillator: 'triangle', decay: 0.26, cutoff: 3000, gain: 0.14, sparkle: 0.6, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.07, fallSemitones: 10, noise: 0.05 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 3000, gain: 0.05, sparkle: 0.45, reverb: 0.16 },
    kill: { oscillator: 'square', decay: 0.2, cutoff: 3500, gain: 0.11, sparkle: 0.6, reverb: 0.22 },
    fire: { oscillator: 'sawtooth', cutoff: 3700, gain: 0.055, fallSemitones: 8, noise: 0.055 },
  },
  2: {
    // Broadside run: the player's guns join the brass.
    lock: { oscillator: 'sawtooth', decay: 0.09, cutoff: 2500, gain: 0.055, sparkle: 0.5, reverb: 0.24 },
    kill: { oscillator: 'sawtooth', decay: 0.24, cutoff: 2900, gain: 0.085, sparkle: 0.7, reverb: 0.3 },
    fire: { oscillator: 'sawtooth', cutoff: 3300, gain: 0.06, fallSemitones: 7, noise: 0.06 },
  },
  3: {
    // The eye: glassy, carried, quiet.
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 4400, gain: 0.13, sparkle: 0.8, reverb: 0.4 },
    kill: { oscillator: 'sine', decay: 0.36, cutoff: 4700, gain: 0.15, sparkle: 0.9, reverb: 0.45 },
    fire: { oscillator: 'triangle', cutoff: 2900, gain: 0.05, fallSemitones: 12, noise: 0.03 },
  },
  4: {
    // Assault: harder, closer, drier.
    lock: { oscillator: 'square', decay: 0.09, cutoff: 2400, gain: 0.05, sparkle: 0.35, reverb: 0.18 },
    kill: { oscillator: 'square', decay: 0.24, cutoff: 2700, gain: 0.11, sparkle: 0.5, reverb: 0.24 },
    fire: { oscillator: 'square', cutoff: 2400, gain: 0.045, fallSemitones: 10, noise: 0.05 },
  },
  5: {
    lock: { oscillator: 'triangle', decay: 0.14, cutoff: 3400, gain: 0.1, sparkle: 0.7, reverb: 0.5 },
    kill: { oscillator: 'triangle', decay: 0.45, cutoff: 3600, gain: 0.13, sparkle: 0.85, reverb: 0.55 },
    fire: { oscillator: 'sine', cutoff: 2400, gain: 0.04, fallSemitones: 8, noise: 0.02 },
  },
};

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-b9mn',
  bpm: BROADSIDE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: BROADSIDE_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const genIds = new Set<number>();
  const coreIds = new Set<number>();
  let bossKills = 0;
  let victorious = false;

  const score = createScore<Chord, SectionIndex>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: BROADSIDE_BARS.eye, toBar: BROADSIDE_BARS.belly, chords: EYE_CHORDS, barsPerChord: 1 },
      { fromBar: BROADSIDE_BARS.flagship, toBar: 30, chords: ASSAULT_CHORDS, barsPerChord: 2 },
      { fromBar: 30, toBar: BROADSIDE_BARS.victory, chords: TRENCH_CHORDS, barsPerChord: 2 },
      { fromBar: BROADSIDE_BARS.victory, chords: VICTORY_CHORDS, barsPerChord: 1 },
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
      delay: { time: SIXTEENTH * 3, feedback: 0.26, dampHz: 2500 },
      reverb: { seconds: 3.2, decay: 2.9, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      genIds.clear();
      coreIds.clear();
      bossKills = 0;
      victorious = false;
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) {
        const chord = victorious ? VICTORY_CHORDS[0] : CHORDS[0];
        strings(context.currentTime + 0.05, chord.pad, 5, 0.7, 1400);
      }
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement -----------------------------------------------------------

  const blankBar = '................';
  const marchKick = 'K...K...K...K...'; // timpani on every beat
  const warKick = 'K..K....K.K.....'; // syncopated war pattern
  const backbeat = '....S.......S...';
  const marchSnare = '....S....s..S.s.';
  const tickBar = 't.t.t.t.t.t.t.t.';
  const ostinato16 = 'AAAAAAAAAAAAAAAA';
  const ostinato8 = 'A.A.A.A.A.A.A.A.';

  // Low-string ostinato figure: root, root, fifth, octave shapes per beat.
  const OST_SHAPE = [0, 0, 7, 0, 12, 0, 7, 3, 0, 0, 7, 0, 12, 7, 3, 0];

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
          hits('P...............................', { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.55, 1100)),
          fn(({ time, step, bar, chord }) => { if (step === 8 && bar % 2 === 0) bell(time, chord.arp[bar % 4], 0.28); }),
          fn(({ time, step, bar }) => { if (step === 12 && bar % 2 === 1) boom(time, 0.5); }),
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
          // The catapult: roll into a slam on the downbeat, horns hold Dm.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.2);
            crash(time, 0.32);
            subPulse(time, chord.bass - 12, 1);
            horns(time, chord.pad, 4 * 16 * SIXTEENTH * 0.96, 1.1);
          }),
          hits([blankBar, marchKick, marchKick, marchKick].join(''), { K: 0.8 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits([blankBar, blankBar, marchSnare, marchSnare].join(''), { S: 0.7, s: 0.35 }, ({ time }, vel) => snare(time, vel)),
          hits([blankBar, blankBar, ostinato8, ostinato16].join(''), { A: 0.8 }, ({ time, step, chord }, vel) =>
            stacc(time, chord.bass + OST_SHAPE[step], vel, 1500)),
          oneShot(3, 0, ({ time }) => snareRoll(time, 16 * SIXTEENTH * 0.95, 0.9)),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'gauntlet',
        fromBar: BROADSIDE_BARS.gauntlet,
        tracks: [
          oneShot(0, 0, ({ time }) => crash(time, 0.3)),
          hits(warKick, { K: 0.95 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(marchSnare, { S: 0.8, s: 0.4 }, ({ time }, vel) => snare(time, vel)),
          hits(tickBar, { t: 0.05 }, ({ time }, vel) => tick(time, vel)),
          hits(ostinato16, { A: 0.85 }, ({ time, step, chord }, vel) => stacc(time, chord.bass + OST_SHAPE[step], vel, 1750)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => horns(time, chord.pad, 32 * SIXTEENTH * 1.0, 0.85)),
          // Brass answers on the pickup of every second bar.
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 1 && step === 6) brass(time, chord.stab, 0.8); }),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 1 && step === 14) brass(time, chord.stab.map((n) => n + 12), 0.5); }),
          // Distant capital guns keep the battle wide.
          fn(({ time, step, bar }) => { if ((bar + step) % 3 === 0 && step === 10) boom(time, 0.55); }),
          oneShot(6, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.18)),
          oneShot(6, 8, ({ time }) => snareRoll(time, 8 * SIXTEENTH, 0.7)),
        ],
      },
      {
        name: 'broadside',
        fromBar: BROADSIDE_BARS.broadside,
        tracks: [
          // The peak: the friendly cruiser opens up above your canopy.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.15);
            crash(time, 0.34);
            horns(time, chord.pad.map((n) => n + 12), 16 * SIXTEENTH, 0.9);
          }),
          hits(marchKick, { K: 1 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits('..S...S...S...S.', { S: 0.5 }, ({ time }, vel) => snare(time, vel)),
          hits(marchSnare, { S: 0.85, s: 0.45 }, ({ time }, vel) => snare(time, vel)),
          hits(ostinato16, { A: 0.9 }, ({ time, step, chord }, vel) => stacc(time, chord.bass + 12 + OST_SHAPE[step], vel, 2100)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => horns(time, chord.pad, 32 * SIXTEENTH, 1)),
          // The trumpet theme: a two-bar heroic call, answered.
          fn(({ time, step, barInSection, chord }) => {
            const phrase = barInSection % 2;
            const line: Record<number, [number, number]> = phrase === 0
              ? { 0: [0, 3], 6: [1, 2], 10: [2, 2], 12: [3, 4] }
              : { 0: [3, 3], 6: [2, 2], 8: [1, 2], 12: [0, 6] };
            if (step in line) {
              const [degree, sixteenths] = line[step];
              trumpet(time, chord.arp[degree] + 12, sixteenths * SIXTEENTH, 0.85);
            }
          }),
          // The guns themselves, on the downbeats, felt through the hull.
          fn(({ time, step, chord }) => { if (step === 0 || step === 8) boom(time, 0.9); if (step === 0) subPulse(time, chord.bass - 12, 0.7); }),
          oneShot(4, 0, ({ time }) => riser(time, 12 * SIXTEENTH, 0.14)),
        ],
      },
      {
        name: 'eye',
        fromBar: BROADSIDE_BARS.eye,
        tracks: [
          // Everything stops. Strings barely holding, one bell, your own hull.
          oneShot(0, 0, ({ time, chord }) => {
            strings(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.65, 900);
            subPulse(time, chord.bass - 12, 0.4);
          }),
          hits('t.......t.......', { t: 0.25 }, ({ time }, vel) => tick(time, vel)),
          oneShot(0, 8, ({ time, chord }) => bell(time, chord.arp[3], 0.3)),
          oneShot(1, 0, ({ time, chord }) => bell(time, chord.arp[2], 0.26)),
          oneShot(1, 8, ({ time, chord }) => bell(time, chord.arp[1] + 12, 0.22)),
          oneShot(1, 12, ({ time }) => riser(time, 4 * SIXTEENTH, 0.12)),
          fn(({ time, step }) => { if (step === 4) boom(time, 0.3); }),
        ],
      },
      {
        name: 'belly',
        fromBar: BROADSIDE_BARS.belly,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 0.9);
            horns(time, chord.pad, 32 * SIXTEENTH, 0.8);
          }),
          hits(warKick, { K: 0.9 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(backbeat, { S: 0.75 }, ({ time }, vel) => snare(time, vel)),
          hits(tickBar, { t: 0.045 }, ({ time }, vel) => tick(time, vel)),
          hits(ostinato16, { A: 0.8 }, ({ time, step, chord }, vel) => stacc(time, chord.bass + OST_SHAPE[step], vel, 1600)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 0 && step === 6) brass(time, chord.stab, 0.7); }),
          oneShot(3, 0, ({ time }) => snareRoll(time, 16 * SIXTEENTH * 0.95, 0.8)),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'flagship',
        fromBar: BROADSIDE_BARS.flagship,
        tracks: [
          // Phase one: darker, closer; the ostinato drops back to the low
          // register and the brass turns to warnings.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.25);
            crash(time, 0.26);
            horns(time, [chord.bass + 12, ...chord.pad.slice(0, 3)], 32 * SIXTEENTH, 1.05);
          }),
          hits('K..K....K..K..K.', { K: 1 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits(marchSnare, { S: 0.85, s: 0.45 }, ({ time }, vel) => snare(time, vel)),
          hits(ostinato16, { A: 0.9 }, ({ time, step, chord }, vel) => stacc(time, chord.bass + OST_SHAPE[step], vel, 1400)),
          hits('S.......S.......', { S: 0.7 }, ({ time, chord }, vel) => subPulse(time, chord.bass - 12, vel)),
          fn(({ time, step, barInSection, chord }) => {
            // A falling brass figure every two bars: the flagship answering.
            if (barInSection % 2 === 1 && step === 4) brass(time, chord.stab.map((n) => n - 12), 0.9);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => strings(time, chord.pad, 32 * SIXTEENTH, 0.6, 1200)),
          oneShot(5, 0, ({ time }) => snareRoll(time, 16 * SIXTEENTH * 0.95, 0.9)),
          oneShot(5, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.22)),
        ],
      },
      {
        name: 'trench',
        fromBar: BROADSIDE_BARS.trench,
        tracks: [
          // The dive: hardest drive of the level. Double-time timpani, full
          // ostinato, the horn motif shortened into hammer blows.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.3);
            crash(time, 0.3);
            subPulse(time, chord.bass - 12, 1);
          }),
          hits('K...K...K...K...', { K: 1 }, ({ time, chord }, vel) => timpani(time, chord.bass, vel)),
          hits('..K.......K.....', { K: 0.6 }, ({ time, chord }, vel) => timpani(time, chord.bass + 5, vel)),
          hits(marchSnare, { S: 0.9, s: 0.5 }, ({ time }, vel) => snare(time, vel)),
          hits(tickBar, { t: 0.055 }, ({ time }, vel) => tick(time, vel)),
          hits(ostinato16, { A: 0.95 }, ({ time, step, chord }, vel) => stacc(time, chord.bass + OST_SHAPE[step], vel, 1900)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => horns(time, chord.pad, 32 * SIXTEENTH, 0.95)),
          fn(({ time, step, chord }) => { if (step === 0 || step === 6 || step === 10) brass(time, chord.stab, 0.65); }),
          // The last two bars scream toward the deadline.
          fn(({ time, step, barInSection }) => {
            if (barInSection === 5 && step === 0) riser(time, 16 * SIXTEENTH, 0.26);
            if (barInSection >= 4 && step % 4 === 2) tick(time, 0.4 + barInSection * 0.05);
          }),
        ],
      },
      {
        name: 'victory',
        fromBar: BROADSIDE_BARS.victory,
        toBar: BROADSIDE_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            if (victorious) {
              // The victory theme: D major fanfare over the burning line.
              crash(time, 0.4);
              timpani(time, chord.bass, 1);
              horns(time, chord.pad, 30 * SIXTEENTH, 1.1);
              strings(time, chord.pad.map((n) => n + 12), 30 * SIXTEENTH, 0.8, 1600);
            } else {
              // The flagship endured: the minor loop plays you out, subdued.
              strings(time, CHORDS[0].pad, 30 * SIXTEENTH, 0.7, 1000);
              subPulse(time, CHORDS[0].bass - 12, 0.6);
            }
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (!victorious) return;
            // Trumpet victory line across both bars: D F# A d' — A B A.
            const line: Record<number, [number, number]> = barInSection === 0
              ? { 0: [62, 3], 4: [66, 3], 8: [69, 3], 12: [74, 8] }
              : { 4: [69, 2], 8: [71, 2], 12: [69, 10] };
            if (step in line) {
              const [midi, sixteenths] = line[step];
              trumpet(time, midi + 12, sixteenths * SIXTEENTH, 0.9);
            }
            if (barInSection === 1 && step === 0) timpani(time, chord.bass, 0.8);
          }),
          fn(({ time, step, barInSection }) => {
            if (victorious && barInSection === 0 && step % 4 === 0) boom(time, 0.5);
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
    timpani, snare, snareRoll, tick, subPulse, stacc, horns, brass, trumpet, bell, strings, riser, crash, impact, boom,
    noiseHit, playerSends, playerTone, playerNoise,
  } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.3 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.18 }],
    duration: 0.18,
    stopPadding: 0.04,
    envelope: { decay: 0.18 },
  });

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
    filter: { type: 'lowpass', cutoff: 3400 },
    envelope: { decay: 0.09 },
  });

  // Rejection: a muted horn pair a semitone apart — the fleet's "no".
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 700, Q: 2 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.55,
    stopPadding: 0.05,
    envelope: { decay: 0.55 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  // ---- player instruments ---------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof BroadsideTonalVoice) {
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
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.45, 0.2) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkle * 0.045, 0.08, 7400);
  }

  // Boss structure kills escalate: every generator and core is bigger,
  // brighter, and higher than the last.
  function bossChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    rejectVoice.play({
      context: ctx,
      time,
      frequency: root * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root * (2 + intensity * 1.6), time: time + 0.3 }],
      vel: 0.09 + intensity * 0.09,
      destination: output,
      sends: playerSends(0.2, 0.4),
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon, PLAYER_VOICES[4].kill, 0.55 + intensity * 0.45, 1);
    playerNoise(time, 0.08 + intensity * 0.08, 0.09, 4200);
    subPulse(time, chord.bass - 12, 0.5 + intensity * 0.5);
  }

  function bossFinale(time: number) {
    const audioMix = runtime.mix();
    if (!ctx || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    // The last core: duck everything, one huge hit, and a rising fanfare
    // that hands the arrangement its D-major downbeat.
    audioMix.duckAt(time, 0.1, 1.6);
    impact(time, 1.4);
    crash(time + 0.05, 0.4);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      const at = time + 0.12 + index * SIXTEENTH;
      playerTone(at, leadSet[degree], PLAYER_VOICES[5].kill, 0.9 - index * 0.05, 1);
    });
    trumpet(time + 0.12 + 4 * SIXTEENTH, 86, 6 * SIXTEENTH, 0.9);
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
    playerNoise(time, 0.012 + sparkle * 0.03, 0.022, 9200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      // Full firing solution: the octave call plus a bass drop — broadside armed.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.14 }],
        destination: output,
      });
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

  bus.on('hit', ({ lethal, enemyId }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (genIds.has(enemyId) || coreIds.has(enemyId)) {
      bossChip(time, Math.min(1, (bossKills + 1) / 7));
      return;
    }
    // Armor chip: a tuned clank ringing off the plating.
    const chord = score.chordAt(score.arrangementPositionAt(time));
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
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Plating shears away: bright metal, then the low frame groan.
    noiseHit(time, 0.16, 0.13, 'bandpass', 2400, output);
    const context = ctx;
    for (const midi of [chord.bass + 24, chord.stab[1] + 12]) {
      clankVoice.play({ context, time, midi, gainValue: 0.1, destination: output, sends: playerSends(0.24, 0.4) });
    }
    if (coreIds.has(enemyId) || genIds.has(enemyId)) subPulse(time + 0.04, chord.bass - 12, 0.7);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (coreIds.has(enemyId)) {
      coreIds.delete(enemyId);
      bossKills += 1;
      if (bossKills >= 7) {
        victorious = true;
        bossFinale(kill.time);
        return;
      }
      bossChip(kill.time, Math.min(1, bossKills / 7));
      return;
    }
    if (genIds.has(enemyId)) {
      genIds.delete(enemyId);
      bossKills += 1;
      bossChip(kill.time, Math.min(1, bossKills / 7));
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
    // A clean broadside earns its own fanfare figure.
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[mix.to].kill, (size >= 6 ? 0.7 : 0.55) - index * 0.06, 1);
    });
    if (size >= 6) {
      subPulse(time, score.chordAt(position).bass, 0.6);
      snare(time + 2 * THIRTYSECOND, 0.5);
    }
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Two muted horns a semitone apart: wave-off.
    for (const [midi, at, vel] of [[50, time, 0.12], [49, time + 0.1, 0.1]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency: midiToFreq(midi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi) * 0.7, time: at + 0.17 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.08, 0.06, 'bandpass', 800, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // A hit through the airframe: boom, then a snare drag — the drummer flinches.
    hullBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    snareRoll(time + 0.05, 0.18, 0.5);
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
    if (kind === 'shieldgen') {
      genIds.add(enemyId);
      // A warning call as each generator comes abeam.
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      brass(time, chord.stab.map((n) => n - 12), 0.6);
    } else if (kind === 'core') {
      coreIds.add(enemyId);
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      subPulse(time, chord.bass - 12, 0.8);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'exposed') {
      // The shield falls: duck the orchestra for a breath, then a downward
      // shimmer as the film tears away.
      const time = score.nextGridTime(ctx.currentTime, 1);
      runtime.mix()?.duckAt(time, 0.25, 1.1);
      crash(time, 0.3);
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      leadSet.slice().reverse().forEach((midi, index) => {
        playerTone(time + 0.06 + index * THIRTYSECOND * 2, midi, PLAYER_VOICES[4].kill, 0.6 - index * 0.05, 1);
      });
    }
  });

  return runtime;
}
