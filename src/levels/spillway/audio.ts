import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementContext, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSpillwayVoices, type PluckTimbre, type RiverState } from './audio-voices';
import { SPILLWAY_BARS, SPILLWAY_BPM, SPILLWAY_DURATION, SPILLWAY_RUN_SECTIONS, SPILLWAY_STEPS_PER_BAR, SPILLWAY_TIME } from './timing';

// The Spillway score: 132 BPM in D minor with a dorian colour, for hand drums,
// low strings and plucked strings. 70 bars follow the run's section map:
//
//   upper      0–8   kora over a D drone; the dorian G/D gives it air
//   narrows    8–20  hand drums and the spiccato ostinato enter on Dm–C–Bb–A
//   chute     20–22  first speed kick: big drum and a string rip onto the downbeat
//   whitewater 22–36 the cello theme over full drums; rougher (tremolo, slaps) bar by bar;
//                    the under-pass (bars 30–31) drops to G minor and half the drums
//   reservoir 36–42  breakdown: drums fall back, a long cello line over Bbmaj7–F–Gm
//   dam       42–44  the build: frame-drum crescendo, tremolo, a rip into the boss
//   boss      44–58  loudest point; each broken leg adds a layer; Eb (bII) is the walker
//   breach    58–60  the gates burst, then near silence: only the river and a string harmonic
//   spillway  60–66  second speed kick: the full theme in octaves, the emotional peak
//   valley    66–70  D major: the minor resolves, winding down to the kora figure
//
// Player actions are notes: locks are harp harmonics climbing the live chord,
// shots are pizzicato notes in the mid register, and kills walk a hidden
// two-bar lane per section so a volley plays a plucked run. The lead set the
// lanes read sits from A4 up; the backing (theme, arps, ostinato) stays at or
// below G4 whenever enemies are dense, so the player's melody has its own register.

const SIXTEENTH = SPILLWAY_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const BEAT = SPILLWAY_TIME.beatSeconds;
const BAR = SPILLWAY_TIME.barSeconds;
const STEPS_PER_BAR = SPILLWAY_STEPS_PER_BAR;

type Chord = {
  name: string;
  /** Double-bass root. */
  bass: number;
  /** Cello and viola voicing for the ensemble pad. */
  pad: readonly number[];
  /** Mid-register chord tones for the backing kora and the shots (never above G4). */
  arp: readonly number[];
  /** The player's lead set: eight chord-scale tones from A4 up. Kill lanes index it. */
  lead: readonly number[];
};

const Dm: Chord = { name: 'Dm', bass: 38, pad: [50, 57, 62, 65], arp: [57, 60, 62, 65], lead: [69, 72, 74, 76, 77, 81, 84, 86] };
const C: Chord = { name: 'C', bass: 36, pad: [48, 55, 60, 64], arp: [55, 60, 64, 67], lead: [69, 72, 74, 76, 79, 81, 84, 88] };
const Bb: Chord = { name: 'Bb', bass: 34, pad: [46, 53, 58, 62], arp: [53, 58, 62, 65], lead: [70, 72, 74, 77, 81, 82, 84, 86] };
const A: Chord = { name: 'A', bass: 33, pad: [45, 52, 57, 61], arp: [52, 57, 61, 64], lead: [69, 71, 73, 76, 81, 83, 85, 88] };
const Asus: Chord = { name: 'Asus4', bass: 33, pad: [45, 52, 57, 62], arp: [52, 57, 62, 64], lead: [69, 71, 74, 76, 81, 83, 86, 88] };
const GoverD: Chord = { name: 'G/D', bass: 38, pad: [50, 55, 59, 62], arp: [55, 59, 62, 67], lead: [69, 71, 74, 76, 79, 81, 83, 86] };
const Gm: Chord = { name: 'Gm', bass: 31, pad: [43, 50, 55, 58], arp: [55, 58, 62, 67], lead: [69, 70, 74, 77, 79, 81, 82, 86] };
const Bbmaj7: Chord = { name: 'Bbmaj7', bass: 34, pad: [46, 53, 57, 62], arp: [53, 57, 58, 62], lead: [69, 70, 72, 74, 77, 81, 82, 86] };
const F: Chord = { name: 'F', bass: 29, pad: [48, 53, 57, 60], arp: [53, 57, 60, 65], lead: [69, 72, 74, 77, 79, 81, 84, 86] };
const Eb: Chord = { name: 'Eb', bass: 39, pad: [51, 55, 58, 63], arp: [55, 58, 63, 67], lead: [70, 72, 75, 77, 79, 82, 84, 87] };
const D: Chord = { name: 'D', bass: 38, pad: [50, 57, 62, 66], arp: [54, 57, 62, 66], lead: [69, 71, 74, 76, 78, 81, 83, 86] };

// One chord per bar for the whole run, so every section can move at its own rate.
const HARMONY: readonly Chord[] = [
  /* upper      0 */ Dm, Dm, GoverD, GoverD, Dm, Dm, C, Asus,
  /* narrows    8 */ Dm, Dm, C, C, Bb, Bb, A, A, Dm, C, Bb, A,
  /* chute     20 */ Dm, A,
  /* whitewater 22 */ Dm, Dm, C, C, Bb, Bb, A, A, Gm, Gm, Dm, Dm, Bb, A,
  /* reservoir 36 */ Bbmaj7, Bbmaj7, F, F, Gm, Asus,
  /* dam       42 */ Dm, A,
  /* boss      44 */ Dm, Dm, Bb, Bb, Gm, Gm, A, A, Dm, Eb, Dm, Eb, Bb, A,
  /* breach    58 */ Bb, A,
  /* spillway  60 */ Dm, Dm, C, C, Bb, A,
  /* valley    66 */ D, GoverD, D, D,
];
if (HARMONY.length !== SPILLWAY_BARS.end) throw new Error(`Spillway harmony covers ${HARMONY.length} bars, expected ${SPILLWAY_BARS.end}`);

const AMBIENT_HARMONY = HARMONY.slice(SPILLWAY_BARS.upper, SPILLWAY_BARS.narrows);

type Section = typeof SPILLWAY_RUN_SECTIONS[number]['name'];

// Kill lanes: 32 steps (two bars) of degrees 0–7 into the live lead set.
const KILL_LANES: Record<Section, number[]> = {
  // A slow arch, for the few kills on the calm pool.
  upper: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Rising runs that fall back: the current picking up.
  narrows: [
    0, 1, 2, 3, 4, 3, 2, 1,
    2, 3, 4, 5, 4, 3, 2, 3,
    4, 5, 6, 5, 4, 3, 4, 5,
    6, 7, 6, 5, 4, 3, 2, 1,
  ],
  // The cascade: straight falls from the top.
  chute: [
    7, 6, 5, 4, 3, 2, 1, 0,
    7, 6, 5, 4, 3, 2, 1, 0,
    6, 5, 4, 3, 2, 1, 0, 1,
    7, 5, 6, 4, 5, 3, 4, 2,
  ],
  // Broken leaps for dense volleys in the rapids.
  whitewater: [
    0, 4, 2, 5, 3, 6, 4, 7,
    5, 2, 6, 3, 7, 4, 5, 1,
    0, 3, 5, 7, 6, 4, 2, 4,
    5, 7, 6, 5, 3, 4, 2, 1,
  ],
  // Wide, unhurried intervals over the still water.
  reservoir: [
    4, 2, 5, 3, 6, 4, 7, 5,
    4, 3, 2, 1, 2, 3, 4, 2,
    5, 4, 6, 5, 7, 6, 5, 4,
    3, 2, 4, 3, 1, 2, 0, 2,
  ],
  // A ladder that climbs toward the crest.
  dam: [
    0, 1, 2, 3, 1, 2, 3, 4,
    2, 3, 4, 5, 3, 4, 5, 6,
    4, 5, 6, 7, 5, 6, 7, 6,
    4, 5, 6, 7, 6, 7, 6, 7,
  ],
  // Tolling descents answered by climbs, so leg and core damage ring like bells.
  boss: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
  // Rare kills in the silence: high, spaced notes.
  breach: [
    7, 5, 6, 4, 7, 5, 6, 4,
    6, 4, 5, 3, 6, 4, 5, 3,
    5, 3, 4, 2, 5, 3, 4, 2,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
  // Sweeps up to the top: the peak of the run.
  spillway: [
    0, 2, 4, 7, 5, 4, 2, 4,
    1, 3, 5, 7, 6, 5, 3, 5,
    2, 4, 6, 7, 6, 4, 5, 7,
    4, 5, 6, 7, 7, 6, 5, 7,
  ],
  // Gentle descents that come to rest on the lowest degree.
  valley: [
    7, 6, 5, 4, 5, 4, 3, 2,
    4, 3, 2, 1, 2, 1, 0, 2,
    5, 4, 3, 2, 3, 2, 1, 0,
    4, 3, 2, 1, 1, 0, 1, 0,
  ],
};

// The player's plucked string per section: soft harp on still water, a bright
// kora in the gorge, a hard nail pluck in the rapids and the fight.
const PLAYER_VOICES: Record<Section, { timbre: PluckTimbre; gain: number }> = {
  upper: { timbre: 'kora', gain: 0.8 },
  narrows: { timbre: 'kora', gain: 0.85 },
  chute: { timbre: 'bite', gain: 1.25 },
  whitewater: { timbre: 'bite', gain: 1.25 },
  reservoir: { timbre: 'harp', gain: 0.85 },
  dam: { timbre: 'kora', gain: 0.85 },
  boss: { timbre: 'bite', gain: 1.35 },
  breach: { timbre: 'harp', gain: 0.8 },
  spillway: { timbre: 'bite', gain: 1.35 },
  valley: { timbre: 'harp', gain: 0.8 },
};

// The cello theme, in [bar, beat, midi, beats]. Bars 0–7 sit on Dm Dm C C Bb Bb A A;
// bars 8–9 are the spillway's climb and cadence (Bb, A); bars 10–13 are the
// valley's closing line over D major. The top note is G4, under the lead set.
const THEME: Array<[number, number, number, number]> = [
  [0, 0, 57, 1], [0, 1, 62, 1.5], [0, 2.5, 64, 0.5], [0, 3, 65, 1],
  [1, 0, 64, 1.5], [1, 1.5, 62, 0.5], [1, 2, 57, 2],
  [2, 0, 55, 1], [2, 1, 60, 1.5], [2, 2.5, 62, 0.5], [2, 3, 64, 1],
  [3, 0, 67, 2], [3, 2, 64, 1], [3, 3, 60, 1],
  [4, 0, 62, 1], [4, 1, 65, 1.5], [4, 2.5, 67, 0.5], [4, 3, 65, 1],
  [5, 0, 62, 3], [5, 3, 58, 1],
  [6, 0, 57, 1], [6, 1, 61, 1.5], [6, 2.5, 62, 0.5], [6, 3, 64, 1],
  [7, 0, 61, 2], [7, 2, 57, 2],
  [8, 0, 65, 1], [8, 1, 67, 1], [8, 2, 65, 0.5], [8, 2.5, 67, 0.5], [8, 3, 62, 1],
  [9, 0, 64, 2], [9, 2, 61, 1], [9, 3, 57, 1],
  [10, 0, 62, 4],
  [11, 0, 59, 2], [11, 2, 62, 2],
  [12, 0, 57, 4],
  [13, 0, 50, 4],
];

// Which theme bar each section bar plays. The whitewater states the theme,
// rests under the walker's belly (Gm), then returns with its first and last phrases.
const WHITEWATER_THEME = [0, 1, 2, 3, 4, 5, 6, 7, -1, -1, 0, 1, 4, 6];
const SPILLWAY_THEME = [0, 1, 2, 3, 8, 9];
const VALLEY_THEME = [10, 11, 12, 13];

// The reservoir's long cello line over Bbmaj7 Bbmaj7 F F Gm Asus.
const RESERVOIR_LINE: Array<[number, number, number, number]> = [
  [0, 0, 62, 4],
  [1, 0, 65, 2], [1, 2, 60, 2],
  [2, 0, 65, 3], [2, 3, 67, 1],
  [3, 0, 64, 4],
  [4, 0, 62, 2], [4, 2, 65, 2],
  [5, 0, 64, 4],
];

// The boss riff, as indexes into the chord's arp so it follows the harmony. [bar, beat, arpIndex, beats]
const BOSS_RIFF: Array<[number, number, number, number]> = [
  [0, 0, 0, 1], [0, 1, 1, 0.5], [0, 1.5, 2, 0.5], [0, 2, 3, 1], [0, 3, 2, 1],
  [1, 0, 1, 1.5], [1, 1.5, 0, 0.5], [1, 2, 1, 1], [1, 3, 0, 1],
];

// The river's level and colour by bar. Values are [body, colour Hz, roar, spray, surge].
const RIVER_KEYS: Array<[number, [number, number, number, number, number]]> = [
  [0, [0.035, 900, 0.02, 0.007, 0.2]], // upper: a gentle pool
  [7.75, [0.035, 900, 0.02, 0.007, 0.2]],
  [8, [0.045, 1300, 0.032, 0.012, 0.3]], // narrows: first rapids
  [19.75, [0.06, 1700, 0.05, 0.018, 0.4]],
  [20, [0.085, 2800, 0.08, 0.035, 0.5]], // chute: the drop roars
  [22, [0.06, 2400, 0.05, 0.022, 0.6]], // whitewater
  [35.75, [0.065, 2600, 0.055, 0.024, 0.6]],
  [36, [0.015, 500, 0.009, 0.0025, 0.1]], // reservoir: a still hush
  [41.75, [0.015, 500, 0.012, 0.0025, 0.1]],
  [42, [0.02, 650, 0.03, 0.004, 0.15]], // dam: water spilling somewhere below
  [44, [0.025, 800, 0.035, 0.006, 0.2]], // boss
  [57.75, [0.028, 850, 0.04, 0.006, 0.2]],
  [58, [0.02, 420, 0.04, 0.003, 0.1]], // breach: the lake starts to move
  [59.75, [0.06, 1400, 0.13, 0.018, 0.3]],
  [60, [0.095, 3200, 0.095, 0.04, 0.6]], // spillway: loudest
  [65.75, [0.095, 3200, 0.095, 0.04, 0.6]],
  [66, [0.055, 1400, 0.045, 0.014, 0.3]], // valley: fading over open water
  [70, [0.01, 700, 0.01, 0.002, 0.1]],
];

export function createAudio(bus: EventBus) {
  return createSpillwayAudio(bus).audio;
}

export const traceSpillwayAudio = createAudioTraceHarness({
  level: 'spillway',
  bpm: SPILLWAY_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SPILLWAY_DURATION,
  createAudio: createSpillwayAudio,
});

type Ctx = ArrangementContext<Chord>;

function createSpillwayAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;

  // Boss state drives the arrangement: each broken leg adds a layer.
  const boss = { legsDown: 0, coreOpen: false, coreDown: false };
  const kinds = new Map<number, string>();
  const maxHp = new Map<number, number>();

  const score = createScore<Chord, Section>({
    bpm: SPILLWAY_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: HARMONY,
    barsPerChord: 1,
    sections: SPILLWAY_RUN_SECTIONS.map(({ name, fromBar }) => ({ index: name, fromBar })),
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const voices = createSpillwayVoices({ trace, context: () => ctx, mix: () => runtime.mix() });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      // Acoustic material: gentler compression than the electronic levels.
      compressor: { threshold: -16, ratio: 3.5, knee: 8, attack: 0.008, release: 0.25 },
      // A canyon slapback for the plucks.
      delay: { time: SIXTEENTH * 3, feedback: 0.22, dampHz: 1800 },
      // The gorge: a long, dark hall.
      reverb: { seconds: 3.2, decay: 3, level: 0.42 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, position, time, mode }) {
      if (mode === 'run') {
        if (step === 0) runArrangement.recordSectionStart(time, bar);
        setRiver(time, riverAt(position / STEPS_PER_BAR));
      } else if (step === 0) {
        setRiver(time, riverAt(0));
      }
    },
    onPostBuild(context, mix) {
      ctx = context;
      voices.install(context, mix, riverAt(0));
    },
    onStep: scheduleStep,
    onRunStart() {
      boss.legsDown = 0;
      boss.coreOpen = false;
      boss.coreDown = false;
      kinds.clear();
      maxHp.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const time = context.currentTime + 0.05;
      // A finished run stays in the valley's D major rather than wrapping back to bar 0.
      const position = score.arrangementPositionAt(time);
      const chord = score.barAt(position) >= SPILLWAY_BARS.valley ? D : score.chordAt(position);
      strum(time, [chord.bass + 12, ...chord.pad], 0.25, THIRTYSECOND, 'harp', 'music');
    },
    onDispose() {
      ctx = null;
      voices.release();
    },
  });

  const {
    djembeBass, djembeTone, djembeSlap, frameDrum, shaker, bigDrum,
    pad, line, spiccato, stab, rip, pluck, strum, river, gateBurst,
    playerFire, playerLock, playerKill, playerHarmonic, deadString, cableSnap,
    playerChip, legBreak, playerHit, missThud, slabGrind,
  } = voices;

  function setRiver(time: number, state: RiverState) {
    river(time, state.body, state.color, state.roar, state.spray, state.surge);
  }

  // ---- arrangement helpers -----------------------------------------------

  const chordStartsAt = (bar: number, sectionStart: number) => bar === sectionStart || HARMONY[bar - 1] !== HARMONY[bar];
  const chordBarsFrom = (bar: number, limit: number) => {
    let bars = 1;
    while (bar + bars < limit && HARMONY[bar + bars] === HARMONY[bar]) bars += 1;
    return bars;
  };
  const sectionEnd = (c: Ctx) => c.section.toBar ?? SPILLWAY_BARS.end;

  /** Runs once at each chord change, with the chord's length in bars (clipped to the section). */
  function onChord(play: (c: Ctx, bars: number) => void): ArrangementTrack<Chord> {
    return fn((c) => {
      if (c.step === 0 && chordStartsAt(c.bar, c.section.fromBar)) play(c, chordBarsFrom(c.bar, sectionEnd(c)));
    });
  }

  function basses(vel: number | ((c: Ctx) => number), brightness: number) {
    return onChord((c, bars) => {
      const v = typeof vel === 'function' ? vel(c) : vel;
      if (v > 0) pad(c.time, [c.chord.bass, c.chord.bass + 12], bars * BAR * 1.02, v, brightness, 0);
    });
  }

  function pads(vel: number | ((c: Ctx) => number), brightness: number | ((c: Ctx) => number), tremolo: (c: Ctx) => number = () => 0) {
    return onChord((c, bars) => {
      const v = typeof vel === 'function' ? vel(c) : vel;
      const b = typeof brightness === 'function' ? brightness(c) : brightness;
      if (v > 0) pad(c.time, c.chord.pad as number[], bars * BAR * 1.02, v, b, tremolo(c));
    });
  }

  /** Spiccato ostinato: O = root, o = fifth, u = upper octave, all from the bass. */
  function ostinato(pattern: string, vel: number | ((c: Ctx) => number), brightness: number) {
    return hits<Chord>(pattern, { O: 1, o: 0.7, u: 0.8 }, (c, accent, symbol) => {
      const v = typeof vel === 'function' ? vel(c) : vel;
      if (v <= 0) return;
      const midi = c.chord.bass + (symbol === 'O' ? 12 : symbol === 'o' ? 19 : 24);
      spiccato(c.time, midi, v * accent, brightness, 'music');
    });
  }

  /** Backing kora: digits index the chord's arp, L is the lowest lead tone. */
  function kora(pattern: string, vel: number | ((c: Ctx) => number), timbre: PluckTimbre) {
    return hits<Chord>(pattern, { 0: 1, 1: 0.8, 2: 0.9, 3: 0.8, L: 0.75 }, (c, accent, symbol) => {
      const v = typeof vel === 'function' ? vel(c) : vel;
      if (v <= 0) return;
      const midi = symbol === 'L' ? c.chord.lead[0] : c.chord.arp[Number(symbol)];
      pluck(c.time, midi, v * accent, timbre, 'music');
    });
  }

  function djembe(bass: string, tone: string, slap: string, vel: number | ((c: Ctx) => number) = 1) {
    const level = (c: Ctx) => (typeof vel === 'function' ? vel(c) : vel);
    return [
      hits<Chord>(bass, { B: 1, b: 0.65 }, (c, v) => { if (level(c) > 0) djembeBass(c.time, v * level(c)); }),
      hits<Chord>(tone, { T: 1, t: 0.45, H: 0.9 }, (c, v, symbol) => { if (level(c) > 0) djembeTone(c.time, v * level(c), symbol === 'H' ? 1.12 : 1); }),
      hits<Chord>(slap, { S: 1, s: 0.5 }, (c, v) => { if (level(c) > 0) djembeSlap(c.time, v * level(c)); }),
    ];
  }

  function shakers(pattern: string, vel: number | ((c: Ctx) => number) = 1) {
    return hits<Chord>(pattern, { s: 0.035, S: 0.065, w: 0.09 }, (c, v, symbol) => {
      const level = typeof vel === 'function' ? vel(c) : vel;
      if (level > 0) shaker(c.time, v * level, symbol === 'w' ? 1 : 0);
    });
  }

  function frames(pattern: string, vel: number | ((c: Ctx) => number) = 1, pitch = 1) {
    return hits<Chord>(pattern, { F: 0.8, f: 0.5 }, (c, v) => {
      const level = typeof vel === 'function' ? vel(c) : vel;
      if (level > 0) frameDrum(c.time, v * level, pitch, 'music');
    });
  }

  /** A 16th-note frame-drum crescendo over the second half of a section bar. */
  function roll(barInSection: number, from = 0.2, to = 0.75) {
    return fn<Chord>((c) => {
      if (c.barInSection !== barInSection || c.step < 8) return;
      frameDrum(c.time, lerp(from, to, (c.step - 8) / 7), 1.05, 'music');
    });
  }

  /** The cello section plays theme bars mapped from section bars; -1 rests. */
  function theme(map: readonly number[], vel: number, brightness: number, doubled: boolean) {
    return fn<Chord>((c) => {
      const themeBar = map[c.barInSection];
      if (themeBar === undefined || themeBar < 0) return;
      for (const [noteBar, beat, midi, beats] of THEME) {
        if (noteBar !== themeBar || beat * 4 !== c.step) continue;
        line(c.time, midi, beats * BEAT * 0.96, vel, brightness);
        if (doubled) line(c.time, midi - 12, beats * BEAT * 0.96, vel * 0.75, brightness * 0.6);
      }
    });
  }

  function speedKick(vel: number) {
    return oneShot<Chord>(0, 0, (c) => {
      bigDrum(c.time, vel, 'music');
      stab(c.time, [c.chord.bass, c.chord.bass + 12, ...c.chord.pad], vel, 0.8, 'music');
      shaker(c.time, 0.1, 1);
    });
  }

  /** A string rip from the bar's bass up to the next downbeat's root. */
  function ripInto(barInSection: number, toMidi: number, vel: number) {
    return oneShot<Chord>(barInSection, 0, (c) => rip(c.time, c.chord.bass + 12, toMidi, BAR, vel));
  }

  const legs = () => boss.legsDown;
  const fighting = () => !boss.coreDown;

  // ---- patterns (16 steps; 32 where two bars differ) -------------------------

  const REST = '................';
  const WHITEWATER_BASS = 'B..B......B..B..';
  const WHITEWATER_TONE = '..T.t.TT..T.t.T.';
  const WHITEWATER_SLAP = '....S..S....S..S';
  const TRESILLO = 'F.....f.....F...';
  const GALLOP = 'O.oOO.oOO.oOO.oO';
  const KORA_THREES = '0121232303012321';
  const UPPER_FIGURE = '0..2..3.L...3.2.' + '1..3..L.....2...';

  // ---- ambient (attract screen) --------------------------------------------

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: (position) => AMBIENT_HARMONY[Math.floor(position / STEPS_PER_BAR) % AMBIENT_HARMONY.length],
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        hits('P' + '.'.repeat(STEPS_PER_BAR * 8 - 1), { P: 1 }, ({ time }) => pad(time, [38, 45], 8 * BAR * 1.02, 0.7, 0.12, 0)),
        kora(UPPER_FIGURE, 0.16, 'kora'),
        hits('F' + '.'.repeat(STEPS_PER_BAR * 4 - 1), { F: 0.3 }, ({ time }, v) => frameDrum(time, v, 0.9, 'music')),
      ],
    }],
  });

  // ---- the run --------------------------------------------------------------

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'upper',
        fromBar: SPILLWAY_BARS.upper,
        tracks: [
          // A D drone under the kora; soft cellos only for the lead-in.
          oneShot(0, 0, ({ time }) => pad(time, [38, 45], 8 * BAR * 1.02, 0.8, 0.15, 0)),
          kora(UPPER_FIGURE, (c) => 0.2 + c.barInSection * 0.012, 'kora'),
          fn((c) => { if (c.barInSection === 6 && c.step === 0) pad(c.time, C.pad as number[], BAR * 1.02, 0.35, 0.2, 0); }),
          fn((c) => { if (c.barInSection === 7 && c.step === 0) pad(c.time, Asus.pad as number[], BAR * 1.02, 0.42, 0.25, 0); }),
          fn((c) => { if (c.barInSection >= 4 && c.barInSection % 2 === 0 && c.step === 0) frameDrum(c.time, 0.35, 0.9, 'music'); }),
          fn((c) => { if (c.barInSection >= 6 && c.step % 4 === 2) shaker(c.time, 0.025 + (c.barInSection - 6) * 0.01, 0); }),
          // A djembe pickup into the narrows.
          fn((c) => { if (c.barInSection === 7 && (c.step === 12 || c.step === 14)) djembeTone(c.time, 0.35 + (c.step - 12) * 0.08, 1); }),
        ],
      },
      {
        name: 'narrows',
        fromBar: SPILLWAY_BARS.narrows,
        tracks: [
          basses(0.6, 0.2),
          pads((c) => (c.barInSection >= 4 ? 0.45 : 0), 0.3),
          ...djembe('B.........B.....', '......T.T.....T.', REST),
          ...djembe(REST, '..t.............', '....S.......S...', (c) => (c.barInSection >= 4 ? 1 : 0)),
          shakers('..s...s...s...s.', (c) => (c.barInSection < 8 ? 1 : 0)),
          shakers('s.S.s.S.s.S.s.S.', (c) => (c.barInSection >= 8 ? 1 : 0)),
          frames('F...............' + REST, 0.8),
          ostinato('O.o.O.o.O.o.O.o.', (c) => (c.barInSection < 4 ? 0.6 : 0), 0.35),
          ostinato(GALLOP, (c) => (c.barInSection >= 4 ? 0.65 : 0), 0.4),
          kora('0.1.2.3.2.1.3.2.', 0.2, 'kora'),
          // The chord-per-bar run-in (bars 16–19) tightens the slaps, then rolls into the chute.
          fn((c) => { if (c.barInSection >= 8 && (c.step === 14 || c.step === 15)) djembeSlap(c.time, 0.45); }),
          roll(11, 0.25, 0.85),
          ripInto(11, Dm.bass + 24, 0.9),
        ],
      },
      {
        name: 'chute',
        fromBar: SPILLWAY_BARS.chute,
        tracks: [
          speedKick(1.1),
          basses(0.85, 0.35),
          pads(0.7, 0.6, () => 0.6),
          ...djembe('B..B..B...B..B..', 'tTtTtHtTtTtHtTtT', '....S.......S...'),
          frames(TRESILLO),
          shakers('sSssSssSsSssSssS'),
          ostinato('OoOoOoOoOoOoOoOo', 0.7, 0.6),
          kora('3210321032103210', 0.17, 'bite'),
          roll(1, 0.3, 0.9),
        ],
      },
      {
        name: 'whitewater',
        fromBar: SPILLWAY_BARS.whitewater,
        tracks: [
          oneShot(0, 0, ({ time }) => bigDrum(time, 0.9, 'music')),
          basses(0.8, 0.3),
          // Rougher bar by bar: brighter bows and a tremolo that grows.
          pads(0.55, (c) => 0.35 + c.barInSection * 0.03, (c) => Math.min(0.8, c.barInSection / 12)),
          // The theme's return after the under-pass is doubled an octave down.
          theme(WHITEWATER_THEME.map((bar, index) => (index < 10 ? bar : -1)), 0.95, 0.45, false),
          theme(WHITEWATER_THEME.map((bar, index) => (index >= 10 ? bar : -1)), 0.95, 0.5, true),
          // Under the walker's belly (section bars 8–9): the drums drop to bass and frame.
          ...djembe(WHITEWATER_BASS, WHITEWATER_TONE, WHITEWATER_SLAP, (c) => (c.barInSection === 8 || c.barInSection === 9 ? 0 : 1)),
          ...djembe('B.........B.....', REST, REST, (c) => (c.barInSection === 8 || c.barInSection === 9 ? 1 : 0)),
          hits<Chord>('...s..s....s.s..', { s: 1 }, (c) => { if (c.barInSection >= 5 && c.barInSection !== 8 && c.barInSection !== 9) djembeSlap(c.time, 0.3 + c.barInSection * 0.015); }),
          frames(TRESILLO),
          oneShot(8, 0, ({ time }) => bigDrum(time, 0.8, 'music')),
          oneShot(10, 0, ({ time }) => bigDrum(time, 1, 'music')),
          shakers('ssSsssSsssSsssSs', (c) => (c.barInSection === 8 || c.barInSection === 9 ? 0.5 : 1)),
          ostinato(GALLOP, (c) => (c.barInSection === 8 || c.barInSection === 9 ? 0.4 : 0.7), 0.5),
          kora(KORA_THREES, (c) => (c.barInSection === 8 || c.barInSection === 9 ? 0 : 0.16), 'kora'),
          roll(13, 0.3, 0.6),
        ],
      },
      {
        name: 'reservoir',
        fromBar: SPILLWAY_BARS.reservoir,
        tracks: [
          basses(0.6, 0.2),
          pads(0.85, 0.35),
          fn((c) => {
            for (const [noteBar, beat, midi, beats] of RESERVOIR_LINE) {
              if (noteBar === c.barInSection && beat * 4 === c.step) line(c.time, midi, beats * BEAT * 0.98, 0.9, 0.3);
            }
          }),
          kora('0...1...2...3...' + '3...2...1...0...', 0.24, 'harp'),
          frames('F...............' + REST, 0.45, 0.9),
          shakers('........w.......' + REST, 0.6),
          // Bar 41 (Asus): the hands come back in.
          fn((c) => { if (c.barInSection === 5 && c.step >= 8 && c.step % 2 === 0) djembeTone(c.time, 0.2 + (c.step - 8) * 0.05, 1); }),
        ],
      },
      {
        name: 'dam',
        fromBar: SPILLWAY_BARS.dam,
        tracks: [
          basses(0.8, 0.3),
          pads((c) => 0.55 + c.barInSection * 0.15, 0.5, () => 1),
          fn((c) => { if (c.step % 2 === 0) frameDrum(c.time, 0.3 + (c.barInSection * 16 + c.step) / 32 * 0.45, 1, 'music'); }),
          ostinato('O.o.O.o.O.o.O.o.', (c) => (c.barInSection === 0 ? 0.6 : 0), 0.4),
          ostinato('OoOoOoOoOoOoOoOo', (c) => (c.barInSection === 1 ? 0.7 : 0), 0.55),
          shakers('s.s.s.s.s.s.s.s.' + 'sSsSsSsSsSsSsSsS'),
          fn((c) => { if (c.barInSection === 1 && c.step >= 8) djembeTone(c.time, 0.3 + (c.step - 8) * 0.07, 1.12); }),
          ripInto(1, Dm.bass + 24, 1),
        ],
      },
      {
        name: 'boss',
        fromBar: SPILLWAY_BARS.boss,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            bigDrum(time, 1.2, 'music');
            stab(time, [chord.bass, chord.bass + 12, ...chord.pad], 1.1, 0.8, 'music');
            shaker(time, 0.1, 1);
          }),
          // The fight. Every layer below checks the walker's state.
          basses((c) => (fighting() ? 1 : 0), 0.4),
          pads(
            (c) => (fighting() ? 0.6 : 0),
            () => 0.45 + legs() * 0.1,
            () => (legs() >= 2 ? 0.8 : 0),
          ),
          fn((c) => {
            if (!fighting()) return;
            const riffBar = c.barInSection % 2;
            for (const [noteBar, beat, index, beats] of BOSS_RIFF) {
              if (noteBar === riffBar && beat * 4 === c.step) line(c.time, c.chord.arp[index], beats * BEAT * 0.8, 0.8 + legs() * 0.05, 0.5 + legs() * 0.1);
            }
          }),
          ...djembe('B..B..B...B..B..', WHITEWATER_TONE, WHITEWATER_SLAP, () => (fighting() ? 1.05 : 0)),
          hits<Chord>('..s....s..s....s', { s: 1 }, (c) => { if (fighting() && legs() >= 2) djembeSlap(c.time, 0.4); }),
          frames(TRESILLO, () => (fighting() ? 1 : 0)),
          fn((c) => {
            if (!fighting()) return;
            const every = legs() >= 2 ? 1 : 2;
            if (c.step === 0 && c.barInSection % every === 0) bigDrum(c.time, 0.7 + legs() * 0.08, 'music');
            if (c.step === 8 && legs() >= 3) bigDrum(c.time, 0.6, 'music');
          }),
          shakers('s.S.s.S.s.S.s.S.', () => (fighting() && legs() < 1 ? 1 : 0)),
          shakers('sSssSssSsSssSssS', () => (fighting() && legs() >= 1 ? 1.1 : 0)),
          ostinato(GALLOP, () => (fighting() ? 0.75 : 0), 0.6),
          ostinato('..u...u...u...u.', () => (fighting() && legs() >= 1 ? 0.6 : 0), 0.7),
          kora('0.1.2.3.0.1.2.3.', () => (fighting() && legs() >= 3 ? 0.13 : 0), 'bite'),
          // The core is open: the whole section swells in tremolo.
          onChord((c, bars) => { if (fighting() && boss.coreOpen) pad(c.time, [c.chord.bass + 24, ...c.chord.arp], bars * BAR * 1.02, 0.5, 0.7, 1); }),
          // After the core dies: the dam groans under the wreck until the gates go.
          frames('F.......f.......', () => (fighting() ? 0 : 0.7), 0.85),
          onChord((c, bars) => { if (!fighting()) pad(c.time, [c.chord.bass, c.chord.bass + 12], bars * BAR * 1.02, 0.8, 0.15, 1); }),
          fn((c) => { if (!fighting() && c.barInSection % 2 === 0 && c.step === 4) rip(c.time, c.chord.bass + 12, c.chord.bass + 10, BAR * 1.5, 0.35); }),
          fn((c) => { if (!fighting() && c.barInSection % 2 === 1 && c.step === 0) bigDrum(c.time, 0.4, 'music'); }),
          // The gates go at bar 58 whatever happened: always roll into it.
          roll(13, 0.3, 0.95),
        ],
      },
      {
        name: 'breach',
        fromBar: SPILLWAY_BARS.breach,
        tracks: [
          // The gates burst, then the music is gone: a string harmonic and the river.
          oneShot(0, 0, ({ time }) => {
            gateBurst(time, 1.2);
            pad(time, [57, 64], 2 * BAR, 0.3, 0.05, 0);
          }),
          ripInto(1, Dm.bass + 24, 1),
          roll(1, 0.15, 0.8),
        ],
      },
      {
        name: 'spillway',
        fromBar: SPILLWAY_BARS.spillway,
        tracks: [
          speedKick(1.3),
          basses(1, 0.5),
          pads(0.9, 0.6),
          theme(SPILLWAY_THEME, 1.1, 0.65, true),
          ...djembe(WHITEWATER_BASS, WHITEWATER_TONE, WHITEWATER_SLAP, 1.05),
          frames(TRESILLO),
          fn((c) => { if (c.step === 0 && c.barInSection % 2 === 0 && c.barInSection > 0) bigDrum(c.time, 0.85, 'music'); }),
          shakers('sSssSssSsSssSssS', 1.1),
          ostinato(GALLOP, 0.75, 0.7),
          kora(KORA_THREES, 0.17, 'kora'),
          roll(5, 0.3, 0.7),
        ],
      },
      {
        name: 'valley',
        fromBar: SPILLWAY_BARS.valley,
        toBar: SPILLWAY_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            frameDrum(time, 0.55, 0.9, 'music');
            strum(time, chord.pad as number[], 0.22, THIRTYSECOND, 'harp', 'music');
            shaker(time, 0.07, 1);
          }),
          basses(0.65, 0.2),
          pads(0.6, 0.3),
          theme(VALLEY_THEME, 0.75, 0.3, false),
          kora(UPPER_FIGURE, (c) => (c.barInSection < 3 ? 0.2 - c.barInSection * 0.03 : 0), 'kora'),
          hits<Chord>('T.......t.......', { T: 0.4, t: 0.25 }, (c, v) => { if (c.barInSection < 2) djembeTone(c.time, v * (1 - c.barInSection * 0.4), 1); }),
          frames('F...............' + REST, 0.5, 0.9),
          // The last bar: a D major strum and a low D, and the river takes it.
          oneShot(3, 0, ({ time }) => {
            strum(time, [50, 57, 62, 66, 69, 74], 0.28, THIRTYSECOND * 1.5, 'harp', 'music');
            pluck(time, 38, 0.4, 'harp', 'music');
            frameDrum(time, 0.4, 0.85, 'music');
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  function riverAt(bar: number): RiverState {
    let before = RIVER_KEYS[0];
    let after = RIVER_KEYS[RIVER_KEYS.length - 1];
    for (let index = 0; index < RIVER_KEYS.length; index += 1) {
      if (RIVER_KEYS[index][0] <= bar) before = RIVER_KEYS[index];
      if (RIVER_KEYS[index][0] >= bar) {
        after = RIVER_KEYS[index];
        break;
      }
    }
    const span = after[0] - before[0];
    const t = span > 0 ? Math.min(1, Math.max(0, (bar - before[0]) / span)) : 1;
    const value = (i: number) => lerp(before[1][i], after[1][i], t);
    return { body: value(0), color: value(1), roar: value(2), spray: value(3), surge: value(4) };
  }

  // ---- player instruments ---------------------------------------------------

  function killNote(time: number, position: number, mix: SectionMix<Section>, chain: number) {
    const lane = KILL_LANES[mix.t >= 0.5 ? mix.to : mix.from];
    const lead = score.leadSetAt(position);
    const midi = lead[lane[position % lane.length]];
    const vel = Math.min(1.25, 1 + chain * 0.06);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const voice = PLAYER_VOICES[section];
      playerKill(time, midi, vel * voice.gain, voice.timbre, weight);
    }
    if (chain >= 2 && midi + 12 <= 93) playerHarmonic(time + THIRTYSECOND, midi + 12, 0.5 + chain * 0.06);
    return midi;
  }

  function chordAtTime(time: number) {
    return score.chordAt(score.arrangementPositionAt(time));
  }

  function coreFinale(time: number) {
    const mix = runtime.mix();
    mix?.duckAt(time, 0.2, 2.2);
    // DUM . . DUM DUM . . . DUM: the walker falls onto the gates.
    for (const [offset, vel] of [[0, 1.3], [3, 0.8], [4, 1], [8, 1.4]] as const) bigDrum(time + offset * SIXTEENTH, vel, 'player');
    stab(time + 8 * SIXTEENTH, [38, 50, 57, 62, 65], 1.4, 1, 'player');
    strum(time, [...Dm.lead].reverse(), 0.5, THIRTYSECOND, 'bite', 'player');
    frameDrum(time + 12 * SIXTEENTH, 0.6, 0.8, 'player');
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    kinds.set(enemyId, kind);
    if (!ctx) return;
    if (kind === 'core') {
      boss.coreOpen = true;
      const time = score.nextGridTime(ctx.currentTime, 4);
      const chord = chordAtTime(time);
      rip(time, chord.bass + 12, chord.bass + 24, BAR, 0.7);
    } else if (kind === 'slab') {
      slabGrind(score.nextGridTime(ctx.currentTime, 2), 1);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    playerLock(time, lead[Math.min(7, Math.max(0, lockCount - 1))], 1);
    if (lockCount >= 6) frameDrum(time, 0.35, 1.1, 'player');
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    playerLock(time, score.leadSetAt(score.arrangementPositionAt(time))[0], 0.5);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = chordAtTime(time);
    playerFire(time, chord.arp[(indexInVolley ?? 0) % chord.arp.length], 1);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    const kind = kinds.get(enemyId);
    const max = Math.max(maxHp.get(enemyId) ?? 0, hitPointsRemaining + 1);
    maxHp.set(enemyId, max);
    const intensity = 1 - hitPointsRemaining / max;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (kind === 'leg') {
      playerChip(time, [chord.arp[1], chord.arp[2]], chord.bass + 12, Math.min(1, intensity * 0.7 + boss.legsDown * 0.1));
    } else if (kind === 'core') {
      playerChip(time, [chord.arp[1], chord.arp[3]], chord.bass + 12, intensity);
      // A climbing harmonic: the closer the core is to breaking, the higher it rings.
      playerHarmonic(time + THIRTYSECOND, score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))], 0.6 + intensity * 0.4);
    } else {
      playerChip(time, [chord.arp[2]], chord.bass + 12, 0);
    }
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx || kinds.get(enemyId) !== 'leg') return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const chord = chordAtTime(time);
    stab(time, [chord.bass + 12, ...chord.pad.slice(1)], 0.6, 0.4 + boss.legsDown * 0.1, 'player');
    frameDrum(time, 0.7, 0.8, 'player');
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kind = kinds.get(enemyId);
    if (kind === 'core') {
      boss.coreDown = true;
      coreFinale(score.nextGridTime(ctx.currentTime, 4));
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    const chord = score.chordAt(position);
    if (kind === 'leg') {
      boss.legsDown = Math.min(4, boss.legsDown + 1);
      // The break lands on the next beat, as hard as the legs already down.
      const time = score.nextGridTime(ctx.currentTime, 4);
      const beatChord = chordAtTime(time);
      legBreak(time, beatChord.pad.slice(1) as number[], beatChord.bass, boss.legsDown / 4);
    } else if (kind === 'clamp') {
      cableSnap(kill.time, chord.bass + 24, 1);
    } else if (kind === 'pod') {
      frameDrum(kill.time, 0.45, 1, 'player');
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const voice = PLAYER_VOICES[score.sectionMixAt(position).to];
    // A full volley earns a strum up the lead set and a flam on the frame drum.
    strum(time, [lead[0], lead[2], lead[4], lead[7]], size >= 6 ? 0.38 : 0.3, THIRTYSECOND, voice.timbre, 'player');
    frameDrum(time, 0.3, 2.4, 'player');
    frameDrum(time + 0.025, 0.45, 2.4, 'player');
  });

  bus.on('reject', () => {
    if (!ctx) return;
    deadString(ctx.currentTime, chordAtTime(ctx.currentTime).bass + 24);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    playerHit(ctx.currentTime, chordAtTime(ctx.currentTime).bass);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    missThud(ctx.currentTime, chordAtTime(ctx.currentTime).bass + 12);
  });

  return runtime;
}
