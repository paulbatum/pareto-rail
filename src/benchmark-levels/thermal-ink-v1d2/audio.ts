import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { inkState } from './gameplay';
import { createInkVoices, installHarborRumble, type PlayerVoice } from './audio-voices';
import {
  THERMAL_INK_V1D2_BARS,
  THERMAL_INK_V1D2_BPM,
  THERMAL_INK_V1D2_DURATION,
  THERMAL_INK_V1D2_SCORE_SECTIONS,
  THERMAL_INK_V1D2_STEPS_PER_BAR,
  THERMAL_INK_V1D2_TIME,
} from './timing';

// The Thermal Ink score: 96 BPM industrial pulse in D minor, 24 bars = exactly
// the 60-second fight. A lament descent (Dm–C–Bb–A, two bars each) under one
// haunting plucked melody. While the camera is inside ink the arrangement's
// noise falls back — drums, clatter and bass mute — and the melody returns an
// octave up on a bright square pluck: the thermal display has its own mix.
// Player actions snap to the transport and read the live harmony; kills walk
// hidden sequencer lanes so a chained volley performs a melodic run.

const SIXTEENTH = THERMAL_INK_V1D2_TIME.stepSeconds;
const STEPS_PER_BAR = THERMAL_INK_V1D2_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[] };

// i – VII – VI – V: the descending lament. The C# over A is the creature.
const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 62, 65, 69], arp: [62, 65, 69, 74] }, // Dm
  { bass: 36, pad: [48, 60, 64, 67], arp: [60, 64, 67, 72] }, // C
  { bass: 34, pad: [46, 58, 62, 65], arp: [58, 62, 65, 70] }, // Bb
  { bass: 33, pad: [45, 57, 61, 64], arp: [57, 61, 64, 69] }, // A
];
// Finale: the lamps return on D major — the only relief in the harbor.
const FINALE_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 62, 66, 69], arp: [62, 66, 69, 74] }, // D
];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Descent: slow glassy arches while the wreck field opens up.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Engage/hunt: jump-cut broken chords for sweeping volleys.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Dive: high urgent fragments that leave room for the tom-heavy pulse.
  2: [
    4, 5, 7, 6, 4, 2, 5, 3,
    6, 7, 5, 4, 6, 3, 5, 2,
    7, 6, 5, 4, 7, 5, 3, 1,
    4, 5, 6, 7, 6, 5, 4, 0,
  ],
  // Core: tolling descents answered by climbs into the finale.
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    3, 2, 1, 0, 4, 3, 2, 1,
    4, 5, 6, 7, 5, 6, 7, 4,
  ],
  // Thermal: the same register the bright pluck owns — kills sing through ink.
  4: [
    0, 2, 4, 6, 2, 4, 6, 7,
    4, 6, 7, 6, 4, 2, 1, 0,
    2, 4, 6, 7, 6, 4, 2, 0,
    4, 6, 7, 6, 7, 6, 4, 2,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: PlayerVoice; kill: PlayerVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.13, cutoff: 3200, gain: 0.11, reverb: 0.3 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 2800, gain: 0.14, reverb: 0.38 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.065, fallSemitones: 10, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.09, cutoff: 2400, gain: 0.05, reverb: 0.2 },
    kill: { oscillator: 'square', decay: 0.2, cutoff: 2700, gain: 0.1, reverb: 0.28 },
    fire: { oscillator: 'sawtooth', cutoff: 3400, gain: 0.06, fallSemitones: 7, noise: 0.04 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.08, cutoff: 3600, gain: 0.05, reverb: 0.26 },
    kill: { oscillator: 'sawtooth', decay: 0.24, cutoff: 3800, gain: 0.11, reverb: 0.32 },
    fire: { oscillator: 'sawtooth', cutoff: 4800, gain: 0.065, fallSemitones: 12, noise: 0.05 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.14, cutoff: 2000, gain: 0.055, reverb: 0.4 },
    kill: { oscillator: 'sawtooth', decay: 0.4, cutoff: 2600, gain: 0.13, reverb: 0.46 },
    fire: { oscillator: 'square', cutoff: 2800, gain: 0.055, fallSemitones: 13, noise: 0.045 },
  },
  4: {
    // Thermal: brighter, sharper, closer.
    lock: { oscillator: 'square', decay: 0.08, cutoff: 5200, gain: 0.055, reverb: 0.12 },
    kill: { oscillator: 'square', decay: 0.22, cutoff: 6000, gain: 0.12, reverb: 0.16 },
    fire: { oscillator: 'sawtooth', cutoff: 6400, gain: 0.06, fallSemitones: 12, noise: 0.03 },
  },
};

// The haunting melody, one 8-bar phrase over the lament. [bar, step(8ths), midi, beats]
const LEAD_THEME: Array<[number, number, number, number]> = [
  [0, 0, 74, 1.5], [0, 3, 77, 0.5], [0, 4, 76, 2],
  [1, 0, 74, 3],
  [2, 0, 72, 1.5], [2, 3, 76, 0.5], [2, 4, 79, 2],
  [3, 0, 76, 2], [3, 4, 72, 1], [3, 6, 74, 1],
  [4, 0, 70, 1.5], [4, 3, 74, 0.5], [4, 4, 77, 2],
  [5, 0, 74, 3],
  [6, 0, 73, 2], [6, 4, 69, 1], [6, 6, 73, 1],
  [7, 0, 69, 3.5],
];

export function createAudio(bus: EventBus) {
  return createInkAudio(bus).audio;
}

export const traceThermalInkAudio = createAudioTraceHarness({
  level: 'thermal-ink-v1d2',
  bpm: THERMAL_INK_V1D2_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: THERMAL_INK_V1D2_DURATION,
  createAudio: createInkAudio,
});

function createInkAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let coreId = -1;
  let coreMaxHp = 0;
  let lastThermal = false;
  const armIds = new Set<number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: THERMAL_INK_V1D2_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: THERMAL_INK_V1D2_BARS.finale, chords: FINALE_CHORDS, barsPerChord: 2 }],
    sections: THERMAL_INK_V1D2_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -17, ratio: 5, attack: 0.004, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2200 },
      reverb: { seconds: 2.6, decay: 2.4, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      installHarborRumble(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      coreId = -1;
      coreMaxHp = 0;
      lastThermal = false;
      armIds.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, [50, 62, 65, 69], 5, 0.7);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler ------------------------------------------------------------

  const blankBar = '................';
  const evenArp = 'A.A.A.A.A.A.A.A.';
  const evenHat = 'h.H.h.H.h.H.h.H.';
  const busyHat = 'hoHohoHohoHohoHo';

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
          hits('C...............................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad, 30 * SIXTEENTH * 1.05, 0.6)),
          hits('s...............' + blankBar, { s: 0.5 }, ({ time }) => sonar(time, 74, 0.6)),
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
        name: 'descent',
        fromBar: THERMAL_INK_V1D2_BARS.descent,
        tracks: [
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.75)),
          hits('K.......k.......', { K: 0.55, k: 0.32 }, ({ time }, vel) => kick(time, vel)),
          hits('..C...C.......C.', { C: 0.5 }, ({ time }, vel) => clank(time, vel, 1)),
          hits(evenArp, { A: 0.4 }, ({ time, step, chord }) => arpPluck(time, chord.arp[(step / 2) % chord.arp.length], 0.3)),
          fn(melodyTrack(2)),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.18)),
        ],
      },
      {
        name: 'engage',
        fromBar: THERMAL_INK_V1D2_BARS.engage,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1)),
          hits('K.....k...K.....', { K: 1, k: 0.78 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.85 }, ({ time }, vel) => snare(time, vel)),
          hits(evenHat, { h: 0.04, H: 0.07 }, ({ time }, vel) => hat(time, vel, 0.028)),
          hits('..C.......C.....', { C: 0.55 }, ({ time }, vel) => clank(time, vel, 1.3)),
          fn(bounceBass),
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.45)),
          fn(melodyTrack(0)),
        ],
      },
      {
        name: 'dive',
        fromBar: THERMAL_INK_V1D2_BARS.dive,
        tracks: [
          hits('K.....k...k.....', { K: 1, k: 0.82 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.9 }, ({ time }, vel) => snare(time, vel)),
          hits(blankBar + '......T.........', { T: 0.7 }, ({ time }, vel) => tom(time, vel)),
          hits(busyHat, { h: 0.04, H: 0.075, o: 0.025 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          hits('..C...C...C.....', { C: 0.6 }, ({ time }, vel) => clank(time, vel, 0.8)),
          fn(bounceBass),
          fn(melodyTrack(0)),
          fn(({ time, step, bar }) => {
            if (bar === THERMAL_INK_V1D2_BARS.exposed - 1 && step === 0) sonar(time, 81, 0.8);
            if (bar === THERMAL_INK_V1D2_BARS.exposed - 1 && step === 8) sonar(time, 83, 0.9);
          }),
          oneShot(7, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.22)),
        ],
      },
      {
        name: 'core',
        fromBar: THERMAL_INK_V1D2_BARS.exposed,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.15);
            clank(time, 1.2, 0.6);
          }),
          hits('K...K...K...K...', { K: 0.95 }, ({ time }, vel) => kick(time, vel)),
          hits('..S.......S.....', { S: 0.8 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.045, H: 0.08, o: 0.028 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          fn(driveBass),
          hits('C...............................................................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad.map((midi) => midi + 12), 64 * SIXTEENTH * 1.02, 0.5)),
          fn(melodyTrack(0)),
        ],
      },
    ],
  });

  /** The melody, entering at `fromBar` within the 8-bar phrase cycle. */
  function melodyTrack(fromBar: number) {
    return ({ time, step, bar }: { time: number; step: number; bar: number }) => {
      if (step % 2 !== 0) return;
      const phraseBar = (bar - fromBar + 8) % 8;
      const thermal = inkState.thermal;
      for (const [noteBar, noteStep, midi, beats] of LEAD_THEME) {
        if (noteBar === phraseBar && noteStep === step / 2) {
          pluck(time, midi + (thermal ? 12 : 0), beats * 4 * SIXTEENTH, thermal ? 0.95 : 0.8, thermal);
        }
      }
    };
  }

  function bounceBass({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    if (inkState.thermal) return;
    const steps: Record<number, [number, number]> = {
      2: [0, 0.7], 4: [0, 0.9], 6: [12, 0.6], 8: [0, 0.85], 10: [0, 0.65], 12: [7, 0.75], 14: [0, 0.7],
    };
    if (step in steps) bass(time, chord.bass + steps[step][0], steps[step][1], 0.7);
  }

  function driveBass({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    if (inkState.thermal) return;
    const steps: Record<number, [number, number]> = {
      0: [0, 1], 2: [0, 0.75], 4: [12, 0.7], 6: [0, 0.85], 8: [0, 0.95], 10: [7, 0.7], 12: [10, 0.65], 14: [7, 0.8],
    };
    if (step in steps) bass(time, chord.bass + steps[step][0], steps[step][1], 0.9);
  }

  function arpPluck(time: number, midi: number, vel: number) {
    pluck(time, midi, SIXTEENTH * 3, vel, false);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    // Edge-triggered thermal switch: the display change is audible.
    if (mode === 'run' && inkState.thermal !== lastThermal) {
      lastThermal = inkState.thermal;
      const context = ctx ?? runtime.context();
      if (context) modeSwitch(score.nextGridTime(context.currentTime, 1), lastThermal);
    }
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices -----------------------------------------------------------------

  const voices = createInkVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, tom, snare, clank, hat, bass, pad, pluck, sonar, riser, impact, whoosh, modeSwitch, sting,
    noiseHit, playerSends, playerTone, playerNoise, rejectVoice, playerHitBoomVoice, missVoice,
  } = voices;

  // ---- player instruments -----------------------------------------------------
  // Every positive action snaps to the transport, reads the live chord, and
  // sends tails into the same delay / hall as the arrangement. Kills unmute a
  // hidden sequencer lane so clean volleys play melodic runs.

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof PlayerVoice) {
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
    // Kill body: a wet thud an octave below the lane note.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + decay * 0.85 + 0.04,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi - 12),
      gainAutomation: [
        { type: 'set', value: gain * 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
      ],
      destination: output,
    });
    playerNoise(time, 0.04, 0.09, 7000);
  }

  function coreChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.52,
      oscillatorType: 'sine',
      frequency: midiToFreq(chord.bass + 24),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.14 }],
      gainAutomation: [
        { type: 'set', value: 0.22 + intensity * 0.18, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.46 },
      ],
      destination: output,
      sends: playerSends(0.25, 0.4),
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + SIXTEENTH / 2, beacon + 12, PLAYER_VOICES[3].kill, 0.5 + intensity * 0.35, 1);
    playerNoise(time, 0.1 + intensity * 0.08, 0.1, 5000);
  }

  function coreFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    audioMix.duckAt(time, 0.12, 1.8);
    impact(time, 1.35);
    whoosh(time, 1.2);
    // The thermal silhouette collapses down the lane, then the lamps return on D major.
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      const at = time + index * SIXTEENTH / 2;
      playerTone(at, midi + 12, PLAYER_VOICES[3].kill, 0.9 - index * 0.06, 1);
    });
    pad(time + 0.4, FINALE_CHORDS[0].pad, 6, 1.0);
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
    playerNoise(time, 0.014, 0.025, 9000);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + SIXTEENTH / 2, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.22,
        oscillatorType: 'sine',
        frequency: midiToFreq(score.chordAt(position).bass + 12),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.16 }],
        gainAutomation: [
          { type: 'set', value: 0.19, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
        ],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    playerTone(time, score.chordAt(score.arrangementPositionAt(time)).bass + 24, PLAYER_VOICES[score.sectionMixAt(score.arrangementPositionAt(time)).to].lock, 0.32, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
    const from = PLAYER_VOICES[mix.from].fire;
    const to = PLAYER_VOICES[mix.to].fire;
    const oscillator = mix.t >= 0.5 ? to.oscillator : from.oscillator;
    const cutoff = lerp(from.cutoff, to.cutoff, mix.t);
    const gain = lerp(from.gain, to.gain, mix.t);
    const noise = lerp(from.noise, to.noise, mix.t);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.08,
      oscillatorType: oscillator,
      frequency: midiToFreq(sourceMidi),
      filter: { type: 'lowpass', frequency: cutoff },
      gainAutomation: [
        { type: 'set', value: gain, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
      ],
      destination: output,
      sends: playerSends(0.18, 0.08),
    });
    playerNoise(time, noise, 0.026, 4600);
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
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const [index, midi] of chord.arp.entries()) {
      if (index > 2) break;
      playOscillatorVoice({
        context: ctx,
        time: time + index * SIXTEENTH / 2,
        stopTime: time + 0.12 + index * SIXTEENTH / 2,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 3400 },
        gainAutomation: [
          { type: 'set', value: 0.05 - index * 0.008, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.09 + index * SIXTEENTH / 2 },
        ],
        destination: output,
        sends: playerSends(0.22, 0.2),
      });
    }
    playerNoise(time, 0.04, 0.035, 5400);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output || !runtime.mix()?.reverbSend) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.18, 0.13, 2400);
    for (const midi of [chord.bass + 12, chord.arp[(stageIndex + 1) % chord.arp.length] + 12]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.68,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.13, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.62 },
        ],
        destination: output,
        sends: playerSends(0.26, 0.55),
      });
    }
    if (enemyId === coreId) riser(time, 1.4, 0.16); // the mantle convulses — brace
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === coreId) {
      coreFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    if (armIds.delete(enemyId)) {
      // A limb comes apart: wet boom and a spray of pressure.
      const output = sfxDestination();
      if (!output) return;
      impact(kill.time, 0.55);
      whoosh(kill.time + 0.05, 0.5);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * SIXTEENTH / 2, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Rejection: a dead iron clank with a minor-second snarl.
    for (const [frequency, at, vel] of [[207, time, 0.15], [220, time + 0.02, 0.11]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.4, time: at + 0.16 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.08, 'bandpass', 560, output);
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
    noiseHit(time, 0.18, 0.16, 'bandpass', 720, output);
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
    if (kind === 'core') coreId = enemyId;
    if (kind === 'arm') armIds.add(enemyId);
    if (kind === 'inkcloud') {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      whoosh(time, 0.9);
    } else if (kind === 'gob') {
      const output = sfxDestination();
      if (!output) return;
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      noiseHit(time, 0.06, 0.09, 'bandpass', 900, output);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (phase === 'summoned') {
      sting(time, [38, 50, 57], 1.0, false);
      riser(time, 2.0, 0.18);
    } else if (phase === 'exposed') {
      sting(time, [45, 57, 64, 73], 1.1, true);
      impact(time, 0.9);
    } else if (phase === 'destroyed') {
      coreFinale(time);
    }
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'core') coreId = enemyId;
  });

  return runtime;
}
