import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import {
  createBeatLevelAudio,
  defineInstruments,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import {
  VESPERS_R7AX_BPM,
  VESPERS_R7AX_RUN_DURATION,
  VESPERS_R7AX_RUN_SECTIONS,
  VESPERS_R7AX_SCORE_SECTIONS,
  VESPERS_R7AX_STEPS_PER_BAR,
  VESPERS_R7AX_TIME,
  type VespersR7axSectionName,
} from './timing';

// Vespers is written as an organ score rather than a loop with organ timbres:
// pedal, cantus, alto, and tenor enter separately in imitation. The mixture
// rank is withheld until the final two bars, where the harmony turns from
// D minor to D major. There is intentionally no percussion track.

const SIXTEENTH = VESPERS_R7AX_TIME.stepSeconds;
const STEPS_PER_BAR = VESPERS_R7AX_STEPS_PER_BAR;

type VespersChord = {
  bass: number;
  organ: readonly number[];
  lead: readonly number[];
};

const D_MINOR_LEAD = [62, 65, 67, 69, 72, 74, 77, 81] as const;
const A_DOMINANT_LEAD = [61, 64, 69, 73, 76, 81, 85, 88] as const;
const D_MAJOR_LEAD = [62, 66, 69, 74, 78, 81, 86, 90] as const;

const MINOR_CHORDS: readonly VespersChord[] = [
  { bass: 38, organ: [50, 57, 62, 65], lead: D_MINOR_LEAD }, // Dm
  { bass: 34, organ: [46, 53, 58, 62], lead: D_MINOR_LEAD }, // Bb
  { bass: 31, organ: [43, 50, 55, 58], lead: D_MINOR_LEAD }, // Gm
  { bass: 33, organ: [45, 52, 57, 61], lead: A_DOMINANT_LEAD }, // A
];

const MAJOR_CHORDS: readonly VespersChord[] = [
  { bass: 38, organ: [50, 57, 62, 66], lead: D_MAJOR_LEAD },
];

const KILL_LANES: Record<VespersR7axSectionName, readonly number[]> = {
  introit: [
    0, 0, 1, 2, 1, 0, 2, 1,
    0, 2, 3, 2, 1, 2, 0, 1,
    2, 3, 4, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 0, 1, 2, 0,
  ],
  procession: [
    0, 2, 1, 3, 2, 4, 3, 1,
    2, 3, 4, 5, 4, 2, 3, 1,
    0, 3, 2, 4, 3, 5, 4, 2,
    3, 4, 5, 6, 5, 3, 2, 1,
  ],
  counterpoint: [
    0, 4, 2, 5, 1, 4, 3, 6,
    2, 5, 4, 7, 3, 6, 5, 2,
    0, 3, 5, 2, 6, 4, 7, 5,
    3, 6, 4, 2, 5, 3, 1, 0,
  ],
  swell: [
    2, 5, 3, 6, 4, 7, 5, 3,
    4, 6, 5, 7, 6, 4, 5, 2,
    3, 6, 4, 7, 5, 6, 3, 5,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  tenebrae: [
    0, 1, 0, 2, 1, 0, 1, 2,
    0, 2, 1, 3, 2, 1, 0, 1,
    2, 1, 0, 2, 1, 3, 2, 1,
    0, 1, 2, 1, 0, 2, 1, 0,
  ],
  'dead-rose': [
    7, 5, 6, 4, 7, 3, 6, 2,
    5, 1, 4, 0, 3, 5, 2, 6,
    7, 4, 6, 3, 5, 2, 4, 1,
    3, 0, 2, 4, 6, 5, 7, 6,
  ],
  illumination: [
    0, 2, 4, 5, 7, 6, 5, 4,
    2, 4, 5, 7, 6, 4, 5, 2,
    0, 3, 4, 6, 7, 5, 6, 4,
    2, 5, 7, 6, 4, 2, 1, 0,
  ],
};

// The main subject is an eight-note, two-bar arch. Alto enters a fifth lower
// and two beats late; tenor answers in longer values. These are explicit
// melodic lines, not chord-tone arpeggiation.
const SUBJECT = [74, 72, 69, 70, 69, 65, 67, 69] as const;
const COUNTER_SUBJECT = [57, 62, 60, 58, 57, 55, 53, 52] as const;
const TENEBRAE_SOLO = [69, 67, 65, 64, 65, 62, 64, 61] as const;

export function createAudio(bus: EventBus) {
  return createVespersR7axAudio(bus).audio;
}

export const traceVespersR7axAudio = createAudioTraceHarness({
  level: 'vespers-r7ax',
  bpm: VESPERS_R7AX_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: VESPERS_R7AX_RUN_DURATION,
  createAudio: createVespersR7axAudio,
});

function createVespersR7axAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<VespersChord, VespersR7axSectionName>({
    bpm: VESPERS_R7AX_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: MINOR_CHORDS,
    barsPerChord: 2,
    sections: VESPERS_R7AX_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: VESPERS_R7AX_BPM,
    stepsPerBar: STEPS_PER_BAR,
    stepSeconds: SIXTEENTH,
    runAlignment: 'bar',
    beatNumber: 'position',
    scheduleAhead: 0.22,
    schedulerMs: 25,
    volumeScale: 0.76,
    mix: {
      compressor: { threshold: -20, ratio: 4.5, attack: 0.018, release: 0.38 },
      reverb: { seconds: 4.6, decay: 4.2, level: 0.38, returnTo: 'master' },
      delay: {
        maxTime: 1.7,
        time: VESPERS_R7AX_TIME.beatSeconds * 0.75,
        feedback: 0.24,
        dampHz: 2100,
        sendGain: 0.32,
        returnTo: 'master',
      },
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      roseHeartId = -1;
      roseHeartMaxHp = 0;
      roseBroken = false;
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const chord = roseBroken ? MAJOR_CHORDS[0] : MINOR_CHORDS[0];
      inst.choir(context.currentTime + 0.06, chord.organ, 3.8, roseBroken ? 0.14 : 0.055);
    },
  });

  const pedalVoice = voice<{ duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.3 },
      { type: 'triangle', gain: 0.09, octave: 1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 780 },
    envelope: {
      attack: 0.035,
      decay: 0.18,
      sustain: 0.82,
      release: 0.18,
      decayCurve: 'linear',
      releaseCurve: 'linear',
    },
  });

  const principalVoice = voice<{ duration: number; brightness: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.1 },
      { type: 'square', gain: 0.025, octave: 1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: ({ brightness }) => brightness },
    envelope: {
      attack: 0.018,
      decay: 0.1,
      sustain: 0.76,
      release: 0.1,
      decayCurve: 'linear',
      releaseCurve: 'linear',
    },
  });

  const fluteVoice = voice<{ duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.17 },
      { type: 'triangle', gain: 0.055, octave: 1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 2600 },
    envelope: {
      attack: 0.04,
      decay: 0.12,
      sustain: 0.72,
      release: 0.14,
      decayCurve: 'linear',
      releaseCurve: 'linear',
    },
  });

  const reedVoice = voice<{ duration: number; brightness: number }>({
    oscillators: [
      { type: 'square', gain: 0.055 },
      { type: 'sawtooth', gain: 0.04, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.07,
    filter: {
      type: 'bandpass',
      cutoff: ({ brightness }) => brightness,
      Q: 1.35,
    },
    envelope: {
      attack: 0.012,
      decay: 0.09,
      sustain: 0.7,
      release: 0.1,
      decayCurve: 'linear',
      releaseCurve: 'linear',
    },
  });

  const mixtureVoice = voice<{ duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.05 },
      { type: 'square', gain: 0.018, octave: 1 },
      { type: 'sine', gain: 0.035, frequencyRatio: 3 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'highpass', cutoff: 520 },
    envelope: {
      attack: 0.012,
      decay: 0.08,
      sustain: 0.68,
      release: 0.1,
      decayCurve: 'linear',
      releaseCurve: 'linear',
    },
  });

  const playerPluckVoice = voice<{ duration: number; brightness: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.16 },
      { type: 'sine', gain: 0.08, octave: 1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ brightness }) => brightness },
    envelope: { attack: 0.006, decay: ({ duration }) => duration },
  });

  function destinations(kind: 'music' | 'sfx') {
    const mix = runtime.mix();
    if (!mix) return null;
    return {
      output: kind === 'music' ? mix.music : mix.sfx,
      sends: [
        ...(mix.reverbSend ? [{ destination: mix.reverbSend, gain: kind === 'music' ? 0.58 : 0.42 }] : []),
        ...(mix.delaySend && kind === 'sfx' ? [{ destination: mix.delaySend, gain: 0.26 }] : []),
      ],
    };
  }

  const inst = defineInstruments({ trace, context: runtime.context }, {
    pedal(context, time, midi, duration, velocity) {
      const route = destinations('music');
      if (!route) return;
      pedalVoice.play({
        context,
        time,
        midi,
        duration,
        velocity,
        destination: route.output,
        sends: route.sends,
      });
    },
    cantus(context, time, midi, duration, velocity) {
      const route = destinations('music');
      if (!route) return;
      principalVoice.play({
        context,
        time,
        midi,
        duration,
        velocity,
        brightness: 1850,
        destination: route.output,
        sends: route.sends,
      });
    },
    alto(context, time, midi, duration, velocity) {
      const route = destinations('music');
      if (!route) return;
      fluteVoice.play({
        context,
        time,
        midi,
        duration,
        velocity,
        destination: route.output,
        sends: route.sends,
      });
    },
    tenor(context, time, midi, duration, velocity) {
      const route = destinations('music');
      if (!route) return;
      reedVoice.play({
        context,
        time,
        midi,
        duration,
        velocity,
        brightness: 920,
        destination: route.output,
        sends: route.sends,
      });
    },
    mixture(context, time, midi, duration, velocity) {
      const route = destinations('music');
      if (!route) return;
      mixtureVoice.play({
        context,
        time,
        midi,
        duration,
        velocity,
        destination: route.output,
        sends: route.sends,
      });
    },
    choir(context, time, midis, duration, velocity) {
      const route = destinations('music');
      if (!route) return;
      for (const midi of midis as number[]) {
        for (const detune of [-7, 7]) {
          principalVoice.play({
            context,
            time,
            midi,
            detune,
            duration,
            velocity,
            brightness: 1250,
            destination: route.output,
            sends: route.sends,
          });
        }
      }
    },
    bell(context, time, midi, velocity, decay) {
      const route = destinations('music');
      if (!route) return;
      const carrier = context.createOscillator();
      const modulator = context.createOscillator();
      const modulation = context.createGain();
      const gain = context.createGain();
      carrier.type = 'sine';
      modulator.type = 'sine';
      carrier.frequency.value = midiToFreq(midi);
      modulator.frequency.value = midiToFreq(midi + 19);
      modulation.gain.setValueAtTime(150, time);
      modulation.gain.exponentialRampToValueAtTime(0.1, time + decay * 0.72);
      gain.gain.setValueAtTime(velocity, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
      modulator.connect(modulation).connect(carrier.frequency);
      carrier.connect(gain).connect(route.output);
      for (const send of route.sends) {
        const sendGain = context.createGain();
        sendGain.gain.value = send.gain;
        gain.connect(sendGain).connect(send.destination);
      }
      carrier.start(time);
      modulator.start(time);
      carrier.stop(time + decay + 0.06);
      modulator.stop(time + decay + 0.06);
    },
    player(context, time, midi, duration, velocity, brightness) {
      const route = destinations('sfx');
      if (!route) return;
      playerPluckVoice.play({
        context,
        time,
        midi,
        duration,
        velocity,
        brightness,
        destination: route.output,
        sends: route.sends,
      });
    },
  }, {
    pedal: ['midi', 'duration', 'velocity'],
    cantus: ['midi', 'duration', 'velocity'],
    alto: ['midi', 'duration', 'velocity'],
    tenor: ['midi', 'duration', 'velocity'],
    mixture: ['midi', 'duration', 'velocity'],
    choir: ['midis', 'duration', 'velocity'],
    bell: ['midi', 'velocity', 'decay'],
    player: ['midi', 'duration', 'velocity', 'brightness'],
  });

  const beat = VESPERS_R7AX_TIME.beatSeconds;
  const nearBeat = beat * 0.94;

  function playSubject(
    instrument: typeof inst.cantus | typeof inst.alto,
    time: number,
    step: number,
    bar: number,
    transpose: number,
    offsetSteps: number,
    velocity: number,
  ) {
    const absolute = bar * STEPS_PER_BAR + step - offsetSteps;
    if (absolute < 0 || absolute % 4 !== 0) return;
    const index = Math.floor(absolute / 4) % SUBJECT.length;
    const duration = index === SUBJECT.length - 1 ? beat * 1.88 : nearBeat;
    instrument(time, SUBJECT[index] + transpose, duration, velocity);
  }

  function playTenor(time: number, step: number, bar: number, velocity: number) {
    if (step % 8 !== 0) return;
    const index = (bar * 2 + step / 8) % COUNTER_SUBJECT.length;
    inst.tenor(time, COUNTER_SUBJECT[index], beat * 1.88, velocity);
  }

  function pedalTrack(strength: number) {
    return fn<VespersChord>(({ time, step, chord }) => {
      if (step === 0) inst.pedal(time, chord.bass, VESPERS_R7AX_TIME.barSeconds * 0.985, strength);
    });
  }

  const introitTrack = fn<VespersChord>(({ time, step, bar }) => {
    if (bar >= 1) playSubject(inst.cantus, time, step, bar - 1, 0, 0, 0.39);
  });

  const processionTrack = fn<VespersChord>(({ time, step, bar }) => {
    playSubject(inst.cantus, time, step, bar, 0, 0, 0.42);
    playSubject(inst.alto, time, step, bar, -7, 8, 0.36);
  });

  const counterpointTrack = fn<VespersChord>(({ time, step, bar }) => {
    playSubject(inst.cantus, time, step, bar, 0, 0, 0.44);
    playSubject(inst.alto, time, step, bar, -7, 8, 0.36);
    playTenor(time, step, bar, 0.31);
  });

  const swellTrack = fn<VespersChord>(({ time, step, bar, chord }) => {
    playSubject(inst.cantus, time, step, bar, 0, 0, 0.47);
    playSubject(inst.alto, time, step, bar, -7, 8, 0.39);
    playTenor(time, step, bar, 0.35);
    if (step === 0) inst.choir(time, chord.organ, VESPERS_R7AX_TIME.barSeconds * 0.96, 0.055);
    if (step === 0 || step === 12) inst.bell(time, chord.lead[bar % chord.lead.length] + 12, 0.07, 2.4);
  });

  const tenebraeTrack = fn<VespersChord>(({ time, step, bar }) => {
    if (step % 8 !== 0) return;
    const index = ((bar - 14) * 2 + step / 8) % TENEBRAE_SOLO.length;
    inst.alto(time, TENEBRAE_SOLO[index], beat * 1.9, 0.32);
  });

  const roseTrack = fn<VespersChord>(({ time, step, bar, chord }) => {
    playSubject(inst.cantus, time, step, bar, -12, 0, 0.35);
    playTenor(time, step, bar, 0.4);
    if (step === 0) inst.choir(time, chord.organ, VESPERS_R7AX_TIME.barSeconds * 0.96, 0.07);
    if (step === 0 || step === 8) inst.bell(time, chord.lead[(bar + step / 8) % chord.lead.length] + 12, 0.105, 2.8);
  });

  const illuminationTrack = fn<VespersChord>(({ time, step, bar, chord: minorChord }) => {
    // The trace models a successful run. Live gameplay stays in the dark
    // rose registration unless the heart's kill event has actually fired.
    if (!roseBroken && !trace) {
      playSubject(inst.cantus, time, step, bar, -12, 0, 0.35);
      playTenor(time, step, bar, 0.4);
      if (step === 0) inst.choir(time, minorChord.organ, VESPERS_R7AX_TIME.barSeconds * 0.96, 0.07);
      if (step === 0 || step === 8) {
        inst.bell(time, minorChord.lead[(bar + step / 8) % minorChord.lead.length] + 12, 0.105, 2.8);
      }
      return;
    }
    const chord = MAJOR_CHORDS[0];
    playSubject(inst.cantus, time, step, bar, 0, 0, 0.5);
    playSubject(inst.alto, time, step, bar, -7, 8, 0.42);
    playTenor(time, step, bar, 0.39);
    if (step % 4 === 0) {
      const midi = chord.lead[(bar * 4 + step / 4) % chord.lead.length] + 12;
      inst.mixture(time, midi, nearBeat, 0.34);
    }
    if (step === 0) inst.choir(time, chord.organ, VESPERS_R7AX_TIME.barSeconds * 0.98, 0.105);
    if (step === 0 || step === 8) inst.bell(time, chord.lead[step === 0 ? 4 : 7] + 12, 0.13, 3.2);
  });

  const runArrangement = createArrangement<VespersChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'introit', fromBar: 0, toBar: 4, tracks: [pedalTrack(0.52), introitTrack] },
      { name: 'procession', fromBar: 4, toBar: 8, tracks: [pedalTrack(0.54), processionTrack] },
      { name: 'counterpoint', fromBar: 8, toBar: 12, tracks: [pedalTrack(0.57), counterpointTrack] },
      { name: 'swell', fromBar: 12, toBar: 14, tracks: [pedalTrack(0.62), swellTrack] },
      { name: 'tenebrae', fromBar: 14, toBar: 18, tracks: [tenebraeTrack] },
      { name: 'dead-rose', fromBar: 18, toBar: 23, tracks: [pedalTrack(0.65), roseTrack] },
      { name: 'illumination', fromBar: 23, toBar: 24, tracks: [pedalTrack(0.68), illuminationTrack] },
    ],
  });

  const ambientArrangement = createArrangement<VespersChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: () => MINOR_CHORDS[0],
    sections: [{
      name: 'night-office',
      fromBar: 0,
      tracks: [fn(({ time, step, bar }) => {
        if (step === 0) inst.pedal(time, 38, VESPERS_R7AX_TIME.barSeconds * 0.98, 0.28);
        if (step === 12 && bar % 2 === 1) inst.bell(time, 74, 0.04, 2.6);
      })],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  let roseHeartId = -1;
  let roseHeartMaxHp = 0;
  let roseBroken = false;

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'rose-heart') roseHeartId = enemyId;
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    inst.player(time, midi + 12, 0.16, 0.23, 3000 + lockCount * 180);
  });

  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.player(time, chord.bass + 24, 0.24, 0.29 + Math.min(6, volleySize) * 0.018, 1450);
  });

  bus.on('kill', ({ indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    inst.player(
      kill.time,
      kill.midi + 12,
      0.5,
      0.36 + Math.min(5, indexInVolley ?? 0) * 0.025,
      3900,
    );
  });

  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    const context = runtime.context();
    if (!context || lethal) return;
    const time = score.nextGridTime(context.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (enemyId === roseHeartId) {
      roseHeartMaxHp = Math.max(roseHeartMaxHp, hitPointsRemaining + 1);
      const intensity = 1 - hitPointsRemaining / Math.max(1, roseHeartMaxHp);
      inst.bell(time, chord.lead[Math.min(chord.lead.length - 1, Math.floor(intensity * chord.lead.length))] + 12, 0.08 + intensity * 0.08, 1.8);
      inst.tenor(time, chord.bass + 12, 0.42, 0.24 + intensity * 0.16);
    } else {
      inst.player(time, chord.lead[2] + 12, 0.22, 0.2, 2500);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    const context = runtime.context();
    if (!context || size < 5 || kills < size) return;
    const time = score.nextGridTime(context.currentTime, 2);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.choir(time, chord.organ.map((midi) => midi + 12), 0.9, 0.075);
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Two stopped pipes a tritone apart: immediate, dry, and unmistakably
    // negative without leaving the level's instrument vocabulary.
    inst.player(time, chord.bass + 12, 0.3, 0.24, 760);
    inst.player(time + 0.025, chord.bass + 18, 0.28, 0.19, 620);
  });

  bus.on('miss', () => {
    const context = runtime.context();
    if (!context) return;
    const chord = score.chordAt(score.arrangementPositionAt(context.currentTime));
    inst.player(context.currentTime, chord.bass - 5, 0.46, 0.14, 520);
  });

  bus.on('bossphase', ({ phase }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, phase === 'destroyed' ? 2 : 1);
    if (phase === 'summoned') {
      inst.bell(time, 50, 0.13, 3.6);
      inst.bell(time + beat, 49, 0.11, 3.2);
    } else if (phase === 'exposed') {
      inst.choir(time, [45, 52, 57, 61], 1.4, 0.09);
      inst.bell(time, 85, 0.14, 2.8);
    } else {
      roseBroken = true;
      score.overrideSection('illumination');
      runtime.mix()?.duckAt(time, 0.18, 1.5);
      const major = MAJOR_CHORDS[0];
      inst.pedal(time, 38, 3.8, 0.72);
      inst.choir(time, major.organ, 3.7, 0.16);
      major.lead.slice(0, 6).forEach((midi, index) => {
        inst.mixture(time + index * SIXTEENTH, midi + 12, 1.2, 0.34);
      });
      [86, 90, 93].forEach((midi, index) => {
        inst.bell(time + index * beat * 0.5, midi, 0.16 - index * 0.018, 3.8);
      });
    }
  });

  return runtime;
}

// Keep section metadata and the trace arrangement sourced from the same
// authored boundaries; this static assertion is deliberately executable in
// development and vanishes into a single comparison in production.
if (VESPERS_R7AX_RUN_SECTIONS.length !== VESPERS_R7AX_SCORE_SECTIONS.length) {
  throw new Error('Vespers audio section metadata is out of sync.');
}
