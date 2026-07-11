import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createScore } from '../../engine/score';
import { midiToFreq } from '../../engine/music';
import { DOWNPOUR_7SNM_BPM, DOWNPOUR_7SNM_RUN_DURATION, DOWNPOUR_7SNM_TIME } from './gameplay';

type Section = 'storm' | 'plunge' | 'undercity' | 'hunt' | 'release';
type Chord = { bass: number; lead: readonly number[] };
const CHORDS: readonly Chord[] = [
  { bass: 34, lead: [70, 73, 77, 80, 82, 85] },
  { bass: 31, lead: [67, 70, 73, 77, 79, 82] },
  { bass: 36, lead: [72, 75, 79, 82, 84, 87] },
  { bass: 29, lead: [65, 68, 72, 75, 77, 80] },
];
const SECTIONS = [
  { index: 'storm' as const, fromBar: 0 }, { index: 'plunge' as const, fromBar: 4 },
  { index: 'undercity' as const, fromBar: 16 }, { index: 'hunt' as const, fromBar: 28 },
  { index: 'release' as const, fromBar: 40 },
];
const KILL_LANES: Record<Section, readonly number[]> = {
  storm: [0, 1, 2, 1, 3, 2, 4, 3, 2, 1, 3, 4, 5, 4, 2, 1],
  plunge: [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 4, 5, 3],
  undercity: [2, 1, 3, 0, 4, 2, 5, 3, 1, 4, 2, 0, 3, 5, 4, 2],
  hunt: [0, 3, 1, 4, 2, 5, 3, 1, 4, 0, 2, 5, 3, 4, 1, 2],
  release: [5, 4, 3, 2, 4, 3, 2, 1, 3, 2, 1, 0, 2, 1, 0, 0],
};

export function createAudio(bus: EventBus) {
  const score = createScore<Chord, Section>({ bpm: DOWNPOUR_7SNM_BPM, stepsPerBar: 16, chords: CHORDS, barsPerChord: 2, sections: SECTIONS, leadSet: c => c.lead, killLanes: KILL_LANES });
  const runtime = createBeatLevelAudio({
    bus, score, stepSeconds: DOWNPOUR_7SNM_TIME.stepSeconds, runAlignment: 'bar', scheduleAhead: 0.14, schedulerMs: 24, volumeScale: 0.72,
    mix: { combinedVolume: true, compressor: { threshold: -20, ratio: 6, attack: 0.003, release: 0.14 }, noiseSeconds: 2 },
    onStep({ position, time, mode, bar, step }) {
      if (mode !== 'run') { if (step === 0) inst.pad(time, 46 + (bar % 2) * 3, 0.035, 1.2); if (step % 4 === 2) inst.rain(time, 0.018, 0.09); return; }
      const chord = score.chordAt(position);
      if (bar < 4) { if (step % 4 === 0) inst.rain(time, 0.035, 0.18); if (step === 0) inst.pad(time, chord.bass + 24, 0.045, 1.3); return; }
      if (bar >= 40) { if (step === 0) inst.pad(time, chord.bass + 36, 0.055, 1.0); if (step === 12) inst.rain(time, 0.012, 0.12); return; }
      const half = bar >= 28;
      if ((!half && (step === 0 || step === 10)) || (half && step === 0)) inst.kick(time, half ? 0.17 : 0.14);
      if ((!half && (step === 4 || step === 12)) || (half && step === 8)) inst.snare(time, half ? 0.16 : 0.12);
      if (step % 2 === 1) inst.rain(time, bar >= 16 ? 0.038 : 0.028, 0.035);
      if (step % 4 === 0) inst.bass(time, chord.bass + ((step === 12) ? 7 : 0), half ? 0.11 : 0.085);
      if ((bar === 4 || bar === 16) && step === 0) inst.thunder(time, 0.23, 1.1);
      if (bar >= 28 && step === 14) inst.gunship(time, 0.075);
    },
  });
  const bassVoice = voice({ oscillators: [{ type: 'sawtooth' }, { type: 'sine', detune: -8 }], duration: 0.24, filter: { type: 'lowpass', frequency: 700 }, gainAutomation: t => [{ type: 'set', value: 0.001, time: t }, { type: 'linearRamp', value: 0.16, time: t + 0.008 }, { type: 'exponentialRamp', value: 0.001, time: t + 0.24 }] });
  const padVoice = voice({ oscillators: [{ type: 'triangle' }, { type: 'sine', detune: 7 }], duration: 1.4, filter: { type: 'lowpass', frequency: 1100 }, gainAutomation: t => [{ type: 'set', value: 0.001, time: t }, { type: 'linearRamp', value: 0.07, time: t + 0.22 }, { type: 'exponentialRamp', value: 0.001, time: t + 1.4 }] });
  const noise = noiseHit({ filterType: 'highpass', frequency: 4200, decay: 0.08 });
  const inst = defineInstruments({ context: runtime.context }, {
    bass(ctx, time, midi, _gain) { const m = runtime.mix(); if (m?.master) bassVoice.play({ context: ctx, time, midi, destination: m.master }); },
    pad(ctx, time, midi, _gain, _duration) { const m = runtime.mix(); if (m?.master) padVoice.play({ context: ctx, time, midi, destination: m.master }); },
    rain(ctx, time, gain, decay) { const m = runtime.mix(); if (m?.master && m.noiseBuffer) noise.play({ context: ctx, buffer: m.noiseBuffer, time, velocity: gain, decay, destination: m.master, offset: Math.random() }); },
    kick(ctx, time, gain) { const m = runtime.mix(); if (!m?.master) return; const o=ctx.createOscillator(), g=ctx.createGain(); o.frequency.setValueAtTime(145,time); o.frequency.exponentialRampToValueAtTime(42,time+0.11); g.gain.setValueAtTime(gain,time); g.gain.exponentialRampToValueAtTime(0.001,time+0.18); o.connect(g).connect(m.master); o.start(time); o.stop(time+0.2); },
    snare(ctx, time, gain) { const m=runtime.mix(); if (m?.master && m.noiseBuffer) noise.play({ context:ctx, buffer:m.noiseBuffer,time,velocity:gain,decay:0.12,destination:m.master,offset:0.4 }); },
    thunder(ctx,time,gain,decay) { const m=runtime.mix(); if (!m?.master) return; const o=ctx.createOscillator(),g=ctx.createGain(); o.type='sawtooth'; o.frequency.setValueAtTime(62,time); o.frequency.exponentialRampToValueAtTime(24,time+decay); g.gain.setValueAtTime(gain,time); g.gain.exponentialRampToValueAtTime(.001,time+decay); o.connect(g).connect(m.master); o.start(time); o.stop(time+decay+.05); },
    gunship(ctx,time,gain) { const m=runtime.mix(); if (!m?.master)return; const o=ctx.createOscillator(),g=ctx.createGain(); o.type='square'; o.frequency.value=55; g.gain.setValueAtTime(gain,time); g.gain.exponentialRampToValueAtTime(.001,time+.16); o.connect(g).connect(m.master);o.start(time);o.stop(time+.18); },
    tone(ctx,time,midi,gain,decay) { const m=runtime.mix(); if(!m?.master)return; const o=ctx.createOscillator(),g=ctx.createGain();o.type='triangle';o.frequency.value=midiToFreq(midi);g.gain.setValueAtTime(gain,time);g.gain.exponentialRampToValueAtTime(.001,time+decay);o.connect(g).connect(m.master);o.start(time);o.stop(time+decay+.03); },
  });
  bus.on('lock', ({ lockCount }) => { const c=runtime.context(); if(!c)return; const t=score.quantizePlayerAction(c.currentTime), lead=score.leadSetAt(score.arrangementPositionAt(t)); inst.tone(t,lead[(lockCount-1)%lead.length],.055,.11); });
  bus.on('fire', () => { const c=runtime.context(); if(!c)return; const t=score.quantizePlayerAction(c.currentTime); inst.bass(t,score.chordAt(score.arrangementPositionAt(t)).bass+12,.13); });
  bus.on('hit', () => { const c=runtime.context(); if(c) inst.rain(c.currentTime,.075,.06); });
  bus.on('kill', () => { const c=runtime.context(); if(!c)return; const k=score.nextKill(c.currentTime); inst.tone(k.time,k.midi,.11,.32); });
  bus.on('miss', () => { const c=runtime.context(); if(c) inst.gunship(c.currentTime,.065); });
  bus.on('reject', () => { const c=runtime.context(); if(!c)return; inst.gunship(c.currentTime,.11); inst.tone(c.currentTime+0.025,43,.07,.16); });
  return runtime.audio;
}
