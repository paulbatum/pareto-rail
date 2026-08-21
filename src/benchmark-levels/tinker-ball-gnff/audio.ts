import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createArrangement, hits, oneShot } from '../../engine/arrangement';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createTinkerVoices } from './audio-voices';
import { TINKER_BARS, TINKER_BPM, TINKER_SCORE_SECTIONS, TINKER_STEPS_PER_BAR, TINKER_TIME } from './timing';

// Tinker Ball's score: bright, eccentric desk-pop at 112 BPM. The arrangement
// carries kick, bouncy synth bass, reed-organ stabs, handclaps, and workshop
// percussion; the LEAD MELODY is a hidden two-bar mallet lane that only sounds
// where the player lands kills. Kills snap to the transport's real 16th grid
// and play the lane's note, so a chained volley performs a mallet run — the
// player is the soloist, and every pitched action retunes with the harmony.

const SIXTEENTH = TINKER_TIME.stepSeconds;
const STEPS_PER_BAR = TINKER_STEPS_PER_BAR;
const LANE_STEPS = 32; // two bars: one full chord

// A bright C-major turntable: Cmaj7 → Am7 → Fmaj7 → G6, two bars each.
const CHORDS = [
  { bass: 36, pad: [60, 64, 67, 71], arp: [72, 76, 79, 84] }, // Cmaj7
  { bass: 33, pad: [57, 60, 64, 67], arp: [69, 72, 76, 81] }, // Am7
  { bass: 29, pad: [53, 57, 60, 64], arp: [69, 72, 77, 81] }, // Fmaj7
  { bass: 31, pad: [55, 59, 62, 67], arp: [67, 71, 74, 79] }, // G6
];
type Chord = typeof CHORDS[number];
const LOCK_SCALE = [72, 74, 76, 79, 81, 84]; // C major pentatonic, rising per lock

// Kill-melody lanes: degrees into the current chord's lead set. Each is a
// 32-step contour over the two-bar chord cycle; kills unmute it step by step.
type SectionIndex = 0 | 1 | 2;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Act 1 — marble run: a skipping, playful bounce up and back down.
  0: [
    0, 2, 1, 2, 4, 2, 3, 4,
    2, 4, 3, 5, 4, 6, 5, 7,
    7, 5, 6, 4, 5, 3, 4, 2,
    3, 1, 2, 0, 2, 1, 0, 2,
  ],
  // Act 2 — tennis ball: syncopated octave leaps, so volleys ring out as
  // broken-chord pops.
  1: [
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 0, 6, 2, 5, 1, 7, 3,
    2, 6, 0, 4, 7, 3, 5, 1,
    4, 7, 5, 2, 6, 3, 1, 0,
  ],
  // Act 2 — the Spill: descending mallet peals answered by a climb, so shell
  // breaks and core chips toll like the last toys going into the bin.
  2: [
    7, 5, 4, 2, 7, 5, 4, 2,
    5, 4, 2, 1, 5, 4, 2, 1,
    4, 2, 1, 0, 4, 2, 1, 0,
    2, 4, 5, 7, 6, 5, 4, 2,
  ],
};

// Per-section voicing for the player's instruments. Lock gains are tuned for
// equal perceived loudness: the woodblock tick must stay a tick in every act.
const SECTION_VOICES: Record<SectionIndex, {
  killDecay: number;
  killBrightness: number;
  killGain: number;
  lockGain: number;
  fireCutoff: number;
}> = {
  0: { killDecay: 0.5, killBrightness: 0.7, killGain: 1.0, lockGain: 0.5, fireCutoff: 2600 },
  1: { killDecay: 0.38, killBrightness: 1.0, killGain: 1.05, lockGain: 0.6, fireCutoff: 3400 },
  2: { killDecay: 0.62, killBrightness: 1.25, killGain: 1.1, lockGain: 0.7, fireCutoff: 4200 },
};

export function createAudio(bus: EventBus) {
  return createTinkerAudio(bus).audio;
}

export const traceTinkerAudio = createAudioTraceHarness({
  level: 'tinker-ball-gnff',
  bpm: TINKER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createTinkerAudio,
});

function createTinkerAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  // Boss bookkeeping: chips on the core grow with damage; the killing blow
  // gets a scheduled finale.
  let coreId = -1;
  let coreMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: TINKER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: TINKER_SCORE_SECTIONS,
    killLanes: KILL_LANES,
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
      compressor: { threshold: -17, ratio: 4.5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 3200 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      coreId = -1;
      coreMaxHp = 0;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      const mix = runtime.mix();
      if (context && mix?.duck && mix.delaySend) {
        // A last contented Cmaj7 bloom as the summary rises.
        pad(context.currentTime + 0.05, [60, 64, 67, 72], 3.4);
        jarPing(context.currentTime + 0.1, 91, 0.9);
      }
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createTinkerVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, clap, hat, bass, pad, reed, mallet, arpNote, woodblock, jarPing, riser, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler ----------------------------------------------------------

  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const padOdd = blankBar + 'P...............';
  const softKick = 'K.......k.......';
  const popKick = 'K...k...k...k...';
  const fillKick = 'K...k..kK...k.k.';
  const clapBackbeat = '....C.......C...';
  const lightHat = '.h...h...h...h..';
  const tightHat = 'h.h.h.h.h.h.h.h.';
  const openHat = 'hhOhhhOhhhOhhhOh';
  const tickOffbeat = '..w...w...w...w.';
  const bassBounce = 'B..b..u.b..b..u.';
  const bassDrive = 'B.b.B.uB.b.B.uu.';
  const evenArp = 'A.A.A.A.A.A.A.A.';
  const busyArp = 'A.AaA.A.A.AaA.A.';
  const reedOffbeat = '..R...R...R...R.';
  const reedPush = 'R...R..RR...R..R';
  const pingAccent = '........p.......';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0),
        hits('A...A...A...A...', { A: 0.5 }, ({ time, step, chord }, vel) => arpNote(time, chord.arp[(step / 4) % chord.arp.length], vel)),
        hits('....w.......w...', { w: 0.4 }, ({ time }, vel) => woodblock(time, vel)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      { name: 'bar-0', fromBar: TINKER_BARS.run, toBar: 1, tracks: [padTrack(0), kickTrack(softKick), hits(tickOffbeat, { w: 0.5 }, tickPlay)] },
      { name: 'marble-early', fromBar: 1, toBar: 3, tracks: [padTrack(1), kickTrack(softKick), hits(tickOffbeat, { w: 0.55 }, tickPlay), bassTrack(bassBounce)] },
      { name: 'marble', fromBar: 3, toBar: TINKER_BARS.act2, tracks: [padTrack(3), kickTrack(popKick), hits(tickOffbeat, { w: 0.55 }, tickPlay), hatTrack(lightHat), bassTrack(bassBounce), arpTrack(0.5, evenArp), pingTrack(0.7)] },
      { name: 'tennis', fromBar: TINKER_BARS.act2, toBar: TINKER_BARS.act3, tracks: [padTrack(8), kickTrack(popKick), hits(clapBackbeat, { C: 1 }, ({ time }, vel) => clap(time, vel)), hatTrack(tightHat), bassTrack(bassBounce), reedTrack(reedOffbeat, 0.8), arpTrack(0.55, busyArp), pingTrack(0.8)] },
      { name: 'melon', fromBar: TINKER_BARS.act3, toBar: TINKER_BARS.preSpill, tracks: [padTrack(16), kickTrack(popKick), hits(clapBackbeat, { C: 1 }, ({ time }, vel) => clap(time, vel)), hatTrack(openHat), bassTrack(bassDrive), reedTrack(reedPush, 0.9), arpTrack(0.65, busyArp), pingTrack(0.9)] },
      { name: 'pre-spill', fromBar: TINKER_BARS.preSpill, toBar: TINKER_BARS.spill, tracks: [padTrack(20), kickTrack(fillKick), hits(clapBackbeat, { C: 1 }, ({ time }, vel) => clap(time, vel)), hatTrack(openHat), bassTrack(bassDrive), reedTrack(reedPush, 1), arpTrack(0.7, busyArp), oneShot(0, 0, ({ time }) => riser(time, 2 * 16 * SIXTEENTH))] },
      { name: 'spill', fromBar: TINKER_BARS.spill, tracks: [padTrack(21), kickTrack(fillKick), hits(clapBackbeat, { C: 1 }, ({ time }, vel) => clap(time, vel)), hatTrack(openHat), bassTrack(bassDrive), reedTrack(reedPush, 1), arpTrack(0.7, busyArp), pingTrack(1)] },
    ],
  });

  function padTrack(fromBar: number) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05));
  }

  function kickTrack(pattern: string) {
    return hits(pattern, { K: 1, k: 0.85 }, ({ time }, vel) => kick(time, vel));
  }

  function hatTrack(pattern: string) {
    return hits(pattern, { h: 0.05, H: 0.09, O: 0.13 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'O' ? 0.18 : 0.03));
  }

  function tickPlay({ time }: { time: number }, vel: number) {
    woodblock(time, vel);
  }

  function bassTrack(pattern: string) {
    return hits<Chord>(pattern, { B: 1, b: 0.72, u: 0.8 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'u' ? 12 : symbol === 'b' ? 7 : 0;
      bass(time, chord.bass + offset, vel);
    });
  }

  function reedTrack(pattern: string, vel: number) {
    return hits<Chord>(pattern, { R: vel }, ({ time, chord }, velocity) => reed(time, chord.pad.slice(0, 3), velocity));
  }

  function arpTrack(vel: number, pattern: string) {
    return hits<Chord>(pattern, { A: vel, a: vel * 0.6 }, ({ time, step, chord }, velocity) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      arpNote(time, chord.arp[order[(step / 2) % order.length]] - 12, velocity);
    });
  }

  function pingTrack(vel: number) {
    return hits<Chord>(pingAccent, { p: vel }, ({ time, chord }, velocity) => jarPing(time, chord.arp[3] + 12, velocity));
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments -------------------------------------------

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = SECTION_VOICES[sectionMix.from];
    const toVoice = SECTION_VOICES[sectionMix.to];
    const vel = Math.min(1.4, (1 + chain * 0.1) * lerp(fromVoice.killGain, toVoice.killGain, sectionMix.t));
    const decay = lerp(fromVoice.killDecay, toVoice.killDecay, sectionMix.t);
    const brightness = lerp(fromVoice.killBrightness, toVoice.killBrightness, sectionMix.t);

    voices.playerMallet(time, midi, { vel, decay, brightness });
    // A tiny scatter of workshop dust under every kill keeps the desk alive.
    noiseHit(time, 0.045 + chain * 0.008, 0.05, 'highpass', 5000, output);
    if (chain >= 2) {
      // From the third kill in a volley, a soft octave bell rings above the run.
      voices.playerMallet(time, midi + 12, { vel: 0.4, decay: decay * 1.1, brightness });
    }
  }

  // Chipping the Spill's core rings a deep wood anvil that grows with the
  // damage dealt, and a beacon note climbs the lead set — the fight audibly
  // ratchets toward the finale.
  function coreChip(intensity: number) {
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
      stopTime: time + 0.4,
      oscillatorType: 'sine',
      frequency: rootFreq * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq * 0.5, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.3 + 0.18 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.36 },
      ],
      destination: output,
    });
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.22,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        filter: { type: 'bandpass', Q: 1.2, frequency: 1300 + 2200 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.04 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.3 }],
      });
    }
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    voices.playerMallet(time, beacon + 12, { vel: 0.5 + 0.3 * intensity, decay: 0.55, brightness: 1.2 });
    noiseHit(time, 0.1 + 0.08 * intensity, 0.06, 'bandpass', 1100, output);
  }

  // The killing blow on the Spill: the music bows out, a sub drop lands on
  // the tonic, a reed chord blooms, and a mallet peal falls through the delay.
  function coreFinale() {
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
      frequency: 210,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 52, time: time + 0.45 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
      ],
      destination: output,
    });
    for (const midi of [48, 60, 64, 67, 72]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.6,
          oscillatorType: 'square',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 600, time },
              { type: 'linearRamp', value: 2400, time: time + 0.9 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.04, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.5 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.3 }],
        });
      }
    }
    // Mallet peal: C major pentatonic falling from the top, ringing out.
    [96, 91, 88, 84, 81, 79, 76, 72].forEach((midi, index) => {
      if (!ctx || !output) return;
      const at = time + index * SIXTEENTH;
      voices.playerMallet(at, midi, { vel: 1.2 - index * 0.08, decay: 0.6, brightness: 1.3 });
    });
    noiseHit(time, 0.14, 0.6, 'highpass', 6000, output);
    clap(time, 1.2);
    clap(time + SIXTEENTH * 2, 0.9);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === coreId) {
      coreFinale();
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
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const lockGain = lerp(
      SECTION_VOICES[sectionMix.from].lockGain,
      SECTION_VOICES[sectionMix.to].lockGain,
      sectionMix.t,
    );
    // The lock is a pitched woodblock tick — tactile, tiny, in key.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.09,
      oscillatorType: 'triangle',
      frequency: midiToFreq(midi + 12),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi), time: time + 0.05 }],
      gainAutomation: [
        { type: 'set', value: 0.16 * lockGain, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
      ],
      destination: output,
      sends: [{ destination: mix.delaySend, gain: 0.25 }],
    });
    noiseHit(time, 0.05 * lockGain, 0.02, 'highpass', 6000, output);
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const cutoff = lerp(
      SECTION_VOICES[sectionMix.from].fireCutoff,
      SECTION_VOICES[sectionMix.to].fireCutoff,
      sectionMix.t,
    );
    // The volley "plick": a bright plucked drop rooted two octaves over the
    // chord root, so even the gun retunes with the harmony.
    const root = score.chordAt(position).bass;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.1,
      oscillatorType: 'triangle',
      frequency: midiToFreq(root + 36),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      filter: { type: 'lowpass', frequency: cutoff },
      gainAutomation: [
        { type: 'set', value: 0.12, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
      ],
      destination: output,
    });
    noiseHit(time, 0.03, 0.02, 'highpass', 4000, output);
  });

  // Armor chips (non-lethal hits) ring two quick mallet partials from the
  // live chord; chips on the core ring the heavy anvil instead.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      coreChip(1 - hitPointsRemaining / coreMaxHp);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    voices.playerMallet(time, arp[0] + 12, { vel: 0.5, decay: 0.22, brightness: 1 });
    voices.playerMallet(time + SIXTEENTH / 2, arp[1] + 12, { vel: 0.4, decay: 0.22, brightness: 1 });
    noiseHit(time, 0.03, 0.03, 'highpass', 5600, output);
  });

  // A clean volley of four or more kills earns the desk's applause: a clap
  // roll into a reed chord stab on the next beat.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    clap(time, 1.1);
    clap(time + SIXTEENTH, 0.7);
    reed(time + SIXTEENTH * 2, chord.pad.map((midi) => midi + 12), 1.1);
    noiseHit(time + SIXTEENTH * 2, 0.08, 0.25, 'highpass', 6800, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Negative feedback: a dull glue thunk and a flat little buzz — the one
    // deliberately out-of-key voice in the level.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.2,
      oscillatorType: 'square',
      frequency: 240,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 90, time: time + 0.16 }],
      filter: { type: 'lowpass', frequency: 900 },
      gainAutomation: [
        { type: 'set', value: 0.14, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
      ],
      destination: output,
    });
    noiseHit(time, 0.16, 0.08, 'bandpass', 500, output);
    noiseHit(time + 0.02, 0.06, 0.1, 'highpass', 2200, output);
  });

  // Hull hit: a wet splat — low noise under a falling sine blob.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.3,
      oscillatorType: 'sine',
      frequency: 170,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 52, time: time + 0.22 }],
      gainAutomation: [
        { type: 'set', value: 0.34, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
      ],
      destination: output,
    });
    noiseHit(time, 0.22, 0.12, 'bandpass', 700, output);
    noiseHit(time + 0.03, 0.08, 0.16, 'lowpass', 300, output);
  });

  // Spill entrance: a rising two-note reed alarm under the arrangement's own
  // riser. From here on the kill melody speaks in the finale voice.
  bus.on('spawn', ({ kind, enemyId }) => {
    const mix = runtime.mix();
    if (kind !== 'spill-core' || !ctx || !mix?.duck || !mix.delaySend) return;
    score.overrideSection(2);
    coreId = enemyId;
    const time = score.nextGridTime(ctx.currentTime);
    reed(time, [45, 52], 1.1);
    reed(time + 0.4, [48, 55], 1.2);
    jarPing(time + 0.8, 88, 1);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.13,
      oscillatorType: 'sine',
      frequency: 140,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 70, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: output,
    });
  });

  return runtime;
}
