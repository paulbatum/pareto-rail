import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  defineInstruments,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { midiToFreq, secondsPerStep } from '../../engine/music';
import { createScore, type ScoreAlternateChordSet } from '../../engine/score';
import { BROADSIDE_9IMA_BPM } from './gameplay';
import {
  alarmVoice,
  broadsideCannonNoise,
  broadsideCannonTone,
  cymbalNoise,
  highBrassVoice,
  lowBrassVoice,
  playerFireVoice,
  playerKillVoice,
  playerLockVoice,
  snareNoise,
  snareTone,
  stringsOstinatoVoice,
  stringsPadVoice,
  timpaniVoice,
} from './audio-voices';
import { triggerBroadsideEffect } from './visuals';
import { Vector3 } from 'three';

const STEPS_PER_BAR = 16;
const STEP_SECONDS = secondsPerStep(BROADSIDE_9IMA_BPM, 4); // 16th note step = 0.125s

type Section =
  | 'launch'
  | 'crossfire'
  | 'flank'
  | 'belly'
  | 'eye'
  | 'boss1'
  | 'turnaround'
  | 'trench'
  | 'victory';

type Chord = {
  root: number;
  timpani: number;
  pad: number[];
  lead: readonly number[];
};

// Orchestral harmony in D minor transitioning to D Major victory
const D_MIN: Chord = {
  root: 38, // D2
  timpani: 50, // D3
  pad: [62, 65, 69], // D4, F4, A4
  lead: [62, 65, 69, 74, 77, 81, 86, 89],
};

const B_FLAT: Chord = {
  root: 34, // Bb1
  timpani: 46, // Bb2
  pad: [58, 62, 65], // Bb3, D4, F4
  lead: [58, 62, 65, 70, 74, 77, 82, 86],
};

const G_MIN: Chord = {
  root: 31, // G1
  timpani: 43, // G2
  pad: [55, 58, 62], // G3, Bb3, D4
  lead: [55, 58, 62, 67, 70, 74, 79, 82],
};

const A_SEVEN: Chord = {
  root: 33, // A1
  timpani: 45, // A2
  pad: [57, 61, 64], // A3, C#4, E4
  lead: [57, 61, 64, 69, 73, 76, 81, 85],
};

const E_FLAT: Chord = {
  root: 27, // Eb1
  timpani: 39, // Eb2
  pad: [51, 55, 58], // Eb3, G3, Bb3
  lead: [51, 55, 58, 63, 67, 70, 75, 79],
};

const F_MAJ: Chord = {
  root: 29, // F1
  timpani: 41, // F2
  pad: [53, 57, 60], // F3, A3, C4
  lead: [53, 57, 60, 65, 69, 72, 77, 81],
};

const D_MAJ_VICTORY: Chord = {
  root: 38, // D2
  timpani: 50, // D3
  pad: [62, 66, 69], // D4, F#4, A4 (Picardy third!)
  lead: [62, 66, 69, 74, 78, 81, 86, 90],
};

// Base chord progression: Dm -> Bb -> Gm -> A7 (2 bars each)
const BASE_CHORDS: readonly Chord[] = [D_MIN, B_FLAT, G_MIN, A_SEVEN];

// Alternate chord sets for narrative set pieces
const ALTERNATE_CHORDS: readonly ScoreAlternateChordSet<Chord>[] = [
  // Eye of battle & Boss Phase 1: Dm (2 bars), Eb (2 bars), Dm (1 bar), A7 (1 bar)
  {
    fromBar: 20,
    toBar: 26,
    barsPerChord: 1,
    chords: [D_MIN, D_MIN, E_FLAT, E_FLAT, D_MIN, A_SEVEN],
  },
  // Trench Run & Grand Victory: Dm, F, Gm, D Major Victory (2 bars)
  {
    fromBar: 26,
    toBar: 31,
    barsPerChord: 1,
    chords: [D_MIN, F_MAJ, G_MIN, D_MAJ_VICTORY, D_MAJ_VICTORY],
  },
];

const SECTIONS = [
  { index: 'launch', fromBar: 0 },
  { index: 'crossfire', fromBar: 4 },
  { index: 'flank', fromBar: 10 },
  { index: 'belly', fromBar: 16 },
  { index: 'eye', fromBar: 20 },
  { index: 'boss1', fromBar: 22 },
  { index: 'turnaround', fromBar: 25 },
  { index: 'trench', fromBar: 27 },
  { index: 'victory', fromBar: 29 },
] as const;

// Written melodic kill lanes for each section so chained volleys play heroic solos
const KILL_LANES: Record<Section, readonly number[]> = {
  launch: [0, 1, 2, 3, 2, 3, 4, 5, 4, 3, 4, 5, 6, 5, 4, 3],
  crossfire: [1, 2, 4, 3, 5, 4, 6, 5, 4, 3, 5, 6, 7, 6, 5, 4],
  flank: [2, 4, 3, 5, 4, 6, 5, 7, 6, 5, 4, 5, 6, 7, 6, 4],
  belly: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 3, 2, 1, 0],
  eye: [0, 1, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
  boss1: [3, 4, 5, 4, 6, 5, 7, 6, 5, 4, 6, 7, 6, 5, 4, 2],
  turnaround: [4, 5, 6, 5, 7, 6, 5, 4, 3, 4, 5, 6, 7, 6, 5, 3],
  trench: [2, 4, 5, 6, 5, 7, 6, 5, 4, 6, 7, 6, 7, 6, 5, 4],
  victory: [0, 2, 4, 3, 4, 5, 6, 7, 6, 5, 6, 7, 7, 6, 5, 7],
};

export function createAudio(bus: EventBus) {
  const score = createScore<Chord, Section>({
    bpm: BROADSIDE_9IMA_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: BASE_CHORDS,
    barsPerChord: 2,
    alternateChordSets: ALTERNATE_CHORDS,
    sections: SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    score,
    bpm: BROADSIDE_9IMA_BPM,
    stepSeconds: STEP_SECONDS,
    stepsPerBar: STEPS_PER_BAR,
    scheduleAhead: 0.14,
    schedulerMs: 25,
    volumeScale: 0.8,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -18, ratio: 5.0, attack: 0.005, release: 0.22 },
      noiseSeconds: 2,
      delay: {
        maxTime: 1,
        time: STEP_SECONDS * 3,
        feedback: 0.22,
        dampHz: 2200,
        dampType: 'lowpass',
        sendGain: 0.2,
        returnTo: 'master',
      },
      reverb: { seconds: 1.2, decay: 2.8, level: 0.22, returnTo: 'master' },
    },
    onStep: scheduleStep,
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const time = context.currentTime + 0.05;
      inst.highBrass(time, 74, 1.0); // High D triumphant final ring
      inst.timpani(time, 50, 1.0);
      inst.cymbal(time, 1.0);
    },
  });

  const inst = defineInstruments(
    { context: runtime.context },
    {
      timpani(context, time, midi = 50, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.music) return;
        timpaniVoice.play({
          context,
          time,
          frequency: midiToFreq(midi),
          velocity: velocity * 0.85,
          destination: mix.music,
          sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.25 }] : undefined,
        });
      },
      snare(context, time, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.music || !mix.noiseBuffer) return;
        snareTone.play({
          context,
          time,
          frequency: 185,
          velocity: velocity * 0.7,
          destination: mix.music,
        });
        snareNoise.play({
          context,
          buffer: mix.noiseBuffer,
          time,
          velocity: velocity * 0.6,
          destination: mix.music,
          offset: Math.random() * 1.5,
        });
      },
      cymbal(context, time, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.music || !mix.noiseBuffer) return;
        cymbalNoise.play({
          context,
          buffer: mix.noiseBuffer,
          time,
          velocity: velocity * 0.75,
          destination: mix.music,
          offset: Math.random() * 1.5,
        });
      },
      lowBrass(context, time, midi = 38, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.music) return;
        lowBrassVoice.play({
          context,
          time,
          midi,
          velocity: velocity * 0.72,
          destination: mix.music,
          sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.2 }] : undefined,
        });
      },
      highBrass(context, time, midi = 62, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.music) return;
        highBrassVoice.play({
          context,
          time,
          midi,
          velocity: velocity * 0.78,
          destination: mix.music,
          sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.24 }] : undefined,
        });
      },
      stringsOstinato(context, time, midi = 50, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.music) return;
        stringsOstinatoVoice.play({
          context,
          time,
          midi,
          velocity: velocity * 0.65,
          destination: mix.music,
        });
      },
      stringsPad(context, time, midi = 62, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.music) return;
        stringsPadVoice.play({
          context,
          time,
          midi,
          velocity: velocity * 0.55,
          destination: mix.music,
          sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.3 }] : undefined,
        });
      },
      broadsideCannon(context, time, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.music || !mix.noiseBuffer) return;
        broadsideCannonTone.play({
          context,
          time,
          frequency: 55,
          velocity: velocity * 0.95,
          destination: mix.music,
        });
        broadsideCannonNoise.play({
          context,
          buffer: mix.noiseBuffer,
          time,
          velocity: velocity * 0.85,
          destination: mix.music,
          offset: Math.random() * 1.5,
        });
      },
      playerLock(context, time, midi: number, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.sfx) return;
        playerLockVoice.play({
          context,
          time,
          midi,
          velocity: velocity * 0.65,
          destination: mix.sfx,
          sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.2 }] : undefined,
        });
      },
      playerFire(context, time, midi: number, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.sfx) return;
        playerFireVoice.play({
          context,
          time,
          midi,
          velocity: velocity * 0.7,
          destination: mix.sfx,
        });
      },
      playerKill(context, time, midi: number, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.sfx) return;
        playerKillVoice.play({
          context,
          time,
          midi,
          velocity: velocity * 0.85,
          destination: mix.sfx,
          sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.28 }] : undefined,
        });
      },
      alarm(context, time, velocity = 1) {
        const mix = runtime.mix();
        if (!mix?.sfx) return;
        alarmVoice.play({
          context,
          time,
          midi: 58,
          velocity: velocity * 0.6,
          destination: mix.sfx,
        });
      },
    },
  );

  // Scheduling full space opera orchestration across the 30 bars
  function scheduleStep({ time, step, bar, mode, position }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      // Attract mode: slow distant timpani roll and strings breath
      if (step === 0 && bar % 2 === 0) inst.timpani(time, 50, 0.45);
      if (step === 8 && bar % 2 === 0) inst.stringsPad(time, 62, 0.35);
      return;
    }

    const chord = score.chordAt(position);

    // =========================================================================
    // SECTION 0: LAUNCH (Bars 0-4) - Launch off deck, brass fanfare building
    // =========================================================================
    if (bar < 4) {
      if (step === 0) {
        inst.timpani(time, chord.timpani, 0.9);
        inst.lowBrass(time, chord.root, 0.7);
        inst.stringsPad(time, chord.pad[0], 0.6);
        if (bar === 0) {
          inst.cymbal(time, 0.85);
          inst.highBrass(time, 62, 0.9); // D4 trumpet call
        } else if (bar === 2) {
          inst.highBrass(time, 65, 0.9); // F4
        }
      }
      if (step === 8) {
        inst.timpani(time, chord.timpani, 0.6);
        inst.snare(time, 0.5);
      }
      if (bar >= 2 && step % 4 === 2) {
        inst.snare(time, 0.45);
      }
      if (step % 2 === 0) {
        inst.stringsOstinato(time, chord.root + 12, 0.45);
      }
      return;
    }

    // =========================================================================
    // SECTION 1: CROSSFIRE (Bars 4-10) - Tight banks, crossfire percussion
    // =========================================================================
    if (bar >= 4 && bar < 10) {
      if (step === 0) {
        inst.timpani(time, chord.timpani, 0.95);
        inst.lowBrass(time, chord.root, 0.8);
        inst.stringsPad(time, chord.pad[0], 0.65);
        if (bar === 4 || bar === 8) inst.cymbal(time, 0.8);
      }
      if (step === 6 || step === 14) inst.timpani(time, chord.timpani, 0.65);
      if (step === 4 || step === 12) inst.snare(time, 0.7);
      if (step % 2 === 0) inst.stringsOstinato(time, chord.root + 12, 0.6);
      if (step === 10) inst.snare(time, 0.5);

      // Trumpet phrases answering the ostinato
      if ((bar === 5 || bar === 7 || bar === 9) && step === 4) {
        inst.highBrass(time, chord.lead[4], 0.8);
      }
      return;
    }

    // =========================================================================
    // SECTION 2: FLANK RUN (Bars 10-16) - Friendly cruiser flank & broadsides!
    // =========================================================================
    if (bar >= 10 && bar < 16) {
      if (step === 0) {
        inst.timpani(time, chord.timpani, 1.0);
        inst.lowBrass(time, chord.root, 0.9);
        inst.cymbal(time, 0.9);
        inst.stringsPad(time, chord.pad[0], 0.8);
        inst.highBrass(time, chord.lead[3], 0.95);

        // Friendly broadside cannon salvo lights off overhead!
        if (bar % 2 === 0) {
          inst.broadsideCannon(time, 1.0);
          triggerBroadsideEffect(
            new Vector3(45, 30, -750 - (bar - 10) * 60),
            new Vector3(-180, 10, -950 - (bar - 10) * 80),
          );
        }
      }
      if (step === 4 || step === 12) inst.snare(time, 0.8);
      if (step === 8) inst.timpani(time, chord.timpani, 0.75);
      if (step % 2 === 0) inst.stringsOstinato(time, chord.root + 12, 0.7);
      if (step % 4 === 2) inst.snare(time, 0.55);
      if (step === 6 || step === 14) inst.highBrass(time, chord.lead[2], 0.75);
      return;
    }

    // =========================================================================
    // SECTION 3: ENEMY BELLY (Bars 16-20) - Dark low brass under enemy cruiser
    // =========================================================================
    if (bar >= 16 && bar < 20) {
      if (step === 0) {
        inst.timpani(time, chord.timpani - 12, 1.0); // Sub timpani
        inst.lowBrass(time, chord.root - 12, 0.95); // Deep sinister brass
        inst.stringsPad(time, chord.pad[1], 0.65);
      }
      if (step === 8) inst.timpani(time, chord.timpani - 12, 0.8);
      if (step % 4 === 0) inst.snare(time, 0.65);
      if (step % 2 === 0) inst.stringsOstinato(time, chord.root, 0.55);
      return;
    }

    // =========================================================================
    // SECTION 4: THE EYE OF THE BATTLE (Bars 20-22) - Drops to near silence
    // =========================================================================
    if (bar >= 20 && bar < 22) {
      if (bar === 20 && step === 0) {
        // Dramatic drop: breath of quiet in open space facing the flagship
        inst.timpani(time, 50, 0.5);
        inst.stringsPad(time, 62, 0.45);
      }
      if (bar === 21 && step === 8) {
        // Gathering tension
        inst.timpani(time, 50, 0.6);
      }
      return;
    }

    // =========================================================================
    // SECTION 5: BOSS PHASE 1 (Bars 22-25) - Close pass & shield generators
    // =========================================================================
    if (bar >= 22 && bar < 25) {
      if (step === 0) {
        inst.timpani(time, chord.timpani, 1.0);
        inst.lowBrass(time, chord.root, 0.85);
        inst.highBrass(time, chord.lead[4], 0.9);
        inst.cymbal(time, 0.85);
      }
      if (step === 4 || step === 12) inst.snare(time, 0.75);
      if (step === 8) inst.timpani(time, chord.timpani, 0.8);
      if (step % 2 === 0) inst.stringsOstinato(time, chord.root + 12, 0.65);
      return;
    }

    // =========================================================================
    // SECTION 6: TURNAROUND & ESCORTS (Bars 25-27) - Shield falls, loop turn
    // =========================================================================
    if (bar >= 25 && bar < 27) {
      if (step === 0) {
        inst.cymbal(time, 0.9);
        inst.timpani(time, chord.timpani, 0.95);
        inst.lowBrass(time, chord.root, 0.85);
      }
      if (step % 2 === 0) inst.snare(time, 0.6);
      if (step % 2 === 0) inst.stringsOstinato(time, chord.root + 12, 0.7);
      if (step === 4 || step === 12) inst.highBrass(time, chord.lead[5], 0.85);
      return;
    }

    // =========================================================================
    // SECTION 7: TRENCH DIVE (Bars 27-29) - Diving into the power core trench
    // =========================================================================
    if (bar >= 27 && bar < 29) {
      if (step === 0) {
        inst.timpani(time, chord.timpani, 1.0);
        inst.lowBrass(time, chord.root, 0.9);
        inst.highBrass(time, chord.lead[5], 0.9);
        inst.cymbal(time, 0.95);
      }
      if (step === 4 || step === 12) inst.snare(time, 0.8);
      if (step === 8) inst.timpani(time, chord.timpani, 0.85);
      if (step % 2 === 0) inst.stringsOstinato(time, chord.root + 12, 0.75);
      if (step % 4 === 2) inst.snare(time, 0.65);
      return;
    }

    // =========================================================================
    // SECTION 8: VICTORY FINALE (Bars 29-30) - Flagship breaks, pull-out theme!
    // =========================================================================
    if (bar >= 29) {
      if (step === 0) {
        // Soaring Picardy D Major grand victory resolution!
        inst.timpani(time, 50, 1.0);
        inst.cymbal(time, 1.0);
        inst.lowBrass(time, 38, 0.95);
        inst.stringsPad(time, 62, 0.9);
        inst.highBrass(time, 74, 1.0); // Majestic high D trumpet!
      }
      if (step === 4) inst.highBrass(time, 78, 0.95); // F#5 major third!
      if (step === 8) {
        inst.timpani(time, 50, 0.85);
        inst.highBrass(time, 81, 1.0); // A5 fifth
      }
      if (step === 12) inst.highBrass(time, 86, 1.0); // High D6 octave!
    }
  }

  // Quantized player action hooks and kill lanes
  const positionAt = (time: number) => score.arrangementPositionAt(time);

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const lead = score.leadSetAt(positionAt(time));
    const note = lead[Math.min(lead.length - 1, lockCount)];
    inst.playerLock(time, note, 0.7 + lockCount * 0.05);
  });

  bus.on('unlock', () => {
    const context = runtime.context();
    if (context) inst.playerLock(context.currentTime, 50, 0.35);
  });

  bus.on('fire', ({ volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const chord = score.chordAt(positionAt(time));
    inst.playerFire(time, chord.root + 24, 0.7 + volleySize * 0.06);
    if (volleySize === 6) runtime.mix()?.duckAt(time, 0.75, 0.22);
  });

  bus.on('hit', ({ lethal, stageCompleted }) => {
    const context = runtime.context();
    if (context) {
      inst.snare(context.currentTime, stageCompleted ? 0.85 : lethal ? 0.65 : 0.4);
    }
  });

  bus.on('kill', () => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    inst.playerKill(kill.time, kill.midi, 0.9);
    inst.timpani(kill.time, kill.midi - 12, 0.5);
  });

  bus.on('stage', ({ stageIndex }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    runtime.mix()?.duckAt(time, 0.5, 0.4);
    inst.timpani(time, 38, 1.0);
    inst.cymbal(time, 0.95);
    inst.highBrass(time, 62 + stageIndex * 4, 0.9);
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (context) inst.alarm(context.currentTime, 0.8);
  });

  bus.on('playerhit', () => {
    const context = runtime.context();
    if (context) {
      runtime.mix()?.duckAt(context.currentTime, 0.35, 0.5);
      inst.timpani(context.currentTime, 38, 1.0);
      inst.alarm(context.currentTime, 1.0);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 2);
    if (phase === 'exposed') {
      runtime.mix()?.duckAt(time, 0.4, 0.6);
      inst.cymbal(time, 1.0);
      inst.highBrass(time, 74, 1.0);
    } else if (phase === 'destroyed') {
      runtime.mix()?.duckAt(time, 0.2, 1.2);
      inst.broadsideCannon(time, 1.0);
      inst.cymbal(time, 1.0);
      inst.timpani(time, 38, 1.0);
    }
  });

  return runtime.audio;
}
