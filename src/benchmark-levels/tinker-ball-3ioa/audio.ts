import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementContext } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createTinkerVoices, type TinkerToneVoice } from './audio-voices';
import { onSignal } from './signals';
import { TINKER_BARS, TINKER_BPM, TINKER_RUN_DURATION, TINKER_SCORE_SECTIONS, TINKER_STEPS_PER_BAR, TINKER_TIME } from './timing';

// The Tinker Ball score: 32 bars of bright, eccentric pop at 128 BPM in D
// major (D — Bm — G — A, two bars per chord). Bell mallets carry the groove,
// a reed organ stabs the offbeats, a bouncy synth bass and handclaps arrive
// with the tennis ball, and the melon act fills the kit with tiny workshop
// percussion. The Spill turns the harmony minor-side (Bm — G — Em — A) with a
// gurgle under the beat; the last two bars resolve to a clean D.
//
// The player is the soloist: locks and kills are mallet notes drawn from the
// live chord, kills walk a hidden two-bar melody lane so a chained volley
// performs a real run, and every rescued supply that sticks to the ball is a
// tick or a tink in the workshop kit, quantized to the transport.

const SIXTEENTH = TINKER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = TINKER_STEPS_PER_BAR;
const LANE_STEPS = 32;

type Chord = { name: string; bass: number; pad: number[]; arp: number[]; stab: number[] };

const D: Chord = { name: 'D', bass: 38, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74], stab: [57, 62, 66] };
const Bm: Chord = { name: 'Bm', bass: 35, pad: [47, 50, 54, 59], arp: [59, 62, 66, 71], stab: [54, 59, 62] };
const G: Chord = { name: 'G', bass: 43, pad: [50, 55, 59, 62], arp: [62, 67, 71, 74], stab: [55, 59, 62] };
const A: Chord = { name: 'A', bass: 45, pad: [49, 52, 57, 61], arp: [61, 64, 69, 73], stab: [57, 61, 64] };
const Em: Chord = { name: 'Em', bass: 40, pad: [47, 52, 55, 59], arp: [64, 67, 71, 76], stab: [52, 55, 59] };

const CHORDS: Chord[] = [D, Bm, G, A];
const SPILL_CHORDS: Chord[] = [Bm, G, Em, A];
const CLEAN_CHORDS: Chord[] = [D];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Kill-melody lanes: degrees 0–7 into the live lead set (arp plus the octave
// above). Each is a 32-step contour over the two-bar chord; kills unmute it
// step by step, so consecutive volley kills play consecutive notes.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Marble: a gentle stepwise tune, like a music box on the desk.
  0: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 2, 3, 1, 2, 0, 1, 3,
    2, 4, 3, 5, 4, 6, 5, 7,
    6, 4, 5, 3, 4, 2, 3, 1,
  ],
  // Tennis ball: the pop hook — leaping, bouncy, lands on the octave.
  1: [
    0, 4, 2, 5, 0, 4, 3, 7,
    1, 5, 2, 6, 1, 5, 4, 7,
    0, 4, 2, 5, 0, 4, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 0,
  ],
  // Melon: high and busy, chattering through the top of the register.
  2: [
    7, 5, 6, 4, 7, 5, 6, 4,
    3, 5, 4, 6, 3, 5, 4, 6,
    7, 6, 5, 4, 3, 2, 1, 0,
    4, 6, 5, 7, 4, 6, 5, 7,
  ],
  // The Spill: falling figures answered by a climb back out of the glue.
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    3, 2, 1, 0, 2, 1, 0, 4,
    4, 5, 6, 7, 5, 6, 7, 4,
  ],
  // Spotless: arpeggiated D, wide open.
  4: [
    0, 2, 4, 7, 4, 2, 0, 4,
    1, 3, 5, 7, 5, 3, 1, 5,
    0, 2, 4, 7, 4, 2, 0, 4,
    2, 4, 6, 7, 6, 4, 2, 0,
  ],
};

// Per-act voicing for the player's instruments. Gains are set by perceived
// loudness (a square at equal gain is far louder than a sine), so each act's
// lock stays a soft tick and each kill rings at the same level.
type FireVoice = { fromOffset: number; toOffset: number; cutoff: number; gain: number; noise: number };
const PLAYER_VOICES: Record<SectionIndex, { lock: TinkerToneVoice; kill: TinkerToneVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.13, cutoff: 4200, gain: 0.13, partial: 0.5, reverb: 0.12 },
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 4600, gain: 0.2, partial: 0.9, reverb: 0.24 },
    fire: { fromOffset: 36, toOffset: 24, cutoff: 3200, gain: 0.7, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.11, cutoff: 3600, gain: 0.11, partial: 0.6, reverb: 0.1 },
    kill: { oscillator: 'triangle', decay: 0.4, cutoff: 3800, gain: 0.19, partial: 1.0, reverb: 0.2 },
    fire: { fromOffset: 36, toOffset: 26, cutoff: 3800, gain: 0.75, noise: 0.04 },
  },
  2: {
    lock: { oscillator: 'square', decay: 0.09, cutoff: 2600, gain: 0.045, partial: 0.4, reverb: 0.1 },
    kill: { oscillator: 'square', decay: 0.3, cutoff: 3000, gain: 0.085, partial: 0.8, reverb: 0.18 },
    fire: { fromOffset: 38, toOffset: 26, cutoff: 4400, gain: 0.8, noise: 0.05 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.12, cutoff: 2200, gain: 0.05, partial: 0.3, reverb: 0.22 },
    kill: { oscillator: 'sawtooth', decay: 0.42, cutoff: 2600, gain: 0.09, partial: 0.6, reverb: 0.32 },
    fire: { fromOffset: 36, toOffset: 22, cutoff: 3000, gain: 0.75, noise: 0.05 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 5000, gain: 0.13, partial: 0.7, reverb: 0.3 },
    kill: { oscillator: 'sine', decay: 0.7, cutoff: 5000, gain: 0.2, partial: 1.0, reverb: 0.45 },
    fire: { fromOffset: 36, toOffset: 24, cutoff: 3600, gain: 0.6, noise: 0.03 },
  },
};

// Which workshop hit a rescued supply makes when it sticks to the ball.
const STICK_SOUND: Record<string, 'click' | 'tick' | 'tink'> = {
  button: 'click',
  block: 'click',
  card: 'click',
  peg: 'click',
  bead: 'tink',
  pin: 'tink',
  clip: 'tink',
  jar: 'tink',
  pencil: 'tick',
  ruler: 'tick',
  spool: 'tick',
  eraser: 'tick',
  pot: 'tick',
};

export function createAudio(bus: EventBus) {
  return createTinkerAudio(bus).audio;
}

export const traceTinkerBallAudio = createAudioTraceHarness({
  level: 'tinker-ball-3ioa',
  bpm: TINKER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: TINKER_RUN_DURATION,
  createAudio: createTinkerAudio,
});

function createTinkerAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const coreIds = new Map<number, number>();
  let spillSnapped = false;
  let spillAlive = false;
  let lastStickStep = -1;
  let stickCounter = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: TINKER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: TINKER_BARS.spill, toBar: TINKER_BARS.clean, chords: SPILL_CHORDS, barsPerChord: 2 },
      { fromBar: TINKER_BARS.clean, toBar: TINKER_BARS.end, chords: CLEAN_CHORDS, barsPerChord: 2 },
    ],
    sections: TINKER_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2800 },
      reverb: { seconds: 1.7, decay: 2.6, level: 0.36 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      coreIds.clear();
      spillSnapped = false;
      spillAlive = false;
      lastStickStep = -1;
      stickCounter = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, D.pad, 5, 0.9);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createTinkerVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    mallet, organ, pad, bass, kick, clap, tick, click, tink, shaker, boing, thump, riser, squelch, crack, snap, gurgle,
    playerTone, playerNoise, playerChirp, playerSqueak,
  } = voices;

  // ---- arrangement ----------------------------------------------------------

  const blankBar = '................';
  const evenMallet = 'A.A.A.A.A.A.A.A.';
  const beatMallet = 'A...A...A...A...';
  const clapBackbeat = '....C.......C...';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        hits(beatMallet, { A: 0.42 }, ({ time, step, bar, chord }, vel) => mallet(time, chord.arp[[0, 2, 1, 3][((step / 4) + bar) % 4]] - 12, vel, 0.3)),
        hits('T.......T.......', { T: 0.35 }, ({ time }, vel) => tick(time, vel)),
        hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.55)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'marble',
        fromBar: TINKER_BARS.marble,
        tracks: [
          malletTrack(evenMallet, 0.5, 0.35),
          hits('T...t...T...t...', { T: 0.7, t: 0.42 }, ({ time }, vel) => tick(time, vel)),
          hits('..c.....c..c....', { c: 0.55 }, ({ time }, vel) => click(time, vel)),
          hits('......k.......k.', { k: 0.4 }, ({ time }, vel) => tink(time, 100, vel, 0.16)),
          fn(({ time, step, bar }) => { if (bar >= 2 && (step === 0 || step === 8)) kick(time, 0.7); }),
          fn(({ time, step, bar, chord }) => {
            if (bar < 4) return;
            if (step === 0) bass(time, chord.bass, 0.72);
            if (step === 8) bass(time, chord.bass + 12, 0.5);
            if (step === 12) bass(time, chord.bass, 0.6);
          }),
          fn(({ time, step, bar }) => { if (bar >= 4 && step % 4 === 2) shaker(time, 0.5); }),
          padTrack(TINKER_BARS.marble, 0.5),
          fn(({ time, step, bar }) => { if (bar === 7 && step >= 12) clap(time, 0.3 + (step - 12) * 0.15); }),
        ],
      },
      {
        name: 'tennis-ball',
        fromBar: TINKER_BARS.tennis,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            boing(time, chord.bass + 24, 0.8);
            organ(time, chord.stab, 0.9, SIXTEENTH * 3, 2600);
          }),
          hits('K.......K..K....', { K: 0.95 }, ({ time }, vel) => kick(time, vel)),
          hits(clapBackbeat, { C: 0.9 }, ({ time }, vel) => clap(time, vel)),
          bassTrack('B...b.B.B...b.b.'),
          organTrack('..S...S.....S...', 0.7, SIXTEENTH * 0.9, 2600),
          malletTrack(evenMallet, 0.55, 0.45),
          hits('T.t.T.t.T.t.T.t.', { T: 0.45, t: 0.25 }, ({ time }, vel) => tick(time, vel)),
          hits('..c.......c.....', { c: 0.5 }, ({ time }, vel) => click(time, vel)),
          hits('s.s.s.s.s.s.s.s.', { s: 0.32 }, ({ time }, vel) => shaker(time, vel)),
          hits('......k.......k.', { k: 0.35 }, ({ time }, vel) => tink(time, 103, vel, 0.14)),
          padTrack(TINKER_BARS.tennis, 0.5),
          fn(({ time, step, bar }) => { if (bar === 15 && step >= 8 && step % 2 === 0) clap(time, 0.3 + (step - 8) * 0.08); }),
        ],
      },
      {
        name: 'melon',
        fromBar: TINKER_BARS.melon,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            boing(time, chord.bass + 31, 0.85);
            organ(time, chord.stab.map((midi) => midi + 12), 0.9, SIXTEENTH * 3, 3400);
          }),
          hits('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('....C.......C.C.', { C: 0.95 }, ({ time }, vel) => clap(time, vel)),
          bassTrack('B.b.B.b.b.B.b.B.'),
          organTrack('..S...S...S.S...', 0.75, SIXTEENTH * 0.8, 3000),
          malletTrack(evenMallet, 0.6, 0.6),
          hits('T.t.T.t.T.t.T.t.', { T: 0.5, t: 0.28 }, ({ time }, vel) => tick(time, vel)),
          hits('..c...c...c...c.', { c: 0.45 }, ({ time }, vel) => click(time, vel)),
          hits('s.s.s.s.s.s.s.s.', { s: 0.38 }, ({ time }, vel) => shaker(time, vel)),
          hits('..k.....k.....k.', { k: 0.32 }, ({ time }, vel) => tink(time, 105, vel, 0.12)),
          padTrack(TINKER_BARS.melon, 0.55),
        ],
      },
      {
        name: 'spill-fill',
        fromBar: TINKER_BARS.spillFill,
        tracks: [
          oneShot(0, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.2)),
          hits('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          fn(({ time, step }) => { if (step >= 8) clap(time, 0.35 + (step - 8) * 0.09); }),
          bassTrack('B.b.B.b.b.B.b.B.'),
          malletTrack(evenMallet, 0.55, 0.6),
          hits('s.s.s.s.s.s.s.s.', { s: 0.4 }, ({ time }, vel) => shaker(time, vel)),
          hits('T.t.T.t.T.t.T.t.', { T: 0.5, t: 0.28 }, ({ time }, vel) => tick(time, vel)),
        ],
      },
      {
        name: 'the-spill',
        fromBar: TINKER_BARS.spill,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            thump(time, 1);
            organ(time, chord.pad.map((midi) => midi - 12), 1.1, SIXTEENTH * 6, 1500);
            crack(time, 0.8);
            gurgle(time + SIXTEENTH * 2, 32 * SIXTEENTH);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection > 0 && barInSection % 2 === 0 && step === 0 && spillAlive) gurgle(time, 32 * SIXTEENTH);
          }),
          fn(({ time, step }) => {
            if (spillSnapped) return;
            if (step === 0 || step === 3 || step === 8) kick(time, step === 3 ? 0.75 : 1);
          }),
          fn(({ time, step }) => {
            if (step === 4 || step === 12) clap(time, spillSnapped ? 0.5 : 0.95);
          }),
          fn(({ time, step, chord }) => {
            if (spillSnapped) return;
            if (step === 0) bass(time, chord.bass, 0.9);
            if (step === 4) bass(time, chord.bass + 7, 0.6);
            if (step === 8) bass(time, chord.bass + 12, 0.7);
            if (step === 10) bass(time, chord.bass, 0.75);
            if (step === 14) bass(time, chord.bass + 7, 0.6);
          }),
          fn(({ time, step, chord }) => {
            if (spillSnapped) return;
            if (step === 0 || step === 8 || step === 12) organ(time, chord.stab.map((midi) => midi - 12), 0.8, SIXTEENTH * 1.8, 1900);
          }),
          fn(({ time, step, chord }) => {
            // Sparse mallets while the glue is alive; a full shimmer once it snaps.
            const order = [0, 2, 1, 3, 2, 0, 3, 1];
            if (spillSnapped) {
              if (step % 2 === 0) mallet(time, chord.arp[order[(step / 2) % order.length]] - 12, 0.5, 0.9);
            } else if (step % 4 === 0) {
              mallet(time, chord.arp[order[(step / 4) % order.length]] - 12, 0.45, 0.4);
            }
          }),
          hits('T...T...T...T...', { T: 0.45 }, ({ time }, vel) => tick(time, vel)),
          hits('s.s.s.s.s.s.s.s.', { s: 0.3 }, ({ time }, vel) => shaker(time, vel)),
          fn(({ time, step, chord }) => { if (spillSnapped && (step === 6 || step === 14)) tink(time, chord.arp[3] + 12, 0.35, 0.2); }),
          padTrack(TINKER_BARS.spill, 0.6),
        ],
      },
      {
        name: 'spotless',
        fromBar: TINKER_BARS.clean,
        toBar: TINKER_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            organ(time, [chord.bass + 12, ...chord.pad], 0.9, 32 * SIXTEENTH, 2200);
            score.leadSetAt(score.arrangementPositionAt(time)).forEach((midi, index) => mallet(time + index * THIRTYSECOND, midi, 0.55 - index * 0.03, 0.9));
            shaker(time, 0.6);
          }),
          hits('K.......K.......', { K: 0.6 }, ({ time, barInSection }, vel) => kick(time, vel * (1 - barInSection * 0.4))),
          malletTrack(evenMallet, 0.5, 0.9),
          hits('T.......T.......', { T: 0.4 }, ({ time }, vel) => tick(time, vel)),
          hits('......k.......k.', { k: 0.35 }, ({ time, chord }, vel) => tink(time, chord.arp[2] + 12, vel, 0.25)),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection === 1 && step === 8) {
              boing(time, chord.bass + 24, 0.7);
              tink(time + THIRTYSECOND, chord.arp[0] + 24, 0.5, 0.5);
            }
          }),
        ],
      },
    ],
  });

  function malletTrack(pattern: string, vel: number, bright: number) {
    const order = [0, 2, 1, 3, 2, 0, 3, 1];
    return hits<Chord>(pattern, { A: vel }, ({ time, step, chord }, velocity) => {
      mallet(time, chord.arp[order[(step / 2) % order.length]] - 12, velocity, bright);
    });
  }

  function bassTrack(pattern: string) {
    return hits<Chord>(pattern, { B: 0.85, b: 0.6 }, ({ time, chord }, vel, symbol) => {
      bass(time, chord.bass + (symbol === 'b' ? 12 : 0), vel);
    });
  }

  function organTrack(pattern: string, vel: number, duration: number, cutoff: number) {
    return hits<Chord>(pattern, { S: vel }, ({ time, chord }, velocity) => organ(time, chord.stab, velocity, duration, cutoff));
  }

  function padTrack(fromBar: number, vel: number) {
    const pattern = fromBar % 2 === 0 ? 'P...............' + blankBar : blankBar + 'P...............';
    return hits<Chord>(pattern, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, vel));
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments ---------------------------------------------

  function mixedVoice(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: 'decay' | 'gain' | 'partial' | 'reverb') {
    return lerp(PLAYER_VOICES[mix.from][slot][key], PLAYER_VOICES[mix.to][slot][key], mix.t);
  }

  function killNote(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    // Chained volley kills crescendo; from the third on, an octave rings above.
    const vel = Math.min(1.4, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    if (chain >= 2) playerTone(time, midi + 12, PLAYER_VOICES[mix.to].kill, 0.4, 1);
    playerNoise(time, 0.03 + mixedVoice(mix, 'kill', 'partial') * 0.03, 0.06, 6800);
  }

  // Chipping a core: a glue squelch that opens up with damage, an organ stab
  // that brightens with it, and a beacon note climbing the lead set.
  function coreChip(time: number, intensity: number) {
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    squelch(time, intensity, 1);
    organ(time, chord.stab.map((midi) => midi + 12), 0.5 + intensity * 0.4, SIXTEENTH * 1.2, 1400 + intensity * 3200);
    const leadSet = score.leadSetAt(position);
    playerTone(time + THIRTYSECOND, leadSet[Math.min(7, Math.floor(intensity * 8))] + 12, PLAYER_VOICES[3].kill, 0.45 + intensity * 0.4, 1);
  }

  // The last glue snapping clean: the music bows out for a breath, the snap
  // lands dry, and a D major peal climbs out of it through the delay.
  function spillFinale(time: number) {
    const audioMix = runtime.mix();
    if (audioMix?.duck) audioMix.duckAt(time, 0.18, 1.6);
    snap(time);
    const peal = [62, 66, 69, 74, 78, 81, 86, 90];
    peal.forEach((midi, index) => {
      playerTone(time + SIXTEENTH * 0.5 + index * THIRTYSECOND, midi, PLAYER_VOICES[4].kill, 0.95 - index * 0.06, 1);
    });
    organ(time + SIXTEENTH, [50, 57, 62, 66, 69], 1, SIXTEENTH * 8, 2600);
    boing(time + SIXTEENTH * 2, 62, 0.7);
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
    playerNoise(time, 0.02, 0.02, 8000);
    if (lockCount >= 6) {
      // Sixth lock: the whole reticle is beaded — an octave ping and a spring.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      boing(time, score.chordAt(position).bass + 24, 0.45);
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.3, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    // The pin launch: a chirp rooted on the chord that falls an octave-ish,
    // one chord tone up per shot in the volley.
    const root = chord.arp[(indexInVolley ?? 0) % chord.arp.length] - 12;
    playerChirp(
      time,
      root + lerp(fromFire.fromOffset, toFire.fromOffset, mix.t),
      root + lerp(fromFire.toOffset, toFire.toOffset, mix.t),
      lerp(fromFire.gain, toFire.gain, mix.t),
      lerp(fromFire.cutoff, toFire.cutoff, mix.t),
    );
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.03, 4800);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const coreMax = coreIds.get(enemyId);
    if (coreMax !== undefined) {
      const max = Math.max(coreMax, hitPointsRemaining + 1);
      coreIds.set(enemyId, max);
      coreChip(time, 1 - hitPointsRemaining / max);
      return;
    }
    const chord = score.chordAt(score.arrangementPositionAt(time));
    chord.stab.forEach((midi, index) => {
      playerTone(time + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[score.sectionMixAt(score.arrangementPositionAt(time)).to].lock, 0.6 - index * 0.1, 1);
    });
  });

  // A shell breaking off a core: the crack, then the rescued pieces tinkle
  // down the lead set as they scatter across the road.
  bus.on('stage', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    crack(time, 1);
    const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
    [7, 5, 3, 1, 0].forEach((degree, index) => tink(time + (index + 1) * THIRTYSECOND, leadSet[degree] + 12, 0.5 - index * 0.06, 0.22));
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (coreIds.has(enemyId)) {
      coreIds.delete(enemyId);
      crack(kill.time, 1);
      if (coreIds.size === 0 && spillAlive) {
        spillFinale(kill.time);
        return;
      }
      [7, 6, 4, 2].forEach((degree, index) => tink(kill.time + (index + 1) * THIRTYSECOND, score.leadSetAt(score.arrangementPositionAt(kill.time))[degree] + 12, 0.5, 0.22));
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  // A clean volley of four or more earns the organ's applause on the next beat.
  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    organ(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 1 : 0.75, SIXTEENTH * 2.5, 3600);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.55 - index * 0.06, 1));
    if (size >= 6) boing(time, chord.bass + 24, 0.5);
  });

  bus.on('reject', () => {
    if (!ctx) return;
    playerSqueak(ctx.currentTime, 1);
  });

  // Gummed: a heavy glue splat with the music ducked under it — the one sound
  // in the level that is wet and dull instead of bright and dry.
  bus.on('playerhit', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const audioMix = runtime.mix();
    if (audioMix?.duck) audioMix.duckAt(time, 0.35, 0.7);
    squelch(time, 0.9, 1.4);
    thump(time, 0.6);
    playerNoise(time + 0.04, 0.12, 0.18, 260, 'lowpass');
  });

  bus.on('miss', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    tick(time, 0.25);
  });

  // A glue creature assembling: a little rattle of pieces on the workshop kit.
  bus.on('spawn', ({ kind, enemyId }) => {
    if (!ctx) return;
    if (kind === 'spill-core') {
      coreIds.set(enemyId, 1);
      spillAlive = true;
      return;
    }
    if (kind === 'glob') {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      squelch(time, 0.3, 0.45);
      return;
    }
    if (kind === 'letter' || kind === 'spill') return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    click(time, 0.35);
    tick(time + THIRTYSECOND, 0.25);
    if (kind === 'snapper') click(time + SIXTEENTH, 0.3);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'exposed') {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      riser(time, 0.9, 0.16);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      organ(time + SIXTEENTH, chord.stab.map((midi) => midi - 12), 0.9, SIXTEENTH * 3, 1600);
    }
    if (phase === 'destroyed') {
      spillSnapped = true;
      spillAlive = false;
    }
  });

  // Rescued supplies sticking to the ball: workshop percussion on the 32nd
  // grid, one hit per step so a cluster of pieces rolls like a drum fill.
  onSignal('stick', ({ type }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const step = Math.round((time - score.epoch) / THIRTYSECOND);
    if (step === lastStickStep) return;
    lastStickStep = step;
    stickCounter += 1;
    const sound = STICK_SOUND[type] ?? 'click';
    const vel = 0.3 + 0.1 * Math.sin(stickCounter * 1.7);
    if (sound === 'click') click(time, vel);
    else if (sound === 'tick') tick(time, vel);
    else {
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      tink(time, leadSet[stickCounter % leadSet.length] + 12, vel, 0.12);
    }
  });

  onSignal('shower', ({ pieces }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    playerNoise(time, 0.05 + Math.min(0.1, pieces * 0.008), 0.09, 5200);
  });

  return runtime;
}

export type TinkerArrangementContext = ArrangementContext<Chord>;
