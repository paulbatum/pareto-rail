import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { createScore } from '../../engine/score';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createVoices } from './audio-voices';
import { BPM, DURATION, SECTIONS, TIME } from './timing';

const CHORDS = [
  { bass: 38, pad: [50, 57, 62, 65], arp: [74, 77, 81, 86] },
  { bass: 34, pad: [50, 53, 58, 62], arp: [74, 77, 82, 86] },
  { bass: 41, pad: [48, 53, 57, 60], arp: [72, 77, 81, 84] },
  { bass: 36, pad: [48, 55, 60, 64], arp: [72, 76, 79, 84] },
];
const SIEGE = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [74, 77, 81, 86] },
  { bass: 39, pad: [51, 55, 58, 63], arp: [75, 79, 82, 87] },
  { bass: 34, pad: [50, 53, 58, 62], arp: [74, 77, 82, 86] },
  { bass: 33, pad: [49, 52, 57, 61], arp: [73, 76, 81, 85] },
];
const VICTORY = [{ bass: 38, pad: [50, 57, 62, 66], arp: [74, 78, 81, 86] }];
type Chord = typeof CHORDS[number];
const KILL_LANES = {
  launch: [0, 1, 2, 3, 2, 1, 0, 2, 1, 2, 3, 4, 3, 2, 1, 0],
  crossing: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 0, 1, 2, 3],
  broadside: [0, 1, 2, 4, 3, 2, 1, 0, 1, 2, 3, 5, 4, 3, 2, 1],
  belly: [4, 3, 2, 1, 2, 3, 4, 5, 3, 2, 1, 0, 1, 2, 3, 4],
  eye: [0, 0, 1, 1, 2, 2, 1, 0, 1, 1, 2, 2, 3, 2, 1, 0],
  shield: [0, 1, 0, 2, 1, 3, 2, 4, 3, 4, 3, 5, 4, 3, 2, 1],
  escort: [3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3, 2],
  trench: [0, 2, 4, 3, 1, 3, 5, 4, 2, 4, 5, 4, 3, 2, 1, 0],
  victory: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5],
};
type Section = keyof typeof KILL_LANES;
const SECTION_IDS: Section[] = ['launch', 'crossing', 'broadside', 'belly', 'eye', 'shield', 'escort', 'trench', 'victory'];

export function createAudio(bus: EventBus) { return buildAudio(bus).audio; }
export const traceBroadsideAudio = createAudioTraceHarness({ level: 'broadside-63d6', bpm: BPM, stepSeconds: TIME.stepSeconds, defaultSeconds: DURATION, createAudio: buildAudio });

function buildAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Section>({
    bpm: BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2,
    alternateChordSets: [{ fromBar: 18, toBar: 29, chords: SIEGE, barsPerChord: 1 }, { fromBar: 29, chords: VICTORY }],
    sections: SECTIONS.map((s, i) => ({ index: SECTION_IDS[i], fromBar: s.fromBar })), killLanes: KILL_LANES,
  });
  let victory = false;
  const runtime = createBeatLevelAudio({
    bus, trace, bpm: BPM, stepSeconds: TIME.stepSeconds, stepsPerBar: 16,
    score, runAlignment: 'step', beatNumber: 'position', scheduleAhead: 0.1, volumeScale: 0.78,
    mix: { compressor: { threshold: -17, ratio: 3.5, attack: 0.015, release: 0.28 }, reverb: { seconds: 2.5, decay: 2.6, level: 0.22 }, noiseSeconds: 2 },
    onRunStart() { victory = false; score.clearOverride(); },
    onStep({ mode, position, time, step, bar }) {
      if (mode === 'run') {
        if (step === 0) arrangement.recordSectionStart(time, bar);
        arrangement.schedule(position, time);
      } else if (step === 0 && bar % 2 === 0) {
        const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
        chord.pad.forEach(n => voices.strings(time, n, 3.6, 0.012, 900));
        voices.brass(time, 50, 2.9, 0.018, 900);
      }
    },
  });
  const voices = createVoices({ trace, context: runtime.context, mix: runtime.mix });
  const sustain = (gain: number, cutoff: number): ArrangementTrack<Chord> => fn(({ time, step, bar, chord }) => {
    if (step === 0 && bar % 2 === 0) chord.pad.forEach(n => voices.strings(time, n, TIME.bar(2) * 0.97, gain, cutoff));
  });
  const ostinato = (gain: number, pattern = 's.s.s.s.s.s.s.s.'): ArrangementTrack<Chord> => hits(pattern, { s: 1 }, ({ time, step, bar, chord }) => {
    const degree = [0, 2, 1, 2, 0, 3, 1, 2][Math.floor(step / 2) % 8];
    voices.strings(time, chord.pad[degree] - (bar % 2 === 0 ? 12 : 0), TIME.stepSeconds * 1.55, gain, 1500);
  });
  const drums = (gain: number, pattern = 'T.......t..t....'): ArrangementTrack<Chord> => hits(pattern, { T: gain, t: gain * 0.55 }, ({ time, chord }, velocity) => voices.timpani(time, chord.bass - 12, velocity));
  const brassTheme = (gain: number, urgent = false): ArrangementTrack<Chord> => fn(({ time, step, barInSection, chord }) => {
    const phrase = urgent ? [[0, 0, 4], [6, 2, 2], [8, 3, 5], [14, 2, 2]] : [[0, 0, 6], [8, 2, 3], [12, 3, 4]];
    for (const [at, degree, duration] of phrase) if (step === at && barInSection % 2 === 0) {
      voices.brass(time, chord.pad[degree] + (degree === 0 ? 12 : 0), TIME.stepSeconds * duration, gain, urgent ? 2300 : 1700);
      voices.brass(time, chord.pad[degree], TIME.stepSeconds * duration, gain * 0.45, 1200);
    }
  });
  const crash = oneShot<Chord>(0, 0, ({ time }) => voices.cymbal(time, 0.08, 1.8));
  const snare = hits<Chord>('....r.......r.rr', { r: 0.035 }, ({ time }, v) => voices.snare(time, v));
  const arrangement = createArrangement<Chord>({
    stepsPerBar: 16, chordAt: score.chordAt, trace, emitSections: true,
    sections: [
      { name: 'Flight deck', fromBar: 0, tracks: [sustain(0.017, 1400), drums(0.14, 'T...........t...'), brassTheme(0.045), oneShot(2, 0, ({ time }) => voices.cymbal(time, 0.05, 1.3))] },
      { name: 'The crossing', fromBar: 4, tracks: [sustain(0.019, 1650), ostinato(0.035), drums(0.17), brassTheme(0.044), snare, crash] },
      { name: 'Broadside', fromBar: 8, tracks: [sustain(0.022, 1800), ostinato(0.042), drums(0.23, 'T...t...T..t..t.'), brassTheme(0.065, true), snare, crash] },
      { name: 'Under the guns', fromBar: 12, tracks: [sustain(0.018, 1400), ostinato(0.038, 'ss.s.ss.ss.s.ss.'), drums(0.2, 'T.....t.T...t.t.'), brassTheme(0.047, true), crash] },
      { name: 'Eye of the battle', fromBar: 16, tracks: [
        oneShot(0, 0, ({ time }) => { voices.strings(time, 50, 3.4, 0.012, 650); voices.strings(time, 57, 3.2, 0.007, 600); }),
        oneShot(1, 8, ({ time }) => voices.brass(time, 45, 1.35, 0.018, 720)),
      ] },
      { name: 'Break the shield', fromBar: 18, tracks: [sustain(0.021, 1700), ostinato(0.04, 'ss.sss.sss.sss.s'), drums(0.23, 'T..t....T..t..tt'), brassTheme(0.057, true), crash] },
      { name: 'Coming around', fromBar: 23, tracks: [sustain(0.022, 1900), ostinato(0.045), drums(0.22, 'T...t..tT...t.tt'), snare, crash] },
      { name: 'Into the trench', fromBar: 25, tracks: [sustain(0.023, 1950), ostinato(0.046, 'ssssss.sssssss.s'), drums(0.25, 'T.t.t..tT.t.tttt'), brassTheme(0.065, true), snare, crash] },
      { name: 'A sky worth saving', fromBar: 29, toBar: 32, tracks: [
        oneShot(0, 0, ({ time }) => {
          voices.cymbal(time, 0.07, 2.1);
          VICTORY[0].pad.forEach(n => voices.strings(time, n, 5.5, 0.027, 1800));
          voices.timpani(time, 26, 0.24);
        }),
        fn(({ time, step, barInSection }) => {
          const melody = [[0, 0, 62, 6], [0, 8, 69, 4], [0, 12, 74, 7], [1, 8, 73, 4], [1, 12, 69, 4], [2, 0, 74, 15]];
          for (const [bar, at, note, length] of melody) if (barInSection === bar && step === at) voices.brass(time, victory ? note : note - 12, length * TIME.stepSeconds, 0.06, 1800);
        }),
      ] },
    ],
  });
  function position() {
    const context = runtime.context();
    if (!context) return null;
    const time = score.quantizePlayerAction(context.currentTime + 0.008);
    const step = score.arrangementPositionAt(time);
    return { time, step, chord: score.chordAt(step) };
  }
  const bossIds = new Set<number>();
  bus.on('runstart', () => bossIds.clear());
  bus.on('spawn', e => { if (e.kind === 'generator' || e.kind === 'reactor') bossIds.add(e.enemyId); });
  bus.on('lock', e => {
    const p = position(); if (!p) return;
    const lead = score.leadSetAt(p.step);
    voices.lock(p.time, lead[Math.min(lead.length - 1, e.lockCount - 1)], 0.06);
  });
  bus.on('unlock', () => { const p = position(); if (p) voices.lock(p.time, p.chord.pad[1], 0.025); });
  bus.on('fire', e => {
    const p = position(); if (!p) return;
    voices.fire(p.time, p.chord.bass + 12, e.indexInVolley === 0 ? 0.055 : 0.02);
  });
  bus.on('hit', e => {
    const p = position(); if (!p) return;
    if (!e.lethal) {
      const intensity = bossIds.has(e.enemyId) ? (3 - e.hitPointsRemaining) / 3 : 0;
      voices.impact(p.time, p.chord.bass, 0.12 + intensity * 0.07);
      voices.solo(p.time, p.chord.arp[Math.min(3, Math.floor(intensity * 4))], 0.055 + intensity * 0.06, 0.28);
    }
  });
  bus.on('kill', e => {
    const p = position(); if (!p) return;
    const note = score.nextKill(p.time);
    voices.solo(note.time, note.midi, 0.12 + Math.min(5, e.indexInVolley ?? 0) * 0.014, 0.42);
    if (bossIds.delete(e.enemyId)) { voices.explosion(p.time, 0.7); runtime.mix()?.duckAt(p.time, 0.65, 0.35); }
    else if (!e.letter) voices.impact(p.time, p.chord.bass, 0.08);
  });
  bus.on('stage', () => { const p = position(); if (p) { voices.impact(p.time, p.chord.bass - 12, 0.22); voices.cymbal(p.time, 0.045, 0.4); } });
  bus.on('volley', e => {
    const p = position(); if (p && e.size === 6) { voices.timpani(p.time, p.chord.bass - 12, 0.25); voices.cymbal(p.time, 0.065, 0.7); }
  });
  bus.on('reject', () => {
    const p = position(); if (!p) return;
    voices.fire(p.time, 46, 0.07); voices.fire(p.time + TIME.stepSeconds, 45, 0.07);
  });
  bus.on('miss', e => { const p = position(); if (p && !e.letter) voices.lock(p.time, p.chord.bass + 12, 0.027); });
  bus.on('playerhit', () => { const p = position(); if (p) { voices.explosion(p.time, 0.8); runtime.mix()?.duckAt(p.time, 0.45, 0.45); } });
  bus.on('bossphase', e => {
    const p = position(); if (!p) return;
    if (e.phase === 'exposed') {
      runtime.mix()?.duckAt(p.time, 0.3, 0.8);
      [74, 77, 81, 86].forEach((n, i) => voices.solo(p.time + i * TIME.stepSeconds, n, 0.13, 0.5));
    }
    if (e.phase === 'destroyed') {
      victory = true;
      runtime.mix()?.duckAt(p.time, 0.16, 1.1);
      voices.explosion(p.time, 1.4);
      [74, 78, 81, 86].forEach((n, i) => voices.solo(p.time + (i + 2) * TIME.stepSeconds, n, 0.16, 0.8));
    }
  });
  return runtime;
}
