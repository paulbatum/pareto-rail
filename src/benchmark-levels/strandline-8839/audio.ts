import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, playNoiseHit } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { BPM, DURATION, TIME } from './gameplay';

const CHORDS = [
  { bass: 40, pad: [52, 55, 59, 66], arp: [76, 79, 83, 86] },
  { bass: 36, pad: [48, 52, 55, 62], arp: [76, 79, 83, 86] },
  { bass: 43, pad: [50, 55, 59, 64], arp: [74, 79, 83, 88] },
  { bass: 38, pad: [50, 54, 57, 64], arp: [74, 78, 81, 88] },
];
type Chord = typeof CHORDS[number];
const SECTIONS = [{ index: 0, fromBar: 0 }, { index: 1, fromBar: 6, crossfadeBars: 2 }, { index: 2, fromBar: 16 }, { index: 3, fromBar: 21 }];
const LANES = {
  0: [0, 1, 2, 1, 0, 1, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0],
  1: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 3, 4, 5, 6],
  2: [4, 3, 2, 1, 3, 2, 1, 0, 2, 3, 4, 5, 3, 4, 5, 7],
  3: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 4, 3, 2, 1, 0],
};
export function createAudio(bus: EventBus) { return createStrandlineAudio(bus).audio; }
export const traceStrandlineAudio = createAudioTraceHarness({ level: 'strandline-8839', bpm: BPM, stepSeconds: TIME.stepSeconds, defaultSeconds: DURATION, createAudio: createStrandlineAudio });

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let healed = 0, freed = false, parent = -1;
  const harmony = [...CHORDS];
  const resolution = { bass: 40, pad: [52, 56, 59, 66], arp: [76, 80, 83, 90] };
  const score = createScore<Chord, number>({ bpm: BPM, stepsPerBar: 16, chords: harmony, barsPerChord: 2, sections: SECTIONS, killLanes: LANES });
  const pearl = voice<{ decay: number; brightness: number }>({ oscillators: [{ type: 'sine', gain: 0.8 }, { type: 'triangle', octave: 1, gain: 0.13 }], duration: c => c.decay, stopPadding: 0.05, envelope: { attack: 0.008, decay: c => c.decay }, filter: { type: 'lowpass', cutoff: c => c.brightness } });
  const velvet = voice({ oscillators: [{ type: 'sine', gain: 0.7 }, { type: 'triangle', gain: 0.22, detune: 5 }], duration: 3.1, stopPadding: 0.05, envelope: { attack: 0.6, decay: 1, sustain: 0.65, release: 1.3 }, filter: { type: 'lowpass', cutoff: 1400 } });
  const pulse = voice({ oscillators: [{ type: 'sine' }], duration: 0.45, stopPadding: 0.04, envelope: { decay: 0.43 }, frequencyAutomation: time => [{ type: 'exponentialRamp', value: 42, time: time + 0.3 }] });
  const rasp = voice({ oscillators: [{ type: 'triangle' }, { type: 'sine', frequencyRatio: 1.07, gain: 0.2 }], duration: 0.24, stopPadding: 0.03, envelope: { decay: 0.23 }, filter: { type: 'lowpass', cutoff: 1600 } });
  const unsubs: Array<() => void> = [];
  const runtime = createBeatLevelAudio({ bus, trace, bpm: BPM, stepSeconds: TIME.stepSeconds, stepsPerBar: 16, score, runAlignment: 'step', beatNumber: 'position', volumeScale: 0.76,
    mix: { compressor: { threshold: -19, ratio: 3.5, attack: 0.015, release: 0.28 }, delay: { time: TIME.stepSeconds * 3, feedback: 0.27, dampHz: 2400 }, reverb: { seconds: 2.6, decay: 2.5, level: 0.2 }, noiseSeconds: 2 },
    onStep({ position, time, mode }) {
      if (mode === 'ambient') { if (position % 32 === 0) instruments.pad(time, CHORDS[0].pad, 0.035); if (position % 16 === 8) instruments.water(time, 0.024); return; }
      arrangement.schedule(position, time);
      if (position % 16 === 0) arrangement.recordSectionStart(time, position / 16);
    },
    onRunStart() { healed = 0; freed = false; parent = -1; harmony.splice(0, harmony.length, ...CHORDS); },
    onDispose() { unsubs.forEach(fn => fn()); },
  });
  const instruments = defineInstruments({ context: runtime.context, trace }, {
    pad(ctx, time, notes: number[], gain: number) {
      const mix = runtime.mix(); if (!mix) return;
      notes.forEach(midi => velvet.play({ context: ctx, time, midi, gain, destination: mix.music, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : [] }));
    },
    bass(ctx, time, midi: number, gain: number) {
      const mix = runtime.mix(); if (!mix) return;
      pearl.play({ context: ctx, time, midi, gain, decay: 0.9, brightness: 650, destination: mix.music });
    },
    heartbeat(ctx, time, gain: number) { const mix = runtime.mix(); if (mix) pulse.play({ context: ctx, time, frequency: 95, gain, destination: mix.music }); },
    water(ctx, time, gain: number) { const mix = runtime.mix(); if (mix?.noiseBuffer) playNoiseHit({ context: ctx, buffer: mix.noiseBuffer, time, velocity: gain, decay: 0.19, filterType: 'bandpass', frequency: 2100, destination: mix.music }); },
    glint(ctx, time, midi: number, gain: number) { const mix = runtime.mix(); if (mix) pearl.play({ context: ctx, time, midi, gain, decay: 0.48, brightness: 2900, destination: mix.music, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.28 }] : [] }); },
    player(ctx, time, midi: number, gain: number, decay: number, brightness: number) { const mix = runtime.mix(); if (mix) pearl.play({ context: ctx, time, midi, gain, decay, brightness, destination: mix.sfx, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.35 }] : [] }); },
    reject(ctx, time, midi: number) { const mix = runtime.mix(); if (mix) rasp.play({ context: ctx, time, midi, gain: 0.06, destination: mix.sfx }); },
  });
  const pads = () => hits<Chord>('P...............', { P: 1 }, ({ time, chord }) => instruments.pad(time, chord.pad, 0.037));
  const bass = (pattern: string) => hits<Chord>(pattern, { B: 1, b: 0.65 }, ({ time, chord }, vel) => instruments.bass(time, chord.bass, vel * 0.15));
  const heart = (pattern: string) => hits<Chord>(pattern, { K: 0.2, k: 0.12 }, ({ time }, vel) => { if (!freed) instruments.heartbeat(time, vel); });
  const water = (pattern: string) => hits<Chord>(pattern, { w: 0.036, W: 0.052 }, ({ time }, vel) => instruments.water(time, vel));
  const glints = (pattern: string) => hits<Chord>(pattern, { G: 1 }, ({ time, chord, step }) => instruments.glint(time, chord.pad[(step / 2 | 0) % 4], 0.025 + Math.min(healed, 45) * 0.0006));
  const arrangement = createArrangement<Chord>({ stepsPerBar: 16, chordAt: score.chordAt, trace, emitSections: true, sections: [
    { name: 'Suspended in blue', fromBar: 0, tracks: [pads(), heart('K.......k.......'), bass('B...............'), water('............w...')] },
    { name: 'First light', fromBar: 4, tracks: [pads(), heart('K.......K.......'), bass('B.....b.........'), water('....w.......w...'), glints('G.......G.......')] },
    { name: 'The strands awaken', fromBar: 8, tracks: [pads(), heart('K...k...K...k...'), bass('B.....b.B.......'), water('..w...w...W...w.'), glints('G...G...G...G...')] },
    { name: 'Inside the living bell', fromBar: 12, tracks: [pads(), heart('K...k...K...k...'), bass('B..b..b.B.....b.'), water('..w.w.w...W.w.w.'), glints('G.G...G.G.G...G.')] },
    { name: 'Brood lattice', fromBar: 16, tracks: [pads(), heart('K.....k.K..k..k.'), bass('B...b...B.....b.'), water('w...w.w.w...w.w.'), glints('....G.......G...')] },
    { name: 'Drift on', fromBar: 21, tracks: [pads(), fn(({ time, step, chord }) => { if (step === 0) instruments.bass(time, chord.bass, freed ? 0.065 : 0.13); }), glints('G...........G...')] },
  ] });
  function action() {
    const ctx = runtime.context(); if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    return { time, position, chord: score.chordAt(position), lead: score.leadSetAt(position) };
  }
  unsubs.push(
    bus.on('spawn', e => { if (e.kind === 'parent') parent = e.enemyId; }),
    bus.on('lock', e => { const a = action(); if (a) instruments.player(a.time, a.lead[(e.lockCount - 1) % a.lead.length], 0.048, 0.11, 2400); }),
    bus.on('fire', e => { const a = action(); if (a) { instruments.player(a.time, a.chord.pad[e.indexInVolley ? e.indexInVolley % 4 : 0] + 12, 0.07, 0.18, 2800); if (e.volleySize === 6 && e.indexInVolley === 0) instruments.player(a.time, a.chord.bass + 12, 0.14, 0.7, 1600); } }),
    bus.on('hit', e => { if (e.lethal) return; const a = action(); if (a) instruments.player(a.time, a.lead[(6 - e.hitPointsRemaining + 8) % 8], e.enemyId === parent ? 0.1 + (6 - e.hitPointsRemaining) * 0.012 : 0.06, 0.26, 2900 + (6 - e.hitPointsRemaining) * 220); }),
    bus.on('kill', e => { if (!e.letter) healed++; const ctx = runtime.context(); if (!ctx) return; const note = score.nextKill(ctx.currentTime); instruments.player(note.time, note.midi, 0.105, 0.65, 3300 + Math.min(healed, 40) * 35); }),
    bus.on('miss', () => { const a = action(); if (a) instruments.player(a.time, a.chord.bass + 12, 0.026, 0.3, 800); }),
    bus.on('reject', () => { const a = action(); if (a) instruments.reject(a.time, a.chord.bass + 24); }),
    bus.on('bossphase', e => {
      const a = action(); if (!a) return;
      if (e.phase === 'destroyed') { freed = true; harmony.fill(resolution); runtime.mix()?.duckAt(a.time, 0.25, 1.8); [76, 80, 83, 90].forEach((midi, i) => instruments.player(a.time + i * TIME.stepSeconds * 2, midi, 0.12, 2.3, 3800)); }
      else if (e.phase === 'exposed') [0, 2, 4].forEach((degree, i) => instruments.player(a.time + i * TIME.stepSeconds, a.lead[degree], 0.12, 0.6, 4200));
    }),
  );
  return runtime;
}
