import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createBroadsideVoices } from './audio-voices';
import {
  BROADSIDE_B3FK_BARS,
  BROADSIDE_B3FK_BPM,
  BROADSIDE_B3FK_RUN_DURATION,
  BROADSIDE_B3FK_SCORE_SECTIONS,
  BROADSIDE_B3FK_STEPS_PER_BAR,
  BROADSIDE_B3FK_TIME,
  type BroadsideSection,
} from './timing';

type Chord = { bass: number; chord: readonly number[]; lead: readonly number[] };

// D minor moves toward a radiant D major sixth for the final pullback.
const CHORDS: readonly Chord[] = [
  { bass: 38, chord: [50, 53, 57, 62], lead: [62, 65, 69, 72, 74, 77, 81, 84] },
  { bass: 34, chord: [46, 50, 53, 58], lead: [58, 62, 65, 70, 74, 77, 82, 86] },
  { bass: 41, chord: [53, 57, 60, 65], lead: [60, 65, 69, 72, 77, 81, 84, 89] },
  { bass: 36, chord: [48, 52, 55, 60], lead: [60, 64, 67, 72, 76, 79, 84, 88] },
] as const;

const KILL_LANES: Record<BroadsideSection, readonly number[]> = {
  launch: [2, 3, 4, 5, 3, 4, 6, 5, 2, 4, 5, 7, 6, 4, 3, 5],
  engagement: [3, 5, 4, 6, 5, 7, 6, 4, 3, 4, 6, 7, 5, 6, 4, 2],
  broadside: [4, 5, 7, 6, 5, 4, 6, 7, 3, 5, 6, 4, 7, 5, 3, 6],
  eye: [2, 4, 3, 5, 4, 3, 2, 5, 3, 4, 6, 5, 4, 3, 2, 4],
  flagship: [3, 4, 5, 7, 6, 5, 4, 6, 5, 7, 6, 4, 3, 5, 7, 6],
  trench: [4, 6, 5, 7, 6, 4, 7, 5, 3, 6, 7, 4, 5, 7, 6, 3],
  victory: [2, 4, 5, 7, 6, 5, 4, 3, 5, 6, 7, 5, 4, 3, 2, 4],
};

const SIXTEENTH = BROADSIDE_B3FK_TIME.stepSeconds;

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-b3fk',
  bpm: BROADSIDE_B3FK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: BROADSIDE_B3FK_RUN_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, BroadsideSection>({
    bpm: BROADSIDE_B3FK_BPM,
    stepsPerBar: BROADSIDE_B3FK_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: BROADSIDE_B3FK_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const enemyKinds = new Map<number, string>();
  const shieldIds = new Set<number>();
  const coreIds = new Set<number>();
  let shields = 0;
  let cores = 0;

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: BROADSIDE_B3FK_BPM,
    stepsPerBar: BROADSIDE_B3FK_STEPS_PER_BAR,
    stepSeconds: SIXTEENTH,
    runAlignment: 'step',
    beatNumber: 'position',
    volumeScale: 0.72,
    scheduleAhead: 0.18,
    schedulerMs: 25,
    mix: {
      compressor: { threshold: -19, ratio: 4.5, attack: 0.006, release: 0.28 },
      delay: { maxTime: 1.4, time: SIXTEENTH * 3, feedback: 0.22, dampHz: 3100, sendGain: 0.22 },
      reverb: { seconds: 2.8, decay: 3.2, level: 0.3 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      enemyKinds.clear();
      shieldIds.clear();
      coreIds.clear();
      shields = 0;
      cores = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      if (cores === 3) {
        voices.duck(context.currentTime, 0.1, 1.2);
        [62, 66, 69, 74].forEach((midi, index) => voices.horn(context.currentTime + 0.04 + index * 0.12, midi, 0.11, 1.8));
      } else {
        voices.enemyGun(context.currentTime + 0.02, 31, 0.14, 0.7);
        voices.impact(context.currentTime + 0.03, 0.16, 420, 0.35);
      }
    },
  });

  const voices = createBroadsideVoices({ trace, context: runtime.context, mix: runtime.mix });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: BROADSIDE_B3FK_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'fleet-at-distance',
      fromBar: 0,
      tracks: [fn(({ time, step, chord }) => {
        if (step === 0) voices.horn(time, chord.bass, 0.035, 2.2);
        if (step === 8) voices.strings(time, chord.chord[1], 0.025, 1.5, 0.15);
      })],
    }],
  });

  const orchestralTrack = fn<Chord>(({ time, step, bar, chord, section }) => {
    const eye = section.name === 'eye';
    const victory = section.name === 'victory';
    const trench = section.name === 'trench';
    const flagship = section.name === 'flagship';
    const progress = Math.min(1, bar / BROADSIDE_B3FK_BARS.end);

    if (victory) {
      if (step === 0) {
        [50, 54, 57, 62].forEach((midi, index) => voices.choir(time + index * 0.025, midi, 0.075, 2.8, 1));
        voices.brass(time, 62, 0.16, 1.8, 1);
      }
      if (step === 8) voices.horn(time, 69, 0.1, 1.6);
      return;
    }

    if (eye) {
      if (step === 0) {
        voices.choir(time, chord.chord[0], 0.032, 2.1, 0.25);
        voices.horn(time, chord.bass, 0.038, 1.5);
      }
      if (step === 12) voices.air(time, 0.018, 6400, 0.18);
      return;
    }

    // Continuous string ostinato, kept below the player's melodic register.
    const stringGrid = trench ? 1 : flagship ? 2 : bar >= BROADSIDE_B3FK_BARS.flank ? 2 : 4;
    if (step % stringGrid === 0) {
      const note = chord.chord[(step / stringGrid + bar) % chord.chord.length] + (trench ? 12 : 0);
      voices.strings(time, note, 0.025 + progress * 0.018, SIXTEENTH * stringGrid * 1.4, 0.45 + progress * 0.48);
    }

    if (step === 0 || step === 8) {
      voices.timpani(time, chord.bass - (step === 0 ? 12 : 5), 0.1 + progress * 0.06, 0.48);
    }
    if (bar >= BROADSIDE_B3FK_BARS.melee && (step === 0 || step === 6 || step === 10)) {
      voices.brass(time, chord.bass + (step === 0 ? 12 : 19), 0.055 + progress * 0.04, 0.36, 0.55 + progress * 0.4);
    }
    if (bar >= BROADSIDE_B3FK_BARS.flank && bar < BROADSIDE_B3FK_BARS.eye && step % 4 === 0) {
      voices.timpani(time, chord.bass - 12 + (step === 12 ? 5 : 0), 0.085, 0.34);
      if (step === 0) voices.brass(time, chord.chord[2], 0.085, 0.78, 0.85);
    }
    if (flagship && step % 4 === 2) voices.air(time, 0.015 + progress * 0.02, 3600 + step * 180, 0.06);
    if (trench && step % 2 === 0) {
      voices.timpani(time, chord.bass - 12 + (step % 4), 0.07, 0.2);
      if (step % 4 === 0) voices.brass(time, chord.bass + 12 + step / 4, 0.085, 0.28, 1);
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: BROADSIDE_B3FK_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'deck-launch', fromBar: 0, toBar: 4, tracks: [orchestralTrack] },
      { name: 'fleet-engagement', fromBar: 4, toBar: 9, tracks: [orchestralTrack] },
      { name: 'cruiser-broadside', fromBar: 9, toBar: 16, tracks: [orchestralTrack] },
      { name: 'eye-of-battle', fromBar: 16, toBar: 18, tracks: [orchestralTrack] },
      { name: 'flagship-pass', fromBar: 18, toBar: 26, tracks: [orchestralTrack] },
      { name: 'core-trench', fromBar: 26, toBar: 29, tracks: [orchestralTrack] },
      { name: 'victory', fromBar: 29, toBar: 30, tracks: [orchestralTrack] },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
    if (kind === 'shieldGen') shieldIds.add(enemyId);
    if (kind === 'powerCore') coreIds.add(enemyId);
    const context = runtime.context();
    if (!context) return;
    if (kind === 'pdcBolt') {
      voices.enemyGun(context.currentTime, 38, 0.095, 0.3);
      voices.impact(context.currentTime, 0.075, 1100, 0.09);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    voices.player(time, lead[Math.min(lead.length - 1, lockCount + 1)], 0.055 + lockCount * 0.006, 0.14, 0.45 + lockCount / 10);
  });

  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.player(time, chord.bass + 24, 0.095 + volleySize * 0.012, 0.27, 0.65 + volleySize / 12);
    if (volleySize === 6) {
      voices.brass(time, chord.bass + 19, 0.07, 0.42, 0.95);
      voices.impact(time, 0.085, 4200, 0.08);
    }
  });

  bus.on('hit', ({ enemyId, hitPointsRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const boss = shieldIds.has(enemyId) || coreIds.has(enemyId);
    voices.player(time, boss ? 74 + Math.max(0, 4 - hitPointsRemaining) * 2 : 69, boss ? 0.11 : 0.06, 0.17, boss ? 1 : 0.65);
    voices.impact(time, boss ? 0.13 : 0.055, boss ? 1200 : 5400, boss ? 0.18 : 0.07);
  });

  bus.on('stage', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    const bossIndex = shieldIds.has(enemyId) ? shields : cores;
    voices.duck(context.currentTime, 0.48, 0.34);
    voices.brass(context.currentTime + 0.02, 62 + bossIndex * 2, 0.12, 0.55, 1);
    voices.timpani(context.currentTime + 0.02, 31 + bossIndex, 0.18, 0.65);
  });

  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    const shield = shieldIds.delete(enemyId);
    const core = coreIds.delete(enemyId);
    if (shield) shields += 1;
    if (core) cores += 1;
    const bossCount = shield ? shields : core ? cores : 0;
    voices.player(kill.time, bossCount ? 78 + bossCount * 2 : kill.midi, bossCount ? 0.17 : 0.105, bossCount ? 0.42 : 0.28, 1);
    voices.impact(kill.time, bossCount ? 0.18 : 0.08, bossCount ? 800 + bossCount * 420 : 7200, bossCount ? 0.28 : 0.09);
    if (shield && shields === 4) {
      voices.duck(kill.time, 0.12, 0.85);
      [74, 77, 81].forEach((midi, index) => voices.brass(kill.time + index * SIXTEENTH, midi, 0.13 - index * 0.015, 0.7, 1));
    }
    if (core && cores === 3) {
      voices.duck(kill.time, 0.04, 1.5);
      voices.timpani(kill.time, 26, 0.28, 1.2);
      [62, 66, 69, 74].forEach((midi, index) => voices.horn(kill.time + 0.24 + index * 0.13, midi, 0.13, 2.2));
    }
    enemyKinds.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    voices.player(context.currentTime, 35, 0.045, 0.25, 0.1);
    voices.impact(context.currentTime, 0.04, 360, 0.15);
    shieldIds.delete(enemyId);
    coreIds.delete(enemyId);
    enemyKinds.delete(enemyId);
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    voices.enemyGun(context.currentTime, 42, 0.075, 0.16);
    voices.enemyGun(context.currentTime + 0.055, 40, 0.06, 0.18);
    voices.impact(context.currentTime, 0.07, 620, 0.1);
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    voices.enemyGun(context.currentTime, 29 + healthRemaining * 2, 0.17, 0.45);
    voices.impact(context.currentTime, 0.17, 320 + healthRemaining * 120, 0.24);
  });

  return runtime;
}
