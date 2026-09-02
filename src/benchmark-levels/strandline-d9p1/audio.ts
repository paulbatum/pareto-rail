import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioRuntime,
  type BeatLevelAudioStep,
  type MixBus,
} from '../../engine/audio-kit';
import { midiToFreq } from '../../engine/music';
import { createScore, type KillLaneResult, type Score } from '../../engine/score';
import { createStrandlineVoices } from './audio-voices';
import {
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
} from './timing';

export { STRANDLINE_BPM } from './timing';

type Chord = { bass: number; pad: number[]; arp: number[] };

// Open oceanic progression in D minor / F Major (Sections 0, 1, 2)
const MAIN_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 60, 64, 65], arp: [65, 69, 72, 76] }, // Dm9
  { bass: 34, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] }, // Bbmaj9
  { bass: 33, pad: [57, 60, 64, 67], arp: [64, 67, 72, 76] }, // Am7
  { bass: 31, pad: [55, 58, 62, 65], arp: [62, 67, 70, 74] }, // Gm9
];

// Boss confrontation at the crown (Section 3, bars 18-22)
// Chromatic tension of the parasite nest: Dm - Ebdim7 - Dm - Bb7
const BOSS_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 62, 65, 69], arp: [62, 65, 69, 74] }, // Dm
  { bass: 39, pad: [57, 60, 63, 66], arp: [63, 66, 69, 72] }, // Ebdim7
  { bass: 38, pad: [57, 62, 65, 69], arp: [62, 65, 69, 74] }, // Dm
  { bass: 34, pad: [58, 62, 65, 68], arp: [62, 65, 68, 70] }, // Bb7
];

// Serene resolution after boss kill (Section 4, bars 22-24)
// Dsus4 - Dmaj9 - Gmaj9 - D (pure oceanic luminous peace)
const SERENITY_CHORDS: Chord[] = [
  { bass: 38, pad: [57, 62, 67, 69], arp: [62, 67, 69, 74] }, // Dsus4
  { bass: 38, pad: [57, 61, 64, 69], arp: [61, 64, 69, 73] }, // Dmaj9
  { bass: 31, pad: [55, 59, 62, 66], arp: [62, 66, 69, 74] }, // Gmaj9
  { bass: 38, pad: [57, 62, 66, 69], arp: [62, 66, 69, 74] }, // D
];

type SectionId = 0 | 1 | 2 | 3 | 4;

// Melodic kill lanes: when chained volleys land, kills walk these melodic steps,
// turning volleys into fluid aquatic harp arpeggios.
const KILL_LANES: Record<SectionId, number[]> = {
  // 0: Shallows - gentle climbing arches
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 4,
  ],
  // 1: Forest & Vista - dancing broken chord leaps
  1: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 6, 5, 7, 6, 4, 3, 1,
    0, 3, 2, 5, 4, 6, 5, 7,
    6, 4, 5, 3, 4, 2, 1, 0,
  ],
  // 2: Crown Ascent - bright rising melodic runs
  2: [
    1, 3, 5, 7, 2, 4, 6, 7,
    3, 5, 7, 6, 5, 4, 3, 2,
    2, 4, 5, 7, 3, 5, 6, 7,
    7, 6, 5, 4, 5, 6, 7, 7,
  ],
  // 3: Boss Encounter - dramatic, urgent descents
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    5, 4, 3, 2, 3, 2, 1, 0,
    3, 2, 1, 0, 2, 3, 4, 6,
  ],
  // 4: Serenity - warm tranquil resolutions
  4: [
    4, 3, 2, 1, 2, 1, 0, 1,
    2, 3, 4, 5, 4, 3, 2, 0,
    1, 2, 3, 4, 5, 6, 7, 5,
    4, 3, 2, 1, 0, 1, 2, 0,
  ],
};

export function createScoreInternal(): Score<Chord, SectionId> {
  return createScore<Chord, SectionId>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STRANDLINE_STEPS_PER_BAR,
    chords: MAIN_CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: STRANDLINE_BARS.boss, toBar: STRANDLINE_BARS.serenity, chords: BOSS_CHORDS, barsPerChord: 1 },
      { fromBar: STRANDLINE_BARS.serenity, toBar: STRANDLINE_BARS.end, chords: SERENITY_CHORDS, barsPerChord: 1 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });
}

export function createAudio(bus: EventBus) {
  const score = createScoreInternal();
  let voices: ReturnType<typeof createStrandlineVoices> | null = null;
  let mixBus: MixBus | null = null;
  let audioCtx: AudioContext | null = null;

  // Track enemy kinds to detect boss kill
  const enemyKinds = new Map<number, string>();

  bus.on('runstart', () => {
    enemyKinds.clear();
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
  });

  bus.on('lock', ({ lockCount }) => {
    if (!audioCtx || !voices) return;
    const time = score.quantizePlayerAction(audioCtx.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const arpNotes = chord?.arp ?? [65, 69, 72, 76];
    const midi = arpNotes[(lockCount - 1) % arpNotes.length] ?? 69;
    voices.playPlayerLock(time, midi);
  });

  bus.on('fire', () => {
    if (!audioCtx || !voices) return;
    voices.playPlayerFire(audioCtx.currentTime);
  });

  bus.on('hit', () => {
    if (!audioCtx || !voices) return;
    voices.playPlayerHit(audioCtx.currentTime);
  });

  bus.on('kill', ({ enemyId }) => {
    if (!audioCtx || !voices) return;
    const kind = enemyKinds.get(enemyId);
    const isParent = kind === 'parent';
    const time = audioCtx.currentTime;
    const killResult: KillLaneResult = score.nextKill(time);
    voices.playPlayerKill(killResult.time, killResult.midi, isParent);
    enemyKinds.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    enemyKinds.delete(enemyId);
  });

  bus.on('reject', () => {
    if (!audioCtx || !mixBus) return;
    const t = audioCtx.currentTime;
    playOscillatorVoice({
      context: audioCtx,
      time: t,
      stopTime: t + 0.22,
      oscillatorType: 'sine',
      frequency: 130,
      frequencyAutomation: [
        { type: 'exponentialRamp', value: 55, time: t + 0.18 },
      ],
      gainAutomation: [
        { type: 'set', value: 0.18, time: t },
        { type: 'exponentialRamp', value: 0.001, time: t + 0.2 },
      ],
      destination: mixBus.sfx,
    });
  });

  return createBeatLevelAudio({
    bus,
    score,
    stepSeconds: STRANDLINE_TIME.stepSeconds,
    stepsPerBar: STRANDLINE_STEPS_PER_BAR,
    mix: {
      compressor: { threshold: -16, ratio: 4, attack: 0.008, release: 0.25 },
      reverb: { seconds: 2.5, decay: 2.0, level: 0.28 },
    },
    onPostBuild(context, mix) {
      audioCtx = context;
      mixBus = mix;
      voices = createStrandlineVoices(context, mix);
    },
    onStep({ position, step, bar, time }) {
      if (!audioCtx || !mixBus || !voices) return;

      const chord = score.chordAt(position);
      if (!chord) return;

      const sectionMix = score.sectionMixAt(position);
      const sectionIndex = sectionMix.to;

      // 1. Ocean Pad: Sustained background swell every 2 bars or at downbeat
      if (step === 0 && bar % 2 === 0) {
        for (const padMidi of chord.pad) {
          voices.oceanPad.play({
            context: audioCtx,
            time,
            destination: mixBus.music,
            midi: padMidi,
            gain: sectionIndex === 4 ? 0.35 : 0.22,
          });
        }
      }

      // 2. Sub Bass: Root on bar start and syncopated pulses
      if (step === 0 || (sectionIndex >= 1 && step === 10)) {
        voices.subBass.play({
          context: audioCtx,
          time,
          destination: mixBus.music,
          midi: chord.bass,
          gain: 0.35,
        });
      }

      // 3. Plankton Arp: Resonant marimba/water bell pattern
      if (sectionIndex >= 1 && sectionIndex < 4) {
        // Rhythmic sixteenth-note arpeggio
        if (step % 2 === 0) {
          const arpIndex = (step / 2) % chord.arp.length;
          const midi = chord.arp[arpIndex];
          voices.waterBell.play({
            context: audioCtx,
            time,
            destination: mixBus.music,
            midi,
            gain: 0.16,
          });
        }
      }

      // Serenity Section: Sparkling gentle bells
      if (sectionIndex === 4 && (step === 0 || step === 4 || step === 7 || step === 11)) {
        const midi = chord.arp[(step / 3) % chord.arp.length] + 12;
        voices.waterBell.play({
          context: audioCtx,
          time,
          destination: mixBus.music,
          midi,
          gain: 0.22,
        });
      }

      // 4. Rhythm & Percussion
      // Shallows (Section 0): minimal, solitary pulse
      if (sectionIndex === 0) {
        if (step === 0 && bar % 2 === 0) voices.playKick(time, 0.35);
        if (step === 8) voices.playTick(time, 0.08);
      }

      // Forest & Vista (Section 1): light aquatic groove
      if (sectionIndex === 1) {
        if (step === 0 || step === 10) voices.playKick(time, 0.4);
        if (step === 4 || step === 12) voices.playWaterSnare(time, 0.2);
        if (step % 2 === 0) voices.playTick(time, 0.12);
      }

      // Crown Ascent (Section 2): driving energetic climb
      if (sectionIndex === 2) {
        if (step === 0 || step === 6 || step === 10) voices.playKick(time, 0.48);
        if (step === 4 || step === 12) voices.playWaterSnare(time, 0.26);
        if (step % 2 === 0) voices.playTick(time, 0.16);
      }

      // Boss Fight (Section 3): intense pounding pulse + parasite stabs
      if (sectionIndex === 3) {
        if (step % 4 === 0) voices.playKick(time, 0.55); // 4-on-the-floor
        if (step === 4 || step === 12) voices.playWaterSnare(time, 0.32);
        if (step === 2 || step === 8 || step === 14) {
          voices.parasiteVoice.play({
            context: audioCtx,
            time,
            destination: mixBus.music,
            midi: chord.bass + 24,
            gain: 0.24,
          });
        }
      }
    },
    onDispose() {
      audioCtx = null;
      mixBus = null;
      voices = null;
    },
  }).audio;
}
