import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createBroadsideVoices } from './audio-voices';
import {
  BROADSIDE_806F_BARS,
  BROADSIDE_806F_BPM,
  BROADSIDE_806F_RUN_DURATION,
  BROADSIDE_806F_SCORE_SECTIONS,
  BROADSIDE_806F_STEPS_PER_BAR,
  BROADSIDE_806F_TIME,
  type Broadside806fSection,
} from './timing';

type Chord = {
  bass: number;
  tones: readonly number[];
  lead: readonly number[];
};

const CHORDS: readonly Chord[] = [
  { bass: 38, tones: [50, 53, 57, 62], lead: [62, 65, 67, 69, 72, 74, 77, 81] }, // Dm
  { bass: 34, tones: [46, 50, 53, 58], lead: [58, 62, 65, 67, 70, 74, 77, 79] }, // Bb
  { bass: 41, tones: [53, 57, 60, 65], lead: [65, 69, 72, 74, 77, 81, 84, 86] }, // F
  { bass: 36, tones: [48, 52, 55, 60], lead: [60, 64, 67, 69, 72, 76, 79, 81] }, // C
  { bass: 43, tones: [55, 58, 62, 67], lead: [62, 67, 70, 74, 77, 79, 82, 86] }, // Gm
  { bass: 39, tones: [51, 55, 58, 63], lead: [63, 67, 70, 72, 75, 79, 82, 84] }, // Eb
  { bass: 45, tones: [57, 61, 64, 69], lead: [61, 64, 69, 73, 76, 81, 85, 88] }, // A
] as const;

const VICTORY_CHORDS: readonly Chord[] = [
  { bass: 38, tones: [50, 54, 57, 62], lead: [62, 66, 69, 74, 78, 81, 86, 90] },
] as const;

const KILL_LANES: Record<Broadside806fSection, readonly number[]> = {
  launch: [0, 2, 1, 3, 2, 4, 3, 5, 1, 3, 4, 6, 5, 3, 2, 4],
  engagement: [1, 2, 4, 3, 5, 4, 6, 3, 2, 5, 4, 7, 6, 4, 3, 5],
  broadside: [2, 4, 5, 7, 6, 4, 3, 5, 2, 4, 6, 7, 5, 3, 4, 6],
  underbelly: [1, 3, 2, 4, 5, 3, 6, 4, 2, 5, 3, 7, 6, 4, 2, 5],
  eye: [0, 1, 2, 1, 3, 2, 4, 3, 1, 2, 3, 5, 4, 2, 1, 3],
  flagship: [2, 3, 5, 4, 6, 5, 7, 4, 3, 5, 6, 7, 5, 4, 6, 7],
  turn: [3, 5, 4, 6, 7, 5, 4, 6, 2, 5, 7, 6, 4, 3, 5, 7],
  trench: [2, 4, 3, 5, 4, 6, 5, 7, 3, 5, 4, 6, 7, 5, 4, 6],
  victory: [0, 2, 4, 7, 6, 4, 2, 0, 2, 4, 5, 7, 6, 4, 2, 0],
};

const STEP = BROADSIDE_806F_TIME.stepSeconds;

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-806f',
  bpm: BROADSIDE_806F_BPM,
  stepSeconds: STEP,
  defaultSeconds: BROADSIDE_806F_RUN_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Broadside806fSection>({
    bpm: BROADSIDE_806F_BPM,
    stepsPerBar: BROADSIDE_806F_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{
      fromBar: BROADSIDE_806F_BARS.victory,
      toBar: BROADSIDE_806F_BARS.end,
      chords: VICTORY_CHORDS,
      barsPerChord: 1,
    }],
    sections: BROADSIDE_806F_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const enemyKinds = new Map<number, string>();
  const generatorIds = new Set<number>();
  const powerIds = new Set<number>();
  let generatorsDestroyed = 0;
  let powerDestroyed = 0;
  let victoryScheduled = false;

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: BROADSIDE_806F_BPM,
    stepsPerBar: BROADSIDE_806F_STEPS_PER_BAR,
    stepSeconds: STEP,
    runAlignment: 'step',
    beatNumber: 'position',
    volumeScale: 0.72,
    scheduleAhead: 0.2,
    schedulerMs: 24,
    mix: {
      compressor: { threshold: -19, ratio: 4.5, attack: 0.006, release: 0.32 },
      delay: { maxTime: 1.4, time: STEP * 3, feedback: 0.22, dampHz: 4100, sendGain: 0.2 },
      reverb: { seconds: 3.1, decay: 3.2, level: 0.31 },
      noiseSeconds: 2.4,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      enemyKinds.clear();
      generatorIds.clear();
      powerIds.clear();
      generatorsDestroyed = 0;
      powerDestroyed = 0;
      victoryScheduled = false;
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context || victoryScheduled) return;
      voices.finale(context.currentTime + 0.03, 38, 0.38, 1.8, false);
    },
  });

  const voices = createBroadsideVoices({ trace, context: runtime.context, mix: runtime.mix });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: BROADSIDE_806F_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'fleet-at-standby',
      fromBar: 0,
      tracks: [fn(({ time, step, chord, bar }) => {
        if (step === 0) {
          voices.choir(time, chord.tones[bar % chord.tones.length], 0.038, 2.2, 0.35);
          voices.brass(time, chord.bass + 12, 0.045, 1.15, 0.18);
        }
        if (step === 12 && bar % 2 === 1) voices.percussion(time, 0.016, true, 0.08);
      })],
    }],
  });

  const runTrack = fn<Chord>(({ time, step, bar, barInSection, chord, section }) => {
    const name = section.name as Broadside806fSection;
    const eye = name === 'eye';
    const victory = name === 'victory';
    const danger = name === 'flagship' || name === 'turn' || name === 'trench';
    const full = name === 'engagement' || name === 'broadside' || name === 'underbelly' || danger;
    const intensity = name === 'launch' ? 0.42
      : name === 'engagement' ? 0.62
        : name === 'broadside' ? 0.78
          : name === 'underbelly' ? 0.7
            : name === 'flagship' ? 0.76
              : name === 'turn' ? 0.84
                : name === 'trench' ? 0.95
                  : 0.2;

    if (victory) {
      const fanfare = [0, 2, 4, 5, 7, 6, 4, 7];
      if (step % 2 === 0) {
        const note = chord.lead[fanfare[(step / 2) % fanfare.length]];
        voices.brass(time, note - 12, 0.18, 0.48, 0.92);
        voices.strings(time, note, 0.095, 0.44, 0.72);
      }
      if (step === 0) {
        voices.choir(time, chord.tones[0], 0.12, 2.3, 1);
        voices.choir(time, chord.tones[2], 0.09, 2.3, 1);
        voices.timpani(time, chord.bass - 12, 0.2, 0.8);
      }
      return;
    }

    if (eye) {
      if (step === 0 && barInSection === 0) {
        voices.choir(time, chord.tones[0], 0.042, 3.1, 0.15);
        voices.choir(time, chord.tones[2], 0.03, 2.8, 0.12);
      }
      if (step === 12) voices.strings(time, chord.lead[1], 0.025, 0.62, 0.12);
      return;
    }

    if (step === 0) {
      voices.bass(time, chord.bass - 12, 0.09 + intensity * 0.08, 0.78);
      voices.timpani(time, chord.bass - 12, 0.08 + intensity * 0.1, 0.6);
      voices.choir(time, chord.tones[(bar / 2) % chord.tones.length | 0], 0.025 + intensity * 0.025, 1.9, intensity * 0.7);
    }
    if (full && step === 8) voices.timpani(time, chord.bass - 7, 0.065 + intensity * 0.075, 0.46);

    const stringGrid = name === 'launch' ? 4 : name === 'trench' || name === 'turn' ? 1 : 2;
    if (step % stringGrid === 0) {
      const index = (bar * 3 + step / stringGrid) % chord.lead.length;
      const note = chord.lead[index];
      const accent = step % 4 === 0 ? 1 : 0.7;
      voices.strings(time, note, (0.032 + intensity * 0.035) * accent, STEP * stringGrid * 1.45, 0.35 + intensity * 0.55);
    }

    if (step === 0 || (full && step === 8)) {
      const brassIndex = (bar + (step === 8 ? 1 : 0)) % chord.tones.length;
      voices.brass(time, chord.tones[brassIndex], 0.05 + intensity * 0.065, full ? 0.62 : 0.88, intensity);
    }

    if (full && step % 4 === 2) voices.percussion(time, 0.018 + intensity * 0.02, true, 0.045);
    if (danger && step % 4 === 0) voices.percussion(time, 0.022 + intensity * 0.025, false, 0.09);

    // The friendly cruiser's eight-gun broadside is both a visual cascade and
    // an orchestral one: each cannon lands on an eighth-note during bars 9–11.
    if (name === 'broadside' && bar >= 9 && bar < 11 && step % 4 === 0) {
      const climb = (bar - 9) * 4 + step / 4;
      voices.cannon(time, chord.bass - 12 + climb, 0.19 + climb * 0.012, 0.82);
      voices.brass(time, chord.tones[climb % chord.tones.length] - 12, 0.12, 0.7, 0.9);
    }

    if (name === 'flagship' && step === 12) {
      voices.brass(time, chord.bass + 7 + barInSection, 0.075 + barInSection * 0.014, 0.55, 0.7 + barInSection * 0.08);
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: BROADSIDE_806F_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'launch', fromBar: BROADSIDE_806F_BARS.launch, toBar: BROADSIDE_806F_BARS.engagement, tracks: [runTrack] },
      { name: 'engagement', fromBar: BROADSIDE_806F_BARS.engagement, toBar: BROADSIDE_806F_BARS.broadside, tracks: [runTrack] },
      { name: 'broadside', fromBar: BROADSIDE_806F_BARS.broadside, toBar: BROADSIDE_806F_BARS.underbelly, tracks: [runTrack] },
      { name: 'underbelly', fromBar: BROADSIDE_806F_BARS.underbelly, toBar: BROADSIDE_806F_BARS.eye, tracks: [runTrack] },
      { name: 'eye', fromBar: BROADSIDE_806F_BARS.eye, toBar: BROADSIDE_806F_BARS.flagship, tracks: [runTrack] },
      { name: 'flagship', fromBar: BROADSIDE_806F_BARS.flagship, toBar: BROADSIDE_806F_BARS.turn, tracks: [runTrack] },
      { name: 'turn', fromBar: BROADSIDE_806F_BARS.turn, toBar: BROADSIDE_806F_BARS.trench, tracks: [runTrack] },
      { name: 'trench', fromBar: BROADSIDE_806F_BARS.trench, toBar: BROADSIDE_806F_BARS.victory, tracks: [runTrack] },
      { name: 'victory', fromBar: BROADSIDE_806F_BARS.victory, toBar: BROADSIDE_806F_BARS.end, tracks: [runTrack] },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
    if (kind === 'generator') generatorIds.add(enemyId);
    if (kind === 'power') powerIds.add(enemyId);
    if (kind === 'flak') {
      const context = runtime.context();
      if (!context) return;
      voices.brass(context.currentTime, 77, 0.035, 0.18, 0.65);
      voices.impact(context.currentTime, 0.035, 5100, 0.06);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    const midi = lead[Math.min(lead.length - 1, lockCount)];
    voices.player(time, midi, 0.052 + lockCount * 0.006, 0.12, 0.38 + lockCount / 9);
  });

  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.player(time, chord.bass + 24, 0.095 + volleySize * 0.012, 0.25, 0.62 + volleySize / 12);
    if (volleySize === 6) {
      voices.brass(time, chord.tones[2], 0.085, 0.35, 0.82);
      voices.impact(time, 0.08, 3200, 0.11);
    }
  });

  bus.on('hit', ({ enemyId, hitPointsRemaining, lethal }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const kind = enemyKinds.get(enemyId);
    const boss = kind === 'generator' || kind === 'power';
    const midi = boss ? 69 + Math.min(12, hitPointsRemaining * 2) : 70;
    voices.player(time, midi, boss ? 0.105 : 0.055, boss ? 0.28 : 0.14, boss ? 0.95 : 0.58);
    voices.impact(time, boss ? 0.11 : 0.045, boss ? 1700 + hitPointsRemaining * 420 : lethal ? 4600 : 6900, boss ? 0.18 : 0.065);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const kind = enemyKinds.get(enemyId);
    voices.brass(time, (kind === 'power' ? 62 : 58) + stageIndex * 5, 0.14, 0.62, 0.9);
    voices.timpani(time, 33 + stageIndex * 2, 0.16, 0.72);
    voices.impact(time, 0.14, 900 + stageIndex * 650, 0.22);
  });

  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    const kind = enemyKinds.get(enemyId);
    const generator = generatorIds.delete(enemyId);
    const power = powerIds.delete(enemyId);
    if (generator) generatorsDestroyed += 1;
    if (power) powerDestroyed += 1;
    const bossIndex = generator ? generatorsDestroyed : power ? powerDestroyed : 0;
    voices.player(kill.time, bossIndex ? 76 + bossIndex * 3 : kill.midi, bossIndex ? 0.16 : 0.105, bossIndex ? 0.44 : 0.28, 1);
    voices.impact(kill.time, bossIndex ? 0.16 : 0.07, bossIndex ? 1300 + bossIndex * 900 : 7600, bossIndex ? 0.24 : 0.08);
    if (generator && generatorsDestroyed === 4) {
      voices.choir(kill.time, 50, 0.11, 1.4, 0.82);
      voices.brass(kill.time + STEP, 62, 0.16, 0.72, 1);
      voices.finale(kill.time, 38, 0.34, 1.5, false);
    }
    if (power && powerDestroyed === 3 && !victoryScheduled) {
      victoryScheduled = true;
      voices.finale(kill.time, 38, 0.62, 3.2, true);
      [62, 66, 69, 74].forEach((midi, index) => voices.brass(kill.time + STEP * index, midi, 0.16 - index * 0.012, 0.85, 1));
    }
    enemyKinds.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    voices.player(context.currentTime, 38, 0.04, 0.28, 0.12);
    voices.impact(context.currentTime, 0.035, 420, 0.18);
    generatorIds.delete(enemyId);
    powerIds.delete(enemyId);
    enemyKinds.delete(enemyId);
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime;
    voices.player(time, 43, 0.08, 0.16, 0.16);
    voices.player(time + 0.055, 40, 0.068, 0.2, 0.12);
    voices.impact(time, 0.07, 620, 0.1);
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    voices.timpani(context.currentTime, 28 + healthRemaining * 2, 0.2, 0.65);
    voices.impact(context.currentTime, 0.18, 320 + healthRemaining * 130, 0.28);
  });

  return runtime;
}
