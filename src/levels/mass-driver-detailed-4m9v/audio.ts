import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  createMassDriverVoices,
  installGunHum,
  type GunHum,
  type MassDriverTonalVoice,
} from './audio-voices';
import { MASS_DRIVER_BPM, MASS_DRIVER_STEPS_PER_BAR, MD_BARS, MD_DURATION, MD_SCORE_SECTIONS, MD_TIME } from './timing';

// The Mass Driver score: 128 BPM locked minimal techno in E minor; 32 bars is
// exactly the 60-second run. Main loop Em–Em–C–D two bars per chord; the
// interlock bars switch to Em–F (the ♭II phrygian dread); the muzzle resolves
// to a single sustained E major bloom — the whole run is minor, the release
// is major. Underneath everything the gun's own hum climbs from E1 across the
// run and accelerates into the firing charge; the bar-28 shot cuts it dead.
// The player is the soloist: locks, shots, chips, and kills snap to the
// transport and read the live harmony, with per-section timbres.

const SIXTEENTH = MD_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const BEAT = MD_TIME.beatSeconds;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Em — Em — C — D, two bars per chord.
const EM: Chord = { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] };
const CHORDS: Chord[] = [
  EM,
  EM,
  { bass: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72], stab: [60, 64, 67] }, // C
  { bass: 38, pad: [50, 57, 62, 66], arp: [62, 66, 69, 74], stab: [62, 66, 69] }, // D
];
// Interlock bars: Em — F. The F natural is the jam.
const F: Chord = { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], stab: [65, 69, 72] };
const INTERLOCK_CHORDS: Chord[] = [EM, F];
// Muzzle: one sustained E major — the Picardy third.
const EMAJ: Chord = { bass: 28, pad: [52, 56, 59, 64], arp: [64, 68, 71, 76], stab: [64, 68, 71] };

type SectionIndex = 0 | 1 | 2 | 3 | 4;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Injection: gentle glassy climbs while the breech opens up.
  0: [
    0, 1, 2, 3, 2, 3, 4, 5,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 5, 6, 7, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 7, 6, 4,
  ],
  // Stage-1: tight square jumps for the four-on-floor.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 6, 5, 7, 6, 4, 2, 0,
  ],
  // Stage-2: urgent high fragments over the acid line.
  2: [
    4, 5, 7, 6, 5, 7, 4, 6,
    7, 5, 6, 4, 7, 6, 5, 7,
    6, 7, 5, 4, 6, 5, 7, 3,
    5, 6, 7, 5, 4, 6, 5, 7,
  ],
  // Interlock: phrygian descents answered by climbs into the deadline.
  3: [
    7, 6, 5, 4, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
    4, 5, 4, 3, 5, 4, 3, 2,
    2, 1, 0, 1, 4, 3, 2, 0,
  ],
  // Muzzle: sparse, hall-drenched resolution (there is nothing to kill here).
  4: [
    0, 2, 4, 7, 4, 2, 0, 4,
    7, 4, 2, 0, 2, 4, 7, 4,
    0, 2, 4, 7, 4, 2, 0, 2,
    4, 7, 4, 2, 0, 4, 2, 0,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// Per-section timbres for the player's instrument: glassy at the breech,
// tight and square in stage-1, bright saws in stage-2, dark reverb-heavy saws
// at the interlocks, quiet and hall-drenched at the muzzle.
const PLAYER_VOICES: Record<SectionIndex, { lock: MassDriverTonalVoice; kill: MassDriverTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 3800, gain: 0.13, sparkle: 0.5, reverb: 0.2 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3400, gain: 0.16, sparkle: 0.7, reverb: 0.3 },
    fire: { oscillator: 'triangle', cutoff: 3200, gain: 0.07, fallSemitones: 12, noise: 0.03 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2400, gain: 0.05, sparkle: 0.35, reverb: 0.12 },
    kill: { oscillator: 'square', decay: 0.17, cutoff: 2900, gain: 0.11, sparkle: 0.5, reverb: 0.18 },
    fire: { oscillator: 'square', cutoff: 3600, gain: 0.055, fallSemitones: 9, noise: 0.04 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.075, cutoff: 4200, gain: 0.05, sparkle: 0.45, reverb: 0.16 },
    kill: { oscillator: 'sawtooth', decay: 0.2, cutoff: 4400, gain: 0.12, sparkle: 0.8, reverb: 0.22 },
    fire: { oscillator: 'sawtooth', cutoff: 5200, gain: 0.065, fallSemitones: 12, noise: 0.055 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.13, cutoff: 2100, gain: 0.06, sparkle: 0.25, reverb: 0.4 },
    kill: { oscillator: 'sawtooth', decay: 0.34, cutoff: 2600, gain: 0.14, sparkle: 0.6, reverb: 0.45 },
    fire: { oscillator: 'square', cutoff: 2800, gain: 0.055, fallSemitones: 13, noise: 0.05 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.2, cutoff: 3000, gain: 0.08, sparkle: 0.4, reverb: 0.6 },
    kill: { oscillator: 'triangle', decay: 0.5, cutoff: 2800, gain: 0.1, sparkle: 0.5, reverb: 0.65 },
    fire: { oscillator: 'sine', cutoff: 2600, gain: 0.04, fallSemitones: 10, noise: 0.02 },
  },
};

// The climbing hum's bar-by-bar plan: up a fourth by the middle, up an octave
// by the interlocks, then an accelerating rise into the charge peak.
function humMidiForBar(barIndex: number) {
  const b = Math.min(MD_BARS.shot, Math.max(0, barIndex));
  if (b <= 16) return 28 + (33 - 28) * (b / 16); // E1 → A1
  if (b <= 20) return 33 + (40 - 33) * ((b - 16) / 4); // A1 → E2
  if (b <= 26) return 40 + (52 - 40) * ((b - 20) / 6); // E2 → E3
  if (b <= 27) return 52 + (56 - 52) * (b - 26); // E3 → G#3
  return 56 + (59 - 56) * (b - 27); // final surge toward B3
}

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-detailed-4m9v',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MD_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  // In trace mode there is no AudioContext; the hum records its moves instead.
  let hum: GunHum | null = trace ? installGunHum(null, null, trace) : null;
  let interlockKills = 0;
  let interlocksSpawned = 0;
  const interlockIds = new Set<number>();

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: MD_BARS.interlock, toBar: MD_BARS.shot, chords: INTERLOCK_CHORDS, barsPerChord: 2 },
      { fromBar: MD_BARS.shot, chords: [EMAJ], barsPerChord: 4 },
    ],
    sections: MD_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) {
        runArrangement.recordSectionStart(time, bar);
        // Steer the gun's fundamental bar by bar; the shot itself cuts it.
        if (bar < MD_BARS.shot) {
          const target = humMidiForBar(bar + 1);
          const level = 0.085 + (bar / MD_BARS.shot) * 0.1;
          const cutoff = 340 * 2 ** ((bar / MD_BARS.shot) * 2.3);
          hum?.rampTo(time, target, MD_TIME.barSeconds, level, cutoff);
        }
      }
    },
    mix: {
      compressor: { threshold: -16, ratio: 5, attack: 0.004, release: 0.2 },
      // A dotted-eighth delay and a long reverb.
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2500 },
      reverb: { seconds: 3.2, decay: 2.7, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      hum = installGunHum(context, mix, trace);
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockKills = 0;
      interlocksSpawned = 0;
      interlockIds.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (context && hum) {
        // Death cut the hum already; a completed run had the shot cut it.
        // Either way, re-idle for attract.
        hum.idle(context.currentTime + 1.6);
      }
    },
    onDispose() {
      ctx = null;
      hum = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const interlocksCleared = () => interlocksSpawned >= 6 && interlockKills >= 6;

  // ---- arrangement ------------------------------------------------------------

  const blankBar = '................';
  const fourFloor = 'K...K...K...K...';
  const offbeatHat = '..H...H...H...H.';
  const beatArp = 'A...A...A...A...';
  const evenArp = 'A.A.A.A.A.A.A.A.';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const barIndex = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(barIndex / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          // Attract: a long pad and quarter arps over the idle hum.
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.55)),
          hits(beatArp, { A: 0.32 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
        ],
      },
    ],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'injection',
        fromBar: MD_BARS.injection,
        tracks: [
          // Sparse downbeat kick with ghost kicks creeping in.
          hits(['K...............', 'K...............', 'K.......g.......', 'K...g...K...g...'].join(''), { K: 0.8, g: 0.4 }, ({ time }, vel) => kick(time, vel)),
          hits('....H.......H...', { H: 0.03 }, ({ time }, vel) => hat(time, vel, 0.025)),
          // The dry high-voltage tick marks every ring crossing from the start.
          hits('T...T...T...T...', { T: 0.5 }, ({ time }, vel) => tick(time, vel)),
          // A quarter-note arp climbing in velocity into the drop.
          fn(({ time, step, bar, chord }) => {
            if (step % 4 !== 0) return;
            arp(time, chord.arp[(step / 4) % chord.arp.length], 0.24 + bar * 0.08 + (step / STEPS_PER_BAR) * 0.06);
          }),
          oneShot(0, 0, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH, 0.5)),
          oneShot(2, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.17)),
        ],
      },
      {
        name: 'stage-1',
        fromBar: MD_BARS.stage1,
        tracks: [
          oneShot(0, 0, ({ time }) => impact(time, 0.75)),
          hits(fourFloor, { K: 0.95 }, ({ time }, vel) => kick(time, vel)),
          hits(offbeatHat, { H: 0.05 }, ({ time }, vel) => hat(time, vel, 0.028)),
          // Driving eighth-note root bass.
          hits('B.b.B.b.B.b.B.b.', { B: 0.85, b: 0.55 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.55)),
          hits(beatArp, { A: 0.5 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 2 === 0) pad(time, chord.pad, 32 * SIXTEENTH * 1.03, 0.45);
          }),
        ],
      },
      {
        name: 'stage-2',
        fromBar: MD_BARS.stage2,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 0.95);
            crash(time, 0.2);
          }),
          hits(fourFloor, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          // Claps on 2 and 4 over a sixteenth hat lattice with opens.
          hits('....C.......C...', { C: 0.8 }, ({ time }, vel) => clap(time, vel)),
          hits('hhhHhhhOhhhHhhhO', { h: 0.026, H: 0.05, O: 0.05 }, ({ time }, vel, symbol) => {
            if (symbol === 'O') openHat(time, vel);
            else hat(time, vel, 0.022);
          }),
          // Busier bass jumping octaves and fifths.
          fn(({ time, step, chord }) => {
            const steps: Record<number, [number, number]> = {
              0: [0, 1], 3: [12, 0.6], 6: [7, 0.85], 8: [0, 0.95], 10: [12, 0.55], 11: [0, 0.7], 14: [7, 0.8],
            };
            if (step in steps) bass(time, chord.bass + steps[step][0], steps[step][1], 0.85);
          }),
          // Arp lifted an octave.
          hits(evenArp, { A: 0.55 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel)),
          // A 303 acid line walking the chord.
          fn(({ time, step, chord }) => {
            const walk = [0, -1, 12, 0, 7, -1, 3, 12, 0, -1, 7, 0, 12, 7, 3, 0];
            const degree = walk[step];
            if (degree === -1) return;
            const accent = step === 2 || step === 7 || step === 12;
            acid(time, chord.bass + 12 + degree, accent ? 0.9 : 0.6, accent ? 1 : 0.55);
          }),
          hits('S...............' + blankBar, { S: 0.6 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
        ],
      },
      {
        name: 'interlock',
        fromBar: MD_BARS.interlock,
        tracks: [
          // A two-bar klaxon and a low impact announce the jam.
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.1);
            klaxon(time, 32 * SIXTEENTH);
          }),
          // The kick gains late-bar syncopation.
          hits('K...K...K...K.K.', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(offbeatHat, { H: 0.045 }, ({ time }, vel) => hat(time, vel, 0.026)),
          hits('B.B.B.B.B.B.B.B.', { B: 0.8 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.95)),
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 2 === 0) pad(time, chord.pad, 32 * SIXTEENTH * 1.03, 0.6);
          }),
          // Rising alarm sweeps every couple of bars.
          fn(({ time, step, barInSection }) => {
            if (step === 8 && barInSection >= 1 && barInSection % 2 === 1) alarm(time, 45 + barInSection, 14 * SIXTEENTH);
          }),
          // A noise riser that grows each bar.
          fn(({ time, step, barInSection }) => {
            if (step === 0) riser(time, 16 * SIXTEENTH, 0.07 + barInSection * 0.022);
          }),
          // The final bar: a snare roll building all the way into the shot.
          fn(({ time, step, bar }) => {
            if (bar === 27) snare(time, 0.14 + step * 0.055);
          }),
        ],
      },
      {
        name: 'muzzle',
        fromBar: MD_BARS.shot,
        tracks: [
          // THE SHOT: impact, crash, a hard duck, the hum cut dead — and, if
          // the gun actually fired, a huge E-major bloom into open space.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.4);
            crash(time, 0.35);
            runtime.mix()?.duckAt(time, 0.05, 2.4);
            hum?.cut(time);
            if (interlocksCleared()) {
              pad(time + 0.05, [chord.bass + 12, ...chord.pad, ...chord.stab.map((midi) => midi + 12)], 7, 1.15);
            }
          }),
          // Glassy sparkle delays and a subsiding sub pulse, fading to silence.
          fn(({ time, step, barInSection, chord }) => {
            if (!interlocksCleared()) return;
            const fade = Math.max(0, 1 - barInSection * 0.24);
            if (step === 4 || step === 10) sparkle(time, chord.arp[(step + barInSection) % chord.arp.length] + 12, 0.7 * fade);
            if (step === 0 && barInSection > 0) bass(time, chord.bass, 0.45 * fade, 0.1);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices -------------------------------------------------------------------

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, snare, clap, hat, openHat, tick, bass, pad, arp, acid, stab, klaxon, alarm, riser, crash, impact,
    sparkle, detonation, noiseHit, playerSends, playerTone, playerNoise, clank,
  } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const ignitionSubVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.2 }],
    duration: 0.2,
    stopPadding: 0.04,
    envelope: { decay: 0.2 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.075,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const chipVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3600 },
    envelope: { decay: 0.08 },
  });

  const stageRingVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.6,
    stopPadding: 0.06,
    envelope: { decay: 0.6 },
  });

  // Reject: a breaker trip — a dead low minor-second CLUNK falling into the
  // floor. Cold iron, no reward.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 4, frequency: 620 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.45 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const hullAlarmVoice = voice({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.12,
    stopPadding: 0.03,
    envelope: { decay: 0.12 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.11,
    stopPadding: 0.02,
    envelope: { decay: 0.11 },
  });

  // ---- player instruments ----------------------------------------------------
  // Player actions are written into the score: every positive action snaps to
  // the transport, reads the live chord, and sends tails into the same delay
  // and hall as the arrangement.

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof MassDriverTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = score.leadSetAt(position);
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = leadSet[degree];
    const vel = Math.min(1.4, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    const sparkleAmount = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkleAmount * 0.05, 0.08, 7400);
  }

  // Each interlock kill plays a climbing confirmation — one more note than the
  // last, brighter and higher each time, capped with an ignition ping and a
  // clamp-release clank that drops in pitch per interlock.
  function interlockConfirmation(time: number, count: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const notes = Math.min(count + 1, 7);
    for (let i = 0; i < notes; i += 1) {
      const at = time + i * THIRTYSECOND;
      const midi = leadSet[Math.min(7, i + Math.max(0, count - 2))];
      playerTone(at, midi, PLAYER_VOICES[3].kill, 0.65 + count * 0.07 + i * 0.04, 1);
    }
    const ping = leadSet[Math.min(7, notes)] + 12;
    playerTone(time + notes * THIRTYSECOND, ping, PLAYER_VOICES[3].lock, 0.8, 1);
    clank(time + notes * THIRTYSECOND + THIRTYSECOND, count);

    if (count >= 6) {
      // The sixth: a beat of ducked silence, an impact, a high chord stab,
      // and a conclusive descent.
      const audioMix = runtime.mix();
      const chord = score.chordAt(position);
      audioMix?.duckAt(time, 0.1, BEAT);
      impact(time + BEAT, 1.15);
      stab(time + BEAT, chord.stab.map((midi) => midi + 12), 0.9);
      score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
        playerTone(time + BEAT + (index + 1) * THIRTYSECOND, midi, PLAYER_VOICES[3].kill, 0.8 - index * 0.06, 1);
      });
    }
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') {
      interlockIds.add(enemyId);
      interlocksSpawned += 1;
    }
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].lock, 1, weight);
    }
    const sparkleAmount = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.014 + sparkleAmount * 0.032, 0.024, 9200);
    if (lockCount >= 6) {
      // The sixth lock is ignition: an octave ping and a falling sub thump.
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      ignitionSubVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.15 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    // Unlock answers with a soft high tick.
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.32, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fire = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: fire.oscillator,
        cutoff: fire.cutoff,
        gainValue: fire.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.062 }],
        destination: output,
        sends: playerSends(0.18, 0.08),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.025, 4800);
  });

  bus.on('hit', ({ lethal }) => {
    // Armor chips tick a soft arpeggio.
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      chipVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        gainValue: 0.05 - index * 0.008,
        destination: output,
        sends: playerSends(0.22, 0.16),
      });
    }
    playerNoise(time, 0.04, 0.032, 5800);
  });

  bus.on('stage', ({ stageIndex }) => {
    // Stage breaks crack metallically and ring a chord tone into the hall.
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.18, 0.12, 2700);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageRingVoice.play({
        context: ctx,
        time,
        midi,
        gainValue: 0.13,
        destination: output,
        sends: playerSends(0.24, 0.55),
      });
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (interlockIds.delete(enemyId)) {
      interlockKills += 1;
      interlockConfirmation(kill.time, interlockKills);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('miss', ({ enemyId }) => {
    interlockIds.delete(enemyId);
    // A miss is a barely-there falling tick.
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.1 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('volley', ({ size, kills }) => {
    // A full clean volley lands a chord stab an octave up.
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.7);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.55 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[82.4, time, 0.17], [87.3, time + 0.02, 0.13]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.45, time: at + 0.18 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.09, 'lowpass', 480, output);
  });

  bus.on('playerhit', () => {
    // A player hit booms a falling octave under a two-note hull alarm.
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      hullAlarmVoice.play({ context, time: time + index * 0.13, midi, destination: output, sends: playerSends(0.1, 0.08) });
    });
    noiseHit(time, 0.18, 0.15, 'bandpass', 780, output);
  });

  bus.on('runend', ({ died }) => {
    if (!ctx || !hum) return;
    const time = ctx.currentTime;
    if (died) {
      hum.cut(time);
      const barIndex = score.barAt(score.arrangementPositionAt(time));
      if (barIndex >= 27) {
        // Containment failure: the music collapses to a long sub rumble and
        // filtered noise.
        runtime.mix()?.duckAt(time, 0.04, 3.4);
        detonation(time);
      } else {
        runtime.mix()?.duckAt(time, 0.2, 1.6);
        impact(time, 0.9);
      }
    }
  });

  return runtime;
}
