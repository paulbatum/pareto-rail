import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createBroadsideVoices, type SoloVoice } from './audio-voices';
import { BARS, BROADSIDE_BPM, BROADSIDE_DURATION, BROADSIDE_STEPS_PER_BAR, BROADSIDE_TIME } from './timing';

// Space opera. Full orchestra at 112 BPM in D minor: timpani and snare under
// horns and strings, trumpets on top, swelling with each push of the run and
// dropping to near silence in the eye of the battle. The player is the
// soloist: locks are pizzicato, releases are brass stabs, and kills play a
// solo trumpet reading a hidden lane over the live harmony. When the flagship
// dies the score turns to D major for the victory theme.

const STEP = BROADSIDE_TIME.stepSeconds;
const STEPS = BROADSIDE_STEPS_PER_BAR;

type Chord = { name: string; root: number; pad: number[]; lead: number[] };
type Section = 'launch' | 'gaps' | 'flank' | 'eye' | 'belly' | 'flagship' | 'trench' | 'pullout';

const Dm: Chord = { name: 'Dm', root: 38, pad: [50, 53, 57, 62], lead: [62, 65, 69, 72, 74, 77, 81, 84] };
const Bb: Chord = { name: 'Bb', root: 34, pad: [46, 50, 53, 58], lead: [58, 62, 65, 70, 74, 77, 82, 86] };
const F: Chord = { name: 'F', root: 41, pad: [53, 57, 60, 65], lead: [60, 65, 69, 72, 77, 81, 84, 89] };
const C: Chord = { name: 'C', root: 36, pad: [48, 52, 55, 60], lead: [60, 64, 67, 72, 76, 79, 84, 88] };
const Gm: Chord = { name: 'Gm', root: 43, pad: [55, 58, 62, 67], lead: [62, 67, 70, 74, 79, 82, 86, 91] };
const A: Chord = { name: 'A', root: 45, pad: [57, 61, 64, 69], lead: [61, 64, 69, 73, 76, 81, 85, 88] };
const Eb: Chord = { name: 'Eb', root: 39, pad: [51, 55, 58, 63], lead: [58, 63, 67, 70, 75, 79, 82, 87] };
const BbMaj7: Chord = { name: 'Bbmaj7', root: 34, pad: [46, 53, 57, 60], lead: [57, 60, 65, 69, 72, 77, 81, 84] };
const D: Chord = { name: 'D', root: 38, pad: [50, 54, 57, 62], lead: [62, 66, 69, 74, 78, 81, 86, 90] };

// Bars 0–11 run on the main cycle (two bars a chord); each later movement has its own harmony.
const CHORDS: readonly Chord[] = [Dm, Dm, Bb, F, C, Bb];
const ALTERNATE_CHORDS = [
  { fromBar: 12, toBar: 14, chords: [BbMaj7], barsPerChord: 2 }, // the eye: one suspended breath
  { fromBar: 14, toBar: 18, chords: [Dm, Bb, F, A], barsPerChord: 1 }, // belly: rebuild toward the dominant
  { fromBar: 18, toBar: 22, chords: [Dm, Eb, Dm, Eb], barsPerChord: 1 }, // flagship: the Neapolitan march
  { fromBar: 22, toBar: 26, chords: [Gm, Dm, Bb, A], barsPerChord: 1 }, // trench: climbing to the dominant
  { fromBar: 26, chords: [D], barsPerChord: 2 }, // pull-out: D major (the victory theme, or its shadow)
] as const;

const SECTIONS = [
  { index: 'launch', fromBar: BARS.launch },
  { index: 'gaps', fromBar: BARS.gaps },
  { index: 'flank', fromBar: BARS.flank },
  { index: 'eye', fromBar: BARS.eye, crossfadeBars: 1 },
  { index: 'belly', fromBar: BARS.belly },
  { index: 'flagship', fromBar: BARS.flagship },
  { index: 'trench', fromBar: 22 },
  { index: 'pullout', fromBar: 26 },
] as const;

// Kill lanes: degrees into the live lead set per 16th step. A chained volley
// walks the lane, so six kills perform a real trumpet run.
const KILL_LANES: Record<Section, number[]> = {
  launch: [0, 2, 4, 7, 4, 2, 0, 2, 4, 7, 4, 2, 0, 4, 7, 4],
  gaps: [0, 4, 2, 5, 4, 7, 5, 2, 4, 0, 5, 2, 7, 4, 2, 0],
  flank: [7, 5, 4, 7, 5, 4, 2, 4, 7, 5, 4, 7, 5, 4, 2, 0],
  eye: [2, 4, 5, 4, 2, 0, 2, 4, 5, 7, 5, 4, 2, 4, 2, 0],
  belly: [0, 0, 4, 4, 2, 2, 5, 5, 0, 0, 4, 4, 7, 7, 5, 2],
  flagship: [0, 3, 0, 5, 0, 3, 0, 7, 4, 3, 4, 5, 4, 3, 4, 7],
  trench: [0, 2, 4, 5, 7, 5, 4, 2, 4, 5, 7, 5, 4, 2, 0, 2],
  pullout: [7, 4, 2, 0, 7, 4, 2, 0, 4, 2, 0, 4, 7, 4, 7, 7],
};

// The solo trumpet brightens as the battle grows; muted in the eye.
const SOLO_VOICES: Record<Section, SoloVoice> = {
  launch: { cutoff: 2000, decay: 0.34, gain: 0.11, bite: 0.05 },
  gaps: { cutoff: 2300, decay: 0.32, gain: 0.11, bite: 0.06 },
  flank: { cutoff: 3000, decay: 0.36, gain: 0.12, bite: 0.09 },
  eye: { cutoff: 1000, decay: 0.5, gain: 0.08, bite: 0.0 },
  belly: { cutoff: 2400, decay: 0.32, gain: 0.11, bite: 0.07 },
  flagship: { cutoff: 2700, decay: 0.3, gain: 0.12, bite: 0.09 },
  trench: { cutoff: 3300, decay: 0.34, gain: 0.13, bite: 0.11 },
  pullout: { cutoff: 3200, decay: 0.5, gain: 0.12, bite: 0.08 },
};

// Written melodies: [bar within theme, step, midi, length in steps].
type ThemeNote = readonly [bar: number, step: number, midi: number, length: number];
const THEME_A: ThemeNote[] = [
  [0, 0, 62, 6], [0, 6, 69, 2], [0, 8, 65, 4], [0, 12, 64, 2], [0, 14, 62, 2],
  [1, 0, 60, 4], [1, 4, 62, 4], [1, 8, 65, 6], [1, 14, 69, 2],
  [2, 0, 70, 6], [2, 6, 69, 2], [2, 8, 67, 4], [2, 12, 65, 2], [2, 14, 67, 2],
  [3, 0, 69, 12], [3, 12, 72, 4],
];
const THEME_B: ThemeNote[] = [
  [0, 0, 74, 6], [0, 6, 69, 2], [0, 8, 74, 4], [0, 12, 77, 4],
  [1, 0, 76, 4], [1, 4, 74, 4], [1, 8, 72, 6], [1, 14, 69, 2],
  [2, 0, 70, 4], [2, 4, 74, 4], [2, 8, 77, 4], [2, 12, 74, 2], [2, 14, 72, 2],
  [3, 0, 69, 16],
];
// Trench: a rising sequence, one bar per chord, that lands on the dominant.
const THEME_TRENCH: ThemeNote[] = [
  [0, 0, 62, 3], [0, 4, 65, 3], [0, 8, 67, 3], [0, 12, 70, 4],
  [1, 0, 65, 3], [1, 4, 69, 3], [1, 8, 72, 3], [1, 12, 74, 4],
  [2, 0, 70, 3], [2, 4, 74, 3], [2, 8, 77, 3], [2, 12, 78, 4],
  [3, 0, 76, 6], [3, 6, 81, 2], [3, 8, 84, 8],
];
// Victory fanfare, D major, trumpets.
const FANFARE: ThemeNote[] = [
  [0, 0, 74, 2], [0, 2, 69, 2], [0, 4, 74, 2], [0, 6, 78, 2], [0, 8, 81, 8],
  [1, 0, 78, 2], [1, 2, 81, 2], [1, 4, 86, 10],
];

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-6m7m',
  bpm: BROADSIDE_BPM,
  stepSeconds: STEP,
  defaultSeconds: BROADSIDE_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let victory = false;
  let coreIds = new Set<number>();
  let generatorIds = new Set<number>();

  const score = createScore<Chord, Section>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: STEPS,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: ALTERNATE_CHORDS,
    sections: SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: BROADSIDE_BPM,
    stepSeconds: STEP,
    stepsPerBar: STEPS,
    scheduleAhead: 0.16,
    schedulerMs: 25,
    volumeScale: 0.76,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.006, release: 0.24 },
      delay: { maxTime: 1, time: STEP * 3, feedback: 0.26, dampHz: 2600, sendGain: 0.3, returnTo: 'master' },
      reverb: { seconds: 1.7, decay: 2.4, level: 0.24, returnTo: 'master' },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      victory = false;
      coreIds = new Set();
      generatorIds = new Set();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const time = context.currentTime + 0.05;
      const chord = victory ? D : Dm;
      voices.strings(time, chord.pad.map((midi) => midi + 12), 0.8, 4.5, 0.6, 1500);
      voices.horns(time, chord.pad, 0.5, 3.2);
      voices.timpani(time, chord.root, 0.7);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createBroadsideVoices({ trace, context: () => ctx, mix: runtime.mix });

  // ---- arrangement -----------------------------------------------------------------

  const march = 'T...t...T...t...';
  const marchFull = 'T...T...T...T...';
  const marchSoft = 'T.......t.......';
  const snareMarch = 's.s.S.s.s.s.S.s.';
  const snareRoll = 's.s.S.s.s.s.S.rr';
  const snareImperial = 'S..s..s.S..s..s.';
  const snareFull = 'SsssSsssSsssSsss';
  const eighths = 'O.O.O.O.O.O.O.O.';
  const sixteenths = 'OoOoOoOoOoOoOoOo';

  const timpaniTrack = (pattern: string, base = 1) =>
    hits<Chord>(pattern, { T: 1, t: 0.62, r: 0.4 }, ({ time, chord }, vel) => voices.timpani(time, chord.root, vel * base));
  const snareTrack = (pattern: string, base = 1) =>
    hits<Chord>(pattern, { S: 1, s: 0.5, r: 0.36 }, ({ time }, vel, symbol) => voices.snare(time, vel * base, symbol === 'r'));
  const ostinatoTrack = (pattern: string, octave = 0, vel = 1) =>
    hits<Chord>(pattern, { O: 0.9 * vel, o: 0.55 * vel }, ({ time, chord, step }, velocity) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      voices.tremolo(time, chord.pad[order[Math.floor(step / 2) % order.length]] + octave * 12, velocity);
    });
  const padTrack = (vel: number, attack: number, cutoff: number, octave = 0) =>
    fn<Chord>(({ time, chord, step, bar, position }) => {
      if (step !== 0) return;
      const next = score.chordAt(position + STEPS);
      const previous = bar === 0 ? undefined : score.chordAt(position - STEPS);
      if (previous && previous.name === chord.name && next.name === chord.name && bar % 2 === 1) return;
      const bars = next.name === chord.name ? 2 : 1;
      voices.strings(time, chord.pad.map((midi) => midi + octave * 12), vel, bars * STEPS * STEP * 1.05, attack, cutoff);
    });
  const hornChordTrack = (pattern: string, vel: number, dur: number) =>
    hits<Chord>(pattern, { H: 1, h: 0.6 }, ({ time, chord }, velocity) => voices.horns(time, chord.pad, vel * velocity, dur));
  const melodyTrack = (theme: ThemeNote[], instrument: 'horns' | 'trumpets', vel: number, transpose = 0, loopBars = 4) =>
    fn<Chord>(({ time, step, barInSection }) => {
      const themeBar = barInSection % loopBars;
      for (const [bar, noteStep, midi, length] of theme) {
        if (bar !== themeBar || noteStep !== step) continue;
        const dur = length * STEP * 0.92;
        if (instrument === 'horns') voices.horns(time, [midi + transpose], vel, dur);
        else voices.trumpets(time, midi + transpose, vel, dur);
      }
    });
  const harpTrack = (steps: number[], vel: number) =>
    fn<Chord>(({ time, step, chord, bar }) => {
      const index = steps.indexOf(step);
      if (index < 0) return;
      voices.harp(time, chord.lead[(index + bar * 2) % chord.lead.length], vel);
    });

  const pulloutTrack: ArrangementTrack<Chord> = fn(({ time, step, barInSection, chord }) => {
    if (victory) {
      if (barInSection === 0 && step === 0) {
        voices.crash(time, 1);
        voices.timpani(time, 38, 1);
        voices.strings(time, [62, 66, 69, 74, 78], 0.9, 2 * STEPS * STEP * 1.1, 0.3, 2200);
      }
      if (step === 0 || step === 8) voices.timpani(time, 38, step === 0 ? 0.9 : 0.55);
      if (step === 0) voices.horns(time, chord.pad, 0.8, STEPS * STEP * 0.95);
      for (const [bar, noteStep, midi, length] of FANFARE) {
        if (bar === barInSection && noteStep === step) voices.trumpets(time, midi, 1, length * STEP * 0.95);
      }
      if (barInSection === 1 && step >= 4 && step < 12) voices.harp(time, chord.lead[step - 4], 0.7);
      if (step % 2 === 0) voices.tremolo(time, chord.pad[(step / 2) % 4] + 12, 0.7);
    } else {
      // The flagship lives: the same key, in shadow.
      if (barInSection === 0 && step === 0) {
        voices.strings(time, [50, 53, 57, 62], 0.8, 2 * STEPS * STEP * 1.1, 0.5, 1200);
        voices.sub(time, 26, 0.7, 2 * STEPS * STEP);
      }
      if (step === 0) voices.timpani(time, 38, 0.6);
      if (step === 0 && barInSection === 0) voices.horns(time, [65, 62], 0.55, STEPS * STEP * 0.8);
      if (step === 8 && barInSection === 0) voices.horns(time, [62, 58], 0.5, STEPS * STEP * 0.9);
      if (step === 0 && barInSection === 1) voices.horns(time, [57, 53, 50], 0.6, STEPS * STEP * 1.6);
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'launch',
        fromBar: BARS.launch,
        tracks: [
          // Bar 0: timpani roll and snare roll under the catapult; bar 1: the fanfare hits.
          fn(({ time, barInSection, step }) => {
            if (barInSection === 0) {
              voices.timpani(time, 38, 0.25 + (step / 16) * 0.6);
              if (step % 2 === 0) voices.snare(time, 0.2 + (step / 16) * 0.5, true);
              if (step === 0) voices.riser(time, STEPS * STEP, 0.1);
            }
          }),
          oneShot(1, 0, ({ time, chord }) => {
            voices.crash(time, 1);
            voices.timpani(time, chord.root, 1);
            voices.horns(time, chord.pad, 1, 6 * STEP);
            voices.strings(time, chord.pad.map((midi) => midi + 12), 0.8, STEPS * STEP, 0.05, 2000);
          }),
          oneShot(1, 8, ({ time }) => voices.trumpets(time, 62, 0.9, 2 * STEP)),
          oneShot(1, 10, ({ time }) => voices.trumpets(time, 69, 0.9, 2 * STEP)),
          oneShot(1, 12, ({ time }) => voices.trumpets(time, 74, 1, 4 * STEP)),
          hits<Chord>(marchSoft, { T: 0.8, t: 0.5 }, ({ time, chord, barInSection }, vel) => { if (barInSection === 1) voices.timpani(time, chord.root, vel); }),
        ],
      },
      {
        name: 'gaps',
        fromBar: BARS.gaps,
        tracks: [timpaniTrack(march, 0.9), snareTrack(snareMarch, 0.8), ostinatoTrack(eighths, 0, 0.8), padTrack(0.7, 0.3, 1500), melodyTrack(THEME_A, 'horns', 0.85), hornChordTrack('H...............', 0.45, 6 * STEP), oneShot(5, 12, ({ time }) => voices.riser(time, 2.2 * STEPS * STEP, 0.09))],
      },
      {
        name: 'flank',
        fromBar: BARS.flank,
        tracks: [oneShot(0, 0, ({ time }) => voices.crash(time, 1)), timpaniTrack(marchFull, 1), snareTrack(snareRoll, 1), ostinatoTrack(sixteenths, 1, 0.9), padTrack(0.9, 0.2, 2100), melodyTrack(THEME_B, 'trumpets', 1), hornChordTrack('H.......h.......', 0.7, 7 * STEP), oneShot(3, 8, ({ time }) => voices.riser(time, 0.5 * STEPS * STEP, 0.08))],
      },
      {
        name: 'eye',
        fromBar: BARS.eye,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            voices.strings(time, chord.pad.map((midi) => midi + 24), 0.55, 2 * STEPS * STEP * 1.1, 0.9, 1300);
            voices.choir(time, [chord.pad[1] + 12, chord.pad[3] + 12], 0.7, 2 * STEPS * STEP);
            voices.sub(time, chord.root - 12, 0.8, 2 * STEPS * STEP);
          }),
          harpTrack([0, 6, 12], 0.5),
          fn(({ time, step, barInSection }) => { if (barInSection === 1 && step === 8) voices.boom(time, 0.5); }),
          oneShot(1, 12, ({ time }) => voices.timpani(time, 38, 0.3)),
        ],
      },
      {
        name: 'belly',
        fromBar: BARS.belly,
        tracks: [timpaniTrack(march, 0.9), snareTrack(snareMarch, 0.85), hornChordTrack('H.......H...H...', 0.55, 3 * STEP), ostinatoTrack(eighths, -1, 0.9), padTrack(0.6, 0.25, 1600), fn(({ time, step, barInSection }) => { if (barInSection >= 2 && step % 2 === 1) voices.tremolo(time, 74 + (step % 4 === 1 ? 0 : 3), 0.5); }), oneShot(3, 0, ({ time }) => voices.riser(time, STEPS * STEP, 0.1))],
      },
      {
        name: 'flagship',
        fromBar: BARS.flagship,
        tracks: [
          oneShot(0, 0, ({ time }) => { voices.crash(time, 0.9); voices.boom(time, 1); }),
          timpaniTrack(marchFull, 1),
          snareTrack(snareImperial, 1),
          hornChordTrack('H.......H.......', 0.85, 7 * STEP),
          padTrack(0.75, 0.15, 1400, -1),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection % 2 === 1 && step >= 12) voices.trumpets(time, chord.lead[[0, 2, 4, 7][step - 12]], 0.8, STEP * 0.9);
          }),
          oneShot(3, 0, ({ time }) => voices.riser(time, STEPS * STEP, 0.12)),
        ],
      },
      {
        name: 'trench',
        fromBar: 22,
        tracks: [oneShot(0, 0, ({ time }) => voices.crash(time, 1)), timpaniTrack(marchFull, 1), snareTrack(snareFull, 0.8), ostinatoTrack(sixteenths, 0, 1), padTrack(0.85, 0.15, 2200), melodyTrack(THEME_TRENCH, 'horns', 0.9), fn(({ time, step, chord, barInSection }) => { if (step === 0 || step === 8) voices.trumpets(time, chord.lead[4 + (barInSection % 2) * 2], 0.7, 3 * STEP); }), oneShot(2, 0, ({ time }) => voices.riser(time, 2 * STEPS * STEP, 0.13))],
      },
      { name: 'pullout', fromBar: 26, tracks: [pulloutTrack] },
    ],
  });

  // Attract mode: the battle heard from the hangar deck.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: () => Dm,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        fn(({ time, bar, step }) => {
          if (step !== 0) return;
          if (bar % 4 === 0) {
            voices.sub(time, 26, 0.6, 4 * STEPS * STEP);
            voices.strings(time, [62, 65, 69, 74], 0.4, 4 * STEPS * STEP * 1.05, 1.2, 1100);
          }
          if (bar % 2 === 0) voices.timpani(time, 38, 0.35);
        }),
        fn(({ time, bar, step }) => { if (bar % 2 === 1 && step === 10) voices.boom(time, 0.35); }),
        fn(({ time, bar, step }) => { if (bar % 4 === 2 && step === 8) voices.horns(time, [50, 57], 0.3, 6 * STEP); }),
      ],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position % (STEPS * 8), time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments ----------------------------------------------------

  const sfxLayers = (mix: SectionMix<Section>): Array<[Section, number]> =>
    mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];

  function killNote(time: number, position: number, chain: number) {
    const mix = score.sectionMixAt(position);
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const lane = KILL_LANES[laneSection];
    const midi = score.leadSetAt(position)[lane[position % lane.length]];
    const vel = Math.min(1.4, 1 + chain * 0.1);
    for (const [section, weight] of sfxLayers(mix)) {
      if (weight < 0.02) continue;
      voices.solo(time, midi, SOLO_VOICES[section], vel, weight);
    }
    if (chain >= 3) voices.harp(time, midi + 12, 0.5);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (coreIds.has(enemyId)) {
      coreKill(coreIds.size <= 1);
      coreIds.delete(enemyId);
      return;
    }
    if (generatorIds.delete(enemyId)) {
      generatorKill(generatorIds.size === 0);
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    voices.pizzicato(time, lead[Math.min(lead.length - 1, lockCount)], lockCount, 0.6 + lockCount * 0.06);
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    voices.pizzicato(ctx.currentTime, 50, 0, 0.3);
  });

  bus.on('fire', ({ volleySize, indexInVolley }) => {
    if (!ctx || (indexInVolley ?? 0) > 0) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const root = score.chordAt(score.arrangementPositionAt(time)).root;
    voices.stab(time, root + 24, 0.7 + volleySize * 0.06);
    if (volleySize >= 4) voices.stab(time, root + 31, 0.5);
    if (volleySize === 6) {
      // The full broadside: everything ducks for the salvo and the brass answers.
      runtime.mix()?.duckAt(time, 0.68, 0.3);
      voices.timpani(time, root, 0.8);
      voices.snare(time, 0.9, false);
    }
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (coreIds.has(enemyId)) {
      coreChip(1 - hitPointsRemaining / 3, chord);
      return;
    }
    if (generatorIds.has(enemyId)) {
      voices.chip(time, chord.lead[2], 0.09);
      voices.horns(time, [chord.root + 12, chord.root + 19], 0.5, 3 * STEP);
      voices.noise(time, 0.12, 0.2, 'bandpass', 1100, runtime.mix()?.sfx ?? runtime.mix()!.master);
      return;
    }
    voices.chip(time, chord.lead[1] + 12, 0.07);
    voices.chip(time + STEP / 2, chord.lead[3] + 12, 0.05);
  });

  // Chipping a core rings the low brass and climbs the lead set with the damage dealt.
  function coreChip(intensity: number, chord: Chord) {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    voices.horns(time, [chord.root + 12, chord.root + 15 + Math.round(intensity * 4)], 0.6 + intensity * 0.5, 4 * STEP);
    voices.chip(time, chord.lead[Math.min(7, Math.floor(intensity * 8))] + 12, 0.1 + intensity * 0.06);
    voices.timpani(time, chord.root, 0.5 + intensity * 0.4);
    runtime.mix()?.duckAt(time, 0.75, 0.25);
  }

  function generatorKill(shieldFalls: boolean) {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.crash(time, 0.7);
    voices.timpani(time, chord.root, 0.9);
    voices.trumpets(time, chord.lead[4], 0.9, 2 * STEP);
    voices.trumpets(time + 2 * STEP, chord.lead[7], 1, 4 * STEP);
    if (shieldFalls) {
      runtime.mix()?.duckAt(time, 0.4, 1.2);
      voices.riser(time, 6 * STEP, 0.14);
      voices.horns(time + 4 * STEP, [chord.root + 12, chord.root + 19, chord.root + 24], 1, 10 * STEP);
      voices.crash(time + 8 * STEP, 1);
    }
  }

  // The last core: the music bows out for a breath and the victory fanfare lands on the grid.
  function coreKill(last: boolean) {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    voices.timpani(time, 38, 1);
    voices.crash(time, 0.8);
    voices.trumpets(time, 74, 0.9, 3 * STEP);
    if (!last) return;
    victory = true;
    runtime.mix()?.duckAt(time, 0.22, 1.9);
    voices.sub(time, 26, 0.9, 2.5);
    voices.riser(time, 4 * STEP, 0.12);
    for (const [bar, noteStep, midi, length] of FANFARE) {
      const at = time + 4 * STEP + (bar * STEPS + noteStep) * STEP;
      voices.trumpets(at, midi, 1.05, length * STEP * 0.95);
    }
    voices.horns(time + 12 * STEP, D.pad, 1, 16 * STEP);
    voices.strings(time + 12 * STEP, D.pad.map((midi) => midi + 12), 0.9, 20 * STEP, 0.3, 2300);
    voices.crash(time + 12 * STEP, 1);
    [62, 66, 69, 74, 78, 81, 86, 90].forEach((midi, index) => voices.harp(time + 12 * STEP + index * STEP * 0.5, midi, 0.6));
  }

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.horns(time, chord.pad.map((midi) => midi + 12), size === 6 ? 0.9 : 0.55, 6 * STEP);
    if (size === 6) voices.crash(time, 0.6);
  });

  bus.on('reject', ({ reason }) => {
    // A shielded core is answered by the deflect on `shielded`; the blat is for bad releases.
    if (!ctx || reason === 'level-rule') return;
    const time = ctx.currentTime;
    voices.blat(time, 50, 0.16);
    voices.blat(time + 0.03, 51, 0.11);
  });

  bus.on('shielded', () => {
    if (!ctx) return;
    voices.deflect(ctx.currentTime, 1);
    runtime.mix()?.duckAt(ctx.currentTime, 0.8, 0.2);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    voices.hull(ctx.currentTime);
    runtime.mix()?.duckAt(ctx.currentTime, 0.45, 0.5);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    voices.slide(ctx.currentTime, 118);
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind === 'core') coreIds.add(enemyId);
    if (kind === 'generator') generatorIds.add(enemyId);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    if (phase === 'summoned') {
      voices.horns(time, [38 + 12, 39 + 12], 0.9, 6 * STEP);
      voices.horns(time + 4 * STEP, [38 + 12, 45 + 12], 0.9, 8 * STEP);
      voices.timpani(time, 38, 1);
      voices.boom(time, 0.8);
    } else if (phase === 'exposed') {
      voices.crash(time, 1);
    }
  });

  void lerp;
  return runtime;
}
