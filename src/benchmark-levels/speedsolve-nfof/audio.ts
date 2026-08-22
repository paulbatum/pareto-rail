import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { midiToFreq } from '../../engine/music';
import { createSpeedsolveVoices } from './audio-voices';
import { solveState } from './solve-state';
import {
  FACE_COUNT,
  SPEEDSOLVE_BARS,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_DURATION,
  SPEEDSOLVE_SCORE_SECTIONS,
  SPEEDSOLVE_STEPS_PER_BAR,
  SPEEDSOLVE_TIME,
  type SpeedsolveSection,
} from './timing';

// The Speedsolve score: 128 BPM, 32 bars in A minor, precise and mechanical.
// The design rule is that the cube IS the percussion: woodblock snaps are the
// backbeat, the clock ticks eights under everything, and every player action —
// locks, volleys, kills, solves — lands quantized on the transport grid using
// the same mechanism timbres. Each conquered face adds a layer to the groove;
// the core finale strips to a spin-up riser, then resolves as the confetti
// falls and the run ends exactly on the final phrase boundary.

const SIXTEENTH = SPEEDSOLVE_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SPEEDSOLVE_STEPS_PER_BAR;
const BAR_SECONDS = SPEEDSOLVE_TIME.barSeconds;
const PAD_2BAR = 2 * BAR_SECONDS;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// A minor, nine-heavy, two bars each: Am9 — Fmaj9 — Cmaj9 — Em7. Arps park in
// the top octave; the mid register stays free for the kill-lane melody.
const CHORDS: Chord[] = [
  { bass: 33, pad: [57, 60, 64, 71], arp: [76, 79, 81, 84], stab: [76, 79, 81] }, // Am9
  { bass: 29, pad: [53, 57, 60, 69], arp: [77, 81, 84, 88], stab: [77, 81, 84] }, // Fmaj9
  { bass: 36, pad: [55, 62, 64, 67], arp: [79, 84, 86, 91], stab: [79, 84, 86] }, // Cmaj9
  { bass: 28, pad: [52, 59, 62, 64], arp: [76, 79, 83, 86], stab: [76, 79, 83] }, // Em7
];

// Kill lanes: 64-step (four-bar) degree contours into the live 8-note lead set,
// one per section. Written as real melodic lines so a chained volley sings.
const KILL_LANES: Record<SpeedsolveSection, number[]> = {
  boot: [
    0, 2, 4, 2, 3, 5, 4, 2, 1, 3, 5, 3, 4, 6, 5, 3,
    0, 2, 4, 6, 5, 3, 4, 2, 5, 7, 6, 4, 5, 3, 2, 0,
  ],
  solve: [
    0, 2, 4, 5, 4, 5, 7, 5, 2, 4, 6, 7, 6, 7, 5, 4,
    0, 3, 5, 7, 5, 4, 2, 4, 5, 7, 6, 7, 4, 5, 7, 7,
  ],
  climax: [
    4, 6, 5, 7, 6, 4, 5, 7, 5, 7, 6, 4, 7, 5, 6, 4,
    7, 6, 7, 5, 6, 7, 5, 7, 6, 7, 6, 4, 7, 5, 7, 7,
  ],
  core: [
    3, 2, 1, 0, 2, 1, 0, 2, 4, 3, 2, 1, 3, 2, 1, 0,
    2, 1, 0, 2, 1, 0, 2, 0, 0, 2, 4, 2, 0, 4, 2, 0,
  ],
};

// Player-instrument timbre. Uniformly mechanical — clean attacks, tight decay —
// with the brightness opening slightly as faces are conquered (read live).
export type PlayerTone = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number };

function playerVoices(): Record<'lock' | 'kill', PlayerTone> {
  const heat = Math.min(1, solveState.facesConquered / FACE_COUNT);
  return {
    lock: { oscillator: 'square', decay: 0.09, cutoff: 2600 + heat * 1800, gain: 0.05 },
    kill: { oscillator: 'triangle', decay: 0.24, cutoff: 3000 + heat * 2200, gain: 0.13 },
  };
}

export function createAudio(bus: EventBus) {
  return createSpeedsolveAudio(bus).audio;
}

export const traceSpeedsolveAudio = createAudioTraceHarness({
  level: 'speedsolve-nfof',
  bpm: SPEEDSOLVE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SPEEDSOLVE_DURATION,
  createAudio: createSpeedsolveAudio,
});

function createSpeedsolveAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;

  const score = createScore<Chord, SpeedsolveSection>({
    bpm: SPEEDSOLVE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: SPEEDSOLVE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.28, dampHz: 2400 },
      reverb: { seconds: 2.4, decay: 2.2, level: 0.42 },
      noiseSeconds: 3,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onDispose() {
      ctx = null;
    },
  });

  const {
    kick, snare, tick, snap, shaker, hat, sub, pad, arp, stab, bell, swell, clank, whoosh, riser,
    sfxDestination, noiseHit,
  } = createSpeedsolveVoices({ trace, context: () => ctx, mix: runtime.mix });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = runtime.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playPlayerTone(time: number, midi: number, tone: PlayerTone, vel = 1, weight = 1) {
    if (trace) {
      trace.record(time, 'playerTone', { midi, vel, oscillator: tone.oscillator });
      return;
    }
    const context = ctx;
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, tone, velocity: vel, weight, destination: output, sends: playerSends(0.3, 0.18) });
  }

  // ---- arrangements ---------------------------------------------------------

  const ambientChordAt = (position: number) => CHORDS[Math.floor(Math.floor(position / STEPS_PER_BAR) / 2) % CHORDS.length];

  // Attract: the puzzle idling — a warm drone, the clock ticking softly, rare
  // snaps. No groove until the scramble starts.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: ambientChordAt,
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          fn(({ time, step, bar: barIndex, chord }) => {
            if (step === 0 && barIndex % 4 === 0) pad(time, chord.pad, 4 * BAR_SECONDS, 0.55, 1200, 0.5);
          }),
          hits('t.......t.......', { t: 0.05 }, ({ time }, vel) => tick(time, vel)),
          fn(({ time, step, bar: barIndex }) => {
            if (step === 8 && barIndex % 4 === 3) snap(time, 0.22, 0.62);
          }),
        ],
      },
    ],
  });

  // Layers gained per conquered face — read at schedule time, so the groove
  // literally builds as the solve advances.
  const faces = () => solveState.facesConquered;

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'boot',
        fromBar: 0,
        tracks: [
          hits('K.......K.......', { K: 0.75 }, ({ time }, vel) => kick(time, vel)),
          hits('t.t.t.t.t.t.t.t.', { t: 0.05 }, ({ time }, vel) => tick(time, vel)),
          hits('P.......P.......', { P: 0.8 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          oneShot(0, 0, ({ time, chord }) => pad(time, chord.pad, PAD_2BAR, 0.7, 1300, 0.45)),
          oneShot(1, 8, ({ time }) => riser(time, BAR_SECONDS, 0.13)),
        ],
      },
      {
        name: 'solve',
        fromBar: SPEEDSOLVE_BARS.firstFace,
        tracks: [
          hits('K...K...K...K...', { K: 0.82 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.72 }, ({ time }, vel) => snare(time, vel)),
          // The cube's backbeat: woodblock snaps, alternating pitch.
          hits('....n.......n...', { n: 0.5 }, ({ time, step }, vel) => snap(time, vel, step === 4 ? 1 : 1.122)),
          hits('t.t.t.t.t.t.t.t.', { t: 0.045 }, ({ time }, vel) => tick(time, vel)),
          hits('B.......B.......', { B: 0.85 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          fn(({ time, step, bar: barIndex, chord, position }) => {
            if (step === 0 && barIndex % 2 === 0) pad(time, chord.pad, PAD_2BAR, 0.8, 1700, 0.4);
            // Machine-pluck arpeggio once the second face falls.
            if (faces() >= 2 && step % 2 === 0) {
              const note = chord.arp[(step / 2 + barIndex) % chord.arp.length];
              arp(time, note, 0.7, 0.22);
            }
          }),
          fn(({ time, step, bar: barIndex, chord }) => {
            if (faces() >= 3 && step % 4 === 2) hat(time, 0.05, 0.03);
            if (faces() >= 4 && step % 2 === 1) shaker(time, 0.04);
            if (faces() >= 5 && step === 8 && barIndex % 2 === 1) sub(time, chord.bass + 12, 0.7);
          }),
        ],
      },
      {
        name: 'climax',
        fromBar: 16,
        tracks: [
          hits('K...K...K...K.K.', { K: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S..s', { S: 0.78, s: 0.4 }, ({ time }, vel) => snare(time, vel)),
          hits('....n.......n...', { n: 0.55 }, ({ time, step }, vel) => snap(time, vel, step === 4 ? 1.122 : 1.26)),
          hits('t.t.t.t.t.t.t.t.', { t: 0.05 }, ({ time }, vel) => tick(time, vel)),
          hits('B...B...B...B...', { B: 0.8 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          hits('h.h.h.h.h.h.h.h.', { h: 0.045 }, ({ time }, vel) => hat(time, vel, 0.025)),
          hits('s.s.s.s.s.s.s.s.', { s: 0.035 }, ({ time }, vel) => shaker(time, vel)),
          fn(({ time, step, bar: barIndex, chord, position }) => {
            if (step === 0 && barIndex % 2 === 0) pad(time, chord.pad, PAD_2BAR, 0.95, 2100, 0.38);
            if (step % 2 === 0) {
              const note = chord.arp[(step / 2 + barIndex * 3) % chord.arp.length];
              arp(time, note, 0.8, 0.22);
            }
            if (step === 8 && barIndex % 2 === 1) stab(time, chord.stab.map((midi) => midi + 12), 0.7, 0.25 * airReverb(position));
          }),
        ],
      },
      {
        name: 'core',
        fromBar: SPEEDSOLVE_BARS.coreReveal,
        tracks: [
          // Stripped pulse while the core spins up.
          hits('K...K...K...K...', { K: 0.9 }, ({ time }, vel) => { if (!coreDead()) kick(time, vel); }),
          hits('t.t.t.t.t.t.t.t.', { t: 0.06 }, ({ time }, vel) => { if (!coreDead()) tick(time, vel); }),
          hits('P...P...........', { P: 0.9 }, ({ time, chord }, vel) => { if (!coreDead()) sub(time, chord.bass, vel); }),
          // The spin-up itself: one long riser across the reveal.
          oneShot(0, 0, ({ time }) => riser(time, BAR_SECONDS * 1.5, 0.15)),
          oneShot(1, 8, ({ time }) => { if (!coreDead()) clank(time, 0.8); }),
          // Resolution: once the core bursts, the harmony opens and settles.
          fn(({ time, step, bar: barIndex, chord }) => {
            if (!coreDead()) return;
            if (step === 0 && barIndex % 2 === 0) {
              swell(time, [chord.bass + 12, ...chord.pad], 3 * BAR_SECONDS, 0.8, 0.55);
              bell(time + SIXTEENTH, chord.arp[3] + 12, 0.8, 0.5);
            }
            if (step === 0 && barIndex % 4 === 2) snap(time, 0.4, 0.84);
          }),
        ],
      },
    ],
  });

  function coreDead() {
    return solveState.coreDeadAt !== null;
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  function airReverb(_position: number) {
    return 0.3;
  }

  // ---- player-event -> music map -------------------------------------------

  const playerToneSpec = voice<{ tone: PlayerTone }>({
    oscillators: [{ type: ({ tone }) => tone.oscillator, gain: ({ tone }) => tone.gain }],
    duration: ({ tone }) => tone.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ tone }) => tone.cutoff },
    envelope: { decay: ({ tone }) => tone.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const fireVoice = voice<{ cutoff: number; gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.085,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.085 },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 3, frequency: 760 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const hitThudVoice = voice<{ midi: number }>({
    oscillators: [{ type: 'sine', gain: 0.4 }],
    duration: 0.4,
    stopPadding: 0.05,
    envelope: { decay: 0.4 },
  });

  const missVoice = voice<{ midi: number }>({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  const boltTickVoice = voice({
    oscillators: [{ type: 'triangle', gain: 0.05 }],
    duration: 0.06,
    stopPadding: 0.02,
    filter: { type: 'highpass', frequency: 1900 },
    envelope: { decay: 0.06 },
  });

  function mixedTone(slot: 'lock' | 'kill'): PlayerTone {
    // Single mechanical family, heat-modulated; kept as a function so future
    // section blends have one place to land.
    return playerVoices()[slot];
  }

  function killMelody(time: number, midi: number, chain: number) {
    const output = sfxDestination();
    if (!output) return;
    const tone = mixedTone('kill');
    const vel = Math.min(1.4, 1 + chain * 0.13);
    playPlayerTone(time, midi, tone, vel);
    killBodyVoice.play({ context: ctx!, time, midi, decay: tone.decay, gain: tone.gain, velocity: vel, destination: output, sends: playerSends(0.34, 0.2) });
    if (chain >= 2) playPlayerTone(time, midi + 12, tone, 0.5 + chain * 0.08);
  }

  // Solving clicks the ratchet: every solved cell snaps, rising through the
  // phrase — the speedcube's own percussion line inside the groove.
  solveState.on((signal) => {
    if (!ctx || trace) return;
    const gridTime = (offsetSteps = 0) => {
      const base = score.nextGridTime(ctx!.currentTime + 0.001, 1);
      return base + offsetSteps * THIRTYSECOND;
    };
    switch (signal.type) {
      case 'snap': {
        const time = gridTime();
        const rise = Math.min(12, signal.solvedInFace);
        snap(time, 0.85, 2 ** (rise / 12));
        break;
      }
      case 'face-clear': {
        // A four-note chime run up the live lead set, then a satisfying clunk.
        const time = gridTime();
        const position = score.arrangementPositionAt(time);
        const lead = score.leadSetAt(position);
        [0, 2, 4, 7].forEach((degree, index) => {
          playPlayerTone(time + index * THIRTYSECOND, lead[degree] + 12, { oscillator: 'triangle', decay: 0.3, cutoff: 4200, gain: 0.11 }, 0.9 - index * 0.08);
        });
        clank(gridTime(4), 0.55);
        break;
      }
      case 'face-change': {
        whoosh(gridTime(), 0.9, 0.75);
        break;
      }
      case 'face-conquered': {
        const time = gridTime();
        const position = score.arrangementPositionAt(time);
        const chord = score.chordAt(position);
        clank(time, 0.9);
        bell(time + SIXTEENTH, chord.arp[chord.arp.length - 1] + 12, 0.7, 0.4);
        break;
      }
      case 'core-dead': {
        // The finale: duck everything for a breath, then resolve.
        const time = gridTime();
        const position = score.arrangementPositionAt(time);
        const chord = score.chordAt(position);
        runtime.mix()?.duckAt(time, 0.15, 2.2);
        clank(time, 1);
        swell(time + 0.08, [chord.bass + 12, ...chord.pad], 6, 1, 0.5);
        score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
          playPlayerTone(time + index * THIRTYSECOND, midi + 12, { oscillator: 'sine', decay: 0.4, cutoff: 4000, gain: 0.12 }, Math.max(0.15, 0.9 - index * 0.07));
        });
        break;
      }
      case 'core-reveal':
        clank(gridTime(), 0.7);
        break;
    }
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    playPlayerTone(time, midi, mixedTone('lock'), 1);
    noiseHit(time, 0.014, 0.02, 'highpass', 9000, sfxDestination()!);
    if (lockCount >= 6) {
      // Ignition: the sixth lock drops a sub under the blip.
      const bass = score.chordAt(position).bass;
      sub(time, bass + 12, 0.8);
      playPlayerTone(time + THIRTYSECOND, midi + 12, mixedTone('kill'), 0.5);
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playPlayerTone(time, score.chordAt(position).bass + 24, mixedTone('lock'), 0.3);
  });

  bus.on('fire', ({ indexInVolley, volleySize }) => {
    if (!ctx) return;
    const output = sfxDestination();
    if (!output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const sourceMidi = chord.stab[(indexInVolley ?? 0) % chord.stab.length] + 12;
    const weightSize = 0.6 + Math.min(6, volleySize) * 0.1;
    fireVoice.play({
      context: ctx,
      time,
      midi: sourceMidi,
      cutoff: 3600,
      gainValue: 0.06,
      weight: weightSize,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - 10), time: time + 0.07 }],
      destination: output,
      sends: playerSends(0.2, 0.1),
    });
    noiseHit(time, 0.03, 0.03, 'highpass', 5200, output);
    if (volleySize >= 3) stab(time, chord.stab.map((midi) => midi + 12), Math.min(0.85, 0.3 + volleySize * 0.08), 0.25);
  });

  bus.on('hit', ({ lethal }) => {
    if (lethal || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    noiseHit(time, 0.05, 0.03, 'bandpass', 2600, sfxDestination()!);
    playPlayerTone(time, chord.stab[0] + 12, mixedTone('lock'), 0.5);
  });

  bus.on('stage', ({ stageIndex }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    clank(time, 0.5 + stageIndex * 0.2);
    riser(time, 0.5, 0.08);
  });

  bus.on('kill', ({ indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    killMelody(kill.time, kill.midi, indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.65, 0.32);
    snap(time, 0.9, size >= 6 ? 1.5 : 1.335);
  });

  bus.on('reject', () => {
    if (!ctx) return;
    // Utilitarian hazard buzz — deliberately off-grid, no musical reward.
    const time = ctx.currentTime;
    const output = sfxDestination();
    if (!output) return;
    for (const [frequency, at, vel] of [[196, time, 0.14], [208, time + 0.02, 0.11]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.5, time: at + 0.18 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.1, 0.07, 'bandpass', 560, output);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    const output = sfxDestination();
    if (!output) return;
    // Off-grid: the hull took a bolt — a low thud plus a crack.
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    hitThudVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    noiseHit(time, 0.15, 0.12, 'bandpass', 800, output);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    const output = sfxDestination();
    if (!output) return;
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.11 }],
      destination: output,
      sends: playerSends(0.06, 0.05),
    });
  });

  bus.on('spawn', ({ kind }) => {
    if (!ctx) return;
    if (kind === 'cell') {
      // A target lighting up: one soft high tick, on grid.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      tick(time, 0.35);
      return;
    }
    if (kind === 'bolt') {
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      boltTickVoice.play({ context: ctx, time, frequency: 2500, destination: sfxDestination()!, sends: playerSends(0.08, 0.05) });
      return;
    }
    if (kind === 'weak') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      clank(time, 0.45);
      whoosh(time, 0.4, 0.4);
    }
  });


  return runtime;
}
