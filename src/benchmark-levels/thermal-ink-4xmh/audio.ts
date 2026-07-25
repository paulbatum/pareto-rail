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
import { createThermalInkVoices } from './audio-voices';
import {
  THERMAL_INK_BARS,
  THERMAL_INK_BPM,
  THERMAL_INK_SCORE_SECTIONS,
  THERMAL_INK_STEPS_PER_BAR,
  THERMAL_INK_TIME,
  inkAtBar,
} from './timing';
import { vision } from './vision';

// A slow industrial pulse under one haunting melody, and a mix that answers the
// imager. Two rules run the whole score:
//
//   1. The player is the soloist. Kills read a hidden two-bar melody lane in the
//      TOP half of the lead set; the written melody keeps to the bottom half, so
//      a chained volley performs a line above the tune instead of fighting it.
//   2. Infrared is a mix move, not a filter. While the imager is up the grit bus
//      (metal, chain, noise) ducks away and the melody's filter opens, so the
//      arrangement audibly narrows to the one thing you can still see by.

const SIXTEENTH = THERMAL_INK_TIME.stepSeconds;
const STEPS_PER_BAR = THERMAL_INK_STEPS_PER_BAR;

// D natural minor, voiced low and wide. Bass sits in the harbour floor; `arp`
// is the lead set the player's gun and the tune both draw from.
const CHORDS = [
  { bass: 38, pad: [50, 57, 62, 65], arp: [62, 65, 69, 72] }, // Dm
  { bass: 34, pad: [46, 53, 58, 62], arp: [58, 62, 65, 70] }, // Bb
  { bass: 31, pad: [50, 55, 58, 62], arp: [58, 62, 67, 70] }, // Gm
  { bass: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72] }, // C
];
type Chord = typeof CHORDS[number];

// Lock climbs a D minor pentatonic; each extra lock is one rung higher.
const LOCK_SCALE = [62, 65, 69, 72, 74, 77, 81, 84];

type SectionIndex = 0 | 1 | 2;

// The kill lanes live in degrees 3–7 — the octave above the written melody.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Descent: a slow arch. Early sparse volleys pick a calm line out of it.
  0: [
    4, 5, 4, 3, 4, 5, 6, 5,
    4, 5, 6, 7, 6, 5, 4, 5,
    4, 3, 4, 5, 6, 5, 6, 7,
    6, 5, 4, 3, 4, 5, 6, 7,
  ],
  // Surge: broken-octave zig-zags, so a dense sweep rings out as a fast run.
  1: [
    4, 7, 5, 6, 4, 7, 5, 6,
    5, 7, 4, 6, 5, 7, 6, 4,
    6, 4, 7, 5, 6, 4, 7, 5,
    7, 5, 6, 4, 7, 6, 5, 4,
  ],
  // The core: descending peals answered by a climb — bells over a blackout.
  2: [
    7, 6, 5, 4, 7, 6, 5, 4,
    6, 5, 4, 3, 6, 5, 4, 3,
    7, 6, 7, 6, 5, 4, 5, 4,
    4, 5, 6, 7, 5, 6, 7, 7,
  ],
};

// Per-act player timbres. Gains are tuned by ear, not matched by number: the
// sawtooth in act three would bury the triangle in act one at equal values.
const SECTION_VOICES: Record<SectionIndex, {
  kill: { oscillator: OscillatorType; decay: number; cutoff: number; gain: number };
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'triangle', decay: 0.52, cutoff: 2100, gain: 0.19 },
    lock: { oscillator: 'sine', cutoff: 2400, gain: 0.15 },
    fire: { cutoff: 1500, noise: 0.05 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.34, cutoff: 2600, gain: 0.135 },
    lock: { oscillator: 'square', cutoff: 1900, gain: 0.055 },
    fire: { cutoff: 2500, noise: 0.07 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.58, cutoff: 3000, gain: 0.15 },
    lock: { oscillator: 'sawtooth', cutoff: 2100, gain: 0.05 },
    fire: { cutoff: 3400, noise: 0.09 },
  },
};

export function createAudio(bus: EventBus) {
  return createThermalInkAudio(bus).audio;
}

export const traceThermalInkAudio = createAudioTraceHarness({
  level: 'thermal-ink-4xmh',
  bpm: THERMAL_INK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createThermalInkAudio,
});

function createThermalInkAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let gritBus: GainNode | null = null;
  let coreId = -1;
  let coreMaxHp = 0;
  const armIds = new Set<number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: THERMAL_INK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: THERMAL_INK_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.82,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -17, ratio: 5.5, attack: 0.004, release: 0.26 },
      delay: { time: SIXTEENTH * 6, feedback: 0.38, dampHz: 1700 },
      reverb: { seconds: 2.6, decay: 2.4, level: 0.24 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      // The grit sub-bus exists so infrared has something to take away.
      gritBus = context.createGain();
      gritBus.gain.value = 1;
      gritBus.connect(mix.duck);
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      coreId = -1;
      coreMaxHp = 0;
      armIds.clear();
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (!context) return;
      // The harbour goes back to being a harbour.
      drone(context.currentTime + 0.05, [50, 57, 62, 69], 6, 0.05);
      sonar(context.currentTime + 0.35, 74, 0.5);
    },
    onDispose() {
      ctx = null;
      gritBus = null;
    },
  });

  const voices = createThermalInkVoices({
    trace,
    context: () => ctx,
    mix: runtime.mix,
    grit: () => gritBus,
  });
  const { kick, anvil, chain, bass, drone, lead, sonar, groan, riser, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // --- player instruments ---------------------------------------------------

  const killLayer = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; decay: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    filter: { type: 'lowpass', Q: 1.4, cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const killBody = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay * 0.8 },
  });

  const killShimmer = voice<{ decay: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.22 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.12,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 220 },
    envelope: { attack: 0.004, decay: 0.11 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.11 }, { type: 'sine', gain: 0.16, octave: -1 }],
    duration: 0.13,
    stopPadding: 0.03,
    filter: { type: 'lowpass', Q: 3, cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.12 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.9 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 3.2, cutoff: 2600 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.6 }, { type: 'sawtooth', gain: 0.4, detune: 22 }],
    duration: 0.28,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 2,
      frequencyAutomation: (time) => [
        { type: 'set', value: 900, time },
        { type: 'exponentialRamp', value: 220, time: time + 0.22 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });

  const hullVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.5,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 30, time: time + 0.34 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.46, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
    ],
  });

  // --- arrangement ----------------------------------------------------------

  const rest = '................';
  const kickSlow = 'K.......K.......';
  const kickWalk = 'K.......K...k...';
  const kickDrive = 'K...k...K...k.k.';
  const kickHeart = 'K.....K.........';
  const anvilBack = '....A.......A...';
  const anvilBusy = '....A.......A.a.';
  const anvilCrush = '..a.A...a...A.a.';
  const chainSlow = '..c.......c.....';
  const chainBusy = '..c...c...c...c.';
  const bassSlow = 'B......b..B.....';
  const bassBounce = 'B..b..B...b..B..';
  const bassDrive = 'B.BbB..b.BbB.Bb.';
  const droneEven = `D...............${rest}`;
  const droneOdd = `${rest}D...............`;

  // The tune. Degrees 0–3 only: the register above belongs to the player.
  const melodyA = '2.....1...0.......3.....2.......';
  const melodyB = '3.....2...1.......0.....2...3...';
  const melodyC = '3.......2.......1.......0.......';

  const ambient = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'harbour',
      fromBar: 0,
      tracks: [
        droneTrack(0, 0.045),
        oneShot(0, 0, ({ time, chord }) => sonar(time, chord.arp[2], 0.55)),
        oneShot(1, 8, ({ time, chord }) => sonar(time, chord.arp[0] + 12, 0.32)),
        hits(`${rest}..c.......c.....`, { c: 0.05 }, ({ time }, vel) => chain(time, vel)),
      ],
    }],
  });

  const run = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'descent',
        fromBar: THERMAL_INK_BARS.run,
        toBar: THERMAL_INK_BARS.pulse,
        tracks: [droneTrack(0, 0.05), kickTrack(kickSlow), oneShot(0, 0, ({ time, chord }) => sonar(time, chord.arp[3], 0.6))],
      },
      {
        name: 'pulse',
        fromBar: THERMAL_INK_BARS.pulse,
        toBar: THERMAL_INK_BARS.engage,
        tracks: [droneTrack(THERMAL_INK_BARS.pulse, 0.055), kickTrack(kickSlow), bassTrack(bassSlow), chainTrack(chainSlow)],
      },
      {
        name: 'engage',
        fromBar: THERMAL_INK_BARS.engage,
        toBar: THERMAL_INK_BARS.inkA,
        tracks: [
          droneTrack(THERMAL_INK_BARS.engage, 0.05), kickTrack(kickWalk), bassTrack(bassBounce),
          anvilTrack(anvilBack), chainTrack(chainSlow), melodyTrack(melodyA, 0.85),
        ],
      },
      // Inside the cloud the kit thins to a heartbeat and the tune carries it.
      {
        name: 'ink-a',
        fromBar: THERMAL_INK_BARS.inkA,
        toBar: THERMAL_INK_BARS.surge,
        tracks: [droneTrack(THERMAL_INK_BARS.inkA, 0.075), kickTrack(kickHeart), bassTrack(bassSlow), melodyTrack(melodyA, 1.0)],
      },
      {
        name: 'surge',
        fromBar: THERMAL_INK_BARS.surge,
        toBar: THERMAL_INK_BARS.gather,
        tracks: [
          droneTrack(THERMAL_INK_BARS.surge, 0.05), kickTrack(kickDrive), bassTrack(bassDrive),
          anvilTrack(anvilBusy), chainTrack(chainBusy), melodyTrack(melodyB, 0.8),
        ],
      },
      {
        name: 'gather',
        fromBar: THERMAL_INK_BARS.gather,
        toBar: THERMAL_INK_BARS.inkB,
        tracks: [
          droneTrack(THERMAL_INK_BARS.gather, 0.05), kickTrack(kickDrive), bassTrack(bassDrive),
          anvilTrack(anvilBusy), chainTrack(chainBusy), melodyTrack(melodyB, 0.85),
          oneShot(1, 8, ({ time }) => riser(time, SIXTEENTH * 8)),
        ],
      },
      {
        name: 'ink-b',
        fromBar: THERMAL_INK_BARS.inkB,
        toBar: THERMAL_INK_BARS.swarm,
        tracks: [droneTrack(THERMAL_INK_BARS.inkB, 0.08), kickTrack(kickHeart), bassTrack(bassBounce), melodyTrack(melodyB, 1.0)],
      },
      {
        name: 'swarm',
        fromBar: THERMAL_INK_BARS.swarm,
        toBar: THERMAL_INK_BARS.crush,
        tracks: [
          droneTrack(THERMAL_INK_BARS.swarm, 0.05), kickTrack(kickDrive), bassTrack(bassDrive),
          anvilTrack(anvilCrush), chainTrack(chainBusy), melodyTrack(melodyB, 0.9),
        ],
      },
      {
        name: 'crush',
        fromBar: THERMAL_INK_BARS.crush,
        toBar: THERMAL_INK_BARS.inkC,
        tracks: [
          droneTrack(THERMAL_INK_BARS.crush, 0.055), kickTrack(kickDrive), bassTrack(bassDrive),
          anvilTrack(anvilCrush), chainTrack(chainBusy), melodyTrack(melodyA, 0.95),
          oneShot(3, 0, ({ time }) => riser(time, SIXTEENTH * 16)),
          oneShot(3, 0, ({ time }) => groan(time, 90, 34, 0.2, 2.4)),
        ],
      },
      // The blackout: bass, heartbeat, and the melody alone in the dark.
      {
        name: 'ink-c',
        fromBar: THERMAL_INK_BARS.inkC,
        toBar: 23,
        tracks: [droneTrack(THERMAL_INK_BARS.inkC, 0.085), kickTrack(kickHeart), bassTrack(bassSlow), melodyTrack(melodyC, 1.0)],
      },
      {
        name: 'lamps-return',
        fromBar: 23,
        tracks: [droneTrack(23, 0.06), oneShot(0, 0, ({ time, chord }) => sonar(time, chord.arp[2], 0.5))],
      },
    ],
  });

  function droneTrack(fromBar: number, level: number) {
    return hits<Chord>(fromBar % 2 === 0 ? droneEven : droneOdd, { D: 1 }, ({ time, chord }) => {
      drone(time, chord.pad, STEPS_PER_BAR * 2 * SIXTEENTH * 1.04, level);
    });
  }

  function kickTrack(pattern: string) {
    return hits(pattern, { K: 1, k: 0.72 }, ({ time }, vel) => kick(time, vel));
  }

  function anvilTrack(pattern: string) {
    return hits(pattern, { A: 1, a: 0.55 }, ({ time }, vel, symbol) => anvil(time, vel, symbol === 'A' ? 0.42 : 0.2));
  }

  function chainTrack(pattern: string) {
    return hits(pattern, { c: 0.07 }, ({ time }, vel) => chain(time, vel));
  }

  function bassTrack(pattern: string) {
    return hits<Chord>(pattern, { B: 1, b: 0.7, f: 0.72 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'b' ? 12 : symbol === 'f' ? 7 : 0;
      bass(time, chord.bass + offset, vel);
    });
  }

  function melodyTrack(pattern: string, level: number) {
    const velocities: Record<string, number> = { '0': level, '1': level, '2': level, '3': level };
    return hits<Chord>(pattern, velocities, ({ time, chord, position }, vel, symbol) => {
      const degree = Number(symbol);
      const midi = chord.arp[degree] ?? chord.arp[0];
      lead(time, midi, vel * 0.9, leadCutoff(position), 1.15);
    });
  }

  /** The imager opens the melody's filter; the cloud closes it. */
  function leadCutoff(position: number) {
    const sight = vision();
    const bar = position / STEPS_PER_BAR;
    const cloud = trace ? inkAtBar(bar) : sight.ink;
    const imager = trace ? 0 : sight.thermal;
    return 620 + 520 * (1 - cloud) + 3800 * imager;
  }

  function scheduleStep(step: BeatLevelAudioStep) {
    applyImagerMix(step.time);
    if (step.mode === 'ambient') ambient.schedule(step.position, step.time);
    else run.schedule(step.position, step.time);
  }

  // Infrared as a mix move: the grit bus falls back so the melody stands alone.
  function applyImagerMix(time: number) {
    if (!gritBus) return;
    const sight = vision();
    const target = 1 - sight.thermal * 0.78 - Math.max(0, sight.ink - sight.thermal) * 0.3;
    gritBus.gain.setTargetAtTime(Math.max(0.06, target), time, 0.08);
  }

  // --- the player's part ----------------------------------------------------

  function killNote(time: number, midi: number, mix: SectionMix<SectionIndex>, chainIndex: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const from = SECTION_VOICES[mix.from].kill;
    const to = SECTION_VOICES[mix.to].kill;
    const decay = lerp(from.decay, to.decay, mix.t);
    const gain = lerp(from.gain, to.gain, mix.t);
    const imager = vision().thermal;
    // Under the imager the soloist snaps into focus: brighter, tighter, louder.
    const cutoff = lerp(from.cutoff, to.cutoff, mix.t) * (1 + imager * 1.1);
    const velocity = Math.min(1.4, 1 + chainIndex * 0.11) * (1 + imager * 0.12);

    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      killLayer.play({
        context: ctx,
        time,
        midi,
        oscillator: SECTION_VOICES[section].kill.oscillator,
        cutoff,
        gainValue: gain,
        decay,
        velocity,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.4 + imager * 0.2 }],
      });
    }
    killBody.play({ context: ctx, time, midi, decay, gain, velocity, destination: output });
    if (chainIndex >= 2 || imager > 0.5) {
      killShimmer.play({
        context: ctx,
        time,
        midi,
        decay,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.03 + imager * 0.03, 0.06, 'highpass', 5200, output);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === coreId) {
      coreFinale();
      return;
    }
    if (armIds.delete(enemyId)) armSevered();
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, kill.midi, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    for (const [section, weight] of score.sectionLayers(sectionMix)) {
      if (weight < 0.02) continue;
      const settings = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: settings.oscillator,
        cutoff: settings.cutoff * (1 + vision().thermal * 0.6),
        gainValue: settings.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.3 }],
      });
    }
    noiseHit(time, 0.014, 0.02, 'highpass', 6400, output);
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const from = SECTION_VOICES[mix.from].fire;
    const to = SECTION_VOICES[mix.to].fire;
    const root = score.chordAt(position).bass;
    // A pressure launch, pitched two octaves over the current root and falling.
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 24,
      cutoff: lerp(from.cutoff, to.cutoff, mix.t),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 12), time: time + 0.1 }],
      destination: output,
    });
    noiseHit(time, lerp(from.noise, to.noise, mix.t), 0.09, 'bandpass', 1800, output);
  });

  // Chips on armour: a metal triad off the live chord, so even damage is in key.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      coreChip(1 - hitPointsRemaining / Math.max(1, coreMaxHp));
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.075], [2, 0.055]] as const).forEach(([index, vel]) => {
      if (!ctx || !output) return;
      chipVoice.play({
        context: ctx,
        time: time + index * SIXTEENTH * 0.25,
        midi: arp[index] + 12,
        vel,
        destination: output,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : undefined,
      });
    });
    noiseHit(time, 0.05, 0.04, 'bandpass', 3600, output);
  });

  // An arm comes away: the creature answers, and the whole mix ducks for it.
  function armSevered() {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(time, 0.55, 0.7);
    groan(time, 132, 44, 0.22, 1.5);
    anvil(time, 1, 0.6);
    noiseHit(time, 0.16, 0.3, 'lowpass', 900, mix.duck);
  }

  // Chipping the core rings the harbour like a struck hull, and the ring climbs
  // as the damage mounts: the fight audibly ratchets toward the last volley.
  function coreChip(intensity: number) {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.6,
      oscillatorType: 'sine',
      frequency: root * 4,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.3 + 0.18 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
      ],
      destination: output,
    });
    for (const ratio of [1, 2.76, 5.41]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'square',
        frequency: root * 2 * ratio,
        filter: { type: 'bandpass', Q: 2.6, frequency: 1200 + 2400 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.05 + 0.03 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
        ],
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    }
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.7,
      oscillatorType: 'triangle',
      frequency: midiToFreq(beacon),
      gainAutomation: [
        { type: 'set', value: 0.08 + 0.08 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.65 },
      ],
      destination: output,
      sends: [{ destination: mix.delaySend, gain: 0.55 }],
    });
    noiseHit(time, 0.12 + 0.08 * intensity, 0.08, 'bandpass', 1600, output);
  }

  // The last volley lands: everything ducks, the creature lets go, and the
  // melody resolves upward as the lamps come back on.
  function coreFinale() {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend || !mix.duck) return;
    const delaySend = mix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(time, 0.16, 2.2);

    groan(time, 150, 26, 0.34, 2.8);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.4,
      oscillatorType: 'sine',
      frequency: 180,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 36, time: time + 0.6 }],
      gainAutomation: [
        { type: 'set', value: 0.52, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.3 },
      ],
      destination: output,
    });
    noiseHit(time, 0.22, 0.9, 'lowpass', 1400, output);

    // A D minor peal climbing out of the dark, ringing through the delay.
    [50, 57, 62, 65, 69, 74, 77, 81].forEach((midi, index) => {
      if (!ctx || !output) return;
      const at = time + 0.18 + index * SIXTEENTH * 1.5;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 1.0,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2600 + index * 260 },
        gainAutomation: [
          { type: 'set', value: 0.115 - index * 0.006, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.9 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.5 }],
      });
    });
  }

  // A volley that clears four or more at once: the harbour rings back.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.7,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 1900 },
        gainAutomation: [
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.45 }],
      });
    }
    noiseHit(time, 0.07, 0.35, 'highpass', 5200, mix.duck);
  });

  // A refused volley: the beak shuts. Dead, dull, and deliberately out of key.
  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    rejectVoice.play({ context: ctx, time, frequency: 138, vel: 0.2, destination: output });
    rejectVoice.play({ context: ctx, time: time + 0.035, frequency: 97, vel: 0.14, destination: output });
    noiseHit(time, 0.16, 0.12, 'lowpass', 620, output);
    noiseHit(time + 0.04, 0.08, 0.16, 'bandpass', 2100, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    hullVoice.play({ context: ctx, time, frequency: 110, destination: output });
    for (const midi of [61, 67] as const) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.07, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.24, 0.2, 'bandpass', 800, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    noiseHit(ctx.currentTime, 0.05, 0.16, 'lowpass', 420, output);
  });

  // The creature registers its own parts so the score knows what it is hitting.
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'arm') armIds.add(enemyId);
    if (kind !== 'core') return;
    coreId = enemyId;
    score.overrideSection(2);
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    groan(time, 110, 38, 0.26, 2.2);
    riser(time, 1.6);
  });

  bus.on('bossphase', ({ phase }) => {
    const mix = runtime.mix();
    if (phase !== 'exposed' || !ctx || !mix?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(time, 0.45, 1.1);
    anvil(time, 1, 0.8);
    sonar(time + SIXTEENTH * 2, 74, 0.6);
  });

  return runtime;
}
