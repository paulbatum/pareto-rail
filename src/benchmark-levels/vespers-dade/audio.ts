import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { VESPERS_DADE_BARS, VESPERS_DADE_BPM, VESPERS_DADE_TIME } from './gameplay';

// Vespers: the building's own organ, no percussion. A single D pedal opens
// in the dark; voices enter one at a time above it in real counterpoint
// (pedal, flute, principal, choir); one voice — the high trumpet/bell rank —
// is held back all night so the rose ignition has somewhere to arrive. The
// pulse is the counterpoint moving, never a drum. Player locks, shots and
// kills are organ voices inside the polyphony, pitched from the live harmony.

const SIXTEENTH = VESPERS_DADE_TIME.stepSeconds;
const STEPS_PER_BAR = 16;
const LANE_STEPS = 16;

type VesperChord = { bass: number; pad: number[]; lead: number[]; bell: number };

// 21 bars: D minor pilgrimage, dominant tension at bar 14, D major arrival
// at bar 19 for the rose ignition. One chord per bar so the run plays it once.
const DM = { bass: 38, pad: [50, 53, 57], lead: [69, 72, 74, 76], bell: 74 };
const BB = { bass: 34, pad: [46, 50, 53], lead: [65, 67, 70, 72], bell: 70 };
const F = { bass: 41, pad: [45, 48, 53], lead: [65, 69, 72, 77], bell: 72 };
const C = { bass: 36, pad: [48, 52, 55], lead: [67, 72, 76, 79], bell: 76 };
const GM = { bass: 31, pad: [43, 46, 50], lead: [67, 70, 74, 77], bell: 74 };
const A = { bass: 33, pad: [45, 49, 52], lead: [69, 73, 76, 80], bell: 76 };
const DMAJ = { bass: 38, pad: [50, 54, 57], lead: [66, 69, 73, 76], bell: 78 };

const CHORDS: VesperChord[] = [
  DM, DM, BB, BB, F, F, C, GM, GM, A, A, DM, DM, DM, A, DM, BB, GM, A, DMAJ, DMAJ,
];

const LOCK_SCALE = [62, 64, 65, 67, 69, 70, 72, 74]; // D natural minor, rising per lock

type SectionIndex = 0 | 1 | 2 | 3 | 4 | 5;
const KILL_LANES: Record<SectionIndex, number[]> = {
  0: [0, 1, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 0],
  1: [0, 2, 1, 3, 2, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0],
  2: [2, 3, 4, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 2],
  3: [4, 5, 6, 5, 4, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1],
  4: [3, 2, 1, 0, 1, 2, 1, 0, 0, 1, 2, 3, 2, 1, 0, 0],
  5: [4, 5, 6, 7, 6, 7, 6, 5, 4, 5, 6, 7, 7, 6, 5, 4],
};

const SECTION_VOICES: Record<SectionIndex, {
  kill: { oscillator: OscillatorType; decay: number; cutoff: number; gain: number };
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
}> = {
  0: { kill: { oscillator: 'sine', decay: 0.5, cutoff: 2400, gain: 0.16 }, lock: { oscillator: 'sine', cutoff: 2200, gain: 0.15 } },
  1: { kill: { oscillator: 'triangle', decay: 0.44, cutoff: 2600, gain: 0.16 }, lock: { oscillator: 'triangle', cutoff: 2400, gain: 0.13 } },
  2: { kill: { oscillator: 'triangle', decay: 0.4, cutoff: 2800, gain: 0.16 }, lock: { oscillator: 'triangle', cutoff: 2600, gain: 0.12 } },
  3: { kill: { oscillator: 'sawtooth', decay: 0.34, cutoff: 2600, gain: 0.11 }, lock: { oscillator: 'sawtooth', cutoff: 2000, gain: 0.05 } },
  4: { kill: { oscillator: 'sine', decay: 0.55, cutoff: 2200, gain: 0.15 }, lock: { oscillator: 'sine', cutoff: 2000, gain: 0.14 } },
  5: { kill: { oscillator: 'sawtooth', decay: 0.5, cutoff: 3200, gain: 0.12 }, lock: { oscillator: 'triangle', cutoff: 2800, gain: 0.11 } },
};

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

function createVespersAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let eaterId = -1;

  const score = createScore<VesperChord, SectionIndex>({
    bpm: VESPERS_DADE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 1,
    leadSet: (chord) => [...chord.lead, ...chord.lead.map((midi) => midi + 12)],
    sections: [
      { index: 0, fromBar: VESPERS_DADE_BARS.run },
      { index: 1, fromBar: VESPERS_DADE_BARS.secondVoice, crossfadeBars: 1 },
      { index: 2, fromBar: VESPERS_DADE_BARS.thirdVoice, crossfadeBars: 1 },
      { index: 3, fromBar: VESPERS_DADE_BARS.choir, crossfadeBars: 2 },
      { index: 4, fromBar: VESPERS_DADE_BARS.darkSpan, crossfadeBars: 1 },
      { index: 5, fromBar: VESPERS_DADE_BARS.boss, crossfadeBars: 1 },
    ],
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -16, ratio: 4, attack: 0.008, release: 0.3 },
      delay: { time: SIXTEENTH * 3, feedback: 0.42, dampHz: 2200 },
      reverb: { seconds: 3.2, decay: 2.6, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      eaterId = -1;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (context) fullOrgan(context.currentTime + 0.05, DMAJ, 6);
    },
    onDispose() {
      ctx = null;
    },
  });

  const sfxOut = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const musicOut = () => runtime.mix()?.music ?? runtime.mix()?.master ?? null;

  // ---- organ voices -------------------------------------------------------
  const pedalVoice = voice<{ vel: number; duration: number }>({
    oscillators: [{ type: 'sine', gain: 0.9 }, { type: 'triangle', gain: 0.35 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.1,
    gainAutomation: (time, _g, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.34 * vel, time: time + 0.09 },
      { type: 'set', value: 0.34 * vel, time: time + Math.max(0.09, duration - 0.35) },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const fluteVoice = voice<{ vel: number; duration: number }>({
    oscillators: [{ type: 'sine', gain: 0.8 }, { type: 'sine', octave: 1, gain: 0.18 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 2600 },
    gainAutomation: (time, _g, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.2 * vel, time: time + 0.06 },
      { type: 'set', value: 0.2 * vel, time: time + Math.max(0.06, duration - 0.2) },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const principalVoice = voice<{ vel: number; duration: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.5 }, { type: 'sawtooth', detune: 7, gain: 0.32 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: 2100, Q: 0.8 },
    gainAutomation: (time, _g, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.11 * vel, time: time + 0.05 },
      { type: 'set', value: 0.11 * vel, time: time + Math.max(0.05, duration - 0.18) },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const choirVoice = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', detune: -8, gain: 0.3 },
      { type: 'sawtooth', detune: 8, gain: 0.3 },
      { type: 'triangle', octave: 1, gain: 0.22 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.1,
    filter: { type: 'lowpass', cutoff: 1500 },
    gainAutomation: (time, _g, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.075 * vel, time: time + 0.5 },
      { type: 'set', value: 0.075 * vel, time: time + Math.max(0.5, duration - 0.5) },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const bellVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 0.7 }, { type: 'sine', frequencyRatio: 2.76, gain: 0.22 }],
    duration: 2.2,
    stopPadding: 0.2,
    envelope: { decay: 2.2 },
  });

  const killPipeVoice = voice<{ kill: { oscillator: OscillatorType; decay: number; cutoff: number; gain: number } }>({
    oscillators: [{ type: ({ kill }) => kill.oscillator, gain: ({ kill }) => kill.gain }],
    duration: ({ kill }) => kill.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ kill }) => kill.cutoff },
    envelope: { decay: ({ kill }) => kill.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.85 },
    ],
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.16,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 160 },
    envelope: { attack: 0.012, decay: 0.15 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'triangle', gain: 0.5 }, { type: 'sine', octave: 1, gain: 0.25 }],
    duration: 0.12,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: 0.008, decay: 0.11 },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.3,
    stopPadding: 0.03,
    gainAutomation: (time, _g, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  function pedal(time: number, midi: number, vel: number, duration: number) {
    const out = musicOut();
    if (!ctx || !out) return;
    pedalVoice.play({ context: ctx, time, midi, vel, duration, destination: out });
    pedalVoice.play({ context: ctx, time, midi: midi + 12, vel: vel * 0.35, duration, destination: out });
  }

  function flute(time: number, midi: number, vel: number, duration: number) {
    const out = musicOut();
    const mix = runtime.mix();
    if (!ctx || !out) return;
    fluteVoice.play({
      context: ctx, time, midi, vel, duration, destination: out,
      sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : [],
    });
  }

  function principal(time: number, midi: number, vel: number, duration: number) {
    const out = musicOut();
    const mix = runtime.mix();
    if (!ctx || !out) return;
    principalVoice.play({
      context: ctx, time, midi, vel, duration, destination: out,
      sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.28 }] : [],
    });
  }

  function choir(time: number, midis: number[], vel: number, duration: number) {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.reverbSend) return;
    for (const midi of midis) {
      choirVoice.play({
        context: ctx, time, midi, vel, duration, destination: [mix.duck, mix.reverbSend],
      });
    }
  }

  function bell(time: number, midi: number, vel: number) {
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    const out = mix.duck ?? mix.music;
    bellVoice.play({
      context: ctx, time, midi, vel, destination: out,
      sends: [...(mix.delaySend ? [{ destination: mix.delaySend, gain: 0.5 }] : []),
        ...(mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.6 }] : [])],
    });
  }

  function fullOrgan(time: number, chord: VesperChord, vel: number) {
    pedal(time, chord.bass - 12, 1, 4);
    for (const midi of chord.pad) principal(time, midi, 0.9, 4);
    choir(time, [...chord.pad.map((m) => m + 12), chord.bell + 12], 1, 4);
    bell(time, chord.bell + 12, 0.5 * vel);
  }

  // ---- arrangement: counterpoint, never drums ------------------------------
  // Cantus holds long notes; the countersubject moves in quarters around it;
  // the pedal walks roots and fifths. Ranks accumulate bar by bar, drop to
  // one voice for the dark span, then open every rank for the finale.
  const COUNTERSUBJECT = [0, 2, 1, 3, 2, 0, 3, 1];

  const barLen = STEPS_PER_BAR * SIXTEENTH;

  const ambientArrangement = createArrangement<VesperChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        hits('P...............', { P: 1 }, ({ time, chord }) => pedal(time, chord.bass - 12, 0.8, barLen)),
        hits('....F.......F...', { F: 0.7 }, ({ time, chord }) => flute(time, chord.lead[0], 0.7, barLen / 3)),
      ],
    }],
  });

  const runArrangement = createArrangement<VesperChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'pedal-solo', fromBar: 0, toBar: 2,
        tracks: [
          hits('P...............', { P: 1 }, ({ time, chord }) => pedal(time, chord.bass - 12, 1, barLen * 1.02)),
          hits('................C...............', { C: 0.8 }, ({ time, chord }) => flute(time, chord.lead[0] - 12, 0.8, barLen * 1.6)),
        ],
      },
      {
        name: 'second-voice', fromBar: 2, toBar: 4,
        tracks: [
          hits('P...............', { P: 1 }, ({ time, chord }) => pedal(time, chord.bass - 12, 1, barLen)),
          hits('F...F...F...F...', { F: 0.8 }, ({ time, step, chord }) => flute(time, chord.lead[COUNTERSUBJECT[(step / 4) | 0] % chord.lead.length], 0.8, SIXTEENTH * 3.4)),
        ],
      },
      {
        name: 'third-voice', fromBar: 4, toBar: 6,
        tracks: [
          hits('P.......f.......', { P: 1, f: 0.8 }, ({ time, chord }, _v, s) => pedal(time, s === 'P' ? chord.bass - 12 : chord.bass - 5, 1, barLen / 2)),
          hits('F...F...F...F...', { F: 0.8 }, ({ time, step, chord }) => flute(time, chord.lead[COUNTERSUBJECT[(step / 4) | 0] % chord.lead.length], 0.8, SIXTEENTH * 3.4)),
          hits('....R.......R...', { R: 0.8 }, ({ time, chord }) => principal(time, chord.lead[3] - 12, 0.8, SIXTEENTH * 7)),
        ],
      },
      {
        name: 'choir-full', fromBar: 6, toBar: 12,
        tracks: [
          hits('P.......f.......', { P: 1, f: 0.85 }, ({ time, chord }, _v, s) => pedal(time, s === 'P' ? chord.bass - 12 : chord.bass - 5, 1, barLen / 2)),
          hits('F.F.F.F.F.F.F.F.', { F: 0.75 }, ({ time, step, chord }) => flute(time, chord.lead[COUNTERSUBJECT[(step / 2) | 0] % chord.lead.length] + 12, 0.75, SIXTEENTH * 1.8)),
          hits('R...R...R...R...', { R: 0.9 }, ({ time, step, chord }) => principal(time, chord.lead[COUNTERSUBJECT[(step / 4) | 0] % chord.lead.length], 0.9, SIXTEENTH * 3.4)),
          hits('C...............', { C: 1 }, ({ time, chord }) => choir(time, chord.pad.map((m) => m + 12), 1, barLen * 1.05)),
          oneShot(5, 0, ({ time, chord }) => bell(time, chord.bell + 12, 0.5)),
        ],
      },
      {
        name: 'dark-span', fromBar: 12, toBar: 15,
        tracks: [
          hits('P...............', { P: 0.85 }, ({ time, chord }) => pedal(time, chord.bass - 12, 0.85, barLen)),
          hits('F...............', { F: 0.7 }, ({ time, chord }) => flute(time, chord.lead[1], 0.7, barLen * 0.9)),
          fn(() => {}),
        ],
      },
      {
        name: 'finale', fromBar: 15,
        tracks: [
          hits('P.......f.......', { P: 1, f: 0.9 }, ({ time, chord }, _v, s) => pedal(time, s === 'P' ? chord.bass - 12 : chord.bass - 5, 1, barLen / 2)),
          hits('F.F.F.F.F.F.F.F.', { F: 0.85 }, ({ time, step, chord }) => flute(time, chord.lead[COUNTERSUBJECT[(step / 2) | 0] % chord.lead.length] + 12, 0.85, SIXTEENTH * 1.8)),
          hits('R.R.R.R.R.R.R.R.', { R: 0.85 }, ({ time, step, chord }) => principal(time, chord.lead[(step / 2) % chord.lead.length], 0.85, SIXTEENTH * 1.8)),
          hits('C...............', { C: 1 }, ({ time, chord }) => choir(time, [...chord.pad.map((m) => m + 12), chord.lead[3] + 12], 1, barLen * 1.05)),
          hits('................B...............', { B: 0.6 }, ({ time, chord }) => bell(time, chord.bell + 12, 0.6)),
          oneShot(4, 0, ({ time }) => fullOrgan(time, DMAJ, 1)),
          oneShot(5, 0, ({ time }) => fullOrgan(time, DMAJ, 1)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's organ --------------------------------------------------
  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxOut();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = SECTION_VOICES[sectionMix.from].kill;
    const toVoice = SECTION_VOICES[sectionMix.to].kill;
    const vel = Math.min(1.4, 1 + chain * 0.13);
    const layers: Array<[typeof fromVoice, number]> = sectionMix.from === sectionMix.to
      ? [[toVoice, 1]]
      : [[fromVoice, 1 - sectionMix.t], [toVoice, sectionMix.t]];
    for (const [v, weight] of layers) {
      if (weight < 0.02) continue;
      killPipeVoice.play({
        context: ctx, time, midi, kill: v, velocity: vel, weight,
        destination: output, sends: [{ destination: mix.delaySend, gain: 0.4 }],
      });
    }
    killBodyVoice.play({
      context: ctx, time, midi, decay: lerp(fromVoice.decay, toVoice.decay, sectionMix.t),
      gain: lerp(fromVoice.gain, toVoice.gain, sectionMix.t) * 0.8, velocity: vel, destination: output,
    });
    if (chain >= 2 && mix.reverbSend) {
      bell(time, midi + 12, 0.16 + chain * 0.03);
    }
  }

  // The Eater's wounds: deep anvil strokes that climb with damage, then the
  // rose ignition — the biggest single event in the level. The music ducks
  // for a breath, a D pedal drops two octaves, every rank opens on D major,
  // and a peal falls from the top of the register through the cathedral.
  function eaterChip(intensity: number) {
    const output = sfxOut();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const rootFreq = midiToFreq(chord.bass);
    playOscillatorVoice({
      context: ctx, time, stopTime: time + 0.5,
      oscillatorType: 'sine', frequency: rootFreq * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq / 2, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
      ],
      destination: output,
    });
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx, time, stopTime: time + 0.3,
        oscillatorType: 'sawtooth', frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1800 + 2200 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.04 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
        ],
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.3 }],
      });
    }
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    if (mix.reverbSend) bell(time, beacon + 12, 0.2 + 0.2 * intensity);
  }

  function roseIgnition() {
    const output = sfxOut();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend || !mix.duck || !mix.reverbSend) return;
    const delaySend = mix.delaySend;
    const reverbSend = mix.reverbSend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(time, 0.2, 2.2);
    // Pedal D dropping two octaves under everything.
    playOscillatorVoice({
      context: ctx, time, stopTime: time + 1.4,
      oscillatorType: 'sine', frequency: 146.8,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 36.7, time: time + 0.6 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.3 },
      ],
      destination: output,
    });
    // Every rank opens: D major stacked through four octaves.
    for (const midi of [38, 50, 54, 57, 62, 66, 69, 73]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx, time, stopTime: time + 2.2,
          oscillatorType: 'sawtooth', frequency: midiToFreq(midi), detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 600, time },
              { type: 'linearRamp', value: 3200, time: time + 1.2 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.04, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 2.1 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }, { destination: reverbSend, gain: 0.4 }],
        });
      }
    }
    // Victory peal in D major, falling from the top through the reverb.
    [86, 81, 78, 74, 73, 69, 66, 62].forEach((midi, index) => {
      if (!ctx || !output || !delaySend || !reverbSend) return;
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx, time: at, stopTime: at + 0.7,
        oscillatorType: 'sine', frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.14 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.65 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.5 }, { destination: reverbSend, gain: 0.5 }],
      });
    });
    bell(time, 90, 0.5);
    bell(time + SIXTEENTH * 4, 86, 0.4);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === eaterId) {
      roseIgnition();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxOut();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    const layers: Array<[SectionIndex, number]> = sectionMix.from === sectionMix.to
      ? [[sectionMix.to, 1]]
      : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
    for (const [section, weight] of layers) {
      if (weight < 0.02) continue;
      const v = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx, time, midi, oscillator: v.oscillator, cutoff: v.cutoff,
        gainValue: v.gain, lockCount, weight,
        destination: output, sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    }
  });

  bus.on('fire', () => {
    const output = sfxOut();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx, time, midi: root + 36, cutoff: 2400,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.09 }],
      destination: output,
    });
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxOut();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    if (enemyId === eaterId) {
      eaterChip(1 - hitPointsRemaining / 6);
      return;
    }
    // Petal chips climb the live chord — the fight stays in tune bar to bar.
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    ([0, 1, 2] as const).forEach((index) => {
      if (!ctx || !output || !mix.delaySend) return;
      const at = time + (SIXTEENTH / 2) * index;
      killPipeVoice.play({
        context: ctx, time: at, midi: lead[index % lead.length] + 12,
        kill: { oscillator: 'triangle', decay: 0.2, cutoff: 3600, gain: 0.07 },
        destination: output, sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    });
  });

  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    // A clean volley earns the music's applause: the chord under a bell.
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx, time, stopTime: time + 0.6,
        oscillatorType: 'sawtooth', frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2200 },
        gainAutomation: [
          { type: 'set', value: 0.045, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    }
    bell(time, chord.bell + 12, 0.35);
  });

  bus.on('reject', () => {
    const output = sfxOut();
    if (!ctx || !output) return;
    // A stopped pipe coughing a minor second — dry, churchy, clearly "no".
    const time = ctx.currentTime;
    for (const [midi, at, vel] of [[44, time, 0.2], [45, time + 0.03, 0.16]] as const) {
      rejectVoice.play({ context: ctx, time: at, midi, vel, destination: output });
    }
  });

  bus.on('playerhit', () => {
    const output = sfxOut();
    if (!ctx || !output) return;
    // The one out-of-key sound: a low cluster grinding a semitone apart.
    const time = ctx.currentTime;
    for (const midi of [40, 41, 46]) {
      playOscillatorVoice({
        context: ctx, time, stopTime: time + 0.5,
        oscillatorType: 'sawtooth', frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 900 },
        gainAutomation: [
          { type: 'set', value: 0.12, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: output,
      });
    }
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind !== 'eater' || !ctx) return;
    eaterId = enemyId;
    score.overrideSection(5);
  });

  bus.on('miss', () => {
    const output = sfxOut();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx, time, stopTime: time + 0.3,
      oscillatorType: 'sine', frequency: 98,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 49, time: time + 0.25 }],
      gainAutomation: [
        { type: 'set', value: 0.06, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
      ],
      destination: output,
    });
  });

  return runtime;
}
