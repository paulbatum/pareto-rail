import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { HULL_RUN_NS5N_BPM, HULL_RUN_NS5N_RUN_DURATION, HULL_RUN_NS5N_TIME } from './gameplay';

const STEPS = 16;
const STEP_SECONDS = HULL_RUN_NS5N_TIME.stepSeconds;

type Section = 'dark' | 'wake' | 'batteries' | 'alert' | 'turret' | 'escape';
type Chord = { root: number; lead: readonly number[] };

const CHORDS: readonly Chord[] = [
  { root: 31, lead: [55, 58, 60, 62, 65, 67, 70, 72] },
  { root: 29, lead: [53, 55, 58, 60, 62, 65, 67, 70] },
  { root: 34, lead: [58, 60, 62, 65, 67, 70, 72, 74] },
  { root: 27, lead: [51, 53, 55, 58, 60, 62, 65, 67] },
];

const SECTIONS = [
  { index: 'dark', fromBar: 0 }, { index: 'wake', fromBar: 4 }, { index: 'batteries', fromBar: 12 },
  { index: 'alert', fromBar: 20 }, { index: 'turret', fromBar: 27 }, { index: 'escape', fromBar: 36 },
] as const;

const KILL_LANES: Record<Section, readonly number[]> = {
  dark: [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 4, 3, 5, 4, 2, 1],
  wake: [2, 3, 4, 2, 5, 4, 3, 1, 2, 4, 5, 6, 4, 3, 2, 0],
  batteries: [3, 5, 4, 6, 5, 3, 4, 2, 3, 4, 6, 7, 5, 4, 2, 1],
  alert: [4, 5, 7, 6, 4, 3, 5, 6, 7, 5, 4, 2, 3, 5, 6, 4],
  turret: [2, 2, 5, 4, 7, 6, 5, 3, 2, 4, 6, 7, 6, 4, 3, 1],
  escape: [7, 6, 5, 4, 3, 2, 1, 0, 4, 3, 2, 1, 0, 2, 4, 7],
};

const drumVoice = voice({
  oscillators: [{ type: 'sine', gain: 1 }, { type: 'triangle', gain: 0.22, frequencyRatio: 2 }],
  duration: 0.2,
  gainAutomation: (time, gain) => [
    { type: 'set', value: gain, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
  ],
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency * 1.9, time }, { type: 'exponentialRamp', value: frequency, time: time + 0.075 },
  ],
});

const bassVoice = voice({
  oscillators: [{ type: 'sawtooth', gain: 0.32 }, { type: 'square', gain: 0.08, octave: -1 }],
  duration: 0.46,
  filter: { type: 'lowpass', frequency: 430, Q: 5, frequencyAutomation: (time) => [{ type: 'set', value: 620, time }, { type: 'exponentialRamp', value: 130, time: time + 0.42 }] },
  envelope: { attack: 0.006, decay: 0.4, peak: 0.13 },
});

const metalVoice = voice({
  oscillators: [
    { type: 'square', gain: 0.25, frequencyRatio: 1 },
    { type: 'square', gain: 0.16, frequencyRatio: 1.414 },
    { type: 'sawtooth', gain: 0.1, frequencyRatio: 2.17 },
  ],
  duration: 0.26,
  filter: { type: 'bandpass', frequency: 2100, Q: 2.6 },
  envelope: { attack: 0.002, decay: 0.24, peak: 0.12 },
});

const klaxonVoice = voice({
  oscillators: [{ type: 'sawtooth', gain: 0.25 }, { type: 'square', gain: 0.09, detune: -13 }],
  duration: 0.7,
  filter: { type: 'lowpass', frequency: 900, Q: 4 },
  gainAutomation: (time, gain) => [
    { type: 'set', value: 0.001, time }, { type: 'linearRamp', value: gain, time: time + 0.05 },
    { type: 'set', value: gain, time: time + 0.48 }, { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
  ],
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency, time }, { type: 'linearRamp', value: frequency * 1.059, time: time + 0.3 },
    { type: 'linearRamp', value: frequency, time: time + 0.6 },
  ],
});

const playerVoice = voice({
  oscillators: [{ type: 'triangle', gain: 0.55 }, { type: 'sine', gain: 0.3, octave: 1 }],
  duration: 0.28,
  filter: { type: 'bandpass', frequency: 2400, Q: 1.4 },
  envelope: { attack: 0.003, decay: 0.25, peak: 0.11 },
});

const noise = noiseHit({ filterType: 'bandpass', frequency: 1700, decay: 0.08 });

export function createAudio(bus: EventBus) { return createHullRunAudio(bus).audio; }

export const traceHullRunNs5nAudio = createAudioTraceHarness({
  level: 'hull-run-ns5n', bpm: HULL_RUN_NS5N_BPM, stepSeconds: STEP_SECONDS,
  defaultSeconds: HULL_RUN_NS5N_RUN_DURATION, createAudio: createHullRunAudio,
});

function createHullRunAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Section>({
    bpm: HULL_RUN_NS5N_BPM, stepsPerBar: STEPS, chords: CHORDS, barsPerChord: 2,
    sections: SECTIONS, leadSet: (chord) => chord.lead, killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus, trace, score, bpm: HULL_RUN_NS5N_BPM, stepSeconds: STEP_SECONDS, stepsPerBar: STEPS,
    scheduleAhead: 0.14, schedulerMs: 25, volumeScale: 0.72, runAlignment: 'bar', beatNumber: 'position',
    mix: {
      compressor: { threshold: -19, ratio: 5.5, attack: 0.004, release: 0.2 }, noiseSeconds: 2,
      delay: { maxTime: 1, time: STEP_SECONDS * 3, feedback: 0.24, dampHz: 1700, dampType: 'lowpass', sendGain: 0.25, returnTo: 'master' },
      reverb: { seconds: 0.75, decay: 2.4, level: 0.15, returnTo: 'master' },
    },
    onStep: scheduleStep,
    onRunEnd() {
      const context = runtime.context(); if (!context) return;
      const time = context.currentTime + 0.04;
      inst.klaxon(time, 43, 0.11); inst.metal(time + 0.31, 79, 0.16);
    },
  });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    kick(context, time, velocity = 1) { const mix = runtime.mix(); if (mix?.music) drumVoice.play({ context, time, frequency: 47, velocity: velocity * 0.72, destination: mix.music }); },
    metal(context, time, midi = 82, velocity = 1) {
      const mix = runtime.mix(); if (!mix?.music || !mix.noiseBuffer) return;
      metalVoice.play({ context, time, midi, velocity, destination: mix.music, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.2 }] : undefined });
      noise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * 0.28, decay: 0.055, frequency: 3300, destination: mix.music, offset: Math.random() * 1.5 });
    },
    hiss(context, time, velocity = 1, high = 6400) { const mix = runtime.mix(); if (mix?.music && mix.noiseBuffer) noise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * 0.11, decay: 0.035, frequency: high, filterType: 'highpass', destination: mix.music, offset: Math.random() * 1.5 }); },
    bass(context, time, midi, velocity = 1) { const mix = runtime.mix(); if (mix?.music) bassVoice.play({ context, time, midi, velocity, destination: mix.music }); },
    klaxon(context, time, midi = 43, velocity = 1) { const mix = runtime.mix(); if (mix?.music) klaxonVoice.play({ context, time, midi, velocity, destination: mix.music, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.18 }] : undefined }); },
    player(context, time, midi, velocity = 1, decay = 0.28) { const mix = runtime.mix(); if (mix?.sfx) playerVoice.play({ context, time, midi, velocity, duration: decay, destination: mix.sfx, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.22 }] : undefined }); },
    impact(context, time, velocity = 1, frequency = 1300) { const mix = runtime.mix(); if (mix?.sfx && mix.noiseBuffer) noise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * 0.34, decay: 0.13, frequency, destination: mix.sfx, offset: Math.random() * 1.5 }); },
  });

  function scheduleStep({ time, step, bar, mode, position }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      if (step === 0) inst.metal(time, 58, 0.22);
      if (step === 12) inst.hiss(time, 0.2, 4200);
      return;
    }
    const chord = score.chordAt(position);
    if (bar < 36 && (step === 0 || step === 8 || (bar >= 20 && (step === 6 || step === 14)))) inst.kick(time, step === 0 ? 1 : 0.68);
    if (bar >= 4 && bar < 36 && (step === 4 || step === 12)) inst.metal(time, 71 + (bar % 3) * 3, bar >= 12 ? 0.66 : 0.42);
    if (bar >= 4 && bar < 36 && step % (bar >= 20 ? 2 : 4) === 2) inst.hiss(time, bar >= 20 ? 0.65 : 0.34, bar >= 20 ? 7800 : 5600);
    if (bar >= 8 && bar < 36 && (step === 0 || step === 10 || (bar >= 20 && step === 6))) inst.bass(time, chord.root, bar >= 20 ? 0.9 : 0.64);
    if (bar >= 12 && bar < 36 && step === 15) inst.metal(time, 88, 0.28);
    if ((bar === 4 || bar === 12 || bar === 20 || bar === 27) && (step === 0 || step === 8)) inst.klaxon(time, bar === 27 ? 39 : 43, bar === 27 ? 1 : 0.55);
    if (bar >= 27 && bar < 36 && (step === 3 || step === 7 || step === 11 || step === 15)) inst.metal(time, 52, 0.58);
    if (bar >= 36 && step % 4 === 0) inst.hiss(time, 0.25 * (1 - step / 20), 7200);
  }

  const positionAt = (time: number) => score.arrangementPositionAt(time);
  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context(); if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime); const lead = score.leadSetAt(positionAt(time));
    inst.player(time, lead[Math.min(lead.length - 1, lockCount + 1)], 0.56 + lockCount * 0.055, 0.15);
  });
  bus.on('unlock', () => { const context = runtime.context(); if (context) inst.player(context.currentTime, 51, 0.28, 0.1); });
  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context(); if (!context) return; const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(positionAt(time)); inst.player(time, chord.root + 24, 0.65 + volleySize * 0.07, 0.24); inst.impact(time, volleySize === 6 ? 1 : 0.45, 720);
    if (volleySize === 6) runtime.mix()?.duckAt(time, 0.72, 0.2);
  });
  bus.on('hit', ({ lethal, stageCompleted }) => { const context = runtime.context(); if (context) inst.impact(context.currentTime, stageCompleted ? 0.9 : lethal ? 0.62 : 0.35, stageCompleted ? 520 : 1450); });
  bus.on('kill', () => {
    const context = runtime.context(); if (!context) return; const kill = score.nextKill(context.currentTime);
    inst.player(kill.time, kill.midi, 0.8, 0.38); inst.metal(kill.time, kill.midi + 17, 0.32);
  });
  bus.on('stage', ({ stageIndex }) => {
    const context = runtime.context(); if (!context) return; const time = score.quantizePlayerAction(context.currentTime);
    runtime.mix()?.duckAt(time, 0.58, 0.34); inst.klaxon(time, 43 + stageIndex * 3, 0.72); inst.impact(time, 1, 420);
  });
  bus.on('miss', () => { const context = runtime.context(); if (context) { inst.player(context.currentTime, 46, 0.24, 0.2); inst.hiss(context.currentTime, 0.5, 2500); } });
  bus.on('reject', () => { const context = runtime.context(); if (context) { inst.klaxon(context.currentTime, 37, 0.32); inst.impact(context.currentTime, 0.55, 390); } });
  bus.on('playerhit', () => { const context = runtime.context(); if (context) { runtime.mix()?.duckAt(context.currentTime, 0.42, 0.46); inst.impact(context.currentTime, 1, 210); } });
  bus.on('bossphase', ({ phase }) => { const context = runtime.context(); if (context && phase === 'destroyed') { const time = score.nextGridTime(context.currentTime, 2); runtime.mix()?.duckAt(time, 0.28, 0.8); inst.klaxon(time, 31, 1); inst.metal(time + STEP_SECONDS * 2, 91, 1); } });

  return runtime;
}
