import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createMassDriverVoices, type MdTonalVoice } from './audio-voices';
import { INTERLOCK_COUNT } from './gameplay';
import { MASS_DRIVER_BPM, MASS_DRIVER_STEPS_PER_BAR, MD_BARS, MD_DURATION, MD_SCORE_SECTIONS, MD_TIME } from './timing';

// The Mass Driver score: 128 BPM, 32 bars = exactly the 60-second run. The
// gun is the instrument — a bass hum whose root climbs a full octave over the
// run (E → F# → G → A → B → C → D → E'), under a four-on-the-floor pulse that
// never breaks until the muzzle. A coil chime marks every beat: that is the
// ring you just passed through. The charge section (bars 24–30) stacks a
// six-bar riser and a klaxon that climbs each bar; at bar 30 the gun fires
// and the score collapses to airless shimmer — open space, engine dead,
// everything quiet. Player actions snap to the transport and read the live
// harmony; kills walk hidden lanes whose register climbs with the hum.

const SIXTEENTH = MD_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// One chord per 4 bars, roots climbing stepwise through E natural minor and
// landing back on the tonic an octave up as the charge peaks.
const CHORDS: Chord[] = [
  { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 74], stab: [59, 64, 67] }, // E
  { bass: 30, pad: [54, 57, 61, 66], arp: [66, 69, 73, 76], stab: [61, 66, 69] }, // F#m
  { bass: 31, pad: [55, 59, 62, 67], arp: [67, 71, 74, 78], stab: [62, 67, 71] }, // G
  { bass: 33, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81], stab: [64, 69, 73] }, // A
  { bass: 35, pad: [59, 62, 66, 71], arp: [71, 74, 78, 83], stab: [66, 71, 74] }, // Bm
  { bass: 36, pad: [60, 64, 67, 72], arp: [72, 76, 79, 84], stab: [67, 72, 76] }, // C
  { bass: 38, pad: [62, 66, 69, 74], arp: [74, 78, 81, 86], stab: [69, 74, 78] }, // D
  { bass: 40, pad: [64, 67, 71, 76], arp: [76, 79, 83, 88], stab: [71, 76, 79] }, // E'
];

type SectionIndex = 0 | 1 | 2 | 3;

// Kill lanes in degree space over the live lead set (arp + arp+12). Because
// the harmony climbs, the same lane rises in register across the run.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Injection: patient arches while the breech glow is still blue.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Acceleration: interleaved jumps for the locked pulse.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Overdrive: high, urgent fragments over the violet coils.
  2: [
    4, 5, 7, 6, 4, 2, 5, 3,
    6, 7, 5, 4, 6, 3, 5, 2,
    7, 6, 5, 4, 7, 5, 3, 1,
    4, 5, 6, 7, 6, 5, 4, 0,
  ],
  // Charge: everything climbs — the player's guns and the gun agree.
  3: [
    0, 2, 4, 6, 1, 3, 5, 7,
    2, 4, 6, 7, 3, 5, 7, 6,
    4, 5, 6, 7, 5, 6, 7, 6,
    6, 7, 6, 7, 7, 6, 7, 7,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: MdTonalVoice; kill: MdTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.1, cutoff: 3400, gain: 0.12, sparkle: 0.5, reverb: 0.16 },
    kill: { oscillator: 'triangle', decay: 0.26, cutoff: 3100, gain: 0.15, sparkle: 0.7, reverb: 0.26 },
    fire: { oscillator: 'triangle', cutoff: 3200, gain: 0.07, fallSemitones: 12, noise: 0.035 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2700, gain: 0.055, sparkle: 0.4, reverb: 0.12 },
    kill: { oscillator: 'square', decay: 0.18, cutoff: 3100, gain: 0.11, sparkle: 0.55, reverb: 0.2 },
    fire: { oscillator: 'sawtooth', cutoff: 3900, gain: 0.06, fallSemitones: 9, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.07, cutoff: 4100, gain: 0.05, sparkle: 0.5, reverb: 0.16 },
    kill: { oscillator: 'sawtooth', decay: 0.21, cutoff: 4400, gain: 0.12, sparkle: 0.8, reverb: 0.24 },
    fire: { oscillator: 'sawtooth', cutoff: 5400, gain: 0.065, fallSemitones: 12, noise: 0.055 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.11, cutoff: 2400, gain: 0.058, sparkle: 0.3, reverb: 0.3 },
    kill: { oscillator: 'sawtooth', decay: 0.34, cutoff: 3000, gain: 0.14, sparkle: 0.65, reverb: 0.38 },
    fire: { oscillator: 'square', cutoff: 3100, gain: 0.058, fallSemitones: 13, noise: 0.05 },
  },
};

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-esvz',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MD_DURATION,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const interlockIds = new Set<number>();
  let interlocksBlown = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 4,
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
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -16, ratio: 5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2600 },
      reverb: { seconds: 2.2, decay: 2.5, level: 0.45 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      interlockIds.clear();
      interlocksBlown = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      // A cold resolving cluster over whatever just happened — launch or loss.
      if (context) shimmer(context.currentTime + 0.05, [64, 71, 76, 79, 83], 5, 0.85);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler ---------------------------------------------------------------

  const humBrightness = (bar: number) => Math.min(1, bar / 30);
  const humTrack = fn<Chord>(({ time, step, bar, chord }) => {
    if (step !== 0) return;
    hum(time, chord.bass, MD_TIME.barSeconds * 1.08, 0.9, humBrightness(bar));
  });
  const coilTrack = (heat: number, vel: number) =>
    hits<Chord>('T...T...T...T...', { T: 1 }, ({ time, chord }) => coilTick(time, chord.stab[0] + 24, vel, heat));
  const bassFigure = hits<Chord>('B..bB..bB..bB..b', { B: 1, b: 0.6 }, ({ time, chord }, vel) => bass(time, chord.bass + 12, vel));
  const offbeatHats = hits<Chord>('..h...h...h...h.', { h: 0.06 }, ({ time }, vel) => hat(time, vel, 0.028));
  const fourFloor = hits<Chord>('K...K...K...K...', { K: 1 }, ({ time }, vel) => kick(time, vel));
  const claps = hits<Chord>('....C.......C...', { C: 0.7 }, ({ time }, vel) => clap(time, vel));

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: () => CHORDS[0],
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          fn(({ time, step }) => {
            if (step === 0) hum(time, 28, MD_TIME.barSeconds * 1.08, 0.55, 0.1);
          }),
          hits('T.......T.......', { T: 0.5 }, ({ time, chord }) => coilTick(time, chord.stab[0] + 24, 0.5, 0)),
          hits('A...............', { A: 0.25 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
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
          humTrack,
          coilTrack(0.1, 0.7),
          hits('A.......A.......', { A: 0.35 }, ({ time, step, bar, chord }, vel) => arp(time, chord.arp[(step / 8 + bar) % chord.arp.length], vel + bar * 0.03)),
          fn(({ time, step, bar }) => {
            if (bar >= 3 && step % 4 === 0) kick(time, 0.6 + (bar - 3) * 0.08);
          }),
          fn(({ time, step, bar }) => {
            if (bar >= 5 && step % 4 === 2) hat(time, 0.045, 0.025);
          }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.18)),
        ],
      },
      {
        name: 'acceleration',
        fromBar: MD_BARS.acceleration,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => stab(time, chord.stab, 0.7)),
          humTrack,
          coilTrack(0.35, 0.85),
          fourFloor,
          offbeatHats,
          claps,
          bassFigure,
          hits('A.A.A.A.A.A.A.A.', { A: 0.5 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 2) % chord.arp.length], vel)),
          fn(({ time, step, bar }) => {
            if (bar % 4 === 3 && step === 14) openHat(time, 0.09);
          }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'overdrive',
        fromBar: MD_BARS.overdrive,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            stab(time, chord.stab, 0.85);
            impact(time, 0.6);
          }),
          humTrack,
          coilTrack(0.65, 1),
          fourFloor,
          offbeatHats,
          hits('h.h.h.h.h.h.h.h.', { h: 0.028 }, ({ time }, vel) => hat(time, vel, 0.018)),
          claps,
          bassFigure,
          hits('A.A.A.A.A.A.A.A.', { A: 0.62 }, ({ time, step, chord }, vel) => {
            const octave = step % 4 === 2 ? 12 : 0;
            arp(time, chord.arp[(step / 2) % chord.arp.length] + octave, vel);
          }),
          hits('R...R...R...R...', { R: 0.04 }, ({ time }, vel) => ride(time, vel)),
          fn(({ time, step, bar }) => {
            if (bar % 2 === 1 && step === 14) openHat(time, 0.1);
          }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.24)),
        ],
      },
      {
        name: 'charge',
        fromBar: MD_BARS.charge,
        tracks: [
          // The final firing charge, already building: a six-bar riser under a
          // klaxon that climbs a tone per bar. The pulse does not break.
          oneShot(0, 0, ({ time }) => {
            impact(time, 0.9);
            riser(time, 96 * SIXTEENTH, 0.3);
          }),
          humTrack,
          coilTrack(1, 1.15),
          fourFloor,
          offbeatHats,
          hits('h.h.h.h.h.h.h.h.', { h: 0.034 }, ({ time }, vel) => hat(time, vel, 0.018)),
          claps,
          bassFigure,
          hits('A.A.A.A.A.A.A.A.', { A: 0.66 }, ({ time, step, chord }, vel) => {
            const octave = step % 4 === 0 ? 12 : 0;
            arp(time, chord.arp[(step / 2) % chord.arp.length] + octave, vel);
          }),
          fn(({ time, step, barInSection }) => {
            if (step === 0) alarm(time, 64 + barInSection * 2, 12 * SIXTEENTH);
          }),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 5) snare(time, 0.13 + step * 0.045);
          }),
        ],
      },
      {
        name: 'launch',
        fromBar: MD_BARS.fire,
        toBar: MD_BARS.end,
        tracks: [
          // The gun fires. One enormous transient, then airless quiet: no hum,
          // no kick — the first silence in the level is the payoff.
          oneShot(0, 0, ({ time, chord }) => {
            impact(time, 1.5);
            runtime.mix()?.duckAt(time, 0.1, 1.6);
            shimmer(time + 0.35, [chord.pad[1] + 12, chord.pad[2] + 12, chord.arp[0] + 12, chord.arp[2] + 12], 96 * SIXTEENTH, 1);
          }),
          fn(({ time, step, bar, chord }) => {
            if (bar === MD_BARS.end - 1 && step === 8) coilTick(time, chord.arp[0] + 12, 0.5, 0.2);
          }),
          hits('................T...............', { T: 0.35 }, ({ time, chord }) => coilTick(time, chord.arp[2] + 12, 0.35, 0.1)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices --------------------------------------------------------------------

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, clap, snare, hat, openHat, ride, hum, coilTick, bass, arp, stab, alarm, riser, impact, shimmer,
    noiseHit, playerSends, playerTone, playerNoise,
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

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.32 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.18 }],
    duration: 0.17,
    stopPadding: 0.04,
    envelope: { decay: 0.17 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.075,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const hitTickVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3600 },
    envelope: { decay: 0.08 },
  });

  const clampChipVoice = voice<{ intensity: number }>({
    oscillators: [{ type: 'square', gain: ({ intensity }) => 0.06 + intensity * 0.04 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 3, frequency: ({ intensity }) => 700 + intensity * 900 },
    envelope: { decay: 0.16 },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.19,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 820 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.46,
    stopPadding: 0.05,
    envelope: { decay: 0.46 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.11,
    stopPadding: 0.02,
    envelope: { decay: 0.11 },
  });

  // ---- player instruments ---------------------------------------------------------
  // Player actions are notes in the score: quantized to the transport, pitched
  // from the live climbing harmony, sent into the same delay and hall.

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof MdTonalVoice) {
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
    const vel = Math.min(1.45, 1 + chain * 0.14);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.5, 0.18) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.025 + sparkle * 0.05, 0.08, 7400);
  }

  // Each interlock down is a breaker blowing: a climbing, growing figure —
  // the sixth lands a conclusive run and hands the stage to the launch.
  function interlockBlown(time: number, count: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const leadSet = score.leadSetAt(position);
    noiseHit(time, 0.16 + count * 0.02, 0.12, 'bandpass', 900 + count * 350, output);
    killBodyVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      decay: 0.4,
      gain: 0.16 + count * 0.015,
      destination: output,
    });
    const degree = Math.min(7, 1 + count);
    playerTone(time, leadSet[degree], PLAYER_VOICES[3].kill, 0.7 + count * 0.1, 1);
    playerTone(time + THIRTYSECOND * 2, leadSet[degree] + 12, PLAYER_VOICES[3].kill, 0.4 + count * 0.08, 1);
    if (count >= INTERLOCK_COUNT) {
      const audioMix = runtime.mix();
      if (audioMix?.duck) audioMix.duckAt(time, 0.16, 1.1);
      stab(time, chord.stab.map((midi) => midi + 12), 0.95);
      riser(time, 1.4, 0.2);
      leadSet.slice(2).forEach((midi, index) => {
        playerTone(time + index * THIRTYSECOND * 2, midi, PLAYER_VOICES[3].kill, 0.85 - index * 0.07, 1);
      });
    }
  }

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
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.015 + sparkle * 0.03, 0.022, 9200);
    if (lockCount >= 6) {
      // Capacitor full: the sixth lock is its own event.
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.13 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
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
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.024, 5000);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output || !interlockIds.has(enemyId)) return;
    // Armor plate off a clamp: metal, then a warning overtone.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    clampChipVoice.play({ context: ctx, time, midi: chord.bass + 24, intensity: 0.7, destination: output, sends: playerSends(0.2, 0.3) });
    noiseHit(time, 0.12, 0.09, 'bandpass', 620, output);
    playerTone(time + THIRTYSECOND, score.leadSetAt(position)[4], PLAYER_VOICES[3].kill, 0.7, 1);
  });

  bus.on('hit', ({ lethal, enemyId }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    if (interlockIds.has(enemyId)) return; // the stage handler owns clamp hits
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      hitTickVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        gainValue: 0.05 - index * 0.008,
        destination: output,
        sends: playerSends(0.2, 0.14),
      });
    }
    playerNoise(time, 0.04, 0.032, 5800);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (interlockIds.has(enemyId)) {
      interlockIds.delete(enemyId);
      interlocksBlown += 1;
      interlockBlown(kill.time, interlocksBlown);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.9 : 0.68);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A breaker trip: relay clack and a shorted two-tone snarl, no reward.
    for (const [frequency, at, vel] of [[220, time, 0.15], [233, time + 0.02, 0.11]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.42, time: at + 0.15 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.07, 'bandpass', 540, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Getting zapped: sub thud plus a hard electric crack.
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    noiseHit(time, 0.22, 0.14, 'highpass', 3400, output);
    noiseHit(time + 0.05, 0.1, 0.1, 'bandpass', 900, output);
  });

  bus.on('miss', () => {
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

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'interlock') {
      const firstOfCollar = interlockIds.size === 0 && interlocksBlown === 0;
      interlockIds.add(enemyId);
      if (firstOfCollar) {
        // The collar reveal: klaxon blast and a dead metal clamp hit.
        const time = score.nextGridTime(ctx.currentTime, 0.5);
        alarm(time, 62, 16 * SIXTEENTH);
        alarm(time + 8 * SIXTEENTH, 65, 16 * SIXTEENTH);
        const output = sfxDestination();
        if (output) noiseHit(time, 0.2, 0.2, 'bandpass', 480, output);
        riser(time, 8 * SIXTEENTH, 0.14);
      }
    } else if (kind === 'sentinel') {
      // A short two-note wake-up chirp from the live harmony.
      const time = score.nextGridTime(ctx.currentTime, 1);
      const position = score.arrangementPositionAt(time);
      const leadSet = score.leadSetAt(position);
      playerTone(time, leadSet[2], PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.4, 1);
      playerTone(time + THIRTYSECOND * 2, leadSet[0], PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.3, 1);
    }
  });

  return runtime;
}
