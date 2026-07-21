import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep, type MixBus } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { MASS_DRIVER_BPM, MASS_DRIVER_DURATION, MASS_DRIVER_TIME } from './timing';

const STEPS = 16;
const STEP_SECONDS = MASS_DRIVER_TIME.stepSeconds;

type Section = 'injection' | 'stage1' | 'stage2' | 'interlock' | 'muzzle';
type Chord = { root: number; lead: readonly number[]; triad: readonly number[] };
type PlayerCall = { section: Section; dark?: boolean };

const CHORDS: readonly Chord[] = [
  { root: 40, lead: [64, 67, 71, 74, 76, 79, 83, 86], triad: [52, 55, 59] }, // Em
  { root: 40, lead: [64, 67, 71, 74, 76, 79, 83, 86], triad: [52, 55, 59] },
  { root: 36, lead: [60, 64, 67, 71, 72, 76, 79, 83], triad: [48, 52, 55] }, // C
  { root: 38, lead: [62, 66, 69, 74, 76, 78, 81, 86], triad: [50, 54, 57] }, // D
];
const BOSS_CHORDS: readonly Chord[] = [
  { root: 40, lead: [64, 67, 71, 74, 76, 79, 83, 86], triad: [52, 55, 59] },
  { root: 41, lead: [65, 69, 72, 76, 77, 81, 84, 88], triad: [53, 57, 60] },
];

const SECTIONS = [
  { index: 'injection', fromBar: 0 },
  { index: 'stage1', fromBar: 4, crossfadeBars: 1 },
  { index: 'stage2', fromBar: 12, crossfadeBars: 1.5 },
  { index: 'interlock', fromBar: 20 },
  { index: 'muzzle', fromBar: 28 },
] as const;

const KILL_LANES: Record<Section, readonly number[]> = {
  injection: [0, 1, 2, 4, 3, 2, 5, 4, 1, 3, 6, 5, 4, 2, 1, 0],
  stage1: [0, 2, 1, 3, 2, 4, 5, 3, 2, 4, 6, 5, 7, 6, 4, 2],
  stage2: [2, 4, 3, 6, 5, 7, 4, 6, 3, 5, 7, 6, 4, 2, 5, 3],
  interlock: [0, 1, 3, 2, 4, 5, 7, 6, 4, 5, 6, 7, 5, 3, 2, 1],
  muzzle: [7, 6, 5, 4, 3, 2, 1, 0, 4, 3, 2, 1, 0, 2, 4, 7],
};

const kickVoice = voice({
  oscillators: [{ type: 'sine', gain: 1 }, { type: 'triangle', gain: 0.18, octave: 1 }],
  duration: 0.28,
  gainAutomation: (time, gain) => [
    { type: 'set', value: gain, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
  ],
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency * 2.35, time },
    { type: 'exponentialRamp', value: frequency, time: time + 0.075 },
  ],
});

const bassVoice = voice({
  oscillators: [{ type: 'sawtooth', gain: 0.24 }, { type: 'square', gain: 0.055, octave: -1 }],
  duration: 0.31,
  filter: {
    type: 'lowpass', frequency: 520, Q: 6,
    frequencyAutomation: (time) => [
      { type: 'set', value: 720, time },
      { type: 'exponentialRamp', value: 150, time: time + 0.29 },
    ],
  },
  envelope: { attack: 0.004, decay: 0.29, peak: 0.11 },
});

const acidVoice = voice({
  oscillators: [{ type: 'sawtooth', gain: 0.18 }, { type: 'square', gain: 0.03, detune: 9 }],
  duration: 0.2,
  filter: {
    type: 'lowpass', frequency: 1500, Q: 12,
    frequencyAutomation: (time) => [
      { type: 'set', value: 480, time },
      { type: 'exponentialRamp', value: 2500, time: time + 0.06 },
      { type: 'exponentialRamp', value: 340, time: time + 0.19 },
    ],
  },
  envelope: { attack: 0.003, decay: 0.18, peak: 0.072 },
});

const arpVoice = voice({
  oscillators: [{ type: 'square', gain: 0.12 }, { type: 'sine', gain: 0.22, octave: 1 }],
  duration: 0.18,
  filter: { type: 'bandpass', frequency: 2400, Q: 2.4 },
  envelope: { attack: 0.003, decay: 0.17, peak: 0.07 },
});

const padVoice = voice({
  oscillators: [
    { type: 'sawtooth', gain: 0.06, detune: -8 },
    { type: 'sawtooth', gain: 0.055, detune: 8 },
    { type: 'sine', gain: 0.12 },
  ],
  duration: 2.1,
  filter: { type: 'lowpass', frequency: 780, Q: 1.2 },
  envelope: { attack: 0.22, decay: 0.6, sustain: 0.55, release: 0.65, peak: 0.08 },
});

const klaxonVoice = voice({
  oscillators: [{ type: 'sawtooth', gain: 0.19 }, { type: 'square', gain: 0.055, detune: -11 }],
  duration: 0.72,
  filter: { type: 'lowpass', frequency: 930, Q: 4 },
  gainAutomation: (time, gain) => [
    { type: 'set', value: 0.001, time },
    { type: 'linearRamp', value: gain, time: time + 0.045 },
    { type: 'set', value: gain, time: time + 0.48 },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.72 },
  ],
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency, time },
    { type: 'linearRamp', value: frequency * 1.065, time: time + 0.28 },
    { type: 'linearRamp', value: frequency, time: time + 0.6 },
  ],
});

const playerVoice = voice<PlayerCall>({
  oscillators: [
    { type: (call) => call.section === 'injection' ? 'sine' : call.section === 'stage1' ? 'square' : 'sawtooth', gain: (call) => call.section === 'injection' ? 0.34 : call.section === 'stage1' ? 0.16 : call.section === 'interlock' ? 0.1 : 0.12 },
    { type: 'sine', gain: 0.16, octave: 1 },
  ],
  duration: (call) => call.section === 'interlock' ? 0.42 : call.section === 'muzzle' ? 0.7 : 0.25,
  filter: { type: 'bandpass', frequency: (call) => call.dark ? 920 : call.section === 'injection' ? 2700 : 1900, Q: 2 },
  envelope: { attack: 0.003, decay: (call) => call.section === 'muzzle' ? 0.65 : 0.24, peak: 0.1 },
});

const metalVoice = voice({
  oscillators: [
    { type: 'square', gain: 0.13 },
    { type: 'square', gain: 0.08, frequencyRatio: 1.414 },
    { type: 'sawtooth', gain: 0.045, frequencyRatio: 2.17 },
  ],
  duration: 0.31,
  filter: { type: 'bandpass', frequency: 1200, Q: 2.8 },
  envelope: { attack: 0.002, decay: 0.29, peak: 0.1 },
});

const noise = noiseHit({ filterType: 'highpass', frequency: 7200, decay: 0.05 });

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverDetailedUk78Audio = createAudioTraceHarness({
  level: 'mass-driver-detailed-uk78',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: STEP_SECONDS,
  defaultSeconds: MASS_DRIVER_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Section>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: 20, toBar: 28, chords: BOSS_CHORDS, barsPerChord: 2 }],
    sections: SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  let hum: { oscillators: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  const interlockIds = new Set<number>();
  let interlockKills = 0;

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: MASS_DRIVER_BPM,
    stepSeconds: STEP_SECONDS,
    stepsPerBar: STEPS,
    scheduleAhead: 0.15,
    schedulerMs: 24,
    volumeScale: 0.68,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -19, ratio: 5.5, attack: 0.004, release: 0.24 },
      noiseSeconds: 2,
      delay: { maxTime: 1, time: STEP_SECONDS * 3, feedback: 0.27, dampHz: 2400, dampType: 'lowpass', sendGain: 0.26, returnTo: 'master' },
      reverb: { seconds: 1.45, decay: 3.2, level: 0.19, returnTo: 'master' },
    },
    onPostBuild(context, mix) {
      hum = createHum(context, mix);
    },
    onRunStart() {
      const context = runtime.context();
      if (!context || !hum) return;
      const time = context.currentTime;
      hum.gain.gain.cancelScheduledValues(time);
      hum.gain.gain.setValueAtTime(Math.max(0.001, hum.gain.gain.value), time);
      hum.gain.gain.exponentialRampToValueAtTime(0.055, time + 1.2);
      interlockKills = 0;
      interlockIds.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context || !hum) return;
      hum.gain.gain.cancelScheduledValues(context.currentTime);
      hum.gain.gain.setValueAtTime(Math.max(0.001, hum.gain.gain.value), context.currentTime);
      hum.gain.gain.exponentialRampToValueAtTime(0.008, context.currentTime + 0.35);
    },
    onStep: scheduleStep,
    onDispose() {
      if (!hum) return;
      for (const oscillator of hum.oscillators) {
        try { oscillator.stop(); } catch { /* already stopped */ }
      }
      hum = null;
    },
  });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    kick(context, time, velocity = 1) {
      const mix = runtime.mix();
      if (mix?.music) kickVoice.play({ context, time, frequency: 45, velocity: velocity * 0.74, destination: mix.music });
      mix?.duckAt(time, 0.74, 0.18);
    },
    hat(context, time, velocity = 1, open = false) {
      const mix = runtime.mix();
      if (mix?.music && mix.noiseBuffer) noise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * 0.105, decay: open ? 0.16 : 0.035, frequency: open ? 5900 : 8200, destination: mix.music, offset: (time * 0.37) % 1.4 });
    },
    clap(context, time, velocity = 1) {
      const mix = runtime.mix();
      if (!mix?.music || !mix.noiseBuffer) return;
      noise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * 0.16, decay: 0.095, frequency: 1900, filterType: 'bandpass', destination: mix.music, offset: (time * 0.29) % 1.3 });
      noise.play({ context, buffer: mix.noiseBuffer, time: time + 0.018, velocity: velocity * 0.1, decay: 0.07, frequency: 2600, filterType: 'bandpass', destination: mix.music, offset: (time * 0.41) % 1.2 });
    },
    bass(context, time, midi: number, velocity = 1) {
      const mix = runtime.mix();
      if (mix?.music) bassVoice.play({ context, time, midi, velocity, destination: mix.music });
    },
    acid(context, time, midi: number, velocity = 1) {
      const mix = runtime.mix();
      if (mix?.music) acidVoice.play({ context, time, midi, velocity, destination: mix.music, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.12 }] : undefined });
    },
    arp(context, time, midi: number, velocity = 1) {
      const mix = runtime.mix();
      if (mix?.music) arpVoice.play({ context, time, midi, velocity, destination: mix.music, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.28 }] : undefined });
    },
    pad(context, time, midi: number, velocity = 1) {
      const mix = runtime.mix();
      if (mix?.music) padVoice.play({ context, time, midi, velocity, duration: 2.2, destination: mix.music, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.5 }] : undefined });
    },
    klaxon(context, time, midi = 43, velocity = 1) {
      const mix = runtime.mix();
      if (mix?.music) klaxonVoice.play({ context, time, midi, velocity, destination: mix.music, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.18 }] : undefined });
    },
    player(context, time, midi: number, velocity = 1, section: Section = 'stage1', dark = false) {
      const mix = runtime.mix();
      if (mix?.sfx) playerVoice.play({ context, time, midi, velocity, section, dark, destination: mix.sfx, sends: [
        ...(mix.delaySend ? [{ destination: mix.delaySend, gain: section === 'injection' ? 0.34 : 0.18 }] : []),
        ...(mix.reverbSend ? [{ destination: mix.reverbSend, gain: section === 'interlock' || section === 'muzzle' ? 0.42 : 0.12 }] : []),
      ] });
    },
    metal(context, time, midi = 45, velocity = 1) {
      const mix = runtime.mix();
      if (mix?.sfx) metalVoice.play({ context, time, midi, velocity, destination: mix.sfx, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.24 }] : undefined });
    },
    impact(context, time, velocity = 1, frequency = 900, decay = 0.12) {
      const mix = runtime.mix();
      if (mix?.sfx && mix.noiseBuffer) noise.play({ context, buffer: mix.noiseBuffer, time, velocity: velocity * 0.28, decay, frequency, filterType: 'bandpass', destination: mix.sfx, offset: (time * 0.53) % 1.4 });
    },
  });

  function scheduleStep({ time, step, bar, mode, position }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      if (step % 4 === 0) inst.arp(time, [64, 67, 71, 76][step / 4], 0.2);
      if (step === 0 && bar % 2 === 0) inst.pad(time, 40, 0.18);
      setHum(time, 32, 0.008, 190);
      return;
    }
    const chord = score.chordAt(position);
    const isQuarter = step % 4 === 0;

    if (bar < 4) {
      if (step === 0 || (bar >= 2 && step === 10)) inst.kick(time, step === 0 ? 0.72 : 0.28);
      if (step === 2 || step === 8 || step === 14) inst.hat(time, 0.22);
      if (isQuarter) inst.arp(time, chord.lead[(bar * 4 + step / 4) % chord.lead.length], 0.26 + bar * 0.055);
    } else if (bar < 12) {
      if (isQuarter) inst.kick(time, step === 0 ? 1 : 0.72);
      if (step === 2 || step === 6 || step === 10 || step === 14) inst.hat(time, 0.52, step === 14);
      if (step % 2 === 0) inst.bass(time, chord.root + (step === 10 ? 7 : 0), 0.62);
      if (step === 0 && bar % 2 === 0) inst.pad(time, chord.root + 12, 0.24);
      if (step === 3 || step === 11) inst.arp(time, chord.lead[(bar + step) % chord.lead.length], 0.28);
    } else if (bar < 20) {
      if (isQuarter) inst.kick(time, step === 0 ? 1 : 0.76);
      if (step % 2 === 0) inst.hat(time, step % 4 === 2 ? 0.58 : 0.32, step === 14);
      if (step === 4 || step === 12) inst.clap(time, 0.62);
      if (step % 2 === 0) inst.bass(time, chord.root + (step === 6 || step === 14 ? 12 : step === 10 ? 7 : 0), 0.68);
      if (step % 2 === 1) inst.acid(time, chord.lead[(bar * 3 + step) % chord.lead.length] - 12, 0.42 + (step % 4 === 3 ? 0.18 : 0));
      if (step === 3 || step === 11) inst.arp(time, chord.lead[(bar + step) % chord.lead.length] + 12, 0.32);
    } else if (bar < 28) {
      if (isQuarter || step === 14) inst.kick(time, step === 0 ? 1.08 : step === 14 ? 0.46 : 0.78);
      if (step % 2 === 0) inst.hat(time, 0.5 + bar * 0.006, step === 14);
      if (step === 4 || step === 12) inst.clap(time, 0.66);
      if (step % 2 === 0) inst.bass(time, chord.root + (step === 10 ? 7 : 0), 0.76);
      if (bar === 20 && (step === 0 || step === 8) || bar === 21 && (step === 0 || step === 8)) inst.klaxon(time, step === 0 ? 42 : 43, 0.92);
      if (bar >= 22 && bar % 2 === 0 && step === 15) inst.klaxon(time, 45 + (bar - 22), 0.42 + (bar - 22) * 0.05);
      if (bar === 27) {
        inst.impact(time, 0.26 + step * 0.04, 1700 + step * 95, 0.055);
        if (step >= 8) inst.clap(time + STEP_SECONDS * 0.45, 0.25 + step * 0.025);
      }
    } else {
      if (bar === 28 && step === 0) {
        inst.impact(time, 1.4, 120, 0.48);
        inst.pad(time, 40, 0.95);
        inst.pad(time, 44, 0.78);
        inst.pad(time, 47, 0.72);
        runtime.mix()?.duckAt(time, 0.2, 0.8);
      }
      if (bar >= 29 && step === 2 && bar < 32) inst.arp(time, [76, 80, 83][bar - 29], 0.12 * (32 - bar));
    }

    const climb = bar < 16
      ? 32 + bar / 16 * 5
      : bar < 20
        ? 37 + (bar - 16) / 4 * 7
        : 44 + ((bar - 20) / 8) ** 1.65 * 13;
    const humGain = bar < 20 ? 0.052 + bar * 0.0014 : bar < 28 ? 0.08 + (bar - 20) * 0.007 : 0.001;
    const cutoff = 230 + Math.min(1, bar / 28) * 1500;
    setHum(time, climb, humGain, cutoff, bar === 28 && step === 0);
  }

  function setHum(time: number, midi: number, gain: number, cutoff: number, hardCut = false) {
    if (!hum) return;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (const [index, oscillator] of hum.oscillators.entries()) {
      oscillator.frequency.setTargetAtTime(frequency * (index === 2 ? 0.5 : 1), time, hardCut ? 0.004 : 0.12);
    }
    hum.filter.frequency.setTargetAtTime(cutoff, time, 0.14);
    hum.gain.gain.cancelScheduledValues(time);
    if (hardCut) {
      hum.gain.gain.setValueAtTime(Math.max(0.001, hum.gain.gain.value), time);
      hum.gain.gain.exponentialRampToValueAtTime(0.001, time + 0.018);
    } else {
      hum.gain.gain.setTargetAtTime(Math.max(0.001, gain), time, 0.12);
    }
  }

  const musicalPosition = (time: number) => score.arrangementPositionAt(time);
  const currentSection = (time: number) => score.sectionMixAt(musicalPosition(time)).to;
  bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'interlock') interlockIds.add(enemyId); });
  bus.on('runstart', () => { interlockKills = 0; interlockIds.clear(); });
  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context(); if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(musicalPosition(time));
    const section = currentSection(time);
    inst.player(time, lead[Math.min(lead.length - 1, lockCount)], 0.48 + lockCount * 0.075, section, section === 'interlock');
    if (lockCount === 6) { inst.player(time, lead[lead.length - 1] + 12, 0.92, section); inst.impact(time, 0.75, 120, 0.2); }
  });
  bus.on('unlock', () => { const context = runtime.context(); if (context) inst.player(context.currentTime, 88, 0.18, currentSection(context.currentTime)); });
  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context(); if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(musicalPosition(time));
    inst.player(time, chord.root + 31, 0.52 + volleySize * 0.065, currentSection(time), true);
    inst.impact(time, 0.26 + volleySize * 0.07, 1350 - volleySize * 90, 0.09);
  });
  bus.on('hit', ({ lethal, stageCompleted }) => {
    const context = runtime.context(); if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(musicalPosition(time));
    inst.player(time, chord.lead[stageCompleted ? 4 : lethal ? 2 : 1], stageCompleted ? 0.68 : 0.3, currentSection(time));
    inst.impact(time, stageCompleted ? 0.72 : 0.28, stageCompleted ? 520 : 2100, stageCompleted ? 0.22 : 0.06);
  });
  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context(); if (!context) return;
    const kill = score.nextKill(context.currentTime);
    const section = currentSection(kill.time);
    inst.player(kill.time, kill.midi, 0.72, section, section === 'interlock');
    if (interlockIds.delete(enemyId)) {
      interlockKills += 1;
      for (let note = 0; note <= interlockKills; note += 1) inst.player(kill.time + note * STEP_SECONDS * 0.5, 64 + note * 2 + interlockKills, 0.42 + interlockKills * 0.06, 'interlock');
      inst.metal(kill.time, 51 - interlockKills * 2, 0.72);
      if (interlockKills === 6) {
        runtime.mix()?.duckAt(kill.time, 0.16, 0.55);
        inst.impact(kill.time + STEP_SECONDS, 1.1, 190, 0.32);
        [88, 83, 79, 76, 71].forEach((midi, index) => inst.player(kill.time + STEP_SECONDS * (2 + index), midi, 0.82 - index * 0.08, 'interlock'));
      }
    }
  });
  bus.on('volley', ({ size, kills }) => {
    if (size < 6 || kills !== size) return;
    const context = runtime.context(); if (!context) return;
    const time = score.nextGridTime(context.currentTime, 1);
    const chord = score.chordAt(musicalPosition(time));
    runtime.mix()?.duckAt(time, 0.55, 0.28);
    chord.triad.forEach((midi, index) => inst.player(time + index * 0.012, midi + 24, 0.58, currentSection(time)));
  });
  bus.on('reject', () => {
    const context = runtime.context(); if (!context) return;
    const time = context.currentTime;
    inst.metal(time, 28, 0.95);
    inst.player(time + 0.035, 29, 0.34, currentSection(time), true);
    inst.impact(time, 0.82, 210, 0.25);
  });
  bus.on('miss', () => { const context = runtime.context(); if (context) inst.player(context.currentTime, 53, 0.12, currentSection(context.currentTime), true); });
  bus.on('playerhit', () => {
    const context = runtime.context(); if (!context) return;
    const time = context.currentTime;
    runtime.mix()?.duckAt(time, 0.32, 0.6);
    inst.impact(time, 1.1, 95, 0.5);
    inst.klaxon(time, 52, 0.58);
    inst.klaxon(time + 0.18, 45, 0.52);
  });
  bus.on('runend', ({ died }) => {
    if (!died) return;
    const context = runtime.context(); if (!context) return;
    runtime.mix()?.duckAt(context.currentTime, 0.05, 1.4);
    inst.impact(context.currentTime, 1.4, 55, 1.15);
    inst.klaxon(context.currentTime, 28, 0.7);
  });

  return runtime;
}

function createHum(context: AudioContext, mix: MixBus) {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 190;
  filter.Q.value = 2.5;
  const gain = context.createGain();
  gain.gain.value = 0.008;
  filter.connect(gain).connect(mix.music);
  const oscillators: OscillatorNode[] = [];
  for (const [type, detune] of [['sawtooth', -8], ['sawtooth', 8], ['sine', 0]] as const) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = type === 'sine' ? 27.5 : 55;
    oscillator.detune.value = detune;
    const voiceGain = context.createGain();
    voiceGain.gain.value = type === 'sine' ? 0.65 : 0.18;
    oscillator.connect(voiceGain).connect(filter);
    oscillator.start();
    oscillators.push(oscillator);
  }
  return { oscillators, gain, filter };
}
