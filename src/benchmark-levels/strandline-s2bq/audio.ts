import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createStrandlineVoices, type StrandlineKillVoice } from './audio-voices';
import { STRANDLINE_BARS, STRANDLINE_BPM, STRANDLINE_DURATION, STRANDLINE_SCORE_SECTIONS, STRANDLINE_STEPS_PER_BAR, STRANDLINE_TIME } from './timing';

// Strandline's score is the jellyfish waking up: it starts as little more
// than a pulse and a pad in D dorian, gains a layer with every stretch of
// cleaned water, darkens under the Matriarch, and resolves — the moment she
// is gone — into an unclouded D major drift. Player actions are notes inside
// that: locks climb a pentatonic, kills walk hidden per-section melody lanes
// pitched from the live chord, and the Matriarch's chips ring an escalating
// gong that ratchets the fight toward the tear-loose finale.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR;
const LANE_STEPS = 32; // two bars: one full chord

// D dorian, warm and suspended — sunlight through water.
const CHORDS = [
  { bass: 26, pad: [50, 53, 57, 60], arp: [62, 65, 69, 72] }, // Dm9
  { bass: 29, pad: [53, 57, 60, 64], arp: [65, 69, 72, 76] }, // Fmaj7
  { bass: 31, pad: [55, 58, 62, 65], arp: [67, 70, 74, 77] }, // Gm7
  { bass: 33, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] }, // Am7
];
type Chord = typeof CHORDS[number];

// The freed animal: bars 22+ swap the whole harmony to an open D major glow.
const SERENE_CHORDS = [
  { bass: 26, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74] }, // Dadd9
  { bass: 26, pad: [50, 55, 59, 62], arp: [62, 67, 71, 74] }, // Gmaj/D
];

const LOCK_SCALE = [62, 65, 67, 69, 72, 74, 77, 79]; // D minor pentatonic, rising per lock

// Kill-melody lanes: degrees 0–7 into the live lead set (arp + octave), one
// 32-step contour per section, so a chained volley plays a real phrase.
type SectionIndex = 0 | 1 | 2 | 3 | 4;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Drift — a slow arch that barely lifts off the water.
  0: [
    0, 1, 2, 3, 2, 3, 4, 3,
    4, 5, 4, 3, 2, 3, 2, 1,
    2, 3, 4, 5, 4, 5, 6, 5,
    4, 3, 4, 5, 6, 7, 6, 4,
  ],
  // Bloom — rising waves, each cresting a little higher.
  1: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 6, 5, 7, 6, 4, 5, 3,
    4, 2, 3, 1, 2, 4, 3, 5,
    4, 6, 5, 7, 6, 7, 5, 4,
  ],
  // Deep — syncopated octave zig-zags; dense volleys ring as broken chords.
  2: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 1, 5, 2, 6, 3, 7,
    7, 6, 5, 4, 3, 2, 1, 0,
  ],
  // Crown — high descending peals answered by a climb, so brood kills toll.
  3: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
  // Serene — wide unhurried arpeggios drifting upward.
  4: [
    0, 2, 4, 7, 4, 2, 0, 2,
    4, 7, 4, 2, 0, 2, 4, 7,
    2, 4, 7, 4, 2, 0, 2, 4,
    7, 4, 2, 4, 7, 6, 4, 2,
  ],
};

// Per-section voicing for the player's instruments. Gains are tuned for
// perceived loudness — saw/square speak far louder than sine at equal gain.
const SECTION_VOICES: Record<SectionIndex, {
  kill: StrandlineKillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 3000, gain: 0.17, shimmer: 0.3 },
    lock: { oscillator: 'triangle', cutoff: 2400, gain: 0.13 },
    fire: { cutoff: 1600, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'triangle', decay: 0.38, cutoff: 3200, gain: 0.16, shimmer: 0.45 },
    lock: { oscillator: 'triangle', cutoff: 2800, gain: 0.12 },
    fire: { cutoff: 2200, noise: 0.04 },
  },
  2: {
    kill: { oscillator: 'square', decay: 0.26, cutoff: 2500, gain: 0.14, shimmer: 0.55 },
    lock: { oscillator: 'square', cutoff: 2000, gain: 0.055 },
    fire: { cutoff: 3000, noise: 0.05 },
  },
  3: {
    kill: { oscillator: 'sawtooth', decay: 0.4, cutoff: 2600, gain: 0.15, shimmer: 0.6 },
    lock: { oscillator: 'sawtooth', cutoff: 2100, gain: 0.05 },
    fire: { cutoff: 3600, noise: 0.06 },
  },
  4: {
    kill: { oscillator: 'sine', decay: 0.7, cutoff: 3600, gain: 0.18, shimmer: 0.8 },
    lock: { oscillator: 'triangle', cutoff: 3000, gain: 0.12 },
    fire: { cutoff: 1800, noise: 0.03 },
  },
};

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-s2bq',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: STRANDLINE_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let matriarchId = -1;
  let matriarchMaxHp = 0;
  let broodsKilled = 0;
  const kindById = new Map<number, string>();

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: STRANDLINE_BARS.serene, chords: SERENE_CHORDS, barsPerChord: 1 }],
    sections: STRANDLINE_SCORE_SECTIONS,
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
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.36, dampHz: 2100 },
      reverb: { seconds: 2.6, decay: 2.4, level: 0.22 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      matriarchId = -1;
      matriarchMaxHp = 0;
      broodsKilled = 0;
      kindById.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      // The animal's afterglow: one warm chord as the summary comes up.
      if (context) pad(context.currentTime + 0.05, [50, 54, 57, 62, 66], 5, 1);
    },
    onDispose() {
      ctx = null;
    },
  });

  // ---- voices ---------------------------------------------------------------

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { pulse, plink, tick, bass, pad, arp, droplet, drone, swell, shimmerFall, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  const killLayerVoice = voice<{ killVoice: StrandlineKillVoice }>({
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

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.4 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.12,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 170 },
    envelope: { decay: 0.12 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.08 }],
    duration: 0.1,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.1 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.15,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3800 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  // The reject is the level's one sour sound: a muffled, bent throb — the
  // parasites' violet, in audio.
  const rejectVoice = voice<{ vel: number; filterStart: number; filterEnd: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.26,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 6,
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
    duration: 0.45,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 30, time: time + 0.3 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.44, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
    ],
  });

  const impactStabVoice = voice({
    oscillators: [{ type: 'square' }],
    duration: 0.26,
    stopPadding: 0.04,
    gainAutomation: (time) => [
      { type: 'set', value: 0.06, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  // ---- arrangement ----------------------------------------------------------

  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const padOdd = blankBar + 'P...............';
  const heartPulse = 'P.......p.......';
  const deepPulse = 'P.....p.P.......';
  const crownPulse = 'P.......P.....p.';
  const serenePulse = 'P...............';
  const plinkBack = '....M.......M...';
  const softTicks = '..t...t...t...t.';
  const flowTicks = 't.t.t.t.T.t.t.t.';
  const bassCalm = 'B..............b';
  const bassWalk = 'B.....b....b....';
  const bassDeep = 'B..b....B..b..u.';
  const arpEven = 'A...A...A...A...';
  const arpDense = 'A.A.A.A.A.A.A.A.';
  const driftDrops = '....D......D....' + '..D.........D...';

  function padTrack(fromBar: number, brightness: number) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) =>
      pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05, brightness));
  }

  function pulseTrack(pattern: string) {
    return hits(pattern, { P: 1, p: 0.7 }, ({ time }, vel) => pulse(time, vel));
  }

  function plinkTrack() {
    return hits<Chord>(plinkBack, { M: 1 }, ({ time, chord }) => plink(time, chord.arp[2] + 12, 1));
  }

  function tickTrack(pattern: string) {
    return hits(pattern, { t: 0.04, T: 0.085 }, ({ time }, vel, symbol) => tick(time, vel, symbol === 'T' ? 0.12 : 0.03));
  }

  function bassTrack(pattern: string) {
    return hits<Chord>(pattern, { B: 1, b: 0.7, u: 0.7 }, ({ time, chord }, vel, symbol) => {
      bass(time, chord.bass + (symbol === 'u' ? 12 : 0) + 12, vel);
    });
  }

  function arpTrack(pattern: string, vel: number) {
    return hits<Chord>(pattern, { A: vel }, ({ time, step, chord }, velocity) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      arp(time, chord.arp[order[(step / 2) % order.length]] - 12, velocity);
    });
  }

  function dropletTrack(pattern: string, vel: number) {
    return hits<Chord>(pattern, { D: vel }, ({ time, step, chord }, velocity) => {
      droplet(time, chord.arp[(step / 3) % chord.arp.length] + 12, velocity);
    });
  }

  // Crown brightness rides the fight itself: every brood killed lets more
  // light through — the arps and droplets literally return with the strands.
  function crownLightTrack() {
    return fn<Chord>(({ time, step, chord }) => {
      if (broodsKilled <= 0) return;
      if (step % 4 === 2 && broodsKilled >= 2) {
        const order = [0, 2, 1, 3];
        arp(time, chord.arp[order[(step / 4) % 4]] - 12, 0.14 + broodsKilled * 0.05);
      }
      if (step % 8 === 5 && broodsKilled >= 4) {
        droplet(time, chord.arp[(step / 8) % chord.arp.length] + 12, 0.5 + broodsKilled * 0.08);
      }
    });
  }

  function droneTrack() {
    return fn<Chord>(({ time, step, barInSection, chord }) => {
      if (step === 0 && barInSection % 2 === 0) drone(time, chord.bass + 12, 16 * 2 * SIXTEENTH, 1);
    });
  }

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0, 0.4),
        hits<Chord>('........D.......' + '..............D.', { D: 0.6 }, ({ time, step, chord }, vel) =>
          droplet(time, chord.arp[step % chord.arp.length] + 12, vel)),
        hits<Chord>('A...............' + '........A.......', { A: 0.4 }, ({ time, step, chord }, vel) =>
          arp(time, chord.arp[(step / 4) % chord.arp.length] - 12, vel)),
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
        name: 'drift',
        fromBar: STRANDLINE_BARS.drift,
        toBar: STRANDLINE_BARS.bloom,
        tracks: [padTrack(0, 0.25), pulseTrack(heartPulse), bassTrack(bassCalm), dropletTrack(driftDrops, 0.6)],
      },
      {
        name: 'bloom',
        fromBar: STRANDLINE_BARS.bloom,
        toBar: STRANDLINE_BARS.reveal,
        tracks: [padTrack(STRANDLINE_BARS.bloom, 0.45), pulseTrack(heartPulse), plinkTrack(), tickTrack(softTicks), bassTrack(bassWalk), arpTrack(arpEven, 0.32), dropletTrack(driftDrops, 0.5)],
      },
      {
        // The bell fills the view: the water itself swells, the pad opens.
        name: 'reveal',
        fromBar: STRANDLINE_BARS.reveal,
        toBar: STRANDLINE_BARS.deep,
        tracks: [
          padTrack(STRANDLINE_BARS.reveal, 0.85),
          pulseTrack(heartPulse),
          bassTrack(bassCalm),
          arpTrack(arpEven, 0.4),
          oneShot(0, 0, ({ time }) => swell(time, STRANDLINE_TIME.bar(1.5), 1)),
          oneShot(0, 0, ({ time, chord }) => droplet(time + SIXTEENTH * 2, chord.arp[3] + 12, 1)),
        ],
      },
      {
        name: 'deep',
        fromBar: STRANDLINE_BARS.deep,
        toBar: STRANDLINE_BARS.crown,
        tracks: [padTrack(STRANDLINE_BARS.deep, 0.6), pulseTrack(deepPulse), plinkTrack(), tickTrack(flowTicks), bassTrack(bassDeep), arpTrack(arpDense, 0.42)],
      },
      {
        // The Matriarch: the pad thins, the undertow arrives, and the light
        // layers only come back as her broods die.
        name: 'crown',
        fromBar: STRANDLINE_BARS.crown,
        toBar: STRANDLINE_BARS.serene,
        tracks: [
          droneTrack(),
          pulseTrack(crownPulse),
          plinkTrack(),
          tickTrack(softTicks),
          bassTrack(bassDeep),
          crownLightTrack(),
          oneShot(0, 0, ({ time }) => swell(time, STRANDLINE_TIME.bar(0.9), 0.7)),
        ],
      },
      {
        name: 'serene',
        fromBar: STRANDLINE_BARS.serene,
        tracks: [
          padTrack(STRANDLINE_BARS.serene, 1),
          pulseTrack(serenePulse),
          dropletTrack(driftDrops, 0.85),
          hits<Chord>('A.......A.......', { A: 0.35 }, ({ time, step, chord }, vel) =>
            arp(time, chord.arp[(step / 8) % chord.arp.length], vel)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments ---------------------------------------------

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

    const layers: Array<[StrandlineKillVoice, number]> = sectionMix.from === sectionMix.to
      ? [[toVoice, 1]]
      : [[fromVoice, 1 - sectionMix.t], [toVoice, sectionMix.t]];
    for (const [killVoice, weight] of layers) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice,
        velocity: vel,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: [{ destination: audioMix.delaySend, gain: 0.55 }] });
    }
    noiseHit(time, 0.05 * shimmer + 0.02, 0.09, 'highpass', 5400, output);
  }

  // Chipping the Matriarch rings a deep gong where everything else in the
  // level rings high; it grows with damage dealt, and a beacon note climbs
  // the lead set with it — the fight audibly ratchets toward the tear.
  function matriarchChip(intensity: number) {
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
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: rootFreq * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + 0.18 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
      ],
      destination: output,
    });
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.26,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1900 + 2600 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.04 + 0.022 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.3 }],
      });
    }
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.6,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.06 + 0.08 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
      ],
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
    });
    noiseHit(time, 0.1 + 0.08 * intensity, 0.07, 'bandpass', 1200, output);
  }

  // The killing blow: the music holds its breath, a sub drop lands on D, and
  // a rising major peal blooms through the wash — the animal lighting up.
  function matriarchFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.duck) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);

    audioMix.duckAt(time, 0.16, 2.2);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.1,
      oscillatorType: 'sine',
      frequency: 196,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 36.7, time: time + 0.5 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.0 },
      ],
      destination: output,
    });
    // D major stacked through three octaves, opening slowly — clean water.
    for (const midi of [38, 50, 57, 62, 66]) {
      for (const detune of [-5, 5]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.8,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 520, time },
              { type: 'linearRamp', value: 2400, time: time + 1.1 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.045, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.7 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }],
        });
      }
    }
    // A rising peal, note by note up the freed harmony, ringing out.
    [62, 66, 69, 74, 78, 81, 86].forEach((midi, index) => {
      if (!ctx || !output) return;
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.6,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 4200 },
        gainAutomation: [
          { type: 'set', value: 0.12 - index * 0.007, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.55 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.6 }],
      });
    });
    noiseHit(time, 0.12, 0.7, 'highpass', 5600, output);
  }

  // ---- event wiring ---------------------------------------------------------

  bus.on('spawn', ({ enemyId, kind }) => {
    kindById.set(enemyId, kind);
    if (kind !== 'matriarch') return;
    matriarchId = enemyId;
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend) return;
    // Her arrival: a low two-note call under a gathering swell.
    const time = score.nextGridTime(ctx.currentTime);
    swell(time, 1.6, 0.9);
    [38, 44].forEach((midi, index) => {
      if (!ctx || !mix.duck || !mix.delaySend) return;
      const at = time + index * 0.46;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.7,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 900 },
        gainAutomation: [
          { type: 'set', value: 0.17, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.65 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.4 }],
      });
    });
  });

  bus.on('bossphase', ({ phase }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend) return;
    if (phase === 'exposed') {
      // Bare: a bright rising answer to her dark two-note call.
      const time = score.nextGridTime(ctx.currentTime);
      [69, 74, 78].forEach((midi, index) => {
        if (!ctx || !mix.duck || !mix.delaySend) return;
        const at = time + index * SIXTEENTH * 2;
        playOscillatorVoice({
          context: ctx,
          time: at,
          stopTime: at + 0.5,
          oscillatorType: 'triangle',
          frequency: midiToFreq(midi),
          filter: { type: 'lowpass', frequency: 3600 },
          gainAutomation: [
            { type: 'set', value: 0.13, time: at },
            { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
          ],
          destination: mix.duck,
          sends: [{ destination: mix.delaySend, gain: 0.55 }],
        });
      });
    }
  });

  // Kills walk the hidden lane; broods add the webbing-recede fall; the
  // Matriarch's death is the finale.
  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === matriarchId) {
      matriarchFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    if (kindById.get(enemyId) === 'brood') {
      broodsKilled += 1;
      shimmerFall(kill.time + THIRTYSECOND * 2, kill.midi);
    }
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
      const sectionVoice = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: sectionVoice.oscillator,
        cutoff: sectionVoice.cutoff,
        gainValue: sectionVoice.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    }
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
    // A pressed pulse of water: pitched from the chord root, falling an octave.
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff: fire.cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.08 }],
      destination: output,
    });
    noiseHit(time, fire.noise, 0.03, 'bandpass', 1900, output);
  });

  // Non-lethal hits: cracking a cyst climbs the chord; chipping the Matriarch
  // rings the gong instead.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    if (enemyId === matriarchId) {
      matriarchMaxHp = Math.max(matriarchMaxHp, hitPointsRemaining + 1);
      matriarchChip(1 - hitPointsRemaining / matriarchMaxHp);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chordArp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.08], [1, 0.065], [2, 0.05]] as const).forEach(([index, vel]) => {
      if (!ctx || !output) return;
      const at = time + THIRTYSECOND * index;
      chipVoice.play({ context: ctx, time: at, midi: chordArp[index] + 12, vel, destination: output, sends: [{ destination: delaySend, gain: 0.4 }] });
    });
    noiseHit(time, 0.03, 0.04, 'highpass', 5200, output);
  });

  // Four or more clean kills in one volley: the water applauds — the chord
  // swirls up on the next beat.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    chord.pad.forEach((midi, index) => {
      if (!ctx || !mix.duck || !mix.delaySend) return;
      const at = time + index * THIRTYSECOND;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.55,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2600 },
        gainAutomation: [
          { type: 'set', value: 0.07, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.5 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    });
    noiseHit(time, 0.07, 0.35, 'highpass', 6200, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [start, end, at, vel] of [
      [311, 88, time, 0.17],
      [220, 58, time + 0.03, 0.12],
    ] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.22 }],
        vel,
        filterStart: 950,
        filterEnd: 380,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.1, 'bandpass', 640, output);
    noiseHit(time + 0.03, 0.06, 0.14, 'highpass', 2200, output);
  });

  // Hull hit: a low pressure boom under a deliberately out-of-key sting.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    impactBoomVoice.play({ context: ctx, time, frequency: 88, destination: output });
    for (const midi of [63, 69]) {
      impactStabVoice.play({ context: ctx, time, midi, destination: output });
    }
    noiseHit(time, 0.18, 0.16, 'bandpass', 780, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.16,
      oscillatorType: 'sine',
      frequency: 150,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 74, time: time + 0.13 }],
      gainAutomation: [
        { type: 'set', value: 0.045, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
      ],
      destination: output,
    });
  });

  return runtime;
}
