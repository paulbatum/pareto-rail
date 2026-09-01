import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createStrandlineVoices, installStrandlineWater, type StrandTonalVoice, type WaterController } from './audio-voices';
import { BROOD_SIZE } from './parent';
import { STRANDLINE_BARS, STRANDLINE_BPM, STRANDLINE_DURATION, STRANDLINE_SCORE_SECTIONS, STRANDLINE_STEPS_PER_BAR, STRANDLINE_TIME } from './timing';

// The Strandline score: 96 BPM in E major, 24 bars = exactly the 60-second
// run, and the arrangement is the animal coming back to life. It opens with
// almost nothing — the bell's slow pulse, one soft pad, a bell tone every other
// bar, water — and gains a layer each act: a kick and a click in the forest, a
// swell and a chime peal when the bell fills the view, the full groove for the
// dive. The crown act turns sour (Em9 – Cmaj9 – Fmaj7#11 under a drone), and
// every brood the player clears restores a layer of the arrangement; tearing
// the Parent loose resolves everything to E major at a whisper. Locks, shots,
// chips, and kills are notes in this score: they snap to the transport, read
// the live chord, and kills walk hidden per-act melody lanes.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[] };

// Emaj9 — C#m9 — Amaj9 — B(add4), two bars each: sunlit water.
const CHORDS: Chord[] = [
  { bass: 40, pad: [52, 56, 59, 63, 66], arp: [64, 68, 71, 75] }, // Emaj9
  { bass: 37, pad: [49, 52, 56, 59, 63], arp: [61, 64, 68, 71] }, // C#m9
  { bass: 33, pad: [57, 61, 64, 68, 71], arp: [69, 73, 76, 80] }, // Amaj9
  { bass: 35, pad: [59, 64, 66, 71, 73], arp: [66, 71, 75, 78] }, // B(add4)
];
// Crown bars 16–22 walk Em9 — Cmaj9 — Fmaj7#11: the sour note under the bell.
// (Array order compensates for absolute-bar chord indexing.)
const CROWN_CHORDS: Chord[] = [
  { bass: 36, pad: [48, 52, 55, 59, 62], arp: [60, 64, 67, 71] }, // Cmaj9 (bars 18–19)
  { bass: 41, pad: [53, 57, 60, 64, 71], arp: [65, 69, 72, 76] }, // Fmaj7#11 (bars 20–21)
  { bass: 40, pad: [52, 55, 59, 62, 66], arp: [64, 67, 71, 74] }, // Em9 (bars 16–17)
];
// Serene: E major, held.
const SERENE_CHORDS: Chord[] = [
  { bass: 40, pad: [52, 56, 59, 64, 68], arp: [64, 68, 71, 76] },
];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Drift: slow arches, barely moving.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 4,
  ],
  // Forest: leaping thirds, so a chained volley climbs the strands.
  1: [
    0, 2, 4, 2, 1, 3, 5, 3,
    2, 4, 6, 4, 3, 5, 7, 5,
    4, 2, 0, 2, 5, 3, 1, 3,
    6, 4, 2, 4, 7, 5, 3, 1,
  ],
  // Bell: high glassy shimmer in the open water.
  2: [
    4, 5, 7, 6, 5, 4, 6, 5,
    7, 6, 5, 7, 6, 5, 4, 6,
    5, 6, 7, 5, 4, 5, 6, 4,
    7, 6, 5, 4, 5, 6, 7, 4,
  ],
  // Dive: jump-cut broken chords for the dense volleys.
  3: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 6, 5, 7, 6, 4, 2, 0,
  ],
  // Crown: tolling descents while the webs come down.
  4: [
    7, 6, 5, 4, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
    4, 3, 2, 1, 2, 1, 0, 1,
    3, 2, 1, 0, 2, 3, 4, 5,
  ],
  // Serene: settling home.
  5: [
    4, 3, 2, 1, 2, 1, 0, 1,
    2, 3, 4, 3, 2, 1, 0, 0,
    3, 2, 1, 0, 1, 0, 1, 2,
    3, 2, 1, 0, 0, 1, 2, 3,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// Gains are tuned by perceived loudness: squares and saws sit far lower than sines.
const PLAYER_VOICES: Record<SectionIndex, { lock: StrandTonalVoice; kill: StrandTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 3200, gain: 0.13, sparkle: 0.5, reverb: 0.35 },
    kill: { oscillator: 'sine', decay: 0.34, cutoff: 3400, gain: 0.15, sparkle: 0.6, reverb: 0.4 },
    fire: { oscillator: 'sine', cutoff: 2600, gain: 0.06, fallSemitones: 9, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 3000, gain: 0.12, sparkle: 0.45, reverb: 0.28 },
    kill: { oscillator: 'triangle', decay: 0.28, cutoff: 3200, gain: 0.14, sparkle: 0.6, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 2900, gain: 0.065, fallSemitones: 10, noise: 0.04 },
  },
  2: {
    lock: { oscillator: 'sine', decay: 0.11, cutoff: 4400, gain: 0.14, sparkle: 0.8, reverb: 0.45 },
    kill: { oscillator: 'sine', decay: 0.4, cutoff: 4800, gain: 0.16, sparkle: 0.9, reverb: 0.5 },
    fire: { oscillator: 'sine', cutoff: 3400, gain: 0.06, fallSemitones: 12, noise: 0.035 },
  },
  3: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2600, gain: 0.05, sparkle: 0.45, reverb: 0.2 },
    kill: { oscillator: 'square', decay: 0.22, cutoff: 3000, gain: 0.1, sparkle: 0.6, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 3400, gain: 0.055, fallSemitones: 8, noise: 0.05 },
  },
  4: {
    // The crown: everything the player does sounds pressed down and close.
    lock: { oscillator: 'sawtooth', decay: 0.1, cutoff: 1700, gain: 0.05, sparkle: 0.2, reverb: 0.4 },
    kill: { oscillator: 'sawtooth', decay: 0.36, cutoff: 1900, gain: 0.1, sparkle: 0.35, reverb: 0.45 },
    fire: { oscillator: 'square', cutoff: 1600, gain: 0.045, fallSemitones: 14, noise: 0.025 },
  },
  5: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 3000, gain: 0.1, sparkle: 0.6, reverb: 0.55 },
    kill: { oscillator: 'sine', decay: 0.55, cutoff: 3400, gain: 0.13, sparkle: 0.8, reverb: 0.6 },
    fire: { oscillator: 'sine', cutoff: 2400, gain: 0.04, fallSemitones: 8, noise: 0.015 },
  },
};

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-be4y',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: STRANDLINE_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let water: WaterController | null = null;
  let parentId = -1;
  let parentDead = false;
  let broodKills = 0;
  let kills = 0;
  let totalEnemies = 60;
  let lastPumpAt = -1;
  let lastShieldedAt = -10;
  let sporeWarned = false;
  const PARENT_TOTAL_HP = 6; // hitStages [3, 3]

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.deadline, chords: CROWN_CHORDS, barsPerChord: 2 },
      { fromBar: STRANDLINE_BARS.deadline, chords: SERENE_CHORDS, barsPerChord: 1 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
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
      compressor: { threshold: -16, ratio: 4.5, attack: 0.005, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.32, dampHz: 2200 },
      reverb: { seconds: 3.4, decay: 2.4, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      water = installStrandlineWater(context, mix);
      water.setBed(context.currentTime + 0.1, 0.1, 1.5);
      water.setShimmer(context.currentTime + 0.1, 0.01, 1.5);
    },
    onStep: scheduleStep,
    onRunStart() {
      parentId = -1;
      parentDead = false;
      broodKills = 0;
      kills = 0;
      lastPumpAt = -1;
      sporeWarned = false;
      score.clearOverride();
      const context = runtime.context();
      if (context && water) water.setBed(context.currentTime + 0.05, 0.14, 1.2);
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) {
        water?.setBed(context.currentTime + 0.5, 0.1, 4);
        water?.setShimmer(context.currentTime + 0.5, parentDead ? 0.05 : 0.01, 4);
        pad(context.currentTime + 0.05, parentDead ? [52, 56, 59, 64, 71] : [52, 55, 59, 62, 66], 6, 0.8, 2, parentDead ? 1600 : 1000);
      }
    },
    onDispose() {
      ctx = null;
      water = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const life = () => Math.min(1, kills / Math.max(1, totalEnemies));

  // ---- arrangement -----------------------------------------------------------

  const blankBar = '................';
  const downbeat = 'P...............';
  const halfPulse = 'P.......p.......';
  const softKick = 'K.......K.......';
  const fourFloor = 'K...K...K...K...';
  const clickBackbeat = '....t.......t...';
  const clickOff = '..t...t...t...t.';
  const sparseClick = '....t.......t...';
  const evenArp = 'A.A.A.A.A.A.A.A.';
  const shakerEighths = 'h.h.h.h.h.h.h.h.';
  const shakerDrive = 'h.hHh.hHh.hHh.hH';
  const openShaker = '..o...o...o...o.';
  const tickBar = 't..t..t.t..t..t.'; // 3-3-2: the crown's crawl
  const arpOrder = [0, 2, 1, 3, 2, 0, 3, 1];

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
          hits([downbeat, blankBar].join(''), { P: 0.6 }, ({ time }, vel) => pulse(time, vel)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.6, 1, 950)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 1 && step === 8) bell(time, chord.arp[2], 0.26); }),
          fn(({ time, step, bar }) => { if (bar % 4 === 2 && step === 6) bubbles(time, 0.5, bar * 0.37); }),
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
        name: 'drift',
        fromBar: STRANDLINE_BARS.drift,
        tracks: [
          hits(downbeat, { P: 0.75 }, ({ time }, vel) => pulse(time, vel)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.7, 1, 1000)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 1 && step === 8) bell(time, chord.arp[2], 0.3); }),
          hits([blankBar, blankBar, sparseClick, sparseClick].join(''), { t: 0.28 }, ({ time }, vel) => click(time, vel)),
          fn(({ time, step, bar }) => { if (bar % 2 === 0 && step === 10) bubbles(time, 0.45, bar * 0.61 + 0.2); }),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.14)),
        ],
      },
      {
        name: 'forest',
        fromBar: STRANDLINE_BARS.forest,
        tracks: [
          hits(downbeat, { P: 0.8 }, ({ time }, vel) => pulse(time, vel)),
          hits(softKick, { K: 0.7 }, ({ time }, vel) => kick(time, vel)),
          hits(clickOff, { t: 0.4 }, ({ time }, vel) => click(time, vel)),
          hits([blankBar, blankBar, shakerEighths, shakerEighths].join(''), { h: 0.03 }, ({ time }, vel) => shaker(time, vel, 0.03)),
          hits('B.......b.....b.', { B: 0.75, b: 0.5 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.3)),
          hits(evenArp, { A: 1 }, ({ time, step, bar, chord }) => arp(time, chord.arp[arpOrder[(step / 2) % arpOrder.length]] - 12, 0.28 + bar * 0.03, 1700 + life() * 500)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.8, 2, 1300 + life() * 500)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 1 && step === 8) bell(time, chord.arp[3], 0.3); }),
          fn(({ time, step, bar }) => { if (bar % 2 === 0 && step === 13) bubbles(time, 0.4, bar * 0.53 + 0.7); }),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.2)),
          fn(({ time, step, bar }) => { if (bar === 7 && step >= 8 && step % 2 === 0) click(time, 0.3 + (step - 8) * 0.06); }),
        ],
      },
      {
        name: 'bell',
        fromBar: STRANDLINE_BARS.bell,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            swell(time, chord.pad.map((midi) => midi + 12), 32 * SIXTEENTH, 0.9);
            chime(time, chord.arp[3] + 12, 2.2, 0.4);
            waterTo(time, 0.07, 0.04, 2);
          }),
          hits(downbeat, { P: 0.85 }, ({ time }, vel) => pulse(time, vel)),
          hits(openShaker, { o: 0.045 }, ({ time }, vel) => shaker(time, vel, 0.16)),
          hits('B...............', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.2)),
          hits(evenArp, { A: 0.4 }, ({ time, step, chord }, vel) => arp(time, chord.arp[arpOrder[(step / 2) % arpOrder.length]], vel, 2500)),
          hits('A...A...A...A...', { A: 0.36 }, ({ time, step, chord }, vel) => bell(time, chord.arp[(step / 4) % chord.arp.length] + 12, vel)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.85, 3, 2100)),
          oneShot(1, 8, ({ time, chord }) => chime(time, chord.arp[0] + 12, 1.6, 0.32)),
          fn(({ time, step, bar }) => { if (bar === 1 && step >= 10 && step % 2 === 0) click(time, 0.3 + (step - 10) * 0.08); }),
        ],
      },
      {
        name: 'dive',
        fromBar: STRANDLINE_BARS.dive,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 0.7);
            waterTo(time, 0.16, 0.03, 2);
          }),
          hits(downbeat, { P: 0.85 }, ({ time }, vel) => pulse(time, vel)),
          hits(fourFloor, { K: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits(clickBackbeat, { t: 0.6 }, ({ time }, vel) => click(time, vel)),
          hits(shakerDrive, { h: 0.035, H: 0.06 }, ({ time }, vel) => shaker(time, vel, 0.03)),
          fn(({ time, step, chord }) => {
            const bassSteps: Record<number, [number, number]> = { 0: [0, 1], 3: [0, 0.7], 6: [12, 0.55], 8: [0, 0.9], 11: [7, 0.6], 14: [12, 0.7] };
            if (step in bassSteps) bass(time, chord.bass + bassSteps[step][0], bassSteps[step][1], 0.7);
          }),
          hits(evenArp, { A: 0.45 }, ({ time, step, chord }, vel) => arp(time, chord.arp[arpOrder[(step / 2) % arpOrder.length]], vel, 2400 + life() * 600)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.8, 3, 2000 + life() * 600)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 0 && step === 8) bell(time, chord.arp[(bar / 2) % chord.arp.length] + 12, 0.3); }),
          fn(({ time, step, bar }) => { if (bar % 2 === 1 && step === 14) bubbles(time, 0.35, bar * 0.41 + 1.3); }),
          oneShot(4, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.24)),
          fn(({ time, step, barInSection }) => { if (barInSection === 5 && step >= 8 && step % 2 === 0) click(time, 0.35 + (step - 8) * 0.07); }),
        ],
      },
      {
        name: 'crown',
        fromBar: STRANDLINE_BARS.crown,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.1);
            sting(time, chord.bass + 24, 0.9);
            waterTo(time, 0.1, 0.01, 2);
          }),
          hits(halfPulse, { P: 1, p: 0.55 }, ({ time }, vel) => pulse(time, vel)),
          hits(tickBar, { t: 0.45 }, ({ time }, vel) => click(time, vel)),
          fn(({ time, step, chord }) => {
            if (parentDead) return;
            if (step === 0) drone(time, chord.bass + 24, 16 * SIXTEENTH * 1.05, 0.55);
            if (step === 8) sub(time, chord.bass, 0.6);
          }),
          // Every brood cleared gives a layer back: bass, then arp, then pad and bells.
          hits('B.......b.....B.', { B: 0.75, b: 0.5 }, ({ time, chord }, vel) => { if (layers() >= 1 || parentDead) bass(time, chord.bass, vel, 0.5); }),
          hits(evenArp, { A: 0.4 }, ({ time, step, chord }, vel) => { if (layers() >= 2 || parentDead) arp(time, chord.arp[arpOrder[(step / 2) % arpOrder.length]], vel, 2200); }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => {
            if (layers() >= 3 || parentDead) pad(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.8, 3, parentDead ? 2600 : 2000);
            else pad(time, chord.pad.slice(0, 3), 32 * SIXTEENTH * 1.02, 0.55, 1, 900);
          }),
          hits('A...A...A...A...', { A: 0.3 }, ({ time, step, chord }, vel) => { if (layers() >= 3 || parentDead) bell(time, chord.arp[(step / 4) % chord.arp.length] + 12, vel); }),
          fn(({ time, step, barInSection }) => {
            // The last bar before the deadline: the crawl accelerates.
            if (!parentDead && barInSection === 5 && step % 4 === 2) click(time, 0.55 + step * 0.02);
          }),
        ],
      },
      {
        name: 'serene',
        fromBar: STRANDLINE_BARS.deadline,
        toBar: STRANDLINE_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            if (parentDead) {
              swell(time, chord.pad.map((midi) => midi + 12), 30 * SIXTEENTH, 0.9);
              waterTo(time, 0.12, 0.09, 3);
            } else {
              drone(time, chord.bass + 24, 30 * SIXTEENTH, 0.4);
              waterTo(time, 0.1, 0.02, 3);
            }
            pad(time, chord.pad, 32 * SIXTEENTH * 1.05, parentDead ? 0.9 : 0.55, parentDead ? 3 : 1, parentDead ? 2400 : 1000);
          }),
          hits(downbeat, { P: 0.6 }, ({ time }, vel) => pulse(time, vel)),
          oneShot(0, 4, ({ time, chord }) => bell(time, chord.arp[3] + 12, 0.34)),
          oneShot(0, 12, ({ time, chord }) => bell(time, chord.arp[2] + 12, 0.3)),
          oneShot(1, 4, ({ time, chord }) => bell(time, chord.arp[1] + 12, 0.27)),
          oneShot(1, 10, ({ time, chord }) => bell(time, chord.arp[0] + 12, 0.24)),
          oneShot(1, 6, ({ time }) => { if (parentDead) chime(time, 88, 2.8, 0.36); }),
          fn(({ time, step, bar }) => { if (step === 8) bubbles(time, 0.45, bar * 0.29 + 2.1); }),
        ],
      },
    ],
  });

  function layers() {
    return Math.floor(broodKills / BROOD_SIZE);
  }

  function waterTo(time: number, bed: number, shimmer: number, ramp: number) {
    water?.setBed(time, bed, ramp);
    water?.setShimmer(time, shimmer + life() * 0.06, ramp);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ------------------------------------------------------------------

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    pulse, kick, click, shaker, sub, bass, pad, arp, bell, chime, drone, swell, riser, impact, sting, bubbles,
    noiseHit, playerSends, playerTone, playerNoise, playerBubble,
  } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.3 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.18 }],
    duration: 0.2,
    stopPadding: 0.04,
    envelope: { decay: 0.2 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.09 },
  });

  // Squelch: a membrane giving under a shot — a lowpassed saw dropping in pitch.
  const squelchVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'sawtooth', gain: ({ gainValue }) => gainValue }],
    duration: 0.14,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 1400, Q: 2 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.55, time: time + 0.12 }],
    envelope: { decay: 0.14 },
  });

  const shearVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.6,
    stopPadding: 0.06,
    envelope: { decay: 0.6 },
  });

  // Rejection: a sour, muffled blurp — the wrong note, under water.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.6, detune: -12 }, { type: 'square', gain: 0.6, detune: 12 }],
    duration: 0.24,
    stopPadding: 0.04,
    filter: { type: 'lowpass', Q: 4, frequency: 520 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.42 }],
    duration: 0.6,
    stopPadding: 0.05,
    envelope: { decay: 0.6 },
  });

  // The web catching a shot: a plucked, damped thread.
  const webTwangVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.5 }, { type: 'sawtooth', gain: 0.14, detune: 9 }],
    duration: 0.36,
    stopPadding: 0.05,
    filter: { type: 'bandpass', Q: 3, frequency: 900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.36 },
    ],
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.14,
    stopPadding: 0.02,
    envelope: { decay: 0.14 },
  });

  const pumpVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.16 }],
    duration: 0.3,
    stopPadding: 0.04,
    envelope: { decay: 0.3 },
  });

  // ---- player instruments ----------------------------------------------------

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
    const vel = Math.min(1.45, 1 + chain * 0.14);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.45, 0.25) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkle * 0.04, 0.08, 7000);
    // The parasite pops: a bubble rising out of the kill.
    playerBubble(time + THIRTYSECOND, midiToFreq(midi + 12), 0.5, 1.5);
  }

  // The Parent audibly loses its grip: every chip is brighter, higher, and
  // more strained than the last.
  function parentChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sawtooth',
      frequency: root * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root * (1 + intensity * 1.3), time: time + 0.3 }],
      filter: { type: 'lowpass', frequency: 600 + intensity * 2800, Q: 2 },
      gainAutomation: [
        { type: 'set', value: 0.1 + intensity * 0.1, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
      ],
      destination: output,
      sends: playerSends(0.2, 0.4),
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon, PLAYER_VOICES[4].kill, 0.5 + intensity * 0.4, 1);
    playerNoise(time, 0.08 + intensity * 0.08, 0.09, 3800);
    playerBubble(time + SIXTEENTH, 400 + intensity * 600, 0.6, 2.2);
  }

  // Torn loose: the music holds its breath, then everything comes back clean.
  function parentFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    audioMix.duckAt(time, 0.1, 1.6);
    impact(time, 1.3);
    sub(time + 0.02, 28, 1);
    noiseHit(time, 0.16, 0.5, 'highpass', 5200, output);
    // The serene chord blooms and a peal falls through it: E major, clean.
    swell(time + 0.3, [64, 68, 71, 76, 80], 5.5, 1.0);
    [88, 83, 80, 76, 71, 68, 64].forEach((midi, index) => {
      const at = time + 0.35 + index * SIXTEENTH;
      playerTone(at, midi, PLAYER_VOICES[5].kill, 0.85 - index * 0.07, 1);
    });
    chime(time + 0.35 + 8 * SIXTEENTH, 88, 3.2, 0.42);
    waterTo(time + 0.3, 0.12, 0.1, 3);
    score.overrideSection(5);
  }

  // ---- event wiring ------------------------------------------------------------

  bus.on('runstart', ({ totalEnemies: total }) => {
    totalEnemies = Math.max(1, total);
  });

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
    playerNoise(time, 0.012 + sparkle * 0.03, 0.022, 8800);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.16 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.3, 1);
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.07 }],
        destination: output,
        sends: playerSends(0.16, 0.1),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.03, 4200);
    // A sting dart leaving: a tiny bubble.
    playerBubble(time, 1400, 0.25, 1.35);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === parentId) {
      parentChip(time, 1 - hitPointsRemaining / PARENT_TOTAL_HP);
      return;
    }
    // A membrane giving way: squelch on the chord's root, then a bubble.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    squelchVoice.play({ context: ctx, time, midi: chord.bass + 24, gainValue: 0.07, destination: output, sends: playerSends(0.15, 0.2) });
    playerNoise(time, 0.04, 0.03, 4800);
    playerBubble(time + THIRTYSECOND, 520, 0.5, 2.1);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (enemyId === parentId) {
      // The grip tears: a shear, a slip back into the crown, and it comes on again.
      noiseHit(time, 0.2, 0.16, 'bandpass', 1900, output);
      for (const midi of [chord.bass + 12, chord.arp[1]]) {
        shearVoice.play({ context: ctx, time, midi, gainValue: 0.13, destination: output, sends: playerSends(0.24, 0.5) });
      }
      riser(time, 1.3, 0.16);
      sub(time + 0.05, chord.bass - 12, 0.9);
      return;
    }
    // The sac bursts: a wet pop and a spray of bubbles.
    noiseHit(time, 0.14, 0.1, 'bandpass', 1400, output);
    squelchVoice.play({ context: ctx, time, midi: chord.bass + 19, gainValue: 0.09, destination: output, sends: playerSends(0.2, 0.25) });
    bubbles(time + THIRTYSECOND, 0.8, enemyId * 0.13);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    kills += 1;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === parentId) {
      parentDead = true;
      parentFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills: volleyKills }) => {
    if (!ctx || size < 4 || volleyKills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const mix = score.sectionMixAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[mix.to].kill, (size >= 6 ? 0.7 : 0.55) - index * 0.06, 1);
    });
    if (size >= 6) sub(time, score.chordAt(position).bass, 0.6);
  });

  bus.on('shielded', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    lastShieldedAt = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // The webbing takes the shot: a damped thread pluck on the sour root, and a hiss.
    for (const [offset, at, vel] of [[24, time, 1], [30, time + THIRTYSECOND, 0.7]] as const) {
      webTwangVoice.play({
        context: ctx,
        time: at,
        midi: chord.bass + offset,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + offset - 5), time: at + 0.3 }],
        vel,
        destination: output,
        sends: playerSends(0.2, 0.3),
      });
    }
    noiseHit(time, 0.07, 0.1, 'bandpass', 2600, output);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A volley the webbing already answered needs no second, sour "no".
    if (time - lastShieldedAt < 0.06) return;
    for (const [frequency, at, vel] of [[164, time, 0.12], [156, time + 0.1, 0.09]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.6, time: at + 0.2 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.08, 0.08, 'lowpass', 600, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // A spore bursting on the hull: a dull boom and the sour sting.
    hullBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    sting(time + 0.04, chord.bass + 24, 0.8);
    noiseHit(time, 0.16, 0.16, 'lowpass', 700, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.12 }],
      destination: output,
      sends: playerSends(0.08, 0.1),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    const output = sfxDestination();
    if (!output) return;
    if (kind === 'parent') {
      parentId = enemyId;
      // Dug in where the strands root: a hull-shaking impact, a drone, the sour note.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const audioMix = runtime.mix();
      audioMix?.duckAt(time, 0.3, 1.0);
      impact(time, 1.2);
      riser(time + 0.1, 1.8, 0.16);
      drone(time + 0.1, 40 + 24, 2.6, 0.9);
      sting(time + 0.15, 64, 1);
    } else if (kind === 'broodling') {
      // The pump: three come out at once; one wet exhale covers them.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      if (time - lastPumpAt < 0.2) return;
      lastPumpAt = time;
      pumpVoice.play({
        context: ctx,
        time,
        frequency: 180,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 60, time: time + 0.28 }],
        destination: output,
        sends: playerSends(0.1, 0.3),
      });
      noiseHit(time, 0.12, 0.2, 'lowpass', 900, output);
      bubbles(time + SIXTEENTH, 0.7, enemyId * 0.29);
    } else if (kind === 'tick') {
      // A parasite on the strand ahead: the smallest click on the grid.
      const time = score.quantizePlayerAction(ctx.currentTime);
      click(time, 0.22);
    } else if (kind === 'sac') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      pumpVoice.play({ context: ctx, time, frequency: 140, frequencyAutomation: [{ type: 'exponentialRamp', value: 70, time: time + 0.25 }], destination: output, sends: playerSends(0, 0.3) });
    } else if (kind === 'spore' && !sporeWarned) {
      sporeWarned = true;
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      sting(time, 52, 0.5);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'exposed') {
      // The last web dies back: three rising bells, the animal's light.
      const time = score.nextGridTime(ctx.currentTime, 1);
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      [0, 2, 4, 7].forEach((degree, index) => {
        playerTone(time + index * THIRTYSECOND * 2, leadSet[degree] + 12, PLAYER_VOICES[5].kill, 0.6, 1);
      });
      chime(time + 4 * THIRTYSECOND, leadSet[7] + 12, 1.8, 0.35);
    }
  });

  // Each brood cleared: a small restored-layer figure as the web dies back.
  const broodlingIds = new Set<number>();
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'broodling') broodlingIds.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (!broodlingIds.delete(enemyId) || !ctx) return;
    broodKills += 1;
    if (broodKills % BROOD_SIZE !== 0) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    [0, 4, 7].forEach((degree, index) => {
      bell(time + index * SIXTEENTH, leadSet[degree] + 12, 0.34);
    });
    waterTo(time, 0.1, 0.02 + layers() * 0.02, 1.5);
  });
  bus.on('runstart', () => {
    broodlingIds.clear();
  });

  return runtime;
}
