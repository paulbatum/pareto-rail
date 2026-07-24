import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSkyhookVoices, installSkyhookWind, type SkyhookTonalVoice, type WindBed } from './audio-voices';
import {
  SKYHOOK_BARS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_SCORE_SECTIONS,
  SKYHOOK_STEPS_PER_BAR,
  SKYHOOK_TIME,
} from './timing';

// The Skyhook score: 128 BPM in D minor, 32 bars = exactly the 60-second climb.
// The arrangement is written to lose a layer at every section boundary, because
// that is what the air is doing. Down in the weather it is a wide reverb wash
// over a wind bed; above the deck the room shortens and the drums get metallic;
// in vacuum the reverb is gone entirely and all that is left is a dry kick, a
// winch pulse, and a drone; by the dock there is one sine beacon and silence
// between the pings.
//
// The player's guns are written into that same arc. Locks, shots, chips and
// kills all snap to the transport and read the live harmony, and the player's
// own timbre loses its room section by section exactly like everything else.
// Kills walk a hidden two-bar lane, so a chained volley performs a melody.

const SIXTEENTH = SKYHOOK_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SKYHOOK_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Dm — F — Am — C, two bars each. The roots climb: D1, F1, A1, C2. The whole
// harmony of the first half is a ladder, which is the only joke in the level.
const CHORDS: Chord[] = [
  { bass: 26, pad: [50, 53, 57, 62], arp: [50, 53, 57, 62], stab: [62, 65, 69] }, // Dm
  { bass: 29, pad: [53, 57, 60, 65], arp: [53, 57, 60, 65], stab: [65, 69, 72] }, // F
  { bass: 33, pad: [52, 57, 60, 64], arp: [57, 60, 64, 69], stab: [64, 69, 72] }, // Am
  { bass: 36, pad: [55, 60, 64, 67], arp: [60, 64, 67, 72], stab: [67, 72, 76] }, // C
];

// The fight: Dm — Bb — Dm — A. The A major is the C-sharp that will not resolve.
const BOSS_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 34, pad: [46, 50, 53, 58], arp: [53, 58, 62, 65], stab: [58, 62, 65] }, // Bb
  CHORDS[0],
  { bass: 33, pad: [45, 52, 57, 61], arp: [57, 61, 64, 69], stab: [61, 64, 69] }, // A
];

type SectionIndex = 0 | 1 | 2 | 3;

// Two bars of written melody per section, indexed by grid step. Chained kills
// walk this lane, so a clean six-lock volley plays a phrase instead of six bangs.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Weather: long arches with plenty of air between the steps.
  0: [
    0, 1, 2, 3, 4, 3, 2, 3,
    4, 5, 6, 5, 4, 3, 4, 5,
    2, 3, 4, 5, 6, 5, 4, 5,
    6, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Above the deck: broken-chord leaps for dense volleys in open sunlight.
  1: [
    0, 4, 2, 6, 3, 7, 5, 1,
    4, 0, 6, 2, 7, 3, 5, 1,
    2, 6, 4, 7, 5, 1, 3, 0,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // The fight: low, tight, and always falling — the thing is coming down.
  2: [
    5, 4, 3, 2, 4, 3, 2, 1,
    3, 2, 1, 0, 2, 1, 0, 1,
    5, 4, 5, 3, 4, 2, 3, 1,
    2, 0, 1, 3, 4, 5, 3, 2,
  ],
  // Dock: whatever is left gets to resolve.
  3: [
    0, 2, 4, 7, 4, 2, 0, 2,
    4, 5, 7, 5, 4, 2, 4, 7,
    0, 1, 2, 4, 5, 4, 2, 0,
    2, 4, 5, 7, 6, 4, 2, 0,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// The player's instrument loses its room exactly as the sky does: a wide bell in
// the storm, a shorter pluck above the deck, a hard dry square in the fight, and
// a bare sine at the top with no tail at all.
const PLAYER_VOICES: Record<SectionIndex, { lock: SkyhookTonalVoice; kill: SkyhookTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.16, cutoff: 3200, gain: 0.115, air: 0.44, echo: 0.42 },
    kill: { oscillator: 'triangle', decay: 0.34, cutoff: 3000, gain: 0.15, air: 0.55, echo: 0.46 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.07, fallSemitones: 12, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.11, cutoff: 3600, gain: 0.055, air: 0.26, echo: 0.34 },
    kill: { oscillator: 'square', decay: 0.22, cutoff: 3800, gain: 0.085, air: 0.32, echo: 0.36 },
    fire: { oscillator: 'sawtooth', cutoff: 4200, gain: 0.062, fallSemitones: 7, noise: 0.042 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.07, cutoff: 2400, gain: 0.05, air: 0.06, echo: 0.12 },
    kill: { oscillator: 'sawtooth', decay: 0.15, cutoff: 2800, gain: 0.095, air: 0.08, echo: 0.14 },
    fire: { oscillator: 'square', cutoff: 2600, gain: 0.058, fallSemitones: 13, noise: 0.05 },
  },
  3: {
    lock: { oscillator: 'sine', decay: 0.3, cutoff: 6000, gain: 0.16, air: 0.05, echo: 0.08 },
    kill: { oscillator: 'sine', decay: 0.6, cutoff: 6000, gain: 0.2, air: 0.07, echo: 0.1 },
    fire: { oscillator: 'triangle', cutoff: 5200, gain: 0.05, fallSemitones: 5, noise: 0.012 },
  },
};

// The climb motif: six bars that keep reaching for a higher note and only let go
// at the end. [bar in section, 8th-note step, midi, beats]
const CLIMB_THEME: Array<[number, number, number, number]> = [
  [0, 0, 74, 1.5], [0, 3, 77, 0.5], [0, 4, 81, 2],
  [1, 0, 79, 1], [1, 2, 81, 1], [1, 4, 84, 2],
  [2, 0, 81, 3], [2, 6, 79, 1],
  [3, 0, 77, 1], [3, 2, 81, 1], [3, 4, 84, 1.5], [3, 7, 86, 0.5],
  [4, 0, 84, 2], [4, 4, 81, 1], [4, 6, 79, 1],
  [5, 0, 77, 2], [5, 4, 74, 2],
];

// The Descender's own figure, four bars, kept down in the bass register so the
// player's kill melody still owns everything above it.
const WINCH_RIFF: Array<[number, number, number, number]> = [
  [0, 0, 38, 1], [0, 2, 38, 0.5], [0, 3, 41, 0.5], [0, 4, 38, 1], [0, 6, 45, 1],
  [1, 0, 38, 1], [1, 2, 44, 1], [1, 4, 43, 2],
  [2, 0, 38, 1], [2, 2, 38, 0.5], [2, 3, 41, 0.5], [2, 4, 38, 1], [2, 6, 46, 1],
  [3, 0, 45, 2], [3, 4, 44, 1], [3, 6, 41, 1],
];

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-k5rw',
  bpm: SKYHOOK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let wind: WindBed | null = null;
  let coreId = -1;
  let coreMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: SKYHOOK_BARS.descender, toBar: SKYHOOK_BARS.dock, chords: BOSS_CHORDS, barsPerChord: 2 }],
    sections: SKYHOOK_SCORE_SECTIONS,
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
      compressor: { threshold: -17, ratio: 4.5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2100 },
      reverb: { seconds: 3.4, decay: 2.1, level: 0.55 },
      noiseSeconds: 2.5,
    },
    onPostBuild(context, mix) {
      ctx = context;
      wind = installSkyhookWind(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      coreId = -1;
      coreMaxHp = 0;
      const context = runtime.context();
      // Back at the anchor: the wind is the loudest thing in the level.
      if (context) wind?.set(context.currentTime, 0.1, 900, 0.6);
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      wind?.set(context.currentTime, 0.0, 700, 1.4);
    },
    onDispose() {
      ctx = null;
      wind = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement -------------------------------------------------------------

  const blank = '................';
  const evenEighths = 'p.p.p.p.p.p.p.p.';
  const rainSoft = 'r.rRr.r.r.rRr.r.';
  const rainHard = 'r.RrrRr.r.RrrRr.';
  const dust = 'r...r...r..r....';
  const winch = 'g.g.g.g.g.g.g.g.';

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
          hits('A' + '.'.repeat(63), { A: 1 }, ({ time, chord }) => air(time, chord.pad, 64 * SIXTEENTH * 1.04, 0.55)),
          hits('b.......' + '.'.repeat(24), { b: 0.5 }, ({ time, bar, chord }) => bell(time, chord.arp[bar % chord.arp.length] + 12, 0.5)),
          hits(blank + blank + 'K...............' + blank, { K: 0.35 }, ({ time }, vel) => kick(time, vel)),
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
        // Weather. Everything is wide: a four-bar pad, a half-time kick, rain on
        // the canopy, and one bell per bar drifting off into the hall.
        name: 'weather',
        fromBar: SKYHOOK_BARS.weather,
        tracks: [
          hits('A' + '.'.repeat(63), { A: 1 }, ({ time, chord }) => air(time, chord.pad, 64 * SIXTEENTH * 1.03, 0.85)),
          hits('K...............' + 'K.......k.......', { K: 0.75, k: 0.42 }, ({ time }, vel) => kick(time, vel)),
          hits(blank + '........S.......', { S: 0.4 }, ({ time }, vel) => snare(time, vel)),
          hits(rainSoft, { r: 0.016, R: 0.038 }, ({ time }, vel) => rain(time, vel, 0.055, 6200)),
          hits('B.......B.......', { B: 0.72 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0)),
          hits('b.......' + '.'.repeat(8) + 'b.......' + '.'.repeat(24), { b: 0.55 }, ({ time, bar, chord }) => bell(time, chord.arp[(bar + 1) % chord.arp.length] + 12, 0.5)),
          fn(({ bar, step, time }) => {
            if (bar !== SKYHOOK_BARS.weather || step !== 0) return;
            wind?.set(time, 0.105, 950, 2.5);
          }),
          // Two bars out from the deck: the drums stiffen and the riser starts.
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
          fn(({ time, step, bar }) => {
            if (bar !== 7) return;
            if (step % 4 === 0) kick(time, 0.85);
            if (step >= 8 && step % 2 === 0) snare(time, 0.18 + (step - 8) * 0.06);
          }),
        ],
      },
      {
        // Punch-through. Sunlight: the room shortens, the snare becomes a struck
        // panel, and the climb motif finally has somewhere to go.
        name: 'deck',
        fromBar: SKYHOOK_BARS.deck,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.05);
            crash(time, 0.3);
          }),
          hits('K.......K...K...' + 'K.......K.....K.', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('....C.......C...', { C: 0.72 }, ({ time }, vel) => clank(time, vel)),
          hits(rainHard, { r: 0.02, R: 0.045 }, ({ time }, vel, symbol) => rain(time, vel, symbol === 'R' ? 0.035 : 0.018, 8600)),
          fn(deckBassTrack),
          // Plucks sit an octave below the kill lane so the player owns the top.
          hits(evenEighths, { p: 0.75 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[(step / 2) % chord.arp.length] - 12, vel)),
          hits('A' + '.'.repeat(63), { A: 1 }, ({ time, chord }) => air(time, chord.pad, 64 * SIXTEENTH, 0.5)),
          hits('S...............' + blank, { S: 0.62 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar }) => {
            const themeBar = bar - SKYHOOK_BARS.deck;
            if (step % 2 !== 0) return;
            for (const [noteBar, noteStep, midi, beats] of CLIMB_THEME) {
              if (noteBar === themeBar && noteStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.85);
            }
          }),
          fn(({ bar, step, time }) => {
            if (step !== 0) return;
            if (bar === SKYHOOK_BARS.deck) wind?.set(time, 0.05, 2400, 2.0);
            if (bar === SKYHOOK_BARS.deck + 4) wind?.set(time, 0.03, 3200, 3.0);
          }),
        ],
      },
      {
        // Sighting. Two bars where the arrangement gets out of the way so the
        // thing on the tether is the only event in the frame.
        name: 'sighting',
        fromBar: SKYHOOK_BARS.sighting,
        tracks: [
          hits('K...............', { K: 0.55 }, ({ time }, vel) => kick(time, vel)),
          hits('A' + '.'.repeat(31), { A: 1 }, ({ time, chord }) => air(time, chord.pad, 32 * SIXTEENTH, 0.75)),
          hits(dust, { r: 0.012 }, ({ time }, vel) => rain(time, vel, 0.02, 9800)),
          oneShot(0, 0, ({ time, chord }) => alarm(time, chord.bass + 12, 16 * SIXTEENTH, 0.13)),
          oneShot(1, 0, ({ time, chord }) => alarm(time, chord.bass + 15, 14 * SIXTEENTH, 0.16)),
          oneShot(0, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.24)),
          fn(({ bar, step, time }) => {
            if (bar === SKYHOOK_BARS.sighting && step === 0) wind?.set(time, 0.012, 3600, 3.0);
          }),
        ],
      },
      {
        // The fight. No air layer at all: a dry kick, the winch pulse, a cold
        // drone, and a riff down where the player's melody never goes.
        name: 'descender',
        fromBar: SKYHOOK_BARS.descender,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.25);
            clank(time, 1.0);
            crash(time, 0.34);
          }),
          hits('K...K...K.K.K...' + 'K...K...K...K.K.', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('....C.......C.C.', { C: 0.85 }, ({ time }, vel) => clank(time, vel)),
          hits(winch, { g: 0.5 }, ({ time, step }, vel) => grinder(time, vel * (step % 4 === 0 ? 1.35 : 0.8))),
          hits(dust, { r: 0.01 }, ({ time }, vel) => rain(time, vel, 0.014, 12000)),
          fn(winchBassTrack),
          hits('D' + '.'.repeat(63), { D: 1 }, ({ time, chord }) => drone(time, chord.bass + 12, 64 * SIXTEENTH, 0.9)),
          hits('S...............' + blank + blank + blank, { S: 0.75 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar }) => {
            const riffBar = (bar - SKYHOOK_BARS.descender) % 4;
            if (step % 2 !== 0) return;
            for (const [noteBar, noteStep, midi, beats] of WINCH_RIFF) {
              if (noteBar === riffBar && noteStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.8);
            }
          }),
          // Proximity alarm: it climbs a semitone every two bars as the gap closes.
          fn(({ time, step, bar, chord }) => {
            const into = bar - SKYHOOK_BARS.descender;
            if (step !== 0 || into % 2 !== 0) return;
            alarm(time, chord.bass + 12 + into / 2, 12 * SIXTEENTH, 0.1 + into * 0.012);
          }),
          fn(({ bar, step, time }) => {
            if (bar === SKYHOOK_BARS.descender && step === 0) wind?.set(time, 0, 5200, 1.6);
          }),
        ],
      },
      {
        // Dock. Everything stops. One beacon per bar, then one every two, then
        // the last pad tail and the clunk of the clamps closing.
        name: 'dock',
        fromBar: SKYHOOK_BARS.dock,
        toBar: SKYHOOK_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 0.9);
            crash(time, 0.4);
            air(time, [chord.bass + 12, ...chord.pad, chord.pad[0] + 12], 40 * SIXTEENTH, 1.0);
          }),
          hits('K.......K.......' + blank, { K: 0.5 }, ({ time, barInSection }, vel) => {
            if (barInSection < 2) kick(time, vel * (1 - barInSection * 0.4));
          }),
          // Two bells, three bars apart, resolving downward. That is the entire
          // melodic content of the last eleven seconds and it is meant to be.
          hits('b...............', { b: 0.6 }, ({ time, barInSection, chord }, vel) => {
            if (barInSection === 1) bell(time, chord.arp[3] + 12, vel);
            if (barInSection === 3) bell(time, chord.arp[1] + 12, vel * 0.8);
          }),
          // Docking beacon, decelerating: every bar, then every two, then done.
          fn(({ time, step, barInSection, chord }) => {
            if (step !== 0) return;
            if (barInSection <= 1) beacon(time, chord.bass + 24, 0.85, 1.1);
            else if (barInSection <= 3) beacon(time, chord.bass + 24, 0.6, 1.6);
            else if (barInSection === 4) beacon(time, chord.bass + 19, 0.45, 2.4);
          }),
          // Clamps closed. The last sound in the level is metal and then nothing.
          oneShot(5, 0, ({ time, chord }) => {
            clank(time, 0.4);
            air(time, [chord.bass + 12, chord.bass + 19], 16 * SIXTEENTH, 0.5);
          }),
        ],
      },
    ],
  });

  function deckBassTrack({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const pattern: Record<number, [number, number]> = {
      0: [0, 1], 3: [0, 0.7], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.65], 14: [12, 0.7],
    };
    if (step in pattern) bass(time, chord.bass + pattern[step][0], pattern[step][1], 0.4);
  }

  function winchBassTrack({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const pattern: Record<number, [number, number]> = {
      0: [0, 1], 2: [0, 0.55], 3: [0, 0.8], 6: [7, 0.85], 8: [0, 0.95], 10: [12, 0.6], 11: [0, 0.7], 14: [1, 0.7],
    };
    if (step in pattern) bass(time, chord.bass + pattern[step][0], pattern[step][1], 0.95);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices --------------------------------------------------------------------

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, snare, rain, clank, crash, bass, air, drone, grinder, bell, pluck, stab, lead,
    alarm, riser, beacon, impact, noiseHit, playerSends, playerTone, playerNoise,
  } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.48 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.3 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockLoadVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.2 }],
    duration: 0.2,
    stopPadding: 0.05,
    envelope: { decay: 0.2 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.075,
    stopPadding: 0.018,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const chipVoice = voice<{ cutoff: number; gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.025,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.07,
    envelope: { decay: ({ decay }) => decay },
  });

  // Rejection: the release lever jamming. A dead, detuned clack with no pitch
  // relationship to anything in the score, which is exactly the point.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.19,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 760 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.55,
    stopPadding: 0.06,
    envelope: { decay: 0.55 },
  });

  const hullAlarmVoice = voice({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.14,
    stopPadding: 0.03,
    envelope: { decay: 0.14 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.13,
    stopPadding: 0.02,
    envelope: { decay: 0.13 },
  });

  const pingVoice = voice({
    oscillators: [{ type: 'triangle', gain: 0.05 }],
    duration: 0.36,
    stopPadding: 0.05,
    gainAutomation: (time) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.05, time: time + 0.22 },
      { type: 'linearRamp', value: 0, time: time + 0.36 },
    ],
  });

  // ---- player instruments -------------------------------------------------------

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
    const midi = leadSet[KILL_LANES[laneSection][position % KILL_LANE_STEPS]];
    const vel = Math.min(1.45, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi + 12, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi: midi + 12, decay, gain, destination: output, sends: playerSends(0.4, 0.16) });
    }
    const room = mixedVoiceValue(mix, 'kill', 'air') as number;
    playerNoise(time, 0.018 + room * 0.04, 0.08, 7600);
  }

  // Boss damage: every chip raises the pitch of the beacon inside it and opens
  // the saws, so the fight audibly runs out of Descender.
  function coreChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'square',
      frequency: root * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.14 }],
      gainAutomation: [
        { type: 'set', value: 0.11 + intensity * 0.1, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.44 },
      ],
      destination: output,
    });
    for (const midi of chord.stab) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1200 + intensity * 3400 },
        gainAutomation: [
          { type: 'set', value: 0.035 + intensity * 0.03, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
        ],
        destination: output,
        sends: playerSends(0.16, 0.1),
      });
    }
    const marker = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, marker + 12, PLAYER_VOICES[2].kill, 0.5 + intensity * 0.4, 1);
    playerNoise(time, 0.09 + intensity * 0.07, 0.09, 4800);
  }

  // The killing blow: duck everything, hit the tonic, and walk the lead set down
  // as the thing comes off the cable.
  function coreFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.12, 1.5);
    impact(time, 1.35);
    crash(time, 0.45);
    air(time + 0.1, [chord.bass, ...chord.pad, chord.pad[0] + 12], 5.2, 1.1);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      playerTone(time + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[2].kill, 0.95 - index * 0.07, 1);
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
      playerTone(time, midi + 12, PLAYER_VOICES[section].lock, 1, weight);
    }
    const airAmount = mixedVoiceValue(mix, 'lock', 'air') as number;
    playerNoise(time, 0.012 + airAmount * 0.03, 0.022, 9400);
    if (lockCount >= 6) {
      // Six tubes loaded: the magazine seats with a drop to the root.
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 24, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      lockLoadVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.15 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 36, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.3, 1);
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
      const shot = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: shot.oscillator,
        cutoff: shot.cutoff,
        gainValue: shot.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - shot.fallSemitones), time: time + 0.062 }],
        destination: output,
        sends: playerSends(0.16, 0.08),
      });
    }
    playerNoise(time, lerp(PLAYER_VOICES[mix.from].fire.noise, PLAYER_VOICES[mix.to].fire.noise, mix.t), 0.024, 5000);
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
    // Armour chip: a fast upward triplet off the current stab voicing.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      chipVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        cutoff: 3800,
        gainValue: 0.05 - index * 0.008,
        decay: 0.085,
        destination: output,
        sends: playerSends(0.18, 0.14),
      });
    }
    playerNoise(time, 0.04, 0.03, 6000);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.18, 0.12, 2400);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length]]) {
      stageVoice.play({
        context: ctx,
        time,
        midi,
        gainValue: 0.13,
        decay: 0.6,
        destination: output,
        sends: playerSends(0.22, 0.4),
      });
    }
    if (enemyId === coreId) riser(time, 1.4, 0.16); // it hauls itself down — brace
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
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.7);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.55 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[196, time, 0.15], [208, time + 0.024, 0.11]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.45, time: at + 0.16 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.12, 0.07, 'bandpass', 540, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.34 }],
      destination: output,
    });
    // Hull alarm, voiced from the live chord instead of a fixed siren.
    const context = ctx;
    [chord.stab[2], chord.stab[0]].forEach((midi, index) => {
      hullAlarmVoice.play({ context, time: time + index * 0.14, midi, destination: output, sends: playerSends(0.1, 0.06) });
    });
    noiseHit(time, 0.2, 0.2, 'bandpass', 620, output);
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
      sends: playerSends(0.06, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'core') {
      coreId = enemyId;
      // Something big takes hold of the cable a very long way up.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      riser(time, 2.0, 0.18);
      const audioMix = runtime.mix();
      if (!audioMix?.duck) return;
      const context = ctx;
      [26, 38, 45].forEach((midi, index) => {
        const at = time + index * 0.28;
        playOscillatorVoice({
          context,
          time: at,
          stopTime: at + 1.3,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          filter: {
            type: 'lowpass',
            frequency: 420,
            frequencyAutomation: [{ type: 'linearRamp', value: 1200, time: at + 0.45 }],
          },
          gainAutomation: [
            { type: 'set', value: 0, time: at },
            { type: 'linearRamp', value: 0.19, time: at + 0.06 },
            { type: 'exponentialRamp', value: 0.001, time: at + 1.2 },
          ],
          destination: audioMix.duck,
        });
      });
    } else if (kind === 'limpet') {
      const output = sfxDestination();
      if (!output) return;
      // Contact ping: a short rising sonar note off the live lead set.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const sourceMidi = score.leadSetAt(score.arrangementPositionAt(time))[enemyId % 4] + 12;
      pingVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi + 7), time: time + 0.3 }],
        destination: output,
        sends: playerSends(0.14, 0.12),
      });
    }
  });

  bus.on('bossphase', ({ phase }) => {
    const output = sfxDestination();
    if (!ctx || !output || phase !== 'exposed') return;
    // The grapnels are gone: the furnace opens, and the score says so.
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    stab(time, score.chordAt(position).stab, 0.9);
    [0, 2, 4, 6].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND * 2, leadSet[degree], PLAYER_VOICES[2].kill, 0.7, 1);
    });
    riser(time, 0.7, 0.12);
  });

  return runtime;
}
