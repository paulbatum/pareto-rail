import type { EventBus } from '../../events';
import { createArrangement, fn, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createScore } from '../../engine/score';
import { STRANDLINE_S5CX_BPM, STRANDLINE_S5CX_RUN_DURATION, STRANDLINE_S5CX_TIME } from './gameplay';

const STEP = STRANDLINE_S5CX_TIME.stepSeconds;
const STEPS_PER_BAR = 16;
type Section = 'hush' | 'moon' | 'forest' | 'quickening' | 'crown' | 'release';
type Chord = { bass: number; lead: readonly number[] };

// Open D harmony moves from suspended, low-register fifths toward a clean
// Lydian color. The parasite section borrows one sour semitone; killing the
// parent removes it and lets the final phrase settle on the high tonic.
const CHORDS: readonly Chord[] = [
  { bass: 38, lead: [62, 64, 69, 74, 76, 81, 86, 88] },
  { bass: 43, lead: [62, 67, 69, 74, 79, 81, 86, 91] },
  { bass: 45, lead: [64, 69, 71, 76, 81, 83, 88, 93] },
  { bass: 40, lead: [64, 66, 71, 73, 76, 78, 83, 85] },
];
const SECTIONS = [
  { index: 'hush', fromBar: 0 },
  { index: 'moon', fromBar: 8, crossfadeBars: 1 },
  { index: 'forest', fromBar: 11, crossfadeBars: 1 },
  { index: 'quickening', fromBar: 17, crossfadeBars: 2 },
  { index: 'crown', fromBar: 22 },
  { index: 'release', fromBar: 28 },
] as const;
const KILL_LANES: Record<Section, readonly number[]> = {
  hush: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 4, 3, 5, 4, 6],
  moon: [2, 4, 5, 3, 6, 5, 7, 4, 6, 5, 3, 4, 6, 7, 5, 4],
  forest: [1, 3, 2, 5, 4, 6, 3, 7, 5, 4, 6, 2, 4, 5, 7, 6],
  quickening: [3, 5, 4, 6, 5, 7, 6, 4, 5, 3, 6, 7, 5, 4, 6, 7],
  crown: [7, 5, 6, 3, 5, 4, 2, 6, 4, 3, 1, 5, 3, 2, 4, 0],
  release: [4, 5, 7, 6, 5, 4, 6, 7, 6, 5, 4, 3, 5, 4, 2, 0],
};

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineS5cxAudio = createAudioTraceHarness({
  level: 'strandline-s5cx',
  bpm: STRANDLINE_S5CX_BPM,
  stepSeconds: STEP,
  defaultSeconds: STRANDLINE_S5CX_RUN_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Section>({
    bpm: STRANDLINE_S5CX_BPM,
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
    volumeScale: 0.74,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -19, ratio: 4.2, attack: 0.008, release: 0.3 },
      delay: { time: STEP * 3, feedback: 0.3, dampHz: 2600 },
      reverb: { seconds: 3.6, decay: 4.3, level: 0.46 },
      noiseSeconds: 2.4,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      inst.tone(context.currentTime + 0.05, 86, 0.045, 3.8, 'sine');
      inst.tone(context.currentTime + 0.08, 93, 0.024, 4.4, 'sine');
    },
  });

  const liquidVoice = voice<{ timbre: OscillatorType; brightness: number }>({
    oscillators: [
      { type: (call) => call.timbre },
      { type: 'sine', octave: 1, gain: 0.28, detune: 5 },
    ],
    duration: 0.7,
    envelope: { attack: 0.018, decay: 0.62, peak: 1, floor: 0.001 },
    filter: { type: 'lowpass', cutoff: (call) => call.brightness },
  });
  const membraneVoice = voice<{ pressure: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'triangle', frequencyRatio: 1.505, gain: 0.22 },
    ],
    duration: 1.4,
    envelope: { attack: 0.06, decay: 1.3, peak: 1, floor: 0.001 },
    filter: { type: 'lowpass', cutoff: (call) => 900 + call.pressure * 2700 },
  });
  const waterNoise = noiseHit({ filterType: 'bandpass', frequency: 820, decay: 0.18 });
  const snapNoise = noiseHit({ filterType: 'highpass', frequency: 3900, decay: 0.055 });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    tone(context, time, midi: number, velocity: number, decay: number, timbre: OscillatorType = 'triangle', brightness = 2600) {
      const mix = runtime.mix();
      if (!mix?.music) return;
      liquidVoice.play({ context, time, midi, velocity, duration: decay, timbre, brightness, destination: mix.music,
        sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : undefined });
    },
    membrane(context, time, midi: number, velocity: number, decay = 1.2, pressure = 0.3) {
      const mix = runtime.mix();
      if (!mix?.music) return;
      membraneVoice.play({ context, time, midi, velocity, duration: decay, pressure, destination: mix.music,
        sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.48 }] : undefined });
    },
    action(context, time, midi: number, velocity: number, decay: number, timbre: OscillatorType = 'sine', brightness = 3600) {
      const mix = runtime.mix();
      if (!mix?.sfx) return;
      liquidVoice.play({ context, time, midi, velocity, duration: decay, timbre, brightness, destination: mix.sfx,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.2 }] : undefined });
    },
    water(context, time, velocity: number, decay = 0.16, frequency = 820) {
      const mix = runtime.mix();
      if (!mix?.music || !mix.noiseBuffer) return;
      waterNoise.play({ context, buffer: mix.noiseBuffer, time, velocity, decay, frequency, destination: mix.music, offset: Math.random() });
    },
    snap(context, time, velocity: number, decay = 0.05) {
      const mix = runtime.mix();
      if (!mix?.sfx || !mix.noiseBuffer) return;
      snapNoise.play({ context, buffer: mix.noiseBuffer, time, velocity, decay, destination: mix.sfx, offset: Math.random() });
    },
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{ name: 'drift', fromBar: 0, tracks: [fn(({ time, step, chord }) => {
      if (step === 0) inst.membrane(time, chord.bass + 12, 0.026, 2.8, 0.05);
      if (step === 10) inst.water(time, 0.018, 0.35, 620);
    })] }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'hush', fromBar: 0, toBar: 8, tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0) inst.membrane(time, chord.bass, 0.095, 1.7, 0.1);
          if (step === 8) inst.membrane(time, chord.bass + 12, 0.045, 1.2, 0.08);
          if (step === 4 || step === 12) inst.water(time, 0.022, 0.2, 720 + bar * 25);
          if (step === 2 && bar % 2 === 1) inst.tone(time, chord.lead[2], 0.024, 1.3, 'sine', 1500);
        })],
      },
      {
        name: 'moon', fromBar: 8, toBar: 11, tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            inst.tone(time, chord.lead[6], 0.09, 3.4, 'sine', 3800);
            inst.membrane(time, chord.bass + 12, 0.1, 3, 0.3);
          }),
          fn(({ time, step, chord }) => {
            if (step === 0 || step === 8) inst.membrane(time, chord.bass, 0.08, 1.3, 0.2);
            if (step % 4 === 0) inst.tone(time, chord.lead[(step / 4 + 3) % 7], 0.032, 0.8, 'sine', 2700);
          }),
        ],
      },
      {
        name: 'forest', fromBar: 11, toBar: 17, tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 8) inst.membrane(time, chord.bass, 0.09, 1.1, 0.28);
          if (step % 4 === 0) inst.tone(time, chord.lead[(bar + step / 4) % 6], 0.036, 0.5, 'triangle', 3200);
          if (step === 3 || step === 11) inst.water(time, 0.026, 0.14, 1100);
        })],
      },
      {
        name: 'quickening', fromBar: 17, toBar: 22, tracks: [
          oneShot(0, 0, ({ time, chord }) => inst.tone(time, chord.lead[7], 0.1, 2.4, 'sine', 4800)),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 || step === 8) inst.membrane(time, chord.bass, 0.105, 0.85, 0.5);
            if (step % 2 === 0) inst.tone(time, chord.lead[(step / 2 + bar) % 7], 0.025, 0.28, 'triangle', 4400);
            if (step % 4 === 2) inst.water(time, 0.035, 0.1, 1700);
          }),
        ],
      },
      {
        name: 'crown', fromBar: 22, toBar: 28, tracks: [
          oneShot(0, 0, ({ time }) => {
            inst.snap(time, 0.18, 0.35);
            inst.membrane(time, 37, 0.15, 1.5, 0.75);
          }),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 || step === 9) inst.membrane(time, chord.bass - 1, 0.12, 0.65, 0.8);
            if (step === 4 || step === 12) inst.snap(time, 0.055 + (bar - 22) * 0.007, 0.08);
            if (step % 4 === 0) inst.tone(time, chord.lead[(7 - step / 4 + bar) % 8], 0.04, 0.42, 'square', 2400);
          }),
        ],
      },
      {
        name: 'release', fromBar: 28, toBar: 30, tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            inst.membrane(time, chord.bass + 12, 0.07, 4.2, 0.08);
            inst.tone(time, chord.lead[7], 0.06, 4.5, 'sine', 2400);
          }),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar === 29) inst.tone(time, chord.lead[4], 0.025, 3.2, 'sine', 1800);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const notes = score.leadSetAt(score.arrangementPositionAt(time));
    inst.action(time, notes[Math.min(notes.length - 1, lockCount + 1)], 0.045 + lockCount * 0.008, 0.2, 'sine', 3900);
  });
  bus.on('unlock', () => {
    const context = runtime.context();
    if (context) inst.water(context.currentTime, 0.022, 0.08, 1500);
  });
  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.action(time, chord.bass + 24, 0.07 + volleySize * 0.011, 0.34, volleySize === 6 ? 'sawtooth' : 'triangle', 4800);
    inst.snap(time, 0.035 + volleySize * 0.01, 0.055);
  });
  bus.on('hit', ({ lethal, stageCompleted, hitStageIndex }) => {
    const context = runtime.context();
    if (!context || lethal) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.action(time, chord.bass + 12 + hitStageIndex * 4, stageCompleted ? 0.1 : 0.045, stageCompleted ? 0.42 : 0.18, stageCompleted ? 'triangle' : 'square', 3200 + hitStageIndex * 700);
  });
  bus.on('kill', () => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    inst.action(kill.time, kill.midi, 0.105, 0.5, 'triangle', 4400);
    inst.snap(kill.time, 0.038, 0.045);
  });
  bus.on('miss', () => {
    const context = runtime.context();
    if (!context) return;
    const chord = score.chordAt(score.arrangementPositionAt(context.currentTime));
    inst.action(context.currentTime, chord.bass - 1, 0.055, 0.36, 'square', 1200);
  });
  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    inst.snap(context.currentTime, 0.14, 0.14);
    inst.action(context.currentTime + 0.015, 49, 0.05, 0.16, 'square', 900);
  });
  bus.on('playerhit', () => {
    const context = runtime.context();
    if (!context) return;
    inst.snap(context.currentTime, 0.19, 0.28);
    inst.action(context.currentTime, 35, 0.1, 0.62, 'sawtooth', 1100);
  });
  bus.on('bossphase', ({ phase }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    if (phase === 'summoned') {
      inst.membrane(time, 37, 0.16, 1.6, 0.9);
    } else if (phase === 'exposed') {
      inst.snap(time, 0.2, 0.24);
      inst.action(time, 73, 0.12, 0.8, 'triangle', 5200);
    } else {
      runtime.mix()?.duckAt(context.currentTime, 0.2, 1.4);
      inst.action(time, 74, 0.12, 2.6, 'sine', 2600);
      inst.action(time + STEP * 2, 81, 0.08, 3.2, 'sine', 2200);
      inst.action(time + STEP * 4, 86, 0.06, 4, 'sine', 1800);
    }
  });

  return runtime;
}
