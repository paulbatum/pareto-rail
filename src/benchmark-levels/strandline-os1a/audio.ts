import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createStrandlineVoices, installStrandlineFlow, type FlowController, type StrandTonalVoice } from './audio-voices';
import {
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
} from './timing';

// THE STRANDLINE SCORE — 96 BPM in D minor, 24 bars, exactly sixty seconds.
//
// The brief for the music is the brief for the level: slow at the start, more
// of it alive as you go. So the arrangement is purely additive until the end —
// the bell pulse arrives at bar 2, the water opens at bar 6, the groove and
// the arps arrive in the thicket at bar 8, the parasite's detuned groan takes
// the harmony hostage at the crown, and the last two bars resolve D minor to
// D major with everything else stripped away.
//
// One structural idea holds it together: the *pulse* is the animal's bell
// contracting. It swells before it lands rather than clicking, it plays half
// notes, and the environment layer squeezes the bell mesh on exactly the same
// grid. The metronome you hear and the metronome you see are the same organ.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Dm9 — Bbmaj7 — Fadd9 — Am7, two bars each: eight bars of open water.
const CHORDS: Chord[] = [
  { bass: 38, pad: [57, 60, 64, 69], arp: [62, 65, 69, 72], stab: [62, 65, 69] }, // Dm9
  { bass: 34, pad: [58, 62, 65, 69], arp: [58, 62, 65, 70], stab: [58, 62, 65] }, // Bbmaj7
  { bass: 41, pad: [57, 60, 65, 67], arp: [60, 65, 67, 72], stab: [60, 65, 67] }, // Fadd9
  { bass: 33, pad: [57, 60, 64, 67], arp: [60, 64, 67, 72], stab: [60, 64, 67] }, // Am7
];

// The crown. The parasite drags the harmony flat: a raised-root diminished
// chord and a minor plagal turn instead of the open loop. (Array order
// compensates for absolute-bar chord indexing — bar 16 lands on index 0.)
const CROWN_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 60, 65, 69], arp: [62, 65, 69, 74], stab: [62, 65, 69] }, // Dm
  { bass: 37, pad: [56, 61, 65, 68], arp: [61, 65, 68, 73], stab: [61, 65, 68] }, // C#dim — the sour one
  { bass: 31, pad: [58, 62, 67, 70], arp: [62, 67, 70, 74], stab: [62, 67, 70] }, // Gm
  { bass: 38, pad: [57, 60, 65, 69], arp: [62, 65, 69, 74], stab: [62, 65, 69] }, // Dm
];

// Adrift: D major. The level is a semitone away from this the whole way
// through and never gets there until the animal is clean.
const ADRIFT_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 62, 66, 69], arp: [62, 66, 69, 74], stab: [62, 66, 69] },
];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Kill lanes: the player's melody. Each degree indexes the live lead set (the
// chord's arpeggio, doubled an octave), so a chained six-kill volley walks a
// written line through whatever chord happens to be underneath it.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Strands: slow arches out of the dark, low in the register.
  0: [
    0, 1, 2, 1, 2, 3, 2, 1,
    2, 3, 4, 3, 2, 3, 4, 3,
    1, 2, 3, 4, 3, 2, 3, 4,
    2, 3, 4, 5, 4, 3, 2, 1,
  ],
  // Openwater: wide, unhurried, upper structure. This section is the view.
  1: [
    4, 5, 6, 5, 4, 5, 7, 6,
    5, 4, 5, 6, 7, 6, 5, 4,
    3, 5, 7, 6, 4, 5, 6, 7,
    5, 6, 7, 5, 4, 6, 5, 4,
  ],
  // Thicket: broken and jumping, so dense volleys read as runs, not scales.
  2: [
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 1, 5, 2, 6, 3, 7, 4,
    2, 6, 0, 4, 3, 7, 1, 5,
    6, 4, 7, 5, 3, 1, 2, 0,
  ],
  // Crown: descending, tolling. You are taking something apart.
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    6, 5, 4, 3, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
  ],
  // Adrift: settling home.
  4: [
    4, 3, 2, 1, 2, 3, 4, 5,
    3, 2, 1, 0, 1, 2, 3, 4,
    2, 1, 0, 1, 2, 3, 2, 1,
    0, 1, 2, 3, 4, 3, 2, 0,
  ],
};

type PluckVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fall: number; water: number };

// The player's instrument brightens as the animal does. Section 0 is muffled
// and close — you are deep in the strands. By adrift it is open glass.
const PLAYER_VOICES: Record<SectionIndex, { lock: StrandTonalVoice; kill: StrandTonalVoice; fire: PluckVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 1700, gain: 0.13, sparkle: 0.25, reverb: 0.34 },
    kill: { oscillator: 'sine', decay: 0.42, cutoff: 2000, gain: 0.16, sparkle: 0.35, reverb: 0.44 },
    fire: { oscillator: 'triangle', cutoff: 1500, gain: 0.075, fall: 11, water: 0.055 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.18, cutoff: 2600, gain: 0.1, sparkle: 0.5, reverb: 0.46 },
    kill: { oscillator: 'triangle', decay: 0.52, cutoff: 3000, gain: 0.13, sparkle: 0.62, reverb: 0.56 },
    fire: { oscillator: 'triangle', cutoff: 2200, gain: 0.07, fall: 9, water: 0.05 },
  },
  2: {
    lock: { oscillator: 'triangle', decay: 0.12, cutoff: 3400, gain: 0.11, sparkle: 0.55, reverb: 0.3 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3900, gain: 0.15, sparkle: 0.7, reverb: 0.34 },
    fire: { oscillator: 'sawtooth', cutoff: 3000, gain: 0.055, fall: 8, water: 0.06 },
  },
  3: {
    // The crown. Everything the player does here is harder and drier — you are
    // cutting something off, not sweeping past it.
    lock: { oscillator: 'square', decay: 0.1, cutoff: 2200, gain: 0.06, sparkle: 0.4, reverb: 0.26 },
    kill: { oscillator: 'square', decay: 0.26, cutoff: 2800, gain: 0.085, sparkle: 0.55, reverb: 0.3 },
    fire: { oscillator: 'sawtooth', cutoff: 2400, gain: 0.05, fall: 13, water: 0.045 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.24, cutoff: 3600, gain: 0.11, sparkle: 0.7, reverb: 0.6 },
    kill: { oscillator: 'sine', decay: 0.7, cutoff: 4200, gain: 0.14, sparkle: 0.85, reverb: 0.66 },
    fire: { oscillator: 'sine', cutoff: 2600, gain: 0.05, fall: 7, water: 0.02 },
  },
};

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-os1a',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: STRANDLINE_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let flow: FlowController | null = null;
  let parentId = -1;
  const PARENT_TOTAL_HP = 6; // hitStages [3, 3]

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.adrift, chords: CROWN_CHORDS, barsPerChord: 2 },
      { fromBar: STRANDLINE_BARS.adrift, chords: ADRIFT_CHORDS, barsPerChord: 1 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
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
      compressor: { threshold: -17, ratio: 4, attack: 0.008, release: 0.28 },
      // A long dark delay and a big room: this is a lot of water.
      delay: { time: SIXTEENTH * 6, feedback: 0.34, dampHz: 1500 },
      reverb: { seconds: 4.2, decay: 2.4, level: 0.62 },
      noiseSeconds: 2.5,
    },
    onPostBuild(context, mix) {
      ctx = context;
      flow = installStrandlineFlow(context, mix);
      flow.setFlow(context.currentTime + 0.1, 0.18, 2);
      flow.setBrightness(context.currentTime + 0.1, 380, 2);
    },
    onStep: scheduleStep,
    onRunStart() {
      parentId = -1;
      const context = runtime.context();
      if (context && flow) {
        flow.setFlow(context.currentTime + 0.05, 0.26, 1.5);
        flow.setBrightness(context.currentTime + 0.05, 460, 2);
      }
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      flow?.setFlow(context.currentTime + 0.3, 0.14, 4);
      pad(context.currentTime + 0.05, [57, 62, 66, 69, 74], 7, 0.8, 1500);
    },
    onDispose() {
      ctx = null;
      flow = null;
    },
  });

  // ---- arrangement -----------------------------------------------------------

  const blank = '................';
  const pulseHalf = 'P.......P.......';
  const pulseBar = 'P...............';
  const pulseUrgent = 'P.....P.....P...'; // 3-3-2: the crown's heartbeat, wrong-footed
  const knockOff = '..k...k...k...k.';
  const knockRoll = 'k..k..k.k..k..k.';
  const arpEven = 'a.a.a.a.a.a.a.a.';
  const longRest = '.'.repeat(31);

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const barIndex = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(barIndex / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          hits(`P${longRest}`, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.5, 900)),
          hits([blank, '............g...'].join(''), { g: 1 }, ({ time, chord }) => glass(time, chord.arp[2], 0.5, 1.6)),
          hits([blank, blank, blank, '........s.......'].join(''), { s: 1 }, ({ time, chord }) => sub(time, chord.bass, 0.5, 6)),
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
      // --- Strands. Almost nothing, and then a heartbeat.
      {
        name: 'strands',
        fromBar: STRANDLINE_BARS.drift,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            swell(time, chord.bass + 12, 0.7, 4.2);
            surge(time, 0.5);
          }),
          hits(`P${longRest}`, { P: 1 }, ({ time, bar, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.6 + bar * 0.05, 780 + bar * 210)),
          hits(`S${longRest}`, { S: 1 }, ({ time, chord }) => sub(time, chord.bass, 0.65, 32 * SIXTEENTH)),
          // The bell only starts breathing at bar 2 — the level's first event.
          hits([blank, blank, pulseHalf, pulseHalf, pulseHalf, pulseHalf].join(''), { P: 0.55 }, ({ time, chord }, vel) => pulse(time, chord.bass + 12, vel)),
          fn(({ time, step, bar, chord }) => {
            if (bar >= 3 && step === 12) glass(time, chord.arp[(bar + 1) % chord.arp.length] + 12, 0.4, 1.3);
          }),
          hits([blank, blank, blank, blank, knockOff, knockOff].join(''), { k: 0.4 }, ({ time, chord }, vel) => knock(time, vel, chord.bass + 24)),
          oneShot(5, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.1)),
        ],
      },

      // --- Openwater. The rail banks clear and the animal calls.
      {
        name: 'openwater',
        fromBar: STRANDLINE_BARS.open,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            whale(time, chord.bass - 5, 0.9, 6.4, 1.5);
            surge(time, 0.75);
            flowTo(time, 0.12, 3);
            brightnessTo(time, 900, 3);
          }),
          hits(`P${longRest}`, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.85, 1900)),
          hits(`S${longRest}`, { S: 1 }, ({ time, chord }) => sub(time, chord.bass, 0.6, 32 * SIXTEENTH)),
          hits(pulseHalf, { P: 0.62 }, ({ time, chord }, vel) => pulse(time, chord.bass + 12, vel)),
          hits(knockOff, { k: 0.34 }, ({ time, chord }, vel) => knock(time, vel, chord.bass + 24)),
          // Glass bells hanging in the open water.
          fn(({ time, step, bar, chord }) => {
            if (step === 4) shimmer(time, chord.arp[3] + 12, 0.34, 1.5);
            if (step === 12) shimmer(time, chord.arp[bar % 2 === 0 ? 1 : 2] + 12, 0.26, 1.2);
          }),
          oneShot(1, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.11)),
        ],
      },

      // --- Thicket. The groove finally arrives.
      {
        name: 'thicket',
        fromBar: STRANDLINE_BARS.thicket,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            surge(time, 0.8);
            sub(time, chord.bass - 12, 0.7, 4);
            flowTo(time, 0.3, 2);
            brightnessTo(time, 620, 2);
          }),
          hits(`P${longRest}`, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.03, 0.85, 2200)),
          hits(`S${longRest}`, { S: 1 }, ({ time, chord }) => sub(time, chord.bass, 0.8, 32 * SIXTEENTH)),
          // Two bars of half-note bell, then an extra upbeat contraction that
          // makes the thicket feel faster than it actually is.
          hits([pulseHalf, pulseHalf, 'P.......P...P...', 'P.......P...P...', 'P.......P...P...', 'P.......P...P...'].join(''), { P: 0.78 }, ({ time, chord }, vel) => pulse(time, chord.bass + 12, vel)),
          hits(knockRoll, { k: 0.5 }, ({ time, chord }, vel) => knock(time, vel, chord.bass + 26)),
          hits(arpEven, { a: 0.55 }, ({ time, step, bar, chord }, vel) => {
            const order = [0, 2, 1, 3, 2, 0, 3, 1];
            arp(time, chord.arp[order[(step / 2) % order.length]], vel, 1700 + bar * 320);
          }),
          fn(({ time, step, bar, chord }) => {
            if (bar % 2 === 1 && step === 8) shimmer(time, chord.arp[3] + 12, 0.3, 1.1);
          }),
          oneShot(5, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.13)),
          // Half a bar before the lift the water visibly opens ahead of you.
          oneShot(5, 8, ({ time }) => {
            flowTo(time, 0.12, 2.2);
            brightnessTo(time, 1100, 2.2);
          }),
        ],
      },

      // --- Rise. Strip it back; the animal calls again, closer.
      {
        name: 'rise',
        fromBar: STRANDLINE_BARS.rise,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            whale(time, chord.bass - 3, 1.0, 6.8, 1.62);
            surge(time, 0.85);
          }),
          hits(`P${longRest}`, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.9, 2600)),
          hits(`S${longRest}`, { S: 1 }, ({ time, chord }) => sub(time, chord.bass, 0.7, 32 * SIXTEENTH)),
          hits(pulseHalf, { P: 0.6 }, ({ time, chord }, vel) => pulse(time, chord.bass + 12, vel)),
          fn(({ time, step, chord }) => {
            if (step % 4 === 0) shimmer(time, chord.arp[(step / 4) % chord.arp.length] + 12, 0.24 + step * 0.006, 1.3);
          }),
          // Two bars of riser leading straight into the crown.
          oneShot(0, 8, ({ time }) => riser(time, 24 * SIXTEENTH, 0.17)),
          oneShot(1, 12, ({ time, chord }) => groan(time, chord.bass, 0.4, 2.2)),
        ],
      },

      // --- Crown. The parasite has the harmony now.
      {
        name: 'crown',
        fromBar: STRANDLINE_BARS.crown,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            surge(time, 1.0);
            groan(time, chord.bass - 12, 1.0, 5.0);
            flowTo(time, 0.34, 1.4);
            brightnessTo(time, 520, 1.6);
          }),
          hits(`P${longRest}`, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.7, 1500)),
          hits(`S${longRest}`, { S: 1 }, ({ time, chord }) => sub(time, chord.bass, 0.9, 32 * SIXTEENTH)),
          hits(pulseUrgent, { P: 0.8 }, ({ time, chord }, vel) => pulse(time, chord.bass + 12, vel)),
          hits(knockRoll, { k: 0.55 }, ({ time, chord }, vel) => knock(time, vel, chord.bass + 26)),
          // Choir stabs mark the bar, so the fight has an audible countdown.
          hits(pulseBar, { P: 1 }, ({ time, chord }) => choir(time, chord.stab, 8 * SIXTEENTH * 0.9, 0.55, 1900)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection % 2 === 0 && step === 0) groan(time, chord.bass, 0.55, 5.0);
          }),
          // The last bar of the fight leans on the grid: the toll speeds up.
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection >= 5 && step % 4 === 2) knock(time, 0.62, chord.bass + 26);
          }),
          oneShot(5, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.12)),
        ],
      },

      // --- Adrift. D major, and nothing in a hurry.
      {
        name: 'adrift',
        fromBar: STRANDLINE_BARS.adrift,
        toBar: STRANDLINE_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            pad(time, chord.pad, 34 * SIXTEENTH, 0.95, 2600);
            sub(time, chord.bass, 0.8, 32 * SIXTEENTH);
            swell(time, chord.bass + 12, 0.6, 5.0);
            surge(time, 0.55);
            flowTo(time, 0.07, 5);
            brightnessTo(time, 1600, 4);
          }),
          hits([pulseBar, pulseBar].join(''), { P: 0.5 }, ({ time, chord }, vel) => pulse(time, chord.bass + 12, vel)),
          // One long cascade of glass down the D major chord, and then quiet.
          oneShot(0, 4, ({ time, chord }) => shimmer(time, chord.arp[3] + 12, 0.4, 2.6)),
          oneShot(0, 8, ({ time, chord }) => shimmer(time, chord.arp[2] + 12, 0.34, 2.6)),
          oneShot(0, 12, ({ time, chord }) => shimmer(time, chord.arp[1] + 12, 0.3, 2.8)),
          oneShot(1, 0, ({ time, chord }) => shimmer(time, chord.arp[0] + 12, 0.28, 3.2)),
          oneShot(1, 8, ({ time, chord }) => glass(time, chord.arp[3] + 12, 0.3, 3.4)),
          oneShot(1, 12, ({ time, chord }) => whale(time, chord.bass - 12, 0.5, 4.0, 1.18)),
        ],
      },
    ],
  });

  function flowTo(time: number, level: number, ramp: number) {
    flow?.setFlow(time, level, ramp);
  }

  function brightnessTo(time: number, hz: number, ramp: number) {
    flow?.setBrightness(time, hz, ramp);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ------------------------------------------------------------------

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    pulse, sub, knock, pad, glass, shimmer, arp, choir, whale, groan, riser, swell, surge,
    playerTone, playerWater, playerPluck, chip, tear, refuse, hull, slip,
  } = voices;

  // ---- player instruments ---------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof StrandTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
  }

  /** A kill is a note in the section's written line, not a sound effect. */
  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = score.leadSetAt(position);
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = leadSet[degree];
    const vel = Math.min(1.4, 1 + chain * 0.12);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    // Deep into a chain the octave doubles, so a long volley gains a voice.
    if (chain >= 2) playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.42 + chain * 0.05, 1);
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerWater(time, 0.03 + sparkle * 0.05, 0.16, 2600);
  }

  /** The parent audibly loses: every chip is higher, brighter and more strained. */
  function parentChip(time: number, intensity: number) {
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    chip(time, leadSet[Math.min(7, Math.floor(intensity * 7))] - 12, 0.7 + intensity * 0.6);
    groan(time, score.chordAt(position).bass + Math.round(intensity * 5), 0.35 + intensity * 0.4, 1.2);
    playerWater(time, 0.07 + intensity * 0.07, 0.14, 1400 + intensity * 2200);
  }

  /**
   * The killing blow. Duck everything, tear it loose, then walk the whole lead
   * set upward while the level's first D major opens underneath it.
   */
  function parentFinale(time: number) {
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    runtime.mix()?.duckAt(time, 0.15, 1.8);
    surge(time, 1.2);
    tear(time, chord.bass + 12, 1.0);
    sub(time + 0.02, chord.bass - 12, 0.9, 3.5);
    score.leadSetAt(position).forEach((midi, index) => {
      playerTone(time + 0.1 + index * SIXTEENTH, midi, PLAYER_VOICES[4].kill, 0.9 - index * 0.06, 1);
    });
    swell(time + 0.12, 38, 0.75, 4.0);
    shimmer(time + 0.1 + 8 * SIXTEENTH, 74, 0.42, 3.4);
    glass(time + 0.1 + 10 * SIXTEENTH, 81, 0.34, 3.0);
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
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerWater(time, 0.012 + sparkle * 0.022, 0.05, 3800);
    if (lockCount >= 6) {
      // Six locked: the animal answers underneath before you have even fired.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      pulse(time, score.chordAt(position).bass, 0.55);
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    slip(time, score.chordAt(score.arrangementPositionAt(time)).bass + 26);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 12;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fire = PLAYER_VOICES[section].fire;
      playerPluck(time, sourceMidi, fire.oscillator, fire.cutoff, fire.gain, fire.fall, weight);
    }
    const water = lerp(PLAYER_VOICES[mix.from].fire.water, PLAYER_VOICES[mix.to].fire.water, mix.t);
    playerWater(time, water, 0.06, 1800);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === parentId) {
      parentChip(time, 1 - hitPointsRemaining / PARENT_TOTAL_HP);
      return;
    }
    chip(time, score.chordAt(score.arrangementPositionAt(time)).stab[1], 0.8);
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    tear(time, chord.bass + 12, 0.8);
    if (enemyId === parentId) {
      // Halfway through the parent: it slips, re-grips, and comes on again.
      groan(time + 0.05, chord.bass - 12, 0.8, 3.0);
      riser(time, 1.6, 0.13);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === parentId) {
      parentFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const mix = score.sectionMixAt(position);
    // A clean volley leaves a chord hanging in the water behind it.
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[mix.to].kill, (size >= 6 ? 0.7 : 0.5) - index * 0.05, 1);
    });
    if (size >= 6) {
      pulse(time, score.chordAt(position).bass, 0.7);
      shimmer(time + 4 * THIRTYSECOND, leadSet[7] + 12, 0.3, 2.4);
    }
  });

  bus.on('reject', () => {
    if (!ctx) return;
    refuse(ctx.currentTime, score.chordAt(score.arrangementPositionAt(ctx.currentTime)).bass + 13);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    const chord = score.chordAt(score.arrangementPositionAt(ctx.currentTime));
    hull(ctx.currentTime, chord.bass + 12);
    groan(ctx.currentTime + 0.06, chord.bass - 12, 0.7, 1.6);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    slip(ctx.currentTime, score.chordAt(score.arrangementPositionAt(ctx.currentTime)).bass + 24);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'parent') {
      parentId = enemyId;
      // It comes out of the crown: duck the animal's music and let the thing
      // that has been living inside it speak.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      runtime.mix()?.duckAt(time, 0.42, 1.2);
      surge(time, 1.1);
      groan(time, 26, 1.1, 5.0);
      riser(time + 0.1, 2.4, 0.16);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (kind === 'brood') {
      // A wet low groan: something has just been pushed out into the water.
      groan(time, chord.bass - 5, 0.6, 2.4);
      playerWater(time, 0.11, 0.3, 700);
    } else if (kind === 'spitter') {
      knock(time, 0.5, chord.bass + 13);
      knock(time + 2 * THIRTYSECOND, 0.36, chord.bass + 13);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx || phase !== 'exposed') return;
    // The webbing is gone. Three rising notes, and the mix opens back up.
    const time = score.nextGridTime(ctx.currentTime, 1);
    const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
    [0, 3, 5].forEach((degree, index) => {
      playerTone(time + index * SIXTEENTH, leadSet[degree] + 12, PLAYER_VOICES[3].kill, 0.65, 1);
    });
    riser(time, 1.8, 0.14);
    brightnessTo(time, 900, 1.5);
  });

  return runtime;
}
