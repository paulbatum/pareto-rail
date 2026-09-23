import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSkyhookVoices, installAirBed, type AirBed, type PlayerTimbre } from './audio-voices';
import { descenderTelemetry } from './descender';
import { GRAPPLER_ENTER, GRAPPLER_HOVER } from './gameplay';
import {
  LIGHTNING_HITS,
  SECTION_DOCK,
  SECTION_SUNLIT,
  SECTION_THIN,
  SECTION_VACUUM,
  SECTION_WEATHER,
  SKYHOOK_BARS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_SCORE_SECTIONS,
  SKYHOOK_STEPS_PER_BAR,
  SKYHOOK_TIME,
  type SkyhookSection,
} from './timing';

// THE SKYHOOK SCORE — 128 BPM, D minor, 32 bars plus a ring-out.
// The arrangement is the air. Down in the weather it is wide and wet: long
// detuned pads, rain plucked in the chord, half-time toms and thunder on the
// lightning. Punching through the deck, the full band arrives in B♭ lydian
// sunlight. Then it loses a layer every time the sky darkens — kick, snare,
// pads, reverb — until vacuum leaves a sub pulse, a thin drone, and the
// Descender's grip clanking down the tether as the only drum. Docking, the air
// comes back and the whole climb resolves to D major.
//
// Player actions are notes: locks climb the live chord, kills walk authored
// lanes, and every player timbre thins with the air until, in vacuum, what you
// hear is only what the hull conducts.

const STEPS_PER_BAR = SKYHOOK_STEPS_PER_BAR;
const SIXTEENTH = SKYHOOK_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const BAR_SECONDS = SKYHOOK_TIME.barSeconds;

type Chord = { name: string; bass: number; pad: number[]; arp: number[]; lead: number[] };

/** First eight notes at or above `low` whose pitch class is in the chord. */
function leadFrom(pitchClasses: number[], low: number) {
  const notes: number[] = [];
  for (let midi = low; notes.length < 8; midi += 1) if (pitchClasses.includes(((midi % 12) + 12) % 12)) notes.push(midi);
  return notes;
}

const chord = (name: string, bass: number, pad: number[], arp: number[], pcs: number[], low: number): Chord => ({ name, bass, pad, arp, lead: leadFrom(pcs, low) });

// Weather: D minor under cloud. Two bars per chord.
const WEATHER: Chord[] = [
  chord('Dm9', 38, [53, 57, 60, 64], [62, 65, 69, 72], [2, 5, 9, 0, 4], 62),
  chord('Bbmaj9', 34, [50, 53, 57, 60], [58, 62, 65, 69], [10, 2, 5, 9, 0], 62),
  chord('Gm11', 31, [50, 53, 58, 60], [55, 58, 62, 65], [7, 10, 2, 5, 0], 62),
  chord('A7sus4', 33, [50, 55, 57, 64], [57, 62, 64, 67], [9, 2, 4, 7], 62),
];
// Sunlit: the deck breaks open into B♭ lydian.
const SUNLIT: Chord[] = [
  chord('Bbmaj9#11', 34, [53, 57, 60, 64], [65, 69, 72, 76], [10, 2, 5, 9, 4], 64),
  chord('F/A', 33, [53, 55, 60, 65], [65, 67, 72, 77], [5, 9, 0, 7], 64),
  chord('Gm9', 31, [50, 53, 57, 58], [62, 65, 69, 70], [7, 10, 2, 5, 9], 64),
  chord('C6/9', 36, [52, 55, 57, 62], [64, 67, 69, 74], [0, 4, 7, 9, 2], 64),
];
// Thin: the thirds evaporate. Ordered so bar 16 lands on Dsus2.
const THIN: Chord[] = [
  chord('Bbsus2', 34, [58, 60, 65], [70, 72, 77, 82], [10, 0, 5], 65),
  chord('Asus4', 33, [57, 62, 64], [69, 74, 76, 81], [9, 2, 4], 65),
  chord('Dsus2', 38, [57, 62, 64], [69, 74, 76, 81], [2, 4, 9], 65),
];
// Vacuum: an open D drone, and the Descender's E♭ leaning on it.
const VACUUM: Chord[] = [
  chord('Eb/D', 26, [63, 67, 70, 74], [75, 79, 82, 86], [3, 7, 10, 2], 62),
  chord('D5', 26, [62, 69, 74], [74, 81, 86, 88], [2, 9, 4, 7], 62),
];
// Dock: lift, suspend, and resolve to D major as the bay pressurizes.
const DOCK: Chord[] = [
  chord('Dmaj9', 38, [54, 57, 61, 64], [66, 69, 73, 76], [2, 6, 9, 1, 4], 62),
  chord('Gm9', 31, [50, 53, 57, 58], [62, 65, 69, 70], [7, 10, 2, 5, 9], 62),
  chord('A7sus4', 33, [50, 55, 57, 64], [57, 62, 64, 67], [9, 2, 4, 7], 62),
  chord('A7', 33, [49, 55, 57, 64], [61, 64, 67, 69], [9, 1, 4, 7], 62),
];

// Kill lanes: a hidden two-bar melody per section, degrees into the live lead set.
const KILL_LANES: Record<SkyhookSection, number[]> = {
  // Weather: wide, rolling arches like wind over water.
  [SECTION_WEATHER]: [
    0, 2, 4, 3, 2, 4, 5, 4,
    3, 5, 6, 5, 4, 3, 2, 1,
    2, 4, 5, 7, 6, 4, 5, 3,
    4, 6, 7, 6, 5, 4, 2, 0,
  ],
  // Sunlit: bright leaps up the lydian set.
  [SECTION_SUNLIT]: [
    0, 4, 2, 5, 4, 7, 5, 6,
    4, 2, 5, 3, 6, 4, 7, 5,
    1, 3, 5, 7, 6, 5, 3, 4,
    2, 4, 6, 7, 5, 6, 4, 7,
  ],
  // Thin: high, spaced, falling like ice.
  [SECTION_THIN]: [
    7, 5, 6, 4, 5, 3, 4, 2,
    6, 4, 5, 3, 7, 5, 6, 4,
    7, 6, 4, 5, 3, 4, 2, 3,
    5, 7, 6, 4, 5, 3, 2, 0,
  ],
  // Vacuum: radio tones tolling down, then answering up.
  [SECTION_VACUUM]: [
    7, 6, 5, 4, 5, 4, 3, 2,
    3, 2, 1, 0, 1, 2, 3, 4,
    6, 5, 4, 3, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 7, 5, 7,
  ],
  // Dock: everything climbs home.
  [SECTION_DOCK]: [
    0, 1, 2, 3, 4, 5, 6, 7,
    2, 3, 4, 5, 6, 7, 5, 7,
    0, 2, 4, 6, 7, 6, 4, 7,
    1, 3, 5, 7, 4, 6, 5, 7,
  ],
};

type PlayerSet = { lock: PlayerTimbre; kill: PlayerTimbre; fire: PlayerTimbre };

// The player's instrument, by air density. Thick air rings; vacuum only thumps.
const PLAYER: Record<SkyhookSection, PlayerSet> = {
  [SECTION_WEATHER]: {
    lock: { wave: 'triangle', decay: 0.18, cutoff: 3000, gain: 0.09, bell: 0, reverb: 0.4, delay: 0.2, thump: 0 },
    kill: { wave: 'triangle', decay: 0.55, cutoff: 4000, gain: 0.12, bell: 1.1, reverb: 0.5, delay: 0.3, thump: 0 },
    fire: { wave: 'triangle', decay: 0.09, cutoff: 2400, gain: 0.05, bell: 0, reverb: 0.15, delay: 0, thump: 0.15 },
  },
  [SECTION_SUNLIT]: {
    lock: { wave: 'square', decay: 0.1, cutoff: 2800, gain: 0.045, bell: 0, reverb: 0.25, delay: 0.15, thump: 0 },
    kill: { wave: 'sine', decay: 0.65, cutoff: 6000, gain: 0.13, bell: 2.2, reverb: 0.4, delay: 0.3, thump: 0 },
    fire: { wave: 'sawtooth', decay: 0.07, cutoff: 3600, gain: 0.04, bell: 0, reverb: 0.1, delay: 0, thump: 0.12 },
  },
  [SECTION_THIN]: {
    lock: { wave: 'sine', decay: 0.14, cutoff: 8000, gain: 0.085, bell: 0, reverb: 0.2, delay: 0.25, thump: 0.05 },
    kill: { wave: 'sine', decay: 0.85, cutoff: 8000, gain: 0.12, bell: 0.8, reverb: 0.2, delay: 0.35, thump: 0.2 },
    fire: { wave: 'sine', decay: 0.06, cutoff: 5000, gain: 0.045, bell: 0, reverb: 0.05, delay: 0, thump: 0.45 },
  },
  [SECTION_VACUUM]: {
    lock: { wave: 'sine', decay: 0.08, cutoff: 8000, gain: 0.08, bell: 0, reverb: 0.02, delay: 0.06, thump: 0.3 },
    kill: { wave: 'sine', decay: 0.38, cutoff: 8000, gain: 0.13, bell: 0.35, reverb: 0.02, delay: 0.1, thump: 0.8 },
    fire: { wave: 'sine', decay: 0.05, cutoff: 900, gain: 0.04, bell: 0, reverb: 0, delay: 0, thump: 1 },
  },
  [SECTION_DOCK]: {
    lock: { wave: 'sine', decay: 0.1, cutoff: 8000, gain: 0.08, bell: 0, reverb: 0.1, delay: 0.1, thump: 0.25 },
    kill: { wave: 'sine', decay: 0.5, cutoff: 8000, gain: 0.13, bell: 0.6, reverb: 0.2, delay: 0.15, thump: 0.5 },
    fire: { wave: 'sine', decay: 0.05, cutoff: 1200, gain: 0.04, bell: 0, reverb: 0, delay: 0, thump: 0.9 },
  },
};

// Air in the arrangement: scales every reverb/delay send.
const AIR_BY_BAR: Array<[number, number]> = [
  [0, 1],
  [8, 0.85],
  [16, 0.6],
  [19, 0.25],
  [22, 0.06],
  [31.5, 0.06],
  [32.5, 0.9],
];

function airAtBar(barPosition: number) {
  if (barPosition <= AIR_BY_BAR[0][0]) return AIR_BY_BAR[0][1];
  for (let i = 1; i < AIR_BY_BAR.length; i += 1) {
    if (barPosition <= AIR_BY_BAR[i][0]) {
      const [b0, v0] = AIR_BY_BAR[i - 1];
      const [b1, v1] = AIR_BY_BAR[i];
      return lerp(v0, v1, (barPosition - b0) / (b1 - b0));
    }
  }
  return AIR_BY_BAR[AIR_BY_BAR.length - 1][1];
}

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-e34d',
  bpm: SKYHOOK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let airBed: AirBed | null = null;
  let mawId = -1;
  let mawHits = 0;
  let lastCry = -1;
  const alarms = new Map<number, OscillatorNode[]>();

  const score = createScore<Chord, SkyhookSection>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: WEATHER,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: SKYHOOK_BARS.sunlit, toBar: SKYHOOK_BARS.thin, chords: SUNLIT, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.thin, toBar: SKYHOOK_BARS.boss, chords: THIN, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.boss, toBar: SKYHOOK_BARS.dock, chords: VACUUM, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.dock, chords: DOCK, barsPerChord: 1 },
    ],
    sections: SKYHOOK_SCORE_SECTIONS,
    leadSet: (c) => c.lead,
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
      compressor: { threshold: -16, ratio: 4, attack: 0.006, release: 0.25 },
      delay: { time: SIXTEENTH * 3, feedback: 0.38, dampHz: 2600 },
      reverb: { seconds: 3.6, decay: 2.2, level: 0.55 },
      noiseSeconds: 3,
    },
    onPostBuild(context, mix) {
      ctx = context;
      airBed = installAirBed(context, mix);
      airBed.set(context.currentTime, 0.12, 0.35, 1.5);
    },
    onStep: scheduleStep,
    onRunStart() {
      mawId = -1;
      mawHits = 0;
      alarms.clear();
      const context = runtime.context();
      if (context && airBed) airBed.set(context.currentTime, 0.16, 0.35, 0.5);
    },
    onRunEnd() {
      const context = runtime.context();
      if (context && airBed) airBed.set(context.currentTime, 0.1, 0.3, 3);
    },
    onDispose() {
      ctx = null;
      airBed = null;
    },
  });

  const voices = createSkyhookVoices({
    trace,
    context: () => ctx,
    mix: runtime.mix,
    air: (time) => (runtime.mode() === 'run' ? airAtBar(score.arrangementPositionAt(time) / STEPS_PER_BAR) : 1),
  });
  const { pad, rain, thunder, kick, tom, snap, hat, bass, bell, sub, drone, riser, whoosh, impact, clank, groan, roar, motor, clamp, hiss, choir } = voices;

  const sfx = () => runtime.mix()?.sfx ?? null;
  const setAir = (time: number, level: number, brightness: number, ramp: number) => {
    if (!trace) airBed?.set(time, level, brightness, ramp);
  };

  // ---- arrangement ------------------------------------------------------------------

  const blank = '................';
  const rainPattern = 'R.r.R..rR.r.R.r.';
  const rainSparse = 'R...r...R.r.....';
  const lightningSteps = new Set(LIGHTNING_HITS.map(([b, s]) => b * STEPS_PER_BAR + s));

  const rainTrack = (pattern: string, velocity: number) =>
    hits<Chord>(pattern, { R: 1, r: 0.6 }, ({ time, step, chord: c, position }, vel) => {
      const note = c.arp[(Math.floor(step / 2) + Math.floor(position / 7)) % c.arp.length] + (step % 4 === 0 ? 12 : 0);
      rain(time, note, vel * velocity, ((position * 7) % 11) / 5.5 - 1);
    });

  const padEvery2 = (vel: number, bright: number, width: number, transform: (c: Chord) => number[] = (c) => c.pad) =>
    fn<Chord>(({ time, step, bar, chord: c }) => {
      if (step === 0 && bar % 2 === 0) pad(time, transform(c), BAR_SECONDS * 2.1, vel, bright, width);
    });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: (position) => WEATHER[Math.floor(position / STEPS_PER_BAR / 2) % 2],
    sections: [
      {
        name: 'pad-in-the-rain',
        fromBar: 0,
        tracks: [
          padEvery2(0.6, 0.2, 0.9),
          rainTrack(rainSparse, 0.55),
          fn(({ time, step, bar }) => {
            if (step === 0 && bar % 4 === 2) thunder(time, 0.5);
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
        name: 'liftoff',
        fromBar: SKYHOOK_BARS.liftoff,
        tracks: [
          oneShot(0, 0, ({ time }) => setAir(time, 0.18, 0.4, 0.6)),
          padEvery2(0.75, 0.22, 0.9),
          rainTrack(rainSparse, 0.7),
          hits([blank, 'T.......t.......'].join(''), { T: 0.8, t: 0.55 }, ({ time }, vel) => tom(time, 38, vel)),
          hits([blank, '........B.......'].join(''), { B: 0.8 }, ({ time, chord: c }, vel) => bass(time, c.bass, BAR_SECONDS * 0.5, vel, 320)),
          stormThunder(),
        ],
      },
      {
        name: 'storm',
        fromBar: SKYHOOK_BARS.storm,
        tracks: [
          padEvery2(0.8, 0.25, 0.95),
          rainTrack(rainPattern, 0.75),
          hits('K.........K.....', { K: 0.62 }, ({ time }, vel) => kick(time, vel)),
          hits('......T.......t.', { T: 0.6, t: 0.45 }, ({ time, chord: c }, vel) => tom(time, c.bass + 7, vel)),
          fn(({ time, step, bar }) => {
            if (bar >= 4 && step % 4 === 2) hat(time, 0.45, step === 6 ? -0.5 : 0.5);
          }),
          fn(({ time, step, bar, chord: c }) => {
            if (step === 0 && bar % 2 === 0) bass(time, c.bass, BAR_SECONDS * 1.9, 0.75, 360);
            if (step === 12 && bar % 2 === 1) bass(time, c.bass + 12, BAR_SECONDS * 0.2, 0.45, 500);
          }),
          fn(({ time, step }) => {
            if (step === 8 && airBed && !trace) airBed.gust(time, 0.7, 2.4);
          }),
          stormThunder(),
          // Bar 6: the deck is overhead. Build into the punch.
          oneShot(4, 0, ({ time }) => riser(time, BAR_SECONDS * 1.5, 0.8)),
          oneShot(5, 8, ({ time }) => {
            whoosh(time, 1);
            setAir(time, 0.34, 0.9, 0.15);
          }),
        ],
      },
      {
        name: 'sunlit',
        fromBar: SKYHOOK_BARS.sunlit,
        tracks: [
          oneShot(0, 0, ({ time, chord: c }) => {
            impact(time, 0.9);
            setAir(time, 0.05, 0.9, 0.8);
            bell(time, c.lead[7] + 12, 0.9, 3, 0);
          }),
          padEvery2(0.85, 0.8, 1),
          fn(({ time, step, bar, chord: c }) => {
            if (step % 2 !== 0) return;
            const order = [0, 1, 2, 3, 2, 1, 3, 2];
            const octave = bar >= 12 ? 12 : 0;
            bell(time, c.arp[order[(step / 2) % order.length]] + octave, step % 4 === 0 ? 0.9 : 0.55, 0.9, step % 4 === 0 ? -0.55 : 0.55);
          }),
          hits('K.....k...K.....', { K: 0.9, k: 0.6 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.7 }, ({ time }, vel) => snap(time, vel)),
          hits('h.hHh.hHh.hHh.hH', { h: 0.35, H: 0.6 }, ({ time, step }, vel) => hat(time, vel, step % 2 ? 0.4 : -0.4)),
          fn(({ time, step, chord: c }) => {
            const line: Record<number, [number, number]> = { 0: [0, 1], 6: [0, 0.7], 10: [7, 0.75], 14: [12, 0.6] };
            const note = line[step];
            if (note) bass(time, c.bass + note[0], SIXTEENTH * 3, note[1], 900);
          }),
          fn(({ time, step, bar }) => {
            if (bar === 15 && step >= 8) snap(time, 0.2 + (step - 8) * 0.08);
          }),
          oneShot(7, 0, ({ time }) => riser(time, BAR_SECONDS, 0.45)),
        ],
      },
      {
        name: 'thin',
        fromBar: SKYHOOK_BARS.thin,
        tracks: [
          oneShot(0, 0, ({ time, chord: c }) => {
            setAir(time, 0.02, 1, 2.5);
            bell(time, c.lead[7] + 12, 0.8, 4, 0.3);
          }),
          padEvery2(0.45, 0.55, 0.7, (c) => c.pad.slice(-2).map((m) => m + 12)),
          fn(({ time, step, bar, chord: c }) => {
            const every = bar < 18 ? 4 : 8;
            if (step % every === 0) bell(time, c.arp[(step / every + bar) % c.arp.length] + 12, 0.6, 1.8, ((step / 4) % 2) * 1.2 - 0.6);
          }),
          fn(({ time, step, chord: c }) => {
            if (step === 0) sub(time, c.bass, 0.6);
          }),
          hits('..t...t...t...t.', { t: 0.22 }, ({ time, step }, vel) => hat(time, vel, step === 2 ? -0.3 : 0.3)),
        ],
      },
      {
        name: 'contact',
        fromBar: SKYHOOK_BARS.contact,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            clank(time, 1.05, 0.15, 26);
            groan(time, 26, BAR_SECONDS * 1.5, 1);
            setAir(time, 0, 1, 1);
          }),
          oneShot(0, 0, ({ time, chord: c }) => drone(time, c.bass + 48, BAR_SECONDS * 4, 1)),
          oneShot(1, 8, ({ time }) => clank(time, 1, 0.25, 26)),
          hits('U.....u.........', { U: 0.8, u: 0.5 }, ({ time, chord: c }, vel) => sub(time, c.bass, vel)),
          fn(({ time, step, bar, chord: c }) => {
            if (step === 8) bell(time, c.lead[(bar % 2) * 3 + 4] + 12, 0.45, 2.6, 0);
          }),
        ],
      },
      {
        name: 'descender',
        fromBar: SKYHOOK_BARS.boss,
        tracks: [
          // Its grip is the kick drum: every beat it takes a hold, louder as it nears.
          fn(({ time, step, chord: c }) => {
            if (step % 4 !== 0) return;
            if (!descenderTelemetry.active || descenderTelemetry.holding) return;
            const proximity = Math.max(0, Math.min(1, 1 - descenderTelemetry.distance / 120));
            clank(time, 0.35 + proximity * 0.6, proximity, c.bass + (step === 0 ? 12 : 24));
          }),
          fn(({ time, step, chord: c }) => {
            if (step === 0) sub(time, c.bass + 12, 0.7);
            if (step === 6) sub(time, c.bass + 12, 0.4);
          }),
          fn(({ time, step, bar, chord: c }) => {
            if (step === 0 && bar % 2 === 0) drone(time, c.lead[4] + 12, BAR_SECONDS * 2.05, 0.9);
            if (step === 8 && bar % 4 === 1) groan(time, c.bass + 12, BAR_SECONDS, 0.7);
            if (step === 12 && !descenderTelemetry.killed) bell(time, c.lead[(bar * 3) % 8] + 12, 0.3, 2.4, 0.2);
          }),
        ],
      },
      {
        name: 'dock',
        fromBar: SKYHOOK_BARS.dock,
        tracks: [
          oneShot(0, 0, ({ time }) => motor(time, BAR_SECONDS * 2.6, 70, 260, 1)),
          oneShot(0, 0, ({ time, chord: c }) => bell(time, c.lead[7] + 12, 0.7, 3, -0.3)),
          oneShot(1, 8, ({ time }) => clamp(time, 0.35)),
          oneShot(2, 0, ({ time, chord: c }) => bell(time, c.lead[5] + 12, 0.6, 3, 0.3)),
          // Docked: two clamps, the bay pressurizes, and the air brings the last chord.
          oneShot(3, 0, ({ time }) => clamp(time, 1)),
          oneShot(3, 4, ({ time }) => clamp(time, 0.7)),
          oneShot(3, 6, ({ time }) => hiss(time, BAR_SECONDS * 1.4, 1)),
          oneShot(3, 8, ({ time, chord: c }) => {
            choir(time, [c.bass, ...c.pad, c.lead[4] + 12], BAR_SECONDS * 2.4, 1);
            bell(time + BAR_SECONDS * 0.25, 81, 0.5, 5, -0.4);
            bell(time + BAR_SECONDS * 0.5, 78, 0.45, 5, 0.4);
            sub(time, c.bass - 12, 0.5);
          }),
        ],
      },
    ],
  });

  function stormThunder() {
    return fn<Chord>(({ time, position }) => {
      if (lightningSteps.has(position)) thunder(time, 0.9);
    });
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else if (position < SKYHOOK_BARS.end * STEPS_PER_BAR) runArrangement.schedule(position, time);
  }

  // ---- the player's instrument --------------------------------------------------------

  function layered(mix: SectionMix<SkyhookSection>, slot: keyof PlayerSet, play: (timbre: PlayerTimbre, weight: number) => void) {
    for (const [section, weight] of score.sectionLayers(mix)) if (weight > 0.02) play(PLAYER[section][slot], weight);
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(7, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    layered(mix, 'lock', (timbre, weight) => voices.playerTone(time, midi, timbre, 1, weight));
    if (lockCount >= 6) {
      // Six locks: the chord's top answers an octave up — armed.
      layered(mix, 'kill', (timbre, weight) => voices.playerTone(time + THIRTYSECOND, lead[7] + 12, timbre, 0.5, weight));
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    layered(score.sectionMixAt(position), 'lock', (timbre, weight) => voices.playerTone(time, score.chordAt(position).bass + 24, timbre, 0.3, weight));
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const c = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const index = indexInVolley ?? 0;
    const midi = c.arp[index % c.arp.length] + 12;
    // The first round of a volley carries the recoil; the rest are lighter.
    layered(mix, 'fire', (timbre, weight) => voices.playerTone(time, midi, index === 0 ? timbre : { ...timbre, thump: timbre.thump * 0.4 }, 1, weight));
    const air = airAtBar(position / STEPS_PER_BAR);
    voices.playerNoise(time, 0.03 * air, 0.05, 3200, 'bandpass');
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (!ctx || lethal) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const mix = score.sectionMixAt(position);
    if (enemyId === mawId) {
      // The maw's voice climbs with every wound.
      mawHits += 1;
      const wound = Math.min(1, mawHits / 8);
      layered(mix, 'kill', (timbre, weight) => voices.playerTone(time, lead[Math.min(7, Math.floor(wound * 7))] + 12, { ...timbre, gain: timbre.gain * (0.8 + wound * 0.8), bell: 0.6 + wound * 2.4 }, 1, weight));
      clank(time, 0.4 + wound * 0.4, 0.5 + wound * 0.5, score.chordAt(position).bass + 12);
      return;
    }
    // Armor ring: a struck plate tuned to the chord.
    layered(mix, 'lock', (timbre, weight) => voices.playerTone(time, lead[(hitPointsRemaining + 3) % 8] + 12, { ...timbre, bell: 1.5, decay: 0.3 }, 0.8, weight));
    voices.playerNoise(time, 0.05, 0.04, 5000);
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx || enemyId !== mawId) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    roar(time, 26, 1.6, 0.8);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    cancelAlarm(enemyId);
    if (enemyId === mawId) {
      descenderFinale(kill.time, position);
      return;
    }
    const mix = score.sectionMixAt(position);
    const chain = indexInVolley ?? 0;
    const vel = Math.min(1.4, 1 + chain * 0.1);
    layered(mix, 'kill', (timbre, weight) => voices.playerTone(kill.time, kill.midi, timbre, vel, weight));
    if (chain >= 3) layered(mix, 'kill', (timbre, weight) => voices.playerTone(kill.time, kill.midi + 12, timbre, 0.35, weight));
    const air = airAtBar(position / STEPS_PER_BAR);
    voices.playerNoise(kill.time, 0.05 * air + 0.01, 0.12, 6000);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const c = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    // A clean volley lands a chord on the next beat.
    [0, 2, 4, 7].forEach((degree, index) => {
      layered(mix, 'kill', (timbre, weight) => voices.playerTone(time + index * THIRTYSECOND, c.lead[degree] + 12, timbre, size >= 6 ? 0.7 : 0.5, weight));
    });
    if (size >= 6) bass(time, c.bass, BAR_SECONDS * 0.5, 0.8, 600);
  });

  bus.on('miss', ({ enemyId }) => {
    cancelAlarm(enemyId);
    if (!ctx) return;
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    layered(score.sectionMixAt(position), 'lock', (timbre, weight) => {
      voices.playerTone(time, lead[1], timbre, 0.35, weight);
      voices.playerTone(time + 0.09, lead[1] - 1, timbre, 0.3, weight);
    });
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    // A fault buzzer: the chord's root and its flat second, grinding.
    voices.buzz(time, score.chordAt(score.arrangementPositionAt(time)).bass + 24, 1);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const c = score.chordAt(position);
    voices.crunch(time, c.bass + 12, 1);
    // Hull alarm voiced from the live chord.
    [c.lead[4] + 12, c.lead[2] + 12, c.lead[4] + 12].forEach((midi, index) => voices.alarmBeep(time + 0.12 + index * 0.13, midi, 1));
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'grappler') {
      // Proximity alarm armed for the moment it dives; cancelled if it dies first.
      const diveAt = score.nextGridTime(ctx.currentTime + GRAPPLER_ENTER + GRAPPLER_HOVER * 0.6, 1);
      const lead = score.leadSetAt(score.arrangementPositionAt(diveAt));
      const nodes = [
        ...voices.alarmBeep(diveAt, lead[6] + 12, 0.8),
        ...voices.alarmBeep(diveAt + SIXTEENTH, lead[3] + 12, 0.8),
        ...voices.alarmBeep(diveAt + SIXTEENTH * 2, lead[6] + 12, 0.8),
      ];
      alarms.set(enemyId, nodes);
    }
    if (kind === 'maw') {
      mawId = enemyId;
      mawHits = 0;
    }
    if (kind === 'kite' && ctx.currentTime - lastCry > SIXTEENTH * 8) {
      // A flock arrives crying on the wind, in the key of the sky.
      lastCry = ctx.currentTime;
      const time = score.nextGridTime(ctx.currentTime, 2);
      const position = score.arrangementPositionAt(time);
      const lead = score.leadSetAt(position);
      voices.cry(time, lead[5 + (position % 3)] + 12, airAtBar(position / STEPS_PER_BAR));
    }
  });

  bus.on('runend', ({ died }) => {
    if (!ctx || !died) return;
    // Torn apart: the hull crumples and the chord falls out from under it.
    const time = ctx.currentTime;
    const c = score.chordAt(score.arrangementPositionAt(time));
    voices.crunch(time, c.bass, 1.3);
    voices.crunch(time + 0.18, c.bass - 5, 0.9);
    impact(time, 1);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    if (phase === 'exposed') roar(time, 27, 2.6, 1);
  });

  function cancelAlarm(enemyId: number) {
    const nodes = alarms.get(enemyId);
    if (!nodes || !ctx) return;
    alarms.delete(enemyId);
    for (const node of nodes) {
      try {
        node.stop(ctx.currentTime);
      } catch {
        // already stopped
      }
    }
  }

  function descenderFinale(time: number, position: number) {
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    mix.duckAt(time, 0.08, 3);
    impact(time, 0.9);
    clank(time, 0.9, 1, 26);
    const lead = score.leadSetAt(position);
    // The husk falls: the lead set tumbles down two octaves.
    [...lead].reverse().concat([...lead].reverse().map((m) => m - 12)).forEach((midi, index) => {
      voices.playerTone(time + THIRTYSECOND * 2 + index * THIRTYSECOND * 1.5, midi + 12, PLAYER[SECTION_VACUUM].kill, 0.9 - index * 0.04, 1);
    });
    sub(time + BAR_SECONDS * 0.5, 26, 1);
    const sfxOut = sfx();
    if (sfxOut) voices.playerNoise(time, 0.2, 0.6, 1800, 'lowpass');
  }

  return runtime;
}

