import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createMassDriverVoices, installBarrelHum, type BarrelHum, type MassDriverTone } from './audio-voices';
import {
  MASS_DRIVER_BARS,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  MASS_DRIVER_TIME,
} from './timing';

// THE MASS DRIVER SCORE — 144 BPM, 36 bars, exactly 60 seconds.
//
// The gun is the instrument. Underneath everything is one barrel hum that runs
// from the first frame to the last and is never retriggered; its pitch is the
// charge state, and it only ever climbs. Over it sits a locked, hypnotic pulse:
// one coil hit on every single beat of the run, because one accelerator ring
// passes the camera on every single beat. Speed and tempo are the same number.
//
// The climb is structural rather than an effect. The same two-chord vamp is
// transposed up at each act boundary — D, then E, then G, then A — so the whole
// minute is one enormous rising line, and the harmony the player's instrument
// draws its pitches from rises with it.

const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; lead: number[]; stab: number[] };
type SectionIndex = 0 | 1 | 2 | 3;

// One vamp: minor tonic, then the flat sixth. Two chords is all a hypnotic
// groove wants — the drama comes from what key it is in, not how it moves.
// The lead set is a straight pentatonic, so every lock, kill, and volley note
// is consonant over both chords and a chained volley can never sour.
const LEAD = [62, 65, 67, 69, 72, 74, 77, 81];
const VAMP: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 65], lead: LEAD, stab: [57, 62, 65] },
  { bass: 34, pad: [46, 53, 58, 62], lead: LEAD, stab: [58, 62, 65] },
];

/** Act keys: D, E, G, A. Each step up the barrel is bigger than the last. */
const ACT_TRANSPOSE = { breech: 0, overdrive: 2, interlock: 5, muzzle: 7 } as const;

function transposeVamp(semitones: number): Chord[] {
  return VAMP.map((chord) => ({
    bass: chord.bass + semitones,
    pad: chord.pad.map((midi) => midi + semitones),
    lead: chord.lead.map((midi) => midi + semitones),
    stab: chord.stab.map((midi) => midi + semitones),
  }));
}

// Hidden melody lanes. A chained volley walks one of these, so the player's
// kills perform a real line instead of stacking explosion noises.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Breech: patient arches while the barrel is still slow.
  0: [
    0, 1, 2, 3, 2, 1, 2, 4,
    3, 2, 1, 0, 2, 3, 4, 5,
    4, 3, 2, 3, 4, 5, 6, 5,
    4, 5, 6, 7, 6, 4, 2, 1,
  ],
  // Overdrive: wide broken intervals that suit dense volleys.
  1: [
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 0, 6, 2, 5, 1, 7, 3,
    2, 6, 4, 7, 3, 5, 1, 4,
    7, 5, 6, 4, 3, 2, 1, 0,
  ],
  // Interlock: high and insistent, leaving the low register to the charge.
  2: [
    5, 6, 7, 6, 4, 5, 7, 5,
    6, 7, 5, 6, 4, 6, 3, 5,
    7, 6, 5, 7, 6, 4, 5, 3,
    4, 5, 6, 7, 7, 6, 5, 4,
  ],
  // Muzzle: one long climb out. Nothing in this lane ever comes back down.
  3: [
    0, 1, 2, 3, 4, 5, 6, 7,
    1, 2, 3, 4, 5, 6, 7, 7,
    2, 3, 4, 5, 6, 7, 7, 7,
    3, 4, 5, 6, 7, 7, 7, 7,
  ],
};

type FireTone = { oscillator: OscillatorType; cutoff: number; gain: number; fall: number; grit: number };

// The player's instrument hardens as the gun is driven harder: a soft capacitor
// ping at the breech, a bright arc weld by the muzzle. Gains are tuned by ear
// per waveform, not matched numerically — the saws would bury the triangles.
const PLAYER_TONES: Record<SectionIndex, { lock: MassDriverTone; kill: MassDriverTone; fire: FireTone }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 4200, gain: 0.115, edge: 0.4, reverb: 0.2 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3600, gain: 0.14, edge: 0.55, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 3400, gain: 0.07, fall: 12, grit: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 3200, gain: 0.052, edge: 0.55, reverb: 0.14 },
    kill: { oscillator: 'square', decay: 0.2, cutoff: 3600, gain: 0.1, edge: 0.7, reverb: 0.22 },
    fire: { oscillator: 'sawtooth', cutoff: 4400, gain: 0.06, fall: 7, grit: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.07, cutoff: 4600, gain: 0.05, edge: 0.7, reverb: 0.18 },
    kill: { oscillator: 'sawtooth', decay: 0.24, cutoff: 5000, gain: 0.105, edge: 0.85, reverb: 0.28 },
    fire: { oscillator: 'sawtooth', cutoff: 5600, gain: 0.062, fall: 12, grit: 0.06 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.12, cutoff: 5200, gain: 0.055, edge: 0.9, reverb: 0.4 },
    kill: { oscillator: 'sawtooth', decay: 0.42, cutoff: 5400, gain: 0.125, edge: 1.0, reverb: 0.5 },
    fire: { oscillator: 'square', cutoff: 4200, gain: 0.058, fall: 14, grit: 0.05 },
  },
};

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-rqki',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let hum: BarrelHum | null = null;
  let interlocksAlive = 0;
  let interlocksSeen = 0;
  const interlockIds = new Set<number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: transposeVamp(ACT_TRANSPOSE.breech),
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: MASS_DRIVER_BARS.overdrive, toBar: MASS_DRIVER_BARS.interlock, chords: transposeVamp(ACT_TRANSPOSE.overdrive), barsPerChord: 2 },
      { fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.muzzle, chords: transposeVamp(ACT_TRANSPOSE.interlock), barsPerChord: 2 },
      { fromBar: MASS_DRIVER_BARS.muzzle, chords: transposeVamp(ACT_TRANSPOSE.muzzle), barsPerChord: 2 },
    ],
    sections: MASS_DRIVER_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
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
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2800 },
      reverb: { seconds: 2.2, decay: 2.4, level: 0.42 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      hum = installBarrelHum(context, mix);
      hum.setMidi(VAMP[0].bass - 24, context.currentTime, 0.01);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlocksAlive = 0;
      interlocksSeen = 0;
      interlockIds.clear();
      const context = runtime.context();
      if (!context || !hum) return;
      hum.setMidi(VAMP[0].bass - 24, context.currentTime, 0.4);
      hum.setDrive(0, context.currentTime, 0.4);
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context || !hum) return;
      // However the run ended, the charge is gone. The hum falls away with it.
      hum.setMidi(VAMP[0].bass - 24, context.currentTime, 2.6);
      hum.setDrive(0, context.currentTime, 1.6);
    },
    onDispose() {
      ctx = null;
      hum = null;
    },
  });

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { coil, hat, sizzle, crash, bass, pad, arc, stab, alarm, riser, impact, noiseHit, playerSends, playerTone, playerNoise } = voices;
  const sfxOut = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement ----------------------------------------------------------

  const blank = '................';
  /** The spine of the whole level: one coil hit per beat, all 136 of them. */
  const pulse = 'C...C...C...C...';
  const openHat = '..h...h...h...h.';
  const driveHat = '..h.H...h.H.h.H.';
  const busyHat = 'hHhHhHhHhHhHhHhH';

  /** Glide the hum to the current chord's root, two octaves down, over a bar. */
  const humTrack = (extraSemitones: (barInSection: number) => number) =>
    fn<Chord>(({ step, time, chord, barInSection }) => {
      if (step !== 0 || !hum) return;
      hum.setMidi(chord.bass - 24 + extraSemitones(barInSection), time, MASS_DRIVER_TIME.barSeconds * 0.9);
    });

  /** Open the hum's filter and level as the firing charge builds behind you. */
  const driveTrack = (from: number, to: number, bars: number) =>
    fn<Chord>(({ step, time, barInSection }) => {
      if (step !== 0 || !hum) return;
      hum.setDrive(lerp(from, to, Math.min(1, barInSection / Math.max(1, bars))), time, 0.9);
    });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return VAMP[Math.floor(bar / 2) % VAMP.length];
    },
    sections: [
      {
        name: 'standby',
        fromBar: 0,
        tracks: [
          // The gun on standby: coils cycling half-speed, nothing loaded.
          hits('C.......C.......', { C: 0.34 }, ({ time }, vel) => coil(time, vel, 0.15)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.5)),
          hits(blank + '........A.......', { A: 0.5 }, ({ time, chord }, vel) => arc(time, chord.lead[2], vel)),
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
          oneShot(0, 0, ({ time }) => impact(time, 0.85)),
          hits(pulse, { C: 0.9 }, ({ time }, vel) => coil(time, vel, 0.2)),
          hits(openHat, { h: 0.032 }, ({ time }, vel) => hat(time, vel, 0.026)),
          hits(blank + blank + 'B.......B.......', { B: 0.62 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.35)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.62)),
          humTrack(() => 0),
          driveTrack(0.05, 0.2, 6),
        ],
      },
      {
        name: 'accel',
        fromBar: MASS_DRIVER_BARS.accel,
        tracks: [
          hits(pulse, { C: 1 }, ({ time }, vel) => coil(time, vel, 0.32)),
          hits(driveHat, { h: 0.036, H: 0.062 }, ({ time }, vel) => hat(time, vel, 0.028)),
          hits('B.....B...B.....', { B: 0.78 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.55)),
          hits('..A...A...A...A.', { A: 0.6 }, ({ time, step, chord }, vel) => arc(time, chord.lead[(step / 2) % 4], vel)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.55)),
          humTrack(() => 0),
          driveTrack(0.2, 0.34, 8),
          oneShot(7, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.16)),
        ],
      },
      {
        name: 'overdrive',
        fromBar: MASS_DRIVER_BARS.overdrive,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.0);
            crash(time, 0.26);
          }),
          hits(pulse, { C: 1 }, ({ time }, vel) => coil(time, vel, 0.5)),
          hits(busyHat, { h: 0.03, H: 0.058 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'H' ? 0.03 : 0.02)),
          fn(overdriveBass),
          hits('A.A.A.A.A.A.A.A.', { A: 0.7 }, ({ time, step, chord }, vel) => {
            const order = [0, 2, 1, 4, 3, 2, 5, 4];
            arc(time, chord.lead[order[(step / 2) % order.length]], vel);
          }),
          hits('S...............' + blank, { S: 0.72 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          fn(({ step, bar, time, chord }) => {
            if (step === 0 && bar % 4 === 0) pad(time, chord.pad, 64 * SIXTEENTH, 0.5);
          }),
          humTrack(() => 0),
          driveTrack(0.34, 0.5, 8),
        ],
      },
      {
        name: 'fault',
        fromBar: MASS_DRIVER_BARS.fault,
        tracks: [
          // The safeties jam. The groove strips back so the charge is audible.
          oneShot(0, 0, ({ time }) => crash(time, 0.3)),
          hits(pulse, { C: 0.85 }, ({ time }, vel) => coil(time, vel, 0.55)),
          hits(openHat, { h: 0.03 }, ({ time }, vel) => hat(time, vel, 0.024)),
          hits('B.......B.......', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.5)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.7)),
          // A fault siren once a bar, a whole tone higher each time.
          fn(({ step, time, barInSection, chord }) => {
            if (step !== 0) return;
            alarm(time, chord.bass + 24 + barInSection * 2, 8 * SIXTEENTH, 0.13);
          }),
          humTrack((barInSection) => barInSection * 0.6),
          driveTrack(0.5, 0.72, 4),
          oneShot(2, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'interlock',
        fromBar: MASS_DRIVER_BARS.interlock,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.15);
            crash(time, 0.32);
          }),
          hits(pulse, { C: 1 }, ({ time }, vel) => coil(time, vel, 0.75)),
          hits(busyHat, { h: 0.034, H: 0.066 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'H' ? 0.032 : 0.02)),
          hits('....s.......s...', { s: 0.05 }, ({ time }, vel) => sizzle(time, vel)),
          fn(interlockBass),
          hits('A.A.A.A.A.A.A.A.', { A: 0.78 }, ({ time, step, chord }, vel) => {
            const order = [5, 4, 6, 5, 7, 6, 4, 3];
            arc(time, chord.lead[order[(step / 2) % order.length]], vel);
          }),
          hits('S.......S.......', { S: 0.8 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          // The charge alarm, twice a bar, rising all the way to the muzzle.
          fn(({ step, time, barInSection, chord }) => {
            if (step !== 0 && step !== 8) return;
            alarm(time, chord.bass + 26 + barInSection * 1.5 + (step === 8 ? 5 : 0), 6 * SIXTEENTH, 0.1);
          }),
          fn(({ step, bar, time, chord }) => {
            if (step === 0 && bar % 4 === 0) pad(time, chord.pad, 64 * SIXTEENTH, 0.62);
          }),
          // The gun's pitch now climbs inside the section as well as between them.
          humTrack((barInSection) => barInSection * 0.9),
          driveTrack(0.72, 1, 8),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.3)),
        ],
      },
      {
        name: 'muzzle',
        fromBar: MASS_DRIVER_BARS.muzzle,
        toBar: MASS_DRIVER_BARS.end,
        tracks: [
          // The gun fires. Everything stops except the payload and the sky.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.6);
            crash(time, 0.42);
            stab(time, chord.stab.map((midi) => midi + 12), 1);
            pad(time + 0.1, [chord.bass + 12, ...chord.pad, chord.pad[0] + 12], 30 * SIXTEENTH, 1.0);
            if (hum) {
              hum.setMidi(chord.bass - 12, time, 0.18);
              hum.setDrive(0, time, 0.9);
            }
          }),
          // Three beats of aftershock, then nothing but the tail.
          hits('C...C...C.......', { C: 0.5 }, ({ time, barInSection }, vel) => {
            if (barInSection === 0) coil(time, vel, 0.9);
          }),
          oneShot(0, 12, ({ time }) => sizzle(time, 0.06)),
        ],
      },
    ],
  });

  function overdriveBass({ step, time, chord }: { step: number; time: number; chord: Chord }) {
    const line: Record<number, [number, number]> = {
      0: [0, 1], 3: [0, 0.7], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.65], 14: [10, 0.75],
    };
    if (step in line) bass(time, chord.bass + line[step][0], line[step][1], 0.7);
  }

  function interlockBass({ step, time, chord }: { step: number; time: number; chord: Chord }) {
    const line: Record<number, [number, number]> = {
      0: [0, 1], 2: [0, 0.6], 3: [12, 0.7], 6: [7, 0.85], 8: [0, 0.95], 10: [10, 0.65], 11: [0, 0.8], 14: [5, 0.75],
    };
    if (step in line) bass(time, chord.bass + line[step][0], line[step][1], 1);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player instruments ---------------------------------------------------
  // Every player action snaps to the transport, reads the live chord, and sends
  // its tail into the same delay and hall as the arrangement. Kills walk the
  // hidden lane, so a chained volley plays a melody rather than a pile of noise.

  const killBody = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctave = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.3 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.072,
    stopPadding: 0.016,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.072 },
  });

  const chipVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'square', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 5, frequency: 2600 },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  // Rejection is the gun's own safety cutting in: a hard interlock clack on a
  // dead minor second, deliberately outside the vamp so it reads as "no".
  const rejectVoice = voice<{ level: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.19,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 7, frequency: 560 },
    gainAutomation: (time, _gain, { level }) => [
      { type: 'set', value: level, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const hullVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.55,
    stopPadding: 0.05,
    envelope: { decay: 0.55 },
  });

  const hullStab = voice({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.11,
    stopPadding: 0.03,
    envelope: { decay: 0.11 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.14,
    stopPadding: 0.02,
    envelope: { decay: 0.14 },
  });

  const faultVoice = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.05 }],
    duration: 0.42,
    stopPadding: 0.05,
    filter: { type: 'bandpass', Q: 5, frequency: 1400 },
    envelope: { attack: 0.02, decay: 0.4 },
  });

  function mixedTone(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof MassDriverTone) {
    const from = PLAYER_TONES[mix.from][slot][key];
    const to = PLAYER_TONES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : (to as number);
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const out = sfxOut();
    if (!ctx || !out) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const midi = score.leadSetAt(position)[KILL_LANES[laneSection][position % KILL_LANE_STEPS]];
    const vel = Math.min(1.5, 1 + chain * 0.15);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_TONES[section].kill, vel, weight);
    }
    const decay = mixedTone(mix, 'kill', 'decay');
    const gain = mixedTone(mix, 'kill', 'gain');
    killBody.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: out });
    if (chain >= 2) {
      killOctave.play({ context: ctx, time, midi, decay, gain, destination: out, sends: playerSends(0.45, 0.2) });
    }
    playerNoise(time, 0.02 + mixedTone(mix, 'kill', 'edge') * 0.045, 0.075, 8200);
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    // Lock count is a degree into the live lead set, so charging a volley walks
    // the scale: a six-lock sweep is an audible run up into the release.
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_TONES[section].lock, 1, weight);
    }
    playerNoise(time, 0.012 + mixedTone(mix, 'lock', 'edge') * 0.03, 0.022, 10500);
    if (lockCount < 6) return;
    // Full charge: the payload's capacitor bank tops out an octave above.
    playerTone(time + THIRTYSECOND, midi + 12, PLAYER_TONES[mix.to].kill, 0.6, 1);
    playerNoise(time + THIRTYSECOND, 0.05, 0.06, 5200);
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_TONES[score.sectionMixAt(position).to].lock, 0.3, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const out = sfxOut();
    if (!ctx || !out) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const source = score.leadSetAt(position)[(indexInVolley ?? 0) % 8] + 12;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const tone = PLAYER_TONES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: source,
        oscillator: tone.oscillator,
        cutoff: tone.cutoff,
        gainValue: tone.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(source - tone.fall), time: time + 0.06 }],
        destination: out,
        sends: playerSends(0.2, 0.08),
      });
    }
    playerNoise(time, lerp(PLAYER_TONES[mix.from].fire.grit, PLAYER_TONES[mix.to].fire.grit, mix.t), 0.024, 5200);
  });

  bus.on('hit', ({ lethal }) => {
    const out = sfxOut();
    if (lethal || !ctx || !out) return;
    // Armour chip: a hard metallic tap on the live chord, not a new melody note.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      chipVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        gainValue: 0.05 - index * 0.008,
        decay: 0.07,
        destination: out,
        sends: playerSends(0.18, 0.14),
      });
    }
    playerNoise(time, 0.05, 0.03, 6200);
  });

  bus.on('stage', () => {
    const out = sfxOut();
    if (!ctx || !out) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.19, 0.12, 2400);
    const context = ctx;
    for (const midi of [chord.bass + 12, chord.stab[1] + 12]) {
      stageVoice.play({ context, time, midi, gainValue: 0.13, decay: 0.55, destination: out, sends: playerSends(0.24, 0.5) });
    }
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'interlock' || !ctx) return;
    interlockIds.add(enemyId);
    interlocksAlive += 1;
    interlocksSeen += 1;
    const out = sfxOut();
    if (!out) return;
    // Each safety trips its own fault tone, a semitone above the one before.
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    faultVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 25 + interlocksSeen,
      destination: out,
      sends: playerSends(0.2, 0.3),
    });
    playerNoise(time, 0.09, 0.09, 3200);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const wasInterlock = interlockIds.delete(enemyId);
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    if (!wasInterlock) return;

    interlocksAlive = Math.max(0, interlocksAlive - 1);
    const audioMix = runtime.mix();
    if (!audioMix?.duck) return;
    // A safety letting go is a real event: the mix ducks for it, and the figure
    // grows as the count comes down, so clearing the sixth is the peak.
    const cleared = interlocksSeen - interlocksAlive;
    audioMix.duckAt(kill.time, 0.5, 0.4);
    impact(kill.time, 0.55 + cleared * 0.07);
    stab(kill.time, score.chordAt(position).stab.map((midi) => midi + 12), 0.5 + cleared * 0.08);
    if (interlocksAlive > 0) return;
    // The last one. Hold the mix open and run the lead set clean up to the muzzle.
    audioMix.duckAt(kill.time, 0.28, 1.1);
    riser(kill.time, 1.4, 0.22);
    score.leadSetAt(position).forEach((midi, index) => {
      playerTone(kill.time + index * THIRTYSECOND, midi + 12, PLAYER_TONES[3].kill, 0.9 - index * 0.05, 1);
    });
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    stab(time, score.chordAt(position).stab.map((midi) => midi + 12), size >= 6 ? 1 : 0.75);
    const leadSet = score.leadSetAt(position);
    const tone = PLAYER_TONES[score.sectionMixAt(position).to].kill;
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, tone, 0.62 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const out = sfxOut();
    if (!ctx || !out) return;
    const time = ctx.currentTime;
    const context = ctx;
    for (const [frequency, at, level] of [[196, time, 0.17], [208, time + 0.018, 0.13]] as const) {
      rejectVoice.play({
        context,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.45, time: at + 0.15 }],
        level,
        destination: out,
      });
    }
    noiseHit(time, 0.13, 0.07, 'bandpass', 520, out);
  });

  bus.on('playerhit', () => {
    const out = sfxOut();
    if (!ctx || !out) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    hullVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.34 }],
      destination: out,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      hullStab.play({ context, time: time + index * 0.12, midi, destination: out, sends: playerSends(0.12, 0.08) });
    });
    noiseHit(time, 0.19, 0.15, 'bandpass', 760, out);
  });

  bus.on('miss', () => {
    const out = sfxOut();
    if (!ctx || !out) return;
    // Something went past you at speed: a short downward doppler, nothing more.
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 26,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 14), time: time + 0.13 }],
      destination: out,
      sends: playerSends(0.1, 0),
    });
  });

  bus.on('runend', ({ died }) => {
    const out = sfxOut();
    const audioMix = runtime.mix();
    if (!ctx || !out || !audioMix?.duck) return;
    const time = ctx.currentTime + 0.02;
    if (died) {
      // The barrel lets go. All low end, nothing musical about it.
      audioMix.duckAt(time, 0.1, 2.6);
      impact(time, 1.8);
      crash(time, 0.5);
      noiseHit(time, 0.42, 1.4, 'lowpass', 260, out);
      noiseHit(time + 0.06, 0.3, 0.9, 'bandpass', 900, out);
      return;
    }
    // Clear of the muzzle: one open chord, and a very long way from anywhere.
    const resolved = transposeVamp(ACT_TRANSPOSE.muzzle)[0];
    pad(time, [...resolved.pad, resolved.bass + 12], 5.5, 0.85);
    sizzle(time, 0.05);
  });

  return runtime;
}
