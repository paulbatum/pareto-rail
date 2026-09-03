import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playNoiseHit,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, hits, oneShot } from '../../engine/arrangement';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  BROADSIDE_AMR2_BARS,
  BROADSIDE_AMR2_BPM,
  BROADSIDE_AMR2_SCORE_SECTIONS,
  BROADSIDE_AMR2_TIME,
} from './gameplay';

// Broadside is scored like space opera: full brass and strings over
// timpani, swelling with each push and dropping to near silence in the eye
// of the battle. The hidden kill-melody lane makes the player the soloist:
// every kill plays the written lane note for its grid step, so a chained
// volley performs a real melodic run over the live harmony.

const TIME = BROADSIDE_AMR2_TIME;
const SIXTEENTH = TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = TIME.stepsPerBar;
const LANE_STEPS = 32;

// D minor epic: i – VI – III – VII, two bars per chord.
const CHORDS = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 72] }, // Dm
  { bass: 34, pad: [46, 50, 53, 58], arp: [58, 62, 65, 70] }, // Bb
  { bass: 29, pad: [45, 48, 53, 57], arp: [57, 60, 65, 69] }, // F
  { bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72] }, // C
];
type Chord = typeof CHORDS[number];
const LOCK_SCALE = [62, 65, 67, 69, 72, 74, 77, 81]; // D minor, rising per lock

type SectionIndex = 0 | 1 | 2;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Launch and broadside: a rising fanfare arch.
  0: [
    0, 1, 2, 3, 4, 3, 2, 1,
    2, 3, 4, 5, 4, 3, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 5,
    4, 5, 4, 3, 2, 1, 2, 0,
  ],
  // Belly and eye: a restless broken-chord zig-zag.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    2, 6, 3, 7, 4, 0, 5, 1,
    6, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Flagship and trench: tolling high peals answered by a climb.
  2: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
};

const SECTION_VOICES: Record<SectionIndex, {
  kill: { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number };
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'triangle', decay: 0.46, cutoff: 3200, gain: 0.17, shimmer: 0.35 },
    lock: { oscillator: 'triangle', cutoff: 2600, gain: 0.14 },
    fire: { cutoff: 1700, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.26, cutoff: 2500, gain: 0.15, shimmer: 0.5 },
    lock: { oscillator: 'square', cutoff: 1900, gain: 0.06 },
    fire: { cutoff: 3000, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.52, cutoff: 3000, gain: 0.16, shimmer: 0.7 },
    lock: { oscillator: 'sawtooth', cutoff: 2100, gain: 0.055 },
    fire: { cutoff: 4000, noise: 0.07 },
  },
};

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let coreId = -1;
  let coreMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: BROADSIDE_AMR2_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: BROADSIDE_AMR2_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2600 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      coreId = -1;
      coreMaxHp = 0;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (context) stringsPad(context.currentTime + 0.05, [50, 57, 62, 69], 5);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const musicDestination = () => runtime.mix()?.music ?? runtime.mix()?.master ?? null;

  function noise(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = ctx;
    const buffer = runtime.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    playNoiseHit({
      context,
      buffer,
      time,
      velocity: vel,
      decay,
      filterType,
      frequency,
      destination,
      loopStart: Math.random(),
      offset: Math.random() * 1.5,
    });
  }

  // ---- orchestra voices ----------------------------------------------------

  const timpaniVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.32,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 36, time: time + 0.22 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
    ],
  });

  const brassVoice = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5 },
      { type: 'sawtooth', gain: 0.5, detune: 7 },
      { type: 'sawtooth', gain: 0.35, detune: -8 },
    ],
    duration: 0.55,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 1700, Q: 1.2 },
    envelope: { attack: 0.03, decay: 0.5 },
  });

  const stringsVoice = voice<{ duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.4 },
      { type: 'sawtooth', gain: 0.4, detune: 5 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.15,
    filter: { type: 'lowpass', cutoff: 1500, Q: 0.7 },
    envelope: { attack: 0.5, decay: 1.2, sustain: 0.7, release: 1.0 },
  });

  const hornVoice = voice({
    oscillators: [{ type: 'triangle', gain: 0.8 }, { type: 'sine', gain: 0.5, octave: 1 }],
    duration: 0.9,
    stopPadding: 0.15,
    filter: { type: 'lowpass', cutoff: 2400 },
    envelope: { attack: 0.12, decay: 0.7, sustain: 0.5, release: 0.4 },
  });

  const snareVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.12,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 140, time: time + 0.08 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.3 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  function timpani(time: number, vel: number) {
    const destination = musicDestination();
    if (!ctx || !destination) return;
    timpaniVoice.play({ context: ctx, time, frequency: 58, vel, destination });
    noise(time, 0.05 * vel, 0.05, 'lowpass', 900, destination);
  }

  function brass(time: number, midi: number, vel: number, duration = 0.55) {
    const destination = musicDestination();
    if (!ctx || !destination) return;
    brassVoice.play({ context: ctx, time, midi, vel, duration, destination });
  }

  function stringsPad(time: number, midis: number[], duration: number) {
    const destination = musicDestination();
    if (!ctx || !destination) return;
    for (const midi of midis) {
      stringsVoice.play({ context: ctx, time, midi, duration, destination });
    }
  }

  function ostinato(time: number, midi: number, vel: number) {
    const destination = musicDestination();
    const mix = runtime.mix();
    if (!ctx || !destination || !mix?.delaySend) return;
    hornVoice.play({
      context: ctx,
      time,
      midi: midi + 12,
      duration: 0.16,
      destination,
      sends: [{ destination: mix.delaySend, gain: 0.3 }],
    });
    void vel;
  }

  function snare(time: number, vel: number) {
    const destination = musicDestination();
    if (!ctx || !destination) return;
    snareVoice.play({ context: ctx, time, frequency: 190, vel, destination });
    noise(time, 0.16 * vel, 0.09, 'bandpass', 1900, destination);
  }

  function cymbal(time: number, vel: number) {
    const destination = musicDestination();
    if (!ctx || !destination) return;
    noise(time, 0.2 * vel, 1.1, 'highpass', 6500, destination);
  }

  function riser(time: number, duration: number) {
    const destination = musicDestination();
    if (!ctx || !destination) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + duration + 0.1,
      oscillatorType: 'sawtooth',
      frequency: 110,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 880, time: time + duration }],
      filter: { type: 'lowpass', frequency: 900 },
      gainAutomation: [
        { type: 'set', value: 0.001, time },
        { type: 'exponentialRamp', value: 0.16, time: time + duration },
        { type: 'exponentialRamp', value: 0.001, time: time + duration + 0.08 },
      ],
      destination,
    });
    noise(time, 0.02, duration, 'highpass', 3000, destination);
  }

  // ---- arrangement ---------------------------------------------------------

  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const padOdd = blankBar + 'P...............';
  const timpaniDrive = 'T...t...T.t.T...';
  const timpaniDown = 'T...............';
  const brassOffbeats = '..B...B...B...B.';
  const brassPush = '..B.B.B...B.B.B.';
  const snareBackbeat = '....S.......S...';
  const ostinatoRun = 'o.o.o.o.o.o.o.o.';
  const ostinatoSparse = 'o.......o.......';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => stringsPad(time, chord.pad, 16 * 2 * SIXTEENTH)),
        hits('....h.......h...', { h: 0.4 }, ({ time, chord }) => {
          const destination = musicDestination();
          if (!ctx || !destination) return;
          hornVoice.play({ context: ctx, time, midi: chord.arp[0], destination });
        }),
      ],
    }],
  });

  const B = BROADSIDE_AMR2_BARS;
  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'launch', fromBar: B.launch, toBar: B.broadside,
        tracks: [
          padTrack(B.launch),
          hits(timpaniDown, { T: 0.9 }, ({ time }, vel) => timpani(time, vel)),
          hits(ostinatoSparse, { o: 0.5 }, ({ time, step, chord }, vel) => ostinato(time, chord.arp[(step / 8) % chord.arp.length], vel)),
        ],
      },
      {
        name: 'broadside', fromBar: B.broadside, toBar: B.belly,
        tracks: [
          padTrack(B.broadside),
          hits(timpaniDrive, { T: 1, t: 0.7 }, ({ time }, vel) => timpani(time, vel)),
          hits(snareBackbeat, { S: 0.9 }, ({ time }, vel) => snare(time, vel)),
          hits(brassOffbeats, { B: 0.8 }, ({ time, chord }, vel) => brass(time, chord.pad[2], vel)),
          hits(ostinatoRun, { o: 0.5 }, ({ time, step, chord }, vel) => ostinato(time, chord.arp[(step / 2) % chord.arp.length], vel)),
          hits('C...............', { C: 0.8 }, ({ time }, vel) => cymbal(time, vel)),
        ],
      },
      {
        name: 'belly', fromBar: B.belly, toBar: B.eye,
        tracks: [
          padTrack(B.belly),
          hits(timpaniDrive, { T: 1, t: 0.75 }, ({ time }, vel) => timpani(time, vel)),
          hits(snareBackbeat, { S: 1 }, ({ time }, vel) => snare(time, vel)),
          hits(brassPush, { B: 0.9 }, ({ time, chord }, vel) => brass(time, chord.pad[1] + 12, vel, 0.4)),
          hits(ostinatoRun, { o: 0.6 }, ({ time, step, chord }, vel) => ostinato(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel)),
        ],
      },
      {
        // The eye of the battle: near silence — low strings and a lone horn.
        name: 'eye', fromBar: B.eye, toBar: B.flagship,
        tracks: [
          hits('P...............' + blankBar, { P: 0.9 }, ({ time, chord }) => stringsPad(time, [chord.bass + 12, chord.pad[0]], 16 * 2 * SIXTEENTH)),
          hits('....h...........', { h: 0.55 }, ({ time, chord }) => {
            const destination = musicDestination();
            if (!ctx || !destination) return;
            hornVoice.play({ context: ctx, time, midi: chord.arp[3], duration: 1.6, destination });
          }),
          hits('........h.......', { h: 0.45 }, ({ time, chord }) => {
            const destination = musicDestination();
            if (!ctx || !destination) return;
            hornVoice.play({ context: ctx, time, midi: chord.arp[1] + 12, duration: 1.4, destination });
          }),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH)),
        ],
      },
      {
        name: 'flagship', fromBar: B.flagship, toBar: B.trench,
        tracks: [
          padTrack(B.flagship),
          hits(timpaniDrive, { T: 1, t: 0.8 }, ({ time }, vel) => timpani(time, vel)),
          hits(snareBackbeat, { S: 1 }, ({ time }, vel) => snare(time, vel)),
          hits(brassPush, { B: 1 }, ({ time, chord }, vel) => brass(time, chord.pad[2] + 12, vel, 0.4)),
          hits(ostinatoRun, { o: 0.65 }, ({ time, step, chord }, vel) => ostinato(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel)),
          hits('C...............', { C: 1 }, ({ time }, vel) => cymbal(time, vel)),
        ],
      },
      {
        name: 'trench', fromBar: B.trench, toBar: B.finale,
        tracks: [
          padTrack(B.trench),
          hits('T...t...T...t...', { T: 1, t: 0.8 }, ({ time }, vel) => timpani(time, vel)),
          hits(snareBackbeat, { S: 1 }, ({ time }, vel) => snare(time, vel)),
          hits(brassOffbeats, { B: 0.9 }, ({ time, chord }, vel) => brass(time, chord.pad[0] + 12, vel)),
          hits('o.o.o.o.o.o.o.o.', { o: 0.6 }, ({ time, step, chord }, vel) => ostinato(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel)),
          oneShot(4, 8, ({ time }) => riser(time, 8 * SIXTEENTH)),
        ],
      },
      {
        name: 'finale', fromBar: B.finale,
        tracks: [
          padTrack(B.finale),
          hits('T.......T.......', { T: 1 }, ({ time }, vel) => timpani(time, vel)),
          hits('C...............', { C: 1 }, ({ time }, vel) => cymbal(time, vel)),
          oneShot(0, 0, ({ time, chord }) => brass(time, chord.pad[2] + 12, 1, 1.4)),
          oneShot(1, 0, ({ time, chord }) => brass(time, chord.pad[0] + 12, 1, 2.2)),
        ],
      },
    ],
  });

  function padTrack(fromBar: number) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) => stringsPad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05));
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments --------------------------------------------

  const killLayerVoice = voice<{ killVoice: (typeof SECTION_VOICES)[SectionIndex]['kill'] }>({
    oscillators: [{ type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain }],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { decay: ({ killVoice }) => killVoice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.55 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.4 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 180 },
    envelope: { decay: 0.1 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.09 }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.14,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 4200 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const rejectVoice = voice<{ vel: number; filterStart: number; filterEnd: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.24,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 5,
      frequencyAutomation: (time, { filterStart, filterEnd }) => [
        { type: 'set', value: filterStart, time },
        { type: 'exponentialRamp', value: filterEnd, time: time + 0.18 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const impactBoomVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.4,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 34, time: time + 0.28 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.42, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
    ],
  });

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = SECTION_VOICES[sectionMix.from].kill;
    const toVoice = SECTION_VOICES[sectionMix.to].kill;
    const vel = Math.min(1.35, 1 + chain * 0.12);
    const decay = lerp(fromVoice.decay, toVoice.decay, sectionMix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, sectionMix.t);
    const shimmer = lerp(fromVoice.shimmer, toVoice.shimmer, sectionMix.t);

    const layers: Array<[typeof fromVoice, number]> = sectionMix.from === sectionMix.to
      ? [[toVoice, 1]]
      : [[fromVoice, 1 - sectionMix.t], [toVoice, sectionMix.t]];
    for (const [layerVoice, weight] of layers) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice: layerVoice,
        velocity: vel,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.45 }],
      });
    }
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: [{ destination: audioMix.delaySend, gain: 0.5 }] });
    }
    noise(time, 0.05 * shimmer + 0.03, 0.08, 'highpass', 5200, output);
  }

  // Striking the flagship core rings a deep ship's-bell that grows with the
  // damage dealt, while a beacon note climbs the live harmony toward the kill.
  function coreChip(intensity: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const rootFreq = midiToFreq(chord.bass + 12);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: rootFreq * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.26 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
      ],
      destination: output,
    });
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.26,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2200 + 2600 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.045 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.3 }],
      });
    }
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.6,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.07 + 0.07 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
      ],
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
    });
    noise(time, 0.12 + 0.08 * intensity, 0.06, 'bandpass', 1400, output);
  }

  // The killing blow: the orchestra ducks for a breath, a sub drop lands on
  // the tonic, and the victory theme peals in D major through the delay.
  function coreFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.duck) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);

    audioMix.duckAt(time, 0.2, 1.8);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1,
      oscillatorType: 'sine',
      frequency: 220,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 55, time: time + 0.45 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
      ],
      destination: output,
    });
    for (const midi of [38, 50, 57, 62]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.6,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 700, time },
              { type: 'linearRamp', value: 2600, time: time + 0.9 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.05, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.5 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }],
        });
      }
    }
    // Victory peal: D major rising from the tonic, ringing out.
    [62, 66, 69, 74, 78, 81, 86].forEach((midi, index) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.5,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 3800 },
        gainAutomation: [
          { type: 'set', value: 0.13 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }],
      });
    });
    noise(time, 0.14, 0.6, 'highpass', 6000, output);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === coreId) {
      coreFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    const layers: Array<[SectionIndex, number]> = sectionMix.from === sectionMix.to
      ? [[sectionMix.to, 1]]
      : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
    for (const [section, weight] of layers) {
      if (weight < 0.02) continue;
      const voiceSpec = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: voiceSpec.oscillator,
        cutoff: voiceSpec.cutoff,
        gainValue: voiceSpec.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    }
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const fromFire = SECTION_VOICES[sectionMix.from].fire;
    const toFire = SECTION_VOICES[sectionMix.to].fire;
    const fireSpec = {
      cutoff: lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t),
      noise: lerp(fromFire.noise, toFire.noise, sectionMix.t),
    };
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff: fireSpec.cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      destination: output,
    });
    noise(time, fireSpec.noise, 0.02, 'highpass', 3000, output);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      coreChip(1 - hitPointsRemaining / coreMaxHp);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.08], [1, 0.07], [2, 0.06]] as const).forEach(([index, vel]) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + THIRTYSECOND * index;
      chipVoice.play({ context: ctx, time: at, midi: arp[index] + 12, vel, destination: output, sends: [{ destination: delaySend, gain: 0.38 }] });
    });
    noise(time, 0.035, 0.035, 'highpass', 5600, output);
  });

  // A clean volley of four or more earns a brass flourish on the next beat.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2400 },
        gainAutomation: [
          { type: 'set', value: 0.055, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    }
    noise(time, 0.09, 0.3, 'highpass', 6800, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [start, end, at, vel] of [
      [330, 92, time, 0.18],
      [233, 61, time + 0.028, 0.13],
    ] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.2 }],
        vel,
        filterStart: 1100,
        filterEnd: 430,
        destination: output,
      });
    }
    noise(time, 0.15, 0.09, 'bandpass', 720, output);
    noise(time + 0.025, 0.07, 0.12, 'highpass', 2400, output);
  });

  // Hull hit: a low impact boom under a dissonant tritone stab.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    impactBoomVoice.play({ context: ctx, time, frequency: 96, destination: output });
    for (const midi of [62, 68]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.24,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.07, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
        ],
        destination: output,
      });
    }
    noise(time, 0.2, 0.14, 'bandpass', 900, output);
  });

  // Flagship entrance: a rising two-note alarm over a long riser, snapping
  // the player's instruments into the flagship voice.
  bus.on('spawn', ({ kind, enemyId }) => {
    const mix = runtime.mix();
    if (kind !== 'flag-core' || !ctx || !mix?.duck || !mix.delaySend) return;
    score.overrideSection(2);
    coreId = enemyId;
    const time = score.nextGridTime(ctx.currentTime);
    riser(time, 1.8);
    [50, 56].forEach((midi, index) => {
      if (!ctx || !mix.duck || !mix.delaySend) return;
      const at = time + index * 0.42;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.55,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1600 },
        gainAutomation: [
          { type: 'set', value: 0.16, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.5 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    });
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.15,
      oscillatorType: 'sine',
      frequency: 130,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 68, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
      ],
      destination: output,
    });
  });

  return runtime;
}
