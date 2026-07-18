import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createHumRig, createMassDriverVoices, type HumRig } from './audio-voices';
import {
  MASS_DRIVER_BARS,
  MASS_DRIVER_BPM,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  SIXTEENTH_SECONDS,
} from './timing';

// MASS DRIVER — the gun is the instrument.
//
// 128 BPM locked minimal techno in E minor. The main loop is Em–Em–C–D, two
// bars per chord; the interlock bars switch to Em–F–Em–F for the ♭II Phrygian
// dread; the muzzle resolves to one sustained E MAJOR bloom — the whole run is
// minor and the release is major.
//
// Underneath all of it a persistent hum climbs from E1 to the charge peak and is
// cut dead by THE SHOT. Everything the player does is a note inside that score:
// locks walk the live lead, kills read hidden per-section melody lanes, and all
// of it is quantized to the transport's real grid rather than to clock zero.

const SIXTEENTH = SIXTEENTH_SECONDS;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; acid: number[] };

const EM: Chord = { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], acid: [64, 67, 71, 74] };
const C: Chord = { bass: 24, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72], acid: [60, 64, 67, 70] };
const D: Chord = { bass: 26, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74], acid: [62, 66, 69, 72] };
const F: Chord = { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], acid: [65, 69, 72, 75] };
const E_MAJOR: Chord = { bass: 28, pad: [52, 56, 59, 64], arp: [64, 68, 71, 76], acid: [64, 68, 71, 76] };

const MAIN_PROGRESSION = [EM, EM, C, D];
const BOSS_PROGRESSION = [EM, F, EM, F];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// The hidden lead. Degrees index the current chord's lead set (arp plus the same
// notes an octave up), so a kill on any step of any bar lands on a chord tone —
// and a chained volley walks consecutive steps as a real melodic run.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Injection — a slow stepwise arch off the breech.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Stage 1 — the pulse locks in; the line starts driving in thirds.
  1: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 2, 3, 1, 2, 0, 1, 3,
    4, 6, 5, 7, 6, 4, 5, 3,
    4, 2, 3, 5, 4, 3, 2, 1,
  ],
  // Stage 2 — octave zig-zags, so dense volleys ring out as broken-chord runs.
  2: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 1, 5, 2, 6, 3, 7,
    7, 5, 6, 4, 5, 3, 4, 2,
  ],
  // Interlock — high descending peals answered by a climb back to the top.
  3: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
  // Muzzle — wide and glassy. The muzzle bars are empty by design; this lane
  // exists so the score stays well-formed rather than because it will sound.
  4: [
    7, 5, 4, 2, 4, 5, 7, 5,
    4, 2, 0, 2, 4, 5, 7, 5,
    7, 5, 4, 2, 4, 5, 7, 5,
    4, 2, 0, 2, 4, 5, 7, 5,
  ],
};

type KillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; hall: number };

// Per-section voicing for the player's instruments. Gains are tuned by perceived
// loudness, not by matching numbers: a saw at the same gain as a sine is far
// louder, and the lock has to stay a tick in every section.
const SECTION_VOICES: Record<SectionIndex, {
  kill: KillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  // Glassy at the breech.
  0: {
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 4200, gain: 0.18, hall: 0.3 },
    lock: { oscillator: 'triangle', cutoff: 3000, gain: 0.14 },
    fire: { cutoff: 2000, noise: 0.03 },
  },
  // Tight and square in stage 1.
  1: {
    kill: { oscillator: 'square', decay: 0.2, cutoff: 2400, gain: 0.13, hall: 0.22 },
    lock: { oscillator: 'square', cutoff: 2100, gain: 0.06 },
    fire: { cutoff: 2900, noise: 0.04 },
  },
  // Bright saws in stage 2.
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.26, cutoff: 3600, gain: 0.115, hall: 0.32 },
    lock: { oscillator: 'sawtooth', cutoff: 2600, gain: 0.05 },
    fire: { cutoff: 4000, noise: 0.055 },
  },
  // Dark, reverb-heavy saws at the interlocks.
  3: {
    kill: { oscillator: 'sawtooth', decay: 0.46, cutoff: 1700, gain: 0.135, hall: 0.62 },
    lock: { oscillator: 'sawtooth', cutoff: 1500, gain: 0.055 },
    fire: { cutoff: 2200, noise: 0.07 },
  },
  // Quiet and hall-drenched at the muzzle.
  4: {
    kill: { oscillator: 'triangle', decay: 0.9, cutoff: 3000, gain: 0.085, hall: 0.85 },
    lock: { oscillator: 'sine', cutoff: 3400, gain: 0.075 },
    fire: { cutoff: 3000, noise: 0.02 },
  },
};

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-detailed-om5e',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let hum: HumRig | null = null;
  let humCutUntilRunEnd = false;
  // The hum is a persistent voice, so silence has to be held rather than merely
  // triggered: without this the next beat's idle steer would fade it straight
  // back in under the muzzle's silence or the detonation's rumble.
  let humHoldUntil = 0;
  let lastUnlockTick = -1;
  const interlockIds = new Set<number>();
  let interlocksDown = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: MAIN_PROGRESSION,
    barsPerChord: 2,
    alternateChordSets: [
      // The ♭II Phrygian dread while the interlocks are jammed...
      { fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.shot, chords: BOSS_PROGRESSION, barsPerChord: 2 },
      // ...and a Picardy third at the muzzle.
      { fromBar: MASS_DRIVER_BARS.shot, chords: [E_MAJOR], barsPerChord: 4 },
    ],
    sections: MASS_DRIVER_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });
  // Attract mode speaks in the breech's voice, not whatever section the free
  // running transport happens to have wandered into.
  score.overrideSection(0);

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    stepsPerBar: STEPS_PER_BAR,
    volumeScale: 0.82,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -17, ratio: 5, attack: 0.004, release: 0.2 },
      // A dotted-eighth delay: three sixteenths.
      delay: { time: SIXTEENTH * 3, feedback: 0.36, dampHz: 2900 },
      reverb: { seconds: 3.0, decay: 2.3, level: 0.32 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      hum?.dispose();
      hum = createHumRig(context, mix.master);
      hum.setPitch(28, context.currentTime, 0.01);
      hum.setOpen(220, context.currentTime, 0.01);
      hum.setLevel(0.055, context.currentTime, 0.4);
    },
    onBeforeBeat: steerHum,
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      interlockIds.clear();
      interlocksDown = 0;
      humCutUntilRunEnd = false;
      const context = runtime.context();
      if (!context) return;
      // Ring crossings land on quarter notes of the RUN clock, so the transport
      // is re-zeroed at the downbeat of the run rather than left on whatever
      // phase the attract loop happened to reach. This is the one thing in the
      // level that must not drift.
      const at = context.currentTime + 0.03;
      runtime.transport().reset(at, 0);
      score.setEpoch(at);
      score.restartArrangement(0, { align: 'step' });
      humHoldUntil = 0;
    },
    onRunEnd() {
      score.overrideSection(0);
      const context = runtime.context();
      if (!context) return;
      // Let the ending breathe, then let the idle steer slide the hum back down
      // to E1 underneath the replay screen — the gun powering off.
      humHoldUntil = context.currentTime + (humCutUntilRunEnd ? 1.9 : 0.3);
    },
    onDispose() {
      hum?.dispose();
      hum = null;
      ctx = null;
    },
  });

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, clap, hat, snare, bass, acid, pad, arp, klaxon, alarm, riser,
    impact, crash, sparkle, subPulse, rumble, noiseHit,
  } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- the climbing hum -------------------------------------------------------

  function humMidiForBar(barFloat: number) {
    if (barFloat < MASS_DRIVER_BARS.stage2 + 4) return 28 + (barFloat / 16) * 5; // E1 → up a fourth
    if (barFloat < MASS_DRIVER_BARS.interlock) return 33 + ((barFloat - 16) / 4) * 7; // → up an octave
    const t = Math.min(1, (barFloat - MASS_DRIVER_BARS.interlock) / 8);
    return 40 + t ** 1.9 * 15; // accelerating rise into the firing charge
  }

  function steerHum(step: BeatLevelAudioStep) {
    if (!hum || trace) return;
    if (step.mode !== 'run') {
      if (step.time < humHoldUntil) return;
      // Idle: low, with a slow wobble.
      hum.setPitch(28 + Math.sin(step.time * 0.55) * 0.35, step.time, 0.5);
      hum.setOpen(220, step.time, 0.5);
      hum.setLevel(0.055, step.time, 0.5);
      return;
    }
    if (humCutUntilRunEnd) return;
    const barFloat = step.position / STEPS_PER_BAR;
    const charge = Math.max(0, Math.min(1, (barFloat - MASS_DRIVER_BARS.interlock) / 8));
    hum.setPitch(humMidiForBar(barFloat), step.time, 0.08);
    hum.setOpen(240 + (barFloat / 28) * 1400 + charge * 1400, step.time, 0.12);
    hum.setLevel(0.06 + (barFloat / 28) * 0.16 + charge * charge * 0.14, step.time, 0.12);
  }

  // ---- arrangement -------------------------------------------------------------

  const blank = '................';
  const injectionKick = 'K...............' + 'K.......g.......' + 'K...g...K...g...' + 'K...g...K...g.g.';
  const injectionHat = blank + '........h.......' + '....h...h...h...' + '..h.h...h.h.h.h.';
  const fourOnFloor = 'K...K...K...K...';
  const syncopatedKick = 'K...K...K...K.K.';
  const offbeatHat = '..h...h...h...h.';
  const latticeHat = 'hhHhhhOhhhHhhhOh';
  const backbeatClap = '....C.......C...';
  const eighthBass = 'B.b.B.b.B.b.B.b.';
  const jumpBass = 'B.b.o.b.B.b.u.o.';
  const bossBass = 'B.b.B.b.B.bB.b.b';
  const quarterArp = 'A...A...A...A...';
  const eighthArp = 'A.A.A.A.A.A.A.A.';
  const sparseArp = 'A.......A.......';
  const acidLine = 'x.xx.x.xX.x.xx.x' + 'x.x.xxX..x.xx.xX';

  function padTrack(bright: number, bars = 2) {
    return hits<Chord>(
      'P...............' + blank.repeat(bars - 1),
      { P: 1 },
      ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * STEPS_PER_BAR * bars * 1.04, bright),
    );
  }

  function kickTrack(pattern: string) {
    return hits<Chord>(pattern, { K: 1, g: 0.42 }, ({ time }, vel) => kick(time, vel));
  }

  function hatTrack(pattern: string) {
    return hits<Chord>(pattern, { h: 0.05, H: 0.09, O: 0.15 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'O' ? 0.19 : 0.028));
  }

  function bassTrack(pattern: string, gain = 1) {
    return hits<Chord>(pattern, { B: 1, b: 0.72, o: 0.8, u: 0.78, f: 0.7 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'o' ? 12 : symbol === 'u' ? 7 : symbol === 'f' ? 19 : 0;
      bass(time, chord.bass + 12 + offset, vel * gain);
    });
  }

  function arpTrack(pattern: string, vel: number, octave = 0) {
    return hits<Chord>(pattern, { A: vel }, ({ time, step, chord }, velocity) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      arp(time, chord.arp[order[(step / 2) % order.length]] + octave, velocity);
    });
  }

  // The 303: walks the chord, accents slide.
  function acidTrack(cutoffBase: number) {
    return hits<Chord>(acidLine, { x: 0.75, X: 1 }, ({ time, position, chord }, vel, symbol) => {
      const degree = [0, 2, 1, 3, 2, 1, 3, 0][position % 8];
      const slide = symbol === 'X' ? 1 : 0;
      acid(time, chord.acid[degree] - 12, vel, cutoffBase + (symbol === 'X' ? 1500 : 0), slide);
    });
  }

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'attract',
      fromBar: 0,
      tracks: [
        padTrack(0.15, 4),
        hits<Chord>(quarterArp, { A: 0.42 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        // Injection — the breech. Sparse downbeat kick with ghosts creeping in,
        // sparse hats, a quarter-note arp climbing in velocity, a riser into the drop.
        name: 'injection',
        fromBar: MASS_DRIVER_BARS.injection,
        toBar: MASS_DRIVER_BARS.stage1,
        tracks: [
          padTrack(0.2, 4),
          kickTrack(injectionKick),
          hatTrack(injectionHat),
          hits<Chord>(quarterArp.repeat(4), { A: 1 }, ({ time, step, barInSection, chord }) => {
            arp(time, chord.arp[(step / 4) % chord.arp.length], 0.22 + barInSection * 0.11);
          }),
          oneShot(3, 0, ({ time }) => riser(time, SIXTEENTH * STEPS_PER_BAR, 0.13)),
        ],
      },
      {
        // Stage 1 — the four-on-floor locks in.
        name: 'stage-1',
        fromBar: MASS_DRIVER_BARS.stage1,
        toBar: MASS_DRIVER_BARS.stage2,
        tracks: [
          padTrack(0.3),
          kickTrack(fourOnFloor),
          hatTrack(offbeatHat),
          bassTrack(eighthBass),
          arpTrack(sparseArp, 0.4),
        ],
      },
      {
        // Stage 2 — claps, a sixteenth hat lattice, a busier bass, and the acid line.
        name: 'stage-2',
        fromBar: MASS_DRIVER_BARS.stage2,
        toBar: MASS_DRIVER_BARS.interlock,
        tracks: [
          padTrack(0.5),
          kickTrack(fourOnFloor),
          hits<Chord>(backbeatClap, { C: 1 }, ({ time }, vel) => clap(time, vel)),
          hatTrack(latticeHat),
          bassTrack(jumpBass),
          arpTrack(eighthArp, 0.42, 12),
          acidTrack(1500),
        ],
      },
      {
        // Interlock — klaxon, syncopation, alarms, a riser that grows each bar,
        // and a snare roll in the final bar that builds all the way into the shot.
        name: 'interlock',
        fromBar: MASS_DRIVER_BARS.interlock,
        toBar: MASS_DRIVER_BARS.shot,
        tracks: [
          padTrack(0.42),
          kickTrack(syncopatedKick),
          hits<Chord>(backbeatClap, { C: 0.9 }, ({ time }, vel) => clap(time, vel)),
          hatTrack(latticeHat),
          bassTrack(bossBass, 1.05),
          acidTrack(1100),
          // The two-bar klaxon and the impact that announces the deadline.
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.1);
            klaxon(time, 64, SIXTEENTH * 6, 1);
            klaxon(time + SIXTEENTH * 8, 61, SIXTEENTH * 6, 0.95);
          }),
          oneShot(1, 0, ({ time }) => {
            klaxon(time, 64, SIXTEENTH * 6, 0.9);
            klaxon(time + SIXTEENTH * 8, 61, SIXTEENTH * 6, 0.85);
          }),
          // Rising alarm sweeps every couple of bars, climbing as the charge does.
          fn<Chord>(({ time, barInSection, step }) => {
            if (step !== 0 || barInSection < 2 || barInSection % 2 !== 0) return;
            const rung = (barInSection - 2) / 2;
            alarm(time, SIXTEENTH * 12, 52 + rung * 3, 76 + rung * 4);
          }),
          // A noise riser that grows each bar.
          fn<Chord>(({ time, barInSection, step }) => {
            if (step !== 0 || barInSection < 2) return;
            riser(time, SIXTEENTH * STEPS_PER_BAR, 0.05 + barInSection * 0.022);
          }),
          // The last bar: a snare roll accelerating into the shot.
          fn<Chord>(({ time, barInSection, step }) => {
            if (barInSection !== 7) return;
            if (step % 4 === 0 || step >= 8) snare(time, 0.3 + (step / 16) * 0.85);
          }),
        ],
      },
      {
        // THE SHOT and the muzzle. Impact, crash, a hard duck, the hum cut, and a
        // huge E-major bloom — then only glassy sparkle delays over a subsiding
        // sub pulse, fading to silence. Resist the urge to fill this.
        name: 'muzzle',
        fromBar: MASS_DRIVER_BARS.shot,
        toBar: MASS_DRIVER_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.5);
            crash(time, 1);
            runtime.mix()?.duckAt(time, 0.12, 1.4);
            if (hum && !trace) {
              hum.cut(time);
              humCutUntilRunEnd = true;
            }
            pad(time, chord.pad, SIXTEENTH * STEPS_PER_BAR * 8, 1);
            pad(time + 0.02, chord.pad.map((midi) => midi + 12), SIXTEENTH * STEPS_PER_BAR * 6, 0.8);
          }),
          // Glassy sparkle delays, thinning bar by bar.
          fn<Chord>(({ time, barInSection, step, chord }) => {
            if (barInSection < 1) return;
            const density = [0, 4, 8, 8][Math.min(3, barInSection)];
            if (density === 0 || step % density !== 0) return;
            sparkle(time, chord.arp[(step / 4 + barInSection) % chord.arp.length] + 12, 1 - barInSection * 0.24);
          }),
          // A subsiding sub pulse on the downbeats.
          fn<Chord>(({ time, barInSection, step, chord }) => {
            if (step !== 0) return;
            subPulse(time, chord.bass, Math.max(0, 0.34 - barInSection * 0.1), 1.2);
          }),
        ],
      },
    ],
  });

  function scheduleStep(step: BeatLevelAudioStep) {
    if (step.mode === 'ambient') ambientArrangement.schedule(step.position, step.time);
    else runArrangement.schedule(step.position, step.time);
  }

  // ---- the player's instruments -------------------------------------------------

  const killLayerVoice = voice<{ killVoice: KillVoice }>({
    oscillators: [{ type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain }],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { decay: ({ killVoice }) => killVoice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.36 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 220 },
    envelope: { decay: 0.1 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.085 }],
    duration: 0.075,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.12,
    stopPadding: 0.02,
    filter: { type: 'highpass', cutoff: 700 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  // The breaker trip: a dead low minor second falling into the floor. Cold iron.
  const rejectVoice = voice<{ vel: number; endFrequency: number }>({
    oscillators: [{ type: 'square', gain: 0.7 }, { type: 'sawtooth', gain: 0.3 }],
    duration: 0.34,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 2.5,
      frequencyAutomation: (time) => [
        { type: 'set', value: 900, time },
        { type: 'exponentialRamp', value: 160, time: time + 0.24 },
      ],
    },
    frequencyAutomation: (time, _frequency, { endFrequency }) => [
      { type: 'exponentialRamp', value: endFrequency, time: time + 0.3 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.55,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 42, time: time + 0.38 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.44, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
    ],
  });

  const hullAlarmVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.2,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 4, cutoff: 1500 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = runtime.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function sectionLayers(mix: SectionMix<SectionIndex>): Array<[SectionIndex, number]> {
    return mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  // ---- kills: the player is the soloist ------------------------------------------

  function killNote(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // The lane contour flips at the halfway point; the timbre is what needs the
    // smooth handover, not the (always consonant) note choice.
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const from = SECTION_VOICES[mix.from].kill;
    const to = SECTION_VOICES[mix.to].kill;
    const vel = Math.min(1.4, 1 + chain * 0.12);
    const decay = lerp(from.decay, to.decay, mix.t);
    const gain = lerp(from.gain, to.gain, mix.t);
    const hall = lerp(from.hall, to.hall, mix.t);

    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice: SECTION_VOICES[section].kill,
        velocity: vel,
        weight,
        destination: output,
        sends: playerSends(0.42, hall),
      });
    }
    // A pure-tone body an octave down keeps square and saw voices from thinness.
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.5, hall) });
    }
    noiseHit(time, 0.035 + hall * 0.03, 0.06, 'highpass', 6200, output);
  }

  // Each interlock destroyed plays a climbing confirmation: one more note than
  // the last, brighter and higher each time, capped with an ignition ping and a
  // clamp-release clank that drops in pitch per interlock.
  function interlockConfirmation(index: number) {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const chord = score.chordAt(position);
    const brightness = 0.35 + index * 0.13;

    for (let note = 0; note <= index; note += 1) {
      const at = time + note * THIRTYSECOND * 2;
      const midi = lead[Math.min(lead.length - 1, note + index)] + 12;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.4,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1600 + brightness * 3800 },
        gainAutomation: [
          { type: 'set', value: 0.075 + index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.34 },
        ],
        destination: output,
        sends: playerSends(0.4, 0.5),
      });
    }

    // The ignition ping on top.
    const pingAt = time + (index + 1) * THIRTYSECOND * 2;
    playOscillatorVoice({
      context: ctx,
      time: pingAt,
      stopTime: pingAt + 0.6,
      oscillatorType: 'sine',
      frequency: midiToFreq(chord.arp[0] + 24),
      gainAutomation: [
        { type: 'set', value: 0.1 + index * 0.012, time: pingAt },
        { type: 'exponentialRamp', value: 0.001, time: pingAt + 0.55 },
      ],
      destination: output,
      sends: playerSends(0.55, 0.6),
    });

    // The clamp releasing: a metallic clank, lower with every interlock freed.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.34,
      oscillatorType: 'square',
      frequency: midiToFreq(52 - index * 3),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(34 - index * 3), time: time + 0.16 }],
      filter: { type: 'bandpass', frequency: 1100, Q: 3 },
      gainAutomation: [
        { type: 'set', value: 0.2, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
      ],
      destination: output,
    });
    noiseHit(time, 0.16, 0.09, 'bandpass', 2600, output);
    if (mix?.reverbSend) noiseHit(time, 0.1, 0.5, 'highpass', 3000, mix.reverbSend);
  }

  // The sixth: a beat of ducked silence, an impact, a high chord stab, and a
  // conclusive descent. The gun is clear.
  function interlocksClear() {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    mix.duckAt(time, 0.14, 1.1);
    impact(time + SIXTEENTH * 4, 1.25);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);

    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time: time + SIXTEENTH * 4,
        stopTime: time + SIXTEENTH * 4 + 0.7,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 24),
        filter: { type: 'lowpass', frequency: 4200 },
        gainAutomation: [
          { type: 'set', value: 0.055, time: time + SIXTEENTH * 4 },
          { type: 'exponentialRamp', value: 0.001, time: time + SIXTEENTH * 4 + 0.65 },
        ],
        destination: output,
        sends: playerSends(0.5, 0.7),
      });
    }

    // A conclusive descent down the lead set.
    const lead = score.leadSetAt(position);
    [7, 6, 4, 2, 0].forEach((degree, index) => {
      if (!ctx) return;
      const at = time + SIXTEENTH * (6 + index * 2);
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.5,
        oscillatorType: 'triangle',
        frequency: midiToFreq(lead[degree] + 12),
        filter: { type: 'lowpass', frequency: 4600 },
        gainAutomation: [
          { type: 'set', value: 0.11 - index * 0.012, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
        ],
        destination: output,
        sends: playerSends(0.6, 0.6),
      });
    });
  }

  // ---- event wiring ---------------------------------------------------------------

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (interlockIds.delete(enemyId)) {
      interlockConfirmation(interlocksDown);
      interlocksDown += 1;
      if (interlocksDown >= 6) interlocksClear();
      return;
    }
    // Each kill takes at least the step after the previous one, so rapid volley
    // kills never stack — they walk the lane note by note.
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  // Locks walk up the live lead by lock count; the sixth is ignition.
  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.max(1, lockCount) - 1)];

    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const lockSpec = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: lockSpec.oscillator,
        cutoff: lockSpec.cutoff,
        gainValue: lockSpec.gain,
        lockCount,
        weight,
        destination: output,
        sends: playerSends(0.35, 0.2),
      });
    }

    if (lockCount !== 6) return;
    // Ignition: an octave ping over a falling sub thump.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.6,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi + 12),
      gainAutomation: [
        { type: 'set', value: 0.16, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
      ],
      destination: output,
      sends: playerSends(0.55, 0.4),
    });
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.45,
      oscillatorType: 'sine',
      frequency: midiToFreq(score.chordAt(position).bass + 12),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass - 5), time: time + 0.3 }],
      gainAutomation: [
        { type: 'set', value: 0.34, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
      ],
      destination: output,
    });
  });

  // Unlock answers with a soft high tick — once per release, not once per
  // released target, or a six-lock volley would arrive as a burst of ticks.
  bus.on('unlock', ({ lockCount }) => {
    const output = sfxDestination();
    if (!ctx || !output || lockCount > 0) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    if (time <= lastUnlockTick + SIXTEENTH * 0.5) return;
    lastUnlockTick = time;
    noiseHit(time, 0.03, 0.02, 'highpass', 9000, output);
  });

  // Fire is a short falling zap, rooted on the live chord.
  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const from = SECTION_VOICES[mix.from].fire;
    const to = SECTION_VOICES[mix.to].fire;
    const cutoff = lerp(from.cutoff, to.cutoff, mix.t);
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.065 }],
      destination: output,
    });
    noiseHit(time, lerp(from.noise, to.noise, mix.t), 0.02, 'highpass', 3600, output);
  });

  // Armor chips tick a soft arpeggio off the live chord.
  bus.on('hit', ({ lethal }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    ([[0, 0.075], [1, 0.062], [2, 0.05]] as const).forEach(([index, vel]) => {
      if (!ctx || !output) return;
      chipVoice.play({
        context: ctx,
        time: time + THIRTYSECOND * index,
        midi: chord.arp[index] + 12,
        vel,
        destination: output,
        sends: playerSends(0.35, 0.25),
      });
    });
    noiseHit(time, 0.03, 0.03, 'highpass', 6400, output);
  });

  // A stage break cracks metallically and rings a chord tone into the hall.
  bus.on('stage', () => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    noiseHit(time, 0.18, 0.06, 'bandpass', 3100, output);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.9,
      oscillatorType: 'triangle',
      frequency: midiToFreq(chord.arp[2] + 12),
      filter: { type: 'highpass', frequency: 800 },
      gainAutomation: [
        { type: 'set', value: 0.11, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
      ],
      destination: output,
      sends: playerSends(0.4, 0.75),
    });
    if (mix?.reverbSend) noiseHit(time, 0.09, 0.45, 'highpass', 4200, mix.reverbSend);
  });

  // A full clean volley lands a chord stab an octave up — the music applauds.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.55,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2800 },
        gainAutomation: [
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
        ],
        destination: mix.duck,
        sends: playerSends(0.5, 0.4),
      });
    }
    noiseHit(time, 0.08, 0.28, 'highpass', 7200, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A minor second, both notes falling: a breaker tripping, not a miss.
    for (const [midi, vel, offset] of [[33, 0.26, 0], [34, 0.2, 0.02]] as const) {
      rejectVoice.play({
        context: ctx,
        time: time + offset,
        midi,
        vel,
        endFrequency: midiToFreq(midi - 12),
        destination: output,
      });
    }
    noiseHit(time, 0.16, 0.1, 'lowpass', 600, output);
  });

  // A player hit booms a falling octave under a two-note hull alarm.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    hullBoomVoice.play({ context: ctx, time, frequency: 104, destination: output });
    [0, 0.16].forEach((offset, index) => {
      if (!ctx || !output) return;
      hullAlarmVoice.play({ context: ctx, time: time + offset, midi: 75 - index * 5, vel: 0.11, destination: output });
    });
    noiseHit(time, 0.18, 0.13, 'bandpass', 1000, output);
  });

  // A miss is a barely-there falling tick — the barrel swallowing something.
  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'sine',
      frequency: 190,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 84, time: time + 0.11 }],
      gainAutomation: [
        { type: 'set', value: 0.035, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
      ],
      destination: output,
    });
  });

  // Containment failure cuts the music to a long low sub rumble and filtered noise.
  bus.on('runend', ({ died }) => {
    if (!died || !ctx) return;
    const mix = runtime.mix();
    const time = ctx.currentTime;
    mix?.duckAt(time, 0.05, 3.2);
    if (hum && !trace) hum.cut(time);
    humHoldUntil = time + 2.8;
    rumble(time, 3.4);
  });

  return runtime;
}
