import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createArrangement, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  createStrandlineVoices,
  installStrandlineWater,
  type StrandlineTonalVoice,
  type WaterController,
} from './audio-voices';
import {
  STRANDLINE_UZWM_BARS,
  STRANDLINE_UZWM_BPM,
  STRANDLINE_UZWM_RUN_DURATION,
  STRANDLINE_UZWM_SCORE_SECTIONS,
  STRANDLINE_UZWM_STEPS_PER_BAR,
  STRANDLINE_UZWM_TIME,
} from './timing';

// The Strandline score: 120 BPM in D minor, 30 bars = exactly the 60-second
// run, and the arrangement is the animal waking up. The drift is sparse — a
// low pulse, a dim one-voice pad, glass droplets; each vista and act adds a
// layer (shimmer arp, soft kit, full bass, dread pulse at the crown) until
// the resolve strips everything back to a warm D-major wash. Locks, shots,
// chips, and kills are all notes in this score: they snap to the transport,
// read the live chord, and kills walk hidden per-act melody lanes so a clean
// volley performs a solo in the water.

const SIXTEENTH = STRANDLINE_UZWM_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = STRANDLINE_UZWM_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[] };

// Dm9 — Bbmaj9 — Fadd9 — Cadd9, two bars each: the sunlit-water loop.
const CHORDS: Chord[] = [
  { bass: 38, pad: [62, 65, 69, 72], arp: [69, 72, 76, 79] }, // Dm9
  { bass: 34, pad: [58, 62, 65, 72], arp: [65, 69, 72, 74] }, // Bbmaj9
  { bass: 29, pad: [57, 60, 65, 67], arp: [67, 72, 76, 79] }, // Fadd9
  { bass: 36, pad: [55, 60, 64, 67], arp: [67, 72, 76, 81] }, // Cadd9
];
// The parent bars walk Dm — Ebmaj7 — Dm — A; the flat second is the thing on
// the crown. (Order compensates for absolute-bar chord indexing.)
const BOSS_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 33, pad: [57, 60, 64, 69], arp: [69, 73, 76, 81] }, // A
  CHORDS[0],
  { bass: 39, pad: [58, 62, 65, 70], arp: [70, 74, 77, 82] }, // Ebmaj7
];
// Resolve: D major arrival warmth.
const DOCK_CHORDS: Chord[] = [
  { bass: 38, pad: [62, 66, 69, 74], arp: [66, 69, 74, 78] },
];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Drift: slow stepwise arches rising out of the dim.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 4,
  ],
  // Thicket: jump-cut broken chords for dense sunlit volleys.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 6, 5, 7, 6, 4, 2, 0,
  ],
  // Wake: hard octave zig-zags — dense volleys ring as fast runs.
  2: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 7, 5, 6, 4, 5, 6, 7,
    0, 4, 1, 5, 2, 6, 3, 7,
    7, 6, 5, 4, 5, 6, 7, 4,
  ],
  // Parent: tolling descents while the webbing starves.
  3: [
    7, 6, 5, 4, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
    4, 3, 2, 1, 2, 1, 0, 1,
    3, 2, 1, 0, 2, 3, 4, 5,
  ],
  // Resolve: settling home.
  4: [
    4, 3, 2, 1, 2, 1, 0, 1,
    2, 3, 4, 3, 2, 1, 0, 0,
    3, 2, 1, 0, 1, 0, 1, 2,
    3, 2, 1, 0, 0, 1, 2, 3,
  ],
};

const LOCK_SCALE = [62, 64, 65, 67, 69, 72, 74, 76]; // D minor, rising per lock

type FireVoice = { cutoff: number; fallSemitones: number; noise: number; gain: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: StrandlineTonalVoice; kill: StrandlineTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 2800, gain: 0.1, sparkle: 0.5, reverb: 0.3 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3000, gain: 0.13, sparkle: 0.65, reverb: 0.35 },
    fire: { cutoff: 2600, fallSemitones: 10, noise: 0.04, gain: 0.07 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2600, gain: 0.045, sparkle: 0.4, reverb: 0.18 },
    kill: { oscillator: 'square', decay: 0.22, cutoff: 3200, gain: 0.1, sparkle: 0.6, reverb: 0.22 },
    fire: { cutoff: 3400, fallSemitones: 8, noise: 0.05, gain: 0.06 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.08, cutoff: 3000, gain: 0.04, sparkle: 0.4, reverb: 0.14 },
    kill: { oscillator: 'sawtooth', decay: 0.24, cutoff: 3600, gain: 0.1, sparkle: 0.65, reverb: 0.2 },
    fire: { cutoff: 4000, fallSemitones: 12, noise: 0.055, gain: 0.06 },
  },
  3: {
    lock: { oscillator: 'sine', decay: 0.13, cutoff: 1600, gain: 0.11, sparkle: 0.2, reverb: 0.45 },
    kill: { oscillator: 'sine', decay: 0.42, cutoff: 1800, gain: 0.15, sparkle: 0.35, reverb: 0.5 },
    fire: { cutoff: 1600, fallSemitones: 14, noise: 0.02, gain: 0.045 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 2600, gain: 0.09, sparkle: 0.5, reverb: 0.5 },
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 3000, gain: 0.12, sparkle: 0.7, reverb: 0.55 },
    fire: { cutoff: 2200, fallSemitones: 8, noise: 0.015, gain: 0.04 },
  },
};

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-uzwm',
  bpm: STRANDLINE_UZWM_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: STRANDLINE_UZWM_RUN_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let water: WaterController | null = null;
  let parentId = -1;
  const PARENT_TOTAL_HP = 6; // hitStages [3, 3]

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_UZWM_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: STRANDLINE_UZWM_BARS.boss, toBar: STRANDLINE_UZWM_BARS.coda, chords: BOSS_CHORDS, barsPerChord: 2 },
      { fromBar: STRANDLINE_UZWM_BARS.coda, chords: DOCK_CHORDS, barsPerChord: 1 },
    ],
    sections: STRANDLINE_UZWM_SCORE_SECTIONS,
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
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.32, dampHz: 2800 },
      reverb: { seconds: 2.8, decay: 2.7, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      water = installStrandlineWater(context, mix);
      water.setWater(context.currentTime + 0.1, 0.16, 1.5);
    },
    onStep: scheduleStep,
    onRunStart() {
      parentId = -1;
      const context = runtime.context();
      if (context && water) {
        water.setWater(context.currentTime + 0.05, 0.3, 1.2);
        water.setBrightness(context.currentTime + 0.05, 900, 2);
      }
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) {
        water?.setWater(context.currentTime + 0.5, 0.34, 4);
        voices.resolvePad(context.currentTime + 0.05, [62, 66, 69, 74, 78], 6, 0.9);
      }
    },
    onDispose() {
      ctx = null;
      water = null;
    },
  });

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: () => runtime.mix() });
  const { kick, hat, bass, droplet, pad, riser, noiseHit, playerTone } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement ------------------------------------------------------------

  const blankBar = '................';
  const heartbeat = 'P.......P.......';
  const softKick = 'K.......K...K...';
  const drive = 'K...K...K...K...';
  const tickHat = '.t.t.t.t.t.t.t.t';
  const openTick = '.t.t.t.tOt.t.t.t';
  const bassWalk = 'B..b..u.b..b..f.';
  const evenDroplets = 'D...D...D...D...';
  const shimmer = 'd.d.d.d.d.d.d.d.';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05, 0.8, 1, 1100)),
        hits('D...............' + blankBar, { D: 0.6 }, ({ time, chord }) => droplet(time, chord.arp[0] + 12, 0.6, 2800)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      // Drift: heartbeat pulse, dim pad, sparse droplets. Slow at start.
      {
        name: 'drift',
        fromBar: STRANDLINE_UZWM_BARS.drift,
        toBar: STRANDLINE_UZWM_BARS.vista1,
        tracks: [
          hits(heartbeat, { P: 1 }, ({ time }) => kick(time, 0.8)),
          hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05, 0.9, 1, 1100)),
          hits(evenDroplets, { D: 0.55 }, ({ time, step, chord }, vel) =>
            droplet(time, chord.arp[(step / 4) % chord.arp.length] + 12, vel, 3000)),
          hits('B...............' + blankBar, { B: 0.8 }, ({ time, chord }) => bass(time, chord.bass, 0.7)),
        ],
      },
      // Vista 1: the water brightens — shimmer arp joins, pad gains a voice.
      {
        name: 'vista',
        fromBar: STRANDLINE_UZWM_BARS.vista1,
        toBar: STRANDLINE_UZWM_BARS.thicket,
        tracks: [
          hits(heartbeat, { P: 1 }, ({ time }) => kick(time, 0.9)),
          hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05, 1, 2, 1500)),
          hits(shimmer, { d: 0.4 }, ({ time, step, chord }, vel) =>
            droplet(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel, 3800)),
          hits('B.......B.......' + blankBar.slice(0, 0), { B: 0.8 }, ({ time, chord }) => bass(time, chord.bass, 0.75)),
        ],
      },
      // Thicket: soft kit and walking bass — the forest comes alive.
      {
        name: 'thicket',
        fromBar: STRANDLINE_UZWM_BARS.thicket,
        toBar: STRANDLINE_UZWM_BARS.vista2,
        tracks: [
          hits(softKick, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(tickHat, { t: 0.5 }, ({ time }, vel) => hat(time, vel, false)),
          hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05, 1, 2, 1700)),
          hits(bassWalk, { B: 1, b: 0.75, u: 0.75, f: 0.75 }, ({ time, chord }, vel, symbol) => {
            const offset = symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0;
            bass(time, chord.bass + offset, vel);
          }),
          hits(shimmer, { d: 0.42 }, ({ time, step, chord }, vel) =>
            droplet(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel, 4000)),
        ],
      },
      // Moon: strip to pad and bell — the green-moon breath.
      {
        name: 'moon',
        fromBar: STRANDLINE_UZWM_BARS.vista2,
        toBar: STRANDLINE_UZWM_BARS.wake,
        tracks: [
          hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05, 1, 2, 1900)),
          hits('D.......D.......' + blankBar.slice(0, 0), { D: 0.7 }, ({ time, chord }) => droplet(time, chord.arp[2] + 24, 0.7, 4600)),
        ],
      },
      // Wake: full drive — four-on-the-floor, open ticks, low bass.
      {
        name: 'wake',
        fromBar: STRANDLINE_UZWM_BARS.wake,
        toBar: STRANDLINE_UZWM_BARS.crown,
        tracks: [
          hits(drive, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(openTick, { t: 0.55, O: 0.8 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'O')),
          hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05, 1.05, 3, 2200)),
          hits(bassWalk, { B: 1, b: 0.8, u: 0.8, f: 0.8 }, ({ time, chord }, vel, symbol) => {
            const offset = symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0;
            bass(time, chord.bass + offset, vel);
          }),
          hits(shimmer, { d: 0.5 }, ({ time, step, chord }, vel) =>
            droplet(time, chord.arp[(step / 2) % chord.arp.length] + 12, vel, 4200)),
        ],
      },
      // Crown: the riser. Kit drops, water brightens, breath held.
      {
        name: 'crown',
        fromBar: STRANDLINE_UZWM_BARS.crown,
        toBar: STRANDLINE_UZWM_BARS.boss,
        tracks: [
          hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * SIXTEENTH * 1.05, 1, 2, 2400)),
          oneShot(0, 0, ({ time }) => riser(time, 16 * SIXTEENTH)),
          hits('D...D...D...D...' + blankBar.slice(0, 0), { D: 0.6 }, ({ time, chord }) => droplet(time, chord.arp[3] + 24, 0.6, 4800)),
        ],
      },
      // Parent: dread pulse and drive under the tolling kill lane.
      {
        name: 'parent',
        fromBar: STRANDLINE_UZWM_BARS.boss,
        toBar: STRANDLINE_UZWM_BARS.coda,
        tracks: [
          hits(drive, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(tickHat, { t: 0.5 }, ({ time }, vel) => hat(time, vel, false)),
          hits('B.B.B.B.B.B.B.B.' + blankBar.slice(0, 0), { B: 0.7 }, ({ time, chord }) => bass(time, chord.bass - 12, 0.7)),
          hits('P...............' + blankBar, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05, 1, 3, 1400)),
        ],
      },
      // Resolve: one long warm chord. Serene.
      {
        name: 'resolve',
        fromBar: STRANDLINE_UZWM_BARS.coda,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => pad(time, [...chord.pad, chord.pad[0] + 12], 16 * 2 * SIXTEENTH * 1.05, 0.9, 3, 1800)),
          hits('D...............D...............', { D: 0.5 }, ({ time, chord }) => droplet(time, chord.arp[1] + 24, 0.5, 4200)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments ---------------------------------------------
  // Kills read the hidden melody lane, locks climb D minor in the act's
  // timbre, fire is a pitched droplet rooted on the current chord. All snap
  // to the transport's real grid.

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = PLAYER_VOICES[sectionMix.from].kill;
    const toVoice = PLAYER_VOICES[sectionMix.to].kill;
    const vel = Math.min(1.35, 1 + chain * 0.12);
    const layers: Array<[typeof fromVoice, number]> =
      sectionMix.from === sectionMix.to
        ? [[toVoice, 1]]
        : [[fromVoice, 1 - sectionMix.t], [toVoice, sectionMix.t]];
    for (const [layerVoice, weight] of layers) {
      if (weight < 0.02) continue;
      playerTone.play({
        context: ctx,
        time,
        midi: midi + 12,
        vel: layerVoice.gain * vel * weight,
        cutoff: layerVoice.cutoff,
        decay: layerVoice.decay,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: layerVoice.sparkle * 0.6 }],
      });
    }
    if (chain >= 2) {
      playerTone.play({
        context: ctx,
        time,
        midi: midi + 24,
        vel: 0.05,
        cutoff: 5200,
        decay: 0.4,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.03 + 0.02 * chain, 0.06, 'highpass', 5600, output);
  }

  // Chipping the parent rings a deep bell where everything else rings high.
  // It grows with the damage dealt — gain, brightness, a climbing beacon —
  // and the killing blow earns a scheduled finale.
  function parentChip(intensity: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const rootFreq = midiToFreq(chord.bass + 12);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: rootFreq * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
      ],
      destination: output,
    });
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.26,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2000 + 2800 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.04 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.3 }],
      });
    }
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.6,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.07 + 0.07 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
      ],
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
    });
    noiseHit(time, 0.1 + 0.08 * intensity, 0.06, 'bandpass', 1300, output);
  }

  // Tearing the parent loose: the music bows out for a breath, a sub drop
  // lands on the tonic, and a victory peal falls from the top of the
  // register through the delay into the resolve.
  function parentFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.duck) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);

    audioMix.duckAt(time, 0.2, 1.8);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1,
      oscillatorType: 'sine',
      frequency: 146.8,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 36.7, time: time + 0.45 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
      ],
      destination: output,
    });
    for (const midi of [50, 62, 66, 69]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.5,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 700, time },
              { type: 'linearRamp', value: 2600, time: time + 0.9 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.045, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.4 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }],
        });
      }
    }
    [86, 81, 78, 76, 74, 69, 66].forEach((midi, index) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.5,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 3800 },
        gainAutomation: [
          { type: 'set', value: 0.12 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }],
      });
    });
    noiseHit(time, 0.13, 0.6, 'highpass', 6000, output);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === parentId) {
      parentFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    const layers: Array<[SectionIndex, number]> =
      sectionMix.from === sectionMix.to
        ? [[sectionMix.to, 1]]
        : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
    for (const [section, weight] of layers) {
      if (weight < 0.02) continue;
      const lockVoice = PLAYER_VOICES[section].lock;
      playerTone.play({
        context: ctx,
        time,
        midi,
        vel: lockVoice.gain * weight,
        cutoff: lockVoice.cutoff + lockCount * 160,
        decay: lockVoice.decay,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: lockVoice.sparkle * 0.5 }],
      });
    }
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const fromFire = PLAYER_VOICES[sectionMix.from].fire;
    const toFire = PLAYER_VOICES[sectionMix.to].fire;
    const fireVoice = {
      cutoff: lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t),
      noise: lerp(fromFire.noise, toFire.noise, sectionMix.t),
      gain: lerp(fromFire.gain, toFire.gain, sectionMix.t),
      fall: Math.round(lerp(fromFire.fallSemitones, toFire.fallSemitones, sectionMix.t)),
    };
    const root = score.chordAt(position).bass;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.09,
      oscillatorType: 'triangle',
      frequency: midiToFreq(root + 36),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 36 - fireVoice.fall), time: time + 0.07 }],
      gainAutomation: [
        { type: 'set', value: fireVoice.gain, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
      ],
      filter: { type: 'lowpass', frequency: fireVoice.cutoff },
      destination: output,
    });
    noiseHit(time, fireVoice.noise, 0.02, 'highpass', 3000, output);
  });

  // Armor chips climb the current chord; chips on the parent itself ring the
  // heavy bell instead — the fight's stakes live in that sound growing.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    if (enemyId === parentId) {
      parentChip(1 - hitPointsRemaining / PARENT_TOTAL_HP);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.075], [1, 0.065], [2, 0.055]] as const).forEach(([index, vel]) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + THIRTYSECOND * index;
      playerTone.play({
        context: ctx,
        time: at,
        midi: arp[index] + 12,
        vel,
        cutoff: 4200,
        decay: 0.14,
        destination: output,
        sends: [{ destination: delaySend, gain: 0.38 }],
      });
    });
    noiseHit(time, 0.03, 0.035, 'highpass', 5600, output);
  });

  // A clean volley of four or more kills earns a flourish: the chord stabbed
  // on the next beat — the water itself applauds.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2400 },
        gainAutomation: [
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.08, 0.3, 'highpass', 6800, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A fouled line: two dry dissonant thunks that cut through the water
    // without sounding like a successful sting.
    for (const [start, end, at, vel] of [
      [311, 87, time, 0.16],
      [220, 58, time + 0.03, 0.12],
    ] as const) {
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.22,
        oscillatorType: 'sawtooth',
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.2 }],
        filter: {
          type: 'bandpass',
          Q: 5,
          frequencyAutomation: [
            { type: 'set', value: 1000, time: at },
            { type: 'exponentialRamp', value: 400, time: at + 0.18 },
          ],
        },
        gainAutomation: [
          { type: 'set', value: vel, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.22 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.13, 0.09, 'bandpass', 700, output);
    noiseHit(time + 0.025, 0.06, 0.12, 'highpass', 2400, output);
  });

  // Hull hit: a low impact boom under a dissonant tritone — the one sound in
  // the level deliberately out of key. Something stung back.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.4,
      oscillatorType: 'sine',
      frequency: 92,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 32, time: time + 0.28 }],
      gainAutomation: [
        { type: 'set', value: 0.42, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
      ],
      destination: output,
    });
    for (const midi of [62, 68]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.24,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.06, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.18, 0.14, 'bandpass', 850, output);
  });

  // Parent entrance: a rising two-note alarm over a long riser, and from
  // here the kill lane speaks in the parent's tolling voice.
  bus.on('spawn', ({ kind, enemyId }) => {
    const mix = runtime.mix();
    if (kind !== 'parent' || !ctx || !mix?.duck || !mix.delaySend) return;
    score.overrideSection(3);
    parentId = enemyId;
    const time = score.nextGridTime(ctx.currentTime);
    riser(time, 1.8);
    [62, 68].forEach((midi, index) => {
      if (!ctx || !mix.duck || !mix.delaySend) return;
      const at = time + index * 0.42;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.55,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1500 },
        gainAutomation: [
          { type: 'set', value: 0.14, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.5 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    });
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.15,
      oscillatorType: 'sine',
      frequency: 130,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 65, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.045, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
      ],
      destination: output,
    });
  });

  return runtime;
}
