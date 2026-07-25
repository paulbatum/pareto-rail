import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, type SectionMix } from '../../engine/score';
import type { EventBus } from '../../events';
import { createVespersVoices, type StopName } from './audio-voices';
import {
  VESPERS_BARS,
  VESPERS_BPM,
  VESPERS_SCORE_SECTIONS,
  VESPERS_STEPS_PER_BAR,
  VESPERS_TIME,
  type VespersSection,
} from './timing';

// The building's own organ, played the way an organ is actually played: a held
// pedal note, then voices entering one at a time above it in real counterpoint.
// There is no percussion anywhere in this level — the pulse is the parts
// moving.
//
// The player is one more voice in that polyphony. Locks are a flute stop
// walking up the mode, the shot is the swell shoe opening, and every kill
// sounds the note written at that step of a hidden two-bar melody lane, so a
// chained volley performs a real melodic run in whatever stop the section has
// drawn. One rank — the reed — is held back all night. It speaks for the first
// time when the rose window ignites, and the minor turns major with it.

const SIXTEENTH = VESPERS_TIME.stepSeconds;
const EIGHTH = SIXTEENTH * 2;
const BAR = VESPERS_TIME.barSeconds;
const STEPS_PER_BAR = VESPERS_STEPS_PER_BAR;
const n = null;

type Chord = {
  /** Pedal pitch, sounded with a 16' rank under it. */
  bass: number;
  /** Choir voicing. */
  pad: number[];
  /** The register the player's melody owns: nothing in the backing goes here. */
  arp: number[];
  /** Twelve ascending scale degrees for this harmony, from the tenor upward. */
  line: number[];
};

// D minor, two bars a chord: i – VI – iv – V, with the leading tone only in
// the dominant. The whole level is this progression turning over.
const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 65], arp: [69, 74, 77, 81], line: [50, 52, 53, 55, 57, 58, 60, 62, 64, 65, 67, 69] },
  { bass: 34, pad: [46, 53, 58, 62], arp: [70, 74, 77, 82], line: [46, 48, 50, 51, 53, 55, 57, 58, 60, 62, 63, 65] },
  { bass: 31, pad: [43, 50, 55, 58], arp: [67, 70, 74, 79], line: [43, 45, 46, 48, 50, 52, 53, 55, 57, 58, 60, 62] },
  { bass: 33, pad: [45, 52, 57, 61], arp: [69, 73, 76, 81], line: [45, 47, 49, 50, 52, 53, 55, 57, 59, 61, 62, 64] },
];

/** What the tonic becomes when the rose goes up: the same chord, made major. */
const LIT_CHORD: Chord = {
  bass: 38,
  pad: [50, 57, 62, 66],
  arp: [69, 74, 78, 81],
  line: [50, 52, 54, 55, 57, 59, 61, 62, 64, 66, 68, 69],
};
const LIT_LEAD = [69, 74, 78, 81, 86, 90, 93, 98];

/** D minor pentatonic: each lock steps one rung further up it. */
const LOCK_SCALE = [62, 65, 67, 69, 72, 74, 77, 81];

// --- the parts -----------------------------------------------------------
// Voice lines are written as degrees into the current chord's scale, so the
// same contour is always in tune as the harmony moves under it. `n` is a rest.

/** Tenor subject, in eighths: D A G F E D E F / G F E D F E D. */
const SUBJECT: Array<number | null> = [
  0, n, 4, n, 3, n, 2, n, 1, n, 0, n, 1, n, 2, n,
  3, n, 2, n, 1, n, 0, n, 2, n, 1, n, 0, n, n, n,
];

/**
 * The answer, an octave above the subject and in quarters so the two voices
 * never crowd each other: tenor and alto own separate registers by design.
 */
const ANSWER: Array<number | null> = [
  7, n, n, n, 11, n, n, n, 10, n, n, n, 9, n, n, n,
  8, n, n, n, 7, n, n, n, 8, n, n, n, 10, n, n, n,
];

/** Descant: unbroken sixteenths, the figure that makes the gallery move. */
const DESCANT: Array<number | null> = [
  4, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 7, 6, 5, 4, 3,
  5, 4, 5, 6, 7, 6, 5, 4, 5, 6, 7, 8, 7, 6, 5, 4,
];

/** The reed's fanfare. Nothing has played this line before the rose ignites. */
const FANFARE: Array<number | null> = [
  0, n, n, n, 4, n, 2, n, 4, n, n, n, 7, n, n, n,
  6, n, 4, n, 7, n, n, n, 9, n, 7, n, 4, n, n, n,
];

// --- the kill melody -----------------------------------------------------
// Degrees into the current lead set. Kills unmute this lane step by step, so a
// chained volley walks consecutive notes of a written line rather than
// triggering a sound effect six times.
const KILL_LANES: Record<VespersSection, number[]> = {
  // Plainsong: narrow, stepwise, one note at a time in an empty building.
  nave: [
    0, 1, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1,
    2, 3, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 0,
  ],
  // The subject's own shape, handed to the player.
  subject: [
    0, 4, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 1, 0, 1,
    4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1, 0, 2,
  ],
  // Broken chords across the octave: dense volleys ring out as runs.
  gallery: [
    0, 4, 1, 5, 2, 6, 3, 7, 4, 0, 5, 1, 6, 2, 7, 3,
    0, 2, 4, 6, 7, 5, 3, 1, 2, 4, 6, 7, 5, 3, 1, 0,
  ],
  // Falling, low, and slow: one lonely voice.
  hush: [
    3, 2, 1, 0, 1, 0, 2, 1, 0, 1, 2, 1, 0, 2, 1, 0,
    2, 1, 0, 1, 3, 2, 1, 0, 1, 2, 1, 0, 2, 1, 0, 0,
  ],
  // High peals answered by a climb: shots at the rose toll like bells.
  rose: [
    7, 6, 5, 4, 7, 6, 5, 4, 6, 5, 4, 3, 6, 5, 4, 3,
    5, 4, 3, 2, 5, 4, 3, 2, 4, 5, 6, 7, 5, 6, 7, 7,
  ],
  // Everything arrives at the top and stays there.
  tutti: [
    0, 2, 4, 6, 7, 6, 7, 7, 2, 4, 6, 7, 6, 7, 7, 7,
    4, 6, 7, 6, 7, 7, 6, 7, 0, 2, 4, 6, 7, 7, 7, 7,
  ],
};

type PlayerStops = {
  kill: { stop: StopName; gain: number; decay: number; brightness: number; bell: number };
  lock: { stop: StopName; gain: number; brightness: number };
  fire: { stop: StopName; gain: number; wind: number; frequency: number };
};

/**
 * Which stops the player has drawn, section by section. Gains are matched by
 * ear: the mixture and the reed carry far more harmonics than the flute and
 * would bury the arrangement at the flute's numbers.
 */
const SECTION_VOICES: Record<VespersSection, PlayerStops> = {
  nave: {
    kill: { stop: 'flute', gain: 0.30, decay: 0.6, brightness: 3000, bell: 0 },
    lock: { stop: 'flute', gain: 0.13, brightness: 2400 },
    fire: { stop: 'flute', gain: 0.09, wind: 0.05, frequency: 1300 },
  },
  subject: {
    kill: { stop: 'principal', gain: 0.24, decay: 0.52, brightness: 3800, bell: 0 },
    lock: { stop: 'flute', gain: 0.12, brightness: 3000 },
    fire: { stop: 'principal', gain: 0.085, wind: 0.06, frequency: 1800 },
  },
  gallery: {
    kill: { stop: 'mixture', gain: 0.19, decay: 0.44, brightness: 5200, bell: 0.05 },
    lock: { stop: 'principal', gain: 0.085, brightness: 3400 },
    fire: { stop: 'principal', gain: 0.095, wind: 0.075, frequency: 2200 },
  },
  hush: {
    kill: { stop: 'flute', gain: 0.33, decay: 1.05, brightness: 2200, bell: 0.1 },
    lock: { stop: 'flute', gain: 0.11, brightness: 1900 },
    fire: { stop: 'flute', gain: 0.07, wind: 0.04, frequency: 1000 },
  },
  rose: {
    kill: { stop: 'mixture', gain: 0.2, decay: 0.5, brightness: 5600, bell: 0.13 },
    lock: { stop: 'mixture', gain: 0.055, brightness: 3800 },
    fire: { stop: 'principal', gain: 0.1, wind: 0.085, frequency: 2600 },
  },
  tutti: {
    kill: { stop: 'reed', gain: 0.16, decay: 0.62, brightness: 6400, bell: 0.2 },
    lock: { stop: 'reed', gain: 0.048, brightness: 4200 },
    fire: { stop: 'reed', gain: 0.075, wind: 0.09, frequency: 3000 },
  },
};

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-p6bt',
  bpm: VESPERS_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 63,
  createAudio: createVespersAudio,
});

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  /** True from the moment the rose ignites: the harmony turns major with it. */
  let lit = false;
  let litAnchor = -1;
  let heartId = -1;
  let heartMaxHp = 0;

  const score = createScore<Chord, VespersSection>({
    bpm: VESPERS_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: VESPERS_SCORE_SECTIONS,
    killLanes: KILL_LANES,
    leadSet: (chord) => (lit ? LIT_LEAD : [...chord.arp, ...chord.arp.map((midi) => midi + 12)]),
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -20, ratio: 4, attack: 0.008, release: 0.3 },
      // A stone room, and a long one: this is most of the level's sound.
      reverb: { seconds: 3.9, decay: 2.1, level: 0.62, returnTo: 'master' },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      lit = false;
      litAnchor = -1;
      heartId = -1;
      heartMaxHp = 0;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (!context) return;
      // Let the room have the last word either way.
      const chord = lit ? LIT_CHORD : CHORDS[0];
      choir(context.currentTime + 0.05, chord.pad, 5.5, 0.1);
      pedal(context.currentTime + 0.05, chord.bass, 5.5, 0.24);
    },
    onDispose() {
      ctx = null;
    },
  });

  const { pedal, manual, choir, bell, stop, wind, cipher, knock } = createVespersVoices({
    trace,
    context: () => ctx,
    mix: runtime.mix,
  });

  // --- the console ---------------------------------------------------------

  function pedalTrack(gain = 1): ArrangementTrack<Chord> {
    return fn<Chord>(({ position, time, chord }) => {
      if (position % (STEPS_PER_BAR * 2) !== 0) return;
      pedal(time, chord.bass, BAR * 2 * 1.02, 0.3 * gain);
    });
  }

  function choirTrack(gain: number): ArrangementTrack<Chord> {
    return fn<Chord>(({ position, time, chord }) => {
      if (position % (STEPS_PER_BAR * 2) !== 0) return;
      choir(time, chord.pad, BAR * 2 * 0.98, gain);
    });
  }

  function voiceTrack(
    pattern: Array<number | null>,
    stopName: StopName,
    octave: number,
    duration: number,
    gain: number,
  ): ArrangementTrack<Chord> {
    return {
      patternLength: pattern.length,
      run({ barInSection, stepsPerBar, step, time, chord }) {
        const degree = pattern[(barInSection * stepsPerBar + step) % pattern.length];
        if (degree === null) return;
        manual(time, stopName, pitchAt(chord, degree) + octave, duration, gain);
      },
    };
  }

  const tenorTrack = (gain: number) => voiceTrack(SUBJECT, 'principal', 0, EIGHTH * 0.94, gain);
  const altoTrack = (gain: number) => voiceTrack(ANSWER, 'principal', 0, EIGHTH * 1.9, gain);
  const descantTrack = (gain: number) => voiceTrack(DESCANT, 'flute', 12, SIXTEENTH * 0.92, gain);
  const bellTrack = (pattern: string, gain: number) =>
    hits<Chord>(pattern, { B: gain, b: gain * 0.5 }, ({ time, chord }, velocity) => bell(time, chord.bass + 24, velocity));

  const ambient = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'attract',
      fromBar: 0,
      tracks: [
        pedalTrack(0.72),
        voiceTrack(
          [0, n, n, n, n, n, n, n, 2, n, n, n, n, n, n, n, 1, n, n, n, n, n, n, n, 0, n, n, n, n, n, n, n],
          'flute',
          12,
          EIGHTH * 3,
          0.1,
        ),
      ],
    }],
  });

  // Voices enter one at a time over the pedal, everything drops away at the
  // hush, and the ranks come back for the rose.
  const run = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      { name: 'pedal', fromBar: VESPERS_BARS.pedal, toBar: VESPERS_BARS.voice, tracks: [pedalTrack()] },
      { name: 'voice', fromBar: VESPERS_BARS.voice, toBar: VESPERS_BARS.subject, tracks: [pedalTrack(), tenorTrack(0.17)] },
      {
        name: 'subject',
        fromBar: VESPERS_BARS.subject,
        toBar: VESPERS_BARS.choir,
        tracks: [pedalTrack(), tenorTrack(0.17), altoTrack(0.13)],
      },
      {
        name: 'choir',
        fromBar: VESPERS_BARS.choir,
        toBar: VESPERS_BARS.gallery,
        tracks: [pedalTrack(), tenorTrack(0.17), altoTrack(0.14), choirTrack(0.085)],
      },
      {
        name: 'gallery',
        fromBar: VESPERS_BARS.gallery,
        toBar: VESPERS_BARS.hush,
        tracks: [
          pedalTrack(),
          tenorTrack(0.17),
          altoTrack(0.14),
          choirTrack(0.1),
          descantTrack(0.07),
          bellTrack('B...............', 0.12),
        ],
      },
      // The nave goes quiet: the pedal, and one voice on a stopped flute.
      {
        name: 'hush',
        fromBar: VESPERS_BARS.hush,
        toBar: VESPERS_BARS.approach,
        tracks: [pedalTrack(0.62), voiceTrack(SUBJECT, 'flute', 0, EIGHTH * 1.9, 0.115)],
      },
      {
        name: 'approach',
        fromBar: VESPERS_BARS.approach,
        toBar: VESPERS_BARS.rose,
        tracks: [
          pedalTrack(),
          tenorTrack(0.16),
          altoTrack(0.14),
          choirTrack(0.1),
          oneShot<Chord>(0, 0, ({ time, chord }) => bell(time, chord.bass + 24, 0.16)),
        ],
      },
      {
        name: 'rose',
        fromBar: VESPERS_BARS.rose,
        tracks: [
          pedalTrack(1.05),
          tenorTrack(0.17),
          altoTrack(0.15),
          choirTrack(0.11),
          descantTrack(0.075),
          bellTrack('B.......b.......', 0.14),
        ],
      },
    ],
  });

  // Every rank open, the reed speaking for the first time, and D major.
  const tutti = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: () => LIT_CHORD,
    sections: [{
      name: 'tutti',
      fromBar: 0,
      tracks: [
        pedalTrack(1.25),
        choirTrack(0.13),
        voiceTrack(FANFARE, 'reed', 12, EIGHTH * 1.8, 0.13),
        voiceTrack(DESCANT, 'mixture', 12, SIXTEENTH * 0.92, 0.055),
        voiceTrack(ANSWER, 'principal', 0, EIGHTH * 1.9, 0.15),
        bellTrack('B...B...b...b...', 0.16),
      ],
    }],
  });

  function scheduleStep({ position, step, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      ambient.schedule(position, time);
      return;
    }
    // The tutti takes over on the first downbeat after the rose goes up, so
    // the turnover lands on a bar line instead of mid-phrase.
    if (lit && litAnchor < 0 && step === 0) litAnchor = position;
    if (lit && litAnchor >= 0) tutti.schedule(position - litAnchor, time);
    else run.schedule(position, time);
  }

  // --- the player's stops --------------------------------------------------

  function sectionLayers(mix: SectionMix<VespersSection>) {
    return mix.from === mix.to
      ? [[mix.to, 1] as const]
      : [[mix.from, 1 - mix.t] as const, [mix.to, mix.t] as const];
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === heartId) {
      ignite();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const mix = score.sectionMixAt(position);
    const chain = indexInVolley ?? 0;
    // A chained volley crescendos and, from the third note on, doubles at the
    // octave — the same thing an organist does by adding a rank.
    const velocity = Math.min(1.4, 1 + chain * 0.13);
    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const voice = SECTION_VOICES[section].kill;
      stop(kill.time, voice.stop, kill.midi, voice.decay, voice.gain * velocity * weight, voice.brightness);
      if (chain >= 2) {
        stop(kill.time, voice.stop, kill.midi + 12, voice.decay * 0.7, voice.gain * 0.3 * weight, voice.brightness);
      }
      if (voice.bell > 0) bell(kill.time, kill.midi - 24, voice.bell * weight * velocity);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    for (const [section, weight] of sectionLayers(score.sectionMixAt(score.arrangementPositionAt(time)))) {
      if (weight < 0.02) continue;
      const voice = SECTION_VOICES[section].lock;
      stop(time, voice.stop, midi, 0.16, voice.gain * weight, voice.brightness + lockCount * 180);
    }
  });

  // Releasing is the swell shoe opening: wind, then the chord under it.
  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx || (indexInVolley ?? 0) > 0) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = lit ? LIT_CHORD : score.chordAt(position);
    for (const [section, weight] of sectionLayers(score.sectionMixAt(position))) {
      if (weight < 0.02) continue;
      const voice = SECTION_VOICES[section].fire;
      wind(time, voice.wind * weight, 0.12, voice.frequency);
      stop(time, voice.stop, chord.bass + 12, 0.2, voice.gain * weight, voice.frequency * 1.6);
    }
  });

  // Chipping something that does not die yet: lead and stone, in tune.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    if (enemyId === heartId) {
      heartMaxHp = Math.max(heartMaxHp, hitPointsRemaining + 1);
      heartChip(1 - hitPointsRemaining / heartMaxHp);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    stop(time, 'flute', chord.arp[1], 0.14, 0.07, 4200);
    stop(time + SIXTEENTH * 0.5, 'flute', chord.arp[2], 0.12, 0.05, 4600);
    wind(time, 0.035, 0.05, 3600);
  });

  // A clean volley of three or more: the room answers with a bell on the root.
  bus.on('volley', ({ size, kills }) => {
    if (!ctx || kills < 3 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = lit ? LIT_CHORD : score.chordAt(score.arrangementPositionAt(time));
    bell(time, chord.bass + 12, 0.1 + kills * 0.018);
    choir(time, chord.pad.map((midi) => midi + 12), 1.4, 0.05);
  });

  bus.on('reject', () => {
    if (!ctx) return;
    cipher(ctx.currentTime, 0.16);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    knock(ctx.currentTime, 0.4);
  });

  // Something got past: a pane going out, heard as a voice giving up a third.
  bus.on('miss', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    stop(time, 'flute', chord.arp[1] - 12, 0.18, 0.055, 1800);
    stop(time + 0.11, 'flute', chord.arp[0] - 15, 0.3, 0.045, 1400);
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind !== 'rose-heart' || !ctx) return;
    heartId = enemyId;
    score.overrideSection('rose');
    const time = score.nextGridTime(ctx.currentTime, 2);
    // The rose announces itself with the deepest note the instrument has.
    pedal(time, 26, BAR * 1.6, 0.34);
    bell(time, 38, 0.22);
    bell(time + BAR * 0.5, 45, 0.16);
    choir(time, [50, 56, 62, 68], BAR * 1.4, 0.1);
  });

  /** Chips on the heart grow with the damage taken out of it. */
  function heartChip(intensity: number) {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    bell(time, chord.bass + 12, 0.13 + 0.12 * intensity);
    stop(time, 'mixture', chord.arp[0] + 12, 0.3, 0.07 + 0.05 * intensity, 2600 + 3600 * intensity);
    const lead = score.leadSetAt(position);
    stop(
      time,
      'principal',
      lead[Math.min(lead.length - 1, Math.floor(intensity * lead.length))],
      0.45,
      0.05 + 0.05 * intensity,
      4200,
    );
    wind(time, 0.09 + 0.06 * intensity, 0.08, 900);
  }

  /**
   * The killing blow. Everything ducks for a breath, the full organ lands on a
   * D major chord across the whole compass, and the reed — silent all night —
   * answers with a peal falling from the top of its range.
   */
  function ignite() {
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    lit = true;
    score.overrideSection('tutti');
    const time = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(time, 0.25, 2.2);

    pedal(time, 26, 6, 0.4);
    pedal(time, 38, 6, 0.34);
    choir(time, LIT_CHORD.pad, 5.6, 0.16);
    for (const midi of [50, 57, 62, 66, 69, 74]) {
      stop(time, 'reed', midi, 5.2, 0.085, 7000);
    }
    bell(time, 38, 0.32);
    bell(time + BAR * 0.5, 50, 0.24);
    bell(time + BAR, 62, 0.2);
    [98, 93, 90, 86, 81, 78, 74, 69].forEach((midi, index) => {
      stop(time + 0.14 + index * SIXTEENTH, 'reed', midi, 0.7, 0.11 - index * 0.008, 8000);
    });
    wind(time, 0.2, 0.9, 2400);
  }

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'exposed' || !ctx) return;
    // The shell opens: a rising third on the reed's neighbour, still minor.
    const time = score.nextGridTime(ctx.currentTime, 1);
    stop(time, 'mixture', 62, 0.5, 0.12, 5000);
    stop(time + EIGHTH, 'mixture', 65, 0.5, 0.12, 5200);
    stop(time + EIGHTH * 2, 'mixture', 69, 0.9, 0.14, 5600);
    bell(time + EIGHTH * 2, 50, 0.18);
  });

  return runtime;
}

/** A scale degree in the current harmony, wrapping into higher octaves. */
function pitchAt(chord: Chord, index: number) {
  const octave = Math.floor(index / 12);
  return chord.line[index - octave * 12] + 12 * octave;
}
