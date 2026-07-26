import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createTinkerVoices, type TinkerKillVoice } from './audio-voices';
import { TINKER_BARS, TINKER_BPM, TINKER_SCORE_SECTIONS, TINKER_STEPS_PER_BAR, TINKER_TIME } from './timing';

// Bright, eccentric workshop pop in C major: bell mallets and tick-tock
// woodblocks over a bouncy octave bass, clipped reed-organ stabs on the
// offbeats, handclaps on 2 and 4. The player's gun is the lead instrument —
// kills read a hidden two-bar melody lane so a chained volley performs a
// music-box run, and every pitched action follows the live chord. The spill
// flips the progression to the relative minor until the heart cracks, then
// the coast resolves everything back to C.

const SIXTEENTH = TINKER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = TINKER_STEPS_PER_BAR;
const LANE_STEPS = 32; // two bars: one full chord

type Chord = { bass: number; pad: number[]; arp: number[] };

// Main lap: C – Am – F – G, two bars each, add9 pads for the toy-bright top.
const MAIN_CHORDS: Chord[] = [
  { bass: 36, pad: [60, 64, 67, 74], arp: [72, 76, 79, 84] }, // C add9
  { bass: 33, pad: [57, 60, 64, 72], arp: [69, 72, 76, 81] }, // Am7
  { bass: 29, pad: [53, 57, 60, 69], arp: [65, 69, 72, 77] }, // F add9
  { bass: 31, pad: [55, 59, 62, 71], arp: [67, 71, 74, 79] }, // G add9
];

// The spill: the same key turned over — Am, F, Dm, then G7 pulling hard back
// to C for the coast across the clean patch.
const SPILL_CHORDS: Chord[] = [
  { bass: 33, pad: [57, 60, 64, 72], arp: [69, 72, 76, 81] }, // Am7
  { bass: 29, pad: [53, 57, 60, 69], arp: [65, 69, 72, 77] }, // Fmaj7
  { bass: 38, pad: [62, 65, 69, 72], arp: [62, 65, 69, 74] }, // Dm7
  { bass: 31, pad: [55, 59, 62, 65], arp: [67, 71, 74, 77] }, // G7
];

const COAST_CHORD: Chord[] = [{ bass: 36, pad: [60, 64, 67, 74], arp: [72, 76, 79, 84] }];

const LOCK_SCALE = [72, 74, 76, 79, 81, 84, 86, 88]; // C major pentatonic, rising per lock

// Kill-melody lanes: degrees 0–7 into the live lead set (arp plus an octave
// up), 32 steps over the two-bar chord. Kills unmute the lane step by step,
// so a chained volley plays a real melodic fragment.
type SectionIndex = 0 | 1 | 2;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Marble — a music box winding up: gentle skipping arches.
  0: [
    0, 1, 2, 3, 2, 3, 4, 3,
    4, 5, 4, 3, 2, 3, 2, 1,
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 6, 5, 7, 6, 5, 4, 2,
  ],
  // Tennis ball — bouncier: octave zig-zags like a ball off the table.
  1: [
    0, 4, 2, 5, 1, 5, 3, 6,
    2, 6, 4, 7, 3, 7, 5, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    7, 5, 6, 4, 5, 3, 4, 2,
  ],
  // The spill — falling peals answered by a climb, so shell chips toll.
  2: [
    7, 5, 6, 4, 5, 3, 4, 2,
    3, 1, 2, 0, 1, 2, 3, 4,
    7, 6, 5, 4, 5, 4, 3, 2,
    3, 4, 5, 6, 7, 6, 7, 6,
  ],
};

// Per-act voicing for the player's instruments. Gains are tuned by perceived
// loudness: squares and saws speak much louder than sines at equal gain.
const SECTION_VOICES: Record<SectionIndex, {
  kill: TinkerKillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 4200, gain: 0.18, shimmer: 0.4 },
    lock: { oscillator: 'triangle', cutoff: 3000, gain: 0.13 },
    fire: { cutoff: 2100, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.26, cutoff: 2800, gain: 0.12, shimmer: 0.55 },
    lock: { oscillator: 'square', cutoff: 2200, gain: 0.055 },
    fire: { cutoff: 3400, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.45, cutoff: 3200, gain: 0.14, shimmer: 0.7 },
    lock: { oscillator: 'sawtooth', cutoff: 2400, gain: 0.05 },
    fire: { cutoff: 4400, noise: 0.07 },
  },
};

export function createAudio(bus: EventBus) {
  return createTinkerAudio(bus).audio;
}

export const traceTinkerAudio = createAudioTraceHarness({
  level: 'tinker-ball-6fh9',
  bpm: TINKER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 62,
  createAudio: createTinkerAudio,
});

function createTinkerAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let heartId = -1;
  let spillSeen = false;
  const spillIds = new Set<number>();
  const shellMaxHp = new Map<number, number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: TINKER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: MAIN_CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: TINKER_BARS.spill, toBar: TINKER_BARS.coast, chords: SPILL_CHORDS, barsPerChord: 2 },
      { fromBar: TINKER_BARS.coast, chords: COAST_CHORD, barsPerChord: 2 },
    ],
    sections: TINKER_SCORE_SECTIONS,
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
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 3000 },
      reverb: { seconds: 1.6, decay: 2.2, level: 0.13 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      heartId = -1;
      spillSeen = false;
      spillIds.clear();
      shellMaxHp.clear();
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, [60, 64, 67, 72], 4.5);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createTinkerVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, clap, shaker, tick, bell, organ, bass, pad, riser, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- the player's voices ------------------------------------------------

  const killLayerVoice = voice<{ killVoice: TinkerKillVoice }>({
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
    oscillators: [{ type: 'sine', octave: 1, gain: 0.38 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.09,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 200 },
    envelope: { decay: 0.09 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'triangle', gain: 0.16 }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.09 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.13,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 4400 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  const rejectVoice = voice<{ vel: number; filterStart: number; filterEnd: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.26,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 4,
      frequencyAutomation: (time, { filterStart, filterEnd }) => [
        { type: 'set', value: filterStart, time },
        { type: 'exponentialRamp', value: filterEnd, time: time + 0.2 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  const impactBoomVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.38,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 36, time: time + 0.26 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.4, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.38 },
    ],
  });

  const impactStabVoice = voice({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    gainAutomation: (time) => [
      { type: 'set', value: 0.06, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const spitVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.12,
    stopPadding: 0.02,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.45, time: time + 0.1 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.07, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  // ---- arrangement --------------------------------------------------------

  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const padOdd = blankBar + 'P...............';
  const kickHalf = 'K.......k.......';
  const kickFour = 'K...K...K...K...';
  const kickFill = 'K...K...K..kK.k.';
  const clapBackbeat = '....C.......C...';
  const tickTock = 'T.o.t.o.T.o.t.o.';
  const shaker8 = 'S.s.S.s.S.s.S.s.';
  const shaker16 = 'SsssSsssSsssSsss';
  const organSkank = '..O...O...O...O.';
  const organPush = '..O...O...O..OO.';
  const organDark = 'O.....O.O.....O.';
  const bassSimple = 'B.......u.......';
  const bassBounce = 'B.u.b.u.B.u.b.u.';
  const bassDrive = 'B.u.B.u.B.u.B.u.';
  const bellEven = 'A.A.A.A.A.A.A.A.';
  const bellSparse = 'A...A...A...A...';

  function padTrack(fromBar: number) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) =>
      pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05));
  }

  function kickTrack(pattern: string) {
    return hits(pattern, { K: 1, k: 0.85 }, ({ time }, vel) => kick(time, vel));
  }

  function clapTrack() {
    return hits(clapBackbeat, { C: 1 }, ({ time }) => clap(time));
  }

  function tickTrack(velScale = 1) {
    return hits(tickTock, { T: 1, t: 0.7, o: 0.85 }, ({ time }, vel, symbol) =>
      tick(time, symbol === 'o' ? 84 : 91, vel * velScale));
  }

  function shakerTrack(pattern: string) {
    return hits(pattern, { S: 0.075, s: 0.035 }, ({ time }, vel) => shaker(time, vel, 0.035));
  }

  function organTrack(pattern: string, vel: number) {
    return hits<Chord>(pattern, { O: vel }, ({ time, chord }, velocity) => organ(time, chord.pad.slice(0, 3), velocity));
  }

  function bassTrack(pattern: string, velScale = 1) {
    return hits<Chord>(pattern, { B: 1, b: 0.8, u: 0.72 }, ({ time, chord }, vel, symbol) =>
      bass(time, chord.bass + (symbol === 'u' ? 12 : 0), vel * velScale));
  }

  // Backing bells sit an octave below the player's kill melody so the lead
  // register stays free for the soloist.
  function bellTrack(pattern: string, vel: number) {
    return hits<Chord>(pattern, { A: vel }, ({ time, step, chord }, velocity) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      bell(time, chord.arp[order[(step / 2) % order.length]] - 12, velocity);
    });
  }

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0),
        hits<Chord>(bellSparse, { A: 0.45 }, ({ time, step, chord }, vel) => bell(time, chord.arp[(step / 4) % chord.arp.length], vel)),
        hits(tickTock, { T: 0.5, t: 0.32, o: 0.4 }, ({ time }, vel, symbol) => tick(time, symbol === 'o' ? 84 : 91, vel)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'marble', fromBar: TINKER_BARS.marble, toBar: TINKER_BARS.claps,
        tracks: [padTrack(TINKER_BARS.marble), kickTrack(kickHalf), tickTrack(), bassTrack(bassSimple), bellTrack(bellSparse, 0.5)],
      },
      {
        name: 'claps', fromBar: TINKER_BARS.claps, toBar: TINKER_BARS.tennis,
        tracks: [padTrack(TINKER_BARS.claps), kickTrack(kickHalf), clapTrack(), tickTrack(), bassTrack(bassBounce), bellTrack(bellEven, 0.42)],
      },
      {
        name: 'tennis', fromBar: TINKER_BARS.tennis, toBar: TINKER_BARS.organ,
        tracks: [padTrack(TINKER_BARS.tennis), kickTrack(kickFour), clapTrack(), shakerTrack(shaker8), organTrack(organSkank, 1), bassTrack(bassBounce), bellTrack(bellSparse, 0.45)],
      },
      {
        name: 'organ', fromBar: TINKER_BARS.organ, toBar: TINKER_BARS.clutter,
        tracks: [padTrack(TINKER_BARS.organ), kickTrack(kickFour), clapTrack(), shakerTrack(shaker8), organTrack(organPush, 1.1), bassTrack(bassBounce), bellTrack(bellEven, 0.5), tickTrack(0.7)],
      },
      {
        name: 'clutter', fromBar: TINKER_BARS.clutter, toBar: TINKER_BARS.preSpill,
        tracks: [padTrack(TINKER_BARS.clutter), kickTrack(kickFill), clapTrack(), shakerTrack(shaker16), organTrack(organPush, 1.15), bassTrack(bassDrive), bellTrack(bellEven, 0.5)],
      },
      {
        name: 'pre-spill', fromBar: TINKER_BARS.preSpill, toBar: TINKER_BARS.spill,
        tracks: [padTrack(TINKER_BARS.preSpill), kickTrack(kickFour), clapTrack(), shakerTrack(shaker16), bassTrack(bassDrive), oneShot(0, 0, ({ time }) => riser(time, STEPS_PER_BAR * 2 * SIXTEENTH))],
      },
      {
        name: 'spill', fromBar: TINKER_BARS.spill, toBar: TINKER_BARS.coast,
        tracks: [padTrack(TINKER_BARS.spill), kickTrack(kickFour), clapTrack(), shakerTrack(shaker16), organTrack(organDark, 1.3), bassTrack(bassDrive, 1.1), tickTrack(0.6)],
      },
      {
        name: 'coast', fromBar: TINKER_BARS.coast,
        tracks: [
          padTrack(TINKER_BARS.coast),
          bellTrack(bellSparse, 0.55),
          shakerTrack(shaker8),
          oneShot(0, 0, ({ time, chord }) => {
            organ(time, chord.pad, 0.9);
            for (const [index, midi] of chord.arp.entries()) bell(time + index * SIXTEENTH, midi, 0.5);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player actions in the score ---------------------------------------

  function sectionLayers(sectionMix: SectionMix<SectionIndex>): Array<[SectionIndex, number]> {
    return sectionMix.from === sectionMix.to
      ? [[sectionMix.to, 1]]
      : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
  }

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

    for (const [layerSection, weight] of sectionLayers(sectionMix)) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice: SECTION_VOICES[layerSection].kill,
        velocity: vel,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.45 }],
      });
    }
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: [{ destination: audioMix.delaySend, gain: 0.5 }] });
    }
    noiseHit(time, 0.045 * shimmer + 0.025, 0.07, 'highpass', 5600, output);
  }

  // Chipping a glue shell rings a jar clonk that grows heavier and brighter
  // with the damage dealt — the fight audibly ratchets toward the crack.
  function shellChip(intensity: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const rootFreq = midiToFreq(chord.bass + 12);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.42,
      oscillatorType: 'sine',
      frequency: rootFreq * 2.5,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.08 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.36 },
      ],
      destination: output,
    });
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.22,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2000 + 2800 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.04 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.3 }],
      });
    }
    noiseHit(time, 0.1 + 0.08 * intensity, 0.05, 'bandpass', 1200, output);
  }

  // The killing blow on the heart: the music holds its breath, a sub lands on
  // C, a bright major bloom opens, and a pentatonic peal rains down through
  // the delay — the rescue fanfare.
  function heartFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.duck) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);

    audioMix.duckAt(time, 0.2, 1.6);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.95,
      oscillatorType: 'sine',
      frequency: 200,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 49, time: time + 0.4 }],
      gainAutomation: [
        { type: 'set', value: 0.48, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
      ],
      destination: output,
    });
    for (const midi of [48, 60, 64, 67, 72]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.5,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 720, time },
              { type: 'linearRamp', value: 2800, time: time + 0.85 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.045, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.4 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }],
        });
      }
    }
    [96, 93, 91, 88, 84, 79, 76, 72].forEach((midi, index) => {
      if (!ctx) return;
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.5,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 4200 },
        gainAutomation: [
          { type: 'set', value: 0.13 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }],
      });
    });
    noiseHit(time, 0.13, 0.55, 'highpass', 6200, output);
  }

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind === 'spill-heart') {
      heartId = enemyId;
      spillIds.add(enemyId);
    }
    if (kind === 'bolt') {
      const output = sfxDestination();
      if (!ctx || !output) return;
      spitVoice.play({ context: ctx, time: ctx.currentTime, frequency: 560, destination: output });
      noiseHit(ctx.currentTime, 0.04, 0.05, 'bandpass', 900, output);
      return;
    }
    // The spill's entrance: the progression turns over with it, plus a dark
    // two-note alarm under a short riser.
    if (kind === 'spill-core') {
      spillIds.add(enemyId);
      if (spillSeen) return;
      spillSeen = true;
      score.overrideSection(2);
      const audioMix = runtime.mix();
      if (!ctx || !audioMix?.duck || !audioMix.delaySend) return;
      const time = score.nextGridTime(ctx.currentTime);
      riser(time, 1.6);
      [45, 51].forEach((midi, index) => {
        if (!ctx || !audioMix.duck || !audioMix.delaySend) return;
        const at = time + index * 0.4;
        playOscillatorVoice({
          context: ctx,
          time: at,
          stopTime: at + 0.55,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          filter: { type: 'lowpass', frequency: 1400 },
          gainAutomation: [
            { type: 'set', value: 0.15, time: at },
            { type: 'exponentialRamp', value: 0.001, time: at + 0.5 },
          ],
          destination: audioMix.duck,
          sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
        });
      });
    }
  });

  // Each kill takes at least the step after the previous one, so volley kills
  // never stack — they walk the lane note by note.
  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === heartId) {
      heartFinale();
      return;
    }
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
    for (const [layerSection, weight] of sectionLayers(sectionMix)) {
      if (weight < 0.02) continue;
      const lockSpec = SECTION_VOICES[layerSection].lock;
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
        sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    }
  });

  // Fire is a springy rubber-band pluck rooted on the live chord, so the gun
  // retunes as the progression moves.
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
      midi: root + 31,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.06 }],
      destination: output,
    });
    noiseHit(time, noise, 0.02, 'highpass', 3200, output);
  });

  // Non-lethal hits: shell chips on the spill ring the heavy jar; ordinary
  // multi-hit chips climb the chord.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    if (spillIds.has(enemyId)) {
      const maxHp = Math.max(shellMaxHp.get(enemyId) ?? 0, hitPointsRemaining + 1);
      shellMaxHp.set(enemyId, maxHp);
      shellChip(1 - hitPointsRemaining / maxHp);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.07], [1, 0.06], [2, 0.055]] as const).forEach(([index, vel]) => {
      if (!ctx) return;
      const at = time + THIRTYSECOND * index;
      chipVoice.play({ context: ctx, time: at, midi: arp[index] + 12, vel, destination: output, sends: [{ destination: delaySend, gain: 0.38 }] });
    });
    noiseHit(time, 0.03, 0.03, 'highpass', 5800, output);
  });

  // A clean full volley of four or more: the chord stabbed on the next beat
  // under a sparkle — the music applauds.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (kills < 4 || kills < size) return;
    if (!ctx || !mix?.duck || !mix.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.45,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2600 },
        gainAutomation: [
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.08, 0.28, 'highpass', 7000, mix.duck);
  });

  // Rejected release: a wet glue squelch — dissonant, dry, unmistakably not
  // a success sound.
  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [start, end, at, vel] of [
      [250, 68, time, 0.17],
      [186, 52, time + 0.03, 0.12],
    ] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.2 }],
        vel,
        filterStart: 900,
        filterEnd: 300,
        destination: output,
      });
    }
    noiseHit(time, 0.14, 0.1, 'bandpass', 520, output);
    noiseHit(time + 0.03, 0.06, 0.12, 'highpass', 2200, output);
  });

  // Glue on the hull: a low thud under a sticky dissonant cluster — the one
  // deliberately out-of-key sound in the level.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    impactBoomVoice.play({ context: ctx, time, frequency: 92, destination: output });
    for (const midi of [58, 63]) {
      impactStabVoice.play({ context: ctx, time, midi, destination: output });
    }
    noiseHit(time, 0.18, 0.13, 'bandpass', 800, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'sine',
      frequency: 138,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 66, time: time + 0.11 }],
      gainAutomation: [
        { type: 'set', value: 0.045, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: output,
    });
  });

  return runtime;
}
