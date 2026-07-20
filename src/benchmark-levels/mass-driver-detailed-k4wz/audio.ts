import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  defineInstruments,
  playOscillatorVoice,
  type BeatLevelAudioStep,
  type MixBus,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createMassDriverVoices } from './audio-voices';
import {
  MASS_DRIVER_BARS,
  MASS_DRIVER_BPM,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  MASS_DRIVER_TIME,
} from './timing';

// 128 BPM locked minimal techno in E minor; 32 bars is exactly 60 seconds.
// The gun is the instrument: a persistent bass hum — the gun spooling up —
// climbs in pitch across the whole run and accelerates into the firing
// charge, cutting dead on the bar-28 shot. Main loop Em–Em–C–D, two bars per
// chord; the interlock bars switch to Em–F (the ♭II Phrygian dread); the
// muzzle resolves to a single sustained E major bloom — the whole run is
// minor, the release is major.
//
// The player is the soloist: every player sound is quantized to the
// transport and pitched from the live harmony, with per-section timbres
// crossfaded across boundaries; kills walk hidden per-section melodic lanes.

const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const BEAT = MASS_DRIVER_TIME.beatSeconds;
const BAR = MASS_DRIVER_TIME.barSeconds;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const LANE_STEPS = 32; // two bars: one full chord

type Chord = { name: string; bass: number; pad: number[]; arp: number[] };

const EM: Chord = { name: 'Em', bass: 40, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76] };
const C: Chord = { name: 'C', bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72] };
const D: Chord = { name: 'D', bass: 38, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74] };
const F: Chord = { name: 'F', bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] };
const E_MAJOR: Chord = { name: 'E', bass: 40, pad: [52, 56, 59, 64], arp: [64, 68, 71, 76] };

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Hidden kill-melody lanes: degrees 0–7 into the live lead set (arp plus the
// same notes an octave up), one 32-step contour per section. A chained volley
// walks consecutive steps — a real melodic run in the section's own shape.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Injection — a gentle glassy arch.
  0: [
    0, 1, 2, 3, 2, 3, 4, 5,
    4, 3, 2, 1, 2, 3, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 3,
    4, 3, 2, 1, 0, 1, 2, 3,
  ],
  // Stage-1 — tight square zig-zags with the four-on-the-floor.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 1, 5, 2, 6, 3, 7,
    7, 6, 5, 4, 3, 2, 1, 0,
  ],
  // Stage-2 — octave-jumping acid answers.
  2: [
    0, 7, 2, 7, 4, 7, 5, 7,
    0, 7, 3, 7, 5, 7, 6, 7,
    1, 5, 2, 6, 3, 7, 4, 7,
    7, 5, 6, 4, 7, 6, 7, 5,
  ],
  // Interlock — descending dread peals answered by a climb.
  3: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 6, 5, 4, 3,
  ],
  // Muzzle — sparse, high, hall-drenched (no scheduled enemies live here).
  4: [
    7, 5, 6, 4, 7, 5, 6, 4,
    5, 3, 4, 2, 5, 3, 4, 2,
    7, 6, 5, 4, 3, 2, 1, 0,
    4, 5, 6, 7, 7, 6, 5, 4,
  ],
};

type KillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number; hall: number };

// Per-section timbres for the player's instruments: glassy at the breech,
// tight and square in stage-1, bright saws in stage-2, dark reverb-heavy saws
// at the interlocks, quiet and hall-drenched at the muzzle. Gains tuned for
// perceived loudness, not equal numbers.
const SECTION_VOICES: Record<SectionIndex, {
  kill: KillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.48, cutoff: 3600, gain: 0.17, shimmer: 0.4, hall: 0.22 },
    lock: { oscillator: 'triangle', cutoff: 2600, gain: 0.13 },
    fire: { cutoff: 1800, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.2, cutoff: 2400, gain: 0.13, shimmer: 0.45, hall: 0.15 },
    lock: { oscillator: 'square', cutoff: 1900, gain: 0.055 },
    fire: { cutoff: 2800, noise: 0.045 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.26, cutoff: 3300, gain: 0.15, shimmer: 0.6, hall: 0.2 },
    lock: { oscillator: 'sawtooth', cutoff: 2300, gain: 0.05 },
    fire: { cutoff: 3800, noise: 0.06 },
  },
  3: {
    kill: { oscillator: 'sawtooth', decay: 0.5, cutoff: 2100, gain: 0.16, shimmer: 0.5, hall: 0.55 },
    lock: { oscillator: 'sawtooth', cutoff: 1600, gain: 0.05 },
    fire: { cutoff: 3000, noise: 0.06 },
  },
  4: {
    kill: { oscillator: 'sine', decay: 0.85, cutoff: 2600, gain: 0.09, shimmer: 0.7, hall: 0.85 },
    lock: { oscillator: 'sine', cutoff: 2200, gain: 0.07 },
    fire: { cutoff: 1500, noise: 0.02 },
  },
};

// The climbing hum: fundamental per bar. Idles at E1; up a fourth by the
// middle, up an octave by the interlocks, then an accelerating rise into the
// charge peak. THE SHOT cuts it dead.
const HUM_IDLE = { midi: 28, level: 0.038, cutoff: 320 };
function humPlanForBar(bar: number): { midi: number; level: number; cutoff: number } {
  if (bar < 4) return { midi: 28, level: 0.05, cutoff: 340 };
  if (bar < 8) return { midi: 31, level: 0.055, cutoff: 420 };
  if (bar < 12) return { midi: 33, level: 0.06, cutoff: 520 };
  if (bar < 16) return { midi: 33, level: 0.066, cutoff: 640 };
  if (bar < 20) return { midi: 35, level: 0.075, cutoff: 800 };
  if (bar < 22) return { midi: 40, level: 0.09, cutoff: 1050 };
  if (bar < 24) return { midi: 43, level: 0.1, cutoff: 1350 };
  if (bar < 26) return { midi: 47, level: 0.115, cutoff: 1750 };
  if (bar < 27) return { midi: 50, level: 0.13, cutoff: 2200 };
  return { midi: 52, level: 0.15, cutoff: 2700 };
}

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-detailed-k4wz',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const isTrace = trace !== undefined;

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: [EM, EM, C, D],
    barsPerChord: 2,
    alternateChordSets: [
      // The boss bars: Em–F–Em–F, the ♭II Phrygian dread.
      { fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.shot, chords: [EM, F], barsPerChord: 2 },
      // The muzzle: one sustained E major bloom — the Picardy third.
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
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.004, release: 0.2 },
      // A dotted delay and a long reverb; the kick's duck is the pump.
      delay: { time: SIXTEENTH * 3, feedback: 0.36, dampHz: 2500 },
      reverb: { seconds: 2.8, decay: 2.3, level: 0.3 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mixBus) {
      ctx = context;
      buildHum(context, mixBus);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockKillCount = 0;
      interlocksAlive.clear();
      kindById.clear();
      shotFired = false;
      ambientMutedUntil = 0;
      lastHumBar = -1;
    },
    onRunEnd() {
      // Natural end of the muzzle coast: quietly re-idle the gun for the
      // replay screen. Death and the shot each cut the hum themselves.
      const context = runtime.context();
      if (context) hum.humIdle(context.currentTime + 2.5);
    },
    onDispose() {
      ctx = null;
      humNodes = null;
    },
  });

  // ---- the climbing hum -----------------------------------------------------
  // Detuned saws over a sine sub through a lowpass, steered bar by bar. Lives
  // outside the arrangement so it can idle in attract mode and die instantly.

  type HumNodes = {
    saws: OscillatorNode[];
    sub: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
    lastLevel: number;
    lastSawFreq: number;
    lastSubFreq: number;
    lastCutoff: number;
  };
  let humNodes: HumNodes | null = null;
  let lastHumBar = -1;

  function buildHum(context: AudioContext, mixBus: MixBus) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = HUM_IDLE.cutoff;
    filter.Q.value = 1.1;
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    filter.connect(gain);
    gain.connect(mixBus.duck);

    const saws: OscillatorNode[] = [];
    for (const detune of [-9, 9]) {
      const saw = context.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = midiToFreq(HUM_IDLE.midi + 12);
      saw.detune.value = detune;
      saw.connect(filter);
      saw.start();
      saws.push(saw);
    }
    const sub = context.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiToFreq(HUM_IDLE.midi);
    const subGain = context.createGain();
    subGain.gain.value = 1.4;
    sub.connect(subGain);
    subGain.connect(gain);
    sub.start();

    // A slow wobble on the filter — the idle spool.
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.31;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 46;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    humNodes = {
      saws,
      sub,
      filter,
      gain,
      lastLevel: 0.0001,
      lastSawFreq: midiToFreq(HUM_IDLE.midi + 12),
      lastSubFreq: midiToFreq(HUM_IDLE.midi),
      lastCutoff: HUM_IDLE.cutoff,
    };
    // Fade the idle hum in.
    hum.humTarget(context.currentTime + 0.1, HUM_IDLE.midi, HUM_IDLE.level, HUM_IDLE.cutoff, 1.6);
  }

  const hum = defineInstruments({ trace, context: () => ctx }, {
    humTarget(_context, time, midi, level, cutoff, glide) {
      if (!humNodes) return;
      const sawFreq = midiToFreq(midi + 12);
      const subFreq = midiToFreq(midi);
      for (const saw of humNodes.saws) {
        saw.frequency.cancelScheduledValues(time);
        saw.frequency.setValueAtTime(humNodes.lastSawFreq, time);
        saw.frequency.exponentialRampToValueAtTime(sawFreq, time + glide);
      }
      humNodes.sub.frequency.cancelScheduledValues(time);
      humNodes.sub.frequency.setValueAtTime(humNodes.lastSubFreq, time);
      humNodes.sub.frequency.exponentialRampToValueAtTime(subFreq, time + glide);
      humNodes.filter.frequency.cancelScheduledValues(time);
      humNodes.filter.frequency.setValueAtTime(humNodes.lastCutoff, time);
      humNodes.filter.frequency.exponentialRampToValueAtTime(cutoff, time + glide);
      humNodes.gain.gain.cancelScheduledValues(time);
      humNodes.gain.gain.setValueAtTime(Math.max(0.0001, humNodes.lastLevel), time);
      humNodes.gain.gain.linearRampToValueAtTime(level, time + glide);
      humNodes.lastSawFreq = sawFreq;
      humNodes.lastSubFreq = subFreq;
      humNodes.lastCutoff = cutoff;
      humNodes.lastLevel = level;
    },
    humCut(_context, time) {
      if (!humNodes) return;
      // The shot cuts the hum dead in a heartbeat.
      humNodes.gain.gain.cancelScheduledValues(time);
      humNodes.gain.gain.setValueAtTime(Math.max(0.0001, humNodes.lastLevel), time);
      humNodes.gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
      humNodes.lastLevel = 0.0001;
    },
    humIdle(_context, time) {
      if (!humNodes) return;
      hum.humTarget(time, HUM_IDLE.midi, HUM_IDLE.level, HUM_IDLE.cutoff, 2.4);
    },
  }, {
    humTarget: ['midi', 'level', 'cutoff', 'glide'],
    humCut: [],
    humIdle: [],
  });

  // ---- voices -----------------------------------------------------------------

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, ghostKick, clap, hat, snare, bass, acid, pad, arp, ringTick, klaxon,
    alarmSweep, riser, impact, crash, clank, subPulse, shimmer, noiseHit,
  } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  const killLayerVoice = voice<{ killVoice: KillVoice }>({
    oscillators: [{ type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain }],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { decay: ({ killVoice }) => killVoice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.55 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 200 },
    envelope: { decay: 0.1 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.085 }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.12,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 4000 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  // Reject — a breaker trip: a dead low minor-second CLUNK falling into the
  // floor. Cold iron, dry, no reward.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.2,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 520 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.55, time: time + 0.16 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.42,
    stopPadding: 0.05,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.5, time: time + 0.3 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.42, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
    ],
  });

  const alarmBeepVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.06 }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 3, cutoff: 2100 },
    envelope: { decay: 0.09 },
  });

  // ---- arrangement ---------------------------------------------------------------

  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const padOdd = blankBar + 'P...............';
  const fourKick = 'K...k...k...k...';
  const clapBackbeat = '....C.......C...';
  const offbeatHat = '..h...h...h...h.';
  const latticeHat = 'hhhOhhhhhhhOhhhh';
  const tightHat = 'hhhhhhhhhhhhhhhh';
  const eighthBass = 'B.b.b.b.b.b.b.b.';
  const busyBass = 'B.b.u.b.f.b.u.b.';

  // Acid line: semitone offsets from the chord root (+12), null = rest.
  const ACID_OFFSETS: Array<number | null> = [0, null, 12, 0, 7, null, 12, null, 0, 3, null, 7, 0, null, 10, 12];
  const ACID_ACCENTS = [1, 0, 0.7, 0.8, 0.9, 0, 0.7, 0, 1, 0.8, 0, 0.7, 0.9, 0, 0.8, 1];

  function padTrack(fromBar: number, level: number) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) =>
      pad(time, chord.pad, BAR * 2 * 1.05, level));
  }

  function kickTrack(pattern: string) {
    return hits(pattern, { K: 1, k: 0.9 }, ({ time }, vel) => kick(time, vel));
  }

  function hatTrack(pattern: string, quiet = 1) {
    return hits(pattern, { h: 0.04 * quiet, H: 0.08 * quiet, O: 0.13 * quiet }, ({ time }, vel, symbol) =>
      hat(time, vel, symbol === 'O' ? 0.19 : 0.03));
  }

  function bassTrack(pattern: string) {
    return hits<Chord>(pattern, { B: 1, b: 0.72, u: 0.72, f: 0.72 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0;
      bass(time, chord.bass + offset, vel);
    });
  }

  const injectionSection = {
    name: 'injection',
    fromBar: MASS_DRIVER_BARS.injection,
    toBar: MASS_DRIVER_BARS.stage1,
    tracks: [
      padTrack(0, 0.04),
      // Sparse downbeat kick with ghost kicks creeping in.
      fn<Chord>(({ barInSection, step, time }) => {
        if (step === 0) kick(time, 1);
        if (barInSection >= 2 && step === 8) ghostKick(time, 0.8);
        if (barInSection === 3 && (step === 4 || step === 12)) ghostKick(time, 0.6);
      }),
      // The ring tick makes the first crossings audible before the kit lands.
      hits<Chord>('T...T...T...T...', { T: 0.8 }, ({ time, step, chord }, vel) =>
        ringTick(time, chord.arp[(step / 4) % chord.arp.length] + 24, vel)),
      hatTrack('....h.......h...'),
      // A quarter-note arp climbing in velocity across the section.
      fn<Chord>(({ barInSection, step, time, chord }) => {
        if (step % 4 !== 0) return;
        const climb = (barInSection * 16 + step) / 64;
        arp(time, chord.arp[(step / 4) % chord.arp.length] - 12, 0.2 + climb * 0.35);
      }),
      // Noise riser into the stage-1 drop.
      oneShot<Chord>(2, 0, ({ time }) => riser(time, BAR * 2, 0.1)),
    ],
  };

  const stage1Section = {
    name: 'stage-1',
    fromBar: MASS_DRIVER_BARS.stage1,
    toBar: MASS_DRIVER_BARS.stage2,
    tracks: [
      padTrack(MASS_DRIVER_BARS.stage1, 0.045),
      kickTrack(fourKick),
      hatTrack(offbeatHat),
      bassTrack(eighthBass),
      hits<Chord>('A.......A.....A.', { A: 0.42 }, ({ time, step, chord }, vel) =>
        arp(time, chord.arp[(step / 2) % chord.arp.length] - 12, vel)),
      oneShot<Chord>(6, 0, ({ time }) => riser(time, BAR * 2, 0.12)),
    ],
  };

  const stage2Section = {
    name: 'stage-2',
    fromBar: MASS_DRIVER_BARS.stage2,
    toBar: MASS_DRIVER_BARS.interlock,
    tracks: [
      padTrack(MASS_DRIVER_BARS.stage2, 0.04),
      kickTrack(fourKick),
      hits(clapBackbeat, { C: 1 }, ({ time }, vel) => clap(time, vel)),
      hatTrack(latticeHat),
      bassTrack(busyBass),
      // The arp lifts an octave.
      hits<Chord>('A.A...A.A...A.A.', { A: 0.4 }, ({ time, step, chord }, vel) =>
        arp(time, chord.arp[(step / 2) % chord.arp.length], vel)),
      // The 303 acid line walking the chord, opening across the section.
      fn<Chord>(({ barInSection, step, time, chord }) => {
        const offset = ACID_OFFSETS[step];
        if (offset === null) return;
        const accent = ACID_ACCENTS[step];
        const sweep = 700 + (barInSection / 8) * 2100 + accent * 650;
        acid(time, chord.bass + 12 + offset, 0.5 + accent * 0.5, sweep);
      }),
      // Riser into the klaxon; the spawn breath is authored in gameplay.
      oneShot<Chord>(6, 0, ({ time }) => riser(time, BAR * 2, 0.14)),
    ],
  };

  const interlockSection = {
    name: 'interlock',
    fromBar: MASS_DRIVER_BARS.interlock,
    toBar: MASS_DRIVER_BARS.shot,
    tracks: [
      padTrack(MASS_DRIVER_BARS.interlock, 0.05),
      // A two-bar klaxon and a low impact announce the jam.
      oneShot<Chord>(0, 0, ({ time }) => {
        impact(time, 0.85);
        for (let i = 0; i < 8; i += 1) {
          klaxon(time + i * BEAT, i % 2 === 0 ? 52 : 53, 1 - i * 0.06);
        }
      }),
      // The kick gains late-bar syncopation as the charge builds.
      fn<Chord>(({ barInSection, step, time }) => {
        if (step % 4 === 0) kick(time, step === 0 ? 1 : 0.9);
        if (barInSection >= 2 && step === 14) kick(time, 0.62);
        if (barInSection >= 4 && step === 7) ghostKick(time, 0.8);
      }),
      hits(clapBackbeat, { C: 0.85 }, ({ time }, vel) => clap(time, vel)),
      hatTrack(tightHat, 0.8),
      bassTrack(eighthBass),
      // Rising alarm sweeps every couple of bars.
      fn<Chord>(({ barInSection, step, time }) => {
        if (step !== 0 || barInSection < 2 || barInSection % 2 !== 0) return;
        alarmSweep(time, 52 + barInSection, BAR * 0.72, 0.75 + barInSection * 0.05);
      }),
      // A noise riser that grows each bar.
      fn<Chord>(({ barInSection, step, time }) => {
        if (step !== 0 || barInSection >= 7) return;
        riser(time, BAR, 0.035 + barInSection * 0.014);
      }),
      // Final bar: a snare roll building all the way into the shot.
      fn<Chord>(({ barInSection, step, time }) => {
        if (barInSection !== 7) return;
        const drive = step / 16;
        snare(time, 0.2 + drive * 0.6);
        if (step >= 10) snare(time + THIRTYSECOND, 0.24 + drive * 0.6);
      }),
    ],
  };

  const muzzleSection = {
    name: 'muzzle',
    fromBar: MASS_DRIVER_BARS.shot,
    toBar: MASS_DRIVER_BARS.end,
    tracks: [
      // THE SHOT: on the downbeat — impact, crash, a hard duck, the hum cut,
      // and a huge E-major pad bloom. Suppressed if the barrel detonated.
      oneShot<Chord>(0, 0, ({ time }) => {
        if (!isTrace && interlocksAlive.size > 0) return;
        shotFired = true;
        hum.humCut(time);
        impact(time, 1);
        crash(time, 1);
        runtime.mix()?.duckAt(time, 0.07, 2.4);
        pad(time, [40, 52, 56, 59, 64, 71], BAR * 3.6, 0.055);
        [76, 80, 83, 88].forEach((midi, index) => shimmer(time + 0.4 + index * BEAT * 0.5, midi, 0.6 - index * 0.1));
      }),
      // Then only glassy sparkle delays and a subsiding sub pulse.
      fn<Chord>(({ barInSection, step, time, chord }) => {
        if (!shotFired && !isTrace) return;
        if (barInSection >= 1 && (step === 2 || step === 9)) {
          shimmer(time, chord.arp[(barInSection + step) % chord.arp.length] + 12, Math.max(0.08, 0.42 - barInSection * 0.12));
        }
        if (barInSection < 3 && step % 4 === 0) {
          subPulse(time, 40, Math.max(0.05, 0.3 - barInSection * 0.1 - step * 0.004));
        }
      }),
    ],
  };

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [injectionSection, stage1Section, stage2Section, interlockSection, muzzleSection],
  });

  // Attract mode: just a long pad and quarter arps over the idle hum.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0, 0.035),
        hits<Chord>('A...A...A...A...', { A: 0.28 }, ({ time, step, chord }, vel) =>
          arp(time, chord.arp[(step / 4) % chord.arp.length] - 12, vel)),
      ],
    }],
  });

  let ambientMutedUntil = 0;

  function scheduleStep({ position, time, mode, step, bar }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      if (time < ambientMutedUntil) return;
      ambientArrangement.schedule(position, time);
      return;
    }
    // Steer the climbing hum bar by bar; the last bar accelerates the rise.
    if (step === 0 && bar !== lastHumBar && bar < MASS_DRIVER_BARS.shot) {
      lastHumBar = bar;
      const plan = humPlanForBar(bar);
      hum.humTarget(time, plan.midi, plan.level, plan.cutoff, bar >= 26 ? BAR * 0.85 : BAR);
      if (bar === MASS_DRIVER_BARS.shot - 1) {
        // The final accelerating pull into the charge peak.
        hum.humTarget(time + BAR * 0.5, 59, 0.2, 3600, BAR * 0.48);
      }
    }
    runArrangement.schedule(position, time);
    if (position % STEPS_PER_BAR === 0) runArrangement.recordSectionStart(time, bar);
  }

  // ---- the player is the soloist ---------------------------------------------

  const kindById = new Map<number, string>();
  const interlocksAlive = new Set<number>();
  let interlockKillCount = 0;
  let shotFired = false;
  let lastUnlockTickAt = -1;

  bus.on('spawn', ({ enemyId, kind }) => {
    kindById.set(enemyId, kind);
    if (kind === 'interlock') interlocksAlive.add(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    kindById.delete(enemyId);
    interlocksAlive.delete(enemyId);
  });

  function sectionLayersAt(position: number): Array<[SectionIndex, number]> {
    const mix: SectionMix<SectionIndex> = score.sectionMixAt(position);
    return mix.from === mix.to
      ? [[mix.to, 1]]
      : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  function killNote(time: number, position: number, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const sectionMix = score.sectionMixAt(position);
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    if (midi === undefined) return;
    const fromVoice = SECTION_VOICES[sectionMix.from].kill;
    const toVoice = SECTION_VOICES[sectionMix.to].kill;
    const vel = Math.min(1.35, 1 + chain * 0.12);
    const decay = lerp(fromVoice.decay, toVoice.decay, sectionMix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, sectionMix.t);
    const shimmerAmount = lerp(fromVoice.shimmer, toVoice.shimmer, sectionMix.t);
    const hall = lerp(fromVoice.hall, toVoice.hall, sectionMix.t);

    for (const [section, weight] of sectionLayersAt(position)) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice: SECTION_VOICES[section].kill,
        velocity: vel,
        weight,
        destination: output,
        sends: [
          { destination: audioMix.delaySend, gain: 0.45 },
          ...(audioMix.reverbSend ? [{ destination: audioMix.reverbSend, gain: hall }] : []),
        ],
      });
    }
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    noiseHit(time, 0.04 * shimmerAmount + 0.02, 0.07, 'highpass', 5400, output);
  }

  // Each interlock kill plays a climbing confirmation — one more note than
  // the last, brighter and higher each time, capped with an ignition ping and
  // a clamp-release clank that drops in pitch per interlock.
  function interlockConfirmation(count: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const delaySend = audioMix.delaySend;
    const reverbSend = audioMix.reverbSend;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);

    clank(time, 520 * 2 ** (-(count - 1) / 7), 0.9);
    for (let i = 0; i < count; i += 1) {
      const at = time + i * SIXTEENTH;
      const midi = lead[Math.min(lead.length - 1, 1 + i)];
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.3,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1900 + count * 320 },
        gainAutomation: [
          { type: 'set', value: 0.075 + count * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.26 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.4 }],
      });
    }
    // Ignition ping on top.
    const pingAt = time + count * SIXTEENTH;
    playOscillatorVoice({
      context: ctx,
      time: pingAt,
      stopTime: pingAt + 0.5,
      oscillatorType: 'sine',
      frequency: midiToFreq(lead[7] + 12),
      gainAutomation: [
        { type: 'set', value: 0.1 + count * 0.012, time: pingAt },
        { type: 'exponentialRamp', value: 0.001, time: pingAt + 0.45 },
      ],
      destination: output,
      sends: [{ destination: delaySend, gain: 0.55 }],
    });

    if (count >= 6) {
      // The sixth: a beat of ducked silence, an impact, a high chord stab,
      // and a conclusive descent.
      const stabAt = score.nextGridTime(ctx.currentTime + BEAT * 0.5, 2);
      runtime.mix()?.duckAt(stabAt - 0.02, 0.12, BEAT * 1.5);
      impact(stabAt, 0.7);
      const chord = score.chordAt(score.arrangementPositionAt(stabAt));
      for (const midi of chord.pad) {
        playOscillatorVoice({
          context: ctx,
          time: stabAt,
          stopTime: stabAt + 0.55,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi + 24),
          filter: { type: 'lowpass', frequency: 3000 },
          gainAutomation: [
            { type: 'set', value: 0.05, time: stabAt },
            { type: 'exponentialRamp', value: 0.001, time: stabAt + 0.5 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.5 }],
        });
      }
      [7, 5, 3, 0].forEach((degree, index) => {
        if (!ctx) return;
        const at = stabAt + BEAT * 0.5 + index * SIXTEENTH;
        playOscillatorVoice({
          context: ctx,
          time: at,
          stopTime: at + 0.4,
          oscillatorType: 'triangle',
          frequency: midiToFreq(lead[degree]),
          gainAutomation: [
            { type: 'set', value: 0.1 - index * 0.012, time: at },
            { type: 'exponentialRamp', value: 0.001, time: at + 0.35 },
          ],
          destination: output,
          sends: [
            { destination: delaySend, gain: 0.5 },
            ...(reverbSend ? [{ destination: reverbSend, gain: 0.5 }] : []),
          ],
        });
      });
    }
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kind = kindById.get(enemyId);
    kindById.delete(enemyId);
    if (kind === 'interlock') {
      interlocksAlive.delete(enemyId);
      interlockKillCount += 1;
      interlockConfirmation(interlockKillCount);
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, indexInVolley ?? 0);
  });

  // Locks walk up the live lead by lock count; the sixth lock is ignition —
  // an octave ping and a falling sub thump.
  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    for (const [section, weight] of sectionLayersAt(position)) {
      if (weight < 0.02) continue;
      const voiceSpec = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: voiceSpec.oscillator,
        cutoff: voiceSpec.cutoff,
        gainValue: voiceSpec.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.35 }],
      });
    }
    if (lockCount >= 6) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.4,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi + 12),
        gainAutomation: [
          { type: 'set', value: 0.12, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.35 },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sine',
        frequency: 110,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 46, time: time + 0.2 }],
        gainAutomation: [
          { type: 'set', value: 0.3, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
        ],
        destination: output,
      });
    }
  });

  // Unlock answers with a soft high tick (throttled — releases unlock in bulk).
  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    if (ctx.currentTime - lastUnlockTickAt < 0.09) return;
    lastUnlockTickAt = ctx.currentTime;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.08,
      oscillatorType: 'sine',
      frequency: midiToFreq(lead[lead.length - 1] + 12),
      gainAutomation: [
        { type: 'set', value: 0.03, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
      ],
      destination: output,
    });
  });

  // Fire is a short falling zap rooted on the live chord.
  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const fromFire = SECTION_VOICES[sectionMix.from].fire;
    const toFire = SECTION_VOICES[sectionMix.to].fire;
    const cutoff = lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t);
    const noise = lerp(fromFire.noise, toFire.noise, sectionMix.t);
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      destination: output,
    });
    noiseHit(time, noise, 0.02, 'highpass', 3200, output);
  });

  // Armor chips tick a soft arpeggio; stage breaks crack metallically and
  // ring a chord tone into the hall.
  bus.on('hit', ({ lethal }) => {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (lethal || !ctx || !output || !audioMix?.delaySend) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arpNotes = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.07], [1, 0.055]] as const).forEach(([index, vel]) => {
      if (!ctx) return;
      chipVoice.play({
        context: ctx,
        time: time + THIRTYSECOND * index,
        midi: arpNotes[index] + 12,
        vel,
        destination: output,
        sends: [{ destination: delaySend, gain: 0.35 }],
      });
    });
    noiseHit(time, 0.03, 0.03, 'highpass', 5800, output);
  });

  bus.on('stage', () => {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    clank(time, 430, 1);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.9,
      oscillatorType: 'triangle',
      frequency: midiToFreq(chord.arp[2]),
      gainAutomation: [
        { type: 'set', value: 0.09, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
      ],
      destination: output,
      sends: audioMix.reverbSend ? [{ destination: audioMix.reverbSend, gain: 0.6 }] : undefined,
    });
  });

  // A full clean volley lands a chord stab an octave up — the music applauds.
  bus.on('volley', ({ size, kills }) => {
    const audioMix = runtime.mix();
    if (!ctx || !audioMix?.duck || !audioMix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2500 },
        gainAutomation: [
          { type: 'set', value: kills >= 6 ? 0.06 : 0.045, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: audioMix.duck,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, kills >= 6 ? 0.1 : 0.06, 0.3, 'highpass', 7000, audioMix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    rejectVoice.play({ context: ctx, time, midi: 29, vel: 0.2, destination: output });
    rejectVoice.play({ context: ctx, time: time + 0.05, midi: 28, vel: 0.16, destination: output });
    noiseHit(time, 0.12, 0.08, 'bandpass', 640, output);
  });

  // A player hit booms a falling octave under a two-note hull alarm.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    hullBoomVoice.play({ context: ctx, time, frequency: 104, destination: output });
    alarmBeepVoice.play({ context: ctx, time: time + 0.08, midi: 77, vel: 1, destination: output });
    alarmBeepVoice.play({ context: ctx, time: time + 0.22, midi: 76, vel: 0.8, destination: output });
    noiseHit(time, 0.16, 0.12, 'bandpass', 880, output);
  });

  // A miss is a barely-there falling tick.
  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.12,
      oscillatorType: 'sine',
      frequency: 640,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 320, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.028, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
      ],
      destination: output,
    });
  });

  // Detonation / death: cut the music to a long low sub rumble and filtered noise.
  bus.on('runend', ({ died }) => {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix || !died) return;
    const time = ctx.currentTime;
    hum.humCut(time);
    ambientMutedUntil = time + 4.5;
    audioMix.duckAt(time, 0.05, 3.4);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 3.2,
      oscillatorType: 'sine',
      frequency: 44,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 27, time: time + 2.4 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 3.0 },
      ],
      destination: output,
    });
    noiseHit(time, 0.3, 1.8, 'lowpass', 500, output);
    noiseHit(time + 0.05, 0.14, 2.6, 'bandpass', 240, output);
  });

  return runtime;
}
