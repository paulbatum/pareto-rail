import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  createMassDriverVoices,
  installBarrelHum,
  type BarrelHum,
  type MassDriverTonalVoice,
} from './audio-voices';
import { MD_BARS, MD_BPM, MD_DURATION, MD_SCORE_SECTIONS, MD_STEPS_PER_BAR, MD_TIME } from './timing';

// The Mass Driver score: 128 BPM techno in D minor, 32 bars = exactly the
// 60-second run. The gun is the instrument. A coil tick fires on every beat —
// the ring the payload is passing through — and behind everything runs one
// continuous barrel hum whose pitch climbs the entire run, from a 37 Hz idle to
// a scream at the muzzle. When the safeties jam a second voice appears above
// it: the firing-charge whine, whose pitch and level ARE the countdown.
//
// Player actions are written into that machine rather than layered over it:
// locks walk the live chord, kills read a hidden 32-step melodic lane, and a
// clean six discharges the capacitor bank as a real cadence.

const SIXTEENTH = MD_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const BAR_SECONDS = MD_TIME.barSeconds;
const STEPS_PER_BAR = MD_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Dm — Dm/A — Bb — C, two bars each. A modal loop that barely moves: the
// interest is meant to come from the acceleration, not from the changes.
const CHORDS: Chord[] = [
  { bass: 26, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74], stab: [62, 65, 69] }, // Dm
  { bass: 33, pad: [50, 55, 57, 62], arp: [62, 67, 69, 74], stab: [62, 67, 69] }, // Dm/A
  { bass: 34, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70], stab: [58, 62, 65] }, // Bb
  { bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72], stab: [60, 64, 67] }, // C
];

type SectionIndex = 0 | 1 | 2 | 3;

// Kills read a hidden two-bar lane in the live chord's degree space, so a
// chained volley performs a written melody instead of stacking bangs.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Breech: a slow ladder walking up out of the dark.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    2, 3, 4, 5, 4, 3, 4, 5,
    4, 5, 6, 5, 4, 3, 4, 5,
    3, 4, 5, 6, 5, 4, 3, 2,
  ],
  // Accelerate: broken chords in wide leaps — the pulse has locked in.
  1: [
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 0, 6, 2, 5, 1, 7, 3,
    2, 6, 0, 4, 3, 7, 1, 5,
    6, 4, 2, 0, 5, 3, 1, 4,
  ],
  // Overdrive: high fragments that leave the low register to the rail bass.
  2: [
    5, 7, 6, 4, 7, 5, 6, 4,
    6, 7, 5, 3, 7, 6, 4, 2,
    7, 5, 4, 6, 5, 7, 6, 4,
    4, 5, 6, 7, 6, 7, 5, 3,
  ],
  // Charge: everything climbs. Every phrase ends higher than it started.
  3: [
    0, 2, 4, 6, 1, 3, 5, 7,
    2, 4, 6, 7, 3, 5, 7, 7,
    1, 3, 5, 7, 2, 4, 6, 7,
    4, 5, 6, 7, 5, 6, 7, 7,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// Player timbres per section. They move from a clean capacitor blip to a hard
// overdriven snap as the gun winds up; the score crossfades over two bars so
// the change lands with the arrangement rather than on top of it.
const PLAYER_VOICES: Record<SectionIndex, { lock: MassDriverTonalVoice; kill: MassDriverTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.1, cutoff: 3800, gain: 0.115, bite: 0.3, space: 0.2 },
    kill: { oscillator: 'triangle', decay: 0.26, cutoff: 3400, gain: 0.145, bite: 0.4, space: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 3400, gain: 0.07, fallSemitones: 12, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2900, gain: 0.052, bite: 0.5, space: 0.14 },
    kill: { oscillator: 'square', decay: 0.17, cutoff: 3300, gain: 0.1, bite: 0.6, space: 0.22 },
    fire: { oscillator: 'square', cutoff: 4200, gain: 0.055, fallSemitones: 7, noise: 0.042 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.07, cutoff: 4400, gain: 0.048, bite: 0.7, space: 0.16 },
    kill: { oscillator: 'sawtooth', decay: 0.2, cutoff: 4800, gain: 0.108, bite: 0.8, space: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 5600, gain: 0.062, fallSemitones: 12, noise: 0.055 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.11, cutoff: 2600, gain: 0.055, bite: 0.9, space: 0.34 },
    kill: { oscillator: 'sawtooth', decay: 0.32, cutoff: 3000, gain: 0.128, bite: 1.0, space: 0.44 },
    fire: { oscillator: 'square', cutoff: 3200, gain: 0.058, fallSemitones: 13, noise: 0.05 },
  },
};

// The barrel hum's fundamental across the run, in MIDI. A steady octave climb
// through the working sections, then a near-fifth jump while the charge builds.
const HUM_KEYS: Array<[bar: number, midi: number]> = [
  [MD_BARS.breech, 26],
  [MD_BARS.accel, 29],
  [MD_BARS.overdrive, 32],
  [MD_BARS.charge, 35],
  [MD_BARS.fire, 45],
];

function humMidiAtBar(bar: number) {
  const clamped = Math.max(0, Math.min(MD_BARS.fire, bar));
  for (let index = 1; index < HUM_KEYS.length; index += 1) {
    if (clamped <= HUM_KEYS[index][0]) {
      const [barA, midiA] = HUM_KEYS[index - 1];
      const [barB, midiB] = HUM_KEYS[index];
      return lerp(midiA, midiB, (clamped - barA) / Math.max(1, barB - barA));
    }
  }
  return HUM_KEYS[HUM_KEYS.length - 1][1];
}

/** 0 → 1 across the charge window, in bars. The whine rides this. */
function chargeAtBar(bar: number) {
  return Math.max(0, Math.min(1, (bar - MD_BARS.charge) / (MD_BARS.fire - MD_BARS.charge)));
}

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-o9ok',
  bpm: MD_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MD_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let hum: BarrelHum | null = null;
  // Interlock bookkeeping is tracked from the bus rather than imported from
  // gameplay: the score needs to know whether the barrel is clear at the moment
  // it schedules the shot, and the scheduler runs ahead of the game clock.
  const interlockIds = new Set<number>();
  const interlockMaxHp = new Map<number, number>();
  let interlocksAlive = 0;
  let interlocksKilled = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: MD_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: MD_SCORE_SECTIONS,
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
      compressor: { threshold: -15, ratio: 5.5, attack: 0.003, release: 0.18 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2600 },
      reverb: { seconds: 2.8, decay: 2.4, level: 0.42 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      hum = installBarrelHum(context, mix, HUM_KEYS[0][1]);
      hum.setLevel(0.075, context.currentTime, 1.4);
      hum.setTone(0.1, context.currentTime, 1.4);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlocksAlive = 0;
      interlocksKilled = 0;
      interlockIds.clear();
      interlockMaxHp.clear();
      const context = runtime.context();
      if (!context || !hum) return;
      // The gun spins up from idle the moment the payload seats.
      hum.setPitch(HUM_KEYS[0][1], context.currentTime);
      hum.setLevel(0.15, context.currentTime, 0.6);
      hum.setTone(0.12, context.currentTime, 0.6);
      hum.setCharge(0, 72, context.currentTime, 0.2);
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context || !hum) return;
      hum.setCharge(0, 72, context.currentTime, 0.35);
      hum.setLevel(0.075, context.currentTime, 2.0);
      hum.setTone(0.1, context.currentTime, 2.0);
      hum.glideTo(HUM_KEYS[0][1], context.currentTime + 2.4);
    },
    onDispose() {
      ctx = null;
      hum = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const musicDestination = () => runtime.mix()?.music ?? runtime.mix()?.master ?? null;

  // ---- scheduler -----------------------------------------------------------------

  const blank = '................';
  const kickFour = 'K...K...K...K...';
  const kickHalf = 'K.......K.......';
  const clapBack = '....C.......C...';
  const hatOff = '..h...h...h...h.';
  const hatBusy = '..h.o.h...h.o.h.';
  const arpEight = 'A.A.A.A.A.A.A.A.';
  const arpQuarter = 'A...A...A...A...';
  const ghostSnap = '.......g........' + '...........g....';

  /**
   * The coil tick: one per beat, forever. Its pitch comes from the live chord
   * and its brightness from how far down the barrel the payload is, so the
   * percussion and the tunnel run off the same ramp.
   */
  const coilTrack = (velocity: number) => fn<Chord>(({ time, step, bar, chord }) => {
    if (step % 4 !== 0) return;
    coil(time, chord.arp[0] + 12, velocity * (step === 0 ? 1 : 0.72), Math.min(1, bar / MD_BARS.fire));
  });

  /** Drives the two persistent machine voices from musical time, once a bar. */
  const machineTrack = () => fn<Chord>(({ time, step, bar }) => {
    if (step !== 0 || !hum) return;
    hum.glideTo(humMidiAtBar(bar + 1), time + BAR_SECONDS);
    const drive = Math.min(1, bar / MD_BARS.fire);
    hum.setLevel(0.15 + drive * 0.13, time, BAR_SECONDS);
    hum.setTone(0.12 + drive * 0.85, time, BAR_SECONDS);
    const charge = chargeAtBar(bar + 1);
    if (charge > 0) hum.setCharge(charge * 0.05, 60 + charge * 26, time, BAR_SECONDS);
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
          // The gun at rest: a coil tick every other beat and a slow pad. It is
          // already keeping time before you touch anything.
          fn(({ time, step, chord }) => {
            if (step % 8 === 0) coil(time, chord.arp[0] + 12, 0.35, 0.1);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.55)),
          hits(arpQuarter, { A: 0.35 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
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
        fromBar: MD_BARS.breech,
        tracks: [
          machineTrack(),
          coilTrack(0.6),
          // Half-time for four bars, then the four-on-the-floor arrives and the
          // pulse never changes again for the rest of the run.
          hits([kickHalf, kickHalf, kickHalf, kickHalf, kickFour, kickFour, kickFour, kickFour].join(''), { K: 0.9 }, ({ time }, vel) => kick(time, vel)),
          hits([blank, blank, blank, blank, clapBack, clapBack, clapBack, clapBack].join(''), { C: 0.7 }, ({ time }, vel) => snap(time, vel)),
          hits([blank, blank, hatOff, hatOff, hatOff, hatOff, hatOff, hatOff].join(''), { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.028)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.7)),
          hits([blank, blank, blank, blank, 'B.......B.......', 'B.......B.......', 'B.....B.B.......', 'B.....B.B...B...'].join(''), { B: 0.75 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.35)),
          hits([blank, blank, blank, blank, arpQuarter, arpQuarter, arpEight, arpEight].join(''), { A: 0.5 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length], vel)),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.14)),
        ],
      },
      {
        name: 'accelerate',
        fromBar: MD_BARS.accel,
        tracks: [
          machineTrack(),
          coilTrack(0.78),
          oneShot(0, 0, ({ time }) => impact(time, 0.7)),
          hits(kickFour, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(clapBack, { C: 0.85 }, ({ time }, vel) => snap(time, vel)),
          hits(hatOff, { h: 0.06 }, ({ time }, vel) => hat(time, vel, 0.03)),
          fn(({ time, step, bar }) => { if (bar % 4 === 3 && step === 14) openHat(time, 0.09); }),
          fn(railBassTrack(false)),
          hits(arpEight, { A: 0.62 }, driveArp(false)),
          hits('S...............' + blank, { S: 0.6 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.5)),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.18)),
        ],
      },
      {
        name: 'overdrive',
        fromBar: MD_BARS.overdrive,
        tracks: [
          machineTrack(),
          coilTrack(0.95),
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.0);
            crash(time, 0.24);
          }),
          hits(kickFour, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(clapBack, { C: 0.95 }, ({ time }, vel) => snap(time, vel)),
          hits(ghostSnap, { g: 0.3 }, ({ time }, vel) => snap(time, vel)),
          hits(hatBusy, { h: 0.06, o: 0.032 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.022 : 0.03)),
          hits('..R...R...R...R.', { R: 0.045 }, ({ time }, vel) => ride(time, vel)),
          fn(({ time, step, bar }) => { if (bar % 2 === 1 && step === 14) openHat(time, 0.1); }),
          fn(railBassTrack(true)),
          hits(arpEight, { A: 0.72 }, driveArp(true)),
          hits('S.......S.......' + 'S...............', { S: 0.8 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 4 === 0) pad(time, chord.pad, 64 * SIXTEENTH, 0.42); }),
          // Two bars of rising snare before the safeties jam.
          fn(({ time, step, bar }) => { if (bar === MD_BARS.charge - 1 && step >= 8) snap(time, 0.22 + (step - 8) * 0.08); }),
          oneShot(MD_BARS.charge - MD_BARS.overdrive - 2, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.24)),
        ],
      },
      {
        name: 'charge',
        fromBar: MD_BARS.charge,
        tracks: [
          machineTrack(),
          coilTrack(1.05),
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.2);
            crash(time, 0.3);
          }),
          // The pulse stays exactly where it was. Nothing in the rhythm tells
          // you time is running out — only the machine does.
          hits(kickFour, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(clapBack, { C: 1 }, ({ time }, vel) => snap(time, vel)),
          hits(ghostSnap, { g: 0.32 }, ({ time }, vel) => snap(time, vel)),
          hits(hatBusy, { h: 0.065, o: 0.034 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.022 : 0.03)),
          hits('..R...R...R...R.', { R: 0.05 }, ({ time }, vel) => ride(time, vel)),
          fn(railBassTrack(true)),
          hits(arpEight, { A: 0.68 }, driveArp(true)),
          hits('S...............' + blank, { S: 0.85 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          // Fault alarm: two tones a bar, climbing and getting louder as the
          // charge fills. This is the boss's voice.
          fn(({ time, step, bar, chord }) => {
            if (step !== 0 && step !== 8) return;
            const charge = chargeAtBar(bar);
            alarm(time, chord.stab[step === 0 ? 0 : 2] - 12 + Math.round(charge * 7), 4 * SIXTEENTH, 0.05 + charge * 0.11);
          }),
          fn(({ time, step, bar }) => { if (bar === MD_BARS.fire - 1 && step >= 4) snap(time, 0.18 + (step - 4) * 0.055); }),
          oneShot(MD_BARS.fire - MD_BARS.charge - 2, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.3)),
        ],
      },
      {
        name: 'fire',
        fromBar: MD_BARS.fire,
        toBar: MD_BARS.end,
        tracks: [
          // The shot, and then nothing. Whether the gun fires or the barrel
          // lets go, everything stops here — the difference is which one-shot
          // plays and how the silence after it is coloured.
          oneShot(0, 0, ({ time, chord }) => fireTheGun(time, chord)),
          // One distant sub, a bar and a half later: the payload, still going.
          oneShot(1, 8, ({ time, chord }) => bass(time, chord.bass - 12, 0.4, 0)),
        ],
      },
    ],
  });

  function driveArp(dense: boolean) {
    return ({ time, step, chord }: { time: number; step: number; chord: Chord }, vel: number) => {
      const order = dense ? [0, 2, 1, 3, 2, 0, 3, 1] : [0, 1, 2, 1, 3, 2, 1, 0];
      const octave = dense && step >= 8 ? 12 : 0;
      arp(time, chord.arp[order[(step / 2) % order.length]] + octave, vel);
    };
  }

  function railBassTrack(dense: boolean) {
    return ({ time, step, chord }: { time: number; step: number; chord: Chord }) => {
      const steps: Record<number, [number, number]> = dense
        ? { 0: [0, 1], 3: [0, 0.7], 6: [7, 0.8], 8: [0, 0.95], 10: [12, 0.55], 11: [0, 0.72], 14: [7, 0.8] }
        : { 0: [0, 1], 6: [0, 0.75], 8: [0, 0.9], 14: [7, 0.75] };
      if (step in steps) bass(time, chord.bass + steps[step][0], steps[step][1], dense ? 0.9 : 0.55);
    };
  }

  /**
   * Bar 30. If the barrel is clear the gun fires: one enormous discharge, the
   * mix ducked almost to nothing, the machine cut dead, and the payload sails
   * out into a held open voicing that fades to silence. If an interlock is
   * still standing the same moment is a breach — same gesture, wrong harmony.
   */
  function fireTheGun(time: number, chord: Chord) {
    const clear = interlocksAlive <= 0;

    impact(time, clear ? 1.6 : 1.4);
    crash(time, 0.4);
    runtime.mix()?.duckAt(time, 0.06, clear ? 2.6 : 1.4);

    // The machine stops. This is the moment the whole level is about. The hum
    // is absent under the trace harness, which has no AudioContext to install
    // it into — the shot itself must not depend on that.
    hum?.setCharge(0, 96, time, 0.12);
    hum?.setLevel(0, time + 0.1, clear ? 0.5 : 0.18);

    if (clear) {
      // Out of the muzzle: a wide, slow, open voicing with nothing under it.
      pad(time + 0.22, [chord.bass + 24, ...chord.pad.map((midi) => midi + 12)], 7.5, 0.85);
      score.leadSetAt(score.arrangementPositionAt(time)).slice().reverse().forEach((midi, index) => {
        playerTone(time + 0.12 + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[3].kill, 0.75 - index * 0.07, 1);
      });
    } else {
      // The charge had nowhere to go: a minor-second grind under the wreckage.
      const output = musicDestination();
      for (const midi of [chord.bass, chord.bass + 1, chord.bass + 6]) bass(time + 0.05, midi, 0.9, 1);
      if (output) noiseHit(time, 0.4, 1.6, 'lowpass', 300, output);
    }
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ----------------------------------------------------------------------

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, coil, snap, hat, openHat, ride, crash, bass, pad, arp, stab, alarm, riser, impact, noiseHit, playerSends, playerTone, playerNoise } = voices;

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

  const lockSubVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.2 }],
    duration: 0.17,
    stopPadding: 0.04,
    envelope: { decay: 0.17 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.07,
    stopPadding: 0.016,
    filter: { type: 'lowpass', Q: 3, cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.07 },
  });

  const hitTickVoice = voice<{ cutoff: number; gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 700 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const hullVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const hullStabVoice = voice({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.11,
    stopPadding: 0.03,
    envelope: { decay: 0.11 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.13,
    stopPadding: 0.02,
    envelope: { decay: 0.13 },
  });

  const darterWarnVoice = voice({
    oscillators: [{ type: 'square', gain: 0.035 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 6, frequency: 2400 },
    envelope: { decay: 0.16 },
  });

  // ---- player instruments -------------------------------------------------------
  // Every positive action snaps to the transport, reads the live chord, and
  // sends its tail into the same delay and hall as the arrangement.

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof MassDriverTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
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
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.45, 0.2) });
    }
    const bite = mixedVoiceValue(mix, 'kill', 'bite') as number;
    playerNoise(time, 0.022 + bite * 0.045, 0.075, 7600);
  }

  /**
   * An interlock taking damage. The boss's voice grows with the damage dealt:
   * more gain, a brighter filter, and a beacon tone that climbs the lead set as
   * the barrel gets closer to clear.
   */
  function interlockChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const root = midiToFreq(score.chordAt(position).bass + 12);
    hitTickVoice.play({
      context: ctx,
      time,
      frequency: root * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.14 }],
      cutoff: 1400 + intensity * 4200,
      gainValue: 0.2 + intensity * 0.16,
      decay: 0.4,
      destination: output,
      sends: playerSends(0.2, 0.3),
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES[3].kill, 0.4 + intensity * 0.4, 1);
    playerNoise(time, 0.09 + intensity * 0.08, 0.09, 5000);
  }

  /** An interlock destroyed: one safety down, and the score says which one. */
  function interlockFinale(time: number, cleared: number) {
    if (!ctx) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const leadSet = score.leadSetAt(position);
    runtime.mix()?.duckAt(time, 0.4, 0.5);
    impact(time, 0.55 + cleared * 0.09);
    stab(time, chord.stab.map((midi) => midi + 12), 0.7 + cleared * 0.06);
    // Each clear climbs one more degree; the fifth one lands at the top.
    for (let index = 0; index <= Math.min(4, cleared); index += 1) {
      playerTone(time + index * THIRTYSECOND, leadSet[Math.min(7, 2 + index + cleared)] + 12, PLAYER_VOICES[3].kill, 0.85 - index * 0.08, 1);
    }
    playerNoise(time, 0.2, 0.16, 3600);
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
    playerNoise(time, 0.012 + (mixedVoiceValue(mix, 'lock', 'bite') as number) * 0.03, 0.022, 9400);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      // Bank full. The breech seats with a sub thump under the top of the arp.
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      const bassMidi = score.chordAt(position).bass + 12;
      lockSubVoice.play({
        context: ctx,
        time,
        midi: bassMidi,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(bassMidi - 12), time: time + 0.13 }],
        destination: output,
      });
    }
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - shape.fallSemitones), time: time + 0.058 }],
        destination: output,
        sends: playerSends(0.16, 0.07),
      });
    }
    playerNoise(time, lerp(PLAYER_VOICES[mix.from].fire.noise, PLAYER_VOICES[mix.to].fire.noise, mix.t), 0.024, 5200);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (interlockIds.has(enemyId)) {
      const max = Math.max(interlockMaxHp.get(enemyId) ?? 0, hitPointsRemaining + 1);
      interlockMaxHp.set(enemyId, max);
      interlockChip(time, 1 - hitPointsRemaining / max);
      return;
    }
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      hitTickVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        cutoff: 3800,
        gainValue: 0.05 - index * 0.008,
        decay: 0.08,
        destination: output,
        sends: playerSends(0.2, 0.16),
      });
    }
    playerNoise(time, 0.04, 0.03, 6000);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.18, 0.12, 2400);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageVoice.play({
        context: ctx,
        time,
        midi,
        gainValue: 0.13,
        decay: 0.55,
        destination: output,
        sends: playerSends(0.24, 0.5),
      });
    }
    if (interlockIds.has(enemyId)) riser(time, 1.2, 0.14);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (interlockIds.has(enemyId)) {
      interlockIds.delete(enemyId);
      interlocksAlive = Math.max(0, interlocksAlive - 1);
      interlocksKilled += 1;
      interlockFinale(kill.time, interlocksKilled);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    stab(time, score.chordAt(position).stab.map((midi) => midi + 12), size >= 6 ? 1 : 0.72);
    const leadSet = score.leadSetAt(position);
    // A full bank discharging: an ascending arpeggio in thirty-seconds.
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.62 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // The breech will not seat: a dead relay clunk, two cold contacts a
    // semitone apart, with no reward tone anywhere in it.
    for (const [frequency, at, vel] of [[196, time, 0.15], [208, time + 0.018, 0.11]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.38, time: at + 0.17 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.15, 0.09, 'bandpass', 520, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    hullVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      hullStabVoice.play({ context, time: time + index * 0.12, midi, destination: output, sends: playerSends(0.1, 0.08) });
    });
    noiseHit(time, 0.2, 0.15, 'bandpass', 740, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.12 }],
      destination: output,
      sends: playerSends(0.07, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'interlock') {
      interlockIds.add(enemyId);
      interlocksAlive += 1;
      // A safety welding shut: an alarm doublet with a riser under it.
      const time = score.nextGridTime(ctx.currentTime, 1);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      riser(time, 1.4, 0.16);
      alarm(time, chord.stab[0] - 12, 6 * SIXTEENTH, 0.14);
      alarm(time + 4 * SIXTEENTH, chord.stab[1] - 12, 6 * SIXTEENTH, 0.12);
    } else if (kind === 'darter') {
      const output = sfxDestination();
      if (!output) return;
      // Incoming: a short bandpassed chirp off the live arp, so even the
      // warnings are in key.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const midi = score.leadSetAt(score.arrangementPositionAt(time))[enemyId % 4] + 12;
      darterWarnVoice.play({
        context: ctx,
        time,
        midi,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi + 7), time: time + 0.14 }],
        destination: output,
        sends: playerSends(0.12, 0.1),
      });
    }
  });

  return runtime;
}
