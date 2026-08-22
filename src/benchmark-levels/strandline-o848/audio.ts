import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { installStrandlineDeep, createStrandlineVoices, type StrandlineTonalVoice } from './audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import {
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
} from './timing';

// The Strandline score: 96 BPM, 24 bars = exactly 60 seconds. It starts as
// slow sunlit drift — pad and glassy bells over the animal's pulse — and gains
// brightness and layers as more of the jelly comes back to life: open water
// brings the arps and the pulse forward, the dive back adds rhythm, the parent
// fight gets its own dark theme, and the clean-water resolution lands on a D
// major bloom. Player actions are notes in the score: locks, shots, kills, and
// boss damage all snap to the transport and read the live harmony; kills walk
// hidden sequencer lanes so a chained volley performs a melodic run.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[] };

// Drift/open/return: Dm9 — Bbmaj7 — Fmaj9 — Cadd9, two bars each. The loop
// climbs: each stop is a little brighter than the last.
const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 53, 57, 60], arp: [62, 65, 69, 72] }, // Dm9
  { bass: 46, pad: [46, 50, 53, 57], arp: [58, 62, 65, 69] }, // Bbmaj7
  { bass: 41, pad: [45, 48, 52, 57], arp: [57, 60, 64, 69] }, // Fmaj9
  { bass: 36, pad: [48, 52, 55, 59], arp: [60, 64, 67, 71] }, // Cadd9
];

// Parent section: Dm — Gm — Bb — A. The A major is the sting.
const PARENT_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 43, pad: [46, 50, 53, 58], arp: [58, 62, 67, 70] }, // Gm7
  CHORDS[1],
  { bass: 45, pad: [45, 49, 52, 57], arp: [57, 61, 64, 69] }, // A
];

// Clean water: the whole progression resolves into one D major glow.
const SERENE_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 54, 57, 62], arp: [66, 69, 74, 78] }, // D major
];

type SectionIndex = 'drift' | 'open' | 'return' | 'parent' | 'serene';

// Kill lanes: two bars of degrees into the live lead set per section. Kills
// play these notes in sequence, so volleys perform runs.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Drift: slow glassy arches, lots of air.
  drift: [
    0, 2, 4, 2, 3, 5, 3, 1,
    2, 4, 6, 4, 5, 7, 5, 3,
    4, 6, 7, 6, 5, 3, 4, 2,
    3, 5, 4, 2, 1, 2, 0, 2,
  ],
  // Open water: bright climbing figures.
  open: [
    0, 2, 4, 6, 2, 4, 6, 7,
    4, 6, 7, 6, 5, 7, 6, 4,
    2, 4, 5, 7, 4, 6, 5, 3,
    4, 5, 6, 7, 6, 7, 5, 4,
  ],
  // Return: weaving triplets that circle the tonic.
  return: [
    0, 4, 2, 6, 1, 5, 3, 7,
    2, 6, 4, 7, 3, 6, 4, 2,
    0, 5, 2, 7, 4, 6, 3, 5,
    2, 4, 6, 5, 7, 5, 4, 2,
  ],
  // Parent: tolling descents answered by stabs at the sting note.
  parent: [
    7, 5, 4, 2, 5, 3, 2, 0,
    6, 4, 3, 1, 4, 2, 1, 0,
    5, 3, 2, 0, 4, 2, 1, 0,
    3, 4, 5, 6, 7, 6, 5, 4,
  ],
  // Serene: a gentle bell cascade.
  serene: [
    0, 2, 4, 7, 4, 2, 0, 2,
    4, 7, 6, 4, 2, 4, 6, 7,
  ],
};

// Player timbres per section — brighter sections get brighter voices.
const PLAYER_VOICES: Record<SectionIndex, { lock: StrandlineTonalVoice; kill: StrandlineTonalVoice }> = {
  drift: {
    lock: { oscillator: 'sine', decay: 0.14, cutoff: 3200, gain: 0.13, sparkle: 0.45, reverb: 0.22 },
    kill: { oscillator: 'sine', decay: 0.34, cutoff: 3000, gain: 0.16, sparkle: 0.65, reverb: 0.34 },
  },
  open: {
    lock: { oscillator: 'triangle', decay: 0.11, cutoff: 3800, gain: 0.10, sparkle: 0.5, reverb: 0.18 },
    kill: { oscillator: 'triangle', decay: 0.28, cutoff: 3600, gain: 0.14, sparkle: 0.75, reverb: 0.26 },
  },
  return: {
    lock: { oscillator: 'triangle', decay: 0.09, cutoff: 4200, gain: 0.085, sparkle: 0.42, reverb: 0.15 },
    kill: { oscillator: 'square', decay: 0.2, cutoff: 3400, gain: 0.095, sparkle: 0.6, reverb: 0.22 },
  },
  parent: {
    lock: { oscillator: 'sawtooth', decay: 0.12, cutoff: 2400, gain: 0.055, sparkle: 0.3, reverb: 0.24 },
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 3000, gain: 0.11, sparkle: 0.55, reverb: 0.36 },
  },
  serene: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 3400, gain: 0.13, sparkle: 0.5, reverb: 0.3 },
    kill: { oscillator: 'sine', decay: 0.4, cutoff: 3200, gain: 0.15, sparkle: 0.7, reverb: 0.4 },
  },
};

// Boss lead theme: one slow 8-bar phrase, minor with the A-major sting at the
// end of the second half. [bar, step(8ths), midi, beats]
const LEAD_THEME: Array<[number, number, number, number]> = [
  [0, 0, 62, 3], [0, 6, 65, 1], [0, 7, 67, 1],
  [1, 0, 70, 4],
  [2, 0, 69, 2], [2, 4, 67, 1], [2, 6, 65, 1],
  [3, 0, 62, 4],
  [4, 0, 65, 2], [4, 4, 67, 1], [4, 6, 69, 1],
  [5, 0, 70, 2], [5, 4, 69, 1], [5, 6, 67, 1],
  [6, 0, 65, 3], [6, 6, 63, 1],
  [7, 0, 62, 5],
];

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-o848',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: STRANDLINE_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let parentId = -1;

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: STRANDLINE_BARS.parentFight, toBar: STRANDLINE_BARS.cleanWater, chords: PARENT_CHORDS, barsPerChord: 1 },
      { fromBar: STRANDLINE_BARS.cleanWater, toBar: STRANDLINE_BARS.end, chords: SERENE_CHORDS, barsPerChord: 2 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'bar',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.006, release: 0.26 },
      delay: { time: SIXTEENTH * 3, feedback: 0.38, dampHz: 1900 },
      reverb: { seconds: 3.4, decay: 2.2, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      installStrandlineDeep(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      parentId = -1;
    },
    onRunEnd() {
      const context = runtime.context();
      const mix = runtime.mix();
      if (!context || !mix?.duck) return;
      // The last thing you hear: the animal's pulse settling, once, warm.
      instruments.pad(context.currentTime + 0.05, [50, 54, 57, 62, 66], 8, 1);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler ------------------------------------------------------------

  const blankBar = '................';
  const softPulse = 'P.......P.......';
  const evenArp = 'A.A.A.A.A.A.A.A.';
  const beatBell = 'B......b........';
  const sparseTicks = 'h...h...h..h.h..';

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
          hits('C...............................', { C: 1 }, ({ time, chord }) => instruments.pad(time, chord.pad, 32 * SIXTEENTH, 0.8)),
          hits(beatBell, { B: 0.5, b: 0.3 }, ({ time, step, chord }) => instruments.bell(time + (step >= 7 ? SIXTEENTH : 0), chord.arp[(step / 7) % chord.arp.length] + 12, 0.6)),
        ],
      },
    ],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    emitSections: true,
    sections: [
      {
        name: 'drift',
        fromBar: STRANDLINE_BARS.drift,
        tracks: [
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => instruments.pad(time, chord.pad, 64 * SIXTEENTH, 0.75)),
          hits(softPulse, { P: 0.55 }, ({ time }, vel) => instruments.pulse(time, vel)),
          hits(beatBell, { B: 0.55, b: 0.35 }, ({ time, step, chord }) => instruments.bell(time + (step >= 7 ? SIXTEENTH : 0), chord.arp[(step / 7) % chord.arp.length] + 12, 0.8)),
          hits([blankBar, blankBar, blankBar, blankBar, blankBar, blankBar, '....w.......w...', '................'].join(''), { w: 0.5 }, ({ time }, vel) => instruments.wash(time, vel, 0.5)),
          oneShot(6, 0, ({ time }) => instruments.riser(time, 16 * SIXTEENTH, 0.16)),
        ],
      },
      {
        name: 'open',
        fromBar: STRANDLINE_BARS.bellReveal,
        tracks: [
          oneShot(0, 0, ({ time }) => instruments.bloom(time, 1)),
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => instruments.pad(time, chord.pad, 64 * SIXTEENTH, 0.85)),
          hits('K...K...K...K...', { K: 0.7 }, ({ time }, vel) => instruments.pulse(time, vel)),
          hits('B.......B.......', { B: 0.75 }, ({ time, chord }, vel) => instruments.sub(time, chord.bass, vel)),
          hits(evenArp, { A: 0.5 }, ({ time, step, bar, chord }) => instruments.arp(time, chord.arp[(step / 2) % chord.arp.length], 0.5 + Math.min(0.3, bar * 0.04))),
          hits(beatBell, { B: 0.6, b: 0.4 }, ({ time, step, chord }) => instruments.bell(time + (step >= 7 ? SIXTEENTH : 0), chord.arp[(step / 7) % chord.arp.length] + 12, 0.9)),
        ],
      },
      {
        name: 'return',
        fromBar: STRANDLINE_BARS.diveBack,
        tracks: [
          hits('K...K..K..K.....', { K: 0.85 }, ({ time }, vel) => instruments.pulse(time, vel)),
          hits('....S.......S...', { S: 0.6 }, ({ time }, vel) => instruments.wash(time, vel, 0.22)),
          hits(sparseTicks, { h: 0.03 }, ({ time }, vel) => instruments.tick(time, vel)),
          hits('B.....B...B.B...B.....B...B...B.', { B: 0.7 }, ({ time, chord, step }, vel) => instruments.sub(time, chord.bass + (step % 8 === 6 ? 12 : 0), vel)),
          hits(evenArp, { A: 0.6 }, ({ time, step, chord }) => instruments.arp(time, chord.arp[(step / 2) % chord.arp.length], 0.75)),
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => instruments.pad(time, chord.pad, 64 * SIXTEENTH, 0.8)),
          hits('S...............', { S: 0.5 }, ({ time, chord }, vel) => instruments.stab(time, chord.pad.slice(1), vel)),
          oneShot(2, 0, ({ time }) => instruments.riser(time, 32 * SIXTEENTH, 0.18)),
        ],
      },
      {
        name: 'parent',
        fromBar: STRANDLINE_BARS.parentFight,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            instruments.impact(time, 1.2);
            instruments.wash(time, 1, 0.8);
          }),
          hits('K...K..K..K...K.', { K: 0.95 }, ({ time }, vel) => instruments.pulse(time, vel)),
          hits('....S.......S..s', { S: 0.75, s: 0.45 }, ({ time }, vel) => instruments.wash(time, vel, 0.2)),
          hits(sparseTicks, { h: 0.04 }, ({ time }, vel) => instruments.tick(time, vel)),
          fn(({ time, step, bar, chord }) => {
            const pattern = (bar - STRANDLINE_BARS.parentFight) % 2 === 0
              ? 'B..B..B.B..B..B.'
              : 'B..B..B.B..B.B..';
            if (pattern[step] === 'B') instruments.sub(time, chord.bass + (step === 13 ? 3 : 0), 0.85);
          }),
          hits(evenArp, { A: 0.55 }, ({ time, step, chord }) => instruments.arp(time, chord.arp[(step / 2) % chord.arp.length], 0.7)),
          fn(({ time, step, bar, chord }) => {
            const themeBar = (bar - STRANDLINE_BARS.parentFight) % 8;
            if (step % 2 !== 0) return;
            for (const [noteBar, noteStep, midi, beats] of LEAD_THEME) {
              if (noteBar === themeBar && noteStep === step / 2) instruments.lead(time, midi, beats * 4 * SIXTEENTH, 0.9);
            }
            void chord;
          }),
          oneShot(4, 8, ({ time }) => instruments.riser(time, 16 * SIXTEENTH, 0.14)),
        ],
      },
      {
        name: 'serene',
        fromBar: STRANDLINE_BARS.cleanWater,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            instruments.bloom(time, 0.9);
            instruments.pad(time, [...chord.pad, ...chord.arp.slice(0, 2)], 48 * SIXTEENTH, 1.1);
          }),
          hits(softPulse, { P: 0.4 }, ({ time }, vel) => instruments.pulse(time, vel)),
          hits('b...b...b...b...', { b: 0.4 }, ({ time, step, chord }, vel) => instruments.bell(time, chord.arp[(step / 4) % chord.arp.length] + 12, vel)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices -----------------------------------------------------------------

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: runtime.mix });
  const instruments = voices;

  // ---- player instruments -----------------------------------------------------
  // Every positive action snaps to the transport and reads the live harmony.

  function playerTone(time: number, midi: number, timbre: StrandlineTonalVoice, vel: number, weight = 1) {
    voices.playerTone(time, midi, timbre, vel, weight);
  }

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof StrandlineTonalVoice) {
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
    const vel = Math.min(1.4, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    if (chain >= 2) playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[laneSection].kill, 0.5, 1);
    voices.playerNoise(time, 0.02 + (mixedVoiceValue(mix, 'kill', 'sparkle') as number) * 0.04, 0.08, 6800);
  }

  function parentChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.55,
      oscillatorType: 'sine',
      frequency: root * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.16 }],
      gainAutomation: [
        { type: 'set', value: 0.22 + intensity * 0.16, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
      ],
      destination: output,
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES.parent.kill, 0.4 + intensity * 0.35, 1);
    voices.playerNoise(time, 0.09 + intensity * 0.07, 0.1, 4800);
  }

  function parentFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    audioMix.duckAt(time, 0.12, 1.8);
    instruments.impact(time, 1.3);
    // Resolution: the serene D major chord arrives early, then bells.
    instruments.pad(time + 0.1, [50, 54, 57, 62, 66], 40 * SIXTEENTH, 1.15);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      const at = time + index * THIRTYSECOND;
      playerTone(at, midi + 12, PLAYER_VOICES.serene.kill, 0.8 - index * 0.06, 1);
    });
  }

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
    voices.playerNoise(time, 0.014 + (mixedVoiceValue(mix, 'lock', 'sparkle') as number) * 0.03, 0.025, 8200);
    if (lockCount >= 6 && sfxDestination()) {
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      voices.sub(time, score.chordAt(position).bass + 12, 0.5);
    }
  });

  bus.on('unlock', () => {
    if (!ctx || !sfxDestination()) return;
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
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.09,
      oscillatorType: 'sine',
      frequency: midiToFreq(sourceMidi),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - 12), time: time + 0.07 }],
      filter: { type: 'lowpass', frequency: 4200 },
      gainAutomation: [
        { type: 'set', value: 0.075, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
      ],
      destination: output,
      sends: voices.playerSends(0.22, 0.08),
    });
    voices.playerNoise(time, 0.03, 0.024, 5200);
  });

  bus.on('hit', ({ lethal, enemyId }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === parentId) {
      parentChip(time, 0.5);
      return;
    }
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    for (const [index, midi] of chord.pad.entries()) {
      playerTone(time + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.5 - index * 0.07, 1);
    }
    voices.playerNoise(time, 0.04, 0.03, 6000);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output || !runtime.mix()?.reverbSend) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    if (enemyId === parentId) {
      // The parent recoils — brace.
      instruments.riser(time, 1.6, 0.16);
      voices.wash(time, 0.8, 0.7);
      return;
    }
    // A web panel tears loose: wet rip + deep release.
    voices.wash(time, 0.9, 0.35);
    voices.sub(time, score.chordAt(score.arrangementPositionAt(time)).bass, 0.9);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === parentId) {
      parentFinale(score.nextKill(ctx.currentTime).time);
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.55 - index * 0.05, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Rejection: a sour violet squelch — the infestation answering you.
    for (const [frequency, detune] of [[196, 0], [208, 14]] as const) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.22,
        oscillatorType: 'sawtooth',
        frequency,
        detune,
        filter: { type: 'bandpass', Q: 3, frequency: 700 },
        gainAutomation: [
          { type: 'set', value: 0.09, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
        ],
        destination: output,
      });
    }
    voices.noiseHit(time, 0.12, 0.1, 'bandpass', 500, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: midiToFreq(chord.bass + 12),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.34 }],
      gainAutomation: [
        { type: 'set', value: 0.4, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
      ],
      destination: output,
    });
    voices.noiseHit(time, 0.18, 0.16, 'bandpass', 750, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'sine',
      frequency: midiToFreq(chord.bass + 24),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.045, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
      ],
      destination: output,
      sends: voices.playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'parent') {
      parentId = enemyId;
      // The parent reveals itself: a long alarm swell out of the deep.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      instruments.riser(time, 2.4, 0.18);
      instruments.alarm(time, 44, 2.4);
    } else if (kind === 'broodling') {
      // Fresh brood: a short upward warning blip voiced from the live arp.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const position = score.arrangementPositionAt(time);
      const leadSet = score.leadSetAt(position);
      instruments.alarm(time, leadSet[enemyId % 4], 0.5);
    } else if (kind === 'nettle') {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      voices.tick(time, 0.09, 0.12);
    }
  });

  return runtime;
}
