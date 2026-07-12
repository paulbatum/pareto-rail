import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createDownpourVoices, installRainAmbience, type DownpourTonalVoice } from './audio-voices';
import {
  DOWNPOUR_BARS,
  DOWNPOUR_BPM,
  DOWNPOUR_DURATION,
  DOWNPOUR_SCORE_SECTIONS,
  DOWNPOUR_STEPS_PER_BAR,
  DOWNPOUR_TIME,
  LIGHTNING_BARS,
} from './timing';

// The Downpour score: 176 BPM drum & bass in C minor, 44 bars = exactly the
// 60-second run. Weather-noise and sparse pads at the storm ceiling; the two
// great descents (bar 8 tower plunge, bar 16 undercity dive) are the drops
// that open the rolling breaks; the canal turns half-time and menacing as the
// gunship shadows the run; the hunt (bars 32–40) carries an acid lead reserved
// for the gunship; the summit (40–44) is a near-silent moonlit release.
// Lightning strikes are authored in LIGHTNING_BARS so the sky and the score
// crack together. Player actions snap to the transport and read the live
// harmony; kills walk a hidden lane so chained volleys play melodic runs.

const SIXTEENTH = DOWNPOUR_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = DOWNPOUR_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Cm — Ab — Fm — G, two bars each.
const CHORDS: Chord[] = [
  { bass: 36, pad: [48, 55, 58, 63], arp: [60, 63, 67, 72], stab: [63, 67, 72] }, // Cm
  { bass: 32, pad: [44, 51, 56, 60], arp: [56, 60, 63, 68], stab: [60, 63, 68] }, // Ab
  { bass: 29, pad: [41, 48, 53, 60], arp: [53, 56, 60, 65], stab: [56, 60, 65] }, // Fm
  { bass: 31, pad: [43, 50, 55, 62], arp: [55, 59, 62, 67], stab: [59, 62, 67] }, // G
];
// Hunt section: Cm — Db — Cm — G. The flat second is the gunship circling.
const HUNT_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 37, pad: [49, 53, 56, 61], arp: [61, 65, 68, 73], stab: [61, 65, 68] }, // Db
  CHORDS[0],
  CHORDS[3],
];

type SectionIndex = 0 | 1 | 2 | 3;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Storm ceiling: slow glassy climbs, raindrops finding a melody.
  0: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 5, 6, 5, 4, 3, 4, 5,
    6, 5, 4, 3, 2, 3, 4, 2,
  ],
  // Streets & undercity: jump-cut broken chords for rolling-break volleys.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    7, 5, 6, 4, 5, 3, 4, 1,
  ],
  // Canal: low, spaced, ominous — leaving room for the half-time bass.
  2: [
    0, 3, 1, 4, 2, 5, 3, 6,
    2, 4, 3, 5, 4, 6, 5, 7,
    3, 1, 4, 2, 5, 3, 6, 4,
    5, 4, 3, 2, 3, 2, 1, 0,
  ],
  // Hunt: urgent high fragments answered by tolling descents.
  3: [
    7, 5, 6, 4, 7, 5, 6, 4,
    5, 6, 7, 6, 5, 4, 3, 4,
    6, 4, 5, 3, 4, 2, 3, 1,
    4, 5, 6, 7, 6, 5, 4, 0,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: DownpourTonalVoice; kill: DownpourTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 3400, gain: 0.12, sparkle: 0.55, reverb: 0.24 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3000, gain: 0.15, sparkle: 0.7, reverb: 0.32 },
    fire: { oscillator: 'triangle', cutoff: 3200, gain: 0.07, fallSemitones: 11, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2800, gain: 0.05, sparkle: 0.4, reverb: 0.14 },
    kill: { oscillator: 'square', decay: 0.19, cutoff: 3200, gain: 0.11, sparkle: 0.6, reverb: 0.22 },
    fire: { oscillator: 'sawtooth', cutoff: 4000, gain: 0.06, fallSemitones: 8, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'triangle', decay: 0.11, cutoff: 2400, gain: 0.09, sparkle: 0.3, reverb: 0.3 },
    kill: { oscillator: 'sawtooth', decay: 0.26, cutoff: 2600, gain: 0.11, sparkle: 0.5, reverb: 0.36 },
    fire: { oscillator: 'square', cutoff: 3000, gain: 0.055, fallSemitones: 12, noise: 0.04 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.08, cutoff: 3800, gain: 0.05, sparkle: 0.5, reverb: 0.2 },
    kill: { oscillator: 'sawtooth', decay: 0.24, cutoff: 4200, gain: 0.12, sparkle: 0.8, reverb: 0.28 },
    fire: { oscillator: 'sawtooth', cutoff: 5000, gain: 0.065, fallSemitones: 12, noise: 0.055 },
  },
};

// Acid hunt theme, one 8-bar phrase (bars 32–40). [bar, step(8ths), midi, beats]
const LEAD_THEME: Array<[number, number, number, number]> = [
  [0, 0, 60, 1], [0, 2, 63, 0.5], [0, 3, 62, 0.5], [0, 4, 60, 2],
  [1, 0, 61, 1.5], [1, 3, 65, 0.5], [1, 4, 61, 2],
  [2, 0, 67, 1], [2, 2, 63, 1], [2, 4, 60, 2],
  [3, 0, 62, 1], [3, 2, 59, 1], [3, 4, 55, 2],
  [4, 0, 72, 1], [4, 2, 70, 0.5], [4, 3, 67, 0.5], [4, 4, 63, 2],
  [5, 0, 61, 1.5], [5, 3, 68, 0.5], [5, 4, 65, 2],
  [6, 0, 67, 3],
  [7, 0, 62, 1], [7, 2, 59, 1], [7, 4, 60, 1.5],
];

// Lightning positions in transport steps; the drops strike hardest.
const LIGHTNING_STEPS = new Map<number, number>(
  LIGHTNING_BARS.map((atBar) => [
    Math.round(atBar * STEPS_PER_BAR),
    atBar === DOWNPOUR_BARS.plunge || atBar === DOWNPOUR_BARS.undercity || atBar === DOWNPOUR_BARS.canal ? 1 : 0.55,
  ]),
);

export function createAudio(bus: EventBus) {
  return createDownpourAudio(bus).audio;
}

export const traceDownpourAudio = createAudioTraceHarness({
  level: 'downpour-wpxk',
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
    alternateChordSets: [{ fromBar: DOWNPOUR_BARS.hunt, toBar: DOWNPOUR_BARS.summit, chords: HUNT_CHORDS, barsPerChord: 2 }],
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
      compressor: { threshold: -16, ratio: 5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2200 },
      reverb: { seconds: 2.6, decay: 2.8, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      installRainAmbience(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      gunshipId = -1;
      gunshipMaxHp = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, [48, 55, 60, 63, 67], 6, 0.9);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler --------------------------------------------------------------

  const blankBar = '................';
  const evenArp = 'A.A.A.A.A.A.A.A.';
  const beatArp = 'A...A...A...A...';
  const evenHat = 'h.H.h.H.h.H.h.H.';
  const busyHat = 'hoHohoHohoHohoHo';
  const rollGhost = '.......G........' + '...............G';
  const evenBarPad = 'P...............................';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const atBar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(atBar / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          hits(evenBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.65)),
          hits(beatArp, { A: 0.7 }, ({ time, step, chord }) => arp(time, chord.arp[(step / 4) % chord.arp.length], 0.35)),
          fn(({ time, step, bar }) => { if (bar % 8 === 5 && step === 0) thunder(time, 0.3); }),
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
        // Storm ceiling: rain, pads, a pulse finding its feet.
        name: 'ceiling',
        fromBar: DOWNPOUR_BARS.ceiling,
        tracks: [
          hits('P...............................................................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.85)),
          hits(beatArp, { A: 1 }, ({ time, step, bar, chord }) => arp(time, chord.arp[(step / 4) % chord.arp.length], 0.26 + bar * 0.04)),
          hits([blankBar, blankBar, blankBar, blankBar, 'K...............', 'K.......k.......', 'K.......k.......', 'K.......k.......'].join(''), { K: 0.7, k: 0.5 }, ({ time }, vel) => kick(time, vel)),
          hits([blankBar, blankBar, blankBar, blankBar, blankBar, '..H...H...H...H.', '..H...H...H...H.', '..H...H...H...H.'].join(''), { H: 0.03 }, ({ time }, vel) => hat(time, vel, 0.025)),
          hits([blankBar, blankBar, blankBar, blankBar, blankBar, blankBar, 'B...............', 'B.......B.......'].join(''), { B: 0.6 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.3)),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.22)),
          fn(({ time, step, bar }) => { if (bar === 7 && step >= 8) snare(time, 0.2 + (step - 8) * 0.07); }),
        ],
      },
      {
        // The plunge and the streets: full rolling breaks.
        name: 'plunge',
        fromBar: DOWNPOUR_BARS.plunge,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1.05)),
          hits('K.........k.....', { K: 1, k: 0.88 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.9 }, ({ time }, vel) => snare(time, vel)),
          hits(rollGhost, { G: 0.3 }, ({ time }, vel) => snare(time, vel)),
          hits(evenHat, { h: 0.04, H: 0.08 }, ({ time }, vel) => hat(time, vel, 0.028)),
          fn(({ time, step, bar }) => { if (bar % 4 === 2 && step === 2) openHat(time, 0.09); }),
          fn(rollBassTrack(false)),
          hits(evenArp, { A: 0.6 }, rollArpHit(false)),
          hits('S...............' + blankBar, { S: 0.6 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 8 === 0) pad(time, chord.pad, 64 * SIXTEENTH, 0.5); }),
        ],
      },
      {
        // The undercity: darker, busier — trains and sodium light.
        name: 'undercity',
        fromBar: DOWNPOUR_BARS.undercity,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1.15)),
          hits('K.....k...k.....', { K: 1, k: 0.88 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.92 }, ({ time }, vel) => snare(time, vel)),
          hits(rollGhost, { G: 0.32 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.045, H: 0.085, o: 0.028 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          hits('..R...R...R...R.', { R: 0.045 }, ({ time }, vel) => ride(time, vel)),
          fn(rollBassTrack(true)),
          hits(evenArp, { A: 0.85 }, rollArpHit(true)),
          hits('S...............' + blankBar, { S: 0.75 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 8 === 0) pad(time, chord.pad, 64 * SIXTEENTH, 0.45); }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.24)),
        ],
      },
      {
        // The canal: half-time menace. The gunship's shadow crosses the water.
        name: 'canal',
        fromBar: DOWNPOUR_BARS.canal,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1.1)),
          hits('K...........k...', { K: 1, k: 0.5 }, ({ time }, vel) => kick(time, vel)),
          hits('........S.......', { S: 0.95 }, ({ time }, vel) => snare(time, vel)),
          hits('..h...h...h...h.', { h: 0.035 }, ({ time }, vel) => hat(time, vel, 0.03)),
          fn(({ time, step, chord }) => {
            // Long, prowling half-time bass: root, dead air, low approach notes.
            const menace: Record<number, [number, number]> = { 0: [0, 1], 10: [-2, 0.6], 12: [0, 0.75] };
            if (step in menace) bass(time, chord.bass + menace[step][0], menace[step][1], 0.85);
          }),
          hits(beatArp, { A: 0.4 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
          hits(evenBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.8)),
          fn(({ time, step, bar }) => { if (bar >= 30 && step === 0) alarm(time, bar % 2 === 0 ? 43 : 49, 16 * SIXTEENTH); }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.28)),
          fn(({ time, step, bar }) => { if (bar === 31 && step >= 8) snare(time, 0.14 + (step - 8) * 0.05); }),
        ],
      },
      {
        // The hunt: half-time weight with double-time hats; the acid lead
        // belongs to the gunship alone.
        name: 'hunt',
        fromBar: DOWNPOUR_BARS.hunt,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.25);
            crash(time, 0.28);
          }),
          hits('K.....k.........', { K: 1, k: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits('........S.......', { S: 1 }, ({ time }, vel) => snare(time, vel)),
          hits('.......G......G.', { G: 0.28 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.05, H: 0.09, o: 0.03 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          hits('..R...R...R...R.', { R: 0.05 }, ({ time }, vel) => ride(time, vel)),
          fn(({ time, step, chord }) => {
            const growl: Record<number, [number, number]> = { 0: [0, 1], 6: [1, 0.7], 8: [0, 0.9], 11: [-2, 0.7], 14: [0, 0.8] };
            if (step in growl) bass(time, chord.bass + growl[step][0], growl[step][1], 1);
          }),
          hits('S...............' + blankBar, { S: 0.85 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar }) => {
            const themeBar = (bar - DOWNPOUR_BARS.hunt) % 8;
            if (step % 2 !== 0) return;
            for (const [noteBar, noteStep, midi, beats] of LEAD_THEME) {
              if (noteBar === themeBar && noteStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.8);
            }
          }),
          oneShot(7, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.24)),
        ],
      },
      {
        // The summit: above the clouds. Nearly nothing — moonlight and the
        // storm thinning out below.
        name: 'summit',
        fromBar: DOWNPOUR_BARS.summit,
        toBar: DOWNPOUR_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            kick(time, 0.8);
            crash(time, 0.2);
            pad(time, chord.pad.map((midi) => midi + 12), 64 * SIXTEENTH, 1);
          }),
          hits(beatArp, { A: 0.35 }, ({ time, step, bar, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length] + 12, vel * summitFade(bar))),
          hits('B...............................', { B: 0.4 }, ({ time, bar, chord }, vel) => bass(time, chord.bass + 12, vel * summitFade(bar), 0.1)),
          oneShot(2, 0, ({ time, chord }) => pad(time, [chord.bass + 24, ...chord.pad.map((midi) => midi + 12)], 32 * SIXTEENTH, 0.8)),
        ],
      },
    ],
  });

  function rollArpHit(busy: boolean) {
    return ({ time, step, chord }: { time: number; step: number; chord: Chord }, vel: number) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      const octave = busy && step >= 8 ? 12 : 0;
      arp(time, chord.arp[order[(step / 2) % order.length]] + octave, vel);
    };
  }

  function rollBassTrack(busy: boolean) {
    return ({ time, step, chord }: { time: number; step: number; chord: Chord }) => {
      const steps: Record<number, [number, number]> = busy
        ? { 0: [0, 1], 3: [0, 0.75], 5: [12, 0.55], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.7], 13: [3, 0.6], 14: [7, 0.8] }
        : { 0: [0, 1], 3: [0, 0.75], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.7], 14: [7, 0.8] };
      if (step in steps) bass(time, chord.bass + steps[step][0], steps[step][1], busy ? 0.85 : 0.65);
    };
  }

  function summitFade(atBar: number) {
    return Math.max(0.15, 1 - (atBar - DOWNPOUR_BARS.summit) / 3.2);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      ambientArrangement.schedule(position, time);
      return;
    }
    runArrangement.schedule(position, time);
    // Authored lightning: the strike sound lands exactly on the written step;
    // the sky flash is driven by the same bar table on the visual side.
    const vel = LIGHTNING_STEPS.get(position);
    if (vel !== undefined) thunder(time, vel);
  }

  // ---- voices -------------------------------------------------------------------

  const voices = createDownpourVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, snare, hat, openHat, ride, crash, bass, pad, arp, stab, lead, alarm, riser, impact, thunder, noiseHit, playerSends, playerTone, playerNoise } = voices;

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
    oscillators: [{ type: 'sine', octave: 1, gain: 0.32 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.18 }],
    duration: 0.18,
    stopPadding: 0.04,
    envelope: { decay: 0.18 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.075,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const hitChimeVoice = voice<{ cutoff: number; gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  // Rejection: a shorted neon sign — a dead buzz that never resolves.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.18,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 520 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.46 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const playerHitStabVoice = voice({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.12,
    stopPadding: 0.03,
    envelope: { decay: 0.12 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  // ---- player instruments -------------------------------------------------------
  // Player actions are written into the score: everything snaps to the
  // transport, reads the live chord, and sends tails into the same delay and
  // hall as the arrangement. Kills walk a hidden two-bar lane so a clean
  // volley plays a melodic run through the rain.

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
    const vel = Math.min(1.45, 1 + chain * 0.14);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.5, 0.18) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.025 + sparkle * 0.05, 0.09, 7200);
  }

  function gunshipChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    // The gunship's own voice answers each wound — the acid lead, climbing
    // and brightening with the damage dealt.
    lead(time, chord.stab[0] + Math.round(intensity * 12), 0.22 + intensity * 0.2, 0.5 + intensity * 0.5);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: root * 4,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.22 + intensity * 0.18, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.44 },
      ],
      destination: output,
    });
    playerNoise(time, 0.09 + intensity * 0.08, 0.1, 5000);
  }

  function gunshipFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.14, 1.4);
    impact(time, 1.4);
    thunder(time + 0.05, 1);
    pad(time + 0.08, [chord.bass, ...chord.pad, ...chord.stab.map((midi) => midi + 12)], 5, 1.1);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      playerTone(time + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[3].kill, 0.9 - index * 0.06, 1);
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
    playerNoise(time, 0.015 + sparkle * 0.035, 0.025, 9000);
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
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.35, 1);
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
      const fire = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: fire.oscillator,
        cutoff: fire.cutoff,
        gainValue: fire.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.062 }],
        destination: output,
        sends: playerSends(0.18, 0.08),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.026, 4800);
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
      hitChimeVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        cutoff: 3400,
        gainValue: 0.05 - index * 0.008,
        decay: 0.09,
        destination: output,
        sends: playerSends(0.22, 0.18),
      });
    }
    playerNoise(time, 0.04, 0.035, 5600);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output || !runtime.mix()?.reverbSend) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.2, 0.13, 2600);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageVoice.play({ context: ctx, time, midi, gainValue: 0.13, decay: 0.6, destination: output, sends: playerSends(0.26, 0.55) });
    }
    if (enemyId === gunshipId) {
      // A stage broken off the gunship: its acid voice snarls and the storm answers.
      lead(time, 55 + stageIndex * 7, 0.5, 0.9);
      thunder(time, 0.5);
    }
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
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[208, time, 0.15], [220, time + 0.02, 0.11]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.45, time: at + 0.15 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.08, 'bandpass', 480, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.32 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      playerHitStabVoice.play({ context, time: time + index * 0.13, midi, destination: output, sends: playerSends(0.12, 0.08) });
    });
    noiseHit(time, 0.2, 0.16, 'bandpass', 800, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.11 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'gunship') {
      gunshipId = enemyId;
      // The hunter announces itself over the canal: siren, acid snarl, thunder.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      alarm(time, 43, 1.6);
      lead(time + 0.4, 48, 1.1, 0.85);
      thunder(time, 0.6);
      riser(time, 2, 0.16);
    }
  });

  return runtime;
}
