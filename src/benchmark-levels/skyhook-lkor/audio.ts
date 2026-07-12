import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { blendNumber, createScore, lerp, type SectionMix } from '../../engine/score';
import {
  createSkyhookVoices,
  installSkyhookAtmosphere,
  type SkyhookAtmosphere,
  type SkyhookTonalVoice,
} from './audio-voices';
import {
  SKYHOOK_BARS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_SCORE_SECTIONS,
  SKYHOOK_STEPS_PER_BAR,
  SKYHOOK_TIME,
  LEECH_APPROACH_SECONDS,
  LEECH_WINDUP_SECONDS,
  type SkyhookSection,
} from './timing';

// The Skyhook score: 112 BPM, 30 bars in E-flat (lydian-leaning), scored so the
// mix IS the altitude. The storm is wide and wet — warm detuned pads, full sub,
// a groove, a wind/rain bed, thunder on the lightning bars. Punching the cloud
// deck lifts it into a brighter, hopeful voicing. From thin air the arrangement
// is progressively STRIPPED — snare to rim ticks, sub to a soft pulse, the pad
// narrows, the reverb sends dry out, a lone high bell keeps time. The lamprey
// brings a low machine menace under the emptiness; killing it ducks the mix and
// lands a resolving figure. The dock is almost silence: a slow heartbeat, an
// airlock hiss, one warm E-flat swell, a last high tone fading out.

const SIXTEENTH = SKYHOOK_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SKYHOOK_STEPS_PER_BAR;
const BAR_SECONDS = STEPS_PER_BAR * SIXTEENTH;
const PAD_2BAR = 2 * BAR_SECONDS;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Storm + cloud: E-flat maj9 — Cm9 — A-flat maj9 — B-flat sus, two bars each.
// The A natural in the E-flat chord is the lydian sparkle; voicings are wide and
// low with the lead register (arp) parked up high, out of the kill melody's way.
const CHORDS: Chord[] = [
  { bass: 39, pad: [51, 58, 62, 65], arp: [70, 74, 77, 81], stab: [70, 74, 77] }, // E-flat maj9
  { bass: 36, pad: [48, 55, 60, 63], arp: [72, 75, 79, 82], stab: [72, 75, 79] }, // Cm9
  { bass: 44, pad: [56, 60, 63, 67], arp: [70, 72, 75, 79], stab: [72, 75, 79] }, // A-flat maj9
  { bass: 46, pad: [58, 63, 65, 68], arp: [70, 72, 77, 80], stab: [72, 77, 80] }, // B-flat sus
];

// Thin air: quartal E-flat / B-flat stacks — open, cold, drier.
const THIN_CHORDS: Chord[] = [
  { bass: 39, pad: [51, 56, 61], arp: [65, 70, 75, 80], stab: [70, 75, 80] }, // E-flat quartal
  { bass: 46, pad: [53, 58, 63], arp: [67, 72, 77, 82], stab: [72, 77, 82] }, // B-flat quartal
];

// Lamprey: a low E-flat pedal with a creeping flat-6 (C-flat / B natural) menace.
const LAMPREY_CHORDS: Chord[] = [
  { bass: 39, pad: [51, 54, 58], arp: [70, 73, 75, 78], stab: [70, 75, 78] }, // E-flat minor over pedal
  { bass: 39, pad: [51, 54, 59], arp: [71, 73, 75, 78], stab: [71, 75, 78] }, // flat-6 creep (C-flat)
];

// Dock: a pure E-flat triad resolving up to a single high B-flat.
const DOCK_CHORDS: Chord[] = [
  { bass: 39, pad: [51, 55, 58], arp: [70, 75, 79, 82], stab: [70, 75, 79] }, // E-flat triad
  { bass: 39, pad: [58, 63, 70], arp: [75, 79, 82, 87], stab: [82, 87] }, // high resolve
];

// Kill lanes are 32-step (two-bar) degree contours into the live 8-note lead set.
// Every section owns one (the score validator requires it); each is written to
// leave the upper-mid register free so a chained volley performs a real run.
const KILL_LANES: Record<SkyhookSection, number[]> = {
  // Storm: flowing wide arcs riding the wind.
  storm: [
    0, 2, 4, 2, 3, 5, 4, 2,
    1, 3, 5, 3, 4, 6, 5, 3,
    0, 2, 4, 6, 5, 3, 4, 2,
    5, 7, 6, 4, 5, 3, 2, 0,
  ],
  // Cloud: bright hopeful climbs, the sky opening up.
  cloud: [
    0, 2, 4, 5, 4, 5, 7, 5,
    2, 4, 6, 7, 6, 7, 5, 4,
    0, 3, 5, 7, 5, 4, 2, 4,
    5, 7, 6, 7, 4, 5, 7, 7,
  ],
  // Thin: high glassy fragments, air nearly gone.
  thin: [
    4, 6, 5, 7, 6, 4, 5, 7,
    5, 7, 6, 4, 7, 5, 6, 4,
    4, 5, 7, 6, 7, 5, 4, 6,
    5, 4, 6, 7, 6, 4, 5, 7,
  ],
  // Lamprey: low tolling descents against the machine.
  lamprey: [
    3, 2, 1, 0, 2, 1, 0, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
    2, 1, 3, 1, 0, 2, 1, 3,
    2, 4, 3, 2, 1, 0, 2, 0,
  ],
  // Dock: gentle resolved figures, docked and safe.
  dock: [
    0, 2, 4, 2, 4, 2, 0, 2,
    4, 5, 4, 2, 0, 2, 4, 5,
    4, 2, 0, 2, 4, 2, 4, 5,
    4, 2, 0, 4, 2, 0, 2, 4,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };
type PlayerVoiceSet = { lock: SkyhookTonalVoice; kill: SkyhookTonalVoice; fire: FireVoice };

// Player timbres blend by section: storm/cloud voices are rounder and wetter,
// thin/vacuum voices glassier, drier, and more percussive — no air up here.
const PLAYER_VOICES: Record<SkyhookSection, PlayerVoiceSet> = {
  storm: {
    lock: { oscillator: 'triangle', decay: 0.13, cutoff: 3000, gain: 0.11, sparkle: 0.4, reverb: 0.34 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 2800, gain: 0.15, sparkle: 0.6, reverb: 0.4 },
    fire: { oscillator: 'triangle', cutoff: 3000, gain: 0.07, fallSemitones: 12, noise: 0.03 },
  },
  cloud: {
    lock: { oscillator: 'sine', decay: 0.12, cutoff: 4200, gain: 0.1, sparkle: 0.55, reverb: 0.3 },
    kill: { oscillator: 'triangle', decay: 0.26, cutoff: 3800, gain: 0.14, sparkle: 0.7, reverb: 0.32 },
    fire: { oscillator: 'triangle', cutoff: 3800, gain: 0.07, fallSemitones: 10, noise: 0.035 },
  },
  thin: {
    lock: { oscillator: 'sine', decay: 0.08, cutoff: 5200, gain: 0.06, sparkle: 0.7, reverb: 0.12 },
    kill: { oscillator: 'sine', decay: 0.16, cutoff: 5000, gain: 0.1, sparkle: 0.85, reverb: 0.14 },
    fire: { oscillator: 'triangle', cutoff: 5000, gain: 0.06, fallSemitones: 7, noise: 0.05 },
  },
  lamprey: {
    lock: { oscillator: 'square', decay: 0.09, cutoff: 2400, gain: 0.055, sparkle: 0.4, reverb: 0.14 },
    kill: { oscillator: 'square', decay: 0.18, cutoff: 2800, gain: 0.11, sparkle: 0.5, reverb: 0.16 },
    fire: { oscillator: 'sawtooth', cutoff: 3000, gain: 0.06, fallSemitones: 7, noise: 0.05 },
  },
  dock: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 3400, gain: 0.07, sparkle: 0.3, reverb: 0.4 },
    kill: { oscillator: 'sine', decay: 0.34, cutoff: 3200, gain: 0.12, sparkle: 0.5, reverb: 0.42 },
    fire: { oscillator: 'sine', cutoff: 3200, gain: 0.05, fallSemitones: 12, noise: 0.03 },
  },
};

// The static hall's send usage decreases with altitude: wet in the storm, drier
// up top. Player and arrangement voices fold this per-section scalar into their
// reverb sends, so the same reverb "magically" dries as the air thins.
const SECTION_REVERB: Record<SkyhookSection, number> = { storm: 1, cloud: 0.72, thin: 0.32, lamprey: 0.42, dock: 0.6 };
const SECTION_WIND: Record<SkyhookSection, number> = { storm: 0.5, cloud: 0.32, thin: 0.16, lamprey: 0.12, dock: 0.05 };
const SECTION_RAIN: Record<SkyhookSection, number> = { storm: 0.5, cloud: 0, thin: 0, lamprey: 0, dock: 0 };
const AMBIENT_WIND = 0.2;

// The hopeful cloud-break lead, one four-bar phrase. [barInPhrase, step(8ths), midi, beats]
const CLOUD_LEAD: Array<[number, number, number, number]> = [
  [0, 0, 74, 1], [0, 2, 77, 1], [0, 4, 81, 2],
  [1, 0, 79, 1], [1, 2, 77, 1], [1, 4, 82, 2],
  [2, 0, 81, 1.5], [2, 3, 79, 0.5], [2, 4, 77, 2],
  [3, 0, 74, 1], [3, 2, 77, 1], [3, 4, 79, 2],
];

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-lkor',
  bpm: SKYHOOK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let atmosphere: SkyhookAtmosphere | null = null;
  let lampreyId = -1;
  let lampreyMaxHp = 0;
  let lampreyDown = false;

  const score = createScore<Chord, SkyhookSection>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: SKYHOOK_BARS.thinAir, toBar: 18, chords: THIN_CHORDS, barsPerChord: 2 },
      { fromBar: 18, toBar: SKYHOOK_BARS.dock, chords: LAMPREY_CHORDS, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end, chords: DOCK_CHORDS, barsPerChord: 2 },
    ],
    sections: SKYHOOK_SCORE_SECTIONS,
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
      if (mode !== 'run' || step !== 0) return;
      runArrangement.recordSectionStart(time, bar);
      updateAtmosphere(bar, time);
    },
    mix: {
      compressor: { threshold: -17, ratio: 4.5, attack: 0.005, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2200 },
      reverb: { seconds: 2.8, decay: 2.4, level: 0.5 },
      noiseSeconds: 3,
    },
    onPostBuild(context, mix) {
      ctx = context;
      atmosphere = installSkyhookAtmosphere(context, mix);
      atmosphere?.setWind(AMBIENT_WIND, context.currentTime);
    },
    onStep: scheduleStep,
    onRunStart() {
      lampreyId = -1;
      lampreyMaxHp = 0;
      lampreyDown = false;
      if (atmosphere && ctx) {
        atmosphere.setWind(SECTION_WIND.storm, ctx.currentTime);
        atmosphere.setRain(SECTION_RAIN.storm, ctx.currentTime);
      }
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) swell(context.currentTime + 0.05, [39, 51, 58, 70], 5, 0.85, 0.55);
      if (atmosphere && context) {
        atmosphere.setWind(AMBIENT_WIND, context.currentTime);
        atmosphere.setRain(0, context.currentTime);
      }
    },
    onDispose() {
      ctx = null;
      atmosphere = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- voices ---------------------------------------------------------------

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, snare, rim, shaker, hat, openHat, pad, sub, softPulse, bell, lead, stab, swell,
    thunder, clank, strain, groan, grind, airlock, heartbeat, klaxon, riser,
    playerSends, playerTone, playerNoise,
  } = voices;

  // How much of the static hall this musical position is allowed to use.
  function airReverb(position: number) {
    return blendNumber(score.sectionMixAt(position), SECTION_REVERB);
  }

  // ---- arrangements ---------------------------------------------------------

  const ambientChordAt = (position: number) => CHORDS[Math.floor(Math.floor(position / STEPS_PER_BAR) / 2) % CHORDS.length];

  // Attract mode: a wind bed (installed separately), slow pad drones, rare far
  // thunder. No groove.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: ambientChordAt,
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          fn(({ time, step, bar, chord }) => {
            if (step === 0 && bar % 4 === 0) pad(time, chord.pad, 4 * BAR_SECONDS, 0.6, 1500, 0.7);
          }),
          fn(({ time, step, bar }) => {
            if (step === 0 && bar % 8 === 6) thunder(time, 0.4);
          }),
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
        name: 'storm',
        fromBar: 0,
        tracks: [
          hits('K...K...K...K...', { K: 0.85 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.8 }, ({ time }, vel) => snare(time, vel)),
          hits('s.s.s.s.s.s.s.s.', { s: 0.045 }, ({ time }, vel) => shaker(time, vel)),
          hits('....h.......h...', { h: 0.05 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits('B.......B.......', { B: 0.9 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          fn(({ time, step, bar, chord, position }) => {
            if (step === 0 && bar % 2 === 0) pad(time, chord.pad, PAD_2BAR, 0.85, 1600, airReverb(position) * 0.5);
          }),
          // Distant thunder on the downbeats the visuals flash lightning.
          oneShot(2, 0, ({ time }) => thunder(time, 0.85)),
          oneShot(5, 0, ({ time }) => thunder(time, 0.95)),
          oneShot(7, 0, ({ time }) => thunder(time, 1)),
        ],
      },
      {
        name: 'cloud',
        fromBar: SKYHOOK_BARS.cloudPunch,
        tracks: [
          oneShot(0, 0, ({ time }) => riser(time, 6 * SIXTEENTH, 0.16)),
          hits('K...K...K...K...', { K: 0.8 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.85 }, ({ time }, vel) => snare(time, vel)),
          hits('hoHohoHohoHohoHo', { h: 0.04, H: 0.07, o: 0.03 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'o' ? 0.02 : 0.03)),
          hits('B.......B.......', { B: 0.85 }, ({ time, chord }, vel) => sub(time, chord.bass, vel)),
          fn(({ time, step, bar, chord, position }) => {
            if (step === 0 && bar % 2 === 0) pad(time, chord.pad, PAD_2BAR, 0.9, 2300, airReverb(position) * 0.5);
          }),
          // The hopeful lead motif, one four-bar phrase looped through the section.
          fn(({ time, step, barInSection, position }) => {
            if (step % 2 !== 0) return;
            const phraseBar = barInSection % 4;
            for (const [noteBar, noteStep, midi, beats] of CLOUD_LEAD) {
              if (noteBar === phraseBar && noteStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.9, airReverb(position) * 0.4);
            }
          }),
        ],
      },
      {
        name: 'thin',
        fromBar: SKYHOOK_BARS.thinAir,
        tracks: [
          hits('K...............', { K: 0.55 }, ({ time }, vel) => kick(time, vel)),
          hits('....r...r...r...', { r: 0.55 }, ({ time }, vel) => rim(time, vel)),
          hits('P.......P.......', { P: 0.9 }, ({ time, chord }, vel) => softPulse(time, chord.bass, vel)),
          hits('b...............', { b: 0.8 }, ({ time, chord, position }, vel) => bell(time, chord.arp[3], vel, airReverb(position) * 0.6)),
          fn(({ time, step, bar, chord, position }) => {
            if (step === 0 && bar % 2 === 0) pad(time, chord.pad.slice(0, 2), PAD_2BAR, 0.6, 1100, airReverb(position) * 0.5);
          }),
          // The lamprey latches the tether at bar 17.5: the CLANK and the strain.
          oneShot(3, 8, ({ time }) => {
            clank(time, 1);
            strain(time, 0.9, 2 * BAR_SECONDS);
          }),
        ],
      },
      {
        name: 'lamprey',
        fromBar: 18,
        tracks: [
          // A low groan-bass on the E-flat pedal — the machine's own voice.
          fn(({ time, step, bar, chord }) => {
            if (!lampreyDown && step === 0 && bar % 2 === 0) groan(time, chord.bass, PAD_2BAR, 0.9);
          }),
          // Sparse heavy pulses under the emptiness — menace, not a groove.
          hits('P.......P.......', { P: 0.95 }, ({ time, chord }, vel) => { if (!lampreyDown) sub(time, chord.bass, vel); }),
          // The thin-air bell keeps ticking, faint, until the machine is dead.
          hits('b...............b...............', { b: 0.5 }, ({ time, chord, position }, vel) => { if (!lampreyDown) bell(time, chord.arp[3], vel, airReverb(position) * 0.5); }),
          // Deadline telegraph: the klaxon in the last two bars before impact.
          fn(({ time, step, bar }) => {
            if (!lampreyDown && bar >= SKYHOOK_BARS.klaxon && step % 8 === 0) klaxon(time);
          }),
        ],
      },
      {
        name: 'dock',
        fromBar: SKYHOOK_BARS.dock,
        toBar: SKYHOOK_BARS.end,
        tracks: [
          // Slow soft heartbeat — the docked car's pulse.
          hits('H...............', { H: 0.85 }, ({ time }, vel) => heartbeat(time, vel)),
          // One resolved warm E-flat swell as the aperture opens.
          oneShot(0, 0, ({ time, chord }) => swell(time, [chord.bass, ...chord.pad], 4 * BAR_SECONDS, 0.7, 0.6)),
          // Airlock hiss at the seal (bar 28.5), a resolved swell, a last high tone.
          oneShot(2, 8, ({ time, chord }) => {
            airlock(time, 1.4);
            swell(time, [chord.bass, chord.pad[0]], 3 * BAR_SECONDS, 0.85, 0.6);
            swell(time, [87], 3.2, 0.5, 0.55);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  function sectionForBar(bar: number): SkyhookSection {
    let current: SkyhookSection = SKYHOOK_SCORE_SECTIONS[0].index;
    for (const section of SKYHOOK_SCORE_SECTIONS) {
      if (bar >= section.fromBar) current = section.index;
    }
    return current;
  }

  function updateAtmosphere(bar: number, time: number) {
    if (!atmosphere || !ctx) return;
    const section = sectionForBar(bar);
    const wind = lampreyDown ? Math.min(SECTION_WIND[section], 0.08) : SECTION_WIND[section];
    atmosphere.setWind(wind, time);
    atmosphere.setRain(SECTION_RAIN[section], time);
  }

  // ---- player-instrument voice specs ---------------------------------------

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
    duration: 0.2,
    stopPadding: 0.04,
    envelope: { decay: 0.2 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.085,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.085 },
  });

  const hitTickVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.1,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 5, frequency: 2400 },
    envelope: { decay: 0.1 },
  });

  const bossPingVoice = voice<{ intensity: number; gainValue: number }>({
    oscillators: [{ type: 'square', gain: ({ gainValue }) => gainValue }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: { type: 'bandpass', Q: 6, cutoff: ({ intensity }) => 900 + intensity * 2800 },
    gainAutomation: (time, gain) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
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

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.55,
    stopPadding: 0.05,
    envelope: { decay: 0.55 },
  });

  const playerHitChirpVoice = voice({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.11,
    stopPadding: 0.03,
    envelope: { decay: 0.11 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.13,
    stopPadding: 0.02,
    envelope: { decay: 0.13 },
  });

  const leechWhineVoice = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.05 }],
    duration: LEECH_WINDUP_SECONDS,
    stopPadding: 0.1,
    filter: { type: 'bandpass', Q: 5, frequency: 700 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.001, time },
      { type: 'exponentialRamp', value: 0.06, time: time + LEECH_WINDUP_SECONDS * 0.85 },
      { type: 'linearRamp', value: 0, time: time + LEECH_WINDUP_SECONDS },
    ],
  });

  const boltTickVoice = voice({
    oscillators: [{ type: 'triangle', gain: 0.05 }],
    duration: 0.06,
    stopPadding: 0.02,
    filter: { type: 'highpass', frequency: 1800 },
    envelope: { decay: 0.06 },
  });

  // ---- player-event -> music map -------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SkyhookSection>, slot: 'lock' | 'kill', key: keyof SkyhookTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : (to as number);
  }

  function killMelody(time: number, midi: number, mix: SectionMix<SkyhookSection>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const vel = Math.min(1.4, 1 + chain * 0.13);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay');
    const gain = mixedVoiceValue(mix, 'kill', 'gain');
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.4, mixedVoiceValue(mix, 'kill', 'reverb')) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle');
    playerNoise(time, 0.02 + sparkle * 0.04, 0.06, 7400);
  }

  // Boss non-lethal hits climb with cumulative damage: an escalating grind plus a
  // metallic ping that rises through the lead set as the machine is worn down.
  function bossChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    grind(time, 0.4 + intensity * 0.5, intensity);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.floor(intensity * (lead.length - 1)))];
    bossPingVoice.play({ context: ctx, time, frequency: midiToFreq(midi + 12), intensity, gainValue: 0.08 + intensity * 0.1, destination: output, sends: playerSends(0.2, 0.2) });
    playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES.lamprey.kill, 0.5 + intensity * 0.4, 1);
    playerNoise(time, 0.06 + intensity * 0.08, 0.05, 3200);
  }

  function lampreyFinale(time: number) {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.duck) return;
    mix.duckAt(time, 0.16, 1.6);
    clank(time, 0.9);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    swell(time + 0.08, [chord.bass, ...chord.pad], 6, 1, 0.5);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      playerTone(time + index * THIRTYSECOND, midi + 12, PLAYER_VOICES.dock.kill, Math.max(0.15, 0.9 - index * 0.07), 1);
    });
  }

  function scheduleLeechWhine() {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const start = ctx.currentTime + LEECH_APPROACH_SECONDS;
    const chord = score.chordAt(score.arrangementPositionAt(start));
    const base = midiToFreq(chord.bass + 24);
    leechWhineVoice.play({
      context: ctx,
      time: start,
      frequency: base,
      frequencyAutomation: [{ type: 'exponentialRamp', value: base * 2.6, time: start + LEECH_WINDUP_SECONDS }],
      destination: output,
      sends: playerSends(0.1, 0.1),
    });
    // Accelerating chew ticks across the wind-up: the car is being gnawed.
    const ticks = 6;
    for (let index = 0; index < ticks; index += 1) {
      const t = index / ticks;
      playerNoise(start + t * t * LEECH_WINDUP_SECONDS, 0.03 + t * 0.05, 0.02, 2600 + t * 1800);
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
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle');
    playerNoise(time, 0.012 + sparkle * 0.03, 0.02, 9200);
    if (lockCount >= 6) {
      // Ignition: the sixth lock drops an octave and a sub under the tick.
      const output = sfxDestination();
      if (!output) return;
      const bass = score.chordAt(position).bass;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(bass), time: time + 0.16 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.32, 1);
  });

  bus.on('fire', ({ indexInVolley, volleySize }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const weightSize = 0.65 + Math.min(6, volleySize) * 0.11;
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 12;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fv = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: fv.oscillator,
        cutoff: fv.cutoff,
        gainValue: fv.gain,
        weight: weight * weightSize,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fv.fallSemitones), time: time + 0.07 }],
        destination: output,
        sends: playerSends(0.2, 0.08 * airReverb(position)),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.03, 5200);
    if (volleySize >= 3) stab(time, chord.stab.map((midi) => midi + 12), Math.min(0.9, 0.35 + volleySize * 0.08), airReverb(position) * 0.3);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === lampreyId) {
      lampreyMaxHp = Math.max(lampreyMaxHp, hitPointsRemaining + 1);
      bossChip(time, 1 - hitPointsRemaining / Math.max(1, lampreyMaxHp));
      return;
    }
    const output = sfxDestination();
    if (!output) return;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    hitTickVoice.play({ context: ctx, time, midi: chord.stab[0] + 12, gainValue: 0.06, destination: output, sends: playerSends(0.16, 0.14) });
    playerNoise(time, 0.05, 0.03, 4200);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    if (enemyId === lampreyId) {
      // Boss stage escalation: a heavier grind and a rising cluster.
      grind(time, 0.85, 0.5 + stageIndex * 0.2);
      riser(time, 0.9, 0.14);
      return;
    }
    // Leech shell crack: a metallic crack tick.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    hitTickVoice.play({ context: ctx, time, midi: chord.stab[1] + 12, gainValue: 0.08, destination: output, sends: playerSends(0.14, 0.14) });
    playerNoise(time, 0.12, 0.05, 3000);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === lampreyId) return; // the finale rides the bossphase 'destroyed' event
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, kill.midi, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.7, airReverb(position) * 0.35);
    const leadSet = score.leadSetAt(position);
    const toSection = score.sectionMixAt(position).to;
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[toSection].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // Utilitarian hazard buzz — deliberately off-grid, no musical reward.
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[196, time, 0.15], [208, time + 0.02, 0.12]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.5, time: at + 0.18 }],
        vel,
        destination: output,
      });
    }
    voices.noiseHit(time, 0.12, 0.08, 'bandpass', 560, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // Off-grid: a low hull thud plus a car-alarm chirp. The car took a hit.
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.34 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[chord.stab.length - 1] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      playerHitChirpVoice.play({ context, time: time + index * 0.14, midi, destination: output, sends: playerSends(0.12, 0.08) });
    });
    voices.noiseHit(time, 0.16, 0.16, 'bandpass', 820, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // A small airy falloff — the shot slips into the sky.
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.12 }],
      destination: output,
      sends: playerSends(0.08, 0.06),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'lamprey') {
      lampreyId = enemyId;
      lampreyMaxHp = 0;
      return;
    }
    if (kind === 'leech') {
      scheduleLeechWhine();
      return;
    }
    if (kind === 'bolt') {
      const output = sfxDestination();
      if (!output) return;
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      boltTickVoice.play({ context: ctx, time, frequency: 2400, destination: output, sends: playerSends(0.1, 0.06) });
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    if (phase === 'summoned') {
      // Menace onset under the clank: groan, tether strain, a long riser.
      const time = score.nextGridTime(ctx.currentTime, 1);
      groan(time, score.chordAt(score.arrangementPositionAt(time)).bass, 4 * BAR_SECONDS, 0.7);
      strain(time, 0.8, 3 * BAR_SECONDS);
      riser(time, 1.2, 0.12);
      return;
    }
    if (phase === 'exposed') {
      // The core is exposed and screaming: a rising cluster of grind.
      const time = score.nextGridTime(ctx.currentTime, 1);
      grind(time, 1, 0.9);
      riser(time, 1, 0.16);
      return;
    }
    if (phase === 'destroyed') {
      lampreyDown = true;
      lampreyFinale(score.nextGridTime(ctx.currentTime, 1));
      if (atmosphere) {
        atmosphere.setWind(0.06, ctx.currentTime);
        atmosphere.setRain(0, ctx.currentTime);
      }
    }
  });

  return runtime;
}
