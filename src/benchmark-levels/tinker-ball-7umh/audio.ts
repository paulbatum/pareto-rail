import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createTinkerVoices } from './audio-voices';
import {
  TINKER_BARS,
  TINKER_BPM,
  TINKER_RUN_DURATION,
  TINKER_SCORE_SECTIONS,
  TINKER_STEPS_PER_BAR,
  TINKER_TIME,
} from './timing';

const SIXTEENTH = TINKER_TIME.stepSeconds;
const STEPS_PER_BAR = TINKER_STEPS_PER_BAR;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Bright, uplifting pop progression in C major
const CHORDS: Chord[] = [
  { bass: 36, pad: [60, 64, 67, 71], arp: [72, 76, 79, 83], stab: [60, 64, 67] }, // Cmaj7
  { bass: 35, pad: [59, 62, 67, 69], arp: [71, 74, 79, 81], stab: [59, 62, 67] }, // G6/B
  { bass: 33, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79], stab: [57, 60, 64] }, // Am7
  { bass: 29, pad: [53, 57, 60, 64], arp: [65, 69, 72, 76], stab: [53, 57, 60] }, // Fmaj7
];

const BOSS_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 60, 62, 65], arp: [69, 72, 74, 77], stab: [57, 60, 65] }, // Dm7
  { bass: 31, pad: [55, 59, 62, 65], arp: [67, 71, 74, 77], stab: [55, 59, 62] }, // G7
  { bass: 40, pad: [55, 59, 64, 67], arp: [67, 71, 76, 79], stab: [55, 59, 64] }, // Em7
  { bass: 33, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81], stab: [57, 61, 64] }, // A7
];

type SectionIndex = 0 | 1 | 2;

// Melodic kill lanes: 32-step sequence per section over the 2-bar cycle
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Act 1 (Marble scale): Stepwise playful bell melody
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Act 2 (Tennis ball): Syncopated octave-jumping groove
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Act 3 (Melon / Spill Boss): Triumphant fanfare climax
  2: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 4, 3, 2, 1,
    4, 5, 6, 7, 5, 6, 7, 7,
  ],
};

function leadSetFor(chord: Chord) {
  return [...chord.arp, ...chord.arp.map((n) => n + 12)];
}

export function createTinkerAudioInternal(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let mixBus: any = null;

  const score = createScore<Chord, SectionIndex>({
    bpm: TINKER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { chords: BOSS_CHORDS, barsPerChord: 2, fromBar: TINKER_BARS.spillBoss, toBar: TINKER_BARS.finale },
    ],
    sections: TINKER_SCORE_SECTIONS,
    leadSet: leadSetFor,
    killLanes: KILL_LANES,
  });

  const voices = createTinkerVoices({
    trace,
    context: () => ctx,
    mix: () => mixBus,
  });

  // Arrangement
  const arrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    trace,
    emitSections: true,
    chordAt: (pos) => score.chordAt(pos),
    sections: [
      // 1. Marble Intro & Clutter (Bars 0 to 10)
      {
        fromBar: TINKER_BARS.run,
        toBar: TINKER_BARS.scaleTennis,
        name: 'marble-intro',
        tracks: [
          // Kick
          hits('x...x...x...x...', { x: 0.9 }, ({ time }, vel) => voices.kick(time, vel)),
          // Claps on 2 and 4
          hits('....x.......x...', { x: 0.85 }, ({ time }, vel) => voices.clap(time, vel)),
          // Shaker / Hats
          hits('x.xxx.xxx.xxx.xx', { x: 0.7 }, ({ time }, vel) => voices.hat(time, vel)),
          // Rubbery Bass
          fn(({ time, chord, step }) => {
            if (step === 0 || step === 6 || step === 8 || step === 14) {
              const oct = step === 6 || step === 14 ? 12 : 0;
              voices.bass(time, chord.bass + oct, 0.85);
            }
          }),
          // Reed Organ Stabs
          hits('..x...x...x...x.', { x: 0.65 }, ({ time, chord }, vel) => {
            voices.stab(time, chord.stab[0], vel);
            voices.stab(time, chord.stab[1], vel * 0.9);
          }),
          // Woodblock workshop tick
          fn(({ time, step }) => {
            if (step === 4 || step === 12) {
              voices.woodblock(time, 72, 0.6);
            }
          }),
        ],
      },

      // 2. Tennis-Ball Scale / Workshop Rush (Bars 10 to 22)
      {
        fromBar: TINKER_BARS.scaleTennis,
        toBar: TINKER_BARS.spillBoss,
        name: 'tennis-rush',
        tracks: [
          // Driving Kick
          hits('x...x..x..x.x...', { x: 1.0 }, ({ time }, vel) => voices.kick(time, vel)),
          // Snappy Claps
          hits('....x.......x..x', { x: 0.95 }, ({ time }, vel) => voices.clap(time, vel)),
          // Energetic 16th Hats
          hits('xxxxxxxxxxxxxxxx', { x: 0.8 }, ({ time }, vel) => voices.hat(time, vel)),
          // Energetic Walking Bass
          fn(({ time, chord, step }) => {
            const root = chord.bass;
            const pitches = [root, root + 12, root + 7, root + 12, root, root + 5, root + 7, root + 12];
            const p = pitches[Math.floor(step / 2) % pitches.length];
            if (step % 2 === 0) {
              voices.bass(time, p, 0.95);
            }
          }),
          // Organ stabs
          hits('.x.x..x..x.x..x.', { x: 0.75 }, ({ time, chord }, vel) => {
            voices.stab(time, chord.stab[0], vel);
            voices.stab(time, chord.stab[2], vel * 0.9);
          }),
          // Mallet Arp
          fn(({ time, chord, step }) => {
            if (step % 4 === 2) {
              const note = chord.arp[step % chord.arp.length];
              voices.mallet(time, note, 0.75);
            }
          }),
        ],
      },

      // 3. The Glue Spill Boss (Bars 22 to 30)
      {
        fromBar: TINKER_BARS.spillBoss,
        toBar: TINKER_BARS.finale,
        name: 'the-glue-spill',
        tracks: [
          // Heavy pounding Kick
          hits('x.x.x.x.x.x.x.x.', { x: 1.1 }, ({ time }, vel) => voices.kick(time, vel)),
          // Double claps
          hits('....x...x...x..x', { x: 1.0 }, ({ time }, vel) => voices.clap(time, vel)),
          // Rapid Hats
          hits('xxxxxxxxxxxxxxxx', { x: 0.85 }, ({ time }, vel) => voices.hat(time, vel)),
          // Heavy Bass
          fn(({ time, chord, step }) => {
            if (step % 2 === 0) {
              const oct = step % 4 === 2 ? 12 : 0;
              voices.bass(time, chord.bass + oct, 1.1);
            }
          }),
          // Dramatic Organ Stabs
          hits('x.xx.x.xx.xx.x.x', { x: 0.9 }, ({ time, chord }, vel) => {
            for (const n of chord.stab) {
              voices.stab(time, n, vel * 0.8);
            }
          }),
        ],
      },

      // 4. Spotless Coast Finale (Bars 30 to 32)
      {
        fromBar: TINKER_BARS.finale,
        name: 'spotless-coast',
        tracks: [
          hits('x.......x.......', { x: 0.8 }, ({ time }, vel) => voices.kick(time, vel)),
          hits('....x.......x...', { x: 0.7 }, ({ time }, vel) => voices.clap(time, vel)),
          // Final C major resolution chord on downbeat of bar 30
          oneShot(0, 0, ({ time }) => {
            voices.mallet(time, 72, 1.2);
            voices.mallet(time, 76, 1.1);
            voices.mallet(time, 79, 1.1);
            voices.mallet(time, 84, 1.3);
          }),
        ],
      },
    ],
  });

  // Gameplay actions quantized to the transport grid
  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const actionTime = score.quantizePlayerAction(ctx.currentTime);
    const pos = score.arrangementPositionAt(actionTime);
    const leads = score.leadSetAt(pos);
    const note = leads[Math.min(leads.length - 1, lockCount - 1)] ?? 72;
    voices.playerLock(actionTime, note, 0.8 + lockCount * 0.05);
  });

  bus.on('fire', () => {
    if (!ctx) return;
    const actionTime = score.quantizePlayerAction(ctx.currentTime);
    voices.playerFire(actionTime, 1.0);
  });

  bus.on('hit', () => {
    if (!ctx) return;
    const actionTime = score.quantizePlayerAction(ctx.currentTime);
    const pos = score.arrangementPositionAt(actionTime);
    const leads = score.leadSetAt(pos);
    voices.playerHit(actionTime, leads[0] ?? 60, 0.8);
  });

  bus.on('kill', () => {
    if (!ctx) return;
    const killResult = score.nextKill(ctx.currentTime);
    if (killResult) {
      voices.playerKill(killResult.time, killResult.midi, 1.0);
    }
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const actionTime = ctx.currentTime;
    voices.playerReject(actionTime);
  });

  const beatAudio = createBeatLevelAudio({
    bus,
    stepSeconds: SIXTEENTH,
    stepsPerBar: STEPS_PER_BAR,
    score,
    mix: {
      musicVolume: 0.85,
      sfxVolume: 1.0,
      compressor: { threshold: -12, ratio: 4, attack: 0.005, release: 0.15 },
      reverb: { seconds: 1.2, decay: 1.8, level: 0.22 },
      noiseSeconds: 2.0,
    },
    onPostBuild(context, mix) {
      ctx = context;
      mixBus = mix;
    },
    onStep(step: BeatLevelAudioStep) {
      arrangement.schedule(step.position, step.time);
    },
    onDispose() {
      ctx = null;
      mixBus = null;
    },
  });

  return beatAudio;
}

export function createAudio(bus: EventBus) {
  return createTinkerAudioInternal(bus).audio;
}

export const traceTinkerAudio = createAudioTraceHarness({
  level: 'tinker-ball-7umh',
  bpm: TINKER_BPM,
  defaultSeconds: TINKER_RUN_DURATION,
  createAudio: (bus: EventBus, trace: AudioTraceSink) => {
    const runtime = createTinkerAudioInternal(bus, trace);
    return {
      traceRun(seconds: number) {
        runtime.traceRun(seconds);
      },
    };
  },
});
