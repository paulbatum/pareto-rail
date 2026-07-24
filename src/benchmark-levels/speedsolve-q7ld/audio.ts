import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot, type ArrangementSection, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSpeedsolveVoices, type SpeedTonalVoice } from './audio-voices';
import {
  SPEEDSOLVE_BARS,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_DURATION,
  SPEEDSOLVE_SCORE_SECTIONS,
  SPEEDSOLVE_STEPS_PER_BAR,
  SPEEDSOLVE_TIME,
} from './timing';

// The Speedsolve score: 128 BPM, C major, 32 bars = exactly 60 seconds, and
// the cube is the percussion section. Every drum is a click, snap, or ratchet;
// every layer rotation the player triggers lands its snap on the next beat, so
// solving IS drumming. The arrangement adds one layer per conquered face —
// clock, kick, hats-and-snap, sequencer, lead, full machine — then the core
// act turns the same machine minor and urgent, and the coda either bursts into
// music-box confetti or powers down unresolved. Locks, shots, chips, and kills
// are all notes: transport-quantized, tuned to the live chord, with hidden
// per-section kill-melody lanes so a chained volley performs a run.

const SIXTEENTH = SPEEDSOLVE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SPEEDSOLVE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// C — F — Am — G, one bar each: a bright, certain loop that cadences into
// every face section.
const CHORDS: Chord[] = [
  { bass: 36, pad: [55, 60, 64, 67], arp: [72, 76, 79, 83], stab: [72, 76, 79] }, // Cmaj7
  { bass: 29, pad: [53, 57, 60, 65], arp: [69, 72, 77, 81], stab: [69, 72, 77] }, // F
  { bass: 33, pad: [52, 57, 60, 64], arp: [69, 72, 76, 79], stab: [69, 72, 76] }, // Am7
  { bass: 31, pad: [50, 55, 59, 62], arp: [67, 71, 74, 79], stab: [67, 71, 74] }, // G
];
// Core act: Am — F — Am — E. The relative minor of the same machine, with the
// dominant's G# as the thing that will not resolve until the core does.
const CORE_CHORDS: Chord[] = [
  CHORDS[2],
  { bass: 29, pad: [53, 57, 60, 65], arp: [69, 72, 77, 81], stab: [69, 72, 77] }, // F
  CHORDS[2],
  { bass: 28, pad: [52, 56, 59, 64], arp: [68, 71, 76, 80], stab: [68, 71, 76] }, // E
];
// Coda: C add9 — arrival, or at least the machine at rest.
const CODA_CHORDS: Chord[] = [
  { bass: 36, pad: [60, 64, 67, 74], arp: [72, 76, 79, 86], stab: [72, 76, 79] },
];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Face 1: plain ascending steps — the solver finds the pattern.
  0: [
    0, 1, 2, 3, 2, 3, 4, 5,
    4, 5, 6, 7, 6, 5, 4, 3,
    2, 3, 4, 5, 4, 5, 6, 7,
    6, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Face 2: alternating skips.
  1: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 6, 5, 7, 6, 4, 5, 3,
    0, 2, 1, 3, 2, 4, 3, 5,
    6, 4, 7, 5, 6, 4, 2, 0,
  ],
  // Face 3: arches.
  2: [
    0, 3, 5, 7, 5, 3, 1, 4,
    6, 4, 2, 5, 7, 5, 3, 0,
    2, 5, 7, 4, 6, 3, 5, 2,
    4, 7, 5, 3, 4, 2, 3, 1,
  ],
  // Face 4: syncopated jump-cuts.
  3: [
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 1, 5, 2, 6, 3, 7,
    5, 1, 6, 2, 7, 3, 4, 0,
    7, 3, 6, 2, 5, 1, 4, 2,
  ],
  // Face 5: high sprints.
  4: [
    4, 5, 6, 7, 6, 5, 6, 7,
    5, 6, 7, 6, 7, 5, 4, 6,
    7, 6, 5, 6, 4, 5, 6, 7,
    6, 7, 5, 6, 7, 6, 5, 4,
  ],
  // Face 6: the full run — wide leaps, no hesitation.
  5: [
    0, 4, 7, 3, 6, 2, 5, 7,
    4, 0, 6, 2, 7, 3, 5, 1,
    7, 4, 6, 3, 5, 2, 4, 6,
    5, 7, 4, 6, 3, 5, 7, 4,
  ],
  // Core: tolling descents while the machine fights back.
  6: [
    7, 6, 5, 4, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
    5, 4, 3, 2, 3, 2, 1, 0,
    3, 2, 1, 0, 2, 1, 0, 1,
  ],
  // Coda: settling home.
  7: [
    4, 3, 2, 1, 2, 1, 0, 1,
    2, 3, 4, 3, 2, 1, 0, 0,
    3, 2, 1, 0, 1, 0, 1, 2,
    3, 2, 1, 0, 0, 1, 2, 3,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };
type PlayerVoiceSet = { lock: SpeedTonalVoice; kill: SpeedTonalVoice; fire: FireVoice };

// One voice family — a plastic sequencer pluck — that gains brightness with
// every conquered face, turns pressurized for the core, and softens to glass
// for the coda.
function faceVoices(level: number): PlayerVoiceSet {
  const t = level / 5;
  return {
    lock: { oscillator: 'triangle', decay: 0.085, cutoff: 2400 + t * 1700, gain: 0.105, sparkle: 0.35 + t * 0.35, reverb: 0.14 + t * 0.08 },
    kill: { oscillator: t > 0.55 ? 'square' : 'triangle', decay: 0.22 + t * 0.08, cutoff: 2800 + t * 1900, gain: t > 0.55 ? 0.085 : 0.13, sparkle: 0.5 + t * 0.35, reverb: 0.2 + t * 0.1 },
    fire: { oscillator: 'triangle', cutoff: 2700 + t * 900, gain: 0.06, fallSemitones: 9 + t * 3, noise: 0.04 },
  };
}

const PLAYER_VOICES: Record<SectionIndex, PlayerVoiceSet> = {
  0: faceVoices(0),
  1: faceVoices(1),
  2: faceVoices(2),
  3: faceVoices(3),
  4: faceVoices(4),
  5: faceVoices(5),
  // Core: the same machine under pressure — darker, close, heavier tails.
  6: {
    lock: { oscillator: 'square', decay: 0.1, cutoff: 1900, gain: 0.055, sparkle: 0.25, reverb: 0.3 },
    kill: { oscillator: 'square', decay: 0.3, cutoff: 2100, gain: 0.09, sparkle: 0.4, reverb: 0.36 },
    fire: { oscillator: 'square', cutoff: 1800, gain: 0.045, fallSemitones: 13, noise: 0.03 },
  },
  // Coda: music-box glass.
  7: {
    lock: { oscillator: 'sine', decay: 0.14, cutoff: 3200, gain: 0.1, sparkle: 0.6, reverb: 0.5 },
    kill: { oscillator: 'sine', decay: 0.45, cutoff: 3400, gain: 0.13, sparkle: 0.75, reverb: 0.55 },
    fire: { oscillator: 'sine', cutoff: 2400, gain: 0.04, fallSemitones: 8, noise: 0.015 },
  },
};

export function createAudio(bus: EventBus) {
  return createSpeedsolveAudio(bus).audio;
}

export const traceSpeedsolveAudio = createAudioTraceHarness({
  level: 'speedsolve-q7ld',
  bpm: SPEEDSOLVE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SPEEDSOLVE_DURATION,
  createAudio: createSpeedsolveAudio,
});

function createSpeedsolveAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const enemyKinds = new Map<number, string>();
  const panelFaces = new Map<number, number>();
  const panelKillsByFace = [0, 0, 0, 0, 0, 0];
  let coreId = -1;
  let coreKilled = false;
  const CORE_TOTAL_HP = 14; // hitStages [4, 4, 6]

  const score = createScore<Chord, SectionIndex>({
    bpm: SPEEDSOLVE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 1,
    alternateChordSets: [
      { fromBar: SPEEDSOLVE_BARS.core, toBar: SPEEDSOLVE_BARS.coda, chords: CORE_CHORDS, barsPerChord: 1 },
      { fromBar: SPEEDSOLVE_BARS.coda, chords: CODA_CHORDS, barsPerChord: 1 },
    ],
    sections: SPEEDSOLVE_SCORE_SECTIONS,
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
      compressor: { threshold: -16, ratio: 4.5, attack: 0.004, release: 0.18 },
      delay: { time: SIXTEENTH * 3, feedback: 0.26, dampHz: 3400 },
      reverb: { seconds: 2.1, decay: 2.6, level: 0.38 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      enemyKinds.clear();
      panelFaces.clear();
      panelKillsByFace.fill(0);
      coreId = -1;
      coreKilled = false;
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, [60, 64, 67, 74], 5, 0.7, 1500);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement -----------------------------------------------------------

  const voices = createSpeedsolveVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, click, tick, hat, openHat, snap, clack, ratchet, bass, subPulse, pad, pluck, bell, chime, stab, alarm,
    riser, crash, impact, vent, glitter, noiseHit, playerSends, playerTone, playerNoise,
  } = voices;

  const clickFloor = 'C...C...C...C...';
  const tickEights = 't.t.t.t.t.t.t.t.';
  const hatOff = '..h...h...h...h.';
  const snapBack = '....S.......S...';
  const kickFloor = 'K...K...K...K...';

  // The melodic hook the lead plays from face 5 on: one bar, restated over
  // each chord so it retunes as the progression moves.
  const HOOK: Array<[step: number, arpIndex: number, octave: number]> = [
    [0, 0, 0], [3, 2, 0], [6, 1, 0], [10, 3, 0], [12, 2, 0], [14, 1, 0],
  ];

  // One face section = the same machine with `level` layers switched on.
  function faceTracks(level: number): Array<ArrangementTrack<Chord>> {
    const tracks: Array<ArrangementTrack<Chord>> = [
      hits(clickFloor, { C: 0.5 + level * 0.05 }, ({ time }, vel) => click(time, vel)),
      hits(tickEights, { t: 0.24 }, ({ time }, vel) => tick(time, vel)),
      hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.03, 0.55 + level * 0.05, 1050 + level * 130)),
      hits('B.......B.......', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, level >= 2 ? 0.5 : 0)),
      // The last half-bar of every face is the swing: a click roll winds the
      // mechanism over to the next face, right on the grid.
      fn(({ time, step, barInSection }) => {
        if (barInSection === 3 && step >= 12) click(time, 0.35 + (step - 12) * 0.14);
        if (barInSection === 3 && step === 14) openHat(time, 0.05);
      }),
      oneShot(3, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.1 + level * 0.015)),
    ];
    if (level >= 1) {
      tracks.push(
        hits(kickFloor, { K: 0.85 }, ({ time }, vel) => kick(time, vel)),
        hits('B..b....B..b....', { B: 0, b: 0.55 }, ({ time, chord }, vel) => { if (vel > 0) bass(time, chord.bass + 12, vel, 0.3); }),
      );
    }
    if (level >= 2) {
      tracks.push(
        hits(hatOff, { h: 0.04 }, ({ time }, vel) => hat(time, vel)),
        hits(snapBack, { S: 0.6 + level * 0.06 }, ({ time }, vel) => snap(time, vel)),
        oneShot(0, 0, ({ time, chord }) => stab(time, chord.stab, 0.9)),
      );
    }
    if (level >= 3) {
      tracks.push(
        hits('A.A.A.A.A.A.A.A.', { A: 0.5 }, ({ time, step, chord }, vel) => {
          const order = [0, 2, 1, 3];
          pluck(time, chord.arp[order[(step / 2) % 4]] - 12, vel, 2300 + level * 300);
        }),
      );
    }
    if (level >= 4) {
      tracks.push(
        fn(({ time, step, chord }) => {
          for (const [hookStep, arpIndex, octave] of HOOK) {
            if (step === hookStep) pluck(time, chord.arp[arpIndex] + octave * 12, 0.62, 3600);
          }
        }),
        hits('..............o.', { o: 0.05 }, ({ time }, vel) => openHat(time, vel)),
      );
    }
    if (level >= 5) {
      tracks.push(
        hits('tttttttttttttttt', { t: 0.1 }, ({ time }, vel) => tick(time, vel)),
        fn(({ time, step, chord }) => { if (step === 8) clack(time, chord.stab[0] + 12, 0.4); }),
      );
    }
    return tracks;
  }

  const runSections: Array<ArrangementSection<Chord>> = [0, 1, 2, 3, 4, 5].map((face) => ({
    name: `face-${face + 1}`,
    fromBar: face * 4,
    tracks: [
      ...faceTracks(face),
      // The hatch deadline: if the face was not fully solved, the machinery
      // forces it open with a dull mechanical release instead of a fanfare.
      fn(({ time, step, barInSection }) => {
        if (barInSection === 2 && step === 8 && panelKillsByFace[face] < 4) {
          clack(time, 41, 0.9);
          clack(time + 0.07, 34, 0.6);
          vent(time + 0.05, 0.8);
        }
      }),
    ],
  }));

  runSections.push(
    {
      name: 'core',
      fromBar: SPEEDSOLVE_BARS.core,
      tracks: [
        oneShot(0, 0, ({ time }) => {
          impact(time, 1.25);
          crash(time, 0.28);
        }),
        hits(kickFloor, { K: 1 }, ({ time }, vel) => kick(time, vel)),
        hits('S.......S.......', { S: 0.8 }, ({ time, chord }, vel) => subPulse(time, chord.bass, vel)),
        hits('t..t..t.t..t..t.', { t: 0.4 }, ({ time }, vel) => tick(time, vel)),
        hits(snapBack, { S: 0.75 }, ({ time }, vel) => snap(time, vel)),
        hits('A.A.A.A.A.A.A.A.', { A: 0.5 }, ({ time, step, chord }, vel) => {
          const order = [3, 1, 2, 0];
          pluck(time, chord.arp[order[(step / 2) % 4]] - 12, vel, 2100);
        }),
        oneShot(0, 0, ({ time, chord }) => stab(time, chord.stab, 1.1)),
        fn(({ time, step, barInSection, chord }) => {
          // A two-note alarm on alternating bars: the machine knows.
          if (barInSection % 2 === 1 && step === 0) {
            alarm(time, chord.stab[2], 0.8);
            alarm(time + 2 * SIXTEENTH, chord.stab[0], 0.6);
          }
        }),
        fn(({ time, step, barInSection }) => {
          // The last two bars accelerate: the toll doubles.
          if (barInSection >= 4 && step % 4 === 2) click(time, 0.5 + barInSection * 0.05);
        }),
        oneShot(4, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
      ],
    },
    {
      name: 'coda',
      fromBar: SPEEDSOLVE_BARS.coda,
      toBar: SPEEDSOLVE_BARS.end,
      tracks: [
        oneShot(0, 0, ({ time, chord }) => {
          pad(time, chord.pad, 30 * SIXTEENTH, 0.8, 1400);
          subPulse(time, chord.bass, 0.5);
        }),
        // Two very different endings share one section: confetti music box if
        // the core burst, a powered-down hum if it sealed itself away.
        fn(({ time, step, barInSection }) => {
          if (!coreKilled) {
            if (step === 0) bell(time, 52 + barInSection * 12, 0.24);
            return;
          }
          const melody: Record<number, [number, number]> = {
            0: [72, 0.4], 4: [76, 0.36], 8: [79, 0.34], 12: [86, 0.4],
          };
          if (barInSection === 0 && step in melody) bell(time, melody[step][0], melody[step][1]);
          if (barInSection === 0 && step % 4 === 2) glitter(time, 0.5);
          if (barInSection === 1 && step === 0) {
            chime(time, 84, 2.6, 0.5);
            bell(time, 67, 0.3);
          }
          if (barInSection === 1 && step === 8) {
            chime(time, 88, 2.2, 0.35);
            glitter(time, 0.4);
          }
        }),
      ],
    },
  );

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: runSections,
  });

  // Attract: the cube idles in the void, solving itself slowly. A soft clock,
  // a pale pad, and a cosmetic ratchet every other bar (the idle move the
  // visuals make on the same downbeat).
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
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.5, 900)),
          hits(clickFloor, { C: 0.28 }, ({ time }, vel) => click(time, vel)),
          hits(['R...............', '................'].join(''), { R: 0.5 }, ({ time, chord }) => ratchet(time, 0.5, chord.bass + 12)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 1 && step === 8) bell(time, chord.arp[bar % 4], 0.22); }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player instruments ----------------------------------------------------

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

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.16 }],
    duration: 0.16,
    stopPadding: 0.04,
    envelope: { decay: 0.16 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.07 },
  });

  const clankVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3600 },
    envelope: { decay: 0.08 },
  });

  // Rejection: a stripped gear — the ratchet slips and finds no purchase.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.16,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 4.5, frequency: 520 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.42 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.035 }],
    duration: 0.11,
    stopPadding: 0.02,
    envelope: { decay: 0.11 },
  });

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof SpeedTonalVoice) {
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
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.4, 0.18) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.018 + sparkle * 0.04, 0.07, 7600);
  }

  // A face reaches a single color: the whole layer cascade — a six-note run up
  // the live chord, a crash of loose tiles, and the hatch venting open.
  function solveCascade(time: number, face: number) {
    if (!ctx) return;
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    ratchet(time, 1.1, score.chordAt(position).bass + 12);
    crash(time + 0.06, 0.22);
    [0, 2, 4, 5, 6, 7].forEach((degree, index) => {
      playerTone(time + 0.09 + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[Math.min(5, face) as SectionIndex].kill, 0.8 - index * 0.06, 1);
    });
    vent(time + 0.3, 0.9);
    glitter(time + 0.12, 0.6);
  }

  // The core audibly loses containment: every chip is brighter, higher, and
  // more strained than the last.
  function coreChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    clankVoice.play({ context: ctx, time, midi: chord.stab[0] + 12, gainValue: 0.05 + intensity * 0.05, destination: output, sends: playerSends(0.2, 0.2) });
    playerTone(time + THIRTYSECOND, score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))], PLAYER_VOICES[6].kill, 0.45 + intensity * 0.45, 1);
    playerNoise(time, 0.05 + intensity * 0.07, 0.08, 4600);
  }

  // The kill the whole minute is built around: one enormous snap, then the
  // music resolves and the confetti rings out.
  function coreFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix) return;
    audioMix.duckAt(time, 0.1, 1.4);
    impact(time, 1.4);
    ratchet(time + 0.02, 1.3, 48);
    crash(time + 0.05, 0.4);
    // Six colors, six notes: the confetti arpeggio climbs out of the blast.
    const ladder = [60, 64, 67, 72, 76, 79, 84, 88];
    ladder.forEach((midi, index) => {
      playerTone(time + 0.12 + index * SIXTEENTH, midi, PLAYER_VOICES[7].kill, 0.85 - index * 0.05, 1);
    });
    for (let i = 0; i < 5; i += 1) glitter(time + 0.2 + i * 0.18, 0.7 - i * 0.09);
    chime(time + 0.12 + 8 * SIXTEENTH, 84, 2.8, 0.55);
    subPulse(time + 0.02, 24, 1);
  }

  // ---- event wiring ------------------------------------------------------------

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
    if (!ctx) return;
    if (kind === 'core') {
      coreId = enemyId;
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      runtime.mix()?.duckAt(time, 0.3, 0.8);
      impact(time, 1.2);
      riser(time + 0.1, 1.8, 0.16);
      alarm(time + 0.1, 76, 1);
      alarm(time + 0.1 + 2 * SIXTEENTH, 71, 0.8);
      alarm(time + 0.1 + 4 * SIXTEENTH, 76, 0.7);
    } else if (kind === 'panel') {
      const position = score.arrangementPositionAt(ctx.currentTime);
      panelFaces.set(enemyId, Math.min(5, Math.floor(score.barAt(position) / 4)));
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      clack(time, 84, 0.22);
    } else if (kind === 'weakpoint') {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      vent(time, 0.6);
      const position = score.arrangementPositionAt(time);
      const leadSet = score.leadSetAt(position);
      alarm(time + SIXTEENTH, leadSet[2] - 12, 0.5);
      alarm(time + 3 * SIXTEENTH, leadSet[0] - 12, 0.4);
    }
  });

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
    playerNoise(time, 0.01 + sparkle * 0.026, 0.02, 9400);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.13 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.3, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 12;
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
        sends: playerSends(0.14, 0.06),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.024, 5000);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === coreId) {
      coreChip(time, 1 - hitPointsRemaining / CORE_TOTAL_HP);
      return;
    }
    // Armor chip: a tuned clank off candy plastic.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      clankVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        gainValue: 0.045 - index * 0.009,
        destination: output,
        sends: playerSends(0.18, 0.12),
      });
    }
    playerNoise(time, 0.035, 0.03, 5600);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (enemyId === coreId) {
      // A containment ring bursts: shear, slip, and the machine re-arms hotter.
      noiseHit(time, 0.16, 0.13, 'bandpass', 2500, output);
      ratchet(time, 1, chord.bass + 24);
      riser(time + 0.08, 1.2, 0.15);
      subPulse(time + 0.04, chord.bass - 12, 0.9);
    } else {
      // Weakpoint/octa casing shears away.
      noiseHit(time, 0.12, 0.1, 'bandpass', 2900, output);
      clack(time, chord.stab[1] + 12, 0.5);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kind = enemyKinds.get(enemyId);
    enemyKinds.delete(enemyId);
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);

    if (kind === 'core') {
      coreKilled = true;
      coreFinale(kill.time);
      return;
    }
    if (kind === 'panel') {
      // The move the whole level is named for: the layer rotation snaps onto
      // the next beat — the cube itself plays the drum hit.
      const beatTime = score.nextGridTime(ctx.currentTime, 4);
      const chord = score.chordAt(score.arrangementPositionAt(beatTime));
      const face = panelFaces.get(enemyId) ?? 0;
      panelKillsByFace[face] += 1;
      ratchet(beatTime, 0.9, chord.bass + 12);
      if (panelKillsByFace[face] === 4) solveCascade(beatTime, face);
    }
    if (kind === 'weakpoint') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      clack(time, 36, 1);
      vent(time + 0.08, 1);
      subPulse(time, 26, 0.8);
    }
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const mix = score.sectionMixAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[mix.to].kill, (size >= 6 ? 0.7 : 0.55) - index * 0.06, 1);
    });
    if (size >= 6) subPulse(time, score.chordAt(position).bass, 0.6);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[210, time, 0.12], [198, time + 0.08, 0.09]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.5, time: at + 0.14 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.09, 0.05, 'bandpass', 800, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.28 }],
      destination: output,
    });
    alarm(time + 0.14, chord.stab[2] + 1, 0.7);
    alarm(time + 0.26, chord.stab[2], 0.5);
    noiseHit(time, 0.16, 0.13, 'bandpass', 1000, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.1 }],
      destination: output,
      sends: playerSends(0.06, 0),
    });
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'exposed') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      [0, 2, 4].forEach((degree, index) => {
        playerTone(time + index * SIXTEENTH, leadSet[degree] + 12, PLAYER_VOICES[6].kill, 0.55, 1);
      });
    }
  });

  return runtime;
}
