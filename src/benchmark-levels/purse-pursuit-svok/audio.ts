import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import type { EventBus } from '../../events';
import { createPurseVoices, type PurseKillVoice, type PurseLockVoice } from './audio-voices';
import {
  PURSE_BARS,
  PURSE_BPM,
  PURSE_RUN_DURATION,
  PURSE_SCORE_SECTIONS,
  PURSE_STEPS_PER_BAR,
  PURSE_TIME,
  purseSpeedFactorAt,
} from './timing';

/**
 * The chase soundtrack: fast glossy electropop in B minor / D major, 128 BPM,
 * 32 bars, one hard sidechain pump under everything.
 *
 * The structural idea is that the *hook is the player's instrument*. The lead
 * synth states the eight-bar hook once, in the chorus, and after that the tune
 * only comes back when the player earns it: the chorus kill lane is the hook's
 * own contour, transposed into whatever chord is live, so a chained volley
 * performs the topline. The boss section swaps to a harder saw and a
 * wide-interval lane, and the payoff opens the register right up.
 *
 * Everything the player triggers is quantised to the transport's real grid and
 * pitched from the live chord, so no action can land out of key or off the beat.
 */

const STEP = PURSE_TIME.stepSeconds;
const THIRTYSECOND = STEP / 2;
const BAR_SECONDS = PURSE_TIME.barSeconds;
const STEPS_PER_BAR = PURSE_STEPS_PER_BAR;
const LANE_STEPS = 32;

type Chord = { name: string; bass: number; pad: number[]; lead: number[] };

// vi–IV–I–V in D major, two bars each. The most pop progression there is, which
// is exactly what a car-chase music video wants.
const Bm: Chord = { name: 'Bm', bass: 35, pad: [59, 62, 66, 69], lead: [69, 71, 74, 76, 78, 81, 83, 86] };
const G: Chord = { name: 'G', bass: 31, pad: [55, 59, 62, 66], lead: [67, 71, 74, 76, 78, 79, 83, 86] };
const D: Chord = { name: 'D', bass: 38, pad: [57, 62, 66, 69], lead: [69, 71, 74, 76, 78, 81, 83, 86] };
const A: Chord = { name: 'A', bass: 33, pad: [57, 61, 64, 69], lead: [69, 71, 73, 76, 78, 81, 85, 88] };
const CHORDS = [Bm, G, D, A];

// The lead's note ladder: D major from A4 up. The hook is written against these
// indexes so it reads as a tune in source, not as a list of MIDI numbers.
const LADDER = [69, 71, 73, 74, 76, 78, 81, 83, 86];

type SectionIndex = 0 | 1 | 2 | 3;

/**
 * Kill lanes. Degrees index the live chord's eight-note lead set, so a kill on
 * any step of any bar is in key. Section 1 is the hook's own contour.
 */
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Verse: a calm stepwise arch. Sparse waves pick fragments out of it.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    2, 3, 4, 5, 6, 5, 4, 2,
  ],
  // Chorus: the hook, in degrees. Chain six kills here and you play the tune.
  1: [
    2, 2, 4, 3, 2, 1, 2, 4,
    5, 4, 2, 1, 2, 4, 5, 6,
    4, 4, 5, 6, 5, 4, 3, 4,
    5, 6, 7, 6, 5, 4, 3, 2,
  ],
  // Boss: wide interval leaps, so the fight rings out harder than the chase.
  2: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    2, 6, 3, 7, 4, 1, 5, 2,
    7, 6, 5, 4, 3, 2, 1, 0,
  ],
  // Payoff: nothing but the top of the register.
  3: [
    4, 5, 6, 7, 6, 5, 6, 7,
    5, 6, 7, 7, 6, 5, 4, 5,
    6, 7, 7, 6, 5, 6, 7, 7,
    4, 5, 6, 7, 5, 6, 7, 7,
  ],
};

/** Six locks climb the D major pentatonic — the reticle's rev counter, in pitch. */
const LOCK_SCALE = [74, 76, 78, 81, 83, 86];

const SECTION_VOICES: Record<SectionIndex, {
  kill: PurseKillVoice;
  lock: PurseLockVoice;
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'triangle', decay: 0.34, cutoff: 3800, gain: 0.17, shimmer: 0.3, octave: 0 },
    lock: { oscillator: 'triangle', cutoff: 3000, gain: 0.115 },
    fire: { cutoff: 2400, noise: 0.035 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.26, cutoff: 3200, gain: 0.135, shimmer: 0.55, octave: 0 },
    lock: { oscillator: 'square', cutoff: 2400, gain: 0.05 },
    fire: { cutoff: 3600, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 2900, gain: 0.125, shimmer: 0.72, octave: 0 },
    lock: { oscillator: 'sawtooth', cutoff: 2000, gain: 0.045 },
    fire: { cutoff: 4400, noise: 0.07 },
  },
  3: {
    kill: { oscillator: 'triangle', decay: 0.62, cutoff: 4600, gain: 0.18, shimmer: 0.9, octave: 1 },
    lock: { oscillator: 'triangle', cutoff: 3400, gain: 0.12 },
    fire: { cutoff: 3000, noise: 0.03 },
  },
};

// --- patterns ---------------------------------------------------------------

const BLANK = '................';
const ROLL_KICK = 'K.......K.......';
const VERSE_KICK = 'K...k...K...k...';
const FLOOR_KICK = 'K...K...K...K...';
const BREAK_KICK = 'K...............';
const BOSS_KICK = 'K..kK...K..kK...';

const CLAP = '....C.......C...';
const CLAP_DOUBLE = '....C.......C.c.';

const SOFT_HAT = '..h...h...h...h.';
const VERSE_HAT = '.h.h.h.h.h.h.h.h';
const DRIVE_HAT = 'hhHhhhOhhhHhhhOh';
const BOSS_HAT = 'hHhHhHhHhHhHhOhO';

const VERSE_BASS = 'B..u..b.B..u.b..';
const HOOK_BASS = 'B.u.B.u.b.u.B.uf';
const BOSS_BASS = 'B.BuB.b.B.BuB.uf';

const VERSE_PLUCK = 'p...p.p...p.p...';
const HOOK_PLUCK = 'p.p.p.p.p.p.p.p.';

/**
 * The hook. Digits are indexes into `LADDER` played short; letters a–i are the
 * same indexes held long. Eight bars, call and response: three rising phrases
 * that each ring out over an empty bar, then a descending answer.
 */
const HOOK = [
  '3.3.5...4.3.b...',
  '................',
  '3.3.5...6.5.d...',
  '................',
  '5.5.6...7.6.f...',
  '................',
  '4.4.3...2.3.e...',
  'f...e...d...b...',
].join('');

/** The payoff restates the last two bars an octave clear of everything else. */
const HOOK_CODA = ['6.6.7...8.7.f...', 'f...g...f...h...'].join('');

const SHORT_NOTES: Record<string, number> = { '0': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1 };
const LONG_NOTES: Record<string, number> = { a: 0.95, b: 0.95, c: 0.95, d: 0.95, e: 0.95, f: 0.95, g: 0.95, h: 0.95, i: 0.95 };
const LEAD_NOTES = { ...SHORT_NOTES, ...LONG_NOTES };
const ladderFor = (symbol: string) =>
  LADDER[symbol >= 'a' ? symbol.charCodeAt(0) - 97 : Number(symbol)] ?? LADDER[0];
const isLong = (symbol: string) => symbol >= 'a';

export function createAudio(bus: EventBus) {
  return createPurseAudio(bus).audio;
}

export const tracePurseAudio = createAudioTraceHarness({
  level: 'purse-pursuit-svok',
  bpm: PURSE_BPM,
  stepSeconds: STEP,
  defaultSeconds: PURSE_RUN_DURATION,
  createAudio: createPurseAudio,
});

function createPurseAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let bossId = -1;
  let bossMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: PURSE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      // The boss fight doubles the harmonic rhythm: one chord a bar, twice as
      // urgent, without changing key.
      { fromBar: PURSE_BARS.boss, toBar: PURSE_BARS.payoff, chords: CHORDS, barsPerChord: 1 },
      // Home. The purse is back and the track sits on D.
      { fromBar: PURSE_BARS.payoff, chords: [D], barsPerChord: 2 },
    ],
    sections: PURSE_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP,
    volumeScale: 0.82,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.004, release: 0.18 },
      // Dotted eighth: the pop-video delay.
      delay: { time: STEP * 3, feedback: 0.3, dampHz: 3400 },
      reverb: { seconds: 1.5, decay: 2.4, level: 0.14 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      bossId = -1;
      bossMaxHp = 0;
    },
    onRunEnd() {
      score.clearOverride();
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createPurseVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, clap, snare, hat, bass, pad, pluck, lead, stab, engine, riser, crash, noiseHit } = voices;
  const sfx = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // --- player instruments ---------------------------------------------------

  const killLayer = voice<{ killVoice: PurseKillVoice }>({
    oscillators: [
      { type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain, octave: ({ killVoice }) => killVoice.octave },
    ],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { attack: 0.004, decay: ({ killVoice }) => killVoice.decay },
  });

  const killBody = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.75 },
    ],
  });

  const killSparkle = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'triangle', octave: 1, gain: 0.32 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.09,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 260 },
    envelope: { decay: 0.09 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.085 }, { type: 'square', gain: 0.03, octave: 1 }],
    duration: 0.075,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.12,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 5000 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  // A rejected release is a locked wheel: a rubber chirp with the pitch falling
  // away underneath it. Deliberately the one unmusical sound in the level.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.26,
    stopPadding: 0.03,
    filter: {
      type: 'bandpass',
      Q: 6,
      frequencyAutomation: (time) => [
        { type: 'set', value: 1600, time },
        { type: 'exponentialRamp', value: 380, time: time + 0.2 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  const thudVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.42,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 38, time: time + 0.3 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.46, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  // --- arrangement ----------------------------------------------------------

  const padEven = 'P...............' + BLANK;
  const padOdd = BLANK + 'P...............';

  function padTrack(fromBar: number, bright = 1) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) =>
      pad(time, chord.pad, BAR_SECONDS * 2 * 1.04, bright));
  }

  function kickTrack(pattern: string) {
    return hits<Chord>(pattern, { K: 1, k: 0.82 }, ({ time }, vel) => kick(time, vel));
  }

  function clapTrack(pattern: string) {
    return hits<Chord>(pattern, { C: 1, c: 0.62 }, ({ time }, vel) => clap(time, vel));
  }

  function hatTrack(pattern: string) {
    return hits<Chord>(pattern, { h: 0.05, H: 0.09, O: 0.15 }, ({ time }, vel, symbol) =>
      hat(time, vel, symbol === 'O' ? 0.17 : 0.028));
  }

  function bassTrack(pattern: string, bright = 1) {
    return hits<Chord>(pattern, { B: 1, b: 0.72, u: 0.7, f: 0.68 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0;
      bass(time, chord.bass + offset, vel, bright);
    });
  }

  function pluckTrack(pattern: string, vel: number) {
    const order = [0, 2, 1, 3, 2, 3, 1, 0];
    return hits<Chord>(pattern, { p: vel }, ({ time, step, chord }, velocity) =>
      pluck(time, chord.pad[order[(step / 2) % order.length]] + 12, velocity));
  }

  function leadTrack(pattern: string, vel: number) {
    return hits<Chord>(pattern, LEAD_NOTES, ({ time }, velocity, symbol) =>
      lead(time, ladderFor(symbol), velocity * vel, isLong(symbol) ? 0.9 : 0.23));
  }

  /** The engine follows the throttle: one sustained rev per bar, from the speed curve. */
  function engineTrack(idle = false) {
    return fn<Chord>(({ step, bar, time }) => {
      if (step !== 0) return;
      const rev = idle ? 0.1 : clamp01((purseSpeedFactorAt(bar * BAR_SECONDS) - 0.7) / 0.95);
      engine(time, 26 + Math.round(rev * 3), BAR_SECONDS * 1.03, rev);
    });
  }

  const ambient = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'idling',
      fromBar: 0,
      tracks: [padTrack(0, 0.75), pluckTrack('p.......p...p...', 0.4), engineTrack(true)],
    }],
  });

  const run = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'rollout',
        fromBar: PURSE_BARS.rollout,
        toBar: PURSE_BARS.chase,
        tracks: [
          padTrack(PURSE_BARS.rollout, 0.85),
          kickTrack(ROLL_KICK),
          hatTrack(SOFT_HAT),
          engineTrack(),
          // Two bars of riser lifting into the verse.
          oneShot(2, 0, ({ time }) => riser(time, BAR_SECONDS * 2, 0.09)),
        ],
      },
      {
        name: 'chase',
        fromBar: PURSE_BARS.chase,
        toBar: PURSE_BARS.chaseLift,
        tracks: [
          padTrack(PURSE_BARS.chase),
          kickTrack(VERSE_KICK),
          clapTrack(CLAP),
          hatTrack(VERSE_HAT),
          bassTrack(VERSE_BASS, 0.9),
          pluckTrack(VERSE_PLUCK, 0.55),
          engineTrack(),
          oneShot(0, 0, ({ time }) => crash(time, 0.7)),
        ],
      },
      {
        name: 'chase-lift',
        fromBar: PURSE_BARS.chaseLift,
        toBar: PURSE_BARS.hook,
        tracks: [
          padTrack(PURSE_BARS.chaseLift),
          kickTrack(VERSE_KICK),
          clapTrack(CLAP),
          hatTrack(DRIVE_HAT),
          bassTrack(VERSE_BASS),
          pluckTrack(HOOK_PLUCK, 0.55),
          engineTrack(),
          // Three bars of riser into the drop.
          oneShot(1, 0, ({ time }) => riser(time, BAR_SECONDS * 3, 0.16)),
        ],
      },
      {
        // Eight bars, so the hook plays through once rather than repeating its
        // first half. The second half thickens via barInSection rather than a
        // section split, which would restart the pattern.
        name: 'hook',
        fromBar: PURSE_BARS.hook,
        toBar: PURSE_BARS.breakdown,
        tracks: [
          padTrack(PURSE_BARS.hook, 1.25),
          kickTrack(FLOOR_KICK),
          clapTrack(CLAP_DOUBLE),
          hatTrack(DRIVE_HAT),
          bassTrack(HOOK_BASS, 1.2),
          leadTrack(HOOK, 1),
          engineTrack(),
          fn(({ barInSection, step, time, chord }) => {
            if (barInSection < 4 || step % 2 !== 0) return;
            pluck(time, chord.pad[(step / 2) % chord.pad.length] + 12, 0.4);
          }),
          oneShot(0, 0, ({ time }) => crash(time, 1)),
          oneShot(4, 0, ({ time }) => crash(time, 0.8)),
        ],
      },
      {
        // Everything falls away but the pad and the engine: this is where the
        // player first sees the boss's tail light.
        name: 'breakdown',
        fromBar: PURSE_BARS.breakdown,
        toBar: PURSE_BARS.boss,
        tracks: [
          padTrack(PURSE_BARS.breakdown, 0.7),
          kickTrack(BREAK_KICK),
          hatTrack(SOFT_HAT),
          engineTrack(),
          oneShot(0, 0, ({ time }) => crash(time, 0.5)),
          oneShot(1, 0, ({ time }) => riser(time, BAR_SECONDS, 0.2)),
        ],
      },
      {
        name: 'boss',
        fromBar: PURSE_BARS.boss,
        toBar: PURSE_BARS.payoff,
        tracks: [
          padTrack(PURSE_BARS.boss, 0.9),
          kickTrack(BOSS_KICK),
          hits<Chord>('....S.......S...', { S: 1 }, ({ time }) => snare(time, 0.9)),
          hatTrack(BOSS_HAT),
          bassTrack(BOSS_BASS, 1.35),
          engineTrack(),
          // Second half of the fight: the clap doubles up and the hook's answer
          // phrase starts nagging underneath.
          fn(({ barInSection, step, time }) => {
            if (barInSection < 4) return;
            if (step === 4 || step === 12) clap(time, 0.8);
          }),
          fn(({ barInSection, step, time, chord }) => {
            if (barInSection < 4 || step % 4 !== 2) return;
            pluck(time, chord.lead[(step / 2) % chord.lead.length], 0.34);
          }),
          oneShot(0, 0, ({ time }) => crash(time, 1)),
          oneShot(7, 0, ({ time }) => riser(time, BAR_SECONDS, 0.22)),
        ],
      },
      {
        name: 'payoff',
        fromBar: PURSE_BARS.payoff,
        tracks: [
          padTrack(PURSE_BARS.payoff, 1.5),
          kickTrack(FLOOR_KICK),
          clapTrack(CLAP_DOUBLE),
          hatTrack(DRIVE_HAT),
          bassTrack(HOOK_BASS, 1.3),
          leadTrack(HOOK_CODA, 1.05),
          pluckTrack(HOOK_PLUCK, 0.5),
          engineTrack(),
          oneShot(0, 0, ({ time }) => crash(time, 1.2)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambient.schedule(position, time);
    else run.schedule(position, time);
  }

  // --- the player's part ----------------------------------------------------

  function sectionLayers(mix: SectionMix<SectionIndex>): Array<[SectionIndex, number]> {
    return mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  function killNote(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfx();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    if (midi === undefined) return;

    const from = SECTION_VOICES[mix.from].kill;
    const to = SECTION_VOICES[mix.to].kill;
    const vel = Math.min(1.4, 1 + chain * 0.11);
    const decay = lerp(from.decay, to.decay, mix.t);
    const gain = lerp(from.gain, to.gain, mix.t);
    const shimmer = lerp(from.shimmer, to.shimmer, mix.t);

    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      killLayer.play({
        context: ctx,
        time,
        midi,
        killVoice: SECTION_VOICES[section].kill,
        velocity: vel,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.4 }],
      });
    }
    killBody.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killSparkle.play({
        context: ctx,
        time,
        midi,
        decay,
        gain,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.04 * shimmer + 0.02, 0.06, 'highpass', 6400, output);
  }

  /**
   * Chipping the boss. Each hit rings a heavier chromed clang and lifts a
   * beacon note up the lead set, so the fight audibly ratchets toward the kill.
   */
  function bossChip(intensity: number) {
    const output = sfx();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.4,
      oscillatorType: 'square',
      frequency: root * 2.5,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.07 }],
      filter: { type: 'bandpass', frequency: 1400 + 2600 * intensity, Q: 2.4 },
      gainAutomation: [
        { type: 'set', value: 0.2 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
      ],
      destination: output,
    });
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'triangle',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.06 + 0.07 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
      ],
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
    });
    noiseHit(time, 0.1 + 0.08 * intensity, 0.05, 'bandpass', 2600, output);
  }

  /** A plate comes off: a klaxon two-note that cuts through the fight. */
  function plateBreak() {
    const audioMix = runtime.mix();
    if (!ctx || !audioMix?.duck || !audioMix.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    audioMix.duckAt(time, 0.55, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    [chord.lead[3], chord.lead[5]].forEach((midi, index) => {
      if (!ctx || !audioMix.duck || !audioMix.delaySend) return;
      const at = time + index * STEP * 2;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.34,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2600 },
        gainAutomation: [
          { type: 'set', value: 0.14, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.3 },
        ],
        destination: audioMix.duck,
        sends: [{ destination: audioMix.delaySend, gain: 0.45 }],
      });
    });
  }

  /**
   * The purse comes back. Everything ducks for one long breath, a sub drop
   * lands on the tonic, the full D major chord blooms, and the hook's top note
   * rings out over it.
   */
  function purseFanfare() {
    const output = sfx();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck || !audioMix.delaySend) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    score.overrideSection(3);
    audioMix.duckAt(time, 0.22, 1.6);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.1,
      oscillatorType: 'sine',
      frequency: 294,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 36.7, time: time + 0.5 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.0 },
      ],
      destination: output,
    });
    stab(time, [50, 57, 62, 66, 69, 74], 1.3, 1.9);
    crash(time, 1.4);
    // Hook top note, held, an octave above the stack.
    playOscillatorVoice({
      context: ctx,
      time: time + STEP * 2,
      stopTime: time + 1.8,
      oscillatorType: 'triangle',
      frequency: midiToFreq(86),
      filter: { type: 'lowpass', frequency: 5200 },
      gainAutomation: [
        { type: 'set', value: 0, time: time + STEP * 2 },
        { type: 'linearRamp', value: 0.15, time: time + STEP * 2 + 0.05 },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.7 },
      ],
      destination: output,
      sends: [{ destination: delaySend, gain: 0.55 }],
    });
    noiseHit(time, 0.13, 0.8, 'highpass', 7000, output);
  }

  // --- bindings -------------------------------------------------------------

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === bossId) {
      purseFanfare();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfx();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    for (const [section, weight] of sectionLayers(sectionMix)) {
      if (weight < 0.02) continue;
      const lockVoiceSpec = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: lockVoiceSpec.oscillator,
        cutoff: lockVoiceSpec.cutoff,
        gainValue: lockVoiceSpec.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.32 }],
      });
    }
    noiseHit(time, 0.018 + lockCount * 0.004, 0.02, 'highpass', 9000, output);
  });

  bus.on('fire', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const fromFire = SECTION_VOICES[mix.from].fire;
    const toFire = SECTION_VOICES[mix.to].fire;
    const cutoff = lerp(fromFire.cutoff, toFire.cutoff, mix.t);
    const noise = lerp(fromFire.noise, toFire.noise, mix.t);
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 26), time: time + 0.06 }],
      destination: output,
    });
    noiseHit(time, noise, 0.02, 'highpass', 4200, output);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfx();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    if (enemyId === bossId) {
      bossMaxHp = Math.max(bossMaxHp, hitPointsRemaining + 1);
      bossChip(1 - hitPointsRemaining / Math.max(1, bossMaxHp));
      return;
    }
    // Panel damage on a two-hit rider: three quick chord tones, up.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chordLead = score.chordAt(score.arrangementPositionAt(time)).lead;
    ([[0, 0.075], [2, 0.065], [4, 0.055]] as const).forEach(([index, vel], order) => {
      if (!ctx || !output || !mix.delaySend) return;
      const at = time + THIRTYSECOND * order;
      chipVoice.play({
        context: ctx,
        time: at,
        midi: chordLead[index],
        vel,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    });
    noiseHit(time, 0.03, 0.03, 'highpass', 6000, output);
  });

  bus.on('stage', ({ enemyId }) => {
    if (enemyId === bossId) plateBreak();
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind !== 'boss') return;
    bossId = enemyId;
    bossMaxHp = 0;
    score.overrideSection(2);
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime);
    riser(time, 0.9, 0.2);
    // Two low horn blasts: the boss has a bigger engine than you do.
    [35, 42].forEach((midi, index) => {
      if (!ctx || !mix.duck || !mix.delaySend) return;
      const at = time + index * 0.34;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.5,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 900 },
        gainAutomation: [
          { type: 'set', value: 0.2, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.46 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.4 }],
      });
    });
  });

  // A clean six is answered by the track: the chord stabbed on the next beat.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    stab(time, chord.pad.map((midi) => midi + 12), size >= 6 ? 1.2 : 0.8, 0.55);
    noiseHit(time, 0.08, 0.28, 'highpass', 7400, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    rejectVoice.play({ context: ctx, time, frequency: 520, vel: 0.16, destination: output });
    rejectVoice.play({ context: ctx, time: time + 0.03, frequency: 390, vel: 0.11, destination: output });
    noiseHit(time, 0.14, 0.16, 'bandpass', 900, output);
    noiseHit(time + 0.03, 0.08, 0.2, 'highpass', 3000, output);
  });

  bus.on('miss', () => {
    const output = sfx();
    if (!ctx || !output) return;
    // A rider getting away: a doppler note falling as it drops behind you.
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.3,
      oscillatorType: 'sawtooth',
      frequency: 320,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 130, time: time + 0.26 }],
      filter: { type: 'lowpass', frequency: 1500 },
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
      ],
      destination: output,
    });
    noiseHit(time, 0.04, 0.22, 'bandpass', 1800, output);
  });

  // Something got through: a body-panel thud and a tyre scrub.
  bus.on('playerhit', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    thudVoice.play({ context: ctx, time, frequency: 110, destination: output });
    noiseHit(time, 0.24, 0.2, 'bandpass', 700, output);
    noiseHit(time + 0.04, 0.14, 0.34, 'highpass', 2600, output);
  });

  return runtime;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
