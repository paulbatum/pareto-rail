import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createSpeedsolveVoices, type Lane } from './audio-voices';
import { assemblyBeats, onCubeSignal, type CubeSignal } from './signals';
import {
  FACE_COUNT,
  SPEEDSOLVE_BARS,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_RUN_DURATION,
  SPEEDSOLVE_STEPS_PER_BAR,
  SPEEDSOLVE_TIME,
  faceBar,
} from './timing';

// The cube is the percussion section. Every drum in the arrangement is one of
// the cube's own sounds — the ratchet click is the hi-hat, the plastic snap is
// the snare, the hollow thock is the kick — so when the player snaps a slice
// it lands on the transport's exact eighth note as a fill on the same kit.
// The band starts as kick, clicks, and a plucked bass; every face that falls
// adds one clean layer from the next bar. Everything is quantized, dry of
// swing, and hard-attacked. The harmony is a mechanical B minor cycle that
// tips into G–A under the naked core and resolves to D major when it bursts.

const STEP = SPEEDSOLVE_TIME.stepSeconds;
const THIRTYSECOND = STEP / 2;
const STEPS_PER_BAR = SPEEDSOLVE_STEPS_PER_BAR;

type Chord = { name: string; root: number; triad: readonly number[]; arp: readonly number[] };

const D: Chord = { name: 'D', root: 38, triad: [62, 66, 69], arp: [74, 78, 81, 86] };
const A: Chord = { name: 'A', root: 33, triad: [61, 64, 69], arp: [73, 76, 81, 85] };
const BM: Chord = { name: 'Bm', root: 35, triad: [62, 66, 71], arp: [71, 74, 78, 83] };
const G: Chord = { name: 'G', root: 31, triad: [62, 67, 71], arp: [71, 74, 79, 83] };
const ASUS: Chord = { name: 'Asus4', root: 33, triad: [62, 64, 69], arp: [74, 76, 81, 86] };
const DADD9: Chord = { name: 'Dadd9', root: 38, triad: [62, 66, 69], arp: [74, 76, 78, 81] };

// Chord sets index by absolute bar: bar % length. Faces begin on bars 2, 6,
// 10 … so every face phrase opens on B minor and walks G, D, A.
const CYCLE: readonly Chord[] = [D, A, BM, G];
const CORE_SET: readonly Chord[] = [BM, ASUS, G, A]; // bars 26 G, 27 A, 28 Bm, 29 Asus4

type Section = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const SECTIONS = [
  { index: 0 as Section, fromBar: 0 },
  ...Array.from({ length: FACE_COUNT }, (_, face) => ({ index: (face + 1) as Section, fromBar: faceBar(face) })),
  { index: 7 as Section, fromBar: SPEEDSOLVE_BARS.shell },
  { index: 8 as Section, fromBar: SPEEDSOLVE_BARS.coreDeadline },
];

// Kill lanes: degrees into the lead set (the chord's arp plus its octave).
// Each face gets its own mechanical figure, so a chained volley plays it.
const KILL_LANES: Record<Section, readonly number[]> = {
  0: [0, 2, 4, 6, 1, 3, 5, 7],
  1: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3],
  2: [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 4, 2, 1],
  3: [0, 4, 1, 5, 2, 6, 3, 7, 0, 4, 1, 5, 2, 6, 3, 7],
  4: [7, 6, 5, 4, 3, 2, 1, 0, 3, 4, 5, 6, 7, 6, 5, 4],
  5: [0, 3, 6, 1, 4, 7, 2, 5, 0, 3, 6, 1, 4, 7, 5, 3],
  6: [4, 5, 6, 7, 4, 5, 6, 7, 5, 6, 7, 6, 5, 4, 3, 2],
  7: [7, 5, 6, 4, 5, 3, 4, 2, 3, 1, 2, 0, 4, 5, 6, 7],
  8: [0, 2, 4, 7, 4, 2, 0, 4],
};
/** Kill brightness climbs with every face. */
const KILL_BRIGHT: Record<Section, number> = { 0: 0.1, 1: 0.2, 2: 0.3, 3: 0.4, 4: 0.5, 5: 0.6, 6: 0.72, 7: 0.9, 8: 0.6 };

// ---- patterns: one character per sixteenth -----------------------------------
const KICK = 'K...K...K...K...';
const KICK_DRIVE = 'K...K...K...K.k.';
const HAT_OFF = '..x...x...x...x.';
const HAT_16 = 'x.xXx.xXx.xXx.xX';
const HAT_16_FULL = 'xxXxxxXxxxXxxxXx';
const SNARE = '....S.......S...';
const SNARE_GHOST = '....S..s....S.s.';
const BASS = 'R.r.R.r.R.r.R.o.';
const BASS_DRIVE = 'R.rrR.o.R.rrR.oR';
const STABS = '..s...s...s...s.';
const ARP_8 = 'a.a.a.a.a.a.a.a.';
const ARP_16 = 'aaaaaaaaaaaaaaaa';
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3];

/** Layers present after `layers` faces have fallen. */
const LAYER = {
  snare: 1,
  arp: 2,
  stabs: 3,
  sub: 4,
  glass: 5,
} as const;

export function createAudio(bus: EventBus) {
  return createSpeedsolveAudio(bus).audio;
}

export const traceSpeedsolveAudio = createAudioTraceHarness({
  level: 'speedsolve-bnmf',
  bpm: SPEEDSOLVE_BPM,
  stepSeconds: STEP,
  defaultSeconds: SPEEDSOLVE_RUN_DURATION,
  createAudio: createSpeedsolveAudio,
});

function createSpeedsolveAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let fallen = 0;
  let layers = 0;
  let resolveFromPosition = Infinity;
  let coreId = -1;
  let coreHp = 12;
  const kinds = new Map<number, string>();

  const score = createScore<Chord, Section>({
    bpm: SPEEDSOLVE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CYCLE,
    alternateChordSets: [
      { fromBar: SPEEDSOLVE_BARS.shell, toBar: SPEEDSOLVE_BARS.coreDeadline, chords: CORE_SET },
      { fromBar: SPEEDSOLVE_BARS.coreDeadline, chords: [DADD9] },
    ],
    sections: SECTIONS,
    killLanes: KILL_LANES,
    leadSet: (chord) => [...chord.arp, ...chord.arp.map((midi) => midi + 12)],
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP,
    volumeScale: 0.54,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -20, knee: 8, ratio: 5, attack: 0.002, release: 0.2 },
      delay: { time: STEP * 3, feedback: 0.26, dampHz: 3400 },
      reverb: { seconds: 1.6, decay: 3, level: 0.22 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      fallen = 0;
      layers = 0;
      resolveFromPosition = Infinity;
      coreId = -1;
      coreHp = 12;
      kinds.clear();
      score.clearOverride();
      // The traced run has no gameplay to announce the assembly; play it from the top.
      if (trace) playAssembly(0, 26, 6);
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (context) v.air(context.currentTime + 0.05, [50, 57, 62, 66, 69], 5, 0.8);
    },
    onDispose() {
      ctx = null;
      offSignals();
    },
  });

  const v = createSpeedsolveVoices({ trace, context: () => ctx ?? runtime.context(), mix: runtime.mix });
  const offSignals = trace ? () => {} : onCubeSignal(handleSignal);

  // ---- musical position ------------------------------------------------------

  /** Audio time of an arrangement beat (beat 0 = the run's first downbeat). */
  function beatTime(beat: number) {
    return score.epoch + (score.arrangementStart + beat * 4) * STEP;
  }

  function now() {
    return runtime.context()?.currentTime ?? 0;
  }

  function positionAt(time: number) {
    return score.arrangementPositionAt(time);
  }

  // ---- arrangement -------------------------------------------------------------

  const each = (pattern: string, step: number) => pattern[step % pattern.length];

  const ambient = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        fn(({ time, step, bar, chord }) => {
          if (step % 4 === 0) v.click(time, step === 0 ? 0.5 : 0.28, 7200, 'music');
          if (step % 8 === 4) v.mallet(time, chord.arp[(bar + step / 4) % chord.arp.length] - 12, 0.45, 'music');
          if (step === 0 && bar % 2 === 0) v.air(time, [chord.root + 12, ...chord.triad], SPEEDSOLVE_TIME.barSeconds * 2, 0.55);
        }),
      ],
    }],
  });

  const run = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'assembly',
        fromBar: 0,
        tracks: [
          fn(({ time, step, barInSection, chord }) => {
            if (barInSection === 0 && step === 0) v.air(time, [chord.root + 12, ...chord.triad], SPEEDSOLVE_TIME.barSeconds * 2.2, 0.8);
            if (barInSection === 1) {
              if (step % 4 === 0) v.thock(time, step === 12 ? 0.9 : 0.55, 'music');
              if (step >= 8 && step % 2 === 0) v.click(time, 0.25 + step * 0.02, 6000, 'music');
              if (step === 15) v.riser(time - STEP * 7, STEP * 7.5, 0.6);
            }
          }),
        ],
      },
      { name: 'faces', fromBar: SPEEDSOLVE_BARS.firstFace, tracks: [fn(playFaces)] },
      { name: 'naked core', fromBar: SPEEDSOLVE_BARS.shell, tracks: [fn(playCore)] },
      { name: 'confetti', fromBar: SPEEDSOLVE_BARS.coreDeadline, tracks: [fn(playResolve)] },
    ],
  });

  function playFaces(context: { time: number; step: number; bar: number; position: number; chord: Chord }) {
    const { time, step, bar, position, chord } = context;
    if (position >= resolveFromPosition) return playResolve(context);
    if (step === 0) layers = trace ? nominalLayers(bar) : fallen;
    const kick = each(KICK, step);
    if (kick !== '.') v.thock(time, kick === 'K' ? 1 : 0.7, 'music');
    const hatPattern = layers >= LAYER.arp ? HAT_16 : HAT_OFF;
    const hat = each(hatPattern, step);
    if (hat !== '.') v.click(time, hat === 'X' ? 0.55 : 0.3, hat === 'X' ? 6400 : 8200, 'music');
    if (layers >= LAYER.snare) {
      const snare = each(layers >= LAYER.sub ? SNARE_GHOST : SNARE, step);
      if (snare !== '.') v.snap(time, snare === 'S' ? 0.9 : 0.35, chord.root + 36, 'music');
    }
    const bass = each(layers >= LAYER.sub ? BASS_DRIVE : BASS, step);
    if (bass !== '.') {
      const midi = chord.root + (bass === 'o' ? 12 : 0);
      v.bass(time, midi, bass === 'R' ? 1 : 0.7, STEP * 1.7);
      if (layers >= LAYER.sub && bass === 'R') v.bass(time, midi - 12, 0.6, STEP * 3);
    }
    if (layers >= LAYER.arp) {
      const arp = each(layers >= LAYER.glass ? ARP_16 : ARP_8, step);
      if (arp !== '.') {
        const degree = ARP_ORDER[(layers >= LAYER.glass ? step : step / 2) % ARP_ORDER.length];
        v.mallet(time, chord.arp[degree] - 12, step % 4 === 0 ? 0.9 : 0.6, 'music');
      }
    }
    if (layers >= LAYER.stabs && each(STABS, step) !== '.') v.stab(time, [...chord.triad], 0.9);
    if (layers >= LAYER.glass && step % 4 === 0) {
      const lead = score.leadSetAt(position);
      v.glass(time, lead[[4, 6, 5, 7][(bar % 2) * 2 + (step >= 8 ? 1 : 0)]], 0.55, 0.6, 'music');
    }
  }

  function playCore(context: { time: number; step: number; bar: number; barInSection: number; position: number; chord: Chord }) {
    const { time, step, barInSection, position, chord } = context;
    if (position >= resolveFromPosition) return playResolve(context);
    const kick = each(KICK_DRIVE, step);
    if (kick !== '.') v.thock(time, kick === 'K' ? 1 : 0.65, 'music');
    const hat = each(HAT_16_FULL, step);
    v.click(time, hat === 'X' ? 0.5 : 0.24, hat === 'X' ? 6400 : 8600, 'music');
    const snare = each(barInSection === 3 ? '....S...S.S.SSSS' : SNARE_GHOST, step);
    if (snare !== '.') v.snap(time, snare === 'S' ? 0.9 : 0.4, chord.root + 36, 'music');
    const bass = each(BASS_DRIVE, step);
    if (bass !== '.') {
      v.bass(time, chord.root + (bass === 'o' ? 12 : 0), bass === 'R' ? 1 : 0.75, STEP * 1.6);
      if (bass === 'R') v.bass(time, chord.root - 12, 0.6, STEP * 3);
    }
    v.mallet(time, chord.arp[ARP_ORDER[step % ARP_ORDER.length]] - 12, step % 4 === 0 ? 0.9 : 0.55, 'music');
    if (each(STABS, step) !== '.') v.stab(time, [...chord.triad], 1);
    if (step === 0) v.air(time, [chord.root + 12, ...chord.triad], SPEEDSOLVE_TIME.barSeconds, 0.7);
    if (barInSection === 0 && step === 0) v.riser(time, SPEEDSOLVE_TIME.barSeconds * 4, 0.8);
  }

  function playResolve({ time, step, bar }: { time: number; step: number; bar: number }) {
    // Music-box coda: the kit falls silent but for a clock, the chord rings.
    const chord = DADD9;
    if (step % 4 === 0) v.click(time, step === 0 ? 0.4 : 0.2, 7600, 'music');
    if (step % 2 === 0) v.glass(time, chord.arp[ARP_ORDER[(step / 2) % ARP_ORDER.length]] + (bar % 2 === 0 ? 0 : 12), 0.45 - step * 0.01, 1.2, 'music');
    if (step === 0) {
      v.bass(time, chord.root, 0.6, SPEEDSOLVE_TIME.barSeconds * 0.9);
      v.air(time, [chord.root + 12, ...chord.triad, 76], SPEEDSOLVE_TIME.barSeconds * 1.2, 0.9);
    }
  }

  /** Trace-only stand-in for the live fall count: each face falls around beat 12 of its phrase. */
  function nominalLayers(bar: number) {
    let count = 0;
    for (let face = 0; face < FACE_COUNT; face += 1) if (bar >= faceBar(face) + 4) count += 1;
    return count;
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambient.schedule(position, time);
    else run.schedule(position, time);
  }

  // ---- the cube's own mechanics -------------------------------------------------

  function playAssembly(fromBeat: number, pieces: number, spanBeats: number) {
    const landings = assemblyBeats(pieces, spanBeats);
    const seen = new Map<number, number>();
    for (const beat of landings) seen.set(beat, (seen.get(beat) ?? 0) + 1);
    let index = 0;
    for (const [beat, count] of seen) {
      const time = Math.max(now(), beatTime(fromBeat + beat));
      const chord = score.chordAt(positionAt(time));
      v.click(time, 0.3 + Math.min(0.4, count * 0.12), 5200 + index * 60, 'sfx');
      v.snap(time, 0.35 + index * 0.02, chord.arp[index % chord.arp.length] - 12, 'sfx');
      index += 1;
    }
    const last = beatTime(fromBeat + spanBeats);
    v.thock(Math.max(now(), last), 1, 'sfx');
  }

  function handleSignal(signal: CubeSignal) {
    if (signal.type === 'reform') {
      playReform(signal.delaySeconds, signal.pieces, signal.spanBeats);
      return;
    }
    if (!runtime.context() || runtime.mode() !== 'run') return;
    switch (signal.type) {
      case 'assemble':
        playAssembly(signal.beat, signal.pieces, signal.spanBeats);
        break;
      case 'arm': {
        // Brackets arm: a two-click "ready" on the next eighth.
        const time = score.nextGridTime(now() + 0.02, 2);
        const chord = score.chordAt(positionAt(time));
        v.click(time, 0.5, 5200, 'sfx');
        v.mallet(time, chord.arp[0], 0.7, 'sfx');
        v.mallet(time + STEP, chord.arp[2], 0.6, 'sfx');
        break;
      }
      case 'turn':
        playTurn(signal);
        break;
      case 'solved': {
        const time = Math.max(now(), beatTime(signal.beat)) + STEP;
        const chord = score.chordAt(positionAt(time));
        chord.arp.forEach((midi, index) => v.mallet(time + index * THIRTYSECOND, midi, 0.8 + index * 0.08, 'sfx'));
        v.glass(time + THIRTYSECOND * 4, chord.arp[3] + 12, signal.auto ? 0.4 : 0.9, 1.1, 'sfx');
        break;
      }
      case 'fall': {
        const time = Math.max(now(), beatTime(signal.beat));
        v.shower(time, 36, SPEEDSOLVE_TIME.beatSeconds * 1.6, score.chordAt(positionAt(time)).root);
        fallen = Math.max(fallen, signal.face + 1);
        break;
      }
      case 'expose': {
        const time = Math.max(now(), beatTime(signal.beat));
        const chord = score.chordAt(positionAt(time));
        v.glass(time, chord.arp[0], 0.8, 0.5, 'sfx');
        v.glass(time + STEP * 2, chord.arp[2], 0.8, 0.5, 'sfx');
        v.click(time, 0.6, 3000, 'sfx');
        break;
      }
      case 'conquer': {
        const time = score.nextGridTime(now() + 0.01, 2);
        const chord = score.chordAt(positionAt(time));
        if (signal.destroyed) {
          v.snap(time, 1, chord.root + 36, 'sfx');
          v.thock(time, 1, 'sfx');
          v.bloom(time, [chord.root + 24, ...chord.triad], 1.2, 0.9);
          v.glass(time + STEP, chord.arp[3] + 12, 0.8, 1.4, 'sfx');
        } else {
          v.glass(time, chord.arp[1], 0.5, 0.4, 'sfx');
          v.glass(time + STEP * 2, chord.arp[0] - 1, 0.4, 0.5, 'sfx');
        }
        break;
      }
      case 'shell': {
        const time = Math.max(now(), beatTime(signal.beat));
        for (let i = 0; i < 16; i += 1) v.click(time + i * THIRTYSECOND * (1 - i / 40), 0.3 + i * 0.03, 3600 + i * 260, 'sfx');
        v.snap(time, 1, 50, 'sfx');
        v.boom(time, 0.9);
        break;
      }
      case 'burst': {
        const time = score.nextGridTime(now() + 0.01, 1);
        resolveFromPosition = positionAt(score.nextGridTime(time + 0.01, 4));
        score.overrideSection(8);
        playBurst(time, signal.destroyed);
        break;
      }
    }
  }

  /** The cube clicking back together behind REPLAY: a soft accelerating roll. */
  function playReform(delaySeconds: number, pieces: number, spanBeats: number) {
    const context = runtime.context();
    if (!context) return;
    const start = context.currentTime + delaySeconds;
    const landings = [...new Set(assemblyBeats(pieces, spanBeats))];
    landings.forEach((beat, index) => {
      const time = start + beat * SPEEDSOLVE_TIME.beatSeconds;
      v.click(time, 0.18 + index * 0.012, 5600 + index * 90, 'sfx');
      v.snap(time, 0.22 + index * 0.012, DADD9.arp[index % DADD9.arp.length] - 12, 'sfx');
    });
    v.thock(start + spanBeats * SPEEDSOLVE_TIME.beatSeconds, 0.6, 'sfx');
  }

  function playTurn(signal: Extract<CubeSignal, { type: 'turn' }>) {
    const snapTime = Math.max(now() + 0.005, beatTime(signal.snapBeat));
    const startTime = Math.max(now(), beatTime(signal.startBeat));
    const chord = score.chordAt(positionAt(snapTime));
    // Ratchet: detent clicks on the 32nd grid while the slice spins, rising.
    const firstClick = score.nextGridTime(startTime, 0.5);
    let clicks = 0;
    for (let at = firstClick; at < snapTime - THIRTYSECOND * 0.5; at += THIRTYSECOND) {
      v.click(at, 0.22 + clicks * 0.06, 3800 + clicks * 700, 'sfx');
      clicks += 1;
    }
    // The landing: a snap pitched up the chord as the face nears solved.
    const climb = chord.arp[Math.min(chord.arp.length - 1, Math.floor(((signal.step - 1) / Math.max(1, signal.steps - 1)) * (chord.arp.length - 1)))];
    const lane: Lane = 'sfx';
    v.snap(snapTime, signal.auto ? 0.7 : 1, climb - 12, lane);
    v.thock(snapTime, signal.auto ? 0.35 : 0.5, lane);
    if (!signal.auto) v.mallet(snapTime, climb, 0.7, lane);
  }

  function playBurst(time: number, destroyed: boolean) {
    const mix = runtime.mix();
    mix?.duckAt(time, 0.25, SPEEDSOLVE_TIME.barSeconds);
    v.boom(time, 1.2);
    v.snap(time, 1.2, 50, 'sfx');
    v.bloom(time, destroyed ? [50, 62, 66, 69, 74, 78] : [50, 62, 69], 3.2, destroyed ? 1.2 : 0.7);
    // Confetti: a storm of tiny detents that thins out as it falls.
    for (let i = 0; i < 72; i += 1) {
      const u = i / 72;
      v.click(time + STEP + u ** 1.6 * 3.2 + Math.random() * 0.02, 0.35 * (1 - u) + 0.05, 5000 + Math.random() * 3500, 'sfx');
    }
    // A falling peal down D major, one per sixteenth, ringing out.
    [98, 93, 90, 86, 81, 78, 74, 69, 66, 62].forEach((midi, index) => {
      v.glass(time + STEP * (index + 1), midi, (destroyed ? 0.9 : 0.5) - index * 0.04, 1.6, 'sfx');
    });
  }

  // ---- the player's instrument -----------------------------------------------------

  bus.on('spawn', ({ enemyId, kind }) => {
    kinds.set(enemyId, kind);
    if (kind === 'core') {
      coreId = enemyId;
      coreHp = 12;
    }
    if (kind === 'shard' && ctx) {
      // Enemy fire speaks in a thin, off-kit tick so it reads as incoming.
      const time = score.quantizePlayerAction(ctx.currentTime);
      const lead = score.leadSetAt(positionAt(time));
      v.glass(time, lead[7] + 12, 0.35, 0.18, 'sfx');
      v.click(time, 0.3, 9000, 'sfx');
    }
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(positionAt(time));
    v.lockTick(time, lead[Math.min(lead.length - 1, lockCount + 1)], lockCount);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = score.chordAt(positionAt(time));
    v.zap(time, chord.root + 36 + (indexInVolley ?? 0) % 2 * 7, 1);
    v.click(time, 0.18, 9500, 'sfx');
  });

  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    if (!ctx || lethal) return;
    const kind = kinds.get(enemyId);
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(positionAt(time));
    if (enemyId === coreId) {
      const intensity = 1 - hitPointsRemaining / coreHp;
      v.clank(time, chord.root + 24 + Math.round(intensity * 12), intensity);
      v.glass(time, score.leadSetAt(positionAt(time))[Math.min(7, Math.floor(intensity * 8))] + 12, 0.5 + intensity * 0.4, 0.5, 'sfx');
    } else if (kind === 'weakpoint') {
      v.clank(time, chord.root + 24, 0.4);
    } else {
      v.click(time, 0.4, 4200, 'sfx');
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kind = kinds.get(enemyId);
    kinds.delete(enemyId);
    if (enemyId === coreId) return; // the burst signal owns the finale
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const section = score.sectionMixAt(position).to;
    const chain = indexInVolley ?? 0;
    v.plink(kill.time, kill.midi, Math.min(1.35, 0.9 + chain * 0.09), KILL_BRIGHT[section]);
    if (chain >= 3) v.plink(kill.time, kill.midi + 12, 0.35, KILL_BRIGHT[section]);
    if (kind === 'weakpoint') v.snap(kill.time, 1, kill.midi - 24, 'sfx');
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 6 || kills < size) return;
    // A clean six: the kit answers with a stab on the next beat.
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(positionAt(time));
    v.stab(time, [...chord.triad, chord.triad[0] + 12], 1.2);
    v.snap(time, 0.8, chord.root + 36, 'sfx');
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(positionAt(time));
    v.buzz(time, chord.root + 25);
    v.click(time, 0.5, 2400, 'sfx');
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    v.boom(time, 1);
    v.buzz(time + 0.02, 58);
    runtime.mix()?.duckAt(time, 0.55, 0.4);
  });

  bus.on('miss', ({ enemyId }) => {
    const kind = kinds.get(enemyId);
    kinds.delete(enemyId);
    if (!ctx || kind === 'conductor' || kind === 'shard' || kind === undefined) return;
    v.click(ctx.currentTime, 0.12, 1400, 'sfx');
  });

  return runtime;
}
