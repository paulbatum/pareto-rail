import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createBroadsideVoices, type PlayerVoiceSpec } from './audio-voices';
import {
  BARS,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_SCORE_SECTIONS,
  BROADSIDE_STEPS_PER_BAR,
  BROADSIDE_TIME,
} from './timing';

// BROADSIDE is scored as space opera: full orchestra, brass and strings over
// timpani, 144 BPM in D minor, 36 bars = exactly 60 seconds.
//
// The arc is dynamic, not thematic. The launch is timpani and a single horn.
// The crossfire brings the whole band in. The flank run is the widest, fastest
// tutti in the piece. Then bar 18 — the eye of the battle, under the enemy
// warship — drops to a choir and two sub pulses, and rebuilds. The shield pass
// walks a Neapolitan flat second under low brass; the breach is the drop; the
// trench is a chase; and the last two bars land in D major.
//
// The player is the soloist. Locks, volleys, chips and kills are transport-
// quantised and pitched from the live chord, and every kill plays the written
// note for its step from a per-act horn lane — so a chained volley performs a
// real melodic run over the orchestra rather than beeping on top of it.

const SIXTEENTH = BROADSIDE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = BROADSIDE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; brass: number[]; arp: number[]; stab: number[] };

// i — VI — III — VII in D minor, two bars each: the open-battle loop.
const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 65], brass: [50, 57, 62], arp: [62, 65, 69, 74], stab: [62, 65, 69] }, // Dm
  { bass: 34, pad: [46, 53, 58, 62], brass: [46, 53, 58], arp: [58, 62, 65, 70], stab: [58, 62, 65] }, // Bb
  { bass: 41, pad: [53, 57, 60, 65], brass: [45, 53, 57], arp: [57, 60, 65, 69], stab: [57, 60, 65] }, // F
  { bass: 36, pad: [48, 55, 60, 64], brass: [48, 55, 60], arp: [60, 64, 67, 72], stab: [60, 64, 67] }, // C
];

const D_MINOR = CHORDS[0];
const E_FLAT: Chord = { bass: 39, pad: [51, 55, 58, 63], brass: [51, 55, 58], arp: [63, 67, 70, 75], stab: [63, 67, 70] };
const A_MAJOR: Chord = { bass: 33, pad: [45, 52, 57, 61], brass: [45, 52, 57], arp: [61, 64, 69, 73], stab: [61, 64, 69] };
const D_MAJOR: Chord = { bass: 38, pad: [50, 57, 62, 66], brass: [50, 57, 62], arp: [62, 66, 69, 74], stab: [62, 66, 69] };

// The flagship's own harmony: Dm — Eb — Dm — A. The flat second is the ship.
// (Array order compensates for the score's absolute-bar chord indexing, which
// starts this set on bar 23.)
const SHIELD_CHORDS: Chord[] = [E_FLAT, D_MINOR, A_MAJOR, D_MINOR];
// The trench alternates tonic and dominant every bar: a chase, not a groove.
const TRENCH_CHORDS: Chord[] = [D_MINOR, A_MAJOR];
const VICTORY_CHORDS: Chord[] = [D_MAJOR];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

// One horn lane per act. Degrees index the live lead set (the chord's arpeggio
// plus its octave), so the same lane retunes as the harmony moves.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Launch: signal calls climbing off the deck.
  0: [
    0, 2, 4, 2, 0, 2, 4, 5,
    4, 2, 0, 2, 4, 5, 7, 5,
    4, 2, 4, 5, 7, 5, 4, 2,
    0, 2, 4, 7, 5, 4, 2, 0,
  ],
  // Crossfire: jagged broken chords for dense, alternating volleys.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 3, 1, 4, 2, 5, 3, 6,
    7, 4, 6, 3, 5, 2, 4, 0,
  ],
  // Flank: heroic scalar runs, the fastest lane in the piece.
  2: [
    0, 1, 2, 3, 4, 5, 6, 7,
    6, 5, 4, 3, 4, 5, 6, 7,
    2, 3, 4, 5, 6, 7, 6, 5,
    4, 5, 6, 7, 5, 4, 3, 2,
  ],
  // Belly: low tolling in the quiet.
  3: [
    7, 5, 4, 2, 0, 2, 4, 5,
    2, 0, 1, 0, 2, 4, 2, 0,
    4, 2, 1, 0, 2, 0, 4, 2,
    1, 0, 2, 4, 5, 4, 2, 0,
  ],
  // Shields: wide menacing leaps across the whole register.
  4: [
    4, 3, 5, 2, 6, 1, 7, 0,
    3, 4, 2, 5, 1, 6, 0, 7,
    4, 5, 3, 6, 2, 7, 1, 0,
    5, 4, 6, 3, 7, 2, 0, 1,
  ],
  // Trench: driving ascents that keep resolving upward.
  5: [
    0, 2, 4, 7, 4, 2, 0, 2,
    4, 5, 7, 5, 7, 5, 4, 2,
    0, 4, 2, 7, 5, 7, 4, 2,
    0, 2, 4, 5, 7, 7, 5, 4,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; air: number };

// The player's instrument changes with the act, always crossfaded under cover
// of a section change so the switch is never a hard cut.
const PLAYER_VOICES: Record<SectionIndex, { lock: PlayerVoiceSpec; kill: PlayerVoiceSpec; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.11, cutoff: 3000, gain: 0.1, air: 0.4, reverb: 0.34 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 2900, gain: 0.13, air: 0.55, reverb: 0.4 },
    fire: { oscillator: 'triangle', cutoff: 2600, gain: 0.065, fallSemitones: 10, air: 0.04 },
  },
  1: {
    lock: { oscillator: 'sawtooth', decay: 0.09, cutoff: 2700, gain: 0.055, air: 0.45, reverb: 0.24 },
    kill: { oscillator: 'sawtooth', decay: 0.24, cutoff: 3200, gain: 0.075, air: 0.6, reverb: 0.3 },
    fire: { oscillator: 'sawtooth', cutoff: 3400, gain: 0.05, fallSemitones: 8, air: 0.05 },
  },
  2: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 3600, gain: 0.042, air: 0.55, reverb: 0.2 },
    kill: { oscillator: 'square', decay: 0.2, cutoff: 4200, gain: 0.06, air: 0.75, reverb: 0.26 },
    fire: { oscillator: 'square', cutoff: 4000, gain: 0.035, fallSemitones: 7, air: 0.055 },
  },
  3: {
    // The eye of the battle: everything you do sounds distant and hall-lit.
    lock: { oscillator: 'sine', decay: 0.14, cutoff: 1800, gain: 0.12, air: 0.2, reverb: 0.6 },
    kill: { oscillator: 'sine', decay: 0.42, cutoff: 2100, gain: 0.15, air: 0.3, reverb: 0.68 },
    fire: { oscillator: 'triangle', cutoff: 1700, gain: 0.05, fallSemitones: 12, air: 0.025 },
  },
  4: {
    lock: { oscillator: 'sawtooth', decay: 0.1, cutoff: 2200, gain: 0.055, air: 0.35, reverb: 0.4 },
    kill: { oscillator: 'sawtooth', decay: 0.26, cutoff: 2600, gain: 0.075, air: 0.5, reverb: 0.44 },
    fire: { oscillator: 'sawtooth', cutoff: 2400, gain: 0.05, fallSemitones: 11, air: 0.04 },
  },
  5: {
    lock: { oscillator: 'square', decay: 0.075, cutoff: 4000, gain: 0.045, air: 0.6, reverb: 0.22 },
    kill: { oscillator: 'square', decay: 0.19, cutoff: 4600, gain: 0.062, air: 0.8, reverb: 0.28 },
    fire: { oscillator: 'square', cutoff: 4200, gain: 0.036, fallSemitones: 6, air: 0.06 },
  },
};

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-b7tm',
  bpm: BROADSIDE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: BROADSIDE_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();
  let generatorsDown = 0;
  const CORE_TOTAL_HP = 4; // per core: hitStages [2, 2]

  const score = createScore<Chord, SectionIndex>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: BARS.shields, toBar: BARS.trench, chords: SHIELD_CHORDS, barsPerChord: 1 },
      { fromBar: BARS.trench, toBar: BARS.victory, chords: TRENCH_CHORDS, barsPerChord: 1 },
      { fromBar: BARS.victory, chords: VICTORY_CHORDS, barsPerChord: 2 },
    ],
    sections: BROADSIDE_SCORE_SECTIONS,
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
      compressor: { threshold: -15, ratio: 4, attack: 0.004, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.24, dampHz: 2400 },
      reverb: { seconds: 3.4, decay: 2.4, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      generatorIds.clear();
      coreIds.clear();
      generatorsDown = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const at = context.currentTime + 0.05;
      strings(at, D_MINOR.pad, 5.0, 0.7, 1500, 0.6);
      lowBrass(at, D_MINOR.bass, 4.2, 0.5);
      tamTam(at, 0.6);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createBroadsideVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    strings, spiccato, brass, horn, lowBrass, timpani, granCassa, snare, crash, tamTam, swell,
    harp, bell, choir, riser, impact, playerTone, playerNoise, noiseHit,
  } = voices;

  // ---- arrangement ----------------------------------------------------------

  const TIMP_MARCH = 'T.....T...T.....';
  const TIMP_HALF = 'T.......T.......';
  const TIMP_DOWN = 'T...............';
  const CASSA = 'G.......G...G...';
  const SNARE_BACK = '....s.......s...';
  const SNARE_DRIVE = '..s.s...s.s.s.s.';
  const SNARE_ROLL = 'ssssssssssssssss';
  const CRASH_DOWN = 'C...............';

  /** String ostinato walking the chord's arpeggio; `every` is the step spacing. */
  const ostinato = (order: number[], velocity: number, cutoff: number, every = 2) =>
    fn<Chord>(({ time, step, chord }) => {
      if (step % every !== 0) return;
      const index = (step / every) % order.length;
      spiccato(time, chord.arp[order[index] % chord.arp.length] - 12, velocity, cutoff);
    });

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
          // A held string bed and a far-off battery: the engagement is already
          // running when the player arrives.
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 2 === 0) strings(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.55, 1250, 0.5);
            if (step === 8 && bar % 2 === 1) timpani(time, chord.bass - 12, 0.35);
            if (step === 4 && bar % 4 === 2) horn(time, chord.arp[1], 1.1, 0.5, 1700);
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
      // --- Launch: timpani, a pedal, and one horn call. The catapult.
      {
        name: 'launch',
        fromBar: BARS.launch,
        tracks: [
          hits([TIMP_DOWN, TIMP_HALF, TIMP_MARCH, TIMP_MARCH].join(''), { T: 0.85 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
          fn(({ time, step, bar, chord }) => {
            if (step === 0) lowBrass(time, chord.bass, 16 * SIXTEENTH * 0.95, 0.5 + bar * 0.06);
            if (step === 0 && bar >= 1) strings(time, chord.pad, 16 * SIXTEENTH, 0.5 + bar * 0.1, 1500, 0.3);
          }),
          oneShot(2, 0, ({ time, chord }) => horn(time, chord.arp[0], 0.9, 0.85, 2200)),
          oneShot(2, 6, ({ time, chord }) => horn(time, chord.arp[2], 1.4, 0.8, 2400)),
          oneShot(3, 0, ({ time }) => swell(time, 16 * SIXTEENTH, 0.8)),
          fn(({ time, step, barInSection }) => {
            // Snare roll accelerating into the launch downbeat.
            if (barInSection === 3 && step >= 8 && step % 2 === 0) snare(time, 0.3 + (step - 8) * 0.08);
          }),
        ],
      },

      // --- Crossfire: the whole band. This is the level's home texture, and
      //     everything later is a departure from it.
      {
        name: 'crossfire',
        fromBar: BARS.crossfire,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            crash(time, 0.9, 2.2);
            granCassa(time, 1.1);
          }),
          hits(TIMP_MARCH, { T: 0.8 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
          hits(CASSA, { G: 0.75 }, ({ time }, vel) => granCassa(time, vel)),
          hits(SNARE_BACK, { s: 0.55 }, ({ time }, vel) => snare(time, vel)),
          ostinato([0, 1, 2, 3, 2, 1, 0, 1], 0.6, 2500),
          fn(({ time, step, bar, chord }) => {
            if (step === 0) {
              strings(time, chord.pad, 16 * SIXTEENTH * 1.02, 0.8, 1900, 0.14);
              brass(time, chord.brass, 8 * SIXTEENTH, 0.75 + (bar % 2) * 0.1, 2600, 0.035);
              lowBrass(time, chord.bass, 16 * SIXTEENTH * 0.9, 0.55 + (bar % 4) * 0.05);
            }
            if (step === 8) brass(time, chord.stab, 4 * SIXTEENTH, 0.6, 2400, 0.03);
            if (step === 12 && bar % 2 === 1) horn(time, chord.arp[2], 0.7, 0.6, 2200);
          }),
          oneShot(3, 12, ({ time }) => swell(time, 4 * SIXTEENTH, 0.5)),
          oneShot(7, 8, ({ time }) => swell(time, 8 * SIXTEENTH, 0.9)),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 7 && step >= 8) snare(time, 0.28 + (step - 8) * 0.06);
          }),
        ],
      },

      // --- Flank run: the widest, fastest tutti. Sixteenth strings, a brass
      //     fanfare every bar, a cymbal on every downbeat.
      {
        name: 'flank',
        fromBar: BARS.flank,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            crash(time, 1.1, 2.6);
            granCassa(time, 1.2);
            impact(time, 0.6);
          }),
          hits(CRASH_DOWN, { C: 0.35 }, ({ time }, vel) => crash(time, vel, 1.2)),
          hits('T...T...T..T.T..', { T: 0.85 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
          hits(CASSA, { G: 0.8 }, ({ time }, vel) => granCassa(time, vel)),
          hits(SNARE_DRIVE, { s: 0.45 }, ({ time }, vel) => snare(time, vel)),
          ostinato([0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 2, 3, 2, 1, 0], 0.5, 3400, 1),
          fn(({ time, step, bar, chord }) => {
            if (step === 0) {
              strings(time, chord.pad.map((midi) => midi + 12), 16 * SIXTEENTH, 0.75, 3000, 0.1);
              brass(time, chord.brass.map((midi) => midi + 12), 6 * SIXTEENTH, 0.9, 3200, 0.04);
              lowBrass(time, chord.bass, 16 * SIXTEENTH * 0.9, 0.7);
            }
            if (step === 6) brass(time, chord.stab, 2 * SIXTEENTH, 0.7, 2800, 0.03);
            if (step === 10) brass(time, chord.stab.map((midi) => midi + 12), 4 * SIXTEENTH, 0.65, 3000, 0.03);
            if (step === 14 && bar % 2 === 1) horn(time, chord.arp[3], 0.5, 0.7, 2600);
          }),
          oneShot(5, 8, ({ time }) => swell(time, 8 * SIXTEENTH, 0.85)),
        ],
      },

      // --- Belly: the eye of the battle. Two bars of near silence under the
      //     enemy warship, then the band walks back in.
      {
        name: 'belly',
        fromBar: BARS.belly,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            tamTam(time, 0.75);
            choir(time, chord.pad, 32 * SIXTEENTH * 1.1, 0.9);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection >= 2) return;
            // Almost nothing: one sub pedal and a distant kettle.
            if (step === 0) lowBrass(time, chord.bass - 12, 8 * SIXTEENTH, 0.35);
            if (step === 12) timpani(time, chord.bass - 12, 0.3);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection < 2) return;
            const build = Math.min(1, (barInSection - 2) / 2.5);
            if (step === 0) {
              strings(time, chord.pad, 16 * SIXTEENTH, 0.4 + build * 0.5, 1400 + build * 1400, 0.3);
              lowBrass(time, chord.bass, 16 * SIXTEENTH * 0.9, 0.4 + build * 0.4);
            }
            if (step % 8 === 0) timpani(time, chord.bass - 12, 0.5 + build * 0.35);
            if (step % 4 === 2 && barInSection >= 3) snare(time, 0.2 + build * 0.3);
            if (step % 2 === 0 && barInSection >= 3) {
              const order = [0, 2, 1, 3];
              spiccato(time, chord.arp[order[(step / 2) % order.length]] - 12, 0.35 + build * 0.35, 1800 + build * 1400);
            }
            if (step === 8 && barInSection >= 4) brass(time, chord.stab, 4 * SIXTEENTH, 0.5 + build * 0.3, 2200, 0.03);
          }),
          oneShot(4, 8, ({ time }) => swell(time, 8 * SIXTEENTH, 0.75)),
        ],
      },

      // --- Shields: the flagship's own harmony. Low brass, Neapolitan menace,
      //     and a choir behind it.
      {
        name: 'shields',
        fromBar: BARS.shields,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.0);
            crash(time, 0.6, 2.0);
          }),
          hits('T...T.T...T.T...', { T: 0.75 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
          hits(CASSA, { G: 0.7 }, ({ time }, vel) => granCassa(time, vel)),
          hits('..s...s...s...s.', { s: 0.4 }, ({ time }, vel) => snare(time, vel)),
          ostinato([0, 0, 1, 0, 2, 0, 1, 0], 0.55, 2000),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0) {
              lowBrass(time, chord.bass, 16 * SIXTEENTH * 0.94, 0.8);
              choir(time, chord.pad.map((midi) => midi + 12), 16 * SIXTEENTH * 1.05, 0.8);
              strings(time, chord.pad, 16 * SIXTEENTH, 0.55, 1500, 0.25);
            }
            if (step === 10) brass(time, chord.brass, 4 * SIXTEENTH, 0.55 + barInSection * 0.05, 1900, 0.05);
            if (step === 6 && barInSection % 2 === 1) horn(time, chord.arp[0], 0.6, 0.6, 1800);
          }),
          oneShot(4, 0, ({ time }) => swell(time, 12 * SIXTEENTH, 0.7)),
        ],
      },

      // --- Breach: the drop. Everything at once for two bars.
      {
        name: 'breach',
        fromBar: BARS.breach,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            crash(time, 1.2, 2.8);
            granCassa(time, 1.25);
            impact(time, 0.9);
            brass(time, chord.brass.map((midi) => midi + 12), 8 * SIXTEENTH, 1.0, 3400, 0.05);
          }),
          hits(SNARE_ROLL, { s: 0.24 }, ({ time }, vel) => snare(time, vel)),
          hits('T...T...T...T...', { T: 0.9 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
          hits(CASSA, { G: 0.9 }, ({ time }, vel) => granCassa(time, vel)),
          ostinato([0, 1, 2, 3, 4, 3, 2, 1], 0.55, 3600, 1),
          fn(({ time, step, chord }) => {
            if (step === 0) {
              strings(time, chord.pad.map((midi) => midi + 12), 16 * SIXTEENTH, 0.85, 3200, 0.08);
              lowBrass(time, chord.bass, 16 * SIXTEENTH * 0.9, 0.9);
            }
            if (step === 8) brass(time, chord.stab.map((midi) => midi + 12), 6 * SIXTEENTH, 0.85, 3400, 0.04);
          }),
          oneShot(1, 8, ({ time }) => swell(time, 8 * SIXTEENTH, 1.0)),
          oneShot(1, 8, ({ time, chord }) => riser(time, 8 * SIXTEENTH, 0.7, chord.bass)),
        ],
      },

      // --- Trench: a chase. Tonic and dominant every bar, no let-up.
      {
        name: 'trench',
        fromBar: BARS.trench,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            crash(time, 1.0, 2.4);
            impact(time, 0.8);
          }),
          hits('T..T..T.T..T..T.', { T: 0.8 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
          hits('G...G...G...G...', { G: 0.85 }, ({ time }, vel) => granCassa(time, vel)),
          hits(SNARE_DRIVE, { s: 0.42 }, ({ time }, vel) => snare(time, vel)),
          ostinato([0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 6, 5, 4, 3], 0.48, 3800, 1),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0) {
              strings(time, chord.pad.map((midi) => midi + 12), 16 * SIXTEENTH, 0.8, 3000, 0.08);
              lowBrass(time, chord.bass, 16 * SIXTEENTH * 0.92, 0.85);
              brass(time, chord.brass, 5 * SIXTEENTH, 0.8, 2900, 0.04);
            }
            if (step === 8) brass(time, chord.stab.map((midi) => midi + 12), 4 * SIXTEENTH, 0.7, 3100, 0.03);
            // The toll tightens across the bars before the deadline.
            if (barInSection >= 3 && step % 4 === 2) timpani(time, chord.bass - 12, 0.55 + barInSection * 0.06);
          }),
          oneShot(3, 8, ({ time }) => swell(time, 8 * SIXTEENTH, 1.0)),
        ],
      },

      // --- Victory: D major, full band, and then the hall.
      {
        name: 'victory',
        fromBar: BARS.victory,
        toBar: BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            crash(time, 1.3, 3.2);
            granCassa(time, 1.3);
            timpani(time, chord.bass - 12, 1.0);
            brass(time, [...chord.brass, chord.brass[0] + 12, chord.brass[1] + 12], 12 * SIXTEENTH, 1.0, 3600, 0.05);
            strings(time, chord.pad.map((midi) => midi + 12), 32 * SIXTEENTH * 1.1, 0.95, 3400, 0.1);
            choir(time, chord.pad, 32 * SIXTEENTH * 1.1, 1.0);
          }),
          hits('T...T...T...T...', { T: 0.85 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
          oneShot(0, 8, ({ time, chord }) => horn(time, chord.arp[2] + 12, 1.0, 0.9, 3000)),
          oneShot(0, 12, ({ time, chord }) => horn(time, chord.arp[3] + 12, 1.4, 0.85, 3000)),
          oneShot(1, 0, ({ time, chord }) => {
            brass(time, chord.brass.map((midi) => midi + 12), 16 * SIXTEENTH, 0.95, 3600, 0.04);
            lowBrass(time, chord.bass, 16 * SIXTEENTH, 0.9);
          }),
          oneShot(1, 8, ({ time, chord }) => bell(time, chord.arp[3] + 12, 0.7, 2.6)),
          oneShot(1, 12, ({ time }) => crash(time, 0.7, 3.0)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player instrument -----------------------------------------------------

  function mixedValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: 'decay' | 'cutoff' | 'gain' | 'air' | 'reverb') {
    return lerp(PLAYER_VOICES[mix.from][slot][key], PLAYER_VOICES[mix.to][slot][key], mix.t);
  }

  /** A kill is a note in the horn lane, not a sound effect. */
  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = score.leadSetAt(position);
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = leadSet[degree];
    if (midi === undefined) return;
    const vel = Math.min(1.5, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    // The band answers a chained volley: by the third kill in a release the
    // orchestra's own horns are doubling the player's line.
    if (chain >= 2) horn(time + THIRTYSECOND, midi, 0.28, Math.min(0.85, 0.35 + chain * 0.12), 2800);
    playerNoise(time, 0.02 + mixedValue(mix, 'kill', 'air') * 0.04, 0.07, 7200);
  }

  /** Generators audibly lose: each one destroyed rings brighter than the last. */
  function generatorKill(time: number) {
    generatorsDown += 1;
    const intensity = generatorsDown / 6;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    impact(time, 0.5 + intensity * 0.5);
    timpani(time, chord.bass - 12, 0.7 + intensity * 0.3);
    brass(
      time + THIRTYSECOND,
      chord.stab.map((midi) => midi + Math.round(intensity * 4)),
      5 * SIXTEENTH,
      0.5 + intensity * 0.4,
      2200 + intensity * 1600,
      0.05,
    );
    noiseHit(time, 0.09 + intensity * 0.06, 0.5, 'lowpass', 1400);
    if (generatorsDown < 6) bell(time + SIXTEENTH * 2, chord.arp[Math.min(3, generatorsDown)] + 12, 0.45, 1.4);
  }

  /** The shield falling: duck the band, land a rising figure, bring it back. */
  function shieldFall(time: number) {
    const mix = runtime.mix();
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    mix?.duckAt(time, 0.2, 1.1);
    tamTam(time, 1.0);
    impact(time, 1.2);
    crash(time + 0.02, 0.9, 2.6);
    const lead = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      horn(time + 0.06 + index * SIXTEENTH, lead[degree], 0.5, 0.8 - index * 0.06, 2600 + index * 400);
    });
    riser(time, 8 * SIXTEENTH, 0.8, chord.bass);
  }

  /** Core hits climb with the damage dealt; the last one is the finale. */
  function coreHit(time: number, remaining: number) {
    const intensity = 1 - Math.max(0, Math.min(1, remaining / CORE_TOTAL_HP));
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    timpani(time, chord.bass - 12 + Math.round(intensity * 5), 0.6 + intensity * 0.4);
    brass(time, [chord.stab[0] + Math.round(intensity * 7)], 3 * SIXTEENTH, 0.5 + intensity * 0.45, 1600 + intensity * 2600, 0.06);
    noiseHit(time, 0.07 + intensity * 0.08, 0.28, 'bandpass', 900 + intensity * 2200);
  }

  function flagshipDestroyed(time: number) {
    const mix = runtime.mix();
    mix?.duckAt(time, 0.1, 1.6);
    tamTam(time, 1.2);
    impact(time, 1.4);
    crash(time, 1.2, 3.4);
    // A descending horn call over the blast; the victory section arrives on its
    // own downbeat and does the rest.
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    [7, 5, 4, 2, 0].forEach((degree, index) => {
      horn(time + 0.1 + index * SIXTEENTH * 1.5, lead[degree], 0.6, 0.85 - index * 0.08, 2800);
    });
  }

  // ---- event wiring ------------------------------------------------------------

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
    playerNoise(time, 0.01 + mixedValue(mix, 'lock', 'air') * 0.026, 0.02, 9000);
    if (lockCount >= 6) {
      // Battery loaded: the low brass takes a breath under the sixth lock.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      lowBrass(time, score.chordAt(position).bass + 12, 0.3, 0.42);
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.28, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const midi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 12;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fire = PLAYER_VOICES[section].fire;
      playerTone(time, midi, {
        oscillator: fire.oscillator,
        decay: 0.075,
        cutoff: fire.cutoff,
        gain: fire.gain,
        air: fire.air,
        reverb: 0.14,
      }, 1, weight);
      playerTone(time + 0.012, midi - fire.fallSemitones, {
        oscillator: fire.oscillator,
        decay: 0.05,
        cutoff: fire.cutoff * 0.6,
        gain: fire.gain * 0.55,
        air: fire.air,
        reverb: 0.1,
      }, 1, weight);
    }
    playerNoise(time, lerp(PLAYER_VOICES[mix.from].fire.air, PLAYER_VOICES[mix.to].fire.air, mix.t), 0.026, 4200);
  });

  bus.on('hit', ({ lethal, enemyId, stageHitPointsRemaining, hitStageIndex }) => {
    if (lethal || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (coreIds.has(enemyId)) {
      coreHit(time, stageHitPointsRemaining + (hitStageIndex === 0 ? 2 : 0));
      return;
    }
    // Armour chip: a short string cluster off the plate.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const [index, midi] of chord.stab.entries()) {
      spiccato(time + index * THIRTYSECOND, midi + 12, 0.4 - index * 0.08, 3000);
    }
    playerNoise(time, 0.035, 0.03, 5200);
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    noiseHit(time, 0.16, 0.2, 'bandpass', 2100);
    lowBrass(time, chord.bass + 12, 0.5, 0.6);
    if (coreIds.has(enemyId)) {
      riser(time, 0.9, 0.45, chord.bass);
      timpani(time + SIXTEENTH, chord.bass - 12, 0.8);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (generatorIds.delete(enemyId)) {
      generatorKill(kill.time);
      return;
    }
    if (coreIds.delete(enemyId)) {
      coreHit(kill.time, 0);
      if (coreIds.size === 0) flagshipDestroyed(kill.time + SIXTEENTH);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // A clean broadside answers with the section's own fanfare.
    brass(time, chord.stab.map((midi) => midi + 12), 6 * SIXTEENTH, size >= 6 ? 0.9 : 0.65, 3400, 0.05);
    if (size >= 6) {
      timpani(time, chord.bass - 12, 0.9);
      crash(time, 0.5, 1.6);
    }
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // A misfire: brass jams on a tritone and the kettle thuds under it.
    brass(time, [chord.bass + 12, chord.bass + 18], 0.3, 0.5, 1200, 0.02);
    timpani(time, chord.bass - 13, 0.5);
    noiseHit(time, 0.09, 0.08, 'bandpass', 620);
  });

  // The flagship's shield eating a release is not a misfire — it is the ship
  // winning an argument, and it gets its own bright, cold, wrong-key sound.
  bus.on('shielded', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    noiseHit(time, 0.13, 0.34, 'highpass', 3600);
    [0, 6, 11].forEach((offset, index) => {
      playerTone(time + index * THIRTYSECOND, chord.bass + 24 + offset, {
        oscillator: 'sine',
        decay: 0.45,
        cutoff: 5200,
        gain: 0.06,
        air: 0.2,
        reverb: 0.6,
      }, 0.9 - index * 0.15, 1);
    });
    bell(time, chord.bass + 30, 0.35, 1.1);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    impact(time, 0.9);
    lowBrass(time, chord.bass - 2, 0.6, 0.8);
    noiseHit(time, 0.14, 0.3, 'lowpass', 800);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    spiccato(time, score.chordAt(score.arrangementPositionAt(time)).bass + 12, 0.22, 900);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'generator') {
      generatorIds.add(enemyId);
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      // Warning horn: two notes a flat second apart. The flagship's interval.
      horn(time, chord.bass + 24, 0.28, 0.55, 1700);
      horn(time + SIXTEENTH, chord.bass + 25, 0.42, 0.5, 1600);
    } else if (kind === 'core') {
      coreIds.add(enemyId);
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      lowBrass(time, chord.bass - 12, 0.9, 0.65);
      bell(time, chord.arp[0] + 12, 0.4, 1.6);
    } else if (kind === 'picket' || kind === 'turret') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      harp(time, score.chordAt(score.arrangementPositionAt(time)).arp[1] - 12, 0.3);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'summoned') {
      const time = score.nextGridTime(ctx.currentTime, 2);
      tamTam(time, 0.8);
      lowBrass(time, score.chordAt(score.arrangementPositionAt(time)).bass - 12, 1.4, 0.85);
    } else if (phase === 'exposed') {
      shieldFall(score.nextGridTime(ctx.currentTime, 1));
    }
  });

  return runtime;
}
