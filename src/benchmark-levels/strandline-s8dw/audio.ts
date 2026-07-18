import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createStrandlineVoices } from './audio-voices';
import {
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
  type StrandlineSection,
} from './timing';

type Chord = { bass: number; lead: readonly number[] };

// D dorian drifts into a clear D major sonority only after the animal is free.
const CHORDS: readonly Chord[] = [
  { bass: 38, lead: [62, 64, 65, 69, 72, 74, 76, 77] },
  { bass: 41, lead: [60, 64, 65, 67, 69, 72, 76, 77] },
  { bass: 36, lead: [60, 62, 64, 67, 69, 72, 74, 76] },
  { bass: 43, lead: [62, 65, 67, 69, 72, 74, 77, 79] },
] as const;

const KILL_LANES: Record<StrandlineSection, readonly number[]> = {
  firstLight: [2, 3, 4, 2, 5, 4, 3, 6, 2, 4, 5, 3, 6, 4, 2, 5],
  stirring: [3, 4, 5, 6, 4, 5, 7, 6, 3, 5, 4, 6, 7, 5, 4, 2],
  moonReveal: [4, 5, 6, 7, 6, 5, 4, 3, 5, 7, 6, 4, 5, 3, 2, 4],
  deepStrands: [3, 5, 4, 6, 5, 7, 6, 4, 3, 6, 5, 7, 4, 6, 5, 3],
  crown: [2, 4, 3, 5, 2, 5, 4, 6, 3, 5, 4, 2, 6, 5, 3, 4],
  exposed: [4, 5, 6, 7, 5, 6, 7, 6, 4, 7, 6, 5, 7, 5, 4, 3],
  release: [2, 4, 5, 7, 6, 5, 4, 2, 3, 5, 6, 7, 6, 4, 3, 2],
};

const STEP = STRANDLINE_TIME.stepSeconds;

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-s8dw',
  bpm: STRANDLINE_BPM,
  stepSeconds: STEP,
  defaultSeconds: STRANDLINE_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, StrandlineSection>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STRANDLINE_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: STRANDLINE_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  let parentKilled = false;
  let broods = 0;
  let restoration = 0;
  const enemyKinds = new Map<number, string>();

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: STRANDLINE_BPM,
    stepsPerBar: STRANDLINE_STEPS_PER_BAR,
    stepSeconds: STEP,
    runAlignment: 'step',
    beatNumber: 'position',
    volumeScale: 0.72,
    scheduleAhead: 0.18,
    schedulerMs: 25,
    mix: {
      compressor: { threshold: -19, ratio: 4.5, attack: 0.008, release: 0.32 },
      delay: { maxTime: 1.4, time: STEP * 3, feedback: 0.31, dampHz: 4200, sendGain: 0.34 },
      reverb: { seconds: 3.2, decay: 3.7, level: 0.32 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      parentKilled = false;
      broods = 0;
      restoration = 0;
      enemyKinds.clear();
    },
  });

  const voices = createStrandlineVoices({ trace, context: runtime.context, mix: runtime.mix });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STRANDLINE_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'drift',
      fromBar: 0,
      tracks: [fn(({ time, step, chord }) => {
        if (step === 0) voices.pad(time, chord.bass + 12, 0.04, STEP * 15, 0.18);
        if (step === 8) voices.shimmer(time, chord.lead[2], 0.018, STEP * 6, 0.12);
      })],
    }],
  });

  const runTrack = fn<Chord>(({ time, step, bar, chord, section }) => {
    const progress = Math.min(1, bar / STRANDLINE_BARS.end);
    const light = Math.min(1, progress * 0.78 + restoration * 0.22);
    const crown = section.name === 'the-crown' || section.name === 'parent-exposed';
    const release = section.name === 'released';

    if (step === 0 && (!release || parentKilled)) {
      const root = release ? 38 : chord.bass;
      voices.pad(time, root + 12, 0.062 + light * 0.032, release ? STEP * 24 : STEP * 15, release ? 1 : light);
      voices.pulse(time, root - 12, release ? 0.055 : 0.11 + light * 0.025, STEP * 3, light);
      voices.current(time, release ? 0.035 : 0.016 + light * 0.014, release ? 1900 : 720 + light * 1500, release ? 2.4 : 1.1 + light * 0.45);
    }
    if (bar === STRANDLINE_BARS.moonReveal && step === 0) voices.current(time, 0.085, 3200, 2.8);
    if (!release && step % (bar < STRANDLINE_BARS.stirring ? 8 : 4) === 0) {
      voices.pulse(time, chord.bass, 0.045 + light * 0.04, STEP * (bar < 6 ? 2.8 : 1.8), light);
    }
    if (bar >= STRANDLINE_BARS.stirring && !release && step % 4 === 2) {
      voices.shimmer(time, chord.lead[(step / 2 + bar) % chord.lead.length], 0.025 + light * 0.026, STEP * 2.2, light);
    }
    if (bar >= STRANDLINE_BARS.moonReveal && bar < STRANDLINE_BARS.crown && step % 2 === 1) {
      const index = (step * 3 + bar) % chord.lead.length;
      voices.shimmer(time, chord.lead[index] + 12, 0.014 + light * 0.018, STEP * 1.2, light);
    }
    if (bar >= STRANDLINE_BARS.deepStrands && !release && step % 4 === 0) {
      voices.pulse(time, chord.bass - 12, 0.08, STEP * 1.4, light);
    }
    if (crown && step % 4 === 2) {
      voices.parasite(time, 43 + (bar + step) % 5, 0.096 - broods * 0.014, STEP * 1.8, Math.max(0.14, 0.48 - broods * 0.09));
      if (broods > 0) voices.shimmer(time, chord.lead[Math.min(chord.lead.length - 1, 3 + broods)], 0.018 + broods * 0.01, STEP * 2.4, 0.65 + broods * 0.1);
    }
    if (release && !parentKilled && (step === 0 || step === 8)) {
      voices.parasite(time, 31 + (step === 8 ? 1 : 0), 0.12, STEP * 5, 0.22);
      voices.pulse(time, 26, 0.1, STEP * 4, 0.08);
    }
    if (release && parentKilled && bar === STRANDLINE_BARS.release && step === 0) {
      voices.release(time, 62, 0.24, STEP * 28);
      voices.release(time + STEP * 4, 66, 0.16, STEP * 23);
      voices.release(time + STEP * 8, 69, 0.14, STEP * 18);
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STRANDLINE_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'first-light', fromBar: 0, toBar: 6, tracks: [runTrack] },
      { name: 'stirring', fromBar: 6, toBar: 12, tracks: [runTrack] },
      { name: 'green-moon', fromBar: 12, toBar: 16, tracks: [runTrack] },
      { name: 'deep-strands', fromBar: 16, toBar: 22, tracks: [runTrack] },
      { name: 'the-crown', fromBar: 22, toBar: 28, tracks: [runTrack] },
      { name: 'parent-exposed', fromBar: 28, toBar: 30, tracks: [runTrack] },
      { name: 'released', fromBar: 30, toBar: 32, tracks: [runTrack] },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
    if (kind === 'venom') {
      const context = runtime.context();
      if (context) {
        voices.parasite(context.currentTime, 70, 0.055, 0.16, 0.9);
        voices.wash(context.currentTime, 0.032, 7200, 0.07);
      }
      return;
    }
    if (kind !== 'brood' && kind !== 'parent') return;
    const context = runtime.context();
    if (!context) return;
    voices.parasite(context.currentTime, kind === 'parent' ? 31 : 43 + broods * 2, kind === 'parent' ? 0.16 : 0.1, kind === 'parent' ? 0.9 : 0.38, 0.65);
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    voices.player(time, lead[Math.min(lead.length - 1, lockCount + 1)], 0.048 + lockCount * 0.006, 0.12, lockCount / 6);
  });

  bus.on('unlock', () => {
    const context = runtime.context();
    if (context) voices.player(context.currentTime, 55, 0.035, 0.1, 0.15);
  });

  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.player(time, chord.bass + 24, 0.09 + volleySize * 0.012, 0.18 + volleySize * 0.025, 0.42 + volleySize / 10);
    voices.wash(time, 0.026 + volleySize * 0.01, 2600 + volleySize * 450, 0.06 + volleySize * 0.008);
    if (volleySize === 6) {
      voices.player(time + STEP, chord.bass + 31, 0.1, 0.24, 0.9);
      voices.player(time + STEP * 2, chord.bass + 36, 0.085, 0.3, 1);
      voices.current(time, 0.07, 2800, 0.65);
    }
  });

  bus.on('hit', ({ enemyId, lethal, hitStageIndex, hitStageCount }) => {
    const context = runtime.context();
    if (!context) return;
    const kind = enemyKinds.get(enemyId);
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const stage = hitStageCount > 1 ? hitStageIndex / hitStageCount : 0;
    voices.player(time, chord.bass + 31 + Math.round(stage * 9), lethal ? 0.095 : 0.06, 0.13, lethal ? 0.8 : 0.45);
    if (kind === 'parent' || kind === 'brood') voices.parasite(time, 48 + hitStageIndex * 3, 0.09, 0.2, 0.9);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (enemyKinds.get(enemyId) !== 'parent') return;
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    runtime.mix()?.duckAt(time, 0.24, 0.32);
    voices.player(time, 62 + stageIndex * 5, 0.14, 0.3, 0.86);
    voices.player(time + STEP * 2, 69 + stageIndex * 4, 0.1, 0.34, 0.95);
    voices.wash(time, 0.12, 1100 + stageIndex * 1500, 0.3);
  });

  bus.on('kill', ({ enemyId, indexInVolley = 0 }) => {
    const context = runtime.context();
    if (!context) return;
    const kind = enemyKinds.get(enemyId);
    const kill = score.nextKill(context.currentTime + indexInVolley * STEP);
    voices.player(kill.time, kill.midi, kind === 'parent' ? 0.19 : 0.105, kind === 'parent' ? 0.58 : 0.22, kind === 'parent' ? 1 : 0.75);
    voices.wash(kill.time, kind === 'parent' ? 0.21 : 0.065, kind === 'parent' ? 520 : 6400, kind === 'parent' ? 0.75 : 0.12);
    if (kind === 'brood') broods += 1;
    if (kind && kind !== 'venom') restoration = Math.min(1, restoration + (kind === 'brood' ? 0.08 : kind === 'parent' ? 0.18 : 0.022));
    if (kind === 'parent') {
      parentKilled = true;
      voices.release(kill.time + STEP * 2, 50, 0.32, STEP * 9);
    }
    enemyKinds.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    const context = runtime.context();
    if (context) {
      voices.parasite(context.currentTime, 38, 0.04, 0.24, 0.15);
      voices.wash(context.currentTime, 0.035, 680, 0.18);
    }
    enemyKinds.delete(enemyId);
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    voices.parasite(context.currentTime, 46, 0.09, 0.18, 0.3);
    voices.parasite(context.currentTime + 0.06, 43, 0.075, 0.2, 0.2);
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    voices.parasite(context.currentTime, 31 + healthRemaining, 0.18, 0.44, 0.8);
    voices.wash(context.currentTime, 0.16, 420, 0.34);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size !== 6 || kills !== 6) return;
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    voices.shimmer(time, lead[3], 0.09, STEP * 4, 0.9);
    voices.shimmer(time + STEP * 2, lead[6], 0.075, STEP * 6, 1);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'exposed') return;
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    runtime.mix()?.duckAt(time, 0.18, 0.5);
    voices.release(time, 50, 0.2, STEP * 5);
    voices.shimmer(time + STEP, 74, 0.12, STEP * 5, 1);
    voices.shimmer(time + STEP * 3, 81, 0.1, STEP * 5, 1);
  });

  return runtime;
}
