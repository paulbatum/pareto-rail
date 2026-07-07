import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createHeliosVoices, installHeliosRumble, type HeliosTonalVoice } from './audio-voices';
import { HELIOS_BARS, HELIOS_BPM, HELIOS_DURATION, HELIOS_SCORE_SECTIONS, HELIOS_STEPS_PER_BAR, HELIOS_TIME } from './timing';

// The Helios score: 172 BPM drum & bass in E minor, 86 bars = exactly the
// 120-second run. Sections land on the run's set pieces — drop 1 at the gate
// (bar 16), drop 2 at the corona plunge (bar 40), a breakdown while the
// serpent breaches (56–63), and the boss theme (64–79) with a phrygian F
// leaning on the tonic. The player's guns are not an effects layer: locks,
// shots, armor chips, kills, and boss damage all snap to the transport and
// read the current harmony, while kills unmute a hidden sequencer lane so
// clean volleys play melodic runs through the arrangement.

const SIXTEENTH = HELIOS_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = HELIOS_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Em — C — Am — B, two bars each.
const CHORDS: Chord[] = [
  { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] }, // Em
  { bass: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72], stab: [64, 67, 72] }, // C
  { bass: 33, pad: [45, 52, 57, 60], arp: [57, 60, 64, 69], stab: [60, 64, 69] }, // Am
  { bass: 35, pad: [47, 51, 54, 59], arp: [59, 63, 66, 71], stab: [63, 66, 71] }, // B
];
// Boss section: Em — F — Em — B. The F natural is the serpent.
const BOSS_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], stab: [65, 69, 72] }, // F
  CHORDS[0],
  CHORDS[3],
];

// Lock count is a degree into the current chord's live lead set; the sixth
// lock is ignition. Kills read a hidden two-bar lane in the same degree space.
type SectionIndex = 0 | 1 | 2 | 3;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Approach: slow glassy arches while the wreck field opens up.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Furnace road: jump-cut broken chords for dense DnB volleys.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Corona / burning sea: high, urgent fragments that leave room for the bass.
  2: [
    4, 5, 7, 6, 4, 2, 5, 3,
    6, 7, 5, 4, 6, 3, 5, 2,
    7, 6, 5, 4, 7, 5, 3, 1,
    4, 5, 6, 7, 6, 5, 4, 0,
  ],
  // Suneater: tolling descents answered by climbs into the phrygian boss harmony.
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    3, 2, 1, 0, 4, 3, 2, 1,
    4, 5, 6, 7, 5, 6, 7, 4,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: HeliosTonalVoice; kill: HeliosTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.11, cutoff: 3600, gain: 0.12, sparkle: 0.5, reverb: 0.18 },
    kill: { oscillator: 'triangle', decay: 0.28, cutoff: 3200, gain: 0.15, sparkle: 0.7, reverb: 0.28 },
    fire: { oscillator: 'triangle', cutoff: 3300, gain: 0.07, fallSemitones: 12, noise: 0.035 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.085, cutoff: 2600, gain: 0.055, sparkle: 0.35, reverb: 0.12 },
    kill: { oscillator: 'square', decay: 0.18, cutoff: 3000, gain: 0.11, sparkle: 0.55, reverb: 0.2 },
    fire: { oscillator: 'sawtooth', cutoff: 3800, gain: 0.065, fallSemitones: 7, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.075, cutoff: 3900, gain: 0.052, sparkle: 0.45, reverb: 0.18 },
    kill: { oscillator: 'sawtooth', decay: 0.22, cutoff: 4200, gain: 0.12, sparkle: 0.8, reverb: 0.26 },
    fire: { oscillator: 'sawtooth', cutoff: 5200, gain: 0.07, fallSemitones: 12, noise: 0.06 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.13, cutoff: 2200, gain: 0.06, sparkle: 0.25, reverb: 0.34 },
    kill: { oscillator: 'sawtooth', decay: 0.38, cutoff: 2800, gain: 0.14, sparkle: 0.65, reverb: 0.42 },
    fire: { oscillator: 'square', cutoff: 3000, gain: 0.06, fallSemitones: 13, noise: 0.05 },
  },
};

// Boss lead theme, one 8-bar phrase played twice. [bar, step(8ths), midi, beats]
const LEAD_THEME: Array<[number, number, number, number]> = [
  [0, 0, 76, 1.5], [0, 3, 74, 0.5], [0, 4, 76, 2],
  [1, 0, 79, 1], [1, 2, 77, 1], [1, 4, 76, 1], [1, 6, 74, 1],
  [2, 0, 76, 3],
  [3, 0, 71, 1], [3, 2, 74, 1], [3, 4, 76, 0.5], [3, 5, 74, 0.5], [3, 6, 71, 1],
  [4, 0, 77, 2], [4, 4, 76, 1], [4, 6, 74, 1],
  [5, 0, 76, 1], [5, 2, 74, 1], [5, 4, 71, 1], [5, 6, 69, 1],
  [6, 0, 71, 3.5],
];

export function createAudio(bus: EventBus) {
  return createHeliosAudio(bus).audio;
}

export const traceHeliosAudio = createAudioTraceHarness({
  level: 'helios',
  bpm: HELIOS_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: HELIOS_DURATION,
  createAudio: createHeliosAudio,
});

function createHeliosAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let heartId = -1;
  let heartMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: HELIOS_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: HELIOS_BARS.boss, toBar: HELIOS_BARS.outro, chords: BOSS_CHORDS, barsPerChord: 2 }],
    sections: HELIOS_SCORE_SECTIONS,
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
      delay: { time: SIXTEENTH * 3, feedback: 0.32, dampHz: 2400 },
      reverb: { seconds: 2.4, decay: 2.6, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      installHeliosRumble(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      heartId = -1;
      heartMaxHp = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) choir(context.currentTime + 0.05, [52, 59, 64, 66, 71], 6, 0.9);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler ------------------------------------------------------------

  const blankBar = '................';
  const evenArp = 'A.A.A.A.A.A.A.A.';
  const beatArp = 'A...A...A...A...';
  const evenHat = 'h.H.h.H.h.H.h.H.';
  const busyHat = 'hoHohoHohoHohoHo';
  const dropGhost = '.......G........' + '...............G';
  const bossGhost = '.......G........' + '...........G....';
  const evenBarHit = 'S...............' + blankBar;
  const evenBarChoir = 'C...............................';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(bar / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: HELIOS_BARS.intro,
        tracks: [
          hits(evenBarChoir, { C: 1 }, ({ time, chord }) => choir(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.7)),
          hits(beatArp, { A: 1 }, ({ time, step, chord }) => arp(time, chord.arp[(step / 4) % chord.arp.length], 0.4)),
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
        name: 'intro',
        fromBar: HELIOS_BARS.intro,
        tracks: [
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => choir(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.8)),
          hits(evenArp, { A: 1 }, ({ time, step, bar, chord }) => arp(time, chord.arp[(step / 2) % chord.arp.length], 0.28 + bar * 0.04)),
          hits([blankBar, blankBar, blankBar, blankBar, 'K...............', 'K...............', 'K.......k.......', 'K.......k.......'].join(''), { K: 0.7, k: 0.5 }, ({ time }, vel) => kick(time, vel)),
          hits([blankBar, blankBar, blankBar, blankBar, '..H...H...H...H.', '..H...H...H...H.', '..H...H...H...H.', '..H...H...H...H.'].join(''), { H: 0.035 }, ({ time }, vel) => hat(time, vel, 0.025)),
        ],
      },
      {
        name: 'build',
        fromBar: HELIOS_BARS.build,
        tracks: [
          hits('K.........k.....', { K: 0.95, k: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits('............S...', { S: 0.8 }, ({ time }, vel) => snare(time, vel)),
          hits(evenHat, { h: 0.04, H: 0.07 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits('B.....B....B....', { B: 0.72 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.5)),
          hits(evenArp, { A: 0.55 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length], vel)),
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => choir(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.7)),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
          fn(({ time, step, bar }) => { if (bar === 15 && step >= 8) snare(time, 0.25 + (step - 8) * 0.07); }),
        ],
      },
      {
        name: 'drop-1',
        fromBar: HELIOS_BARS.gate,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1)),
          hits('K.........k.....', { K: 1, k: 0.88 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.9 }, ({ time }, vel) => snare(time, vel)),
          hits(dropGhost, { G: 0.3 }, ({ time }, vel) => snare(time, vel)),
          hits(evenHat, { h: 0.045, H: 0.085 }, ({ time }, vel) => hat(time, vel, 0.028)),
          fn(openHatTrack(false)),
          fn(dropBassTrack(false)),
          hits(evenArp, { A: 0.62 }, dropArpHit(false)),
          hits(evenBarHit, { S: 0.65 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(dropChoirTrack),
        ],
      },
      {
        name: 'shift',
        fromBar: HELIOS_BARS.shift,
        tracks: [
          hits('K.........k.....', { K: 1, k: 0.88 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.9 }, ({ time }, vel) => snare(time, vel)),
          hits(dropGhost, { G: 0.3 }, ({ time }, vel) => snare(time, vel)),
          hits(blankBar + '..............X.', { X: 0.42 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.045, H: 0.085, o: 0.028 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          fn(openHatTrack(false)),
          fn(dropBassTrack(false)),
          hits(evenArp, { A: 0.62 }, dropArpHit(false)),
          hits(evenBarHit, { S: 0.65 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(dropChoirTrack),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.22)),
        ],
      },
      {
        name: 'drop-2',
        fromBar: HELIOS_BARS.corona,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1.1)),
          hits('K.....k...k.....', { K: 1, k: 0.88 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.9 }, ({ time }, vel) => snare(time, vel)),
          hits(dropGhost, { G: 0.3 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.045, H: 0.085, o: 0.028 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          hits('R...R...R...R...', { R: 0.05 }, ({ time }, vel) => ride(time, vel)),
          fn(openHatTrack(true)),
          fn(dropBassTrack(true)),
          hits(evenArp, { A: 1 }, dropArpHit(true)),
          hits(evenBarHit, { S: 0.85 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(dropChoirTrack),
        ],
      },
      {
        name: 'breakdown',
        fromBar: HELIOS_BARS.reveal,
        tracks: [
          hits('K...............', { K: 0.55 }, ({ time }, vel) => kick(time, vel)),
          hits(evenBarChoir, { C: 1 }, ({ time, chord }) => choir(time, chord.pad, 32 * SIXTEENTH * 1.05, 1)),
          hits(beatArp, { A: 0.3 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
          fn(({ time, step, bar }) => { if (bar >= 58 && step === 0) alarmSwell(time, bar % 2 === 0 ? 47 : 53, 16 * SIXTEENTH); }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.26)),
          fn(({ time, step, bar }) => { if (bar === 63) snare(time, 0.16 + step * 0.05); }),
        ],
      },
      {
        name: 'boss',
        fromBar: HELIOS_BARS.boss,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.25);
            crash(time, 0.3);
          }),
          hits('K.........k.....' + 'K.....k...k.....', { K: 1, k: 0.9 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.95 }, ({ time }, vel) => snare(time, vel)),
          hits(bossGhost, { G: 0.32 }, ({ time }, vel) => snare(time, vel)),
          hits([blankBar, blankBar, blankBar, '..............X.'].join(''), { X: 0.5 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.05, H: 0.09, o: 0.03 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          hits('..R...R...R...R.', { R: 0.05 }, ({ time }, vel) => ride(time, vel)),
          fn(bossBassTrack),
          hits(evenBarHit, { S: 0.9 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 8 === 0) choir(time, chord.pad, 128 * SIXTEENTH, 0.5); }),
          fn(({ time, step, bar }) => {
            const themeBar = (bar - HELIOS_BARS.boss) % 8;
            if (step % 2 !== 0) return;
            for (const [noteBar, noteStep, midi, beats] of LEAD_THEME) {
              if (noteBar === themeBar && noteStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.85);
            }
          }),
        ],
      },
      {
        name: 'outro',
        fromBar: HELIOS_BARS.outro,
        toBar: HELIOS_BARS.end,
        tracks: [
          hits('K.........K.....', { K: 0.85 }, ({ time, bar }, vel) => kick(time, vel * outroFade(bar))),
          hits('............S...', { S: 0.7 }, ({ time, bar }, vel) => snare(time, vel * outroFade(bar))),
          hits('H.H.H.H.H.H.H.H.', { H: 0.05 }, ({ time, bar }, vel) => hat(time, vel * outroFade(bar), 0.03)),
          hits('B.......B.......', { B: 0.7 }, ({ time, bar, chord }, vel) => { if (bar < 84) bass(time, chord.bass, vel * outroFade(bar), 0.5); }),
          hits(evenArp, { A: 0.5 }, ({ time, step, bar, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length], vel * outroFade(bar))),
          oneShot(0, 0, ({ time }) => choir(time, [52, 55, 59, 64, 66], 96 * SIXTEENTH, 0.9)),
          oneShot(5, 0, ({ time }) => {
            kick(time, 1);
            crash(time, 0.25);
          }),
        ],
      },
    ],
  });

  function dropArpHit(drop2: boolean) {
    return ({ time, step, chord }: { time: number; step: number; chord: Chord }, vel: number) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      const octave = drop2 && step >= 8 ? 12 : 0;
      arp(time, chord.arp[order[(step / 2) % order.length]] + octave, drop2 ? 0.8 * vel : vel);
    };
  }

  function openHatTrack(drop2: boolean) {
    return ({ time, step, bar }: { time: number; step: number; bar: number }) => {
      if (((bar >= 20 && bar % 8 === 4) || (drop2 && bar % 4 === 2)) && step === 2) openHat(time, 0.1);
    };
  }

  function dropBassTrack(drop2: boolean) {
    return ({ time, step, chord }: { time: number; step: number; chord: Chord }) => {
      const bassSteps: Record<number, [number, number]> = drop2
        ? { 0: [0, 1], 3: [0, 0.75], 5: [12, 0.6], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.7], 13: [3, 0.6], 14: [7, 0.8] }
        : { 0: [0, 1], 3: [0, 0.75], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.7], 14: [7, 0.8] };
      if (step in bassSteps) bass(time, chord.bass + bassSteps[step][0], bassSteps[step][1], drop2 ? 0.9 : 0.7);
    };
  }

  function bossBassTrack({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const bossBass: Record<number, [number, number]> = {
      0: [0, 1], 2: [0, 0.6], 3: [0, 0.8], 6: [7, 0.85], 8: [0, 0.95], 10: [12, 0.6], 11: [0, 0.75], 14: [1, 0.7],
    };
    if (step in bossBass) bass(time, chord.bass + bossBass[step][0], bossBass[step][1], 1);
  }

  function dropChoirTrack({ time, step, bar, chord }: { time: number; step: number; bar: number; chord: Chord }) {
    if (step === 0 && bar % 8 === 0) choir(time, chord.pad, 64 * SIXTEENTH, 0.55);
  }

  function outroFade(bar: number) {
    return 1 - (bar - HELIOS_BARS.outro) / 7;
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices -----------------------------------------------------------------

  const voices = createHeliosVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, snare, hat, openHat, ride, crash, bass, choir, arp, stab, lead, alarmSwell, riser, impact, noiseHit, playerSends, playerTone, playerNoise } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.52 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.34 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.19 }],
    duration: 0.18,
    stopPadding: 0.04,
    envelope: { decay: 0.18 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.078,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.078 },
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
    filter: { type: 'bandpass', Q: 4, frequency: 900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.46 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const playerHitStabVoice = voice({
    oscillators: [{ type: 'square', gain: 0.06 }],
    duration: 0.12,
    stopPadding: 0.03,
    envelope: { decay: 0.12 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.045 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  const flareWarningVoice = voice({
    oscillators: [{ type: 'triangle' }],
    duration: 0.4,
    stopPadding: 0.04,
    gainAutomation: (time) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.05, time: time + 0.26 },
      { type: 'linearRamp', value: 0, time: time + 0.4 },
    ],
  });

  // ---- player instruments ---------------------------------------------------
  // Player actions are written into the score: every positive action snaps to
  // the transport, reads the live chord, and sends tails into the same delay /
  // hall as the arrangement. Kills walk a hidden two-bar sequencer lane so a
  // clean volley performs a melody instead of stacking explosion sounds.

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof HeliosTonalVoice) {
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

  function heartChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.52,
      oscillatorType: 'sine',
      frequency: root * 4,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + intensity * 0.18, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.46 },
      ],
      destination: output,
    });
    for (const midi of chord.stab) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.32,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 1500 + intensity * 3200 },
        gainAutomation: [
          { type: 'set', value: 0.04 + intensity * 0.025, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.27 },
        ],
        destination: output,
        sends: playerSends(0.25, 0.35),
      });
    }
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES[3].kill, 0.45 + intensity * 0.35, 1);
    playerNoise(time, 0.1 + intensity * 0.08, 0.1, 5200);
  }

  function heartFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.14, 1.4);
    impact(time, 1.4);
    choir(time + 0.08, [chord.bass, ...chord.pad, ...chord.stab.map((midi) => midi + 12)], 6, 1.15);
    riser(time, 0.8, 0.14);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      const at = time + index * THIRTYSECOND;
      playerTone(at, midi + 12, PLAYER_VOICES[3].kill, 0.9 - index * 0.06, 1);
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
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    playerTone(time, score.chordAt(score.arrangementPositionAt(time)).bass + 24, PLAYER_VOICES[score.sectionMixAt(score.arrangementPositionAt(time)).to].lock, 0.35, 1);
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
      const voice = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: voice.oscillator,
        cutoff: voice.cutoff,
        gainValue: voice.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - voice.fallSemitones), time: time + 0.065 }],
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
    if (enemyId === heartId) {
      heartMaxHp = Math.max(heartMaxHp, hitPointsRemaining + 1);
      heartChip(time, 1 - hitPointsRemaining / Math.max(1, heartMaxHp));
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
        cutoff: 3600,
        gainValue: 0.055 - index * 0.008,
        decay: 0.09,
        stopPadding: 0.02,
        destination: output,
        sends: playerSends(0.22, 0.18),
      });
    }
    playerNoise(time, 0.045, 0.035, 5600);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output || !runtime.mix()?.reverbSend) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.2, 0.13, 2600);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageTriangleVoice.play({
        context: ctx,
        time,
        midi,
        gainValue: 0.14,
        decay: 0.62,
        stopPadding: 0.06,
        destination: output,
        sends: playerSends(0.26, 0.55),
      });
    }
    if (enemyId === heartId) riser(time, 1.6, 0.18); // it dives — brace
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === heartId) {
      heartFinale(kill.time);
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
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.72);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Rejection: a dead anvil clank with a minor-second snarl — cold iron, no reward.
    for (const [frequency, at, vel] of [[233, time, 0.16], [247, time + 0.02, 0.12]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.4, time: at + 0.16 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.14, 0.08, 'bandpass', 620, output);
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
    // Hull alarm: still alarming, but it borrows the live chord instead of a fixed siren.
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      const at = time + index * 0.13;
      playerHitStabVoice.play({ context, time: at, midi, destination: output, sends: playerSends(0.12, 0.08) });
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
    if (kind === 'heart') {
      heartId = enemyId;
      // The Suneater breaches: a war-horn triad and a long riser.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      riser(time, 2.2, 0.2);
      [28, 40, 47].forEach((midi, index) => {
        const audioMix = runtime.mix();
        if (!ctx || !audioMix?.duck || !audioMix.reverbSend) return;
        const at = time + index * 0.3;
        playOscillatorVoice({
          context: ctx,
          time: at,
          stopTime: at + 1.2,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          filter: {
            type: 'lowpass',
            frequency: 500,
            frequencyAutomation: [{ type: 'linearRamp', value: 1300, time: at + 0.4 }],
          },
          gainAutomation: [
            { type: 'set', value: 0, time: at },
            { type: 'linearRamp', value: 0.2, time: at + 0.05 },
            { type: 'exponentialRamp', value: 0.001, time: at + 1.1 },
          ],
          destination: audioMix.duck,
          sends: [{ destination: audioMix.reverbSend, gain: 0.55 }],
        });
      });
    } else if (kind === 'flare') {
      const output = sfxDestination();
      if (!output) return;
      // Prominence warning: a short upward siren voiced from the live arp.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      const sourceMidi = leadSet[enemyId % 4];
      flareWarningVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi + 12), time: time + 0.34 }],
        destination: output,
        sends: playerSends(0.16, 0.14),
      });
    }
  });

  return runtime;
}
