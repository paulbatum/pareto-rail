import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createDownpourVoices, installRainBed, type DownpourTonalVoice } from './audio-voices';
import {
  DOWNPOUR_BARS,
  DOWNPOUR_BPM,
  DOWNPOUR_DURATION,
  DOWNPOUR_SCORE_SECTIONS,
  DOWNPOUR_STEPS_PER_BAR,
  DOWNPOUR_TIME,
} from './timing';

// The Downpour score: 176 BPM drum & bass in D minor, 44 bars = exactly the
// 60-second run. Storm (0) is sparse pad and noise; the plunge (4) drops a
// rolling break that carries through the avenue and the tube; the canal (24)
// drops to half-time menace; the citadel (30) escalates the hunt back toward
// full tempo for the gunship fight; the outro (40) strips to near silence.
// Player actions read the live chord and snap to the transport; kills walk a
// hidden kill lane so a clean volley performs a melodic run.

const SIXTEENTH = DOWNPOUR_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = DOWNPOUR_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Dm - Bb - F - C, two bars each: a rain-loop that never quite resolves.
const CHORDS: Chord[] = [
  { bass: 26, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74], stab: [62, 65, 69] },
  { bass: 34, pad: [46, 53, 58, 62], arp: [58, 62, 65, 70], stab: [58, 62, 70] },
  { bass: 29, pad: [45, 50, 53, 57], arp: [57, 60, 64, 69], stab: [57, 60, 69] },
  { bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72], stab: [60, 64, 72] },
];
// The hunt: Dm - Eb - Dm - Bb. The Eb is the gunship leaning in.
const HUNT_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 27, pad: [51, 55, 58, 63], arp: [63, 67, 70, 75], stab: [63, 67, 75] },
  CHORDS[0],
  CHORDS[1],
];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6; // storm, plunge, avenue, undercity, canal, citadel, outro

const KILL_LANES: Record<SectionIndex, number[]> = {
  0: [0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 7, 6, 5, 4, 2],
  1: [0, 4, 1, 5, 2, 6, 3, 7, 4, 0, 5, 1, 6, 2, 7, 3, 0, 4, 2, 6, 1, 5, 3, 7, 4, 7, 6, 5, 4, 3, 2, 1],
  2: [0, 2, 4, 6, 1, 3, 5, 7, 2, 4, 6, 0, 3, 5, 7, 1, 4, 6, 0, 2, 5, 7, 1, 3, 6, 0, 2, 4, 7, 1, 3, 5],
  3: [4, 0, 5, 1, 6, 2, 7, 3, 0, 4, 1, 5, 2, 6, 3, 7, 4, 7, 6, 5, 4, 3, 2, 1, 0, 4, 2, 6, 1, 5, 3, 7],
  4: [7, 6, 5, 4, 6, 5, 4, 3, 5, 4, 3, 2, 4, 3, 2, 1, 3, 2, 1, 0, 2, 1, 0, 4, 3, 4, 5, 6, 5, 4, 3, 2],
  5: [4, 5, 7, 6, 4, 2, 5, 3, 6, 7, 5, 4, 6, 3, 5, 2, 7, 6, 5, 4, 7, 5, 3, 1, 4, 5, 6, 7, 6, 5, 4, 0],
  6: [0, 2, 4, 7, 4, 2, 0, 2, 4, 7, 4, 2, 0, 2, 4, 7, 0, 2, 4, 7, 4, 2, 0, 2, 4, 7, 4, 2, 0, 2, 4, 0],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: DownpourTonalVoice; kill: DownpourTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.13, cutoff: 3200, gain: 0.1, sparkle: 0.4, reverb: 0.24 },
    kill: { oscillator: 'triangle', decay: 0.32, cutoff: 2800, gain: 0.13, sparkle: 0.6, reverb: 0.34 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.06, fallSemitones: 12, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2700, gain: 0.055, sparkle: 0.35, reverb: 0.12 },
    kill: { oscillator: 'square', decay: 0.17, cutoff: 3100, gain: 0.1, sparkle: 0.55, reverb: 0.18 },
    fire: { oscillator: 'sawtooth', cutoff: 3900, gain: 0.062, fallSemitones: 7, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.075, cutoff: 3600, gain: 0.05, sparkle: 0.4, reverb: 0.16 },
    kill: { oscillator: 'sawtooth', decay: 0.2, cutoff: 3900, gain: 0.11, sparkle: 0.7, reverb: 0.22 },
    fire: { oscillator: 'sawtooth', cutoff: 4600, gain: 0.065, fallSemitones: 10, noise: 0.05 },
  },
  3: {
    lock: { oscillator: 'square', decay: 0.07, cutoff: 2400, gain: 0.058, sparkle: 0.5, reverb: 0.28 },
    kill: { oscillator: 'square', decay: 0.19, cutoff: 2900, gain: 0.115, sparkle: 0.68, reverb: 0.3 },
    fire: { oscillator: 'square', cutoff: 3600, gain: 0.065, fallSemitones: 8, noise: 0.055 },
  },
  4: {
    lock: { oscillator: 'sawtooth', decay: 0.16, cutoff: 1900, gain: 0.06, sparkle: 0.2, reverb: 0.4 },
    kill: { oscillator: 'sawtooth', decay: 0.42, cutoff: 2200, gain: 0.14, sparkle: 0.4, reverb: 0.48 },
    fire: { oscillator: 'triangle', cutoff: 2200, gain: 0.055, fallSemitones: 14, noise: 0.04 },
  },
  5: {
    lock: { oscillator: 'sawtooth', decay: 0.07, cutoff: 4000, gain: 0.055, sparkle: 0.55, reverb: 0.2 },
    kill: { oscillator: 'sawtooth', decay: 0.22, cutoff: 4400, gain: 0.13, sparkle: 0.85, reverb: 0.28 },
    fire: { oscillator: 'sawtooth', cutoff: 5200, gain: 0.075, fallSemitones: 12, noise: 0.065 },
  },
  6: {
    lock: { oscillator: 'sine', decay: 0.2, cutoff: 2600, gain: 0.09, sparkle: 0.3, reverb: 0.5 },
    kill: { oscillator: 'sine', decay: 0.55, cutoff: 2400, gain: 0.12, sparkle: 0.25, reverb: 0.62 },
    fire: { oscillator: 'sine', cutoff: 2200, gain: 0.05, fallSemitones: 10, noise: 0.02 },
  },
};

export function createAudio(bus: EventBus) {
  return createDownpourAudio(bus).audio;
}

export const traceDownpourAudio = createAudioTraceHarness({
  level: 'downpour-f2e6',
  bpm: DOWNPOUR_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: DOWNPOUR_DURATION,
  createAudio: createDownpourAudio,
});

function createDownpourAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let gunshipId = -1;
  let gunshipMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: DOWNPOUR_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: DOWNPOUR_BARS.citadel, toBar: DOWNPOUR_BARS.outro, chords: HUNT_CHORDS, barsPerChord: 2 }],
    sections: DOWNPOUR_SCORE_SECTIONS,
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
      compressor: { threshold: -15, ratio: 5, attack: 0.003, release: 0.18 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2200 },
      reverb: { seconds: 2.8, decay: 3, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      installRainBed(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      gunshipId = -1;
      gunshipMaxHp = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, [50, 57, 62, 65], 6, 0.85);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler ------------------------------------------------------------

  const blank = '................';
  const rollingKick = 'K.......k.......';
  const rollingSnare = '....S.......S...';
  const ghost = '.......G........' + '...............G';
  const busyHat = 'hoHohoHohoHohoHo';
  const evenHat = 'h.H.h.H.h.H.h.H.';
  const evenArp = 'A.A.A.A.A.A.A.A.';
  const beatArp = 'A...A...A...A...';
  const halfKick = 'K...............' + 'K.......k.......';
  const halfSnare = blank + '........S.......';
  const huntGhost = '.......G........' + '.......G....G...';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(bar / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: DOWNPOUR_BARS.storm,
        tracks: [
          hits('C...............................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.6)),
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
        name: 'storm',
        fromBar: DOWNPOUR_BARS.storm,
        tracks: [
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.75)),
          hits([blank, blank, '..H...H...H...H.', '..H...H...H...H.'].join(''), { H: 0.028 }, ({ time }, vel) => hat(time, vel, 0.03)),
          oneShot(3, 8, ({ time }) => riser(time, 6 * SIXTEENTH, 0.16)),
        ],
      },
      {
        name: 'plunge',
        fromBar: DOWNPOUR_BARS.plunge,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            thunder(time, 1);
            impact(time, 0.9);
          }),
          hits(rollingKick, { K: 1, k: 0.86 }, ({ time }, vel) => kick(time, vel)),
          hits(rollingSnare, { S: 0.9 }, ({ time }, vel) => snare(time, vel)),
          hits(ghost, { G: 0.28 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.042, H: 0.08, o: 0.026 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          fn(rollingBassTrack),
          hits(evenArp, { A: 0.6 }, rollingArpHit),
          hits('S...............' + blank, { S: 0.62 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar }) => { if (bar % 8 === 0 && step === 0) pad(time, [50, 57, 62], 64 * SIXTEENTH, 0.4); }),
        ],
      },
      {
        name: 'avenue',
        fromBar: DOWNPOUR_BARS.avenue,
        tracks: [
          hits(rollingKick, { K: 1, k: 0.86 }, ({ time }, vel) => kick(time, vel)),
          hits(rollingSnare, { S: 0.9 }, ({ time }, vel) => snare(time, vel)),
          hits(ghost, { G: 0.28 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.045, H: 0.085, o: 0.028 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          hits(blank + '..............X.', { X: 0.4 }, ({ time }, vel) => snare(time, vel)),
          fn(rollingBassTrack),
          hits(evenArp, { A: 0.68 }, rollingArpHit),
          hits('S...............' + blank, { S: 0.68 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar }) => { if (bar % 4 === 2 && step === 2) openHat(time, 0.09); }),
        ],
      },
      {
        name: 'undercity',
        fromBar: DOWNPOUR_BARS.undercity,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1)),
          hits(rollingKick, { K: 1, k: 0.9 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.95 }, ({ time }, vel) => snare(time, vel)),
          hits(ghost, { G: 0.32 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.048, H: 0.09, o: 0.03 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.022 : 0.03)),
          hits('R...R...R...R...', { R: 0.045 }, ({ time }, vel) => ride(time, vel)),
          fn(rollingBassTrack),
          hits(evenArp, { A: 0.75 }, rollingArpHit),
          hits('S...............' + 'S...............', { S: 0.78 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          oneShot(5, 8, ({ time }) => riser(time, 4 * SIXTEENTH, 0.18)),
        ],
      },
      {
        name: 'canal',
        fromBar: DOWNPOUR_BARS.canal,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 0.8);
            noiseHit(time, 0.3, 0.6, 'lowpass', 800);
          }),
          hits(halfKick, { K: 0.8, k: 0.55 }, ({ time }, vel) => kick(time, vel)),
          hits(halfSnare, { S: 0.75 }, ({ time }, vel) => snare(time, vel)),
          hits('h...h...h...h...' + 'h...h...h...h...', { h: 0.03 }, ({ time }, vel) => hat(time, vel, 0.035)),
          fn(({ time, step, bar, chord }) => {
            if (step !== 0) return;
            const barsIn = bar - DOWNPOUR_BARS.canal;
            if (barsIn % 2 === 0) wobble(time, chord.bass, 0.65, 2 * DOWNPOUR_TIME.barSeconds);
          }),
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.03, 0.55)),
          fn(({ time, step, bar }) => { if (bar % 4 === 3 && step === 12) stab(time, [63, 67], 0.3); }),
        ],
      },
      {
        name: 'citadel',
        fromBar: DOWNPOUR_BARS.citadel,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.15);
            crash(time, 0.28);
          }),
          hits(halfKick, { K: 0.95, k: 0.75 }, ({ time }, vel) => kick(time, vel)),
          hits(halfSnare, { S: 0.92 }, ({ time }, vel) => snare(time, vel)),
          hits(huntGhost, { G: 0.3 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.05, H: 0.09, o: 0.032 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.024 : 0.03)),
          hits('..R...R...R...R.', { R: 0.05 }, ({ time }, vel) => ride(time, vel)),
          fn(({ time, step, bar, chord }) => {
            if (step !== 0) return;
            const barsIn = bar - DOWNPOUR_BARS.citadel;
            wobble(time, chord.bass, 0.7 + barsIn * 0.02, 2 * DOWNPOUR_TIME.barSeconds);
          }),
          hits('S...............' + 'S...............', { S: 0.85 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar }) => {
            const themeBar = (bar - DOWNPOUR_BARS.citadel) % 4;
            if (step % 4 !== 0) return;
            const notes: Array<[number, number, number]> = [[0, 0, 74], [1, 0, 77], [2, 0, 74], [3, 0, 70]];
            for (const [noteBar, noteStep, midi] of notes) {
              if (noteBar === themeBar && noteStep === step) lead(time, midi, 3.5 * SIXTEENTH, 0.8);
            }
          }),
          fn(({ time, step, bar }) => { if (bar === DOWNPOUR_BARS.outro - 2 && step === 0) riser(time, 8 * SIXTEENTH, 0.22); }),
        ],
      },
      {
        name: 'outro',
        fromBar: DOWNPOUR_BARS.outro,
        toBar: DOWNPOUR_BARS.end,
        tracks: [
          hits('K...............', { K: 0.5 }, ({ time, bar }, vel) => kick(time, vel * outroFade(bar))),
          hits('H.......H.......', { H: 0.028 }, ({ time, bar }, vel) => hat(time, vel * outroFade(bar), 0.035)),
          hits('C...............................................................', { C: 1 }, ({ time, chord, bar }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.65 * outroFade(bar))),
          oneShot(0, 0, ({ time }) => pad(time, [50, 57, 62, 69], 96 * SIXTEENTH, 0.7)),
        ],
      },
    ],
  });

  function rollingBassTrack({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const steps: Record<number, [number, number]> = { 0: [0, 1], 3: [0, 0.7], 6: [7, 0.75], 8: [0, 0.85], 11: [0, 0.65], 14: [7, 0.75] };
    if (step in steps) bass(time, chord.bass + steps[step][0], steps[step][1], 0.7);
  }

  function rollingArpHit({ time, step, chord }: { time: number; step: number; chord: Chord }, vel: number) {
    const order = [0, 2, 1, 3, 2, 0, 3, 1];
    arp(time, chord.arp[order[(step / 2) % order.length]], vel);
  }

  function outroFade(bar: number) {
    return Math.max(0, 1 - (bar - DOWNPOUR_BARS.outro) / (DOWNPOUR_BARS.end - DOWNPOUR_BARS.outro - 1));
  }

  function scheduleStep({ position, time, mode }: { position: number; time: number; mode: 'ambient' | 'run' }) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices -----------------------------------------------------------------

  const voices = createDownpourVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, snare, hat, openHat, ride, crash, bass, wobble, pad, arp, stab, lead, riser, impact, thunder, noiseHit, playerSends, playerTone, playerNoise } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.18 }],
    duration: 0.17,
    stopPadding: 0.04,
    envelope: { decay: 0.17 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.075,
    stopPadding: 0.016,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const hitTriangleVoice = voice<{ cutoff: number; gainValue: number; decay: number; stopPadding: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: ({ stopPadding }) => stopPadding,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageTriangleVoice = voice<{ gainValue: number; decay: number; stopPadding: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: ({ stopPadding }) => stopPadding,
    envelope: { decay: ({ decay }) => decay },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 4, frequency: 850 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.48,
    stopPadding: 0.05,
    envelope: { decay: 0.48 },
  });

  const playerHitStabVoice = voice({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.12,
    stopPadding: 0.03,
    envelope: { decay: 0.12 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.042 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  // ---- player instruments ---------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof DownpourTonalVoice) {
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
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killBodyVoice.play({ context: ctx, time, midi: midi + 12, decay, gain: gain * 0.6, destination: output, sends: playerSends(0.5, 0.2) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.022 + sparkle * 0.045, 0.09, 7000);
  }

  function gunshipChip(time: number, intensity: number) {
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
      frequency: root * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.12 }],
      filter: { type: 'lowpass', frequency: 800 + intensity * 2600 },
      gainAutomation: [
        { type: 'set', value: 0.22 + intensity * 0.16, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.44 },
      ],
      destination: output,
    });
    playerNoise(time, 0.1 + intensity * 0.08, 0.1, 4800);
  }

  function gunshipFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.16, 1.3);
    impact(time, 1.3);
    crash(time, 0.3);
    pad(time + 0.08, [chord.bass, ...chord.pad, ...chord.stab.map((midi) => midi + 12)], 6, 1.1);
    riser(time, 0.7, 0.14);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      const at = time + index * THIRTYSECOND;
      playerTone(at, midi + 12, PLAYER_VOICES[5].kill, 0.85 - index * 0.06, 1);
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
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.014 + sparkle * 0.03, 0.024, 8800);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.14 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[mix.to].lock, 0.35, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fireVoiceSpec = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: fireVoiceSpec.oscillator,
        cutoff: fireVoiceSpec.cutoff,
        gainValue: fireVoiceSpec.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fireVoiceSpec.fallSemitones), time: time + 0.062 }],
        destination: output,
        sends: playerSends(0.16, 0.08),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.024, 4600);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === gunshipId) {
      gunshipMaxHp = Math.max(gunshipMaxHp, hitPointsRemaining + 1);
      gunshipChip(time, 1 - hitPointsRemaining / Math.max(1, gunshipMaxHp));
      return;
    }
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      const at = time + index * THIRTYSECOND;
      hitTriangleVoice.play({
        context,
        time: at,
        midi: midi + 12,
        cutoff: 3500,
        gainValue: 0.05 - index * 0.008,
        decay: 0.085,
        stopPadding: 0.02,
        destination: output,
        sends: playerSends(0.2, 0.16),
      });
    }
    playerNoise(time, 0.042, 0.032, 5400);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output || !runtime.mix()?.reverbSend) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.2, 0.12, 2500);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageTriangleVoice.play({
        context: ctx,
        time,
        midi,
        gainValue: 0.13,
        decay: 0.58,
        stopPadding: 0.06,
        destination: output,
        sends: playerSends(0.24, 0.5),
      });
    }
    if (enemyId === gunshipId) riser(time, 1.2, 0.16);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === gunshipId) {
      gunshipFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.9 : 0.68);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.58 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[220, time, 0.15], [233, time + 0.02, 0.11]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.4, time: at + 0.16 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.08, 'bandpass', 600);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      const at = time + index * 0.12;
      playerHitStabVoice.play({ context, time: at, midi, destination: output, sends: playerSends(0.12, 0.08) });
    });
    noiseHit(time, 0.19, 0.15, 'bandpass', 780);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.1 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'gunship') {
      gunshipId = enemyId;
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      riser(time, 1.8, 0.18);
      thunder(time + 0.1, 0.7);
    }
  });

  return runtime;
}
