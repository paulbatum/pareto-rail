import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSkyhookVoices, installSkyhookBeds, type SkyhookBeds, type SkyhookTonalVoice } from './audio-voices';
import { skyhookSignals } from './signals';
import {
  LIGHTNING_STEPS,
  SKYHOOK_BARS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_SCORE_SECTIONS,
  SKYHOOK_STEPS_PER_BAR,
  SKYHOOK_TIME,
} from './timing';

// The Skyhook score: 128 BPM in D major, 32 bars = exactly the 60-second
// climb. It is scored the way the air behaves. Down in the weather the mix is
// wide and full — rain and wind beds, a soft four-on-the-floor, brushed snare,
// two detuned saws for a pad, sub bass, a sixteenth-note pluck. Every section
// up takes a layer away: the rain cuts at the deck, the snare goes at the
// thinning, the kick and the pad's width go at vacuum, and by the dock there
// is a sine pedal, a clock tick and a bell. The player's guns are notes in
// this score: locks, shots, hits and kills snap to the transport, read the
// live chord, and kills walk a hidden two-bar lane so a chained volley plays
// a melodic run. The Tetherjack owns the black section: its lurches are the
// downbeat thuds, its drone rises with proximity, and the killing blow lands
// a resolving figure on the grid.

const SIXTEENTH = SKYHOOK_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SKYHOOK_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// D — A/C# — Bm — G, two bars each: the climb keeps lifting.
const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 54, 57, 61, 64], arp: [62, 66, 69, 73], stab: [66, 69, 73] }, // Dmaj9
  { bass: 37, pad: [49, 52, 57, 61, 64], arp: [61, 64, 69, 73], stab: [64, 69, 73] }, // A/C#
  { bass: 35, pad: [47, 50, 54, 57, 62], arp: [59, 62, 66, 69], stab: [62, 66, 69] }, // Bm7
  { bass: 31, pad: [43, 47, 50, 54, 57], arp: [55, 59, 62, 66], stab: [59, 62, 66] }, // Gmaj9
];
// Black sky: Bm — G — Em — F#. The F# major is the thing on the tether.
const BOSS_CHORDS: Chord[] = [
  CHORDS[2],
  CHORDS[3],
  { bass: 40, pad: [52, 55, 59, 62, 64], arp: [64, 67, 71, 74], stab: [67, 71, 74] }, // Em9
  { bass: 42, pad: [54, 58, 61, 66], arp: [66, 70, 73, 78], stab: [70, 73, 78] }, // F#
];
// Docked: home.
const DOCK_CHORDS: Chord[] = [CHORDS[0]];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Kill lanes: degrees into the live lead set (arp plus its octave), 32 steps.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Weather: wide rolling arches.
  0: [
    0, 2, 4, 5, 4, 2, 0, 2,
    1, 3, 5, 7, 5, 3, 1, 3,
    2, 4, 6, 7, 6, 4, 2, 4,
    3, 5, 7, 6, 5, 4, 3, 1,
  ],
  // Sunlit: bright, climbing figures.
  1: [
    4, 5, 6, 7, 6, 5, 4, 5,
    6, 7, 4, 5, 6, 7, 5, 4,
    0, 2, 4, 6, 7, 6, 4, 2,
    3, 5, 7, 5, 3, 1, 3, 5,
  ],
  // Thin: high fragments with air between them.
  2: [
    7, 5, 7, 4, 6, 4, 5, 3,
    7, 6, 5, 4, 3, 2, 1, 0,
    4, 6, 7, 5, 4, 2, 3, 1,
    6, 7, 5, 6, 4, 5, 3, 4,
  ],
  // Vacuum: tolling descents against the Tetherjack's harmony.
  3: [
    7, 6, 5, 4, 3, 2, 1, 0,
    6, 5, 4, 3, 2, 1, 0, 2,
    7, 5, 3, 1, 6, 4, 2, 0,
    5, 4, 3, 2, 1, 0, 1, 3,
  ],
  // Dock: resolving triads.
  4: [
    0, 4, 7, 4, 0, 2, 4, 7,
    7, 4, 2, 0, 4, 2, 0, 4,
    0, 4, 7, 4, 7, 4, 0, 2,
    4, 7, 4, 0, 7, 4, 2, 0,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// The player's timbre thins with the air: warm triangle plucks and long
// reverb down low, dry sine clicks in vacuum.
const PLAYER_VOICES: Record<SectionIndex, { lock: SkyhookTonalVoice; kill: SkyhookTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.15, cutoff: 3000, gain: 0.13, sparkle: 0.5, reverb: 0.32 },
    kill: { oscillator: 'triangle', decay: 0.36, cutoff: 3400, gain: 0.16, sparkle: 0.7, reverb: 0.42 },
    fire: { oscillator: 'sawtooth', cutoff: 2600, gain: 0.06, fallSemitones: 10, noise: 0.05 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.13, cutoff: 3800, gain: 0.12, sparkle: 0.55, reverb: 0.24 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 4000, gain: 0.15, sparkle: 0.75, reverb: 0.3 },
    fire: { oscillator: 'sawtooth', cutoff: 3200, gain: 0.06, fallSemitones: 10, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sine', decay: 0.11, cutoff: 4400, gain: 0.15, sparkle: 0.4, reverb: 0.14 },
    kill: { oscillator: 'sine', decay: 0.26, cutoff: 4600, gain: 0.17, sparkle: 0.6, reverb: 0.18 },
    fire: { oscillator: 'triangle', cutoff: 3600, gain: 0.07, fallSemitones: 12, noise: 0.03 },
  },
  3: {
    lock: { oscillator: 'sine', decay: 0.09, cutoff: 5200, gain: 0.15, sparkle: 0.3, reverb: 0.06 },
    kill: { oscillator: 'sine', decay: 0.22, cutoff: 5400, gain: 0.17, sparkle: 0.5, reverb: 0.08 },
    fire: { oscillator: 'square', cutoff: 2800, gain: 0.045, fallSemitones: 14, noise: 0.018 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.14, cutoff: 4000, gain: 0.12, sparkle: 0.3, reverb: 0.3 },
    kill: { oscillator: 'sine', decay: 0.4, cutoff: 3600, gain: 0.14, sparkle: 0.4, reverb: 0.45 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.05, fallSemitones: 10, noise: 0.02 },
  },
};

// Sunlit motif, bars 8–12: the sky opens. [bar, step(8ths), midi, beats]
const SUN_MOTIF: Array<[number, number, number, number]> = [
  [0, 0, 74, 1.5], [0, 3, 76, 0.5], [0, 4, 78, 2],
  [1, 0, 81, 1], [1, 2, 78, 1], [1, 4, 76, 2],
  [2, 0, 74, 1], [2, 2, 76, 1], [2, 4, 78, 1], [2, 6, 81, 1],
  [3, 0, 85, 3],
];

// The Tetherjack's figure, two bars, repeated while it holds the tether.
const BOSS_MOTIF: Array<[number, number, number, number]> = [
  [0, 0, 66, 1], [0, 2, 71, 0.5], [0, 3, 69, 0.5], [0, 4, 66, 1.5],
  [1, 0, 67, 1], [1, 4, 70, 1.5],
];

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-2j6o',
  bpm: SKYHOOK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let beds: SkyhookBeds | null = null;
  let coreId = -1;
  let brainId = -1;
  let coreMaxHp = 0;
  let coreAlive = false;
  let coreEngaged = false;
  let clampedCount = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: SKYHOOK_BARS.vacuum, toBar: SKYHOOK_BARS.dock, chords: BOSS_CHORDS, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end, chords: DOCK_CHORDS, barsPerChord: 4 },
    ],
    sections: SKYHOOK_SCORE_SECTIONS,
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
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2600 },
      reverb: { seconds: 2.8, decay: 2.4, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      beds = installSkyhookBeds(context, mix);
      // Waiting at the anchor: the storm is already here.
      beds?.setRain(0.7, context.currentTime, 2);
      beds?.setWind(0.6, context.currentTime, 2);
    },
    onStep: scheduleStep,
    onRunStart() {
      coreId = -1;
      brainId = -1;
      coreMaxHp = 0;
      coreAlive = false;
      coreEngaged = false;
      clampedCount = 0;
      const context = runtime.context();
      if (context && beds) {
        beds.setRain(1, context.currentTime, 0.4);
        beds.setWind(0.8, context.currentTime, 0.6);
        beds.setHum(0, context.currentTime, 0.3);
        beds.setDrone(0, 0, context.currentTime, 0.2);
      }
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      beds?.setDrone(0, 0, context.currentTime, 0.4);
      beds?.setHum(0, context.currentTime, 2);
      beds?.setRain(0.5, context.currentTime + 1, 4);
      beds?.setWind(0.5, context.currentTime + 1, 4);
      pad(context.currentTime + 0.05, CHORDS[0].pad, 7, 0.7, 0.85);
    },
    onDispose() {
      ctx = null;
      beds = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler ------------------------------------------------------------

  const blankBar = '................';
  const twoBarPad = 'P...............' + blankBar;
  const fourBarPad = twoBarPad + blankBar + blankBar;

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
          hits(fourBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.04, 0.55, 0.8)),
          hits('A.......A.......', { A: 0.3 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[(step / 8) % chord.arp.length], vel)),
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
        name: 'weather',
        fromBar: SKYHOOK_BARS.weather,
        tracks: [
          hits('K...K...K...K...', { K: 0.85 }, ({ time }, vel) => kick(time, vel, 1)),
          hits('....S.......S...', { S: 0.7 }, ({ time }, vel) => snare(time, vel)),
          hits('h.h.h.h.h.h.h.h.' + 'h.h.h.h.h.h.h.o.', { h: 0.045, o: 0.07 }, ({ time }, vel, symbol) => (symbol === 'o' ? openHat(time, vel) : hat(time, vel, 0.03))),
          hits(twoBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.85, 1)),
          hits('B.......B...b...', { B: 0.9, b: 0.7 }, ({ time, chord }, vel, symbol) => bass(time, chord.bass + (symbol === 'b' ? 7 : 0), vel, 0.42)),
          hits('A.a.A.a.A.a.A.a.', { A: 0.62, a: 0.42 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[WEATHER_ARP[(step / 2) % 8]], vel)),
          fn(({ time, bar, step }) => {
            if (LIGHTNING_STEPS.some(([lightningBar, lightningStep]) => lightningBar === bar && lightningStep === step)) thunder(time, 0.9);
          }),
          fn(({ time, bar, step }) => {
            if (bar === 7 && step >= 8) snare(time, 0.2 + (step - 8) * 0.06);
          }),
          oneShot(6, 8, ({ time }) => riser(time, 24 * SIXTEENTH, 0.22)),
        ],
      },
      {
        name: 'sunlit',
        fromBar: SKYHOOK_BARS.deck,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.0);
            beds?.setRain(0, time, 0.5);
            beds?.setWind(0.45, time, 1.5);
          }),
          hits('K...K...K...K...', { K: 0.9 }, ({ time }, vel) => kick(time, vel, 0.8)),
          hits('....S.......S...', { S: 0.72 }, ({ time }, vel) => snare(time, vel)),
          hits('h.H.h.H.h.H.h.H.', { h: 0.035, H: 0.06 }, ({ time }, vel) => hat(time, vel, 0.028)),
          hits(twoBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad.slice(0, 4), 32 * SIXTEENTH * 1.04, 0.8, 0.6)),
          hits('B..B....B..B....', { B: 0.85 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.3)),
          hits('A.A.A.A.A.A.A.A.', { A: 0.5 }, ({ time, step, bar, chord }, vel) => pluck(time, chord.arp[SUNLIT_ARP[(step / 2) % 8]] + (bar < 10 ? 12 : 0), vel)),
          fn(({ time, step, barInSection }) => {
            if (barInSection > 3 || step % 2 !== 0) return;
            for (const [motifBar, motifStep, midi, beats] of SUN_MOTIF) {
              if (motifBar === barInSection && motifStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.75);
            }
          }),
          oneShot(4, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.16)),
        ],
      },
      {
        name: 'thin',
        fromBar: SKYHOOK_BARS.thin,
        tracks: [
          oneShot(0, 0, ({ time }) => beds?.setWind(0.22, time, 2)),
          hits('K.......K.......', { K: 0.7 }, ({ time }, vel) => kick(time, vel, 0.3)),
          hits('....t.......t...', { t: 0.04 }, ({ time }, vel) => tick(time, vel)),
          hits(fourBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad.slice(1, 4), 64 * SIXTEENTH * 1.03, 0.65, 0.25)),
          hits('B...............', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.9)),
          hits('A...A...A...A...', { A: 0.36 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[[3, 2, 3, 1][(step / 4) % 4]] + 12, vel)),
          oneShot(3, 0, ({ time }) => riser(time, 48 * SIXTEENTH, 0.24)),
          fn(({ time, barInSection, step }) => {
            if (barInSection === 5 && step % 4 === 0) tick(time, 0.06 + (step / 4) * 0.02);
          }),
        ],
      },
      {
        name: 'vacuum',
        fromBar: SKYHOOK_BARS.vacuum,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.15);
            crash(time, 0.3);
            beds?.setWind(0, time, 1.2);
          }),
          // The Tetherjack's lurches are the downbeats, louder as it nears.
          fn(({ time, step, barInSection }) => {
            if (step !== 0 || !coreAlive) return;
            thud(time, Math.min(1, 0.45 + barInSection * 0.08));
          }),
          hits('....t.......t...', { t: 0.03 }, ({ time }, vel) => tick(time, vel)),
          hits(fourBarPad, { P: 1 }, ({ time, chord }) => pad(time, [chord.bass + 24], 64 * SIXTEENTH * 1.03, 0.55, 0)),
          hits('B...............' + blankBar, { B: 0.6 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 1.4)),
          fn(({ time, step, barInSection }) => {
            if (!coreAlive || !coreEngaged || step % 2 !== 0) return;
            for (const [motifBar, motifStep, midi, beats] of BOSS_MOTIF) {
              if (motifBar === barInSection % 2 && motifStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.55);
            }
          }),
        ],
      },
      {
        name: 'dock',
        fromBar: SKYHOOK_BARS.dock,
        toBar: SKYHOOK_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            pad(time, chord.pad, 64 * SIXTEENTH * 1.05, 0.75, 0.9);
            bell(time, 74, 2.4, 0.6);
          }),
          oneShot(1, 0, ({ time }) => beds?.setHum(1, time, 1.5)),
          oneShot(2, 0, ({ time }) => bell(time, 81, 2.4, 0.45)),
          hits('....t...........', { t: 0.025 }, ({ time, barInSection }, vel) => {
            if (barInSection < 3) tick(time, vel);
          }),
          hits('B...............' + blankBar, { B: 0.5 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 1.8)),
          // Docked: two bells, the fifth falling home to the root.
          oneShot(3, 8, ({ time }) => {
            bell(time, 81, 1.6, 0.55);
            bell(time + 4 * SIXTEENTH, 74, 4.0, 0.7);
          }),
        ],
      },
    ],
  });

  const WEATHER_ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  const SUNLIT_ARP = [0, 2, 1, 3, 3, 2, 1, 0];

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices -----------------------------------------------------------------

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, snare, hat, openHat, tick, crash, thunder, pad, bass, pluck, stab, lead, bell, thud, riser, impact, alarm, noiseHit, playerSends, playerTone, playerNoise, playerOscillator } = voices;

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
    duration: 0.08,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const clankVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'square', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 3, frequency: 1600 },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 700 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.46 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const klaxonVoice = voice({
    oscillators: [{ type: 'square', gain: 0.05 }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 2200 },
    envelope: { decay: 0.14 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  const pipVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'square', gain: ({ gainValue }) => gainValue }],
    duration: 0.06,
    stopPadding: 0.02,
    filter: { type: 'lowpass', frequency: 3200 },
    envelope: { decay: 0.06 },
  });

  // ---- player instruments ---------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof SkyhookTonalVoice) {
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
    if (chain >= 2) killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.45, 0.16) });
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkle * 0.045, 0.08, 7000);
  }

  // Hits on the Tetherjack's core grow with damage dealt: more gain, a
  // brighter stab, and a beacon note climbing the lead set.
  function coreChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playerOscillator({
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: root * 4,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.22 + intensity * 0.18, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
      ],
    });
    for (const midi of chord.stab) {
      playerOscillator({
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 1400 + intensity * 3400 },
        gainAutomation: [
          { type: 'set', value: 0.035 + intensity * 0.025, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
        ],
        sends: playerSends(0.2, 0.3),
      });
    }
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES[3].kill, 0.45 + intensity * 0.35, 1);
    playerNoise(time, 0.09 + intensity * 0.08, 0.1, 5000);
  }

  // The killing blow: duck the music for a breath, then a resolving figure.
  function coreFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.12, 1.6);
    impact(time, 1.35);
    riser(time, 0.7, 0.12);
    pad(time + 0.1, [chord.bass + 12, ...chord.pad], 6, 1.0, 0.9);
    const leadSet = score.leadSetAt(position);
    [7, 5, 4, 2, 0, 2, 4, 7].forEach((degree, index) => {
      const at = time + 4 * THIRTYSECOND + index * THIRTYSECOND * 2;
      playerTone(at, leadSet[degree] + 12, PLAYER_VOICES[3].kill, 0.9 - index * 0.05, 1);
    });
    bell(time + 4 * SIXTEENTH, chord.arp[0] + 12, 3, 0.6);
    beds?.setDrone(0, 0, time, 0.5);
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
    playerNoise(time, 0.012 + sparkle * 0.03, 0.022, 9000);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      // Six: the sight is full. An octave above and a sub under it.
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
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.3, 1);
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.065 }],
        destination: output,
        sends: playerSends(0.16, 0.08),
      });
    }
    // Pneumatic launcher: a puff of air that dries out with altitude.
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.03, 3800, 'bandpass');
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      coreChip(time, 1 - hitPointsRemaining / Math.max(1, coreMaxHp));
      return;
    }
    // Armor chip: a metallic clank on the chord's upper voices.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.slice(0, 2).entries()) {
      clankVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        gainValue: 0.05 - index * 0.012,
        decay: 0.09,
        destination: output,
        sends: playerSends(0.2, 0.16),
      });
    }
    playerNoise(time, 0.05, 0.03, 5600);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.18, 0.12, 2400);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageVoice.play({ context: ctx, time, midi, gainValue: 0.13, decay: 0.6, destination: output, sends: playerSends(0.24, 0.5) });
    }
    if (enemyId === coreId) {
      riser(time, 1.2, 0.18); // it lunges — brace
      thud(time + 0.6, 0.9);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === coreId) {
      coreAlive = false;
      coreFinale(kill.time);
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
    // Refusal: a dead relay clunk, two squares a semitone apart, no reward.
    for (const [frequency, at, vel] of [[196, time, 0.16], [208, time + 0.02, 0.12]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.45, time: at + 0.18 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.12, 0.07, 'bandpass', 520, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    hullBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.32 }],
      destination: output,
    });
    // Hull klaxon on the live chord, and the paneling rattling.
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      klaxonVoice.play({ context, time: time + index * 0.13, midi, destination: output, sends: playerSends(0.1, 0.08) });
    });
    noiseHit(time, 0.2, 0.2, 'bandpass', 900, output);
    noiseHit(time + 0.06, 0.1, 0.35, 'bandpass', 420, output);
  });

  bus.on('miss', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output || enemyId === brainId) return;
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
    if (kind === 'tether') {
      brainId = enemyId;
      coreAlive = true;
      coreEngaged = false;
    } else if (kind === 'core') {
      coreId = enemyId;
    } else if (kind === 'sentinel') {
      // Station-keeper acquiring: a dry targeting pip on the lead set.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const midi = score.leadSetAt(score.arrangementPositionAt(time))[enemyId % 4];
      pipVoice.play({ context: ctx, time, midi: midi + 12, gainValue: 0.035, destination: sfxDestination() ?? ctx.destination });
    }
  });

  // ---- level moments --------------------------------------------------------

  skyhookSignals.on('clamp', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    clampedCount += 1;
    // Limpet on the hull: three quick pips climbing the lead set, then a clank.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
    const context = ctx;
    [4, 5, 7].forEach((degree, index) => {
      pipVoice.play({ context, time: time + index * THIRTYSECOND, midi: leadSet[degree] + 12, gainValue: 0.06, destination: output });
    });
    noiseHit(time + 3 * THIRTYSECOND, 0.12, 0.08, 'bandpass', 1300, output);
  });

  skyhookSignals.on('bite', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    noiseHit(time, 0.16, 0.16, 'bandpass', 700, output);
    noiseHit(time + 0.03, 0.08, 0.3, 'bandpass', 2100, output);
  });

  skyhookSignals.on('pry', () => {
    if (!ctx) return;
    clampedCount = Math.max(0, clampedCount - 1);
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    bell(time, chord.arp[2] + 12, 0.9, 0.35);
  });

  skyhookSignals.on('bossLatch', () => {
    if (!ctx) return;
    // Contact on the tether: a two-tone alarm on the live bass and a long riser.
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    alarm(time, chord.bass + 24, 0.5, 0.11);
    alarm(time + 4 * SIXTEENTH, chord.bass + 30, 0.5, 0.11);
    riser(time, 2.6, 0.2);
    beds?.setDrone(1, 0, time, 1.5);
  });

  skyhookSignals.on('bossEngage', () => {
    if (!ctx) return;
    coreEngaged = true;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
    playerTone(time, leadSet[4], PLAYER_VOICES[3].lock, 0.8, 1);
    playerTone(time + 2 * THIRTYSECOND, leadSet[7], PLAYER_VOICES[3].lock, 0.8, 1);
  });

  skyhookSignals.on('bossGrip', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    crash(time, 0.25);
    stab(time, chord.stab.map((midi) => midi + 12), 0.8);
  });

  skyhookSignals.on('bossReach', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    alarm(time, chord.bass + 24, 1.2, 0.14);
    alarm(time + 0.15, chord.bass + 25, 1.1, 0.1);
    thud(time, 1);
  });

  skyhookSignals.on('bossBite', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    thud(time, 0.9);
    noiseHit(time, 0.24, 0.25, 'bandpass', 640, output);
    noiseHit(time + 0.05, 0.12, 0.4, 'bandpass', 1900, output);
  });

  skyhookSignals.on('bossProximity', ({ closeness }) => {
    if (!ctx || !coreAlive) return;
    beds?.setDrone(1, closeness, ctx.currentTime, 0.3);
  });

  skyhookSignals.on('stationOpen', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    bell(time, 69, 1.8, 0.4);
    bell(time + 2 * SIXTEENTH, 74, 2.4, 0.4);
  });

  void clampedCount;
  return runtime;
}
