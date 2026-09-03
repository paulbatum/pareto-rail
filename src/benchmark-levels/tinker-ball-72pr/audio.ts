import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createTinkerVoices, type TinkerKillVoice } from './audio-voices';
import { TINKER_BALL_72PR_BPM, TINKER_BALL_72PR_TIME } from './gameplay';

// Bright eccentric pop in C major: bell mallets carry the tune, clipped
// reed-organ stabs chop the offbeats, a bouncy square bass wobbles under
// handclaps and tiny workshop percussion (woodblocks, shaker, ticks). The
// LEAD MELODY is a hidden two-bar kill lane per act that only sounds where
// the player lands kills, so a chained volley performs a real melodic run
// and the player's mallet retunes with the harmony bar by bar.

const SIXTEENTH = TINKER_BALL_72PR_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = 16;
const LANE_STEPS = 32;

const CHORDS = [
  { bass: 36, pad: [60, 64, 67], arp: [72, 76, 79, 84] }, // C
  { bass: 29, pad: [57, 60, 65], arp: [69, 72, 77, 81] }, // F
  { bass: 31, pad: [59, 62, 67], arp: [71, 74, 79, 83] }, // G
  { bass: 33, pad: [57, 60, 64], arp: [69, 72, 76, 81] }, // Am
];
type Chord = typeof CHORDS[number];
const LOCK_SCALE = [72, 74, 76, 79, 81, 84, 86, 88]; // C major pentatonic, rising per lock

type SectionIndex = 0 | 1 | 2;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Marble act: a sunny stepwise arch for sparse opening waves.
  0: [
    0, 1, 2, 1, 3, 2, 1, 0,
    2, 3, 4, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    6, 5, 4, 3, 2, 1, 2, 0,
  ],
  // Tennis act: bouncy thirds so dense volleys ring as broken-chord runs.
  1: [
    0, 2, 4, 2, 0, 2, 4, 6,
    4, 2, 0, 2, 4, 6, 7, 6,
    4, 6, 5, 4, 2, 4, 3, 2,
    0, 2, 4, 5, 6, 7, 6, 4,
  ],
  // Spill act: triumphant highs that tumble home, for core cracks.
  2: [
    7, 6, 7, 4, 5, 4, 3, 4,
    5, 4, 3, 2, 3, 4, 5, 7,
    7, 6, 5, 4, 3, 2, 1, 0,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
};

const SECTION_VOICES: Record<SectionIndex, {
  kill: TinkerKillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 4200, gain: 0.17, shimmer: 0.3 },
    lock: { oscillator: 'triangle', cutoff: 3000, gain: 0.14 },
    fire: { cutoff: 2000, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'triangle', decay: 0.34, cutoff: 3600, gain: 0.16, shimmer: 0.45 },
    lock: { oscillator: 'triangle', cutoff: 2600, gain: 0.12 },
    fire: { cutoff: 3000, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'square', decay: 0.3, cutoff: 2800, gain: 0.13, shimmer: 0.6 },
    lock: { oscillator: 'square', cutoff: 2200, gain: 0.055 },
    fire: { cutoff: 4200, noise: 0.07 },
  },
};

export function createAudio(bus: EventBus) {
  return createTinkerAudio(bus).audio;
}

export const traceTinkerBall72prAudio = createAudioTraceHarness({
  level: 'tinker-ball-72pr',
  bpm: TINKER_BALL_72PR_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: (bus, trace) => createTinkerAudio(bus, trace),
});

function createTinkerAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const bossCoreIds = new Set<number>();
  let bossCoresDown = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: TINKER_BALL_72PR_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: [
      { index: 0, fromBar: 0 },
      { index: 1, fromBar: 11, crossfadeBars: 2 },
      { index: 2, fromBar: 24, crossfadeBars: 2 },
    ],
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.32, dampHz: 2800 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      bossCoreIds.clear();
      bossCoresDown = 0;
    },
    onRunEnd() {
      score.clearOverride();
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createTinkerVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, clap, hat, shaker, block, bass, mallet, reed, pad, riser, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  const killLayerVoice = voice<{ killVoice: TinkerKillVoice }>({
    oscillators: [{ type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain }],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { decay: ({ killVoice }) => killVoice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.35 }],
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
    oscillators: [{ type: 'sawtooth', gain: 0.08 }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.14,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 4400 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const rejectVoice = voice<{ vel: number; filterStart: number; filterEnd: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.22,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 5,
      frequencyAutomation: (time, { filterStart, filterEnd }) => [
        { type: 'set', value: filterStart, time },
        { type: 'exponentialRamp', value: filterEnd, time: time + 0.16 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  // ---- arrangement ---------------------------------------------------------
  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const padOdd = blankBar + 'P...............';
  const kickPop = 'K...k...k...k...';
  const kickDrive = 'K..kK..kK..kK..k';
  const clapBackbeat = '....C.......C...';
  const offHat = '..h...h...h...h.';
  const tightHat = 'h.h.h.h.h.h.h.h.';
  const shaker16 = 'ssssssssssssssss';
  const bassBouncy = 'B..b..u.b..b.f..';
  const mallet8 = 'M.M.M.M.M.M.M.M.';
  const malletHalf = 'M...M...M...M...';
  const mallet16 = 'MMMMMMMMMMMMMMMM';
  const reedOff = '..R...R...R...R.';
  const blockSparse = 'W......W...W....';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        hits(malletHalf, { M: 0.4 }, ({ time, chord }, vel) => mallet(time, chord.arp[0], vel)),
        hits(shaker16, { s: 0.35 }, ({ time }, vel) => shaker(time, vel)),
      ],
    }],
  });

  const padTrack = (fromBar: number) =>
    hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, STEPS_PER_BAR * 2 * SIXTEENTH * 1.05));

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'intro', fromBar: 0, toBar: 2,
        tracks: [
          hits(malletHalf, { M: 0.7 }, ({ time, chord }, vel) => mallet(time, chord.arp[0], vel)),
          hits(shaker16, { s: 0.5 }, ({ time }, vel) => shaker(time, vel)),
          hits(offHat, { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.03)),
        ],
      },
      {
        name: 'marble-a', fromBar: 2, toBar: 6,
        tracks: [
          padTrack(2),
          hits(kickPop, { K: 1, k: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits(bassBouncy, { B: 1, b: 0.75, u: 0.75, f: 0.75 }, ({ time, chord }, vel, symbol) => {
            bass(time, chord.bass + (symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0), vel);
          }),
          hits(offHat, { h: 0.06 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits(mallet8, { M: 0.55 }, ({ time, step, chord }, vel) => mallet(time, chord.arp[(step / 2) % chord.arp.length], vel)),
          hits(blockSparse, { W: 0.8 }, ({ time, chord }, vel) => block(time, chord.arp[0] + 24, vel)),
        ],
      },
      {
        name: 'marble-b', fromBar: 6, toBar: 11,
        tracks: [
          padTrack(6),
          hits(kickPop, { K: 1, k: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits(clapBackbeat, { C: 0.9 }, ({ time }, vel) => clap(time, vel)),
          hits(bassBouncy, { B: 1, b: 0.8, u: 0.8, f: 0.8 }, ({ time, chord }, vel, symbol) => {
            bass(time, chord.bass + (symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0), vel);
          }),
          hits(offHat, { h: 0.07 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits(mallet8, { M: 0.6 }, ({ time, step, chord }, vel) => mallet(time, chord.arp[(step / 2) % chord.arp.length], vel)),
          hits(blockSparse, { W: 0.9 }, ({ time, chord }, vel) => block(time, chord.arp[2] + 24, vel)),
        ],
      },
      {
        name: 'tennis', fromBar: 11, toBar: 20,
        tracks: [
          padTrack(11),
          hits(kickPop, { K: 1, k: 0.9 }, ({ time }, vel) => kick(time, vel)),
          hits(clapBackbeat, { C: 1 }, ({ time }, vel) => clap(time, vel)),
          hits(bassBouncy, { B: 1, b: 0.85, u: 0.85, f: 0.85 }, ({ time, chord }, vel, symbol) => {
            bass(time, chord.bass + (symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0), vel);
          }),
          hits(tightHat, { h: 0.06 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits(mallet8, { M: 0.65 }, ({ time, step, chord }, vel) => {
            const order = [0, 2, 1, 3, 2, 0, 3, 1];
            mallet(time, chord.arp[order[(step / 2) % order.length]], vel);
          }),
          hits(reedOff, { R: 0.8 }, ({ time, chord }, vel) => reed(time, chord.pad[1] + 12, vel)),
          hits(shaker16, { s: 0.5 }, ({ time }, vel) => shaker(time, vel)),
        ],
      },
      {
        name: 'breath', fromBar: 20, toBar: 24,
        tracks: [
          padTrack(20),
          hits(kickPop, { K: 0.9, k: 0.7 }, ({ time }, vel) => kick(time, vel)),
          hits(bassBouncy, { B: 0.9, b: 0.7, u: 0.7, f: 0.7 }, ({ time, chord }, vel, symbol) => {
            bass(time, chord.bass + (symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0), vel);
          }),
          hits(malletHalf, { M: 0.6 }, ({ time, chord }, vel) => mallet(time, chord.arp[0] + 12, vel)),
          hits(shaker16, { s: 0.4 }, ({ time }, vel) => shaker(time, vel)),
          oneShot(2, 0, ({ time }) => riser(time, STEPS_PER_BAR * 2 * SIXTEENTH)),
        ],
      },
      {
        name: 'spill', fromBar: 24, toBar: 31,
        tracks: [
          padTrack(24),
          hits(kickDrive, { K: 1, k: 0.9 }, ({ time }, vel) => kick(time, vel)),
          hits(clapBackbeat, { C: 1 }, ({ time }, vel) => clap(time, vel)),
          hits(bassBouncy, { B: 1, b: 0.9, u: 0.9, f: 0.9 }, ({ time, chord }, vel, symbol) => {
            bass(time, chord.bass + (symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0), vel);
          }),
          hits(tightHat, { h: 0.08 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits(mallet16, { M: 0.42 }, ({ time, step, chord }, vel) => mallet(time, chord.arp[step % chord.arp.length] + 12, vel)),
          hits(reedOff, { R: 1 }, ({ time, chord }, vel) => reed(time, chord.pad[1] + 12, vel)),
          hits(shaker16, { s: 0.65 }, ({ time }, vel) => shaker(time, vel)),
        ],
      },
      {
        name: 'outro', fromBar: 31,
        tracks: [
          hits(malletHalf, { M: 0.7 }, ({ time, chord }, vel) => mallet(time, chord.arp[0] + 12, vel)),
          hits(shaker16, { s: 0.4 }, ({ time }, vel) => shaker(time, vel)),
          oneShot(1, 0, ({ time, chord }) => {
            kick(time, 1);
            for (const midi of chord.pad) reed(time, midi + 12, 1);
            mallet(time, chord.arp[3] + 12, 1);
            const sfx = sfxDestination();
            if (sfx) noiseHit(time, 0.1, 0.4, 'highpass', 6400, sfx);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments --------------------------------------------
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
    noiseHit(time, 0.05 * shimmer + 0.03, 0.08, 'highpass', 5200, output);
  }

  // Cracking a spill core rings a heavy glue-drum that grows with damage,
  // plus a beacon note climbing the lead set toward the finale.
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
      stopTime: time + 0.45,
      oscillatorType: 'sine',
      frequency: rootFreq * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.09 }],
      gainAutomation: [
        { type: 'set', value: 0.26 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.38 },
      ],
      destination: output,
    });
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.24,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2200 + 2600 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.04 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
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
      stopTime: time + 0.55,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.07 + 0.07 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
      ],
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
    });
    noiseHit(time, 0.12 + 0.08 * intensity, 0.06, 'bandpass', 1400, output);
  }

  // The last glue snaps clean: the music ducks for a breath, a sub drop
  // lands on the tonic, and a C-pentatonic peal rings out over the delay.
  function spillFinale() {
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
    for (const midi of [48, 60, 64, 67]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.5,
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
            { type: 'set', value: 0.045, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.4 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }],
        });
      }
    }
    [96, 91, 88, 84, 79, 76, 72].forEach((midi, index) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.5,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 4000 },
        gainAutomation: [
          { type: 'set', value: 0.12 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }],
      });
    });
    noiseHit(time, 0.14, 0.6, 'highpass', 6000, output);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (bossCoreIds.has(enemyId)) {
      bossCoreIds.delete(enemyId);
      bossCoresDown += 1;
      const kill = score.nextKill(ctx.currentTime);
      const position = Math.max(0, kill.step - score.arrangementStart);
      killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
      if (bossCoresDown >= 3) spillFinale();
      else coreChip(1);
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
      const lock = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: lock.oscillator,
        cutoff: lock.cutoff,
        gainValue: lock.gain,
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
    const cutoff = lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t);
    const noise = lerp(fromFire.noise, toFire.noise, sectionMix.t);
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      destination: output,
    });
    noiseHit(time, noise, 0.02, 'highpass', 3200, output);
  });

  // Non-lethal chips on spill cores ring the glue-drum, growing with damage;
  // chips anywhere else tick up the current chord.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    if (bossCoreIds.has(enemyId)) {
      coreChip(1 - hitPointsRemaining / 4);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.08], [1, 0.07], [2, 0.06]] as const).forEach(([index, vel]) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + THIRTYSECOND * index;
      chipVoice.play({ context: ctx, time: at, midi: arp[index] + 12, vel, destination: output, sends: [{ destination: delaySend, gain: 0.38 }] });
    });
    noiseHit(time, 0.035, 0.035, 'highpass', 5600, output);
  });

  // A clean volley of four or more earns a flourish: the chord stabbed on
  // the next beat with a bright shimmer.
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
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.09, 0.3, 'highpass', 6800, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A dry workshop knock: two detuned knocks falling, nothing like a kill.
    for (const [start, end, at, vel] of [
      [330, 92, time, 0.18],
      [233, 61, time + 0.028, 0.13],
    ] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.18 }],
        vel,
        filterStart: 1100,
        filterEnd: 430,
        destination: output,
      });
    }
    noiseHit(time, 0.15, 0.09, 'bandpass', 720, output);
    noiseHit(time + 0.025, 0.07, 0.12, 'highpass', 2400, output);
  });

  // The spill sloshing in: a two-note toy alarm over a long riser.
  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind !== 'boss-core') return;
    bossCoreIds.add(enemyId);
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime);
    riser(time, 1.8);
    [72, 79].forEach((midi, index) => {
      if (!ctx || !mix.duck || !mix.delaySend) return;
      const at = time + index * 0.42;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.5,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1800 },
        gainAutomation: [
          { type: 'set', value: 0.12, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    });
  });

  bus.on('miss', ({ enemyId }) => {
    bossCoreIds.delete(enemyId);
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
