import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { BROOD_WAVE_SIZES, MATRIARCH_TOTAL_HP } from './matriarch';
import { createStrandlineVoices, installStrandlineWater, type StrandTonalVoice, type WaterController } from './audio-voices';
import { STRANDLINE_BARS, STRANDLINE_BPM, STRANDLINE_DURATION, STRANDLINE_SCORE_SECTIONS, STRANDLINE_STEPS_PER_BAR, STRANDLINE_TIME } from './timing';

// The Strandline score: 96 BPM in D dorian, 24 bars = exactly the 60-second
// swim, and the arrangement is the animal's vital signs. It starts as almost
// nothing — a current bed, a slow heartbeat, one dark pad — and gains a layer
// every time the run moves deeper into the colony: droplets in the forest,
// the glass gong and wide pads when the bell fills the view, a driving pulse
// in the thick, then the crown strips it all back to heartbeat and dread
// while the Matriarch holds the web. The release resolves to D major at a
// whisper. Locks, shots, chips, and kills are all notes in this score: they
// snap to the transport, read the live chord, and kills walk hidden per-act
// melody lanes so a clean volley is a solo.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Dm9 — Fmaj7 — G6 — Am7, two bars each: the drifting dorian loop.
const CHORDS: Chord[] = [
  { bass: 38, pad: [57, 62, 65, 72], arp: [62, 65, 69, 72], stab: [62, 65, 69] }, // Dm9
  { bass: 41, pad: [57, 60, 64, 65], arp: [65, 69, 72, 76], stab: [65, 69, 72] }, // Fmaj7
  { bass: 43, pad: [59, 62, 64, 67], arp: [67, 71, 74, 79], stab: [67, 71, 74] }, // G6
  { bass: 45, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79], stab: [69, 72, 76] }, // Am7
];
// Crown bars 17–22 walk Dm — Bb — Dm — A7 — Dm; the flat sixth is the thing
// dug into the crown. (Array order compensates for absolute-bar indexing:
// bar % 4 → 17:1, 18:2, 19:3, 20:0, 21:1.)
const CROWN_CHORDS: Chord[] = [
  { bass: 45, pad: [57, 61, 64, 67], arp: [69, 73, 76, 79], stab: [69, 73, 76] }, // A7 (bar 20)
  CHORDS[0], //                                                  Dm (bars 17, 21)
  { bass: 34, pad: [58, 62, 65, 69], arp: [65, 70, 74, 77], stab: [65, 70, 74] }, // Bbmaj7 (bar 18)
  CHORDS[0], //                                                  Dm (bar 19)
];
// Release: D major with the ninth — arrival warmth.
const RELEASE_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 62, 66, 69], arp: [62, 66, 69, 74], stab: [66, 69, 74] },
];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Drift: slow arches barely leaving the floor of the chord.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 5, 4, 2,
  ],
  // Forest: brighter stepwise runs with small leaps.
  1: [
    0, 2, 4, 2, 3, 5, 3, 4,
    6, 4, 5, 7, 5, 4, 3, 4,
    2, 4, 6, 4, 3, 5, 7, 5,
    6, 5, 4, 3, 4, 5, 6, 7,
  ],
  // Reveal: high radiant fragments against the bell.
  2: [
    4, 5, 7, 6, 5, 7, 6, 5,
    7, 6, 5, 4, 6, 5, 7, 6,
    5, 6, 7, 5, 6, 7, 5, 4,
    7, 6, 5, 6, 7, 6, 5, 4,
  ],
  // Thick: jump-cut broken chords for dense volleys.
  3: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 6, 5, 7, 6, 4, 2, 0,
  ],
  // Crown: tolling descents while the web holds.
  4: [
    7, 6, 5, 4, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
    5, 4, 3, 2, 3, 2, 1, 0,
    3, 2, 1, 0, 2, 3, 4, 5,
  ],
  // Release: settling home.
  5: [
    4, 3, 2, 1, 2, 1, 0, 1,
    2, 3, 4, 3, 2, 1, 0, 0,
    3, 2, 1, 0, 1, 0, 1, 2,
    3, 2, 1, 0, 0, 1, 2, 3,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: StrandTonalVoice; kill: StrandTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 2600, gain: 0.13, sparkle: 0.35, reverb: 0.3 },
    kill: { oscillator: 'sine', decay: 0.34, cutoff: 2800, gain: 0.15, sparkle: 0.5, reverb: 0.36 },
    fire: { oscillator: 'triangle', cutoff: 2400, gain: 0.06, fallSemitones: 9, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 3100, gain: 0.12, sparkle: 0.5, reverb: 0.24 },
    kill: { oscillator: 'triangle', decay: 0.28, cutoff: 3300, gain: 0.14, sparkle: 0.6, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.06, fallSemitones: 10, noise: 0.04 },
  },
  2: {
    // The bell in view: everything the player does turns to glass.
    lock: { oscillator: 'sine', decay: 0.13, cutoff: 4400, gain: 0.14, sparkle: 0.8, reverb: 0.4 },
    kill: { oscillator: 'sine', decay: 0.4, cutoff: 4800, gain: 0.16, sparkle: 0.9, reverb: 0.44 },
    fire: { oscillator: 'triangle', cutoff: 3600, gain: 0.055, fallSemitones: 12, noise: 0.035 },
  },
  3: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2700, gain: 0.05, sparkle: 0.45, reverb: 0.2 },
    kill: { oscillator: 'square', decay: 0.22, cutoff: 3100, gain: 0.11, sparkle: 0.6, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 3300, gain: 0.05, fallSemitones: 8, noise: 0.05 },
  },
  4: {
    // Under the crown: dull, close, heavy on the tail — the water feels thick.
    lock: { oscillator: 'sine', decay: 0.14, cutoff: 1600, gain: 0.12, sparkle: 0.15, reverb: 0.48 },
    kill: { oscillator: 'sine', decay: 0.42, cutoff: 1800, gain: 0.15, sparkle: 0.3, reverb: 0.52 },
    fire: { oscillator: 'square', cutoff: 1500, gain: 0.045, fallSemitones: 14, noise: 0.02 },
  },
  5: {
    lock: { oscillator: 'sine', decay: 0.18, cutoff: 2800, gain: 0.09, sparkle: 0.55, reverb: 0.55 },
    kill: { oscillator: 'sine', decay: 0.55, cutoff: 3200, gain: 0.12, sparkle: 0.7, reverb: 0.6 },
    fire: { oscillator: 'sine', cutoff: 2200, gain: 0.04, fallSemitones: 8, noise: 0.015 },
  },
};

const TOTAL_BROODS = BROOD_WAVE_SIZES[0] + BROOD_WAVE_SIZES[1];

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-s7ah',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: STRANDLINE_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let water: WaterController | null = null;
  let matriarchId = -1;
  let broodIds = new Set<number>();
  let broodsKilled = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.release, chords: CROWN_CHORDS, barsPerChord: 1 },
      { fromBar: STRANDLINE_BARS.release, chords: RELEASE_CHORDS, barsPerChord: 1 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
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
      compressor: { threshold: -16, ratio: 4.5, attack: 0.004, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2200 },
      reverb: { seconds: 3.2, decay: 2.9, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      water = installStrandlineWater(context, mix);
      water.setWater(context.currentTime + 0.1, 0.16, 1.5);
    },
    onStep: scheduleStep,
    onRunStart() {
      matriarchId = -1;
      broodIds = new Set();
      broodsKilled = 0;
      const context = runtime.context();
      if (context && water) water.setWater(context.currentTime + 0.05, 0.3, 1.2);
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) {
        water?.setWater(context.currentTime + 0.5, 0.14, 4);
        pad(context.currentTime + 0.05, [57, 62, 66, 69, 74], 6, 0.8, 2, 1500);
      }
    },
    onDispose() {
      ctx = null;
      water = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement -----------------------------------------------------------

  const heartBar = 'H...............'; // one lub-dub per bar: the vital sign
  const heartHalf = 'H.......H.......';
  const fourFloor = 'K...K...K...K...';
  const softFloor = 'K.......K.......';
  const shakerOff = '..s...s...s...s.';
  const shakerSix = 's.s.s.sss.s.s.ss';
  const snapBack = '....S.......S...';
  const tickBar = 't..t..t.t..t..t.'; // 3-3-2: the colony's nervous pulse

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
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.6, 1, 900)),
          hits(heartBar, { H: 0.5 }, ({ time }, vel) => heart(time, vel)),
          hits(['............D...', '......D.........'].join(''), { D: 1 }, ({ time, step, chord }) => droplet(time, chord.arp[step % chord.arp.length], 0.4, 2400)),
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
        name: 'drift',
        fromBar: STRANDLINE_BARS.drift,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.85, 1, 980)),
          hits(heartBar, { H: 0.85 }, ({ time }, vel) => heart(time, vel)),
          hits('B...............', { B: 0.6 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0)),
          hits(['..........D.....', '....D...........'].join(''), { D: 1 }, ({ time, step, bar, chord }) => droplet(time, chord.arp[(step + bar) % chord.arp.length], 0.45, 2400)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 1 && step === 12) bell(time, chord.arp[2], 0.24); }),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.14)),
        ],
      },
      {
        name: 'forest',
        fromBar: STRANDLINE_BARS.forest,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.04, 0.9, 2, 1250)),
          hits(heartHalf, { H: 0.7 }, ({ time }, vel) => heart(time, vel)),
          hits([softFloor, softFloor, fourFloor, fourFloor, fourFloor, fourFloor].join(''), { K: 0.7 }, ({ time }, vel) => kick(time, vel)),
          hits(shakerOff, { s: 0.06 }, ({ time }, vel) => shaker(time, vel, 0.04)),
          hits('B.......b.....B.', { B: 0.7, b: 0.5 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.25)),
          hits('D...d...D...d...', { D: 0.55, d: 0.4 }, ({ time, step, chord }, vel) => droplet(time, chord.arp[(step / 4) % chord.arp.length], vel, 2700)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 0 && step === 8) bell(time, chord.arp[3], 0.26); }),
          oneShot(5, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.18)),
        ],
      },
      {
        name: 'reveal',
        fromBar: STRANDLINE_BARS.reveal,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            // The swing goes wide: the water clears and the build starts.
            crash(time, 0.14);
            riser(time, 28 * SIXTEENTH, 0.2);
            waterTo(time, 0.1, 3);
          }),
          // The strafe lines up and the bell fills the view: one struck glass
          // moon, timed to the rail geometry rather than the section downbeat.
          oneShot(1, 12, ({ time, chord }) => {
            gong(time, chord.bass + 12, 1);
            crash(time, 0.22);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, [...chord.pad, chord.pad[1] + 12], 32 * SIXTEENTH * 1.02, 1, 3, 2100)),
          hits(fourFloor, { K: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits(heartHalf, { H: 0.55 }, ({ time }, vel) => heart(time, vel)),
          hits('s.s.s.s.s.s.s.s.', { s: 0.045 }, ({ time }, vel) => shaker(time, vel, 0.03)),
          fn(({ time, step, chord }) => {
            const bassSteps: Record<number, [number, number]> = { 0: [0, 0.9], 6: [12, 0.5], 8: [0, 0.8], 14: [7, 0.55] };
            if (step in bassSteps) bass(time, chord.bass + bassSteps[step][0], bassSteps[step][1], 0.5);
          }),
          hits('D.d.D.d.D.d.D.d.', { D: 0.6, d: 0.4 }, ({ time, step, chord }, vel) => {
            const order = [0, 2, 1, 3, 2, 0, 3, 1];
            droplet(time, chord.arp[order[(step / 2) % order.length]] + 12, vel, 3600);
          }),
          fn(({ time, step, bar, chord }) => { if (step === 8) bell(time, chord.arp[(bar + 2) % chord.arp.length] + 12, 0.3); }),
        ],
      },
      {
        name: 'thick',
        fromBar: STRANDLINE_BARS.thick,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.85, 2, 1600)),
          hits(fourFloor, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(snapBack, { S: 0.8 }, ({ time }, vel) => snap(time, vel)),
          hits(shakerSix, { s: 0.04 }, ({ time }, vel) => shaker(time, vel, 0.025)),
          fn(({ time, step, chord }) => {
            const bassSteps: Record<number, [number, number]> = { 0: [0, 1], 3: [0, 0.7], 6: [12, 0.55], 8: [0, 0.9], 11: [7, 0.6], 14: [12, 0.7] };
            if (step in bassSteps) bass(time, chord.bass + bassSteps[step][0], bassSteps[step][1], 0.7);
          }),
          hits('D.d.D.d.D.d.D.d.', { D: 0.5, d: 0.35 }, ({ time, step, chord }, vel) => {
            const order = [0, 3, 1, 2, 3, 0, 2, 1];
            droplet(time, chord.arp[order[(step / 2) % order.length]], vel, 3000);
          }),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'crown',
        fromBar: STRANDLINE_BARS.crown,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.1);
            crash(time, 0.18);
            waterTo(time, 0.34, 2);
          }),
          hits('S.......S.......', { S: 0.8 }, ({ time, chord }, vel) => subPulse(time, chord.bass - 12, vel)),
          hits(heartBar, { H: 1 }, ({ time }, vel) => heart(time, vel)),
          hits(tickBar, { t: 0.4 }, ({ time }, vel) => shaker(time, vel, 0.02)),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0 && barInSection % 2 === 0) menace(time, chord.bass + 12, 32 * SIXTEENTH * 0.96, 0.9);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad.slice(0, 3), 32 * SIXTEENTH * 1.02, 0.6, 1, 820)),
          fn(({ time, step, barInSection }) => {
            // The last bar before the release: the pulse tightens.
            if (barInSection === 4 && step % 4 === 2) shaker(time, 0.5 + step * 0.02, 0.02);
          }),
        ],
      },
      {
        name: 'release',
        fromBar: STRANDLINE_BARS.release,
        toBar: STRANDLINE_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            pad(time, chord.pad, 44 * SIXTEENTH, 0.9, 2, 1500);
            subPulse(time, chord.bass, 0.4);
            waterTo(time, 0.08, 4);
          }),
          hits(heartBar, { H: 0.55 }, ({ time }, vel) => heart(time, vel)),
          oneShot(0, 8, ({ time }) => bell(time, 74, 0.32)),
          oneShot(0, 14, ({ time }) => bell(time, 69, 0.28)),
          oneShot(1, 4, ({ time }) => bell(time, 66, 0.26)),
          oneShot(1, 10, ({ time }) => chime(time, 78, 2.8, 0.4)),
          oneShot(1, 12, ({ time }) => gong(time, 50, 0.5)),
        ],
      },
    ],
  });

  function waterTo(time: number, level: number, ramp: number) {
    water?.setWater(time, level, ramp);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ----------------------------------------------------------------

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, heart, shaker, snap, subPulse, bass, pad, droplet, bell, chime, gong, menace, skitter, riser, crash, impact,
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
    oscillators: [{ type: 'sine', octave: 1, gain: 0.3 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.17 }],
    duration: 0.18,
    stopPadding: 0.04,
    envelope: { decay: 0.18 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.09 },
  });

  // Rejection: the infestation's answer — a dry, flat gulp with no shimmer.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 4.5, frequency: 420 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.42 }],
    duration: 0.6,
    stopPadding: 0.05,
    envelope: { decay: 0.6 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.13,
    stopPadding: 0.02,
    envelope: { decay: 0.13 },
  });

  const squelchVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: ({ vel }) => vel }],
    duration: 0.1,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 2600 },
    envelope: { decay: 0.1 },
  });

  // ---- player instruments ----------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof StrandTonalVoice) {
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
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.42, 0.25) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkle * 0.04, 0.08, 7000);
  }

  // Each brood kill audibly returns light to the colony — a rising three-note
  // figure that climbs with the count, and a shimmering wash when a wave dies.
  function broodChime(time: number) {
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const start = Math.min(4, broodsKilled - 1);
    [0, 2, 4].forEach((offset, index) => {
      const degree = Math.min(7, start + offset);
      playerTone(time + index * THIRTYSECOND * 2, leadSet[degree], PLAYER_VOICES[2].kill, 0.5 + broodsKilled * 0.04, 1);
    });
    if (broodsKilled === BROOD_WAVE_SIZES[0] || broodsKilled === TOTAL_BROODS) {
      // A webbing layer starves: shimmer up, and the dread thins.
      crash(time + SIXTEENTH, 0.16);
      chime(time + SIXTEENTH * 2, 81, 2.2, 0.35);
      const output = sfxDestination();
      if (output) noiseHit(time + SIXTEENTH, 0.12, 0.6, 'highpass', 5200, output);
    }
  }

  // The Matriarch audibly loses its grip: every chip is brighter, higher, and
  // more strained than the last.
  function matriarchChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sawtooth',
      frequency: root * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root * (1 + intensity * 1.3), time: time + 0.3 }],
      filter: { type: 'lowpass', frequency: 620 + intensity * 2800, Q: 2 },
      gainAutomation: [
        { type: 'set', value: 0.1 + intensity * 0.1, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
      ],
      destination: output,
      sends: playerSends(0.2, 0.4),
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon, PLAYER_VOICES[4].kill, 0.5 + intensity * 0.4, 1);
    playerNoise(time, 0.07 + intensity * 0.08, 0.09, 3800);
  }

  // The killing blow: the music holds its breath, the grip tears with a deep
  // drop, and a slow D-major peal climbs out of it — the animal waking up.
  function matriarchFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    audioMix.duckAt(time, 0.12, 2.2);
    impact(time, 1.3);
    subPulse(time + 0.02, 26, 1);
    noiseHit(time + 0.05, 0.2, 0.9, 'bandpass', 1100, output);
    // The waking peal: D major rising through two octaves, ringing out.
    const releaseChord = RELEASE_CHORDS[0];
    const peal = [...releaseChord.arp, ...releaseChord.arp.map((midi) => midi + 12)];
    peal.forEach((midi, index) => {
      const at = time + 0.25 + index * SIXTEENTH;
      playerTone(at, midi, PLAYER_VOICES[5].kill, 0.85 - index * 0.05, 1);
    });
    gong(time + 0.25 + peal.length * SIXTEENTH, 50, 0.8);
    chime(time + 0.25 + peal.length * SIXTEENTH, 86, 3.0, 0.4);
  }

  // ---- event wiring ----------------------------------------------------------

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
    playerNoise(time, 0.01 + sparkle * 0.028, 0.02, 8800);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.14 }],
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.07 }],
        destination: output,
        sends: playerSends(0.14, 0.1),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.03, 4200);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === matriarchId) {
      matriarchChip(time, 1 - hitPointsRemaining / MATRIARCH_TOTAL_HP);
      return;
    }
    // Shell chip on a spitter: a soft wet knock climbing the chord.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      squelchVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        vel: 0.05 - index * 0.01,
        destination: output,
        sends: playerSends(0.2, 0.18),
      });
    }
    playerNoise(time, 0.035, 0.03, 4800);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    noiseHit(time, 0.16, 0.16, 'bandpass', 1900, output);
    if (enemyId === matriarchId) {
      // Half the grip tears free; it thrashes, and the dread motif cracks.
      riser(time, 1.3, 0.15);
      subPulse(time + 0.05, chord.bass - 12, 0.9);
      menace(time + 0.1, chord.bass + 13, 1.6, 0.7);
    } else {
      squelchVoice.play({ context: ctx, time, midi: chord.stab[0] + 24, vel: 0.06, destination: output });
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === matriarchId) {
      matriarchFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    if (broodIds.delete(enemyId)) {
      broodsKilled += 1;
      broodChime(kill.time + SIXTEENTH);
    }
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

  bus.on('shielded', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // The web takes the shot: a rubbery, detuned shed — clearly not a hit.
    const time = ctx.currentTime;
    noiseHit(time, 0.12, 0.12, 'bandpass', 1500, output);
    rejectVoice.play({
      context: ctx,
      time,
      frequency: 240,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 130, time: time + 0.14 }],
      vel: 0.09,
      destination: output,
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[196, time, 0.14], [180, time + 0.09, 0.1]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.5, time: at + 0.16 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.1, 0.07, 'bandpass', 640, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Venom burn: a pressure boom through the water and an acid fizz.
    hullBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.32 }],
      destination: output,
    });
    noiseHit(time, 0.16, 0.16, 'bandpass', 820, output);
    noiseHit(time + 0.06, 0.09, 0.45, 'highpass', 3600, output);
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.11 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'matriarch') {
      matriarchId = enemyId;
      // The crown comes into view: the mix ducks, something vast shifts its
      // grip, and the dread motif arrives under a long riser.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const audioMix = runtime.mix();
      audioMix?.duckAt(time, 0.35, 1.0);
      impact(time, 1.2);
      riser(time + 0.1, 2.2, 0.16);
      menace(time + 0.15, 26, 2.6, 1);
    } else if (kind === 'brood') {
      broodIds.add(enemyId);
      skitter(score.nextGridTime(ctx.currentTime, 0.5), 0.7);
    } else if (kind === 'spitter') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      const position = score.arrangementPositionAt(time);
      droplet(time, score.chordAt(position).stab[0] - 12, 0.5, 1400);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'exposed') {
      // The web is down: a clear rising call on the naked heart.
      const time = score.nextGridTime(ctx.currentTime, 1);
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      [0, 2, 4].forEach((degree, index) => {
        playerTone(time + index * THIRTYSECOND * 2, leadSet[degree] + 12, PLAYER_VOICES[4].kill, 0.6, 1);
      });
      riser(time, 1.2, 0.14);
    }
  });

  return runtime;
}
