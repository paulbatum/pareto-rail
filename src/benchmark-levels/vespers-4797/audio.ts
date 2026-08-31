import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  defineInstruments,
  type BeatLevelAudioRuntime,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, type SectionMix } from '../../engine/score';
import {
  VESPERS_4797_BPM,
  VESPERS_4797_RUN_DURATION,
  VESPERS_4797_TIME,
} from './gameplay';

const STEPS_PER_BAR = 16;
const SIXTEENTH = VESPERS_4797_TIME.stepSeconds;

type SectionIndex = 'threshold' | 'processional' | 'gallery' | 'swell' | 'silence' | 'rose' | 'ignition';

type Chord = {
  pedal: number;
  choir: readonly number[];
  upper: readonly number[];
  lead: readonly number[];
};

// A dark minor procession. The alternate set is the same route through the
// nave with the third and sixth lifted: the rose's death is the harmonic turn.
const MINOR_CHORDS: readonly Chord[] = [
  { pedal: 38, choir: [50, 53, 57, 60], upper: [62, 65, 69, 72], lead: [62, 65, 69, 72, 74, 77, 81, 84] }, // Dm9
  { pedal: 34, choir: [46, 50, 53, 57], upper: [62, 65, 69, 74], lead: [62, 65, 69, 74, 77, 81, 86, 89] }, // Bbmaj7
  { pedal: 31, choir: [43, 46, 50, 53], upper: [58, 62, 65, 69], lead: [58, 62, 65, 69, 70, 74, 77, 81] }, // Gm9
  { pedal: 33, choir: [45, 49, 52, 55], upper: [57, 61, 64, 69], lead: [57, 61, 64, 69, 73, 76, 81, 85] }, // A7sus
];

const MAJOR_CHORDS: readonly Chord[] = [
  { pedal: 38, choir: [50, 54, 57, 62], upper: [66, 69, 74, 78], lead: [66, 69, 74, 78, 81, 86, 90, 93] }, // D major
  { pedal: 33, choir: [45, 49, 52, 57], upper: [64, 69, 73, 76], lead: [64, 69, 73, 76, 81, 85, 88, 93] }, // A
  { pedal: 40, choir: [52, 56, 59, 64], upper: [68, 71, 76, 80], lead: [68, 71, 76, 80, 83, 88, 92, 95] }, // E minor lifted
  { pedal: 38, choir: [50, 54, 57, 62], upper: [69, 74, 78, 81], lead: [69, 74, 78, 81, 86, 90, 93, 98] }, // D(add6)
];

const SCORE_SECTIONS = [
  { index: 'threshold' as const, fromBar: 0 },
  { index: 'processional' as const, fromBar: 2, crossfadeBars: 1 },
  { index: 'gallery' as const, fromBar: 8, crossfadeBars: 1 },
  { index: 'swell' as const, fromBar: 12, crossfadeBars: 1 },
  { index: 'silence' as const, fromBar: 16, crossfadeBars: 0 },
  { index: 'rose' as const, fromBar: 24, crossfadeBars: 1 },
  { index: 'ignition' as const, fromBar: 27, crossfadeBars: 0 },
];

const KILL_LANES: Record<SectionIndex, readonly number[]> = {
  threshold: [0, 1, 2, 1, 0, 2, 3, 2],
  processional: [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 4, 5, 4, 2, 1, 3],
  gallery: [4, 2, 5, 3, 6, 4, 5, 2, 1, 3, 0, 2, 4, 6, 5, 3],
  swell: [0, 1, 3, 5, 4, 3, 2, 1, 0, 2, 4, 6, 7, 6, 4, 2],
  silence: [0, 0, 1, 0, 2, 0, 1, 0],
  rose: [6, 5, 4, 3, 2, 1, 0, 2, 4, 6, 7, 5, 3, 1, 0, 4],
  ignition: [0, 2, 4, 5, 7, 6, 4, 2, 0, 2, 4, 6, 7, 5, 3, 1],
};

const pedalVoice = voice<{ duration: number; brightness: number }>({
  oscillators: [
    { type: 'sine', gain: 0.22 },
    { type: 'triangle', octave: 1, gain: 0.028 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.08,
  filter: { type: 'lowpass', cutoff: ({ brightness }) => 540 + brightness * 720 },
  envelope: { attack: 0.45, decay: 0.5, sustain: 0.82, release: 0.55 },
});

const choirVoice = voice<{ duration: number; brightness: number }>({
  oscillators: [
    { type: 'sine', gain: 0.105 },
    { type: 'triangle', octave: 1, gain: 0.025 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.1,
  filter: { type: 'lowpass', cutoff: ({ brightness }) => 1500 + brightness * 1500 },
  envelope: { attack: 0.22, decay: 0.55, sustain: 0.72, release: 0.65 },
});

const cantusVoice = voice<{ duration: number; brightness: number }>({
  oscillators: [
    { type: 'sine', gain: 0.11 },
    { type: 'triangle', octave: 1, gain: 0.018 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.06,
  filter: { type: 'lowpass', cutoff: ({ brightness }) => 2300 + brightness * 2100 },
  envelope: { attack: 0.04, decay: 0.25, sustain: 0.55, release: 0.2 },
});

const bellVoice = voice<{ duration: number; brightness: number }>({
  oscillators: [
    { type: 'sine', gain: 0.15 },
    { type: 'sine', octave: 1, gain: 0.034 },
    { type: 'triangle', octave: 2, gain: 0.012 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.12,
  filter: { type: 'lowpass', cutoff: ({ brightness }) => 2800 + brightness * 2600 },
  envelope: { attack: 0.005, decay: ({ duration }) => duration * 0.7, floor: 0.0008 },
});

const lockVoice = voice<{ brightness: number }>({
  oscillators: [{ type: 'triangle', gain: 0.075 }],
  duration: 0.13,
  stopPadding: 0.03,
  filter: { type: 'lowpass', cutoff: ({ brightness }) => 2100 + brightness * 900 },
  envelope: { decay: 0.12 },
});

const fireVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.038 },
    { type: 'sine', octave: -1, gain: 0.08 },
  ],
  duration: 0.16,
  stopPadding: 0.03,
  filter: { type: 'lowpass', cutoff: 2600 },
  envelope: { decay: 0.16 },
});

const hitVoice = voice<{ brightness: number }>({
  oscillators: [{ type: 'triangle', gain: 0.095 }],
  duration: 0.22,
  stopPadding: 0.04,
  filter: { type: 'lowpass', cutoff: ({ brightness }) => 1800 + brightness * 2200 },
  envelope: { attack: 0.008, decay: 0.2 },
});

const playerKillVoice = voice<{ decay: number; brightness: number; chain: number }>({
  oscillators: [
    { type: 'sine', gain: ({ chain }) => 0.13 + Math.min(chain, 5) * 0.008 },
    { type: 'triangle', octave: 1, gain: ({ chain }) => 0.018 + Math.min(chain, 5) * 0.004 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.06,
  filter: { type: 'lowpass', cutoff: ({ brightness, chain }) => 2600 + brightness * 1100 + Math.min(chain, 5) * 220 },
  envelope: { attack: 0.012, decay: ({ decay }) => decay, floor: 0.0008 },
});

const rejectVoice = voice({
  oscillators: [{ type: 'sawtooth', gain: 0.06 }],
  duration: 0.31,
  stopPadding: 0.04,
  filter: {
    type: 'bandpass',
    Q: 6,
    frequencyAutomation: (time) => [
      { type: 'set', value: 720, time },
      { type: 'exponentialRamp', value: 190, time: time + 0.26 },
    ],
  },
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency, time },
    { type: 'exponentialRamp', value: frequency * 0.58, time: time + 0.26 },
  ],
  gainAutomation: (time) => [
    { type: 'set', value: 0.07, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.31 },
  ],
});

const finaleVoice = voice<{ duration: number }>({
  oscillators: [
    { type: 'sine', gain: 0.15 },
    { type: 'triangle', octave: 1, gain: 0.028 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.18,
  filter: { type: 'lowpass', cutoff: 4200 },
  envelope: { attack: 0.06, decay: 0.6, sustain: 0.76, release: 1.1 },
});

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-4797',
  bpm: VESPERS_4797_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: VESPERS_4797_RUN_DURATION,
  createAudio: createVespersAudio,
});

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink): BeatLevelAudioRuntime {
  let context: AudioContext | null = null;
  let runtime: BeatLevelAudioRuntime;
  const score = createScore<Chord, SectionIndex>({
    bpm: VESPERS_4797_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: MINOR_CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: 27, chords: MAJOR_CHORDS, barsPerChord: 1 }],
    sections: SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const instruments = defineInstruments(
    { trace, context: () => context },
    {
      pedal(ctx: AudioContext, time: number, midi: number, velocity: number, duration: number, brightness: number) {
        const destination = runtime.mix()?.music;
        if (!destination) return;
        pedalVoice.play({ context: ctx, time, midi, velocity, duration, brightness, destination });
      },
      choir(ctx: AudioContext, time: number, midi: number, velocity: number, duration: number, brightness: number) {
        const destination = runtime.mix()?.music;
        if (!destination) return;
        choirVoice.play({
          context: ctx,
          time,
          midi,
          velocity,
          duration,
          brightness,
          destination,
          sends: runtime.mix()?.reverbSend ? [{ destination: runtime.mix()!.reverbSend!, gain: 0.45 }] : undefined,
        });
      },
      cantus(ctx: AudioContext, time: number, midi: number, velocity: number, duration: number, brightness: number) {
        const destination = runtime.mix()?.music;
        if (!destination) return;
        cantusVoice.play({ context: ctx, time, midi, velocity, duration, brightness, destination });
      },
      bell(ctx: AudioContext, time: number, midi: number, velocity: number, duration: number, brightness: number) {
        const destination = runtime.mix()?.music;
        if (!destination) return;
        bellVoice.play({
          context: ctx,
          time,
          midi,
          velocity,
          duration,
          brightness,
          destination,
          sends: runtime.mix()?.reverbSend ? [{ destination: runtime.mix()!.reverbSend!, gain: 0.8 }] : undefined,
        });
      },
      lock(ctx: AudioContext, time: number, midi: number, velocity: number, brightness: number) {
        const destination = runtime.mix()?.sfx;
        if (!destination) return;
        lockVoice.play({ context: ctx, time, midi, velocity, brightness, destination });
      },
      fire(ctx: AudioContext, time: number, midi: number, velocity: number) {
        const destination = runtime.mix()?.sfx;
        if (!destination) return;
        fireVoice.play({ context: ctx, time, midi, velocity, destination });
      },
      hit(ctx: AudioContext, time: number, midi: number, velocity: number, brightness: number) {
        const destination = runtime.mix()?.sfx;
        if (!destination) return;
        hitVoice.play({ context: ctx, time, midi, velocity, brightness, destination });
      },
      kill(ctx: AudioContext, time: number, midi: number, velocity: number, decay: number, brightness: number, chain: number) {
        const destination = runtime.mix()?.sfx;
        if (!destination) return;
        playerKillVoice.play({ context: ctx, time, midi, velocity, decay, brightness, chain, destination, sends: runtime.mix()?.delaySend ? [{ destination: runtime.mix()!.delaySend!, gain: 0.34 }] : undefined });
      },
      reject(ctx: AudioContext, time: number, midi: number, velocity: number) {
        const destination = runtime.mix()?.sfx;
        if (!destination) return;
        rejectVoice.play({ context: ctx, time, frequency: midiToFreq(midi), velocity, destination });
      },
      finale(ctx: AudioContext, time: number, midi: number, velocity: number, duration: number) {
        const destination = runtime.mix()?.music;
        if (!destination) return;
        finaleVoice.play({ context: ctx, time, midi, velocity, duration, destination, sends: runtime.mix()?.reverbSend ? [{ destination: runtime.mix()!.reverbSend!, gain: 0.92 }] : undefined });
      },
    },
    {
      pedal: ['midi', 'velocity', 'duration', 'brightness'],
      choir: ['midi', 'velocity', 'duration', 'brightness'],
      cantus: ['midi', 'velocity', 'duration', 'brightness'],
      bell: ['midi', 'velocity', 'duration', 'brightness'],
      lock: ['midi', 'velocity', 'brightness'],
      fire: ['midi', 'velocity'],
      hit: ['midi', 'velocity', 'brightness'],
      kill: ['midi', 'velocity', 'decay', 'brightness', 'chain'],
      reject: ['midi', 'velocity'],
      finale: ['midi', 'velocity', 'duration'],
    },
  );

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [{
      name: 'vespers-ambient',
      fromBar: 0,
      tracks: [heldPedalTrack(0.72, 8), heldChordTrack(0.16, 8)],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'threshold', fromBar: 0, toBar: 2, tracks: [heldPedalTrack(0.9, 2)] },
      { name: 'processional', fromBar: 2, toBar: 8, tracks: [heldPedalTrack(0.8, 2), heldChordTrack(0.32, 2), cantusTrack([0, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 0, -1, 2, -1], 0.8)] },
      { name: 'gallery', fromBar: 8, toBar: 12, tracks: [heldPedalTrack(0.82, 2), heldChordTrack(0.4, 2), cantusTrack([0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 2, 3, 4, 5], 0.8), counterTrack([0, -1, 1, -1, 2, -1, 3, -1, 1, -1, 3, -1, 2, -1, 0, -1], 0.42)] },
      { name: 'swell', fromBar: 12, toBar: 16, tracks: [heldPedalTrack(0.86, 2), heldChordTrack(0.48, 2), cantusTrack([0, 1, 3, 5, 4, 3, 2, 1, 0, 2, 4, 6, 7, 6, 4, 2], 0.92), counterTrack([3, -1, 2, -1, 1, -1, 0, -1, 2, -1, 3, -1, 4, -1, 2, -1], 0.45), bellTrack(0.72)] },
      // One sustained pedal and a very sparse upper voice: the empty nave is
      // intentional and makes the west-wall arrival feel like an interruption.
      { name: 'silence', fromBar: 16, toBar: 24, tracks: [heldPedalTrack(0.68, 4), sparseCantusTrack()] },
      { name: 'rose', fromBar: 24, toBar: 27, tracks: [heldPedalTrack(0.76, 2), heldChordTrack(0.28, 2), cantusTrack([6, -1, 5, -1, 4, -1, 3, -1, 2, -1, 1, -1, 0, -1, 2, -1], 0.82), bellTrack(0.5)] },
      { name: 'ignition', fromBar: 27, tracks: [heldPedalTrack(0.9, 1), heldChordTrack(0.58, 1), cantusTrack([0, 2, 4, 5, 7, 6, 4, 2, 0, 2, 4, 6, 7, 5, 3, 1], 1), counterTrack([0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 4, 2, 0], 0.52), bellTrack(0.86)] },
    ],
  });

  runtime = createBeatLevelAudio({
    bus,
    trace,
    bpm: VESPERS_4797_BPM,
    stepSeconds: SIXTEENTH,
    stepsPerBar: STEPS_PER_BAR,
    runAlignment: 'bar',
    volumeScale: 0.82,
    score,
    mix: {
      compressor: { threshold: -20, ratio: 4.2, attack: 0.012, release: 0.34 },
      reverb: { seconds: 4.5, decay: 2.6, level: 0.26 },
      delay: { time: SIXTEENTH * 6, feedback: 0.24, dampHz: 2200, sendGain: 0.65 },
    },
    onPostBuild(ctx) {
      context = ctx;
    },
    onStep(step) {
      if (step.mode === 'ambient') ambientArrangement.schedule(step.position, step.time);
      else runArrangement.schedule(step.position, step.time);
    },
    onRunStart() {
      score.clearOverride();
    },
    onRunEnd() {
      score.clearOverride();
    },
    onDispose() {
      context = null;
    },
  });

  const outputContext = () => context;
  const actionPosition = (time: number) => score.arrangementPositionAt(time);
  const actionChord = (time: number) => score.chordAt(actionPosition(time));
  const actionTime = () => {
    const ctx = outputContext();
    return ctx ? score.quantizePlayerAction(ctx.currentTime) : null;
  };

  bus.on('lock', ({ lockCount }) => {
    const ctx = outputContext();
    const time = actionTime();
    if (!ctx || time === null) return;
    const position = actionPosition(time);
    const chord = actionChord(time);
    const mix = score.sectionMixAt(position);
    instruments.lock(time, chord.lead[lockCount % chord.lead.length]!, 0.52 + Math.min(lockCount, 5) * 0.05, brightnessForMix(mix));
  });

  bus.on('fire', ({ volleySize, indexInVolley }) => {
    const ctx = outputContext();
    const time = actionTime();
    if (!ctx || time === null) return;
    const chord = actionChord(time);
    const midi = chord.pedal + 12 + ((indexInVolley ?? 0) % 3) * 7;
    instruments.fire(time, midi, 0.72 + Math.min(volleySize, 6) * 0.045);
  });

  bus.on('hit', ({ lethal, hitStageIndex }) => {
    const ctx = outputContext();
    const time = actionTime();
    if (!ctx || time === null) return;
    const chord = actionChord(time);
    instruments.hit(time, chord.upper[(hitStageIndex + (lethal ? 1 : 0)) % chord.upper.length]!, lethal ? 0.95 : 0.62, lethal ? 1 : 0.45);
  });

  bus.on('kill', ({ indexInVolley }) => {
    const ctx = outputContext();
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const mix = score.sectionMixAt(Math.max(0, kill.step - score.arrangementStart));
    instruments.kill(kill.time, kill.midi, 0.82 + Math.min(indexInVolley ?? 0, 5) * 0.05, 0.38 + Math.min(indexInVolley ?? 0, 5) * 0.045, brightnessForMix(mix), indexInVolley ?? 0);
  });

  bus.on('reject', () => {
    const ctx = outputContext();
    const time = actionTime();
    if (!ctx || time === null) return;
    const chord = actionChord(time);
    instruments.reject(time, chord.pedal + 1, 0.7);
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < 3 || kills < size) return;
    const ctx = outputContext();
    const time = actionTime();
    if (!ctx || time === null) return;
    const chord = actionChord(time);
    for (const midi of chord.upper.slice(0, Math.min(3, size))) instruments.bell(time, midi, 0.18, 1.1, 0.8);
  });

  bus.on('bossphase', ({ phase }) => {
    const ctx = outputContext();
    const time = actionTime();
    if (!ctx || time === null) return;
    if (phase === 'summoned') {
      instruments.bell(time, 50, 0.62, 2.2, 0.72);
      instruments.pedal(time, 26, 0.52, 3.8, 0.35);
    } else if (phase === 'exposed') {
      instruments.bell(time, 62, 0.74, 2.6, 1);
      instruments.bell(time + SIXTEENTH * 2, 69, 0.56, 2.4, 1);
    } else {
      runtime.mix()?.duckAt(time, 0.22, 0.72);
      score.overrideSection('ignition');
      const chord = MAJOR_CHORDS[0]!;
      for (const [index, midi] of chord.choir.entries()) instruments.finale(time + index * SIXTEENTH * 0.5, midi, 0.86 - index * 0.08, 4.8);
      for (const midi of chord.upper) instruments.finale(time + SIXTEENTH, midi, 0.68, 4.2);
      instruments.bell(time + SIXTEENTH * 2, 86, 0.8, 3.6, 1);
    }
  });

  return runtime;

  function heldPedalTrack(velocity: number, everyBars: number) {
    return fn<Chord>((step) => {
      if (step.step !== 0 || step.barInSection % everyBars !== 0) return;
      const duration = SIXTEENTH * STEPS_PER_BAR * everyBars * 1.08;
      instruments.pedal(step.time, step.chord.pedal, velocity, duration, step.section.name === 'silence' ? 0.15 : 0.48);
    });
  }

  function heldChordTrack(velocity: number, everyBars: number) {
    return fn<Chord>((step) => {
      if (step.step !== 0 || step.barInSection % everyBars !== 0) return;
      const duration = SIXTEENTH * STEPS_PER_BAR * everyBars * 0.95;
      for (const midi of step.chord.choir) instruments.choir(step.time, midi, velocity / (step.chord.choir.length ** 0.35), duration, step.section.name === 'ignition' ? 1 : 0.58);
    });
  }

  function cantusTrack(pattern: readonly number[], velocity: number) {
    return fn<Chord>((step) => {
      const degree = pattern[step.step % pattern.length];
      if (degree === undefined || degree < 0) return;
      const midi = step.chord.lead[degree % step.chord.lead.length];
      if (midi === undefined) return;
      instruments.cantus(step.time, midi, velocity, SIXTEENTH * 1.55, step.section.name === 'ignition' ? 1 : 0.68);
    });
  }

  function sparseCantusTrack() {
    return fn<Chord>((step) => {
      if (step.step !== 0 && step.step !== 8) return;
      const degree = step.step === 0 ? 0 : 2;
      const midi = step.chord.lead[degree];
      if (midi === undefined) return;
      instruments.cantus(step.time, midi, 0.48, SIXTEENTH * 5.2, 0.22);
    });
  }

  function counterTrack(pattern: readonly number[], velocity: number) {
    return fn<Chord>((step) => {
      const degree = pattern[step.step % pattern.length];
      if (degree === undefined || degree < 0) return;
      const midi = step.chord.upper[degree % step.chord.upper.length];
      if (midi === undefined) return;
      instruments.choir(step.time, midi, velocity, SIXTEENTH * 1.25, step.section.name === 'ignition' ? 0.9 : 0.56);
    });
  }

  function bellTrack(velocity: number) {
    return fn<Chord>((step) => {
      if (step.step !== 0 || step.barInSection % 2 !== 0) return;
      instruments.bell(step.time, step.chord.upper[0]!, velocity, 1.7, step.section.name === 'ignition' ? 1 : 0.75);
      if (step.section.name === 'ignition') instruments.bell(step.time + SIXTEENTH * 4, step.chord.upper[2]!, velocity * 0.6, 1.4, 0.9);
    });
  }
}

function brightnessForMix(mix: SectionMix<SectionIndex>) {
  const values: Record<SectionIndex, number> = {
    threshold: 0.12,
    processional: 0.28,
    gallery: 0.52,
    swell: 0.74,
    silence: 0.08,
    rose: 0.62,
    ignition: 1,
  };
  return values[mix.from] + (values[mix.to] - values[mix.from]) * mix.t;
}
