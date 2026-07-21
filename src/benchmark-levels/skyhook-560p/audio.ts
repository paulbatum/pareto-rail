import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  createSkyhookVoices,
  installSkyhookWind,
  installStationHum,
  type SkyhookTonalVoice,
  type WindBed,
} from './audio-voices';
import {
  SKYHOOK_BARS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_SCORE_SECTIONS,
  SKYHOOK_STEPS_PER_BAR,
  SKYHOOK_TIME,
} from './timing';

// THE SKYHOOK SCORE — 160 BPM in A minor, 40 bars = exactly the 60-second climb.
//
// The level has one musical idea and it is the same as its visual one: the mix
// runs out of air. Down in the weather the arrangement is enormous and wet — a
// wind bed, a four-note pad, a room on every drum. Every altitude boundary takes
// a layer away: the wind dies at the cloud deck, the reverb send collapses
// through the thin section, and by the time the Descender arrives everything you
// can hear is either structure-borne through the tether or inside the car. The
// dock is four bars of almost nothing. The player's own instrument rides the
// same curve — a bell in a cathedral at the bottom, a dry click at the top.

const STEP = SKYHOOK_TIME.stepSeconds;
const THIRTYSECOND = STEP / 2;
const STEPS_PER_BAR = SKYHOOK_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Am — F — C — G, two bars each: a progression that keeps stepping up and never
// settles, which is the whole point of a climb.
const CHORDS: Chord[] = [
  { bass: 33, pad: [45, 52, 57, 60], arp: [57, 60, 64, 69], stab: [57, 60, 64] }, // Am
  { bass: 29, pad: [41, 48, 53, 57], arp: [53, 57, 60, 65], stab: [53, 57, 60] }, // F
  { bass: 36, pad: [48, 52, 55, 60], arp: [55, 60, 64, 67], stab: [55, 60, 64] }, // C
  { bass: 31, pad: [43, 50, 55, 59], arp: [55, 59, 62, 67], stab: [55, 59, 62] }, // G
];

// Boss set: Am — B♭ — Am — E. The flat second is the thing on the tether.
const WALKER_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 34, pad: [46, 53, 58, 62], arp: [58, 62, 65, 70], stab: [58, 62, 65] }, // B♭
  CHORDS[0],
  { bass: 28, pad: [40, 47, 52, 56], arp: [56, 59, 64, 68], stab: [56, 59, 64] }, // E
];

// Dock set: the climb finally lands on C major. Arrived.
const DOCK_CHORDS: Chord[] = [CHORDS[2], CHORDS[1]];

type SectionIndex = 0 | 1 | 2 | 3;

// Kills walk a hidden two-bar lane in degree space, so a chained volley plays a
// written melody instead of stacking explosions. Each lane belongs to its
// altitude: arcs down low, leaps in the sunlight, thin high drifts as the air
// runs out, and a line that only descends while the Descender comes down.
const KILL_LANES: Record<SectionIndex, number[]> = {
  0: [
    0, 1, 2, 3, 2, 1, 2, 4,
    3, 2, 1, 2, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 4, 6,
    5, 4, 3, 4, 5, 6, 7, 5,
  ],
  1: [
    4, 7, 5, 2, 6, 3, 7, 4,
    5, 1, 6, 2, 7, 3, 5, 0,
    4, 6, 5, 7, 3, 5, 2, 4,
    6, 7, 5, 3, 4, 2, 6, 7,
  ],
  2: [
    5, 6, 7, 6, 4, 5, 7, 5,
    6, 7, 4, 6, 7, 5, 6, 4,
    5, 7, 6, 7, 4, 6, 5, 7,
    6, 4, 7, 5, 7, 6, 5, 4,
  ],
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    7, 5, 3, 1, 6, 4, 2, 0,
    5, 3, 1, 0, 7, 6, 4, 2,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// The player's instrument on the same air curve as everything else. `air` is the
// reverb send: 0.46 in the storm, 0.05 in vacuum.
const PLAYER_VOICES: Record<SectionIndex, { lock: SkyhookTonalVoice; kill: SkyhookTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.14, cutoff: 3000, gain: 0.115, air: 0.46, grit: 0.05 },
    kill: { oscillator: 'triangle', decay: 0.34, cutoff: 3000, gain: 0.13, air: 0.5, grit: 0.06 },
    fire: { oscillator: 'triangle', cutoff: 2600, gain: 0.072, fallSemitones: 10, noise: 0.05 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.105, cutoff: 4400, gain: 0.075, air: 0.3, grit: 0.04 },
    kill: { oscillator: 'triangle', decay: 0.24, cutoff: 4600, gain: 0.105, air: 0.34, grit: 0.05 },
    fire: { oscillator: 'sawtooth', cutoff: 3700, gain: 0.066, fallSemitones: 12, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sine', decay: 0.085, cutoff: 5400, gain: 0.078, air: 0.15, grit: 0.02 },
    kill: { oscillator: 'triangle', decay: 0.18, cutoff: 5600, gain: 0.1, air: 0.18, grit: 0.03 },
    fire: { oscillator: 'sawtooth', cutoff: 4800, gain: 0.06, fallSemitones: 14, noise: 0.028 },
  },
  3: {
    lock: { oscillator: 'square', decay: 0.07, cutoff: 2500, gain: 0.05, air: 0.05, grit: 0.012 },
    kill: { oscillator: 'square', decay: 0.15, cutoff: 3000, gain: 0.072, air: 0.07, grit: 0.02 },
    fire: { oscillator: 'square', cutoff: 3000, gain: 0.055, fallSemitones: 16, noise: 0.014 },
  },
};

// The Descender's theme: one eight-bar phrase that only ever goes down.
// [bar, step (8ths), midi, beats]
const WALKER_THEME: Array<[number, number, number, number]> = [
  [0, 0, 69, 2], [0, 4, 67, 1], [0, 6, 65, 1],
  [1, 0, 64, 3], [1, 6, 62, 1],
  [2, 0, 65, 1.5], [2, 3, 64, 0.5], [2, 4, 62, 2],
  [3, 0, 60, 3.5],
  [4, 0, 70, 2], [4, 4, 69, 1], [4, 6, 67, 1],
  [5, 0, 65, 3], [5, 6, 64, 1],
  [6, 0, 62, 2], [6, 4, 60, 2],
  [7, 0, 57, 3.5],
];

/** Reverb send for the arrangement at a given absolute bar: the air itself. */
function airAtBar(bar: number) {
  if (bar < SKYHOOK_BARS.deck) return 1;
  if (bar < SKYHOOK_BARS.thin) return lerp(0.85, 0.6, (bar - SKYHOOK_BARS.deck) / 8);
  if (bar < SKYHOOK_BARS.descender) return lerp(0.55, 0.16, (bar - SKYHOOK_BARS.thin) / 8);
  if (bar < SKYHOOK_BARS.dock) return lerp(0.12, 0.05, (bar - SKYHOOK_BARS.descender) / 12);
  return 0.06;
}

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-560p',
  bpm: SKYHOOK_BPM,
  stepSeconds: STEP,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let wind: WindBed | null = null;
  let hum: { setLevel(value: number, time: number): void } | null = null;
  let coreId = -1;
  let coreMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: SKYHOOK_BARS.descender, toBar: SKYHOOK_BARS.dock, chords: WALKER_CHORDS, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.dock, chords: DOCK_CHORDS, barsPerChord: 2 },
    ],
    sections: SKYHOOK_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP,
    volumeScale: 0.82,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.005, release: 0.2 },
      delay: { time: STEP * 6, feedback: 0.3, dampHz: 2200 },
      reverb: { seconds: 3.2, decay: 2.2, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      wind = installSkyhookWind(context, mix);
      hum = installStationHum(context, mix);
      wind?.setLevel(0.09, context.currentTime);
      wind?.setBrightness(0.4, context.currentTime);
    },
    onStep: scheduleStep,
    onRunStart() {
      coreId = -1;
      coreMaxHp = 0;
      const context = runtime.context();
      if (!context) return;
      wind?.setLevel(0.16, context.currentTime);
      wind?.setBrightness(0.55, context.currentTime);
      hum?.setLevel(0, context.currentTime);
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      // Back to the attract mix: the storm returns underneath.
      wind?.setLevel(0.09, context.currentTime);
      wind?.setBrightness(0.4, context.currentTime);
      hum?.setLevel(0, context.currentTime);
    },
    onDispose() {
      ctx = null;
      wind = null;
      hum = null;
    },
  });

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, snare, hat, shaker, crash, toll, pad, bass, arp, stab, lead, drone, riser, impact,
    noiseHit, playerSends, playerTone, playerNoise, sfxDestination,
  } = voices;

  // ---- arrangement ------------------------------------------------------------

  const blank = '................';

  // Wind and station hum are continuous, so they are driven once a bar rather
  // than per note. This one track is the level's whole "losing layers" gesture.
  const atmosphere = fn<Chord>(({ time, step, bar }) => {
    if (step !== 0) return;
    const air = airAtBar(bar);
    const gust = bar < SKYHOOK_BARS.deck ? 0.3 : bar < SKYHOOK_BARS.thin ? 0.15 : air * 0.16;
    wind?.setLevel(gust, time);
    wind?.setBrightness(bar < SKYHOOK_BARS.deck ? 0.5 : 1, time);
    hum?.setLevel(bar >= SKYHOOK_BARS.dock ? 0.055 : 0, time);
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        // Launch: the car pulls off the base station into the weather. Almost
        // nothing but wind, a pad, and the tether ringing under the wheels.
        name: 'launch',
        fromBar: SKYHOOK_BARS.weather,
        toBar: 4,
        tracks: [
          atmosphere,
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * STEP * 1.04, 0.85, 1)),
          hits('T...............' + blank, { T: 0.9 }, ({ time, chord }) => toll(time, chord.bass + 12, 0.9, 1, 1)),
          hits('K.......K.......', { K: 0.62 }, ({ time }, vel) => kick(time, vel, 0.8)),
          hits(blank + blank + '........S.......' + '........S.......', { S: 0.5 }, ({ time }, vel) => snare(time, vel, 0.9)),
          hits('B...............', { B: 0.6 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.3)),
        ],
      },
      {
        // Weather: the storm layer proper. Half-time, wide, wet.
        name: 'weather',
        fromBar: 4,
        toBar: SKYHOOK_BARS.deck,
        tracks: [
          atmosphere,
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * STEP * 1.04, 0.95, 1)),
          hits('T...............' + blank, { T: 1 }, ({ time, chord }) => toll(time, chord.bass + 12, 1, 1, 1)),
          hits('K.......k...K...', { K: 0.9, k: 0.55 }, ({ time }, vel) => kick(time, vel, 0.75)),
          hits('........S.......', { S: 0.85 }, ({ time }, vel) => snare(time, vel, 0.95)),
          hits('..h...h...h...h.', { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.05)),
          hits('B.....B...B.....', { B: 0.72 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.4)),
          hits('A...A...A...A...', { A: 0.6 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel, 0.9)),
          oneShot(3, 8, ({ time }) => riser(time, 8 * STEP, 0.2)),
          fn(({ time, step, bar }) => {
            // Last half-bar before the deck: the car floors it.
            if (bar === SKYHOOK_BARS.deck - 1 && step >= 10) snare(time, 0.2 + (step - 10) * 0.08, 0.7);
          }),
        ],
      },
      {
        // Deck: through the cloud floor into sunlight. Loudest, brightest,
        // fastest — and the last section with real air in it.
        name: 'deck',
        fromBar: SKYHOOK_BARS.deck,
        toBar: 12,
        tracks: [
          atmosphere,
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.1, 0.85);
            riser(time, 0.5, 0.1);
          }),
          hits('K...K.....K.....', { K: 1 }, ({ time }, vel) => kick(time, vel, 0.55)),
          hits('....S.......S...', { S: 0.95 }, ({ time }, vel) => snare(time, vel, 0.7)),
          hits('h.H.h.H.h.H.h.H.', { h: 0.04, H: 0.075 }, ({ time }, vel) => hat(time, vel, 0.028)),
          fn(deckBass),
          hits('A.A.A.A.A.A.A.A.', { A: 0.85 }, deckArp),
          hits('S...............' + blank, { S: 0.7 }, ({ time, chord }, vel) => stab(time, chord.stab, vel, 0.6)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * STEP * 1.04, 0.7, 0.8)),
          hits(blank + blank + blank + '............T...', { T: 0.7 }, ({ time, chord }) => toll(time, chord.bass + 12, 0.7, 0.8, 1)),
        ],
      },
      {
        name: 'deck-drive',
        fromBar: 12,
        toBar: SKYHOOK_BARS.thin,
        tracks: [
          atmosphere,
          hits('K...K.....K...k.', { K: 1, k: 0.6 }, ({ time }, vel) => kick(time, vel, 0.5)),
          hits('....S.......S...', { S: 0.95 }, ({ time }, vel) => snare(time, vel, 0.6)),
          hits('.......G........' + '...........G....', { G: 0.3 }, ({ time }, vel) => snare(time, vel, 0.4)),
          hits('hoHohoHohoHohoHo', { h: 0.04, H: 0.08, o: 0.024 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.028)),
          fn(deckBass),
          hits('A.A.A.A.A.A.A.A.', { A: 0.95 }, deckArp),
          hits('S.......S.......', { S: 0.72 }, ({ time, chord }, vel) => stab(time, chord.stab, vel, 0.5)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * STEP * 1.04, 0.6, 0.6)),
          oneShot(3, 8, ({ time }) => riser(time, 8 * STEP, 0.22)),
        ],
      },
      {
        // Thin: the air runs out. Same groove, one fewer layer every two bars,
        // and the reverb closing down around what is left.
        name: 'thin',
        fromBar: SKYHOOK_BARS.thin,
        toBar: SKYHOOK_BARS.reveal,
        tracks: [
          atmosphere,
          hits('K...K.....K.....', { K: 0.95 }, ({ time, bar }, vel) => kick(time, vel, thinRoom(bar))),
          hits('....S.......S...', { S: 0.85 }, ({ time, bar }, vel) => snare(time, vel, thinRoom(bar))),
          hits('h...h...h...h...', { h: 0.045 }, ({ time }, vel) => hat(time, vel, 0.022)),
          fn(({ time, step, bar }) => {
            // The shaker is the last thing the air carries; it thins with altitude.
            if (bar % 2 === 0 && step % 4 === 2) shaker(time, 0.03 * thinRoom(bar) + 0.012);
          }),
          hits('B.....B...B...B.', { B: 0.85 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.85)),
          fn(({ time, step, bar, chord }) => {
            // The arp survives, but only its top, and only every other bar.
            if (bar % 2 === 1 && step % 4 === 0) arp(time, chord.arp[(step / 4) % chord.arp.length] + 12, 0.5, thinRoom(bar));
          }),
          hits('P...............' + blank, { P: 1 }, ({ time, bar, chord }) => pad(time, chord.pad.slice(0, 3), 32 * STEP * 1.04, 0.5, thinRoom(bar))),
          hits('T...............' + blank, { T: 0.85 }, ({ time, bar, chord }) => toll(time, chord.bass + 12, 0.85, thinRoom(bar), 1)),
          oneShot(6, 0, ({ time }) => riser(time, 16 * STEP, 0.24)),
          fn(({ time, step, bar }) => {
            if (bar === SKYHOOK_BARS.reveal - 1 && step >= 8) snare(time, 0.16 + (step - 8) * 0.06, 0.15);
          }),
        ],
      },
      {
        // Reveal: one bar of nothing but the tether ringing and the mass on it.
        name: 'reveal',
        fromBar: SKYHOOK_BARS.reveal,
        toBar: SKYHOOK_BARS.descender,
        tracks: [
          atmosphere,
          oneShot(0, 0, ({ time, chord }) => {
            toll(time, chord.bass, 1.2, 0.2, 0.6);
            drone(time, 34, 16 * STEP, 0.9);
            riser(time, 16 * STEP, 0.26);
          }),
          hits('K.......K.......', { K: 0.7 }, ({ time }, vel) => kick(time, vel, 0.12)),
        ],
      },
      {
        // Descender: vacuum. Nothing has a room any more, and the low end is
        // the walker's mass coming down the ribbon at you.
        name: 'descender',
        fromBar: SKYHOOK_BARS.descender,
        toBar: 30,
        tracks: [
          atmosphere,
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.25, 0.1);
            crash(time, 0.26, 0.1);
          }),
          hits('K...K...K.k.K...', { K: 1, k: 0.6 }, ({ time }, vel) => kick(time, vel, 0.08)),
          hits('....S.......S...', { S: 1 }, ({ time }, vel) => snare(time, vel, 0.1)),
          hits('..h.h...h.h.h.h.', { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.018)),
          fn(walkerBass),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 4 === 0) drone(time, chord.bass + 12, 64 * STEP, 0.75);
          }),
          fn(walkerToll),
          fn(walkerTheme),
          hits('S...............' + blank, { S: 0.8 }, ({ time, chord }, vel) => stab(time, chord.stab, vel, 0.08)),
        ],
      },
      {
        // Second half of the fight: the tolls subdivide, the kit gets busier and
        // the theme returns an octave up. This is the "it is nearly here" music.
        name: 'descender-close',
        fromBar: 30,
        toBar: SKYHOOK_BARS.dock,
        tracks: [
          atmosphere,
          hits('K...K...K.k.K.k.', { K: 1, k: 0.65 }, ({ time }, vel) => kick(time, vel, 0.06)),
          hits('....S.......S...', { S: 1 }, ({ time }, vel) => snare(time, vel, 0.08)),
          hits('..h.h.h.h.h.h.h.', { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.016)),
          hits(blank + blank + blank + '..............X.', { X: 0.5 }, ({ time }, vel) => snare(time, vel, 0.06)),
          fn(walkerBass),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 4 === 0) drone(time, chord.bass + 12, 64 * STEP, 0.95);
          }),
          fn(walkerToll),
          fn(walkerTheme),
          hits('S.......S.......', { S: 0.9 }, ({ time, chord }, vel) => stab(time, chord.stab, vel, 0.06)),
          oneShot(5, 8, ({ time }) => riser(time, 8 * STEP, 0.2)),
        ],
      },
      {
        // Dock: the station takes the car and everything stops. Four bars of one
        // chord, two soft tolls, and the clamps closing on the last downbeat.
        name: 'dock',
        fromBar: SKYHOOK_BARS.dock,
        toBar: SKYHOOK_BARS.end,
        tracks: [
          atmosphere,
          oneShot(0, 0, ({ time, chord }) => {
            pad(time, [...chord.pad, chord.pad[0] + 12], 60 * STEP, 1.0, 0.35);
            toll(time, chord.bass + 12, 0.8, 0.4, 0.7);
            impact(time, 0.55, 0.3);
          }),
          hits('K...............', { K: 0.5 }, ({ time, barInSection }, vel) => kick(time, vel * (1 - barInSection * 0.3), 0.25)),
          oneShot(2, 0, ({ time, chord }) => toll(time, chord.bass + 19, 0.55, 0.45, 1.4)),
          oneShot(3, 0, ({ time, chord }) => {
            // Docking clamps engage.
            impact(time, 0.7, 0.4);
            stab(time, chord.stab.map((midi) => midi + 12), 0.5, 0.4);
          }),
          oneShot(3, 8, ({ time, chord }) => toll(time, chord.bass + 12, 0.4, 0.5, 0.5)),
        ],
      },
    ],
  });

  // Attract loop: the storm at the base of the tether, waiting.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      return CHORDS[Math.floor(Math.floor(position / STEPS_PER_BAR) / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * STEP * 1.04, 0.55, 1)),
          hits('T...............' + blank + blank + blank, { T: 0.55 }, ({ time, chord }) => toll(time, chord.bass + 12, 0.55, 1, 0.7)),
          hits(blank + '........A.......', { A: 0.3 }, ({ time, chord }, vel) => arp(time, chord.arp[2], vel, 1)),
        ],
      },
    ],
  });

  function deckBass({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const steps: Record<number, [number, number]> = {
      0: [0, 1], 3: [0, 0.7], 6: [7, 0.8], 8: [0, 0.9], 10: [12, 0.55], 11: [0, 0.7], 14: [7, 0.8],
    };
    if (step in steps) bass(time, chord.bass + steps[step][0], steps[step][1], 0.85);
  }

  function deckArp({ time, step, chord }: { time: number; step: number; chord: Chord }, vel: number) {
    const order = [0, 2, 1, 3, 2, 0, 3, 1];
    arp(time, chord.arp[order[(step / 2) % order.length]] + (step >= 8 ? 12 : 0), vel, 0.7);
  }

  function walkerBass({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const steps: Record<number, [number, number]> = {
      0: [0, 1], 2: [0, 0.55], 4: [0, 0.8], 7: [7, 0.7], 8: [0, 0.95], 11: [0, 0.65], 12: [3, 0.7], 14: [7, 0.8],
    };
    if (step in steps) bass(time, chord.bass + steps[step][0], steps[step][1], 1);
  }

  /**
   * The proximity clock. The tether toll starts on the downbeat and subdivides
   * as the walker closes: quarters, then eighths, then sixteenths in the last
   * bars. Nothing else in the mix speeds up, so it reads purely as distance.
   */
  function walkerToll({ time, step, bar, chord }: { time: number; step: number; bar: number; chord: Chord }) {
    const through = (bar - SKYHOOK_BARS.descender) / (SKYHOOK_BARS.dock - SKYHOOK_BARS.descender);
    const division = through < 0.34 ? 8 : through < 0.72 ? 4 : 2;
    if (step % division !== 0) return;
    toll(time, chord.bass + 12, (step === 0 ? 1 : 0.42) * (0.7 + through * 0.5), 0.1, 1 + through * 2.4);
  }

  function walkerTheme({ time, step, bar }: { time: number; step: number; bar: number }) {
    if (step % 2 !== 0) return;
    const themeBar = (bar - SKYHOOK_BARS.descender) % 8;
    const octave = bar >= 32 ? 12 : 0;
    for (const [noteBar, noteStep, midi, beats] of WALKER_THEME) {
      if (noteBar === themeBar && noteStep === step / 2) lead(time, midi + octave, beats * 4 * STEP, 0.85);
    }
  }

  function thinRoom(bar: number) {
    return lerp(0.5, 0.12, Math.min(1, (bar - SKYHOOK_BARS.thin) / 7));
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player instrument voices --------------------------------------------------

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

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.072,
    stopPadding: 0.016,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.072 },
  });

  const lockLoadVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.17 }],
    duration: 0.2,
    stopPadding: 0.04,
    envelope: { decay: 0.2 },
  });

  const chipVoice = voice<{ cutoff: number; gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const faultVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 760 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const hullVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.45 }],
    duration: 0.55,
    stopPadding: 0.05,
    envelope: { decay: 0.55 },
  });

  const alarmVoice = voice({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.13,
    stopPadding: 0.03,
    envelope: { decay: 0.13 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.14,
    stopPadding: 0.02,
    envelope: { decay: 0.14 },
  });

  const warningVoice = voice({
    oscillators: [{ type: 'triangle', gain: 0.06 }],
    duration: 0.3,
    stopPadding: 0.04,
    envelope: { attack: 0.02, decay: 0.28 },
  });

  // ---- player actions -------------------------------------------------------------
  // Every positive action snaps to the transport, reads the live chord, and
  // sends its tail into the same room as the arrangement — so the player's gun
  // dries out with the sky, exactly like everything else does.

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof SkyhookTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : (to as number);
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const midi = score.leadSetAt(position)[KILL_LANES[laneSection][position % KILL_LANE_STEPS]];
    const vel = Math.min(1.4, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay');
    const gain = mixedVoiceValue(mix, 'kill', 'gain');
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({
        context: ctx,
        time,
        midi,
        decay,
        gain,
        destination: output,
        sends: playerSends(0.4, mixedVoiceValue(mix, 'kill', 'air') * 0.6),
      });
    }
    playerNoise(time, 0.018 + mixedVoiceValue(mix, 'kill', 'grit') * 0.5, 0.07, 7000);
  }

  /** Boss damage: the walker's own voice, brighter and higher with every hit. */
  function walkerChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    toll(time, chord.bass + 12 + Math.round(intensity * 7), 0.6 + intensity * 0.6, 0.06, 1.6 + intensity * 1.8);
    for (const midi of chord.stab) {
      chipVoice.play({
        context: ctx,
        time,
        midi: midi + 12,
        cutoff: 1600 + intensity * 3800,
        gainValue: 0.036 + intensity * 0.03,
        decay: 0.1,
        destination: output,
        sends: playerSends(0.18, 0.08),
      });
    }
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES[3].kill, 0.45 + intensity * 0.4, 1);
    playerNoise(time, 0.06 + intensity * 0.08, 0.08, 4600);
  }

  /** The kill the level is built around: duck everything, then land the phrase. */
  function walkerFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.12, 1.5);
    impact(time, 1.45, 0.2);
    // It lets go of the ribbon and falls: a long toll glissando downward.
    for (let i = 0; i < 7; i += 1) {
      toll(time + i * THIRTYSECOND * 1.5, chord.bass + 24 - i * 4, 0.85 - i * 0.08, 0.08, 2.2);
    }
    riser(time, 0.7, 0.13);
    // Then the tether is clear, and the score finally says so out loud.
    pad(time + 0.5, [...CHORDS[2].pad, CHORDS[2].pad[0] + 12], 5, 1.0, 0.5);
    score.leadSetAt(position).forEach((midi, index) => {
      playerTone(time + 0.5 + index * THIRTYSECOND, midi, PLAYER_VOICES[3].kill, 0.8 - index * 0.05, 1);
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
    playerNoise(time, 0.01 + mixedVoiceValue(mix, 'lock', 'grit') * 0.35, 0.022, 9200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      // Six locks: the gun seats the whole magazine.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
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
    if (!ctx) return;
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.06 }],
        destination: output,
        sends: playerSends(0.14, mixedVoiceValue(mix, 'lock', 'air') * 0.35),
      });
    }
    playerNoise(time, lerp(PLAYER_VOICES[mix.from].fire.noise, PLAYER_VOICES[mix.to].fire.noise, mix.t), 0.024, 4400);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      walkerChip(time, 1 - hitPointsRemaining / Math.max(1, coreMaxHp));
      return;
    }
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const air = mixedVoiceValue(score.sectionMixAt(position), 'lock', 'air');
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      chipVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        cutoff: 3400,
        gainValue: 0.045 - index * 0.008,
        decay: 0.085,
        destination: output,
        sends: playerSends(0.16, air * 0.5),
      });
    }
    playerNoise(time, 0.035, 0.03, 5400);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.16, 0.12, 2400);
    // Armour coming off: a struck plate, tuned to the chord underneath it.
    toll(time, chord.stab[(stageIndex + 1) % chord.stab.length], 0.75, 0.15, 1.4);
    if (enemyId === coreId) riser(time, 1.4, 0.16);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === coreId) {
      walkerFinale(kill.time);
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
    const mix = score.sectionMixAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.9 : 0.66, mixedVoiceValue(mix, 'kill', 'air'));
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[mix.to].kill, 0.55 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A console fault, not a musical event: two-tone cabin klaxon and a clank.
    for (const [frequency, at, vel] of [[392, time, 0.14], [311, time + 0.11, 0.12]] as const) {
      faultVoice.play({ context: ctx, time: at, frequency, vel, destination: output });
    }
    noiseHit(time, 0.13, 0.09, 'bandpass', 520, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    hullVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.34 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      alarmVoice.play({ context, time: time + index * 0.14, midi, destination: output, sends: playerSends(0.1, 0.06) });
    });
    noiseHit(time, 0.2, 0.18, 'bandpass', 700, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // It went past: a short falling doppler, quiet enough to stay under the mix.
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 10), time: time + 0.13 }],
      destination: output,
      sends: playerSends(0.06, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    const output = sfxDestination();
    if (!output) return;
    if (kind === 'core') {
      coreId = enemyId;
      // Something enormous takes hold of the tether and the whole strap rings.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      riser(time, 2.0, 0.2);
      drone(time, 34, 3.2, 1.1);
      for (const [index, midi] of [21, 33, 34].entries()) {
        toll(time + index * 0.26, midi, 1.1 - index * 0.12, 0.25, 0.55);
      }
    } else if (kind === 'latcher') {
      // Proximity alarm: a flat-second chirp that never belongs to the chord.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      warningVoice.play({ context: ctx, time, midi: chord.bass + 25, destination: output, sends: playerSends(0.12, 0.1) });
      warningVoice.play({ context: ctx, time: time + STEP, midi: chord.bass + 25, destination: output });
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx || phase !== 'exposed') return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    stab(time, score.chordAt(position).stab.map((midi) => midi + 12), 1, 0.1);
    playerTone(time, score.leadSetAt(position)[7], PLAYER_VOICES[3].kill, 0.85, 1);
  });

  return runtime;
}
