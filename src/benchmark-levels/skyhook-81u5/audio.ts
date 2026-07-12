import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import {
  SKYHOOK_BARS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_SCORE_SECTIONS,
  SKYHOOK_STEPS_PER_BAR,
  SKYHOOK_TIME,
  type SkyhookSection,
} from './timing';

const STEP = SKYHOOK_TIME.stepSeconds;

type Chord = { bass: number; pad: readonly number[]; lead: readonly number[] };
const CHORDS: readonly Chord[] = [
  { bass: 38, pad: [50, 57, 62, 66], lead: [62, 66, 69, 74, 78, 81, 86, 90] }, // D
  { bass: 35, pad: [47, 54, 59, 62], lead: [59, 62, 66, 71, 74, 78, 83, 86] }, // Bm
  { bass: 42, pad: [54, 61, 66, 69], lead: [61, 66, 69, 73, 78, 81, 85, 90] }, // F#m/A
  { bass: 40, pad: [52, 59, 64, 69], lead: [59, 64, 69, 71, 76, 81, 83, 88] }, // Em
];

const KILL_LANES: Record<SkyhookSection, readonly number[]> = {
  storm: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 5, 6, 4, 6, 5, 7],
  sun: [2, 3, 4, 6, 5, 4, 6, 7, 5, 4, 3, 5, 6, 7, 6, 4],
  thin: [6, 5, 4, 3, 5, 4, 2, 3, 4, 6, 5, 7, 6, 4, 3, 1],
  boss: [7, 5, 6, 4, 5, 3, 4, 2, 3, 1, 2, 0, 3, 4, 5, 7],
  dock: [7, 6, 5, 4, 3, 2, 1, 0, 2, 1, 0, 0, 0, 0, 0, 0],
};

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-81u5',
  bpm: SKYHOOK_BPM,
  stepSeconds: STEP,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, SkyhookSection>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: SKYHOOK_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: SKYHOOK_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  let bossId = -1;
  let bossMaxHp = 6;
  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    stepSeconds: STEP,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.76,
    mix: {
      compressor: { threshold: -19, ratio: 4.5, attack: 0.006, release: 0.28 },
      delay: { time: STEP * 3, feedback: 0.28, dampHz: 2100 },
      reverb: { seconds: 3.2, decay: 2.8, level: 0.44 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() { bossId = -1; bossMaxHp = 6; },
    onRunEnd() {
      const ctx = runtime.context();
      if (ctx) inst.chime(ctx.currentTime + 0.04, [62, 69, 74, 78], 0.12, 4.5);
    },
  });

  const toneVoice = voice({
    oscillators: [{ type: 'triangle' }, { type: 'sine', detune: 7, gain: 0.35 }],
    duration: 0.55,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 2800 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.13, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
    ],
  });
  const pulseVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.72,
    filter: { type: 'lowpass', frequency: 540 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.2, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });
  const airHit = noiseHit({ filterType: 'bandpass', frequency: 1050, decay: 0.34 });
  const tickHit = noiseHit({ filterType: 'highpass', frequency: 4300, decay: 0.045 });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    pulse(context, time, midi, velocity = 1) {
      const destination = runtime.mix()?.master;
      if (destination) pulseVoice.play({ context, time, midi, velocity, destination });
    },
    tone(context, time, midi, velocity = 1) {
      const mix = runtime.mix();
      if (!mix?.master) return;
      toneVoice.play({ context, time, midi, velocity, destination: mix.master });
    },
    air(context, time, velocity, decay = 0.3) {
      const mix = runtime.mix();
      if (!mix?.master || !mix.noiseBuffer) return;
      airHit.play({ context, buffer: mix.noiseBuffer, time, velocity, decay, destination: mix.master, offset: (time * 0.37) % 1.4 });
    },
    tick(context, time, velocity) {
      const mix = runtime.mix();
      if (!mix?.master || !mix.noiseBuffer) return;
      tickHit.play({ context, buffer: mix.noiseBuffer, time, velocity, destination: mix.master, offset: (time * 0.61) % 1.5 });
    },
    chime(context, time, notes: readonly number[], velocity, decay) {
      const mix = runtime.mix();
      if (!mix?.master) return;
      for (const [index, midi] of notes.entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(midiToFreq(midi), time);
        gain.gain.setValueAtTime(velocity / Math.sqrt(notes.length), time + index * 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        oscillator.connect(gain).connect(mix.master);
        if (mix.reverbSend) gain.connect(mix.reverbSend);
        oscillator.start(time + index * 0.012);
        oscillator.stop(time + decay + 0.05);
      }
    },
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: SKYHOOK_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'weather', fromBar: 0, toBar: SKYHOOK_BARS.cloudbreak,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 10) inst.pulse(time, chord.bass, 0.9);
          if (step === 4 || step === 12) inst.air(time, bar < 2 ? 0.05 : 0.09, 0.28);
          if (bar >= 2 && step % 4 === 2) inst.tick(time, 0.025 + bar * 0.004);
          if (step === 0 && bar % 2 === 0) inst.chime(time, chord.pad, 0.055, STEP * 30);
        })],
      },
      {
        name: 'cloudbreak', fromBar: SKYHOOK_BARS.cloudbreak, toBar: SKYHOOK_BARS.thinAir,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 8) inst.pulse(time, chord.bass, 0.72);
          if (step % 4 === 0) inst.tone(time, chord.lead[(step / 4 + bar) % chord.lead.length], 0.38);
          if (step === 6 || step === 14) inst.tick(time, 0.035);
          if (step === 0 && bar % 2 === 0) inst.chime(time, chord.pad, 0.065, STEP * 28);
        })],
      },
      {
        name: 'thin-air', fromBar: SKYHOOK_BARS.thinAir, toBar: SKYHOOK_BARS.boss,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0) inst.pulse(time, chord.bass, 0.5);
          if (step === (bar % 2 ? 12 : 4)) inst.tone(time, chord.lead[5], 0.25);
          if (step === 0 && bar % 2 === 1) inst.chime(time, chord.pad.slice(1), 0.045, STEP * 24);
        })],
      },
      {
        name: 'tether-crawler', fromBar: SKYHOOK_BARS.boss, toBar: SKYHOOK_BARS.clear,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 || (bar >= SKYHOOK_BARS.bossClose && step === 8)) inst.pulse(time, chord.bass - 12, 1.05);
          if (step === 4 || step === 12) inst.tick(time, 0.055 + (bar - SKYHOOK_BARS.boss) * 0.006);
          if (step === 0 && bar % 2 === 1) inst.chime(time, [chord.pad[0], chord.pad[2]], 0.05, STEP * 22);
        })],
      },
      {
        name: 'docking', fromBar: SKYHOOK_BARS.clear, toBar: SKYHOOK_BARS.end,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (bar === SKYHOOK_BARS.clear && step === 0) inst.chime(time, chord.pad, 0.1, STEP * 30);
          if (bar === SKYHOOK_BARS.docked && step === 0) inst.pulse(time, chord.bass, 0.18);
        })],
      },
    ],
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: SKYHOOK_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{ name: 'ambient', fromBar: 0, tracks: [fn(({ time, step, chord }) => {
      if (step === 0) inst.chime(time, chord.pad.slice(1), 0.025, STEP * 20);
    })] }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'run') runArrangement.schedule(position, time);
    else ambientArrangement.schedule(position, time);
  }

  bus.on('lock', ({ lockCount }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    inst.tone(time, lead[Math.min(lead.length - 1, lockCount - 1)], 0.55 + lockCount * 0.035);
  });
  bus.on('fire', ({ volleySize }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.pulse(time, chord.bass + (volleySize >= 6 ? 12 : 0), 0.7 + volleySize * 0.06);
    inst.air(time, 0.045 + volleySize * 0.01, 0.12);
  });
  bus.on('hit', ({ enemyId, hitPointsRemaining }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    if (enemyId === bossId) {
      const damage = 1 - hitPointsRemaining / bossMaxHp;
      inst.pulse(ctx.currentTime, 26 + Math.round(damage * 12), 0.6 + damage * 0.6);
    } else inst.tick(ctx.currentTime, 0.055);
  });
  bus.on('kill', ({ enemyId }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    if (enemyId === bossId) {
      const time = score.quantizePlayerAction(ctx.currentTime);
      inst.chime(time, [50, 57, 62, 66, 69, 74], 0.16, 5.5);
      inst.air(time, 0.17, 0.65);
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    inst.tone(kill.time, kill.midi, 0.8);
  });
  bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'boss') bossId = enemyId; });
  bus.on('stage', ({ enemyId, stageHitPoints, hitStageCount }) => {
    if (enemyId === bossId) bossMaxHp = Math.max(bossMaxHp, stageHitPoints * hitStageCount);
  });
  bus.on('miss', () => {
    const ctx = runtime.context();
    if (ctx) inst.pulse(ctx.currentTime, 30, 0.34);
  });
  bus.on('playerhit', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.air(ctx.currentTime, 0.2, 0.45);
    inst.pulse(ctx.currentTime, 25, 1.15);
  });
  bus.on('reject', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.tick(ctx.currentTime, 0.13);
    inst.pulse(ctx.currentTime + 0.015, 31, 0.42);
  });

  return runtime;
}
