import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createMassDriverDetailedVoices } from './audio-voices';
import {
  MASS_DRIVER_DETAILED_M7HQ_BPM,
  MASS_DRIVER_DETAILED_M7HQ_RUN_DURATION,
  MASS_DRIVER_DETAILED_M7HQ_SCORE_SECTIONS,
  MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME,
  MASS_DRIVER_DETAILED_M7HQ_TIME,
  type MassDriverDetailedM7hqSection,
} from './timing';

type Chord = { bass: number; lead: readonly number[] };

const STEPS = 16;
const SIXTEENTH = MASS_DRIVER_DETAILED_M7HQ_TIME.stepSeconds;
const SHOT_BEAT = Math.round(MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME / MASS_DRIVER_DETAILED_M7HQ_TIME.beatSeconds);
const CHORDS: readonly Chord[] = [
  { bass: 28, lead: [64, 66, 67, 71, 72, 74, 76, 79] }, // Em
  { bass: 28, lead: [64, 67, 71, 74, 76, 79, 83, 86] }, // Em
  { bass: 24, lead: [60, 64, 67, 71, 72, 76, 79, 83] }, // C
  { bass: 26, lead: [62, 66, 69, 72, 74, 78, 81, 84] }, // D
];
const BOSS_CHORDS: readonly Chord[] = [
  { bass: 28, lead: [64, 67, 71, 74, 76, 79, 83, 86] }, // Em
  { bass: 29, lead: [65, 69, 72, 76, 77, 81, 84, 88] }, // F
];
const KILL_LANES: Record<MassDriverDetailedM7hqSection, readonly number[]> = {
  injection: [0, 1, 2, 1, 3, 2, 4, 3, 2, 4, 5, 3, 6, 4, 3, 1],
  'stage-1': [1, 3, 2, 4, 3, 5, 4, 6, 2, 5, 3, 6, 4, 7, 5, 3],
  'stage-2': [3, 5, 4, 6, 5, 7, 4, 6, 2, 5, 7, 6, 4, 7, 5, 3],
  interlock: [0, 2, 1, 3, 2, 4, 3, 5, 1, 4, 2, 5, 3, 6, 4, 7],
  muzzle: [7, 6, 5, 4, 3, 2, 1, 0, 4, 6, 7, 5, 3, 1, 2, 0],
};

export function createAudio(bus: EventBus) {
  return createMassDriverDetailedAudio(bus).audio;
}

export const traceMassDriverDetailedM7hqAudio = createAudioTraceHarness({
  level: 'mass-driver-detailed-m7hq',
  bpm: MASS_DRIVER_DETAILED_M7HQ_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_DETAILED_M7HQ_RUN_DURATION,
  createAudio: createMassDriverDetailedAudio,
});

function createMassDriverDetailedAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, MassDriverDetailedM7hqSection>({
    bpm: MASS_DRIVER_DETAILED_M7HQ_BPM,
    stepsPerBar: STEPS,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ chords: BOSS_CHORDS, fromBar: 20, toBar: 28, barsPerChord: 2 }],
    sections: MASS_DRIVER_DETAILED_M7HQ_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });
  const interlockIds = new Set<number>();
  let interlockKills = 0;
  let shotOutcomePlayed = false;
  let risingHum: { gain: GainNode; oscillators: OscillatorNode[] } | null = null;
  let idleHum: { gain: GainNode; oscillators: OscillatorNode[] } | null = null;

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    stepSeconds: SIXTEENTH,
    stepsPerBar: STEPS,
    scheduleAhead: 0.18,
    schedulerMs: 25,
    // The run begins on the next transport step, not the next bar: this keeps
    // camera-time ring crossings phase-locked to the quarter-note pulse.
    runAlignment: 'step',
    beatNumber: 'position',
    volumeScale: 0.74,
    mix: {
      musicVolume: 0.82,
      sfxVolume: 0.9,
      compressor: { threshold: -20, ratio: 5, attack: 0.004, release: 0.21 },
      delay: { time: SIXTEENTH * 3, feedback: 0.31, dampHz: 3600, sendGain: 0.36 },
      reverb: { seconds: 3.2, decay: 4.1, level: 0.14 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      const now = context.currentTime;
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const sub = context.createOscillator();
      const saw = context.createOscillator();
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      filter.Q.value = 4;
      gain.gain.value = 0.022;
      sub.type = 'sine';
      sub.frequency.value = 38;
      saw.type = 'sawtooth';
      saw.frequency.value = 38.3;
      saw.detune.value = 4;
      sub.connect(filter);
      saw.connect(filter);
      filter.connect(gain).connect(mix.music);
      sub.start(now);
      saw.start(now);
      idleHum = { gain, oscillators: [sub, saw] };
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) arrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockKills = 0;
      shotOutcomePlayed = false;
      const context = runtime.context();
      const mix = runtime.mix();
      if (!context || !mix) return;
      const now = context.currentTime + 0.025;
      if (idleHum) idleHum.gain.gain.linearRampToValueAtTime(0.001, now + 0.18);
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const sub = context.createOscillator();
      const sawA = context.createOscillator();
      const sawB = context.createOscillator();
      sub.type = 'sine';
      sawA.type = 'sawtooth';
      sawB.type = 'sawtooth';
      sawA.detune.value = -7;
      sawB.detune.value = 8;
      for (const oscillator of [sub, sawA, sawB]) {
        oscillator.frequency.setValueAtTime(41.2, now);
        oscillator.frequency.exponentialRampToValueAtTime(82.4, now + MASS_DRIVER_DETAILED_M7HQ_TIME.bar(20));
        oscillator.frequency.exponentialRampToValueAtTime(185, now + MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME - 0.04);
        oscillator.connect(filter);
      }
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(145, now);
      filter.frequency.exponentialRampToValueAtTime(2300, now + MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME - 0.08);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.065, now + 0.8);
      gain.gain.linearRampToValueAtTime(0.145, now + MASS_DRIVER_DETAILED_M7HQ_TIME.bar(20));
      gain.gain.linearRampToValueAtTime(0.205, now + MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME - 0.08);
      gain.gain.linearRampToValueAtTime(0.001, now + MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME);
      filter.connect(gain).connect(mix.music);
      for (const oscillator of [sub, sawA, sawB]) {
        oscillator.start(now);
        oscillator.stop(now + MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME + 0.08);
      }
      risingHum = { gain, oscillators: [sub, sawA, sawB] };
      trace?.record(now, 'climbing-hum', { fromHz: 41.2, middleHz: 82.4, peakHz: 185, cutAt: MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME });
    },
    onRunEnd() {
      const context = runtime.context();
      if (context && risingHum) {
        risingHum.gain.gain.cancelAndHoldAtTime(context.currentTime);
        risingHum.gain.gain.linearRampToValueAtTime(0.001, context.currentTime + 0.03);
      }
      if (context && idleHum) idleHum.gain.gain.linearRampToValueAtTime(0.022, context.currentTime + 0.8);
      risingHum = null;
    },
    onDispose() {
      risingHum = null;
      idleHum = null;
    },
  });

  const inst = createMassDriverDetailedVoices({ trace, context: runtime.context, mix: runtime.mix });

  const arrangement = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'INJECTION', fromBar: 0, toBar: 4, tracks: [fn(scheduleInjection)] },
      { name: 'STAGE 1', fromBar: 4, toBar: 12, tracks: [fn(scheduleStage1)] },
      { name: 'STAGE 2', fromBar: 12, toBar: 20, tracks: [fn(scheduleStage2)] },
      { name: 'INTERLOCK', fromBar: 20, toBar: 28, tracks: [fn(scheduleInterlock)] },
      { name: 'THE SHOT / MUZZLE', fromBar: 28, toBar: 32, tracks: [fn(scheduleMuzzle)] },
    ],
  });

  function scheduleInjection({ time, step, bar, chord }: { time: number; step: number; bar: number; chord: Chord }) {
    if (step === 0 || (bar >= 2 && step === 10)) inst.kick(time, step === 0 ? 0.76 : 0.24);
    if (step % 4 === 0) {
      const degree = (bar * 4 + step / 4) % chord.lead.length;
      inst.synth(time, chord.lead[degree] - 12, 'triangle', 0.035 + step * 0.0015, 2100, 0.18, 0.18);
    }
    if (step === 6 || step === 14) inst.noise(time, 0.018, 7200, 0.025);
    if (bar === 3 && step >= 8) inst.noise(time, 0.018 + step * 0.002, 1800 + step * 240, 0.08);
  }

  function scheduleStage1({ time, step, bar, chord }: { time: number; step: number; bar: number; chord: Chord }) {
    if (step % 4 === 0) inst.kick(time, step === 0 ? 0.92 : 0.76);
    if (step % 4 === 2) inst.noise(time, 0.035, 6500, 0.035);
    if (step % 2 === 0) inst.bass(time, chord.bass + (step === 14 ? 12 : 0), 0.095, 720, 0.2);
    if (step === 0) inst.pad(time, chord.bass + 24, 0.026, MASS_DRIVER_DETAILED_M7HQ_TIME.barSeconds * 1.9, false);
    if (step % 4 === 0 && (bar + step / 4) % 2 === 0) inst.synth(time, chord.lead[(bar + step) % chord.lead.length], 'triangle', 0.038, 2600, 0.16, 0.2);
    if (bar === 11) {
      if (step === 4 || step === 12) inst.noise(time, 0.045, 1850, 0.065);
      if (step % 2 === 1) inst.noise(time, 0.012 + step * 0.0007, 6800, 0.022);
      if (step % 4 === 0) inst.synth(time, chord.lead[(step / 4 + 2) % chord.lead.length] - 12, 'sawtooth', 0.016 + step * 0.0008, 1500 + step * 90, 0.1, 0.12);
    }
  }

  function scheduleStage2({ time, step, bar, chord }: { time: number; step: number; bar: number; chord: Chord }) {
    if (bar === 19) {
      if (step === 0) {
        inst.kick(time, 0.72);
        inst.pad(time, chord.bass + 24, 0.024, MASS_DRIVER_DETAILED_M7HQ_TIME.barSeconds * 1.7, false);
      }
      if (step % 4 === 2) inst.noise(time, 0.014 + step * 0.001, 5200 + step * 90, 0.04);
      if (step % 4 === 0) inst.synth(time, chord.lead[(step / 4 + 5) % chord.lead.length], 'triangle', 0.022 + step * 0.001, 2600 + step * 120, 0.22, 0.34);
      return;
    }
    if (step % 4 === 0) inst.kick(time, step === 0 ? 1 : 0.82);
    if (step === 4 || step === 12) inst.noise(time, 0.09, 1700, 0.075);
    if (step % 2 === 1) inst.noise(time, step % 4 === 3 ? 0.028 : 0.019, step % 4 === 3 ? 4200 : 7600, step % 4 === 3 ? 0.09 : 0.025);
    const bassMidi = chord.bass + ([0, 7, 12, 7][Math.floor(step / 2) % 4]);
    if (step % 2 === 0) inst.bass(time, bassMidi, 0.087, 1100 + step * 45, 0.17);
    if (step % 2 === 0) {
      const acidMidi = chord.lead[(bar + Math.floor(step / 2)) % chord.lead.length] - 12;
      inst.synth(time, acidMidi, 'sawtooth', 0.035, 1800 + ((bar * 13 + step * 97) % 2600), 0.11, 0.16);
    }
    if (step % 4 === 0) inst.synth(time, chord.lead[(bar + step / 4) % chord.lead.length] + 12, 'square', 0.025, 3900, 0.12, 0.28);
  }

  function scheduleInterlock({ time, step, bar, chord }: { time: number; step: number; bar: number; chord: Chord }) {
    if (step % 4 === 0 || step === 14) inst.kick(time, step === 0 ? 1.08 : step === 14 ? 0.52 : 0.85);
    if (step === 4 || step === 12) inst.noise(time, 0.1, 1500, 0.085);
    if (step % 2 === 1) inst.noise(time, 0.022 + (bar - 20) * 0.003, step % 4 === 3 ? 4200 : 7400, 0.03);
    if (step % 2 === 0) inst.bass(time, chord.bass + (step % 8 === 6 ? 12 : 0), 0.1, 1350 + (bar - 20) * 210, 0.16);
    if (bar < 22 && (step === 0 || step === 8)) {
      inst.synth(time, 52 + (bar - 20) * 2, 'square', 0.07, 1250, 0.62, 0.35);
      inst.synth(time + 0.18, 51 + (bar - 20) * 2, 'square', 0.05, 1050, 0.52, 0.32);
    }
    if ((bar - 20) % 2 === 0 && step === 2) inst.synth(time, 76 + (bar - 20), 'sawtooth', 0.045, 4300, 0.75, 0.4);
    if (step % 4 === 3) inst.noise(time, 0.015 + (bar - 20) * 0.005 + step * 0.001, 1300 + (bar - 20) * 520 + step * 120, 0.11);
    if (bar === 27 && step >= 4) {
      const density = step < 8 ? 2 : step < 12 ? 1 : 0;
      if (density === 0 || step % density === 0) inst.noise(time, 0.04 + step * 0.004, 2400 + step * 260, 0.05);
    }
  }

  function scheduleMuzzle({ time, step, bar }: { time: number; step: number; bar: number; chord: Chord }) {
    const launchSucceeded = trace ? true : interlockKills >= 6;
    // Browser outcome audio is fired by the real beat event below, after the
    // scheduler look-ahead window. The trace has no timed bus events, so it
    // records the authored successful shot here.
    if (trace && bar === 28 && step === 0) playShotOutcome(time, true, true);
    if (launchSucceeded) {
      if (bar >= 29 && step % 8 === 3) inst.synth(time, [88, 92, 95, 100][(bar + step) % 4], 'sine', 0.013, 7200, 0.65, 0.72);
      if (bar === 31 && step === 8) inst.bass(time, 28, 0.028, 240, 1.2);
    } else if (step === 0 && bar < 30) {
      inst.noise(time, 0.07, 120 + (bar - 28) * 35, 1.15);
    }
  }

  function playShotOutcome(time: number, launchSucceeded: boolean, recordTrace = false) {
    if (launchSucceeded) {
      inst.kick(time, 1.55);
      inst.noise(time, 0.34, 800, 1.15);
      for (const midi of [40, 44, 47, 52]) inst.pad(time, midi, 0.055, MASS_DRIVER_DETAILED_M7HQ_TIME.barSeconds * 3.7, true);
      runtime.mix()?.duckAt(time, 0.18, 1.4);
      if (recordTrace) trace?.record(time, 'shot-outcome', { outcome: 'payload-away', harmony: 'E-major' });
    } else {
      runtime.mix()?.duckAt(time, 0.055, 2.2);
      inst.breaker(time, 0.38, 1.8);
      inst.bass(time, 16, 0.18, 170, MASS_DRIVER_DETAILED_M7HQ_TIME.barSeconds * 2.4);
      inst.noise(time, 0.28, 190, 2.6);
    }
  }

  function scheduleStep({ position, time, mode, step, bar }: BeatLevelAudioStep) {
    if (mode === 'run') arrangement.schedule(position, time);
    else {
      const chord = CHORDS[bar % CHORDS.length];
      if (step % 4 === 0) inst.synth(time, chord.lead[(bar + step / 4) % chord.lead.length] - 12, 'sine', 0.022, 1700, 0.38, 0.42);
      if (step === 0) inst.pad(time, chord.bass + 24, 0.018, MASS_DRIVER_DETAILED_M7HQ_TIME.barSeconds * 1.8, false);
    }
  }

  function timbreForSection(section: MassDriverDetailedM7hqSection) {
    if (section === 'injection') return { type: 'sine' as OscillatorType, bright: 3200, send: 0.32, gain: 0.064 };
    if (section === 'stage-1') return { type: 'square' as OscillatorType, bright: 2600, send: 0.18, gain: 0.05 };
    if (section === 'stage-2') return { type: 'sawtooth' as OscillatorType, bright: 4800, send: 0.22, gain: 0.047 };
    if (section === 'interlock') return { type: 'sawtooth' as OscillatorType, bright: 3100, send: 0.5, gain: 0.041 };
    return { type: 'sine' as OscillatorType, bright: 5200, send: 0.72, gain: 0.026 };
  }

  function liveSectionTimbres(time: number) {
    const position = score.arrangementPositionAt(time);
    return score.sectionLayers(score.sectionMixAt(position)).map(([section, weight]) => ({
      ...timbreForSection(section),
      weight,
    }));
  }

  bus.on('runstart', () => {
    interlockIds.clear();
    interlockKills = 0;
    shotOutcomePlayed = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
  });
  bus.on('beat', ({ beatNumber, audioTime }) => {
    if (trace || runtime.mode() !== 'run' || shotOutcomePlayed || beatNumber !== SHOT_BEAT) return;
    shotOutcomePlayed = true;
    const context = runtime.context();
    playShotOutcome(context ? Math.max(audioTime, context.currentTime + 0.002) : audioTime, interlockKills >= 6);
  });
  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    for (const timbre of liveSectionTimbres(time)) {
      inst.action(time, lead[Math.min(lockCount - 1, lead.length - 1)], timbre.type, (timbre.gain + lockCount * 0.007) * timbre.weight, timbre.bright + lockCount * 260, lockCount === 6 ? 0.42 : 0.13, timbre.send);
    }
    if (lockCount === 6) {
      inst.action(time, lead[lead.length - 1] + 12, 'sine', 0.13, 7200, 0.7, 0.55);
      inst.bass(time, 28, 0.13, 420, 0.55);
    }
  });
  bus.on('unlock', () => {
    const context = runtime.context();
    if (context) inst.action(context.currentTime, 88, 'sine', 0.026, 6200, 0.08, 0.15);
  });
  bus.on('fire', ({ volleySize, indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime) + (indexInVolley ?? 0) * 0.014;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const timbre of liveSectionTimbres(time)) {
      inst.action(time, chord.bass + 31 + volleySize, timbre.type, (0.07 + volleySize * 0.012) * timbre.weight, timbre.bright + 1200, 0.14, timbre.send * 0.6);
    }
  });
  bus.on('hit', ({ lethal, stageCompleted }) => {
    const context = runtime.context();
    if (!context || lethal) return;
    const time = score.quantizePlayerAction(context.currentTime);
    inst.action(time, stageCompleted ? 76 : 71, 'triangle', stageCompleted ? 0.085 : 0.035, stageCompleted ? 4400 : 2500, stageCompleted ? 0.34 : 0.1, 0.34);
  });
  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    for (const timbre of liveSectionTimbres(kill.time)) {
      inst.action(kill.time, kill.midi, timbre.type, timbre.gain * 2.4 * timbre.weight, timbre.bright + 1100, 0.34, timbre.send);
    }
    if (interlockIds.delete(enemyId)) {
      interlockKills += 1;
      const start = score.quantizePlayerAction(context.currentTime);
      for (let note = 0; note < interlockKills; note += 1) {
        inst.action(start + note * SIXTEENTH, 64 + note * 2 + interlockKills, 'sawtooth', 0.035 + interlockKills * 0.012, 2600 + interlockKills * 520, 0.22, 0.5);
      }
      inst.action(start, 48 - interlockKills * 2, 'square', 0.045 + interlockKills * 0.007, 980 - interlockKills * 75, 0.34, 0.08);
      inst.breaker(start, 0.07 + interlockKills * 0.018, 0.28 + interlockKills * 0.035);
      if (interlockKills === 6) {
        runtime.mix()?.duckAt(start, 0.12, MASS_DRIVER_DETAILED_M7HQ_TIME.beatSeconds);
        const cadence = start + MASS_DRIVER_DETAILED_M7HQ_TIME.beatSeconds;
        inst.kick(cadence, 1.18);
        for (const midi of [76, 80, 83]) inst.action(cadence, midi, 'sine', 0.08, 7200, 0.62, 0.62);
        for (const midi of [88, 83, 79, 76, 71, 64]) inst.action(cadence + SIXTEENTH * 2 + (88 - midi) * 0.012, midi, 'sine', 0.09, 7200, 0.5, 0.62);
      }
    }
  });
  bus.on('volley', ({ size, kills }) => {
    const context = runtime.context();
    if (!context || size !== 6 || kills !== 6) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const offset of [36, 40, 43]) inst.action(time, chord.bass + offset, 'sine', 0.055, 6200, 0.55, 0.48);
  });
  bus.on('miss', () => {
    const context = runtime.context();
    if (context) inst.action(context.currentTime, 38, 'triangle', 0.018, 700, 0.18, 0.06);
  });
  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    inst.breaker(context.currentTime, 0.17, 0.35);
    inst.action(context.currentTime, 40, 'square', 0.075, 520, 0.32, 0.03);
    inst.action(context.currentTime + 0.045, 41, 'square', 0.055, 440, 0.28, 0.02);
  });
  bus.on('playerhit', () => {
    const context = runtime.context();
    if (!context) return;
    inst.breaker(context.currentTime, 0.3, 0.95);
    inst.action(context.currentTime, 28, 'sawtooth', 0.17, 480, 0.82, 0.2);
    inst.action(context.currentTime + 0.08, 76, 'square', 0.07, 2300, 0.28, 0.28);
    inst.action(context.currentTime + 0.2, 75, 'square', 0.06, 1900, 0.32, 0.28);
  });

  return runtime;
}
