import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep, type MixBus } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createMassDriverVoices } from './audio-voices';
import {
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  MASS_DRIVER_TIME,
  type MassDriverSection,
} from './timing';

type Chord = { bass: number; pad: readonly number[]; arp: readonly number[]; acid: readonly number[] };

const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const CHORDS: readonly Chord[] = [
  { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], acid: [40, 43, 47, 50] }, // Em
  { bass: 28, pad: [52, 59, 64, 67], arp: [71, 67, 64, 76], acid: [40, 47, 43, 52] }, // Em
  { bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72], acid: [36, 40, 43, 48] }, // C
  { bass: 38, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74], acid: [38, 42, 45, 50] }, // D
];
const BOSS_CHORDS: readonly Chord[] = [
  CHORDS[0],
  { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], acid: [41, 45, 48, 53] }, // F
  CHORDS[1],
  { bass: 29, pad: [53, 60, 65, 69], arp: [72, 69, 65, 77], acid: [41, 48, 45, 53] },
];
const KILL_LANES: Record<MassDriverSection, readonly number[]> = {
  injection: [0, 1, 2, 3, 2, 1, 3, 4, 5, 3, 2, 4, 6, 5, 3, 1],
  stage1: [0, 2, 4, 1, 3, 5, 2, 6, 3, 7, 5, 4, 6, 2, 3, 1],
  stage2: [7, 4, 6, 3, 5, 2, 4, 1, 3, 5, 6, 4, 7, 5, 3, 2],
  interlock: [0, 2, 4, 6, 1, 3, 5, 7, 2, 4, 6, 7, 6, 5, 4, 3],
  muzzle: [0, 4, 2, 6, 1, 5, 3, 7],
};

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverDetailedAudio = createAudioTraceHarness({
  level: 'mass-driver-detailed-7k2p',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_DURATION,
  createAudio: createMassDriverAudio,
});

type HumRig = { oscillators: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode };

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, MassDriverSection>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: MASS_DRIVER_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: 20, toBar: 28, chords: BOSS_CHORDS, barsPerChord: 2 }],
    sections: MASS_DRIVER_SCORE_SECTIONS,
    leadSet: (chord) => [...chord.arp, ...chord.arp.map((midi) => midi + 12)],
    killLanes: KILL_LANES,
  });
  let hum: HumRig | null = null;
  let shotScheduled = false;
  let interlockKills = 0;
  const interlockIds = new Set<number>();

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: MASS_DRIVER_BPM,
    stepSeconds: SIXTEENTH,
    stepsPerBar: MASS_DRIVER_STEPS_PER_BAR,
    scheduleAhead: 0.18,
    schedulerMs: 25,
    startDelay: 0,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.78,
    mix: {
      musicVolume: 0.82,
      sfxVolume: 0.84,
      compressor: { threshold: -18, ratio: 5.5, attack: 0.004, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 3000, sendGain: 0.34 },
      reverb: { seconds: 3.0, decay: 3.4, level: 0.18 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) arrangement.recordSectionStart(time, bar);
    },
    onPostBuild(context, mix) {
      hum = installHum(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      shotScheduled = false;
      interlockKills = 0;
      interlockIds.clear();
      const context = runtime.context();
      if (!context || !hum) return;
      const now = context.currentTime + 0.02;
      const shot = now + MASS_DRIVER_MARKERS.shot;
      hum.gain.gain.cancelScheduledValues(now);
      hum.gain.gain.setValueAtTime(Math.max(0.001, hum.gain.gain.value), now);
      hum.gain.gain.exponentialRampToValueAtTime(0.075, now + 0.7);
      hum.gain.gain.linearRampToValueAtTime(0.16, shot - 0.35);
      hum.gain.gain.exponentialRampToValueAtTime(0.001, shot + 0.035);
      hum.filter.frequency.cancelScheduledValues(now);
      hum.filter.frequency.setValueAtTime(160, now);
      hum.filter.frequency.exponentialRampToValueAtTime(3200, shot);
      const targets = [148, 151, 74];
      hum.oscillators.forEach((oscillator, index) => {
        oscillator.frequency.cancelScheduledValues(now);
        oscillator.frequency.setValueAtTime(index === 2 ? 36.7 : 36.7 * (index === 1 ? 1.008 : 1), now);
        oscillator.frequency.exponentialRampToValueAtTime(targets[index], shot);
      });
      trace?.record(now, 'rising-hum', { fromHz: 36.7, toHz: 151, seconds: MASS_DRIVER_MARKERS.shot, cut: 'hard' });
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context || !hum) return;
      const now = context.currentTime;
      hum.gain.gain.cancelAndHoldAtTime(now);
      hum.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      hum.gain.gain.exponentialRampToValueAtTime(0.028, now + 0.65);
      hum.filter.frequency.cancelAndHoldAtTime(now);
      hum.filter.frequency.exponentialRampToValueAtTime(150, now + 0.7);
      hum.oscillators.forEach((oscillator, index) => {
        oscillator.frequency.cancelAndHoldAtTime(now);
        oscillator.frequency.exponentialRampToValueAtTime(index === 2 ? 37 : 37 * (index === 1 ? 1.008 : 1), now + 0.7);
      });
    },
    onDispose() {
      hum = null;
    },
  });

  const inst = createMassDriverVoices({ trace, context: runtime.context, mix: runtime.mix });

  const track = fn<Chord>(({ time, step, bar, chord }) => {
    if (bar < 4) {
      if (step === 0 || (bar >= 2 && step === 10)) inst.kick(time, step === 0 ? 0.78 : 0.25);
      if (step % 4 === 0) inst.synth(time, chord.arp[(bar + step / 4) % chord.arp.length], 'triangle', 0.16, 2400, 0.035 + bar * 0.008, false);
      if (bar >= 1 && step % 8 === 6) inst.noise(time, 0.015, 0.03, 6500, true);
      if (bar === 3 && step >= 8) inst.noise(time, 0.012 + (step - 8) * 0.006, 0.09, 1600 + step * 260, false);
      return;
    }
    if (bar < 12) {
      if (step % 4 === 0) inst.kick(time, step === 0 ? 1 : 0.86);
      if (step % 4 === 2) inst.noise(time, 0.04, 0.045, 6400, true);
      if (step % 2 === 0) inst.synth(time, chord.bass + (step % 8 === 6 ? 7 : 0), 'square', 0.16, 850, 0.07, false);
      if (step % 8 === 3) inst.synth(time, chord.arp[(bar + step) % chord.arp.length], 'triangle', 0.14, 2700, 0.035, false);
      if (step === 0 && bar % 2 === 0) inst.pad(time, chord.pad, SIXTEENTH * 32, 0.14, false);
      return;
    }
    if (bar < 20) {
      if (step % 4 === 0) inst.kick(time, step === 0 ? 1 : 0.9);
      if (step === 4 || step === 12) inst.noise(time, 0.085, 0.12, 1800, false);
      if (step % 2 === 1) inst.noise(time, step % 4 === 3 ? 0.052 : 0.028, step % 4 === 3 ? 0.075 : 0.025, step % 4 === 3 ? 4800 : 7600, true);
      if (step % 2 === 0) inst.synth(time, chord.bass + (step % 8 === 4 ? 12 : step % 8 === 6 ? 7 : 0), 'square', 0.13, 1200, 0.075, false);
      if (step % 2 === 0) inst.acid(time, chord.acid[(bar + step / 2) % chord.acid.length] + 12, 0.035, 1100 + ((bar * 13 + step * 7) % 2200));
      if (step % 4 === 1) inst.synth(time, chord.arp[(bar + step) % chord.arp.length] + 12, 'sawtooth', 0.1, 3900, 0.028, false);
      return;
    }
    if (bar < 28) {
      if (step % 4 === 0 || step === 11 || (bar >= 26 && step === 14)) inst.kick(time, step === 0 ? 1 : 0.72);
      if (step === 4 || step === 12) inst.noise(time, 0.09, 0.13, 1500, false);
      if (step % 2 === 1) inst.noise(time, 0.034 + (bar - 20) * 0.003, 0.035, 7200, true);
      if (step % 2 === 0) inst.synth(time, chord.bass + (step % 8 === 4 ? 12 : 0), 'sawtooth', 0.15, 1300 + (bar - 20) * 160, 0.07, false);
      if (step === 0 && bar % 2 === 0) {
        inst.arc(time, 0.07, 1.1, 740, 1600 + (bar - 20) * 190);
        inst.synth(time, bar % 4 === 0 ? 41 : 42, 'square', 0.75, 1100, 0.055, false);
      }
      // A bar-by-bar riser and final full-grid snare roll.
      if (step >= 12) inst.noise(time, 0.018 + (bar - 20) * 0.006 + (step - 12) * 0.006, 0.1, 1800 + step * 230, false);
      if (bar === 27) inst.noise(time, 0.04 + step * 0.008, 0.075, 1000 + step * 180, false);
      return;
    }
    // Muzzle: the hard-cut downbeat blooms E major, then leaves only glass
    // delays and a subsiding sub pulse.
    if (bar === 28 && step === 0) {
      inst.kick(time, 1.25);
      if (interlockIds.size === 0) {
        inst.noise(time, 0.25, 1.6, 4100, true);
        inst.pad(time, [52, 56, 59, 64, 68], SIXTEENTH * 62, 0.72, true);
        inst.synth(time, 28, 'sine', 1.8, 260, 0.16, false);
      } else {
        inst.noise(time, 0.32, SIXTEENTH * 30, 420, false);
        inst.synth(time, 16, 'sawtooth', SIXTEENTH * 28, 180, 0.24, false);
      }
    }
    if ((bar === 29 || bar === 30) && step % 8 === 3) inst.synth(time, [76, 80, 83, 88][(bar + step) % 4], 'sine', 0.8, 6200, bar === 29 ? 0.025 : 0.014, false);
  });

  const arrangement = createArrangement<Chord>({
    stepsPerBar: MASS_DRIVER_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'INJECTION', fromBar: 0, toBar: 4, tracks: [track] },
      { name: 'STAGE 1', fromBar: 4, toBar: 12, tracks: [track] },
      { name: 'STAGE 2', fromBar: 12, toBar: 20, tracks: [track] },
      { name: 'INTERLOCK', fromBar: 20, toBar: 28, tracks: [track] },
      { name: 'THE SHOT / MUZZLE', fromBar: 28, toBar: 32, tracks: [track] },
    ],
  });

  function scheduleStep({ position, time, mode, step, bar }: BeatLevelAudioStep) {
    if (mode === 'run') {
      if (!shotScheduled && bar === 28 && step === 0) {
        shotScheduled = true;
        if (hum) {
          hum.gain.gain.cancelAndHoldAtTime(time);
          hum.gain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
        }
        runtime.mix()?.duckAt(time, 0.8, 0.7);
        trace?.record(time, 'THE SHOT', { bar: 28, hum: 'cut', outcome: interlockIds.size === 0 ? 'E major release' : 'detonation rumble' });
      }
      arrangement.schedule(position, time);
    } else {
      const chord = CHORDS[bar % CHORDS.length];
      if (step % 4 === 0) inst.synth(time, chord.arp[(step / 4) % chord.arp.length], 'triangle', 0.22, 1800, 0.022, false);
      if (step === 0 && bar % 2 === 0) inst.pad(time, chord.pad, SIXTEENTH * 32, 0.08, false);
    }
  }

  const playerVoice = (section: MassDriverSection) => {
    if (section === 'injection') return { type: 'triangle' as OscillatorType, cutoff: 3600, decay: 0.22, gain: 0.065 };
    if (section === 'stage1') return { type: 'square' as OscillatorType, cutoff: 2600, decay: 0.14, gain: 0.055 };
    if (section === 'stage2') return { type: 'sawtooth' as OscillatorType, cutoff: 4800, decay: 0.18, gain: 0.048 };
    if (section === 'interlock') return { type: 'sawtooth' as OscillatorType, cutoff: 2300, decay: 0.34, gain: 0.058 };
    return { type: 'sine' as OscillatorType, cutoff: 5600, decay: 0.65, gain: 0.032 };
  };
  const actionPosition = (time: number) => score.arrangementPositionAt(time);

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
  });
  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = actionPosition(time);
    const lead = score.leadSetAt(position);
    const voice = playerVoice(score.sectionMixAt(position).to);
    inst.synth(time, lead[Math.min(lead.length - 1, lockCount - 1)] + (lockCount === 6 ? 12 : 0), voice.type, voice.decay, voice.cutoff + lockCount * 180, voice.gain + lockCount * 0.006, true);
    if (lockCount === 6) {
      inst.synth(time, 28, 'sine', 0.5, 260, 0.13, true);
      runtime.mix()?.duckAt(time, 0.35, 0.28);
    }
  });
  bus.on('unlock', () => {
    const context = runtime.context();
    if (context) inst.synth(context.currentTime, 84, 'sine', 0.08, 5200, 0.025, true);
  });
  bus.on('fire', ({ volleySize, indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime) + (indexInVolley ?? 0) * 0.012;
    const position = actionPosition(time);
    const chord = score.chordAt(position);
    const voice = playerVoice(score.sectionMixAt(position).to);
    inst.synth(time, chord.bass + 36 + volleySize - (indexInVolley ?? 0), voice.type, 0.13, voice.cutoff, voice.gain + 0.02, true);
    if ((indexInVolley ?? 0) === 0) inst.arc(time, 0.055 + volleySize * 0.01, 0.16, 5200, 900);
  });
  bus.on('hit', ({ lethal, stageCompleted }) => {
    const context = runtime.context();
    if (!context || lethal) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(actionPosition(time));
    inst.synth(time, chord.arp[stageCompleted ? 2 : 0], 'triangle', 0.11, 3300, 0.045, true);
    if (stageCompleted) inst.arc(time, 0.055, 0.22, 4800, 1300);
  });
  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    const position = actionPosition(kill.time);
    const voice = playerVoice(score.sectionMixAt(position).to);
    inst.synth(kill.time, kill.midi, voice.type, voice.decay * 1.5, voice.cutoff + 1200, voice.gain * 1.9, true);
    if (interlockIds.delete(enemyId)) {
      interlockKills += 1;
      for (let note = 0; note <= interlockKills; note += 1) {
        inst.synth(kill.time + note * SIXTEENTH * 0.5, 64 + note * 2 + interlockKills, 'sawtooth', 0.22, 2600 + interlockKills * 420, 0.045 + note * 0.006, true);
      }
      inst.arc(kill.time, 0.09 + interlockKills * 0.012, 0.32, 3100, 180 - interlockKills * 12);
      inst.synth(kill.time, 40 - interlockKills, 'square', 0.38, 540, 0.075, true);
      if (interlockKills === 6) {
        runtime.mix()?.duckAt(kill.time, 0.75, SIXTEENTH * 1.1);
        inst.kick(kill.time + SIXTEENTH, 1.15);
        inst.pad(kill.time + SIXTEENTH, [64, 67, 71, 76], SIXTEENTH * 5, 0.36, false);
        [76, 71, 67, 64].forEach((midi, index) => inst.synth(kill.time + SIXTEENTH * (1.5 + index * 0.5), midi, 'sine', 0.3, 5200, 0.075, true));
      }
    } else if ((indexInVolley ?? 0) > 0) {
      inst.arc(kill.time, 0.035, 0.12, 4300, 1600);
    }
  });
  bus.on('volley', ({ size, kills }) => {
    const context = runtime.context();
    if (!context || size !== 6 || kills !== 6) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(actionPosition(time));
    inst.pad(time, chord.pad.map((midi) => midi + 12), SIXTEENTH * 3, 0.28, false);
    runtime.mix()?.duckAt(time, 0.44, 0.32);
  });
  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime;
    inst.synth(time, 29, 'square', 0.38, 430, 0.12, true);
    inst.synth(time + 0.035, 28, 'square', 0.48, 330, 0.11, true);
    inst.arc(time, 0.08, 0.2, 700, 120);
  });
  bus.on('playerhit', () => {
    const context = runtime.context();
    if (!context) return;
    inst.synth(context.currentTime, 28, 'sawtooth', 0.8, 360, 0.17, true);
    inst.synth(context.currentTime + 0.08, 64, 'square', 0.18, 2200, 0.065, true);
    inst.synth(context.currentTime + 0.2, 61, 'square', 0.28, 1800, 0.055, true);
  });
  bus.on('miss', () => {
    const context = runtime.context();
    if (context) inst.synth(context.currentTime, 83, 'sine', 0.09, 6200, 0.014, true);
  });

  return runtime;
}

function installHum(context: AudioContext, mix: MixBus): HumRig {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 150;
  filter.Q.value = 7.5;
  const gain = context.createGain();
  gain.gain.value = 0.028;
  const oscillatorA = context.createOscillator();
  const oscillatorB = context.createOscillator();
  const sub = context.createOscillator();
  oscillatorA.type = 'sawtooth';
  oscillatorB.type = 'sawtooth';
  sub.type = 'sine';
  oscillatorA.frequency.value = 37;
  oscillatorB.frequency.value = 37.3;
  sub.frequency.value = 37;
  const detuneGain = context.createGain();
  detuneGain.gain.value = 0.34;
  const subGain = context.createGain();
  subGain.gain.value = 0.7;
  oscillatorA.connect(filter);
  oscillatorB.connect(detuneGain).connect(filter);
  sub.connect(subGain).connect(filter);
  filter.connect(gain).connect(mix.music);
  oscillatorA.start();
  oscillatorB.start();
  sub.start();
  return { oscillators: [oscillatorA, oscillatorB, sub], filter, gain };
}
