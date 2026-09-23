import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, type ArrangementContext } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createOrchestra } from './audio-voices';
import {
  BARS,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_SCORE_SECTIONS,
  BROADSIDE_STEPS_PER_BAR,
  SCORE_SECTION,
  STEP_SECONDS,
  type ScoreSectionIndex,
} from './timing';

// THE SCORE. Space opera in D minor for a synthesized orchestra — strings,
// horns, trumpets, trombones, timpani, gran cassa, cymbals, choir, harp —
// swelling with each push and dropping to near silence in the eye.
//
// The player is the soloist. Locks pluck up the live chord on the harp; each
// shot of a volley is a horn blat on the next chord tone, so a release
// ripples like a broadside; every kill plays the next note of a hidden
// per-section melody lane in a trumpet-over-bell voice (celesta in the eye,
// muted in the keel's shadow). The orchestra's theme stays in the horn
// register below the soloist's.

const STEP = STEP_SECONDS;
const SPB = BROADSIDE_STEPS_PER_BAR;

type Chord = { name: string; bass: number; pad: number[]; lead: number[] };

const c = (name: string, bass: number, pad: number[], lead: number[]): Chord => ({ name, bass, pad, lead });
const DM = c('Dm', 38, [62, 65, 69, 74], [65, 69, 74, 77, 81, 86, 89, 93]);
const A = c('A', 45, [61, 64, 69, 73], [64, 69, 73, 76, 81, 85, 88, 93]);
const C = c('C', 36, [60, 64, 67, 72], [64, 67, 72, 76, 79, 84, 88, 91]);
const BB = c('Bb', 34, [62, 65, 70, 74], [65, 70, 74, 77, 82, 86, 89, 94]);
const GM = c('Gm', 43, [62, 67, 70, 74], [62, 67, 70, 74, 79, 82, 86, 91]);
const EB = c('Eb', 39, [63, 67, 70, 75], [63, 67, 70, 75, 79, 82, 87, 91]);
const DM9 = c('Dm9', 38, [57, 64, 65, 69, 76], [69, 72, 74, 76, 77, 81, 84, 88]);
const BBM7 = c('Bbmaj7', 34, [57, 62, 65, 69], [65, 69, 70, 74, 77, 81, 82, 86]);
const D = c('D', 38, [62, 66, 69, 74], [66, 69, 74, 78, 81, 86, 90, 93]);
const G = c('G', 43, [62, 67, 71, 74], [62, 67, 71, 74, 79, 83, 86, 91]);

/** One chord per bar, bar 0 → 33. */
const PROGRESSION: Chord[] = [
  DM, A, // launch
  DM, C, BB, A, DM, A, // the gaps
  DM, C, BB, A, GM, A, // broadside
  DM9, BBM7, // the eye
  DM, EB, DM, EB, // the keel
  DM, BB, GM, A, // flagship
  BB, C, // shields down
  DM, BB, C, A, // trench
  D, G, A, D, // victory
];
const DEFEAT: Chord[] = [DM, BB, GM, A];
const AMBIENT: Chord[] = [DM, BB, GM, A];

// Kill lanes: degrees into the chord's lead set, one bar of sixteenths each.
const KILL_LANES: Record<ScoreSectionIndex, number[]> = {
  [SCORE_SECTION.gaps]: [2, 3, 4, 5, 4, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 7],
  [SCORE_SECTION.broadside]: [2, 4, 6, 4, 3, 5, 7, 5, 2, 4, 6, 7, 6, 4, 5, 7],
  [SCORE_SECTION.eye]: [7, 6, 5, 4, 5, 4, 3, 2, 4, 3, 2, 1, 3, 2, 1, 0],
  [SCORE_SECTION.belly]: [0, 1, 2, 1, 0, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0],
  [SCORE_SECTION.flagship]: [3, 4, 5, 4, 5, 6, 5, 6, 4, 5, 6, 7, 6, 5, 6, 7],
  [SCORE_SECTION.trench]: [2, 6, 3, 7, 2, 6, 4, 7, 3, 6, 4, 7, 5, 7, 6, 7],
  [SCORE_SECTION.victory]: [4, 5, 6, 7, 6, 5, 4, 5, 6, 7, 6, 5, 4, 5, 6, 7],
};

/** The soloist's voice per section: timbre 0 trumpet, 1 celesta, 2 muted; brightness 0..1. */
const SOLO_VOICE: Record<ScoreSectionIndex, { timbre: number; brightness: number; gain: number }> = {
  [SCORE_SECTION.gaps]: { timbre: 0, brightness: 0.55, gain: 1 },
  [SCORE_SECTION.broadside]: { timbre: 0, brightness: 0.85, gain: 1.05 },
  [SCORE_SECTION.eye]: { timbre: 1, brightness: 0.2, gain: 0.9 },
  [SCORE_SECTION.belly]: { timbre: 2, brightness: 0.4, gain: 1.1 },
  [SCORE_SECTION.flagship]: { timbre: 0, brightness: 0.75, gain: 1.05 },
  [SCORE_SECTION.trench]: { timbre: 0, brightness: 1, gain: 1.1 },
  [SCORE_SECTION.victory]: { timbre: 0, brightness: 1, gain: 1 },
};

// ---- themes (step, midi, duration in steps) --------------------------------------------------

type Note = readonly [step: number, midi: number, steps: number];

/** The Broadside theme: four bars over i – VII – VI – V. */
const THEME: Note[][] = [
  [[0, 74, 6], [6, 69, 2], [8, 74, 4], [12, 76, 2], [14, 77, 2]],
  [[0, 79, 6], [6, 77, 2], [8, 76, 4], [12, 72, 4]],
  [[0, 74, 6], [6, 72, 2], [8, 70, 4], [12, 69, 2], [14, 70, 2]],
  [[0, 69, 12], [12, 73, 2], [14, 76, 2]],
];
/** The answer climbing out of the broadside run (over Gm – A). */
const ANSWER: Note[][] = [
  [[0, 82, 6], [6, 81, 2], [8, 79, 4], [12, 74, 4]],
  [[0, 76, 4], [4, 77, 4], [8, 79, 4], [12, 81, 4]],
];
/** The flagship's motif: a chromatic sag in the low brass. */
const VILLAIN: Note[][] = [
  [[0, 62, 8], [8, 61, 8]],
  [[0, 62, 4], [4, 60, 4], [8, 58, 8]],
  [[0, 62, 4], [4, 63, 4], [8, 62, 4], [12, 58, 4]],
  [[0, 57, 8], [8, 61, 4], [12, 64, 4]],
];
/** Victory: the theme reborn in D major. */
const VICTORY: Note[][] = [
  [[0, 74, 6], [6, 69, 2], [8, 74, 4], [12, 76, 2], [14, 78, 2]],
  [[0, 79, 6], [6, 78, 2], [8, 76, 4], [12, 74, 4]],
  [[0, 76, 8], [8, 78, 4], [12, 79, 2], [14, 76, 2]],
  [[0, 74, 16]],
];

// Low-string ostinato: degree per sixteenth into [root, fifth, octave] and accent map.
const OSTINATO = [0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 1, 0, 1];
const ACCENT = [1, 0.5, 0.6, 1, 0.5, 0.6, 1, 0.5, 1, 0.5, 0.6, 1, 0.6, 0.5, 1, 0.6];

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-hmvp',
  bpm: BROADSIDE_BPM,
  stepSeconds: STEP,
  defaultSeconds: BROADSIDE_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, ScoreSectionIndex>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: SPB,
    chords: PROGRESSION,
    barsPerChord: 1,
    sections: BROADSIDE_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const state = { flagshipDestroyed: false, generatorsDown: 0, coreHits: 0, coreIds: new Set<number>(), generatorIds: new Set<number>(), coresDown: 0 };

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP,
    stepsPerBar: SPB,
    volumeScale: 0.85,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -16, knee: 8, ratio: 4, attack: 0.006, release: 0.25 },
      reverb: { seconds: 3.4, decay: 2.8, level: 0.42 },
      delay: { time: STEP * 3, feedback: 0.26, dampHz: 3000, sendGain: 1 },
      noiseSeconds: 2,
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      state.flagshipDestroyed = false;
      state.generatorsDown = 0;
      state.coreHits = 0;
      state.coresDown = 0;
      state.coreIds.clear();
      state.generatorIds.clear();
    },
    onRunEnd() {
      score.clearOverride();
    },
  });

  const orchestra = createOrchestra({
    trace,
    context: runtime.context,
    mix: runtime.mix,
    noise: () => runtime.mix()?.noiseBuffer ?? null,
  });
  const o = orchestra;

  // ---- arrangement helpers -------------------------------------------------------------------

  type Ctx = ArrangementContext<Chord>;
  const at = (ctx: Ctx, step: number) => ctx.time + (step - ctx.step) * STEP;
  const timpaniPitch = (chord: Chord) => {
    let midi = chord.bass;
    while (midi < 38) midi += 12;
    while (midi > 45) midi -= 12;
    return midi;
  };

  function melody(bars: Note[][], play: (time: number, midi: number, seconds: number, ctx: Ctx) => void, transpose = 0) {
    return fn<Chord>((ctx) => {
      const notes = bars[ctx.barInSection % bars.length];
      for (const [step, midi, steps] of notes) {
        if (step === ctx.step) play(ctx.time, midi + transpose, steps * STEP, ctx);
      }
    });
  }

  function pads(velocity: number, brightness: number, octave = 0) {
    return fn<Chord>((ctx) => {
      if (ctx.step === 0) o.strings(ctx.time, ctx.chord.pad.map((m) => m + octave), SPB * STEP * 1.02, velocity, brightness);
    });
  }

  function ostinato(velocity: number, octaves = false) {
    return fn<Chord>((ctx) => {
      const degree = OSTINATO[ctx.step];
      const root = ctx.chord.bass + 12;
      const midi = degree === 0 ? root : degree === 1 ? root + 7 : root + 12;
      o.spiccato(ctx.time, midi, velocity * ACCENT[ctx.step]);
      if (octaves && ACCENT[ctx.step] === 1) o.spiccato(ctx.time, midi + 12, velocity * 0.55);
    });
  }

  function timpaniOn(steps: number[], velocity: number) {
    return fn<Chord>((ctx) => {
      if (steps.includes(ctx.step)) {
        const pitch = timpaniPitch(ctx.chord);
        o.timpani(ctx.time, ctx.step === 0 || ctx.step === 8 ? pitch : pitch + 7 > 47 ? pitch - 5 : pitch + 7, velocity * (ctx.step === 0 ? 1 : 0.7));
      }
    });
  }

  function roll(instrument: 'timpani' | 'snare', fromStep: number, toStep: number, from: number, to: number) {
    return fn<Chord>((ctx) => {
      if (ctx.step < fromStep || ctx.step > toStep) return;
      const t = (ctx.step - fromStep) / Math.max(1, toStep - fromStep);
      const velocity = from + (to - from) * t;
      for (const offset of [0, 0.5]) {
        const time = ctx.time + offset * STEP;
        if (instrument === 'timpani') o.timpani(time, timpaniPitch(ctx.chord), velocity, 0.5);
        else o.snare(time, velocity);
      }
    });
  }

  function onBar(barInSection: number, step: number, play: (ctx: Ctx) => void) {
    return fn<Chord>((ctx) => {
      if (ctx.barInSection === barInSection && ctx.step === step) play(ctx);
    });
  }

  function everyBar(step: number, play: (ctx: Ctx) => void) {
    return fn<Chord>((ctx) => {
      if (ctx.step === step) play(ctx);
    });
  }

  const snareMarch = fn<Chord>((ctx) => {
    if ([0, 3, 6, 8, 11, 14].includes(ctx.step)) o.snare(ctx.time, ctx.step === 0 ? 0.55 : 0.32);
  });

  // The broadside: cannons on every beat, rippling down the cruiser's flank.
  const broadsideCannons = fn<Chord>((ctx) => {
    if (ctx.step % 4 !== 0) return;
    const heavy = ctx.step === 0;
    o.cannon(ctx.time, heavy ? 1 : 0.75, 0);
    o.cannon(at(ctx, ctx.step + 1), heavy ? 0.6 : 0.45, 0.3);
    if (heavy) {
      o.cannon(at(ctx, ctx.step + 2), 0.45, 0.55);
      o.cannon(at(ctx, ctx.step + 3), 0.35, 0.7);
    }
  });

  const trumpetStabs = (steps: number[], velocity: number) => fn<Chord>((ctx) => {
    if (!steps.includes(ctx.step)) return;
    for (const midi of ctx.chord.pad.slice(0, 3)) o.brass(ctx.time, midi - 12, 0.12, velocity, 0.7);
  });

  // ---- the run --------------------------------------------------------------------------------

  const run = createArrangement<Chord>({
    stepsPerBar: SPB,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'launch',
        fromBar: BARS.deck,
        toBar: BARS.gaps,
        tracks: [
          onBar(0, 0, (ctx) => {
            o.strings(ctx.time, [50, 57, 62], SPB * 2 * STEP, 0.7, 0.3);
            o.horn(ctx.time, 50, SPB * STEP * 0.95, 0.5);
            o.horn(ctx.time, 57, SPB * STEP * 0.95, 0.4);
          }),
          fn((ctx) => {
            if (ctx.barInSection !== 0) return;
            const t = ctx.step / 15;
            o.timpani(ctx.time, 38, 0.12 + t * 0.55, 0.4);
            o.timpani(ctx.time + STEP / 2, 38, 0.1 + t * 0.55, 0.4);
          }),
          onBar(0, 8, (ctx) => o.swell(ctx.time, STEP * 8, 0.9)),
          // CATAPULT on the bar-1 downbeat.
          onBar(1, 0, (ctx) => {
            o.crash(ctx.time, 1);
            o.granCassa(ctx.time, 1);
            o.timpani(ctx.time, 45, 1);
            o.strings(ctx.time, [57, 61, 64, 69], SPB * STEP, 0.9, 0.6);
            for (const midi of [57, 61, 64]) o.horn(ctx.time, midi - 12, SPB * STEP * 0.9, 0.7);
          }),
          fn((ctx) => {
            if (ctx.barInSection !== 1) return;
            const fanfare: Note[] = [[0, 57, 1], [2, 57, 1], [4, 57, 2], [8, 64, 3], [12, 69, 4]];
            for (const [step, midi, steps] of fanfare) if (step === ctx.step) o.brass(ctx.time, midi, steps * STEP, 0.9, 0.7);
          }),
          roll('snare', 12, 15, 0.2, 0.8),
          fn((ctx) => {
            if (ctx.barInSection === 1 && [4, 8, 12].includes(ctx.step)) o.timpani(ctx.time, 45, 0.6);
          }),
        ],
      },
      {
        name: 'the-gaps',
        fromBar: BARS.gaps,
        toBar: BARS.broadside,
        tracks: [
          pads(0.8, 0.45),
          ostinato(0.75),
          snareMarch,
          timpaniOn([0, 8], 0.8),
          everyBar(0, (ctx) => {
            o.granCassa(ctx.time, 0.6);
            if (ctx.barInSection === 0 || ctx.barInSection === 4) o.crash(ctx.time, 0.8);
          }),
          fn((ctx) => {
            if (ctx.barInSection >= 4) return;
            for (const [step, midi, steps] of THEME[ctx.barInSection]) {
              if (step === ctx.step) {
                o.horn(ctx.time, midi - 12, steps * STEP, 0.85);
                o.horn(ctx.time, midi - 24, steps * STEP, 0.5);
              }
            }
          }),
          fn((ctx) => {
            if (ctx.barInSection >= 4 && ctx.step === 0) for (const midi of ctx.chord.pad.slice(0, 3)) o.horn(ctx.time, midi - 12, SPB * STEP * 0.9, 0.55);
          }),
          onBar(5, 8, (ctx) => o.swell(ctx.time, STEP * 8, 0.8)),
          fn((ctx) => {
            if (ctx.barInSection === 5 && ctx.step >= 12) o.snare(ctx.time, 0.3 + (ctx.step - 12) * 0.12);
          }),
        ],
      },
      {
        name: 'broadside-run',
        fromBar: BARS.broadside,
        toBar: BARS.eye,
        tracks: [
          pads(0.95, 0.75, 12),
          ostinato(0.95, true),
          broadsideCannons,
          timpaniOn([0, 2, 4, 6, 8, 10, 12, 14], 0.75),
          trumpetStabs([6, 14], 0.65),
          everyBar(0, (ctx) => {
            if (ctx.barInSection % 2 === 0) o.crash(ctx.time, 0.95);
          }),
          fn((ctx) => {
            const bars = [...THEME, ...ANSWER];
            const notes = bars[ctx.barInSection] ?? [];
            for (const [step, midi, steps] of notes) {
              if (step !== ctx.step) continue;
              o.horn(ctx.time, midi - 12, steps * STEP, 1);
              o.lowBrass(ctx.time, midi - 24, steps * STEP, 0.75);
            }
          }),
          fn((ctx) => {
            if ((ctx.barInSection === 1 || ctx.barInSection === 3) && ctx.step >= 12) o.snare(ctx.time, 0.35 + (ctx.step - 12) * 0.1);
          }),
          onBar(5, 0, (ctx) => {
            o.swell(ctx.time, SPB * STEP, 1);
            o.choir(ctx.time, [57, 61, 64, 69], SPB * STEP, 0.7);
          }),
          fn((ctx) => {
            if (ctx.barInSection === 5 && ctx.step >= 8) {
              const t = (ctx.step - 8) / 7;
              o.timpani(ctx.time, 45, 0.4 + t * 0.5, 0.4);
              o.timpani(ctx.time + STEP / 2, 45, 0.35 + t * 0.5, 0.4);
            }
          }),
        ],
      },
      {
        name: 'the-eye',
        fromBar: BARS.eye,
        toBar: BARS.belly,
        tracks: [
          onBar(0, 0, (ctx) => {
            // The cut: everything stops but a held harmonic and a far-off choir.
            o.strings(ctx.time, [81, 88], SPB * STEP * 2, 0.32, 0.15);
            o.choir(ctx.time, [57, 62, 64, 69], SPB * STEP * 2, 0.45);
          }),
          fn((ctx) => {
            if (ctx.step % 4 !== 0) return;
            const tones = ctx.chord.pad;
            const index = (ctx.barInSection * 4 + ctx.step / 4) % tones.length;
            o.harp(ctx.time, tones[index] + 12, 0.55);
          }),
          onBar(1, 8, (ctx) => o.cannon(ctx.time, 0.35, 0.9)),
          fn((ctx) => {
            if (ctx.barInSection === 1 && ctx.step >= 12) o.timpani(ctx.time, 38, 0.12 + (ctx.step - 12) * 0.08, 0.5);
          }),
        ],
      },
      {
        name: 'the-keel',
        fromBar: BARS.belly,
        toBar: BARS.flagship,
        tracks: [
          fn((ctx) => {
            if (ctx.step % 2 !== 0) return;
            const figure = [0, 0, 1, 0, 0, 0, 1, -2];
            const midi = ctx.chord.bass + figure[ctx.step / 2];
            o.lowBrass(ctx.time, midi, STEP * 1.4, ctx.step === 0 ? 0.95 : 0.6);
          }),
          fn((ctx) => {
            if (ctx.step === 0) o.strings(ctx.time, [ctx.chord.bass + 12, ctx.chord.bass + 19], SPB * STEP, 0.7, 0.15);
          }),
          timpaniOn([0, 6, 10], 0.85),
          fn((ctx) => {
            // Col legno: dry ticks on the chord, the ship's machinery ticking over.
            if (ctx.step % 2 === 1) o.spiccato(ctx.time, ctx.chord.pad[(ctx.step >> 1) % ctx.chord.pad.length], 0.28);
          }),
          everyBar(0, (ctx) => o.granCassa(ctx.time, 0.8)),
          onBar(3, 8, (ctx) => o.swell(ctx.time, STEP * 8, 0.85)),
          fn((ctx) => {
            if (ctx.barInSection === 3 && ctx.step >= 8) o.snare(ctx.time, 0.2 + (ctx.step - 8) * 0.07);
          }),
        ],
      },
      {
        name: 'flagship',
        fromBar: BARS.flagship,
        toBar: BARS.shieldsDown,
        tracks: [
          pads(0.9, 0.55),
          ostinato(0.9),
          timpaniOn([0, 4, 8, 12], 0.85),
          snareMarch,
          everyBar(0, (ctx) => {
            o.granCassa(ctx.time, 0.8);
            if (ctx.barInSection === 0) o.crash(ctx.time, 0.9);
          }),
          melody(VILLAIN, (time, midi, seconds) => {
            o.lowBrass(time, midi - 12, seconds, 0.95);
            o.horn(time, midi, seconds, 0.8);
          }),
          trumpetStabs([7, 15], 0.5),
          fn((ctx) => {
            if (ctx.barInSection === 3 && ctx.step >= 8) {
              o.snare(ctx.time, 0.3 + (ctx.step - 8) * 0.08);
              o.snare(ctx.time + STEP / 2, 0.3 + (ctx.step - 8) * 0.08);
            }
          }),
          onBar(3, 0, (ctx) => o.swell(ctx.time, SPB * STEP, 1)),
        ],
      },
      {
        name: 'shields-down',
        fromBar: BARS.shieldsDown,
        toBar: BARS.trench,
        tracks: [
          onBar(0, 0, (ctx) => {
            // The orchestral hit as the shield collapses.
            o.crash(ctx.time, 1, 3);
            o.granCassa(ctx.time, 1, 1.6);
            o.timpani(ctx.time, 46, 1);
            for (const midi of [58, 62, 65, 70, 74]) o.brass(ctx.time, midi, 1.1, 1, 0.9);
            o.choir(ctx.time, [58, 62, 65, 70], SPB * STEP * 2, 0.9);
            o.strings(ctx.time, [58, 62, 65, 70, 74], SPB * STEP * 2, 1, 0.8);
          }),
          fn((ctx) => {
            // Rising string runs.
            const scale = [62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79, 81, 82, 84, 86, 88];
            if (ctx.barInSection === 0 && ctx.step >= 4) o.spiccato(ctx.time, scale[ctx.step - 4], 0.55);
            if (ctx.barInSection === 1) o.spiccato(ctx.time, scale[ctx.step % scale.length] - (ctx.step < 8 ? 0 : -2), 0.6);
          }),
          fn((ctx) => {
            if (ctx.barInSection !== 1) return;
            const call: Note[] = [[0, 60, 6], [6, 55, 2], [8, 60, 4], [12, 62, 2], [14, 64, 2]];
            for (const [step, midi, steps] of call) if (step === ctx.step) o.horn(ctx.time, midi, steps * STEP, 1);
          }),
          timpaniOn([0, 4, 8, 12], 0.8),
          onBar(1, 0, (ctx) => o.swell(ctx.time, SPB * STEP, 1)),
          fn((ctx) => {
            if (ctx.barInSection === 1 && ctx.step >= 12) o.snare(ctx.time, 0.5 + (ctx.step - 12) * 0.12);
          }),
        ],
      },
      {
        name: 'trench',
        fromBar: BARS.trench,
        toBar: BARS.victory,
        tracks: [
          pads(0.95, 0.8, 12),
          ostinato(1, true),
          fn((ctx) => {
            const hitsPattern = 'x.x.xx.xx.x.xxxx';
            if (hitsPattern[ctx.step] === 'x' && ctx.barInSection < 3) o.timpani(ctx.time, timpaniPitch(ctx.chord), ctx.step === 0 ? 0.9 : 0.5, 0.6);
          }),
          trumpetStabs([3, 6, 10, 14], 0.6),
          fn((ctx) => {
            if (ctx.step % 2 === 1) o.snare(ctx.time, 0.14);
          }),
          everyBar(0, (ctx) => {
            o.granCassa(ctx.time, 0.9);
            if (ctx.barInSection % 2 === 0) o.crash(ctx.time, 0.9);
          }),
          fn((ctx) => {
            // The theme under the trench, reordered to the trench's i – VI – VII – V.
            const order = [0, 2, 1, 3];
            const notes = THEME[order[ctx.barInSection] ?? 0];
            for (const [step, midi, steps] of notes) {
              if (step !== ctx.step) continue;
              o.horn(ctx.time, midi - 12, steps * STEP, 1);
              o.lowBrass(ctx.time, midi - 24, steps * STEP, 0.7);
            }
          }),
          fn((ctx) => {
            if (ctx.barInSection !== 3) return;
            const t = ctx.step / 15;
            o.timpani(ctx.time, 45, 0.3 + t * 0.7, 0.5);
            o.timpani(ctx.time + STEP / 2, 45, 0.3 + t * 0.7, 0.5);
          }),
          onBar(3, 0, (ctx) => {
            o.swell(ctx.time, SPB * STEP, 1.1);
            for (const midi of [57, 61, 64]) o.brass(ctx.time, midi, SPB * STEP * 0.95, 0.75, 0.8);
          }),
        ],
      },
      {
        name: 'victory',
        fromBar: BARS.victory,
        toBar: BARS.end + 2,
        tracks: [
          fn((ctx) => {
            if (ctx.barInSection >= 4) return;
            if (state.flagshipDestroyed) victoryStep(ctx);
            else defeatStep(ctx);
          }),
        ],
      },
    ],
  });

  function victoryStep(ctx: Ctx) {
    const barIndex = ctx.barInSection;
    const chord = ctx.chord;
    if (ctx.step === 0) {
      o.crash(ctx.time, barIndex === 0 || barIndex === 3 ? 1 : 0.6, barIndex === 3 ? 4 : 2.4);
      o.granCassa(ctx.time, barIndex === 3 ? 1 : 0.7, barIndex === 3 ? 2 : 1.1);
      o.strings(ctx.time, [...chord.pad, chord.pad[0] + 12].map((m) => m + 12), SPB * STEP * (barIndex === 3 ? 2.4 : 1.02), 1, 0.9);
      o.strings(ctx.time, [chord.bass + 12, chord.bass + 19], SPB * STEP * (barIndex === 3 ? 2.4 : 1.02), 0.9, 0.4);
      o.choir(ctx.time, chord.pad, SPB * STEP * (barIndex === 3 ? 2.6 : 1.1), 0.85);
      for (const midi of chord.pad.slice(0, 3)) o.horn(ctx.time, midi - 12, SPB * STEP * (barIndex === 3 ? 2.2 : 0.95), 0.85);
    }
    if (ctx.step % 4 === 0 && barIndex < 3) o.timpani(ctx.time, timpaniPitch(chord), ctx.step === 0 ? 1 : 0.55);
    if (barIndex === 0 && ctx.step < 12) o.harp(ctx.time, chord.lead[ctx.step % chord.lead.length], 0.5);
    if (barIndex === 3 && ctx.step >= 8) {
      const t = (ctx.step - 8) / 7;
      o.timpani(ctx.time, 38, 0.3 + t * 0.6, 0.5);
      o.timpani(ctx.time + STEP / 2, 38, 0.3 + t * 0.6, 0.5);
    }
    for (const [step, midi, steps] of VICTORY[barIndex]) {
      if (step !== ctx.step) continue;
      o.brass(ctx.time, midi, steps * STEP * (barIndex === 3 ? 2.2 : 1), 1, 0.95);
      o.brass(ctx.time, midi - 12, steps * STEP * (barIndex === 3 ? 2.2 : 1), 0.7, 0.6);
    }
  }

  function defeatStep(ctx: Ctx) {
    const barIndex = ctx.barInSection;
    const chord = DEFEAT[barIndex];
    if (ctx.step === 0) {
      o.strings(ctx.time, [chord.bass + 12, ...chord.pad.slice(0, 3)], SPB * STEP * (barIndex === 3 ? 2.4 : 1.02), 0.6 - barIndex * 0.08, 0.25);
      if (barIndex === 0) o.horn(ctx.time, 50, SPB * STEP * 1.5, 0.6);
      if (barIndex === 2) o.horn(ctx.time, 45, SPB * STEP * 1.5, 0.5);
    }
    if (ctx.step === 0 || ctx.step === 6) o.timpani(ctx.time, timpaniPitch(chord), 0.4 - barIndex * 0.06, 1);
  }

  // ---- attract ---------------------------------------------------------------------------------

  const ambient = createArrangement<Chord>({
    stepsPerBar: SPB,
    chordAt: (position) => AMBIENT[Math.floor(position / (SPB * 2)) % AMBIENT.length],
    sections: [{
      name: 'deck',
      fromBar: 0,
      tracks: [
        fn((ctx) => {
          if (ctx.step === 0 && ctx.bar % 2 === 0) {
            o.strings(ctx.time, ctx.chord.pad.map((m) => m - 12), SPB * STEP * 2.05, 0.55, 0.25);
            o.strings(ctx.time, [ctx.chord.bass + 12], SPB * STEP * 2.05, 0.5, 0.2);
          }
          if (ctx.step === 8 && ctx.bar % 2 === 1) o.cannon(ctx.time, 0.3, 0.85);
          if (ctx.step === 0 && ctx.bar % 8 === 4) {
            o.horn(ctx.time, 62, STEP * 6, 0.45);
            o.horn(ctx.time + STEP * 6, 57, STEP * 2, 0.4);
            o.horn(ctx.time + STEP * 8, 62, STEP * 8, 0.45);
          }
          if (ctx.step % 8 === 0) o.harp(ctx.time, ctx.chord.pad[(ctx.bar * 2 + ctx.step / 8) % ctx.chord.pad.length] + 12, 0.3);
        }),
      ],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambient.schedule(position, time);
    else {
      if (position % SPB === 0) run.recordSectionStart(time, position / SPB);
      run.schedule(position, time);
    }
  }

  // ---- the player's instruments ------------------------------------------------------------------

  const ctxNow = () => runtime.context();
  const positionAt = (time: number) => score.arrangementPositionAt(time);
  const sectionAt = (position: number): ScoreSectionIndex => score.sectionMixAt(position).to;

  bus.on('lock', ({ lockCount }) => {
    const ctx = ctxNow();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(positionAt(time));
    o.lockPluck(time, lead[Math.min(lead.length - 1, lockCount - 1)], 0.8 + lockCount * 0.06);
  });

  bus.on('fire', ({ indexInVolley, volleySize }) => {
    const ctx = ctxNow();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = score.chordAt(positionAt(time));
    const index = indexInVolley ?? 0;
    const tones = [...chord.pad, ...chord.pad.map((m) => m + 12)];
    o.fireBlat(time, tones[index % tones.length] - 12, 0.7 + (volleySize >= 6 ? 0.3 : 0));
    if (volleySize >= 6 && index === 0) o.timpani(time, timpaniPitch(chord), 0.55, 0.6);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const ctx = ctxNow();
    if (!ctx) return;
    if (state.coreIds.has(enemyId)) {
      state.coreIds.delete(enemyId);
      state.coresDown += 1;
      coreBlast(state.coresDown >= 3);
      return;
    }
    if (state.generatorIds.has(enemyId)) {
      state.generatorIds.delete(enemyId);
      state.generatorsDown += 1;
      generatorBlast(state.generatorsDown);
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const voice = SOLO_VOICE[sectionAt(position)];
    const chain = indexInVolley ?? 0;
    o.killNote(kill.time, kill.midi, voice.gain * Math.min(1.35, 1 + chain * 0.07), voice.timbre, voice.brightness);
  });

  bus.on('hit', ({ lethal, enemyId }) => {
    const ctx = ctxNow();
    if (!ctx || lethal) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = positionAt(time);
    const chord = score.chordAt(position);
    if (state.coreIds.has(enemyId)) {
      // The core fight climbs: each hit reaches a step higher through the chord.
      state.coreHits += 1;
      const lead = chord.lead;
      const midi = lead[Math.min(lead.length - 1, 2 + (state.coreHits % 6))];
      o.brass(time, midi, 0.22, 0.6 + Math.min(0.5, state.coreHits * 0.04), 0.6 + Math.min(0.4, state.coreHits * 0.04), 'sfx');
      o.timpani(time, timpaniPitch(chord), 0.5 + Math.min(0.4, state.coreHits * 0.03), 0.7);
      return;
    }
    o.armorTick(time, timpaniPitch(chord), chord.lead[3], 0.8);
  });

  bus.on('stage', () => {
    const ctx = ctxNow();
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const chord = score.chordAt(positionAt(time));
    for (const midi of chord.pad.slice(0, 3)) o.brass(time, midi, 0.3, 0.8, 0.8, 'sfx');
    o.timpani(time, timpaniPitch(chord), 0.85);
    o.crash(time, 0.35, 1.2);
  });

  function generatorBlast(count: number) {
    const ctx = ctxNow();
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const chord = score.chordAt(positionAt(time));
    // Each generator down stacks the chord higher: the shield's failure is a crescendo.
    const lift = count >= 3 ? 12 : 0;
    for (const midi of chord.pad) o.brass(time, midi + lift, 0.45, 0.7 + count * 0.08, 0.7 + count * 0.07, 'sfx');
    o.granCassa(time, 0.7 + count * 0.07);
    o.crash(time, 0.5 + count * 0.1, 1.6);
    o.timpani(time, timpaniPitch(chord), 1);
  }

  function coreBlast(final: boolean) {
    const ctx = ctxNow();
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    const time = score.nextGridTime(ctx.currentTime, final ? 4 : 2);
    const chord = score.chordAt(positionAt(time));
    if (final) {
      // The killing blow: the orchestra draws breath and lands the dominant
      // that the victory theme resolves.
      mix.duckAt(time, 0.25, 2.2);
      for (const midi of [57, 61, 64, 69, 73]) o.brass(time, midi, 1.4, 1, 1, 'sfx');
      o.granCassa(time, 1, 2);
      o.crash(time, 1, 3.5);
      o.timpani(time, 45, 1, 1.8);
      o.choir(time, [57, 61, 64, 69], 2.4, 1);
    } else {
      for (const midi of chord.pad) o.brass(time, midi, 0.6, 0.9, 0.9, 'sfx');
      o.granCassa(time, 0.9);
      o.crash(time, 0.8, 2);
      o.timpani(time, timpaniPitch(chord), 1);
    }
  }

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind === 'core') state.coreIds.add(enemyId);
    if (kind === 'generator') state.generatorIds.add(enemyId);
    if (kind !== 'generator' && kind !== 'core') return;
    const ctx = ctxNow();
    if (!ctx) return;
    // The flagship announces each exposed system with a low-brass semitone.
    const time = score.nextGridTime(ctx.currentTime, 2);
    const chord = score.chordAt(positionAt(time));
    o.lowBrass(time, chord.bass + 12, STEP * 2, 0.6);
    o.lowBrass(time + STEP * 2, chord.bass + 13, STEP * 3, 0.7);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') state.flagshipDestroyed = true;
  });

  bus.on('reject', () => {
    const ctx = ctxNow();
    if (ctx) o.rejectBlat(ctx.currentTime, 0.9);
  });

  bus.on('miss', ({ letter }) => {
    const ctx = ctxNow();
    if (!ctx || letter) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    o.missPizz(time, score.chordAt(positionAt(time)).bass + 12);
  });

  bus.on('playerhit', () => {
    const ctx = ctxNow();
    if (ctx) o.hullHit(ctx.currentTime);
  });

  return runtime;
}
