import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import {
  STRANDLINE_542F_BARS,
  STRANDLINE_542F_BPM,
  STRANDLINE_542F_RUN_DURATION,
  STRANDLINE_542F_SCORE_SECTIONS,
  STRANDLINE_542F_STEPS_PER_BAR,
  STRANDLINE_542F_TIME,
  type Strandline542fSection,
} from './timing';

const STEP = STRANDLINE_542F_TIME.stepSeconds;

type Chord = {
  bass: number;
  pad: readonly number[];
  lead: readonly number[];
  parasite: number;
};

// E dorian slowly opens into G major. The F natural only appears in the parent
// voice, so the parasite reads as contamination instead of a second song.
const CHORDS: readonly Chord[] = [
  { bass: 40, pad: [52, 59, 64, 66], lead: [64, 66, 67, 71, 74, 76, 78, 83], parasite: 41 },
  { bass: 43, pad: [55, 62, 67, 71], lead: [62, 67, 69, 71, 74, 79, 81, 83], parasite: 44 },
  { bass: 38, pad: [50, 57, 62, 66], lead: [62, 64, 66, 69, 74, 76, 78, 81], parasite: 41 },
  { bass: 45, pad: [57, 62, 66, 69], lead: [62, 66, 69, 71, 74, 78, 81, 83], parasite: 44 },
  { bass: 36, pad: [48, 55, 59, 64], lead: [60, 64, 67, 71, 72, 76, 79, 83], parasite: 41 },
  { bass: 43, pad: [55, 59, 62, 67], lead: [62, 67, 71, 74, 79, 81, 83, 86], parasite: 42 },
];

const KILL_LANES: Record<Strandline542fSection, readonly number[]> = {
  hush: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 5, 6, 4, 6, 5, 7],
  sunward: [2, 4, 3, 5, 4, 6, 5, 7, 6, 5, 7, 6, 4, 5, 3, 2],
  pulse: [0, 3, 5, 4, 6, 5, 7, 6, 4, 2, 3, 5, 6, 7, 5, 4],
  crown: [7, 5, 6, 4, 5, 3, 4, 2, 3, 1, 2, 0, 3, 4, 6, 5],
  parent: [1, 0, 2, 1, 3, 2, 4, 3, 2, 1, 3, 4, 5, 3, 6, 7],
  free: [0, 2, 4, 6, 7, 6, 5, 4, 3, 2, 1, 0, 2, 4, 6, 7],
};

export function createAudio(bus: EventBus) {
  return createStrandline542fAudio(bus).audio;
}

export const traceStrandline542fAudio = createAudioTraceHarness({
  level: 'strandline-542f',
  bpm: STRANDLINE_542F_BPM,
  stepSeconds: STEP,
  defaultSeconds: STRANDLINE_542F_RUN_DURATION,
  createAudio: createStrandline542fAudio,
});

function createStrandline542fAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Strandline542fSection>({
    bpm: STRANDLINE_542F_BPM,
    stepsPerBar: STRANDLINE_542F_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: STRANDLINE_542F_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  let parentId = -1;
  let parentMaxHp = 6;
  let parentStage = 0;
  let freed = false;

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    stepSeconds: STEP,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.72,
    mix: {
      compressor: { threshold: -20, ratio: 4.2, attack: 0.008, release: 0.34 },
      delay: { time: STEP * 3, feedback: 0.32, dampHz: 2350 },
      reverb: { seconds: 4.2, decay: 3.3, level: 0.48 },
      noiseSeconds: 2.4,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      parentId = -1;
      parentMaxHp = 6;
      parentStage = 0;
      freed = false;
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const time = context.currentTime + 0.04;
      if (freed) instruments.pad(time, [55, 62, 67, 71, 74], 0.08, 5.4);
      else instruments.parasite(time, 29, 0.22, 1.2);
    },
  });

  const pulseVoice = voice({
    oscillators: [{ type: 'sine' }, { type: 'triangle', detune: 5, gain: 0.22 }],
    duration: 0.9,
    filter: { type: 'lowpass', frequency: 540 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.2, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.88 },
    ],
  });
  const pearlVoice = voice({
    oscillators: [{ type: 'sine' }, { type: 'sine', detune: 9, gain: 0.28 }],
    duration: 0.72,
    filter: { type: 'lowpass', frequency: 4200 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.12, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });
  const strandVoice = voice({
    oscillators: [{ type: 'triangle' }, { type: 'sine', detune: -7, gain: 0.36 }],
    duration: 1.4,
    filter: { type: 'lowpass', frequency: 2700 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.105, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.36 },
    ],
  });
  const parasiteVoice = voice({
    oscillators: [{ type: 'sawtooth' }, { type: 'square', detune: -11, gain: 0.16 }],
    duration: 0.58,
    filter: { type: 'bandpass', frequency: 690, Q: 3.4 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.045, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.56 },
    ],
  });
  const waterHit = noiseHit({ filterType: 'bandpass', frequency: 1350, decay: 0.55 });
  const fizzHit = noiseHit({ filterType: 'highpass', frequency: 4100, decay: 0.08 });

  const instruments = defineInstruments({ trace, context: runtime.context }, {
    pulse(context, time, midi, velocity = 1) {
      const destination = runtime.mix()?.master;
      if (destination) pulseVoice.play({ context, time, midi, velocity, destination });
    },
    pearl(context, time, midi, velocity = 1) {
      const mix = runtime.mix();
      if (!mix?.master) return;
      pearlVoice.play({ context, time, midi, velocity, destination: mix.master });
      if (mix.delaySend && velocity > 0.3) pearlVoice.play({ context, time, midi: midi + 12, velocity: velocity * 0.18, destination: mix.delaySend });
    },
    strand(context, time, midi, velocity = 1) {
      const mix = runtime.mix();
      if (!mix?.master) return;
      strandVoice.play({ context, time, midi, velocity, destination: mix.master });
      if (mix.reverbSend) strandVoice.play({ context, time, midi: midi + 12, velocity: velocity * 0.16, destination: mix.reverbSend });
    },
    parasite(context, time, midi, velocity = 1, duration = 0.58) {
      const destination = runtime.mix()?.master;
      if (!destination) return;
      parasiteVoice.play({ context, time, midi, velocity: velocity * Math.min(1, duration / 0.58), destination });
    },
    water(context, time, velocity, decay = 0.45) {
      const mix = runtime.mix();
      if (!mix?.master || !mix.noiseBuffer) return;
      waterHit.play({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay,
        destination: mix.master,
        offset: (time * 0.37) % 1.7,
      });
    },
    fizz(context, time, velocity) {
      const mix = runtime.mix();
      if (!mix?.master || !mix.noiseBuffer) return;
      fizzHit.play({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        destination: mix.master,
        offset: (time * 0.71) % 1.9,
      });
    },
    pad(context, time, notes: readonly number[], velocity, duration) {
      const mix = runtime.mix();
      if (!mix?.master) return;
      for (const [index, midi] of notes.entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const filter = context.createBiquadFilter();
        oscillator.type = index % 3 === 0 ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(midiToFreq(midi), time);
        oscillator.detune.setValueAtTime((index - notes.length / 2) * 2.2, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200 + midi * 16, time);
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, velocity / Math.sqrt(notes.length)), time + 0.18 + index * 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        oscillator.connect(filter).connect(gain).connect(mix.master);
        if (mix.reverbSend) gain.connect(mix.reverbSend);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.08);
      }
    },
    rise(context, time, root, velocity, duration) {
      const mix = runtime.mix();
      if (!mix?.master) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(midiToFreq(root), time);
      oscillator.frequency.exponentialRampToValueAtTime(midiToFreq(root + 19), time + duration);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, time);
      filter.frequency.exponentialRampToValueAtTime(4600, time + duration);
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.exponentialRampToValueAtTime(velocity, time + duration * 0.65);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      oscillator.connect(filter).connect(gain).connect(mix.master);
      if (mix.reverbSend) gain.connect(mix.reverbSend);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.08);
    },
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STRANDLINE_542F_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'trailing-forest',
        fromBar: 0,
        toBar: STRANDLINE_542F_BARS.moonReveal,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 && bar % 2 === 0) instruments.pad(time, chord.pad, 0.032 + bar * 0.002, STEP * 28);
          if (step === 0) instruments.pulse(time, chord.bass, 0.5 + bar * 0.035);
          if (bar >= 2 && step === 10) instruments.water(time, 0.028 + bar * 0.004, 0.5);
          if (bar >= 4 && (step === 6 || step === 14)) instruments.pearl(time, chord.lead[(bar + step) % chord.lead.length], 0.18);
        })],
      },
      {
        name: 'green-moon',
        fromBar: STRANDLINE_542F_BARS.moonReveal,
        toBar: STRANDLINE_542F_BARS.livingCurrent,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 8) instruments.pulse(time, chord.bass, step === 0 ? 0.72 : 0.43);
          if (step % 4 === 2) instruments.pearl(time, chord.lead[(step / 2 + bar) % chord.lead.length], 0.34);
          if (step === 0 && bar % 2 === 0) instruments.pad(time, chord.pad, 0.06, STEP * 28);
          if (step === 12) instruments.water(time, 0.045, 0.7);
        })],
      },
      {
        name: 'living-current',
        fromBar: STRANDLINE_542F_BARS.livingCurrent,
        toBar: STRANDLINE_542F_BARS.crownApproach,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 8) instruments.pulse(time, chord.bass, 0.72);
          if (step % 4 === 0) instruments.strand(time, chord.lead[(step / 4 + bar) % chord.lead.length], 0.31);
          if (step % 4 === 2) instruments.pearl(time, chord.lead[(step + bar * 2) % chord.lead.length] + 12, 0.17);
          if (step === 0 && bar % 2 === 1) instruments.pad(time, chord.pad, 0.052, STEP * 22);
        })],
      },
      {
        name: 'infested-crown',
        fromBar: STRANDLINE_542F_BARS.crownApproach,
        toBar: STRANDLINE_542F_BARS.parent,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 8) instruments.pulse(time, chord.bass - 12, 0.8);
          if (step === 3 || step === 11) instruments.parasite(time, chord.parasite, 0.45);
          if (step === 6 || step === 14) instruments.pearl(time, chord.lead[(bar + step) % chord.lead.length], 0.23);
          if (step === 0) instruments.water(time, 0.055, 0.62);
        })],
      },
      {
        name: 'parent-web',
        fromBar: STRANDLINE_542F_BARS.parent,
        toBar: STRANDLINE_542F_BARS.release,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (step === 0 || step === 8) instruments.pulse(time, chord.bass - 12, 0.92 + (bar - STRANDLINE_542F_BARS.parent) * 0.035);
          if (step === 2 || step === 6 || step === 10 || step === 14) instruments.parasite(time, chord.parasite + (step % 8 === 2 ? 0 : 5), 0.38 + parentStage * 0.08);
          if (step === 4 || step === 12) instruments.fizz(time, 0.035 + parentStage * 0.012);
          if (step === 0 && bar % 2 === 0) instruments.pad(time, [chord.pad[0], chord.pad[1]], 0.04, STEP * 20);
        })],
      },
      {
        name: 'liberation',
        fromBar: STRANDLINE_542F_BARS.release,
        toBar: STRANDLINE_542F_BARS.end,
        tracks: [fn(({ time, step, bar, chord }) => {
          if (bar === STRANDLINE_542F_BARS.release && step === 0) {
            instruments.pad(time, [55, 62, 67, 71, 74, 79], 0.095, STEP * 31);
            instruments.rise(time, 43, 0.085, STEP * 24);
          }
          if (step === 0) instruments.pulse(time, 43, bar === STRANDLINE_542F_BARS.release ? 0.34 : 0.16);
          if (step === 8) instruments.pearl(time, chord.lead[7], 0.18);
        })],
      },
    ],
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STRANDLINE_542F_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'open-water',
      fromBar: 0,
      tracks: [fn(({ time, step, bar, chord }) => {
        if (step === 0 && bar % 2 === 0) instruments.pad(time, chord.pad.slice(1), 0.022, STEP * 24);
        if (step === 0) instruments.pulse(time, chord.bass, 0.18);
      })],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'run') runArrangement.schedule(position, time);
    else ambientArrangement.schedule(position, time);
  }

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    instruments.pearl(time, lead[Math.min(lead.length - 1, lockCount - 1)], 0.5 + lockCount * 0.035);
  });
  bus.on('unlock', () => {
    const context = runtime.context();
    if (context) instruments.water(context.currentTime, 0.025, 0.22);
  });
  bus.on('fire', ({ volleySize, indexInVolley }) => {
    if ((indexInVolley ?? 0) !== 0) return;
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    instruments.pulse(time, chord.bass + (volleySize >= 6 ? 12 : 0), 0.68 + volleySize * 0.055);
    instruments.water(time, 0.035 + volleySize * 0.009, 0.25 + volleySize * 0.035);
  });
  bus.on('hit', ({ enemyId, hitPointsRemaining, lethal }) => {
    const context = runtime.context();
    if (!context) return;
    if (enemyId === parentId) {
      const damage = 1 - hitPointsRemaining / Math.max(1, parentMaxHp);
      instruments.parasite(context.currentTime, 36 + Math.round(damage * 16), 0.5 + damage * 0.6);
      instruments.fizz(context.currentTime, 0.055 + damage * 0.04);
    } else if (!lethal) instruments.strand(context.currentTime, 62, 0.42);
  });
  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    if (enemyId === parentId) {
      const time = score.quantizePlayerAction(context.currentTime);
      freed = true;
      instruments.water(time, 0.14, 1.1);
      instruments.rise(time + 0.02, 43, 0.14, STEP * 15);
      instruments.pad(time + STEP * 2, [55, 62, 67, 71, 74, 79], 0.1, STEP * 28);
      return;
    }
    const kill = score.nextKill(context.currentTime);
    instruments.strand(kill.time, kill.midi, 0.72);
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'parent') return;
    parentId = enemyId;
    const context = runtime.context();
    if (context) {
      instruments.parasite(context.currentTime, 29, 0.7);
      instruments.water(context.currentTime, 0.1, 0.9);
    }
  });
  bus.on('stage', ({ enemyId, stageIndex, stageHitPoints, hitStageCount }) => {
    if (enemyId !== parentId) return;
    parentStage = stageIndex;
    parentMaxHp = Math.max(parentMaxHp, stageHitPoints * hitStageCount);
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    instruments.water(time, 0.12, 0.65);
    instruments.pad(time, [55 + stageIndex * 2, 62 + stageIndex * 2, 67 + stageIndex * 2], 0.075, STEP * 9);
  });
  bus.on('miss', () => {
    const context = runtime.context();
    if (!context) return;
    instruments.parasite(context.currentTime, 31, 0.22);
    instruments.water(context.currentTime, 0.028, 0.24);
  });
  bus.on('playerhit', () => {
    const context = runtime.context();
    if (!context) return;
    instruments.parasite(context.currentTime, 25, 0.8);
    instruments.water(context.currentTime, 0.17, 0.42);
  });
  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    instruments.fizz(context.currentTime, 0.13);
    instruments.parasite(context.currentTime + 0.015, 30, 0.38);
  });

  return runtime;
}
