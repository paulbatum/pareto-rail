import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import {
  MASS_DRIVER_BARS, MASS_DRIVER_BPM, MASS_DRIVER_DURATION, MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_SECTIONS, MASS_DRIVER_STEPS_PER_BAR, MASS_DRIVER_TIME,
} from './timing';

type Section = 0 | 1 | 2 | 3 | 4;
type Chord = { bass: number; tones: readonly number[]; name: string };
const CHORDS: readonly Chord[] = [
  { bass: 28, tones: [52, 55, 59, 64, 67, 71], name: 'Em' },
  { bass: 28, tones: [52, 55, 59, 64, 67, 71], name: 'Em' },
  { bass: 24, tones: [48, 52, 55, 60, 64, 67], name: 'C' },
  { bass: 26, tones: [50, 54, 57, 62, 66, 69], name: 'D' },
];
const BOSS_CHORDS: readonly Chord[] = [
  { bass: 28, tones: [52, 55, 59, 64, 67, 71], name: 'Em' },
  { bass: 29, tones: [53, 57, 60, 65, 69, 72], name: 'F' },
];
const MUZZLE_CHORDS: readonly Chord[] = [
  { bass: 28, tones: [52, 56, 59, 64, 68, 71], name: 'E' },
];
const KILL_LANES: Record<Section, readonly number[]> = {
  0: [0, 1, 2, 1, 3, 2, 1, 0, 2, 3, 4, 2, 1, 3, 2, 0],
  1: [0, 2, 1, 3, 2, 4, 3, 1, 2, 4, 5, 3, 4, 2, 1, 3],
  2: [3, 5, 4, 2, 5, 3, 1, 4, 2, 5, 3, 4, 1, 3, 5, 2],
  3: [0, 1, 3, 2, 4, 3, 5, 4, 2, 5, 4, 3, 5, 2, 1, 0],
  4: [0, 2, 4, 5, 4, 2, 1, 0, 2, 4, 5, 3, 2, 1, 0, 0],
};
const PLAYER_TIMBRES: Record<Section, { wave: OscillatorType; decay: number; bright: number; gain: number; space: number }> = {
  0: { wave: 'sine', decay: 0.18, bright: 3900, gain: 1.0, space: 0.44 },
  1: { wave: 'square', decay: 0.1, bright: 2350, gain: 0.62, space: 0.12 },
  2: { wave: 'sawtooth', decay: 0.14, bright: 3650, gain: 0.54, space: 0.2 },
  3: { wave: 'sawtooth', decay: 0.36, bright: 1750, gain: 0.46, space: 0.56 },
  4: { wave: 'sine', decay: 0.5, bright: 4300, gain: 0.32, space: 0.72 },
};
const STEP = MASS_DRIVER_TIME.stepSeconds;

export function createAudio(bus: EventBus) { return createMassDriverAudio(bus).audio; }
export const traceMassDriverDetailedP8jnAudio = createAudioTraceHarness({ level: 'mass-driver-detailed-p8jn', bpm: MASS_DRIVER_BPM, stepSeconds: STEP, defaultSeconds: MASS_DRIVER_DURATION, createAudio: createMassDriverAudio });

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, Section>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: MASS_DRIVER_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.shot, chords: BOSS_CHORDS, barsPerChord: 1 },
      { fromBar: MASS_DRIVER_BARS.shot, chords: MUZZLE_CHORDS, barsPerChord: 1 },
    ],
    sections: MASS_DRIVER_SCORE_SECTIONS,
    leadSet: (chord) => chord.tones,
    killLanes: KILL_LANES,
  });
  let interlocksClear = false;

  const runtime = createBeatLevelAudio({
    bus, trace, score, stepSeconds: STEP, runAlignment: 'bar', beatNumber: 'absolute', volumeScale: 0.72,
    mix: {
      compressor: { threshold: -21, ratio: 6, attack: 0.004, release: 0.24 },
      delay: { time: STEP * 6, feedback: 0.31, dampHz: 2500 },
      reverb: { seconds: 3.8, decay: 2.6, level: 0.46 },
      noiseSeconds: 3,
    },
    onBeforeBeat({ step, bar, time, mode }) { if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar); },
    onStep: scheduleStep,
    onRunStart() { interlocksClear = false; },
    onRunEnd() {
      const ctx = runtime.context(); if (!ctx) return;
      if (!interlocksClear) { inst.sub(ctx.currentTime, 24, 0.26, 2.6); inst.noise(ctx.currentTime, 0.16, 2.3, 150); }
    },
  });

  const kickVoice = voice<{ velocity: number }>({
    oscillators: [{ type: 'sine' }], duration: 0.22, stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'set', value: 155, time }, { type: 'exponentialRamp', value: 39, time: time + 0.15 }],
    gainAutomation: (time, _gain, { velocity }) => [{ type: 'set', value: velocity * 0.42, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.21 }],
  });
  const bassVoice = voice<{ velocity: number; decay: number }>({
    oscillators: [{ type: 'sawtooth' }, { type: 'square', detune: 5, gain: 0.12 }], duration: ({ decay }) => decay, stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 430, Q: 1.2 },
    gainAutomation: (time, _gain, { velocity, decay }) => [{ type: 'set', value: velocity * 0.19, time }, { type: 'exponentialRamp', value: 0.001, time: time + decay }],
  });
  const humVoice = voice<{ velocity: number; duration: number; cutoff: number }>({
    oscillators: [{ type: 'sine', gain: 0.8 }, { type: 'sawtooth', detune: -7, gain: 0.16 }, { type: 'sawtooth', detune: 7, gain: 0.16 }],
    duration: ({ duration }) => duration, stopPadding: 0.03, filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 1.6 },
    gainAutomation: (time, _gain, { velocity, duration }) => [{ type: 'set', value: 0.001, time }, { type: 'linearRamp', value: velocity, time: time + 0.08 }, { type: 'set', value: velocity, time: time + Math.max(0.1, duration - 0.12) }, { type: 'exponentialRamp', value: 0.001, time: time + duration }],
  });
  const acidVoice = voice<{ velocity: number; decay: number; cutoff: number }>({
    oscillators: [{ type: 'sawtooth' }], duration: ({ decay }) => decay, stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 8 },
    gainAutomation: (time, _gain, { velocity, decay }) => [{ type: 'set', value: velocity * 0.11, time }, { type: 'exponentialRamp', value: 0.001, time: time + decay }],
  });
  const ringVoice = voice<{ velocity: number; decay: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', midiOffset: 12, gain: 0.18 }, { type: 'sine', midiOffset: 19, gain: 0.07 }],
    duration: ({ decay }) => decay, stopPadding: 0.04, filter: { type: 'bandpass', cutoff: 3300, Q: 2.2 },
    frequencyAutomation: (time, frequency) => [{ type: 'set', value: frequency * 1.018, time }, { type: 'exponentialRamp', value: frequency, time: time + 0.045 }],
    gainAutomation: (time, _gain, { velocity, decay }) => [{ type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + decay }],
  });
  const padVoice = voice<{ velocity: number; duration: number }>({
    oscillators: [{ type: 'sine' }, { type: 'triangle', detune: 7, gain: 0.32 }, { type: 'triangle', detune: -7, gain: 0.32 }],
    duration: ({ duration }) => duration, stopPadding: 0.08, filter: { type: 'lowpass', cutoff: 1800 },
    gainAutomation: (time, _gain, { velocity, duration }) => [{ type: 'set', value: 0.001, time }, { type: 'linearRamp', value: velocity, time: time + Math.min(0.55, duration * 0.2) }, { type: 'set', value: velocity * 0.8, time: time + duration * 0.72 }, { type: 'exponentialRamp', value: 0.001, time: time + duration }],
  });
  const playerVoice = voice<{ velocity: number; decay: number; bright: number; wave: OscillatorType }>({
    oscillators: [{ type: ({ wave }) => wave }, { type: 'sine', detune: 1200, gain: 0.14 }], duration: ({ decay }) => decay, stopPadding: 0.04,
    filter: { type: 'bandpass', cutoff: ({ bright }) => bright, Q: 2.8 },
    gainAutomation: (time, _gain, { velocity, decay }) => [{ type: 'set', value: velocity, time }, { type: 'exponentialRamp', value: 0.001, time: time + decay }],
  });
  const klaxonVoice = voice<{ velocity: number; duration: number }>({
    oscillators: [{ type: 'sawtooth', detune: -11 }, { type: 'square', detune: 9, gain: 0.2 }], duration: ({ duration }) => duration, stopPadding: 0.04,
    filter: { type: 'bandpass', cutoff: 520, Q: 3.2 },
    gainAutomation: (time, _gain, { velocity, duration }) => [{ type: 'set', value: 0.001, time }, { type: 'linearRamp', value: velocity, time: time + 0.04 }, { type: 'exponentialRamp', value: 0.001, time: time + duration }],
  });
  const noiseVoice = noiseHit({ filterType: 'bandpass', frequency: 2800, decay: 0.08 });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    kick(context, time, velocity) { const mix = runtime.mix(); if (!mix?.duck) return; kickVoice.play({ context, time, frequency: 120, velocity, destination: mix.duck }); mix.duckAt(time, 0.38, 0.2); },
    bass(context, time, midi, velocity, decay) { const output = runtime.mix()?.duck; if (output) bassVoice.play({ context, time, midi, velocity, decay, destination: output }); },
    hum(context, time, midi, velocity, duration, cutoff) { const output = runtime.mix()?.music; if (output) humVoice.play({ context, time, midi, velocity, duration, cutoff, destination: output }); },
    acid(context, time, midi, velocity, decay, cutoff) { const output = runtime.mix()?.duck; if (output) acidVoice.play({ context, time, midi, velocity, decay, cutoff, destination: output, sends: runtime.mix()?.delaySend ? [{ destination: runtime.mix()!.delaySend!, gain: 0.2 }] : [] }); },
    ring(context, time, midi, velocity, decay) { const mix = runtime.mix(); if (mix?.music) ringVoice.play({ context, time, midi, velocity, decay, destination: mix.music, sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.24 }] : [] }); },
    pad(context, time, midi, velocity, duration) { const mix = runtime.mix(); if (mix?.music) padVoice.play({ context, time, midi, velocity, duration, destination: mix.music, sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.55 }] : [] }); },
    player(context, time, midi, velocity, decay, bright, wave, space) { const mix = runtime.mix(); if (mix?.sfx) playerVoice.play({ context, time, midi, velocity, decay, bright, wave, destination: mix.sfx, sends: [mix.delaySend ? { destination: mix.delaySend, gain: 0.12 + space * 0.25 } : null, mix.reverbSend ? { destination: mix.reverbSend, gain: space } : null].filter((send): send is NonNullable<typeof send> => Boolean(send)) }); },
    klaxon(context, time, midi, velocity, duration) { const output = runtime.mix()?.music; if (output) klaxonVoice.play({ context, time, midi, velocity, duration, destination: output }); },
    noise(context, time, velocity, decay, frequency) { const mix = runtime.mix(); if (mix?.noiseBuffer && mix.music) noiseVoice.play({ context, buffer: mix.noiseBuffer, time, velocity, decay, frequency, destination: mix.music, offset: (time * 0.173) % 1 }); },
    sub(context, time, midi, velocity, duration) { const output = runtime.mix()?.sfx; if (output) humVoice.play({ context, time, midi, velocity, duration, cutoff: 180, destination: output }); },
  }, {
    kick: ['velocity'], bass: ['midi', 'velocity', 'decay'], hum: ['midi', 'velocity', 'duration', 'cutoff'], acid: ['midi', 'velocity', 'decay', 'cutoff'], ring: ['midi', 'velocity', 'decay'],
    pad: ['midi', 'velocity', 'duration'], player: ['midi', 'velocity', 'decay', 'bright', 'wave', 'space'], klaxon: ['midi', 'velocity', 'duration'],
    noise: ['velocity', 'decay', 'frequency'], sub: ['midi', 'velocity', 'duration'],
  });

  const ambientArrangement = createArrangement<Chord>({ stepsPerBar: 16, chordAt: score.chordAt, sections: [{ name: 'idle-spool', fromBar: 0, tracks: [fn(({ time, step, chord }) => {
    if (step === 0) { inst.hum(time, 28, 0.035, MASS_DRIVER_TIME.barSeconds * 0.98, 180); inst.pad(time, chord.tones[0], 0.022, MASS_DRIVER_TIME.barSeconds * 1.8); }
    if (step % 4 === 0) inst.player(time, chord.tones[(step / 4) % chord.tones.length], 0.022, 0.18, 2100, 'sine', 0.5);
  })] }] });

  const runTrack = fn<Chord>(({ time, step, bar, chord }) => {
    const section: Section = bar < 4 ? 0 : bar < 12 ? 1 : bar < 20 ? 2 : bar < 28 ? 3 : 4;
    if (section === 4) {
      if (bar === MASS_DRIVER_BARS.shot && step === 0 && interlocksClear) {
        inst.kick(time, 1.35); inst.noise(time, 0.21, 1.1, 2400); inst.sub(time, 28, 0.2, 1.4);
        for (const midi of [52, 56, 59, 64]) inst.pad(time + 0.03, midi, 0.09, MASS_DRIVER_TIME.barSeconds * 3.6);
      }
      if (interlocksClear && bar >= 29 && step % 8 === 3) inst.player(time, 76 + (bar + step) % 5, 0.018, 0.45, 4200, 'sine', 0.75);
      return;
    }

    // The barrel's tonal motor climbs monotonically and gets brighter every
    // bar. The final pre-shot segment ends on the shot instead of ringing on.
    if (step === 0) {
      const climb = bar < 20 ? bar * 0.6 : 12 + Math.pow((bar - 20) / 8, 1.55) * 12;
      const duration = bar === 27 ? MASS_DRIVER_TIME.barSeconds : MASS_DRIVER_TIME.barSeconds * 1.03;
      inst.hum(time, 28 + climb, 0.04 + bar * 0.0023, duration, 190 + bar * 46 + (section === 3 ? (bar - 20) * 90 : 0));
    }
    // The accelerator itself speaks once per ring. This quiet pitched strike is
    // present even where the kick is sparse, making the distance grid audible.
    if (step % 4 === 0) {
      const beat = step / 4;
      const tone = chord.tones[(bar + beat) % chord.tones.length] + 12;
      inst.ring(time, tone, step === 0 ? 0.047 : 0.031, section >= 3 ? 0.22 : 0.16);
    }
    const kick = section === 0 ? step === 0 || (bar >= 2 && step === 12) : step % 4 === 0 || (section === 3 && (step === 10 || step === 15));
    if (kick) inst.kick(time, step === 0 ? 0.9 : section === 0 ? 0.34 : 0.68);
    if ((section === 1 || section === 2) && step % 2 === 0) inst.bass(time, chord.bass + (section >= 2 && step % 8 === 6 ? 19 : step % 4 === 2 ? 7 : 0), section === 1 ? 0.42 : 0.54, STEP * 1.65);
    if (section === 0 && step % 4 === 0) inst.player(time, chord.tones[Math.min(5, step / 4)] + 12, 0.026 + step * 0.0015, 0.11, 2600, 'sine', 0.42);
    if (bar === 3 && step >= 8) inst.noise(time, 0.012 + (step - 8) * 0.005, 0.055, 1200 + step * 360);
    if ((bar === 4 || bar === 12 || bar === 20) && step === 0) { inst.noise(time, 0.14, 0.28, 720); inst.pad(time + 0.02, chord.tones[0], 0.035, MASS_DRIVER_TIME.barSeconds * 1.5); }
    if ((section === 1 || section === 2) && bar % 2 === 0 && step === 0) {
      for (const midi of chord.tones.slice(0, 3)) inst.pad(time, midi, section === 1 ? 0.018 : 0.014, MASS_DRIVER_TIME.barSeconds * 1.85);
    }
    if (section >= 1 && step % 4 === 2) inst.noise(time, 0.025 + section * 0.008, 0.045, 5600);
    if (section >= 2 && (step === 4 || step === 12)) { inst.noise(time, 0.065, 0.13, 1700); inst.noise(time + 0.012, 0.04, 0.08, 3200); }
    if (section >= 2 && step % 2 === 1) inst.noise(time, step % 4 === 3 ? 0.032 : 0.019, 0.025, step % 4 === 3 ? 7600 : 6100);
    if (section === 2 && step % 2 === 0) inst.acid(time, chord.tones[(bar * 3 + step / 2) % chord.tones.length] + (step % 8 === 6 ? 12 : 0), 0.18, STEP * 1.7, 760 + (step % 8) * 160);
    if (section === 3) {
      const bossBass = bar % 2 === 0 ? 28 : 29; // Em–F Phrygian pressure.
      if (step % 2 === 0) inst.bass(time, bossBass + (step % 8 === 6 ? 12 : 0), 0.57, STEP * 1.5);
      if (bar <= 21 && (step === 0 || step === 8)) inst.klaxon(time, 40 + (step === 8 ? 1 : 0), 0.11, MASS_DRIVER_TIME.beatSeconds * 1.35);
      if (bar % 2 === 0 && step === 14) inst.klaxon(time, 52 + (bar - 20), 0.055 + (bar - 20) * 0.006, MASS_DRIVER_TIME.beatSeconds * 0.7);
      if (step >= Math.max(0, 15 - (bar - 20) * 2)) inst.noise(time, 0.018 + (bar - 20) * 0.006, 0.035, 2800 + bar * 170);
      if (bar === 27 && step >= 4) { inst.noise(time, 0.035 + step * 0.004, 0.045, 900 + step * 260); if (step % 2 === 0) inst.kick(time, 0.42 + step * 0.025); }
    }
  });
  const runArrangement = createArrangement<Chord>({
    stepsPerBar: 16, chordAt: score.chordAt, trace, emitSections: true,
    sections: MASS_DRIVER_SECTIONS.map((section) => ({ name: section.name, fromBar: section.fromBar, toBar: section.toBar, tracks: [runTrack] })),
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) { if (mode === 'ambient') ambientArrangement.schedule(position, time); else runArrangement.schedule(position, time); }
  const action = (lockCount = 1) => {
    const ctx = runtime.context(); if (!ctx) return null;
    const time = score.quantizePlayerAction(ctx.currentTime); const position = score.arrangementPositionAt(time); const chord = score.chordAt(position); const mix = score.sectionMixAt(position);
    return { time, position, chord, mix, section: mix.to as Section, lead: score.leadSetAt(position), midi: score.leadSetAt(position)[Math.min(5, Math.max(0, lockCount - 1))] ?? 64 };
  };
  const layeredPlayer = (time: number, mix: ReturnType<typeof score.sectionMixAt>, midi: number, velocity: number, decayScale = 1, brightLift = 0) => {
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight <= 0.001) continue;
      const timbre = PLAYER_TIMBRES[section];
      inst.player(time, midi, velocity * weight * timbre.gain, timbre.decay * decayScale, timbre.bright + brightLift, timbre.wave, timbre.space);
    }
  };
  const kindById = new Map<number, string>(); let interlockKillCount = 0;
  bus.on('runstart', () => { kindById.clear(); interlockKillCount = 0; interlocksClear = false; });
  bus.on('spawn', ({ enemyId, kind }) => { kindById.set(enemyId, kind); const ctx = runtime.context(); if (!ctx) return; if (kind === 'interlock') { inst.noise(ctx.currentTime, 0.14, 0.4, 410); inst.klaxon(ctx.currentTime + 0.03, 40, 0.12, 0.7); } else if (kind === 'arc') inst.noise(ctx.currentTime, 0.038, 0.07, 5200); });
  bus.on('lock', ({ lockCount }) => { const a = action(lockCount); if (!a) return; layeredPlayer(a.time, a.mix, a.midi + 12, 0.045 + lockCount * 0.009, 0.78, lockCount * 190); if (lockCount === 6) inst.sub(a.time + 0.025, a.chord.bass - 12, 0.09, 0.42); });
  bus.on('unlock', () => { const ctx = runtime.context(); if (ctx) inst.player(ctx.currentTime, 83, 0.018, 0.06, 5200, 'sine', 0.35); });
  bus.on('fire', ({ volleySize }) => { const a = action(volleySize); if (!a) return; layeredPlayer(a.time, a.mix, a.chord.bass + 31, 0.105 + volleySize * 0.01, 1.05, volleySize * 120); inst.noise(a.time, 0.05 + volleySize * 0.007, 0.055, 3900); });
  bus.on('hit', ({ lethal, hitStageIndex }) => { if (lethal) return; const a = action(); if (a) inst.player(a.time, a.chord.bass + 36 + hitStageIndex * 3, 0.052, 0.12, 2300 + hitStageIndex * 520, 'triangle', 0.28); });
  bus.on('stage', ({ stageIndex }) => { const a = action(); if (!a) return; inst.noise(a.time, 0.13, 0.24, 680); inst.player(a.time + 0.02, a.chord.bass + 31 + stageIndex * 5, 0.11, 0.42, 1200, 'sawtooth', 0.52); });
  bus.on('kill', ({ enemyId }) => {
    const kind = kindById.get(enemyId); kindById.delete(enemyId); const ctx = runtime.context(); if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime); const killPosition = score.arrangementPositionAt(kill.time); layeredPlayer(kill.time, score.sectionMixAt(killPosition), kill.midi + 12, 0.15, 1.55, 450); inst.noise(kill.time, 0.07, 0.12, 2100);
    if (kind === 'interlock') { interlockKillCount += 1; const a = action(interlockKillCount); if (!a) return; for (let i = 0; i <= Math.min(5, interlockKillCount); i += 1) inst.player(a.time + i * STEP * 0.34, 52 + i * 2 + interlockKillCount, 0.065 + interlockKillCount * 0.012, 0.28, 1700 + i * 310, 'sawtooth', 0.58); inst.noise(a.time, 0.13, 0.3, Math.max(260, 680 - interlockKillCount * 65)); }
  });
  bus.on('bossphase', ({ phase }) => { if (phase !== 'destroyed') return; interlocksClear = true; const ctx = runtime.context(); if (!ctx) return; runtime.mix()?.duckAt(ctx.currentTime, 0.08, 0.42); inst.kick(ctx.currentTime + STEP, 1.15); for (const midi of [76, 71, 67, 64, 59, 52]) inst.player(ctx.currentTime + STEP + (76 - midi) * 0.011, midi, 0.09, 0.55, 3100, 'sine', 0.7); });
  bus.on('volley', ({ size, kills }) => { if (size === 6 && kills === 6) { const a = action(6); if (a) for (const midi of a.chord.tones.slice(0, 4)) inst.player(a.time, midi + 24, 0.052, 0.55, 4100, 'sawtooth', 0.46); } });
  bus.on('reject', () => { const ctx = runtime.context(); if (!ctx) return; inst.noise(ctx.currentTime, 0.15, 0.18, 190); inst.sub(ctx.currentTime + 0.01, 28, 0.12, 0.35); inst.sub(ctx.currentTime + 0.07, 29, 0.09, 0.3); });
  bus.on('miss', ({ enemyId }) => { kindById.delete(enemyId); const ctx = runtime.context(); if (ctx) inst.player(ctx.currentTime, 52, 0.016, 0.07, 900, 'sine', 0.15); });
  bus.on('playerhit', () => { const ctx = runtime.context(); if (!ctx) return; inst.sub(ctx.currentTime, 28, 0.22, 0.58); inst.klaxon(ctx.currentTime + 0.03, 52, 0.11, 0.35); inst.klaxon(ctx.currentTime + 0.13, 51, 0.09, 0.3); });
  return runtime;
}
