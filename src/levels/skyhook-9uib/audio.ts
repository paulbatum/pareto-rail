import type { EventBus } from '../../events';
import { createArrangement, fn, oneShot } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { SKYHOOK_9UIB_BPM, SKYHOOK_9UIB_RUN_DURATION, SKYHOOK_9UIB_TIME } from './gameplay';

const STEP = SKYHOOK_9UIB_TIME.stepSeconds;
const STEPS_PER_BAR = 16;
type Section = 'weather' | 'blue' | 'thin' | 'clamp' | 'dock';
type Chord = { bass: number; lead: readonly number[] };

// Open fifths shed notes as the air thins. The harmony rises by inversion while
// the arrangement loses drums, noise, and finally almost all pulse.
const CHORDS: readonly Chord[] = [
  { bass: 38, lead: [62, 65, 69, 72, 74, 77, 81, 84] },
  { bass: 41, lead: [65, 69, 72, 74, 77, 81, 84, 86] },
  { bass: 45, lead: [69, 72, 76, 81, 84, 88, 93, 96] },
  { bass: 43, lead: [67, 70, 74, 79, 82, 86, 91, 94] },
];
const SECTIONS = [
  { index: 'weather', fromBar: 0 },
  { index: 'blue', fromBar: 8, crossfadeBars: 1 },
  { index: 'thin', fromBar: 16, crossfadeBars: 2 },
  { index: 'clamp', fromBar: 21 },
  { index: 'dock', fromBar: 27 },
] as const;
const KILL_LANES: Record<Section, readonly number[]> = {
  weather: [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 4, 5, 3],
  blue: [2, 3, 5, 4, 6, 5, 3, 4, 5, 7, 6, 4, 5, 3, 2, 4],
  thin: [4, 6, 5, 7, 5, 3, 6, 4, 7, 5, 4, 2, 5, 6, 4, 3],
  clamp: [7, 6, 5, 3, 6, 5, 4, 2, 5, 4, 3, 1, 4, 5, 6, 7],
  dock: [5, 4, 3, 2, 4, 3, 2, 1, 3, 2, 1, 0, 2, 1, 0, 0],
};

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-9uib',
  bpm: SKYHOOK_9UIB_BPM,
  stepSeconds: STEP,
  defaultSeconds: SKYHOOK_9UIB_RUN_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Section>({
    bpm: SKYHOOK_9UIB_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    stepSeconds: STEP,
    volumeScale: 0.76,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -18, ratio: 4.5, attack: 0.005, release: 0.28 },
      delay: { time: STEP * 3, feedback: 0.28, dampHz: 1900 },
      reverb: { seconds: 3.2, decay: 3.5, level: 0.42 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunEnd() {
      const ctx = runtime.context();
      if (ctx) inst.tone(ctx.currentTime + 0.05, 86, 0.09, 2.8, 'sine');
    },
  });

  const tonal = voice<{ timbre: OscillatorType }>({
    oscillators: [{ type: (call) => call.timbre }],
    duration: 0.35,
    envelope: { attack: 0.008, decay: 0.34, peak: 1, floor: 0.001 },
    filter: { type: 'lowpass', cutoff: 3200 },
  });
  const air = noiseHit({ filterType: 'bandpass', frequency: 850, decay: 0.11 });
  const metal = noiseHit({ filterType: 'highpass', frequency: 3600, decay: 0.045 });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    tone(context, time, midi: number, velocity: number, decay: number, timbre: OscillatorType = 'triangle') {
      const mix = runtime.mix();
      if (!mix?.music) return;
      tonal.play({ context, time, midi, velocity, duration: decay, timbre, destination: mix.music,
        sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.35 }] : undefined });
    },
    action(context, time, midi: number, velocity: number, decay: number, timbre: OscillatorType = 'triangle') {
      const mix = runtime.mix();
      if (!mix?.sfx) return;
      tonal.play({ context, time, midi, velocity, duration: decay, timbre, destination: mix.sfx,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.18 }] : undefined });
    },
    wind(context, time, velocity: number, decay = 0.1) {
      const mix = runtime.mix();
      if (!mix?.music || !mix.noiseBuffer) return;
      air.play({ context, buffer: mix.noiseBuffer, time, velocity, decay, destination: mix.music, offset: Math.random() });
    },
    tick(context, time, velocity: number, decay = 0.04) {
      const mix = runtime.mix();
      if (!mix?.sfx || !mix.noiseBuffer) return;
      metal.play({ context, buffer: mix.noiseBuffer, time, velocity, decay, destination: mix.sfx, offset: Math.random() });
    },
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{ name: 'idle-air', fromBar: 0, tracks: [fn(({ time, step, chord }) => {
      if (step === 0) inst.tone(time, chord.lead[2], 0.035, 1.8, 'sine');
      if (step % 4 === 2) inst.wind(time, 0.015, 0.25);
    })] }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'weather', fromBar: 0, toBar: 8, tracks: [fn(({ time, step, bar, chord }) => {
        if (step % 2 === 0) inst.wind(time, step % 4 === 0 ? 0.055 : 0.035, 0.12);
        if (step === 0 || step === 10) inst.tone(time, chord.bass, 0.11, 0.5, 'triangle');
        if (step === 4 || step === 12) inst.tick(time, 0.055, 0.07);
        if (step % 4 === 0) inst.tone(time, chord.lead[(step / 4 + bar) % 4], 0.045, 0.45, 'sine');
      })] },
      { name: 'blue', fromBar: 8, toBar: 16, tracks: [
        oneShot(0, 0, ({ time, chord }) => inst.tone(time, chord.lead[5], 0.14, 2.5, 'sine')),
        fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 8) inst.tone(time, chord.bass + 12, 0.075, 0.8, 'triangle');
          if (step % 4 === 0) inst.tone(time, chord.lead[(step / 4 + bar) % 6], 0.05, 0.65, 'sine');
          if (step === 6 || step === 14) inst.wind(time, 0.022, 0.18);
        }),
      ] },
      { name: 'thin', fromBar: 16, toBar: 21, tracks: [fn(({ time, step, bar, chord }) => {
        if (step === 0) inst.tone(time, chord.lead[bar % 2 ? 4 : 2], 0.055, 1.9, 'sine');
        if (step === 10 && bar % 2 === 0) inst.tone(time, chord.lead[6], 0.025, 1.2, 'sine');
      })] },
      { name: 'clamp', fromBar: 21, toBar: 27, tracks: [
        oneShot(0, 0, ({ time }) => { inst.tick(time, 0.22, 0.5); inst.tone(time, 31, 0.16, 1.2, 'sawtooth'); }),
        fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 9) inst.tone(time, chord.bass, 0.1, 0.42, 'square');
          if (step === 4 || step === 12) inst.tick(time, 0.09, 0.08);
          if ((bar + step) % 8 === 0) inst.tone(time, chord.lead[5], 0.035, 0.35, 'triangle');
        }),
      ] },
      { name: 'dock', fromBar: 27, toBar: 30, tracks: [
        oneShot(0, 0, ({ time, chord }) => inst.tone(time, chord.lead[7], 0.08, 4.8, 'sine')),
        fn(({ time, step, bar, chord }) => {
          if (step === 0 && bar < 29) inst.tone(time, chord.lead[4], 0.018, 2.4, 'sine');
        }),
      ] },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  bus.on('lock', ({ lockCount }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    inst.action(time, lead[Math.min(lead.length - 1, lockCount + 1)], 0.055 + lockCount * 0.008, 0.14, 'sine');
  });
  bus.on('unlock', () => {
    const ctx = runtime.context();
    if (ctx) inst.tick(ctx.currentTime, 0.035, 0.025);
  });
  bus.on('fire', ({ volleySize }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.action(time, chord.bass + 24, 0.075 + volleySize * 0.012, 0.32, volleySize === 6 ? 'sawtooth' : 'triangle');
    inst.tick(time, 0.05 + volleySize * 0.012, 0.06);
  });
  bus.on('hit', ({ lethal, stageCompleted }) => {
    const ctx = runtime.context();
    if (!ctx || lethal) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.action(time, chord.bass + (stageCompleted ? 19 : 12), stageCompleted ? 0.09 : 0.045, 0.18, 'square');
  });
  bus.on('kill', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    inst.action(kill.time, kill.midi, 0.11, 0.4, 'triangle');
    inst.tick(kill.time, 0.06, 0.045);
  });
  bus.on('miss', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    const chord = score.chordAt(score.arrangementPositionAt(ctx.currentTime));
    inst.action(ctx.currentTime, chord.bass - 5, 0.07, 0.35, 'sawtooth');
  });
  bus.on('reject', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.tick(ctx.currentTime, 0.14, 0.12);
    inst.action(ctx.currentTime + 0.02, 42, 0.06, 0.16, 'square');
  });
  bus.on('playerhit', () => {
    const ctx = runtime.context();
    if (ctx) { inst.tick(ctx.currentTime, 0.2, 0.3); inst.action(ctx.currentTime, 29, 0.12, 0.6, 'sawtooth'); }
  });

  return runtime;
}
