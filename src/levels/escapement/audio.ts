import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep, type MixBus } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementContext, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { MAX_LOCKS } from '../../engine/locks';
import { createScore, type SectionMix } from '../../engine/score';
import type { LevelAudio } from '../../engine/types';
import { createEscapementVoices, type EscapementChimeVoice, type EscapementClickVoice } from './audio-voices';
import {
  ESCAPEMENT_BARS,
  ESCAPEMENT_BPM,
  ESCAPEMENT_DURATION,
  ESCAPEMENT_SCORE_SECTIONS,
  ESCAPEMENT_STEPS_PER_BAR,
  ESCAPEMENT_TIME,
} from './timing';

// The Escapement score: 120 BPM, 60 bars, one tick on every beat. D minor
// inside the works, D Lydian across the Orrery, D major for the Free Run. The
// hour bell strikes at bar 26 and the kick drum arrives with it. During the
// boss, gameplay calls `ringBell` on each landed hit; the twelve rings climb
// the D minor scale from D4 and the twelfth is the kill, which frees the clock
// and lets the Free Run glissando up an octave into the final strike on bar 60.
// Player actions are notes in this score: locks click up the live chord,
// kills walk a hidden chime lane, chimes ring the pitch they were given at
// spawn, and every action lands on the transport grid.

const SIXTEENTH = ESCAPEMENT_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const BEAT = ESCAPEMENT_TIME.beatSeconds;
const BAR = ESCAPEMENT_TIME.barSeconds;
const STEPS_PER_BAR = ESCAPEMENT_STEPS_PER_BAR;
const LANE_STEPS = 32;
// Off-eighths in the Pendulum land on the triplet: one sixth of a beat late.
const SWING = BEAT / 6;

type Chord = {
  /** Bass root, MIDI. */
  bass: number;
  /** Four sustained pad notes in the D3 register. */
  pad: number[];
  /** Four figure notes in the D4 register for the celesta and marimba. */
  figure: number[];
  /** Six harp-arpeggio notes. */
  harp: number[];
  /** Four lead notes in the D5 register; the lead set is these plus the octave above. */
  lead: number[];
};

// D minor inside the works. A7 carries the raised leading tone.
const DM: Chord = { bass: 38, pad: [50, 53, 57, 62], figure: [62, 65, 69, 72], harp: [62, 65, 69, 72, 74, 77], lead: [74, 77, 81, 84] };
const BB: Chord = { bass: 34, pad: [50, 53, 58, 62], figure: [62, 65, 70, 74], harp: [58, 62, 65, 70, 74, 77], lead: [74, 77, 82, 86] };
const GM: Chord = { bass: 31, pad: [50, 55, 58, 62], figure: [62, 67, 70, 74], harp: [55, 58, 62, 67, 70, 74], lead: [74, 79, 82, 86] };
const A7: Chord = { bass: 33, pad: [52, 55, 57, 61], figure: [61, 64, 67, 69], harp: [57, 61, 64, 67, 69, 73], lead: [73, 76, 79, 81] };
const AM: Chord = { bass: 33, pad: [52, 55, 57, 60], figure: [60, 64, 67, 69], harp: [57, 60, 64, 67, 69, 72], lead: [72, 76, 79, 81] };
// D Lydian across the Orrery. The G sharp lives in the harp sets.
const D_LYDIAN: Chord = { bass: 38, pad: [50, 54, 57, 61], figure: [62, 66, 69, 73], harp: [62, 66, 69, 73, 74, 80], lead: [74, 78, 81, 85] };
const E_OVER_D: Chord = { bass: 38, pad: [52, 56, 59, 64], figure: [64, 68, 71, 74], harp: [64, 68, 71, 74, 76, 80], lead: [76, 80, 83, 86] };
const BM9: Chord = { bass: 35, pad: [50, 54, 57, 61], figure: [59, 62, 66, 69], harp: [59, 62, 66, 69, 73, 74], lead: [74, 78, 81, 85] };
const A_ADD9: Chord = { bass: 33, pad: [52, 57, 61, 64], figure: [61, 64, 69, 71], harp: [57, 61, 64, 69, 71, 76], lead: [76, 81, 83, 88] };
// D major for the Free Run.
const D_MAJOR: Chord = { bass: 38, pad: [50, 54, 57, 62], figure: [62, 66, 69, 74], harp: [62, 66, 69, 74, 76, 81], lead: [74, 78, 81, 86] };
const A_MAJOR: Chord = { bass: 33, pad: [52, 57, 61, 64], figure: [61, 64, 69, 73], harp: [57, 61, 64, 69, 71, 73], lead: [76, 81, 85, 88] };

const WORKS_CHORDS: Chord[] = [DM, BB, GM, A7];
// Alternate sets index by absolute bar, so each list is ordered to put D minor
// on the section's first bar. The Pendulum set is one chord per bar so each
// two-bar swing holds one chord starting on the section's odd first bar.
const ORRERY_CHORDS: Chord[] = [D_LYDIAN, E_OVER_D, BM9, A_ADD9];
const PENDULUM_CHORDS: Chord[] = [GM, BB, BB, AM, AM, DM, DM, GM];
const BOSS_CHORDS: Chord[] = [AM, DM, BB, GM];
const FREE_RUN_CHORDS: Chord[] = [D_MAJOR, A_MAJOR];

// The twelve boss rings: D natural minor from D4 to A5.
export const BELL_SCALE = [62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79, 81] as const;
// The hour bell's prime: D3.
const HOUR_BELL_MIDI = 50;

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

// Kill lanes: degrees 0–7 into the live lead set, one per sixteenth over two bars.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Barrel and Train: a stepwise clockwork arch.
  0: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 6, 5, 7, 6, 4, 5, 3,
    4, 2, 3, 1, 2, 0, 1, 2,
    3, 5, 4, 6, 5, 7, 6, 4,
  ],
  // Orrery: wide slow leaps.
  1: [
    0, 4, 7, 4, 2, 5, 7, 5,
    3, 6, 7, 6, 4, 7, 6, 5,
    0, 3, 5, 7, 5, 3, 0, 2,
    4, 6, 7, 6, 4, 2, 4, 5,
  ],
  // Strike: descending peals.
  2: [
    7, 5, 3, 0, 7, 5, 3, 0,
    6, 4, 2, 0, 6, 4, 2, 0,
    7, 6, 5, 4, 3, 2, 1, 0,
    5, 3, 1, 0, 5, 3, 1, 0,
  ],
  // Pendulum: alternating rise and fall, one arc per beat.
  3: [
    0, 4, 2, 6, 1, 5, 3, 7,
    7, 3, 5, 1, 6, 2, 4, 0,
    0, 4, 2, 6, 1, 5, 3, 7,
    7, 5, 3, 1, 6, 4, 2, 0,
  ],
  // Boss: tolling descents answered by a climb.
  4: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
  // Free Run: climbing runs that pile up at the top.
  5: [
    0, 1, 2, 3, 4, 5, 6, 7,
    1, 2, 3, 4, 5, 6, 7, 7,
    2, 3, 4, 5, 6, 7, 7, 7,
    3, 4, 5, 6, 7, 7, 7, 7,
  ],
};

const PLAYER_VOICES: Record<SectionIndex, { kill: EscapementChimeVoice; lock: EscapementClickVoice }> = {
  0: { kill: { bright: 0.5, decay: 0.9, gain: 0.16, hall: 0.25 }, lock: { cutoff: 2600, gain: 0.07 } },
  1: { kill: { bright: 0.8, decay: 1.6, gain: 0.15, hall: 0.6 }, lock: { cutoff: 3400, gain: 0.06 } },
  2: { kill: { bright: 0.6, decay: 1.2, gain: 0.17, hall: 0.45 }, lock: { cutoff: 2800, gain: 0.07 } },
  3: { kill: { bright: 0.55, decay: 1.0, gain: 0.16, hall: 0.35 }, lock: { cutoff: 2600, gain: 0.07 } },
  4: { kill: { bright: 0.9, decay: 0.7, gain: 0.17, hall: 0.3 }, lock: { cutoff: 3200, gain: 0.075 } },
  5: { kill: { bright: 1, decay: 1.4, gain: 0.18, hall: 0.6 }, lock: { cutoff: 3600, gain: 0.07 } },
};

// Chimes take their pitch from the live lead set in this degree order, so a
// row of chimes spawned together forms a spread chord.
const CHIME_DEGREES = [0, 2, 4, 6, 1, 3, 5, 7];
const OSTINATO = [0, 2, 1, 3, 2, 0, 3, 1];
const HARP_ORDER = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];
const BOSS_CELESTA_ORDER = [0, 1, 2, 3, 3, 2, 1, 0, 0, 2, 1, 3, 3, 1, 2, 0];
// The end-of-run peal when the clock is freed: D major falling from D6.
const FREED_PEAL = [86, 85, 81, 78, 74, 73, 69, 66, 62];

/**
 * Enemy kinds the score reacts to on `spawn`. The integrator aligns these
 * strings with the kinds gameplay.ts spawns.
 */
export const ESCAPEMENT_AUDIO_KINDS: Record<'chime' | 'waspBolt' | 'boss', string[]> = {
  /** Each chime is given a pitch from the live chord at spawn and rings it when killed. */
  chime: ['chime'],
  /** A spawned bolt plays the wasp's bolt sound. */
  waspBolt: ['wasp-bolt'],
  /** Boss parts: their hits and kills are voiced only through `ringBell` and `jewelBreak`. */
  boss: ['pallet-jewel', 'arbor'],
};

export type EscapementAudioApi = {
  /**
   * One landed boss hit. `index` 0–11 picks the ring's scale degree; the
   * twelfth ring (index 11) is the kill: it also strikes the hour bell and
   * frees the clock for the Free Run. `target` defaults to jewel for the
   * first six rings and arbor after.
   */
  ringBell(index: number, target?: 'jewel' | 'arbor'): void;
  /** A pallet jewel breaks: fork shear and a falling plate. */
  jewelBreak(): void;
  /** A ratchet enemy takes one step; `stage` 0–2 is its broken-armour stage. */
  ratchetStep(stage: number): void;
  /** An oxide tick leaps at the rail. */
  tickLeap(): void;
  /** A jewel wasp fires a bolt. The score also plays this on a `spawn` of a wasp-bolt kind. */
  waspBolt(): void;
  /** The pitch a chime was given at spawn, or undefined for other enemies. */
  chimePitch(enemyId: number): number | undefined;
  /** Gear hand-off: the whoosh and the one-beat low-pass drop. The score plays this itself at bars 10 and 14. */
  gearHandoff(): void;
  /** The hour strike. The score plays this itself on bar 26's downbeat. */
  strike(): void;
  /** True once the twelfth bell has rung this run. */
  clockFreed(): boolean;
};

export type EscapementLevelAudio = LevelAudio & { escapement: EscapementAudioApi };

const registry = new WeakMap<EventBus, EscapementAudioApi>();

/** The gameplay-facing audio API created for `bus`, once `createAudio(bus)` has run. */
export function escapementAudio(bus: EventBus): EscapementAudioApi | null {
  return registry.get(bus) ?? null;
}

export function createAudio(bus: EventBus): EscapementLevelAudio {
  const { runtime, api } = createEscapementAudio(bus);
  registry.set(bus, api);
  return { ...runtime.audio, escapement: api };
}

export const traceEscapementAudio = createAudioTraceHarness({
  level: 'escapement',
  bpm: ESCAPEMENT_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: ESCAPEMENT_DURATION + 0.5,
  createAudio: (bus, trace) => createEscapementAudio(bus, trace).runtime,
});

export function createEscapementAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let musicFilter: BiquadFilterNode | null = null;
  let clockFreed = false;
  let chimeCounter = 0;
  const chimePitches = new Map<number, number>();
  const bossIds = new Set<number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: ESCAPEMENT_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: WORKS_CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: ESCAPEMENT_BARS.orrery, toBar: ESCAPEMENT_BARS.strike, chords: ORRERY_CHORDS, barsPerChord: 2 },
      { fromBar: ESCAPEMENT_BARS.strike, toBar: ESCAPEMENT_BARS.pendulum, chords: [DM], barsPerChord: 1 },
      { fromBar: ESCAPEMENT_BARS.pendulum, toBar: ESCAPEMENT_BARS.boss, chords: PENDULUM_CHORDS, barsPerChord: 1 },
      { fromBar: ESCAPEMENT_BARS.boss, toBar: ESCAPEMENT_BARS.freeRun, chords: BOSS_CHORDS, barsPerChord: 2 },
      { fromBar: ESCAPEMENT_BARS.freeRun, toBar: ESCAPEMENT_BARS.end + 1, chords: FREE_RUN_CHORDS, barsPerChord: 2 },
    ],
    sections: ESCAPEMENT_SCORE_SECTIONS,
    leadSet: (chord) => [...chord.lead, ...chord.lead.map((midi) => midi + 12)],
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
      compressor: { threshold: -16, ratio: 5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2400 },
      // The hall returns to the master, so a mix duck leaves the bell's tail ringing.
      reverb: { seconds: 3.6, decay: 2.4, level: 0.42, returnTo: 'master' },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      musicFilter = installMusicFilter(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      // A trace has no gameplay to ring the bells, so it shows the freed finale.
      clockFreed = trace !== undefined;
      chimeCounter = 0;
      chimePitches.clear();
      bossIds.clear();
      const context = runtime.context();
      if (context) wind(context.currentTime + 0.02, DM.bass, 9, 0.09, true);
    },
    onDispose() {
      ctx = null;
      musicFilter = null;
    },
  });

  // ---- glissando ---------------------------------------------------------------
  // Once the clock is freed, every pitched part rises an octave across the
  // four Free Run bars on an accelerating curve: three semitones by the
  // halfway point, the full octave at bar 60.

  function glideRatioAt(time: number) {
    if (!clockFreed || runtime.mode() !== 'run') return 1;
    const bar = ((time - score.epoch) / SIXTEENTH - score.arrangementStart) / STEPS_PER_BAR;
    const t = (bar - ESCAPEMENT_BARS.freeRun) / (ESCAPEMENT_BARS.end - ESCAPEMENT_BARS.freeRun);
    if (t <= 0) return 1;
    if (t >= 1) return 2;
    return 2 ** (t * t);
  }

  const voices = createEscapementVoices({
    trace,
    context: () => ctx,
    mix: runtime.mix,
    glide: (time, duration) => ({ start: glideRatioAt(time), end: glideRatioAt(time + duration) }),
  });
  const {
    tick, ratchet, celesta, marimba, harp, pad, swell, bass, kick, crack, bell, bossBell, chime, whoosh, riser,
    spring, click, deadPawl, shear, clank, leap, bolt, wind, sparkle,
  } = voices;

  // ---- level-wide gestures ------------------------------------------------------

  /** The hand-off low-pass: closed in 45 ms on the downbeat, open again one beat later. */
  function dropFilter(time: number) {
    if (trace) {
      trace.record(time, 'filterDrop');
      return;
    }
    if (!musicFilter) return;
    const frequency = musicFilter.frequency;
    frequency.cancelScheduledValues(time);
    frequency.setValueAtTime(18000, time);
    frequency.exponentialRampToValueAtTime(260, time + 0.045);
    frequency.exponentialRampToValueAtTime(18000, time + BEAT);
  }

  /** The hour bell with a one-bar duck under it. */
  function strikeAt(time: number) {
    bell(time, HOUR_BELL_MIDI, 1);
    runtime.mix()?.duckAt(time, 0.12, BAR);
  }

  /** The twelfth ring: the hour bell under it, and the clock is freed. */
  function bossKill(time: number) {
    clockFreed = true;
    bell(time, HOUR_BELL_MIDI, 0.7);
    runtime.mix()?.duckAt(time, 0.12, BAR);
    whoosh(time, BEAT * 2, 0.2);
  }

  /** Bar 60's downbeat: the hour bell and the twelfth ring together. */
  function finalStrike(time: number) {
    bell(time, HOUR_BELL_MIDI, 1);
    bossBell(time, BELL_SCALE[BELL_SCALE.length - 1], 1);
    runtime.mix()?.duckAt(time, 0.1, 1.5);
  }

  // ---- arrangement --------------------------------------------------------------

  type Ctx = ArrangementContext<Chord>;
  const swingOffset = (step: number) => (step % 4 === 2 ? SWING : 0);

  /** The tick at one of five densities. Pairs alternate tick/tock in pitch and pan. */
  function tickTrack(density: 'quarter' | 'half' | 'eighth' | 'sixteenth' | 'whirr', hall: number, vel: number | ((ctx: Ctx) => number) = 1) {
    return fn<Chord>((ctx) => {
      const { time, step } = ctx;
      const level = typeof vel === 'function' ? vel(ctx) : vel;
      const kindFor = (n: number) => (n % 2 === 0 ? 'tick' : 'tock');
      switch (density) {
        case 'quarter':
          if (step % 4 === 0) tick(time, kindFor(step / 4), level, hall);
          return;
        case 'half':
          if (step % 8 === 0) tick(time, kindFor(step / 8), level, hall);
          return;
        case 'eighth':
          if (step % 2 === 0) tick(time, kindFor(step / 2), level * (step % 4 === 0 ? 1 : 0.65), hall);
          return;
        case 'sixteenth':
          tick(time, kindFor(step), level * (step % 4 === 0 ? 1 : step % 2 === 0 ? 0.6 : 0.45), hall);
          return;
        case 'whirr':
          tick(time, 'tick', level * (step % 4 === 0 ? 0.9 : 0.5), hall);
          tick(time + THIRTYSECOND, 'tock', level * 0.4, hall);
      }
    });
  }

  /** Runs `track` only from `barInSection` on. */
  function fromBar(barInSection: number, track: ArrangementTrack<Chord>) {
    return fn<Chord>((ctx) => {
      if (ctx.barInSection >= barInSection) track.run(ctx);
    });
  }

  /** The celesta's eight-note clockwork figure, one note per eighth. */
  function celestaOstinato(vel: (ctx: Ctx) => number, octave: (ctx: Ctx) => number, duration: number, swung = false) {
    return fn<Chord>((ctx) => {
      if (ctx.step % 2 !== 0) return;
      const eighth = ctx.step / 2;
      const degrees = ctx.barInSection % 2 === 0 || octave(ctx) === 0 ? OSTINATO : [...OSTINATO].reverse();
      const midi = ctx.chord.figure[degrees[eighth]] + octave(ctx);
      celesta(ctx.time + (swung ? swingOffset(ctx.step) : 0), midi, vel(ctx), duration);
    });
  }

  /** A marimba pattern: each symbol names a figure degree and a velocity, played an octave down. */
  function marimbaTrack(pattern: string, notes: Record<string, [degree: number, vel: number]>, swung = false) {
    const velocities: Record<string, number> = {};
    for (const [symbol, [, vel]] of Object.entries(notes)) velocities[symbol] = vel;
    return hits<Chord>(pattern, velocities, (ctx, vel, symbol) => {
      const midi = ctx.chord.figure[notes[symbol][0]] - 12;
      marimba(ctx.time + (swung ? swingOffset(ctx.step) : 0), midi, vel);
    });
  }

  function bassTrack(pattern: string, notes: Record<string, [offset: number, vel: number, duration: number]>, drive: number | ((ctx: Ctx) => number), swung = false) {
    const velocities: Record<string, number> = {};
    for (const [symbol, [, vel]] of Object.entries(notes)) velocities[symbol] = vel;
    return hits<Chord>(pattern, velocities, (ctx, vel, symbol) => {
      const [offset, , duration] = notes[symbol];
      bass(ctx.time + (swung ? swingOffset(ctx.step) : 0), ctx.chord.bass + offset, vel, duration, typeof drive === 'function' ? drive(ctx) : drive);
    });
  }

  /** Accelerating ratchet clicks across the last two beats of a bar. */
  function ratchetLift(barInSection: number, level: number) {
    return fn<Chord>(({ time, step, barInSection: current }) => {
      if (current !== barInSection || step < 8) return;
      ratchet(time, level + (step - 8) * 0.06, 2, THIRTYSECOND / 2, step % 2 === 0 ? -0.4 : 0.4, 'music');
    });
  }

  /** Pawl cracks on every even step of a bar's second half, rising. */
  function crackRoll(barInSection: number, from: number, every = 2) {
    return fn<Chord>(({ time, step, barInSection: current }) => {
      if (current !== barInSection || step < 8 || step % every !== 0) return;
      crack(time, from + (step - 8) * 0.08);
    });
  }

  const trainBass = bassTrack('B...b...B...b...', { B: [0, 0.85, 0.4], b: [0, 0.6, 0.3] }, 0);

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: (position) => WORKS_CHORDS[Math.floor(position / STEPS_PER_BAR / 2) % WORKS_CHORDS.length],
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        tickTrack('quarter', 0.3, 0.55),
        fn(({ time, step, bar, chord }) => {
          if (step === 0 && bar % 2 === 0) celesta(time, chord.figure[0], 0.35, 1.2);
          if (step === 8 && bar % 2 === 1) celesta(time, chord.figure[2], 0.28, 1);
        }),
        fn(({ time, step, bar, chord }) => {
          if (step === 0 && bar % 4 === 0) pad(time, [chord.bass + 12, chord.pad[1]], 4 * BAR * 1.02, 0.35, 260, 1.2, 1.2, 0.5);
        }),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        // Movement 1a. The tick, the celesta figure, then marimba and bass join.
        name: 'barrel',
        fromBar: ESCAPEMENT_BARS.barrel,
        tracks: [
          tickTrack('quarter', 0.15),
          celestaOstinato(({ barInSection }) => 0.32 + barInSection * 0.03, () => 0, 0.55),
          fromBar(2, marimbaTrack('M.....m.M.....m.', { M: [0, 0.8], m: [2, 0.55] })),
          fromBar(4, bassTrack('B.......b.......', { B: [0, 0.8, 0.9], b: [0, 0.6, 0.6] }, 0)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0 && barInSection % 2 === 0) pad(time, [chord.bass + 12, chord.bass + 19], 2 * BAR * 1.05, 0.5, 300, 0.8, 0.8, 0.3);
          }),
          ratchetLift(6, 0.25),
        ],
      },
      {
        // Movement 1b. Ratchet percussion, a busier marimba, and the two hand-offs.
        name: 'train',
        fromBar: ESCAPEMENT_BARS.train,
        tracks: [
          tickTrack('quarter', 0.12),
          hits('......R.......R.', { R: 0.6 }, ({ time, step }, vel) => ratchet(time, vel, 4, THIRTYSECOND / 2, step === 6 ? -0.4 : 0.4, 'music')),
          celestaOstinato(() => 0.5, ({ barInSection }) => (barInSection % 2 === 1 ? 12 : 0), 0.5),
          marimbaTrack('M..m..o.M..n..o.', { M: [0, 0.85], m: [1, 0.55], n: [3, 0.55], o: [2, 0.7] }),
          // The bass sits out the hand-off downbeats so the filter drop reads as the wheel letting go.
          fn((ctx) => {
            if (ctx.step === 0 && (ctx.barInSection === 3 || ctx.barInSection === 7)) return;
            trainBass.run(ctx);
          }),
          oneShot(2, 12, ({ time }) => whoosh(time, BEAT * 1.5, 0.22)),
          oneShot(3, 0, ({ time }) => dropFilter(time)),
          oneShot(6, 12, ({ time }) => whoosh(time, BEAT * 1.5, 0.22)),
          oneShot(7, 0, ({ time }) => dropFilter(time)),
          oneShot(8, 0, ({ time }) => riser(time, 2 * BAR, 0.16)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0 && barInSection >= 8) pad(time, chord.pad, BAR * 1.05, 0.5 + 0.2 * (barInSection - 8), 700, 0.5, 0.4, 0.5);
          }),
          oneShot(9, 12, ({ time }) => whoosh(time, BEAT * 2, 0.28)),
        ],
      },
      {
        // Movement 2. Wide chords, harp arpeggios, the tick at half time in a long hall.
        name: 'orrery',
        fromBar: ESCAPEMENT_BARS.orrery,
        tracks: [
          tickTrack('half', 0.6, 1.1),
          fn(({ time, step, barInSection, chord }) => {
            if (step !== 0) return;
            const bars = barInSection === 0 ? 1 : barInSection % 2 === 1 ? 2 : 0;
            if (!bars) return;
            pad(time, chord.pad, bars * BAR * 1.04, 1, 1100, 0.7, 0.9, 0.7);
            pad(time, chord.pad.map((midi) => midi + 12), bars * BAR * 1.04, 0.35, 2400, 1.2, 1, 0.8);
            bass(time, chord.bass, 0.8, bars * BAR * 0.95, 0);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (step % 2 !== 0) return;
            const index = (barInSection * 8 + step / 2) % HARP_ORDER.length;
            harp(time, chord.harp[HARP_ORDER[index]], step % 8 === 0 ? 0.8 : 0.55, 1.2, 0.5);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 8 && barInSection % 2 === 1) celesta(time, chord.figure[3] + 12, 0.4, 1.4);
            if (step === 4 && barInSection % 2 === 0) celesta(time, chord.figure[1] + 12, 0.3, 1.2);
          }),
          oneShot(7, 0, ({ time }) => riser(time, 2 * BAR, 0.24)),
          ratchetLift(8, 0.3),
        ],
      },
      {
        // Drop 1. The hour bell, a one-bar duck, and the kick's first appearance.
        name: 'strike',
        fromBar: ESCAPEMENT_BARS.strike,
        tracks: [
          oneShot(0, 0, ({ time }) => strikeAt(time)),
          fn(({ time, step, barInSection }) => {
            if (step === 0 || step === 8) kick(time, step === 0 ? 1 : 0.85, barInSection > 0);
          }),
          tickTrack('quarter', 0.3),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection === 0) harp(time, chord.harp[step % 6] + 12 * Math.floor(step / 6), 0.5 - step * 0.015, 0.8, 0.4);
          }),
          oneShot(0, 0, ({ time, chord }) => pad(time, [chord.bass + 12, ...chord.pad], 3 * BAR, 0.8, 500, 0.05, 1.5, 0.5)),
          bassTrack('B.......B.......', { B: [0, 0.9, 0.9] }, 0.2),
          fromBar(1, marimbaTrack('M.....m.M.....m.', { M: [0, 0.7], m: [2, 0.5] })),
          crackRoll(2, 0.3),
          ratchetLift(2, 0.35),
        ],
      },
      {
        // Movement 3. Swung half time; one bass-pad swell per two-bar swing.
        name: 'pendulum',
        fromBar: ESCAPEMENT_BARS.pendulum,
        tracks: [
          tickTrack('quarter', 0.25),
          hits('K...............', { K: 1 }, ({ time }, vel) => kick(time, vel, true)),
          hits('........X.......', { X: 0.8 }, ({ time }, vel) => crack(time, vel)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0 && barInSection % 2 === 0) swell(time, chord.bass, 2 * BAR, 0.9);
          }),
          fn(({ time, step, chord }) => {
            if (step % 2 !== 0) return;
            const eighth = step / 2;
            marimba(time + swingOffset(step), chord.figure[[0, 1, 2, 1, 3, 2, 1, 0][eighth]] - 12, eighth % 2 === 0 ? 0.8 : 0.5);
          }),
          fn(({ time, step, chord }) => {
            const notes: Record<number, [degree: number, vel: number]> = { 0: [3, 0.5], 6: [1, 0.4], 8: [2, 0.5], 14: [0, 0.4] };
            if (step in notes) celesta(time + swingOffset(step), chord.figure[notes[step][0]] + 12, notes[step][1], 0.5);
          }),
          bassTrack('B.....b.B.....b.', { B: [0, 0.9, 0.35], b: [12, 0.55, 0.25] }, 0.2, true),
          hits('..........R.....', { R: 0.5 }, ({ time, step }, vel) => ratchet(time + swingOffset(step), vel, 3, THIRTYSECOND / 2, 0.3, 'music')),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 4 && barInSection % 2 === 0) harp(time, chord.harp[5], 0.5, 1.5, 0.5);
          }),
          oneShot(11, 0, ({ time }) => riser(time, 2 * BAR, 0.26)),
          crackRoll(12, 0.35),
          ratchetLift(12, 0.4),
        ],
      },
      {
        // The boss. The tick doubles to eighths, the bass distorts, the celesta races.
        name: 'boss',
        fromBar: ESCAPEMENT_BARS.boss,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            kick(time, 1, true);
            crack(time, 0.8);
            bass(time, chord.bass, 0.8, 0.8, 1);
          }),
          tickTrack('eighth', 0.1),
          fn(({ time, step, barInSection }) => {
            const steps = barInSection % 2 === 0 ? [0, 8] : [0, 8, 13];
            if (steps.includes(step)) kick(time, step === 0 ? 1 : 0.85, true);
          }),
          hits('....X.......X...', { X: 0.9 }, ({ time }, vel) => crack(time, vel)),
          fn(({ time, step, barInSection, chord }) => {
            const notes: Record<number, [offset: number, vel: number]> = {
              0: [0, 1], 2: [12, 0.6], 3: [0, 0.8], 6: [7, 0.7], 8: [0, 0.95], 10: [12, 0.6], 11: [0, 0.75], 14: [7, 0.7],
            };
            if (step in notes) bass(time, chord.bass + notes[step][0], notes[step][1], 0.2, barInSection >= 8 ? 1 : 0.7);
          }),
          fn(({ time, step, chord }) => celesta(time, chord.figure[BOSS_CELESTA_ORDER[step]] + 12, step % 4 === 0 ? 0.36 : 0.22, 0.25)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0 && barInSection % 2 === 0) pad(time, [chord.bass + 12, ...chord.pad], 2 * BAR * 1.03, 0.8, 600, 0.3, 0.5, 0.35);
          }),
          oneShot(6, 0, ({ time }) => riser(time, 2 * BAR, 0.22)),
          crackRoll(7, 0.4),
          oneShot(12, 0, ({ time }) => riser(time, 2 * BAR, 0.3)),
          crackRoll(13, 0.3, 1),
        ],
      },
      {
        // Free Run. Freed: everything slides up an octave into the final strike.
        // Not freed: the clock winds down in silence.
        name: 'free-run',
        fromBar: ESCAPEMENT_BARS.freeRun,
        toBar: ESCAPEMENT_BARS.end,
        tracks: [
          fn((ctx) => (clockFreed ? freedRun(ctx) : silentRun(ctx))),
        ],
      },
    ],
  });

  const freedTick = [tickTrack('sixteenth', 0.2, ({ barInSection }) => 0.8 - barInSection * 0.1), tickTrack('whirr', 0.2, ({ barInSection }) => 0.8 - barInSection * 0.1)];
  const freedKick = hits<Chord>('K...K...K...K...', { K: 0.95 }, ({ time }, vel) => kick(time, vel, true));
  const freedCrack = hits<Chord>('....X.......X...', { X: 0.85 }, ({ time }, vel) => crack(time, vel));
  const freedCelesta = celestaOstinato(() => 0.45, () => 12, 0.4);
  const freedBass = bassTrack('B...B...B...B...', { B: [0, 0.9, 0.3] }, 0.4);

  function freedRun(ctx: Ctx) {
    const { time, step, barInSection, chord } = ctx;
    freedTick[barInSection < 2 ? 0 : 1].run(ctx);
    freedKick.run(ctx);
    freedCrack.run(ctx);
    freedCelesta.run(ctx);
    freedBass.run(ctx);
    harp(time, chord.harp[step % 6] + 12 * Math.floor(step / 6), step % 4 === 0 ? 0.6 : 0.4, 0.7, 0.5);
    if (step === 0 && barInSection % 2 === 0) {
      pad(time, [...chord.pad, ...chord.pad.map((midi) => midi + 12)], 2 * BAR * 1.03, 1, 1400, 0.2, 0.4, 0.7);
    }
    if (barInSection === 3 && step === 15) finalStrike(time + SIXTEENTH);
  }

  const silentTick = tickTrack('quarter', 0.4, ({ barInSection }) => 0.7 - barInSection * 0.12);

  function silentRun(ctx: Ctx) {
    const { time, step, barInSection } = ctx;
    silentTick.run(ctx);
    if (step === 0 && barInSection === 0) pad(time, DM.pad, 4 * BAR, 0.7, 500, 0.5, 3, 0.5);
    if (step === 0) bass(time, DM.bass, 0.7 - barInSection * 0.15, 1.2, 0);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments ------------------------------------------------
  // Every action snaps to the transport grid and reads the live chord there.

  function chimeBlend(time: number, midi: number, mix: SectionMix<SectionIndex>, vel: number) {
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const voice = PLAYER_VOICES[section].kill;
      chime(time, midi, vel * weight, voice.bright, voice.decay, voice.gain, voice.hall);
    }
  }

  /** A kill on the hidden chime lane. Chained volley kills crescendo and gain an octave shimmer. */
  function killNote(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const vel = Math.min(1.4, 1 + chain * 0.12);
    chimeBlend(time, midi, mix, vel);
    if (chain >= 2) chime(time, midi + 12, 0.5, 0.6, 0.8, 0.1, 0.4);
    const bright = PLAYER_VOICES[mix.to].kill.bright;
    sparkle(time, 0.02 + 0.04 * bright, 0.08, 7000);
  }

  /** A chime enemy rings the pitch it was given at spawn. */
  function chimeKill(time: number, midi: number) {
    chime(time, midi, 1.1, 0.7, 1.6, 0.18, 0.5);
    chime(time + THIRTYSECOND, midi + 12, 0.35, 0.8, 0.9, 0.1, 0.5);
    sparkle(time, 0.06, 0.1, 6500);
  }

  /** The six-lock release: a bell chord from the live chord. */
  function bellChord(time: number, position: number) {
    const chord = score.chordAt(position);
    chord.lead.forEach((midi, index) => chime(time + index * 0.012, midi, 0.5, 0.7, 1.4, 0.15, 0.5));
    bossBell(time, chord.lead[0] - 12, 0.4);
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const midi = leadSet[Math.min(leadSet.length - 1, Math.max(0, lockCount - 1))];
    for (const [section, weight] of score.sectionLayers(score.sectionMixAt(position))) {
      if (weight < 0.02) continue;
      const voice = PLAYER_VOICES[section].lock;
      click(time, midi, voice.cutoff + lockCount * 220, voice.gain, weight);
    }
    if (lockCount >= MAX_LOCKS) {
      // The pawl seats: a deeper click and a soft chime an octave up.
      click(time, score.chordAt(position).bass + 24, 1200, 0.08, 1);
      chime(time + THIRTYSECOND, midi + 12, 0.45, 0.6, 0.6, 0.12, 0.3);
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    click(time, score.chordAt(score.arrangementPositionAt(time)).bass + 24, 1200, 0.03, 1);
  });

  bus.on('fire', ({ volleySize, indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const index = indexInVolley ?? 0;
    spring(time, score.chordAt(position).bass + 24, 1 - index * 0.05);
    if (volleySize >= MAX_LOCKS && index === 0) bellChord(time, position);
  });

  bus.on('hit', ({ lethal, enemyId, hitStageIndex }) => {
    if (lethal || !ctx || bossIds.has(enemyId)) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
    click(time, leadSet[(hitStageIndex * 2 + 1) % leadSet.length], 3000, 0.07, 1);
    sparkle(time, 0.04, 0.03, 5600);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (!ctx || bossIds.has(enemyId)) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
    clank(time, 700 + stageIndex * 120, 0.5);
    chime(time + THIRTYSECOND, leadSet[(stageIndex + 1) % 4] + 12, 0.6, 0.5, 0.8, 0.12, 0.3);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx || bossIds.has(enemyId)) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const chimeMidi = chimePitches.get(enemyId);
    if (chimeMidi !== undefined) {
      chimePitches.delete(enemyId);
      chimeKill(kill.time, chimeMidi);
      return;
    }
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
    [0, 2, 4, 7].forEach((degree, index) => chime(time + index * THIRTYSECOND, leadSet[degree] + 12, 0.55 - index * 0.06, 0.8, 1, 0.12, 0.5));
  });

  bus.on('reject', () => {
    if (!ctx) return;
    deadPawl(score.quantizePlayerAction(ctx.currentTime), 1);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    click(time, score.chordAt(score.arrangementPositionAt(time)).bass + 12, 900, 0.05, 1);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    clank(ctx.currentTime, 300, 1);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (ESCAPEMENT_AUDIO_KINDS.chime.includes(kind)) {
      const position = score.arrangementPositionAt(ctx.currentTime);
      const leadSet = score.leadSetAt(position);
      chimePitches.set(enemyId, leadSet[CHIME_DEGREES[chimeCounter % CHIME_DEGREES.length]]);
      chimeCounter += 1;
    } else if (ESCAPEMENT_AUDIO_KINDS.waspBolt.includes(kind)) {
      api.waspBolt();
    } else if (ESCAPEMENT_AUDIO_KINDS.boss.includes(kind)) {
      bossIds.add(enemyId);
    }
  });

  bus.on('runend', ({ died }) => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime + 0.05;
    if (died) {
      // The spring unwinds: decelerating clicks and a dead pawl under a fading minor pad.
      wind(time, DM.bass, 8, 0.03, false);
      deadPawl(time, 1);
      pad(time, DM.pad, 4, 0.5, 400, 0.3, 3, 0.6);
    } else if (clockFreed) {
      // The hour has struck: a D major peal falls under the bell's tail.
      FREED_PEAL.forEach((midi, index) => chime(time + 0.3 + index * SIXTEENTH, midi, 0.9 - index * 0.05, 0.8, 1.6, 0.16, 0.6));
      pad(time, [D_MAJOR.bass + 12, ...D_MAJOR.pad], 6, 0.7, 1200, 0.5, 3, 0.8);
    } else {
      // The hour never struck: a dead pawl, a slow unwinding, and the works settling.
      deadPawl(time, 0.8);
      wind(time + 0.2, DM.bass, 6, 0.05, false);
      pad(time, DM.pad, 5, 0.5, 350, 0.6, 3.5, 0.6);
    }
  });

  // ---- gameplay-facing API -----------------------------------------------------

  const api: EscapementAudioApi = {
    ringBell(index, target) {
      if (!ctx) return;
      const ring = Math.min(BELL_SCALE.length - 1, Math.max(0, Math.floor(index)));
      const time = score.quantizePlayerAction(ctx.currentTime);
      const kind = target ?? (ring < 6 ? 'jewel' : 'arbor');
      bossBell(time, BELL_SCALE[ring], 0.7 + ring * 0.025);
      if (kind === 'jewel') sparkle(time, 0.12, 0.05, 6000);
      else clank(time, 480, 0.6);
      if (ring === BELL_SCALE.length - 1) bossKill(time);
    },
    jewelBreak() {
      if (!ctx) return;
      shear(score.nextGridTime(ctx.currentTime, 0.5), 1);
    },
    ratchetStep(stage) {
      if (!ctx) return;
      const clicks = 1 + Math.max(0, Math.min(2, Math.floor(stage)));
      ratchet(score.quantizePlayerAction(ctx.currentTime), 0.5 + stage * 0.2, clicks, 0.028, 0, 'sfx');
    },
    tickLeap() {
      if (!ctx) return;
      leap(score.quantizePlayerAction(ctx.currentTime), 0.9);
    },
    waspBolt() {
      if (!ctx) return;
      const time = score.quantizePlayerAction(ctx.currentTime);
      bolt(time, score.chordAt(score.arrangementPositionAt(time)).figure[1], 0.9);
    },
    chimePitch(enemyId) {
      return chimePitches.get(enemyId);
    },
    gearHandoff() {
      if (!ctx) return;
      whoosh(ctx.currentTime, BEAT * 1.5, 0.22);
      dropFilter(score.nextGridTime(ctx.currentTime, 4));
    },
    strike() {
      if (!ctx) return;
      strikeAt(score.nextGridTime(ctx.currentTime, 4));
    },
    clockFreed() {
      return clockFreed;
    },
  };

  return { runtime, api };
}

/**
 * Puts a low-pass between the music bus and the master so the hand-offs can
 * drop the whole arrangement for a beat without touching the player's sounds.
 */
function installMusicFilter(context: AudioContext, mix: MixBus) {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 18000;
  filter.Q.value = 0.5;
  mix.music.disconnect();
  mix.music.connect(filter);
  filter.connect(mix.master);
  return filter;
}
