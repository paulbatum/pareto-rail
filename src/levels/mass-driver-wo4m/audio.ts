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
  MASS_DRIVER_BAR,
  MASS_DRIVER_BARS,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  MASS_DRIVER_TIME,
} from './timing';

// Mass Driver's score: 128 BPM minimal techno in E minor, 32 bars = exactly the
// 60-second run. The gun is the instrument. Underneath a locked four-on-floor
// pulse a single tonal drone — the climbing hum — is scheduled bar by bar and
// rises the whole way, brightening and swelling as the firing charge builds,
// until the shot at bar 28 cuts it dead and blooms a lone E-major chord into
// open space (the Picardy third: the whole run is minor, the release is major).
// The player's guns are not an effects layer — locks, shots, chips, kills, and
// the six interlock kills all snap to the transport, read the live harmony, and
// walk hidden sequencer lanes so clean volleys perform melodic runs.

const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Main loop Em–Em–C–D, two bars per chord (an 8-bar cycle).
const CHORDS: Chord[] = [
  { bass: 40, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] }, // Em
  { bass: 40, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] }, // Em
  { bass: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72], stab: [60, 64, 67] }, // C
  { bass: 38, pad: [50, 57, 62, 66], arp: [62, 66, 69, 74], stab: [62, 66, 69] }, // D
];
// Boss set (bars 20–28): Em–F–Em–F. The bII F is phrygian dread over the bore.
const F_CHORD: Chord = { bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], stab: [65, 69, 72] };
const BOSS_CHORDS: Chord[] = [CHORDS[0], F_CHORD, CHORDS[0], F_CHORD];
// Outro (bars 28–32): a single E major bloom. The whole run resolves to the light.
const E_MAJOR: Chord = { bass: 40, pad: [52, 56, 59, 64], arp: [64, 68, 71, 76], stab: [64, 68, 71] };

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Hidden kill lanes: a degree into the current chord's live lead set for each
// grid step, so a chained volley performs a real melody through the harmony.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // injection: sparse, glassy arches climbing out of the breech.
  0: [
    0, 2, 4, 3, 2, 4, 5, 4,
    3, 5, 7, 5, 4, 6, 7, 6,
    0, 3, 5, 4, 2, 5, 6, 5,
    3, 6, 7, 6, 4, 7, 6, 3,
  ],
  // stage-1: a steady, locked walk that mirrors the four-on-floor.
  1: [
    0, 1, 2, 3, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 6, 5, 7, 6, 4, 2, 0,
  ],
  // stage-2: acid, high, jump-cut fragments that leave the bass its register.
  2: [
    4, 7, 5, 6, 4, 2, 5, 7,
    6, 3, 7, 4, 5, 2, 6, 3,
    7, 4, 6, 5, 7, 3, 5, 2,
    4, 7, 6, 4, 5, 7, 4, 0,
  ],
  // interlock: urgent, ceiling-pressing climbs — everything is a countdown.
  3: [
    0, 2, 4, 5, 2, 4, 6, 7,
    4, 6, 7, 7, 5, 6, 7, 7,
    0, 3, 5, 7, 2, 5, 7, 7,
    4, 7, 7, 7, 5, 7, 6, 7,
  ],
  // muzzle: glassy descents that resolve down onto the E-major tonic.
  4: [
    7, 6, 4, 3, 5, 4, 2, 0,
    4, 3, 2, 0, 3, 2, 0, 0,
    7, 5, 3, 0, 4, 2, 0, 0,
    3, 0, 2, 0, 0, 0, 0, 0,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// Per-section player timbres for all five sections. Section 4 (muzzle) is
// glassy, quiet, and reverb-heavy — the guns cool off in silent open space.
const PLAYER_VOICES: Record<SectionIndex, { lock: MassDriverTonalVoice; kill: MassDriverTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 3400, gain: 0.11, sparkle: 0.5, reverb: 0.2 },
    kill: { oscillator: 'triangle', decay: 0.28, cutoff: 3200, gain: 0.14, sparkle: 0.7, reverb: 0.28 },
    fire: { oscillator: 'triangle', cutoff: 3300, gain: 0.07, fallSemitones: 12, noise: 0.035 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.09, cutoff: 2600, gain: 0.05, sparkle: 0.35, reverb: 0.12 },
    kill: { oscillator: 'square', decay: 0.18, cutoff: 3000, gain: 0.1, sparkle: 0.55, reverb: 0.18 },
    fire: { oscillator: 'sawtooth', cutoff: 3800, gain: 0.06, fallSemitones: 7, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.08, cutoff: 3900, gain: 0.05, sparkle: 0.45, reverb: 0.18 },
    kill: { oscillator: 'sawtooth', decay: 0.22, cutoff: 4200, gain: 0.11, sparkle: 0.8, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 5200, gain: 0.07, fallSemitones: 12, noise: 0.06 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.11, cutoff: 2400, gain: 0.055, sparkle: 0.3, reverb: 0.3 },
    kill: { oscillator: 'sawtooth', decay: 0.34, cutoff: 2900, gain: 0.13, sparkle: 0.65, reverb: 0.36 },
    fire: { oscillator: 'square', cutoff: 3000, gain: 0.06, fallSemitones: 13, noise: 0.05 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.22, cutoff: 4200, gain: 0.045, sparkle: 0.7, reverb: 0.5 },
    kill: { oscillator: 'triangle', decay: 0.5, cutoff: 3600, gain: 0.09, sparkle: 0.85, reverb: 0.55 },
    fire: { oscillator: 'sine', cutoff: 2600, gain: 0.04, fallSemitones: 10, noise: 0.03 },
  },
};

// The climbing hum's fundamental, bar by bar: E1 at the breech, up a fourth by
// stage-2, E2 at the interlocks, then an accelerating (eased) charge to E3 at
// the shot where it is cut.
function humMidiAtBar(bar: number): number {
  if (bar <= 0) return 28;
  if (bar <= 12) return lerp(28, 33, bar / 12);
  if (bar <= 20) return lerp(33, 40, (bar - 12) / 8);
  if (bar <= 28) {
    const t = (bar - 20) / 8;
    return lerp(40, 52, t * t); // t² — slow start, accelerating rise: the charge.
  }
  return 52;
}

// The hum fades in through the breech, holds, then swells as the charge peaks.
function humLevelAtBar(bar: number): number {
  const RUN = 0.1;
  const CHARGE = 0.17;
  if (bar <= 4) return lerp(0.03, RUN, bar / 4);
  if (bar <= 20) return RUN;
  if (bar <= 28) return lerp(RUN, CHARGE, (bar - 20) / 8);
  return CHARGE;
}

// Acid line for stage-2: [lead-set degree, accent] per 16th, `null` rests.
const ACID_LINE: Array<[number, number] | null> = [
  [0, 1], null, [0, 0], [3, 0], null, [2, 1], [0, 0], null,
  [5, 0], null, [3, 1], [0, 0], [7, 0], null, [3, 0], [2, 1],
];

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-wo4m',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_DURATION,
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
      { fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.shot, chords: BOSS_CHORDS, barsPerChord: 2 },
      { fromBar: MASS_DRIVER_BARS.shot, chords: [E_MAJOR], barsPerChord: 4 },
    ],
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
      compressor: { threshold: -15, ratio: 5, attack: 0.004, release: 0.18 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2200 },
      reverb: { seconds: 2.2, decay: 2.4, level: 0.4 },
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
    kick, hat, openHat, clap, snare, crash, bass, arp, acid, stab, pad,
    klaxon, alarm, riser, sparkle, subPulse, impact, playerSends, playerTone, playerNoise,
  } = voices;

  // ---- the hum track --------------------------------------------------------
  // A single fn track, reused by every pre-shot section, steers the drone at the
  // downbeat of every bar. In trace mode there is no live drone, so we record the
  // scheduled pitch instead — the trace shows the climb bar by bar.

  function humGlide(bar: number, time: number) {
    const midi = humMidiAtBar(bar + 1);
    if (trace) {
      trace.record(time, 'hum', { bar, midi: Math.round(midi * 10) / 10 });
      return;
    }
    hum?.glideTo(midi, time, MASS_DRIVER_BAR, humLevelAtBar(bar + 1));
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

  const hatOrOpen = ({ time }: { time: number }, vel: number, symbol: string) =>
    symbol === 'o' ? openHat(time, vel) : hat(time, vel, 0.025);

  function bassFigure({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    // Octave and fifth jumps over the root pulse — busier from stage-2 on.
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
      const bar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(bar / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          hits('C...............................', { C: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.5)),
          hits('A...A...A...A...', { A: 1 }, ({ time, step, chord }) => arp(time, chord.arp[(step / 4) % chord.arp.length], 0.3)),
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
          hits(['K...............', 'K...............', 'K.......k.......', 'K.......k.......'].join(''), { K: 0.9, k: 0.55 }, ({ time }, vel) => kick(time, vel)),
          hits(['....h.......h...', '....h.......h...', '..h.h...h.h.h...', '..h.h...h.h.h...'].join(''), { h: 0.04 }, ({ time }, vel) => hat(time, vel, 0.02)),
          hits('A...A...A...A...', { A: 1 }, ({ time, step, bar, chord }) => arp(time, chord.arp[(step / 4) % chord.arp.length], 0.25 + bar * 0.12)),
          oneShot(3, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.16)),
        ],
      },
      {
        name: 'stage-1',
        fromBar: MASS_DRIVER_BARS.stage1,
        tracks: [
          humTrack,
          hits('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('..h...h...h...h.', { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.025)),
          hits('B.B.B.B.B.B.B.B.', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel)),
          hits('A.......A...A...', { A: 0.5 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && (bar - MASS_DRIVER_BARS.stage1) % 4 === 0) pad(time, chord.pad, 4 * MASS_DRIVER_BAR, 0.6); }),
        ],
      },
      {
        name: 'stage-2',
        fromBar: MASS_DRIVER_BARS.stage2,
        tracks: [
          humTrack,
          hits('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('....C.......C...', { C: 0.9 }, ({ time }, vel) => clap(time, vel)),
          hits('h.hoh.hoh.hoh.ho', { h: 0.045, o: 0.06 }, hatOrOpen),
          fn(bassFigure),
          fn(acidTrack),
          hits('A.A.A.A.A.A.A.A.', { A: 0.6 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && (bar - MASS_DRIVER_BARS.stage2) % 4 === 0) pad(time, chord.pad, 4 * MASS_DRIVER_BAR, 0.65); }),
        ],
      },
      {
        name: 'interlock',
        fromBar: MASS_DRIVER_BARS.interlock,
        tracks: [
          humTrack,
          oneShot(0, 0, ({ time, chord }) => { klaxon(time, chord.bass + 12, 2 * MASS_DRIVER_BAR); impact(time, 1.1); }),
          hits('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('..........K...K.', { K: 0.7 }, ({ time }, vel) => kick(time, vel)),
          hits('....C.......C...', { C: 0.95 }, ({ time }, vel) => clap(time, vel)),
          hits('h.hoh.hoh.hoh.ho', { h: 0.05, o: 0.07 }, hatOrOpen),
          fn(bassFigure),
          fn(({ time, step, bar, chord }) => { if (step === 0 && (bar - MASS_DRIVER_BARS.interlock) % 2 === 0) alarm(time, chord.bass + 12, 2 * MASS_DRIVER_BAR); }),
          fn(({ time, step, bar }) => { if (step === 0) riser(time, MASS_DRIVER_BAR, 0.1 + (bar - MASS_DRIVER_BARS.interlock) * 0.012); }),
          fn(({ time, step, bar }) => { if (bar === MASS_DRIVER_BARS.shot - 1) snare(time, 0.14 + step * 0.05); }),
        ],
      },
      {
        name: 'muzzle',
        fromBar: MASS_DRIVER_BARS.shot,
        toBar: MASS_DRIVER_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            const mix = runtime.mix();
            impact(time, 1.4);
            crash(time, 0.35);
            if (mix?.duck) mix.duckAt(time, 0.12, 1.6);
            humCut(time);
            pad(time, [...chord.pad, chord.pad[0] + 12], 3.5 * MASS_DRIVER_BAR, 0.9);
          }),
          fn(({ time, step, bar, chord }) => {
            const rel = bar - MASS_DRIVER_BARS.shot;
            if (rel >= 3 || (step !== 4 && step !== 12)) return;
            const lead = [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
            sparkle(time, lead[step === 4 ? 4 : 6], 0.7 - rel * 0.15);
          }),
          fn(({ time, step, bar, chord }) => { if (step === 0) subPulse(time, chord.bass, Math.max(0, 0.6 - (bar - MASS_DRIVER_BARS.shot) * 0.16)); }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player instruments ---------------------------------------------------

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
    duration: 0.24,
    stopPadding: 0.04,
    envelope: { decay: 0.24 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.075,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const stageCrackVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'square', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 6, frequency: 2600 },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageToneVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  const clampClankVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 5, frequency: 1900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  // The breaker trip: a dead low CLUNK — a detuned square minor-second pair
  // falling in pitch — plus bandpass noise. Cold iron, no reward.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 4, frequency: 520 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.48 }],
    duration: 0.55,
    stopPadding: 0.05,
    envelope: { decay: 0.55 },
  });

  const playerHitStabVoice = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.07 }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 1400 },
    envelope: { decay: 0.14 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.045 }],
    duration: 0.11,
    stopPadding: 0.02,
    envelope: { decay: 0.11 },
  });

  const detonationSubVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.6 }],
    duration: 1.6,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.35, time: time + 1.2 }],
    envelope: { decay: 1.6 },
  });

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof MassDriverTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
  }

  function killMelody(time: number, midi: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const vel = Math.min(1.4, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.4, 0.2) });
    }
    const sparkleValue = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkleValue * 0.045, 0.08, 7000);
  }

  // Each interlock kill climbs higher and brighter than the last — the charge
  // committing note by note — capped by a clamp-release clank.
  function interlockConfirm(time: number, n: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const confirmVoice: MassDriverTonalVoice = {
      oscillator: 'sawtooth',
      decay: 0.26 + n * 0.02,
      cutoff: 2400 + n * 480,
      gain: 0.1 + n * 0.018,
      sparkle: 0.5 + n * 0.08,
      reverb: 0.3,
    };
    const notes = Math.min(n, 6);
    for (let k = 0; k <= notes; k += 1) {
      playerTone(time + k * THIRTYSECOND, lead[Math.min(7, k)], confirmVoice, 0.7 + n * 0.04, 1);
    }
    // Ignition ping on the top of the climb, brighter each interlock.
    playerTone(time + (notes + 1) * THIRTYSECOND, lead[Math.min(7, notes)] + 12, confirmVoice, 0.5 + n * 0.04, 1);
    clampClankVoice.play({ context: ctx, time, frequency: 190 - n * 8, vel: 0.14 + n * 0.02, destination: output, sends: playerSends(0.1, 0.22) });
    playerNoise(time, 0.12, 0.06, 2400);
  }

  // The sixth interlock is down and the gun is committed: duck for a breath and
  // land a conclusive rising figure over an impact.
  function bossDestroyed() {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    mix.duckAt(time, 0.2, 1.2);
    impact(time, 0.95);
    stab(time, score.chordAt(position).stab.map((midi) => midi + 12), 0.85);
    lead.forEach((midi, index) => {
      playerTone(time + index * THIRTYSECOND, midi, PLAYER_VOICES[3].kill, Math.max(0.2, 0.85 - index * 0.06), 1);
    });
  }

  // Containment failure: everything cuts to a low detonation rumble instead of
  // the muzzle bloom.
  function detonation(time: number) {
    const output = musicDestination();
    const mix = runtime.mix();
    if (!ctx || !output) return;
    if (mix?.duck) mix.duckAt(time, 0.08, 1.8);
    detonationSubVoice.play({ context: ctx, time, frequency: 70, destination: output });
    voices.noiseHit(time, 0.4, 1.4, 'lowpass', 260, output);
    voices.noiseHit(time + 0.04, 0.24, 0.9, 'bandpass', 640, output);
  }

  // ---- player action handlers ----------------------------------------------

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
    const sparkleValue = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.012 + sparkleValue * 0.03, 0.022, 9200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      // Sixth lock is ignition: an octave ping plus a sub thump.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      ignitionSubVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass - 12), time: time + 0.18 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.32, 1);
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
    // Non-lethal chip (capacitor stave, interlock cowl): a soft chord tick.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      const at = time + index * THIRTYSECOND;
      stageCrackVoice.play({ context, time: at, midi: midi + 12, gainValue: 0.04 - index * 0.006, decay: 0.08, destination: output, sends: playerSends(0.18, 0.16) });
    }
    playerNoise(time, 0.04, 0.03, 5600);
  });

  bus.on('stage', ({ stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // Armor gives way: a metallic crack answered by a chord tone in the hall.
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.2, 0.12, 2500);
    clampClankVoice.play({ context: ctx, time, frequency: 1500, vel: 0.14, destination: output, sends: playerSends(0.12, 0.2) });
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
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.72);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // The circuit opens: a detuned minor-second clunk falling into the floor.
    for (const [frequency, at, vel] of [[104, time, 0.2], [110, time + 0.015, 0.15]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.45, time: at + 0.2 }],
        vel,
        destination: output,
      });
    }
    voices.noiseHit(time, 0.16, 0.09, 'bandpass', 520, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass - 12), time: time + 0.34 }],
      destination: output,
    });
    // Hull alarm from the live harmony — hazard, but harmonically anchored.
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      const at = time + index * 0.13;
      playerHitStabVoice.play({ context, time: at, midi, destination: output, sends: playerSends(0.12, 0.1) });
    });
    voices.noiseHit(time, 0.22, 0.16, 'bandpass', 760, output);
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
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'summoned') {
      // Reinforce the klaxon with a rising alarm as the interlocks clamp on.
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      alarm(time, chord.bass + 7, MASS_DRIVER_BAR);
      riser(time, MASS_DRIVER_BAR, 0.14);
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
