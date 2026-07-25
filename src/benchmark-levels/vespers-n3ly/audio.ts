import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
  type MixBus,
} from '../../engine/audio-kit';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import {
  VESPERS_N3LY_BARS,
  VESPERS_N3LY_BPM,
  VESPERS_N3LY_RUN_DURATION,
  VESPERS_N3LY_STEPS_PER_BAR,
  VESPERS_N3LY_TIME,
} from './timing';

// Vespers has no percussion. Its pulse is the independence of four organ
// lines: pedal, tenor, alto, and (only after the Devourer dies) soprano.
// Action sounds use those same ranks and the score's live harmony, so locks,
// volleys, hits, and kills become playable notes inside the counterpoint.

type VespersSection = 0 | 1 | 2 | 3 | 4 | 5;
type VespersChord = {
  bass: number;
  manual: readonly number[];
  arp: readonly number[];
};
type Registration = 'bourdon' | 'principal' | 'flute' | 'reed' | 'plenum';

const STEP_SECONDS = VESPERS_N3LY_TIME.stepSeconds;
const BAR_SECONDS = VESPERS_N3LY_TIME.barSeconds;
const MINOR_CHORDS: readonly VespersChord[] = [
  { bass: 38, manual: [50, 57, 62, 65], arp: [62, 65, 69, 74] }, // Dm
  { bass: 34, manual: [46, 53, 58, 62], arp: [58, 62, 65, 70] }, // Bb
  { bass: 31, manual: [43, 50, 55, 58], arp: [55, 58, 62, 67] }, // Gm
  { bass: 33, manual: [45, 52, 57, 61], arp: [57, 61, 64, 69] }, // A
];
const MAJOR_CHORDS: readonly VespersChord[] = [
  { bass: 38, manual: [50, 57, 62, 66], arp: [62, 66, 69, 74] }, // D
  { bass: 35, manual: [47, 54, 59, 62], arp: [59, 62, 66, 71] }, // Bm
  { bass: 31, manual: [43, 50, 55, 59], arp: [55, 59, 62, 67] }, // G
  { bass: 33, manual: [45, 52, 57, 61], arp: [57, 61, 64, 69] }, // A
];

const SCORE_SECTIONS = [
  { index: 0 as const, fromBar: VESPERS_N3LY_BARS.threshold },
  { index: 1 as const, fromBar: VESPERS_N3LY_BARS.procession, crossfadeBars: 1 },
  { index: 2 as const, fromBar: VESPERS_N3LY_BARS.theft, crossfadeBars: 1 },
  { index: 3 as const, fromBar: VESPERS_N3LY_BARS.silence },
  { index: 4 as const, fromBar: VESPERS_N3LY_BARS.return, crossfadeBars: 1 },
  { index: 5 as const, fromBar: VESPERS_N3LY_BARS.plenum },
] as const;

const KILL_LANES: Record<VespersSection, readonly number[]> = {
  0: [0, 1, 2, 1, 0, 2, 3, 1, 2, 3, 4, 2, 1, 0, 2, 3],
  1: [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 5, 3, 6, 4, 3, 1],
  2: [0, 4, 1, 5, 2, 6, 3, 7, 6, 2, 7, 3, 4, 5, 6, 7],
  3: [0, 1, 0, 2, 1, 3, 2, 1, 0, 2, 3, 2, 1, 0, 1, 2],
  4: [0, 2, 4, 1, 3, 5, 2, 4, 6, 3, 5, 7, 6, 4, 3, 1],
  5: [7, 6, 5, 4, 3, 4, 5, 6, 7, 5, 3, 1, 2, 4, 6, 7],
};

const TENOR_TUNE = [
  [62, 65, 64, 62],
  [69, 67, 65, 64],
  [62, 64, 65, 69],
  [67, 65, 64, 61],
  [62, 69, 67, 65],
  [64, 62, 58, 62],
  [67, 65, 62, 64],
  [61, 64, 62, 57],
] as const;

const ALTO_TUNE = [
  [69, 72, 70, 69],
  [74, 72, 70, 67],
  [69, 70, 72, 74],
  [76, 74, 72, 69],
  [70, 74, 72, 70],
  [69, 67, 65, 69],
  [72, 70, 69, 67],
  [69, 72, 70, 66],
] as const;

const QUIET_TUNE = [
  [62, 60],
  [58, 57],
  [62, 65],
  [64, 61],
] as const;

const SOPRANO_MAJOR = [
  [74, 78, 81, 86, 85, 81, 78, 74],
  [76, 78, 83, 81, 78, 76, 74, 73],
  [74, 81, 83, 86, 90, 86, 83, 81],
] as const;

const REGISTRATION: Record<Registration, {
  type: OscillatorType;
  harmonics: Array<[number, number]>;
  attack: number;
  filter: number;
}> = {
  bourdon: { type: 'sine', harmonics: [[1, 1], [2, 0.28], [3, 0.08]], attack: 0.09, filter: 900 },
  principal: { type: 'triangle', harmonics: [[1, 1], [2, 0.34], [4, 0.12]], attack: 0.035, filter: 2400 },
  flute: { type: 'sine', harmonics: [[1, 1], [2, 0.22], [3, 0.12]], attack: 0.075, filter: 3200 },
  reed: { type: 'sawtooth', harmonics: [[1, 1], [0.5, 0.16]], attack: 0.018, filter: 1750 },
  plenum: { type: 'triangle', harmonics: [[0.5, 0.18], [1, 1], [2, 0.42], [4, 0.18]], attack: 0.025, filter: 4200 },
};

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

function createVespersAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let bossId = -1;
  let bossMaximumHealth = 10;
  let majorFinale = false;
  let exposed = false;

  const score = createScore<VespersChord, VespersSection>({
    bpm: VESPERS_N3LY_BPM,
    stepsPerBar: VESPERS_N3LY_STEPS_PER_BAR,
    chords: MINOR_CHORDS,
    barsPerChord: 2,
    sections: SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    bpm: VESPERS_N3LY_BPM,
    stepSeconds: STEP_SECONDS,
    stepsPerBar: VESPERS_N3LY_STEPS_PER_BAR,
    volumeScale: 0.78,
    score,
    runAlignment: 'bar',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -20, knee: 9, ratio: 4.5, attack: 0.012, release: 0.32 },
      reverb: { seconds: 4.2, decay: 3.1, level: 0.34 },
      delay: { time: STEP_SECONDS * 3, feedback: 0.22, dampHz: 2300, sendGain: 0.28 },
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      bossId = -1;
      bossMaximumHealth = 10;
      majorFinale = false;
      exposed = false;
      score.clearOverride();
    },
    onRunEnd() {
      const mix = runtime.mix();
      if (!ctx || !mix) return;
      const at = ctx.currentTime + 0.05;
      const chord = majorFinale ? MAJOR_CHORDS[0] : MINOR_CHORDS[0];
      playChord(at, chord.manual, majorFinale ? 5.5 : 3.8, majorFinale ? 0.055 : 0.028, majorFinale ? 'plenum' : 'bourdon', mix.music, mix);
    },
    onDispose() {
      ctx = null;
    },
  });

  function musicOutput() {
    const mix = runtime.mix();
    return mix?.music ?? mix?.master ?? null;
  }

  function sfxOutput() {
    const mix = runtime.mix();
    return mix?.sfx ?? mix?.master ?? null;
  }

  function liveChord(position: number) {
    if (!majorFinale) return score.chordAt(position);
    const bar = Math.floor(position / VESPERS_N3LY_STEPS_PER_BAR);
    return MAJOR_CHORDS[(bar - VESPERS_N3LY_BARS.plenum + MAJOR_CHORDS.length) % MAJOR_CHORDS.length];
  }

  function organNote(
    at: number,
    midi: number,
    duration: number,
    gain: number,
    registration: Registration,
    destination: AudioNode,
    mix: MixBus,
    options: { detune?: number; reverb?: number; filterScale?: number } = {},
  ) {
    if (!ctx) return;
    const spec = REGISTRATION[registration];
    const attack = Math.min(spec.attack, duration * 0.22);
    const stop = at + Math.max(0.06, duration);
    const releaseAt = Math.max(at + attack, stop - Math.min(0.22, duration * 0.24));
    for (const [ratio, harmonicGain] of spec.harmonics) {
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: stop + 0.035,
        oscillatorType: spec.type,
        frequency: midiToFreq(midi) * ratio,
        detune: options.detune,
        filter: { type: 'lowpass', frequency: spec.filter * (options.filterScale ?? 1) },
        gainAutomation: [
          { type: 'set', value: 0.001, time: at },
          { type: 'linearRamp', value: Math.max(0.0011, gain * harmonicGain), time: at + attack },
          { type: 'set', value: Math.max(0.0011, gain * harmonicGain * 0.84), time: releaseAt },
          { type: 'exponentialRamp', value: 0.001, time: stop },
        ],
        destination,
        sends: mix.reverbSend
          ? [{ destination: mix.reverbSend, gain: options.reverb ?? 0.42 }]
          : undefined,
      });
    }
  }

  function playChord(
    at: number,
    notes: readonly number[],
    duration: number,
    gain: number,
    registration: Registration,
    destination: AudioNode,
    mix: MixBus,
  ) {
    for (const [index, midi] of notes.entries()) {
      organNote(at + index * 0.014, midi, duration, gain, registration, destination, mix, {
        detune: index % 2 === 0 ? -2 : 2,
        reverb: registration === 'plenum' ? 0.62 : 0.48,
      });
    }
  }

  function bell(at: number, midi: number, gain: number, duration = 2.8) {
    const mix = runtime.mix();
    const output = musicOutput();
    if (!ctx || !mix || !output) return;
    const frequency = midiToFreq(midi);
    const partials = [
      [1, 1],
      [2.01, 0.42],
      [3.93, 0.2],
      [5.12, 0.11],
    ] as const;
    for (const [ratio, weight] of partials) {
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + duration + 0.05,
        oscillatorType: 'sine',
        frequency: frequency * ratio,
        gainAutomation: [
          { type: 'set', value: gain * weight, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + duration },
        ],
        destination: output,
        sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.72 }] : undefined,
      });
    }
  }

  function scheduleStep(step: BeatLevelAudioStep) {
    const mix = runtime.mix();
    const output = musicOutput();
    if (!ctx || !mix || !output) return;
    if (step.mode === 'ambient') {
      scheduleAmbient(step, output, mix);
      return;
    }
    scheduleRun(step, output, mix);
  }

  function scheduleAmbient(step: BeatLevelAudioStep, output: AudioNode, mix: MixBus) {
    if (step.step === 0 && step.bar % 2 === 0) {
      organNote(step.time, 38, BAR_SECONDS * 2.05, 0.052, 'bourdon', output, mix, { reverb: 0.62 });
    }
    if (step.step === 8 && step.bar % 4 === 1) {
      organNote(step.time, 62 + (step.bar % 8 === 1 ? 0 : 3), BAR_SECONDS * 1.35, 0.024, 'flute', output, mix, { reverb: 0.72 });
    }
  }

  function scheduleRun(step: BeatLevelAudioStep, output: AudioNode, mix: MixBus) {
    const { bar } = step;
    const chord = liveChord(step.position);
    const quiet = bar >= VESPERS_N3LY_BARS.silence && bar < VESPERS_N3LY_BARS.return;

    // Pedal: literally the first sound, held for two bars. It disappears in
    // the dark nave and returns beneath the westward build.
    if (!quiet && step.step === 0 && (bar === 0 || bar >= 2)) {
      const duration = bar === 0 ? BAR_SECONDS * 2.04 : BAR_SECONDS * 1.04;
      organNote(step.time, chord.bass, duration, bar >= 17 ? 0.061 : 0.052, 'bourdon', output, mix, { reverb: 0.5 });
      if (bar >= VESPERS_N3LY_BARS.theft) {
        organNote(step.time, chord.bass + 12, duration, 0.021, 'principal', output, mix, { reverb: 0.42 });
      }
    }

    if (quiet) {
      const quietBar = bar - VESPERS_N3LY_BARS.silence;
      if (step.step === 0 || step.step === 8) {
        const note = QUIET_TUNE[quietBar % QUIET_TUNE.length][step.step === 0 ? 0 : 1];
        organNote(step.time, note, BAR_SECONDS * 0.53, 0.034, 'flute', output, mix, { reverb: 0.66, filterScale: 0.7 });
      }
      return;
    }

    // Tenor enters after the naked pedal. Its four-quarter cantus is a real
    // eight-bar tune rather than an arpeggiator.
    if (bar >= 1 && step.step % 4 === 0) {
      const note = TENOR_TUNE[bar % TENOR_TUNE.length][step.step / 4];
      organNote(step.time, note, STEP_SECONDS * 4.1, bar >= 17 ? 0.043 : 0.036, 'principal', output, mix, { reverb: 0.44 });
    }

    // Alto enters later and speaks on the offbeats, so its contrary contour
    // remains audible against the cantus.
    if (bar >= VESPERS_N3LY_BARS.procession && step.step % 4 === 2) {
      const note = ALTO_TUNE[(bar + 3) % ALTO_TUNE.length][Math.floor(step.step / 4)];
      organNote(step.time, note, STEP_SECONDS * 3.5, bar >= 17 ? 0.031 : 0.026, 'flute', output, mix, { reverb: 0.55 });
    }

    // A moving bass manual joins only once the counterpoint can support it.
    if (bar >= 7 && step.step % 8 === 0) {
      const note = step.step === 0 ? chord.bass + 12 : chord.bass + (bar % 2 === 0 ? 19 : 17);
      organNote(step.time, note, STEP_SECONDS * 7.4, 0.026, bar >= 17 ? 'reed' : 'principal', output, mix, {
        reverb: 0.38,
        filterScale: bar >= 17 ? 1.1 : 0.8,
      });
    }

    // Choir weight appears only at structural swells, never as a permanent
    // pad. The absence between swells preserves the independent lines.
    if (step.step === 0 && [9, 12, 17, 19, 20].includes(bar)) {
      playChord(step.time, chord.manual.map((midi) => midi + 12), BAR_SECONDS * 1.05, bar >= 17 ? 0.032 : 0.024, 'flute', output, mix);
      bell(step.time, chord.arp[bar % chord.arp.length] + 12, bar >= 20 ? 0.065 : 0.042, 3.2);
    }

    // The soprano rank was held back all night. It exists only after the
    // boss kill flips majorFinale; a failed run never gets this melody.
    if (majorFinale && bar >= VESPERS_N3LY_BARS.plenum && step.step % 2 === 0) {
      const phrase = SOPRANO_MAJOR[(bar - VESPERS_N3LY_BARS.plenum) % SOPRANO_MAJOR.length];
      organNote(step.time, phrase[step.step / 2], STEP_SECONDS * 2.2, 0.043, 'plenum', output, mix, { reverb: 0.62 });
    }

    if (majorFinale && step.step === 0) {
      playChord(step.time, chord.manual, BAR_SECONDS * 1.04, 0.047, 'plenum', output, mix);
      organNote(step.time, chord.bass - 12, BAR_SECONDS * 1.05, 0.06, 'bourdon', output, mix, { reverb: 0.55 });
    }
  }

  function coreFinale() {
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    majorFinale = true;
    exposed = true;
    score.overrideSection(5);
    const at = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(at, 0.3, 0.7);

    // Breath, then the building opens: low D, principal chorus, mixtures,
    // bells, and finally the withheld soprano's first bright scale.
    organNote(at, 26, 4.9, 0.085, 'bourdon', mix.music, mix, { reverb: 0.64 });
    const tonic = MAJOR_CHORDS[0];
    playChord(at + STEP_SECONDS * 2, [...tonic.manual, 69, 74, 78], 4.8, 0.066, 'plenum', mix.music, mix);
    [50, 57, 62, 66, 69, 74, 78, 81, 86].forEach((midi, index) => {
      const noteAt = at + STEP_SECONDS * (2 + index);
      organNote(noteAt, midi, 1.6, 0.045 + index * 0.0015, 'plenum', mix.music, mix, { reverb: 0.68 });
    });
    [62, 69, 74, 78].forEach((midi, index) => bell(at + index * STEP_SECONDS * 2, midi + 12, 0.072 - index * 0.008, 4.2));
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'devourer') return;
    bossId = enemyId;
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    const at = score.nextGridTime(ctx.currentTime);
    mix.duckAt(at, 0.6, 0.85);
    organNote(at, 26, 3.4, 0.065, 'bourdon', mix.music, mix, { reverb: 0.58 });
    organNote(at, 32, 2.8, 0.036, 'reed', mix.music, mix, { reverb: 0.48 });
    bell(at, 50, 0.075, 4.4);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'exposed') return;
    exposed = true;
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    const at = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(at, 0.68, 0.55);
    [50, 53, 56, 59].forEach((midi, index) => {
      organNote(at + index * STEP_SECONDS, midi, 0.75, 0.046 + index * 0.006, 'reed', mix.music, mix, { reverb: 0.48 });
    });
    bell(at, 74, 0.082, 3.8);
  });

  bus.on('lock', ({ lockCount }) => {
    const mix = runtime.mix();
    const output = sfxOutput();
    if (!ctx || !mix || !output) return;
    const at = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(at);
    const chord = liveChord(position);
    const midi = chord.arp[(Math.max(1, lockCount) - 1) % chord.arp.length] + (lockCount > 4 ? 12 : 0);
    organNote(at, midi, 0.16, 0.048, lockCount >= 5 ? 'principal' : 'flute', output, mix, { reverb: 0.34 });
  });

  bus.on('fire', ({ indexInVolley }) => {
    if ((indexInVolley ?? 0) !== 0) return;
    const mix = runtime.mix();
    const output = sfxOutput();
    if (!ctx || !mix || !output) return;
    const at = score.quantizePlayerAction(ctx.currentTime);
    const chord = liveChord(score.arrangementPositionAt(at));
    organNote(at, chord.bass + 24, 0.2, 0.052, 'reed', output, mix, { reverb: 0.24, filterScale: 1.25 });
    organNote(at + STEP_SECONDS, chord.bass + 31, 0.18, 0.035, 'principal', output, mix, { reverb: 0.28 });
  });

  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    if (lethal) return;
    const mix = runtime.mix();
    const output = sfxOutput();
    if (!ctx || !mix || !output) return;
    const at = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === bossId) {
      bossMaximumHealth = Math.max(bossMaximumHealth, hitPointsRemaining + 1);
      const damage = 1 - hitPointsRemaining / bossMaximumHealth;
      const chord = liveChord(score.arrangementPositionAt(at));
      organNote(at, chord.bass + 24 + Math.round(damage * 12), 0.42, 0.045 + damage * 0.035, 'reed', output, mix, {
        reverb: 0.4,
        filterScale: 0.8 + damage * 1.25,
      });
      if (damage > 0.55) bell(at, chord.arp[2] + 12, 0.035 + damage * 0.025, 1.8);
      return;
    }
    const chord = liveChord(score.arrangementPositionAt(at));
    organNote(at, chord.arp[(hitPointsRemaining + 1) % chord.arp.length] + 12, 0.28, 0.035, 'principal', output, mix, { reverb: 0.38 });
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const mix = runtime.mix();
    const output = sfxOutput();
    if (!ctx || !mix || !output) return;
    if (enemyId === bossId) {
      coreFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    organNote(kill.time, kill.midi, 0.72, 0.054 + (indexInVolley ?? 0) * 0.003, exposed ? 'reed' : 'principal', output, mix, {
      reverb: 0.5,
      filterScale: 1 + (indexInVolley ?? 0) * 0.06,
    });
  });

  bus.on('volley', ({ size, kills }) => {
    if (size < 5 || kills < 5) return;
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    const at = score.nextGridTime(ctx.currentTime, 4);
    const chord = liveChord(score.arrangementPositionAt(at));
    playChord(at, chord.manual.map((midi) => midi + 12), 1.15, 0.032, exposed ? 'reed' : 'principal', mix.sfx, mix);
    bell(at, chord.arp[3] + 12, 0.045, 2.2);
  });

  bus.on('reject', () => {
    const mix = runtime.mix();
    const output = sfxOutput();
    if (!ctx || !mix || !output) return;
    const at = ctx.currentTime;
    organNote(at, 61, 0.32, 0.054, 'reed', output, mix, { reverb: 0.08, filterScale: 0.65 });
    organNote(at + 0.035, 55, 0.36, 0.046, 'reed', output, mix, { reverb: 0.08, filterScale: 0.55 });
  });

  bus.on('miss', () => {
    const mix = runtime.mix();
    const output = sfxOutput();
    if (!ctx || !mix || !output) return;
    organNote(ctx.currentTime, 26, 0.55, 0.028, 'bourdon', output, mix, { reverb: 0.18, filterScale: 0.55 });
  });

  return runtime;
}

export const VESPERS_N3LY_AUDIO_DURATION = VESPERS_N3LY_RUN_DURATION;
