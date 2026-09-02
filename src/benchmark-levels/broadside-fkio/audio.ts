import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createBroadsideVoices } from './audio-voices';
import {
  bar,
  BROADSIDE_BARS,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_SCORE_SECTIONS,
  BROADSIDE_STEPS_PER_BAR,
  BROADSIDE_TIME,
  CHORDS,
  KILL_LANES,
  type BroadsideSection,
  type Chord,
} from './timing';

const STEP = BROADSIDE_TIME.stepSeconds;

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-fkio',
  bpm: BROADSIDE_BPM,
  stepSeconds: STEP,
  defaultSeconds: BROADSIDE_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, BroadsideSection>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: BROADSIDE_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 3,
    sections: BROADSIDE_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    stepSeconds: STEP,
    runAlignment: 'bar',
    beatNumber: 'position',
    volumeScale: 0.78,
    mix: {
      compressor: { threshold: -18, ratio: 4.5, attack: 0.005, release: 0.25 },
      delay: { time: STEP * 3, feedback: 0.28, dampHz: 2400 },
      reverb: { seconds: 3.4, decay: 2.6, level: 0.45 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar: currentBar, time, mode }) {
      if (mode === 'run' && step === 0) {
        runArrangement.recordSectionStart(time, currentBar);
      }
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
    },
    onRunEnd() {
      score.clearOverride();
      const ctx = runtime.context();
      if (ctx) {
        // Lingering triumphant D major chord at level finish
        inst.brass(ctx.currentTime + 0.05, 62, 0.9, 4.0, 4200);
        inst.brass(ctx.currentTime + 0.05, 66, 0.85, 4.0, 4200);
        inst.brass(ctx.currentTime + 0.05, 69, 0.85, 4.0, 4200);
        inst.pad(ctx.currentTime + 0.05, [50, 57, 62, 66, 74], 0.7, 5.5);
      }
    },
  });

  const inst = createBroadsideVoices({
    trace,
    context: runtime.context,
    mix: runtime.mix,
  });

  // ---- Arrangements -------------------------------------------------------

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: BROADSIDE_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      // Act 1: Flight deck launch (Bars 0-4)
      {
        name: 'flight-deck',
        fromBar: 0,
        toBar: BROADSIDE_BARS.broadside,
        tracks: [
          fn(({ time, step, bar: currentBar, chord }) => {
            // Low tense strings
            if (step === 0 || step === 4 || step === 8 || step === 12) {
              inst.strings(time, chord.bass + 12, 0.6);
            }
            // Horn call on bar 1 and 2
            if (currentBar === 1 && step === 4) {
              inst.brass(time, chord.lead[0], 0.8, 1.2, 2800);
            }
            if (currentBar === 2 && step === 4) {
              inst.brass(time, chord.lead[2], 0.85, 1.2, 3200);
            }
            // Catapult charge Timpani roll into bar 3
            if (currentBar === 3) {
              if (step % 2 === 0) {
                inst.timpani(time, chord.bass, 0.4 + (step / 16) * 0.6, 0.4);
              }
            }
            // Launch pad chords
            if (step === 0 && currentBar % 2 === 0) {
              inst.pad(time, chord.pad, 0.35, STEP * 28);
            }
          }),
        ],
      },

      // Act 2: Fleet Crossfire & Broadside Flank (Bars 4-10)
      {
        name: 'crossfire-broadside',
        fromBar: BROADSIDE_BARS.broadside,
        toBar: BROADSIDE_BARS.eye,
        tracks: [
          fn(({ time, step, bar: currentBar, chord }) => {
            // Pounding timpani on downbeats
            if (step === 0) {
              inst.timpani(time, chord.bass, 1.0, 1.2);
              if (currentBar === BROADSIDE_BARS.broadside) inst.crash(time, 1.0);
            } else if (step === 10) {
              inst.timpani(time, chord.bass - 5, 0.75, 0.6);
            }

            // Rapid staccato strings driving the fleet action
            if (step % 2 === 0) {
              const noteIndex = (step / 2 + currentBar * 2) % chord.lead.length;
              inst.strings(time, chord.lead[noteIndex], 0.65);
            }

            // Marching snare cadence
            if (step === 4 || step === 12) {
              inst.snare(time, 0.85);
            } else if (step === 6 || step === 14) {
              inst.snare(time, 0.4);
            }

            // Heroic brass counter-melody
            if (step === 0) {
              inst.brass(time, chord.lead[0], 0.85, 0.9, 3600);
            } else if (step === 6) {
              inst.brass(time, chord.lead[2], 0.8, 0.8, 3800);
            } else if (step === 10) {
              inst.brass(time, chord.lead[4], 0.9, 0.7, 4000);
            }

            // Majestic pad backing
            if (step === 0 && currentBar % 2 === 0) {
              inst.pad(time, chord.pad, 0.45, STEP * 30);
            }
          }),
        ],
      },

      // Act 3: The Eye of the Battle & Dreadnought Belly Run (Bars 10-16)
      // Drops to near silence in the eye of the battle!
      {
        name: 'eye-of-battle',
        fromBar: BROADSIDE_BARS.eye,
        toBar: BROADSIDE_BARS.flagship,
        tracks: [
          fn(({ time, step, bar: currentBar, chord }) => {
            // Drums drop out! Quiet eerie string pedal
            if (step === 0 && currentBar % 2 === 0) {
              inst.pad(time, [chord.pad[0], chord.pad[1]], 0.28, STEP * 30);
            }

            // Subtle stealthy string plucks
            if (step === 0 || step === 8) {
              inst.strings(time, chord.bass, 0.35);
            }

            // Distant solitary horn echoing through the cruiser wreckage
            if (currentBar === 11 && step === 4) {
              inst.brass(time, chord.lead[1], 0.45, 1.4, 2200);
            } else if (currentBar === 13 && step === 4) {
              inst.brass(time, chord.lead[3], 0.5, 1.4, 2400);
            }

            // Rising tension at bars 14-15 before the flagship emerges
            if (currentBar === 14 || currentBar === 15) {
              if (step % 4 === 0) {
                inst.timpani(time, chord.bass, 0.3 + ((currentBar - 14) * 16 + step) * 0.02, 0.5);
              }
              if (step % 2 === 0) {
                inst.strings(time, chord.lead[step % chord.lead.length], 0.4 + (step / 16) * 0.3);
              }
            }
          }),
        ],
      },

      // Act 4: Enemy Flagship Approach & Shield Assault (Bars 16-22)
      {
        name: 'flagship-shields',
        fromBar: BROADSIDE_BARS.flagship,
        toBar: BROADSIDE_BARS.escort,
        tracks: [
          fn(({ time, step, bar: currentBar, chord }) => {
            // Full orchestra erupts with fury!
            if (step === 0) {
              inst.timpani(time, chord.bass, 1.1, 1.0);
              if (currentBar === BROADSIDE_BARS.flagship) inst.crash(time, 1.0);
            } else if (step === 8) {
              inst.timpani(time, chord.bass - 7, 0.85, 0.7);
            }

            // Aggressive brass march
            if (step === 0 || step === 4 || step === 8 || step === 12) {
              inst.brass(time, chord.lead[step === 12 ? 4 : 0], 0.9, 0.5, 4200);
            }

            // Galloping strings
            if (step % 2 === 0) {
              inst.strings(time, chord.lead[(step + currentBar) % chord.lead.length], 0.75);
            }

            // Military marching snare
            if (step === 4 || step === 12) {
              inst.snare(time, 0.9);
            } else if (step === 8 || step === 14) {
              inst.snare(time, 0.55);
            }

            if (step === 0 && currentBar % 2 === 0) {
              inst.pad(time, chord.pad, 0.5, STEP * 30);
            }
          }),
        ],
      },

      // Act 5: Shield Collapse & Escort Fighter Turnaround (Bars 22-25)
      {
        name: 'escort-intercept',
        fromBar: BROADSIDE_BARS.escort,
        toBar: BROADSIDE_BARS.trench,
        tracks: [
          fn(({ time, step, bar: currentBar, chord }) => {
            if (step === 0) {
              inst.timpani(time, chord.bass, 1.0, 0.9);
              if (currentBar === BROADSIDE_BARS.escort) inst.crash(time, 1.0);
            }
            // Fast syncopated battle rhythm
            if (step % 2 === 0) {
              inst.strings(time, chord.lead[(step / 2) % chord.lead.length], 0.8);
            }
            if (step === 2 || step === 6 || step === 10 || step === 14) {
              inst.snare(time, 0.65);
            }
            if (step === 0 || step === 6 || step === 12) {
              inst.brass(time, chord.lead[3], 0.8, 0.45, 4000);
            }
          }),
        ],
      },

      // Act 6: Trench Dive & Core Destruction (Bars 25-28)
      {
        name: 'trench-run',
        fromBar: BROADSIDE_BARS.trench,
        toBar: BROADSIDE_BARS.victory,
        tracks: [
          fn(({ time, step, bar: currentBar, chord }) => {
            // Urgent, racing pulse in the trench
            if (step % 4 === 0) {
              inst.timpani(time, chord.bass, 1.05, 0.5);
              inst.snare(time, 0.85);
            }
            if (step % 2 === 0) {
              inst.strings(time, chord.lead[step % chord.lead.length], 0.85);
            }
            if (step === 0 || step === 8) {
              inst.brass(time, chord.lead[currentBar % 2 === 0 ? 0 : 4], 0.95, 0.7, 4400);
            }
            if (step === 0 && currentBar % 2 === 0) {
              inst.pad(time, chord.pad, 0.5, STEP * 28);
            }
          }),
        ],
      },

      // Finale: Climax Pullout & Victory Fanfare (Bars 28-30)
      {
        name: 'victory-pullout',
        fromBar: BROADSIDE_BARS.victory,
        toBar: BROADSIDE_BARS.end,
        tracks: [
          fn(({ time, step, bar: currentBar, chord }) => {
            // Majestic D Major resolution!
            if (step === 0 && currentBar === BROADSIDE_BARS.victory) {
              inst.crash(time, 1.2);
              inst.timpani(time, chord.bass, 1.2, 2.0);
            }
            // Soaring brass fanfare
            if (step === 0) {
              inst.brass(time, chord.lead[0], 1.0, 1.5, 4600);
            } else if (step === 4) {
              inst.brass(time, chord.lead[2], 0.95, 1.2, 4600);
            } else if (step === 8) {
              inst.brass(time, chord.lead[4], 1.05, 1.8, 4800);
            } else if (step === 12) {
              inst.brass(time, chord.lead[7], 1.1, 2.2, 5000);
            }
            // Shimmering violins
            if (step % 2 === 0) {
              inst.strings(time, chord.lead[step % chord.lead.length], 0.7);
            }
            // Full orchestral pad
            if (step === 0) {
              inst.pad(time, chord.pad, 0.7, STEP * 30);
            }
          }),
        ],
      },
    ],
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: BROADSIDE_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          fn(({ time, step, chord }) => {
            if (step === 0) {
              inst.pad(time, chord.pad, 0.3, STEP * 30);
              inst.timpani(time, chord.bass, 0.35, 1.5);
            }
            if (step === 8) {
              inst.strings(time, chord.lead[0], 0.25);
            }
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'run') {
      runArrangement.schedule(position, time);
    } else {
      ambientArrangement.schedule(position, time);
    }
  }

  // ---- Player Action Sound Hooks (Rez-style synesthesia) -------------------

  bus.on('lock', ({ lockCount }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    const midi = lead[Math.min(lead.length - 1, lockCount - 1)];
    inst.lockPip(time, midi, lockCount);
  });

  bus.on('fire', ({ volleySize }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.fireAccent(time, chord.bass + 12, volleySize);
    if (volleySize >= 6) {
      inst.timpani(time, chord.bass, 0.9, 0.6);
    }
  });

  bus.on('hit', ({ enemyId: _id, hitPointsRemaining }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    // Resonant hit feedback for multi-hit targets
    inst.thud(ctx.currentTime, 0.4 + (1 / Math.max(1, hitPointsRemaining)) * 0.3);
  });

  bus.on('kill', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    // Melodic run note from the kill lane
    const kill = score.nextKill(ctx.currentTime);
    inst.killMelody(kill.time, kill.midi, 0.9);
  });

  bus.on('stage', ({ stageHitPoints: _hp, hitStageCount: _count }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    // Boss shield breakdown or reactor destruction gong
    inst.bossImpact(ctx.currentTime, 50, 1.0);
  });

  bus.on('reject', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.thud(ctx.currentTime, 0.85);
  });

  bus.on('playerhit', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.thud(ctx.currentTime, 1.2);
    inst.timpani(ctx.currentTime, 31, 1.1, 0.5);
  });

  bus.on('miss', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.thud(ctx.currentTime, 0.3);
  });

  return runtime;
}
