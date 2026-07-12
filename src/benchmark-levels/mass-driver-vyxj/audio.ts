import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  createMassDriverVoices,
  installMassDriverHum,
  HUM_IDLE_LEVEL,
  HUM_RUN_LEVEL,
  type HumController,
  type MassDriverTonalVoice,
} from './audio-voices';
import {
  MASS_DRIVER_BARS,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  MASS_DRIVER_TIME,
} from './timing';

// The Mass Driver score: 128 BPM electro at 4/4, 32 bars = exactly the
// 60-second run. The gun is the instrument. Its hum — sub sine plus coil
// whine — steps up a two-octave E-minor ladder, one rung every two bars,
// from E1 at injection to E4 at the muzzle; the harmony rides the ladder
// (Em G Am Bm C D, twice around, closing G → Bm → Em). A ring-crossing
// tick plays on every beat because the payload crosses a ring on every
// beat: the pulse of the music is the geometry of the barrel. Locks,
// shots, and kills are notes in the live harmony; kills walk hidden
// per-section melodic lanes so a chained volley plays a run.

const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; sub: number; pad: number[]; arp: number[]; stab: number[] };

type Quality = 'Em' | 'G' | 'Am' | 'Bm' | 'C' | 'D';

const QUALITIES: Record<Quality, Pick<Chord, 'pad' | 'arp' | 'stab'>> = {
  Em: { pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] },
  G: { pad: [55, 59, 62, 67], arp: [67, 71, 74, 79], stab: [67, 71, 74] },
  Am: { pad: [57, 60, 64, 69], arp: [69, 72, 76, 81], stab: [69, 72, 76] },
  Bm: { pad: [59, 62, 66, 71], arp: [71, 74, 78, 83], stab: [71, 74, 78] },
  C: { pad: [60, 64, 67, 72], arp: [72, 76, 79, 84], stab: [72, 76, 79] },
  D: { pad: [62, 66, 69, 74], arp: [74, 78, 81, 86], stab: [74, 78, 81] },
};

// One rung every two bars: bass climbs two octaves; sub folds it back down
// so the low end never leaves the floor.
const LADDER: Array<[number, Quality]> = [
  [28, 'Em'], [31, 'G'], [33, 'Am'], [35, 'Bm'], [36, 'C'], [38, 'D'],
  [40, 'Em'], [43, 'G'], [45, 'Am'], [47, 'Bm'], [48, 'C'], [50, 'D'],
  [52, 'Em'], [55, 'G'], [59, 'Bm'], [64, 'Em'],
];

const CHORDS: Chord[] = LADDER.map(([bass, quality]) => {
  let sub = bass;
  while (sub > 39) sub -= 12;
  return { bass, sub, ...QUALITIES[quality] };
});

type SectionIndex = 0 | 1 | 2 | 3;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Injection / stage 1: patient arches while the barrel wakes.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 2, 1,
    0, 2, 4, 6, 4, 2, 3, 4,
  ],
  // Stage 2: jump-cut broken chords for dense wheeling traffic.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    7, 6, 5, 4, 3, 2, 1, 0,
  ],
  // Alarm / charge: urgent high fragments over the klaxon and the climb.
  2: [
    4, 5, 6, 7, 6, 5, 4, 5,
    6, 7, 5, 6, 7, 6, 5, 4,
    5, 6, 7, 6, 4, 5, 6, 7,
    7, 5, 6, 4, 5, 3, 4, 2,
  ],
  // Muzzle: sparse glassy tolls in open space.
  3: [
    7, 5, 6, 4, 7, 5, 6, 4,
    6, 4, 5, 3, 6, 4, 5, 3,
    7, 6, 5, 4, 3, 2, 1, 0,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: MassDriverTonalVoice; kill: MassDriverTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.1, cutoff: 3400, gain: 0.12, sparkle: 0.45, reverb: 0.16 },
    kill: { oscillator: 'triangle', decay: 0.26, cutoff: 3200, gain: 0.15, sparkle: 0.6, reverb: 0.24 },
    fire: { oscillator: 'triangle', cutoff: 3200, gain: 0.07, fallSemitones: 12, noise: 0.035 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.09, cutoff: 4000, gain: 0.1, sparkle: 0.5, reverb: 0.15 },
    kill: { oscillator: 'square', decay: 0.19, cutoff: 3400, gain: 0.1, sparkle: 0.6, reverb: 0.2 },
    fire: { oscillator: 'sawtooth', cutoff: 4200, gain: 0.06, fallSemitones: 9, noise: 0.05 },
  },
  2: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 3000, gain: 0.05, sparkle: 0.4, reverb: 0.18 },
    kill: { oscillator: 'sawtooth', decay: 0.22, cutoff: 4400, gain: 0.12, sparkle: 0.8, reverb: 0.26 },
    fire: { oscillator: 'sawtooth', cutoff: 5200, gain: 0.065, fallSemitones: 12, noise: 0.06 },
  },
  3: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 5200, gain: 0.1, sparkle: 0.55, reverb: 0.5 },
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 5200, gain: 0.13, sparkle: 0.5, reverb: 0.6 },
    fire: { oscillator: 'triangle', cutoff: 2800, gain: 0.04, fallSemitones: 10, noise: 0.02 },
  },
};

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-vyxj',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let hum: HumController | null = null;
  let interlockAudioIds = new Set<number>();
  let interlocksDown = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: MASS_DRIVER_SCORE_SECTIONS,
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
      compressor: { threshold: -16, ratio: 5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2300 },
      reverb: { seconds: 2.3, decay: 2.5, level: 0.45 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      hum = installMassDriverHum(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockAudioIds = new Set();
      interlocksDown = 0;
      const context = runtime.context();
      if (context && hum) hum.setLevel(context.currentTime, HUM_RUN_LEVEL, 0.8);
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context || !hum) return;
      hum.setLevel(context.currentTime + 0.1, HUM_IDLE_LEVEL, 2.4);
      hum.setNote(context.currentTime + 1.2, 28, 0.04);
    },
    onDispose() {
      ctx = null;
      hum = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler --------------------------------------------------------------

  const blankBar = '................';
  const ringBeat = 'R...R...R...R...';
  const padTwoBars = 'P...............' + blankBar;
  const fourFloor = 'K...K...K...K...';
  const clapTwoFour = '....S.......S...';
  const heat = (barIndex: number) => Math.min(1, Math.max(0, barIndex / 30));

  const humTrack = fn<Chord>(({ time, step, bar, chord }) => {
    if (step === 0 && bar % 2 === 0) hum2(time, chord.bass, heat(bar));
  });
  const ringTrack = hits<Chord>(ringBeat, { R: 1 }, ({ time, bar }) => ringPass(time, heat(bar), 0.85));
  const padTrack = (vel: number) =>
    hits<Chord>(padTwoBars, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, vel));

  const driveBassTrack = fn<Chord>(({ time, step, chord }) => {
    const steps: Record<number, [number, number]> = {
      0: [0, 1], 2: [0, 0.6], 4: [0, 0.85], 6: [7, 0.7], 8: [0, 0.95], 10: [0, 0.6], 12: [3, 0.75], 14: [7, 0.65],
    };
    if (step in steps) subBass(time, chord.sub + steps[step][0], steps[step][1], 0.14);
  });

  const arpOrder = [0, 1, 2, 3, 2, 1, 3, 0];

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const barIndex = Math.floor(position / STEPS_PER_BAR);
      return Math.floor(barIndex / 2) % 2 === 0 ? CHORDS[0] : CHORDS[4];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          hits(padTwoBars, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.55)),
          hits(ringBeat, { R: 1 }, ({ time }) => ringPass(time, 0, 0.35)),
          fn(({ time, step, bar }) => {
            if (step === 0 && bar % 4 === 0) hum2(time, 28, 0.04);
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
        name: 'injection',
        fromBar: MASS_DRIVER_BARS.injection,
        tracks: [
          humTrack,
          ringTrack,
          padTrack(0.6),
          fn(({ time, step, bar }) => {
            if (bar >= 2 && step === 0) kick(time, 0.55);
          }),
          fn(({ time, step, bar }) => {
            if (bar >= 2 && step % 4 === 2) hat(time, 0.028, 0.018);
          }),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.16)),
        ],
      },
      {
        name: 'stage-1',
        fromBar: MASS_DRIVER_BARS.stage1,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 0.9)),
          humTrack,
          ringTrack,
          padTrack(0.5),
          hits(fourFloor, { K: 0.95 }, ({ time }, vel) => kick(time, vel)),
          hits('..h...h...h...h.', { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits('B.b.b.b.B.b.b.b.', { B: 0.95, b: 0.6 }, ({ time, chord }, vel) => subBass(time, chord.sub, vel, 0.16)),
          fn(({ time, step, barInSection }) => {
            if (barInSection >= 4 && (step === 4 || step === 12)) clap(time, 0.5);
          }),
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection >= 4 && step % 4 === 2) arp(time, chord.arp[((step - 2) / 4) % 4], 0.5, 2200);
          }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'stage-2',
        fromBar: MASS_DRIVER_BARS.stage2,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.05);
            crash(time, 0.3);
          }),
          humTrack,
          ringTrack,
          padTrack(0.4),
          hits(fourFloor, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(clapTwoFour, { S: 0.75 }, ({ time }, vel) => clap(time, vel)),
          hits('hchchchchchchchc', { h: 0.055, c: 0.028 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'h' ? 0.03 : 0.017)),
          fn(({ time, step, bar }) => {
            if (bar % 2 === 1 && step === 2) openHat(time, 0.09);
          }),
          driveBassTrack,
          fn(({ time, step, bar, chord }) => {
            if (step % 2 !== 0) return;
            const cutoff = 1600 + heat(bar) * 2400;
            arp(time, chord.arp[arpOrder[(step / 2) % 8]], 0.6, cutoff);
          }),
          hits('S...............' + blankBar, { S: 0.6 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.24)),
        ],
      },
      {
        name: 'alarm',
        fromBar: MASS_DRIVER_BARS.alarm,
        tracks: [
          humTrack,
          ringTrack,
          padTrack(0.7),
          hits('K...............', { K: 0.6 }, ({ time }, vel) => kick(time, vel)),
          fn(({ time, step }) => {
            if (step === 0) alarm(time, 69, 8 * SIXTEENTH, 0.75);
          }),
          hits('h.h.h.h.h.h.h.h.', { h: 0.022 }, ({ time }, vel) => hat(time, vel, 0.014)),
          fn(({ time, step, chord }) => {
            if (step % 2 === 0) arp(time, chord.arp[(step / 2) % 4] + 12, 0.32, 2800);
          }),
          oneShot(2, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.3)),
        ],
      },
      {
        name: 'charge',
        fromBar: MASS_DRIVER_BARS.boss,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.2);
            crash(time, 0.35);
          }),
          humTrack,
          ringTrack,
          hits(fourFloor, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          fn(({ time, step, barInSection }) => {
            if (barInSection >= 4 && (step === 6 || step === 14)) kick(time, 0.55);
          }),
          hits(clapTwoFour, { S: 0.85 }, ({ time }, vel) => clap(time, vel)),
          fn(({ time, step }) => {
            if (step === 15) clap(time, 0.28);
          }),
          hits('hchchchchchchchc', { h: 0.06, c: 0.032 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'h' ? 0.03 : 0.017)),
          fn(({ time, step }) => {
            if (step === 2) openHat(time, 0.085);
          }),
          fn(({ time, step, chord }) => {
            if (step % 2 !== 0) return;
            const push = step === 6 || step === 14 ? 7 : 0;
            subBass(time, chord.sub + push, step % 4 === 0 ? 0.95 : 0.7, 0.13);
          }),
          fn(({ time, step, chord }) => {
            if (step % 2 === 0) arp(time, chord.arp[arpOrder[(step / 2) % 8]] + (step % 4 === 2 ? 12 : 0), 0.5, 4200);
          }),
          hits('S...............', { S: 0.7 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          // The charge itself: a riser under every bar, each hotter than the last.
          fn(({ time, step, barInSection }) => {
            if (step === 0) riser(time, 16 * SIXTEENTH, 0.045 + barInSection * 0.02);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 5 && step >= 8) clap(time, 0.22 + (step - 8) * 0.05);
          }),
        ],
      },
      {
        name: 'muzzle',
        fromBar: MASS_DRIVER_BARS.muzzle,
        toBar: MASS_DRIVER_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time }) => muzzleFire(time)),
          oneShot(1, 0, ({ time }) => arp(time, 88, 0.22, 4800)),
          oneShot(1, 8, ({ time }) => arp(time, 83, 0.16, 4200)),
        ],
      },
    ],
  });

  // The gun fires: one massive discharge, then the music steps aside —
  // everything after this is meant to feel weightless.
  function muzzleFire(time: number) {
    runtime.mix()?.duckAt(time, 0.06, 2.4);
    humLevel(time, 0, 0.3);
    impact(time, 1.5);
    crash(time, 0.55);
    shimmer(time + 0.5, [76, 79, 83, 88], 5.4, 0.9);
  }

  function scheduleStep({ position, time, mode }: { position: number; time: number; mode: 'ambient' | 'run' }) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices -------------------------------------------------------------------

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix }, () => hum);
  const {
    kick, clap, hat, openHat, crash, subBass, stab, pad, arp, ringPass, alarm, clang, riser, impact, shimmer,
    hum: hum2, humLevel, noiseHit, playerSends, playerTone, playerNoise,
  } = voices;

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
    oscillators: [{ type: 'sine', octave: 1, gain: 0.32 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.18 }],
    duration: 0.16,
    stopPadding: 0.04,
    envelope: { decay: 0.16 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.07,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.07 },
  });

  const hitTriangleVoice = voice<{ cutoff: number; gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  // Rejection: a breaker trips. Heavy relay thunk, then a dead two-blip
  // power-down a minor second apart — cold machinery refusing the command.
  const rejectThunkVoice = voice({
    oscillators: [{ type: 'square', gain: 0.2 }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 500 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.5, time: time + 0.12 }],
    envelope: { decay: 0.14 },
  });

  const rejectBlipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'bandpass', frequency: 850, Q: 5 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.45 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const playerHitArcVoice = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.07 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'highpass', frequency: 1200 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.35, time: time + 0.15 }],
    envelope: { decay: 0.16 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.11,
    stopPadding: 0.02,
    envelope: { decay: 0.11 },
  });

  // ---- player instruments -------------------------------------------------------
  // Every positive action snaps to the transport, reads the live rung of the
  // ladder, and sends tails into the same delay/hall as the arrangement.

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof MassDriverTonalVoice) {
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
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.5, 0.18) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.025 + sparkle * 0.05, 0.08, 7400);
  }

  // Interlock kills escalate: each clang lands higher and harder, and the
  // sixth resolves into an all-clear sweep up the live lead set.
  function interlockBlow(time: number, downed: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    clang(time, 50 + downed * 3, 0.85 + downed * 0.06, 0.5);
    playerNoise(time, 0.14, 0.12, 3200);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    playerTone(time + THIRTYSECOND, leadSet[Math.min(7, 2 + downed)], PLAYER_VOICES[2].kill, 0.8 + downed * 0.06, 1);
    if (downed >= 6) {
      runtime.mix()?.duckAt(time, 0.3, 0.9);
      riser(time, 0.9, 0.2);
      leadSet.forEach((midi, index) => {
        playerTone(time + index * THIRTYSECOND, midi, PLAYER_VOICES[2].kill, 0.85 - index * 0.06, 1);
      });
    }
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
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.014 + sparkle * 0.032, 0.022, 9200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      // Sixth lock: the breech seats — a low thump under a bright octave.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).sub + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).sub), time: time + 0.13 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).sub + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.32, 1);
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
      const sectionFire = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: sectionFire.oscillator,
        cutoff: sectionFire.cutoff,
        gainValue: sectionFire.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - sectionFire.fallSemitones), time: time + 0.058 }],
        destination: output,
        sends: playerSends(0.16, 0.08),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.024, 5200);
  });

  bus.on('hit', ({ lethal, enemyId }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (interlockAudioIds.has(enemyId)) {
      // Casing cracked, not yet clear: a duller clang than the kill.
      clang(time, 45, 0.55, 0.3);
      playerNoise(time, 0.1, 0.08, 2800);
      return;
    }
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      hitTriangleVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        cutoff: 3600,
        gainValue: 0.05 - index * 0.008,
        decay: 0.08,
        destination: output,
        sends: playerSends(0.2, 0.16),
      });
    }
    playerNoise(time, 0.04, 0.03, 6000);
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    if (interlockAudioIds.has(enemyId)) {
      clang(time, 47, 0.7, 0.4);
      riser(time, 0.5, 0.08);
      playerNoise(time, 0.16, 0.1, 2400);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (interlockAudioIds.delete(enemyId)) {
      interlocksDown += 1;
      interlockBlow(kill.time, interlocksDown);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.9 : 0.68);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.58 - index * 0.06, 1);
    });
    if (size >= 6) openHat(time, 0.1);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    rejectThunkVoice.play({ context: ctx, time, frequency: 96, destination: output });
    for (const [midiFreq, at, vel] of [[740, time + 0.07, 0.1], [698, time + 0.16, 0.07]] as const) {
      rejectBlipVoice.play({ context: ctx, time: at, frequency: midiFreq, vel, destination: output });
    }
    noiseHit(time, 0.12, 0.07, 'bandpass', 560, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Arc shock: a bright electric crack over a sub boom.
    playerNoise(time, 0.22, 0.05, 3800);
    playerHitArcVoice.play({ context: ctx, time, frequency: 2600, destination: output });
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.sub + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.sub), time: time + 0.3 }],
      destination: output,
    });
    noiseHit(time, 0.18, 0.15, 'bandpass', 900, output);
  });

  bus.on('miss', ({ enemyId }) => {
    // Interlocks are only ever "missed" when the barrel detonates; that
    // moment has its own sound.
    if (interlockAudioIds.delete(enemyId)) return;
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.sub + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.sub + 12), time: time + 0.1 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx || kind !== 'interlock') return;
    interlockAudioIds.add(enemyId);
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (interlockAudioIds.size === 1) {
      // The jammed collar looms out of the fog: klaxon and a long riser.
      alarm(time, 69, 1.1, 1);
      riser(time, 2.2, 0.18);
    }
    clang(time, 41 + interlockAudioIds.size, 0.3, 0.2);
  });

  bus.on('runend', ({ died }) => {
    if (!ctx) return;
    const time = ctx.currentTime + 0.05;
    if (died) {
      // The barrel blows: one dead detonation, no music left standing.
      runtime.mix()?.duckAt(time, 0.04, 3.5);
      impact(time, 1.5);
      crash(time + 0.05, 0.7);
      const output = sfxDestination();
      if (output) noiseHit(time, 0.4, 1.4, 'lowpass', 300, output);
    } else {
      pad(time, [52, 59, 64, 67, 71], 5.5, 0.85);
    }
  });

  return runtime;
}
