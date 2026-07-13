import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createMassDriverVoices } from './audio-voices';
import {
  MASS_DRIVER_9281_BARS,
  MASS_DRIVER_9281_BPM,
  MASS_DRIVER_9281_RUN_DURATION,
  MASS_DRIVER_9281_SCORE_SECTIONS,
  MASS_DRIVER_9281_STEPS_PER_BAR,
  MASS_DRIVER_9281_TIME,
  type MassDriverSection,
} from './timing';

type Chord = { bass: number; lead: readonly number[] };

const CHORDS: readonly Chord[] = [
  { bass: 30, lead: [54, 57, 59, 61, 62, 66, 69, 71] },
  { bass: 31, lead: [55, 58, 60, 62, 63, 67, 70, 72] },
  { bass: 33, lead: [57, 60, 62, 64, 66, 69, 72, 74] },
  { bass: 35, lead: [59, 62, 64, 66, 67, 71, 74, 76] },
] as const;

const KILL_LANES: Record<MassDriverSection, readonly number[]> = {
  injection: [2, 3, 4, 2, 5, 4, 3, 6, 2, 4, 5, 7, 6, 4, 3, 5],
  phaseLock: [3, 4, 5, 6, 4, 5, 7, 6, 3, 5, 4, 6, 7, 5, 4, 2],
  overdrive: [4, 5, 6, 7, 5, 6, 4, 7, 3, 6, 5, 7, 4, 6, 5, 3],
  critical: [2, 4, 3, 5, 4, 6, 5, 7, 3, 5, 4, 6, 5, 7, 6, 4],
  muzzle: [7, 6, 5, 4, 3, 2, 4, 5, 7, 6, 4, 3, 5, 7, 6, 2],
};

const SIXTEENTH = MASS_DRIVER_9281_TIME.stepSeconds;

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-9281',
  bpm: MASS_DRIVER_9281_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_9281_RUN_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, MassDriverSection>({
    bpm: MASS_DRIVER_9281_BPM,
    stepsPerBar: MASS_DRIVER_9281_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: MASS_DRIVER_9281_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  let interlocksCleared = 0;
  let deadlineFailed = false;
  let successDischargeScheduled = false;
  const interlockIds = new Set<number>();
  const enemyKinds = new Map<number, string>();

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: MASS_DRIVER_9281_BPM,
    stepsPerBar: MASS_DRIVER_9281_STEPS_PER_BAR,
    stepSeconds: SIXTEENTH,
    runAlignment: 'step',
    beatNumber: 'position',
    volumeScale: 0.76,
    scheduleAhead: 0.18,
    schedulerMs: 25,
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.004, release: 0.25 },
      delay: { maxTime: 1.2, time: SIXTEENTH * 3, feedback: 0.28, dampHz: 3800, sendGain: 0.32 },
      reverb: { seconds: 2.1, decay: 2.8, level: 0.24 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlocksCleared = 0;
      deadlineFailed = false;
      successDischargeScheduled = false;
      interlockIds.clear();
      enemyKinds.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const success = interlocksCleared === 4 && !deadlineFailed;
      // A clean launch has already discharged at bar 30 and ends in vacuum
      // silence. Failure alone gets the final containment blast.
      if (!success) voices.discharge(context.currentTime + 0.04, 29, 0.52, 2.2, false);
    },
  });

  const voices = createMassDriverVoices({ trace, context: runtime.context, mix: runtime.mix });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: MASS_DRIVER_9281_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'standby',
      fromBar: 0,
      tracks: [fn(({ time, step, chord }) => {
        if (step === 0) voices.coil(time, chord.bass, 0.055, 1.9, 0.08);
        if (step === 8) voices.pulse(time, chord.bass + 24, 0.025, 0.05);
      })],
    }],
  });

  const runTrack = fn<Chord>(({ time, step, bar, chord, section }) => {
    const progress = Math.min(1, bar / MASS_DRIVER_9281_BARS.end);
    const critical = section.name === 'critical-charge';
    const muzzle = section.name === 'muzzle';

    // One pitched coil impulse on every beat: the tunnel and score share a clock.
    if (step % 4 === 0 && !muzzle) {
      const beat = step / 4;
      // The gun voice never falls with the chord cycle: it climbs a little
      // more than twenty-two semitones from breech to muzzle.
      voices.coil(time, 30 + progress * 22 + beat * 0.12, 0.105 + progress * 0.055, 0.54, progress);
      voices.pulse(time, 72 + beat + Math.floor(progress * 9), 0.022 + progress * 0.02, progress);
    }
    if ((step === 0 || (bar >= MASS_DRIVER_9281_BARS.phaseLock && step === 8)) && !muzzle) {
      voices.bass(time, chord.bass - 12 + Math.floor(progress * 5), 0.15 + progress * 0.07, 0.7);
    }
    if (bar >= MASS_DRIVER_9281_BARS.overdrive && step % 2 === 1 && !muzzle) {
      voices.pulse(time, 84 + (step % 5), 0.012 + progress * 0.018, progress);
    }
    if (critical && step % 4 === 2) {
      voices.crack(time, 0.018 + progress * 0.035, 4300 + step * 260, 0.025);
    }
    if (muzzle && bar === MASS_DRIVER_9281_BARS.muzzle && step === 2 && !successDischargeScheduled) {
      deadlineFailed = true;
      voices.discharge(time, 29, 0.46, 1.6, false);
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: MASS_DRIVER_9281_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'injection', fromBar: 0, toBar: 6, tracks: [runTrack] },
      { name: 'phase-lock', fromBar: 6, toBar: 14, tracks: [runTrack] },
      { name: 'overdrive', fromBar: 14, toBar: 24, tracks: [runTrack] },
      { name: 'critical-charge', fromBar: 24, toBar: 30, tracks: [runTrack] },
      { name: 'muzzle', fromBar: 30, toBar: 32, tracks: [runTrack] },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
    if (kind === 'interlock') interlockIds.add(enemyId);
    if (kind === 'bolt') {
      const context = runtime.context();
      if (context) {
        voices.player(context.currentTime, 79, 0.075, 0.16, 0.95);
        voices.crack(context.currentTime, 0.075, 6400, 0.055);
      }
    }
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    voices.player(time, lead[Math.min(lead.length - 1, lockCount + 1)], 0.07, 0.14, lockCount / 6);
  });

  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.player(time, chord.bass + 24, 0.11 + volleySize * 0.012, 0.25, 0.55 + volleySize / 12);
    if (volleySize === 6) voices.crack(time, 0.11, 6800, 0.08);
  });

  bus.on('hit', ({ enemyId, hitPointsRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const isInterlock = enemyKinds.get(enemyId) === 'interlock';
    voices.player(time, isInterlock ? 76 + (4 - hitPointsRemaining) * 2 : 69, isInterlock ? 0.13 : 0.065, 0.19, isInterlock ? 1 : 0.65);
    voices.crack(time, isInterlock ? 0.09 : 0.045, isInterlock ? 5200 : 7600, 0.045);
  });

  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    const isInterlock = interlockIds.delete(enemyId);
    const arrangementPosition = score.arrangementPositionAt(context.currentTime);
    if (isInterlock) {
      interlocksCleared += 1;
      if (arrangementPosition >= MASS_DRIVER_9281_BARS.muzzle * MASS_DRIVER_9281_STEPS_PER_BAR) deadlineFailed = true;
    }
    voices.player(kill.time, isInterlock ? 81 + interlocksCleared * 2 : kill.midi, isInterlock ? 0.2 : 0.12, isInterlock ? 0.52 : 0.34, 1);
    voices.crack(kill.time, isInterlock ? 0.15 : 0.07, isInterlock ? 2600 + interlocksCleared * 900 : 8600, isInterlock ? 0.12 : 0.06);
    if (interlocksCleared === 4) {
      voices.player(kill.time + SIXTEENTH, 86, 0.15, 0.28, 1);
      voices.player(kill.time + SIXTEENTH * 2, 90, 0.13, 0.32, 1);
      voices.player(kill.time + SIXTEENTH * 3, 93, 0.12, 0.42, 1);
      if (!deadlineFailed) {
        const muzzleStep = score.arrangementStart + MASS_DRIVER_9281_BARS.muzzle * MASS_DRIVER_9281_STEPS_PER_BAR;
        const muzzleTime = score.epoch + muzzleStep * score.stepSeconds;
        successDischargeScheduled = true;
        voices.discharge(Math.max(muzzleTime, context.currentTime + 0.015), 66, 0.62, 3.2, true);
      }
    }
    enemyKinds.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    voices.player(context.currentTime, 35, 0.055, 0.3, 0.1);
    voices.crack(context.currentTime, 0.045, 520, 0.16);
    interlockIds.delete(enemyId);
    enemyKinds.delete(enemyId);
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime;
    voices.player(time, 42, 0.09, 0.16, 0.2);
    voices.player(time + 0.055, 41, 0.075, 0.18, 0.2);
    voices.crack(time, 0.08, 780, 0.09);
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime;
    voices.player(time, 31 + healthRemaining * 2, 0.18, 0.42, 0.15);
    voices.crack(time, 0.16, 420 + healthRemaining * 170, 0.22);
  });

  return runtime;
}
