import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  createStrandlineVoices,
  installStrandlineCurrent,
  type CurrentController,
  type StrandTonalVoice,
} from './audio-voices';
import {
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
} from './timing';

// THE STRANDLINE SCORE — 112 BPM in D, 28 bars = exactly 60 seconds, written as
// an animal waking up. It starts with almost nothing: the water itself, one
// contraction every half bar, and a chord that takes two bars to arrive. Layers
// arrive at each set piece and never leave — sand and shell at the swarm, a
// full plucked line and glass bells in open water, a driving pulse in the dive.
// The crown drops the bright register entirely and hands the strands to a
// groaning two-saw motif, and the clear resolves the whole thing into D major
// with the pulse slowing to a drift.
//
// Underneath all of it, two live beds track the animal: `flow` is the water and
// `glow` is bioluminescence, and the runtime opens `glow` every time you cut a
// parasite off a strand. The last minute is literally brighter because of what
// the player did.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Dm9 — Bbmaj9 — Fmaj9 — G, two bars each: open, modal, unhurried.
const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 60, 65], arp: [62, 65, 69, 72], stab: [62, 65, 69] }, // Dm9
  { bass: 34, pad: [46, 53, 57, 60], arp: [58, 62, 65, 69], stab: [58, 62, 65] }, // Bbmaj9
  { bass: 41, pad: [48, 53, 57, 64], arp: [60, 65, 69, 72], stab: [60, 65, 69] }, // Fmaj9
  { bass: 43, pad: [50, 55, 59, 62], arp: [62, 67, 71, 74], stab: [62, 67, 71] }, // G
];

// The crown: the same key gone wrong. Bb against the D, a raised fourth, and a
// dominant with a flat ninth that never resolves while the parent is alive.
// (Array order compensates for absolute-bar chord indexing.)
const CROWN_CHORDS: Chord[] = [
  { bass: 45, pad: [49, 52, 57, 64], arp: [61, 64, 69, 73], stab: [61, 64, 69] }, // A7b9 (bar 24)
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 70, 74], stab: [62, 65, 70] }, // Dm(b6) (bar 18)
  { bass: 39, pad: [51, 55, 58, 65], arp: [63, 67, 70, 75], stab: [63, 67, 70] }, // Ebmaj7#11 (bar 20)
  { bass: 34, pad: [46, 53, 58, 61], arp: [58, 61, 65, 70], stab: [58, 61, 65] }, // Bbm (bar 22)
];

// The clear: D major, and it stays there.
const CLEAR_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 61, 66], arp: [62, 66, 69, 73], stab: [62, 66, 69] },
];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

// Hidden melody lanes: a chained volley walks these, so a clean six-kill sweep
// performs a phrase instead of firing six identical noises.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Drift: long low arches, the way the water moves.
  0: [
    0, 1, 2, 1, 2, 3, 2, 1,
    2, 3, 4, 3, 2, 1, 2, 3,
    1, 2, 3, 4, 3, 2, 3, 4,
    2, 3, 4, 5, 4, 3, 2, 1,
  ],
  // Swarm: stepwise runs that climb out of the arches.
  1: [
    0, 1, 2, 3, 4, 3, 2, 1,
    2, 3, 4, 5, 4, 3, 2, 3,
    1, 2, 3, 4, 5, 4, 3, 2,
    3, 4, 5, 6, 5, 4, 3, 2,
  ],
  // Open water: wide bright leaps against the bell.
  2: [
    4, 7, 5, 6, 4, 7, 6, 5,
    7, 4, 6, 5, 7, 6, 5, 4,
    5, 7, 4, 6, 5, 7, 6, 4,
    6, 7, 5, 4, 6, 5, 7, 6,
  ],
  // Dive: broken chords, the busiest stretch of the run.
  3: [
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 0, 6, 2, 5, 1, 7, 3,
    2, 6, 0, 4, 3, 7, 1, 5,
    6, 4, 7, 5, 4, 2, 6, 0,
  ],
  // Crown: tolling descents while the parent is still on the animal.
  4: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    6, 5, 4, 3, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
  ],
  // Clear: everything ascends and stays up.
  5: [
    0, 2, 4, 5, 4, 5, 6, 7,
    2, 4, 5, 7, 5, 6, 7, 7,
    4, 5, 6, 7, 6, 7, 7, 7,
    5, 6, 7, 7, 6, 7, 7, 7,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// The player's instrument changes with the water. Deep and muffled at the
// start, glassy and wide open in the middle, dulled to a hull knock at the
// crown, and finally the brightest thing in the level once the colony is off.
const PLAYER_VOICES: Record<SectionIndex, { lock: StrandTonalVoice; kill: StrandTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 1500, gain: 0.13, sparkle: 0.2, reverb: 0.4 },
    kill: { oscillator: 'sine', decay: 0.44, cutoff: 1900, gain: 0.16, sparkle: 0.35, reverb: 0.5 },
    fire: { oscillator: 'sine', cutoff: 1400, gain: 0.06, fallSemitones: 12, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.13, cutoff: 2400, gain: 0.09, sparkle: 0.35, reverb: 0.34 },
    kill: { oscillator: 'triangle', decay: 0.38, cutoff: 2900, gain: 0.12, sparkle: 0.5, reverb: 0.42 },
    fire: { oscillator: 'triangle', cutoff: 2200, gain: 0.055, fallSemitones: 10, noise: 0.038 },
  },
  2: {
    lock: { oscillator: 'sine', decay: 0.14, cutoff: 4600, gain: 0.13, sparkle: 0.75, reverb: 0.46 },
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 5200, gain: 0.16, sparkle: 0.9, reverb: 0.55 },
    fire: { oscillator: 'triangle', cutoff: 3400, gain: 0.05, fallSemitones: 14, noise: 0.03 },
  },
  3: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 3400, gain: 0.085, sparkle: 0.5, reverb: 0.28 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3800, gain: 0.115, sparkle: 0.62, reverb: 0.34 },
    fire: { oscillator: 'square', cutoff: 2600, gain: 0.038, fallSemitones: 9, noise: 0.045 },
  },
  4: {
    // Under the crown the water is thick with rot: everything you do comes back
    // dull and close, with a long tail behind it.
    lock: { oscillator: 'sine', decay: 0.17, cutoff: 1300, gain: 0.12, sparkle: 0.14, reverb: 0.58 },
    kill: { oscillator: 'sine', decay: 0.52, cutoff: 1600, gain: 0.16, sparkle: 0.25, reverb: 0.66 },
    fire: { oscillator: 'square', cutoff: 1200, gain: 0.04, fallSemitones: 15, noise: 0.02 },
  },
  5: {
    lock: { oscillator: 'sine', decay: 0.22, cutoff: 5000, gain: 0.11, sparkle: 0.8, reverb: 0.7 },
    kill: { oscillator: 'sine', decay: 0.7, cutoff: 5600, gain: 0.14, sparkle: 0.95, reverb: 0.78 },
    fire: { oscillator: 'sine', cutoff: 3000, gain: 0.035, fallSemitones: 7, noise: 0.012 },
  },
};

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-s3vn',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: STRANDLINE_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let current: CurrentController | null = null;
  let parentId = -1;
  let cleared = 0;
  const PARENT_TOTAL_HP = 6; // hitStages [2, 2, 2]

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.clear, chords: CROWN_CHORDS, barsPerChord: 2 },
      { fromBar: STRANDLINE_BARS.clear, chords: CLEAR_CHORDS, barsPerChord: 1 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.82,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -17, ratio: 4.2, attack: 0.006, release: 0.26 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2000 },
      reverb: { seconds: 3.6, decay: 2.4, level: 0.62 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      current = installStrandlineCurrent(context, mix);
      current.setFlow(context.currentTime + 0.1, 0.24, 2.5);
      current.setGlow(context.currentTime + 0.1, 0.006, 3);
    },
    onStep: scheduleStep,
    onRunStart() {
      parentId = -1;
      cleared = 0;
      const context = runtime.context();
      if (context && current) {
        current.setFlow(context.currentTime + 0.05, 0.34, 1.6);
        current.setGlow(context.currentTime + 0.05, 0.004, 1.2);
      }
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      current?.setFlow(context.currentTime + 0.4, 0.18, 5);
      pad(context.currentTime + 0.05, CLEAR_CHORDS[0].pad.concat([73]), 7, 0.8, 3, 2400);
    },
    onDispose() {
      ctx = null;
      current = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement -----------------------------------------------------------

  const blank = '................';
  const halfPulse = 'C.......C.......';
  const quarterPulse = 'C...C...C...C...';
  const crownPulse = 'C.......C...C...';
  const shellBack = '....G.......G...';
  const shrimp = '..t...t...t...t.';
  const shrimp16 = 't.t.t.t.t.t.t.t.';
  const shrimp332 = 't..t..t.t..t..t.';
  const evenPluck = 'A.A.A.A.A.A.A.A.';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const barIndex = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(barIndex / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.08, 0.5, 2, 900)),
          hits('C...............C...............', { C: 0.45 }, ({ time }, vel) => contraction(time, vel)),
          fn(({ time, step, bar, chord }) => {
            if (bar % 2 === 1 && step === 8) glass(time, chord.arp[3], 0.26);
          }),
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
        // Drift: almost nothing. Water, one chord, and the animal's heartbeat.
        name: 'drift',
        fromBar: STRANDLINE_BARS.drift,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.72, 2, 1050)),
          hits(halfPulse, { C: 0.62 }, ({ time }, vel) => contraction(time, vel)),
          hits('B...............', { B: 0.7 }, ({ time, chord }, vel) => sub(time, chord.bass, vel, 1.5)),
          hits([blank, '.....t.......t..'].join(''), { t: 0.3 }, ({ time }, vel) => tick(time, vel)),
          fn(({ time, step, bar, chord }) => {
            if (bar % 2 === 1 && step === 10) glass(time, chord.arp[2] + 12, 0.24);
            if (bar === 2 && step === 4) bubble(time, chord.arp[0] + 12, 0.5);
          }),
          oneShot(3, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.1)),
        ],
      },
      {
        // Swarm: the colony announces itself. Sand, shell, and a plucked line.
        name: 'swarm',
        fromBar: STRANDLINE_BARS.swarm,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            wash(time, 0.28);
            flowTo(time, 0.42, 2.5);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.85, 3, 1350)),
          hits(halfPulse, { C: 0.78 }, ({ time }, vel) => contraction(time, vel)),
          hits([blank, shellBack].join(''), { G: 0.55 }, ({ time }, vel) => grit(time, vel)),
          hits(shrimp, { t: 0.4 }, ({ time }, vel) => tick(time, vel)),
          hits('B.......b...B...', { B: 0.75, b: 0.5 }, ({ time, chord }, vel) => sub(time, chord.bass, vel, 0.5)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection < 1) return;
            if (step % 4 !== 0) return;
            pluck(time, chord.arp[(step / 4) % chord.arp.length], 0.5 + barInSection * 0.06, 1500 + barInSection * 260);
          }),
          fn(({ time, step, bar, chord }) => {
            if (bar % 2 === 0 && step === 12) glass(time, chord.arp[1] + 12, 0.28);
          }),
          oneShot(4, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.14)),
        ],
      },
      {
        // Open water. The bell arrives; so does everything bright in the score.
        name: 'open',
        fromBar: STRANDLINE_BARS.open,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            wash(time, 0.55);
            impact(time, 0.7);
            sub(time, chord.bass - 12, 0.9, 2.4);
            flowTo(time, 0.2, 3);
          }),
          oneShot(0, 8, ({ time, chord }) => chime(time, chord.arp[3] + 12, 3.4, 0.55)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 1.0, 4, 2400)),
          hits(halfPulse, { C: 0.7 }, ({ time }, vel) => contraction(time, vel)),
          hits(shrimp332, { t: 0.42 }, ({ time }, vel) => tick(time, vel)),
          hits([blank, shellBack].join(''), { G: 0.42 }, ({ time }, vel) => grit(time, vel)),
          hits('B.......B...b...', { B: 0.72, b: 0.45 }, ({ time, chord }, vel) => sub(time, chord.bass, vel, 0.6)),
          hits(evenPluck, { A: 0.55 }, ({ time, step, chord }, vel) => {
            const order = [0, 2, 3, 1, 2, 0, 3, 2];
            pluck(time, chord.arp[order[(step / 2) % order.length]] + 12, vel, 3400);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0) glass(time, chord.arp[(barInSection + 1) % chord.arp.length] + 12, 0.34);
            if (step === 8 && barInSection % 2 === 1) glass(time, chord.arp[2] + 24, 0.22);
          }),
          oneShot(3, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.13)),
        ],
      },
      {
        // Dive: back into the strands, and the pulse doubles.
        name: 'dive',
        fromBar: STRANDLINE_BARS.dive,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 0.85);
            wash(time, 0.3);
            flowTo(time, 0.4, 2);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.03, 0.85, 3, 1700)),
          hits(quarterPulse, { C: 0.72 }, ({ time }, vel) => contraction(time, vel)),
          hits(shellBack, { G: 0.62 }, ({ time }, vel) => grit(time, vel)),
          hits(shrimp16, { t: 0.3 }, ({ time }, vel) => tick(time, vel)),
          fn(({ time, step, chord }) => {
            const steps: Record<number, [number, number]> = {
              0: [0, 1], 3: [0, 0.65], 6: [12, 0.5], 8: [0, 0.85], 11: [7, 0.55], 14: [12, 0.6],
            };
            const value = steps[step];
            if (value) sub(time, chord.bass + value[0], value[1], 0.35);
          }),
          hits(evenPluck, { A: 0.6 }, ({ time, step, chord }, vel) => {
            const order = [0, 3, 1, 2, 3, 0, 2, 1];
            pluck(time, chord.arp[order[(step / 2) % order.length]], vel, 2600);
          }),
          fn(({ time, step, bar, chord }) => {
            if (step === 4 && bar % 2 === 0) bubble(time, chord.arp[0] + 12, 0.4);
          }),
          oneShot(4, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.18)),
        ],
      },
      {
        // The crown. The bright register is emptied out so the player's own
        // notes are the only light in the mix.
        name: 'crown',
        fromBar: STRANDLINE_BARS.crown,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.15);
            wash(time, 0.4);
            groan(time, chord.bass - 12, 4.2, 1);
            flowTo(time, 0.55, 1.5);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.8, 2, 760)),
          hits(crownPulse, { C: 0.85 }, ({ time }, vel) => contraction(time, vel)),
          hits(shrimp332, { t: 0.34 }, ({ time }, vel) => tick(time, vel)),
          hits('B...............', { B: 0.85 }, ({ time, chord }, vel) => sub(time, chord.bass, vel, 1.1)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0 && barInSection % 2 === 0) groan(time, chord.bass + 12, 32 * SIXTEENTH * 0.94, 0.8);
            if (step === 6 || step === 14) stab(time, chord.stab, 0.5 + (step === 14 ? 0.15 : 0));
          }),
          fn(({ time, step, barInSection }) => {
            // The last two bars before the rail leaves: the toll speeds up.
            if (barInSection >= 5 && step % 4 === 2) tick(time, 0.5 + barInSection * 0.04);
            if (barInSection >= 6 && step % 8 === 4) grit(time, 0.4);
          }),
        ],
      },
      {
        // Clear. Everything sour is gone; the pulse slows into a drift.
        name: 'clear',
        fromBar: STRANDLINE_BARS.clear,
        toBar: STRANDLINE_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            wash(time, 0.7);
            pad(time, chord.pad.concat([73]), 48 * SIXTEENTH, 1.0, 4, 3200);
            sub(time, chord.bass - 12, 0.9, 3.2);
            flowTo(time, 0.16, 4);
            glowTo(time, 0.05, 3.5);
          }),
          hits('C...............', { C: 0.6 }, ({ time }, vel) => contraction(time, vel)),
          oneShot(0, 6, ({ time, chord }) => glass(time, chord.arp[1] + 12, 0.4)),
          oneShot(0, 12, ({ time, chord }) => glass(time, chord.arp[2] + 12, 0.36)),
          oneShot(1, 2, ({ time, chord }) => glass(time, chord.arp[3] + 12, 0.34)),
          oneShot(1, 8, ({ time, chord }) => chime(time, chord.arp[3] + 24, 3.6, 0.5)),
          oneShot(2, 0, ({ time, chord }) => {
            chime(time, chord.arp[0] + 24, 5.2, 0.42);
            sub(time, chord.bass, 0.55, 4.4);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection >= 1 && step % 6 === 0) tick(time, 0.16);
          }),
        ],
      },
    ],
  });

  function flowTo(time: number, level: number, ramp: number) {
    current?.setFlow(time, level, ramp);
  }

  function glowTo(time: number, level: number, ramp: number) {
    current?.setGlow(time, level, ramp);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ------------------------------------------------------------------

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    contraction, grit, tick, bubble, sub, pad, pluck, glass, chime, groan, stab, riser, wash, impact,
    noiseHit, playerSends, playerTone, playerNoise,
  } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.55 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.85 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.28 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBedVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.2 }],
    duration: 0.24,
    stopPadding: 0.05,
    envelope: { attack: 0.01, decay: 0.24 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: 0.005, decay: 0.11 },
  });

  // Chitin: a dull knock on something that does not want to break.
  const knockVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 1600, Q: 1.6 },
    envelope: { decay: 0.11 },
  });

  const shearVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.7,
    stopPadding: 0.07,
    envelope: { attack: 0.01, decay: 0.7 },
  });

  // Rejection: the webbing eating a volley. A dead, damped thud with no tail.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 420, Q: 4 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const stungVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.42 }],
    duration: 0.6,
    stopPadding: 0.05,
    envelope: { decay: 0.6 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.16,
    stopPadding: 0.03,
    envelope: { decay: 0.16 },
  });

  const alarmVoice = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.05 }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 1100, Q: 2 },
    envelope: { attack: 0.02, decay: 0.3 },
  });

  const tearVoice = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.1 }],
    duration: 1.2,
    stopPadding: 0.08,
    filter: { type: 'bandpass', Q: 1.8, frequency: 900 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.1, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.2 },
    ],
  });

  // ---- player instruments ---------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof StrandTonalVoice) {
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
    const vel = Math.min(1.5, 1 + chain * 0.15);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.4, 0.3) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.015 + sparkle * 0.04, 0.07, 6800);
  }

  // Every strand you free opens the shimmer bed a little further. This is the
  // "brightness and layers" of the theme, and the player is the one adding it.
  function raiseGlow() {
    cleared += 1;
    const context = runtime.context();
    if (!context || !current) return;
    current.setGlow(context.currentTime + 0.02, Math.min(0.05, 0.004 + cleared * 0.0011), 1.4);
  }

  // The parent audibly loses: each bite is brighter, higher, and more strained.
  function parentBite(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    tearVoice.play({
      context: ctx,
      time,
      frequency: midiToFreq(chord.bass + 24) * (0.9 + intensity * 0.8),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12) * (1 + intensity), time: time + 0.6 }],
      destination: output,
      sends: playerSends(0.2, 0.5),
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon, PLAYER_VOICES[4].kill, 0.55 + intensity * 0.45, 1);
    playerNoise(time, 0.06 + intensity * 0.08, 0.1, 3400);
  }

  // Killing blow: duck the water, tear it loose, and let the animal answer with
  // its own chord walking up out of the dark.
  function parentFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.1, 1.8);
    impact(time, 1.3);
    tearVoice.play({
      context: ctx,
      time: time + 0.04,
      frequency: 1600,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 90, time: time + 1.0 }],
      destination: output,
      sends: playerSends(0.3, 0.6),
    });
    sub(time + 0.02, chord.bass - 12, 1, 2.6);
    CLEAR_CHORDS[0].arp.concat(CLEAR_CHORDS[0].arp.map((midi) => midi + 12)).forEach((midi, index) => {
      playerTone(time + 0.12 + index * SIXTEENTH, midi, PLAYER_VOICES[5].kill, 0.8 - index * 0.05, 1);
    });
    chime(time + 0.12 + 8 * SIXTEENTH, CLEAR_CHORDS[0].arp[3] + 12, 3.2, 0.5);
    glowTo(time, 0.05, 1.2);
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
    playerNoise(time, 0.01 + sparkle * 0.026, 0.02, 8200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      lockBedVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.18 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.28, 1);
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.09 }],
        destination: output,
        sends: playerSends(0.18, 0.14),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.03, 3800);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === parentId) {
      parentBite(time, 1 - hitPointsRemaining / PARENT_TOTAL_HP);
      return;
    }
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      knockVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi - 12,
        gainValue: 0.055 - index * 0.011,
        destination: output,
        sends: playerSends(0.14, 0.2),
      });
    }
    playerNoise(time, 0.03, 0.028, 4200);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // A shell coming off in the water.
    noiseHit(time, 0.2, 0.2, 'bandpass', 1500, output);
    for (const midi of [chord.bass + 12, chord.stab[1]]) {
      shearVoice.play({ context: ctx, time, midi, gainValue: 0.11, destination: output, sends: playerSends(0.2, 0.55) });
    }
    if (enemyId === parentId) {
      riser(time, 1.6, 0.14);
      sub(time + 0.05, chord.bass - 12, 0.85, 1.4);
      groan(time + 0.1, chord.bass + 12, 2.0, 0.9);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === parentId) {
      parentFinale(kill.time);
      return;
    }
    raiseGlow();
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const mix = score.sectionMixAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[mix.to].kill, (size >= 6 ? 0.72 : 0.55) - index * 0.06, 1);
    });
    if (size >= 6) {
      sub(time, score.chordAt(position).bass, 0.6, 0.8);
      glass(time + 4 * THIRTYSECOND, leadSet[7] + 12, 0.35);
    }
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[124, time, 0.16], [117, time + 0.1, 0.12]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.6, time: at + 0.2 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.12, 0.12, 'lowpass', 420, output);
  });

  bus.on('shielded', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // The webbing swallowing a volley: a wet slap and nothing else.
    noiseHit(ctx.currentTime, 0.16, 0.16, 'bandpass', 700, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    stungVoice.play({
      context: ctx,
      time,
      midi: chord.bass,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass - 12), time: time + 0.4 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2], chord.stab[2] - 1].forEach((midi, index) => {
      alarmVoice.play({ context, time: time + 0.14 + index * 0.16, midi, destination: output, sends: playerSends(0.1, 0.2) });
    });
    noiseHit(time, 0.2, 0.25, 'lowpass', 700, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.14 }],
      destination: output,
      sends: playerSends(0.06, 0.1),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    const output = sfxDestination();
    if (!output) return;
    if (kind === 'parent') {
      parentId = enemyId;
      // Heard before it is seen: the whole water column leans on you.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      runtime.mix()?.duckAt(time, 0.4, 1.2);
      impact(time, 1.2);
      groan(time + 0.05, 26, 3.0, 1.1);
      riser(time + 0.1, 2.2, 0.16);
    } else if (kind === 'stinger') {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      const context = ctx;
      [leadSet[3], leadSet[1]].forEach((midi, index) => {
        alarmVoice.play({ context, time: time + index * SIXTEENTH, midi: midi - 24, destination: output, sends: playerSends(0.1, 0.16) });
      });
    } else if (kind === 'chewer') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      groan(time, 38, 1.8, 0.55);
    } else if (kind === 'brood') {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      noiseHit(time, 0.1, 0.09, 'bandpass', 2400, output);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    const output = sfxDestination();
    if (!output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    if (phase === 'exposed') {
      // The lattice starves: a window opens in the mix as well as on screen.
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      [0, 2, 4].forEach((degree, index) => {
        playerTone(time + index * THIRTYSECOND * 2, leadSet[degree] + 12, PLAYER_VOICES[4].kill, 0.5, 1);
      });
      runtime.mix()?.duckAt(time, 0.7, 0.6);
    } else if (phase === 'summoned') {
      groan(time, 33, 1.4, 0.85);
      noiseHit(time, 0.16, 0.3, 'bandpass', 1100, output);
    }
  });

  return runtime;
}
