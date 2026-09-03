import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createBroadsideVoices } from './audio-voices';
import {
  BROADSIDE_61Z2_BARS,
  BROADSIDE_61Z2_BPM,
  BROADSIDE_61Z2_MARKERS,
  BROADSIDE_61Z2_RUN_DURATION,
  BROADSIDE_61Z2_SCORE_SECTIONS,
  BROADSIDE_61Z2_STEPS_PER_BAR,
  BROADSIDE_61Z2_TIME,
  type Broadside61z2Section,
} from './timing';

type Chord = {
  bass: number;
  pad: readonly number[];
  lead: readonly number[];
};

const CHORDS: readonly Chord[] = [
  { bass: 38, pad: [50, 53, 57, 60], lead: [62, 65, 69, 72, 74, 77, 81, 84] },
  { bass: 34, pad: [46, 50, 53, 57], lead: [58, 62, 65, 69, 70, 74, 77, 81] },
  { bass: 41, pad: [53, 57, 60, 64], lead: [65, 69, 72, 76, 77, 81, 84, 88] },
  { bass: 36, pad: [48, 52, 55, 59], lead: [60, 64, 67, 71, 72, 76, 79, 83] },
  { bass: 39, pad: [51, 55, 58, 62], lead: [63, 67, 70, 74, 75, 79, 82, 86] },
] as const;

const KILL_LANES: Record<Broadside61z2Section, readonly number[]> = {
  launch: [1, 2, 3, 2, 4, 5, 3, 2, 4, 6, 5, 3, 2, 4, 5, 6],
  skirmish: [2, 3, 4, 5, 3, 4, 6, 5, 2, 4, 5, 7, 6, 4, 3, 5],
  broadside: [3, 4, 5, 6, 4, 5, 7, 6, 3, 5, 4, 6, 7, 5, 4, 2],
  crossfire: [4, 5, 6, 7, 5, 6, 4, 7, 3, 6, 5, 7, 4, 6, 5, 3],
  approach: [2, 4, 3, 5, 4, 6, 5, 7, 3, 5, 4, 6, 5, 7, 6, 4],
  shieldRun: [5, 6, 7, 5, 4, 6, 7, 6, 4, 5, 7, 6, 5, 3, 4, 6],
  shieldBreak: [7, 6, 5, 4, 3, 2, 4, 5, 7, 6, 4, 3, 5, 7, 6, 2],
  trench: [6, 7, 5, 4, 6, 5, 3, 4, 7, 6, 5, 3, 4, 6, 7, 5],
};

const SIXTEENTH = BROADSIDE_61Z2_TIME.stepSeconds;

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-61z2',
  bpm: BROADSIDE_61Z2_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: BROADSIDE_61Z2_RUN_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Broadside61z2Section>({
    bpm: BROADSIDE_61Z2_BPM,
    stepsPerBar: BROADSIDE_61Z2_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: BROADSIDE_61Z2_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  let generatorsCleared = 0;
  let coresCleared = 0;
  let bossDestroyed = false;
  let successFigureScheduled = false;
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();
  const enemyKinds = new Map<number, string>();

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: BROADSIDE_61Z2_BPM,
    stepsPerBar: BROADSIDE_61Z2_STEPS_PER_BAR,
    stepSeconds: SIXTEENTH,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.72,
    scheduleAhead: 0.2,
    schedulerMs: 25,
    mix: {
      compressor: { threshold: -19, ratio: 5.5, attack: 0.004, release: 0.28 },
      delay: { maxTime: 1.5, time: SIXTEENTH * 3, feedback: 0.25, dampHz: 3400, sendGain: 0.28 },
      reverb: { seconds: 2.8, decay: 2.5, level: 0.28 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      generatorsCleared = 0;
      coresCleared = 0;
      bossDestroyed = false;
      successFigureScheduled = false;
      generatorIds.clear();
      coreIds.clear();
      enemyKinds.clear();
      score.clearOverride();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context || bossDestroyed) return;
      voices.cannon(context.currentTime + 0.04, 34, 0.3, 0.62, 1);
      voices.crack(context.currentTime + 0.04, 0.16, 420, 0.26);
    },
  });

  const voices = createBroadsideVoices({ trace, context: runtime.context, mix: runtime.mix });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: BROADSIDE_61Z2_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'fleet-standby',
      fromBar: 0,
      tracks: [fn(({ time, step, chord }) => {
        if (step === 0) voices.strings(time, chord.pad[0], 0.18, 1.7, 0.16);
        if (step === 8) voices.bass(time, chord.bass - 12, 0.08, 0.12, 0.12);
      })],
    }],
  });

  const runTrack = fn<Chord>(({ time, step, bar, chord, section }) => {
    const progress = Math.min(1, bar / BROADSIDE_61Z2_BARS.victory);
    const sectionName = section.name as Broadside61z2Section;
    const boss = sectionName === 'shieldRun' || sectionName === 'shieldBreak' || sectionName === 'trench';

    // Timpani carries the fleet's quarter-note keel; its velocity grows by act.
    if (step % 4 === 0) {
      const beat = step / 4;
      voices.timpani(time, chord.bass + (beat === 0 ? 0 : 2), 0.18 + progress * 0.07, 0.34 + progress * 0.12);
      if (step === 0) voices.brass(time, chord.lead[0] - 12, 0.16 + progress * 0.08, 0.8, 0.25 + progress * 0.75);
    }
    if (step === 0) {
      for (const [index, midi] of chord.pad.entries()) {
        voices.strings(time + index * 0.012, midi, 0.16 + progress * 0.035, 1.4 + (boss ? 0.35 : 0), 0.12 + progress * 0.72);
      }
    }
    if (step % 2 === 0 && bar >= BROADSIDE_61Z2_BARS.skirmish) {
      const lead = chord.lead[(bar + step / 2) % chord.lead.length];
      voices.pulse(time, lead, 0.035 + progress * 0.025, progress);
    }
    if (bar >= BROADSIDE_61Z2_BARS.broadside && step % 4 === 2) {
      voices.strings(time, chord.lead[(bar + 2) % chord.lead.length] - 12, 0.09 + progress * 0.035, 0.3, 0.35 + progress * 0.55);
    }
    if (bar >= BROADSIDE_61Z2_BARS.crossfire && step % 4 === 3) {
      voices.brass(time, chord.lead[(bar + step) % chord.lead.length], 0.045 + progress * 0.045, 0.16, 0.35 + progress * 0.65);
    }
    if (sectionName === 'shieldRun' && step % 4 === 2) {
      voices.pulse(time, chord.bass + 24 + (step % 3), 0.055, 0.85);
    }
    if (sectionName === 'shieldBreak' && step % 2 === 1) {
      voices.brass(time, chord.lead[(step + bar) % chord.lead.length], 0.055, 0.13, 0.72);
    }
    if (sectionName === 'trench' && step % 4 === 1) {
      voices.choir(time, chord.lead[(bar * 2 + step) % chord.lead.length], 0.07, 0.52, 0.7 + progress * 0.3);
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: BROADSIDE_61Z2_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'launch', fromBar: BROADSIDE_61Z2_BARS.launch, toBar: BROADSIDE_61Z2_BARS.skirmish, tracks: [runTrack] },
      { name: 'skirmish', fromBar: BROADSIDE_61Z2_BARS.skirmish, toBar: BROADSIDE_61Z2_BARS.broadside, tracks: [runTrack] },
      { name: 'broadside', fromBar: BROADSIDE_61Z2_BARS.broadside, toBar: BROADSIDE_61Z2_BARS.crossfire, tracks: [runTrack] },
      { name: 'crossfire', fromBar: BROADSIDE_61Z2_BARS.crossfire, toBar: BROADSIDE_61Z2_BARS.approach, tracks: [runTrack] },
      { name: 'approach', fromBar: BROADSIDE_61Z2_BARS.approach, toBar: BROADSIDE_61Z2_BARS.shieldRun, tracks: [runTrack] },
      { name: 'shieldRun', fromBar: BROADSIDE_61Z2_BARS.shieldRun, toBar: BROADSIDE_61Z2_BARS.shieldBreak, tracks: [runTrack] },
      { name: 'shieldBreak', fromBar: BROADSIDE_61Z2_BARS.shieldBreak, toBar: BROADSIDE_61Z2_BARS.trench, tracks: [runTrack] },
      { name: 'trench', fromBar: BROADSIDE_61Z2_BARS.trench, toBar: BROADSIDE_61Z2_BARS.victory, tracks: [runTrack] },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
    if (kind === 'shield-generator') generatorIds.add(enemyId);
    if (kind === 'power-core') coreIds.add(enemyId);
    if (kind === 'point-defense') {
      const context = runtime.context();
      if (context) voices.pulse(context.currentTime, 76, 0.06, 0.8);
    }
    if (kind === 'bolt') {
      const context = runtime.context();
      if (context) {
        voices.brass(context.currentTime, 82, 0.06, 0.12, 0.9);
        voices.crack(context.currentTime, 0.06, 6200, 0.06);
      }
    }
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    voices.player(time, lead[Math.min(lead.length - 1, lockCount + 1)], 0.065 + lockCount * 0.009, 0.12, 0.25 + lockCount / 8);
  });

  bus.on('unlock', () => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    voices.pulse(time, 55, 0.022, 0.2);
  });

  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
      voices.cannon(time, chord.bass + 12, 0.1 + volleySize * 0.016, 0.2 + volleySize * 0.022, 0.35 + volleySize / 10);
    if (volleySize >= 6) {
      voices.brass(time, chord.lead[4], 0.14, 0.48, 1);
      voices.crack(time, 0.1, 7200, 0.1);
    }
  });

  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const kind = enemyKinds.get(enemyId);
    const boss = kind === 'shield-generator' || kind === 'power-core';
    voices.player(time, boss ? 66 + Math.max(0, 3 - hitPointsRemaining) * 2 : 67, boss ? 0.12 : 0.055, lethal ? 0.36 : 0.18, boss ? 0.9 : 0.45);
    voices.crack(time, boss ? 0.095 : 0.045, boss ? 3600 : 7200, boss ? 0.1 : 0.045);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const context = runtime.context();
    if (!context) return;
    const kind = enemyKinds.get(enemyId);
    if (kind !== 'shield-generator' && kind !== 'power-core') return;
    const time = score.quantizePlayerAction(context.currentTime);
    voices.brass(time, 69 + stageIndex * 3, 0.13, 0.34, 0.85);
    voices.timpani(time, 42 + stageIndex * 3, 0.13, 0.3);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    const kind = enemyKinds.get(enemyId);
    const boss = kind === 'shield-generator' || kind === 'power-core';
    const kill = score.nextKill(context.currentTime);
    const position = score.arrangementPositionAt(kill.time);
    const isGenerator = generatorIds.delete(enemyId);
    const isCore = coreIds.delete(enemyId);
    if (isGenerator) generatorsCleared += 1;
    if (isCore) coresCleared += 1;
    if (isCore && coresCleared === 3) bossDestroyed = true;
    voices.player(kill.time, boss ? 78 + (isGenerator ? generatorsCleared : coresCleared) * 2 : kill.midi, boss ? 0.17 : 0.105, boss ? 0.48 : 0.3, boss ? 1 : 0.7);
    voices.brass(kill.time, boss ? 73 + (isGenerator ? generatorsCleared : coresCleared) * 3 : kill.midi + 12, boss ? 0.09 : 0.035, boss ? 0.3 : 0.12, boss ? 0.9 : 0.5);
    voices.crack(kill.time, boss ? 0.13 : 0.065, boss ? 2800 + (isGenerator ? generatorsCleared : coresCleared) * 700 : 8500, boss ? 0.14 : 0.06);
    if (bossDestroyed && !successFigureScheduled) {
      successFigureScheduled = true;
      const start = Math.max(kill.time + SIXTEENTH, context.currentTime + 0.02);
      runtime.mix()?.duckAt(start, 0.18, 1.8);
      for (const [index, midi] of [74, 78, 81, 86, 90].entries()) {
        voices.brass(start + index * SIXTEENTH, midi, 0.15 - index * 0.015, 0.34 + index * 0.04, 1);
      }
      voices.choir(start + SIXTEENTH * 4, 62, 0.16, 2.2, 1);
    }
    enemyKinds.delete(enemyId);
    void position;
    void indexInVolley;
  });

  bus.on('miss', ({ enemyId }) => {
    const context = runtime.context();
    if (context) voices.player(context.currentTime, 39, 0.045, 0.22, 0.1);
    generatorIds.delete(enemyId);
    coreIds.delete(enemyId);
    enemyKinds.delete(enemyId);
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime;
    voices.reject(time, 46, 0.085, 0.2);
    voices.reject(time + SIXTEENTH, 43, 0.06, 0.16);
    voices.crack(time, 0.075, 720, 0.1);
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    voices.timpani(context.currentTime, 35 - Math.max(0, 3 - healthRemaining) * 2, 0.2, 0.5);
    voices.crack(context.currentTime, 0.16, 520, 0.22);
  });

  bus.on('bossphase', ({ phase }) => {
    const context = runtime.context();
    if (!context) return;
    if (phase === 'summoned') {
      const time = score.nextGridTime(context.currentTime);
      runtime.mix()?.duckAt(time, 0.42, 0.72);
      voices.brass(time, 50, 0.18, 1.3, 1);
      voices.brass(time + SIXTEENTH * 2, 57, 0.16, 1.0, 1);
      voices.timpani(time, 34, 0.22, 0.8);
    } else if (phase === 'exposed') {
      const time = score.nextGridTime(context.currentTime);
      runtime.mix()?.duckAt(time, 0.25, 1.2);
      voices.brass(time, 62, 0.17, 0.58, 1);
      voices.brass(time + SIXTEENTH * 2, 69, 0.15, 0.45, 1);
      voices.choir(time + SIXTEENTH * 3, 57, 0.1, 1.4, 1);
    } else {
      const time = score.nextGridTime(context.currentTime);
      runtime.mix()?.duckAt(time, 0.12, 2.4);
      voices.choir(time, 62, 0.16, 2.4, 1);
    }
  });

  return runtime;
}

void BROADSIDE_61Z2_MARKERS;
