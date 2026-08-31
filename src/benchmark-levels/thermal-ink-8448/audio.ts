import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  defineInstruments,
  type BeatLevelAudioRuntime,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  THERMAL_INK_8448_BPM,
  THERMAL_INK_8448_RUN_DURATION,
  THERMAL_INK_8448_TIME,
} from './gameplay';

// The harbour pulse is intentionally slow and physical: a low kick, a
// bouncing distorted bass, small pieces of metal, and one four-note melody.
// At bar 4 the ink drops the noise floor and the same melody moves into a
// narrower, brighter register. Kills unmute a hidden lane so the player is the
// soloist inside the written harmony.
const SIXTEENTH = THERMAL_INK_8448_TIME.stepSeconds;
const STEPS_PER_BAR = 16;
const LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };
type SectionIndex = 0 | 1 | 2;

const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74], stab: [57, 62, 65] }, // Dm9
  { bass: 34, pad: [46, 50, 53, 57], arp: [57, 62, 65, 69], stab: [53, 57, 62] }, // Bb6
  { bass: 31, pad: [43, 46, 50, 55], arp: [55, 58, 62, 67], stab: [50, 55, 58] }, // Gm7
  { bass: 33, pad: [45, 49, 52, 57], arp: [57, 61, 64, 69], stab: [52, 57, 61] }, // A7sus
];

const FINAL_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 39, pad: [51, 54, 58, 63], arp: [63, 66, 70, 75], stab: [58, 63, 66] }, // Eb/D, poisoned lift
  CHORDS[2],
  CHORDS[3],
];

const SCORE_SECTIONS = [
  { index: 0, fromBar: 0 },
  { index: 1, fromBar: 4, crossfadeBars: 1 },
  { index: 2, fromBar: 18, crossfadeBars: 1 },
] as const;

const KILL_LANES: Record<SectionIndex, number[]> = {
  0: [0, 1, 2, 3, 2, 1, 0, 2, 3, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 2, 4, 3, 2, 1, 2, 3, 4, 2],
  1: [4, 6, 5, 7, 4, 2, 5, 3, 6, 4, 7, 5, 3, 6, 4, 2, 5, 7, 6, 4, 5, 3, 2, 4, 7, 6, 5, 4, 3, 2, 1, 0],
  2: [7, 6, 5, 4, 7, 6, 5, 3, 6, 5, 4, 2, 5, 4, 3, 1, 4, 3, 2, 0, 3, 2, 1, 0, 4, 5, 6, 7, 6, 5, 4, 7],
};

type PlayerVoice = { oscillator: OscillatorType; cutoff: number; gain: number; decay: number; focus: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: PlayerVoice; kill: PlayerVoice; fireCutoff: number }> = {
  0: {
    lock: { oscillator: 'triangle', cutoff: 1800, gain: 0.12, decay: 0.11, focus: 0 },
    kill: { oscillator: 'sine', cutoff: 2500, gain: 0.16, decay: 0.38, focus: 0 },
    fireCutoff: 1700,
  },
  1: {
    lock: { oscillator: 'square', cutoff: 2900, gain: 0.045, decay: 0.085, focus: 0.65 },
    kill: { oscillator: 'triangle', cutoff: 5200, gain: 0.15, decay: 0.28, focus: 1 },
    fireCutoff: 3600,
  },
  2: {
    lock: { oscillator: 'sawtooth', cutoff: 3400, gain: 0.046, decay: 0.12, focus: 1 },
    kill: { oscillator: 'sawtooth', cutoff: 5800, gain: 0.145, decay: 0.45, focus: 1.2 },
    fireCutoff: 4300,
  },
};

export function createAudio(bus: EventBus) {
  return createThermalInkAudio(bus).audio;
}

export const traceThermalInkAudio = createAudioTraceHarness({
  level: 'thermal-ink-8448',
  bpm: THERMAL_INK_8448_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: THERMAL_INK_8448_RUN_DURATION,
  createAudio: createThermalInkAudio,
});

function createThermalInkAudio(bus: EventBus, trace?: AudioTraceSink): BeatLevelAudioRuntime {
  let ctx: AudioContext | null = null;
  let coreId = -1;
  let coreHits = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: THERMAL_INK_8448_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: 18, toBar: 27, chords: FINAL_CHORDS, barsPerChord: 1 }],
    sections: SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  let runtime!: BeatLevelAudioRuntime;
  runtime = createBeatLevelAudio({
    bus,
    trace,
    bpm: THERMAL_INK_8448_BPM,
    stepSeconds: SIXTEENTH,
    stepsPerBar: STEPS_PER_BAR,
    volumeScale: 0.78,
    score,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -17, ratio: 5.5, attack: 0.004, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.32, dampHz: 2100 },
      reverb: { seconds: 1.9, decay: 2.9, level: 0.42 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      score.resetKillLane();
      coreId = -1;
      coreHits = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      const output = musicDestination();
      if (context && output) pad(context.currentTime + 0.04, [50, 57, 62, 65], SIXTEENTH * 24, 0.65);
    },
    onDispose() {
      ctx = null;
    },
  });

  const noise = noiseHitSpec({ filterType: 'highpass', frequency: 3000, velocity: 1, decay: 0.05 });
  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.24,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [
      { type: 'set', value: 105, time },
      { type: 'exponentialRamp', value: 39, time: time + 0.16 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.46 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.23 },
    ],
  });
  const bassTone = voice<{ vel: number; growl: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.16 },
      { type: 'sine', octave: -1, gain: 0.22 },
    ],
    duration: 0.34,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 7,
      cutoff: ({ growl, vel }) => 150 + growl * 620 + vel * 120,
      frequencyAutomation: (time, { growl }) => [
        { type: 'linearRamp', value: 160 + growl * 250, time: time + 0.28 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.27 * vel, time: time + 0.012 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.33 },
    ],
  });
  const metalTone = voice<{ vel: number; frequency: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.12 },
      { type: 'square', gain: 0.025, detune: 17 },
    ],
    duration: 0.42,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 8, frequency: ({ frequency }) => frequency },
    frequencyAutomation: (time, frequency) => [
      { type: 'exponentialRamp', value: frequency * 0.72, time: time + 0.36 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.16 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
    ],
  });
  const padTone = voice<{ duration: number; level: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.055, detune: -7 },
      { type: 'triangle', gain: 0.05, detune: 7 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 270, time },
        { type: 'linearRamp', value: 560, time: time + duration * 0.55 },
        { type: 'linearRamp', value: 310, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.055 * level, time: time + Math.min(0.55, duration * 0.25) },
      { type: 'set', value: 0.055 * level, time: time + Math.max(0.2, duration - 0.45) },
      { type: 'linearRamp', value: 0.001, time: time + duration },
    ],
  });
  const melodyTone = voice<{ focus: number; duration: number; vel: number }>({
    oscillators: [
      { type: ({ focus }) => focus > 0.5 ? 'triangle' : 'sine', gain: ({ focus }) => 0.11 + focus * 0.02 },
      { type: 'sine', octave: 1, gain: ({ focus }) => focus * 0.035 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      cutoff: ({ focus }) => 2200 + focus * 3600,
      Q: 1.4,
      frequencyAutomation: (time, { duration }) => [
        { type: 'linearRamp', value: 1600, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.12 * vel, time: time + 0.018 },
      { type: 'linearRamp', value: 0.001, time: time + duration },
    ],
  });
  const playerTone = voice<{ voice: PlayerVoice; vel: number }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff, Q: 2.4 },
    envelope: { decay: ({ voice }) => voice.decay },
  });
  const fireTone = voice<{ cutoff: number; vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.08 }, { type: 'sine', gain: 0.08, octave: 1 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    frequencyAutomation: (time, _frequency, { vel }) => [
      { type: 'exponentialRamp', value: midiToFreq(36) * (0.9 + vel * 0.1), time: time + 0.13 },
    ],
    envelope: { decay: 0.16 },
  });
  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.48,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 35, time: time + 0.34 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.38 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.46 },
    ],
  });

  const instruments = defineInstruments({ trace, context: () => ctx }, {
    kick(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      kickTone.play({ context, time, midi: 36, vel, destination: output });
      hitNoise(time, 0.09 * vel, 0.006, 'lowpass', 900, output);
      runtime.mix()?.duckAt(time, 0.48, 0.24);
    },
    bass(context, time, midi, vel, growl) {
      const output = runtime.mix()?.duck;
      if (!output) return;
      bassTone.play({ context, time, midi, vel, growl, destination: output });
    },
    metal(context, time, frequency, vel) {
      const output = runtime.mix()?.duck;
      if (!output) return;
      metalTone.play({ context, time, frequency, vel, frequencyAutomation: undefined, destination: output, sends: reverbSend(0.42) });
    },
    pad(context, time, midis, duration, level) {
      const mix = runtime.mix();
      if (!mix?.duck) return;
      for (const midi of midis) padTone.play({ context, time, midi, duration, level, destination: mix.duck, sends: reverbSend(0.5) });
    },
    melody(context, time, midi, duration, vel, focus) {
      const mix = runtime.mix();
      if (!mix?.duck) return;
      melodyTone.play({ context, time, midi, duration, vel, focus, destination: mix.duck, sends: delaySend(0.48) });
    },
    ink(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      hitNoise(time, vel, 0.42, 'lowpass', 320, output);
      hitNoise(time + 0.03, vel * 0.5, 0.28, 'bandpass', 740, output);
    },
    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, vel, midi: 31, destination: output });
      hitNoise(time, 0.24 * vel, 0.3, 'lowpass', 380, output);
    },
  }, {
    kick: ['vel'],
    bass: ['midi', 'vel', 'growl'],
    metal: ['frequency', 'vel'],
    pad: ['midis', 'duration', 'level'],
    melody: ['midi', 'duration', 'vel', 'focus'],
    ink: ['vel'],
    impact: ['vel'],
  });

  const { kick, bass, metal, pad, melody, ink, impact } = instruments;
  const outputForSfx = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  function musicDestination() {
    return runtime.mix()?.music ?? runtime.mix()?.master ?? null;
  }

  function delaySend(gain: number) {
    const destination = runtime.mix()?.delaySend;
    return destination ? [{ destination, gain }] : [];
  }

  function reverbSend(gain: number) {
    const destination = runtime.mix()?.reverbSend;
    return destination ? [{ destination, gain }] : [];
  }

  function hitNoise(time: number, velocity: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = ctx;
    const buffer = runtime.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noise.play({ context, buffer, time, velocity, decay, filterType, frequency, destination, loopStart: Math.random(), offset: Math.random() * 1.5 });
  }

  function sectionMix(time: number): SectionMix<SectionIndex> {
    return score.sectionMixAt(score.arrangementPositionAt(time));
  }

  function playPlayerTone(time: number, midi: number, voiceData: PlayerVoice, velocity: number) {
    if (trace) {
      trace.record(time, 'playerTone', { midi, velocity, oscillator: voiceData.oscillator });
      return;
    }
    const output = outputForSfx();
    const context = ctx;
    if (!context || !output) return;
    playerTone.play({ context, time, midi, voice: voiceData, vel: velocity, velocity, destination: output, sends: delaySend(0.38) });
  }

  bus.on('lock', ({ lockCount }) => {
    const context = ctx;
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = sectionMix(time);
    const degree = Math.min(7, Math.max(0, lockCount - 1));
    const layers = score.sectionLayers(mix);
    for (const [section, weight] of layers) {
      const voiceData = PLAYER_VOICES[section].lock;
      const chord = score.chordAt(position);
      playPlayerTone(time, score.leadSetAt(position)[degree] ?? chord.arp[degree % chord.arp.length], voiceData, weight * (0.82 + lockCount * 0.04));
    }
  });

  bus.on('fire', ({ volleySize }) => {
    const context = ctx;
    const output = outputForSfx();
    if (!context || !output) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = sectionMix(time);
    const root = score.chordAt(position).bass;
    const cutoff = lerp(PLAYER_VOICES[mix.from].fireCutoff, PLAYER_VOICES[mix.to].fireCutoff, mix.t);
    fireTone.play({ context, time, midi: root + 24, cutoff, vel: Math.min(1.3, 0.75 + volleySize * 0.1), destination: output, sends: delaySend(0.28) });
    hitNoise(time, 0.025 + volleySize * 0.006, 0.035, 'highpass', cutoff + 900, output);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const context = ctx;
    const output = outputForSfx();
    if (!context || !output || runtime.mode() !== 'run') return;
    const time = score.nextGridTime(context.currentTime, 0.5);
    if (enemyId === coreId && !lethal) {
      coreHits += 1;
      const chord = score.chordAt(score.arrangementPositionAt(time));
      impactTone.play({ context, time, midi: chord.bass, vel: Math.min(1.4, 0.58 + coreHits * 0.08), destination: output, sends: reverbSend(0.4) });
      hitNoise(time, 0.06 + coreHits * 0.008, 0.08, 'bandpass', 900 + coreHits * 160, output);
      void hitPointsRemaining;
      return;
    }
    hitNoise(time, lethal ? 0.08 : 0.12, lethal ? 0.055 : 0.1, 'bandpass', lethal ? 1800 : 1050, output);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const context = ctx;
    const output = outputForSfx();
    if (!context || !output || runtime.mode() !== 'run') return;
    const time = score.nextGridTime(context.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    impactTone.play({ context, time, midi: chord.bass - (enemyId === coreId ? 0 : 5), vel: enemyId === coreId ? 0.8 + stageIndex * 0.12 : 0.48, destination: output, sends: reverbSend(0.42) });
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const context = ctx;
    const output = outputForSfx();
    if (!context || !output || runtime.mode() !== 'run') return;
    const kill = score.nextKill(context.currentTime);
    const mix = sectionMix(kill.time);
    const chain = (indexInVolley ?? 0) / 4;
    const layers = score.sectionLayers(mix);
    for (const [section, weight] of layers) {
      const voiceData = PLAYER_VOICES[section].kill;
      const midi = kill.midi + (section === 2 ? 0 : 0);
      playPlayerTone(kill.time, midi, voiceData, weight * (0.9 + Math.min(0.45, chain * 0.16)));
    }
  });

  bus.on('volley', ({ size, kills }) => {
    const context = ctx;
    const output = outputForSfx();
    if (!context || !output || kills < 3 || kills < size || runtime.mode() !== 'run') return;
    const time = score.nextGridTime(context.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    pad(time, chord.stab, SIXTEENTH * 3, Math.min(1.05, 0.45 + size * 0.08));
    hitNoise(time, 0.08, 0.08, 'highpass', 5000, output);
  });

  bus.on('reject', () => {
    const context = ctx;
    const output = outputForSfx();
    if (!context || !output) return;
    const time = score.quantizePlayerAction(context.currentTime);
    metal(time, 240, 0.7);
    hitNoise(time, 0.08, 0.16, 'bandpass', 560, output);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'core') coreId = enemyId;
    if (kind === 'ink-cloud') {
      const context = ctx;
      if (context && runtime.mode() === 'run') ink(score.nextGridTime(context.currentTime, 1), 0.85);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    const context = ctx;
    if (!context || runtime.mode() !== 'run') return;
    const time = score.nextGridTime(context.currentTime, phase === 'destroyed' ? 4 : 1);
    if (phase === 'summoned') impact(time, 0.7);
    if (phase === 'exposed') {
      const chord = score.chordAt(score.arrangementPositionAt(time));
      pad(time, chord.pad, SIXTEENTH * 12, 0.84);
      impact(time, 1.05);
    }
    if (phase === 'destroyed') {
      pad(time, [50, 57, 62, 65], SIXTEENTH * 20, 0.94);
      impact(time, 1.3);
    }
  });

  bus.on('playerhit', () => {
    const context = ctx;
    const output = outputForSfx();
    if (!context || !output) return;
    const time = score.quantizePlayerAction(context.currentTime);
    hitNoise(time, 0.28, 0.22, 'lowpass', 210, output);
    metal(time, 155, 0.7);
  });

  function scheduleStep(step: { position: number; time: number; mode: 'ambient' | 'run' }) {
    if (step.mode === 'ambient') ambientArrangement.schedule(step.position, step.time);
    else runArrangement.schedule(step.position, step.time);
  }

  const blank = '................';
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      return CHORDS[Math.floor(position / STEPS_PER_BAR / 2) % CHORDS.length];
    },
    sections: [{
      name: 'attract',
      fromBar: 0,
      tracks: [
        hits('P...............' + blank, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * 30, 0.35)),
        hits('M.......M.......', { M: 1 }, ({ time, chord, step }) => melody(time, chord.arp[(step / 4) % chord.arp.length] + 12, SIXTEENTH * 3, 0.32, 0.12)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'silt',
        fromBar: 0,
        toBar: 4,
        tracks: [
          hits('K.......k.......', { K: 0.9, k: 0.64 }, ({ time }, velocity) => kick(time, velocity)),
          hits('B...b.......B...', { B: 0.82, b: 0.55 }, ({ time, chord }, velocity, symbol) => bass(time, chord.bass + (symbol === 'b' ? 7 : 0), velocity, 0.25)),
          hits('....m.......m...', { m: 0.48 }, ({ time }, velocity) => metal(time, 720, velocity)),
          hits('P...............' + blank, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * 29, 0.42)),
          hits('M.......M.......', { M: 1 }, ({ time, chord, step }) => melody(time, chord.arp[(step / 4) % chord.arp.length] + 12, SIXTEENTH * 3.2, 0.45, 0.05)),
        ],
      },
      {
        name: 'blackout',
        fromBar: 4,
        toBar: 8,
        tracks: [
          hits('K.......k.......', { K: 0.92, k: 0.7 }, ({ time }, velocity) => kick(time, velocity)),
          hits('B..b..B...b.....', { B: 0.9, b: 0.56 }, ({ time, chord }, velocity, symbol) => bass(time, chord.bass + (symbol === 'b' ? 7 : 0), velocity, 0.62)),
          hits('....m.......m...', { m: 0.22 }, ({ time }, velocity) => metal(time, 900, velocity)),
          hits('P...............' + blank, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * 29, 0.34)),
          hits('M...M...M...M...', { M: 1 }, ({ time, chord, step }) => melody(time, chord.arp[(step / 2) % chord.arp.length] + 12, SIXTEENTH * 2.2, 0.58, 0.88)),
          oneShot(0, 0, ({ time }) => ink(time, 0.78)),
        ],
      },
      {
        name: 'pressure',
        fromBar: 8,
        toBar: 12,
        tracks: [
          hits('K...k...K...k...', { K: 1, k: 0.72 }, ({ time }, velocity) => kick(time, velocity)),
          hits('B..b.B..B..b....', { B: 0.92, b: 0.62 }, ({ time, chord }, velocity, symbol) => bass(time, chord.bass + (symbol === 'b' ? 7 : 0), velocity, 0.86)),
          hits('m...m...m...m...', { m: 0.35 }, ({ time }, velocity) => metal(time, 980, velocity)),
          hits('P...............' + blank, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * 29, 0.3)),
          hits('M.M.M.M.M.M.M.M.', { M: 0.8 }, ({ time, chord, step }, velocity) => melody(time, chord.arp[(step / 2) % chord.arp.length] + 12, SIXTEENTH * 1.5, velocity, 0.95)),
          oneShot(0, 0, ({ time }) => ink(time, 0.7)),
        ],
      },
      {
        name: 'deep-water',
        fromBar: 12,
        toBar: 16,
        tracks: [
          hits('K.......K.......', { K: 1 }, ({ time }, velocity) => kick(time, velocity)),
          hits('B.....B...B.....', { B: 0.96 }, ({ time, chord }, velocity) => bass(time, chord.bass, velocity, 1)),
          hits('....m...........', { m: 0.42 }, ({ time }, velocity) => metal(time, 520, velocity)),
          hits('P...............' + blank, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * 29, 0.37)),
          hits('M.......M.......', { M: 1 }, ({ time, chord, step }) => melody(time, chord.arp[(step / 4) % chord.arp.length] + 12, SIXTEENTH * 3.4, 0.6, 0.92)),
          oneShot(0, 0, ({ time }) => ink(time, 0.82)),
        ],
      },
      {
        name: 'mantle',
        fromBar: 16,
        toBar: 20,
        tracks: [
          hits('K...k...K...k...', { K: 1, k: 0.76 }, ({ time }, velocity) => kick(time, velocity)),
          hits('B.b.B...B.b.....', { B: 1, b: 0.68 }, ({ time, chord }, velocity, symbol) => bass(time, chord.bass + (symbol === 'b' ? 7 : 0), velocity, 1.05)),
          hits('m...m...m...m...', { m: 0.3 }, ({ time }, velocity) => metal(time, 1120, velocity)),
          hits('P...............' + blank, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * 29, 0.32)),
          hits('M...M...M...M...', { M: 1 }, ({ time, chord, step }) => melody(time, chord.arp[(step / 2) % chord.arp.length] + 12, SIXTEENTH * 2.1, 0.64, 1)),
          oneShot(0, 0, ({ time }) => ink(time, 0.82)),
        ],
      },
      {
        name: 'core-reveal',
        fromBar: 20,
        toBar: 24,
        tracks: [
          hits('K...k...K...k...', { K: 1, k: 0.84 }, ({ time }, velocity) => kick(time, velocity)),
          hits('B..b.B..B..b....', { B: 1, b: 0.75 }, ({ time, chord }, velocity, symbol) => bass(time, chord.bass + (symbol === 'b' ? 7 : 0), velocity, 1.12)),
          hits('m.m.m.m.m.m.m.m.', { m: 0.27 }, ({ time }, velocity) => metal(time, 1250, velocity)),
          hits('P...............' + blank, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * 29, 0.28)),
          hits('M.M.M.M.M.M.M.M.', { M: 1 }, ({ time, chord, step }) => melody(time, chord.arp[(step / 2) % chord.arp.length] + 12, SIXTEENTH * 1.5, 0.72, 1.05)),
          oneShot(0, 0, ({ time }) => ink(time, 0.92)),
        ],
      },
      {
        name: 'final-blackout',
        fromBar: 24,
        toBar: 27,
        tracks: [
          hits('K...K...K...K...', { K: 1 }, ({ time }, velocity) => kick(time, velocity)),
          hits('B.B.B...B.B.....', { B: 1 }, ({ time, chord }, velocity) => bass(time, chord.bass, velocity, 1.25)),
          hits('m.m.m.m.m.m.m.m.', { m: 0.18 }, ({ time }, velocity) => metal(time, 1450, velocity)),
          hits('P...............' + blank, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, SIXTEENTH * 29, 0.24)),
          hits('M.M.M.M.M.M.M.M.', { M: 1 }, ({ time, chord, step }) => melody(time, chord.arp[(step / 2) % chord.arp.length] + 12, SIXTEENTH * 1.4, 0.82, 1.2)),
          oneShot(0, 0, ({ time }) => ink(time, 1.05)),
          oneShot(2, 0, ({ time }) => impact(time, 0.92)),
        ],
      },
    ],
  });

  return runtime;
}
