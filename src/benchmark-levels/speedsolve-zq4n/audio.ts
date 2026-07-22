import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSpeedsolveVoices, installMotor, type MotorController, type ToneVoice } from './audio-voices';
import {
  CORE_BAR,
  END_BAR,
  FACE_COUNT,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_DURATION,
  SPEEDSOLVE_SCORE_SECTIONS,
  SPEEDSOLVE_SIXTEENTH,
  SPEEDSOLVE_STEPS_PER_BAR,
  faceBar,
} from './timing';

// THE SCORE
//
// 144 BPM, thirty-six bars, E minor, and nothing swings.
//
// The rule the whole piece obeys is that the cube is the percussion section.
// `clack` — a pitched plastic knock — is written into the drum pattern *and*
// played by the machine every time a layer snaps, so a player solving squares
// on the grid adds to the kit instead of talking over it. The visual layer
// rotation is released on a beat event and the knock is scheduled onto the
// next quarter note of the same transport, which is what keeps the picture and
// the sound on one hit.
//
// The arrangement gains a motor layer every time a face comes off, so the
// track thickens with the fight without a single extra written note. Locks,
// shots, chips, and kills are quantized to the transport and pitched from the
// live chord; kills walk a written per-section lane, so a chained volley is a
// melodic run rather than six of the same noise.

const SIXTEENTH = SPEEDSOLVE_SIXTEENTH;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SPEEDSOLVE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Em9 — Cmaj7#11 — Gadd9 — Bm7, two bars each: bright, modal, and never quite
// resolved, which is what a scrambled cube sounds like.
const CHORDS: Chord[] = [
  { bass: 28, pad: [55, 59, 62, 66], arp: [64, 67, 71, 74], stab: [64, 67, 71] },
  { bass: 24, pad: [55, 59, 64, 66], arp: [60, 64, 67, 71], stab: [60, 64, 67] },
  { bass: 31, pad: [55, 59, 62, 69], arp: [62, 67, 71, 74], stab: [62, 67, 71] },
  { bass: 35, pad: [54, 59, 62, 66], arp: [59, 62, 66, 69], stab: [59, 62, 66] },
];
// The core section holds one chord and refuses to move: Em with the ninth on
// top, waiting for a resolution the player has to earn.
const CORE_CHORDS: Chord[] = [
  { bass: 28, pad: [55, 59, 64, 66], arp: [64, 67, 71, 76], stab: [64, 67, 71] },
];
/** E major. Played once, when the machine finally comes apart. */
const RESOLVE = { bass: 28, pad: [56, 59, 64, 68], arp: [64, 68, 71, 76] };

type SectionIndex = 0 | 1 | 2 | 3 | 4;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Wake: two notes, barely awake.
  0: [
    0, 1, 2, 1, 0, 1, 2, 3,
    2, 1, 0, 1, 2, 3, 2, 1,
    0, 2, 1, 3, 2, 4, 3, 2,
    1, 2, 3, 4, 3, 2, 1, 0,
  ],
  // Inspection: patient climbing arches — you are still reading the cube.
  1: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 4,
  ],
  // Drive: broken-chord jump cuts, built for dense volleys.
  2: [
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    2, 6, 0, 4, 3, 7, 1, 5,
    6, 4, 7, 5, 4, 2, 6, 0,
  ],
  // Press: high and insistent; the solve is running out of room.
  3: [
    4, 5, 7, 6, 5, 7, 6, 5,
    7, 6, 4, 5, 7, 6, 5, 4,
    5, 7, 6, 7, 5, 4, 6, 7,
    6, 5, 7, 4, 5, 6, 7, 5,
  ],
  // Core: a long fall and a long climb — the last thing the machine hears.
  4: [
    7, 6, 5, 4, 3, 2, 1, 0,
    1, 2, 3, 4, 5, 6, 7, 6,
    5, 4, 3, 4, 5, 6, 7, 5,
    4, 3, 2, 3, 4, 5, 6, 7,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: ToneVoice; body: ToneVoice; fire: FireVoice; killDecay: number }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.07, cutoff: 3000, gain: 0.1, bite: 0.3, verb: 0.22 },
    body: { oscillator: 'sine', decay: 0.2, cutoff: 2400, gain: 0.09, bite: 0.3, verb: 0.26 },
    fire: { oscillator: 'triangle', cutoff: 2600, gain: 0.055, noise: 0.03 },
    killDecay: 0.34,
  },
  1: {
    lock: { oscillator: 'square', decay: 0.06, cutoff: 3400, gain: 0.055, bite: 0.5, verb: 0.16 },
    body: { oscillator: 'triangle', decay: 0.19, cutoff: 3000, gain: 0.1, bite: 0.5, verb: 0.2 },
    fire: { oscillator: 'square', cutoff: 3200, gain: 0.04, noise: 0.035 },
    killDecay: 0.3,
  },
  2: {
    lock: { oscillator: 'square', decay: 0.055, cutoff: 4200, gain: 0.05, bite: 0.7, verb: 0.14 },
    body: { oscillator: 'square', decay: 0.16, cutoff: 3600, gain: 0.06, bite: 0.7, verb: 0.18 },
    fire: { oscillator: 'sawtooth', cutoff: 4200, gain: 0.038, noise: 0.04 },
    killDecay: 0.27,
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.05, cutoff: 4800, gain: 0.036, bite: 0.85, verb: 0.12 },
    body: { oscillator: 'sawtooth', decay: 0.15, cutoff: 4000, gain: 0.05, bite: 0.85, verb: 0.16 },
    fire: { oscillator: 'sawtooth', cutoff: 5000, gain: 0.036, noise: 0.045 },
    killDecay: 0.24,
  },
  4: {
    // Core: everything the player does rings, because there is nothing left in
    // the room to absorb it.
    lock: { oscillator: 'sine', decay: 0.1, cutoff: 4600, gain: 0.11, bite: 0.6, verb: 0.4 },
    body: { oscillator: 'sine', decay: 0.3, cutoff: 4200, gain: 0.11, bite: 0.6, verb: 0.46 },
    fire: { oscillator: 'triangle', cutoff: 3400, gain: 0.05, noise: 0.028 },
    killDecay: 0.44,
  },
};

const FACE_BAR_SET = new Set(Array.from({ length: FACE_COUNT }, (_, index) => faceBar(index)));

export function createAudio(bus: EventBus) {
  return createSpeedsolveAudio(bus).audio;
}

export const traceSpeedsolveAudio = createAudioTraceHarness({
  level: 'speedsolve-zq4n',
  bpm: SPEEDSOLVE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SPEEDSOLVE_DURATION,
  createAudio: createSpeedsolveAudio,
});

function createSpeedsolveAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let motor: MotorController | null = null;
  let layers = 0;
  let coreId = -1;
  let coreDown = false;
  const kindById = new Map<number, string>();

  const score = createScore<Chord, SectionIndex>({
    bpm: SPEEDSOLVE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: CORE_BAR, chords: CORE_CHORDS, barsPerChord: 1 }],
    sections: SPEEDSOLVE_SCORE_SECTIONS,
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
      compressor: { threshold: -15, ratio: 4.2, attack: 0.003, release: 0.16 },
      delay: { time: SIXTEENTH * 3, feedback: 0.26, dampHz: 3200 },
      reverb: { seconds: 1.5, decay: 3.2, level: 0.32 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      motor = installMotor(context, mix);
      motor.setDrive(context.currentTime + 0.05, 0.16, 2);
      motor.setLayers(context.currentTime + 0.05, 0, 0.1);
    },
    onStep: scheduleStep,
    onRunStart() {
      layers = 0;
      coreId = -1;
      coreDown = false;
      kindById.clear();
      const context = runtime.context();
      if (context && motor) {
        motor.setDrive(context.currentTime + 0.02, 0.5, 0.6);
        motor.setLayers(context.currentTime + 0.02, 0, 0.2);
      }
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context || !motor) return;
      motor.setDrive(context.currentTime + 0.3, 0.12, 2.6);
      motor.setLayers(context.currentTime + 0.3, 0, 2.6);
    },
    onDispose() {
      ctx = null;
      motor = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const musicDestination = () => runtime.mix()?.music ?? runtime.mix()?.master ?? null;

  const voices = createSpeedsolveVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    clack, kick, rim, tick, hat, sub, bass, pluck, stab, pad, servo, turn, thud, crash, riser, buzz,
    noiseHit, playerTone, playerGlass, playerNoise,
  } = voices;

  // ---- arrangement ------------------------------------------------------------

  const blank = '................';
  const four = 'K...K...K...K...';
  const halfFloor = 'K.......K.......';
  const backbeat = '....R.......R...';
  const ratchet = 't.t.t.t.t.t.t.t.';
  const ratchet32 = 'tttttttttttttttt';
  const knockA = 'C.......C...C...';
  const knockB = 'C...C..C..C.C...';
  const hatOff = '..h...h...h...h.';
  const hatDrive = '.h.h.h.h.h.h.h.h';

  /**
   * The machine's structural cues, written straight onto the absolute bar grid.
   * A quarter turn, the cube's bow, and a face letting go always land in the
   * same place in the bar, no matter how the player is doing.
   */
  const machineTrack = fn<Chord>(({ time, bar, step, chord }) => {
    if (step === 0 && FACE_BAR_SET.has(bar) && bar > faceBar(0)) {
      turn(time, 1);
      crash(time, 0.13);
      servo(time, chord.bass + 24, 0.34, 0.85, 1);
    }
    if (FACE_BAR_SET.has(bar - 3)) {
      // +3.375 the cube takes its bow, +3.75 the face lets go.
      if (step === 6) servo(time, chord.bass + 19, 0.4, 0.7, 1);
      if (step === 12) {
        thud(time, 0.85);
        crash(time, 0.22);
      }
    }
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      return CHORDS[Math.floor(Math.floor(position / STEPS_PER_BAR) / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'idle',
        fromBar: 0,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.7, 900)),
          hits('t.......t.......', { t: 0.32 }, ({ time }, vel) => tick(time, vel)),
          hits([blank, '........C.......'].join(''), { C: 0.5 }, ({ time, chord }, vel) => clack(time, chord.arp[0] - 24, vel, 0.4)),
          fn(({ time, step, bar, chord }) => {
            if (step === 8 && bar % 2 === 1) pluck(time, chord.arp[bar % chord.arp.length], 0.5, 2400, 0.3);
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
        // Bar 0: the machine spins up on an empty grid.
        name: 'wake',
        fromBar: 0,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            servo(time, chord.bass + 12, 0.8, 0.9, 1);
            riser(time, 16 * SIXTEENTH, 0.16);
            sub(time, chord.bass, 0.8);
          }),
          hits(ratchet, { t: 0.3 }, ({ time }, vel) => tick(time, vel)),
          hits('..............C.', { C: 0.7 }, ({ time, chord }, vel) => clack(time, chord.arp[0] - 12, vel, 0.6)),
        ],
      },
      {
        // Bars 1–11: the pattern the whole level is built on. Kick, ratchet,
        // and the cube's own knock answering on the offbeat.
        name: 'inspection',
        fromBar: faceBar(0),
        tracks: [
          machineTrack,
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.03, 0.85, 1500)),
          hits([halfFloor, four, four, four, four, four, four, four, four, four].join(''), { K: 0.9 }, ({ time }, vel) => kick(time, vel)),
          hits(ratchet, { t: 0.4 }, ({ time }, vel) => tick(time, vel)),
          hits([blank, knockA].join(''), { C: 0.62 }, ({ time, chord }, vel) => clack(time, chord.arp[1] - 12, vel, 0.55)),
          hits([blank, blank, hatOff].join(''), { h: 0.035 }, ({ time }, vel) => hat(time, vel, 0.028)),
          hits('B..B..B...B.B...', { B: 0.85 }, ({ time, chord }, vel) => bass(time, chord.bass + 12, vel, 1500)),
          hits('S...............', { S: 0.75 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          fn(({ time, step, bar, chord }) => {
            if (bar % 2 === 1 && step % 4 === 2) pluck(time, chord.arp[(step / 2) % chord.arp.length], 0.42, 2600, 0.16);
          }),
        ],
      },
      {
        // Bars 11–21: the fight proper. Backbeat, driving hats, second knock.
        name: 'drive',
        fromBar: faceBar(2),
        tracks: [
          machineTrack,
          oneShot(0, 0, ({ time }) => crash(time, 0.2)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.8, 2100)),
          hits(four, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(backbeat, { R: 0.85 }, ({ time }, vel) => rim(time, vel)),
          hits(ratchet, { t: 0.45 }, ({ time }, vel) => tick(time, vel)),
          hits(hatOff, { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits(knockB, { C: 0.6 }, ({ time, chord }, vel) => clack(time, chord.arp[2] - 12, vel, 0.7)),
          fn(({ time, step, chord }) => {
            const line: Record<number, [number, number]> = { 0: [0, 1], 3: [0, 0.7], 6: [12, 0.6], 8: [0, 0.9], 11: [7, 0.65], 14: [12, 0.7] };
            if (step in line) bass(time, chord.bass + 12 + line[step][0], line[step][1], 2200);
          }),
          hits('S.......S.......', { S: 0.7 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          hits('A.A.A.A.A.A.A.A.', { A: 0.5 }, ({ time, step, chord }, vel) => {
            const order = [0, 2, 1, 3, 2, 0, 3, 1];
            pluck(time, chord.arp[order[(step / 2) % order.length]], vel, 3400, 0.14);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection >= 8 && step % 4 === 0) rim(time, 0.28 + (barInSection - 8) * 0.1);
          }),
        ],
      },
      {
        // Bars 21–31: press. A 32nd ratchet, stabs, the machine wound tight.
        name: 'press',
        fromBar: faceBar(4),
        tracks: [
          machineTrack,
          oneShot(0, 0, ({ time }) => crash(time, 0.24)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH, 0.7, 2600)),
          hits('K...K...K...K..K', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(backbeat, { R: 0.95 }, ({ time }, vel) => rim(time, vel)),
          hits(ratchet32, { t: 0.3 }, ({ time }, vel) => tick(time, vel)),
          hits(hatDrive, { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.024)),
          hits(knockB, { C: 0.7 }, ({ time, chord }, vel) => clack(time, chord.arp[3] - 12, vel, 0.85)),
          hits('B.B..B.B..B.B.B.', { B: 0.85 }, ({ time, chord }, vel) => bass(time, chord.bass + 12, vel, 2900)),
          hits('S.......S...S...', { S: 0.7 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          hits('..X.....X...X...', { X: 0.75 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          oneShot(8, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
        ],
      },
      {
        // Bars 31–36: the naked core. The kit strips back and the room opens.
        name: 'core',
        fromBar: CORE_BAR,
        toBar: END_BAR,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            turn(time, 1.15);
            crash(time, 0.3);
            sub(time, chord.bass - 12, 1);
            servo(time, chord.bass + 24, 0.7, 1, 1);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH, 0.95, 1800)),
          hits(four, { K: 0.95 }, ({ time }, vel) => kick(time, vel)),
          hits(ratchet32, { t: 0.26 }, ({ time }, vel) => tick(time, vel)),
          hits('S.......S.......', { S: 0.85 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          hits('C...C...C...C...', { C: 0.5 }, ({ time, chord }, vel) => clack(time, chord.arp[0] - 12, vel, 1)),
          fn(({ time, step, barInSection }) => {
            // The cage cycle, made audible: a shutter every two bars.
            if (barInSection % 2 === 1 && step === 12) servo(time, 76, 0.28, 0.55, -1);
          }),
          oneShot(2, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.18)),
          // Bar 35: the phrase closes whether or not the core did.
          oneShot(4, 0, ({ time }) => {
            pad(time, RESOLVE.pad, 16 * SIXTEENTH, 1.1, 2400);
            sub(time, RESOLVE.bass, 0.9);
            crash(time, 0.16);
          }),
          oneShot(4, 8, ({ time }) => pluck(time, RESOLVE.arp[3], 0.6, 3200, 0.5)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player instruments --------------------------------------------------------

  function mixedTone(mix: SectionMix<SectionIndex>, slot: 'lock' | 'body', key: keyof ToneVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : 0;
  }

  /** A kill is a written note, not a sound effect: a lane degree over live harmony. */
  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const lead = score.leadSetAt(position);
    const midi = lead[KILL_LANES[laneSection][position % KILL_LANE_STEPS]];
    const vel = Math.min(1.5, 1 + chain * 0.15);
    const decay = lerp(PLAYER_VOICES[mix.from].killDecay, PLAYER_VOICES[mix.to].killDecay, mix.t);
    playerGlass(time, midi, vel, decay);
    for (const [sectionIndex, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi - 12, PLAYER_VOICES[sectionIndex].body, vel * 0.75, weight);
    }
    playerNoise(time, 0.016 + mixedTone(mix, 'body', 'bite') * 0.03, 0.05, 8600);
  }

  /**
   * A solved square. The melody note lands where the kill did; the knock is
   * scheduled onto the next quarter note, which is the same beat the layer
   * rotation is released on — so the machine's snap and the player's shot land
   * as one hit.
   */
  function solveKnock(time: number) {
    const at = score.nextGridTime(time, 4);
    const chord = score.chordAt(score.arrangementPositionAt(at));
    clack(at, chord.arp[0] - 12, 1, 1);
    clack(at + THIRTYSECOND, chord.arp[2] - 12, 0.42, 0.7);
    playerNoise(at, 0.06, 0.02, 5200);
  }

  /** A weakpoint broken: the spindle lets go and the machine leans harder. */
  function faceOff(time: number) {
    const at = score.nextGridTime(time, 2);
    const chord = score.chordAt(score.arrangementPositionAt(at));
    thud(at, 1);
    servo(at, chord.bass + 24, 0.5, 0.85, -1);
    stab(at, chord.stab, 0.9);
    motor?.setDrive(at, Math.min(0.74, 0.5 + layers * 0.045), 1.2);
  }

  /** The finish: duck the room, run the lead set out, and let E major land. */
  function coreFinale(time: number) {
    const mix = runtime.mix();
    coreDown = true;
    mix?.duckAt(time, 0.1, 1.8);
    thud(time, 1.2);
    crash(time, 0.34);
    motor?.setDrive(time, 0, 0.6);

    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    // The confetti: the whole lead set thrown at 32nds, each note knocked.
    lead.forEach((midi, index) => {
      playerGlass(time + 0.02 + index * THIRTYSECOND, midi, 1.1 - index * 0.05, 0.5);
      clack(time + 0.02 + index * THIRTYSECOND, midi - 24, 0.5, 1);
    });
    const chordAt = time + 0.02 + 8 * THIRTYSECOND;
    pad(chordAt, RESOLVE.pad, 12 * SIXTEENTH, 1.4, 3200);
    sub(chordAt, RESOLVE.bass, 1);
    stab(chordAt, RESOLVE.arp, 1.1);
    playerGlass(chordAt + 4 * SIXTEENTH, RESOLVE.arp[3] + 12, 0.7, 1.2);
  }

  // ---- event wiring ---------------------------------------------------------------

  bus.on('spawn', ({ enemyId, kind }) => {
    kindById.set(enemyId, kind);
    if (!ctx) return;
    if (kind === 'core') {
      coreId = enemyId;
      const time = score.nextGridTime(ctx.currentTime, 2);
      runtime.mix()?.duckAt(time, 0.4, 0.8);
      turn(time, 1.1);
      riser(time, 1.6, 0.18);
    } else if (kind === 'weak') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      servo(time, score.chordAt(score.arrangementPositionAt(time)).bass + 26, 0.3, 0.6, 1);
    } else if (kind === 'prism') {
      const time = score.nextGridTime(ctx.currentTime, 2);
      pluck(time, score.leadSetAt(score.arrangementPositionAt(time))[1] - 12, 0.4, 1500, 0.18);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    for (const [sectionIndex, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[sectionIndex].lock, 1, weight);
    }
    playerNoise(time, 0.01 + mixedTone(mix, 'lock', 'bite') * 0.024, 0.014, 11000);
    // Six locks is a full move charged: the cube's own knock answers it.
    if (lockCount >= 6) {
      clack(time, score.chordAt(position).arp[0] - 12, 0.55, 0.9);
      playerGlass(time + THIRTYSECOND, midi + 12, 0.45, 0.2);
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
    for (const [sectionIndex, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fire = PLAYER_VOICES[sectionIndex].fire;
      playerTone(time, midi, {
        oscillator: fire.oscillator,
        decay: 0.055,
        cutoff: fire.cutoff,
        gain: fire.gain,
        bite: 0.5,
        verb: 0.05,
      }, weight);
    }
    playerNoise(time, lerp(PLAYER_VOICES[mix.from].fire.noise, PLAYER_VOICES[mix.to].fire.noise, mix.t), 0.02, 6200);
  });

  bus.on('hit', ({ lethal, enemyId }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (enemyId === coreId) {
      // Core armor: every chip is brighter and higher than the last.
      const heat = Math.min(1, layers / FACE_COUNT + 0.2);
      clack(time, chord.arp[0] - 12 + Math.round(heat * 7), 1.1, 1);
      playerGlass(time + THIRTYSECOND, chord.arp[3] + 12, 0.55 + heat * 0.4, 0.24);
      noiseHit(time, 0.12, 0.09, 'bandpass', 2600 + heat * 3200, output);
      return;
    }
    clack(time, chord.stab[1] - 12, 0.42, 0.35);
    playerNoise(time, 0.03, 0.024, 6400);
  });

  bus.on('stage', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    thud(time, 0.7);
    servo(time, chord.bass + 24, 0.36, 0.8, 1);
    stab(time, chord.stab, 0.8);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kind = kindById.get(enemyId);
    kindById.delete(enemyId);
    if (kind === 'core' && !coreDown) {
      coreFinale(score.nextGridTime(ctx.currentTime, 2));
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    if (kind === 'pip') solveKnock(kill.time);
    if (kind === 'weak') faceOff(kill.time);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const chord = score.chordAt(position);
    stab(time, chord.stab, size >= 6 ? 1.1 : 0.7);
    if (size >= 6) {
      [0, 2, 4, 7].forEach((degree, index) => {
        playerGlass(time + index * THIRTYSECOND, lead[degree], 0.7 - index * 0.08, 0.3);
      });
      sub(time, chord.bass, 0.7);
    }
  });

  bus.on('reject', () => {
    // The machine jams: a dead relay buzz with no pitch worth naming.
    if (!ctx) return;
    buzz(ctx.currentTime, 0.16);
    buzz(ctx.currentTime + 0.075, 0.1);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // A square the machine took back: a dry unlatch, deliberately unmusical.
    noiseHit(ctx.currentTime, 0.07, 0.05, 'bandpass', 1500, output);
    playerTone(ctx.currentTime, 45, PLAYER_VOICES[0].lock, 0.32, 1);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    thud(time, 1);
    buzz(time + 0.1, 0.12);
    noiseHit(time, 0.18, 0.16, 'lowpass', 800, output);
    playerTone(time + 0.05, chord.bass + 13, PLAYER_VOICES[3].lock, 0.5, 1);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'exposed') {
      // A face conquered is a layer gained. This hangs off the skin coming off
      // rather than off the weakpoint kill, so the arrangement thickens on the
      // level's own clock and a six-layer motor is what a finished solve
      // sounds like no matter how the fight went.
      const time = score.nextGridTime(ctx.currentTime, 2);
      layers = Math.min(FACE_COUNT, layers + 1);
      motor?.setLayers(time, layers, 1.3);
    }
    if (phase === 'summoned') {
      const time = score.nextGridTime(ctx.currentTime, 2);
      motor?.setDrive(time, 0.72, 0.8);
      if (musicDestination()) noiseHit(time, 0.2, 0.5, 'bandpass', 1200, musicDestination()!);
    }
  });

  return runtime;
}
