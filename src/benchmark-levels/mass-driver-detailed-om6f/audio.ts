import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createMassDriverVoices } from './audio-voices';
import { MD_BARS, MD_BPM, MD_SCORE_SECTIONS, MD_STEPS_PER_BAR, MD_TIME, type MdSection } from './timing';
import { onSignal } from './state';

// The gun is the instrument. A locked 128 BPM minimal-techno pulse in E minor
// runs 32 bars to exactly 60 seconds, and underneath everything a persistent
// bass hum — the gun spooling up — climbs in pitch across the whole run and
// accelerates into the firing charge before the shot cuts it dead.
//
// The player is the soloist on top of that: locks walk the live lead by lock
// count, kills read a hidden per-section melody lane so a chained volley
// performs a real run, and every player sound is quantized to the transport
// and pitched from the harmony sounding at that instant.

const SIXTEENTH = MD_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const BAR_SECONDS = MD_TIME.barSeconds;
const LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[] };

// Em - Em - C - D, two bars per chord.
const EM: Chord = { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76] };
const C: Chord = { bass: 24, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72] };
const D: Chord = { bass: 26, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74] };
// The boss bars take the flat-II: Phrygian dread over the same tonic.
const F: Chord = { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] };
// The whole run is minor; the release is major. A Picardy third at the muzzle.
const E_MAJOR: Chord = { bass: 28, pad: [52, 56, 59, 64], arp: [64, 68, 71, 76] };

const CHORDS = [EM, EM, C, D];

// Hidden kill-melody lanes: degrees into the live lead set (the chord's arp
// plus the same notes an octave up). Kills unmute the lane step by step, so a
// chained volley plays consecutive steps as a real melodic fragment.
const KILL_LANES: Record<MdSection, number[]> = {
  // Injection — a slow stepwise arch out of the breech.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Stage-1 — the pulse locks in: driving thirds with octave lifts.
  1: [
    0, 2, 4, 2, 1, 3, 5, 3,
    2, 4, 6, 4, 3, 5, 7, 5,
    4, 2, 0, 2, 5, 3, 1, 3,
    6, 4, 2, 4, 7, 5, 3, 1,
  ],
  // Stage-2 — acid-flavoured octave zig-zags under the 303.
  2: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 5, 2, 7, 4, 1, 6, 3,
    7, 4, 6, 3, 5, 2, 4, 1,
  ],
  // Interlock — descending peals, tolling down as the charge climbs.
  3: [
    7, 6, 5, 4, 7, 6, 5, 4,
    6, 5, 4, 3, 6, 5, 4, 3,
    5, 4, 3, 2, 5, 4, 3, 2,
    4, 3, 2, 1, 7, 6, 5, 0,
  ],
  // Muzzle — sparse, wide, major. Weightless.
  4: [
    0, 4, 7, 4, 2, 5, 7, 5,
    4, 7, 4, 2, 7, 5, 2, 0,
    0, 2, 4, 7, 4, 2, 0, 2,
    7, 4, 2, 4, 0, 4, 7, 4,
  ],
};

type KillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; reverb: number };
type LockVoice = { oscillator: OscillatorType; cutoff: number; gain: number };
type FireVoice = { cutoff: number; noise: number };

// Per-section player timbres, crossfaded across the boundaries. Gains are tuned
// by perceived loudness, not by matching numbers: a saw at the same gain as a
// sine sounds far louder, and the lock must stay a tick in every section.
const SECTION_VOICES: Record<MdSection, { kill: KillVoice; lock: LockVoice; fire: FireVoice }> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.48, cutoff: 4000, gain: 0.18, reverb: 0.4 },
    lock: { oscillator: 'triangle', cutoff: 3000, gain: 0.13 },
    fire: { cutoff: 1800, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.22, cutoff: 2400, gain: 0.125, reverb: 0.25 },
    lock: { oscillator: 'square', cutoff: 2100, gain: 0.052 },
    fire: { cutoff: 2600, noise: 0.042 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.26, cutoff: 3400, gain: 0.115, reverb: 0.3 },
    lock: { oscillator: 'sawtooth', cutoff: 2700, gain: 0.046 },
    fire: { cutoff: 3600, noise: 0.058 },
  },
  3: {
    kill: { oscillator: 'sawtooth', decay: 0.52, cutoff: 1750, gain: 0.135, reverb: 0.7 },
    lock: { oscillator: 'sawtooth', cutoff: 1500, gain: 0.05 },
    fire: { cutoff: 2200, noise: 0.07 },
  },
  4: {
    kill: { oscillator: 'sine', decay: 0.85, cutoff: 4400, gain: 0.095, reverb: 0.9 },
    lock: { oscillator: 'sine', cutoff: 3800, gain: 0.08 },
    fire: { cutoff: 2400, noise: 0.018 },
  },
};

/**
 * The climbing hum: idles low in attract, holds E1 off the breech, is up a
 * fourth by the middle and an octave by the interlocks, then rises with an
 * accelerating curve into the charge peak with the filter opening as it goes.
 */
function humState(bar: number, beat: number) {
  if (bar < MD_BARS.stage1) return { midi: 28, level: 0.05 + bar * 0.007, cutoff: 300 + bar * 45, glide: 0.55 };
  if (bar < 8) return { midi: 28, level: 0.075, cutoff: 520, glide: 0.45 };
  if (bar < MD_BARS.stage2) return { midi: 31, level: 0.082, cutoff: 640, glide: 0.45 };
  if (bar < 16) return { midi: 33, level: 0.09, cutoff: 790, glide: 0.45 };
  if (bar < MD_BARS.interlock) return { midi: 35, level: 0.098, cutoff: 960, glide: 0.45 };
  if (bar < MD_BARS.shot) {
    const t = (bar - MD_BARS.interlock + beat / 4) / (MD_BARS.shot - MD_BARS.interlock);
    const rise = t ** 2.1;
    return { midi: 40 + rise * 13, level: 0.104 + rise * 0.085, cutoff: 1000 + rise * 3800, glide: 0.16 };
  }
  return { midi: 40, level: 0.0001, cutoff: 400, glide: 0.05 };
}

const HUM_IDLE = { midi: 28, level: 0.034, cutoff: 235, glide: 1.4 };

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-detailed-om6f',
  bpm: MD_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let interlocksDown = 0;

  const score = createScore<Chord, MdSection>({
    bpm: MD_BPM,
    stepsPerBar: MD_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: MD_BARS.interlock, toBar: MD_BARS.shot, chords: [EM, F], barsPerChord: 2 },
      { fromBar: MD_BARS.shot, chords: [E_MAJOR], barsPerChord: 4 },
    ],
    sections: MD_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    bpm: MD_BPM,
    stepSeconds: SIXTEENTH,
    stepsPerBar: MD_STEPS_PER_BAR,
    volumeScale: 0.82,
    score,
    // The ring lattice is anchored to run time, so the arrangement must start
    // with the run rather than waiting for the next bar line.
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -17, ratio: 5, attack: 0.004, release: 0.2 },
      // A dotted eighth delay and a long hall: the barrel's own reverb.
      delay: { time: SIXTEENTH * 3, feedback: 0.36, dampHz: 3000 },
      reverb: { seconds: 3.4, decay: 2.6, level: 0.3 },
      noiseSeconds: 2.5,
    },
    onPostBuild(context, mix) {
      ctx = context;
      voices.attachHum(context, mix);
      voices.hum(context.currentTime + 0.05, HUM_IDLE.midi, HUM_IDLE.level, HUM_IDLE.cutoff, HUM_IDLE.glide);
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      interlocksDown = 0;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (!context) return;
      // The run's end re-idles the gun.
      voices.hum(context.currentTime + 0.1, HUM_IDLE.midi, HUM_IDLE.level, HUM_IDLE.cutoff, 0.9);
    },
    onDispose() {
      voices.detachHum();
      ctx = null;
    },
  });

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // --- player instrument specs ---------------------------------------------

  const killLayer = voice<{ killVoice: KillVoice }>({
    oscillators: [{ type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain }],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { decay: ({ killVoice }) => killVoice.decay },
  });

  const killBody = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctave = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.34 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockTone = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 220 },
    envelope: { decay: 0.11 },
  });

  const fireTone = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.085 }],
    duration: 0.085,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.085 },
  });

  const chipTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.13,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 4600 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  // Reject is a breaker trip: a dead low minor second falling into the floor.
  // Cold iron, no reward, and deliberately the only interval like it here.
  const breakerTone = voice<{ vel: number; drop: number }>({
    oscillators: [{ type: 'square', gain: 0.6 }, { type: 'sawtooth', gain: 0.3 }],
    duration: 0.42,
    stopPadding: 0.04,
    filter: { type: 'lowpass', Q: 2, cutoff: 620 },
    frequencyAutomation: (time, frequency, { drop }) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: frequency * drop, time: time + 0.3 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  const hullAlarmTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.5 }],
    duration: 0.2,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 4, cutoff: 1500 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const clankTone = voice<{ vel: number; ratio: number }>({
    oscillators: [
      { type: 'square', gain: 0.4 },
      { type: 'square', gain: 0.22, frequencyRatio: ({ ratio }) => ratio },
    ],
    duration: 0.3,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 2.2, cutoff: 1900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  // --- arrangement ---------------------------------------------------------

  const blank = '................';
  const kickSparse = 'K.......k.......';
  const kickBuild = 'K.....k.k.......';
  const kickFloor = 'K...k...k...k...';
  const kickLate = 'K...k...k...k.k.';
  const clapBack = '....C.......C...';
  const hatSparse = '....h.......h...';
  const hatOffbeat = '..h...h...h...h.';
  const hatLattice = 'hhHhhhOhhhHhhhOh';
  const hatDense = 'hhHhhhOhhhHhhOhO';
  const bassEighth = 'B.b.b.b.b.b.b.b.';
  const bassJump = 'B.b.u.b.f.b.u.b.';
  const arpQuarter = 'A...A...A...A...';
  const arpEighth = 'A...A...A.A.A...';
  const acidLine = 'a.aA.a.aa..A.aa.';
  const snareRoll = 'ssssssssSSSSSSSS';

  function padTrack(level: number): ArrangementTrack<Chord> {
    // Two-bar pad, phase-matched to the two-bar chord cycle.
    return fn(({ bar, step, time, chord }) => {
      if (step !== 0 || bar % 2 !== 0) return;
      voices.pad(time, chord.pad, BAR_SECONDS * 2 * 1.02, level);
    });
  }

  function kickTrack(pattern: string) {
    return hits<Chord>(pattern, { K: 1, k: 0.82 }, ({ time }, vel) => voices.kick(time, vel));
  }

  function hatTrack(pattern: string) {
    return hits<Chord>(pattern, { h: 0.05, H: 0.09, O: 0.15 }, ({ time }, vel, symbol) => {
      voices.hat(time, vel, symbol === 'O' ? 0.19 : 0.028);
    });
  }

  function bassTrack(pattern: string, length: number) {
    return hits<Chord>(pattern, { B: 1, b: 0.72, u: 0.72, f: 0.72 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0;
      voices.bass(time, chord.bass + 12 + offset, vel, length);
    });
  }

  function arpTrack(pattern: string, base: number, climb = 0) {
    return hits<Chord>(pattern, { A: 1 }, ({ time, step, chord, barInSection }) => {
      const order = [0, 2, 1, 3];
      const midi = chord.arp[order[(step / 4) % order.length]] - 12;
      voices.arp(time, midi, base + Math.min(0.5, barInSection * climb));
    });
  }

  function acidTrack() {
    return hits<Chord>(acidLine, { a: 0.7, A: 1 }, ({ time, step, chord }, vel, symbol) => {
      // The 303 walks the chord: root, fifth, octave, seventh-ish colour.
      const walk = [0, 0, 7, 0, 12, 7, 3, 12];
      const midi = chord.bass + 12 + walk[(step / 2) % walk.length];
      voices.acid(time, midi, vel, symbol === 'A' ? 1 : 0.35);
    });
  }

  /** The gun's own voice, steered every beat from the arrangement position. */
  function humTrack() {
    return fn<Chord>(({ bar, step, time }) => {
      if (step % 4 !== 0) return;
      const state = humState(bar, step / 4);
      voices.hum(time, state.midi, state.level, state.cutoff, state.glide);
    });
  }

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: MD_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'attract',
      fromBar: 0,
      tracks: [
        padTrack(0.028),
        arpTrack(arpQuarter, 0.32),
        fn(({ step, time }) => {
          if (step !== 0) return;
          voices.hum(time, HUM_IDLE.midi, HUM_IDLE.level, HUM_IDLE.cutoff, HUM_IDLE.glide);
        }),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: MD_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'injection',
        fromBar: MD_BARS.injection,
        toBar: MD_BARS.stage1,
        tracks: [
          humTrack(),
          padTrack(0.034),
          // Ghost kicks creep in over the first four bars.
          fn(({ barInSection, step, time }) => {
            const pattern = barInSection < 2 ? kickSparse : kickBuild;
            const symbol = pattern[step];
            if (symbol === 'K') voices.kick(time, 1);
            else if (symbol === 'k') voices.kick(time, 0.6 + barInSection * 0.08);
          }),
          hatTrack(hatSparse),
          // The arp climbs in velocity toward the drop.
          arpTrack(arpQuarter, 0.28, 0.09),
          oneShot(3, 0, ({ time }) => voices.riser(time, BAR_SECONDS, 0.1)),
        ],
      },
      {
        name: 'stage-1',
        fromBar: MD_BARS.stage1,
        toBar: MD_BARS.stage2,
        tracks: [
          humTrack(),
          padTrack(0.04),
          kickTrack(kickFloor),
          hatTrack(hatOffbeat),
          bassTrack(bassEighth, 0.2),
          arpTrack(arpQuarter, 0.34),
          oneShot(0, 0, ({ time }) => voices.impact(time, 0.5, 120)),
          oneShot(7, 8, ({ time }) => voices.riser(time, BAR_SECONDS * 0.5, 0.09)),
        ],
      },
      {
        name: 'stage-2',
        fromBar: MD_BARS.stage2,
        toBar: MD_BARS.interlock,
        tracks: [
          humTrack(),
          padTrack(0.036),
          kickTrack(kickFloor),
          hits<Chord>(clapBack, { C: 1 }, ({ time }) => voices.clap(time, 1)),
          hatTrack(hatLattice),
          bassTrack(bassJump, 0.17),
          arpTrack(arpEighth, 0.3),
          acidTrack(),
          oneShot(0, 0, ({ time }) => voices.crash(time, 0.9)),
          // A breath of empty air before the klaxon: strip the last bar back.
          oneShot(7, 0, ({ time }) => voices.riser(time, BAR_SECONDS, 0.13)),
        ],
      },
      {
        name: 'interlock',
        fromBar: MD_BARS.interlock,
        toBar: MD_BARS.shot,
        tracks: [
          humTrack(),
          padTrack(0.03),
          kickTrack(kickLate),
          hits<Chord>(clapBack, { C: 0.8 }, ({ time }) => voices.clap(time, 0.8)),
          hatTrack(hatDense),
          bassTrack(bassJump, 0.15),
          acidTrack(),
          // A two-bar klaxon and a low impact open the section.
          oneShot(0, 0, ({ time }) => {
            voices.klaxon(time, 68, BAR_SECONDS * 2);
            voices.impact(time, 0.85, 150);
          }),
          // Rising alarm sweeps every couple of bars.
          fn(({ barInSection, step, time }) => {
            if (step !== 0 || barInSection % 2 !== 0 || barInSection === 0) return;
            voices.alarm(time, BAR_SECONDS * 0.9, 64 + barInSection);
          }),
          // A noise riser that grows each bar, all the way into the shot.
          fn(({ barInSection, step, time }) => {
            if (step !== 0) return;
            voices.riser(time, BAR_SECONDS, 0.045 + barInSection * 0.022);
          }),
          // The final bar is a snare roll building into THE SHOT.
          fn(({ barInSection, step, time }) => {
            if (barInSection !== 7) return;
            const symbol = snareRoll[step];
            if (symbol === 's') voices.snare(time, 0.4 + step * 0.02);
            else if (symbol === 'S') voices.snare(time, 0.7 + (step - 8) * 0.038);
          }),
        ],
      },
      {
        name: 'muzzle',
        fromBar: MD_BARS.shot,
        tracks: [
          // THE SHOT, on the downbeat. Hard cut, not a crossfade.
          oneShot(0, 0, ({ time, chord }) => {
            voices.humCut(time);
            voices.impact(time, 1, 190);
            voices.crash(time, 1.2);
            runtime.mix()?.duckAt(time, 0.12, 2.4);
            // A huge E-major bloom: the whole run is minor, the release is not.
            voices.pad(time, chord.pad, BAR_SECONDS * 4, 0.075);
            voices.pad(time, [chord.bass + 24, chord.pad[3] + 12], BAR_SECONDS * 3.4, 0.05);
          }),
          // Then only glassy sparkle delays and a subsiding sub pulse.
          fn(({ barInSection, step, time, chord }) => {
            if (barInSection < 1) return;
            const fade = Math.max(0, 1 - (barInSection - 1) / 3.2);
            if (step % 8 === 0) voices.sparkle(time, chord.arp[(step / 8 + barInSection) % chord.arp.length] + 12, 0.9 * fade);
            if (step === 0) voices.bass(time, chord.bass, 0.5 * fade, 0.6);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode, step }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      ambientArrangement.schedule(position, time);
      return;
    }
    if (step === 0) runArrangement.recordSectionStart(time, Math.floor(position / MD_STEPS_PER_BAR));
    runArrangement.schedule(position, time);
  }

  // --- the player's instruments --------------------------------------------

  function sectionLayers(mix: SectionMix<MdSection>): Array<[MdSection, number]> {
    return mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  function killNote(time: number, position: number, mix: SectionMix<MdSection>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    if (midi === undefined) return;

    const fromVoice = SECTION_VOICES[mix.from].kill;
    const toVoice = SECTION_VOICES[mix.to].kill;
    const velocity = Math.min(1.4, 1 + chain * 0.13);
    const decay = lerp(fromVoice.decay, toVoice.decay, mix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, mix.t);
    const reverb = lerp(fromVoice.reverb, toVoice.reverb, mix.t);

    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (audioMix?.delaySend) sends.push({ destination: audioMix.delaySend, gain: 0.42 });
    if (audioMix?.reverbSend) sends.push({ destination: audioMix.reverbSend, gain: reverb });

    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      killLayer.play({
        context: ctx,
        time,
        midi,
        killVoice: SECTION_VOICES[section].kill,
        velocity,
        weight,
        destination: output,
        sends,
      });
    }
    // A pure sine an octave below keeps square and saw voices from thinness.
    killBody.play({ context: ctx, time, midi, decay, gain, velocity, destination: output });
    if (chain >= 2) killOctave.play({ context: ctx, time, midi, decay, gain, destination: output, sends });
    voices.noiseHit(time, 0.032, 0.05, 'highpass', 6400, output);
  }

  /**
   * Each interlock destroyed plays a climbing confirmation: one more note than
   * the last, brighter and higher each time, capped with an ignition ping and a
   * clamp-release clank that drops in pitch per interlock.
   */
  function interlockConfirmation(index: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const notes = Math.min(lead.length, index + 2);

    for (let i = 0; i < notes; i += 1) {
      const at = time + i * THIRTYSECOND * 1.5;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.34,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(lead[i % lead.length] + (index >= 3 ? 12 : 0)),
        filter: { type: 'lowpass', frequency: 1800 + index * 700 },
        gainAutomation: [
          { type: 'set', value: 0.075 + index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.3 },
        ],
        destination: output,
        sends: audioMix?.reverbSend ? [{ destination: audioMix.reverbSend, gain: 0.5 }] : undefined,
      });
    }

    // Ignition ping on top.
    const pingAt = time + notes * THIRTYSECOND * 1.5;
    playOscillatorVoice({
      context: ctx,
      time: pingAt,
      stopTime: pingAt + 0.5,
      oscillatorType: 'sine',
      frequency: midiToFreq(lead[lead.length - 1] + 12),
      gainAutomation: [
        { type: 'set', value: 0.1, time: pingAt },
        { type: 'exponentialRamp', value: 0.001, time: pingAt + 0.45 },
      ],
      destination: output,
      sends: audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.55 }] : undefined,
    });

    // The clamp releasing: a metal clank falling a step per interlock.
    clankTone.play({
      context: ctx,
      time,
      frequency: 300 - index * 32,
      ratio: 1.61,
      vel: 0.16,
      destination: output,
      sends: audioMix?.reverbSend ? [{ destination: audioMix.reverbSend, gain: 0.4 }] : undefined,
    });
    voices.noiseHit(time, 0.11, 0.09, 'bandpass', 2600, output);
  }

  /** The sixth: a beat of ducked silence, an impact, a high stab, a descent. */
  function interlocksClear() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    audioMix.duckAt(time, 0.14, 1.5);
    voices.impact(time + MD_TIME.beatSeconds * 0.5, 0.9, 170);

    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time: time + MD_TIME.beatSeconds * 0.5,
        stopTime: time + 1.1,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 24),
        filter: { type: 'lowpass', frequency: 4200 },
        gainAutomation: [
          { type: 'set', value: 0.05, time: time + MD_TIME.beatSeconds * 0.5 },
          { type: 'exponentialRamp', value: 0.001, time: time + 1.0 },
        ],
        destination: output,
        sends: audioMix.reverbSend ? [{ destination: audioMix.reverbSend, gain: 0.6 }] : undefined,
      });
    }
    // Conclusive descent.
    const lead = score.leadSetAt(position);
    [...lead].reverse().forEach((midi, index) => {
      if (!ctx || !output) return;
      const at = time + MD_TIME.beatSeconds + index * THIRTYSECOND * 2;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.4,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi + 12),
        gainAutomation: [
          { type: 'set', value: 0.09 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.35 },
        ],
        destination: output,
        sends: audioMix.delaySend ? [{ destination: audioMix.delaySend, gain: 0.5 }] : undefined,
      });
    });
  }

  bus.on('kill', ({ indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    // Locks walk up the live lead by lock count.
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const lockVoice = SECTION_VOICES[section].lock;
      lockTone.play({
        context: ctx,
        time,
        midi,
        oscillator: lockVoice.oscillator,
        cutoff: lockVoice.cutoff,
        gainValue: lockVoice.gain,
        lockCount,
        weight,
        destination: output,
        sends: audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.32 }] : undefined,
      });
    }

    // The sixth lock is ignition: an octave ping and a falling sub thump.
    if (lockCount === 6) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.6,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi + 12),
        gainAutomation: [
          { type: 'set', value: 0.11, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
        ],
        destination: output,
        sends: audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.6 }] : undefined,
      });
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.45,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi - 24),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - 36), time: time + 0.34 }],
        gainAutomation: [
          { type: 'set', value: 0.3, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
        ],
        destination: output,
      });
    }
  });

  // Unlock answers with a soft high tick.
  bus.on('unlock', ({ lockCount }) => {
    const output = sfxDestination();
    if (!ctx || !output || lockCount === 0) return;
    voices.noiseHit(score.quantizePlayerAction(ctx.currentTime), 0.028, 0.02, 'highpass', 9000, output);
  });

  // Fire is a short falling zap, rooted on the chord sounding right then.
  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const cutoff = lerp(SECTION_VOICES[mix.from].fire.cutoff, SECTION_VOICES[mix.to].fire.cutoff, mix.t);
    const noise = lerp(SECTION_VOICES[mix.from].fire.noise, SECTION_VOICES[mix.to].fire.noise, mix.t);
    const root = score.chordAt(position).bass;
    fireTone.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      destination: output,
    });
    voices.noiseHit(time, noise, 0.02, 'highpass', 3400, output);
  });

  // Armor chips tick a soft arpeggio off the live chord.
  bus.on('hit', ({ lethal }) => {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.07], [1, 0.06], [2, 0.045]] as const).forEach(([index, vel]) => {
      if (!ctx || !output) return;
      const at = time + THIRTYSECOND * index;
      chipTone.play({
        context: ctx,
        time: at,
        midi: arp[index] + 12,
        vel,
        destination: output,
        sends: audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.35 }] : undefined,
      });
    });
    voices.noiseHit(time, 0.03, 0.03, 'highpass', 6000, output);
  });

  // Stage breaks crack metallically and ring a chord tone into the hall.
  bus.on('stage', () => {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    clankTone.play({ context: ctx, time, frequency: 420, ratio: 1.73, vel: 0.14, destination: output });
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.9,
      oscillatorType: 'triangle',
      frequency: midiToFreq(chord.arp[2] + 12),
      gainAutomation: [
        { type: 'set', value: 0.07, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
      ],
      destination: output,
      sends: audioMix?.reverbSend ? [{ destination: audioMix.reverbSend, gain: 0.7 }] : undefined,
    });
    voices.noiseHit(time, 0.09, 0.06, 'bandpass', 3100, output);
  });

  // A full clean volley lands a chord stab an octave up: the music applauds.
  bus.on('volley', ({ size, kills }) => {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || kills < size || kills < 4) return;
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
          { type: 'set', value: kills === 6 ? 0.062 : 0.042, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
        ],
        destination: output,
        sends: audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.5 }] : undefined,
      });
    }
    voices.noiseHit(time, 0.08, 0.3, 'highpass', 7400, output);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A minor second, dead and low, falling into the floor.
    breakerTone.play({ context: ctx, time, frequency: 116, drop: 0.44, vel: 0.2, destination: output });
    breakerTone.play({ context: ctx, time: time + 0.02, frequency: 123, drop: 0.42, vel: 0.15, destination: output });
    voices.noiseHit(time, 0.16, 0.1, 'lowpass', 420, output);
  });

  // A player hit booms a falling octave under a two-note hull alarm.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.6,
      oscillatorType: 'sine',
      frequency: 160,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 80, time: time + 0.4 }],
      gainAutomation: [
        { type: 'set', value: 0.44, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.58 },
      ],
      destination: output,
    });
    hullAlarmTone.play({ context: ctx, time, midi: 79, vel: 0.11, destination: output });
    hullAlarmTone.play({ context: ctx, time: time + 0.16, midi: 74, vel: 0.1, destination: output });
    voices.noiseHit(time, 0.18, 0.14, 'bandpass', 800, output);
  });

  // A miss is a barely-there falling tick.
  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.13,
      oscillatorType: 'sine',
      frequency: 700,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 420, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.026, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: output,
    });
  });

  bus.on('runstart', () => {
    interlocksDown = 0;
  });

  onSignal((signal) => {
    if (signal.type === 'interlock-down') {
      interlocksDown = signal.count;
      interlockConfirmation(interlocksDown - 1);
    } else if (signal.type === 'interlocks-clear') {
      interlocksClear();
    } else if (signal.type === 'detonation') {
      const context = runtime.context();
      const audioMix = runtime.mix();
      if (!context || !audioMix) return;
      // Containment failure cuts the music to a long low rumble.
      audioMix.duckAt(context.currentTime, 0.05, 3.5);
      voices.humCut(context.currentTime);
      voices.rumble(context.currentTime, 3.2);
    }
  });

  void blank;
  return runtime;
}
