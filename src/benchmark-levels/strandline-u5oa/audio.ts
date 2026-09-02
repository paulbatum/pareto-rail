import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createScore } from '../../engine/score';
import {
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
} from './timing';
import {
  createStrandlineVoices,
  type StrandlineKillVoice,
} from './audio-voices';

const SIXTEENTH = STRANDLINE_TIME.stepSeconds; // 0.125s
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR; // 16

type Chord = {
  bass: number;
  pad: number[];
  arp: number[];
};

// Main loop in D minor (bars 0 to 14)
const MAIN_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 60, 64, 69], arp: [62, 65, 69, 72] }, // Dm9
  { bass: 34, pad: [53, 57, 62, 65], arp: [62, 65, 69, 70] }, // Bbmaj7
  { bass: 31, pad: [55, 58, 62, 65], arp: [58, 62, 65, 69] }, // Gm9
  { bass: 33, pad: [57, 62, 64, 69], arp: [61, 64, 67, 69] }, // Asus4
];

// Swell chords (bars 14 to 20): wide oceanic expansiveness
const SWELL_CHORDS: Chord[] = [
  { bass: 41, pad: [57, 60, 64, 67], arp: [65, 69, 72, 76] }, // Fmaj9
  { bass: 43, pad: [55, 59, 62, 67], arp: [67, 71, 74, 77] }, // G9
  { bass: 34, pad: [58, 62, 65, 69], arp: [65, 69, 70, 74] }, // Bbmaj7
];

// Boss chords (bars 20 to 26): tense Phrygian struggle
const BOSS_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 62, 65, 69], arp: [62, 65, 69, 74] }, // Dm
  { bass: 38, pad: [55, 58, 63, 67], arp: [63, 67, 70, 75] }, // Eb/D
  { bass: 33, pad: [55, 58, 61, 64], arp: [61, 64, 67, 70] }, // A7b9
];

// Restoration chords (bars 26 to 30): serene D major rebirth
const RESTORATION_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 61, 64, 69], arp: [62, 66, 69, 73] }, // Dmaj9
  { bass: 38, pad: [55, 59, 62, 66], arp: [62, 66, 69, 74] }, // Gmaj7/D
];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Melodic kill lanes (32 steps = 2 bars). Degrees into the 8-note chord lead set.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Section 0: gentle aquatic wave
  0: [
    0, 1, 2, 3, 2, 1, 0, 1,
    2, 3, 4, 3, 2, 1, 2, 3,
    0, 2, 3, 4, 3, 2, 1, 0,
    1, 2, 3, 4, 3, 2, 1, 0,
  ],
  // Section 1: flowing syncopated pentatonic run
  1: [
    0, 2, 4, 1, 3, 5, 2, 4,
    3, 5, 6, 4, 5, 7, 6, 4,
    0, 3, 2, 4, 3, 5, 4, 6,
    5, 7, 6, 4, 3, 2, 1, 0,
  ],
  // Section 2: soaring bell arches
  2: [
    4, 5, 7, 6, 4, 5, 7, 6,
    5, 6, 7, 5, 4, 6, 5, 3,
    4, 5, 7, 6, 4, 5, 7, 6,
    7, 6, 5, 4, 3, 2, 1, 0,
  ],
  // Section 3: boss battle tense climb
  3: [
    0, 3, 5, 6, 3, 5, 6, 7,
    4, 6, 7, 7, 5, 6, 7, 7,
    1, 3, 5, 7, 2, 4, 6, 7,
    5, 7, 7, 7, 6, 5, 4, 0,
  ],
  // Section 4: serene cascading resolution onto D-major tonic
  4: [
    7, 6, 5, 4, 5, 4, 3, 2,
    4, 3, 2, 0, 2, 1, 0, 0,
    7, 5, 4, 2, 4, 3, 2, 0,
    3, 2, 0, 0, 2, 0, 0, 0,
  ],
};

const SECTION_KILL_VOICES: Record<SectionIndex, StrandlineKillVoice> = {
  0: { oscillator: 'sine', decay: 0.42, cutoff: 2800, gain: 0.22, shimmer: 0.3 },
  1: { oscillator: 'triangle', decay: 0.32, cutoff: 3400, gain: 0.2, shimmer: 0.45 },
  2: { oscillator: 'sine', decay: 0.48, cutoff: 4000, gain: 0.24, shimmer: 0.6 },
  3: { oscillator: 'sawtooth', decay: 0.28, cutoff: 3600, gain: 0.18, shimmer: 0.5 },
  4: { oscillator: 'sine', decay: 0.6, cutoff: 3200, gain: 0.25, shimmer: 0.7 },
};

export function createAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let isPurified = false;

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: MAIN_CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: 14, toBar: 20, chords: SWELL_CHORDS, barsPerChord: 2 },
      { fromBar: 20, toBar: 26, chords: BOSS_CHORDS, barsPerChord: 2 },
      { fromBar: 26, toBar: 30, chords: RESTORATION_CHORDS, barsPerChord: 2 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
    leadSet: (chord) => [...chord.arp, ...chord.arp.map((m) => m + 12)],
  });

  const instruments = createStrandlineVoices({
    context: () => ctx,
    mix: () => runtime.mix(),
  });

  const runtime = createBeatLevelAudio({
    bus,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.005, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.35, dampHz: 2800 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep(step: BeatLevelAudioStep) {
      if (!ctx) return;
      scheduleStepMusic(step);
    },
    onRunStart() {
      score.clearOverride();
      isPurified = false;
    },
    onRunEnd() {
      score.clearOverride();
    },
    onDispose() {
      ctx = null;
    },
  });

  // Schedule arrangement backing music per 16th-note step
  function scheduleStepMusic(step: BeatLevelAudioStep) {
    if (!ctx) return;
    const time = step.time;
    const stepInBar = step.step % STEPS_PER_BAR;
    const barIndex = Math.floor(step.step / STEPS_PER_BAR);
    const chord = score.chordAt(step.position);
    const section = score.sectionMixAt(step.position);

    // 1. Kick drum
    if (section.to === 0) {
      // Atmospheric ambient pulse in section 0
      if (stepInBar === 0 && barIndex % 2 === 0) {
        instruments.kick(time, 0.7);
      }
    } else if (section.to === 1 || section.to === 2 || section.to === 3) {
      // Four-on-the-floor kick
      if (stepInBar % 4 === 0) {
        instruments.kick(time, stepInBar === 0 ? 0.95 : 0.82);
      }
    } else if (section.to === 4) {
      // Serene pulse in restoration
      if (stepInBar === 0) {
        instruments.kick(time, 0.5);
      }
    }

    // 2. Claps / Snare
    if ((section.to === 1 || section.to === 2 || section.to === 3) && (stepInBar === 4 || stepInBar === 12)) {
      instruments.clap(time);
    }

    // 3. Hi-hats
    if (section.to === 1) {
      if (stepInBar % 2 === 0) instruments.hat(time, stepInBar % 4 === 2 ? 0.6 : 0.35);
    } else if (section.to === 2 || section.to === 3) {
      const isOpen = stepInBar % 4 === 2;
      instruments.hat(time, isOpen ? 0.8 : 0.4, isOpen ? 0.12 : 0.035);
    }

    // 4. Bassline
    if (section.to >= 1 && section.to <= 3 && chord) {
      if (stepInBar === 0 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14) {
        const bassNote = stepInBar === 10 ? chord.bass + 7 : chord.bass;
        instruments.bass(time, bassNote, 0.8);
      }
    }

    // 5. Pads (scheduled on bar boundaries)
    if (stepInBar === 0 && chord) {
      const padDuration = STRANDLINE_TIME.barSeconds * (section.to === 4 ? 2.0 : 1.0);
      instruments.pad(time, chord.pad, padDuration, section.to === 4 ? 1.4 : 1.0);
    }

    // 6. Bell arpeggios
    if (chord && (section.to === 1 || section.to === 2 || section.to === 4)) {
      if (stepInBar % 2 === 0) {
        const arpIndex = (stepInBar / 2) % chord.arp.length;
        const note = chord.arp[arpIndex];
        instruments.bell(time, note, section.to === 4 ? 0.6 : 0.45);
      }
    }
  }

  // Hook into gameplay events for musical actions
  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const midi = chord ? chord.arp[Math.min(lockCount - 1, chord.arp.length - 1)] + 12 : 74;
    instruments.playerLock(time, midi);
  });

  bus.on('fire', () => {
    if (!ctx) return;
    instruments.playerFire(ctx.currentTime);
  });

  bus.on('hit', ({ lethal }) => {
    if (!ctx) return;
    instruments.playerHit(ctx.currentTime, lethal);
  });

  bus.on('kill', () => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const section = score.sectionMixAt(position);
    const voiceSpec = SECTION_KILL_VOICES[section.to as SectionIndex] ?? SECTION_KILL_VOICES[0];
    instruments.playerKill(kill.time, kill.midi, voiceSpec);
  });

  bus.on('reject', () => {
    if (!ctx) return;
    instruments.playerReject(ctx.currentTime);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') {
      isPurified = true;
      if (ctx) {
        runtime.mix()?.duckAt(ctx.currentTime, 0.8, 0.6);
      }
    }
  });

  return runtime.audio;
}
