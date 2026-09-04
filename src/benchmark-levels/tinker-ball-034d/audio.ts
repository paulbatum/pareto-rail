import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, playNoiseHit } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createScore } from '../../engine/score';
import { createArrangement, hits } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { BPM, TIME, DURATION } from './gameplay';
const CHORDS = [{ bass: 36, arp: [72, 76, 79, 83] }, { bass: 33, arp: [69, 72, 76, 79] }, { bass: 41, arp: [69, 72, 77, 81] }, { bass: 43, arp: [71, 74, 79, 81] }];
const mallet = voice({ oscillators: [{ type: 'sine', gain: .22 }, { type: 'sine', frequencyRatio: 3.01, gain: .025 }], duration: .27, envelope: { decay: .25 } });
const reed = voice({ oscillators: [{ type: 'square', gain: .022 }, { type: 'triangle', octave: 1, gain: .023 }], duration: .13, filter: { type: 'lowpass', cutoff: 1800 }, envelope: { attack: .009, decay: .12 } });
const bass = voice({ oscillators: [{ type: 'triangle', gain: .19 }, { type: 'sine', octave: -1, gain: .13 }], duration: .18, filter: { type: 'lowpass', cutoff: 850 }, envelope: { attack: .008, decay: .17 } });
const kick = voice({ oscillators: [{ type: 'sine', gain: .35 }], duration: .16, frequencyAutomation: (t) => [{ type: 'exponentialRamp', value: 45, time: t + .13 }], envelope: { decay: .15 } });
const tap = voice({ oscillators: [{ type: 'triangle', gain: .055 }], duration: .04, envelope: { decay: .035 } });
const boing = voice({ oscillators: [{ type: 'sawtooth', gain: .035 }], duration: .18, filter: { type: 'lowpass', cutoff: 1200 }, frequencyAutomation: (t, f) => [{ type: 'exponentialRamp', value: f * .5, time: t + .16 }], envelope: { decay: .17 } });
export function createAudio(bus: EventBus) { return buildAudio(bus).audio; }
export const traceTinkerAudio = createAudioTraceHarness({ level: 'tinker-ball-034d', bpm: BPM, stepSeconds: TIME.stepSeconds, defaultSeconds: DURATION, createAudio: buildAudio });
function buildAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore({ bpm: BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2,
    sections: [{ index: 0, fromBar: 0 }, { index: 1, fromBar: 8 }, { index: 2, fromBar: 16 }, { index: 3, fromBar: 23 }, { index: 4, fromBar: 30 }],
    killLanes: { 0: [0, 1, 2, 1, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2], 1: [0, 2, 1, 3, 4, 2, 3, 5, 4, 3, 2, 1, 2, 3, 4, 2], 2: [4, 0, 5, 1, 6, 2, 5, 3, 4, 2, 5, 3, 6, 4, 3, 2], 3: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 4, 5, 6, 7], 4: [4, 3, 2, 1, 0, 2, 1, 0] } });
  let boss = -1;
  const runtime = createBeatLevelAudio({ bus, trace, score, bpm: BPM, stepsPerBar: 16, stepSeconds: TIME.stepSeconds, runAlignment: 'step', volumeScale: .8,
    mix: { compressor: { threshold: -17, ratio: 4, attack: .004, release: .2 }, delay: { time: TIME.stepSeconds * 3, feedback: .19, dampHz: 3100 }, noiseSeconds: 1 },
    onStep: ({ position, time, mode }) => { if (mode === 'ambient') {
      if (position % 8 === 0)
        v.bell(time, CHORDS[0].arp[(position / 8) % 4], .4, false);
    }
    else
      arrangement.schedule(position, time); },
  });
  const v = defineInstruments({ context: runtime.context, trace }, {
    bell(ctx: AudioContext, t: number, midi: number, velocity: number, player: boolean) { const mix = runtime.mix(); if (mix)
      mallet.play({ context: ctx, time: t, midi, velocity, destination: player ? mix.sfx : mix.music, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: .14 }] : [] }); },
    organ(ctx: AudioContext, t: number, midi: number) { const mix = runtime.mix(); if (mix)
      reed.play({ context: ctx, time: t, midi, destination: mix.music }); },
    bass(ctx: AudioContext, t: number, midi: number) { const mix = runtime.mix(); if (mix)
      bass.play({ context: ctx, time: t, midi, destination: mix.music }); },
    kick(ctx: AudioContext, t: number) { const mix = runtime.mix(); if (mix)
      kick.play({ context: ctx, time: t, frequency: 130, destination: mix.music }); },
    clap(ctx: AudioContext, t: number) { const m = runtime.mix(); if (!m?.noiseBuffer)
      return; for (let i = 0; i < 3; i++)
      playNoiseHit({ context: ctx, buffer: m.noiseBuffer, time: t + i * .012, velocity: .065, decay: .065, filterType: 'bandpass', frequency: 1450 + i * 200, destination: m.music }); },
    tick(ctx: AudioContext, t: number, midi: number, player: boolean) { const m = runtime.mix(); if (m)
      tap.play({ context: ctx, time: t, midi, destination: player ? m.sfx : m.music }); },
    snap(ctx: AudioContext, t: number, midi: number) { const m = runtime.mix(); if (m)
      boing.play({ context: ctx, time: t, midi, destination: m.sfx }); },
  });
  type Chord = typeof CHORDS[number];
  const rhythm = (dense: boolean) => [
    hits<Chord>('K.......K..k....', { K: 1, k: .7 }, ({ time }) => v.kick(time)),
    hits<Chord>('....C.......C...', { C: 1 }, ({ time }) => v.clap(time)),
    hits<Chord>(dense ? 'b..b.bb.b.b..bb.' : 'b..b..b.b..b..b.', { b: 1 }, ({ time, chord, step }) => v.bass(time, chord.bass + (step % 6 === 0 ? 12 : 0))),
    hits<Chord>('..t...t...t..t.t', { t: 1 }, ({ time, step }) => v.tick(time, step % 2 ? 91 : 86, false)),
    hits<Chord>('...R..R....R..R.', { R: 1 }, ({ time, chord }) => chord.arp.slice(0, 3).forEach(n => v.organ(time, n - 12))),
  ];
  const hook = hits<Chord>('m.....m...m..m..', { m: 1 }, ({ time, chord, step }) => v.bell(time, chord.arp[[0, 2, 1, 3][Math.floor(step / 4)]] - 12, .38, false));
  const arrangement = createArrangement<Chord>({ stepsPerBar: 16, chordAt: score.chordAt, sections: [
      { name: 'Pocket-sized', fromBar: 0, toBar: 8, tracks: [...rhythm(false), hook] },
      { name: 'Spool slalom', fromBar: 8, toBar: 16, tracks: rhythm(true) },
      { name: 'Big ideas', fromBar: 16, toBar: 23, tracks: [...rhythm(true), hook] },
      { name: 'The glue that binds', fromBar: 23, toBar: 30, tracks: [...rhythm(true), hits('..R...R...R...RR', { R: 1 }, ({ time, chord }) => v.organ(time, chord.arp[0] - 12))] },
      { name: 'All picked up', fromBar: 30, tracks: [hook, hits('b.......b.......', { b: 1 }, ({ time, chord }) => v.bass(time, chord.bass))] },
    ] });
  const action = () => { const t = score.quantizePlayerAction(runtime.context()?.currentTime ?? 0); return { t, p: score.arrangementPositionAt(t) }; };
  bus.on('spawn', e => { if (e.kind === 'spill-core')
    boss = e.enemyId; });
  bus.on('runstart', () => { boss = -1; });
  bus.on('lock', e => { const { t, p } = action(); v.tick(t, score.leadSetAt(p)[Math.min(7, e.lockCount)], true); });
  bus.on('unlock', () => { const { t, p } = action(); v.tick(t, score.chordAt(p).arp[0] - 12, true); });
  bus.on('fire', e => { const { t, p } = action(); v.snap(t, score.chordAt(p).bass + 24 + (e.indexInVolley ?? 0) * 2); });
  bus.on('hit', e => { if (!e.lethal) {
    const { t, p } = action();
    v.bell(t, score.leadSetAt(p)[Math.min(7, 12 - e.hitPointsRemaining)], .8, true);
  } });
  bus.on('kill', e => { const n = score.nextKill(runtime.context()?.currentTime ?? 0); v.bell(n.time, n.midi, 1 + (e.indexInVolley ?? 0) * .07, true); if (e.enemyId === boss) {
    const m = runtime.mix();
    if (m?.duck) {
      m.duck.gain.setValueAtTime(.4, n.time);
      m.duck.gain.linearRampToValueAtTime(1, n.time + .6);
    }
    [84, 79, 76, 72].forEach((note, i) => v.bell(n.time + i * TIME.stepSeconds, note, 1, true));
  } });
  bus.on('reject', () => { const { t, p } = action(); v.snap(t, score.chordAt(p).bass + 12); v.tick(t + .06, 48, true); });
  bus.on('miss', () => { const { t, p } = action(); v.tick(t, score.chordAt(p).bass + 24, true); });
  return runtime;
}
