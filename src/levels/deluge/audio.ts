import type { EventBus } from '../../events';
import { getActionSfxQuantization } from '../../engine/action-sfx-quantization';
import {
  createAudioGraphBuilder,
  createLevelAudioKit,
  createStepTransport,
  playBufferSourceVoice,
  playNoiseHit,
  playOscillatorVoice,
} from '../../engine/audio-kit';
import { emitBeatAt, midiToFreq } from '../../engine/music';
import { CANAL_TIME, DELUGE_BPM, DELUGE_DURATION, PHASE2_TIME, STREETFALL_TIME, UNDER_TIME, VULTURE_TIME, OUTRO_TIME } from './gameplay';
import { nearestLightning, TRAIN_PASS_TIME } from './sync';

const SIXTEENTH = 60 / DELUGE_BPM / 4;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = 16;
const SCHEDULE_AHEAD = 0.18;
const SCHEDULER_MS = 25;

type Chord = { root: number; pad: number[]; arp: number[]; bass: number };
const CHORDS: Chord[] = [
  { root: 50, bass: 26, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74] }, // Dm
  { root: 46, bass: 22, pad: [46, 53, 58, 62], arp: [58, 62, 65, 70] }, // Bb
  { root: 48, bass: 24, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72] }, // C
  { root: 45, bass: 21, pad: [45, 52, 57, 60], arp: [57, 60, 64, 69] }, // A
];
const BOSS_CHORDS: Chord[] = [
  { root: 50, bass: 26, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74] },
  { root: 51, bass: 27, pad: [51, 55, 58, 63], arp: [63, 67, 70, 75] },
  { root: 50, bass: 26, pad: [50, 53, 57, 62], arp: [65, 69, 74, 77] },
  { root: 45, bass: 21, pad: [45, 52, 57, 60], arp: [60, 64, 69, 72] },
];

const KILL_LANE = [0, 2, 4, 7, 5, 4, 2, 0, 4, 7, 9, 12, 9, 7, 5, 4, 2, 5, 7, 10, 9, 7, 5, 2, 0, 4, 7, 12, 14, 12, 9, 7];

export function createAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let musicGain: GainNode | null = null;
  let sfxGain: GainNode | null = null;
  let duckGain: GainNode | null = null;
  let delaySend: GainNode | null = null;
  let reverbSend: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let arrangementStart = 0;
  let mode: 'ambient' | 'run' = 'ambient';
  let bossDamage = 0;

  const transport = createStepTransport({
    stepSeconds: SIXTEENTH,
    scheduleAhead: SCHEDULE_AHEAD,
    startDelay: 0.05,
    onStep({ index, time }) { scheduleStep(index, time); },
  });

  const audio = createLevelAudioKit({
    volumeScale: 0.78,
    schedulerMs: SCHEDULER_MS,
    onCreateContext(context, musicVolume, sfxVolume) {
      ctx = context;
      buildGraph(context, musicVolume, sfxVolume);
      arrangementStart = context.currentTime + 0.05;
      transport.start(context);
      startRain(context);
    },
    onSchedule(context) { transport.schedule(context); },
    onMusicVolumeChange(context, volume) { musicGain?.gain.setTargetAtTime(volume, context.currentTime, 0.05); },
    onSfxVolumeChange(context, volume) { sfxGain?.gain.setTargetAtTime(volume, context.currentTime, 0.03); },
    onDispose() {
      ctx = null;
      master = null;
      musicGain = null;
      sfxGain = null;
      duckGain = null;
      delaySend = null;
      reverbSend = null;
      noiseBuffer = null;
    },
  });

  bus.on('runstart', () => {
    if (!ctx) return;
    mode = 'run';
    bossDamage = 0;
    arrangementStart = ctx.currentTime + 0.06;
    transport.reset(arrangementStart, 0);
  });
  bus.on('runend', () => { mode = 'ambient'; });
  bus.on('lock', ({ lockCount }) => playLock(lockCount));
  bus.on('fire', ({ volleySize, indexInVolley }) => playFire(volleySize, indexInVolley ?? 0));
  bus.on('hit', ({ lethal, hitStageIndex, hitStageCount }) => {
    if (hitStageCount > 1) bossDamage += 1;
    playHit(lethal, hitStageIndex, hitStageCount);
  });
  bus.on('kill', ({ scoreAwarded, volleyId, indexInVolley }) => playKill(scoreAwarded, volleyId ?? 0, indexInVolley ?? 0));
  bus.on('reject', () => playReject());
  bus.on('playerhit', () => playPlayerHit());
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') playFinale();
  });

  function buildGraph(context: AudioContext, musicVolume: number, sfxVolume: number) {
    const graph = createAudioGraphBuilder(context);
    master = graph.gain(1);
    musicGain = graph.gain(musicVolume);
    sfxGain = graph.gain(sfxVolume);
    duckGain = graph.gain(1);
    const compressor = graph.compressor({ threshold: -17, ratio: 4.5, attack: 0.004, release: 0.18 });
    graph.connect(musicGain, duckGain);
    graph.connect(duckGain, master);
    graph.connect(sfxGain, master);
    graph.connect(master, compressor);
    graph.connect(compressor, context.destination);

    delaySend = graph.gain(0.75);
    const delay = graph.delay(0.8, SIXTEENTH * 3);
    const feedback = graph.gain(0.34);
    const damp = graph.biquadFilter({ type: 'lowpass', frequency: 2600 });
    graph.connect(delaySend, delay);
    graph.connect(delay, damp);
    graph.connect(damp, feedback);
    graph.connect(feedback, delay);
    graph.connect(delay, musicGain);
    graph.connect(delay, sfxGain);

    reverbSend = graph.gain(0.45);
    const reverbDelay = graph.delay(1.4, 0.19);
    const reverbFeedback = graph.gain(0.58);
    const reverbDamp = graph.biquadFilter({ type: 'lowpass', frequency: 1800 });
    graph.connect(reverbSend, reverbDelay);
    graph.connect(reverbDelay, reverbDamp);
    graph.connect(reverbDamp, reverbFeedback);
    graph.connect(reverbFeedback, reverbDelay);
    graph.connect(reverbDelay, musicGain);
    graph.connect(reverbDelay, sfxGain);

    noiseBuffer = graph.noiseBuffer(2.0);
  }

  function startRain(context: AudioContext) {
    if (!noiseBuffer || !musicGain) return;
    playBufferSourceVoice({
      context,
      buffer: noiseBuffer,
      time: context.currentTime + 0.02,
      stopTime: context.currentTime + 60 * 60,
      loop: true,
      filter: { type: 'bandpass', frequency: 1700, Q: 0.8 },
      gainAutomation: [{ type: 'set', value: 0.035, time: context.currentTime + 0.02 }],
      destination: musicGain,
    });
  }

  function scheduleStep(index: number, time: number) {
    if (!ctx || !musicGain) return;
    const runTime = mode === 'run' ? time - arrangementStart : -1;
    const section = sectionForTime(runTime);
    const step = index % STEPS_PER_BAR;
    const barIndex = Math.floor(index / STEPS_PER_BAR);
    const chord = chordForBar(barIndex, runTime);
    if (step % 4 === 0) emitBeatAt(bus, ctx, time, Math.floor(index / 4), step === 0);

    if (mode === 'ambient') {
      if (step === 0) schedulePad(time, chord, 0.08, 2.2);
      if (step === 8) scheduleArp(time, chord.arp[(barIndex + step) % chord.arp.length] + 12, 0.025, 0.16);
      return;
    }
    if (runTime < 0 || runTime > DELUGE_DURATION) return;

    const intro = runTime < STREETFALL_TIME;
    const avenue = runTime >= STREETFALL_TIME && runTime < UNDER_TIME;
    const tube = runTime >= UNDER_TIME && runTime < CANAL_TIME;
    const boss = runTime >= VULTURE_TIME && runTime < OUTRO_TIME;
    const phase2 = runTime >= PHASE2_TIME && runTime < OUTRO_TIME;
    const outro = runTime >= OUTRO_TIME;

    if (step === 0) {
      scheduleKick(time, intro ? 0.13 : outro ? 0.04 : boss ? 0.24 : 0.30);
      schedulePad(time, chord, intro ? 0.08 : boss ? 0.11 : tube ? 0.045 : 0.06, outro ? 3.0 : 1.25);
    }
    if (intro && step === 8) scheduleKick(time, 0.07);
    if (avenue && [4, 11, 14].includes(step)) scheduleKick(time, 0.17);
    if (tube && [3, 6, 9, 12, 15].includes(step)) scheduleKick(time, 0.13);
    if (boss && !phase2 && step === 8) scheduleKick(time, 0.18);
    if (phase2 && [2, 7, 10, 15].includes(step)) scheduleKick(time, 0.17);

    if (!intro && !outro && (step === 4 || step === 12 || (avenue && step === 14) || (phase2 && step === 10))) scheduleSnare(time, boss ? 0.25 : 0.21);
    if (!outro && ((intro && step % 8 === 0) || (avenue && step % 2 === 0) || (tube && step % 2 === 1) || (boss && step % 4 !== 0))) {
      scheduleHat(time, tube ? 0.075 : intro ? 0.025 : phase2 ? 0.065 : 0.052);
    }
    if (!intro && !outro && (tube ? [0, 2, 5, 8, 11, 14].includes(step) : boss ? [0, 6, 8, 13].includes(step) : [0, 3, 6, 10, 12].includes(step))) {
      scheduleReese(time, chord.bass, tube ? 0.18 : boss ? 0.21 : 0.15);
    }
    if (!intro && !outro && (step === 1 || step === 5 || step === 9 || step === 13 || (phase2 && step % 2 === 1))) {
      const note = chord.arp[(index + section) % chord.arp.length] + (tube ? 0 : phase2 ? 7 : 12);
      scheduleArp(time, note, tube ? 0.034 : phase2 ? 0.044 : 0.052, SIXTEENTH * (tube ? 1.1 : 1.5));
    }
    if ((STREETFALL_TIME - runTime > 0 && STREETFALL_TIME - runTime < 2.2) || (UNDER_TIME - runTime > 0 && UNDER_TIME - runTime < 2.2)) {
      if (step % 2 === 0) scheduleRiser(time, chord.root + 36 + Math.floor((index % 16) / 2));
    }
    if (Math.abs(runTime - STREETFALL_TIME) < SIXTEENTH || Math.abs(runTime - UNDER_TIME) < SIXTEENTH) scheduleImpact(time);
    if (Math.abs(runTime - TRAIN_PASS_TIME) < SIXTEENTH && step === 0) scheduleTrainRoar(time);
    if (phase2 && [0, 4, 8, 12].includes(step)) scheduleChargeBed(time, chord.root + 12 + (bossDamage % 5));
    if (boss && step === 4) scheduleBossVoice(time, chord.root + 24 + (bossDamage % 7));
    if (outro && step === 0) scheduleArp(time, chord.root + 36, 0.025, 0.8);

    if (nearestLightning(runTime, SIXTEENTH * 0.65)) scheduleThunder(time);
  }

  function sectionForTime(runTime: number) {
    if (runTime < STREETFALL_TIME) return 0;
    if (runTime < UNDER_TIME) return 1;
    if (runTime < VULTURE_TIME) return 2;
    return 3;
  }

  function chordForBar(barIndex: number, runTime: number) {
    const bank = runTime >= VULTURE_TIME && runTime < OUTRO_TIME ? BOSS_CHORDS : CHORDS;
    return bank[Math.floor(barIndex / 2) % bank.length];
  }

  function scheduleRiser(time: number, midi: number) {
    if (!ctx || !musicGain || !delaySend) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + SIXTEENTH * 1.7,
      oscillatorType: 'sawtooth',
      frequency: midiToFreq(midi),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi + 12), time: time + SIXTEENTH * 1.7 }],
      filter: { type: 'highpass', frequency: 600, Q: 0.7 },
      gainAutomation: [{ type: 'set', value: 0.018, time }, { type: 'linearRamp', value: 0.055, time: time + SIXTEENTH * 1.3 }, { type: 'exponentialRamp', value: 0.001, time: time + SIXTEENTH * 1.7 }],
      destination: musicGain,
      sends: [{ destination: delaySend, gain: 0.22 }],
    });
  }

  function scheduleImpact(time: number) {
    if (!ctx || !musicGain || !noiseBuffer) return;
    scheduleKick(time, 0.42);
    playNoiseHit({ context: ctx, buffer: noiseBuffer, time, velocity: 0.38, decay: 0.42, filterType: 'lowpass', frequency: 520, destination: musicGain });
  }

  function scheduleTrainRoar(time: number) {
    if (!ctx || !musicGain || !noiseBuffer) return;
    playNoiseHit({ context: ctx, buffer: noiseBuffer, time, velocity: 0.28, decay: 1.4, filterType: 'bandpass', frequency: 420, destination: musicGain });
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.6,
      oscillatorType: 'sawtooth',
      frequency: 86,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 42, time: time + 1.45 }],
      filter: { type: 'lowpass', frequency: 780, Q: 0.5 },
      gainAutomation: [{ type: 'set', value: 0.16, time }, { type: 'exponentialRamp', value: 0.001, time: time + 1.6 }],
      destination: musicGain,
    });
  }

  function scheduleChargeBed(time: number, midi: number) {
    if (!ctx || !musicGain) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + SIXTEENTH * 3.7,
      oscillatorType: 'sawtooth',
      frequency: midiToFreq(midi),
      filter: { type: 'bandpass', frequency: 760 + bossDamage * 70, Q: 5.0 },
      gainAutomation: [{ type: 'set', value: 0.026 + bossDamage * 0.002, time }, { type: 'linearRamp', value: 0.055 + bossDamage * 0.003, time: time + SIXTEENTH * 2 }, { type: 'exponentialRamp', value: 0.001, time: time + SIXTEENTH * 3.7 }],
      destination: musicGain,
    });
  }

  function scheduleKick(time: number, gain: number) {
    if (!ctx || !musicGain) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.18,
      oscillatorType: 'sine',
      frequency: 92,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 38, time: time + 0.12 }],
      gainAutomation: [{ type: 'set', value: gain, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.18 }],
      destination: musicGain,
    });
  }

  function scheduleSnare(time: number, gain: number) {
    if (!ctx || !musicGain || !noiseBuffer) return;
    playNoiseHit({ context: ctx, buffer: noiseBuffer, time, velocity: gain, decay: 0.12, filterType: 'bandpass', frequency: 1900, destination: musicGain });
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.08,
      oscillatorType: 'triangle',
      frequency: 185,
      gainAutomation: [{ type: 'set', value: gain * 0.35, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.08 }],
      destination: musicGain,
    });
  }

  function scheduleHat(time: number, gain: number) {
    if (!ctx || !musicGain || !noiseBuffer) return;
    playNoiseHit({ context: ctx, buffer: noiseBuffer, time, velocity: gain, decay: 0.035, filterType: 'highpass', frequency: 5200, destination: musicGain });
  }

  function scheduleReese(time: number, midi: number, gain: number) {
    if (!ctx || !musicGain) return;
    const freq = midiToFreq(midi);
    for (const detune of [-9, 9]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + SIXTEENTH * 3.3,
        oscillatorType: 'sawtooth',
        frequency: freq,
        detune,
        filter: { type: 'lowpass', frequency: PHASE2_TIME > 0 ? 680 : 900, Q: 0.6 },
        gainAutomation: [{ type: 'set', value: gain * 0.36, time }, { type: 'linearRamp', value: gain * 0.2, time: time + 0.12 }, { type: 'exponentialRamp', value: 0.001, time: time + SIXTEENTH * 3.3 }],
        destination: musicGain,
      });
    }
  }

  function schedulePad(time: number, chord: Chord, gain: number, length: number) {
    if (!ctx || !musicGain || !reverbSend) return;
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + length,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1200, Q: 0.5 },
        gainAutomation: [{ type: 'set', value: 0.001, time }, { type: 'linearRamp', value: gain / chord.pad.length, time: time + 0.12 }, { type: 'exponentialRamp', value: 0.001, time: time + length }],
        destination: musicGain,
        sends: [{ destination: reverbSend, gain: 0.35 }],
      });
    }
  }

  function scheduleArp(time: number, midi: number, gain: number, length: number) {
    if (!ctx || !musicGain || !delaySend) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + length,
      oscillatorType: 'square',
      frequency: midiToFreq(midi),
      filter: { type: 'lowpass', frequency: 3200, Q: 0.8 },
      gainAutomation: [{ type: 'set', value: gain, time }, { type: 'exponentialRamp', value: 0.001, time: time + length }],
      destination: musicGain,
      sends: [{ destination: delaySend, gain: 0.32 }],
    });
  }

  function scheduleBossVoice(time: number, midi: number) {
    if (!ctx || !musicGain || !delaySend) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.45,
      oscillatorType: 'sawtooth',
      frequency: midiToFreq(midi),
      filter: { type: 'bandpass', frequency: 900 + bossDamage * 80, Q: 4 },
      gainAutomation: [{ type: 'set', value: 0.05 + bossDamage * 0.004, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.45 }],
      destination: musicGain,
      sends: [{ destination: delaySend, gain: 0.28 }],
    });
  }

  function scheduleThunder(time: number) {
    if (!ctx || !musicGain || !noiseBuffer) return;
    playNoiseHit({ context: ctx, buffer: noiseBuffer, time, velocity: 0.32, decay: 0.85, filterType: 'lowpass', frequency: 320, destination: musicGain });
  }

  function liveChord(time: number) {
    const runTime = mode === 'run' ? time - arrangementStart : 0;
    return chordForBar(Math.max(0, Math.floor(runTime / (SIXTEENTH * STEPS_PER_BAR))), runTime);
  }

  function quantizePlayerAction(time: number) {
    const q = getActionSfxQuantization();
    if (!q.enabled) return time;
    const grid = THIRTYSECOND * q.gridThirtyseconds;
    return arrangementStart + Math.ceil(Math.max(0, time - arrangementStart) / grid) * grid;
  }

  function playLock(lockCount: number) {
    if (!ctx || !sfxGain || !delaySend) return;
    const time = quantizePlayerAction(ctx.currentTime);
    const chord = liveChord(time);
    const note = chord.arp[(lockCount - 1) % chord.arp.length] + 12;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.12,
      oscillatorType: lockCount >= 5 ? 'square' : 'triangle',
      frequency: midiToFreq(note),
      filter: { type: 'lowpass', frequency: 2600 + lockCount * 220 },
      gainAutomation: [{ type: 'set', value: lockCount >= 6 ? 0.085 : 0.055, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.12 }],
      destination: sfxGain,
      sends: [{ destination: delaySend, gain: 0.12 }],
    });
  }

  function playFire(volleySize: number, index: number) {
    if (!ctx || !sfxGain || !noiseBuffer) return;
    const time = quantizePlayerAction(ctx.currentTime);
    const chord = liveChord(time);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.11,
      oscillatorType: 'sawtooth',
      frequency: midiToFreq(chord.root + 24 + index * 2),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.root + 12), time: time + 0.1 }],
      filter: { type: 'lowpass', frequency: 5200 },
      gainAutomation: [{ type: 'set', value: 0.035 + volleySize * 0.005, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.11 }],
      destination: sfxGain,
    });
    playNoiseHit({ context: ctx, buffer: noiseBuffer, time, velocity: 0.025, decay: 0.04, filterType: 'highpass', frequency: 3600, destination: sfxGain });
  }

  function playHit(lethal: boolean, stageIndex: number, stageCount: number) {
    if (!ctx || !sfxGain) return;
    const time = quantizePlayerAction(ctx.currentTime);
    const chord = liveChord(time);
    const note = chord.root + 19 + stageIndex * 2 + (stageCount > 1 ? bossDamage % 5 : 0);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + (lethal ? 0.16 : 0.1),
      oscillatorType: lethal ? 'square' : 'triangle',
      frequency: midiToFreq(note),
      filter: { type: 'bandpass', frequency: lethal ? 1800 : 2400, Q: 2.2 },
      gainAutomation: [{ type: 'set', value: lethal ? 0.08 : 0.045, time }, { type: 'exponentialRamp', value: 0.001, time: time + (lethal ? 0.16 : 0.1) }],
      destination: sfxGain,
    });
  }

  function playKill(score: number, volleyId: number, index: number) {
    if (!ctx || !sfxGain || !delaySend) return;
    const time = quantizePlayerAction(ctx.currentTime);
    const chord = liveChord(time);
    const lane = KILL_LANE[(volleyId * 3 + index) % KILL_LANE.length];
    const note = chord.root + 24 + lane;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + (score > 1000 ? 0.55 : 0.24),
      oscillatorType: score > 1000 ? 'sawtooth' : 'square',
      frequency: midiToFreq(note),
      filter: { type: 'lowpass', frequency: score > 1000 ? 3600 : 2800 },
      gainAutomation: [{ type: 'set', value: score > 1000 ? 0.13 : 0.075, time }, { type: 'exponentialRamp', value: 0.001, time: time + (score > 1000 ? 0.55 : 0.24) }],
      destination: sfxGain,
      sends: [{ destination: delaySend, gain: 0.22 }],
    });
  }

  function playReject() {
    if (!ctx || !sfxGain) return;
    const time = quantizePlayerAction(ctx.currentTime);
    const chord = liveChord(time);
    for (const [i, offset] of [1, 6].entries()) {
      playOscillatorVoice({
        context: ctx,
        time: time + i * THIRTYSECOND,
        stopTime: time + i * THIRTYSECOND + 0.13,
        oscillatorType: 'square',
        frequency: midiToFreq(chord.root + 12 + offset),
        filter: { type: 'bandpass', frequency: 1200, Q: 3.5 },
        gainAutomation: [{ type: 'set', value: 0.06, time: time + i * THIRTYSECOND }, { type: 'exponentialRamp', value: 0.001, time: time + i * THIRTYSECOND + 0.13 }],
        destination: sfxGain,
      });
    }
  }

  function playPlayerHit() {
    if (!ctx || !sfxGain || !noiseBuffer) return;
    playNoiseHit({ context: ctx, buffer: noiseBuffer, time: ctx.currentTime, velocity: 0.18, decay: 0.22, filterType: 'bandpass', frequency: 640, destination: sfxGain });
  }

  function playFinale() {
    if (!ctx || !sfxGain || !duckGain) return;
    const time = quantizePlayerAction(ctx.currentTime);
    duckGain.gain.setValueAtTime(0.28, time);
    duckGain.gain.linearRampToValueAtTime(1, time + 0.8);
    for (const [i, midi] of [74, 77, 81, 86, 93].entries()) {
      playOscillatorVoice({
        context: ctx,
        time: time + i * THIRTYSECOND * 2,
        stopTime: time + i * THIRTYSECOND * 2 + 0.5,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 4200 },
        gainAutomation: [{ type: 'set', value: 0.09, time: time + i * THIRTYSECOND * 2 }, { type: 'exponentialRamp', value: 0.001, time: time + i * THIRTYSECOND * 2 + 0.5 }],
        destination: sfxGain,
      });
    }
  }

  return audio;
}
