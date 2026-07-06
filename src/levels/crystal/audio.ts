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
import { createCrystalVoices, type CrystalKillVoice } from './audio-voices';
import { CRYSTAL_BARS, CRYSTAL_BPM, CRYSTAL_SCORE_SECTIONS, CRYSTAL_STEPS_PER_BAR, CRYSTAL_TIME } from './timing';

// Rez-style synesthesia layer: the arrangement carries drums, bass, and
// pads, while the LEAD MELODY is a hidden two-bar sequencer lane that only
// sounds where the player lands kills. Each kill snaps to the transport's
// real 16th-note grid and plays whatever note the lane holds at that step,
// so a chained volley performs an actual melodic run. The lane's contour,
// kill instrument, and lock/fire timbres all change across the level's
// three acts, and every pitched player sound follows the current chord —
// the player is the soloist and the gun retunes with the harmony.

const SIXTEENTH = CRYSTAL_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = CRYSTAL_STEPS_PER_BAR;
const LANE_STEPS = 32; // two bars: one full chord

// A natural minor / pentatonic material.
const CHORDS = [
  { bass: 33, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] }, // Am7
  { bass: 29, pad: [53, 57, 60, 64], arp: [69, 72, 77, 81] }, // Fmaj7
  { bass: 36, pad: [52, 55, 60, 64], arp: [67, 72, 76, 79] }, // Cmaj7
  { bass: 31, pad: [55, 59, 62, 64], arp: [67, 71, 74, 79] }, // G6
];
type Chord = typeof CHORDS[number];
const LOCK_SCALE = [69, 72, 74, 76, 79, 81, 84, 88]; // A minor pentatonic, rising per lock

// The kill-melody lanes. Values are degrees 0–7 into the current chord's
// lead set (arp plus the same notes an octave up), so a kill on any step of
// any bar lands on a chord tone. Each lane is a 32-step contour over the
// two-bar chord cycle; kills "unmute" it step by step, and a chained volley
// plays consecutive steps — a real melodic fragment.
type SectionIndex = 0 | 1 | 2;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Act 1 — glass garden: a slow stepwise arch. Sparse waves pick calm
  // fragments out of it.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Act 2 — the corridor wakes up: syncopated octave zig-zags, so dense
  // volleys ring out as fast broken-chord runs.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Act 3 — the Warden: high descending peals answered by a climb back to
  // the top, so shield breaks and core chips toll like bells.
  2: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
};

// Per-act voicing for the player's instruments (kill, lock, fire).
// Lock gains are tuned for equal perceived loudness, not equal numbers: a
// square or saw at the same gain as a triangle sounds far louder (richer
// harmonics), and the lock must stay a subtle tick in every act.
const SECTION_VOICES: Record<SectionIndex, {
  kill: CrystalKillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.42, cutoff: 3400, gain: 0.17, shimmer: 0.35 },
    lock: { oscillator: 'triangle', cutoff: 2800, gain: 0.14 },
    fire: { cutoff: 1900, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.24, cutoff: 2600, gain: 0.15, shimmer: 0.5 },
    lock: { oscillator: 'square', cutoff: 2000, gain: 0.06 },
    fire: { cutoff: 3200, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.5, cutoff: 3000, gain: 0.16, shimmer: 0.7 },
    lock: { oscillator: 'sawtooth', cutoff: 2200, gain: 0.055 },
    fire: { cutoff: 4200, noise: 0.07 },
  },
};

export function createAudio(bus: EventBus) {
  return createCrystalAudio(bus).audio;
}

export const traceCrystalAudio = createAudioTraceHarness({
  level: 'crystal-corridor',
  bpm: CRYSTAL_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 45,
  createAudio: createCrystalAudio,
});

function createCrystalAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  // Boots in ambient (attract screen); runstart switches to the full arrangement.
  let coreId = -1;
  let coreMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: CRYSTAL_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: CRYSTAL_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
      delay: { time: SIXTEENTH * 3, feedback: 0.34, dampHz: 2600 },
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
      if (context) pad(context.currentTime + 0.05, [57, 64, 69, 76], 5);
    },
    onDispose() {
      ctx = null;
    },
  });

  // ---- musical position ----------------------------------------------------
  // Every player-triggered sound asks three questions: which grid step does
  // this land on, which chord sounds there, and which act's voice speaks.

  // Sections track the arrangement bars the same way the drum build does
  // (act 2 gameplay begins ~bar 5, the Warden fill lands at bar 16). Because
  // the backing track does NOT change at bar 5, the player-instrument
  // handover crossfades over two bars there instead of snapping; the Warden's
  // spawn snaps instantly because the music turns over with it.

  // ---- voices -------------------------------------------------------------

  const voices = createCrystalVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, clap, hat, bass, pad, arpNote, riser, noiseHit, playerSends, playerTone } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- scheduler ----------------------------------------------------------

  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const padOdd = blankBar + 'P...............';
  const normalKick = 'K...k...k...k...';
  const fillKick = 'K...k...k.k.k.k.';
  const clapBackbeat = '....C.......C...';
  const oddHat = '.h.h.h.h.h.h.h.h';
  const tightHat = 'hhHhhhHhhhHhhhHh';
  const openHat = 'hhOhhhOhhhOhhhOh';
  const bassGrid = 'B..b..u.b..b..f.';
  const evenArp = 'A.A.A.A.A.A.A.A.';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0),
        hits('A...A...A...A...', { A: 0.5 }, ({ time, step, chord }, vel) => arpNote(time, chord.arp[(step / 4) % chord.arp.length], vel)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      { name: 'bar-0', fromBar: CRYSTAL_BARS.run, toBar: 1, tracks: [padTrack(CRYSTAL_BARS.run), kickTrack(normalKick)] },
      { name: 'bar-1', fromBar: 1, toBar: CRYSTAL_BARS.warmup, tracks: [padTrack(1), kickTrack(normalKick), hatTrack(oddHat), bassTrack()] },
      { name: 'warmup', fromBar: CRYSTAL_BARS.warmup, toBar: CRYSTAL_BARS.claps, tracks: [padTrack(CRYSTAL_BARS.warmup), kickTrack(normalKick), hatTrack(tightHat), bassTrack(), arpTrack(0.45)] },
      { name: 'claps', fromBar: CRYSTAL_BARS.claps, toBar: CRYSTAL_BARS.openHats, tracks: [padTrack(CRYSTAL_BARS.claps), kickTrack(normalKick), hits(clapBackbeat, { C: 1 }, ({ time }) => clap(time)), hatTrack(tightHat), bassTrack(), arpTrack(0.45)] },
      { name: 'open-hats', fromBar: CRYSTAL_BARS.openHats, toBar: CRYSTAL_BARS.drive, tracks: [padTrack(CRYSTAL_BARS.openHats), kickTrack(normalKick), hits(clapBackbeat, { C: 1 }, ({ time }) => clap(time)), hatTrack(openHat), bassTrack(), arpTrack(0.45)] },
      { name: 'drive', fromBar: CRYSTAL_BARS.drive, toBar: CRYSTAL_BARS.preWarden, tracks: [padTrack(CRYSTAL_BARS.drive), kickTrack(normalKick), hits(clapBackbeat, { C: 1 }, ({ time }) => clap(time)), hatTrack(openHat), bassTrack(), arpTrack(0.6)] },
      { name: 'pre-warden', fromBar: CRYSTAL_BARS.preWarden, toBar: CRYSTAL_BARS.wardenFill, tracks: [padTrack(CRYSTAL_BARS.preWarden), kickTrack(normalKick), hits(clapBackbeat, { C: 1 }, ({ time }) => clap(time)), hatTrack(openHat), bassTrack(), arpTrack(0.6), oneShot(0, 0, ({ time }) => riser(time, 16 * 2 * SIXTEENTH))] },
      { name: 'warden-fill', fromBar: CRYSTAL_BARS.wardenFill, toBar: CRYSTAL_BARS.finale, tracks: [padTrack(CRYSTAL_BARS.wardenFill), kickTrack(fillKick), hits(clapBackbeat, { C: 1 }, ({ time }) => clap(time)), hatTrack(openHat), bassTrack(), arpTrack(0.6)] },
      { name: 'finale', fromBar: CRYSTAL_BARS.finale, tracks: [padTrack(CRYSTAL_BARS.finale), kickTrack(fillKick), hits(clapBackbeat, { C: 1 }, ({ time }) => clap(time)), hatTrack(openHat), bassTrack(), arpTrack(0.6), oneShot(0, 0, ({ time }) => riser(time, 16 * 2 * SIXTEENTH))] },
    ],
  });

  function padTrack(fromBar: number) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05));
  }

  function kickTrack(pattern: string) {
    return hits(pattern, { K: 1, k: 0.9 }, ({ time }, vel) => kick(time, vel));
  }

  function hatTrack(pattern: string) {
    return hits(pattern, { h: 0.045, H: 0.09, O: 0.14 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'O' ? 0.2 : 0.03));
  }

  function bassTrack() {
    return hits<Chord>(bassGrid, { B: 1, b: 0.75, u: 0.75, f: 0.75 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0;
      bass(time, chord.bass + offset, vel);
    });
  }

  function arpTrack(vel: number) {
    return hits<Chord>(evenArp, { A: vel }, ({ time, step, chord }, velocity) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      arpNote(time, chord.arp[order[(step / 2) % order.length]] - 12, velocity);
    });
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instruments -------------------------------------------
  // Kills read the hidden melody lane, locks climb the pentatonic in the
  // act's timbre, fire is a pitched zap rooted on the current chord. All
  // snap to the transport's real grid.

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    // Mid-blend the lane contour flips at the halfway point; the timbre is
    // what needs the smooth handover, not the (always-consonant) note choice.
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = SECTION_VOICES[sectionMix.from].kill;
    const toVoice = SECTION_VOICES[sectionMix.to].kill;
    // Chained volley kills crescendo, and from the third onward a soft upper
    // octave rings above the line.
    const vel = Math.min(1.35, 1 + chain * 0.12);
    const decay = lerp(fromVoice.decay, toVoice.decay, sectionMix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, sectionMix.t);
    const shimmer = lerp(fromVoice.shimmer, toVoice.shimmer, sectionMix.t);

    // Crossfade the lead: inside a blend window both acts' oscillators sound
    // with complementary weights, so the timbre slides rather than snapping.
    const layers: Array<[typeof fromVoice, number]> = sectionMix.from === sectionMix.to
      ? [[toVoice, 1]]
      : [[fromVoice, 1 - sectionMix.t], [toVoice, sectionMix.t]];
    for (const [voice, weight] of layers) {
      if (weight < 0.02) continue;
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + voice.decay + 0.05,
        oscillatorType: voice.oscillator,
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: voice.cutoff },
        gainAutomation: [
          { type: 'set', value: voice.gain * vel * weight, time },
          { type: 'exponentialRamp', value: 0.001, time: time + voice.decay },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.45 }],
      });
    }
    // A pure-tone body an octave below keeps square/saw voices from thinness.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + decay + 0.05,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi - 12),
      gainAutomation: [
        { type: 'set', value: gain * 0.55 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
      ],
      destination: output,
    });
    if (chain >= 2) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + decay + 0.05,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi + 12),
        gainAutomation: [
          { type: 'set', value: gain * 0.4, time },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.05 * shimmer + 0.03, 0.08, 'highpass', 5200, output);
  }

  // Chipping the core rings a deep anvil where everything else in the level
  // rings high. It grows with the damage dealt (intensity 0→1 across the
  // core's HP) and a beacon note climbs the lead set with it, so the fight
  // audibly ratchets toward the finale.
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
      stopTime: time + 0.45,
      oscillatorType: 'sine',
      frequency: rootFreq * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.09 }],
      gainAutomation: [
        { type: 'set', value: 0.26 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.38 },
      ],
      destination: output,
    });
    // Metallic face: the whole chord struck at once, brightening with damage.
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.24,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2200 + 2600 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.045 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
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
      stopTime: time + 0.55,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.07 + 0.07 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
      ],
      destination: output,
      sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
    });
    noiseHit(time, 0.12 + 0.08 * intensity, 0.06, 'bandpass', 1400, output);
  }

  // The killing blow on the core: the music bows out for a breath, a sub
  // drop lands on the tonic, a saw power chord blooms, and a victory peal
  // falls from the top of the register through the delay.
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
      frequency: 220,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 55, time: time + 0.45 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
      ],
      destination: output,
    });
    // Tonic bloom: A stacked through three octaves with a slow filter open.
    for (const midi of [45, 57, 64, 69]) {
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
            { type: 'set', value: 0.05, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.4 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }],
        });
      }
    }
    // Victory peal: A minor pentatonic falling from the top, ringing out.
    [93, 88, 84, 81, 76, 72, 69].forEach((midi, index) => {
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
          { type: 'set', value: 0.13 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }],
      });
    });
    noiseHit(time, 0.14, 0.6, 'highpass', 6000, output);
  }

  // Each kill takes at least the step after the previous one, so rapid
  // volley kills never stack on one step — they walk the lane note by note.
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
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    const layers: Array<[SectionIndex, number]> = sectionMix.from === sectionMix.to
      ? [[sectionMix.to, 1]]
      : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
    for (const [section, weight] of layers) {
      if (weight < 0.02) continue;
      const voice = SECTION_VOICES[section].lock;
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.13,
        oscillatorType: voice.oscillator,
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: voice.cutoff + lockCount * 180 },
        gainAutomation: [
          { type: 'set', value: voice.gain * weight, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
        ],
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    }
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const fromFire = SECTION_VOICES[sectionMix.from].fire;
    const toFire = SECTION_VOICES[sectionMix.to].fire;
    // Fire keeps one oscillator; its brightness slides between acts.
    const voice = {
      cutoff: lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t),
      noise: lerp(fromFire.noise, toFire.noise, sectionMix.t),
    };
    // The zap starts three octaves above the chord root and falls one, so
    // even the gun retunes as the harmony moves.
    const root = score.chordAt(position).bass;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.1,
      oscillatorType: 'sawtooth',
      frequency: midiToFreq(root + 36),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      filter: { type: 'lowpass', frequency: voice.cutoff },
      gainAutomation: [
        { type: 'set', value: 0.09, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
      ],
      destination: output,
    });
    noiseHit(time, voice.noise, 0.02, 'highpass', 3000, output);
  });

  // Armor chips (non-lethal hits) climb the current chord instead of a fixed
  // triad, so the Warden fight stays in tune bar to bar. Chips on the core
  // itself ring the heavy anvil instead — the fight's stakes live in that
  // sound growing.
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
    ([[0, 0.08], [1, 0.07], [2, 0.06]] as const).forEach(([index, vel]) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + THIRTYSECOND * index;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.16,
        oscillatorType: 'triangle',
        frequency: midiToFreq(arp[index] + 12),
        filter: { type: 'lowpass', frequency: 4200 },
        gainAutomation: [
          { type: 'set', value: vel, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.14 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.38 }],
      });
    });
    noiseHit(time, 0.035, 0.035, 'highpass', 5600, output);
  });

  // A clean volley of four or more kills earns a flourish: the chord stabbed
  // on the next beat under a bright shimmer — the music itself applauds.
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
          { type: 'set', value: 0.055, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.09, 0.3, 'highpass', 6800, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;

    // Negative feedback: a dry, dissonant rejection thunk that cuts through
    // the music without sounding like a successful hit sparkle.
    for (const [start, end, at, vel] of [
      [330, 92, time, 0.18],
      [233, 61, time + 0.028, 0.13],
    ] as const) {
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.26,
        oscillatorType: 'sawtooth',
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.2 }],
        filter: {
          type: 'bandpass',
          Q: 5,
          frequencyAutomation: [
            { type: 'set', value: 1100, time: at },
            { type: 'exponentialRamp', value: 430, time: at + 0.18 },
          ],
        },
        gainAutomation: [
          { type: 'set', value: vel, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.24 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.15, 0.09, 'bandpass', 720, output);
    noiseHit(time + 0.025, 0.07, 0.12, 'highpass', 2400, output);
  });

  // Hull hit: a low impact boom under a dissonant tritone stab — the one
  // sound in the level that is deliberately out of key.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.45,
      oscillatorType: 'sine',
      frequency: 96,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 34, time: time + 0.28 }],
      gainAutomation: [
        { type: 'set', value: 0.42, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
      ],
      destination: output,
    });
    for (const midi of [63, 69]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.28,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.07, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.2, 0.14, 'bandpass', 900, output);
  });

  // Warden entrance: a rising two-note alarm over a long riser. From here on
  // the kill melody speaks in the Warden's voice.
  bus.on('spawn', ({ kind, enemyId }) => {
    const mix = runtime.mix();
    if (kind !== 'warden-core' || !ctx || !mix?.duck || !mix.delaySend) return;
    score.overrideSection(2);
    coreId = enemyId;
    const time = score.nextGridTime(ctx.currentTime);
    riser(time, 1.8);
    [57, 63].forEach((midi, index) => {
      if (!ctx || !mix.duck || !mix.delaySend) return;
      const at = time + index * 0.42;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.55,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1600 },
        gainAutomation: [
          { type: 'set', value: 0.16, time: at },
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
      frequencyAutomation: [{ type: 'exponentialRamp', value: 68, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
      ],
      destination: output,
    });
  });

  return runtime;
}
