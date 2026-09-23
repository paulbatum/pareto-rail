import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementContext } from '../../engine/arrangement';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createMassDriverVoices, type HumVoice, type PlayerTimbre, type WhineVoice } from './audio-voices';
import { heatAt } from './gameplay';
import { runState } from './run-state';
import { BAR, BEAT, MASS_DRIVER_BARS, MASS_DRIVER_BPM, MASS_DRIVER_STEPS_PER_BAR, MASS_DRIVER_TIME } from './timing';

// The Mass Driver score: 128 BPM, 32 bars, one coil pulse per beat — the
// kick drum IS the payload crossing a ring. Under everything runs the gun's
// hum, a pumping pedal that only ever climbs: D through stage one, E through
// stage two, then a semitone every two bars through the final charge (F#, G,
// G#, A) while a charge whine glides continuously between those pitches.
// At the peak the gun fires and the whole score falls away to a single
// D-major chord in open space — or the barrel lets go.
//
// Player actions are notes: locks climb the live lead set, slugs chirp from
// the chord, kills walk a hidden per-section lane so a volley plays a run,
// and each safety interlock blown strikes the chord higher up.

const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS = MASS_DRIVER_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { pedal: number; pad: readonly number[]; arp: readonly number[]; stab: readonly number[] };
type SectionIndex = 0 | 1 | 2 | 3 | 4;

const chord = (pedal: number, pad: number[], arp: number[], stab: number[]): Chord => ({ pedal, pad, arp, stab });

// Stage one: D minor, i – VI – III – VII over a D pedal.
const DM9 = chord(38, [50, 57, 62, 64, 65], [62, 64, 65, 69], [62, 65, 69]);
const DM = chord(38, [50, 57, 62, 65], [62, 65, 69, 72], [62, 65, 69]);
const BB = chord(38, [50, 58, 62, 65], [62, 65, 70, 72], [62, 65, 70]);
const FD = chord(38, [48, 57, 60, 65], [60, 65, 69, 72], [60, 65, 69]);
const CD = chord(38, [48, 55, 60, 64], [62, 64, 67, 72], [64, 67, 72]);
// Stage two: the same shape a whole tone up, over an E pedal.
const EM = chord(40, [52, 59, 64, 67], [64, 67, 71, 74], [64, 67, 71]);
const CE = chord(40, [52, 60, 64, 67], [64, 67, 72, 74], [64, 67, 72]);
const GE = chord(40, [50, 59, 62, 67], [62, 67, 71, 74], [62, 67, 71]);
const DE = chord(40, [50, 57, 62, 66], [64, 66, 69, 74], [66, 69, 74]);
// Final charge: minor-seventh chords stepping up a semitone every two bars.
const chargeChord = (root: number) => chord(root, [root + 12, root + 19, root + 24, root + 27], [root + 19, root + 22, root + 24, root + 27], [root + 24, root + 27, root + 31]);
// Open space: home, but major, and nothing underneath it.
const DMAJ9 = chord(38, [50, 57, 61, 64, 66], [66, 69, 73, 76], [69, 73, 76]);

const RUN_CHORDS: Chord[] = [
  DM9, DM9, DM9, DM9,
  DM, DM, BB, BB, FD, FD, CD, CD,
  EM, EM, CE, CE, GE, GE, DE, DE,
  chargeChord(42), chargeChord(42), chargeChord(43), chargeChord(43),
  chargeChord(44), chargeChord(44), chargeChord(45), chargeChord(45),
  DMAJ9, DMAJ9, DMAJ9, DMAJ9,
];

const SCORE_SECTIONS = [
  { index: 0 as const, fromBar: MASS_DRIVER_BARS.breech },
  { index: 1 as const, fromBar: MASS_DRIVER_BARS.stageOne },
  { index: 2 as const, fromBar: MASS_DRIVER_BARS.stageTwo },
  { index: 3 as const, fromBar: MASS_DRIVER_BARS.charge },
  { index: 4 as const, fromBar: MASS_DRIVER_BARS.muzzle },
];

// Degrees into the live lead set (chord arp + its octave). Each section's
// lane has its own contour, so the same volley sings differently as the gun heats.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Breech: patient climbing steps.
  0: [0, 1, 2, 3, 2, 3, 4, 5, 4, 3, 4, 5, 6, 5, 4, 3, 2, 3, 4, 5, 4, 5, 6, 7, 6, 5, 4, 3, 4, 3, 2, 1],
  // Stage one: hypnotic rolling figures, three-against-four.
  1: [0, 2, 4, 2, 4, 6, 4, 6, 1, 3, 5, 3, 5, 7, 5, 7, 2, 4, 6, 4, 6, 7, 6, 4, 3, 5, 7, 5, 4, 2, 1, 0],
  // Stage two: wide leaps, octave-jumping syncopation.
  2: [0, 4, 7, 4, 1, 5, 7, 5, 2, 6, 3, 7, 4, 0, 5, 1, 6, 2, 7, 3, 4, 7, 5, 6, 4, 5, 3, 4, 2, 3, 1, 7],
  // Final charge: relentless ascending runs — the charge climbing in your hands.
  3: [0, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 7, 2, 3, 4, 5, 6, 7, 6, 7, 3, 4, 5, 6, 7, 5, 6, 7],
  // Open space: slow falling bells.
  4: [7, 5, 4, 2, 6, 4, 3, 1, 5, 3, 2, 0, 4, 2, 1, 0, 7, 6, 4, 2, 5, 4, 2, 1, 6, 4, 3, 1, 4, 2, 1, 0],
};

type PlayerVoiceSet = { lock: PlayerTimbre; kill: PlayerTimbre; fire: { oscillator: OscillatorType; cutoff: number; gain: number } };

// Timbre heats with the gun: glass → arc → violet saw → white-hot saw → bells.
const PLAYER_VOICES: Record<SectionIndex, PlayerVoiceSet> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.13, cutoff: 5000, gain: 0.12, chirp: 5, sparkle: 0.3, delay: 0.12, reverb: 0.16 },
    kill: { oscillator: 'triangle', decay: 0.32, cutoff: 4200, gain: 0.208, chirp: 0, sparkle: 0.6, delay: 0.18, reverb: 0.26 },
    fire: { oscillator: 'triangle', cutoff: 4200, gain: 0.05 },
  },
  1: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 4600, gain: 0.12, chirp: 7, sparkle: 0.35, delay: 0.12, reverb: 0.14 },
    kill: { oscillator: 'square', decay: 0.22, cutoff: 3000, gain: 0.098, chirp: 0, sparkle: 0.6, delay: 0.2, reverb: 0.2 },
    fire: { oscillator: 'square', cutoff: 3600, gain: 0.035 },
  },
  2: {
    lock: { oscillator: 'square', decay: 0.09, cutoff: 3600, gain: 0.06, chirp: 7, sparkle: 0.45, delay: 0.1, reverb: 0.14 },
    kill: { oscillator: 'sawtooth', decay: 0.24, cutoff: 3800, gain: 0.111, chirp: 0, sparkle: 0.75, delay: 0.2, reverb: 0.22 },
    fire: { oscillator: 'sawtooth', cutoff: 4400, gain: 0.035 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.08, cutoff: 5600, gain: 0.055, chirp: 12, sparkle: 0.6, delay: 0.08, reverb: 0.16 },
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 6200, gain: 0.124, chirp: 0, sparkle: 0.95, delay: 0.16, reverb: 0.28 },
    fire: { oscillator: 'sawtooth', cutoff: 6000, gain: 0.04 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.22, cutoff: 3200, gain: 0.1, chirp: 0, sparkle: 0.2, delay: 0.25, reverb: 0.5 },
    kill: { oscillator: 'sine', decay: 0.7, cutoff: 3000, gain: 0.182, chirp: 0, sparkle: 0.3, delay: 0.3, reverb: 0.6 },
    fire: { oscillator: 'sine', cutoff: 3000, gain: 0.04 },
  },
};

/** The hum's pedal, bar by bar. It never goes down during a run. */
const pedalAtBar = (barIndex: number) => RUN_CHORDS[Math.min(RUN_CHORDS.length - 1, Math.max(0, barIndex))].pedal;

/** Hum filter opens with the gun's heat. */
const humCutoff = (heat: number) => 170 + 2700 * heat ** 1.6;

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

function createMassDriverAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let hum: HumVoice = null;
  let whine: WhineVoice = null;
  let ambientQuietUntil = 0;
  let humMidi = pedalAtBar(0);
  let interlockHits = 0;
  let interlocksBlown = 0;
  const interlockIds = new Set<number>();
  const leechIds = new Set<number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS,
    chords: RUN_CHORDS,
    barsPerChord: 1,
    sections: SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.62,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -17, knee: 8, ratio: 6, attack: 0.003, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2800 },
      reverb: { seconds: 3.2, decay: 2.4, level: 0.45 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
      hum = voices.createHum();
      whine = voices.createWhine();
      hum?.level(context.currentTime, 0.14, 2.5);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockHits = 0;
      interlocksBlown = 0;
      interlockIds.clear();
      leechIds.clear();
      const now = ctx?.currentTime ?? 0;
      whine?.reset(now);
      if (humMidi !== pedalAtBar(0)) hum?.glide(now, now + BEAT, pedalAtBar(0));
      humMidi = pedalAtBar(0);
      hum?.level(now, 0.1, 0.4);
    },
    onRunEnd() {
      const now = ctx?.currentTime ?? 0;
      // A breach lets the whine finish its dive; any other ending cuts it.
      if (runState.outcome !== 'breach') whine?.reset(now);
      // Launch: let the silence of open space hold. Breach/death: a short dead air.
      const quiet = runState.outcome === 'launch' ? 5 : 2.5;
      ambientQuietUntil = now + quiet;
      if (runState.outcome !== 'breach') hum?.level(now, 0, 0.6);
    },
    onDispose() {
      hum?.dispose();
      whine?.dispose();
      hum = null;
      whine = null;
      ctx = null;
    },
  });

  const voices = createMassDriverVoices({ context: () => ctx, mix: runtime.mix });
  const { coilPulse, hat, clap, arp, bassPluck, pad, stab, riser, impact, alarm, bell, launchBlast, breachBlast, playerTone, thud, zap, crackle, breaker } = voices;

  // ---- arrangement ---------------------------------------------------------------

  type Ctx = ArrangementContext<Chord>;
  const barPosition = ({ bar, step }: Ctx) => bar + step / STEPS;
  const heatAtBar = (barFloat: number) => heatAt(barFloat * BAR);

  function pulse(context: Ctx, vel: number) {
    coilPulse(context.time, context.chord.pedal, vel, heatAtBar(barPosition(context)));
  }

  // The hum pumps on every beat and glides up a beat ahead of each pedal change.
  function humTrack(context: Ctx) {
    const { time, step, bar } = context;
    if (!hum) return;
    // The final beat belongs to the surge.
    if (bar === MASS_DRIVER_BARS.muzzle - 1 && step >= 12) return;
    if (step % 4 === 0) {
      const heat = heatAtBar(barPosition(context));
      hum.pumpAt(time, 0.28, BEAT * 0.85);
      hum.brightness(time, humCutoff(heat), 4 + heat * 6);
    }
    if (step === 12 && bar < MASS_DRIVER_BARS.muzzle - 1) {
      const next = pedalAtBar(bar + 1);
      if (next !== humMidi) {
        hum.glide(time, time + BEAT, next);
        humMidi = next;
      }
    }
    if (step === 0) hum.level(time, 0.09 + heatAtBar(bar) * 0.2, 0.5);
  }

  // Sixteenth arp in groups of three against the four-beat pulse.
  function arpTrack(options: { from: number; vel: number; octaveEvery?: number; climb?: boolean }) {
    const order = [0, 1, 2, 3, 2, 1];
    return (context: Ctx) => {
      const { time, step, bar, barInSection, chord: current } = context;
      if (barInSection < options.from) return;
      const index = (bar * STEPS + step) % order.length;
      const lift = options.climb ? Math.floor(step / 4) % 2 : 0;
      const octave = options.octaveEvery && step % options.octaveEvery === 0 ? 12 : 0;
      const heat = heatAtBar(barPosition(context));
      const accent = step % 4 === 0 ? 1 : 0.72;
      arp(time, current.arp[(order[index] + lift) % current.arp.length] - 12 + octave, options.vel * accent, 900 + heat * 3800);
    };
  }

  function padTrack(barsPerPad: number, vel: number) {
    return ({ time, step, barInSection, chord: current, bar }: Ctx) => {
      if (step !== 0 || barInSection % barsPerPad !== 0) return;
      pad(time, current.pad, barsPerPad * BAR, vel, 700 + heatAtBar(bar) * 1800);
    };
  }

  // Rolling offbeat bass on the pedal's octave — it pumps against the hum.
  function rollingBass(vel: number) {
    return (context: Ctx) => {
      const { time, step, chord: current } = context;
      if (step % 4 === 0 || step % 4 === 1) return;
      bassPluck(time, current.pedal + 12, vel * (step % 4 === 2 ? 1 : 0.7), 500 + heatAtBar(barPosition(context)) * 1600);
    };
  }

  /** A clap roll into the next section: eighths, then sixteenths, crescendo. */
  function clapRoll(time: number, step: number, fromStep: number) {
    if (step < fromStep) return;
    const span = STEPS - fromStep;
    const rate = step < fromStep + span / 2 ? 2 : 1;
    if ((step - fromStep) % rate === 0) clap(time, 0.3 + ((step - fromStep) / span) * 0.6);
  }

  const pulseBeats = 'K...K...K...K...';
  const offHats = '..o...o...o...o.';
  const ghostHats = '.h.h.h.h.h.h.h.h';
  const busyHats = 'hhohhhohhhohhhoh';
  const backbeat = '....C.......C...';

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'breech',
        fromBar: MASS_DRIVER_BARS.breech,
        tracks: [
          oneShot(0, 0, ({ time, chord: current }) => impact(time, 0.55, current.pedal)),
          hits(pulseBeats, { K: 1 }, (context, vel) => pulse(context, vel * (0.38 + context.bar * 0.08))),
          fn(humTrack),
          oneShot(0, 0, ({ time, chord: current }) => pad(time, current.pad, 4 * BAR, 0.8, 800)),
          fn(({ time, step, bar, chord: current }) => {
            if (bar < 2 || step % 2 !== 0) return;
            arp(time, current.arp[(step / 2) % current.arp.length] - 12, 0.3 + (bar - 2) * 0.2 + step * 0.01, 900 + bar * 250);
          }),
          hits(offHats, { o: 0.03 }, ({ time, bar }, vel) => {
            if (bar >= 2) hat(time, vel, 0.05);
          }),
          oneShot(2, 0, ({ time }) => riser(time, 2 * BAR, 0.45)),
          fn(({ time, step, bar }) => {
            if (bar === 3) clapRoll(time, step, 8);
          }),
        ],
      },
      {
        name: 'stage-one',
        fromBar: MASS_DRIVER_BARS.stageOne,
        tracks: [
          oneShot(0, 0, ({ time, chord: current }) => impact(time, 1, current.pedal)),
          hits(pulseBeats, { K: 1 }, (context, vel) => pulse(context, vel * (context.step === 0 ? 0.74 : 0.64))),
          fn(humTrack),
          hits(offHats, { o: 0.055 }, ({ time }, vel) => hat(time, vel, 0.06)),
          hits(ghostHats, { h: 0.02 }, ({ time, barInSection }, vel) => {
            if (barInSection >= 2) hat(time, vel, 0.025);
          }),
          fn(arpTrack({ from: 0, vel: 0.75 })),
          fn(padTrack(2, 0.8)),
          hits('.............Z..' + '................', { Z: 0.05 }, ({ time }, vel) => crackle(time, vel, 0.06, 4200, 'music')),
          oneShot(6, 0, ({ time }) => riser(time, 2 * BAR, 0.55)),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 7) clapRoll(time, step, 8);
          }),
        ],
      },
      {
        name: 'stage-two',
        fromBar: MASS_DRIVER_BARS.stageTwo,
        tracks: [
          oneShot(0, 0, ({ time, chord: current }) => impact(time, 1.1, current.pedal)),
          hits(pulseBeats, { K: 1 }, (context, vel) => pulse(context, vel * (context.step === 0 ? 0.86 : 0.78))),
          fn(humTrack),
          hits(backbeat, { C: 0.75 }, ({ time }, vel) => clap(time, vel)),
          hits(busyHats, { h: 0.022, o: 0.07 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.09 : 0.025)),
          fn(rollingBass(0.9)),
          fn(arpTrack({ from: 0, vel: 0.85, octaveEvery: 3 })),
          fn(padTrack(2, 0.9)),
          hits('S.........S.....' + '................', { S: 0.7 }, ({ time, chord: current }, vel) => stab(time, current.stab, vel, 2600)),
          oneShot(6, 0, ({ time }) => riser(time, 2 * BAR, 0.65)),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 7) clapRoll(time, step, 4);
          }),
        ],
      },
      {
        name: 'final-charge',
        fromBar: MASS_DRIVER_BARS.charge,
        tracks: [
          oneShot(0, 0, ({ time, chord: current }) => {
            impact(time, 1.2, current.pedal);
            if (!whine) return;
            // The charge whine glides continuously above the player's melody,
            // passing through each new pedal exactly as it lands (a semitone
            // every two bars), then screams on the last beat.
            whine.set(time, current.pedal + 48);
            whine.level(time, 0.03, 2 * BAR);
            whine.rampTo(time + 6 * BAR, current.pedal + 51);
            whine.tremoloTo(time + 7.5 * BAR, 13, 0.55);
          }),
          oneShot(6, 0, ({ time, chord: current }) => {
            whine?.rampTo(time + 1.75 * BAR, current.pedal + 49.5);
            whine?.level(time, 0.045, BAR);
          }),
          oneShot(7, 12, ({ time, chord: current }) => {
            // The last beat: every drum drops out, the hum surges an octave, the whine screams.
            hum?.glide(time, time + BEAT, current.pedal + 12);
            hum?.brightness(time, 5200, 12);
            whine?.rampTo(time + BEAT, current.pedal + 60);
            whine?.level(time, 0.07, BEAT * 0.8);
            riser(time, BEAT, 1.2);
          }),
          fn((context) => {
            if (context.barInSection === 7 && context.step >= 12) return;
            if (context.step % 4 === 0) pulse(context, 1);
          }),
          fn(humTrack),
          fn((context) => {
            const { time, step, barInSection } = context;
            if (barInSection === 7 && step >= 12) return;
            if (step === 4 || step === 12) clap(time, 0.8);
            hat(time, step % 4 === 2 ? 0.075 : 0.024, step % 4 === 2 ? 0.08 : 0.022, 9000);
          }),
          fn((context) => {
            if (context.barInSection === 7 && context.step >= 12) return;
            rollingBass(1)(context);
          }),
          fn((context) => {
            if (context.barInSection === 7 && context.step >= 12) return;
            arpTrack({ from: 0, vel: 0.9, octaveEvery: 2, climb: true })(context);
          }),
          fn(padTrack(2, 1)),
          fn(({ time, step, barInSection, chord: current }) => {
            // Safety klaxon as each wave of interlocks slams shut.
            if ((barInSection === 0 || (barInSection === 2 && step === 8)) && (step === 0 || step === 8)) {
              alarm(time, current.pedal + 36, 2 * BEAT, 0.9);
            }
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 6) {
              if (step % 4 === 0) clap(time, 0.35 + step * 0.02);
            }
            if (barInSection === 7 && step < 12) {
              if (step % 2 === 0) clap(time, 0.55 + step * 0.03);
              clap(time + THIRTYSECOND, 0.3 + step * 0.03);
            }
          }),
          oneShot(6, 0, ({ time }) => riser(time, 1.75 * BAR, 0.75)),
        ],
      },
      {
        name: 'open-space',
        fromBar: MASS_DRIVER_BARS.muzzle,
        toBar: MASS_DRIVER_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord: current }) => {
            if (runState.outcome === 'launch') fireTheGun(time, current);
            else blowTheBarrel(time);
          }),
          fn(({ time, step, barInSection, chord: current }) => {
            if (runState.outcome !== 'launch') return;
            if (barInSection === 0 && step === 8) pad(time, current.pad, 3.4 * BAR, 0.75, 1500);
            // Behind you, the gun's pulse recedes to nothing.
            if (barInSection > 0 && step === 0) coilPulse(time, current.pedal, [0, 0.22, 0.12, 0.06][barInSection], 0);
            const chime = OPEN_SPACE_BELLS.find(([b, s]) => b === barInSection && s === step);
            if (chime) bell(time, chime[2], chime[3], 3.2);
          }),
        ],
      },
    ],
  });

  // [barInSection, step, midi, velocity] — a few struck stars, nothing more.
  const OPEN_SPACE_BELLS: Array<[number, number, number, number]> = [
    [0, 10, 81, 0.6], [1, 2, 78, 0.5], [1, 9, 76, 0.45], [2, 4, 73, 0.4], [2, 12, 69, 0.35], [3, 6, 74, 0.3],
  ];

  function fireTheGun(time: number, current: Chord) {
    const audioMix = runtime.mix();
    // Everything else falls away under the shot.
    audioMix?.duckAt(time + 0.02, 0.12, 3.2);
    hum?.level(time, 0, 0.02);
    whine?.level(time, 0, 0.02);
    launchBlast(time, current.pad, current.pedal);
    humMidi = pedalAtBar(0);
    hum?.glide(time + 0.2, time + 0.4, humMidi);
  }

  function blowTheBarrel(time: number) {
    breachBlast(time, humMidi + 12);
    hum?.glide(time, time + 2.2, humMidi - 12);
    hum?.brightness(time, 4000, 14);
    hum?.level(time + 0.4, 0, 2);
    whine?.rampTo(time + 1.6, 30);
    whine?.level(time, 0, 1.6);
    humMidi = pedalAtBar(0);
    hum?.glide(time + 2.6, time + 2.8, humMidi);
  }

  // Attract / end screen: the gun idling in the breech, waiting to be charged.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: () => DM9,
    sections: [
      {
        name: 'idle',
        fromBar: 0,
        tracks: [
          fn(({ time, step, bar, chord: current }) => {
            if (time < ambientQuietUntil) return;
            if (step === 0) {
              if (humMidi !== current.pedal) {
                hum?.glide(time, time + BEAT, current.pedal);
                humMidi = current.pedal;
              }
              hum?.level(time, 0.14, 1.5);
              hum?.brightness(time, 190, 4);
            }
            if (step === 0 || step === 8) {
              hum?.pumpAt(time, 0.55, BEAT * 1.5);
              coilPulse(time, current.pedal, step === 0 ? 0.42 : 0.24, 0);
            }
            if (step === 0 && bar % 4 === 0) pad(time, current.pad, 4 * BAR, 0.55, 650);
            if (step % 4 === 2 && bar % 2 === 1) arp(time, current.arp[(step >> 2) % 4] - 12, 0.22, 800, 0.2);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- harmony for player actions -------------------------------------------------

  const sfxOut = () => runtime.mix()?.sfx ?? null;

  function harmonyAt(time: number) {
    const position = score.arrangementPositionAt(time);
    if (runtime.mode() === 'ambient') {
      return { position, chord: DM9, leadSet: leadSetOf(DM9), mix: { from: 0, to: 0, t: 1 } as SectionMix<SectionIndex> };
    }
    const current = score.chordAt(position);
    return { position, chord: current, leadSet: leadSetOf(current), mix: score.sectionMixAt(position) };
  }

  function leadSetOf(current: Chord) {
    return [...current.arp, ...current.arp.map((midi) => midi + 12)];
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx || !sfxOut()) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const { leadSet, mix, chord: current } = harmonyAt(time);
    const midi = leadSet[Math.min(7, Math.max(0, lockCount - 1))];
    for (const [section, weight] of score.sectionLayers(mix)) playerTone(time, midi, PLAYER_VOICES[section].lock, 1, weight);
    if (lockCount >= 6) {
      // Capacitor bank full: a rising three-note chirp over the pedal.
      const kill = PLAYER_VOICES[mix.to].kill;
      [5, 6, 7].forEach((degree, index) => playerTone(time + (index + 1) * THIRTYSECOND, leadSet[degree] + 12, kill, 0.45 + index * 0.1, 1));
      thud(time, current.pedal + 24, 0.8, 0.22);
    }
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx || !sfxOut()) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const { chord: current, mix } = harmonyAt(time);
    const source = current.arp[(indexInVolley ?? 0) % current.arp.length] + 24;
    for (const [section, weight] of score.sectionLayers(mix)) {
      const fire = PLAYER_VOICES[section].fire;
      zap(time, source, source - 12, 0.07, fire.gain * weight, fire.oscillator, fire.cutoff);
    }
    crackle(time, 0.045, 0.018, 6000);
  });

  bus.on('hit', ({ lethal, enemyId }) => {
    if (lethal || !ctx || !sfxOut()) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const { chord: current, leadSet } = harmonyAt(time);
    if (interlockIds.has(enemyId)) {
      // The boss's voice grows with every hit: brighter, louder, climbing.
      interlockHits += 1;
      const intensity = Math.min(1, interlockHits / 30);
      playerTone(time, leadSet[interlockHits % 8] + 12, PLAYER_VOICES[3].kill, 0.5 + intensity * 0.5, 1);
      thud(time, current.pedal + 12, 0.8 + intensity * 0.5, 0.25);
      crackle(time, 0.12 + intensity * 0.1, 0.05, 1500 + intensity * 2500);
      return;
    }
    current.stab.forEach((midi, index) => playerTone(time + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[1].lock, 0.55 - index * 0.1, 1));
    crackle(time, 0.06, 0.03, 5200);
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx || !interlockIds.has(enemyId)) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const { chord: current } = harmonyAt(time);
    // Armor plate sheared off: a struck chord with a metal clank.
    stab(time, current.stab.map((midi) => midi + 12), 0.9, 5200);
    thud(time, current.pedal + 12, 1, 0.5);
    crackle(time, 0.25, 0.12, 900);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    const { position, leadSet, mix, chord: current } = harmonyAt(kill.time);
    if (interlockIds.delete(enemyId)) {
      safetyBlown(kill.time, current, leadSet);
      return;
    }
    const section = mix.t >= 0.5 ? mix.to : mix.from;
    const lanePosition = runtime.mode() === 'ambient' ? kill.step : position;
    const midi = leadSet[KILL_LANES[section][lanePosition % KILL_LANE_STEPS]];
    const chain = indexInVolley ?? 0;
    const vel = Math.min(1.4, 1 + chain * 0.1);
    for (const [layer, weight] of score.sectionLayers(mix)) playerTone(kill.time, midi, PLAYER_VOICES[layer].kill, vel, weight);
    thud(kill.time, midi - 12, 0.7, blendDecay(mix));
    if (chain >= 2) playerTone(kill.time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].lock, 0.35, 1);
    leechIds.delete(enemyId);
  });

  function blendDecay(mix: SectionMix<SectionIndex>) {
    return lerp(PLAYER_VOICES[mix.from].kill.decay, PLAYER_VOICES[mix.to].kill.decay, mix.t);
  }

  function safetyBlown(time: number, current: Chord, leadSet: number[]) {
    interlocksBlown += 1;
    const lift = Math.min(12, interlocksBlown * 2);
    stab(time, current.stab.map((midi) => midi + 12 + (interlocksBlown >= 4 ? 12 : 0)), 1, 4000 + interlocksBlown * 600);
    thud(time, current.pedal + 12, 1.2, 0.7);
    crackle(time, 0.35, 0.2, 700);
    playerTone(time + THIRTYSECOND, leadSet[Math.min(7, interlocksBlown + 1)] + lift, PLAYER_VOICES[3].kill, 0.9, 1);
    if (interlocksBlown < 6) return;
    // All safeties clear: the gun is primed. A beat of held breath, a run up
    // the lead set, and the whine's tremolo smooths into a pure tone.
    runtime.mix()?.duckAt(time, 0.35, BEAT * 2);
    leadSet.forEach((midi, index) => playerTone(time + BEAT * 0.5 + index * THIRTYSECOND, midi + 12, PLAYER_VOICES[3].kill, 0.55 + index * 0.05, 1));
    whine?.tremoloTo(time + BEAT, 0.5, 0.02);
  }

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const { chord: current, leadSet, mix } = harmonyAt(time);
    stab(time, current.stab.map((midi) => midi + 12), size >= 6 ? 1 : 0.7, 4800);
    if (size >= 6) [0, 2, 4, 7].forEach((degree, index) => playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[mix.to].lock, 0.6 - index * 0.08, 1));
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const { chord: current } = harmonyAt(ctx.currentTime);
    breaker(ctx.currentTime, current.pedal + 6);
  });

  bus.on('miss', ({ enemyId }) => {
    if (!ctx || runtime.mode() !== 'run') return;
    const time = ctx.currentTime;
    const { chord: current } = harmonyAt(time);
    if (leechIds.delete(enemyId)) {
      // The drained coil misfires as you cross it: a detuned sputter.
      zap(time, current.pedal + 25, current.pedal + 11, 0.16, 0.05, 'sawtooth', 1400);
      crackle(time, 0.12, 0.08, 1700);
      return;
    }
    if (interlockIds.has(enemyId)) return;
    zap(time, current.pedal + 36, current.pedal + 29, 0.12, 0.03, 'sine', 2000);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const { chord: current } = harmonyAt(time);
    thud(time, current.pedal, 1.6, 0.5);
    zap(time, current.pedal + 30, current.pedal + 6, 0.35, 0.06, 'sawtooth', 2200);
    crackle(time, 0.3, 0.18, 1200);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'leech') leechIds.add(enemyId);
    if (kind === 'interlock') {
      interlockIds.add(enemyId);
      // The clamp slams shut two beats later, on the grid.
      const time = score.nextGridTime(ctx.currentTime + BEAT * 2 - 0.03, 1);
      const { chord: current } = harmonyAt(time);
      thud(time, current.pedal, 1.3, 0.35);
      crackle(time, 0.32, 0.1, 600);
      stab(time, [current.pedal + 24, current.pedal + 30], 0.6, 1800);
    } else if (kind === 'bolt') {
      // Pylon discharge, voiced as a falling zap from the live chord.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const { chord: current } = harmonyAt(time);
      zap(time, current.stab[2] + 12, current.stab[0] - 12, 0.14, 0.045, 'sawtooth', 3200);
      crackle(time, 0.07, 0.05, 3000);
    }
  });

  return runtime;
}
