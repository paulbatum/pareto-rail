import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { createArrangement, fn, hits, type ArrangementSection } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import type { VoiceSpec } from '../../engine/audio-voices';
import { DURATION, SKYHOOK_B993_BPM, TIME } from './gameplay';
import { createSkyhookVoices, type VoiceName } from './audio-voices';

const CHORDS = [
  { bass: 38, pad: [50, 57, 61, 64], arp: [74, 78, 81, 85] },
  { bass: 31, pad: [50, 55, 59, 62], arp: [74, 79, 81, 86] },
  { bass: 35, pad: [47, 54, 57, 62], arp: [74, 78, 81, 83] },
  { bass: 33, pad: [45, 52, 59, 62], arp: [73, 76, 81, 86] },
];
type Chord = typeof CHORDS[number];
type Section = 'weather' | 'sunlight' | 'thin' | 'vacuum' | 'dock';
const SECTIONS: Array<{ index: Section; fromBar: number; crossfadeBars?: number }> = [
  { index: 'weather', fromBar: 0 }, { index: 'sunlight', fromBar: 7 }, { index: 'thin', fromBar: 14, crossfadeBars: 2 }, { index: 'vacuum', fromBar: 18 }, { index: 'dock', fromBar: 26 },
];
const VOICES: Record<VoiceName, VoiceSpec> = {
  pad: { oscillators: [{ type: 'sine', detune: -4 }, { type: 'triangle', detune: 4, gain: 0.22 }], duration: 3.8, envelope: { attack: 0.7, decay: 1, sustain: 0.65, release: 1 }, filter: { type: 'lowpass', cutoff: 1100 } },
  bass: { oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.16 }], duration: 0.6, envelope: { attack: 0.012, decay: 0.58 }, filter: { type: 'lowpass', cutoff: 340 } },
  pluck: { oscillators: [{ type: 'triangle' }, { type: 'sine', frequencyRatio: 2.005, gain: 0.15 }], duration: 0.34, envelope: { attack: 0.004, decay: 0.3 } },
  lock: { oscillators: [{ type: 'sine' }, { type: 'triangle', gain: 0.2 }], duration: 0.07, envelope: { attack: 0.003, decay: 0.065 } },
  fire: { oscillators: [{ type: 'triangle' }], duration: 0.13, envelope: { attack: 0.002, decay: 0.12 }, frequencyAutomation: (t, f) => [{ type: 'exponentialRamp', value: f / 2, time: t + 0.11 }] },
  kill: { oscillators: [{ type: 'sine' }, { type: 'sine', frequencyRatio: 2, gain: 0.18 }, { type: 'triangle', gain: 0.09 }], duration: 0.58, envelope: { attack: 0.004, decay: 0.54 } },
  impact: { oscillators: [{ type: 'sine' }, { type: 'triangle', frequencyRatio: 1.5, gain: 0.22 }], duration: 0.4, envelope: { attack: 0.002, decay: 0.38 }, frequencyAutomation: (t, f) => [{ type: 'exponentialRamp', value: f * 0.45, time: t + 0.32 }] },
};
export const traceSkyhookAudio = createAudioTraceHarness({ level: 'skyhook-b993', bpm: SKYHOOK_B993_BPM, stepSeconds: TIME.stepSeconds, defaultSeconds: DURATION, createAudio: buildAudio });
export function createAudio(bus: EventBus) { return buildAudio(bus).audio; }
function buildAudio(bus: EventBus, trace?: AudioTraceSink) {
  let bossId = -1, ended = false, cleared = false;
  const kinds = new Map<number, string>();
  const score = createScore<Chord, Section>({
    bpm: SKYHOOK_B993_BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2, sections: SECTIONS,
    killLanes: {
      weather: [0, 1, 2, 3, 2, 1, 0, 2, 1, 2, 3, 4, 3, 2, 1, 0],
      sunlight: [0, 2, 3, 4, 5, 4, 3, 2, 1, 3, 4, 5, 6, 5, 3, 2],
      thin: [4, 3, 2, 1, 3, 2, 1, 0, 4, 2, 3, 1, 2, 1, 0, 2],
      vacuum: [0, 1, 2, 3, 4, 5, 2, 3, 4, 5, 6, 7, 5, 4, 3, 2],
      dock: [3, 2, 1, 0, 0, 1, 2, 3, 2, 1, 0, 0, 3, 2, 1, 0],
    },
  });
  const runtime = createBeatLevelAudio({
    bus, trace, score, stepSeconds: TIME.stepSeconds, runAlignment: 'step', beatNumber: 'position', volumeScale: 0.8,
    mix: { compressor: { threshold: -17, ratio: 3, attack: 0.012, release: 0.25 }, reverb: { seconds: 2.4, decay: 2.7, level: 0.23 }, noiseSeconds: 2 },
    onStep({ position, time, mode }) {
      if (mode === 'run') { if (position % 16 === 0) arrangement.recordSectionStart(time, Math.floor(position / 16)); arrangement.schedule(position, time); }
      else if (!ended && position % 32 === 0) {
        voices.tone(time, 'pad', 50, 0.025, 3.8, -0.5, false); voices.tone(time, 'pad', 57, 0.02, 3.8, 0.5, false);
      }
    },
    onRunStart() { bossId = -1; cleared = false; ended = false; kinds.clear(); score.clearOverride(); },
    onRunEnd() { ended = true; },
  });
  const voices = createSkyhookVoices({ context: runtime.context, mix: runtime.mix, trace }, VOICES);
  const sections: ArrangementSection<Chord>[] = [
    { name: 'Weather / full air', fromBar: 0, tracks: [
      fn(({ step, bar, time, chord }) => {
        if (step === 0 && bar % 2 === 0) chord.pad.forEach((m, i) => voices.tone(time, 'pad', m, 0.038, 3.8, (i - 1.5) * 0.48, false));
        if ([0, 6, 10].includes(step)) voices.tone(time, 'bass', chord.bass + (step === 10 ? 7 : 0), 0.14, 0.6, 0, false);
        if ([3, 7, 11, 14].includes(step)) voices.tone(time, 'pluck', chord.pad[(step + bar) % 4] + 0, 0.035, 0.34, step % 2 ? -0.65 : 0.65, false);
      }),
      hits('x...s...x..s....', { x: 0.11, s: 0.05 }, ({ time }, gain, symbol) => { if (symbol === 'x') voices.tone(time, 'impact', 36, gain, 0.4, 0, false); else voices.air(time, gain, 0.16, 1700, false); }),
      hits('..x...x...x..x..', { x: 0.025 }, ({ time }, gain) => voices.air(time, gain, 0.12, 4200, false)),
    ] },
    { name: 'Cloudbreak / sunlight', fromBar: 7, tracks: [
      fn(({ step, bar, time, chord }) => {
        if (step === 0 && bar % 2 === 1) chord.pad.forEach((m, i) => voices.tone(time, 'pad', m, 0.032, 3.8, (i - 1.5) * 0.5, false));
        if (step === 0 || step === 8) voices.tone(time, 'bass', chord.bass, 0.1, 0.6, 0, false);
        if ([2, 10, 14].includes(step)) voices.tone(time, 'pluck', chord.pad[(step / 2) % 4], 0.028, 0.34, step === 10 ? 0.6 : -0.6, false);
      }),
      hits('x.......s.......', { x: 0.08, s: 0.03 }, ({ time }, gain, symbol) => symbol === 'x' ? voices.tone(time, 'impact', 36, gain, 0.4, 0, false) : voices.air(time, gain, 0.13, 2200, false)),
    ] },
    { name: 'Thin air / no drums', fromBar: 14, tracks: [fn(({ step, bar, time, chord }) => {
      if (step === 0 && bar % 2 === 0) for (const [i, m] of [chord.pad[0], chord.pad[2]].entries()) voices.tone(time, 'pad', m, 0.027, 3.8, i ? 0.7 : -0.7, false);
      if (step === 0) voices.tone(time, 'bass', chord.bass, 0.055, 0.6, 0, false);
    })] },
    { name: 'Harvester / transmitted through the tether', fromBar: 18, tracks: [fn(({ step, bar, time, chord }) => {
      if (cleared) return;
      if (step === 0 || step === 8) voices.tone(time, 'impact', chord.bass, 0.035 + (bar - 18) * 0.004, 0.4, step === 0 ? -0.3 : 0.3, false);
      if (step === 0 && bar % 4 === 2) voices.tone(time, 'pad', chord.pad[0], 0.018, 3.8, 0, false);
    })] },
    { name: 'Dock / pressure equalized', fromBar: 26, toBar: 30, tracks: [fn(({ step, bar, time }) => {
      if (step === 0 && bar === 27) voices.tone(time, 'kill', 74, 0.045, 0.58, -0.3, false);
      if (step === 0 && bar === 28) voices.tone(time, 'kill', 69, 0.027, 0.58, 0.3, false);
    })] },
  ];
  const arrangement = createArrangement({ stepsPerBar: 16, sections, chordAt: score.chordAt, trace, emitSections: true });
  const timeNow = () => runtime.context()?.currentTime ?? 0;
  const actionTime = () => score.quantizePlayerAction(timeNow());
  const pitch = (time: number, index: number) => score.leadSetAt(score.arrangementPositionAt(time))[index % 8];
  const playerGain = (time: number) => score.barAt(score.arrangementPositionAt(time)) < 18 ? 1 : 0.7;
  bus.on('spawn', ({ enemyId, kind }) => { kinds.set(enemyId, kind); if (kind === 'harvester') { bossId = enemyId; const t = actionTime(); voices.tone(t, 'impact', 26, 0.15, 0.4, 0, true); voices.tone(t + 0.25, 'impact', 33, 0.1, 0.4, 0, true); } });
  bus.on('lock', ({ lockCount }) => { const t = actionTime(); voices.tone(t, 'lock', pitch(t, lockCount - 1), 0.08 * playerGain(t), 0.07, (lockCount - 3.5) * 0.12, true); });
  bus.on('unlock', () => { const t = actionTime(); voices.tone(t, 'lock', pitch(t, 0) - 12, 0.035, 0.07, 0, true); });
  bus.on('fire', ({ volleySize, indexInVolley }) => { const t = actionTime(); voices.tone(t, 'fire', pitch(t, indexInVolley ?? 0) - 12, (0.05 + volleySize * 0.006) * playerGain(t), 0.13, 0, true); });
  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    if (lethal) return; const t = actionTime();
    const progress = enemyId === bossId ? 1 - hitPointsRemaining / 36 : 0;
    voices.tone(t, 'pluck', pitch(t, Math.floor(progress * 7)) - 12, 0.075 + progress * 0.05, 0.34, 0, true);
    if (enemyId === bossId) voices.tone(t, 'impact', 38 + progress * 12, 0.045 + progress * 0.055, 0.4, 0, true);
  });
  bus.on('kill', ({ enemyId }) => {
    const k = score.nextKill(timeNow()); voices.tone(k.time, 'kill', k.midi, 0.12 * playerGain(k.time), 0.58, 0, true);
    if (enemyId === bossId) {
      cleared = true; runtime.mix()?.duckAt(k.time, 0.06, 1.5);
      const t = score.nextGridTime(k.time + 0.5, 4);
      [74, 81, 86, 90].forEach((m, i) => voices.tone(t + i * 0.125, 'kill', m, 0.11 - i * 0.015, 0.58, (i - 1.5) * 0.3, true));
    }
    kinds.delete(enemyId);
  });
  bus.on('volley', ({ size }) => { if (size === 6) { const t = score.nextGridTime(timeNow(), 2); voices.tone(t, 'impact', score.chordAt(score.arrangementPositionAt(t)).bass, 0.13, 0.4, 0, true); } });
  bus.on('reject', () => { const t = timeNow(); voices.tone(t, 'impact', 49, 0.16, 0.4, -0.1, true); voices.tone(t + 0.085, 'impact', 48, 0.1, 0.4, 0.1, true); });
  bus.on('miss', ({ enemyId }) => { const kind = kinds.get(enemyId); if (kind === 'diver' || kind === 'borer') { voices.tone(timeNow(), 'impact', 29, 0.24, 0.4, 0, true); voices.air(timeNow(), 0.12, 0.25, 800, true); } else voices.tone(timeNow(), 'impact', 38, 0.035, 0.4, 0, true); kinds.delete(enemyId); });
  bus.on('playerhit', () => { voices.tone(timeNow(), 'impact', 24, 0.22, 0.4, 0, true); voices.air(timeNow(), 0.12, 0.24, 520, true); });
  return runtime;
}
