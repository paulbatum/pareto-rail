import type { EventBus } from '../../events';
import { createArrangement, fn, type ArrangementContext, type ArrangementSection } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, playBufferSourceVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import {
  bellVoice,
  brassVoice,
  choirVoice,
  cymbalNoise,
  glassVoice,
  gongVoice,
  harpVoice,
  lowBrassVoice,
  snareBody,
  snareNoise,
  spiccatoVoice,
  stabVoice,
  stringsVoice,
  subVoice,
  thumpNoise,
  tickNoise,
  timpaniVoice,
  zapVoice,
} from './audio-voices';
import { BARS, BROADSIDE_TLLU_BPM, BROADSIDE_TLLU_RUN_DURATION, BROADSIDE_TLLU_SCORE_SECTIONS, BROADSIDE_TLLU_STEPS_PER_BAR, BROADSIDE_TLLU_TIME, type BroadsideSection } from './timing';

// The Broadside score: space opera, 128 BPM, 32 bars, C minor turning to C major.
// Brass and strings over timpani; every push swells, the eye of the battle drops
// to a solo horn and a heartbeat, and the last core's death lands on the
// victory theme's downbeat (bar 29). The player is the soloist above the
// orchestra: locks pluck glass-harp arpeggios up the live chord, volleys hit
// like a brass stab, and kills play a written bell lane in the harmony.

const STEP = BROADSIDE_TLLU_TIME.stepSeconds;
const STEPS = BROADSIDE_TLLU_STEPS_PER_BAR;

type Chord = { name: string; bass: number; pad: number[]; stab: number[]; lead: number[] };

const MINOR = [0, 3, 7, 10, 14];
const MAJOR = [0, 4, 7, 11, 14];
const DOMINANT = [0, 4, 7, 10, 14];
const TRIAD_MINOR = [0, 3, 7];
const TRIAD_MAJOR = [0, 4, 7];

function chord(name: string, rootPitchClass: number, intervals: number[], triad: number[]): Chord {
  const pitchClasses = new Set(intervals.map((interval) => (rootPitchClass + interval) % 12));
  const lead: number[] = [];
  for (let midi = 79; lead.length < 8; midi += 1) if (pitchClasses.has(midi % 12)) lead.push(midi);
  const lift = (midi: number, floor: number) => {
    let value = midi;
    while (value < floor) value += 12;
    return value;
  };
  return {
    name,
    bass: 36 + rootPitchClass,
    pad: intervals.slice(0, 4).map((interval) => lift(48 + rootPitchClass + interval, 55)),
    stab: triad.map((interval) => lift(48 + rootPitchClass + interval, 60)),
    lead,
  };
}

const Cm = chord('Cm', 0, MINOR, TRIAD_MINOR);
const Fm = chord('Fm', 5, MINOR, TRIAD_MINOR);
const Ab = chord('Ab', 8, MAJOR, TRIAD_MAJOR);
const Eb = chord('Eb', 3, MAJOR, TRIAD_MAJOR);
const Bb = chord('Bb', 10, MAJOR, TRIAD_MAJOR);
const Db = chord('Db', 1, MAJOR, TRIAD_MAJOR);
const G7 = chord('G7', 7, DOMINANT, TRIAD_MAJOR);
const C = chord('C', 0, MAJOR, TRIAD_MAJOR);

// One chord per bar, 32 bars.
const CHORDS: Chord[] = [
  Cm, G7, // launch
  Cm, Ab, Eb, Bb, Cm, Ab, G7, // crossfire (2-8)
  Ab, Eb, Bb, Cm, Ab, Bb, // broadside (9-14)
  Ab, Fm, Eb, // eye (15-17)
  Cm, Db, G7, // belly (18-20)
  Cm, Ab, Fm, // flagship (21-23)
  Cm, Db, // escorts (24-25)
  Cm, Fm, G7, // trench (26-28)
  C, Bb, C, // victory (29-31)
];

// Hidden kill lanes (degrees into the live 8-note lead set), one per score section.
// Consecutive steps make runs: a chained volley plays a phrase, not a chord.
const KILL_LANES: Record<BroadsideSection, number[]> = {
  0: [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 6, 7, 6, 5, 4, 2, 3, 4, 5, 6, 5, 4, 2, 4, 5, 7, 6, 5, 4, 3],
  1: [4, 5, 6, 7, 6, 5, 4, 2, 4, 6, 7, 5, 4, 2, 0, 2, 5, 6, 7, 7, 6, 4, 5, 6, 7, 5, 4, 5, 6, 4, 2, 4],
  2: [0, 2, 4, 7, 4, 2, 0, 2, 1, 3, 5, 7, 5, 3, 1, 3, 0, 4, 2, 5, 4, 7, 5, 3, 1, 4, 3, 6, 5, 2, 4, 0],
  3: [0, 3, 1, 4, 2, 5, 3, 6, 4, 2, 5, 3, 6, 4, 7, 5, 7, 4, 6, 3, 5, 2, 4, 1, 3, 0, 2, 4, 6, 4, 2, 0],
  4: [7, 5, 6, 4, 5, 3, 4, 2, 7, 6, 5, 4, 6, 5, 4, 3, 5, 6, 7, 6, 4, 5, 6, 4, 2, 3, 4, 5, 3, 4, 5, 7],
  5: [0, 2, 4, 7, 4, 2, 4, 7, 5, 7, 6, 7, 7, 6, 5, 4, 2, 4, 7, 6, 5, 7, 4, 6, 7, 5, 6, 4, 7, 7, 6, 7],
};

type Note = readonly [bar: number, step: number, midi: number, steps: number];

// The launch call, then Theme A: the fleet's tune, rising G-G-C-Eb.
const FANFARE: Note[] = [[1, 0, 67, 4], [1, 4, 72, 4], [1, 8, 75, 4], [1, 12, 79, 4]];
const THEME_A: Note[] = [
  [2, 0, 67, 6], [2, 6, 67, 2], [2, 8, 72, 4], [2, 12, 75, 4],
  [3, 0, 75, 6], [3, 6, 72, 2], [3, 8, 68, 4], [3, 12, 72, 4],
  [4, 0, 67, 6], [4, 6, 70, 2], [4, 8, 75, 8],
  [5, 0, 74, 6], [5, 6, 72, 2], [5, 8, 70, 4], [5, 12, 74, 4],
  [6, 0, 75, 6], [6, 6, 74, 2], [6, 8, 72, 4], [6, 12, 67, 4],
  [7, 0, 68, 6], [7, 6, 72, 2], [7, 8, 75, 6], [7, 14, 72, 2],
];
// Theme B: the broadside, a big open melody over Ab-Eb-Bb-Cm-Ab-Bb.
const THEME_B: Note[] = [
  [9, 0, 75, 8], [9, 8, 72, 4], [9, 12, 75, 4],
  [10, 0, 70, 6], [10, 6, 70, 2], [10, 8, 75, 8],
  [11, 0, 77, 8], [11, 8, 74, 4], [11, 12, 77, 4],
  [12, 0, 75, 6], [12, 6, 74, 2], [12, 8, 72, 8],
  [13, 0, 68, 4], [13, 4, 72, 4], [13, 8, 75, 4], [13, 12, 80, 4],
  [14, 0, 77, 6], [14, 6, 74, 2], [14, 8, 70, 4],
];
// The eye: one solo horn, very quiet.
const EYE_HORN: Note[] = [[15, 2, 72, 12], [16, 0, 68, 8], [16, 8, 67, 8], [17, 2, 70, 10]];
// Belly menace: the minor-second motif.
const BELLY_HORN: Note[] = [
  [18, 0, 60, 6], [18, 6, 61, 2], [18, 8, 60, 8],
  [19, 0, 65, 6], [19, 6, 63, 2], [19, 8, 61, 8],
  [20, 0, 62, 4], [20, 4, 62, 4], [20, 8, 67, 8],
];
// The flagship: a dread march.
const FLAGSHIP_HORN: Note[] = [
  [21, 0, 67, 3], [21, 3, 67, 3], [21, 6, 67, 2], [21, 8, 70, 4], [21, 12, 72, 4],
  [22, 0, 75, 3], [22, 3, 75, 3], [22, 6, 75, 2], [22, 8, 72, 4], [22, 12, 68, 4],
  [23, 0, 77, 3], [23, 3, 77, 3], [23, 6, 75, 2], [23, 8, 72, 4], [23, 12, 68, 4],
  [24, 0, 75, 4], [24, 4, 74, 4], [24, 8, 72, 4], [24, 12, 67, 4],
];
// Victory: Theme A returns in the major.
const VICTORY_HORN: Note[] = [
  [29, 0, 67, 6], [29, 6, 67, 2], [29, 8, 72, 4], [29, 12, 76, 4],
  [30, 0, 74, 4], [30, 4, 77, 4], [30, 8, 74, 8],
  [31, 0, 79, 16],
];
const THEMES: Note[] = [...FANFARE, ...THEME_A, ...THEME_B, ...EYE_HORN, ...BELLY_HORN, ...FLAGSHIP_HORN, ...VICTORY_HORN];

/** Orchestra loudness by bar (linear, smoothly interpolated): the run breathes with each push. */
const ENERGY: ReadonlyArray<readonly [bar: number, level: number]> = [
  [0, 0.6], [1, 0.75], [2, 0.86], [4, 0.72], [5.5, 1.0], [8, 0.95], [9, 1.18], [14, 1.05], [14.75, 1.0],
  [15, 0.36], [17, 0.42], [17.9, 0.6], [18, 0.82], [20, 0.9], [21, 1.1], [24, 1.2], [26, 0.92], [28, 1.02],
  [29, 1.3], [31, 1.1], [32, 0.9],
];

function energyAt(bar: number) {
  if (bar <= ENERGY[0][0]) return ENERGY[0][1];
  for (let i = 1; i < ENERGY.length; i += 1) {
    if (bar <= ENERGY[i][0]) {
      const [b0, v0] = ENERGY[i - 1];
      const [b1, v1] = ENERGY[i];
      const t = Math.min(1, Math.max(0, (bar - b0) / Math.max(1e-6, b1 - b0)));
      return v0 + (v1 - v0) * (t * t * (3 - 2 * t));
    }
  }
  return ENERGY[ENERGY.length - 1][1];
}

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideTlluAudio = createAudioTraceHarness({
  level: 'broadside-tllu',
  bpm: BROADSIDE_TLLU_BPM,
  stepSeconds: STEP,
  defaultSeconds: BROADSIDE_TLLU_RUN_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, BroadsideSection>({
    bpm: BROADSIDE_TLLU_BPM,
    stepsPerBar: STEPS,
    chords: CHORDS,
    barsPerChord: 1,
    sections: BROADSIDE_TLLU_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP,
    volumeScale: 0.74,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -7, knee: 3, ratio: 12, attack: 0.001, release: 0.16 },
      delay: { time: STEP * 3, feedback: 0.26, dampHz: 2600 },
      reverb: { seconds: 2.9, decay: 2.4, level: 0.46 },
      noiseSeconds: 3.5,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      bossKinds.clear();
      finale = false;
      bossHits = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) inst.choir(context.currentTime + 0.1, C.pad, 5, 0.6);
    },
  });

  const bossKinds = new Map<number, string>();
  let finale = false;
  let bossHits = 0;

  /** The orchestra's dynamic contour: quieter in the eye, swelling into each push. */
  let orchestraLevel = 1;
  const lv = () => orchestraLevel;
  const orchestra = () => runtime.mix()?.duck ?? null;
  const sfx = () => runtime.mix()?.sfx ?? null;
  const hall = (gain: number) => {
    const send = runtime.mix()?.reverbSend;
    return send ? [{ destination: send, gain }] : [];
  };
  const echo = (gain: number) => {
    const send = runtime.mix()?.delaySend;
    return send ? [{ destination: send, gain }] : [];
  };

  const inst = defineInstruments(
    { trace, context: runtime.context },
    {
      brass(context, time, midi, velocity, duration, bright) {
        const out = orchestra();
        if (!out) return;
        brassVoice.play({ context, time, midi, velocity: velocity * lv(), duration, bright, gain: 0.115, destination: out, sends: hall(0.32) });
      },
      stab(context, time, midis, velocity, bright) {
        const out = orchestra();
        if (!out) return;
        for (const midi of midis as number[]) stabVoice.play({ context, time, midi, velocity: velocity * lv(), bright, gain: 0.085, destination: out, sends: hall(0.3) });
      },
      lowBrass(context, time, midi, velocity, duration) {
        const out = orchestra();
        if (!out) return;
        lowBrassVoice.play({ context, time, midi, velocity: velocity * lv(), duration, gain: 0.15, destination: out });
      },
      strings(context, time, midis, velocity, duration, attack) {
        const out = orchestra();
        if (!out) return;
        for (const midi of midis as number[]) stringsVoice.play({ context, time, midi, velocity: velocity * lv(), duration, attack, gain: 0.05, destination: out, sends: hall(0.5) });
      },
      spiccato(context, time, midi, velocity, decay, bright) {
        const out = orchestra();
        if (!out) return;
        spiccatoVoice.play({ context, time, midi, velocity: velocity * lv(), decay, bright, gain: 0.05, destination: out, sends: hall(0.16) });
      },
      choir(context, time, midis, seconds, velocity) {
        const out = orchestra();
        if (!out) return;
        for (const midi of midis as number[]) choirVoice.play({ context, time, midi: midi + 12, velocity: velocity * lv(), duration: seconds, gain: 0.05, destination: out, sends: hall(0.7) });
      },
      timpani(context, time, midi, velocity) {
        const mix = runtime.mix();
        if (!mix?.duck) return;
        timpaniVoice.play({ context, time, midi, velocity: velocity * lv(), decay: 0.5 + velocity * 0.9, gain: 0.5, destination: mix.duck, sends: hall(0.22) });
        if (mix.noiseBuffer) thumpNoise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * lv() * 0.35, destination: mix.duck, offset: Math.random() });
        if (velocity * lv() > 0.7) mix.duckAt(time, 0.74, 0.2);
      },
      harp(context, time, midi, velocity, decay) {
        const out = orchestra();
        if (!out) return;
        harpVoice.play({ context, time, midi, velocity: velocity * lv(), decay, gain: 0.1, destination: out, sends: hall(0.6) });
      },
      snare(context, time, velocity) {
        const mix = runtime.mix();
        if (!mix?.noiseBuffer || !mix.duck) return;
        snareNoise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * lv() * 0.24, destination: mix.duck, offset: Math.random() });
        snareBody.play({ context, time, midi: 55, velocity: velocity * lv(), gain: 0.08, destination: mix.duck });
      },
      cymbal(context, time, velocity, decay) {
        const mix = runtime.mix();
        if (!mix?.noiseBuffer || !mix.duck) return;
        cymbalNoise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * lv() * 0.16, decay, destination: mix.duck, offset: Math.random() });
        if (mix.reverbSend) cymbalNoise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * lv() * 0.05, decay: decay * 1.4, destination: mix.reverbSend, offset: Math.random() });
      },
      tick(context, time, velocity) {
        const mix = runtime.mix();
        if (!mix?.noiseBuffer || !mix.duck) return;
        tickNoise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * lv() * 0.1, destination: mix.duck, offset: Math.random() });
      },
      riser(context, time, seconds, velocity) {
        const mix = runtime.mix();
        if (!mix?.noiseBuffer || !mix.duck) return;
        playBufferSourceVoice({
          context,
          buffer: mix.noiseBuffer,
          time,
          stopTime: time + seconds + 0.05,
          loop: true,
          filter: {
            type: 'bandpass',
            Q: 0.9,
            frequency: 600,
            frequencyAutomation: [
              { type: 'set', value: 500, time },
              { type: 'exponentialRamp', value: 7200, time: time + seconds },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.0001, time },
            { type: 'exponentialRamp', value: 0.16 * velocity * lv(), time: time + seconds * 0.96 },
            { type: 'linearRamp', value: 0.0001, time: time + seconds },
          ],
          destination: mix.duck,
        });
      },
      sub(context, time, midi, velocity, duration) {
        const out = orchestra();
        if (!out) return;
        subVoice.play({ context, time, midi, velocity: velocity * lv(), duration, gain: 0.35, destination: out });
      },
      gong(context, time, midi, velocity, decay) {
        const out = orchestra();
        if (!out) return;
        gongVoice.play({ context, time, midi, velocity: velocity * lv(), decay, gain: 0.11, destination: out, sends: hall(0.7) });
      },
      glass(context, time, midi, velocity, decay, bright) {
        const out = sfx();
        if (!out) return;
        glassVoice.play({ context, time, midi, velocity, decay, bright, gain: 0.16, destination: out, sends: [...hall(0.36), ...echo(0.22)] });
      },
      bell(context, time, midi, velocity, decay) {
        const out = sfx();
        if (!out) return;
        bellVoice.play({ context, time, midi, velocity, decay, gain: 0.11, destination: out, sends: [...hall(0.5), ...echo(0.22)] });
      },
      zap(context, time, midi, velocity, drop) {
        const out = sfx();
        if (!out) return;
        zapVoice.play({ context, time, midi, velocity, drop, gain: 0.1, destination: out, sends: hall(0.2) });
      },
    },
    {
      brass: ['midi', 'velocity', 'duration', 'bright'],
      stab: ['midis', 'velocity', 'bright'],
      lowBrass: ['midi', 'velocity', 'duration'],
      strings: ['midis', 'velocity', 'duration', 'attack'],
      spiccato: ['midi', 'velocity', 'decay', 'bright'],
      choir: ['midis', 'seconds', 'velocity'],
      timpani: ['midi', 'velocity'],
      harp: ['midi', 'velocity', 'decay'],
      snare: ['velocity'],
      cymbal: ['velocity', 'decay'],
      tick: ['velocity'],
      riser: ['seconds', 'velocity'],
      sub: ['midi', 'velocity', 'duration'],
      gong: ['midi', 'velocity', 'decay'],
      glass: ['midi', 'velocity', 'decay', 'bright'],
      bell: ['midi', 'velocity', 'decay'],
      zap: ['midi', 'velocity', 'drop'],
    },
  );

  // ---- arrangement helpers ---------------------------------------------------------------

  const barSeconds = STEP * STEPS;
  const at = (context: ArrangementContext<Chord>) => context.time;
  const sixteenth = (context: ArrangementContext<Chord>) => context.bar + context.step / STEPS;

  /** Horn/trumpet melody from the note tables; velocity and brightness follow the act. */
  function melody(context: ArrangementContext<Chord>, velocity: number, bright: number, octaveDouble = false) {
    for (const [noteBar, noteStep, midi, steps] of THEMES) {
      if (noteBar === context.bar && noteStep === context.step) {
        inst.brass(at(context), midi, velocity, steps * STEP * 0.96, bright);
        if (octaveDouble) inst.brass(at(context), midi + 12, velocity * 0.5, steps * STEP * 0.9, bright);
      }
    }
  }

  function timpaniPattern(context: ArrangementContext<Chord>, pattern: string, velocity: number, note = context.chord.bass + 12) {
    const symbol = pattern[context.step % pattern.length];
    if (symbol === 'X') inst.timpani(at(context), note, velocity);
    else if (symbol === 'x') inst.timpani(at(context), note, velocity * 0.6);
    else if (symbol === 'f') inst.timpani(at(context), note + 7, velocity * 0.5);
  }

  function snareRoll(context: ArrangementContext<Chord>, from: number, to: number, everyStep = 1) {
    if (context.step % everyStep !== 0) return;
    const t = (context.step) / (STEPS - 1);
    inst.snare(at(context), from + (to - from) * t);
  }

  const ostinato8ths = (context: ArrangementContext<Chord>, velocity: number, octave = 12) => {
    if (context.step % 2 !== 0) return;
    const chord = context.chord;
    inst.lowBrass(at(context), chord.bass + octave + (context.step % 8 === 6 ? 7 : 0), velocity, STEP * 1.6);
  };

  const sixteenthStrings = (context: ArrangementContext<Chord>, velocity: number, bright: number) => {
    const tones = context.chord.stab;
    const figure = [0, 1, 2, 1];
    const midi = tones[figure[context.step % 4]] + 12;
    inst.spiccato(at(context), midi, velocity, STEP * 1.2, bright);
  };

  const pad = (context: ArrangementContext<Chord>, velocity: number, seconds = barSeconds * 1.05, attack = 0.5, everyBars = 1) => {
    if (context.step === 0 && (context.bar % everyBars === 0)) inst.strings(at(context), context.chord.pad, velocity, seconds, attack);
  };

  // ---- the run: one arrangement section per movement ---------------------------------------------

  const runSections: Array<ArrangementSection<Chord>> = [
    {
      name: 'launch',
      fromBar: BARS.launch,
      toBar: BARS.crossfire,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          // bar 0: strings swell, timpani rolls up; bar 1: the fanfare call
          if (bar === 0 && step === 0) {
            inst.strings(at(context), context.chord.pad, 0.7, barSeconds * 2.05, 0.9);
            inst.sub(at(context), 36, 0.6, barSeconds * 1.6);
            inst.riser(at(context), barSeconds * 1.95, 0.75);
          }
          if (bar === 0 && step >= 4) inst.timpani(at(context), 43, 0.16 + (step - 4) * 0.045);
          if (bar === 1 && step % 2 === 0) inst.timpani(at(context), 43, 0.45 + step * 0.03);
          if (bar === 1 && step % 4 === 0) inst.tick(at(context), 0.6 + step * 0.05);
          if (bar === 1 && step === 0) inst.choir(at(context), Cm.pad, 2.4, 0.5);
          melody(context, 0.62 + step * 0.01, 0.55, true);
          if (bar === 1 && step >= 8) inst.snare(at(context), 0.15 + (step - 8) * 0.06);
        }),
      ],
    },
    {
      name: 'crossfire',
      fromBar: BARS.crossfire,
      toBar: BARS.flank,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          const intoSection = sixteenth(context) - BARS.crossfire;
          const push = sixteenth(context) >= BARS.crossfirePush;
          if (bar === 2 && step === 0) {
            inst.cymbal(at(context), 1.0, 2.2);
            inst.timpani(at(context), 36, 1);
            inst.stab(at(context), Cm.stab, 0.9, 0.9);
          }
          timpaniPattern(context, push ? 'X.x.X.x.X.x.X.xf' : 'X.....x.X.....x.', push ? 0.85 : 0.72, context.chord.bass + 12);
          if (bar >= 3) ostinato8ths(context, push ? 0.62 : 0.5, 12);
          if (bar >= 3) pad(context, push ? 0.6 : 0.5);
          if (intoSection > 2) sixteenthStrings(context, push ? 0.55 : 0.36, push ? 0.8 : 0.5);
          if (push && context.step % 4 === 2) inst.tick(at(context), 0.6);
          melody(context, push ? 0.78 : 0.68, push ? 0.85 : 0.62, push);
          if (bar === 5 && step === 8) inst.cymbal(at(context), 0.8, 1.6); // the push lands at bar 5.5
          if (bar === 5 && step === 8) inst.stab(at(context), Bb.stab, 0.85, 0.9);
          if (bar === 8) {
            // build into the broadside: snare roll and a rising noise wash
            if (step === 0) inst.riser(at(context), barSeconds * 0.98, 0.9);
            snareRoll(context, 0.12, 0.85);
            if (step % 2 === 0) inst.timpani(at(context), 43, 0.4 + step * 0.03);
          }
        }),
      ],
    },
    {
      name: 'broadside',
      fromBar: BARS.flank,
      toBar: BARS.eye,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          const late = bar === 14;
          if (bar === 9 && step === 0) {
            inst.cymbal(at(context), 1.0, 2.6);
            inst.timpani(at(context), 32, 1);
            inst.stab(at(context), Ab.stab, 1, 1);
            inst.gong(at(context), 32, 0.6, 3.4);
          }
          // the guns: a two-bar rolling artillery cadence, timpani + stabs together
          if (!late || step < 12) {
            timpaniPattern(context, 'X.x.x.X.x.x.X.x.', 0.9, context.chord.bass + 12);
            if (step % 4 === 0) inst.stab(at(context), context.chord.stab, step === 0 ? 0.62 : 0.46, 0.75);
            if (step === 6 || step === 14) inst.stab(at(context), context.chord.stab, 0.42, 0.7);
            if (step % 4 === 2) inst.tick(at(context), 0.7);
            if (step === 4 || step === 12) inst.snare(at(context), 0.55);
          }
          if (!late || step < 12) {
            pad(context, 0.85);
            sixteenthStrings(context, 0.5, 0.85);
            ostinato8ths(context, 0.6, 12);
            melody(context, 0.9, 1, true);
          }
          if (step === 0 && bar !== 9) inst.cymbal(at(context), 0.55, 1.4);
          // bar 14: everything stops one beat early: the fleet holds its breath
          if (bar === 14 && step === 12) inst.riser(at(context), STEP * 4.2, 0.5);
        }),
      ],
    },
    {
      name: 'eye',
      fromBar: BARS.eye,
      toBar: 18,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          if (bar === 15 && step === 0) {
            inst.gong(at(context), 44, 0.4, 4.2);
            inst.sub(at(context), 32, 0.6, barSeconds * 1.6);
          }
          // a very soft pad blooms; a solo horn sings; a harp answers; a heartbeat underneath
          if (step === 0) inst.strings(at(context), context.chord.pad.slice(0, 3), 0.28, barSeconds * 1.08, 1.1);
          if (step === 4 || step === 9 || step === 13) {
            const tones = context.chord.pad;
            inst.harp(at(context), tones[(step + bar) % tones.length] + 12, 0.42, 1.6);
          }
          if (step === 0 || step === 10) inst.timpani(at(context), context.chord.bass + 12, step === 0 ? 0.26 : 0.16);
          melody(context, 0.34, 0.2);
          if (bar === 17) {
            if (step === 0) inst.riser(at(context), barSeconds * 0.98, 0.7);
            if (step >= 8 && step % 2 === 0) inst.timpani(at(context), 39, 0.16 + (step - 8) * 0.06);
            if (step >= 12) snareRoll(context, 0.05, 0.4, 2);
          }
        }),
      ],
    },
    {
      name: 'belly',
      fromBar: 18,
      toBar: BARS.flagship,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          const heat = (bar - 18) / 2;
          if (step === 0 && bar === 18) {
            inst.timpani(at(context), 36, 0.95);
            inst.stab(at(context), [Cm.bass + 12, Cm.bass + 19], 0.7, 0.4);
            inst.gong(at(context), 36, 0.4, 3);
          }
          timpaniPattern(context, 'X...x...X...x.f.', 0.75, context.chord.bass + 12);
          ostinato8ths(context, 0.6 + heat * 0.1, 0);
          if (step % 4 === 0 || step === 3 || step === 11) inst.lowBrass(at(context), context.chord.bass + 12, 0.42, STEP * 1.4);
          if (bar >= 19) sixteenthStrings(context, 0.28 + heat * 0.2, 0.55);
          pad(context, 0.55, barSeconds * 1.05, 0.7);
          melody(context, 0.6 + heat * 0.15, 0.55 + heat * 0.15);
          // the snare wakes: 8ths, then 16ths, then a roll
          if (bar === 18 && step % 4 === 2) inst.snare(at(context), 0.3);
          if (bar === 19 && step % 2 === 0) inst.snare(at(context), 0.32 + step * 0.015);
          if (bar === 20) snareRoll(context, 0.3, 0.95);
          if (bar === 20 && step === 0) inst.riser(at(context), barSeconds * 0.98, 0.9);
        }),
      ],
    },
    {
      name: 'flagship',
      fromBar: BARS.flagship,
      toBar: 24,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          if (bar === 21 && step === 0) {
            inst.cymbal(at(context), 1, 2.8);
            inst.gong(at(context), 36, 0.7, 3.6);
            inst.timpani(at(context), 24 + 12, 1);
            inst.stab(at(context), Cm.stab, 1, 1);
          }
          // war drums: eighth-note timpani with accents, snare backbeat, syncopated brass
          timpaniPattern(context, 'X.xXx.xXX.xXx.xf', 0.86, context.chord.bass + 12);
          if (step === 4 || step === 12) inst.snare(at(context), 0.78);
          if (step % 4 === 2) inst.tick(at(context), 0.8);
          if (step === 0 || step === 3 || step === 6 || step === 10 || step === 12) inst.stab(at(context), context.chord.stab, step === 0 ? 0.72 : 0.5, 0.8);
          sixteenthStrings(context, 0.5, 0.9);
          ostinato8ths(context, 0.6, 12);
          pad(context, 0.7);
          if (step === 0) inst.choir(at(context), context.chord.pad, barSeconds * 1.02, 0.5);
          melody(context, 0.95, 1, true);
          if (step === 0 && bar !== 21) inst.cymbal(at(context), 0.6, 1.4);
          if (bar === 23 && step >= 8) snareRoll(context, 0.2, 0.8, 1);
        }),
      ],
    },
    {
      name: 'escorts',
      fromBar: BARS.escorts,
      toBar: BARS.trench,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          if (bar === BARS.escorts && step === 0) {
            // the shield is down and the flagship's fighters pour out
            inst.cymbal(at(context), 1, 2.6);
            inst.timpani(at(context), 36, 1);
            inst.stab(at(context), Cm.stab, 1, 1);
            inst.gong(at(context), 36, 0.7, 3);
          }
          // escort chaos: relentless 16th timpani/snare, siren-like brass arpeggios, tremolo strings
          if (step % 2 === 0) inst.timpani(at(context), context.chord.bass + 12, step % 4 === 0 ? 0.9 : 0.55);
          inst.snare(at(context), 0.45 + (step % 4 === 0 ? 0.2 : 0));
          sixteenthStrings(context, 0.6, 1);
          if (step % 2 === 0) {
            const tones = context.chord.stab;
            inst.brass(at(context), tones[(step / 2) % tones.length] + 12, 0.7, STEP * 1.7, 1);
          }
          if (step % 4 === 0) inst.stab(at(context), context.chord.stab, 0.62, 0.9);
          if (bar === BARS.escorts) melody(context, 1, 1, true);
          pad(context, 0.75);
          if (step === 0) inst.choir(at(context), context.chord.pad, barSeconds * 1.02, 0.55);
          if (bar === BARS.trench - 1 && step === 8) {
            // the rail dives toward the trench
            inst.riser(at(context), barSeconds * 1.5, 0.9);
          }
        }),
      ],
    },
    {
      name: 'trench',
      fromBar: BARS.trench,
      toBar: BARS.victory,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          const into = bar - BARS.trench; // 0, 1, 2
          if (bar === BARS.trench && step === 0) {
            inst.sub(at(context), 24, 0.8, barSeconds * 2);
            inst.gong(at(context), 36, 0.5, 2.6);
            inst.stab(at(context), [Cm.bass + 12, Cm.bass + 19], 0.7, 0.5);
          }
          // stripped and tense: sub pulse, a timpani roll that climbs for three bars, strings rising by minor thirds
          if (step % 4 === 0) inst.sub(at(context), context.chord.bass, 0.7, STEP * 3);
          const rollVelocity = 0.2 + (into * 16 + step) * 0.016;
          if (into > 0 || step >= 4) inst.timpani(at(context), 36 + (into === 2 ? 7 : 0), Math.min(0.95, rollVelocity));
          if (step === 0) {
            const climb = 67 + into * 3;
            inst.strings(at(context), [climb, climb + 4, climb + 7], 0.62, barSeconds * 1.02, 0.4);
            inst.choir(at(context), context.chord.pad, barSeconds, 0.6);
          }
          if (step % 2 === 0) sixteenthStrings(context, 0.4 + into * 0.15, 0.9);
          if (into === 1 && step === 0) inst.riser(at(context), barSeconds * 1.98, 1);
          if (into === 2) {
            snareRoll(context, 0.25, 1);
            if (step % 4 === 0) inst.stab(at(context), context.chord.stab, 0.55 + step * 0.02, 0.8);
            // one sixteenth of silence before the downbeat
            if (step === 15) inst.tick(at(context), 0.0);
          }
        }),
      ],
    },
    {
      name: 'victory',
      fromBar: BARS.victory,
      toBar: BARS.end,
      tracks: [
        fn((context) => {
          const { bar, step } = context;
          if (bar === 29 && step === 0) {
            // the victory downbeat: tutti, gong, crash, choir
            inst.cymbal(at(context), 1.2, 4.2);
            inst.gong(at(context), 36, 1, 5.5);
            inst.timpani(at(context), 24 + 12, 1);
            inst.stab(at(context), [...C.stab, C.stab[0] + 12], 1, 1);
            inst.strings(at(context), [55, 60, 64, 67, 72], 0.85, barSeconds * 3.2, 0.25);
            inst.choir(at(context), [60, 64, 67, 72], barSeconds * 3, 0.9);
            inst.sub(at(context), 24, 0.9, barSeconds * 1.6);
            for (let i = 0; i < 6; i += 1) inst.harp(at(context) + i * STEP * 0.5, C.lead[i] - 12, 0.5, 2.5);
          }
          if (bar < 31) {
            // triumphant march: timpani in fours, brass stabs on the beat, high strings shimmering
            timpaniPattern(context, 'X...x...X...x.x.', 0.95, context.chord.bass + 12);
            if (step % 4 === 0) inst.stab(at(context), context.chord.stab, step === 0 ? 0.66 : 0.48, 0.9);
            sixteenthStrings(context, 0.42, 0.95);
            if (step === 4 || step === 12) inst.snare(at(context), 0.55);
            if (step % 4 === 2) inst.tick(at(context), 0.6);
            if (step === 0 && bar === 30) {
              inst.cymbal(at(context), 0.8, 2.2);
              inst.strings(at(context), Bb.pad, 0.6, barSeconds * 1.05, 0.3);
            }
          } else {
            // the last bar: one held chord ringing out over a rolling timpani
            if (step === 0) {
              inst.cymbal(at(context), 1, 5);
              inst.gong(at(context), 36, 0.9, 6);
              inst.timpani(at(context), 36, 1);
              inst.stab(at(context), [...C.stab, C.stab[0] + 12], 0.9, 1);
              inst.choir(at(context), [60, 64, 67, 72], barSeconds * 1.1, 0.8);
              inst.strings(at(context), [55, 60, 64, 67, 72, 76], 0.8, barSeconds * 1.1, 0.2);
            }
            if (step >= 4 && step % 2 === 0) inst.timpani(at(context), 36, 0.6 - (step - 4) * 0.035);
          }
          melody(context, 1, 1, true);
        }),
      ],
    },
  ];

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: runSections,
  });

  // The attract screen: a hangar bay at rest. A soft pad, a distant heartbeat, a lone harp.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'hangar',
        fromBar: 0,
        tracks: [
          fn((context) => {
            const { bar, step, chord: current } = context;
            if (step === 0 && bar % 2 === 0) inst.strings(at(context), current.pad, 0.26, barSeconds * 2.1, 1.4);
            if (step === 0 && bar % 2 === 0) inst.timpani(at(context), current.bass + 12, 0.14);
            if (step === 8 && bar % 2 === 0) inst.timpani(at(context), current.bass + 12, 0.09);
            if (step % 6 === 4) inst.harp(at(context), current.pad[(bar + step) % current.pad.length] + 12, 0.24, 1.8);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'run') {
      orchestraLevel = energyAt(position / STEPS);
      runArrangement.schedule(position, time);
    }
    else {
      orchestraLevel = 1;
      ambientArrangement.schedule(position, time);
    }
  }

  // ---- the player's instrument -----------------------------------------------------------------

  function action() {
    const context = runtime.context();
    if (!context) return null;
    const time = score.quantizePlayerAction(context.currentTime + 0.005);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    return { context, time, position, chord: score.chordAt(position), lead };
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'gen' || kind === 'core' || kind === 'heart') bossKinds.set(enemyId, kind);
    if (kind === 'bolt') {
      const a = action();
      if (a) inst.tick(a.time, 0.9);
    }
  });
  bus.on('lock', ({ lockCount }) => {
    const a = action();
    if (!a) return;
    // Locks climb the live chord: one pluck per lock, brighter each time.
    const midi = a.lead[Math.min(lockCount - 1, 5)];
    inst.glass(a.time, midi, 0.55 + lockCount * 0.09, 0.26 + lockCount * 0.03, 1500 + lockCount * 500);
    if (lockCount === 6) inst.glass(a.time + STEP, a.lead[7], 1, 0.6, 5200);
  });
  bus.on('fire', ({ volleySize, indexInVolley }) => {
    const a = action();
    if (!a) return;
    if (indexInVolley === 0 || indexInVolley === undefined) {
      // The release: a brass stab on the chord, weighted by volley size, over a rising zap.
      inst.stab(a.time, a.chord.stab, 0.32 + volleySize * 0.08, 0.6 + volleySize * 0.06);
      inst.zap(a.time, a.lead[0] - 12, 0.7, 0.5);
      if (volleySize >= 4) inst.timpani(a.time, a.chord.bass + 12, 0.5 + volleySize * 0.08);
      if (volleySize >= 6) inst.cymbal(a.time, 0.75, 1.3);
    } else {
      inst.zap(a.time, a.lead[Math.min(indexInVolley, 6)] - 12, 0.4, 0.55);
    }
  });
  bus.on('hit', ({ enemyId, lethal, hitStageIndex }) => {
    const a = action();
    if (!a) return;
    if (bossKinds.has(enemyId)) {
      // Boss damage climbs a ladder: every hit is a rung higher, brighter, and heavier than the last.
      bossHits += 1;
      const rung = Math.min(7, bossHits);
      inst.glass(a.time, a.lead[rung], 0.7 + rung * 0.04, 0.42, 2600 + rung * 450);
      inst.brass(a.time, a.chord.stab[rung % 3] + 12 * (1 + Math.floor(rung / 3)), 0.42 + rung * 0.05, STEP * 3.2, 0.6 + rung * 0.05);
      inst.timpani(a.time, a.chord.bass + 12, 0.5 + rung * 0.06);
      return;
    }
    if (lethal) return;
    inst.glass(a.time, a.lead[2 + hitStageIndex] - 12, 0.7, 0.3, 2200);
    inst.timpani(a.time, a.chord.bass + 12, 0.42);
  });
  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime + 0.005);
    const kind = bossKinds.get(enemyId);
    bossKinds.delete(enemyId);
    inst.bell(kill.time, kill.midi, kind ? 1 : 0.85, kind ? 1.4 : 0.8);
    inst.bell(kill.time, kill.midi + 12, kind ? 0.5 : 0.22, kind ? 1 : 0.5);
    if (kind === 'gen') {
      inst.stab(kill.time, runChord(kill.time).stab, 0.9, 1);
      inst.cymbal(kill.time, 0.8, 1.6);
      inst.timpani(kill.time, 36 + 12, 0.9);
    } else if (kind === 'core') {
      inst.stab(kill.time, runChord(kill.time).stab, 1, 1);
      inst.gong(kill.time, 40, 0.7, 3);
      inst.timpani(kill.time, 36, 1);
    } else if (kind === 'heart') {
      // The killing blow: duck the orchestra for a breath, then land the finale on the next downbeat.
      const mix = runtime.mix();
      mix?.duckAt(kill.time, 0.18, 1.1);
      inst.gong(kill.time, 36, 1, 6);
      inst.sub(kill.time, 24, 1, 2.4);
      inst.cymbal(kill.time, 1, 4);
      const landing = nextBarTime(kill.time + 0.35);
      inst.stab(landing, [...C.stab, C.stab[0] + 12], 1, 1);
      inst.timpani(landing, 36, 1);
      inst.cymbal(landing, 1, 4.5);
      for (let i = 0; i < 8; i += 1) inst.bell(landing + i * STEP, C.lead[i], 0.8, 1.6);
    }
  });
  bus.on('volley', ({ size, kills }) => {
    // A clean six-kill volley earns a rising bell run up the chord and a crash: the soloist's flourish.
    if (size < 6 || kills < 6) return;
    const a = action();
    if (!a) return;
    a.lead.slice(0, 8).forEach((midi, index) => inst.bell(a.time + index * STEP, midi, 0.55 + index * 0.05, 1 + index * 0.1));
    inst.cymbal(a.time, 0.7, 1.4);
    inst.stab(a.time + STEP * 2, a.chord.stab, 0.6, 0.9);
  });
  bus.on('miss', () => {
    if (finale) return; // the last fighters falling away with the flagship are not misses to be mourned
    const a = action();
    if (a) inst.glass(a.time, a.lead[0] - 24, 0.25, 0.4, 900);
  });
  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    inst.lowBrass(context.currentTime, 36, 0.9, 0.22);
    inst.lowBrass(context.currentTime, 37, 0.8, 0.22);
    inst.tick(context.currentTime, 1);
    inst.zap(context.currentTime + 0.03, 52, 0.6, 0.4);
  });
  bus.on('playerhit', () => {
    const context = runtime.context();
    if (!context) return;
    const mix = runtime.mix();
    mix?.duckAt(context.currentTime, 0.4, 0.5);
    inst.timpani(context.currentTime, 33, 1);
    inst.sub(context.currentTime, 26, 1, 0.9);
    inst.lowBrass(context.currentTime, 34, 1, 0.5);
    inst.tick(context.currentTime, 1);
  });
  bus.on('stage', ({ stageIndex }) => {
    const a = action();
    if (!a) return;
    inst.stab(a.time, a.chord.stab, 1, 1);
    inst.cymbal(a.time, 0.9, 1.8);
    inst.timpani(a.time, a.chord.bass + 12 - stageIndex, 1);
    inst.gong(a.time, 40, 0.5, 2.4);
  });
  bus.on('bossphase', ({ phase }) => {
    const context = runtime.context();
    if (!context) return;
    if (phase === 'destroyed') finale = true;
    if (phase === 'summoned') {
      // Shield shatter: a rising rip and a crash, quantized to the next eighth.
      const time = nextStepTime(context.currentTime + 0.02, 2);
      inst.riser(time - STEP * 2, STEP * 2, 0.7);
      inst.cymbal(time, 1, 2.4);
      inst.stab(time, Cm.stab, 1, 1);
    }
  });

  /** The next arrangement grid line at or after `time`, `grid` steps apart, counted from the run's own bar 0. */
  function nextStepTime(time: number, grid: number) {
    const position = score.arrangementPositionAt(time);
    const next = Math.ceil(position / grid - 1e-6) * grid;
    return score.epoch + (score.arrangementStart + next) * STEP;
  }
  const nextBarTime = (time: number) => nextStepTime(time, STEPS);

  function runChord(time: number) {
    return score.chordAt(score.arrangementPositionAt(time));
  }

  return runtime;
}
