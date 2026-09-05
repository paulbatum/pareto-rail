import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createVoices } from './audio-voices';
import { BEAT, BPM, DURATION, TIME } from './timing';

const CHORDS = [
  { bass: 38, arp: [74, 78, 81, 85] }, { bass: 35, arp: [74, 78, 81, 83] },
  { bass: 31, arp: [74, 78, 79, 83] }, { bass: 33, arp: [73, 76, 81, 83] },
];
type Chord = typeof CHORDS[number];
const SECTIONS = ['Detent', 'Ratchet', 'Escapement', 'Flywheel', 'Index', 'Overclock', 'Core', 'Resolution'];
const LANES: Record<number, number[]> = {
  0: [0, 1, 2, 3, 2, 1, 0, 2, 1, 2, 3, 4, 3, 2, 1, 0],
  1: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 3, 2, 1, 0],
  2: [0, 4, 1, 5, 2, 6, 3, 7, 4, 2, 5, 3, 6, 4, 7, 5],
  3: [2, 3, 4, 2, 5, 4, 3, 1, 2, 4, 3, 5, 4, 6, 5, 3],
  4: [4, 3, 2, 1, 0, 2, 3, 4, 5, 4, 3, 5, 6, 5, 4, 2],
  5: [0, 1, 4, 2, 5, 3, 6, 4, 7, 6, 5, 4, 3, 2, 1, 0],
  6: [0, 2, 4, 6, 7, 5, 3, 1, 0, 1, 2, 3, 4, 5, 6, 7],
  7: [7, 6, 5, 4, 3, 2, 1, 0, 4, 3, 2, 1, 0, 0, 0, 0],
};
export function createAudio(bus: EventBus) { return buildAudio(bus).audio; }
export const traceSpeedsolveAudio = createAudioTraceHarness({ level: 'speedsolve-kv7m', bpm: BPM, stepSeconds: TIME.stepSeconds, defaultSeconds: DURATION, createAudio: buildAudio });

function buildAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, number>({ bpm: BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2,
    sections: SECTIONS.map((name, index) => ({ index, fromBar: index < 6 ? index * 4 : index === 6 ? 24 : 31, name })), killLanes: LANES });
  let conquered = 0, won = false, nextTurnTime = -1, squareKills = 0, coreHits = 0;
  const targets = new Map<number, string>();
  const runtime = createBeatLevelAudio({
    bus, trace, score, bpm: BPM, stepSeconds: TIME.stepSeconds, beatNumber: 'position', scheduleAhead: 0.08, startDelay: 0.06,
    mix: { compressor: { threshold: -15, ratio: 3.2, attack: 0.002, release: 0.10 }, noiseSeconds: 1.2 }, volumeScale: 0.82,
    onRunStart(rt) {
      conquered = 0; won = false; nextTurnTime = -1; squareKills = 0; coreHits = 0; targets.clear();
      const ctx = rt.context();
      if (ctx) {
        // Give every replay a new downbeat shared by the score, action grid, and cube.
        const epoch = ctx.currentTime + 0.06;
        rt.transport().reset(epoch, 0); score.restartArrangement(0, { align: 'step' }); score.setEpoch(epoch);
      }
    },
    onStep(step) { schedule(step); },
  });
  const v = createVoices({ context: runtime.context, mix: runtime.mix, trace });
  const arrangement = createArrangement<Chord>({ stepsPerBar: 16, chordAt: score.chordAt, trace, emitSections: true,
    sections: SECTIONS.map((name, index) => ({ name, fromBar: index < 6 ? index * 4 : index === 6 ? 24 : 31,
      tracks: [
        hits<Chord>('x...x...x...x...', { x: 1 }, ({ time, step, bar }, velocity) => {
          if (bar < 31) v.kick(time, step === 0 ? velocity : 0.75);
        }),
        fn<Chord>(({ time, step, chord, bar }) => {
          const layers = trace ? Math.min(6, Math.floor(bar / 4)) : conquered;
          if (step % 4 === 0) v.click(time, chord.arp[(step / 4) % 4] - 24, step === 0 ? 0.9 : 0.6);
          if (layers >= 1 && step % 4 === 2) v.click(time, chord.arp[1] - 12, 0.65);
          if (layers >= 2 && step % 2 === 1) v.hat(time, step % 4 === 3 ? 0.8 : 0.4);
          if (step === 0 || (layers >= 3 && [3, 6, 10, 14].includes(step))) v.bass(time, chord.bass + (step === 14 ? 12 : 0), step === 0 ? 0.9 : 0.55);
          if (layers >= 4 && [2, 5, 10, 13].includes(step)) v.wood(time, chord.arp[[0, 2, 1, 3][Math.floor(step / 4)]] - 12, 0.8);
          if (layers >= 5 && [4, 12].includes(step)) v.snap(time, 0.95);
          if (layers >= 6 && [7, 15].includes(step)) v.wood(time, chord.arp[2] - 12, 0.75);
          if (bar % 4 === 3 && step >= 14) v.click(time, chord.arp[step % 4] - 12, 0.8);
        }),
      ],
    })),
  });
  function schedule(step: BeatLevelAudioStep) {
    if (step.mode !== 'run') {
      if (step.step === 0) { v.click(step.time, 62, 0.6); v.wood(step.time, 50, 0.5); }
      if (step.step === 8) v.click(step.time, 69, 0.35);
      return;
    }
    if (won) return;
    if (step.step === 0) arrangement.recordSectionStart(step.time, step.bar);
    arrangement.schedule(step.position, step.time);
  }
  function atAction() {
    const context = runtime.context(); if (!context) return null;
    const time = score.quantizePlayerAction(context.currentTime + 0.004);
    const position = score.arrangementPositionAt(time);
    return { time, position, lead: score.leadSetAt(position), chord: score.chordAt(position) };
  }
  const off = [
    bus.on('spawn', ({ enemyId, kind }) => { targets.set(enemyId, kind); }),
    bus.on('lock', ({ lockCount }) => { const a = atAction(); if (a) v.action(a.time, a.lead[(lockCount - 1) % 8], 0.043, 0.05, 2600); }),
    bus.on('unlock', () => { const a = atAction(); if (a) v.action(a.time, a.lead[0] - 12, 0.025, 0.04, 1400); }),
    bus.on('fire', ({ indexInVolley }) => { const a = atAction(); if (a) v.action(a.time, a.lead[(indexInVolley ?? 0) % 4] - 12, 0.05, 0.065, 1800); }),
    bus.on('hit', ({ enemyId, lethal }) => {
      const a = atAction(); if (!a) return;
      if (targets.get(enemyId) === 'core') {
        coreHits++;
        v.bell(a.time, a.lead[Math.min(7, Math.floor(coreHits / 2))], 0.09 + coreHits * 0.005, 0.11 + coreHits * 0.008);
      } else if (!lethal) v.bell(a.time, a.lead[2] - 12, 0.075, 0.09);
    }),
    bus.on('kill', ({ enemyId, letter }) => {
      const a = atAction(); if (!a) return;
      const kind = targets.get(enemyId); targets.delete(enemyId);
      if (letter) { v.action(a.time, a.lead[2], 0.07, 0.13, 3000); return; }
      const note = score.nextKill(a.time); v.action(note.time, note.midi, 0.095, 0.17, 4400);
      if (kind === 'square') {
        nextTurnTime = Math.max(score.nextGridTime(a.time, 4) + BEAT, nextTurnTime + BEAT);
        const turnChord = score.chordAt(score.arrangementPositionAt(nextTurnTime));
        v.turn(nextTurnTime, turnChord.arp[squareKills % 4] - 24, 1 + (squareKills % 6) * 0.05);
        squareKills++;
        if (squareKills % 6 === 0) {
          for (let i = 0; i < 3; i++) {
            const time = nextTurnTime + BEAT + i * TIME.stepSeconds;
            v.bell(time, score.leadSetAt(score.arrangementPositionAt(time))[i + 2], 0.075, 0.18);
          }
        }
      } else if (kind === 'spindle') {
        conquered++; const t = score.nextGridTime(a.time, 4);
        const p = score.arrangementPositionAt(t);
        v.turn(t, score.chordAt(p).bass + 12, 1.7); v.bell(t, score.leadSetAt(p)[conquered % 4], 0.12, 0.3);
      } else if (kind === 'core') {
        won = true;
        const t = score.nextGridTime(a.time, 4);
        v.turn(t, 50, 2.4);
        [62, 66, 69, 74, 78, 81].forEach((midi, i) => v.bell(t + (i < 3 ? 0 : (i - 2) * BEAT / 2), midi, i < 3 ? 0.085 : 0.065, 1.5));
      }
    }),
    bus.on('miss', ({ enemyId }) => { targets.delete(enemyId); const a = atAction(); if (a && runtime.mode() === 'run') v.action(a.time, a.chord.bass + 12, 0.022, 0.06, 650); }),
    bus.on('reject', () => { const a = atAction(); if (a) v.reject(a.time); }),
    bus.on('playerhit', () => { const a = atAction(); if (a) { v.reject(a.time); v.turn(a.time, a.chord.bass, 1.0); } }),
  ];
  return { ...runtime, audio: { ...runtime.audio, dispose() { off.forEach(fn => fn()); runtime.audio.dispose(); } } };
}
