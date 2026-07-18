import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  createMassDriverVoices,
  installMassDriverHum,
  type MassDriverHum,
  type MassDriverTonalVoice,
} from './audio-voices';
import {
  BAR_SECONDS,
  BARS,
  MASS_DRIVER_BPM,
  RUN_DURATION,
  SCORE_SECTIONS,
  STEPS_PER_BAR,
  MUSIC,
} from './timing';

// The Mass Driver score: 128 BPM locked minimal techno in E minor, 32 bars =
// exactly the 60-second run, and the gun is the instrument. The main loop walks
// Em–Em–C–D two bars per chord; the boss bars switch to Em–F–Em–F (the bII
// Phrygian dread); the muzzle resolves to a single sustained E major bloom —
// the whole run is minor, the release is major. Underneath, one climbing hum
// rises from E1 across the entire run and is cut dead by the shot. A struck-
// coil tick lands on every beat because a ring crosses on every beat. The
// player is the soloist: locks, shots, chips, kills, and the six interlock
// confirmations all snap to the transport and read the live harmony.

const SIXTEENTH = MUSIC.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Main loop Em–Em–C–D, two bars per chord (an eight-bar cycle).
const CHORDS: Chord[] = [
  { bass: 40, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] }, // Em
  { bass: 40, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] }, // Em
  { bass: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72], stab: [60, 64, 67] }, // C
  { bass: 38, pad: [50, 57, 62, 66], arp: [62, 66, 69, 74], stab: [62, 66, 69] }, // D
];
// Interlock bars: Em–F–Em–F. F over an E pedal is the classic dread.
const F_CHORD: Chord = { bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], stab: [65, 69, 72] };
const BOSS_CHORDS: Chord[] = [CHORDS[0], F_CHORD, CHORDS[0], F_CHORD];
// Muzzle: one E major bloom — the Picardy third, the light at the end of the barrel.
const E_MAJOR: Chord = { bass: 40, pad: [52, 56, 59, 64], arp: [64, 68, 71, 76], stab: [64, 68, 71] };

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Hidden per-section kill lanes: each entry is a degree into the live lead set
// (8 notes), so a chained volley performs a written melodic run.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // injection: unhurried arches out of the breech — glassy, wide intervals.
  0: [
    0, 4, 2, 5, 3, 6, 4, 7,
    5, 3, 6, 4, 2, 5, 3, 0,
    0, 4, 2, 6, 3, 7, 5, 4,
    6, 4, 7, 5, 3, 5, 2, 0,
  ],
  // stage-1: a locked stepwise walk that mirrors the four-on-floor.
  1: [
    0, 1, 2, 3, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 5, 4, 3,
    0, 2, 4, 3, 5, 4, 6, 5,
    7, 5, 6, 4, 3, 2, 1, 0,
  ],
  // stage-2: acid jump-cuts, high and jagged, out of the bass's register.
  2: [
    4, 7, 5, 2, 6, 3, 7, 4,
    5, 7, 3, 6, 2, 7, 4, 6,
    7, 5, 6, 3, 7, 4, 5, 2,
    6, 7, 4, 7, 5, 6, 7, 0,
  ],
  // interlock: everything presses the ceiling — a countdown in melody form.
  3: [
    0, 3, 5, 7, 2, 5, 7, 7,
    4, 6, 7, 7, 5, 7, 6, 7,
    0, 4, 6, 7, 3, 6, 7, 7,
    5, 7, 7, 6, 7, 7, 7, 7,
  ],
  // muzzle: long descents that settle onto the E major tonic.
  4: [
    7, 5, 4, 2, 6, 4, 3, 0,
    5, 4, 2, 0, 4, 2, 0, 0,
    7, 6, 4, 3, 5, 2, 1, 0,
    4, 2, 0, 0, 2, 0, 0, 0,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// Per-section player timbres — glassy at the breech, tight and square in
// stage-1, bright saws in stage-2, dark reverb-heavy saws at the interlocks,
// quiet and hall-drenched in open space.
const PLAYER_VOICES: Record<SectionIndex, { lock: MassDriverTonalVoice; kill: MassDriverTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.13, cutoff: 3500, gain: 0.11, sparkle: 0.5, reverb: 0.22 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3300, gain: 0.14, sparkle: 0.7, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 3300, gain: 0.07, fallSemitones: 12, noise: 0.035 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.09, cutoff: 2500, gain: 0.05, sparkle: 0.35, reverb: 0.12 },
    kill: { oscillator: 'square', decay: 0.19, cutoff: 3000, gain: 0.1, sparkle: 0.55, reverb: 0.18 },
    fire: { oscillator: 'sawtooth', cutoff: 3900, gain: 0.06, fallSemitones: 8, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.08, cutoff: 4000, gain: 0.05, sparkle: 0.45, reverb: 0.18 },
    kill: { oscillator: 'sawtooth', decay: 0.23, cutoff: 4300, gain: 0.11, sparkle: 0.8, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 5300, gain: 0.07, fallSemitones: 12, noise: 0.06 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.12, cutoff: 2300, gain: 0.055, sparkle: 0.3, reverb: 0.32 },
    kill: { oscillator: 'sawtooth', decay: 0.36, cutoff: 2800, gain: 0.13, sparkle: 0.65, reverb: 0.38 },
    fire: { oscillator: 'square', cutoff: 2900, gain: 0.06, fallSemitones: 13, noise: 0.05 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.24, cutoff: 4300, gain: 0.045, sparkle: 0.7, reverb: 0.52 },
    kill: { oscillator: 'triangle', decay: 0.55, cutoff: 3600, gain: 0.09, sparkle: 0.85, reverb: 0.55 },
    fire: { oscillator: 'sine', cutoff: 2500, gain: 0.04, fallSemitones: 10, noise: 0.03 },
  },
};

// The hum's fundamental, bar by bar: E1 at the breech, up a fourth (A1) by the
// middle of the run, up an octave (E2) by the interlocks, then an accelerating
// rise to E3 at the charge peak — where the shot cuts it dead.
function humMidiAtBar(barIndex: number): number {
  if (barIndex <= 0) return 28;
  if (barIndex <= 16) return lerp(28, 33, barIndex / 16);
  if (barIndex <= 20) return lerp(33, 40, (barIndex - 16) / 4);
  if (barIndex <= 28) {
    const t = (barIndex - 20) / 8;
    return lerp(40, 52, t * t); // slow start, accelerating rise: the charge.
  }
  return 52;
}

// Fades in through the breech, holds through the stages, swells with the charge.
function humLevelAtBar(barIndex: number): number {
  const RUN = 0.095;
  const CHARGE = 0.165;
  if (barIndex <= 4) return lerp(0.03, RUN, barIndex / 4);
  if (barIndex <= 20) return RUN;
  if (barIndex <= 28) return lerp(RUN, CHARGE, (barIndex - 20) / 8);
  return CHARGE;
}

// Stage-2 acid line: [lead degree, accent] per 16th, null rests. Walks the
// chord with an accent pattern that leans on the offbeats.
const ACID_LINE: Array<[number, number] | null> = [
  [0, 1], null, [2, 0], null, [0, 0], [3, 1], null, [2, 0],
  null, [5, 1], [3, 0], null, [7, 0], [5, 0], null, [2, 1],
];

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverDetailedAudio = createAudioTraceHarness({
  level: 'mass-driver-detailed-m3rp',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: RUN_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let hum: MassDriverHum | null = null;
  const interlockIds = new Set<number>();
  let interlockKills = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: BARS.interlock, toBar: BARS.shot, chords: BOSS_CHORDS, barsPerChord: 2 },
      { fromBar: BARS.shot, chords: [E_MAJOR], barsPerChord: 4 },
    ],
    sections: SCORE_SECTIONS,
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
      compressor: { threshold: -15, ratio: 5, attack: 0.004, release: 0.18 },
      // A dotted-eighth delay and a long hall, per the brief.
      delay: { time: SIXTEENTH * 3, feedback: 0.32, dampHz: 2300 },
      reverb: { seconds: 2.4, decay: 2.4, level: 0.4 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      hum = installMassDriverHum(context, mix);
      hum.idle(context.currentTime);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockIds.clear();
      interlockKills = 0;
    },
    onDispose() {
      ctx = null;
      hum = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const musicDestination = () => runtime.mix()?.music ?? runtime.mix()?.master ?? null;

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, hat, openHat, clap, snare, crash, bass, arp, coilTick, acid, stab, pad,
    klaxon, alarm, riser, sparkle, subPulse, impact, playerSends, playerTone, playerNoise,
  } = voices;

  // ---- the hum track --------------------------------------------------------
  // One fn track reused by every pre-shot section steers the drone at each bar's
  // downbeat. Trace mode has no live drone, so the scheduled pitch is recorded
  // instead — the trace shows the climb bar by bar.

  function humGlide(barIndex: number, time: number) {
    const midi = humMidiAtBar(barIndex + 1);
    if (trace) {
      trace.record(time, 'hum', { bar: barIndex, midi: Math.round(midi * 10) / 10 });
      return;
    }
    hum?.glideTo(midi, time, BAR_SECONDS, humLevelAtBar(barIndex + 1));
  }

  function humCut(time: number) {
    if (trace) {
      trace.record(time, 'humcut', {});
      return;
    }
    hum?.cutAt(time);
  }

  const humTrack = fn<Chord>(({ bar, step, time }) => {
    if (step === 0) humGlide(bar, time);
  });

  // The ring-crossing tick: every beat, deeper and brighter on the downbeat.
  // Velocity swells slightly through the run as the rings heat up.
  const tickTrack = fn<Chord>(({ time, step, bar, chord }) => {
    if (step % 4 !== 0) return;
    const heat = Math.min(1, bar / BARS.shot);
    coilTick(time, chord.bass + 36, 0.8 + heat * 0.5, step === 0);
  });

  const hatOrOpen = ({ time }: { time: number }, vel: number, symbol: string) =>
    symbol === 'o' ? openHat(time, vel) : hat(time, vel, 0.025);

  function bassFigure({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    // Octave and fifth jumps over the root pulse.
    const figure: Record<number, [number, number]> = {
      0: [0, 1], 2: [0, 0.6], 4: [7, 0.7], 6: [0, 0.8], 8: [0, 0.9], 10: [12, 0.6], 12: [7, 0.7], 14: [3, 0.6],
    };
    if (step in figure) bass(time, chord.bass + figure[step][0], figure[step][1]);
  }

  function acidTrack({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const cell = ACID_LINE[step];
    if (!cell) return;
    const lead = [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
    acid(time, lead[cell[0]], 0.9, cell[1]);
  }

  // ---- arrangements ---------------------------------------------------------

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
          // Attract mode: a long pad and quarter arps over the idling hum.
          hits('C...............................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.5)),
          hits('A...A...A...A...', { A: 1 }, ({ time, step, chord }) => arp(time, chord.arp[(step / 4) % chord.arp.length], 0.28)),
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
        fromBar: BARS.injection,
        tracks: [
          humTrack,
          tickTrack,
          // Sparse downbeat kick; ghost kicks creep in through bars 2–3.
          hits(['K...............', 'K...............', 'K.....g.........', 'K.....g...g.....'].join(''), { K: 0.9, g: 0.4 }, ({ time }, vel) => kick(time, vel)),
          hits(['....h.......h...', '....h.......h...', '..h.h...h...h...', '..h.h...h.h.h...'].join(''), { h: 0.04 }, ({ time }, vel) => hat(time, vel, 0.02)),
          // A quarter-note arp climbing in velocity across the section.
          hits('A...A...A...A...', { A: 1 }, ({ time, step, bar, chord }) => arp(time, chord.arp[(step / 4) % chord.arp.length], 0.22 + bar * 0.13)),
          oneShot(3, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.17)),
        ],
      },
      {
        name: 'stage-1',
        fromBar: BARS.stage1,
        tracks: [
          humTrack,
          tickTrack,
          hits('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('..h...h...h...h.', { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.025)),
          // Driving eighth-note root bass.
          hits('B.B.B.B.B.B.B.B.', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel)),
          hits('A.......A.....A.', { A: 0.5 }, ({ time, step, chord }, vel) => arp(time, chord.arp[Math.floor(step / 4) % chord.arp.length], vel)),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && (bar - BARS.stage1) % 4 === 0) pad(time, chord.pad, 4 * BAR_SECONDS, 0.6);
          }),
        ],
      },
      {
        name: 'stage-2',
        fromBar: BARS.stage2,
        tracks: [
          humTrack,
          tickTrack,
          hits('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('....C.......C...', { C: 0.9 }, ({ time }, vel) => clap(time, vel)),
          // A sixteenth-note hat lattice with opens on the offbeat tails.
          hits('h.hoh.h.h.hoh.h.', { h: 0.045, o: 0.06 }, hatOrOpen),
          fn(bassFigure),
          fn(acidTrack),
          hits('A.A.A.A.A.A.A.A.', { A: 0.55 }, ({ time, step, chord }, vel) => arp(time, chord.arp[Math.floor(step / 2) % chord.arp.length] + 12, vel)),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && (bar - BARS.stage2) % 4 === 0) pad(time, chord.pad, 4 * BAR_SECONDS, 0.65);
          }),
        ],
      },
      {
        name: 'interlock',
        fromBar: BARS.interlock,
        tracks: [
          humTrack,
          tickTrack,
          // The klaxon announces the jam over a low impact, then the section grinds.
          oneShot(0, 0, ({ time, chord }) => {
            klaxon(time, chord.bass + 12, 2 * BAR_SECONDS);
            impact(time, 1.1);
          }),
          hits('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          // Late-bar syncopation: extra kicks crowd the end of each bar.
          hits('..........K...K.', { K: 0.65 }, ({ time }, vel) => kick(time, vel)),
          hits('....C.......C...', { C: 0.95 }, ({ time }, vel) => clap(time, vel)),
          hits('h.hoh.h.h.hoh.h.', { h: 0.05, o: 0.07 }, hatOrOpen),
          fn(bassFigure),
          // Rising alarm sweeps every couple of bars.
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && (bar - BARS.interlock) % 2 === 0) alarm(time, chord.bass + 12, 2 * BAR_SECONDS);
          }),
          // A noise riser that grows each bar as the charge builds.
          fn(({ time, step, bar }) => {
            if (step === 0) riser(time, BAR_SECONDS, 0.1 + (bar - BARS.interlock) * 0.013);
          }),
          // Final bar: a snare roll building all the way into the shot.
          fn(({ time, step, bar }) => {
            if (bar === BARS.shot - 1) snare(time, 0.13 + step * 0.055);
          }),
        ],
      },
      {
        name: 'muzzle',
        fromBar: BARS.shot,
        toBar: BARS.end,
        tracks: [
          // The downbeat of bar 28: impact, crash, a hard duck, the hum cut dead,
          // and a huge E-major pad bloom. Open space.
          oneShot(0, 0, ({ time, chord }) => {
            const mix = runtime.mix();
            impact(time, 1.4);
            crash(time, 0.35);
            if (mix?.duck) mix.duckAt(time, 0.1, 1.7);
            humCut(time);
            pad(time, [...chord.pad, chord.pad[0] + 12], 3.6 * BAR_SECONDS, 0.9);
          }),
          // Glassy sparkle delays, thinning as the silence settles.
          fn(({ time, step, bar, chord }) => {
            const rel = bar - BARS.shot;
            if (rel >= 3 || (step !== 4 && step !== 12)) return;
            const lead = [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
            sparkle(time, lead[step === 4 ? 4 : 6], 0.7 - rel * 0.16);
          }),
          // A subsiding sub pulse, fading to nothing.
          fn(({ time, step, bar, chord }) => {
            if (step === 0) subPulse(time, chord.bass, Math.max(0, 0.6 - (bar - BARS.shot) * 0.17));
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player one-shot voices ----------------------------------------------

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

  const ignitionSubVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.22 }],
    duration: 0.25,
    stopPadding: 0.04,
    envelope: { decay: 0.25 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.075,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const chipVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'square', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 6, frequency: 2700 },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageToneVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  const clankVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.15,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 5, frequency: 1850 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  // The breaker trip: a dead low minor-second CLUNK falling into the floor.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.23,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 4, frequency: 500 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.23 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.48 }],
    duration: 0.6,
    stopPadding: 0.05,
    envelope: { decay: 0.6 },
  });

  const playerHitAlarmVoice = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.065 }],
    duration: 0.15,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 1350 },
    envelope: { decay: 0.15 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.11,
    stopPadding: 0.02,
    envelope: { decay: 0.11 },
  });

  const detonationSubVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.6 }],
    duration: 1.7,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.32, time: time + 1.3 }],
    envelope: { decay: 1.7 },
  });

  function mixedVoiceNumber(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: 'decay' | 'cutoff' | 'gain' | 'sparkle' | 'reverb') {
    return lerp(PLAYER_VOICES[mix.from][slot][key], PLAYER_VOICES[mix.to][slot][key], mix.t);
  }

  function killMelody(time: number, midi: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const vel = Math.min(1.4, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceNumber(mix, 'kill', 'decay');
    const gain = mixedVoiceNumber(mix, 'kill', 'gain');
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.4, 0.2) });
    }
    playerNoise(time, 0.02 + mixedVoiceNumber(mix, 'kill', 'sparkle') * 0.045, 0.08, 7000);
  }

  // Each interlock kill plays a climbing confirmation — one more note than the
  // last, brighter and higher each time, capped with an ignition ping and a
  // clamp-release clank that drops in pitch per interlock.
  function interlockConfirm(time: number, n: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const confirmVoice: MassDriverTonalVoice = {
      oscillator: 'sawtooth',
      decay: 0.26 + n * 0.02,
      cutoff: 2300 + n * 500,
      gain: 0.1 + n * 0.018,
      sparkle: 0.5 + n * 0.08,
      reverb: 0.3,
    };
    const notes = Math.min(n, 6);
    for (let k = 0; k <= notes; k += 1) {
      playerTone(time + k * THIRTYSECOND, lead[Math.min(7, k)], confirmVoice, 0.7 + n * 0.04, 1);
    }
    playerTone(time + (notes + 1) * THIRTYSECOND, lead[Math.min(7, notes)] + 12, confirmVoice, 0.5 + n * 0.04, 1);
    clankVoice.play({ context: ctx, time, frequency: 195 - n * 9, vel: 0.14 + n * 0.02, destination: output, sends: playerSends(0.1, 0.22) });
    playerNoise(time, 0.12, 0.06, 2400);
  }

  // Sixth interlock down: a beat of ducked silence, an impact, a high chord
  // stab, and a conclusive descent — the gun is committed.
  function bossDestroyed() {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    mix.duckAt(time, 0.18, 1.2);
    impact(time, 0.95);
    stab(time, score.chordAt(position).stab.map((midi) => midi + 12), 0.85);
    [...lead].reverse().forEach((midi, index) => {
      playerTone(time + index * THIRTYSECOND, midi, PLAYER_VOICES[3].kill, Math.max(0.2, 0.85 - index * 0.07), 1);
    });
  }

  // Containment failure: the music collapses to a long low sub rumble and
  // filtered noise instead of the muzzle bloom.
  function detonation(time: number) {
    const output = musicDestination();
    const mix = runtime.mix();
    if (!ctx || !output) return;
    if (mix?.duck) mix.duckAt(time, 0.08, 1.9);
    detonationSubVoice.play({ context: ctx, time, frequency: 68, destination: output });
    voices.noiseHit(time, 0.4, 1.5, 'lowpass', 250, output);
    voices.noiseHit(time + 0.05, 0.24, 0.9, 'bandpass', 620, output);
  }

  // ---- player action handlers ----------------------------------------------

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    // Locks walk up the live lead set by lock count.
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].lock, 1, weight);
    }
    playerNoise(time, 0.012 + mixedVoiceNumber(mix, 'lock', 'sparkle') * 0.03, 0.022, 9200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      // The sixth lock is ignition: an octave ping and a falling sub thump.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      ignitionSubVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass - 12), time: time + 0.19 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    // Unlock answers with a soft high tick.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.3, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // A short falling zap, pitched from the live chord per shot in the volley.
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.062 }],
        destination: output,
        sends: playerSends(0.16, 0.06),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.024, 5000);
  });

  bus.on('hit', ({ lethal }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    // Armor chips tick a soft ascending arpeggio from the live chord.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      const at = time + index * THIRTYSECOND;
      chipVoice.play({ context, time: at, midi: midi + 12, gainValue: 0.04 - index * 0.006, decay: 0.08, destination: output, sends: playerSends(0.18, 0.16) });
    }
    playerNoise(time, 0.04, 0.03, 5600);
  });

  bus.on('stage', ({ stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // A stage break cracks metallically and rings a chord tone into the hall.
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.2, 0.12, 2500);
    clankVoice.play({ context: ctx, time, frequency: 1550, vel: 0.14, destination: output, sends: playerSends(0.12, 0.2) });
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageToneVoice.play({ context: ctx, time, midi, gainValue: 0.12, decay: 0.5, destination: output, sends: playerSends(0.22, 0.5) });
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (interlockIds.has(enemyId)) {
      interlockIds.delete(enemyId);
      interlockKills += 1;
      interlockConfirm(kill.time, interlockKills);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, kill.midi, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    // A full clean volley lands a chord stab an octave up plus a short flourish.
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.7);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Cold iron, no reward: a detuned minor-second pair falling into the floor.
    for (const [frequency, at, vel] of [[103, time, 0.2], [109, time + 0.016, 0.15]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.42, time: at + 0.21 }],
        vel,
        destination: output,
      });
    }
    voices.noiseHit(time, 0.16, 0.09, 'bandpass', 500, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // A falling octave boom under a two-note hull alarm from the live harmony.
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass - 12), time: time + 0.36 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      playerHitAlarmVoice.play({ context, time: time + index * 0.13, midi, destination: output, sends: playerSends(0.12, 0.1) });
    });
    voices.noiseHit(time, 0.22, 0.16, 'bandpass', 760, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // A barely-there falling tick.
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.1 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'summoned') {
      // The clamps lock in: reinforce the klaxon with an alarm and a riser.
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      alarm(time, chord.bass + 7, BAR_SECONDS);
      riser(time, BAR_SECONDS, 0.14);
    } else if (phase === 'destroyed') {
      bossDestroyed();
    }
  });

  bus.on('runend', ({ died }) => {
    if (!ctx) return;
    if (died) {
      detonation(ctx.currentTime);
      hum?.cutAt(ctx.currentTime);
    } else {
      hum?.idle(ctx.currentTime);
    }
  });

  return runtime;
}
