import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { voice } from '../../engine/audio-voices';
import { midiToFreq } from '../../engine/music';
import { createScore, type SectionMix } from '../../engine/score';
import { createVespersVoices, RANKS } from './audio-voices';
import {
  VESPERS_BARS,
  VESPERS_BPM,
  VESPERS_RUN_DURATION,
  VESPERS_SCORE_SECTIONS,
  VESPERS_STEPS_PER_BAR,
  VESPERS_TIME,
} from './timing';

// The building's own organ. A chorale prelude in D minor: one held pedal
// note, then voices entering one at a time above it in real counterpoint,
// choir and bell weight for the swell, silence for the quiet, and a trumpet
// rank held back all night so the ending has somewhere to arrive. There is no
// percussion; the pulse is the counterpoint moving. The player's locks,
// shots, and kills are pipes in the same instrument, quantized to the
// transport and pitched from the bar's harmony. When the eye dies the minor
// turns major and every rank opens.

const STEP = VESPERS_TIME.stepSeconds;
const STEPS_PER_BAR = VESPERS_STEPS_PER_BAR;
const LANE_STEPS = 32;

type Chord = {
  name: string;
  pedal: number;
  tones: number[];
  lead: number[];
  leadMajor: number[];
};

const chord = (name: string, pedal: number, tones: number[], lead: number[], leadMajor: number[]): Chord => ({ name, pedal, tones, lead, leadMajor });
const D_MAJOR_LEAD = [62, 66, 69, 71, 74, 78, 81, 83];
const DM = chord('Dm', 38, [50, 53, 57, 62], [62, 65, 69, 72, 74, 77, 81, 84], D_MAJOR_LEAD);
const GM = chord('Gm', 43, [50, 55, 58, 62], [62, 67, 70, 74, 77, 79, 82, 86], [62, 67, 71, 74, 78, 79, 83, 86]);
const A7 = chord('A', 45, [49, 52, 55, 57], [61, 64, 67, 69, 73, 76, 79, 81], [61, 64, 69, 73, 76, 78, 81, 85]);
const BB = chord('Bb', 46, [50, 53, 58, 62], [62, 65, 69, 70, 74, 77, 81, 82], D_MAJOR_LEAD);
const FM = chord('F', 41, [48, 53, 57, 60], [60, 64, 65, 69, 72, 76, 77, 81], D_MAJOR_LEAD);

// One chord per bar for the whole eighteen-bar chorale. The last bar sits on
// the dominant: if the eye is still alive the run ends unresolved.
const BAR_CHORDS: Chord[] = [DM, DM, DM, GM, DM, A7, FM, GM, DM, A7, DM, DM, DM, BB, GM, A7, DM, A7];

// The coda, D major, cycling once the eye is dead.
const CODA_CHORDS = [
  chord('D', 38, [50, 54, 57, 62], D_MAJOR_LEAD, D_MAJOR_LEAD),
  chord('G', 43, [50, 55, 59, 62], [62, 67, 71, 74, 78, 79, 83, 86], [62, 67, 71, 74, 78, 79, 83, 86]),
  chord('A', 45, [49, 52, 57, 61], [61, 64, 69, 73, 76, 78, 81, 85], [61, 64, 69, 73, 76, 78, 81, 85]),
  chord('D', 38, [50, 54, 57, 62], D_MAJOR_LEAD, D_MAJOR_LEAD),
];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Kill-melody lanes: 32 steps (two bars) of degrees into the bar's lead set.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Opening: a gentle stepwise arch, plainchant-like.
  0: [0, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 3, 4, 5, 6, 5, 4, 2],
  // Swell: broad pealing leaps.
  1: [4, 6, 7, 5, 4, 6, 7, 5, 3, 5, 6, 4, 3, 5, 6, 4, 2, 4, 5, 7, 2, 4, 5, 7, 6, 7, 6, 5, 4, 3, 2, 1],
  // Quiet: high and falling, every kill a single far note.
  2: [7, 6, 5, 4, 7, 6, 5, 4, 5, 4, 3, 2, 5, 4, 3, 2, 6, 5, 4, 3, 6, 5, 4, 3, 4, 3, 2, 1, 4, 3, 2, 1],
  // The rose: descending peals answered by a climb back to the top.
  3: [7, 5, 3, 1, 7, 5, 3, 1, 6, 4, 2, 0, 6, 4, 2, 0, 7, 6, 5, 4, 3, 2, 1, 0, 4, 5, 6, 7, 4, 5, 6, 7],
  // Coda: rising major arpeggios.
  4: [0, 2, 4, 6, 7, 6, 4, 2, 1, 3, 5, 7, 5, 3, 1, 0, 0, 2, 4, 7, 4, 2, 0, 2, 4, 6, 7, 6, 7, 6, 4, 2],
};

// ---- the written voices ------------------------------------------------------------
// [step, midi, length in steps]. Keyed by absolute bar.
type NoteList = Array<[number, number, number]>;
const eighths = (midis: number[]): NoteList => midis.map((midi, index) => [index * 2, midi, 2]);

const TENOR: Record<number, NoteList> = {
  2: [[0, 50, 8], [8, 57, 8]],
  3: [[0, 58, 4], [4, 57, 4], [8, 55, 8]],
  4: [[0, 53, 4], [4, 55, 4], [8, 57, 8]],
  5: [[0, 52, 8], [8, 49, 4], [12, 50, 4]],
  6: [[0, 53, 8], [8, 55, 8]],
  7: [[0, 57, 4], [4, 58, 4], [8, 60, 8]],
  8: [[0, 62, 8], [8, 60, 4], [12, 58, 4]],
  9: [[0, 57, 16]],
  12: [[0, 50, 4], [4, 53, 4], [8, 52, 4], [12, 50, 4]],
  13: [[0, 58, 8], [8, 57, 4], [12, 55, 4]],
  14: [[0, 55, 4], [4, 58, 4], [8, 62, 8]],
  15: [[0, 61, 8], [8, 57, 8]],
  16: [[0, 62, 4], [4, 60, 4], [8, 57, 4], [12, 53, 4]],
  17: [[0, 52, 8], [8, 49, 8]],
};

const ALTO: Record<number, NoteList> = {
  4: eighths([62, 65, 69, 67, 65, 62, 65, 69]),
  5: eighths([64, 67, 69, 67, 64, 61, 64, 69]),
  6: eighths([65, 69, 72, 69, 65, 64, 65, 69]),
  7: eighths([62, 65, 67, 70, 67, 65, 62, 67]),
  8: eighths([74, 72, 69, 65, 62, 65, 69, 72]),
  9: eighths([73, 69, 67, 64, 61, 64, 67, 69]),
  // The quiet: one voice, three notes, then two.
  10: [[0, 69, 6], [8, 65, 4], [12, 62, 4]],
  11: [[0, 64, 6], [8, 62, 8]],
  12: eighths([62, 65, 69, 65, 62, 60, 62, 65]),
  13: eighths([70, 74, 77, 74, 70, 69, 70, 74]),
  14: eighths([67, 70, 74, 70, 67, 65, 67, 70]),
  15: eighths([69, 73, 76, 73, 69, 67, 69, 73]),
  16: eighths([74, 72, 69, 65, 62, 65, 69, 72]),
  17: eighths([76, 73, 69, 67, 64, 61, 64, 67]),
};

const SOPRANO: Record<number, NoteList> = {
  6: [[0, 77, 8], [8, 76, 8]],
  7: [[0, 74, 8], [8, 70, 8]],
  8: [[0, 81, 8], [8, 79, 4], [12, 77, 4]],
  9: [[0, 76, 16]],
  12: [[0, 74, 16]],
  13: [[0, 77, 8], [8, 74, 8]],
  14: [[0, 79, 8], [8, 74, 8]],
  15: [[0, 76, 8], [8, 73, 8]],
  16: [[0, 81, 4], [4, 77, 4], [8, 74, 8]],
  17: [[0, 76, 8], [8, 73, 8]],
};

// The pedal walks in quarters under the rose.
const PEDAL_WALK: Record<number, number[]> = {
  12: [38, 45, 41, 43],
  13: [46, 41, 46, 45],
  14: [43, 38, 46, 43],
  15: [45, 40, 45, 43],
  16: [38, 45, 41, 38],
  17: [45, 45, 40, 33],
};

// Coda material, keyed by bar within the four-bar cycle.
const CODA_TENOR: NoteList[] = [
  [[0, 62, 8], [8, 66, 8]],
  [[0, 67, 8], [8, 71, 4], [12, 69, 4]],
  [[0, 69, 8], [8, 73, 8]],
  [[0, 74, 16]],
];
const CODA_TRUMPET: NoteList[] = [
  [[0, 74, 4], [4, 78, 4], [8, 81, 8]],
  [[0, 79, 4], [4, 83, 4], [8, 81, 8]],
  [[0, 76, 8], [8, 73, 8]],
  [[0, 74, 16]],
];
const CODA_ALTO: NoteList[] = [
  eighths([62, 66, 69, 74, 69, 66, 62, 66]),
  eighths([67, 71, 74, 79, 74, 71, 67, 71]),
  eighths([69, 73, 76, 81, 76, 73, 69, 73]),
  eighths([74, 78, 81, 86, 81, 78, 74, 78]),
];
const CODA_SOPRANO: NoteList[] = [
  [[0, 81, 16]],
  [[0, 83, 8], [8, 81, 8]],
  [[0, 85, 8], [8, 81, 8]],
  [[0, 86, 16]],
];

// Per-section player timbres. Locks are always the 4' flute; kills change
// rank with the arrangement, crossfading where the music does not turn over.
const KILL_VOICES: Record<SectionIndex, { rank: keyof typeof RANKS; decay: number; gain: number; upper: number }> = {
  0: { rank: 'flute', decay: 0.5, gain: 1.0, upper: 0 },
  1: { rank: 'principal', decay: 0.45, gain: 1.0, upper: 0.35 },
  2: { rank: 'flute', decay: 0.85, gain: 0.8, upper: 0 },
  3: { rank: 'principal', decay: 0.42, gain: 1.05, upper: 0.6 },
  4: { rank: 'trumpet', decay: 0.5, gain: 0.9, upper: 0.5 },
};

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-xc1a',
  bpm: VESPERS_BPM,
  stepSeconds: STEP,
  defaultSeconds: VESPERS_RUN_DURATION,
  createAudio: createVespersAudio,
});

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let eyeId = -1;
  let eyeMaxHp = 0;
  // Set when the eye dies: the key turns major, and from `codaFromBar` the
  // arrangement plays the coda instead of the written chorale.
  let resolved = false;
  let codaFromBar = Infinity;
  let codaStartBar = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: VESPERS_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: BAR_CHORDS,
    barsPerChord: 1,
    sections: VESPERS_SCORE_SECTIONS,
    killLanes: KILL_LANES,
    leadSet: (current) => (resolved ? current.leadMajor : current.lead),
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP,
    volumeScale: 0.85,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -16, ratio: 4, attack: 0.008, release: 0.3 },
      delay: { time: STEP * 2, feedback: 0.22, dampHz: 2400 },
      // The room. A long tail is most of what makes this an organ in a
      // cathedral instead of sines in a browser.
      reverb: { seconds: 4.6, decay: 2.3, level: 0.45 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      eyeId = -1;
      eyeMaxHp = 0;
      resolved = false;
      codaFromBar = Infinity;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (!context) return;
      // The last chord rings over the summary: major if the rose ignited,
      // the open dominant if it did not.
      const time = context.currentTime + 0.05;
      const tones = resolved ? [38, 50, 57, 62, 66, 74] : [45, 49, 52, 57, 61];
      for (const midi of tones) voices.principal(time, midi, 5.5, 0.7);
      voices.pedal(time, tones[0], 6, 0.9);
      if (resolved) voices.bell(time, 74, 0.6, 4);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createVespersVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { pedal, principal, flute, mixture, trumpet, choir, bell, breath, noiseHit } = voices;

  // ---- arrangement -------------------------------------------------------------------

  const legato = (steps: number) => steps * STEP * 0.97;

  function melody(notes: Record<number, NoteList>, play: (time: number, midi: number, duration: number) => void): ArrangementTrack<Chord> {
    return fn((context) => {
      if (resolved && context.bar >= codaFromBar) return;
      const list = notes[context.bar];
      if (!list) return;
      for (const [step, midi, length] of list) if (step === context.step) play(context.time, midi, legato(length));
    });
  }

  function pedalTrack(sub: boolean): ArrangementTrack<Chord> {
    return fn((context) => {
      if (resolved && context.bar >= codaFromBar) return;
      const walk = PEDAL_WALK[context.bar];
      if (walk) {
        if (context.step % 4 !== 0) return;
        const midi = walk[context.step / 4];
        pedal(context.time, midi, legato(4), 0.95);
        if (sub) pedal(context.time, midi - 12, legato(4), 0.5);
        return;
      }
      if (context.step !== 0) return;
      pedal(context.time, context.chord.pedal, legato(STEPS_PER_BAR), 1);
      if (sub) pedal(context.time, context.chord.pedal - 12, legato(STEPS_PER_BAR), 0.55);
    });
  }

  const tenorTrack = melody(TENOR, (time, midi, duration) => principal(time, midi, duration, 0.95));
  const altoTrack = melody(ALTO, (time, midi, duration) => flute(time, midi, duration, 0.85));
  const sopranoTrack = melody(SOPRANO, (time, midi, duration) => mixture(time, midi, duration, 0.8));

  const choirTrack = fn<Chord>((context) => {
    if (resolved && context.bar >= codaFromBar) return;
    if (context.step !== 0) return;
    const tension = context.chord === A7 && context.bar >= VESPERS_BARS.boss;
    const tones = tension ? [...context.chord.tones.slice(1), context.chord.pedal + 13] : context.chord.tones;
    choir(context.time, tones.map((midi) => midi + 12), legato(STEPS_PER_BAR), context.bar >= VESPERS_BARS.boss ? 0.75 : 1);
  });

  const swellBells = fn<Chord>((context) => {
    if (context.bar === VESPERS_BARS.swell && context.step === 0) bell(context.time, 74, 1, 3.2);
    if (context.bar === VESPERS_BARS.swell && context.step === 8) bell(context.time, 69, 0.7, 2.6);
    if (context.bar === VESPERS_BARS.swell + 1 && context.step === 0) bell(context.time, 73, 0.9, 3);
    if (context.bar === VESPERS_BARS.swell + 1 && context.step === 8) bell(context.time, 69, 0.6, 2.4);
  });

  // A bell tolls under the rose on every bar line; the reveal bar rings the
  // big one.
  const tollTrack = fn<Chord>((context) => {
    if (resolved && context.bar >= codaFromBar) return;
    if (context.step !== 0) return;
    if (context.bar === VESPERS_BARS.boss) bell(context.time, 50, 1.25, 4.5);
    else bell(context.time, context.chord.pedal + 24, 0.55, 2.8);
  });

  const breathTrack = fn<Chord>((context) => {
    if (context.step !== 0 || context.barInSection !== 0) return;
    breath(context.time, STEP * STEPS_PER_BAR * 2, 1);
  });

  // The coda: every rank open, in D major, the trumpet finally speaking.
  const codaTrack = fn<Chord>((context) => {
    if (!resolved || context.bar < codaFromBar) return;
    const index = (context.bar - codaStartBar) % CODA_CHORDS.length;
    const current = CODA_CHORDS[index];
    const at = (list: NoteList, play: (time: number, midi: number, duration: number) => void) => {
      for (const [step, midi, length] of list) if (step === context.step) play(context.time, midi, legato(length));
    };
    if (context.step === 0) {
      pedal(context.time, current.pedal, legato(STEPS_PER_BAR), 1);
      pedal(context.time, current.pedal - 12, legato(STEPS_PER_BAR), 0.6);
      choir(context.time, current.tones.map((midi) => midi + 12), legato(STEPS_PER_BAR), 0.9);
      bell(context.time, current.pedal + 36, 0.7, 3);
    }
    if (context.step === 8) bell(context.time, current.pedal + 31, 0.45, 2.4);
    at(CODA_TENOR[index], (time, midi, duration) => principal(time, midi, duration, 1));
    at(CODA_ALTO[index], (time, midi, duration) => flute(time, midi, duration, 0.9));
    at(CODA_SOPRANO[index], (time, midi, duration) => mixture(time, midi, duration, 0.85));
    at(CODA_TRUMPET[index], (time, midi, duration) => trumpet(time, midi, duration, 0.95));
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      { name: 'pedal', fromBar: VESPERS_BARS.run, toBar: VESPERS_BARS.tenor, tracks: [pedalTrack(false), breathTrack] },
      { name: 'tenor', fromBar: VESPERS_BARS.tenor, toBar: VESPERS_BARS.alto, tracks: [pedalTrack(false), tenorTrack] },
      { name: 'alto', fromBar: VESPERS_BARS.alto, toBar: VESPERS_BARS.soprano, tracks: [pedalTrack(false), tenorTrack, altoTrack] },
      { name: 'soprano', fromBar: VESPERS_BARS.soprano, toBar: VESPERS_BARS.swell, tracks: [pedalTrack(false), tenorTrack, altoTrack, sopranoTrack] },
      { name: 'swell', fromBar: VESPERS_BARS.swell, toBar: VESPERS_BARS.quiet, tracks: [pedalTrack(true), tenorTrack, altoTrack, sopranoTrack, choirTrack, swellBells] },
      { name: 'quiet', fromBar: VESPERS_BARS.quiet, toBar: VESPERS_BARS.boss, tracks: [pedalTrack(false), altoTrack, breathTrack] },
      { name: 'rose', fromBar: VESPERS_BARS.boss, tracks: [pedalTrack(true), tenorTrack, altoTrack, sopranoTrack, choirTrack, tollTrack, codaTrack] },
    ],
  });

  // Attract screen and end screen: the pedal breathing under a far fragment
  // of the tune (major once the rose has been lit this session).
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: (position) => (resolved ? CODA_CHORDS[Math.floor(position / STEPS_PER_BAR / 2) % CODA_CHORDS.length] : (Math.floor(position / STEPS_PER_BAR / 2) % 2 === 0 ? DM : GM)),
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        fn((context) => {
          if (context.step === 0 && context.bar % 2 === 0) pedal(context.time, context.chord.pedal, legato(STEPS_PER_BAR * 2), 0.8);
          if (context.step === 0 && context.bar % 8 === 0) breath(context.time, STEP * STEPS_PER_BAR * 3, 0.7);
          const phraseBar = context.bar % 8;
          const list = resolved ? CODA_TENOR[phraseBar % 4] : TENOR[phraseBar + 2];
          if (phraseBar < 4 && list) {
            for (const [step, midi, length] of list) if (step === context.step) (resolved ? principal : flute)(context.time, midi + 12, legato(length), 0.6);
          }
          if (context.step === 0 && context.bar % 8 === 6) bell(context.time, resolved ? 74 : 62, 0.35, 3);
        }),
      ],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's pipes ------------------------------------------------------------

  const fireVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: ({ vel }) => 0.085 * vel }, { type: 'sine', octave: -1, gain: ({ vel }) => 0.12 * vel }],
    duration: 0.13,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 1.2,
      frequencyAutomation: (time) => [
        { type: 'set', value: 1500, time },
        { type: 'exponentialRamp', value: 260, time: time + 0.11 },
      ],
    },
    envelope: { attack: 0.004, decay: 0.13 },
  });

  const clusterVoice = voice<{ vel: number; cutoff: number; duration: number }>({
    oscillators: [{ type: 'sawtooth', gain: ({ vel }) => 0.05 * vel }],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 0.8 },
    envelope: { attack: 0.01, decay: ({ duration }) => duration },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: ({ vel }) => 0.09 * vel }],
    duration: 0.26,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 3,
      frequencyAutomation: (time) => [
        { type: 'set', value: 900, time },
        { type: 'exponentialRamp', value: 240, time: time + 0.22 },
      ],
    },
    envelope: { attack: 0.005, decay: 0.26 },
  });

  const thudVoice = voice<{ vel: number; to: number; duration: number }>({
    oscillators: [{ type: 'sine', gain: ({ vel }) => 0.4 * vel }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    frequencyAutomation: (time, _frequency, { to, duration }) => [{ type: 'exponentialRamp', value: to, time: time + duration * 0.7 }],
    envelope: { attack: 0.003, decay: ({ duration }) => duration },
  });

  const sighVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: ({ vel }) => 0.05 * vel }, { type: 'triangle', gain: ({ vel }) => 0.02 * vel, octave: 1 }],
    duration: 0.55,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 2200 },
    envelope: { attack: 0.02, decay: 0.55 },
  });

  const positionAt = (time: number) => score.arrangementPositionAt(time);

  function playKillVoice(section: SectionIndex, time: number, midi: number, vel: number, weight: number) {
    if (weight < 0.02) return;
    const spec = KILL_VOICES[section];
    if (spec.rank === 'trumpet') {
      voices.playerTrumpet(time, midi, spec.decay, vel * weight * spec.gain);
      voices.playerPipe(time, midi, spec.decay, vel * weight * 0.55, RANKS.principal, 0.5, 0.2);
    } else {
      voices.playerPipe(time, midi, spec.decay, vel * weight * spec.gain, RANKS[spec.rank], 0.55, 0.22);
    }
    if (spec.upper > 0) voices.playerPipe(time, midi + 12, spec.decay * 0.7, vel * weight * spec.upper, RANKS.mixture, 0.5, 0.2);
  }

  // Kills walk the hidden melody lane, one step per kill, so a chained volley
  // performs the tune. From the third kill of a chain a bell rings above it.
  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    if (!ctx) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const vel = Math.min(1.4, 1 + chain * 0.11);
    for (const [section, weight] of score.sectionLayers(sectionMix)) playKillVoice(section, time, midi, vel, weight);
    if (chain >= 2) voices.playerBell(time, midi + 12, 0.28 + Math.min(0.3, chain * 0.05), 1.6);
    const output = voices.sfxDestination();
    if (output) noiseHit(time, 0.02, 0.05, 'highpass', 6000, output);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === eyeId) {
      eyeFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  // Locks climb the bar's lead set on the 4' flute: six locks is a rising
  // scale in the current harmony.
  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(positionAt(time));
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))] + 12;
    voices.playerPipe(time, midi, 0.16, 0.5 + lockCount * 0.06, RANKS.flute, 0.35, 0.18);
  });

  // Fire is the key going down on the pedal: a low reed thump on the chord
  // root, so even the gun retunes with the harmony.
  let lastWordFireAt = -Infinity;
  bus.on('fire', ({ indexInVolley, volleyId, volleySize }) => {
    const output = voices.sfxDestination();
    if (!ctx || !output) return;
    // One thump per release, not per shot. Letter-screen releases carry no
    // volley id, so those are throttled by time instead.
    if (volleyId === undefined) {
      if (ctx.currentTime - lastWordFireAt < 0.6) return;
      lastWordFireAt = ctx.currentTime;
    } else if ((indexInVolley ?? 0) > 0) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const root = score.chordAt(positionAt(time)).pedal;
    fireVoice.play({ context: ctx, time, midi: root + 12, vel: 0.8 + Math.min(1, volleySize / 6) * 0.4, destination: output, sends: voices.roomSends(0.3) });
    noiseHit(time, 0.05, 0.03, 'bandpass', 1800, output);
    const mix = runtime.mix();
    if (volleySize >= 5 && mix) mix.duckAt(time, 0.72, 0.5);
  });

  // Chipping a censer or petal rings the mixture; chipping the eye is the
  // cluster that grows with every wound.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    if (enemyId === eyeId) {
      eyeMaxHp = Math.max(eyeMaxHp, hitPointsRemaining + 1);
      eyeChip(1 - hitPointsRemaining / eyeMaxHp);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const tones = score.chordAt(positionAt(time)).tones;
    tones.slice(1).forEach((midi, index) => {
      voices.playerPipe(time + index * STEP * 0.5, midi + 24, 0.14, 0.45, RANKS.mixture, 0.45, 0.2);
    });
  });

  // A clean volley of four or more: the choir answers on the next beat.
  bus.on('volley', ({ size, kills }) => {
    if (!ctx || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const current = score.chordAt(positionAt(time));
    const tones = resolved ? current.leadMajor.slice(0, 4) : current.tones.map((midi) => midi + 12);
    voices.playerChoir(time, tones, STEP * 8, size === 6 ? 1.1 : 0.8);
    voices.playerBell(time, current.pedal + 36, size === 6 ? 0.8 : 0.5, 3);
  });

  // A wrong note on the organ: a dry minor-second cluster and a thump.
  bus.on('reject', () => {
    const output = voices.sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const midi of [50, 51, 56]) rejectVoice.play({ context: ctx, time, midi, vel: 1, destination: output });
    thudVoice.play({ context: ctx, time, frequency: 110, to: 42, duration: 0.3, vel: 0.8, destination: output });
    noiseHit(time, 0.12, 0.08, 'bandpass', 700, output);
  });

  // A light going out: a quiet falling semitone.
  bus.on('miss', () => {
    const output = voices.sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const lead = score.leadSetAt(positionAt(time));
    const midi = lead[3];
    sighVoice.play({
      context: ctx,
      time,
      midi,
      vel: 1,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - 1), time: time + 0.4 }],
      destination: output,
      sends: voices.roomSends(0.5),
    });
  });

  // Hull hit: a cipher. Two pipes a semitone apart stuck on, beating, over a
  // low thud. The one deliberately ugly sound in the level.
  bus.on('playerhit', () => {
    const output = voices.sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const midi of [61, 62]) clusterVoice.play({ context: ctx, time, midi, vel: 1.2, cutoff: 1600, duration: 0.7, destination: output });
    thudVoice.play({ context: ctx, time, frequency: 90, to: 36, duration: 0.45, vel: 1, destination: output });
    noiseHit(time, 0.16, 0.12, 'bandpass', 800, output);
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind !== 'eye' || !ctx) return;
    eyeId = enemyId;
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    const output = voices.sfxDestination();
    if (!output) return;
    if (phase === 'summoned') {
      // The rose wakes: a 32' cluster under everything and a far high bell.
      const time = score.nextGridTime(ctx.currentTime);
      for (const midi of [26, 27]) clusterVoice.play({ context: ctx, time, midi, vel: 1.4, cutoff: 500, duration: STEP * 24, destination: output, sends: voices.roomSends(0.6) });
      voices.playerBell(time + STEP * 2, 86, 0.5, 4);
    } else if (phase === 'exposed') {
      // The eye opens: a diminished shimmer in the choir and a high bell.
      const time = score.nextGridTime(ctx.currentTime, 2);
      voices.playerChoir(time, [73, 76, 79, 82], STEP * 12, 1);
      voices.playerBell(time, 85, 0.7, 3);
    }
  });

  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== eyeId || !ctx) return;
    const output = voices.sfxDestination();
    if (!output) return;
    // Wounded: the eye sinks back into the glass on a pedal glissando.
    const time = score.nextGridTime(ctx.currentTime);
    thudVoice.play({ context: ctx, time, frequency: midiToFreq(45), to: midiToFreq(26), duration: 1.4, vel: 1.1, destination: output, sends: voices.roomSends(0.5) });
    voices.playerChoir(time, [61, 64, 67, 70], STEP * 8, 0.9);
    noiseHit(time, 0.1, 0.5, 'lowpass', 900, output);
  });

  // Each wound on the eye stacks one more pipe onto the cluster, brighter
  // and higher, so the fight audibly ratchets toward the finale.
  function eyeChip(intensity: number) {
    const output = voices.sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = positionAt(time);
    const current = score.chordAt(position);
    const lead = score.leadSetAt(position);
    const count = 2 + Math.floor(intensity * 5);
    for (let index = 0; index < count; index += 1) {
      clusterVoice.play({
        context: ctx,
        time,
        midi: lead[index % lead.length],
        vel: 0.7 + intensity * 0.5,
        cutoff: 1200 + intensity * 3600,
        duration: 0.3 + intensity * 0.2,
        destination: output,
        sends: voices.roomSends(0.4, 0.25),
      });
    }
    thudVoice.play({ context: ctx, time, midi: current.pedal - 12, to: midiToFreq(current.pedal - 19), duration: 0.35, vel: 0.9 + intensity * 0.3, destination: output });
    voices.playerBell(time, lead[Math.min(lead.length - 1, Math.floor(intensity * lead.length))] + 12, 0.45 + intensity * 0.45, 1.6);
    noiseHit(time, 0.08 + intensity * 0.1, 0.06, 'bandpass', 1600, output);
  }

  // The killing blow. The music bows out for a breath, then every rank opens
  // in D major: pedal, principal, mixture, choir, a bell peal falling from
  // the top, and the trumpet finally speaking. From the next bar line the
  // coda takes over.
  function eyeFinale() {
    const output = voices.sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    resolved = true;
    score.overrideSection(4);
    const position = positionAt(time);
    codaStartBar = score.barAt(position) + 1;
    codaFromBar = codaStartBar;

    mix.duckAt(time - 0.02, 0.15, 2.2);
    thudVoice.play({ context: ctx, time, frequency: 180, to: 36, duration: 1.2, vel: 1.2, destination: output });

    const tutti = STEP * 16 - 0.1;
    voices.playerPipe(time, 26, tutti, 1.1, RANKS.pedal, 0.4);
    voices.playerPipe(time, 38, tutti, 1.0, RANKS.pedal, 0.4);
    for (const midi of [50, 54, 57, 62, 66, 69]) voices.playerPipe(time, midi, tutti, 0.9, RANKS.principal, 0.6);
    for (const midi of [74, 78, 81, 86]) voices.playerPipe(time, midi, tutti, 0.7, RANKS.mixture, 0.6);
    voices.playerChoir(time, [62, 66, 69, 74], tutti, 1.2);
    [74, 78, 81, 86].forEach((midi, index) => {
      voices.playerTrumpet(time + index * STEP * 2, midi, index === 3 ? STEP * 9 : STEP * 2.2, 1.1);
    });
    [98, 93, 90, 86, 81, 78, 74, 69, 62].forEach((midi, index) => {
      voices.playerBell(time + index * STEP * 1.5, midi, 0.85 - index * 0.05, 3.4);
    });
    noiseHit(time, 0.2, 0.9, 'highpass', 5000, output);
    noiseHit(time + 0.4, 0.12, 1.4, 'highpass', 7000, output);
  }

  return runtime;
}
