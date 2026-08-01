import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createVespersVoices, type VespersKillVoice } from './audio-voices';
import {
  VESPERS_BARS,
  VESPERS_BPM,
  VESPERS_SCORE_SECTIONS,
  VESPERS_STEPS_PER_BAR,
  VESPERS_TIME,
} from './timing';

// The music is the building's own organ. No percussion at all: the pulse is
// the counterpoint moving. The run opens on a single held pedal note and the
// voices enter one at a time above it — a real tune in real counterpoint —
// with choir and bell weight for the swells, and one voice (the bright
// principale) held back all night so the ending has somewhere to arrive.
// The player's locks, shots, and kills are organ voices too: notes inside the
// polyphony. Kills read a hidden melodic lane from the live harmony, so a
// chained volley performs a real run; the killing blow on the Devourer opens
// every rank at once and the minor turns major.

const SIXTEENTH = VESPERS_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = VESPERS_STEPS_PER_BAR;
const LANE_STEPS = 32; // two bars: one full chord

type Chord = { bass: number; pad: number[]; arp: number[] };

// A minor for the dark, moving through the subdominant and relative major.
const CHORDS: Chord[] = [
  { bass: 45, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] }, // Am
  { bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] }, // F
  { bass: 48, pad: [55, 60, 64, 67], arp: [67, 72, 76, 79] }, // C
  { bass: 43, pad: [55, 59, 62, 67], arp: [67, 71, 74, 79] }, // G
];

// The finale cadence: Am – F – Dm – Am, one bar each, so the ending has
// somewhere to arrive; the rose ignition resolves it to A major.
const FINALE_CHORDS: Chord[] = [
  { bass: 45, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] }, // Am
  { bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] }, // F
  { bass: 50, pad: [57, 62, 65, 69], arp: [69, 74, 77, 81] }, // Dm
  { bass: 45, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] }, // Am
];

type ChordRoot = 'am' | 'f' | 'c' | 'g' | 'dm';

function chordRoot(chord: Chord): ChordRoot {
  if (chord.bass === 45) return 'am';
  if (chord.bass === 41) return 'f';
  if (chord.bass === 48) return 'c';
  if (chord.bass === 43) return 'g';
  return 'dm';
}

// The cantus: the opening tune, one entry per half note (8 per 2-bar chord),
// written as degrees into the chord's pad. Each chord gets its own contour so
// the melody actually moves; the counterpoint follows a bar later.
const CANTUS: Record<ChordRoot, number[]> = {
  am: [0, 2, 3, 2, 1, 3, 2, 0],
  f: [1, 2, 1, 0, 1, 2, 3, 2],
  c: [2, 3, 2, 1, 2, 3, 2, 0],
  g: [3, 2, 1, 0, 1, 2, 3, 1],
  dm: [0, 2, 1, 3, 2, 1, 0, 1],
};

const COUNTER: Record<ChordRoot, number[]> = {
  am: [0, 1, 2, 1, 0, 1, 2, 3],
  f: [0, 1, 2, 1, 2, 1, 0, 1],
  c: [1, 2, 1, 0, 1, 0, 2, 1],
  g: [0, 1, 2, 3, 2, 1, 0, 1],
  dm: [1, 0, 2, 1, 0, 1, 2, 1],
};

// The perpetual-motion inner voice: eight 8th notes per bar, stepwise, one
// pattern per bar so the pulse keeps turning over.
const MOVING_PATTERNS = [
  [0, 1, 2, 3, 2, 1, 2, 3],
  [1, 0, 1, 2, 3, 2, 1, 2],
  [2, 3, 2, 1, 0, 1, 2, 3],
  [3, 2, 1, 0, 1, 2, 1, 0],
];

const BELL_PEAL = [3, 2, 1, 0, 1, 2, 3, 2];

// The principale descant — the voice held back all night, pealing above the
// cantus once the finale breaks.
const DESCANT = [3, 2, 1, 0, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1];

// The hidden kill-melody lanes. Degrees 0–7 into the lead set (arp + octave),
// one lane per player-timbre section; a chained volley walks the lane.
type SectionIndex = 0 | 1 | 2 | 3;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // flute stop — the opening: a slow stepwise arch.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // principal — the swell: octave zig-zags, faster broken-chord runs.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // vox — the quiet: small steps, sparse, alone.
  2: [
    0, 1, 0, 1, 2, 1, 0, 1,
    0, 1, 2, 3, 2, 1, 0, 1,
    2, 3, 2, 1, 2, 3, 4, 3,
    2, 1, 0, 1, 2, 1, 0, 1,
  ],
  // trumpet — the finale: pealing thirds and sixths, ringing out.
  3: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
};

const LOCK_SCALE = [69, 72, 74, 76, 79, 81]; // A minor pentatonic, rising per lock

// Per-section registration for the player's instruments. Gains are tuned for
// perceived loudness: a saw at the same number as a sine sounds far louder.
const SECTION_VOICES: Record<SectionIndex, {
  kill: VespersKillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.55, cutoff: 3400, gain: 0.2, shimmer: 0.3 },
    lock: { oscillator: 'triangle', cutoff: 2600, gain: 0.11 },
    fire: { cutoff: 1800, noise: 0.04 },
  },
  1: {
    kill: { oscillator: 'triangle', decay: 0.42, cutoff: 3000, gain: 0.17, shimmer: 0.5 },
    lock: { oscillator: 'triangle', cutoff: 2200, gain: 0.09 },
    fire: { cutoff: 2600, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'sine', decay: 0.7, cutoff: 3200, gain: 0.18, shimmer: 0.25 },
    lock: { oscillator: 'triangle', cutoff: 2400, gain: 0.09 },
    fire: { cutoff: 1700, noise: 0.03 },
  },
  3: {
    kill: { oscillator: 'sawtooth', decay: 0.6, cutoff: 3600, gain: 0.13, shimmer: 0.75 },
    lock: { oscillator: 'sawtooth', cutoff: 2000, gain: 0.045 },
    fire: { cutoff: 4000, noise: 0.07 },
  },
};

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-8qvg',
  bpm: VESPERS_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createVespersAudio,
});

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let coreId = -1;
  let coreMaxHp = 0;
  let coreKilled = false;

  const score = createScore<Chord, SectionIndex>({
    bpm: VESPERS_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: VESPERS_BARS.finale, chords: FINALE_CHORDS, barsPerChord: 1 }],
    sections: VESPERS_SCORE_SECTIONS,
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
      compressor: { threshold: -16, ratio: 4, attack: 0.006, release: 0.25 },
      delay: { time: SIXTEENTH * 6, feedback: 0.3, dampHz: 3000 },
      reverb: { seconds: 4.6, decay: 2.6, level: 0.5, returnTo: 'duck' },
      noiseSeconds: 1.5,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      coreId = -1;
      coreMaxHp = 0;
      coreKilled = false;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (!context || coreKilled) return;
      // The Devourer escaped: a soft A minor closes the night, unresolved.
      voices.choir(context.currentTime + 0.05, [57, 60, 64, 67], 4, 0.3);
    },
    onDispose() {
      ctx = null;
    },
  });

  // ---- voices -------------------------------------------------------------

  const voices = createVespersVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { flute, gamba, chorale, moving, principale, bell, choir, pedal, riser } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- player instruments -------------------------------------------------

  const killLayerVoice = voice<{ voice: VespersKillVoice }>({
    oscillators: [
      { type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain },
      { type: 'sine', octave: 1, gain: 0.22 },
    ],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.45,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { attack: 0.012, decay: ({ voice }) => voice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.55 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.45,
    envelope: { attack: 0.02, decay: ({ decay }) => decay },
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.38 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.45,
    envelope: { attack: 0.015, decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.1,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 160 },
    envelope: { attack: 0.004, decay: 0.1 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.07 }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: 0.004, decay: 0.09 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.16,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 4200 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5 },
      { type: 'sawtooth', gain: 0.5, frequencyRatio: 1.059 },
    ],
    duration: 0.5,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 800 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: vel, time: time + 0.04 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
    ],
  });

  const blastVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.7 }],
    duration: 0.7,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 900 },
    frequencyAutomation: (time) => [
      { type: 'set', value: 150, time },
      { type: 'exponentialRamp', value: 52, time: time + 0.55 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const missTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.18,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [
      { type: 'set', value: 140, time },
      { type: 'exponentialRamp', value: 70, time: time + 0.15 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
  });

  // ---- the arrangement ----------------------------------------------------

  function pedalTrack() {
    return fn<Chord>(({ position, time, chord }) => {
      const previous = score.chordAt(position - 1);
      if (previous === chord) return;
      pedal(time, chord.bass - 12, 1);
    });
  }

  function cantusTrack(vel: number) {
    return fn<Chord>(({ position, step, time, chord }) => {
      if (step % 8 !== 0) return;
      const halfIndex = (Math.floor(position / STEPS_PER_BAR) % 2) * 4 + Math.floor(step / 8);
      flute(time, chord.pad[CANTUS[chordRoot(chord)][halfIndex]], vel);
    });
  }

  function counterTrack(vel: number) {
    return fn<Chord>(({ position, step, time, chord }) => {
      if (step % 8 !== 0) return;
      const halfIndex = (Math.floor(position / STEPS_PER_BAR) % 2) * 4 + Math.floor(step / 8);
      gamba(time, chord.pad[COUNTER[chordRoot(chord)][halfIndex]], vel);
    });
  }

  function choraleTrack(vel: number) {
    return fn<Chord>(({ step, time, chord }) => {
      if (step !== 0 && step !== 8) return;
      for (const degree of [0, 1, 2]) chorale(time, chord.pad[degree], vel);
    });
  }

  function movingTrack(vel: number) {
    return fn<Chord>(({ position, step, time, chord }) => {
      if (step % 2 !== 0) return;
      const bar = Math.floor(position / STEPS_PER_BAR);
      const pattern = MOVING_PATTERNS[bar % MOVING_PATTERNS.length];
      moving(time, chord.pad[pattern[(step / 2) % pattern.length]], vel);
    });
  }

  function bellTrack(vel: number) {
    return fn<Chord>(({ position, step, time, chord }) => {
      if (step % 4 !== 0) return;
      bell(time, chord.arp[BELL_PEAL[(position / 4) % BELL_PEAL.length]], vel);
    });
  }

  function descantTrack(vel: number) {
    return fn<Chord>(({ position, step, time, chord }) => {
      if (step % 4 !== 0) return;
      principale(time, chord.arp[DESCANT[(position / 4) % DESCANT.length]], vel);
    });
  }

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      { name: 'ambient', fromBar: 0, tracks: [pedalTrack(), cantusTrack(0.4)] },
    ],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      { name: 'pedal', fromBar: 0, toBar: 1, tracks: [pedalTrack()] },
      { name: 'cantus', fromBar: 1, toBar: 2, tracks: [pedalTrack(), cantusTrack(0.9)] },
      { name: 'counter', fromBar: 2, toBar: 4, tracks: [pedalTrack(), cantusTrack(0.9), counterTrack(0.7)] },
      { name: 'chorale', fromBar: 4, toBar: 6, tracks: [pedalTrack(), cantusTrack(0.9), counterTrack(0.7), choraleTrack(0.5)] },
      { name: 'moving', fromBar: 6, toBar: 8, tracks: [pedalTrack(), cantusTrack(0.9), counterTrack(0.7), choraleTrack(0.5), movingTrack(0.42)] },
      {
        name: 'swell', fromBar: 8, toBar: 10,
        tracks: [
          pedalTrack(), cantusTrack(0.9), counterTrack(0.7), choraleTrack(0.5), movingTrack(0.45), bellTrack(0.12),
          oneShot(0, 0, ({ time, chord }) => choir(time, chord.pad, 6.0, 0.4)),
        ],
      },
      { name: 'settle', fromBar: 10, toBar: 12, tracks: [pedalTrack(), cantusTrack(0.9), counterTrack(0.7), choraleTrack(0.5), movingTrack(0.45), bellTrack(0.08)] },
      { name: 'quiet', fromBar: 12, toBar: 15, tracks: [pedalTrack(), cantusTrack(0.55)] },
      { name: 'rebuild', fromBar: 15, toBar: 16, tracks: [pedalTrack(), cantusTrack(0.9), counterTrack(0.7), choraleTrack(0.5), movingTrack(0.45)] },
      {
        name: 'finale', fromBar: 16, toBar: 20,
        tracks: [
          pedalTrack(), cantusTrack(0.95), counterTrack(0.75), choraleTrack(0.55), movingTrack(0.5),
          descantTrack(0.5), bellTrack(0.14),
          oneShot(0, 0, ({ time, chord }) => choir(time, chord.pad, 6.0, 0.42)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments -------------------------------------------

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = SECTION_VOICES[sectionMix.from].kill;
    const toVoice = SECTION_VOICES[sectionMix.to].kill;
    const vel = Math.min(1.35, 1 + chain * 0.12);
    const decay = lerp(fromVoice.decay, toVoice.decay, sectionMix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, sectionMix.t);
    const shimmer = lerp(fromVoice.shimmer, toVoice.shimmer, sectionMix.t);

    const layers: Array<[VespersKillVoice, number]> = sectionMix.from === sectionMix.to
      ? [[toVoice, 1]]
      : [[fromVoice, 1 - sectionMix.t], [toVoice, sectionMix.t]];
    for (const [voice, weight] of layers) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        voice,
        velocity: vel,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    killBodyVoice.play({
      context: ctx,
      time,
      midi,
      decay,
      gain,
      velocity: vel,
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.4 }],
    });
    if (chain >= 2) {
      killOctaveVoice.play({
        context: ctx,
        time,
        midi,
        decay,
        gain,
        velocity: vel,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    voices.noiseHit(time, 0.05 * shimmer + 0.03, 0.08, 'highpass', 5000, output);
  }

  // Chipping the Devourer rings the stolen colours out of it: a bell peal
  // that grows with the damage dealt and a beacon climbing the lead set, so
  // the fight audibly ratchets toward the finale.
  function coreChip(intensity: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    for (let i = 0; i < 3; i += 1) {
      const at = time + i * 0.09;
      bell(at, chord.arp[(i + Math.floor(intensity * 2)) % chord.arp.length] + 12, 0.1 + intensity * 0.06);
    }
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * (leadSet.length - 1)))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.6,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.05 + 0.06 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
      ],
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
    });
    voices.noiseHit(time, 0.05 + 0.05 * intensity, 0.06, 'bandpass', 1400, output);
  }

  // The killing blow: every rank of the organ opens at once. The music ducks
  // for a breath, the sub drops to the tonic, a huge A major chord (the
  // picardy third — the minor turns major) blooms through every register,
  // and bells cascade down from the top of the rose.
  function roseTutti() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.duck) return;
    const audio = ctx;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    audioMix.duckAt(time, 0.22, 2.8);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.1,
      oscillatorType: 'sine',
      frequency: 220,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 55, time: time + 0.5 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.05 },
      ],
      destination: output,
    });

    // A major through three octaves: A2 A3 C#4 E4 A4 C#5 E5, each rank with
    // its own attack so the full organ "opens" rather than slams.
    for (const midi of [45, 57, 61, 64, 69, 73, 76]) {
      for (const [type, detune, gain] of [
        ['sawtooth', -7, 0.045],
        ['sawtooth', 7, 0.045],
        ['triangle', 0, 0.055],
      ] as const) {
        playOscillatorVoice({
          context: audio,
          time,
          stopTime: time + 5,
          oscillatorType: type,
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 800, time },
              { type: 'linearRamp', value: 3400, time: time + 1.6 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: gain, time: time + 0.5 },
            { type: 'set', value: gain, time: time + 3.4 },
            { type: 'linearRamp', value: 0, time: time + 5 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.5 }],
        });
      }
    }
    [93, 88, 85, 81, 76, 73, 69].forEach((midi, index) => {
      const at = time + index * 0.18;
      playOscillatorVoice({
        context: audio,
        time: at,
        stopTime: at + 2.2,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 5200 },
        gainAutomation: [
          { type: 'set', value: 0.085 - index * 0.005, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 2.1 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }],
      });
    });
    voices.noiseHit(time, 0.16, 0.7, 'highpass', 6000, output);
  }

  // ---- event wiring ---------------------------------------------------------

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === coreId) return; // the rose tutti handles the killing blow
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    const layers: Array<[SectionIndex, number]> = sectionMix.from === sectionMix.to
      ? [[sectionMix.to, 1]]
      : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
    for (const [section, weight] of layers) {
      if (weight < 0.02) continue;
      const voice = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: voice.oscillator,
        cutoff: voice.cutoff,
        gainValue: voice.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.3 }],
      });
    }
    // The chiff: the pipe's attack transient — a lock is a key pressed.
    voices.noiseHit(time, 0.045, 0.03, 'bandpass', 2600 + lockCount * 300, output);
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const fromFire = SECTION_VOICES[sectionMix.from].fire;
    const toFire = SECTION_VOICES[sectionMix.to].fire;
    const fire = {
      cutoff: lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t),
      noise: lerp(fromFire.noise, toFire.noise, sectionMix.t),
    };
    // The shot tongues a note rooted on the live chord, three octaves above
    // the bass and falling an octave — the gun retunes with the harmony.
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff: fire.cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.06 }],
      destination: output,
    });
    voices.noiseHit(time, fire.noise, 0.025, 'highpass', 3000, output);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      coreChip(1 - hitPointsRemaining / coreMaxHp);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    for (let i = 0; i < 3; i += 1) {
      const at = time + THIRTYSECOND * i;
      chipVoice.play({
        context: ctx,
        time: at,
        midi: arp[i] + 12,
        vel: 0.08 - i * 0.01,
        destination: output,
        sends: [{ destination: delaySend, gain: 0.35 }],
      });
    }
    voices.noiseHit(time, 0.03, 0.03, 'highpass', 5600, output);
  });

  // A clean volley of four or more earns a flourish: the chord stabbed on the
  // next beat under a bright shimmer — the organ applauds the player.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.6,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2200 },
        gainAutomation: [
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    }
    voices.noiseHit(time, 0.08, 0.3, 'highpass', 6800, mix.duck);
  });

  // A rejected release: a dry dissonant groan — the organ refuses the offering.
  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    rejectVoice.play({ context: ctx, time, midi: 38, vel: 0.16, destination: output });
    rejectVoice.play({ context: ctx, time: time + 0.03, midi: 41, vel: 0.12, destination: output });
    voices.noiseHit(time, 0.1, 0.12, 'bandpass', 700, output);
  });

  // Hull hit: a low organ blast — a pipe bursting — under a noise thump.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    blastVoice.play({ context: ctx, time, midi: 40, vel: 0.4, destination: output });
    voices.noiseHit(time, 0.2, 0.16, 'bandpass', 900, output);
  });

  // The Devourer stirs: a wind riser and a low two-note summons.
  bus.on('spawn', ({ kind, enemyId }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (kind !== 'core' || !ctx || !output || !mix?.delaySend) return;
    const audio = ctx;
    const delaySend = mix.delaySend;
    coreId = enemyId;
    const time = score.nextGridTime(ctx.currentTime);
    riser(time, 1.8);
    [40, 47].forEach((midi, index) => {
      const at = time + index * 0.4;
      playOscillatorVoice({
        context: audio,
        time: at,
        stopTime: at + 0.8,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 900 },
        gainAutomation: [
          { type: 'set', value: 0.09, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.75 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.5 }],
      });
    });
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'destroyed' || !ctx) return;
    coreKilled = true;
    roseTutti();
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    missTone.play({ context: ctx, time, midi: 45, vel: 0.06, destination: output });
  });

  return runtime;
}
