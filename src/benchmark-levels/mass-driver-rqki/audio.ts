import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createMassDriverVoices, installChargeHum, type ChargeHum, type MassDriverTonalVoice } from './audio-voices';
import {
  BARS,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  MASS_DRIVER_TIME,
} from './timing';

// THE GUN IS THE INSTRUMENT.
//
// 144 BPM, C minor, 36 bars = exactly 60 s. Two things carry the whole score:
//
//   1. A kick and a coil strike on every single beat, bar 0 through bar 32,
//      never syncopated and never dropped — because the payload crosses one
//      accelerator ring on every beat. The pulse is not accompanying the run;
//      it *is* the run. The coil gets brighter and shorter as speed climbs, on
//      the same ramp the rings use, so ear and eye never disagree.
//   2. A continuous capacitor hum under everything, gliding two octaves up
//      across the run and opening its filter as it goes. That is the firing
//      charge, and at bar 32 it is released into silence.
//
// Player actions are written into that grid: locks and shots quantize to the
// transport at 16ths, everything is pitched from the live chord, and kills walk
// a hidden per-section lane so a chained volley plays a melody over the pulse.

const STEP = MASS_DRIVER_TIME.stepSeconds;
const SIXTEENTH = STEP;
const THIRTYSECOND = STEP / 2;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Cm — Cm — Ab — Bb. Half of every eight-bar phrase sits on the tonic: this
// level wants hypnosis, not a chord progression.
const CM: Chord = { bass: 24, pad: [48, 51, 55, 60], arp: [60, 63, 67, 72], stab: [60, 63, 67] };
const CHORDS: Chord[] = [
  CM,
  CM,
  { bass: 20, pad: [44, 51, 56, 60], arp: [56, 60, 63, 68], stab: [56, 60, 63] }, // Ab
  { bass: 22, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70], stab: [58, 62, 65] }, // Bb
];

// From the jam onward the bVI/bVII lift is replaced by a phrygian Db leaning
// hard on the tonic. That semitone is the jammed safety.
const DB: Chord = { bass: 25, pad: [49, 53, 56, 61], arp: [61, 65, 68, 73], stab: [61, 65, 68] };
const OVERLOAD_CHORDS: Chord[] = [CM, DB, CM, DB];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Two-bar lanes in lead-set degrees (0–7 across two octaves of the chord).
// A clean six-lock volley performs one of these outright.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Breech: slow, wide arches while the coils are still cold.
  0: [
    0, 1, 2, 3, 2, 3, 4, 5,
    4, 5, 6, 7, 6, 5, 4, 3,
    2, 3, 4, 5, 4, 5, 6, 7,
    6, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Stage one: broken fourths — the sequence learning to run.
  1: [
    0, 2, 4, 6, 1, 3, 5, 7,
    2, 4, 6, 7, 3, 5, 7, 6,
    0, 3, 5, 7, 1, 4, 6, 7,
    2, 5, 7, 6, 4, 6, 7, 5,
  ],
  // Stage two: high, fast, zigzagging above the bassline.
  2: [
    4, 6, 5, 7, 3, 5, 4, 6,
    5, 7, 6, 7, 4, 6, 5, 3,
    6, 7, 5, 6, 4, 5, 3, 4,
    7, 6, 7, 5, 6, 4, 5, 7,
  ],
  // Overload: clamped oscillation over the phrygian, descending under pressure.
  3: [
    7, 5, 6, 4, 7, 4, 5, 3,
    6, 4, 5, 2, 7, 5, 6, 3,
    4, 2, 3, 1, 5, 3, 4, 2,
    6, 4, 5, 3, 7, 5, 6, 4,
  ],
  // Muzzle: release. A long fall, then an open climb into nothing.
  4: [
    7, 6, 5, 4, 3, 2, 1, 0,
    4, 5, 6, 7, 6, 5, 4, 3,
    2, 1, 0, 2, 4, 6, 7, 6,
    5, 4, 3, 2, 0, 2, 4, 7,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// The player's own hardware heats along with the barrel: soft and filtered at
// the breech, a hard resonant saw by the overload, a clean bell in vacuum.
const PLAYER_VOICES: Record<SectionIndex, { lock: MassDriverTonalVoice; kill: MassDriverTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 2600, gain: 0.115, bite: 0.15, reverb: 0.2 },
    kill: { oscillator: 'triangle', decay: 0.26, cutoff: 3000, gain: 0.14, bite: 0.2, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.07, fallSemitones: 12, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.085, cutoff: 3000, gain: 0.055, bite: 0.35, reverb: 0.14 },
    kill: { oscillator: 'square', decay: 0.19, cutoff: 3400, gain: 0.075, bite: 0.4, reverb: 0.22 },
    fire: { oscillator: 'square', cutoff: 3600, gain: 0.05, fallSemitones: 7, noise: 0.042 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.075, cutoff: 4000, gain: 0.05, bite: 0.55, reverb: 0.16 },
    kill: { oscillator: 'sawtooth', decay: 0.2, cutoff: 4400, gain: 0.07, bite: 0.6, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 5000, gain: 0.05, fallSemitones: 12, noise: 0.055 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.09, cutoff: 3000, gain: 0.055, bite: 0.85, reverb: 0.3 },
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 3600, gain: 0.08, bite: 0.9, reverb: 0.38 },
    fire: { oscillator: 'sawtooth', cutoff: 4200, gain: 0.055, fallSemitones: 13, noise: 0.06 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.3, cutoff: 5200, gain: 0.16, bite: 0.05, reverb: 0.6 },
    kill: { oscillator: 'sine', decay: 0.85, cutoff: 5600, gain: 0.19, bite: 0.05, reverb: 0.75 },
    fire: { oscillator: 'triangle', cutoff: 4600, gain: 0.06, fallSemitones: 5, noise: 0.014 },
  },
};

// The hum: MIDI 26 at the breech, 50 at the muzzle. Two octaves in sixty seconds.
const HUM_LOW = 26;
const HUM_HIGH = 50;
const humRamp = (bar: number) => Math.min(1, bar / BARS.muzzle);
const humMidiAtBar = (bar: number) => HUM_LOW + (HUM_HIGH - HUM_LOW) * humRamp(bar);
const humLevelAtBar = (bar: number) => 0.085 + 0.115 * humRamp(bar);
const humBrightAtBar = (bar: number) => 0.05 + 0.95 * humRamp(bar) ** 1.4;

/** Coil brightness tracks the same ramp the rings do, so ear and eye agree. */
const coilBrightAtBar = (bar: number) => humRamp(bar) ** 0.85;

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-rqki',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: STEP,
  defaultSeconds: MASS_DRIVER_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let chargeHum: ChargeHum | null = null;
  const interlockIds = new Set<number>();
  let interlocksDown = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: BARS.jam, toBar: BARS.muzzle, chords: OVERLOAD_CHORDS, barsPerChord: 2 }],
    sections: MASS_DRIVER_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP,
    volumeScale: 0.82,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -15, ratio: 5.5, attack: 0.003, release: 0.16 },
      // A 3/16 delay: at 144 BPM the echo lands between the ring hits.
      delay: { time: STEP * 3, feedback: 0.3, dampHz: 2800 },
      reverb: { seconds: 2.0, decay: 2.4, level: 0.42 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      chargeHum = installChargeHum(context, mix);
      chargeHum.set(context.currentTime, HUM_LOW, 0.05, 0.04);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockIds.clear();
      interlocksDown = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) voices.humRelease(context.currentTime + 0.02, 1.4);
    },
    onDispose() {
      ctx = null;
      chargeHum = null;
    },
  });

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix }, () => chargeHum);
  const { kick, coil, clap, hat, ride, crash, bass, pad, seq, stab, alarm, chargeBeep, riser, impact, noiseHit, playerSends, playerTone, playerNoise } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement -----------------------------------------------------------

  const BEAT_PULSE = 'K...K...K...K...';
  const OFF_HAT = '..h...h...h...h.';
  const EIGHTH_HAT = 'h.H.h.H.h.H.h.H.';
  const BUSY_HAT = 'hoHohoHohoHohoHo';
  const BACKBEAT = '....C.......C...';

  /** The ring pulse. Present in every run section until the gun fires. */
  const ringPulse = (velocity: number) => [
    hits<Chord>(BEAT_PULSE, { K: velocity }, ({ time }, vel) => kick(time, vel)),
    hits<Chord>(BEAT_PULSE, { K: velocity }, ({ time, bar }, vel) => coil(time, vel * 0.9, coilBrightAtBar(bar))),
  ];

  /** The capacitor charge, re-aimed once per bar so the glide never stops moving. */
  const humTrack = fn<Chord>(({ step, bar, time }) => {
    if (step !== 0 || bar >= BARS.muzzle) return;
    voices.hum(time, humMidiAtBar(bar + 1), humLevelAtBar(bar), humBrightAtBar(bar));
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: (position) => CHORDS[Math.floor(position / STEPS_PER_BAR / 2) % CHORDS.length],
    sections: [
      {
        // Standby: the gun is loaded but idle. One coil tap per half-bar, a low
        // pad, and the hum sitting at the very bottom of its range.
        name: 'standby',
        fromBar: 0,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * STEP * 1.05, 0.5)),
          hits('K...............', { K: 0.4 }, ({ time }, vel) => kick(time, vel)),
          hits('C.......C.......', { C: 0.35 }, ({ time }, vel) => coil(time, vel, 0.1)),
          fn(({ step, time }) => {
            if (step === 0) voices.hum(time, HUM_LOW, 0.06, 0.05);
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
        name: 'breech',
        fromBar: BARS.breech,
        tracks: [
          humTrack,
          ...ringPulse(0.7),
          hits('P...............................................................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * STEP, 0.7)),
          hits('B.......B.......', { B: 0.6 }, ({ time, chord, barInSection }, vel) => {
            if (barInSection >= 2) bass(time, chord.bass, vel, 0.4);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection >= 2 && step % 4 === 2) hat(time, 0.03, 0.022);
          }),
          // The last bar counts you in: the coils tap between the rings.
          fn(({ time, step, barInSection }) => {
            if (barInSection === 3 && step % 4 === 2) coil(time, 0.3 + step * 0.015, 0.16);
          }),
          oneShot(3, 8, ({ time }) => riser(time, 8 * STEP, 0.15)),
        ],
      },
      {
        name: 'stage-one',
        fromBar: BARS.accelerate,
        tracks: [
          humTrack,
          oneShot(0, 0, ({ time }) => impact(time, 0.7)),
          ...ringPulse(1),
          hits(BACKBEAT, { C: 0.8 }, ({ time }, vel) => clap(time, vel)),
          hits(OFF_HAT, { h: 0.038 }, ({ time }, vel) => hat(time, vel, 0.026)),
          fn(({ time, step, barInSection }) => {
            if (barInSection >= 4 && step % 2 === 1) hat(time, 0.022, 0.018);
          }),
          hits('B..B..B...B.B...', { B: 0.72 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.55)),
          fn(seqTrack(0.42, 2)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * STEP, 0.55)),
          oneShot(6, 0, ({ time }) => riser(time, 32 * STEP, 0.17)),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 7 && step >= 8 && step % 2 === 0) clap(time, 0.2 + (step - 8) * 0.055);
          }),
        ],
      },
      {
        name: 'stage-two',
        fromBar: BARS.overdrive,
        tracks: [
          humTrack,
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.05);
            crash(time, 0.22);
          }),
          ...ringPulse(1),
          // A ghost kick between rings: the coils fire faster than you pass them.
          hits('..............k.', { k: 0.5 }, ({ time }, vel) => kick(time, vel)),
          hits(BACKBEAT, { C: 0.92 }, ({ time }, vel) => clap(time, vel)),
          hits('.......c...........c............', { c: 0.28 }, ({ time }, vel) => clap(time, vel)),
          hits(EIGHTH_HAT, { h: 0.04, H: 0.075 }, ({ time }, vel) => hat(time, vel, 0.026)),
          hits('R...R...R...R...', { R: 0.045 }, ({ time }, vel) => ride(time, vel)),
          hits('B..B.B.B..B.B.B.', { B: 0.8 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.75)),
          fn(seqTrack(0.72, 0, true)),
          hits('S...............................', { S: 0.62 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 4 === 0) pad(time, chord.pad, 64 * STEP, 0.5);
          }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * STEP, 0.2)),
        ],
      },
      {
        name: 'jam',
        fromBar: BARS.jam,
        tracks: [
          humTrack,
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.15);
            crash(time, 0.3);
          }),
          // Everything else strips away. The ring pulse does not: it cannot.
          ...ringPulse(0.95),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * STEP, 0.85)),
          hits('B...............', { B: 0.85 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.3)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0) alarm(time, chord.bass + 24 + barInSection, 14 * STEP, 0.9 + barInSection * 0.12);
          }),
          oneShot(2, 0, ({ time }) => riser(time, 32 * STEP, 0.26)),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 3 && step >= 8) clap(time, 0.14 + (step - 8) * 0.06);
          }),
        ],
      },
      {
        name: 'overload',
        fromBar: BARS.overload,
        tracks: [
          humTrack,
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.3);
            crash(time, 0.34);
          }),
          ...ringPulse(1),
          hits('....K.....K.K...', { K: 0.55 }, ({ time }, vel) => kick(time, vel)),
          hits(BACKBEAT, { C: 1 }, ({ time }, vel) => clap(time, vel)),
          hits('.......c...c....', { c: 0.3 }, ({ time }, vel) => clap(time, vel)),
          hits(BUSY_HAT, { h: 0.042, H: 0.08, o: 0.026 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.016 : 0.026)),
          hits('..R...R...R...R.', { R: 0.05 }, ({ time }, vel) => ride(time, vel)),
          hits('B.B.B..B.B.BB...', { B: 0.88 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.95)),
          fn(seqTrack(0.85, 0, true)),
          hits('S...............', { S: 0.85 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          // The charge counter: one beep per bar at first, eight by the end.
          fn(({ time, step, barInSection, chord }) => {
            const every = [16, 16, 8, 8, 4, 4, 2, 2][Math.min(7, barInSection)];
            if (step % every === 0) chargeBeep(time, chord.stab[2] + 12 + barInSection, 0.5 + barInSection * 0.07);
          }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * STEP, 0.34)),
        ],
      },
      {
        name: 'muzzle',
        fromBar: BARS.muzzle,
        toBar: BARS.end,
        tracks: [
          // The gun fires. The pulse that has run for thirty-two bars simply
          // stops, the charge is released, and what is left is open space.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.5);
            crash(time, 0.42);
            voices.humRelease(time, 2.4);
            pad(time, [...chord.pad, chord.pad[0] + 12], 56 * STEP, 1.0);
            riser(time, 0.5, 0.12);
          }),
          oneShot(0, 12, ({ time, chord }) => stab(time, chord.stab.map((midi) => midi + 12), 0.5)),
          oneShot(1, 8, ({ time }) => ride(time, 0.03)),
          oneShot(2, 0, ({ time, chord }) => pad(time, chord.pad.map((midi) => midi + 12), 32 * STEP, 0.55)),
          oneShot(2, 4, ({ time, chord }) => stab(time, [chord.stab[0] + 12], 0.34)),
          oneShot(3, 8, ({ time, chord }) => stab(time, [chord.bass + 36], 0.22)),
        ],
      },
    ],
  });

  /**
   * The hypnotic layer: a 16th sequence that walks the current chord with an
   * octave lift on the back half of each bar. `open` is the filter, and it is
   * the only thing that changes across the run — the pattern never does.
   */
  function seqTrack(open: number, fromBar: number, dense = false) {
    const order = dense ? [0, 3, 1, 4, 2, 5, 1, 3] : [0, 2, 1, 3, 2, 0, 3, 1];
    const rests = dense ? [] : [6, 22];
    return ({ time, step, barInSection, chord }: { time: number; step: number; barInSection: number; chord: Chord }) => {
      if (barInSection < fromBar || step % 2 !== 0) return;
      if (rests.includes(step)) return;
      const notes = [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
      const lift = step >= 8 ? 3 : 0;
      const degree = Math.min(7, order[(step / 2) % order.length] + lift);
      seq(time, notes[degree], 0.8 + (step % 4 === 0 ? 0.35 : 0), open + (step % 4 === 0 ? 0.12 : 0));
    };
  }

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

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.07,
    stopPadding: 0.016,
    filter: { type: 'lowpass', Q: 3, cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.07 },
  });

  const hitVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.085,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 6, frequency: 2600 },
    envelope: { decay: 0.085 },
  });

  const lockRailVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.2 }],
    duration: 0.2,
    stopPadding: 0.04,
    envelope: { decay: 0.2 },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.26,
    stopPadding: 0.04,
    filter: { type: 'lowpass', Q: 9, frequency: 900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  const damageVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.5 }],
    duration: 0.55,
    stopPadding: 0.05,
    envelope: { decay: 0.55 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.11,
    stopPadding: 0.02,
    envelope: { decay: 0.11 },
  });

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: 'decay' | 'gain' | 'bite') {
    return lerp(PLAYER_VOICES[mix.from][slot][key], PLAYER_VOICES[mix.to][slot][key], mix.t);
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const midi = score.leadSetAt(position)[KILL_LANES[laneSection][position % KILL_LANE_STEPS]];
    const vel = Math.min(1.5, 1 + chain * 0.15);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay');
    const gain = mixedVoiceValue(mix, 'kill', 'gain');
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.4, 0.2) });
    playerNoise(time, 0.02 + mixedVoiceValue(mix, 'kill', 'bite') * 0.05, 0.06, 8200);
  }

  /** Each interlock down is louder, higher, and further up the lane than the last. */
  function interlockKill(time: number) {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.duck) return;
    interlocksDown += 1;
    const stage = Math.min(4, interlocksDown);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const leadSet = score.leadSetAt(position);

    impact(time, 0.7 + stage * 0.16);
    mix.duckAt(time, 0.55 - stage * 0.06, 0.35);
    stab(time, chord.stab.map((midi) => midi + 12), 0.5 + stage * 0.12);
    // A rising figure whose top note climbs with every clamp destroyed.
    [0, 2, 4].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[Math.min(7, degree + stage)] + 12, PLAYER_VOICES[3].kill, 0.75 - index * 0.1, 1);
    });
    playerNoise(time, 0.12 + stage * 0.03, 0.14, 4200);

    if (interlocksDown >= 4) {
      // Barrel clear. Duck the pulse for a breath and land the release figure.
      mix.duckAt(time + SIXTEENTH, 0.22, 1.1);
      crash(time + SIXTEENTH, 0.36);
      riser(time + SIXTEENTH, 0.7, 0.16);
      leadSet.forEach((midi, index) => {
        playerTone(time + SIXTEENTH * 2 + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[4].kill, 0.85 - index * 0.07, 1);
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
    playerNoise(time, 0.012 + mixedVoiceValue(mix, 'lock', 'bite') * 0.03, 0.02, 9600);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      // Six locks: the bank is full. A rail-drop under the sixth note.
      const chord = score.chordAt(position);
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.6, 1);
      lockRailVoice.play({
        context: ctx,
        time,
        midi: chord.bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.16 }],
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
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const shot = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: shot.oscillator,
        cutoff: shot.cutoff,
        gainValue: shot.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - shot.fallSemitones), time: time + 0.06 }],
        destination: output,
        sends: playerSends(0.16, 0.06),
      });
    }
    playerNoise(time, lerp(PLAYER_VOICES[mix.from].fire.noise, PLAYER_VOICES[mix.to].fire.noise, mix.t), 0.022, 5200);
  });

  bus.on('hit', ({ lethal }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    // Armour chip: a short bandpassed triad tick that stays out of the lane.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      hitVoice.play({
        context,
        time: time + index * THIRTYSECOND * 0.5,
        midi: midi + 12,
        gainValue: 0.05 - index * 0.008,
        destination: output,
        sends: playerSends(0.16, 0.12),
      });
    }
    playerNoise(time, 0.04, 0.028, 6200);
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.16, 0.11, 2800);
    stab(time, [chord.bass + 24], 0.6);
    if (interlockIds.has(enemyId)) riser(time, 0.9, 0.11);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (interlockIds.delete(enemyId)) {
      interlockKill(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    // A clean four-plus volley lands its chord on the next beat, not instantly:
    // the reward is being *in* the grid, not on top of it.
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.7);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.55 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.duck) return;
    // A breaker tripping: the bus sags for a sixteenth and a dead relay drops.
    const time = ctx.currentTime;
    mix.duckAt(time, 0.55, 0.18);
    for (const [frequency, at, vel] of [[196, time, 0.15], [185, time + 0.025, 0.11]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.32, time: at + 0.22 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.07, 'bandpass', 520, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.duck) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Hull strike: the payload's power sags and the hum ducks with it.
    mix.duckAt(time, 0.4, 0.5);
    damageVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.34 }],
      destination: output,
    });
    noiseHit(time, 0.22, 0.18, 'bandpass', 720, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 11), time: time + 0.1 }],
      destination: output,
      sends: playerSends(0.06, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'interlock') {
      interlockIds.add(enemyId);
      if (interlockIds.size === 1) {
        // The safeties seize: a long klaxon under the alarm bar.
        const time = score.nextGridTime(ctx.currentTime, 2);
        alarm(time, 44, 20 * STEP, 1.3);
        playerNoise(time, 0.14, 0.2, 1800);
      }
      return;
    }
    if (kind === 'arcnode') {
      // Armour arriving gets a warning tick pitched from the live chord.
      const time = score.nextGridTime(ctx.currentTime, 1);
      chargeBeep(time, score.chordAt(score.arrangementPositionAt(time)).bass + 36, 0.4);
    }
  });

  return runtime;
}
