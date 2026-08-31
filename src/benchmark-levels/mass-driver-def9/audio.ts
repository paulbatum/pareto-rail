import type { EventBus } from '../../events';
import { createArrangement, fn, oneShot } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createMassDriverVoices, stopDriverHum } from './audio-voices';
import {
  MASS_DRIVER_DEF9_BARS,
  MASS_DRIVER_DEF9_BPM,
  MASS_DRIVER_DEF9_RUN_DURATION,
  MASS_DRIVER_DEF9_RUN_SECTIONS,
  MASS_DRIVER_DEF9_SCORE_SECTIONS,
  MASS_DRIVER_DEF9_STEPS_PER_BAR,
  MASS_DRIVER_DEF9_TIME,
} from './timing';

const SIXTEENTH = MASS_DRIVER_DEF9_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = MASS_DRIVER_DEF9_STEPS_PER_BAR;

type DriverChord = {
  bass: number;
  arp: readonly number[];
  power: readonly number[];
};

// C# minor voltage cycle: C#m — A — E — B. The safety phase replaces A with
// D natural, a semitone above the tonic, so the jam is audible before the HUD
// names it.
const CHORDS: readonly DriverChord[] = [
  { bass: 37, arp: [61, 64, 68, 73], power: [49, 56, 61] },
  { bass: 33, arp: [57, 61, 64, 69], power: [45, 52, 57] },
  { bass: 40, arp: [64, 68, 71, 76], power: [52, 59, 64] },
  { bass: 35, arp: [59, 63, 66, 71], power: [47, 54, 59] },
];

const SAFETY_CHORDS: readonly DriverChord[] = [
  CHORDS[0],
  { bass: 38, arp: [62, 65, 69, 74], power: [50, 57, 62] },
  CHORDS[0],
  { bass: 32, arp: [56, 60, 63, 68], power: [44, 51, 56] },
];

type SectionIndex = 0 | 1 | 2 | 3;

const KILL_LANES: Record<SectionIndex, readonly number[]> = {
  0: [0, 1, 2, 3, 2, 1, 4, 3, 2, 4, 5, 4, 3, 2, 1, 0],
  1: [0, 2, 1, 3, 4, 2, 5, 3, 4, 6, 5, 7, 6, 4, 3, 2],
  2: [3, 4, 6, 5, 7, 6, 4, 5, 2, 4, 3, 6, 5, 7, 6, 4],
  3: [7, 6, 5, 4, 6, 5, 3, 2, 5, 4, 2, 1, 4, 5, 6, 7],
};

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverDef9Audio = createAudioTraceHarness({
  level: 'mass-driver-def9',
  bpm: MASS_DRIVER_DEF9_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_DEF9_RUN_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<DriverChord, SectionIndex>({
    bpm: MASS_DRIVER_DEF9_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{
      fromBar: MASS_DRIVER_DEF9_BARS.interlocks,
      toBar: MASS_DRIVER_DEF9_BARS.end,
      chords: SAFETY_CHORDS,
      barsPerChord: 2,
    }],
    sections: MASS_DRIVER_DEF9_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  let voices: ReturnType<typeof createMassDriverVoices>;
  let safetyClear = false;
  let launched = false;
  let interlocksDestroyed = 0;
  const interlockIds = new Set<number>();

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    stepSeconds: SIXTEENTH,
    scheduleAhead: 0.16,
    schedulerMs: 25,
    volumeScale: 0.78,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.004, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.31, dampHz: 3200, sendGain: 0.45 },
      reverb: { seconds: 2.6, decay: 2.8, level: 0.42 },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      safetyClear = false;
      launched = false;
      interlocksDestroyed = 0;
      interlockIds.clear();
    },
    onRunEnd() {
      stopDriverHum(runtime, voices, 0.1);
    },
    onDispose() {
      voices.dispose();
    },
  });

  voices = createMassDriverVoices({ trace, context: runtime.context, mix: runtime.mix });

  const ambientArrangement = createArrangement<DriverChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'armed-idle',
      fromBar: 0,
      tracks: [fn(({ time, step, chord }) => {
        if (step % 4 === 0) voices.pulse(time, chord.bass, 0.36, 0.08);
        if (step === 14) voices.arp(time, chord.arp[2], 0.26, 0.1);
      })],
    }],
  });

  const pulseTrack = fn<DriverChord>(({ time, step, bar, chord }) => {
    if (step % 4 !== 0) return;
    const heat = Math.min(1, bar / MASS_DRIVER_DEF9_BARS.launch);
    const beat = step / 4;
    const midi = beat === 3 ? chord.bass + 7 : chord.bass;
    voices.pulse(time, midi, 0.72 + heat * 0.26, heat);
  });

  const runArrangement = createArrangement<DriverChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'injection',
        fromBar: MASS_DRIVER_DEF9_BARS.injection,
        toBar: MASS_DRIVER_DEF9_BARS.induction,
        tracks: [
          pulseTrack,
          oneShot(0, 0, ({ time }) => voices.startHum(time, MASS_DRIVER_DEF9_RUN_DURATION)),
          fn(({ time, step, bar, chord }) => {
            const heat = bar / MASS_DRIVER_DEF9_BARS.launch;
            if (step === 0 || (bar >= 4 && step === 8)) voices.kick(time, step === 0 ? 0.86 : 0.62);
            if (step === 0 || step === 10) voices.bass(time, chord.bass, 0.66, heat);
            if (step === 2 || step === 6 || step === 10 || step === 14) voices.railTick(time, 0.025 + heat * 0.018, heat);
            if (bar >= 2 && step % 4 === 2) {
              const degree = ((step / 2 + bar) % chord.arp.length) | 0;
              voices.arp(time, chord.arp[degree], 0.38, heat);
            }
          }),
          oneShot(6, 0, ({ time }) => voices.riser(time, MASS_DRIVER_DEF9_TIME.barSeconds * 2, 0.65)),
        ],
      },
      {
        name: 'induction',
        fromBar: MASS_DRIVER_DEF9_BARS.induction,
        toBar: MASS_DRIVER_DEF9_BARS.redline,
        tracks: [
          pulseTrack,
          fn(({ time, step, bar, chord }) => {
            const heat = bar / MASS_DRIVER_DEF9_BARS.launch;
            if ([0, 6, 8, 14].includes(step)) voices.kick(time, step === 0 ? 1 : 0.68);
            if ([0, 3, 7, 10, 13].includes(step)) {
              const octave = step === 7 ? 12 : 0;
              voices.bass(time, chord.bass + octave, step === 0 ? 0.82 : 0.58, heat);
            }
            if (step % 2 === 1) voices.railTick(time, step % 4 === 3 ? 0.06 : 0.038, heat);
            if (step % 2 === 0) {
              const order = [0, 2, 1, 3, 2, 1, 3, 0];
              voices.arp(time, chord.arp[order[step / 2]], 0.48, heat);
            }
          }),
          oneShot(6, 0, ({ time }) => voices.riser(time, MASS_DRIVER_DEF9_TIME.barSeconds * 2, 0.82)),
        ],
      },
      {
        name: 'redline',
        fromBar: MASS_DRIVER_DEF9_BARS.redline,
        toBar: MASS_DRIVER_DEF9_BARS.interlocks,
        tracks: [
          pulseTrack,
          fn(({ time, step, bar, chord }) => {
            const heat = bar / MASS_DRIVER_DEF9_BARS.launch;
            if ([0, 5, 8, 11, 14].includes(step)) voices.kick(time, step === 0 ? 1.08 : 0.72);
            if ([0, 3, 6, 8, 10, 13, 15].includes(step)) {
              const octave = step === 10 ? 12 : 0;
              voices.bass(time, chord.bass + octave, step === 0 ? 0.92 : 0.62, heat);
            }
            voices.railTick(time, step % 4 === 2 ? 0.075 : 0.032, heat);
            if (step % 2 === 0) {
              const order = [0, 3, 1, 2, 3, 1, 2, 0];
              const octave = bar >= 20 && step >= 8 ? 12 : 0;
              voices.arp(time, chord.arp[order[step / 2]] + octave, 0.54, heat);
            }
          }),
          oneShot(6, 0, ({ time }) => voices.riser(time, MASS_DRIVER_DEF9_TIME.barSeconds * 2, 1.0)),
        ],
      },
      {
        name: 'safety-interlocks',
        fromBar: MASS_DRIVER_DEF9_BARS.interlocks,
        toBar: MASS_DRIVER_DEF9_BARS.launch,
        tracks: [
          pulseTrack,
          oneShot(0, 0, ({ time }) => {
            voices.impact(time, 0.78);
            voices.riser(time, MASS_DRIVER_DEF9_TIME.barSeconds * 7, 1.15);
          }),
          fn(({ time, step, bar, chord }) => {
            const charge = Math.min(1, (bar - MASS_DRIVER_DEF9_BARS.interlocks + step / STEPS_PER_BAR) / 7);
            if ([0, 4, 7, 10, 12, 15].includes(step)) voices.kick(time, step === 0 ? 1.08 : 0.64 + charge * 0.2);
            if ([0, 3, 6, 8, 11, 14].includes(step)) voices.bass(time, chord.bass + (step === 11 ? 12 : 0), 0.72, 0.82 + charge * 0.18);
            voices.railTick(time, step % 2 === 0 ? 0.06 : 0.035 + charge * 0.03, 0.85 + charge * 0.15);
            if (step % 2 === 0) {
              const degree = [0, 1, 3, 2, 1, 3, 2, 0][step / 2];
              voices.arp(time, chord.arp[degree] + (bar >= 28 ? 12 : 0), 0.48 + charge * 0.15, 0.9 + charge * 0.1);
            }
            if (step % 4 === 2) voices.alarm(time, chord.arp[(step / 4) % chord.arp.length], 0.42 + charge * 0.38, charge);
            if (bar >= 30 && step % 2 === 1) voices.alarm(time, chord.arp[3] + 12, 0.22 + charge * 0.24, charge);
          }),
        ],
      },
      {
        name: 'launch',
        fromBar: MASS_DRIVER_DEF9_BARS.launch,
        toBar: MASS_DRIVER_DEF9_BARS.end,
        tracks: [fn(({ time, step, chord }) => {
          if (step === 0 && safetyClear) {
            launch(time, chord);
            return;
          }
          if (safetyClear) return;
          // The last bar is an overload counter. A successful late clear cuts
          // this immediately through the bossphase handler below.
          voices.pulse(time, chord.bass + Math.floor(step / 4), 0.9, 1);
          voices.railTick(time, 0.06 + step * 0.006, 1);
          if (step % 2 === 0) voices.alarm(time, chord.arp[3] + 12 + Math.floor(step / 4), 0.74, 1);
        })],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  function launch(time: number, chord: DriverChord) {
    if (launched) return;
    launched = true;
    const mix = runtime.mix();
    if (mix) mix.duckAt(time, 0.08, 1.3);
    voices.stopHum(time, 0.09);
    voices.impact(time, 1.45);
    chord.arp.forEach((midi, index) => {
      voices.playerTone(time + 0.035 + index * THIRTYSECOND, midi + 24, 0.8 - index * 0.1, 7200, 0.34, 'sine');
    });
    voices.staticHit(time, 0.24, 0.72, 5600);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
    if (kind !== 'arcbolt') return;
    const context = runtime.context();
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.alarm(time, chord.arp[2] + 12, 0.5, 0.65);
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    const section = score.sectionMixAt(position).to;
    const brightness = [2800, 3700, 5000, 6400][section];
    const oscillator: OscillatorType = section >= 2 ? 'sawtooth' : section === 1 ? 'triangle' : 'sine';
    voices.playerTone(time, midi, 0.54 + lockCount * 0.055, brightness, 0.12, oscillator);
    if (lockCount === 6) voices.playerTone(time + THIRTYSECOND, midi + 12, 0.7, 7600, 0.22, 'sine');
  });

  bus.on('unlock', () => {
    const context = runtime.context();
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.playerTone(time, chord.bass + 24, 0.28, 1800, 0.1, 'triangle');
  });

  bus.on('fire', ({ indexInVolley, volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    voices.fireZap(time, chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 12, 0.72 + volleySize * 0.045);
  });

  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    if (lethal) return;
    const context = runtime.context();
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (interlockIds.has(enemyId)) {
      const intensity = 1 - hitPointsRemaining / 2;
      voices.playerTone(time, chord.power[1] + 12, 0.58 + intensity * 0.38, 3200 + intensity * 4200, 0.28, 'sawtooth');
      voices.staticHit(time, 0.08 + intensity * 0.08, 0.08, 3800);
    } else {
      voices.playerTone(time, chord.power[2] + 12, 0.38, 3500, 0.1, 'triangle');
      voices.staticHit(time, 0.045, 0.035, 5200);
    }
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.impact(time, interlockIds.has(enemyId) ? 0.46 : 0.28);
    chord.power.forEach((midi, index) => {
      voices.playerTone(time + index * THIRTYSECOND, midi + 12 + stageIndex * 3, 0.48 - index * 0.06, 4300, 0.36, 'triangle');
    });
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    const kill = score.nextKill(context.currentTime);
    const bossKill = interlockIds.delete(enemyId);
    if (bossKill) interlocksDestroyed += 1;
    const section = score.sectionMixAt(Math.max(0, kill.step - score.arrangementStart)).to;
    voices.playerTone(
      kill.time,
      kill.midi + (bossKill ? 12 : 0),
      Math.min(1.25, 0.72 + (indexInVolley ?? 0) * 0.08 + (bossKill ? interlocksDestroyed * 0.06 : 0)),
      bossKill ? 7200 : 4400 + section * 900,
      bossKill ? 0.52 : 0.28,
      section >= 2 ? 'sawtooth' : 'triangle',
    );
    voices.staticHit(kill.time, bossKill ? 0.15 : 0.07, bossKill ? 0.14 : 0.06, bossKill ? 2600 : 6200);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size < 5 || kills !== size) return;
    const context = runtime.context();
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 2);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    runtime.mix()?.duckAt(time, size === 6 ? 0.45 : 0.58, 0.32);
    chord.power.forEach((midi, index) => voices.playerTone(time + index * THIRTYSECOND, midi + 24, 0.48, 6800, 0.24, 'sine'));
  });

  bus.on('miss', ({ enemyId }) => {
    interlockIds.delete(enemyId);
    const context = runtime.context();
    if (!context) return;
    const chord = score.chordAt(score.arrangementPositionAt(context.currentTime));
    voices.playerTone(context.currentTime, chord.bass + 5, 0.24, 900, 0.16, 'sine');
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (context) voices.reject(context.currentTime, 1);
  });

  bus.on('playerhit', ({ damage, healthRemaining }) => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime;
    if (healthRemaining <= 0) {
      voices.stopHum(time, 0.04);
      runtime.mix()?.duckAt(time, 0.05, 1.5);
      voices.impact(time, 1.8);
      voices.staticHit(time, 0.32, 1.1, 620);
      return;
    }
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.impact(time, 0.38 + damage * 0.08);
    voices.alarm(time + THIRTYSECOND, chord.arp[0] + 12, 0.75, 0.8);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'destroyed') return;
    safetyClear = true;
    const context = runtime.context();
    if (!context) return;
    const time = score.nextGridTime(context.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    chord.power.forEach((midi, index) => voices.playerTone(time + index * THIRTYSECOND, midi + 24, 0.68, 7600, 0.42, 'sine'));
    if (score.barAt(position) >= MASS_DRIVER_DEF9_BARS.launch) launch(time, chord);
  });

  return runtime;
}
