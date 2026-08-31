import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  SKYHOOK_7631_BARS,
  SKYHOOK_7631_BPM,
  SKYHOOK_7631_RUN_DURATION,
  SKYHOOK_7631_SCORE_SECTIONS,
  SKYHOOK_7631_STEPS_PER_BAR,
  SKYHOOK_7631_TIME,
} from './timing';
import {
  createSkyhookVoices,
  installSkyhookAirBed,
  type SkyhookAirBed,
  type SkyhookPlayerVoice,
} from './audio-voices';

// Altitude is the orchestration rule. The weather movement begins wide — air
// bed, suspended harmony, hull thumps, rain, and cable rhythm — then sheds a
// layer at every boundary. At orbital night only isolated station beacons and
// cable transients remain. The Reaver fight adds machinery, not a conventional
// musical "drop"; docking is one chord decelerating into silence.

const STEP = SKYHOOK_7631_TIME.stepSeconds;
const THIRTYSECOND = STEP / 2;
const STEPS_PER_BAR = SKYHOOK_7631_STEPS_PER_BAR;

type Chord = { bass: number; pad: number[]; arp: number[] };
type SectionIndex = 0 | 1 | 2 | 3 | 4;

const WEATHER_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 64], arp: [62, 64, 65, 69] }, // Dm(add9)
  { bass: 34, pad: [46, 53, 58, 62], arp: [58, 62, 65, 69] }, // Bbmaj7
  { bass: 41, pad: [53, 57, 60, 65], arp: [60, 65, 69, 72] }, // F
  { bass: 36, pad: [48, 55, 60, 62], arp: [60, 62, 67, 72] }, // Csus2
];

const HIGH_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 69], arp: [62, 66, 69, 74] }, // D open sky
  { bass: 43, pad: [55, 62, 67, 69], arp: [62, 67, 69, 74] }, // G(add9)
  { bass: 38, pad: [50, 57, 61, 64], arp: [61, 64, 69, 73] }, // D major haze
  { bass: 45, pad: [57, 61, 64, 69], arp: [61, 64, 69, 73] }, // A
];

const BOSS_CHORDS: Chord[] = [
  WEATHER_CHORDS[0],
  { bass: 39, pad: [51, 58, 63, 65], arp: [63, 65, 70, 75] }, // Eb: machinery biting the cable
  WEATHER_CHORDS[0],
  WEATHER_CHORDS[3],
];

const DOCK_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 61, 64, 69], arp: [61, 64, 69, 73] },
];

const KILL_LANES: Record<SectionIndex, number[]> = {
  0: [0, 1, 2, 3, 4, 3, 2, 1, 2, 3, 5, 4, 3, 2, 1, 0, 1, 3, 4, 5, 6, 5, 3, 2, 4, 5, 7, 6, 5, 3, 2, 0],
  1: [0, 2, 4, 6, 1, 3, 5, 7, 4, 2, 5, 3, 6, 4, 7, 5, 0, 4, 1, 5, 2, 6, 3, 7, 6, 5, 4, 3, 2, 1, 0, 4],
  2: [4, 5, 6, 7, 5, 4, 6, 3, 5, 7, 6, 4, 5, 3, 2, 4, 7, 6, 5, 4, 6, 5, 3, 2, 5, 4, 3, 1, 4, 2, 1, 0],
  3: [7, 5, 6, 4, 5, 3, 4, 2, 6, 4, 5, 3, 4, 2, 3, 1, 5, 3, 4, 2, 3, 1, 2, 0, 4, 3, 2, 1, 3, 4, 5, 7],
  4: [0, 2, 4, 5, 7, 5, 4, 2, 0, 1, 2, 4, 5, 4, 2, 1, 0, 2, 4, 7, 5, 4, 2, 0, 1, 3, 5, 4, 3, 2, 1, 0],
};

const PLAYER_VOICES: Record<SectionIndex, { lock: SkyhookPlayerVoice; kill: SkyhookPlayerVoice }> = {
  0: {
    lock: { oscillator: 'triangle', cutoff: 2600, gain: 0.095, decay: 0.13, delay: 0.28, reverb: 0.32 },
    kill: { oscillator: 'triangle', cutoff: 3300, gain: 0.15, decay: 0.34, delay: 0.38, reverb: 0.42 },
  },
  1: {
    lock: { oscillator: 'sine', cutoff: 4200, gain: 0.12, decay: 0.15, delay: 0.34, reverb: 0.48 },
    kill: { oscillator: 'triangle', cutoff: 4800, gain: 0.16, decay: 0.42, delay: 0.42, reverb: 0.55 },
  },
  2: {
    lock: { oscillator: 'sine', cutoff: 3100, gain: 0.1, decay: 0.18, delay: 0.44, reverb: 0.6 },
    kill: { oscillator: 'sine', cutoff: 3900, gain: 0.18, decay: 0.56, delay: 0.5, reverb: 0.68 },
  },
  3: {
    lock: { oscillator: 'triangle', cutoff: 1900, gain: 0.085, decay: 0.11, delay: 0.16, reverb: 0.2 },
    kill: { oscillator: 'square', cutoff: 2400, gain: 0.08, decay: 0.29, delay: 0.22, reverb: 0.3 },
  },
  4: {
    lock: { oscillator: 'sine', cutoff: 1800, gain: 0.07, decay: 0.25, delay: 0.5, reverb: 0.72 },
    kill: { oscillator: 'sine', cutoff: 2400, gain: 0.12, decay: 0.72, delay: 0.62, reverb: 0.82 },
  },
};

export function createAudio(bus: EventBus) {
  return createSkyhook7631Audio(bus).audio;
}

export const traceSkyhook7631Audio = createAudioTraceHarness({
  level: 'skyhook-7631',
  bpm: SKYHOOK_7631_BPM,
  stepSeconds: STEP,
  defaultSeconds: SKYHOOK_7631_RUN_DURATION,
  createAudio: createSkyhook7631Audio,
});

function createSkyhook7631Audio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let airBed: SkyhookAirBed | null = null;
  let reaverId = -1;
  let reaverMaxHp = 18;

  const score = createScore<Chord, SectionIndex>({
    bpm: SKYHOOK_7631_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: WEATHER_CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: SKYHOOK_7631_BARS.cloudbreak, toBar: SKYHOOK_7631_BARS.boss, chords: HIGH_CHORDS, barsPerChord: 2 },
      { fromBar: SKYHOOK_7631_BARS.boss, toBar: SKYHOOK_7631_BARS.docking, chords: BOSS_CHORDS, barsPerChord: 1 },
      { fromBar: SKYHOOK_7631_BARS.docking, toBar: SKYHOOK_7631_BARS.docked, chords: DOCK_CHORDS, barsPerChord: 2 },
    ],
    sections: SKYHOOK_7631_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    bpm: SKYHOOK_7631_BPM,
    stepSeconds: STEP,
    stepsPerBar: STEPS_PER_BAR,
    volumeScale: 0.78,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.006, release: 0.28 },
      delay: { time: STEP * 3, feedback: 0.3, dampHz: 2500 },
      reverb: { seconds: 3.6, decay: 2.8, level: 0.48 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      airBed = installSkyhookAirBed(context, mix);
    },
    onBeforeBeat({ time, step, bar, mode }) {
      if (mode === 'run' && step === 0) {
        runArrangement.recordSectionStart(time, bar);
        airBed?.setAir(time, airAtBar(bar));
      }
    },
    onStep: scheduleStep,
    onRunStart() {
      reaverId = -1;
      reaverMaxHp = 18;
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const time = context.currentTime + 0.05;
      const chord = DOCK_CHORDS[0];
      voices.beacon(time, chord.arp[0] + 12, 1.8, 0.38);
    },
    onDispose() {
      ctx = null;
      airBed = null;
    },
  });

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const blank = '................';
  const twoBarPad = `P${'.'.repeat(31)}`;
  const fourBarPad = `P${'.'.repeat(63)}`;

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'attract-weather',
      fromBar: 0,
      tracks: [
        hits(fourBarPad, { P: 1 }, ({ time, chord }) => voices.airPad(time, chord.pad, STEP * 64 * 1.04, 0.52, 0.42)),
        hits('B...............', { B: 1 }, ({ time, chord }) => voices.beacon(time, chord.arp[0] + 12, 0.72, 0.34)),
        hits('....c.......c...', { c: 1 }, ({ time, chord }) => voices.cableTick(time, chord.arp[1], 0.4, 0.25)),
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
        name: 'weather',
        fromBar: SKYHOOK_7631_BARS.storm,
        tracks: [
          hits(twoBarPad, { P: 1 }, ({ time, chord }) => voices.airPad(time, chord.pad, STEP * 32 * 1.03, 0.76, 0.35)),
          hits('H.......h.......', { H: 1, h: 0.68 }, ({ time, chord }, velocity) => voices.hullPulse(time, chord.bass, velocity, 0.34)),
          hits('r.r..r.r.r..r.r.', { r: 0.65 }, ({ time, step }, velocity) => voices.rainTick(time, velocity, step % 4 === 0 ? 0.2 : 0.8)),
          hits('....c.......c...', { c: 0.7 }, ({ time, chord }, velocity) => voices.cableTick(time, chord.arp[1], velocity, 0.35)),
        ],
      },
      {
        name: 'squall',
        fromBar: SKYHOOK_7631_BARS.squall,
        tracks: [
          hits(twoBarPad, { P: 1 }, ({ time, chord }) => voices.airPad(time, chord.pad, STEP * 32 * 1.03, 0.82, 0.48)),
          hits('H.....h.H...h...', { H: 1, h: 0.72 }, ({ time, chord }, velocity) => voices.hullPulse(time, chord.bass, velocity, 0.3)),
          hits('rrrrRr.rrrrrRr.r', { r: 0.55, R: 0.9 }, ({ time, step }, velocity) => voices.rainTick(time, velocity, step % 3 === 0 ? 0.9 : 0.35)),
          hits('c...c..c....c...', { c: 0.82 }, ({ time, chord, step }, velocity) => voices.cableTick(time, chord.arp[(step / 4) % chord.arp.length], velocity, 0.52)),
          oneShot(2, 0, ({ time, chord }) => voices.lift(time, chord.bass, STEP * 16, 0.85)),
        ],
      },
      {
        name: 'cloudbreak',
        fromBar: SKYHOOK_7631_BARS.cloudbreak,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            voices.impact(time, 0.72);
            voices.airPad(time, chord.pad.map((midi) => midi + 12), STEP * 16, 0.72, 0.8);
          }),
          hits('B.......B.......', { B: 1 }, ({ time, step, chord }) => voices.beacon(time, chord.arp[(step / 8) % chord.arp.length] + 12, 0.9, 0.62)),
        ],
      },
      {
        name: 'blue',
        fromBar: SKYHOOK_7631_BARS.blue,
        tracks: [
          hits(twoBarPad, { P: 1 }, ({ time, chord }) => voices.airPad(time, chord.pad, STEP * 32 * 1.04, 0.58, 0.68)),
          hits('H...........h...', { H: 0.72, h: 0.45 }, ({ time, chord }, velocity) => voices.hullPulse(time, chord.bass, velocity, 0.42)),
          hits('..c.....c.....c.', { c: 0.6 }, ({ time, chord, step }, velocity) => voices.cableTick(time, chord.arp[step % chord.arp.length], velocity, 0.72)),
          hits('B...............' + blank, { B: 1 }, ({ time, chord }) => voices.beacon(time, chord.arp[2] + 12, 1.25, 0.38)),
          fn(({ time, step, bar, chord }) => {
            if (step === 14 && bar % 2 === 1) voices.lift(time, chord.bass + 12, STEP * 2, 0.32);
          }),
        ],
      },
      {
        name: 'thin-air',
        fromBar: SKYHOOK_7631_BARS.thinAir,
        tracks: [
          hits(fourBarPad, { P: 1 }, ({ time, chord }) => voices.airPad(time, [chord.pad[0], chord.pad[2], chord.pad[3]], STEP * 48, 0.34, 0.48)),
          hits('H...............' + blank, { H: 0.42 }, ({ time, chord }, velocity) => voices.hullPulse(time, chord.bass, velocity, 0.48)),
          hits('......c.........', { c: 0.5 }, ({ time, chord }) => voices.cableTick(time, chord.arp[1] + 12, 0.42, 0.8)),
          hits('B...............', { B: 1 }, ({ time, chord }) => voices.beacon(time, chord.arp[3] + 12, 1.5, 0.28)),
        ],
      },
      {
        name: 'orbital-night',
        fromBar: SKYHOOK_7631_BARS.orbitalNight,
        tracks: [
          hits('B...............', { B: 1 }, ({ time, chord, bar }) => voices.beacon(time, chord.arp[bar % chord.arp.length] + 12, 1.7, 0.24)),
          hits('..........c.....', { c: 0.4 }, ({ time, chord }) => voices.cableTick(time, chord.arp[0], 0.32, 0.9)),
          oneShot(1, 0, ({ time, chord }) => voices.lift(time, chord.bass, STEP * 16, 0.5)),
        ],
      },
      {
        name: 'cable-reaver',
        fromBar: SKYHOOK_7631_BARS.boss,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            voices.impact(time, 0.88);
            voices.cableGroan(time, chord.bass - 12, STEP * 12, 0.92);
          }),
          hits('H.......H.......', { H: 0.58 }, ({ time, chord, bar }, velocity) => voices.hullPulse(time, chord.bass + (bar % 2) * 1, velocity, 0.38)),
          hits('c..c..c...c..c..', { c: 0.64 }, ({ time, chord, step, bar }, velocity) => voices.cableTick(time, chord.arp[(step + bar) % chord.arp.length], velocity, 0.72)),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && (bar - SKYHOOK_7631_BARS.boss) % 2 === 0) voices.cableGroan(time, chord.bass - 12, STEP * 13, 0.46);
            if (step === 12 && bar >= SKYHOOK_7631_BARS.boss + 2) voices.beacon(time, chord.arp[3] + 12, 0.9, 0.26);
          }),
        ],
      },
      {
        name: 'docking',
        fromBar: SKYHOOK_7631_BARS.docking,
        toBar: SKYHOOK_7631_BARS.docked,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => voices.airPad(time, chord.pad, STEP * 32 * 1.02, 0.34, 0.3)),
          oneShot(0, 0, ({ time, chord }) => voices.beacon(time, chord.arp[0] + 12, 2.2, 0.34)),
          oneShot(1, 8, ({ time, chord }) => voices.beacon(time, chord.arp[2] + 12, 2.6, 0.24)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  function mixedVoice(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill'): SkyhookPlayerVoice {
    const from = PLAYER_VOICES[mix.from][slot];
    const to = PLAYER_VOICES[mix.to][slot];
    return {
      oscillator: mix.t < 0.5 ? from.oscillator : to.oscillator,
      cutoff: lerp(from.cutoff, to.cutoff, mix.t),
      gain: lerp(from.gain, to.gain, mix.t),
      decay: lerp(from.decay, to.decay, mix.t),
      delay: lerp(from.delay, to.delay, mix.t),
      reverb: lerp(from.reverb, to.reverb, mix.t),
    };
  }

  function atPlayerGrid() {
    if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    return { time, position, chord: score.chordAt(position), mix: score.sectionMixAt(position) };
  }

  bus.on('lock', ({ lockCount }) => {
    const grid = atPlayerGrid();
    if (!grid) return;
    const lead = score.leadSetAt(grid.position);
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    voices.playerTone(grid.time, midi, mixedVoice(grid.mix, 'lock'), 0.86 + lockCount * 0.045);
    voices.playerNoise(grid.time, 0.012 + lockCount * 0.004, 0.024, 6500);
    if (lockCount === 6) {
      voices.playerTone(grid.time + THIRTYSECOND, midi + 12, mixedVoice(grid.mix, 'kill'), 0.62);
      voices.hullPulse(grid.time, grid.chord.bass, 0.35, 0.18);
    }
  });

  bus.on('unlock', () => {
    const grid = atPlayerGrid();
    if (!grid) return;
    voices.playerTone(grid.time, grid.chord.bass + 24, { ...mixedVoice(grid.mix, 'lock'), gain: 0.045, decay: 0.1 }, 0.5);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const grid = atPlayerGrid();
    if (!grid) return;
    const midi = grid.chord.arp[(indexInVolley ?? 0) % grid.chord.arp.length] + 24;
    voices.playerTone(grid.time, midi, {
      ...mixedVoice(grid.mix, 'lock'),
      oscillator: grid.mix.to === 3 ? 'square' : 'triangle',
      gain: grid.mix.to === 3 ? 0.042 : 0.055,
      decay: 0.065,
      cutoff: 4200,
      reverb: 0.08,
      delay: 0.12,
    }, 1);
    voices.playerNoise(grid.time, 0.035, 0.028, 4300, 'bandpass');
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (enemyId === reaverId) {
      reaverMaxHp = Math.max(reaverMaxHp, hitPointsRemaining + 1);
      const damage = 1 - hitPointsRemaining / Math.max(1, reaverMaxHp);
      voices.cableTick(time, chord.arp[Math.min(3, Math.floor(damage * 4))] + 12, 0.8 + damage * 0.5, damage);
      voices.cableGroan(time, chord.bass - 12 + Math.floor(damage * 7), 0.38 + damage * 0.35, 0.26 + damage * 0.28);
    } else {
      voices.cableTick(time, chord.arp[1] + 12, 0.68, 0.62);
      voices.playerNoise(time, 0.05, 0.045, 1800, 'bandpass');
    }
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    voices.impact(time, enemyId === reaverId ? 0.72 : 0.36);
    voices.cableGroan(time, chord.bass - 12 + stageIndex * 5, 0.9, 0.58);
    const lead = score.leadSetAt(position);
    [0, 2, 4].forEach((degree, index) => voices.playerTone(
      time + index * THIRTYSECOND,
      lead[Math.min(lead.length - 1, degree + stageIndex)],
      mixedVoice(score.sectionMixAt(position), 'kill'),
      0.58 - index * 0.08,
    ));
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const mix = score.sectionMixAt(position);
    if (enemyId === reaverId) {
      const audioMix = runtime.mix();
      audioMix?.duckAt(kill.time, 0.1, 1.35);
      voices.impact(kill.time, 1.18);
      voices.cableGroan(kill.time, 26, 1.5, 1.05);
      const lead = score.leadSetAt(position);
      [7, 6, 4, 2, 0].forEach((degree, index) => voices.playerTone(
        kill.time + index * THIRTYSECOND,
        lead[Math.min(lead.length - 1, degree)] + (index === 4 ? -12 : 0),
        PLAYER_VOICES[3].kill,
        0.92 - index * 0.1,
      ));
      return;
    }
    voices.playerTone(kill.time, kill.midi, mixedVoice(mix, 'kill'), Math.min(1.35, 0.9 + (indexInVolley ?? 0) * 0.11));
    if ((indexInVolley ?? 0) >= 3) voices.playerTone(kill.time, kill.midi - 12, { ...mixedVoice(mix, 'kill'), gain: 0.05 }, 0.52);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 5 || kills !== size) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    runtime.mix()?.duckAt(time, 0.72, 0.22);
    chord.arp.forEach((midi, index) => voices.playerTone(time + index * THIRTYSECOND, midi + 12, mixedVoice(score.sectionMixAt(position), 'kill'), 0.48));
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const root = score.chordAt(position).bass + 24;
    const rejectVoice: SkyhookPlayerVoice = { oscillator: 'square', cutoff: 820, gain: 0.045, decay: 0.18, delay: 0, reverb: 0.04 };
    voices.playerTone(time, root, rejectVoice, 1);
    voices.playerTone(time + 0.025, root + 1, rejectVoice, 0.82);
    voices.playerNoise(time, 0.11, 0.12, 540, 'bandpass');
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    voices.impact(time, 0.72);
    voices.cableGroan(time, chord.bass - 12, 0.55, 0.62);
    voices.beacon(time + 0.08, chord.arp[Math.max(0, Math.min(3, healthRemaining - 1))] + 12, 0.36, 0.5);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    voices.playerTone(time, chord.bass + 24, { ...mixedVoice(score.sectionMixAt(position), 'lock'), gain: 0.032, decay: 0.16 }, 0.52);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'reaver') {
      reaverId = enemyId;
      if (!ctx) return;
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      voices.cableGroan(time, chord.bass - 24, 2.2, 1);
      voices.lift(time, chord.bass - 12, 1.5, 0.52);
    } else if (kind === 'bolt' && ctx) {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const position = score.arrangementPositionAt(time);
      voices.beacon(time, score.leadSetAt(position)[enemyId % 4] + 12, 0.24, 0.3);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'exposed' || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    voices.impact(time, 0.65);
    chord.arp.forEach((midi, index) => voices.playerTone(time + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[3].kill, 0.56));
  });

  return runtime;
}

function airAtBar(bar: number) {
  if (bar < SKYHOOK_7631_BARS.cloudbreak) return 1;
  if (bar < SKYHOOK_7631_BARS.thinAir) return 0.68;
  if (bar < SKYHOOK_7631_BARS.orbitalNight) return 0.35;
  if (bar < SKYHOOK_7631_BARS.boss) return 0.14;
  if (bar < SKYHOOK_7631_BARS.docking) return 0.08;
  return 0.015;
}
