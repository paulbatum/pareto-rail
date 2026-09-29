import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { BOSS_START_DISTANCE, bossState } from './boss';
import { PYLON_SPACING, climbAt } from './space';
import { LIMPET_ARRIVE, LIMPET_GNAW } from './gameplay';
import { createSkyhookVoices, installWind, type SkyhookTonalVoice, type Wind } from './audio-voices';
import { SKYHOOK_BARS, SKYHOOK_BPM, SKYHOOK_DURATION, SKYHOOK_SCORE_SECTIONS, SKYHOOK_STEPS_PER_BAR, SKYHOOK_TIME } from './timing';

// The Skyhook score: 96 BPM, 24 bars, exactly the 60-second climb — written as
// the way the air behaves. Down in the weather it is wide and full: a big
// pad, soft kick, a rolling pluck, wind and rain and thunder. Punching through
// the deck it opens into major and the whole band arrives at once. Then it is
// stripped bar by bar: hats, snare, kick, bass, pad, arp — until at the top the
// music is barely there. The Ripper's climb is scored by the cable itself: a
// grip slam on every stride, a pinging tone climbing as it nears, a heartbeat
// once its core is exposed. The docking is the exhale.
//
// The player's guns are notes in this score. Locks, shots, chips, kills and
// boss damage all snap to the transport and read the live chord; each kill
// plays the written lane note for its step, so a chained volley is a melodic
// run; and the player's timbre thins with the air (chime → pluck → pure sine →
// struck metal → soft).

const SIXTEENTH = SKYHOOK_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SKYHOOK_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;
const BAR_SECONDS = SKYHOOK_TIME.barSeconds;

type Chord = { bass: number; pad: number[]; arp: number[]; name: string };

// Weather: D minor, spacious. Dm9 — Bbmaj7 — Fadd9, two bars each.
const WEATHER_CHORDS: Chord[] = [
  { name: 'Dm9', bass: 38, pad: [50, 57, 65, 72, 76], arp: [62, 65, 69, 72] },
  { name: 'Bbmaj7', bass: 46, pad: [58, 62, 65, 69, 74], arp: [65, 69, 70, 74] },
  { name: 'Fadd9', bass: 41, pad: [53, 57, 60, 67, 72], arp: [60, 65, 67, 69] },
];
// The punch-through is a change of mode: D minor becomes D major. The array is
// rotated so that bar 6 (the first bar of the section) lands on D.
const SUN_D: Chord = { name: 'Dmaj7', bass: 38, pad: [50, 57, 62, 66, 73], arp: [62, 66, 69, 73] };
const SUN_A: Chord = { name: 'Aadd9', bass: 45, pad: [57, 61, 64, 69, 71], arp: [64, 69, 73, 76] };
const SUN_BM: Chord = { name: 'Bm7', bass: 47, pad: [59, 62, 66, 69, 74], arp: [62, 66, 69, 71] };
const SUN_G: Chord = { name: 'Gmaj7#11', bass: 43, pad: [55, 62, 66, 71, 73], arp: [62, 66, 67, 71] };
const SUN_CHORDS: Chord[] = [SUN_A, SUN_BM, SUN_G, SUN_D];
// The Ripper: D minor over a pedal, leaning on the flat second (Eb) — cold, stark.
const BOSS_DM: Chord = { name: 'Dm9', bass: 38, pad: [50, 57, 65, 72, 76], arp: [62, 65, 69, 72] };
const BOSS_EB: Chord = { name: 'Ebmaj7', bass: 39, pad: [51, 58, 62, 67, 70], arp: [63, 67, 70, 74] };
const BOSS_BB: Chord = { name: 'Bbmaj7', bass: 46, pad: [58, 62, 65, 69, 74], arp: [65, 69, 70, 74] };
const BOSS_CHORDS: Chord[] = [BOSS_EB, BOSS_DM, BOSS_BB, BOSS_DM];
// Docked: a bare D major, wide open.
const DOCK_CHORD: Chord = { name: 'Dmaj9', bass: 38, pad: [50, 57, 64, 66, 73], arp: [62, 66, 69, 73] };
const DOCK_CHORDS: Chord[] = [DOCK_CHORD];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Lock count is a degree into the live lead set; kills read a hidden two-bar
// lane in the same degree space (0–7 = the chord's four arp notes, twice).
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Weather: slow, glassy arches under the storm.
  0: [
    0, 1, 2, 3, 2, 1, 2, 4,
    3, 2, 1, 2, 3, 4, 5, 4,
    2, 3, 4, 5, 4, 3, 4, 6,
    5, 4, 3, 4, 5, 6, 7, 5,
  ],
  // Sunlit: leaping, bright, hopeful.
  1: [
    0, 2, 4, 7, 5, 4, 2, 4,
    1, 3, 5, 7, 6, 5, 3, 5,
    2, 4, 6, 7, 6, 4, 2, 0,
    3, 5, 7, 6, 5, 7, 6, 4,
  ],
  // Thin air: sparse, high, pentatonic fragments with room between them.
  2: [
    4, 5, 7, 5, 4, 2, 4, 5,
    5, 7, 5, 4, 5, 7, 6, 5,
    4, 6, 7, 6, 4, 5, 2, 4,
    5, 7, 6, 5, 7, 5, 4, 7,
  ],
  // The Ripper: tolling descents answered by climbs.
  3: [
    7, 6, 4, 3, 4, 3, 2, 0,
    5, 4, 3, 2, 3, 2, 1, 0,
    3, 2, 1, 0, 4, 3, 2, 1,
    4, 5, 6, 7, 5, 6, 7, 4,
  ],
  // Docked: a barely-there lullaby.
  4: [
    0, 2, 4, 2, 0, 2, 4, 5,
    4, 2, 0, 2, 4, 5, 7, 5,
    4, 5, 7, 5, 4, 2, 4, 2,
    0, 2, 4, 2, 0, 1, 2, 0,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: SkyhookTonalVoice; kill: SkyhookTonalVoice; fire: FireVoice }> = {
  // Weather: wind chimes. Soft sines with an inharmonic shimmer, deep in the hall.
  0: {
    lock: { oscillator: 'sine', decay: 0.32, cutoff: 3800, gain: 0.12, partial: 3.01, partialGain: 0.32, reverb: 0.55, delay: 0.22, noise: 0.008 },
    kill: { oscillator: 'triangle', decay: 0.85, cutoff: 3400, gain: 0.15, partial: 2, partialGain: 0.4, reverb: 0.8, delay: 0.32, noise: 0.02 },
    fire: { oscillator: 'triangle', cutoff: 2600, gain: 0.06, fallSemitones: 12, noise: 0.03 },
  },
  // Sunlit: plucks, brighter and drier.
  1: {
    lock: { oscillator: 'triangle', decay: 0.17, cutoff: 4600, gain: 0.1, partial: 2, partialGain: 0.3, reverb: 0.3, delay: 0.35, noise: 0.012 },
    kill: { oscillator: 'triangle', decay: 0.42, cutoff: 4400, gain: 0.17, partial: 3.5, partialGain: 0.3, reverb: 0.5, delay: 0.4, noise: 0.035 },
    fire: { oscillator: 'sawtooth', cutoff: 4200, gain: 0.05, fallSemitones: 7, noise: 0.04 },
  },
  // Thin air: pure sines, nothing to carry them — less reverb, less body.
  2: {
    lock: { oscillator: 'sine', decay: 0.22, cutoff: 5200, gain: 0.1, partial: 2, partialGain: 0.16, reverb: 0.28, delay: 0.14, noise: 0 },
    kill: { oscillator: 'sine', decay: 0.7, cutoff: 5000, gain: 0.14, partial: 2, partialGain: 0.3, reverb: 0.34, delay: 0.1, noise: 0.008 },
    fire: { oscillator: 'sine', cutoff: 5000, gain: 0.05, fallSemitones: 12, noise: 0.012 },
  },
  // The Ripper: struck metal.
  3: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 4200, gain: 0.09, partial: 2.76, partialGain: 0.55, reverb: 0.4, delay: 0.1, noise: 0.02 },
    kill: { oscillator: 'sine', decay: 0.95, cutoff: 4800, gain: 0.13, partial: 2.76, partialGain: 0.6, reverb: 0.5, delay: 0.08, noise: 0.03 },
    fire: { oscillator: 'square', cutoff: 2300, gain: 0.045, fallSemitones: 13, noise: 0.05 },
  },
  // Docked: barely there.
  4: {
    lock: { oscillator: 'sine', decay: 0.4, cutoff: 3200, gain: 0.08, partial: 2, partialGain: 0.2, reverb: 0.7, delay: 0.2, noise: 0 },
    kill: { oscillator: 'sine', decay: 1.4, cutoff: 3000, gain: 0.12, partial: 2, partialGain: 0.3, reverb: 0.85, delay: 0.25, noise: 0 },
    fire: { oscillator: 'sine', cutoff: 3000, gain: 0.04, fallSemitones: 5, noise: 0.01 },
  },
};

// The sunlit theme: four bars over D, D, A, A. [bar in section, 16th step, midi, beats]
const SUN_THEME: Array<[number, number, number, number]> = [
  [0, 0, 78, 1.5], [0, 6, 76, 0.5], [0, 8, 74, 1], [0, 12, 76, 1],
  [1, 0, 78, 2], [1, 8, 81, 1], [1, 12, 78, 1],
  [2, 0, 76, 1], [2, 4, 81, 1], [2, 8, 85, 1.5], [2, 14, 81, 0.5],
  [3, 0, 81, 2], [3, 8, 78, 1], [3, 12, 76, 1],
];

// Thin-air remnants of the same theme: two bars, then only a high bell each bar.
const THIN_THEME: Array<[number, number, number, number]> = [
  [0, 0, 78, 2], [0, 8, 74, 2],
  [1, 0, 76, 1], [1, 4, 78, 3],
  [2, 0, 90, 4],
  [3, 0, 86, 4],
];

const ARP_ORDER = [0, 2, 1, 3, 2, 0, 3, 1];

// The Ripper's tension ping climbs this ladder as it nears: C6 D Eb F G A Bb C7 (D phrygian).
const RIPPER_LADDER = [84, 86, 87, 89, 91, 93, 94, 96];

// Wind and rain as the air lets go: [wind, rain] each bar ramps *toward* by its end.
// The storm builds through the cloud deck (bar 5 peaks), then the drop cuts it in a
// breath (bar 6 ramps in a quarter of a second); above the weather it only sighs.
const WIND_BARS: Array<[number, number]> = [
  [0.42, 0.05], [0.46, 0.05], [0.5, 0.06], [0.54, 0.06], [0.64, 0.07], [0.88, 0.08],
  [0.05, 0], [0.05, 0], [0.04, 0], [0.03, 0], [0.02, 0], [0.01, 0],
];

function windForBar(bar: number): [number, number] {
  return WIND_BARS[Math.min(WIND_BARS.length, Math.max(0, bar)) as number] ?? [0, 0];
}

/** How much air the music has to sound in: 1 in the storm, 0.15 at the top. */
function airAt(bar: number) {
  if (bar < 6) return 1;
  if (bar < 10) return 0.9;
  if (bar < 14) return 0.9 - ((bar - 10) / 4) * 0.55;
  if (bar < 21) return 0.28;
  return 0.35;
}

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-c64g',
  bpm: SKYHOOK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let wind: Wind | null = null;
  let coreId = -1;
  let coreMaxHp = 0;
  let lastBroken = 0;
  let shearSounded = false;
  // After a run the launch-cradle ambience gives way to the docked hush: no wind, one soft chord.
  let afterRun = false;
  let scheduledMode: 'ambient' | 'run' = 'ambient';
  // Player notes read the score at the transport position. Outside a run the transport just
  // keeps counting, so fold it back onto the storm bed (or the dock chord once a run has
  // ended) instead of letting notes wander into chords the bed is not playing.
  const notePosition = (time: number) => {
    const position = score.arrangementPositionAt(time);
    if (scheduledMode === 'run') return position;
    if (afterRun) return Math.max(position, SKYHOOK_BARS.dock * STEPS_PER_BAR);
    return position % (WEATHER_CHORDS.length * 2 * STEPS_PER_BAR);
  };
  let lastMissBlip = -1;
  const kinds = new Map<number, string>();
  const latches = new Map<number, { latchAt: number; boreAt: number; nextGnaw: number }>();

  const score = createScore<Chord, SectionIndex>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: WEATHER_CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: SKYHOOK_BARS.sun, toBar: SKYHOOK_BARS.latch, chords: SUN_CHORDS, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.latch, toBar: SKYHOOK_BARS.dock, chords: BOSS_CHORDS, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.dock, chords: DOCK_CHORDS, barsPerChord: 1 },
    ],
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
      compressor: { threshold: -17, ratio: 4, attack: 0.006, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2800 },
      reverb: { seconds: 3.4, decay: 2.3, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      wind = installWind(context, mix);
      wind?.set(0.36, 0.05, context.currentTime, 0.5);
    },
    onStep: scheduleStep,
    onRunStart() {
      afterRun = false;
      coreId = -1;
      coreMaxHp = 0;
      lastBroken = 0;
      shearSounded = false;
      kinds.clear();
      latches.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      wind?.set(0, 0, context.currentTime, 2);
    },
    onDispose() {
      ctx = null;
      wind = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler -----------------------------------------------------------------------------

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return WEATHER_CHORDS[Math.floor(bar / 2) % WEATHER_CHORDS.length];
    },
    sections: [
      {
        name: 'launch-cradle',
        fromBar: 0,
        tracks: [
          fn(({ time, step, bar, chord }) => {
            if (afterRun) {
              // Docked: one open chord every four bars, a bell between. It is also the
              // chord the score reports after the run, so the replay letters ring in tune.
              if (step === 0 && bar % 4 === 0) pad(time, DOCK_CHORD.pad, 64 * SIXTEENTH * 1.04, 0.42, 0.28, 0.5);
              if (step === 0 && bar % 2 === 1) bell(time, DOCK_CHORD.arp[(bar >> 1) % 4] + 12, 2.4, 0.22, 0.5);
              return;
            }
            if (step === 0 && bar % 2 === 0) pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.8, 0.35, 1);
            if (step % 4 === 0) pluck(time, chord.arp[(step / 4) % chord.arp.length], 0.26, 1);
            if (bar % 8 === 5 && step === 0) thunder(time, 0.6);
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
        name: 'weather',
        fromBar: SKYHOOK_BARS.weather,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord, bar }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.85, 0.3 + bar * 0.05, 1)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection >= 1 && (step === 0 || step === 8)) sub(time, chord.bass, 10 * SIXTEENTH, 0.7);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection >= 2 && (step === 0 || step === 8)) kick(time, 0.5 + barInSection * 0.05);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection === 0 && step % 4 === 0 && step > 0) pluck(time, chord.arp[(step / 4) % chord.arp.length], 0.22, 1);
            if (barInSection >= 1 && step % 2 === 0) pluck(time, chord.arp[ARP_ORDER[(step / 2) % ARP_ORDER.length]], 0.26 + barInSection * 0.035, 1);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection >= 4 && step % 2 === 0) shaker(time, 0.028 + (step % 4 === 0 ? 0.012 : 0));
            if (barInSection >= 4 && (step === 4 || step === 12)) clap(time, 0.45);
          }),
          // Lightning on the downbeats: thunder follows the flash by a beat's fraction.
          fn(({ time, bar, step }) => {
            if ((bar === 1 && step === 8) || (bar === 3 && step === 0) || (bar === 4 && step === 0) || (bar === 5 && step === 0)) thunder(time + 0.07, bar === 5 ? 1 : 0.8);
          }),
          // Bar 5 is the run at the deck: a riser through the whole bar and a roll into the drop.
          oneShot(5, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.24)),
          fn(({ time, step, bar }) => { if (bar === 5 && step >= 8 && step % 2 === 0) clap(time, 0.18 + (step - 8) * 0.06); }),
        ],
      },
      {
        name: 'sunlit',
        fromBar: SKYHOOK_BARS.sun,
        tracks: [
          // The drop: everything at once, wind and rain gone in a breath.
          oneShot(0, 0, ({ time }) => {
            impact(time, 0.8);
            crash(time, 0.18);
            hiss(time + 0.05, 1.4, 0.6);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 1, 0.75, 0.9)),
          hits('K...K...K...K...', { K: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.55 }, ({ time }, vel) => clap(time, vel)),
          hits('h.h.h.h.h.h.h.h.', { h: 0.034 }, ({ time }, vel) => hat(time, vel, 0.03)),
          fn(({ time, step, chord }) => {
            const line: Record<number, [number, number]> = { 0: [0, 0.9], 3: [0, 0.6], 6: [7, 0.7], 8: [0, 0.85], 11: [0, 0.55], 14: [7, 0.65] };
            if (step in line) sub(time, chord.bass + line[step][0], 3 * SIXTEENTH, line[step][1]);
          }),
          fn(({ time, step, chord }) => {
            const octave = step >= 8 ? 12 : 0;
            pluck(time, chord.arp[ARP_ORDER[step % ARP_ORDER.length] % 4] + octave, step % 4 === 0 ? 0.38 : 0.24, 0.9);
          }),
          fn(({ time, step, barInSection }) => {
            for (const [noteBar, noteStep, midi, beats] of SUN_THEME) {
              if (noteBar === barInSection && noteStep === step) bell(time, midi, beats * 4 * SIXTEENTH * 0.9, 0.95, 0.9);
            }
          }),
        ],
      },
      {
        name: 'thin-air',
        fromBar: SKYHOOK_BARS.thin,
        tracks: [
          // Layers leave: hats first, then the clap, kick, bass, until only the pad and the high bell remain.
          fn(({ time, step, chord, barInSection, bar }) => {
            const air = airAt(bar);
            if (step === 0 && bar % 2 === 0) pad(time, barInSection >= 2 ? chord.pad.slice(0, 3) : chord.pad, 32 * SIXTEENTH * 1.04, 0.5 - barInSection * 0.11, 0.4 - barInSection * 0.09, air);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 0 && (step === 0 || step === 4 || step === 8 || step === 12)) kick(time, 0.5);
            if (barInSection === 1 && step === 0) kick(time, 0.4);
            if (barInSection === 0 && step % 4 === 2) hat(time, 0.022, 0.025);
            if (barInSection === 0 && (step === 4 || step === 12)) clap(time, 0.3);
          }),
          fn(({ time, step, chord, barInSection }) => {
            if (barInSection <= 1 && (step === 0 || step === 8)) sub(time, chord.bass, 8 * SIXTEENTH, 0.45);
            if (barInSection >= 2 && step === 0) sub(time, chord.bass, 12 * SIXTEENTH, 0.28);
          }),
          fn(({ time, step, chord, barInSection, bar }) => {
            const air = airAt(bar);
            if (barInSection <= 1 && step % 4 === 0) pluck(time, chord.arp[(step / 4 + barInSection) % 4] + 12, 0.22, air);
            if (barInSection === 2 && (step === 0 || step === 8)) pluck(time, chord.arp[(step / 8) % 4] + 12, 0.15, air);
            if (barInSection === 3 && step === 0) pluck(time, chord.arp[0] + 12, 0.12, air);
          }),
          fn(({ time, step, barInSection, bar }) => {
            for (const [noteBar, noteStep, midi, beats] of THIN_THEME) {
              if (noteBar === barInSection && noteStep === step) bell(time, midi, beats * 4 * SIXTEENTH * 0.9, 0.55 - barInSection * 0.1, airAt(bar));
            }
          }),
          // The last bar before the latch: a thin held tone, climbing, and nothing else.
          oneShot(3, 4, ({ time }) => riser(time, 12 * SIXTEENTH, 0.06)),
        ],
      },
      {
        name: 'ripper',
        fromBar: SKYHOOK_BARS.latch,
        tracks: [
          // It latches on: a struck cable, a hole in the mix, then only the cable.
          oneShot(0, 0, ({ time }) => {
            clang(time, 38, 6, 1.0);
            clang(time + 0.02, 50, 4, 0.55);
            impact(time, 0.8);
            const mix = runtime.mix();
            if (mix) mix.duckAt(time, 0.1, 1.9);
          }),
          fn(({ time, step, chord, barInSection }) => {
            if (step === 0 && barInSection % 2 === 0 && barInSection > 0) sub(time, chord.bass, 32 * SIXTEENTH, 0.34);
            if (step === 0 && barInSection === 0) sub(time + 0.4, chord.bass, 30 * SIXTEENTH, 0.34);
          }),
          fn(({ time, step, chord, barInSection }) => {
            if (step === 0 && barInSection % 2 === 0) pad(time, [chord.pad[0], chord.pad[2], chord.pad[3]], 32 * SIXTEENTH, bossState.exposed ? 0.34 : 0.22, 0.14, 0.3);
          }),
          // Grip slams on every stride: beats one and three, loudest as it closes.
          fn(({ time, step, barInSection }) => {
            if (barInSection === 0 && step === 0) return; // the latch itself
            if ((step === 0 || step === 8) && bossState.phase !== 'idle' && bossState.phase !== 'dying' && bossState.phase !== 'gone') {
              const closeness = Math.min(1, Math.max(0, (BOSS_START_DISTANCE - bossState.distance) / (BOSS_START_DISTANCE - 40)));
              grip(time, 0.36 + closeness * 0.7 + (bossState.tearing ? 0.15 : 0));
            }
          }),
          // A ping that climbs as the Ripper nears: the level's tension timer.
          fn(({ time, step }) => {
            if ((step === 4 || step === 12) && bossState.phase !== 'idle' && !bossState.killed && bossState.phase !== 'gone') {
              const closeness = Math.min(1, Math.max(0, (BOSS_START_DISTANCE - bossState.distance) / (BOSS_START_DISTANCE - 40)));
              // Climbs D phrygian — every chord the Ripper's section visits lives in it.
              bell(time, RIPPER_LADDER[Math.round(closeness * (RIPPER_LADDER.length - 1))], 0.32, 0.2 + closeness * 0.26, 0.12);
            }
          }),
          fn(({ time, step }) => {
            if (step === 6 && bossState.exposed && !bossState.killed) heartbeat(time, 0.75);
            if (bossState.tearing && step % 4 === 0) alarm(time, 62, 0.35);
          }),
          fn(({ time }) => shearCue(time)),
          // A clamp torn off: metal screaming, and the pad swells.
          fn(({ time }) => {
            if (bossState.broken > lastBroken) {
              lastBroken = bossState.broken;
              clang(time, 62 + bossState.broken * 2, 1.2, 0.9);
              noiseHit(time, 0.18, 0.3, 'bandpass', 1400, runtime.mix()?.duck ?? sfxDestination() ?? null);
            }
          }),
          // Once it is off the cable the music exhales: a soft pad on the live chord, and a bell.
          fn(({ time, step, bar, chord }) => {
            if (!bossState.killed || bossState.phase === 'idle') return;
            if (step === 0 && bar % 2 === 0) pad(time, chord.pad, 32 * SIXTEENTH, 0.55, 0.22, 0.4);
            if (step === 0 || step === 8) bell(time, chord.arp[(step / 8 + bar) % 4] + 12, 1.1, 0.34, 0.3);
          }),
        ],
      },
      {
        name: 'docking',
        fromBar: SKYHOOK_BARS.dock,
        toBar: SKYHOOK_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            // The station opens overhead: doors, air, and one held chord.
            whoosh(time, 2.4, 0.8, true);
            pad(time, DOCK_CHORD.pad, 3 * 16 * SIXTEENTH * 1.02, 0.7, 0.35, 0.5);
            bell(time + 0.2, 78, 2.4, 0.4, 0.45);
          }),
          fn(({ time, step, chord, barInSection }) => {
            const fade = 1 - barInSection * 0.28;
            if (step === 0 || step === 8) bell(time, chord.arp[(step / 8 + barInSection * 2) % 4] + 12, 1.4, 0.3 * fade, 0.45);
          }),
          // The bay door (t = 54.4 s): a rush of air, then hush.
          oneShot(0, 12, ({ time }) => {
            hiss(time, 1.3, 0.7);
            whoosh(time, 1.6, 0.5, false);
          }),
          fn(({ time }) => shearCue(time)),
          // The clamps close on the docked car.
          oneShot(2, 8, ({ time }) => {
            grip(time, 0.65);
            hiss(time + 0.05, 1.6, 0.6);
          }),
          oneShot(2, 12, ({ time }) => {
            bell(time, 74, 3, 0.4, 0.5);
            bell(time + 0.06, 81, 3, 0.3, 0.5);
            bell(time + 0.12, 85, 3.4, 0.24, 0.5);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode, step, bar }: BeatLevelAudioStep) {
    scheduledMode = mode;
    if (mode === 'ambient') {
      ambientArrangement.schedule(position, time);
      if (step === 0 && wind && bar % 4 === 0) wind.set(afterRun ? 0 : 0.36, afterRun ? 0 : 0.05, time, 2);
    } else {
      runArrangement.schedule(position, time);
      scheduleSwish(position, time);
      if (step === 0 && wind) {
        // Automate the storm bed toward where the score says the air will be at the end of this bar.
        const [level, rain] = windForBar(bar);
        wind.set(level, rain, time, bar === SKYHOOK_BARS.deck ? 0.25 : BAR_SECONDS);
      }
    }
    // Limpets: the latch, the gnaw and the bore, scored on the grid.
    if (mode === 'run' && ctx && latches.size > 0) tickLimpets(time);
  }

  // The dock clamps shear a still-living Ripper off the cable: one struck-metal chord.
  function shearCue(time: number) {
    if (!bossState.sheared || shearSounded) return;
    shearSounded = true;
    clang(time, 43, 3.2, 1.1);
    impact(time, 0.9);
    hiss(time, 1.2, 0.7);
  }

  // Speed as sound: each X-frame pylon that the climb overtakes gets a swish, alternating
  // sides. It is the world falling away, scored — quieter as the air thins.
  let pylonSide = 1;
  function scheduleSwish(position: number, time: number) {
    const t = position * SIXTEENTH;
    if (t > 52) return;
    const before = Math.floor(climbAt(t) / PYLON_SPACING);
    const after = Math.floor(climbAt(t + SIXTEENTH) / PYLON_SPACING);
    if (after <= before) return;
    pylonSide = -pylonSide;
    swish(time, 0.35 + 0.65 * airAt(Math.floor(position / STEPS_PER_BAR)), pylonSide * 0.7);
  }

  // ---- voices ---------------------------------------------------------------------------------

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, clap, hat, shaker, sub, pad, pluck, bell, clang, grip, heartbeat, thunder, hiss, whoosh, swish, riser, impact, crash, alarm, noiseHit: rawNoiseHit, playerSends, playerTone, playerNoise } = voices;

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode | null) {
    if (destination) rawNoiseHit(time, vel, decay, filterType, frequency, destination);
  }

  // A limpet's life on the hull, scored: a clink when it lands, a chirp on each beat
  // it gnaws, a crunch when it bores through.
  function tickLimpets(time: number) {
    for (const [id, latch] of latches) {
      if (time + SIXTEENTH < latch.latchAt) continue;
      if (latch.nextGnaw < 0) {
        latch.nextGnaw = latch.latchAt;
        const chord = score.chordAt(notePosition(time));
        clang(score.nextGridTime(time, 0.5), chord.arp[2] + 24, 0.5, 0.42);
      }
      if (time >= latch.boreAt) {
        latches.delete(id);
        continue;
      }
      if (time >= latch.nextGnaw) {
        latch.nextGnaw += SIXTEENTH * 4;
        const chord = score.chordAt(notePosition(time));
        const urgency = Math.min(1, Math.max(0, 1 - (latch.boreAt - time) / LIMPET_GNAW));
        bell(time, chord.arp[0] + 24 + (urgency > 0.6 ? 12 : 0), 0.2, 0.16 + urgency * 0.24, 0.1);
        noiseHit(time, 0.04 + urgency * 0.06, 0.05, 'bandpass', 3200 + urgency * 2400, sfxDestination());
      }
    }
  }

  // ---- player instruments -----------------------------------------------------------------------
  // Player actions are written into the score: every positive action snaps to the
  // transport, reads the live chord, and sends tails into the same delay / hall
  // as the arrangement. Kills walk a hidden two-bar lane so a clean volley performs
  // a melody instead of stacking explosion sounds.

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof SkyhookTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number, heavy = false) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = score.leadSetAt(position);
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = leadSet[degree];
    const vel = Math.min(1.45, 1 + chain * 0.14) * (heavy ? 1.2 : 1);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    if (chain >= 2) playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].lock, 0.5, 1);
    playerNoise(time, 0.02 + (mixedVoiceValue(mix, 'kill', 'noise') as number) * 0.8, 0.08, 7000);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    kinds.set(enemyId, kind);
    if (kind === 'core') {
      coreId = enemyId;
      coreMaxHp = 0;
    }
    if (!ctx || trace) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (kind === 'limpet') {
      const now = ctx.currentTime;
      latches.set(enemyId, { latchAt: now + LIMPET_ARRIVE, boreAt: now + LIMPET_ARRIVE + LIMPET_GNAW, nextGnaw: -1 });
    } else if (kind === 'torpedo' || kind === 'hook') {
      // A launch: a rising whistle voiced from the live chord, then a whoosh.
      const chord = score.chordAt(notePosition(time));
      const output = sfxDestination();
      if (!output) return;
      whoosh(time, 0.9, kind === 'hook' ? 0.9 : 0.6, true);
      const midi = chord.arp[1] + 12;
      voices.oscillator({
        context: ctx,
        time,
        stopTime: time + 1.7,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi + 12), time: time + 1.5 }],
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: kind === 'hook' ? 0.06 : 0.04, time: time + 1.4 },
          { type: 'linearRamp', value: 0, time: time + 1.7 },
        ],
        destination: output,
        sends: playerSends(0.12, 0.1),
      });
    } else if (kind === 'sentry') {
      const chord = score.chordAt(notePosition(time));
      pluck(time, chord.arp[2] + 24, 0.3, 0.3);
      pluck(time + SIXTEENTH, chord.arp[3] + 24, 0.24, 0.3);
    } else if (kind === 'bolt') {
      // The sentry's shot: a three-note chirp, then it is coming.
      const chord = score.chordAt(notePosition(time));
      [0, 1, 2].forEach((index) => pluck(time + index * THIRTYSECOND * 1.5, chord.arp[index] + 24, 0.3 + index * 0.06, 0.25));
    }
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = notePosition(time);
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].lock, 1, weight);
    }
    playerNoise(time, 0.012 + (mixedVoiceValue(mix, 'lock', 'noise') as number) * 0.6, 0.025, 9000);
    if (lockCount >= 6) {
      // Full charge: the octave above and the chord's root underneath.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      sub(time, score.chordAt(position).bass + 12, 0.35, 0.5);
    }
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = notePosition(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.3, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = notePosition(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const shot = PLAYER_VOICES[section].fire;
      const context = ctx;
      voices.oscillator({
        context,
        time,
        stopTime: time + 0.1,
        oscillatorType: shot.oscillator,
        frequency: midiToFreq(sourceMidi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - shot.fallSemitones), time: time + 0.07 }],
        filter: { type: 'lowpass', frequency: shot.cutoff },
        gainAutomation: [
          { type: 'set', value: shot.gain * weight, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
        ],
        destination: output,
        sends: playerSends(0.16, 0.1),
      });
    }
    playerNoise(time, lerp(PLAYER_VOICES[mix.from].fire.noise, PLAYER_VOICES[mix.to].fire.noise, mix.t), 0.03, 4800);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = notePosition(time);
    const chord = score.chordAt(position);
    if (enemyId === coreId) {
      // Boss damage escalates: every chip is louder, brighter and higher than the last.
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      const intensity = 1 - hitPointsRemaining / Math.max(1, coreMaxHp);
      clang(time, chord.bass + 24 + Math.round(intensity * 7), 0.9 + intensity * 0.6, 0.7 + intensity * 0.6);
      const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
      playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES[3].kill, 0.5 + intensity * 0.4, 1);
      return;
    }
    const kind = kinds.get(enemyId);
    if (kind === 'clamp') {
      clang(time, chord.bass + 19, 0.7, 0.7);
      playerNoise(time, 0.06, 0.05, 3400);
      return;
    }
    // Armour chip: a bright ting, pitched from the live chord.
    const midi = chord.arp[(enemyId + 1) % chord.arp.length] + 24;
    bell(time, midi, 0.25, 0.5, 0.2);
    playerNoise(time, 0.04, 0.03, 5600);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(notePosition(time));
    if (enemyId === coreId) {
      // The core cracks: it lurches at the car.
      clang(time, chord.bass + 12, 2.4, 1.1);
      impact(time, 1.0);
      riser(time, 1.2, 0.16);
      return;
    }
    // Sentry armour blows off.
    playerNoise(time, 0.16, 0.12, 2600);
    clang(time, chord.arp[1] + 24, 0.5, 0.55);
    bell(time + THIRTYSECOND, chord.arp[3] + 24, 0.5, 0.4, 0.3);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const kind = kinds.get(enemyId);
    latches.delete(enemyId);
    if (enemyId === coreId) {
      coreFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0, kind === 'clamp' || kind === 'manta' || kind === 'sentry');
    if (kind === 'clamp') {
      const chord = score.chordAt(position);
      clang(kill.time, chord.bass + 12, 1.6, 1.0);
      impact(kill.time, 0.6);
    }
  });

  function coreFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = notePosition(time);
    const chord = score.chordAt(position);
    // The Ripper lets go: the music ducks for a breath, then a conclusive figure lands on the grid.
    audioMix.duckAt(time, 0.06, 2.2);
    impact(time, 1.45);
    clang(time, 38, 6, 1.2);
    pad(time + 0.2, DOCK_CHORD.pad, 9, 0.7, 0.35, 0.6);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      playerTone(time + 0.4 + index * THIRTYSECOND * 1.5, midi + 12, PLAYER_VOICES[3].kill, 0.9 - index * 0.07, 1);
    });
    bell(time + 1.2, chord.arp[0] + 24, 3, 0.5, 0.6);
    riser(time, 0.8, 0.1);
  }

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = notePosition(time);
    const chord = score.chordAt(position);
    pad(time, chord.pad, 12 * SIXTEENTH, size >= 6 ? 0.55 : 0.36, 0.55, 0.7);
    const leadSet = score.leadSetAt(position);
    const section = score.sectionMixAt(position).to;
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[section].kill, 0.6 - index * 0.06, 1);
    });
    if (size >= 6) {
      sub(time, chord.bass + 12, 0.6, 0.7);
      crash(time, 0.12);
    }
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Rejection: an airlock interlock refusing — a dull double thud, no reward.
    voices.oscillator({
      context: ctx,
      time,
      stopTime: time + 0.3,
      oscillatorType: 'square',
      frequency: 140,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 60, time: time + 0.22 }],
      filter: { type: 'lowpass', frequency: 700 },
      gainAutomation: [
        { type: 'set', value: 0.11, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
      ],
      destination: output,
    });
    voices.oscillator({
      context: ctx,
      time: time + 0.07,
      stopTime: time + 0.3,
      oscillatorType: 'square',
      frequency: 131,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 55, time: time + 0.24 }],
      filter: { type: 'lowpass', frequency: 620 },
      gainAutomation: [
        { type: 'set', value: 0.08, time: time + 0.07 },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
      ],
      destination: output,
    });
    noiseHit(time, 0.1, 0.1, 'bandpass', 700, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(notePosition(time));
    // The hull takes it: a boom and a scrape, and a two-note alarm from the live chord.
    thumpBoom(time, chord.bass + 12);
    [chord.arp[2] + 12, chord.arp[0] + 12].forEach((midi, index) => {
      voices.oscillator({
        context: ctx as AudioContext,
        time: time + index * 0.13,
        stopTime: time + index * 0.13 + 0.14,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1800 },
        gainAutomation: [
          { type: 'set', value: 0.055, time: time + index * 0.13 },
          { type: 'exponentialRamp', value: 0.001, time: time + index * 0.13 + 0.12 },
        ],
        destination: output,
        sends: playerSends(0.1, 0.1),
      });
    });
    noiseHit(time, 0.18, 0.18, 'bandpass', 900, output);
  });

  function thumpBoom(time: number, midi: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    voices.oscillator({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - 12), time: time + 0.34 }],
      gainAutomation: [
        { type: 'set', value: 0.4, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.46 },
      ],
      destination: output,
    });
  }

  bus.on('miss', ({ enemyId }) => {
    const output = sfxDestination();
    latches.delete(enemyId);
    if (!ctx || !output || kinds.get(enemyId) === 'hauler') return;
    const time = ctx.currentTime;
    // A run ending (or a wave leaving together) misses many enemies in one frame: one blip is enough.
    if (time - lastMissBlip < 0.08) return;
    lastMissBlip = time;
    const chord = score.chordAt(notePosition(time));
    voices.oscillator({
      context: ctx,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'sine',
      frequency: midiToFreq(chord.bass + 24),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.11 }],
      gainAutomation: [
        { type: 'set', value: 0.04, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: output,
      sends: playerSends(0.08, 0.05),
    });
  });

  bus.on('runend', ({ died }) => {
    afterRun = true;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (died) {
      // The climber is lost: the music ducks, the cable rings once, and the storm-free hush follows.
      runtime.mix()?.duckAt(now, 0.08, 2.6);
      clang(now + 0.05, 38, 5, 0.9);
      impact(now + 0.05, 0.8);
      whoosh(now + 0.1, 1.8, 0.6, false);
    }
    // The last chord rings out over the replay letters; the storm bed stays gone.
    pad(now + 0.1, DOCK_CHORD.pad, 7, died ? 0.32 : 0.5, 0.22, 0.3);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx || phase !== 'exposed') return;
    // Every clamp is gone: the core opens, and the heartbeat begins on the next bar.
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(notePosition(time));
    clang(time, chord.bass + 24, 2, 0.8);
    riser(time - 0.4 > ctx.currentTime ? time - 0.4 : time, 0.5, 0.1);
  });

  return runtime;
}
