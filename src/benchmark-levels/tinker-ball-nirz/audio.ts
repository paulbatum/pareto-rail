import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createTinkerVoices, type TinkerKillVoice } from './audio-voices';
import { TINKER_BARS, TINKER_BPM, TINKER_SCORE_SECTIONS, TINKER_STEPS_PER_BAR, TINKER_TIME } from './timing';

// Bright, eccentric workshop pop. The band plays bell mallets, clipped reed
// organ, a bouncy synth bass, handclaps, and small workshop percussion — and
// the player is the lead mallet player. Kills read a hidden melody lane off
// the transport grid, so a chained volley performs a real tune; locks climb a
// pentatonic; fire and every knock take their pitch from the live chord.
//
// The one sound unique to this level is the pickup rattle: a couple of seconds
// after a kill, when the scattered supplies actually reach the ball, a tiny
// bead figure answers from the top of the register. The music hears the ball
// getting heavier.

const SIXTEENTH = TINKER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = TINKER_STEPS_PER_BAR;
const LANE_STEPS = 32;
/** Roughly how long scattered supplies take to reach the ball, in seconds. */
const PICKUP_DELAY = 2.6;

// C major with a lydian lift on the IV — bright without being saccharine.
const CHORDS = [
  { bass: 36, pad: [55, 60, 64, 67], arp: [72, 74, 76, 79] }, // Cmaj9
  { bass: 33, pad: [55, 57, 60, 64], arp: [69, 72, 74, 76] }, // Am7
  { bass: 29, pad: [53, 57, 60, 64], arp: [69, 72, 76, 77] }, // Fmaj7
  { bass: 31, pad: [55, 59, 62, 67], arp: [71, 74, 76, 79] }, // G6/9
];
type Chord = typeof CHORDS[number];

/** Locks climb this, one rung per lock, so a six-lock sweep is a rising figure. */
const LOCK_SCALE = [72, 74, 76, 79, 81, 84, 86, 88];

type SectionIndex = 0 | 1 | 2;

// Degrees into the live chord's lead set (its arpeggio plus the octave above).
// A kill unmutes whichever step of the lane it lands on, so consecutive kills
// in one volley walk consecutive steps of a written tune.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Marble — a hopping nursery-tune contour, mostly stepwise, easy to hear.
  0: [
    0, 1, 2, 1, 2, 3, 2, 1,
    2, 3, 4, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 2, 1,
    0, 2, 4, 5, 4, 2, 1, 0,
  ],
  // Tennis ball — wider, springier leaps with the octave folded in.
  1: [
    0, 3, 1, 4, 2, 5, 3, 6,
    4, 7, 5, 3, 6, 4, 2, 5,
    3, 6, 4, 7, 5, 2, 4, 1,
    6, 3, 5, 2, 4, 6, 5, 3,
  ],
  // Melon — bells over the spill: high peals falling, then a climb back up.
  2: [
    7, 5, 6, 4, 7, 5, 6, 4,
    5, 3, 4, 2, 5, 3, 4, 2,
    3, 4, 5, 6, 7, 6, 5, 4,
    5, 6, 7, 6, 7, 6, 7, 5,
  ],
};

// Per-scale voicing for the player's instruments. Gains are tuned by ear, not
// by matching numbers: the square in section 2 would swamp the mix at the
// sine's value.
const SECTION_VOICES: Record<SectionIndex, {
  kill: TinkerKillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.52, cutoff: 5200, gain: 0.2, partial: 2.76, shimmer: 0.3 },
    lock: { oscillator: 'triangle', cutoff: 3200, gain: 0.115 },
    fire: { cutoff: 2200, noise: 0.035 },
  },
  1: {
    kill: { oscillator: 'triangle', decay: 0.4, cutoff: 4300, gain: 0.17, partial: 3.2, shimmer: 0.5 },
    lock: { oscillator: 'square', cutoff: 2500, gain: 0.05 },
    fire: { cutoff: 3200, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'square', decay: 0.33, cutoff: 3600, gain: 0.115, partial: 4.1, shimmer: 0.72 },
    lock: { oscillator: 'sawtooth', cutoff: 2700, gain: 0.042 },
    fire: { cutoff: 4300, noise: 0.07 },
  },
};

export function createAudio(bus: EventBus) {
  return createTinkerAudio(bus).audio;
}

export const traceTinkerAudio = createAudioTraceHarness({
  level: 'tinker-ball-nirz',
  bpm: TINKER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createTinkerAudio,
});

function createTinkerAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const bossKinds = new Map<number, string>();
  let heartId = -1;
  let heartMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: TINKER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: TINKER_SCORE_SECTIONS.map((section) => ({ ...section })),
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
      compressor: { threshold: -17, ratio: 4.5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 3200 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      bossKinds.clear();
      heartId = -1;
      heartMaxHp = 0;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, [60, 64, 67, 72], 4.5);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createTinkerVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, clap, shake, tick, block, bass, mallet, organ, pad, riser, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- the player's instruments -------------------------------------------

  const killBellVoice = voice<{ killVoice: TinkerKillVoice }>({
    oscillators: [
      { type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain },
      { type: 'sine', gain: ({ killVoice }) => killVoice.gain * 0.28, frequencyRatio: ({ killVoice }) => killVoice.partial },
    ],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { attack: 0.004, decay: ({ killVoice }) => killVoice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'triangle', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.7 },
    ],
  });

  const killSparkleVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.34 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { attack: 0.003, decay: ({ decay }) => decay },
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.085,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 220 },
    envelope: { decay: 0.085 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.08 }],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.07 },
  });

  const rattleVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 1 }, { type: 'sine', gain: 0.22, frequencyRatio: 3.4 }],
    duration: 0.11,
    stopPadding: 0.02,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.0001, time: time + 0.11 },
    ],
  });

  const squelchVoice = voice<{ vel: number; from: number; to: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 9,
      frequencyAutomation: (time, { from, to }) => [
        { type: 'set', value: from, time },
        { type: 'exponentialRamp', value: to, time: time + 0.26 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.0001, time: time + 0.3 },
    ],
  });

  const thudVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.42,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 36, time: time + 0.3 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.44, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  const stabVoice = voice({
    oscillators: [{ type: 'square', gain: 0.07 }],
    duration: 0.22,
    stopPadding: 0.04,
    envelope: { decay: 0.22 },
  });

  // ---- arrangement --------------------------------------------------------

  const blank = '................';
  const padEven = `P...............${blank}`;
  const padOdd = `${blank}P...............`;
  const kickBase = 'K...k...K...k...';
  const kickPop = 'K...k..kK...k.k.';
  const kickDrive = 'K..kk...K..kk.k.';
  const kickSpill = 'K.....k.K...k...';
  const clapBack = '....C.......C...';
  const clapDouble = '....C.....c.C..c';
  const clapHalf = '............C...';
  const shakeSoft = '..s...s...s...s.';
  const shakeBusy = '.s.S.s.S.s.S.s.S';
  const tickPattern = '....t.....t.t...';
  const tickRoll = 't.t.t.t.tttttttt';
  const bassBounce = 'B..b.b..B..b.bB.';
  const bassPush = 'B.bBb.b.B.bBb.bB';
  const bassSpill = 'B...B.b.B...Bb..';
  const organStab = '......O.....O.O.';
  const organPush = '..O...O...O.O.O.';
  const malletHook = 'M...M.M...M..M..';
  const malletBusy = 'M.M.M..MM.M.M.M.';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0),
        hits('M.......M...M...', { M: 0.42 }, ({ time, step, chord }, vel) => mallet(time, chord.arp[(step / 4) % chord.arp.length], vel, 0.6)),
        hits('........t.......', { t: 0.5 }, ({ time }, vel) => tick(time, vel)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'wind-up',
        fromBar: TINKER_BARS.run,
        toBar: TINKER_BARS.groove,
        tracks: [padTrack(TINKER_BARS.run), malletTrack(malletHook, 0.5), tickTrack(tickPattern), hits(kickBase, { K: 0.8, k: 0.5 }, ({ time }, vel) => kick(time, vel))],
      },
      {
        name: 'groove',
        fromBar: TINKER_BARS.groove,
        toBar: TINKER_BARS.pop,
        tracks: [padTrack(TINKER_BARS.groove), kickTrack(kickBase), bassTrack(bassBounce), shakeTrack(shakeSoft), malletTrack(malletHook, 0.6), tickTrack(tickPattern)],
      },
      {
        name: 'pop',
        fromBar: TINKER_BARS.pop,
        toBar: TINKER_BARS.lift,
        tracks: [padTrack(TINKER_BARS.pop), kickTrack(kickPop), clapTrack(clapBack), bassTrack(bassBounce), shakeTrack(shakeBusy), organTrack(organStab, 0.7), malletTrack(malletHook, 0.62), tickTrack(tickPattern)],
      },
      {
        name: 'lift',
        fromBar: TINKER_BARS.lift,
        toBar: TINKER_BARS.drive,
        tracks: [padTrack(TINKER_BARS.lift), kickTrack(kickPop), clapTrack(clapBack), bassTrack(bassPush), shakeTrack(shakeBusy), organTrack(organStab, 0.85), malletTrack(malletBusy, 0.5), tickTrack(tickPattern)],
      },
      {
        name: 'drive',
        fromBar: TINKER_BARS.drive,
        toBar: TINKER_BARS.warn,
        tracks: [padTrack(TINKER_BARS.drive), kickTrack(kickDrive), clapTrack(clapDouble), bassTrack(bassPush), shakeTrack(shakeBusy), organTrack(organPush, 0.9), malletTrack(malletBusy, 0.56), tickTrack(tickPattern)],
      },
      {
        name: 'warn',
        fromBar: TINKER_BARS.warn,
        toBar: TINKER_BARS.spill,
        // The band drops out to bass and a tick roll while the spill gathers.
        tracks: [
          bassTrack(bassSpill),
          tickTrack(tickRoll),
          oneShot(0, 0, ({ time }) => riser(time, STEPS_PER_BAR * 2 * SIXTEENTH)),
          oneShot(1, 12, ({ time, chord }) => organ(time, chord.pad, 0.9, 0.5)),
        ],
      },
      {
        name: 'spill',
        fromBar: TINKER_BARS.spill,
        toBar: TINKER_BARS.finale,
        tracks: [padTrack(TINKER_BARS.spill), kickTrack(kickSpill), clapTrack(clapHalf), bassTrack(bassSpill), shakeTrack(shakeSoft), organTrack(organPush, 1), malletTrack(malletHook, 0.44), blockTrack()],
      },
      {
        name: 'finale',
        fromBar: TINKER_BARS.finale,
        toBar: TINKER_BARS.coast,
        tracks: [padTrack(TINKER_BARS.finale), kickTrack(kickDrive), clapTrack(clapDouble), bassTrack(bassPush), shakeTrack(shakeBusy), organTrack(organPush, 1), malletTrack(malletBusy, 0.6), tickTrack(tickPattern)],
      },
      {
        name: 'coast',
        fromBar: TINKER_BARS.coast,
        // Clean table: everything stops but the pad and one falling bell figure.
        tracks: [
          padTrack(TINKER_BARS.coast),
          oneShot(0, 0, ({ time, chord }) => {
            for (let i = 0; i < 5; i += 1) {
              const lead = [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
              mallet(time + i * SIXTEENTH * 2, lead[7 - i], 0.5 - i * 0.06, 0.8);
            }
          }),
          oneShot(0, 0, ({ time, chord }) => organ(time, chord.pad, 0.55, 0.9)),
        ],
      },
    ],
  });

  function padTrack(fromBar: number) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, STEPS_PER_BAR * 2 * SIXTEENTH * 1.05));
  }

  function kickTrack(pattern: string) {
    return hits(pattern, { K: 1, k: 0.72 }, ({ time }, vel) => kick(time, vel));
  }

  function clapTrack(pattern: string) {
    return hits(pattern, { C: 1, c: 0.55 }, ({ time }, vel) => clap(time, vel));
  }

  function shakeTrack(pattern: string) {
    return hits(pattern, { s: 0.05, S: 0.1 }, ({ time }, vel) => shake(time, vel));
  }

  function tickTrack(pattern: string) {
    return hits(pattern, { t: 0.85 }, ({ time }, vel) => tick(time, vel));
  }

  function bassTrack(pattern: string) {
    return hits<Chord>(pattern, { B: 1, b: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel));
  }

  function organTrack(pattern: string, vel: number) {
    return hits<Chord>(pattern, { O: vel }, ({ time, chord }, velocity) => organ(time, chord.pad, velocity, 0.16));
  }

  function malletTrack(pattern: string, vel: number) {
    // The backing mallet stays under the register the player's kills own.
    return hits<Chord>(pattern, { M: vel }, ({ time, step, chord }, velocity) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      mallet(time, chord.arp[order[(step / 2) % order.length]] - 12, velocity, 0.32);
    });
  }

  /** Workshop percussion for the boss: a wooden block walking under the fight. */
  function blockTrack() {
    return fn<Chord>(({ time, step, chord }) => {
      if (step % 8 !== 6) return;
      block(time, chord.bass + 24, 0.5);
    });
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- player sounds ------------------------------------------------------

  function sectionLayers(mix: SectionMix<SectionIndex>): Array<[SectionIndex, number]> {
    return mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  function killNote(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const from = SECTION_VOICES[mix.from].kill;
    const to = SECTION_VOICES[mix.to].kill;
    const vel = Math.min(1.4, 1 + chain * 0.13);
    const decay = lerp(from.decay, to.decay, mix.t);
    const gain = lerp(from.gain, to.gain, mix.t);
    const shimmer = lerp(from.shimmer, to.shimmer, mix.t);

    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      killBellVoice.play({
        context: ctx,
        time,
        midi,
        killVoice: SECTION_VOICES[section].kill,
        velocity: vel,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.42 }],
      });
    }
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killSparkleVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: [{ destination: audioMix.delaySend, gain: 0.5 }] });
    }
    noiseHit(time, 0.04 * shimmer + 0.02, 0.05, 'highpass', 6200, output);
  }

  /**
   * The supplies arriving at the ball. Scheduled forward to the moment the
   * pieces are actually swept up, quantized onto the grid, and pitched from
   * whatever chord is playing by then.
   */
  function pickupRattle(fromTime: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const time = score.nextGridTime(fromTime + PICKUP_DELAY, 2);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    for (let i = 0; i < 2; i += 1) {
      const at = time + i * THIRTYSECOND * 3;
      rattleVoice.play({
        context: ctx,
        time: at,
        midi: lead[(position + i * 3) % lead.length] + 12,
        vel: 0.028 - i * 0.008,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.35 }],
      });
    }
    noiseHit(time, 0.022, 0.05, 'highpass', 8200, output);
  }

  /** Cracking a spill core: a jar-lid anvil that brightens with the damage done. */
  function coreCrack(intensity: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.42,
      oscillatorType: 'sine',
      frequency: root * 2.6,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.08 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.36 },
      ],
      destination: output,
    });
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.22,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1900 + 2800 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.035 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.3 }],
      });
    }
    const lead = score.leadSetAt(position);
    const beacon = lead[Math.min(lead.length - 1, Math.floor(intensity * lead.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.06 + 0.07 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.46 },
      ],
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
    });
    noiseHit(time, 0.1 + 0.08 * intensity, 0.07, 'bandpass', 1300, output);
  }

  /** The last glue snapping clean: the band ducks, the tonic blooms, bells fall. */
  function heartFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.duck) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    audioMix.duckAt(time, 0.22, 1.6);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.9,
      oscillatorType: 'sine',
      frequency: 196,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 49, time: time + 0.4 }],
      gainAutomation: [
        { type: 'set', value: 0.48, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
      ],
      destination: output,
    });
    for (const midi of [48, 60, 64, 67, 72]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.4,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 800, time },
              { type: 'linearRamp', value: 3000, time: time + 0.8 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.045, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.3 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }],
        });
      }
    }
    [96, 91, 88, 84, 79, 76, 72].forEach((midi, index) => {
      mallet(time + index * SIXTEENTH, midi, 0.5 - index * 0.045, 0.7);
    });
    clap(time, 1);
    clap(time + SIXTEENTH * 2, 0.8);
    noiseHit(time, 0.13, 0.55, 'highpass', 6500, output);
  }

  // ---- event wiring -------------------------------------------------------

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'crust' && kind !== 'core' && kind !== 'heart') return;
    bossKinds.set(enemyId, kind);
    if (kind !== 'heart') return;
    heartId = enemyId;
    const audioMix = runtime.mix();
    if (!ctx || !audioMix?.duck || !audioMix.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime);
    riser(time, 1.5);
    [55, 58].forEach((midi, index) => {
      organ(time + index * 0.4, [midi, midi + 3, midi + 7], 1, 0.42);
    });
  });

  // Each kill takes at least the step after the last one, so a volley walks the
  // melody lane note by note instead of stacking on one grid step.
  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === heartId) {
      heartFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    pickupRattle(kill.time);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    for (const [section, weight] of sectionLayers(sectionMix)) {
      if (weight < 0.02) continue;
      const spec = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: spec.oscillator,
        cutoff: spec.cutoff,
        gainValue: spec.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.3 }],
      });
    }
    noiseHit(time, 0.018, 0.008, 'highpass', 5200, output);
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const cutoff = lerp(SECTION_VOICES[mix.from].fire.cutoff, SECTION_VOICES[mix.to].fire.cutoff, mix.t);
    const noise = lerp(SECTION_VOICES[mix.from].fire.noise, SECTION_VOICES[mix.to].fire.noise, mix.t);
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 26), time: time + 0.06 }],
      destination: output,
    });
    noiseHit(time, noise, 0.02, 'highpass', 3400, output);
  });

  // Non-lethal hits knock on wood, pitched from the live chord. Boss cores get
  // the anvil instead, and it grows louder and brighter as they crack.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    if (bossKinds.has(enemyId)) {
      if (enemyId === heartId) heartMaxHp = Math.max(heartMaxHp, hitPointsRemaining + 1);
      coreCrack(enemyId === heartId && heartMaxHp > 0 ? 1 - hitPointsRemaining / heartMaxHp : 0.35);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    block(time, chord.arp[0], 0.7);
    block(time + THIRTYSECOND, chord.arp[2], 0.4);
  });

  // A clean volley of four or more: the room applauds and the organ answers.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    clap(time, 0.9);
    clap(time + SIXTEENTH * 2, 0.6);
    organ(time, chord.pad.map((midi) => midi + 12), 0.85, 0.3);
    noiseHit(time, 0.07, 0.26, 'highpass', 7200, mix.duck);
  });

  // Rejected release: the glue holds. A sticky downward squelch, deliberately
  // outside the band's palette so it never reads as a hit.
  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [start, end, at, vel] of [
      [260, 74, time, 0.17],
      [188, 52, time + 0.03, 0.12],
    ] as const) {
      squelchVoice.play({
        context: ctx,
        time: at,
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.26 }],
        vel,
        from: 1400,
        to: 300,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.16, 'lowpass', 620, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    thudVoice.play({ context: ctx, time, frequency: 104, destination: output });
    // A tritone against the key: the one deliberately wrong sound in the level.
    for (const midi of [61, 67]) {
      stabVoice.play({ context: ctx, time, midi, destination: output });
    }
    noiseHit(time, 0.18, 0.15, 'bandpass', 820, output);
  });

  // A creature that rolls past unshot: one dry piece dropping away.
  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'triangle',
      frequency: 210,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 96, time: time + 0.11 }],
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
      ],
      destination: output,
    });
  });

  return runtime;
}
