import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, type ArrangementContext, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp } from '../../engine/score';
import { createVespersVoices } from './audio-voices';
import { VESPERS_BARS, VESPERS_BPM, VESPERS_SCORE_SECTIONS, VESPERS_STEPS_PER_BAR, VESPERS_TIME } from './timing';

// The building's own organ. A pedal point opens alone in D minor and real
// voices enter above it one at a time, in counterpoint — there is no
// percussion anywhere in this level; the pulse is the counterpoint moving.
// The player's locks, shots, and kills are organ voices too: kills read a
// hidden melody lane pitched from the live harmony, locks climb a flute
// scale, the gun's chiff is rooted on the current chord. One rank — an en
// chamade trumpet — is held back all night, and speaks for the first time
// when the Vigil dies and the minor turns major.

const SIXTEENTH = VESPERS_TIME.stepSeconds;
const STEPS_PER_BAR = VESPERS_STEPS_PER_BAR;
const BAR_SECONDS = VESPERS_TIME.barSeconds;

// D minor. Chords change every bar in a four-bar cycle: i — VI — iv — V.
type Chord = { pedal: number; tones: number[]; arp: number[] };
const CHORDS: Chord[] = [
  { pedal: 38, tones: [50, 53, 57], arp: [74, 77, 81, 86] }, // D minor
  { pedal: 34, tones: [50, 53, 58], arp: [74, 77, 82, 86] }, // Bb major
  { pedal: 31, tones: [50, 55, 58], arp: [74, 79, 82, 86] }, // G minor
  { pedal: 33, tones: [52, 57, 61], arp: [76, 81, 85, 88] }, // A major
];
// The Vigil's bars sit on the tonic pedal; after bar 17 the world is D major.
// chordAt indexes alternate sets by ABSOLUTE bar (bar % length), so this
// array is ordered for bars 16,13,14,15 → A, Dm, Gm, Dm.
const VIGIL_CHORDS: Chord[] = [
  { pedal: 33, tones: [52, 57, 61], arp: [76, 81, 85, 88] }, // A major (bar 16, the apex)
  { pedal: 38, tones: [50, 53, 57], arp: [74, 77, 81, 86] }, // D minor (bar 13)
  { pedal: 31, tones: [50, 55, 58], arp: [74, 79, 82, 86] }, // G minor (bar 14)
  { pedal: 38, tones: [50, 53, 57], arp: [74, 77, 81, 86] }, // D minor (bar 15)
];
const LAST_LIGHT_CHORDS: Chord[] = [
  { pedal: 38, tones: [50, 54, 57], arp: [74, 78, 81, 86] }, // D major
];

// Locks climb D dorian, one step per lock in the volley.
const LOCK_SCALE = [74, 76, 77, 79, 81, 84, 86, 89];

// Kill-melody lanes: degrees 0–7 into the current chord's lead set (arp plus
// the same notes an octave up). A chained volley walks consecutive steps, so
// sweeping a full wave performs a real melodic figure in the organ's own key.
type SectionIndex = 0 | 1 | 2 | 3;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Dusk: a slow stepwise arch — plainsong for the first waves.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 2, 1,
    2, 3, 2, 1, 0, 1, 2, 3,
  ],
  // Plenum: broken-chord peals across two octaves.
  1: [
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 0, 6, 2, 5, 1, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Quiet: high and sparse — a voice alone at the top of the building.
  2: [
    7, 6, 5, 6, 7, 5, 6, 4,
    5, 6, 7, 6, 5, 4, 5, 6,
    7, 6, 5, 4, 5, 6, 5, 4,
    5, 4, 5, 6, 7, 6, 5, 6,
  ],
  // Vigil: tolling descents answered by a climb — bell changes over the fight.
  3: [
    7, 4, 6, 3, 5, 2, 4, 1,
    7, 4, 6, 3, 5, 2, 4, 1,
    3, 0, 2, 0, 4, 1, 3, 0,
    7, 6, 5, 4, 3, 2, 1, 0,
  ],
};

// Which rank the player's own instruments speak in, per section.
const SECTION_VOICES: Record<SectionIndex, {
  kill: { cutoff: number; gain: number; dur: number; reedy: number };
  lock: { gain: number; cutoff: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { cutoff: 2600, gain: 0.15, dur: 0.5, reedy: 0 },
    lock: { gain: 0.1, cutoff: 2400 },
    fire: { cutoff: 1800, noise: 0.025 },
  },
  1: {
    kill: { cutoff: 3300, gain: 0.16, dur: 0.45, reedy: 0.25 },
    lock: { gain: 0.09, cutoff: 2800 },
    fire: { cutoff: 2600, noise: 0.04 },
  },
  2: {
    kill: { cutoff: 2200, gain: 0.14, dur: 0.75, reedy: 0 },
    lock: { gain: 0.08, cutoff: 2100 },
    fire: { cutoff: 1600, noise: 0.02 },
  },
  3: {
    kill: { cutoff: 3800, gain: 0.17, dur: 0.55, reedy: 0.55 },
    lock: { gain: 0.1, cutoff: 3100 },
    fire: { cutoff: 3200, noise: 0.055 },
  },
};

// ---- authored counterpoint --------------------------------------------------
// [bar, step, midi, durationInSteps, velocity?]. Bars are absolute against
// the four-bar chord cycle unless a track says otherwise, so lines flow
// unbroken across arrangement section boundaries.
type NoteEvent = [bar: number, step: number, midi: number, durSteps: number, vel?: number];

// Tenor — the first voice to enter, the cantus the rest answer.
const TENOR_LINE: NoteEvent[] = [
  [0, 0, 50, 4], [0, 4, 53, 4], [0, 8, 52, 2], [0, 10, 53, 2], [0, 12, 57, 4],
  [1, 0, 58, 4], [1, 4, 57, 2], [1, 6, 55, 2], [1, 8, 53, 4], [1, 12, 50, 4],
  [2, 0, 55, 4], [2, 4, 58, 4], [2, 8, 62, 2], [2, 10, 58, 2], [2, 12, 57, 4],
  [3, 0, 61, 4], [3, 4, 62, 2], [3, 6, 61, 2], [3, 8, 57, 4], [3, 12, 52, 4],
];

// The same cantus in eighths for the plenum — the corridor at full voice.
const TENOR_PLENUM_LINE: NoteEvent[] = [
  [0, 0, 50, 2], [0, 2, 52, 2], [0, 4, 53, 2], [0, 6, 57, 2], [0, 8, 53, 2], [0, 10, 52, 2], [0, 12, 57, 4],
  [1, 0, 58, 2], [1, 2, 57, 2], [1, 4, 55, 2], [1, 6, 53, 2], [1, 8, 55, 2], [1, 10, 57, 2], [1, 12, 58, 4],
  [2, 0, 55, 2], [2, 2, 58, 2], [2, 4, 62, 2], [2, 6, 58, 2], [2, 8, 55, 2], [2, 10, 58, 2], [2, 12, 62, 4],
  [3, 0, 61, 2], [3, 2, 57, 2], [3, 4, 52, 2], [3, 6, 57, 2], [3, 8, 61, 2], [3, 10, 62, 2], [3, 12, 61, 4],
];

// Alto — answers off the beat, a third and a sixth above.
const ALTO_LINE: NoteEvent[] = [
  [0, 2, 65, 6], [0, 8, 64, 4], [0, 12, 62, 4],
  [1, 4, 65, 2], [1, 6, 64, 2], [1, 8, 62, 8],
  [2, 2, 62, 6], [2, 8, 67, 4], [2, 12, 65, 4],
  [3, 0, 64, 8], [3, 8, 61, 4], [3, 12, 64, 4],
];

// Soprano descant — long notes over the top, the highest window light.
const SOPRANO_LINE: NoteEvent[] = [
  [0, 0, 69, 8], [0, 8, 65, 8],
  [1, 0, 70, 8], [1, 8, 65, 8],
  [2, 0, 70, 12], [2, 12, 69, 4],
  [3, 0, 69, 12], [3, 12, 64, 4],
];

// The quiet span: one flute alone. Section-relative, two bars (A then D minor).
const QUIET_SOLO: NoteEvent[] = [
  [0, 0, 76, 6], [0, 8, 74, 4], [0, 12, 73, 4],
  [1, 0, 74, 10], [1, 12, 69, 4],
];

// The Vigil's tenor: circling, chromatic at the edges. Section-relative, three
// bars over the D-pedal harmony.
const VIGIL_LINE: NoteEvent[] = [
  [0, 0, 62, 4], [0, 4, 61, 2], [0, 6, 62, 2], [0, 8, 58, 4], [0, 12, 57, 4],
  [1, 0, 55, 4], [1, 4, 58, 2], [1, 6, 62, 2], [1, 8, 58, 4], [1, 12, 55, 4],
  [2, 0, 50, 6], [2, 6, 53, 2], [2, 8, 57, 4], [2, 12, 62, 4],
];

// The apex bar: one rising scale on the dominant, into the finale.
const APEX_RISE: NoteEvent[] = [
  [0, 0, 57, 2], [0, 2, 61, 2], [0, 4, 64, 2], [0, 6, 69, 2],
  [0, 8, 73, 2], [0, 10, 76, 2], [0, 12, 81, 4],
];

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-t5xw',
  bpm: VESPERS_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createVespersAudio,
});

export function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let heartId = -1;
  let heartMaxHp = 0;
  let bossDead = false;

  const score = createScore<Chord, SectionIndex>({
    bpm: VESPERS_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 1,
    alternateChordSets: [
      { fromBar: VESPERS_BARS.vigil, toBar: VESPERS_BARS.lastLight, chords: VIGIL_CHORDS },
      { fromBar: VESPERS_BARS.lastLight, chords: LAST_LIGHT_CHORDS },
    ],
    sections: VESPERS_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.78,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -20, ratio: 4, attack: 0.006, release: 0.24 },
      reverb: { seconds: 3.4, decay: 2.4, level: 0.32 },
      delay: { time: SIXTEENTH * 3, feedback: 0.28, dampHz: 2200 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      heartId = -1;
      heartMaxHp = 0;
      bossDead = false;
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      // The building settles: a last low D and its flute an octave above.
      const at = context.currentTime + 0.08;
      pedal(at, 38, 3.2, 0.5);
      flute(at + 0.12, 74, 2.6, 0.4);
      if (bossDead) flute(at + 0.24, 78, 2.4, 0.3);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createVespersVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { pedal, principal, flute, reed, trumpet, choir, bell, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- player instrument voices --------------------------------------------

  // Cornet for kills: principal partials plus a tierce, with an optional reedy
  // saw layer that the Vigil section leans on.
  const killVoice = voice<{ cutoff: number; dur: number; reedy: number }>({
    oscillators: [
      { type: 'sine', gain: 0.5 },
      { type: 'sine', octave: 1, gain: 0.18 },
      { type: 'sine', frequencyRatio: 3, gain: 0.09 },
      { type: 'sine', frequencyRatio: 5, gain: 0.05 },
      { type: 'sawtooth', gain: ({ reedy }) => 0.08 * reedy },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: 0.012, decay: ({ dur }) => dur },
  });

  const killBodyVoice = voice<{ dur: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ dur }) => dur,
    stopPadding: 0.05,
    envelope: { decay: ({ dur }) => dur * 0.8 },
  });

  const lockVoice = voice<{ cutoff: number; lockCount: number }>({
    oscillators: [
      { type: 'sine', gain: 0.75 },
      { type: 'triangle', gain: 0.12 },
    ],
    duration: 0.15,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 160 },
    envelope: { attack: 0.008, decay: 0.15 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [
      { type: 'sine', gain: 0.6 },
      { type: 'sine', octave: 1, gain: 0.2 },
    ],
    duration: 0.09,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.09 },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.55 },
      { type: 'sawtooth', midiOffset: 1, gain: 0.45 },
    ],
    duration: 0.3,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 900 },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const impactBoomVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.45,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 36, time: time + 0.3 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.42, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
    ],
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.32,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 70, time: time + 0.28 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.055, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  // ---- arrangement ---------------------------------------------------------

  // Melody helper: schedule authored NoteEvents. `relative` phrases count
  // bars from the section start (for section-shaped material); absolute
  // phrases follow the global four-bar chord cycle.
  function line(
    notes: NoteEvent[],
    phraseBars: number,
    relative: boolean,
    play: (context: ArrangementContext<Chord>, midi: number, durSeconds: number, vel: number) => void,
  ): ArrangementTrack<Chord> {
    const map = new Map<number, NoteEvent>();
    for (const note of notes) map.set(note[0] * STEPS_PER_BAR + note[1], note);
    return fn((context) => {
      const bar = relative ? context.barInSection : context.bar;
      const note = map.get((bar % phraseBars) * STEPS_PER_BAR + context.step);
      if (note) play(context, note[2], note[3] * SIXTEENTH * 0.96, note[4] ?? 1);
    });
  }

  const tenorTrack = (vel: number) => line(TENOR_LINE, 4, false, ({ time }, midi, dur, noteVel) => principal(time, midi, dur, vel * noteVel, 2300));
  const tenorPlenumTrack = () => line(TENOR_PLENUM_LINE, 4, false, ({ time }, midi, dur, noteVel) => principal(time, midi, dur, 0.85 * noteVel, 2700));
  const altoTrack = (vel: number) => line(ALTO_LINE, 4, false, ({ time }, midi, dur, noteVel) => flute(time, midi, dur, vel * noteVel));
  const sopranoTrack = (vel: number) => line(SOPRANO_LINE, 4, false, ({ time }, midi, dur, noteVel) => principal(time, midi, dur, vel * noteVel, 3100));

  const pedalWhole = () => hits<Chord>('P...............', { P: 1 }, ({ time, chord }) => pedal(time, chord.pedal, BAR_SECONDS * 1.02, 0.95));
  const pedalHalves = () => hits<Chord>('P.......f.......', { P: 1, f: 0.85 }, ({ time, chord }, vel, symbol) => {
    pedal(time, symbol === 'f' ? chord.pedal + 7 : chord.pedal, BAR_SECONDS * 0.52, vel);
  });
  const pedalWalk = () => hits<Chord>('P...o...P...o...', { P: 1, o: 0.8 }, ({ time, chord }, vel, symbol) => {
    pedal(time, symbol === 'o' ? chord.pedal + 12 : chord.pedal, SIXTEENTH * 4.1, vel);
  });

  const choirSwell = () => hits<Chord>(
    'C...............................',
    { C: 1 },
    ({ time, chord }) => choir(time, chord.tones.map((midi) => midi + 12), BAR_SECONDS * 2),
  );
  const bellTolls = (pattern: string, offset: number, vel: number) =>
    hits<Chord>(pattern, { B: 1 }, ({ time, chord }) => bell(time, chord.pedal + offset, vel));

  const vigilReeds = () => hits<Chord>('R.......r.......', { R: 1, r: 0.8 }, ({ time, chord }, vel) => {
    reed(time, chord.tones[0], BAR_SECONDS * 0.5, vel * 0.8, 1500);
    reed(time, chord.tones[0] + 7, BAR_SECONDS * 0.5, vel * 0.55, 1400);
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        pedalWhole(),
        line(TENOR_LINE, 4, false, ({ time }, midi, dur) => flute(time, midi, dur, 0.4)),
        bellTolls('B...............................', 24, 0.3),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      // One voice over the pedal; then two; then three. The procession.
      { name: 'procession', fromBar: VESPERS_BARS.run, toBar: VESPERS_BARS.voices, tracks: [pedalWhole(), tenorTrack(0.9)] },
      { name: 'voices', fromBar: VESPERS_BARS.voices, toBar: VESPERS_BARS.descant, tracks: [pedalWhole(), tenorTrack(0.9), altoTrack(0.7)] },
      { name: 'descant', fromBar: VESPERS_BARS.descant, toBar: VESPERS_BARS.plenum, tracks: [pedalWhole(), tenorTrack(0.9), altoTrack(0.7), sopranoTrack(0.55)] },
      // Full organ with choir and bell weight.
      {
        name: 'plenum',
        fromBar: VESPERS_BARS.plenum,
        toBar: VESPERS_BARS.quiet,
        tracks: [pedalHalves(), tenorPlenumTrack(), altoTrack(0.75), sopranoTrack(0.6), choirSwell(), bellTolls('B...............................', 24, 0.5)],
      },
      // The nave goes quiet: one voice, nothing else.
      {
        name: 'quiet',
        fromBar: VESPERS_BARS.quiet,
        toBar: VESPERS_BARS.vigil,
        tracks: [line(QUIET_SOLO, 2, true, ({ time }, midi, dur, vel) => flute(time, midi, dur, 0.8 * vel))],
      },
      // The Vigil: walking pedal, dark reeds, a bell every downbeat.
      {
        name: 'vigil',
        fromBar: VESPERS_BARS.vigil,
        toBar: VESPERS_BARS.apex,
        tracks: [
          pedalWalk(),
          vigilReeds(),
          line(VIGIL_LINE, 3, true, ({ time }, midi, dur, vel) => principal(time, midi, dur, 0.85 * vel, 2500)),
          bellTolls('B...............', 12, 0.55),
          fn(({ step, time, chord }) => {
            if (step === 8) choir(time, chord.tones, BAR_SECONDS * 0.6);
          }),
        ],
      },
      // The apex: everything climbing the dominant.
      {
        name: 'apex',
        fromBar: VESPERS_BARS.apex,
        toBar: VESPERS_BARS.lastLight,
        tracks: [
          pedalWalk(),
          line(APEX_RISE, 1, true, ({ time }, midi, dur) => principal(time, midi, dur, 0.9, 3000)),
          fn(({ step, time, chord }) => {
            if (step === 0) choir(time, chord.tones.map((midi) => midi + 12), BAR_SECONDS);
          }),
          bellTolls('B.......B.......', 12, 0.5),
        ],
      },
      // Last light: if the Vigil is dead the full organ holds D major and the
      // trumpet finally speaks; if it endures, a bare open fifth — the
      // building withholds its third.
      {
        name: 'last-light',
        fromBar: VESPERS_BARS.lastLight,
        tracks: [
          fn(({ step, time }) => {
            if (step !== 0) return;
            if (bossDead) {
              pedal(time, 38, BAR_SECONDS * 1.05, 1);
              for (const midi of [50, 54, 57, 62, 66, 69]) principal(time, midi, BAR_SECONDS, 0.5, 3200);
              choir(time, [62, 66, 69, 74], BAR_SECONDS * 1.05);
              trumpet(time + SIXTEENTH * 8, 74, SIXTEENTH * 4, 0.5);
              trumpet(time + SIXTEENTH * 12, 78, SIXTEENTH * 4, 0.55);
            } else {
              pedal(time, 38, BAR_SECONDS * 1.05, 0.7);
              principal(time, 50, BAR_SECONDS, 0.4, 2000);
              principal(time, 57, BAR_SECONDS, 0.35, 2000);
              choir(time, [62, 69], BAR_SECONDS);
            }
          }),
          bellTolls('B...............', 24, 0.5),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments --------------------------------------------

  // The player's ranks share one oscillator stack; only their numbers move
  // between sections, so a crossfade is a parameter lerp, not layered plays.
  function killParamsAt(position: number) {
    const mix = score.sectionMixAt(position);
    const from = SECTION_VOICES[mix.from].kill;
    const to = SECTION_VOICES[mix.to].kill;
    return {
      cutoff: lerp(from.cutoff, to.cutoff, mix.t),
      gain: lerp(from.gain, to.gain, mix.t),
      dur: lerp(from.dur, to.dur, mix.t),
      reedy: lerp(from.reedy, to.reedy, mix.t),
    };
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === heartId) {
      heartFinale();
      return;
    }
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!output || !audioMix?.delaySend) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const chain = indexInVolley ?? 0;
    const vel = Math.min(1.3, 1 + chain * 0.11);
    const params = killParamsAt(position);
    killVoice.play({
      context: ctx,
      time: kill.time,
      midi: kill.midi,
      cutoff: params.cutoff,
      dur: params.dur,
      reedy: params.reedy,
      gain: params.gain,
      velocity: vel,
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.4 }, ...voices.reverbSends(0.35)],
    });
    killBodyVoice.play({ context: ctx, time: kill.time, midi: kill.midi, dur: params.dur, gain: params.gain * 0.6, velocity: vel, destination: output });
    // From the third chained kill a soft shimmer rings the note an octave up.
    if (chain >= 2) {
      killBodyVoice.play({
        context: ctx,
        time: kill.time,
        midi: kill.midi + 24,
        dur: 0.5,
        gain: 0.05,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(kill.time, 0.03, 0.06, 'highpass', 5600, output);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const mix = score.sectionMixAt(score.arrangementPositionAt(time));
    const from = SECTION_VOICES[mix.from].lock;
    const to = SECTION_VOICES[mix.to].lock;
    lockVoice.play({
      context: ctx,
      time,
      midi,
      cutoff: lerp(from.cutoff, to.cutoff, mix.t),
      lockCount,
      gain: lerp(from.gain, to.gain, mix.t),
      destination: output,
      sends: voices.reverbSends(0.3),
    });
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const from = SECTION_VOICES[mix.from].fire;
    const to = SECTION_VOICES[mix.to].fire;
    const cutoff = lerp(from.cutoff, to.cutoff, mix.t);
    const noise = lerp(from.noise, to.noise, mix.t);
    const root = score.chordAt(position).pedal;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      gain: 0.085,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      destination: output,
    });
    noiseHit(time, noise, 0.02, 'bandpass', 2600, output);
  });

  // Non-lethal hits: a censer cracks with a small bell; chipping the heart
  // tolls the great bell, growing with the damage dealt, with a beacon note
  // climbing the lead set — the fight audibly ratchets toward the finale.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (enemyId === heartId) {
      heartMaxHp = Math.max(heartMaxHp, hitPointsRemaining + 1);
      const intensity = 1 - hitPointsRemaining / Math.max(1, heartMaxHp);
      bell(time, chord.pedal + 12, 0.5 + 0.45 * intensity);
      const leadSet = score.leadSetAt(position);
      const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
      flute(time, beacon, 0.6, 0.35 + 0.3 * intensity);
      noiseHit(time, 0.08 + 0.06 * intensity, 0.05, 'bandpass', 1500, output);
      return;
    }
    bell(time, chord.pedal + 31, 0.32);
    noiseHit(time, 0.035, 0.04, 'highpass', 4800, output);
  });

  // A clean full volley earns a short gloria from the loft.
  bus.on('volley', ({ size, kills }) => {
    if (!ctx || kills < 4 || kills < size) return;
    const output = sfxDestination();
    if (!output) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4].forEach((degree, index) => {
      const midi = leadSet[degree];
      const at = time + index * SIXTEENTH;
      if (bossDead) trumpet(at, midi, 0.3, 0.35);
      else principal(at, midi, 0.3, 0.5, 3200);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // The organ refuses: a low cluster with the wind knocked out of it.
    rejectVoice.play({
      context: ctx,
      time,
      midi: 44,
      vel: 0.3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(41), time: time + 0.24 }],
      destination: output,
    });
    noiseHit(time, 0.12, 0.1, 'bandpass', 520, output);
    noiseHit(time + 0.03, 0.06, 0.14, 'highpass', 2000, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    impactBoomVoice.play({ context: ctx, time, frequency: 92, destination: output });
    // A deliberately out-of-key tritone — the one dissonance in the level.
    for (const midi of [56, 62]) reed(time, midi, 0.28, 0.7, 1400);
    noiseHit(time, 0.18, 0.13, 'bandpass', 850, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // The thief escapes with its light: a small dark fall.
    missVoice.play({ context: ctx, time: ctx.currentTime, frequency: 180, destination: output });
  });

  // The Vigil's entrance: two bells against a darkened choir.
  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind !== 'vigil-heart' || !ctx) return;
    heartId = enemyId;
    const time = score.nextGridTime(ctx.currentTime);
    bell(time, 50, 0.85);
    bell(time + SIXTEENTH * 4, 45, 0.7);
    choir(time, [50, 53, 56], BAR_SECONDS * 1.4);
  });

  // The killing blow: the music bows out for a breath, the rose ignites, and
  // the trumpet — silent all night — leads the whole organ into D major.
  function heartFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    bossDead = true;
    audioMix.duckAt(time, 0.22, 2.0);

    // The great bell on D, and the pedal under everything.
    bell(time, 50, 1);
    bell(time + 0.02, 38, 0.8);
    pedal(time, 38, 3.4, 1);

    // Trumpet fanfare up, then a peal falling through the delay.
    [74, 78, 81, 86].forEach((midi, index) => {
      trumpet(time + index * SIXTEENTH, midi, SIXTEENTH * 1.6, 0.55 + index * 0.05);
    });
    [86, 81, 78, 74, 69, 66, 62].forEach((midi, index) => {
      if (!ctx || !output) return;
      const at = time + SIXTEENTH * 4 + index * SIXTEENTH;
      killVoice.play({
        context: ctx,
        time: at,
        midi,
        cutoff: 3600,
        dur: 0.5,
        reedy: 0.3,
        gain: 0.13 - index * 0.008,
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }, ...voices.reverbSends(0.4)],
      });
    });
    // D major bloom through three octaves.
    choir(time + SIXTEENTH * 2, [62, 66, 69, 74, 78], 3);
    for (const midi of [50, 54, 57]) principal(time + SIXTEENTH * 2, midi, 2.6, 0.5, 3000);
    noiseHit(time, 0.1, 0.5, 'highpass', 6000, output);
  }

  return runtime;
}
