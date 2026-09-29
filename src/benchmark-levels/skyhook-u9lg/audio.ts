import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { createArrangement, fn, hits } from '../../engine/arrangement';
import { createAudioTraceHarness } from '../../engine/audio-trace';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { SKYHOOK_U9LG_BPM, SKYHOOK_U9LG_TIME, SKYHOOK_U9LG_RUN_DURATION } from './gameplay';
import { createSkyhookVoices } from './audio-voices';

// An ascent scored by subtraction. The broad low-weather D-major/add9 bed
// loses brushes, then bass, then its middle voices. Above the atmosphere,
// the player's dry tuned metal is almost the only instrument left.
const CHORDS = [
  { bass: 38, pad: [50, 57, 61, 64], arp: [74, 78, 81, 85] },
  { bass: 35, pad: [47, 54, 57, 62], arp: [71, 74, 78, 81] },
  { bass: 31, pad: [43, 50, 57, 59], arp: [71, 74, 79, 81] },
  { bass: 33, pad: [45, 52, 57, 62], arp: [69, 74, 76, 81] },
];
type Chord = typeof CHORDS[number];
type Section = 'weather' | 'blue' | 'thin' | 'vacuum' | 'dock';
const SECTIONS: Array<{ index: Section; fromBar: number; crossfadeBars?: number }> = [
  { index: 'weather', fromBar: 0 }, { index: 'blue', fromBar: 7 }, { index: 'thin', fromBar: 12, crossfadeBars: 2 },
  { index: 'vacuum', fromBar: 18 }, { index: 'dock', fromBar: 27 },
];
const LANES: Record<Section, number[]> = {
  weather: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 4],
  blue: [0, 2, 4, 5, 4, 2, 1, 3, 5, 6, 7, 5, 4, 3, 2, 0],
  thin: [0, 4, 1, 5, 2, 6, 3, 7, 6, 5, 3, 2, 4, 2, 1, 0],
  vacuum: [0, 1, 0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 7],
  dock: [4, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 0, 0],
};
export function createAudio(bus: EventBus) { return createSkyhookAudio(bus).audio; }
export const traceSkyhookAudio = createAudioTraceHarness({ level: 'skyhook-u9lg', bpm: SKYHOOK_U9LG_BPM, stepSeconds: SKYHOOK_U9LG_TIME.stepSeconds, defaultSeconds: SKYHOOK_U9LG_RUN_DURATION, createAudio: createSkyhookAudio });
function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Section>({ bpm: SKYHOOK_U9LG_BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2, sections: SECTIONS, killLanes: LANES });
  let bossId = -1, damage = 0, bossDead = false;
  const limpets = new Set<number>();
  const runtime = createBeatLevelAudio({
    bus, trace, bpm: SKYHOOK_U9LG_BPM, stepSeconds: SKYHOOK_U9LG_TIME.stepSeconds, score, runAlignment: 'step', beatNumber: 'position', volumeScale: 0.82,
    mix: { compressor: { threshold: -18, ratio: 3, attack: 0.008, release: 0.3 }, reverb: { seconds: 2.8, decay: 2.5, level: 0.28 }, noiseSeconds: 3 },
    onStep({ position, time, mode }) {
      if (mode === 'run') arrangement.schedule(position, time);
      else if (position % 64 === 0) voices.pad(time, CHORDS[0].pad, 0.11, 5);
    },
    onBeforeBeat({ bar, step, time, mode }) { if (mode === 'run' && step === 0) arrangement.recordSectionStart(time, bar); },
    onRunStart() { bossId = -1; damage = 0; bossDead = false; limpets.clear(); },
    onRunEnd() { const ctx = runtime.context(); if (ctx) voices.tone(ctx.currentTime + 0.06, 74, 0.035, 1.2, 1100); },
  });
  const voices = createSkyhookVoices({ context: runtime.context, mix: runtime.mix, trace });
  const padTrack = (gain: number, length = 3.8) => hits<Chord>('P...............................', { P: 1 }, ({ time, chord }) => voices.pad(time, chord.pad, gain, length));
  const arrangement = createArrangement<Chord>({ stepsPerBar: 16, chordAt: score.chordAt, trace, emitSections: true, sections: [
    { name: 'weather / wide air', fromBar: 0, tracks: [padTrack(0.42), hits('K.......k.......', { K: 0.15, k: 0.085 }, ({ time }, gain) => voices.thump(time, gain)), hits('..h...h...h...h.', { h: 0.018 }, ({ time }) => voices.air(time, 0.018, 0.16, 2100)), hits('W...............', { W: 1 }, ({ time }) => voices.air(time, 0.065, 1.8, 420)), fn(({ step, time, chord }) => { if (step === 0 || step === 10) voices.tone(time, chord.bass, 0.13, 0.65, 700, 'triangle'); })] },
    { name: 'cloud break / sunlit blue', fromBar: 7, tracks: [padTrack(0.35), hits('K...............', { K: 1 }, ({ time }) => voices.thump(time, 0.1)), hits('....h.......h...', { h: 1 }, ({ time }) => voices.air(time, 0.01, 0.2, 3200)), fn(({ step, time, chord }) => { if (step === 0) voices.tone(time, chord.bass, 0.09, 0.8, 500); if (step === 6 || step === 14) voices.tone(time, chord.pad[2] + 12, 0.045, 0.6, 1600, 'triangle'); })] },
    { name: 'stratosphere / losing layers', fromBar: 12, tracks: [padTrack(0.18), fn(({ step, bar, time, chord }) => { if (step === 0 && bar % 2 === 0) voices.tone(time, chord.bass + 12, 0.055, 1, 500); if (step === 12 && bar % 2 === 1) voices.tone(time, chord.pad[3], 0.025, 1.1, 900); })] },
    { name: 'tether contact / vacuum', fromBar: 18, tracks: [fn(({ step, time, chord, bar }) => { if (bossDead) return; if (step === 0) voices.tone(time, chord.bass + 12, 0.038, 0.45, 400); if (step === 8 && bar % 2 === 0) voices.tone(time, chord.pad[0], 0.025, 0.8, 500); })] },
    { name: 'station U9 / docking', fromBar: 27, toBar: 30, tracks: [fn(({ position, time }) => { if (position === 27 * 16) voices.pad(time, [50, 57, 62, 64], 0.08, 2.5); if (position === 29 * 16) voices.tone(time, 62, 0.018, 0.6, 450); })] },
  ] });
  const action = () => {
    const ctx = runtime.context(); if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime), position = score.arrangementPositionAt(time);
    return { time, position, lead: score.leadSetAt(position), chord: score.chordAt(position), section: score.sectionMixAt(position).to };
  };
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'limpet') limpets.add(enemyId);
    if (kind !== 'tether-eater') return; bossId = enemyId;
    const a = action(); if (!a) return;
    voices.tone(a.time, 38, 0.15, 0.8, 500, 'triangle', true);
    voices.tone(a.time + 0.25, 45, 0.09, 1, 800, 'triangle', true);
  });
  bus.on('lock', ({ lockCount }) => { const a = action(); if (!a) return; voices.tone(a.time, a.lead[(lockCount - 1) % a.lead.length], 0.055, 0.1, 2300, 'triangle', true); if (lockCount === 6) voices.tone(a.time, a.lead[7], 0.05, 0.3, 2700, 'sine', true); });
  bus.on('unlock', () => { const a = action(); if (a) voices.tone(a.time, a.lead[0] - 12, 0.03, 0.1, 850, 'sine', true); });
  bus.on('fire', ({ volleySize, indexInVolley }) => {
    const a = action(); if (!a) return;
    voices.tone(a.time, a.chord.bass + 24 + ((indexInVolley ?? 0) % 2) * 7, 0.035, 0.1, 1500, 'triangle', true);
    if ((indexInVolley ?? 0) === 0) voices.air(a.time, volleySize === 6 ? 0.04 : 0.016, 0.12, 1400, true);
  });
  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    if (lethal) return; const a = action(); if (!a) return;
    if (enemyId === bossId) { damage = Math.max(0, 30 - hitPointsRemaining); voices.tone(a.time, a.lead[Math.min(7, Math.floor(damage / 4))], 0.055 + damage * 0.0017, 0.15 + damage * 0.004, 1100 + damage * 65, 'triangle', true); }
    else voices.tone(a.time, a.lead[1], 0.06, 0.14, 1600, 'triangle', true);
  });
  bus.on('kill', ({ enemyId }) => {
    limpets.delete(enemyId);
    const ctx = runtime.context(); if (!ctx) return;
    const note = score.nextKill(ctx.currentTime);
    const section = score.sectionMixAt(score.arrangementPositionAt(note.time)).to;
    voices.tone(note.time, note.midi, section === 'vacuum' ? 0.095 : 0.12, section === 'weather' ? 0.38 : 0.28, 2400, 'triangle', true);
    voices.tone(note.time, note.midi - 12, 0.035, 0.22, 900, 'sine', true);
    if (enemyId === bossId) {
      bossDead = true; runtime.mix()?.duckAt(note.time, 0.8, 1.5);
      [62, 69, 74, 78].forEach((midi, i) => voices.tone(note.time + 0.5 + i * 0.125, midi, 0.09 - i * 0.014, 1.1, 1800, 'sine', true));
    }
  });
  bus.on('reject', () => { const a = action(); if (a) { voices.tone(a.time, a.chord.bass + 12, 0.09, 0.18, 800, 'triangle', true); voices.air(a.time, 0.035, 0.15, 650, true); } });
  bus.on('miss', ({ enemyId }) => { const a = action(); if (!a) return; voices.tone(a.time, a.chord.bass, 0.035, 0.2, 400, 'sine', true); if (limpets.delete(enemyId)) { voices.air(a.time, 0.1, 0.25, 240, true); voices.tone(a.time, a.chord.bass + 12, 0.14, 0.3, 600, 'triangle', true); } });
  bus.on('stage', () => { const a = action(); if (a) { voices.air(a.time, 0.035, 0.18, 1100, true); voices.tone(a.time, a.lead[Math.min(7, Math.floor(damage / 4))], 0.085, 0.32, 2400, 'triangle', true); } });
  bus.on('playerhit', () => { const a = action(); if (a) voices.air(a.time, 0.09, 0.3, 280, true); });
  return runtime;
}
