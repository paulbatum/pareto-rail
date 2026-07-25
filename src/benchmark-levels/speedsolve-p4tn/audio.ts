import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSpeedsolveVoices } from './audio-voices';
import {
  FACE_START_BARS,
  SPEEDSOLVE_BARS,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_SCORE_SECTIONS,
  SPEEDSOLVE_STEPS_PER_BAR,
  SPEEDSOLVE_TIME,
  type SpeedsolveSection,
} from './timing';

// The cube is the percussion section. `snap` is one instrument used for two
// purposes that are actually the same event: the backbeat of the track, and a
// layer of the cube landing after the player destroys a wrong square. Rotations
// are scheduled on the next quarter note, so a snap you cause is indistinguishable
// from a snap the track was going to play — the solve performs the drum part.
//
// Above that, the player is the soloist: locks climb the live chord, volleys fire
// a pitched release, and every kill plays the written note of a hidden melodic
// lane, so a chained volley walks a real melody. The arrangement adds one layer
// per face section, and each face actually conquered unlocks an extra glass
// counter-melody — the music thickens with the solve, not just with the clock.

const TIME = SPEEDSOLVE_TIME;
const SIXTEENTH = TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SPEEDSOLVE_STEPS_PER_BAR;

// D dorian, one chord per bar, five bars to the loop — exactly the length of a
// face section, so every face begins on the same harmony.
const CHORDS = [
  { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 76] }, // F
  { bass: 36, pad: [52, 55, 60, 64], arp: [60, 64, 67, 71] }, // C
  { bass: 38, pad: [50, 57, 62, 65], arp: [62, 65, 69, 72] }, // Dm
  { bass: 34, pad: [46, 53, 58, 62], arp: [58, 62, 65, 69] }, // Bb
  { bass: 31, pad: [50, 55, 58, 62], arp: [55, 58, 62, 65] }, // Gm
];
type Chord = typeof CHORDS[number];

// Hidden kill-melody lanes: degrees into the live lead set (the chord's arp plus
// the same notes an octave up). Two bars long, so a chained volley walks a real
// fragment instead of repeating one note.
const KILL_LANES: Record<SpeedsolveSection, number[]> = {
  // Opening: a clean stepwise arch, calm enough for a first face.
  0: [
    0, 1, 2, 3, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 2, 1,
    3, 4, 5, 6, 7, 6, 5, 4,
  ],
  // Mid solve: broken octaves, so dense volleys ring out as fast arpeggios.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    2, 6, 3, 7, 4, 1, 5, 2,
    7, 5, 6, 4, 5, 3, 4, 2,
  ],
  // Pressure: climbing runs that sit high in the register.
  2: [
    2, 3, 4, 5, 6, 7, 6, 5,
    4, 5, 6, 7, 5, 4, 3, 2,
    3, 5, 4, 6, 5, 7, 6, 4,
    7, 6, 7, 5, 6, 4, 5, 3,
  ],
  // Core: descending peals from the top of the set, tolling the finish.
  3: [
    7, 6, 5, 4, 7, 5, 3, 2,
    6, 5, 4, 3, 7, 4, 2, 0,
    7, 5, 6, 4, 5, 3, 4, 2,
    7, 7, 6, 6, 5, 5, 4, 3,
  ],
};

// Player voicings per act. Gains are tuned by ear, not by matching numbers: at the
// same value a square reads far louder than a triangle.
const SECTION_VOICES: Record<SpeedsolveSection, {
  kill: { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number };
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'triangle', decay: 0.30, cutoff: 3600, gain: 0.19, sparkle: 0.30 },
    lock: { oscillator: 'triangle', cutoff: 2600, gain: 0.115 },
    fire: { cutoff: 2100, noise: 0.030 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.22, cutoff: 3000, gain: 0.135, sparkle: 0.45 },
    lock: { oscillator: 'square', cutoff: 2200, gain: 0.052 },
    fire: { cutoff: 3000, noise: 0.042 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.26, cutoff: 3400, gain: 0.13, sparkle: 0.60 },
    lock: { oscillator: 'sawtooth', cutoff: 2400, gain: 0.046 },
    fire: { cutoff: 3600, noise: 0.052 },
  },
  3: {
    kill: { oscillator: 'square', decay: 0.34, cutoff: 4400, gain: 0.15, sparkle: 0.85 },
    lock: { oscillator: 'square', cutoff: 2900, gain: 0.058 },
    fire: { cutoff: 4600, noise: 0.066 },
  },
};

export function createAudio(bus: EventBus) {
  return createSpeedsolveAudio(bus).audio;
}

export const traceSpeedsolveAudio = createAudioTraceHarness({
  level: 'speedsolve-p4tn',
  bpm: SPEEDSOLVE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createSpeedsolveAudio,
});

function createSpeedsolveAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const kinds = new Map<number, string>();
  let coreId = -1;
  let coreMaxHp = 0;
  /** Faces actually conquered: each one unlocks another counter-melody layer. */
  let layersEarned = 0;
  let faceSnaps = 0;

  const score = createScore<Chord, SpeedsolveSection>({
    bpm: SPEEDSOLVE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 1,
    sections: SPEEDSOLVE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.82,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.004, release: 0.18 },
      delay: { time: SIXTEENTH * 3, feedback: 0.24, dampHz: 3200, sendGain: 0.9 },
      reverb: { seconds: 1.4, decay: 2.8, level: 0.1 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      kinds.clear();
      coreId = -1;
      coreMaxHp = 0;
      layersEarned = 0;
      faceSnaps = 0;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, [50, 57, 62, 69], 5.5, 1);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createSpeedsolveVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { thud, snap, click, bass, pad, pluck, glass, sub, clunk, riffle, chime, riser, noise } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- player voices -------------------------------------------------------

  const killLayer = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; decay: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const killBody = voice<{ decay: number; gainValue: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: ({ gainValue }) => gainValue * 0.6 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killShine = voice<{ decay: number; gainValue: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: ({ gainValue }) => gainValue * 0.45 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.075,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 220 },
    envelope: { decay: 0.075 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'square', gain: 0.075 }],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.07 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.11,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 5200 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  // A jammed mechanism, not a failed note: the release grinds instead of ringing.
  const grindVoice = voice<{ vel: number; from: number; to: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.26,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 7,
      frequencyAutomation: (time, { from, to }) => [
        { type: 'set', value: from, time },
        { type: 'exponentialRamp', value: to, time: time + 0.2 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  const impactVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.42,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 38, time: time + 0.3 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.44, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  const stabVoice = voice({
    oscillators: [{ type: 'square', gain: 0.06 }],
    duration: 0.22,
    stopPadding: 0.03,
    envelope: { decay: 0.22 },
  });

  const dropVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.17,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 62, time: time + 0.14 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.055, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  // ---- arrangement ---------------------------------------------------------

  const kickIntro = 'K.......K.......';
  const kickFour = 'K...K...K...K...';
  const kickDrive = 'K...K...K..kK...';
  const kickPush = 'K..kK...K..kK.k.';
  const snapBack = '....S.......S...';
  const snapGhost = '....S.....s.S...';
  const snapFill = '....S..s..s.S.s.';
  const click8 = 'c.c.c.c.c.c.c.c.';
  const click16 = 'cCcccCcccCcccCcc';
  const clickOpen = 'cCc.cCcccCc.cCcc';
  const bassSpine = 'B..b..B.B..b.B..';
  const bassDrive = 'B.bBb.B.B.bBb.B.';
  const pluck8 = 'A.A.A.A.A.A.A.A.';
  const pluck16 = 'A.AAA.A.A.AAA.A.';
  const padHold = 'P...............';

  const padTrack = (level: number) => hits<Chord>(padHold, { P: 1 }, ({ time, chord }) => (
    pad(time, chord.pad, TIME.barSeconds * 1.05, level)
  ));
  const kickTrack = (pattern: string) => hits<Chord>(pattern, { K: 1, k: 0.72 }, ({ time }, vel) => thud(time, vel));
  const clickTrack = (pattern: string) => hits<Chord>(pattern, { c: 0.5, C: 1 }, ({ time, step }, vel) => (
    click(time, vel, 2100 + (step % 4) * 260)
  ));
  const bassTrack = (pattern: string) => hits<Chord>(pattern, { B: 1, b: 0.66 }, ({ time, chord, step }, vel) => (
    bass(time, chord.bass + (step % 8 === 6 ? 7 : 0), vel)
  ));
  const pluckTrack = (pattern: string, level: number) => hits<Chord>(pattern, { A: level }, ({ time, step, chord }, vel) => {
    const order = [0, 2, 1, 3, 2, 0, 3, 1];
    pluck(time, chord.arp[order[(step / 2) % order.length] ?? 0] - 12, vel, 0.16);
  });

  /** Backbeat snaps. The same voice a layer rotation uses; the kit is the cube. */
  const snapTrack = (pattern: string) => hits<Chord>(pattern, { S: 1, s: 0.5 }, ({ time, chord }, vel, symbol) => (
    snap(time, chord.bass + 24, vel, symbol === 'S' ? 0.7 : 0.35)
  ));

  /** Conquered faces buy an extra glass counter-melody above the solve. */
  const ornamentTrack = () => fn<Chord>(({ step, time, chord }) => {
    if (layersEarned < 1) return;
    const slots = layersEarned >= 5 ? [2, 6, 10, 14] : layersEarned >= 3 ? [6, 14] : [6];
    if (!slots.includes(step)) return;
    glass(time, chord.arp[(step / 2) % chord.arp.length] + 12, 0.42 + layersEarned * 0.05);
  });

  /** The riffle that scrambles the incoming face, laid across the swing. */
  const swingTrack = (bar: number) => oneShot<Chord>(bar, 4, ({ time }) => riffle(time, 9, SIXTEENTH * 1.05));

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0.75),
        hits<Chord>('A.......A.....A.', { A: 0.55 }, ({ time, step, chord }, vel) => (
          pluck(time, chord.arp[(step / 2) % chord.arp.length], vel, 0.24)
        )),
        hits<Chord>('c.......c.......', { c: 0.35 }, ({ time }, vel) => click(time, vel, 2400)),
      ],
    }],
  });

  // One layer per face section: the machine gains a part every time it presents a
  // new side, and a conquered face buys the ornament line on top of that.
  const faceTracks = (index: number): Array<ArrangementTrack<Chord>> => [
    padTrack(1),
    clickTrack(index >= 4 ? clickOpen : index >= 1 ? click16 : click8),
    kickTrack(index >= 5 ? kickPush : index >= 2 ? kickDrive : kickFour),
    bassTrack(index >= 3 ? bassDrive : bassSpine),
    snapTrack(index >= 5 ? snapFill : index >= 3 ? snapGhost : snapBack),
    ...(index >= 1 ? [pluckTrack(index >= 4 ? pluck16 : pluck8, index >= 4 ? 0.62 : 0.48)] : []),
    ornamentTrack(),
    swingTrack(4),
    ...(index === 5 ? [oneShot<Chord>(4, 0, ({ time }) => riser(time, TIME.barSeconds * 0.75))] : []),
  ];

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'intro',
        fromBar: SPEEDSOLVE_BARS.intro,
        toBar: FACE_START_BARS[0],
        tracks: [padTrack(0.85), clickTrack(click8), kickTrack(kickIntro), swingTrack(1)],
      },
      ...FACE_START_BARS.map((bar, index) => ({
        name: `face-${index + 1}`,
        fromBar: bar,
        toBar: index + 1 < FACE_START_BARS.length ? FACE_START_BARS[index + 1] : SPEEDSOLVE_BARS.core,
        tracks: faceTracks(index),
      })),
      {
        name: 'core',
        fromBar: SPEEDSOLVE_BARS.core,
        tracks: [
          padTrack(1.15),
          clickTrack(clickOpen),
          kickTrack(kickPush),
          bassTrack(bassDrive),
          snapTrack(snapFill),
          pluckTrack(pluck16, 0.66),
          ornamentTrack(),
          oneShot<Chord>(0, 0, ({ time, chord }) => sub(time, chord.bass - 12, TIME.barSeconds * 4, 1)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments --------------------------------------------

  function sectionLayers(mix: SectionMix<SpeedsolveSection>): Array<[SpeedsolveSection, number]> {
    return mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  function killNote(time: number, midi: number, mix: SectionMix<SpeedsolveSection>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output) return;
    const from = SECTION_VOICES[mix.from].kill;
    const to = SECTION_VOICES[mix.to].kill;
    const decay = lerp(from.decay, to.decay, mix.t);
    const gainValue = lerp(from.gain, to.gain, mix.t);
    const sparkle = lerp(from.sparkle, to.sparkle, mix.t);
    const vel = Math.min(1.4, 1 + chain * 0.11);
    const sends = audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.4 }] : undefined;

    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const shape = SECTION_VOICES[section].kill;
      killLayer.play({
        context: ctx,
        time,
        midi,
        oscillator: shape.oscillator,
        cutoff: shape.cutoff,
        gainValue: shape.gain,
        decay,
        velocity: vel,
        weight,
        destination: output,
        sends,
      });
    }
    // A pure body an octave down keeps square and saw leads from sounding thin.
    killBody.play({ context: ctx, time, midi, decay, gainValue, velocity: vel, destination: output });
    if (chain >= 2) {
      killShine.play({ context: ctx, time, midi, decay, gainValue, destination: output, sends });
    }
    noise(time, 0.035 + sparkle * 0.045, 0.05, 'highpass', 6400, output);
  }

  /** Rising anvil on the exposed core: the fight audibly ratchets with damage. */
  function coreChip(intensity: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.46,
      oscillatorType: 'sine',
      frequency: root * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.08 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + 0.18 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
      ],
      destination: output,
    });
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.58,
      oscillatorType: 'square',
      frequency: midiToFreq(beacon + 12),
      filter: { type: 'lowpass', frequency: 2600 + 3200 * intensity },
      gainAutomation: [
        { type: 'set', value: 0.05 + 0.05 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
      ],
      destination: output,
      sends: audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.45 }] : undefined,
    });
    noise(time, 0.1 + 0.09 * intensity, 0.05, 'bandpass', 1500, output);
  }

  /** The last barrage lands: duck the machine, drop to the tonic, resolve to D major. */
  function coreFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    audioMix.duckAt(time, 0.16, 1.9);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.1,
      oscillatorType: 'sine',
      frequency: 220,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 49, time: time + 0.42 }],
      gainAutomation: [
        { type: 'set', value: 0.52, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1 },
      ],
      destination: output,
    });
    // D major bloom: the one moment the level leaves the minor mode.
    for (const midi of [50, 62, 66, 69, 74]) {
      for (const detune of [-6, 7]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.8,
          oscillatorType: 'triangle',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 900, time },
              { type: 'linearRamp', value: 3400, time: time + 1 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.045, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.7 },
          ],
          destination: output,
          sends: delaySend ? [{ destination: delaySend, gain: 0.4 }] : undefined,
        });
      }
    }
    // Confetti: a scatter of plastic clicks over the resolving chord.
    for (let index = 0; index < 22; index += 1) {
      click(time + 0.08 + index * THIRTYSECOND * (0.8 + (index % 5) * 0.35), 0.5, 2400 + (index % 7) * 420);
    }
    chime(time + 0.06, [86, 81, 78, 74, 69, 62], THIRTYSECOND * 3);
    noise(time, 0.16, 0.7, 'highpass', 6800, output);
  }

  // ---- gameplay hooks ------------------------------------------------------

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'letter') return;
    kinds.set(enemyId, kind);
    if (kind === 'core') coreId = enemyId;
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kind = kinds.get(enemyId);
    kinds.delete(enemyId);
    if (enemyId === coreId) {
      coreFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, kill.midi, score.sectionMixAt(position), indexInVolley ?? 0);

    // A destroyed square commits a rotation, and the rotation lands on the next
    // quarter note as the track's own snap — one instrument, two reasons. The
    // snap brightens with each square cleared, so a face audibly resolves.
    if (kind === 'facet') {
      const output = sfxDestination();
      const beatTime = score.nextGridTime(ctx.currentTime, 4);
      const chord = score.chordAt(score.arrangementPositionAt(beatTime));
      faceSnaps = (faceSnaps + 1) % 4;
      snap(beatTime, chord.bass + 24, 1.15, 0.45 + faceSnaps * 0.18);
      if (output) noise(beatTime, 0.1, 0.05, 'bandpass', 1700, output);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const midi = leadSet[Math.min(leadSet.length - 1, Math.max(0, lockCount - 1))];
    const sectionMix = score.sectionMixAt(position);
    for (const [section, weight] of sectionLayers(sectionMix)) {
      if (weight < 0.02) continue;
      const shape = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: shape.oscillator,
        cutoff: shape.cutoff,
        gainValue: shape.gain,
        lockCount,
        weight,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.22 }] : undefined,
      });
    }
    noise(time, 0.022, 0.008, 'highpass', 8200, output);
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const from = SECTION_VOICES[sectionMix.from].fire;
    const to = SECTION_VOICES[sectionMix.to].fire;
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff: lerp(from.cutoff, to.cutoff, sectionMix.t),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 26), time: time + 0.06 }],
      destination: output,
    });
    noise(time, lerp(from.noise, to.noise, sectionMix.t), 0.02, 'highpass', 3600, output);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output) return;
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      coreChip(1 - hitPointsRemaining / Math.max(1, coreMaxHp));
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.075], [2, 0.055]] as const).forEach(([index, vel], order) => {
      if (!ctx || !output) return;
      const at = time + THIRTYSECOND * order;
      chipVoice.play({
        context: ctx,
        time: at,
        midi: arp[index] + 12,
        vel,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : undefined,
      });
    });
    noise(time, 0.03, 0.025, 'highpass', 6200, output);
  });

  // Armour stages: a heavy machine clunk plus a stab from the live chord.
  bus.on('stage', ({ stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    clunk(time, chord.bass + 12 + stageIndex * 3, 0.85 + stageIndex * 0.1);
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.34,
        oscillatorType: 'square',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2400 },
        gainAutomation: [
          { type: 'set', value: 0.035, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
        ],
        destination: output,
      });
    }
  });

  // A face reaching one colour: caps blow off, the machine rings, and the
  // arrangement gains a layer that only a solved face can buy.
  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'exposed') {
      layersEarned += 1;
      const time = score.nextGridTime(ctx.currentTime, 2);
      const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
      chime(time, [arp[0] + 12, arp[2] + 12, arp[1] + 24, arp[3] + 24], SIXTEENTH);
      runtime.mix()?.duckAt(time, 0.62, 0.5);
      return;
    }
    if (phase === 'summoned') {
      score.overrideSection(3);
      const time = score.nextGridTime(ctx.currentTime, 1);
      riser(time, TIME.barSeconds * 0.72);
      clunk(time, 33, 1);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    chime(time, [chord.arp[0] + 12, chord.arp[1] + 12, chord.arp[2] + 12], SIXTEENTH * 0.75);
    noise(time, 0.075, 0.26, 'highpass', 7200, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [startHz, endHz, at, vel] of [
      [420, 96, time, 0.16],
      [297, 68, time + 0.03, 0.12],
    ] as const) {
      grindVoice.play({
        context: ctx,
        time: at,
        frequency: startHz,
        frequencyAutomation: [{ type: 'exponentialRamp', value: endHz, time: at + 0.22 }],
        vel,
        from: 1300,
        to: 420,
        destination: output,
      });
    }
    noise(time, 0.14, 0.1, 'bandpass', 640, output);
    noise(time + 0.03, 0.06, 0.14, 'highpass', 2200, output);
  });

  // The one deliberately out-of-key sound in the level.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    impactVoice.play({ context: ctx, time, frequency: 104, destination: output });
    for (const midi of [61, 67] as const) {
      stabVoice.play({ context: ctx, time, midi, destination: output });
    }
    noise(time, 0.2, 0.15, 'bandpass', 860, output);
  });

  // A square left unsolved falls away: a soft dropped-piece thunk.
  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    dropVoice.play({ context: ctx, time: ctx.currentTime, frequency: 148, destination: output });
  });

  return runtime;
}
