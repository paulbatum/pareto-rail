import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, playNoiseHit, playOscillatorVoice } from '../../engine/audio-kit';
import { createScore } from '../../engine/score';
import { createArrangement, fn, hits } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { voice } from '../../engine/audio-voices';
import { THERMAL_INK_184U_BPM, TIME, fightFor } from './gameplay';

const CHORDS = [
  { bass: 26, arp: [62, 65, 69, 72] },
  { bass: 22, arp: [62, 65, 69, 70] },
  { bass: 29, arp: [60, 65, 69, 72] },
  { bass: 24, arp: [60, 64, 67, 74] },
];
type Chord = typeof CHORDS[number];
const MELODY = [0, 2, 1, 0, 3, 2, 1, 0];
export function createAudio(bus: EventBus) { return buildAudio(bus).audio; }
export const traceThermalAudio = createAudioTraceHarness({ level: 'thermal-ink-184u', bpm: THERMAL_INK_184U_BPM, stepSeconds: TIME.stepSeconds, defaultSeconds: 60, createAudio: buildAudio });
function buildAudio(bus: EventBus, trace?: AudioTraceSink) {
  const fight = fightFor(bus);
  const score = createScore<Chord, number>({
    bpm: THERMAL_INK_184U_BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2,
    sections: [{ index: 0, fromBar: 0 }, { index: 1, fromBar: 10 }, { index: 2, fromBar: 20 }],
    killLanes: { 0: [0, 1, 2, 3, 2, 1, 0, 2, 3, 4, 5, 4, 3, 2, 1, 0], 1: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 2, 3, 4, 5], 2: [7, 6, 5, 4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 5, 4, 0] },
  });
  const playerVoice = voice({ oscillators: [{ type: 'triangle', gain: 0.7 }, { type: 'sine', octave: 1, gain: 0.25 }], duration: 0.44, envelope: { decay: 0.42 }, filter: { type: 'lowpass', cutoff: 4200 } });
  const off: Array<() => void> = [];
  const runtime = createBeatLevelAudio({
    bus, trace, bpm: THERMAL_INK_184U_BPM, score, stepSeconds: TIME.stepSeconds, runAlignment: 'step', volumeScale: 0.8,
    mix: { compressor: { threshold: -19, ratio: 4, attack: 0.008, release: 0.2 }, delay: { time: TIME.stepSeconds * 3, feedback: 0.28, dampHz: 2500 }, noiseSeconds: 2 },
    onStep({ position, time, mode }) {
      if (mode === 'ambient') { if (position % 16 === 0) voices.tone(time, 50 + (position % 32 ? 3 : 0), 0.025, 2.2, 'sine', false); return; }
      if (position % 16 === 0) arrangement.recordSectionStart(time, position / 16);
      arrangement.schedule(position, time);
    },
    onDispose() { off.forEach(f => f()); },
  });
  const voices = defineInstruments({ context: runtime.context, trace }, {
    tone(ctx: AudioContext, time: number, midi: number, gain: number, decay: number, type: OscillatorType, sfx: boolean, cutoff = 2200) {
      const mix = runtime.mix(); if (!mix) return;
      playOscillatorVoice({ context: ctx, time, stopTime: time + decay + 0.02, oscillatorType: type, frequency: midiToFreq(midi), filter: { type: 'lowpass', frequency: cutoff }, gainAutomation: [{ type: 'set', value: 0.001, time }, { type: 'linearRamp', value: gain, time: time + 0.008 }, { type: 'exponentialRamp', value: 0.001, time: time + decay }], destination: sfx ? mix.sfx : mix.music, sends: mix.delaySend && midi > 50 ? [{ destination: mix.delaySend, gain: 0.2 }] : [] });
    },
    kick(ctx: AudioContext, time: number, gain: number) {
      const mix = runtime.mix(); if (!mix) return;
      playOscillatorVoice({ context: ctx, time, stopTime: time + 0.4, oscillatorType: 'sine', frequency: 118, frequencyAutomation: [{ type: 'exponentialRamp', value: 38, time: time + 0.14 }], gainAutomation: [{ type: 'set', value: gain, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.38 }], destination: mix.music });
    },
    metal(ctx: AudioContext, time: number, gain: number) {
      const mix = runtime.mix(); if (!mix?.noiseBuffer) return;
      playNoiseHit({ context: ctx, buffer: mix.noiseBuffer, time, velocity: gain * (fight.infrared ? 0.18 : 1), decay: 0.1, filterType: 'bandpass', frequency: 1900, destination: mix.music });
      for (const hz of [377, 623, 1033]) playOscillatorVoice({ context: ctx, time, stopTime: time + 0.23, oscillatorType: 'sine', frequency: hz, gainAutomation: [{ type: 'set', value: gain * 0.3, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.2 }], destination: mix.music });
    },
    solo(ctx: AudioContext, time: number, midi: number, gain: number) {
      const mix = runtime.mix(); if (!mix) return;
      playerVoice.play({ context: ctx, time, midi, velocity: gain, destination: mix.sfx, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : [] });
    },
  });
  const tracks = (intensity: number) => [
    hits<Chord>('K.......k..k....', { K: 0.48, k: 0.32 }, ({ time }, v) => voices.kick(time, v * (fight.coreDead ? 0.3 : 1))),
    hits<Chord>('B..b..u.B..b..b.', { B: 0.2, b: 0.14, u: 0.12 }, ({ time, chord }, v, symbol) => {
      voices.tone(time, chord.bass + (symbol === 'u' ? 12 : 0), v, 0.29, 'sawtooth', false, 340 + intensity * 100);
      voices.tone(time, chord.bass, v * 1.2, 0.31, 'sine', false);
    }),
    hits<Chord>(intensity > 1 ? '....M..m....M.m.' : '....M.......M...', { M: 0.055, m: 0.024 }, ({ time }, v) => voices.metal(time, v)),
    fn<Chord>(({ time, position, step, chord }) => {
      if (step === 0) for (const note of chord.arp.slice(0, 3)) voices.tone(time, note - 12, 0.018, 2.35, 'triangle', false, 550);
      if (position % 8 === 0) {
        const note = chord.arp[MELODY[Math.floor(position / 8) % 8]];
        voices.tone(time, note, fight.infrared ? 0.10 : 0.055, fight.infrared ? 0.7 : 1.05, fight.infrared ? 'triangle' : 'sine', false, fight.infrared ? 5200 : 1300);
      }
    }),
  ];
  const arrangement = createArrangement<Chord>({ trace, emitSections: true, stepsPerBar: 16, chordAt: score.chordAt, sections: [
    { name: 'Wrapped in wreckage', fromBar: 0, tracks: tracks(0) },
    { name: 'Below the arms', fromBar: 10, tracks: tracks(1) },
    { name: 'Final thermal blackout', fromBar: 20, tracks: tracks(2) },
    { name: 'Harbor returns', fromBar: 23, tracks: [fn(({ step, time }) => { if (step === 0) for (const n of [38, 50, 57, 65]) voices.tone(time, n, 0.07, 2.4, 'sine', false); })] },
  ] });
  const action = () => {
    const ctx = runtime.context(); if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime);
    return { time, chord: score.chordAt(score.arrangementPositionAt(time)) };
  };
  off.push(
    bus.on('lock', e => { const a = action(); if (a) voices.tone(a.time, a.chord.arp[(e.lockCount - 1) % 4] + 12, 0.05, 0.09, 'sine', true); }),
    bus.on('unlock', () => { const a = action(); if (a) voices.tone(a.time, a.chord.bass + 24, 0.045, 0.1, 'triangle', true); }),
    bus.on('fire', e => { const a = action(); if (a) voices.tone(a.time, a.chord.bass + 24, e.volleySize === 6 ? 0.11 : 0.065, 0.16, 'sawtooth', true, 1100); }),
    bus.on('hit', e => { if (e.lethal) return; const a = action(); if (a) { voices.tone(a.time, a.chord.bass + 12, e.stageCompleted ? 0.17 : 0.13, 0.3, 'triangle', true); voices.solo(a.time, a.chord.arp[Math.min(3, Math.max(0, 5 - e.hitPointsRemaining))], 0.12); } }),
    bus.on('kill', () => { const ctx = runtime.context(); if (!ctx) return; const n = score.nextKill(ctx.currentTime); voices.solo(n.time, n.midi, 0.17); }),
    bus.on('miss', () => { const a = action(); if (a) voices.tone(a.time, a.chord.bass + 12, 0.04, 0.3, 'sine', true); }),
    bus.on('reject', () => { const a = action(); if (a) { voices.tone(a.time, 34, 0.10, 0.18, 'sawtooth', true, 650); voices.tone(a.time + TIME.stepSeconds, 33, 0.08, 0.15, 'sawtooth', true, 450); } }),
    bus.on('bossphase', e => { if (e.phase !== 'destroyed') return; const a = action(); if (!a) return; runtime.mix()?.duckAt(a.time, 0.18, 1.8); [81, 77, 74, 69, 62].forEach((n, i) => voices.solo(a.time + i * TIME.stepSeconds, n, 0.23)); }),
  );
  return runtime;
}
