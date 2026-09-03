import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  defineInstruments,
  playBufferSourceVoice,
  playNoiseHit,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  SKYHOOK_V01U_BARS,
  SKYHOOK_V01U_BPM,
  SKYHOOK_V01U_RUN_DURATION,
  SKYHOOK_V01U_STEPS_PER_BAR,
  SKYHOOK_V01U_TIME,
} from './gameplay';

// Skyhook's score starts wide and human: low wind, broad suspended chords,
// and room around every action. The cloud deck adds a restrained pulse; the
// high atmosphere removes the bass and most of the percussion; the boss brings
// back one heavy tether heartbeat. The last four bars are a decelerating
// station chord, so a successful run actually lands instead of just stopping.

const STEP = SKYHOOK_V01U_TIME.stepSeconds;
const THIRTYSECOND = STEP / 2;
const STEPS_PER_BAR = SKYHOOK_V01U_STEPS_PER_BAR;

type SkyhookChord = {
  bass: number;
  pad: number[];
  arp: number[];
  stab: number[];
};

// D minor / suspended fourths: weather begins unresolved, then the B♭ and C
// colors make the sky feel larger before the boss turns the F natural into a
// warning tone.
const CHORDS: SkyhookChord[] = [
  { bass: 38, pad: [50, 53, 57, 60], arp: [62, 65, 69, 72], stab: [62, 65, 69] }, // Dm7
  { bass: 34, pad: [46, 50, 53, 57], arp: [62, 65, 69, 74], stab: [62, 65, 69] }, // B♭maj7
  { bass: 41, pad: [53, 57, 60, 64], arp: [65, 69, 72, 76], stab: [65, 69, 72] }, // Fadd9
  { bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72], stab: [60, 64, 67] }, // Csus
];

const BOSS_CHORDS: SkyhookChord[] = [
  CHORDS[0],
  { bass: 39, pad: [51, 54, 58, 63], arp: [63, 66, 70, 75], stab: [63, 66, 70] }, // E♭6 / flat wind
  CHORDS[0],
  { bass: 36, pad: [48, 51, 55, 60], arp: [60, 63, 67, 72], stab: [60, 63, 67] }, // C minor lean
];

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

const SCORE_SECTIONS = [
  { index: 0, fromBar: SKYHOOK_V01U_BARS.storm },
  { index: 1, fromBar: SKYHOOK_V01U_BARS.cloudDeck, crossfadeBars: 1 },
  { index: 2, fromBar: SKYHOOK_V01U_BARS.stratosphere, crossfadeBars: 1 },
  { index: 3, fromBar: SKYHOOK_V01U_BARS.edge, crossfadeBars: 1 },
  { index: 4, fromBar: SKYHOOK_V01U_BARS.boss },
  { index: 5, fromBar: SKYHOOK_V01U_BARS.docking, crossfadeBars: 1 },
] as const;

// Every clean volley walks a melodic lane written in the current harmony.
// The lane is deliberately softer up top: the player remains the most
// articulate voice as the backing score thins out.
const KILL_LANES: Record<SectionIndex, number[]> = {
  0: [0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 7, 6, 5, 4, 2],
  1: [0, 2, 1, 3, 4, 2, 5, 3, 1, 4, 2, 6, 3, 5, 4, 7, 0, 2, 4, 6, 1, 3, 5, 7, 4, 2, 5, 3, 6, 4, 2, 1],
  2: [2, 3, 4, 5, 4, 3, 2, 1, 4, 5, 6, 7, 5, 4, 3, 2, 1, 2, 3, 4, 6, 5, 4, 3, 7, 6, 5, 4, 3, 2, 1, 0],
  3: [5, 4, 3, 2, 4, 3, 2, 1, 6, 5, 4, 3, 5, 4, 3, 2, 7, 6, 5, 4, 6, 5, 4, 3, 5, 4, 3, 1, 4, 3, 2, 0],
  4: [7, 6, 5, 4, 6, 5, 4, 3, 5, 4, 3, 2, 4, 3, 2, 1, 3, 2, 1, 0, 4, 3, 2, 1, 5, 6, 7, 6, 5, 6, 7, 4],
  5: [0, 2, 4, 5, 4, 2, 0, 1, 2, 4, 6, 7, 6, 4, 2, 1, 0, 2, 4, 5, 4, 2, 1, 0, 2, 3, 4, 5, 4, 2, 1, 0],
};

type PlayerVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  reverb: number;
};

const PLAYER_VOICES: Record<SectionIndex, { lock: PlayerVoice; kill: PlayerVoice; fire: { oscillator: OscillatorType; cutoff: number; gain: number; fall: number; noise: number } }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 3000, gain: 0.13, reverb: 0.3 },
    kill: { oscillator: 'triangle', decay: 0.34, cutoff: 2800, gain: 0.14, reverb: 0.48 },
    fire: { oscillator: 'triangle', cutoff: 2500, gain: 0.075, fall: 12, noise: 0.025 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 2600, gain: 0.095, reverb: 0.24 },
    kill: { oscillator: 'triangle', decay: 0.27, cutoff: 3000, gain: 0.13, reverb: 0.32 },
    fire: { oscillator: 'sawtooth', cutoff: 3300, gain: 0.065, fall: 9, noise: 0.035 },
  },
  2: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2200, gain: 0.052, reverb: 0.19 },
    kill: { oscillator: 'square', decay: 0.22, cutoff: 2450, gain: 0.095, reverb: 0.26 },
    fire: { oscillator: 'sawtooth', cutoff: 2900, gain: 0.055, fall: 7, noise: 0.04 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.075, cutoff: 1800, gain: 0.045, reverb: 0.12 },
    kill: { oscillator: 'sawtooth', decay: 0.19, cutoff: 2100, gain: 0.075, reverb: 0.2 },
    fire: { oscillator: 'square', cutoff: 2400, gain: 0.045, fall: 6, noise: 0.028 },
  },
  4: {
    lock: { oscillator: 'sawtooth', decay: 0.12, cutoff: 1500, gain: 0.05, reverb: 0.3 },
    kill: { oscillator: 'sawtooth', decay: 0.4, cutoff: 2300, gain: 0.11, reverb: 0.5 },
    fire: { oscillator: 'square', cutoff: 2100, gain: 0.052, fall: 13, noise: 0.035 },
  },
  5: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 3400, gain: 0.11, reverb: 0.58 },
    kill: { oscillator: 'triangle', decay: 0.58, cutoff: 3800, gain: 0.14, reverb: 0.7 },
    fire: { oscillator: 'triangle', cutoff: 3200, gain: 0.055, fall: 12, noise: 0.018 },
  },
};

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

function createSkyhookAudio(bus: EventBus) {
  let context: AudioContext | null = null;
  let bossId = -1;
  let bossMaxHp = 6;

  const score = createScore<SkyhookChord, SectionIndex>({
    bpm: SKYHOOK_V01U_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: SKYHOOK_V01U_BARS.boss, toBar: SKYHOOK_V01U_BARS.docking, chords: BOSS_CHORDS, barsPerChord: 2 }],
    sections: SCORE_SECTIONS,
    leadSet: (chord) => [...chord.arp, ...chord.arp.map((midi) => midi + 12)],
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    stepSeconds: STEP,
    stepsPerBar: STEPS_PER_BAR,
    score,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.78,
    mix: {
      compressor: { threshold: -19, ratio: 4.5, attack: 0.006, release: 0.28 },
      delay: { time: STEP * 3, feedback: 0.28, dampHz: 2600, sendGain: 0.8 },
      reverb: { seconds: 2.8, decay: 2.7, level: 0.42 },
      noiseSeconds: 2,
    },
    onPostBuild(nextContext) {
      context = nextContext;
    },
    onRunStart() {
      bossId = -1;
      bossMaxHp = 6;
    },
    onRunEnd() {
      const nextContext = runtime.context();
      const mix = runtime.mix();
      if (!nextContext || !mix?.reverbSend) return;
      const time = nextContext.currentTime + 0.05;
      pad(time, [50, 53, 57, 60, 64], 3.8, 0.5);
      bell(time + 0.18, 72, 0.5);
    },
    onDispose() {
      context = null;
    },
    onStep: scheduleStep,
  });

  const musicDestination = () => runtime.mix()?.duck ?? runtime.mix()?.music ?? null;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  const kickVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.22,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 43, time: time + 0.14 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.34 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });
  const bassVoice = voice<{ vel: number; growl: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.12 }, { type: 'sine', gain: 0.28, octave: -1 }],
    duration: 0.3,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ growl }) => 240 + growl * 580 },
    envelope: { attack: 0.005, decay: 0.3 },
  });
  const pluckVoice = voice<{ vel: number; cutoff: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: 0.1 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: 0.004, decay: ({ decay }) => decay },
  });
  const stabVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.045 }, { type: 'square', gain: 0.018, detune: 7 }],
    duration: 0.32,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 2300 },
    envelope: { attack: 0.004, decay: 0.32 },
  });
  const bellVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 0.16 }, { type: 'triangle', gain: 0.035, octave: 1 }],
    duration: 0.8,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: 4200 },
    envelope: { attack: 0.006, decay: 0.8 },
  });
  const lockVoice = voice<{ voice: PlayerVoice; velocity: number }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.035,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });
  const killVoice = voice<{ voice: PlayerVoice; velocity: number }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { attack: 0.004, decay: ({ voice }) => voice.decay },
  });
  const fireVoice = voice<{ fire: { oscillator: OscillatorType; cutoff: number; gain: number }; velocity: number }>({
    oscillators: [{ type: ({ fire }) => fire.oscillator, gain: ({ fire }) => fire.gain }],
    duration: 0.09,
    stopPadding: 0.025,
    filter: { type: 'lowpass', cutoff: ({ fire }) => fire.cutoff },
    envelope: { decay: 0.09 },
  });
  const rejectVoice = voice<{ velocity: number }>({
    oscillators: [{ type: 'square', gain: 0.13 }],
    duration: 0.22,
    stopPadding: 0.035,
    filter: { type: 'bandpass', Q: 5, frequency: 620 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.42, time: time + 0.18 }],
    gainAutomation: (time, _gain, { velocity }) => [
      { type: 'set', value: velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });
  const impactVoice = voice<{ velocity?: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.75,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 30, time: time + 0.52 }],
    gainAutomation: (time, _gain, { velocity = 1 }) => [
      { type: 'set', value: 0.45 * velocity, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.75 },
    ],
  });

  const noise = (time: number, velocity: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode | null) => {
    const mix = runtime.mix();
    if (!context || !mix?.noiseBuffer || !destination) return;
    playNoiseHit({ context, buffer: mix.noiseBuffer, time, velocity, decay, filterType, frequency, destination, offset: Math.random() * 1.4 });
  };

  const instruments = defineInstruments({ context: () => context }, {
    kick(nextContext, time, vel) {
      const destination = musicDestination();
      if (!destination) return;
      kickVoice.play({ context: nextContext, time, frequency: 122, vel, destination });
      noise(time, 0.055 * vel, 0.035, 'lowpass', 180, destination);
      runtime.mix()?.duckAt(time, 0.54, 0.12);
    },
    hat(_nextContext, time, vel, decay = 0.035) {
      const destination = musicDestination();
      if (destination) noise(time, vel, decay, 'highpass', 7200, destination);
    },
    bass(nextContext, time, midi, vel, growl = 0.25) {
      const destination = musicDestination();
      if (destination) bassVoice.play({ context: nextContext, time, midi, vel, growl, destination });
    },
    pad(nextContext, time, midis, duration, vel) {
      pad(time, midis, duration, vel, nextContext);
    },
    pluck(nextContext, time, midi, vel, cutoff = 2200, decay = 0.16) {
      const destination = musicDestination();
      const delay = runtime.mix()?.delaySend;
      if (!destination) return;
      pluckVoice.play({ context: nextContext, time, midi, vel, cutoff, decay, destination, sends: delay ? [{ destination: delay, gain: 0.32 }] : [] });
    },
    stab(nextContext, time, midis, vel) {
      const destination = musicDestination();
      const reverb = runtime.mix()?.reverbSend;
      if (!destination) return;
      for (const midi of midis) stabVoice.play({ context: nextContext, time, midi, vel, destination, sends: reverb ? [{ destination: reverb, gain: 0.32 }] : [] });
    },
    bell(nextContext, time, midi, vel) {
      const destination = musicDestination();
      const reverb = runtime.mix()?.reverbSend;
      if (!destination) return;
      bellVoice.play({ context: nextContext, time, midi, vel, destination, sends: reverb ? [{ destination: reverb, gain: 0.62 }] : [] });
    },
    riser(nextContext, time, duration, level = 0.12) {
      const destination = musicDestination();
      const buffer = runtime.mix()?.noiseBuffer;
      if (!destination || !buffer) return;
      playBufferSourceVoice({
        context: nextContext,
        buffer,
        time,
        stopTime: time + duration + 0.08,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.2,
          frequency: 240,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 5200, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration * 0.82 },
          { type: 'linearRamp', value: 0, time: time + duration + 0.04 },
        ],
        destination,
      });
    },
    impact(nextContext, time, vel = 1) {
      const destination = musicDestination();
      if (!destination) return;
      impactVoice.play({ context: nextContext, time, frequency: 180, velocity: vel, destination });
      noise(time, 0.18 * vel, 0.42, 'lowpass', 360, destination);
    },
  }, {
    kick: ['vel'],
    hat: ['vel', 'decay'],
    bass: ['midi', 'vel', 'growl'],
    pad: ['midis', 'duration', 'vel'],
    pluck: ['midi', 'vel', 'cutoff', 'decay'],
    stab: ['midis', 'vel'],
    bell: ['midi', 'vel'],
    riser: ['duration', 'level'],
    impact: ['vel'],
  });

  const { kick, hat, bass, pluck, stab, bell, riser, impact } = instruments;

  function pad(time: number, midis: number[], duration: number, velocity: number, nextContext = context) {
    const mix = runtime.mix();
    if (!nextContext || !mix?.duck || !mix.reverbSend) return;
    const length = Math.max(0.08, duration);
    for (const midi of midis) {
      for (const detune of [-6, 6]) {
        const oscillator = nextContext.createOscillator();
        const filter = nextContext.createBiquadFilter();
        const gain = nextContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = midiToFreq(midi);
        oscillator.detune.value = detune;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(520, time);
        filter.frequency.linearRampToValueAtTime(1350, time + Math.min(1.8, length * 0.45));
        filter.frequency.linearRampToValueAtTime(620, time + length);
        const level = 0.028 * velocity / Math.sqrt(Math.max(1, midis.length / 3));
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(level, time + Math.min(0.45, length * 0.18));
        gain.gain.setValueAtTime(level, time + Math.max(0.05, length - 0.5));
        gain.gain.linearRampToValueAtTime(0.001, time + length);
        oscillator.connect(filter).connect(gain).connect(mix.duck);
        const send = nextContext.createGain();
        send.gain.value = 0.62;
        gain.connect(send).connect(mix.reverbSend);
        oscillator.start(time);
        oscillator.stop(time + length + 0.06);
      }
    }
  }

  const playerToneVoice = voice<{ voice: PlayerVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });
  const playerBodyVoice = voice<{ decay: number; gainValue: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.54 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.82 },
    ],
  });
  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.12 }],
    duration: 0.18,
    stopPadding: 0.025,
    filter: { type: 'lowpass', cutoff: 2600 },
    envelope: { decay: 0.18 },
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = runtime.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function layersFor(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill') {
    return mix.from === mix.to
      ? [[mix.to, 1, PLAYER_VOICES[mix.to][slot]] as const]
      : [[mix.from, 1 - mix.t, PLAYER_VOICES[mix.from][slot]] as const, [mix.to, mix.t, PLAYER_VOICES[mix.to][slot]] as const];
  }

  function playerTone(time: number, midi: number, voiceSpec: PlayerVoice, velocity: number, weight = 1) {
    const destination = sfxDestination();
    if (!context || !destination || weight < 0.015) return;
    playerToneVoice.play({ context, time, midi, voice: voiceSpec, velocity, weight, destination, sends: playerSends(0.3, voiceSpec.reverb) });
  }

  function killNote(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const destination = sfxDestination();
    if (!context || !destination) return;
    const section = mix.t >= 0.5 ? mix.to : mix.from;
    const lead = score.leadSetAt(position);
    const midi = lead[KILL_LANES[section][position % KILL_LANES[section].length]];
    if (midi === undefined) return;
    const velocity = Math.min(1.35, 1 + chain * 0.13);
    for (const [_section, weight, voiceSpec] of layersFor(mix, 'kill')) {
      playerTone(time, midi, voiceSpec, velocity, weight);
    }
    const active = PLAYER_VOICES[section].kill;
    playerBodyVoice.play({ context, time, midi, decay: active.decay, gainValue: active.gain, velocity, destination });
    if (chain >= 2) playerTone(time + THIRTYSECOND, midi + 12, active, velocity * 0.6, 0.9);
    noise(time, 0.018 + active.reverb * 0.028, 0.08, 'highpass', 6800, destination);
  }

  function bossChip(time: number, intensity: number) {
    const destination = sfxDestination();
    if (!context || !destination) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.52,
      oscillatorType: 'sine',
      frequency: midiToFreq(chord.bass + 24),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.14 }],
      gainAutomation: [
        { type: 'set', value: 0.18 + intensity * 0.2, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.46 },
      ],
      destination,
    });
    chipVoice.play({ context, time, midi: chord.stab[Math.floor(intensity * 2) % chord.stab.length] + 12, vel: 0.8 + intensity, destination, sends: playerSends(0.24, 0.46) });
    playerTone(time + THIRTYSECOND, score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))], PLAYER_VOICES[4].kill, 0.42 + intensity * 0.5);
    noise(time, 0.055 + intensity * 0.11, 0.12, 'bandpass', 1100 + intensity * 2800, destination);
  }

  function bossFinale(time: number) {
    const destination = sfxDestination();
    const mix = runtime.mix();
    if (!context || !destination || !mix?.duck) return;
    mix.duckAt(time, 0.16, 1.7);
    impact(time, 1.25);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time + THIRTYSECOND, chord.stab.map((midi) => midi + 12), 1.1);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      playerTone(time + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[4].kill, 0.88 - index * 0.065);
    });
    riser(time, 0.75, 0.16);
  }

  bus.on('lock', ({ lockCount }) => {
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    for (const [_section, weight, voiceSpec] of layersFor(mix, 'lock')) playerTone(time, midi, voiceSpec, 1, weight);
    noise(time, 0.012 + mix.t * 0.018, 0.025, 'highpass', 7800, sfxDestination());
  });

  bus.on('unlock', () => {
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[mix.to].lock, 0.3);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const from = PLAYER_VOICES[mix.from].fire;
    const to = PLAYER_VOICES[mix.to].fire;
    const fire = {
      oscillator: mix.t < 0.5 ? from.oscillator : to.oscillator,
      cutoff: lerp(from.cutoff, to.cutoff, mix.t),
      gain: lerp(from.gain, to.gain, mix.t),
      fall: lerp(from.fall, to.fall, mix.t),
      noise: lerp(from.noise, to.noise, mix.t),
    };
    const source = score.chordAt(position).arp[(indexInVolley ?? 0) % 4] + 24;
    const destination = sfxDestination();
    if (!destination) return;
    fireVoice.play({ context, time, midi: source, fire, velocity: 1, destination, sends: playerSends(0.16, 0.1), frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(source - fire.fall), time: time + 0.068 }] });
    noise(time, fire.noise, 0.026, 'highpass', 4200, sfxDestination());
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !context) return;
    const time = score.nextGridTime(context.currentTime, 0.5);
    if (enemyId === bossId) {
      bossMaxHp = Math.max(bossMaxHp, hitPointsRemaining + 1);
      bossChip(time, 1 - hitPointsRemaining / bossMaxHp);
      return;
    }
    const destination = sfxDestination();
    if (!destination) return;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    chord.stab.forEach((midi, index) => chipVoice.play({ context: context!, time: time + index * THIRTYSECOND, midi: midi + 12, vel: 0.55 - index * 0.08, destination, sends: playerSends(0.18, 0.24) }));
    noise(time, 0.035, 0.04, 'highpass', 5600, destination);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (!context || enemyId !== bossId) return;
    const time = score.nextGridTime(context.currentTime, 1);
    impact(time, 0.62 + stageIndex * 0.16);
    riser(time, 0.9, 0.12 + stageIndex * 0.025);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!context) return;
    if (enemyId === bossId) {
      bossFinale(score.nextGridTime(context.currentTime, 2));
      return;
    }
    const kill = score.nextKill(context.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!context || !mix?.duck || size < 4 || kills < size) return;
    const time = score.nextGridTime(context.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    stab(time, score.chordAt(position).stab.map((midi) => midi + 12), size >= 6 ? 1 : 0.72);
    noise(time, 0.075, 0.26, 'highpass', 6500, mix.duck);
  });

  bus.on('reject', () => {
    if (!context) return;
    const destination = sfxDestination();
    if (!destination) return;
    const time = context.currentTime;
    rejectVoice.play({ context, time, frequency: 247, velocity: 0.16, destination });
    rejectVoice.play({ context, time: time + 0.025, frequency: 233, velocity: 0.11, destination });
    noise(time, 0.12, 0.1, 'bandpass', 560, destination);
  });

  bus.on('playerhit', () => {
    if (!context) return;
    const destination = sfxDestination();
    if (!destination) return;
    const time = context.currentTime;
    impact(time, 0.72);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.23,
      oscillatorType: 'square',
      frequency: midiToFreq(chord.stab[0]),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.stab[0] - 2), time: time + 0.18 }],
      gainAutomation: [{ type: 'set', value: 0.075, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.2 }],
      destination,
    });
    noise(time, 0.2, 0.16, 'bandpass', 820, destination);
  });

  bus.on('miss', () => {
    if (!context) return;
    const destination = sfxDestination();
    if (!destination) return;
    const time = context.currentTime;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + 0.18,
      oscillatorType: 'sine',
      frequency: 156,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 74, time: time + 0.14 }],
      gainAutomation: [{ type: 'set', value: 0.045, time }, { type: 'exponentialRamp', value: 0.001, time: time + 0.16 }],
      destination,
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 0.5);
    if (kind === 'skyhook') {
      bossId = enemyId;
      const mix = runtime.mix();
      if (!mix?.duck) return;
      impact(time, 1.05);
      riser(time, 2.4, 0.19);
      pad(time + 0.25, [39, 51, 58, 63], 2.6, 0.42);
    } else if (kind === 'carclaw') {
      const position = score.arrangementPositionAt(time);
      const midi = score.leadSetAt(position)[enemyId % 4];
      bell(time, midi, 0.22);
    }
  });

  function scheduleStep({ position, time, bar, step: stepInBar, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
    // One high, lonely beacon every four bars after the weather thins. It is
    // scheduled here rather than in gameplay so its silence is musical.
    if (mode === 'run' && bar >= SKYHOOK_V01U_BARS.stratosphere && bar < SKYHOOK_V01U_BARS.boss && stepInBar === 0 && bar % 4 === 0) {
      const chord = score.chordAt(position);
      bell(time, chord.arp[3] + 12, bar >= SKYHOOK_V01U_BARS.edge ? 0.2 : 0.28);
    }
  }

  const ambientArrangement = createArrangement<SkyhookChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'hangar-ambient',
      fromBar: 0,
      tracks: [
        hits('P...............' + '................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, STEP * 30, 0.34)),
        hits('....b...........', { b: 0.22 }, ({ time, chord }, velocity) => bell(time, chord.arp[1], velocity)),
      ],
    }],
  });

  const runArrangement = createArrangement<SkyhookChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'storm',
        fromBar: SKYHOOK_V01U_BARS.storm,
        toBar: SKYHOOK_V01U_BARS.cloudDeck,
        tracks: [
          hits('P...............' + '................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, STEP * 30, 0.58)),
          hits('K...............', { K: 0.6 }, ({ time }, velocity) => kick(time, velocity)),
          hits('....h.......h...', { h: 0.055 }, ({ time }, velocity) => hat(time, velocity, 0.12)),
          fn(({ time, step }) => { if (step === 6) noise(time, 0.018, 0.2, 'bandpass', 430, musicDestination()); }),
        ],
      },
      {
        name: 'cloud-deck',
        fromBar: SKYHOOK_V01U_BARS.cloudDeck,
        toBar: SKYHOOK_V01U_BARS.stratosphere,
        tracks: [
          hits('P...............' + '................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, STEP * 28, 0.46)),
          hits('K...k...K...k...', { K: 0.92, k: 0.68 }, ({ time }, velocity) => kick(time, velocity)),
          hits('..h...h...h...h.', { h: 0.055 }, ({ time }, velocity) => hat(time, velocity, 0.03)),
          hits('B.......B.......', { B: 0.72 }, ({ time, chord }, velocity) => bass(time, chord.bass, velocity, 0.42)),
          hits('..A...A...A...A.', { A: 0.58 }, ({ time, step: stepInBar, chord }, velocity) => pluck(time, chord.arp[(stepInBar / 4) % chord.arp.length], velocity, 2500, 0.12)),
        ],
      },
      {
        name: 'stratosphere',
        fromBar: SKYHOOK_V01U_BARS.stratosphere,
        toBar: SKYHOOK_V01U_BARS.edge,
        tracks: [
          hits('P...............' + '................', { P: 0.72 }, ({ time, chord }) => pad(time, chord.pad, STEP * 28, 0.28)),
          hits('K.......K.......', { K: 0.72 }, ({ time }, velocity) => kick(time, velocity)),
          hits('....h.......h...', { h: 0.035 }, ({ time }, velocity) => hat(time, velocity, 0.05)),
          hits('B...............', { B: 0.42 }, ({ time, chord }, velocity) => bass(time, chord.bass, velocity, 0.18)),
          hits('A.......A.......', { A: 0.34 }, ({ time, step: stepInBar, chord }, velocity) => pluck(time, chord.arp[(stepInBar / 8) % chord.arp.length] + 12, velocity, 1700, 0.18)),
        ],
      },
      {
        name: 'edge',
        fromBar: SKYHOOK_V01U_BARS.edge,
        toBar: SKYHOOK_V01U_BARS.boss,
        tracks: [
          hits('P...............' + '................', { P: 0.42 }, ({ time, chord }) => pad(time, chord.pad, STEP * 30, 0.16)),
          hits('K...............', { K: 0.42 }, ({ time }, velocity) => kick(time, velocity)),
          hits('........A.......', { A: 0.24 }, ({ time, chord }, velocity) => pluck(time, chord.arp[3] + 12, velocity, 1500, 0.22)),
          oneShot(6, 0, ({ time }) => riser(time, STEP * 32, 0.14)),
        ],
      },
      {
        name: 'boss-tether',
        fromBar: SKYHOOK_V01U_BARS.boss,
        toBar: SKYHOOK_V01U_BARS.docking,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 1.1)),
          hits('K.......K...k...', { K: 1, k: 0.78 }, ({ time }, velocity) => kick(time, velocity)),
          hits('B...B.......B...', { B: 0.74 }, ({ time, chord }, velocity) => bass(time, chord.bass, velocity, 0.85)),
          hits('....h.......h...', { h: 0.044 }, ({ time }, velocity) => hat(time, velocity, 0.06)),
          hits('A.......A.......', { A: 0.28 }, ({ time, chord }, velocity) => pluck(time, chord.arp[1] + 12, velocity, 1300, 0.28)),
          fn(({ time, step: stepInBar, chord }) => {
            if (stepInBar === 0 || stepInBar === 8) bell(time, chord.stab[(stepInBar / 8) % chord.stab.length] + 12, 0.18);
          }),
        ],
      },
      {
        name: 'docking',
        fromBar: SKYHOOK_V01U_BARS.docking,
        toBar: SKYHOOK_V01U_BARS.end,
        tracks: [
          hits('P...............' + '................', { P: 1 }, ({ time, chord, bar }) => pad(time, chord.pad, STEP * 28, 0.48 * Math.max(0, 1 - (bar - SKYHOOK_V01U_BARS.docking) * 0.18))),
          hits('K...............', { K: 0.3 }, ({ time, bar }, velocity) => kick(time, velocity * Math.max(0, 1 - (bar - SKYHOOK_V01U_BARS.docking) * 0.28))),
          hits('A.......A.......', { A: 0.2 }, ({ time, chord, bar }, velocity) => bell(time, chord.arp[2] + 12, velocity * Math.max(0, 1 - (bar - SKYHOOK_V01U_BARS.docking) * 0.2))),
          oneShot(0, 0, ({ time, chord }) => stab(time, chord.pad.map((midi) => midi + 12), 0.46)),
        ],
      },
    ],
  });

  return runtime;
}
