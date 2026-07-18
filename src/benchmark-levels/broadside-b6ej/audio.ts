import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import {
  BROADSIDE_B6EJ_BARS, BROADSIDE_B6EJ_BPM, BROADSIDE_B6EJ_RUN_DURATION,
  BROADSIDE_B6EJ_SCORE_SECTIONS, BROADSIDE_B6EJ_SECTIONS, BROADSIDE_B6EJ_STEPS_PER_BAR,
  BROADSIDE_B6EJ_TIME, type BroadsideScoreSection,
} from './timing';

type Chord = { bass: number; tones: readonly number[] };
const CHORDS: readonly Chord[] = [
  { bass: 38, tones: [50, 53, 57, 62, 65, 69] }, // Dm
  { bass: 34, tones: [46, 50, 53, 58, 62, 65] }, // Bb
  { bass: 41, tones: [53, 57, 60, 65, 69, 72] }, // F
  { bass: 36, tones: [48, 52, 55, 60, 64, 67] }, // C
  { bass: 43, tones: [55, 58, 62, 67, 70, 74] }, // Gm
  { bass: 45, tones: [57, 61, 64, 69, 73, 76] }, // A
];
const KILL_LANES: Record<BroadsideScoreSection, readonly number[]> = {
  0: [0, 1, 2, 4, 3, 2, 1, 3, 5, 4, 2, 3, 1, 0, 2, 4],
  1: [0, 2, 4, 5, 3, 1, 2, 4, 5, 3, 2, 0, 1, 3, 4, 5],
  2: [5, 4, 2, 3, 1, 2, 0, 3, 5, 4, 3, 1, 2, 4, 5, 3],
  3: [0, 3, 1, 4, 2, 5, 4, 2, 1, 3, 5, 2, 4, 3, 1, 0],
  4: [0, 2, 3, 5, 4, 2, 3, 1, 4, 5, 3, 2, 0, 3, 4, 5],
};

const STEP = BROADSIDE_B6EJ_TIME.stepSeconds;

export function createAudio(bus: EventBus) { return createBroadsideAudio(bus).audio; }
export const traceBroadsideB6ejAudio = createAudioTraceHarness({
  level: 'broadside-b6ej', bpm: BROADSIDE_B6EJ_BPM, stepSeconds: STEP,
  defaultSeconds: BROADSIDE_B6EJ_RUN_DURATION, createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, BroadsideScoreSection>({
    bpm: BROADSIDE_B6EJ_BPM, stepsPerBar: BROADSIDE_B6EJ_STEPS_PER_BAR,
    chords: CHORDS, barsPerChord: 2, sections: BROADSIDE_B6EJ_SCORE_SECTIONS,
    leadSet: (chord) => chord.tones, killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus, trace, score, stepSeconds: STEP, runAlignment: 'bar', beatNumber: 'absolute', volumeScale: 0.72,
    mix: {
      compressor: { threshold: -20, ratio: 5.5, attack: 0.006, release: 0.25 },
      delay: { time: STEP * 3, feedback: 0.2, dampHz: 2600 }, noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunEnd() {
      const ctx = runtime.context(); if (!ctx) return;
      inst.brass(ctx.currentTime + 0.03, 50, 0.16, 1.5, 1500);
      inst.brass(ctx.currentTime + 0.1, 57, 0.12, 1.8, 1900);
      inst.cymbal(ctx.currentTime + 0.04, 0.09, 1.8, 4200);
    },
  });

  const timpaniVoice = voice<{ velocity: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.22 }], duration: 0.42, stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'set', value: 118, time }, { type: 'exponentialRamp', value: 43, time: time + 0.3 }],
    gainAutomation: (time, _gain, { velocity }) => [
      { type: 'set', value: velocity * 0.5, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });
  const brassVoice = voice<{ velocity: number; duration: number; cutoff: number }>({
    oscillators: [{ type: 'sawtooth', detune: -9 }, { type: 'sawtooth', detune: 9, gain: 0.7 }, { type: 'square', gain: 0.12 }],
    duration: ({ duration }) => duration, stopPadding: 0.08, filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 1.4 },
    gainAutomation: (time, _gain, { velocity, duration }) => [
      { type: 'set', value: 0.001, time }, { type: 'linearRamp', value: velocity, time: time + 0.06 },
      { type: 'linearRamp', value: velocity * 0.62, time: time + duration * 0.58 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });
  const stringsVoice = voice<{ velocity: number; duration: number; cutoff: number }>({
    oscillators: [{ type: 'sawtooth', detune: -5 }, { type: 'triangle', detune: 5, gain: 0.52 }],
    duration: ({ duration }) => duration, stopPadding: 0.06, filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    gainAutomation: (time, _gain, { velocity, duration }) => [
      { type: 'set', value: 0.001, time }, { type: 'linearRamp', value: velocity, time: time + 0.025 },
      { type: 'linearRamp', value: velocity * 0.76, time: time + duration * 0.72 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });
  const pluckVoice = voice<{ velocity: number; decay: number; bright: number }>({
    oscillators: [{ type: 'triangle' }, { type: 'square', gain: 0.12 }], duration: ({ decay }) => decay, stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 2.4, cutoff: ({ bright }) => bright },
    gainAutomation: (time, _gain, { velocity, decay }) => [
      { type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });
  const noise = noiseHit({ filterType: 'bandpass', frequency: 3000, decay: 0.12 });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    timpani(context, time, velocity) {
      const mix = runtime.mix(); if (!mix?.duck) return;
      timpaniVoice.play({ context, time, frequency: 100, velocity, destination: mix.duck }); mix.duckAt(time, 0.38, 0.26);
    },
    brass(context, time, midi, velocity, duration, cutoff) {
      const output = runtime.mix()?.music; if (!output) return;
      brassVoice.play({ context, time, midi, velocity, duration, cutoff, destination: output });
    },
    strings(context, time, midi, velocity, duration, cutoff) {
      const output = runtime.mix()?.music; if (!output) return;
      stringsVoice.play({ context, time, midi, velocity, duration, cutoff, destination: output });
    },
    cymbal(context, time, velocity, decay, frequency) {
      const mix = runtime.mix(); if (!mix?.noiseBuffer || !mix.music) return;
      noise.play({ context, buffer: mix.noiseBuffer, time, velocity, decay, frequency, destination: mix.music, offset: Math.random() });
    },
    player(context, time, midi, velocity, decay, bright) {
      const mix = runtime.mix(); if (!mix?.sfx) return;
      pluckVoice.play({
        context, time, midi, velocity, decay, bright, destination: mix.sfx,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.26 }] : [],
      });
    },
  }, {
    timpani: ['velocity'], brass: ['midi', 'velocity', 'duration', 'cutoff'],
    strings: ['midi', 'velocity', 'duration', 'cutoff'], cymbal: ['velocity', 'decay', 'frequency'],
    player: ['midi', 'velocity', 'decay', 'bright'],
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: 16, chordAt: score.chordAt,
    sections: [{ name: 'distant-fleet', fromBar: 0, tracks: [fn(({ time, step, chord }) => {
      if (step === 0) inst.brass(time, chord.bass + 12, 0.035, 1.4, 700);
      if (step === 8) inst.cymbal(time, 0.018, 0.5, 1300);
    })] }],
  });

  const runTrack = fn<Chord>(({ time, step, bar, chord }) => {
    const eye = bar >= BROADSIDE_B6EJ_BARS.eye && bar < BROADSIDE_B6EJ_BARS.flagship;
    const boss = bar >= BROADSIDE_B6EJ_BARS.flagship;
    const victory = bar >= BROADSIDE_B6EJ_BARS.victory;
    const intensity = bar < 4 ? 0 : bar < 10 ? 1 : bar < 16 ? 2 : bar < 22 ? 3 : eye ? 0 : 4;

    if (!eye && !victory && (step === 0 || (intensity >= 1 && step === 8) || (intensity >= 3 && step === 10))) {
      inst.timpani(time, step === 0 ? 0.9 : 0.52);
    }
    if (!eye && !victory && step % (intensity >= 3 ? 2 : 4) === 0) {
      const degree = [0, 2, 1, 4, 3, 5, 2, 4][(step / 2) % 8] ?? 0;
      inst.strings(time, chord.tones[degree] ?? chord.tones[0], 0.028 + intensity * 0.008, STEP * (intensity >= 3 ? 1.65 : 3.2), 1250 + intensity * 340);
    }
    if (!eye && !victory && (step === 0 || step === 8)) {
      inst.brass(time, chord.bass + 12 + (step === 8 ? 7 : 0), 0.045 + intensity * 0.012, 0.62, 850 + intensity * 260);
    }
    if (intensity >= 2 && !victory && step % 4 === 2) inst.cymbal(time, 0.025, 0.08, 3600 + step * 120);

    // The friendly cruiser fires a visible and audible six-gun broadside on consecutive downbeats.
    if (bar >= 10 && bar < 16 && step === 0) {
      inst.timpani(time, 1.0); inst.brass(time, 38 + (bar % 3) * 5, 0.13, 0.42, 1100);
      inst.cymbal(time, 0.075, 0.35, 1800);
    }
    // The eye removes the orchestra until a lone distant horn calls the flagship.
    if (eye && step === 0 && bar % 2 === 0) inst.brass(time, 38 + (bar === 24 ? 7 : 0), 0.045, 1.35, 620);
    if (bar === 25 && step === 12) inst.cymbal(time, 0.055, 1.2, 2600);
    if (boss && !victory && step % 2 === 0) inst.strings(time, chord.tones[(step / 2 + bar) % chord.tones.length], 0.052, STEP * 1.7, 2700);
    if (boss && !victory && step === 12) inst.brass(time, chord.bass + 24, 0.1, 0.38, 1900);
    if (bar === BROADSIDE_B6EJ_BARS.trench && step === 0) { inst.timpani(time, 1.1); inst.cymbal(time, 0.12, 0.8, 5200); }
    if (victory && step === 0) {
      inst.brass(time, 50, 0.16, 1.55, 1900); inst.brass(time + 0.07, 57, 0.12, 1.5, 2300);
      inst.strings(time, 69, 0.07, 1.55, 3600); inst.cymbal(time, 0.11, 1.5, 5200);
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: 16, chordAt: score.chordAt, trace, emitSections: true,
    sections: BROADSIDE_B6EJ_SECTIONS.map((section) => ({
      name: section.name, fromBar: section.fromBar, toBar: section.toBar, tracks: [runTrack],
    })),
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time); else runArrangement.schedule(position, time);
  }

  const action = (lockCount = 1) => {
    const ctx = runtime.context(); if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time); const chord = score.chordAt(position); const lead = score.leadSetAt(position);
    return { time, chord, midi: lead[Math.min(lockCount - 1, lead.length - 1)] ?? 69 };
  };

  bus.on('spawn', ({ kind }) => {
    if (!['flak', 'shield', 'core'].includes(kind)) return;
    const ctx = runtime.context(); if (!ctx) return;
    inst.cymbal(ctx.currentTime, kind === 'flak' ? 0.035 : 0.09, kind === 'flak' ? 0.08 : 0.34, kind === 'core' ? 900 : 2400);
  });
  bus.on('lock', ({ lockCount }) => { const a = action(lockCount); if (a) inst.player(a.time, a.midi + 12, 0.05 + lockCount * 0.01, 0.11, 2400 + lockCount * 330); });
  bus.on('unlock', () => { const ctx = runtime.context(); if (ctx) inst.player(ctx.currentTime, 55, 0.03, 0.08, 900); });
  bus.on('fire', ({ volleySize }) => {
    const a = action(volleySize); if (!a) return;
    inst.brass(a.time, a.chord.bass + 24, 0.08 + volleySize * 0.012, 0.24, 1250 + volleySize * 120);
    inst.cymbal(a.time, 0.035 + volleySize * 0.008, 0.1, 3700);
  });
  bus.on('hit', ({ lethal, hitStageIndex }) => {
    if (lethal) return; const a = action(); if (a) inst.player(a.time, a.chord.bass + 31 + hitStageIndex * 3, 0.075, 0.2, 1800 + hitStageIndex * 500);
  });
  bus.on('kill', () => {
    const ctx = runtime.context(); if (!ctx) return; const kill = score.nextKill(ctx.currentTime);
    inst.player(kill.time, kill.midi + 12, 0.13, 0.36, 3200); inst.strings(kill.time, kill.midi, 0.045, 0.42, 2700);
  });
  bus.on('stage', ({ stageIndex }) => {
    const a = action(); if (!a) return; inst.brass(a.time, 50 + stageIndex * 5, 0.13, 0.62, 1600); inst.timpani(a.time, 0.78);
  });
  bus.on('bossphase', ({ phase }) => {
    const ctx = runtime.context(); if (!ctx) return;
    if (phase === 'exposed') { inst.cymbal(ctx.currentTime, 0.13, 1.1, 4800); inst.brass(ctx.currentTime + 0.05, 57, 0.17, 0.9, 2300); }
  });
  bus.on('miss', () => { const ctx = runtime.context(); if (ctx) inst.brass(ctx.currentTime, 34, 0.035, 0.2, 620); });
  bus.on('reject', () => { const ctx = runtime.context(); if (ctx) { inst.cymbal(ctx.currentTime, 0.1, 0.16, 480); inst.player(ctx.currentTime + 0.02, 41, 0.055, 0.18, 620); } });
  bus.on('playerhit', () => { const ctx = runtime.context(); if (ctx) { inst.timpani(ctx.currentTime, 1); inst.brass(ctx.currentTime, 29, 0.1, 0.4, 540); } });
  return runtime;
}
