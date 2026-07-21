import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createSkyhookVoices } from './audio-voices';
import {
  SKYHOOK_LOYY_BARS,
  SKYHOOK_LOYY_BPM,
  SKYHOOK_LOYY_RUN_DURATION,
  SKYHOOK_LOYY_SECTIONS,
  SKYHOOK_LOYY_STEPS_PER_BAR,
  SKYHOOK_LOYY_TIME,
  type SkyhookSectionName,
} from './timing';

// Skyhook begins inside weather: wide filtered air, distant sheet-metal
// percussion, a heavy cable fundamental and open suspended harmony. Every
// ascent section removes a layer. In vacuum only the cable remains; during
// docking even that loses its attack and the station answers with one chord.

type Chord = { root: number; air: readonly number[]; lead: readonly number[] };

const CHORDS: readonly Chord[] = [
  { root: 33, air: [57, 64, 69, 74], lead: [69, 71, 74, 76, 81, 83, 86, 88] }, // A5
  { root: 29, air: [53, 60, 64, 69], lead: [69, 72, 76, 77, 81, 84, 88, 89] }, // Fmaj7
  { root: 36, air: [55, 60, 67, 72], lead: [67, 72, 74, 79, 84, 86, 91, 96] }, // C5
  { root: 35, air: [59, 62, 66, 71], lead: [66, 71, 74, 78, 83, 86, 90, 95] }, // Bsus
];

const KILL_LANES: Record<SkyhookSectionName, readonly number[]> = {
  storm: [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 5, 3, 6, 5, 4, 7],
  sunbreak: [2, 3, 5, 4, 6, 5, 7, 6, 4, 5, 3, 6, 5, 7, 6, 2],
  'thin-air': [5, 4, 6, 3, 5, 2, 4, 1, 3, 5, 4, 6, 3, 2, 1, 0],
  vacuum: [7, 5, 3, 1, 6, 4, 2, 0, 5, 3, 1, 4, 2, 0, 3, 1],
  crawler: [0, 3, 1, 4, 2, 5, 3, 6, 4, 7, 5, 4, 6, 3, 5, 2],
  docking: [6, 5, 4, 3, 2, 1, 0, 2, 4, 3, 2, 1, 0, 0, 0, 0],
};

const SIXTEENTH = SKYHOOK_LOYY_TIME.stepSeconds;

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-loyy',
  bpm: SKYHOOK_LOYY_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_LOYY_RUN_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let crawlerId = -1;
  const crawlerMaxHitPoints = 12;
  const score = createScore<Chord, SkyhookSectionName>({
    bpm: SKYHOOK_LOYY_BPM,
    stepsPerBar: SKYHOOK_LOYY_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: SKYHOOK_LOYY_SECTIONS.map((section) => ({
      index: section.name,
      fromBar: section.fromBar,
      crossfadeBars: section.name === 'docking' ? 0 : 0.5,
    })),
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: SKYHOOK_LOYY_BPM,
    stepsPerBar: SKYHOOK_LOYY_STEPS_PER_BAR,
    stepSeconds: SIXTEENTH,
    runAlignment: 'bar',
    beatNumber: 'position',
    scheduleAhead: 0.16,
    schedulerMs: 25,
    volumeScale: 0.78,
    mix: {
      compressor: { threshold: -18, ratio: 4.5, attack: 0.006, release: 0.32 },
      delay: { time: SIXTEENTH * 3, feedback: 0.27, dampHz: 2100, sendGain: 0.48 },
      reverb: { seconds: 3.3, decay: 3.1, level: 0.42 },
      noiseSeconds: 2,
    },
    onStep: scheduleStep,
    onRunStart() {
      crawlerId = -1;
    },
    onRunEnd() {
      const ctx = runtime.context();
      if (!ctx) return;
      const chord = CHORDS[2];
      voices.airChord(ctx.currentTime + 0.05, chord.air, 0.28, 4.5);
    },
  });

  const voices = createSkyhookVoices({ context: runtime.context, mix: runtime.mix, trace });

  function scheduleStep({ time, step, bar, mode }: BeatLevelAudioStep) {
    const activeBar = mode === 'ambient' ? 0 : bar;
    const chord = CHORDS[Math.floor(activeBar / 2) % CHORDS.length];

    if (mode === 'ambient') {
      if (step === 0) voices.airChord(time, chord.air, 0.08, 4.8);
      if (step === 2 || step === 10) voices.wind(time, 0.025, 0.8, 950);
      if (step === 0) voices.cable(time, chord.root, 0.055, 1.6);
      return;
    }

    if (activeBar < SKYHOOK_LOYY_BARS.cloudbreak) {
      // Full atmosphere: four wind strokes, broad pressure pulse, busy panel rain.
      if (step % 4 === 0) voices.wind(time, step === 0 ? 0.075 : 0.045, 0.62, 720 + step * 35);
      if (step === 0 || step === 10) voices.pressure(time, chord.root, step === 0 ? 0.16 : 0.1, 0.52);
      if ([2, 5, 7, 11, 14].includes(step)) voices.panel(time, 0.045, step % 2 === 0);
      if (step === 0) voices.airChord(time, chord.air, 0.18, 4.6);
      if (step === 6 || step === 14) voices.cable(time, chord.lead[(activeBar + step) % chord.lead.length] - 12, 0.07, 0.75);
      return;
    }

    if (activeBar < SKYHOOK_LOYY_BARS.stratosphere) {
      // Cloudbreak opens the harmony and makes the machinery rhythmic.
      if (step === 0 || step === 8) voices.pressure(time, chord.root, 0.12, 0.45);
      if (step === 4 || step === 12) voices.wind(time, 0.032, 0.8, 1450);
      if (step === 0) voices.airChord(time, chord.air, 0.21, 5.1);
      if (step % 4 === 2) voices.cable(time, chord.lead[(step / 2 + activeBar) % chord.lead.length] - 12, 0.075, 0.72);
      if ([3, 7, 11, 15].includes(step)) voices.panel(time, 0.032, true);
      return;
    }

    if (activeBar < SKYHOOK_LOYY_BARS.vacuum) {
      // Thin air: no drum body, just cable harmonics and two breaths per bar.
      if (step === 0) voices.airChord(time, chord.air, 0.105, 5.6);
      if (step === 2 || step === 10) voices.wind(time, 0.018, 1.1, 2100);
      if (step === 0 || step === 9) voices.cable(time, chord.lead[(activeBar + step) % chord.lead.length] - 12, 0.065, 1.15);
      return;
    }

    if (activeBar < SKYHOOK_LOYY_BARS.boss) {
      // Vacuum: attacks happen in the silence around a lone tether resonance.
      if (step === 0) voices.cable(time, chord.root + 12, 0.052, 1.8);
      if (step === 12) voices.panel(time, 0.018, true);
      return;
    }

    if (activeBar < SKYHOOK_LOYY_BARS.dock) {
      // The crawler does not restore the missing air. Its theme is the cable
      // itself under strain, plus an industrial warning every other beat.
      if (step === 0 || step === 8) voices.pressure(time, chord.root - 5, 0.105, 0.7);
      if (step % 4 === 0) voices.cable(time, chord.root + (step === 12 ? 7 : 12), 0.055, 1.25);
      if (step === 6 || step === 14) voices.alarm(time, 71, 0.025, 0.3);
      return;
    }

    // Docking: the station swallows the car. One chord, one latch, then quiet.
    if (activeBar === SKYHOOK_LOYY_BARS.dock && step === 0) voices.airChord(time, [55, 62, 67, 71, 74], 0.23, 5.2);
    if (activeBar === SKYHOOK_LOYY_BARS.dock && (step === 4 || step === 12)) voices.panel(time, 0.05, false);
    if (activeBar === SKYHOOK_LOYY_BARS.dock + 1 && step === 0) voices.cable(time, 43, 0.035, 2.4);
  }

  const actionContext = () => {
    const ctx = runtime.context();
    if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    return { ctx, time, position, chord };
  };

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'crawler') crawlerId = enemyId;
    if (kind === 'saboteur') {
      const ctx = runtime.context();
      if (ctx) voices.alarm(score.quantizePlayerAction(ctx.currentTime), 79, 0.032, 0.24);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    const action = actionContext();
    if (!action) return;
    const note = action.chord.lead[Math.min(action.chord.lead.length - 1, lockCount - 1)];
    voices.playerTone(action.time, note, 0.065 + lockCount * 0.008, 0.16, 0.45 + lockCount * 0.07);
  });
  bus.on('unlock', () => {
    const ctx = runtime.context();
    if (ctx) voices.metal(ctx.currentTime, 0.022, 0.04, 1700);
  });
  bus.on('fire', ({ volleySize, indexInVolley }) => {
    if ((indexInVolley ?? 0) !== 0) return;
    const action = actionContext();
    if (!action) return;
    voices.release(action.time, action.chord.root + 24, 0.055 + volleySize * 0.012);
  });
  bus.on('hit', ({ enemyId, lethal, hitStageIndex, hitPointsRemaining }) => {
    const action = actionContext();
    if (!action) return;
    voices.metal(action.time, lethal ? 0.075 : 0.045, lethal ? 0.13 : 0.07, 2100 + hitStageIndex * 600);
    if (enemyId === crawlerId && !lethal) {
      const damage = clamp01(1 - hitPointsRemaining / crawlerMaxHitPoints);
      const degree = Math.min(action.chord.lead.length - 1, Math.floor(damage * action.chord.lead.length));
      voices.playerTone(
        action.time + SIXTEENTH / 2,
        action.chord.lead[degree] + (damage > 0.72 ? 12 : 0),
        0.07 + damage * 0.075,
        0.24 + damage * 0.22,
        0.45 + damage * 0.55,
      );
    }
  });
  bus.on('kill', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    voices.playerTone(kill.time, kill.midi, 0.13, 0.38, 0.85);
  });
  bus.on('stage', ({ stageIndex }) => {
    const action = actionContext();
    if (!action) return;
    voices.pressure(action.time, action.chord.root - 12 + stageIndex * 5, 0.22, 0.72);
    voices.metal(action.time + SIXTEENTH / 2, 0.12, 0.22, 850);
  });
  bus.on('miss', () => {
    const ctx = runtime.context();
    if (ctx) voices.cable(ctx.currentTime, 30, 0.035, 0.4);
  });
  bus.on('reject', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    voices.alarm(ctx.currentTime, 49, 0.055, 0.22);
    voices.metal(ctx.currentTime + 0.025, 0.085, 0.1, 620);
  });
  bus.on('playerhit', ({ healthRemaining }) => {
    const ctx = runtime.context();
    const mix = runtime.mix();
    if (!ctx) return;
    mix?.duckAt(ctx.currentTime, 0.28, 0.7);
    voices.pressure(ctx.currentTime, 24, 0.32, 0.72);
    voices.alarm(ctx.currentTime + 0.08, 47 + Math.max(0, healthRemaining), 0.065, 0.5);
  });
  bus.on('bossphase', ({ phase }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    if (phase === 'exposed') {
      voices.alarm(ctx.currentTime, 83, 0.09, 0.65);
      voices.airChord(ctx.currentTime, [52, 59, 64, 71], 0.16, 2.2);
    } else if (phase === 'destroyed') {
      runtime.mix()?.duckAt(ctx.currentTime, 0.18, 1.5);
      voices.pressure(ctx.currentTime, 28, 0.34, 1.15);
      voices.airChord(ctx.currentTime + SIXTEENTH * 2, [57, 64, 69, 76], 0.28, 4.2);
    }
  });

  return runtime;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
