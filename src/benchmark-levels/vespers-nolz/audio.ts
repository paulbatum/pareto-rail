import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments } from '../../engine/audio-kit';
import { createScore } from '../../engine/score';
import { createArrangement, fn, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { VESPERS_NOLZ_BPM, VESPERS_NOLZ_TIME } from './gameplay';
import { playOrgan, playChoir, playBell } from './organ';

const STEP = VESPERS_NOLZ_TIME.stepSeconds;
// D minor, G minor, B-flat, A major. The raised leading tone belongs to the cadence.
const CHORDS = [
  { bass: 38, notes: [50, 53, 57], lead: [74, 77, 81, 86, 89, 93] },
  { bass: 43, notes: [50, 55, 58], lead: [74, 79, 82, 86, 91, 94] },
  { bass: 34, notes: [50, 53, 58], lead: [74, 77, 82, 86, 89, 94] },
  { bass: 33, notes: [49, 52, 57], lead: [73, 76, 81, 85, 88, 93] },
];
type Chord = typeof CHORDS[number];
const MAJOR: Chord = { bass: 38, notes: [50, 54, 57], lead: [74, 78, 81, 86, 90, 93] };
// A four-bar subject and a slower, contrary-motion answer. Backing stays below MIDI 72.
const SUBJECT = [62, 65, 64, 62, 69, 67, 65, 64, 62, 67, 69, 70, 69, 67, 65, 62, 65, 69, 70, 69, 65, 62, 60, 58, 61, 64, 69, 67, 64, 61, 64, 69];
const ANSWER = [50, 57, 53, 50, 55, 50, 58, 55, 58, 53, 50, 46, 45, 52, 49, 45];
export function createAudio(bus: EventBus) { return createVespersAudio(bus).audio; }
export const traceVespersAudio = createAudioTraceHarness({ level: 'vespers-nolz', bpm: VESPERS_NOLZ_BPM, stepSeconds: STEP, defaultSeconds: 60, createAudio: createVespersAudio });

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let won = false, boss = -1;
  const score = createScore<Chord, number>({
    bpm: VESPERS_NOLZ_BPM, stepsPerBar: 16, chords: CHORDS,
    sections: [{ index: 0, fromBar: 0 }, { index: 1, fromBar: 4 }, { index: 2, fromBar: 12 }, { index: 3, fromBar: 14 }],
    leadSet: chord => won ? MAJOR.lead : chord.lead,
    killLanes: { 0: [0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 2], 1: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 0, 1, 2, 3], 2: [0, 0, 1, 1, 2, 2, 1, 0], 3: [5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 3, 2, 1, 0, 2] },
  });
  const runtime = createBeatLevelAudio({
    bus, trace, score, stepSeconds: STEP, bpm: VESPERS_NOLZ_BPM,
    runAlignment: 'step', beatNumber: 'position', volumeScale: 0.72,
    mix: { compressor: { threshold: -16, ratio: 3, attack: 0.04, release: 0.5 }, reverb: { seconds: 4.8, decay: 2.3, level: 0.5 } },
    onRunStart() { won = false; boss = -1; },
    onStep({ position, time, mode }) {
      if (mode === 'ambient') { if (position % 32 === 0) instruments.pipe(time, 38, 5.5, 0.025, 0.1, false); return; }
      if (position % 16 === 0) arrangement.recordSectionStart(time, Math.floor(position / 16));
      arrangement.schedule(position, time);
    },
  });
  const instruments = defineInstruments({ trace, context: runtime.context }, {
    pipe(context, time, midi: number, length: number, gain: number, brightness: number, player: boolean) {
      const mix = runtime.mix(); if (mix) playOrgan(context, mix, time, midi, length, gain, brightness, player);
    },
    choir(context, time, midi: number, length: number, gain: number) { const mix = runtime.mix(); if (mix) playChoir(context, mix, time, midi, length, gain); },
    bell(context, time, midi: number, gain: number) { const mix = runtime.mix(); if (mix) playBell(context, mix, time, midi, gain); },
  });
  function pedal(): ArrangementTrack<Chord> { return fn(({ time, step, chord }) => { if (!step) instruments.pipe(time, chord.bass, 2.9, 0.075, 0.15, false); }); }
  function subject(gain: number): ArrangementTrack<Chord> { return fn(({ time, position, step }) => { if (step % 2 === 0) instruments.pipe(time, SUBJECT[Math.floor(position / 2) % SUBJECT.length], STEP * 1.9, gain, 0.5, false); }); }
  function answer(): ArrangementTrack<Chord> { return fn(({ time, position, step }) => { if (step % 4 === 0) instruments.pipe(time, ANSWER[Math.floor(position / 4) % ANSWER.length], STEP * 3.9, 0.052, 0.28, false); }); }
  function swell(): ArrangementTrack<Chord> { return fn(({ time, step, chord, bar }) => {
    if (!step && bar % 2 === 0) { for (const midi of chord.notes) instruments.choir(time, midi, 2.6, 0.035); instruments.bell(time, chord.bass + 24, 0.055); }
  }); }
  const arrangement = createArrangement<Chord>({ stepsPerBar: 16, chordAt: p => won ? MAJOR : score.chordAt(p), trace, emitSections: true, sections: [
    { fromBar: 0, name: 'Pedal in darkness', tracks: [oneShot(0, 0, ({ time }) => instruments.pipe(time, 38, 2.95, 0.09, 0.15, false))] },
    { fromBar: 1, name: 'First manual', tracks: [pedal(), subject(0.045)] },
    { fromBar: 4, name: 'Answer from the gallery', tracks: [pedal(), subject(0.048), answer()] },
    { fromBar: 8, name: 'Choir of recovered panes', tracks: [pedal(), subject(0.052), answer(), swell()] },
    { fromBar: 12, name: 'The empty nave', tracks: [oneShot(0, 0, ({ time }) => instruments.pipe(time, 38, 5.8, 0.028, 0, false))] },
    { fromBar: 14, name: 'West end', tracks: [pedal(), subject(0.06), answer(), swell()] },
    { fromBar: 16, name: 'The eater in the rose', tracks: [fn(({ time, step, chord, position }) => {
      if (won) {
        if (!step) { for (const midi of [38, 50, 54, 57, 62, 66]) instruments.pipe(time, midi, 2.9, 0.047, 1, false); }
        // The final mixture stop is reserved for victory, never heard during the minor.
        if (step % 4 === 0) instruments.pipe(time, [86, 85, 81, 78, 81, 78, 76, 74][Math.floor(position / 4) % 8], 0.73, 0.038, 1, false);
      } else {
        if (!step) { instruments.pipe(time, chord.bass, 2.9, 0.1, 0.9, false); for (const midi of chord.notes) instruments.choir(time, midi, 2.6, 0.04); }
        if (step % 2 === 0) instruments.pipe(time, SUBJECT[Math.floor(position / 2) % 32], STEP * 1.9, 0.065, 1, false);
        if (step % 4 === 0) instruments.pipe(time, ANSWER[Math.floor(position / 4) % 16], 0.73, 0.06, 0.7, false);
      }
    })] },
    { fromBar: 20, name: 'Afterglow', tracks: [] },
  ] });
  function action() {
    const context = runtime.context(); if (!context) return null;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time); return { time, position, chord: won ? MAJOR : score.chordAt(position) };
  }
  bus.on('spawn', e => { if (e.kind === 'vesper') boss = e.enemyId; });
  bus.on('lock', e => { const a = action(); if (a) instruments.pipe(a.time, a.chord.lead[(e.lockCount - 1) % 3] - 12, 0.1, 0.042, 0.3, true); });
  bus.on('unlock', () => { const a = action(); if (a) instruments.pipe(a.time, a.chord.notes[1], 0.12, 0.022, 0.1, true); });
  bus.on('fire', e => { const a = action(); if (a) instruments.pipe(a.time, a.chord.notes[(e.indexInVolley ?? 0) % 3] + 12, 0.14, 0.037 + e.volleySize * 0.003, 0.55, true); });
  bus.on('hit', e => {
    if (e.lethal) return; const a = action(); if (!a) return;
    const intensity = e.enemyId === boss ? 1 - e.hitPointsRemaining / 18 : 0;
    instruments.pipe(a.time, a.chord.lead[Math.min(5, Math.floor(intensity * 6))], 0.3, 0.055 + intensity * 0.05, 0.4 + intensity, true);
  });
  bus.on('kill', e => {
    const a = action(); if (!a) return;
    const note = score.nextKill(a.time);
    instruments.pipe(note.time, note.midi, 0.35, 0.072 + (e.indexInVolley ?? 0) * 0.007, 0.65, true);
    if (e.enemyId === boss) {
      won = true;
      const t = score.nextGridTime(a.time, 2); runtime.mix()?.duckAt(t, 0.22, 0.5);
      for (const midi of [38, 50, 54, 57, 62, 66, 74, 78, 86]) instruments.pipe(t + 0.18, midi, 4, 0.055, 1.4, true);
      for (const midi of [62, 66, 69]) instruments.choir(t + 0.18, midi, 4, 0.055);
      instruments.bell(t + 0.18, 74, 0.14);
    }
  });
  bus.on('miss', e => { if (e.letter) return; const a = action(); if (a) instruments.pipe(a.time, a.chord.bass, 0.28, 0.018, 0, true); });
  bus.on('reject', () => { const a = action(); if (a) { instruments.pipe(a.time, a.chord.bass + 12, 0.2, 0.06, 0.7, true); instruments.pipe(a.time + STEP, a.chord.bass, 0.3, 0.045, 0.1, true); } });
  return runtime;
}
