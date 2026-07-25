import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { VESPERS_C8VR_BPM, VESPERS_C8VR_STEPS_PER_BAR, VESPERS_SECTIONS } from './timing';
import {
  playChoirSwellVoice,
  playOrganFireSound,
  playOrganKillSound,
  playOrganLockSound,
  playOrganVoice,
  playOrganRejectSound,
  playPedalVoice,
  playTuttiOrganVoice,
} from './audio-voices';

// Polyphonic Organ Harmony in D Minor, turning to D Major for the finale
const CHORDS_MINOR = [
  { bass: 38, pad: [50, 53, 57, 60], lead: [62, 65, 69, 72, 74, 77, 81, 84] }, // Dm7
  { bass: 34, pad: [46, 50, 53, 57], lead: [58, 62, 65, 69, 70, 74, 77, 81] }, // Bbmaj7
  { bass: 31, pad: [43, 46, 50, 53], lead: [55, 58, 62, 65, 67, 70, 74, 77] }, // Gm7
  { bass: 33, pad: [45, 49, 52, 55], lead: [57, 61, 64, 67, 69, 73, 76, 79] }, // A7
];

const CHORDS_MAJOR = [
  { bass: 38, pad: [50, 54, 57, 61], lead: [62, 66, 69, 73, 74, 78, 81, 85] }, // Dmaj7
  { bass: 31, pad: [43, 47, 50, 54], lead: [55, 59, 62, 66, 67, 71, 74, 78] }, // Gmaj7
  { bass: 33, pad: [45, 49, 52, 57], lead: [57, 61, 64, 69, 73, 76, 81, 85] }, // A7
  { bass: 26, pad: [38, 50, 54, 57, 62], lead: [62, 66, 69, 74, 78, 81, 86, 90] }, // D Major Tutti
];

const LOCK_SCALE_MINOR = [62, 65, 67, 69, 72, 74, 77, 79];
const LOCK_SCALE_MAJOR = [62, 66, 67, 69, 73, 74, 78, 79];

// Melodic Organ Kill Lanes (degrees 0..7)
const KILL_LANES: Record<string, number[]> = {
  intro: [0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 2],
  wave1: [0, 1, 2, 3, 2, 3, 4, 5, 4, 5, 6, 7, 6, 5, 4, 3, 0, 2, 4, 5, 3, 5, 6, 7, 5, 6, 7, 6, 5, 4, 2, 0],
  quietSpan: [0, 2, 4, 5, 4, 2, 0, 2, 4, 5, 6, 5, 4, 2, 0, 2, 0, 2, 4, 5, 4, 2, 0, 2, 4, 5, 6, 5, 4, 2, 0, 2],
  boss: [0, 4, 2, 6, 1, 5, 3, 7, 4, 7, 3, 6, 2, 5, 1, 4, 7, 6, 5, 4, 3, 2, 1, 0, 0, 2, 4, 6, 7, 5, 3, 1],
  finale: [0, 2, 4, 7, 4, 7, 6, 7, 2, 4, 6, 7, 5, 7, 6, 7, 4, 5, 6, 7, 6, 7, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0],
};

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-c8vr',
  bpm: VESPERS_C8VR_BPM,
  stepSeconds: (60 / VESPERS_C8VR_BPM) / 4,
  defaultSeconds: 60,
  createAudio: createVespersAudio,
});

export function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let isMajor = false;

  const score = createScore({
    bpm: VESPERS_C8VR_BPM,
    stepsPerBar: VESPERS_C8VR_STEPS_PER_BAR,
    chords: CHORDS_MINOR,
    leadSet: (chord) => chord.lead,
    sections: VESPERS_SECTIONS,
    killLanes: KILL_LANES,
  });

  const beatAudio = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: score.stepSeconds,
    mix: {
      compressor: { threshold: -16, ratio: 4, attack: 0.01, release: 0.25 },
    },
    onStep(step: BeatLevelAudioStep) {
      if (step.step === 0) {
        score.setEpoch(step.time);
      }

      const barIndex = step.bar;
      const stepInBar = step.step % VESPERS_C8VR_STEPS_PER_BAR;
      const ctx = beatAudio.context();
      const mix = beatAudio.mix();
      if (!ctx || !mix) return;

      const mainOut = mix.music;

      // Check if we entered finale (bar 27+) -> Major key modulation!
      if (barIndex >= 27 && !isMajor) {
        isMajor = true;
      }

      const chords = isMajor ? CHORDS_MAJOR : CHORDS_MINOR;
      const chordIndex = barIndex % chords.length;
      const activeChord = chords[chordIndex];

      // 1. ORGAN PEDAL NOTE (Every 2 bars / on bar downbeats)
      if (stepInBar === 0 && barIndex % 2 === 0) {
        if (barIndex < 14 || barIndex >= 19) {
          playPedalVoice(ctx, mainOut, step.time, activeChord.bass * 2.45, score.stepSeconds * 32, isMajor ? 0.4 : 0.3);
        } else if (barIndex >= 14 && barIndex < 19) {
          // Mid-run Quiet Span: Single quiet pedal drone
          playPedalVoice(ctx, mainOut, step.time, 73.42, score.stepSeconds * 32, 0.2); // Low D2
        }
      }

      // 2. COUNTERPOINT ORGAN VOICES
      // Voice 1: Tenor Organ Line (Wave 1, Boss, Finale)
      if (barIndex >= 4 && barIndex < 14) {
        if (stepInBar % 4 === 0) {
          const noteIndex = Math.floor(stepInBar / 4);
          const noteMidi = activeChord.pad[noteIndex % activeChord.pad.length];
          playOrganVoice(ctx, mainOut, step.time, noteMidiToFreq(noteMidi), score.stepSeconds * 3.8, 0.18, false);
        }
      }

      // Voice 2: Soaring Flue Melody (Wave 1, Quiet Span, Boss)
      if (barIndex >= 8 && barIndex < 14) {
        if (stepInBar % 2 === 0) {
          const leadIdx = (stepInBar / 2) % activeChord.lead.length;
          const noteMidi = activeChord.lead[leadIdx];
          playOrganVoice(ctx, mainOut, step.time, noteMidiToFreq(noteMidi), score.stepSeconds * 1.8, 0.14, true);
        }
      }

      // Mid-Run Quiet Span (Bar 14 - 18): Single solo flute organ voice, ultra sparse!
      if (barIndex >= 14 && barIndex < 19) {
        if (stepInBar === 0 || stepInBar === 8) {
          const noteMidi = stepInBar === 0 ? 62 : 65; // High quiet D4 / F4 flute note
          playOrganVoice(ctx, mainOut, step.time, noteMidiToFreq(noteMidi), score.stepSeconds * 7.5, 0.12, false);
        }
      }

      // Voice 3: Boss Fight Choir & Organ Toccata (Bar 19 - 26)
      if (barIndex >= 19 && barIndex < 27) {
        if (stepInBar % 4 === 0) {
          const choirNote = activeChord.pad[0] + 12;
          playChoirSwellVoice(ctx, mainOut, step.time, noteMidiToFreq(choirNote), score.stepSeconds * 3.8, 0.18);
        }
        if (stepInBar % 2 === 0) {
          const leadIdx = stepInBar % activeChord.lead.length;
          playOrganVoice(ctx, mainOut, step.time, noteMidiToFreq(activeChord.lead[leadIdx]), score.stepSeconds * 1.9, 0.16, true);
        }
      }

      // Voice 4 (THE HELD-BACK TUTTI ORGAN RANK): Opens ONLY at Finale (Bar 27 - 30)!
      if (barIndex >= 27) {
        if (stepInBar % 4 === 0) {
          const chordNotes = activeChord.pad;
          for (const note of chordNotes) {
            playTuttiOrganVoice(ctx, mainOut, step.time, noteMidiToFreq(note + 12), score.stepSeconds * 3.8, 0.22);
          }
        }
        if (stepInBar % 2 === 0) {
          const leadIdx = (stepInBar + Math.floor(barIndex)) % activeChord.lead.length;
          playTuttiOrganVoice(ctx, mainOut, step.time, noteMidiToFreq(activeChord.lead[leadIdx]), score.stepSeconds * 1.8, 0.25);
        }
      }
    },
  });

  // Subscribe to gameplay events for organ action audio!
  bus.on('lock', (e) => {
    const ctx = beatAudio.context();
    const mix = beatAudio.mix();
    if (!ctx || !mix) return;

    const time = score.quantizePlayerAction(ctx.currentTime);
    const lockScale = isMajor ? LOCK_SCALE_MAJOR : LOCK_SCALE_MINOR;
    const note = lockScale[Math.min(e.lockCount - 1, lockScale.length - 1)];
    playOrganLockSound(ctx, mix.sfx, time, note);
  });

  bus.on('fire', (e) => {
    const ctx = beatAudio.context();
    const mix = beatAudio.mix();
    if (!ctx || !mix) return;

    const time = score.quantizePlayerAction(ctx.currentTime);
    const lockScale = isMajor ? LOCK_SCALE_MAJOR : LOCK_SCALE_MINOR;
    const count = Math.min(e.volleySize, 6);
    const notes = lockScale.slice(0, count);
    playOrganFireSound(ctx, mix.sfx, time, notes);
  });

  bus.on('kill', () => {
    const ctx = beatAudio.context();
    const mix = beatAudio.mix();
    if (!ctx || !mix) return;

    const killInfo = score.nextKill(ctx.currentTime);
    const bar = Math.floor(killInfo.step / VESPERS_C8VR_STEPS_PER_BAR);
    const laneKey = bar >= 27 ? 'finale' : bar >= 19 ? 'boss' : bar >= 14 ? 'quietSpan' : bar >= 4 ? 'wave1' : 'intro';
    const lane = KILL_LANES[laneKey];
    const stepInLane = killInfo.step % lane.length;
    const deg = lane[stepInLane];

    const chords = isMajor ? CHORDS_MAJOR : CHORDS_MINOR;
    const activeChord = chords[bar % chords.length];
    const midiNote = activeChord.lead[deg % activeChord.lead.length];

    playOrganKillSound(ctx, mix.sfx, killInfo.time, midiNote, bar >= 27);
  });

  bus.on('reject', () => {
    const ctx = beatAudio.context();
    const mix = beatAudio.mix();
    if (!ctx || !mix) return;

    const time = score.quantizePlayerAction(ctx.currentTime);
    playOrganRejectSound(ctx, mix.sfx, time);
  });

  return beatAudio;
}

function noteMidiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
