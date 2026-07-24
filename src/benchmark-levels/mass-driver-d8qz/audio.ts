import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { BARREL_BLAST_DAMAGE } from './gameplay';
import { createMassDriverVoices, installRailHum, type MassDriverTonalVoice, type RailHum } from './audio-voices';
import {
  FAULT_TIME,
  LAUNCH_TIME,
  MASS_DRIVER_BARS,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  MASS_DRIVER_TIME,
  MUZZLE_TIME,
} from './timing';

// The Mass Driver score: 128 BPM in A minor, 32 bars = exactly the 60-second
// run. The gun is the instrument. A kick fires on every beat for the whole run
// because a kick *is* a ring pass; underneath it a single continuous rail hum
// climbs three octaves from A0 to A3 and becomes the muzzle scream. Player
// actions are written into that machine rather than laid over it: locks and
// shots snap to the transport and read the live harmony, and kills walk a hidden
// two-bar lane so a chained volley performs a melodic run.

const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Am — Am — F — G, four bars each: a slow, locked harmonic rhythm so the pulse
// stays hypnotic and nothing competes with the climbing hum.
const A_MINOR: Chord = { bass: 33, pad: [45, 52, 57, 60], arp: [57, 60, 64, 69], stab: [57, 60, 64] };
const F_MAJOR: Chord = { bass: 29, pad: [41, 48, 53, 57], arp: [53, 57, 60, 65], stab: [53, 57, 60] };
const G_MAJOR: Chord = { bass: 31, pad: [43, 50, 55, 59], arp: [55, 59, 62, 67], stab: [55, 59, 62] };
// The charge phase leans on a phrygian B flat: the barrel is about to fail.
const B_FLAT: Chord = { bass: 34, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70], stab: [58, 62, 65] };
// Out of the muzzle: an open fifth, no third, nothing left to resolve.
const A_OPEN: Chord = { bass: 33, pad: [45, 52, 57, 64], arp: [57, 64, 69, 76], stab: [57, 64, 69] };

const CHORDS: Chord[] = [A_MINOR, A_MINOR, F_MAJOR, G_MAJOR];
// Chord sets index off the absolute bar, so this lands A minor on bars 20–23 and
// B flat on 24–27.
const FAULT_CHORDS: Chord[] = [B_FLAT, A_MINOR];

type SectionIndex = 0 | 1 | 2 | 3;

// Lock count is a degree into the live lead set; kills read these hidden lanes in
// the same degree space, so chained volleys play written melody, not noise.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Cold barrel: a slow ladder climbing out of the breech.
  0: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 3, 2, 1, 2, 3, 4, 5,
    0, 1, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 6, 5, 4, 2,
  ],
  // Drive: broken fourths, jump-cut, machine-like.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 3, 1, 4, 2, 5, 3, 6,
    4, 7, 5, 3, 6, 4, 2, 0,
  ],
  // Fault: high, urgent fragments that stay clear of the alarm's register.
  2: [
    7, 5, 6, 4, 7, 6, 5, 3,
    6, 4, 5, 2, 7, 5, 4, 1,
    5, 7, 4, 6, 3, 5, 2, 4,
    6, 7, 5, 4, 3, 2, 1, 0,
  ],
  // Launch: one long ascent, because there is only up left.
  3: [
    0, 1, 2, 3, 4, 5, 6, 7,
    5, 6, 7, 6, 4, 5, 6, 7,
    2, 3, 4, 5, 6, 7, 6, 5,
    4, 5, 6, 7, 7, 6, 7, 7,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: MassDriverTonalVoice; kill: MassDriverTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.1, cutoff: 3200, gain: 0.115, sparkle: 0.5, reverb: 0.22 },
    kill: { oscillator: 'triangle', decay: 0.26, cutoff: 3000, gain: 0.14, sparkle: 0.7, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.06, fallSemitones: 12, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.075, cutoff: 2600, gain: 0.05, sparkle: 0.35, reverb: 0.14 },
    kill: { oscillator: 'square', decay: 0.17, cutoff: 3100, gain: 0.1, sparkle: 0.55, reverb: 0.2 },
    fire: { oscillator: 'sawtooth', cutoff: 3800, gain: 0.06, fallSemitones: 7, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.07, cutoff: 4000, gain: 0.048, sparkle: 0.45, reverb: 0.18 },
    kill: { oscillator: 'sawtooth', decay: 0.2, cutoff: 4400, gain: 0.11, sparkle: 0.8, reverb: 0.26 },
    fire: { oscillator: 'sawtooth', cutoff: 5200, gain: 0.065, fallSemitones: 12, noise: 0.055 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.12, cutoff: 3000, gain: 0.055, sparkle: 0.3, reverb: 0.36 },
    kill: { oscillator: 'sawtooth', decay: 0.34, cutoff: 3400, gain: 0.13, sparkle: 0.65, reverb: 0.42 },
    fire: { oscillator: 'square', cutoff: 3200, gain: 0.055, fallSemitones: 13, noise: 0.05 },
  },
};

// The rail hum's itinerary: three octaves of climb, pinned to the run's markers.
const HUM_IDLE_MIDI = 21;
const HUM_FAULT_MIDI = 33;
const HUM_PEAK_MIDI = 45;
const HUM_SCREAM_MIDI = 57;

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-d8qz',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let hum: RailHum | null = null;
  let interlocksCleared = false;
  let barrelBlown = false;

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 4,
    alternateChordSets: [
      { fromBar: MASS_DRIVER_BARS.fault, toBar: MASS_DRIVER_BARS.launch, chords: FAULT_CHORDS, barsPerChord: 4 },
      { fromBar: MASS_DRIVER_BARS.launch, toBar: MASS_DRIVER_BARS.end, chords: [A_OPEN], barsPerChord: 4 },
    ],
    sections: MASS_DRIVER_SCORE_SECTIONS,
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
      compressor: { threshold: -17, ratio: 5.5, attack: 0.004, release: 0.19 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2600 },
      reverb: { seconds: 2.8, decay: 2.4, level: 0.46 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      hum = installRailHum(context, mix);
      // Idling in the breech: a barely-there sub and a slow tremble.
      const now = context.currentTime;
      hum.level(now, 0.075, 1.2);
      hum.glide(now, HUM_IDLE_MIDI, 0.05);
      hum.brightness(now, 170, 0.6);
      hum.tremble(now, 0.012, 1.1, 0.6);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlocksCleared = false;
      barrelBlown = false;
      scheduleRailHumClimb();
    },
    onRunEnd() {
      const context = runtime.context();
      // A blown barrel already scheduled the hum's collapse; leave it alone.
      if (!context || barrelBlown) return;
      const now = context.currentTime + 0.02;
      hum?.level(now, 0.075, 1.6);
      hum?.glide(now, HUM_IDLE_MIDI, 1.6);
      hum?.brightness(now, 170, 1.6);
      hum?.tremble(now, 0.012, 1.1, 1.6);
    },
    onDispose() {
      ctx = null;
      hum = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  /**
   * The whole run in one continuous glide, scheduled once at run start against
   * the transport's own origin so the climb and the rings share a clock.
   */
  function scheduleRailHumClimb() {
    if (!hum) return;
    const origin = score.epoch + score.arrangementStart * score.stepSeconds;
    hum.level(origin, 0.15, 0.5);
    hum.glide(origin, HUM_IDLE_MIDI, 0.2);
    hum.brightness(origin, 220, 0.4);
    hum.tremble(origin, 0.02, 1.6, 0.5);

    hum.glide(origin + 0.25, HUM_FAULT_MIDI, FAULT_TIME - 0.25);
    hum.brightness(origin + 0.25, 1100, FAULT_TIME - 0.25);
    hum.level(origin + 0.25, 0.2, FAULT_TIME - 0.25);

    const chargeSpan = LAUNCH_TIME - FAULT_TIME;
    hum.glide(origin + FAULT_TIME, HUM_PEAK_MIDI, chargeSpan);
    hum.brightness(origin + FAULT_TIME, 3000, chargeSpan);
    hum.level(origin + FAULT_TIME, 0.28, chargeSpan);
    hum.tremble(origin + FAULT_TIME, 0.075, 11, chargeSpan);

    const launchSpan = MUZZLE_TIME - LAUNCH_TIME;
    hum.glide(origin + LAUNCH_TIME, HUM_SCREAM_MIDI, launchSpan);
    hum.brightness(origin + LAUNCH_TIME, 7600, launchSpan);
    hum.level(origin + LAUNCH_TIME, 0.3, launchSpan * 0.6);
    hum.tremble(origin + LAUNCH_TIME, 0, 24, 0.4);

    // Out of the muzzle: the gun stops existing.
    hum.level(origin + MUZZLE_TIME + 0.12, 0.0001, 0.85);
  }

  // ---- arrangement ----------------------------------------------------------------

  const REST_BAR = '................';
  const RING_KICK = 'K...K...K...K...';
  const COIL_OFFBEAT = '..c...c...c...c.';
  const COIL_DENSE = '..c.c.c...c.c.c.';
  const HAT_SOFT = '....h.......h...';
  const HAT_16 = 'hHhHhHhHhHhHhHhH';
  const CLANK_BACKBEAT = '....S.......S...';
  const PLUCK_8 = 'P.P.P.P.P.P.P.P.';
  const PLUCK_16 = 'PpPpPpPpPpPpPpPp';

  const arpOrder = [0, 2, 1, 3, 2, 0, 3, 1];
  const plucked = (octave: number) => (
    { time, step, chord }: { time: number; step: number; chord: Chord },
    vel: number,
  ) => {
    pluck(time, chord.arp[arpOrder[step % arpOrder.length]] + octave, vel);
  };

  const padEvery = (bars: number, vel: number) => fn<Chord>(({ time, step, bar, chord }) => {
    if (step === 0 && bar % bars === 0) pad(time, chord.pad, bars * STEPS_PER_BAR * SIXTEENTH * 1.02, vel);
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(bar / 4) % CHORDS.length];
    },
    sections: [
      {
        name: 'idle',
        fromBar: 0,
        tracks: [
          padEvery(4, 0.6),
          hits('K...............' + REST_BAR, { K: 0.45 }, ({ time }, vel) => kick(time, vel)),
          hits(REST_BAR + '........c.......', { c: 0.05 }, ({ time }, vel) => coil(time, vel, 0.05)),
          fn(({ time, step, bar, chord }) => {
            if (bar % 2 === 1 && step === 8) pluck(time, chord.arp[0] + 12, 0.35);
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
        fromBar: MASS_DRIVER_BARS.breech,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 0.85);
            riser(time, 2 * STEPS_PER_BAR * SIXTEENTH, 0.16);
          }),
          // The pulse is locked from the first ring; it only gets louder.
          hits(RING_KICK + RING_KICK, { K: 1 }, ({ time, bar, step }, vel) => {
            kick(time, vel * (bar === 0 ? 0.55 + step / 26 : 0.95));
          }),
          hits(REST_BAR + '..c...c...c.c.c.', { c: 0.05 }, ({ time }, vel) => coil(time, vel, 0.05)),
          padEvery(2, 0.75),
          hits(REST_BAR + 'B.......B...B...', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.4)),
        ],
      },
      {
        name: 'cold-barrel',
        fromBar: MASS_DRIVER_BARS.cold,
        tracks: [
          hits(RING_KICK, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(COIL_OFFBEAT, { c: 0.055 }, ({ time }, vel) => coil(time, vel, 0.055)),
          hits(HAT_SOFT, { h: 0.028 }, ({ time }, vel) => hat(time, vel, 0.02)),
          hits('B.......B...B...', { B: 0.78 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.5)),
          hits(PLUCK_8, { P: 0.6 }, plucked(0)),
          padEvery(4, 0.7),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 4 === 2) stab(time, chord.stab, 0.55);
          }),
        ],
      },
      {
        name: 'drive',
        fromBar: MASS_DRIVER_BARS.drive,
        tracks: [
          hits(RING_KICK, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(CLANK_BACKBEAT, { S: 0.85 }, ({ time }, vel) => clank(time, vel)),
          hits(COIL_OFFBEAT, { c: 0.07 }, ({ time }, vel) => coil(time, vel, 0.06)),
          hits(HAT_16, { h: 0.022, H: 0.042 }, ({ time }, vel) => hat(time, vel, 0.022)),
          fn(driveBass),
          hits(PLUCK_16, { P: 0.72, p: 0.4 }, plucked(0)),
          padEvery(4, 0.62),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 2 === 0) stab(time, chord.stab, 0.6);
          }),
        ],
      },
      {
        name: 'arc-phase',
        fromBar: MASS_DRIVER_BARS.arc,
        tracks: [
          hits(RING_KICK, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(CLANK_BACKBEAT + '....S.......S.S.', { S: 0.9 }, ({ time }, vel) => clank(time, vel)),
          hits(COIL_DENSE, { c: 0.075 }, ({ time }, vel) => coil(time, vel, 0.055)),
          hits(HAT_16, { h: 0.026, H: 0.05 }, ({ time }, vel) => hat(time, vel, 0.024)),
          fn(driveBass),
          hits(PLUCK_16, { P: 0.8, p: 0.45 }, plucked(0)),
          hits('..P...P...P...P.', { P: 0.4 }, plucked(12)),
          padEvery(4, 0.6),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 2 === 0) stab(time, chord.stab, 0.7);
          }),
          // Two bars of lift straight into the interlock fault.
          oneShot(4, 0, ({ time }) => riser(time, 2 * STEPS_PER_BAR * SIXTEENTH, 0.2)),
          fn(({ time, step, bar }) => {
            if (bar === MASS_DRIVER_BARS.fault - 1 && step >= 8) clank(time, 0.25 + (step - 8) * 0.07);
          }),
        ],
      },
      {
        name: 'fault',
        fromBar: MASS_DRIVER_BARS.fault,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1.0)),
          hits(RING_KICK, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(CLANK_BACKBEAT, { S: 0.9 }, ({ time }, vel) => clank(time, vel)),
          hits(COIL_OFFBEAT, { c: 0.07 }, ({ time }, vel) => coil(time, vel, 0.06)),
          hits(HAT_16, { h: 0.022, H: 0.04 }, ({ time }, vel) => hat(time, vel, 0.02)),
          fn(faultBass),
          hits('P...P.......P...', { P: 0.55 }, plucked(0)),
          padEvery(4, 0.55),
          // The interlock siren: one long swell per bar, cutting through the pulse.
          fn(({ time, step, bar, chord }) => {
            if (step !== 0) return;
            alarm(time, chord.bass + 24 + (bar % 2 === 0 ? 0 : 3), STEPS_PER_BAR * SIXTEENTH * 0.85, 1);
          }),
        ],
      },
      {
        name: 'charge',
        fromBar: MASS_DRIVER_BARS.charge,
        tracks: [
          hits(RING_KICK, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S.S.', { S: 0.95 }, ({ time }, vel) => clank(time, vel)),
          hits(COIL_DENSE, { c: 0.08 }, ({ time }, vel) => coil(time, vel, 0.05)),
          hits(HAT_16, { h: 0.03, H: 0.055 }, ({ time }, vel) => hat(time, vel, 0.024)),
          fn(faultBass),
          hits(PLUCK_16, { P: 0.7, p: 0.42 }, plucked(0)),
          padEvery(4, 0.5),
          // Twice a bar now, and climbing: the charge has nowhere to go.
          fn(({ time, step, bar, chord }) => {
            if (step % 8 !== 0) return;
            const lift = (bar - MASS_DRIVER_BARS.charge) * 2 + (step === 8 ? 5 : 0);
            alarm(time, chord.bass + 24 + lift, STEPS_PER_BAR * SIXTEENTH * 0.4, 1.1);
          }),
          oneShot(2, 0, ({ time }) => riser(time, 2 * STEPS_PER_BAR * SIXTEENTH, 0.24)),
          fn(({ time, step, bar }) => {
            if (bar === MASS_DRIVER_BARS.launch - 1 && step >= 10) clank(time, 0.2 + (step - 10) * 0.09);
          }),
        ],
      },
      {
        name: 'launch',
        fromBar: MASS_DRIVER_BARS.launch,
        tracks: [
          // The charge peaks. Either it goes out of the muzzle or it goes through you.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.4);
            crash(time, 0.32);
            discharge(
              time,
              chord.bass + (interlocksCleared ? 24 : 12),
              interlocksCleared ? 3.4 : 2.2,
              interlocksCleared ? 1 : 1.35,
            );
          }),
          hits(RING_KICK, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('....S...S...S.S.', { S: 1 }, ({ time }, vel) => clank(time, vel)),
          hits(HAT_16, { h: 0.034, H: 0.06 }, ({ time }, vel) => hat(time, vel, 0.022)),
          hits(COIL_DENSE, { c: 0.085 }, ({ time }, vel) => coil(time, vel, 0.05)),
          hits('B...B...B...B...', { B: 0.95 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 1)),
          hits(PLUCK_16, { P: 0.85, p: 0.5 }, plucked(12)),
          padEvery(2, 0.85),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 2 === 0) stab(time, chord.stab.map((midi) => midi + 12), 0.9);
          }),
        ],
      },
      {
        name: 'void',
        fromBar: MASS_DRIVER_BARS.muzzle,
        toBar: MASS_DRIVER_BARS.end,
        tracks: [
          // Out of the barrel: one last hit, one held chord, then nothing.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.2);
            crash(time, 0.26);
            pad(time, [...chord.pad, chord.pad[0] + 12], 2 * STEPS_PER_BAR * SIXTEENTH * 1.6, 1.1);
            stab(time, chord.stab, 0.5);
          }),
          oneShot(0, 4, ({ time, chord }) => pluck(time, chord.arp[3] + 12, 0.45)),
          oneShot(1, 8, ({ time, chord }) => pluck(time, chord.arp[1] + 12, 0.24)),
        ],
      },
    ],
  });

  function driveBass({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const pattern: Record<number, [number, number]> = {
      0: [0, 1], 3: [0, 0.72], 6: [0, 0.8], 8: [0, 0.9], 11: [12, 0.6], 14: [7, 0.78],
    };
    if (step in pattern) bass(time, chord.bass + pattern[step][0], pattern[step][1], 0.7);
  }

  function faultBass({ time, step, chord }: { time: number; step: number; chord: Chord }) {
    const pattern: Record<number, [number, number]> = {
      0: [0, 1], 2: [0, 0.6], 6: [7, 0.82], 8: [0, 0.95], 10: [12, 0.55], 14: [1, 0.7],
    };
    if (step in pattern) bass(time, chord.bass + pattern[step][0], pattern[step][1], 1);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices -----------------------------------------------------------------------

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, coil, hat, clank, crash, bass, pad, pluck, stab, alarm, riser, impact, discharge,
    noiseHit, playerSends, playerTone, playerNoise,
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
    oscillators: [{ type: 'square', octave: 1, gain: 0.2 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockChargeVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.2 }],
    duration: 0.2,
    stopPadding: 0.04,
    envelope: { decay: 0.2 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.072,
    stopPadding: 0.016,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.072 },
  });

  const hitVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 4, frequency: 2400 },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'sawtooth', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', Q: 5, cutoff: 1800 },
    envelope: { decay: ({ decay }) => decay },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 7, frequency: 420 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.11,
    stopPadding: 0.02,
    envelope: { decay: 0.11 },
  });

  const hullVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const clampVoice = voice({
    oscillators: [{ type: 'square', gain: 0.09 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 6, frequency: 700 },
    envelope: { decay: 0.16 },
  });

  // ---- player instruments -------------------------------------------------------------
  // Every positive action snaps to the transport, reads the live chord, and sends
  // its tail into the same delay and hall as the arrangement.

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
    const midi = leadSet[KILL_LANES[laneSection][position % KILL_LANE_STEPS]];
    const velocity = Math.min(1.45, 1 + chain * 0.14);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, velocity, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.45, 0.2) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.022 + sparkle * 0.045, 0.08, 7600);
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
    playerNoise(time, 0.014 + sparkle * 0.03, 0.022, 9400);
    if (lockCount < 6) return;
    // Six sockets filled: the capacitor is full and says so in the bass.
    const output = sfxDestination();
    if (!output) return;
    playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
    const chord = score.chordAt(position);
    lockChargeVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.15 }],
      destination: output,
    });
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
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
      const shape = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: shape.oscillator,
        cutoff: shape.cutoff,
        gainValue: shape.gain,
        weight,
        frequencyAutomation: [{
          type: 'exponentialRamp',
          value: midiToFreq(sourceMidi - shape.fallSemitones),
          time: time + 0.06,
        }],
        destination: output,
        sends: playerSends(0.2, 0.08),
      });
    }
    playerNoise(time, lerp(PLAYER_VOICES[mix.from].fire.noise, PLAYER_VOICES[mix.to].fire.noise, mix.t), 0.024, 5200);
  });

  bus.on('hit', ({ lethal }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    // Armour, not flesh: a bandpassed clang on the live chord tones.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      hitVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        gainValue: 0.06 - index * 0.01,
        decay: 0.085,
        destination: output,
        sends: playerSends(0.2, 0.16),
      });
    }
    playerNoise(time, 0.05, 0.03, 5800);
  });

  bus.on('stage', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // A clamp's armour comes off: metal tearing, then the core exposed.
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.22, 0.15, 2200);
    const context = ctx;
    for (const midi of [chord.bass + 12, chord.stab[2] + 12]) {
      stageVoice.play({
        context,
        time,
        midi,
        gainValue: 0.11,
        decay: 0.55,
        destination: output,
        sends: playerSends(0.24, 0.5),
      });
    }
  });

  bus.on('kill', ({ indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.7);
    const leadSet = score.leadSetAt(position);
    const section = score.sectionMixAt(position).to;
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[section].kill, 0.58 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // The capacitor dumps into a dead bus: a relay clack and a tritone snarl.
    const time = ctx.currentTime;
    const context = ctx;
    for (const [frequency, at, vel] of [[196, time, 0.16], [277, time + 0.025, 0.11]] as const) {
      rejectVoice.play({
        context,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.42, time: at + 0.18 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.15, 0.07, 'bandpass', 540, output);
  });

  bus.on('playerhit', ({ damage }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (damage >= BARREL_BLAST_DAMAGE) {
      // The barrel goes instead of the payload: the hum is torn down the register
      // and the whole mix is buried under the rupture.
      barrelBlown = true;
      runtime.mix()?.duckAt(time, 0.2, 1.6);
      impact(time, 1.6);
      discharge(time, chord.bass, 2.6, 1.5);
      crash(time + 0.04, 0.4);
      noiseHit(time, 0.4, 1.4, 'lowpass', 620, output);
      hum?.glide(time, 14, 1.4);
      hum?.brightness(time, 90, 1.2);
      hum?.level(time + 0.9, 0.0001, 1.1);
      return;
    }
    hullVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass - 5), time: time + 0.34 }],
      destination: output,
    });
    noiseHit(time, 0.22, 0.18, 'bandpass', 760, output);
    alarm(time + 0.05, chord.bass + 25, 0.4, 1.3);
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

  bus.on('spawn', ({ kind }) => {
    const output = sfxDestination();
    if (!ctx || !output || kind !== 'interlock') return;
    // A clamp slams shut on the bore.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    clampVoice.play({ context: ctx, time, midi: chord.bass + 5, destination: output, sends: playerSends(0.1, 0.3) });
    noiseHit(time, 0.18, 0.1, 'bandpass', 1400, output);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!output || !audioMix?.duck) return;
    if (phase === 'summoned') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      riser(time, 2.4, 0.18);
      alarm(time, score.chordAt(score.arrangementPositionAt(time)).bass + 25, 1.4, 1.4);
      return;
    }
    if (phase === 'exposed') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      stab(time, score.chordAt(score.arrangementPositionAt(time)).stab, 0.8);
      return;
    }
    // Every clamp blown with the charge still climbing: the barrel is clear.
    interlocksCleared = true;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    audioMix.duckAt(time, 0.32, 0.9);
    impact(time, 0.9);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND * 2, leadSet[degree] + 12, PLAYER_VOICES[3].kill, 0.85 - index * 0.08, 1);
    });
    // The hum trembles harder: nothing is holding the charge back now.
    hum?.tremble(time, 0.03, 16, 0.6);
  });

  return runtime;
}
