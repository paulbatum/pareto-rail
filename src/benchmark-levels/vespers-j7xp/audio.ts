import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  VESPERS_BARS,
  VESPERS_BPM,
  VESPERS_SCORE_SECTIONS,
  VESPERS_STEPS_PER_BAR,
  VESPERS_TIME,
  type VespersSectionIndex,
} from './timing';

const SIXTEENTH = VESPERS_TIME.stepSeconds;
const STEPS_PER_BAR = VESPERS_STEPS_PER_BAR;
const LANE_STEPS = 32; // Two bars of 16th-note resolution

// D minor / Dorian harmony moving through solemn modal shifts,
// culminating in a radiant D Major Picardy third for the finale.
export type OrganChord = {
  pedal: number;
  manual: number[];
  leadSet: number[];
  isMajor?: boolean;
};

const CHORDS: OrganChord[] = [
  // 0: Dm (Introitus)
  { pedal: 38, manual: [50, 57, 62, 65], leadSet: [62, 65, 69, 74, 77, 81, 86, 89] },
  // 1: Dm / Bbmaj7 (Counterpoint)
  { pedal: 34, manual: [46, 53, 58, 62], leadSet: [58, 62, 65, 69, 70, 74, 77, 82] },
  // 2: Gm7 / A7 (Swell)
  { pedal: 33, manual: [45, 52, 57, 60], leadSet: [60, 64, 67, 69, 72, 76, 79, 81] },
  // 3: Dm (Quiet Nave - solitary drone)
  { pedal: 38, manual: [50, 57, 62], leadSet: [62, 65, 69, 74, 77, 81, 86, 89] },
  // 4: Dm chromatic ostinato (Boss battle)
  { pedal: 38, manual: [50, 57, 61, 65], leadSet: [62, 65, 68, 70, 74, 77, 80, 82] },
  // 5: D MAJOR Picardy Third (The Finale: all ranks open)
  { pedal: 38, manual: [50, 57, 62, 66, 69], leadSet: [62, 66, 69, 74, 78, 81, 86, 90], isMajor: true },
];

// Kill Melody Lanes: Melodic contours for the player's organ solo
const KILL_LANES: Record<VespersSectionIndex, number[]> = {
  // 0: Introitus — Gentle ascending chant
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    3, 4, 5, 6, 5, 4, 3, 2,
    1, 2, 3, 4, 5, 6, 7, 7,
  ],
  // 1: Counterpoint — Agile polyphonic leaps
  1: [
    0, 2, 4, 6, 5, 3, 1, 0,
    2, 4, 6, 7, 6, 4, 2, 1,
    0, 3, 5, 7, 6, 4, 2, 1,
    3, 5, 7, 6, 5, 4, 2, 0,
  ],
  // 2: Swell — Soaring arch with high harmonic peaks
  2: [
    4, 5, 6, 7, 6, 5, 4, 3,
    5, 6, 7, 6, 5, 4, 3, 2,
    6, 5, 4, 3, 5, 6, 7, 6,
    7, 6, 5, 4, 3, 2, 1, 0,
  ],
  // 3: Quiet Nave — Solitary, haunting steps
  3: [
    0, 1, 2, 1, 0, 1, 2, 3,
    2, 1, 0, 1, 2, 3, 4, 3,
    2, 1, 0, 1, 0, 1, 2, 1,
    0, 1, 2, 3, 2, 1, 0, 0,
  ],
  // 4: Boss Battle — Driving toccata runs
  4: [
    7, 6, 5, 4, 7, 6, 5, 4,
    3, 4, 5, 6, 7, 6, 5, 4,
    5, 6, 7, 6, 5, 4, 3, 2,
    4, 5, 6, 7, 6, 5, 4, 7,
  ],
  // 5: Finale — Triumphant major fanfares
  5: [
    0, 2, 4, 7, 4, 2, 4, 7,
    2, 4, 7, 6, 7, 4, 2, 0,
    4, 6, 7, 6, 7, 4, 2, 0,
    0, 2, 4, 7, 7, 7, 7, 7,
  ],
};

const LOCK_SCALE = [62, 65, 67, 69, 72, 74, 77, 81]; // D minor scale degrees for locks

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-j7xp',
  bpm: VESPERS_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 61,
  createAudio: createVespersAudio,
});

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let finaleTriggered = false;

  const score = createScore<OrganChord, VespersSectionIndex>({
    bpm: VESPERS_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 4,
    sections: VESPERS_SCORE_SECTIONS,
    killLanes: KILL_LANES,
    leadSet: (chord) => chord.leadSet,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -16, ratio: 4, attack: 0.008, release: 0.28 },
      // Lush cavernous cathedral reverb
      reverb: { seconds: 4.2, decay: 2.8, level: 0.42 },
      delay: { time: SIXTEENTH * 3, feedback: 0.28, dampHz: 2800 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep(step: BeatLevelAudioStep) {
      if (!ctx) return;
      const time = step.time;
      const bar = Math.floor(step.index / STEPS_PER_BAR);
      const stepInBar = step.index % STEPS_PER_BAR;

      // 1. Sustained Pedal Subbass 16' (The Foundation of the Cathedral)
      if (stepInBar === 0) {
        const chord = score.chordAt(step.index);
        playPedalVoice(ctx, time, chord.pedal, VESPERS_TIME.bar(1));
      }

      // 2. Voice 1: Flûte Harmonique (Enters Bar 2)
      if (bar >= VESPERS_BARS.voice1 && bar < VESPERS_BARS.quietNave) {
        const melodyStep = step.index % 32;
        const note = getFluteMelodyNote(bar, melodyStep);
        if (note && stepInBar % 2 === 0) {
          playFluteVoice(ctx, time, note, SIXTEENTH * 1.8, 0.16);
        }
      }

      // 3. Voice 2: Great Principal 8' Counterpoint (Enters Bar 4)
      if (bar >= VESPERS_BARS.voice2 && bar < VESPERS_BARS.quietNave) {
        const principalStep = (step.index + 8) % 32;
        const note = getPrincipalCounterpointNote(bar, principalStep);
        if (note && (stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12)) {
          playPrincipalVoice(ctx, time, note, SIXTEENTH * 3.6, 0.2);
        }
      }

      // 4. Section 2: Vox Humana Choir & Carillon Bells (The Swell: Bars 8-13)
      if (bar >= VESPERS_BARS.swell && bar < VESPERS_BARS.quietNave) {
        // Vox Humana Choir swell
        if (stepInBar === 0) {
          const chord = score.chordAt(step.index);
          playChoirSwell(ctx, time, chord.manual, VESPERS_TIME.bar(1));
        }
        // Bell toll on bar downbeat
        if (stepInBar === 0 && bar % 2 === 0) {
          playCathedralBell(ctx, time, 62, 0.25);
        }
      }

      // 5. Section 3: The Quiet Nave (Bars 14-17)
      // "Past the middle, the nave goes quiet: a long dark empty span, one voice..."
      if (bar >= VESPERS_BARS.quietNave && bar < VESPERS_BARS.bossEntrance) {
        if (stepInBar % 4 === 0) {
          const quietNotes = [62, 65, 64, 62, 57, 60, 62, 62];
          const qNote = quietNotes[(Math.floor(step.index / 4)) % quietNotes.length];
          playFluteVoice(ctx, time, qNote, SIXTEENTH * 3.2, 0.12);
        }
      }

      // 6. Section 4: Boss Toccata (Bars 18-23)
      if (bar >= VESPERS_BARS.bossEntrance && bar < VESPERS_BARS.finale) {
        const toccataStep = step.index % 16;
        const note = getBossToccataNote(bar, toccataStep);
        playPrincipalVoice(ctx, time, note, SIXTEENTH * 0.9, 0.18);

        if (stepInBar % 4 === 0) {
          const chord = score.chordAt(step.index);
          playChoirSwell(ctx, time, chord.manual, SIXTEENTH * 3.8);
        }
      }

      // 7. Section 5: The Lit Cathedral Finale (Bar 24+)
      // Tutti: minor turns major, the held-back reeds open, bells ring!
      if (bar >= VESPERS_BARS.finale || finaleTriggered) {
        if (stepInBar === 0) {
          const dMajorChord = [50, 57, 62, 66, 69, 74];
          // Full Tutti with Reeds
          playTuttiVoice(ctx, time, dMajorChord, VESPERS_TIME.bar(1));
          playCathedralBell(ctx, time, 74, 0.35);
          playCathedralBell(ctx, time, 62, 0.4);
        }
      }
    },
  });

  // --- Gameplay Event Handlers (Organ voices in polyphony) ---
  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const noteIndex = Math.min(lockCount - 1, LOCK_SCALE.length - 1);
    const note = LOCK_SCALE[noteIndex] ?? 74;
    // Delicate high Positif pipe chiff
    playLockChiffVoice(ctx, time, note, 0.14);
  });

  bus.on('fire', () => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    // Breathy organ pipe air release
    playPipeAirRelease(ctx, time);
  });

  bus.on('hit', ({ lethal }) => {
    if (!ctx || lethal) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const pos = score.arrangementPositionAt(time);
    const chord = score.chordAt(pos);
    const note = chord.leadSet[2] ?? 69;
    // Pipe harmonic resonance
    playPrincipalVoice(ctx, time, note, 0.18, 0.15);
  });

  bus.on('kill', () => {
    if (!ctx) return;
    const killResult = score.nextKill(ctx.currentTime);
    // Solo Cornet / Reed stop solo note from the score kill lane!
    playKillMelodyVoice(ctx, killResult.time, killResult.midi, 0.35, 0.22);
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    // Dull pallet-close thump
    playPalletThump(ctx, time);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') {
      finaleTriggered = true;
      if (ctx) {
        const time = ctx.currentTime;
        // Big finale bell strike & tutti chord burst
        playCathedralBell(ctx, time, 74, 0.45);
        playCathedralBell(ctx, time, 62, 0.5);
        playTuttiVoice(ctx, time, [38, 50, 57, 62, 66, 69, 74, 78], 4.0);
      }
    }
  });

  return runtime;
}

// ---- Melodic Notes for Counterpoint ----
function getFluteMelodyNote(bar: number, step: number): number {
  const melody = [
    62, 62, 65, 65, 64, 64, 62, 62, 69, 69, 67, 67, 65, 65, 64, 64,
    65, 65, 67, 67, 69, 69, 72, 72, 70, 70, 69, 69, 67, 67, 65, 64,
  ];
  return melody[step % melody.length];
}

function getPrincipalCounterpointNote(bar: number, step: number): number {
  const countermelody = [
    50, 53, 57, 62, 60, 58, 57, 55, 53, 57, 60, 62, 65, 64, 62, 60,
    58, 62, 65, 67, 65, 64, 62, 60, 57, 60, 64, 65, 64, 62, 60, 57,
  ];
  return countermelody[step % countermelody.length];
}

function getBossToccataNote(bar: number, step: number): number {
  const toccata = [
    62, 65, 69, 65, 62, 68, 69, 68, 62, 65, 69, 70, 72, 70, 69, 65,
  ];
  return toccata[step % toccata.length];
}

// ---- Procedural Organ Synthesizers ----

// 1. Pedal Subbass 16' (Deep sine + 2nd harmonic)
function playPedalVoice(ctx: AudioContext, time: number, midi: number, duration: number) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  const freq = midiToFreq(midi);
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(freq, time);

  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(freq * 2, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.24, time + 0.12);
  gain.gain.setValueAtTime(0.24, time + duration - 0.15);
  gain.gain.linearRampToValueAtTime(0.001, time + duration);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + duration);
  osc2.stop(time + duration);
}

// 2. Flûte Harmonique 8' & 2' (Stopped Flute with chiff attack)
function playFluteVoice(ctx: AudioContext, time: number, midi: number, duration: number, vol = 0.18) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  const freq = midiToFreq(midi);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2600, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(vol, time + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + duration);
}

// 3. Great Principal 8' (Rich classical diapason)
function playPrincipalVoice(ctx: AudioContext, time: number, midi: number, duration: number, vol = 0.2) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  const freq = midiToFreq(midi);
  osc1.type = 'triangle';
  osc1.frequency.setValueAtTime(freq, time);

  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(freq * 1.002, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3200, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(vol, time + 0.04);
  gain.gain.setValueAtTime(vol * 0.85, time + duration - 0.08);
  gain.gain.linearRampToValueAtTime(0.001, time + duration);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + duration);
  osc2.stop(time + duration);
}

// 4. Vox Humana / Cathedral Choir Swell (Formant-filtered pad)
function playChoirSwell(ctx: AudioContext, time: number, midiNotes: number[], duration: number) {
  for (const midi of midiNotes) {
    const osc = ctx.createOscillator();
    const formant1 = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    const freq = midiToFreq(midi);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    // Vowel formant bandpass around 750 Hz
    formant1.type = 'bandpass';
    formant1.frequency.setValueAtTime(750, time);
    formant1.Q.setValueAtTime(4.0, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.06, time + duration * 0.35);
    gain.gain.setValueAtTime(0.06, time + duration * 0.7);
    gain.gain.linearRampToValueAtTime(0.001, time + duration);

    osc.connect(formant1);
    formant1.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + duration);
  }
}

// 5. Cathedral Carillon / Bells (Inharmonic partials with long natural decay)
function playCathedralBell(ctx: AudioContext, time: number, midi: number, vol = 0.28) {
  const rootFreq = midiToFreq(midi);
  const partials = [1.0, 2.0, 2.76, 5.4];
  const weights = [1.0, 0.6, 0.45, 0.2];

  for (let i = 0; i < partials.length; i += 1) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(rootFreq * partials[i], time);

    const partVol = vol * weights[i];
    gain.gain.setValueAtTime(partVol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 2.8 / (1 + i * 0.5));

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + 3.0);
  }
}

// 6. Full Organ Tutti with Held-Back Reed Rank (Trompette 8' + Bombarde 16')
function playTuttiVoice(ctx: AudioContext, time: number, midiNotes: number[], duration: number) {
  for (const midi of midiNotes) {
    const oscReed = ctx.createOscillator();
    const oscPrincipal = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    const freq = midiToFreq(midi);
    oscReed.type = 'sawtooth';
    oscReed.frequency.setValueAtTime(freq, time);

    oscPrincipal.type = 'triangle';
    oscPrincipal.frequency.setValueAtTime(freq * 2, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5400, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.18, time + 0.08);
    gain.gain.setValueAtTime(0.18, time + duration - 0.2);
    gain.gain.linearRampToValueAtTime(0.001, time + duration);

    oscReed.connect(filter);
    oscPrincipal.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    oscReed.start(time);
    oscPrincipal.start(time);
    oscReed.stop(time + duration);
    oscPrincipal.stop(time + duration);
  }
}

// 7. Player Action: Positif Lock Chiff
function playLockChiffVoice(ctx: AudioContext, time: number, midi: number, vol = 0.14) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  const freq = midiToFreq(midi);
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'highpass';
  filter.frequency.setValueAtTime(1800, time);

  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.09);
}

// 8. Player Action: Pipe Air Release (Fire)
function playPipeAirRelease(ctx: AudioContext, time: number) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, time);
  osc.frequency.exponentialRampToValueAtTime(220, time + 0.12);

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2400, time);

  gain.gain.setValueAtTime(0.08, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.15);
}

// 9. Player Action: Solo Cornet / Reed Kill Melody Note
function playKillMelodyVoice(ctx: AudioContext, time: number, midi: number, duration: number, vol = 0.22) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  const freq = midiToFreq(midi);
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(freq, time);

  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(freq * 2, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(4200, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(vol, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + duration);
  osc2.stop(time + duration);
}

// 10. Pallet Thump (Reject release)
function playPalletThump(ctx: AudioContext, time: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + 0.08);

  gain.gain.setValueAtTime(0.18, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.1);
}
