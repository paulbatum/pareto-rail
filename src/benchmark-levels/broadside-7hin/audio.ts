import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createArrangement, fn, hits, type ArrangementContext } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { voice } from '../../engine/audio-voices';
import { createBroadsideVoices } from './audio-voices';
import {
  BROADSIDE_7HIN_BPM,
  BROADSIDE_7HIN_RUN_DURATION,
  BROADSIDE_7HIN_SCORE_SECTIONS,
  BROADSIDE_7HIN_SECTIONS,
  BROADSIDE_7HIN_STEPS_PER_BAR,
  BROADSIDE_7HIN_TIME,
  type BroadsideSection,
} from './timing';

// Space-opera scoring: brass and strings over timpani. The arrangement
// marches with the fleet — a fanfare launch, a percussion march through the
// swarm, a tutti broadside whose guns fire on downbeats, near-silence in the
// eye of the battle, a menacing rebuild under the enemy warship, and a heavy
// march for the flagship. Player actions are notes in that score: locks climb
// the live harmony, kills walk hidden melodic lanes so a chained volley sings
// a phrase, and destroying the flagship's last conduit lands the victory
// bloom with the whole orchestra ducking away for it.

const SIXTEENTH = BROADSIDE_7HIN_TIME.stepSeconds;
const STEPS_PER_BAR = BROADSIDE_7HIN_STEPS_PER_BAR;
const LANE_STEPS = 32; // two bars: one full chord

// Dm – Bb – F – C: an epic minor anthem cycle, two bars per chord.
const CHORDS = [
  { bass: 38, pad: [50, 53, 57, 62], arp: [62, 65, 69, 74] }, // Dm
  { bass: 34, pad: [46, 50, 53, 58], arp: [65, 70, 74, 77] }, // Bb
  { bass: 41, pad: [45, 48, 53, 57], arp: [65, 69, 72, 77] }, // F
  { bass: 36, pad: [48, 52, 55, 60], arp: [64, 67, 72, 76] }, // C
];
type Chord = typeof CHORDS[number];

// Per-section kill-melody lanes (degrees into arp ++ arp+12). Act 1 arches
// heroically, act 2 syncopates with menace, the boss tolls descending bells
// answered by climbs.
const KILL_LANES: Record<BroadsideSection, readonly number[]> = {
  0: [
    0, 2, 4, 3, 5, 4, 7, 4,
    6, 5, 4, 2, 4, 5, 7, 6,
    7, 6, 5, 4, 3, 4, 5, 6,
    7, 4, 5, 6, 7, 6, 4, 2,
  ],
  1: [
    0, 4, 2, 6, 1, 5, 3, 7,
    0, 4, 2, 6, 3, 7, 4, 2,
    5, 1, 4, 6, 2, 5, 0, 4,
    7, 3, 5, 1, 4, 6, 2, 5,
  ],
  2: [
    7, 5, 4, 2, 7, 5, 4, 2,
    6, 4, 3, 1, 6, 4, 3, 1,
    5, 3, 2, 0, 5, 3, 2, 0,
    4, 5, 6, 7, 6, 7, 6, 7,
  ],
};

// Per-act voicing for the player's instruments. Gains tuned by perceived
// loudness: brighter waveforms sit lower in the mix.
type ActVoices = {
  kill: { decay: number; gain: number; cutoff: number };
  lockGain: number;
  lockCutoff: number;
  fireCutoff: number;
};
const ACT_VOICES: Record<BroadsideSection, ActVoices> = {
  0: { kill: { decay: 0.42, gain: 0.16, cutoff: 3200 }, lockGain: 0.13, lockCutoff: 2600, fireCutoff: 2000 },
  1: { kill: { decay: 0.26, gain: 0.15, cutoff: 2600 }, lockGain: 0.07, lockCutoff: 2000, fireCutoff: 3000 },
  2: { kill: { decay: 0.5, gain: 0.17, cutoff: 3400 }, lockGain: 0.06, lockCutoff: 2300, fireCutoff: 3800 },
};

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

export const traceBroadsideAudio = createAudioTraceHarness({
  level: 'broadside-7hin',
  bpm: BROADSIDE_7HIN_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: BROADSIDE_7HIN_RUN_DURATION,
  createAudio: createBroadsideAudio,
});

function createBroadsideAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;

  const score = createScore<Chord, BroadsideSection>({
    bpm: BROADSIDE_7HIN_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: BROADSIDE_7HIN_SCORE_SECTIONS,
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
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2400 },
      reverb: { seconds: 2.2, decay: 3.4, level: 0.3 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (!context || !runtime.mix()) return;
      const time = context.currentTime + 0.05;
      for (const midi of [50, 57, 62, 69]) inst.padNote(time, midi, 0.07, 4);
    },
    onDispose() {
      ctx = null;
    },
  });

  const inst = createBroadsideVoices({ trace, context: runtime.context }, () => runtime.mix());
  const sfxOut = () => runtime.mix()?.sfx ?? null;

  // --- arrangement -----------------------------------------------------------

  const padChord = ({ time, chord }: { time: number; chord: Chord }, velocity = 0.05, duration = 16 * 2 * SIXTEENTH * 1.02) => {
    for (const midi of chord.pad) inst.padNote(time, midi, velocity, duration);
  };

  const brassStab = ({ time, chord }: { time: number; chord: Chord }, velocity = 0.14, duration = 0.5, bright = 0.7) => {
    for (const midi of chord.pad) inst.horn(time, midi + 12, velocity, duration, bright);
    inst.horn(time, chord.bass, velocity * 1.1, duration, bright);
  };

  const ostinato = (pattern: string, velocity: number, octaveShift = -12) => {
    const track = hits<Chord>(pattern, { A: velocity }, ({ time, step, chord }, vel) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      inst.padNote(time, chord.arp[order[(step / 2) % order.length]] + octaveShift, vel, SIXTEENTH * 2.4);
    });
    return (context: ArrangementContext<Chord>) => track.run(context);
  };

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'nebula-idle',
      fromBar: 0,
      tracks: [
        fn(({ time, step, bar, chord }) => {
          if (bar % 2 === 0 && step === 0) padChord({ time, chord }, 0.035);
          if (bar % 2 === 1 && step === 8) inst.horn(time, chord.bass + 12, 0.04, 2.2, 0.3);
          if (step === 12 && bar % 2 === 1) inst.tick(time, 0.02, 7000);
        }),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: BROADSIDE_7HIN_SECTIONS.map((section) => ({
      name: section.name,
      fromBar: section.fromBar,
      ...('toBar' in section ? { toBar: section.toBar } : {}),
      tracks: [fn<Chord>(runTrack)],
    })),
  });

  function runTrack(context: ArrangementContext<Chord>) {
    const { time: at, step, bar, barInSection, chord } = context;

    switch (context.section.name) {
      case 'launch': {
        padChord({ time: at, chord });
        inst.timpani(at, step === 0 ? 0.9 : 0.4, chord.bass);
        // Horn fanfare: root – fifth – octave figure on bars 0 and 2.
        if (barInSection % 2 === 0) {
          const figure = [[0, 12, 0.16], [4, 19, 0.14], [7, 24, 0.18], [10, 19, 0.12]] as const;
          for (const [figureStep, offset, velocity] of figure) {
            if (step === figureStep) inst.horn(at, chord.bass + offset, velocity, 0.9, 0.75);
          }
        }
        if (barInSection === 0 && step === 0) inst.cymbal(at, 0.08);
        break;
      }
      case 'the-gap': {
        march(chord, at, step, 1);
        ostinato('A.A.A.A.A.A.A.A.', 0.05)(context);
        if (barInSection % 2 === 0 && step === 0) inst.horn(at, chord.bass + 12, 0.09, 0.7, 0.6);
        break;
      }
      case 'corkscrew': {
        march(chord, at, step, 2);
        ostinato('A.A.A.A.A.A.A.A.', 0.055)(context);
        if (step === 6) brassStab({ time: at, chord }, 0.1, 0.3, 0.85);
        if (bar % 2 === 1 && step === 14) inst.snare(at, 0.1);
        break;
      }
      case 'broadside': {
        // The cruiser's own guns are part of the beat: cannons land on the
        // half notes and the visuals flash to the same transport grid.
        if (step === 0) inst.cannon(at, 1);
        if (step === 8) inst.cannon(at, 0.8);
        if (step === 0 || step === 8) inst.timpani(at, step === 0 ? 0.75 : 0.5, chord.bass);
        if (step === 4 || step === 12) inst.snare(at, 0.12);
        if (step % 2 === 0 && step % 4 !== 0) inst.tick(at, 0.028, 5200 + step * 180);
        if (step === 0) padChord({ time: at, chord }, 0.055, 16 * SIXTEENTH * 1.02);
        if (step === 0) brassStab({ time: at, chord }, 0.13, 1.1, 0.9);
        ostinato('A.A.A.A.A.A.A.A.', 0.045)(context);
        break;
      }
      case 'eye-of-battle': {
        // The eye: everything falls away but a held string note and a pulse.
        if (barInSection === 0 && step === 0) {
          inst.padNote(at, chord.arp[3] + 12, 0.05, 16 * 2 * SIXTEENTH * 1.05);
          inst.cymbal(at, 0.05);
        }
        if (step === 0 || step === 8) inst.heartbeat(at, step === 0 ? 0.16 : 0.1);
        break;
      }
      case 'belly-run': {
        if (step === 0 || step === 8) {
          inst.bassLine(at, chord.bass, 0.22 + barInSection * 0.03, SIXTEENTH * 6);
          inst.heartbeat(at, step === 0 ? 0.2 : 0.13);
          inst.timpani(at, 0.4, chord.bass);
        }
        if (barInSection % 2 === 0 && step === 0) inst.horn(at, chord.bass + 12, 0.11, 2.4, 0.3);
        if (barInSection >= 2 && step % 2 === 1) inst.snare(at, 0.03 + (step / 16) * 0.06 + barInSection * 0.01);
        if (step === 12) inst.tick(at, 0.035, 2400);
        break;
      }
      case 'approach': {
        if (step % 4 === 0) inst.timpani(at, 0.6, chord.bass);
        if (step % 2 === 0) inst.snare(at, 0.05 + barInSection * 0.035);
        if (step === 0) brassStab({ time: at, chord }, 0.13, 0.4, 0.95);
        if (step === 8) inst.bassLine(at, chord.bass, 0.3, SIXTEENTH * 3);
        if (barInSection === 1 && step === 0) inst.riser(at, 16 * SIXTEENTH);
        break;
      }
      case 'flagship': {
        // Heavy march with the flagship's alarm motif.
        if (barInSection === 0 && step === 0) inst.cymbal(at, 0.12);
        if (step === 0 || step === 8) inst.timpani(at, step === 0 ? 0.95 : 0.6, chord.bass);
        if (step === 12 && bar % 2 === 1) inst.timpani(at, 0.5, chord.bass);
        if (step % 4 === 2) inst.snare(at, 0.1);
        if (step % 2 === 0) inst.bassLine(at, chord.bass + (step % 8 === 6 ? 7 : 0), 0.26, SIXTEENTH * 1.6);
        if (step % 2 === 1) inst.tick(at, 0.03, 3600 + (step % 4) * 400);
        if ((barInSection === 0 || barInSection === 2) && (step === 0 || step === 6)) {
          inst.horn(at, chord.arp[step === 0 ? 3 : 1], 0.15, 1.0, 0.55);
        }
        break;
      }
      case 'shields-down': {
        // Lift: the shield falls and the orchestra opens up.
        if (step === 0 || step === 4 || step === 8 || step === 12) inst.timpani(at, 0.55, chord.bass);
        if (step === 4 || step === 12) inst.snare(at, 0.11);
        ostinato('A.A.A.A.A.A.A.A.', 0.06)(context);
        if (step === 0) {
          padChord({ time: at, chord }, 0.06, 16 * SIXTEENTH * 1.02);
          brassStab({ time: at, chord }, 0.12, 1.4, 1);
        }
        break;
      }
      case 'trench': {
        // Staccato drive inside the trenchwork.
        if (step === 0 || step === 4 || step === 8 || step === 12) inst.timpani(at, 0.5, chord.bass);
        if (step % 2 === 1) inst.tick(at, 0.045, 2800 + (step % 4) * 900);
        if (step === 0) inst.bassLine(at, chord.bass, 0.3, SIXTEENTH * 3);
        if (step === 8) inst.bassLine(at, chord.bass + 7, 0.24, SIXTEENTH * 3);
        if (barInSection === 1 && step === 0) inst.riser(at, 16 * SIXTEENTH);
        break;
      }
      case 'victory': {
        // Warm resolution under the fanfare the flagship's death triggers.
        if (barInSection === 0 && step === 0) {
          padChord({ time: at, chord }, 0.075, 16 * 2 * SIXTEENTH * 1.05);
          inst.timpani(at, 0.7, chord.bass);
          inst.cymbal(at, 0.14);
        }
        break;
      }
    }
  }

  /** Shared march kit for the swarm sections; intensity raises the density. */
  function march(chord: Chord, at: number, step: number, intensity: 1 | 2) {
    if (step === 0 || step === 8) inst.timpani(at, step === 0 ? 0.85 : 0.55, chord.bass);
    if (intensity === 2 && step === 14) inst.timpani(at, 0.4, chord.bass);
    if (step === 4 || step === 12) inst.snare(at, intensity === 2 ? 0.14 : 0.11);
    if (intensity === 2 && step === 10) inst.snare(at, 0.07);
    if (step % 2 === 1) inst.tick(at, 0.026 + intensity * 0.004, 6000 + (step % 4) * 500);
    if (step === 0) inst.bassLine(at, chord.bass, 0.3, SIXTEENTH * 5);
    if (step === 8) inst.bassLine(at, chord.bass + (intensity === 2 ? 3 : 7), 0.24, SIXTEENTH * 5);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // --- the player's instruments ----------------------------------------------

  const blend = <T extends Record<BroadsideSection, number>>(mix: SectionMix<BroadsideSection>, values: T) =>
    lerp(values[mix.from], values[mix.to], mix.t);

  bus.on('lock', ({ lockCount }) => {
    const output = sfxOut();
    const mixBus = runtime.mix();
    if (!ctx || !output || !mixBus?.delaySend) return;
    const at = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(at);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length, Math.max(1, lockCount)) - 1] ?? lead[0] ?? 69;
    const sectionMix = score.sectionMixAt(position);
    const layers = score.sectionLayers(sectionMix) as Array<[BroadsideSection, number]>;
    for (const [sectionIndex, weight] of layers) {
      if (weight < 0.02) continue;
      const voices = ACT_VOICES[sectionIndex];
      inst.lockPluck(at, midi, voices.lockGain * weight * (1 + lockCount * 0.05), voices.lockCutoff + lockCount * 160);
    }
  });

  bus.on('fire', ({ volleySize }) => {
    const output = sfxOut();
    if (!ctx || !output) return;
    const at = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(at);
    const sectionMix = score.sectionMixAt(position);
    const cutoff = blend(sectionMix, { 0: ACT_VOICES[0].fireCutoff, 1: ACT_VOICES[1].fireCutoff, 2: ACT_VOICES[2].fireCutoff })
      + Math.min(6, volleySize) * 120;
    const root = score.chordAt(position).bass;
    inst.fireZap(at, root + 36, cutoff);
  });

  bus.on('kill', ({ indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const sectionMix = score.sectionMixAt(position);
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const from = ACT_VOICES[sectionMix.from].kill;
    const to = ACT_VOICES[sectionMix.to].kill;
    const velocity = Math.min(1.35, 1 + (indexInVolley ?? 0) * 0.12);
    inst.killNote(
      kill.time,
      midi,
      velocity,
      lerp(from.decay, to.decay, sectionMix.t),
      lerp(from.gain, to.gain, sectionMix.t),
      lerp(from.cutoff, to.cutoff, sectionMix.t),
    );
  });

  bus.on('hit', ({ lethal }) => {
    const output = sfxOut();
    if (lethal || !ctx || !output) return;
    const at = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(at)).arp;
    ([[0, 0.075], [2, 0.06]] as const).forEach(([index, velocity], i) => {
      inst.chip(at + SIXTEENTH * 0.25 * i, arp[index] + 12, velocity);
    });
  });

  // A clean five-or-more kill release earns a brass flourish — the fleet
  // cheering a good volley.
  bus.on('volley', ({ size, kills }) => {
    const mixBus = runtime.mix();
    if (!ctx || !mixBus?.delaySend || kills < 5 || kills < size) return;
    const at = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(at));
    brassStab({ time: at, chord }, 0.12, 0.8, 1);
  });

  bus.on('reject', () => {
    const output = sfxOut();
    if (!ctx || !output) return;
    inst.rejectThud(ctx.currentTime);
  });

  // Hull impact: the level's own cannon turned against you, plus a harsh
  // dissonant minor-second stab that sits outside the key.
  bus.on('playerhit', () => {
    const output = sfxOut();
    if (!ctx || !output) return;
    const at = ctx.currentTime;
    inst.cannon(at, 0.9);
    const stab = voice<{ gainValue: number }>({
      oscillators: [{ type: 'sawtooth' }],
      duration: 0.22,
      stopPadding: 0.04,
      filter: { type: 'lowpass', cutoff: 1500 },
      envelope: { decay: 0.22 },
    });
    for (const frequency of [midiToFreq(64), midiToFreq(65)]) {
      stab.play({ context: ctx, time: at, frequency, gainValue: 0.07, destination: output });
    }
  });

  // Set-piece spawn cues: turrets clang online, generators raise an alarm,
  // conduits hum with power.
  bus.on('spawn', ({ kind }) => {
    if (!ctx) return;
    if (kind === 'battery') inst.tick(ctx.currentTime, 0.09, 420);
    if (kind === 'generator') {
      const at = score.nextGridTime(ctx.currentTime);
      inst.horn(at, 56, 0.13, 0.5, 0.4);
      inst.horn(at + 0.36, 53, 0.13, 0.5, 0.4);
    }
    if (kind === 'conduit') inst.tick(ctx.currentTime, 0.07, 1400);
  });

  // Shield drop: a bright turn-over stab as the conduits come online.
  bus.on('bossphase', ({ phase }) => {
    const mixBus = runtime.mix();
    if (!ctx || !mixBus?.duck) return;
    if (phase === 'exposed') {
      score.overrideSection(2);
      const at = score.nextGridTime(ctx.currentTime);
      mixBus.duckAt(at, 0.25, 1.2);
      brassStab({ time: at, chord: score.chordAt(score.arrangementPositionAt(at)) }, 0.16, 1.2, 1);
      inst.cymbal(at, 0.12);
    }
    if (phase === 'destroyed') flagshipFinale();
  });

  // The killing blow on the last conduit: the orchestra bows out, a sub drop
  // lands on the tonic, the brass blooms, and a victory peal falls from the
  // top of the register while the flagship breaks apart behind you.
  function flagshipFinale() {
    const output = sfxOut();
    const mixBus = runtime.mix();
    if (!ctx || !output || !mixBus?.delaySend || !mixBus.duck) return;
    const delaySend = mixBus.delaySend;
    const at = score.nextGridTime(ctx.currentTime, 2);
    mixBus.duckAt(at, 0.16, 2.6);

    playOscillatorVoice({
      context: ctx,
      time: at,
      stopTime: at + 1.2,
      oscillatorType: 'sine',
      frequency: 220,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 42, time: at + 0.55 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time: at },
        { type: 'exponentialRamp', value: 0.001, time: at + 1.1 },
      ],
      destination: output,
    });

    // Brass bloom: Dm stacked wide, detuned, slowly opening.
    for (const midi of [38, 50, 57, 62, 65]) {
      inst.horn(at, midi, 0.13, 2.4, 1);
      inst.padNote(at, midi + 12, 0.06, 2.6);
    }
    // Victory peal: D minor pentatonic falling through the delay.
    [93, 89, 86, 81, 77, 74, 69].forEach((midi, index) => {
      if (!ctx || !output || !delaySend) return;
      const pealAt = at + index * SIXTEENTH;
      const pealVoice = voice<{ gainValue: number }>({
        oscillators: [{ type: 'triangle' }, { type: 'sine', gain: 0.5 }],
        duration: 0.5,
        stopPadding: 0.05,
        filter: { type: 'lowpass', cutoff: 4200 },
        envelope: { decay: 0.48 },
      });
      pealVoice.play({
        context: ctx,
        time: pealAt,
        midi,
        gainValue: 0.14 - index * 0.009,
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }],
      });
    });
    inst.cymbal(at, 0.2);
    inst.cannon(at, 1);
  }

  return runtime;
}
