import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq, secondsPerStep } from '../../engine/music';
import { TINKER_BALL_XA2F_BPM } from './timing';
import {
  bassVoice,
  fireSfx,
  hitSfx,
  lockSfx,
  malletVoice,
  organVoice,
  playerHitSfx,
  playWorkshopPercussion,
  rejectSfx,
} from './audio-voices';

const STEP_SECONDS = secondsPerStep(TINKER_BALL_XA2F_BPM, 1);

// Bright Eccentric Pop Chords (MIDI pitches)
const CHORDS = [
  { bass: 36, chord: [60, 64, 67, 71], lead: [72, 76, 79, 83, 84, 88, 91, 95] }, // Cmaj7
  { bass: 41, chord: [65, 69, 72, 76], lead: [77, 81, 84, 88, 89, 93, 96, 100] }, // Fmaj7
  { bass: 33, chord: [57, 60, 64, 67], lead: [69, 72, 76, 79, 81, 84, 88, 91] }, // Am7
  { bass: 35, chord: [59, 62, 65, 67], lead: [71, 74, 77, 79, 83, 86, 89, 91] }, // G7/G6
];

// Melodic kill lane scale steps
const KILL_LANE = [0, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7];

export function createTinkerBallAudio(bus: EventBus, trace?: AudioTraceSink) {
  let stepIndex = 0;

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP_SECONDS,
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.005, release: 0.2 },
      noiseSeconds: 2,
    },
    onStep(step) {
      const audioCtx = runtime.context();
      const mixBus = runtime.mix();
      if (!audioCtx || !mixBus) return;

      const destination = mixBus.music;
      const noiseBuf = mixBus.noiseBuffer;
      const time = step.time;

      const bar = Math.floor(stepIndex / 16);
      const stepInBar = stepIndex % 16;
      const chordObj = CHORDS[bar % CHORDS.length];

      // Percussion: Ticks, Wood taps, Handclaps
      if (noiseBuf) {
        if (stepInBar % 2 === 0) {
          playWorkshopPercussion(audioCtx, noiseBuf, mixBus.sfx, time, 'tick');
        }
        if (stepInBar === 4 || stepInBar === 12) {
          playWorkshopPercussion(audioCtx, noiseBuf, mixBus.sfx, time, 'clap');
        }
        if (stepInBar % 4 === 2) {
          playWorkshopPercussion(audioCtx, noiseBuf, mixBus.sfx, time, 'wood');
        }
      }

      // Bouncy Synth Bass
      if ([0, 3, 6, 8, 10, 12, 14].includes(stepInBar)) {
        const bassFreq = midiToFreq(chordObj.bass);
        bassVoice.play({ context: audioCtx, destination, time, frequency: bassFreq, gain: 0.35 });
      }

      // Reed-Organ Stabs (Off-beats)
      if (stepInBar === 4 || stepInBar === 12 || stepInBar === 14) {
        for (const p of chordObj.chord) {
          const freq = midiToFreq(p);
          organVoice.play({ context: audioCtx, destination, time, frequency: freq, gain: 0.12 });
        }
      }

      // Mallet Arpeggios (Act 2 & 3)
      if (bar >= 8 && stepInBar % 2 === 1) {
        const leadIdx = (stepInBar / 2) % chordObj.lead.length;
        const note = chordObj.lead[Math.floor(leadIdx)];
        const freq = midiToFreq(note);
        malletVoice.play({ context: audioCtx, destination, time, frequency: freq, gain: 0.18 });
      }

      stepIndex++;
    },
  });

  // Gameplay SFX listeners
  bus.on('lock', ({ lockCount }) => {
    const audioCtx = runtime.context();
    const mixBus = runtime.mix();
    if (!audioCtx || !mixBus) return;
    const midi = 72 + lockCount * 2;
    lockSfx.play({ context: audioCtx, destination: mixBus.sfx, time: audioCtx.currentTime, midi, gain: 0.2 });
  });

  bus.on('fire', () => {
    const audioCtx = runtime.context();
    const mixBus = runtime.mix();
    if (!audioCtx || !mixBus) return;
    fireSfx.play({ context: audioCtx, destination: mixBus.sfx, time: audioCtx.currentTime, midi: 84, gain: 0.25 });
  });

  bus.on('hit', () => {
    const audioCtx = runtime.context();
    const mixBus = runtime.mix();
    if (!audioCtx || !mixBus) return;
    hitSfx.play({ context: audioCtx, destination: mixBus.sfx, time: audioCtx.currentTime, midi: 60, gain: 0.3 });
  });

  bus.on('kill', () => {
    const audioCtx = runtime.context();
    const mixBus = runtime.mix();
    if (!audioCtx || !mixBus) return;
    const bar = Math.floor(stepIndex / 16);
    const chordObj = CHORDS[bar % CHORDS.length];
    const laneDegree = KILL_LANE[stepIndex % KILL_LANE.length];
    const note = chordObj.lead[laneDegree % chordObj.lead.length];
    const freq = midiToFreq(note);
    malletVoice.play({ context: audioCtx, destination: mixBus.sfx, time: audioCtx.currentTime, frequency: freq, gain: 0.4 });
  });

  bus.on('reject', () => {
    const audioCtx = runtime.context();
    const mixBus = runtime.mix();
    if (!audioCtx || !mixBus) return;
    rejectSfx.play({ context: audioCtx, destination: mixBus.sfx, time: audioCtx.currentTime, midi: 48, gain: 0.3 });
  });

  bus.on('playerhit', () => {
    const audioCtx = runtime.context();
    const mixBus = runtime.mix();
    if (!audioCtx || !mixBus) return;
    playerHitSfx.play({ context: audioCtx, destination: mixBus.sfx, time: audioCtx.currentTime, midi: 36, gain: 0.4 });
  });

  return runtime;
}

export function createAudio(bus: EventBus) {
  return createTinkerBallAudio(bus).audio;
}

export const traceAudio = createAudioTraceHarness({
  level: 'tinker-ball-xa2f',
  bpm: TINKER_BALL_XA2F_BPM,
  stepSeconds: STEP_SECONDS,
  defaultSeconds: 60,
  createAudio: createTinkerBallAudio,
});
