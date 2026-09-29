import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, type ArrangementTrack } from '../../engine/arrangement';
import { createScore } from '../../engine/score';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { BPM, DURATION, TIME } from './gameplay';
import { createVoices } from './audio-voices';

// D minor -> Bb -> F -> A: a naval march, with the last cadence resolving D major.
const CHORDS = [
  { bass: 38, pad: [50, 53, 57], arp: [74, 77, 81, 86] },
  { bass: 34, pad: [46, 50, 53], arp: [74, 77, 82, 86] },
  { bass: 41, pad: [48, 53, 57], arp: [72, 77, 81, 84] },
  { bass: 33, pad: [49, 52, 57], arp: [73, 76, 81, 85] },
];
const VICTORY = { bass: 38, pad: [50, 54, 57], arp: [74, 78, 81, 86] };
type Chord = typeof VICTORY;
const SECTIONS = [ { index: 0, fromBar: 0 }, { index: 1, fromBar: 4 }, { index: 2, fromBar: 8 }, { index: 3, fromBar: 15 }, { index: 4, fromBar: 17 }, { index: 5, fromBar: 25 }, { index: 6, fromBar: 30 } ];
const KILL_LANES = {
  0: [0, 1, 2, 1, 0, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0],
  1: [0, 2, 1, 3, 2, 4, 3, 5, 4, 5, 6, 5, 4, 3, 2, 1],
  2: [0, 4, 1, 5, 2, 6, 3, 7, 6, 5, 4, 3, 2, 3, 4, 5],
  3: [0, 1, 0, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0],
  4: [1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 7],
  5: [7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7],
  6: [0, 2, 3, 4, 5, 4, 3, 2, 0, 2, 3, 4, 7, 6, 5, 4],
};
export function createAudio(bus: EventBus) { return buildAudio(bus).audio; }
export const traceBroadsideAudio = createAudioTraceHarness({ level: 'broadside-5qec', bpm: BPM, stepSeconds: TIME.stepSeconds, defaultSeconds: DURATION, createAudio: buildAudio });
function buildAudio(bus: EventBus, trace?: AudioTraceSink) {
  let victory = false;
  const kinds = new Map<number, string>();
  let bossDamage = 0;
  const score = createScore<Chord, number>({ bpm: BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2, sections: SECTIONS, killLanes: KILL_LANES, leadSet: (chord) => { const c = victory ? VICTORY : chord; return [...c.arp, ...c.arp.map((midi) => midi + 12)]; } });
  const runtime = createBeatLevelAudio({ bus, trace, bpm: BPM, stepSeconds: TIME.stepSeconds, score, runAlignment: 'step', beatNumber: 'position', volumeScale: 0.8,
    mix: { compressor: { threshold: -17, ratio: 4, attack: 0.015, release: 0.3 }, reverb: { seconds: 2.4, decay: 3.5, level: 0.25 }, noiseSeconds: 2 },
    onStep: schedule,
    onRunStart() { kinds.clear(); bossDamage = 0; victory = false; score.clearOverride(); },
  });
  const v = createVoices({ context: runtime.context, mix: runtime.mix, trace });
  // Horn call contour: tonic fifth, rising third, a falling answer. Backing stays
  // below MIDI 70, leaving the entire high string/celesta lane to player kills.
  const THEME = [0, 7, 12, 10, 7, 3, 5, 7];
  const strings = (gain: number, rapid = false): ArrangementTrack<Chord> => fn(({ time, step, position, chord }) => {
    if (step % (rapid ? 1 : 2) !== 0) return;
    const notes = [...chord.pad, chord.pad[0] + 12];
    const index = [0, 1, 2, 1, 3, 2, 1, 2][Math.floor(position / (rapid ? 1 : 2)) % 8];
    v.strings(time, notes[index], TIME.stepSeconds * (rapid ? 0.85 : 1.7), gain * (step % 4 === 0 ? 1 : 0.75));
  });
  const harmony = (gain: number): ArrangementTrack<Chord> => hits('P...............', { P: 1 }, ({ time, chord }) => {
    chord.pad.forEach((midi) => v.strings(time, midi, TIME.bar(1) * 0.95, gain));
    v.strings(time, chord.bass, TIME.bar(1) * 0.9, gain * 1.5);
  });
  const horns = (gain: number): ArrangementTrack<Chord> => fn(({ time, step, barInSection, chord }) => {
    if (![0, 6, 8, 14].includes(step)) return;
    const i = (barInSection * 4 + [0, 6, 8, 14].indexOf(step)) % THEME.length;
    v.brass(time, chord.bass + 12 + THEME[i], TIME.step(0, step === 0 || step === 8 ? 4 : 1.5), gain);
    if (step === 0) v.brass(time, chord.pad[1], TIME.step(0, 4), gain * 0.55);
  });
  const drums = (gain: number): ArrangementTrack<Chord> => hits('T...t.T.t...t.tt', { T: 1, t: 0.5 }, ({ time, chord, step }, vel) => v.timpani(time, chord.bass - (step % 8 ? 0 : 12), gain * vel));
  const snare = (gain: number): ArrangementTrack<Chord> => hits('....S.......S.ss', { S: 1, s: 0.4 }, ({ time }, vel) => v.snare(time, gain * vel));
  const crash: ArrangementTrack<Chord> = fn(({ time, step, barInSection }) => { if (step === 0 && barInSection % 4 === 0) v.cymbal(time, 0.035); });
  const arrangement = createArrangement<Chord>({ stepsPerBar: 16, chordAt: (position) => victory && position >= 30 * 16 ? VICTORY : score.chordAt(position), trace, emitSections: true,
    sections: [
      { name: 'Flight deck / the fleet answers', fromBar: 0, tracks: [harmony(0.027), horns(0.065), drums(0.11)] },
      { name: 'Crossfire scherzo', fromBar: 4, tracks: [strings(0.035, true), horns(0.075), drums(0.14), snare(0.03), crash] },
      { name: 'Broadside / belly run', fromBar: 8, tracks: [harmony(0.025), strings(0.036, true), horns(0.085), drums(0.16), snare(0.032), crash] },
      { name: 'The eye of battle', fromBar: 15, tracks: [harmony(0.008), fn(({ time, step, chord }) => { if (step === 0) v.action(time, chord.pad[2], 1.5, 0.025); })] },
      { name: 'Flagship / shield assault', fromBar: 17, tracks: [strings(0.035), horns(0.06), drums(0.15), snare(0.027), crash] },
      { name: 'Into the trench', fromBar: 25, tracks: [strings(0.04, true), horns(0.09), drums(0.18), snare(0.032), crash] },
      { name: 'Fleet panorama / final cadence', fromBar: 30, toBar: 32, tracks: [fn(({ time, step, barInSection }) => {
        if (step === 0) {
          const chord = victory ? VICTORY : CHORDS[0];
          chord.pad.forEach((midi) => v.strings(time, midi, TIME.bar(1) * 0.95, 0.033));
          v.brass(time, chord.bass + 24 + (barInSection ? 0 : 7), TIME.bar(1) * 0.8, 0.08);
          v.timpani(time, chord.bass - 12, 0.17);
        }
      })] },
    ],
  });
  function schedule(s: BeatLevelAudioStep) {
    if (s.mode === 'ambient') { if (s.step === 0 && s.bar % 2 === 0) CHORDS[0].pad.forEach((midi) => v.strings(s.time, midi, TIME.bar(2) * 0.9, 0.008)); return; }
    if (victory) {
      if (s.step === 0) { VICTORY.pad.forEach((midi) => v.strings(s.time, midi, TIME.bar(1) * 0.95, 0.035)); v.timpani(s.time, 26, 0.14); }
      if (s.step === 0 || s.step === 8) v.brass(s.time, [62, 69, 74, 78][Math.floor(s.position / 8) % 4], TIME.step(0, 6), 0.085);
      return;
    }
    arrangement.schedule(s.position, s.time);
    if (s.step === 0) arrangement.recordSectionStart(s.time, s.bar);
  }
  function action() { const ctx = runtime.context(); if (!ctx) return null; const time = score.quantizePlayerAction(ctx.currentTime + 0.006); const pos = score.arrangementPositionAt(time); return { time, chord: victory ? VICTORY : score.chordAt(pos), lead: score.leadSetAt(pos) }; }
  bus.on('spawn', ({ enemyId, kind }) => kinds.set(enemyId, kind));
  bus.on('lock', ({ lockCount }) => { const a = action(); if (a) v.action(a.time, a.lead[Math.min(7, lockCount - 1)], 0.095, 0.085); });
  bus.on('unlock', () => { const a = action(); if (a) v.action(a.time, a.chord.pad[2], 0.08, 0.045); });
  bus.on('fire', ({ volleySize, indexInVolley }) => { const a = action(); if (a) { v.action(a.time, a.chord.pad[0] + 12, 0.12, 0.08); if (indexInVolley === 0) v.impact(a.time, volleySize === 6 ? 0.35 : 0.12); } });
  bus.on('hit', (e) => { if (e.lethal) return; const a = action(); if (a) { const boss = kinds.get(e.enemyId) === 'power'; if (boss) bossDamage++; v.action(a.time, a.chord.arp[Math.min(3, bossDamage % 4)], 0.2, boss ? 0.1 + bossDamage * 0.006 : 0.075); } });
  bus.on('kill', () => { const ctx = runtime.context(); if (!ctx) return; const k = score.nextKill(ctx.currentTime + 0.008); v.action(k.time, k.midi, 0.42, 0.18); v.impact(k.time, 0.12); });
  bus.on('miss', () => { const a = action(); if (a) v.action(a.time, a.chord.bass, 0.22, 0.06); });
  bus.on('reject', () => { const a = action(); if (a) { v.action(a.time, a.chord.pad[0] - 1, 0.12, 0.14); v.action(a.time + TIME.stepSeconds, a.chord.bass, 0.22, 0.12); } });
  bus.on('playerhit', () => { const a = action(); if (a) v.impact(a.time, 0.5); });
  bus.on('bossphase', ({ phase }) => { if (phase === 'destroyed') victory = true; const a = action(); if (!a) return; runtime.mix()?.duckAt(a.time, phase === 'destroyed' ? 0.15 : 0.45, 0.8); if (phase === 'destroyed') { victory = true; [74, 78, 81, 86].forEach((midi, i) => v.action(a.time + TIME.step(0, i * 2), midi, 0.9, 0.19)); v.impact(a.time, 0.6); } else if (phase === 'exposed') [74, 81, 86].forEach((midi, i) => v.action(a.time + TIME.step(0, i), midi, 0.5, 0.16)); });
  return runtime;
}
