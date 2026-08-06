import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { midiToFreq } from '../../engine/music';
import { createScore, type SectionMix } from '../../engine/score';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { VESPERS_X0UX_BPM, VESPERS_X0UX_RUN_DURATION, VESPERS_X0UX_TIME } from './gameplay';

// The building is the instrument: no drum track and no noise bed. A held
// pedal anchors the minor while reed-like voices enter in counterpoint; pitched
// chime partials mark structural changes and the rose's damage.
const STEPS_PER_BAR = VESPERS_X0UX_TIME.stepsPerBar;
const SIXTEENTH = VESPERS_X0UX_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;

type Chord = { bass: number; pad: number[]; arp: number[]; lead: number[] };
type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74], lead: [69, 74, 77, 81] }, // Dm
  { bass: 34, pad: [46, 50, 53, 58], arp: [62, 65, 70, 74], lead: [70, 74, 77, 82] }, // Bb
  { bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], lead: [69, 72, 77, 81] }, // F
  { bass: 36, pad: [48, 52, 55, 60], arp: [64, 67, 72, 76], lead: [67, 72, 76, 79] }, // C
];

// The dead rose leans on the flattened sixth; after the core dies the same
// register turns into D major, so the player's final lane is literally the
// cathedral's color coming back.
const ROSE_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74], lead: [69, 74, 77, 81] }, // Dm
  { bass: 39, pad: [51, 54, 58, 63], arp: [63, 66, 70, 75], lead: [70, 75, 78, 82] }, // Eb
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74], lead: [69, 74, 77, 81] }, // Dm
];
const MAJOR_CHORDS: Chord[] = [
  { bass: 38, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74], lead: [69, 74, 78, 81] }, // D
  { bass: 43, pad: [55, 59, 62, 67], arp: [67, 71, 74, 79], lead: [74, 79, 83, 86] }, // G
  { bass: 45, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81], lead: [73, 76, 81, 85] }, // A
];

const SCORE_SECTIONS = [
  { index: 0 as SectionIndex, fromBar: 0, crossfadeBars: 0 },
  { index: 1 as SectionIndex, fromBar: 4, crossfadeBars: 1 },
  { index: 2 as SectionIndex, fromBar: 8, crossfadeBars: 1 },
  { index: 3 as SectionIndex, fromBar: 11, crossfadeBars: 1 },
  { index: 4 as SectionIndex, fromBar: 13, crossfadeBars: 1 },
  { index: 5 as SectionIndex, fromBar: 16, crossfadeBars: 1 },
] as const;

const KILL_LANES: Record<SectionIndex, number[]> = {
  0: [0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5],
  1: [0, 4, 1, 5, 2, 6, 3, 7, 4, 2, 5, 1, 6, 3, 7, 2],
  2: [5, 4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 7, 5, 4, 3, 2],
  3: [7, 6, 5, 4, 6, 5, 4, 3, 5, 4, 3, 2, 3, 2, 1, 0],
  4: [7, 6, 5, 4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 7, 6, 5],
  5: [0, 2, 4, 6, 7, 6, 4, 2, 0, 2, 4, 6, 7, 6, 4, 2],
};

const PLAYER_VOICES: Record<SectionIndex, {
  lock: { oscillator: OscillatorType; gain: number; cutoff: number; decay: number };
  kill: { oscillator: OscillatorType; gain: number; cutoff: number; decay: number };
  fire: { oscillator: OscillatorType; gain: number; cutoff: number };
}> = {
  0: { lock: { oscillator: 'sine', gain: 0.13, cutoff: 2800, decay: 0.14 }, kill: { oscillator: 'triangle', gain: 0.18, cutoff: 3200, decay: 0.42 }, fire: { oscillator: 'triangle', gain: 0.065, cutoff: 2500 } },
  1: { lock: { oscillator: 'triangle', gain: 0.09, cutoff: 2500, decay: 0.12 }, kill: { oscillator: 'triangle', gain: 0.17, cutoff: 3500, decay: 0.34 }, fire: { oscillator: 'square', gain: 0.045, cutoff: 2800 } },
  2: { lock: { oscillator: 'sine', gain: 0.11, cutoff: 2200, decay: 0.16 }, kill: { oscillator: 'sine', gain: 0.21, cutoff: 2900, decay: 0.5 }, fire: { oscillator: 'triangle', gain: 0.05, cutoff: 2100 } },
  3: { lock: { oscillator: 'triangle', gain: 0.08, cutoff: 2400, decay: 0.14 }, kill: { oscillator: 'sawtooth', gain: 0.13, cutoff: 3000, decay: 0.38 }, fire: { oscillator: 'sawtooth', gain: 0.045, cutoff: 3200 } },
  4: { lock: { oscillator: 'sawtooth', gain: 0.055, cutoff: 2600, decay: 0.17 }, kill: { oscillator: 'sawtooth', gain: 0.16, cutoff: 3300, decay: 0.48 }, fire: { oscillator: 'square', gain: 0.05, cutoff: 3500 } },
  5: { lock: { oscillator: 'sine', gain: 0.14, cutoff: 4000, decay: 0.2 }, kill: { oscillator: 'triangle', gain: 0.2, cutoff: 5000, decay: 0.72 }, fire: { oscillator: 'triangle', gain: 0.06, cutoff: 4500 } },
};

function sectionAt(position: number): SectionIndex {
  const bar = Math.floor(position / STEPS_PER_BAR);
  if (bar >= 16) return 5;
  if (bar >= 13) return 4;
  if (bar >= 11) return 3;
  if (bar >= 8) return 2;
  if (bar >= 4) return 1;
  return 0;
}

function blend(a: number, b: number, t: number) { return a + (b - a) * t; }

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-x0ux',
  bpm: VESPERS_X0UX_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: VESPERS_X0UX_RUN_DURATION,
  createAudio: createVespersAudio,
});

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let shellId = -1;
  let coreId = -1;
  let coreMaxHp = 2;

  const score = createScore<Chord, SectionIndex>({
    bpm: VESPERS_X0UX_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: 13, toBar: 16, chords: ROSE_CHORDS, barsPerChord: 1 },
      { fromBar: 16, chords: MAJOR_CHORDS, barsPerChord: 1 },
    ],
    sections: SCORE_SECTIONS,
    leadSet: (chord) => [...chord.lead, ...chord.lead.map((midi) => midi + 12)],
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    bpm: VESPERS_X0UX_BPM,
    stepSeconds: SIXTEENTH,
    stepsPerBar: STEPS_PER_BAR,
    score,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.82,
    mix: {
      compressor: { threshold: -19, ratio: 4, attack: 0.008, release: 0.35 },
      delay: { time: SIXTEENTH * 3, feedback: 0.28, dampHz: 2600, sendGain: 0.8 },
      reverb: { seconds: 3.8, decay: 3.6, level: 0.5 },
    },
    onPostBuild(context) { ctx = context; },
    onBeforeBeat(step) {
      if (step.mode === 'run' && step.step === 0) runArrangement.recordSectionStart(step.time, step.bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      shellId = -1;
      coreId = -1;
      coreMaxHp = 2;
      score.clearOverride();
    },
    onRunEnd() { score.clearOverride(); },
    onDispose() { ctx = null; },
  });

  const musicDestination = () => runtime.mix()?.music ?? runtime.mix()?.master ?? null;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const delaySend = () => runtime.mix()?.delaySend;
  const reverbSend = () => runtime.mix()?.reverbSend;

  function oscillator(
    time: number,
    midi: number,
    oscillatorType: OscillatorType,
    duration: number,
    gain: number,
    destination: AudioNode,
    options: { cutoff?: number; detune?: number; fallTo?: number; send?: number; attack?: number } = {},
  ) {
    if (!ctx) return;
    const attack = options.attack ?? Math.min(0.04, duration * 0.2);
    const end = Math.max(time + 0.02, time + duration);
    const frequencyAutomation = options.fallTo === undefined ? undefined : [{ type: 'exponentialRamp' as const, value: midiToFreq(options.fallTo), time: time + Math.min(0.16, duration * 0.45) }];
    const gainAutomation = [
      { type: 'set' as const, value: 0.001, time },
      { type: 'linearRamp' as const, value: gain, time: time + attack },
      { type: 'exponentialRamp' as const, value: 0.001, time: end },
    ];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: end + 0.04,
      oscillatorType,
      frequency: midiToFreq(midi),
      detune: options.detune,
      frequencyAutomation,
      gainAutomation,
      filter: options.cutoff ? { type: 'lowpass', frequency: options.cutoff, Q: 1.1 } : undefined,
      destination,
      sends: options.send && delaySend() ? [{ destination: delaySend()!, gain: options.send }] : undefined,
    });
  }

  function pedal(time: number, midi: number, duration: number, weight = 1) {
    if (trace) { trace.record(time, 'bass', { midi, duration, weight }); return; }
    const output = musicDestination();
    if (!output) return;
    oscillator(time, midi, 'sine', duration, 0.14 * weight, output, { cutoff: 520, send: 0.24, attack: 0.2 });
    oscillator(time, midi + 12, 'triangle', duration * 0.92, 0.045 * weight, output, { cutoff: 900, send: 0.35, attack: 0.3 });
  }

  function organ(time: number, midi: number, duration: number, weight = 1, octave = 0) {
    if (trace) { trace.record(time, 'arp', { midi: midi + octave, duration, weight }); return; }
    const output = musicDestination();
    if (!output) return;
    oscillator(time, midi + octave, 'triangle', duration, 0.085 * weight, output, { cutoff: 2100, send: 0.5, attack: Math.min(0.12, duration * 0.2) });
    oscillator(time, midi + octave + 12, 'sine', duration * 0.82, 0.035 * weight, output, { cutoff: 3300, send: 0.62, attack: 0.08 });
  }

  function choir(time: number, midis: number[], duration: number, weight = 1) {
    if (trace) { trace.record(time, 'choir', { midis, duration, weight }); return; }
    const output = musicDestination();
    if (!output) return;
    for (const [index, midi] of midis.entries()) {
      oscillator(time, midi, 'sine', duration, (0.045 - index * 0.003) * weight, output, { cutoff: 1800, send: 0.8, attack: Math.min(0.7, duration * 0.25) });
    }
  }

  function bell(time: number, midi: number, weight = 1) {
    if (trace) { trace.record(time, 'bell', { midi, weight }); return; }
    const output = musicDestination();
    if (!output) return;
    oscillator(time, midi, 'sine', 1.8, 0.16 * weight, output, { cutoff: 4600, send: 0.9, attack: 0.006 });
    oscillator(time, midi + 12, 'sine', 1.1, 0.055 * weight, output, { cutoff: 6200, send: 1.0, attack: 0.004 });
    oscillator(time, midi + 19, 'triangle', 0.7, 0.024 * weight, output, { cutoff: 7200, send: 1.0, attack: 0.003 });
  }

  function roseFinale(time: number) {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!trace && (!ctx || !output)) return;
    if (!trace) mix?.duckAt(time, 0.18, 2.2);
    const chord = [50, 54, 57, 62, 66, 69];
    choir(time, chord, 6.8, 1.25);
    pedal(time, 38, 5.8, 1.3);
    for (const [index, midi] of [86, 81, 78, 74, 69, 66, 62].entries()) {
      organ(time + index * THIRTYSECOND, midi, 1.6, 1.15 - index * 0.08);
    }
    bell(time, 74, 1.3);
    bell(time + SIXTEENTH * 2, 81, 1.1);
    bell(time + SIXTEENTH * 4, 86, 1.0);
  }

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'narthex',
      fromBar: 0,
      tracks: [
        oneShot(0, 0, ({ time, chord }) => pedal(time, chord.bass, SIXTEENTH * 30, 0.72)),
        hits('O.......O.......', { O: 0.46 }, ({ time, step, chord }, velocity) => organ(time, chord.arp[(step / 8) % chord.arp.length], SIXTEENTH * 3.5, velocity)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    emitSections: true,
    sections: [
      {
        name: 'nave', fromBar: 0, toBar: 4,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => pedal(time, chord.bass, SIXTEENTH * 34, 1)),
          oneShot(2, 0, ({ time, chord }) => choir(time, chord.pad, SIXTEENTH * 31, 0.42)),
          hits('O.......O.......', { O: 0.55 }, ({ time, step, chord }, velocity) => organ(time, chord.arp[(step / 8) % chord.arp.length], SIXTEENTH * 5.5, velocity)),
        ],
      },
      {
        name: 'arcade', fromBar: 4, toBar: 8,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => pedal(time, chord.bass, SIXTEENTH * 40, 1.05)),
          fn(({ time, step, chord, barInSection }) => {
            if (step % 4 === 0) organ(time, chord.arp[(step / 4 + barInSection) % chord.arp.length], SIXTEENTH * 2.8, 0.72, barInSection % 2 ? 0 : 12);
            if (step === 0 && barInSection % 2 === 0) choir(time, chord.pad, SIXTEENTH * 14, 0.35);
          }),
        ],
      },
      {
        name: 'dead-span', fromBar: 8, toBar: 11,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => pedal(time, chord.bass, SIXTEENTH * 35, 0.74)),
          oneShot(1, 0, ({ time, chord }) => organ(time, chord.lead[0], SIXTEENTH * 5, 0.28, 12)),
          oneShot(2, 8, ({ time, chord }) => bell(time, chord.lead[1], 0.42)),
        ],
      },
      {
        name: 'approach', fromBar: 11, toBar: 13,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => pedal(time, chord.bass, SIXTEENTH * 28, 1.06)),
          fn(({ time, step, chord, barInSection }) => {
            if (step % 2 === 0) organ(time, chord.arp[(step / 2 + barInSection) % chord.arp.length], SIXTEENTH * 1.8, 0.55 + barInSection * 0.08, 12);
            if (step === 0) choir(time, chord.pad, SIXTEENTH * 11, 0.46 + barInSection * 0.1);
          }),
          oneShot(1, 12, ({ time, chord }) => bell(time, chord.lead[3], 0.7)),
        ],
      },
      {
        name: 'rose', fromBar: 13, toBar: 16,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => pedal(time, chord.bass, SIXTEENTH * 26, 1.2)),
          oneShot(0, 0, ({ time, chord }) => choir(time, chord.pad, SIXTEENTH * 13, 0.7)),
          fn(({ time, step, chord, barInSection }) => {
            if (step % 2 === 0) organ(time, chord.lead[(step / 2 + barInSection * 2) % chord.lead.length], SIXTEENTH * 1.8, 0.78, 12);
            if (step === 0 && barInSection === 1) bell(time, chord.lead[3] + 12, 0.8);
          }),
        ],
      },
      {
        name: 'major-return', fromBar: 16, toBar: 18,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => choir(time, chord.pad, SIXTEENTH * 34, 1.1)),
          oneShot(0, 0, ({ time, chord }) => pedal(time, chord.bass, SIXTEENTH * 34, 1.18)),
          fn(({ time, step, chord }) => {
            if (step % 4 === 0) organ(time, chord.arp[(step / 4) % chord.arp.length] + 12, SIXTEENTH * 3.6, 0.86);
            if (step === 0) bell(time, chord.lead[3] + 12, 1.0);
          }),
        ],
      },
    ],
  });

  function scheduleStep(step: BeatLevelAudioStep) {
    if (step.mode === 'ambient') ambientArrangement.schedule(step.position, step.time);
    else runArrangement.schedule(step.position, step.time);
  }

  function sectionMix(position: number): SectionMix<SectionIndex> { return score.sectionMixAt(position); }

  function playerTone(time: number, midi: number, type: 'lock' | 'kill' | 'fire', velocity: number, mix: SectionMix<SectionIndex>, duration?: number) {
    const output = sfxDestination();
    if (!output) return;
    const from = PLAYER_VOICES[mix.from][type];
    const to = PLAYER_VOICES[mix.to][type];
    const oscillatorType = mix.t < 0.5 ? from.oscillator : to.oscillator;
    const gain = blend(from.gain, to.gain, mix.t) * velocity;
    const cutoff = blend(from.cutoff, to.cutoff, mix.t);
    const fromDecay = type === 'fire' ? 0.11 : (from as { decay: number }).decay;
    const toDecay = type === 'fire' ? 0.11 : (to as { decay: number }).decay;
    const decay = duration ?? blend(fromDecay, toDecay, mix.t);
    oscillator(time, midi, oscillatorType, decay, gain, output, { cutoff, send: type === 'kill' ? 0.68 : 0.34 });
  }

  bus.on('runstart', () => { shellId = -1; coreId = -1; });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'rose-shell') shellId = enemyId;
    if (kind === 'rose-core') coreId = enemyId;
  });
  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = sectionMix(position);
    playerTone(time, mix === undefined ? chord.lead[0] : score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))], 'lock', 1, mix);
    if (lockCount >= 6) bell(time + THIRTYSECOND, chord.lead[2] + 12, 0.34);
  });
  bus.on('unlock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, 'lock', 0.36, sectionMix(position), 0.12);
    bell(time, score.chordAt(position).bass + 24, 0.16);
    void lockCount;
  });
  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = sectionMix(position);
    playerTone(time, chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24, 'fire', 1, mix, 0.11);
  });
  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    if (!ctx || lethal) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      const intensity = 1 - hitPointsRemaining / coreMaxHp;
      bell(time, chord.bass + 24 + Math.round(intensity * 12), 0.45 + intensity * 0.5);
      playerTone(time + THIRTYSECOND, chord.lead[2] + 12, 'kill', 0.35 + intensity * 0.25, sectionMix(position));
    } else {
      playerTone(time, chord.arp[1] + 12, 'kill', 0.45, sectionMix(position), 0.16);
    }
  });
  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    bell(time, chord.bass + 12 + stageIndex * 5, enemyId === shellId ? 1 : 0.66);
    if (enemyId === shellId) choir(time, chord.pad, SIXTEENTH * 9, 0.8);
  });
  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    if (enemyId === coreId) {
      roseFinale(kill.time);
      return;
    }
    playerTone(kill.time, kill.midi, 'kill', Math.min(1.35, 1 + (indexInVolley ?? 0) * 0.12), score.sectionMixAt(position));
  });
  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    choir(time, score.chordAt(position).pad, SIXTEENTH * 3, 0.34);
  });
  bus.on('reject', () => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const output = sfxDestination();
    if (output) oscillator(time, score.chordAt(position).bass + 25, 'square', 0.3, 0.07, output, { cutoff: 850, fallTo: score.chordAt(position).bass + 13, send: 0.28 });
  });
  bus.on('miss', ({ worldPosition }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    bell(time, score.chordAt(position).bass + 7, 0.12);
    void worldPosition;
  });
  bus.on('playerhit', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    bell(time, score.chordAt(position).bass - 5, 0.55);
  });

  return runtime;
}
