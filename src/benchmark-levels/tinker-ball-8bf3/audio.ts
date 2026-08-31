import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  defineInstruments,
  playNoiseHit,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createArrangement, fn } from '../../engine/arrangement';
import { noiseHit, voice } from '../../engine/audio-voices';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import {
  TINKER_BALL_8BF3_BPM,
  TINKER_BALL_8BF3_RUN_DURATION,
  TINKER_BALL_8BF3_TIME,
  TINKER_BALL_8BF3_SECTIONS,
} from './gameplay';

const STEPS_PER_BAR = 16;
const STEP_SECONDS = TINKER_BALL_8BF3_TIME.stepSeconds;

type TinkerSection = typeof TINKER_BALL_8BF3_SECTIONS[number]['name'];
type TinkerChord = {
  bass: number;
  pad: readonly number[];
  lead: readonly number[];
};

// A sunny, slightly wonky I–vi–IV–V loop. Every kill takes its pitch from the
// live chord's lead set, so a clean sweep plays a little workshop melody.
const CHORDS: readonly TinkerChord[] = [
  { bass: 40, pad: [52, 55, 59, 64], lead: [64, 67, 71, 74, 76, 79, 83, 86] },
  { bass: 45, pad: [57, 60, 64, 69], lead: [64, 69, 72, 76, 81, 84, 88, 93] },
  { bass: 43, pad: [55, 59, 62, 67], lead: [62, 67, 71, 74, 79, 83, 86, 91] },
  { bass: 47, pad: [59, 62, 66, 71], lead: [62, 66, 69, 74, 78, 81, 86, 90] },
];

const KILL_LANES: Record<TinkerSection, readonly number[]> = {
  'marble sweep': [0, 2, 4, 3, 5, 4, 2, 6, 7, 5, 3, 4, 1, 2, 5, 6],
  'drawer shuffle': [2, 4, 5, 3, 6, 4, 7, 5, 3, 6, 4, 2, 5, 7, 6, 4],
  'lamp sprint': [4, 6, 5, 7, 3, 5, 6, 4, 7, 5, 3, 6, 4, 2, 5, 7],
  'glue spill': [7, 6, 5, 4, 7, 5, 3, 6, 4, 2, 5, 7, 6, 4, 3, 7],
};

const scoreSections = TINKER_BALL_8BF3_SECTIONS.map((section, index) => ({
  index: section.name,
  fromBar: section.fromBar,
  crossfadeBars: index === 0 ? undefined : 1,
}));

export function createAudio(bus: EventBus) {
  return createTinkerBall8bf3Audio(bus).audio;
}

export const traceTinkerBall8bf3Audio = createAudioTraceHarness({
  level: 'tinker-ball-8bf3',
  bpm: TINKER_BALL_8BF3_BPM,
  stepSeconds: STEP_SECONDS,
  defaultSeconds: TINKER_BALL_8BF3_RUN_DURATION,
  createAudio: createTinkerBall8bf3Audio,
});

function createTinkerBall8bf3Audio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<TinkerChord, TinkerSection>({
    bpm: TINKER_BALL_8BF3_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 1,
    sections: scoreSections,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    bpm: TINKER_BALL_8BF3_BPM,
    stepSeconds: STEP_SECONDS,
    stepsPerBar: STEPS_PER_BAR,
    score,
    scheduleAhead: 0.14,
    schedulerMs: 20,
    volumeScale: 0.78,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -19, ratio: 5, attack: 0.004, release: 0.18 },
      delay: { time: STEP_SECONDS * 3, feedback: 0.24, dampHz: 2100, sendGain: 0.28, returnTo: 'master' },
      reverb: { seconds: 1.15, decay: 2.2, level: 0.12, returnTo: 'master' },
      noiseSeconds: 1.4,
    },
    onBeforeBeat({ bar, time, mode }) {
      if (mode === 'run' && bar % 4 === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunEnd() {
      const context = runtime.context();
      const mix = runtime.mix();
      if (!context || !mix) return;
      const time = context.currentTime + 0.04;
      inst.mallet(time, 76, 0.16, 0.5);
      inst.mallet(time + 0.12, 81, 0.14, 0.55);
      inst.mallet(time + 0.24, 88, 0.18, 0.7);
      mix.duckAt(time, 0.64, 0.42);
    },
  });

  const malletVoice = voice<{ decay: number }>({
    oscillators: [
      { type: 'sine', gain: 0.88 },
      { type: 'triangle', gain: 0.2, midiOffset: 12 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 4700 },
    envelope: { attack: 0.002, decay: ({ decay }) => decay, floor: 0.001 },
  });

  const organVoice = voice<{ duration: number; grit: number }>({
    oscillators: [
      { type: 'square', gain: ({ grit }) => 0.14 + grit * 0.05 },
      { type: 'triangle', gain: 0.2, octave: 1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 1.7,
      frequencyAutomation: (time, { grit }) => [
        { type: 'set', value: 900 + grit * 500, time },
        { type: 'exponentialRamp', value: 260, time: time + 0.16 },
      ],
    },
    envelope: { attack: 0.004, decay: ({ duration }) => duration, floor: 0.001 },
  });

  const bassVoice = voice({
    oscillators: [
      { type: 'sawtooth', gain: 0.26 },
      { type: 'triangle', gain: 0.24, octave: -1 },
    ],
    duration: 0.32,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time) => [
        { type: 'set', value: 1200, time },
        { type: 'exponentialRamp', value: 180, time: time + 0.26 },
      ],
    },
    gainAutomation: (time, gain) => [
      { type: 'set', value: gain * 0.9, time },
      { type: 'linearRamp', value: gain, time: time + 0.012 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
    ],
  });

  const glueNoise = noiseHit({ filterType: 'bandpass', frequency: 1500, decay: 0.07 });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    kick(context, time, velocity) {
      const mix = runtime.mix();
      if (!mix?.music) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.2,
        oscillatorType: 'sine',
        frequency: 132,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 42, time: time + 0.13 }],
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
        ],
        destination: mix.music,
      });
      mix.duckAt(time, 0.7, 0.18);
    },
    bass(context, time, midi, velocity) {
      const mix = runtime.mix();
      if (!mix?.duck) return;
      bassVoice.play({ context, time, midi, velocity, destination: mix.duck });
    },
    mallet(context, time, midi, velocity, decay) {
      const mix = runtime.mix();
      if (!mix?.music) return;
      malletVoice.play({
        context,
        time,
        midi,
        velocity,
        decay,
        destination: mix.music,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.34 }] : undefined,
      });
    },
    organ(context, time, midi, velocity, duration, grit) {
      const mix = runtime.mix();
      if (!mix?.music) return;
      organVoice.play({
        context,
        time,
        midi,
        velocity,
        duration,
        grit,
        destination: mix.music,
      });
    },
    clap(_context, time, velocity) {
      const mix = runtime.mix();
      const context = runtime.context();
      if (!mix?.music || !context || !mix.noiseBuffer) return;
      glueNoise.play({ context, buffer: mix.noiseBuffer, time, velocity, decay: 0.055, destination: mix.music, offset: 0.2 });
      glueNoise.play({ context, buffer: mix.noiseBuffer, time: time + 0.014, velocity: velocity * 0.68, decay: 0.085, frequency: 2200, destination: mix.music, offset: 0.7 });
    },
    shaker(_context, time, velocity, decay) {
      const mix = runtime.mix();
      const context = runtime.context();
      if (!mix?.music || !context || !mix.noiseBuffer) return;
      playNoiseHit({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay,
        filterType: 'highpass',
        frequency: 6200,
        destination: mix.music,
        offset: 0.4,
      });
    },
    woodTap(_context, time, velocity, frequency) {
      const mix = runtime.mix();
      const context = runtime.context();
      if (!mix?.sfx || !context || !mix.noiseBuffer) return;
      playNoiseHit({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay: 0.035,
        filterType: 'bandpass',
        frequency,
        destination: mix.sfx,
        offset: 1.0,
      });
    },
    gluePop(_context, time, velocity, frequency) {
      const mix = runtime.mix();
      const context = runtime.context();
      if (!mix?.sfx || !context || !mix.noiseBuffer) return;
      glueNoise.play({ context, buffer: mix.noiseBuffer, time, velocity, decay: 0.08, frequency, destination: mix.sfx, offset: 0.9 });
    },
  }, {
    kick: ['velocity'],
    bass: ['midi', 'velocity'],
    mallet: ['midi', 'velocity', 'decay'],
    organ: ['midi', 'velocity', 'duration', 'grit'],
    clap: ['velocity'],
    shaker: ['velocity', 'decay'],
    woodTap: ['velocity', 'frequency'],
    gluePop: ['velocity', 'frequency'],
  });

  const ambientArrangement = createArrangement<TinkerChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [fn(({ time, step, chord }) => {
        if (step % 4 === 0) inst.mallet(time, chord.lead[(step / 4) % chord.lead.length]!, 0.038, 0.48);
        if (step === 0) inst.organ(time, chord.bass + 12, 0.025, 0.16, 0.3);
      })],
    }],
  });

  const runArrangement = createArrangement<TinkerChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: TINKER_BALL_8BF3_SECTIONS.map((section) => ({
      name: section.name,
      fromBar: section.fromBar,
      toBar: TINKER_BALL_8BF3_SECTIONS.find((next) => next.fromBar > section.fromBar)?.fromBar,
      tracks: [fn(runStep)],
    })),
  });

  function scheduleStep(step: BeatLevelAudioStep) {
    if (step.mode === 'ambient') ambientArrangement.schedule(step.position, step.time);
    else runArrangement.schedule(step.position, step.time);
  }

  function runStep({ time, step, bar, chord }: { time: number; step: number; bar: number; chord: TinkerChord }) {
    const sectionIndex = Math.min(3, Math.floor(bar / 8));
    const intensity = 0.72 + sectionIndex * 0.1;
    if (step === 0 || step === 8) inst.kick(time, (step === 0 ? 0.32 : 0.22) * intensity);
    if (step === 4 || step === 12) inst.clap(time, 0.14 + sectionIndex * 0.015);
    if (step % 2 === 1) inst.shaker(time, 0.025 + sectionIndex * 0.006, 0.025 + sectionIndex * 0.004);
    if (step === 0 || step === 6 || step === 10 || step === 14) {
      const bassOffsets = [0, 0, 7, 0, 12, 7, 0, 5];
      inst.bass(time, chord.bass + bassOffsets[(bar + step / 2) % bassOffsets.length]!, 0.13 + sectionIndex * 0.018);
    }

    const melodySteps = [2, 7, 10, 14];
    if (melodySteps.includes(step)) {
      const note = chord.lead[(bar * 2 + step / 2 + sectionIndex) % chord.lead.length]!;
      inst.mallet(time, note, 0.045 + sectionIndex * 0.012, sectionIndex >= 2 ? 0.3 : 0.42);
    }
    if (sectionIndex >= 1 && (step === 3 || step === 11)) {
      inst.organ(time, chord.bass + (step === 3 ? 24 : 19), 0.045 + sectionIndex * 0.012, 0.13, 0.35 + sectionIndex * 0.2);
    }
    if (sectionIndex === 3 && step === 15) inst.organ(time, chord.bass + 31, 0.075, 0.2, 0.8);
  }

  function contextTime() {
    const context = runtime.context();
    return context ? { context, time: context.currentTime } : undefined;
  }

  bus.on('lock', ({ lockCount }) => {
    const action = contextTime();
    if (!action) return;
    const position = score.arrangementPositionAt(score.quantizePlayerAction(action.time));
    const lead = score.leadSetAt(position);
    inst.mallet(score.quantizePlayerAction(action.time), lead[(lockCount - 1) % lead.length]!, 0.07 + lockCount * 0.012, 0.18);
  });

  bus.on('unlock', ({ lockCount }) => {
    const action = contextTime();
    if (!action) return;
    inst.woodTap(action.time, 0.025 + Math.min(0.04, lockCount * 0.006), 3600 - Math.min(1600, lockCount * 180));
  });

  bus.on('fire', ({ volleySize }) => {
    const action = contextTime();
    if (!action) return;
    const time = score.quantizePlayerAction(action.time);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    inst.organ(time, chord.bass + 24, 0.07 + volleySize * 0.012, 0.11 + volleySize * 0.012, 0.55);
    if (volleySize >= 4) inst.clap(time, 0.07 + volleySize * 0.012);
    runtime.mix()?.duckAt(time, Math.max(0.62, 0.86 - volleySize * 0.035), 0.12);
  });

  bus.on('hit', ({ lethal, hitStageIndex, hitStageCount }) => {
    const action = contextTime();
    if (!action) return;
    const position = score.arrangementPositionAt(action.time);
    const chord = score.chordAt(position);
    inst.gluePop(action.time, lethal ? 0.14 : 0.085, lethal ? 1250 : 850 + hitStageIndex * 170);
    if (lethal) inst.mallet(score.nextGridTime(action.time), chord.lead[(hitStageIndex + 3) % chord.lead.length]!, 0.105, hitStageCount > 1 ? 0.48 : 0.32);
  });

  bus.on('stage', ({ stageIndex }) => {
    const action = contextTime();
    if (!action) return;
    inst.organ(action.time, 58 + stageIndex * 7, 0.08, 0.16, 0.8);
    inst.woodTap(action.time + 0.025, 0.08, 1200 + stageIndex * 420);
  });

  bus.on('kill', () => {
    const action = contextTime();
    if (!action) return;
    const kill = score.nextKill(action.time);
    inst.mallet(kill.time, kill.midi, 0.13, 0.38);
    inst.woodTap(kill.time + 0.018, 0.055, 3000);
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < 2) return;
    const action = contextTime();
    if (!action) return;
    const time = score.quantizePlayerAction(action.time);
    inst.clap(time, 0.09 + Math.min(0.08, size * 0.01));
    if (size === 6 && kills === 6) inst.organ(time + 0.025, 76, 0.12, 0.2, 1.2);
  });

  bus.on('miss', () => {
    const action = contextTime();
    if (!action) return;
    const position = score.arrangementPositionAt(action.time);
    inst.organ(action.time, score.chordAt(position).bass - 5, 0.085, 0.2, 1.4);
  });

  bus.on('reject', () => {
    const action = contextTime();
    if (!action) return;
    inst.organ(action.time, 39, 0.12, 0.14, 1.8);
    inst.woodTap(action.time + 0.02, 0.11, 540);
  });

  bus.on('playerhit', () => {
    const action = contextTime();
    if (!action) return;
    inst.gluePop(action.time, 0.15, 360);
  });

  return runtime;
}
