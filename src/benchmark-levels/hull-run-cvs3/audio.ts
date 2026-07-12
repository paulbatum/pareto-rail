import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import {
  HULL_RUN_CVS3_BARS, HULL_RUN_CVS3_BPM, HULL_RUN_CVS3_RUN_DURATION,
  HULL_RUN_CVS3_SCORE_SECTIONS, HULL_RUN_CVS3_SECTIONS, HULL_RUN_CVS3_STEPS_PER_BAR,
  HULL_RUN_CVS3_TIME, type HullRunSection,
} from './timing';

type Chord = { bass: number; tones: readonly number[] };
const CHORDS: readonly Chord[] = [
  { bass: 34, tones: [58, 61, 65, 68, 73, 77] }, // Bbm
  { bass: 30, tones: [54, 58, 61, 65, 70, 73] }, // Gb
  { bass: 27, tones: [51, 54, 58, 63, 66, 70] }, // Ebm
  { bass: 29, tones: [53, 56, 60, 65, 68, 72] }, // F
];
const KILL_LANES: Record<HullRunSection, readonly number[]> = {
  0: [0, 1, 2, 1, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0],
  1: [0, 3, 1, 4, 2, 5, 3, 1, 0, 4, 2, 5, 3, 2, 1, 4],
  2: [5, 3, 4, 2, 3, 1, 2, 0, 3, 5, 4, 2, 1, 3, 2, 4],
  3: [0, 2, 4, 5, 4, 2, 3, 5, 1, 3, 4, 5, 3, 2, 1, 0],
};

const STEP = HULL_RUN_CVS3_TIME.stepSeconds;

export function createAudio(bus: EventBus) { return createHullRunAudio(bus).audio; }
export const traceHullRunCvs3Audio = createAudioTraceHarness({ level: 'hull-run-cvs3', bpm: HULL_RUN_CVS3_BPM, stepSeconds: STEP, defaultSeconds: HULL_RUN_CVS3_RUN_DURATION, createAudio: createHullRunAudio });

function createHullRunAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, HullRunSection>({
    bpm: HULL_RUN_CVS3_BPM, stepsPerBar: HULL_RUN_CVS3_STEPS_PER_BAR,
    chords: CHORDS, barsPerChord: 2, sections: HULL_RUN_CVS3_SCORE_SECTIONS,
    leadSet: (chord) => chord.tones, killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus, trace, score, stepSeconds: STEP, runAlignment: 'bar', beatNumber: 'absolute', volumeScale: 0.78,
    mix: { compressor: { threshold: -20, ratio: 6, attack: 0.004, release: 0.2 }, delay: { time: STEP * 3, feedback: 0.25, dampHz: 1700 }, noiseSeconds: 2 },
    onBeforeBeat({ step, bar, time, mode }) { if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar); },
    onStep: scheduleStep,
    onRunEnd() { const ctx = runtime.context(); if (ctx) { inst.horn(ctx.currentTime + 0.04, 46, 0.18, 1.8); inst.metal(ctx.currentTime + 0.05, 0.11, 0.7, 420); } },
  });

  const kickVoice = voice<{ velocity: number }>({
    oscillators: [{ type: 'sine' }], duration: 0.2, stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'set', value: 145, time }, { type: 'exponentialRamp', value: 38, time: time + 0.14 }],
    gainAutomation: (time, _gain, { velocity }) => [{ type: 'set', value: velocity * 0.46, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.2 }],
  });
  const bassVoice = voice<{ velocity: number }>({ oscillators: [{ type: 'sawtooth' }], duration: 0.24, stopPadding: 0.04, filter: { type: 'lowpass', cutoff: 300 }, gainAutomation: (time, _gain, { velocity }) => [{ type: 'set', value: velocity * 0.2, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.24 }] });
  const hornVoice = voice<{ velocity: number; duration: number }>({ oscillators: [{ type: 'sawtooth', detune: -8 }, { type: 'square', detune: 8, gain: 0.22 }], duration: ({ duration }) => duration, stopPadding: 0.05, filter: { type: 'lowpass', cutoff: 720 }, gainAutomation: (time, _gain, { velocity, duration }) => [{ type: 'set', value: 0.001, time }, { type: 'linearRamp', value: velocity, time: time + 0.05 }, { type: 'exponentialRamp', value: 0.001, time: time + duration }] });
  const noteVoice = voice<{ velocity: number; decay: number; bright: number }>({ oscillators: [{ type: 'triangle' }, { type: 'square', gain: 0.16 }], duration: ({ decay }) => decay, stopPadding: 0.03, filter: { type: 'bandpass', Q: 3, cutoff: ({ bright }) => bright }, gainAutomation: (time, _gain, { velocity, decay }) => [{ type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + decay }] });
  const metalHit = noiseHit({ filterType: 'bandpass', frequency: 2100, decay: 0.08 });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    kick(context, time, velocity) { const mix = runtime.mix(); if (!mix?.duck) return; kickVoice.play({ context, time, frequency: 120, velocity, destination: mix.duck }); mix.duckAt(time, 0.4, 0.22); },
    bass(context, time, midi, velocity) { const mix = runtime.mix(); if (!mix?.duck) return; bassVoice.play({ context, time, midi, velocity, destination: mix.duck }); },
    horn(context, time, midi, velocity, duration) { const output = runtime.mix()?.music; if (!output) return; hornVoice.play({ context, time, midi, velocity, duration, destination: output }); },
    metal(context, time, velocity, decay, frequency) { const mix = runtime.mix(); if (!mix?.noiseBuffer || !mix.music) return; metalHit.play({ context, buffer: mix.noiseBuffer, time, velocity, decay, frequency, destination: mix.music, offset: Math.random() }); },
    player(context, time, midi, velocity, decay, bright) { const mix = runtime.mix(); if (!mix?.sfx) return; noteVoice.play({ context, time, midi, velocity, decay, bright, destination: mix.sfx, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : [] }); },
  }, { kick: ['velocity'], bass: ['midi', 'velocity'], horn: ['midi', 'velocity', 'duration'], metal: ['velocity', 'decay', 'frequency'], player: ['midi', 'velocity', 'decay', 'bright'] });

  const ambientArrangement = createArrangement<Chord>({ stepsPerBar: 16, chordAt: score.chordAt, sections: [{ name: 'ship-idle', fromBar: 0, tracks: [fn(({ time, step, chord }) => { if (step === 0) inst.horn(time, chord.bass + 12, 0.045, 1.1); if (step === 10) inst.metal(time, 0.025, 0.25, 480); })] }] });
  const runTrack = fn<Chord>(({ time, step, bar, chord }) => {
    const act = bar < 4 ? 0 : bar < 12 ? 1 : bar < 20 ? 2 : 3;
    if (step === 0 || (act >= 1 && step === 8) || (act >= 3 && step === 10)) inst.kick(time, step === 0 ? 1 : 0.65);
    if (step === 0 || step === 6 || step === 10) inst.bass(time, chord.bass + (step === 10 ? 7 : 0), act === 0 ? 0.35 : 0.65);
    if ((act >= 1 && (step === 4 || step === 12)) || (act >= 2 && step % 4 === 2)) inst.metal(time, 0.035 + act * 0.012, 0.045 + (step % 3) * 0.02, 1300 + step * 230);
    if (bar === HULL_RUN_CVS3_BARS.wake && step === 0) inst.horn(time, 46, 0.14, 0.9);
    if (bar >= HULL_RUN_CVS3_BARS.batteries && step % 2 === 1) inst.metal(time, 0.025, 0.025, 6200);
    if (bar >= HULL_RUN_CVS3_BARS.redline && step === 12) inst.horn(time, 46 + (bar % 2) * 3, 0.075, 0.42);
    if (bar >= HULL_RUN_CVS3_BARS.boss && bar < HULL_RUN_CVS3_BARS.wreck && step % 2 === 0) inst.kick(time, step % 4 === 0 ? 0.8 : 0.48);
    if (bar >= HULL_RUN_CVS3_BARS.wreck && step === 0) inst.horn(time, chord.bass + 24, 0.07, 1.4);
  });
  const runArrangement = createArrangement<Chord>({
    stepsPerBar: 16, chordAt: score.chordAt, trace, emitSections: true,
    sections: HULL_RUN_CVS3_SECTIONS.map((section) => ({ name: section.name, fromBar: section.fromBar, toBar: section.toBar, tracks: [runTrack] })),
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) { if (mode === 'ambient') ambientArrangement.schedule(position, time); else runArrangement.schedule(position, time); }
  const action = (lockCount = 1) => {
    const ctx = runtime.context(); if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime); const position = score.arrangementPositionAt(time); const chord = score.chordAt(position);
    return { time, chord, lead: score.leadSetAt(position), midi: score.leadSetAt(position)[Math.min(lockCount - 1, 5)] ?? 70 };
  };
  bus.on('spawn', ({ kind }) => { if (kind === 'shell' || kind === 'turret') { const ctx = runtime.context(); if (ctx) inst.metal(ctx.currentTime, kind === 'turret' ? 0.16 : 0.055, kind === 'turret' ? 0.5 : 0.08, kind === 'turret' ? 320 : 2500); } });
  bus.on('lock', ({ lockCount }) => { const a = action(lockCount); if (a) inst.player(a.time, a.midi + 12, 0.055 + lockCount * 0.008, 0.09, 2200 + lockCount * 280); });
  bus.on('unlock', () => { const ctx = runtime.context(); if (ctx) inst.player(ctx.currentTime, 55, 0.035, 0.07, 900); });
  bus.on('fire', ({ volleySize }) => { const a = action(volleySize); if (a) { inst.player(a.time, a.chord.bass + 24, 0.12, 0.16, 1200); inst.metal(a.time, 0.065 + volleySize * 0.008, 0.05, 3400); } });
  bus.on('hit', ({ lethal, hitStageIndex }) => { if (lethal) return; const a = action(); if (a) inst.player(a.time, a.chord.bass + 31 + hitStageIndex * 3, 0.08, 0.18, 1600 + hitStageIndex * 500); });
  bus.on('kill', () => { const ctx = runtime.context(); if (!ctx) return; const kill = score.nextKill(ctx.currentTime); inst.player(kill.time, kill.midi + 12, 0.145, 0.34, 2800); inst.metal(kill.time, 0.07, 0.12, 1800); });
  bus.on('miss', () => { const ctx = runtime.context(); if (ctx) inst.horn(ctx.currentTime, 34, 0.055, 0.18); });
  bus.on('reject', () => { const ctx = runtime.context(); if (!ctx) return; inst.metal(ctx.currentTime, 0.14, 0.14, 420); inst.player(ctx.currentTime + 0.02, 41, 0.06, 0.16, 650); });
  bus.on('playerhit', () => { const ctx = runtime.context(); if (ctx) { inst.kick(ctx.currentTime, 1); inst.horn(ctx.currentTime, 29, 0.12, 0.35); } });
  bus.on('stage', ({ stageIndex }) => { const a = action(); if (a) { inst.horn(a.time, 46 + stageIndex * 5, 0.16, 0.55); inst.metal(a.time, 0.18, 0.34, 680); } });
  return runtime;
}
