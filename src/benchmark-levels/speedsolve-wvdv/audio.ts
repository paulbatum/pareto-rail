import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createScore } from '../../engine/score';
import {
  SPEEDSOLVE_WVDV_BPM,
  SPEEDSOLVE_WVDV_RUN_DURATION,
  SPEEDSOLVE_WVDV_SCORE_SECTIONS,
  SPEEDSOLVE_WVDV_SECTIONS,
  SPEEDSOLVE_WVDV_STEPS_PER_BAR,
  SPEEDSOLVE_WVDV_TIME,
  type SpeedsolveSection,
} from './timing';

const STEP = SPEEDSOLVE_WVDV_TIME.stepSeconds;

type Chord = { bass: number; mechanism: readonly number[]; lead: readonly number[] };
const CHORDS: readonly Chord[] = [
  { bass: 38, mechanism: [50, 57, 62, 66], lead: [74, 78, 81, 86, 90, 93, 98, 102] },
  { bass: 41, mechanism: [53, 60, 65, 69], lead: [72, 77, 81, 84, 89, 93, 96, 101] },
  { bass: 36, mechanism: [48, 55, 60, 64], lead: [72, 76, 79, 84, 88, 91, 96, 100] },
  { bass: 43, mechanism: [55, 62, 67, 71], lead: [74, 79, 83, 86, 91, 95, 98, 103] },
] as const;

const lane = (offset: number) => Array.from({ length: 16 }, (_, step) => (step * 3 + offset + (step % 3) * 2) % 8);
const KILL_LANES: Record<SpeedsolveSection, readonly number[]> = {
  white: lane(0), red: lane(2), blue: lane(5), orange: lane(1),
  green: lane(4), yellow: lane(6), core: lane(7), resolve: [7, 6, 5, 4, 3, 2, 1, 0, 2, 1, 0, 0, 0, 0, 0, 0],
};

export function createAudio(bus: EventBus) {
  return createSpeedsolveAudio(bus).audio;
}

export const traceSpeedsolveWvdvAudio = createAudioTraceHarness({
  level: 'speedsolve-wvdv',
  bpm: SPEEDSOLVE_WVDV_BPM,
  stepSeconds: STEP,
  defaultSeconds: SPEEDSOLVE_WVDV_RUN_DURATION,
  createAudio: createSpeedsolveAudio,
});

function createSpeedsolveAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, SpeedsolveSection>({
    bpm: SPEEDSOLVE_WVDV_BPM,
    stepsPerBar: SPEEDSOLVE_WVDV_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: SPEEDSOLVE_WVDV_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const enemyKinds = new Map<number, string>();
  let facesDown = 0;
  let coreId = -1;
  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    stepSeconds: STEP,
    scheduleAhead: 0.14,
    schedulerMs: 24,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.72,
    mix: {
      compressor: { threshold: -20, ratio: 5.5, attack: 0.003, release: 0.18 },
      delay: { time: STEP * 3, feedback: 0.22, dampHz: 3400 },
      reverb: { seconds: 1.4, decay: 2.1, level: 0.22 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() { enemyKinds.clear(); facesDown = 0; coreId = -1; },
    onRunEnd() {
      const context = runtime.context();
      if (context) inst.chord(context.currentTime + 0.04, [50, 57, 62, 66, 69, 74], 0.13, 3.8);
    },
  });

  const clickHit = noiseHit({ filterType: 'highpass', frequency: 6200, decay: 0.024 });
  const snapHit = noiseHit({ filterType: 'bandpass', frequency: 2400, decay: 0.07 });
  const bassVoice = voice({
    oscillators: [{ type: 'sine' }, { type: 'triangle', octave: 1, gain: 0.18 }],
    duration: 0.34,
    filter: { type: 'lowpass', frequency: 760 },
    envelope: { attack: 0.003, decay: 0.32, peak: 0.2 },
  });
  const keyVoice = voice({
    oscillators: [{ type: 'square' }, { type: 'sine', octave: 1, gain: 0.24 }],
    duration: 0.19,
    filter: { type: 'bandpass', frequency: 2600, Q: 2.8 },
    envelope: { attack: 0.002, decay: 0.18, peak: 0.085 },
  });
  const coreVoice = voice({
    oscillators: [{ type: 'sawtooth' }, { type: 'square', detune: 7, gain: 0.28 }],
    duration: 0.42,
    filter: { type: 'lowpass', frequency: 1200, Q: 1.6 },
    envelope: { attack: 0.004, decay: 0.4, peak: 0.08 },
  });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    click(context, time, velocity = 1, frequency = 6200) {
      const mix = runtime.mix();
      if (!mix?.master || !mix.noiseBuffer) return;
      clickHit.play({ context, buffer: mix.noiseBuffer, time, velocity, frequency, destination: mix.master, offset: (time * 0.73) % 1.6 });
    },
    snap(context, time, midi, velocity = 1) {
      const mix = runtime.mix();
      if (!mix?.master || !mix.noiseBuffer) return;
      snapHit.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * 0.11, destination: mix.master, offset: (time * 0.41) % 1.7 });
      keyVoice.play({ context, time, midi, velocity, destination: mix.master, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.18 }] : undefined });
    },
    bass(context, time, midi, velocity = 1) {
      const destination = runtime.mix()?.master;
      if (destination) bassVoice.play({ context, time, midi, velocity, destination });
    },
    core(context, time, midi, velocity = 1, cutoff = 1200) {
      const destination = runtime.mix()?.master;
      if (destination) coreVoice.play({ context, time, midi, velocity, cutoff, destination });
    },
    chord(context, time, notes: readonly number[], velocity: number, decay = 1.2) {
      const mix = runtime.mix();
      if (!mix?.master) return;
      for (const [index, midi] of notes.entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), time);
        gain.gain.setValueAtTime(velocity / Math.sqrt(notes.length), time + index * 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        oscillator.connect(gain).connect(mix.master);
        if (mix.reverbSend) gain.connect(mix.reverbSend);
        oscillator.start(time + index * 0.008);
        oscillator.stop(time + decay + 0.05);
      }
    },
  });

  const mechanicalTrack = fn<Chord>(({ time, step, bar, chord }) => {
    const layer = Math.min(6, Math.floor(bar / 4));
    if (step === 0 || step === 8) inst.bass(time, chord.bass - (bar >= 24 ? 12 : 0), 0.74 + layer * 0.045);
    if (step % 4 === 0) inst.click(time, step === 0 ? 0.12 : 0.065, step === 0 ? 3200 : 6200);
    if (layer >= 1 && (step === 4 || step === 12)) inst.snap(time, chord.mechanism[(bar + step / 4) % chord.mechanism.length], 0.42);
    if (layer >= 2 && step % 4 === 2) inst.click(time, 0.034 + layer * 0.005, 7800);
    if (layer >= 3 && step % 2 === 1 && step % 4 !== 1) inst.click(time, 0.025, 9800);
    if (layer >= 4 && step === 6) inst.core(time, chord.bass + 12, 0.35, 1700 + layer * 180);
    if (bar >= 24 && step % 2 === 0) inst.core(time, chord.bass + 12 + (step % 8), 0.25 + (bar - 24) * 0.025, 1800 + (bar - 24) * 420);
    if (bar >= 30 && step === 0) inst.chord(time, [50, 57, 62, 66, 69, 74], 0.095, STEP * 28);
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: SPEEDSOLVE_WVDV_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: SPEEDSOLVE_WVDV_SECTIONS.map((section) => ({
      name: section.name,
      fromBar: section.fromBar,
      toBar: section.toBar,
      tracks: [mechanicalTrack],
    })),
  });
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: SPEEDSOLVE_WVDV_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{ name: 'inspection-loop', fromBar: 0, tracks: [fn(({ time, step, chord }) => {
      if (step === 0) inst.chord(time, chord.mechanism.slice(1), 0.028, STEP * 18);
      if (step % 4 === 0) inst.click(time, 0.025, 7200);
    })] }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'run') runArrangement.schedule(position, time);
    else ambientArrangement.schedule(position, time);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
    if (kind === 'core') coreId = enemyId;
  });
  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    inst.snap(time, lead[Math.min(lead.length - 1, lockCount - 1)], 0.52 + lockCount * 0.055);
  });
  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.bass(time, chord.bass + (volleySize >= 6 ? 12 : 0), 0.72 + volleySize * 0.07);
    inst.click(time, 0.07 + volleySize * 0.012, 4100);
  });
  bus.on('hit', ({ enemyId, hitPointsRemaining, hitStageCount }) => {
    const context = runtime.context();
    if (!context) return;
    if (enemyId === coreId) {
      const damage = 1 - hitPointsRemaining / Math.max(1, hitStageCount * 3);
      inst.core(score.quantizePlayerAction(context.currentTime), 38 + Math.round(damage * 24), 0.55 + damage * 0.65, 1300 + damage * 5200);
    } else inst.click(context.currentTime, 0.065, 5200);
  });
  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    const kind = enemyKinds.get(enemyId);
    if (kind === 'tile') {
      const kill = score.nextKill(context.currentTime);
      inst.snap(kill.time, kill.midi, 0.82);
      inst.click(kill.time, 0.13, 2100);
    } else if (kind === 'weakpoint') {
      facesDown += 1;
      const time = score.quantizePlayerAction(context.currentTime);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      inst.chord(time, [...chord.mechanism, chord.lead[Math.min(facesDown, chord.lead.length - 1)]], 0.12, 1.45);
      inst.bass(time, chord.bass + facesDown * 2, 1.05);
    } else if (kind === 'core') {
      const time = score.quantizePlayerAction(context.currentTime);
      inst.chord(time, [38, 45, 50, 54, 57, 62, 66, 69, 74, 78], 0.17, 5.5);
      inst.click(time, 0.24, 1200);
    } else {
      const kill = score.nextKill(context.currentTime);
      inst.snap(kill.time, kill.midi, 0.62);
    }
  });
  bus.on('stage', ({ enemyId, stageIndex }) => {
    const context = runtime.context();
    if (context && enemyId === coreId) inst.chord(score.quantizePlayerAction(context.currentTime), [50 + stageIndex * 5, 57 + stageIndex * 5, 62 + stageIndex * 5], 0.13, 1.2);
  });
  bus.on('miss', () => {
    const context = runtime.context();
    if (context) inst.core(context.currentTime, 29, 0.24, 620);
  });
  bus.on('playerhit', () => {
    const context = runtime.context();
    if (!context) return;
    inst.click(context.currentTime, 0.22, 880);
    inst.core(context.currentTime, 26, 0.95, 540);
  });
  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    inst.click(context.currentTime, 0.18, 1300);
    inst.snap(context.currentTime + 0.012, 49, 0.32);
  });

  return runtime;
}
