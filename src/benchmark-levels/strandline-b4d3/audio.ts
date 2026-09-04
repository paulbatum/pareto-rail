import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { createArrangement, fn, hits, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createWaterVoices } from './audio-voices';
import { BPM, DURATION, SECTIONS, TIME } from './timing';

const CHORDS = [
  { bass: 38, pad: [50, 57, 60, 64], arp: [69, 72, 74, 77] },
  { bass: 34, pad: [46, 53, 57, 60], arp: [69, 72, 74, 77] },
  { bass: 41, pad: [53, 57, 60, 64], arp: [69, 72, 76, 79] },
  { bass: 36, pad: [48, 55, 60, 62], arp: [67, 72, 74, 79] },
];
const SERENE = { bass: 38, pad: [50, 57, 61, 66], arp: [69, 73, 76, 78] };
const KILL_LANES = {
  0: [0, 0, 1, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0],
  1: [0, 1, 2, 4, 3, 2, 3, 4, 5, 4, 3, 2, 4, 3, 2, 1],
  2: [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 4, 3, 2, 1, 2],
  3: [0, 1, 3, 2, 4, 3, 5, 4, 3, 5, 4, 6, 5, 4, 2, 0],
  4: [4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 0, 1, 2, 1, 0],
};

export function createAudio(bus: EventBus) { return createStrandlineAudio(bus).audio; }
export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-b4d3', bpm: BPM, stepSeconds: TIME.stepSeconds,
  defaultSeconds: DURATION, createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let restored = 0;
  let liberated = false;
  let parentId = -1;
  let bossHits = 0;
  const score = createScore({
    bpm: BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2,
    leadSet: (chord) => {
      const notes = liberated ? SERENE.arp : chord.arp;
      return [...notes, ...notes.map((note) => note + 12)];
    },
    sections: SECTIONS.map(({ index, fromBar }) => ({ index, fromBar, crossfadeBars: index === 2 ? 2 : 0 })),
    killLanes: KILL_LANES,
  });
  const runtime = createBeatLevelAudio({
    bus, trace, bpm: BPM, score, stepSeconds: TIME.stepSeconds, runAlignment: 'step', beatNumber: 'position',
    volumeScale: 0.8, scheduleAhead: 0.12,
    mix: { compressor: { threshold: -18, knee: 18, ratio: 3.5, attack: 0.012, release: 0.35 },
      delay: { time: TIME.stepSeconds * 3, feedback: 0.28, dampHz: 3000 },
      reverb: { seconds: 2.9, decay: 2.5, level: 0.22 }, noiseSeconds: 2 },
    onStep({ mode, position, time }) {
      if (mode === 'run' && position % 16 === 0) arrangement.recordSectionStart(time, position / 16);
      if (mode === 'ambient') ambient.schedule(position, time);
      else if (liberated) coda.schedule(position, time);
      else arrangement.schedule(position, time);
    },
    onRunStart() { restored = 0; liberated = false; parentId = -1; bossHits = 0; score.clearOverride(); },
    onRunEnd() { const ctx = runtime.context(); if (ctx) voices.chordCloud(ctx.currentTime + 0.1, liberated ? SERENE.pad : CHORDS[0].pad, 0.025, 4.8, 1300); },
  });
  const voices = createWaterVoices({ trace, context: runtime.context, mix: runtime.mix });
  type Chord = typeof CHORDS[number];
  const clouds = (gain: number, brightness: number): ArrangementTrack<Chord> => hits('C...............................', { C: 1 }, ({ time, chord }) => voices.chordCloud(time, chord.pad, gain, 5.2, brightness));
  const heartbeat = (pattern: string, gain: number): ArrangementTrack<Chord> => hits(pattern, { P: 1, p: 0.55 }, ({ time, chord }, velocity) => voices.waterPulse(time, chord.bass - 12, gain * velocity));
  const brush = (pattern: string, gain: number, frequency: number): ArrangementTrack<Chord> => hits(pattern, { b: 0.55, B: 1 }, ({ time }, velocity) => voices.waterBrush(time, gain * velocity, frequency, 0.12));
  const lowGlass = (pattern: string, gain: number): ArrangementTrack<Chord> => hits(pattern, { g: 1 }, ({ time, chord, step }) => voices.glass(time, chord.pad[(step / 2) % 4 | 0], gain, 0.7, 1800 + Math.min(30, restored) * 60));
  const awake = fn<Chord>(({ time, chord, step, bar }) => {
    if ((restored > 5 || trace) && step % 4 === 2) voices.glass(time, chord.pad[(step / 4 + bar) % 4 | 0] + 12, 0.017 + Math.min(28, restored) * 0.0005, 0.85, 3300);
    if ((restored > 17 || trace) && step === 12) voices.waterBrush(time, 0.028, 5600, 0.3);
  });
  const ambient = createArrangement<Chord>({ stepsPerBar: 16, chordAt: score.chordAt, sections: [
    { name: 'Suspended', fromBar: 0, tracks: [clouds(0.019, 780), lowGlass('g...............', 0.025)] },
  ] });
  const arrangement = createArrangement<Chord>({
    stepsPerBar: 16, chordAt: score.chordAt, trace, emitSections: true,
    sections: [
      { name: 'In the strands', fromBar: 0, toBar: 3, tracks: [clouds(0.031, 800), heartbeat('P.......p.......', 0.14), lowGlass('g...........g...', 0.035)] },
      { name: 'First light', fromBar: 3, toBar: 6, tracks: [clouds(0.032, 1100), heartbeat('P.....p.P.......', 0.16), brush('........B.......', 0.025, 1900), lowGlass('g.....g...g.....', 0.042)] },
      { name: 'A green moon', fromBar: 6, toBar: 9, tracks: [clouds(0.038, 1600), heartbeat('P...............', 0.11), lowGlass('g.......g.......', 0.05), awake] },
      { name: 'Returning light', fromBar: 9, toBar: 15, tracks: [clouds(0.034, 1800), heartbeat('P...p...P..p....', 0.16), brush('....B.......B...', 0.042, 2300), brush('..b...b...b...b.', 0.022, 6200), lowGlass('g..g..g...g..g..', 0.045), awake] },
      { name: 'The crown infestation', fromBar: 15, toBar: 18, tracks: [clouds(0.028, 850), heartbeat('P..p....P..p.p..', 0.19), brush('....B.......B...', 0.045, 1500), lowGlass('g...g.....g...g.', 0.039)] },
      { name: 'Tear it loose', fromBar: 18, toBar: 21, tracks: [clouds(0.032, 1850), heartbeat('P...p.P.P..p..p.', 0.17), brush('..b.B.b...b.B.b.', 0.036, 3900), lowGlass('g.g...g.g...g.g.', 0.042), awake] },
      { name: 'The sea remembers', fromBar: 21, tracks: [clouds(0.025, 1200), heartbeat('P...............', 0.07), lowGlass('g...............', 0.026)] },
    ],
  });
  const coda = createArrangement<Chord>({ stepsPerBar: 16, chordAt: () => SERENE, sections: [
    { name: 'A living sea', fromBar: 0, tracks: [clouds(0.029, 1600), lowGlass('g...........g...................', 0.027)] },
  ] });

  function action() {
    const ctx = runtime.context(); if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime + 0.008);
    const position = score.arrangementPositionAt(time);
    return { time, position, chord: liberated ? SERENE : score.chordAt(position) };
  }
  bus.on('spawn', ({ kind, enemyId }) => { if (kind === 'parent') parentId = enemyId; });
  bus.on('lock', ({ lockCount }) => {
    const a = action(); if (!a) return;
    const lead = a.chord.arp;
    voices.playerNote(a.time, lead[(lockCount - 1) % 4] + (lockCount > 4 ? 12 : 0), 0.045, 0.14, 2200 + restored * 30);
  });
  bus.on('unlock', ({ lockCount }) => { const a = action(); if (a) voices.playerNote(a.time, a.chord.arp[lockCount % 4] - 12, 0.028, 0.16, 1600); });
  bus.on('fire', ({ volleySize, indexInVolley }) => {
    const a = action(); if (!a) return;
    voices.releaseNote(a.time, a.chord.bass + 24 + ((indexInVolley ?? 0) % 2) * 12, 0.045 + volleySize * 0.004, 0.12);
    if (volleySize === 6 && indexInVolley === 0) {
      runtime.mix()?.duckAt(a.time, 0.66, 0.38);
      voices.playerNote(a.time, a.chord.arp[0] - 12, 0.12, 0.9, 3200);
    }
  });
  bus.on('hit', ({ enemyId, lethal }) => {
    const a = action(); if (!a || lethal) return;
    const boss = enemyId === parentId;
    if (boss) bossHits++;
    voices.playerNote(a.time, a.chord.arp[boss ? bossHits % 4 : 0] - (boss ? 12 : 0), boss ? 0.12 + bossHits * 0.016 : 0.07, 0.45, 2100 + bossHits * 500);
    voices.lysis(a.time, 0.022 + bossHits * 0.003, 0.075);
  });
  bus.on('kill', ({ enemyId, letter, indexInVolley }) => {
    if (!letter) restored++;
    if (enemyId === parentId) return;
    const ctx = runtime.context(); if (!ctx) return;
    const note = score.nextKill(ctx.currentTime + 0.01);
    voices.playerNote(note.time, note.midi, 0.105 + (indexInVolley ?? 0) * 0.008, 0.72, 3000 + restored * 45);
    voices.lysis(note.time, 0.016, 0.12);
  });
  bus.on('stage', () => {
    const a = action(); if (!a) return;
    runtime.mix()?.duckAt(a.time, 0.55, 0.65);
    a.chord.arp.slice(0, 3).forEach((midi, i) => voices.playerNote(a.time + i * TIME.stepSeconds, midi, 0.12, 1.1, 3700));
  });
  bus.on('bossphase', ({ phase }) => {
    const a = action();
    if (phase === 'destroyed') liberated = true;
    if (!a) return;
    if (phase === 'summoned') voices.releaseNote(a.time, 50, 0.16, 1.8);
    if (phase === 'exposed') [74, 77, 81].forEach((midi, i) => voices.playerNote(a.time + i * TIME.stepSeconds, midi, 0.11, 1.25, 3500));
    if (phase === 'destroyed') {
      runtime.mix()?.duckAt(a.time, 0.08, 2.8);
      score.overrideSection(4);
      voices.lysis(a.time, 0.08, 1.2);
      voices.chordCloud(a.time + 0.45, SERENE.pad, 0.048, 7, 2100);
      [85, 81, 78, 76, 73, 69].forEach((midi, i) => voices.playerNote(a.time + 0.625 + i * TIME.stepSeconds * 2, midi, 0.1 - i * 0.009, 2, 2600));
    }
  });
  bus.on('reject', () => {
    const a = action(); if (!a) return;
    voices.releaseNote(a.time, a.chord.bass + 19, 0.065, 0.22);
    voices.releaseNote(a.time + TIME.stepSeconds, a.chord.bass + 12, 0.055, 0.28);
  });
  bus.on('miss', ({ letter }) => { const a = action(); if (a && !letter) voices.releaseNote(a.time, a.chord.bass + 12, 0.028, 0.3); });
  bus.on('playerhit', () => { const a = action(); if (a) voices.releaseNote(a.time, a.chord.bass + 24, 0.16, 0.5); });
  return runtime;
}
