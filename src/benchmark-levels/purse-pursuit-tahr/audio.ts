import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import {
  PURSE_PURSUIT_BARS,
  PURSE_PURSUIT_BPM,
  PURSE_PURSUIT_DURATION,
  PURSE_PURSUIT_SCORE_SECTIONS,
  PURSE_PURSUIT_SECTIONS,
  PURSE_PURSUIT_STEPS_PER_BAR,
  PURSE_PURSUIT_TIME,
  type PurseSection,
} from './timing';

type Chord = { bass: number; tones: readonly number[]; hook: readonly number[] };

const CHORDS: readonly Chord[] = [
  { bass: 38, tones: [62, 65, 69, 72, 74, 77], hook: [74, 77, 81, 84] }, // Dm9
  { bass: 34, tones: [58, 62, 65, 69, 72, 74], hook: [72, 74, 77, 81] }, // Bbmaj7
  { bass: 41, tones: [65, 69, 72, 76, 77, 81], hook: [72, 76, 77, 81] }, // Fmaj7
  { bass: 36, tones: [60, 64, 67, 70, 72, 76], hook: [70, 72, 76, 79] }, // C7
] as const;

const VICTORY_CHORDS: readonly Chord[] = [
  { bass: 38, tones: [62, 66, 69, 74, 78, 81], hook: [74, 78, 81, 86] },
] as const;

const KILL_LANES: Record<PurseSection, readonly number[]> = {
  0: [0, 1, 2, 1, 3, 2, 4, 3, 1, 2, 3, 5, 4, 3, 2, 1],
  1: [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 5, 3, 1, 4, 2, 5],
  2: [5, 3, 4, 2, 3, 1, 4, 5, 2, 4, 1, 3, 5, 4, 2, 0],
  3: [0, 3, 5, 4, 2, 5, 3, 1, 4, 2, 5, 3, 4, 5, 2, 1],
  4: [0, 2, 4, 5, 4, 3, 5, 4, 2, 3, 1, 2, 0, 1, 2, 0],
};

const STEP = PURSE_PURSUIT_TIME.stepSeconds;
const SECTION_HITS = new Set<number>([
  PURSE_PURSUIT_BARS.slipstream,
  PURSE_PURSUIT_BARS.crossTraffic,
  PURSE_PURSUIT_BARS.overpass,
  PURSE_PURSUIT_BARS.boss,
  PURSE_PURSUIT_BARS.victory,
]);

export function createAudio(bus: EventBus) {
  return createPurseAudio(bus).audio;
}

export const tracePursePursuitTahrAudio = createAudioTraceHarness({
  level: 'purse-pursuit-tahr',
  bpm: PURSE_PURSUIT_BPM,
  stepSeconds: STEP,
  defaultSeconds: PURSE_PURSUIT_DURATION,
  createAudio: createPurseAudio,
});

function createPurseAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, PurseSection>({
    bpm: PURSE_PURSUIT_BPM,
    stepsPerBar: PURSE_PURSUIT_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: PURSE_PURSUIT_BARS.victory, chords: VICTORY_CHORDS, barsPerChord: 1 }],
    sections: PURSE_PURSUIT_SCORE_SECTIONS,
    leadSet: (chord) => chord.tones,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: PURSE_PURSUIT_BPM,
    stepSeconds: STEP,
    stepsPerBar: PURSE_PURSUIT_STEPS_PER_BAR,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.76,
    scheduleAhead: 0.13,
    schedulerMs: 20,
    mix: {
      compressor: { threshold: -18, ratio: 5.5, attack: 0.004, release: 0.19 },
      delay: { time: STEP * 3, feedback: 0.27, dampHz: 3100, sendGain: 0.22, returnTo: 'master' },
      reverb: { seconds: 2.1, decay: 2.4, level: 0.32, returnTo: 'master' },
      noiseSeconds: 1.8,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunEnd() {
      const ctx = runtime.context();
      if (!ctx) return;
      inst.pad(ctx.currentTime + 0.04, 62, 0.12, 2.8);
      inst.chime(ctx.currentTime + 0.08, 86, 0.16, 1.4);
    },
  });

  const kickVoice = voice<{ velocity: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.2,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [
      { type: 'set', value: 145, time },
      { type: 'exponentialRamp', value: 43, time: time + 0.14 },
    ],
    gainAutomation: (time, _gain, { velocity }) => [
      { type: 'set', value: velocity * 0.48, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });
  const bassVoice = voice<{ velocity: number; duration: number; bright: number }>({
    oscillators: [{ type: 'sawtooth', detune: -7 }, { type: 'square', detune: 7, gain: 0.16 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ bright }) => bright, Q: 0.8 },
    gainAutomation: (time, _gain, { velocity, duration }) => [
      { type: 'set', value: velocity * 0.22, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });
  const pluckVoice = voice<{ velocity: number; decay: number; bright: number }>({
    oscillators: [{ type: 'triangle' }, { type: 'square', gain: 0.12, detune: 8 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    filter: { type: 'bandpass', cutoff: ({ bright }) => bright, Q: 2.3 },
    gainAutomation: (time, _gain, { velocity, decay }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });
  const leadVoice = voice<{ velocity: number; duration: number; bright: number }>({
    oscillators: [{ type: 'sawtooth', detune: -9 }, { type: 'sawtooth', detune: 9, gain: 0.7 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ bright }) => bright, Q: 1.2 },
    gainAutomation: (time, _gain, { velocity, duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: velocity * 0.12, time: time + 0.025 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });
  const padVoice = voice<{ velocity: number; duration: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', detune: 7, gain: 0.3 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 1300 },
    gainAutomation: (time, _gain, { velocity, duration }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: velocity, time: time + Math.min(0.16, duration * 0.2) },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });
  const noise = noiseHit({ filterType: 'highpass', frequency: 4200, decay: 0.05 });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    kick(context, time, velocity) {
      const output = runtime.mix()?.duck;
      if (!output) return;
      kickVoice.play({ context, time, frequency: 110, velocity, destination: output });
      runtime.mix()?.duckAt(time, 0.48, 0.16);
    },
    bass(context, time, midi, velocity, duration, bright) {
      const output = runtime.mix()?.music;
      if (output) bassVoice.play({ context, time, midi, velocity, duration, bright, destination: output });
    },
    pluck(context, time, midi, velocity, decay, bright) {
      const mix = runtime.mix();
      if (!mix?.music) return;
      pluckVoice.play({ context, time, midi, velocity, decay, bright, destination: mix.music, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.45 }] : [] });
    },
    player(context, time, midi, velocity, decay, bright) {
      const mix = runtime.mix();
      if (!mix?.sfx) return;
      pluckVoice.play({ context, time, midi, velocity, decay, bright, destination: mix.sfx, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.38 }] : [] });
    },
    lead(context, time, midi, velocity, duration, bright) {
      const output = runtime.mix()?.music;
      if (output) leadVoice.play({ context, time, midi, velocity, duration, bright, destination: output });
    },
    pad(context, time, midi, velocity, duration) {
      const output = runtime.mix()?.music;
      if (output) padVoice.play({ context, time, midi, velocity, duration, destination: output });
    },
    hat(context, time, velocity, frequency, decay) {
      const mix = runtime.mix();
      if (mix?.noiseBuffer && mix.music) noise.play({ context, buffer: mix.noiseBuffer, time, velocity, frequency, decay, destination: mix.music, offset: Math.random() });
    },
    impact(context, time, velocity, frequency, decay) {
      const mix = runtime.mix();
      if (mix?.noiseBuffer && mix.sfx) noise.play({ context, buffer: mix.noiseBuffer, time, velocity, frequency, decay, destination: mix.sfx, offset: Math.random() });
    },
    chime(context, time, midi, velocity, decay) {
      const mix = runtime.mix();
      if (!mix?.sfx) return;
      pluckVoice.play({ context, time, midi, velocity, decay, bright: 5200, destination: mix.sfx, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.65 }] : [] });
    },
  }, {
    kick: ['velocity'], bass: ['midi', 'velocity', 'duration', 'bright'], pluck: ['midi', 'velocity', 'decay', 'bright'],
    player: ['midi', 'velocity', 'decay', 'bright'], lead: ['midi', 'velocity', 'duration', 'bright'], pad: ['midi', 'velocity', 'duration'],
    hat: ['velocity', 'frequency', 'decay'], impact: ['velocity', 'frequency', 'decay'], chime: ['midi', 'velocity', 'decay'],
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: PURSE_PURSUIT_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{ name: 'night-idle', fromBar: 0, tracks: [fn(({ time, step, chord }) => {
      if (step === 0) inst.pad(time, chord.bass + 24, 0.035, 1.8);
      if (step === 10) inst.hat(time, 0.018, 7200, 0.025);
    })] }],
  });

  const runTrack = fn<Chord>(({ time, step, bar, chord }) => {
    const victory = bar >= PURSE_PURSUIT_BARS.victory;
    const boss = bar >= PURSE_PURSUIT_BARS.boss && !victory;
    const drop = bar >= PURSE_PURSUIT_BARS.crossTraffic;
    const build = bar >= PURSE_PURSUIT_BARS.slipstream;

    if (!victory && step % 4 === 0) inst.kick(time, step === 0 ? 1 : boss ? 0.86 : 0.72);
    if (victory && (step === 0 || step === 8)) inst.kick(time, 0.5);
    if ((build && (step === 4 || step === 12)) || (!build && step === 12)) inst.hat(time, 0.105, 1800, 0.07);
    if (!victory && step % 2 === 1) inst.hat(time, 0.022 + (drop ? 0.018 : 0) + (boss ? 0.016 : 0), boss ? 9000 : 7200, 0.028);
    if (boss && step % 2 === 0) inst.hat(time, 0.022, 11200, 0.018);

    const bassSteps: Record<number, [number, number]> = { 0: [0, 0.85], 3: [0, 0.45], 6: [7, 0.54], 8: [12, 0.72], 11: [7, 0.5], 14: [12, 0.6] };
    const bassStep = bassSteps[step];
    if (bassStep && !victory) inst.bass(time, chord.bass + bassStep[0], bassStep[1], STEP * (boss ? 2.4 : 1.8), boss ? 900 : 700);
    if (victory && step === 0) {
      inst.pad(time, chord.bass + 24, 0.09, STEP * 15);
      inst.bass(time, chord.bass, 0.42, STEP * 7, 560);
    }

    if (build && !victory && step % 2 === 0) {
      const order = [0, 2, 1, 3, 2, 4, 3, 1];
      inst.pluck(time, chord.tones[order[(step / 2) % order.length]], drop ? 0.055 : 0.04, STEP * 1.5, drop ? 3600 : 2700);
    }

    const hookSteps = [0, 3, 6, 8, 10, 14];
    const hookIndex = hookSteps.indexOf(step);
    if ((drop || victory) && hookIndex >= 0) {
      const note = chord.hook[(hookIndex + bar) % chord.hook.length];
      inst.lead(time, note + (boss ? -12 : 0), victory ? 0.95 : boss ? 0.62 : 0.5, STEP * (victory ? 2.7 : 1.7), victory ? 4200 : 2800 + (bar - PURSE_PURSUIT_BARS.crossTraffic) * 80);
    }
    if (step === 0 && bar % 2 === 0) inst.pad(time, chord.bass + 24, boss ? 0.035 : 0.052, STEP * 30);
    if (SECTION_HITS.has(bar) && step === 0) {
      inst.impact(time, boss ? 0.18 : 0.11, boss ? 520 : 1100, boss ? 0.28 : 0.16);
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: PURSE_PURSUIT_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: PURSE_PURSUIT_SECTIONS.map((section) => ({ name: section.name, fromBar: section.fromBar, toBar: section.toBar, tracks: [runTrack] })),
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  function action(lockCount = 1) {
    const ctx = runtime.context();
    if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const lead = score.leadSetAt(position);
    return { time, chord, midi: lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))] ?? 74 };
  }

  bus.on('spawn', ({ kind }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    if (kind === 'bomb' || kind === 'spike') {
      inst.player(ctx.currentTime, kind === 'bomb' ? 50 : 47, 0.1, 0.24, 850);
      inst.impact(ctx.currentTime + 0.03, 0.085, 1300, 0.12);
    }
  });
  bus.on('lock', ({ lockCount }) => {
    const a = action(lockCount);
    if (a) inst.player(a.time, a.midi + 12, 0.052 + lockCount * 0.008, 0.095, 2600 + lockCount * 280);
  });
  bus.on('unlock', () => {
    const ctx = runtime.context();
    if (ctx) inst.player(ctx.currentTime, 57, 0.035, 0.08, 900);
  });
  bus.on('fire', ({ volleySize }) => {
    const a = action(volleySize);
    if (!a) return;
    inst.player(a.time, a.chord.bass + 24, 0.12 + volleySize * 0.008, 0.19, 1450);
    inst.impact(a.time, 0.05 + volleySize * 0.009, 3600, 0.055);
    runtime.mix()?.duckAt(a.time, 0.78, 0.1);
  });
  bus.on('hit', ({ lethal, hitStageIndex, hitStageCount }) => {
    if (lethal) return;
    const a = action();
    if (a) inst.player(a.time, a.chord.bass + 31 + hitStageIndex * 3, 0.082 + hitStageCount * 0.008, 0.18, 1750 + hitStageIndex * 520);
  });
  bus.on('kill', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    inst.player(kill.time, kill.midi + 12, 0.14, 0.32, 3600);
    inst.impact(kill.time + 0.01, 0.055, 2500, 0.08);
  });
  bus.on('stage', ({ stageIndex }) => {
    const a = action();
    if (!a) return;
    inst.lead(a.time, 62 + stageIndex * 5, 0.9, 0.55, 1800 + stageIndex * 700);
    inst.impact(a.time, 0.2, 520 + stageIndex * 180, 0.3);
  });
  bus.on('bossphase', ({ phase }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    if (phase === 'summoned') {
      inst.bass(ctx.currentTime, 26, 1, 0.8, 620);
      inst.impact(ctx.currentTime, 0.22, 380, 0.42);
    } else if (phase === 'exposed') {
      inst.lead(ctx.currentTime, 74, 1, 0.72, 2700);
    } else {
      runtime.mix()?.duckAt(ctx.currentTime, 0.2, 0.7);
      [74, 78, 81, 86].forEach((midi, index) => inst.chime(ctx.currentTime + 0.05 + index * STEP * 2, midi, 0.18, 0.8));
      inst.impact(ctx.currentTime + 0.02, 0.28, 310, 0.52);
    }
  });
  bus.on('reject', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.player(ctx.currentTime, 43, 0.09, 0.19, 620);
    inst.impact(ctx.currentTime, 0.16, 480, 0.18);
  });
  bus.on('miss', () => {
    const ctx = runtime.context();
    if (ctx) inst.player(ctx.currentTime, 50, 0.042, 0.13, 820);
  });
  bus.on('playerhit', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.kick(ctx.currentTime, 1);
    inst.impact(ctx.currentTime, 0.22, 280, 0.34);
  });

  return runtime;
}
