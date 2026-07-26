import type { EventBus } from '../../events';
import { createArrangement, fn, oneShot } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createTinkerVoices } from './audio-voices';
import {
  TINKER_BALL_Q1CI_BPM,
  TINKER_BALL_Q1CI_RUN_DURATION,
  TINKER_BALL_Q1CI_RUN_SECTIONS,
  TINKER_BALL_Q1CI_SCORE_SECTIONS,
  TINKER_BALL_Q1CI_STEPS_PER_BAR,
  TINKER_BALL_Q1CI_TIME,
  type TinkerBallSectionName,
} from './timing';

// Bright, slightly lopsided D-major pop: every object hit is pitched from the
// live chord, while the player's kills reveal a written two-bar mallet line.
// The backing deliberately leaves the upper bell register open for that line.
const STEP_SECONDS = TINKER_BALL_Q1CI_TIME.stepSeconds;
const STEPS_PER_BAR = TINKER_BALL_Q1CI_STEPS_PER_BAR;

type TinkerChord = {
  bass: number;
  organ: readonly number[];
  mallet: readonly number[];
};

const CHORDS: readonly TinkerChord[] = [
  { bass: 38, organ: [50, 54, 57, 59], mallet: [74, 78, 81, 83] }, // D6
  { bass: 43, organ: [55, 59, 62, 64], mallet: [74, 79, 83, 86] }, // G6/D
  { bass: 35, organ: [47, 50, 54, 57], mallet: [71, 74, 78, 81] }, // Bm7
  { bass: 45, organ: [52, 57, 61, 64], mallet: [73, 76, 81, 85] }, // A6
];

const KILL_LANES: Record<TinkerBallSectionName, readonly number[]> = {
  'marble-run': [
    0, 1, 2, 1, 3, 2, 1, 0,
    2, 3, 4, 3, 5, 4, 2, 1,
    0, 2, 3, 5, 4, 3, 2, 4,
    5, 6, 7, 6, 5, 3, 2, 1,
  ],
  'spool-parade': [
    0, 4, 2, 5, 1, 4, 3, 6,
    2, 5, 4, 7, 3, 6, 5, 2,
    0, 3, 5, 4, 6, 3, 7, 4,
    2, 5, 1, 4, 3, 6, 7, 5,
  ],
  'heavy-lifting': [
    4, 3, 1, 2, 5, 4, 2, 0,
    3, 5, 6, 4, 2, 3, 1, 0,
    4, 6, 7, 5, 3, 4, 2, 1,
    5, 7, 6, 4, 3, 2, 4, 6,
  ],
  'the-spill': [
    7, 5, 6, 4, 7, 3, 6, 2,
    5, 1, 4, 0, 3, 2, 1, 0,
    4, 2, 5, 3, 6, 4, 7, 5,
    3, 1, 4, 2, 5, 6, 7, 4,
  ],
  'clean-sweep': [
    0, 2, 4, 5, 7, 6, 5, 7,
    4, 5, 6, 7, 5, 6, 7, 6,
    0, 3, 4, 6, 7, 5, 6, 7,
    4, 6, 5, 7, 6, 7, 5, 7,
  ],
};

const LOCK_DEGREES = [0, 1, 2, 3, 4, 5] as const;

export function createAudio(bus: EventBus) {
  return createTinkerAudio(bus).audio;
}

export const traceTinkerBallQ1ciAudio = createAudioTraceHarness({
  level: 'tinker-ball-q1ci',
  bpm: TINKER_BALL_Q1CI_BPM,
  stepSeconds: STEP_SECONDS,
  defaultSeconds: TINKER_BALL_Q1CI_RUN_DURATION,
  createAudio: createTinkerAudio,
});

function createTinkerAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<TinkerChord, TinkerBallSectionName>({
    bpm: TINKER_BALL_Q1CI_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: TINKER_BALL_Q1CI_SCORE_SECTIONS,
    leadSet: (chord) => [...chord.mallet, ...chord.mallet.map((midi) => midi + 12)],
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    bpm: TINKER_BALL_Q1CI_BPM,
    stepSeconds: STEP_SECONDS,
    stepsPerBar: STEPS_PER_BAR,
    score,
    runAlignment: 'bar',
    beatNumber: 'position',
    scheduleAhead: 0.17,
    schedulerMs: 25,
    volumeScale: 0.78,
    mix: {
      compressor: { threshold: -19, knee: 8, ratio: 4.5, attack: 0.006, release: 0.2 },
      delay: {
        time: STEP_SECONDS * 3,
        feedback: 0.27,
        dampHz: 3200,
        sendGain: 0.75,
      },
      reverb: {
        seconds: 1.25,
        decay: 3.2,
        level: 0.13,
      },
      noiseSeconds: 2,
    },
    onBeforeBeat({ mode, step, bar, time }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const at = context.currentTime + 0.06;
      inst.organ(at, [62, 66, 69, 71, 74], 0.13, 1.8, 2800);
      [86, 90, 93, 98].forEach((midi, index) => {
        inst.mallet(at + index * STEP_SECONDS * 2, midi, 0.12 - index * 0.01, 0.8);
      });
    },
  });

  const inst = createTinkerVoices({
    trace,
    context: runtime.context,
    mix: runtime.mix,
  });

  const ambientArrangement = createArrangement<TinkerChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'lamp-lit attract',
      fromBar: 0,
      tracks: [
        fn(({ time, step, chord, bar }) => {
          if (step === 0) inst.organ(time, chord.organ, 0.035, TINKER_BALL_Q1CI_TIME.barSeconds * 1.9, 1650);
          if (step % 4 === 0) {
            const order = [0, 2, 1, 3];
            inst.mallet(time, chord.mallet[order[(step / 4 + bar) % order.length]], 0.06, 0.65);
          }
          if (step === 14) inst.workshopClick(time, 0.018, 6100);
        }),
      ],
    }],
  });

  const marbleTrack = fn<TinkerChord>(({ time, step, chord, bar }) => {
    const malletOrder = [0, 2, 1, 3, 2, 1, 3, 0];
    if (step === 0 || step === 10) inst.kick(time, step === 0 ? 0.85 : 0.58);
    if ([0, 3, 7, 10, 14].includes(step)) {
      const bassOffset = step === 7 ? 12 : step === 14 ? 7 : 0;
      inst.bass(time, chord.bass + bassOffset, step === 0 ? 0.95 : 0.68);
    }
    if (step % 2 === 0) {
      const index = (step / 2 + bar) % malletOrder.length;
      inst.mallet(time, chord.mallet[malletOrder[index]], 0.075, 0.3);
    }
    if (step === 6 || step === 14) inst.wood(time, chord.bass + 24, 0.09);
    if (step % 4 === 3) inst.workshopClick(time, 0.022, 5800 + step * 95);
  });

  const paradeTrack = fn<TinkerChord>(({ time, step, chord, bar }) => {
    const order = [0, 2, 3, 1, 2, 0, 3, 2];
    if (step === 0 || step === 8 || step === 11) inst.kick(time, step === 0 ? 0.95 : 0.65);
    if ([0, 3, 6, 10, 13].includes(step)) {
      const offset = step === 6 ? 12 : step === 13 ? 7 : 0;
      inst.bass(time, chord.bass + offset, step === 0 ? 1 : 0.74);
    }
    if (step === 4 || step === 12) inst.clap(time, step === 12 ? 0.15 : 0.12);
    if (step === 2 || step === 10) inst.organ(time, chord.organ, 0.052, STEP_SECONDS * 1.6, 2100);
    if (step % 2 === 0) {
      inst.mallet(time, chord.mallet[order[(step / 2 + bar) % order.length]], 0.072, 0.25);
    }
    if (step % 2 === 1) inst.workshopClick(time, step % 4 === 1 ? 0.025 : 0.015, 6200);
  });

  const heavyTrack = fn<TinkerChord>(({ time, step, chord, bar }) => {
    const order = [0, 3, 1, 2, 3, 0, 2, 1];
    if ([0, 6, 8, 11].includes(step)) inst.kick(time, step === 0 ? 1 : 0.62);
    if ([0, 3, 6, 9, 12, 15].includes(step)) {
      const offset = step === 6 || step === 15 ? 12 : step === 9 ? 7 : 0;
      inst.bass(time, chord.bass + offset, step === 0 ? 1.05 : 0.77);
    }
    if (step === 4 || step === 12) inst.clap(time, 0.17);
    if (step === 2 || step === 7 || step === 10 || step === 15) {
      inst.organ(time, chord.organ, step === 15 ? 0.065 : 0.05, STEP_SECONDS * 1.25, 2400);
    }
    if (step % 2 === 0) {
      const octave = bar % 2 === 1 && step >= 8 ? 12 : 0;
      inst.mallet(time, chord.mallet[order[(step / 2 + bar) % order.length]] + octave, 0.067, 0.22);
    }
    if (step % 2 === 1) inst.workshopClick(time, step === 7 || step === 15 ? 0.04 : 0.019, 6900);
    if (step === 5 || step === 13) inst.wood(time, chord.bass + 31, 0.11);
  });

  const spillTrack = fn<TinkerChord>(({ time, step, chord, bar }) => {
    if ([0, 3, 6, 8, 11, 14].includes(step)) inst.kick(time, step === 0 ? 1.05 : 0.68);
    if ([0, 2, 5, 8, 10, 13].includes(step)) {
      const offset = step === 5 || step === 13 ? 12 : 0;
      inst.bass(time, chord.bass - 12 + offset, step === 0 ? 1.1 : 0.76);
    }
    if (step === 4 || step === 12) inst.clap(time, 0.18);
    if (step === 0 || step === 6 || step === 10) {
      inst.gluePulse(time, chord.bass - 12, 0.17, STEP_SECONDS * 3.5, 780 + (bar - 24) * 150);
    }
    if (step === 2 || step === 7 || step === 11 || step === 15) {
      inst.organ(time, chord.organ, 0.06, STEP_SECONDS * 1.4, 1850 + (bar - 24) * 140);
    }
    if (step % 2 === 0) {
      const climb = Math.min(3, Math.floor((bar - 24) / 2));
      inst.mallet(time, chord.mallet[(step / 2 + bar) % 4] + climb * 2, 0.055, 0.2);
    }
    if (step % 2 === 1) inst.workshopClick(time, 0.025, 5200 + step * 120);
  });

  const cleanTrack = fn<TinkerChord>(({ time, step, chord, bar }) => {
    if (step === 0 || step === 8) inst.kick(time, step === 0 ? 0.85 : 0.52);
    if (step === 0 || step === 6 || step === 10) {
      inst.bass(time, chord.bass + (step === 6 ? 12 : 0), 0.68);
    }
    if (step === 4 || step === 12) inst.clap(time, 0.14);
    if (step === 0) inst.organ(time, chord.organ.map((midi) => midi + 12), 0.075, TINKER_BALL_Q1CI_TIME.barSeconds * 0.85, 3200);
    if (step % 2 === 0) {
      const fanfare = [0, 2, 4, 5, 7, 6, 5, 7];
      const lead = score.leadSetAt(bar * STEPS_PER_BAR + step);
      inst.mallet(time, lead[fanfare[step / 2]], 0.1, 0.42);
    }
    if (step === 15) inst.workshopClick(time, 0.03, 7600);
  });

  const runArrangement = createArrangement<TinkerChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: TINKER_BALL_Q1CI_RUN_SECTIONS.map((section) => ({
      name: section.name,
      fromBar: section.fromBar,
      toBar: section.toBar,
      tracks: [
        section.fromBar === 0
          ? marbleTrack
          : section.fromBar === 8
            ? paradeTrack
            : section.fromBar === 16
              ? heavyTrack
              : section.fromBar === 24
                ? spillTrack
                : cleanTrack,
        ...(section.fromBar === 24
          ? [oneShot<TinkerChord>(0, 0, ({ time, chord }) => {
            inst.organ(time, chord.organ.map((midi) => midi - 12), 0.11, STEP_SECONDS * 5, 1250);
          })]
          : []),
      ],
    })),
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  const kindByEnemyId = new Map<number, string>();
  bus.on('runstart', () => {
    kindByEnemyId.clear();
    score.resetKillLane();
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    kindByEnemyId.set(enemyId, kind);
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const at = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(at);
    const lead = score.leadSetAt(position);
    const degree = LOCK_DEGREES[Math.min(LOCK_DEGREES.length - 1, Math.max(0, lockCount - 1))];
    inst.playerNote(at, lead[degree] ?? 86, 0.075 + lockCount * 0.006, 0.17);
  });

  bus.on('unlock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const position = score.arrangementPositionAt(context.currentTime);
    const lead = score.leadSetAt(position);
    inst.playerNote(context.currentTime, (lead[Math.min(lockCount, lead.length - 1)] ?? 81) - 12, 0.028, 0.09);
  });

  bus.on('fire', ({ indexInVolley, volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const at = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(at);
    const chord = score.chordAt(position);
    const index = indexInVolley ?? 0;
    inst.fireSnap(at, chord.bass + 24 + Math.min(7, index) * 2, 0.11 + volleySize * 0.008);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining, hitStageIndex }) => {
    if (lethal) return;
    const context = runtime.context();
    if (!context) return;
    const at = score.quantizePlayerAction(context.currentTime);
    const kind = kindByEnemyId.get(enemyId) ?? '';
    const boss = kind.startsWith('spill-');
    const chord = score.chordAt(score.arrangementPositionAt(at));
    const escalation = Math.max(0, 6 - hitPointsRemaining + hitStageIndex * 3);
    inst.impact(at, chord.bass + (boss ? 0 : 19) + escalation, boss ? 0.2 : 0.09, boss ? 0.3 : 0.14);
  });

  bus.on('stage', ({ stageIndex }) => {
    const context = runtime.context();
    const mix = runtime.mix();
    if (!context) return;
    const at = score.nextGridTime(context.currentTime, 2);
    const chord = score.chordAt(score.arrangementPositionAt(at));
    mix?.duckAt(at, 0.68, 0.32);
    inst.gluePulse(at, chord.bass - 12 + stageIndex * 5, 0.26, 0.55, 1450 + stageIndex * 650);
    inst.organ(at + STEP_SECONDS, chord.organ.map((midi) => midi + 12), 0.09, 0.7, 2900);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    const kind = kindByEnemyId.get(enemyId) ?? '';
    kindByEnemyId.delete(enemyId);
    const boss = kind.startsWith('spill-');
    inst.playerNote(
      kill.time,
      kill.midi + (boss ? -12 : 0),
      (boss ? 0.2 : 0.115) + (indexInVolley ?? 0) * 0.012,
      boss ? 0.72 : 0.34,
    );
    inst.workshopClick(kill.time + 0.018, boss ? 0.1 : 0.045, boss ? 3100 : 7400);
  });

  bus.on('volley', ({ size, kills }) => {
    const context = runtime.context();
    const mix = runtime.mix();
    if (!context || size < 6 || kills < 5) return;
    const at = score.nextGridTime(context.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(at));
    mix?.duckAt(at, 0.76, 0.28);
    inst.clap(at, 0.24);
    inst.organ(at, chord.organ.map((midi) => midi + 12), 0.085, 0.55, 3400);
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    inst.reject(context.currentTime, 0.19);
  });

  bus.on('miss', () => {
    const context = runtime.context();
    if (!context) return;
    const position = score.arrangementPositionAt(context.currentTime);
    const chord = score.chordAt(position);
    inst.impact(context.currentTime, chord.bass - 7, 0.045, 0.18);
  });

  bus.on('bossphase', ({ phase }) => {
    const context = runtime.context();
    const mix = runtime.mix();
    if (!context) return;
    const at = score.nextGridTime(context.currentTime, phase === 'destroyed' ? 4 : 2);
    const chord = score.chordAt(score.arrangementPositionAt(at));
    if (phase === 'summoned') {
      mix?.duckAt(at, 0.62, 0.52);
      inst.gluePulse(at, chord.bass - 24, 0.32, 1.15, 720);
      inst.organ(at + STEP_SECONDS * 2, chord.organ.map((midi) => midi - 12), 0.12, 1.1, 1350);
    } else if (phase === 'exposed') {
      mix?.duckAt(at, 0.54, 0.45);
      [0, 2, 4].forEach((degree, index) => {
        const lead = score.leadSetAt(score.arrangementPositionAt(at));
        inst.playerNote(at + index * STEP_SECONDS, lead[degree] - 12, 0.15 + index * 0.02, 0.5);
      });
    } else {
      mix?.duckAt(at, 0.35, 0.7);
      inst.impact(at, chord.bass - 12, 0.32, 0.7);
      inst.organ(at + STEP_SECONDS * 2, chord.organ.map((midi) => midi + 12), 0.15, 1.7, 3600);
      score.leadSetAt(score.arrangementPositionAt(at)).slice(0, 6).forEach((midi, index) => {
        inst.playerNote(at + STEP_SECONDS * (2 + index), midi, 0.14, 0.58);
      });
    }
  });

  return runtime;
}
