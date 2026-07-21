import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSkyhookVoices, installSkyhookWind, type SkyhookTonalVoice } from './audio-voices';
import {
  SKYHOOK_BARS,
  SKYHOOK_GGL2_BPM,
  SKYHOOK_GGL2_RUN_DURATION,
  SKYHOOK_GGL2_STEPS_PER_BAR,
  SKYHOOK_GGL2_TIME,
} from './gameplay';

// The Skyhook score: 120 BPM, 32 bars = exactly the 64-second climb, in D. The
// arrangement runs backwards from the usual build: it is at its widest and
// warmest down in the weather and *loses layers* as the air thins, so that by
// the boss up top the music is barely there — a low tolling bell and a drone,
// leaving the player's own guns as the loudest melodic voice in the sky. The
// climb resolves A→D as the station swallows the car and everything goes quiet.

const SIXTEENTH = SKYHOOK_GGL2_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SKYHOOK_GGL2_STEPS_PER_BAR;
const TWO_BARS = STEPS_PER_BAR * 2 * SIXTEENTH;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// D — G — Bm — A, two bars each: an open I–IV–vi–V that keeps lifting.
const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 66], arp: [62, 66, 69, 74], stab: [62, 66, 69] }, // D
  { bass: 43, pad: [55, 62, 67, 71], arp: [67, 71, 74, 79], stab: [67, 71, 74] }, // G
  { bass: 35, pad: [47, 54, 59, 62], arp: [59, 62, 66, 71], stab: [59, 62, 66] }, // Bm
  { bass: 33, pad: [45, 52, 57, 61], arp: [57, 61, 64, 69], stab: [57, 61, 64] }, // A
];

type SectionIndex = 0 | 1 | 2 | 3;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Weather: slow rising arches, wide and airy.
  0: [
    0, 1, 2, 3, 2, 1, 2, 4,
    3, 2, 3, 4, 5, 4, 3, 2,
    2, 3, 4, 5, 4, 3, 4, 5,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Blue: bright leaps up as the sky opens.
  1: [
    2, 5, 3, 6, 4, 7, 5, 3,
    4, 7, 5, 2, 6, 4, 7, 5,
    0, 4, 2, 5, 3, 6, 4, 7,
    5, 6, 7, 4, 6, 5, 7, 4,
  ],
  // Thin: high, sparse fragments that leave the register open.
  2: [
    5, 6, 7, 5, 4, 6, 5, 7,
    6, 7, 5, 6, 4, 5, 7, 6,
    7, 6, 5, 7, 6, 4, 5, 3,
    5, 6, 7, 6, 5, 6, 7, 4,
  ],
  // Descent: tolling descents answered by climbs — the player over the boss.
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    3, 2, 1, 0, 4, 3, 2, 1,
    4, 5, 6, 7, 5, 6, 7, 4,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: SkyhookTonalVoice; kill: SkyhookTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.12, cutoff: 3400, gain: 0.11, sparkle: 0.5, reverb: 0.26 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3000, gain: 0.15, sparkle: 0.7, reverb: 0.34 },
    fire: { oscillator: 'triangle', cutoff: 3200, gain: 0.06, fallSemitones: 12, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 4200, gain: 0.1, sparkle: 0.6, reverb: 0.24 },
    kill: { oscillator: 'triangle', decay: 0.26, cutoff: 4400, gain: 0.15, sparkle: 0.85, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 4200, gain: 0.06, fallSemitones: 7, noise: 0.035 },
  },
  2: {
    lock: { oscillator: 'sine', decay: 0.11, cutoff: 4800, gain: 0.09, sparkle: 0.5, reverb: 0.4 },
    kill: { oscillator: 'sine', decay: 0.34, cutoff: 5000, gain: 0.14, sparkle: 0.9, reverb: 0.46 },
    fire: { oscillator: 'sine', cutoff: 5200, gain: 0.055, fallSemitones: 12, noise: 0.02 },
  },
  3: {
    lock: { oscillator: 'sine', decay: 0.14, cutoff: 3000, gain: 0.1, sparkle: 0.35, reverb: 0.5 },
    kill: { oscillator: 'sine', decay: 0.42, cutoff: 3400, gain: 0.16, sparkle: 0.7, reverb: 0.56 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.06, fallSemitones: 13, noise: 0.03 },
  },
};

// A short bell figure that rings out over the sunlit-blue movement.
const BLUE_BELL: Array<[number, number, number]> = [
  [0, 0, 2], [0, 6, 3], [1, 2, 4], [1, 8, 5],
  [2, 0, 5], [2, 8, 6], [3, 4, 7], [3, 10, 5],
];

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-ggl2',
  bpm: SKYHOOK_GGL2_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_GGL2_RUN_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let bossId = -1;
  let bossMaxHp = 0;
  let bossDrone: { gain: GainNode; filter: BiquadFilterNode; oscs: OscillatorNode[] } | null = null;
  let windGain: GainNode | null = null;

  const score = createScore<Chord, SectionIndex>({
    bpm: SKYHOOK_GGL2_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: [
      { index: 0, fromBar: SKYHOOK_BARS.launch },
      { index: 1, fromBar: SKYHOOK_BARS.blue, crossfadeBars: 2 },
      { index: 2, fromBar: SKYHOOK_BARS.thin, crossfadeBars: 2 },
      { index: 3, fromBar: SKYHOOK_BARS.descent, crossfadeBars: 2 },
    ],
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.82,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2600 },
      reverb: { seconds: 3.0, decay: 2.4, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      windGain = installSkyhookWind(context, mix);
    },
    onStep: scheduleStep,
    onRunStart() {
      bossId = -1;
      bossMaxHp = 0;
      stopBossDrone(0);
      if (windGain && ctx) {
        windGain.gain.cancelScheduledValues(ctx.currentTime);
        windGain.gain.setValueAtTime(0.09, ctx.currentTime);
      }
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) {
        // Docked: a soft resolved D settling into quiet.
        pad(context.currentTime + 0.05, [38, 50, 57, 62], 5, 0.7);
        if (windGain) {
          windGain.gain.cancelScheduledValues(context.currentTime);
          windGain.gain.setTargetAtTime(0.015, context.currentTime, 1.2);
        }
      }
    },
    onDispose() {
      ctx = null;
      bossDrone = null;
      windGain = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement ----------------------------------------------------------

  const blank = '................';
  const softHat = 'h...h...h...h...';
  const airHat = 'h.h.h.h.h.h.h.h.';
  const busyHat = 'h.H.h.H.h.H.h.H.';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(bar / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 2 === 0) pad(time, chord.pad, TWO_BARS * 1.05, 0.6); }),
          hits('A...A...A...A...', { A: 0.4 }, ({ time, step, chord }) => arp(time, chord.arp[(step / 4) % chord.arp.length], 0.4)),
        ],
      },
    ],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        // Weather: the widest the mix gets — full airy kit, warm sub, big pad.
        name: 'weather',
        fromBar: SKYHOOK_BARS.launch,
        tracks: [
          hits('K.......k.......', { K: 0.9, k: 0.7 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.7 }, ({ time }, vel) => snare(time, vel)),
          hits(airHat, { h: 0.03 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits('B.....B...B.....', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel)),
          hits('A.A.A.A.A.A.A.A.', { A: 0.5 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length], vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 2 === 0) pad(time, chord.pad, TWO_BARS * 1.04, 0.8); }),
        ],
      },
      {
        // Blue: punch through the deck, then open — a bright bell over the kit.
        name: 'blue',
        fromBar: SKYHOOK_BARS.blue,
        tracks: [
          oneShot(0, 0, ({ time }) => { impact(time, 1); riser(time, TWO_BARS, 0.16); }),
          hits('K.......k...k...', { K: 0.95, k: 0.7 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.75 }, ({ time }, vel) => snare(time, vel)),
          hits(busyHat, { h: 0.03, H: 0.05 }, ({ time }, vel) => hat(time, vel, 0.028)),
          hits('B.....B...B...B.', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel)),
          hits(airHat.replace(/h/g, 'A'), { A: 0.42 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length], vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 2 === 0) pad(time, chord.pad, TWO_BARS * 1.02, 0.7); }),
          fn(({ time, step, bar, chord }) => {
            const themeBar = (bar - SKYHOOK_BARS.blue) % 4;
            for (const [b, s, degree] of BLUE_BELL) {
              if (b === themeBar && s === step) bell(time, chord.arp[degree % chord.arp.length] + 12, 0.9);
            }
          }),
        ],
      },
      {
        // Thin: layers fall away. Soft pulse, high sparse arp, huge pad.
        name: 'thin',
        fromBar: SKYHOOK_BARS.thin,
        tracks: [
          hits('K.......k.......', { K: 0.62, k: 0.42 }, ({ time }, vel) => kick(time, vel)),
          hits(softHat, { h: 0.022 }, ({ time }, vel) => hat(time, vel, 0.04)),
          hits('A.......A....A..', { A: 0.34 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel)),
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 2 === 0) pad(time, chord.pad, TWO_BARS * 1.08, 0.85); }),
          oneShot(0, 0, ({ time }) => riser(time, TWO_BARS, 0.12)),
        ],
      },
      {
        // Descent: barely there. A low tolling bell and a drone under the boss.
        name: 'descent',
        fromBar: SKYHOOK_BARS.descent,
        toBar: SKYHOOK_BARS.dock,
        tracks: [
          hits('K...............', { K: 0.5 }, ({ time, bar }, vel) => { if (bar % 2 === 0) kick(time, vel); }),
          fn(({ time, step, bar, chord }) => { if (step === 0) toll(time, chord.bass, bar % 2 === 0 ? 0.9 : 0.6); }),
          fn(({ time, step, bar, chord }) => { if (step === 0 && bar % 4 === 0) pad(time, chord.pad, TWO_BARS * 2.1, 0.55); }),
          hits('........A.......', { A: 0.22 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel)),
        ],
      },
      {
        // Dock: the station swallows the car; the last swell settles to quiet.
        name: 'dock',
        fromBar: SKYHOOK_BARS.dock,
        toBar: SKYHOOK_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time }) => { impact(time, 0.5); pad(time, [38, 45, 50, 57], TWO_BARS * 1.4, 0.7); }),
          oneShot(1, 0, ({ time }) => bell(time, 62, 0.6)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ----------------------------------------------------------------

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, snare, hat, bass, pad, arp, bell, toll, riser, impact, crash, noiseHit, playerSends, playerTone, playerNoise } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.32 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.08,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const hitTickVoice = voice<{ cutoff: number; gainValue: number; decay: number; stopPadding: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: ({ stopPadding }) => stopPadding,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.18 }],
    duration: 0.2,
    stopPadding: 0.04,
    envelope: { decay: 0.2 },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 4, frequency: 820 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const playerHitStabVoice = voice({
    oscillators: [{ type: 'square', gain: 0.06 }],
    duration: 0.13,
    stopPadding: 0.03,
    envelope: { decay: 0.13 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.13,
    stopPadding: 0.02,
    envelope: { decay: 0.13 },
  });

  const warnVoice = voice({
    oscillators: [{ type: 'triangle' }],
    duration: 0.42,
    stopPadding: 0.04,
    gainAutomation: (time) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.05, time: time + 0.28 },
      { type: 'linearRamp', value: 0, time: time + 0.42 },
    ],
  });

  // ---- boss escalating voice -------------------------------------------------

  function startBossDrone(time: number) {
    const context = ctx;
    const mix = runtime.mix();
    if (!context || !mix?.duck || !mix.reverbSend) return;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, time);
    filter.Q.value = 3;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.05, time + 1.4);
    const oscs: OscillatorNode[] = [];
    for (const [midi, detune] of [[26, -6], [26, 7], [38, 0]] as const) {
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      oscs.push(osc);
    }
    filter.connect(gain).connect(mix.duck);
    const send = context.createGain();
    send.gain.value = 0.5;
    gain.connect(send).connect(mix.reverbSend);
    bossDrone = { gain, filter, oscs };
  }

  function escalateBossDrone(time: number, intensity: number) {
    if (!bossDrone || !ctx) return;
    bossDrone.gain.gain.cancelScheduledValues(time);
    bossDrone.gain.gain.setTargetAtTime(0.05 + intensity * 0.14, time, 0.2);
    bossDrone.filter.frequency.setTargetAtTime(300 + intensity * 1400, time, 0.2);
    for (const osc of bossDrone.oscs) osc.detune.setTargetAtTime((osc.detune.value ?? 0) + intensity * 4, time, 0.3);
  }

  function stopBossDrone(time: number) {
    if (!bossDrone) return;
    const drone = bossDrone;
    bossDrone = null;
    if (!ctx) return;
    drone.gain.gain.cancelScheduledValues(time);
    drone.gain.gain.setTargetAtTime(0.0001, time, 0.12);
    for (const osc of drone.oscs) osc.stop(time + 0.6);
  }

  function bossFinale(time: number) {
    const context = ctx;
    const mix = runtime.mix();
    if (!context || !mix?.duck) return;
    stopBossDrone(time);
    mix.duckAt(time, 0.16, 1.4);
    impact(time, 1.2);
    crash(time, 0.3);
    // A conclusive climb resolving up to D, the player's instrument on top.
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[3].kill, 0.85 - index * 0.08, 1);
    });
    pad(time + 0.06, [38, 50, 57, 62, 66], 4, 0.9);
    riser(time, 0.7, 0.12);
  }

  // ---- player instruments ----------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof SkyhookTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = score.leadSetAt(position);
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = leadSet[degree];
    const vel = Math.min(1.4, 1 + chain * 0.14);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.4, 0.2) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkle * 0.05, 0.09, 8200);
  }

  function bossChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    escalateBossDrone(time, intensity);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: root * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.22 + intensity * 0.18, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.44 },
      ],
      destination: output,
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES[3].kill, 0.4 + intensity * 0.35, 1);
    playerNoise(time, 0.08 + intensity * 0.08, 0.1, 5400);
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].lock, 1, weight);
    }
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.012 + sparkle * 0.03, 0.025, 9200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.15 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.32, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fv = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: fv.oscillator,
        cutoff: fv.cutoff,
        gainValue: fv.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fv.fallSemitones), time: time + 0.07 }],
        destination: output,
        sends: playerSends(0.16, 0.1),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.026, 5200);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === bossId) {
      bossMaxHp = Math.max(bossMaxHp, hitPointsRemaining + 1);
      bossChip(time, 1 - hitPointsRemaining / Math.max(1, bossMaxHp));
      return;
    }
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      const at = time + index * THIRTYSECOND;
      hitTickVoice.play({
        context,
        time: at,
        midi: midi + 12,
        cutoff: 3800,
        gainValue: 0.05 - index * 0.008,
        decay: 0.09,
        stopPadding: 0.02,
        destination: output,
        sends: playerSends(0.2, 0.18),
      });
    }
    playerNoise(time, 0.04, 0.035, 5800);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output || !runtime.mix()?.reverbSend) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.18, 0.13, 2800);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageVoice.play({ context: ctx, time, midi, gainValue: 0.13, decay: 0.6, destination: output, sends: playerSends(0.26, 0.55) });
    }
    if (enemyId === bossId) riser(time, 1.4, 0.16);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === bossId) {
      bossFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const toSection = score.sectionMixAt(position).to;
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[toSection].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A cold clank with a minor-second snarl — a rejected release, no reward.
    for (const [frequency, at, vel] of [[220, time, 0.16], [233, time + 0.02, 0.12]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.4, time: at + 0.16 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.08, 'bandpass', 600, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.32 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      playerHitStabVoice.play({ context, time: time + index * 0.13, midi, destination: output, sends: playerSends(0.12, 0.08) });
    });
    noiseHit(time, 0.2, 0.16, 'bandpass', 760, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.11 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'descender') {
      bossId = enemyId;
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      startBossDrone(time);
      riser(time, 2.0, 0.18);
    } else if (kind === 'grapnel') {
      // Car-threat warning: a short upward siren from the live harmony.
      const output = sfxDestination();
      if (!output) return;
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      const sourceMidi = leadSet[enemyId % 4];
      warnVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi + 12), time: time + 0.34 }],
        destination: output,
        sends: playerSends(0.16, 0.16),
      });
    }
  });

  return runtime;
}
