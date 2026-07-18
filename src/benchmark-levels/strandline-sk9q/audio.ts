import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createStrandlineVoices, installStrandlineWater, type StrandlineWater } from './audio-voices';
import {
  STRANDLINE_SK9Q_BARS,
  STRANDLINE_SK9Q_BPM,
  STRANDLINE_SK9Q_DURATION,
  STRANDLINE_SK9Q_SCORE_SECTIONS,
  STRANDLINE_SK9Q_STEPS_PER_BAR,
  STRANDLINE_SK9Q_TIME,
  type StrandlineSection,
} from './timing';

// STRANDLINE score — slow at first, gaining brightness and layers as the animal
// comes back to life. The jelly's own pulse is the kick; bells and droplets are
// its bioluminescence; the parasites are sour detuned ticks and a semitone
// drone under the boss. Player actions are notes: locks are droplets pitched
// from the live harmony, volleys are plucks, and kills walk an authored lane
// per section so a chained volley performs a melodic run.

type Chord = { bass: number; lead: readonly number[] };

const Am: Chord = { bass: 33, lead: [57, 60, 62, 64, 67, 69, 72, 76] };
const F: Chord = { bass: 29, lead: [53, 57, 60, 62, 65, 69, 72, 77] };
const C: Chord = { bass: 36, lead: [55, 60, 62, 64, 67, 72, 74, 79] };
const G: Chord = { bass: 31, lead: [55, 59, 62, 64, 67, 69, 71, 74] };
const Em: Chord = { bass: 28, lead: [52, 55, 59, 62, 64, 67, 71, 74] };
const Bb: Chord = { bass: 34, lead: [58, 60, 62, 63, 65, 68, 70, 74] };

// Two bars per chord, 14 chords for 28 bars. The sour B♭ color lives under the
// parent; the coda returns to a quiet Am bed while the serene A-major swell
// (scheduled on the killing blow) carries the resolution.
const CHORDS: readonly Chord[] = [Am, Am, F, C, G, Am, F, Em, F, G, Bb, Am, Bb, Am];

const KILL_LANES: Record<StrandlineSection, readonly number[]> = {
  drift: [2, 3, 1, 4, 2, 5, 3, 4, 2, 3, 5, 4, 3, 2, 1, 2],
  strandwood: [3, 4, 2, 5, 3, 4, 6, 5, 4, 3, 2, 4, 5, 4, 3, 2],
  greenmoon: [4, 5, 6, 4, 7, 5, 6, 4, 5, 6, 7, 6, 5, 4, 3, 4],
  souring: [3, 4, 5, 3, 6, 4, 5, 3, 4, 5, 6, 5, 4, 3, 2, 3],
  crown: [4, 5, 6, 7, 6, 5, 4, 5, 6, 7, 5, 6, 4, 5, 6, 7],
  parent: [5, 4, 6, 5, 7, 6, 4, 5, 6, 5, 7, 6, 5, 4, 6, 7],
  release: [7, 6, 5, 4, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0],
};

const SIXTEENTH = STRANDLINE_SK9Q_TIME.stepSeconds;
const BAR_SECONDS = STRANDLINE_SK9Q_TIME.barSeconds;

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineSk9qAudio = createAudioTraceHarness({
  level: 'strandline-sk9q',
  bpm: STRANDLINE_SK9Q_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: STRANDLINE_SK9Q_DURATION,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  const score = createScore<Chord, StrandlineSection>({
    bpm: STRANDLINE_SK9Q_BPM,
    stepsPerBar: STRANDLINE_SK9Q_STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: STRANDLINE_SK9Q_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  let water: StrandlineWater | null = null;
  let webTears = 0;
  let parentEscaped = false;
  let parentId = -1;
  let lastBroodStingAt = -10;
  const enemyKinds = new Map<number, string>();

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    bpm: STRANDLINE_SK9Q_BPM,
    stepsPerBar: STRANDLINE_SK9Q_STEPS_PER_BAR,
    stepSeconds: SIXTEENTH,
    runAlignment: 'step',
    beatNumber: 'position',
    volumeScale: 0.8,
    scheduleAhead: 0.18,
    schedulerMs: 25,
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.006, release: 0.24 },
      delay: { maxTime: 1.4, time: SIXTEENTH * 3, feedback: 0.3, dampHz: 3400, sendGain: 0.3 },
      reverb: { seconds: 2.6, decay: 3, level: 0.3 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      water = installStrandlineWater(context, mix);
      water?.setDeep(0.9, context.currentTime);
      water?.setShimmer(0.35, context.currentTime);
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunStart() {
      webTears = 0;
      parentEscaped = false;
      lastBroodStingAt = -10;
      enemyKinds.clear();
      const context = runtime.context();
      if (context && water) {
        water.setDeep(1, context.currentTime);
        water.setShimmer(0.4, context.currentTime);
      }
    },
    onRunEnd() {
      const context = runtime.context();
      if (context && water) {
        water.setDeep(0.7, context.currentTime);
        water.setShimmer(0.5, context.currentTime);
      }
    },
  });

  const voices = createStrandlineVoices({ trace, context: runtime.context, mix: runtime.mix });

  // ---- shared track helpers ---------------------------------------------------

  function padTrack(cutoff: number, vel = 0.5) {
    return fn<Chord>(({ time, bar, step, chord }) => {
      if (bar % 2 === 0 && step === 0) voices.pad(time, [chord.bass + 12, ...chord.lead.slice(0, 3)], vel, cutoff, BAR_SECONDS * 2 + 0.4);
    });
  }

  function pulseTrack(pattern: Record<number, number>) {
    return fn<Chord>(({ time, step }) => {
      const vel = pattern[step];
      if (vel !== undefined) voices.pulse(time, vel);
    });
  }

  // ---- ambient (attract) ------------------------------------------------------

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STRANDLINE_SK9Q_STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        fn(({ time, bar, step, chord }) => {
          if (step === 0) voices.pulse(time, 0.3);
          if (bar % 2 === 0 && step === 0) voices.pad(time, [chord.bass + 12, ...chord.lead.slice(0, 3)], 0.32, 620, BAR_SECONDS * 2 + 0.4);
          if (bar % 4 === 1 && step === 8) voices.call(time, chord.bass + 24, 0.7);
          if (bar % 4 === 3 && step === 12) voices.bell(time, chord.lead[4], 0.35, 0.8);
        }),
      ],
    }],
  });

  // ---- run sections -----------------------------------------------------------

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STRANDLINE_SK9Q_STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'drift',
        fromBar: STRANDLINE_SK9Q_BARS.drift,
        tracks: [
          pulseTrack({ 0: 0.5, 8: 0.26 }),
          padTrack(760, 0.42),
          fn(({ time, bar, step, chord }) => {
            if (step === 0) voices.bass(time, chord.bass, 0.45);
            if ((bar === 1 || bar === 3) && step === 4) voices.call(time, chord.bass + 24, 0.75);
            if (bar === 2 && step === 12) voices.bell(time, chord.lead[4], 0.4, 0.8);
          }),
        ],
      },
      {
        name: 'strandwood',
        fromBar: STRANDLINE_SK9Q_BARS.strandwood,
        tracks: [
          pulseTrack({ 0: 0.62, 4: 0.24, 8: 0.45 }),
          padTrack(980, 0.46),
          fn(({ time, bar, step, chord }) => {
            if (step % 4 === 0) voices.bass(time, chord.bass, 0.5);
            if (step === 6 || step === 14) voices.bass(time, chord.bass + 7, 0.3);
            if (step % 4 === 2) voices.tick(time, 0.5);
            if (bar >= 6 && (step === 4 || step === 12)) voices.sparkle(time, chord.lead[6], 0.5);
            if (bar === 5 && step === 2) voices.call(time, chord.bass + 24, 0.6);
          }),
        ],
      },
      {
        name: 'greenmoon',
        fromBar: STRANDLINE_SK9Q_BARS.reveal1,
        tracks: [
          pulseTrack({ 0: 0.66, 4: 0.5, 8: 0.6, 12: 0.5 }),
          padTrack(1750, 0.5),
          fn(({ time, bar, barInSection, step, chord }) => {
            if (barInSection === 0 && step === 0) {
              voices.whoosh(time, 0.9, 1.8);
              const context = runtime.context();
              if (context && water) water.setShimmer(0.9, context.currentTime);
            }
            if (step % 4 === 0) voices.bass(time, chord.bass, 0.5);
            if (step % 4 === 2) voices.bass(time, chord.bass + 7, 0.28);
            const motif: Record<number, number> = { 0: 2, 6: 4, 10: 5, 14: 3 };
            const degree = motif[step];
            if (degree !== undefined) voices.bell(time, chord.lead[degree], 0.42, 1);
            if (step % 4 === 2) voices.sparkle(time, chord.lead[6], 0.35);
            if (bar === 11 && step === 0) {
              const context = runtime.context();
              if (context && water) water.setShimmer(0.5, context.currentTime);
            }
          }),
        ],
      },
      {
        name: 'souring',
        fromBar: STRANDLINE_SK9Q_BARS.souring,
        tracks: [
          pulseTrack({ 0: 0.66, 4: 0.5, 8: 0.62, 12: 0.5, 14: 0.3 }),
          padTrack(1080, 0.44),
          // The violet creep: a sour semitone pad layer under the darker water.
          fn(({ time, bar, step, chord }) => {
            if (bar % 2 === 0 && step === 0) voices.pad(time, [chord.bass + 13], 0.22, 700, BAR_SECONDS * 2 + 0.3);
            const bassline: Record<number, [number, number]> = { 0: [0, 0.55], 3: [0, 0.3], 6: [7, 0.35], 8: [0, 0.5], 11: [0, 0.3], 14: [10, 0.35] };
            const hit = bassline[step];
            if (hit) voices.bass(time, chord.bass + hit[0], hit[1]);
            if (step % 4 === 2) voices.tick(time, 0.55);
            if (step === 4 || step === 12) voices.bell(time, chord.lead[1], 0.36, 0.7);
            if (bar === 15 && step === 8) voices.call(time, chord.bass + 24, 0.5);
          }),
        ],
      },
      {
        name: 'crown',
        fromBar: STRANDLINE_SK9Q_BARS.reveal2,
        tracks: [
          pulseTrack({ 0: 0.7, 4: 0.55, 8: 0.66, 12: 0.55 }),
          padTrack(1950, 0.5),
          fn(({ time, bar, barInSection, step, chord }) => {
            if (barInSection === 0 && step === 0) {
              voices.whoosh(time, 0.8, 1.6);
              const context = runtime.context();
              if (context && water) water.setShimmer(0.85, context.currentTime);
            }
            if (step % 4 === 0) voices.bass(time, chord.bass, 0.55);
            if (step % 4 === 2) voices.bass(time, chord.bass + 7, 0.3);
            voices.tick(time, 0.2 + barInSection * 0.12);
            const climb: Record<number, number> = { 0: 3, 4: 4, 8: 5, 12: 6 };
            const degree = climb[step];
            if (degree !== undefined) voices.bell(time, chord.lead[degree], 0.4, 1.05);
            if (bar === 18 && step === 0) voices.whoosh(time, 0.9, 2.1);
          }),
        ],
      },
      {
        name: 'parent',
        fromBar: STRANDLINE_SK9Q_BARS.parent,
        tracks: [
          pulseTrack({ 0: 0.72, 6: 0.5, 8: 0.6, 14: 0.42 }),
          padTrack(720, 0.3),
          fn(({ time, bar, step, chord }) => {
            // The sour bed: a low drone plus its semitone shadow, re-struck every
            // two bars. B♭ against A — the colony's dissonance.
            if (bar % 2 === 0 && step === 0) {
              voices.drone(time, chord.bass - 12, 0.4, BAR_SECONDS * 2 + 0.3);
              voices.drone(time, chord.bass - 11, 0.14, BAR_SECONDS * 2 + 0.3);
            }
            if (step === 0) voices.bass(time, chord.bass, 0.6);
            // Irregular dry web ticks.
            if (hash01(bar * 16 + step) < 0.24) voices.tick(time, 0.75);
          }),
        ],
      },
      {
        name: 'release',
        fromBar: STRANDLINE_SK9Q_BARS.release,
        tracks: [
          padTrack(2300, 0.4),
          fn(({ time, bar, step, chord }) => {
            if (parentEscaped) {
              // No bells, no resolution: a low drone and the water.
              if (bar === STRANDLINE_SK9Q_BARS.release && step === 0) voices.drone(time, chord.bass - 12, 0.35, BAR_SECONDS * 2);
              return;
            }
            if (bar === STRANDLINE_SK9Q_BARS.release && step === 0) voices.pulse(time, 0.4);
            const arp: Record<string, number> = { '26:0': 4, '26:8': 5, '27:4': 6, '27:12': 7 };
            const degree = arp[`${bar}:${step}`];
            if (degree !== undefined) voices.bell(time, chord.lead[degree], 0.4, 1.1);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- gameplay event voices ---------------------------------------------------

  function quantizedNow() {
    const context = runtime.context();
    if (!context) return null;
    return { context, time: score.quantizePlayerAction(context.currentTime) };
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
    if (kind === 'parent') parentId = enemyId;
    const context = runtime.context();
    if (!context) return;
    if (kind === 'spore') {
      voices.spitBlip(context.currentTime, 55, 0.5);
    } else if (kind === 'broodling' && context.currentTime - lastBroodStingAt > 1.2) {
      lastBroodStingAt = context.currentTime;
      voices.broodSting(context.currentTime, 64, 0.7);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    const now = quantizedNow();
    if (!now) return;
    const lead = score.leadSetAt(score.arrangementPositionAt(now.time));
    voices.lockDroplet(now.time, lead[Math.min(lead.length - 1, lockCount + 1)], 0.55 + lockCount * 0.07);
  });

  bus.on('fire', ({ volleySize }) => {
    const now = quantizedNow();
    if (!now) return;
    const position = score.arrangementPositionAt(now.time);
    const chord = score.chordAt(position);
    voices.firePluck(now.time, chord.bass + 24, 0.5 + volleySize * 0.09);
    if (volleySize >= 6) {
      const lead = score.leadSetAt(position);
      voices.sparkle(now.time + SIXTEENTH, lead[6], 0.8);
      voices.sparkle(now.time + SIXTEENTH * 2, lead[7], 0.8);
    }
  });

  bus.on('hit', ({ enemyId, lethal, hitStageIndex, stageHitPointsRemaining }) => {
    const now = quantizedNow();
    if (!now) return;
    const kind = enemyKinds.get(enemyId);
    if (kind === 'parent') {
      // The parent's voice climbs with every wound.
      const wounds = hitStageIndex * 3 + Math.max(0, 3 - stageHitPointsRemaining);
      voices.parentGong(now.time, 36 + wounds * 2, 0.34 + wounds * 0.05, 1.6);
      return;
    }
    const position = score.arrangementPositionAt(now.time);
    const lead = score.leadSetAt(position);
    voices.hitKnock(now.time, kind === 'husk' ? lead[1] : lead[3], lethal ? 0.5 : 0.65);
  });

  bus.on('stage', ({ enemyId }) => {
    const kind = enemyKinds.get(enemyId);
    const now = quantizedNow();
    if (!now) return;
    if (kind === 'parent') {
      // A stage torn off: an escalating wail over the gong.
      voices.webTear(now.time, 0.8, Math.min(2, webTears));
    } else if (kind === 'husk') {
      voices.hitKnock(now.time, 45, 1);
    }
  });

  bus.on('kill', ({ enemyId }) => {
    const context = runtime.context();
    if (!context) return;
    const kind = enemyKinds.get(enemyId);
    enemyKinds.delete(enemyId);
    if (kind === 'parent') return; // the sereneSwell lands on bossphase 'destroyed'
    const kill = score.nextKill(context.currentTime);
    const midi = kind === 'broodling' ? kill.midi + 12 : kind === 'husk' ? kill.midi - 5 : kill.midi;
    voices.killBell(kill.time, midi, kind === 'spore' ? 0.55 : 0.9);
  });

  bus.on('miss', ({ enemyId }) => {
    const kind = enemyKinds.get(enemyId);
    enemyKinds.delete(enemyId);
    if (kind === 'parent') {
      // The parent burrowed: the coda stays unresolved.
      parentEscaped = true;
      const context = runtime.context();
      if (context) voices.parentGong(context.currentTime, 31, 0.5, 2.6);
      return;
    }
    const context = runtime.context();
    if (!context) return;
    voices.lockDroplet(context.currentTime, 40, 0.3);
  });

  bus.on('reject', ({ enemyIds }) => {
    const context = runtime.context();
    if (!context) return;
    // A volley denied only by the web lands as a soft absorbed whump, not a
    // harsh reject — the lattice drank the shot. Anything else gets the sour note.
    if (enemyIds.length > 0 && enemyIds.every((id) => id === parentId)) {
      voices.spitBlip(context.currentTime, 38, 0.8);
      return;
    }
    voices.rejectSour(context.currentTime, 45, 0.8);
  });

  bus.on('playerhit', () => {
    const context = runtime.context();
    if (!context) return;
    voices.hullThud(context.currentTime, 0.9);
  });

  bus.on('bossphase', ({ phase }) => {
    const context = runtime.context();
    if (!context) return;
    if (phase === 'summoned') {
      voices.parentGong(context.currentTime, 38, 0.8, 2.8);
      voices.whoosh(context.currentTime, 0.7, 2.2);
    } else if (phase === 'exposed') {
      const tear = webTears;
      webTears += 1;
      voices.webTear(context.currentTime, 0.95, tear);
      // Each dying web lets the strand beneath ring clean: the mix literally
      // gains brightness as the animal comes back to life.
      voices.bell(context.currentTime + 0.9, 88 - (2 - tear) * 4, 0.5, 1.3);
    } else if (phase === 'destroyed') {
      // Duck the whole mix for a breath, then the serene A-major swell.
      runtime.mix()?.duckAt(context.currentTime, 0.35, 1.1);
      voices.sereneSwell(context.currentTime + 0.35, [45, 57, 61, 64, 69], 0.5);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size < 5 || kills !== size) return;
    const context = runtime.context();
    if (!context) return;
    voices.sparkle(context.currentTime, 93, 0.7);
  });

  return runtime;
}

function hash01(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
