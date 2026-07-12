import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createMassDriverVoices } from './audio-voices';
import { MASS_DRIVER_BPM, MASS_DRIVER_DURATION, MASS_DRIVER_TIME } from './timing';

type Section = 'injection' | 'induction' | 'compression' | 'charge';
type Chord = { bass: number; lead: readonly number[] };

const STEPS = 16;
const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const CHORDS: readonly Chord[] = [
  { bass: 29, lead: [65, 68, 72, 75, 77, 80, 84, 87] }, // Fm(add9)
  { bass: 32, lead: [68, 72, 75, 79, 80, 84, 87, 91] }, // Abmaj7
  { bass: 27, lead: [63, 67, 70, 74, 75, 79, 82, 86] }, // Ebmaj9
  { bass: 30, lead: [66, 70, 73, 77, 78, 82, 85, 89] }, // Gbmaj7
];
const SECTIONS = [
  { index: 'injection' as const, fromBar: 0 },
  { index: 'induction' as const, fromBar: 8, crossfadeBars: 1 },
  { index: 'compression' as const, fromBar: 16, crossfadeBars: 1 },
  { index: 'charge' as const, fromBar: 28 },
];
const KILL_LANES: Record<Section, readonly number[]> = {
  injection: [0, 1, 2, 1, 3, 2, 4, 3, 2, 3, 4, 5, 4, 3, 2, 1],
  induction: [0, 4, 1, 5, 2, 6, 3, 7, 4, 2, 5, 3, 6, 4, 7, 5],
  compression: [7, 3, 6, 2, 5, 1, 4, 0, 3, 5, 4, 6, 5, 7, 6, 4],
  charge: [0, 2, 4, 6, 1, 3, 5, 7, 2, 4, 6, 7, 6, 5, 4, 3],
};

export function createAudio(bus: EventBus) { return createMassDriverAudio(bus).audio; }

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-7rkv', bpm: MASS_DRIVER_BPM, stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_DURATION, createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Section>({
    bpm: MASS_DRIVER_BPM, stepsPerBar: STEPS, chords: CHORDS, barsPerChord: 2,
    sections: SECTIONS, leadSet: (chord) => chord.lead, killLanes: KILL_LANES,
  });
  let risingHum: { oscillator: OscillatorNode; gain: GainNode } | null = null;
  let interlockHits = 0;

  const runtime = createBeatLevelAudio({
    bus, trace, score, stepSeconds: SIXTEENTH, stepsPerBar: STEPS,
    scheduleAhead: 0.18, schedulerMs: 25, runAlignment: 'bar', beatNumber: 'position', volumeScale: 0.78,
    mix: {
      musicVolume: 0.82, sfxVolume: 0.86,
      compressor: { threshold: -20, ratio: 5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.28, dampHz: 3100, sendGain: 0.34 },
      reverb: { seconds: 2.2, decay: 3.2, level: 0.12 }, noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) arrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockHits = 0;
      const context = runtime.context();
      const mix = runtime.mix();
      if (!context || !mix) return;
      // The barrel itself is the sustained instrument: a 60-second electrical
      // fundamental glides more than an octave as velocity and charge rise.
      const now = context.currentTime + 0.03;
      const oscillator = context.createOscillator();
      const overtone = context.createOscillator();
      const overtoneGain = context.createGain();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      oscillator.type = 'sawtooth';
      overtone.type = 'sine';
      oscillator.frequency.setValueAtTime(42, now);
      oscillator.frequency.exponentialRampToValueAtTime(132, now + MASS_DRIVER_DURATION);
      overtone.frequency.setValueAtTime(84.4, now);
      overtone.frequency.exponentialRampToValueAtTime(397, now + MASS_DRIVER_DURATION);
      overtoneGain.gain.value = 0.16;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(170, now);
      filter.frequency.exponentialRampToValueAtTime(1900, now + MASS_DRIVER_DURATION);
      filter.Q.value = 7;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.8);
      gain.gain.linearRampToValueAtTime(0.16, now + MASS_DRIVER_DURATION - 1.1);
      gain.gain.linearRampToValueAtTime(0.001, now + MASS_DRIVER_DURATION);
      oscillator.connect(filter); overtone.connect(overtoneGain).connect(filter); filter.connect(gain).connect(mix.music);
      oscillator.start(now); overtone.start(now); oscillator.stop(now + MASS_DRIVER_DURATION + 0.05); overtone.stop(now + MASS_DRIVER_DURATION + 0.05);
      risingHum = { oscillator, gain };
      trace?.record(now, 'rising-hum', { fromHz: 42, toHz: 132, seconds: MASS_DRIVER_DURATION });
    },
    onRunEnd() {
      const context = runtime.context();
      if (context && risingHum) {
        risingHum.gain.gain.cancelAndHoldAtTime(context.currentTime);
        risingHum.gain.gain.linearRampToValueAtTime(0.001, context.currentTime + 0.035);
      }
      risingHum = null;
    },
    onDispose() { risingHum = null; },
  });

  const inst = createMassDriverVoices({ trace, context: runtime.context, mix: runtime.mix });

  const commonTrack = fn<Chord>(({ time, step, bar, chord }) => {
    const progress = Math.min(1, bar / 36);
    if (step % 4 === 0) {
      inst.pulse(time, chord.bass + (bar >= 28 ? 12 : 0), step === 0 ? 1 : 0.78);
      inst.induction(time, chord.bass + 24 + ((bar + step / 4) % 4), 0.07 + progress * 0.045, 900 + progress * 3900);
    }
    if (step % 2 === 1 && bar >= 8) inst.tick(time, 0.018 + progress * 0.025, bar >= 28 && step % 4 === 3);
    if (bar >= 16 && step % 4 === 2) inst.induction(time, chord.lead[(bar + step) % chord.lead.length] - 12, 0.045, 1500 + progress * 3000);
    if (bar >= 28 && step % 2 === 0) inst.induction(time, 48 + Math.floor(progress * 18) + step / 2, 0.035, 3400 + step * 120);
  });

  const arrangement = createArrangement<Chord>({
    stepsPerBar: STEPS, chordAt: score.chordAt, trace, emitSections: true,
    sections: [
      { name: 'INJECTION', fromBar: 0, toBar: 8, tracks: [commonTrack] },
      { name: 'INDUCTION', fromBar: 8, toBar: 16, tracks: [commonTrack] },
      { name: 'COMPRESSION', fromBar: 16, toBar: 28, tracks: [commonTrack] },
      { name: 'FINAL CHARGE', fromBar: 28, toBar: 36, tracks: [commonTrack] },
    ],
  });

  function scheduleStep({ position, time, mode, step, bar }: BeatLevelAudioStep) {
    if (mode === 'run') arrangement.schedule(position, time);
    else if (step % 8 === 0) {
      const chord = CHORDS[bar % CHORDS.length];
      inst.induction(time, chord.bass + 24, 0.035, 780);
    }
  }

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context(); if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    inst.action(time, lead[Math.min(lockCount - 1, lead.length - 1)], 'triangle', 0.1, 2800 + lockCount * 300, 0.055 + lockCount * 0.008);
  });
  bus.on('unlock', () => {
    const context = runtime.context(); if (!context) return;
    inst.action(context.currentTime, 54, 'sine', 0.09, 900, 0.055);
  });
  bus.on('fire', ({ volleySize, indexInVolley }) => {
    const context = runtime.context(); if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime) + (indexInVolley ?? 0) * 0.012;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.action(time, chord.bass + 24 + volleySize, 'sawtooth', 0.16, 2200 + volleySize * 400, 0.075 + volleySize * 0.012);
    if (volleySize === 6 && (indexInVolley ?? 0) === 0) inst.arc(time, 0.11, 0.34);
  });
  bus.on('hit', ({ lethal, stageCompleted }) => {
    const context = runtime.context(); if (!context) return;
    if (stageCompleted) interlockHits += 1;
    if (!lethal) inst.action(context.currentTime, 58 + Math.min(12, interlockHits), 'square', 0.13, 3400, 0.06);
  });
  bus.on('kill', () => {
    const context = runtime.context(); if (!context) return;
    const kill = score.nextKill(context.currentTime);
    inst.action(kill.time, kill.midi, 'sine', 0.38, 5200, 0.14);
    inst.arc(kill.time, 0.065, 0.2);
  });
  bus.on('miss', () => {
    const context = runtime.context(); if (!context) return;
    inst.action(context.currentTime, 35, 'sawtooth', 0.24, 520, 0.07);
  });
  bus.on('reject', () => {
    const context = runtime.context(); if (!context) return;
    inst.arc(context.currentTime, 0.12, 0.16);
    inst.action(context.currentTime, 41, 'square', 0.12, 740, 0.055);
  });
  bus.on('playerhit', () => {
    const context = runtime.context(); if (!context) return;
    inst.arc(context.currentTime, 0.3, 0.9);
    inst.action(context.currentTime, 28, 'sawtooth', 0.75, 420, 0.18);
  });

  return runtime;
}
