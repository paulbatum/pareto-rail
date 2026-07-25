import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  defineInstruments,
  playNoiseHit,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import { thermalState } from './thermal-state';
import {
  THERMAL_INK_SXOM_ARRANGEMENT_SECTIONS,
  THERMAL_INK_SXOM_BPM,
  THERMAL_INK_SXOM_RUN_DURATION,
  THERMAL_INK_SXOM_SCORE_SECTIONS,
  THERMAL_INK_SXOM_STEPS_PER_BAR,
  THERMAL_INK_SXOM_TIME,
  type ThermalInkSection,
} from './timing';

type ThermalChord = {
  bass: number;
  lead: readonly number[];
};

const CHORDS: readonly ThermalChord[] = [
  { bass: 26, lead: [62, 65, 69, 72, 74, 77, 81, 84] }, // D minor
  { bass: 29, lead: [60, 65, 69, 72, 77, 81, 84, 89] }, // F major / D
  { bass: 24, lead: [60, 63, 67, 70, 72, 75, 79, 82] }, // C minor
  { bass: 31, lead: [62, 67, 70, 74, 79, 82, 86, 91] }, // G suspended
  { bass: 34, lead: [62, 65, 70, 74, 77, 82, 86, 89] }, // Bb / D
  { bass: 25, lead: [61, 64, 69, 73, 76, 81, 85, 88] }, // final chromatic heat
] as const;

const KILL_LANES: Record<ThermalInkSection, readonly number[]> = {
  sighting: [
    0, 1, 2, 1, 3, 2, 1, 0,
    2, 3, 4, 3, 2, 1, 2, 3,
  ],
  'first-ink': [
    4, 5, 6, 5, 7, 6, 5, 4,
    6, 7, 5, 6, 4, 5, 3, 4,
  ],
  'cable-yard': [
    0, 3, 1, 4, 2, 5, 3, 6,
    4, 7, 5, 3, 6, 4, 2, 1,
  ],
  'drowned-slip': [
    2, 4, 3, 5, 4, 6, 5, 7,
    6, 4, 5, 3, 4, 2, 3, 1,
  ],
  'core-break': [
    1, 5, 2, 6, 3, 7, 4, 6,
    5, 7, 4, 6, 3, 5, 2, 4,
  ],
  'final-ink': [
    7, 6, 5, 7, 4, 6, 3, 5,
    2, 4, 1, 3, 0, 2, 5, 7,
  ],
};

const BASS_PATTERN = [0, 0, 7, 0, 12, 7, 0, 10, 0, 7, 12, 0, 15, 12, 7, 3] as const;
const HAUNTING_MELODY = [
  0, -1, -1, -1, 2, -1, -1, -1,
  1, -1, -1, -1, 4, -1, -1, -1,
  3, -1, -1, -1, 2, -1, -1, -1,
  5, -1, -1, -1, 1, -1, -1, -1,
] as const;

const STEP_SECONDS = THERMAL_INK_SXOM_TIME.stepSeconds;
const STEPS_PER_BAR = THERMAL_INK_SXOM_STEPS_PER_BAR;

export function createAudio(bus: EventBus) {
  return createThermalInkAudio(bus).audio;
}

export const traceThermalInkAudio = createAudioTraceHarness({
  level: 'thermal-ink-sxom',
  bpm: THERMAL_INK_SXOM_BPM,
  stepSeconds: STEP_SECONDS,
  defaultSeconds: THERMAL_INK_SXOM_RUN_DURATION,
  createAudio: createThermalInkAudio,
});

function createThermalInkAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<ThermalChord, ThermalInkSection>({
    bpm: THERMAL_INK_SXOM_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 1,
    sections: THERMAL_INK_SXOM_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  let lastInfrared = false;
  let coreId = -1;

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    bpm: THERMAL_INK_SXOM_BPM,
    stepSeconds: STEP_SECONDS,
    stepsPerBar: STEPS_PER_BAR,
    score,
    scheduleAhead: 0.16,
    schedulerMs: 24,
    volumeScale: 0.78,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -20, knee: 8, ratio: 5.5, attack: 0.006, release: 0.25 },
      delay: {
        maxTime: 1.8,
        time: STEP_SECONDS * 5,
        feedback: 0.31,
        dampHz: 1850,
        sendGain: 0.34,
        returnTo: 'duck',
      },
      reverb: { seconds: 2.8, decay: 2.4, level: 0.14, returnTo: 'duck' },
      noiseSeconds: 2.5,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      lastInfrared = false;
      coreId = -1;
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const chord = score.chordAt(score.arrangementPositionAt(context.currentTime));
      inst.melody(context.currentTime + 0.04, chord.lead[0], 0.12, 2.4, false);
      inst.sub(context.currentTime + 0.04, chord.bass, 0.16, 1.8);
    },
  });

  const bassVoice = voice<{ velocity: number; cutoff: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.7 },
      { type: 'square', octave: -1, gain: 0.22 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 1.6,
      frequencyAutomation: (time, { cutoff, duration }) => [
        { type: 'set', value: cutoff * 1.65, time },
        { type: 'exponentialRamp', value: Math.max(90, cutoff * 0.28), time: time + duration * 0.82 },
      ],
    },
    gainAutomation: (time, _gain, { velocity, duration }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const melodyVoice = voice<{ velocity: number; duration: number; infrared: boolean }>({
    oscillators: [
      { type: ({ infrared }) => infrared ? 'square' : 'triangle', gain: ({ infrared }) => infrared ? 0.46 : 0.64 },
      { type: 'sine', octave: 1, gain: ({ infrared }) => infrared ? 0.28 : 0.16 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      Q: 1.2,
      cutoff: ({ infrared }) => infrared ? 5600 : 1850,
    },
    gainAutomation: (time, _gain, { velocity, duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: velocity, time: time + Math.min(0.035, duration * 0.12) },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const sensorVoice = voice<{ velocity: number; infrared: boolean; duration: number }>({
    oscillators: [{ type: ({ infrared }) => infrared ? 'square' : 'sine', gain: 0.8 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.025,
    filter: { type: 'bandpass', Q: 3.4, cutoff: ({ infrared }) => infrared ? 5200 : 2400 },
    gainAutomation: (time, _gain, { velocity, duration }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    kick(context, time, velocity) {
      const destination = runtime.mix()?.music;
      if (!destination) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.32,
        oscillatorType: 'sine',
        frequency: 44,
        frequencyAutomation: [
          { type: 'set', value: 112, time },
          { type: 'exponentialRamp', value: 37, time: time + 0.17 },
        ],
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
        ],
        destination,
      });
    },
    sub(context, time, midi, velocity, duration) {
      const destination = runtime.mix()?.music;
      if (!destination) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.04,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination,
      });
    },
    bass(context, time, midi, velocity, cutoff, duration) {
      const mix = runtime.mix();
      if (!mix?.music) return;
      bassVoice.play({
        context,
        time,
        midi,
        velocity,
        cutoff,
        duration,
        destination: mix.music,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.12 }] : undefined,
      });
    },
    metal(context, time, velocity, frequency, decay) {
      const mix = runtime.mix();
      if (!mix?.music || !mix.noiseBuffer) return;
      playNoiseHit({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay,
        filterType: 'bandpass',
        frequency,
        destination: mix.music,
        offset: (time * 0.731) % 1.7,
      });
    },
    sfxMetal(context, time, velocity, frequency, decay) {
      const mix = runtime.mix();
      if (!mix?.sfx || !mix.noiseBuffer) return;
      playNoiseHit({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay,
        filterType: 'bandpass',
        frequency,
        destination: mix.sfx,
        offset: (time * 1.137) % 1.9,
      });
    },
    melody(context, time, midi, velocity, duration, infrared) {
      const mix = runtime.mix();
      if (!mix?.music) return;
      melodyVoice.play({
        context,
        time,
        midi,
        velocity,
        duration,
        infrared,
        destination: mix.music,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: infrared ? 0.48 : 0.3 }] : undefined,
      });
    },
    sensor(context, time, midi, velocity, infrared, duration) {
      const mix = runtime.mix();
      if (!mix?.sfx) return;
      sensorVoice.play({
        context,
        time,
        midi,
        velocity,
        infrared,
        duration,
        destination: mix.sfx,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: infrared ? 0.42 : 0.18 }] : undefined,
      });
    },
    pressure(context, time, velocity, frequency, duration) {
      const destination = runtime.mix()?.sfx;
      if (!destination) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.03,
        oscillatorType: 'sawtooth',
        frequency,
        frequencyAutomation: [
          { type: 'set', value: frequency * 1.7, time },
          { type: 'exponentialRamp', value: Math.max(28, frequency * 0.42), time: time + duration },
        ],
        filter: { type: 'lowpass', frequency: 1600, Q: 2.4 },
        gainAutomation: [
          { type: 'set', value: velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination,
      });
    },
  });

  const ambientArrangement = createArrangement<ThermalChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'submerged-idle',
      fromBar: 0,
      tracks: [fn(({ time, step, bar, chord }) => {
        if (step === 0) inst.sub(time, chord.bass, 0.075, STEP_SECONDS * 7.5);
        if (step === 0 || step === 10) {
          const note = chord.lead[(bar + (step === 10 ? 2 : 0)) % 4];
          inst.melody(time, note, 0.055, STEP_SECONDS * 5.5, false);
        }
        if (step === 12 && bar % 2 === 1) inst.metal(time, 0.03, 2300, 0.18);
      })],
    }],
  });

  const runTrack = fn<ThermalChord>(({ time, step, bar, chord, section }) => {
    const state = thermalState();
    const infrared = state.infrared;
    const ink = state.inkDensity;
    const sectionLift = section.name === 'core-break' ? 1.14 : section.name === 'final-ink' ? 1.27 : 1;
    const percussionFalloff = infrared ? 0.18 : 1;

    if (step === 0 || step === 8) {
      inst.kick(time, (step === 0 ? 0.3 : 0.21) * sectionLift * (infrared ? 0.58 : 1));
    }
    if (step === 0) inst.sub(time, chord.bass, 0.12 * sectionLift, STEP_SECONDS * 8.5);

    if ([0, 3, 6, 10, 13].includes(step)) {
      const offset = BASS_PATTERN[(bar * 5 + step) % BASS_PATTERN.length];
      inst.bass(
        time,
        chord.bass + offset,
        (0.12 + (step === 0 ? 0.045 : 0)) * sectionLift * (infrared ? 0.68 : 1),
        infrared ? 680 : 920 + ink * 260,
        STEP_SECONDS * (step === 13 ? 2.2 : 2.7),
      );
    }

    if (step === 4 || step === 12) {
      inst.metal(time, 0.105 * percussionFalloff * sectionLift, step === 4 ? 2100 : 3400, step === 4 ? 0.16 : 0.1);
    }
    if ((bar >= 8 && step === 15) || (bar >= 18 && (step === 7 || step === 14))) {
      inst.metal(time, 0.065 * percussionFalloff, 5200, 0.045);
    }

    const melodyIndex = (bar * STEPS_PER_BAR + step) % HAUNTING_MELODY.length;
    const degree = HAUNTING_MELODY[melodyIndex];
    if (degree >= 0) {
      const note = chord.lead[degree % chord.lead.length] + (infrared ? 12 : 0);
      const velocity = infrared ? 0.14 : 0.085;
      inst.melody(time, note, velocity * sectionLift, STEP_SECONDS * (infrared ? 2.4 : 4.6), infrared);
    }
  });

  const runArrangement = createArrangement<ThermalChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: THERMAL_INK_SXOM_ARRANGEMENT_SECTIONS.map((section) => ({
      name: section.name,
      fromBar: section.fromBar,
      toBar: section.toBar,
      tracks: [runTrack],
    })),
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      ambientArrangement.schedule(position, time);
      return;
    }
    const infrared = thermalState().infrared;
    if (infrared !== lastInfrared) {
      const chord = score.chordAt(position);
      inst.sensor(time, chord.lead[infrared ? 6 : 1], 0.12, infrared, 0.32);
      lastInfrared = infrared;
    }
    runArrangement.schedule(position, time);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'core') coreId = enemyId;
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const infrared = thermalState().infrared;
    const midi = (lead[Math.min(lead.length - 1, lockCount)] ?? lead[0]) + (infrared ? 12 : 0);
    inst.sensor(time, midi, 0.052 + lockCount * 0.009, infrared, 0.09);
  });

  bus.on('unlock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const position = score.arrangementPositionAt(context.currentTime);
    const chord = score.chordAt(position);
    inst.sensor(context.currentTime, chord.lead[0] - 12 - lockCount, 0.035, thermalState().infrared, 0.08);
  });

  bus.on('fire', ({ volleySize, indexInVolley }) => {
    if ((indexInVolley ?? 0) > 0) return;
    const context = runtime.context();
    const mix = runtime.mix();
    if (!context || !mix) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.pressure(time, 0.13 + volleySize * 0.018, midiToFreq(chord.bass + 12), 0.14 + volleySize * 0.012);
    inst.sfxMetal(time + 0.012, 0.08 + volleySize * 0.008, 1300 + volleySize * 180, 0.06);
    mix.duckAt(time, volleySize === 6 ? 0.68 : 0.82, volleySize === 6 ? 0.22 : 0.1);
  });

  bus.on('hit', ({ lethal, hitStageIndex, hitStageCount, indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    const note = score.nextKill(context.currentTime);
    const infrared = thermalState().infrared;
    const stageLift = hitStageCount > 1 ? Math.round(hitStageIndex / Math.max(1, hitStageCount - 1)) * 12 : 0;
    inst.sensor(
      note.time,
      note.midi + stageLift + (infrared ? 12 : 0) + ((indexInVolley ?? 0) >= 4 ? 12 : 0),
      lethal ? 0.14 : 0.09,
      infrared,
      lethal ? 0.36 : 0.2,
    );
    inst.sfxMetal(note.time + 0.008, lethal ? 0.12 : 0.065, lethal ? 3300 : 2100, lethal ? 0.1 : 0.055);
  });

  bus.on('stage', ({ stageIndex }) => {
    const context = runtime.context();
    if (!context) return;
    const position = score.arrangementPositionAt(context.currentTime);
    const chord = score.chordAt(position);
    const time = score.quantizePlayerAction(context.currentTime);
    inst.pressure(time, 0.16 + stageIndex * 0.035, midiToFreq(chord.bass + 5 + stageIndex * 7), 0.42);
    inst.melody(time + STEP_SECONDS, chord.lead[6] + stageIndex * 12, 0.15, 0.7, true);
  });

  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    const mix = runtime.mix();
    if (!context || !mix) return;
    inst.sfxMetal(context.currentTime, enemyId === coreId ? 0.24 : 0.14, enemyId === coreId ? 620 : 2800, enemyId === coreId ? 0.72 : 0.14);
    if (enemyId === coreId) {
      mix.duckAt(context.currentTime, 0.22, 1.15);
      const chord = score.chordAt(score.arrangementPositionAt(context.currentTime));
      [7, 5, 3, 0].forEach((degree, index) => {
        inst.melody(
          context.currentTime + index * STEP_SECONDS * 2,
          chord.lead[degree],
          0.18 - index * 0.02,
          1.4,
          true,
        );
      });
      inst.sub(context.currentTime, chord.bass - 12, 0.2, 2.8);
    }
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    const now = context.currentTime;
    inst.pressure(now, 0.15, 68, 0.26);
    inst.sfxMetal(now + 0.018, 0.15, 720, 0.13);
  });

  bus.on('miss', () => {
    const context = runtime.context();
    if (!context) return;
    const chord = score.chordAt(score.arrangementPositionAt(context.currentTime));
    inst.pressure(context.currentTime, 0.075, midiToFreq(chord.bass - 5), 0.3);
  });

  bus.on('playerhit', () => {
    const context = runtime.context();
    const mix = runtime.mix();
    if (!context || !mix) return;
    inst.pressure(context.currentTime, 0.2, 52, 0.42);
    inst.sfxMetal(context.currentTime, 0.18, 480, 0.2);
    mix.duckAt(context.currentTime, 0.48, 0.38);
  });

  return runtime;
}
